import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createProject, projectSchema, type BlueprintGraph, type Project, type UiComponent, type VariableValue } from '../src/core/model';
import { addProjectGraphs, graphResourceKey, projectGraphs } from '../src/core/project-resources';
import { createUiParameterBinding, ensureUiPageEvent, uiEventAuthoringGraph } from '../src/core/ui-logic';
import type { UiProperty } from '../src/core/ui-properties';
import { detachUiParameterBinding, findUiParameterBinding, isUiParameterBindingGraph, listUiParameterBindings, markUiParameterBindingGraph, replaceUiParameterBinding, uiParameterBindingMarker } from '../src/core/ui-parameter-links';
import { setBlueprintUiPropertyRows } from '../src/core/blueprint-ui-property-batch';

function fixture(kind: 'standard' | 'custom' | 'scheme' = 'standard') {
  const project = createProject('参数联动管理'), pageId = kind === 'custom' ? 'custom_page' : 'ui:main';
  const component: UiComponent = { id: 'linked_title', kind: 'text', page: kind === 'custom' ? 'custom' : 'main', text: '标题', x: .1, y: .1, width: .5, height: .1 };
  project.variables.push({ id: 'title_visible', name: '显示标题', type: 'boolean', initial: true, persistent: false },
    { id: 'other_visible', name: '另一开关', type: 'boolean', initial: false, persistent: true });
  if (kind === 'custom') project.ui.customPages.push({ id: pageId, name: '自定义页面', components: [component], modal: false });
  else if (kind === 'scheme') {
    project.ui.instances = [{ id: 'scheme_a', name: '方案 A', components: [component] }];
    project.ui.activeInstanceId = 'scheme_a';
  } else project.ui.components.push(component);
  const graph = createUiParameterBinding(project, component.id, 'visible', 'title_visible', pageId);
  markUiParameterBindingGraph(graph);
  return { project, pageId, component, graph };
}

function summary(project: Project, component: UiComponent, pageId: string, graph: BlueprintGraph) {
  const binding = listUiParameterBindings(project, component.id, pageId).find(item => item.graphId === graph.id);
  assert.ok(binding, '联动图应能从组件定位');
  return binding;
}

test('automatic links are reused without adding timers, including at the graph limit', () => {
  for (const kind of ['standard', 'custom', 'scheme'] as const) {
    const { project, component, pageId, graph } = fixture(kind);
    const before = JSON.stringify(project);
    assert.strictEqual(findUiParameterBinding(project, component.id, 'visible', 'title_visible', pageId), graph);
    assert.strictEqual(createUiParameterBinding(project, component.id, 'visible', 'title_visible', pageId), graph);
    assert.equal(JSON.stringify(project), before);
    assert.equal(projectGraphs(project).flatMap(item => item.nodes.filter(node => node.type === 'eventTimer')).length, 1);
    assert.equal(summary(project, component, pageId, graph).origin, 'marked');
    while (projectGraphs(project).length < 256) addProjectGraphs(project, createBlueprintGraph('function', '其他逻辑'));
    assert.strictEqual(createUiParameterBinding(project, component.id, 'visible', 'title_visible', pageId), graph);
  }
});

test('multi-property nodes expose each linked source for navigation without authorizing managed-graph removal', () => {
  const { project, component, pageId, graph } = fixture('custom');
  project.variables.push({ id: 'alpha_batch', name: '透明度来源', type: 'number', initial: .65, persistent: false });
  const reader = blueprintNodeDefaults('getVariable'); reader.properties.variableId = 'alpha_batch'; graph.nodes.push(reader);
  const setters = graph.nodes.filter(node => node.type === 'setUiProperty');
  for (const node of setters) {
    setBlueprintUiPropertyRows(node, [
      { id: 'value', property: 'visible', writeMode: 'override' },
      { id: 'value_alpha', property: 'opacity', writeMode: 'override' },
    ]);
    node.properties.value_alpha = .4;
  }
  synchronizeBlueprintSignatures(project);
  for (const node of setters) assert.equal(connectBlueprintPins(graph, reader.id, 'value', node.id, 'value_alpha'), undefined);
  const before = structuredClone(project), bindings = listUiParameterBindings(project, component.id, pageId).filter(item => item.graphId === graph.id);
  assert.equal(bindings.length, 2);
  assert.equal(bindings.find(item => item.property === 'visible')?.variableId, 'title_visible');
  assert.equal(bindings.find(item => item.property === 'opacity')?.variableId, 'alpha_batch');
  assert.ok(bindings.every(item => !item.managed && item.reason?.includes('自定义')));
  assert.equal(findUiParameterBinding(project, component.id, 'visible', 'title_visible', pageId), undefined);
  assert.throws(() => detachUiParameterBinding(project, graph.id, pageId), /自定义|原蓝图/);
  assert.deepEqual(project, before, '自定义多项赋值不能被旧自动联动入口删掉');
});

test('replacing the source keeps the program identities, polling, and other links', () => {
  for (const kind of ['standard', 'custom', 'scheme'] as const) {
    const { project, component, pageId, graph } = fixture(kind);
    project.variables.push({ id: 'alpha', name: '透明度', type: 'number', initial: .6, persistent: false });
    const other = createUiParameterBinding(project, component.id, 'opacity', 'alpha', pageId), otherBefore = JSON.stringify(other);
    const nodes = graph.nodes.map(node => node.id), links = structuredClone(graph.links), count = projectGraphs(project).length;
    const timer = structuredClone(graph.nodes.find(node => node.type === 'eventTimer'));
    assert.strictEqual(replaceUiParameterBinding(project, graph.id, 'other_visible', pageId), graph);
    assert.deepEqual(graph.nodes.map(node => node.id), nodes);
    assert.deepEqual(graph.links, links);
    assert.deepEqual(graph.nodes.find(node => node.type === 'eventTimer'), timer);
    assert.equal(graph.nodes.find(node => node.type === 'getVariable')!.properties.variableId, 'other_visible');
    assert.ok(graph.nodes.filter(node => node.type === 'setUiProperty').every(node => node.properties.value === false));
    assert.equal(projectGraphs(project).length, count);
    assert.equal(JSON.stringify(other), otherBefore);
    assert.equal(summary(project, component, pageId, graph).managed, true);
    assert.strictEqual(findUiParameterBinding(project, component.id, 'visible', 'other_visible', pageId), graph);
    assert.equal(findUiParameterBinding(project, component.id, 'visible', 'title_visible', pageId), undefined);
    const replaced = JSON.stringify(project);
    replaceUiParameterBinding(project, graph.id, 'other_visible', pageId);
    assert.equal(JSON.stringify(project), replaced, '同一来源不得产生无意义修改');
  }
});

test('component references use static pin defaults and ignore inactive defaults behind target connections', () => {
  for (const kind of ['standard', 'custom'] as const) {
    const { project, component, pageId, graph } = fixture(kind);
    assert.equal(summary(project, component, pageId, graph).managed, true);
    const setters = graph.nodes.filter(node => node.type === 'setUiProperty');
    for (const node of setters) {
      delete node.properties.componentId;
      node.pins.find(pin => pin.id === 'componentId')!.defaultValue = component.id;
    }
    const staticBefore = JSON.stringify(project);
    assert.equal(summary(project, component, pageId, graph).variableId, 'title_visible');
    assert.equal(JSON.stringify(project), staticBefore);

    const input = blueprintNodeDefaults('getInput'); input.properties.inputId = 'target';
    graph.exposedInputs.push(blueprintPin('target', '目标控件', 'input', 'component', component.id));
    graph.nodes.push(input); synchronizeBlueprintSignatures(project);
    setters[0].properties.componentId = component.id;
    assert.equal(connectBlueprintPins(graph, input.id, 'value', setters[0].id, 'componentId'), undefined);
    assert.equal(summary(project, component, pageId, graph).variableId, 'title_visible', '另一处静态目标仍应可定位');
    assert.equal(connectBlueprintPins(graph, input.id, 'value', setters[1].id, 'componentId'), undefined);
    const dynamicBefore = JSON.stringify(project);
    assert.deepEqual(listUiParameterBindings(project, component.id, pageId), []);
    assert.equal(findUiParameterBinding(project, component.id, 'visible', 'title_visible', pageId), undefined);
    assert.equal(JSON.stringify(project), dynamicBefore, '查询动态目标不得改写原图');
  }
});

test('detaching removes only the owned automatic graph and its content indexes', () => {
  const { project, graph, pageId } = fixture();
  const other = createBlueprintGraph('function', '保留的蓝图'), timeline = createBlueprintGraph('effect', '保留的时间轴');
  timeline.timeline = { tracks: [], clips: [] };
  addProjectGraphs(project, other, timeline);
  const key = graphResourceKey(graph), otherKey = graphResourceKey(other), timelineKey = graphResourceKey(timeline);
  project.contentBrowser = { folders: [{ id: 'folder', name: '逻辑' }],
    assignments: { [key]: 'folder', [otherKey]: 'folder', [timelineKey]: 'folder', 'variable:title_visible': 'folder' },
    favorites: [key, otherKey, timelineKey, 'variable:title_visible'] };
  const variables = structuredClone(project.variables), source = project.variables[0];
  assert.equal(detachUiParameterBinding(project, graph.id, pageId), true);
  assert.equal(detachUiParameterBinding(project, graph.id, pageId), false);
  assert.deepEqual(project.variables, variables);
  assert.strictEqual(project.variables[0], source);
  assert.deepEqual(projectGraphs(project), [other, timeline]);
  assert.deepEqual(project.contentBrowser.assignments, { [otherKey]: 'folder', [timelineKey]: 'folder', 'variable:title_visible': 'folder' });
  assert.deepEqual(project.contentBrowser.favorites, [otherKey, timelineKey, 'variable:title_visible']);
  assert.deepEqual(project.contentBrowser.folders, [{ id: 'folder', name: '逻辑' }]);
});

test('missing source parameters can be repaired or detached without creating parameters', () => {
  for (const repair of [false, true]) {
    const { project, component, pageId, graph } = fixture('custom');
    project.variables = project.variables.filter(variable => variable.id !== 'title_visible');
    synchronizeBlueprintSignatures(project);
    const binding = summary(project, component, pageId, graph);
    assert.equal(binding.sourceMissing, true);
    assert.equal(binding.variableId, 'title_visible');
    assert.equal(binding.managed, true);
    if (repair) {
      replaceUiParameterBinding(project, graph.id, 'other_visible', pageId);
      assert.equal(summary(project, component, pageId, graph).sourceMissing, false);
    } else assert.equal(detachUiParameterBinding(project, graph.id, pageId), true);
    assert.deepEqual(project.variables.map(variable => variable.id), ['other_visible']);
  }
});

test('management rejects customized programs even when the automatic marker survives', () => {
  const changes: [string, (graph: BlueprintGraph) => void][] = [
    ['新增节点', graph => graph.nodes.push(blueprintNodeDefaults('comment'))],
    ['多余连线', graph => graph.links.push({ ...graph.links[0], id: 'extra_link' })],
    ['改变定时间隔', graph => { graph.nodes.find(node => node.type === 'eventTimer')!.properties.interval = .1; }],
    ['改成单次执行', graph => { graph.nodes.find(node => node.type === 'eventTimer')!.properties.repeat = false; }],
    ['改变写入方式', graph => { graph.nodes.find(node => node.type === 'setUiProperty')!.properties.writeMode = 'source'; }],
    ['读取页面状态', graph => { graph.nodes.find(node => node.type === 'getVariable')!.properties.scope = 'page'; }],
    ['手改读取来源', graph => { graph.nodes.find(node => node.type === 'getVariable')!.properties.variableId = 'other_visible'; }],
    ['手改两处写入属性', graph => { for (const node of graph.nodes.filter(node => node.type === 'setUiProperty')) node.properties.property = 'enabled'; }],
    ['手改所有备用值', graph => { for (const node of graph.nodes.filter(node => node.type === 'setUiProperty')) node.properties.value = false; }],
    ['手改引脚值', graph => { graph.nodes.find(node => node.type === 'setUiProperty')!.pins.find(pin => pin.id === 'value')!.defaultValue = false; }],
    ['新增引脚', graph => graph.nodes[0].pins.push(blueprintPin('other', '额外出口', 'output'))],
    ['外部输入', graph => graph.exposedInputs.push(blueprintPin('input', '输入', 'input', 'boolean'))],
    ['外部输出', graph => graph.exposedOutputs.push(blueprintPin('result', '输出', 'output', 'boolean'))],
    ['本地变量', graph => { graph.localVariables = [{ id: 'local', name: '局部', type: 'number', initial: 0 }]; }],
    ['时间轴', graph => { graph.timeline = { tracks: [], clips: [] }; }],
    ['时间轴组件', graph => { graph.timelineComponent = true; }],
    ['演出播放信息', graph => { graph.performanceKind = 'standalone'; }],
    ['能力契约', graph => { graph.requiredCapabilities = ['page']; }],
    ['调用别名', graph => { graph.callName = '自定义联动'; }],
    ['未知标记版本', graph => { graph.nodes[0].properties[uiParameterBindingMarker] = '{"version":2}'; }],
  ];
  for (const [label, change] of changes) {
    const { project, component, graph, pageId } = fixture();
    change(graph);
    const before = JSON.stringify(project);
    assert.equal(summary(project, component, pageId, graph).managed, false, label);
    assert.equal(findUiParameterBinding(project, component.id, 'visible', 'title_visible', pageId), undefined, label);
    assert.throws(() => replaceUiParameterBinding(project, graph.id, 'other_visible', pageId), /原蓝图/, label);
    assert.throws(() => detachUiParameterBinding(project, graph.id, pageId), /原蓝图/, label);
    assert.equal(JSON.stringify(project), before, label + '必须保留原图');
  }
});

test('marked links survive schema roundtrip and harmless blueprint arrangement', () => {
  const setup = fixture('scheme'), { component, pageId } = setup;
  const project = projectSchema.parse(JSON.parse(JSON.stringify(setup.project))), graph = projectGraphs(project).find(item => item.id === setup.graph.id)!;
  graph.name = '标题可见状态';
  graph.nodes.forEach((node, index) => { node.name = '整理节点 ' + index; node.x += 140; node.y -= 80; node.collapsed = true; node.pins.reverse(); });
  graph.nodes.reverse(); graph.links.reverse();
  assert.equal(summary(project, component, pageId, graph).managed, true);
  replaceUiParameterBinding(project, graph.id, 'other_visible', pageId);
  assert.equal(summary(project, component, pageId, graph).managed, true);
});

test('legacy recognition requires the original complete program and creation fingerprint', () => {
  for (const kind of ['standard', 'custom', 'scheme'] as const) {
    const { project, component, graph, pageId } = fixture(kind);
    delete graph.nodes[0].properties[uiParameterBindingMarker];
    assert.equal(isUiParameterBindingGraph(project, graph), true);
    assert.equal(summary(project, component, pageId, graph).origin, 'legacy');
    assert.equal(summary(project, component, pageId, graph).managed, true);
    replaceUiParameterBinding(project, graph.id, 'other_visible', pageId);
    assert.equal(summary(project, component, pageId, graph).origin, 'marked');
  }
  const changes: ((graph: BlueprintGraph) => void)[] = [
    graph => { graph.name = '我的自定义逻辑'; },
    graph => { graph.nodes[0].x += 10; },
    graph => { graph.nodes[0].name = '手动开始'; },
    graph => { graph.nodes[0].pins[0].name = '自定义输出'; },
    graph => { graph.id = 'custom_link_graph'; },
    graph => { graph.nodes.reverse(); },
    graph => { for (const node of graph.nodes.filter(node => node.type === 'setUiProperty')) node.properties.value = false; },
  ];
  for (const change of changes) {
    const { project, component, graph, pageId } = fixture();
    delete graph.nodes[0].properties[uiParameterBindingMarker]; change(graph);
    assert.equal(summary(project, component, pageId, graph).origin, 'custom');
    assert.equal(summary(project, component, pageId, graph).managed, false);
    assert.throws(() => detachUiParameterBinding(project, graph.id, pageId), /原蓝图/);
  }
});

test('automatic graphs remain reserved for binding even after custom edits', () => {
  const { project, graph } = fixture();
  assert.equal(isUiParameterBindingGraph(project, graph), true);
  graph.nodes.push(blueprintNodeDefaults('eventClick'));
  assert.equal(isUiParameterBindingGraph(project, graph), true);
  assert.equal(isUiParameterBindingGraph(project, createBlueprintGraph('ui', '按钮事件')), false);
});

test('new control and page events choose an event graph without changing automatic bindings', () => {
  for (const legacy of [false, true]) for (const pageEvent of [false, true]) {
    const { project, component, pageId, graph } = fixture();
    if (legacy) delete graph.nodes[0].properties[uiParameterBindingMarker];
    const before = JSON.stringify(graph);
    const eventGraph = pageEvent ? ensureUiPageEvent(project, pageId, '标题界面', 'show').graph : uiEventAuthoringGraph(project, pageId, '标题界面');
    assert.notEqual(eventGraph.id, graph.id);
    assert.equal(JSON.stringify(graph), before);
    assert.equal(summary(project, component, pageId, graph).managed, true);
    assert.strictEqual(uiEventAuthoringGraph(project, pageId, '手动选择', graph.id), graph, '显式选择的图仍由作者决定');
  }
});

test('inherited, shared, and other-page graphs cannot be overwritten or detached', () => {
  const { project, component, graph, pageId } = fixture('scheme');
  project.ui.instances!.push({ id: 'child', name: '继承方案', baseUiId: 'scheme_a', components: [] },
    { id: 'sibling', name: '独立方案', components: [{ ...component }] });
  project.ui.activeInstanceId = 'child';
  const inherited = summary(project, component, pageId, graph);
  assert.equal(inherited.managed, false);
  assert.match(inherited.reason!, /方案/);
  assert.throws(() => replaceUiParameterBinding(project, graph.id, 'other_visible', pageId), /方案/);
  assert.throws(() => detachUiParameterBinding(project, graph.id, pageId), /方案/);
  project.ui.activeInstanceId = 'sibling';
  assert.deepEqual(listUiParameterBindings(project, component.id, pageId), []);
  assert.throws(() => detachUiParameterBinding(project, graph.id, pageId), /方案/);
  project.ui.activeInstanceId = 'scheme_a';
  assert.throws(() => detachUiParameterBinding(project, graph.id, 'ui:save'), /页面/);
  delete graph.uiInstanceId;
  assert.equal(summary(project, component, pageId, graph).managed, false);
  assert.throws(() => detachUiParameterBinding(project, graph.id, pageId), /方案/);
  delete graph.uiPageId;
  assert.equal(summary(project, component, pageId, graph).managed, false);
  assert.throws(() => detachUiParameterBinding(project, graph.id, pageId), /共用/);
});

test('external callers, event bindings, saved actions, and pending text protect automatic graphs', () => {
  const references: [string, (project: Project, graph: BlueprintGraph) => void][] = [
    ['蓝图调用', (project, graph) => {
      const caller = createBlueprintGraph('function', '调用者'), node = blueprintNodeDefaults('callFunction');
      node.properties.graphId = graph.id; caller.nodes.push(node); addProjectGraphs(project, caller);
    }],
    ['组件事件', (project, graph) => { project.ui.components[0].events = { onShow: graph.id }; }],
    ['其他方案事件', (project, graph) => { project.ui.instances = [{ id: 'inactive', name: '未激活方案', blueprintId: graph.id, components: [] }]; }],
    ['自定义页面事件', (project, graph) => { project.ui.customPages.push({ id: 'other_page', name: '其他页面', modal: false, components: [], onShowBlueprintId: graph.id }); }],
    ['暂时停用的动作引用', (project, graph) => { project.ui.components[0].blueprintId = graph.id; }],
    ['封装演出', (project, graph) => {
      const caller = createBlueprintGraph('function', '封装调用'), node = blueprintNodeDefaults('savedAction');
      node.properties.action = JSON.stringify({ kind: 'blueprint', blueprintId: graph.id }); caller.nodes.push(node); addProjectGraphs(project, caller);
    }],
    ['未同步名称脚本', (project, graph) => { project.scriptText = { format: 'vns-text-1', content: '@蓝图：' + graph.name }; }],
    ['空格调用语法', (project, graph) => { project.scriptText = { format: 'vns-text-1', content: '@蓝图 ' + graph.name }; }],
    ['未同步ID脚本', (project, graph) => { project.scriptText = { format: 'vns-text-1', content: '@' + graph.name + '【' + graph.id + '】' }; }],
    ['自定义指令别名', (project, graph) => { project.scriptText = { format: 'vns-text-1', content: '@动作：@' + graph.name }; }],
    ['剧情演出', (project, graph) => { project.nodes.find(node => node.kind === 'passage')!.lines[0].actions.push({ kind: 'blueprint', blueprintId: graph.id }); }],
    ['重复资源ID', (project, graph) => { project.blueprints.push(structuredClone(graph)); }],
  ];
  for (const [label, reference] of references) {
    const { project, component, graph, pageId } = fixture();
    reference(project, graph);
    const before = JSON.stringify(project), binding = summary(project, component, pageId, graph);
    assert.equal(binding.managed, false, label);
    assert.throws(() => detachUiParameterBinding(project, graph.id, pageId), /引用|重复/, label);
    assert.throws(() => replaceUiParameterBinding(project, graph.id, 'other_visible', pageId), /引用|重复/, label);
    assert.equal(JSON.stringify(project), before, label);
  }
});

test('ordinary dialogue mentioning a graph name is not treated as an executable caller', () => {
  const { project, component, graph, pageId } = fixture();
  project.nodes.find(node => node.kind === 'passage')!.lines[0].text = '这里讨论' + graph.name;
  project.scriptText = { format: 'vns-text-1', content: '旁白：' + graph.name + '\n# @' + graph.name };
  assert.equal(summary(project, component, pageId, graph).managed, true);
});

test('replacement validates type, applicability, and numeric limits before mutating', () => {
  const { project, component, pageId, graph } = fixture();
  project.variables.push({ id: 'alpha', name: '透明度', type: 'number', initial: .5, persistent: false },
    { id: 'bad_alpha', name: '越界透明度', type: 'number', initial: 2, persistent: false });
  const alpha = createUiParameterBinding(project, component.id, 'opacity', 'alpha', pageId);
  const before = JSON.stringify(project);
  assert.throws(() => replaceUiParameterBinding(project, graph.id, 'alpha', pageId), /类型/);
  assert.throws(() => replaceUiParameterBinding(project, graph.id, 'missing', pageId), /类型/);
  assert.throws(() => replaceUiParameterBinding(project, alpha.id, 'bad_alpha', pageId), /范围/);
  assert.equal(JSON.stringify(project), before);
  const removed = project.ui.components.pop();
  assert.ok(removed);
  assert.throws(() => replaceUiParameterBinding(project, graph.id, 'other_visible', pageId), /类型/);
  assert.equal(detachUiParameterBinding(project, graph.id, pageId), true, '目标控件已删时仍可清理本页自动图');
});

test('asset links use typed sources and reject another media kind', () => {
  const project = createProject('素材联动'), component: UiComponent = { id: 'image', kind: 'image', page: 'main', text: '', x: 0, y: 0, width: 1, height: 1 };
  project.ui.components.push(component);
  project.variables.push({ id: 'picture', name: '图片', type: 'asset', assetKind: 'image', initial: '', persistent: false },
    { id: 'next_picture', name: '另一图片', type: 'asset', assetKind: 'image', initial: '', persistent: false },
    { id: 'sound', name: '声音', type: 'asset', assetKind: 'audio', initial: '', persistent: false },
    { id: 'text', name: '普通文字', type: 'string', initial: '', persistent: false });
  const graph = createUiParameterBinding(project, component.id, 'image', 'picture', 'ui:main');
  assert.equal(summary(project, component, 'ui:main', graph).managed, true);
  assert.throws(() => replaceUiParameterBinding(project, graph.id, 'sound', 'ui:main'), /类型/);
  assert.throws(() => replaceUiParameterBinding(project, graph.id, 'text', 'ui:main'), /类型/);
  replaceUiParameterBinding(project, graph.id, 'next_picture', 'ui:main');
  assert.equal(summary(project, component, 'ui:main', graph).variableId, 'next_picture');
  assert.equal(summary(project, component, 'ui:main', graph).managed, true);
});

test('failed binding creation leaves graph libraries, source parameters, and content indexes intact', () => {
  const { project, component, pageId, graph } = fixture();
  const image: UiComponent = { id: 'picture_control', kind: 'image', page: 'main', text: '', x: 0, y: 0, width: 1, height: 1 };
  project.ui.components.push(image);
  project.variables.push({ id: 'bad_opacity', name: '越界透明度', type: 'number', initial: 2, persistent: false },
    { id: 'plain_string', name: '文字参数', type: 'string', initial: '', persistent: false },
    { id: 'audio_asset', name: '音频参数', type: 'asset', assetKind: 'audio', initial: '', persistent: false },
    { id: 'missing_asset', name: '已丢失图片', type: 'asset', assetKind: 'image', initial: 'missing_picture', persistent: false });
  const unrelated = createBlueprintGraph('function', '保留待修蓝图'), pendingRead = blueprintNodeDefaults('getVariable');
  pendingRead.properties.variableId = 'title_visible';
  unrelated.nodes.push(pendingRead); addProjectGraphs(project, unrelated);
  project.contentBrowser = { folders: [{ id: 'logic', name: '逻辑' }], assignments: { [graphResourceKey(graph)]: 'logic' }, favorites: [graphResourceKey(graph)] };
  const attempts: [componentId: string, property: UiProperty, variableId: string, page: string][] = [
    [image.id, 'image', 'plain_string', pageId],
    [image.id, 'image', 'audio_asset', pageId],
    [image.id, 'image', 'missing_asset', pageId],
    [component.id, 'opacity', 'bad_opacity', pageId],
    [component.id, 'image', 'missing_asset', pageId],
    [component.id, 'visible', 'missing_variable', pageId],
    [component.id, 'visible', 'title_visible', 'ui:save'],
    [component.id, 'visible', 'title_visible', 'missing_page'],
    ['missing_component', 'visible', 'title_visible', pageId],
  ];
  for (const attempt of attempts) {
    const before = JSON.stringify(project);
    assert.throws(() => createUiParameterBinding(project, ...attempt));
    assert.equal(JSON.stringify(project), before);
    assert.equal(pendingRead.pins[0].dataType, 'any', '失败创建不得顺带同步其他蓝图');
  }
  while (projectGraphs(project).length < 256) addProjectGraphs(project, createBlueprintGraph('function', '数量占位'));
  const full = JSON.stringify(project);
  assert.throws(() => createUiParameterBinding(project, component.id, 'visible', 'other_visible', pageId), /上限/);
  assert.equal(JSON.stringify(project), full);
});

test('successful creation synchronizes only the new binding graph', () => {
  const { project, component, pageId } = fixture();
  const other = createBlueprintGraph('function', '暂不修改的图'), reader = blueprintNodeDefaults('getVariable');
  reader.properties.variableId = 'title_visible'; other.nodes.push(reader); addProjectGraphs(project, other);
  const before = JSON.stringify(other);
  const graph = createUiParameterBinding(project, component.id, 'visible', 'other_visible', pageId);
  assert.equal(JSON.stringify(other), before);
  assert.equal(summary(project, component, pageId, graph).managed, true);
  assert.equal(graph.nodes.find(node => node.type === 'getVariable')!.pins[0].dataType, 'boolean');
});

test('control links reject values outside the authored control contract without partial creation or replacement', () => {
  const cases: { name: string; control: 'slider' | 'choice' | 'input' | 'nativeChoice'; property: UiProperty; valid: VariableValue; invalid: VariableValue; problem: RegExp }[] = [
    { name: '滑条当前范围', control: 'slider', property: 'numberValue', valid: .5, invalid: 100, problem: /当前有效范围/ },
    { name: '未定义的文字选项', control: 'choice', property: 'stringValue', valid: '普通', invalid: '不存在', problem: /当前选项/ },
    { name: '超出选项数量的索引', control: 'choice', property: 'optionIndex', valid: 1, invalid: 3, problem: /现有选项/ },
    { name: '不能写入未选择索引', control: 'choice', property: 'optionIndex', valid: 0, invalid: -1, problem: /现有选项/ },
    { name: '文字按Unicode字符限制长度', control: 'input', property: 'stringValue', valid: '😀中文', invalid: '😀中文多', problem: /文字长度/ },
    { name: '数值下拉菜单的未定义选项', control: 'nativeChoice', property: 'numberValue', valid: .5, invalid: .6, problem: /当前选项/ },
    { name: '单独提高下限跨越上限', control: 'slider', property: 'minimum', valid: .1, invalid: 2, problem: /下限不能大于上限/ },
    { name: '单独降低上限跨越下限', control: 'slider', property: 'maximum', valid: .9, invalid: -.1, problem: /下限不能大于上限/ },
    { name: '玩家设置的引擎上限', control: 'nativeChoice', property: 'maximum', valid: .8, invalid: 2, problem: /引擎边界/ },
    { name: '步长必须为正数', control: 'slider', property: 'step', valid: .05, invalid: 0, problem: /步长必须大于/ },
  ];
  for (const entry of cases) {
    const project = createProject(entry.name), pageId = 'ui:preferences';
    project.variables.push(
      { id: 'number_source', name: '数值来源', type: 'number', initial: .5, persistent: false, setting: { min: -100, max: 100, step: 1 } },
      { id: 'choice_source', name: '选项来源', type: 'string', initial: '普通', persistent: false, setting: { options: ['简单', '普通', '困难'] } },
      { id: 'text_source', name: '输入来源', type: 'string', initial: '中文', persistent: false },
    );
    const component: UiComponent = { id: 'linked_control', kind: 'preferenceChoice', page: 'preferences', text: '', x: .1, y: .1, width: .5, height: .1 };
    if (entry.control === 'slider') Object.assign(component, { kind: 'preference', parameterId: 'number_source', controlRange: { min: 0, max: 1, step: .1 } });
    else if (entry.control === 'choice') component.parameterId = 'choice_source';
    else if (entry.control === 'input') { component.parameterId = 'text_source'; component.input = { maxLength: 3 }; }
    else { component.preference = 'musicVolume'; component.selector = { options: [{ label: '中', value: .5 }, { label: '高', value: .8 }] }; }
    project.ui.components.push(component);
    const sourceType = typeof entry.valid as 'number' | 'string' | 'boolean';
    project.variables.push(
      { id: 'valid_link_source', name: '有效来源', type: sourceType, initial: entry.valid, persistent: false },
      { id: 'invalid_link_source', name: '无效来源', type: sourceType, initial: entry.invalid, persistent: false },
      { id: 'compatible_link_source', name: '另一个有效来源', type: sourceType, initial: entry.valid, persistent: false },
    );
    const other = createBlueprintGraph('function', '保留的其他蓝图'), reader = blueprintNodeDefaults('getVariable');
    reader.properties.variableId = 'number_source'; other.nodes.push(reader); addProjectGraphs(project, other);
    project.contentBrowser = { folders: [{ id: 'logic', name: '逻辑' }], assignments: { [graphResourceKey(other)]: 'logic' }, favorites: [graphResourceKey(other)] };
    const before = structuredClone(project);
    assert.throws(() => createUiParameterBinding(project, component.id, entry.property, 'invalid_link_source', pageId), entry.problem, entry.name);
    assert.deepEqual(project, before, entry.name + '：失败创建不能添加图、修改签名或改变内容索引');
    const graph = createUiParameterBinding(project, component.id, entry.property, 'valid_link_source', pageId);
    assert.equal(summary(project, component, pageId, graph).managed, true, entry.name);
    const linked = structuredClone(project);
    assert.throws(() => replaceUiParameterBinding(project, graph.id, 'invalid_link_source', pageId), entry.problem, entry.name);
    assert.deepEqual(project, linked, entry.name + '：失败换源必须完整保留原有联动');
    assert.strictEqual(findUiParameterBinding(project, component.id, entry.property, 'valid_link_source', pageId), graph);
    assert.strictEqual(replaceUiParameterBinding(project, graph.id, 'compatible_link_source', pageId), graph);
    assert.strictEqual(findUiParameterBinding(project, component.id, entry.property, 'compatible_link_source', pageId), graph);
    assert.equal(summary(project, component, pageId, graph).managed, true, entry.name + '：有效换源后仍能管理');
    assert.equal(reader.pins[0].dataType, 'any', entry.name + '：创建与换源均不得同步其他图');
  }
});
