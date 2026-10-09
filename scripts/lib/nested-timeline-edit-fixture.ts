import { createProject } from '../../src/core/model';
import { blueprintFromPerformance } from '../../src/core/blueprint-authoring';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins } from '../../src/core/blueprint';
import { createVisualObject } from '../../src/core/visual-object';
import { arrangePerformanceTimeline, performanceTimeline } from '../../src/core/performance-timeline';

export function nestedTimelineEditFixture() {
  const project = createProject('嵌套时间轴剪辑验收');
  const child = blueprintFromPerformance(project, [{ ...createVisualObject('solid'), name: '子画面', color: '#ed3040', duration: 2 }], '子时间轴'); project.blueprints.push(child);
  const childModel = performanceTimeline(project, child); arrangePerformanceTimeline(project, child, childModel.clips, childModel.tracks);
  const clipId = child.timeline!.clips[0].nodeId;
  const parent = blueprintFromPerformance(project, [{ ...createVisualObject('solid'), name: '后续画面', color: '#305ded', duration: 1 }], '外层时间轴'); project.blueprints.push(parent);
  const call = blueprintNodeDefaults('callFunction'); call.name = child.name; call.properties = { graphId: child.id, wait: false }; call.pins = callablePins(child);
  const previous = parent.nodes.at(-1)!; parent.nodes.push(call); connectBlueprintPins(parent, previous.id, 'exec_out', call.id, 'exec_in');
  const model = performanceTimeline(project, parent), track = model.tracks[0];
  const secondId = model.clips.find(c => c.nodeId !== call.id)!.nodeId;
  arrangePerformanceTimeline(project, parent, model.clips.map(c => ({ ...c, at: c.nodeId === call.id ? 0 : 4, trackId: track.id })), [track]);
  return { project, parent, child, clipId, callId: call.id, secondId };
}
