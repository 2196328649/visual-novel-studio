import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { createCustomUiPage } from '../src/core/game-flow';
import { gamePreviewOrigin, pagePreviewOrigin } from '../src/core/preview-origin';

test('story entry overrides do not masquerade as the actual game preview boot origin', () => {
  const p = createProject(), passage = p.nodes.find(n => n.kind === 'passage')!;
  const origin = gamePreviewOrigin(p, { entryId: passage.id });
  assert.equal(origin.kind, 'launch');
  assert.equal(origin.label, '从启动预览');
  assert.equal(origin.storyEntry, passage.name);
  assert.equal(gamePreviewOrigin(p).storyEntry, p.nodes.find(n => n.id === p.entryId)!.name);
  assert.equal(gamePreviewOrigin(p, { flowStart: 'launch' }).kind, 'launch');
});

test('title preview explains its one-time startup bypass, not a permanent disable of startup rules', () => {
  const p = createProject();
  const origin = gamePreviewOrigin(p, { flowStart: 'title', entryId: p.entryId });
  assert.equal(origin.label, '从标题预览');
  assert.match(origin.detail, /本次直接显示标题/);
  assert.match(origin.detail, /之后返回标题/);
  assert.equal(gamePreviewOrigin(p, { entryId: 'deleted' }).storyEntry, '剧情起点已不存在');
});

test('page previews name the actual built-in or custom page and distinguish partial simulation', () => {
  const p = createProject(), page = createCustomUiPage(p, '提示页面');
  const snapshot = structuredClone(p);
  const origin = pagePreviewOrigin(p, page.id);
  assert.equal(origin.kind, 'page');
  assert.equal(origin.label, '从当前页面预览：提示页面');
  assert.match(origin.detail, /不执行完整的启动、新游戏和剧情流程/);
  assert.equal(pagePreviewOrigin(p, 'ui:main').pageName, '标题');
  assert.deepEqual(p, snapshot);
  page.name = '新名称';
  assert.equal(pagePreviewOrigin(p, page.id).pageName, '新名称');
});

test('missing page references are not silently presented as the current title or another page', () => {
  const p = createProject();
  assert.equal(pagePreviewOrigin(p, 'missing').pageName, '页面已不存在');
  assert.equal(pagePreviewOrigin(p, 'ui:missing').pageName, '页面已不存在');
});
