import { projectGraphs, addProjectGraphs } from '../src/core/project-resources';
import test from 'node:test';
import assert from 'node:assert/strict';
import { nestedTimelineEditFixture } from '../scripts/lib/nested-timeline-edit-fixture';
import { editTimelineProject } from '../src/core/timeline-edit-validation';
import { arrangePerformanceTimeline, insertTimelineAction, performanceTimeline } from '../src/core/performance-timeline';
import { createVisualObject } from '../src/core/visual-object';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs } from '../src/core/blueprint-authoring';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins } from '../src/core/blueprint';

test('child clip edits and inserts reject parent overlap atomically, then accept coordinated parent spacing', () => {
  const { project, child, parent, clipId, secondId } = nestedTimelineEditFixture(), before = structuredClone(project);
  const resize = (draft: typeof project, graph: typeof child) => {
    graph.nodes.find(n => n.id === clipId)!.properties.object_duration = 6;
    const model = performanceTimeline(draft, graph); arrangePerformanceTimeline(draft, graph, model.clips, model.tracks);
  };
  assert.throws(() => editTimelineProject(project, child.id, resize), /外层时间轴.*同一轨道/); assert.deepEqual(project, before);
  assert.throws(() => editTimelineProject(project, child.id, (draft, graph) => insertTimelineAction(draft, graph, { ...createVisualObject('solid'), duration: 6 }, 0)), /外层时间轴/);
  assert.deepEqual(project, before);
  editTimelineProject(project, parent.id, (draft, graph) => { const model = performanceTimeline(draft, graph); arrangePerformanceTimeline(draft, graph, model.clips.map(c => c.nodeId === secondId ? { ...c, at: 6 } : c), model.tracks); });
  editTimelineProject(project, child.id, resize);
  assert.deepEqual(performanceTimeline(project, projectGraphs(project).find(g => g.id === parent.id)!).clips.map(c => [c.at, c.duration]), [[0, 6], [6, 1]]);
});

test('public defaults in a nested child check grandparent tracks before publishing signatures', () => {
  const { project, child, parent, clipId, callId } = nestedTimelineEditFixture();
  exposePerformanceInputs(child, performanceInputs(child).filter(p => p.nodeId === clipId && p.pinId === 'object_duration'));
  const middle = blueprintFromPerformance(project, [], '中间时间轴'); addProjectGraphs(project, middle);
  const call = blueprintNodeDefaults('callFunction'); call.properties = { graphId: child.id, wait: false }; call.pins = callablePins(child);
  middle.nodes.push(call); connectBlueprintPins(middle, middle.nodes[0].id, 'exec', call.id, 'exec_in');
  const model = performanceTimeline(project, middle); arrangePerformanceTimeline(project, middle, model.clips, model.tracks);
  parent.nodes.find(n => n.id === callId)!.properties.graphId = middle.id;
  parent.nodes.find(n => n.id === callId)!.pins = callablePins(middle);
  const before = structuredClone(project);
  assert.throws(() => editTimelineProject(project, child.id, (_, graph) => { graph.exposedInputs[0].defaultValue = 6; }), /外层时间轴/);
  assert.deepEqual(project, before);
  editTimelineProject(project, child.id, (_, graph) => { graph.exposedInputs[0].defaultValue = 3; });
  assert.equal(performanceTimeline(project, projectGraphs(project).find(g => g.id === parent.id)!).clips[0].duration, 3);
});

test('legacy parent overlaps still allow unrelated changes and child repairs', () => {
  const { project, child, clipId } = nestedTimelineEditFixture();
  child.nodes.find(n => n.id === clipId)!.properties.object_duration = 6;
  editTimelineProject(project, child.id, (_, graph) => { graph.name = '可编辑的旧时间轴'; });
  const before = structuredClone(project);
  assert.throws(() => editTimelineProject(project, 'missing', () => undefined), /已不存在/); assert.deepEqual(project, before);
  editTimelineProject(project, child.id, (_, graph) => { graph.nodes.find(n => n.id === clipId)!.properties.object_duration = 4; });
  assert.equal(projectGraphs(project).find(graph => graph.id === child.id)?.name, '可编辑的旧时间轴');
});
