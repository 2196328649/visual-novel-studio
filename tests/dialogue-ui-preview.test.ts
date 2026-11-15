import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type Project, type UiComponent, type VariableValue } from '../src/core/model';
import { resolveDialogueUi } from '../src/core/dialogue-ui-preview';
import { resolveUiHierarchy } from '../src/core/ui-hierarchy';
import { uiPropertyControlSnapshot } from '../src/core/ui-property-control-snapshot';

const object = (id: string, patch: Partial<UiComponent> = {}): UiComponent => ({ id, name: id, kind: 'text', page: 'say', text: '文字', x: .1, y: .2, width: .3, height: .1, ...patch });
const linked = (parameterId: string) => ({ mode: 'follow' as const, parameterId });
const equals = (variableId: string, value: VariableValue = true) => ({ kind: 'compare' as const, variableId, operator: 'eq' as const, value });
function scene() {
  const project = createProject('对白界面'); project.width = 1000; project.height = 500;
  project.variables = [
    { id: 'shown', name: '显示', type: 'boolean', initial: true, persistent: false },
    { id: 'enabled', name: '启用', type: 'boolean', initial: true, persistent: false },
    { id: 'selected', name: '选中', type: 'boolean', initial: false, persistent: false },
    { id: 'condition', name: '条件', type: 'boolean', initial: true, persistent: false },
    { id: 'caption', name: '文字', type: 'string', initial: '参数文字', persistent: false },
    { id: 'width', name: '宽度', type: 'number', initial: .5, persistent: false },
    { id: 'alpha', name: '透明度', type: 'number', initial: .2, persistent: false },
  ];
  return project;
}
function preview(project: Project, components: UiComponent[], values: Record<string, VariableValue>, hover?: string) {
  return resolveDialogueUi(project, components.map(component => uiPropertyControlSnapshot(project, component, values)), values, hover);
}

test('dialogue state uses current links before conditions, with disabled then selected then hover priority', () => {
  const project = scene(), button = object('button', { kind: 'button', disabled: true, tooltip: '原提示', visibleWhen: equals('condition', false), enabledWhen: equals('condition', false), selectedWhen: equals('condition'), propertyControls: {
    visible: linked('shown'), enabled: linked('enabled'), selected: linked('selected'), tooltip: linked('caption'),
  } });
  const values = { shown: true, enabled: true, selected: false, condition: true, caption: '当前提示' };
  const hover = preview(project, [button], values, 'button');
  assert.equal(hover.rows[0].visible, true); assert.equal(hover.rows[0].state, 'hover'); assert.equal(hover.tooltip, '当前提示');
  assert.equal(preview(project, [button], { ...values, selected: true }, 'button').rows[0].state, 'selected');
  const disabled = preview(project, [button], { ...values, selected: true, enabled: false }, 'button');
  assert.equal(disabled.rows[0].state, 'disabled'); assert.equal(disabled.tooltip, '');
  const hidden = preview(project, [button], { ...values, shown: false }, 'button');
  assert.equal(hidden.rows[0].visible, false); assert.equal(hidden.tooltip, '');
});

test('missing or invalid links preserve authored conditions and disabled pages cannot be reenabled', () => {
  const project = scene(), button = object('button', { kind: 'button', visibleWhen: equals('condition'), enabledWhen: equals('enabled'), selectedWhen: equals('selected'), propertyControls: {
    visible: linked('missing'), enabled: linked('caption'), selected: linked('selected'),
  } });
  const values = { condition: true, enabled: false, selected: 'invalid' };
  assert.equal(preview(project, [button], values, 'button').rows[0].state, 'disabled');
  assert.equal(preview(project, [button], { ...values, condition: false }).rows[0].visible, false);
  button.selectedWhen = equals('condition');
  assert.equal(preview(project, [button], { ...values, enabled: true }, 'button').rows[0].state, 'selected');
  project.ui.disabledPages = ['preferences'];
  const unavailable = object('settings', { kind: 'button', action: 'preferences', propertyControls: { enabled: linked('enabled') } });
  assert.equal(preview(project, [unavailable], { enabled: true }, 'settings').rows[0].state, 'disabled');
});

test('parent links update child position, opacity and visibility in the same hierarchy', () => {
  const project = scene(); project.playerDefaults = { dialogueOpacity: .5 };
  const components = [object('parent', { kind: 'panel', x: .1, y: .2, width: .2, height: .5, style: { opacity: 1, playerOpacity: true }, propertyControls: {
    width: linked('width'), opacity: linked('alpha'), visible: linked('shown'),
  } }), object('child', { parentId: 'parent', x: .2, y: .1, width: .5, height: .2, style: { opacity: .8 } })];
  const before = structuredClone(components), values = { width: .6, alpha: .6, shown: true };
  const result = preview(project, components, values), child = result.rows.find(row => row.component.id === 'child')!;
  assert.ok(Math.abs(child.component.x - .22) < 1e-9); assert.ok(Math.abs(child.component.width - .3) < 1e-9);
  assert.ok(Math.abs(child.component.style!.opacity! - .24) < 1e-9); assert.equal(child.visible, true);
  assert.equal(preview(project, components, { ...values, shown: false }).rows.find(row => row.component.id === 'child')!.visible, false);
  assert.deepEqual(components, before);
});

test('parameter-disabled parent state reaches children even when a child is independently enabled', () => {
  const project = scene(), components = [object('parent', { kind: 'button', propertyControls: { enabled: linked('enabled'), selected: linked('selected') } }), object('child', { kind: 'button', parentId: 'parent', propertyControls: { enabled: linked('shown') } })];
  const result = preview(project, components, { enabled: false, shown: true, selected: true }, 'child');
  assert.ok(result.rows.every(row => row.state === 'disabled')); assert.equal(result.tooltip, '');
});

test('unlinked dialogue geometry retains the original hierarchy and bound text replacement is private', () => {
  const project = scene(), components = [object('parent', { kind: 'panel', layout: { version: 1, rotation: 15, scaleX: -1, pivotX: .5 } }), object('child', { parentId: 'parent', binding: 'dialogue' })];
  const original = resolveUiHierarchy(components, { viewport: project });
  assert.deepEqual(preview(project, components, {}).rows, original);
  const authored = object('dialogue', { binding: 'dialogue', propertyControls: { text: linked('caption') } });
  const snapshot = uiPropertyControlSnapshot(project, authored, { caption: '替换台词' });
  assert.equal(snapshot.component.binding, undefined); assert.equal(snapshot.component.text, '替换台词');
  assert.equal(authored.binding, 'dialogue'); assert.equal(authored.text, '文字');
});

test('dialogue controls show current parameter values or property overrides without writing them', () => {
  const project = scene();
  project.variables.push({ id: 'source', name: '原值', type: 'number', initial: 10, persistent: false }, { id: 'override', name: '关联值', type: 'number', initial: 20, persistent: false });
  const components = [object('plain', { kind: 'preference', parameterId: 'source', controlRange: { min: 0, max: 100, step: 1 } }), object('linked', { kind: 'preference', parameterId: 'source', controlRange: { min: 0, max: 100, step: 1 }, propertyControls: { numberValue: linked('override') } }), object('switch', { kind: 'preference', parameterId: 'shown' })];
  const values = { source: 35, override: 150, shown: false }, before = structuredClone({ project, components, values });
  const result = preview(project, components, values);
  assert.equal(result.controlValues.get('plain'), 35); assert.equal(result.controlValues.get('linked'), 100); assert.equal(result.controlValues.get('switch'), false);
  assert.equal(result.rows.find(row => row.component.id === 'linked')!.state, 'disabled');
  assert.deepEqual({ project, components, values }, before);
});

test('invalid current choice or text values do not reappear through the base preference fallback', () => {
  const project = scene();
  project.variables.push(
    { id: 'choiceSource', name: '选项', type: 'string', initial: '甲', persistent: false, setting: { options: ['甲', '乙'] } },
    { id: 'textSource', name: '输入', type: 'string', initial: '初始', persistent: false },
  );
  const components = [
    object('choice', { kind: 'preference', parameterId: 'choiceSource' }),
    object('text', { kind: 'preference', parameterId: 'textSource', input: { maxLength: 2 } }),
  ];
  const invalid = preview(project, components, { choiceSource: '丙', textSource: '超过上限' });
  assert.equal(invalid.controlValues.get('choice'), '甲');
  assert.equal(invalid.controlValues.get('text'), '初始');
  const valid = preview(project, components, { choiceSource: '乙', textSource: '好' });
  assert.equal(valid.controlValues.get('choice'), '乙');
  assert.equal(valid.controlValues.get('text'), '好');
});

test('invalid control sources cannot reintroduce nonfinite or mistyped display values after property validation', () => {
  const project = scene();
  project.variables.push({ id: 'source', name: '值', type: 'number', initial: 25, persistent: false });
  const component = object('slider', { kind: 'preference', parameterId: 'source', controlRange: { min: 0, max: 100, step: 1 }, propertyControls: { numberValue: linked('source') } });
  assert.equal(preview(project, [component], { source: NaN }).controlValues.get('slider'), 25);
  assert.equal(preview(project, [component], { source: '错误值' }).controlValues.get('slider'), 25);
  project.variables.find(variable => variable.id === 'source')!.initial = NaN;
  assert.equal(preview(project, [component], { source: 60 }).controlValues.get('slider'), 60);
  assert.equal(preview(project, [component], { source: NaN }).controlValues.get('slider'), 0);
});
