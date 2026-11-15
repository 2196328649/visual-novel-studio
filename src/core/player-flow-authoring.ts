import type { Project, UiComponent } from './model';
import type { PlayerFlowEntry, PlayerFlowGroup } from './player-flow-content-schema';
import { playerFlowAllEntries, playerFlowMode, playerFlowViews } from './player-flow-content';
import { storyFlowLayout } from './story-flow';
import { storyFlowSourceLabel, storyFlowSources, type FlowOwner } from './story-flow-authoring';
import { isStandaloneNode } from './standalone-performance';

export interface PlayerFlowSource { owner: FlowOwner; nodeId: string; path: string; preview?: string }

/** A local entry may start at real dialogue without adding a global # heading to the script. */
export function playerFlowSources(project: Project): PlayerFlowSource[] {
  const sources: PlayerFlowSource[] = storyFlowSources(project).flatMap(source => source.nodeId && source.editable
    ? [{ owner: source.owner, nodeId: source.nodeId, path: source.path }] : []);
  const included = new Set(sources.filter(source => source.owner.kind === 'node').map(source => source.owner.id));
  for (const node of project.nodes) {
    if (included.has(node.id) || node.kind !== 'passage' || isStandaloneNode(node)) continue;
    const line = node.lines.find(line => !line.silent && line.text.trim());
    if (!line) continue;
    const owner: FlowOwner = { kind: 'node', id: node.id }, preview = line.text.replace(/\s+/g, ' ').slice(0, 48);
    sources.push({ owner, nodeId: node.id, path: `${storyFlowSourceLabel(project, owner)} · ${preview}`, preview });
  }
  return sources;
}

/** Initializing is explicit: toggling modes never destroys a saved custom graph. */
export function initializePlayerFlowCustom(project: Project, component: UiComponent, source: 'copy' | 'empty'): boolean {
  const scriptViews = component.list?.flowContent?.scriptViews;
  const script: UiComponent = { ...component, list: { ...component.list, flowContent: { mode: 'script', ...(scriptViews ? { scriptViews } : {}) } } };
  const entries: PlayerFlowEntry[] = source === 'copy' ? playerFlowAllEntries(project, script).map(entry => ({
    nodeId: entry.nodeId!, ...(entry.owner ? { owner: { ...entry.owner } } : {}),
    name: entry.parts?.join('｜') || entry.name, ...(entry.styleId ? { styleId: entry.styleId } : {}),
  })) : [];
  const catalogue = source === 'copy' ? playerFlowViews(project, script) : undefined;
  const positions = catalogue ? Object.fromEntries(storyFlowLayout(project, script, undefined, catalogue.root).nodes.map(node => [node.id, { x: node.x, y: node.y }])) : undefined;
  const views = catalogue ? Object.fromEntries([...catalogue.views].map(([viewId, view]) => [viewId,
    Object.fromEntries(storyFlowLayout(project, script, viewId, view).nodes.map(node => [node.id, { x: node.x, y: node.y }]))])) : undefined;
  component.list ??= {};
  component.list.flowContent = { mode: 'custom', ...(scriptViews ? { scriptViews } : {}), custom: { entries, ...(positions ? { positions } : {}), ...(views && Object.keys(views).length ? { views } : {}) } };
  return true;
}

export function setPlayerFlowMode(component: UiComponent, mode: 'script' | 'custom'): boolean {
  if (mode === 'custom' && !component.list?.flowContent?.custom) return false;
  if (playerFlowMode(component) === mode) return false;
  component.list ??= {};
  component.list.flowContent = { ...component.list.flowContent, mode };
  return true;
}

function sourceEntry(project: Project, owner: FlowOwner): PlayerFlowEntry | undefined {
  const source = playerFlowSources(project).find(item => item.owner.kind === owner.kind && item.owner.id === owner.id);
  return source?.nodeId ? { nodeId: source.nodeId, owner: { ...owner } } : undefined;
}

export function addPlayerFlowEntry(project: Project, component: UiComponent, owner: FlowOwner): boolean {
  const custom = component.list?.flowContent?.custom, entry = sourceEntry(project, owner);
  if (!custom || !entry || custom.entries.some(item => item.nodeId === entry.nodeId) || custom.groups?.some(group => group.id === entry.nodeId)) return false;
  custom.entries.push(entry);
  return true;
}

export function editPlayerFlowEntry(component: UiComponent, nodeId: string, change: Partial<Pick<PlayerFlowEntry, 'name' | 'styleId' | 'action'>>): boolean {
  const entry = component.list?.flowContent?.custom?.entries.find(item => item.nodeId === nodeId);
  if (!entry) return false;
  for (const key of ['name', 'styleId', 'action'] as const) if (Object.hasOwn(change, key)) {
    if (change[key] === undefined) delete entry[key];
    else Object.assign(entry, { [key]: change[key] });
  }
  return true;
}

export function removePlayerFlowEntry(component: UiComponent, nodeId: string): boolean {
  const custom = component.list?.flowContent?.custom;
  if (!custom?.entries.some(entry => entry.nodeId === nodeId)) return false;
  custom.entries = custom.entries.filter(entry => entry.nodeId !== nodeId);
  if (custom.positions) delete custom.positions[nodeId];
  for (const positions of Object.values(custom.views ?? {})) delete positions[nodeId];
  for (const group of custom.groups ?? []) {
    group.nodeIds = group.nodeIds.filter(id => id !== nodeId);
    if (group.positions) delete group.positions[nodeId];
  }
  return true;
}

export function reorderPlayerFlowEntries(component: UiComponent, nodeIds: string[]): boolean {
  const custom = component.list?.flowContent?.custom;
  if (!custom) return false;
  const entries = new Map(custom.entries.map(entry => [entry.nodeId, entry]));
  const order = [...new Set([...nodeIds, ...custom.entries.map(entry => entry.nodeId)])];
  custom.entries = order.flatMap(id => entries.has(id) ? [entries.get(id)!] : []);
  return true;
}

/** One transaction replaces the pinned reference and every layout/group key using it. */
export function repairPlayerFlowEntry(project: Project, component: UiComponent, oldNodeId: string, owner: FlowOwner): boolean {
  const custom = component.list?.flowContent?.custom, source = sourceEntry(project, owner);
  const entry = custom?.entries.find(item => item.nodeId === oldNodeId);
  if (!custom || !source || !entry || custom.entries.some(item => item !== entry && item.nodeId === source.nodeId)) return false;
  const nextId = source.nodeId;
  if (custom.groups?.some(group => group.id === nextId)) return false;
  entry.nodeId = nextId;
  entry.owner = source.owner;
  if (oldNodeId !== nextId) {
    if (custom.positions?.[oldNodeId]) { custom.positions[nextId] = custom.positions[oldNodeId]; delete custom.positions[oldNodeId]; }
    for (const positions of Object.values(custom.views ?? {})) if (positions[oldNodeId]) {
      positions[nextId] = positions[oldNodeId]; delete positions[oldNodeId];
    }
    for (const group of custom.groups ?? []) {
      group.nodeIds = group.nodeIds.map(id => id === oldNodeId ? nextId : id);
      if (group.positions?.[oldNodeId]) { group.positions[nextId] = group.positions[oldNodeId]; delete group.positions[oldNodeId]; }
    }
  }
  return true;
}

export function createPlayerFlowGroup(project: Project, component: UiComponent, name: string, nodeIds: string[]): string | undefined {
  const custom = component.list?.flowContent?.custom;
  if (!custom) return;
  const known = new Set(custom.entries.map(entry => entry.nodeId)), members = [...new Set(nodeIds)].filter(id => known.has(id));
  if (!members.length) return;
  const occupied = new Set([...project.nodes.map(node => node.id), ...known, ...(custom.groups ?? []).map(group => group.id)]);
  let index = 1;
  while (occupied.has(`flow_group_${index}`)) index++;
  const id = `flow_group_${index}`;
  (custom.groups ??= []).push({ id, name: name.trim().slice(0, 120) || '新分组', nodeIds: [] });
  setPlayerFlowGroupMembers(component, id, members);
  return id;
}

export function editPlayerFlowGroup(component: UiComponent, groupId: string, change: Partial<Pick<PlayerFlowGroup, 'name' | 'collapsed'>>): boolean {
  const group = component.list?.flowContent?.custom?.groups?.find(item => item.id === groupId);
  if (!group || (change.name !== undefined && !change.name.trim())) return false;
  if (change.name !== undefined) group.name = change.name.trim().slice(0, 120);
  if (Object.hasOwn(change, 'collapsed')) {
    if (change.collapsed === undefined) delete group.collapsed; else group.collapsed = change.collapsed;
  }
  return true;
}

export function setPlayerFlowGroupMembers(component: UiComponent, groupId: string, nodeIds: string[]): boolean {
  const custom = component.list?.flowContent?.custom, group = custom?.groups?.find(item => item.id === groupId);
  if (!custom || !group) return false;
  const known = new Set(custom.entries.map(entry => entry.nodeId));
  const members = [...new Set(nodeIds)].filter(id => known.has(id)), selected = new Set(members);
  for (const other of custom.groups ?? []) {
    other.nodeIds = other === group ? members : other.nodeIds.filter(id => !selected.has(id));
    if (other.positions) for (const id of Object.keys(other.positions)) if (!other.nodeIds.includes(id)) delete other.positions[id];
    for (const [viewId, positions] of Object.entries(custom.views ?? {})) if (viewId.startsWith('group-view:') && viewId.endsWith(':' + other.id)) {
      for (const id of Object.keys(positions)) if (!other.nodeIds.includes(id)) delete positions[id];
    }
  }
  return true;
}

export function removePlayerFlowGroup(component: UiComponent, groupId: string): boolean {
  const custom = component.list?.flowContent?.custom;
  if (!custom?.groups?.some(group => group.id === groupId)) return false;
  custom.groups = custom.groups.filter(group => group.id !== groupId);
  if (custom.positions) delete custom.positions[groupId];
  for (const [viewId, positions] of Object.entries(custom.views ?? {})) {
    if (viewId.startsWith('group-view:') && viewId.endsWith(':' + groupId)) delete custom.views![viewId];
    else for (const id of Object.keys(positions)) if (id.startsWith('group-view:') && id.endsWith(':' + groupId)) delete positions[id];
  }
  return true;
}

export function removePlayerFlowEntryFromGroup(component: UiComponent, groupId: string, nodeId: string): boolean {
  const custom = component.list?.flowContent?.custom, group = custom?.groups?.find(item => item.id === groupId);
  if (!group?.nodeIds.includes(nodeId)) return false;
  group.nodeIds = group.nodeIds.filter(id => id !== nodeId);
  if (group.positions) delete group.positions[nodeId];
  for (const [viewId, positions] of Object.entries(custom?.views ?? {})) if (viewId.startsWith('group-view:') && viewId.endsWith(':' + groupId)) delete positions[nodeId];
  return true;
}
