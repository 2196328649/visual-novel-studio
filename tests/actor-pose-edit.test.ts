import test from 'node:test';
import assert from 'node:assert/strict';
import { actorAnimationDuration, sampleActorAnimation, setActorAnimationPoseAt, type ActorAnimation } from '../src/core/actor-animation';
import { actionSchema } from '../src/core/model';

const initial = { x: 0, y: 1, scale: 1, rotation: 0, opacity: 1 };
const animation = (): ActorAnimation => ({ kind: 'animate', characterId: 'actor', wait: false, repeat: false, keyframes: [{ ...initial, x: 1, y: .5, duration: 2, easing: 'linear' }] });

test('pose edit at playhead changes only requested property and preserves endpoints', () => {
  const action = animation(), before = structuredClone(action);
  setActorAnimationPoseAt(action, .5, initial, { x: .7 });
  assert.equal(sampleActorAnimation(action, .5, initial).x, .7);
  assert.equal(sampleActorAnimation(action, 0, initial).x, 0);
  assert.equal(sampleActorAnimation(action, 2, initial).x, 1);
  for (const at of [0, .25, .5, 1, 2]) assert.equal(sampleActorAnimation(action, at, initial).y, sampleActorAnimation(before, at, initial).y);
  assert.deepEqual(action.keyframes, before.keyframes);
  assert.ok(actionSchema.safeParse(action).success);
  setActorAnimationPoseAt(action, .5, initial, { x: .6 });
  assert.equal(action.curves!.x!.length, 3);
  assert.equal(sampleActorAnimation(action, .5, initial).x, .6);
});

test('existing curves retain values and easing outside the edited key, with loop-relative time', () => {
  const action = animation(); action.repeat = true;
  action.curves = { x: [{ at: 0, value: .2, easing: 'linear' }, { at: 2, value: .9, easing: 'outquad' }] };
  setActorAnimationPoseAt(action, 2.75, initial, { x: .4 });
  assert.equal(sampleActorAnimation(action, 2.75, initial).x, .4);
  assert.deepEqual(action.curves.x!.map(frame => frame.at), [0, .75, 2]);
  assert.equal(action.curves.x![2].value, .9);
  assert.equal(action.curves.x![2].easing, 'outquad');
});

test('editing beyond the end extends motion without replacing the earlier endpoint or hold', () => {
  const action = animation();
  action.curves = { x: [{ at: 0, value: 0, easing: 'linear' }, { at: 1, value: .8, easing: 'linear' }] };
  const prior = structuredClone(action);
  setActorAnimationPoseAt(action, 3, initial, { x: .3 });
  assert.equal(actorAnimationDuration(action), 3);
  assert.deepEqual(action.curves.x!.map(frame => frame.at), [0, 1, 2, 3]);
  for (const at of [0, .5, 1, 1.5, 2]) assert.deepEqual(sampleActorAnimation(action, at, initial), sampleActorAnimation(prior, at, initial));
  assert.equal(sampleActorAnimation(action, 3, initial).x, .3);
  assert.deepEqual(action.keyframes, prior.keyframes);
});
