import test from 'node:test';
import assert from 'node:assert/strict';
import { BlueprintTraceRecorder } from '../src/core/blueprint-trace';
import { blueprintTraceInvocations, blueprintTraceValue, blueprintTraceView, filterBlueprintTrace } from '../src/core/blueprint-trace-view';
import { checkedUiPreviewAction } from '../src/core/ui-preview-actions';
import { previewUiLogic } from '../src/core/ui-logic-preview';
import { createBlueprintTraceFixture } from '../scripts/lib/blueprint-trace-fixture';

test('trace value formatting distinguishes false, zero, empty text, missing values and truncation', () => {
  assert.equal(blueprintTraceValue({ value: false, available: true }), 'false'); assert.equal(blueprintTraceValue({ value: 0, available: true }), '0');
  assert.equal(blueprintTraceValue({ value: '', available: true }), '""（空文本）'); assert.equal(blueprintTraceValue({ available: false }), '未产生值（不可用）');
  assert.equal(blueprintTraceValue({}), '未记录值'); assert.match(blueprintTraceValue({ value: '文字', available: true, valueTruncated: true }), /已截断/);
});

test('trace filtering and labels operate on captured observations without changing execution or project values', () => {
  const f = createBlueprintTraceFixture(), before = JSON.stringify(f.project);
  const result = previewUiLogic(f.project, f.root.components, f.root.id, {}, [{ kind: 'click', componentId: f.observe.id }, { kind: 'advance', seconds: .5 }], { timed: true, trace: true });
  const trace = result.trace!, view = blueprintTraceView(f.project);
  assert.equal(result.incomplete, false); assert.equal(result.variables.trace_result, 0);
  assert.deepEqual(filterBlueprintTrace(trace, view, { kind: 'writes', query: '本次调用' }).map(entry => entry.value), [0, false, '']);
  assert.ok(filterBlueprintTrace(trace, view, { kind: 'values', query: '返回观察值' }).length);
  assert.equal(filterBlueprintTrace(trace, view, { kind: 'problems' }).length, 0);
  const write = trace.entries.find(entry => entry.kind === 'write' && entry.nodeId === f.writes[0].id)!;
  assert.match(view.origin(write), /调用 #.+实例 #1/); assert.match(view.summary(write), /本次调用.*零值/);
  assert.ok(filterBlueprintTrace(trace, view, { invocationId: write.invocationId }).every(entry => entry.invocationId === write.invocationId));
  assert.equal(filterBlueprintTrace(trace, view, { query: '[.*' }).length, 0);
  assert.equal(JSON.stringify(f.project), before);
});

test('bounded histories still expose the full captured call stack and return nodes', () => {
  const f = createBlueprintTraceFixture(), recorder = new BlueprintTraceRecorder({ limit: 1 });
  const parent = recorder.frame(f.parent.id, [], { pageId: f.root.id, pageInstance: 3 }), child = recorder.frame(f.values.id, [parent], { pageId: f.root.id, pageInstance: 3 }, f.childCall.id);
  recorder.record([parent], { kind: 'enter' }); recorder.record([parent, child], { kind: 'wait', nodeId: f.pause.id });
  const trace = recorder.snapshot(); assert.equal(trace.dropped, 1); assert.deepEqual(blueprintTraceInvocations(trace), [parent, child]);
  const view = blueprintTraceView(f.project), target = view.graphTarget(parent.graphId, child.callNodeId, parent.pageId)!;
  assert.deepEqual(target, { graphId: f.parent.id, nodeId: f.childCall.id }); assert.equal(checkedUiPreviewAction(f.project, { kind: 'locate', projectId: f.project.id, ...target }).kind, 'locate');
});

test('trace source targets distinguish module navigation, event page contexts and native generated controls', () => {
  const f = createBlueprintTraceFixture(), view = blueprintTraceView(f.project);
  assert.deepEqual(view.graphTarget(f.values.id, f.writes[0].id, f.root.id), { graphId: f.values.id, nodeId: f.writes[0].id });
  assert.deepEqual(view.graphTarget(f.templateGraph.id, f.templateGraph.nodes[0].id, 'ui:preferences'), { graphId: f.templateGraph.id, nodeId: f.templateGraph.nodes[0].id, pageId: 'ui:preferences', uiInstanceId: 'base' });
  assert.deepEqual(view.pageTarget(f.root.id, f.observe.id), { pageId: f.root.id, componentId: f.observe.id, uiInstanceId: undefined });
  assert.equal(view.pageTarget('ui:preferences', '__generated_native_setting'), undefined);
  assert.equal(view.graphTarget(undefined), undefined); assert.equal(view.pageTarget('missing'), undefined);
});

test('a successful wait with no return payload is not an unavailable value or stop', () => {
  const f = createBlueprintTraceFixture(), trace = new BlueprintTraceRecorder();
  trace.record([], { kind: 'resume', available: false, reason: '等待完成' });
  assert.deepEqual(filterBlueprintTrace(trace.snapshot(), blueprintTraceView(f.project), { kind: 'problems' }), []);
});
