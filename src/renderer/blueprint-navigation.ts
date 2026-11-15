import { effectiveUiComponents, type BlueprintGraph, type Diagnostic, type Project } from '../core/model';
import { cloneData, mutateProject } from '../core/project-mutation';
import { synchronizeBlueprintSignatures } from '../core/blueprint';
import { projectGraphs } from '../core/project-resources';
import { performanceWorkspaceDraft, targetPerformance, type PerformanceTarget } from '../core/performance-workspace';
import { uiGraphOnPage, uiPageGraphs } from '../core/ui-logic';
import { findTimelinePath } from '../core/timeline-navigation';

type UiTarget = NonNullable<Diagnostic['ui']>;
export interface BlueprintCanvasLocation {
  graphId: string; nodeIds: string[]; linkIds: string[]; primaryNodeId?: string;
  viewport: { x: number; y: number; zoom: number };
  inspector: { open: boolean; tab: 'node' | 'interface' | 'links' | 'state' };
}
export interface BlueprintNodeClickOrigin {
  graphId: string; nodeId: string; inspector: BlueprintCanvasLocation['inspector'];
}
/** A double-click first dispatches a normal click, which opens node properties.
 * Keep the inspector from before that gesture for the eventual return point. */
export function rememberBlueprintNodeClick(previous: BlueprintNodeClickOrigin | undefined, graphId: string, nodeId: string, detail: number, inspector: BlueprintCanvasLocation['inspector']): BlueprintNodeClickOrigin {
  if (detail === 2 && previous?.graphId === graphId && previous.nodeId === nodeId) return previous;
  return { graphId, nodeId, inspector: { ...inspector } };
}
export interface BlueprintGraphOrigin extends BlueprintCanvasLocation {
  performance?: {
    target?: PerformanceTarget;
    parents: { graphId: string; callNodeId?: string }[];
    temporary?: { signature: string; workspace: ReturnType<typeof performanceWorkspaceDraft> };
  };
}
export type OpenBlueprintGraph = (id: string, nodeId?: string, origin?: BlueprintGraphOrigin) => void;
export interface BlueprintReturnPoint { projectId: string; origin: BlueprintGraphOrigin; ui?: UiTarget }
export interface BlueprintVisit { from: BlueprintReturnPoint; targetId: string }

export function canvasLocation(graph: BlueprintGraph, nodeIds: string[], linkIds: string[], viewport: BlueprintCanvasLocation['viewport'], inspector: BlueprintCanvasLocation['inspector'], primaryNodeId?: string): BlueprintCanvasLocation {
  const selected = [...new Set(nodeIds)].filter(id => graph.nodes.some(node => node.id === id));
  return { graphId: graph.id, nodeIds: selected, linkIds: [...new Set(linkIds)].filter(id => graph.links.some(link => link.id === id)), primaryNodeId: selected.includes(primaryNodeId ?? '') ? primaryNodeId : selected[0],
    viewport: Object.values(viewport).every(Number.isFinite) && viewport.zoom > 0 ? { ...viewport } : { x: 0, y: 0, zoom: 1 }, inspector: { ...inspector } };
}
function copyPoint(point: BlueprintReturnPoint): BlueprintReturnPoint {
  const { origin } = point;
  return { ...point, ui: point.ui && { ...point.ui }, origin: { ...origin, nodeIds: [...origin.nodeIds], linkIds: [...origin.linkIds], viewport: { ...origin.viewport }, inspector: { ...origin.inspector },
    performance: origin.performance && { ...origin.performance, target: origin.performance.target && { ...origin.performance.target }, parents: origin.performance.parents.map(parent => ({ ...parent })) } } };
}
export function enterBlueprintVisit(visits: readonly BlueprintVisit[], from: BlueprintReturnPoint, targetId: string): BlueprintVisit[] {
  if (from.origin.graphId === targetId) return [...visits];
  const previous = visits.at(-1);
  const chain = previous?.targetId === from.origin.graphId && previous.from.projectId === from.projectId ? visits : [];
  return [...chain, { from: copyPoint(from), targetId }].slice(-32);
}

/** A transient performance's generated IDs can be reused only while its original authored actions still match. */
export function performanceSourceSignature(project: Project, target?: PerformanceTarget): string | undefined {
  if (!target?.nodeId) return;
  const node = project.nodes.find(node => node.id === target.nodeId);
  if (!node || node.kind !== 'passage' && node.kind !== 'chapterTitle') return;
  if (target.lineId && (node.kind !== 'passage' || !node.lines.some(line => line.id === target.lineId))) return;
  const actions = targetPerformance(project, target);
  if (target.actionIndex !== undefined && (!Number.isInteger(target.actionIndex) || target.actionIndex < 0 || !actions.length)) return;
  return JSON.stringify([node.id, node.kind, target.lineId, target.actionIndex, actions]);
}
export function performanceGraphOrigin(origin: BlueprintGraphOrigin, saved: Project, workspace: ReturnType<typeof performanceWorkspaceDraft>, target: PerformanceTarget | undefined, parents: { graphId: string; callNodeId?: string }[]): BlueprintGraphOrigin {
  const signature = performanceSourceSignature(saved, target);
  const temporary = !projectGraphs(saved).some(graph => graph.id === origin.graphId) && signature !== undefined ? { signature, workspace } : undefined;
  return { ...origin, performance: { target: target && { ...target }, parents: parents.map(parent => ({ ...parent })), temporary } };
}
export function restoredPerformanceWorkspace(saved: Project, target: PerformanceTarget | undefined, origin?: BlueprintGraphOrigin) {
  const temporary = origin?.performance?.temporary;
  let workspace: ReturnType<typeof performanceWorkspaceDraft>;
  if (!temporary || projectGraphs(saved).some(graph => graph.id === origin.graphId) || temporary.signature !== performanceSourceSignature(saved, origin.performance?.target)) workspace = performanceWorkspaceDraft(saved, target);
  else {
    const preview = cloneData(saved); temporary.workspace.materialize(preview);
    workspace = { project: preview, target: temporary.workspace.target, materialize: temporary.workspace.materialize };
  }
  if (workspace.project === saved) return workspace;
  // Generated canvases may outlive a callee's interface edit. Normalize only the
  // projection now; materialize with matching pins immediately before a real edit.
  return { ...workspace, project: mutateProject(workspace.project, draft => synchronizeBlueprintSignatures(draft)), materialize: (draft: Project) => { workspace.materialize(draft); synchronizeBlueprintSignatures(draft); } };
}
function validUiReturn(project: Project, graphId: string, ui: UiTarget): boolean {
  if (ui.page !== 'custom' && project.ui.disabledPages?.includes(ui.page)) return false;
  if (ui.instanceId && !project.ui.instances?.some(instance => instance.id === ui.instanceId)) return false;
  if (ui.page === 'custom' && !project.ui.customPages.some(page => page.id === ui.customPageId)) return false;
  const scoped = { ...project, ui: { ...project.ui, activeInstanceId: ui.instanceId } };
  const pageId = ui.page === 'custom' ? ui.customPageId! : 'ui:' + ui.page;
  return uiPageGraphs(scoped, pageId).some(graph => uiGraphOnPage(scoped, graph, pageId) && (graph.id === graphId || !!findTimelinePath(scoped, graph.id, graphId)?.length));
}
/** Return only to an existing source; deleted nodes are removed from selection, never replaced by a random node. */
export function resolveBlueprintReturn(project: Project, visits: readonly BlueprintVisit[]): { point?: BlueprintReturnPoint; remaining: BlueprintVisit[]; changed: boolean } {
  for (let index = visits.length - 1; index >= 0; index--) {
    const point = copyPoint(visits[index].from);
    if (point.projectId !== project.id) continue;
    const { origin } = point;
    let graph = projectGraphs(project).find(graph => graph.id === origin.graphId);
    const temporary = origin.performance?.temporary;
    if (!graph && temporary && temporary.workspace.project.id === project.id && temporary.signature === performanceSourceSignature(project, origin.performance?.target)) graph = projectGraphs(temporary.workspace.project).find(graph => graph.id === origin.graphId);
    if (!graph || point.ui && !validUiReturn(project, graph.id, point.ui)) continue;
    const location = canvasLocation(graph, origin.nodeIds, origin.linkIds, origin.viewport, origin.inspector, origin.primaryNodeId);
    let changed = index !== visits.length - 1 || location.nodeIds.length !== origin.nodeIds.length || location.linkIds.length !== origin.linkIds.length;
    point.origin = { ...origin, ...location };
    if (point.ui?.componentId) {
      const components = point.ui.page === 'custom' ? project.ui.customPages.find(page => page.id === point.ui!.customPageId)!.components : effectiveUiComponents({ ...project.ui, activeInstanceId: point.ui.instanceId }).filter(component => component.page === point.ui!.page);
      if (!components.some(component => component.id === point.ui!.componentId)) { delete point.ui.componentId; changed = true; }
    }
    if (point.origin.performance) {
      if (projectGraphs(project).some(g => g.id === graph!.id)) delete point.origin.performance.temporary;
      const available = [...projectGraphs(project), ...projectGraphs(temporary?.workspace.project ?? project)];
      if (point.origin.performance.parents.some((parent, index, parents) => {
        const owner = available.find(g => g.id === parent.graphId), childId = parents[index + 1]?.graphId ?? graph!.id;
        return !owner || parent.callNodeId && !owner.nodes.some(node => node.id === parent.callNodeId && node.properties.graphId === childId);
      })) { point.origin.performance.parents = []; changed = true; }
      const target = point.origin.performance.target;
      if (target?.nodeId && performanceSourceSignature(project, target) === undefined || target?.graphId && !projectGraphs(project).some(g => g.id === target.graphId) && !point.origin.performance.temporary) {
        point.origin.performance.target = { nodeId: '', graphId: graph.id }; point.origin.performance.parents = []; changed = true;
      }
    }
    return { point, remaining: visits.slice(0, index), changed };
  }
  return { remaining: [], changed: visits.length > 0 };
}
