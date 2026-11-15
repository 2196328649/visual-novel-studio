import test from 'node:test';
import assert from 'node:assert/strict';
import type { UiComponent } from '../src/core/model';
import { resolveUiHierarchy } from '../src/core/ui-hierarchy';
import { uiCanvasClickSelection, uiCanvasHitIds, uiCanvasIsBackdrop, uiCanvasMoveTarget } from '../src/core/ui-canvas-selection';

const viewport = { width: 1000, height: 500 };
const component = (id: string, patch: Partial<UiComponent> = {}): UiComponent => ({ id, kind: 'button', page: 'main', text: id, x: .2, y: .2, width: .2, height: .2, ...patch });
const rows = (components: UiComponent[]) => resolveUiHierarchy(components, { viewport, design: true });

test('canvas picking uses rendered stacking, inherited visibility/locks and root bounds', () => {
  const source = rows([
    component('under'), component('over'), component('disabled', { disabled: true }),
    component('hidden', { editor: { hidden: true } }), component('hiddenChild', { parentId: 'hidden', x: 0, y: 0, width: 1, height: 1 }),
    component('locked', { editor: { locked: true } }), component('lockedChild', { parentId: 'locked', x: 0, y: 0, width: 1, height: 1 }),
    component('outside', { x: -.2 }),
  ]);
  assert.deepEqual(uiCanvasHitIds(source, { x: 250, y: 150 }, viewport), ['disabled', 'over', 'under']);
  assert.deepEqual(uiCanvasHitIds(source, { x: 250, y: 150 }, viewport, true), ['lockedChild', 'locked', 'disabled', 'over', 'under']);
  for (const point of [{ x: -1, y: 150 }, { x: 1000, y: 150 }, { x: 200, y: 500 }, { x: NaN, y: 150 }]) assert.deepEqual(uiCanvasHitIds(source, point, viewport), []);
});

test('hit frames match rounded preview sizes and use transformed, clipped geometry', () => {
  const source = rows([
    component('rounded', { x: .10049, y: .20098, width: .19951, height: .19902 }),
    component('frame', { kind: 'panel', x: .5, y: .2, width: .2, height: .4, layout: { version: 1, clip: true } }),
    component('child', { parentId: 'frame', x: .8, y: .1, width: .5, height: .5 }),
    component('mirror', { x: .4, y: .7, width: .1, height: .1, layout: { version: 1, scaleX: -1 } }),
  ]);
  assert.deepEqual(uiCanvasHitIds(source, { x: 299.8, y: 199.8 }, viewport), ['rounded']);
  assert.deepEqual(uiCanvasHitIds(source, { x: 690, y: 140 }, viewport), ['child', 'frame']);
  assert.deepEqual(uiCanvasHitIds(source, { x: 730, y: 140 }, viewport), []);
  assert.deepEqual(uiCanvasHitIds(source, { x: 350, y: 370 }, viewport), ['mirror']);
});

test('background first deselects, then selects; sibling buttons/images switch directly', () => {
  const source = rows([
    component('background', { kind: 'image', x: 0, y: 0, width: 1, height: 1 }),
    component('smallImage', { kind: 'image', x: .1, y: .1, width: .5, height: .5 }),
    component('selected'), component('neighbor', { x: .7 }),
  ]);
  assert.equal(uiCanvasIsBackdrop(source, 'background', ['selected'], viewport), true);
  assert.deepEqual(uiCanvasClickSelection(source, ['background'], ['selected'], viewport, false), []);
  assert.deepEqual(uiCanvasClickSelection(source, ['background'], [], viewport, true), ['background']);
  assert.deepEqual(uiCanvasClickSelection(source, ['neighbor', 'background'], ['selected'], viewport, false), ['neighbor']);
  assert.deepEqual(uiCanvasClickSelection(source, ['smallImage', 'background'], ['selected'], viewport, false), ['smallImage']);
});

test('a backing ancestor or its background child supports the selected visible subtree', () => {
  const source = rows([
    component('frame', { kind: 'panel', x: .1, y: .1, width: .7, height: .7 }),
    component('back', { kind: 'image', parentId: 'frame', childLayer: 'background', x: 0, y: 0, width: 1, height: 1 }),
    component('child', { parentId: 'frame', x: .2, y: .2, width: .2, height: .2 }),
    component('outside', { x: .9, y: .9, width: .1, height: .1 }),
  ]);
  assert.equal(uiCanvasIsBackdrop(source, 'frame', ['child'], viewport), true);
  assert.equal(uiCanvasIsBackdrop(source, 'back', ['child'], viewport), true);
  assert.equal(uiCanvasIsBackdrop(source, 'frame', ['child', 'outside'], viewport), false);
  assert.equal(uiCanvasIsBackdrop(source, 'back', ['frame'], viewport), true);
});

test('backdrop support uses the visible portion for cropped/off-page objects without loosening marquee containment', () => {
  const source = rows([
    component('background', { kind: 'panel', x: 0, y: 0, width: 1, height: 1 }),
    component('offpage', { x: -.1, y: .2, width: .2, height: .2 }),
    component('frame', { kind: 'panel', x: .5, y: .2, width: .2, height: .3, layout: { version: 1, clip: true } }),
    component('child', { parentId: 'frame', x: .8, y: .1, width: .5, height: .5 }),
  ]);
  assert.equal(uiCanvasIsBackdrop(source, 'background', ['offpage'], viewport), true);
  assert.equal(uiCanvasIsBackdrop(source, 'frame', ['child'], viewport), true);
});

test('ordinary repeated clicks cycle all coincident controls and wrap to the top', () => {
  const source = rows([component('under'), component('middle'), component('over')]), hits = uiCanvasHitIds(source, { x: 250, y: 150 }, viewport);
  assert.deepEqual(uiCanvasClickSelection(source, hits, [], viewport, false), ['over']);
  assert.deepEqual(uiCanvasClickSelection(source, hits, ['over'], viewport, true), ['middle']);
  assert.deepEqual(uiCanvasClickSelection(source, hits, ['middle'], viewport, true), ['under']);
  assert.deepEqual(uiCanvasClickSelection(source, hits, ['under'], viewport, true), ['over']);
  assert.deepEqual(uiCanvasClickSelection(source, hits, ['under'], viewport, false), ['over']);
  assert.deepEqual(uiCanvasClickSelection(source, hits, ['middle', 'under'], viewport, true), ['over']);
});

test('a picked lower peer stays draggable, while a selected ancestor does not swallow its unselected child', () => {
  const source = rows([component('under'), component('over')]), hits = ['over', 'under'];
  assert.equal(uiCanvasMoveTarget(source, hits, ['under'], viewport), 'under');
  assert.equal(uiCanvasMoveTarget(source, hits, ['over'], viewport), 'over');
  assert.equal(uiCanvasMoveTarget(source, hits, [], viewport), undefined);
  const hierarchy = rows([
    component('background', { kind: 'panel', x: 0, y: 0, width: 1, height: 1 }),
    component('parent', { kind: 'panel', x: .1, y: .1, width: .8, height: .8 }),
    component('child', { parentId: 'parent', x: .2, y: .2, width: .2, height: .2 }),
  ]);
  assert.equal(uiCanvasMoveTarget(hierarchy, ['child', 'parent', 'background'], ['parent'], viewport), undefined);
  assert.equal(uiCanvasMoveTarget(hierarchy, ['child', 'parent', 'background'], ['background'], viewport), undefined);
  assert.equal(uiCanvasMoveTarget(hierarchy, ['child', 'parent', 'background'], ['parent', 'child'], viewport), 'child');
});
