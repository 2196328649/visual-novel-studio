import { makeId, type BlueprintGraph, type BlueprintNode, type BlueprintVariable, type Project, type VariableValue } from './model';
import { projectGraphs } from './project-resources';
import { uiPage } from './ui-pages';

export const blueprintStateScopes = {
  call: { name: '本次调用', hint: '每次调用或事件触发都从初始值开始；嵌套、再次调用互不影响。等待、存读档和回滚跟随本次调用。' },
  page: { name: '页面实例', hint: '同一页面实例的显示、点击、按键和定时事件共享。关闭后释放，重新打开重置；存读档及回滚恢复仍有效的实例。定义由界面方案共用。' },
  project: { name: '作品状态', hint: '整个作品的剧情和页面共享，跟随存档与回滚；新游戏从作品初始值开始。' },
  player: { name: '本机变量', hint: '保存在本机，跨存档和新游戏保留，不随剧情回滚。是否参与“恢复初始设置”由每个变量决定。系统音量等设置仍使用“玩家选项”节点。' },
} as const;
export type BlueprintStateScope = keyof typeof blueprintStateScopes;
export type BlueprintStateOwner = { scope: 'call'; graphId: string } | { scope: 'page'; pageId: string };
export function blueprintStateScope(project: Project, node: Pick<BlueprintNode, 'properties'>): BlueprintStateScope {
  const scope = node.properties.scope;
  if (typeof scope === 'string' && Object.hasOwn(blueprintStateScopes, scope)) return scope as BlueprintStateScope;
  // Old nodes retain the actual lifetime of the referenced project parameter.
  return project.variables.find(variable => variable.id === node.properties.variableId)?.persistent ? 'player' : 'project';
}
export function blueprintStatePageId(graph: BlueprintGraph, node: Pick<BlueprintNode, 'properties'>): string {
  return typeof node.properties.pageId === 'string' && node.properties.pageId ? node.properties.pageId : graph.uiPageId ?? '';
}
export function blueprintStateVariables(project: Project, graph: BlueprintGraph, scope: BlueprintStateScope, pageId = graph.uiPageId ?? '') {
  if (scope === 'call') return graph.localVariables ?? [];
  if (scope === 'page') return project.ui.pageVariables?.[pageId] ?? [];
  return project.variables.filter(variable => scope === 'player' ? variable.persistent : !variable.persistent);
}
export function blueprintStateVariable(project: Project, graph: BlueprintGraph, node: Pick<BlueprintNode, 'properties'>) {
  return blueprintStateVariables(project, graph, blueprintStateScope(project, node), blueprintStatePageId(graph, node)).find(variable => variable.id === node.properties.variableId);
}
export function blueprintVariableOwner(project: Project, owner: BlueprintStateOwner): BlueprintVariable[] {
  if (owner.scope === 'call') {
    const graph = projectGraphs(project).find(graph => graph.id === owner.graphId);
    if (!graph) throw new Error('蓝图已不存在。');
    return graph.localVariables ?? [];
  }
  if (!uiPage(project, owner.pageId)) throw new Error('页面已不存在。');
  return project.ui.pageVariables?.[owner.pageId] ?? [];
}
function storeVariables(project: Project, owner: BlueprintStateOwner, variables: BlueprintVariable[]) {
  if (owner.scope === 'call') projectGraphs(project).find(graph => graph.id === owner.graphId)!.localVariables = variables;
  else (project.ui.pageVariables ??= {})[owner.pageId] = variables;
}
export function validBlueprintStateValue(type: BlueprintVariable['type'] | 'asset', value: unknown): value is VariableValue {
  return typeof value === (type === 'asset' ? 'string' : type) && (typeof value !== 'number' || Number.isFinite(value));
}
export function changeBlueprintVariable(project: Project, owner: BlueprintStateOwner, variable: BlueprintVariable, creating = false) {
  const variables = blueprintVariableOwner(project, owner), name = variable.name.trim();
  if (!name || name.length > 120 || variables.some(other => other.id !== variable.id && other.name === name)) throw new Error('请输入本作用域内未使用的变量名称，最多 120 字。');
  if (!validBlueprintStateValue(variable.type, variable.initial)) throw new Error('初始值与变量类型不匹配。');
  if (creating && (variables.length >= 128 || variables.some(other => other.id === variable.id))) throw new Error('变量数量已达上限或标识重复。');
  if (!creating && !variables.some(other => other.id === variable.id)) throw new Error('变量已不存在。');
  const next = { ...variable, name };
  storeVariables(project, owner, creating ? [...variables, next] : variables.map(other => other.id === variable.id ? next : other));
  return next;
}
export function createBlueprintVariable(project: Project, owner: BlueprintStateOwner, name: string, type: BlueprintVariable['type'], initial: VariableValue) {
  return changeBlueprintVariable(project, owner, { id: makeId('state'), name, type, initial }, true);
}
export function blueprintVariableUsages(project: Project, owner: BlueprintStateOwner, variableId: string) {
  return projectGraphs(project).flatMap(graph => graph.nodes.filter(node => {
    if (!['getVariable', 'setVariable'].includes(node.type) || node.properties.variableId !== variableId || blueprintStateScope(project, node) !== owner.scope) return false;
    return owner.scope === 'call' ? graph.id === owner.graphId : blueprintStatePageId(graph, node) === owner.pageId;
  }).map(node => ({ graphId: graph.id, graphName: graph.name, nodeId: node.id, nodeName: node.name })));
}
/** Keep dangling readers/writers and their wires visible for explicit repair. */
export function removeBlueprintVariable(project: Project, owner: BlueprintStateOwner, variableId: string) {
  storeVariables(project, owner, blueprintVariableOwner(project, owner).filter(variable => variable.id !== variableId));
}
