import type { Project } from './model';
import type { BlueprintTraceData, BlueprintTraceFrame } from './blueprint-trace';
import { projectGraphs } from './project-resources';
import { rawSavedBlueprintAction } from './blueprint-authoring';
import { visualInputFields } from './visual-object';

export interface BlueprintPlaybackOrigin { graphId: string; nodeId: string; pins?: Record<string, string>; breakpoint?: false }

/** Playback identities own execution state; observations point back to editable sources. */
export function createBlueprintPlaybackOrigins(authored: Project, playback: Project) {
  const authors = new Map(projectGraphs(authored).map(graph => [graph.id, new Map(graph.nodes.map(node => [node.id, node]))]));
  const graphs: Record<string, string> = {}, nodes: Record<string, Record<string, BlueprintPlaybackOrigin>> = {};
  for (const graph of projectGraphs(playback)) {
    const entry = graph.nodes.find(node => node.type === 'event');
    const graphId = typeof entry?.properties.__timelineGraph === 'string' ? entry.properties.__timelineGraph : graph.id;
    if (graphId !== graph.id) graphs[graph.id] = graphId;
    for (const node of graph.nodes) {
      const sourceGraphId = typeof node.properties.__timelineGraph === 'string' ? node.properties.__timelineGraph : graphId;
      const sourceNodeId = typeof node.properties.__timelineNode === 'string' ? node.properties.__timelineNode : node.id;
      if (sourceGraphId === graph.id && sourceNodeId === node.id) continue;
      const source = authors.get(sourceGraphId)?.get(sourceNodeId), pins: Record<string, string> = {};
      const current = rawSavedBlueprintAction(node), original = source && rawSavedBlueprintAction(source);
      if (current?.kind === 'visual' && original?.kind === 'visual') {
        const paths = new Map(visualInputFields(original).map(field => [JSON.stringify(field.path), 'object_' + field.key]));
        for (const field of visualInputFields(current)) {
          const pin = paths.get(JSON.stringify(field.path));
          if (pin && pin !== 'object_' + field.key) pins['object_' + field.key] = pin;
        }
      }
      (nodes[graph.id] ??= {})[node.id] = {
        graphId: sourceGraphId, nodeId: sourceNodeId, ...(Object.keys(pins).length ? { pins } : {}),
        // A generated wait/capture helper may explain an authored operation,
        // but is not a second execution of that operation's breakpoint.
        ...(!source || source.type !== node.type ? { breakpoint: false as const } : {}),
      };
    }
  }
  const location = (graphId?: string, nodeId?: string, pinId?: string) => {
    const source = graphId && nodeId ? nodes[graphId]?.[nodeId] : undefined;
    return { graphId: source?.graphId ?? (graphId ? graphs[graphId] ?? graphId : undefined), nodeId: source?.nodeId ?? nodeId, pinId: pinId ? source?.pins?.[pinId] ?? pinId : pinId };
  };
  const stack = (frames: readonly BlueprintTraceFrame[]): BlueprintTraceFrame[] => frames.map((frame, index) => ({
    ...frame, graphId: graphs[frame.graphId] ?? frame.graphId,
    ...(frame.callNodeId && index > 0 ? { callNodeId: location(frames[index - 1].graphId, frame.callNodeId).nodeId } : {}),
  }));
  const data = (value: BlueprintTraceData, fallbackGraphId?: string): BlueprintTraceData => {
    const graphId = value.graphId ?? fallbackGraphId, target = location(graphId, value.nodeId, value.pinId);
    const result = { ...value, ...(target.graphId ? { graphId: target.graphId } : {}), ...(value.nodeId ? { nodeId: target.nodeId } : {}), ...(value.pinId ? { pinId: target.pinId } : {}) };
    if (value.sourceNodeId) {
      const source = location(value.sourceGraphId ?? graphId, value.sourceNodeId, value.sourcePinId);
      result.sourceGraphId = source.graphId; result.sourceNodeId = source.nodeId; result.sourcePinId = source.pinId;
    }
    return result;
  };
  return { graphs, nodes, location, stack, data };
}
