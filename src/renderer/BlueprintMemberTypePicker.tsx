import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { BlueprintDataType } from '../core/blueprint';
import { BlueprintMemberType } from './BlueprintMembers';
import { blueprintMemberTypes } from './blueprint-member-types';

/** A small, explained type list. Native popovers also work inside modal member editors. */
export function BlueprintMemberTypePicker<T extends BlueprintDataType>({ value, types, label, onChange, disabled = false }: {
  value: T; types: readonly T[]; label: string; onChange(type: T): void; disabled?: boolean;
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState<T>(value);
  const groups = [...new Set(types.map(type => blueprintMemberTypes[type].group))];
  const optionId = (type: T) => `${id}-${type}`;
  const close = (restoreFocus = false) => {
    if (panel.current?.matches(':popover-open')) panel.current.hidePopover();
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };
  const show = (next = types.includes(value) ? value : types[0]) => {
    if (disabled || !types.length || !panel.current) return;
    setActive(next);
    if (!panel.current.matches(':popover-open')) panel.current.showPopover();
    setOpen(true);
    panel.current.focus({ preventScroll: true });
  };
  const choose = (next: T) => {
    if (disabled || !types.includes(next)) return;
    close(true);
    if (next !== value) onChange(next);
  };
  useLayoutEffect(() => {
    if (!open || !trigger.current || !panel.current) return;
    const position = () => {
      if (!trigger.current || !panel.current) return;
      const anchor = trigger.current.getBoundingClientRect(), bounds = panel.current.getBoundingClientRect();
      const below = window.innerHeight - anchor.bottom - 8, above = anchor.top - 8;
      const top = below >= bounds.height || below >= above ? anchor.bottom + 4 : anchor.top - bounds.height - 4;
      panel.current.style.left = Math.max(8, Math.min(anchor.left, window.innerWidth - bounds.width - 8)) + 'px';
      panel.current.style.top = Math.max(8, Math.min(top, window.innerHeight - bounds.height - 8)) + 'px';
    };
    position();
    const observer = new ResizeObserver(position); observer.observe(panel.current); observer.observe(trigger.current);
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const option = document.getElementById(optionId(active));
    if (!option) return;
    const item = option.getBoundingClientRect(), viewport = panel.current.getBoundingClientRect();
    if (item.top < viewport.top + 5) panel.current.scrollTop -= viewport.top + 5 - item.top;
    else if (item.bottom > viewport.bottom - 5) panel.current.scrollTop += item.bottom - viewport.bottom + 5;
  }, [open, active]);
  useLayoutEffect(() => {
    if (disabled && panel.current?.matches(':popover-open')) close();
  }, [disabled]);
  const handleKeys = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const index = types.indexOf(active);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? types.length - 1 : event.key === 'ArrowDown' ? Math.min(index + 1, types.length - 1) : Math.max(index - 1, 0);
      if (types[next]) setActive(types[next]);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); choose(active);
    } else if (event.key === 'Escape') {
      event.preventDefault(); close(true);
    } else if (event.key === 'Tab') {
      // Resume native tab order from the trigger, without stealing the next control's focus.
      close(); trigger.current?.focus({ preventScroll: true });
    }
  };
  return <span className="blueprint-member-type-picker">
    <button ref={trigger} type="button" role="combobox" className="blueprint-member-type-trigger" aria-label={label}
      aria-expanded={open} aria-controls={id} aria-haspopup="listbox" popoverTarget={id} disabled={disabled || !types.length}
      title={`${blueprintMemberTypes[value].name}：${blueprintMemberTypes[value].description}`} onClick={event => { event.preventDefault(); event.stopPropagation(); if (panel.current?.matches(':popover-open')) close(true); else show(); }}
      onKeyDown={event => {
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation(); show(event.key === 'Home' ? types[0] : event.key === 'End' ? types[types.length - 1] : undefined);
        } else if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
        else if (event.key === 'Escape' && panel.current?.matches(':popover-open')) { event.preventDefault(); event.stopPropagation(); close(true); }
      }}><BlueprintMemberType type={value} /><ChevronDown size={12} aria-hidden="true" /></button>
    <div ref={panel} id={id} popover="auto" role="listbox" aria-label={`${label}选项`} tabIndex={-1}
      aria-activedescendant={open && types.includes(active) ? optionId(active) : undefined} className="blueprint-member-type-menu"
      onToggle={event => setOpen(event.currentTarget.matches(':popover-open'))} onKeyDown={handleKeys}
      onClick={event => { event.preventDefault(); event.stopPropagation(); }}>
      {groups.map(group => <div key={group} role="group" aria-label={group} className="blueprint-member-type-group">
        <div className="blueprint-member-type-group-label" aria-hidden="true">{group}</div>
        {types.filter(type => blueprintMemberTypes[type].group === group).map(type => {
          const info = blueprintMemberTypes[type], itemId = optionId(type);
          return <button key={type} id={itemId} type="button" role="option" tabIndex={-1} aria-selected={type === value}
            aria-labelledby={`${itemId}-name`} aria-describedby={`${itemId}-help`} className="blueprint-member-type-option" data-active={active === type || undefined}
            onPointerMove={() => { if (active !== type) setActive(type); }} onClick={() => choose(type)}>
            <span id={`${itemId}-name`}><BlueprintMemberType type={type} /></span>{type === value && <Check size={13} aria-hidden="true" />}
            <span id={`${itemId}-help`} className="blueprint-member-type-explanation"><span>{info.description}</span><small>{info.example}</small></span>
          </button>;
        })}
      </div>)}
    </div>
  </span>;
}
