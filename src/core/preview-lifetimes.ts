import type { Project, VisualObject } from './model';
import type { LinePlaybackPlan, PreviewStage } from './line-preview';
import { actorKey } from './actor-instance';

export interface PreviewLifetime {
  id: string; instanceId: string; name: string; kind: 'actor' | 'visual'; depth: number;
  at: number; until: number; inherited: boolean; end: 'expires' | 'replaced' | 'hidden' | 'background' | 'line' | 'continues';
}
/** Current-line clock; inherited visual objects retain their known negative start. */
export function previewLifetimes(project: Project, before: PreviewStage, plan: LinePlaybackPlan, displayUntil: number) {
  const rows: PreviewLifetime[] = [], visuals = new Map<string, PreviewLifetime>(), actors = new Map<string, { row: PreviewLifetime; persistent: boolean }>();
  const objects = new Map<PreviewLifetime, VisualObject>();
  const close = (row: PreviewLifetime, at: number, end: PreviewLifetime['end']) => {
    if (at <= row.until) { row.until = at; row.end = end; }
  };
  const addActor = (actor: PreviewStage['actors'] extends Map<string, infer A> ? A : never, at: number, inherited: boolean) => {
    const instanceId = actorKey(actor), row: PreviewLifetime = { id: `life_${rows.length}`, instanceId, name: project.characters.find(character => character.id === actor.characterId)?.name ?? actor.characterId, kind: 'actor', depth: 0, at, until: displayUntil, inherited, end: actor.lifetime === 'line' ? 'line' : 'continues' };
    rows.push(row); actors.set(instanceId, { row, persistent: actor.lifetime === 'persistent' });
  };
  const addVisual = (object: VisualObject, at: number, inherited: boolean) => {
    const row: PreviewLifetime = { id: `life_${rows.length}`, instanceId: object.instanceId, name: object.name, kind: 'visual', depth: 0, at, until: at + object.duration * 1000, inherited, end: 'expires' };
    rows.push(row); visuals.set(object.instanceId, row); objects.set(row, object);
  };
  for (const actor of before.actors.values()) addActor(actor, 0, true);
  for (const visual of before.visuals.values()) addVisual(visual.object, -visual.elapsed * 1000, true);
  for (const step of plan.steps) {
    const action = step.action;
    if (action.kind === 'background') {
      for (const row of visuals.values()) close(row, step.at, 'background');
      visuals.clear();
      for (const [id, actor] of actors) if (!actor.persistent) { close(actor.row, step.at, 'background'); actors.delete(id); }
    } else if (action.kind === 'visual') {
      const old = visuals.get(action.instanceId); if (old) close(old, step.at, 'replaced');
      addVisual(action, step.at, false);
    } else if (action.kind === 'hide') {
      const old = actors.get(actorKey(action)); if (old) close(old.row, step.at, 'hidden');
      actors.delete(actorKey(action));
    } else if (action.kind === 'show') {
      const old = actors.get(actorKey(action)); if (old) close(old.row, step.at, 'replaced');
      const resolved = step.after.actors.get(actorKey(action)); if (resolved) addActor(resolved, step.at, false);
    }
  }
  const expand = (row: PreviewLifetime, object?: VisualObject): PreviewLifetime[] => {
    if (row.until <= 0 || row.until <= row.at || row.at >= displayUntil) return [];
    if (object?.content !== 'group') return [row];
    return [row, ...(object.children ?? []).flatMap((child, index) => {
      const at = row.at + (child.startAt ?? 0) * 1000, ownEnd = at + child.duration * 1000;
      return expand({ ...row, id: `${row.id}/${index}`, instanceId: child.instanceId, name: child.name, depth: row.depth + 1, at, until: Math.min(row.until, ownEnd), end: ownEnd < row.until ? 'expires' : row.end }, child);
    })];
  };
  return rows.flatMap(row => expand(row, objects.get(row)));
}
