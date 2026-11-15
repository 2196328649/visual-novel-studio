/** Editor-only disclosure preferences; never part of a project or runtime state. */
export function createUiInspectorGroupMemory() {
  const values = new Map<string, boolean>();
  const listeners = new Map<string, Set<() => void>>();
  const key = (task: string, group: string) => JSON.stringify([task, group]);
  return {
    get(task: string, group: string, fallback: boolean) { return values.get(key(task, group)) ?? fallback; },
    set(task: string, group: string, open: boolean) {
      const id = key(task, group);
      if (values.get(id) === open) return;
      values.set(id, open);
      for (const listener of listeners.get(id) ?? []) listener();
    },
    subscribe(task: string, group: string, listener: () => void) {
      const id = key(task, group), groupListeners = listeners.get(id) ?? new Set<() => void>();
      groupListeners.add(listener); listeners.set(id, groupListeners);
      return () => { groupListeners.delete(listener); if (!groupListeners.size) listeners.delete(id); };
    },
  };
}
export type UiInspectorGroupMemory = ReturnType<typeof createUiInspectorGroupMemory>;

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim();
export function uiInspectorSearchMatches(query: string, labels: readonly string[]): boolean {
  const text = normalize(labels.join(' '));
  return normalize(query).split(/\s+/).filter(Boolean).every(term => text.includes(term));
}

/** Searching temporarily reveals a group without changing its saved preference. */
export function uiInspectorGroupVisibility(query: string, labels: readonly string[], preferredOpen: boolean, parentMatched = false) {
  const searching = !!query.trim();
  const matched = searching && (parentMatched || uiInspectorSearchMatches(query, labels));
  return { searching, matched, hidden: searching && !matched, open: matched || preferredOpen };
}

/** Older inspector trees index some deep field names only on their ancestors. */
export type UiInspectorSearchChildren = 'all' | 'title';

/** A field keyword can reveal a parent without revealing its unrelated children.
 * Title mode is opt-in for trees whose nested groups have complete field indexes.
 * An explicit ancestor group-name match keeps revealing all of its descendants. */
export function uiInspectorChildSearchMatch(query: string, labels: readonly string[], groupNames: readonly string[], parentMatched = false, mode: UiInspectorSearchChildren = 'all') {
  return !!query.trim() && (parentMatched || (mode === 'title'
    ? groupNames.some(name => uiInspectorSearchMatches(query, [name]))
    : uiInspectorSearchMatches(query, labels)));
}
