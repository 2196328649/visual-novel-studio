import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiPageInterfaceFixture } from '../scripts/lib/ui-page-interface-fixture';
import { projectSchema, uiInstanceSchema, type VariableValue } from '../src/core/model';
import { blueprintNodeDefaults, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { uiPageInputValues, uiPageContractProblem, uiPageInterfaceUsages, uiPageOutputDefaults, uiPageParameterTypes, changeUiPageParameter, removeUiPageParameter, recoverUiPageInterface } from '../src/core/ui-page-interface';
import { uiPageCompletion } from '../src/core/ui-page-session';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { uiPageLifecycleHandlers } from '../src/core/ui-logic';
import { uiPages } from '../src/core/ui-pages';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { createPageCall, connectPageToStory, addGameFlowStep, gameFlowDiagnostics } from '../src/core/game-flow';
import { projectForExport } from '../src/core/export-assets';
import { compileProject } from '../src/runtime/compiler';

type Fixture = ReturnType<typeof createUiPageInterfaceFixture>;
const click = (componentId: string): UiPreviewEvent => ({ kind: 'click', componentId });
const advance = (seconds: number): UiPreviewEvent => ({ kind: 'advance', seconds });
const parameter = (id: string, value: VariableValue): UiPreviewEvent => ({ kind: 'parameter', id, value });
const open = click('pi_open_child'), stage = click('pi_child_stage'), complete = click('pi_child_complete');
function sample(events: UiPreviewEvent[], f = createUiPageInterfaceFixture(), values: Record<string, VariableValue> = {}, allowIncomplete = false) {
  const before = structuredClone(f.project);
  const result = previewUiLogic(f.project, f.parent.components, f.parent.id, values, events, { timed: true, trace: true });
  assert.deepEqual(f.project, before); assert.equal(result.exhausted, false);
  if (!allowIncomplete) assert.equal(result.incomplete, false, JSON.stringify(result.trace?.entries.filter(entry => entry.kind === 'stop')));
  return result;
}
function insertAfter(f: Fixture, event: typeof f.childHooks.created, type: Parameters<Fixture['node']>[1], properties: Parameters<Fixture['node']>[2] = {}) {
  const g = f.childGraph, link = g.links.find(link => link.fromNodeId === event.id && link.fromPinId === 'exec')!;
  g.links = g.links.filter(old => old !== link); const inserted = f.node(g, type, properties);
  f.wire(g, event, inserted); f.wire(g, inserted, g.nodes.find(node => node.id === link.toNodeId)!, 'exec_out', link.toPinId); return inserted;
}

test('all scalar/reference page inputs preserve explicit values and stable ids through save/reopen', () => {
  const f = createUiPageInterfaceFixture();
  assert.deepEqual(Object.keys(f.supplied).sort(), Object.keys(uiPageParameterTypes).sort());
  assert.deepEqual(uiPageInputValues(f.project, f.child.id, f.supplied), f.supplied);
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(f.project)));
  assert.deepEqual(restored.ui.pageInterfaces, f.project.ui.pageInterfaces);
  assert.deepEqual(uiPageInputValues(restored, f.child.id, f.supplied), f.supplied);
  assert.equal(f.childOpen.open.pins.find(pin => pin.id === 'out_asset_result')?.dataType, 'asset');
  assert.equal(f.childHooks.complete.pins.find(pin => pin.id === 'out_number_result')?.defaultValue, undefined);
});

test('missing required input, stale arguments, and incorrect primitive types stop explicitly', () => {
  const f = createUiPageInterfaceFixture(), definition = f.project.ui.pageInterfaces![f.child.id];
  definition.inputs[0].required = true; delete definition.inputs[0].defaultValue;
  const required = definition.inputs[0].id, supplied = { ...f.supplied }; delete supplied[required];
  assert.throws(() => uiPageInputValues(f.project, f.child.id, supplied), /缺少页面输入/);
  for (const values of [{ number: false }, { number: '0' }, { number: Infinity }, { boolean: 0 }, { string: 0 }] as Record<string, string | number | boolean>[]) assert.throws(() => uiPageInputValues(f.project, f.child.id, { ...f.supplied, ...values }), /类型不匹配/);
  assert.throws(() => uiPageInputValues(f.project, f.child.id, { ...f.supplied, deleted_parameter: 1 }), /定义已不存在/);
  assert.deepEqual(uiPageInputValues(f.project, f.parent.id, { old_named_input: false }), { old_named_input: false });
});

test('dynamic interfaces match ids and types, never display labels or the default target', () => {
  const f = createUiPageInterfaceFixture(), actual = f.preferences.pageId;
  assert.equal(uiPageContractProblem(f.project, actual, f.child.id), undefined);
  f.project.ui.pageInterfaces![actual].inputs[0].name = '另一个显示名称';
  assert.equal(uiPageContractProblem(f.project, actual, f.child.id), undefined);
  f.project.ui.pageInterfaces![actual].inputs[0].id = 'new_identity';
  assert.match(uiPageContractProblem(f.project, actual, f.child.id)!, /不兼容/);
});

test('result defaults are used for every non-completion reason; false/zero/empty are not missing', () => {
  const f = createUiPageInterfaceFixture(), values = Object.fromEntries(Object.entries(f.supplied).map(([id, value]) => [id + '_result', value]));
  assert.deepEqual(uiPageCompletion(f.project, f.child.id, '', 'completed', values).outputs, values);
  for (const reason of ['cancelled', 'alreadyOpen', 'shown', 'parentClosed', 'navigated'] as const) assert.deepEqual(uiPageCompletion(f.project, f.child.id, '', reason, values).outputs, uiPageOutputDefaults(f.project, f.child.id));
  assert.throws(() => uiPageCompletion(f.project, f.child.id, '', 'completed', { number_result: false }), /类型不匹配/);
});

test('nested page module stages all typed outputs, and Closed reads the released instance snapshot', () => {
  const f = createUiPageInterfaceFixture(), result = sample([open, stage, complete], f);
  assert.equal(result.variables.input_seen, 0); assert.equal(result.variables.closed_input, 0);
  assert.equal(result.variables.result_number, 0); assert.equal(result.variables.result_flag, false); assert.equal(result.variables.result_text, '');
  assert.equal(result.variables.closed_number, 0); assert.equal(result.variables.closed_flag, false); assert.equal(result.variables.closed_text, '');
  assert.equal(result.variables.order, 'CSFRLX'); assert.equal(result.variables.resumed_count, 1);
  assert.deepEqual(result.pageResults.find(page => page.pageId === f.child.id)?.outputs, Object.fromEntries(Object.entries(f.supplied).map(([id, value]) => [id + '_result', value])));
  assert.equal(result.layers.some(page => page.pageId === f.child.id), false);
});

test('explicit close overrides only the specified staged output', () => {
  const result = sample([open, stage, click('pi_child_override')]);
  assert.equal(result.variables.result_number, 9); assert.equal(result.variables.result_flag, false); assert.equal(result.variables.result_text, '');
});

test('custom button return completes with staged results while Escape remains cancellation', () => {
  const result = sample([open, stage, click('pi_child_action_return')]);
  assert.equal(result.variables.result_reason, 'completed'); assert.equal(result.variables.result_number, 0);
  assert.equal(result.variables.result_flag, false); assert.equal(result.variables.result_text, '');
  assert.equal(result.variables.resumed_count, 1); assert.equal(result.variables.closed_count, 1);
});

test('cancel and Escape discard partial outputs and report exactly one completion', () => {
  for (const event of [click('pi_child_cancel'), { kind: 'key', key: 'K_ESCAPE' } as UiPreviewEvent]) {
    const result = sample([open, stage, event]);
    assert.equal(result.variables.result_reason, 'cancelled'); assert.equal(result.variables.result_number, -7);
    assert.equal(result.variables.result_flag, true); assert.equal(result.variables.closed_text, '输出默认');
    assert.equal(result.variables.resumed_count, 1); assert.equal(result.variables.closed_count, 1);
  }
});

test('duplicate open preserves inputs and does not recreate, restage or add an external waiter', () => {
  const f = createUiPageInterfaceFixture(), result = sample([open, stage, click('pi_child_duplicate')], f);
  const page = result.layers.find(page => page.pageId === f.child.id)!;
  assert.deepEqual(page.inputs, f.supplied); assert.equal(page.outputs.number_result, 0);
  assert.equal(result.variables.created_count, 1); assert.equal(result.variables.shown_count, 1);
  assert.equal(result.variables.duplicate_reason, 'alreadyOpen'); assert.equal(result.variables.already_count, 1); assert.equal(result.variables.resumed_count, 0);
});

test('reopen creates a new token and never inherits the previous staged result', () => {
  const f = createUiPageInterfaceFixture(), result = sample([open, stage, complete, open, complete], f);
  const completed = result.pageResults.filter(page => page.pageId === f.child.id);
  assert.equal(completed.length, 2); assert.notEqual(completed[0].instance, completed[1].instance);
  assert.equal(result.variables.result_number, -7); assert.equal(result.variables.created_count, 2); assert.equal(result.variables.resumed_count, 2);
});

test('close requests can wait and veto; a duplicate request does not start another chain', () => {
  const f = createUiPageInterfaceFixture(), events = [open, complete, { kind: 'key', key: 'K_ESCAPE' } as UiPreviewEvent, advance(.6)];
  const vetoed = sample(events, f, { request_delay: .5, veto: true });
  assert.equal(vetoed.variables.request_count, 1); assert.equal(vetoed.variables.resumed_count, 0); assert.equal(vetoed.pageId, f.child.id);
  assert.equal(vetoed.layers.at(-1)?.closeRequested, false);
  const accepted = sample([...events, parameter('veto', false), complete, advance(.6)], f, { request_delay: .5, veto: true });
  assert.equal(accepted.variables.request_count, 2); assert.equal(accepted.variables.resumed_count, 1); assert.equal(accepted.variables.closed_count, 1);
});

test('a native confirmation inside CloseRequested can reject then accept the same instance', () => {
  const f = createUiPageInterfaceFixture(), prefix = [open, stage, complete];
  const waiting = sample(prefix, f, { ask_confirm: true }); const confirmation = waiting.layers.find(page => page.mode === 'confirm')!; assert.ok(confirmation);
  const rejected: UiPreviewEvent[] = [...prefix, { kind: 'confirm', requestId: confirmation.instance, value: false }];
  const stillOpen = sample(rejected, f, { ask_confirm: true }); assert.equal(stillOpen.pageId, f.child.id); assert.equal(stillOpen.variables.resumed_count, 0);
  const waitingAgain = sample([...rejected, complete], f, { ask_confirm: true });
  const accepted = sample([...rejected, complete, { kind: 'confirm', requestId: waitingAgain.layers.find(page => page.mode === 'confirm')!.instance, value: true }], f, { ask_confirm: true });
  assert.equal(accepted.variables.request_count, 2); assert.equal(accepted.variables.resumed_count, 1); assert.equal(accepted.variables.result_number, 0);
});

test('forced parent teardown bypasses waiting/veto hooks and publishes cancelled defaults', () => {
  const f = createUiPageInterfaceFixture(), result = sample([open, stage, click('pi_child_parent'), advance(1)], f, { request_delay: .5, veto: true });
  assert.equal(result.closed, true); assert.equal(result.variables.request_count, 0); assert.equal(result.variables.blur_count, 0);
  assert.equal(result.variables.closed_count, 1); assert.equal(result.variables.resumed_count, 0);
  assert.equal(result.pageResults.find(page => page.pageId === f.child.id)?.reason, 'parentClosed');
  assert.equal(result.variables.closed_number, -7); assert.equal(result.stageWaiting, 0);
});

test('Created completes before OnShow/focus; waiting Created does not receive early focus', () => {
  const f = createUiPageInterfaceFixture(); insertAfter(f, f.childHooks.created, 'delay', { seconds: .4 });
  const waiting = sample([open, advance(.1)], f); assert.equal(waiting.variables.focus_count, 0); assert.equal(waiting.variables.shown_count, 0);
  const ready = sample([open, advance(.5)], f); assert.equal(ready.variables.order, 'CSF'); assert.equal(ready.layers.at(-1)?.created, true);
});

test('ordinary focus-loss failure leaves a retryable page, not a permanent closing flag', () => {
  const f = createUiPageInterfaceFixture(); insertAfter(f, f.childHooks.blur, 'setPageOutput', { pageId: f.child.id, parameterId: 'deleted', value: 0 });
  const result = sample([open, complete, complete], f, {}, true);
  assert.equal(result.incomplete, true); assert.equal(result.pageId, f.child.id); assert.equal(result.variables.request_count, 2);
  assert.equal(result.layers.at(-1)?.closing, false); assert.equal(result.variables.resumed_count, 0);
});

test('Closed failure cannot suppress other notifications or strand the external caller', () => {
  const f = createUiPageInterfaceFixture(); insertAfter(f, f.childHooks.closed, 'delay', { seconds: .5 });
  const second = f.node(f.childGraph, 'eventPage', { pageId: f.child.id, phase: 'closed' }); f.wire(f.childGraph, second, f.increment(f.childGraph, 'closed_count'));
  const result = sample([open, complete], f, {}, true);
  assert.equal(result.incomplete, true); assert.equal(result.variables.closed_count, 1); assert.equal(result.variables.resumed_count, 1); assert.equal(result.waitingPages.length, 0);
});

test('native template Return/Escape use the same request and cancellation interface', () => {
  for (const ending of [click('pi_preferences_back'), { kind: 'key', key: 'K_ESCAPE' } as UiPreviewEvent]) {
    const f = createUiPageInterfaceFixture(), result = sample([click('pi_open_preferences'), click('pi_preferences_stage'), ending], f);
    assert.equal(result.variables.request_count, 1); assert.equal(result.variables.result_reason, 'cancelled'); assert.equal(result.variables.result_number, -7);
  }
});

test('menu replacement waits for the host, but returns the original interface defaults', () => {
  const f = createUiPageInterfaceFixture(), events = [click('pi_open_preferences'), click('pi_preferences_stage'), click('pi_replace_menu')];
  const replaced = sample(events, f); assert.equal(replaced.pageId, 'ui:staff'); assert.equal(replaced.variables.resumed_count, 0);
  const result = sample([...events, click('pi_staff_stage'), click('pi_staff_complete')], f);
  assert.equal(result.variables.resumed_count, 1); assert.equal(result.variables.result_reason, 'navigated'); assert.equal(result.variables.result_number, -7);
  assert.equal(result.variables.closed_count, 2); assert.equal(result.pageResults.find(page => page.pageId === 'ui:preferences')?.reason, 'navigated');
});

test('dynamic matching targets use their actual input snapshot; incompatible targets never open', () => {
  const f = createUiPageInterfaceFixture(), source = f.node(f.parentGraph, 'literal', { value: 'ui:preferences' }); source.pins[0].dataType = 'ui';
  f.childOpen.open.properties.interfacePageId = f.child.id; f.wire(f.parentGraph, source, f.childOpen.open, 'value', 'pageId');
  const accepted = sample([open], f); assert.equal(accepted.pageId, 'ui:preferences'); assert.equal(accepted.variables.input_seen, 0);
  source.properties.value = f.parent.id;
  const rejected = sample([open], f, {}, true); assert.equal(rejected.incomplete, true); assert.equal(rejected.layers.length, 1); assert.equal(rejected.variables.created_count, 0);
});

test('flow steps appear in interface impact and keep old arguments for explicit repair', () => {
  const f = createUiPageInterfaceFixture(), step = addGameFlowStep(f.project, 'beforeTitle', { kind: 'page', pageId: f.child.id, inputs: { number: 0 } });
  assert.ok(uiPageInterfaceUsages(f.project, f.child.id, 'inputs', 'number').some(use => use.kind === 'flow' && use.stepId === step.id));
  removeUiPageParameter(f.project, f.child.id, 'inputs', 'number'); synchronizeBlueprintSignatures(f.project);
  assert.equal(step.kind === 'page' && step.inputs?.number, 0); assert.ok(gameFlowDiagnostics(f.project).some(issue => issue.message.includes('定义已不存在')));
  assert.ok(f.childGraph.nodes.some(node => node.id === f.childHooks.readInput.id));
});

test('story wizard arguments become explicit wrapper defaults, including empty values', () => {
  const f = createUiPageInterfaceFixture(), first = f.project.nodes.find(node => node.kind === 'passage')!;
  const wrapper = connectPageToStory(f.project, f.child.id, first.id, undefined, true, undefined, { inputs: f.supplied });
  assert.equal(wrapper.exposedInputs.find(pin => pin.id === 'number')?.defaultValue, 0);
  assert.equal(wrapper.exposedInputs.find(pin => pin.id === 'boolean')?.defaultValue, false);
  assert.equal(wrapper.exposedInputs.find(pin => pin.id === 'string')?.defaultValue, '');
  const native = createPageCall(f.project, 'ui:preferences'); assert.ok(native.nodes.some(node => node.type === 'showUiPage' && node.properties.pageId === 'ui:preferences'));
});

test('unknown interface versions survive schema/save/signature sync until explicit recover', () => {
  const f = createUiPageInterfaceFixture(), old = structuredClone(f.project.ui.pageInterfaces![f.child.id]), pins = structuredClone(f.childOpen.open.pins);
  f.project.ui.pageInterfaces![f.child.id].version = 88;
  const reopened = projectSchema.parse(JSON.parse(JSON.stringify(f.project))); synchronizeBlueprintSignatures(reopened);
  assert.equal(reopened.ui.pageInterfaces![f.child.id].version, 88); assert.deepEqual(reopened.blueprints.find(g => g.id === f.parentGraph.id)!.nodes.find(n => n.id === f.childOpen.open.id)!.pins, pins);
  assert.throws(() => uiPageInputValues(reopened, f.child.id), /版本/);
  assert.throws(() => changeUiPageParameter(reopened, f.child.id, 'inputs', old.inputs[0]), /未知版本/);
  recoverUiPageInterface(reopened, f.child.id); synchronizeBlueprintSignatures(reopened);
  assert.equal(JSON.parse(reopened.ui.pageInterfaces![f.child.id].recovery!).version, 88);
  assert.equal(reopened.ui.pageInterfaces![f.child.id].inputs.length, 0);
});

test('all templates share the interface model and active scheme routes without copying definitions', () => {
  const f = createUiPageInterfaceFixture({ allMenus: true });
  for (const page of uiPages(f.project)) {
    f.project.ui.pageInterfaces![page.id] ??= { version: 1, inputs: structuredClone(f.inputs), outputs: structuredClone(f.outputs) };
    assert.deepEqual(uiPageInputValues(f.project, page.id, f.supplied), f.supplied);
  }
  f.project.ui.instances = [uiInstanceSchema.parse({ id: 'derived', name: '派生界面' })]; f.project.ui.activeInstanceId = 'derived';
  assert.deepEqual(uiPageLifecycleHandlers(f.project, 'ui:preferences', 'created'), []);
  const derived = f.graph('派生模板事件'); derived.kind = 'ui'; derived.uiPageId = 'ui:preferences'; derived.uiInstanceId = 'derived';
  const event = f.node(derived, 'eventPage', { pageId: 'ui:preferences', phase: 'created' });
  assert.ok(uiPageLifecycleHandlers(f.project, 'ui:preferences', 'created').some(handler => handler.nodeId === event.id));
  assert.equal(Object.keys(f.project.ui.pageInterfaces!).filter(id => id.includes('derived')).length, 0);
});

test('template required inputs need defaults and title flow cannot save unstarted gameplay', () => {
  const f = createUiPageInterfaceFixture(), definition = f.project.ui.pageInterfaces!['ui:preferences']; definition.inputs[0].required = true; delete definition.inputs[0].defaultValue;
  assert.ok(validateBlueprints(f.project).some(issue => issue.message.includes('系统操作打开')));
  addGameFlowStep(f.project, 'beforeTitle', { kind: 'page', pageId: 'ui:save', saveMode: 'save' });
  assert.ok(gameFlowDiagnostics(f.project).some(issue => issue.message.includes('没有可保存')));
});

test('interface-only assets are kept and ordinary/native fixture compiles without mutating the author model', () => {
  const f = createUiPageInterfaceFixture(), before = structuredClone(f.project);
  assert.ok(projectForExport(f.project).assets.some(asset => asset.id === 'page_only_asset'));
  const compiled = compileProject(f.project, { development: true }); assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.deepEqual(f.project, before);
});


test('a custom page can explicitly preview title or gameplay save-menu capabilities', () => {
  const f = createUiPageInterfaceFixture({ allMenus: true }), save = f.menus.find(menu => menu.pageId === 'ui:save')!; save.open.properties.saveMode = 'save';
  const events = [click('pi_open_save')], before = structuredClone(f.project);
  const title = previewUiLogic(f.project, f.parent.components, f.parent.id, {}, events, { host: 'title', timed: true, trace: true });
  assert.equal(title.incomplete, true); assert.equal(title.pageId, f.parent.id); assert.ok(title.trace?.entries.some(entry => entry.reason?.includes('没有可保存')));
  const story = previewUiLogic(f.project, f.parent.components, f.parent.id, {}, events, { host: 'story', timed: true });
  assert.equal(story.incomplete, false); assert.equal(story.pageId, 'ui:save'); assert.equal(story.saveMode, 'save'); assert.equal(story.returnPageId, 'ui:say');
  assert.deepEqual(f.project, before);
});

test('a standard system confirmation receives the same Created/Closed lifecycle as a page', () => {
  const f = createUiPageInterfaceFixture(), g = f.graph('系统确认的通用页面事件'); g.kind = 'ui';
  const components: typeof f.parent.components = []; f.attach('ui:messageBox', g, components, 'pi_confirm_'); f.project.ui.components.push(...components);
  f.parent.components.push({ id: 'pi_reset_preferences', text: '恢复设置', kind: 'button', page: 'custom', x: .05, y: .7, width: .3, height: .1, action: 'resetPreferences' });
  const events = [click('pi_reset_preferences')];
  const waiting = sample(events, f); const confirmation = waiting.layers.find(page => page.mode === 'confirm')!;
  assert.ok(confirmation); assert.equal(confirmation.created, true); assert.equal(waiting.variables.created_count, 1); assert.equal(waiting.variables.shown_count, 1);
  const closed = sample([...events, { kind: 'confirm', requestId: confirmation.instance, value: false }], f);
  assert.equal(closed.pageId, f.parent.id); assert.equal(closed.variables.closed_count, 1); assert.ok(!closed.layers.some(page => page.mode === 'confirm'));
});
