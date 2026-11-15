import type { Project, UiComponent } from './model';
import type { FlowPosition, PlayerFlowEntry, PlayerFlowGroup } from './player-flow-content-schema';
import { flowCaptionParts, storyMenuEntries, type StoryMenuEntry } from './story-menu';
import { projectPlayerFlow, projectPlayerFlowView, type PlayerFlowView, type PlayerFlowViews } from './player-flow-projection';

export type { FlowPosition, PlayerFlowContent, PlayerFlowEntry, PlayerFlowGroup } from './player-flow-content-schema';
export type { PlayerFlowView, PlayerFlowViews } from './player-flow-projection';
export { playerFlowCallAnalysis, playerFlowCallId, playerFlowCallViewId, playerFlowGroupViewId } from './player-flow-projection';

export function playerFlowMode(component: UiComponent): 'script' | 'custom' {
  return component.list?.flowContent?.mode ?? 'script';
}

function playerFlowSourceNames(project: Project) {
  const chapters = new Map(project.chapters.map(item => [item.id, item.name]));
  const scenes = new Map(project.scenes.map(item => [item.id, item.name]));
  const nodes = new Map(project.nodes.map(item => [item.id, item.name]));
  return (entry: PlayerFlowEntry): string | undefined => {
    const owner = entry.owner;
    return !owner ? nodes.get(entry.nodeId) : (owner.kind === 'chapter' ? chapters : owner.kind === 'scene' ? scenes : nodes).get(owner.id);
  };
}

/** Missing references stay in saved data and can only be retargeted by an explicit repair. */
export function playerFlowMissingEntries(project: Project, component: UiComponent): { entry: PlayerFlowEntry; index: number; reason: 'node' | 'owner' }[] {
  const nodes = new Set(project.nodes.map(node => node.id)), ownerName = playerFlowSourceNames(project);
  return (component.list?.flowContent?.custom?.entries ?? []).flatMap<{ entry: PlayerFlowEntry; index: number; reason: 'node' | 'owner' }>((entry, index) => !nodes.has(entry.nodeId)
    ? [{ entry, index, reason: 'node' as const }]
    : ownerName(entry) === undefined ? [{ entry, index, reason: 'owner' as const }] : []);
}

/** Component-local titles and presets never fall back to another control's chapter metadata. */
export function playerFlowAllEntries(project: Project, component: UiComponent): StoryMenuEntry[] {
  if (playerFlowMode(component) === 'script') return storyMenuEntries(project, 'flowchart');
  const nodes = new Set(project.nodes.map(node => node.id)), added = new Set<string>(), ownerName = playerFlowSourceNames(project);
  return (component.list?.flowContent?.custom?.entries ?? []).flatMap(entry => {
    if (!nodes.has(entry.nodeId) || added.has(entry.nodeId)) return [];
    const title = ownerName(entry);
    if (title === undefined) return [];
    added.add(entry.nodeId);
    const parts = flowCaptionParts(entry.name?.trim() || title);
    return [{ id: entry.nodeId, nodeId: entry.nodeId, name: parts.join(' ') || title, title,
      ...(entry.owner ? { owner: { ...entry.owner } } : {}), ...(parts.length > 1 ? { parts } : {}),
      ...(entry.styleId ? { styleId: entry.styleId } : {}), ...(entry.action ? { action: entry.action } : {}) }];
  });
}

export function playerFlowGroups(component: UiComponent): PlayerFlowGroup[] {
  return playerFlowMode(component) === 'custom' ? component.list?.flowContent?.custom?.groups ?? [] : [];
}

export function playerFlowViews(project: Project, component: UiComponent): PlayerFlowViews {
  return projectPlayerFlow(project, playerFlowAllEntries(project, component), playerFlowGroups(component));
}

/** Missing scopes stay empty instead of unexpectedly showing the root map. */
export function playerFlowView(project: Project, component: UiComponent, viewId?: string): PlayerFlowView {
  return projectPlayerFlowView(project, playerFlowAllEntries(project, component), playerFlowGroups(component), viewId);
}

/** Existing maps without calls keep their inexpensive directory-only projection. */
function legacyPlayerFlowEntries(project: Project, component: UiComponent, groupId?: string): StoryMenuEntry[] {
  const entries = playerFlowAllEntries(project, component), groups = playerFlowGroups(component);
  if (groupId !== undefined) {
    const group = groups.find(item => item.id === groupId);
    const members = new Set(group?.nodeIds ?? []);
    return entries.filter(entry => members.has(entry.id));
  }
  if (!groups.length) return entries;
  const occupied = new Set(project.nodes.map(node => node.id)), byMember = new Map<string, PlayerFlowGroup>();
  for (const group of groups) {
    if (occupied.has(group.id) || group.collapsed === false) continue;
    occupied.add(group.id);
    for (const id of group.nodeIds) if (!byMember.has(id)) byMember.set(id, group);
  }
  const members = new Map<string, string[]>();
  for (const entry of entries) {
    const group = byMember.get(entry.id);
    if (group) { const ids = members.get(group.id) ?? []; ids.push(entry.id); members.set(group.id, ids); }
  }
  const emitted = new Set<string>(), result: StoryMenuEntry[] = [];
  for (const entry of entries) {
    const group = byMember.get(entry.id);
    if (!group) { result.push(entry); continue; }
    if (emitted.has(group.id)) continue;
    emitted.add(group.id);
    const memberIds = members.get(group.id)!;
    result.push({ id: group.id, name: group.name, title: group.name, groupId: group.id, memberIds });
  }
  return result;
}

/** Calls add shared interiors without changing the author's source entries. */
export function playerFlowEntries(project: Project, component: UiComponent, viewId?: string): StoryMenuEntry[] {
  return project.nodes.some(node => node.kind === 'call') ? playerFlowView(project, component, viewId).entries : legacyPlayerFlowEntries(project, component, viewId);
}

const callDisplayId = /^call:[a-z][a-z0-9_]{0,63}$/;
const derivedViewId = /^(?:call-body:[a-z][a-z0-9_]{0,63}|group-view:call-body:[a-z][a-z0-9_]{0,63}:[a-z][a-z0-9_]{0,63})$/;

/** Returns a detached map so preview callers cannot mutate saved positions by reading.
 * Existing root and manual-group layouts remain separate from shared call bodies. */
export function playerFlowPositions(component: UiComponent, viewId?: string): Record<string, FlowPosition> {
  const copy = (positions?: Record<string, FlowPosition>) => Object.fromEntries(Object.entries(positions ?? {}).map(([id, position]) => [id, { ...position }]));
  if (playerFlowMode(component) === 'script') return viewId === undefined ? copy(component.list?.flowPositions) : copy(component.list?.flowContent?.scriptViews?.[viewId]);
  const custom = component.list?.flowContent?.custom;
  if (viewId !== undefined) return copy(derivedViewId.test(viewId) ? custom?.views?.[viewId] : custom?.groups?.find(group => group.id === viewId)?.positions);
  return copy({ ...custom?.positions, ...Object.fromEntries((custom?.groups ?? []).flatMap(group => group.position ? [[group.id, group.position]] : [])) });
}

export function setPlayerFlowPosition(component: UiComponent, id: string, position?: FlowPosition, viewId?: string): boolean {
  if (position && (!Number.isFinite(position.x) || !Number.isFinite(position.y))) return false;
  if (viewId !== undefined && derivedViewId.test(viewId)) {
    const content = component.list?.flowContent, script = playerFlowMode(component) === 'script';
    if (!script && !content?.custom) return false;
    const stored = script ? content?.scriptViews : content?.custom?.views;
    if (!position && !stored?.[viewId]?.[id]) return false;
    component.list ??= {};
    const flow = component.list.flowContent ??= { mode: 'script' };
    const scopes = script ? flow.scriptViews ??= {} : flow.custom!.views ??= {};
    const positions = scopes[viewId] ??= {};
    if (position) positions[id] = { ...position }; else delete positions[id];
    return true;
  }
  if (playerFlowMode(component) === 'script') {
    if (viewId !== undefined) return false;
    if (!position && !component.list?.flowPositions?.[id]) return false;
    component.list ??= {};
    component.list.flowPositions ??= {};
    if (position) component.list.flowPositions[id] = { ...position }; else delete component.list.flowPositions[id];
    return true;
  }
  const custom = component.list?.flowContent?.custom;
  if (!custom) return false;
  if (viewId !== undefined) {
    const group = custom.groups?.find(item => item.id === viewId);
    if (!group?.nodeIds.includes(id)) return false;
    if (position) (group.positions ??= {})[id] = { ...position }; else if (group.positions) delete group.positions[id];
    return true;
  }
  const group = custom.groups?.find(item => item.id === id);
  if (group) {
    if (position) group.position = { ...position }; else delete group.position;
    return true;
  }
  if (!custom.entries.some(entry => entry.nodeId === id) && !callDisplayId.test(id)) return false;
  if (position) (custom.positions ??= {})[id] = { ...position }; else if (custom.positions) delete custom.positions[id];
  return true;
}

export function clearPlayerFlowPositions(component: UiComponent, viewId?: string): boolean {
  if (viewId !== undefined && derivedViewId.test(viewId)) {
    const content = component.list?.flowContent;
    const views = playerFlowMode(component) === 'script' ? content?.scriptViews : content?.custom?.views;
    if (!views?.[viewId]) return false;
    delete views[viewId];
    return true;
  }
  if (playerFlowMode(component) === 'script') {
    if (viewId !== undefined || !component.list?.flowPositions) return false;
    delete component.list.flowPositions;
    return true;
  }
  const custom = component.list?.flowContent?.custom;
  if (!custom) return false;
  if (viewId !== undefined) {
    const group = custom.groups?.find(item => item.id === viewId);
    if (!group?.positions) return false;
    delete group.positions;
  } else {
    delete custom.positions;
    for (const group of custom.groups ?? []) delete group.position;
  }
  return true;
}
