import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs } from '../src/core/blueprint-authoring';
import { blueprintNodeDefaults } from '../src/core/blueprint';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';

function fixture() {
  const project = createProject(), graph = blueprintFromPerformance(project, [{ kind: 'chapter', title: '标题', subtitle: '副标题', duration: 3 }, { kind: 'pause', seconds: 2 }]);
  project.blueprints.push(graph);
  return { project, graph };
}

test('sequential parameter exposure preserves playback, connections and authored positions while avoiding occupied rectangles', () => {
  const { project, graph } = fixture(), target = graph.nodes[1];
  target.x = -200; target.y = -350;
  const blocker = blueprintNodeDefaults('getInput'); blocker.x = target.x - 300; blocker.y = target.y - 60;
  graph.nodes.push(blocker);
  const original = structuredClone(graph.nodes), links = structuredClone(graph.links);
  const playback = () => expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], previewActionContext(project));
  const before = playback();
  for (const id of ['title', 'subtitle', 'duration']) {
    exposePerformanceInputs(graph, [performanceInputs(graph).find(input => input.nodeId === target.id && input.pinId === id)!]);
    const read = graph.nodes.at(-1)!;
    assert.equal(read.x, target.x - 420);
    assert.ok(read.y >= blocker.y + 215, 'reader must avoid an offset existing node, not just identical origins');
    for (const other of graph.nodes.filter(node => node.id !== read.id && node.x === read.x)) assert.ok(Math.abs(read.y - other.y) >= 215);
    assert.equal(graph.links.find(link => link.toNodeId === target.id && link.toPinId === id)!.fromNodeId, read.id);
    assert.deepEqual(graph.nodes.slice(0, original.length), original);
    assert.deepEqual(graph.links.slice(0, links.length), links);
    assert.deepEqual(playback(), before);
  }
});

test('batch exposure uses each target and avoids both batch readers and a manually moved earlier reader', () => {
  const { graph } = fixture();
  const first = graph.nodes[1], second = graph.nodes[2]; second.x = first.x; second.y = first.y + 100;
  const fields = performanceInputs(graph).filter(input => ['title', 'duration', 'seconds'].includes(input.pinId)).map((input, i) => ({ ...input, name: '参数 ' + i }));
  exposePerformanceInputs(graph, fields.slice(0, 1));
  const existing = graph.nodes.at(-1)!; existing.y = second.y + 100;
  const original = structuredClone(graph.nodes);
  exposePerformanceInputs(graph, fields.slice(1));
  const readers = graph.nodes.filter(node => node.type === 'getInput');
  assert.equal(readers.length, fields.length);
  for (const read of readers) for (const other of readers) if (read !== other) assert.ok(Math.abs(read.y - other.y) >= 215);
  assert.deepEqual(graph.nodes.slice(0, original.length), original);
  for (const field of fields) assert.ok(graph.links.some(link => link.toNodeId === field.nodeId && link.toPinId === field.pinId && readers.some(read => read.id === link.fromNodeId)));
});
