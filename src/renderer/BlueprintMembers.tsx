import { useEffect, useLayoutEffect, useRef, useState, type DragEventHandler, type ReactNode } from 'react';
import { GripVertical, Search, X } from 'lucide-react';
import type { BlueprintDataType } from '../core/blueprint';
import { blueprintMemberTypes } from './blueprint-member-types';
import './blueprint-members.css';

/** Request before a successful member edit rerenders; focus only that edit, never every live value update. */
export function useBlueprintMemberFocus() {
  const ref = useRef<HTMLElement>(null), [requested, setRequested] = useState<{ id?: string }>();
  useLayoutEffect(() => {
    if (!requested || !ref.current) return;
    const row = [...ref.current.querySelectorAll<HTMLElement>('[data-blueprint-member-id]')].find(element => element.dataset.blueprintMemberId === requested.id);
    const target = row?.querySelector<HTMLButtonElement>('.blueprint-member-select') ?? ref.current.querySelector<HTMLButtonElement>('.blueprint-member-select') ?? ref.current.querySelector<HTMLButtonElement>('.blueprint-member-add');
    if (target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest' }); }
  }, [requested]);
  return { ref, request: (id?: string) => setRequested({ id }) };
}

/** A confirmed removal unmounts its original delete button; keep keyboard focus in the member panel. */
export function restoreBlueprintMemberFocus(origin: HTMLElement | null, panel: Element | null | undefined) {
  if (origin?.isConnected) origin.focus({ preventScroll: true });
  else if (panel?.isConnected) (panel.querySelector<HTMLElement>('.blueprint-member-select') ?? panel.querySelector<HTMLElement>('.blueprint-member-add'))?.focus({ preventScroll: true });
}

/** A name is edited locally until blur/Enter, so clearing it or using an IME never writes a partial definition. */
export function BlueprintMemberName({ value, label, problem, onCommit }: {
  value: string; label: string; problem(value: string): string | undefined; onCommit(value: string): boolean | void;
}) {
  const [text, setText] = useState(value), [error, setError] = useState<string>();
  const previousValue = useRef(value);
  useEffect(() => {
    // Activity restores effects when a hidden detail is shown again. Only an
    // actual definition change should replace the author's unfinished name.
    if (previousValue.current === value) return;
    previousValue.current = value;
    setText(value); setError(undefined);
  }, [value]);
  const apply = () => {
    if (text === value) return;
    const invalid = problem(text);
    if (invalid) { setError(invalid); return; }
    try {
      if (onCommit(text.trim()) === false) { setError('名称未保存，请查看编辑器提示。'); return; }
      setText(text.trim()); setError(undefined);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  };
  return <span className="blueprint-member-name-field"><input aria-label={label} aria-invalid={!!error} value={text} maxLength={120}
    onChange={event => { setText(event.target.value); setError(problem(event.target.value)); }} onBlur={apply}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter') { event.preventDefault(); apply(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setText(value); setError(undefined); }
    }} />{error && <small role="alert">{error}</small>}</span>;
}

export function blueprintMemberNameProblem(name: string, members: readonly { id: string; name: string }[], id?: string) {
  const value = name.trim();
  if (!value) return '请输入名称。';
  if (value.length > 120) return '名称最多 120 字。';
  if (/[\r\n\u0000]/.test(value)) return '名称不能包含换行或空字符。';
  if (members.some(member => member.id !== id && member.name.trim() === value)) return '已有同名项，请换一个名称。';
}

export function BlueprintMemberType({ type, name = blueprintMemberTypes[type].name }: { type: BlueprintDataType; name?: string }) {
  return <span className="blueprint-member-type" data-type={type} title={name}><i aria-hidden="true" /><span>{name}</span></span>;
}

export function BlueprintMemberButton({ name, type, typeName, selected, label, onSelect, variableId, onDragStart, dragHint }: {
  name: string; type: BlueprintDataType; typeName?: string; selected: boolean; label: string; onSelect(): void;
  variableId?: string; onDragStart?: DragEventHandler<HTMLButtonElement>; dragHint?: string;
}) {
  return <button type="button" className="blueprint-member-select" aria-label={label} aria-pressed={selected} onClick={onSelect}
    draggable={!!onDragStart} onDragStart={onDragStart} title={onDragStart ? `${name} · ${dragHint ?? '拖到画布使用，也可点右侧操作按钮。'}` : name}>
    {onDragStart && <GripVertical className="blueprint-member-grip" size={10} aria-hidden="true" />}
    <span className="blueprint-member-label" data-ui-variable-id={variableId}>{name}</span>
    <BlueprintMemberType type={type} name={typeName} />
  </button>;
}

export interface BlueprintMemberAction {
  label: string; ariaLabel?: string; title?: string; disabled?: boolean; onClick(): void;
}

/** Keep direct actions outside the draggable selection target and visible to keyboard users. */
export function BlueprintMemberActions({ actions, className }: { actions: readonly BlueprintMemberAction[]; className?: string }) {
  return <div className={['blueprint-member-actions', className].filter(Boolean).join(' ')}>
    {actions.map(action => <button key={action.ariaLabel ?? action.label} type="button" draggable={false} aria-label={action.ariaLabel ?? action.label}
      title={action.title ?? action.ariaLabel ?? action.label} disabled={action.disabled} onClick={event => { event.stopPropagation(); action.onClick(); }}>{action.label}</button>)}
  </div>;
}

export function BlueprintMemberList({ query, onQuery, label, children, searchable = true }: {
  query: string; onQuery(value: string): void; label: string; children: ReactNode; searchable?: boolean;
}) {
  return <div className="blueprint-member-browser">
    {searchable && <div className="blueprint-member-search"><Search size={13} aria-hidden="true" /><input type="search" aria-label={label} placeholder={label} value={query} onChange={event => onQuery(event.target.value)} />{query && <button type="button" aria-label={'清除' + label} title="清除搜索" onClick={() => onQuery('')}><X size={12} /></button>}</div>}
    <div className="blueprint-member-list" onKeyDown={event => {
      if (!(event.target instanceof HTMLButtonElement) || !event.target.classList.contains('blueprint-member-select')) return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.blueprint-member-select')];
      const index = buttons.indexOf(event.target);
      const next = event.key === 'ArrowDown' ? Math.min(index + 1, buttons.length - 1) : event.key === 'ArrowUp' ? Math.max(index - 1, 0) : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : undefined;
      if (next === undefined || !buttons[next]) return;
      event.preventDefault(); event.stopPropagation(); buttons[next].click(); buttons[next].focus({ preventScroll: true }); buttons[next].scrollIntoView({ block: 'nearest' });
    }}>{children}</div>
  </div>;
}
