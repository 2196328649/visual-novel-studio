import { editableUiComponent, effectiveUiTheme, type BlueprintGraph, type BlueprintNode, type Condition, type Project, type UiComponent } from './model';
import { uiPage, uiPages } from './ui-pages';
import { uiActionPages, uiMenuButtons } from './ui-page-catalog';
import { uiActionAvailable } from './ui-availability';
import { materializeMainButton, nativeMainButtons } from './ui-native-main';
import { uiClickHandlers, uiPageComponents } from './ui-logic';
import { projectGraphs } from './project-resources';
import { blueprintUsages } from './blueprint-usages';
import { setBlueprintPageOpening, uiPageOpeningProblem, type UiPageOpening } from './ui-page-opening';
import { createPageCall } from './game-flow';
import { synchronizeBlueprintSignatures } from './blueprint';
import { createUiFlowRouteAnalyzer, type UiFlowRouteAnalysis, type UiFlowRoutePath, type UiFlowRouteStep } from './ui-flow-route-explanation';

export { uiFlowEventRouteSummary, uiFlowRouteBadges, uiFlowRouteOpeningSummary } from './ui-flow-route-explanation';
export type { UiFlowRouteAnalysis, UiFlowRoutePath, UiFlowRouteStep } from './ui-flow-route-explanation';

export type UiFlowTarget = { kind: 'page'; pageId: string; saveMode?: 'save' | 'load' }
  | { kind: 'system'; action: 'start' | 'mainMenu' | 'quit' | 'return'; reason?: string }
  | { kind: 'logic'; graphId: string; nodeId?: string; dynamic?: boolean };
export interface UiFlowRoute {
  target: UiFlowTarget; label: string; graphId?: string; nodeId?: string; opening?: UiPageOpening;
  /** Read-only provenance, never stored as another execution graph. */
  paths?: UiFlowRoutePath[]; pathsLimited?: boolean;
}
export interface UiFlowEvent {
  id: string; pageId: string; name: string; componentId?: string; nativeSlot?: string;
  routes: UiFlowRoute[]; editable: boolean; problem?: string;
  disabled?: boolean; unavailable?: boolean; visibleWhen?: Condition; enabledWhen?: Condition;
  routeAnalysis?: UiFlowRouteAnalysis;
  /** Exact single-use open node when the button already calls a simple page wrapper. */
  call?: { graphId: string; nodeId: string };
}
export function uiFlowEventStatus(event: UiFlowEvent): string {
  return [event.disabled && '已禁用', event.unavailable && '目标已停用', event.visibleWhen && '有显示条件', event.enabledWhen && '有启用条件'].filter(Boolean).join(' · ');
}
export function uiFlowTargetKey(target: UiFlowTarget): string {
  return target.kind === 'page' ? 'page:' + target.pageId + ':' + (target.saveMode ?? 'load')
    : target.kind === 'system' ? 'system:' + target.action : 'logic:' + target.graphId + ':' + (target.nodeId ?? '');
}
export function uiFlowTargetName(project: Project, target: UiFlowTarget) {
  if (target.kind === 'page') return target.pageId === 'ui:save' ? target.saveMode === 'save' ? '保存游戏' : '读取存档' : uiPage(project, target.pageId)?.name ?? '页面已不存在';
  if (target.kind === 'system') return ({ start: '开始新游戏', mainMenu: '返回标题', quit: '退出游戏', return: '关闭并返回打开处' })[target.action];
  return (target.dynamic ? '运行时决定 · ' : '执行事件 · ') + (projectGraphs(project).find(g => g.id === target.graphId)?.name ?? '蓝图已不存在');
}
function actionTarget(action: UiComponent['action']): UiFlowTarget | undefined {
  if (action && ['start', 'mainMenu', 'quit', 'return'].includes(action)) return { kind: 'system', action: action as Extract<UiFlowTarget, { kind: 'system' }>['action'] };
  const page = action && uiActionPages[action];
  if (page) return { kind: 'page', pageId: 'ui:' + page, ...(action === 'save' || action === 'load' ? { saveMode: action } : {}) };
}

function simplePageCall(project: Project, graph: BlueprintGraph | undefined): BlueprintNode | undefined {
  if (!graph || graph.uiPageId || graph.nodes.some(n => !['event', 'showUiPage', 'setOutput', 'getInput', 'comment'].includes(n.type))) return;
  const opens = graph.nodes.filter(n => n.type === 'showUiPage'), events = graph.nodes.filter(n => n.type === 'event');
  if (opens.length !== 1 || events.length !== 1 || graph.links.some(l => l.toNodeId === opens[0].id && !['exec_in'].includes(l.toPinId))) return;
  if (!graph.links.some(l => l.fromNodeId === events[0].id && l.fromPinId === 'exec' && l.toNodeId === opens[0].id)) return;
  if (blueprintUsages(project, graph.id).length !== 1) return;
  return opens[0];
}

export function uiPageFlowEvents(project: Project, pageId: string): UiFlowEvent[] {
  const components = uiPageComponents(project, pageId), native = pageId === 'ui:main' ? nativeMainButtons(project, components) : [];
  const graphs = projectGraphs(project), theme = effectiveUiTheme(project.ui), result: UiFlowEvent[] = [], analyzeRoutes = createUiFlowRouteAnalyzer(project);
  for (const component of [...components, ...native]) {
    if (component.kind !== 'button' || component.flowEvent?.visible === false) continue;
    // Authors can explicitly expose a disabled button that will be enabled by page logic.
    if (component.disabled && component.flowEvent?.visible !== true) continue;
    const handlers = uiClickHandlers(project, pageId, component.id), primary = actionTarget(component.action);
    const stages = handlers.length + Number(!!primary);
    const analyzed = handlers.map((handler, index) => {
      const graph = graphs.find(graph => graph.id === handler.graphId);
      const label = ({ beforeClick: '点击前接入', event: '点击事件', callback: '绑定的点击事件', action: '按钮调用' })[handler.source];
      const trigger: UiFlowRouteStep = { kind: 'trigger', label: (stages > 1 ? '点击处理 ' + (index + 1) + ' · ' : '') + label + ' · ' + (graph?.name ?? '蓝图已不存在'), graphId: handler.graphId, nodeId: handler.nodeId ?? graph?.nodes.find(node => node.type === 'event')?.id, ...(stages > 1 ? { order: index + 1 } : {}) };
      return analyzeRoutes(handler.graphId, handler.nodeId, trigger);
    });
    const routes = analyzed.flatMap(item => item.routes);
    const limited = analyzed.some(item => item.analysis.limited);
    if (primary) routes.push({ target: primary, label: '点击主操作', paths: [{ steps: [{ kind: 'trigger', label: handlers.length ? '前面的点击处理完成且按钮仍可用后，执行预设主操作' : '点击按钮，执行预设主操作' }], sequential: handlers.length > 0 }] });
    if (!routes.length && !component.flowEvent?.visible && !limited) continue;
    if (!routes.length && handlers.length) routes.push({ target: { kind: 'logic', graphId: handlers[0].graphId, nodeId: handlers[0].nodeId }, label: '点击事件' });
    const graph = handlers.length === 1 && handlers[0].source === 'action' ? graphs.find(g => g.id === handlers[0].graphId) : undefined;
    const call = simplePageCall(project, graph);
    const otherEvents = graphs.some(g => g.nodes.some(n => n.type === 'eventButton' && n.properties.componentId === component.id));
    const editable = (!handlers.length && (!component.action || !!primary) || !!call) && !otherEvents;
    result.push({ id: 'button:' + (component.nativeSlot ?? component.id), pageId, name: component.flowEvent?.name || component.name || component.text || '按钮',
      componentId: native.includes(component) ? undefined : component.id, nativeSlot: component.nativeSlot, routes, editable, routeAnalysis: { limited },
      disabled: component.disabled, unavailable: !!component.action && !uiActionAvailable(theme, component.action),
      visibleWhen: component.visibleWhen, enabledWhen: component.enabledWhen,
      problem: editable ? undefined : '此按钮包含事件、参数或共享调用。请进入原事件图编辑，保留已有逻辑。',
      ...(call && graph ? { call: { graphId: graph.id, nodeId: call.id } } : {}) });
  }
  // Shared engine navigation is visible as a system event, never a fake editable wire.
  const page = uiPage(project, pageId);
  if (page?.menuScreen && !page.disabled && theme.pages?.[page.kind]?.layout !== 'custom') {
    for (const [action, name] of [...uiMenuButtons, ['return', '返回'] as const]) {
      if (!uiActionAvailable(theme, action)) continue;
      const target = action === 'return' && pageId === 'ui:voiceSettings' ? { kind: 'page' as const, pageId: 'ui:preferences' } : actionTarget(action);
      if (target) result.push({ id: 'native:' + action, pageId, name: name + ' · 系统导航', editable: false, problem: '这是系统菜单的共享导航。可在页面设计中关闭系统默认内容并使用自己的按钮。', routes: [{ target, label: '系统导航' }] });
    }
  }
  return result;
}

export function uiFlowTargets(project: Project, sourcePageId: string): UiFlowTarget[] {
  return [
    ...uiPages(project).filter(p => !p.disabled && !p.openProblem && p.id !== sourcePageId).flatMap(p => p.id === 'ui:save'
      ? (sourcePageId === 'ui:main' ? [{ kind: 'page' as const, pageId: p.id, saveMode: 'load' as const }] : [{ kind: 'page' as const, pageId: p.id, saveMode: 'load' as const }, { kind: 'page' as const, pageId: p.id, saveMode: 'save' as const }])
      : [{ kind: 'page' as const, pageId: p.id }]),
    ...(['start', 'mainMenu', 'quit', 'return'] as const).map(action => ({ kind: 'system' as const, action })),
  ];
}

/** Edits the actual button / its unique simple call, never a second flow routing table.
 * Omitted opening leaves an existing call alone; {} explicitly restores page defaults. */
export function setUiFlowTarget(project: Project, pageId: string, eventId: string, target?: UiFlowTarget, opening?: UiPageOpening) {
  const event = uiPageFlowEvents(project, pageId).find(e => e.id === eventId);
  if (!event?.editable) throw new Error(event?.problem ?? '这个页面事件已不存在。');
  if (target?.kind === 'logic') throw new Error('复杂逻辑请在原事件图中编辑。');
  if (target && !uiFlowTargets(project, pageId).some(t => uiFlowTargetKey(t) === uiFlowTargetKey(target))) throw new Error('此目标不可用，可能已停用或需要游戏上下文。');
  if (target && opening === undefined && event.routes.length === 1 && uiFlowTargetKey(event.routes[0].target) === uiFlowTargetKey(target)) return;
  if (target?.kind === 'page' && opening !== undefined) {
    const problem = uiPageOpeningProblem(project, target.pageId, opening);
    if (problem) throw new Error(problem);
  }
  const component = event.componentId ? pageId.startsWith('ui:') ? editableUiComponent(project.ui, event.componentId) : project.ui.customPages.find(p => p.id === pageId)?.components.find(c => c.id === event.componentId)
    : event.nativeSlot ? materializeMainButton(project, event.nativeSlot) : undefined;
  if (!component) throw new Error('按钮已不存在或当前方案的控件数量已达上限。');
  component.flowEvent = { ...component.flowEvent, visible: true };
  if (target?.kind === 'page') {
    if (event.call && event.routes.length === 1 && event.routes[0].target.kind === 'page' && event.routes[0].target.pageId === target.pageId) {
      const graph = projectGraphs(project).find(g => g.id === event.call!.graphId)!, node = graph.nodes.find(n => n.id === event.call!.nodeId)!;
      node.properties.saveMode = target.saveMode ?? 'load';
      if (opening !== undefined) setBlueprintPageOpening(node, opening);
    } else {
      const graph = createPageCall(project, target.pageId, undefined, undefined, { saveMode: target.saveMode, opening: opening ?? {} });
      component.action = 'blueprint'; component.blueprintId = graph.id;
    }
  } else { component.action = target?.action; delete component.blueprintId; }
  synchronizeBlueprintSignatures(project);
}
