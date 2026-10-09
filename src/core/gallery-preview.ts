import type { Project, UiComponent, VariableValue } from './model';
import { galleryEntries, galleryUnlockedAssets } from './gallery';

export type GalleryPreviewAction = { action: 'page'; page: number } | { action: 'open'; groupId: string } | { action: 'next' | 'previous' | 'close' };
export interface GalleryPreviewState {
  pages: Record<string, number>;
  detail?: { componentId: string; groupId: string; name: string; assetIds: string[]; index: number; fit: 'contain' | 'cover' | 'stretch'; endAction: 'close' | 'loop'; showControls: boolean };
}

/** Isolated authoring state. Undefined unlocks means all pictures are available for inspection. */
export function galleryPreviewAction(project: Pick<Project, 'assets'>, component: UiComponent, current: GalleryPreviewState, action: GalleryPreviewAction, unlocks?: readonly string[], values: Record<string, VariableValue> = {}): GalleryPreviewState {
  if (component.kind !== 'galleryGrid') return current;
  if (current.detail) {
    const detail = current.detail;
    if (detail.componentId !== component.id) return current;
    if (action.action === 'close') return { pages: current.pages };
    if (action.action === 'previous') return { ...current, detail: { ...detail, index: Math.max(0, detail.index - 1) } };
    if (action.action === 'next') {
      if (detail.index + 1 < detail.assetIds.length) return { ...current, detail: { ...detail, index: detail.index + 1 } };
      return detail.endAction === 'loop' ? { ...current, detail: { ...detail, index: 0 } } : { pages: current.pages };
    }
    return current;
  }
  const entries = galleryEntries(project, component), size = (component.list?.columns ?? 3) * (component.list?.rows ?? 2);
  const count = Math.max(1, Math.ceil(entries.length / size));
  const page = Math.min(Math.max(0, current.pages[component.id] ?? 0), count - 1);
  if (action.action === 'page') {
    if (!Number.isInteger(action.page) || action.page < 0 || action.page >= count) return current;
    return { pages: { ...current.pages, [component.id]: action.page } };
  }
  if (action.action !== 'open') return current;
  const group = entries.slice(page * size, (page + 1) * size).find(group => group.id === action.groupId);
  const assetIds = group ? galleryUnlockedAssets(component, group, unlocks, values) : [];
  if (!group || !assetIds.length) return current;
  return { pages: { ...current.pages, [component.id]: page }, detail: { componentId: component.id, groupId: group.id, name: group.name, assetIds, index: 0,
    fit: component.list?.galleryFit ?? 'contain', endAction: component.list?.galleryEndAction ?? 'close', showControls: component.list?.galleryShowControls ?? true } };
}
