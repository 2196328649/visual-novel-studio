import type { Diagnostic, Project } from './model';
import { flowTransitionSchema, type FlowTransition } from './flow-transition-schema';
import { findFlowStep, flowEntry, flowExit, flowNodeIds, flowNodeName, flowSourcePhase, flowStepNodeId, gameFlow, gameFlowConnectionProblem, gameFlowConnections, gameFlowRoute } from './game-flow-graph';
import { gameFlowPhaseNames, type GameFlowPhase } from './game-flow-schema';
import { sameProjectValue } from './project-history';

export type GameFlowTransitionSupport =
  | { supported: true; phase: GameFlowPhase; target?: string; inactiveReason?: string }
  | { supported: false; reason: string };

/** Only the authored next outlet can carry a lifecycle transition. Menu buttons,
 * saved-position restores and dynamic returns retain their own navigation rules. */
export function gameFlowTransitionSupport(project: Project, source: string, port = 'next'): GameFlowTransitionSupport {
  if (source === flowNodeIds.load || port === 'restore') return { supported: false, reason: '读档成功后恢复存档中的位置与画面，不经过固定的流程出口。' };
  if (port === 'returnTitle' || source === flowNodeIds.story) return { supported: false, reason: '游戏内容返回标题由实际剧情决定。此导航线没有独立的继续出口。' };
  if (port === 'cancel') return { supported: false, reason: '取消后进入标题使用页面的取消行为；“继续”过渡只在沿完成连线继续时播放。' };
  if (source === flowNodeIds.title || source.startsWith('flow:page-events:') || port.startsWith('button:') || port.startsWith('native:')) {
    return { supported: false, reason: '这条线来自菜单按钮。请在原按钮或事件图中编辑页面的打开与关闭行为。' };
  }
  if (port !== 'next') return { supported: false, reason: '此出口不是启动流程的“继续”出口。' };
  const phase = flowSourcePhase(project, source);
  if (!phase) return { supported: false, reason: '来源流程节点已不存在，或不是游戏启动、新游戏和页面、视频、蓝图演出步骤。' };
  const connections = gameFlowConnections(project);
  const target = Object.hasOwn(connections, source) ? connections[source] : undefined;
  if (!target) return { supported: true, phase, inactiveReason: '继续出口尚未连接，过渡已保留。' };
  if (target !== flowExit[phase] && !findFlowStep(project, target)) return { supported: true, phase, target, inactiveReason: '目标流程节点已不存在，过渡已保留。' };
  const problem = gameFlowConnectionProblem(project, source, target);
  if (problem) return { supported: true, phase, target, inactiveReason: problem };
  if (source !== flowEntry[phase] && !gameFlowRoute(project, phase).steps.some(step => source === flowStepNodeId(step.id))) {
    return { supported: true, phase, target, inactiveReason: '来源步骤尚未接入入口，不会执行这条过渡。' };
  }
  return { supported: true, phase, target };
}

/** Reads the saved source setting, even while disconnected. Runtime consumers
 * must still follow the actual route; absence never creates a default override. */
export function gameFlowTransition(project: Project, source: string): FlowTransition | undefined {
  const transitions = project.gameFlow?.transitions;
  return transitions && Object.hasOwn(transitions, source) ? transitions[source] : undefined;
}

/** Validate before mutation. Repeated edits create no history; explicit removal
 * also repairs obsolete source records without inventing an executable outlet. */
export function setGameFlowTransition(project: Project, source: string, transition: FlowTransition | undefined): boolean {
  let parsed: FlowTransition | undefined;
  if (transition !== undefined) {
    const support = gameFlowTransitionSupport(project, source);
    if (!support.supported) throw new Error(support.reason);
    const result = flowTransitionSchema.safeParse(transition);
    if (!result.success) throw new Error('连线过渡无效：时长必须是不小于 0 的有限数值，纯色必须使用六位颜色。');
    parsed = result.data;
  }
  if (sameProjectValue(gameFlowTransition(project, source), parsed)) return false;
  const transitions = { ...project.gameFlow?.transitions };
  if (parsed === undefined) delete transitions[source];
  else transitions[source] = parsed;
  const flow = project.gameFlow ??= gameFlow(project);
  if (Object.keys(transitions).length) flow.transitions = transitions;
  else delete flow.transitions;
  return true;
}

export function gameFlowTransitionDiagnostics(project: Project): Diagnostic[] {
  const issues: Diagnostic[] = [];
  for (const [source, transition] of Object.entries(project.gameFlow?.transitions ?? {})) {
    const step = findFlowStep(project, source), phase = flowSourcePhase(project, source) ?? 'beforeTitle';
    const name = step || source === flowEntry[phase] ? flowNodeName(project, source) : source;
    const location = { phase, ...(step ? { stepId: step.step.id } : {}) };
    if (!flowTransitionSchema.safeParse(transition).success) {
      issues.push({ severity: 'error', code: 'gameFlow.transition.value', gameFlow: location,
        message: `${gameFlowPhaseNames[phase]}：“${name}”的连线过渡设置无效。`,
        help: '过渡时长必须是有限的非负数，纯色过渡需要六位颜色。请在连线属性中重新设置。' });
      continue;
    }
    const support = gameFlowTransitionSupport(project, source);
    if (!support.supported || support.inactiveReason) {
      issues.push({ severity: 'warning', code: support.supported ? 'gameFlow.transition.inactive' : 'gameFlow.transition.source', gameFlow: location,
        message: `${gameFlowPhaseNames[phase]}：“${name}”保留的过渡暂不执行。${support.supported ? support.inactiveReason : support.reason}`,
        help: '配置属于来源的继续出口。重新接入有效流程后会继续使用，也可在未启用的过渡中移除。' });
    }
  }
  return issues;
}
