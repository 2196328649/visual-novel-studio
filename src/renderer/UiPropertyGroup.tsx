import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export function UiPropertyGroup({ title, icon, summary, defaultOpen = false, className = '', children }: {
  title: string; icon?: ReactNode; summary?: string; defaultOpen?: boolean; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return <details className={`ui-property-group ui-inspector-group ${className}`} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{icon}<span className="ui-group-title">{title}</span>{summary && <span className="ui-group-value" title={summary}>{summary}</span>}<ChevronDown className="ui-group-chevron" size={14} aria-hidden="true" /></summary>
    <div className="ui-group-body">{children}</div>
  </details>;
}
