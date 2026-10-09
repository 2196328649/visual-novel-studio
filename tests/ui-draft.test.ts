import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { applyUiDraft, uiDraftChanged } from '../src/core/ui-draft';

test('UI draft preserves concurrent imports and unrelated edits, including keyed collections', () => {
  const base = createProject();
  base.ui.components.push({ id: 'test_text', page: 'main', kind: 'text', text: '原文', x: 0, y: 0, width: .2, height: .1 });
  const value = structuredClone(base), current = structuredClone(base);
  value.ui.fontSize = 48;
  value.ui.components[0].text = '草稿标题';
  current.name = '新的工程名称';
  current.assets.push({ id: 'imported', name: '图片', kind: 'image', path: 'assets/image.png' });
  current.ui.components[0].x = .123;
  const draft = { base, value }, merged = applyUiDraft(current, draft);
  assert.equal(merged.ui.fontSize, 48);
  assert.equal(merged.ui.components[0].text, '草稿标题');
  assert.equal(merged.ui.components[0].x, .123);
  assert.equal(merged.name, current.name);
  assert.equal(merged.assets.at(-1)?.id, 'imported');
  assert.notEqual(base.ui.components[0].text, '草稿标题');
  assert.equal(applyUiDraft(current), current);
  assert.equal(uiDraftChanged(draft), true);
  assert.equal(uiDraftChanged({ base, value: structuredClone(base) }), false);
});

test('UI draft applies added and deleted controls without deleting concurrent additions', () => {
  const base = createProject();
  base.ui.components.push({ id: 'test_text', page: 'main', kind: 'text', text: '原文', x: 0, y: 0, width: .2, height: .1 });
  const value = structuredClone(base), current = structuredClone(base);
  const deleted = value.ui.components.shift()!;
  value.ui.components.push({ ...deleted, id: 'draft_new' });
  current.ui.components.push({ ...deleted, id: 'concurrent_new' });
  const merged = applyUiDraft(current, { base, value });
  assert.equal(merged.ui.components.some(c => c.id === deleted.id), false);
  assert.equal(merged.ui.components.some(c => c.id === 'draft_new'), true);
  assert.equal(merged.ui.components.some(c => c.id === 'concurrent_new'), true);
});

test('UI draft preserves authored group order and insertion alongside concurrent changes', () => {
  const base = createProject();
  base.ui.components.push({ id: 'gallery', page: 'gallery', kind: 'galleryGrid', text: '', x: 0, y: 0, width: 1, height: 1 });
  base.ui.components[0].list = { galleryGroups: ['a', 'b', 'c'].map(id => ({ id, name: id, assetIds: [] })) };
  const value = structuredClone(base), current = structuredClone(base);
  const [a, b, c] = value.ui.components[0].list!.galleryGroups!;
  value.ui.components[0].list!.galleryGroups = [c, { id: 'added', name: '新增', assetIds: [] }, a, b];
  current.ui.components[0].list!.galleryGroups![0].name = '外部改名';
  current.ui.components[0].list!.galleryGroups!.push({ id: 'external', name: '外部新增', assetIds: [] });
  const merged = applyUiDraft(current, { base, value }).ui.components[0].list!.galleryGroups!;
  assert.deepEqual(merged.map(item => item.id), ['c', 'added', 'a', 'b', 'external']);
  assert.equal(merged[2].name, '外部改名');
  assert.deepEqual(base.ui.components[0].list!.galleryGroups!.map(item => item.id), ['a', 'b', 'c']);
});

test('UI draft property changes preserve concurrent reordering and do not restore externally removed groups', () => {
  const base = createProject();
  base.ui.components.push({ id: 'gallery', page: 'gallery', kind: 'galleryGrid', text: '', x: 0, y: 0, width: 1, height: 1 });
  base.ui.components[0].list = { galleryGroups: ['a', 'b', 'c'].map(id => ({ id, name: id, assetIds: [] })) };
  const value = structuredClone(base), current = structuredClone(base);
  value.ui.components[0].list!.galleryGroups![0].name = '草稿改名';
  current.ui.components[0].list!.galleryGroups!.reverse();
  const merged = applyUiDraft(current, { base, value }).ui.components[0].list!.galleryGroups!;
  assert.deepEqual(merged.map(item => item.id), ['c', 'b', 'a']);
  assert.equal(merged[2].name, '草稿改名');
  value.ui.components[0].list!.galleryGroups!.reverse();
  current.ui.components[0].list!.galleryGroups!.splice(1, 1);
  assert.deepEqual(applyUiDraft(current, { base, value }).ui.components[0].list!.galleryGroups!.map(item => item.id), ['c', 'a']);
});
