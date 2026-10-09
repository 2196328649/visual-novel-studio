import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ParameterMenuAction {
  label: string; shortcut?: string; disabled?: boolean; danger?: boolean; separator?: boolean; run: () => void;
}
export function ParameterContextMenu({ x, y, actions, close }: { x: number; y: number; actions: ParameterMenuAction[]; close: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const bounds = menu.current!.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8)) });
    menu.current!.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [x, y]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) close(); };
    const blur = () => close();
    window.addEventListener('pointerdown', outside); window.addEventListener('blur', blur); window.addEventListener('resize', blur);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('blur', blur); window.removeEventListener('resize', blur); };
  }, [close]);
  return createPortal(<div ref={menu} className="parameter-context-menu" role="menu" aria-label="参数操作" style={position} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); close(); return; }
    const buttons = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  }}>{actions.map((action, index) => <button key={index} type="button" role="menuitem" aria-label={action.label} disabled={action.disabled} className={`${action.danger ? 'danger-text' : ''} ${action.separator ? 'menu-separator' : ''}`} onClick={() => { close(); action.run(); }}><span>{action.label}</span>{action.shortcut && <kbd>{action.shortcut}</kbd>}</button>)}</div>, document.body);
}
