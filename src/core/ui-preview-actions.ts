import { z } from 'zod';
import type { Diagnostic, Project } from './model';
import { projectGraphs } from './project-resources';
import { blueprintContext } from './blueprint-context';
import { uiPage } from './ui-pages';
import { uiGraphOnPage, uiPageComponents, uiPageGraphs } from './ui-logic';

const id = z.string().min(1).max(160);
export const uiPreviewActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('locate'), projectId: id, graphId: id.optional(), nodeId: id.optional(), componentId: id.optional(), pageId: id.optional(), uiInstanceId: id.optional() }),
  z.object({ kind: z.literal('play'), projectId: id }),
]);
export type UiPreviewAction = z.infer<typeof uiPreviewActionSchema>;
export type UiPreviewTraceTarget = Omit<Extract<UiPreviewAction, { kind: 'locate' }>, 'kind' | 'projectId'>;
export const uiPreviewActionResultSchema = z.object({ status: z.enum(['completed', 'cancelled', 'failed']), message: z.string().max(6000) });
export type UiPreviewActionResult = z.infer<typeof uiPreviewActionResultSchema>;
export type UiPreviewActionHandler = (action: UiPreviewAction) => Promise<UiPreviewActionResult>;

/** Re-resolve against the editor's synchronous current draft, including after a save/discard prompt. */
export function resolveUiPreviewAction(project: Project, raw: unknown): { action: UiPreviewAction; ui?: NonNullable<Diagnostic['ui']> } {
  const action = uiPreviewActionSchema.parse(raw);
  if (action.projectId !== project.id) throw new Error('预演所属工程已切换，请重新打开预览。');
  if (action.kind === 'play') return { action };
  if (action.uiInstanceId && action.uiInstanceId !== 'base' && !project.ui.instances?.some(instance => instance.id === action.uiInstanceId)) throw new Error('轨迹所属界面方案已不存在。');
  const scoped = action.uiInstanceId ? { ...project, ui: { ...project.ui, activeInstanceId: action.uiInstanceId === 'base' ? undefined : action.uiInstanceId } } : project;
  const matches = action.graphId ? projectGraphs(project).filter(graph => graph.id === action.graphId) : [];
  if (matches.length > 1) throw new Error('轨迹中的蓝图标识不唯一，不会定位到其他蓝图。');
  const graph = matches[0];
  if (action.graphId && !graph) throw new Error('轨迹中的蓝图已不存在，请重新预演。');
  if (action.nodeId && !graph?.nodes.some(node => node.id === action.nodeId)) throw new Error('轨迹中的节点已不存在，不会定位到其他节点。');
  if (action.pageId && !uiPage(project, action.pageId)) throw new Error('轨迹中的页面已不存在。');
  if (action.pageId && uiPage(project, action.pageId)?.disabled) throw new Error('轨迹中的页面已停用，请先恢复页面。');
  if (!graph && !action.pageId) throw new Error('轨迹没有可定位的蓝图或页面。');
  let ui: NonNullable<Diagnostic['ui']> | undefined;
  if (graph?.kind === 'ui' || graph?.uiPageId) {
    if (action.pageId) {
      if (!uiGraphOnPage(scoped, graph, action.pageId) || !uiPageGraphs(scoped, action.pageId).some(candidate => candidate.id === graph.id)) throw new Error('轨迹中的事件图已不属于原页面／方案，不会转到其他页面。');
    } else {
      const context = blueprintContext(scoped, graph, action.nodeId);
      if (context.problem) throw new Error(context.problem);
      ui = context.ui;
      if (action.uiInstanceId && context.pageId?.startsWith('ui:')) {
        if (!uiGraphOnPage(scoped, graph, context.pageId)) throw new Error('轨迹中的事件图已不属于原界面方案。');
        if (ui) ui = { ...ui, instanceId: scoped.ui.activeInstanceId };
      }
    }
  }
  if (action.pageId && (!graph || graph.kind === 'ui' || graph.uiPageId)) {
    const page = uiPage(project, action.pageId)!;
    ui = page.template ? { page: page.kind, instanceId: scoped.ui.activeInstanceId } : { page: 'custom', customPageId: page.id };
  }
  if (action.componentId) {
    const pageId = action.pageId ?? graph?.uiPageId ?? (ui ? ui.customPageId ?? 'ui:' + ui.page : undefined);
    const componentProject = ui && ui.page !== 'custom' ? { ...project, ui: { ...project.ui, activeInstanceId: ui.instanceId } } : scoped;
    if (!pageId || !uiPageComponents(componentProject, pageId).some(component => component.id === action.componentId)) throw new Error('轨迹中的控件已不存在或已不属于原页面／方案。');
    if (ui) ui.componentId = action.componentId;
  }
  return { action, ui };
}

/** Both the sender and the receiving editor validate; passing here is not an acknowledgement of navigation. */
export function checkedUiPreviewAction(project: Project, raw: unknown): UiPreviewAction {
  return resolveUiPreviewAction(project, raw).action;
}
