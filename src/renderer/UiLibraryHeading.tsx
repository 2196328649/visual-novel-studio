import { useEffect, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export interface UiLibraryCollapse { collapsed: boolean; toggle: () => void }

/** Section heading of the "我的界面" panel; with `collapse` the title folds the section like UE5's My Blueprint categories. */
export function UiLibraryHeading({ title, icon, count, collapse, children }: { title: string; icon?: ReactNode; count?: number; collapse?: UiLibraryCollapse; children?: ReactNode }) {
  const label = <>{icon}<span>{title}</span>{count !== undefined && <small>{count}</small>}</>;
  if (!collapse) return <h3>{label}{children}</h3>;
  return <h3 className="ui-library-heading"><button type="button" className="ui-library-toggle" aria-expanded={!collapse.collapsed} title={(collapse.collapsed ? '展开' : '折叠') + title} onClick={collapse.toggle}><ChevronRight size={13} aria-hidden="true" />{label}</button>{children && <span className="ui-library-actions" onClickCapture={() => { if (collapse.collapsed) collapse.toggle(); }}>{children}</span>}</h3>;
}

const storageKey = 'vns-ui-event-library-collapsed-v1';
/** Which groups of the event graph's left panel the author folded; remembered across sessions. */
export function useUiLibrarySections() {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
    try { const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]'); return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []); }
    catch { return new Set(); }
  });
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify([...collapsed])); } catch { /* Private storage only loses the folding. */ } }, [collapsed]);
  return (id: string): UiLibraryCollapse => ({ collapsed: collapsed.has(id), toggle: () => setCollapsed(previous => { const next = new Set(previous); if (!next.delete(id)) next.add(id); return next; }) });
}
