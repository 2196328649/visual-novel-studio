import type { BlueprintGraph, BlueprintNode } from './model';
import { blueprintFlowControlInputs, isBlueprintFlowControl } from './blueprint-flow-control';

/** Operations on a controller do not execute its enter outputs. Node-only
 * reachability incorrectly treats a finite reset-after-work route as a cycle. */
export function blueprintExecutionOutputs(node: BlueprintNode, entry = 'exec_in'): string[] {
  const outputs = node.pins.filter(pin => pin.direction === 'output' && pin.dataType === 'exec').map(pin => pin.id);
  if (node.type === 'throttle') return outputs.filter(id => entry === 'exec_in' ? id === 'exec_out' || id === 'blocked' : entry === 'reset' && id === 'updated');
  if (!isBlueprintFlowControl(node.type)) return outputs;
  if (!blueprintFlowControlInputs(node.type).includes(entry)) return [];
  return outputs.filter(id => entry === 'exec_in' ? id === 'exec_out' || id === 'blocked' : id === 'updated');
}
function executionIndex(graph: BlueprintGraph) {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const links = new Map<string, typeof graph.links>();
  for (const link of graph.links) {
    if (nodes.get(link.fromNodeId)?.pins.find(pin => pin.id === link.fromPinId)?.dataType !== 'exec') continue;
    const outgoing = links.get(link.fromNodeId) ?? []; outgoing.push(link); links.set(link.fromNodeId, outgoing);
  }
  return { nodes, links };
}
export function blueprintExecutionConnectionCycles(graph: BlueprintGraph, fromNodeId: string, fromPinId: string, toNodeId: string, toPinId: string): boolean {
  const { nodes, links } = executionIndex(graph), seen = new Set<string>();
  const reaches = (id: string, entry: string): boolean => {
    const key = id + ':' + entry, node = nodes.get(id); if (!node || seen.has(key)) return false;
    seen.add(key); const outputs = blueprintExecutionOutputs(node, entry);
    if (id === fromNodeId && outputs.includes(fromPinId)) return true;
    return (links.get(id) ?? []).some(link => outputs.includes(link.fromPinId) && reaches(link.toNodeId, link.toPinId));
  };
  return reaches(toNodeId, toPinId);
}
export function blueprintExecutionCycleNode(graph: BlueprintGraph): BlueprintNode | undefined {
  const { nodes, links } = executionIndex(graph), visited = new Set<string>(), active = new Set<string>();
  const visit = (id: string, entry: string): BlueprintNode | undefined => {
    const key = id + ':' + entry, node = nodes.get(id); if (!node) return;
    if (active.has(key)) return node; if (visited.has(key)) return;
    active.add(key); const outputs = blueprintExecutionOutputs(node, entry);
    for (const link of links.get(id) ?? []) if (outputs.includes(link.fromPinId)) { const cycle = visit(link.toNodeId, link.toPinId); if (cycle) return cycle; }
    active.delete(key); visited.add(key);
  };
  for (const node of graph.nodes) {
    const inputs = node.pins.filter(pin => pin.direction === 'input' && pin.dataType === 'exec');
    for (const entry of inputs.length ? inputs.map(pin => pin.id) : ['exec_in']) { const cycle = visit(node.id, entry); if (cycle) return cycle; }
  }
}
