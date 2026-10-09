import { projectGraphs } from './project-resources';
import { allUiComponents, effectiveUiTheme, type Project } from './model';

/** Release-only copy selection. Script modules and computed asset inputs can read
 * arbitrary filenames, so those projects keep their complete resource library. */
export function projectForExport(project: Project): Project {
  if (project.assets.some(a => a.kind === 'script') || projectGraphs(project).some(graph => graph.nodes.some(node => ['formatText', 'eventTextCommitted'].includes(node.type)))) return project;
  const theme = effectiveUiTheme(project.ui), components = allUiComponents(project);
  const galleries = components.filter(c => c.kind === 'galleryGrid');
  const allImages = galleries.some(c => !c.list?.galleryGroups && !c.list?.assetIds) ||
    (!theme.disabledPages?.includes('gallery') && theme.pages?.gallery?.layout !== 'custom');
  let references = JSON.stringify({ ...project, assets: [], contentBrowser: undefined });
  const retained = new Set(project.assets.filter(a => allImages && a.kind === 'image').map(a => a.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const asset of project.assets) if (!retained.has(asset.id) && (references.includes(asset.id) || references.includes(asset.path))) {
      retained.add(asset.id); references += JSON.stringify(asset); changed = true;
    }
  }
  return { ...project, assets: project.assets.filter(a => retained.has(a.id)) };
}
