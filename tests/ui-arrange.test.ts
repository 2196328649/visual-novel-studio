import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, effectiveUiComponents, projectSchema, uiComponentLimit, type UiComponent } from '../src/core/model';
import { applyUiRectChanges, planUiArrangement, uiRectChangeProblem, uiSelectionRoots, type UiArrangement } from '../src/core/ui-arrange';
import { resolveUiLayout } from '../src/core/ui-layout';

const viewport = { width: 1000, height: 500 };
const c = (id: string, patch: Partial<UiComponent> = {}): UiComponent => ({ id, kind: 'button', page: 'main', text: id, x: .1, y: .2, width: .2, height: .1, ...patch });
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
function arranged(components: UiComponent[], ids: string[], operation: UiArrangement, dimensions = viewport) {
  const original = structuredClone(components), plan = planUiArrangement(components, ids, dimensions, operation);
  assert.equal(plan.problem, undefined); assert.deepEqual(components, original);
  return components.map(item => ({ ...item, ...plan.changes.find(change => change.id === item.id)?.rect }));
}

for (const axis of ['x', 'y'] as const) for (const edge of ['start', 'center', 'end'] as const) {
  test(`single component aligns ${axis}/${edge} to the canvas without resizing`, () => {
    const before = c('a'), after = arranged([before], ['a'], { kind: 'align', axis, edge, target: 'canvas' })[0];
    near(after[axis], edge === 'start' ? 0 : (1 - before[axis === 'x' ? 'width' : 'height']) * (edge === 'center' ? .5 : 1));
    near(after[axis === 'x' ? 'y' : 'x'], before[axis === 'x' ? 'y' : 'x']);
    near(after.width, before.width); near(after.height, before.height);
  });
}

test('selection alignment uses world edges and leaves unrelated components intact', () => {
  const components = [c('a'), c('b', { x: .6, y: .5, width: .1 }), c('other', { x: .9 })];
  const after = arranged(components, ['a', 'b'], { kind: 'align', axis: 'x', edge: 'end', target: 'selection' });
  near(after[0].x + after[0].width, .7); near(after[1].x, .6);
  assert.deepEqual(after[2], components[2]);
  assert.deepEqual(planUiArrangement(after, ['a', 'b'], viewport, { kind: 'align', axis: 'x', edge: 'end', target: 'selection' }).changes, []);
});

for (const axis of ['x', 'y'] as const) for (const edge of ['start', 'center', 'end'] as const) test(`last-selected reference stays fixed when aligning ${axis}/${edge}`, () => {
  const components = [c('first', { x: .7, y: .65 }), c('middle', { x: .1, y: .1, width: .3 }), c('reference', { x: .45, y: .4, width: .12, height: .18 })];
  const after = arranged(components, ['first', 'middle', 'reference'], { kind: 'align', axis, edge, target: 'last' });
  assert.deepEqual(after[2], components[2]);
  const size = axis === 'x' ? 'width' : 'height', factor = edge === 'start' ? 0 : edge === 'center' ? .5 : 1;
  after.forEach(item => near(item[axis] + item[size] * factor, components[2][axis] + components[2][size] * factor));
  const reordered = arranged(components, ['reference', 'middle', 'first'], { kind: 'align', axis, edge, target: 'last' });
  assert.deepEqual(reordered[0], components[0]);
  reordered.forEach(item => near(item[axis] + item[size] * factor, components[0][axis] + components[0][size] * factor));
});

test('a last-selected child keeps its selected ancestor fixed as other roots align to the child', () => {
  const components = [c('parent', { width: .6, height: .7, layout: { version: 1, rotation: 21, scaleX: 1.2 } }), c('child', { parentId: 'parent', x: .3, y: .4 }), c('peer', { x: .8 })];
  const before = resolveUiLayout(components, viewport), after = arranged(components, ['parent', 'peer', 'child'], { kind: 'align', axis: 'x', edge: 'center', target: 'last' });
  assert.deepEqual(after[0], components[0]); assert.deepEqual(after[1], components[1]);
  const geometry = resolveUiLayout(after, viewport), reference = before.get('child')!.bounds, peer = geometry.get('peer')!.bounds;
  near(reference.x + reference.width / 2, peer.x + peer.width / 2);
});

for (const axis of ['x', 'y'] as const) test(`${axis} distribution uses equal gaps, not equal centers, and fixes both ends`, () => {
  const size = axis === 'x' ? 'width' : 'height';
  const components = [c('a', { [axis]: .1, [size]: .1 }), c('b', { [axis]: .5, [size]: .2 }), c('c', { [axis]: .85, [size]: .05 })];
  const after = arranged(components, ['c', 'a', 'b'], { kind: 'distribute', axis });
  const plan = planUiArrangement(components, ['c', 'a', 'b'], viewport, { kind: 'distribute', axis });
  assert.equal(plan.distribution?.axis, axis); near(plan.distribution!.gap, viewport[size] * .225);
  assert.deepEqual(plan.changes.map(change => change.id), ['b']);
  assert.deepEqual(after[0], components[0]); assert.deepEqual(after[2], components[2]);
  near(after[0][axis], .1); near(after[2][axis], .85); near(after[1][axis], .425);
  near(after[1][axis] - after[0][axis] - after[0][size], after[2][axis] - after[1][axis] - after[1][size]);
  after.forEach((item, i) => { near(item[size], components[i][size]); near(item[axis === 'x' ? 'y' : 'x'], components[i][axis === 'x' ? 'y' : 'x']); });
});

test('the three cover menu buttons distribute their negative horizontal gap without moving either endpoint', () => {
  const dimensions = { width: 1920, height: 1080 };
  const positions = [1597.5477715439943, 1690, 1795], widths = [101.952, 102, 102];
  const tops = [50.91756720843354, 50, 50], heights = [101.952, 102, 102];
  const components = ['cover', 'settings', 'quit'].map((id, index) => c(id, {
    x: positions[index] / dimensions.width, y: tops[index] / dimensions.height,
    width: widths[index] / dimensions.width, height: heights[index] / dimensions.height,
  }));
  const original = structuredClone(components), operation: UiArrangement = { kind: 'distribute', axis: 'x' };
  const plan = planUiArrangement(components, ['quit', 'cover', 'settings'], dimensions, operation);
  assert.equal(plan.problem, undefined); assert.equal(plan.distribution?.axis, 'x'); near(plan.distribution!.gap, -3.2498857719972);
  assert.deepEqual(plan.changes.map(change => change.id), ['settings']); assert.deepEqual(components, original);
  const after = arranged(components, ['quit', 'cover', 'settings'], operation, dimensions);
  assert.deepEqual(after[0], original[0]); assert.deepEqual(after[2], original[2]);
  assert.deepEqual(after[1], { ...original[1], x: after[1].x });
  const geometry = resolveUiLayout(after, dimensions), first = geometry.get('cover')!.bounds, middle = geometry.get('settings')!.bounds, last = geometry.get('quit')!.bounds;
  near(middle.x, 1696.2498857719972);
  near(middle.x - first.x - first.width, -3.2498857719972); near(last.x - middle.x - middle.width, -3.2498857719972);
  const repeat = planUiArrangement(after, ['settings', 'quit', 'cover'], dimensions, operation);
  assert.equal(repeat.problem, undefined); assert.deepEqual(repeat.changes, []); near(repeat.distribution!.gap, plan.distribution!.gap);
});

for (const axis of ['x', 'y'] as const) for (const gap of [0, -.075]) test(`${axis} distribution permits ${gap === 0 ? 'touching' : 'overlapping'} frames with unequal sizes`, () => {
  const size = axis === 'x' ? 'width' : 'height', last = gap === 0 ? .4 : .25;
  const components = [c('a', { [axis]: .1, [size]: .1 }), c('b', { [axis]: .15, [size]: .2 }), c('c', { [axis]: last, [size]: .1 })];
  const operation: UiArrangement = { kind: 'distribute', axis }, plan = planUiArrangement(components, ['b', 'c', 'a'], viewport, operation);
  assert.equal(plan.problem, undefined); assert.equal(plan.distribution?.axis, axis); near(plan.distribution!.gap, gap * viewport[size]);
  const after = arranged(components, ['b', 'c', 'a'], operation);
  assert.deepEqual(after[0], components[0]); assert.deepEqual(after[2], components[2]);
  assert.deepEqual(after[1], { ...components[1], [axis]: after[1][axis] });
  near(after[1][axis] - after[0][axis] - after[0][size], gap); near(after[2][axis] - after[1][axis] - after[1][size], gap);
  assert.deepEqual(planUiArrangement(after, ['a', 'b', 'c'], viewport, operation).changes, []);
});

test('equal-size frames sharing an axis stay unchanged regardless of selection order', () => {
  for (const patch of [{}, { x: 0, y: 0, width: .0001, height: .0002 }]) {
    const components = [c('a', patch), c('b', patch), c('c', patch)];
    for (const axis of ['x', 'y'] as const) for (const ids of [['c', 'a', 'b'], ['b', 'c', 'a']]) {
      const size = axis === 'x' ? 'width' : 'height', original = structuredClone(components);
      const plan = planUiArrangement(components, ids, viewport, { kind: 'distribute', axis });
      assert.equal(plan.problem, undefined); assert.deepEqual(plan.changes, []); near(plan.distribution!.gap, -components[0][size] * viewport[size]);
      assert.deepEqual(components, original);
    }
  }
});

test('frames with equal starts use their sizes to choose the fixed first endpoint', () => {
  const components = [c('small', { x: .1, width: .01 }), c('large', { x: .1, width: .02 }), c('last', { x: .2, width: .03 })];
  const operation: UiArrangement = { kind: 'distribute', axis: 'x' };
  const after = arranged(components, ['large', 'last', 'small'], operation);
  assert.deepEqual(after[0], components[0]); assert.deepEqual(after[2], components[2]); near(after[1].x, .145);
  assert.deepEqual(planUiArrangement(after, ['last', 'small', 'large'], viewport, operation).changes, []);
});

test('unequal-size frames cannot merge at one start where coordinate rounding could reverse their order', () => {
  const components = [c('small', { x: .1, width: .01 }), c('middle', { x: .105, width: .02 }), c('last', { x: .11, width: .03 })];
  const original = structuredClone(components), operation: UiArrangement = { kind: 'distribute', axis: 'x' };
  for (const ids of [['middle', 'last', 'small'], ['last', 'small', 'middle']]) {
    const plan = planUiArrangement(components, ids, viewport, operation);
    assert.match(plan.problem!, /保持两端和控件顺序/); assert.deepEqual(plan.changes, []); assert.deepEqual(components, original);
  }
});

test('distribution rejects spacing that reverses either outer edge without partial changes', () => {
  for (const positions of [[0, 10, 20], [0, 2, 10]]) {
    const widths = positions[1] === 10 ? [100, 10, 100] : [100, 100, 10];
    const components = positions.map((position, index) => c('control_' + index, { x: position / viewport.width, width: widths[index] / viewport.width }));
    const original = structuredClone(components), plan = planUiArrangement(components, ['control_2', 'control_0', 'control_1'], viewport, { kind: 'distribute', axis: 'x' });
    assert.match(plan.problem!, /保持两端和控件顺序/); assert.deepEqual(plan.changes, []); assert.deepEqual(components, original);
  }
});

test('a subpixel negative advance is rejected before it can reorder frames on the next operation', () => {
  const components = [c('small', { x: 100 / viewport.width, width: 10 / viewport.width }),
    c('middle', { x: 105 / viewport.width, width: 20 / viewport.width }),
    c('last', { x: 109.999999 / viewport.width, width: 30 / viewport.width })];
  const original = structuredClone(components), plan = planUiArrangement(components, ['middle', 'small', 'last'], viewport, { kind: 'distribute', axis: 'x' });
  assert.match(plan.problem!, /保持两端和控件顺序/); assert.deepEqual(plan.changes, []); assert.deepEqual(components, original);
});

test('empty, stale and too-small selections fail without partial changes', () => {
  const components = [c('a'), c('b', { x: .2 }), c('c', { x: .3 })];
  for (const [ids, operation, reason] of [
    [[], { kind: 'move', delta: { x: 1, y: 0 } }, /先选择/],
    [['a', 'missing'], { kind: 'move', delta: { x: 1, y: 0 } }, /不存在/],
    [['a'], { kind: 'align', axis: 'x', edge: 'center', target: 'selection' }, /至少 2/],
    [['a', 'b'], { kind: 'distribute', axis: 'x' }, /至少 3/],
    [['a'], { kind: 'move', delta: { x: NaN, y: 0 } }, /有效数字/],
  ] as [string[], UiArrangement, RegExp][]) {
    const plan = planUiArrangement(components, ids, viewport, operation);
    assert.match(plan.problem!, reason); assert.deepEqual(plan.changes, []);
  }
});

test('ancestor and descendant selections move only the root once', () => {
  const components = [c('parent', { width: .6, height: .6 }), c('child', { parentId: 'parent' }), c('other')];
  assert.deepEqual(uiSelectionRoots(components, ['child', 'parent', 'child']), ['parent']);
  const before = resolveUiLayout(components, viewport), after = arranged(components, ['parent', 'child'], { kind: 'move', delta: { x: 37, y: -19 } });
  assert.deepEqual(after[1], components[1]); assert.deepEqual(after[2], components[2]);
  const geometry = resolveUiLayout(after, viewport);
  for (const id of ['parent', 'child']) { near(geometry.get(id)!.bounds.x - before.get(id)!.bounds.x, 37); near(geometry.get(id)!.bounds.y - before.get(id)!.bounds.y, -19); }
  assert.match(planUiArrangement(components, ['parent', 'child', 'other'], viewport, { kind: 'distribute', axis: 'x' }).problem!, /至少 3/);
});

test('alignment in rotated, mirrored, padded parents preserves authored affine settings', () => {
  const components = [c('p', { width: .6, height: .7, layout: { version: 1, rotation: 31, scaleX: -1.2, scaleY: .8, paddingLeft: 12, paddingTop: 20 } }), c('a', { parentId: 'p', layout: { version: 1, rotation: -12, pivotX: .5, pivotY: .2 } }), c('q', { x: .7, width: .25, height: .6, layout: { version: 1, rotation: -18, scaleX: 1.5 } }), c('b', { parentId: 'q', layout: { version: 1, anchorX: .2, pivotY: .5 } })];
  const after = arranged(components, ['a', 'b'], { kind: 'align', axis: 'y', edge: 'center', target: 'selection' });
  const world = resolveUiLayout(after, viewport), a = world.get('a')!.bounds, b = world.get('b')!.bounds;
  near(a.y + a.height / 2, b.y + b.height / 2);
  for (let i = 0; i < components.length; i++) { assert.deepEqual(after[i].layout, components[i].layout); assert.equal(after[i].parentId, components[i].parentId); near(after[i].width, components[i].width); }
  const centered = arranged(components, ['a'], { kind: 'align', axis: 'x', edge: 'center', target: 'canvas' });
  const box = resolveUiLayout(centered, viewport).get('a')!.bounds; near(box.x + box.width / 2, viewport.width / 2);
});

test('distribution across different affine parents changes local coordinates while preserving world gaps and both endpoints', () => {
  const components = [
    c('p', { kind: 'panel', x: .03, y: .08, width: .2, height: .4, layout: { version: 1, rotation: -20, scaleX: 1.1, scaleY: .9, paddingLeft: 9 } }),
    c('first', { parentId: 'p', x: .1, y: .15, width: .2, height: .12, layout: { version: 1, rotation: 12 } }),
    c('q', { kind: 'panel', x: .45, y: .1, width: .3, height: .5, layout: { version: 1, rotation: 27, scaleX: 1.2, scaleY: .7, paddingLeft: 11, paddingTop: 7 } }),
    c('middle', { parentId: 'q', x: .15, y: .1, width: .2, height: .12, layout: { version: 1, scaleX: -1, pivotX: .5 } }),
    c('r', { kind: 'panel', x: .82, y: .15, width: .2, height: .5, layout: { version: 1, rotation: -12, scaleX: .9, scaleY: 1.1 } }),
    c('last', { parentId: 'r', x: .1, y: .2, width: .2, height: .12 }),
  ];
  const operation: UiArrangement = { kind: 'distribute', axis: 'x' }, ids = ['last', 'middle', 'first'];
  const plan = planUiArrangement(components, ids, viewport, operation), before = resolveUiLayout(components, viewport);
  assert.equal(plan.problem, undefined); assert.deepEqual(plan.changes.map(change => change.id), ['middle']);
  const after = arranged(components, ids, operation), world = resolveUiLayout(after, viewport);
  for (const id of ['p', 'q', 'r', 'first', 'last']) assert.deepEqual(after.find(item => item.id === id), components.find(item => item.id === id));
  const originalMiddle = components.find(item => item.id === 'middle')!, movedMiddle = after.find(item => item.id === 'middle')!;
  assert.notEqual(movedMiddle.x, originalMiddle.x); assert.notEqual(movedMiddle.y, originalMiddle.y);
  assert.deepEqual(movedMiddle, { ...originalMiddle, x: movedMiddle.x, y: movedMiddle.y });
  const first = world.get('first')!.bounds, middle = world.get('middle')!.bounds, last = world.get('last')!.bounds;
  near(middle.x - first.x - first.width, last.x - middle.x - middle.width); near(middle.x - first.x - first.width, plan.distribution!.gap);
  near(middle.y, before.get('middle')!.bounds.y);
  assert.deepEqual(planUiArrangement(after, ['middle', 'first', 'last'], viewport, operation).changes, []);
});

test('multi-move crosses different affine parent frames by the same game-pixel delta', () => {
  const components = [c('p', { width: .7, height: .7, layout: { version: 1, rotation: 65, scaleX: .6, scaleY: 1.5 } }), c('a', { parentId: 'p' }), c('b', { layout: { version: 1, rotation: 23 } })];
  const before = resolveUiLayout(components, viewport), after = resolveUiLayout(arranged(components, ['a', 'b'], { kind: 'move', delta: { x: -10, y: 1 } }), viewport);
  for (const id of ['a', 'b']) { near(after.get(id)!.bounds.x - before.get(id)!.bounds.x, -10); near(after.get(id)!.bounds.y - before.get(id)!.bounds.y, 1); }
});

test('hidden, locked, inherited locks and unsupported layout versions block the whole selection', () => {
  for (const patch of [{ editor: { hidden: true } }, { editor: { locked: true } }, { layout: { version: 7, futureData: 'kept' } }] as Partial<UiComponent>[]) {
    const components = [c('p', patch), c('child', { parentId: 'p' }), c('other')], before = structuredClone(components);
    const plan = planUiArrangement(components, ['child', 'other'], viewport, { kind: 'move', delta: { x: 1, y: 0 } });
    assert.ok(plan.problem); assert.deepEqual(plan.changes, []); assert.deepEqual(components, before);
  }
  const plan = planUiArrangement([c('save'), c('load')], ['save', 'load'], viewport, { kind: 'move', delta: { x: 1, y: 0 } }, item => item.id !== 'load');
  assert.match(plan.problem!, /隐藏项/);
});

test('automatic foreground layout is not overwritten, while its background and the container remain movable', () => {
  const components = [c('p', { width: .6, height: .6, layout: { version: 1, flow: 'vertical' } }), c('child', { parentId: 'p' }), c('bg', { parentId: 'p', childLayer: 'background' })];
  assert.match(planUiArrangement(components, ['child'], viewport, { kind: 'align', axis: 'x', edge: 'center', target: 'canvas' }).problem!, /自动排列/);
  assert.equal(planUiArrangement(components, ['child'], viewport, { kind: 'move', delta: { x: 1, y: 0 } }).problem, undefined);
  assert.equal(planUiArrangement(components, ['bg'], viewport, { kind: 'move', delta: { x: 1, y: 0 } }).problem, undefined);
  assert.equal(planUiArrangement(components, ['p', 'child'], viewport, { kind: 'move', delta: { x: 1, y: 0 } }).problem, undefined);
});

test('zero parent content and zero-scale components are rejected', () => {
  const components = [c('p', { layout: { version: 1, paddingLeft: 200, paddingRight: 200 } }), c('child', { parentId: 'p' }), c('zero', { layout: { version: 1, scaleX: 0 } })];
  for (const id of ['child', 'zero']) assert.match(planUiArrangement(components, [id], viewport, { kind: 'move', delta: { x: 1, y: 0 } }).problem!, /非零/);
});

test('scroll-clamp drift is rejected instead of reporting a movement that never occurred', () => {
  const components = [c('p', { width: .2, height: .2, layout: { version: 1, scroll: 'vertical', scrollY: 999 } }), c('child', { parentId: 'p', x: 0, y: 0, width: 1, height: 3 })], before = structuredClone(components);
  const plan = planUiArrangement(components, ['child'], viewport, { kind: 'move', delta: { x: 0, y: 10 } });
  assert.match(plan.problem!, /滚动容器/); assert.deepEqual(plan.changes, []); assert.deepEqual(components, before);
  assert.equal(planUiArrangement(components, ['p'], viewport, { kind: 'move', delta: { x: 0, y: 10 } }).problem, undefined);
});

test('inherited multi-edits preflight all required overrides and never partially mutate at capacity', () => {
  const project = createProject('capacity'); Object.assign(project, viewport);
  project.ui.components = [c('a'), c('b', { x: .6 })]; project.ui.instances = [{ id: 'derived', name: 'derived', components: Array.from({ length: uiComponentLimit - 1 }, (_, index) => c('local_' + index, { page: 'say' })) }]; project.ui.activeInstanceId = 'derived';
  const before = structuredClone(project), scope = { page: 'main' as const, ownerId: 'derived' };
  const components = effectiveUiComponents(project.ui).filter(item => item.page === 'main');
  const plan = planUiArrangement(components, ['a', 'b'], project, { kind: 'move', delta: { x: 1, y: 0 } });
  assert.match(uiRectChangeProblem(project, scope, plan.changes)!, /未修改任何/);
  assert.throws(() => applyUiRectChanges(project, scope, plan.changes), /未修改任何/); assert.deepEqual(project, before);
  const alignment = planUiArrangement(components, ['a', 'b'], project, { kind: 'align', axis: 'x', edge: 'start', target: 'selection' });
  assert.deepEqual(planUiArrangement(components, ['b', 'a'], project, { kind: 'align', axis: 'x', edge: 'start', target: 'last' }).changes, alignment.changes);
  assert.equal(alignment.changes.length, 1); applyUiRectChanges(project, scope, alignment.changes);
  assert.equal(project.ui.instances[0].components.length, uiComponentLimit); assert.equal(project.ui.instances[0].components.some(item => item.id === 'a'), false);
  assert.deepEqual(project.ui.components, before.ui.components); near(effectiveUiComponents(project.ui).find(item => item.id === 'b')!.x, .1);
});

test('custom-page edits preserve background, behaviors and unrelated pages through save/reopen', () => {
  const project = createProject('custom'); Object.assign(project, viewport);
  project.ui.customPages = [{ id: 'custom', name: 'custom', modal: true, background: '#123456', backgroundId: 'legacy_background', onShowBlueprintId: 'legacy_graph', components: [c('a', { page: 'custom' }), c('b', { page: 'custom', x: .6 })] }];
  const before = structuredClone(project), scope = { page: 'custom' as const, ownerId: 'custom' };
  const plan = planUiArrangement(project.ui.customPages[0].components, ['a', 'b'], project, { kind: 'align', axis: 'x', edge: 'center', target: 'selection' });
  applyUiRectChanges(project, scope, plan.changes);
  const saved = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(saved.ui.components, before.ui.components);
  const { components: _components, ...settings } = saved.ui.customPages[0];
  const { components: _before, ...previous } = before.ui.customPages[0]; assert.deepEqual(settings, previous);
  const stable = structuredClone(project);
  assert.throws(() => applyUiRectChanges(project, { page: 'custom', ownerId: 'missing' }, plan.changes), /已切换/); assert.deepEqual(project, stable);
  assert.throws(() => applyUiRectChanges(project, { page: 'main', ownerId: 'stale_scheme' }, plan.changes), /已切换/); assert.deepEqual(project, stable);
});
