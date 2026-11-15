import test from 'node:test';
import assert from 'node:assert/strict';
import { storyReturnWirePath } from '../src/renderer/story-wire-path';
import { bezierIntersectsRect, parseBezierSegments } from '../src/renderer/blueprint-selection';

test('return wires go above both endpoint cards and every cubic remains selectable', () => {
  const source = { x: 500, y: 200, width: 242, height: 180 }, target = { x: 50, y: 150, width: 280, height: 220 };
  const [path, x, y] = storyReturnWirePath(742, 320, 50, 260, source, target, 1);
  const segments = parseBezierSegments(path);
  assert.equal(segments.length, 7);
  assert.deepEqual(segments[0][0], { x: 742, y: 320 }); assert.deepEqual(segments.at(-1)![3], { x: 50, y: 260 });
  assert.ok(y < source.y && y < target.y);
  assert.ok(segments.some(curve => bezierIntersectsRect(curve, { x: x - 3, y: y - 3, width: 6, height: 6 })));
  for (const curve of segments) {
    assert.equal(bezierIntersectsRect(curve, { x: source.x + 4, y: source.y + 4, width: source.width - 8, height: source.height - 8 }), false);
    assert.equal(bezierIntersectsRect(curve, { x: target.x + 4, y: target.y + 4, width: target.width - 8, height: target.height - 8 }), false);
  }
});

test('self loops remain visible and standard single-cubic wires keep their selection geometry', () => {
  const card = { x: 100, y: 100, width: 242, height: 140 };
  const [path] = storyReturnWirePath(342, 210, 100, 170, card, card);
  assert.equal(parseBezierSegments(path).length, 7);
  assert.equal(parseBezierSegments('M1,2 C3,4 5,6 7,8').length, 1);
  assert.deepEqual(parseBezierSegments('M1,2 Cx,4 5,6 7,8'), []);
});
