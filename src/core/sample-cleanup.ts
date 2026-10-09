import { projectGraphs, setProjectGraphs } from './project-resources';
import { type Asset, type Project, type UiComponent } from './model';
import { ensureAssetAssignments } from './asset-library';

export const sampleRemovedPages: UiComponent['page'][] = ['chapterSelect', 'voiceSettings', 'staff', 'keyboard', 'gameOver'];

/** Explicit maintenance for the bundled example and opted-in copies; never run on ordinary projects. */
export function simplifySample(project: Project) {
  const removed = new Set(sampleRemovedPages);
  const cleanComponents = (components: UiComponent[]) => components.filter(c => !removed.has(c.page) && !removed.has(c.action as UiComponent['page']));
  project.ui.disabledPages = [...new Set([...(project.ui.disabledPages ?? []).filter(page => page !== 'voiceCollection'), ...removed])];
  project.ui.components = cleanComponents(project.ui.components);
  for (const instance of project.ui.instances ?? []) {
    instance.components = cleanComponents(instance.components);
    for (const page of removed) if (instance.pages) delete instance.pages[page];
  }
  for (const page of removed) if (project.ui.pages) delete project.ui.pages[page];
  for (const page of project.ui.customPages) page.components = cleanComponents(page.components);
  project.ui.animations = project.ui.animations?.filter(animation => !removed.has(animation.pageId.replace(/^ui:/, '') as UiComponent['page']));
  setProjectGraphs(project, projectGraphs(project).filter(graph => !removed.has(graph.uiPageId?.replace(/^ui:/, '') as UiComponent['page'])));

  // Gallery examples use exactly the backgrounds displayed by the sample story.
  const backgrounds = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const row = value as Record<string, unknown>;
    if (typeof row.backgroundId === 'string') backgrounds.add(row.backgroundId);
    if (row.kind === 'background' && typeof row.assetId === 'string') backgrounds.add(row.assetId);
    if (row.type === 'showBackground') {
      const props = row.properties as Record<string, unknown> | undefined;
      if (typeof props?.assetId === 'string') backgrounds.add(props.assetId);
    }
    Object.values(row).forEach(visit);
  };
  visit(project.nodes); visit(project.scenes); visit(projectGraphs(project));
  const storyImages = project.assets.filter(asset => asset.kind === 'image' && backgrounds.has(asset.id));
  const allComponents = [...project.ui.components, ...(project.ui.instances ?? []).flatMap(instance => instance.components)];
  for (const component of allComponents.filter(component => component.kind === 'galleryGrid' && component.id.startsWith('ai_'))) {
    component.list = { ...component.list, assetIds: undefined, galleryUnlockWhen: undefined,
      galleryGroups: storyImages.map(asset => ({ id: asset.id, name: asset.name, assetIds: [asset.id] })),
      galleryFit: 'contain', galleryShowControls: true };
  }
  // Serialized blueprint properties may themselves contain JSON with asset IDs.
  // Scan all authored content, then follow dependencies between asset records.
  let references = JSON.stringify({ ...project, assets: [], contentBrowser: undefined });
  const retained = new Set(project.assets.filter(asset => asset.kind !== 'image').map(asset => asset.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const asset of project.assets) if (!retained.has(asset.id) && (references.includes(asset.id) || references.includes(asset.path))) {
      retained.add(asset.id); changed = true;
    }
    references += JSON.stringify(project.assets.filter(asset => retained.has(asset.id)));
  }
  const removedAssets: Asset[] = project.assets.filter(asset => !retained.has(asset.id));
  project.assets = project.assets.filter(asset => retained.has(asset.id));
  if (project.contentBrowser) {
    for (const asset of removedAssets) delete project.contentBrowser.assignments['asset:' + asset.id];
    project.contentBrowser.favorites = project.contentBrowser.favorites.filter(key => !key.startsWith('asset:') || retained.has(key.slice(6)));
    // Keep category roots and logical folders, discard empty asset-only branches.
    const used = new Set(Object.values(project.contentBrowser.assignments));
    for (let i = 0; i < project.contentBrowser.folders.length; i++) for (const folder of project.contentBrowser.folders) if (used.has(folder.id) && folder.parentId) used.add(folder.parentId);
    project.contentBrowser.folders = project.contentBrowser.folders.filter(folder => folder.category || used.has(folder.id) || !folder.parentId);
  }
  ensureAssetAssignments(project);
  return { removedAssets, storyImages: storyImages.map(asset => asset.id) };
}
