import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { applyTextScript } from '../src/core/text-script';
import { storyMenuEntries } from '../src/core/story-menu';
import { storyFlowLayout } from '../src/core/story-flow';
import { playerFlowRuntimeData } from '../src/runtime/screens';

function fixture() {
  const project = applyTextScript(createProject(), '#章节：开篇\n旁白：甲\n#章节：相遇\n旁白：乙\n#章节：结尾\n旁白：丙').project;
  const entries = storyMenuEntries(project, 'flowchart');
  const component: UiComponent = { id: 'map', page: 'flowchart', kind: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1, list: { layout: 'flow' } };
  return { project, entries, component };
}

test('legacy and explicit script modes compile the same entries, looks and graph', () => {
  const { project, entries, component } = fixture();
  const before = JSON.stringify(project), legacy = playerFlowRuntimeData(project, component);
  assert.deepEqual(legacy.flowEntries, entries.map(entry => [entry.id, entry.name, `vn_node_${entry.nodeId}`]));
  assert.deepEqual(legacy.flowGraph, storyFlowLayout(project, component));
  component.list!.flowContent = { mode: 'script', custom: { entries: [] } };
  assert.deepEqual(playerFlowRuntimeData(project, component), legacy);
  assert.equal(JSON.stringify(project), before, 'compiling does not migrate or mutate the project');
});

test('script directories retain chapter location inside hidden dialogue without exporting graph geometry', () => {
  const { project, entries, component } = fixture();
  const [first] = entries, start = project.nodes.find(node => node.id === first.id)!;
  const dialogue = project.nodes.find(node => node.sceneId === start.sceneId && node.kind === 'passage' && node.id !== first.id)!;
  assert.ok(dialogue, 'the first chapter has an unlisted dialogue passage after its start');
  const expected = storyFlowLayout(project, component).locations;
  assert.equal(expected[dialogue.id], first.id);
  for (const layout of [undefined, 'grid'] as const) for (const mode of [undefined, 'script'] as const) {
    component.list = { layout, showProgress: true, ...(mode ? { flowContent: { mode } } : {}) };
    const before = JSON.stringify({ project, component }), data = playerFlowRuntimeData(project, component);
    assert.equal(data.flowGraph, undefined);
    assert.equal(Object.hasOwn(data, 'flowGraph'), false, 'a directory does not emit positions or connector geometry');
    assert.equal(data.flowLocations![dialogue.id], first.id, 'playing the hidden passage still selects its chapter entry');
    assert.deepEqual(data.flowLocations, expected, 'both layouts resolve story locations from the same routes');
    assert.deepEqual(data.flowEntries, entries.map(entry => [entry.id, entry.name, `vn_node_${entry.nodeId}`]));
    assert.equal(JSON.stringify({ project, component }), before);
  }
});

test('script directory location maps survive save/reopen and do not invent entries for disconnected or hidden chapters', () => {
  const { project, entries, component } = fixture();
  component.list = { layout: 'grid', showProgress: true, lockUnread: true, flowLockedNode: 'hide' };
  project.nodes.push({ id: 'unconnected', kind: 'passage', name: '尚未接入', sceneId: project.scenes[0].id, x: 0, y: 0, lines: [{ id: 'unconnected_line', text: '不属于已显示路线', actions: [] }] });
  project.ui.components = [component];
  const data = playerFlowRuntimeData(project, component);
  assert.equal(data.flowLocations!.unconnected, undefined);
  for (const entry of entries) assert.equal(data.flowLocations![entry.id], entry.id);
  const reopened = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(playerFlowRuntimeData(reopened, reopened.ui.components[0]), data);
  project.chapters.forEach(chapter => { chapter.flowchart = { visible: false }; });
  const empty = playerFlowRuntimeData(project, component);
  assert.deepEqual(empty.flowEntries, []);
  assert.deepEqual(empty.flowLocations, {});
  assert.equal(empty.flowGraph, undefined);
});

test('two custom maps keep independent text, presets, positions and real replay identities', () => {
  const { project, entries, component } = fixture();
  const [first, second] = entries;
  project.chapters[0].flowchart = { name: '全局文字', styleId: 'global' };
  project.ui.flowStyles = [{ id: 'global', name: '全局', style: { textColor: '#ff0000' } }, { id: 'local', name: '本图', style: { textColor: '#00ff00', letterSpacing: 2.5, captionParts: [{ fontSize: 18 }, { fontSize: 30 }] } }];
  component.list!.flowContent = { mode: 'custom', custom: { entries: [{ nodeId: first.id, owner: first.owner, name: '第一幕｜相逢', styleId: 'local', action: 'inspect' }], positions: { [first.id]: { x: 120, y: 70 } } } };
  const other: UiComponent = { ...component, id: 'other', list: { layout: 'grid', flowContent: { mode: 'custom', custom: { entries: [{ nodeId: second.id, name: '另图入口' }] } } } };
  const firstData = playerFlowRuntimeData(project, component), secondData = playerFlowRuntimeData(project, other);
  assert.deepEqual(firstData.flowEntries, [[first.id, '第一幕 相逢', `vn_node_${first.id}`]]);
  assert.equal(firstData.flowLooks[first.id].node.action, 'inspect');
  assert.deepEqual(firstData.flowLooks[first.id].node.parts, ['第一幕', '相逢']);
  assert.equal(firstData.flowLooks[first.id].style?.textColor, '#00ff00');
  assert.equal(firstData.flowLooks[first.id].style?.letterSpacing, 2.5);
  assert.equal(firstData.flowGraph!.nodes[0].x, 120);
  assert.equal(firstData.flowGraph!.nodes[0].y, 70);
  assert.deepEqual(secondData.flowEntries, [[second.id, '另图入口', `vn_node_${second.id}`]]);
  assert.equal(secondData.flowLooks[first.id], undefined);
  component.list!.flowContent!.custom!.entries[0] = { nodeId: first.id, owner: first.owner };
  const reset = playerFlowRuntimeData(project, component);
  assert.equal(reset.flowLooks[first.id].node.name, project.chapters[0].name);
  assert.notEqual(reset.flowLooks[first.id].style?.textColor, '#ff0000');
});

test('group navigation compiles separate views without a fake story label, including roundtrip', () => {
  const { project, entries, component } = fixture();
  const [first, second, third] = entries;
  component.list!.flowContent = { mode: 'custom', custom: {
    entries: entries.map(entry => ({ nodeId: entry.id })),
    groups: [{ id: 'act_one', name: '第一幕', nodeIds: [first.id, second.id], position: { x: 60, y: 50 }, positions: { [first.id]: { x: 30, y: 20 } } }],
  } };
  project.ui.components = [component];
  const data = playerFlowRuntimeData(project, component);
  assert.deepEqual(data.flowEntries.map(entry => entry[0]), ['act_one', third.id]);
  assert.equal(data.flowEntries[0][2], '');
  assert.equal(data.flowLooks.act_one.node.nodeId, undefined);
  assert.deepEqual(data.flowLooks.act_one.node.memberIds, [first.id, second.id]);
  assert.deepEqual(data.flowGroups!.act_one.entries.map(entry => entry[0]), [first.id, second.id]);
  assert.deepEqual(data.flowGroups!.act_one.graph.nodes.map(entry => entry.id).sort(), [first.id, second.id].sort());
  assert.equal(data.flowGroups!.act_one.graph.nodes.find(entry => entry.id === first.id)!.x, 30);
  assert.equal(data.flowGraph!.locations[first.id], 'act_one');
  assert.equal(data.flowLocations, undefined, 'custom roots retain their graph projection rather than a second mapping');
  assert.equal(data.flowGroups!.act_one.graph.locations[first.id], first.id, 'entering a group uses member identities, not the root group card');
  assert.equal(data.flowGroups!.act_one.graph.locations[third.id], undefined, 'group interiors do not locate a story entry outside their scope');
  const directory = playerFlowRuntimeData(project, { ...component, list: { ...component.list, layout: 'grid' } });
  assert.deepEqual(directory.flowGraph!.locations, data.flowGraph!.locations);
  assert.deepEqual(directory.flowGroups!.act_one.graph.locations, data.flowGroups!.act_one.graph.locations);
  assert.equal(directory.flowLocations, undefined);
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(playerFlowRuntimeData(restored, restored.ui.components[0]), data);
});

test('missing custom targets stay absent instead of falling through to the global directory', () => {
  const { project, component } = fixture();
  component.list!.flowContent = { mode: 'custom', custom: { entries: [{ nodeId: 'deleted' }], groups: [{ id: 'empty', name: '失效组', nodeIds: ['deleted'] }] } };
  const data = playerFlowRuntimeData(project, component);
  assert.deepEqual(data.flowEntries, []);
  assert.deepEqual(data.flowGraph!.nodes, []);
  assert.deepEqual(data.flowLooks, {});
});
