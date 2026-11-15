import { Activity, createContext, useCallback, useContext, useId, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { UiAuthoringSession } from './ui-authoring-session';
import './ui-event-sidebar.css';

interface SidebarNavigation {
  active: string;
  select(key: string): void;
  search: string;
  setSearch(value: string): void;
  setFallback(value: string): void;
}
interface DetailRegistry {
  host: HTMLDivElement | null;
  setHost: (element: HTMLDivElement | null) => void;
  register: (token: string, id: string) => () => void;
  ids: ReadonlyMap<string, string>;
  fallback: string;
}
const NavigationContext = createContext<SidebarNavigation | undefined>(undefined);
const DetailContext = createContext<DetailRegistry | undefined>(undefined);
const DraftContext = createContext<Map<string, unknown> | undefined>(undefined);

/** A sidebar selection is independent of the canvas selection. Navigating the
 * directory must not rewrite a graph's selection or discard editor drafts. */
export function UiEventSidebarProvider({ session, fallback: initialFallback, children }: {
  session: UiAuthoringSession;
  fallback: string;
  children: ReactNode;
}) {
  const [fallback, setFallback] = useState(initialFallback);
  const [active, setActive] = useState(() => session.sidebar.active ?? initialFallback);
  const [search, setSearch] = useState(session.query);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  // Activity temporarily detaches refs while keeping the DOM. Keep the portal
  // target during that period so its child forms retain their state as well.
  const mountHost = useCallback((element: HTMLDivElement | null) => { if (element) setHost(element); }, []);
  const [ids, setIds] = useState<ReadonlyMap<string, string>>(() => new Map());
  const select = useCallback((key: string) => setActive(key === 'graph' ? fallback : key), [fallback]);
  const register = useCallback((token: string, id: string) => {
    setIds(current => new Map(current).set(token, id));
    return () => setIds(current => { const next = new Map(current); next.delete(token); return next; });
  }, []);
  useLayoutEffect(() => { session.sidebar.active = active; session.query = search; }, [session, active, search]);
  const navigation = useMemo(() => ({ active, select, search, setSearch, setFallback }), [active, select, search]);
  const registry = useMemo(() => ({ host, setHost: mountHost, register, ids, fallback }), [host, mountHost, register, ids, fallback]);
  return <NavigationContext.Provider value={navigation}><DetailContext.Provider value={registry}><DraftContext.Provider value={session.sidebar.drafts}>{children}</DraftContext.Provider></DetailContext.Provider></NavigationContext.Provider>;
}

export function useUiEventSidebar() { return useContext(NavigationContext); }

/** Session-only form state, keyed by owning page/graph. Ordinary blueprints use
 * local state; directory navigation never commits a partially written member. */
export function useUiEventDraft<T>(key: string, initial: T | (() => T)) {
  const drafts = useContext(DraftContext);
  const state = useState<T>(() => drafts?.has(key) ? drafts.get(key) as T : typeof initial === 'function' ? (initial as () => T)() : initial);
  useLayoutEffect(() => { drafts?.set(key, state[0]); }, [drafts, key, state[0]]);
  return state;
}

/** Nested animation/timeline editors retain their own established inspectors. */
export function WithoutUiEventSidebar({ children }: { children: ReactNode }) {
  return <NavigationContext.Provider value={undefined}><DetailContext.Provider value={undefined}><DraftContext.Provider value={undefined}>{children}</DraftContext.Provider></DetailContext.Provider></NavigationContext.Provider>;
}

/** The one persistent portal target. Collapsing the sidebar must keep it mounted. */
export function UiEventDetailHost() {
  const navigation = useUiEventSidebar();
  const registry = useContext(DetailContext);
  if (!navigation || !registry) return null;
  const available = [...registry.ids.values()].includes(navigation.active);
  return <div className="ui-event-detail-host" ref={registry.setHost} data-detail-key={navigation.active}>
    {!available && <div className="ui-event-detail-empty" role="status"><p>当前对象已不存在，或不属于这张事件图。</p><button type="button" className="small-button" onClick={() => navigation.select(registry.fallback)}>查看本图设置</button></div>}
  </div>;
}

export function UiEventDetail({ id, title, kind, children }: { id: string; title: string; kind?: string; children: ReactNode }) {
  const navigation = useUiEventSidebar();
  const registry = useContext(DetailContext);
  const token = useId();
  const [visited, setVisited] = useState(false);
  const active = navigation?.active === id;
  const register = registry?.register;
  useLayoutEffect(() => register?.(token, id), [register, token, id]);
  useLayoutEffect(() => { if (active) setVisited(true); }, [active]);
  if (!navigation || !registry?.host || !active && !visited) return null;
  return createPortal(<Activity mode={active ? 'visible' : 'hidden'}><section className="ui-event-detail" aria-label={title} data-detail-id={id} data-detail-kind={id.split(':')[0]}>
    <header className="ui-event-detail-heading"><strong>{title}</strong>{kind && <small>{kind}</small>}</header>
    <div className="ui-event-detail-body">{children}</div>
  </section></Activity>, registry.host, id);
}
