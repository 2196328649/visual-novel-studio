import { createContext } from 'react';
import type { AssetImportOptions } from '../core/bridge';
import type { Asset, Project } from '../core/model';

export const AssetImportContext = createContext<((options: AssetImportOptions) => Promise<Asset | undefined>) | undefined>(undefined);

/** Merge imported resources only; a file dialog must not overwrite concurrent edits. */
export function mergeImportedAssets(project: Project, imported: Project) {
  const ids = new Set(project.assets.map(asset => asset.id));
  const added = imported.assets.filter(asset => !ids.has(asset.id));
  project.assets.push(...added);
  if (imported.contentBrowser && added.length) {
    const target = project.contentBrowser ??= { folders: [], assignments: {}, favorites: [] };
    const folders = new Set(target.folders.map(folder => folder.id));
    target.folders.push(...imported.contentBrowser.folders.filter(folder => !folders.has(folder.id)));
    for (const asset of added) { const key = 'asset:' + asset.id, folder = imported.contentBrowser.assignments[key]; if (folder) target.assignments[key] = folder; }
  }
}
