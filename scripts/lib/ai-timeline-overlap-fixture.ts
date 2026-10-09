import { createProject } from '../../src/core/model';
import { blueprintFromPerformance } from '../../src/core/blueprint-authoring';
import { createVisualObject } from '../../src/core/visual-object';
import { insertTimelineAction, performanceTimeline } from '../../src/core/performance-timeline';

export function aiTimelineOverlapFixture() {
  const project = createProject('时间轴重叠防护验收'), graph = blueprintFromPerformance(project, [], '图片时间轴'); project.blueprints.push(graph);
  const trackId = performanceTimeline(project, graph).tracks[0].id;
  const first = insertTimelineAction(project, graph, { ...createVisualObject('solid'), name: '第一张', color: '#ed3040', duration: 2 }, 0, trackId);
  const second = insertTimelineAction(project, graph, { ...createVisualObject('solid'), name: '第二张', color: '#305ded', duration: 1 }, 3, trackId);
  const gap = graph.nodes.find(n => n.type === 'delay' && n.id !== graph.timeline!.tailNodeId)!;
  return { project, graph, trackId, first, second, gap };
}
