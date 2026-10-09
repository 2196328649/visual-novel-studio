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
