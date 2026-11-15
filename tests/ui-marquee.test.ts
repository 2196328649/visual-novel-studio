import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type UiComponent } from '../src/core/model';
import { resolveUiHierarchy } from '../src/core/ui-hierarchy';
import { uiMarqueeCandidates, uiMarqueeHits, uiMarqueeRect, uiMarqueeSelection } from '../src/core/ui-marquee';
import { uiPropertyControlDesignSnapshot } from '../src/core/ui-property-control-snapshot';
import { planUiArrangement, uiSelectionRoots } from '../src/core/ui-arrange';

const viewport = { width: 1000, height: 500 };
const component = (id: string, patch: Partial<UiComponent> = {}): UiComponent => ({ id, kind: 'panel', page: 'main', text: '', x: .1, y: .2, width: .2, height: .2, ...patch });
const candidates = (components: UiComponent[]) => uiMarqueeCandidates(resolveUiHierarchy(components, { viewport, design: true }), viewport);

test('only complete frames are selected, including equality at the boundary', () => {
  const items = candidates([component('inside'), component('crossing', { x: .29 }), component('beside', { x: .31 })]);
  assert.deepEqual(uiMarqueeHits(items, { x: 100, y: 100, width: 200, height: 100 }), ['inside']);
  for (const area of [
    { x: 101, y: 100, width: 200, height: 100 }, { x: 100, y: 101, width: 200, height: 100 },
    { x: 100, y: 100, width: 199, height: 100 }, { x: 100, y: 100, width: 200, height: 99 },
    { x: 150, y: 125, width: 50, height: 25 },
  ]) assert.deepEqual(uiMarqueeHits(items, area), []);
});

for (const [start, end] of [
  [{ x: 90, y: 90 }, { x: 310, y: 210 }], [{ x: 310, y: 210 }, { x: 90, y: 90 }],
  [{ x: 90, y: 210 }, { x: 310, y: 90 }], [{ x: 310, y: 90 }, { x: 90, y: 210 }],
]) test(`full containment works dragging from ${start.x},${start.y} to ${end.x},${end.y}`, () => {
  assert.deepEqual(uiMarqueeHits(candidates([component('a')]), uiMarqueeRect(start, end)), ['a']);
});

test('point, line and nonfinite selection areas do not select frames', () => {
  const items = candidates([component('a')]);
  for (const area of [{ x: 100, y: 100, width: 0, height: 100 }, { x: 100, y: 100, width: 200, height: 0 }, { x: 0, y: 0, width: Infinity, height: 500 }]) {
    assert.deepEqual(uiMarqueeHits(items, area), []);
  }
});

test('selection uses the rounded rendered frame rather than fractional authored geometry', () => {
  const items = candidates([component('fraction', { x: .10049, y: .20098, width: .19951, height: .19902 })]);
  assert.deepEqual(items, [{ id: 'fraction', bounds: { x: 100, y: 100, width: 200, height: 100 } }]);
  assert.deepEqual(uiMarqueeHits(items, { x: 100, y: 100, width: 200, height: 100 }), ['fraction']);
  assert.deepEqual(uiMarqueeHits(items, { x: 100.01, y: 100, width: 200, height: 100 }), []);
});

test('rotated and mirrored frames must fit all four corners, not just their centers', () => {
  const items = candidates([component('rotated', { x: .5, y: .4, width: .1, height: .1, layout: { version: 1, rotation: 45 } }),
    component('mirrored', { x: .4, y: .6, width: .1, height: .1, layout: { version: 1, scaleX: -1 } })]);
  const rotated = items.find(item => item.id === 'rotated')!.bounds;
  assert.ok(Math.abs(rotated.x - (500 - 50 / Math.SQRT2)) < 1e-7);
  assert.ok(Math.abs(rotated.width - 150 / Math.SQRT2) < 1e-7);
  assert.deepEqual(uiMarqueeHits(items, rotated), ['rotated']);
  assert.deepEqual(uiMarqueeHits(items, { ...rotated, width: rotated.width - 1 }), []);
  assert.deepEqual(uiMarqueeHits(items, { x: 300, y: 300, width: 100, height: 50 }), ['mirrored']);
});

test('hidden and locked ancestors protect descendants; disabled controls remain design-selectable', () => {
  const items = candidates([
    component('locked', { editor: { locked: true } }), component('lockedChild', { parentId: 'locked' }),
    component('hidden', { editor: { hidden: true } }), component('hiddenChild', { parentId: 'hidden' }),
    component('disabled', { disabled: true }), component('normal', { x: .5 }),
  ]);
  assert.deepEqual(new Set(uiMarqueeHits(items, { x: 0, y: 0, ...viewport })), new Set(['disabled', 'normal']));
});

test('a visible clipped fragment never substitutes for the complete child frame', () => {
  const items = candidates([
    component('parent', { x: .1, y: .2, width: .2, height: .4, layout: { version: 1, clip: true } }),
    component('partial', { parentId: 'parent', x: .75, y: .25, width: .5, height: .5 }),
    component('clippedOut', { parentId: 'parent', x: 1.1, y: .25, width: .5, height: .5 }),
  ]);
  assert.deepEqual(items.map(item => item.id), ['parent', 'partial']);
  assert.deepEqual(uiMarqueeHits(items, { x: 245, y: 140, width: 60, height: 120 }), []);
  assert.deepEqual(uiMarqueeHits(items, { x: 245, y: 140, width: 110, height: 120 }), ['partial']);
});

test('canvas clipping excludes fully off-page objects, including a rotated frame with an intersecting AABB', () => {
  const items = candidates([
    component('outside', { x: 1.1 }), component('partial', { x: -.05, y: .1, width: .1, height: .1 }),
    component('cornerOutside', { x: -.04, y: -.18, width: .05, height: .1, layout: { version: 1, rotation: 45, scaleX: Math.SQRT2, scaleY: Math.SQRT2 } }),
  ]);
  // The last diamond has x/y bounds -90..10, but no point lies on the canvas.
  assert.deepEqual(items.map(item => item.id), ['partial']);
  assert.deepEqual(uiMarqueeHits(items, { x: 0, y: 0, ...viewport }), []);
  assert.deepEqual(uiMarqueeHits(items, { x: -51, y: 49, width: 102, height: 52 }), ['partial']);
});

test('parent and child can both be selected but batch movement changes their world frames only once', () => {
  const source = [component('parent', { width: .6, height: .6, layout: { version: 1, rotation: 12 } }), component('child', { parentId: 'parent', x: .1, y: .1, width: .2, height: .2 })];
  const original = structuredClone(source), items = candidates(source);
  const ids = uiMarqueeHits(items, items.find(item => item.id === 'parent')!.bounds);
  assert.deepEqual(ids, ['parent', 'child']); assert.deepEqual(uiSelectionRoots(source, ids), ['parent']);
  const plan = planUiArrangement(source, ids, viewport, { kind: 'move', delta: { x: 20, y: 10 } });
  assert.equal(plan.problem, undefined); assert.deepEqual(plan.changes.map(change => change.id), ['parent']);
  assert.deepEqual(source, original);
});

test('marquee reads parameter-initial geometry and visibility without overwriting authored defaults', () => {
  const project = createProject('框选参数初值'); Object.assign(project, viewport);
  project.variables.push({ id: 'x', name: '位置', type: 'number', initial: .6, persistent: false }, { id: 'hide', name: '显示', type: 'boolean', initial: false, persistent: false });
  project.ui.components = [component('moved', { propertyControls: { x: { mode: 'follow', parameterId: 'x' } } }),
    component('hidden', { propertyControls: { visible: { mode: 'sync', parameterId: 'hide' } } })];
  const before = structuredClone(project), snapshots = project.ui.components.map(item => uiPropertyControlDesignSnapshot(project, item));
  const rows = resolveUiHierarchy(snapshots.map(item => item.component), { viewport, design: true, visible: item => snapshots.find(snapshot => snapshot.component.id === item.id)?.values.visible !== false });
  const items = uiMarqueeCandidates(rows, viewport);
  assert.deepEqual(uiMarqueeHits(items, { x: 600, y: 100, width: 200, height: 100 }), ['moved']);
  assert.deepEqual(uiMarqueeHits(items, { x: 100, y: 100, width: 200, height: 100 }), []);
  assert.deepEqual(items.map(item => item.id), ['moved']); assert.deepEqual(project, before);
});

test('replace, add and toggle preserve deterministic paint order and a fixed starting selection', () => {
  const base = ['a', 'outside'], before = [...base];
  assert.deepEqual(uiMarqueeSelection(base, ['a', 'b'], 'replace'), ['a', 'b']);
  assert.deepEqual(uiMarqueeSelection(base, ['a', 'b'], 'add'), ['a', 'outside', 'b']);
  assert.deepEqual(uiMarqueeSelection(base, ['a', 'b'], 'toggle'), ['outside', 'b']);
  assert.deepEqual(uiMarqueeSelection(base, ['a'], 'toggle'), ['outside']);
  assert.deepEqual(uiMarqueeSelection(base, ['a', 'b'], 'toggle'), ['outside', 'b']);
  assert.deepEqual(uiMarqueeSelection(base, [], 'toggle'), base);
  assert.deepEqual(base, before);
});
