import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProject } from '../src/core/model';
import { TemplateLibrary } from '../src/desktop/template-library';
import { autosaveProject, saveProject } from '../src/desktop/project-store';

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-templates-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bundled = path.join(root, 'bundled'), library = new TemplateLibrary(path.join(root, 'templates'), bundled);
  await saveProject(path.join(bundled, 'project.vns.json'), createProject('哀鸿示例'));
  return { root, bundled, library };
}

test('templates can be created, saved, reopened and copied with separate identities', async t => {
  const { library } = await fixture(t);
  assert.deepEqual((await library.list()).map(item => item.id), ['aihong']);
  const original = await library.create('自制模板');
  original.project.variables.push({ id: 'score', name: '积分', type: 'number', initial: 42, persistent: false });
  original.project.name = '已改名的模板';
  await saveProject(original.path!, original.project);
  assert.equal((await library.open(original.template!.id)).project.variables[0].initial, 42);
  assert.equal((await library.list()).find(item => item.id === original.template!.id)?.name, '已改名的模板');
  const copied = await library.create('模板副本', original.template!.id);
  assert.notEqual(copied.project.id, original.project.id);
  assert.notEqual(copied.template!.id, original.template!.id);
  assert.equal(copied.project.variables[0].initial, 42);
  copied.project.variables[0].initial = 11; await saveProject(copied.path!, copied.project);
  assert.equal((await library.open(original.template!.id)).project.variables[0].initial, 42);
  assert.deepEqual(library.identify(original.path), original.template);
});

test('editing built-in template creates a local version and future projects use it', async t => {
  const { root, library, bundled } = await fixture(t);
  const before = await fs.readFile(path.join(bundled, 'project.vns.json'), 'utf8');
  const editable = await library.open('aihong');
  editable.project.version = '2.0.0'; await saveProject(editable.path!, editable.project);
  const next = await library.createProject('新项目', 'aihong', path.join(root, 'projects'));
  assert.equal(next.project.version, '2.0.0');
  assert.notEqual(next.project.id, editable.project.id);
  assert.equal(next.template, undefined);
  assert.equal(library.identify(next.path), undefined);
  assert.equal(await fs.readFile(path.join(bundled, 'project.vns.json'), 'utf8'), before);
  assert.equal((await library.list())[0].customized, true);
});

test('copies materialize referenced assets and preserve independent files', async t => {
  const { root, library } = await fixture(t);
  const template = await library.create('素材模板');
  const external = path.join(root, 'external.ogg'); await fs.writeFile(external, 'original audio');
  template.project.assets.push({ id: 'audio', name: '外部音乐', kind: 'audio', path: 'assets/audio.ogg', externalPath: external });
  await saveProject(template.path!, template.project);
  const copy = await library.create('素材副本', template.template!.id);
  const asset = copy.project.assets[0];
  assert.equal(asset.externalPath, undefined);
  assert.equal(asset.externalFiles, undefined);
  await fs.writeFile(external, 'changed original');
  const copiedFile = path.join(path.dirname(copy.path!), asset.path);
  assert.equal(await fs.readFile(copiedFile, 'utf8'), 'original audio');
  const game = await library.createProject('独立游戏', copy.template!.id, path.join(root, 'projects'));
  await fs.writeFile(copiedFile, 'changed template');
  assert.equal(await fs.readFile(path.join(path.dirname(game.path!), game.project.assets[0].path), 'utf8'), 'original audio');
});

test('only saved changes are used for creation while editor restores recovery drafts', async t => {
  const { root, library } = await fixture(t);
  const template = await library.create('已保存模板');
  const draft = { ...template.project, version: '9.0.0' };
  await autosaveProject(template.path!, draft);
  // Ensure the autosave is newer even on coarse filesystem clocks.
  await fs.utimes(template.path!, new Date(0), new Date(0));
  assert.equal((await library.open(template.template!.id)).project.version, '9.0.0');
  const game = await library.createProject('只用已保存版本', template.template!.id, path.join(root, 'projects'));
  assert.equal(game.project.version, template.project.version);
});

test('invalid template identifiers and existing project directories never overwrite files', async t => {
  const { root, library } = await fixture(t);
  for (const id of ['branching', '../escape', 'user:../../escape', 'user:C:\\escape']) {
    await assert.rejects(library.create('无效模板', id as never), /模板不存在/);
  }
  await assert.rejects(library.create('  '), /名称/);
  const game = await library.createProject('重名', 'blank', root);
  const before = await fs.readFile(game.path!, 'utf8');
  await assert.rejects(library.createProject('重名', 'aihong', root), /同名文件夹/);
  assert.equal(await fs.readFile(game.path!, 'utf8'), before);
  assert.equal(library.identify(path.join(root, 'project.vns.json')), undefined);
});

test('failed asset copying removes only its own new folder and leaves source intact', async t => {
  const { root, library } = await fixture(t);
  const template = await library.create('缺失素材');
  template.project.assets.push({ id: 'missing', name: '缺失', kind: 'audio', path: 'assets/missing.ogg' });
  await saveProject(template.path!, template.project);
  const before = await fs.readFile(template.path!, 'utf8');
  await assert.rejects(library.createProject('未完成工程', template.template!.id, root));
  await assert.rejects(fs.access(path.join(root, '未完成工程')));
  assert.equal(await fs.readFile(template.path!, 'utf8'), before);
});

test('the editor save dialog creates from a template in an existing folder without overwriting projects', async t => {
  const { root, library } = await fixture(t);
  const template = await library.create('保存对话框模板');
  const folder = path.join(root, 'existing'); await fs.mkdir(folder);
  const file = path.join(folder, 'project.vns.json');
  const saved = await library.createProjectFile('新工程', template.template!.id, file);
  assert.equal(saved.project.name, '新工程');
  assert.notEqual(saved.project.id, template.project.id);
  const before = await fs.readFile(file, 'utf8');
  await assert.rejects(library.createProjectFile('不能覆盖', template.template!.id, file), /已有工程文件/);
  assert.equal(await fs.readFile(file, 'utf8'), before);
  assert.deepEqual(await fs.readdir(path.join(library.root, '.staging')), []);
});
