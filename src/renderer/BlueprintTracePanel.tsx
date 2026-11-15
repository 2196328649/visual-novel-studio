import type { BlueprintBreakpoint } from '../core/blueprint-debug';
import { useEffect, useMemo, useState } from 'react';
import type { Project } from '../core/model';
import type { BlueprintTraceEntry, BlueprintTraceSnapshot } from '../core/blueprint-trace';
import { blueprintTraceFilters, blueprintTraceHasValue, blueprintTraceInvocations, blueprintTraceKindNames, blueprintTraceValue, blueprintTraceView, filterBlueprintTrace, type BlueprintTraceFilter } from '../core/blueprint-trace-view';
import type { UiPreviewAction, UiPreviewActionHandler, UiPreviewActionResult, UiPreviewTraceTarget } from '../core/ui-preview-actions';
import './blueprint-trace.css';

const pageSize = 60;
export function BlueprintTracePanel({ project, trace, resetId, onAction, onClose, mode = 'preview', onBreakpoint }: { project: Project; trace?: BlueprintTraceSnapshot; resetId: string; onAction?: UiPreviewActionHandler; onClose: () => void; mode?: 'preview' | 'native'; onBreakpoint?: (point: BlueprintBreakpoint) => void }) {
  const [kind, setKind] = useState<BlueprintTraceFilter>('all'), [query, setQuery] = useState(''), [invocation, setInvocation] = useState('');
  const [selectionNotice, setSelectionNotice] = useState('');
  const [follow, setFollow] = useState(true), [page, setPage] = useState(0), [selected, setSelected] = useState<BlueprintTraceEntry>();
  const [pending, setPending] = useState(false), [result, setResult] = useState<UiPreviewActionResult>();
  const view = useMemo(() => blueprintTraceView(project), [project]);
  const invocations = useMemo(() => blueprintTraceInvocations(trace), [trace]);
  const filtered = useMemo(() => filterBlueprintTrace(trace, view, { kind, query, invocationId: invocation ? Number(invocation) : undefined }), [trace, view, kind, query, invocation]);
  useEffect(() => { setSelected(undefined); setSelectionNotice(''); setInvocation(''); setPage(0); }, [project, resetId]);
  useEffect(() => { setPage(0); }, [kind, query, invocation]);
  useEffect(() => {
    if (!selected) return;
    const current = trace?.entries.find(entry => entry.sequence === selected.sequence);
    if (!current || JSON.stringify(current) !== JSON.stringify(selected)) {
      setSelected(undefined); setSelectionNotice('所选记录已超出保留上限或因重新预演改变，请重新选择；没有沿用过期值。');
    }
  }, [trace, selected]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)), currentPage = follow ? pages - 1 : Math.min(page, pages - 1);
  const entries = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const request = async (action: UiPreviewAction) => {
    if (!onAction || pending) return;
    setPending(true); setResult(undefined);
    try { setResult(await onAction(action)); }
    catch (error) { setResult({ status: 'failed', message: error instanceof Error ? error.message : String(error) }); }
    finally { setPending(false); }
  };
  const locate = (target: UiPreviewTraceTarget | undefined) => target && void request({ kind: 'locate', projectId: project.id, ...target });
  const target = selected && view.graphTarget(selected.graphId, selected.nodeId, selected.pageId);
  const source = selected?.sourceNodeId ? view.graphTarget(selected.sourceGraphId ?? selected.graphId, selected.sourceNodeId, selected.pageId) : undefined;
  const component = selected?.componentId ? view.pageTarget(selected.pageId, selected.componentId) : undefined;
  const origin = selected && view.pageTarget(selected.pageId);
  const statePage = selected?.targetPageId ? view.pageTarget(selected.targetPageId) : undefined;
  return <aside className={'blueprint-trace'+(selected?' has-detail':'')} aria-label="蓝图执行轨迹">
    <header><strong>执行轨迹</strong><span>{trace?.entries.length ?? 0} 条 / {trace?.invocations ?? 0} 次调用</span><button className="small-button" title="返回画面和计时工具；不会自动暂停或重新执行" onClick={onClose}>返回画面</button></header>
    <details className="blueprint-trace-help"><summary>观察规则与记录上限</summary><p>{mode === 'native' ? '显示本次隔离试玩中实际执行和求值的记录，不会因展开或筛选再求值。读档、回滚、清空记录会开始新的记录代际，旧值不沿用。' : '显示当前测试数据重演中的真实观察值，不会额外求值。时间暂停不是断点；展开、筛选、隐藏轨迹不改变执行或测试值。恢复测试值会重新记录。'}</p><p>最多保留最近 1600 条；超长文本截到 4000 字。{mode === 'native' ? '断点在执行前停止；当前尚未执行的输入不冒充已有观察值。' : '页面预演不执行断点；需在实时试玩的蓝图调试面板中使用断点和单步。'}</p></details>
    {!!trace?.dropped && <p className="blueprint-trace-notice" role="status">已有 {trace.dropped} 条早期记录超出上限；当前不是完整历史。</p>}
    <div className="blueprint-trace-filters">
      <input aria-label="搜索执行轨迹" placeholder="搜索节点、值、来源或原因" value={query} onChange={event => setQuery(event.target.value)} maxLength={200}/>
      <select aria-label="轨迹类型" value={kind} onChange={event => setKind(event.target.value as BlueprintTraceFilter)}>{Object.entries(blueprintTraceFilters).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      <select aria-label="筛选调用" value={invocation} onChange={event => setInvocation(event.target.value)}><option value="">全部调用</option>{invocations.map(frame => <option key={frame.id} value={frame.id}>#{frame.id} · {view.graphName(frame.graphId)}{frame.pageInstance !== undefined ? ' · 页面实例 #' + frame.pageInstance : ''}</option>)}</select>
    </div>
    <div className="blueprint-trace-pagination"><label><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)}/>跟随最新</label><output aria-label="轨迹筛选数量">{filtered.length} 条 · {currentPage + 1}/{pages}</output><button className="small-button" disabled={!currentPage} onClick={() => { setFollow(false); setPage(currentPage - 1); }}>较早</button><button className="small-button" disabled={currentPage >= pages - 1} onClick={() => { setFollow(false); setPage(currentPage + 1); }}>较新</button></div>
    <div className="blueprint-trace-entries" role="list" aria-label="执行记录">
      {entries.length ? entries.map(entry => <div role="listitem" key={entry.sequence}><button data-trace-sequence={entry.sequence} data-trace-kind={entry.kind} data-trace-graph={entry.graphId} data-trace-node={entry.nodeId} aria-label={'记录 ' + entry.sequence + ' · ' + blueprintTraceKindNames[entry.kind] + ' · ' + (view.nodeName(entry.graphId, entry.nodeId) || view.graphName(entry.graphId))} aria-current={selected?.sequence === entry.sequence ? 'true' : undefined} className={'blueprint-trace-entry trace-' + entry.kind} onClick={() => { setSelectionNotice(''); setSelected(entry); }}>
        <span className="blueprint-trace-entry-meta"><b>{blueprintTraceKindNames[entry.kind]}</b><span>#{entry.sequence} · {entry.time.toFixed(3)} 秒</span></span>
        <strong title={view.graphName(entry.graphId) + ' / ' + view.nodeName(entry.graphId, entry.nodeId)}>{view.nodeName(entry.graphId, entry.nodeId) || view.graphName(entry.graphId)}{entry.pinId ? ' · ' + view.pinName(entry.graphId, entry.nodeId, entry.pinId) : ''}</strong>
        <span title={view.summary(entry)}>{view.summary(entry) || view.origin(entry)}</span>
        <small>{view.origin(entry)}</small>
      </button></div>) : <p className="muted">{trace?.entries.length ? '没有匹配的记录。可修改筛选条件。' : '还没有执行记录。请在画面中触发按钮、按键或时间事件。'}</p>}
    </div>
    {selected && <section className="blueprint-trace-details" aria-label="轨迹详情">
      <div className="blueprint-trace-detail-title">{onBreakpoint && selected.graphId && selected.nodeId && <button className="small-button" onClick={() => onBreakpoint({ graphId: selected.graphId!, nodeId: selected.nodeId! })}>切换该节点断点</button>}<strong>#{selected.sequence} · {blueprintTraceKindNames[selected.kind]}</strong><button className="small-button" onClick={() => setSelected(undefined)}>收起详情</button></div>
      <dl><dt>来源</dt><dd>{view.origin(selected)}</dd><dt>蓝图 / 节点</dt><dd>{view.graphName(selected.graphId)}{selected.nodeId ? ' / ' + view.nodeName(selected.graphId, selected.nodeId) : ''}</dd>
        {selected.pinId && <><dt>引脚</dt><dd>{view.pinName(selected.graphId, selected.nodeId, selected.pinId)} <code>{selected.pinId}</code></dd></>}
        {blueprintTraceHasValue(selected) && <><dt>观察值</dt><dd data-trace-value><pre>{blueprintTraceValue(selected)}</pre>{selected.available !== false && selected.value !== undefined && <small>{typeof selected.value === 'boolean' ? '布尔' : typeof selected.value === 'number' ? '数字' : '文本'}</small>}</dd></>}
        {source && <><dt>数据来自</dt><dd>{view.nodeName(selected.sourceGraphId ?? selected.graphId, selected.sourceNodeId)} · {view.pinName(selected.sourceGraphId ?? selected.graphId, selected.sourceNodeId, selected.sourcePinId)}</dd></>}
        {view.state(selected) && <><dt>状态所有者</dt><dd>{view.state(selected)}</dd></>}
        {selected.componentId && <><dt>触发控件</dt><dd>{view.componentName(selected.pageId, selected.componentId)}</dd></>}
        {selected.reason && <><dt>原因</dt><dd>{selected.reason}</dd></>}
      </dl>
      <div className="blueprint-trace-locations">{target && <button className="small-button" disabled={!onAction || pending} onClick={() => locate(target)}>定位{selected.nodeId ? '节点' : '蓝图'}</button>}{source && <button className="small-button" disabled={!onAction || pending} onClick={() => locate(source)}>定位值来源</button>}{component && <button className="small-button" disabled={!onAction || pending} onClick={() => locate(component)}>定位触发控件</button>}{origin && <button className="small-button" disabled={!onAction || pending} onClick={() => locate(origin)}>定位来源页面</button>}{statePage && <button className="small-button" disabled={!onAction || pending} onClick={() => locate(statePage)}>定位状态页面</button>}</div>
      <h4>调用链（外层 → 当前）</h4>
      {selected.stack.length ? <ol className="blueprint-trace-stack">{selected.stack.map((frame, index) => <li key={frame.id}><button className="small-button" disabled={!onAction || pending} onClick={() => locate(view.graphTarget(frame.graphId, undefined, frame.pageId))}>调用 #{frame.id} · {view.graphName(frame.graphId)}</button><small>{view.origin({ ...frame, invocationId: frame.id })}</small>{frame.callNodeId && index > 0 && <button className="small-button" disabled={!onAction || pending} onClick={() => locate(view.graphTarget(selected.stack[index - 1].graphId, frame.callNodeId, selected.stack[index - 1].pageId))}>返回调用点 · {view.nodeName(selected.stack[index - 1].graphId, frame.callNodeId)}</button>}</li>)}</ol> : <p className="muted">此项来自页面宿主，没有模块调用栈。</p>}
    </section>}
    <footer><button className="small-button" disabled={!onAction || pending} onClick={() => void request({ kind: 'play', projectId: project.id })}>在实际游戏中验证</button>{selectionNotice && <p role="status">{selectionNotice}</p>}{pending && <p role="status">已请求主编辑器处理；若有草稿提示，请在主编辑器选择保存、不保存或取消。</p>}{result && <p role={result.status === 'failed' ? 'alert' : 'status'}>{result.message}</p>}<small>按正常试玩流程保存并启动；不把页面测试值写入工程。</small></footer>
  </aside>;
}
