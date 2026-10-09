import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, targets } from '../src/core/model';
import { copyStoryModule, createStoryModule, insertStoryModule, removeStoryModule } from '../src/core/story-modules';

test('在模块上下插入、复制和删除时同时维护排列与剧情连接', () => {
  const project = createProject('模块');
  const anchor = project.nodes.find(node => node.kind === 'passage')!;
  const oldNext = 'next' in anchor ? anchor.next : undefined;
  const sceneId = anchor.sceneId;
  const after = createStoryModule('standalone', sceneId);
  insertStoryModule(project, after, sceneId, anchor.id, 'below');
  assert.equal(targets(project.nodes.find(node => node.id === anchor.id)!)[0].target, after.id);
  assert.equal(targets(project.nodes.find(node => node.id === after.id)!)[0].target, oldNext);
  const before = copyStoryModule(after);
  insertStoryModule(project, before, sceneId, after.id, 'above');
  assert.notEqual(before.id, after.id);
  assert.ok(before.kind === 'passage' && after.kind === 'passage');
  assert.notEqual(before.lines[0].id, after.lines[0].id);
  assert.equal(project.nodes[project.nodes.findIndex(node => node.id === after.id) - 1].id, before.id);
  assert.equal(targets(project.nodes.find(node => node.id === anchor.id)!)[0].target, before.id);
  removeStoryModule(project, before.id);
  assert.equal(targets(project.nodes.find(node => node.id === anchor.id)!)[0].target, after.id);
  removeStoryModule(project, after.id);
  assert.equal(targets(project.nodes.find(node => node.id === anchor.id)!)[0].target, oldNext);
});

test('空小节可添加模块，复制内容互不修改，入口删除不留下悬空连接', () => {
  const project = createProject('模块');
  const module = createStoryModule('dialogue', project.scenes[0].id);
  project.nodes = []; project.entryId = module.id;
  insertStoryModule(project, module, module.sceneId);
  const copied = copyStoryModule(module);
  assert.ok(copied.kind === 'passage' && module.kind === 'passage');
  copied.lines[0].text = '副本';
  assert.equal(module.lines[0].text, '');
  insertStoryModule(project, copied, module.sceneId, module.id);
  removeStoryModule(project, module.id);
  assert.equal(project.entryId, copied.id);
  assert.equal(project.nodes.length, 1);
});
