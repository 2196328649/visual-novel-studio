import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, projectSchema, type Project, type UiComponent } from '../src/core/model';
import { playerFlowAllEntries, playerFlowMissingEntries } from '../src/core/player-flow-content';
import { repairPlayerFlowEntry } from '../src/core/player-flow-authoring';
import { applyTextScript, projectToText } from '../src/core/text-script';

const map = (): UiComponent => ({
  id: 'custom_map', kind: 'flowchart', page: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1,
  list: { layout: 'flow' },
});

function parse(project: Project, source: string): Project {
  const parsed = applyTextScript(project, source);
  assert.deepEqual(parsed.issues, []);
  return parsed.project;
}

const reopen = (project: Project) => projectSchema.parse(JSON.parse(JSON.stringify(project)));
const retainedText = '#章节：第一章\n#小章节：街道\n#段落：开场\n旁白：保留正文';
const shopText = (body: string, identity = '') => `${retainedText}\n#段落：商店${identity}\n旁白：${body}`;
const shop = (project: Project) => project.nodes.find(node => node.kind === 'passage' && node.name === '商店')!;

function rememberEntry(component: UiComponent, nodeId: string) {
  component.list!.flowContent = { mode: 'custom', custom: {
    entries: [{ nodeId, owner: { kind: 'node', id: nodeId }, name: '旧商店本图名称', styleId: 'retained_style', action: 'inspect' }],
    positions: { [nodeId]: { x: 120, y: 240 } },
    groups: [{ id: 'saved_group', name: '保留分组', nodeIds: [nodeId], position: { x: 500, y: 300 }, positions: { [nodeId]: { x: 30, y: 40 } } }],
  } };
}

function configuredControls(project: Project) {
  return [project.ui.components[0], ...project.ui.instances!.map(instance => instance.components[0]), project.ui.customPages[0].components[0]];
}

function configureContainers(project: Project) {
  project.ui.components = [map()];
  project.ui.instances = [
    { id: 'parent_scheme', name: '父方案', components: [map()] },
    { id: 'active_scheme', name: '当前方案', baseUiId: 'parent_scheme', components: [map()] },
    { id: 'inactive_scheme', name: '其他方案', components: [map()] },
  ];
  project.ui.activeInstanceId = 'active_scheme';
  // Flowcharts belong to the built-in flowchart page. A legal custom-page panel
  // can still retain inactive flowContent in saved data, whose references matter.
  project.ui.customPages = [{ id: 'extra_page', name: '自定义页', modal: true, components: [{ ...map(), kind: 'panel', page: 'custom' }] }];
}

test('script removal keeps the pinned custom reference until an explicit repair retargets it', () => {
  const parsed = applyTextScript(createProject(), '#章节：第一章\n旁白：开场\n#段落：旧入口\n旁白：旧正文');
  assert.deepEqual(parsed.issues, []);
  const project = parsed.project, component = map();
  const target = project.nodes.find(node => node.kind === 'passage' && node.name === '旧入口')!;
  const owner = { kind: 'node' as const, id: target.id };
  component.list!.flowContent = { mode: 'custom', custom: {
    entries: [{ nodeId: target.id, owner, name: '本图保存的标题', styleId: 'local_style', action: 'inspect' }],
    positions: { [target.id]: { x: 120, y: 240 } },
    groups: [{ id: 'old_group', name: '已保存分组', nodeIds: [target.id], positions: { [target.id]: { x: 30, y: 40 } } }],
  } };
  project.ui.components.push(component);
  const saved = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  const removed = applyTextScript(saved, '#章节：第一章\n旁白：开场\n#段落：新入口\n旁白：新正文');

  assert.deepEqual(removed.issues, []);
  const synchronized = removed.project.ui.components.find(item => item.id === component.id)!;
  assert.deepEqual(synchronized.list?.flowContent, component.list?.flowContent);
  assert.deepEqual(playerFlowMissingEntries(removed.project, synchronized).map(item => item.reason), ['node']);
  assert.equal(playerFlowAllEntries(removed.project, synchronized).some(entry => entry.id === target.id), false);
  const replacement = removed.project.nodes.find(node => node.kind === 'passage' && node.name === '新入口')!;
  assert.notEqual(replacement.id, target.id, 'a new script target must not capture the saved identity implicitly');

  assert.equal(repairPlayerFlowEntry(removed.project, synchronized, target.id, { kind: 'node', id: replacement.id }), true);
  assert.deepEqual(playerFlowMissingEntries(removed.project, synchronized), []);
  assert.deepEqual(synchronized.list?.flowContent?.custom?.entries[0], {
    nodeId: replacement.id, owner: { kind: 'node', id: replacement.id },
    name: '本图保存的标题', styleId: 'local_style', action: 'inspect',
  });
  assert.deepEqual(synchronized.list?.flowContent?.custom?.positions?.[replacement.id], { x: 120, y: 240 });
  assert.deepEqual(synchronized.list?.flowContent?.custom?.groups?.[0]?.nodeIds, [replacement.id]);
  assert.deepEqual(synchronized.list?.flowContent?.custom?.groups?.[0]?.positions?.[replacement.id], { x: 30, y: 40 });
});

for (const [index, container] of ['overridden base', 'overridden parent', 'active scheme', 'inactive scheme', 'custom-page retained configuration'].entries()) {
  for (const mode of ['custom', 'script'] as const) {
    test(`recreating a deleted name cannot capture a saved entry in ${container}, ${mode} mode`, () => {
      const original = parse(createProject(), shopText('旧商店正文'));
      configureContainers(original);
      const oldId = shop(original).id, component = configuredControls(original)[index];
      rememberEntry(component, oldId);
      component.list!.flowContent!.mode = mode;
      const content = structuredClone(component.list!.flowContent);

      const removed = reopen(parse(original, retainedText));
      assert.deepEqual(playerFlowMissingEntries(removed, configuredControls(removed)[index]).map(item => item.reason), ['node']);
      const recreated = parse(removed, shopText('完全不同的新正文'));
      const restored = configuredControls(recreated)[index];
      assert.notEqual(shop(recreated).id, oldId);
      assert.deepEqual(restored.list?.flowContent, content, 'the missing entry keeps its text, action, preset, group and all positions');
      assert.deepEqual(playerFlowMissingEntries(recreated, restored).map(item => item.entry.nodeId), [oldId]);
      if (mode === 'custom') assert.deepEqual(playerFlowAllEntries(recreated, restored), []);
    });
  }
}

test('replacement identities are deterministic, stay stable on sync, and survive repeated deletion without reviving older entries', () => {
  let project = parse(createProject(), shopText('最初正文'));
  project.ui.components.push(map());
  const ids: string[] = [];
  for (let generation = 0; generation < 3; generation++) {
    const oldId = shop(project).id;
    ids.push(oldId);
    const component = project.ui.components[0];
    component.list!.flowContent ??= { mode: 'custom', custom: { entries: [] } };
    component.list!.flowContent.custom!.entries.push({ nodeId: oldId, name: `第${generation + 1}代商店` });
    const removed = reopen(parse(project, retainedText));
    const source = shopText(`第${generation + 2}代正文`);
    const recreated = parse(removed, source), nextId = shop(recreated).id;
    assert.equal(ids.includes(nextId), false, 'every retained missing generation remains reserved');
    assert.equal(shop(parse(removed, source)).id, nextId, 'the same input and text allocate the same identity');
    assert.equal(shop(parse(reopen(recreated), source)).id, nextId, 'unmarked source keeps the matched live identity');
    project = parse(reopen(recreated), projectToText(recreated));
    assert.equal(shop(project).id, nextId, 'serialized explicit identity survives save and script synchronization');
    assert.deepEqual(playerFlowMissingEntries(project, project.ui.components[0]).map(item => item.entry.nodeId), ids);
  }

  const component = project.ui.components[0], replacementId = shop(project).id;
  assert.equal(repairPlayerFlowEntry(project, component, ids[0], { kind: 'node', id: replacementId }), true);
  assert.deepEqual(playerFlowAllEntries(project, component).map(entry => entry.id), [replacementId]);
  assert.deepEqual(playerFlowMissingEntries(project, component).map(item => item.entry.nodeId), ids.slice(1));
});

for (const referenced of [true, false]) {
  test(`a new identity avoids a live ${referenced ? 'referenced' : 'unreferenced'} replacement renamed and placed later in the script`, () => {
    const original = parse(createProject(), shopText('旧正文')), oldId = shop(original).id;
    const component = map();
    rememberEntry(component, oldId);
    original.ui.components.push(component);
    const removed = reopen(parse(original, retainedText));
    const replaced = parse(removed, shopText('替代店正文')), replacementId = shop(replaced).id;
    const renamedText = `#段落：新店【${replacementId}】\n旁白：替代店正文`;
    const renamed = parse(replaced, `${retainedText}\n${renamedText}`);
    if (referenced) renamed.ui.components[0].list!.flowContent!.custom!.entries.push({ nodeId: replacementId });

    const added = parse(reopen(renamed), `${shopText('新建第三家店的正文')}\n${renamedText}`);
    const newId = shop(added).id;
    assert.equal([oldId, replacementId].includes(newId), false);
    assert.equal(added.nodes.find(node => node.name === '新店')?.id, replacementId);
    assert.equal(added.nodes.filter(node => node.id === replacementId).length, 1);
    assert.deepEqual(playerFlowAllEntries(added, added.ui.components[0]).map(entry => [entry.nodeId, entry.name]), referenced ? [[replacementId, '新店']] : []);
    assert.deepEqual(playerFlowMissingEntries(added, added.ui.components[0]).map(item => item.entry.nodeId), [oldId]);
  });
}

test('ordinary synchronization keeps live node, scene and chapter references with their existing identities', () => {
  const source = shopText('正文'), original = parse(createProject(), source), target = shop(original);
  const scene = original.scenes.find(scene => scene.id === target.sceneId)!;
  original.ui.components = [
    { ...map(), id: 'node_map', list: { flowContent: { mode: 'custom', custom: { entries: [{ nodeId: target.id, owner: { kind: 'node', id: target.id } }] } } } },
    { ...map(), id: 'scene_map', list: { flowContent: { mode: 'script', custom: { entries: [{ nodeId: target.id, owner: { kind: 'scene', id: scene.id } }] } } } },
    { ...map(), id: 'chapter_map', list: { flowContent: { mode: 'custom', custom: { entries: [{ nodeId: original.entryId, owner: { kind: 'chapter', id: scene.chapterId } }] } } } },
  ];
  const identities = (project: Project) => [project.entryId, project.chapters.map(item => item.id), project.scenes.map(item => item.id), project.nodes.map(item => item.id)];
  const raw = parse(reopen(original), source), serialized = parse(reopen(raw), projectToText(raw));
  for (const synchronized of [raw, serialized]) {
    assert.deepEqual(identities(synchronized), identities(original));
    assert.deepEqual(synchronized.ui.components, original.ui.components);
    assert.ok(synchronized.ui.components.every(component => playerFlowMissingEntries(synchronized, component).length === 0));
  }
});

for (const marker of ['heading', 'node marker'] as const) {
  test(`an explicit ${marker} can restore the original identity deliberately`, () => {
    const original = parse(createProject(), shopText('旧商店正文'));
    const component = map(), oldId = shop(original).id;
    rememberEntry(component, oldId);
    original.ui.components.push(component);
    const removed = reopen(parse(original, retainedText));
    const source = marker === 'heading' ? shopText('明确恢复的正文', `【${oldId}】`)
      : `${retainedText}\n@节点标记：商店【${oldId}】\n旁白：明确恢复的正文`;
    const restored = parse(removed, source), restoredMap = restored.ui.components[0];
    assert.equal(shop(restored).id, oldId);
    assert.deepEqual(restoredMap.list?.flowContent, component.list?.flowContent);
    assert.deepEqual(playerFlowMissingEntries(restored, restoredMap), []);
    assert.equal(playerFlowAllEntries(restored, restoredMap)[0].name, '旧商店本图名称');
  });
}

for (const kind of ['chapter', 'scene'] as const) {
  test(`a deleted ${kind} owner stays missing while its pinned passage survives, until explicit owner restoration`, () => {
    const retained = '#章节：保留章节\n#小章节：保留小节\n#段落：开场\n旁白：保留正文';
    const ownerHeading = kind === 'chapter' ? '#章节：旧章节\n#小章节：旧小节' : '#小章节：旧小节';
    const original = parse(createProject(), `${retained}\n${ownerHeading}\n#段落：商店\n旁白：旧正文`);
    const target = shop(original), oldScene = original.scenes.find(scene => scene.id === target.sceneId)!;
    const oldOwner = kind === 'chapter' ? original.chapters.find(chapter => chapter.id === oldScene.chapterId)! : oldScene;
    const component = map();
    rememberEntry(component, target.id);
    component.list!.flowContent!.custom!.entries[0].owner = { kind, id: oldOwner.id };
    original.ui.components.push(component);

    const movedText = `${retained}\n#段落：商店【${target.id}】\n旁白：保留在其他小节的商店`;
    const removed = reopen(parse(original, movedText));
    assert.deepEqual(playerFlowMissingEntries(removed, removed.ui.components[0]).map(item => item.reason), ['owner']);
    const recreated = parse(removed, `${movedText}\n${ownerHeading}\n#段落：新入口\n旁白：新正文`);
    const newOwner = kind === 'chapter' ? recreated.chapters.find(chapter => chapter.name === '旧章节')!
      : recreated.scenes.find(scene => scene.name === '旧小节')!;
    assert.notEqual(newOwner.id, oldOwner.id);
    assert.equal(shop(recreated).id, target.id, 'the existing passage is never remapped');
    assert.deepEqual(recreated.ui.components[0].list?.flowContent, component.list?.flowContent);
    assert.deepEqual(playerFlowMissingEntries(recreated, recreated.ui.components[0]).map(item => item.reason), ['owner']);

    const explicitHeading = kind === 'chapter' ? `#章节：旧章节【${oldOwner.id}】\n#小章节：恢复小节`
      : `#小章节：旧小节【${oldOwner.id}】`;
    const restored = parse(removed, `${movedText}\n${explicitHeading}\n#段落：恢复入口\n旁白：恢复正文`);
    assert.deepEqual(playerFlowMissingEntries(restored, restored.ui.components[0]), []);
    assert.equal(playerFlowAllEntries(restored, restored.ui.components[0])[0].nodeId, target.id);
  });
}

test('an automatically recreated start cannot take an old saved entry identity', () => {
  const original = parse(createProject(), retainedText), oldStartId = original.entryId;
  const passage = original.nodes.find(node => node.kind === 'passage')!;
  const component = map();
  rememberEntry(component, oldStartId);
  original.ui.components.push(component);
  const passageOnly = `@入口：开场【${passage.id}】\n#章节：第一章\n#小章节：街道\n#段落：开场【${passage.id}】\n旁白：保留正文`;
  const removed = reopen(parse(original, passageOnly));
  assert.equal(removed.nodes.some(node => node.id === oldStartId), false);
  const recreated = parse(removed, retainedText);
  assert.notEqual(recreated.entryId, oldStartId);
  assert.deepEqual(playerFlowMissingEntries(recreated, recreated.ui.components[0]).map(item => item.entry.nodeId), [oldStartId]);
  assert.equal(parse(recreated, retainedText).entryId, recreated.entryId, 'automatic start allocation remains stable on the next sync');
  rememberEntry(recreated.ui.components[0], recreated.entryId);
  assert.equal(parse(recreated, retainedText).entryId, recreated.entryId, 'removing the older missing reference must not change the live generated start');
});

test('reused nodes keep their generated identity on sync and allocate a new identity only after deletion', () => {
  const original = parse(createProject(), shopText('被复用的正文')), originalId = shop(original).id;
  const baseSource = projectToText(original), source = `${baseSource}\n@复用节点：商店【${originalId}】`;
  const copied = parse(original, source);
  const duplicate = (project: Project) => project.nodes.find(node => node.kind === 'passage' && node.name === '商店' && node.id !== originalId)!;
  const oldId = duplicate(copied).id, component = map();
  rememberEntry(component, oldId);
  copied.ui.components.push(component);
  assert.equal(duplicate(parse(reopen(copied), source)).id, oldId);

  const removed = reopen(parse(copied, baseSource));
  assert.deepEqual(playerFlowMissingEntries(removed, removed.ui.components[0]).map(item => item.entry.nodeId), [oldId]);
  const recreated = parse(removed, source), nextId = duplicate(recreated).id;
  assert.notEqual(nextId, oldId);
  assert.deepEqual(playerFlowMissingEntries(recreated, recreated.ui.components[0]).map(item => item.entry.nodeId), [oldId]);
  assert.equal(duplicate(parse(reopen(recreated), source)).id, nextId);
  rememberEntry(recreated.ui.components[0], nextId);
  assert.equal(duplicate(parse(reopen(recreated), source)).id, nextId, 'a live generated copy remains stable after its earlier missing reference is removed');
});

for (const declaration of ['heading', 'node marker', 'instance', 'bare instance'] as const) {
  test(`an implicit copy cannot claim the identity of an old copy explicitly declared later by ${declaration}`, () => {
    const original = parse(createProject(), shopText('被复用的正文')), originalId = shop(original).id;
    const baseSource = projectToText(original), copySource = `${baseSource}\n@复用节点：商店【${originalId}】`;
    const copied = parse(original, copySource);
    const previousCopy = copied.nodes.find(node => node.kind === 'passage' && node.name === '商店' && node.id !== originalId)!;
    assert.equal(previousCopy.kind, 'passage');
    if (previousCopy.kind !== 'passage') return;
    const oldId = previousCopy.id, component = map();
    previousCopy.name = '保留副本';
    previousCopy.lines[0].text = '旧副本的独立正文';
    rememberEntry(component, oldId);
    copied.ui.components.push(component);
    const explicit = declaration === 'heading' ? `#段落：保留副本【${oldId}】\n旁白：旧副本的独立正文`
      : declaration === 'node marker' ? `@节点标记：保留副本【${oldId}】\n旁白：旧副本的独立正文`
      : declaration === 'instance' ? `@实例：保留副本【${oldId}】` : `@实例：${oldId}`;
    const source = `${copySource}\n${explicit}`, updated = parse(reopen(copied), source);
    const savedCopy = updated.nodes.find(node => node.id === oldId)!;
    const addedCopy = updated.nodes.find(node => node.kind === 'passage' && node.name === '商店' && node.id !== originalId)!;
    assert.equal(savedCopy.name, '保留副本');
    assert.equal(savedCopy.kind === 'passage' ? savedCopy.lines[0].text : undefined, '旧副本的独立正文');
    assert.notEqual(addedCopy.id, oldId);
    assert.equal(updated.nodes.filter(node => node.id === oldId).length, 1);
    assert.deepEqual(updated.ui.components[0].list?.flowContent, component.list?.flowContent);
    assert.deepEqual(playerFlowMissingEntries(updated, updated.ui.components[0]), []);
    const synchronized = parse(reopen(updated), source);
    assert.equal(synchronized.nodes.find(node => node.id === addedCopy.id)?.name, '商店');
    assert.equal(synchronized.nodes.find(node => node.id === oldId)?.name, '保留副本');
  });
}

test('a marker immediately before a reuse command assigns that copy its own stable explicit identity', () => {
  const original = parse(createProject(), shopText('复用源正文')), originalId = shop(original).id;
  const component = map(), copyId = 'explicit_shop_copy';
  rememberEntry(component, copyId);
  original.ui.components.push(component);
  const source = `${projectToText(original)}\n@节点标记：指定副本【${copyId}】\n@复用节点：商店【${originalId}】`;
  const copied = parse(original, source);
  for (const synchronized of [copied, parse(reopen(copied), source), parse(reopen(copied), projectToText(copied))]) {
    const copy = synchronized.nodes.find(node => node.id === copyId);
    assert.equal(copy?.name, '指定副本');
    assert.equal(copy?.kind === 'passage' ? copy.lines[0].text : undefined, '复用源正文');
    assert.deepEqual(playerFlowMissingEntries(synchronized, synchronized.ui.components[0]), []);
  }
});

test('effect bodies, comments and ordinary prose do not reserve fake explicit node declarations', () => {
  const original = parse(createProject(), shopText('被复用的正文')), originalId = shop(original).id;
  const baseSource = projectToText(original), source = `${baseSource}\n@复用节点：商店【${originalId}】`;
  const copied = parse(original, source);
  const oldId = copied.nodes.find(node => node.kind === 'passage' && node.name === '商店' && node.id !== originalId)!.id;
  const component = map();
  rememberEntry(component, oldId);
  copied.ui.components.push(component);
  const withLiteral = baseSource.replace('被复用的正文', `普通正文【${oldId}】`);
  const definition = `@效果定义：未调用的效果\n#段落：效果内标题【${oldId}】\n@节点标记：效果内标记【${oldId}】\n@实例：效果内引用【${oldId}】\n@效果结束`;
  const updated = parse(copied, `${withLiteral}\n${definition}\n// #段落：注释【${oldId}】\n@复用节点：商店【${originalId}】`);
  assert.equal(updated.nodes.find(node => node.id === oldId)?.name, '商店');
  assert.deepEqual(playerFlowMissingEntries(updated, updated.ui.components[0]), []);
});
