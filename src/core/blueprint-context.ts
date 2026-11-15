import { effectiveUiComponents, uiPageSchema, type BlueprintGraph, type Diagnostic, type Project, type UiComponent } from './model';
import { projectGraphs } from './project-resources';
import { uiPageNames } from './ui-names';
import { standardUiEventPages, uiPageGraphs } from './ui-logic';

export interface BlueprintContext {
  ui?: NonNullable<Diagnostic['ui']>;
  pageId?: string;
  legacy?: boolean;
  label: string;
  problem?: string;
}

/** Resolve navigation only. Inferring a legacy editor context must never turn its call entry into OnShow. */
export function blueprintContext(project: Project, graphOrId: BlueprintGraph | string, nodeId?: string): BlueprintContext {
  const matches = typeof graphOrId === 'string' ? projectGraphs(project).filter(graph => graph.id === graphOrId) : [graphOrId];
  if (matches.length > 1) return { label: '蓝图标识冲突', problem: '目标蓝图标识不唯一，请先修复冲突；不会自动打开其中一张图。' };
  const graph = matches[0];
  if (!graph) return { label: '缺失蓝图', problem: '蓝图已不存在。' };
  if (!graph.uiPageId && graph.kind !== 'ui') return { label: graph.kind === 'macro' || graph.kind === 'function' ? '公共模块 · 调用时执行' : '演出 · 调用时执行' };
  const candidates = new Map<string, { pageId: string; instanceId?: string }>();
  const add = (pageId: string, instanceId?: string) => candidates.set(pageId + '/' + (instanceId ?? 'base'), { pageId, instanceId });
  if (graph.uiPageId) add(graph.uiPageId, !graph.uiPageId.startsWith('ui:') || graph.uiInstanceId === 'base' ? undefined : graph.uiInstanceId);
  else {
    // Navigation must use the same inherited bindings and event scopes as the
    // page workspace. Raw instance.components misses inherited controls and
    // can assign a scoped event to an unrelated scheme with the same ID.
    const scope = (instanceId?: string): Project => ({ ...project, ui: { ...project.ui, activeInstanceId: instanceId } });
    for (const page of project.ui.customPages) {
      if (uiPageGraphs(scope(), page.id, [graph]).length) add(page.id);
    }
    for (const instanceId of [undefined, ...(project.ui.instances ?? []).map(instance => instance.id)]) {
      const scoped = scope(instanceId);
      for (const page of standardUiEventPages) {
        if (uiPageGraphs(scoped, page.id, [graph]).length) add(page.id, instanceId);
      }
    }
  }
  if (candidates.size !== 1) return { label: '共用界面调用 · 保留原有入口', legacy: true, problem: candidates.size ? '此旧界面图关联多个页面或方案，请从对应页面的事件图进入；原有调用和事件绑定保持不变。' : '界面图尚无可确定的页面归属，请先绑定页面或控件；不会自动使用当前页面。' };
  const { pageId, instanceId } = [...candidates.values()][0];
  const legacy = !graph.uiPageId;
  if (instanceId && !project.ui.instances?.some(i => i.id === instanceId)) return { label: '缺失界面方案', problem: '事件图所属界面方案已不存在。' };
  let ui: NonNullable<Diagnostic['ui']>;
  let components: UiComponent[], pageName: string;
  if (pageId.startsWith('ui:')) {
    const page = uiPageSchema.safeParse(pageId.slice(3));
    if (!page.success || page.data === 'custom') return { label: '缺失页面', problem: '事件图所属页面已不存在。' };
    if (project.ui.disabledPages?.includes(page.data)) return { label: uiPageNames[page.data] + ' · 页面已停用', problem: '事件图所属页面已停用，请先恢复页面；不会定位到其他页面。' };
    ui = { page: page.data, instanceId };
    components = effectiveUiComponents({ ...project.ui, activeInstanceId: instanceId }).filter(c => c.page === page.data);
    pageName = uiPageNames[page.data];
  } else {
    const page = project.ui.customPages.find(p => p.id === pageId);
    if (!page) return { label: '缺失页面', problem: '事件图所属自定义页面已不存在。' };
    ui = { page: 'custom', customPageId: page.id };
    components = page.components; pageName = page.name;
  }
  const componentId = graph.nodes.find(n => n.id === nodeId)?.properties.componentId;
  if (typeof componentId === 'string' && components.some(c => c.id === componentId)) ui.componentId = componentId;
  const schemeName = ui.page === 'custom' ? '' : (project.ui.instances?.find(i => i.id === instanceId)?.name ?? '基础界面') + ' / ';
  return { ui, pageId, legacy, label: schemeName + pageName + (legacy ? ' · 调用入口与已有控件事件' : ' · 页面显示与控件事件') };
}
