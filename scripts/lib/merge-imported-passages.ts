import { type Project, type StoryNode } from '../../src/core/model';

export interface MergedPassage { removedId: string; retainedId: string; name: string; lineCount: number }

const markerId = (line: string) => line.match(/^\s*[@／/]\s*节点标记\s*[:：]\s*.*?【([a-z][a-z0-9_]{0,63})】\s*$/)?.[1];
const ordinary = (node?: StoryNode): node is Extract<StoryNode, { kind: 'passage' }> =>
  node?.kind === 'passage' && node.textHeading === false && node.lines.length > 0 && node.lines.every(line => !line.silent && !line.playback);

/** Repair a saved import, retaining every dialogue ID and all authored flow boundaries. */
export function mergeImportedPassages(input: Project): { project: Project; merged: MergedPassage[] } {
  const project = structuredClone(input), merged: MergedPassage[] = [];
  if (!input.scriptText) return { project, merged };
  const rows = input.scriptText.content.split('\n');
  const markers = rows.map(markerId);
  const visibleSource = rows.filter((_, index) => !markers[index]).join('\n');
  const serialized = JSON.stringify(input);
  const kept: StoryNode[] = [];
  for (const node of project.nodes) {
    const previous = kept.at(-1);
    const canMerge = ordinary(previous) && ordinary(node)
      && previous.sceneId === node.sceneId && previous.next === node.id
      && node.id !== project.entryId && !node.flowchart
      && markers.filter(id => id === node.id).length === 1
      // Only its declaration, its predecessor's next link and its hidden marker
      // may reference the removed ID. Protect branch targets and embedded refs.
      && serialized.split(node.id).length - 1 === 3
      && !visibleSource.includes(node.id) && !visibleSource.includes(node.name);
    if (canMerge && ordinary(previous) && node.kind === 'passage') {
      previous.lines.push(...node.lines);
      if (node.next === undefined) delete previous.next;
      else previous.next = node.next;
      merged.push({ removedId: node.id, retainedId: previous.id, name: node.name, lineCount: node.lines.length });
    } else kept.push(node);
  }
  if (merged.length) {
    const removed = new Set(merged.map(item => item.removedId));
    project.nodes = kept;
    project.scriptText!.content = rows.filter((_, index) => !removed.has(markers[index] ?? '')).join('\n');
  }
  return { project, merged };
}
