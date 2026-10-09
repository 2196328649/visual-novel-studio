import type { Project, StoryLine, StoryNode } from './model';
import { linePreviewSnapshot, type PreviewSelection } from './line-preview';

function sameValue(before: unknown, next: unknown): boolean {
  if (Object.is(before, next)) return true;
  if (!before || !next || typeof before !== 'object' || typeof next !== 'object' || Array.isArray(before) !== Array.isArray(next)) return false;
  return sameFields(before, next);
}

function sameFields(before: object, next: object, compare = (_key: string, a: unknown, b: unknown) => sameValue(a, b), ignored?: string): boolean {
  const a = before as Record<string, unknown>, b = next as Record<string, unknown>;
  const keys = Object.keys(a).filter(key => key !== ignored);
  return keys.length === Object.keys(b).filter(key => key !== ignored).length && keys.every(key => Object.hasOwn(b, key) && compare(key, a[key], b[key]));
}

function sameLines(before: StoryLine[], next: StoryLine[]): boolean {
  return before === next || before.length === next.length && before.every((line, index) => sameFields(line, next[index], undefined, 'text'));
}

function sameNodes(before: StoryNode[], next: StoryNode[]): boolean {
  return before === next || before.length === next.length && before.every((node, index) => {
    const other = next[index];
    return node === other || sameFields(node, other, (key, a, b) => key === 'lines' && node.kind === 'passage' && other.kind === 'passage' ? sameLines(a as StoryLine[], b as StoryLine[]) : sameValue(a, b));
  });
}

function sameStageInputs(before: Project, next: Project): boolean {
  return before === next || sameFields(before, next, (key, a, b) => key === 'nodes' ? sameNodes(a as StoryNode[], b as StoryNode[]) : sameValue(a, b), 'scriptText');
}

/** Per-preview cache for immutable project snapshots. Returned stage data is read-only.
 * Dialogue prose does not affect stage simulation; every other authored field does.
 */
export function createLinePreviewReader() {
  let previous: Project | undefined;
  const snapshots = new Map<string, ReturnType<typeof linePreviewSnapshot>>();
  return (project: Project, selected?: PreviewSelection, actionCount?: number) => {
    if (!previous || !sameStageInputs(previous, project)) snapshots.clear();
    previous = project;
    const key = JSON.stringify([selected?.nodeId, selected?.lineId, Object.entries(selected?.routeChoices ?? {}).sort(([a], [b]) => a.localeCompare(b)), actionCount]);
    let snapshot = snapshots.get(key);
    if (!snapshot) {
      snapshot = linePreviewSnapshot(project, selected, actionCount);
      snapshots.set(key, snapshot);
      // Keep the current full and partial previews, without retaining an entire novel's stages.
      if (snapshots.size > 4) snapshots.delete(snapshots.keys().next().value!);
    }
    if (!snapshot.line) return snapshot;
    const node = project.nodes.find(node => node.id === selected?.nodeId);
    const line = node?.kind === 'passage' ? node.lines.find(line => line.id === selected?.lineId) : undefined;
    const lines = new Map(project.nodes.flatMap(n => n.kind === 'passage' ? n.lines.map(l => [JSON.stringify([n.id, l.id]), l] as const) : []));
    const refreshStage = (stage: typeof snapshot.before): typeof snapshot.before => {
      const current = stage.dialogue && lines.get(JSON.stringify([stage.dialogueNodeId, stage.dialogue.id]));
      const dialogue = sameValue(current, stage.dialogue) ? stage.dialogue : current;
      const transitionMotion = stage.transitionMotion && { ...stage.transitionMotion, before: refreshStage(stage.transitionMotion.before) };
      return dialogue === stage.dialogue && (!transitionMotion || transitionMotion.before === stage.transitionMotion?.before) ? stage : { ...stage, dialogue, transitionMotion };
    };
    const before = refreshStage(snapshot.before), after = refreshStage(snapshot.after);
    if (line === snapshot.line && before === snapshot.before && after === snapshot.after) return snapshot;
    const refreshed = { ...snapshot, line, before, after };
    snapshots.set(key, refreshed);
    return refreshed;
  };
}
