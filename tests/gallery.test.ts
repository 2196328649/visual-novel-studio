import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { galleryEntries, galleryPagination, galleryRuntimeEntries } from '../src/core/gallery';
import { validateProject } from '../src/core/validate';
import { readAiProject } from '../src/core/ai-project-read';
import { applyProjectEdit, finalizeProjectEdits } from '../src/core/ai-project-edit';
import { aihongGalleryGroups } from '../scripts/lib/aihong-gallery';

function fixture() {
  const project = createProject();
  project.assets = ['a', 'b', 'c', 'thumb'].map(id => ({ id, name: id, kind: 'image', path: `assets\\${id}.png` }));
  const component: UiComponent = { id: 'gallery', kind: 'galleryGrid', page: 'gallery', text: '', x: 0, y: 0, width: 1, height: 1, list: { assetIds: ['c', 'a'], galleryGroups: [{ id: 'group', name: '同组分镜', thumbnailAssetId: 'thumb', assetIds: ['b', 'c', 'a'] }] } };
  project.ui.components.push(component);
  return { project, component };
}

test('gallery group order, independent thumbnail and explicit emptiness survive serialization', () => {
  const { project, component } = fixture();
  const parsed = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(galleryEntries(parsed, component), component.list!.galleryGroups);
  assert.deepEqual(galleryRuntimeEntries(parsed, component), [{ id: 'group', name: '同组分镜', thumbnailPath: 'assets/thumb.png', variants: [{ id: 'b', path: 'assets/b.png' }, { id: 'c', path: 'assets/c.png' }, { id: 'a', path: 'assets/a.png' }] }]);
  component.list!.galleryGroups = [];
  assert.deepEqual(galleryEntries(project, component), []);
  delete component.list!.galleryGroups;
  assert.deepEqual(galleryEntries(project, component).map(item => item.id), ['c', 'a']);
  delete component.list!.assetIds;
  assert.deepEqual(galleryEntries(project, component).map(item => item.id), ['a', 'b', 'c', 'thumb']);
});

test('gallery validation locates missing and wrong-kind references, duplicate identities and empty groups', () => {
  const { project, component } = fixture();
  project.assets.push({ id: 'audio', kind: 'audio', name: 'audio', path: 'assets/a.wav' });
  component.list!.galleryGroups = [{ id: 'group', name: '坏分组', thumbnailAssetId: 'absent', assetIds: ['audio'] }, { id: 'group', name: '空分组', assetIds: [] }];
  const diagnostics = validateProject(project);
  for (const text of ['absent', 'audio', 'ID 不能重复', '还没有分镜']) {
    const diagnostic = diagnostics.find(item => item.message.includes(text));
    assert.ok(diagnostic, text); assert.equal(diagnostic.ui?.componentId, 'gallery');
  }
  component.list!.galleryGroups = [{ id: 'one', name: '重复图片', assetIds: ['a', 'a'] }];
  assert.equal(projectSchema.safeParse(project).success, false);
});

test('gallery pagination keeps 12 complete page labels or a bounded window on the last page', () => {
  assert.deepEqual(galleryPagination(12, 0, 12), { page: 0, overflow: false, numbers: Array.from({ length: 12 }, (_, i) => i) });
  assert.deepEqual(galleryPagination(12, 11, 9), { page: 11, overflow: true, numbers: [3, 4, 5, 6, 7, 8, 9, 10, 11] });
  assert.deepEqual(galleryPagination(1, 11, 12), { page: 0, overflow: false, numbers: [0] });
});

test('AI can read the group schema, locate groups by ID and change their thumbnail and sequence', () => {
  const { project } = fixture();
  const base = ['ui', 'components', { id: 'gallery' }, 'list', 'galleryGroups'];
  const read: any = readAiProject(project, [], { kind: 'project', path: [...base, { id: 'group' }] });
  assert.deepEqual(read.value.assetIds, ['b', 'c', 'a']);
  const schema = JSON.stringify(readAiProject(project, [], { kind: 'schema', field: 'ui' }));
  for (const field of ['galleryGroups', 'thumbnailAssetId', 'galleryEndAction']) assert.ok(schema.includes(field));
  applyProjectEdit(project, { kind: 'editProject', path: [...base, { id: 'group' }, 'assetIds'], action: 'set', value: ['a', 'c'] });
  applyProjectEdit(project, { kind: 'editProject', path: [...base, { id: 'group' }, 'thumbnailAssetId'], action: 'set', value: 'b' });
  const result = finalizeProjectEdits(project);
  assert.deepEqual(result.ui.components.find(c => c.id === 'gallery')!.list!.galleryGroups![0], { id: 'group', name: '同组分镜', thumbnailAssetId: 'b', assetIds: ['a', 'c'] });
  assert.deepEqual(validateProject(result).filter(d => d.severity === 'error'), []);
});

test('original CG import never guesses among duplicate resource paths', () => {
  const assets = ['a', 'b'].map((id, i) => ({ id, name: id, kind: 'image' as const, path: `assets/${id}.webp`, resourcePath: 'event/cg', sourcePathId: i + 1 }));
  const manifest = { assets, groupCount: 1, variantCount: 1, groups: [{ id: 'group', name: '图鉴', thumbnail: { resourcePath: 'event/cg', candidates: ['a', 'b'] }, variants: [{ label: '分镜', resourcePath: 'event/cg', candidates: ['a', 'b'] }] }] };
  assert.throws(() => aihongGalleryGroups(manifest), /需要确认版本/);
  assert.throws(() => aihongGalleryGroups(manifest, { 'event/cg': 'missing' }), /需要确认版本/);
  const result = aihongGalleryGroups(manifest, { 'event/cg': 'b' });
  assert.deepEqual(result.groups[0].assetIds, ['b']);
  assert.equal(result.groups[0].thumbnailAssetId, 'b');
  assert.equal(result.assets.length, 1);
  assert.equal(result.assets[0].sourcePath, 'event/cg#resources.assets:2');
});
