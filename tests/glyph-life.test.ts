import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisualObject, retimeVisualObject } from '../src/core/visual-object';
import { visualGlyphParticles } from '../src/core/visual-glyph-particles';
import { chapterSource } from '../src/core/chapter';
import { visualObjectSchema } from '../src/core/model';

test('glyph curves preserve seeded sizes and untouched axes while replacing chosen motion', () => {
  const object = createVisualObject('particles'); object.duration = 10;
  object.glyphParticles = { assetId: 'glyph', count: 20, seed: 17, emissionStart: 0, timeScale: 1, sizeScale: 1, motionScale: 1, rect: { x: 0, y: 0, width: 1, height: 1 } };
  const life = chapterSource.particle.lifetime / chapterSource.timing.simulationSpeed;
  const sample = (o: typeof object, time: number) => visualGlyphParticles(o, time, [[.3, .4]], 100, 100, 100, 100);
  const prior = sample(object, life / 2);
  object.glyphParticles.lifeCurves = {
    size: [{ at: 0, value: .5, easing: 'linear' }], opacity: [{ at: 0, value: .4, easing: 'linear' }],
    forceX: [{ at: 0, value: .2, easing: 'linear' }], red: [{ at: 0, value: 200, easing: 'linear' }],
  };
  const restored = visualObjectSchema.parse(JSON.parse(JSON.stringify(object))), changed = sample(restored, life / 2);
  assert.ok(Math.abs(changed[0].x - (.3 + .025 * life * life)) < 1e-10);
  changed.forEach((p, i) => { assert.equal(p.y, prior[i].y); assert.equal(p.size, prior[i].size * .5); assert.equal(p.color, '#c8ffff'); });
  assert.equal(changed[0].opacity, .4);
  assert.equal(sample(restored, -.1)[0].opacity, 0);
  assert.equal(sample(restored, life + .1)[0].opacity, 0);
  for (const ratio of [.5, 2, 3]) {
    const scaled = sample(retimeVisualObject(restored, restored.duration * ratio), life / 2 * ratio);
    scaled.forEach((p, i) => { for (const key of ['x', 'y', 'size', 'opacity'] as const) assert.ok(Math.abs(p[key] - changed[i][key]) < 1e-9); assert.equal(p.color, changed[i].color); });
  }
});
