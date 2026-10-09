import { afterOffsetDuration } from './move-offsets';
import type { StageAction } from './model';
import { actorAnimationDuration } from './actor-animation';
import { cameraAnimationDuration } from './camera-animation';
import { previewVisualAction, advancePreviewVisual, type PreviewVisual } from './preview-visuals';
import { visualTransitionSeconds } from './visual-transitions';

/** Seconds, shared by tracks, preview and native blueprint scheduling. */
export function actionTiming(action: StageAction): { duration: number; wait: boolean } {
  if ('transition' in action) return { duration: action.transition === 'none' ? 0 : action.duration ?? (action.transition === 'fade' ? 1 : .5), wait: action.wait !== false };
  switch (action.kind) {
    case 'pause': return { duration: action.seconds, wait: true };
    case 'hideVisual': return { duration: visualTransitionSeconds(action.exitTransition), wait: action.wait !== false };
    case 'chapter': return { duration: action.duration, wait: action.wait !== false };
    case 'audioClip': return { duration: Math.min(action.duration, action.sourceDuration === undefined ? Infinity : Math.max(0, action.sourceDuration - action.offset)), wait: action.wait };
    case 'visual': return { duration: action.persistent ? 0 : action.content === 'video' && !action.loop && action.sourceDuration !== undefined ? Math.min(action.duration, Math.max(0, action.sourceDuration - (action.mediaOffset ?? 0))) : action.duration, wait: !action.persistent && action.wait };
    case 'camera': return { duration: cameraAnimationDuration(action), wait: action.wait };
    case 'shake': return { duration: action.duration ?? .6, wait: action.wait !== false };
    case 'animate': return { duration: actorAnimationDuration(action), wait: action.wait && !action.repeat };
    case 'music': case 'stopMusic': return { duration: action.fade, wait: false };
    default: return { duration: 0, wait: false };
  }
}
export function performanceTiming(actions: StageAction[]) {
  let at = 0, until = 0;
  const visuals = new Map<string, { item: PreviewVisual; at: number }>();
  for (const action of actions) {
    if (action.kind === 'background') visuals.clear();
    if (action.kind === 'visual' || action.kind === 'hideVisual') {
      const previous = visuals.get(action.instanceId), state = previous && advancePreviewVisual(previous.item, at - previous.at);
      const { item, seconds } = previewVisualAction(state, action);
      if (item) visuals.set(action.instanceId, { item, at }); else visuals.delete(action.instanceId);
      const timing = actionTiming(action);
      until = Math.max(until, at + Math.max(timing.duration, seconds));
      if (action.kind === 'hideVisual' ? action.wait !== false : action.transitionWait && !timing.wait) at += seconds;
      else if (timing.wait) at += timing.duration;
      continue;
    }
    const { duration, wait } = actionTiming(action);
    until = Math.max(until, at + duration + (action.kind === 'show' ? afterOffsetDuration(action.afterOffsets) : 0));
    if (wait) at += duration;
  }
  return { at, until };
}
