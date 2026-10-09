import type { Project } from './model';

export interface UiDraft { base: Project; value: Project }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Apply only authored changes, preserving imports and other edits made outside the UI draft. */
function merge(base: any, value: any, current: any): any {
  if (same(base, value)) return current;
  if (Array.isArray(base) && Array.isArray(value) && Array.isArray(current)
    && [...base, ...value, ...current].every(item => item && typeof item.id === 'string')) {
    const before = new Map(base.map(item => [item.id, item]));
    const after = new Map(value.map(item => [item.id, item]));
    const result = current.filter(item => !before.has(item.id) || after.has(item.id))
      .map(item => after.has(item.id) ? merge(before.get(item.id), after.get(item.id), item) : item);
    const ids = new Set(result.map(item => item.id));
    const merged = [...result, ...value.filter(item => !ids.has(item.id) && !before.has(item.id))];
    // ID-based merging must preserve deliberate list order (gallery groups,
    // selector options, etc.), while property-only edits keep concurrent order.
    const commonBefore = base.filter(item => after.has(item.id)).map(item => item.id);
    const commonAfter = value.filter(item => before.has(item.id)).map(item => item.id);
    if (!same(commonBefore, commonAfter) || value.some(item => !before.has(item.id))) {
      const byId = new Map(merged.map(item => [item.id, item]));
      return [...value.flatMap(item => byId.has(item.id) ? [byId.get(item.id)] : []), ...merged.filter(item => !after.has(item.id))];
    }
    return merged;
  }
  if (base && value && current && !Array.isArray(base) && typeof base === 'object' && typeof value === 'object' && typeof current === 'object') {
    const result = { ...current };
    for (const key of new Set([...Object.keys(base), ...Object.keys(value)])) {
      if (same(base[key], value[key])) continue;
      if (!(key in value)) delete result[key];
      else result[key] = merge(base[key], value[key], current[key]);
    }
    return result;
  }
  return value;
}

export function applyUiDraft(current: Project, draft?: UiDraft): Project {
  return draft ? merge(draft.base, draft.value, current) : current;
}

export function uiDraftChanged(draft?: UiDraft): boolean {
  return !!draft && !same(draft.base, draft.value);
}
