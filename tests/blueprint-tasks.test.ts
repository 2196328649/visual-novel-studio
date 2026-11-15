import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprintCatalog, blueprintNodeDefaults, blueprintPin, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { blueprintTaskFinished, blueprintTaskProblems, transitionBlueprintThrottle } from '../src/core/blueprint-tasks';
import { createBlueprintTaskFixture } from '../scripts/lib/blueprint-task-fixture';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { compileProject } from '../src/runtime/compiler';
import { projectSchema } from '../src/core/model';
import { inspectBlueprintInterfaceChange } from '../src/core/blueprint-interface';
import { blueprintExecutionOutputs } from '../src/core/blueprint-execution-ports';

const click = (componentId: string): UiPreviewEvent => ({ kind: 'click', componentId });
const advance = (seconds: number): UiPreviewEvent => ({ kind: 'advance', seconds });
function sample(events: UiPreviewEvent[], f = createBlueprintTaskFixture()) {
  const before = structuredClone(f.project);
  const result = previewUiLogic(f.project, f.page.components, f.page.id, {}, events, { timed: true, trace: true });
  assert.deepEqual(f.project, before); assert.equal(result.incomplete, false); assert.equal(result.exhausted, false);
  return { f, result };
}

test('task nodes have versioned stable pins, Chinese/English names and only existing lifetimes', () => {
  for (const type of ['throttle','debounce','startTask','cancelTask','waitTask','taskStatus'] as const) {
    const node = blueprintNodeDefaults(type); assert.equal(node.properties.taskVersion, 1); assert.match(blueprintCatalog[type].name, /[A-Za-z]/);
    assert.ok(!String(node.properties.scope).includes('minigame'));
  }
  assert.deepEqual(blueprintExecutionOutputs(blueprintNodeDefaults('throttle'), 'reset'), ['updated']);
  assert.deepEqual(blueprintExecutionOutputs(blueprintNodeDefaults('throttle')), ['exec_out','blocked']);
  assert.ok(blueprintNodeDefaults('taskStatus').pins.every(pin => pin.dataType !== 'exec'));
  assert.equal(blueprintNodeDefaults('startTask').pins.find(pin => pin.id === 'handle')?.dataType, 'string');
});

test('leading throttle preserves the original deadline and has exact boundary/reset semantics', () => {
  assert.deepEqual(transitionBlueprintThrottle('exec_in', undefined, 1, .5), { until: 1.5, output: 'exec_out' });
  assert.deepEqual(transitionBlueprintThrottle('exec_in', 1.5, 1.49, 50), { until: 1.5, output: 'blocked' });
  assert.deepEqual(transitionBlueprintThrottle('exec_in', 1.5, 1.5, 0), { until: 1.5, output: 'exec_out' });
  assert.deepEqual(transitionBlueprintThrottle('reset', 8, 1, 0), { output: 'updated' });
  for (const invalid of [-1, Infinity, NaN, true, '0']) assert.equal(transitionBlueprintThrottle('exec_in', undefined, 0, invalid), undefined);
});

test('repeated clicks are throttled, not extended; reset does not execute the pass route', () => {
  const { result } = sample([click('task_throttle'), advance(.2), click('task_throttle'), advance(.31), click('task_throttle'), click('task_throttle_reset'), click('task_throttle')]);
  assert.equal(result.variables.throttle_pass, 3); assert.equal(result.variables.throttled, 1); assert.equal(result.variables.throttle_reset, 1);
});

test('debounce accepts reentry of the SAME click event and retains only the last input snapshot', () => {
  const events = [click('task_debounce'), advance(.1), click('task_debounce'), advance(.1), click('task_debounce')];
  let result = sample([...events, advance(.29)]).result;
  assert.equal(result.variables.payload, 3); assert.equal(result.variables.started, 0); assert.equal(result.tasks.filter(task => task.status === 'cancelled').length, 2);
  result = sample([...events, advance(.8)]).result;
  assert.equal(result.variables.started, 1); assert.equal(result.variables.finished, 1); assert.equal(result.variables.last_value, 3);
  assert.ok(!result.trace?.entries.some(record => record.reason?.includes('重复触发已忽略')));
  const completed = result.tasks.find(task => task.status === 'completed')!;
  assert.deepEqual(completed.outputs, { value_output: 3, false_output: false, empty_output: '' });
});

test('a short task completes while an earlier long task is still waiting', () => {
  const events = [click('task_slow'), advance(.05), click('task_fast'), advance(.35)];
  let result = sample(events).result;
  assert.equal(result.variables.started, 2); assert.equal(result.variables.finished, 1); assert.equal(result.variables.last_value, 2);
  assert.equal(result.tasks.filter(task => task.status === 'waiting').length, 1);
  result = sample([...events, advance(1.2)]).result;
  assert.equal(result.variables.finished, 2); assert.equal(result.variables.last_value, 1);
  assert.ok(result.tasks.every(task => task.status === 'completed'));
});

test('cancel a running task and resume its external waiter exactly once without executing remaining writes', () => {
  const { result } = sample([click('task_slow'), advance(.1), click('task_await'), click('task_cancel'), advance(2)]);
  assert.equal(result.variables.started, 1); assert.equal(result.variables.finished, 0); assert.equal(result.variables.cancelled, true);
  assert.equal(result.variables.await_cancelled, 1); assert.equal(result.variables.await_done, 0); assert.equal(result.taskWaiting, 0); assert.equal(result.stageWaiting, 0);
  assert.equal(result.tasks[0].reason, 'cancelled');
});

test('cancel is idempotent, and an empty handle returns the missing route instead of completing a task', () => {
  const { result } = sample([click('task_await'), click('task_cancel'), click('task_cancel')]);
  assert.equal(result.variables.await_missing, 1); assert.equal(result.variables.await_done, 0); assert.equal(result.variables.cancelled, false);
});

test('replacing running work cancels the old continuation rather than merely replacing a timer', () => {
  const { result } = sample([click('task_replace'), advance(.1), click('task_replace'), advance(1)]);
  assert.equal(result.variables.started, 2); assert.equal(result.variables.finished, 1); assert.equal(result.variables.last_value, 2);
  assert.equal(result.tasks.find(task => task.status === 'cancelled')?.reason, 'replaced');
});

test('ignore and call ownership never create orphan work after a callback returns', () => {
  let result = sample([click('task_ignore'), click('task_ignore'), advance(1)]).result;
  assert.equal(result.variables.started, 1); assert.equal(result.variables.finished, 1);
  result = sample([click('task_orphan'), advance(1)]).result;
  assert.equal(result.variables.started, 0); assert.equal(result.tasks[0].reason, 'callEnded');
  result = sample([click('task_call'), advance(1)]).result;
  assert.equal(result.variables.call_done, 1); assert.equal(result.variables.started, 1); assert.equal(result.variables.finished, 1);
});

test('closing a page cancels queued and active tasks without later writes', () => {
  const f = createBlueprintTaskFixture(), close = click(f.page.components[1].id);
  const { result } = sample([click('task_slow'), advance(.1), click('task_debounce'), close, advance(2)], f);
  assert.equal(result.closed, true); assert.equal(result.variables.started, 1); assert.equal(result.variables.finished, 0);
  assert.ok(result.tasks.every(task => task.status === 'cancelled')); assert.equal(result.stageWaiting, 0);
});

test('native templates use the same owner token and cancel their pending debounce on return', () => {
  const { result } = sample([click('task_native'), click('task_native_debounce'), click('task_native_debounce'), click('task_native_close'), advance(1)]);
  assert.equal(result.variables.native_done, 1); assert.equal(result.variables.started, 0);
  assert.ok(result.tasks.every(task => task.status === 'cancelled'));
});

test('task output and input signatures keep stable ids and preserve incompatible values/wires', () => {
  const f = createBlueprintTaskFixture();
  f.worker.exposedInputs[0].name = '重命名输入'; f.worker.exposedInputs.reverse(); synchronizeBlueprintSignatures(f.project);
  assert.ok(f.parallel.pins.some(pin => pin.id === 'arg_payload_input' && pin.name === '重命名输入'));
  const plan = inspectBlueprintInterfaceChange(f.project, f.worker.id, { kind: 'update', direction: 'output', pinId: 'value_output', patch: { dataType: 'string' } });
  assert.ok(plan.impacts.some(impact => impact.kind === 'invalidLink'));
  const required = inspectBlueprintInterfaceChange(f.project, f.worker.id, { kind: 'add', direction: 'input', pin: { ...blueprintPin('new_required', '新增必填参数', 'input', 'asset'), required: true } });
  assert.ok(!required.impacts.some(impact => impact.location.kind === 'blueprint' && impact.location.nodeId === f.wait.id && impact.kind === 'invalidValue'));
  f.worker.exposedOutputs = f.worker.exposedOutputs.filter(pin => pin.id !== 'value_output'); synchronizeBlueprintSignatures(f.project);
  assert.ok(!f.wait.pins.some(pin => pin.id === 'out_value_output')); assert.ok(!f.pageGraph.links.some(link => link.fromNodeId === f.wait.id && link.fromPinId === 'out_value_output'));
});

test('unknown task versions preserve raw pins/properties and are diagnosed instead of rewritten', () => {
  const f = createBlueprintTaskFixture(); f.parallel.properties.taskVersion = 42;
  const before = structuredClone(f.parallel); synchronizeBlueprintSignatures(f.project);
  assert.deepEqual(f.parallel, before); assert.deepEqual(projectSchema.parse(f.project).blueprints.find(graph => graph.id === f.pageGraph.id)!.nodes.find(node => node.id === f.parallel.id)!.properties, before.properties);
  assert.ok(validateBlueprints(f.project).some(issue => issue.nodeId === f.parallel.id && issue.message.includes('版本')));
});

test('background module restrictions include nested calls but not unrelated event paths', () => {
  const f = createBlueprintTaskFixture(); assert.deepEqual(blueprintTaskProblems(f.project, f.worker.id), []);
  const unsafe = f.graph('前台导航'); f.wire(unsafe, unsafe.nodes[0], f.node(unsafe, 'showUiPage', { pageId: f.page.id }));
  const call = f.node(f.worker, 'callFunction', { graphId: unsafe.id });
  const tail = f.worker.nodes.find(node => node.type === 'setOutput' && node.properties.outputId === 'empty_output')!; f.wire(f.worker, tail, call);
  assert.ok(blueprintTaskProblems(f.project, f.worker.id).some(issue => issue.graphId === unsafe.id && issue.message.includes('前台')));
});

test('compile emits serializable continuations and frame cleanup instead of nested task contexts', () => {
  const f = createBlueprintTaskFixture(), before = structuredClone(f.project), compiled = compileProject(f.project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []); assert.deepEqual(f.project, before);
  const code = Object.values(compiled.files).join('\n');
  assert.ok(code.includes('def vn_bp_async_step(handle, now)')); assert.ok(code.includes('vn_bp_async_steps['));
  assert.ok(code.includes('vn_bp_close_label_frames_since(frame_ids)')); assert.ok(code.includes('vn_bp_async_needs_tick()'));
  assert.ok(code.includes('def vn_bp_async_return_frames')); assert.ok(code.includes('vn_bp_leave_frame()'));
  assert.ok(code.includes('sample[0] is vn_bp_temporal_clock'));
  const taskCode = code.slice(code.indexOf('    def vn_bp_async_step'), code.indexOf('    def vn_bp_async_needs_tick'));
  assert.ok(!taskCode.includes('call_in_new_context')); assert.ok(!taskCode.includes('renpy.pause('));
  for (const status of ['completed','cancelled','failed','missing'] as const) assert.equal(blueprintTaskFinished(status), true);
});


test('nested task calls preserve typed output slots in the parent task frame', () => {
  const { result } = sample([click('task_nested'), advance(1)]);
  assert.equal(result.variables.started, 1); assert.equal(result.variables.finished, 1);
  assert.deepEqual(result.tasks[0].outputs, { value_output: 7, false_output: false, empty_output: '' });
});

test('cancelling an animation task stops its resource and never executes completion writes', () => {
  const events = [click('task_animation'), advance(.3), click('task_cancel')];
  const before = sample(events), after = sample([...events, advance(1.5)], before.f);
  const opacity = (result: typeof before.result) => result.components.find(row => row.component.id === before.f.page.components[0].id)!.component.style?.opacity ?? 1;
  assert.ok(opacity(before.result) > 0 && opacity(before.result) < 1);
  assert.equal(opacity(after.result), opacity(before.result)); assert.equal(after.result.variables.finished, 0);
  assert.equal(after.result.tasks[0].status, 'cancelled');
});

test('task self-await fails explicitly rather than keeping a dangling dependency', () => {
  const f = createBlueprintTaskFixture(); f.worker.links = [];
  const handle = f.node(f.worker, 'getVariable', { variableId: 'handle' }), wait = f.node(f.worker, 'waitTask', { graphId: f.worker.id });
  f.wire(f.worker, f.worker.nodes[0], wait); f.wire(f.worker, handle, wait, 'value', 'handle');
  const { result } = sample([click('task_ignore'), advance(.1)], f);
  assert.equal(result.tasks[0].status, 'failed'); assert.equal(result.tasks[0].reason, 'dependencyCycle'); assert.equal(result.taskWaiting, 0);
});
