import test from 'node:test';
import assert from 'node:assert/strict';
import { aiAnimationTargetsFixture } from '../scripts/lib/ai-animation-targets-fixture';
import { resolveAiEditorTarget } from '../src/core/ai-editor-targets';
import { requestUiAnimationFocus, type UiAnimationFocus } from '../src/renderer/ui-animation-editor-focus';

test('animation targets resolve exact scopes and keys without changing the active game scheme', () => {
  const { project, base, sameName, scoped, custom } = aiAnimationTargetsFixture(), before = structuredClone(project);
  const resolve = (animationId: string, trackId?: string, keyId?: string) => resolveAiEditorTarget(project, { kind: 'uiAnimation', animationId, trackId, keyId });
  const first = resolve(base.id, base.tracks.at(-1)!.id, base.tracks.at(-1)!.keys[1].id);
  assert.ok(first.kind === 'uiAnimation'); assert.equal(first.ui.instanceId, undefined); assert.equal(first.ui.page, 'main'); assert.equal(first.ui.componentId, 'more_9'); assert.match(first.label, /2 秒/);
  const named = resolve(sameName.id); assert.ok(named.kind === 'uiAnimation'); assert.equal(named.animationId, sameName.id); assert.equal(named.trackId, undefined);
  const scheme = resolve(scoped.id); assert.ok(scheme.kind === 'uiAnimation'); assert.deepEqual(scheme.ui, { page: 'preferences', instanceId: 'scheme', componentId: undefined });
  const page = resolve(custom.id); assert.ok(page.kind === 'uiAnimation'); assert.equal(page.ui.customPageId, 'custom_animation_page'); assert.equal(page.ui.instanceId, undefined);
  assert.deepEqual(project, before);
});

test('invalid animation targets reject missing, mismatched, duplicate and deleted scope identities', () => {
  const { project, base, sameName, scoped, custom } = aiAnimationTargetsFixture(), track = base.tracks[0], key = track.keys[0];
  const target = { kind: 'uiAnimation' as const, animationId: base.id, trackId: track.id, keyId: key.id };
  for (const bad of [{ ...target, animationId: 'missing' }, { ...target, trackId: undefined }, { ...target, trackId: sameName.tracks[0].id }, { ...target, keyId: sameName.tracks[0].keys[0].id }]) assert.throws(() => resolveAiEditorTarget(project, bad));
  track.keys.push(structuredClone(key)); assert.throws(() => resolveAiEditorTarget(project, target), /唯一/); track.keys.pop();
  project.ui.instances = []; assert.throws(() => resolveAiEditorTarget(project, { kind: 'uiAnimation', animationId: scoped.id }), /方案/);
  project.ui.customPages = []; assert.throws(() => resolveAiEditorTarget(project, { kind: 'uiAnimation', animationId: custom.id }), /自定义/);
  base.pageId = 'ui:missing'; assert.throws(() => resolveAiEditorTarget(project, target), /页面/);
});

test('animation navigation waits for actual editor acknowledgement and ignores late completion', async () => {
  let request: UiAnimationFocus | undefined;
  const pending = requestUiAnimationFocus({ animationId: 'animation', label: '动画' }, value => { request = value; });
  assert.equal(request!.active(), true); request!.finish({ status: 'completed', message: 'selected' }); assert.equal((await pending).status, 'completed'); assert.equal(request!.active(), false);
  request!.finish({ status: 'failed', message: 'late' }); assert.equal((await pending).status, 'completed');
  const timed = await requestUiAnimationFocus({ animationId: 'animation', label: '动画' }, value => { request = value; }, 1);
  assert.equal(timed.status, 'failed'); assert.equal(request!.active(), false); request!.finish({ status: 'completed', message: 'late' }); assert.equal(timed.status, 'failed');
});
