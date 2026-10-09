import { projectGraphs } from './project-resources';
import type { Project, StageAction } from './model';

export type ActorReference = { characterId: string; instanceId?: string };
export type ShowActor = Extract<StageAction, { kind: 'show' }>;
/** Named instances have their own namespace; old projects retain their original tag. */
export const actorKey = (actor: ActorReference) => actor.instanceId ? `instance:${actor.instanceId}` : actor.characterId;
export const actorTag = (actor: ActorReference) => actor.instanceId ? `vn_instance_${actor.instanceId}` : `vn_actor_${actor.characterId}`;
export const actorReference = ({ characterId, instanceId }: ActorReference): ActorReference => ({ characterId, ...(instanceId ? { instanceId } : {}) });
export const actorLifetimes = { line: '仅本句', persistent: '持续显示' } as const;
export function parseActorLifetime(value: string): ShowActor['lifetime'] {
  if (!value || /^(场景内|scene|legacy)$/.test(value)) return undefined;
  if (/^(仅本句|本句|一次性|line)$/.test(value)) return 'line';
  if (/^(持续显示|持续|persistent)$/.test(value)) return 'persistent';
  throw new Error('显示范围请选择“仅本句”或“持续显示”。');
}
export function parseActorInstance(value: string) {
  if (!value) return undefined;
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(value)) throw new Error('实例 ID 请使用小写字母开头的字母、数字或下划线，最多 64 位。');
  return value;
}

export function actorInstanceIds(project: Project, characterId?: string): string[] {
  const ids = new Set<string>();
  const visit = (action: StageAction) => {
    if (action.kind === 'show' && action.instanceId && (!characterId || action.characterId === characterId)) ids.add(action.instanceId);
  };
  project.scenes.forEach(scene => scene.entryActions?.forEach(visit));
  project.nodes.forEach(node => { if (node.kind === 'passage') node.lines.forEach(line => line.actions.forEach(visit)); });
  project.effects?.forEach(effect => effect.actions?.forEach(visit));
  project.characters.forEach(character => character.features?.forEach(feature => feature.actions?.forEach(visit)));
  projectGraphs(project)?.forEach(graph => graph.nodes.forEach(node => {
    if (node.type === 'showCharacter' && typeof node.properties.instanceId === 'string' && (!characterId || node.properties.characterId === characterId)) ids.add(node.properties.instanceId);
  }));
  return [...ids].filter(Boolean).sort();
}
