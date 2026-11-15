import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PNG } from 'pngjs';
import { createProject } from '../src/core/model';
import { AssetDiscovery } from '../src/desktop/asset-discovery';
import { importAssetPaths, parseAssetImportOptions } from '../src/desktop/asset-import';
import { assetSourcePath, saveProject, loadProject } from '../src/desktop/project-store';
import { mergeImportedAssets } from '../src/renderer/AssetImportContext';
import { applyUiDraft } from '../src/core/ui-draft';

const png = (color: number) => { const p = new PNG({ width: 4, height: 6 }); p.data.fill(color); return PNG.sync.write(p); };
test('discovers project media in configured resources and game folders without moving files, importing scripts or duplicating companions', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-discovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = createProject(); project.resourceSettings = { directory: 'media', importMode: 'reference', syncFolders: false };
  const paths = ['media/人物/新立绘.png', 'game/images/背景.png', 'game/audio/music.ogg', 'loose.png', 'game/loose.png', 'game/fonts/font.ttf'];
  for (const [i, relative] of paths.entries()) { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, png(i + 1)); }
  await fs.mkdir(path.join(root, 'media/cache')); await fs.writeFile(path.join(root, 'media/cache/ignore.png'), png(50));
  await fs.writeFile(path.join(root, 'media/ignore.rpy'), 'must not execute');
  await fs.writeFile(path.join(root, 'media/duplicate.png'), png(1));
  await fs.writeFile(path.join(root, 'media/atlas.png'), png(55));
  project.assets.push({ id: 'spine', name: 'spine', kind: 'spine', path: 'media/actor.json', spine: { version: '4.2', atlasPath: 'media/actor.atlas', pages: [{ name: 'atlas.png', path: 'media/atlas.png', width: 4, height: 6 }], animations: [], skins: [], bounds: { x: 0, y: 0, width: 4, height: 6 } } });
  const discovery = new AssetDiscovery();
  const next = await discovery.scan(root, project);
  assert.ok(next); assert.equal(next.assets.length, 7);
  assert.ok(next.assets.slice(1).every(a => !a.externalPath && !a.path.includes('ignore')));
  for (const relative of paths) await fs.access(path.join(root, relative));
  assert.equal(await discovery.scan(root, next), undefined);
  assert.equal(await discovery.scan(root, project), undefined, 'undo does not immediately reimport discovered files');
  const file = path.join(root, 'project.vns.json');
  // The companion fixture only needs a source file to survive project save.
  await fs.writeFile(path.join(root, 'media/actor.json'), '{}');
  await fs.writeFile(path.join(root, 'media/actor.atlas'), 'atlas.png');
  await saveProject(file, next);
  assert.equal((await loadProject(file)).project.assets.length, 7);
});

test('incomplete images are retried after decoding becomes possible', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-discovery-retry-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'copying.jpg'), 'partial');
  const discovery = new AssetDiscovery(), project = createProject();
  assert.equal(await discovery.scan(root, project, () => ({ width: 0, height: 0 })), undefined);
  const next = await discovery.scan(root, project, () => ({ width: 8, height: 12 }));
  assert.equal(next?.assets[0].width, 8); assert.equal(next?.assets[0].height, 12);
});

test('external picker imports obey copy/reference, filter type, enforce single and return existing IDs for duplicate selection', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-picker-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'icon.PNG'), wrong = path.join(root, 'sound.ogg');
  await fs.writeFile(source, png(70)); await fs.writeFile(wrong, 'audio');
  for (const mode of ['copy', 'reference'] as const) {
    const project = createProject(); project.resourceSettings = { directory: 'media', importMode: mode };
    const dir = path.join(root, mode), options = parseAssetImportOptions({ single: true, extensions: ['PNG'] });
    const imported = await importAssetPaths(dir, project, [wrong, source], options);
    assert.equal(imported.report.imported, 1); assert.equal(imported.report.skipped, 1);
    const asset = imported.project.assets[0]; assert.deepEqual(imported.report.assetIds, [asset.id]);
    assert.equal(asset.externalPath, mode === 'reference' ? source : undefined);
    assert.deepEqual(await fs.readFile(assetSourcePath(dir, asset)), png(70));
    if (mode === 'reference') await assert.rejects(fs.access(path.join(dir, asset.path)), { code: 'ENOENT' });
    const duplicate = await importAssetPaths(dir, imported.project, [source], options);
    assert.deepEqual(duplicate.report.assetIds, [asset.id]); assert.equal(duplicate.report.duplicates, 1);
  }
  assert.throws(() => parseAssetImportOptions({ extensions: ['../png.png'] }));
});

test('resource merges preserve concurrent story and UI draft edits', () => {
  const base = createProject(), imported = structuredClone(base), current = structuredClone(base), ui = structuredClone(base);
  imported.assets.push({ id: 'new', name: '新图', kind: 'image', path: 'assets/new.png' });
  current.name = '并发改名'; ui.ui.accent = '#123456';
  mergeImportedAssets(current, imported);
  const working = applyUiDraft(current, { base, value: ui });
  assert.equal(working.name, '并发改名'); assert.equal(working.ui.accent, '#123456');
  assert.equal(working.assets[0].id, 'new');
});

test('PNG imports and discovery retain worker metadata without decoding again on the main thread', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-png-metadata-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sources = [path.join(root, 'opaque.png'), path.join(root, 'transparent.png'), path.join(root, 'other.jpg')];
  await fs.writeFile(sources[0], png(255)); await fs.writeFile(sources[1], png(0)); await fs.writeFile(sources[2], 'native decoder fixture');
  const measured: string[] = [];
  const measure = (file: string) => { measured.push(file); return { width: 8, height: 12 }; };
  const imported = await importAssetPaths(path.join(root, 'project'), createProject(), sources, {}, measure);
  assert.equal(imported.report.imported, 3); assert.deepEqual(imported.report.errors, []);
  assert.deepEqual(measured, [sources[2]]);
  assert.deepEqual(imported.project.assets.slice(0, 2).map(asset => [asset.width, asset.height, asset.visibleBounds]), [
    [4, 6, { x: 0, y: 0, width: 4, height: 6 }], [4, 6, undefined],
  ]);
  measured.length = 0;
  const discovered = await new AssetDiscovery().scan(root, createProject(), measure);
  assert.equal(discovered?.assets.length, 3); assert.deepEqual(measured, [sources[2]]);
  assert.equal(discovered.assets.find(asset => asset.name === 'transparent')?.visibleBounds, undefined);
});
test('a file that saving moved into a category folder is not imported again from the editor copy taken before the save', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-discovery-moved-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stale = createProject(); stale.assets.push({ id: 'qa_image', name: '验收图片', kind: 'image', path: 'assets/image.png' });
  const moved = 'assets/未分类/验收图片.png';
  await fs.mkdir(path.join(root, path.dirname(moved)), { recursive: true }); await fs.writeFile(path.join(root, moved), png(9));
  const saved = { ...stale, assets: [{ ...stale.assets.at(-1)!, path: moved }] };
  assert.equal((await new AssetDiscovery().scan(root, stale))?.assets.length, stale.assets.length + 1, 'without the saved copy the moved file looks new');
  assert.equal(await new AssetDiscovery().scan(root, stale, undefined, saved), undefined);
});
