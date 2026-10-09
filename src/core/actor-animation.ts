import type { StageAction } from './model';
import { visualCurve } from './visual-object';

export type ActorAnimation = Extract<StageAction, { kind: 'animate' }>;
export const actorCurveProperties = ['x', 'y', 'scale', 'rotation', 'opacity'] as const;
type ActorPose = Record<typeof actorCurveProperties[number], number>;

/** Insert/update only the edited properties at local playback time. */
export function setActorAnimationPoseAt(action: ActorAnimation, elapsed: number, initial: ActorPose, patch: Partial<ActorPose>) {
  if (!Number.isFinite(elapsed)) return;
  const duration = actorAnimationDuration(action);
  const time = Math.max(0, action.repeat && duration > 0 ? elapsed % duration : elapsed);
  for (const property of actorCurveProperties) {
    const value = patch[property];
    if (value === undefined || !Number.isFinite(value)) continue;
    let frames = action.curves?.[property]?.map(frame => ({ ...frame }));
    if (!frames?.length) {
      frames = [{ at: 0, value: initial[property], easing: 'linear' }];
      let at = 0;
      for (const frame of action.keyframes) {
        at += frame.duration;
        const next = { at, value: frame[property], easing: frame.easing };
        if (frames.at(-1)!.at === at) frames[frames.length - 1] = next;
        else frames.push(next);
      }
    }
    frames.sort((a, b) => a.at - b.at);
    // Extending a short property curve must retain its hold through the old end.
    if (time > duration && frames.at(-1)!.at < duration) {
      frames.push({ at: duration, value: frames.at(-1)!.value, easing: 'linear' });
    }
    const existing = frames.find(frame => Math.abs(frame.at - time) < 1e-8);
    if (existing) existing.value = value;
    else {
      const next = frames.find(frame => frame.at > time);
      frames.push({ at: time, value, easing: next?.easing ?? 'linear' });
      frames.sort((a, b) => a.at - b.at);
    }
    action.curves = { ...action.curves, [property]: frames };
  }
}
export function actorAnimationDuration(action: ActorAnimation) {
  return Math.max(action.keyframes.reduce((sum, frame) => sum + frame.duration, 0), ...Object.values(action.curves ?? {}).flatMap(frames => frames.map(frame => frame.at)));
}
export function actorCurvePose<T extends Record<typeof actorCurveProperties[number], number>>(action: ActorAnimation, time: number, fallback: T): T {
  const pose = { ...fallback };
  for (const property of actorCurveProperties) pose[property] = visualCurve(action, property, time, fallback[property]);
  pose.opacity = Math.max(0, Math.min(1, pose.opacity));
  return pose;
}

export function sampleActorAnimation<T extends Record<typeof actorCurveProperties[number], number>>(action: ActorAnimation, elapsed: number, initial: T): T {
  const duration = actorAnimationDuration(action), time = action.repeat && duration > 0 ? elapsed % duration : elapsed;
  let remaining = time, pose = { ...initial };
  for (const frame of action.keyframes) {
    if (frame.duration > 0 && remaining < frame.duration) {
      const t = Math.max(0, remaining / frame.duration);
      const eased = frame.easing === 'linear' ? t : frame.easing === 'easein' ? 1 - Math.cos(t * Math.PI / 2) : frame.easing === 'easeout' ? Math.sin(t * Math.PI / 2) : .5 - Math.cos(t * Math.PI) / 2;
      for (const property of actorCurveProperties) pose[property] += (frame[property] - pose[property]) * eased;
      break;
    }
    remaining -= frame.duration;
    for (const property of actorCurveProperties) pose[property] = frame[property];
  }
  return actorCurvePose(action, time, pose);
}
