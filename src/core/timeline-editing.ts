import { projectGraphs } from './project-resources';
import type { Project } from './model';

export interface ClipPlacement { nodeId: string; trackId: string; at: number; duration: number }
const epsilon = .00001;

/** Find the nearest complete gap. Moving never trims or moves another clip. */
export function placeTimelineClip<T extends ClipPlacement>(clip: T, clips: ClipPlacement[]): T {
  const others = clips.filter(item => item.nodeId !== clip.nodeId && item.trackId === clip.trackId && item.duration > 0).sort((a, b) => a.at - b.at);
  if (clip.duration <= 0) return { ...clip, at: Math.max(0, clip.at) };
  let start = 0;
  const candidates: number[] = [];
  for (const other of others) {
    if (other.at - start >= clip.duration - epsilon) candidates.push(Math.max(start, Math.min(clip.at, other.at - clip.duration)));
    start = Math.max(start, other.at + other.duration);
  }
  candidates.push(Math.max(start, clip.at));
  const at = candidates.reduce((best, candidate) => Math.abs(candidate - clip.at) < Math.abs(best - clip.at) ? candidate : best);
  return { ...clip, at: Math.round(at * 1000000) / 1000000 };
}

/** Move a selection with one time/track offset. Collision fitting must move the
 * whole selection together; placing each clip separately would lose its timing. */
export function moveTimelineSelection<T extends ClipPlacement>(clips: T[], ids: readonly string[], tracks: readonly { id: string }[], delta: number, trackDelta = 0, fit = true): T[] {
  if (!Number.isFinite(delta) || !Number.isInteger(trackDelta)) throw new Error('移动时间和轨道必须是有效数值。');
  const selectedIds = new Set(ids), selected = clips.filter(clip => selectedIds.has(clip.nodeId));
  if (!selected.length && !selectedIds.size) return clips;
  if (selected.length !== selectedIds.size) throw new Error('部分片段已不存在，请重新选择。');
  const indices = new Map(tracks.map((track, index) => [track.id, index]));
  const positions = selected.map(clip => indices.get(clip.trackId));
  if (positions.some(index => index === undefined)) throw new Error('片段所在轨道已不存在，请重新选择。');
  const rows = positions as number[];
  const rowDelta = Math.max(-Math.min(...rows), Math.min(tracks.length - 1 - Math.max(...rows), trackDelta));
  const minimum = -Math.min(...selected.map(clip => clip.at));
  let offset = Math.max(minimum, delta);
  const others = clips.filter(clip => !selectedIds.has(clip.nodeId) && clip.duration > 0);
  const blocked: { start: number; end: number }[] = [];
  for (const clip of selected) {
    if (clip.duration <= 0) continue;
    const trackId = tracks[indices.get(clip.trackId)! + rowDelta].id;
    for (const other of others) if (other.trackId === trackId) {
      blocked.push({ start: other.at - clip.at - clip.duration, end: other.at + other.duration - clip.at });
    }
  }
  // Open intervals leave an exact touching boundary available for both clips.
  const merged: typeof blocked = [];
  for (const interval of blocked.sort((a, b) => a.start - b.start)) {
    const previous = merged.at(-1);
    if (previous && interval.start < previous.end - epsilon) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }
  const conflict = merged.find(interval => offset > interval.start + epsilon && offset < interval.end - epsilon);
  if (conflict) {
    if (!fit) throw new Error('移动后同一轨道的片段会重叠，请调整时间或移到其他轨道。');
    offset = conflict.start >= minimum && offset - conflict.start <= conflict.end - offset ? conflict.start : conflict.end;
  }
  const moved = clips.map(clip => {
    if (!selectedIds.has(clip.nodeId)) return clip;
    const at = Math.max(0, Math.round((clip.at + offset) * 1000000) / 1000000), trackId = tracks[indices.get(clip.trackId)! + rowDelta].id;
    return at === clip.at && trackId === clip.trackId ? clip : { ...clip, at, trackId };
  });
  if (timelineOverlap(moved)) throw new Error('移动后同一轨道的片段会重叠，请调整时间或移到其他轨道。');
  return moved;
}

/** The right trim handle stops at the next clip; gaps may still be left empty. */
export function trimTimelineClip<T extends ClipPlacement>(clip: T, clips: ClipPlacement[]): T {
  const next = Math.min(Infinity, ...clips.filter(item => item.nodeId !== clip.nodeId && item.trackId === clip.trackId && item.duration > 0 && item.at >= clip.at).map(item => item.at));
  return { ...clip, duration: Math.max(0, Math.min(clip.duration, next - clip.at)) };
}

/** The left trim handle keeps the clip's right edge fixed and stops at the
 * previous clip on the same track. Callers can additionally constrain the
 * returned start when a source media in-point has a lower bound. */
export function trimTimelineClipLeft<T extends ClipPlacement>(clip: T, clips: ClipPlacement[], start: number, minimumDuration = 0): T {
  const previous = Math.max(0, ...clips.filter(item => item.nodeId !== clip.nodeId && item.trackId === clip.trackId && item.duration > 0 && item.at + item.duration <= clip.at + .00001).map(item => item.at + item.duration));
  const right = clip.at + clip.duration;
  const at = Math.max(previous, Math.min(right - Math.max(0, minimumDuration), start));
  return { ...clip, at, duration: Math.max(0, right - at) };
}

export function timelineOverlap(clips: ClipPlacement[]) {
  const ends = new Map<string, number>();
  for (const clip of [...clips].sort((a, b) => a.at - b.at)) {
    if (clip.duration <= 0) continue;
    if (clip.at < (ends.get(clip.trackId) ?? 0) - epsilon) return clip;
    ends.set(clip.trackId, clip.at + clip.duration);
  }
}

/** Reserve a contiguous range for each nested timeline, so it behaves as one
 * layer in its parent while retaining its own internal track order. */
export function timelineLayerPlans(project: Project) {
  type Plan = { span: number; offsets: Map<string, number> };
  const plans = new Map<string, Plan>();
  const visit = (id: string, ancestors = new Set<string>()): Plan => {
    const cached = plans.get(id); if (cached) return cached;
    const graph = projectGraphs(project).find(graph => graph.id === id);
    if (!graph?.timeline || ancestors.has(id) || ancestors.size >= 16) return { span: 1, offsets: new Map() };
    const active = new Set(ancestors).add(id), offsets = new Map<string, number>();
    let span = 0;
    for (const track of [...graph.timeline.tracks].reverse()) {
      const nodes = graph.timeline.clips.filter(clip => clip.trackId === track.id).flatMap(clip => graph.nodes.filter(node => node.id === clip.nodeId));
      const widths = nodes.map(node => node.type === 'callFunction' ? visit(String(node.properties.graphId), active).span : 1);
      const width = Math.max(1, ...widths);
      nodes.forEach(node => offsets.set(node.id, span + (node.type === 'callFunction' ? 0 : width - 1)));
      span += width;
    }
    const plan = { span: Math.max(1, span), offsets }; plans.set(id, plan); return plan;
  };
  projectGraphs(project).forEach(graph => visit(graph.id));
  return plans;
}
