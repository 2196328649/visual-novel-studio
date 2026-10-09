import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type BlueprintNode, type Project } from '../src/core/model';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph } from '../src/core/blueprint';
import { BlueprintViewCache, reuseBlueprintEdges } from '../src/renderer/blueprint-view';
import type { StudioEdge } from '../src/renderer/SelectableEdge';
import { bezierIntersectsRect, parseBezierPath, rectanglesIntersect, type Bezier } from '../src/renderer/blueprint-selection';

function fixture() {
  const project = createProject(), graph = createBlueprintGraph('function', '选择与刷新');
  graph.nodes.push(blueprintNodeDefaults('random'), blueprintNodeDefaults('math'));
  project.blueprints.push(graph);
  const cache = new BlueprintViewCache(), collapsed = new Set<string>();
  const edits: string[] = [], edit = (id: string, change: (node: BlueprintNode) => void) => { edits.push(id); change(graph.nodes.find(node => node.id === id)!); };
  const toggle = (id: string) => collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
  const view = (current: Project, issues: { nodeId?: string }[] = []) => cache.update(current, current.blueprints[0], issues, edit, collapsed, toggle);
  return { project, graph, cache, collapsed, edits, edit, toggle, view };
}

test('blueprint UI survives history clones and movement without rebuilding unchanged controls', () => {
  const { project, view, graph, edits } = fixture();
  const first = view(project), moved = structuredClone(project);
  moved.blueprints[0].nodes[1].x += 123; moved.blueprints[0].nodes[1].y -= 78;
  const second = view(moved);
  assert.ok(second.every((item, index) => item.data === first[index].data));
  assert.equal(second[1].node.x, moved.blueprints[0].nodes[1].x);
  second[1].data.edit(node => { node.properties.min = -3; });
  assert.deepEqual(edits, [graph.nodes[1].id]); assert.equal(graph.nodes[1].properties.min, -3);
});

test('parameter edits, diagnostics and collapse invalidate only the affected node', () => {
  const { project, view, collapsed } = fixture();
  const first = view(project), changed = structuredClone(project);
  changed.blueprints[0].nodes[1].properties.min = -2.75;
  const second = view(changed);
  assert.equal(second[0].data, first[0].data); assert.equal(second[2].data, first[2].data);
  assert.notEqual(second[1].data, first[1].data); assert.equal(second[1].data.node.properties.min, -2.75);
  const third = view(changed, [{ nodeId: changed.blueprints[0].nodes[2].id }]);
  assert.equal(third[1].data, second[1].data); assert.equal(third[2].data.invalid, true);
  third[1].data.toggleParameters();
  const fourth = view(changed, [{ nodeId: changed.blueprints[0].nodes[2].id }]);
  assert.equal(fourth[2].data, third[2].data); assert.equal(fourth[1].data.parametersCollapsed, true);
  assert.ok(collapsed.has(fourth[1].node.id));
});

test('connecting and disconnecting an input refreshes the target editor and its graph snapshot', () => {
  const { project, view } = fixture();
  const first = view(project), connected = structuredClone(project), graph = connected.blueprints[0];
  assert.equal(connectBlueprintPins(graph, graph.nodes[1].id, 'value', graph.nodes[2].id, 'a'), undefined);
  const second = view(connected);
  assert.equal(second[0].data, first[0].data); assert.equal(second[1].data, first[1].data);
  assert.notEqual(second[2].data, first[2].data); assert.ok(second[2].data.connectedInputs.has('a'));
  assert.equal(second[2].data.graph.links.length, 1);
  const disconnected = structuredClone(connected); disconnected.blueprints[0].links = [];
  assert.equal(view(disconnected)[2].data.connectedInputs.size, 0);
});

test('resource, variable, UI and callable interface changes never leave stale dropdowns', () => {
  const { project, view } = fixture();
  const mutations: ((draft: Project) => void)[] = [
    draft => draft.assets.push({ id: 'scene', name: '庭院', kind: 'image', path: 'assets/scene.png', category: 'scene' }),
    draft => draft.variables.push({ id: 'score', name: '得分', type: 'number', initial: 0, persistent: false }),
    draft => { draft.ui.customPages.push({ id: 'game', name: '小游戏', components: [], modal: true }); },
    draft => draft.blueprints[0].exposedInputs.push(blueprintPin('seconds', '等待时间', 'input', 'number', 1)),
    draft => draft.blueprints.push(createBlueprintGraph('macro', '被调用的节点')),
    draft => { draft.blueprints[1].nodes.push(blueprintNodeDefaults('showCharacter')); },
  ];
  let current = project, before = view(current);
  for (const mutate of mutations) {
    current = structuredClone(current); mutate(current);
    const after = view(current);
    assert.notEqual(after[0].data, before[0].data); assert.equal(after[0].data.project, current);
    before = after;
  }
});

test('inferred asset categories invalidate selectors when active graph usage changes', () => {
  const { project, view } = fixture();
  project.assets.push({ id: 'track', name: 'track', kind: 'audio', path: 'assets/track.ogg' });
  const before = view(project), current = structuredClone(project), music = blueprintNodeDefaults('playMusic');
  music.properties.assetId = 'track'; current.blueprints[0].nodes.push(music);
  assert.notEqual(view(current)[1].data, before[1].data);
});

test('a new editing callback and a different graph replace cached node context', () => {
  const { project, cache, edit, toggle, collapsed } = fixture();
  const first = cache.update(project, project.blueprints[0], [], edit, collapsed, toggle);
  const second = cache.update(project, project.blueprints[0], [], () => {}, collapsed, toggle);
  assert.notEqual(second[0].data, first[0].data);
  const other = createBlueprintGraph('function', '第二张图'); project.blueprints.push(other);
  assert.equal(cache.update(project, other, [], edit, collapsed, toggle)[0].data.graph.id, other.id);
});

test('unchanged wires retain their identity while selection and endpoint changes refresh affected edges', () => {
  const disconnect = () => {};
  const previous: StudioEdge[] = ['one', 'two'].map(id => ({ id, source: 'source', target: id, type: 'studio', selected: false, data: { label: id, disconnect }, style: { strokeWidth: 2 } }));
  const copy = (): StudioEdge[] => previous.map(edge => ({ ...edge, data: { ...edge.data! }, style: { ...edge.style } }));
  assert.equal(reuseBlueprintEdges(previous, copy()), previous);
  const selected = copy(); selected[0].selected = true;
  const after = reuseBlueprintEdges(previous, selected);
  assert.notEqual(after[0], previous[0]); assert.equal(after[1], previous[1]);
  const reconnected = copy(); reconnected[1].target = 'new-target';
  assert.notEqual(reuseBlueprintEdges(previous, reconnected)[1], previous[1]);
  const callback = copy(); callback[0].data!.disconnect = () => {};
  assert.notEqual(reuseBlueprintEdges(previous, callback)[0], previous[0]);
});

test('marquee geometry includes partial overlaps and boundary contact', () => {
  assert.equal(rectanglesIntersect({ x: 0, y: 0, width: 20, height: 10 }, { x: 19, y: 9, width: 30, height: 30 }), true);
  assert.equal(rectanglesIntersect({ x: 0, y: 0, width: 20, height: 10 }, { x: 20, y: 10, width: 30, height: 30 }), true);
  assert.equal(rectanglesIntersect({ x: 0, y: 0, width: 20, height: 10 }, { x: 21, y: 11, width: 30, height: 30 }), false);
});

test('wire marquee catches a curve even when both endpoints are outside', () => {
  const curve = parseBezierPath('M-100,20 C-30,20 30,20 100,20')!;
  assert.equal(bezierIntersectsRect(curve, { x: -2, y: 16, width: 4, height: 8 }), true);
  assert.equal(bezierIntersectsRect([...curve].reverse() as unknown as Bezier, { x: -2, y: 16, width: 4, height: 8 }), true);
  assert.equal(bezierIntersectsRect(curve, { x: -2, y: 25, width: 4, height: 8 }), false);
});

test('curved wire selection excludes empty space inside its bounding box', () => {
  const curve = parseBezierPath('M0,0 C0,100 100,100 100,0')!;
  assert.equal(bezierIntersectsRect(curve, { x: 48, y: 0, width: 4, height: 10 }), false);
  assert.equal(bezierIntersectsRect(curve, { x: 49, y: 74, width: 2, height: 2 }), true);
  assert.equal(bezierIntersectsRect(curve, { x: 49, y: 90, width: 2, height: 2 }), false);
  for (const zoom of [0.18, 0.5, 1, 1.6]) {
    const scaled = curve.map(point => ({ x: point.x * zoom + 150, y: point.y * zoom - 50 })) as unknown as Bezier;
    assert.equal(bezierIntersectsRect(scaled, { x: 49 * zoom + 150, y: 74 * zoom - 50, width: 2 * zoom, height: 2 * zoom }, 0.5 * zoom), true);
  }
});

test('degenerate and looping curves remain selectable without bounding-box false positives', () => {
  assert.equal(bezierIntersectsRect(parseBezierPath('M1,1 C1,1 1,1 1,1')!, { x: 0, y: 0, width: 2, height: 2 }), true);
  assert.equal(bezierIntersectsRect(parseBezierPath('M0,0 C100,0 100,0 0,0')!, { x: 73, y: -1, width: 2, height: 2 }), true);
  assert.equal(parseBezierPath('M0,0 L100,100'), undefined);
  assert.equal(parseBezierPath('M0,NaN C1,1 2,2 3,3'), undefined);
});
