import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprintCatalog, blueprintNodeDefaults, blueprintPin, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { blueprintFlowControlInitial, transitionBlueprintFlowControl } from '../src/core/blueprint-flow-control';
import { createBlueprintFlowControlFixture } from '../scripts/lib/blueprint-flow-control-fixture';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { BlueprintTraceRecorder } from '../src/core/blueprint-trace';
import { compileProject } from '../src/runtime/compiler';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { blueprintCapabilitySummary } from '../src/core/blueprint-capabilities';
import { inspectBlueprintEncapsulation } from '../src/core/blueprint-encapsulation';
import { uiPageComponents } from '../src/core/ui-logic';
import { createCustomUiPage } from '../src/core/game-flow';
import { projectSchema } from '../src/core/model';

const click = (componentId: string): UiPreviewEvent => ({ kind: 'click', componentId });
const advance = (seconds: number): UiPreviewEvent => ({ kind: 'advance', seconds });
function sample(events: UiPreviewEvent[], f = createBlueprintFlowControlFixture()) {
  const before = structuredClone(f.project), result = previewUiLogic(f.project, f.root.components, f.root.id, {}, events, { timed: true, trace: true });
  assert.deepEqual(f.project, before); assert.equal(result.incomplete, false); assert.equal(result.exhausted, false); return { f, result };
}

test('control nodes expose stable, distinct execution entries and searchable names without game-specific scopes', () => {
  const once = blueprintNodeDefaults('doOnce'), gate = blueprintNodeDefaults('gate');
  assert.match(blueprintCatalog.doOnce.name, /执行一次.*Do Once/); assert.match(blueprintCatalog.gate.name, /门控.*Gate/);
  assert.deepEqual(once.pins.filter(p => p.direction === 'input').map(p => p.id), ['exec_in', 'reset']);
  assert.deepEqual(gate.pins.filter(p => p.direction === 'input').map(p => p.id), ['exec_in', 'open', 'close', 'toggle', 'reset']);
  assert.deepEqual(gate.pins.filter(p => p.direction === 'output').map(p => p.id), ['exec_out', 'blocked', 'updated']);
  assert.equal(once.properties.scope, 'call'); assert.equal(blueprintFlowControlInitial(once), false); assert.equal(blueprintFlowControlInitial(gate), true);
});

test('Do Once consumes atomically before continuation and reset opens it even when initially closed', () => {
  assert.deepEqual(transitionBlueprintFlowControl('doOnce', 'exec_in', undefined, false), { closed: true, output: 'exec_out' });
  assert.deepEqual(transitionBlueprintFlowControl('doOnce', 'exec_in', true, false), { closed: true, output: 'blocked' });
  assert.deepEqual(transitionBlueprintFlowControl('doOnce', 'reset', true, true), { closed: false, output: 'updated' });
  assert.equal(transitionBlueprintFlowControl('doOnce', 'toggle', false, false), undefined);
});

test('Gate operations never enter the pass output and reset restores its authored initial state', () => {
  for (const initial of [true, false]) {
    assert.deepEqual(transitionBlueprintFlowControl('gate', 'reset', !initial, initial), { closed: initial, output: 'updated' });
    assert.deepEqual(transitionBlueprintFlowControl('gate', 'open', initial, initial), { closed: false, output: 'updated' });
    assert.deepEqual(transitionBlueprintFlowControl('gate', 'close', initial, initial), { closed: true, output: 'updated' });
    assert.deepEqual(transitionBlueprintFlowControl('gate', 'toggle', initial, initial), { closed: !initial, output: 'updated' });
    assert.deepEqual(transitionBlueprintFlowControl('gate', 'exec_in', initial, initial), { closed: initial, output: initial ? 'blocked' : 'exec_out' });
  }
});

test('one invocation shares control state through loop iterations and explicit reset, while the next invocation starts fresh', () => {
  const f = createBlueprintFlowControlFixture(), context = previewActionContext(f.project); context.trace = new BlueprintTraceRecorder();
  expandPreviewActions(f.project, [{ kind: 'blueprint', blueprintId: f.local.id }, { kind: 'blueprint', blueprintId: f.local.id }], context);
  assert.equal(context.incomplete, false); assert.equal(context.variables.local_hits, 4); assert.equal(context.variables.local_blocked, 4);
  const entries = context.trace.snapshot().entries.filter(e => e.nodeId === f.localOnce.id && e.kind === 'branch');
  assert.deepEqual(entries.map(e => e.pinId), Array(2).fill(['exec_out', 'blocked', 'blocked', 'updated', 'exec_out']).flat());
  assert.equal(new Set(entries.map(e => e.invocationId)).size, 2);
});

test('page Do Once shares across two event roots and author-variable writes do not erase its state', () => {
  const { result } = sample(['control_once_a', 'control_once_b', 'control_once_reset', 'control_once_a', 'control_once_b'].map(click));
  assert.equal(result.variables.once_hits, 2); assert.equal(result.variables.once_blocked, 2); assert.equal(result.variables.once_resets, 1);
  const trace = result.trace!.entries.filter(e => e.kind === 'branch' && e.scope === 'page');
  assert.equal(new Set(trace.map(e => e.targetPageInstance)).size, 1); assert.equal(new Set(trace.map(e => e.invocationId)).size, 5);
});

test('different incoming exec pins reach open/close/toggle/reset rather than accidentally executing Gate', () => {
  const { result } = sample(['control_gate_enter', 'control_gate_open', 'control_gate_enter', 'control_gate_close', 'control_gate_enter', 'control_gate_toggle', 'control_gate_enter', 'control_gate_reset', 'control_gate_enter'].map(click));
  assert.equal(result.variables.gate_hits, 2); assert.equal(result.variables.gate_blocked, 3); assert.equal(result.variables.gate_updates, 4);
});

test('a shared module remembers per actual page parameter, survives a child menu, and resets only the reopened child', () => {
  const f = createBlueprintFlowControlFixture();
  const { result } = sample(['control_shared_root', 'control_shared_root', 'control_child', 'control_shared_child', 'control_shared_child', f.child.components[1].id, 'control_shared_root', 'control_child', 'control_shared_child'].map(click), f);
  assert.equal(result.variables.shared_hits, 3); assert.equal(result.variables.shared_blocked, 3);
  const entries = result.trace!.entries.filter(e => e.nodeId === f.sharedOnce.id && e.kind === 'branch');
  assert.equal(new Set(entries.map(e => e.targetPageInstance)).size, 3);
});

test('another event is blocked while the successful Do Once continuation is waiting', () => {
  const { result } = sample([click('control_wait_a'), advance(.2), click('control_wait_b'), advance(1.5)]);
  assert.equal(result.variables.wait_started, 1); assert.equal(result.variables.wait_blocked, 1); assert.equal(result.variables.wait_done, 1);
});

test('closing a page cancels its waiting continuation without rolling back the already-consumed event', () => {
  const f = createBlueprintFlowControlFixture(), { result } = sample([click('control_wait_a'), click(f.root.components[1].id), advance(2)], f);
  assert.equal(result.variables.wait_started, 1); assert.equal(result.variables.wait_done, 0); assert.equal(result.closed, true);
});

test('reopening the same page restores initial control state and cannot wake a stale cancelled continuation', () => {
  const f = createBlueprintFlowControlFixture(), host = createCustomUiPage(f.project, '外层验收页'), open = f.graph('外层打开控制页');
  f.chain(open, open.nodes[0], f.node(open, 'showUiPage', { pageId: f.root.id, wait: true }));
  host.components.push({ id: 'open_controls', text: '打开', kind: 'button', page: 'custom', x: .3, y: .4, width: .4, height: .1, action: 'blueprint', blueprintId: open.id });
  const result = previewUiLogic(f.project, host.components, host.id, {}, [click('open_controls'), click('control_once_a'), click('control_wait_a'), click(f.root.components[1].id), click('open_controls'), click('control_once_a'), click('control_wait_b'), advance(1.7)], { timed: true });
  assert.equal(result.incomplete, false); assert.equal(result.variables.once_hits, 2); assert.equal(result.variables.wait_started, 2); assert.equal(result.variables.wait_done, 1);
});

test('built-in templates use the same instance-owned control mechanism as newly authored pages', () => {
  const f = createBlueprintFlowControlFixture();
  const result = previewUiLogic(f.project, uiPageComponents(f.project, 'ui:preferences'), 'ui:preferences', {}, [click('control_native_once'), click('control_native_once')], { timed: true });
  assert.equal(result.incomplete, false); assert.equal(result.variables.once_hits, 1); assert.equal(result.variables.once_blocked, 1);
});

test('page input signatures survive save/reopen and scope changes remove only their obsolete pin', () => {
  const f = createBlueprintFlowControlFixture(); const before = structuredClone(f.project); const parsed = projectSchema.parse(JSON.parse(JSON.stringify(f.project)));
  assert.deepEqual(parsed, before); assert.equal(f.once.pins.find(p => p.id === 'pageId')?.dataType, 'ui');
  f.once.properties.scope = 'call'; synchronizeBlueprintSignatures(f.project);
  assert.equal(f.once.pins.some(p => p.id === 'pageId'), false); assert.deepEqual(f.once.pins.filter(p => p.direction === 'input').map(p => p.id), ['exec_in', 'reset']);
});

test('invalid scope, initial-state type, missing page and missing exec entries are diagnosable rather than coerced', () => {
  const f = createBlueprintFlowControlFixture(); f.once.properties.scope = 'persistent'; f.gate.properties.initiallyClosed = 0;
  f.waitingOnce.properties.pageId = 'missing'; f.localOnce.pins = f.localOnce.pins.filter(p => p.id !== 'reset');
  const messages = validateBlueprints(f.project).map(d => d.message).join('\n');
  assert.match(messages, /状态型节点只支持/); assert.match(messages, /初始关闭状态必须为开关/); assert.match(messages, /页面实例门控需要/); assert.match(messages, /执行入口：reset/);
});

test('unknown dynamic target cannot silently use the editor or current page', () => {
  const f = createBlueprintFlowControlFixture(), caller = f.project.blueprints.find(g => g.nodes.some(n => n.type === 'callFunction' && n.properties.arg_page === f.root.id))!;
  caller.nodes.find(n => n.type === 'callFunction')!.properties.arg_page = 'missing';
  const result = previewUiLogic(f.project, f.root.components, f.root.id, {}, [click('control_shared_root')], { timed: true });
  assert.equal(result.incomplete, true); assert.equal(result.variables.shared_hits, 0);
});

test('static call analysis honors operation entry and does not claim an unreachable pass branch executes', () => {
  const f = createBlueprintFlowControlFixture(), g = f.graph('只打开门'), gate = f.node(g, 'gate'), dialogue = f.node(g, 'startDialogue');
  f.wire(g, g.nodes[0], gate, 'exec', 'open'); f.wire(g, gate, dialogue);
  assert.deepEqual(blueprintCapabilitySummary(f.project, g).required, []);
  f.wire(g, g.nodes[0], gate); gate.properties.initiallyClosed = false;
  assert.ok(blueprintCapabilitySummary(f.project, g).required.includes('dialogue'));
});

test('moving a stateful control across a module boundary is refused with an explicit lifetime explanation', () => {
  const f = createBlueprintFlowControlFixture(), result = inspectBlueprintEncapsulation(f.project, f.local.id, [f.localOnce.id]);
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.message, /状态型节点.*身份/);
});

test('compiled controls retain incoming operation, explicit scope, COW state and existing source project', () => {
  const f = createBlueprintFlowControlFixture(), before = structuredClone(f.project), compiled = compileProject(f.project);
  assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), []); assert.deepEqual(f.project, before);
  const script = compiled.files['game/story.rpy'];
  assert.match(script, /vn_bp_control_step\("page",.*"gate", "open", True\)/);
  assert.match(script, /vn_bp_control_step\("page",.*"gate", "toggle", True\)/);
  assert.match(script, /records\[owner\] = dict\(record, task=task, page=page_id, controls=controls\)/);
  assert.match(script, /records\[key\] = dict\(records.get\(key, \{\}\), task=task, page=page_id, values=values\)/);
});

test('an initially consumed Do Once resets open while an initially open Gate resets to open', () => {
  const { result } = sample([click('control_initials')]);
  assert.equal(result.variables.once_hits, 1); assert.equal(result.variables.once_blocked, 1); assert.equal(result.variables.once_resets, 1);
  assert.equal(result.variables.gate_hits, 2); assert.equal(result.variables.gate_blocked, 1); assert.equal(result.variables.gate_updates, 2);
});

test('an unavailable wired page input never falls back to the declared page', () => {
  const f = createBlueprintFlowControlFixture(); delete f.shared.exposedInputs[0].defaultValue;
  const caller = f.project.blueprints.find(g => g.nodes.some(n => n.type === 'callFunction' && n.properties.arg_page === f.root.id))!;
  delete caller.nodes.find(n => n.type === 'callFunction')!.properties.arg_page; synchronizeBlueprintSignatures(f.project);
  const result = previewUiLogic(f.project, f.root.components, f.root.id, {}, [click('control_shared_root')], { timed: true });
  assert.equal(result.incomplete, true); assert.equal(result.variables.shared_hits, 0); assert.equal(result.variables.shared_blocked, 0);
});

test('finite reset-after-work and close/work/open back-links remain valid while true execution cycles are refused', () => {
  const f = createBlueprintFlowControlFixture();
  assert.ok(!validateBlueprints(f.project).some(issue => /执行线形成了循环/.test(issue.message)));
  const before = structuredClone(f.pageGraph.links);
  assert.match(connectBlueprintPins(f.pageGraph, f.rearm.id, 'updated', f.rearm.id, 'exec_in')!, /循环/);
  assert.deepEqual(f.pageGraph.links, before);
  assert.match(connectBlueprintPins(f.pageGraph, f.busy.id, 'updated', f.busy.id, 'exec_in')!, /循环/);
  f.pageGraph.links.push({ id: 'bad_cycle', fromNodeId: f.rearm.id, fromPinId: 'updated', toNodeId: f.rearm.id, toPinId: 'exec_in' });
  assert.ok(validateBlueprints(f.project).some(issue => /执行线形成了循环/.test(issue.message)));
});

test('Do Once can automatically reset after waiting and its updated output is not replayed by the outer branch', () => {
  const { result } = sample([click('control_rearm_a'), click('control_rearm_b'), advance(.9), click('control_rearm_b'), advance(.9)]);
  assert.equal(result.variables.rearm_hits, 2); assert.equal(result.variables.rearm_blocked, 1); assert.equal(result.variables.rearm_done, 2);
});

test('Gate closes before asynchronous work and reopens afterward without blocking control operations', () => {
  const { result } = sample([click('control_busy_a'), click('control_busy_b'), advance(.9), click('control_busy_b'), advance(.9)]);
  assert.equal(result.variables.busy_hits, 2); assert.equal(result.variables.busy_blocked, 1); assert.equal(result.variables.busy_done, 2);
});
