import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, type Project, type StoryNode, type UiComponent } from '../src/core/model';
import { flowEdgeUnlocked, moveStoryFlowLayout, storyFlowLayout } from '../src/core/story-flow';
import { setPlayerFlowPosition } from '../src/core/player-flow-content';
import { storyFlowRanking } from '../src/core/story-flow-ranking';
import type { FlowConnection } from '../src/core/story-flow-connections';

function fixture() {
  const project = createProject(), sceneId = project.scenes[0].id;
  const node = (id: string, next?: string): StoryNode => ({ id, name: id, sceneId, x: 0, y: 0, kind: 'passage', next,
    lines: [{ id: `line_${id}`, text: id, actions: [] }] });
  project.nodes = [node('boot'), ...Array.from({ length: 10 }, (_, index) => node(`from_${index}`, `to_${index}`)),
    ...Array.from({ length: 10 }, (_, index) => node(`to_${index}`))];
  project.entryId = 'boot';
  const component: UiComponent = { id: 'map', kind: 'flowchart', page: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1,
    list: { layout: 'flow', flowContent: { mode: 'custom', custom: {
      entries: project.nodes.slice(1).map(node => ({ nodeId: node.id })),
      groups: [
        { id: 'from_group', name: '起点组', nodeIds: project.nodes.slice(1, 11).map(node => node.id) },
        { id: 'to_group', name: '终点组', nodeIds: project.nodes.slice(11).map(node => node.id) },
      ],
    } } } };
  return { project, component };
}

test('merged group connections keep every real endpoint beyond the explanation limit', () => {
  const { project, component } = fixture();
  const graph = storyFlowLayout(project, component), edge = graph.edges[0];
  assert.equal(graph.edges.length, 1);
  assert.equal(edge.paths?.length, 8, 'explanations remain bounded');
  assert.equal(edge.endpoints?.length, 10, 'no actual connection is dropped');
  assert.equal(new Set(edge.endpoints?.map(pair => `${pair.from}/${pair.to}`)).size, 10);
  assert.equal(flowEdgeUnlocked(edge, id => new Set(['from_9', 'to_9']).has(id)), true);
  assert.equal(flowEdgeUnlocked(edge, id => new Set(['from_9', 'to_0']).has(id)), false, 'unrelated reached members do not open the connection');
  assert.equal(flowEdgeUnlocked(edge, id => id === 'from_9'), false);
  assert.equal(flowEdgeUnlocked(edge, () => true), true);

  // The same rule applies when only the starting endpoints are grouped.
  component.list!.flowContent!.custom!.groups!.pop();
  for (const node of project.nodes) if (node.kind === 'passage' && node.id.startsWith('from_')) node.next = 'to_0';
  const groupToNode = storyFlowLayout(project, component).edges.find(edge => edge.to === 'to_0')!;
  assert.equal(groupToNode.endpoints?.length, 10);
  assert.equal(flowEdgeUnlocked(groupToNode, id => new Set(['from_9', 'to_0']).has(id)), true);
});

test('complete endpoints take precedence over explanations and legacy maps remain readable', () => {
  const base = { from: 'group', to: 'destination', label: '', paths: [{ nodeIds: ['old', 'destination'], labels: [] }] };
  const seen = (id: string) => id === 'new' || id === 'destination';
  assert.equal(flowEdgeUnlocked({ ...base, endpoints: [{ from: 'new', to: 'destination' }] }, seen), true);
  assert.equal(flowEdgeUnlocked({ ...base, endpoints: [] }, () => true), false);
  assert.equal(flowEdgeUnlocked(base, seen), false);
  assert.equal(flowEdgeUnlocked(base, id => id === 'old' || id === 'destination'), true);
  assert.equal(flowEdgeUnlocked({ from: 'a', to: 'b', label: '', paths: [{ nodeIds: [], labels: [] }] }, () => true), true);
  assert.equal(flowEdgeUnlocked({ from: 'a', to: 'b', label: '' }, id => id === 'a'), false);
});

test('drag previews update only their node and connected geometry without changing story or saved state', () => {
  for (const direction of ['horizontal', 'vertical'] as const) for (const style of ['elbow', 'curve', 'straight'] as const) {
    const { project, component } = fixture();
    component.list!.flowDirection = direction;
    component.list!.flowLineStyle = style;
    component.list!.flowContent!.custom!.groups = [];
    const before = JSON.stringify({ project, component });
    const graph = storyFlowLayout(project, component);
    const preview = moveStoryFlowLayout(graph, component, 'from_9', { x: 2400, y: 1900 });
    assert.equal(JSON.stringify({ project, component }), before);
    assert.equal(preview.locations, graph.locations, 'story locations are reused');
    for (const node of graph.nodes) if (node.id !== 'from_9') assert.equal(preview.nodes.find(item => item.id === node.id), node);
    for (const edge of graph.edges) {
      const changed = preview.edges.find(item => item.from === edge.from && item.to === edge.to)!;
      if (edge.from !== 'from_9' && edge.to !== 'from_9') assert.equal(changed, edge);
      assert.equal(changed.endpoints, edge.endpoints);
      assert.equal(changed.paths, edge.paths);
    }
    const saved = structuredClone(component);
    setPlayerFlowPosition(saved, 'from_9', { x: 2400, y: 1900 });
    const full = storyFlowLayout(project, saved);
    assert.deepEqual(preview.nodes, full.nodes);
    assert.deepEqual(preview.edges, full.edges);
    assert.ok(preview.width >= full.width && preview.height >= full.height);
  }
});

test('group-card and interior drag previews match committed positions and reject stale or invalid targets', () => {
  const { project, component } = fixture();
  for (const [groupId, nodeId] of [[undefined, 'from_group'], ['from_group', 'from_4']] as const) {
    const base = storyFlowLayout(project, component, groupId);
    const preview = moveStoryFlowLayout(base, component, nodeId, { x: 100, y: 240 });
    const saved = structuredClone(component);
    setPlayerFlowPosition(saved, nodeId, { x: 100, y: 240 }, groupId);
    const actual = storyFlowLayout(project, saved, groupId);
    assert.deepEqual(preview.nodes, actual.nodes);
    assert.deepEqual(preview.edges, actual.edges);
    assert.equal(moveStoryFlowLayout(base, component, 'missing', { x: 0, y: 0 }), base);
    assert.equal(moveStoryFlowLayout(base, component, nodeId, { x: NaN, y: 0 }), base);
    const original = base.nodes.find(node => node.id === nodeId)!;
    assert.equal(moveStoryFlowLayout(base, component, nodeId, original), base);
  }
});

test('moving a self-loop reconnects both ends and keeps its route inside the preview extent', () => {
  const { project, component } = fixture();
  component.list!.flowContent!.custom!.groups = [];
  const source = project.nodes.find(node => node.id === 'from_0')!;
  if (source.kind === 'passage') source.next = source.id;
  const graph = storyFlowLayout(project, component);
  const moved = moveStoryFlowLayout(graph, component, source.id, { x: 4200, y: 3800 });
  const loop = moved.edges.find(edge => edge.from === source.id && edge.to === source.id)!;
  assert.ok(loop.points.length >= 4);
  for (const [x, y] of loop.points) assert.ok(x >= 0 && y >= 0 && x < moved.width && y < moved.height);
  const saved = structuredClone(component);
  setPlayerFlowPosition(saved, source.id, { x: 4200, y: 3800 });
  assert.deepEqual(loop, storyFlowLayout(project, saved).edges.find(edge => edge.from === source.id && edge.to === source.id));
});

test('layout ranking preserves first-ready priorities, merges, loops, and disconnected entries', () => {
  const edge = (from: string, to: string): FlowConnection => ({ from, to, label: '' });
  // Authored ordering does not change the ranks of this b -> a -> c chain.
  assert.deepEqual([...storyFlowRanking(['a', 'b', 'c'], [edge('b', 'a'), edge('a', 'c')]).rank.values()], [1, 0, 2]);
  const ids = ['b', 'a', 'c', 'merge', 'self', 'orphan'];
  const edges = [edge('a', 'b'), edge('b', 'a'), edge('b', 'c'), edge('a', 'merge'), edge('c', 'merge'), edge('self', 'self')];
  assert.deepEqual([...storyFlowRanking(ids, edges).rank.values()], [0, 1, 1, 2, 0, 0]);
  assert.deepEqual(storyFlowRanking(ids, edges).incoming.get('merge'), ['a', 'c']);
});

test('a large reverse-ordered chain retains the same geometry and real connectivity', () => {
  const project: Project = createProject(), sceneId = project.scenes[0].id;
  project.nodes = Array.from({ length: 600 }, (_, index) => ({ id: `node_${index}`, name: `节点${index}`, sceneId, x: 0, y: 0,
    kind: 'passage' as const, lines: [{ id: `line_${index}`, text: '台词', actions: [] }], ...(index < 599 ? { next: `node_${index + 1}` } : {}) }));
  const component: UiComponent = { id: 'map', kind: 'flowchart', page: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1,
    list: { layout: 'flow', flowContent: { mode: 'custom', custom: { entries: project.nodes.map(node => ({ nodeId: node.id })) } } } };
  const forward = storyFlowLayout(project, component);
  component.list!.flowContent!.custom!.entries.reverse();
  const reverse = storyFlowLayout(project, component);
  assert.deepEqual(reverse.nodes, forward.nodes);
  assert.deepEqual(reverse.locations, forward.locations);
  const sorted = (edges: typeof reverse.edges) => [...edges].sort((a, b) => a.from.localeCompare(b.from));
  assert.deepEqual(sorted(reverse.edges), sorted(forward.edges));
});
