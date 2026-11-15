import assert from 'node:assert/strict';
import { createProject, type BlueprintGraph, type BlueprintNode, type UiComponent, type VariableValue } from '../../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createUiEventGraph, ensureUiClickEvent, ensureUiValueChangedEvent } from '../../src/core/ui-logic';
import type { UiProperty } from '../../src/core/ui-properties';

/** One set of authored nodes for interpreter, editor and native acceptance. */
export function createUiControlOptionsFixture() {
  const project = createProject('控件选项列表'); project.id = 'control_options'; project.width = 1280; project.height = 720;
  const variable = (id: string, initial: VariableValue, name = id) => project.variables.push({ id, name, initial, type: typeof initial as 'number' | 'string' | 'boolean', persistent: false });
  variable('choice_source', '初始', '选项来源'); variable('free_source', '输入', '自由输入'); variable('changed_count', 0, '用户改值次数'); variable('job_done', false);
  variable('observed_count', 2); variable('observed_index', 0); variable('observed_label', '初始'); variable('read_found', false); variable('read_label', ''); variable('read_value', '');
  project.variables.find(item => item.id === 'choice_source')!.setting = { options: ['初始', '另一个'] };
  project.playerDefaults = { ...project.playerDefaults, skipAll: false, musicVolume: .5 };
  const actions = [['append', '追加动态选项'], ['rename', '修改首项标签'], ['remove', '移除当前首项'], ['move', '首项移到末尾'], ['clear', '清空选项'], ['reset', '恢复设计选项'], ['override', '覆盖第三项'], ['source', '写入第三项来源'], ['whole', '重置整控件'], ['observe', '读取当前选项'], ['background', '后台追加选项'], ['readonly', '禁止用户改值'], ['child', '打开选项子页'], ['native', '打开模板选项'], ['close', '关闭页面']] as const;
  const components: UiComponent[] = [
    { id: 'choice', page: 'custom', kind: 'preferenceChoice', text: '动态选项', parameterId: 'choice_source', x: .03, y: .03, width: .44, height: .13 },
    { id: 'mirror', page: 'custom', kind: 'preferenceChoice', text: '原列表镜像', parameterId: 'choice_source', x: .52, y: .03, width: .44, height: .13 },
    { id: 'boolean_choice', page: 'custom', kind: 'preferenceChoice', text: '开关选项', preference: 'skipAll', selector: { options: [{ label: '只跳已读', value: false }, { label: '允许全部', value: true }] }, x: .03, y: .22, width: .28, height: .09 },
    { id: 'number_choice', page: 'custom', kind: 'preferenceChoice', text: '数值选项', preference: 'musicVolume', selector: { options: [{ label: '静音', value: 0 }, { label: '一半', value: .5 }, { label: '全部', value: 1 }] }, x: .36, y: .22, width: .28, height: .09 },
    { id: 'free_input', page: 'custom', kind: 'preferenceChoice', text: '自由输入', parameterId: 'free_source', x: .69, y: .19, width: .28, height: .13 },
    ...actions.map(([id, text], i): UiComponent => ({ id: 'option_act_' + id, page: 'custom', kind: 'button', text, x: .025 + i % 4 * .245, y: .39 + Math.floor(i / 4) * .135, width: .23, height: .10, style: { fontSize: 22 }, ...(id === 'close' ? { action: 'return' as const } : {}) })),
  ];
  const page = { id: 'options_page', name: '选项列表', modal: true, background: '#172934', components };
  const child = { id: 'options_child', name: '选项子页', modal: true, background: '#263747', components: [
    { id: 'child_choice', page: 'custom', kind: 'preferenceChoice', text: '子页选项', parameterId: 'choice_source', x: .2, y: .18, width: .6, height: .15 },
    { id: 'child_append', page: 'custom', kind: 'button', text: '子页追加', x: .2, y: .45, width: .25, height: .1 },
    { id: 'child_close', page: 'custom', kind: 'button', text: '返回父页', action: 'return', x: .55, y: .45, width: .25, height: .1 },
  ] as UiComponent[] };
  // Engine preference controls retain their fixed settings-page host. Custom pages use author parameters.
  const preferenceChoices = components.filter(component => ['boolean_choice', 'number_choice'].includes(component.id));
  for (const [index, component] of preferenceChoices.entries()) { components.splice(components.indexOf(component), 1); component.page = 'preferences'; component.x = .08 + index * .48; component.y = .08; component.width = .36; }
  project.ui.customPages.push(page, child);
  project.ui.pages ??= {}; project.ui.pages.preferences = { ...project.ui.pages.preferences, layout: 'custom' };
  project.ui.components = project.ui.components.filter(component => component.page !== 'preferences');
  project.ui.components.push(
    ...preferenceChoices,
    { id: 'native_choice', page: 'preferences', kind: 'preferenceChoice', text: '模板选项', preference: 'skipAll', selector: { options: [{ label: '只跳已读', value: false }, { label: '允许全部', value: true }] }, x: .25, y: .24, width: .5, height: .1 },
    { id: 'native_append', page: 'preferences', kind: 'button', text: '追加模板选项', x: .2, y: .5, width: .25, height: .1 },
    { id: 'native_close', page: 'preferences', kind: 'button', text: '返回选项页', action: 'return', x: .55, y: .5, width: .25, height: .1 },
  );
  const graph = createUiEventGraph(project, page.id, '选项列表同源场景'); let serial = 0;
  const node = (owner: BlueprintGraph, type: BlueprintNode['type'], properties: Record<string, VariableValue> = {}) => {
    const result = blueprintNodeDefaults(type); result.id = 'options_node_' + ++serial; Object.assign(result.properties, properties);
    result.x = 100 + serial % 5 * 360; result.y = 400 + Math.floor(serial / 5) * 240; owner.nodes.push(result); synchronizeBlueprintSignatures(project); return result;
  };
  const wire = (owner: BlueprintGraph, from: BlueprintNode, output: string, to: BlueprintNode, input: string) => assert.equal(connectBlueprintPins(owner, from.id, output, to.id, input), undefined);
  const next = (owner: BlueprintGraph, from: BlueprintNode, to: BlueprintNode) => { wire(owner, from, from.pins.find(pin => pin.direction === 'output' && pin.dataType === 'exec')!.id, to, 'exec_in'); return to; };
  const action = (name: typeof actions[number][0]) => ensureUiClickEvent(project, graph, 'option_act_' + name, page.id);
  const step = (previous: BlueprintNode, type: BlueprintNode['type'], properties: Record<string, VariableValue> = {}) => next(graph, previous, node(graph, type, properties));
  const observe = (previous: BlueprintNode) => {
    for (const [property, variableId] of [['optionCount', 'observed_count'], ['optionIndex', 'observed_index'], ['optionLabel', 'observed_label']] as [UiProperty, string][]) {
      const read = node(graph, 'getUiProperty', { componentId: 'choice', property }), store = node(graph, 'setVariable', { variableId });
      wire(graph, read, 'value', store, 'value'); previous = next(graph, previous, store);
    }
    return previous;
  };
  const operations: Record<string, BlueprintNode> = {};
  for (const [name, operation, properties] of [
    ['append', 'insert', { index: 2, label: '新增标签', value: '动态' }], ['rename', 'replace', { index: 0, label: '初始改名', value: '初始' }], ['remove', 'remove', { index: 0 }], ['move', 'move', { index: 0, toIndex: 1 }], ['clear', 'clear', {}], ['reset', 'reset', {}],
  ] as [typeof actions[number][0], string, Record<string, VariableValue>][]) {
    operations[name] = step(action(name), 'editUiControlOptions', { componentId: 'choice', operation, valueType: 'string', ...properties }); observe(operations[name]);
  }
  for (const [name, writeMode] of [['override', 'override'], ['source', 'source']] as const) observe(step(action(name), 'setUiProperty', { componentId: 'choice', property: 'optionIndex', value: 2, writeMode }));
  observe(step(action('whole'), 'resetUiComponent', { componentId: 'choice' }));
  step(action('readonly'), 'setUiProperty', { componentId: 'choice', property: 'readOnly', value: true });
  step(action('child'), 'showUiPage', { pageId: child.id, wait: true });
  step(action('native'), 'showUiPage', { pageId: 'ui:preferences', wait: true });
  const reader = node(graph, 'getUiControlOption', { componentId: 'choice', valueType: 'string', index: 0 });
  let readTail = observe(action('observe'));
  for (const [pin, variableId] of [['found', 'read_found'], ['label', 'read_label'], ['value', 'read_value']]) {
    const store = node(graph, 'setVariable', { variableId }); wire(graph, reader, pin, store, 'value'); readTail = next(graph, readTail, store);
  }
  const nativeGraph = createUiEventGraph(project, 'ui:preferences', '模板独立选项');
  for (const componentId of ['choice', 'mirror', 'boolean_choice', 'number_choice']) {
    const owner = preferenceChoices.some(component => component.id === componentId) ? nativeGraph : graph;
    const ownerPage = owner === nativeGraph ? 'ui:preferences' : page.id;
    const event = ensureUiValueChangedEvent(project, owner, componentId, ownerPage), read = node(owner, 'getVariable', { variableId: 'changed_count' }), add = node(owner, 'math', { operation: 'add', b: 1 }), store = node(owner, 'setVariable', { variableId: 'changed_count' });
    wire(owner, read, 'value', add, 'a'); wire(owner, add, 'result', store, 'value'); next(owner, event, store);
  }
  const childGraph = createUiEventGraph(project, child.id, '子页独立选项');
  next(childGraph, ensureUiClickEvent(project, childGraph, 'child_append', child.id), node(childGraph, 'editUiControlOptions', { componentId: 'child_choice', operation: 'insert', valueType: 'string', index: 2, label: '子页新增', value: '子页' }));
  next(nativeGraph, ensureUiClickEvent(project, nativeGraph, 'native_append', 'ui:preferences'), node(nativeGraph, 'editUiControlOptions', { componentId: 'native_choice', operation: 'insert', valueType: 'boolean', index: 2, label: '另一只跳已读', value: false }));
  const background = createBlueprintGraph('function', '后台编辑选项'); project.blueprints.push(background);
  const job = next(background, background.nodes[0], node(background, 'editUiControlOptions', { componentId: 'choice', operation: 'insert', index: 2, valueType: 'string', label: '后台新增', value: '任务' }));
  next(background, job, node(background, 'setVariable', { variableId: 'job_done', value: true }));
  step(action('background'), 'startTask', { graphId: background.id, scope: 'page', pageId: page.id, seconds: .2, conflict: 'parallel' });
  const openGraph = createBlueprintGraph('function', '打开选项列表'); project.blueprints.push(openGraph);
  next(openGraph, openGraph.nodes[0], node(openGraph, 'showUiPage', { pageId: page.id, wait: true }));
  const passage = project.nodes.find(item => item.kind === 'passage'); if (!passage || passage.kind !== 'passage') throw new Error('Missing passage');
  passage.lines[0].text = '选项列表页面已关闭。'; passage.lines[0].actions = [{ kind: 'blueprint', blueprintId: openGraph.id }];
  const editGraph = createBlueprintGraph('function', '选项字段创作'); project.blueprints.push(editGraph);
  const editorEdit = node(editGraph, 'editUiControlOptions', { componentId: 'choice', operation: 'insert', valueType: 'string', index: 0, value: '原值', label: '原标签' });
  const editorLiteral = node(editGraph, 'literal', { type: 'string', value: '外部标签' }); editorLiteral.pins[0].dataType = 'string';
  wire(editGraph, editorLiteral, editorLiteral.pins[0].id, editorEdit, 'label');
  const editorRead = node(editGraph, 'getUiControlOption', { componentId: 'choice', valueType: 'string', index: 0 });
  editorLiteral.x = 80; editorLiteral.y = 80; editorEdit.x = 450; editorEdit.y = 80; editorRead.x = 880; editorRead.y = 80;
  synchronizeBlueprintSignatures(project);
  return { project, page, child, graph, childGraph, nativeGraph, background, openGraph, editGraph, operations, reader, editorEdit, editorRead, editorLiteral, node, wire, next };
}
