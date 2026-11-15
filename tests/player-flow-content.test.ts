import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, projectSchema, type StoryNode, type UiComponent } from '../src/core/model';
import { playerFlowContentSchema } from '../src/core/player-flow-content-schema';
import { clearPlayerFlowPositions, playerFlowAllEntries, playerFlowEntries, playerFlowGroups, playerFlowMissingEntries, playerFlowMode, playerFlowPositions, setPlayerFlowPosition } from '../src/core/player-flow-content';
import { addPlayerFlowEntry, createPlayerFlowGroup, editPlayerFlowEntry, editPlayerFlowGroup, initializePlayerFlowCustom, playerFlowSources, removePlayerFlowEntry, removePlayerFlowEntryFromGroup, removePlayerFlowGroup, repairPlayerFlowEntry, reorderPlayerFlowEntries, setPlayerFlowGroupMembers, setPlayerFlowMode } from '../src/core/player-flow-authoring';
import { storyMenuEntries } from '../src/core/story-menu';
import { storyFlowDirectoryLayout, storyFlowLayout } from '../src/core/story-flow';
import { applyTextScript, projectToText } from '../src/core/text-script';

function fixture() {
  const project = createProject(), sceneId = project.scenes[0].id;
  const base = (id: string) => ({ id, name: id, sceneId, x: 0, y: 0 });
  const passage = (id: string, next?: string): StoryNode => ({ ...base(id), kind: 'passage', lines: [{ id: id + '_line', text: id, actions: [] }], next, flowchart: { visible: true } });
  project.nodes = [passage('entry', 'fork'), passage('left', 'merge'), passage('right', 'merge'), passage('merge', 'end'), { ...base('end'), kind: 'end', flowchart: { visible: true } },
    { ...base('fork'), kind: 'choice', textHeading: false, prompt: '', choices: [{ id: 'take_left', text: '向左', target: 'left' }, { id: 'take_right', text: '向右', target: 'right' }] }];
  project.entryId = 'entry';
  return project;
}

const control = (id = 'map'): UiComponent => ({ id, kind: 'flowchart', page: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1, list: { layout: 'flow' } });
const custom = (component: UiComponent) => component.list!.flowContent!.custom!;
const owner = (id: string) => ({ kind: 'node' as const, id });
const at = (component: UiComponent, id: string) => custom(component).entries.find(entry => entry.nodeId === id)!;

test('legacy absence and explicit script mode render the same entries, layout, and routes without writing defaults', () => {
  const project = fixture(), component = control(), before = JSON.stringify({ project, component });
  const graph = storyFlowLayout(project, component);
  assert.equal(playerFlowMode(component), 'script');
  assert.deepEqual(playerFlowEntries(project, component), storyMenuEntries(project, 'flowchart'));
  assert.deepEqual(storyFlowLayout(project, { ...component, list: { ...component.list, flowContent: { mode: 'script' } } }), graph);
  assert.equal(graph.nodes.find(node => node.id === 'entry')!.x, 60);
  assert.equal(graph.nodes.find(node => node.id === 'left')!.x, 510);
  assert.deepEqual(graph.edges.find(edge => edge.to === 'left')!.paths, [{ nodeIds: ['entry', 'fork', 'left'], labels: ['向左'] }]);
  assert.equal(JSON.stringify({ project, component }), before);
  assert.equal(setPlayerFlowMode(component, 'custom'), false);
  assert.equal(component.list?.flowContent, undefined);
});

test('copy snapshots visible text, appearance and automatic/manual positions; switching retains both modes', () => {
  const project = fixture(), component = control();
  project.nodes[0].flowchart = { visible: true, name: '序｜重逢', styleId: 'opening' };
  project.nodes[1].name = '长剧情标题'.repeat(30);
  component.list!.flowPositions = { left: { x: 3000, y: 2300 } };
  const original = storyFlowLayout(project, component), source = JSON.stringify(project);
  initializePlayerFlowCustom(project, component, 'copy');
  assert.equal(playerFlowMode(component), 'custom');
  assert.deepEqual(at(component, 'entry'), { nodeId: 'entry', owner: owner('entry'), name: '序｜重逢', styleId: 'opening' });
  assert.equal(at(component, 'left').name, project.nodes[1].name);
  assert.equal(playerFlowContentSchema.safeParse(component.list?.flowContent).success, true);
  assert.deepEqual(storyFlowLayout(project, component).nodes, original.nodes);
  assert.equal(JSON.stringify(project), source);
  editPlayerFlowEntry(component, 'entry', { name: '本图｜开场', action: 'inspect' });
  setPlayerFlowPosition(component, 'left', { x: 70, y: 80 });
  const saved = JSON.stringify(custom(component));
  assert.equal(setPlayerFlowMode(component, 'script'), true);
  assert.deepEqual(storyFlowLayout(project, component), original);
  assert.deepEqual(playerFlowGroups(component), []);
  assert.equal(setPlayerFlowMode(component, 'custom'), true);
  assert.equal(JSON.stringify(custom(component)), saved);
  assert.deepEqual(playerFlowPositions(component).left, { x: 70, y: 80 });
  assert.deepEqual(component.list?.flowPositions?.left, { x: 3000, y: 2300 });
});

test('empty custom is intentionally empty, local defaults follow source titles, and controls stay independent', () => {
  const project = fixture(), first = control(), second = control('second');
  const chapter = project.chapters[0];
  chapter.name = '剧情原名'; chapter.flowchart = { name: '另一张图的名字', styleId: 'shared' };
  initializePlayerFlowCustom(project, first, 'empty');
  initializePlayerFlowCustom(project, second, 'copy');
  assert.deepEqual(playerFlowEntries(project, first), []);
  assert.deepEqual(storyFlowLayout(project, first).nodes, []);
  assert.equal(addPlayerFlowEntry(project, first, { kind: 'chapter', id: chapter.id }), true);
  assert.equal(addPlayerFlowEntry(project, first, { kind: 'scene', id: project.scenes[0].id }), false);
  assert.equal(addPlayerFlowEntry(project, first, owner('entry')), false);
  assert.equal(playerFlowEntries(project, first)[0].name, '剧情原名');
  assert.equal(playerFlowEntries(project, first)[0].styleId, undefined);
  chapter.name = '剧情改名';
  assert.equal(playerFlowEntries(project, first)[0].name, '剧情改名');
  editPlayerFlowEntry(first, 'entry', { name: '仅本图', styleId: 'own', action: 'inspect' });
  assert.equal(playerFlowEntries(project, first)[0].name, '仅本图');
  assert.equal(playerFlowEntries(project, second)[0].name, 'entry');
  assert.equal(project.nodes[0].flowchart?.styleId, undefined);
  editPlayerFlowEntry(first, 'entry', { name: undefined, styleId: undefined, action: undefined });
  assert.deepEqual(at(first, 'entry'), { nodeId: 'entry', owner: { kind: 'chapter', id: chapter.id } });
  const snapshot = JSON.stringify(first);
  playerFlowAllEntries(project, first); playerFlowGroups(first); playerFlowPositions(first); playerFlowMissingEntries(project, first); storyFlowLayout(project, first);
  assert.equal(JSON.stringify(first), snapshot);
});

test('custom order is independent from script order and only chosen entries take part in the graph', () => {
  const project = fixture(), component = control();
  initializePlayerFlowCustom(project, component, 'empty');
  addPlayerFlowEntry(project, component, owner('entry'));
  addPlayerFlowEntry(project, component, owner('merge'));
  addPlayerFlowEntry(project, component, owner('end'));
  reorderPlayerFlowEntries(component, ['end', 'entry', 'entry', 'not_added']);
  assert.deepEqual(playerFlowAllEntries(project, component).map(entry => entry.id), ['end', 'entry', 'merge']);
  const graph = storyFlowLayout(project, component);
  assert.deepEqual(new Set(graph.nodes.map(node => node.id)), new Set(['entry', 'merge', 'end']));
  const branch = graph.edges.find(edge => edge.from === 'entry' && edge.to === 'merge')!;
  assert.equal(branch.label, '向左 / 向右');
  assert.deepEqual(branch.paths?.map(path => path.nodeIds), [['entry', 'fork', 'left', 'merge'], ['entry', 'fork', 'right', 'merge']]);
  assert.deepEqual(new Set(branch.via), new Set(['fork', 'left', 'right']));
  assert.equal(graph.locations.left, 'entry');
  assert.equal(graph.locations.right, 'entry');
});

test('missing references remain repairable, never retarget on read, and repair moves every local key atomically', () => {
  const project = fixture(), component = control();
  initializePlayerFlowCustom(project, component, 'copy');
  editPlayerFlowEntry(component, 'left', { name: '保留标题', styleId: 'retained', action: 'inspect' });
  setPlayerFlowPosition(component, 'left', { x: 800, y: 900 });
  const groupId = createPlayerFlowGroup(project, component, '分支', ['left', 'right'])!;
  setPlayerFlowPosition(component, 'left', { x: 20, y: 30 }, groupId);
  project.nodes = project.nodes.filter(node => node.id !== 'left');
  const before = JSON.stringify(component), missing = playerFlowMissingEntries(project, component);
  assert.equal(missing[0].entry.nodeId, 'left'); assert.equal(missing[0].reason, 'node');
  assert.equal(playerFlowAllEntries(project, component).some(entry => entry.id === 'left'), false);
  assert.equal(JSON.stringify(component), before);
  assert.equal(repairPlayerFlowEntry(project, component, 'left', owner('right')), false);
  assert.equal(JSON.stringify(component), before);
  project.nodes.push({ id: 'replacement', sceneId: project.scenes[0].id, name: '替代入口', kind: 'passage', x: 0, y: 0, lines: [{ id: 'replacement_line', text: '替代', actions: [] }], next: 'merge' });
  assert.equal(repairPlayerFlowEntry(project, component, 'left', owner('replacement')), true);
  assert.deepEqual(at(component, 'replacement'), { nodeId: 'replacement', owner: owner('replacement'), name: '保留标题', styleId: 'retained', action: 'inspect' });
  assert.deepEqual(playerFlowPositions(component).replacement, { x: 800, y: 900 });
  assert.equal(playerFlowPositions(component).left, undefined);
  assert.deepEqual(playerFlowPositions(component, groupId).replacement, { x: 20, y: 30 });
  assert.deepEqual(playerFlowGroups(component)[0].nodeIds, ['replacement', 'right']);
  assert.deepEqual(playerFlowMissingEntries(project, component), []);
  assert.equal(custom(component).entries.some(entry => entry.nodeId === 'left'), false);
  assert.equal(removePlayerFlowEntry(component, 'replacement'), true);
  assert.deepEqual(playerFlowGroups(component)[0].nodeIds, ['right']);
  assert.equal(playerFlowPositions(component, groupId).replacement, undefined);
});

test('a lost owner is reported even while its pinned node survives, including inactive custom content', () => {
  const project = fixture(), component = control();
  initializePlayerFlowCustom(project, component, 'empty');
  addPlayerFlowEntry(project, component, { kind: 'chapter', id: project.chapters[0].id });
  project.chapters[0].id = 'renamed_owner';
  assert.equal(playerFlowMissingEntries(project, component)[0].reason, 'owner');
  assert.deepEqual(playerFlowAllEntries(project, component), []);
  setPlayerFlowMode(component, 'script');
  assert.equal(playerFlowMissingEntries(project, component)[0].entry.nodeId, 'entry');
  assert.equal(repairPlayerFlowEntry(project, component, 'entry', owner('entry')), true);
  assert.deepEqual(playerFlowMissingEntries(project, component), []);
});

test('collapsed group cards aggregate real branches and progress while interiors cannot connect across external entries', () => {
  const project = fixture(), component = control();
  initializePlayerFlowCustom(project, component, 'copy');
  const groupId = createPlayerFlowGroup(project, component, '两条分支', ['left', 'right'])!;
  const root = storyFlowLayout(project, component), group = root.nodes.find(node => node.id === groupId)!;
  assert.equal(group.kind, 'passage'); assert.equal(group.nodeId, undefined);
  assert.deepEqual(group.memberIds, ['left', 'right']);
  assert.equal(root.locations.left, groupId); assert.equal(root.locations.right, groupId);
  const incoming = root.edges.find(edge => edge.to === groupId)!;
  assert.equal(incoming.label, '向左 / 向右');
  assert.deepEqual(incoming.paths?.map(path => path.nodeIds.at(-1)), ['left', 'right']);
  assert.equal(root.edges.filter(edge => edge.from === groupId && edge.to === 'merge').length, 1);
  const interior = storyFlowLayout(project, component, groupId);
  assert.deepEqual(interior.nodes.map(node => node.id), ['left', 'right']);
  assert.deepEqual(interior.edges, []);
  assert.equal(interior.locations.entry, undefined);
  assert.equal(interior.locations.merge, undefined);
  assert.deepEqual(playerFlowEntries(project, component, 'removed_group'), []);
  editPlayerFlowGroup(component, groupId, { collapsed: false });
  assert.equal(storyFlowLayout(project, component).nodes.some(node => node.groupId), false);
  assert.deepEqual(playerFlowEntries(project, component).map(entry => entry.id), ['entry', 'left', 'right', 'merge', 'end']);
  assert.deepEqual(playerFlowEntries(project, component, groupId).map(entry => entry.id), ['left', 'right']);
});

test('group member moves are exclusive and root, member, and inner layouts remain independent', () => {
  const project = fixture(), component = control();
  initializePlayerFlowCustom(project, component, 'copy');
  const first = createPlayerFlowGroup(project, component, '第一组', ['left', 'right'])!;
  const second = createPlayerFlowGroup(project, component, '第二组', ['merge'])!;
  setPlayerFlowPosition(component, 'left', { x: 1700, y: 1800 });
  setPlayerFlowPosition(component, first, { x: 700, y: 800 });
  setPlayerFlowPosition(component, 'left', { x: 40, y: 50 }, first);
  assert.deepEqual(playerFlowPositions(component).left, { x: 1700, y: 1800 });
  assert.deepEqual(playerFlowPositions(component)[first], { x: 700, y: 800 });
  assert.deepEqual(playerFlowPositions(component, first).left, { x: 40, y: 50 });
  const detached = playerFlowPositions(component, first); detached.left.x = 999;
  assert.equal(playerFlowPositions(component, first).left.x, 40);
  const box = storyFlowLayout(project, component, first).nodes.find(node => node.id === 'left')!;
  assert.deepEqual([box.x, box.y], [40, 50]);
  assert.equal(setPlayerFlowPosition(component, 'merge', { x: 0, y: 0 }, first), false);
  assert.equal(setPlayerFlowPosition(component, 'left', { x: Infinity, y: 0 }, first), false);
  setPlayerFlowGroupMembers(component, second, ['merge', 'left', 'left', 'not_added']);
  assert.deepEqual(playerFlowGroups(component).map(group => group.nodeIds), [['right'], ['merge', 'left']]);
  assert.equal(playerFlowPositions(component, first).left, undefined);
  clearPlayerFlowPositions(component);
  assert.deepEqual(playerFlowPositions(component), {});
  assert.equal(removePlayerFlowEntryFromGroup(component, second, 'left'), true);
  assert.equal(removePlayerFlowGroup(component, first), true);
  assert.equal(playerFlowAllEntries(project, component).length, 5);
  assert.equal(playerFlowGroups(component).length, 1);
});

test('read-only group interiors do not invent a shortcut through a selected node outside the group', () => {
  const project = fixture(), component = control();
  initializePlayerFlowCustom(project, component, 'copy');
  const group = createPlayerFlowGroup(project, component, '跨段展示', ['entry', 'end'])!;
  assert.deepEqual(storyFlowLayout(project, component, group).edges, []);
  assert.equal(storyFlowLayout(project, component).edges.some(edge => edge.from === group && edge.to === 'left'), true);
  assert.equal(storyFlowLayout(project, component).edges.some(edge => edge.from === 'merge' && edge.to === group), true);
});

test('dense cyclic routes remain bounded and still find every reachable visible destination', () => {
  const project = fixture(), component = control(), sceneId = project.scenes[0].id;
  const fork = project.nodes.find(node => node.id === 'fork')!;
  assert.equal(fork.kind, 'choice');
  if (fork.kind !== 'choice') return;
  fork.choices = Array.from({ length: 90 }, (_, index) => ({ id: `pick_${index}`, text: `路线${index}`, target: 'loop' }));
  project.nodes.push({ id: 'loop', name: '循环', sceneId, x: 0, y: 0, kind: 'choice', textHeading: false, prompt: '', choices: [{ id: 'again', text: '再次', target: 'fork' }, { id: 'exit_left', text: '离开左', target: 'left' }, { id: 'exit_right', text: '离开右', target: 'right' }] });
  initializePlayerFlowCustom(project, component, 'copy');
  const graph = storyFlowLayout(project, component), branches = graph.edges.filter(edge => edge.from === 'entry');
  assert.deepEqual(new Set(branches.map(edge => edge.to)), new Set(['left', 'right']));
  for (const edge of branches) { assert.ok(edge.paths!.length <= 8); assert.ok(edge.label.split(' / ').length <= 32); }
  assert.ok(graph.edges.every(edge => edge.paths!.every(path => path.nodeIds.length <= 512)));
});

test('schema retains missing story references but rejects ambiguous groups and invalid coordinates', () => {
  assert.equal(playerFlowContentSchema.safeParse({ mode: 'custom', custom: { entries: [{ nodeId: 'deleted', owner: owner('deleted') }], groups: [{ id: 'group', name: '组', nodeIds: ['deleted'] }] } }).success, true);
  const invalid = [
    { entries: [{ nodeId: 'same' }, { nodeId: 'same' }] },
    { entries: [{ nodeId: 'entry' }], groups: [{ id: 'entry', name: '重复', nodeIds: [] }] },
    { entries: [{ nodeId: 'entry' }], groups: [{ id: 'a', name: '甲', nodeIds: ['entry'] }, { id: 'b', name: '乙', nodeIds: ['entry'] }] },
    { entries: [{ nodeId: 'entry' }], groups: [{ id: 'a', name: '甲', nodeIds: ['not_added'] }] },
    { entries: [{ nodeId: 'entry' }], positions: { entry: { x: Infinity, y: 0 } } },
  ];
  for (const value of invalid) assert.equal(playerFlowContentSchema.safeParse({ mode: 'custom', custom: value }).success, false);
});

test('mode, content and both layouts survive project save and script synchronization without rewriting the script', () => {
  const parsed = applyTextScript(createProject(), '#章节：第一章\n旁白：你好\n#段落(流程图=是)：路口\n旁白：接下来\n#章节：第二章\n旁白：再见');
  assert.deepEqual(parsed.issues, []);
  const project = parsed.project, component = control();
  project.ui.components.push(component);
  const text = projectToText(project);
  initializePlayerFlowCustom(project, component, 'copy');
  const first = custom(component).entries[0].nodeId;
  editPlayerFlowEntry(component, first, { name: '本图｜序章', action: 'inspect' });
  const groupId = createPlayerFlowGroup(project, component, '开篇', [first])!;
  setPlayerFlowPosition(component, first, { x: 25, y: 45 }, groupId);
  assert.equal(projectToText(project), text);
  const reopened = projectSchema.parse(JSON.parse(JSON.stringify(project))), restored = reopened.ui.components.find(item => item.id === component.id)!;
  assert.deepEqual(restored.list?.flowContent, component.list?.flowContent);
  const synchronized = applyTextScript(reopened, text);
  assert.deepEqual(synchronized.issues, []);
  assert.deepEqual(synchronized.project.ui.components.find(item => item.id === component.id)?.list?.flowContent, component.list?.flowContent);
  assert.deepEqual(storyFlowLayout(synchronized.project, restored), storyFlowLayout(project, component));
});

test('custom sources include implicit dialogue, preserve its identity across script sync, and exclude implementation nodes', () => {
  const parsed = applyTextScript(createProject(), '#章节：开场\n旁白：未命名段落的第一句话\n旁白：接着说');
  assert.deepEqual(parsed.issues, []);
  const project = parsed.project, component = control();
  project.ui.components.push(component);
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  assert.equal(passage.textHeading, false);
  const sceneId = passage.sceneId;
  project.nodes.push(
    { id: 'internal_jump', kind: 'jump', sceneId, name: '内部跳转', x: 0, y: 0, textHeading: false, target: passage.id },
    { id: 'standalone', kind: 'passage', sceneId, name: '独立演出', x: 0, y: 0, textHeading: false, lines: [{ id: 'standalone_line', silent: true, text: '', actions: [] }] },
  );
  const source = playerFlowSources(project).find(source => source.owner.kind === 'node' && source.nodeId === passage.id)!;
  assert.equal(source.preview, '未命名段落的第一句话');
  assert.equal(source.path.includes(source.preview!), true);
  assert.equal(playerFlowSources(project).some(source => source.owner.kind === 'node' && ['internal_jump', 'standalone', project.entryId].includes(source.nodeId)), false);
  const text = projectToText(project), beforeNodes = JSON.stringify(project.nodes);
  initializePlayerFlowCustom(project, component, 'empty');
  assert.equal(addPlayerFlowEntry(project, component, source.owner), true);
  assert.equal(projectToText(project), text);
  assert.equal(JSON.stringify(project.nodes), beforeNodes);
  const synchronized = applyTextScript(projectSchema.parse(JSON.parse(JSON.stringify(project))), text);
  assert.deepEqual(synchronized.issues, []);
  const restored = synchronized.project.ui.components.find(item => item.id === component.id)!;
  assert.equal(playerFlowEntries(synchronized.project, restored)[0].nodeId, passage.id);
  assert.equal(synchronized.project.nodes.find(node => node.id === passage.id)?.textHeading, false);
});

test('group directory rows reserve header and navigation space without moving the navigation or changing root geometry', () => {
  const project = fixture(), component = control();
  project.width = 1000; project.height = 600;
  component.list = { layout: 'grid', rows: 2, columns: 2 };
  const root = storyFlowDirectoryLayout(project, component);
  const headerHeight = Math.min(44, Math.max(32, Math.floor(component.height * project.height * .1)));
  const inside = storyFlowDirectoryLayout(project, component, project.ui.fontSize, headerHeight);
  assert.equal(root.bodyTop, 0); assert.equal(root.viewHeight, 548); assert.equal(root.cellHeight, 268);
  assert.equal(inside.bodyTop, 56); assert.equal(inside.viewHeight, 492); assert.equal(inside.cellHeight, 240);
  assert.deepEqual(inside.navigation, root.navigation);
  assert.equal(inside.cellWidth, root.cellWidth);
  component.list.navigationRect = { x: 0, y: .9, width: 1, height: .1 };
  const customNavigation = storyFlowDirectoryLayout(project, component, project.ui.fontSize, headerHeight);
  assert.equal(customNavigation.navHeight, 0); assert.equal(customNavigation.viewHeight, 544); assert.equal(customNavigation.cellHeight, 266);
});
