import { createContext } from 'react';
import type { Project, UiButtonState, UiComponent } from '../core/model';
import { playerFlowAllEntries, playerFlowMode, playerFlowView, playerFlowViews, type PlayerFlowView } from '../core/player-flow-content';
import { storyFlowLayout } from '../core/story-flow';

export type FlowPreviewMode = 'all' | 'partial' | 'current';
export type FlowPreviewRegion = 'viewport' | 'scrollbar' | 'marker';
export type FlowInspectorTarget =
  | { kind: 'map' }
  | { kind: 'node'; nodeId: string }
  | { kind: 'base'; nodeId?: string }
  | { kind: 'preset'; presetId: string; nodeId?: string }
  | { kind: 'group'; groupId: string }
  | { kind: 'call'; callId: string }
  | { kind: 'edge'; from: string; to: string }
  | { kind: 'sources' };
export interface FlowPreviewImpact { nodeIds: readonly string[]; label: string }
export interface FlowBrowseFrame { viewId: string; callId?: string }
export interface FlowBrowseViewport { x: number; y: number; zoom?: number; page?: number }
export interface UiFlowEditing {
  componentId: string;
  nodeId?: string;
  groupId?: string;
  /** The current view ID; groupId is retained for existing layout consumers. */
  browseTrail?: readonly FlowBrowseFrame[];
  browseNames?: readonly string[];
  view?: PlayerFlowView;
  enterView?: (viewId: string, callId?: string) => void;
  backView?: () => void;
  viewports?: Map<string, FlowBrowseViewport>;
  entryIds?: readonly string[];
  enterGroup?: (groupId?: string) => void;
  locateSource?: (nodeId: string) => void;
  inspector?: FlowInspectorTarget;
  inspect?: (target: FlowInspectorTarget) => void;
  visualState?: UiButtonState;
  setVisualState?: (value?: UiButtonState) => void;
  impact?: FlowPreviewImpact;
  setImpact?: (value?: FlowPreviewImpact) => void;
  selectedPart?: number;
  setSelectedPart?: (index: number) => void;
  selectionRequest?: number;
  select: (nodeId?: string, locate?: boolean) => void;
  locateNode?: (nodeId: string) => void;
  locate?: { nodeId: string; request: number };
  move: (componentId: string, nodeId: string, position?: { x: number; y: number }) => void;
  movable: boolean;
  preview: { mode: FlowPreviewMode; currentId?: string };
  setPreview: (value: { mode: FlowPreviewMode; currentId?: string }) => void;
  region?: FlowPreviewRegion;
  setRegion: (region?: FlowPreviewRegion) => void;
}
export const UiFlowEditContext = createContext<UiFlowEditing | undefined>(undefined);
export const UiFlowAuthoringStatusContext = createContext({ textPending: false, saving: false });

/** Re-entering an ancestor uses its existing view rather than growing recursion. */
export function flowEnterView(trail: readonly FlowBrowseFrame[], frame: FlowBrowseFrame): FlowBrowseFrame[] {
  const existing = trail.findIndex(item => item.viewId === frame.viewId);
  return existing >= 0 ? trail.slice(0, existing + 1) : [...trail, frame];
}

/** Navigation is derived from current entries, so undo cannot revive removed calls. */
export function flowValidBrowseTrail(root: PlayerFlowView, views: ReadonlyMap<string, PlayerFlowView>, trail: readonly FlowBrowseFrame[]): FlowBrowseFrame[] {
  const valid: FlowBrowseFrame[] = [];
  let parent = root;
  for (const frame of trail) {
    const view = views.get(frame.viewId);
    if (!view || valid.some(item => item.viewId === frame.viewId)) break;
    const entry = parent.entries.find(item => (item.viewId ?? item.groupId) === frame.viewId && (!frame.callId || item.callId === frame.callId));
    if (!entry && !(view.kind === 'group' && view.parentViewId === parent.id)) break;
    valid.push(frame); parent = view;
  }
  return valid;
}

/** Find a browsable route for a real content entry without expanding recursive graphs. */
export function flowLocateBrowseTrail(root: PlayerFlowView, views: ReadonlyMap<string, PlayerFlowView>, nodeId: string, current: readonly FlowBrowseFrame[] = []): FlowBrowseFrame[] | undefined {
  const active = current.length ? views.get(current.at(-1)!.viewId) : root;
  if (active?.entries.some(entry => entry.id === nodeId)) return [...current];
  const search = (start: PlayerFlowView, initial: readonly FlowBrowseFrame[]) => {
    const queue: { view: PlayerFlowView; trail: FlowBrowseFrame[] }[] = [{ view: start, trail: [...initial] }], visited = new Set<string | undefined>();
    for (let at = 0; at < queue.length; at++) {
      const { view, trail } = queue[at];
      if (visited.has(view.id)) continue;
      visited.add(view.id);
      if (view.entries.some(entry => entry.id === nodeId)) return trail;
      for (const entry of view.entries) {
        const viewId = entry.viewId ?? entry.groupId, child = viewId && views.get(viewId);
        if (child && !visited.has(child.id) && !trail.some(frame => frame.viewId === viewId)) queue.push({ view: child, trail: [...trail, { viewId: viewId!, ...(entry.callId ? { callId: entry.callId } : {}) }] });
      }
    }
  };
  return active && current.length ? search(active, current) ?? search(root, []) : search(root, []);
}

/** The content manager can open a group even when its card is inside a call. */
export function flowBrowseTrailToView(root: PlayerFlowView, views: ReadonlyMap<string, PlayerFlowView>, viewId: string): FlowBrowseFrame[] | undefined {
  const queue: { view: PlayerFlowView; trail: FlowBrowseFrame[] }[] = [{ view: root, trail: [] }], visited = new Set<string | undefined>();
  for (let at = 0; at < queue.length; at++) {
    const { view, trail } = queue[at];
    if (visited.has(view.id)) continue;
    visited.add(view.id);
    if (view.id === viewId) return trail;
    const children = new Map<string, FlowBrowseFrame>();
    for (const entry of view.entries) {
      const id = entry.viewId ?? entry.groupId;
      if (id && !children.has(id)) children.set(id, { viewId: id, ...(entry.callId ? { callId: entry.callId } : {}) });
    }
    for (const candidate of views.values()) if (candidate.id && candidate.kind === 'group' && candidate.parentViewId === view.id && !children.has(candidate.id)) children.set(candidate.id, { viewId: candidate.id });
    for (const frame of children.values()) {
      const child = views.get(frame.viewId);
      if (child && !visited.has(child.id)) queue.push({ view: child, trail: [...trail, frame] });
    }
  }
}

/** A design-only sample, never written to the project's progress or current node. */
export function flowPreviewProgress(ids: readonly string[], entryId: string, preview?: UiFlowEditing['preview']) {
  const currentId = ids.includes(preview?.currentId ?? '') ? preview!.currentId! : ids.includes(entryId) ? entryId : ids[0];
  const reached = new Set(preview?.mode === 'partial' ? ids.slice(0, Math.max(1, Math.ceil(ids.length / 2))) : ids);
  if (entryId) reached.add(entryId);
  if (currentId) reached.add(currentId);
  return { reached, currentId: preview?.mode === 'current' ? currentId : undefined };
}

/** The inspector and affected nodes share a visual sample without changing progress. */
export function flowPreviewReference(ids: readonly string[], nodeId?: string, affectedIds?: readonly string[], currentId?: string, allowFallback = true) {
  const visible = new Set(ids);
  return nodeId && visible.has(nodeId) ? nodeId : affectedIds?.find(id => visible.has(id)) ?? (allowFallback ? currentId && visible.has(currentId) ? currentId : ids[0] : undefined);
}

type FlowPreviewEntry = { id: string; nodeId?: string; callId?: string; targetId?: string; sourceEntryId?: string; styleId?: string; groupId?: string; memberIds?: readonly string[]; action?: 'replay' | 'inspect' };
type FlowPreviewSession = Pick<UiFlowEditing, 'nodeId' | 'inspector' | 'preview' | 'visualState' | 'impact' | 'groupId' | 'entryIds' | 'view' | 'browseTrail'>;

/** A preset's reference must still be one of its real, visible users after undo. */
export function flowInspectorReference(target: FlowInspectorTarget, nodes: readonly FlowPreviewEntry[]): string | undefined {
  if (target.kind === 'preset') {
    if (!target.presetId) return;
    const users = nodes.filter(node => node.styleId === target.presetId);
    return users.find(node => node.id === target.nodeId)?.id ?? users.find(node => node.sourceEntryId === target.nodeId)?.id ?? users[0]?.id;
  }
  if (target.kind === 'base') return nodes.find(node => node.id === target.nodeId)?.id ?? nodes.find(node => node.sourceEntryId === target.nodeId)?.id ?? nodes[0]?.id;
  if (target.kind === 'node') return nodes.find(node => node.id === target.nodeId)?.id;
}

export function flowPreviewNodeVisual(id: string, progress: { reached: ReadonlySet<string>; currentId?: string }, options: {
  lockUnread?: boolean; hoveredId?: string; pressedId?: string;
  referenceId?: string; visualState?: UiButtonState; affectedIds?: ReadonlySet<string>;
}) {
  const affected = options.affectedIds?.has(id) ?? false;
  const forced = options.visualState !== undefined && (id === options.referenceId || affected);
  const locked = forced ? options.visualState === 'disabled' : !!options.lockUnread && !progress.reached.has(id);
  // A shared selected-state sample can tint several nodes, but only the reference
  // node receives the current-location marker and caption.
  const current = options.visualState === 'selected' && options.referenceId !== undefined ? id === options.referenceId : !forced && id === progress.currentId;
  const state: UiButtonState = forced ? options.visualState! : locked ? 'disabled' : current ? 'selected' : id === options.pressedId ? 'pressed' : id === options.hoveredId ? 'hover' : 'idle';
  return { state, locked, current, forced, affected };
}

export type FlowPreviewVisual = ReturnType<typeof flowPreviewNodeVisual> & { suffix: string };

/** Shared by both canvas layouts and the inspector, including progress captions. */
export function flowPreviewNodes(nodes: readonly FlowPreviewEntry[], entryId: string, list: UiComponent['list'], editing?: FlowPreviewSession, state: UiButtonState = 'idle', pointer?: { hoveredId?: string; pressedId?: string }) {
  const ids = nodes.map(node => node.id);
  // Progress belongs to story nodes. Entering a display group must not invent
  // progress for its card or change the partial-progress sample.
  const storyIds = editing?.entryIds ?? nodes.flatMap(node => node.memberIds ?? [node.callId ?? node.id]);
  const projectedEntry = nodes.find(node => node.id === entryId);
  const storyEntryId = projectedEntry?.groupId ? projectedEntry.memberIds?.[0] ?? entryId : entryId;
  const storyProgress = flowPreviewProgress(storyIds, storyEntryId, editing?.preview ?? { mode: state === 'disabled' ? 'partial' : state === 'selected' ? 'current' : 'all' });
  const reached = new Set(storyProgress.reached);
  for (const node of nodes) if (node.callId && reached.has(node.callId)) reached.add(node.id);
  for (const node of nodes) if (node.groupId && node.memberIds?.some(id => reached.has(id))) reached.add(node.id);
  const callCurrent = storyProgress.currentId ? nodes.find(node => node.callId === storyProgress.currentId)?.id ?? editing?.view?.callLocations?.[storyProgress.currentId] : undefined;
  const currentId = callCurrent ?? nodes.find(node => node.groupId && node.memberIds?.includes(storyProgress.currentId ?? ''))?.id
    ?? editing?.view?.locations[storyProgress.currentId ?? ''] ?? storyProgress.currentId;
  const progress = { reached, currentId };
  const target = editing?.inspector;
  const presetId = target?.kind === 'preset' ? target.presetId : undefined;
  const presetUsers = presetId === undefined ? undefined : new Set(nodes.filter(node => node.styleId === presetId).map(node => node.id));
  // A committed reference change can precede the inspector's next impact effect.
  const impacted = new Set(editing?.impact?.nodeIds);
  const affectedIds = new Set(nodes.filter(node => (impacted.has(node.id) || !!node.sourceEntryId && impacted.has(node.sourceEntryId)) && (!presetUsers || presetUsers.has(node.id))).map(node => node.id));
  const selectedId = target?.kind === 'call' ? nodes.find(node => node.callId === target.callId)?.id : target && (target.kind === 'base' || target.kind === 'preset') ? flowInspectorReference(target, nodes) : editing?.nodeId;
  const referenceId = editing ? flowPreviewReference(ids, selectedId, [...affectedIds], progress.currentId, target?.kind !== 'preset') : undefined;
  const visuals = new Map<string, FlowPreviewVisual>(nodes.map(node => {
    const visual = flowPreviewNodeVisual(node.id, progress, { lockUnread: list?.lockUnread, ...pointer, referenceId, visualState: editing?.visualState, affectedIds });
    const suffix = list?.showProgress && !visual.locked ? visual.current ? ' · 当前'
      : node.groupId ? ` · 已读 ${node.memberIds?.filter(id => storyProgress.reached.has(id)).length ?? 0}/${node.memberIds?.length ?? 0}`
      : progress.reached.has(node.id) ? ' · 已读' : '' : '';
    return [node.id, { ...visual, suffix }];
  }));
  return { progress, referenceId, visuals };
}

/** Use the actual layout's ordering and collapsed entry mapping for real samples. */
export function flowPreviewSample(project: Project, component: UiComponent, nodeId: string, editing?: FlowPreviewSession): FlowPreviewVisual | undefined {
  const view = playerFlowView(project, component, editing?.groupId);
  const hasCalls = project.nodes.some(node => node.kind === 'call');
  const session = playerFlowMode(component) === 'custom' || hasCalls
    ? { ...editing, view, preview: editing?.preview ?? { mode: 'all' as const }, entryIds: playerFlowPreviewEntryIds(project, component) } : editing;
  if (component.list?.layout === 'flow') {
    const graph = storyFlowLayout(project, component, editing?.groupId, view);
    return flowPreviewNodes(graph.nodes, playerFlowMode(component) === 'custom' || hasCalls ? project.entryId : graph.locations[project.entryId] ?? project.entryId, component.list, session).visuals.get(nodeId);
  }
  return flowPreviewNodes(view.entries, project.entryId, component.list, session).visuals.get(nodeId);
}

/** Calls are distinct progress events even when their content is shared. */
export function playerFlowPreviewEntryIds(project: Project, component: UiComponent): string[] {
  const bundle = playerFlowViews(project, component);
  const entries = playerFlowAllEntries(project, component);
  if (!bundle.hasCalls) return entries.map(entry => entry.id);
  const ids = new Set(entries.map(entry => entry.id));
  for (const view of [bundle.root, ...bundle.views.values()]) for (const entry of view.entries) if (entry.callId) ids.add(entry.callId);
  return project.nodes.filter(node => ids.has(node.id)).map(node => node.id);
}

export function playerFlowPreviewOptions(project: Project, component: UiComponent): { id: string; name: string }[] {
  const bundle = playerFlowViews(project, component), options = new Map(playerFlowAllEntries(project, component).map(entry => [entry.id, { id: entry.id, name: entry.name }]));
  const names = new Map(project.nodes.map(node => [node.id, node.name]));
  for (const view of [bundle.root, ...bundle.views.values()]) for (const entry of view.entries) if (entry.callId) options.set(entry.callId, { id: entry.callId, name: `调用位置 · ${entry.name} · ${names.get(entry.callId) ?? entry.callId}` });
  return bundle.hasCalls ? project.nodes.flatMap(node => options.has(node.id) ? [options.get(node.id)!] : []) : [...options.values()];
}
