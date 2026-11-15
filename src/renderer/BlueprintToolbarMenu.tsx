import { useLayoutEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';

/** Native top-layer popover: toolbars may shrink without clipping their commands. */
export function BlueprintToolbarMenu({ children, warning }: { children: ReactNode; warning?: string }) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      if (!trigger.current || !menu.current) return;
      const anchor = trigger.current.getBoundingClientRect(), bounds = menu.current.getBoundingClientRect();
      menu.current.style.left = Math.max(8, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 8)) + 'px';
      menu.current.style.top = Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - bounds.height - 8)) + 'px';
    };
    position();
    const observer = new ResizeObserver(position); observer.observe(menu.current!); observer.observe(trigger.current!);
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [open]);
  const escape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !menu.current?.matches(':popover-open')) return;
    event.preventDefault(); event.stopPropagation(); menu.current.hidePopover(); trigger.current?.focus();
  };
  return <>
    <button ref={trigger} type="button" className="icon-button blueprint-options-trigger" aria-label="蓝图选项" title={warning ? '蓝图选项 · ' + warning : '蓝图选项：归属、自动接线、环境筛选与连线列表'} aria-expanded={open} aria-haspopup="dialog" aria-controls={id} data-warning={!!warning} popoverTarget={id} onKeyDown={escape}><SlidersHorizontal size={16} /></button>
    <div ref={menu} id={id} popover="auto" role="dialog" aria-label="蓝图选项" className="blueprint-toolbar-menu" onToggle={event => setOpen(event.currentTarget.matches(':popover-open'))}
      onKeyDown={event => { escape(event); event.stopPropagation(); }}
      onClick={event => { if ((event.target as Element).closest('button')) menu.current?.hidePopover(); }}>
      <header><strong>蓝图选项</strong><button type="button" autoFocus className="icon-button" aria-label="关闭蓝图选项" title="关闭蓝图选项" onClick={() => { menu.current?.hidePopover(); trigger.current?.focus(); }}><X size={15} /></button></header>
      {children}
    </div>
  </>;
}
