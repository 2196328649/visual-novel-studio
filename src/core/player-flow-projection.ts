import { targets, type Project, type StoryNode } from './model';
import type { PlayerFlowGroup } from './player-flow-content-schema';
import { storyFlowConnections, projectFlowConnections, type FlowConnection } from './story-flow-connections';
import { storyNodeReturnsTitle } from './story-graph';
import type { StoryMenuEntry } from './story-menu';

export interface PlayerFlowView {
  id?: string;
  kind: 'root' | 'call' | 'group';
  name?: string;
  targetId?: string;
  groupId?: string;
  parentViewId?: string;
  entries: StoryMenuEntry[];
  edges: FlowConnection[];
  locations: Record<string, string>;
  /** Actual call sites map to their visible representative in this one scope. */
  callLocations?: Record<string, string>;
  /** True same-level members, including hidden leading and trailing steps. */
  nodeIds?: string[];
  progressIds?: string[];
}

export interface PlayerFlowViews {
  root: PlayerFlowView;
  views: Map<string, PlayerFlowView>;
  hasCalls: boolean;
}

export const playerFlowCallId = (callId: string) => `call:${callId}`;
export const playerFlowCallViewId = (targetId: string) => `call-body:${targetId}`;
export const playerFlowGroupViewId = (groupId: string, parentViewId?: string) => parentViewId ? `group-view:${parentViewId}:${groupId}` : groupId;

/** A call completes only when its target can return and its own continuation can
 * return. The least fixed point leaves unconditional recursive cycles false. */
export function playerFlowCallAnalysis(project: Project) {
  const nodes = new Map(project.nodes.map(node => [node.id, node]));
  const ordinary = new Map<string, ReturnType<typeof targets>>();
  const dependents = new Map<string, Set<string>>();
  for (const node of nodes.values()) {
    const exits = storyNodeReturnsTitle(node, project) ? [] : targets(node).filter(edge => edge.target && nodes.has(edge.target));
    ordinary.set(node.id, exits);
    for (const edge of exits) {
      const parents = dependents.get(edge.target!) ?? new Set<string>();
      parents.add(node.id); dependents.set(edge.target!, parents);
    }
  }
  const mayReturn = new Set(project.nodes.filter(node => node.kind === 'return').map(node => node.id));
  const queue = [...mayReturn];
  for (let index = 0; index < queue.length; index++) {
    for (const id of dependents.get(queue[index]) ?? []) {
      if (mayReturn.has(id)) continue;
      const node = nodes.get(id)!;
      const returns = node.kind === 'call'
        ? !!node.target && !!node.next && mayReturn.has(node.target) && mayReturn.has(node.next)
        : ordinary.get(id)!.some(edge => mayReturn.has(edge.target!));
      if (returns) { mayReturn.add(id); queue.push(id); }
    }
  }
  const exits = (node: StoryNode): ReturnType<typeof targets> => node.kind === 'call'
    ? node.target && mayReturn.has(node.target) && node.next && nodes.has(node.next) ? [{ port: 'next', target: node.next }] : []
    : ordinary.get(node.id) ?? [];
  const reachable = (starts: Iterable<string>, stopBefore?: ReadonlySet<string>) => {
    const result = new Set<string>(), pending = [...starts];
    for (let index = 0; index < pending.length; index++) {
      const id = pending[index];
      if (result.has(id) || !nodes.has(id) || stopBefore?.has(id)) continue;
      result.add(id);
      for (const edge of exits(nodes.get(id)!)) if (edge.target && !result.has(edge.target)) pending.push(edge.target);
    }
    return result;
  };
  return { nodes, mayReturn, exits, reachable };
}

function displayGroups(project: Project, entries: readonly StoryMenuEntry[], groups: readonly PlayerFlowGroup[], parentViewId?: string, derived = false) {
  const occupied = new Set(project.nodes.map(node => node.id)), byMember = new Map<string, PlayerFlowGroup>();
  for (const group of groups) {
    if (occupied.has(group.id) || group.collapsed === false) continue;
    occupied.add(group.id);
    for (const id of group.nodeIds) if (!byMember.has(id)) byMember.set(id, group);
  }
  const members = new Map<string, string[]>();
  for (const entry of entries) {
    // Two invocations never become the same group just because they share a body.
    const group = !entry.callId && byMember.get(entry.id);
    if (group) { const ids = members.get(group.id) ?? []; ids.push(entry.id); members.set(group.id, ids); }
  }
  const emitted = new Set<string>(), result: StoryMenuEntry[] = [];
  for (const entry of entries) {
    const group = !entry.callId && byMember.get(entry.id);
    if (!group) { result.push(entry); continue; }
    if (emitted.has(group.id)) continue;
    emitted.add(group.id);
    const id = playerFlowGroupViewId(group.id, parentViewId);
    result.push({ id, name: group.name, title: group.name, groupId: group.id, memberIds: members.get(group.id)!, ...(derived ? { viewId: id } : {}) });
  }
  return result;
}

function projectLocations(locations: ReturnType<typeof storyFlowConnections>['locations'], display: Map<string, string>) {
  return Object.fromEntries([...locations].flatMap(([id, location]) => display.has(location.id) ? [[id, display.get(location.id)!]] : []));
}

function legacyView(project: Project, entries: StoryMenuEntry[], groups: readonly PlayerFlowGroup[], connections: ReturnType<typeof storyFlowConnections>, viewId?: string): PlayerFlowView {
  const group = viewId === undefined ? undefined : groups.find(item => item.id === viewId);
  const visible = viewId === undefined ? displayGroups(project, entries, groups) : entries.filter(entry => group?.nodeIds.includes(entry.id));
  const projected = projectFlowConnections(connections.edges, visible);
  return {
    ...(viewId === undefined ? { kind: 'root' as const } : { id: viewId, kind: 'group' as const, ...(group ? { name: group.name, groupId: group.id } : {}) }),
    entries: visible, edges: projected.edges, locations: projectLocations(connections.locations, projected.display),
  };
}

/** Ordinary projects keep the original entries, paths and layout identities. */
function legacyViews(project: Project, entries: StoryMenuEntry[], groups: readonly PlayerFlowGroup[]): PlayerFlowViews {
  const connections = storyFlowConnections(project, entries);
  return {
    root: legacyView(project, entries, groups, connections),
    views: new Map(groups.map(group => [group.id, legacyView(project, entries, groups, connections, group.id)])),
    hasCalls: false,
  };
}

/** A finite catalogue of display scopes. Shared and recursive sub-stories have
 * one body each; every call site keeps its own outside continuation. */
export function projectPlayerFlow(project: Project, entries: StoryMenuEntry[], groups: readonly PlayerFlowGroup[]): PlayerFlowViews {
  if (!project.nodes.some(node => node.kind === 'call')) return legacyViews(project, entries, groups);
  const analysis = playerFlowCallAnalysis(project);
  const calls = project.nodes.filter((node): node is Extract<StoryNode, { kind: 'call' }> => node.kind === 'call');
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const bodies = new Map<string, { members: Set<string>; source?: StoryMenuEntry }>();
  for (const call of calls) if (call.target && analysis.nodes.has(call.target) && !bodies.has(call.target)) {
    const members = analysis.reachable([call.target]);
    bodies.set(call.target, { members, source: byId.get(call.target) ?? entries.find(entry => members.has(entry.id)) });
  }
  // A body containing only calls can still expose selected content in a nested
  // body. Propagation, unlike recursive expansion, also terminates on cycles.
  let changed = true;
  while (changed) {
    changed = false;
    for (const body of bodies.values()) if (!body.source) {
      for (const call of calls) if (body.members.has(call.id) && call.target && bodies.get(call.target)?.source) {
        body.source = bodies.get(call.target)!.source; changed = true; break;
      }
    }
  }
  const allBodyMembers = new Set([...bodies.values()].flatMap(body => [...body.members]));
  const rootSeeds = new Set([project.entryId, ...entries.filter(entry => !allBodyMembers.has(entry.id)).map(entry => entry.id)]);
  let rootMembers = analysis.reachable(rootSeeds);
  const reachableBodies = (members: ReadonlySet<string>) => {
    const seen = new Set<string>(), pending = calls.filter(call => members.has(call.id) && call.target).map(call => call.target!);
    for (let index = 0; index < pending.length; index++) {
      const target = pending[index], body = bodies.get(target);
      if (!body || seen.has(target)) continue;
      seen.add(target);
      for (const call of calls) if (body.members.has(call.id) && call.target && !seen.has(call.target)) pending.push(call.target);
    }
    return seen;
  };
  const reachableTargets = reachableBodies(rootMembers);
  const accessibleMembers = new Set([...rootMembers, ...[...reachableTargets].flatMap(target => [...bodies.get(target)!.members])]);
  // Disconnected authored headings used to remain browsable. Do not silently
  // lose them just because an equally disconnected call points at their body.
  const orphans = entries.filter(entry => !accessibleMembers.has(entry.id));
  const orphanReachable = new Map(orphans.map(entry => {
    const reachable = analysis.reachable([entry.id]);
    for (const target of reachableBodies(reachable)) for (const id of bodies.get(target)!.members) reachable.add(id);
    return [entry.id, reachable] as const;
  }));
  const representatives = new Set<string>();
  for (const entry of orphans) {
    const reachable = orphanReachable.get(entry.id)!;
    // Keep a representative only in a source strongly connected component.
    // Author order breaks ties inside a mutual cycle, never decides ownership.
    if (orphans.some(other => orphanReachable.get(other.id)!.has(entry.id) && !reachable.has(other.id))) continue;
    if ([...representatives].some(id => reachable.has(id) && orphanReachable.get(id)!.has(entry.id))) continue;
    representatives.add(entry.id); rootSeeds.add(entry.id);
  }
  rootMembers = analysis.reachable(rootSeeds);
  const callEntry = (call: Extract<StoryNode, { kind: 'call' }>): StoryMenuEntry | undefined => {
    const source = call.target && bodies.get(call.target)?.source;
    if (!source || !call.target) return;
    return {
      id: playerFlowCallId(call.id), name: source.name, title: source.title ?? source.name,
      nodeId: call.target, targetId: call.target, callId: call.id, viewId: playerFlowCallViewId(call.target), sourceEntryId: source.id,
      ...(source.parts ? { parts: [...source.parts] } : {}), ...(source.styleId ? { styleId: source.styleId } : {}),
    };
  };
  const views = new Map<string, PlayerFlowView>();
  const makeScope = (members: Set<string>, detail: Pick<PlayerFlowView, 'id' | 'kind' | 'name' | 'targetId'>): PlayerFlowView => {
    const cards = calls.flatMap(call => {
      const entry = members.has(call.id) ? callEntry(call) : undefined;
      return entry ? [entry] : [];
    });
    const replaced = new Set(cards.map(entry => entry.callId!));
    // Author order is stable; new references follow the real call-site order.
    const flat = [...entries.filter(entry => members.has(entry.id) && !replaced.has(entry.id)), ...cards];
    const connections = storyFlowConnections(project, flat, { exits: analysis.exits, allowedNodeIds: members, entryNodeId: entry => entry.callId ?? entry.nodeId ?? entry.id });
    const cardIds = new Set(cards.map(card => card.id)), cardById = new Map(cards.map(card => [card.id, card]));
    const outgoing = new Map<string, string[]>();
    const incoming = new Set<string>();
    for (const edge of connections.edges) {
      incoming.add(edge.to);
      if (!cardIds.has(edge.to)) continue;
      const children = outgoing.get(edge.from) ?? []; children.push(edge.to); outgoing.set(edge.from, children);
    }
    const emitted = new Set<string>(), ordered: StoryMenuEntry[] = [];
    const emitCalls = (starts: readonly string[]) => {
      const pending = [...starts].reverse();
      while (pending.length) {
        const id = pending.pop()!;
        if (emitted.has(id)) continue;
        emitted.add(id); ordered.push(cardById.get(id)!);
        pending.push(...[...outgoing.get(id) ?? []].reverse());
      }
    };
    // References sit after their visible predecessor in directories too. The
    // relative order of authored entries is never rewritten by this projection.
    emitCalls(cards.filter(card => !incoming.has(card.id)).map(card => card.id));
    for (const entry of flat) if (!entry.callId) { ordered.push(entry); emitCalls(outgoing.get(entry.id) ?? []); }
    emitCalls(cards.map(card => card.id));
    const make = (visible: StoryMenuEntry[], shape: Pick<PlayerFlowView, 'id' | 'kind' | 'name' | 'targetId' | 'groupId' | 'parentViewId'>, nodeIds: ReadonlySet<string>): PlayerFlowView => {
      const projected = projectFlowConnections(connections.edges, visible);
      const locations = projectLocations(connections.locations, projected.display);
      const callLocations = Object.fromEntries(calls.flatMap(call => nodeIds.has(call.id) && locations[call.id] ? [[call.id, locations[call.id]]] : []));
      const progressMembers = new Set(nodeIds);
      if (shape.kind !== 'group') for (const target of reachableBodies(nodeIds)) for (const id of bodies.get(target)!.members) progressMembers.add(id);
      const progressIds = entries.filter(entry => progressMembers.has(entry.id)).map(entry => entry.id);
      return { ...shape, entries: visible, edges: projected.edges, locations, callLocations, nodeIds: [...nodeIds], progressIds };
    };
    const result = make(displayGroups(project, ordered, groups, detail.id, true), detail, members);
    const boundaryIds = new Set(flat.map(entry => entry.callId ?? entry.nodeId ?? entry.id));
    for (const group of groups) {
      const selected = ordered.filter(entry => !entry.callId && group.nodeIds.includes(entry.id));
      if (!selected.length && (detail.id !== undefined || group.nodeIds.length)) continue;
      const selectedIds = new Set(selected.map(entry => entry.id));
      const forbidden = new Set([...boundaryIds].filter(id => !selectedIds.has(id)));
      const interior = analysis.reachable(selectedIds, forbidden);
      const id = playerFlowGroupViewId(group.id, detail.id);
      views.set(id, make(selected, { id, kind: 'group', name: group.name, groupId: group.id, ...(detail.id ? { parentViewId: detail.id } : {}) }, interior));
    }
    return result;
  };
  const root = makeScope(rootMembers, { kind: 'root' });
  for (const [targetId, body] of bodies) {
    const id = playerFlowCallViewId(targetId);
    views.set(id, makeScope(body.members, { id, kind: 'call', targetId, ...(body.source ? { name: body.source.name } : {}) }));
  }
  return { root, views, hasCalls: true };
}

/** A single legacy map need not construct all of its group interiors. */
export function projectPlayerFlowView(project: Project, entries: StoryMenuEntry[], groups: readonly PlayerFlowGroup[], viewId?: string): PlayerFlowView {
  if (!project.nodes.some(node => node.kind === 'call')) return legacyView(project, entries, groups, storyFlowConnections(project, entries), viewId);
  const catalogue = projectPlayerFlow(project, entries, groups);
  return viewId === undefined ? catalogue.root : catalogue.views.get(viewId) ?? { id: viewId, kind: 'group', entries: [], edges: [], locations: {} };
}
