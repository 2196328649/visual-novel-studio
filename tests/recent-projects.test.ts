import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { RecentProjects } from '../src/desktop/recent-projects';

test('recent projects migrate the prior workspace, deduplicate, detect missing files and only remove records', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-recents-'));
  const file = path.join(root, 'workspace.json'), first = path.join(root, 'project.vns.json'), missing = path.join(root, 'moved.json');
  await fs.writeFile(first, '{}'); await fs.writeFile(file, JSON.stringify({ path: first }));
  const recent = new RecentProjects(file);
  assert.equal((await recent.list())[0].available, true);
  await recent.remember(first, '第一本书'); await recent.remember(missing, '移动过的工程'); await recent.remember(first, '改名后的作品');
  const items = await recent.list(); assert.equal(items.length, 2); assert.equal(items[0].name, '改名后的作品'); assert.equal(items[1].available, false);
  await recent.remember(null, '新草稿'); assert.equal((await recent.list()).length, 2);
  await recent.forget(first); assert.equal((await recent.list()).length, 1); assert.equal(await fs.readFile(first, 'utf8'), '{}');
});
test('recent project writes are serialized and malformed preferences are recoverable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-recents-'));
  const file = path.join(root, 'workspace.json'), recent = new RecentProjects(file);
  await fs.writeFile(file, 'null'); assert.deepEqual(await recent.list(), []);
  await Promise.all(Array.from({ length: 25 }, (_, i) => recent.remember(path.join(root, i + '.json'), '工程 ' + i)));
  const items = await recent.list(); assert.equal(items.length, 20); assert.equal(items[0].name, '工程 24');
  await fs.writeFile(items[0].path + '.autosave', '{}'); assert.equal((await recent.list())[0].available, false);
  assert.equal((await recent.list())[0].recoveryAvailable, true);
  await recent.forget(items[0].path); assert.equal((await recent.list()).some(item => item.path === items[0].path), false);
});
