import { useMemo, useRef } from 'react';

/** Stable event handlers let memoized canvas nodes and edges ignore unrelated
 * inspector renders. Their closures always read the latest authored project.
 * Callers supply the same handler keys on every render. */
export function useStableCallbacks<T extends { [K in keyof T]: (...args: any[]) => any }>(callbacks: T): T {
  const latest = useRef(callbacks);
  latest.current = callbacks;
  return useMemo(() => Object.fromEntries(Object.keys(callbacks).map(key => [key, (...args: unknown[]) => latest.current[key as keyof T](...args)])) as T, []);
}
