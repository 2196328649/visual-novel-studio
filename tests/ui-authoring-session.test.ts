import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlueprintGraph } from '../src/core/blueprint';
import { canvasLocation } from '../src/renderer/blueprint-navigation';
import { createUiAuthoringSession, rememberedUiGraphFocus, uiGraphDetailToRemember, uiGraphEntryDetail, uiGraphEntryFocus } from '../src/renderer/ui-authoring-session';

test('authoring sessions are isolated and remember exact graph view without making a project edit', () => {
  const first = createUiAuthoringSession(), second = createUiAuthoringSession();
  const graph = createBlueprintGraph('ui', '设置事件'), original = structuredClone(graph);
  first.graphs.set(graph.id, canvasLocation(graph, [graph.nodes[0].id], [], { x: 83, y: -45, zoom: .74 }, { tab: 'links', open: false }));
  first.preferences.autoConnect = false;
  first.moduleLibrary.expanded = true; first.moduleLibrary.query = 'zz';
  first.sidebar.active = 'variable:call:' + graph.id + ':new';
  first.sidebar.directoryScroll.current = 154;
  first.sidebar.detailScroll.set(first.sidebar.active, 90);
  first.sidebar.graphDetails.set(graph.id, first.sidebar.active);
  first.sidebar.drafts.set('new-variable', { name: '尚未确认', creating: true });
  assert.equal(second.sidebar.active, undefined); assert.equal(second.sidebar.directoryScroll.current, 0);
  assert.equal(second.sidebar.detailScroll.size, 0); assert.equal(second.sidebar.graphDetails.size, 0); assert.equal(second.sidebar.drafts.size, 0);
  assert.deepEqual(second.moduleLibrary, { expanded: false, query: '' });
  const focus = rememberedUiGraphFocus(first, graph.id, 7)!;
  assert.equal(focus.request, 7); assert.deepEqual(focus.restore?.viewport, { x: 83, y: -45, zoom: .74 });
  assert.deepEqual(focus.restore?.nodeIds, [graph.nodes[0].id]); assert.equal(focus.restore?.inspector.open, false);
  assert.deepEqual(rememberedUiGraphFocus(second, graph.id, 9), { graphId: graph.id, request: 9 });
  assert.equal(second.preferences.autoConnect, true); assert.equal(rememberedUiGraphFocus(first, undefined), undefined); assert.deepEqual(graph, original);
});
test('restoration prunes deleted nodes and links instead of selecting a different target', () => {
  const graph = createBlueprintGraph('ui', '页面'), session = createUiAuthoringSession();
  session.graphs.set(graph.id, canvasLocation(graph, [graph.nodes[0].id], [], { x: 3, y: 4, zoom: 1 }, { tab: 'node', open: true }));
  graph.nodes = [];
  const remembered = rememberedUiGraphFocus(session, graph.id)!.restore!;
  const restored = canvasLocation(graph, remembered.nodeIds, remembered.linkIds, remembered.viewport, remembered.inspector, remembered.primaryNodeId);
  assert.deepEqual(restored.nodeIds, []); assert.equal(restored.primaryNodeId, undefined); assert.deepEqual(restored.viewport, remembered.viewport);
});

test('graph-only entries restore the shared session but explicit issue or selection targets take precedence', () => {
  const session = createUiAuthoringSession(), graph = createBlueprintGraph('ui', '跨入口页面图');
  const location = canvasLocation(graph, [graph.nodes[0].id], [], { x: 31, y: -26, zoom: .67 }, { open: true, tab: 'interface' });
  session.graphs.set(graph.id, location);
  const resource = uiGraphEntryFocus(session, { graphId: graph.id, request: 1 });
  const search = uiGraphEntryFocus(session, { graphId: graph.id, request: 2 });
  assert.equal(resource.restore, location); assert.equal(search.restore, location); assert.equal(search.request, 2);
  const issue = { graphId: graph.id, nodeId: graph.nodes[0].id, request: 3 };
  assert.equal(uiGraphEntryFocus(session, issue), issue);
  const empty = canvasLocation(graph, [], [], { x: 0, y: 0, zoom: 1 }, { open: false, tab: 'node' });
  const clear = { graphId: graph.id, request: 4, restore: empty };
  assert.equal(uiGraphEntryFocus(session, clear), clear); assert.deepEqual(uiGraphEntryFocus(session, clear).restore?.nodeIds, []);
  assert.deepEqual(uiGraphEntryFocus(createUiAuthoringSession(), { graphId: graph.id, request: 5 }), { graphId: graph.id, request: 5 });
});

test('resource entry restores the destination detail alongside its canvas without borrowing another graph selection', () => {
  const session = createUiAuthoringSession(), first = createBlueprintGraph('ui', '事件图A'), second = createBlueprintGraph('ui', '事件图B');
  const firstDetail = 'node:' + first.id + ':' + first.nodes[0].id;
  const secondDetail = 'variable:call:' + second.id + ':new';
  const location = canvasLocation(second, [second.nodes[0].id], [], { x: 81, y: -32, zoom: .73 }, { open: true, tab: 'node' });
  session.graphs.set(second.id, location); session.sidebar.active = firstDetail;
  session.sidebar.graphDetails.set(first.id, firstDetail); session.sidebar.graphDetails.set(second.id, secondDetail);
  const entry = { graphId: second.id, request: 9 };
  assert.equal(uiGraphEntryFocus(session, entry).restore, location);
  assert.equal(uiGraphEntryDetail(session, entry, first.id, firstDetail), secondDetail);
  assert.equal(session.sidebar.graphDetails.get(first.id), firstDetail);
  assert.equal(session.sidebar.graphDetails.get(second.id), secondDetail);
  session.sidebar.graphDetails.delete(second.id);
  assert.equal(uiGraphEntryDetail(session, entry, first.id, firstDetail), 'graph:' + second.id);
});

test('same-graph entry keeps member drafts and animation return details while an explicit node takes precedence', () => {
  const session = createUiAuthoringSession(), graphId = 'event_graph';
  session.sidebar.graphDetails.set(graphId, 'graph:' + graphId);
  for (const active of ['variable:call:' + graphId + ':new', 'animation:clip', 'page-input:page:new']) {
    const draft = { name: '尚未确认', creating: true }; session.sidebar.drafts.set(active, draft);
    assert.equal(uiGraphEntryDetail(session, { graphId }, graphId, active), active);
    assert.equal(session.sidebar.drafts.get(active), draft);
    assert.equal(uiGraphEntryDetail(session, { graphId, nodeId: 'requested' }, graphId, active), 'node:' + graphId + ':requested');
  }
  assert.equal(uiGraphEntryDetail(session, { graphId }, graphId, undefined), 'graph:' + graphId);
});

test('detail memory ignores a stale transition frame but records a destination selected during navigation', () => {
  const previous = { graphId: 'graph_a', active: 'node:graph_a:old' };
  assert.equal(uiGraphDetailToRemember(previous, 'graph_b', previous.active), undefined);
  assert.equal(uiGraphDetailToRemember(previous, 'graph_b', 'node:graph_b:requested'), 'node:graph_b:requested');
  assert.equal(uiGraphDetailToRemember(previous, 'graph_b', 'variable:call:graph_b:new'), 'variable:call:graph_b:new');
  assert.equal(uiGraphDetailToRemember({ graphId: 'graph_b', active: previous.active }, 'graph_b', 'graph:graph_b'), 'graph:graph_b');
  assert.equal(uiGraphDetailToRemember(previous, 'graph_a', 'page-settings'), 'page-settings');
  assert.equal(uiGraphDetailToRemember(previous, undefined, previous.active), undefined);
});
