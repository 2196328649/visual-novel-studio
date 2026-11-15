import type { BlueprintTraceEntry, BlueprintTraceFrame, BlueprintTraceKind, BlueprintTraceSnapshot } from './blueprint-trace';
import type { Project, VariableValue } from './model';
import { projectGraphs } from './project-resources';
import { uiPage } from './ui-pages';
import { uiGraphOnPage, uiPageComponents, uiPageGraphs } from './ui-logic';
import { blueprintStateScopes } from './blueprint-state';
import type { UiPreviewTraceTarget } from './ui-preview-actions';

export const blueprintTraceKindNames: Record<BlueprintTraceKind, string> = {
  event: '触发事件', enter: '进入调用', node: '执行节点', input: '输入值', output: '输出值', write: '写入状态',
  branch: '选择分支', wait: '等待', resume: '继续', return: '调用返回', stop: '停止／未完成', page: '页面变化',
};
export const blueprintTraceFilters = { all: '全部记录', events: '事件与节点', values: '输入与输出', writes: '状态写入', calls: '调用与等待', problems: '停止与不可用', pages: '页面变化' } as const;
export type BlueprintTraceFilter = keyof typeof blueprintTraceFilters;
export function blueprintTraceHasValue(entry: BlueprintTraceEntry) { return entry.value !== undefined || ['input', 'output', 'write'].includes(entry.kind); }
export function blueprintTraceValue(entry: { value?: VariableValue; available?: boolean; valueTruncated?: boolean }): string {
  if (entry.available === false) return '未产生值（不可用）';
  if (entry.value === undefined) return '未记录值';
  const text = typeof entry.value === 'string' ? entry.value === '' ? '""（空文本）' : JSON.stringify(entry.value) : String(entry.value);
  return text + (entry.valueTruncated ? '…（已截断，最多 4000 字）' : '');
}
export function blueprintTraceView(project: Project) {
  const graphs = new Map(projectGraphs(project).map(graph => [graph.id, graph]));
  const nodes = new Map([...graphs].map(([id, graph]) => [id, new Map(graph.nodes.map(node => [node.id, node]))]));
  const componentNames = new Map<string, Map<string, string>>();
  const graphName = (id?: string) => id ? graphs.get(id)?.name ?? '已移除蓝图 · ' + id : '页面事件';
  const nodeName = (graphId?: string, nodeId?: string) => nodeId ? nodes.get(graphId ?? '')?.get(nodeId)?.name ?? '已移除节点 · ' + nodeId : '';
  const pinName = (graphId?: string, nodeId?: string, pinId?: string) => pinId ? nodes.get(graphId ?? '')?.get(nodeId ?? '')?.pins.find(pin => pin.id === pinId)?.name ?? pinId : '';
  const pageName = (id?: string) => id ? uiPage(project, id)?.name ?? id : '无页面';
  const componentName = (pageId?: string, componentId?: string) => {
    if (!componentId) return '';
    if (!pageId) return componentId;
    if (!componentNames.has(pageId)) componentNames.set(pageId, new Map(uiPageComponents(project, pageId).map(component => [component.id, component.name || component.text || component.id])));
    return componentNames.get(pageId)?.get(componentId) ?? componentId;
  };
  const origin = (entry: { invocationId?: number; pageId?: string; pageInstance?: number }) => [entry.invocationId !== undefined ? '调用 #' + entry.invocationId : '页面事件', entry.pageId ? pageName(entry.pageId) + (entry.pageInstance !== undefined ? ' · 实例 #' + entry.pageInstance : '') : ''].filter(Boolean).join(' / ');
  const variableName = (entry: BlueprintTraceEntry) => {
    const variables = entry.scope === 'call' ? graphs.get(entry.graphId ?? '')?.localVariables : entry.scope === 'page' ? project.ui.pageVariables?.[entry.targetPageId ?? entry.pageId ?? ''] : project.variables;
    return variables?.find(variable => variable.id === entry.variableId)?.name ?? entry.variableId ?? '';
  };
  const state = (entry: BlueprintTraceEntry) => [entry.scope ? blueprintStateScopes[entry.scope].name : '', variableName(entry), entry.targetPageId ? pageName(entry.targetPageId) + (entry.targetPageInstance !== undefined ? ' · 实例 #' + entry.targetPageInstance : '') : ''].filter(Boolean).join(' / ');
  const summary = (entry: BlueprintTraceEntry) => [entry.reason, blueprintTraceHasValue(entry) ? blueprintTraceValue(entry) : '', state(entry)].filter(Boolean).join(' · ');
  const graphTarget = (graphId?: string, nodeId?: string, pageId?: string): UiPreviewTraceTarget | undefined => {
    if (!graphId) return undefined;
    const graph = graphs.get(graphId);
    // A shared module is located as a module, not silently rebound to the triggering page.
    if (!graph || (!graph.uiPageId && graph.kind !== 'ui')) return { graphId, nodeId };
    const targetPage = graph.uiPageId ?? pageId;
    if (!targetPage || !uiPageGraphs(project, targetPage).some(candidate => candidate.id === graphId)) return { graphId, nodeId };
    const instance = targetPage.startsWith('ui:') ? (uiGraphOnPage(project, graph, targetPage) ? project.ui.activeInstanceId ?? 'base' : graph.uiInstanceId ?? 'base') : undefined;
    return { graphId, nodeId, pageId: targetPage, uiInstanceId: instance };
  };
  const pageTarget = (pageId?: string, componentId?: string): UiPreviewTraceTarget | undefined => pageId && uiPage(project, pageId) && (!componentId || uiPageComponents(project, pageId).some(component => component.id === componentId)) ? { pageId, componentId, uiInstanceId: pageId.startsWith('ui:') ? project.ui.activeInstanceId ?? 'base' : undefined } : undefined;
  const searchable = (entry: BlueprintTraceEntry) => [blueprintTraceKindNames[entry.kind], graphName(entry.graphId), nodeName(entry.graphId, entry.nodeId), pinName(entry.graphId, entry.nodeId, entry.pinId), summary(entry), origin(entry), componentName(entry.pageId, entry.componentId), entry.graphId, entry.nodeId, entry.pinId, entry.trigger].filter(Boolean).join(' ').toLocaleLowerCase();
  return { graphName, nodeName, pinName, pageName, componentName, origin, state, summary, graphTarget, pageTarget, searchable };
}
export function filterBlueprintTrace(snapshot: BlueprintTraceSnapshot | undefined, view: ReturnType<typeof blueprintTraceView>, options: { kind?: BlueprintTraceFilter; query?: string; invocationId?: number } = {}) {
  const query = options.query?.trim().toLocaleLowerCase();
  return (snapshot?.entries ?? []).filter(entry => {
    if (options.invocationId !== undefined && entry.invocationId !== options.invocationId) return false;
    switch (options.kind) {
      case 'events': if (!['event', 'node', 'branch'].includes(entry.kind)) return false; break;
      case 'values': if (!['input', 'output'].includes(entry.kind)) return false; break;
      case 'writes': if (entry.kind !== 'write') return false; break;
      case 'calls': if (!['enter', 'return', 'wait', 'resume', 'stop'].includes(entry.kind)) return false; break;
      case 'problems': if (entry.kind !== 'stop' && !(blueprintTraceHasValue(entry) && entry.available === false)) return false; break;
      case 'pages': if (entry.kind !== 'page') return false; break;
    }
    return !query || view.searchable(entry).includes(query);
  });
}
export function blueprintTraceInvocations(snapshot?: BlueprintTraceSnapshot): BlueprintTraceFrame[] {
  const frames = new Map<number, BlueprintTraceFrame>();
  for (const entry of snapshot?.entries ?? []) for (const frame of entry.stack) frames.set(frame.id, frame);
  return [...frames.values()].sort((a, b) => a.id - b.id);
}
