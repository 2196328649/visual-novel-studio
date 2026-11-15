import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlueprintTaskOwnershipFixture } from '../scripts/lib/blueprint-task-ownership-fixture';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { blueprintTaskActiveLimit, blueprintTaskResultLimit } from '../src/core/blueprint-tasks';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { compileProject } from '../src/runtime/compiler';

const click = (name: string): UiPreviewEvent => ({ kind: 'click', componentId: 'ownership_action_' + name.toLowerCase() });
const advance = (seconds: number): UiPreviewEvent => ({ kind: 'advance', seconds });
const sample = (f: ReturnType<typeof createBlueprintTaskOwnershipFixture>, events: UiPreviewEvent[]) => {
  const before = structuredClone(f.project), result = previewUiLogic(f.project, f.page.components, f.page.id, {}, events, { timed: true, trace: true });
  assert.deepEqual(f.project, before); return result;
};
const active = (result: ReturnType<typeof sample>) => result.tasks.filter(task => ['queued', 'running', 'waiting'].includes(task.status));
const task = (result: ReturnType<typeof sample>, variable: string) => result.tasks.find(task => task.handle === result.variables[variable])!;
const opacity = (result: ReturnType<typeof sample>, name: string) => result.components.find(row => row.component.id === 'ownership_target_' + name)!.component.style?.opacity ?? 1;

test('exactly 256 active tasks are admitted; overflow takes the blocked route without a ghost handle', () => {
  const f = createBlueprintTaskOwnershipFixture(), result = sample(f, [click('fill'), click('fill'), click('single')]);
  assert.equal(result.incomplete, false); assert.equal(result.exhausted, false);
  assert.equal(active(result).length, blueprintTaskActiveLimit); assert.equal(result.variables.ownership_assigned, 256); assert.equal(result.variables.ownership_blocked, 1);
  assert.equal(result.variables.ownership_first, ''); assert.equal(result.tasks.length, 256);
});

test('replace frees its own slot even at capacity, while ignore retains its old handle', () => {
  const f = createBlueprintTaskOwnershipFixture(), events = [click('replace'), click('fill'), click('fill')], before = sample(f, events), after = sample(f, [...events, click('replace')]);
  assert.equal(after.incomplete, false); assert.equal(active(after).length, 256); assert.notEqual(after.variables.ownership_replace, before.variables.ownership_replace);
  assert.equal(after.tasks.find(task => task.handle === before.variables.ownership_replace)!.reason, 'replaced'); assert.equal(after.variables.ownership_blocked, 1);
  const ignored = sample(f, [click('ignore'), click('fill'), click('fill'), click('ignore')]);
  assert.equal(ignored.incomplete, false); assert.equal(active(ignored).length, 256); assert.equal(ignored.variables.ownership_blocked, 2); assert.equal(ignored.tasks.filter(t => t.reason === 'replaced').length, 0);
});

test('512 results are retained by completion order, not the creation serial', () => {
  const f = createBlueprintTaskOwnershipFixture(); f.project.variables.find(v => v.id === 'ownership_delay')!.initial = 0;
  const events: UiPreviewEvent[] = [click('old')]; for (let i = 0; i < 4; i++) events.push(click('fill'), advance(1));
  const before = sample(f, events), old = task(before, 'ownership_old'), firstFinished = before.tasks.find(task => task.handle !== old.handle)!;
  assert.equal(before.incomplete, false); assert.equal(before.tasks.length, 513); assert.equal(active(before).length, 1);
  const after = sample(f, [...events, advance(27)]); assert.equal(after.incomplete, false); assert.equal(after.exhausted, false);
  assert.equal(after.tasks.length, blueprintTaskResultLimit); assert.equal(active(after).length, 0); assert.equal(after.tasks.some(task => task.handle === firstFinished.handle), false);
  assert.equal(task(after, 'ownership_old').status, 'completed'); assert.deepEqual(task(after, 'ownership_old').outputs, { false_value: false, empty_value: '' });
});

test('three-task dependency cycles fail one participant and release both surviving waiters', () => {
  const f = createBlueprintTaskOwnershipFixture(), result = sample(f, [click('cycles'), advance(.8)]);
  assert.equal(result.incomplete, false); assert.equal(result.taskWaiting, 0); assert.equal(active(result).length, 0);
  assert.equal(result.tasks.filter(task => task.reason === 'dependencyCycle').length, 1); assert.equal(result.tasks.filter(task => task.status === 'completed').length, 2);
  assert.equal(result.variables.ownership_resumes, 2); assert.deepEqual(result.tasks.find(task => task.status === 'failed')!.outputs, {});
});

test('cancelling nested task frames releases call-owned children but not page-detached children', () => {
  const f = createBlueprintTaskOwnershipFixture(), events = [click('parent'), advance(.3)], running = sample(f, events);
  assert.equal(running.incomplete, false); assert.equal(active(running).length, 3); assert.equal(running.variables.ownership_side_effect, 42);
  const result = sample(f, [...events, click('cancelParent'), advance(1.5)]);
  assert.equal(result.incomplete, false); assert.equal(task(result, 'ownership_parent').status, 'cancelled'); assert.equal(task(result, 'ownership_call_child').reason, 'callEnded');
  assert.equal(task(result, 'ownership_page_child').status, 'completed'); assert.equal(result.variables.ownership_late, 0); assert.equal(result.variables.ownership_side_effect, 42);
  assert.equal(result.taskWaiting, 0); assert.equal(result.stageWaiting, 0);
});

test('normal parent return also ends its call lease while page ownership survives independently', () => {
  const f = createBlueprintTaskOwnershipFixture(); f.parentStart.properties.arg_lifetime = .05;
  const result = sample(f, [click('parent'), advance(1.6)]); assert.equal(result.incomplete, false);
  assert.equal(task(result, 'ownership_parent').status, 'completed'); assert.equal(task(result, 'ownership_call_child').reason, 'callEnded'); assert.equal(task(result, 'ownership_page_child').status, 'completed');
  assert.equal(result.variables.ownership_late, 1); assert.equal(active(result).length, 0);
});

test('page close cancels queued, nested and detached tasks without undoing prior writes', () => {
  const f = createBlueprintTaskOwnershipFixture(), result = sample(f, [click('parent'), click('single'), advance(.3), click('close'), advance(2)]);
  assert.equal(result.incomplete, false); assert.equal(result.closed, true); assert.equal(active(result).length, 0);
  assert.ok(result.tasks.every(task => task.status === 'cancelled')); assert.equal(result.variables.ownership_side_effect, 42); assert.equal(result.variables.ownership_late, 0);
  assert.equal(result.taskWaiting, 0); assert.equal(result.stageWaiting, 0);
});

test('cancelling a multitrack task stops only its remaining tracks and resumes external waiters once', () => {
  const f = createBlueprintTaskOwnershipFixture(), events = [click('clip'), advance(.3), click('wait'), click('override'), advance(.1), click('cancelAnimation')], stopped = sample(f, events);
  assert.equal(stopped.incomplete, false); assert.equal(task(stopped, 'ownership_animation').status, 'cancelled');
  assert.equal(stopped.variables.ownership_wait_cancelled, 1); assert.equal(stopped.variables.ownership_wait_completed, 0);
  const result = sample(f, [...events, advance(2)]); assert.equal(result.incomplete, false);
  assert.equal(opacity(result, 'a'), 1); assert.equal(opacity(result, 'b'), opacity(stopped, 'b')); assert.ok(opacity(result, 'b') > 0 && opacity(result, 'b') < 1);
  assert.equal(result.variables.ownership_late, 0); assert.equal(result.variables.ownership_wait_cancelled, 1); assert.equal(result.taskWaiting, 0);
});

test('nonwaited animation outlives a successfully completed task, not a cancelled task', () => {
  const f = createBlueprintTaskOwnershipFixture(), result = sample(f, [click('detached'), advance(.3)]);
  assert.equal(task(result, 'ownership_animation').status, 'completed'); assert.ok(opacity(result, 'a') < 1 && opacity(result, 'a') > 0);
  assert.equal(opacity(sample(f, [click('detached'), advance(1.2)]), 'a'), 0);
  const stoppedEvents = [click('detached'), advance(.08), click('cancelAnimation')], stopped = sample(f, stoppedEvents);
  assert.equal(task(stopped, 'ownership_animation').status, 'cancelled'); assert.equal(opacity(sample(f, [...stoppedEvents, advance(1.2)]), 'a'), opacity(stopped, 'a'));
});

test('failed tasks discard partial typed outputs just as the native task executor does', () => {
  const f = createBlueprintTaskOwnershipFixture(); f.starts.single.properties.seconds = 0;
  f.fast.nodes.find(node => node.type === 'setOutput' && node.properties.outputId === 'empty_value')!.properties.value = false;
  const result = sample(f, [click('single'), advance(.3)]);
  assert.equal(task(result, 'ownership_first').status, 'failed'); assert.deepEqual(task(result, 'ownership_first').outputs, {});
});

test('the complete ownership fixture is valid and both compiled cancellation paths share reason codes', () => {
  const f = createBlueprintTaskOwnershipFixture(); assert.deepEqual(validateBlueprints(f.project).filter(issue => issue.severity === 'error'), []);
  const compiled = compileProject(f.project); assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  const code = Object.values(compiled.files).join('\n'); assert.ok(code.includes('"failed", "dependencyCycle"')); assert.ok(code.includes('def vn_bp_require_frame'));
});
