import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createProject, type Project } from '../src/core/model';
import { ensureAssetFolder } from '../src/core/asset-library';
import { relocateProjectAssets } from '../src/core/asset-relocation';
import { assetSourcePath, autosaveProject, loadProject, saveProject } from '../src/desktop/project-store';
import { prepareResourceLayout, resourceFileName } from '../src/desktop/resource-layout';
import { validateProject } from '../src/core/validate';

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-resource-layout-'));
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('vns-resource-layout-')); await fs.rm(root, { recursive: true, force: true }); });
  const project = createProject('目录同步');
  project.assets = [{ id: 'image', name: '夜宴', kind: 'image', category: 'scene', path: 'assets/image.webp' }];
  const folder = ensureAssetFolder(project, 'scene', ['王家大院']);
  project.contentBrowser!.assignments['asset:image'] = folder;
  await fs.mkdir(path.join(root, 'assets'));
  await fs.writeFile(path.join(root, 'assets/image.webp'), 'image-bytes');
  return { root, project, folder, file: path.join(root, 'project.vns.json') };
}

test('saving before preview keeps script resources under the executable scripts directory', async t => {
  const { root, project, file } = await fixture(t);
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.writeFile(path.join(root, 'scripts/menu.rpy'), 'init python:\n    qa_value = 1\n');
  project.assets.push({ id: 'script', kind: 'script', name: '菜单脚本', path: 'scripts/menu.rpy' });
  project.contentBrowser!.assignments['asset:script'] = ensureAssetFolder(project, 'script', ['菜单']);
  const saved = await saveProject(file, project);
  const script = saved.project.assets.find(asset => asset.id === 'script')!;
  assert.equal(script.path, 'scripts/脚本/菜单/菜单脚本.rpy');
  assert.equal(await fs.readFile(assetSourcePath(root, script), 'utf8'), 'init python:\n    qa_value = 1\n');
  assert.deepEqual(validateProject(saved.project).filter(issue => issue.severity === 'error'), []);
  const reopened = await loadProject(file);
  assert.equal(reopened.project.assets.find(asset => asset.id === 'script')!.path, script.path);
});

test('save mirrors editor folders, preserves IDs and bytes, and old backups still resolve', async t => {
  const { root, project, folder, file } = await fixture(t);
  await fs.writeFile(file, JSON.stringify(project));
  await fs.writeFile(path.join(root, 'assets/unknown.txt'), 'leave me');
  const saved = await saveProject(file, project), asset = saved.project.assets[0];
  assert.equal(asset.path, 'assets/场景/王家大院/夜宴.webp');
  assert.equal(await fs.readFile(assetSourcePath(root, asset), 'utf8'), 'image-bytes');
  await assert.rejects(fs.access(path.join(root, 'assets/image.webp')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(assetSourcePath(root, project.assets[0]), 'utf8'), 'image-bytes');
  assert.equal(await fs.readFile(path.join(root, 'assets/unknown.txt'), 'utf8'), 'leave me');
  assert.deepEqual(relocateProjectAssets(project, saved.assetRelocations!).assets, saved.project.assets);
  assert.equal((await loadProject(file + '.previous')).project.assets[0].path, asset.path);
  const renamed = structuredClone(saved.project);
  renamed.contentBrowser!.folders.find(item => item.id === folder)!.name = '庭院';
  const moved = await saveProject(file, renamed);
  assert.equal(moved.project.assets[0].path, 'assets/场景/庭院/夜宴.webp');
  assert.equal(await fs.readFile(assetSourcePath(root, project.assets[0]), 'utf8'), 'image-bytes');
  assert.deepEqual(moved.project.nodes, project.nodes);
  // Undo may supply a historical path and folder; it must move back safely.
  const undone = await saveProject(file, project);
  assert.equal(undone.project.assets[0].path, asset.path);
  assert.equal(await fs.readFile(assetSourcePath(root, moved.project.assets[0]), 'utf8'), 'image-bytes');
  await autosaveProject(file, moved.project);
  await fs.utimes(file, new Date(0), new Date(0));
  assert.equal((await loadProject(file)).project.assets[0].path, asset.path);
});

test('conflicting destination is preserved, duplicate sources are copied to separate folders', async t => {
  const { root, project, file } = await fixture(t);
  await fs.mkdir(path.join(root, 'assets/场景/王家大院'), { recursive: true });
  await fs.writeFile(path.join(root, 'assets/场景/王家大院/夜宴.webp'), 'unrelated');
  project.assets.push({ ...project.assets[0], id: 'second' });
  project.contentBrowser!.assignments['asset:second'] = ensureAssetFolder(project, 'scene', ['客栈']);
  const saved = await saveProject(file, project);
  assert.equal(saved.project.assets[0].path, 'assets/场景/王家大院/夜宴_image.webp');
  assert.equal(saved.project.assets[1].path, 'assets/场景/客栈/夜宴.webp');
  for (const asset of saved.project.assets) assert.equal(await fs.readFile(assetSourcePath(root, asset), 'utf8'), 'image-bytes');
  assert.equal(await fs.readFile(path.join(root, 'assets/场景/王家大院/夜宴.webp'), 'utf8'), 'unrelated');
});

test('spine files move as a group; reference assets and missing groups are preserved', async t => {
  const { root, project, file } = await fixture(t);
  const skeleton: Project['assets'][number] = { id: 'spine', name: '骨骼', kind: 'spine', path: 'assets/old/skeleton.json', spine: { version: '4.2', atlasPath: 'assets/old/skeleton.atlas', pages: [{ name: 'page.png', path: 'assets/old/page.png', width: 1, height: 1 }], animations: [], skins: [], bounds: { x: 0, y: 0, width: 1, height: 1 } } };
  project.assets.push(skeleton, { ...project.assets[0], id: 'reference', externalPath: path.join(root, 'assets/image.webp'), path: 'assets/reference.webp' }, { ...skeleton, id: 'missing', path: 'assets/missing.json' });
  const spineFolder = ensureAssetFolder(project, 'spine', ['人物']);
  for (const id of ['spine', 'missing']) project.contentBrowser!.assignments['asset:' + id] = spineFolder;
  project.contentBrowser!.assignments['asset:reference'] = project.contentBrowser!.assignments['asset:image'];
  await fs.mkdir(path.join(root, 'assets/old'));
  for (const name of ['skeleton.json', 'skeleton.atlas', 'page.png']) await fs.writeFile(path.join(root, 'assets/old', name), name);
  const saved = await saveProject(file, project);
  const moved = saved.project.assets[1];
  assert.equal(moved.path, 'assets/骨骼动画/人物/骨骼_spine/skeleton.json');
  assert.equal(moved.spine!.atlasPath, 'assets/骨骼动画/人物/骨骼_spine/skeleton.atlas');
  assert.equal(await fs.readFile(assetSourcePath(root, moved, moved.spine!.pages[0].path), 'utf8'), 'page.png');
  assert.deepEqual(saved.project.assets.slice(2), project.assets.slice(2));
  assert.equal(await fs.readFile(assetSourcePath(root, saved.project.assets[2]), 'utf8'), 'image-bytes');
  assert.deepEqual(saved.resourceReport?.skipped, ['骨骼']);
});

test('save failure keeps original files and bytes; autosave never moves assets', async t => {
  const { root, project, file } = await fixture(t);
  await autosaveProject(file, project);
  assert.equal(await fs.readFile(path.join(root, 'assets/image.webp'), 'utf8'), 'image-bytes');
  await fs.mkdir(file);
  await assert.rejects(saveProject(file, project));
  assert.equal(await fs.readFile(path.join(root, 'assets/image.webp'), 'utf8'), 'image-bytes');
  assert.equal(await fs.readFile(assetSourcePath(root, project.assets[0]), 'utf8'), 'image-bytes');
});

test('disabled synchronization retains paths and a source changed during save is not deleted', async t => {
  const { root, project, file } = await fixture(t);
  project.resourceSettings!.syncFolders = false;
  const unchanged = await saveProject(file, project);
  assert.deepEqual(unchanged.project.assets, project.assets);
  const pending = await prepareResourceLayout(root, project);
  await fs.writeFile(path.join(root, 'assets/image.webp'), 'changed elsewhere');
  assert.deepEqual(await pending.finish(), ['assets/image.webp']);
  assert.equal(await fs.readFile(path.join(root, 'assets/image.webp'), 'utf8'), 'changed elsewhere');
});

test('unassigned legacy music and fonts use their category and later saves do no extra copying', async t => {
  const { root, project, file } = await fixture(t);
  project.assets.push({ id: 'music', kind: 'audio', category: 'bgm', name: '音乐', path: 'assets/music.ogg' }, { id: 'font', kind: 'font', name: '字体', path: 'assets/font.ttf' });
  await fs.writeFile(path.join(root, 'assets/music.ogg'), 'music'); await fs.writeFile(path.join(root, 'assets/font.ttf'), 'font');
  const saved = await saveProject(file, project);
  assert.deepEqual(saved.project.assets.slice(1).map(asset => asset.path), ['assets/BGM/音乐.ogg', 'assets/字体/字体.ttf']);
  const before = (await fs.stat(path.join(root, saved.project.assets[1].path))).mtimeMs;
  const again = await saveProject(file, saved.project);
  assert.equal(again.resourceReport, undefined);
  assert.equal((await fs.stat(path.join(root, again.project.assets[1].path))).mtimeMs, before);
});

test('asset renaming synchronizes files and historical references through undo and redo', async t => {
  const { root, project, file } = await fixture(t);
  const first = await saveProject(file, project);
  const renamed = structuredClone(first.project);
  renamed.assets[0].name = '客栈：夜/雨.webp';
  const second = await saveProject(file, renamed);
  assert.equal(second.project.assets[0].path, 'assets/场景/王家大院/客栈：夜_雨.webp');
  assert.equal(await fs.readFile(assetSourcePath(root, first.project.assets[0]), 'utf8'), 'image-bytes');
  const undone = await saveProject(file, first.project);
  assert.equal(undone.project.assets[0].path, first.project.assets[0].path);
  const redone = await saveProject(file, second.project);
  assert.equal(redone.project.assets[0].path, second.project.assets[0].path);
  assert.equal(await fs.readFile(assetSourcePath(root, project.assets[0]), 'utf8'), 'image-bytes');
  assert.equal((await saveProject(file, redone.project)).resourceReport, undefined);
});

test('Windows names remain safe and extensions stay attached exactly once', () => {
  assert.equal(resourceFileName('CON', 'assets/a.ogg'), '_CON.ogg');
  assert.equal(resourceFileName('音乐.OGG', 'assets/a.ogg'), '音乐.ogg');
  assert.equal(resourceFileName('末尾. ', 'assets/a.png'), '末尾.png');
  assert.equal(resourceFileName('../../路径\\名?', 'assets/a.ttf'), '.._.._路径_名_.ttf');
});

test('reusing a renamed file name cannot redirect an old snapshot to another asset', async t => {
  const { root, project, file } = await fixture(t);
  const first = await saveProject(file, project);
  const renamed = structuredClone(first.project); renamed.assets[0].name = '客栈';
  const second = await saveProject(file, renamed);
  await fs.writeFile(path.join(root, 'assets/new.webp'), 'different-image');
  second.project.assets.push({ ...project.assets[0], id: 'new_image', path: 'assets/new.webp' });
  second.project.contentBrowser!.assignments['asset:new_image'] = project.contentBrowser!.assignments['asset:image'];
  const third = await saveProject(file, second.project);
  assert.equal(third.project.assets[1].path, first.project.assets[0].path);
  assert.equal(await fs.readFile(assetSourcePath(root, first.project.assets[0]), 'utf8'), 'image-bytes');
  assert.equal(await fs.readFile(assetSourcePath(root, third.project.assets[1]), 'utf8'), 'different-image');
  const copyRoot = path.join(root, 'copy');
  const copied = await saveProject(path.join(copyRoot, 'project.vns.json'), first.project, root);
  assert.equal(await fs.readFile(assetSourcePath(copyRoot, copied.project.assets[0]), 'utf8'), 'image-bytes');
});
