import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { defaultPortraitFraming, portraitPlacement, visibleImageBounds } from '../src/core/portrait';
import { androidIconLayout } from '../src/core/icon-layout';
import { chapterFrame, chapterGlyphPoints, chapterParticle, chapterParticleCount, chapterParticleFrame, chapterCurveDisplacement, chapterTitleOpacity } from '../src/core/chapter';

test('transparent padding and image resolution do not change the visible portrait composition', () => {
  const p = createProject(); p.width = 1920; p.height = 1080;
  p.assets = [{ id: 'a', name: 'A', kind: 'image', path: 'a.png', width: 1000, height: 2000, visibleBounds: { x: 200, y: 100, width: 400, height: 1600 } }, { id: 'b', name: 'B', kind: 'image', path: 'b.png', width: 2400, height: 4400, visibleBounds: { x: 600, y: 400, width: 800, height: 3200 } }];
  p.characters = [{ id: 'actor', name: 'Actor', color: '#ffffff', expressions: [{ id: 'a', name: 'A', assetId: 'a' }, { id: 'b', name: 'B', assetId: 'b' }] }];
  const bounds = p.assets.map(a => {
    const v = portraitPlacement(p, 'actor', a.id), b = a.visibleBounds!;
    return [v.x * p.width + (b.x + b.width / 2 - a.width! / 2) * v.scale, v.y * p.height + (b.y - a.height!) * v.scale, b.height * v.scale];
  });
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(bounds[0][i] - bounds[1][i]) < .00001);
  assert.ok(Math.abs(bounds[0][0] - p.width / 2) < .00001);
  assert.ok(Math.abs(bounds[0][1] - defaultPortraitFraming.top * p.height) < .00001);
  p.characters[0].portraitFraming = { x: .3, top: .06, visibleFraction: 1 };
  const full = portraitPlacement(p, 'actor', 'a'), b = p.assets[0].visibleBounds!;
  assert.ok(Math.abs(full.y * p.height + (b.y + b.height - p.assets[0].height!) * full.scale - p.height) < .00001);
});

test('alpha bounds ignore fully transparent padding and tolerate an empty image', () => {
  const pixels = new Uint8Array(8 * 10 * 4);
  pixels[(3 * 8 + 2) * 4 + 3] = 255; pixels[(7 * 8 + 5) * 4 + 3] = 255;
  assert.deepEqual(visibleImageBounds(pixels, 8, 10), { x: 2, y: 3, width: 4, height: 5 });
  assert.equal(visibleImageBounds(new Uint8Array(4), 1, 1), undefined);
  assert.equal(chapterGlyphPoints(pixels, 8, 10).length, 2);
});

test('the complete square icon stays within the adaptive safe circle at every allowed scale', () => {
  for (const scale of [.25, .5, .75, 1]) {
    const g = androidIconLayout(scale);
    assert.ok(Math.SQRT2 * (g.canvas / 2 - g.inset) <= g.safeDiameter / 2);
    assert.ok(g.safeDiameter < g.mask);
  }
});

test('source chapter timing uses OutQuad, then emits particles with accelerating left/down forces', () => {
  assert.equal(chapterFrame(0, 'ink').surface, 0);
  assert.equal(chapterFrame(.5, 'ink').surface, 1);
  assert.equal(chapterFrame(1, 'ink').surface, 0);
  assert.equal(chapterFrame(0, 'ink').shift, -1);
  assert.equal(chapterFrame(.32, 'ink').shift, 0);
  assert.equal(chapterFrame(.8, 'ink').erase, 1);
  assert.equal(chapterFrame(1 / 7, 'ink').surface, .75);
  assert.equal(chapterFrame(2.5 / 7, 'ink').strength, 1);
  assert.equal(chapterFrame(3.5 / 7, 'ink').strength, -.5);
  const particles = Array.from({ length: chapterParticleCount }, (_, i) => chapterParticle(i));
  assert.equal(particles.length, 200);
  assert.ok(particles.every(p => p.life === 5 && p.size >= .1 && p.size <= .301));
  assert.deepEqual(particles, Array.from({ length: chapterParticleCount }, (_, i) => chapterParticle(i)));
  const sizes = particles.map(p => p.size);
  assert.ok(Math.min(...sizes) < .12 && Math.max(...sizes) > .28, 'sizes cover the source range');
  assert.ok(Math.abs(sizes.reduce((sum, size) => sum + size, 0) / sizes.length - .2) < .02, 'sizes are not biased toward large particles');
  for (let bin = 0; bin < 4; bin++) {
    const count = sizes.filter(size => size >= .1 + bin * .05 && size < .15 + bin * .05).length;
    assert.ok(count >= 25 && count <= 75, `size quartile ${bin}: ${count}`);
  }
  for (const p of particles) {
    assert.equal(chapterParticleFrame(p, (p.delay - .01) / 7).alpha, 0);
    const first = chapterParticleFrame(p, (p.delay + .5) / 7), later = chapterParticleFrame(p, (p.delay + 1) / 7);
    assert.ok(first.dx < 0 && later.dy > 0);
    assert.ok(later.dx < first.dx * 2 && later.dy > first.dy * 2);
  }
});

test('force curves integrate physical acceleration and the recovered title shader dissolves without a horizontal wipe', () => {
  const constant = [{ time: 0, value: 1, inSlope: 0, outSlope: 0 }, { time: 1, value: 1, inSlope: 0, outSlope: 0 }];
  assert.ok(Math.abs(chapterCurveDisplacement(constant, 2) - 2) < 1e-9);
  for (const u of [0, .25, .5, .75, 1]) for (const v of [0, .5, 1]) {
    assert.equal(chapterTitleOpacity(u, v, 1), 1);
    assert.equal(chapterTitleOpacity(u, v, -1), 0);
    assert.ok(chapterTitleOpacity(u, v, 0) > 0 && chapterTitleOpacity(u, v, 0) < 1);
  }
});
