import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type StoryNode, type UiComponent } from '../src/core/model';
import { flowInspectorReference, flowPreviewNodes, flowPreviewNodeVisual, flowPreviewProgress, flowPreviewReference, flowPreviewSample } from '../src/renderer/UiFlowEditing';

test('design state targets the reference and exact affected nodes without changing progress', () => {
  const progress = flowPreviewProgress(['entry', 'first', 'second', 'third'], 'entry', { mode: 'partial' });
  const before = [...progress.reached], affectedIds = new Set(['second']);
  const options = { lockUnread: true, referenceId: 'first', affectedIds, visualState: 'pressed' as const };
  assert.equal(flowPreviewNodeVisual('first', progress, options).state, 'pressed');
  assert.equal(flowPreviewNodeVisual('second', progress, options).state, 'pressed');
  assert.equal(flowPreviewNodeVisual('second', progress, options).locked, false);
  assert.equal(flowPreviewNodeVisual('third', progress, options).state, 'disabled');
  assert.equal(flowPreviewNodeVisual('third', progress, options).forced, false);
  assert.equal(flowPreviewNodeVisual('entry', progress, options).state, 'idle');
  assert.deepEqual([...progress.reached], before);
  assert.equal(progress.currentId, undefined);
});

test('design unread state can be shown on a reached node with player locking disabled', () => {
  const progress = flowPreviewProgress(['entry', 'end'], 'entry', { mode: 'all' });
  const node = flowPreviewNodeVisual('entry', progress, { lockUnread: false, referenceId: 'entry', visualState: 'disabled' });
  assert.equal(node.state, 'disabled');
  assert.equal(node.locked, true);
  assert.equal(node.forced, true);
  assert.ok(progress.reached.has('entry'));
  // Returning to normal preview restores actual reachability.
  assert.equal(flowPreviewNodeVisual('entry', progress, { lockUnread: false }).locked, false);
});

test('shared current-state design sample has one current marker on its reference', () => {
  const ids = ['entry', 'first', 'second'], progress = flowPreviewProgress(ids, 'entry', { mode: 'current' });
  const options = { referenceId: 'first', affectedIds: new Set(['first', 'second']), visualState: 'selected' as const };
  const nodes = ids.map(id => ({ id, ...flowPreviewNodeVisual(id, progress, options) }));
  assert.deepEqual(nodes.filter(node => node.current).map(node => node.id), ['first']);
  assert.equal(nodes.find(node => node.id === 'second')!.state, 'selected');
  assert.equal(nodes.find(node => node.id === 'second')!.affected, true);
  assert.equal(progress.currentId, 'entry');
});

test('ordinary preview retains reached, current and mouse state precedence after design state clears', () => {
  const progress = { reached: new Set(['entry', 'first']), currentId: 'entry' };
  const options = { lockUnread: true, hoveredId: 'first', pressedId: 'first', referenceId: 'first', affectedIds: new Set(['second']) };
  assert.equal(flowPreviewNodeVisual('entry', progress, options).state, 'selected');
  assert.equal(flowPreviewNodeVisual('first', progress, options).state, 'pressed');
  assert.equal(flowPreviewNodeVisual('first', progress, { ...options, pressedId: undefined }).state, 'hover');
  assert.equal(flowPreviewNodeVisual('second', progress, options).state, 'disabled');
  assert.equal(flowPreviewNodeVisual('second', progress, options).forced, false);
});

test('reference selection ignores absent nodes and falls back to visible affected nodes or progress', () => {
  const ids = ['entry', 'first', 'second'];
  assert.equal(flowPreviewReference(ids, 'second', ['first'], 'entry'), 'second');
  assert.equal(flowPreviewReference(ids, 'removed', ['hidden', 'first'], 'entry'), 'first');
  assert.equal(flowPreviewReference(ids, 'removed', [], 'second'), 'second');
  assert.equal(flowPreviewReference(ids, undefined, ['hidden'], 'removed'), 'entry');
  assert.equal(flowPreviewReference([], 'removed', ['hidden'], 'entry'), undefined);
  assert.equal(flowPreviewReference(ids, undefined, [], 'second', false), undefined);
});

test('a preset reference follows its real users after assignment undo and clears when none remain', () => {
  const nodes = [{ id: 'entry' }, { id: 'first', styleId: 'main' }, { id: 'second', styleId: 'main' }];
  const target = { kind: 'preset' as const, presetId: 'main', nodeId: 'second' };
  assert.equal(flowInspectorReference(target, nodes), 'second');
  const undone = nodes.map(node => node.id === 'second' ? { id: node.id } : node);
  assert.equal(flowInspectorReference(target, undone), 'first');
  const preview = flowPreviewNodes(undone, 'entry', { showProgress: true }, {
    inspector: target, nodeId: 'second', preview: { mode: 'all' }, visualState: 'selected',
    impact: { nodeIds: ['first', 'second'], label: '' },
  });
  assert.equal(preview.referenceId, 'first');
  assert.equal(preview.visuals.get('first')!.current, true);
  assert.equal(preview.visuals.get('second')!.forced, false);
  assert.equal(preview.visuals.get('second')!.affected, false);
  assert.equal(flowInspectorReference(target, nodes.map(node => ({ id: node.id }))), undefined);
  assert.equal(flowInspectorReference({ kind: 'preset', presetId: '', nodeId: 'entry' }, nodes), undefined);
});

test('an unused preset cannot force unrelated nodes or suppress the natural current location', () => {
  const nodes = [{ id: 'entry' }, { id: 'first', styleId: 'other' }];
  for (const visualState of ['pressed', 'selected', 'disabled'] as const) {
    const { referenceId, visuals } = flowPreviewNodes(nodes, 'entry', { showProgress: true }, {
      inspector: { kind: 'preset', presetId: 'unused' }, preview: { mode: 'current', currentId: 'first' }, visualState,
      impact: { nodeIds: ['entry', 'first'], label: 'stale impact' },
    });
    assert.equal(referenceId, undefined);
    assert.ok([...visuals.values()].every(node => !node.forced && !node.affected));
    assert.equal(visuals.get('first')!.state, 'selected');
    assert.equal(visuals.get('first')!.current, true);
    assert.equal(visuals.get('first')!.suffix, ' · 当前');
    assert.equal(visuals.get('entry')!.suffix, ' · 已读');
  }
});

test('automatic progress captions and forced samples follow the same reachability rules', () => {
  const nodes = ['entry', 'first', 'second', 'third'].map(id => ({ id }));
  const list = { lockUnread: true, showProgress: true };
  const session = { inspector: { kind: 'node' as const, nodeId: 'third' }, nodeId: 'third', preview: { mode: 'partial' as const } };
  const automatic = flowPreviewNodes(nodes, 'entry', list, session);
  assert.equal(automatic.visuals.get('entry')!.suffix, ' · 已读');
  assert.equal(automatic.visuals.get('third')!.state, 'disabled');
  assert.equal(automatic.visuals.get('third')!.suffix, '');
  const unlocked = flowPreviewNodes(nodes, 'entry', { ...list, lockUnread: false }, session);
  assert.equal(unlocked.visuals.get('third')!.state, 'idle');
  assert.equal(unlocked.visuals.get('third')!.suffix, '');
  const forced = flowPreviewNodes(nodes, 'entry', list, { ...session, visualState: 'selected' });
  assert.equal(forced.visuals.get('third')!.state, 'selected');
  assert.equal(forced.visuals.get('third')!.suffix, ' · 当前');
  assert.equal(forced.progress.reached.has('third'), false, 'design current state does not write player progress');
});

test('real samples use layout ordering and collapsed entry locations, matching each canvas', () => {
  const project = createProject('preview order'), sceneId = project.scenes[0].id;
  project.chapters[0].flowchart = { visible: false };
  const passage = (id: string, next?: string): StoryNode => ({ id, name: id, sceneId, x: 0, y: 0, kind: 'passage', lines: [], next, flowchart: { visible: id !== 'hidden' } });
  project.nodes = [passage('third'), passage('first', 'second'), passage('second', 'hidden'), passage('hidden', 'third')];
  project.entryId = 'hidden';
  const component: UiComponent = { id: 'flow', page: 'flowchart', kind: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1, list: { layout: 'flow', lockUnread: true, showProgress: true } };
  const before = JSON.stringify(project);
  const partial = { preview: { mode: 'partial' as const } };
  assert.equal(flowPreviewSample(project, component, 'third', partial)!.state, 'disabled');
  assert.equal(flowPreviewSample(project, component, 'second', partial)!.suffix, ' · 已读');
  const current = { preview: { mode: 'current' as const } };
  assert.equal(flowPreviewSample(project, component, 'second', current)!.state, 'selected');
  assert.equal(flowPreviewSample(project, component, 'second', current)!.suffix, ' · 当前');
  component.list!.layout = 'grid';
  assert.equal(flowPreviewSample(project, component, 'second', partial)!.state, 'disabled');
  assert.equal(flowPreviewSample(project, component, 'third', partial)!.suffix, ' · 已读');
  assert.equal(flowPreviewSample(project, component, 'third', current)!.current, true);
  assert.equal(flowPreviewSample(project, component, 'not-a-real-node', current), undefined);
  assert.equal(JSON.stringify(project), before, 'preview analysis must not alter the project');
});

test('display groups aggregate real progress and keep the same sample after entering', () => {
  const entryIds = ['first', 'second', 'third', 'fourth'];
  const nodes = [{ id: 'first' }, { id: 'branch', groupId: 'branch', memberIds: ['second', 'third'] }, { id: 'fourth' }];
  const preview = { mode: 'partial' as const, currentId: 'first' };
  const root = flowPreviewNodes(nodes, 'first', { lockUnread: true, showProgress: true }, { preview, entryIds });
  assert.equal(root.visuals.get('branch')?.locked, false, 'one reached member makes the group browsable');
  assert.equal(root.visuals.get('branch')?.suffix, ' · 已读 1/2');
  assert.equal(root.visuals.get('fourth')?.locked, true);
  const interior = flowPreviewNodes([{ id: 'second' }, { id: 'third' }], 'first', { lockUnread: true }, { preview, entryIds, groupId: 'branch' });
  assert.equal(interior.visuals.get('second')?.locked, false);
  assert.equal(interior.visuals.get('third')?.locked, true, 'entering does not unlock a previously unread member');
  const current = flowPreviewNodes(nodes, 'first', { showProgress: true }, { preview: { mode: 'current', currentId: 'third' }, entryIds });
  assert.equal(current.visuals.get('branch')?.current, true);
  assert.equal(current.visuals.get('branch')?.suffix, ' · 当前');
});

test('custom inspector samples use this control and its active group without altering data', () => {
  const project = createProject('custom preview'), sceneId = project.scenes[0].id;
  project.nodes = ['one', 'two', 'three'].map(id => ({ id, name: id, sceneId, x: 0, y: 0, kind: 'passage', lines: [] }));
  project.entryId = 'one';
  const component: UiComponent = { id: 'flow', page: 'flowchart', kind: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1,
    list: { layout: 'grid', lockUnread: true, flowContent: { mode: 'custom', custom: { entries: project.nodes.map(node => ({ nodeId: node.id })), groups: [{ id: 'display_group', name: '分支', nodeIds: ['two', 'three'] }] } } } };
  const before = JSON.stringify({ project, component });
  assert.equal(flowPreviewSample(project, component, 'display_group', { preview: { mode: 'partial' } })?.locked, false);
  assert.equal(flowPreviewSample(project, component, 'three', { preview: { mode: 'partial' }, groupId: 'display_group' })?.locked, true);
  assert.equal(flowPreviewSample(project, component, 'three', { preview: { mode: 'partial' } }), undefined, 'collapsed members are absent from the root');
  assert.equal(JSON.stringify({ project, component }), before);
});
