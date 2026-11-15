/** Compare persisted values without serializing whole immutable snapshots.
 * Optional undefined object fields have the same meaning as omitted fields. */
export function sameProjectValue(before: unknown, next: unknown): boolean {
  if (before === next) return true;
  if (!before || !next || typeof before !== 'object' || typeof next !== 'object') return false;
  if (Array.isArray(before) || Array.isArray(next)) {
    return Array.isArray(before) && Array.isArray(next) && before.length === next.length
      && before.every((value, index) => sameProjectValue(value, next[index]));
  }
  const a = before as Record<string, unknown>, b = next as Record<string, unknown>;
  const keys = Object.keys(a).filter(key => a[key] !== undefined);
  return keys.length === Object.keys(b).filter(key => b[key] !== undefined).length
    && keys.every(key => Object.hasOwn(b, key) && sameProjectValue(a[key], b[key]));
}

/** Only consecutive edits to one existing field may share a typing undo step. */
export function singleProjectChange(before: unknown, next: unknown): string | undefined {
  let changed: string | undefined, multiple = false;
  const visit = (a: any, b: any, path: string[]) => {
    if (a === b || multiple) return;
    if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
      const keys = Object.keys(a);
      if (keys.length !== Object.keys(b).length || keys.some(key => !Object.hasOwn(b, key))) { multiple = true; return; }
      for (const key of keys) visit(a[key], b[key], [...path, key]);
      return;
    }
    if (changed !== undefined) multiple = true;
    else changed = JSON.stringify(path);
  };
  visit(before, next, []);
  return multiple ? undefined : changed;
}

/** Retain unchanged JSON branches so a small edit only invalidates its consumers. */
export function shareProjectBranches<T>(before: T, next: T): T {
  if (Object.is(before, next)) return before;
  if (!before || !next || typeof before !== 'object' || typeof next !== 'object' || Array.isArray(before) !== Array.isArray(next)) return next;
  const a = before as Record<string, unknown>, b = next as Record<string, unknown>;
  const keys = Object.keys(b);
  let equal = keys.length === Object.keys(a).length;
  for (const key of keys) {
    if (!Object.hasOwn(a, key)) { equal = false; continue; }
    b[key] = shareProjectBranches(a[key], b[key]);
    if (!Object.is(a[key], b[key])) equal = false;
  }
  return equal ? before : next;
}
