import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProject } from '../src/core/model';
import { autosaveProject, saveProject } from '../src/desktop/project-store';
import { autosaveAtLocation, discardProjectRecovery, loadRelocatedProject, projectFileExists, projectRecoveryFile, recoverProjectAtLocation } from '../src/desktop/project-location';
import { RecentProjects } from '../src/desktop/recent-projects';

async function fixture(t: any) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-move-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const old = path.join(root, 'old', 'project.vns.json'), moved = path.join(root, 'moved', 'project.vns.json'), data = path.join(root, 'profile');
  const { project } = await saveProject(old, createProject('移动工程'));
  return { root, old, moved, data, project };
}

test('moving an open project preserves edits outside the old folder and relinks one recent entry', async t => {
  const { old, moved, data, project } = await fixture(t);
  const recent = new RecentProjects(path.join(data, 'workspace.json'));
  await recent.remember(old, project.name, project.id);
  const before = await fs.readFile(old, 'utf8');
  await fs.rename(path.dirname(old), path.dirname(moved));
  project.name = '移动后继续写作';
  const result = await autosaveAtLocation(old, project, data);
  assert.equal(result.locationMissing, true);
  assert.equal(await projectFileExists(path.dirname(old)), false);
  assert.equal(await fs.readFile(moved, 'utf8'), before);
  const [missing] = await recent.list();
  assert.equal(missing.available, false); assert.equal(missing.recoveryAvailable, true);
  const recovery = await recoverProjectAtLocation(old, data);
  assert.equal(recovery.project.name, project.name); assert.equal(recovery.path, old); assert.equal(recovery.locationMissing, true);
  const next = await loadRelocatedProject(moved, project.id);
  await recent.remember(next.path, next.project.name, next.project.id, old);
  const items = await recent.list();
  assert.equal(items.length, 1); assert.equal(items[0].path, moved); assert.equal(items[0].available, true);
  assert.equal(items[0].projectId, project.id);
  assert.equal(await fs.readFile(moved, 'utf8'), before);
  assert.equal(await projectFileExists(projectRecoveryFile(data, old) + '.autosave'), true);
});

test('moving a folder between the existence check and autosave never recreates it', async t => {
  const { old, moved, data, project } = await fixture(t);
  const stat = fs.stat.bind(fs);
  let movedOnce = false;
  t.mock.method(fs, 'stat', async (...args: any[]) => {
    const value = await (stat as any)(...args);
    if (args[0] === old && !movedOnce) { movedOnce = true; await fs.rename(path.dirname(old), path.dirname(moved)); }
    return value;
  });
  assert.equal((await autosaveAtLocation(old, project, data)).locationMissing, true);
  assert.equal(await projectFileExists(path.dirname(old)), false);
  assert.equal((await recoverProjectAtLocation(old, data)).project.id, project.id);
});

test('a leftover autosave is recovery-only, and later fallback recovery wins', async t => {
  const { old, moved, data, project } = await fixture(t);
  await fs.rename(path.dirname(old), path.dirname(moved));
  await autosaveProject(old, project); // A previous editor version recreated only this file.
  project.name = '最新修改';
  await autosaveAtLocation(old, project, data);
  const recent = new RecentProjects(path.join(data, 'workspace.json'));
  await recent.remember(old, project.name, project.id);
  assert.equal((await recent.list())[0].available, false);
  assert.equal((await recent.list())[0].recoveryAvailable, true);
  assert.equal((await recoverProjectAtLocation(old, data)).project.name, '最新修改');
  assert.equal(await projectFileExists(old), false);
});

test('draft and separate missing projects retain independent recovery contents', async t => {
  const { old, moved, data, project } = await fixture(t);
  await fs.rename(path.dirname(old), path.dirname(moved));
  const draft = createProject('未保存的新工程'), other = createProject('另一个移动的工程');
  const otherPath = path.join(data, 'other-project', 'project.vns.json');
  await autosaveAtLocation(null, draft, data);
  await autosaveAtLocation(old, project, data);
  await autosaveAtLocation(otherPath, other, data);
  assert.equal((await recoverProjectAtLocation(old, data)).project.id, project.id);
  assert.equal((await recoverProjectAtLocation(otherPath, data)).project.id, other.id);
  const raw = JSON.parse(await fs.readFile(path.join(data, 'draft.vns.json.autosave'), 'utf8'));
  assert.equal(raw.project.id, draft.id);
});

test('relocation rejects another project and an autosave without the main file', async t => {
  const { old, moved, project } = await fixture(t);
  await saveProject(moved, createProject('其他作品'));
  await assert.rejects(loadRelocatedProject(moved, project.id), /另一个工程/);
  await fs.rm(old); await autosaveProject(old, project);
  await assert.rejects(loadRelocatedProject(old, project.id), /工程文件/);
});

test('ordinary autosave stays beside an existing project', async t => {
  const { old, data, project } = await fixture(t);
  assert.equal((await autosaveAtLocation(old, project, data)).locationMissing, false);
  assert.equal(await projectFileExists(old + '.autosave'), true);
  assert.equal(await projectFileExists(projectRecoveryFile(data, old) + '.autosave'), false);
});

test('discarding clears both recovery locations without changing saved work or other projects', async t => {
  const { old, data, project } = await fixture(t);
  const before = await fs.readFile(old, 'utf8');
  const otherPath = path.join(data, 'other-project', 'project.vns.json');
  const other = createProject('保留另一个工程的恢复');
  await autosaveAtLocation(otherPath, other, data);
  project.name = '放弃的修改';
  await autosaveAtLocation(old, project, data);
  await autosaveProject(projectRecoveryFile(data, old), project);
  await discardProjectRecovery(old, data);
  await discardProjectRecovery(old, data);
  assert.equal(await projectFileExists(old + '.autosave'), false);
  assert.equal(await projectFileExists(projectRecoveryFile(data, old) + '.autosave'), false);
  assert.equal(await fs.readFile(old, 'utf8'), before);
  assert.equal((await recoverProjectAtLocation(otherPath, data)).project.id, other.id);
  await autosaveAtLocation(null, createProject('丢弃草稿'), data);
  await discardProjectRecovery(null, data);
  assert.equal(await projectFileExists(path.join(data, 'draft.vns.json.autosave')), false);
  assert.equal((await recoverProjectAtLocation(otherPath, data)).project.id, other.id);
});
