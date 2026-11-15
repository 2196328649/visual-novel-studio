import { connectBlueprintPins } from './blueprint';
import type { BlueprintGraph } from './model';

export interface BlueprintWireConnection { source: string; sourceHandle: string | null; target: string; targetHandle: string | null }

/** Validate on a candidate first, preserving the original wire and its identity
 * when a drop is incompatible, cyclic, stale, or onto the original endpoint. */
export function applyBlueprintWireConnection(graph: BlueprintGraph, connection: BlueprintWireConnection, previousId?: string): string | undefined {
  if (!connection.sourceHandle || !connection.targetHandle) return '连接点已不存在，请重新选择。';
  const previous = previousId ? graph.links.find(link => link.id === previousId) : undefined;
  if (previousId && !previous) return '连线已不存在，请重新选择。';
  if (previous && previous.fromNodeId === connection.source && previous.fromPinId === connection.sourceHandle && previous.toNodeId === connection.target && previous.toPinId === connection.targetHandle) return;
  // The validator only reads nodes and replaces links. Copying the link list
  // avoids cloning every node's properties while the pointer crosses pins.
  const candidate = { ...graph, links: [...graph.links] };
  if (previousId) candidate.links = candidate.links.filter(link => link.id !== previousId);
  const problem = connectBlueprintPins(candidate, connection.source, connection.sourceHandle, connection.target, connection.targetHandle);
  if (problem) return problem;
  if (previousId) candidate.links.at(-1)!.id = previousId;
  graph.links = candidate.links;
}
