import { projectGraphs } from './project-resources';
import { makeId, type Asset, type AssetCategory, type Project } from './model';

export const assetCategoryNames: Record<AssetCategory, string> = {
  scene: '场景', portrait: '立绘', ui: 'UI素材', bgm: 'BGM', voice: '配音', sound: '音效',
  video: '视频', font: '字体', spine: '骨骼动画', script: '脚本', other: '未分类',
};
export function categoryAcceptsKind(category: AssetCategory, kind: Asset['kind']) {
  return category === 'other' || (['scene', 'portrait', 'ui'].includes(category) ? kind === 'image'
    : ['bgm', 'voice', 'sound'].includes(category) ? kind === 'audio' : category === kind);
}

export function inferAssetCategory(asset: Pick<Asset, 'kind' | 'name' | 'sourcePath'> & { path?: string }): AssetCategory {
  if (!['image', 'audio'].includes(asset.kind)) return asset.kind as AssetCategory;
  const name = `${asset.sourcePath ?? asset.path ?? ''}/${asset.name}`.toLocaleLowerCase();
  if (asset.kind === 'audio') {
    if (/(配音|语音|voice|vocal|dialogue)/i.test(name)) return 'voice';
    if (/(bgm|music|音乐|配乐)/i.test(name)) return 'bgm';
    if (/(sound|sfx|音效|环境音)/i.test(name)) return 'sound';
  } else {
    if (/(立绘|character|portrait|sprite)/i.test(name)) return 'portrait';
    if (/(ui素材|界面|蒙板|蒙版|按钮|纹理|标题字|遮罩|mask|fadecircle|chapter_img|button|textbox|(?:^|[/_\s-])ui(?:[/_\s-]|$))/i.test(name)) return 'ui';
    if (/(背景|场景|background|scenery|(?:^|[/_\s-])bg(?:[/_\s-]|$))/i.test(name)) return 'scene';
  }
  return 'other';
}

/** Usage supplies sensible defaults for older projects; an authored category always wins. */
export function assetCategories(project: Project): Map<string, AssetCategory> {
  if (project.assets.every(asset => asset.category && categoryAcceptsKind(asset.category, asset.kind))) return new Map(project.assets.map(asset => [asset.id, asset.category!]));
  const result = new Map(project.assets.map(asset => [asset.id, inferAssetCategory({ ...asset, sourcePath: [...resourceFolderTrail(project, project.contentBrowser?.assignments[`asset:${asset.id}`]).map(folder => folder.name), asset.sourcePath ?? asset.path].join('/') })]));
  const kinds = new Map(project.assets.map(asset => [asset.id, asset.kind]));
  const hint = (id: unknown, category: AssetCategory) => {
    if (typeof id === 'string' && kinds.has(id) && categoryAcceptsKind(category, kinds.get(id)!)) result.set(id, category);
  };
  const visit = (value: unknown, ui = false) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(item => visit(item, ui)); return; }
    const object = value as Record<string, unknown>;
    const properties = object.properties as Record<string, unknown> | undefined;
    if (object.type === 'showBackground') hint(properties?.assetId, 'scene');
    if (object.type === 'playMusic') hint(properties?.assetId, 'bgm');
    if (object.type === 'playSound') hint(properties?.assetId, 'sound');
    if (object.kind === 'background') hint(object.assetId, 'scene');
    if (object.kind === 'music') hint(object.assetId, 'bgm');
    if (object.kind === 'sound') hint(object.assetId, 'sound');
    hint(object.backgroundId, 'scene');
    hint(object.musicId, 'bgm'); hint(object.soundId, 'sound'); hint(object.menuMusicId, 'bgm'); hint(object.voiceId, 'voice'); hint(object.hoverSoundId, 'sound');
    hint(object.titleImageId, 'ui');
    for (const [key, child] of Object.entries(object)) {
      if (ui && (key.endsWith('Id') || ['idle', 'hover', 'pressed', 'selected', 'disabled'].includes(key))) hint(child, 'ui');
      if (typeof child === 'object') visit(child, ui);
    }
  };
  visit(project.ui, true);
  visit(project.nodes); visit(project.scenes); visit(projectGraphs(project)); visit(project.effects);
  for (const character of project.characters) {
    character.expressions.forEach(expression => hint(expression.assetId, 'portrait'));
    visit(character.features);
  }
  for (const asset of project.assets) if (asset.category && categoryAcceptsKind(asset.category, asset.kind)) result.set(asset.id, asset.category);
  return result;
}

export function resourceFolderTrail(project: Project, folderId?: string) {
  const folders = project.contentBrowser?.folders ?? [];
  const trail: typeof folders = [], seen = new Set<string>();
  let folder = folders.find(item => item.id === folderId);
  while (folder && !seen.has(folder.id)) {
    trail.unshift(folder); seen.add(folder.id);
    folder = folders.find(item => item.id === folder!.parentId);
  }
  return trail;
}
export function folderCategory(project: Project, folderId?: string): AssetCategory | undefined {
  return resourceFolderTrail(project, folderId).find(folder => folder.category)?.category;
}

export function resourceDirectoryParts(project: Project, category: AssetCategory, folderId?: string): string[] {
  const trail = resourceFolderTrail(project, folderId);
  const parts = trail.map(folder => folder.name);
  if (!trail.some(folder => folder.category === category)) parts.unshift(assetCategoryNames[category]);
  return parts.map(part => {
    const clean = part.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || '_';
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean) ? '_' + clean : clean;
  });
}

export function ensureResourceFolders(project: Project) {
  for (const category of Object.keys(assetCategoryNames) as AssetCategory[]) ensureAssetFolder(project, category);
}

/** Recover missing browser assignments from the current project path, never the import source. */
export function ensureAssetAssignments(project: Project) {
  const categories = assetCategories(project);
  const directory = (project.resourceSettings?.directory ?? 'assets').replaceAll('\\', '/').replace(/\/$/, '') + '/';
  for (const asset of project.assets) {
    const assigned = project.contentBrowser?.assignments[`asset:${asset.id}`];
    if (assigned && project.contentBrowser?.folders.some(folder => folder.id === assigned)) continue;
    let category = categories.get(asset.id) ?? 'other';
    const relative = asset.path.replaceAll('\\', '/');
    const parts = relative.startsWith(directory) ? relative.slice(directory.length).split('/').slice(0, -1) : [];
    const onDisk = (Object.keys(assetCategoryNames) as AssetCategory[]).find(key => assetCategoryNames[key] === parts[0] && categoryAcceptsKind(key, asset.kind));
    if (onDisk) { category = onDisk; parts.shift(); }
    const destination = ensureAssetFolder(project, category, parts);
    project.contentBrowser!.assignments[`asset:${asset.id}`] = destination;
  }
  ensureResourceFolders(project);
}
export function assetGroupPath(project: Project, asset: Asset, category = assetCategories(project).get(asset.id) ?? 'other') {
  const trail = resourceFolderTrail(project, project.contentBrowser?.assignments[`asset:${asset.id}`]);
  const names = trail.map(folder => folder.name);
  if (!trail.some(folder => folder.category === category) && names[0] !== assetCategoryNames[category]) names.unshift(assetCategoryNames[category]);
  return names.join(' / ');
}
const assetOrder = new Intl.Collator('zh-CN', { numeric: true });
export function groupedAssets(project: Project, assets: Asset[]) {
  const categories = assetCategories(project), groups = new Map<string, Asset[]>();
  for (const asset of assets) {
    const name = assetGroupPath(project, asset, categories.get(asset.id));
    const group = groups.get(name) ?? []; group.push(asset); groups.set(name, group);
  }
  return [...groups].sort(([a], [b]) => assetOrder.compare(a, b)).map(([name, items]) => ({ name, assets: items.sort((a, b) => assetOrder.compare(a.name, b.name)) }));
}
export function categoryAssets(project: Project, kind: Asset['kind'], category?: AssetCategory, currentId?: string) {
  const categories = category ? assetCategories(project) : undefined;
  return project.assets.filter(asset => asset.kind === kind && (!category || categories!.get(asset.id) === category || asset.id === currentId));
}

export function ensureAssetFolder(project: Project, category: AssetCategory, subfolders: string[] = [], parentId?: string) {
  const state = project.contentBrowser ??= { folders: [], assignments: {}, favorites: [] };
  const ensure = (name: string, parent?: string, kind?: AssetCategory) => {
    const clean = name.trim().slice(0, 80);
    let folder = state.folders.find(item => item.parentId === parent && (kind ? item.category === kind || item.name === clean : item.name === clean));
    if (!folder) {
      if (state.folders.length >= 512) throw new Error('文件夹数量已达到 512 个，请合并部分文件夹后重试。');
      folder = { id: makeId('folder'), name: clean, ...(parent ? { parentId: parent } : {}), ...(kind ? { category: kind } : {}) }; state.folders.push(folder);
    } else if (kind && !folder.category) folder.category = kind;
    return folder.id;
  };
  let destination = parentId ?? ensure(assetCategoryNames[category], undefined, category);
  for (const name of subfolders.filter(part => part.trim() && part !== '.' && part !== '..')) destination = ensure(name, destination);
  return destination;
}

/** Only assets are reorganized; story, blueprint folders and all resource IDs stay intact. */
export function organizeAssetLibrary(project: Project, relocate = false) {
  const categories = assetCategories(project);
  for (const asset of project.assets) {
    const category = categories.get(asset.id) ?? 'other'; asset.category = category;
    const assigned = project.contentBrowser?.assignments[`asset:${asset.id}`];
    if (!relocate && assigned) continue;
    const existing = resourceFolderTrail(project, assigned);
    if (existing.some(folder => folder.category === category)) continue;
    const parts = asset.sourcePath?.replaceAll('\\', '/').split('/').slice(0, -1) ?? [];
    const destination = ensureAssetFolder(project, category, parts);
    project.contentBrowser!.assignments[`asset:${asset.id}`] = destination;
  }
}
export function setAssetCategory(project: Project, ids: string[], category: AssetCategory) {
  const selected = new Set(ids);
  for (const asset of project.assets) if (selected.has(asset.id) && categoryAcceptsKind(category, asset.kind)) {
    asset.category = category;
    const assigned = project.contentBrowser?.assignments[`asset:${asset.id}`];
    if (folderCategory(project, assigned) !== category) {
      const folder = ensureAssetFolder(project, category);
      project.contentBrowser!.assignments[`asset:${asset.id}`] = folder;
    }
  }
}
