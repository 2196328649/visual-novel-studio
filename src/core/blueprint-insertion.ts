import { adaptBlueprintNodeToPin, blueprintPinsCompatible, connectBlueprintPins, synchronizeBlueprintNodeValuePins } from './blueprint';
import type { BlueprintGraph, BlueprintNode, Project } from './model';

export interface BlueprintWireOrigin { nodeId: string; pinId: string; direction: 'input' | 'output' }

/** Share the tentative graph between palette checks and the committed insertion.
 * Never mutate the source node, the author graph, or an existing connection. */
export function prepareBlueprintInsertion(project: Project, graph: BlueprintGraph, source: BlueprintNode, wire?: BlueprintWireOrigin) {
  const node = { ...source, properties: { ...source.properties }, pins: source.pins.map(pin => ({ ...pin })) };
  synchronizeBlueprintNodeValuePins(project, graph, node);
  const origin = wire && graph.nodes.find(item => item.id === wire.nodeId)?.pins.find(pin => pin.id === wire.pinId);
  adaptBlueprintNodeToPin(node, origin);
  const destination = origin && node.pins.find(pin => origin.direction === 'output' ? blueprintPinsCompatible(origin, pin) : blueprintPinsCompatible(pin, origin));
  const candidateGraph = { ...graph, nodes: [...graph.nodes, node], links: [...graph.links] };
  let problem: string | undefined;
  if (wire) {
    if (!origin || origin.direction !== wire.direction || !destination) problem = '没有兼容的连接点，请选择其他节点。';
    else problem = origin.direction === 'output'
      ? connectBlueprintPins(candidateGraph, wire.nodeId, wire.pinId, node.id, destination.id)
      : connectBlueprintPins(candidateGraph, node.id, destination.id, wire.nodeId, wire.pinId);
  }
  return { node, graph: candidateGraph, origin, destination, problem };
}
