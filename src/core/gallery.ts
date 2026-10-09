import type { Condition, GalleryGroup, Project, UiComponent, VariableValue } from './model';
import { matches } from './preview-route';

/** An explicit empty group list stays empty; absent groups retain flat gallery behavior. */
export function galleryEntries(project: Pick<Project, 'assets'>, component: UiComponent): GalleryGroup[] {
  const images = project.assets.filter(asset => asset.kind === 'image');
  const imageMap = new Map(images.map(asset => [asset.id, asset]));
  if (component.list?.galleryGroups) return component.list.galleryGroups.map(group => ({
    ...group, assetIds: group.assetIds.filter(id => imageMap.has(id)),
    thumbnailAssetId: imageMap.has(group.thumbnailAssetId ?? '') ? group.thumbnailAssetId : group.assetIds.find(id => imageMap.has(id)),
  }));
  return (component.list?.assetIds ?? images.map(asset => asset.id)).flatMap(id => {
    const asset = imageMap.get(id);
    const unlockWhen = component.list?.galleryUnlockWhen?.[id];
    return asset ? [{ id, name: asset.name, thumbnailAssetId: id, assetIds: [id], ...(unlockWhen ? { unlockWhen } : {}) }] : [];
  });
}

export function galleryRuntimeEntries(project: Pick<Project, 'assets'>, component: UiComponent) {
  const paths = new Map(project.assets.map(asset => [asset.id, asset.path.replaceAll('\\', '/')]));
  return galleryEntries(project, component).map(group => ({
    id: group.id, name: group.name, thumbnailPath: paths.get(group.thumbnailAssetId ?? ''),
    variants: group.assetIds.map(id => ({ id, path: paths.get(id)!, ...(galleryUnlockCondition(component, group, id) ? { unlockWhen: galleryUnlockCondition(component, group, id) } : {}) })),
  }));
}

export function galleryUnlockCondition(component: UiComponent, group: GalleryGroup, id: string): Condition | undefined {
  return group.variantUnlockWhen?.[id] ?? group.unlockWhen ?? component.list?.galleryUnlockWhen?.[id];
}

export function conditionParameterIds(condition: Condition): string[] {
  return condition.kind === 'compare' ? [condition.variableId] : condition.kind === 'not' ? conditionParameterIds(condition.condition) : [...new Set(condition.conditions.flatMap(conditionParameterIds))];
}

export function galleryUnlockedAssets(component: UiComponent, group: GalleryGroup, unlocks?: readonly string[], values: Record<string, VariableValue> = {}): string[] {
  if (unlocks === undefined) return group.assetIds;
  return group.assetIds.filter(id => {
    const condition = galleryUnlockCondition(component, group, id);
    return condition ? conditionParameterIds(condition).every(id => id in values) && matches(condition, values) : unlocks.includes(id);
  });
}

export function galleryPagination(count: number, activePage = 0, limit = 9) {
  const pages = Math.max(1, count), page = Math.max(0, Math.min(activePage, pages - 1));
  const visible = Math.max(1, Math.min(limit, pages));
  const start = Math.max(0, Math.min(page - Math.floor(visible / 2), pages - visible));
  return { page, overflow: pages > visible, numbers: Array.from({ length: visible }, (_, i) => start + i) };
}
