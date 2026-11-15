import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { copyFlowStyleForEntry } from '../src/core/flow-style-authoring';
import { flowNodeAppearance } from '../src/core/flow-style';
import { mutateProject } from '../src/core/project-mutation';
import { storyMenuEntries } from '../src/core/story-menu';
import { editStoryFlowSource, storyFlowOwner, storyFlowSourceEditable } from '../src/core/story-flow-authoring';
import { applyTextScript, projectToText } from '../src/core/text-script';

const map = (): UiComponent => ({ id: 'map', kind: 'flowchart', page: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1, list: { layout: 'flow' } });
const fixture = () => {
  const parsed = applyTextScript(createProject('复制节点样式'), '#章节：第一章\n#小章节(流程图=是)：小节\n旁白：正文\n#段落(流程图=是)：分支\n旁白：分支正文\n#章节：第二章\n旁白：结尾');
  assert.deepEqual(parsed.issues, []);
  parsed.project.ui.flowStyles = [{ id: 'shared', name: '主线框', skin: { idle: 'picture', brightness: { hover: .5 } }, style: { fontSize: 60, captionParts: [{}, { color: '#123456' }] } }];
  return parsed.project;
};

test('copy and assignment are one draft operation resolving the real owner; all maps see the new reference', () => {
  const project = fixture(), component = map(), entry = storyMenuEntries(project, 'flowchart')[0];
  assert.equal(entry.owner?.kind, 'scene');
  editStoryFlowSource(project, entry.owner!, { styleId: 'shared' });
  const captured: { result?: ReturnType<typeof copyFlowStyleForEntry> } = {};
  const next = mutateProject(project, draft => { captured.result = copyFlowStyleForEntry(draft, component, entry.id, { expectedOwner: entry.owner }); });
  const result = captured.result;
  assert.ok(result?.ok);
  const copied = next.ui.flowStyles!.find(style => style.id === result.styleId)!;
  assert.equal(copied.name, '主线框 副本');
  assert.equal(storyFlowOwner(next, entry.owner)?.flowchart?.styleId, copied.id);
  assert.equal(project.ui.flowStyles!.length, 1);
  assert.equal(storyFlowOwner(project, entry.owner)?.flowchart?.styleId, 'shared');
  const updated = storyMenuEntries(next, 'flowchart').find(item => item.id === entry.id)!;
  assert.equal(updated.styleId, copied.id);
  assert.equal(flowNodeAppearance(next, component, updated).style?.fontSize, 60);
  assert.equal(flowNodeAppearance(next, { ...component, id: 'another-map' }, updated).style?.fontSize, 60);
  copied.style!.captionParts![1].color = '#abcdef';
  copied.skin!.brightness!.hover = .2;
  assert.equal(next.ui.flowStyles![0].style!.captionParts![1].color, '#123456');
  assert.equal(next.ui.flowStyles![0].skin!.brightness!.hover, .5);
  assert.equal(copied.style?.textColor, undefined, 'copy a real preset without baking inherited properties');
});

test('copying a node without a real preset captures effective type/page look and excludes map opacity', () => {
  const project = fixture(), component = map(), entry = storyMenuEntries(project, 'flowchart')[0];
  const node = project.nodes.find(item => item.id === entry.id)!;
  assert.equal(node.kind, 'start');
  component.style = { opacity: .25, shadowBlur: 14, shadowSpread: 4 };
  project.ui.pages = { flowchart: { appearance: { fontSize: 47, textColor: '#aabbcc', fontAssetId: 'page_font' } } };
  const result = copyFlowStyleForEntry(project, component, entry.id);
  assert.ok(result.ok);
  const copied = project.ui.flowStyles!.find(style => style.id === result.styleId)!;
  assert.equal(copied.style?.fontSize, 47); assert.equal(copied.style?.fontAssetId, 'page_font');
  assert.equal(copied.style?.textColor, '#aabbcc'); assert.equal(copied.style?.shadowBlur, 14);
  assert.equal(copied.style?.opacity, 1); assert.equal(copied.style?.playerOpacity, undefined);
  assert.deepEqual(copied.style?.captionParts, []); assert.equal(copied.style?.outlineWidth, 0);
  assert.equal(copied.skin?.hideText, false); assert.equal(copied.skin?.fit, 'stretch');
  assert.ok(Object.keys(copied.skin!).length > 0, 'native truthy skin fallback must not substitute another map image');
  const otherMap = { ...component, id: 'other', skin: { idle: 'other-image', hideText: true }, style: { captionParts: [{ fontSize: 100 }], outlineWidth: 8, shadowX: 12 } };
  const effective = flowNodeAppearance(project, otherMap, { styleId: copied.id });
  assert.equal(effective.skin?.idle, undefined); assert.equal(effective.skin?.hideText, false);
  assert.deepEqual(effective.style?.captionParts, []); assert.equal(effective.style?.outlineWidth, 0); assert.equal(effective.style?.shadowX, 0);
  component.style.opacity = .8;
  assert.equal(copied.style?.opacity, 1);
});

test('copying an unstyled node captures effective letter spacing, including native zero and independent segment gaps', () => {
  for (const letterSpacing of [undefined, 0, -1.75, 2.5]) {
    const project = fixture(), component = map(), entry = storyMenuEntries(project, 'flowchart')[0];
    component.style = { letterSpacing, captionParts: [{ letterSpacing: 0, gap: 19 }, { gap: 7 }] };
    const before = JSON.stringify(component);
    const result = copyFlowStyleForEntry(project, component, entry.id);
    assert.ok(result.ok);
    const copied = project.ui.flowStyles!.find(style => style.id === result.styleId)!;
    assert.equal(copied.style?.letterSpacing, letterSpacing ?? 0);
    assert.deepEqual(copied.style?.captionParts, [{ letterSpacing: 0, gap: 19 }, { gap: 7 }]);
    const otherMap = { ...component, id: 'other-map', style: { letterSpacing: 99, captionParts: [{ letterSpacing: 66, gap: 44 }] } };
    const effective = flowNodeAppearance(project, otherMap, { styleId: copied.id });
    assert.equal(effective.style?.letterSpacing, letterSpacing ?? 0, 'captured zero must not inherit spacing from another map');
    assert.deepEqual(effective.style?.captionParts, [{ letterSpacing: 0, gap: 19 }, { gap: 7 }]);
    assert.equal(JSON.stringify(component), before);
    component.style.captionParts![0].letterSpacing = 6;
    component.style.captionParts![1].gap = 31;
    assert.deepEqual(copied.style?.captionParts, [{ letterSpacing: 0, gap: 19 }, { gap: 7 }], 'captured segments must not alias the original map');
    const saved = projectSchema.parse(JSON.parse(JSON.stringify(project)));
    assert.equal(saved.ui.flowStyles!.find(style => style.id === copied.id)!.style?.letterSpacing, letterSpacing ?? 0);
  }
});

test('copying a real preset preserves spacing inheritance instead of freezing the current map value', () => {
  for (const letterSpacing of [undefined, 0, -.75]) {
    const project = fixture(), component = map(), entry = storyMenuEntries(project, 'flowchart')[0];
    component.style = { letterSpacing: 4.5, captionParts: [{ letterSpacing: 3, gap: 14 }] };
    const original = project.ui.flowStyles![0];
    original.style = { letterSpacing, captionParts: [{ letterSpacing: 0, gap: 0 }, { color: '#123456', gap: 9 }] };
    editStoryFlowSource(project, entry.owner!, { styleId: original.id });
    const result = copyFlowStyleForEntry(project, component, entry.id);
    assert.ok(result.ok);
    const copied = project.ui.flowStyles!.find(style => style.id === result.styleId)!;
    assert.equal(copied.style?.letterSpacing, letterSpacing);
    assert.equal(flowNodeAppearance(project, component, { styleId: copied.id }).style?.letterSpacing, letterSpacing ?? 4.5);
    const otherMap = { ...component, id: 'other-map', style: { letterSpacing: -2.5 } };
    assert.equal(flowNodeAppearance(project, otherMap, { styleId: copied.id }).style?.letterSpacing, letterSpacing ?? -2.5);
    assert.equal(copied.style?.captionParts?.[1].letterSpacing, undefined, 'an inherited segment must remain inherited');
    assert.equal(copied.style?.captionParts?.[0].letterSpacing, 0);
    copied.style!.captionParts![0].letterSpacing = 1.25;
    copied.style!.captionParts![1].gap = 24;
    assert.deepEqual(original.style.captionParts, [{ letterSpacing: 0, gap: 0 }, { color: '#123456', gap: 9 }]);
  }
});

test('type-specific skin is captured from the actual story node, not supplied stale entry data', () => {
  const project = fixture(), component = map();
  const entry = storyMenuEntries(project, 'flowchart')[1];
  const node = project.nodes.find(item => item.id === entry.id)!;
  assert.ok(storyFlowSourceEditable(project, entry.owner));
  // A declared ending is a legal heading whose map entry uses the ending skin.
  const ending = { id: node.id, sceneId: node.sceneId, name: node.name, kind: 'end' as const, x: node.x, y: node.y, textHeading: true, flowchart: { visible: true } };
  project.nodes[project.nodes.indexOf(node)] = ending;
  component.skin = { idle: 'normal' }; component.list!.flowEndSkin = { idle: 'end', hideText: true };
  const result = copyFlowStyleForEntry(project, component, ending.id);
  assert.ok(result.ok);
  const copied = project.ui.flowStyles!.find(style => style.id === result.styleId)!;
  assert.equal(copied.skin?.idle, component.list!.flowEndSkin?.idle);
  assert.equal(copied.skin?.hideText, true); assert.equal(copied.skin?.fit, 'stretch');
  assert.notEqual(copied.skin, component.list!.flowEndSkin);
});

test('deleted preset reference captures current map appearance; copied names stay unique within schema length', () => {
  const project = fixture(), component = map(), entry = storyMenuEntries(project, 'flowchart')[0];
  editStoryFlowSource(project, entry.owner!, { styleId: 'deleted' });
  component.style = { fontSize: 39 };
  const fallback = copyFlowStyleForEntry(project, component, entry.id);
  assert.ok(fallback.ok);
  assert.equal(project.ui.flowStyles!.find(style => style.id === fallback.styleId)?.style?.fontSize, 39);
  const source = project.ui.flowStyles![0]; source.name = '长'.repeat(120);
  editStoryFlowSource(project, entry.owner!, { styleId: source.id });
  const first = copyFlowStyleForEntry(project, component, entry.id);
  assert.ok(first.ok);
  editStoryFlowSource(project, entry.owner!, { styleId: source.id });
  const second = copyFlowStyleForEntry(project, component, entry.id);
  assert.ok(second.ok);
  const names = [first, second].map(result => project.ui.flowStyles!.find(style => style.id === result.styleId)!.name);
  assert.equal(names[0].length, 120); assert.equal(names[1].length, 120); assert.notEqual(names[0], names[1]);
  projectSchema.parse(project);
});

test('stale source identity, removed entry, readonly owner and full library cause no mutations', () => {
  const project = fixture(), component = map(), entry = storyMenuEntries(project, 'flowchart')[0];
  const snapshot = JSON.stringify(project);
  assert.equal(copyFlowStyleForEntry(project, component, entry.id, { expectedOwner: { kind: 'chapter', id: project.chapters[0].id } }).ok, false);
  assert.equal(copyFlowStyleForEntry(project, component, 'removed').ok, false);
  assert.equal(copyFlowStyleForEntry(project, { ...component, kind: 'panel' }, entry.id).ok, false);
  assert.equal(JSON.stringify(project), snapshot);
  const internal = { id: 'internal', kind: 'jump' as const, target: project.entryId, sceneId: project.scenes[0].id, name: '旧内部入口', textHeading: false, x: 0, y: 0, flowchart: { visible: true } };
  project.nodes.push(internal);
  const readonly = JSON.stringify(project);
  assert.equal(copyFlowStyleForEntry(project, component, internal.id).ok, false);
  assert.equal(JSON.stringify(project), readonly);
  project.ui.flowStyles = Array.from({ length: 128 }, (_, index) => ({ id: `style-${index}`, name: `样式 ${index}` }));
  const full = JSON.stringify(project);
  assert.equal(copyFlowStyleForEntry(project, component, entry.id).ok, false);
  assert.equal(JSON.stringify(project), full);
});

test('copying resolves same-entry precedence in the current transaction and preserves script round-trip', () => {
  const project = fixture(), component = map(), entry = storyMenuEntries(project, 'flowchart')[0];
  editStoryFlowSource(project, entry.owner!, { visible: false });
  const actual = storyMenuEntries(project, 'flowchart').find(item => item.id === entry.id)!;
  assert.equal(actual.owner?.kind, 'chapter');
  const result = copyFlowStyleForEntry(project, component, entry.id);
  assert.ok(result.ok);
  assert.deepEqual(result.owner, actual.owner);
  assert.equal(storyFlowOwner(project, entry.owner)?.flowchart?.styleId, undefined);
  assert.equal(storyFlowOwner(project, actual.owner)?.flowchart?.styleId, result.styleId);
  const saved = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  const reparsed = applyTextScript(saved, projectToText(saved));
  assert.deepEqual(reparsed.issues, []);
  assert.equal(storyMenuEntries(reparsed.project, 'flowchart').find(item => item.id === entry.id)?.styleId, result.styleId);
  assert.equal(reparsed.project.ui.flowStyles!.find(style => style.id === result.styleId)?.name, project.ui.flowStyles!.find(style => style.id === result.styleId)?.name);
});

test('capturing system default font keeps the existing font inheritance contract without inventing an asset', () => {
  const project = fixture(), component = map(), entry = storyMenuEntries(project, 'flowchart')[0];
  delete project.ui.fontAssetId;
  const result = copyFlowStyleForEntry(project, component, entry.id);
  assert.ok(result.ok);
  const copied = project.ui.flowStyles!.find(style => style.id === result.styleId)!;
  assert.equal(copied.style?.fontAssetId, undefined);
  const other = flowNodeAppearance(project, { ...component, style: { fontAssetId: 'another_font' } }, { styleId: result.styleId });
  assert.equal(other.style?.fontAssetId, 'another_font');
});

test('copying a custom-map preset assigns only that map entry and leaves story metadata unchanged', () => {
  const project = fixture(), selectedMap = map(), otherMap = { ...map(), id: 'other_map' };
  const entry = storyMenuEntries(project, 'flowchart')[0];
  editStoryFlowSource(project, entry.owner!, { styleId: 'shared' });
  selectedMap.list!.flowContent = { mode: 'custom', custom: { entries: [
    { nodeId: entry.id, ...(entry.owner ? { owner: entry.owner } : {}), name: '独立入口标题', styleId: 'shared', action: 'inspect' },
  ] } };
  otherMap.list!.flowContent = { mode: 'custom', custom: { entries: [
    { nodeId: entry.id, ...(entry.owner ? { owner: entry.owner } : {}), name: '另一张图标题', styleId: 'shared' },
  ] } };
  const before = JSON.stringify(storyFlowOwner(project, entry.owner));

  const result = copyFlowStyleForEntry(project, selectedMap, entry.id, { expectedOwner: entry.owner });

  assert.ok(result.ok);
  const selected = selectedMap.list!.flowContent!.custom!.entries[0];
  assert.equal(selected.styleId, result.styleId);
  assert.equal(selected.name, '独立入口标题');
  assert.equal(selected.action, 'inspect');
  assert.equal(otherMap.list!.flowContent!.custom!.entries[0].styleId, 'shared');
  assert.equal(JSON.stringify(storyFlowOwner(project, entry.owner)), before);
  assert.equal(result.owner?.id, entry.owner!.id);
  assert.equal(project.ui.flowStyles!.find(style => style.id === result.styleId)?.name, '主线框 副本');
});

test('custom style copying captures this map actual node-kind skin and its own base look', () => {
  const project = fixture(), component = map(), passageIndex = project.nodes.findIndex(item => item.kind === 'passage');
  const passage = project.nodes[passageIndex]!;
  const node = { id: passage.id, sceneId: passage.sceneId, name: passage.name, kind: 'end' as const, x: passage.x, y: passage.y, textHeading: true, flowchart: passage.flowchart };
  project.nodes[passageIndex] = node;
  component.skin = { idle: 'map_base' };
  component.list!.flowEndSkin = { idle: 'map_end', hideText: true };
  component.style = { fontSize: 53, textColor: '#aabbcc' };
  component.list!.flowContent = { mode: 'custom', custom: { entries: [
    { nodeId: node.id, owner: { kind: 'node', id: node.id }, name: '独立入口标题' },
  ] } };
  const metadataBefore = JSON.stringify(node.flowchart);

  const result = copyFlowStyleForEntry(project, component, node.id);

  assert.ok(result.ok);
  const copied = project.ui.flowStyles!.find(style => style.id === result.styleId)!;
  assert.equal(copied.skin?.idle, 'map_end', 'the real current node kind still selects the map type skin');
  assert.equal(copied.skin?.hideText, true);
  assert.equal(copied.style?.fontSize, 53);
  assert.equal(copied.style?.textColor, '#aabbcc');
  assert.equal(JSON.stringify(node.flowchart), metadataBefore);
});
