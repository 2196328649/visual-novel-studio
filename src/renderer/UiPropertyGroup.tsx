import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { uiInspectorChildSearchMatch, uiInspectorGroupVisibility, type UiInspectorSearchChildren } from '../core/ui-inspector-session';
import { UiInspectorSearchScope, useUiInspectorContext, useUiInspectorGroupActive, useUiInspectorGroupPreference, useUiInspectorParentSearchMatch, useUiInspectorSearchChildren } from './UiInspectorContext';

export function UiPropertyGroup({ id, title, icon, summary, defaultOpen = false, className = '', children, revealOn, searchKeywords = [], searchGroupNames = [], searchChildren, lazy }: {
  id?: string; title: string; icon?: ReactNode; summary?: string; defaultOpen?: boolean; className?: string; children: ReactNode; revealOn?: string;
  searchKeywords?: string | readonly string[];
  /** Explicit names for the entire group; field keywords belong in searchKeywords. */
  searchGroupNames?: string | readonly string[];
  /** Inherits through the tree. Use title when every nested field has its own index. */
  searchChildren?: UiInspectorSearchChildren;
  /** Mount on first opening, then retain local drafts while the group is closed. */
  lazy?: boolean;
}) {
  const groupId = id ?? title, context = useUiInspectorContext(), parentMatched = useUiInspectorParentSearchMatch();
  const inheritedSearchChildren = useUiInspectorSearchChildren(), childSearchMode = searchChildren ?? inheritedSearchChildren;
  const parentActive = useUiInspectorGroupActive();
  const [preferredOpen, setOpen] = useUiInspectorGroupPreference(groupId, defaultOpen);
  const groupNames = [title, ...(typeof searchGroupNames === 'string' ? [searchGroupNames] : searchGroupNames)];
  const labels = [groupId, ...groupNames, summary ?? '', ...(typeof searchKeywords === 'string' ? [searchKeywords] : searchKeywords)];
  const query = context?.query ?? '';
  const state = uiInspectorGroupVisibility(query, labels, preferredOpen, parentMatched);
  const childrenMatched = uiInspectorChildSearchMatch(query, labels, groupNames, parentMatched, childSearchMode);
  const mounted = useRef(false);
  if (state.open && !state.hidden) mounted.current = true;
  useEffect(() => { if (revealOn) setOpen(true); }, [revealOn, setOpen]);
  return <details className={`ui-property-group ui-inspector-group ${className}`} data-ui-inspector-group={groupId}
    data-search-match={state.searching ? String(state.matched) : undefined} hidden={state.hidden} open={state.open}
    onToggle={event => {
      if (event.target !== event.currentTarget) return;
      // Programmatic search opening must not overwrite the author's preference.
      if (state.searching) { if (event.currentTarget.open !== state.open) event.currentTarget.open = state.open; return; }
      if (event.currentTarget.open !== preferredOpen) setOpen(event.currentTarget.open);
    }}>
    <summary>{icon}<span className="ui-group-title">{title}</span>{summary && <span className="ui-group-value" title={summary}>{summary}</span>}<ChevronDown className="ui-group-chevron" size={14} aria-hidden="true" /></summary>
    {(!(lazy ?? !!context) || mounted.current) && <div className="ui-group-body"><UiInspectorSearchScope matched={childrenMatched} searchChildren={childSearchMode} active={parentActive && state.open && !state.hidden}>{children}</UiInspectorSearchScope></div>}
  </details>;
}
