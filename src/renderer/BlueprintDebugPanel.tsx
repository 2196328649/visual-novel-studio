import { useMemo, useRef, useState } from 'react';
import { blueprintDebugBreakpointProblem, type BlueprintBreakpoint, type BlueprintDebugAction, type BlueprintDebugSnapshot } from '../core/blueprint-debug';
import type { Project } from '../core/model';
import type { StudioBridge } from '../core/bridge';
import type { UiPreviewActionHandler } from '../core/ui-preview-actions';
import { projectGraphs } from '../core/project-resources';
import { blueprintTraceView } from '../core/blueprint-trace-view';
import { BlueprintTracePanel } from './BlueprintTracePanel';
import './blueprint-debug.css';

const reasons: Record<string, string> = { running: '运行中', exception: '发生运行异常，请查看停止记录与运行问题', breakpoint: '在断点执行前暂停', pauseRequested: '已暂停，等待继续', stepInto: '步入', stepOver: '步过', stepOut: '步出', callReturned: '调用结束检查点', loaded: '已读档，记录重新开始', rollback: '已回滚，记录重新开始', continue: '继续执行' };
export function BlueprintDebugPanel({ project, bridge, snapshot, active, enabled, onEnabled, points, onPoints, onAction, onClose }: {
  project: Project; bridge: StudioBridge; snapshot?: BlueprintDebugSnapshot; active: boolean; enabled: boolean; onEnabled: (value: boolean) => void;
  points: BlueprintBreakpoint[]; onPoints: (value: BlueprintBreakpoint[]) => void; onAction: UiPreviewActionHandler; onClose: () => void;
}) {
  const graphs = useMemo(() => projectGraphs(project), [project]), view = useMemo(() => blueprintTraceView(project), [project]);
  const [graphChoice, setGraphChoice] = useState(''), [nodeChoice, setNodeChoice] = useState(''), [notice, setNotice] = useState('');
  const [pending, setPending] = useState<{ session: string; revision: number }>();
  const currentSession = useRef(snapshot?.sessionId); currentSession.current = snapshot?.sessionId;
  const graph = graphs.find(graph => graph.id === graphChoice) ?? graphs[0];
  const nodes = graph?.nodes.filter(node => node.pins.some(pin => pin.dataType === 'exec')) ?? [];
  const node = nodes.find(node => node.id === nodeChoice) ?? nodes[0];
  const live = active && !!snapshot && !!bridge.controlBlueprintDebug;
  const waiting = !!pending && pending.session === snapshot?.sessionId && (pending.revision < 0 || snapshot.acknowledgement < pending.revision);
  const paused = snapshot?.phase === 'paused';
  const issue = async (action: BlueprintDebugAction, breakpoints?: BlueprintBreakpoint[]) => {
    if (!live || !snapshot || waiting) return false;
    const session = snapshot.sessionId;
    setNotice(''); setPending({ session, revision: -1 });
    try {
      const receipt = await bridge.controlBlueprintDebug!({ sessionId: session, action, ...(breakpoints ? { breakpoints } : {}) });
      if (currentSession.current !== session) return false;
      setPending({ session, revision: receipt.revision });
      // A manual pause from returning to the editor is a separate barrier.
      if (['continue', 'stepInto', 'stepOver', 'stepOut'].includes(action)) await bridge.controlPreview?.('resume');
      return true;
    } catch (error) {
      if (currentSession.current === session) { setPending(undefined); setNotice(error instanceof Error ? error.message : String(error)); }
      return false;
    }
  };
  const setPoints = async (value: BlueprintBreakpoint[]) => {
    if (waiting) return;
    if (value.length > 512) { setNotice('最多保留 512 个断点。'); return; }
    if (!live || await issue('breakpoints', value)) { onPoints(value); setNotice(live ? '断点已发送到本次试玩；下次重新运行也会保留。' : '断点已保存到本机试玩设置，下次重新运行生效。'); }
  };
  const toggle = (point: BlueprintBreakpoint) => {
    const existing = points.some(item => item.graphId === point.graphId && item.nodeId === point.nodeId);
    if (!existing) { const problem = blueprintDebugBreakpointProblem(project, point); if (problem) { setNotice(problem); return; } }
    void setPoints(existing ? points.filter(item => item.graphId !== point.graphId || item.nodeId !== point.nodeId) : [...points, point]);
  };
  const locate = async () => {
    const site = snapshot?.site, target = site && view.graphTarget(site.graphId, site.nodeId, site.pageId);
    if (!target) return;
    try { const result = await onAction({ kind: 'locate', projectId: project.id, ...target }); if (result.status !== 'completed') setNotice(result.message); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };
  return <section className="blueprint-debug-panel" aria-label="原生蓝图调试" data-debug-phase={snapshot?.phase ?? 'unavailable'}>
    <div className="blueprint-debug-controls">
      <div className="blueprint-debug-heading"><strong>蓝图调试</strong><label><input type="checkbox" checked={enabled} onChange={event => onEnabled(event.target.checked)}/>下次运行启用</label></div>
      <div className="blueprint-debug-buttons">
        <button className="small-button" disabled={!live || waiting} onClick={() => void issue(paused ? 'continue' : 'pause')}>{paused ? '断点继续' : '暂停蓝图'}</button>
        <button className="small-button" disabled={!live || !paused || waiting} onClick={() => void issue('stepInto')}>步入</button>
        <button className="small-button" disabled={!live || !paused || waiting} onClick={() => void issue('stepOver')}>步过</button>
        <button className="small-button" disabled={!live || !paused || waiting} onClick={() => void issue('stepOut')}>步出</button>
        <button className="small-button" disabled={!live || waiting} onClick={() => void issue('clear')}>清空记录</button>
      </div>
      <p className="blueprint-debug-status" role="status">{waiting ? '等待游戏确认调试命令…' : snapshot ? (snapshot.phase === 'stepping' ? '单步运行中 · ' : '') + (reasons[snapshot.reason] ?? snapshot.reason) : enabled ? '等待调试连接；若本次运行未启用，请重新运行。' : '本次未启用蓝图调试。'}{!active && snapshot ? ' · 试玩已结束，以下为最后记录。' : ''}</p>
      {snapshot?.site && <button className="blueprint-debug-site" onClick={() => void locate()}><strong>{view.graphName(snapshot.site.graphId)} · {view.nodeName(snapshot.site.graphId, snapshot.site.nodeId)}</strong><span>调用 #{snapshot.site.invocationId}{snapshot.site.pageId ? ' · 页面 ' + snapshot.site.pageId + ' / 实例 ' + (snapshot.site.pageInstance ?? '未知') : ''}{snapshot.site.taskHandle ? ' · 后台任务' : ''}{snapshot.site.entry === 'return' ? ' · 调用已执行结束' : ''} · 点击定位</span></button>}
      <details className="blueprint-debug-breakpoints"><summary>断点设置（{points.length}）</summary>
        <div className="blueprint-debug-add"><select aria-label="断点蓝图" value={graph?.id ?? ''} onChange={event => { setGraphChoice(event.target.value); setNodeChoice(''); }}>{graphs.map(graph => <option key={graph.id} value={graph.id}>{graph.name}</option>)}</select><select aria-label="断点执行节点" value={node?.id ?? ''} onChange={event => setNodeChoice(event.target.value)}>{nodes.map(node => <option key={node.id} value={node.id}>{node.name}</option>)}</select><button className="small-button" disabled={!graph || !node || waiting} onClick={() => graph && node && toggle({ graphId: graph.id, nodeId: node.id })}>切换断点</button></div>
        <ul>{points.map(point => <li key={point.graphId + '/' + point.nodeId}><span>{view.graphName(point.graphId)} · {view.nodeName(point.graphId, point.nodeId)}{blueprintDebugBreakpointProblem(project, point) ? '（失效，请移除）' : ''}</span><button className="small-button" disabled={waiting} onClick={() => toggle(point)}>移除</button></li>)}</ul>
        <p>断点只作用于当前试玩编译快照，不改写作品；编辑或删除节点后需要重新运行。</p>
      </details>
      <details className="blueprint-debug-rules"><summary>暂停与单步规则</summary><p>断点在执行节点之前停止；数据节点只观察实际被读取的值。步过、步出跟随当前调用链，其他显式断点仍会命中。调用已返回时停在结束检查点，不假装还能修改刚才的结果。</p><p>暂停期间不运行页面计时或后台任务，编辑器管理的动画时钟和音频一并暂停。单步跨等待时恢复时间，其他任务可以完成依赖；不会把等待跳成完成。一个节点内部的长操作或外接脚本不能从中间截断，可随时停止整个试玩。</p><p>读档与回滚不恢复编辑器命令，也不重放轨迹。运行、记录与断点都只属于本次隔离试玩，不随作品发行。</p></details>
      {notice && <p className="blueprint-debug-notice" role="alert">{notice}</p>}
    </div>
    <BlueprintTracePanel project={project} trace={snapshot?.trace} resetId={(snapshot?.sessionId ?? '') + ':' + (snapshot?.generation ?? 0)} mode="native" onAction={onAction} onBreakpoint={toggle} onClose={onClose}/>
  </section>;
}
