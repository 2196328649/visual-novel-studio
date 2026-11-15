import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprintNodeDefaults, createBlueprintGraph } from '../src/core/blueprint';
import { createProject, effectiveUiComponents, projectSchema, uiComponentLimit, type Project, type UiComponent, type UiPropertyControl, type Variable, type VariableValue } from '../src/core/model';
import { changeParameterKind, parameterUsages, removeParameter } from '../src/core/parameter-usages';
import { mutateProject } from '../src/core/project-mutation';
import { addProjectGraphs, graphResourceKey, projectGraphs } from '../src/core/project-resources';
import { createUiParameterBinding } from '../src/core/ui-logic';
import { listUiParameterBindings } from '../src/core/ui-parameter-links';
import { setUiPropertyControl, uiPropertyControlCandidates, uiPropertyControlChange, uiPropertyControlFor, uiPropertyControlKey, uiPropertyControlProblem, uiPropertyControlProblems, uiPropertyControlSourceProblem } from '../src/core/ui-property-control';
import type { UiProperty } from '../src/core/ui-properties';
import { validateProject } from '../src/core/validate';

function fixture(owner: 'base' | 'scheme' | 'custom' = 'base') {
  const project = createProject('属性控制契约'), pageId = owner === 'custom' ? 'custom_page' : 'ui:main';
  const component: UiComponent = { id: 'controlled_title', kind: 'text', page: owner === 'custom' ? 'custom' : 'main', text: '保留原文', x: .1, y: .2, width: .4, height: .1,
    style: { opacity: .7, fontSize: 32 }, visibleWhen: { kind: 'compare', variableId: 'visible_source', operator: 'eq', value: false } };
  project.variables.push({ id: 'visible_source', name: '显示开关', type: 'boolean', initial: false, persistent: false },
    { id: 'other_visible', name: '另一开关', type: 'boolean', initial: true, persistent: true },
    { id: 'alpha', name: '透明度', type: 'number', initial: 0, persistent: false },
    { id: 'caption', name: '关联文字', type: 'string', initial: '', persistent: false });
  if (owner === 'custom') project.ui.customPages.push({ id: pageId, name: '独立页面', modal: true, components: [component] });
  else if (owner === 'scheme') {
    project.ui.instances = [{ id: 'owner', name: '父方案', components: [component] }];
    project.ui.activeInstanceId = 'owner';
  } else project.ui.components.push(component);
  return { project, component, pageId };
}

const link = (parameterId: string, mode: UiPropertyControl['mode'] = 'follow'): UiPropertyControl => ({ mode, parameterId });
function source(project: Project, id: string, type: Variable['type'], initial: VariableValue, extra: Partial<Variable> = {}) {
  const parameter: Variable = { id, name: id, type, initial, persistent: false, ...extra };
  project.variables.push(parameter);
  return parameter;
}
function numberControl(project: Project, id = 'slider'): UiComponent {
  if (!project.variables.some(variable => variable.id === 'original_value')) source(project, 'original_value', 'number', 30, { setting: { min: 0, max: 100, step: 1 } });
  const component: UiComponent = { id, page: 'main', kind: 'preference', parameterId: 'original_value', text: '音量', x: .1, y: .4, width: .4, height: .1, controlRange: { min: 20, max: 40, step: 1 } };
  project.ui.components.push(component);
  return component;
}

test('property control records round trip on every owner and preserve unavailable property IDs', () => {
  for (const owner of ['base', 'scheme', 'custom'] as const) {
    const { project, component, pageId } = fixture(owner);
    component.propertyControls = { visible: link('visible_source'), futureProperty: link('caption', 'sync') };
    const parsed = projectSchema.parse(JSON.parse(JSON.stringify(project)));
    const stored = owner === 'custom' ? parsed.ui.customPages[0].components[0] : effectiveUiComponents(parsed.ui)[0];
    assert.deepEqual(stored.propertyControls, component.propertyControls);
    assert.deepEqual(uiPropertyControlProblems(parsed, stored), [{ property: 'futureProperty', message: '此属性尚不受支持，原关联已保留：futureProperty' }]);
    const originalVisible = stored.propertyControls!.visible;
    setUiPropertyControl(parsed, stored.id, pageId, 'futureProperty' as UiProperty);
    assert.deepEqual(stored.propertyControls, { visible: originalVisible });
  }
});

test('default, follow and sync transitions preserve defaults and system sources without creating graphs', () => {
  for (const owner of ['base', 'scheme', 'custom'] as const) {
    const { project, component, pageId } = fixture(owner), before = structuredClone(project);
    for (const [property, parameterId] of [['visible', 'visible_source'], ['opacity', 'alpha'], ['text', 'caption']] as const) {
      setUiPropertyControl(project, component.id, pageId, property, link(parameterId));
      assert.deepEqual(uiPropertyControlFor(project, component, property), { property, control: link(parameterId) });
      setUiPropertyControl(project, component.id, pageId, property, link(parameterId, 'sync'));
      assert.equal(uiPropertyControlFor(project, component, property)?.control.mode, 'sync');
      setUiPropertyControl(project, component.id, pageId, property);
      assert.equal(Object.hasOwn(component, 'propertyControls'), false);
    }
    assert.deepEqual(project, before, '切换来源不能改写false、0、空文字、原样式或条件');
  }
  const { project } = fixture(), slider = numberControl(project), original = structuredClone(slider);
  source(project, 'linked_value', 'number', 35);
  setUiPropertyControl(project, slider.id, 'ui:main', 'numberValue', link('linked_value', 'sync'));
  assert.equal(slider.parameterId, 'original_value');
  setUiPropertyControl(project, slider.id, 'ui:main', 'numberValue');
  assert.deepEqual(slider, original);
  assert.equal(projectGraphs(project).length, 0);
});

test('value aliases share one source and explicit repair clears conflicts without touching unrelated controls', () => {
  const { project } = fixture(), slider = numberControl(project);
  source(project, 'linked_value', 'number', 90);
  setUiPropertyControl(project, slider.id, 'ui:main', 'normalizedValue', link('linked_value'));
  assert.deepEqual(slider.propertyControls, { numberValue: link('linked_value') });
  assert.equal(uiPropertyControlKey(project, slider, 'normalizedValue'), 'numberValue');
  assert.strictEqual(uiPropertyControlFor(project, slider, 'normalizedValue')?.control, slider.propertyControls!.numberValue);
  slider.propertyControls = { normalizedValue: link('linked_value'), opacity: link('alpha') };
  const beforeRead = structuredClone(slider);
  assert.equal(uiPropertyControlFor(project, slider, 'numberValue')?.control.parameterId, 'linked_value');
  assert.deepEqual(uiPropertyControlProblems(project, slider), []);
  assert.deepEqual(slider, beforeRead, '读取别名不可迁移或重写旧记录');
  slider.propertyControls.numberValue = link('original_value', 'sync');
  assert.equal(uiPropertyControlFor(project, slider, 'normalizedValue')?.control.parameterId, 'original_value');
  assert.match(uiPropertyControlSourceProblem(project, slider, 'numberValue', link('original_value', 'sync'))!, /多项/);
  setUiPropertyControl(project, slider.id, 'ui:main', 'normalizedValue', link('linked_value', 'sync'));
  assert.deepEqual(slider.propertyControls, { opacity: link('alpha'), numberValue: link('linked_value', 'sync') });
  slider.propertyControls = { stringValue: link('linked_value') };
  assert.match(uiPropertyControlSourceProblem(project, slider, 'numberValue', link('linked_value'))!, /不适用/);
  const invalid = structuredClone(project);
  assert.throws(() => setUiPropertyControl(project, slider.id, 'ui:main', 'stringValue', link('linked_value')), /不支持/);
  assert.deepEqual(project, invalid);
});

test('choice indices select the current-value source type instead of creating an independent index binding', () => {
  const { project } = fixture();
  source(project, 'choice_definition', 'string', '普通', { setting: { options: ['简单', '普通', '困难'] } });
  source(project, 'choice_value', 'string', '困难');
  const choice: UiComponent = { id: 'choice', kind: 'preferenceChoice', page: 'main', text: '', x: 0, y: 0, width: .5, height: .1, parameterId: 'choice_definition' };
  project.ui.components.push(choice);
  assert.ok(uiPropertyControlCandidates(project, choice, 'optionIndex').some(parameter => parameter.id === 'choice_value'));
  assert.ok(uiPropertyControlCandidates(project, choice, 'optionIndex').every(parameter => parameter.type === 'string'));
  setUiPropertyControl(project, choice.id, 'ui:main', 'optionIndex', link('choice_value', 'sync'));
  assert.deepEqual(choice.propertyControls, { stringValue: link('choice_value', 'sync') });
  assert.match(uiPropertyControlProblem(project, choice, 'stringValue', link('caption'))!, /当前选项/);
});

test('source metadata is independent from current values while authoring enforces property contracts', () => {
  const { project, component } = fixture();
  source(project, 'bad_alpha', 'number', 2);
  source(project, 'bad_color', 'string', 'red');
  source(project, 'bad_font_size', 'number', 12.5);
  assert.equal(uiPropertyControlSourceProblem(project, component, 'opacity', link('bad_alpha')), undefined);
  assert.match(uiPropertyControlProblem(project, component, 'opacity', link('bad_alpha'))!, /范围/);
  assert.match(uiPropertyControlProblem(project, component, 'textColor', link('bad_color'))!, /RGB/);
  assert.match(uiPropertyControlProblem(project, component, 'fontSize', link('bad_font_size'))!, /范围/);
  assert.ok(uiPropertyControlCandidates(project, component, 'opacity').some(parameter => parameter.id === 'bad_alpha'), '无效初值仍应可见并解释原因');
  assert.match(uiPropertyControlSourceProblem(project, component, 'visible', link('alpha'))!, /类型/);
  assert.match(uiPropertyControlSourceProblem(project, component, 'screenX', link('alpha'))!, /不支持/);
  assert.match(uiPropertyControlSourceProblem(project, component, 'enabled', link('visible_source'))!, /不支持/);
  assert.match(uiPropertyControlSourceProblem(project, component, 'visible', link('missing'))!, /已删除/);
  assert.match(uiPropertyControlSourceProblem(project, component, 'visible', { mode: 'unknown', parameterId: 'visible_source' } as unknown as UiPropertyControl)!, /无效/);
  assert.match(uiPropertyControlSourceProblem(project, component, 'visible', link(''))!, /请选择/);
  assert.deepEqual(uiPropertyControlCandidates(project, component, 'font'), []);
  assert.deepEqual(uiPropertyControlCandidates(project, component, 'futureProperty' as UiProperty), []);
});

test('resource links match asset kind, allow empty values and preserve the original asset source', () => {
  const { project } = fixture();
  project.assets.push({ id: 'picture', name: '图片', kind: 'image', path: 'assets/picture.png' }, { id: 'sound', name: '声音', kind: 'audio', path: 'assets/sound.ogg' });
  source(project, 'original_picture', 'asset', 'picture');
  source(project, 'empty_picture', 'asset', '', { assetKind: 'image' });
  source(project, 'bad_picture', 'asset', 'sound', { assetKind: 'image' });
  source(project, 'audio_source', 'asset', 'sound', { assetKind: 'audio' });
  const picture: UiComponent = { id: 'picture_control', kind: 'image', page: 'main', text: '', x: 0, y: 0, width: .5, height: .5, assetId: 'picture', assetParameterId: 'original_picture' };
  project.ui.components.push(picture);
  assert.deepEqual(uiPropertyControlCandidates(project, picture, 'image').map(parameter => parameter.id), ['original_picture', 'empty_picture', 'bad_picture']);
  assert.match(uiPropertyControlProblem(project, picture, 'image', link('bad_picture'))!, /素材缺失或类型/);
  assert.match(uiPropertyControlSourceProblem(project, picture, 'image', link('audio_source'))!, /类型/);
  const original = structuredClone(picture);
  setUiPropertyControl(project, picture.id, 'ui:main', 'image', link('empty_picture', 'sync'));
  assert.equal(picture.assetId, 'picture'); assert.equal(picture.assetParameterId, 'original_picture');
  setUiPropertyControl(project, picture.id, 'ui:main', 'image');
  assert.deepEqual(picture, original);
});

test('slider sources retain out-of-range values and linked ranges validate as a complete set', () => {
  const { project } = fixture(), slider = numberControl(project);
  source(project, 'outside', 'number', 90);
  source(project, 'new_min', 'number', 50);
  source(project, 'new_max', 'number', 100);
  source(project, 'invalid_step', 'number', 0);
  assert.equal(uiPropertyControlProblem(project, slider, 'numberValue', link('outside')), undefined);
  assert.match(uiPropertyControlProblem(project, slider, 'minimum', link('new_min'))!, /下限不能大于上限/);
  setUiPropertyControl(project, slider.id, 'ui:main', 'maximum', link('new_max'));
  setUiPropertyControl(project, slider.id, 'ui:main', 'minimum', link('new_min'));
  setUiPropertyControl(project, slider.id, 'ui:main', 'numberValue', link('outside', 'sync'));
  assert.deepEqual(uiPropertyControlProblems(project, slider), []);
  assert.deepEqual(slider.controlRange, { min: 20, max: 40, step: 1 });
  assert.equal(project.variables.find(parameter => parameter.id === 'outside')!.initial, 90);
  assert.match(uiPropertyControlProblem(project, slider, 'step', link('invalid_step'))!, /步长必须大于/);
  const choice: UiComponent = { ...slider, id: 'native_choice', kind: 'preferenceChoice', parameterId: undefined, preference: 'musicVolume', controlRange: undefined,
    propertyControls: undefined, selector: { options: [{ label: '中', value: .5 }, { label: '高', value: .8 }] } };
  source(project, 'missing_option', 'number', .6);
  assert.match(uiPropertyControlProblem(project, choice, 'numberValue', link('missing_option'))!, /当前选项/);
});

test('linked input lengths use Unicode characters and the initial linked length limit', () => {
  const { project } = fixture();
  source(project, 'input_definition', 'string', '');
  source(project, 'input_value', 'string', '😀中文');
  source(project, 'length_limit', 'number', 3);
  const input: UiComponent = { id: 'text_input', page: 'main', kind: 'preferenceChoice', text: '', x: 0, y: 0, width: .5, height: .1, parameterId: 'input_definition', input: { maxLength: 1 } };
  project.ui.components.push(input);
  assert.match(uiPropertyControlProblem(project, input, 'stringValue', link('input_value'))!, /文字长度/);
  setUiPropertyControl(project, input.id, 'ui:main', 'maxLength', link('length_limit'));
  setUiPropertyControl(project, input.id, 'ui:main', 'stringValue', link('input_value', 'sync'));
  assert.deepEqual(uiPropertyControlProblems(project, input), []);
  assert.equal(input.input!.maxLength, 1);
});

test('linking or shrinking an input length limit rejects a newly broken value binding before making an inherited override', () => {
  for (const mode of ['follow', 'sync'] as const) {
    const { project, pageId } = fixture();
    source(project, 'input_definition', 'string', '');
    source(project, 'input_value', 'string', '😀中文');
    source(project, 'short_limit', 'number', 2);
    source(project, 'exact_limit', 'number', 3);
    const input: UiComponent = { id: 'text_input', kind: 'preferenceChoice', page: 'main', text: '', x: 0, y: 0, width: .5, height: .1,
      parameterId: 'input_definition', input: { maxLength: 200 }, propertyControls: { stringValue: link('input_value', mode) } };
    project.ui.components.push(input);
    project.ui.instances = [{ id: 'inherited', name: '继承方案', components: [] }]; project.ui.activeInstanceId = 'inherited';
    const before = structuredClone(project), prepared = uiPropertyControlChange(project, input, 'maxLength', link('short_limit'));
    assert.match(prepared.problem!, /当前文字|当前值|文字值/);
    assert.match(prepared.problem!, /文字长度/);
    assert.deepEqual(project, before, '对话框预检应为只读');
    assert.throws(() => setUiPropertyControl(project, input.id, pageId, 'maxLength', link('short_limit')), /文字长度/);
    assert.deepEqual(project, before, '拒绝后不能生成继承覆盖或改写参数');
    assert.equal(uiPropertyControlChange(project, input, 'maxLength', link('exact_limit')).problem, undefined, '三个Unicode字符正好可容纳');
    setUiPropertyControl(project, input.id, pageId, 'maxLength', link('exact_limit'));
    const editable = effectiveUiComponents(project.ui).find(item => item.id === input.id)!;
    assert.deepEqual(uiPropertyControlProblems(project, editable), []);
    const exact = structuredClone(project);
    assert.throws(() => setUiPropertyControl(project, input.id, pageId, 'maxLength', link('short_limit')), /文字长度/);
    assert.deepEqual(project, exact);
  }
});

test('restoring an input length default cannot silently break a previously valid linked value', () => {
  const { project, pageId } = fixture();
  source(project, 'input_definition', 'string', ''); source(project, 'input_value', 'string', '你好呀'); source(project, 'length_limit', 'number', 3);
  const input: UiComponent = { id: 'text_input', kind: 'preferenceChoice', page: 'main', text: '', x: 0, y: 0, width: .5, height: .1,
    parameterId: 'input_definition', input: { maxLength: 1 }, propertyControls: { stringValue: link('input_value'), maxLength: link('length_limit') } };
  project.ui.components.push(input);
  const before = structuredClone(project);
  assert.match(uiPropertyControlChange(project, input, 'maxLength').problem!, /文字长度/);
  assert.throws(() => setUiPropertyControl(project, input.id, pageId, 'maxLength'), /文字长度/);
  assert.deepEqual(project, before);
  setUiPropertyControl(project, input.id, pageId, 'stringValue');
  setUiPropertyControl(project, input.id, pageId, 'maxLength');
  assert.equal(input.propertyControls, undefined, '作者先解除当前值关联后可恢复原长度');
  assert.equal(project.variables.find(variable => variable.id === 'input_value')!.initial, '你好呀');
});

test('other invalid associations stay repairable and existing length overflow may improve without being made worse', () => {
  const { project, pageId } = fixture();
  source(project, 'input_definition', 'string', ''); source(project, 'input_value', 'string', '😀中文');
  source(project, 'short_limit', 'number', 0); source(project, 'better_limit', 'number', 2); source(project, 'valid_limit', 'number', 3);
  const input: UiComponent = { id: 'text_input', kind: 'preferenceChoice', page: 'main', text: '', x: 0, y: 0, width: .5, height: .1,
    parameterId: 'input_definition', input: { maxLength: 1 }, propertyControls: { stringValue: link('input_value'), visible: link('missing'), futureProperty: link('caption') } };
  project.ui.components.push(input);
  assert.equal(uiPropertyControlChange(project, input, 'maxLength', link('better_limit')).problem, undefined, '已有超限从2字缩小为1字，可逐步修复');
  setUiPropertyControl(project, input.id, pageId, 'maxLength', link('better_limit'));
  const improved = structuredClone(project);
  assert.throws(() => setUiPropertyControl(project, input.id, pageId, 'maxLength', link('short_limit')), /文字长度/);
  assert.throws(() => setUiPropertyControl(project, input.id, pageId, 'maxLength'), /文字长度/);
  assert.deepEqual(project, improved);
  setUiPropertyControl(project, input.id, pageId, 'visible', link('visible_source'));
  setUiPropertyControl(project, input.id, pageId, 'futureProperty' as UiProperty);
  assert.deepEqual(uiPropertyControlProblems(project, input).map(problem => problem.property), ['stringValue'], '无关缺失参数与旧字段可独立修复');
  setUiPropertyControl(project, input.id, pageId, 'maxLength', link('valid_limit'));
  assert.deepEqual(uiPropertyControlProblems(project, input), []);
  input.input!.maxLength = 5;
  input.propertyControls!.maxLength = link('better_limit');
  assert.match(uiPropertyControlProblems(project, input)[0].message, /文字长度/);
  setUiPropertyControl(project, input.id, pageId, 'maxLength');
  assert.deepEqual(uiPropertyControlProblems(project, input), [], '恢复足够长的默认值可修复已有超限');
});

test('restoring one linked range endpoint checks the remaining valid associations before removing any timers', () => {
  const { project, pageId } = fixture(), slider = numberControl(project);
  source(project, 'linked_minimum', 'number', 50); source(project, 'linked_maximum', 'number', 100);
  setUiPropertyControl(project, slider.id, pageId, 'maximum', link('linked_maximum'));
  setUiPropertyControl(project, slider.id, pageId, 'minimum', link('linked_minimum'));
  const timer = createUiParameterBinding(project, slider.id, 'maximum', 'linked_maximum', pageId);
  assert.equal(listUiParameterBindings(project, slider.id, pageId).find(binding => binding.graphId === timer.id)?.managed, true);
  const before = structuredClone(project);
  assert.match(uiPropertyControlChange(project, slider, 'maximum').problem!, /下限不能大于上限/);
  assert.throws(() => setUiPropertyControl(project, slider.id, pageId, 'maximum'), /下限不能大于上限/);
  assert.deepEqual(project, before);
  setUiPropertyControl(project, slider.id, pageId, 'minimum');
  setUiPropertyControl(project, slider.id, pageId, 'maximum');
  assert.equal(slider.propertyControls, undefined);
  assert.equal(projectGraphs(project).length, 0);
});

test('read and no-op edits preserve identity; rejected inherited edits do not create overrides', () => {
  const { project, component, pageId } = fixture('scheme');
  component.propertyControls = { visible: link('visible_source') };
  project.ui.instances!.push({ id: 'derived', name: '子方案', baseUiId: 'owner', components: [] });
  project.ui.activeInstanceId = 'derived';
  const original = structuredClone(project);
  assert.deepEqual(uiPropertyControlFor(project, component, 'visible'), { property: 'visible', control: link('visible_source') });
  uiPropertyControlCandidates(project, component, 'visible'); uiPropertyControlProblems(project, component);
  assert.deepEqual(project, original);
  assert.strictEqual(mutateProject(project, draft => setUiPropertyControl(draft, component.id, pageId, 'visible', link('visible_source'))), project);
  for (const [id, page, property, control] of [
    [component.id, pageId, 'visible', link('alpha')],
    [component.id, pageId, 'futureProperty', link('caption')],
    [component.id, 'ui:save', 'visible', link('visible_source')],
    ['missing', pageId, 'visible', link('visible_source')],
  ] as const) assert.throws(() => setUiPropertyControl(project, id, page, property as UiProperty, control));
  assert.deepEqual(project, original);
  const changed = mutateProject(project, draft => setUiPropertyControl(draft, component.id, pageId, 'visible', link('other_visible', 'sync')));
  assert.deepEqual(project, original);
  assert.equal(project.ui.instances![1].components.length, 0);
  assert.equal(changed.ui.instances![1].components.length, 1);
  assert.deepEqual(changed.ui.instances![0].components[0], component);
  assert.equal(changed.ui.instances![1].components[0].propertyControls!.visible.parameterId, 'other_visible');
  assert.deepEqual(changed.ui.instances![1].components[0].visibleWhen, component.visibleWhen);
});

test('missing active schemes, wrong custom pages and full inheritance overrides reject atomically', () => {
  const { project, component, pageId } = fixture('scheme');
  project.ui.activeInstanceId = 'missing';
  const missing = structuredClone(project);
  assert.throws(() => setUiPropertyControl(project, component.id, pageId, 'visible', link('visible_source')), /方案/);
  assert.deepEqual(project, missing);
  project.ui.instances!.push({ id: 'full', name: '已满', baseUiId: 'owner', components: Array.from({ length: uiComponentLimit }, (_, index) => ({ ...component, id: 'filled_' + index })) });
  project.ui.activeInstanceId = 'full';
  const full = structuredClone(project);
  assert.throws(() => setUiPropertyControl(project, component.id, pageId, 'visible', link('visible_source')), /数量已达上限/);
  assert.deepEqual(project, full);
  const custom = fixture('custom'), before = structuredClone(custom.project);
  custom.project.ui.customPages.push({ id: 'other_page', name: '另一页', modal: false, components: [] });
  assert.throws(() => setUiPropertyControl(custom.project, custom.component.id, 'other_page', 'visible', link('visible_source')), /不属于当前页面/);
  assert.deepEqual(custom.project.ui.customPages[0], before.ui.customPages[0]);
});

test('explicit control edits replace only owned automatic timers, with undo preserving the whole old graph', () => {
  for (const owner of ['base', 'scheme', 'custom'] as const) {
    const { project, component, pageId } = fixture(owner);
    const graph = createUiParameterBinding(project, component.id, 'visible', 'visible_source', pageId);
    const keep = createUiParameterBinding(project, component.id, 'opacity', 'alpha', pageId);
    project.contentBrowser = { folders: [], assignments: {}, favorites: [graphResourceKey(graph), graphResourceKey(keep)] };
    const before = structuredClone(project);
    uiPropertyControlFor(project, component, 'visible'); uiPropertyControlProblems(project, component);
    assert.deepEqual(project, before, '旧联动不可在读取时被自动迁移');
    assert.throws(() => setUiPropertyControl(project, component.id, pageId, 'visible', link('alpha')), /类型/);
    assert.deepEqual(project, before, '失败换源不可先删除旧图');
    const changed = mutateProject(project, draft => setUiPropertyControl(draft, component.id, pageId, 'visible', link('other_visible', 'sync')));
    assert.deepEqual(project, before, '撤销快照保留原联动和默认值');
    assert.deepEqual(projectGraphs(changed).map(item => item.id), [keep.id]);
    assert.deepEqual(changed.contentBrowser!.favorites, [graphResourceKey(keep)]);
    assert.deepEqual(changed.variables, before.variables);
    assert.deepEqual(projectGraphs(changed)[0], keep);
  }
});

test('restoring default explicitly detaches managed timers but keeps custom, shared, inherited and called graphs', () => {
  const ordinary = fixture();
  createUiParameterBinding(ordinary.project, ordinary.component.id, 'visible', 'visible_source', ordinary.pageId);
  setUiPropertyControl(ordinary.project, ordinary.component.id, ordinary.pageId, 'visible');
  assert.equal(projectGraphs(ordinary.project).length, 0);
  assert.equal(Object.hasOwn(ordinary.component, 'propertyControls'), false);
  for (const kind of ['customized', 'shared', 'inherited', 'called'] as const) {
    const { project, component, pageId } = fixture('scheme');
    const graph = createUiParameterBinding(project, component.id, 'visible', 'visible_source', pageId);
    if (kind === 'customized') graph.nodes.push(blueprintNodeDefaults('comment'));
    if (kind === 'shared') delete graph.uiInstanceId;
    if (kind === 'inherited') { project.ui.instances!.push({ id: 'child', name: '子方案', baseUiId: 'owner', components: [] }); project.ui.activeInstanceId = 'child'; }
    if (kind === 'called') {
      const caller = createBlueprintGraph('function', '保留调用者'), call = blueprintNodeDefaults('callFunction');
      call.properties.graphId = graph.id; caller.nodes.push(call); addProjectGraphs(project, caller);
    }
    assert.equal(listUiParameterBindings(project, component.id, pageId)[0].managed, false, kind);
    const graphs = structuredClone(projectGraphs(project));
    setUiPropertyControl(project, component.id, pageId, 'visible', link('other_visible'));
    assert.deepEqual(projectGraphs(project), graphs, kind);
    setUiPropertyControl(project, component.id, pageId, 'visible');
    assert.deepEqual(projectGraphs(project), graphs, kind);
  }
});

test('parameter references include each property and owned definition, including inactive and custom pages', () => {
  const { project, component } = fixture();
  component.propertyControls = { visible: link('visible_source') };
  project.ui.instances = [{ id: 'inactive', name: '未激活方案', components: [{ ...structuredClone(component), id: 'inactive_title' }] },
    { id: 'child', name: '继承方案', baseUiId: 'inactive', components: [] }];
  project.ui.customPages = [{ id: 'custom_page', name: '独立页面', modal: true, components: [{ ...structuredClone(component), id: 'custom_title', page: 'custom' }] }];
  const links = parameterUsages(project, 'visible_source').filter(usage => usage.key.endsWith(':property:visible'));
  assert.equal(links.length, 3, '继承引用定位到实际拥有记录的方案，不能重复创建覆盖');
  assert.ok(links.every(usage => usage.label.includes('属性关联：显示')));
  assert.deepEqual(links.map(usage => usage.location), [
    { kind: 'ui', target: { page: 'main', componentId: component.id } },
    { kind: 'ui', target: { page: 'main', instanceId: 'inactive', componentId: 'inactive_title' } },
    { kind: 'ui', target: { page: 'custom', customPageId: 'custom_page', componentId: 'custom_title' } },
  ]);
  const before = structuredClone(project);
  assert.throws(() => removeParameter(project, 'visible_source', 'alpha'), /同类型/);
  assert.deepEqual(project, before);
  removeParameter(project, 'visible_source', 'other_visible');
  assert.equal(parameterUsages(project, 'visible_source').length, 0);
  assert.equal(parameterUsages(project, 'other_visible').filter(usage => usage.key.endsWith(':property:visible')).length, 3);
  assert.equal(project.ui.instances[1].components.length, 0);
  for (const item of [component, project.ui.instances[0].components[0], project.ui.customPages[0].components[0]]) {
    assert.deepEqual(item.propertyControls, { visible: link('other_visible') });
    assert.deepEqual(item.visibleWhen, { kind: 'compare', variableId: 'other_visible', operator: 'eq', value: false });
  }
});

test('deleted or retyped sources keep repairable records and component-owner diagnostics', () => {
  for (const owner of ['base', 'scheme', 'custom'] as const) for (const operation of ['delete', 'retype'] as const) {
    const { project, component } = fixture(owner);
    component.propertyControls = { visible: link('visible_source') };
    if (operation === 'delete') removeParameter(project, 'visible_source');
    else changeParameterKind(project, 'visible_source', 'number');
    const original = structuredClone(component.propertyControls);
    const issues = validateProject(project).filter(issue => issue.code === 'ui.property-control.source');
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, 'error');
    assert.match(issues[0].message, operation === 'delete' ? /已删除/ : /类型/);
    assert.deepEqual(issues[0].ui, { page: component.page, componentId: component.id, ...(owner === 'scheme' ? { instanceId: 'owner' } : owner === 'custom' ? { customPageId: 'custom_page' } : {}) });
    assert.deepEqual(component.propertyControls, original);
  }
});
