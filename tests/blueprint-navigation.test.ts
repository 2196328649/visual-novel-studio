import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { blueprintNodeDefaults, blueprintPin, createBlueprintGraph } from '../src/core/blueprint';
import { performanceWorkspaceDraft } from '../src/core/performance-workspace';
import { createUiEventGraph } from '../src/core/ui-logic';
import { canvasLocation, rememberBlueprintNodeClick, enterBlueprintVisit, performanceGraphOrigin, resolveBlueprintReturn, restoredPerformanceWorkspace, type BlueprintReturnPoint } from '../src/renderer/blueprint-navigation';

function fixture() {
  const project = createProject('导航检查'), graphs = ['父图', '子图', '孙图'].map(name => createBlueprintGraph('function', name)); project.blueprints.push(...graphs);
  const point = (index: number): BlueprintReturnPoint => ({ projectId: project.id, origin: canvasLocation(graphs[index], [graphs[index].nodes[0].id], [], { x: 34, y: -81, zoom: .65 }, { open: false, tab: 'node' }) });
  return { project, graphs, point };
}
test('module visits preserve independent canvas snapshots and unwind in order without editing the project', () => {
  const f = fixture(), before = structuredClone(f.project), first = f.point(0);
  let visits = enterBlueprintVisit([], first, f.graphs[1].id); first.origin.nodeIds.length = 0; first.origin.viewport.x = 999;
  visits = enterBlueprintVisit(visits, f.point(1), f.graphs[2].id);
  const one = resolveBlueprintReturn(f.project, visits), two = resolveBlueprintReturn(f.project, one.remaining);
  assert.equal(one.point?.origin.graphId, f.graphs[1].id); assert.equal(two.point?.origin.graphId, f.graphs[0].id);
  assert.deepEqual(two.point?.origin.nodeIds, [f.graphs[0].nodes[0].id]); assert.equal(two.point?.origin.viewport.x, 34);
  assert.equal(two.remaining.length, 0); assert.deepEqual(f.project, before);
});
test('unrelated entry, self entry and bounded history cannot leave a false module breadcrumb', () => {
  const f = fixture(); let visits = enterBlueprintVisit([], f.point(0), f.graphs[1].id);
  assert.deepEqual(enterBlueprintVisit(visits, f.point(1), f.graphs[1].id), visits);
  assert.equal(enterBlueprintVisit(visits, f.point(2), f.graphs[0].id).length, 1);
  for (let i = 0; i < 80; i++) visits = enterBlueprintVisit(visits, f.point((i + 1) % 3), f.graphs[(i + 2) % 3].id);
  assert.equal(visits.length, 32);
});
test('deleted source graphs are skipped and deleted selections are not replaced with unrelated nodes', () => {
  const f = fixture(), extra = blueprintNodeDefaults('delay'); f.graphs[0].nodes.push(extra);
  const p = f.point(0); p.origin.nodeIds.push(extra.id);
  let visits = enterBlueprintVisit([], p, f.graphs[1].id); visits = enterBlueprintVisit(visits, f.point(1), f.graphs[2].id);
  f.project.blueprints = f.project.blueprints.filter(g => g.id !== f.graphs[1].id); f.graphs[0].nodes = f.graphs[0].nodes.filter(n => n.id !== p.origin.primaryNodeId);
  const result = resolveBlueprintReturn(f.project, visits); assert.equal(result.changed, true); assert.deepEqual(result.point?.origin.nodeIds, [extra.id]); assert.equal(result.point?.origin.primaryNodeId, extra.id);
  assert.equal(resolveBlueprintReturn(createProject('其他工程'), visits).point, undefined);
});
test('invalid viewport and duplicate selection cannot be replayed into the canvas', () => {
  const f = fixture(), node = f.graphs[0].nodes[0]; const value = canvasLocation(f.graphs[0], [node.id, node.id, 'missing'], ['missing'], { x: NaN, y: 1, zoom: -1 }, { open: true, tab: 'links' });
  assert.deepEqual(value.nodeIds, [node.id]); assert.deepEqual(value.linkIds, []); assert.deepEqual(value.viewport, { x: 0, y: 0, zoom: 1 });
});
test('transient performance graphs retain generated IDs without materializing the authored project on navigation', () => {
  const f = fixture(), passage = f.project.nodes.find(n => n.kind === 'passage')!; assert.equal(passage.kind, 'passage'); if (passage.kind !== 'passage') return;
  passage.lines[0].actions = [{ kind: 'blueprint', blueprintId: f.graphs[1].id }, { kind: 'pause', seconds: .1 }];
  const target = { nodeId: passage.id, lineId: passage.lines[0].id }, draft = performanceWorkspaceDraft(f.project, target), graph = draft.project.blueprints.find(g => g.id === draft.target?.graphId)!;
  const origin = performanceGraphOrigin(canvasLocation(graph, [graph.nodes[1].id], [], { x: 123, y: 22, zoom: .8 }, { open: true, tab: 'node' }), f.project, draft, target, []);
  const before = structuredClone(f.project), visits = enterBlueprintVisit([], { projectId: f.project.id, origin }, f.graphs[1].id);
  const back = resolveBlueprintReturn(f.project, visits); assert.equal(back.point?.origin.graphId, graph.id);
  const restored = restoredPerformanceWorkspace(f.project, target, back.point!.origin); assert.ok(restored.project.blueprints.find(g => g.id === graph.id)?.nodes.some(n => n.id === graph.nodes[1].id)); assert.deepEqual(f.project, before);
  f.graphs[1].name = '模块内修改'; const latest = restoredPerformanceWorkspace(f.project, target, back.point!.origin); assert.equal(latest.project.blueprints.find(g => g.id === f.graphs[1].id)!.name, '模块内修改');
  f.graphs[1].exposedInputs.push(blueprintPin('new_input', '新增参数', 'input', 'number', 4));
  const revised = restoredPerformanceWorkspace(f.project, target, back.point!.origin), materialized = structuredClone(f.project); revised.materialize(materialized);
  for (const value of [revised.project, materialized]) assert.ok(value.blueprints.find(g => g.id === graph.id)!.nodes.find(n => n.type === 'callFunction')!.pins.some(pin => pin.id === 'arg_new_input'));
  assert.equal(f.project.blueprints.some(g => g.id === graph.id), false);
  passage.lines[0].actions = [{ kind: 'pause', seconds: 2 }]; assert.equal(resolveBlueprintReturn(f.project, visits).point, undefined);
});


test('page returns retain their original scheme without altering the game active scheme', () => {
  const f = fixture(); f.project.ui.instances = [{ id: 'owner', name: '所属', components: [] }, { id: 'other', name: '其他', components: [] }];
  f.project.ui.activeInstanceId = 'owner'; const graph = createUiEventGraph(f.project, 'ui:main', '所属标题'); f.project.ui.activeInstanceId = 'other';
  const point: BlueprintReturnPoint = { projectId: f.project.id, origin: canvasLocation(graph, [graph.nodes[0].id], [], { x: 0, y: 0, zoom: 1 }, { open: true, tab: 'node' }), ui: { page: 'main', instanceId: 'owner' } };
  const visits = enterBlueprintVisit([], point, f.graphs[1].id), before = structuredClone(f.project), result = resolveBlueprintReturn(f.project, visits);
  assert.equal(result.point?.ui?.instanceId, 'owner'); assert.deepEqual(f.project, before);
  f.project.ui.instances = f.project.ui.instances.filter(instance => instance.id !== 'owner'); assert.equal(resolveBlueprintReturn(f.project, visits).point, undefined); assert.equal(f.project.ui.activeInstanceId, 'other');
});
test('missing custom pages and removed controls never resolve to the currently open page or control', () => {
  const f = fixture(); f.project.ui.customPages.push({ id: 'page', name: '原页面', modal: true, components: [{ id: 'control', kind: 'button', page: 'custom', text: '原控件', x: 0, y: 0, width: 100, height: 40 }] });
  const graph = createUiEventGraph(f.project, 'page', '页面图');
  const visits = enterBlueprintVisit([], { projectId: f.project.id, origin: canvasLocation(graph, [], [], { x: 1, y: 2, zoom: 1 }, { open: true, tab: 'links' }), ui: { page: 'custom', customPageId: 'page', componentId: 'control' } }, f.graphs[0].id);
  f.project.ui.customPages[0].components = []; const result = resolveBlueprintReturn(f.project, visits);
  assert.equal(result.point?.ui?.componentId, undefined); assert.equal(result.changed, true); assert.deepEqual(result.point?.origin.nodeIds, []); assert.equal(result.point?.origin.primaryNodeId, undefined);
  f.project.ui.customPages = []; assert.equal(resolveBlueprintReturn(f.project, visits).point, undefined);
});


test('multi-node and edge-only selections survive a visit without forcing an unrelated active node', () => {
  const f = fixture(), first = f.graphs[0].nodes[0], second = blueprintNodeDefaults('delay'); f.graphs[0].nodes.push(second);
  f.graphs[0].links.push({ id: 'edge', fromNodeId: first.id, fromPinId: 'exec', toNodeId: second.id, toPinId: 'exec_in' });
  for (const nodeIds of [[first.id, second.id], []]) {
    const origin = canvasLocation(f.graphs[0], nodeIds, ['edge'], { x: -200, y: 315, zoom: .4 }, { open: true, tab: 'links' }, second.id);
    const result = resolveBlueprintReturn(f.project, enterBlueprintVisit([], { projectId: f.project.id, origin }, f.graphs[1].id));
    assert.deepEqual(result.point?.origin.nodeIds, nodeIds); assert.deepEqual(result.point?.origin.linkIds, ['edge']);
    assert.equal(result.point?.origin.primaryNodeId, nodeIds.length ? second.id : undefined); assert.deepEqual(result.point?.origin.viewport, origin.viewport);
  }
});


test('double-click navigation retains the inspector from before the first click', () => {
  const f = fixture(), inspector = { open: false, tab: 'state' as const };
  const first = rememberBlueprintNodeClick(undefined, f.graphs[0].id, 'call', 1, inspector);
  inspector.open = true;
  const second = rememberBlueprintNodeClick(first, f.graphs[0].id, 'call', 2, { open: true, tab: 'node' });
  assert.equal(second, first); assert.deepEqual(second.inspector, { open: false, tab: 'state' });
  const point = f.point(0); point.origin.inspector = second.inspector;
  const back = resolveBlueprintReturn(f.project, enterBlueprintVisit([], point, f.graphs[1].id));
  assert.deepEqual(back.point?.origin.inspector, { open: false, tab: 'state' });
});

test('a new click, another node or another graph cannot reuse a stale double-click inspector', () => {
  const first = rememberBlueprintNodeClick(undefined, 'parent', 'call', 1, { open: true, tab: 'interface' });
  for (const [graph, node, detail] of [['parent', 'call', 1], ['parent', 'other', 2], ['other', 'call', 2]] as const) {
    const next = rememberBlueprintNodeClick(first, graph, node, detail, { open: true, tab: 'links' });
    assert.notEqual(next, first); assert.deepEqual(next.inspector, { open: true, tab: 'links' });
  }
});
