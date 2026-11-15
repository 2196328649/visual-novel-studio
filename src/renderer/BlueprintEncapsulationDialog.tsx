import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { Project } from '../core/model';
import { blueprintOutputLabel, blueprintTypeNames } from '../core/blueprint';
import { availableBlueprintName, blueprintNameError } from '../core/blueprint-names';
import { inspectBlueprintEncapsulation, type EncapsulationPort } from '../core/blueprint-encapsulation';
import { Field, IconButton } from './components';
import './blueprint-encapsulation.css';

export function BlueprintEncapsulationDialog({ project, graphId, nodeIds, onClose, onCreate }: {
  project: Project; graphId: string; nodeIds: string[]; onClose(): void; onCreate(name: string): string | undefined;
}) {
  const dialog = useRef<HTMLDialogElement>(null), returnFocus = useRef(document.activeElement as HTMLElement | null);
  const [name, setName] = useState(() => availableBlueprintName(project, '用户节点'));
  const [error, setError] = useState('');
  const plan = useMemo(() => inspectBlueprintEncapsulation(project, graphId, nodeIds), [project, graphId, nodeIds]);
  const invalidName = blueprintNameError(project, '', name);
  useEffect(() => {
    const element = dialog.current; element?.showModal();
    return () => { element?.close(); if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true }); };
  }, []);
  const ports = (title: string, values: EncapsulationPort[]) => <section><h3>{title} · {values.length}</h3>{values.length ? <ul>{values.map(port => {
    const source = plan.ok && plan.graph.nodes.find(n => n.id === port.links[0].fromNodeId);
    return <li key={port.key}><strong>{port.name}<span>{blueprintTypeNames[port.dataType]}</span></strong><small>{source && plan.ok ? blueprintOutputLabel(project, plan.graph, source, port.links[0].fromPinId) : ''} · {port.links.length} 条边界连线</small></li>;
  })}</ul> : <p className="muted">无{title}。</p>}</section>;
  const submit = () => { if (!plan.ok || invalidName) return; setError(onCreate(name.trim()) ?? ''); };
  return createPortal(<dialog ref={dialog} className="blueprint-encapsulation-dialog" aria-label="封装为用户节点" onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => {
    event.stopPropagation();
    if (['F5', 'F6'].includes(event.key) || (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault();
  }}><form onSubmit={event => { event.preventDefault(); submit(); }}>
    <header><h2>封装为用户节点</h2><div className="spacer" /><IconButton title="关闭封装对话框" onClick={onClose}><X size={17} /></IconButton></header>
    <div className="blueprint-encapsulation-body"><p>把所选片段替换成一个调用节点。保留原事件入口；跨边界的数据线会成为模块参数或返回值。</p>
      {plan.ok ? <><Field label="用户节点名称"><input autoFocus aria-label="用户节点名称" maxLength={120} value={name} onChange={event => { setName(event.target.value); setError(''); }} /></Field>
        <p className="muted">{plan.selectedIds.length} 个节点 · 单一执行入口 · {plan.exits.length ? '继续到原后续节点' : '在原位置结束本段'}。相同数据来源合并为一个参数，原扇出连线保留。</p>
        <div className="blueprint-encapsulation-ports">{ports('输入参数', plan.inputs)}{ports('输出结果', plan.outputs)}</div>
        <p className="muted">创建后可在“输入与输出”修改参数名称与默认值。此操作会同时修改原图和新模块，一次撤销即可恢复。</p></> : <div className="blueprint-encapsulation-problem" role="alert"><strong>当前选择不能安全封装</strong><p>{plan.message}</p><p>先关闭此窗口调整选择；不会删除或改写原节点。</p></div>}
      {(error || plan.ok && invalidName) && <p className="blueprint-encapsulation-problem" role="alert">{error || invalidName}</p>}
    </div><footer><button type="button" className="small-button" onClick={onClose}>取消</button><button type="submit" className="primary" disabled={!plan.ok || !!invalidName}>创建并替换</button></footer>
  </form></dialog>, document.body);
}
