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
