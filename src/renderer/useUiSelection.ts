import { useMemo, useState } from 'react';

/** Keep the inspector's primary selection while allowing a transient design-only group. */
export function useUiSelection(scope: string, availableIds: readonly string[], primary: string | undefined, selectPrimary: (id?: string) => void) {
  const [group, setGroup] = useState<{ scope: string; primary?: string; ids: string[] }>();
  const availableKey = availableIds.join('/');
  const ids = useMemo(() => {
    const candidates = group?.scope === scope && group.primary === primary ? group.ids : primary ? [primary] : [];
    const available = new Set(availableIds);
    return candidates.filter(id => available.has(id));
  }, [group, scope, primary, availableKey]);
  const selectMany = (next: readonly string[], primaryId = next.at(-1)) => {
    const valid = [...new Set(next)];
    const last = primaryId && valid.includes(primaryId) ? primaryId : valid.at(-1);
    setGroup({ scope, ids: valid, primary: last }); selectPrimary(last);
  };
  const select = (id?: string, additive = false) => {
    if (!id) { selectMany([]); return; }
    selectMany(additive ? ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id] : [id]);
  };
  return { ids, select, selectMany };
}
