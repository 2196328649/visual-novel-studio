import type { Project } from '../core/model';
import { storyScopeKey, validStoryScope, type StoryGraphScope } from '../core/story-graph';

export interface StoryFlowView { viewport?: { x: number; y: number; zoom: number }; selectedIds: string[] }
export interface StoryFlowSession {
  scope: StoryGraphScope; views: Record<string, StoryFlowView>; selectedStoryId?: string; propertiesOpen: boolean;
}
const sessionKey = (projectId: string) => 'vns:story-flow-session:' + projectId;
export function readStoryFlowSession(project: Project): StoryFlowSession {
  const fallback: StoryFlowSession = { scope: { kind: 'game' }, views: {}, propertiesOpen: true };
  try {
    const raw = JSON.parse(localStorage.getItem(sessionKey(project.id)) ?? 'null');
    if (!raw || !['game', 'content', 'scene', 'page'].includes(raw.scope?.kind)) return fallback;
    if (raw.scope.kind === 'page' && (typeof raw.scope.pageId !== 'string' || raw.scope.trail !== undefined && (!Array.isArray(raw.scope.trail) || raw.scope.trail.some((id: unknown) => typeof id !== 'string')))) return fallback;
    const views: Record<string, StoryFlowView> = {};
    for (const [key, value] of Object.entries(raw.views ?? {}) as [string, any][]) {
      if (!value || !Array.isArray(value.selectedIds)) continue;
      const v = value.viewport;
      views[key] = { selectedIds: value.selectedIds.filter((id: unknown) => typeof id === 'string'),
        ...(v && [v.x, v.y, v.zoom].every(Number.isFinite) && v.zoom >= .1 && v.zoom <= 1.6 ? { viewport: { x: v.x, y: v.y, zoom: v.zoom } } : {}) };
    }
    return { scope: validStoryScope(project, raw.scope), views, selectedStoryId: typeof raw.selectedStoryId === 'string' ? raw.selectedStoryId : undefined, propertiesOpen: raw.propertiesOpen !== false };
  } catch { return fallback; }
}
export function saveStoryFlowSession(projectId: string, session: StoryFlowSession) {
  try { localStorage.setItem(sessionKey(projectId), JSON.stringify(session)); } catch { /* Canvas navigation still works when browser storage is unavailable. */ }
}
export function saveStoryFlowView(session: StoryFlowSession, view: StoryFlowView) {
  session.views[storyScopeKey(session.scope)] = view;
}
