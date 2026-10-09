import { test } from 'node:test';
import { PNG } from 'pngjs';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createProject, projectSchema } from '../src/core/model';
import { assetCategories, assetGroupPath, ensureAssetFolder, organizeAssetLibrary, setAssetCategory } from '../src/core/asset-library';
import { moveContent } from '../src/core/content-browser';
import { importAssetPaths, parseAssetImportOptions } from '../src/desktop/asset-import';
import { loadProject, saveProject } from '../src/desktop/project-store';

test('legacy usage separates backgrounds, UI, voices and BGM while authored categories win', () => {
  const project = createProject();
  project.assets = [
    { id: 'scene', kind: 'image', name: '方院', path: 'assets/a.png' },
    { id: 'ui', kind: 'image', name: '底框', path: 'assets/b.png' },
    { id: 'voice', kind: 'audio', name: '一句话', path: 'assets/a.ogg' },
    { id: 'bgm', kind: 'audio', name: '曲子', path: 'assets/b.ogg' },
  ];
  project.ui.menuMusicId = 'bgm'; project.ui.continueIndicatorId = 'ui';
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines[0].voiceId = 'voice'; passage.lines[0].actions = [{ kind: 'background', assetId: 'scene', transition: 'none' }];
  const before = structuredClone(project.nodes);
  organizeAssetLibrary(project);
  assert.deepEqual(Object.fromEntries(assetCategories(project)), { scene: 'scene', ui: 'ui', voice: 'voice', bgm: 'bgm' });
  assert.equal(assetGroupPath(project, project.assets[2]), '配音');
  setAssetCategory(project, ['voice'], 'sound');
  assert.equal(assetCategories(project).get('voice'), 'sound');
  const voiceFolder = ensureAssetFolder(project, 'voice', ['苏怜烟']);
  assert.equal(moveContent(project, ['asset:bgm', 'asset:scene'], voiceFolder), 2);
  assert.equal(project.contentBrowser!.assignments['asset:scene'], voiceFolder);
  assert.equal(assetCategories(project).get('bgm'), 'voice');
  assert.equal(assetCategories(project).get('scene'), 'scene');
  assert.deepEqual(project.nodes, before);
  assert.deepEqual(projectSchema.parse(JSON.parse(JSON.stringify(project))).contentBrowser, JSON.parse(JSON.stringify(project.contentBrowser)));
});

test('recursive import preserves nested character groups, copies sources, deduplicates and survives save/reopen', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-asset-import-'));
  try {
    const source = path.join(root, '配音'), target = path.join(root, 'project');
    await fs.mkdir(path.join(source, '苏怜烟', '第一章'), { recursive: true });
    await fs.mkdir(path.join(source, '王生'), { recursive: true });
    await fs.writeFile(path.join(source, '苏怜烟', '第一章', '001.ogg'), 'voice-one');
    await fs.writeFile(path.join(source, '王生', '001.ogg'), 'voice-two');
    await fs.writeFile(path.join(source, 'README.txt'), 'not an asset');
    const result = await importAssetPaths(target, createProject(), [source, path.join(source, '王生', '001.ogg')]);
    assert.equal(result.report.imported, 2); assert.equal(result.report.skipped, 1); assert.deepEqual(result.report.errors, []);
    assert.deepEqual(result.project.assets.map(asset => assetGroupPath(result.project, asset)).sort(), ['配音 / 王生', '配音 / 苏怜烟 / 第一章']);
    for (const asset of result.project.assets) assert.equal(await fs.readFile(path.join(target, asset.path), 'utf8'), asset.sourcePath!.startsWith('王生') ? 'voice-two' : 'voice-one');
    const again = await importAssetPaths(target, result.project, [source]);
    assert.equal(again.report.imported, 0); assert.equal(again.report.duplicates, 2);
    assert.deepEqual(again.project, result.project);
    const file = path.join(target, 'project.vns.json'); await saveProject(file, again.project);
    assert.deepEqual((await loadProject(file)).project.contentBrowser, JSON.parse(JSON.stringify(result.project.contentBrowser)));
    assert.equal(await fs.readFile(path.join(source, '苏怜烟', '第一章', '001.ogg'), 'utf8'), 'voice-one');
  } finally { assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('vns-asset-import-')); await fs.rm(root, { recursive: true, force: true }); }
});

test('mixed directory imports route incompatible files out of a typed destination and report unreadable files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-mixed-import-'));
  try {
    const source = path.join(root, '苏怜烟'); await fs.mkdir(source);
    await fs.writeFile(path.join(source, '背景.png'), PNG.sync.write(new PNG({ width: 1, height: 1 })));
    await fs.writeFile(path.join(source, '001.ogg'), 'voice');
    const project = createProject(), destination = ensureAssetFolder(project, 'voice');
    const result = await importAssetPaths(path.join(root, 'project'), project, [source, path.join(root, 'missing.ogg')], { folderId: destination });
    assert.equal(result.report.imported, 2); assert.equal(result.report.errors.length, 1);
    const image = result.project.assets.find(asset => asset.kind === 'image')!, audio = result.project.assets.find(asset => asset.kind === 'audio')!;
    assert.equal(assetGroupPath(result.project, image), '场景 / 苏怜烟'); assert.equal(assetGroupPath(result.project, audio), '配音 / 苏怜烟');
    assert.equal(image.width, 1); assert.equal(image.height, 1);
    assert.throws(() => parseAssetImportOptions({ paths: ['relative/file.ogg'] }));
  } finally { assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('vns-mixed-import-')); await fs.rm(root, { recursive: true, force: true }); }
});
