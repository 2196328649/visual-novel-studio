import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, uiComponentSchema, type UiComponent } from '../src/core/model';
import { changeUiControlBinding, uiControlBindingName, uiControlKindName } from '../src/core/ui-control-authoring';
import { uiControlDefinition } from '../src/core/ui-control-properties';
import { mutateProject } from '../src/core/project-mutation';

function fixture() {
  const project = createProject('设置绑定编辑');
  project.variables.push(
    { id: 'number_source', name: '亮度', type: 'number', initial: 50, persistent: false, setting: { min: 0, max: 100, step: 1 } },
    { id: 'other_number', name: '另一个范围', type: 'number', initial: 80, persistent: false, setting: { min: -100, max: 200, step: 5 } },
    { id: 'text_source', name: '玩家名字', type: 'string', initial: '小明', persistent: false },
    { id: 'option_source', name: '难度', type: 'string', initial: '普通', persistent: false, setting: { options: ['简单', '普通', '困难'] } },
    { id: 'toggle_source', name: '开关', type: 'boolean', initial: false, persistent: false },
    { id: 'image_source', name: '封面', type: 'asset', assetKind: 'image', initial: '', persistent: false },
  );
  const component: UiComponent = { id: 'control', kind: 'preferenceChoice', page: 'preferences', text: '', preference: 'musicVolume', controlRange: { min: .1, max: .9, step: .05 },
    selector: { options: [{ label: '大', value: .8 }], arrowId: 'arrow', popupBackgroundId: 'panel' },
    slider: { trackColor: '#223344', thumbWidth: 28, reverse: true }, input: { placeholder: '请输入名字', maxLength: 24 },
    x: .1, y: .1, width: .4, height: .1 };
  project.ui.components.push(component);
  return { project, component };
}

test('binding descriptions follow the real input mode and expose missing sources', () => {
  const { project, component } = fixture();
  assert.equal(uiControlKindName(project, component), '下拉菜单');
  for (const [id, mode] of [['number_source', '滑条'], ['text_source', '文字输入框'], ['option_source', '选项组'], ['toggle_source', '开关']]) {
    changeUiControlBinding(project, component, 'parameter:' + id);
    assert.equal(uiControlKindName(project, component), mode);
    assert.equal(uiControlBindingName(project, component), project.variables.find(variable => variable.id === id)!.name);
  }
  component.parameterId = 'deleted_parameter';
  component.preference = 'musicVolume';
  assert.equal(uiControlDefinition(project, component), undefined);
  assert.equal(uiControlBindingName(project, component), '参数已删除', '失效 ID 不能假装为音乐音量');
  component.parameterId = 'image_source';
  assert.match(uiControlBindingName(project, component), /类型不适用/);
  delete component.parameterId; delete component.preference;
  assert.equal(uiControlBindingName(project, component), '尚未绑定');
});

test('changing a number binding to text clears only incompatible range in one reversible transaction', () => {
  const { project, component } = fixture();
  changeUiControlBinding(project, component, 'parameter:number_source');
  const before = structuredClone(project);
  const after = mutateProject(project, draft => changeUiControlBinding(draft, draft.ui.components.find(item => item.id === component.id)!, 'parameter:text_source'));
  const changed = after.ui.components.find(item => item.id === component.id)!;
  assert.equal(changed.controlRange, undefined);
  assert.equal(changed.parameterId, 'text_source');
  assert.deepEqual(changed.slider, component.slider);
  assert.deepEqual(changed.selector, component.selector, '暂不适用的选项皮肤保留');
  assert.deepEqual(changed.input, component.input);
  assert.deepEqual(project, before, '撤销只需恢复一次事务前快照');
  assert.ok(uiComponentSchema.safeParse(changed).success);
});

test('numeric binding switches retain valid custom ranges and clear engine-incompatible ranges', () => {
  const { project, component } = fixture();
  changeUiControlBinding(project, component, 'parameter:number_source');
  component.controlRange = { min: -15, max: 180, step: .25 };
  changeUiControlBinding(project, component, 'parameter:other_number');
  assert.deepEqual(component.controlRange, { min: -15, max: 180, step: .25 });
  changeUiControlBinding(project, component, 'musicVolume');
  assert.equal(component.controlRange, undefined, '玩家音量必须遵守引擎0～1边界');
  assert.equal(component.parameterId, undefined);
  assert.ok(uiComponentSchema.safeParse(component).success);
});

test('switching option sources keeps applicable labels and inactive dropdown contents', () => {
  const { project, component } = fixture();
  project.playerDefaults = { voiceSustain: true };
  const originalSelector = structuredClone(component.selector);
  changeUiControlBinding(project, component, 'soundVolume');
  assert.deepEqual(component.selector, originalSelector, '同类型同边界的设置换源保留作者选项和标签');
  changeUiControlBinding(project, component, 'parameter:option_source');
  assert.deepEqual(uiControlDefinition(project, component)?.options.map(item => item.value), ['简单', '普通', '困难']);
  assert.deepEqual(component.selector, originalSelector, '参数选项来自参数源，不覆写休眠的下拉内容');
  assert.equal(component.selector?.arrowId, 'arrow');
  assert.equal(component.selector?.popupBackgroundId, 'panel');
  changeUiControlBinding(project, component, 'voiceSustain');
  assert.equal(component.controlRange, undefined);
  assert.equal(component.preferenceValue, true, '新的设置值沿用工程玩家初始值');
  assert.deepEqual(component.selector?.options.map(item => item.value), [true, false]);
  assert.equal(component.selector?.arrowId, 'arrow');
  assert.ok(uiComponentSchema.safeParse(component).success);
  component.selector!.options = [{ label: '继续播放', value: true }, { label: '停止播放', value: false }];
  const toggles = structuredClone(component.selector);
  changeUiControlBinding(project, component, 'fullscreen');
  assert.deepEqual(component.selector, toggles, '可用开关选项也保留自定义文案');
  changeUiControlBinding(project, component, 'textSpeed');
  component.selector!.options = [{ label: '非常快', value: 120 }];
  changeUiControlBinding(project, component, 'musicVolume');
  assert.ok(component.selector!.options.every(option => typeof option.value === 'number' && option.value >= 0 && option.value <= 1), '超出新设置引擎边界的旧选项整体重建');
});

test('invalid binding transitions do not leave partial source or presentation changes', () => {
  const { project, component } = fixture();
  for (const binding of ['parameter:missing', 'parameter:image_source', 'unknown_preference']) {
    const before = structuredClone(component);
    assert.throws(() => changeUiControlBinding(project, component, binding));
    assert.deepEqual(component, before);
  }
  component.kind = 'preference';
  const sliderBefore = structuredClone(component);
  assert.throws(() => changeUiControlBinding(project, component, 'fullscreen'), /数值/);
  assert.deepEqual(component, sliderBefore);
  component.page = 'custom';
  assert.throws(() => changeUiControlBinding(project, component, 'soundVolume'), /设置或角色音量/);
  component.kind = 'button'; component.action = 'setPlayerPreference';
  const buttonBefore = structuredClone(component);
  assert.throws(() => changeUiControlBinding(project, component, 'parameter:number_source'), /有效/);
  assert.deepEqual(component, buttonBefore);
});
