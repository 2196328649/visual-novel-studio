import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { createBlueprintGraph, blueprintNodeDefaults, connectBlueprintPins } from '../src/core/blueprint';
import { aiSelectedBlueprint, blueprintSelectionSchema } from '../src/core/ai-selection';
import { aiRequestMessages } from '../src/core/ai';
import { readAiProject } from '../src/core/ai-project-read';

test('node and wire selections resolve independently by ID and never expand to endpoints', () => {
 const project = createProject(), graph = createBlueprintGraph('function', '选择测试'); project.blueprints.push(graph);
 const a = blueprintNodeDefaults('delay'), b = blueprintNodeDefaults('delay'); a.name = b.name = '同名节点'; graph.nodes.push(a, b);
 connectBlueprintPins(graph, graph.nodes[0].id, 'exec', a.id, 'exec_in'); connectBlueprintPins(graph, a.id, 'exec_out', b.id, 'exec_in');
 const selection = { graphId: graph.id, nodeId: a.id, nodeIds: [a.id, b.id, a.id], linkIds: [graph.links[0].id] };
 const chosen = aiSelectedBlueprint(project, selection); assert.deepEqual(chosen.nodes.map(n => n.id), [a.id, b.id]); assert.equal(chosen.links.length, 1); assert.equal(chosen.unavailable, false);
 const wires = aiSelectedBlueprint(project, { ...selection, nodeIds: [] }); assert.deepEqual(wires.nodes, []); assert.equal(wires.links[0].fromNodeId, graph.nodes[0].id);
 const message = aiRequestMessages({ id: 'selection', prompt: '只删除连线', project, lineIds: [], selectedBlueprint: { ...selection, nodeIds: [] } }).at(-1)!.content;
 const context = JSON.parse(message.slice(message.indexOf('\n{') + 1)); assert.equal(context.selectedBlueprint.node, undefined); assert.equal(context.selectedBlueprint.selectedNodeTotal, 0); assert.equal(context.selectedBlueprint.selectedLinkTotal, 1);
 graph.nodes = graph.nodes.filter(n => n.id !== b.id); assert.equal(aiSelectedBlueprint(project, selection).unavailable, true);
 assert.equal(aiSelectedBlueprint(project, { ...selection, graphId: 'missing' }).unavailable, true);
 assert.equal(blueprintSelectionSchema.safeParse({ ...selection, nodeIds: Array(513).fill(a.id) }).success, false);
});

test('selection summaries remain bounded and selected-element reads page a frozen selection against staged data', () => {
 const project = createProject(), graph = createBlueprintGraph('function', '选择测试'); project.blueprints.push(graph);
 for (let i = 0; i < 130; i++) { const node = blueprintNodeDefaults('comment'); node.id = 'comment_' + i; node.name = '同名'; node.properties.text = '说明'; graph.nodes.push(node); }
 const selected = { graphId: graph.id, nodeIds: graph.nodes.slice(1).map(n => n.id), linkIds: [] };
 const message = aiRequestMessages({ id: 'selection', prompt: '移动选中节点', project, lineIds: [], selectedBlueprint: selected }).at(-1)!.content;
 const context = JSON.parse(message.slice(message.indexOf('\n{') + 1)); assert.equal(context.selectedBlueprint.selectedNodes.length, 100); assert.equal(context.selectedBlueprint.selectedNodeTotal, 130); assert.equal(context.selectedBlueprint.selectedNodesPartial, true);
 const first: any = readAiProject(project, [], { kind: 'selectedBlueprint', elements: 'nodes', limit: 100 }, [], selected);
 assert.equal(first.total, 130); assert.equal(first.nextOffset, 100); assert.equal(first.items[0].id, 'comment_0');
 const last: any = readAiProject(project, [], { kind: 'selectedBlueprint', elements: 'nodes', offset: first.nextOffset, limit: 100 }, [], selected);
 assert.equal(last.items.length, 30); assert.equal(last.nextOffset, undefined); assert.equal(last.items.at(-1).id, 'comment_129');
 graph.nodes.find(n => n.id === 'comment_129')!.x = 777;
 const changed: any = readAiProject(project, [], { kind: 'selectedBlueprint', elements: 'nodes', offset: 129 }, [], selected); assert.equal(changed.items[0].x, 777);
 graph.nodes = graph.nodes.filter(n => n.id !== 'comment_0');
 const stale: any = readAiProject(project, [], { kind: 'selectedBlueprint', elements: 'nodes' }, [], selected); assert.equal(stale.selectionUnavailable, true); assert.equal(stale.total, 129); assert.ok(!stale.items.some((n: any) => n.id === graph.nodes[0].id));
});
