import type { StageAction } from './model';
import { visualCurve } from './visual-object';

export type CameraAction = Extract<StageAction, { kind: 'camera' }>;
export const cameraCurveProperties = ['x', 'y', 'zoom', 'rotation'] as const;
export type CameraPose = Pick<CameraAction, typeof cameraCurveProperties[number]>;
export function cameraAnimationDuration(action: CameraAction) {
  return Math.max(action.duration, ...Object.values(action.curves ?? {}).flatMap(frames => frames.map(frame => frame.at)));
}
export function sampleCamera(initial: CameraAction, action: CameraAction, elapsed: number): CameraAction {
  const result = { ...action };
  for (const key of cameraCurveProperties) {
    const frames = action.curves?.[key] ?? (action.duration > 0 ? [
      { at: 0, value: initial[key], easing: 'linear' as const },
      { at: action.duration, value: action[key], easing: action.easing },
    ] : [{ at: 0, value: action[key], easing: 'linear' as const }]);
    result[key] = visualCurve({ curves: { x: frames } }, 'x', elapsed, action[key]);
  }
  return result;
}
export function setCameraPoseAt(action: CameraAction, elapsed: number, initial: CameraPose, patch: Partial<CameraPose>) {
  if (!Number.isFinite(elapsed)) return;
  const time = Math.max(0, elapsed), duration = cameraAnimationDuration(action);
  for (const key of cameraCurveProperties) {
    const value = patch[key]; if (value === undefined || !Number.isFinite(value)) continue;
    const frames = action.curves?.[key]?.map(frame => ({ ...frame })) ?? (action.duration > 0 ? [
      { at: 0, value: initial[key], easing: 'linear' as const },
      { at: action.duration, value: action[key], easing: action.easing },
    ] : [{ at: 0, value: action[key], easing: 'linear' as const }]);
    frames.sort((a, b) => a.at - b.at);
    if (time > duration && frames.at(-1)!.at < duration) frames.push({ ...frames.at(-1)!, at: duration });
    const existing = frames.find(frame => Math.abs(frame.at - time) < 1e-8);
    if (existing) existing.value = value;
    else { frames.push({ at: time, value, easing: frames.find(frame => frame.at > time)?.easing ?? 'linear' }); frames.sort((a, b) => a.at - b.at); }
    action.curves = { ...action.curves, [key]: frames };
  }
}
