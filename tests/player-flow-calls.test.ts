import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, projectSchema, type Project, type StoryNode, type UiComponent } from '../src/core/model';
import { playerFlowAllEntries, playerFlowCallAnalysis, playerFlowCallViewId, playerFlowEntries, playerFlowPositions, playerFlowView, playerFlowViews, setPlayerFlowPosition } from '../src/core/player-flow-content';
import { initializePlayerFlowCustom, setPlayerFlowMode } from '../src/core/player-flow-authoring';
import { storyFlowLayout } from '../src/core/story-flow';
import { storyFlowConnections, flowEdgeUnlocked } from '../src/core/story-flow-connections';

function fixture() {
  const project = createProject();
  project.chapters[0].flowchart = { visible: false };
  const base = (id: string) => ({ id, name: id, sceneId: project.scenes[0].id, x: 0, y: 0 });
  const passage = (id: string, next?: string): StoryNode => ({ ...base(id), kind: 'passage', lines: [{ id: `${id.slice(0, 58)}_line`, text: id, actions: [] }], next, flowchart: { visible: true } });
  const call = (id: string, target?: string, next?: string): StoryNode => ({ ...base(id), kind: 'call', target, next });
  const ret = (id: string): StoryNode => ({ ...base(id), kind: 'return' });
  const end = (id: string): StoryNode => ({ ...base(id), kind: 'end', flowchart: { visible: true } });
  project.nodes = [passage('a', 'call_x'), call('call_x', 'x', 'b'), passage('b', 'call_x_again'), call('call_x_again', 'x', 'c'), end('c'), passage('x', 'return_x'), ret('return_x')];
  project.entryId = 'a';
  const component: UiComponent = { id: 'map', page: 'flowchart', kind: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1, list: { layout: 'flow' } };
  return { project, component, base, passage, call, ret, end };
}

const pairs = (view: { edges: { from: string; to: string }[] }) => view.edges.map(edge => `${edge.from}>${edge.to}`).sort();
const ids = (view: { entries: { id: string }[] }) => view.entries.map(entry => entry.id);
const custom = (project: Project, component: UiComponent, entries: string[]) => {
  component.list!.flowContent = { mode: 'custom', custom: { entries: entries.map(nodeId => ({ nodeId })) } };
  return playerFlowViews(project, component);
};

test('each call keeps its own continuation and shares one body with no false choice', () => {
  const { project, component } = fixture(), before = JSON.stringify({ project, component });
  const { root, views, hasCalls } = playerFlowViews(project, component);
  assert.equal(hasCalls, true);
  assert.deepEqual(ids(root), ['a', 'call:call_x', 'b', 'call:call_x_again', 'c']);
  assert.deepEqual(pairs(root), ['a>call:call_x', 'b>call:call_x_again', 'call:call_x>b', 'call:call_x_again>c']);
  assert.deepEqual([...views.keys()], ['call-body:x']);
  assert.deepEqual(ids(views.get('call-body:x')!), ['x']);
  assert.deepEqual(pairs(views.get('call-body:x')!), []);
  assert.equal(root.entries.find(entry => entry.callId === 'call_x')!.viewId, root.entries.find(entry => entry.callId === 'call_x_again')!.viewId);
  assert.deepEqual(root.callLocations, { call_x: 'call:call_x', call_x_again: 'call:call_x_again' });
  assert.equal(root.locations.x, undefined);
  assert.equal(views.get('call-body:x')!.locations.return_x, 'x');
  assert.equal(JSON.stringify({ project, component }), before);
});

test('call routes retain actual endpoints so another invocation does not unlock this one', () => {
  const { project, component } = fixture();
  const graph = storyFlowLayout(project, component), first = graph.edges.find(edge => edge.from === 'a')!;
  assert.deepEqual(first.endpoints, [{ from: 'a', to: 'call_x' }]);
  assert.deepEqual(first.paths, [{ nodeIds: ['a', 'call_x'], labels: [] }]);
  assert.equal(flowEdgeUnlocked(first, id => ['a', 'x', 'call_x_again'].includes(id)), false);
  assert.equal(flowEdgeUnlocked(first, id => ['a', 'call_x'].includes(id)), true);
  const continuation = graph.edges.find(edge => edge.from === 'call:call_x')!;
  assert.deepEqual(continuation.endpoints, [{ from: 'call_x', to: 'b' }]);
  assert.equal(flowEdgeUnlocked(continuation, id => ['call_x_again', 'b'].includes(id)), false);
  assert.deepEqual(new Set(graph.nodeIds), new Set(['a', 'call_x', 'b', 'call_x_again', 'c']));
  assert.deepEqual(graph.progressIds, ['a', 'b', 'c', 'x']);
});

test('genuine alternatives remain branches while a directly reachable body stays on the outer map', () => {
  const { project, component, base } = fixture();
  project.nodes.unshift({ ...base('choose'), kind: 'choice', prompt: '', choices: [{ id: 'invoke', text: '先办正事', target: 'a' }, { id: 'direct', text: '直接寄书', target: 'x' }], flowchart: { visible: true } });
  project.entryId = 'choose';
  const { root, views } = playerFlowViews(project, component);
  assert.ok(ids(root).includes('x'));
  assert.ok(ids(views.get('call-body:x')!).includes('x'));
  assert.equal(root.edges.find(edge => edge.from === 'choose' && edge.to === 'a')!.label, '先办正事');
  assert.equal(root.edges.find(edge => edge.from === 'choose' && edge.to === 'x')!.label, '直接寄书');
  assert.equal(root.edges.some(edge => edge.from === 'x' && ['b', 'c'].includes(edge.to)), false);
});

test('an unselected body stays hidden in custom maps without revealing its title', () => {
  const { project, component } = fixture();
  project.nodes.find(node => node.id === 'x')!.name = '保密章节标题';
  const { root } = custom(project, component, ['a', 'b', 'c']);
  assert.deepEqual(ids(root), ['a', 'b', 'c']);
  assert.deepEqual(pairs(root), ['a>b', 'b>c']);
  assert.equal(JSON.stringify(root).includes('保密章节标题'), false);
  assert.deepEqual(root.callLocations, { call_x: 'a', call_x_again: 'b' });
  assert.deepEqual(playerFlowAllEntries(project, component).map(entry => entry.id), ['a', 'b', 'c']);
  custom(project, component, []);
  assert.deepEqual(playerFlowEntries(project, component), []);
});

test('a hidden target takes its caption only from selected content inside its body', () => {
  const { project, component, passage } = fixture();
  const x = project.nodes.find(node => node.id === 'x')!;
  if (x.kind === 'passage') x.next = 'letter';
  x.name = '不可泄露的入口';
  project.nodes.push({ ...passage('letter', 'return_x'), name: '寄书' });
  const { root, views } = custom(project, component, ['a', 'b', 'c', 'letter']);
  const card = root.entries.find(entry => entry.callId === 'call_x')!;
  assert.equal(card.name, '寄书'); assert.equal(card.sourceEntryId, 'letter'); assert.equal(card.targetId, 'x');
  assert.equal(JSON.stringify(root).includes('不可泄露的入口'), false);
  assert.deepEqual(ids(views.get('call-body:x')!), ['letter']);
  assert.ok(views.get('call-body:x')!.nodeIds!.includes('x'));
});

test('nested calls are opaque in each scope and return only to that caller', () => {
  const { project, component, passage, call, ret } = fixture();
  const x = project.nodes.find(node => node.id === 'x')!;
  if (x.kind === 'passage') x.next = 'call_y';
  project.nodes.push(call('call_y', 'y', 'x_after'), passage('x_after', 'return_x'), passage('y', 'return_y'), ret('return_y'));
  const { root, views } = playerFlowViews(project, component), body = views.get('call-body:x')!;
  assert.deepEqual(ids(body), ['x', 'call:call_y', 'x_after']);
  assert.deepEqual(pairs(body), ['call:call_y>x_after', 'x>call:call_y']);
  assert.equal(ids(root).includes('y'), false);
  assert.deepEqual(ids(views.get('call-body:y')!), ['y']);
  assert.equal(body.locations.y, undefined);
  assert.equal(body.callLocations!.call_y, 'call:call_y');
});

test('mutual recursion with a return branch reaches a finite fixed point and finite views', () => {
  const { project, component, base, call, ret } = fixture();
  const x = project.nodes.find(node => node.id === 'x')!;
  if (x.kind === 'passage') x.next = 'choose_recursion';
  project.nodes.push({ ...base('choose_recursion'), kind: 'choice', prompt: '', choices: [{ id: 'again', text: '继续', target: 'recurse' }, { id: 'stop', text: '离开', target: 'return_x' }] }, call('recurse', 'y', 'return_x'), call('y', 'x', 'return_y'), ret('return_y'));
  const analysis = playerFlowCallAnalysis(project);
  assert.equal(analysis.mayReturn.has('x'), true); assert.equal(analysis.mayReturn.has('y'), true);
  const { views, root } = playerFlowViews(project, component);
  assert.equal(views.size, 2);
  assert.ok(pairs(root).includes('call:call_x>b'));
  assert.equal(views.get('call-body:x')!.entries.find(entry => entry.callId === 'recurse')!.viewId, 'call-body:y');
  assert.equal(views.get('call-body:y')!.entries.find(entry => entry.callId === 'y')!.viewId, 'call-body:x');
  assert.equal(views.get('call-body:y')!.entries.find(entry => entry.callId === 'y')!.name, 'x');
});

test('unconditional recursion and missing targets never invent a continuation', () => {
  const { project, component, call } = fixture();
  const x = project.nodes.find(node => node.id === 'x')!;
  if (x.kind === 'passage') x.next = 'recurse';
  project.nodes.push(call('recurse', 'x', 'return_x'));
  assert.equal(playerFlowCallAnalysis(project).mayReturn.has('x'), false);
  let view = playerFlowView(project, component);
  assert.ok(pairs(view).includes('a>call:call_x'));
  assert.equal(pairs(view).includes('call:call_x>b'), false);
  const firstCall = project.nodes.find(node => node.id === 'call_x')!;
  if (firstCall.kind === 'call') delete firstCall.target;
  view = playerFlowView(project, component);
  assert.equal(view.entries.some(entry => entry.callId === 'call_x'), false);
  assert.equal(view.edges.some(edge => edge.from === 'a'), false);
});

test('a hidden non-returning body stops the route rather than drawing a misleading bypass', () => {
  const { project, component, end } = fixture();
  project.nodes = project.nodes.map(node => node.id === 'return_x' ? end('return_x') : node);
  const { root } = custom(project, component, ['a', 'b', 'c']);
  assert.deepEqual(pairs(root), []);
  assert.deepEqual(ids(root), ['a', 'b', 'c']);
  assert.equal(playerFlowCallAnalysis(project).mayReturn.has('x'), false);
});

test('return-to-title performances including blueprint defaults terminate the body', () => {
  const { project, component, base } = fixture();
  project.nodes = project.nodes.map(node => node.id === 'x' ? { ...base('x'), kind: 'chapterTitle', title: '标题', subtitle: '', duration: 0, playback: { onComplete: 'title' }, next: 'return_x', flowchart: { visible: true } } : node);
  assert.equal(playerFlowCallAnalysis(project).mayReturn.has('x'), false);
  assert.equal(playerFlowView(project, component).edges.some(edge => edge.from === 'call:call_x'), false);
  project.blueprints = [{ id: 'title_performance', name: '返回标题', kind: 'function', nodes: [], links: [], exposedInputs: [], exposedOutputs: [], playback: { onComplete: 'title' } }];
  project.nodes = project.nodes.map(node => node.id === 'x' ? { ...base('x'), kind: 'passage', lines: [{ id: 'performance_line', text: '', silent: true, actions: [{ kind: 'blueprint', blueprintId: 'title_performance' }] }], next: 'return_x', flowchart: { visible: true } } : node);
  assert.equal(playerFlowCallAnalysis(project).mayReturn.has('x'), false);
  assert.equal(playerFlowView(project, component).edges.some(edge => edge.from === 'call:call_x'), false);
});

test('disconnected authored content remains reachable without creating return edges', () => {
  const { project, component, passage, call, ret } = fixture();
  project.nodes.push(passage('orphan', 'orphan_return'), call('orphan_call', 'orphan', 'c'), ret('orphan_return'));
  const { root, views } = playerFlowViews(project, component);
  assert.ok(ids(root).includes('orphan'));
  assert.ok(views.has('call-body:orphan'));
  assert.equal(root.edges.some(edge => edge.from === 'orphan' && edge.to === 'c'), false);
  assert.equal(root.entries.some(entry => entry.callId === 'orphan_call'), false);
});

test('disconnected calling chapters do not duplicate their callees at root regardless of authored order', () => {
  const { project, component, passage, call, ret } = fixture();
  project.nodes.push(passage('orphan_child', 'orphan_child_return'), passage('orphan_parent', 'orphan_nested'), call('orphan_nested', 'orphan_child', 'orphan_parent_return'),
    call('unreachable_parent_call', 'orphan_parent', 'c'), ret('orphan_child_return'), ret('orphan_parent_return'));
  const { root, views } = playerFlowViews(project, component);
  assert.ok(ids(root).includes('orphan_parent'));
  assert.equal(ids(root).includes('orphan_child'), false);
  assert.ok(ids(root).includes('call:orphan_nested'));
  assert.deepEqual(ids(views.get('call-body:orphan_child')!), ['orphan_child']);
});

test('manual groups project only their same-scope members and never merge invocation cards', () => {
  const { project, component } = fixture();
  custom(project, component, ['a', 'b', 'c', 'x']);
  component.list!.flowContent!.custom!.groups = [{ id: 'mixed', name: '分组', nodeIds: ['a', 'b', 'x'] }];
  const { root, views } = playerFlowViews(project, component);
  const rootGroup = root.entries.find(entry => entry.groupId === 'mixed')!;
  assert.deepEqual(rootGroup.memberIds, ['a', 'b']);
  assert.equal(rootGroup.id, 'mixed');
  assert.equal(root.entries.filter(entry => entry.callId).length, 2);
  assert.ok(pairs(root).includes('mixed>call:call_x'));
  assert.ok(pairs(root).includes('call:call_x>mixed'));
  assert.deepEqual(ids(views.get('mixed')!), ['a', 'b']);
  const body = views.get('call-body:x')!, card = body.entries[0];
  assert.deepEqual(card.memberIds, ['x']);
  assert.equal(card.groupId, 'mixed');
  assert.equal(card.id, 'group-view:call-body:x:mixed');
  assert.equal(card.viewId, card.id);
  const inside = views.get(card.id)!;
  assert.deepEqual(ids(inside), ['x']);
  assert.equal(inside.parentViewId, 'call-body:x');
  assert.ok(inside.nodeIds!.includes('return_x'));
  assert.equal(inside.nodeIds!.includes('a'), false);
});

test('expanded manual groups still have an interior and cannot traverse another visible member', () => {
  const { project, component, passage } = fixture();
  const x = project.nodes.find(node => node.id === 'x')!;
  if (x.kind === 'passage') x.next = 'x_middle';
  project.nodes.push(passage('x_middle', 'x_end'), passage('x_end', 'return_x'));
  custom(project, component, ['a', 'b', 'c', 'x', 'x_middle', 'x_end']);
  component.list!.flowContent!.custom!.groups = [{ id: 'part', name: '片段', nodeIds: ['x', 'x_end'], collapsed: false }];
  const { views } = playerFlowViews(project, component), body = views.get('call-body:x')!;
  assert.equal(body.entries.some(entry => entry.groupId), false);
  const interior = views.get('group-view:call-body:x:part')!;
  assert.deepEqual(ids(interior), ['x', 'x_end']);
  assert.deepEqual(pairs(interior), []);
  assert.equal(interior.nodeIds!.includes('x_middle'), false);
});

test('same-view call positions remain independent, shared interiors preserve old layouts and mode switches', () => {
  const { project, component } = fixture();
  component.list!.flowPositions = { a: { x: 10, y: 20 }, x: { x: 70, y: 80 } };
  setPlayerFlowPosition(component, 'call:call_x', { x: 40, y: 50 });
  setPlayerFlowPosition(component, 'call:call_x_again', { x: 60, y: 70 });
  setPlayerFlowPosition(component, 'x', { x: 90, y: 100 }, 'call-body:x');
  const snapshot = JSON.stringify(component.list);
  initializePlayerFlowCustom(project, component, 'copy');
  assert.equal(playerFlowAllEntries(project, component).some(entry => entry.id.startsWith('call:')), false);
  assert.deepEqual(playerFlowPositions(component, 'call-body:x').x, { x: 90, y: 100 });
  assert.deepEqual(playerFlowPositions(component)['call:call_x'], { x: 40, y: 50 });
  setPlayerFlowPosition(component, 'x', { x: 110, y: 120 }, 'call-body:x');
  setPlayerFlowMode(component, 'script');
  assert.deepEqual(playerFlowPositions(component, 'call-body:x').x, { x: 90, y: 100 });
  assert.deepEqual(component.list!.flowPositions!.x, { x: 70, y: 80 });
  assert.equal(JSON.stringify({ ...component.list, flowContent: { mode: 'script', scriptViews: component.list?.flowContent?.scriptViews } }), snapshot);
  setPlayerFlowMode(component, 'custom');
  assert.deepEqual(playerFlowPositions(component, 'call-body:x').x, { x: 110, y: 120 });
  assert.deepEqual(projectSchema.parse({ ...project, ui: { ...project.ui, components: [component] } }).ui.components[0], component);
});

test('63 and 64 character story identities stay distinct in derived view and position keys', () => {
  for (const length of [63, 64]) {
    const { project, component, call, passage, ret } = fixture();
    const callId = 'c'.repeat(length), targetId = 't'.repeat(length), nextCall = 'c'.repeat(length - 1) + 'd';
    project.nodes = [passage('a', callId), call(callId, targetId, nextCall), call(nextCall, targetId, 'c'), passage(targetId, 'r'), ret('r'), { ...project.nodes[4] }];
    const graph = storyFlowLayout(project, component);
    assert.equal(projectSchema.safeParse(project).success, true);
    assert.ok(graph.nodes.some(node => node.id === `call:${callId}`));
    assert.ok(graph.nodes.some(node => node.id === `call:${nextCall}`));
    assert.equal(graph.nodes.find(node => node.id === `call:${callId}`)!.viewId, playerFlowCallViewId(targetId));
    assert.equal(setPlayerFlowPosition(component, targetId, { x: 11, y: 22 }, playerFlowCallViewId(targetId)), true);
    assert.deepEqual(playerFlowPositions(component, playerFlowCallViewId(targetId))[targetId], { x: 11, y: 22 });
  }
});

test('no-call data keeps the existing connection contract without synthesized fields', () => {
  const { project, component, passage, end } = fixture();
  project.nodes = [passage('a', 'b'), passage('b', 'c'), end('c')];
  const entries = playerFlowAllEntries(project, component), graph = storyFlowLayout(project, component);
  assert.deepEqual(playerFlowEntries(project, component), entries);
  assert.deepEqual(graph.edges.map(({ points: _points, ...edge }) => edge), storyFlowConnections(project, entries).edges);
  assert.equal(Object.hasOwn(graph, 'callLocations'), false);
  assert.equal(Object.hasOwn(graph, 'nodeIds'), false);
  assert.equal(Object.hasOwn(graph, 'progressIds'), false);
  assert.equal(playerFlowViews(project, component).hasCalls, false);
});
