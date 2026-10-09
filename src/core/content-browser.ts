import { graphResourceKey, isTimelineResource, projectGraphs, withProjectGraphs, setProjectGraphs } from './project-resources';
import { makeId, type Asset, type Project } from './model';
import { blueprintKindNames } from './blueprint';
import { categoryAcceptsKind, folderCategory } from './asset-library';
import { blueprintCallName, renameBlueprint, resolveBlueprintCall } from './blueprint-names';

export type ContentKind = Asset['kind'] | 'blueprint' | 'timeline' | 'character' | 'variable' | 'scene';
export interface ContentItem { key: string; id: string; kind: ContentKind; name: string; detail: string; assetId?: string; path?: string; callName?: string }
export const contentKindNames: Record<ContentKind, string> = { image: '图片', audio: '音频', video: '视频', font: '字体', spine: '骨骼动画', script: '脚本', blueprint: '蓝图', timeline: '时间轴预设', character: '角色', variable: '状态', scene: '场景' };

export function projectContent(project: Project): ContentItem[] {
  return [
    ...project.assets.map(a => ({ key: `asset:${a.id}`, id: a.id, kind: a.kind, name: a.name, assetId: a.id, path: a.path,
      detail: a.width && a.height ? `${a.width} × ${a.height}` : a.kind === 'spine' ? `${a.spine?.animations.length ?? 0} 段动画` : contentKindNames[a.kind] })),
    ...projectGraphs(project).map(g => {
      const owners = projectGraphs(project).filter(owner => owner.id !== g.id && owner.nodes.some(node => node.properties.graphId === g.id));
      const timeline = `${g.timeline?.tracks.length ?? 0} 轨道 · ${g.exposedInputs.length} 参数${owners.length ? ` · 调用方：${owners.map(owner => owner.name).join('、')}` : ''}`;
      return { key: graphResourceKey(g), id: g.id, kind: isTimelineResource(g) ? 'timeline' as const : 'blueprint' as const, name: g.name, callName: blueprintCallName(g), detail: isTimelineResource(g) ? timeline : `${blueprintKindNames[g.kind]} · ${g.nodes.length} 节点 · @${blueprintCallName(g)}` };
    }),
    ...project.characters.map(c => ({ key: `character:${c.id}`, id: c.id, kind: 'character' as const, name: c.name, detail: `${c.expressions.length} 个表情`, assetId: c.expressions[0]?.assetId })),
    ...project.variables.map(v => ({ key: `variable:${v.id}`, id: v.id, kind: 'variable' as const, name: v.name, detail: `${v.type === 'boolean' ? '开关' : v.type === 'number' ? '数值' : '文字'} · ${String(v.initial)}` })),
    ...project.scenes.map(s => ({ key: `scene:${s.id}`, id: s.id, kind: 'scene' as const, name: s.name, detail: `${project.chapters.find(c => c.id === s.chapterId)?.name ?? '场景'} · ${project.nodes.filter(n => n.sceneId === s.id).length} 节点` })),
  ];
}

export function contentState(project: Project) {
  return project.contentBrowser ??= { folders: [], assignments: {}, favorites: [] };
}

export function folderTrail(project: Project, folderId?: string) {
  const folders = project.contentBrowser?.folders ?? [];
  const trail: typeof folders = [];
  const seen = new Set<string>();
  let current = folders.find(f => f.id === folderId);
  while (current && !seen.has(current.id)) {
    trail.unshift(current); seen.add(current.id);
    current = folders.find(f => f.id === current!.parentId);
  }
  return trail;
}

export function createContentFolder(project: Project, name: string, parentId?: string) {
  const state = contentState(project);
  const cleanName = name.trim().slice(0, 80);
  if (!cleanName || state.folders.length >= 512 || (parentId && !state.folders.some(f => f.id === parentId))) return;
  if (state.folders.some(f => f.parentId === parentId && f.name === cleanName)) return;
  const folder = { id: makeId('folder'), name: cleanName, parentId };
  state.folders.push(folder);
  return folder.id;
}

export function moveContent(project: Project, keys: string[], folderId?: string) {
  const state = contentState(project);
  if (folderId && !state.folders.some(f => f.id === folderId)) return;
  const existing = new Set(projectContent(project).map(item => item.key));
  const category = folderCategory(project, folderId);
  let count = 0;
  for (const key of keys) if (existing.has(key)) {
    const asset = key.startsWith('asset:') ? project.assets.find(item => key === `asset:${item.id}`) : undefined;
    if (category && asset && categoryAcceptsKind(category, asset.kind)) asset.category = category;
    if (folderId) state.assignments[key] = folderId; else delete state.assignments[key];
    count++;
  }
  return count;
}

export function moveContentFolder(project: Project, folderId: string, parentId?: string) {
  const state = contentState(project);
  const folder = state.folders.find(f => f.id === folderId);
  if (!folder || (parentId && !state.folders.some(f => f.id === parentId))) return false;
  if (folderTrail(project, parentId).some(f => f.id === folderId)) return false;
  if (state.folders.some(f => f.id !== folderId && f.parentId === parentId && f.name === folder.name)) return false;
  const category = folderCategory(project, parentId);
  const descendants = new Set(state.folders.filter(item => folderTrail(project, item.id).some(ancestor => ancestor.id === folderId)).map(item => item.id));
  const contents = Object.entries(state.assignments).filter(([, id]) => descendants.has(id)).map(([key]) => key);
  const assets = project.assets.filter(asset => contents.includes(`asset:${asset.id}`));
  folder.parentId = parentId;
  if (category) assets.filter(asset => categoryAcceptsKind(category, asset.kind)).forEach(asset => { asset.category = category; });
  return true;
}

/** Folder deletion includes every descendant, independent of current search/filter state. */
export function removeContentFolder(project: Project, folderId: string) {
  return removeContentSelection(project, ['folder:' + folderId]);
}

export function renameContent(project: Project, item: ContentItem, name: string) {
  const clean = name.trim().slice(0, 120);
  if (!clean) return;
  if (item.kind === 'blueprint' || item.kind === 'timeline') { renameBlueprint(project, item.id, { name: clean }); return; }
  const collection = item.kind === 'scene' ? project.scenes : item.kind === 'character' ? project.characters : item.kind === 'variable' ? project.variables : project.assets;
  const target = collection.find(entry => entry.id === item.id);
  if (target) target.name = clean;
}

export function moveContentSelection(project: Project, keys: string[], destination?: string) {
  let count = moveContent(project, keys.filter(key => !key.startsWith('folder:')), destination) ?? 0;
  const folderIds = keys.filter(key => key.startsWith('folder:')).map(key => key.slice(7));
  for (const id of folderIds) {
    if (folderTrail(project, id).slice(0, -1).some(parent => folderIds.includes(parent.id))) continue;
    if (moveContentFolder(project, id, destination)) count++;
  }
  return count;
}

export function copyAssetSelection(project: Project, source: Project, keys: string[], destination?: string): string[] {
  const state = contentState(project), sourceState = contentState(source), result: string[] = [];
  if (destination && !state.folders.some(folder => folder.id === destination)) return result;
  const rootFolders = keys.filter(key => key.startsWith('folder:')).map(key => key.slice(7)).filter(id => !folderTrail(source, id).slice(0, -1).some(folder => keys.includes('folder:' + folder.id)));
  const folderMap = new Map<string, string>();
  const uniqueName = (name: string, names: string[]) => { let candidate = name, index = 2; while (names.includes(candidate)) candidate = `${name.slice(0, 65)} ${index++}`; return candidate; };
  const cloneFolder = (id: string, parent?: string) => {
    const original = sourceState.folders.find(folder => folder.id === id); if (!original) return;
    if (state.folders.length >= 512) throw new Error('文件夹数量已达上限。');
    const name = uniqueName(original.name, state.folders.filter(folder => folder.parentId === parent).map(folder => folder.name));
    const newId = createContentFolder(project, name, parent)!;
    folderMap.set(id, newId);
    if (!parent || !folderCategory(project, parent)) state.folders.find(folder => folder.id === newId)!.category = original.category;
    for (const child of sourceState.folders.filter(folder => folder.parentId === id)) cloneFolder(child.id, newId);
  };
  rootFolders.forEach(id => cloneFolder(id, destination));
  for (const asset of source.assets) {
    const sourceFolder = sourceState.assignments['asset:' + asset.id];
    if (!keys.includes('asset:' + asset.id) && !folderMap.has(sourceFolder)) continue;
    const targetFolder = folderMap.get(sourceFolder) ?? destination, category = folderCategory(project, targetFolder);
    const copy = structuredClone(asset);
    copy.id = makeId('asset');
    copy.name = uniqueName(asset.name + ' 副本', project.assets.map(item => item.name));
    if (category && categoryAcceptsKind(category, asset.kind)) copy.category = category;
    project.assets.push(copy);
    if (targetFolder) state.assignments['asset:' + copy.id] = targetFolder;
    result.push('asset:' + copy.id);
  }
  return [...rootFolders.flatMap(id => folderMap.has(id) ? ['folder:' + folderMap.get(id)] : []), ...result];
}

export function contentRemovalSelection(project: Project, selection: string[]) {
  const selected = new Set(selection);
  const folders = (project.contentBrowser?.folders ?? []).filter(folder => folderTrail(project, folder.id).some(ancestor => selected.has('folder:' + ancestor.id)));
  const folderIds = new Set(folders.map(folder => folder.id));
  const items = projectContent(project).filter(item => selected.has(item.key) || folderIds.has(project.contentBrowser?.assignments[item.key] ?? ''));
  return { items, folders, keys: [...folders.map(folder => 'folder:' + folder.id), ...items.map(item => item.key)] };
}

/** Delete the complete selection atomically; references outside it must be resolved first. */
export function removeContentSelection(project: Project, keys: string[]) {
  const removal = contentRemovalSelection(project, keys), chosen = removal.items;
  keys = removal.keys;
  const retained = withProjectGraphs({ ...project, assets: project.assets.filter(item => !keys.includes('asset:' + item.id)), characters: project.characters.filter(item => !keys.includes('character:' + item.id)), variables: project.variables.filter(item => !keys.includes('variable:' + item.id)), scenes: project.scenes.filter(item => !keys.includes('scene:' + item.id)) }, projectGraphs(project).filter(item => !keys.includes(graphResourceKey(item))));
  const used = new Set<string>();
  const inspect = (value: unknown, key = ''): void => {
    if (['id', 'name', 'text', 'subtitle', 'sourcePath', 'path', 'scriptText', 'contentBrowser'].includes(key)) return;
    if (typeof value === 'string') {
      used.add(value);
      for (const match of value.matchAll(/【([a-z][a-z0-9_]{0,63})】/g)) used.add(match[1]);
      if (key === 'action') { try { inspect(JSON.parse(value)); } catch { /* Not a saved action. */ } }
    } else if (Array.isArray(value)) value.forEach(item => inspect(item));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([name, item]) => inspect(item, name));
  };
  inspect(retained);
  for (const row of project.scriptText?.content.split(/\r?\n/) ?? []) {
    const command = row.match(/^\s*[@／/](?!\/)\s*([^:：]+)(?:[:：]|$)/);
    if (!command) continue;
    inspect(row);
    const called = resolveBlueprintCall(projectGraphs(project), command[1].trim());
    if (called) used.add(called.id);
  }
  const blocked = chosen.filter(item => used.has(item.id));
  if (blocked.length) throw new Error('仍被所选范围之外的剧情、蓝图、时间轴或界面引用，无法删除：' + blocked.map(item => item.name).join('、') + '。请先解除引用。');
  project.assets = retained.assets; setProjectGraphs(project, projectGraphs(retained)); project.characters = retained.characters; project.variables = retained.variables; project.scenes = retained.scenes;
  const state = contentState(project);
  const removedFolders = new Set(removal.folders.map(folder => folder.id));
  for (const [key, folder] of Object.entries(state.assignments)) if (keys.includes(key) || removedFolders.has(folder)) delete state.assignments[key];
  state.favorites = state.favorites.filter(key => !keys.includes(key));
  state.folders = state.folders.filter(folder => !removedFolders.has(folder.id));
  return chosen.length;
}
