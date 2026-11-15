import { createBlueprintTraceFixture } from '../scripts/lib/blueprint-trace-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BlueprintTraceRecorder } from '../src/core/blueprint-trace';
import { createBlueprintStateFixture } from '../scripts/lib/blueprint-state-fixture';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { uiPageComponents } from '../src/core/ui-logic';
import { createProject } from '../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';

const click = (componentId: string): UiPreviewEvent => ({ kind: 'click', componentId });
const advance = (seconds: number): UiPreviewEvent => ({ kind: 'advance', seconds });
function sample(events: UiPreviewEvent[], trace: boolean | { limit?: number } = true) {
  const f = createBlueprintStateFixture(), before = JSON.stringify(f.project);
  const result = previewUiLogic(f.project, f.root.components, f.root.id, {}, events, { timed: true, trace });
  assert.equal(JSON.stringify(f.project), before);
  return { ...f, result, entries: result.trace?.entries ?? [] };
}

test('trace is a bounded snapshot, preserves false/zero/empty values, and owns its invocation metadata', () => {
  let time = 0; const trace = new BlueprintTraceRecorder({ limit: 3, time: () => time });
  const frame = trace.frame('module', [], { pageId: 'page', pageInstance: 2 });
  for (const value of [9, 8, false, 0, '']) { time++; trace.record([frame], { kind: 'output', value, available: true }); }
  frame.pageId = 'changed';
  const snapshot = trace.snapshot(); assert.equal(snapshot.dropped, 2);
  assert.deepEqual(snapshot.entries.map(entry => entry.value), [false, 0, '']);
  assert.deepEqual(snapshot.entries.map(entry => entry.sequence), [3, 4, 5]);
  assert.deepEqual(snapshot.entries.map(entry => entry.time), [3, 4, 5]);
  assert.ok(snapshot.entries.every(entry => entry.stack[0].pageId === 'page'));
  snapshot.entries[0].stack[0].pageId = 'mutated snapshot'; snapshot.entries[0].value = 42;
  assert.equal(trace.snapshot().entries[0].stack[0].pageId, 'page'); assert.equal(trace.snapshot().entries[0].value, false);
  trace.record([frame], { kind: 'output', value: 'x'.repeat(5000), available: true });
  assert.equal(String(trace.snapshot().entries.at(-1)!.value).length, 4000); assert.equal(trace.snapshot().entries.at(-1)!.valueTruncated, true);
});

test('enabling or overflowing trace does not change page gameplay, timings, or project data', () => {
  const f = createBlueprintStateFixture(), events = [click('state_root_increment'), click('invoke_cache_a'), advance(.1), click('invoke_cache_b'), advance(1)];
  const run = (trace: boolean | { limit?: number }) => previewUiLogic(f.project, f.root.components, f.root.id, {}, events, { timed: true, trace });
  const { trace: absent, ...plain } = run(false), { trace: full, ...recorded } = run(true), { trace: small, ...bounded } = run({ limit: 5 });
  assert.equal(absent, undefined); assert.ok(full!.entries.length > 5); assert.ok(small!.dropped > 0);
  assert.deepEqual(recorded, plain); assert.deepEqual(bounded, plain);
});

test('concurrent and nested calls record distinct invocations, wait/resume times and original call sites', () => {
  const f = sample([click('invoke_cache_a'), advance(.1), click('invoke_cache_b'), advance(1)]);
  const writes = f.entries.filter(entry => entry.kind === 'write' && entry.graphId === f.cache.id && entry.scope === 'call');
  assert.deepEqual(writes.map(entry => entry.value), [11, 22]);
  assert.equal(new Set(writes.map(entry => entry.invocationId)).size, 2);
  assert.ok(writes.every(entry => entry.pageId === f.root.id && entry.pageInstance === 1 && entry.stack.length >= 2));
  assert.ok(writes.every(entry => entry.stack.at(-1)!.callNodeId));
  const wait = f.entries.find(entry => entry.kind === 'wait' && entry.graphId === f.cache.id)!;
  const resume = f.entries.find(entry => entry.kind === 'resume' && entry.invocationId === wait.invocationId)!;
  assert.ok(wait && resume); assert.ok(resume.time > wait.time);
  assert.equal(f.result.variables.cache_a, 11); assert.equal(f.result.variables.cache_b, 22);
});

test('page state observations identify the actual instance while each click has a new invocation', () => {
  const f = sample([click('state_root_increment'), click('state_root_increment')]);
  const writes = f.entries.filter(entry => entry.kind === 'write' && entry.scope === 'page');
  assert.deepEqual(writes.map(entry => entry.value), [1, 2]);
  assert.equal(new Set(writes.map(entry => entry.invocationId)).size, 2);
  assert.ok(writes.every(entry => entry.targetPageId === f.root.id && entry.targetPageInstance === 1));
  assert.ok(f.entries.some(entry => entry.kind === 'event' && entry.trigger === 'eventClick' && entry.componentId === 'state_root_increment'));
});

test('closing a page records cancellation and never presents the cancelled continuation as completed', () => {
  const f = createBlueprintStateFixture();
  const result = previewUiLogic(f.project, f.root.components, f.root.id, {}, [click('invoke_snapshot_a'), click(f.root.components[1].id), advance(1)], { timed: true, trace: true });
  assert.equal(result.variables.snapshot_a, 0);
  const entries = result.trace!.entries, wait = entries.find(entry => entry.kind === 'wait' && entry.graphId === f.snapshot.id)!;
  assert.ok(wait);
  assert.ok(entries.some(entry => entry.kind === 'stop' && entry.invocationId === wait.invocationId && /页面实例关闭/.test(entry.reason ?? '')));
  assert.ok(!entries.some(entry => entry.kind === 'resume' && entry.invocationId === wait.invocationId));
});

test('tracing only records evaluated pins, preserving short-circuit behavior and no second read', () => {
  const project = createProject(), graph = createBlueprintGraph('function', '短路轨迹'); project.blueprints.push(graph);
  project.variables.push({ id: 'answer', name: '结果', type: 'boolean', initial: true, persistent: false });
  const op = blueprintNodeDefaults('and'), missing = blueprintNodeDefaults('getVariable'), set = blueprintNodeDefaults('setVariable');
  op.properties.a = false; missing.properties.variableId = 'missing'; set.properties = { variableId: 'answer', value: true };
  missing.pins.find(pin => pin.id === 'value')!.dataType = 'boolean'; graph.nodes.push(op, missing, set); synchronizeBlueprintSignatures(project);
  for (const [from, out, to, input] of [[graph.nodes[0], 'exec', set, 'exec_in'], [op, 'result', set, 'value'], [missing, 'value', op, 'b']] as const) assert.equal(connectBlueprintPins(graph, from.id, out, to.id, input), undefined);
  const context = previewActionContext(project); context.trace = new BlueprintTraceRecorder();
  expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], context);
  assert.equal(context.variables.answer, false); assert.equal(context.incomplete, false);
  assert.ok(!context.trace.snapshot().entries.some(entry => entry.nodeId === missing.id));
  assert.ok(!context.trace.snapshot().entries.some(entry => entry.nodeId === op.id && entry.pinId === 'b'));
  assert.equal(context.trace.snapshot().entries.filter(entry => entry.nodeId === op.id && entry.kind === 'output').length, 1);
});

test('unsupported nodes and ignored controls state an explicit reason and retain a source location', () => {
  const f = createBlueprintStateFixture(), graph = f.pageGraphs.find(graph => graph.uiPageId === f.root.id)!;
  const action = graph.nodes.find(node => node.type === 'setVariable')!; action.type = 'switchScene';
  const result = previewUiLogic(f.project, f.root.components, f.root.id, {}, [click('missing'), click('state_root_increment')], { timed: true, trace: true });
  assert.ok(result.trace!.entries.some(entry => entry.kind === 'stop' && entry.componentId === 'missing' && /控件不存在/.test(entry.reason ?? '')));
  assert.ok(result.trace!.entries.some(entry => entry.kind === 'stop' && entry.graphId === graph.id && entry.nodeId === action.id && /实际试玩/.test(entry.reason ?? '')));
  assert.equal(result.incomplete, true);
});

test('native page templates carry the same invocation and page-state trace information', () => {
  const f = createBlueprintStateFixture();
  const result = previewUiLogic(f.project, uiPageComponents(f.project, 'ui:preferences'), 'ui:preferences', {}, [click('state_native_increment')], { timed: true, trace: true });
  const write = result.trace!.entries.find(entry => entry.kind === 'write' && entry.scope === 'page')!;
  assert.equal(write.pageId, 'ui:preferences'); assert.equal(write.targetPageInstance, 1); assert.equal(write.value, 101);
});

test('invalid animation targets stop at their source with a concrete reason instead of generic cancellation', () => {
  const f = createBlueprintTraceFixture();
  const animated = blueprintNodeDefaults('animateUiProperty'); Object.assign(f.primary.call, { type: animated.type, pins: animated.pins, properties: { ...animated.properties, componentId: 'missing-component' } });
  const result = previewUiLogic(f.project, f.root.components, f.root.id, {}, [click(f.observe.id)], { timed: true, trace: true });
  assert.equal(result.incomplete, true);
  assert.ok(result.trace!.entries.some(entry => entry.kind === 'stop' && entry.nodeId === f.primary.call.id && /目标.*无效/.test(entry.reason ?? '')));
  assert.ok(!result.trace!.entries.some(entry => entry.kind === 'write' && entry.nodeId === f.primary.write.id));
});

test('unsupported host controls, shortcuts and invalid timers retain original page and control/node locations', () => {
  const f = createBlueprintTraceFixture();
  f.root.components.push({ id: 'unpreviewable', text: '', kind: 'chapterList', page: 'custom', x: 0, y: 0, width: .2, height: .2 });
  f.observe.shortcut = 'not-a-supported-shortcut';
  const timer = blueprintNodeDefaults('eventTimer'); Object.assign(timer.properties, { pageId: f.root.id, interval: -1 }); f.rootGraph.nodes.push(timer);
  const result = previewUiLogic(f.project, f.root.components, f.root.id, {}, [], { timed: true, trace: true });
  const reasons = result.trace!.entries.filter(entry => entry.kind === 'stop');
  assert.equal(result.incomplete, true);
  assert.ok(reasons.some(entry => entry.pageId === f.root.id && entry.pageInstance === 1 && entry.componentId === 'unpreviewable' && /控件类型/.test(entry.reason ?? '')));
  assert.ok(reasons.some(entry => entry.componentId === f.observe.id && /快捷键/.test(entry.reason ?? '')));
  assert.ok(reasons.some(entry => entry.graphId === f.rootGraph.id && entry.nodeId === timer.id && /定时事件间隔/.test(entry.reason ?? '')));
});

test('missing callbacks and invalid test parameters are visible stops rather than silent incomplete flags', () => {
  const f = createBlueprintTraceFixture(); f.observe.events = { beforeClick: 'removed-graph' };
  const result = previewUiLogic(f.project, f.root.components, f.root.id, {}, [click(f.observe.id), { kind: 'parameter', id: 'removed-parameter', value: 0 }], { timed: true, trace: true });
  assert.ok(result.trace!.entries.some(entry => entry.graphId === 'removed-graph' && entry.pageId === f.root.id && /蓝图已不存在/.test(entry.reason ?? '')));
  assert.ok(result.trace!.entries.some(entry => entry.variableId === 'removed-parameter' && /测试参数/.test(entry.reason ?? '')));
});
