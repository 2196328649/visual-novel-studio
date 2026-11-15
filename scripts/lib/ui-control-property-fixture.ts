import assert from 'node:assert/strict';
import { createProject, type BlueprintGraph, type BlueprintNode, type UiComponent, type VariableValue } from '../../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createUiEventGraph, ensureUiClickEvent, ensureUiValueChangedEvent, ensureUiTextCommittedEvent } from '../../src/core/ui-logic';
import { uiProperties, type UiProperty } from '../../src/core/ui-properties';

export function createUiControlPropertyFixture() {
  const project = createProject('控件有效值与输入属性'); project.id = 'control_properties'; project.width = 1280; project.height = 720;
  project.variables.push(
    { id: 'shared_number', name: '共享数值', type: 'number', initial: 30, persistent: false, setting: { min: -20, max: 80, step: 5 } },
    { id: 'input_name', name: '输入文字', type: 'string', initial: '原值', persistent: false },
    { id: 'control_flag', name: '玩家开关', type: 'boolean', initial: true, persistent: true },
    { id: 'control_mode', name: '模式', type: 'string', initial: '简单', persistent: false, setting: { options: ['简单', '困难', '旁观'] } },
    { id: 'changed_count', name: '用户改值次数', type: 'number', initial: 0, persistent: false },
    { id: 'committed_count', name: '用户提交次数', type: 'number', initial: 0, persistent: false },
  );
  project.assets.push({ id: 'control_track', name: '蓝图独占轨道', kind: 'image', path: 'assets/control-track.png', width: 8, height: 8 });
  const button = (id: string, text: string, x: number, y = .72, width = .18): UiComponent => ({ id, page: 'custom', kind: 'button', text, x, y, width, height: .09 });
  const components: UiComponent[] = [
    { id: 'slider', page: 'custom', kind: 'preference', text: '共享滑条 A', parameterId: 'shared_number', x: .05, y: .16, width: .41, height: .12 },
    { id: 'mirror', page: 'custom', kind: 'preference', text: '共享滑条 B', parameterId: 'shared_number', x: .05, y: .35, width: .41, height: .12 },
    { id: 'input', page: 'custom', kind: 'preferenceChoice', text: '名字', parameterId: 'input_name', input: { placeholder: '请输入名字', maxLength: 6 }, x: .53, y: .16, width: .40, height: .13 },
    { id: 'toggle', page: 'custom', kind: 'preferenceChoice', text: '开关', parameterId: 'control_flag', x: .53, y: .35, width: .30, height: .09 },
    { id: 'choices', page: 'custom', kind: 'preferenceChoice', text: '模式', parameterId: 'control_mode', x: .53, y: .49, width: .40, height: .12 },
    button('temporary', '临时覆盖', .03), button('source', '修改绑定源', .23), button('reset', '重置值覆盖', .43), button('lock', '锁定/解锁输入', .63, .72, .22),
    { ...button('close', '关闭页面', .80, .88, .15), action: 'return' },
  ];
  const page = { id: 'control_page', name: '控件值属性', modal: true, background: '#16212b', components }; project.ui.customPages.push(page);
  const graph = createUiEventGraph(project, page.id, '控件值测试'); let serial = 0;
  const node = (owner: BlueprintGraph, type: BlueprintNode['type'], properties: Record<string, VariableValue> = {}) => {
    const result = blueprintNodeDefaults(type); result.id = 'control_property_' + ++serial; Object.assign(result.properties, properties);
    result.x = 100 + serial % 5 * 400; result.y = 400 + Math.floor(serial / 5) * 260; owner.nodes.push(result); synchronizeBlueprintSignatures(project); return result;
  };
  const wire = (owner: BlueprintGraph, from: BlueprintNode, output: string, to: BlueprintNode, input: string) => assert.equal(connectBlueprintPins(owner, from.id, output, to.id, input), undefined);
  const next = (owner: BlueprintGraph, from: BlueprintNode, to: BlueprintNode) => { wire(owner, from, from.pins.find(pin => pin.direction === 'output' && pin.dataType === 'exec')!.id, to, 'exec_in'); return to; };
  const write = (previous: BlueprintNode, componentId: string, property: UiProperty, value: VariableValue, writeMode = 'override') => next(graph, previous, node(graph, 'setUiProperty', { componentId, property, value, writeMode }));
  const record = (previous: BlueprintNode, componentId: string, property: UiProperty, variableId: string, design = false) => {
    const type = uiProperties[property].type;
    if (!project.variables.some(variable => variable.id === variableId)) project.variables.push({ id: variableId, name: variableId, type, initial: type === 'number' ? -1 : type === 'boolean' ? true : 'unset', persistent: false });
    const get = node(graph, design ? 'getUiDefault' : 'getUiProperty', { componentId, property }), set = node(graph, 'setVariable', { variableId });
    synchronizeBlueprintSignatures(project); wire(graph, get, 'value', set, 'value'); return next(graph, previous, set);
  };
  let temporary = ensureUiClickEvent(project, graph, 'temporary', page.id);
  temporary = write(temporary, 'slider', 'numberValue', 0);
  const temporaryNode = temporary;
  for (const [componentId, property, value] of [
    ['input', 'stringValue', ''], ['toggle', 'booleanValue', false], ['choices', 'optionIndex', 1],
    ['input', 'placeholder', '蓝图占位 🦊'], ['input', 'maxLength', 4], ['slider', 'sliderTrackImage', 'control_track'],
    ['slider', 'sliderFillColor', '#dd7722'], ['slider', 'sliderThumbColor', '#aaccee'], ['slider', 'sliderThumbWidth', 40], ['slider', 'sliderReverse', true],
  ] as const) temporary = write(temporary, componentId, property, value);
  let source = ensureUiClickEvent(project, graph, 'source', page.id);
  source = write(source, 'slider', 'normalizedValue', .8, 'source');
  source = write(source, 'input', 'stringValue', '源🦊', 'source');
  source = write(source, 'toggle', 'booleanValue', false, 'source');
  source = write(source, 'choices', 'optionIndex', 2, 'source');
  for (const [componentId, property, variableId, design] of [
    ['slider', 'numberValue', 'read_number', false], ['slider', 'normalizedValue', 'read_ratio', false], ['slider', 'minimum', 'read_min', false], ['slider', 'maximum', 'read_max', false], ['slider', 'step', 'read_step', false],
    ['choices', 'optionIndex', 'read_index', false], ['choices', 'optionCount', 'read_count', false], ['choices', 'optionLabel', 'read_label', false], ['input', 'stringValue', 'read_default', true],
  ] as const) source = record(source, componentId, property, variableId, design);
  let reset = ensureUiClickEvent(project, graph, 'reset', page.id);
  for (const [componentId, property] of [['slider', 'normalizedValue'], ['input', 'stringValue'], ['toggle', 'booleanValue'], ['choices', 'optionIndex']] as const) reset = next(graph, reset, node(graph, 'resetUiProperty', { componentId, property }));
  let lock = ensureUiClickEvent(project, graph, 'lock', page.id);
  for (const componentId of ['slider', 'input', 'toggle', 'choices']) {
    const get = node(graph, 'getUiProperty', { componentId, property: 'readOnly' }), invert = node(graph, 'not'), set = node(graph, 'setUiProperty', { componentId, property: 'readOnly' });
    wire(graph, get, 'value', invert, 'a'); wire(graph, invert, 'result', set, 'value'); lock = next(graph, lock, set);
  }
  const count = (event: BlueprintNode, variableId: string) => {
    const get = node(graph, 'getVariable', { variableId }), add = node(graph, 'math', { operation: 'add', b: 1 }), set = node(graph, 'setVariable', { variableId });
    wire(graph, get, 'value', add, 'a'); wire(graph, add, 'result', set, 'value'); next(graph, event, set);
  };
  for (const id of ['slider', 'mirror', 'input', 'toggle', 'choices']) count(ensureUiValueChangedEvent(project, graph, id, page.id), 'changed_count');
  count(ensureUiTextCommittedEvent(project, graph, 'input', page.id), 'committed_count');
  const openGraph = createBlueprintGraph('function', '打开控件属性页面'); project.blueprints.push(openGraph);
  next(openGraph, openGraph.nodes[0], node(openGraph, 'showUiPage', { pageId: page.id, wait: true }));
  const passage = project.nodes.find(item => item.kind === 'passage'); if (!passage || passage.kind !== 'passage') throw new Error('Missing passage');
  passage.lines[0].text = '控件属性页面已关闭。'; passage.lines[0].actions = [{ kind: 'blueprint', blueprintId: openGraph.id }];
  const editGraph = createBlueprintGraph('function', '控件值字段创作'); project.blueprints.push(editGraph);
  const editorSet = node(editGraph, 'setUiProperty', { componentId: 'slider', property: 'numberValue', value: 0 });
  const editorGet = node(editGraph, 'getUiProperty', { componentId: 'input', property: 'focused' });
  editorSet.x = 100; editorSet.y = 320; editorGet.x = 640; editorGet.y = 320;
  synchronizeBlueprintSignatures(project);
  return { project, page, graph, temporaryNode, editGraph, editorSet, editorGet };
}

export { uiFixturePng as uiControlPropertyFixturePng } from './ui-fixture-image';
