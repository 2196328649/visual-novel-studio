import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, editableUiComponent, effectiveUiComponents, projectSchema, type UiComponent } from '../src/core/model';
import { reorderUiList, resolveUiHierarchy, uiListOrder, uiPaintOrder, type UiListChange } from '../src/core/ui-hierarchy';
import { transformUiRect } from '../src/core/ui-transform';

const box = (id: string, extra: Partial<UiComponent> = {}): UiComponent => ({ id, kind: 'panel', page: 'main', text: '', x: .1, y: .2, width: .4, height: .3, ...extra });
const ids = (components: UiComponent[]) => components.map(c => c.id);
const apply = (components: UiComponent[], changes: UiListChange[]) => changes.forEach(({ id, change }) => Object.assign(components.find(c => c.id === id)!, change));
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('list moves retain paint order, source array, layers and geometry across saving', () => {
  const p = createProject('独立列表排序');
  p.ui.components = [box('a', { layer: 80 }), box('b', { editor: { hidden: true } }), box('c', { layer: -5 })];
  const before = structuredClone(p.ui.components), paint = ids(uiPaintOrder(before));
  assert.deepEqual(ids(uiListOrder(before)), ['c', 'b', 'a']);
  const changes = reorderUiList(p.ui.components, 'a', 'b', 'before');
  assert.deepEqual(p.ui.components, before, 'Planning must not mutate the project');
  assert.deepEqual(changes.map(c => c.id), ['a']);
  apply(p.ui.components, changes);
  assert.deepEqual(ids(uiListOrder(p.ui.components)), ['c', 'a', 'b']);
  assert.deepEqual(ids(uiPaintOrder(p.ui.components)), paint);
  assert.deepEqual(ids(p.ui.components), ids(before));
  for (const c of p.ui.components) assert.deepEqual({ ...c, editor: undefined }, { ...before.find(item => item.id === c.id), editor: undefined });
  const saved = projectSchema.parse(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(ids(uiListOrder(saved.ui.components)), ['c', 'a', 'b']);
  assert.deepEqual(ids(uiPaintOrder(saved.ui.components)), paint);
  saved.ui.components[0].layer = -100;
  assert.deepEqual(ids(uiListOrder(saved.ui.components)), ['c', 'a', 'b'], 'Changing display depth must not reorder the list');
  assert.notDeepEqual(ids(uiPaintOrder(saved.ui.components)), paint);
});

test('inserting across parents moves the full subtree and preserves its world rectangles', () => {
  const rows = [box('left'), box('right', { x: .6, width: .2 }), box('child', { parentId: 'left', layer: 7 }), box('grandchild', { parentId: 'child', width: .2 }), box('target', { parentId: 'right' })];
  const before = resolveUiHierarchy(rows);
  apply(rows, reorderUiList(rows, 'child', 'target', 'after'));
  assert.equal(rows[2].parentId, 'right'); assert.equal(rows[3].parentId, 'child'); assert.equal(rows[2].layer, 7);
  assert.deepEqual(ids(uiListOrder(rows).filter(c => c.parentId === 'right')), ['target', 'child']);
  for (const id of ['child', 'grandchild']) {
    const old = before.find(row => row.component.id === id)!.component;
    const now = resolveUiHierarchy(rows).find(row => row.component.id === id)!.component;
    for (const key of ['x', 'y', 'width', 'height'] as const) near(old[key], now[key]);
  }
  apply(rows, reorderUiList(rows, 'child', 'left', 'before'));
  assert.equal(rows[2].parentId, undefined);
  for (const key of ['x', 'y', 'width', 'height'] as const) near(before.find(row => row.component.id === 'grandchild')!.component[key], resolveUiHierarchy(rows).find(row => row.component.id === 'grandchild')!.component[key]);
  assert.throws(() => reorderUiList(rows, 'child', 'grandchild', 'before'));
  assert.throws(() => reorderUiList(rows, 'left', 'left', 'after'));
  assert.throws(() => reorderUiList([...rows, box('other_page', { page: 'say' })], 'left', 'other_page', 'before'));
});

test('reordering an inherited object only overrides that object and retains base propagation', () => {
  const p = createProject('继承排序'); p.ui.components = [box('a'), box('b'), box('c')];
  p.ui.instances = [{ id: 'variant', name: '变体', components: [] }]; p.ui.activeInstanceId = 'variant';
  const original = structuredClone(p.ui.components), paint = ids(uiPaintOrder(effectiveUiComponents(p.ui)));
  const changes = reorderUiList(effectiveUiComponents(p.ui), 'a', 'b', 'before');
  for (const item of changes) Object.assign(editableUiComponent(p.ui, item.id)!, item.change);
  assert.deepEqual(p.ui.components, original);
  assert.deepEqual(p.ui.instances[0].components.map(c => c.id), ['a']);
  assert.deepEqual(ids(uiPaintOrder(effectiveUiComponents(p.ui))), paint);
  p.ui.components[1].text = '基础对象的新文字';
  assert.equal(effectiveUiComponents(p.ui).find(c => c.id === 'b')!.text, '基础对象的新文字');
  assert.equal(projectSchema.safeParse(p).success, true);
});

test('save/load filters and tied list ranks never change other controls display depths', () => {
  const rows = [box('a', { page: 'save', saveMode: 'save', layer: 4 }), box('hidden_load', { page: 'save', saveMode: 'load', layer: 100 }), box('b', { page: 'save', saveMode: 'save', layer: 8 })];
  const other = structuredClone(rows[1]);
  apply(rows, reorderUiList(rows, 'a', 'b', 'before'));
  assert.deepEqual(ids(uiListOrder(rows).filter(c => c.saveMode === 'save')), ['a', 'b']);
  assert.deepEqual(rows[1], other);
  const tied = [box('a'), box('b'), box('c')].map(c => ({ ...c, editor: { listOrder: 0, locked: true } }));
  const paint = ids(uiPaintOrder(tied));
  apply(tied, reorderUiList(tied, 'a', 'b', 'before'));
  assert.deepEqual(ids(uiListOrder(tied)), ['c', 'a', 'b']);
  assert.deepEqual(ids(uiPaintOrder(tied)), paint); assert.ok(tied.every(c => c.editor.locked));
  assert.deepEqual(reorderUiList(tied, 'a', 'b', 'before'), []);
});

test('edge and corner resizing keep the opposite edges fixed without moving unrelated axes', () => {
  const rect = { x: .2, y: .3, width: .4, height: .2 };
  const corner = transformUiRect(rect, 'nw', -.1, -.05);
  near(corner.x, .1); near(corner.y, .25); near(corner.width, .5); near(corner.height, .25);
  near(corner.x + corner.width, rect.x + rect.width); near(corner.y + corner.height, rect.y + rect.height);
  const right = transformUiRect(rect, 'e', .1, .6);
  near(right.width, .5); near(right.height, .2); near(right.x, rect.x); near(right.y, rect.y);
  const bottom = transformUiRect(rect, 's', -.8, .1);
  near(bottom.height, .3); near(bottom.width, .4); near(bottom.x, rect.x);
});

test('aspect resizing and minimum dimensions preserve anchors instead of flipping through zero', () => {
  const rect = { x: .2, y: .3, width: .4, height: .2 };
  const constrained = transformUiRect(rect, 'nw', -.1, -.01, { preserveAspectRatio: true });
  near(constrained.width / constrained.height, 2);
  near(constrained.x + constrained.width, .6); near(constrained.y + constrained.height, .5);
  const side = transformUiRect(rect, 'e', .2, 0, { preserveAspectRatio: true });
  near(side.width / side.height, 2); near(side.x, rect.x); near(side.y + side.height / 2, rect.y + rect.height / 2);
  const crossed = transformUiRect(rect, 'nw', 2, 2, { minWidth: .01, minHeight: .02 });
  near(crossed.width, .01); near(crossed.height, .02); near(crossed.x + crossed.width, .6); near(crossed.y + crossed.height, .5);
  assert.ok(Object.values(transformUiRect({ ...rect, width: 0 }, 'se', .1, .1, { preserveAspectRatio: true })).every(Number.isFinite));
});

test('resizing a parent scales its descendants while child resizing stays local', () => {
  const parent = box('parent'), child = box('child', { parentId: 'parent', x: .25, y: .5, width: .5, height: .25 });
  const childLocal = structuredClone(child), before = resolveUiHierarchy([parent, child])[1].component;
  Object.assign(parent, transformUiRect(parent, 'se', parent.width, parent.height));
  const after = resolveUiHierarchy([parent, child])[1].component;
  near(after.width, before.width * 2); near(after.height, before.height * 2); assert.deepEqual(child, childLocal);
  const parentBefore = structuredClone(parent);
  Object.assign(child, transformUiRect(child, 'e', .1, 0));
  const resizedChild = resolveUiHierarchy([parent, child])[1].component;
  near(resizedChild.width - after.width, parent.width * .1); assert.deepEqual(parent, parentBefore);
});
