import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProject } from '../src/core/model';
import { atomicWrite, autosaveProject, containedPath, loadProject, parseProject, saveProject } from '../src/desktop/project-store';
import { validateProject } from '../src/core/validate';
import { assetCategoryNames } from '../src/core/asset-library';

test('atomic replacement survives a transient Windows reader lock without exposing partial data', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-atomic-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'preview-control.json');
  await fs.writeFile(file, '{"revision":1}');
  const rename = fs.rename.bind(fs);
  let attempts = 0;
  t.mock.method(fs, 'rename', async (from: string, to: string) => {
    assert.equal(await fs.readFile(to, 'utf8'), '{"revision":1}');
    assert.equal(await fs.readFile(from, 'utf8'), '{"revision":2}');
    if (++attempts < 3) throw Object.assign(new Error('Sharing violation'), { code: 'EPERM' });
    await rename(from, to);
  });
  await atomicWrite(file, '{"revision":2}');
  assert.equal(attempts, 3);
  assert.equal(await fs.readFile(file, 'utf8'), '{"revision":2}');
  assert.deepEqual(await fs.readdir(dir), ['preview-control.json']);
});

test('atomic replacement reports persistent locks and preserves the last complete file', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-atomic-failed-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'preview-control.json');
  await fs.writeFile(file, '{"revision":1}');
  let attempts = 0;
  t.mock.method(fs, 'rename', async () => {
    attempts++;
    throw Object.assign(new Error('Locked'), { code: 'EPERM' });
  });
  await assert.rejects(atomicWrite(file, '{"revision":2}'), { code: 'EPERM' });
  assert.ok(attempts > 1 && attempts <= 8, 'Retries must be bounded');
  assert.equal(await fs.readFile(file, 'utf8'), '{"revision":1}');
  assert.deepEqual(await fs.readdir(dir), ['preview-control.json']);
});

test('saved project preserves IDs, content, and graph links after reopening', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-save-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'project.vns.json');
  const project = createProject('中文引号 " [名字] {文本}');
  const saved = await saveProject(file, project);
  assert.deepEqual((await loadProject(file)).project, saved.project);
  const { contentBrowser, ...contents } = saved.project;
  assert.deepEqual(contents, project);
  assert.deepEqual(contentBrowser!.folders.map(folder => folder.category), Object.keys(assetCategoryNames));
  assert.equal(project.contentBrowser, undefined);
  for (const name of Object.values(assetCategoryNames)) assert.ok((await fs.stat(path.join(dir, 'assets', name))).isDirectory());
});

test('save-as preflights every asset before copying and never overwrites different destination content', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-copy-conflict-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source'), destination = path.join(dir, 'destination');
  await fs.mkdir(path.join(source, 'assets'), { recursive: true });
  await fs.mkdir(path.join(destination, 'assets'), { recursive: true });
  const project = createProject('模板副本');
  project.assets = ['first', 'conflict'].map(id => ({ id, name: id, kind: 'image', path: `assets/${id}.png` }));
  await fs.writeFile(path.join(source, 'assets/first.png'), 'new asset');
  await fs.writeFile(path.join(source, 'assets/conflict.png'), 'template asset');
  await fs.writeFile(path.join(destination, 'assets/conflict.png'), 'user asset');
  const file = path.join(destination, 'project.vns.json');
  await saveProject(file, createProject('目标工程'));
  const original = await fs.readFile(file);
  await assert.rejects(saveProject(file, project, source), /同名.*素材|素材.*冲突/);
  assert.deepEqual(await fs.readFile(file), original);
  assert.equal(await fs.readFile(path.join(destination, 'assets/conflict.png'), 'utf8'), 'user asset');
  await assert.rejects(fs.access(path.join(destination, 'assets/first.png')), { code: 'ENOENT' });
  await assert.rejects(fs.access(`${file}.previous`), { code: 'ENOENT' });
});

test('missing grouped asset files abort save-as before any destination assets are copied', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-copy-missing-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source'), file = path.join(dir, 'destination/project.vns.json');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'skeleton.json'), '{}');
  const project = createProject();
  project.assets = [{ id: 'spine', name: '骨骼', kind: 'spine', path: 'skeleton.json', spine: { version: '4.2', atlasPath: 'missing.atlas', pages: [{ name: 'page.png', path: 'page.png', width: 1, height: 1 }], animations: [], skins: [], bounds: { x: 0, y: 0, width: 1, height: 1 } } }];
  await assert.rejects(saveProject(file, project, source), /missing.atlas/);
  await assert.rejects(fs.access(path.join(path.dirname(file), 'skeleton.json')), { code: 'ENOENT' });
  await assert.rejects(fs.access(file), { code: 'ENOENT' });
});

test('save-as reuses identical files and retains grouped paths when folder synchronization is disabled', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-copy-identical-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source'), destination = path.join(dir, 'destination');
  await fs.mkdir(source); await fs.mkdir(destination);
  for (const name of ['skeleton.json', 'skeleton.atlas', 'page.png']) await fs.writeFile(path.join(source, name), name);
  await fs.copyFile(path.join(source, 'page.png'), path.join(destination, 'page.png'));
  await fs.utimes(path.join(destination, 'page.png'), new Date(0), new Date(0));
  const before = (await fs.stat(path.join(destination, 'page.png'))).mtimeMs;
  const project = createProject();
  project.resourceSettings!.syncFolders = false;
  project.assets = [{ id: 'spine', name: '骨骼', kind: 'spine', path: 'skeleton.json', spine: { version: '4.2', atlasPath: 'skeleton.atlas', pages: [{ name: 'page.png', path: 'page.png', width: 1, height: 1 }], animations: [], skins: [], bounds: { x: 0, y: 0, width: 1, height: 1 } } }];
  const saved = await saveProject(path.join(destination, 'project.vns.json'), project, source);
  assert.equal((await fs.stat(path.join(destination, 'page.png'))).mtimeMs, before);
  for (const name of ['skeleton.json', 'skeleton.atlas', 'page.png']) assert.deepEqual(await fs.readFile(path.join(destination, name)), await fs.readFile(path.join(source, name)));
  assert.deepEqual(saved.project.assets, parseProject(project).project.assets);
});

test('crash recovery uses a valid autosave and preserves the original file', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-recover-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'project.vns.json');
  const project = createProject('保存的标题');
  await saveProject(file, project);
  await fs.utimes(file, new Date(0), new Date(0));
  await autosaveProject(file, { ...project, name: '恢复的标题' });
  const recovered = await loadProject(file);
  assert.equal(recovered.project.name, '恢复的标题');
  assert.equal(recovered.recovered, true);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).name, '保存的标题');
  await saveProject(file, recovered.project);
  assert.equal((await loadProject(file)).recovered, false);
});

test('corrupt recovery never replaces a valid project; previous version recovers corrupt main data', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-backup-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'project.vns.json');
  const project = createProject('第一版');
  await saveProject(file, project);
  await saveProject(file, { ...project, name: '第二版' });
  await fs.writeFile(`${file}.autosave`, '{broken');
  assert.equal((await loadProject(file)).project.name, '第二版');
  await fs.writeFile(file, '{broken');
  assert.equal((await loadProject(file)).project.name, '第一版');
});

test('migrates the supported old format and rejects future schemas', () => {
  const project = createProject();
  const { name, ...rest } = project;
  const migrated = parseProject({ ...rest, schemaVersion: 0, title: name });
  assert.equal(migrated.migrated, true);
  assert.deepEqual(migrated.project, project);
  assert.throws(() => parseProject({ ...project, schemaVersion: 99 }), /不兼容/);
});

test('paths stay inside the project across Windows and POSIX separators', () => {
  for (const relative of ['../private', '..\\private', 'C:\\private', '/private', '\\\\server\\share', 'assets/../../private', 'assets/x:stream']) assert.throws(() => containedPath('E:\\project', relative));
  assert.ok(containedPath(path.resolve('project'), 'assets/人物.png').endsWith(path.join('assets', '人物.png')));
});

test('validation catches missing branches and references while allowing interactive loops', () => {
  const project = createProject();
  assert.equal(validateProject(project).filter(d => d.severity === 'error').length, 0);
  const passage = project.nodes.find(n => n.kind === 'passage')!;
  assert.equal(passage.kind, 'passage');
  if (passage.kind !== 'passage') return;
  passage.lines[0].text = '再来一次';
  passage.next = passage.id;
  assert.equal(validateProject(project).filter(d => d.severity === 'error').length, 0);
  passage.lines = [];
  assert.ok(validateProject(project).some(d => d.message.includes('循环')));
  passage.next = 'missing';
  assert.ok(validateProject(project).some(d => d.message.includes('已不存在')));
});
