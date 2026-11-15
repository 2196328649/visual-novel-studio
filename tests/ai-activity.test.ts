import test from 'node:test';
import assert from 'node:assert/strict';
import { AiActivity, aiActivityFor } from '../src/renderer/ai-activity';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('AI activity survives component remounts on the same bridge and isolates different bridges', async () => {
  const bridge = Object.freeze({}), otherBridge = {}, exit = deferred();
  const first = aiActivityFor(bridge), second = aiActivityFor(bridge), other = aiActivityFor(otherBridge);
  assert.equal(first, second); assert.notEqual(first, other);
  const result = first.run(() => exit.promise);
  assert.equal(second.busy(), true); assert.equal(other.busy(), false);
  exit.resolve(); await result;
  assert.equal(second.busy(), false);
});

test('AI activity registers before setup and exposes stable subscription methods', async () => {
  const activity = new AiActivity(), exit = deferred<number>(), snapshots: boolean[] = [];
  const busy = activity.busy, snapshot = activity.getSnapshot, subscribe = activity.subscribe;
  const unsubscribe = subscribe(() => { snapshots.push(snapshot()); });
  assert.equal(busy(), false);
  const result = activity.run(() => { assert.equal(busy(), true); return exit.promise; });
  assert.deepEqual(snapshots, [true]);
  exit.resolve(42); assert.equal(await result, 42);
  assert.deepEqual(snapshots, [true, false]);
  assert.equal(activity.busy, busy); assert.equal(activity.getSnapshot, snapshot); assert.equal(activity.subscribe, subscribe);
  unsubscribe(); unsubscribe();
  await activity.run(async () => 'another operation');
  assert.deepEqual(snapshots, [true, false]);
});

test('successful, synchronously thrown and rejected operations all release activity and preserve their own result', async () => {
  const activity = new AiActivity(), failure = new Error('operation failed');
  assert.equal(await activity.run(async () => 'saved'), 'saved'); assert.equal(activity.busy(), false);
  await assert.rejects(activity.run(() => { throw failure; }), error => error === failure);
  assert.equal(activity.busy(), false);
  await assert.rejects(activity.run(async () => { throw failure; }), error => error === failure);
  assert.equal(activity.busy(), false);
  await activity.stopAll(); assert.equal(await activity.run(async () => 'retry'), 'retry');
});

test('stop waits for an uncancellable save to finish without tracking or waiting for itself', async () => {
  const activity = new AiActivity(), writeFinished = deferred<string>();
  const save = activity.run(() => writeFinished.promise);
  let stopped = false;
  const stopping = activity.stopAll().then(() => { stopped = true; });
  await Promise.resolve(); assert.equal(stopped, false); assert.equal(activity.busy(), true);
  writeFinished.resolve('saved'); assert.equal(await save, 'saved');
  await stopping; assert.equal(stopped, true); assert.equal(activity.busy(), false);
});

test('stop dispatches every cancellation synchronously and waits for all remaining task cleanup', async () => {
  const activity = new AiActivity(), firstExit = deferred(), secondExit = deferred(), calls: string[] = [];
  const first = activity.run(() => firstExit.promise, () => { calls.push('first'); });
  const second = activity.run(() => secondExit.promise, () => { calls.push('second'); });
  let stopped = false;
  const stopping = activity.stopAll().then(() => { stopped = true; });
  assert.deepEqual(calls, ['first', 'second']);
  firstExit.resolve(); await first;
  await Promise.resolve(); assert.equal(stopped, false); assert.equal(activity.busy(), true);
  secondExit.resolve(); await Promise.all([second, stopping]);
  assert.equal(activity.busy(), false); assert.equal(stopped, true);
});

test('busy stays true until cancellation acknowledgement even after the original action settles', async () => {
  const activity = new AiActivity(), actionExit = deferred(), cancelExit = deferred();
  let cancels = 0, stopped = false;
  const result = activity.run(() => actionExit.promise, () => { cancels++; return cancelExit.promise; });
  const first = activity.stopAll(), second = activity.stopAll();
  assert.equal(first, second); assert.equal(cancels, 1);
  void first.then(() => { stopped = true; });
  actionExit.resolve(); await result;
  await Promise.resolve(); assert.equal(activity.busy(), true); assert.equal(stopped, false);
  assert.equal(activity.stopAll(), first); assert.equal(cancels, 1);
  cancelExit.resolve(); await Promise.all([first, second]);
  assert.equal(stopped, true); assert.equal(activity.busy(), false);
  await activity.stopAll(); assert.equal(cancels, 1);
  assert.equal(await activity.run(async () => 'next'), 'next');
});

test('a failed action is handled by its original caller while stop still waits for other actions', async () => {
  const activity = new AiActivity(), firstExit = deferred(), secondExit = deferred(), failure = new Error('request failed');
  const first = activity.run(() => firstExit.promise), second = activity.run(() => secondExit.promise);
  const failed = assert.rejects(first, error => error === failure);
  let stopped = false;
  const stopping = activity.stopAll().then(() => { stopped = true; });
  firstExit.reject(failure); await failed;
  await Promise.resolve(); assert.equal(stopped, false); assert.equal(activity.busy(), true);
  secondExit.resolve(); await Promise.all([second, stopping]);
  assert.equal(stopped, true); assert.equal(activity.busy(), false);
});

test('a required config write failure blocks an ongoing close only after all actions and cancellations settle', async () => {
  const activity = new AiActivity(), writeExit = deferred(), requestExit = deferred(), cancelExit = deferred();
  const writeFailure = new Error('config write failed');
  const write = activity.run(() => writeExit.promise, undefined, { requireSuccessToClose: true });
  const request = activity.run(() => requestExit.promise, () => cancelExit.promise);
  const writeRejected = assert.rejects(write, error => error === writeFailure);
  let reported = false;
  const closing = activity.stopAll();
  const closeRejected = assert.rejects(closing, error => { reported = true; return error === writeFailure; });
  writeExit.reject(writeFailure); await writeRejected;
  assert.equal(reported, false); assert.equal(activity.busy(), true);
  requestExit.resolve(); await request;
  await Promise.resolve(); assert.equal(reported, false); assert.equal(activity.busy(), true);
  cancelExit.resolve(); await closeRejected;
  assert.equal(reported, true); assert.equal(activity.busy(), false);
  await activity.stopAll();
  assert.equal(await activity.run(async () => 'retry saved', undefined, { requireSuccessToClose: true }), 'retry saved');
});

test('a required write failure outside close releases activity and is not replayed by a later close', async () => {
  const activity = new AiActivity(), failure = new Error('config write failed');
  await assert.rejects(activity.run(async () => { throw failure; }, undefined, { requireSuccessToClose: true }), error => error === failure);
  assert.equal(activity.busy(), false);
  await activity.stopAll();
  await assert.rejects(activity.run(() => { throw failure; }, undefined, { requireSuccessToClose: true }), error => error === failure);
  assert.equal(activity.busy(), false);
  const requestExit = deferred(), request = activity.run(() => requestExit.promise);
  const closing = activity.stopAll();
  requestExit.resolve(); await Promise.all([request, closing]);
  assert.equal(activity.busy(), false);
});

test('an ongoing close retains both a required write failure and a cancellation failure until cleanup ends', async () => {
  const activity = new AiActivity(), writeExit = deferred(), requestExit = deferred(), cancelExit = deferred();
  const writeFailure = new Error('config write failed'), cancelFailure = new Error('cancel IPC failed');
  const write = activity.run(() => writeExit.promise, undefined, { requireSuccessToClose: true });
  const request = activity.run(() => requestExit.promise, () => cancelExit.promise);
  const writeRejected = assert.rejects(write, error => error === writeFailure);
  let reported = false;
  const closing = activity.stopAll();
  const closeRejected = assert.rejects(closing, error => {
    reported = true; assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [writeFailure, cancelFailure]); return true;
  });
  writeExit.reject(writeFailure); await writeRejected;
  cancelExit.reject(cancelFailure);
  await Promise.resolve(); assert.equal(reported, false); assert.equal(activity.busy(), true);
  requestExit.resolve(); await Promise.all([request, closeRejected]);
  assert.equal(reported, true); assert.equal(activity.busy(), false);
});

test('a synchronous cancellation failure is reported only after every action and cancellation has settled', async () => {
  const activity = new AiActivity(), firstExit = deferred(), secondExit = deferred(), cancelExit = deferred();
  const failure = new Error('cancel IPC failed'), calls: string[] = [];
  const first = activity.run(() => firstExit.promise, () => { calls.push('first'); throw failure; });
  const second = activity.run(() => secondExit.promise, () => { calls.push('second'); return cancelExit.promise; });
  let reported = false;
  const stopping = activity.stopAll();
  const rejected = assert.rejects(stopping, error => { reported = true; return error === failure; });
  assert.deepEqual(calls, ['first', 'second']);
  firstExit.resolve(); secondExit.resolve(); await Promise.all([first, second]);
  await Promise.resolve(); assert.equal(reported, false); assert.equal(activity.busy(), true);
  cancelExit.resolve(); await rejected;
  assert.equal(activity.busy(), false); assert.equal(reported, true);
  await activity.stopAll(); assert.equal(await activity.run(async () => 'after failure'), 'after failure');
});

test('multiple cancellation errors are retained after full cleanup without duplicating action failures', async () => {
  const activity = new AiActivity(), firstExit = deferred(), secondExit = deferred(), lastCancel = deferred();
  const firstFailure = new Error('first cancel'), secondFailure = new Error('second cancel'), actionFailure = new Error('action');
  const first = activity.run(() => firstExit.promise, async () => { throw firstFailure; });
  const second = activity.run(() => secondExit.promise, () => lastCancel.promise);
  const firstRejected = assert.rejects(first, error => error === actionFailure);
  const stopping = activity.stopAll();
  const rejected = assert.rejects(stopping, error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [firstFailure, secondFailure]); return true;
  });
  firstExit.reject(actionFailure); secondExit.resolve(); await Promise.all([firstRejected, second]);
  assert.equal(activity.busy(), true);
  lastCancel.reject(secondFailure); await rejected;
  assert.equal(activity.busy(), false);
});

test('an operation registered while stopping is cancelled once and included in the same drain', async () => {
  const activity = new AiActivity(), firstExit = deferred(), secondExit = deferred(), calls: string[] = [];
  const first = activity.run(() => firstExit.promise, () => { calls.push('first'); });
  let stopped = false;
  const stopping = activity.stopAll(); void stopping.then(() => { stopped = true; });
  const second = activity.run(() => secondExit.promise, () => { calls.push('second'); });
  assert.deepEqual(calls, ['first', 'second']); assert.equal(activity.stopAll(), stopping);
  firstExit.resolve(); await first;
  await Promise.resolve(); assert.equal(stopped, false); assert.equal(activity.busy(), true);
  secondExit.resolve(); await Promise.all([second, stopping]);
  assert.deepEqual(calls, ['first', 'second']); assert.equal(activity.busy(), false);
});

test('a cancellation callback can register an independent wait without stranding it outside the drain', async () => {
  const activity = new AiActivity(), firstExit = deferred(), nextExit = deferred(), calls: string[] = [];
  let next: Promise<void> | undefined;
  const first = activity.run(() => firstExit.promise, () => {
    calls.push('first');
    next = activity.run(() => nextExit.promise, () => { calls.push('next'); });
  });
  const stopping = activity.stopAll(); assert.deepEqual(calls, ['first', 'next']);
  firstExit.resolve(); await first;
  assert.equal(activity.busy(), true); assert.ok(next);
  nextExit.resolve(); await Promise.all([next, stopping]);
  assert.equal(activity.busy(), false);
});

test('a successor registered in an action completion handler is still included before stop settles', async () => {
  const activity = new AiActivity(), firstExit = deferred(), nextExit = deferred(), nextStarted = deferred();
  let nextCancels = 0, stopped = false;
  const first = activity.run(() => firstExit.promise);
  const next = first.then(() => activity.run(() => { nextStarted.resolve(); return nextExit.promise; }, () => { nextCancels++; }));
  const stopping = activity.stopAll().then(() => { stopped = true; });
  firstExit.resolve(); await nextStarted.promise;
  assert.equal(nextCancels, 1); assert.equal(activity.busy(), true); assert.equal(stopped, false);
  nextExit.resolve(); await Promise.all([next, stopping]);
  assert.equal(activity.busy(), false);
});

test('stop invoked during synchronous action setup observes that action without cancelling twice', async () => {
  const activity = new AiActivity(), exit = deferred();
  let stopping: Promise<void> | undefined, cancels = 0;
  const result = activity.run(() => {
    stopping = activity.stopAll();
    return exit.promise;
  }, () => { cancels++; });
  assert.ok(stopping); assert.equal(cancels, 1); assert.equal(activity.stopAll(), stopping);
  exit.resolve(); await Promise.all([result, stopping]);
  assert.equal(cancels, 1); assert.equal(activity.busy(), false);
});
