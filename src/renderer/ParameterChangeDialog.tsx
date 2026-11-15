import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Project } from '../core/model';
import { parameterKind, parameterKindNames, parameterTypeName, type ParameterKind } from '../core/parameter-sets';
import { parameterUsages, type ParameterUsage } from '../core/parameter-usages';
import { ParameterUsageList } from './ParameterUsageList';

export interface ParameterChange { id: string; kind?: ParameterKind }
export function ParameterChangeDialog({ project, change, close, apply, locate, restoreFocus }: {
  project: Project; change: ParameterChange; close: () => void;
  apply: (replacement?: string) => void; locate?: (usage: ParameterUsage) => void; restoreFocus?: () => boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null), returnFocus = useRef(document.activeElement as HTMLElement | null);
  const [replacement, setReplacement] = useState(''), [error, setError] = useState<string>();
  const variable = project.variables.find(variable => variable.id === change.id);
  const usages = useMemo(() => parameterUsages(project, change.id), [project, change.id]);
  const candidates = variable ? project.variables.filter(other => other.id !== variable.id && parameterKind(other) === parameterKind(variable)) : [];
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => { element?.close(); const previous = returnFocus.current; requestAnimationFrame(() => { if (restoreFocus?.()) return; if (previous?.isConnected) previous.focus({ preventScroll: true }); else restoreFocus?.(); }); }; }, []);
  return createPortal(<dialog ref={dialog} className="dialog parameter-change-dialog" aria-label={change.kind ? '更改参数类型' : '删除参数'} onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => { event.stopPropagation(); if (['F5', 'F6'].includes(event.key) || (event.ctrlKey || event.metaKey) && ['s', 'z', 'y'].includes(event.key.toLowerCase())) event.preventDefault(); }}>
    <h2>{change.kind ? `将“${variable?.name}”改为${parameterKindNames[change.kind]}？` : `删除“${variable?.name}”？`}</h2>
    <p>{change.kind ? `当前为${variable ? parameterTypeName(variable) : ''}参数。更改后重置初始值和控件范围／选项；已有引用保留，类型不符的位置会出现在问题列表。` : '可以把引用转给同类型参数，或保留失效引用供后续修复。此操作可以撤销。'}</p>
    <h3>引用位置 · {usages.length}</h3>
    <ParameterUsageList usages={usages} locate={locate ? usage => { close(); locate(usage); } : undefined} />
    {!change.kind && usages.length > 0 && <label className="parameter-replacement">引用如何处理<select aria-label="引用如何处理" value={replacement} onChange={event => setReplacement(event.target.value)}><option value="">保留引用，稍后修复</option>{candidates.map(variable => <option key={variable.id} value={variable.id}>替换为：{variable.name}</option>)}</select></label>}
    {replacement && <p className="parameter-help">引用将使用目标参数的值与存储方式，原参数的玩家数据不会合并。</p>}
    {error && <p role="alert">{error}</p>}
    <footer><button type="button" autoFocus onClick={close}>取消</button><button type="button" className={change.kind ? 'primary' : 'danger-text'} disabled={!variable} onClick={() => { try { apply(replacement || undefined); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); } }}>{change.kind ? '确认更改类型' : replacement ? '替换引用并删除' : '确认删除参数'}</button></footer>
  </dialog>, document.body);
}
