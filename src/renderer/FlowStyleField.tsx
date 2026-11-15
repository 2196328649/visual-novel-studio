import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Field } from './components';
import { ParameterContextMenu } from './ParameterContextMenu';

/** Flow styles have their own write scope, never the root UiComponent binding scope. */
export function FlowStyleField({ label, children, source, scope, canReset = false, onReset, resetLabel = '恢复继承', onFocus, raw = false, hint, className = '' }: {
  label: string; children: ReactNode; source: string; scope: string;
  canReset?: boolean; onReset?: () => void; resetLabel?: string; onFocus?: () => void;
  /** Reuse a complete shared field, such as the RGB/RGBA editor, without nested labels. */
  raw?: boolean; hint?: string; className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; scope: string; anchor?: HTMLElement }>();
  const current = useRef({ scope, canReset, onReset }); current.current = { scope, canReset, onReset };
  useEffect(() => { setMenu(undefined); }, [scope]);
  const close = () => {
    setMenu(undefined);
    const anchor = menu?.anchor, openedScope = menu?.scope;
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (current.current.scope !== openedScope || !document.hasFocus() || active && active !== document.body && !active.closest('.parameter-context-menu')) return;
      if (anchor?.isConnected && !anchor.matches(':disabled') && !anchor.closest('[hidden], [inert], fieldset:disabled') && anchor.getClientRects().length) anchor.focus({ preventScroll: true });
    });
  };
  const open = (event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>, point?: { x: number; y: number }) => {
    const target = event.target;
    // Asset browsers and menus use portals; their events must not reach this scope.
    if (event.defaultPrevented || !(target instanceof Element) || !event.currentTarget.contains(target)
      || target.closest('.flow-style-field') !== event.currentTarget || target.closest('.field-help, a, summary')) return;
    event.preventDefault(); event.stopPropagation(); onFocus?.();
    const control = target.closest<HTMLElement>('input, select, textarea, button, [tabindex]');
    const anchor = control && host.current?.contains(control) ? control : host.current?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)') ?? undefined;
    const rect = (anchor ?? event.currentTarget).getBoundingClientRect();
    setMenu({ ...point ?? { x: rect.left, y: rect.bottom }, scope, anchor });
  };
  return <div ref={host} className={`flow-style-field ${className}`} data-flow-field={label} data-flow-field-source={source} title={source}
    onFocus={event => { if (event.currentTarget.contains(event.target)) onFocus?.(); }}
    onContextMenu={event => open(event, { x: event.clientX, y: event.clientY })}
    onKeyDown={event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') open(event); }}>
    {/* A new write scope also retires unfinished numeric, color and asset drafts. */}
    <Fragment key={scope}>{raw ? children : <Field label={label} hint={hint}>{children}</Field>}</Fragment>
    {menu && menu.scope === scope && <ParameterContextMenu x={menu.x} y={menu.y} close={close} actions={[
      { label: `来源：${source}`, disabled: true, run: () => {} },
      { label: resetLabel, disabled: !canReset || !onReset, run: () => { if (current.current.scope === menu.scope && current.current.canReset) current.current.onReset?.(); } },
      ...(!canReset || !onReset ? [{ label: '关闭菜单', run: () => {} }] : []),
    ]} />}
  </div>;
}
