import test from 'node:test';
import assert from 'node:assert/strict';
import { AiRequestLifecycle } from '../src/desktop/ai-request-lifecycle';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('AI stop waits for cooperative cancellation and the complete usage cleanup before another request', async () => {
  const lifecycle = new AiRequestLifecycle();
  const retryDelay = deferred(), cleanupStarted = deferred(), cleanupDone = deferred();
  const stopped = new Error('AI 任务已停止');
  let cancelled = false, usageActive = false, stopComplete = false;
  const result = lifecycle.run('old-request', async () => {
    usageActive = true;
    try {
      // A retry delay or a file read cannot necessarily be interrupted by abort().
      await retryDelay.promise;
      if (cancelled) throw stopped;
      return 'reply';
    } finally {
      cleanupStarted.resolve();
      await cleanupDone.promise;
      usageActive = false;
    }
  });
  const failure = assert.rejects(result, error => error === stopped);
  const stopping = lifecycle.cancel('old-request', () => { cancelled = true; }).then(() => { stopComplete = true; });
  assert.equal(cancelled, true, 'abort is dispatched synchronously');
  await Promise.resolve();
  assert.equal(stopComplete, false, 'the cooperative task has not left its retry delay');
  retryDelay.resolve();
  await cleanupStarted.promise;
  await Promise.resolve();
  assert.equal(stopComplete, false, 'usage cleanup is still pending after the operation exits');
  assert.equal(usageActive, true);
  cleanupDone.resolve();
  await Promise.all([failure, stopping]);
  assert.equal(stopComplete, true);
  assert.equal(usageActive, false);
  assert.equal(await lifecycle.run('next-request', () => {
    assert.equal(usageActive, false);
    return 'next reply';
  }), 'next reply');
});

test('repeated AI stops share completion and dispatch abort only once', async () => {
  const lifecycle = new AiRequestLifecycle(), exit = deferred();
  const result = lifecycle.run('request', () => exit.promise);
  let aborts = 0, completions = 0;
  const first = lifecycle.cancel('request', () => { aborts++; }).then(() => { completions++; });
  const second = lifecycle.cancel('request', () => { aborts++; }).then(() => { completions++; });
  assert.equal(aborts, 1);
  await Promise.resolve();
  assert.equal(completions, 0);
  exit.resolve();
  await Promise.all([result, first, second]);
  assert.equal(completions, 2);
  assert.equal(aborts, 1);
});

test('unknown and already completed AI request IDs cannot abort another request', async () => {
  const lifecycle = new AiRequestLifecycle(), exit = deferred();
  await lifecycle.run('finished', () => 'done');
  const result = lifecycle.run('current', () => exit.promise);
  let aborts = 0;
  await lifecycle.cancel('not-started', () => { aborts++; });
  await lifecycle.cancel('finished', () => { aborts++; });
  assert.equal(aborts, 0);
  const stopping = lifecycle.cancel('current', () => { aborts++; });
  assert.equal(aborts, 1);
  exit.resolve();
  await Promise.all([result, stopping]);
});

test('duplicate AI request IDs are rejected without replacing the original cancellation target', async () => {
  const lifecycle = new AiRequestLifecycle(), exit = deferred<string>();
  const result = lifecycle.run('same-id', () => exit.promise);
  let duplicateStarted = false, aborts = 0;
  await assert.rejects(lifecycle.run('same-id', () => { duplicateStarted = true; }), /已有 AI 请求正在进行/);
  assert.equal(duplicateStarted, false);
  const stopping = lifecycle.cancel('same-id', () => { aborts++; });
  assert.equal(aborts, 1);
  exit.resolve('original reply');
  assert.equal(await result, 'original reply');
  await stopping;
  assert.equal(await lifecycle.run('same-id', () => 'later reply'), 'later reply');
});

test('an AI request is registered before its synchronous setup runs', async () => {
  const lifecycle = new AiRequestLifecycle(), exit = deferred();
  let aborts = 0, stopping: Promise<void> | undefined;
  const result = lifecycle.run('request', () => {
    stopping = lifecycle.cancel('request', () => { aborts++; });
    return exit.promise;
  });
  assert.equal(aborts, 1);
  assert.ok(stopping);
  exit.resolve();
  await Promise.all([result, stopping]);
});

test('normal resolution, synchronous throw and async rejection all release an AI request ID', async () => {
  const lifecycle = new AiRequestLifecycle();
  const failure = new Error('provider failed');
  assert.equal(await lifecycle.run('request', () => 7), 7);
  await assert.rejects(lifecycle.run('request', () => { throw failure; }), error => error === failure);
  const exit = deferred();
  const result = lifecycle.run('request', () => exit.promise);
  const rejected = assert.rejects(result, error => error === failure);
  const stopping = lifecycle.cancel('request', () => { exit.reject(failure); });
  await Promise.all([rejected, stopping]);
  assert.equal(await lifecycle.run('request', async () => 'recovered'), 'recovered');
  let staleAborts = 0;
  await lifecycle.cancel('request', () => { staleAborts++; });
  assert.equal(staleAborts, 0);
});

test('an abort error is reported only after the tracked AI operation has released its resources', async () => {
  const lifecycle = new AiRequestLifecycle(), exit = deferred();
  const failure = new Error('abort failed');
  const result = lifecycle.run('request', () => exit.promise);
  let cancellationRejected = false;
  const stopping = lifecycle.cancel('request', () => { throw failure; });
  const rejected = assert.rejects(stopping, error => {
    cancellationRejected = true;
    return error === failure;
  });
  await Promise.resolve();
  assert.equal(cancellationRejected, false);
  exit.resolve();
  await Promise.all([result, rejected]);
  assert.equal(cancellationRejected, true);
  assert.equal(await lifecycle.run('request', () => 'retry'), 'retry');
});

test('different AI request IDs cannot overlap while a local tool or cleanup still owns the service', async () => {
  const lifecycle = new AiRequestLifecycle(), toolDone = deferred(), cleanupStarted = deferred(), cleanupDone = deferred();
  const first = lifecycle.run('authoring', async () => {
    try { await toolDone.promise; }
    finally { cleanupStarted.resolve(); await cleanupDone.promise; }
  });
  let modelsStarted = false, testStarted = false;
  await assert.rejects(lifecycle.run('models', () => { modelsStarted = true; }), /已有 AI 请求正在进行/);
  const stopping = lifecycle.cancel('authoring', () => { toolDone.resolve(); });
  await cleanupStarted.promise;
  await assert.rejects(lifecycle.run('connection-test', () => { testStarted = true; }), /已有 AI 请求正在进行/);
  assert.equal(modelsStarted, false);
  assert.equal(testStarted, false);
  cleanupDone.resolve();
  await Promise.all([first, stopping]);
  assert.deepEqual(await lifecycle.run('models', () => ['available-model']), ['available-model']);
});

test('late cancellation of a previous AI operation does not abort or wait for its successor', async () => {
  const lifecycle = new AiRequestLifecycle(), firstExit = deferred(), nextStarted = deferred(), nextExit = deferred();
  const first = lifecycle.run('previous', () => firstExit.promise);
  let oldAborts = 0, nextAborts = 0;
  const stopping = lifecycle.cancel('previous', () => { oldAborts++; });
  const next = first.then(() => lifecycle.run('successor', async () => { nextStarted.resolve(); await nextExit.promise; }));
  firstExit.resolve();
  await nextStarted.promise;
  await Promise.all([stopping, lifecycle.cancel('previous', () => { oldAborts++; nextAborts++; })]);
  assert.equal(oldAborts, 1);
  assert.equal(nextAborts, 0);
  await assert.rejects(lifecycle.run('third', () => undefined), /已有 AI 请求正在进行/);
  const nextStop = lifecycle.cancel('successor', () => { nextAborts++; nextExit.resolve(); });
  await Promise.all([next, nextStop]);
  assert.equal(nextAborts, 1);
});
