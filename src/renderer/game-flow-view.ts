import type { Project } from '../core/model';
import { flowNodeIds, flowNodeName, flowPhases, flowStepNodeId, gameFlow, gameFlowConnections, gameFlowSteps, gameFlowRoute } from '../core/game-flow-graph';
import { gameFlowTransitionSupport } from '../core/game-flow-transitions';
import { storyNodeReturnsTitle } from '../core/story-graph';
import { gameFlowRepeatNames, type GameFlowPhase, type GameFlowStep } from '../core/game-flow-schema';
import { projectGraphs } from '../core/project-resources';
import { uiPageFlowEvents, uiFlowEventStatus, uiFlowTargetKey, uiFlowTargetName, uiFlowRouteOpeningSummary, type UiFlowEvent, type UiFlowTarget, type UiFlowRoute } from '../core/ui-page-flow';
import { flowPageOpening, resolveUiPageOpening, uiPageOpeningSummary } from '../core/ui-page-opening';
import { uiPage } from '../core/ui-pages';

export interface GameFlowCanvasNode {
  id: string;
  kind: 'launch' | 'title' | 'newGame' | 'load' | 'storyPortal' | 'pageEvents' | 'pageReference' | 'system' | 'logic' | GameFlowStep['kind'];
  name: string;
  detail: string;
  position: { x: number; y: number };
  phase?: GameFlowPhase;
  step?: GameFlowStep;
  pageId?: string;
  target?: UiFlowTarget;
  event?: UiFlowEvent;
  eventPageId?: string;
  events?: UiFlowEvent[];
  inputEditable: boolean;
  ports: { id: string; label: string; editable: boolean; hint?: string }[];
}

export interface GameFlowCanvasEdge {
  id: string; source: string; target: string; sourceHandle: string; targetHandle?: string; label: string; caption?: string; readonly: boolean;
  gameFlowSource?: string;
  pageEvent?: { pageId: string; eventId: string };
}

export const pageFlowNodeId = (pageId: string) => 'flow:page-events:' + pageId;
const eventTargetId = (source: string, event: UiFlowEvent, route: number) => source + ':' + event.id + ':target:' + route;
function targetCard(project: Project, id: string, target: UiFlowTarget, position: { x: number; y: number }, event?: UiFlowEvent, opening?: Parameters<typeof resolveUiPageOpening>[2], route?: UiFlowRoute): GameFlowCanvasNode {
  const detail = target.kind === 'page' ? (route && uiFlowRouteOpeningSummary(project, route)) ?? uiPageOpeningSummary(resolveUiPageOpening(project, target.pageId, opening))
    : target.kind === 'logic' ? '双击进入原事件图' : target.action === 'return' ? '返回位置由打开者决定' : target.action === 'start' ? '重置本局状态，再执行新游戏流程' : target.action === 'mainMenu' ? '结束当前游戏并进入标题' : '系统确认后退出';
  return { id, kind: target.kind === 'page' ? 'pageReference' : target.kind, name: uiFlowTargetName(project, target), detail,
    position, inputEditable: target.kind !== 'logic', ports: [], target, event, ...(target.kind === 'page' ? { pageId: target.pageId } : {}) };
}
function eventPorts(events: UiFlowEvent[]) {
  return events.map(event => {
    const status = uiFlowEventStatus(event);
    return { id: event.id, label: event.name + (status ? ' · ' + status : ''), editable: event.editable,
      hint: [status, event.problem ?? '拖动出口修改此按钮的主操作'].filter(Boolean).join('。') };
  });
}

/** A page's public events and direct destinations, kept in the same canvas. */
export function pageFlowCanvas(project: Project, pageId: string) {
  const events = uiPageFlowEvents(project, pageId), source = pageFlowNodeId(pageId);
  const nodes: GameFlowCanvasNode[] = [{ id: source, kind: 'pageEvents', name: (uiPage(project, pageId)?.name ?? '页面') + ' · 事件', detail: '出口来自按钮行为；双击编辑页面', pageId, eventPageId: pageId, events,
    position: { x: 80, y: 100 }, inputEditable: false, ports: eventPorts(events) }];
  const edges: GameFlowCanvasEdge[] = [];
  let index = 0;
  for (const event of events) for (const [routeIndex, route] of event.routes.entries()) {
    const id = eventTargetId(source, event, routeIndex), name = uiFlowTargetName(project, route.target);
    nodes.push(targetCard(project, id, route.target, { x: 510, y: 60 + index++ * 190 }, event, route.opening, route));
    edges.push({ id: source + ':' + event.id + ':' + routeIndex, source, sourceHandle: event.id, target: id,
      label: event.name + ' → ' + name, caption: event.name, readonly: !event.editable || event.routes.length !== 1, pageEvent: { pageId, eventId: event.id } });
  }
  return { nodes: nodes.map(node => ({ ...node, position: project.gameFlow?.positions?.[node.id] ?? node.position })), edges };
}

/** Insertion never covers existing story cards, including an already authored layout. */
export function flowInsertPosition(nodes: { id: string; position: { x: number; y: number }; measured?: { width?: number; height?: number } }[], sourceId: string) {
  const source = nodes.find(n => n.id === sourceId)?.position ?? { x: 40, y: 120 };
  const free = (x: number, y: number) => nodes.every(n => x + 266 <= n.position.x || n.position.x + (n.measured?.width ?? 242) + 24 <= x || y + 168 <= n.position.y || n.position.y + (n.measured?.height ?? 144) + 24 <= y);
  for (let ring = 1; ring <= nodes.length + 2; ring++) {
    for (const [dx, dy] of [[320 * ring, 0], [320 * ring, 180 * ring], [320 * ring, -180 * ring], [0, 180 * ring], [0, -180 * ring], [-320 * ring, 0]]) {
      const position = { x: source.x + dx, y: source.y + dy };
      if (free(position.x, position.y)) return position;
    }
  }
  return { x: Math.max(source.x, ...nodes.map(n => n.position.x + (n.measured?.width ?? 242))) + 80, y: source.y };
}

/** Top-level lifecycle view. Chapters and groups live behind the game-content card. */
export function gameFlowCanvasNodes(project: Project, _sceneId?: string): GameFlowCanvasNode[] {
  const left = 40, top = 120;
  const startup = gameFlowRoute(project, 'beforeTitle').steps;
  const opening = gameFlowRoute(project, 'beforeNewGame').steps;
  const titleX = left + (startup.length + 1) * 340;
  const newGameX = titleX + 340;
  const nodes: GameFlowCanvasNode[] = [
    { id: flowNodeIds.launch, kind: 'launch', name: '游戏启动', detail: gameFlowRepeatNames[gameFlow(project).beforeTitle.repeat], position: { x: left, y: top }, phase: 'beforeTitle', inputEditable: false, ports: [{ id: 'next', label: '继续', editable: true }] },
    { id: flowNodeIds.title, kind: 'title', name: '标题菜单', detail: '按钮事件 · 双击进入页面流程', pageId: 'ui:main', eventPageId: 'ui:main', events: uiPageFlowEvents(project, 'ui:main'), position: { x: titleX, y: top }, inputEditable: true, ports: eventPorts(uiPageFlowEvents(project, 'ui:main')) },
    { id: flowNodeIds.newGame, kind: 'newGame', name: '新游戏', detail: '系统操作 · 初始化本局状态', target: { kind: 'system', action: 'start' }, position: { x: newGameX, y: top }, phase: 'beforeNewGame', inputEditable: true, ports: [{ id: 'next', label: '初始化后继续', editable: true }] },
    { id: flowNodeIds.load, kind: 'load', name: '读取存档', detail: '系统菜单 · 双击查看按钮事件', pageId: 'ui:save', target: { kind: 'page', pageId: 'ui:save', saveMode: 'load' }, position: { x: newGameX, y: top + 260 }, inputEditable: true, ports: [{ id: 'restore', label: '读档成功 · 恢复位置', editable: false, hint: '由存档记录决定，不能接到固定剧情节点' }] },
  ];
  const graphs = new Map(projectGraphs(project).map(g => [g.id, g]));
  for (const phase of flowPhases) {
    const route = gameFlowRoute(project, phase).steps;
    for (const [index, step] of gameFlowSteps(project, phase).entries()) {
      const id = flowStepNodeId(step.id);
      const order = route.findIndex(item => item.id === step.id);
      const settings = step.kind === 'page' ? flowPageOpening(project, step) : undefined;
      const description = settings ? uiPageOpeningSummary(settings) : step.kind === 'video' ? '视频 · 播放完成后继续' : '蓝图演出 · 调用完成后继续';
      const detail = order < 0 ? '尚未接入入口 · ' + description : description;
      nodes.push({ id, kind: step.kind, name: step.name || (step.kind === 'blueprint' ? graphs.get(step.graphId)?.name : undefined) || flowNodeName(project, id), detail,
        position: { x: (phase === 'beforeTitle' ? left : newGameX) + ((order < 0 ? index : order) + 1) * 340, y: top + (order < 0 ? 520 : 0) }, phase, step, inputEditable: true,
        ports: [{ id: 'next', label: step.kind === 'page' ? !settings?.wait ? '立即继续' : step.completion === 'auto' ? '计时结束' : step.completion === 'confirm' ? '玩家确认' : '页面关闭' : step.kind === 'video' ? '播放结束' : '演出完成', editable: true }, ...(step.kind === 'page' && settings?.wait && step.cancel === 'title' ? [{ id: 'cancel', label: '取消 → 标题', editable: false }] : [])],
      });
    }
  }
  nodes.push({ id: flowNodeIds.story, kind: 'storyPortal', name: '游戏内容', detail: `${project.scenes.length} 个小章节 · 双击进入`, position: { x: newGameX + (opening.length + 1) * 340, y: top }, inputEditable: true, ports: [] });
  let targetIndex = 0;
  for (const event of uiPageFlowEvents(project, 'ui:main')) for (const [routeIndex, route] of event.routes.entries()) {
    if (uiFlowTargetKey(route.target) === 'system:start' || uiFlowTargetKey(route.target) === 'page:ui:save:load') continue;
    nodes.push(targetCard(project, eventTargetId(flowNodeIds.title, event, routeIndex), route.target, { x: newGameX, y: top + 480 + targetIndex++ * 180 }, event, route.opening, route));
  }
  return nodes.map(node => ({ ...node, position: project.gameFlow?.positions?.[node.id] ?? node.position }));
}

export function gameFlowCanvasEdges(project: Project, _sceneId?: string): GameFlowCanvasEdge[] {
  const canvasNodes = gameFlowCanvasNodes(project), byId = new Map(canvasNodes.map(node => [node.id, node]));
  const edges: GameFlowCanvasEdge[] = Object.entries(gameFlowConnections(project)).map(([source, target]) => ({
    id: source + ':next', source, sourceHandle: 'next', target,
    gameFlowSource: gameFlowTransitionSupport(project, source).supported ? source : undefined,
    caption: byId.get(source)?.ports.find(port => port.id === 'next')?.label === '继续' ? '' : byId.get(source)?.ports.find(port => port.id === 'next')?.label,
    label: flowNodeName(project, source) + ' → ' + flowNodeName(project, target), readonly: false,
  }));
  for (const event of uiPageFlowEvents(project, 'ui:main')) for (const [routeIndex, route] of event.routes.entries()) {
    const key = uiFlowTargetKey(route.target), target = key === 'system:start' ? flowNodeIds.newGame : key === 'page:ui:save:load' ? flowNodeIds.load : eventTargetId(flowNodeIds.title, event, routeIndex);
    edges.push({ id: flowNodeIds.title + ':' + event.id + ':' + routeIndex, source: flowNodeIds.title, sourceHandle: event.id, target,
      label: event.name + ' → ' + uiFlowTargetName(project, route.target), caption: '点击 · ' + event.name, readonly: !event.editable || event.routes.length !== 1, pageEvent: { pageId: 'ui:main', eventId: event.id } });
  }
  edges.push(
    { id: 'flow:load:restore', source: flowNodeIds.load, sourceHandle: 'restore', target: flowNodeIds.story, targetHandle: 'load', label: '确认存档 → 恢复保存的位置与状态', caption: '恢复存档位置', readonly: true },
  );
  for (const phase of flowPhases) for (const step of gameFlowSteps(project, phase)) if (step.kind === 'page' && flowPageOpening(project, step).wait && step.cancel === 'title') edges.push({
    id: flowStepNodeId(step.id) + ':cancel', source: flowStepNodeId(step.id), sourceHandle: 'cancel', target: flowNodeIds.title, label: flowNodeName(project, flowStepNodeId(step.id)) + ' · 取消后进入标题', caption: '取消', readonly: true,
  });
  if (project.nodes.some(node => storyNodeReturnsTitle(node, project))) edges.push({
    id: 'flow:story:returnTitle', source: flowNodeIds.story, sourceHandle: 'returnTitle', target: flowNodeIds.title,
    label: '返回标题（按游戏启动节点的执行时机决定是否重播）', caption: gameFlow(project).beforeTitle.repeat === 'title' ? '返回标题 · 重播开场' : '返回标题', readonly: true,
  });
  // Missing references are reported by diagnostics, not rendered as dangling SVGs.
  const present = new Set(canvasNodes.map(n => n.id));
  return edges.filter(edge => present.has(edge.source) && present.has(edge.target));
}
