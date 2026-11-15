import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph } from '../src/core/blueprint';
import { applyBlueprintWireConnection } from '../src/core/blueprint-wire-edit';
import { canDisconnectWireDrop, pointerOnBlankFlowPane, reconnectWireAtPin, sameWireConnection, wireCanDisconnect, wireCanMovePin, wiresAtPin, type EditableWire } from '../src/renderer/blueprint-wire-interaction';

const edge = (id: string, target: string, extra: Partial<EditableWire> = {}): EditableWire => ({ id, source: 'source', sourceHandle: 'out', target, targetHandle: 'in', reconnectable: true, ...extra });
const sourcePin = { nodeId: 'source', handleId: 'out', type: 'source' as const };

test('a shared pin requires one selected editable wire; explicit unique wires remain draggable', () => {
  const first = edge('first', 'one'), second = edge('second', 'two');
  assert.equal(reconnectWireAtPin([first], sourcePin), first);
  assert.equal(reconnectWireAtPin([first, second], sourcePin), undefined);
  assert.equal(reconnectWireAtPin([{ ...first, selected: true }, second], sourcePin)?.id, first.id);
  assert.equal(reconnectWireAtPin([{ ...first, selected: true }, { ...second, selected: true }], sourcePin), undefined);
  assert.deepEqual(wiresAtPin([first, second], { nodeId: 'two', handleId: 'in', type: 'target' }).map(item => item.id), ['second']);
});

test('readonly and target-only page exits keep their safety rules and Alt selects all editable incident wires', () => {
  const fixed = edge('fixed', 'one', { data: { readonly: true }, reconnectable: false, deletable: false });
  const page = edge('page', 'two', { reconnectable: 'target' });
  const normal = edge('normal', 'three');
  assert.equal(wireCanDisconnect(fixed), false);
  assert.equal(wireCanMovePin(page, 'source'), false);
  assert.equal(wireCanMovePin(page, 'target'), true);
  assert.equal(reconnectWireAtPin([fixed, page, normal], sourcePin), normal);
  assert.deepEqual(wiresAtPin([fixed, page, normal], sourcePin).filter(wireCanDisconnect).map(item => item.id), ['page', 'normal']);
});

test('only an actual uncancelled drag ending on blank pane removes the wire', () => {
  const validDrop = { started: true, moved: true, cancelled: false, completed: false, isValid: false, hasDestination: false, onBlankPane: true };
  assert.equal(canDisconnectWireDrop(validDrop), true);
  for (const change of [{ started: false }, { moved: false }, { cancelled: true }, { completed: true }, { isValid: true }, { hasDestination: true }, { onBlankPane: false }]) assert.equal(canDisconnectWireDrop({ ...validDrop, ...change }), false);
});

test('same endpoint handles include null handles without producing an edit', () => {
  const original = edge('wire', 'one');
  assert.equal(sameWireConnection(original, { source: 'source', sourceHandle: 'out', target: 'one', targetHandle: 'in' }), true);
  assert.equal(sameWireConnection(original, { source: 'source', sourceHandle: 'other', target: 'one', targetHandle: 'in' }), false);
  assert.equal(sameWireConnection({ ...original, sourceHandle: undefined }, { source: 'source', sourceHandle: null, target: 'one', targetHandle: 'in' }), true);
});

test('blank drop detection rejects nodes, controls, wire labels and points outside the graph', () => {
  const canvas = (element: { kind: string; inside: boolean } | null) => ({
    ownerDocument: { elementFromPoint: () => element && { matches: (selector: string) => selector === '.react-flow__pane' && element.kind === 'pane', closest: () => element.kind === 'background' ? {} : null } },
    contains: () => element?.inside ?? false,
  }) as unknown as HTMLElement;
  const point = { clientX: 100, clientY: 100 };
  for (const kind of ['pane', 'background']) assert.equal(pointerOnBlankFlowPane(canvas({ kind, inside: true }), point), true);
  for (const kind of ['node', 'input', 'button', 'edge', 'label']) assert.equal(pointerOnBlankFlowPane(canvas({ kind, inside: true }), point), false);
  assert.equal(pointerOnBlankFlowPane(canvas({ kind: 'pane', inside: false }), point), false);
  assert.equal(pointerOnBlankFlowPane(canvas(null), point), false);
  assert.equal(pointerOnBlankFlowPane(null, point), false);
});

function graphFixture() {
  const graph = createBlueprintGraph('function', '连线'); graph.nodes = [];
  const node = (id: string, type: 'number' | 'string' = 'number') => {
    const value = blueprintNodeDefaults('math'); value.id = id;
    value.pins = [blueprintPin('in', '输入', 'input', type), blueprintPin('out', '输出', 'output', type)];
    graph.nodes.push(value); return value;
  };
  node('a'); node('b'); node('c'); node('d'); node('text', 'string');
  connectBlueprintPins(graph, 'a', 'out', 'b', 'in');
  return graph;
}

test('reconnecting a data wire preserves its id and the one-input rule', () => {
  const graph = graphFixture(), originalId = graph.links[0].id;
  connectBlueprintPins(graph, 'd', 'out', 'c', 'in');
  assert.equal(applyBlueprintWireConnection(graph, { source: 'a', sourceHandle: 'out', target: 'c', targetHandle: 'in' }, originalId), undefined);
  assert.deepEqual(graph.links, [{ id: originalId, fromNodeId: 'a', fromPinId: 'out', toNodeId: 'c', toPinId: 'in' }]);
});

test('incompatible, cyclic and vanished endpoint reconnections leave the entire graph unchanged', () => {
  const graph = graphFixture(); connectBlueprintPins(graph, 'b', 'out', 'c', 'in');
  const originalId = graph.links[0].id, before = structuredClone(graph);
  for (const connection of [
    { source: 'a', sourceHandle: 'out', target: 'text', targetHandle: 'in' },
    { source: 'c', sourceHandle: 'out', target: 'b', targetHandle: 'in' },
    { source: 'a', sourceHandle: 'gone', target: 'c', targetHandle: 'in' },
    { source: 'a', sourceHandle: 'out', target: 'gone', targetHandle: 'in' },
  ]) {
    assert.ok(applyBlueprintWireConnection(graph, connection, originalId));
    assert.deepEqual(graph, before);
  }
  assert.ok(applyBlueprintWireConnection(graph, { source: 'a', sourceHandle: 'out', target: 'c', targetHandle: 'in' }, 'missing-wire'));
  assert.deepEqual(graph, before);
});

test('same blueprint endpoints are a true no-op while changing the source keeps wire identity', () => {
  const graph = graphFixture(), original = graph.links[0], links = graph.links;
  assert.equal(applyBlueprintWireConnection(graph, { source: 'a', sourceHandle: 'out', target: 'b', targetHandle: 'in' }, original.id), undefined);
  assert.equal(graph.links, links); assert.equal(graph.links[0], original);
  assert.equal(applyBlueprintWireConnection(graph, { source: 'd', sourceHandle: 'out', target: 'b', targetHandle: 'in' }, original.id), undefined);
  assert.deepEqual(graph.links, [{ ...original, fromNodeId: 'd' }]);
});

test('execution reconnect retains one output while allowing multiple incoming execution routes', () => {
  const graph = graphFixture();
  for (const node of graph.nodes) for (const pin of node.pins) pin.dataType = 'exec';
  graph.links = [];
  connectBlueprintPins(graph, 'a', 'out', 'b', 'in'); const id = graph.links[0].id;
  connectBlueprintPins(graph, 'd', 'out', 'c', 'in');
  assert.equal(applyBlueprintWireConnection(graph, { source: 'a', sourceHandle: 'out', target: 'c', targetHandle: 'in' }, id), undefined);
  assert.equal(graph.links.length, 2);
  assert.equal(graph.links.filter(link => link.fromNodeId === 'a' && link.fromPinId === 'out').length, 1);
  assert.equal(graph.links.filter(link => link.toNodeId === 'c' && link.toPinId === 'in').length, 2);
});
