import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Shared top-layer panel for the assistant's infrequent actions and reference options. */
export function AiPopover({ label, trigger, children, disabled = false, active = false, className = '' }: {
  label: string; trigger: ReactNode; children: ReactNode; disabled?: boolean; active?: boolean; className?: string;
}) {
  const id = useId(), button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = (restoreFocus: boolean) => {
    panel.current?.hidePopover();
    if (restoreFocus) button.current?.focus();
  };
  useLayoutEffect(() => {
    if (disabled && open) close(false);
  }, [disabled, open]);
  useLayoutEffect(() => {
    if (!open || !panel.current || !button.current) return;
    const position = () => {
      if (!panel.current || !button.current) return;
      const anchor = button.current.getBoundingClientRect(), box = panel.current.getBoundingClientRect();
      const below = innerHeight - anchor.bottom - 8, above = anchor.top - 8;
      const top = below >= box.height || below >= above ? anchor.bottom + 5 : anchor.top - box.height - 5;
      panel.current.style.left = Math.max(8, Math.min(anchor.right - box.width, innerWidth - box.width - 8)) + 'px';
      panel.current.style.top = Math.max(8, Math.min(top, innerHeight - box.height - 8)) + 'px';
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(panel.current); observer.observe(button.current);
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [open]);
  return <>
    <button ref={button} type="button" className={`ai-popover-trigger ${className}`} aria-label={label} title={label}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={id} data-active={active || undefined} disabled={disabled} popoverTarget={id}
      onKeyDown={event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); panel.current?.showPopover(); panel.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')?.focus(); }
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); }
      }}>{trigger}</button>
    <div ref={panel} id={id} className="ai-popover" popover="auto" role="dialog" aria-label={label}
      onToggle={event => setOpen(event.currentTarget.matches(':popover-open'))}
      onClick={event => { if ((event.target as Element).closest('[data-ai-close-popover]')) close(false); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); close(true); }
        event.stopPropagation();
      }}>
      <strong className="ai-popover-heading">{label}</strong>
      {children}
    </div>
  </>;
}
