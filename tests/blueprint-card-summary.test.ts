import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthoringIndexCache } from '../src/core/authoring-index';
import { blueprintCardSummary } from '../src/core/blueprint-card-summary';
import { blueprintCatalog, blueprintNodeDefaults, blueprintPin, createBlueprintGraph, synchronizeBlueprintNodeValuePins } from '../src/core/blueprint';
import { createProject, type BlueprintNode, type UiComponent, type VariableValue } from '../src/core/model';

function fixture() {
  const project = createProject('紧凑卡片');
  project.variables = [{ id: 'score', name: '得分', type: 'number', initial: 99, persistent: false }];
  const component: UiComponent = { id: 'button', name: '继续按钮', kind: 'button', page: 'custom', text: '继续', x: .1, y: .1, width: .2, height: .1 };
  project.ui.customPages = [{ id: 'page', name: '主页面', modal: true, components: [component] }];
  project.characters = [{ id: 'actor', name: '小夏', color: '#ff9900', expressions: [{ id: 'smile', name: '微笑', assetId: 'portrait' }] }];
  project.effects = [{ id: 'effect', name: '闪光', commands: [] }];
  const graph = createBlueprintGraph('function', '卡片演出');
  project.blueprints = [graph];
  const add = (type: BlueprintNode['type'], properties: Record<string, VariableValue> = {}) => {
    const node = blueprintNodeDefaults(type); Object.assign(node.properties, properties); graph.nodes.push(node); return node;
  };
  const connect = (source: BlueprintNode, target: BlueprintNode, pinId: string, output = 'value') => {
    graph.links.push({ id: 'link_' + graph.links.length, fromNodeId: source.id, fromPinId: output, toNodeId: target.id, toPinId: pinId });
  };
  const summary = (node: BlueprintNode, indexes?: AuthoringIndexCache) => blueprintCardSummary(project, graph, node, indexes);
  return { project, graph, component, add, connect, summary };
}

test('summaries identify authored operations and never evaluate a linked live input', () => {
  const f = fixture(), live = f.add('getVariable', { scope: 'project', variableId: 'score' });
  const math = f.add('math', { operation: 'multiply', a: 12345, b: 2 });
  f.connect(live, math, 'a');
  assert.equal(f.summary(math), '相乘 × · 来自：作品状态 · 得分，2');
  const compare = f.add('compare', { operator: 'gte', a: 5, b: 3 });
  assert.equal(f.summary(compare), '数值 · 大于或等于 · 5，3');
  const round = f.add('round', { mode: 'ceil', value: -1.2 });
  assert.equal(f.summary(round), '向上取整 · -1.2');
  const delay = f.add('delay', { seconds: 8000 });
  f.connect(live, delay, 'seconds');
  assert.equal(f.summary(delay), '来自：作品状态 · 得分');
  assert.ok(!f.summary(delay)?.includes('8000'));
  assert.ok(!f.summary(delay)?.includes('99'), 'the variable initial value is not the runtime value');
  math.properties.operation = 'future_operation'; assert.match(f.summary(math)!, /运算方式无效/);
});

test('fixed and linked reference values resolve readable names without leaking missing IDs', () => {
  const f = fixture(), sceneId = f.project.scenes[0].id;
  f.project.scenes[0].name = '黄昏教室';
  const literal = f.add('literal', { value: sceneId }); literal.pins[0].dataType = 'scene';
  assert.equal(f.summary(literal), '场景 · 黄昏教室');
  const target = f.add('switchScene', { sceneId: 'inactive_scene' });
  f.connect(literal, target, 'sceneId');
  assert.equal(f.summary(target), '来自：常量 · 黄昏教室 · 渐变');
  assert.ok(!f.summary(target)?.includes('inactive_scene'));
  literal.properties.value = 'deleted_scene';
  assert.equal(f.summary(literal), '场景 · 场景引用已失效');
  assert.equal(f.summary(target), '来自：常量 · 场景引用已失效 · 渐变');
  const component = f.add('literal', { value: f.component.id }); component.pins[0].dataType = 'component';
  assert.equal(f.summary(component, new AuthoringIndexCache()), '界面组件 · 继续按钮');
  component.properties.value = 'deleted_component';
  assert.equal(f.summary(component), '界面组件 · 控件引用已失效');
  const empty = f.add('literal', { value: '' }); assert.equal(f.summary(empty), '文字 · 空文字');
});

test('events expose their target, phase, shortcut, page ownership and timer configuration', () => {
  const f = fixture(), button = f.add('eventButton', { componentId: 'button', trigger: 'press' });
  assert.equal(f.summary(button), '继续按钮 · 按下时');
  const image = f.add('eventImage', { componentId: 'button', trigger: 'failed' });
  assert.equal(f.summary(image), '继续按钮 · 图片加载失败时');
  const key = f.add('eventKey', { pageId: 'page', key: 'K_RETURN' });
  assert.equal(f.summary(key), '主页面 · 回车');
  const timer = f.add('eventTimer', { pageId: 'page', interval: .25, repeat: false });
  assert.equal(f.summary(timer), '主页面 · 每 0.25 秒触发一次');
  timer.properties.repeat = 'false'; assert.match(f.summary(timer)!, /定时循环配置无效/);
  timer.properties.repeat = true; timer.properties.interval = 0; assert.match(f.summary(timer)!, /定时间隔无效/);
  const lifecycle = f.add('eventPage', { pageId: 'page', phase: 'closed' });
  assert.equal(f.summary(lifecycle), '主页面 · 页面关闭完成时');
  lifecycle.properties.phase = 'future_phase'; assert.match(f.summary(lifecycle)!, /页面生命周期时机无效/);
  f.graph.uiPageId = 'page'; key.properties.pageId = '';
  assert.equal(f.summary(key), '主页面 · 回车');
  assert.equal(f.summary(f.graph.nodes[0]), '主页面 · 页面显示时');
  button.properties.trigger = 'future_trigger'; assert.match(f.summary(button)!, /按钮触发时机无效/);
});

test('page contracts distinguish a dynamic target from the declaration used for stable pins', () => {
  const f = fixture();
  f.project.ui.pageInterfaces = { page: { version: 1, inputs: [{ id: 'input_title', name: '标题参数', dataType: 'string', direction: 'input', required: false }], outputs: [] } };
  const node = f.add('getPageInput', { pageId: 'page', parameterId: 'input_title' });
  assert.equal(f.summary(node), '主页面 · 标题参数');
  const target = f.add('getInput', { inputId: 'target_page' });
  f.graph.exposedInputs = [blueprintPin('target_page', '目标页面', 'input', 'ui', 'page')];
  f.connect(target, node, 'pageId'); node.properties.interfacePageId = 'page';
  assert.equal(f.summary(node), '来自：输入 · 目标页面 · 接口：主页面 · 标题参数');
  f.project.ui.pageInterfaces.page.version = 2;
  assert.equal(f.summary(node), '页面接口版本不受支持，原配置已保留');
});

test('actor summaries preserve automatic/default semantics and avoid inactive linked roles', () => {
  const f = fixture(), actor = f.add('showCharacter');
  assert.equal(f.summary(actor), '当前台词角色 · 默认表情 · 角色默认站位');
  Object.assign(actor.properties, { characterId: 'actor', expressionId: 'smile', presetId: 'left' });
  assert.equal(f.summary(actor), '小夏 · 微笑 · 左');
  actor.properties.expressionId = 'deleted_expression';
  assert.equal(f.summary(actor), '小夏 · 表情引用已失效 · 左');
  actor.properties.expressionId = '';
  const target = f.add('getInput', { inputId: 'actor_target' });
  f.graph.exposedInputs = [blueprintPin('actor_target', '登场角色', 'input', 'character', 'actor')];
  f.connect(target, actor, 'characterId');
  assert.equal(f.summary(actor), '来自：输入 · 登场角色 · 默认表情 · 站位按运行时角色匹配');
  assert.ok(!f.summary(actor)?.includes('小夏'));
  actor.properties.actorTransitions = '{invalid'; assert.match(f.summary(actor)!, /角色过渡配置无效/);
  actor.properties.actorTransitions = JSON.stringify({ enter: { mode: 'dissolve', duration: .5 } });
  assert.match(f.summary(actor)!, /已自定义角色过渡/);
  const hide = f.add('hideCharacter', { characterId: 'deleted_actor' });
  assert.equal(f.summary(hide), '角色引用已失效');
  const invalid = f.add('showCharacter', { characterId: false, expressionId: 0, presetId: false });
  assert.match(f.summary(invalid)!, /角色引用类型无效.*表情类型无效.*站位类型无效/);
  assert.ok(!f.summary(invalid)?.includes('当前台词角色'), 'only empty or absent roles use automatic semantics');
});

test('calls, state, task scope and choices show defining configuration and unsupported versions', () => {
  const f = fixture(), called = createBlueprintGraph('macro', '初始化关卡'); f.project.blueprints.push(called);
  const call = f.add('callMacro', { graphId: called.id });
  assert.equal(f.summary(call), '初始化关卡');
  called.timelineComponent = true; assert.equal(f.summary(call), '时间轴 · 初始化关卡');
  call.properties.graphId = 'deleted_call'; assert.equal(f.summary(call), '调用流程引用已失效');
  const state = f.add('setVariable', { scope: 'project', variableId: 'score' });
  assert.equal(f.summary(state), '作品状态 · 得分');
  f.graph.localVariables = [{ id: 'local_score', name: '本次得分', type: 'number', initial: 0 }];
  Object.assign(state.properties, { scope: 'call', variableId: 'local_score' });
  assert.equal(f.summary(state), '本次调用 · 本次得分');
  const gate = f.add('gate', { scope: 'page', pageId: 'page', initiallyClosed: false });
  assert.equal(f.summary(gate), '页面实例 · 主页面 · 初始可通过');
  const task = f.add('startTask', { graphId: called.id, scope: 'page', pageId: 'page', conflict: 'replace' });
  assert.equal(f.summary(task), '初始化关卡 · 页面实例 · 主页面 · 替换旧任务 · 延后 0');
  task.properties.taskVersion = 88; assert.equal(f.summary(task), '任务定义版本不受支持，原配置已保留');
  const choice = f.add('selectByKey'); assert.equal(f.summary(choice), '文字 · 2 个候选值 · 结果：数值');
  choice.properties.choiceVersion = 88; assert.match(f.summary(choice)!, /数据版本尚不支持/);
});

test('UI property summaries identify writes and sources without treating defaults as live bindings', () => {
  const f = fixture();
  f.component.propertyControls = { opacity: { mode: 'follow', parameterId: 'score' } };
  const set = f.add('setUiProperty', { componentId: 'button', property: 'opacity', value: .8 });
  // Property changes in the editor synchronize the value pin before rendering.
  // This test builds the node directly, so apply that same node-local step.
  synchronizeBlueprintNodeValuePins(f.project, f.graph, set);
  assert.match(f.summary(set)!, /继续按钮.*不透明度.*= 0.8.*单向跟随参数，本次不写入/);
  const defaults = f.add('getUiDefault', { componentId: 'button', property: 'opacity' });
  assert.match(f.summary(defaults)!, /保存的设计默认值/); assert.ok(!f.summary(defaults)?.includes('单向跟随'));
  f.component.propertyControls.opacity = { mode: 'sync', parameterId: 'score' };
  assert.match(f.summary(set)!, /双向同步 · 得分/);
  f.component.propertyControls.opacity.parameterId = 'deleted_parameter';
  assert.match(f.summary(set)!, /属性来源无效/); assert.ok(!f.summary(set)?.includes('deleted_parameter'));
  const source = f.add('getInput', { inputId: 'component_target' });
  f.graph.exposedInputs.push(blueprintPin('component_target', '目标控件', 'input', 'component', 'button'));
  f.connect(source, set, 'componentId'); set.properties.writeMode = 'source';
  assert.match(f.summary(set)!, /^来自：输入 · 目标控件.*修改绑定源/);
  assert.ok(!f.summary(set)?.includes('属性来源无效'), 'inactive stored component policies do not apply to a dynamic target');
});

test('animation summaries keep source-first loop labels and name changes without using old loops', () => {
  const f = fixture(); f.project.ui.animations = [{ id: 'animation', name: '弹出提示', pageId: 'page', duration: 1, tracks: [] }];
  const node = f.add('playUiAnimation', { animationId: 'animation', playMode: 'pingpong', loops: 0 });
  assert.equal(f.summary(node), '弹出提示 · 往返 · 无限循环');
  const source = f.add('getVariable', { scope: 'project', variableId: 'score' }); f.connect(source, node, 'loops');
  assert.equal(f.summary(node), '弹出提示 · 往返 · 来自：作品状态 · 得分');
  f.project.variables[0].name = '重复次数'; f.project.ui.animations[0].name = '新提示';
  assert.equal(f.summary(node), '新提示 · 往返 · 来自：作品状态 · 重复次数');
  node.properties.animationId = 'deleted_animation'; assert.match(f.summary(node)!, /界面动画引用已失效/);
});

test('property read sources stay conservative about their own dynamic component inputs', () => {
  const f = fixture(), read = f.add('getUiDefault', { componentId: 'button', property: 'opacity' });
  const target = f.add('math'); f.connect(read, target, 'a');
  assert.match(f.summary(target)!, /来自：继续按钮 · 不透明度（0～1） · 设计默认值/);
  const component = f.add('getInput', { inputId: 'component_target' });
  f.graph.exposedInputs = [blueprintPin('component_target', '目标控件', 'input', 'component', 'button')];
  f.connect(component, read, 'componentId');
  assert.match(f.summary(target)!, /来自：接线控件 · 不透明度（0～1） · 设计默认值/);
  assert.ok(!f.summary(target)?.includes('继续按钮'));
  assert.ok(!f.summary(target)?.includes('目标控件'), 'card labels do not follow transitive source dependencies');
});

test('simple resources, preferences and saved action diagnostics do not fall back to catalog prose', () => {
  const f = fixture(); f.project.assets = [{ id: 'background', name: '教学楼', kind: 'image', path: 'assets/school.png' }];
  const background = f.add('showBackground', { assetId: 'background', transition: 'fade' });
  assert.equal(f.summary(background), '教学楼 · 先淡出再淡入');
  const preference = f.add('getPlayerPreference', { preference: 'musicVolume' });
  f.project.playerPreferenceSettings = { musicVolume: { name: '音乐响度' } };
  assert.equal(f.summary(preference), '音乐响度');
  const action = f.add('savedAction', { action: '{broken' });
  assert.equal(f.summary(action), '保存的演出配置无效，原配置已保留');
  action.properties.action = JSON.stringify({ kind: 'pause', seconds: .5 });
  assert.equal(f.summary(action), '等待 · 0.5 秒');
});

test('unknown nodes and broken source pins give problems while route-only nodes may omit prose', () => {
  const f = fixture(), delay = f.add('delay');
  f.graph.links.push({ id: 'broken', fromNodeId: 'deleted_source', fromPinId: 'value', toNodeId: delay.id, toPinId: 'seconds' });
  assert.equal(f.summary(delay), '来自：来源节点已失效');
  const source = f.add('literal', { value: 17 }); f.graph.links[0].fromNodeId = source.id; f.graph.links[0].fromPinId = 'deleted_pin';
  assert.equal(f.summary(delay), '来自：来源连接点已失效');
  const unsupported = { ...f.add('delay'), type: 'future_node' } as unknown as BlueprintNode;
  assert.equal(f.summary(unsupported), '节点类型不受支持，原配置已保留');
  for (const type of ['event', 'sequence', 'startDialogue', 'return', 'comment'] as const) assert.equal(f.summary(f.add(type)), undefined);
  for (const type of Object.keys(blueprintCatalog) as BlueprintNode['type'][]) {
    const summary = f.summary(f.add(type));
    assert.notEqual(summary, '节点摘要尚未支持此配置，请查看节点参数', type + ' has an explicit display or omission policy');
  }
});

test('summary generation preserves every input, link, malformed definition and project resource', () => {
  const f = fixture();
  const nodes = (Object.keys(blueprintCatalog) as BlueprintNode['type'][]).map(type => f.add(type));
  nodes.find(node => node.type === 'showCharacter')!.properties.actorTransitions = '{invalid';
  nodes.find(node => node.type === 'selectByKey')!.properties.cases = '{invalid';
  const snapshot = structuredClone(f.project);
  for (const node of nodes) f.summary(node, new AuthoringIndexCache());
  assert.deepEqual(f.project, snapshot);
});
