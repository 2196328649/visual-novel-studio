import { projectGraphs } from './project-resources';
import { actorTransitionsSchema, effectiveCharacter, type ActorTransitions, type ActorTransitionRule, type Project, type StageAction } from './model';

export const actorTransitionPhases = { enter: '入场过渡', exit: '离场过渡', expression: '表情切换过渡' } as const;
export const actorTransitionModes = { none: '立即', dissolve: '渐变', fade: '先淡出再淡入', move: '移动' } as const;
export function parseActorTransitions(value: unknown): ActorTransitions | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return actorTransitionsSchema.parse(typeof value === 'string' ? JSON.parse(value) : value);
}
export function actorTransitionDefaults(mode: ActorTransitionRule['mode'] = 'dissolve', duration = mode === 'fade' ? 1 : .5): Required<ActorTransitions> {
  return { enter: { mode, duration }, expression: { mode, duration }, exit: { mode: 'dissolve', duration: .5 } };
}
export function resolveActorTransitions(project: Project, characterId: string, action: { actorTransitions?: ActorTransitions; transition?: ActorTransitionRule['mode']; duration?: number; lifetime?: 'line' | 'persistent' }, override?: ActorTransitions): Required<ActorTransitions> | undefined {
  const defaults = effectiveCharacter(project, characterId)?.actorTransitions;
  // Automatic departures need phase rules even without authored overrides.
  // Existing scene/persistent animations keep their original entrance behavior.
  if (!defaults && !action.actorTransitions && !override && action.lifetime !== 'line') return undefined;
  return { ...actorTransitionDefaults(action.transition, action.duration), ...defaults, ...action.actorTransitions, ...override };
}
export const actorTransitionSeconds = (rule: ActorTransitionRule) => rule.mode === 'none' ? 0 : rule.duration;
export function graphShowsActors(project: Project, id: string, seen = new Set<string>()): boolean {
  if (seen.has(id)) return false; seen.add(id);
  return !!projectGraphs(project).find(g => g.id === id)?.nodes.some(n => ['showCharacter'].includes(n.type) || ['callFunction', 'callMacro'].includes(n.type) && graphShowsActors(project, String(n.properties.graphId), seen) || n.type === 'savedAction' && String(n.properties.action).includes('"kind":"show"'));
}
export function sameActorPose(a: Extract<StageAction, { kind: 'show' }>, b: Extract<StageAction, { kind: 'show' }>) {
  return a.characterId === b.characterId && a.expressionId === b.expressionId && a.x === b.x && a.y === b.y && a.scale === b.scale && a.layer === b.layer && !b.moveOffsets && !b.afterOffsets;
}
