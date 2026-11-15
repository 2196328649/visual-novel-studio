import { blueprintTaskCatalog } from './blueprint-task-catalog';
export { blueprintTaskCatalog } from './blueprint-task-catalog';
import { visitBlueprintOperationClosure } from './blueprint-operation-closure';
import type { BlueprintGraph, BlueprintNode, BlueprintPin, Project } from './model';
import { projectGraphs } from './project-resources';

export type BlueprintTaskNodeType = keyof typeof blueprintTaskCatalog;
export type BlueprintTaskScope = 'call' | 'page';
export type BlueprintTaskConflict = 'parallel' | 'replace' | 'ignore';
export type BlueprintTaskStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'cancelled' | 'failed' | 'missing';
export const blueprintTaskStatusNames: Record<BlueprintTaskStatus, string> = { queued: '等待启动', running: '执行中', waiting: '等待中', completed: '已完成', cancelled: '已取消', failed: '执行失败', missing: '标识失效' };
export type BlueprintTaskCompletion = { status: BlueprintTaskStatus; reason: string; graphId?: string; outputs: Record<string, import('./model').VariableValue> };
export const blueprintTaskVersion = 1;
export const blueprintTaskActiveLimit = 256;
export const blueprintTaskResultLimit = 512;
export function isBlueprintTaskNode(type: string): type is BlueprintTaskNodeType { return Object.hasOwn(blueprintTaskCatalog, type); }
export function isBlueprintTaskLaunch(type: string): type is 'startTask' | 'debounce' { return type === 'startTask' || type === 'debounce'; }
export function isBlueprintModuleReference(type: string): boolean { return ['callFunction', 'callMacro', 'startTask', 'debounce', 'waitTask'].includes(type); }
export function isBlueprintModuleCall(type: string): boolean { return ['callFunction', 'callMacro', 'startTask', 'debounce'].includes(type); }
export function blueprintTaskScope(node: Pick<BlueprintNode, 'properties'>): BlueprintTaskScope { return node.properties.scope === 'page' ? 'page' : 'call'; }
export function blueprintTaskPageId(graph: Pick<BlueprintGraph, 'uiPageId'>, node: Pick<BlueprintNode, 'properties'>): string { return String(node.properties.pageId ?? graph.uiPageId ?? ''); }
export function validBlueprintTaskValue(type: BlueprintPin['dataType'], value: unknown): boolean {
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'any') return typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value);
  return type !== 'exec' && typeof value === 'string';
}
export function blueprintTaskFinished(status: BlueprintTaskStatus): boolean { return ['completed', 'cancelled', 'failed', 'missing'].includes(status); }
export function blueprintTaskPins(node: BlueprintNode, graph?: BlueprintGraph): BlueprintPin[] {
  const pin = (id: string, name: string, direction: BlueprintPin['direction'], dataType: BlueprintPin['dataType'] = 'exec', defaultValue?: import('./model').VariableValue): BlueprintPin => ({ id, name, direction, dataType, required: false, ...(defaultValue === undefined ? {} : { defaultValue }) });
  const inputs = [pin('exec_in', '执行', 'input')], handle = pin('handle', '任务标识', 'input', 'string', '');
  if (node.type === 'taskStatus') return [handle, pin('status', '状态', 'output', 'string', 'missing'), pin('reason', '原因', 'output', 'string', 'missing')];
  if (node.type === 'cancelTask') return [...inputs, handle, pin('exec_out', '继续', 'output'), pin('cancelled', '本次已取消', 'output', 'boolean', false)];
  if (node.type === 'waitTask') return [...inputs, handle, ...['completed', 'cancelled', 'failed', 'missing'].map((id, index) => pin(id, ['已完成', '已取消', '执行失败', '标识失效'][index], 'output')), pin('reason', '原因', 'output', 'string', ''), ...(graph?.exposedOutputs ?? []).map(p => ({ ...p, id: 'out_' + p.id, direction: 'output' as const }))];
  const page = blueprintTaskScope(node) === 'page' ? [pin('pageId', '所属页面', 'input', 'ui', blueprintTaskPageId({ }, node))] : [];
  if (node.type === 'throttle') return [...inputs, pin('reset', '重置', 'input'), ...page, pin('seconds', '冷却秒数', 'input', 'number', .3), pin('exec_out', '通过', 'output'), pin('blocked', '被节流', 'output'), pin('updated', '重置完成', 'output')];
  return [...inputs, ...page, pin('seconds', node.type === 'debounce' ? '安静秒数' : '延后秒数', 'input', 'number', node.type === 'debounce' ? .3 : 0), ...(graph?.exposedInputs ?? []).map(p => ({ ...p, id: 'arg_' + p.id, direction: 'input' as const })), pin('exec_out', '已安排', 'output'), pin('blocked', '已有任务／达到上限', 'output'), pin('handle', '任务标识', 'output', 'string', '')];
}

/** Leading edge only; zero never extends a previous cooldown. No wall time is stored. */
export function transitionBlueprintThrottle(entry: string, until: number | undefined, now: number, seconds: unknown): { until?: number; output: 'exec_out' | 'blocked' | 'updated' } | undefined {
  if (!Number.isFinite(now) || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return;
  if (entry === 'reset') return { output: 'updated' };
  if (entry !== 'exec_in') return;
  if (until !== undefined && now < until) return { until, output: 'blocked' };
  return { until: now + seconds, output: 'exec_out' };
}

// These operations never enter a nested Ren'Py interaction. Cooperative waits,
// animations and module calls are serialized continuations, not Python threads.
const taskActions = new Set<BlueprintNode['type']>(['event', 'return', 'sequence', 'branch', 'switchValue', 'doOnce', 'gate', 'throttle', 'delay', 'forLoop', 'callFunction', 'callMacro', 'setVariable', 'setOutput', 'setPageOutput', 'editUiControlOptions', 'focusUiComponent', 'setUiControlRange', 'resetUiControlRange', 'setUiProperty', 'resetUiProperty', 'resetUiComponent', 'animateUiProperty', 'playUiAnimation', 'stopUiAnimation', 'stopUiAnimationPlayback', 'setPlayerPreference', 'playSound', 'playMusic', 'stopMusic', 'playUiVideo', 'pauseUiVideo', 'stopUiVideo', 'playSpine', 'pauseSpine', 'setSpineSpeed', 'startTask', 'debounce', 'cancelTask', 'waitTask']);
export function blueprintTaskOperationSupported(node: BlueprintNode): boolean { return node.pins.every(pin => pin.dataType !== 'exec') || taskActions.has(node.type); }
export interface BlueprintTaskProblem { graphId: string; nodeId?: string; message: string }
/** Audit only executable paths and actually evaluated data dependencies. */
export function blueprintTaskProblems(project: Project, graphId: string): BlueprintTaskProblem[] {
  const graph = projectGraphs(project).find(graph => graph.id === graphId);
  if (!graph) return [{ graphId, message: '任务模块已不存在。' }];
  const problems: BlueprintTaskProblem[] = [], reported = new Set<string>();
  const add = (problem: BlueprintTaskProblem) => { const key = JSON.stringify(problem); if (!reported.has(key)) { reported.add(key); problems.push(problem); } };
  const closure = visitBlueprintOperationClosure(project, graph, graph.nodes.find(node => node.type === 'event'), (owner, node) => {
    if (!blueprintTaskOperationSupported(node)) add({ graphId: owner.id, nodeId: node.id, message: '“' + node.name + '”需要前台交互或剧情栈，不能在后台任务内执行；请把导航、对话或场景切换放在等待任务之后。' });
  }, { followTasks: true, onGraph: owner => { if (owner.timeline) add({ graphId: owner.id, message: '时间轴演出不能作为后台任务模块；请从普通执行路线调用。' }); } });
  for (const problem of closure) add({ graphId: problem.graphId, nodeId: problem.nodeId, message: problem.kind === 'recursion' ? '后台任务不支持递归调用或递归启动自身；请使用定时事件或有界循环。' : problem.kind === 'missingModule' ? '任务调用的模块已不存在。' : problem.kind === 'missingEntry' ? '任务模块缺少主调用入口。' : '后台任务的静态检查达到上下文上限，尚不能确认所有路线安全；请拆分模块。' });
  return problems;
}
