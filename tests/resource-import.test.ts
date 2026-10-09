import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createProject, projectSchema } from '../src/core/model';
import { assetSourcePath, importAsset, loadProject, saveProject } from '../src/desktop/project-store';
import { importAssetPaths } from '../src/desktop/asset-import';
import { copyAssetSelection, createContentFolder, moveContent } from '../src/core/content-browser';
import { assetCategoryNames, folderCategory } from '../src/core/asset-library';

test('directory imports retain nested source layout in a configurable project folder', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-resources-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'original'), destination = path.join(root, 'project');
  await fs.mkdir(path.join(source, 'chapter/portraits'), { recursive: true });
  const bytes = Buffer.from('import fixture image');
  await fs.writeFile(path.join(source, 'chapter/portraits/actor.png'), bytes);
  const project = createProject(); project.resourceSettings = { importMode: 'copy', directory: 'media' };
  const imported = await importAssetPaths(destination, project, [source]);
  assert.equal(imported.report.imported, 1);
  assert.deepEqual(imported.report.errors, []);
  const asset = imported.project.assets[0];
  assert.match(asset.path, /^media\/立绘\/original\/chapter\/portraits\//);
  assert.equal(folderCategory(imported.project, imported.project.contentBrowser!.assignments['asset:' + asset.id]), 'portrait');
  for (const name of Object.values(assetCategoryNames)) assert.ok((await fs.stat(path.join(destination, 'media', name))).isDirectory());
  assert.deepEqual(await fs.readFile(assetSourcePath(destination, asset)), bytes);
  const duplicate = await importAssetPaths(destination, imported.project, [source]);
  assert.equal(duplicate.report.duplicates, 1);
  assert.equal(duplicate.project.assets.length, 1);
  assert.deepEqual(await fs.readFile(path.join(source, 'chapter/portraits/actor.png')), bytes);
});

test('external references survive save-as while project-owned companion files are copied', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-reference-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'original.png'); await fs.writeFile(source, 'external bytes');
  const first = path.join(root, 'first'), second = path.join(root, 'second'); await fs.mkdir(first);
  const project = createProject(); project.resourceSettings = { importMode: 'reference', directory: 'media' };
  const asset = await importAsset(first, source, { mode: 'reference', directory: 'media' });
  project.assets.push(asset);
  assert.equal(asset.externalPath, source);
  assert.equal(assetSourcePath(first, asset), source);
  await assert.rejects(fs.access(path.join(first, asset.path)), { code: 'ENOENT' });
  await fs.writeFile(path.join(first, 'derived.png'), 'local bytes');
  project.assets.push({ id: 'derived', name: 'derived', kind: 'image', path: 'derived.png' });
  await saveProject(path.join(first, 'project.vns.json'), project);
  const copy = await saveProject(path.join(second, 'project.vns.json'), project, first);
  assert.equal(copy.project.assets[0].externalPath, source);
  assert.deepEqual(await fs.readFile(assetSourcePath(second, copy.project.assets[1])), Buffer.from('local bytes'));
  assert.equal(copy.project.assets[1].path, 'media/未分类/derived.png');
  await assert.rejects(fs.access(path.join(second, asset.path)), { code: 'ENOENT' });
  assert.deepEqual((await loadProject(path.join(second, 'project.vns.json'))).project, copy.project);
  assert.throws(() => assetSourcePath(first, asset, 'different.png'), /素材|文件|资源/);
});

test('asset and folder clipboard copies preserve file references and duplicate only once', () => {
  const project = createProject();
  project.assets.push({ id: 'image', name: 'image', kind: 'image', path: 'assets/image.png', externalPath: path.resolve('original.png') });
  const parent = createContentFolder(project, 'parent')!, child = createContentFolder(project, 'child', parent)!;
  moveContent(project, ['asset:image'], child);
  const before = structuredClone(project), keys = copyAssetSelection(project, before, ['folder:' + parent, 'folder:' + child, 'asset:image']);
  assert.equal(project.assets.length, 2);
  assert.equal(keys.length, 2);
  assert.notEqual(project.assets[1].id, project.assets[0].id);
  assert.equal(project.assets[1].externalPath, project.assets[0].externalPath);
  assert.equal(project.assets[1].path, project.assets[0].path);
  assert.equal(project.contentBrowser!.folders.length, 4);
  projectSchema.parse(project);
});

test('resource directories reject absolute paths and traversal', () => {
  for (const directory of ['../assets', 'C:/assets', '/assets', 'assets/../other', 'assets//child']) assert.equal(projectSchema.safeParse({ ...createProject(), resourceSettings: { importMode: 'copy', directory } }).success, false, directory);
});
