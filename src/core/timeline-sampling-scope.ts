import type { BlueprintGraph, Project } from './model';
import { projectGraphs } from './project-resources';
import { rawSavedBlueprintAction } from './blueprint-authoring';

const fixedCalls = new Set(['callFunction', 'callMacro', 'startTask', 'debounce', 'waitTask']);
const localActions = new Set(['event', 'delay', 'return', 'setVariable', 'setOutput', 'startDialogue', 'showBackground', 'hideCharacter', 'showChapter', 'camera', 'shake', 'playMusic', 'playSound', 'stopMusic']);

/** Limit only duration sampling's playback preparation, keeping the full catalog
 * available to composition expansion, defaults, source mapping and diagnostics.
 * Indirect actions use the existing full preparation rather than guessing their
 * effect, character, page or command targets. Recomputed for mutable projects. */
export function timelineSamplingGraphIds(project: Project, root: BlueprintGraph): ReadonlySet<string> | undefined {
  const graphs = new Map(projectGraphs(project).map(graph => [graph.id, graph])); graphs.set(root.id, root);
  const selected = new Set<string>(), pending = [root.id];
  while (pending.length) {
    const id = pending.pop()!;
    if (selected.has(id)) continue;
    selected.add(id);
    const graph = graphs.get(id); if (!graph) continue;
    for (const node of graph.nodes) {
      if (fixedCalls.has(node.type)) {
        if (typeof node.properties.graphId !== 'string') return;
        pending.push(node.properties.graphId);
      } else if (node.type === 'savedAction') {
        const action = rawSavedBlueprintAction(node); if (!action) return;
        if (action.kind === 'blueprint') pending.push(action.blueprintId);
        else if (action.kind === 'effect' || action.kind === 'characterFeature' || action.kind === 'show') return;
      } else if (!localActions.has(node.type) && node.pins.some(pin => pin.dataType === 'exec')) return;
    }
  }
  return selected;
}
