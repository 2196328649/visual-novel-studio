import { projectGraphs } from './project-resources';
import type { BlueprintGraph, Project } from './model';
import { savedBlueprintAction } from './blueprint-authoring';

/** These graphs launch all work immediately; their sole suspension is the final join.
 * Reject delayed/interactive graphs rather than silently changing their schedule. */
export function canLaunchTimeline(project: Project, graph: BlueprintGraph, ancestors = new Set<string>()): boolean {
  const graphs = new Map(projectGraphs(project).map(item => [item.id, item])), results = new Map<string, boolean>();
  const visit = (current: BlueprintGraph, parents: Set<string>): boolean => {
    if (!current.timeline?.tailNodeId || current.compositionContainer || parents.has(current.id)) return false;
    const cached = results.get(current.id); if (cached !== undefined) return cached;
    const inspect = () => {
      const seen = new Set<string>(), active = new Set(parents).add(current.id);
      let node = current.nodes.find(node => node.type === 'event');
      while (node) {
        if (seen.has(node.id)) return false;
        seen.add(node.id);
        const links = current.links.filter(link => link.fromNodeId === node!.id && node!.pins.some(pin => pin.id === link.fromPinId && pin.dataType === 'exec'));
        if (node.id === current.timeline!.tailNodeId) return node.type === 'delay' && links.length === 0;
        if (links.length !== 1) return false;
        if (node.type === 'savedAction') {
          const action = savedBlueprintAction(node);
          if (!action || !['visual', 'audioClip'].includes(action.kind) || !('wait' in action) || action.wait !== false) return false;
        } else if (node.type === 'callFunction') {
          const target = graphs.get(String(node.properties.graphId));
          if (!target || node.properties.wait !== false || !visit(target, active)) return false;
        } else if (!['event', 'playMusic', 'playSound', 'stopMusic'].includes(node.type)) return false;
        node = current.nodes.find(node => node.id === links[0].toNodeId);
      }
      return false;
    };
    const result = inspect(); results.set(current.id, result); return result;
  };
  return visit(graph, ancestors);
}
