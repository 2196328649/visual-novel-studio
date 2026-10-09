import test from 'node:test';
import assert from 'node:assert/strict';
import { aiSelectedUiAnimation, uiAnimationSelectionSchema } from '../src/core/ai-selection';
import { aiRequestMessages } from '../src/core/ai';
import { aiAnimationSelectionFixture } from '../scripts/lib/ai-animation-selection-fixture';

test('animation selection follows exact clip, track and key identities through reordering', () => {
  const { project, clips } = aiAnimationSelectionFixture(), clip = clips[1], track = clip.tracks[1], key = track.keys[1];
  const selected = { animationId: clip.id, trackId: track.id, keyId: key.id };
  const resolve = () => aiSelectedUiAnimation(project, selected)!;
  assert.equal(resolve().property, 'opacity'); assert.equal(resolve().key, key); assert.equal(resolve().selectionUnavailable, false);
  project.ui.animations!.reverse(); clip.tracks.reverse(); track.keys.reverse(); assert.equal(resolve().key, key);
  key.value = .4; assert.equal(resolve().key!.value, .4);
  const whole = aiSelectedUiAnimation(project, { animationId: clip.id })!;
  assert.equal(whole.trackId, undefined); assert.equal(whole.key, undefined); assert.equal(whole.selectionUnavailable, false);
});

test('stale or ambiguous animation selections never select a namesake or another key', () => {
  const { project, clips } = aiAnimationSelectionFixture(), clip = clips[0], track = clip.tracks[0], key = track.keys[1];
  const selected = { animationId: clip.id, trackId: track.id, keyId: key.id };
  track.keys.pop(); assert.equal(aiSelectedUiAnimation(project, selected)!.key, undefined); assert.equal(aiSelectedUiAnimation(project, selected)!.selectionUnavailable, true);
  track.keys.push(key, structuredClone(key)); assert.equal(aiSelectedUiAnimation(project, selected)!.key, undefined);
  project.ui.animations = [clips[1]]; assert.equal(aiSelectedUiAnimation(project, selected)!.name, undefined);
  assert.equal(aiSelectedUiAnimation(project), undefined);
  assert.equal(uiAnimationSelectionSchema.safeParse({ animationId: clip.id, keyId: key.id }).success, false);
});

test('animation IDs, scope and selected key survive both full and truncated AI contexts', () => {
  const { project, clips } = aiAnimationSelectionFixture(), clip = clips[0], track = clip.tracks[0], key = track.keys[1];
  const selectedUiAnimation = { animationId: clip.id, trackId: track.id, keyId: key.id };
  const context = () => { const message = aiRequestMessages({ id: 'animation', project, prompt: '修改当前关键帧', lineIds: [], selectedUiAnimation }).at(-1)!.content; return JSON.parse(message.slice(message.indexOf('\n{') + 1)); };
  const before = context().selectedUiAnimation;
  assert.deepEqual(before, { ...selectedUiAnimation, name: clip.name, pageId: 'ui:main', uiInstanceId: 'base', duration: 2, componentId: 'animated_text', property: 'x', key, selectionUnavailable: false });
  project.assets = Array.from({ length: 3000 }, (_, i) => ({ id: 'asset_' + i, name: '很长的素材名称'.repeat(80), kind: 'image', path: i + '.png' }));
  assert.equal(context().partial, true); assert.deepEqual(context().selectedUiAnimation, before);
});
