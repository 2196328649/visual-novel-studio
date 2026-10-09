import { projectGraphs } from './project-resources';
import type { BlueprintGraph, Project } from './model';
import { savedBlueprintAction } from './blueprint-authoring';

/** These graphs launch all work immediately; their sole suspension is the final join.
 * Reject delayed/interactive graphs rather than silently changing their schedule. */
export function canLaunchTimeline(project: Project, graph: BlueprintGraph, ancestors = new Set<string>()): boolean {
  if (!graph.timeline?.tailNodeId || graph.compositionContainer || ancestors.has(graph.id)) return false;
  const seen = new Set<string>(), active = new Set(ancestors).add(graph.id);
  let node = graph.nodes.find(node => node.type === 'event');
  while (node) {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    const links = graph.links.filter(link => link.fromNodeId === node!.id && node!.pins.some(pin => pin.id === link.fromPinId && pin.dataType === 'exec'));
    if (node.id === graph.timeline.tailNodeId) return node.type === 'delay' && links.length === 0;
    if (links.length !== 1) return false;
    if (node.type === 'savedAction') {
      const action = savedBlueprintAction(node);
      if (!action || !['visual', 'audioClip'].includes(action.kind) || !('wait' in action) || action.wait !== false) return false;
    } else if (node.type === 'callFunction') {
      const target = projectGraphs(project).find(graph => graph.id === node!.properties.graphId);
      if (!target || node.properties.wait !== false || !canLaunchTimeline(project, target, active)) return false;
    } else if (!['event', 'playMusic', 'playSound', 'stopMusic'].includes(node.type)) return false;
    node = graph.nodes.find(node => node.id === links[0].toNodeId);
  }
  return false;
}
