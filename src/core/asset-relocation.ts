import type { Project } from './model';

export interface AssetRelocation { assetId: string; files: Record<string, string> }

/** Disk locations are bookkeeping, not a new undo step or a story edit. */
export function relocateProjectAssets(project: Project, relocations: AssetRelocation[]): Project {
  if (!relocations.length) return project;
  const byId = new Map(relocations.map(item => [item.assetId, item.files]));
  let changed = false;
  const assets = project.assets.map(asset => {
    const files = byId.get(asset.id);
    if (!files) return asset;
    const mapped = (value: string) => files[value] ?? value;
    const next = { ...asset, path: mapped(asset.path), ...(asset.spine ? { spine: { ...asset.spine, atlasPath: mapped(asset.spine.atlasPath), pages: asset.spine.pages.map(page => ({ ...page, path: mapped(page.path) })) } } : {}) };
    if (JSON.stringify(next) === JSON.stringify(asset)) return asset;
    changed = true; return next;
  });
  return changed ? { ...project, assets } : project;
}
