import type { Project } from './model';
import { sameProjectValue } from './project-history';

export interface UiDraft { base: Project; value: Project }
const same = sameProjectValue;

function customEntryArray(path: readonly (string | number)[]) {
  // nodeId is an identity only for this saved flow-entry collection.
  return path.length >= 7
    && path[path.length - 4] === 'list'
    && path[path.length - 3] === 'flowContent'
    && path[path.length - 2] === 'custom'
    && path[path.length - 1] === 'entries'
    && path.includes('components');
}

/** Apply only authored changes, preserving imports and other edits made outside the UI draft. */
function merge(base: any, value: any, current: any, path: (string | number)[] = []): any {
  if (base === current || value === current) return value;
  if (same(base, current)) return value;
  if (same(base, value)) return current;
  const flowEntries = customEntryArray(path);
  const key = flowEntries ? 'nodeId' : 'id';
  const entriesHaveUniqueKeys = (items: any[]) => items.every(item => item && typeof item[key] === 'string')
    && new Set(items.map(item => item[key])).size === items.length;
  if (flowEntries && Array.isArray(base) && Array.isArray(value) && Array.isArray(current)
    && ![base, value, current].every(entriesHaveUniqueKeys)) return current;
  if (Array.isArray(base) && Array.isArray(value) && Array.isArray(current)
    && (flowEntries
      ? [base, value, current].every(entriesHaveUniqueKeys)
      : [...base, ...value, ...current].every(item => item && typeof item.id === 'string'))) {
    const before = new Map(base.map(item => [item[key], item]));
    const after = new Map(value.map(item => [item[key], item]));
    const result = current.filter(item => !before.has(item[key]) || after.has(item[key]))
      .map(item => after.has(item[key]) ? merge(before.get(item[key]), after.get(item[key]), item, [...path, item[key]]) : item);
    const ids = new Set(result.map(item => item[key]));
    const merged = [...result, ...value.filter(item => !ids.has(item[key]) && !before.has(item[key]))];
    // ID-based merging must preserve deliberate list order (gallery groups,
    // selector options, etc.), while property-only edits keep concurrent order.
    const commonBefore = base.filter(item => after.has(item[key])).map(item => item[key]);
    const commonAfter = value.filter(item => before.has(item[key])).map(item => item[key]);
    if (!same(commonBefore, commonAfter) || value.some(item => !before.has(item[key]))) {
      const byId = new Map(merged.map(item => [item[key], item]));
      return [...value.flatMap(item => byId.has(item[key]) ? [byId.get(item[key])] : []), ...merged.filter(item => !after.has(item[key]))];
    }
    return merged;
  }
  if (base && value && current && !Array.isArray(base) && typeof base === 'object' && typeof value === 'object' && typeof current === 'object') {
    const result = { ...current };
    for (const key of new Set([...Object.keys(base), ...Object.keys(value)])) {
      if (same(base[key], value[key])) continue;
      if (!(key in value)) delete result[key];
      else result[key] = merge(base[key], value[key], current[key], [...path, key]);
    }
    return result;
  }
  return value;
}

export function applyUiDraft(current: Project, draft?: UiDraft): Project {
  return !draft || draft.base === draft.value ? current : merge(draft.base, draft.value, current);
}

export function uiDraftChanged(draft?: UiDraft): boolean {
  return !!draft && !same(draft.base, draft.value);
}
