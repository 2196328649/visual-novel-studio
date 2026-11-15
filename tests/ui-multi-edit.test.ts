import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, effectiveUiComponents, uiComponentLimit, type Project, type UiComponent } from '../src/core/model';
import { mutateProject } from '../src/core/project-mutation';
import { applyUiMultiEdit, planUiMultiEdit, readUiMultiSelection, type UiMultiEdit, type UiMultiEditScope, type UiMultiProperty } from '../src/core/ui-multi-edit';

const component = (id: string, patch: Partial<UiComponent> = {}): UiComponent => ({ id, name: id, page: 'main', kind: 'text', text: '原文字', x: .1, y: .2, width: .3, height: .1, ...patch });
const scopeOf = (project: Project, patch: Partial<UiMultiEditScope> = {}): UiMultiEditScope => ({ projectId: project.id, page: 'main', ownerId: project.ui.activeInstanceId, ...patch });
const set = (property: UiMultiProperty, value: string | number): UiMultiEdit => ({ property, mode: 'set', value });
function fixture() {
  const project = createProject('共同属性编辑');
  project.ui.components = [component('caption', { style: { fontSize: 24, textColor: '#aabbcc', shadowX: 4 } }),
    component('button', { kind: 'button', action: 'start', style: { fontSize: 40, hoverTextColor: '#ffeeaa', opacity: .5 } })];
  project.ui.fontSize = 28;
  project.ui.textColor = '#aabbcc';
  project.assets = [{ id: 'project_font', kind: 'font', name: '项目字体', path: 'assets/font.ttf' },
    { id: 'wrong_kind', kind: 'image', name: '图片', path: 'assets/picture.png' }];
  project.variables = [{ id: 'shared_size', name: '共同字号参数', type: 'number', initial: 56, persistent: false }];
  return project;
}

test('mixed values and equal values with different sources are separate, observational states', () => {
  const project = fixture(), before = structuredClone(project);
  const selection = readUiMultiSelection(project, scopeOf(project), ['caption', 'button', 'caption']);
  assert.deepEqual(selection.ids, ['caption', 'button']);
  assert.deepEqual(selection.fields.map(field => field.property), ['opacity', 'font', 'fontSize', 'textColor']);
  const size = selection.fields.find(field => field.property === 'fontSize')!;
  assert.equal(size.mixed, true); assert.equal(size.value, undefined); assert.equal(size.mixedSources, false);
  const color = selection.fields.find(field => field.property === 'textColor')!;
  assert.equal(color.mixed, false); assert.equal(color.value, '#aabbcc'); assert.equal(color.mixedSources, true);
  assert.match(color.targets[0].source, /本控件/); assert.match(color.targets[1].source, /页面默认/);
  assert.deepEqual(project, before);
});

test('one batch changes every selected object and preserves unrelated data and unselected identity', () => {
  const project = fixture();
  project.ui.components.push(component('other', { style: { fontSize: 99 } }));
  project.ui.components[1].events = { onClick: 'existing_graph' };
  const before = structuredClone(project), other = project.ui.components[2], edits = [set('font', 'project_font'), set('fontSize', 36), set('textColor', '#12345680'), set('opacity', .65)];
  const plan = planUiMultiEdit(project, scopeOf(project), ['caption', 'button'], edits);
  assert.deepEqual(plan.problems, []); assert.deepEqual(plan.changedIds, ['caption', 'button']);
  assert.deepEqual(project, before, 'Preparing the transaction must not modify the caller.');
  const next = mutateProject(project, draft => { applyUiMultiEdit(draft, scopeOf(project), ['caption', 'button'], edits); });
  for (const entry of next.ui.components.slice(0, 2)) assert.deepEqual({ font: entry.style!.fontAssetId, size: entry.style!.fontSize, color: entry.style!.textColor, opacity: entry.style!.opacity }, { font: 'project_font', size: 36, color: '#12345680', opacity: .65 });
  assert.equal(next.ui.components[0].style!.shadowX, 4); assert.equal(next.ui.components[1].style!.hoverTextColor, '#ffeeaa');
  assert.deepEqual(next.ui.components[1].events, { onClick: 'existing_graph' }); assert.equal(next.ui.components[1].action, 'start');
  assert.equal(next.ui.components[2], other); assert.equal(next.variables, project.variables); assert.equal(next.blueprints, project.blueprints);
  assert.deepEqual(project, before, 'The original snapshot remains a complete one-step undo target.');
});

test('one invalid target rejects the complete multi-property batch on a mutable project', () => {
  const project = fixture(); project.ui.components[1].editor = { locked: true };
  const before = structuredClone(project);
  assert.throws(() => applyUiMultiEdit(project, scopeOf(project), ['caption', 'button'], [set('textColor', '#112233'), set('fontSize', 50)]), /button.*锁定/);
  assert.deepEqual(project, before);
});

test('ancestor locks and stale or cyclic parent relationships are checked for each target', () => {
  for (const mode of ['locked', 'missing', 'cycle', 'cross-page'] as const) {
    const project = fixture(), child = project.ui.components[1]; child.parentId = 'parent';
    if (mode !== 'missing') project.ui.components.push(component('parent', { kind: 'panel', ...(mode === 'locked' ? { editor: { locked: true } } : mode === 'cycle' ? { parentId: child.id } : { page: 'choice' }) }));
    const before = structuredClone(project), plan = planUiMultiEdit(project, scopeOf(project), ['caption', 'button'], [set('opacity', .25)]);
    assert.ok(plan.problems.some(problem => problem.id === 'button')); assert.deepEqual(plan.replacements, []);
    assert.throws(() => applyUiMultiEdit(project, scopeOf(project), ['caption', 'button'], [set('opacity', .25)]), /锁定|父对象|循环/);
    assert.deepEqual(project, before);
  }
});

for (const mode of ['follow', 'sync'] as const) test(mode + ' sources block only their property and do not mutate shared parameters', () => {
  const project = fixture(); project.ui.components[1].propertyControls = { fontSize: { mode, parameterId: 'shared_size' } };
  const before = structuredClone(project), selection = readUiMultiSelection(project, scopeOf(project), ['caption', 'button']);
  const size = selection.fields.find(field => field.property === 'fontSize')!;
  assert.equal(size.targets[1].value, 56); assert.equal(size.targets[1].designValue, 40);
  assert.match(size.targets[1].source, /共同字号参数/); assert.equal(size.problems[0].id, 'button');
  assert.equal(selection.fields.find(field => field.property === 'textColor')!.problems.length, 0);
  assert.throws(() => applyUiMultiEdit(project, scopeOf(project), ['caption', 'button'], [set('fontSize', 32), set('textColor', '#223344')]), /关联|参数/);
  assert.deepEqual(project, before);
  applyUiMultiEdit(project, scopeOf(project), ['caption', 'button'], [set('textColor', '#223344')]);
  assert.deepEqual(project.variables, before.variables); assert.deepEqual(project.ui.components[1].propertyControls, before.ui.components[1].propertyControls);
  assert.equal(project.ui.components[1].style!.fontSize, 40, 'The parameter initial value must never leak into authored defaults.');
});

test('invalid or missing property sources stay protected, including reset operations', () => {
  const project = fixture(); project.ui.components[1].propertyControls = { fontSize: { mode: 'follow', parameterId: 'deleted' } };
  const before = structuredClone(project);
  const selection = readUiMultiSelection(project, scopeOf(project), ['caption', 'button']);
  assert.match(selection.fields.find(field => field.property === 'fontSize')!.targets[1].source, /来源参数已删除/);
  assert.throws(() => applyUiMultiEdit(project, scopeOf(project), ['caption', 'button'], [{ property: 'fontSize', mode: 'reset' }]), /来源参数已删除/);
  assert.deepEqual(project, before);
});

test('inherited controls clone in the active scheme only and retain opaque unrelated fields', () => {
  const project = fixture();
  project.ui.instances = [{ id: 'base_scheme', name: '上级方案', components: [component('caption', { style: { fontSize: 31, textColor: '#778899' } })] },
    { id: 'child_scheme', name: '当前方案', baseUiId: 'base_scheme', components: [] }];
  project.ui.activeInstanceId = 'child_scheme';
  (project.ui.instances[0].components[0] as UiComponent & { futureData: unknown }).futureData = { preserve: true };
  const before = structuredClone(project), selection = readUiMultiSelection(project, scopeOf(project), ['caption', 'button']);
  assert.equal(selection.inheritedCount, 2);
  assert.match(selection.fields[0].targets[0].source, /上级方案/); assert.match(selection.fields[0].targets[1].source, /基础界面/);
  assert.deepEqual(applyUiMultiEdit(project, scopeOf(project), ['caption', 'button'], [set('fontSize', 42)]), ['caption', 'button']);
  assert.equal(project.ui.instances[1].components.length, 2);
  assert.equal(effectiveUiComponents(project.ui).find(c => c.id === 'caption')!.style!.fontSize, 42);
  assert.deepEqual(project.ui.components, before.ui.components); assert.deepEqual(project.ui.instances[0], before.ui.instances![0]);
  assert.deepEqual((project.ui.instances[1].components[0] as UiComponent & { futureData: unknown }).futureData, { preserve: true });
});

test('capacity is checked for the whole batch before creating any inherited override', () => {
  const project = fixture();
  project.ui.instances = [{ id: 'full', name: '剩余一个名额', components: Array.from({ length: uiComponentLimit - 1 }, (_, index) => component('filler_' + index, { page: 'choice' })) }];
  project.ui.activeInstanceId = 'full';
  const before = structuredClone(project), scope = scopeOf(project);
  assert.throws(() => applyUiMultiEdit(project, scope, ['caption', 'button'], [set('fontSize', 38)]), /还可建立 1.*需要 2/);
  assert.deepEqual(project, before);
  project.ui.components[0].style!.fontSize = 38;
  assert.deepEqual(applyUiMultiEdit(project, scope, ['caption', 'button'], [set('fontSize', 38)]), ['button']);
  assert.equal(project.ui.instances[0].components.length, uiComponentLimit);
});

test('duplicate IDs do not duplicate work; equal explicit writes preserve component references and undo identity', () => {
  const project = fixture(), scope = scopeOf(project);
  applyUiMultiEdit(project, scope, ['caption', 'button', 'caption'], [set('fontSize', 36)]);
  const references = [...project.ui.components], before = structuredClone(project);
  const next = mutateProject(project, draft => { assert.deepEqual(applyUiMultiEdit(draft, scope, ['caption', 'button'], [set('fontSize', 36)]), []); });
  assert.equal(next, project); project.ui.components.forEach((c, index) => assert.equal(c, references[index])); assert.deepEqual(project, before);
});

test('setting a default value explicitly and resetting are different, without resetting sibling fields', () => {
  const project = fixture(); project.ui.components[0].style = { shadowX: 4 }; project.ui.components[1].style = { hoverTextColor: '#123456' };
  const scope = scopeOf(project);
  applyUiMultiEdit(project, scope, ['caption', 'button'], [set('fontSize', 28), set('opacity', 0)]);
  assert.ok(project.ui.components.every(c => c.style?.fontSize === 28 && c.style.opacity === 0));
  project.ui.fontSize = 47;
  applyUiMultiEdit(project, scope, ['caption', 'button'], [{ property: 'fontSize', mode: 'reset' }]);
  assert.ok(project.ui.components.every(c => c.style?.fontSize === undefined && c.style?.opacity === 0));
  assert.equal(project.ui.components[0].style!.shadowX, 4); assert.equal(project.ui.components[1].style!.hoverTextColor, '#123456');
  assert.equal(readUiMultiSelection(project, scope, ['caption', 'button']).fields.find(field => field.property === 'fontSize')!.value, 47);
});

test('parent and child appearance edits apply to both selected targets, without movement root filtering', () => {
  const project = fixture(); project.ui.components[1].parentId = 'caption';
  applyUiMultiEdit(project, scopeOf(project), ['caption', 'button'], [set('opacity', .6), set('textColor', '#445566')]);
  for (const c of project.ui.components) { assert.equal(c.style!.opacity, .6); assert.equal(c.style!.textColor, '#445566'); }
  assert.equal(project.ui.components[1].parentId, 'caption');
});

test('list captions and hidden button text cannot silently join ordinary text edits', () => {
  for (const patch of [{ kind: 'choiceList' as const }, { kind: 'preference' as const, preference: 'musicVolume' as const }, { skin: { hideText: true } }] as Partial<UiComponent>[]) {
    const project = fixture(); Object.assign(project.ui.components[1], patch);
    const before = structuredClone(project), scope = scopeOf(project);
    assert.deepEqual(readUiMultiSelection(project, scope, ['caption', 'button']).fields.map(field => field.property), ['opacity']);
    assert.throws(() => applyUiMultiEdit(project, scope, ['caption', 'button'], [set('fontSize', 20), set('opacity', .7)]), /共同属性/);
    assert.deepEqual(project, before);
    applyUiMultiEdit(project, scope, ['caption', 'button'], [set('opacity', .7)]);
    assert.ok(project.ui.components.every(c => c.style!.opacity === .7));
  }
});

test('project, page and scheme changes reject stale selection and custom pages remain isolated', () => {
  const project = fixture(), scope = scopeOf(project), before = structuredClone(project);
  for (const badScope of [{ ...scope, projectId: 'other' }, { ...scope, ownerId: 'missing' }, { ...scope, page: 'choice' as const }, { ...scope, page: 'custom' as const, ownerId: 'missing' }]) {
    assert.throws(() => applyUiMultiEdit(project, badScope, ['caption', 'button'], [set('opacity', .4)])); assert.deepEqual(project, before);
  }
  project.ui.customPages.push({ id: 'custom_page', name: '独立页面', modal: true, components: [component('custom_a', { page: 'custom' }), component('custom_b', { page: 'custom' })] });
  const customScope = scopeOf(project, { page: 'custom', ownerId: 'custom_page' });
  applyUiMultiEdit(project, customScope, ['custom_a', 'custom_b'], [set('fontSize', 39)]);
  assert.deepEqual(project.ui.components, before.ui.components);
  assert.ok(project.ui.customPages[0].components.every(c => c.style!.fontSize === 39));
  const current = structuredClone(project);
  assert.throws(() => applyUiMultiEdit(project, customScope, ['custom_a', 'caption'], [set('fontSize', 40)]), /不存在|页面/); assert.deepEqual(project, current);
});

test('invalid numbers, colors, resources and duplicate operations never partially apply', () => {
  const invalid: UiMultiEdit[][] = [
    [set('fontSize', NaN)], [set('fontSize', 1.5)], [set('fontSize', 0)], [set('opacity', -.1)], [set('opacity', 1.1)],
    [set('textColor', '#12')], [set('font', 'missing')], [set('font', 'wrong_kind')], [set('fontSize', 20), set('fontSize', 21)],
  ];
  for (const edits of invalid) {
    const project = fixture(), before = structuredClone(project);
    assert.throws(() => applyUiMultiEdit(project, scopeOf(project), ['caption', 'button'], [set('textColor', '#123456'), ...edits]));
    assert.deepEqual(project, before);
  }
});

test('a prepared edit is revalidated at apply time when a target becomes locked or controlled', () => {
  const project = fixture(), scope = scopeOf(project), edits = [set('fontSize', 38)];
  assert.equal(planUiMultiEdit(project, scope, ['caption', 'button'], edits).problems.length, 0);
  project.ui.components[1].propertyControls = { fontSize: { mode: 'sync', parameterId: 'shared_size' } };
  const before = structuredClone(project);
  assert.throws(() => applyUiMultiEdit(project, scope, ['caption', 'button'], edits), /参数/); assert.deepEqual(project, before);
});
