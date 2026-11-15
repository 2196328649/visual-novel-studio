import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { applyUiDraft, uiDraftChanged } from '../src/core/ui-draft';
import { mutateProject } from '../src/core/project-mutation';

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

test('accepting an already saved UI snapshot preserves changes made while disk I/O was pending', () => {
  const base = createProject();
  const snapshot = mutateProject(base, draft => { draft.ui.fontSize = 44; });
  const current = mutateProject(base, draft => {
    draft.assets.push({ id: 'late_import', name: '保存期间的素材', kind: 'image', path: 'assets/late.png' });
    draft.nodes.find(node => node.kind === 'passage')!.lines[0].text = '保存期间编辑的台词';
  });
  const accepted = applyUiDraft(current, { base, value: snapshot });
  assert.equal(accepted.ui.fontSize, 44);
  assert.equal(accepted.assets, current.assets);
  assert.equal(accepted.nodes, current.nodes);
  assert.notEqual(accepted, snapshot, 'the live project must stay dirty relative to the saved snapshot');
  assert.equal(snapshot.assets.some(asset => asset.id === 'late_import'), false, 'do not pretend late assets reached the earlier save');
});

test('immutable UI drafts reuse their snapshots and untouched concurrent branches', () => {
  const base = createProject();
  const value = mutateProject(base, draft => { draft.ui.fontSize = 44; });
  const draft = { base, value };
  assert.equal(applyUiDraft(base, draft), value);
  const current = mutateProject(base, project => { project.assets.push({ id: 'new', name: 'new', kind: 'image', path: 'assets/new.png' }); });
  const merged = applyUiDraft(current, draft);
  assert.equal(merged.assets, current.assets);
  assert.equal(merged.nodes, base.nodes);
  assert.equal(merged.ui.fontSize, 44);
  assert.equal(uiDraftChanged(draft), true);
  assert.equal(uiDraftChanged({ base, value: base }), false);
  assert.equal(applyUiDraft(current, { base, value: base }), current);
  assert.notEqual(base.ui.fontSize, 44);
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

test('custom player-flow entries merge by unique nodeId and preserve concurrent adds and fields', () => {
  const base = createProject();
  base.ui.components.push({ id: 'flow_map', kind: 'flowchart', page: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1,
    list: { layout: 'flow', flowContent: { mode: 'custom', custom: { entries: [
      { nodeId: 'node_a', owner: { kind: 'node', id: 'owner_a' }, name: '原名', styleId: 'style_a', action: 'replay' },
    ] } } } });
  const value = structuredClone(base), current = structuredClone(base);
  const draftEntries = value.ui.components.at(-1)!.list!.flowContent!.custom!.entries;
  const externalEntries = current.ui.components.at(-1)!.list!.flowContent!.custom!.entries;
  draftEntries[0].name = '草稿改名';
  draftEntries.push({ nodeId: 'node_draft', name: '草稿新增' });
  externalEntries[0].name = '外部冲突改名';
  externalEntries[0].styleId = 'style_external';
  delete externalEntries[0].action;
  externalEntries.push({ nodeId: 'node_external', name: '外部新增' });
  current.nodes.push({ id: 'node_external', sceneId: current.scenes[0].id, name: '外部剧本节点', kind: 'passage', x: 10, y: 20, lines: [{ id: 'line_external', text: '外部剧本正文', actions: [] }] });
  current.scriptText = { format: 'vns-text-1', content: '#章节：外部剧本同步' };

  const merged = applyUiDraft(current, { base, value });
  const entries = merged.ui.components.at(-1)!.list!.flowContent!.custom!.entries;
  assert.deepEqual(entries.map(entry => entry.nodeId), ['node_a', 'node_draft', 'node_external']);
  assert.equal(entries[0].name, '草稿改名', 'same-field conflicts retain the draft-wins rule');
  assert.equal(entries[0].styleId, 'style_external', 'independent fields from current state survive');
  assert.equal(entries[0].action, undefined, 'concurrent field removal survives when the draft did not edit it');
  assert.ok(merged.nodes.some(node => node.id === 'node_external'), 'a concurrent script parse keeps its new destination');
  assert.equal(merged.scriptText?.content, current.scriptText.content);
});

test('custom player-flow entry deletion wins over a concurrent edit in either direction', () => {
  const base = createProject();
  base.ui.components.push({ id: 'flow_map', kind: 'flowchart', page: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1,
    list: { layout: 'flow', flowContent: { mode: 'custom', custom: { entries: [
      { nodeId: 'node_draft_delete', name: '待删除' }, { nodeId: 'node_external_delete', name: '外部待删除' },
    ] } } } });
  const value = structuredClone(base), current = structuredClone(base);
  const draftEntries = value.ui.components.at(-1)!.list!.flowContent!.custom!.entries;
  const externalEntries = current.ui.components.at(-1)!.list!.flowContent!.custom!.entries;
  draftEntries.splice(0, 1);
  draftEntries[0].name = '草稿改名';
  externalEntries[0].name = '外部改名';
  externalEntries.splice(1, 1);

  const entries = applyUiDraft(current, { base, value }).ui.components.at(-1)!.list!.flowContent!.custom!.entries;
  assert.deepEqual(entries, [], 'draft deletion and concurrent deletion both remain deleted');
});

test('custom player-flow entries with duplicate nodeIds are not keyed-merged', () => {
  const base = createProject();
  base.ui.components.push({ id: 'flow_map', kind: 'flowchart', page: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1,
    list: { layout: 'flow', flowContent: { mode: 'custom', custom: { entries: [
      { nodeId: 'duplicate_node', name: '第一项' }, { nodeId: 'duplicate_node', name: '第二项' },
    ] } } } });
  const value = structuredClone(base), current = structuredClone(base);
  value.ui.components.at(-1)!.list!.flowContent!.custom!.entries[0].name = '草稿改名';
  current.ui.components.at(-1)!.list!.flowContent!.custom!.entries.push({ nodeId: 'external_node', name: '外部新增' });

  const entries = applyUiDraft(current, { base, value }).ui.components.at(-1)!.list!.flowContent!.custom!.entries;
  assert.deepEqual(entries.map(entry => entry.nodeId), ['duplicate_node', 'duplicate_node', 'external_node']);
  assert.equal(entries[0].name, '第一项', 'ambiguous identities preserve the current list instead of overwriting it');
});
