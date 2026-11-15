import { targets, type Project, type StoryNode } from './model';
import type { StoryMenuEntry } from './story-menu';

export interface FlowEndpoint { from: string; to: string }
export interface FlowEdgePath { nodeIds: string[]; labels: string[]; truncated?: boolean }
export interface FlowConnection {
  from: string;
  to: string;
  label: string;
  /** Complete real story endpoint pairs, independent of the bounded explanations. */
  endpoints?: FlowEndpoint[];
  via?: string[];
  paths?: FlowEdgePath[];
}

export interface StoryFlowConnectionOptions {
  /** A projection may collapse calls while retaining the real node IDs in routes. */
  exits?: (node: StoryNode) => { port: string; target?: string }[];
  allowedNodeIds?: ReadonlySet<string>;
  entryNodeId?: (entry: StoryMenuEntry) => string;
}

/** A representative route may be omitted; an actual unlocked connection may not. */
export function flowEdgeUnlocked(edge: FlowConnection, reached: (id: string) => boolean): boolean {
  if (edge.endpoints !== undefined) return edge.endpoints.some(pair => reached(pair.from) && reached(pair.to));
  // Older generated maps have only explanatory paths, or just display endpoints.
  const routes = edge.paths?.filter(path => path.nodeIds.length);
  return routes?.length
    ? routes.some(path => reached(path.nodeIds[0]) && reached(path.nodeIds.at(-1)!))
    : reached(edge.from) && reached(edge.to);
}

/** Traverse real exits, retaining bounded descriptions alongside complete connectivity. */
export function storyFlowConnections(project: Project, entries: readonly StoryMenuEntry[], options?: StoryFlowConnectionOptions) {
  const all = new Map(project.nodes.map(node => [node.id, node]));
  const entryNodeId = options?.entryNodeId ?? ((entry: StoryMenuEntry) => entry.id);
  const shown = new Map(entries.map(entry => [entryNodeId(entry), entry.id]));
  const visible = entries.flatMap(entry => all.has(entryNodeId(entry)) ? [{ node: all.get(entryNodeId(entry))!, id: entry.id }] : []);
  const locations = new Map(visible.map(({ node, id }) => [node.id, { id, distance: 0 }]));
  const edges: FlowConnection[] = [], edgeIndex = new Map<string, FlowConnection>();
  const labelFor = (node: StoryNode, port: string) => node.kind === 'choice' ? node.choices.find(choice => choice.id === port)?.text ?? '' : node.kind === 'condition' ? port === 'yes' ? '条件满足' : '条件未满足' : '';
  interface Route { nodeId: string; branch: string; previous?: Route }
  for (const { node: source, id: sourceId } of visible) {
    const pending: { target: string; label: string; distance: number; route: Route }[] = [];
    const scheduled = new Map<string, Set<string>>();
    const enqueue = (node: StoryNode, label: string, distance: number, route: Route) => {
      for (const edge of (options?.exits ?? targets)(node)) {
        if (!edge.target || !all.has(edge.target) || options?.allowedNodeIds && !options.allowedNodeIds.has(edge.target)) continue;
        const branch = labelFor(node, edge.port), firstLabel = label || branch;
        const labels = scheduled.get(edge.target) ?? new Set<string>();
        // Once reached, another explanation at this node cannot add destinations.
        if (labels.has(firstLabel) || labels.size >= 32) continue;
        labels.add(firstLabel); scheduled.set(edge.target, labels);
        pending.push({ target: edge.target, label: firstLabel, distance, route: { nodeId: edge.target, branch, previous: route } });
      }
    };
    enqueue(source, '', 1, { nodeId: source.id, branch: '' });
    for (let cursor = 0; cursor < pending.length; cursor++) {
      const next = pending[cursor], node = all.get(next.target)!;
      if (shown.has(node.id)) {
        const targetId = shown.get(node.id)!;
        const key = JSON.stringify([sourceId, targetId]);
        let edge = edgeIndex.get(key);
        if (!edge) {
          edge = { from: sourceId, to: targetId, label: next.label, endpoints: [{ from: source.id, to: node.id }], paths: [], via: [] };
          edges.push(edge); edgeIndex.set(key, edge);
        } else if (next.label && !edge.label.split(' / ').includes(next.label)) edge.label = [edge.label, next.label].filter(Boolean).join(' / ');
        if (edge.paths!.length < 8) {
          const path: FlowEdgePath = { nodeIds: [], labels: [] };
          let route: Route | undefined = next.route;
          while (route && path.nodeIds.length < 511) { path.nodeIds.push(route.nodeId); if (route.branch) path.labels.push(route.branch); route = route.previous; }
          if (route) { path.nodeIds.push(source.id); if (route.previous) path.truncated = true; }
          path.nodeIds.reverse(); path.labels.reverse(); edge.paths!.push(path);
          edge.via = [...new Set([...edge.via!, ...path.nodeIds.slice(1, -1)])].slice(0, 512);
        }
        continue;
      }
      if (next.distance < (locations.get(node.id)?.distance ?? Infinity)) locations.set(node.id, { id: sourceId, distance: next.distance });
      enqueue(node, next.label, next.distance + 1, next.route);
    }
  }
  return { edges, locations };
}

/** Project real connections onto one display level; group interiors cannot jump outside. */
export function projectFlowConnections(edges: readonly FlowConnection[], visible: readonly StoryMenuEntry[]) {
  const display = new Map(visible.flatMap(entry => (entry.memberIds ?? [entry.id]).map(id => [id, entry.id] as const)));
  const merged = new Map<string, FlowConnection>(), endpointKeys = new Map<string, Set<string>>();
  for (const edge of edges) {
    const from = display.get(edge.from), to = display.get(edge.to);
    if (!from || !to || (from === to && (edge.from !== edge.to || from !== edge.from))) continue;
    const key = JSON.stringify([from, to]);
    let result = merged.get(key);
    if (!result) {
      result = { ...edge, from, to, endpoints: [], paths: [...edge.paths ?? []], via: [...edge.via ?? []] };
      merged.set(key, result); endpointKeys.set(key, new Set());
    } else {
      const labels = [...new Set([...result.label.split(' / '), ...edge.label.split(' / ')].filter(Boolean))];
      result.label = labels.join(' / ');
      result.paths = [...result.paths ?? [], ...edge.paths ?? []].slice(0, 8);
      result.via = [...new Set([...result.via ?? [], ...edge.via ?? []])].slice(0, 512);
    }
    const keys = endpointKeys.get(key)!;
    for (const pair of edge.endpoints ?? [{ from: edge.from, to: edge.to }]) {
      const pairKey = JSON.stringify([pair.from, pair.to]);
      if (!keys.has(pairKey)) { keys.add(pairKey); result.endpoints!.push({ ...pair }); }
    }
  }
  return { edges: [...merged.values()], display };
}
