import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBlueprintDebugPacket, checkedBlueprintDebugRequest, mergeBlueprintDebugPacket, blueprintDebugBreakpointProblem, type BlueprintDebugPacket } from '../src/core/blueprint-debug';
import { compileProject } from '../src/runtime/compiler';
import { createBlueprintDebugFixture } from '../scripts/lib/blueprint-debug-fixture';

const packet = (patch: Partial<BlueprintDebugPacket> = {}): BlueprintDebugPacket => ({ version: 1, sessionId: 'session', generation: 0, revision: 1, acknowledgement: 0, phase: 'running', reason: 'running', entries: [], dropped: 0, invocations: 0, breakpoints: [], ...patch });
const record = (sequence: number, value: string | boolean | number = 0) => ({ sequence, time: 0, kind: 'input' as const, graphId: 'graph', nodeId: 'node', pinId: 'value', value, available: true, invocationId: 1, stack: [{ id: 1, graphId: 'graph', pageId: 'page', pageInstance: 2 }] });

test('debug packets preserve explicit zero/false/empty values, task ownership and frozen stack copies', () => {
  const raw = packet({ entries: [record(1), record(2, false), { ...record(3, ''), taskHandle: 'task:one' }], invocations: 1 });
  const parsed = parseBlueprintDebugPacket(raw, 'session')!;
  assert.deepEqual(parsed.entries.map(entry => entry.value), [0, false, '']);
  raw.entries[0].stack[0].pageInstance = 99;
  assert.equal(parsed.entries[0].stack[0].pageInstance, 2);
  assert.equal(parsed.entries[2].taskHandle, 'task:one');
});

test('untrusted packet fields are allowlisted and schema/size/finite-value limits fail closed', () => {
  const raw = { ...packet({ entries: [record(1)] }), run: { command: 'do not execute' } };
  const parsed = parseBlueprintDebugPacket(raw)!;
  assert.equal(Object.hasOwn(parsed, 'run'), false);
  for (const patch of [ { version: 2 }, { phase: 'execute' }, { entries: [record(1, Infinity)] }, { entries: [record(1, 'x'.repeat(4001))] }, { entries: Array.from({ length: 129 }, (_, i) => record(i)) }, { entries: [{ ...record(1), sequence: -1 }] }, { entries: [{ ...record(1), stack: Array.from({ length: 33 }, (_, id) => ({ id, graphId: 'g' })) }] }, { site: { graphId: 'g', nodeId: 'n', stack: [], invocationId: -1, entry: 'exec_in' } } ]) assert.equal(parseBlueprintDebugPacket({ ...raw, ...patch }), undefined);
  assert.equal(parseBlueprintDebugPacket(raw, 'stale-session'), undefined);
});

test('stream merge is bounded, deduplicated, session-aware and cannot roll back to an old generation', () => {
  let snapshot = mergeBlueprintDebugPacket(undefined, packet({ entries: [record(1)], invocations: 1 }));
  snapshot = mergeBlueprintDebugPacket(snapshot, packet({ revision: 2, entries: [record(1), record(2, false)] }));
  assert.deepEqual(snapshot.trace.entries.map(entry => entry.sequence), [1, 2]);
  for (let i = 3; i <= 1700; i += 100) snapshot = mergeBlueprintDebugPacket(snapshot, packet({ revision: i, entries: Array.from({ length: 100 }, (_, offset) => record(i + offset)) }));
  assert.equal(snapshot.trace.entries.length, 1600); assert.ok(snapshot.trace.dropped > 0);
  const next = mergeBlueprintDebugPacket(snapshot, packet({ generation: 1, revision: 1800, reason: 'loaded', entries: [record(1, '')] }));
  assert.deepEqual(next.trace.entries.map(entry => entry.value), ['']);
  assert.equal(mergeBlueprintDebugPacket(next, packet({ generation: 0, revision: 1801, entries: [record(1, 999)] })), next);
  assert.equal(mergeBlueprintDebugPacket(next, packet({ generation: 1, revision: 1799 })), next);
  const restarted = mergeBlueprintDebugPacket(next, packet({ sessionId: 'new-session' }));
  assert.equal(restarted.sessionId, 'new-session'); assert.equal(restarted.trace.entries.length, 0);
});

test('breakpoints refer to exact compiled graph/node identities and reject data-node execution stops', () => {
  const f = createBlueprintDebugFixture(), point = { graphId: f.rootGraph.id, nodeId: f.rootFirst.id };
  const request = checkedBlueprintDebugRequest(f.project, { sessionId: 'current', action: 'breakpoints', breakpoints: [point, point] }, 'current');
  assert.deepEqual(request.breakpoints, [point]);
  assert.throws(() => checkedBlueprintDebugRequest(f.project, { sessionId: 'old', action: 'continue' }, 'current'), /会话/);
  assert.throws(() => checkedBlueprintDebugRequest(f.project, { sessionId: 'current', action: 'evaluate', script: 'bad' }, 'current'), /命令/);
  assert.match(blueprintDebugBreakpointProblem(f.project, { graphId: f.rootGraph.id, nodeId: f.lazyRandom.id })!, /数据节点/);
  assert.throws(() => checkedBlueprintDebugRequest(f.project, { sessionId: 'current', action: 'breakpoints', breakpoints: [{ ...point, nodeId: 'deleted' }] }, 'current'), /不存在/);
});

test('only explicitly instrumented development compilation contains debugger code and observations', () => {
  const f = createBlueprintDebugFixture(), before = structuredClone(f.project);
  for (const options of [{}, { development: true }, { development: false, blueprintDebug: true }]) {
    const result = compileProject(f.project, options); assert.deepEqual(result.diagnostics.filter(issue => issue.severity === 'error'), []);
    assert.equal(result.files['game/98-blueprint-debug.rpy'], undefined); assert.doesNotMatch(result.files['game/story.rpy'], /vn_bp_debug_checkpoint|vn_bp_debug_value/);
  }
  const result = compileProject(f.project, { development: true, blueprintDebug: true });
  assert.deepEqual(result.diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.match(result.files['game/98-blueprint-debug.rpy'], /_constant = True/);
  assert.ok(result.files['game/98-blueprint-debug.rpy'].includes('isinstance(boot, builtins.dict)'));
  assert.ok(result.files['game/98-blueprint-debug.rpy'].includes('isinstance(payload.get("commands"), builtins.list)'));
  assert.ok(result.files['game/98-blueprint-debug.rpy'].includes('isinstance(command, builtins.dict)'));
  assert.match(result.files['game/story.rpy'], /vn_bp_debug_frame\(vn_bp_enter_frame/);
  assert.match(result.files['game/story.rpy'], /vn_bp_debug_checkpoint/);
  assert.match(result.files['game/story.rpy'], /vn_bp_debug_value/);
  assert.match(result.files['game/story.rpy'], / and vn_bp_boolean\(vn_bp_debug_value/);
  assert.deepEqual(f.project, before);
});
