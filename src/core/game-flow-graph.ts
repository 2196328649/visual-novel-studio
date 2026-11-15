import { uiPage } from './ui-pages';
import { makeId, type Diagnostic, type Project } from './model';
import { projectGraphs } from './project-resources';
import { sameProjectValue } from './project-history';
import { gameFlowPhaseNames, gameFlowSchema, gameFlowStepSchema, type GameFlowPhase, type GameFlowStep } from './game-flow-schema';

// Namespaced canvas IDs cannot collide with authored story/step IDs.
export const flowNodeIds = { launch: 'flow:launch', title: 'flow:title', newGame: 'flow:newGame', load: 'flow:load', story: 'flow:story' } as const;
export const flowPhases = ['beforeTitle', 'beforeNewGame'] as const;
export const flowEntry = { beforeTitle: flowNodeIds.launch, beforeNewGame: flowNodeIds.newGame };
export const flowExit = { beforeTitle: flowNodeIds.title, beforeNewGame: flowNodeIds.story };
export const flowStepNodeId = (stepId: string) => 'flow:step:' + stepId;

export function gameFlow(project: Project) { return project.gameFlow ?? gameFlowSchema.parse({ schemaVersion: 1, beforeTitle: {} }); }
export function gameFlowSteps(project: Project, phase: GameFlowPhase) { const flow = gameFlow(project); return phase === 'beforeTitle' ? flow.beforeTitle.steps : flow.beforeNewGame; }
export function editGameFlowSteps(project: Project, phase: GameFlowPhase) { const flow = project.gameFlow ??= gameFlow(project); return phase === 'beforeTitle' ? flow.beforeTitle.steps : flow.beforeNewGame; }

export function findFlowStep(project: Project, nodeId: string) {
  for (const phase of flowPhases) {
    const step = gameFlowSteps(project, phase).find(s => flowStepNodeId(s.id) === nodeId);
    if (step) return { step, phase };
  }
}

export function flowSourcePhase(project: Project, nodeId: string): GameFlowPhase | undefined {
  if (nodeId === flowNodeIds.launch) return 'beforeTitle';
  if (nodeId === flowNodeIds.newGame) return 'beforeNewGame';
  return findFlowStep(project, nodeId)?.phase;
}

export function gameFlowConnections(project: Project): Record<string, string> {
  if (project.gameFlow?.connections !== undefined) return project.gameFlow.connections;
  const connections: Record<string, string> = {};
  for (const phase of flowPhases) {
    const path: string[] = [flowEntry[phase], ...gameFlowSteps(project, phase).map(step => flowStepNodeId(step.id)), flowExit[phase]];
    for (let i = 0; i < path.length - 1; i++) connections[path[i]] = path[i + 1];
  }
  return connections;
}

type FlowComponent = { nodes: Set<string>; phases: Set<GameFlowPhase> };

/** Only next wires establish lifecycle ownership. Page buttons, cancel and load
 * routes are navigation projections and must not merge the two lifecycles. */
function flowComponents(project: Project, connections: Record<string, string>) {
  const inventory = new Map(flowPhases.flatMap(phase => gameFlowSteps(project, phase).map(step => [flowStepNodeId(step.id), { step, phase }] as const)));
  const anchors = new Map<string, GameFlowPhase>(flowPhases.flatMap(phase => [[flowEntry[phase], phase], [flowExit[phase], phase]] as [string, GameFlowPhase][]));
  const neighbors = new Map([...inventory.keys(), ...anchors.keys()].map(id => [id, new Set<string>()]));
  for (const [source, target] of Object.entries(connections)) if (neighbors.has(source) && neighbors.has(target)) {
    neighbors.get(source)!.add(target); neighbors.get(target)!.add(source);
  }
  const byNode = new Map<string, FlowComponent>();
  for (const id of neighbors.keys()) {
    if (byNode.has(id)) continue;
    const component: FlowComponent = { nodes: new Set(), phases: new Set() }, pending = [id];
    while (pending.length) {
      const node = pending.pop()!; if (byNode.has(node)) continue;
      byNode.set(node, component); component.nodes.add(node);
      const phase = anchors.get(node); if (phase) component.phases.add(phase);
      pending.push(...neighbors.get(node)!);
    }
  }
  return { inventory, byNode };
}

const componentPhase = (component?: FlowComponent) => component?.phases.size === 1 ? [...component.phases][0] : undefined;
const phaseConnectionProblem = (phase: GameFlowPhase) => phase === 'beforeTitle'
  ? '启动内容需连接到同一入口的节点或标题菜单；新游戏从标题菜单进入。请先断开模块与原流程的连接，再接入另一条流程。'
  : '新游戏内容需连接到同一入口的节点或故事入口。请先断开模块与原流程的连接，再接入另一条流程。';

/** Detached modules have no execution phase. Storage is kept compatible with
 * older projects; a first connection to an entry or exit establishes ownership. */
export function gameFlowAttachments(project: Project): ReadonlyMap<string, GameFlowPhase> {
  const { byNode } = flowComponents(project, gameFlowConnections(project));
  return new Map([...byNode].flatMap(([id, component]) => { const phase = componentPhase(component); return phase ? [[id, phase] as const] : []; }));
}

function connectionProblem(project: Project, source: string, target: string, connections: Record<string, string>, topology = flowComponents(project, connections)): string | undefined {
  const phase = flowSourcePhase(project, source);
  if (!phase) return '此节点没有可编辑的流程出口。';
  if (!topology.inventory.has(target) && target !== flowNodeIds.title && target !== flowNodeIds.story) return phaseConnectionProblem(phase);
  const component = topology.byNode.get(source);
  if (component && component.phases.size > 1) return phaseConnectionProblem(phase);
  const visited = new Set([source]);
  let cursor: string | undefined = target;
  while (cursor) {
    if (visited.has(cursor)) return '这条连线会形成循环，流程将无法完成。';
    visited.add(cursor); cursor = connections[cursor];
  }
}

/** Simulate the complete edit before touching either inventory. Shared tails
 * include all incoming branches, so no orphan loses its parameters on migration. */
function planFlowConnection(project: Project, source: string, target?: string, previousSource?: string) {
  const before = gameFlowConnections(project), connections = { ...before };
  const phase = flowSourcePhase(project, source);
  if (!phase) return { problem: '此节点没有可编辑的流程出口。' };
  const original = flowComponents(project, before);
  const sourcePhase = componentPhase(original.byNode.get(source));
  const previousPhase = previousSource ? componentPhase(original.byNode.get(previousSource)) : undefined;
  if (previousSource && (!flowSourcePhase(project, previousSource) || previousPhase && sourcePhase && previousPhase !== sourcePhase)) return { problem: '不能把已有连线移到另一个生命周期入口，请分别编辑各自的连接。' };
  if (previousSource && previousSource !== source) delete connections[previousSource];
  if (target) connections[source] = target;
  else delete connections[source];
  const moves = new Map<string, GameFlowPhase>();
  // Disconnect remains available even when another existing edge is invalid.
  if (!target) return { connections, moves };
  const topology = flowComponents(project, connections), component = topology.byNode.get(source)!;
  const problem = connectionProblem(project, source, target, connections, topology);
  if (problem) return { problem };
  const destination = componentPhase(component);
  if (destination) {
    for (const id of component.nodes) {
      const item = topology.inventory.get(id); if (!item) continue;
      const previous = componentPhase(original.byNode.get(id));
      if (previous && previous !== destination) return { problem: phaseConnectionProblem(previous) };
      if (item.phase !== destination) moves.set(id, destination);
    }
    for (const p of flowPhases) {
      const count = [...topology.inventory].filter(([id, item]) => (moves.get(id) ?? item.phase) === p).length;
      if (count > 64) return { problem: `${gameFlowPhaseNames[p]}最多容纳 64 个模块（包括未连接模块），请先移除不需要的模块。` };
    }
  }
  return { connections, moves };
}

/** Read-only counterpart used for drag feedback, sharing the transaction's topology rules. */
export function gameFlowConnectionProblem(project: Project, source: string, target: string, previousSource?: string): string | undefined {
  return planFlowConnection(project, source, target, previousSource).problem;
}

/** Validate the proposed graph before mutating it, including source-end reconnects. */
export function connectGameFlowNodes(project: Project, source: string, target?: string, previousSource?: string) {
  const plan = planFlowConnection(project, source, target, previousSource);
  if (plan.problem) throw new Error(plan.problem);
  if (!plan.connections || !plan.moves || sameProjectValue(gameFlowConnections(project), plan.connections)) return;
  const flow = project.gameFlow ??= gameFlow(project);
  if (plan.moves.size) {
    const items = flowPhases.flatMap(phase => gameFlowSteps(project, phase).map(step => ({ step, phase })));
    flow.beforeTitle.steps = items.filter(item => (plan.moves!.get(flowStepNodeId(item.step.id)) ?? item.phase) === 'beforeTitle').map(item => item.step);
    flow.beforeNewGame = items.filter(item => (plan.moves!.get(flowStepNodeId(item.step.id)) ?? item.phase) === 'beforeNewGame').map(item => item.step);
  }
  flow.connections = plan.connections;
}

/** Only the reachable, connected path executes. Inventory order is not execution order. */
export function gameFlowRoute(project: Project, phase: GameFlowPhase) {
  const connections = gameFlowConnections(project);
  const inventory = new Map(gameFlowSteps(project, phase).map(step => [flowStepNodeId(step.id), step]));
  const visited = new Set<string>(), steps: GameFlowStep[] = [];
  let source: string = flowEntry[phase];
  while (!visited.has(source)) {
    visited.add(source);
    const target = connections[source];
    if (target === flowExit[phase]) return { steps, complete: true, stoppedAt: source };
    const step = inventory.get(target);
    if (!step || visited.has(target)) break;
    steps.push(step); source = target;
  }
  return { steps, complete: false, stoppedAt: source };
}

export function flowNodeName(project: Project, nodeId: string): string {
  if (nodeId === flowNodeIds.launch) return '游戏启动';
  if (nodeId === flowNodeIds.title) return '标题菜单';
  if (nodeId === flowNodeIds.newGame) return '新游戏';
  if (nodeId === flowNodeIds.load) return '读取存档';
  if (nodeId === flowNodeIds.story) return '故事入口 · ' + (project.nodes.find(n => n.id === project.entryId)?.name ?? '已不存在');
  const found = findFlowStep(project, nodeId);
  if (!found) return '已不存在的节点';
  const { step } = found;
  if (step.name) return step.name;
  if (step.kind === 'page') return uiPage(project, step.pageId)?.name ?? '页面已不存在';
  if (step.kind === 'video') return project.assets.find(a => a.id === step.assetId)?.name ?? '视频已不存在';
  return projectGraphs(project).find(g => g.id === step.graphId)?.name ?? '蓝图演出';
}

function newFlowStep(project: Project, input: Partial<GameFlowStep> & { kind: GameFlowStep['kind'] }) {
  const step = gameFlowStepSchema.parse({ ...(input.kind === 'page' && input.wait === undefined && input.modal === undefined ? { opening: {} } : {}), ...input, id: input.id ?? makeId('flow_step') });
  if (flowPhases.some(p => gameFlowSteps(project, p).some(s => s.id === step.id))) throw new Error('流程节点标识重复。');
  return step;
}

/** Normal canvas creation never changes an existing route, even in legacy
 * projects where execution order was previously inferred from inventory order. */
export function createGameFlowStep(project: Project, input: Partial<GameFlowStep> & { kind: GameFlowStep['kind'] }) {
  const phase = flowPhases.find(p => gameFlowSteps(project, p).length < 64);
  if (!phase) throw new Error('游戏流程最多容纳 128 个模块，请先移除不需要的模块。');
  const step = newFlowStep(project, input), connections = { ...gameFlowConnections(project) };
  editGameFlowSteps(project, phase).push(step);
  project.gameFlow!.connections = connections;
  return step;
}

/** Explicit insertion is separate from normal creation and splices one outlet. */
export function addGameFlowStep(project: Project, phase: GameFlowPhase, input: Partial<GameFlowStep> & { kind: GameFlowStep['kind'] }, afterNodeId?: string) {
  if (gameFlowSteps(project, phase).length >= 64) throw new Error('每条游戏流程最多 64 个模块（包括未连接模块）。');
  const step = newFlowStep(project, input);
  const route = gameFlowRoute(project, phase);
  if (!afterNodeId && !route.complete) throw new Error('这条流程尚未连接到完成出口，请先修复连线，或在模块右键菜单选择“在此出口插入”。');
  const after = afterNodeId ?? (route.steps.length ? flowStepNodeId(route.steps.at(-1)!.id) : flowEntry[phase]);
  if (flowSourcePhase(project, after) !== phase) throw new Error('插入位置不属于这条流程。');
  const connections = { ...gameFlowConnections(project) }, oldNext = connections[after];
  editGameFlowSteps(project, phase).push(step);
  connections[after] = flowStepNodeId(step.id);
  if (oldNext) connections[flowStepNodeId(step.id)] = oldNext;
  project.gameFlow!.connections = connections;
  return step;
}

/** Deleting a node splices its predecessors to its continuation; disconnect keeps the node. */
export function removeGameFlowStep(project: Project, nodeId: string) {
  const found = findFlowStep(project, nodeId); if (!found) return;
  const connections = { ...gameFlowConnections(project) }, next = connections[nodeId];
  for (const [source, target] of Object.entries(connections)) if (target === nodeId) {
    if (next && next !== nodeId) connections[source] = next;
    else delete connections[source];
  }
  delete connections[nodeId];
  const steps = editGameFlowSteps(project, found.phase);
  steps.splice(steps.findIndex(s => s.id === found.step.id), 1);
  project.gameFlow!.connections = connections;
  if (project.gameFlow!.positions) delete project.gameFlow!.positions[nodeId];
  if (project.gameFlow!.transitions) {
    delete project.gameFlow!.transitions[nodeId];
    if (!Object.keys(project.gameFlow!.transitions).length) delete project.gameFlow!.transitions;
  }
}

export function gameFlowTopologyDiagnostics(project: Project): Diagnostic[] {
  const issues: Diagnostic[] = [], connections = gameFlowConnections(project), topology = flowComponents(project, connections);
  const issue = (phase: GameFlowPhase, nodeId: string, message: string, severity: Diagnostic['severity'] = 'error') => issues.push({
    severity, code: 'gameFlow.connections', message: gameFlowPhaseNames[phase] + '：' + message,
    gameFlow: { phase, stepId: findFlowStep(project, nodeId)?.step.id },
  });
  for (const [source, target] of Object.entries(connections)) {
    const problem = connectionProblem(project, source, target, connections, topology);
    if (problem) issue(flowSourcePhase(project, source) ?? 'beforeTitle', source, problem);
  }
  for (const [id, item] of topology.inventory) {
    const phase = componentPhase(topology.byNode.get(id));
    if (phase && phase !== item.phase) issue(item.phase, id, '模块与已连接入口的归属不一致，请先断开该连线，再重新接入。');
  }
  for (const phase of flowPhases) {
    const route = gameFlowRoute(project, phase), reachable = new Set(route.steps.map(step => step.id));
    if (!route.complete) issue(phase, route.stoppedAt, `未连接到${flowNodeName(project, flowExit[phase])}，请补上完成连线。`);
    for (const step of gameFlowSteps(project, phase)) if (!reachable.has(step.id)) issue(phase, flowStepNodeId(step.id), `“${flowNodeName(project, flowStepNodeId(step.id))}”尚未接入入口，不会执行。`, 'warning');
  }
  return issues;
}
