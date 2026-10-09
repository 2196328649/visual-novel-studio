import { useSyncExternalStore } from 'react';
const selected = new Map<string, string>();
const listeners = new Set<() => void>();
export function selectBrowserAsset(projectId: string, assetId: string) {
  if (selected.get(projectId) === assetId) return;
  selected.set(projectId, assetId);
  listeners.forEach(listener => listener());
}
export function useBrowserAsset(projectId: string) {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => selected.get(projectId));
}
