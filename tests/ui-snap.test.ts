import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type UiComponent } from '../src/core/model';
import { planUiArrangement } from '../src/core/ui-arrange';
import { resolveUiLayout } from '../src/core/ui-layout';
import { createUiSnapContext, snapUiMove } from '../src/core/ui-snap';

const viewport = { width: 1000, height: 500 };
const c = (id: string, patch: Partial<UiComponent> = {}): UiComponent => ({ id, kind: 'button', page: 'main', text: id, x: .17, y: .23, width: .12, height: .18, ...patch });
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

for (const axis of ['x', 'y'] as const) for (const factor of [0, .5, 1]) test(`drag snaps to canvas ${axis}/${factor} without changing the other axis`, () => {
  const component = c('moving'), context = createUiSnapContext([component], ['moving'], viewport)!;
  const size = axis === 'x' ? 'width' : 'height', other = axis === 'x' ? 'y' : 'x';
  const wanted = viewport[size] * factor - context.bounds[axis] - context.bounds[size] * factor;
  const result = snapUiMove(context, { x: 23, y: 17, [axis]: wanted + 3 }, { x: 1, y: 1 });
  near(result.delta[axis], wanted); near(result.delta[other], other === 'x' ? 23 : 17);
  assert.equal(result.guides.length, 1); assert.equal(result.guides[0].axis, axis);
  near(result.guides[0].position, viewport[size] * factor); assert.equal(result.guides[0].targetId, undefined);
});

test('snap tolerance stays six screen pixels at different zoom levels', () => {
  const context = createUiSnapContext([c('moving')], ['moving'], viewport)!;
  for (const zoom of [.1, .25, .5, 1, 2, 4]) {
    const units = { x: 1 / zoom, y: 1 / zoom };
    for (const distance of [0, 3, 6]) {
      const result = snapUiMove(context, { x: -170 + distance / zoom, y: 17 }, units);
      near(result.delta.x, -170); assert.ok(result.guides.some(guide => guide.axis === 'x'));
    }
    const raw = { x: -170 + 7 / zoom, y: 17 }, result = snapUiMove(context, raw, units);
    near(result.delta.x, raw.x); assert.equal(result.guides.some(guide => guide.axis === 'x'), false);
  }
});

test('passing a full project as viewport still includes the game canvas snap lines', () => {
  const project = createProject('canvas snap'); Object.assign(project, viewport);
  const context = createUiSnapContext([c('moving')], ['moving'], project)!;
  assert.equal(context.lines.x.length, 3); assert.equal(context.lines.y.length, 3);
  const result = snapUiMove(context, { x: 267, y: 17 }, { x: 1, y: 1 });
  near(result.delta.x, 270); assert.equal(result.guides[0].position, 500); assert.equal(result.guides[0].edge, 'center');
});

test('control edges, adjacent edges and centers provide precise snap targets', () => {
  const components = [c('moving'), c('target', { x: .55, y: .6, width: .21, height: .2 })];
  const context = createUiSnapContext(components, ['moving'], viewport)!;
  for (const [sourceFactor, targetFactor] of [[0, 0], [1, 1], [0, 1], [1, 0], [.5, .5]]) {
    const wanted = 550 + 210 * targetFactor - 170 - 120 * sourceFactor;
    const result = snapUiMove(context, { x: wanted - 2, y: 0 }, { x: 1, y: 1 });
    near(result.delta.x, wanted); assert.equal(result.guides.find(guide => guide.axis === 'x')?.targetId, 'target');
  }
});

test('a multiselection snaps as one bounding box and preserves relative placement', () => {
  const components = [c('a', { x: .1 }), c('b', { x: .35, width: .06 })], original = structuredClone(components);
  const context = createUiSnapContext(components, ['b', 'a'], viewport)!;
  near(context.bounds.x, 100); near(context.bounds.width, 310);
  const result = snapUiMove(context, { x: 248, y: 12 }, { x: 1, y: 1 }); near(result.delta.x, 245);
  const plan = planUiArrangement(components, ['a', 'b'], viewport, { kind: 'move', delta: result.delta });
  assert.equal(plan.problem, undefined); assert.equal(plan.changes.length, 2);
  plan.changes.forEach(change => { const before = components.find(component => component.id === change.id)!; near(change.rect.x - before.x, .245); near(change.rect.y - before.y, 12 / 500); near(change.rect.width, before.width); });
  assert.deepEqual(components, original);
});

test('moving roots and all their descendants are excluded from snap targets', () => {
  const components = [c('parent', { width: .6, height: .6 }), c('child', { parentId: 'parent' }), c('grandchild', { parentId: 'child' })];
  const context = createUiSnapContext(components, ['child', 'parent'], viewport)!;
  near(context.bounds.width, 600);
  assert.equal(context.lines.x.length, 3); assert.equal(context.lines.y.length, 3);
  const raw = { x: 1, y: 2 }, result = snapUiMove(context, raw, { x: 1, y: 1 });
  assert.deepEqual(result, { delta: raw, guides: [] });
  const childContext = createUiSnapContext(components, ['child'], viewport)!;
  assert.equal(childContext.lines.x.some(line => line.targetId === 'parent'), true);
  assert.equal(childContext.lines.x.some(line => line.targetId === 'grandchild'), false);
});

test('locked targets remain useful; hidden, clipped, transparent and unavailable targets do not', () => {
  const components = [c('moving'), c('locked', { editor: { locked: true } }), c('hidden', { editor: { hidden: true } }), c('hidden_child', { parentId: 'hidden' }), c('transparent', { style: { opacity: 0 } }), c('filtered'), c('future', { layout: { version: 9 } }), c('outside', { x: 1.1 }), c('clip_parent', { kind: 'panel', layout: { version: 1, clip: true } }), c('clipped', { parentId: 'clip_parent', x: 2 })];
  const context = createUiSnapContext(components, ['moving'], viewport, component => component.id !== 'filtered')!;
  assert.deepEqual([...new Set(context.lines.x.map(line => line.targetId))].sort(), ['clip_parent', 'locked', undefined].sort());
});

test('affine-parent selections snap in world space without flattening their transforms', () => {
  const components = [c('parent', { kind: 'panel', width: .65, height: .65, layout: { version: 1, rotation: 25, scaleX: -1.2, scaleY: .8, paddingLeft: 8 } }), c('child', { parentId: 'parent', layout: { version: 1, rotation: -12, pivotX: .5 } }), c('peer', { x: .45, y: .6 })];
  const context = createUiSnapContext(components, ['child', 'peer'], viewport)!;
  const delta = 500 - context.bounds.x - context.bounds.width / 2;
  const snap = snapUiMove(context, { x: delta + 2, y: 20 }, { x: 1, y: 1 }); near(snap.delta.x, delta);
  const plan = planUiArrangement(components, ['child', 'peer'], viewport, { kind: 'move', delta: snap.delta }); assert.equal(plan.problem, undefined);
  const after = resolveUiLayout(components.map(component => ({ ...component, ...plan.changes.find(change => change.id === component.id)?.rect })), viewport);
  const left = Math.min(after.get('child')!.bounds.x, after.get('peer')!.bounds.x), right = Math.max(...['child', 'peer'].map(id => after.get(id)!.bounds.x + after.get(id)!.bounds.width));
  near((left + right) / 2, 500);
});

test('guide spans use the final two-axis snapped position, not the raw pointer position', () => {
  const components = [c('moving', { x: .1, y: .2, width: .1, height: .1 }), c('target', { x: .4, y: .6, width: .2, height: .2 })];
  const result = snapUiMove(createUiSnapContext(components, ['moving'], viewport), { x: 298, y: 198 }, { x: 1, y: 1 });
  assert.deepEqual(result, { delta: { x: 300, y: 200 }, guides: [{ axis: 'x', position: 400, start: 300, end: 400, edge: 'start', targetId: 'target' }, { axis: 'y', position: 300, start: 400, end: 600, edge: 'start', targetId: 'target' }] });
});

test('equal-distance target choice is stable across changes to paint order', () => {
  const components = [c('moving'), c('z', { x: .6, y: .6 }), c('a', { x: .6, y: .6 })];
  const forward = snapUiMove(createUiSnapContext(components, ['moving'], viewport), { x: 432, y: 0 }, { x: 1, y: 1 });
  const reverse = snapUiMove(createUiSnapContext([...components].reverse(), ['moving'], viewport), { x: 432, y: 0 }, { x: 1, y: 1 });
  assert.deepEqual(forward, reverse); assert.equal(forward.guides.find(guide => guide.axis === 'x')?.targetId, 'a');
});

test('disabled snapping and invalid contexts leave raw movement untouched with no guides', () => {
  const context = createUiSnapContext([c('moving')], ['moving'], viewport)!;
  const raw = { x: -168, y: 4 };
  assert.deepEqual(snapUiMove(context, raw, { x: 1, y: 1 }, false), { delta: raw, guides: [] });
  for (const invalid of [undefined, createUiSnapContext([], [], viewport), createUiSnapContext([c('moving')], ['missing'], viewport), createUiSnapContext([c('moving')], ['moving'], { width: 0, height: 500 })]) assert.deepEqual(snapUiMove(invalid, raw, { x: 1, y: 1 }), { delta: raw, guides: [] });
  for (const units of [{ x: 0, y: 1 }, { x: 1, y: -1 }, { x: NaN, y: 1 }]) assert.deepEqual(snapUiMove(context, raw, units), { delta: raw, guides: [] });
});
