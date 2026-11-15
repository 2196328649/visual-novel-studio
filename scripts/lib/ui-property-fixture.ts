import assert from 'node:assert/strict';
import { createProject, type BlueprintGraph, type BlueprintNode, type CustomUiPage, type UiComponent, type VariableValue } from '../../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createUiEventGraph, ensureUiButtonEvent, ensureUiClickEvent } from '../../src/core/ui-logic';
import { uiProperties, type UiProperty } from '../../src/core/ui-properties';

export const ordinaryPropertyCases: readonly { target: string; property: UiProperty; value: VariableValue }[] = [
  { target: 'caption', property: 'textColor', value: '#27c1e9' },
  { target: 'caption', property: 'hoverTextColor', value: '#f040d0' },
  { target: 'caption', property: 'selectedTextColor', value: '#aacc55' },
  { target: 'caption', property: 'disabledTextColor', value: '#888899' },
  { target: 'caption', property: 'outlineWidth', value: 2 },
  { target: 'caption', property: 'outlineOpacity', value: .4 },
  { target: 'caption', property: 'shadowBlur', value: 4 },
  { target: 'caption', property: 'shadowOpacity', value: .25 },
  { target: 'caption', property: 'shadowX', value: 3 },
  { target: 'caption', property: 'shadowY', value: 4 },
  { target: 'caption', property: 'shadowColor', value: '#d05070' },
  { target: 'frame', property: 'background', value: '#12223380' },
  { target: 'frame', property: 'borderWidth', value: 6 },
  { target: 'frame', property: 'borderColor', value: '#45aa55' },
  { target: 'bottom', property: 'background', value: '#ccb822' },
  { target: 'bottom', property: 'pressedBackground', value: '#a044bb' },
  { target: 'bottom', property: 'selectedBackground', value: '#40aa55' },
  { target: 'bottom', property: 'disabledBackground', value: '#303040' },
  { target: 'probe', property: 'borderWidth', value: 6 },
  { target: 'probe', property: 'borderColor', value: '#a0bbcc' },
  { target: 'probe', property: 'clickSound', value: 'click_tone' },
  { target: 'probe', property: 'hoverSound', value: 'click_tone' },
];

export function createUiPropertyFixture() {
  const project = createProject('普通控件属性验收'); project.id = 'ui_property_matrix'; project.width = 1280; project.height = 720;
  project.assets.push({ id: 'click_tone', name: '蓝图独占音效', kind: 'audio', path: 'assets/click.wav' }, { id: 'property_skin', name: '边框覆盖测试皮肤', kind: 'image', path: 'assets/property-skin.png', width: 8, height: 8 });
  const button = (id: string, text: string, x: number, y: number, width = .23, height = .095): UiComponent => ({ id, page: 'custom', kind: 'button', text, x, y, width, height });
  const page: CustomUiPage = { id: 'property_page', name: '普通控件属性', modal: true, background: '#121820', components: [
    { id: 'frame', page: 'custom', kind: 'panel', text: '', x: .1, y: .2, width: .6, height: .5, style: { background: '#243040' } },
    { id: 'caption', page: 'custom', kind: 'text', text: '层级 · 颜色 · 阴影', parentId: 'frame', x: .25, y: .2, width: .5, height: .5, style: { textColor: '#ddeeff', fontSize: 30 } },
    { id: 'decoration', page: 'custom', kind: 'panel', text: '', parentId: 'frame', childLayer: 'background', x: 0, y: 0, width: 1, height: 1, style: { background: '#fa6040' } },
    { ...button('apply', '应用属性', .74, .1), layer: 200 },
    { ...button('reset', '单项重置', .74, .22), layer: 201 },
    { ...button('swap', '交换层级', .74, .34), layer: 202 },
    { ...button('bottom', '原下层按钮', .13, .76, .32), layer: 20, style: { background: '#805033', hoverBackground: '#224466' } },
    { ...button('top', '原上层按钮', .13, .76, .32), layer: 21, style: { background: '#338055' } },
    { ...button('probe', '观察鼠标', .74, .59), layer: 203, skin: { idle: 'property_skin' } },
    { ...button('close', '关闭页面', .74, .81), action: 'return', layer: 204 },
  ] };
  project.ui.customPages.push(page);
  const graph = createUiEventGraph(project, page.id, '普通属性事件');
  let serial = 0;
  const node = (owner: BlueprintGraph, type: BlueprintNode['type'], properties: Record<string, VariableValue> = {}) => {
    const result = blueprintNodeDefaults(type); result.id = 'property_node_' + (++serial); Object.assign(result.properties, properties);
    result.x = 500 + serial % 5 * 360; result.y = 100 + Math.floor(serial / 5) * 300; owner.nodes.push(result); synchronizeBlueprintSignatures(project); return result;
  };
  const wire = (owner: BlueprintGraph, from: BlueprintNode, out: string, to: BlueprintNode, input: string) => assert.equal(connectBlueprintPins(owner, from.id, out, to.id, input), undefined);
  const next = (owner: BlueprintGraph, from: BlueprintNode, to: BlueprintNode) => { wire(owner, from, from.pins.find(pin => pin.direction === 'output' && pin.dataType === 'exec')!.id, to, 'exec_in'); return to; };
  const write = (previous: BlueprintNode, componentId: string, property: UiProperty, value: VariableValue) => next(graph, previous, node(graph, 'setUiProperty', { componentId, property, value }));
  const record = (previous: BlueprintNode, componentId: string, property: UiProperty, variableId: string, design = false) => {
    const type = uiProperties[property].type;
    project.variables.push({ id: variableId, name: variableId, type, initial: type === 'number' ? -1 : type === 'boolean' ? true : 'unset', persistent: false });
    const get = node(graph, design ? 'getUiDefault' : 'getUiProperty', { componentId, property }), set = node(graph, 'setVariable', { variableId });
    synchronizeBlueprintSignatures(project);
    if (get.pins.find(pin => pin.id === 'value')?.dataType === 'asset') {
      // Resource references are typed pins, not implicitly interchangeable with text.
      const text = node(graph, 'formatText', { format: '{value}' });
      wire(graph, get, 'value', text, 'value'); wire(graph, text, 'text', set, 'value');
    } else wire(graph, get, 'value', set, 'value');
    return next(graph, previous, set);
  };
  let apply = ensureUiClickEvent(project, graph, 'apply', page.id);
  const records: { variableId: string; expected: VariableValue }[] = [];
  for (const [index, entry] of ordinaryPropertyCases.entries()) {
    apply = write(apply, entry.target, entry.property, entry.value);
    const variableId = 'property_value_' + index; apply = record(apply, entry.target, entry.property, variableId); records.push({ variableId, expected: entry.value });
  }
  apply = write(apply, 'frame', 'x', .2); apply = write(apply, 'frame', 'width', .4);
  for (const [property, variableId, expected, design] of [
    ['screenX', 'world_x', 384, false], ['screenY', 'world_y', 216, false], ['screenWidth', 'world_width', 256, false], ['screenHeight', 'world_height', 180, false],
    ['screenX', 'design_x', 320, true], ['screenWidth', 'design_width', 384, true], ['hoverBackground', 'authored_hover', '#224466', false],
  ] as const) { apply = record(apply, property === 'hoverBackground' ? 'bottom' : 'caption', property, variableId, design); records.push({ variableId, expected }); }
  let reset = ensureUiClickEvent(project, graph, 'reset', page.id);
  for (const [componentId, property] of [['caption', 'textColor'], ['frame', 'borderWidth'], ['bottom', 'layer']] as const) reset = next(graph, reset, node(graph, 'resetUiProperty', { componentId, property }));
  let swap = ensureUiClickEvent(project, graph, 'swap', page.id); swap = write(swap, 'bottom', 'layer', 100); swap = write(swap, 'decoration', 'layer', 9999);
  for (const id of ['bottom', 'top']) {
    const variableId = 'hits_' + id; project.variables.push({ id: variableId, name: variableId, type: 'number', initial: 0, persistent: false });
    const event = ensureUiClickEvent(project, graph, id, page.id), get = node(graph, 'getVariable', { variableId }), add = node(graph, 'math', { operation: 'add', b: 1 }), set = node(graph, 'setVariable', { variableId });
    synchronizeBlueprintSignatures(project); wire(graph, get, 'value', add, 'a'); wire(graph, add, 'result', set, 'value'); next(graph, event, set);
  }
  for (const [trigger, property, variableId] of [['hover', 'hovered', 'probe_hover'], ['unhover', 'hovered', 'probe_unhover'], ['press', 'pressed', 'probe_down'], ['release', 'pressed', 'probe_up']] as const) {
    record(ensureUiButtonEvent(project, graph, 'probe', page.id, trigger), 'probe', property, variableId);
    project.variables.find(variable => variable.id === variableId)!.initial = trigger !== 'hover' && trigger !== 'press';
  }
  const openGraph = createBlueprintGraph('function', '打开普通属性页面'); project.blueprints.push(openGraph);
  const open = node(openGraph, 'showUiPage', { pageId: page.id, wait: true }); next(openGraph, openGraph.nodes[0], open);
  const start = project.nodes.find(node => node.kind === 'passage')!; if (start.kind !== 'passage') throw new Error('Missing fixture passage');
  start.lines[0].text = '属性页面已关闭。'; start.lines[0].actions = [{ kind: 'blueprint', blueprintId: openGraph.id }];
  const editGraph = createBlueprintGraph('function', '属性字段编辑'); project.blueprints.push(editGraph);
  const editorSet = node(editGraph, 'setUiProperty', { componentId: 'caption', property: 'fontSize', value: 30 });
  const editorGet = node(editGraph, 'getUiProperty', { componentId: 'caption', property: 'screenX' });
  const editorReset = node(editGraph, 'resetUiProperty', { componentId: 'caption', property: 'textColor' });
  for (const [index, item] of [editorSet, editorGet, editorReset].entries()) Object.assign(item, { x: 60 + index * 440, y: 350 });
  synchronizeBlueprintSignatures(project);
  return { project, page, graph, records, editGraph, editorSet, editorGet, editorReset };
}

/** Short local PCM clip: no remote downloads or existing user assets needed. */
export function uiPropertyFixtureTone(): Buffer {
  const samples = 2205, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(22050, 24); bytes.writeUInt32LE(44100, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) bytes.writeInt16LE(Math.round(Math.sin(index * Math.PI * 2 * 660 / 22050) * 3000), 44 + index * 2);
  return bytes;
}

export { uiFixturePng as uiPropertyFixturePng } from './ui-fixture-image';
