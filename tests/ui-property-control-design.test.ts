import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type UiComponent } from '../src/core/model';
import { uiPropertyControlDesignSnapshot } from '../src/core/ui-property-control-snapshot';
import { applyUiRectChanges, planUiArrangement, uiRectChangeProblem } from '../src/core/ui-arrange';
import { reparentUiComponent, reorderUiList, resolveUiHierarchy } from '../src/core/ui-hierarchy';

const object = (id: string, patch: Partial<UiComponent> = {}): UiComponent => ({ id, name: id, kind: 'text', page: 'main', text: '原设计文字', x: .1, y: .2, width: .3, height: .1, ...patch });
function scene() {
  const project = createProject('属性来源画布');
  project.width = 1000; project.height = 500;
  project.variables = [
    { id: 'position', name: '位置', type: 'number', initial: .45, persistent: false },
    { id: 'width', name: '宽度', type: 'number', initial: .6, persistent: false },
    { id: 'caption', name: '标题', type: 'string', initial: '参数文字', persistent: false },
    { id: 'alpha', name: '透明度', type: 'number', initial: .5, persistent: false },
    { id: 'visibility', name: '显示', type: 'boolean', initial: false, persistent: false },
  ];
  return project;
}

test('design snapshot reads parameter initial values without changing defaults or running page events', () => {
  const project = scene(), component = object('caption', { binding: 'title', style: { opacity: .8, fontSize: 30 }, propertyControls: {
    text: { mode: 'follow', parameterId: 'caption' }, opacity: { mode: 'sync', parameterId: 'alpha' },
    visible: { mode: 'follow', parameterId: 'visibility' },
  } });
  project.ui.components = [component];
  const before = structuredClone(project), snapshot = uiPropertyControlDesignSnapshot(project, component);
  assert.equal(snapshot.component.text, '参数文字'); assert.equal(snapshot.component.binding, undefined);
  assert.equal(snapshot.component.style?.opacity, .5); assert.equal(snapshot.values.visible, false);
  snapshot.component.style!.fontSize = 45;
  assert.deepEqual(project, before);
  const plain = object('plain');
  assert.equal(uiPropertyControlDesignSnapshot(project, plain).component, plain);
});

test('linked media uses its explicit source, including empty, without the legacy fallback covering it', () => {
  const project = scene();
  project.variables.push({ id: 'legacy', name: '旧图片源', type: 'asset', assetKind: 'image', initial: 'old_image', persistent: false }, { id: 'picture', name: '图片', type: 'asset', assetKind: 'image', initial: '', persistent: false });
  const image = object('image', { kind: 'image', assetId: 'old_image', assetParameterId: 'legacy', propertyControls: { image: { mode: 'sync', parameterId: 'picture' } } });
  const before = structuredClone(image), snapshot = uiPropertyControlDesignSnapshot(project, image);
  assert.equal(snapshot.component.assetId, ''); assert.equal(snapshot.component.assetParameterId, undefined);
  assert.deepEqual(image, before);
});

test('design numeric value clamps only its display and linked range retains untouched endpoints', () => {
  const project = scene();
  project.variables.push({ id: 'value', name: '进度', type: 'number', initial: 90, persistent: false }, { id: 'max', name: '显示上限', type: 'number', initial: 40, persistent: false });
  const component = object('slider', { kind: 'preference', parameterId: 'value', controlRange: { min: 20, max: 100, step: 2 }, propertyControls: {
    numberValue: { mode: 'follow', parameterId: 'value' }, maximum: { mode: 'sync', parameterId: 'max' },
  } });
  const before = structuredClone(project), original = structuredClone(component), snapshot = uiPropertyControlDesignSnapshot(project, component);
  assert.equal(snapshot.values.numberValue, 40); assert.equal(snapshot.component.readOnly, true);
  assert.deepEqual(snapshot.component.controlRange, { min: 20, max: 40, step: 2 });
  assert.deepEqual(component, original); assert.deepEqual(project, before);
});

test('moving an unlinked axis preserves linked authored geometry and the source parameter', () => {
  const project = scene();
  project.ui.components = [object('target', { propertyControls: { x: { mode: 'sync', parameterId: 'position' }, width: { mode: 'follow', parameterId: 'width' } } })];
  const before = structuredClone(project), shown = project.ui.components.map(component => uiPropertyControlDesignSnapshot(project, component).component);
  const down = planUiArrangement(shown, ['target'], project, { kind: 'move', delta: { x: 0, y: 10 } });
  assert.equal(down.problem, undefined); assert.equal(uiRectChangeProblem(project, { page: 'main' }, down.changes), undefined);
  applyUiRectChanges(project, { page: 'main' }, down.changes);
  assert.equal(project.ui.components[0].x, .1); assert.equal(project.ui.components[0].width, .3);
  assert.ok(Math.abs(project.ui.components[0].y - .22) < 1e-9);
  assert.deepEqual(project.variables, before.variables); assert.deepEqual(project.ui.components[0].propertyControls, before.ui.components[0].propertyControls);
});

test('a disallowed axis or resize rejects the complete multi-control change before writing', () => {
  const project = scene();
  project.ui.components = [object('plain'), object('linked', { propertyControls: { x: { mode: 'sync', parameterId: 'position' } } })];
  const before = structuredClone(project), shown = project.ui.components.map(component => uiPropertyControlDesignSnapshot(project, component).component);
  const right = planUiArrangement(shown, ['plain', 'linked'], project, { kind: 'move', delta: { x: 10, y: 0 } });
  assert.equal(right.problem, undefined); assert.match(uiRectChangeProblem(project, { page: 'main' }, right.changes)!, /已关联参数/);
  assert.throws(() => applyUiRectChanges(project, { page: 'main' }, right.changes), /已关联参数/); assert.deepEqual(project, before);
});

test('negative-gap distribution keeps linked endpoints fixed and never saves linked size previews', () => {
  const project = scene();
  project.variables.find(variable => variable.id === 'position')!.initial = .1;
  project.variables.find(variable => variable.id === 'width')!.initial = .2;
  project.variables.push({ id: 'end', name: '末端位置', type: 'number', initial: .3, persistent: false }, { id: 'height', name: '高度', type: 'number', initial: .15, persistent: false });
  project.ui.components = [
    object('first', { x: .55, width: .1, propertyControls: { x: { mode: 'follow', parameterId: 'position' } } }),
    object('middle', { x: .18, width: .3, propertyControls: { width: { mode: 'follow', parameterId: 'width' }, height: { mode: 'sync', parameterId: 'height' } } }),
    object('last', { x: .8, width: .1, propertyControls: { x: { mode: 'sync', parameterId: 'end' } } }),
  ];
  const before = structuredClone(project), shown = () => project.ui.components.map(component => uiPropertyControlDesignSnapshot(project, component).component);
  const operation = { kind: 'distribute', axis: 'x' } as const, plan = planUiArrangement(shown(), ['last', 'first', 'middle'], project, operation);
  assert.equal(plan.problem, undefined); assert.ok(Math.abs(plan.distribution!.gap + 50) < 1e-8);
  assert.deepEqual(plan.changes.map(change => change.id), ['middle']); assert.equal(uiRectChangeProblem(project, { page: 'main' }, plan.changes), undefined);
  applyUiRectChanges(project, { page: 'main' }, plan.changes);
  assert.ok(Math.abs(project.ui.components[1].x - .15) < 1e-9);
  const expected = structuredClone(before); expected.ui.components[1].x = project.ui.components[1].x;
  assert.deepEqual(project, expected);
  const repeat = planUiArrangement(shown(), ['middle', 'last', 'first'], project, operation);
  assert.equal(repeat.problem, undefined); assert.deepEqual(repeat.changes, []);
});

test('distribution rejects all interior changes when one moved position belongs to a parameter', () => {
  for (const mode of ['follow', 'sync'] as const) {
    const project = scene(); project.variables.find(variable => variable.id === 'position')!.initial = .3;
    project.ui.components = [object('first', { x: .1, width: .1 }), object('plain', { x: .2, width: .1 }),
      object('linked', { x: .6, width: .1, propertyControls: { x: { mode, parameterId: 'position' } } }), object('last', { x: .38, width: .1 })];
    const before = structuredClone(project), shown = project.ui.components.map(component => uiPropertyControlDesignSnapshot(project, component).component);
    const plan = planUiArrangement(shown, ['last', 'plain', 'linked', 'first'], project, { kind: 'distribute', axis: 'x' });
    assert.equal(plan.problem, undefined); assert.ok(plan.distribution!.gap < 0);
    assert.deepEqual(new Set(plan.changes.map(change => change.id)), new Set(['plain', 'linked']));
    assert.match(uiRectChangeProblem(project, { page: 'main' }, plan.changes)!, /已关联参数/);
    assert.throws(() => applyUiRectChanges(project, { page: 'main' }, plan.changes), /已关联参数/); assert.deepEqual(project, before);
  }
});

test('unlinked children move in their linked parent frame without saving the parent parameter', () => {
  const project = scene();
  project.ui.components = [object('parent', { kind: 'panel', height: .7, propertyControls: { width: { mode: 'follow', parameterId: 'width' } } }), object('child', { parentId: 'parent' })];
  const shown = () => project.ui.components.map(component => uiPropertyControlDesignSnapshot(project, component).component);
  const before = resolveUiHierarchy(shown(), { viewport: project }).find(row => row.component.id === 'child')!.geometry!.bounds;
  const plan = planUiArrangement(shown(), ['child'], project, { kind: 'move', delta: { x: 12, y: 0 } });
  applyUiRectChanges(project, { page: 'main' }, plan.changes);
  const after = resolveUiHierarchy(shown(), { viewport: project }).find(row => row.component.id === 'child')!.geometry!.bounds;
  assert.ok(Math.abs(after.x - before.x - 12) < 1e-8); assert.equal(project.ui.components[0].width, .3);
  assert.equal(project.variables.find(variable => variable.id === 'width')!.initial, .6);
});

test('reparent protects parameter-defined frames while list order remains editable', () => {
  const project = scene();
  const linked = object('linked', { propertyControls: { x: { mode: 'follow', parameterId: 'position' } } }), parent = object('parent', { kind: 'panel' });
  const components = [linked, parent], before = structuredClone(components);
  assert.throws(() => reparentUiComponent(components, 'linked', 'parent', project), /已关联参数/);
  assert.ok(reorderUiList(components, 'linked', 'parent', 'before', project).length);
  assert.deepEqual(components, before);
});

test('reparent includes linked sibling sizes and visibility that determine the destination slot', () => {
  const project = scene();
  const components = [object('row', { kind: 'panel', x: 0, width: 1, layout: { version: 1, flow: 'horizontal' } }),
    object('sibling', { parentId: 'row', propertyControls: { width: { mode: 'follow', parameterId: 'width' } } }),
    object('target', { parentId: 'row' }), object('moved', { x: .8 }), object('unrelated')];
  assert.throws(() => reparentUiComponent(components, 'moved', 'target', project), /已关联参数/);
  // An unrelated root tree with bindings does not prevent this ordinary move.
  assert.doesNotThrow(() => reparentUiComponent(components, 'moved', 'unrelated', project));
  components[1].propertyControls = { visible: { mode: 'sync', parameterId: 'visibility' } };
  assert.throws(() => reparentUiComponent(components, 'moved', 'target', project), /已关联参数/);
});
