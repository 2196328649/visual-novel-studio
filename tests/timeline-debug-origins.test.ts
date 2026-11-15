import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type BlueprintGraph, type StageAction } from '../src/core/model';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs } from '../src/core/blueprint-authoring';
import { blueprintNodeDefaults, connectBlueprintPins } from '../src/core/blueprint';
import { addProjectGraphs, projectGraphs } from '../src/core/project-resources';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { createVisualObject, visualInputFields } from '../src/core/visual-object';
import { interleaveProjectTimelines } from '../src/core/timeline-interleave';
import { createBlueprintPlaybackOrigins } from '../src/core/blueprint-playback-origins';
import { BlueprintTraceRecorder } from '../src/core/blueprint-trace';
import { blueprintTraceView } from '../src/core/blueprint-trace-view';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { checkedBlueprintDebugRequest, parseBlueprintDebugPacket } from '../src/core/blueprint-debug';
import { compileProject } from '../src/runtime/compiler';
import { pythonBlockLiteral, pythonLiteral } from '../src/runtime/literals';

function fixture(delayed = false) {
  const project = createProject();
  const arrange = (graph: BlueprintGraph, times: number[]) => {
    const model = performanceTimeline(project, graph); assert.equal(model.reason, undefined);
    arrangePerformanceTimeline(project, graph, model.clips.map((clip, index) => ({ ...clip, at: times[index] ?? 0, trackId: 'track_' + index })), model.clips.map((_, index) => ({ id: 'track_' + index, name: '轨道 ' + index })));
  };
  const text = { ...createVisualObject('text'), name: '标题', duration: 2 };
  const root = { ...createVisualObject('group'), duration: 2, children: [text] };
  const child = blueprintFromPerformance(project, [root], '带公开文字的时间轴'); addProjectGraphs(project, child); arrange(child, [delayed ? .25 : 0]);
  const childVisual = child.nodes.find(node => node.type === 'savedAction')!;
  const textPin = 'object_' + visualInputFields(root).find(field => field.path.join('/') === 'children/0/text')!.key;
  exposePerformanceInputs(child, [{ ...performanceInputs(child).find(input => input.nodeId === childVisual.id && input.pinId === textPin)!, name: '标题文字' }]);
  const actions: StageAction[] = ['甲', '乙'].map(title => ({ kind: 'blueprint', blueprintId: child.id, inputs: { [child.exposedInputs[0].id]: title } }));
  const parent = blueprintFromPerformance(project, actions, '调用两次字幕'); addProjectGraphs(project, parent); arrange(parent, delayed ? [0, .5] : [0, 0]);
  const outer = blueprintFromPerformance(project, [{ kind: 'blueprint', blueprintId: parent.id }], '进入字幕'); addProjectGraphs(project, outer); arrange(outer, [0]);
  const read = blueprintNodeDefaults('literal'); read.properties.value = '来自外层数据节点'; read.pins[0].dataType = 'string'; parent.nodes.push(read);
  const calls = parent.nodes.filter(node => node.type === 'callFunction');
  assert.equal(connectBlueprintPins(parent, read.id, 'value', calls[0].id, 'arg_' + child.exposedInputs[0].id), undefined);
  return { project, child, parent, outer, childVisual, textPin, calls, read };
}

test('private timeline observations expose authored nodes, nested pins and call stacks without changing execution', () => {
  const f = fixture(), before = structuredClone(f.project);
  const context = previewActionContext(f.project); context.trace = new BlueprintTraceRecorder({ limit: 10000 });
  const actions = expandPreviewActions(f.project, [{ kind: 'blueprint', blueprintId: f.outer.id }], context);
  const plain = previewActionContext(f.project), untraced = expandPreviewActions(f.project, [{ kind: 'blueprint', blueprintId: f.outer.id }], plain);
  assert.equal(context.incomplete, false); assert.deepEqual(actions, untraced); assert.deepEqual(f.project, before);
  const trace = context.trace.snapshot(), view = blueprintTraceView(f.project), authored = new Map(projectGraphs(f.project).map(graph => [graph.id, new Set(graph.nodes.map(node => node.id))]));
  for (const entry of trace.entries) {
    if (entry.graphId) assert.ok(authored.has(entry.graphId), entry.graphId);
    if (entry.nodeId) assert.ok(authored.get(entry.graphId!)?.has(entry.nodeId), entry.nodeId);
    if (entry.sourceNodeId) assert.ok(authored.get(entry.sourceGraphId ?? entry.graphId!)?.has(entry.sourceNodeId), entry.sourceNodeId);
    for (const [index, frame] of entry.stack.entries()) {
      assert.ok(authored.has(frame.graphId));
      if (frame.callNodeId && index) assert.ok(authored.get(entry.stack[index - 1].graphId)?.has(frame.callNodeId));
    }
    assert.doesNotMatch(view.graphName(entry.graphId), /已移除/);
  }
  const inputs = trace.entries.filter(entry => entry.graphId === f.child.id && entry.nodeId === f.childVisual.id && entry.pinId === f.textPin && entry.kind === 'input');
  assert.deepEqual(inputs.map(entry => entry.value), ['来自外层数据节点', '乙']);
  assert.equal(new Set(inputs.map(entry => entry.invocationId)).size, 2);
  assert.ok(inputs.every(entry => entry.sourceGraphId === f.child.id));
  const parentCalls = new Set(f.calls.map(call => call.id));
  assert.ok(inputs.every(entry => entry.stack.at(-1)!.graphId === f.child.id && parentCalls.has(entry.stack.at(-1)!.callNodeId!)));
});

test('interleaved data observations retain the different authored source graph', () => {
  const f = fixture(true), context = previewActionContext(f.project); context.trace = new BlueprintTraceRecorder({ limit: 10000 });
  expandPreviewActions(f.project, [{ kind: 'blueprint', blueprintId: f.parent.id }], context);
  assert.equal(context.incomplete, false);
  const entry = context.trace.snapshot().entries.find(entry => entry.graphId === f.child.id && entry.nodeId === f.childVisual.id && entry.pinId === f.textPin && entry.value === '来自外层数据节点');
  assert.ok(entry); assert.equal(entry.sourceGraphId, f.parent.id); assert.equal(entry.sourceNodeId, f.calls[0].id);
  assert.equal(blueprintTraceView(f.project).graphTarget(entry.sourceGraphId, entry.sourceNodeId)?.graphId, f.parent.id);
});

test('native debug compilation keeps private execution addresses and emits authored breakpoint and pin metadata', () => {
  const f = fixture(), prepared = interleaveProjectTimelines(f.project), origins = createBlueprintPlaybackOrigins(f.project, prepared);
  const privateChild = projectGraphs(prepared).find(graph => graph.id !== f.child.id && graph.nodes.some(node => node.properties.__timelineNode === f.childVisual.id))!;
  const privateVisual = privateChild.nodes.find(node => node.properties.__timelineNode === f.childVisual.id)!;
  const privatePin = Object.entries(origins.nodes[privateChild.id][privateVisual.id].pins!).find(([, source]) => source === f.textPin)![0];
  assert.notEqual(privateChild.id, f.child.id); assert.notEqual(privateVisual.id, f.childVisual.id); assert.notEqual(privatePin, f.textPin);
  assert.deepEqual(origins.location(privateChild.id, privateVisual.id, privatePin), { graphId: f.child.id, nodeId: f.childVisual.id, pinId: f.textPin });
  const breakpoint = { graphId: f.child.id, nodeId: f.childVisual.id };
  assert.deepEqual(checkedBlueprintDebugRequest(f.project, { sessionId: 'session', action: 'breakpoints', breakpoints: [breakpoint] }, 'session').breakpoints, [breakpoint]);
  const compiled = compileProject(f.project, { development: true, blueprintDebug: true });
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  const code = compiled.files['game/story.rpy'], runtime = compiled.files['game/98-blueprint-debug.rpy'];
  assert.ok(code.includes('vn_bp_debug_origins = ' + pythonBlockLiteral({ graphs: origins.graphs, nodes: origins.nodes }, 1)));
  assert.ok(code.includes('vn_bp_debug_checkpoint(' + pythonLiteral(privateChild.id) + ', ' + pythonLiteral(privateVisual.id)));
  assert.ok(code.includes('vn_bp_enter_frame(' + pythonLiteral(privateChild.id)));
  assert.ok(runtime.includes('return (authored[0], authored[1]) in self.points'));
  assert.ok(runtime.includes('breakpoint = self.has_breakpoint(graph, node)'));
  assert.ok(runtime.includes('data["site"] = self.authored_site(self.site)'));
  assert.ok(runtime.includes('debugger.values.setdefault(frame["id"], {})[(graph, node, pin)] = value'));
});

test('debug packets keep authored cross-graph input sources and reject invalid source coordinates', () => {
  const entry = { kind: 'input', sequence: 1, time: 0, graphId: 'child', nodeId: 'visual', pinId: 'object_text', sourceGraphId: 'parent', sourceNodeId: 'call', sourcePinId: 'out_title', value: '', available: true, stack: [] };
  const packet = { version: 1, sessionId: 'session', generation: 0, revision: 1, acknowledgement: 0, phase: 'running', reason: 'running', entries: [entry], dropped: 0, invocations: 0, breakpoints: [] };
  const parsed = parseBlueprintDebugPacket(packet)!;
  assert.equal(parsed.entries[0].sourceGraphId, 'parent'); assert.equal(parsed.entries[0].value, '');
  assert.equal(parseBlueprintDebugPacket({ ...packet, entries: [{ ...entry, sourceGraphId: {} }] }), undefined);
});
