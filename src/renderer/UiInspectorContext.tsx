import { createContext, useCallback, useContext, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { createUiInspectorGroupMemory, type UiInspectorGroupMemory, type UiInspectorSearchChildren } from '../core/ui-inspector-session';
import './ui-inspector-groups.css';

interface UiInspectorContextValue {
  /** Page/scheme and actual editor mode, deliberately excluding the selected ID. */
  taskKey: string;
  query: string;
  memory: UiInspectorGroupMemory;
}
const sessionMemory = createUiInspectorGroupMemory();
const UiInspectorContext = createContext<UiInspectorContextValue | undefined>(undefined);
const UiInspectorSearchMatchContext = createContext(false);
const UiInspectorSearchChildrenContext = createContext<UiInspectorSearchChildren>('all');
const UiInspectorGroupActiveContext = createContext(true);

export function UiInspectorProvider({ taskKey, query = '', children }: { taskKey: string; query?: string; children: ReactNode }) {
  const value = useMemo(() => ({ taskKey, query, memory: sessionMemory }), [taskKey, query]);
  return <UiInspectorContext.Provider value={value}><UiInspectorSearchChildrenContext.Provider value="all"><UiInspectorSearchMatchContext.Provider value={false}>{children}</UiInspectorSearchMatchContext.Provider></UiInspectorSearchChildrenContext.Provider></UiInspectorContext.Provider>;
}

export function useUiInspectorContext() { return useContext(UiInspectorContext); }
/** Reveals descendants; in title mode only explicit ancestor group names set it. */
export function useUiInspectorParentSearchMatch() { return useContext(UiInspectorSearchMatchContext); }
export function useUiInspectorSearchChildren() { return useContext(UiInspectorSearchChildrenContext); }
/** Lets read-only diagnostics defer work while preserving mounted field drafts. */
export function useUiInspectorGroupActive() { return useContext(UiInspectorGroupActiveContext); }
export function UiInspectorSearchScope({ matched, active, searchChildren, children }: { matched: boolean; active: boolean; searchChildren?: UiInspectorSearchChildren; children: ReactNode }) {
  const inheritedSearchChildren = useUiInspectorSearchChildren();
  return <UiInspectorSearchMatchContext.Provider value={matched}><UiInspectorSearchChildrenContext.Provider value={searchChildren ?? inheritedSearchChildren}><UiInspectorGroupActiveContext.Provider value={active}>{children}</UiInspectorGroupActiveContext.Provider></UiInspectorSearchChildrenContext.Provider></UiInspectorSearchMatchContext.Provider>;
}

export function useUiInspectorGroupPreference(group: string, defaultOpen: boolean) {
  const context = useUiInspectorContext(), local = useRef<UiInspectorGroupMemory | undefined>(undefined);
  local.current ??= createUiInspectorGroupMemory();
  const memory = context?.memory ?? local.current, taskKey = context?.taskKey ?? '';
  const subscribe = useCallback((listener: () => void) => memory.subscribe(taskKey, group, listener), [memory, taskKey, group]);
  const read = useCallback(() => memory.get(taskKey, group, defaultOpen), [memory, taskKey, group, defaultOpen]);
  const open = useSyncExternalStore(subscribe, read, read);
  const setOpen = useCallback((value: boolean) => memory.set(taskKey, group, value), [memory, taskKey, group]);
  return [open, setOpen] as const;
}
