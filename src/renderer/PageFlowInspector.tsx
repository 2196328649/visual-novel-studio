import { ExternalLink, LayoutTemplate, Workflow } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { BlueprintGraph, Project } from '../core/model';
import { setUiFlowTarget, uiFlowEventStatus, uiFlowTargetKey, uiFlowTargetName, uiFlowTargets, uiPageFlowEvents, uiFlowEventRouteSummary, uiFlowRouteBadges, uiFlowRouteOpeningSummary, type UiFlowEvent, type UiFlowRoute } from '../core/ui-page-flow';
import { uiPage } from '../core/ui-pages';
import { projectGraphs } from '../core/project-resources';
import type { GameFlowCanvasNode } from './game-flow-view';
import { formatCondition, type Commit } from './editor';
import { UiPageOpeningFields } from './UiPageOpeningFields';
import { Field } from './components';
import './page-flow-inspector.css';

function RouteExplanation({ project, graphs, route, openBlueprint }: { project: Project; graphs: ReadonlyMap<string, BlueprintGraph>; route: UiFlowRoute; openBlueprint: (graphId: string, nodeId?: string) => void }) {
  const paths = route.paths ?? [], title = uiFlowTargetName(project, route.target);
  const [expanded, setExpanded] = useState(false);
  if (!paths.length) return null;
  return <details className="page-flow-paths" aria-label={'来源路径 · ' + title} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>查看来源路径{paths.length > 1 ? ` · ${paths.length} 种来路` : ''}</summary>
    {expanded && paths.map((path, index) => <div className="page-flow-path" key={index} data-route-path={index}>
      {paths.length > 1 && <small>来路 {index + 1}</small>}
      {path.limited && <p className="muted">路径较长，已省略部分中间步骤；请在原事件图查看完整逻辑。</p>}
      <ol>{path.steps.map((step, stepIndex) => {
        const graph = step.graphId ? graphs.get(step.graphId) : undefined, node = graph?.nodes.find(node => node.id === step.nodeId);
        return <li key={stepIndex} data-route-step={step.kind}><span>{step.label}</span>{graph && <button type="button" className="text-button" title={graph.name + (node ? ' / ' + node.name : '')} aria-label={'定位路线来源 · ' + step.label} onClick={() => openBlueprint(graph.id, node?.id)}>定位 ↗</button>}</li>;
      })}<li data-route-step="target"><strong>{title}</strong></li></ol>
    </div>)}
    {route.pathsLimited && <p className="muted">还有其他来路，已保留前 4 种；打开原事件图查看。</p>}
  </details>;
}

export function PageFlowInspector({ project, node, commit, enterPage, openPage, openBlueprint, report }: {
  project: Project; node: GameFlowCanvasNode; commit: Commit; enterPage: (pageId: string) => void;
  openPage: (pageId: string, saveMode?: 'save' | 'load', componentId?: string) => void;
  openBlueprint: (graphId: string, nodeId?: string) => void; report: (error: string) => void;
}) {
  const events = node.events ?? (node.event ? [node.event] : []);
  const graphs = useMemo(() => new Map(projectGraphs(project).map(graph => [graph.id, graph])), [project.blueprints, project.timelinePresets]);
  const edit = (event: UiFlowEvent, change: () => void) => { try { change(); report(''); } catch (error) { report(error instanceof Error ? error.message : String(error)); } };
  return <aside className="inspector page-flow-inspector" aria-label="页面流程属性"><div className="panel-heading"><LayoutTemplate size={16} /><h2>页面与事件</h2></div><div className="inspector-scroll">
    <h3>{node.name}</h3><p className="muted">{node.detail}</p>
    {node.pageId && <div className="page-flow-links"><button className="small-button" onClick={() => enterPage(node.pageId!)}><Workflow size={14} />进入页面流程</button><button className="text-button" onClick={() => openPage(node.pageId!, node.target?.kind === 'page' ? node.target.saveMode : node.pageId === 'ui:save' ? 'load' : undefined)}><ExternalLink size={14} />编辑界面</button></div>}
    {node.target?.kind === 'logic' && <button className="small-button" onClick={() => { if (node.target?.kind === 'logic') openBlueprint(node.target.graphId, node.target.nodeId); }}>进入原事件图</button>}
    {node.eventPageId && <p className="muted">出口来自这页实际按钮。改变目标会同步修改按钮；禁用按钮和页面内部的筛选、翻页默认不展示。可在按钮属性中公开或隐藏出口。</p>}
    {!events.length && node.eventPageId && <p className="muted">这页还没有公开的按钮事件。在界面设计中添加按钮并设置点击行为即可。</p>}
    {events.map(event => {
      const targets = uiFlowTargets(project, event.pageId), route = event.routes.length === 1 ? event.routes[0] : undefined;
      const current = route && route.target.kind !== 'logic' ? uiFlowTargetKey(route.target) : '';
      const status = uiFlowEventStatus(event), summary = uiFlowEventRouteSummary(event);
      return <section key={event.id} className="page-flow-event" aria-label={'页面事件 ' + event.name}>
        <h4>{event.name}{status && <small>{status}</small>}</h4>
        {event.disabled && <p className="muted">此按钮在界面设计中已禁用，因手动公开而保留出口。启用状态可在原按钮或页面事件中修改。</p>}
        {event.unavailable && <p className="muted">目标页面已停用。可在界面设计中启用该页面，或为按钮选择其他目标。</p>}
        {event.visibleWhen && <p className="muted">显示条件：{formatCondition(project, event.visibleWhen)}</p>}
        {event.enabledWhen && <p className="muted">启用条件：{formatCondition(project, event.enabledWhen)}</p>}
        <Field label="点击后"><select aria-label={event.name + ' · 流程目标'} value={current} disabled={!event.editable} onChange={e => edit(event, () => commit('修改页面按钮目标', draft => setUiFlowTarget(draft, event.pageId, event.id, targets.find(target => uiFlowTargetKey(target) === e.target.value)), { separate: true }))}>
          <option value="">{event.routes.length > 1 ? summary.title + ' · 查看下方路线' : route?.target.kind === 'logic' ? '由事件图决定' : '未连接'}</option>
          {current && !targets.some(target => uiFlowTargetKey(target) === current) && <option value={current}>{uiFlowTargetName(project, route!.target)}</option>}
          {targets.map(target => <option key={uiFlowTargetKey(target)} value={uiFlowTargetKey(target)}>{uiFlowTargetName(project, target)}</option>)}
        </select></Field>
        {event.nativeSlot && !event.componentId && <p className="muted">首次修改后，此系统按钮成为界面中的可编辑控件。</p>}
        {event.problem && <p className="muted">{event.problem}</p>}
        {event.editable && route?.target.kind === 'page' && <UiPageOpeningFields project={project} pageId={route.target.pageId} value={route.opening} label={event.name + '打开'} onChange={opening => edit(event, () => commit('修改按钮打开方式', draft => setUiFlowTarget(draft, event.pageId, event.id, route.target, opening ?? {}), { separate: true }))} />}
        {(event.routes.length > 1 || !event.editable || event.routeAnalysis?.limited) && <div className="page-flow-route-summary" data-route-summary><strong>{summary.title}</strong><p>{summary.description}</p></div>}
        <div className="page-flow-routes">{event.routes.map((item, i) => {
          const badges = uiFlowRouteBadges(item), opening = uiFlowRouteOpeningSummary(project, item);
          return <div key={i} className="page-flow-route-card" data-route-target={uiFlowTargetKey(item.target)} data-route-node={item.nodeId}>
            <div className="page-flow-route"><strong>{uiFlowTargetName(project, item.target)}</strong>{item.graphId && <button className="text-button" onClick={() => openBlueprint(item.graphId!, item.nodeId)}>事件图 ↗</button>}{item.target.kind === 'page' && <button className="text-button" onClick={() => { if (item.target.kind === 'page') enterPage(item.target.pageId); }}>进入 ↗</button>}</div>
            {badges.length > 0 && <div className="page-flow-route-badges">{badges.map(badge => <span key={badge}>{badge}</span>)}</div>}
            {opening && (!event.editable || event.routes.length > 1) && <p className="page-flow-route-opening">{opening}</p>}
            <RouteExplanation key={(item.graphId ?? '') + ':' + (item.nodeId ?? '') + ':' + uiFlowTargetKey(item.target)} project={project} graphs={graphs} route={item} openBlueprint={openBlueprint} />
          </div>;
        })}</div>
        {event.componentId && <button className="text-button" onClick={() => openPage(event.pageId, undefined, event.componentId)}>定位原按钮 ↗</button>}
      </section>;
    })}
    {node.target?.kind === 'system' && node.target.action === 'return' && <p className="muted">关闭只通知打开这页的调用者。确认完成可返回页面结果；取消使用默认结果。显示后继续的覆盖层关闭时，不会再推进原流程。</p>}
    {node.pageId === 'ui:save' && <p className="muted">关闭或取消返回打开处。成功读档恢复保存的剧情位置和状态；这条恢复路径由存档决定。</p>}
    {node.pageId && !uiPage(project, node.pageId) && <p role="alert">目标页面已不存在，请重新选择。</p>}
  </div></aside>;
}

export function pageEventForNode(project: Project, nodes: GameFlowCanvasNode[], source: string, port: string | null | undefined) {
  const pageId = nodes.find(node => node.id === source)?.eventPageId;
  return pageId ? uiPageFlowEvents(project, pageId).find(event => event.id === port) : undefined;
}
