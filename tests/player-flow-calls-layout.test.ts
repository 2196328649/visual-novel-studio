import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, projectSchema, type StoryNode, type UiComponent } from '../src/core/model';
import { clearPlayerFlowPositions, playerFlowAllEntries, playerFlowPositions, setPlayerFlowPosition } from '../src/core/player-flow-content';
import { initializePlayerFlowCustom, removePlayerFlowEntry, removePlayerFlowEntryFromGroup, removePlayerFlowGroup, repairPlayerFlowEntry, setPlayerFlowGroupMembers, setPlayerFlowMode } from '../src/core/player-flow-authoring';
import { storyFlowLayout } from '../src/core/story-flow';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { applyUiDraft } from '../src/core/ui-draft';

function fixture() {
  const project = createProject('子剧情布局保存');
  project.chapters = [{ id: 'chapter', name: '章节', flowchart: { visible: false } }];
  project.scenes = [{ id: 'scene', chapterId: 'chapter', name: '小章节' }];
  const base = (id: string) => ({ id, name: id, sceneId: 'scene', x: 0, y: 0 });
  const passage = (id: string, next?: string): StoryNode => ({ ...base(id), kind: 'passage', lines: [{ id: `line_${id}`, text: id, actions: [] }], next, flowchart: { visible: true } });
  project.entryId = 'a';
  project.nodes = [passage('a', 'first'),
    { ...base('first'), kind: 'call', target: 'x', next: 'b', textHeading: false },
    passage('b', 'second'), { ...base('second'), kind: 'call', target: 'x', next: 'c', textHeading: false },
    passage('c', 'end'), passage('x', 'x_tail'), passage('x_tail', 'return_x'),
    { ...base('return_x'), kind: 'return', textHeading: false }, { ...base('end'), kind: 'end', textHeading: false }];
  project.nodes.find(node => node.id === 'x')!.flowchart = { visible: true, name: '寄｜书', styleId: 'letter' };
  project.ui.flowStyles = [{ id: 'letter', name: '寄书外观', style: { background: '#000000', captionParts: [{ fontSize: 18 }, { fontSize: 36 }] } }];
  const component: UiComponent = { id: 'map', page: 'flowchart', kind: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1, list: { layout: 'flow' } };
  project.ui.components = [component];
  return { project, component };
}

test('two references retain independent outer positions and share only their inner layout', () => {
  const { component } = fixture();
  assert.equal(setPlayerFlowPosition(component, 'call:first', { x: 110, y: 230 }), true);
  assert.equal(setPlayerFlowPosition(component, 'call:second', { x: 620, y: 440 }), true);
  assert.equal(setPlayerFlowPosition(component, 'x', { x: 75, y: 85 }, 'call-body:x'), true);
  assert.deepEqual(playerFlowPositions(component)['call:first'], { x: 110, y: 230 });
  assert.deepEqual(playerFlowPositions(component)['call:second'], { x: 620, y: 440 });
  assert.deepEqual(playerFlowPositions(component, 'call-body:x'), { x: { x: 75, y: 85 } });
  assert.equal(playerFlowPositions(component).x, undefined);
  const detached = playerFlowPositions(component, 'call-body:x'); detached.x.x = 900;
  assert.equal(playerFlowPositions(component, 'call-body:x').x.x, 75);
  assert.equal(clearPlayerFlowPositions(component, 'call-body:x'), true);
  assert.deepEqual(playerFlowPositions(component, 'call-body:x'), {});
  assert.equal(playerFlowPositions(component)['call:first'].x, 110);
});

test('invalid values and missing derived-position resets cannot create saved data', () => {
  const { component } = fixture(), before = JSON.stringify(component);
  assert.equal(setPlayerFlowPosition(component, 'x', { x: Infinity, y: 0 }, 'call-body:x'), false);
  assert.equal(setPlayerFlowPosition(component, 'x', { x: 0, y: NaN }, 'call-body:x'), false);
  assert.equal(setPlayerFlowPosition(component, 'x', undefined, 'call-body:x'), false);
  assert.equal(clearPlayerFlowPositions(component, 'call-body:x'), false);
  assert.equal(setPlayerFlowPosition(component, 'x', { x: 0, y: 0 }, 'missing_group'), false);
  assert.equal(JSON.stringify(component), before);
});

test('copying a call graph preserves both geometries without creating fake authored entries', () => {
  const { project, component } = fixture();
  setPlayerFlowPosition(component, 'call:first', { x: 970, y: 65 });
  setPlayerFlowPosition(component, 'x', { x: 45, y: 55 }, 'call-body:x');
  const root = storyFlowLayout(project, component), inner = storyFlowLayout(project, component, 'call-body:x');
  const story = JSON.stringify(project.nodes), entries = playerFlowAllEntries(project, component);
  initializePlayerFlowCustom(project, component, 'copy');
  assert.deepEqual(component.list!.flowContent!.custom!.entries.map(entry => entry.nodeId), entries.map(entry => entry.id));
  assert.ok(component.list!.flowContent!.custom!.entries.every(entry => !entry.nodeId.includes(':')));
  assert.deepEqual(storyFlowLayout(project, component).nodes, root.nodes);
  assert.deepEqual(storyFlowLayout(project, component, 'call-body:x').nodes, inner.nodes);
  assert.deepEqual(component.list!.flowContent!.scriptViews, { 'call-body:x': { x: { x: 45, y: 55 } } });
  assert.equal(JSON.stringify(project.nodes), story);
  const entry = component.list!.flowContent!.custom!.entries.find(item => item.nodeId === 'x')!;
  assert.equal(entry.name, '寄｜书'); assert.equal(entry.styleId, 'letter');
});

test('mode switches, custom regeneration and resets leave the other mode untouched', () => {
  const { project, component } = fixture();
  setPlayerFlowPosition(component, 'x', { x: 15, y: 25 }, 'call-body:x');
  initializePlayerFlowCustom(project, component, 'copy');
  setPlayerFlowPosition(component, 'x', { x: 515, y: 625 }, 'call-body:x');
  setPlayerFlowPosition(component, 'call:first', { x: 450, y: 120 });
  const customBefore = JSON.stringify(component.list!.flowContent!.custom);
  assert.equal(setPlayerFlowMode(component, 'script'), true);
  assert.deepEqual(playerFlowPositions(component, 'call-body:x').x, { x: 15, y: 25 });
  assert.equal(clearPlayerFlowPositions(component), false);
  assert.equal(JSON.stringify(component.list!.flowContent!.custom), customBefore);
  assert.equal(setPlayerFlowMode(component, 'custom'), true);
  assert.deepEqual(playerFlowPositions(component, 'call-body:x').x, { x: 515, y: 625 });
  clearPlayerFlowPositions(component);
  assert.deepEqual(playerFlowPositions(component, 'call-body:x').x, { x: 515, y: 625 });
  initializePlayerFlowCustom(project, component, 'empty');
  assert.deepEqual(component.list!.flowContent!.custom, { entries: [] });
  assert.deepEqual(component.list!.flowContent!.scriptViews, { 'call-body:x': { x: { x: 15, y: 25 } } });
});

test('positions survive schema/save/reopen and text synchronization without changing call statements', () => {
  const { project, component } = fixture();
  project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
  const script = projectToText(project);
  setPlayerFlowPosition(component, 'call:first', { x: 400, y: 230 });
  setPlayerFlowPosition(component, 'x', { x: 20, y: 30 }, 'call-body:x');
  initializePlayerFlowCustom(project, component, 'copy');
  setPlayerFlowPosition(component, 'x_tail', { x: 90, y: 300 }, 'call-body:x');
  const reopened = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(reopened.ui.components[0].list?.flowContent, component.list?.flowContent);
  assert.equal(projectToText(reopened), script);
  const synchronized = applyTextScript(reopened, script);
  assert.deepEqual(synchronized.issues, []);
  assert.deepEqual(synchronized.project.ui.components[0].list?.flowContent, component.list?.flowContent);
  assert.deepEqual(storyFlowLayout(synchronized.project, synchronized.project.ui.components[0]), storyFlowLayout(project, component));
});

function grouped() {
  const { project, component } = fixture();
  initializePlayerFlowCustom(project, component, 'copy');
  const custom = component.list!.flowContent!.custom!;
  custom.groups = [{ id: 'letters', name: '书信', nodeIds: ['x', 'x_tail'], positions: { x: { x: 100, y: 200 } } }];
  custom.views = { 'call-body:x': { 'group-view:call-body:x:letters': { x: 50, y: 60 } },
    'group-view:call-body:x:letters': { x: { x: 110, y: 220 }, x_tail: { x: 330, y: 440 } },
    'call-body:another': { x: { x: 990, y: 990 } } };
  return { project, component, custom };
}

test('removing a custom entry clears that entry positions in every view while preserving other data', () => {
  const { component, custom } = grouped();
  assert.equal(removePlayerFlowEntry(component, 'x'), true);
  for (const positions of Object.values(custom.views!)) assert.equal(positions.x, undefined);
  assert.deepEqual(custom.groups![0].nodeIds, ['x_tail']);
  assert.deepEqual(custom.views!['group-view:call-body:x:letters'].x_tail, { x: 330, y: 440 });
  assert.deepEqual(custom.views!['call-body:x']['group-view:call-body:x:letters'], { x: 50, y: 60 });
});

test('explicit reference repair updates all entry coordinates without rewriting a real call target', () => {
  const { project, component, custom } = grouped();
  const original = project.nodes.find(node => node.id === 'x')!;
  project.nodes = project.nodes.filter(node => node.id !== 'x');
  project.nodes.push({ ...structuredClone(original), id: 'new_x', name: '重新创建的寄书' });
  assert.equal(repairPlayerFlowEntry(project, component, 'x', { kind: 'node', id: 'new_x' }), true);
  assert.deepEqual(custom.views!['group-view:call-body:x:letters'].new_x, { x: 110, y: 220 });
  assert.equal(custom.views!['group-view:call-body:x:letters'].x, undefined);
  assert.deepEqual(custom.groups![0].nodeIds, ['new_x', 'x_tail']);
  assert.deepEqual(custom.views!['call-body:another'].new_x, { x: 990, y: 990 });
  const call = project.nodes.find(node => node.id === 'first')!;
  assert.equal(call.kind, 'call');
  if (call.kind === 'call') assert.equal(call.target, 'x', 'repairing a display entry cannot silently retarget authored gameplay');
});

test('changing display-group membership clears only the removed member layout inside that group', () => {
  const { component, custom } = grouped();
  assert.equal(setPlayerFlowGroupMembers(component, 'letters', ['x_tail']), true);
  assert.equal(custom.groups![0].positions!.x, undefined);
  assert.equal(custom.views!['group-view:call-body:x:letters'].x, undefined);
  assert.deepEqual(custom.views!['call-body:another'].x, { x: 990, y: 990 });
  assert.equal(removePlayerFlowEntryFromGroup(component, 'letters', 'x_tail'), true);
  assert.deepEqual(custom.views!['group-view:call-body:x:letters'], {});
});

test('dissolving a display group removes its derived cards and interior layouts only', () => {
  const { component, custom } = grouped();
  const entries = JSON.stringify(custom.entries);
  assert.equal(removePlayerFlowGroup(component, 'letters'), true);
  assert.equal(custom.views!['group-view:call-body:x:letters'], undefined);
  assert.deepEqual(custom.views!['call-body:x'], {});
  assert.deepEqual(custom.views!['call-body:another'].x, { x: 990, y: 990 });
  assert.equal(JSON.stringify(custom.entries), entries);
});

test('editing a shared body in a UI draft preserves a concurrent outer position and other mode', () => {
  const { project, component } = fixture();
  setPlayerFlowPosition(component, 'x', { x: 10, y: 20 }, 'call-body:x');
  initializePlayerFlowCustom(project, component, 'copy');
  const value = structuredClone(project), current = structuredClone(project);
  setPlayerFlowPosition(value.ui.components[0], 'x', { x: 50, y: 60 }, 'call-body:x');
  setPlayerFlowPosition(current.ui.components[0], 'call:second', { x: 600, y: 700 });
  current.ui.components[0].list!.flowContent!.scriptViews!['call-body:x'].x = { x: 90, y: 100 };
  current.assets.push({ id: 'late_import', name: '同时导入的素材', kind: 'image', path: 'assets/late.png' });
  const result = applyUiDraft(current, { base: project, value });
  assert.deepEqual(playerFlowPositions(result.ui.components[0], 'call-body:x').x, { x: 50, y: 60 });
  assert.deepEqual(playerFlowPositions(result.ui.components[0])['call:second'], { x: 600, y: 700 });
  assert.deepEqual(result.ui.components[0].list!.flowContent!.scriptViews!['call-body:x'].x, { x: 90, y: 100 });
  assert.equal(result.assets.at(-1)!.id, 'late_import');
  assert.deepEqual(playerFlowPositions(component, 'call-body:x').x, { x: 10, y: 20 });
});
