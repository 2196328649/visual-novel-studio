import type { TimelineVisit } from '../core/timeline-navigation';
import type { BlueprintFocus } from './BlueprintGraphEditor';
import type { BlueprintCanvasLocation } from './blueprint-navigation';
import type { UiAnimationFocus } from './ui-animation-editor-focus';

export interface UiAuthoringSession {
  graphId?: string;
  animationId?: string;
  timelineVisits: TimelineVisit[];
  graphs: Map<string, BlueprintCanvasLocation>;
  query: string;
  moduleLibrary: { expanded: boolean; query: string };
  sidebar: {
    active?: string;
    directoryScroll: { current: number };
    detailScroll: Map<string, number>;
    drafts: Map<string, unknown>;
    graphDetails: Map<string, string>;
  };
  preferences: { autoConnect: boolean; environmentOnly: boolean };
  handledFocus?: BlueprintFocus;
  handledAnimationFocus?: UiAnimationFocus;
}
export function createUiAuthoringSession(): UiAuthoringSession {
  return { timelineVisits: [], graphs: new Map(), query: '', moduleLibrary: { expanded: false, query: '' }, sidebar: { directoryScroll: { current: 0 }, detailScroll: new Map(), drafts: new Map(), graphDetails: new Map() }, preferences: { autoConnect: true, environmentOnly: true } };
}
export function rememberedUiGraphFocus(session: UiAuthoringSession, graphId: string | undefined, request = 0): BlueprintFocus | undefined {
  if (!graphId) return;
  const restore = session.graphs.get(graphId);
  return { graphId, request, ...(restore ? { restore } : {}) };
}

/** A graph-only resource/search entry restores its last canvas, while an
 * explicit node, return point or selection request always takes precedence. */
export function uiGraphEntryFocus(session: UiAuthoringSession, request: BlueprintFocus): BlueprintFocus {
  if (request.nodeId || request.objectInstanceId || request.restore || request.selection) return request;
  return rememberedUiGraphFocus(session, request.graphId, request.request) ?? request;
}

/** Canvas restoration and detail navigation are independent. Re-entering the
 * current graph keeps a member form open; switching graphs restores its detail. */
export function uiGraphEntryDetail(session: UiAuthoringSession, request: Pick<BlueprintFocus, 'graphId' | 'nodeId'>, currentGraphId: string | undefined, active: string | undefined): string {
  if (request.nodeId) return 'node:' + request.graphId + ':' + request.nodeId;
  if (request.graphId === currentGraphId && active) return active;
  return session.sidebar.graphDetails.get(request.graphId) ?? 'graph:' + request.graphId;
}

/** A destination graph may render before its detail navigation settles. Only
 * remember that first frame when the detail changed with the graph. */
export function uiGraphDetailToRemember(previous: { graphId?: string; active: string }, graphId: string | undefined, active: string): string | undefined {
  if (!graphId || previous.graphId !== graphId && previous.active === active) return;
  return active;
}
