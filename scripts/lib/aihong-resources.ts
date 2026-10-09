import type { Project } from '../../src/core/model';
import { ensureAssetFolder, organizeAssetLibrary } from '../../src/core/asset-library';
import { createContentFolder } from '../../src/core/content-browser';

export function organizeAihongResources(project: Project) {
  organizeAssetLibrary(project, true);
  for (const category of ['scene', 'portrait', 'ui', 'bgm', 'voice', 'sound'] as const) ensureAssetFolder(project, category);
  const state = project.contentBrowser!;
  for (const [name, prefix, resources] of [['角色', 'character', project.characters], ['状态', 'variable', project.variables]] as const) {
    const folder = state.folders.find(folder => !folder.parentId && folder.name === name)?.id ?? createContentFolder(project, name);
    if (folder) for (const resource of resources) {
      const key = `${prefix}:${resource.id}`;
      if (!state.assignments[key] || state.assignments[key] === 'ai_folder_cast') state.assignments[key] = folder;
    }
  }
  // These are the preset's retired mixed media containers, never user folders.
  const retired = new Set(['ai_folder_art', 'ai_folder_backgrounds', 'ai_folder_ui', 'ai_folder_audio', 'ai_folder_fonts', 'ai_folder_cast']);
  let changed = true;
  while (changed) {
    const empty = state.folders.filter(folder => retired.has(folder.id) && !state.folders.some(child => child.parentId === folder.id) && !Object.values(state.assignments).includes(folder.id));
    changed = empty.length > 0;
    const ids = new Set(empty.map(folder => folder.id));
    state.folders = state.folders.filter(folder => !ids.has(folder.id));
  }
}
