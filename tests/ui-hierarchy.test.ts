import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, effectiveUiComponents, projectSchema, type UiComponent } from '../src/core/model';
import { duplicateUiSubtree, reparentUiComponent, resolveUiHierarchy, uiHierarchyProblems, uiPaintOrder } from '../src/core/ui-hierarchy';
import { removeUiObject } from '../src/core/ui-hierarchy-edit';
import { previewUiLogic } from '../src/core/ui-logic-preview';
import { createUiParameterBinding } from '../src/core/ui-logic';
import { uiSkinAsset } from '../src/core/ui';

function fixture() {
  const p = createProject('界面子对象');
  p.ui.components = [
    { id: 'button', kind: 'button', page: 'main', text: '按钮', x: .2, y: .3, width: .4, height: .2, style: { opacity: .5 } },
    { id: 'bg', parentId: 'button', childLayer: 'background', inheritState: true, kind: 'image', page: 'main', text: '', assetId: 'image', x: -.1, y: -.2, width: 1.2, height: 1.4, style: { opacity: .8 } },
    { id: 'caption', parentId: 'button', kind: 'text', page: 'main', text: '小字', x: .1, y: .5, width: .5, height: .4 },
    { id: 'icon', parentId: 'bg', childLayer: 'foreground', inheritState: true, kind: 'image', page: 'main', text: '', assetId: 'image', x: .5, y: .5, width: .25, height: .25 },
  ];
  p.assets.push({ id: 'image', kind: 'image', name: '背景', path: 'background.png' });
  return p;
}
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('hierarchy saves and derives geometry, opacity and subtree order without rewriting local values', () => {
  const p = projectSchema.parse(JSON.parse(JSON.stringify(fixture()))), before = structuredClone(p);
  const rows = resolveUiHierarchy(p.ui.components), bg = rows.find(row => row.component.id === 'bg')!.component;
  assert.deepEqual(uiPaintOrder(p.ui.components).map(c => c.id), ['bg', 'icon', 'button', 'caption']);
  near(bg.x, .16); near(bg.y, .26); near(bg.width, .48); near(bg.height, .28); near(bg.style!.opacity!, .4);
  assert.equal(rows.find(r => r.component.id === 'button')!.component.style!.background, undefined);
  assert.deepEqual(p, before);
  p.ui.components[0].width = .8; p.ui.components[0].x = .1;
  const moved = resolveUiHierarchy(p.ui.components).find(r => r.component.id === 'bg')!.component;
  near(moved.x, .02); near(moved.width, .96); near(moved.y, bg.y);
});

test('background children never erase the parent button skin or its state colors', () => {
  const p = fixture(), parent = p.ui.components[0];
  parent.skin = { idle: 'idle', hover: 'hover', pressed: 'pressed', selected: 'selected', disabled: 'disabled', hideText: true };
  parent.style = { ...parent.style, background: '#123456', hoverBackground: '#234567', pressedBackground: '#345678', selectedBackground: '#456789', disabledBackground: '#567890' };
  const before = structuredClone(p);
  for (const state of ['idle', 'hover', 'pressed', 'selected', 'disabled'] as const) {
    const result = resolveUiHierarchy(p.ui.components, { state: () => state });
    const resolved = result.find(r => r.component.id === parent.id)!.component;
    assert.deepEqual(resolved.skin, parent.skin);
    assert.equal(uiSkinAsset(resolved.skin, state), state);
    for (const key of ['background', 'hoverBackground', 'pressedBackground', 'selectedBackground', 'disabledBackground'] as const) assert.equal(resolved.style?.[key], parent.style[key]);
  }
  assert.deepEqual(p, before);
  p.ui.components[1].editor = { hidden: true };
  const visible = resolveUiHierarchy(p.ui.components, { design: true });
  assert.equal(visible.find(r => r.component.id === parent.id)!.visible, true);
  assert.deepEqual(visible.find(r => r.component.id === parent.id)!.component.skin, parent.skin);
});

test('all parenting entry points use foreground defaults and preserve explicit child settings', () => {
  const p = fixture();
  const image: UiComponent = { id: 'new_image', kind: 'image', page: 'main', text: '', assetId: 'image', x: .6, y: .5, width: .1, height: .1 };
  p.ui.components.push(image);
  const before = structuredClone(p);
  const change = reparentUiComponent(p.ui.components, image.id, 'button');
  assert.equal(change.childLayer, 'foreground'); assert.equal(change.inheritState, true);
  assert.deepEqual(p, before);
  Object.assign(image, change);
  const world = resolveUiHierarchy(p.ui.components).find(r => r.component.id === image.id)!.component;
  for (const key of ['x', 'y', 'width', 'height'] as const) near(world[key], before.ui.components.at(-1)![key]);
  image.childLayer = 'background'; image.inheritState = false;
  const explicit = reparentUiComponent(p.ui.components, image.id, 'bg');
  assert.equal(explicit.childLayer, 'background'); assert.equal(explicit.inheritState, false);
  const detached = reparentUiComponent(p.ui.components, image.id);
  assert.equal(detached.parentId, undefined);
  assert.equal(detached.childLayer, undefined); // Detaching does not rewrite the authored layer.
});

test('visibility, editor locks, opacity and optional button state flow down the complete subtree', () => {
  const p = fixture();
  let rows = resolveUiHierarchy(p.ui.components, { state: c => c.id === 'button' ? 'pressed' : 'idle' });
  assert.equal(rows.find(r => r.component.id === 'icon')!.state, 'pressed');
  assert.equal(rows.find(r => r.component.id === 'caption')!.state, 'idle');
  p.ui.components[0].editor = { hidden: true, locked: true };
  rows = resolveUiHierarchy(p.ui.components, { design: true });
  assert.ok(rows.every(r => !r.visible && r.component.editor?.locked));
  assert.ok(resolveUiHierarchy(p.ui.components).every(r => r.visible));
  assert.ok(resolveUiHierarchy(p.ui.components, { visible: c => c.id !== 'button' }).every(r => !r.visible));
  p.ui.components[0].disabled = true;
  assert.ok(resolveUiHierarchy(p.ui.components).every(r => r.state === 'disabled'));
});

test('reparenting and detaching preserve world rectangles; cycles and invalid parents are rejected', () => {
  const p = fixture(), child = p.ui.components[3];
  const before = resolveUiHierarchy(p.ui.components).find(r => r.component.id === child.id)!.component;
  Object.assign(child, reparentUiComponent(p.ui.components, child.id, 'button'));
  let after = resolveUiHierarchy(p.ui.components).find(r => r.component.id === child.id)!.component;
  for (const key of ['x', 'y', 'width', 'height'] as const) near(after[key], before[key]);
  Object.assign(child, reparentUiComponent(p.ui.components, child.id));
  after = resolveUiHierarchy(p.ui.components).find(r => r.component.id === child.id)!.component;
  for (const key of ['x', 'y', 'width', 'height'] as const) near(after[key], before[key]);
  assert.throws(() => reparentUiComponent(p.ui.components, 'button', 'bg'));
  assert.throws(() => reparentUiComponent(p.ui.components, 'button', 'missing'));
  for (const invalid of [
    p.ui.components.map(c => c.id === 'button' ? { ...c, parentId: 'bg' } : c),
    p.ui.components.map(c => c.id === 'bg' ? { ...c, parentId: 'missing' } : c),
    p.ui.components.map(c => c.id === 'bg' ? { ...c, page: 'say' as const } : c),
  ]) {
    assert.ok(uiHierarchyProblems(invalid).length);
    assert.equal(projectSchema.safeParse({ ...p, ui: { ...p.ui, components: invalid } }).success, false);
  }
});

test('copy and deletion operate on a whole subtree and keep sibling objects intact', () => {
  const p = fixture(); let i = 0;
  const copies = duplicateUiSubtree(p.ui.components, 'button', () => 'copy_' + ++i);
  assert.equal(copies.length, 4); assert.equal(copies[1].parentId, copies[0].id); assert.equal(copies[3].parentId, copies[1].id);
  p.ui.components.push(...copies); removeUiObject(p, 'button');
  assert.deepEqual(p.ui.components, copies);
  assert.equal(projectSchema.safeParse(p).success, true);
});

test('instance hiding hides inherited children; restoring an override preserves the object tree', () => {
  const p = fixture(); p.ui.instances = [{ id: 'derived', name: '派生', components: [], hiddenComponentIds: ['button'] }]; p.ui.activeInstanceId = 'derived';
  assert.deepEqual(effectiveUiComponents(p.ui), []);
  p.ui.instances[0].hiddenComponentIds = [];
  p.ui.instances[0].components.push({ ...p.ui.components[0], x: .4 });
  removeUiObject(p, 'button');
  assert.equal(effectiveUiComponents(p.ui).length, 4);
  assert.equal(effectiveUiComponents(p.ui)[0].x, .2);
  removeUiObject(p, 'button'); assert.equal(effectiveUiComponents(p.ui).length, 0);
});

test('interactive preview resolves ancestor animation and hover without mutating authored local coordinates', () => {
  const p = fixture();
  p.variables.push({ id: 'position', name: '位置', type: 'number', initial: .2, persistent: false });
  createUiParameterBinding(p, 'button', 'x', 'position', 'ui:main');
  const before = structuredClone(p);
  const preview = previewUiLogic(p, p.ui.components, 'ui:main', { position: .5 }, [{ kind: 'button', componentId: 'button', trigger: 'hover' }]);
  const bg = preview.components.find(r => r.component.id === 'bg')!;
  near(bg.component.x, .46); assert.equal(bg.state, 'hover'); assert.deepEqual(p, before);
  p.ui.components[0].disabled = true;
  assert.ok(previewUiLogic(p, p.ui.components, 'ui:main').components.every(r => r.state === 'disabled'));
});

test('deleting a local parent also removes its descendants in derived instances', () => {
  const p = fixture(), base = p.ui.components[0];
  p.ui.instances = [
    { id: 'variant', name: '变体', components: [{ ...base, id: 'local_parent' }] },
    { id: 'derived', name: '派生', baseUiId: 'variant', components: [{ ...p.ui.components[2], id: 'local_child', parentId: 'local_parent' }] },
    { id: 'separate', name: '独立', components: [{ ...base, id: 'separate_parent' }] },
  ];
  p.ui.activeInstanceId = 'variant';
  assert.equal(projectSchema.safeParse(p).success, true);
  removeUiObject(p, 'local_parent');
  assert.equal(projectSchema.safeParse(p).success, true);
  assert.deepEqual(p.ui.instances[0].components, []);
  assert.deepEqual(p.ui.instances[1].components, []);
  assert.equal(p.ui.instances[2].components.length, 1);
});

test('hiding an inherited parent also hides children added by a derived instance', () => {
  const p = fixture();
  p.ui.instances = [
    { id: 'variant', name: '变体', components: [], hiddenComponentIds: ['button'] },
    { id: 'derived', name: '派生', baseUiId: 'variant', components: [{ ...p.ui.components[2], id: 'local_child' }] },
  ];
  p.ui.activeInstanceId = 'derived';
  assert.deepEqual(effectiveUiComponents(p.ui), []);
  assert.equal(projectSchema.safeParse(p).success, true);
  p.ui.instances[0].hiddenComponentIds = [];
  assert.equal(effectiveUiComponents(p.ui).length, 5);
});
