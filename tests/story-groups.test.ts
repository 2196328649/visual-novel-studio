import test from 'node:test';
import assert from 'node:assert/strict';
import { connectNode, newNode, projectSchema } from '../src/core/model';
import { createStoryGroup, ungroupStoryGroup, addNodeToStoryGroup, pruneStoryGroups, storyGroupIndex, storyGroupNodeId } from '../src/core/story-groups';
import { projectStoryGraph, storyNodeScope, storyScopeBreadcrumbs, validStoryScope } from '../src/core/story-graph';
import { mutateProject } from '../src/core/project-mutation';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { applyUiDraft } from '../src/core/ui-draft';
import { compileProject } from '../src/runtime/compiler';
import { storyFlowLayout } from '../src/core/story-flow';
import { storyGroupsFixture } from './fixtures/story-groups';
import { copyStoryModule, createStoryModule, insertStoryModule, removeStoryModule } from '../src/core/story-modules';

test('grouping preserves all story IDs, paths, scene membership, generated runtime and player flowchart', () => {
  const before = storyGroupsFixture(), p = structuredClone(before);
  const group = createStoryGroup(p, { name: '车站支线', sceneId: 'station', nodeIds: ['choice', 'leave_story', 'stay_story'], groupIds: [] });
  assert.deepEqual(p.nodes, before.nodes); assert.deepEqual(p.scenes, before.scenes); assert.equal(p.entryId, before.entryId);
  assert.deepEqual(compileProject(p).files, compileProject(before).files);
  const component = { id: 'player_map', name: '剧情回顾', text: '', kind: 'flowchart' as const, page: 'flowchart' as const, x: 0, y: 0, width: 1, height: 1 };
  assert.deepEqual(storyFlowLayout(p, component), storyFlowLayout(before, component));
  const view = projectStoryGraph(p, { kind: 'scene', sceneId: 'station' });
  const card = view.containers.find(card => card.groupId === group.id)!;
  assert.equal(card.nodeIds.size, 3);
  assert.deepEqual(card.inputs.filter(port => port.nodeId).map(port => port.nodeId).sort(), ['choice', 'stay_story']);
  assert.deepEqual(card.outputs.map(port => port.nodeId).sort(), ['leave_story', 'stay_story']);
  assert.equal(view.wires.find(wire => wire.id === 'back_to_station:target')?.targetHandle, 'in:stay_story');
  assert.equal(view.wires.find(wire => wire.id === 'opening:next')?.targetHandle, 'in:choice');
  assert.equal(view.wires.some(wire => wire.id === 'choice:leave'), false);
  const inside = projectStoryGraph(p, { kind: 'scene', sceneId: 'station', groupId: group.id });
  assert.deepEqual(inside.stories.map(node => node.id), ['choice', 'leave_story', 'stay_story']);
  assert.ok(inside.wires.some(wire => wire.storyTarget === 'port_story'));
  assert.ok(inside.containers.some(card => card.targetNodeId === 'back_to_station'));
  assert.deepEqual(projectSchema.parse(JSON.parse(JSON.stringify(p))).storyGroups, p.storyGroups);
});

test('nested groups retain exact multi-entry and multi-exit mappings including duplicate display names', () => {
  const p = storyGroupsFixture();
  const inner = createStoryGroup(p, { name: '同名支线', sceneId: 'station', nodeIds: ['leave_story', 'stay_story'], groupIds: [] });
  const outer = createStoryGroup(p, { name: '完整车站', sceneId: 'station', nodeIds: ['choice'], groupIds: [inner.id] });
  assert.equal(inner.parentId, outer.id); assert.equal(storyGroupIndex(p).members(outer.id).size, 3);
  const scope = storyNodeScope(p, 'stay_story')!;
  assert.deepEqual(scope, { kind: 'scene', sceneId: 'station', groupId: inner.id });
  assert.deepEqual(storyScopeBreadcrumbs(p, scope).map(crumb => crumb.name), ['流程图', '游戏内容', '第一章 / 车站', '完整车站', '同名支线']);
  const view = projectStoryGraph(p, { kind: 'scene', sceneId: 'station', groupId: outer.id });
  const card = view.containers.find(card => card.groupId === inner.id)!;
  assert.deepEqual(card.inputs.filter(port => port.nodeId).map(port => port.nodeId).sort(), ['leave_story', 'stay_story']);
  p.nodes.find(node => node.id === 'leave_story')!.name = p.nodes.find(node => node.id === 'stay_story')!.name;
  const duplicate = projectStoryGraph(p, { kind: 'scene', sceneId: 'station', groupId: outer.id });
  assert.equal(duplicate.containers.find(card => card.groupId === inner.id)!.outputs.length, 2);
  assert.notEqual(duplicate.wires.find(wire => wire.id === 'leave_story:next')!.sourceHandle, duplicate.wires.find(wire => wire.id === 'stay_story:next')!.sourceHandle);
});

test('ungroup keeps internal edits and added nodes, reparents nested groups and expands at the moved position', () => {
  const p = storyGroupsFixture();
  const group = createStoryGroup(p, { name: '车站', sceneId: 'station', nodeIds: ['choice', 'leave_story', 'stay_story'], groupIds: [] });
  const inner = createStoryGroup(p, { name: '谈话', sceneId: 'station', parentId: group.id, nodeIds: ['stay_story'], groupIds: [] });
  const added = newNode('passage', 'station'); p.nodes.push(added); addNodeToStoryGroup(p, added.id, group.id);
  p.nodes = p.nodes.map(node => node.id === 'leave_story' ? connectNode(node, 'next', added.id) : node);
  group.x += 500; group.y += 50;
  const before = structuredClone(p), oldGroupPosition = { x: group.x, y: group.y };
  ungroupStoryGroup(p, group.id);
  assert.equal(p.storyGroups!.length, 1); assert.equal(inner.parentId, undefined);
  assert.equal(p.nodes.filter(node => node.kind === 'passage').find(node => node.id === 'leave_story')?.next, added.id);
  assert.ok(p.nodes.some(node => node.id === added.id));
  assert.equal(Math.min(...p.nodes.filter(node => before.storyGroups![0].nodeIds.includes(node.id)).map(node => node.x), inner.x), oldGroupPosition.x);
  assert.deepEqual(compileProject(p).files, compileProject(before).files);
  assert.equal(validStoryScope(p, { kind: 'scene', sceneId: 'station', groupId: group.id }).kind, 'scene');
});

test('invalid grouping is atomic and schema rejects cycles, duplicate ownership and cross-scene members', () => {
  const p = storyGroupsFixture();
  const group = createStoryGroup(p, { name: '车站', sceneId: 'station', nodeIds: ['choice'], groupIds: [] });
  for (const options of [
    { name: '', sceneId: 'station', nodeIds: ['stay_story'], groupIds: [] },
    { name: '错误', sceneId: 'station', nodeIds: ['port_story'], groupIds: [] },
    { name: '错误', sceneId: 'station', nodeIds: ['choice'], groupIds: [] },
    { name: '错误', sceneId: 'station', nodeIds: [], groupIds: [] },
  ]) { const before = structuredClone(p); assert.throws(() => createStoryGroup(p, options)); assert.deepEqual(p, before); }
  const cyclic = structuredClone(p); cyclic.storyGroups![0].parentId = group.id;
  assert.equal(projectSchema.safeParse(cyclic).success, false);
  const duplicate = structuredClone(p); duplicate.storyGroups!.push({ ...group, id: 'other_group' });
  assert.equal(projectSchema.safeParse(duplicate).success, false);
  const cross = structuredClone(p); cross.storyGroups![0].nodeIds.push('port_story');
  assert.equal(projectSchema.safeParse(cross).success, false);
});

test('text and UI draft roundtrips retain grouping and deleted members are pruned by stable ID', () => {
  const base = storyGroupsFixture();
  const p = mutateProject(base, draft => { createStoryGroup(draft, { name: '车站', sceneId: 'station', nodeIds: ['choice', 'stay_story'], groupIds: [] }); });
  const text = applyTextScript(p, projectToText(p));
  assert.deepEqual(text.issues, []); assert.deepEqual(text.project.storyGroups, p.storyGroups);
  const uiValue = mutateProject(base, draft => { draft.ui.fontSize = 44; });
  const merged = applyUiDraft(p, { base, value: uiValue });
  assert.deepEqual(merged.storyGroups, p.storyGroups); assert.equal(merged.ui.fontSize, 44);
  const removed = mutateProject(p, draft => { draft.nodes = draft.nodes.filter(node => node.id !== 'stay_story'); pruneStoryGroups(draft); });
  assert.deepEqual(removed.storyGroups![0].nodeIds, ['choice']); assert.deepEqual(p.storyGroups![0].nodeIds, ['choice', 'stay_story']);
  assert.equal(mutateProject(p, draft => pruneStoryGroups(draft)), p);
  const noScene = structuredClone(p); noScene.scenes = noScene.scenes.filter(scene => scene.id !== 'station'); pruneStoryGroups(noScene);
  assert.equal(noScene.storyGroups!.length, 0);
});

test('entry, return-to-title, call-return and unconnected exits survive every projection', () => {
  const p = storyGroupsFixture();
  const group = createStoryGroup(p, { name: '包含入口', sceneId: 'station', nodeIds: ['opening', 'end'], groupIds: [] });
  const root = projectStoryGraph(p, { kind: 'scene', sceneId: 'station' });
  const card = root.containers.find(card => card.groupId === group.id)!;
  assert.equal(card.containsEntry, true);
  assert.equal(root.wires.find(wire => wire.id === 'story:entry')!.target, storyGroupNodeId(group.id));
  assert.equal(root.wires.find(wire => wire.id === 'end:returnTitle')!.readonly, true);
  const common = projectStoryGraph(p, { kind: 'scene', sceneId: 'common' });
  assert.match(common.wires.find(wire => wire.id === 'memory_return:returnCall')!.label, /运行时决定/);
  const broken = createStoryGroup(p, { name: '暂未接线', sceneId: 'station', nodeIds: ['stay_story'], groupIds: [] });
  p.nodes = p.nodes.map(node => node.id === 'stay_story' ? connectNode(node, 'next') : node);
  const disconnected = projectStoryGraph(p, { kind: 'scene', sceneId: 'station' }, [{ severity: 'error', nodeId: 'stay_story', message: '未连接的出口' }]);
  const brokenCard = disconnected.containers.find(card => card.groupId === broken.id)!;
  assert.equal(brokenCard.outputs[0].port, 'next'); assert.equal(brokenCard.issues.length, 1);
  assert.equal(disconnected.wires.some(wire => wire.id === 'stay_story:next'), false);
});

test('story loops across group boundaries remain distinct from containment cycles', () => {
  const p = storyGroupsFixture();
  p.nodes = p.nodes.map(node => node.id === 'night' ? connectNode(node, 'next', 'choice') : node);
  const before = compileProject(p).files;
  createStoryGroup(p, { name: '循环支线', sceneId: 'station', nodeIds: ['choice', 'stay_story'], groupIds: [] });
  const view = projectStoryGraph(p, { kind: 'scene', sceneId: 'station' });
  assert.ok(view.wires.some(wire => wire.id === 'night:next')); assert.ok(view.wires.some(wire => wire.id === 'stay_story:next'));
  assert.equal(projectSchema.safeParse(p).success, true); assert.deepEqual(compileProject(p).files, before);
});

test('module insertion and pasted copies inherit the anchor group and removal preserves paths and ownership', () => {
  const p = storyGroupsFixture();
  const group = createStoryGroup(p, { name: '车站谈话', sceneId: 'station', nodeIds: ['stay_story'], groupIds: [] });
  const inner = createStoryGroup(p, { name: '片段', sceneId: 'station', parentId: group.id, nodeIds: ['stay_story'], groupIds: [] });
  const before = compileProject(p).files;
  const added = createStoryModule('dialogue', 'station');
  insertStoryModule(p, added, 'station', 'stay_story', 'below');
  const pasted = copyStoryModule(added);
  insertStoryModule(p, pasted, 'station', added.id, 'above');
  assert.deepEqual(inner.nodeIds, ['stay_story', added.id, pasted.id]);
  assert.deepEqual(storyNodeScope(p, added.id), { kind: 'scene', sceneId: 'station', groupId: inner.id });
  assert.equal(p.nodes.filter(node => node.kind === 'passage').find(node => node.id === 'stay_story')?.next, pasted.id);
  removeStoryModule(p, pasted.id); removeStoryModule(p, added.id);
  assert.deepEqual(inner.nodeIds, ['stay_story']); assert.deepEqual(group.nodeIds, []);
  assert.equal(projectSchema.safeParse(p).success, true);
  assert.deepEqual(compileProject(p).files, before);
});
