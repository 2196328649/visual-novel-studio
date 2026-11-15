import type { Project, StoryLine, StoryNode } from './model';
import { linePreviewSnapshot, type PreviewSelection } from './line-preview';

function sameValue(before: unknown, next: unknown): boolean {
  if (Object.is(before, next)) return true;
  if (!before || !next || typeof before !== 'object' || typeof next !== 'object' || Array.isArray(before) !== Array.isArray(next)) return false;
  return sameFields(before, next);
}

function sameFields(
  before: object,
  next: object,
  compare = (_key: string, a: unknown, b: unknown) => sameValue(a, b),
  ignored?: string | ReadonlySet<string>,
): boolean {
  const a = before as Record<string, unknown>, b = next as Record<string, unknown>;
  const isIgnored = (key: string) => typeof ignored === 'string' ? key === ignored : ignored?.has(key) ?? false;
  const keys = Object.keys(a).filter(key => !isIgnored(key));
  return keys.length === Object.keys(b).filter(key => !isIgnored(key)).length && keys.every(key => Object.hasOwn(b, key) && compare(key, a[key], b[key]));
}

// These values belong to the text preview, while this cache owns only stage
// simulation. Keep them out of stage invalidation and refresh current dialogue
// references separately below.
const textOnlyLineFields = new Set(['text', 'textPresentation', 'textSpans', 'textPauses']);

function sameLines(before: StoryLine[], next: StoryLine[]): boolean {
  return before === next || before.length === next.length && before.every((line, index) => line === next[index]
    || sameFields(line, next[index], undefined, textOnlyLineFields));
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
 * Dialogue prose and text presentation fields do not affect stage simulation; stage inputs still invalidate it.
 */
export function createLinePreviewReader() {
  let previous: Project | undefined;
  const snapshots = new Map<string, { project: Project; value: ReturnType<typeof linePreviewSnapshot> }>();
  let indexedNodes: Project['nodes'] | undefined;
  const indexedNodeLines = new Map<string, { node: StoryNode; keys: string[] }>();
  const linesByKey = new Map<string, StoryLine>();
  return (project: Project, selected?: PreviewSelection, actionCount?: number) => {
    if (!previous || !sameStageInputs(previous, project)) snapshots.clear();
    previous = project;
    if (indexedNodes !== project.nodes) {
      const currentNodeIds = new Set<string>();
      for (const node of project.nodes) {
        currentNodeIds.add(node.id);
        const indexed = indexedNodeLines.get(node.id);
        if (indexed?.node === node) continue;
        for (const key of indexed?.keys ?? []) linesByKey.delete(key);
        const keys: string[] = [];
        if (node.kind === 'passage') {
          for (const line of node.lines) {
            const key = JSON.stringify([node.id, line.id]);
            keys.push(key);
            linesByKey.set(key, line);
          }
        }
        indexedNodeLines.set(node.id, { node, keys });
      }
      for (const [nodeId, indexed] of indexedNodeLines) {
        if (currentNodeIds.has(nodeId)) continue;
        for (const key of indexed.keys) linesByKey.delete(key);
        indexedNodeLines.delete(nodeId);
      }
      indexedNodes = project.nodes;
    }
    const key = JSON.stringify([selected?.nodeId, selected?.lineId, Object.entries(selected?.routeChoices ?? {}).sort(([a], [b]) => a.localeCompare(b)), actionCount]);
    let cached = snapshots.get(key);
    if (!cached) {
      cached = { project, value: linePreviewSnapshot(project, selected, actionCount) };
      snapshots.set(key, cached);
      // Keep the current full and partial previews, without retaining an entire novel's stages.
      if (snapshots.size > 4) snapshots.delete(snapshots.keys().next().value!);
    }
    if (cached.project !== project) {
      const snapshot = cached.value;
      const refreshStage = (stage: typeof snapshot.before): typeof snapshot.before => {
        const currentDialogue = stage.dialogueNodeId && stage.dialogue
          ? linesByKey.get(JSON.stringify([stage.dialogueNodeId, stage.dialogue.id]))
          : undefined;
        const dialogue = sameValue(currentDialogue, stage.dialogue) ? stage.dialogue : currentDialogue;
        let transitionMotion = stage.transitionMotion;
        if (transitionMotion) {
          const before = refreshStage(transitionMotion.before);
          if (before !== transitionMotion.before) transitionMotion = { ...transitionMotion, before };
        }
        if (dialogue === stage.dialogue && transitionMotion === stage.transitionMotion) return stage;
        const refreshed = { ...stage };
        if (dialogue !== stage.dialogue) refreshed.dialogue = dialogue;
        if (transitionMotion !== stage.transitionMotion) refreshed.transitionMotion = transitionMotion;
        return refreshed;
      };
      const before = refreshStage(snapshot.before), after = refreshStage(snapshot.after);
      const resolvedLine = selected && linesByKey.get(JSON.stringify([selected.nodeId, selected.lineId]));
      const currentLine = sameValue(resolvedLine, snapshot.line) ? snapshot.line : resolvedLine;
      const value = currentLine === snapshot.line && before === snapshot.before && after === snapshot.after
        ? snapshot
        : { ...snapshot, line: currentLine, before, after };
      cached = { project, value };
      snapshots.set(key, cached);
    }
    const snapshot = cached.value;
    return snapshot;
  };
}
