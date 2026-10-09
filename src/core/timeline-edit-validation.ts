import { projectGraphs } from './project-resources';
import type { BlueprintGraph, Project } from './model';
import { synchronizeBlueprintSignatures } from './blueprint';
import { performanceTimeline } from './performance-timeline';

/** Compare authored rows, before the editor separates legacy overlaps for display. */
function timelineConflicts(project: Project) {
  const conflicts = new Map<string, { overlap: number; graph: string; track: string; first: string; second: string }>();
  for (const graph of projectGraphs(project)) {
    if (!graph.timeline) continue;
    const model = performanceTimeline(project, graph);
    if (model.reason) continue; // Branching or dynamically timed graphs have no fixed clip layout.
    const assignments = new Map(graph.timeline.clips.map(c => [c.nodeId, c.trackId]));
    const clips = model.clips.filter(c => c.duration > 0).map(c => ({ ...c, trackId: assignments.get(c.nodeId) ?? c.trackId }));
    for (let i = 0; i < clips.length; i++) for (let j = i + 1; j < clips.length; j++) {
      const a = clips[i], b = clips[j]; if (a.trackId !== b.trackId) continue;
      const overlap = Math.min(a.at + a.duration, b.at + b.duration) - Math.max(a.at, b.at);
      if (overlap <= .00001) continue;
      const key = JSON.stringify([graph.id, ...[a.nodeId, b.nodeId].sort()]);
      conflicts.set(key, { overlap, graph: graph.name, track: model.tracks.find(t => t.id === a.trackId)?.name ?? a.trackId,
        first: graph.nodes.find(n => n.id === a.nodeId)?.name ?? a.nodeId, second: graph.nodes.find(n => n.id === b.nodeId)?.name ?? b.nodeId });
    }
  }
  return conflicts;
}

/** Keep existing legacy projects editable, but reject new or enlarged overlaps atomically. */
export function assertTimelineEditDoesNotOverlap(before: Project, after: Project) {
  if (!projectGraphs(after).some(g => g.timeline)) return;
  const timingFields = ['blueprints', 'timelinePresets', 'variables', 'effects', 'characters', 'scenes', 'playerDefaults'] as const;
  if (timingFields.every(field => JSON.stringify(before[field]) === JSON.stringify(after[field]))) return;
  const previous = timelineConflicts(before);
  for (const [key, conflict] of timelineConflicts(after)) {
    if (conflict.overlap <= (previous.get(key)?.overlap ?? 0) + .00001) continue;
    throw new Error(`时间轴“${conflict.graph}”的“${conflict.track}”中，“${conflict.first}”与“${conflict.second}”重叠 ${Number(conflict.overlap.toFixed(4))} 秒。同一轨道的片段不能重叠，请在同一批修改中缩短片段、调整开始时间或移到其他轨道。`);
  }
}

/** A clip edit can change the duration of every caller, including grandparents.
 * Validate the complete candidate before publishing it or selecting new nodes. */
export function editTimelineProject<T>(project: Project, graphId: string, edit: (draft: Project, graph: BlueprintGraph) => T): T {
  const draft = structuredClone(project), graph = projectGraphs(draft).find(g => g.id === graphId);
  if (!graph) throw new Error('时间轴已不存在，请重新选择。');
  const result = edit(draft, graph);
  synchronizeBlueprintSignatures(draft);
  assertTimelineEditDoesNotOverlap(project, draft);
  Object.assign(project, draft);
  return result;
}
