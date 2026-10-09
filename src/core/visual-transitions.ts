import type { ActorTransitionRule, VisualObject, VisualTransitions } from './model';

export const visualTransitionNames = { none: '立即', dissolve: '渐变', fade: '先淡出再淡入', move: '移动' } as const;
export const noVisualTransition: ActorTransitionRule = { mode: 'none', duration: 0 };
export function visualRule(object: VisualObject, phase: keyof VisualTransitions): ActorTransitionRule {
  return object.visualTransitions?.[phase] ?? (phase === 'replace' ? object.visualTransitions?.enter : undefined) ?? noVisualTransition;
}
export const visualTransitionSeconds = (rule?: ActorTransitionRule): number => rule && rule.mode !== 'none' ? rule.duration : 0;
export function visualLifetime(object: VisualObject): number {
  return object.persistent ? Infinity : object.content === 'video' && !object.loop && object.sourceDuration !== undefined
    ? Math.min(object.duration, Math.max(0, object.sourceDuration - (object.mediaOffset ?? 0))) : object.duration;
}
/** Repeating a persistent still does not flash or restart its motion. */
export function samePersistentVisual(a: VisualObject, b: VisualObject): boolean {
  if (!a.persistent || !b.persistent || a.content === 'video' || b.content === 'video') return false;
  const appearance = ({ visualTransitions: _rules, transitionWait: _wait, wait: _end, name: _name, ...object }: VisualObject) => object;
  return JSON.stringify(appearance(a)) === JSON.stringify(appearance(b));
}
export function visualPhasePose(object: VisualObject, time: number, skipEnter = false) {
  const enter = visualRule(object, 'enter'), exit = visualRule(object, 'exit'), lifetime = visualLifetime(object);
  const enterSeconds = Math.min(lifetime, visualTransitionSeconds(enter)), exitSeconds = Math.min(lifetime, visualTransitionSeconds(exit));
  const incoming = skipEnter || !enterSeconds ? 1 : Math.max(0, Math.min(1, time / enterSeconds));
  const outgoing = !exitSeconds || !Number.isFinite(lifetime) ? 1 : Math.max(0, Math.min(1, (lifetime - time) / exitSeconds));
  return { opacity: incoming * outgoing, x: (enter.mode === 'move' ? (incoming - 1) * .15 : 0) + (exit.mode === 'move' ? (1 - outgoing) * .15 : 0) };
}
