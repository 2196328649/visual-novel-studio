import type { Project } from './model';
import { folderTrail, type ContentItem, type ContentKind } from './content-browser';

export type ContentScope = 'folder' | 'all' | 'favorites';

/** Type choices are ORed; search and the displayed folder are independent filters. */
export function queryContent(project: Project, items: ContentItem[], options: {
  kinds: ContentKind[]; query: string; scope: ContentScope; folderId?: string;
  searchText?: Map<string, string>;
}) {
  const folders = project.contentBrowser?.folders ?? [];
  const assignments = project.contentBrowser?.assignments ?? {};
  const folderIds = new Set(folders.map(folder => folder.id));
  const favorites = new Set(project.contentBrowser?.favorites ?? []);
  const query = options.query.trim().toLocaleLowerCase();
  const assigned = (item: ContentItem) => folderIds.has(assignments[item.key]) ? assignments[item.key] : undefined;
  const matching = items.filter(item => (!options.kinds.length || options.kinds.includes(item.kind)) &&
    (!query || (options.searchText?.get(item.key) ?? `${item.name} ${item.detail} ${item.path ?? ''}`).toLocaleLowerCase().includes(query)) &&
    (options.scope !== 'favorites' || favorites.has(item.key)));
  const matchingFolders = new Set(matching.flatMap(item => folderTrail(project, assigned(item)).map(folder => folder.id)));
  const filtered = !!query || !!options.kinds.length;
  return {
    matching,
    visible: options.scope === 'folder' ? matching.filter(item => assigned(item) === (options.folderId || undefined)) : matching,
    childFolders: options.scope !== 'folder' ? [] : folders.filter(folder => folder.parentId === (options.folderId || undefined) &&
      (!filtered || matchingFolders.has(folder.id) || !!query && !options.kinds.length && folder.name.toLocaleLowerCase().includes(query))),
  };
}
