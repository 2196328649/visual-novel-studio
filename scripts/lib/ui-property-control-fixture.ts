import assert from 'node:assert/strict';
import { createProject, type BlueprintGraph, type BlueprintNode, type UiComponent, type VariableValue } from '../../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createUiEventGraph, createUiParameterBinding, ensureUiClickEvent, ensureUiTextCommittedEvent, ensureUiValueChangedEvent } from '../../src/core/ui-logic';
import type { UiProperty } from '../../src/core/ui-properties';

/** The same authored controls exercise the inspector, independent preview and Ren'Py.
 * Broken references and legacy migration examples belong to a separate editor-only page. */
export function createUiPropertyControlFixture(options: { editor?: boolean; runtimePersistent?: boolean } = {}) {
  const project = createProject('属性控制来源验收');
  project.id = 'ui_property_control'; project.width = 1280; project.height = 720;
  project.variables.push(
    { id: 'pc_number', name: '同步数值', type: 'number', initial: 30, persistent: false, setting: { min: 0, max: 100, step: 1 } },
    { id: 'pc_legacy_number', name: '保留的旧数值', type: 'number', initial: 10, persistent: false, setting: { min: 0, max: 100, step: 1 } },
    { id: 'pc_text', name: '同步输入文字', type: 'string', initial: '参数初值', persistent: false },
    { id: 'pc_legacy_name', name: '保留的旧姓名', type: 'string', initial: '旧姓名', persistent: false },
    { id: 'pc_caption', name: '同步标题', type: 'string', initial: '参数文字', persistent: false },
    { id: 'pc_flag', name: '同步开关', type: 'boolean', initial: true, persistent: false },
    { id: 'pc_choice', name: '同步选项', type: 'string', initial: '简单', persistent: false, setting: { options: ['简单', '困难', '旁观'] } },
    { id: 'pc_alpha', name: '同步透明度', type: 'number', initial: .4, persistent: false },
    { id: 'pc_visible', name: '显示标题', type: 'boolean', initial: true, persistent: false },
    { id: 'pc_position', name: '子对象横向位置', type: 'number', initial: .12, persistent: false },
    { id: 'pc_image', name: '同步图片', type: 'asset', assetKind: 'image', initial: 'pc_asset_a', persistent: false },
    { id: 'pc_changed_count', name: '玩家改值次数', type: 'number', initial: 0, persistent: false },
    { id: 'pc_commit_count', name: '玩家提交次数', type: 'number', initial: 0, persistent: false },
  );
  project.assets.push(
    { id: 'pc_asset_a', name: '参数图片甲', kind: 'image', path: 'assets/property-control-a.png', width: 8, height: 8 },
    { id: 'pc_asset_b', name: '参数图片乙', kind: 'image', path: 'assets/property-control-b.png', width: 8, height: 8 },
  );
  const text = (id: string, name: string, x: number, y: number, width = .4): UiComponent => ({ id, page: 'custom', kind: 'text', name, text: name, x, y, width, height: .075, style: { textColor: '#ffffff', fontSize: 25 } });
  const button = (id: string, name: string, x: number): UiComponent => ({ id, page: 'custom', kind: 'button', name, text: name, x, y: .86, width: .145, height: .09, style: { fontSize: 22 } });
  const components: UiComponent[] = [
    { id: 'pc_slider', page: 'custom', kind: 'preference', name: '双向数值', text: '双向数值', parameterId: 'pc_legacy_number', controlRange: { min: 0, max: 100, step: 1 }, x: .04, y: .08, width: .40, height: .10, propertyControls: { numberValue: { mode: 'sync', parameterId: 'pc_number' } } },
    { id: 'pc_slider_follow', page: 'custom', kind: 'preference', name: '单向数值', text: '单向数值', parameterId: 'pc_legacy_number', controlRange: { min: 0, max: 100, step: 1 }, x: .04, y: .25, width: .40, height: .10, propertyControls: { numberValue: { mode: 'follow', parameterId: 'pc_number' } } },
    { id: 'pc_clamped', page: 'custom', kind: 'preference', name: '仅显示20至40', text: '仅显示20至40', parameterId: 'pc_legacy_number', controlRange: { min: 20, max: 40, step: 1 }, x: .04, y: .42, width: .40, height: .10, propertyControls: { numberValue: { mode: 'follow', parameterId: 'pc_number' } } },
    { id: 'pc_input', page: 'custom', kind: 'preferenceChoice', name: '双向输入', text: '双向输入', parameterId: 'pc_legacy_name', input: { maxLength: 20, placeholder: '请输入' }, x: .52, y: .08, width: .42, height: .10, propertyControls: { stringValue: { mode: 'sync', parameterId: 'pc_text' } } },
    { id: 'pc_toggle', page: 'custom', kind: 'preferenceChoice', name: '双向开关', text: '双向开关', parameterId: 'pc_flag', x: .52, y: .24, width: .18, height: .08, propertyControls: { booleanValue: { mode: 'sync', parameterId: 'pc_flag' } } },
    { id: 'pc_choices', page: 'custom', kind: 'preferenceChoice', name: '双向选项', text: '双向选项', parameterId: 'pc_choice', x: .72, y: .24, width: .24, height: .09, propertyControls: { stringValue: { mode: 'sync', parameterId: 'pc_choice' } } },
    { ...text('pc_text_follow', '单向标题设计值', .52, .37, .2), propertyControls: { text: { mode: 'follow', parameterId: 'pc_caption' }, visible: { mode: 'follow', parameterId: 'pc_visible' } } },
    { id: 'pc_choices_follow', page: 'custom', kind: 'preferenceChoice', name: '单向选项', text: '单向选项', parameterId: 'pc_choice', x: .74, y: .36, width: .22, height: .09, propertyControls: { stringValue: { mode: 'follow', parameterId: 'pc_choice' } } },
    { ...text('pc_text_sync', '双向标题设计值', .04, .57), propertyControls: { text: { mode: 'sync', parameterId: 'pc_caption' } } },
    { id: 'pc_parent', page: 'custom', kind: 'panel', name: '半透明父对象', text: '', x: .52, y: .48, width: .22, height: .15, style: { opacity: .5, background: '#425674' } },
    { ...text('pc_alpha_a', '动画甲', .05, .12, .8), parentId: 'pc_parent', height: .6, style: { opacity: .9, fontSize: 26 }, propertyControls: { opacity: { mode: 'sync', parameterId: 'pc_alpha' }, x: { mode: 'sync', parameterId: 'pc_position' } } },
    { ...text('pc_alpha_b', '动画乙', .77, .51, .18), style: { opacity: .8, fontSize: 26 }, propertyControls: { opacity: { mode: 'sync', parameterId: 'pc_alpha' } } },
    { ...text('pc_alpha_follow', '单向透明度', .52, .69, .23), style: { opacity: .7, fontSize: 22 }, propertyControls: { opacity: { mode: 'follow', parameterId: 'pc_alpha' } } },
    text('pc_default', '原始设计文字', .04, .69),
    { id: 'pc_image_control', page: 'custom', kind: 'image', name: '双向图片', text: '', assetId: 'pc_asset_b', x: .83, y: .66, width: .08, height: .12, propertyControls: { image: { mode: 'sync', parameterId: 'pc_image' } } },
    button('pc_program', '蓝图改属性', .01), button('pc_parameter', '蓝图改参数', .175), button('pc_reset', '重置临时值', .34),
    button('pc_anim_a', '动画甲→亮', .505), button('pc_anim_b', '动画乙→暗', .67), { ...button('pc_close', '关闭页面', .835), action: 'return' },
  ];
  if (options.runtimePersistent) {
    project.variables.push({ id: 'pc_persistent_alpha', name: '持久同步透明度', type: 'number', initial: .25, persistent: true, parameterSetId: 'parameters_game' });
    components.push(
      { ...text('pc_persist_a', '持久动画甲', .05, .78, .3), height: .055, style: { opacity: .9, fontSize: 20 }, propertyControls: { opacity: { mode: 'sync', parameterId: 'pc_persistent_alpha' } } },
      { ...text('pc_persist_b', '持久动画乙', .52, .78, .3), height: .055, style: { opacity: .8, fontSize: 20 }, propertyControls: { opacity: { mode: 'sync', parameterId: 'pc_persistent_alpha' } } },
    );
  }
  const page = { id: 'pc_page', name: '属性控制运行页', modal: true, background: '#172334', components };
  project.ui.customPages.push(page);
  const graph = createUiEventGraph(project, page.id, '属性控制运行');
  let serial = 0;
  const node = (owner: BlueprintGraph, type: BlueprintNode['type'], properties: Record<string, VariableValue> = {}) => {
    const created = blueprintNodeDefaults(type); created.id = 'pc_node_' + ++serial; Object.assign(created.properties, properties);
    created.x = 100 + serial % 6 * 370; created.y = 400 + Math.floor(serial / 6) * 250;
    owner.nodes.push(created); synchronizeBlueprintSignatures(project); return created;
  };
  const wire = (owner: BlueprintGraph, from: BlueprintNode, output: string, to: BlueprintNode, input: string) => assert.equal(connectBlueprintPins(owner, from.id, output, to.id, input), undefined);
  const next = (owner: BlueprintGraph, previous: BlueprintNode, following: BlueprintNode) => {
    wire(owner, previous, previous.pins.find(pin => pin.direction === 'output' && pin.dataType === 'exec')!.id, following, 'exec_in'); return following;
  };
  let program = ensureUiClickEvent(project, graph, 'pc_program', page.id);
  for (const [componentId, property, value] of [
    ['pc_slider', 'normalizedValue', .7], ['pc_input', 'stringValue', '蓝图输入'], ['pc_toggle', 'booleanValue', false], ['pc_choices', 'optionIndex', 1],
    ['pc_text_sync', 'text', '蓝图标题'], ['pc_alpha_a', 'opacity', .6], ['pc_default', 'text', '临时文字'], ['pc_image_control', 'image', 'pc_asset_b'],
  ] satisfies [string, UiProperty, VariableValue][]) program = next(graph, program, node(graph, 'setUiProperty', { componentId, property, value, writeMode: 'override' }));
  let parameters = ensureUiClickEvent(project, graph, 'pc_parameter', page.id);
  for (const [variableId, value] of [['pc_number', 90], ['pc_text', '参数更新'], ['pc_caption', '参数标题'], ['pc_alpha', .8], ['pc_flag', true]] satisfies [string, VariableValue][]) {
    parameters = next(graph, parameters, node(graph, 'setVariable', { variableId, value }));
  }
  let reset = ensureUiClickEvent(project, graph, 'pc_reset', page.id);
  for (const [componentId, property] of [['pc_slider', 'normalizedValue'], ['pc_input', 'stringValue'], ['pc_default', 'text'], ['pc_alpha_a', 'opacity'], ['pc_image_control', 'image']] satisfies [string, UiProperty][]) {
    reset = next(graph, reset, node(graph, 'resetUiProperty', { componentId, property }));
  }
  for (const [id, componentId, value, duration] of [['pc_anim_a', 'pc_alpha_a', .95, 1], ['pc_anim_b', 'pc_alpha_b', .15, .4]] as const) {
    const event = ensureUiClickEvent(project, graph, id, page.id);
    next(graph, event, node(graph, 'animateUiProperty', { componentId, property: 'opacity', value, duration, easing: 'linear', wait: false }));
  }
  const count = (event: BlueprintNode, variableId: string) => {
    const read = node(graph, 'getVariable', { variableId }), add = node(graph, 'math', { operation: 'add', b: 1 }), write = node(graph, 'setVariable', { variableId });
    wire(graph, read, 'value', add, 'a'); wire(graph, add, 'result', write, 'value'); next(graph, event, write);
  };
  for (const id of ['pc_slider', 'pc_slider_follow', 'pc_input', 'pc_toggle', 'pc_choices']) count(ensureUiValueChangedEvent(project, graph, id, page.id), 'pc_changed_count');
  count(ensureUiTextCommittedEvent(project, graph, 'pc_input', page.id), 'pc_commit_count');
  const open = createBlueprintGraph('function', '打开属性控制运行页'); project.blueprints.push(open);
  next(open, open.nodes[0], node(open, 'showUiPage', { pageId: page.id, wait: true }));
  const passage = project.nodes.find(item => item.kind === 'passage'); assert.ok(passage?.kind === 'passage');
  passage.lines[0].text = '属性控制页面已关闭。'; passage.lines[0].actions = [{ kind: 'blueprint', blueprintId: open.id }];

  let legacyGraph: BlueprintGraph | undefined, customGraph: BlueprintGraph | undefined;
  const authorPageId = 'pc_editor_page';
  if (options.editor) {
    project.ui.customPages.push({ id: authorPageId, name: '属性控制创作页', modal: true, background: '#24354a', components: [
      { ...text('pc_author', '设计原文', .05, .08), name: '属性设置样本', style: { opacity: .65, fontSize: 28 } },
      { ...text('pc_new', '新参数样本', .05, .24), style: { opacity: .8, fontSize: 28 } },
      text('pc_legacy_auto', '旧自动联动样本', .05, .4),
      text('pc_custom', '自定义蓝图样本', .05, .56),
      { ...text('pc_invalid', '失效来源样本', .54, .08), propertyControls: { opacity: { mode: 'follow', parameterId: 'pc_missing' } } },
      { ...text('pc_mismatch', '错误类型样本', .54, .24), propertyControls: { text: { mode: 'sync', parameterId: 'pc_number' } } },
    ] });
    legacyGraph = createUiParameterBinding(project, 'pc_legacy_auto', 'text', 'pc_caption', authorPageId);
    customGraph = createUiEventGraph(project, authorPageId, '应当保留的自定义图');
    next(customGraph, customGraph.nodes[0], node(customGraph, 'setUiProperty', { componentId: 'pc_custom', property: 'text', value: '自定义蓝图文字', writeMode: 'override' }));
  }
  synchronizeBlueprintSignatures(project);
  return { project, page, graph, firstPassageId: passage.id, authorPageId, legacyGraph, customGraph };
}

export { uiFixturePng as uiPropertyControlFixturePng } from './ui-fixture-image';
