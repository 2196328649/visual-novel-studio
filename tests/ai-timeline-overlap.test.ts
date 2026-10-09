import { projectGraphs, addProjectGraphs } from '../src/core/project-resources';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAiChanges, applyAiChanges, type AiOperation } from '../src/core/ai';
import { applyAiWorkflow, aiWorkflowFingerprint, type AiWorkflowProposal } from '../src/core/ai-workflow';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { exposePerformanceInputs, performanceInputs, blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins } from '../src/core/blueprint';
import { createVisualObject } from '../src/core/visual-object';
import { aiTimelineOverlapFixture } from '../scripts/lib/ai-timeline-overlap-fixture';

const set = (path: any[], value: any): AiOperation => ({ kind: 'editProject', path, action: 'set', value });
test('AI checks complete batches and selected subsets against stored track timing', () => {
  const { project, graph, first, gap } = aiTimelineOverlapFixture(), before = structuredClone(project);
  const duration = set(['timelinePresets', { id: graph.id }, 'nodes', { id: first }, 'properties', 'object_duration'], 5);
  assert.throws(() => prepareAiChanges(project, [duration], []), /图片时间轴.*重叠 1 秒/);
  const move = set(['timelinePresets', { id: graph.id }, 'nodes', { id: gap.id }, 'properties', 'seconds'], 5);
  const changes = prepareAiChanges(project, [duration, move], []);
  assert.throws(() => applyAiChanges(project, changes.slice(0, 1)), /同一轨道/);
  assert.deepEqual(project, before);
  const next = applyAiChanges(project, changes), model = performanceTimeline(next, projectGraphs(next)[0]);
  assert.deepEqual(model.clips.map(c => [c.at, c.duration]), [[0, 5], [5, 1]]); assert.equal(model.tracks.length, 1);
  const separate = set(['timelinePresets', { id: graph.id }, 'timeline'], { ...graph.timeline, tracks: [...graph.timeline!.tracks, { id: 'new_track', name: '下层' }], clips: graph.timeline!.clips.map(c => c.nodeId === first ? { ...c, trackId: 'new_track' } : c) });
  assert.doesNotThrow(() => prepareAiChanges(project, [duration, separate], []));
});

test('exposed defaults and child edits cannot introduce overlaps in a parent timeline', () => {
  const { project, graph, first } = aiTimelineOverlapFixture();
  exposePerformanceInputs(graph, performanceInputs(graph).filter(p => p.nodeId === first && p.pinId === 'object_duration'));
  assert.throws(() => prepareAiChanges(project, [set(['timelinePresets', { id: graph.id }, 'exposedInputs', { id: graph.exposedInputs[0].id }, 'defaultValue'], 5)], []), /同一轨道/);
  const parent = blueprintFromPerformance(project, [createVisualObject('solid')], '父时间轴'); addProjectGraphs(project, parent);
  const call = blueprintNodeDefaults('callFunction'); call.properties = { graphId: graph.id, wait: false }; call.pins = callablePins(graph);
  const last = parent.nodes.at(-1)!; parent.nodes.push(call); connectBlueprintPins(parent, last.id, 'exec_out', call.id, 'exec_in');
  const model = performanceTimeline(project, parent), track = model.tracks[0];
  arrangePerformanceTimeline(project, parent, model.clips.map(c => ({ ...c, at: c.nodeId === call.id ? 0 : 4, trackId: track.id })), [track]);
  // Child remains internally valid: make its final one-second clip three seconds long.
  const finalChild = graph.timeline!.clips.at(-1)!.nodeId;
  assert.throws(() => prepareAiChanges(project, [set(['timelinePresets', { id: graph.id }, 'nodes', { id: finalChild }, 'properties', 'object_duration'], 3)], []), /父时间轴.*同一轨道/);
});

test('legacy overlap permits unrelated edits and repair, while workflow replacement rejects new overlap', () => {
  const { project, graph, first, second } = aiTimelineOverlapFixture(), invalid = structuredClone(project);
  projectGraphs(invalid)[0].nodes.find(n => n.id === first)!.properties.object_duration = 5;
  const proposal: AiWorkflowProposal = { projectId: project.id, fingerprint: aiWorkflowFingerprint(project), project: invalid,
    summary: { lines: 0, portraitLines: 0, expressions: 0, voices: 0, importedAssets: 0, batches: 1 }, warnings: [], details: [] };
  assert.throws(() => applyAiWorkflow(project, proposal), /同一轨道/);
  assert.doesNotThrow(() => prepareAiChanges(invalid, [set(['timelinePresets', { id: graph.id }, 'name'], '旧工程改名')], []));
  assert.throws(() => prepareAiChanges(invalid, [set(['timelinePresets', { id: graph.id }, 'nodes', { id: second }, 'properties', 'object_duration'], 3)], []), /重叠 2 秒/);
  assert.doesNotThrow(() => prepareAiChanges(invalid, [set(['timelinePresets', { id: graph.id }, 'nodes', { id: first }, 'properties', 'object_duration'], 2)], []));
});
