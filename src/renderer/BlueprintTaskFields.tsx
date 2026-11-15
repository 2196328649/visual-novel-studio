import './blueprint-tasks.css';
import { useState } from 'react';
import type { BlueprintFieldProps } from './BlueprintNodeFields';
import { projectGraphs } from '../core/project-resources';
import { blueprintTaskCatalog, blueprintTaskPins, blueprintTaskProblems, blueprintTaskScope, blueprintTaskVersion, isBlueprintModuleReference, isBlueprintTaskLaunch, isBlueprintTaskNode } from '../core/blueprint-tasks';

export function BlueprintTaskFields({ project, graph, node, edit, surface = 'card' }: BlueprintFieldProps & { surface?: 'card' | 'inspector' }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState<{ nodeId: string; field: 'scope' | 'graphId'; value: string; count: number }>();
  if (!isBlueprintTaskNode(node.type)) return null;
  if (surface === 'card') return <small>{node.properties.taskVersion !== blueprintTaskVersion ? '定义版本不受支持；请在“节点参数”修复。' : blueprintTaskCatalog[node.type].hint}</small>;
  if (node.properties.taskVersion !== blueprintTaskVersion) return <section role="alert"><p>任务定义版本无法识别。旧参数和连线已保留，不会自动恢复。</p><button type="button" className="text-button" onClick={() => setConfirm(true)}>恢复此任务节点</button>{confirm && <div role="alertdialog" aria-label="恢复任务定义"><p>旧定义会存入恢复数据；失效连接点会断开，可一次撤销。恢复后请检查任务模块与生命周期。</p><button type="button" onClick={() => { edit(target => { const recovery = JSON.stringify({ properties: target.properties, pins: target.pins }); target.properties = { taskVersion: blueprintTaskVersion, taskRecovery: recovery, scope: graph.uiPageId ? 'page' : 'call', pageId: graph.uiPageId ?? '', seconds: target.type === 'startTask' ? 0 : .3, conflict: 'parallel' }; target.pins = blueprintTaskPins(target); }); setConfirm(false); }}>确认恢复任务</button><button type="button" onClick={() => setConfirm(false)}>保留原定义</button></div>}</section>;
  const reference = isBlueprintModuleReference(node.type), scoped = ['throttle', 'startTask', 'debounce'].includes(node.type);
  const targetId = String(node.properties.graphId ?? ''), graphs = projectGraphs(project), target = graphs.find(item => item.id === targetId);
  const scope = blueprintTaskScope(node);
  const candidate = (field: 'scope' | 'graphId', value: string) => {
    const next = { ...node, properties: { ...node.properties, [field]: value } };
    if (field === 'scope') { if (value === 'page') next.properties.pageId = graph.uiPageId ?? ''; else delete next.properties.pageId; }
    return next;
  };
  const affected = (field: 'scope' | 'graphId', value: string) => {
    const next = candidate(field, value), pins = blueprintTaskPins(next, graphs.find(item => item.id === next.properties.graphId));
    return graph.links.filter(link => link.fromNodeId === node.id && !pins.some(pin => pin.direction === 'output' && pin.id === link.fromPinId) || link.toNodeId === node.id && !pins.some(pin => pin.direction === 'input' && pin.id === link.toPinId)).length;
  };
  const apply = (field: 'scope' | 'graphId', value: string) => edit(target => { target.properties = candidate(field, value).properties; });
  const request = (field: 'scope' | 'graphId', value: string) => { const count = affected(field, value); if (count) setPending({ nodeId: node.id, field, value, count }); else apply(field, value); };
  const problems = target && isBlueprintTaskLaunch(node.type) ? blueprintTaskProblems(project, target.id) : [];
  return <section className="blueprint-task-fields">
    {scoped && <label className="blueprint-inline-field"><span>生命周期</span><select aria-label={node.name + ' · 生命周期'} value={String(node.properties.scope ?? '')} onChange={event => request('scope', event.target.value)}>{!['call', 'page'].includes(String(node.properties.scope)) && <option value={String(node.properties.scope ?? '')}>无效生命周期</option>}<option value="call">本次调用</option><option value="page">页面实例</option></select></label>}
    {reference && <label className="blueprint-inline-field"><span>{node.type === 'waitTask' ? '结果模块（可选）' : '任务模块'}</span><select aria-label={node.name + ' · 任务模块'} value={targetId} onChange={event => request('graphId', event.target.value)}><option value="">{node.type === 'waitTask' ? '只等待，不读取模块结果' : '请选择模块'}</option>{targetId && !target && <option value={targetId}>缺失模块 · {targetId}</option>}{graphs.filter(item => !item.timeline && (node.type === 'waitTask' || item.id !== graph.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    {node.type === 'startTask' && <label className="blueprint-inline-field"><span>重复启动</span><select aria-label={node.name + ' · 重复启动'} value={String(node.properties.conflict ?? '')} onChange={event => edit(value => { value.properties.conflict = event.target.value; })}>{!['parallel','replace','ignore'].includes(String(node.properties.conflict)) && <option value={String(node.properties.conflict ?? '')}>无效策略</option>}<option value="parallel">独立启动每个任务</option><option value="replace">取消旧任务，保留最新</option><option value="ignore">已有任务时忽略</option></select></label>}
    {problems.length > 0 && <p role="alert">{problems[0].message}{problems.length > 1 ? '（另有 ' + (problems.length - 1) + ' 项问题）' : ''}</p>}
    {pending?.nodeId === node.id && <div role="alertdialog" aria-label="修改任务连接点确认"><p>修改{pending.field === 'scope' ? '生命周期' : '模块'}将断开 {pending.count} 条不再存在的连接点连线，可一次撤销；不兼容的类型连线不会自动转换。</p><button type="button" className="small-button" onClick={() => { const count = affected(pending.field, pending.value); if (count !== pending.count) { setPending({ ...pending, count }); return; } apply(pending.field, pending.value); setPending(undefined); }}>确认修改任务</button><button type="button" className="small-button" onClick={() => setPending(undefined)}>保留原连接</button></div>}
    <small>{blueprintTaskCatalog[node.type].hint}</small>
    {node.type === 'debounce' && <p className="muted">把延后的业务放在任务模块内；触发链只安排任务后返回，不要在同一点击链立刻等待它，否则该点击仍受正在执行事件的防重保护。</p>}
    {scoped && <p className="muted">{scope === 'page' ? '内置模板和新增页面使用相同实例规则；离页取消，重新打开不会恢复旧任务。存读档/回滚保留剩余秒数，不累计离线时间。' : node.type === 'throttle' ? '同一调用内共享冷却，调用结束后清除；跨点击节流请选择页面实例。' : '调用返回即取消尚未完成的任务；需要跨点击执行时请选择页面实例，而不是增加调用内等待。'}</p>}
    {node.type === 'waitTask' && <p className="muted">只在“已完成”路线使用输出；取消/失败/标识失效均返回模块默认值，不复用上次结果。任务结果保留最近 512 项。</p>}
  </section>;
}
