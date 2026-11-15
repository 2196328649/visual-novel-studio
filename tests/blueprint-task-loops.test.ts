import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlueprintTaskBoundaryFixture } from '../scripts/lib/blueprint-task-boundary-fixture';
import { previewActionContext, previewActionRunner } from '../src/core/preview-actions';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import type { VariableValue } from '../src/core/model';

const click = (componentId: string): UiPreviewEvent => ({ kind: 'click', componentId });
const advance = (seconds: number): UiPreviewEvent => ({ kind: 'advance', seconds });
function runnerFor(inputs: Record<string, VariableValue>, cooperative = true) {
  const f = createBlueprintTaskBoundaryFixture(), context = previewActionContext(f.project);
  const runner = previewActionRunner(f.project, [{ kind: 'blueprint', blueprintId: f.worker.id, inputs }], context, undefined, undefined, undefined, undefined, { cooperative });
  return { f, context, runner };
}
function finish(runner: ReturnType<typeof previewActionRunner>) {
  let checkpoints = 0, next = runner.iterator.next();
  while (!next.done) { assert.equal(next.value.kind, 'taskCheckpoint'); assert.ok(++checkpoints <= 100005, 'the task must fail at its own step budget'); next = runner.iterator.next(); }
  return checkpoints;
}

test('an empty task loop over 256 iterations yields each next step and publishes last + 1', () => {
  const { f, context, runner } = runnerFor({ first: 0, last: 599 });
  assert.equal(finish(runner), 604); // entry, loop, 600 next checks, two output nodes
  assert.deepEqual(runner.outputs(f.worker.id), { final_index: 600, completed: true });
  assert.equal(runner.failed(), false); assert.equal(context.incomplete, false);
});

test('a descending empty range preserves its initial index and still completes', () => {
  const { f, runner } = runnerFor({ first: 5, last: 3 });
  assert.equal(finish(runner), 4); assert.deepEqual(runner.outputs(f.worker.id), { final_index: 5, completed: true });
});

test('return inside a loop does not advance the index or execute its completed route', () => {
  const f = createBlueprintTaskBoundaryFixture(), context = previewActionContext(f.project);
  const runner = previewActionRunner(f.project, [{ kind: 'blueprint', blueprintId: f.early.id }], context, undefined, undefined, undefined, undefined, { cooperative: true });
  assert.equal(finish(runner), 4); assert.deepEqual(runner.outputs(f.early.id), { final_index: 2, completed: false });
});

test('cancelling at an empty-body checkpoint cannot publish a completed result', () => {
  const { f, context, runner } = runnerFor({ first: 0, last: 599 });
  for (let i = 0; i < 8; i++) assert.equal(runner.iterator.next().done, false);
  runner.cancel('test cancellation'); runner.iterator.return();
  assert.deepEqual(runner.outputs(f.worker.id), {}); assert.equal(context.incomplete, false);
});

test('an empty loop cannot evade the task total step limit', () => {
  const { f, context, runner } = runnerFor({ first: 0, last: 99999 });
  assert.equal(finish(runner), 100001); assert.equal(runner.failed(), true); assert.equal(runner.failureReason(), 'stepLimit');
  assert.equal(context.incomplete, true); assert.deepEqual(runner.outputs(f.worker.id), { final_index: -1, completed: false });
});

test('loop bounds reject coercion, fractions and out-of-range values in both interpreters', () => {
  for (const cooperative of [true, false]) for (const value of [false, true, '2', '', .5, NaN, Infinity, 100001]) {
    const { f, context, runner } = runnerFor({ first: value, last: 3 }, cooperative);
    finish(runner); assert.equal(context.incomplete, true, String(value)); assert.equal(runner.failureReason(), 'executionFailed');
    assert.deepEqual(runner.outputs(f.worker.id), { final_index: -1, completed: false });
  }
});

test('static preview retains its explicit small budget instead of claiming a long task completed', () => {
  const { f, context, runner } = runnerFor({ first: 0, last: 256 }, false);
  finish(runner); assert.equal(context.incomplete, true); assert.equal(runner.outputs(f.worker.id).completed, false);
});

test('a long empty-body task lets a short task finish before itself', () => {
  const f = createBlueprintTaskBoundaryFixture();
  const result = previewUiLogic(f.project, f.page.components, f.page.id, {}, [click('boundary_normal'), click('boundary_short'), advance(.02)], { timed: true });
  assert.equal(result.variables.short_done, 1); assert.equal(result.exhausted, false);
  assert.ok(result.tasks.some(task => task.graphId === f.worker.id && ['running', 'waiting'].includes(task.status)));
  const complete = previewUiLogic(f.project, f.page.components, f.page.id, {}, [click('boundary_normal'), advance(.3)], { timed: true });
  assert.equal(complete.incomplete, false); assert.deepEqual(complete.tasks[0].outputs, { final_index: 600, completed: true });
});

test('global preview exhaustion freezes unfinished task state without publishing success or cancellation', () => {
  const f = createBlueprintTaskBoundaryFixture();
  const result = previewUiLogic(f.project, f.page.components, f.page.id, {}, [click('boundary_long'), click('boundary_short'), advance(3)], { timed: true, trace: true });
  assert.equal(result.exhausted, true); assert.equal(result.incomplete, true); assert.match(result.stopReason!, /上限/);
  assert.equal(result.variables.short_done, 1); assert.ok(result.elapsed < 3);
  const pending = result.tasks.find(task => task.graphId === f.worker.id)!;
  assert.ok(['running', 'waiting'].includes(pending.status)); assert.equal(pending.reason, ''); assert.deepEqual(pending.outputs, {});
  assert.ok(result.trace?.entries.some(entry => entry.reason?.includes('这不是任务完成')));
});

test('the preview duration ceiling is not completion of a longer timed task', () => {
  const f = createBlueprintTaskBoundaryFixture(), waiting = f.graph('长等待'); f.chain(waiting, waiting.nodes[0], f.node(waiting, 'delay', { seconds: 120 }));
  f.buttons.boundary_long.properties.graphId = waiting.id;
  const result = previewUiLogic(f.project, f.page.components, f.page.id, {}, [click('boundary_long'), advance(60)], { timed: true });
  assert.equal(result.exhausted, true); assert.match(result.stopReason!, /60 秒/); assert.equal(result.tasks[0].status, 'waiting'); assert.equal(result.tasks[0].reason, '');
});
