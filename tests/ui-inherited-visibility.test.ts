import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, effectiveUiComponents, projectSchema, type Project, type UiComponent } from '../src/core/model';
import { hideInheritedUiObject, removeUiObject, restoreInheritedUiObject } from '../src/core/ui-hierarchy-edit';
import { uiHierarchyDepthLimit, uiHierarchyProblems } from '../src/core/ui-hierarchy';
import { mutateProject } from '../src/core/project-mutation';

const control = (id: string, patch: Partial<UiComponent> = {}): UiComponent => ({
  id, kind: 'panel', page: 'main', text: '', x: .1, y: .1, width: .6, height: .5, ...patch,
});

function fixture() {
  const project = createProject();
  project.ui.components = [control('parent'), control('child', { kind: 'text', text: '原文字', parentId: 'parent' }), control('sibling')];
  project.ui.instances = [
    { id: 'ancestor_scheme', name: '上级方案', components: [control('ancestor_only')] },
    { id: 'active_scheme', name: '当前方案', baseUiId: 'ancestor_scheme', components: [
      control('parent', { x: .35, style: { background: '#345678' } }),
      control('child', { kind: 'text', text: '本地修改', parentId: 'parent' }),
      control('local_child', { parentId: 'child' }),
      control('local_only'),
    ] },
    { id: 'downstream_scheme', name: '下级方案', baseUiId: 'active_scheme', components: [control('late_child', { parentId: 'local_child' })] },
    { id: 'other_scheme', name: '无关方案', components: [control('other_only')] },
  ];
  project.ui.customPages = [{ id: 'custom_page', name: '自定义界面', modal: true, components: [control('custom_only', { page: 'custom' })] }];
  project.ui.activeInstanceId = 'active_scheme';
  return project;
}

const active = (project: Project) => project.ui.instances!.find(instance => instance.id === 'active_scheme')!;
const visible = (project: Project, instanceId = project.ui.activeInstanceId) => effectiveUiComponents({ ...project.ui, activeInstanceId: instanceId });

test('explicit hiding preserves local overrides and restores their authored values when shown again', () => {
  const project = fixture(), original = structuredClone(project), local = active(project).components;
  const hidden = mutateProject(project, draft => hideInheritedUiObject(draft, 'parent'));
  assert.deepEqual(project, original, 'the previous editor history snapshot remains intact');
  assert.deepEqual(active(hidden).hiddenComponentIds, ['parent']);
  assert.equal(active(hidden).components, local, 'hiding does not delete or clone authored overrides');
  assert.equal(hidden.ui.components, project.ui.components);
  assert.equal(hidden.ui.customPages, project.ui.customPages);
  assert.deepEqual(visible(hidden).map(component => component.id).sort(), ['ancestor_only', 'local_only', 'sibling']);
  assert.equal(mutateProject(hidden, draft => hideInheritedUiObject(draft, 'parent')), hidden, 'repeated hiding is a no-op');

  const restored = mutateProject(hidden, draft => { active(draft).hiddenComponentIds = active(draft).hiddenComponentIds!.filter(id => id !== 'parent'); });
  assert.equal(visible(restored).find(component => component.id === 'parent')!.x, .35);
  assert.equal(visible(restored).find(component => component.id === 'child')!.text, '本地修改');
  assert.ok(visible(restored).some(component => component.id === 'local_child'));
  assert.deepEqual(active(restored).components, local);
  assert.equal(projectSchema.safeParse(hidden).success, true);
  assert.equal(projectSchema.safeParse(restored).success, true);
});

test('hiding an inherited parent also covers descendants added in later schemes without deleting them', () => {
  const project = fixture(), before = structuredClone(project.ui.instances);
  hideInheritedUiObject(project, 'parent');
  const hiddenIds = new Set(visible(project, 'downstream_scheme').map(component => component.id));
  for (const id of ['parent', 'child', 'local_child', 'late_child']) assert.equal(hiddenIds.has(id), false, id);
  assert.ok(visible(project, 'ancestor_scheme').some(component => component.id === 'parent'), 'the source scheme stays visible');
  assert.ok(visible(project, 'other_scheme').some(component => component.id === 'parent'), 'a separate scheme stays visible');
  project.ui.instances!.forEach((instance, index) => assert.deepEqual(instance.components, before![index].components));
  active(project).hiddenComponentIds = [];
  assert.deepEqual(visible(project, 'downstream_scheme').map(component => component.id), visible({ ...project, ui: { ...project.ui, instances: before } }, 'downstream_scheme').map(component => component.id));
  assert.ok(visible(project, 'downstream_scheme').some(component => component.id === 'late_child'));
});

test('hiding works for ancestor-owned components without overrides and keeps other hidden selections', () => {
  const project = fixture();
  hideInheritedUiObject(project, 'sibling');
  hideInheritedUiObject(project, 'ancestor_only');
  assert.deepEqual(active(project).hiddenComponentIds, ['sibling', 'ancestor_only']);
  assert.equal(active(project).components.some(component => component.id === 'ancestor_only'), false);
  assert.equal(visible(project).some(component => component.id === 'ancestor_only'), false);
  assert.ok(visible(project, 'ancestor_scheme').some(component => component.id === 'ancestor_only'));
  active(project).hiddenComponentIds = active(project).hiddenComponentIds!.filter(id => id !== 'ancestor_only');
  assert.ok(visible(project).some(component => component.id === 'ancestor_only'));
  assert.equal(visible(project).some(component => component.id === 'sibling'), false);
});

test('explicit inherited hiding ignores local, foreign, custom, missing and upstream-hidden objects', () => {
  for (const id of ['local_only', 'local_child', 'other_only', 'custom_only', 'missing']) {
    const project = fixture(), before = structuredClone(project);
    hideInheritedUiObject(project, id);
    assert.deepEqual(project, before, id);
  }
  for (const activeId of [undefined, 'missing_scheme']) {
    const project = fixture(); project.ui.activeInstanceId = activeId;
    const before = structuredClone(project);
    hideInheritedUiObject(project, 'parent');
    assert.deepEqual(project, before, 'no active scheme owns a hide operation');
  }
  const project = fixture();
  project.ui.instances![0].hiddenComponentIds = ['sibling'];
  const before = structuredClone(project);
  hideInheritedUiObject(project, 'sibling');
  assert.deepEqual(project, before, 'an upstream-hidden object is not currently inherited');
});

test('existing remove behavior still restores an override rather than hiding it', () => {
  const project = fixture();
  removeUiObject(project, 'parent');
  assert.equal(active(project).components.some(component => component.id === 'parent'), false);
  assert.equal(active(project).hiddenComponentIds, undefined);
  assert.equal(visible(project).find(component => component.id === 'parent')!.x, .1);
  assert.equal(visible(project).find(component => component.id === 'child')!.text, '本地修改');
  removeUiObject(project, 'parent');
  assert.deepEqual(active(project).hiddenComponentIds, ['parent']);
  assert.equal(visible(project).some(component => component.id === 'parent'), false);
});

test('restoring an inherited override changes only that local record and preserves authored descendants', () => {
  const project = fixture();
  active(project).hiddenComponentIds = ['sibling'];
  const before = structuredClone(project), priorActive = active(project);
  const restored = mutateProject(project, draft => restoreInheritedUiObject(draft, 'parent'));
  assert.deepEqual(project, before, 'the earlier history snapshot remains intact');
  assert.deepEqual(active(restored).components, priorActive.components.filter(component => component.id !== 'parent'));
  assert.equal(active(restored).components.find(component => component.id === 'child'), priorActive.components.find(component => component.id === 'child'));
  assert.equal(active(restored).hiddenComponentIds, priorActive.hiddenComponentIds);
  assert.equal(restored.ui.components, project.ui.components);
  assert.equal(restored.ui.customPages, project.ui.customPages);
  for (const instance of project.ui.instances!.filter(instance => instance.id !== priorActive.id)) {
    assert.equal(restored.ui.instances!.find(item => item.id === instance.id), instance);
  }
  assert.equal(visible(restored).find(component => component.id === 'parent')!.x, .1);
  assert.equal(visible(restored).find(component => component.id === 'child')!.text, '本地修改');
  assert.ok(visible(restored, 'downstream_scheme').some(component => component.id === 'late_child'));
  assert.equal(projectSchema.safeParse(restored).success, true);
  assert.equal(mutateProject(restored, draft => restoreInheritedUiObject(draft, 'parent')), restored, 'restoring an already inherited value is a no-op');
});

test('restoring ignores non-overrides, foreign objects and unavailable inherited sources', () => {
  for (const id of ['local_only', 'local_child', 'sibling', 'ancestor_only', 'other_only', 'custom_only', 'missing']) {
    const project = fixture(), before = structuredClone(project);
    restoreInheritedUiObject(project, id);
    assert.deepEqual(project, before, id);
  }
  for (const activeId of [undefined, 'missing_scheme']) {
    const project = fixture(); project.ui.activeInstanceId = activeId;
    assert.equal(mutateProject(project, draft => restoreInheritedUiObject(draft, 'parent')), project);
  }
  const project = fixture();
  project.ui.instances![0].hiddenComponentIds = ['parent'];
  const before = structuredClone(project);
  restoreInheritedUiObject(project, 'parent');
  assert.deepEqual(project, before, 'a local component whose inherited source is hidden must not be removed');
});

function hierarchyFixture() {
  const project = createProject();
  project.ui.components = [
    control('panel_a', { name: '面板 A' }),
    control('panel_b', { name: '面板 B', parentId: 'panel_a' }),
  ];
  project.ui.instances = [{ id: 'active_scheme', name: '当前方案', components: [control('panel_b', { name: '面板 B' })] }];
  project.ui.activeInstanceId = 'active_scheme';
  return project;
}

test('restoring rejects a parent cycle without mutating either a mutable project or a history draft', () => {
  const project = hierarchyFixture();
  active(project).components.push(control('panel_a', { name: '面板 A', parentId: 'panel_b' }));
  assert.equal(projectSchema.safeParse(project).success, true, 'the authored reparenting is valid before restoration');
  const before = structuredClone(project), local = active(project).components;
  assert.throws(() => restoreInheritedUiObject(project, 'panel_b'), /当前方案.*面板 A.*层级不能循环/);
  assert.deepEqual(project, before);
  assert.equal(active(project).components, local);
  assert.throws(() => mutateProject(project, draft => restoreInheritedUiObject(draft, 'panel_b')), /层级不能循环/);
  assert.deepEqual(project, before);
  assert.throws(() => removeUiObject(project, 'panel_b'), /层级不能循环/, 'keyboard removal uses the same safe restore behavior');
  assert.deepEqual(project, before);
});

test('restoring checks indirect descendants even when the active scheme itself would remain valid', () => {
  const project = hierarchyFixture();
  project.ui.instances!.unshift({ id: 'leaf_scheme', name: '两级派生方案', baseUiId: 'middle_scheme', components: [control('panel_a', { name: '派生面板 A', parentId: 'panel_b' })] });
  project.ui.instances!.push({ id: 'middle_scheme', name: '中间方案', baseUiId: 'active_scheme', components: [] });
  assert.equal(projectSchema.safeParse(project).success, true);
  const before = structuredClone(project);
  assert.throws(() => restoreInheritedUiObject(project, 'panel_b'), /两级派生方案.*派生面板 A.*层级不能循环/);
  assert.deepEqual(project, before, 'a conflict in a descendant cannot partially restore the active scheme');

  project.ui.instances!.find(instance => instance.id === 'middle_scheme')!.components.push(control('panel_b', { name: '派生面板 B' }));
  restoreInheritedUiObject(project, 'panel_b');
  assert.equal(visible(project).find(component => component.id === 'panel_b')!.parentId, 'panel_a');
  assert.equal(visible(project, 'leaf_scheme').find(component => component.id === 'panel_b')!.parentId, undefined, 'a descendant override still masks the restored value');
  assert.equal(visible(project, 'leaf_scheme').find(component => component.id === 'panel_a')!.parentId, 'panel_b');
  assert.equal(projectSchema.safeParse(project).success, true);
});

test('restoring rejects a cross-page parent or a missing inherited parent before writing', () => {
  const project = hierarchyFixture();
  active(project).components.push(control('panel_a', { name: '面板 A', page: 'say' }));
  assert.equal(projectSchema.safeParse(project).success, true);
  const before = structuredClone(project);
  assert.throws(() => restoreInheritedUiObject(project, 'panel_b'), /当前方案.*面板 B.*父对象必须在同一页面/);
  assert.deepEqual(project, before);

  const missingParent = hierarchyFixture();
  missingParent.ui.components[1].parentId = 'missing_parent';
  assert.deepEqual(uiHierarchyProblems(visible(missingParent)), [], 'the local override masks an invalid imported parent');
  const missingBefore = structuredClone(missingParent);
  assert.throws(() => restoreInheritedUiObject(missingParent, 'panel_b'), /当前方案.*面板 B.*父对象不存在/);
  assert.deepEqual(missingParent, missingBefore);
});

test('restoring rejects excessive effective depth introduced by retaining local children', () => {
  const project = createProject();
  project.ui.components = Array.from({ length: uiHierarchyDepthLimit }, (_, index) => control(`level_${index}`, index ? { parentId: `level_${index - 1}` } : {}));
  const lastId = project.ui.components.at(-1)!.id;
  project.ui.instances = [{ id: 'active_scheme', name: '当前方案', components: [control(lastId), control('local_child', { name: '新增子对象', parentId: lastId })] }];
  project.ui.activeInstanceId = 'active_scheme';
  assert.equal(projectSchema.safeParse(project).success, true);
  const before = structuredClone(project);
  assert.throws(() => restoreInheritedUiObject(project, lastId), /当前方案.*新增子对象.*层级不能超过/);
  assert.deepEqual(project, before);
});

test('restoring uses effective visibility without changing hidden markers or another scheme', () => {
  const project = hierarchyFixture();
  active(project).hiddenComponentIds = ['panel_a'];
  project.ui.instances!.push({ id: 'unrelated_scheme', name: '无关方案', components: [control('broken', { parentId: 'absent' })] });
  const unrelated = project.ui.instances!.at(-1), hidden = active(project).hiddenComponentIds;
  assert.deepEqual(visible(project).map(component => component.id), ['panel_b']);
  restoreInheritedUiObject(project, 'panel_b');
  assert.deepEqual(visible(project), [], 'the restored child follows its hidden inherited parent');
  assert.equal(active(project).hiddenComponentIds, hidden);
  assert.equal(project.ui.instances!.at(-1), unrelated, 'unrelated drafts neither block restoration nor get rewritten');
});

test('restoring permits existing unrelated hierarchy problems while preserving their authored records', () => {
  const project = hierarchyFixture();
  const invalid = control('broken', { name: '待修控件', parentId: 'absent' });
  active(project).components.push(invalid);
  restoreInheritedUiObject(project, 'panel_b');
  assert.deepEqual(active(project).components, [invalid]);
  assert.equal(active(project).components[0], invalid);
  assert.deepEqual(uiHierarchyProblems(visible(project)), [{ id: 'broken', message: '父对象不存在。' }]);
});

test('restoring still rejects changes to an already invalid chain and permits a repair', () => {
  const project = hierarchyFixture();
  project.ui.components[1].parentId = 'new_missing_parent';
  active(project).components[0].parentId = 'old_missing_parent';
  const before = structuredClone(project);
  assert.throws(() => restoreInheritedUiObject(project, 'panel_b'), /父对象不存在/);
  assert.deepEqual(project, before, 'the same error label is not a reason to accept a different invalid parent chain');
  project.ui.components[1].parentId = 'panel_a';
  restoreInheritedUiObject(project, 'panel_b');
  assert.equal(projectSchema.safeParse(project).success, true, 'restoration can repair an invalid local override');
});
