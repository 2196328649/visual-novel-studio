import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type Project, type StoryNode, type UiComponent } from '../src/core/model';
import { playerFlowViews, type PlayerFlowView } from '../src/core/player-flow-content';
import { flowEnterView, flowLocateBrowseTrail, flowBrowseTrailToView, flowValidBrowseTrail, flowPreviewNodes, playerFlowPreviewEntryIds, playerFlowPreviewOptions } from '../src/renderer/UiFlowEditing';

function fixture(): { project: Project; component: UiComponent } {
  const project = createProject('调用预览');
  const sceneId = project.scenes[0].id;
  project.chapters[0].flowchart = { visible: false };
  const passage = (id: string, next?: string): StoryNode => ({ id, sceneId, name: id, kind: 'passage', lines: [], x: 0, y: 0, next, flowchart: { visible: true } });
  const call = (id: string, target: string, next: string): StoryNode => ({ id, sceneId, name: id, kind: 'call', target, next, x: 0, y: 0 });
  project.nodes = [passage('a', 'first_call'), call('first_call', 'x', 'b'), passage('b', 'second_call'), call('second_call', 'x', 'c'), passage('c'), passage('x', 'nested_call'), call('nested_call', 'y', 'x_return'), passage('y', 'y_return'), { id: 'x_return', kind: 'return', sceneId, name: '返回', x: 0, y: 0 }, { id: 'y_return', kind: 'return', sceneId, name: '返回', x: 0, y: 0 }];
  project.entryId = 'a';
  const component: UiComponent = { id: 'flow', page: 'flowchart', kind: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1, list: { layout: 'flow', lockUnread: true, showProgress: true } };
  return { project, component };
}

test('call progress uses each call site rather than a shared content destination', () => {
  const nodes = [{ id: 'a' }, { id: 'call:first', callId: 'first', targetId: 'x', sourceEntryId: 'x' }, { id: 'call:second', callId: 'second', targetId: 'x', sourceEntryId: 'x' }];
  const preview = flowPreviewNodes(nodes, 'a', { lockUnread: true, showProgress: true }, { entryIds: ['a', 'x', 'first', 'second'], preview: { mode: 'partial' } });
  assert.equal(preview.progress.reached.has('x'), true);
  assert.equal(preview.visuals.get('call:first')?.locked, true);
  assert.equal(preview.visuals.get('call:second')?.locked, true);
  const arrived = flowPreviewNodes(nodes, 'a', { lockUnread: true, showProgress: true }, { entryIds: ['a', 'first', 'x', 'second'], preview: { mode: 'partial' } });
  assert.equal(arrived.visuals.get('call:first')?.locked, false);
  assert.equal(arrived.visuals.get('call:second')?.locked, true);
});

test('ordinary preview has no accidental current marker while one selected caller has exactly one', () => {
  const nodes = [{ id: 'a' }, { id: 'call:first', callId: 'first', targetId: 'x' }, { id: 'call:second', callId: 'second', targetId: 'x' }];
  const normal = flowPreviewNodes(nodes, 'a', { showProgress: true }, { entryIds: ['a', 'first', 'x', 'second'], preview: { mode: 'all' } });
  assert.ok([...normal.visuals.values()].every(visual => !visual.current));
  const current = flowPreviewNodes(nodes, 'a', { showProgress: true }, { entryIds: ['a', 'first', 'x', 'second'], preview: { mode: 'current', currentId: 'second' } });
  assert.deepEqual([...current.visuals].filter(([, visual]) => visual.current).map(([id]) => id), ['call:second']);
  assert.equal(current.visuals.get('call:second')?.suffix, ' · 当前');
});

test('call reference inspector forces only its own design state and keeps content progress unchanged', () => {
  const nodes = [{ id: 'a' }, { id: 'call:first', callId: 'first', sourceEntryId: 'x' }, { id: 'call:second', callId: 'second', sourceEntryId: 'x' }];
  const result = flowPreviewNodes(nodes, 'a', { lockUnread: true }, { entryIds: ['a', 'x', 'first', 'second'], preview: { mode: 'partial' }, inspector: { kind: 'call', callId: 'second' }, visualState: 'selected' });
  assert.equal(result.visuals.get('call:second')?.forced, true);
  assert.equal(result.visuals.get('call:second')?.current, true);
  assert.equal(result.visuals.get('call:first')?.forced, false);
  assert.equal(result.progress.reached.has('second'), false);
});

test('shared content style impact includes its caller references while preserving preset filtering', () => {
  const nodes = [{ id: 'a' }, { id: 'call:first', callId: 'first', sourceEntryId: 'x', styleId: 'blue' }, { id: 'call:second', callId: 'second', sourceEntryId: 'x', styleId: 'other' }];
  const result = flowPreviewNodes(nodes, 'a', {}, { preview: { mode: 'all' }, inspector: { kind: 'preset', presetId: 'blue', nodeId: 'x' }, visualState: 'pressed', impact: { nodeIds: ['x'], label: '共用文字' } });
  assert.equal(result.referenceId, 'call:first');
  assert.equal(result.visuals.get('call:first')?.affected, true);
  assert.equal(result.visuals.get('call:second')?.affected, false);
});

test('nested navigation is finite and entering an ancestor returns to its existing caller context', () => {
  const trail = [{ viewId: 'call-body:x', callId: 'first' }, { viewId: 'call-body:y', callId: 'nested' }];
  assert.deepEqual(flowEnterView(trail, { viewId: 'call-body:x', callId: 'recursive' }), [trail[0]]);
  assert.deepEqual(flowEnterView(trail, { viewId: 'call-body:y', callId: 'recursive_self' }), trail);
  assert.equal(trail.length, 2, 'the source trail is not mutated');
});

test('removed or retargeted calls invalidate only their former navigation suffix', () => {
  const { project, component } = fixture(), bundle = playerFlowViews(project, component);
  const trail = [{ viewId: 'call-body:x', callId: 'first_call' }, { viewId: 'call-body:y', callId: 'nested_call' }];
  assert.deepEqual(flowValidBrowseTrail(bundle.root, bundle.views, trail), trail);
  const nested = project.nodes.find(node => node.id === 'nested_call')!;
  assert.equal(nested.kind, 'call');
  if (nested.kind === 'call') nested.target = 'x';
  const changed = playerFlowViews(project, component);
  assert.deepEqual(flowValidBrowseTrail(changed.root, changed.views, trail), [trail[0]]);
  project.nodes = project.nodes.filter(node => node.id !== 'first_call');
  const removed = playerFlowViews(project, component);
  assert.deepEqual(flowValidBrowseTrail(removed.root, removed.views, trail), []);
});

test('content location keeps the active caller and finds nested shared contents from the root', () => {
  const { project, component } = fixture(), bundle = playerFlowViews(project, component);
  const second = [{ viewId: 'call-body:x', callId: 'second_call' }];
  assert.deepEqual(flowLocateBrowseTrail(bundle.root, bundle.views, 'x', second), second);
  assert.deepEqual(flowLocateBrowseTrail(bundle.root, bundle.views, 'y', second), [...second, { viewId: 'call-body:y', callId: 'nested_call' }]);
  const rootWithSharedEntry = { ...bundle.root, entries: [...bundle.root.entries, { id: 'y', name: 'y' }] };
  assert.deepEqual(flowLocateBrowseTrail(rootWithSharedEntry, bundle.views, 'y', second), [...second, { viewId: 'call-body:y', callId: 'nested_call' }], 'editing within a caller keeps that context even when the content is also directly visible at root');
  assert.deepEqual(flowLocateBrowseTrail(bundle.root, bundle.views, 'y'), [{ viewId: 'call-body:x', callId: 'first_call' }, { viewId: 'call-body:y', callId: 'nested_call' }]);
  assert.equal(flowLocateBrowseTrail(bundle.root, bundle.views, 'missing'), undefined);
});

test('expanded author groups stay navigable without requiring a collapsed card', () => {
  const root: PlayerFlowView = { kind: 'root', entries: [{ id: 'a', name: 'a' }], edges: [], locations: { a: 'a' } };
  const group: PlayerFlowView = { id: 'group', kind: 'group', groupId: 'group', name: '分组', entries: [{ id: 'a', name: 'a' }], edges: [], locations: { a: 'a' } };
  assert.deepEqual(flowValidBrowseTrail(root, new Map([['group', group]]), [{ viewId: 'group' }]), [{ viewId: 'group' }]);
});

test('the content manager can find an expanded author group inside a shared call body', () => {
  const { project, component } = fixture();
  component.list!.flowContent = { mode: 'custom', custom: { entries: ['a', 'b', 'c', 'x', 'y'].map(nodeId => ({ nodeId })), groups: [{ id: 'letters', name: '信件', nodeIds: ['x'], collapsed: false }] } };
  const bundle = playerFlowViews(project, component), viewId = 'group-view:call-body:x:letters';
  const trail = flowBrowseTrailToView(bundle.root, bundle.views, viewId);
  assert.deepEqual(trail, [{ viewId: 'call-body:x', callId: 'first_call' }, { viewId }]);
  assert.deepEqual(flowValidBrowseTrail(bundle.root, bundle.views, trail!), trail);
});

test('preview choices include distinct call locations and do not rewrite authored content', () => {
  const { project, component } = fixture(), before = JSON.stringify({ project, component });
  const ids = playerFlowPreviewEntryIds(project, component), options = playerFlowPreviewOptions(project, component);
  assert.ok(ids.includes('first_call') && ids.includes('second_call') && ids.includes('nested_call'));
  assert.equal(ids.filter(id => id === 'x').length, 1);
  assert.ok(options.find(option => option.id === 'first_call')?.name.includes('调用位置'));
  assert.equal(JSON.stringify({ project, component }), before);
});
