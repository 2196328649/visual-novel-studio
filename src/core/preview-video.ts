import type { VisualObject } from './model';
import type { LinePlaybackPlan, PreviewStage } from './line-preview';
import { previewVisualAction } from './preview-visuals';

export interface PreviewVideoSpan { object: VisualObject; start: number; until: number }

/** Persistent movies do not delay dialogue, but their editor preview needs a clock. */
export function persistentVideoSpans(before: PreviewStage, plan: LinePlaybackPlan): PreviewVideoSpan[] {
  const active = new Map([...before.visuals].map(([id, visual]) => [id, { object: visual.object, start: -visual.elapsed * 1000 }]));
  const spans: PreviewVideoSpan[] = [];
  for (const [id, visual] of before.visuals) if (visual.blend?.exiting) {
    const item = active.get(id)!;
    if (item.object.content === 'video' && item.object.persistent) spans.push({ ...item, until: Math.max(0, (visual.blend.rule.duration - visual.blend.elapsed) * 1000) });
    active.delete(id);
  }
  const finish = (id: string, until: number) => {
    const item = active.get(id);
    if (item?.object.content === 'video' && item.object.persistent && until > Math.max(0, item.start)) spans.push({ ...item, until });
    active.delete(id);
  };
  for (const { action, at, before: state } of plan.steps) {
    if (action.kind === 'background') for (const id of active.keys()) finish(id, at);
    if (action.kind === 'hideVisual') finish(action.instanceId, at + previewVisualAction(state.visuals.get(action.instanceId), action).seconds * 1000);
    if (action.kind === 'visual') { finish(action.instanceId, at + previewVisualAction(state.visuals.get(action.instanceId), action).seconds * 1000); active.set(action.instanceId, { object: action, start: at }); }
  }
  for (const id of active.keys()) finish(id, Infinity);
  return spans;
}

export function persistentVideoPreviewEnd(spans: PreviewVideoSpan[], sourceDurations: Record<string, number>): number {
  return Math.max(0, ...spans.map(({ object, start, until }) => {
    const source = object.sourceDuration ?? sourceDurations[object.assetId ?? ''];
    const available = source === undefined ? undefined : Math.max(0, source - (object.mediaOffset ?? 0));
    const end = available === 0 ? start : object.loop || available === undefined ? Infinity : start + available * 1000;
    return Math.min(until, end);
  }));
}
