import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiPropertyControlFixture } from '../scripts/lib/ui-property-control-fixture';
import { blueprintNodeDefaults, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { ensureUiClickEvent } from '../src/core/ui-logic';
import { addUiAnimationTrack, createUiAnimationClip } from '../src/core/ui-animation-clips';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import type { BlueprintNode, UiComponent, VariableValue } from '../src/core/model';

type Fixture = ReturnType<typeof createUiPropertyControlFixture>;
const click = (componentId: string): UiPreviewEvent => ({ kind: 'click', componentId });
const advance = (seconds: number): UiPreviewEvent => ({ kind: 'advance', seconds });
const sample = (fixture: Fixture, events: UiPreviewEvent[] = [], values: Record<string, VariableValue> = {}) => previewUiLogic(fixture.project, fixture.page.components, fixture.page.id, values, events, { timed: true, trace: true });
const control = (fixture: Fixture, id: string) => fixture.page.components.find(component => component.id === id)!;
const row = (result: ReturnType<typeof sample>, id: string) => result.components.find(entry => entry.component.id === id)!;
const closeTo = (actual: unknown, expected: number) => assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 1e-9, `${String(actual)} != ${expected}`);

function action(fixture: Fixture, buttonId: string, type: BlueprintNode['type'], properties: BlueprintNode['properties']) {
  const button: UiComponent = { id: buttonId, page: 'custom', kind: 'button', text: buttonId, x: .01, y: .01, width: .1, height: .05 };
  fixture.page.components.push(button);
  const event = ensureUiClickEvent(fixture.project, fixture.graph, button.id, fixture.page.id);
  const node = blueprintNodeDefaults(type); Object.assign(node.properties, properties); fixture.graph.nodes.push(node);
  synchronizeBlueprintSignatures(fixture.project);
  assert.equal(connectBlueprintPins(fixture.graph, event.id, 'exec', node.id, 'exec_in'), undefined);
  return node;
}

test('property sources are immediate and leave authored defaults, inherited opacity and legacy parameters intact', () => {
  const fixture = createUiPropertyControlFixture(), before = structuredClone(fixture.project);
  control(fixture, 'pc_text_sync').binding = 'title';
  const expected = structuredClone(fixture.project), result = sample(fixture);
  assert.equal(result.incomplete, false);
  assert.equal(result.controlValues.pc_slider, 30); assert.equal(result.controlValues.pc_input, '参数初值');
  assert.equal(row(result, 'pc_text_sync').component.text, '参数文字');
  assert.equal(row(result, 'pc_text_sync').component.binding, undefined);
  assert.equal(row(result, 'pc_image_control').component.assetId, 'pc_asset_a');
  assert.equal(row(result, 'pc_alpha_a').component.style?.opacity, .2);
  assert.equal(result.variables.pc_alpha, .4); assert.equal(result.variables.pc_position, .12);
  assert.equal(result.variables.pc_legacy_number, 10); assert.equal(result.variables.pc_legacy_name, '旧姓名');
  assert.deepEqual(fixture.project, expected);
  assert.equal(before.ui.customPages[0].components.find(component => component.id === 'pc_text_sync')!.text, '双向标题设计值');
});

test('sync blueprint writes resolve ratio and option aliases and refresh all readers without user events', () => {
  const fixture = createUiPropertyControlFixture(), result = sample(fixture, [click('pc_program')]);
  assert.equal(result.incomplete, false);
  assert.equal(result.variables.pc_number, 70); assert.equal(result.controlValues.pc_slider, 70); assert.equal(result.controlValues.pc_slider_follow, 70);
  assert.equal(result.controlValues.pc_clamped, 40); assert.equal(result.variables.pc_choice, '困难');
  assert.equal(result.variables.pc_caption, '蓝图标题'); assert.equal(row(result, 'pc_text_follow').component.text, '蓝图标题');
  assert.equal(result.variables.pc_text, '蓝图输入'); assert.equal(result.variables.pc_flag, false);
  assert.equal(result.variables.pc_image, 'pc_asset_b'); assert.equal(result.imageRequests.pc_image_control.assetId, 'pc_asset_b');
  assert.equal(result.variables.pc_changed_count, 0); assert.equal(result.variables.pc_commit_count, 0);
  assert.equal(result.variables.pc_legacy_number, 10); assert.equal(result.variables.pc_legacy_name, '旧姓名');
});

test('player input writes a sync source once while follow blocks input and focus without changing other properties', () => {
  const fixture = createUiPropertyControlFixture();
  control(fixture, 'pc_input').propertyControls!.stringValue.mode = 'follow';
  action(fixture, 'paint', 'setUiProperty', { componentId: 'pc_slider_follow', property: 'sliderFillColor', value: '#ee8822' });
  const result = sample(fixture, [
    { kind: 'control', componentId: 'pc_slider_follow', value: 90 },
    { kind: 'control', componentId: 'pc_slider', value: 55 },
    { kind: 'control', componentId: 'pc_slider', value: 55 },
    { kind: 'focus', componentId: 'pc_input', focused: true },
    { kind: 'control', componentId: 'pc_input', value: '不应写入' },
    { kind: 'textCommit', componentId: 'pc_input', method: 'enter' }, click('paint'),
  ]);
  assert.equal(result.incomplete, false); assert.equal(result.variables.pc_number, 55);
  assert.equal(result.controlValues.pc_slider_follow, 55); assert.equal(result.variables.pc_changed_count, 1);
  assert.equal(result.variables.pc_text, '参数初值'); assert.equal(result.variables.pc_commit_count, 0); assert.equal(result.focusedComponentId, undefined);
  assert.equal(row(result, 'pc_slider_follow').component.readOnly, true);
  assert.equal(row(result, 'pc_slider_follow').component.slider?.fillColor, '#ee8822');
});

test('follow rejects direct assignment, ratio and option aliases and animation while retaining every source', () => {
  for (const [type, properties] of [
    ['setUiProperty', { componentId: 'pc_text_follow', property: 'text', value: '错误' }],
    ['setUiProperty', { componentId: 'pc_slider_follow', property: 'normalizedValue', value: .9, writeMode: 'source' }],
    ['setUiProperty', { componentId: 'pc_choices_follow', property: 'optionIndex', value: 1 }],
    ['animateUiProperty', { componentId: 'pc_alpha_follow', property: 'opacity', value: 1, duration: 1, easing: 'linear', wait: false }],
  ] satisfies [BlueprintNode['type'], BlueprintNode['properties']][]) {
    const fixture = createUiPropertyControlFixture(); action(fixture, 'reject', type, properties);
    const result = sample(fixture, [click('reject'), advance(.5)]);
    assert.equal(result.incomplete, true); assert.equal(result.variables.pc_caption, '参数文字');
    assert.equal(result.variables.pc_number, 30); assert.equal(result.variables.pc_choice, '简单'); assert.equal(result.variables.pc_alpha, .4);
    assert.ok(result.trace?.entries.some(event => event.reason?.includes('单向跟随')));
  }
});

test('parameter updates and reset preserve linked sources, clamp only displayed values, and restore default overrides', () => {
  const fixture = createUiPropertyControlFixture();
  const result = sample(fixture, [click('pc_program'), click('pc_parameter'), click('pc_reset')]);
  assert.equal(result.incomplete, false); assert.equal(result.variables.pc_number, 90);
  assert.equal(result.controlValues.pc_slider, 90); assert.equal(result.controlValues.pc_clamped, 40);
  assert.equal(result.controlValues.pc_input, '参数更新'); assert.equal(row(result, 'pc_default').component.text, '原始设计文字');
  assert.equal(result.variables.pc_alpha, .8); assert.equal(result.variables.pc_image, 'pc_asset_b');
  assert.equal(control(fixture, 'pc_alpha_a').propertyControls!.opacity.mode, 'sync');
  assert.equal(fixture.project.variables.find(variable => variable.id === 'pc_alpha')!.initial, .4);
});

test('shared parameter animations update every reader and a second driver deterministically replaces the first', () => {
  const fixture = createUiPropertyControlFixture();
  const middle = sample(fixture, [click('pc_anim_a'), advance(.5)]);
  assert.equal(middle.incomplete, false); closeTo(middle.variables.pc_alpha, .675);
  closeTo(row(middle, 'pc_alpha_a').component.style?.opacity, .3375); closeTo(row(middle, 'pc_alpha_b').component.style?.opacity, .675);
  closeTo(row(middle, 'pc_alpha_follow').component.style?.opacity, .675);
  const replaced = sample(fixture, [click('pc_anim_a'), advance(.5), click('pc_anim_b'), advance(.2)]);
  closeTo(replaced.variables.pc_alpha, .4125);
  const finished = sample(fixture, [click('pc_anim_a'), advance(.5), click('pc_anim_b'), advance(2)]);
  closeTo(finished.variables.pc_alpha, .15); assert.equal(finished.variables.pc_changed_count, 0);
});

test('even equal global parameter writes interrupt animation and resetting another reader does not', () => {
  const fixture = createUiPropertyControlFixture();
  action(fixture, 'same', 'setVariable', { variableId: 'pc_alpha', value: .675 });
  action(fixture, 'reset_other', 'resetUiProperty', { componentId: 'pc_alpha_b', property: 'opacity' });
  const stopped = sample(fixture, [click('pc_anim_a'), advance(.5), click('same'), advance(2)]);
  assert.equal(stopped.incomplete, false); closeTo(stopped.variables.pc_alpha, .675);
  const resetDriver = sample(fixture, [click('pc_anim_a'), advance(.5), click('pc_reset'), advance(2)]);
  closeTo(resetDriver.variables.pc_alpha, .675);
  const resetReader = sample(fixture, [click('pc_anim_a'), advance(.5), click('reset_other'), advance(.5)]);
  closeTo(resetReader.variables.pc_alpha, .95);
  const parameterEvent = sample(fixture, [click('pc_anim_a'), advance(.5), { kind: 'parameter', id: 'pc_alpha', value: .675 }, advance(2)]);
  closeTo(parameterEvent.variables.pc_alpha, .675);
});

test('a clip rejects a follow track or two drivers of one parameter before touching any track', () => {
  for (const conflict of ['follow', 'sameParameter'] as const) {
    const fixture = createUiPropertyControlFixture(), clip = createUiAnimationClip(fixture.project, fixture.page.id); clip.duration = 1;
    const first = addUiAnimationTrack(clip, control(fixture, 'pc_alpha_a'), 'opacity'); first.keys = [{ id: 'a_end', time: 1, value: .9, easing: 'linear' }];
    const second = addUiAnimationTrack(clip, control(fixture, conflict === 'follow' ? 'pc_alpha_follow' : 'pc_alpha_b'), 'opacity'); second.keys = [{ id: 'b_end', time: 1, value: .2, easing: 'linear' }];
    action(fixture, 'clip', 'playUiAnimation', { animationId: clip.id, wait: false });
    const result = sample(fixture, [click('clip'), advance(.5)]);
    assert.equal(result.incomplete, true); assert.equal(result.variables.pc_alpha, .4);
    assert.equal(row(result, 'pc_alpha_a').component.style?.opacity, .2);
  }
});

test('named animation sampling and finish write the parameter without a local override or repeated user events', () => {
  const fixture = createUiPropertyControlFixture(), clip = createUiAnimationClip(fixture.project, fixture.page.id); clip.duration = 2;
  const track = addUiAnimationTrack(clip, control(fixture, 'pc_alpha_a'), 'opacity');
  track.keys = [{ id: 'start', time: 0, value: .2, easing: 'linear' }, { id: 'mid', time: 1, value: .8, easing: 'linear' }, { id: 'end', time: 2, value: .6, easing: 'linear' }];
  action(fixture, 'clip', 'playUiAnimation', { animationId: clip.id, wait: false });
  action(fixture, 'finish', 'stopUiAnimationPlayback', { animationId: clip.id, finish: true });
  closeTo(sample(fixture, [click('clip')]).variables.pc_alpha, .2);
  closeTo(sample(fixture, [click('clip'), advance(.5)]).variables.pc_alpha, .5);
  const finished = sample(fixture, [click('clip'), advance(.5), click('finish'), advance(2)]);
  closeTo(finished.variables.pc_alpha, .6); assert.equal(finished.variables.pc_changed_count, 0);
});

test('range assignments validate and write the complete batch, including blocked fields and shared-source conflicts', () => {
  const fixture = createUiPropertyControlFixture();
  fixture.project.variables.push({ id: 'low', name: '下限', type: 'number', initial: 0, persistent: false }, { id: 'high', name: '上限', type: 'number', initial: 100, persistent: false });
  Object.assign(control(fixture, 'pc_slider').propertyControls!, { minimum: { mode: 'sync', parameterId: 'low' }, maximum: { mode: 'sync', parameterId: 'high' } });
  action(fixture, 'range', 'setUiControlRange', { componentId: 'pc_slider', minimum: 100, maximum: 200, step: 5 });
  action(fixture, 'reset_range', 'resetUiControlRange', { componentId: 'pc_slider' });
  const result = sample(fixture, [click('range'), click('reset_range')]);
  assert.equal(result.incomplete, false); assert.equal(result.variables.low, 100); assert.equal(result.variables.high, 200);
  assert.equal(result.variables.pc_number, 30); assert.equal(result.controlValues.pc_slider, 100);
  assert.deepEqual(row(result, 'pc_slider').component.controlRange, { min: 100, max: 200, step: 1 });
  control(fixture, 'pc_slider').propertyControls!.maximum.mode = 'follow';
  const blocked = sample(fixture, [click('range')]);
  assert.equal(blocked.incomplete, true); assert.equal(blocked.variables.low, 0); assert.equal(blocked.variables.high, 100);
  assert.equal(row(blocked, 'pc_slider').component.controlRange?.step, 1);
  control(fixture, 'pc_slider').propertyControls!.maximum = { mode: 'sync', parameterId: 'low' };
  const conflict = sample(fixture, [click('range')]);
  assert.equal(conflict.incomplete, true); assert.equal(conflict.variables.low, 0);
  action(fixture, 'same_endpoint', 'setUiProperty', { componentId: 'pc_slider', property: 'minimum', value: 25 });
  const shared = sample(fixture, [click('same_endpoint')]);
  assert.equal(shared.incomplete, false); assert.equal(shared.variables.low, 25);
  assert.deepEqual(row(shared, 'pc_slider').component.controlRange, { min: 25, max: 25, step: 1 });
});

test('invalid metadata and current values diagnose their property and invalid parameter writes leave prior values intact', () => {
  for (const corrupt of [
    (fixture: Fixture) => { control(fixture, 'pc_text_follow').propertyControls!.text.parameterId = 'missing'; },
    (fixture: Fixture) => { control(fixture, 'pc_text_follow').propertyControls!.text.parameterId = 'pc_number'; },
    (fixture: Fixture) => { control(fixture, 'pc_slider').propertyControls!.normalizedValue = { mode: 'sync', parameterId: 'pc_number' }; },
    (fixture: Fixture) => { control(fixture, 'pc_alpha_a').propertyControls!.unknownProperty = { mode: 'sync', parameterId: 'pc_alpha' }; },
  ]) {
    const fixture = createUiPropertyControlFixture(); corrupt(fixture); const result = sample(fixture);
    assert.equal(result.incomplete, true); assert.ok(result.trace?.entries.some(event => event.kind === 'stop' && event.componentId));
    assert.equal(result.variables.pc_number, 30);
  }
  const fixture = createUiPropertyControlFixture();
  assert.equal(sample(fixture, [], { pc_alpha: 2 }).incomplete, true);
  const invalid = sample(fixture, [{ kind: 'parameter', id: 'pc_alpha', value: 2 }, { kind: 'parameter', id: 'pc_choice', value: '未定义选项' }, { kind: 'parameter', id: 'pc_text', value: '长'.repeat(21) }]);
  assert.equal(invalid.incomplete, true); assert.equal(invalid.variables.pc_alpha, .4); assert.equal(invalid.variables.pc_choice, '简单'); assert.equal(invalid.variables.pc_text, '参数初值');
});

test('computed scroll bounds never write sources and only deliberate wheel movement synchronizes its axis', () => {
  const fixture = createUiPropertyControlFixture();
  fixture.project.variables.push({ id: 'scroll', name: '滚动', type: 'number', initial: 5000, persistent: false });
  fixture.page.components.push(
    { id: 'container', page: 'custom', kind: 'panel', text: '', x: .1, y: .1, width: .3, height: .3, layout: { version: 1, scroll: 'vertical' }, propertyControls: { scrollY: { mode: 'sync', parameterId: 'scroll' } } },
    { id: 'long_child', page: 'custom', kind: 'text', text: '长内容', parentId: 'container', x: 0, y: 0, width: 1, height: 3 },
  );
  const initial = sample(fixture); assert.equal(initial.incomplete, false); assert.equal(initial.variables.scroll, 5000);
  const current = row(initial, 'container').component.layout!.scrollY!; assert.ok(current > 0 && current < 5000);
  const wheel = sample(fixture, [{ kind: 'scroll', componentId: 'container', pageInstance: 1, dx: 0, dy: -40 }]);
  assert.equal(wheel.variables.scroll, current - 40);
  control(fixture, 'container').propertyControls!.scrollY.mode = 'follow';
  const followed = sample(fixture, [{ kind: 'scroll', componentId: 'container', pageInstance: 1, dx: 0, dy: -40 }]);
  assert.equal(followed.variables.scroll, 5000); assert.equal(followed.incomplete, false);
});

test('undeclared button state colors follow the base source while an authored state color remains independent', () => {
  const fixture = createUiPropertyControlFixture();
  fixture.project.variables.push({ id: 'color', name: '文字颜色', type: 'string', initial: '#dd4422', persistent: false });
  const button = control(fixture, 'pc_program'); button.propertyControls = { textColor: { mode: 'sync', parameterId: 'color' } };
  button.style = { ...button.style, selectedTextColor: '#4455dd' };
  const result = sample(fixture); assert.equal(result.incomplete, false);
  assert.equal(row(result, button.id).component.style?.hoverTextColor, '#dd4422');
  assert.equal(row(result, button.id).component.style?.disabledTextColor, '#dd4422');
  assert.equal(row(result, button.id).component.style?.selectedTextColor, '#4455dd');
});

test('unopened controls do not veto parameter writes and their incompatible source is diagnosed when opened', () => {
  const fixture = createUiPropertyControlFixture();
  fixture.project.variables.push({ id: 'later_text', name: '稍后显示', type: 'string', initial: 'A', persistent: false });
  fixture.project.ui.customPages.push({ id: 'later_page', name: '稍后页面', modal: true, background: '#172334', components: [
    { id: 'later_input', page: 'custom', kind: 'preferenceChoice', text: '短输入', parameterId: 'later_text', input: { maxLength: 2 }, x: .1, y: .1, width: .5, height: .1, propertyControls: { stringValue: { mode: 'sync', parameterId: 'later_text' } } },
  ] });
  action(fixture, 'open_later', 'showUiPage', { pageId: 'later_page', wait: false });
  const write: UiPreviewEvent = { kind: 'parameter', id: 'later_text', value: '超过输入长度' };
  const closed = sample(fixture, [write]);
  assert.equal(closed.incomplete, false); assert.equal(closed.variables.later_text, '超过输入长度');
  const opened = sample(fixture, [write, click('open_later')]);
  assert.equal(opened.incomplete, true); assert.equal(opened.variables.later_text, '超过输入长度');
  assert.ok(opened.trace?.entries.some(entry => entry.componentId === 'later_input' && entry.reason?.includes('长度')));
});

test('closing a page releases its parameter animation and keeps the last source value', () => {
  const fixture = createUiPropertyControlFixture();
  const result = sample(fixture, [click('pc_anim_a'), advance(.5), click('pc_close'), advance(2)]);
  assert.equal(result.closed, true); assert.equal(result.incomplete, false); closeTo(result.variables.pc_alpha, .675);
  assert.equal(result.variables.pc_changed_count, 0);
});
