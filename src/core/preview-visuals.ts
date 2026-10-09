import type { ActorTransitionRule, StageAction, VisualObject } from './model';
import { samePersistentVisual, visualLifetime, visualRule, visualTransitionSeconds } from './visual-transitions';

export interface PreviewVisual {
  object: VisualObject; elapsed: number; skipEnter?: boolean;
  blend?: { previous: PreviewVisual; rule: ActorTransitionRule; elapsed: number; exiting?: boolean };
}
export function advancePreviewVisual(item: PreviewVisual, seconds: number): PreviewVisual | undefined {
  const elapsed = item.elapsed + seconds, blend = item.blend && { ...item.blend, elapsed: item.blend.elapsed + seconds };
  if (blend?.exiting) return blend.elapsed < visualTransitionSeconds(blend.rule) ? { ...item, elapsed, blend } : undefined;
  if (elapsed >= visualLifetime(item.object)) return undefined;
  return { ...item, elapsed, blend: blend && blend.elapsed < visualTransitionSeconds(blend.rule) ? blend : undefined };
}
export function previewVisualAction(previous: PreviewVisual | undefined, action: Extract<StageAction, { kind: 'visual' | 'hideVisual' }>): { item?: PreviewVisual; seconds: number; unchanged?: boolean } {
  if (action.kind === 'hideVisual') {
    if (!previous) return { seconds: 0 };
    const rule = action.exitTransition ?? visualRule(previous.object, 'exit'), seconds = visualTransitionSeconds(rule);
    return { seconds, item: seconds ? { ...previous, blend: { previous, rule, elapsed: 0, exiting: true } } : undefined };
  }
  if (previous && !previous.blend?.exiting && samePersistentVisual(previous.object, action)) return { seconds: 0, item: { ...previous, object: action }, unchanged: true };
  const rule = visualRule(action, previous ? 'replace' : 'enter'), seconds = Math.min(visualLifetime(action), visualTransitionSeconds(rule));
  return { seconds, item: { object: action, elapsed: 0, skipEnter: !!previous, blend: previous && seconds > 0 ? { previous, rule: { ...rule, duration: seconds }, elapsed: 0 } : undefined } };
}
