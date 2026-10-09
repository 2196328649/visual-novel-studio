import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisualObject, particleForceOffset, retimeVisualObject, visualParticles } from '../src/core/visual-object';
import { visualObjectSchema } from '../src/core/model';

test('particle acceleration integrates constant, linear and discontinuous forces from birth', () => {
  for (const age of [0, .1, .3, .5, .9, 1]) {
    assert.ok(Math.abs(particleForceOffset([{ at: 0, value: 2, easing: 'linear' }], age) - age * age) < 1e-12);
    assert.ok(Math.abs(particleForceOffset([{ at: 0, value: 0, easing: 'linear' }, { at: 1, value: 1, easing: 'linear' }], age) - age ** 3 / 6) < 1e-12);
    assert.ok(Math.abs(particleForceOffset([{ at: 0, value: 0, easing: 'linear' }, { at: .5, value: 0, easing: 'linear' }, { at: .5, value: 2, easing: 'linear' }], age) - Math.max(0, age - .5) ** 2) < 1e-12);
  }
});

test('particle life curves persist and retime without changing relative-time samples', () => {
  const object = createVisualObject('particles');
  object.particles!.lifeCurves = {
    size: [{ at: 0, value: 2, easing: 'linear' }, { at: .4, value: 12, easing: 'easeout' }, { at: 1, value: 0, easing: 'easein' }],
    opacity: [{ at: 0, value: .8, easing: 'linear' }, { at: 1, value: .2, easing: 'outquad' }],
    forceX: [{ at: 0, value: .4, easing: 'linear' }, { at: .3, value: -.2, easing: 'ease' }, { at: 1, value: .1, easing: 'outquad' }],
    forceY: [{ at: 0, value: -.1, easing: 'linear' }, { at: 1, value: .2, easing: 'easein' }],
    speed: [{ at: 0, value: .1, easing: 'linear' }, { at: .5, value: .4, easing: 'easeout' }, { at: 1, value: -.1, easing: 'linear' }],
    red: [{ at: 0, value: 255, easing: 'linear' }, { at: 1, value: 20, easing: 'ease' }],
    green: [{ at: 0, value: 10, easing: 'linear' }, { at: 1, value: 200, easing: 'outquad' }],
  };
  const restored = visualObjectSchema.parse(JSON.parse(JSON.stringify(object)));
  for (const ratio of [.5, 2, 3]) for (const time of [0, .2, 1.3, 4.2]) {
    const a = visualParticles(restored, time), b = visualParticles(retimeVisualObject(restored, restored.duration * ratio), time * ratio);
    for (let i = 0; i < a.length; i++) for (const key of ['x', 'y', 'size', 'opacity'] as const) assert.ok(Math.abs(a[i][key] - b[i][key]) < 1e-9, `${ratio}/${time}/${i}/${key}`);
    assert.deepEqual(a.map(p => p.color), b.map(p => p.color));
  }
  assert.deepEqual(visualParticles(restored, 2), visualParticles(object, 2));
  assert.equal(visualObjectSchema.safeParse({ ...object, particles: { ...object.particles, lifeCurves: { size: [{ at: 2, value: 1, easing: 'linear' }] } } }).success, false);
});

test('constant speed curve matches base motion and color channels round and clamp independently', () => {
  const object = createVisualObject('particles'); object.color = '#123456';
  const prior = visualParticles(object, .7);
  object.particles!.lifeCurves = { speed: [{ at: 0, value: object.particles!.speed, easing: 'linear' }], red: [{ at: 0, value: 127.5, easing: 'linear' }], blue: [{ at: 0, value: 300, easing: 'linear' }] };
  const changed = visualParticles(object, .7);
  for (let i = 0; i < prior.length; i++) {
    assert.ok(Math.abs(changed[i].x - prior[i].x) < 1e-12); assert.ok(Math.abs(changed[i].y - prior[i].y) < 1e-12);
    assert.equal(changed[i].color, '#8034ff'); assert.equal(prior[i].color, '#123456');
  }
});
