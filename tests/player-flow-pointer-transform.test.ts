import test from 'node:test';
import assert from 'node:assert/strict';
import type { UiComponent } from '../src/core/model';
import { resolveUiHierarchy } from '../src/core/ui-hierarchy';
import { uiIdentity, uiTransformPoint, uiTransformVector, type UiLayoutGeometry, type UiPoint } from '../src/core/ui-layout';
import { uiScreenToLocalDelta, uiScreenToLocalPoint } from '../src/core/ui-transform';

// Source only during implementation; run with the unified validation phase.
const viewport = { width: 1920, height: 1080 };
const component = (id: string, patch: Partial<UiComponent> = {}): UiComponent => ({
  id, page: 'flowchart', kind: 'flowchart', text: '', x: .15, y: .1, width: .7, height: .7,
  list: { layout: 'flow' }, ...patch,
});
const geometry = (components: UiComponent[], id = 'map'): UiLayoutGeometry => resolveUiHierarchy(components, { viewport, design: true }).find(row => row.component.id === id)!.geometry!;
const near = (actual: UiPoint | undefined, expected: UiPoint) => {
  assert.ok(actual);
  assert.ok(Math.abs(actual.x - expected.x) < 1e-8, `${actual.x} != ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-8, `${actual.y} != ${expected.y}`);
};

test('flow pointer deltas account for own scale, rotation and mirroring', () => {
  const cases: { name: string; layout: UiComponent['layout']; expected: UiPoint }[] = [
    { name: 'scale', layout: { version: 1, scaleX: 2, scaleY: 2 }, expected: { x: 20, y: 0 } },
    { name: 'rotation', layout: { version: 1, rotation: 90 }, expected: { x: 0, y: -40 } },
    { name: 'mirror', layout: { version: 1, scaleX: -1 }, expected: { x: -40, y: 0 } },
  ];
  for (const entry of cases) {
    const frame = geometry([component('map', { layout: entry.layout })]);
    const actual = uiScreenToLocalDelta(frame, { x: 40, y: 0 });
    near(actual, entry.expected);
    near(uiTransformVector(frame.renderMatrix, actual!), { x: 40, y: 0 });
  }
});

test('nested nonuniform transforms use the complete painted frame at non-default zoom', () => {
  const components = [
    component('outer', { kind: 'panel', layout: { version: 1, rotation: 31, scaleX: 1.8, scaleY: .7, pivotX: .4, pivotY: .6, paddingLeft: 17, paddingTop: 23 } }),
    component('inner', { kind: 'panel', parentId: 'outer', layout: { version: 1, rotation: -17, scaleX: -.8, scaleY: 1.4 } }),
    component('map', { parentId: 'inner', layout: { version: 1, rotation: 22, scaleX: .9, scaleY: 1.2, pivotX: .5, pivotY: .5 } }),
  ];
  const before = structuredClone(components), frame = geometry(components);
  // A nonuniformly scaled, rotated ancestor creates shear. Decomposing only the
  // map's own angle/scale or using its bounding box cannot recover this delta.
  assert.ok(Math.abs(frame.renderMatrix[0] * frame.renderMatrix[2] + frame.renderMatrix[1] * frame.renderMatrix[3]) > .01);
  const expected = { x: 37, y: -19 }, screen = uiTransformVector(frame.renderMatrix, expected), scale = .65 * 1.3;
  near(uiScreenToLocalDelta(frame, { x: screen.x * scale, y: screen.y * scale }, scale), expected);
  assert.deepEqual(components, before);
});

test('pivots, anchors and scroll translations do not change internal drag distances', () => {
  const parent = component('parent', { kind: 'panel', width: .4, height: .4, layout: { version: 1, rotation: 90, scaleX: -1.5, scaleY: .75, scroll: 'both', scrollX: 120, scrollY: 80 } });
  const map = component('map', { parentId: parent.id, x: .2, y: .2, width: 3, height: 3, layout: { version: 1, anchorX: .25, anchorY: .5, pivotX: .5, pivotY: .4 } });
  const frame = geometry([parent, map]);
  near(uiScreenToLocalDelta(frame, { x: 30, y: 15 }), { x: -10, y: -40 });
  const [a, b, c, d] = frame.renderMatrix;
  const translated: Pick<UiLayoutGeometry, 'renderMatrix'> = { renderMatrix: [a, b, c, d, 99999, -99999] };
  near(uiScreenToLocalDelta(translated, { x: 30, y: 15 }), { x: -10, y: -40 });
});

test('legacy untransformed previews retain scale conversion and invalid frames reject movement', () => {
  near(uiScreenToLocalDelta(undefined, { x: 32, y: -16 }, .8), { x: 40, y: -20 });
  near(uiScreenToLocalDelta({ renderMatrix: uiIdentity }, { x: 13, y: 17 }), { x: 13, y: 17 });
  const singular = geometry([component('map', { layout: { version: 1, scaleX: 0 } })]);
  assert.equal(uiScreenToLocalDelta(singular, { x: 40, y: 20 }), undefined);
  for (const scale of [0, -1, Infinity, NaN]) assert.equal(uiScreenToLocalDelta(undefined, { x: 1, y: 1 }, scale), undefined);
  assert.equal(uiScreenToLocalDelta(undefined, { x: Infinity, y: 0 }), undefined);
  assert.equal(uiScreenToLocalDelta({ renderMatrix: [1, NaN, 0, 1, 0, 0] }, { x: 1, y: 1 }), undefined);
});

test('absolute pointers invert the painted rectangle under shear, mirroring and editor zoom', () => {
  const rect = { x: 53, y: 29, width: 211, height: 37 }, scale = 1.35;
  const matrices = [
    [1.2, .4, .7, 1.6, 430, -120] as const,
    [-1.4, .2, .5, .8, -80, 700] as const,
    [0, 1.5, -1.5, 0, 250, 150] as const,
  ];
  for (const renderMatrix of matrices) {
    const geometry = { renderMatrix };
    const corners = [
      uiTransformPoint(renderMatrix, { x: rect.x, y: rect.y }),
      uiTransformPoint(renderMatrix, { x: rect.x + rect.width, y: rect.y }),
      uiTransformPoint(renderMatrix, { x: rect.x + rect.width, y: rect.y + rect.height }),
      uiTransformPoint(renderMatrix, { x: rect.x, y: rect.y + rect.height }),
    ];
    const bounds = { x: 92, y: 38 };
    const origin = { x: bounds.x - Math.min(...corners.map(p => p.x)) * scale, y: bounds.y - Math.min(...corners.map(p => p.y)) * scale };
    const expected = { x: rect.x + 117, y: rect.y + 11 };
    const painted = uiTransformPoint(renderMatrix, expected);
    near(uiScreenToLocalPoint(geometry, { x: origin.x + painted.x * scale, y: origin.y + painted.y * scale }, bounds, rect, scale), expected);
  }
  assert.equal(uiScreenToLocalPoint({ renderMatrix: [1, 0, 1, 0, 0, 0] }, { x: 10, y: 20 }, { x: 0, y: 0 }, rect), undefined);
  assert.equal(uiScreenToLocalPoint(undefined, { x: Infinity, y: 0 }, { x: 0, y: 0 }, rect), undefined);
  const expected = { x: rect.x + 7, y: rect.y + 13 }, screen = { x: expected.x * scale, y: expected.y * scale }, bounds = { x: rect.x * scale, y: rect.y * scale };
  near(uiScreenToLocalPoint(undefined, screen, bounds, rect, scale), expected);
  assert.equal(uiScreenToLocalPoint(undefined, { x: 1, y: 1 }, { x: 0, y: 0 }, rect, 0), undefined);
});
