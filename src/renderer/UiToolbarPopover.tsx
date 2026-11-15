import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';

export function UiToolbarPopover({ label, icon, children, title = label, triggerId }: { label: string; title?: string; icon: ReactNode; children: ReactNode; triggerId?: string }) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      if (!trigger.current || !panel.current) return;
      const anchor = trigger.current.getBoundingClientRect(), bounds = panel.current.getBoundingClientRect();
      panel.current.style.left = Math.max(8, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - 8)) + 'px';
      panel.current.style.top = Math.max(8, Math.min(anchor.bottom + 6, innerHeight - bounds.height - 8)) + 'px';
    };
    position();
    const observer = new ResizeObserver(position); observer.observe(panel.current!);
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [open]);
  const close = () => { panel.current?.hidePopover(); setOpen(false); trigger.current?.focus(); };
  return <>
    <button ref={trigger} id={triggerId} type="button" className="icon-button ui-toolbar-popover-trigger" aria-label={label} title={title} aria-expanded={open} aria-haspopup="dialog" aria-controls={id} popoverTarget={id}>{icon}</button>
    {createPortal(<div ref={panel} id={id} popover="auto" role="dialog" aria-label={label} className="ui-toolbar-popover" onToggle={event => setOpen(event.currentTarget.matches(':popover-open'))} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); } event.stopPropagation();
    }} onClick={event => { if ((event.target as Element).closest('.ui-page-usages, [data-close-ui-popover]')) close(); }}>
      <header><strong>{label}</strong><button type="button" autoFocus className="icon-button" aria-label={'关闭' + label} onClick={close}><X size={15} /></button></header>
      {children}
    </div>, document.body)}
  </>;
}
