import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema } from '../src/core/model';
import { createBlueprintGraph } from '../src/core/blueprint';
import { gameFlowSchema } from '../src/core/game-flow-schema';
import { addGameFlowStep, createGameFlowStep, connectGameFlowNodes, findFlowStep, flowNodeIds, flowStepNodeId, gameFlowAttachments, gameFlowConnectionProblem, gameFlowConnections, gameFlowRoute, gameFlowTopologyDiagnostics, removeGameFlowStep } from '../src/core/game-flow-graph';
import { gameFlowDiagnostics } from '../src/core/game-flow';
import { gameFlowTransitionSupport, setGameFlowTransition } from '../src/core/game-flow-transitions';
import { flowInsertPosition, gameFlowCanvasEdges, gameFlowCanvasNodes } from '../src/renderer/game-flow-view';
import { compileProject } from '../src/runtime/compiler';
import { mutateProject } from '../src/core/project-mutation';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { applyUiDraft } from '../src/core/ui-draft';

function fixture() {
  const p = createProject();
  for (const id of ['alpha', 'beta', 'gamma']) p.blueprints.push({ ...createBlueprintGraph('function', id), id });
  const first = addGameFlowStep(p, 'beforeTitle', { kind: 'blueprint', graphId: 'alpha' });
  const second = addGameFlowStep(p, 'beforeTitle', { kind: 'blueprint', graphId: 'beta' });
  return { p, first, second, a: flowStepNodeId(first.id), b: flowStepNodeId(second.id) };
}

test('legacy projects project a top-level game-content card without mutating story or lifecycle data', () => {
  const p = createProject(), before = structuredClone(p), sceneId = p.scenes[0].id;
  const nodes = gameFlowCanvasNodes(p, sceneId), edges = gameFlowCanvasEdges(p, sceneId);
  for (const id of Object.values(flowNodeIds)) assert.ok(nodes.some(node => node.id === id));
  assert.ok(edges.some(e => e.source === flowNodeIds.newGame && e.target === flowNodeIds.story && !e.readonly));
  assert.ok(edges.some(e => e.source === flowNodeIds.title && e.target === flowNodeIds.load && !e.readonly && e.pageEvent));
  assert.ok(edges.some(e => e.source === flowNodeIds.story && e.target === flowNodeIds.title && e.readonly));
  assert.ok(edges.some(e => e.source === flowNodeIds.load && e.target === flowNodeIds.story && e.targetHandle === 'load' && e.readonly));
  assert.deepEqual(gameFlowTopologyDiagnostics(p), []);
  const compiled = compileProject(p);
  assert.match(compiled.files['game/screens.rpy'], /screen vn_blueprint_pages\(\):\s+zorder 65\s+modal False/);
  assert.match(compiled.files['game/screens.rpy'], /renpy.current_screen\(\).modal = vn_ui_pages_modal\(\)/);
  assert.match(compiled.files['game/00-vn-ui.rpy'], /def vn_ui_pages_modal\(ev=None, x=None, y=None, w=None, h=None\):/);
  assert.deepEqual(p, before);
});

test('legacy sequential steps project to the same wires and compile in the same order', () => {
  const { p, first, second, a, b } = fixture();
  delete p.gameFlow!.connections;
  assert.equal(gameFlowConnections(p)[flowNodeIds.launch], a);
  assert.equal(gameFlowConnections(p)[a], b);
  assert.equal(gameFlowConnections(p)[b], flowNodeIds.title);
  assert.deepEqual(gameFlowRoute(p, 'beforeTitle').steps.map(s => s.id), [first.id, second.id]);
  assert.equal(p.gameFlow!.connections, undefined);
});

test('wire editing changes actual generated execution, not inventory order, and retains disconnected nodes', () => {
  const { p, first, second, a, b } = fixture();
  connectGameFlowNodes(p, a, flowNodeIds.title);
  connectGameFlowNodes(p, b, a);
  connectGameFlowNodes(p, flowNodeIds.launch, b);
  assert.deepEqual(p.gameFlow!.beforeTitle.steps.map(s => s.id), [first.id, second.id]);
  assert.deepEqual(gameFlowRoute(p, 'beforeTitle').steps.map(s => s.id), [second.id, first.id]);
  const runtime = compileProject(p).files['game/01-vn-game-flow.rpy'];
  assert.ok(runtime.indexOf('call vn_blueprint_beta') < runtime.indexOf('call vn_blueprint_alpha'));
  connectGameFlowNodes(p, b, flowNodeIds.title);
  assert.equal(gameFlowRoute(p, 'beforeTitle').complete, true);
  assert.equal(p.gameFlow!.beforeTitle.steps.length, 2);
  assert.ok(gameFlowTopologyDiagnostics(p).some(d => d.severity === 'warning' && d.gameFlow?.stepId === first.id && d.message.includes('不会执行')));
  assert.doesNotMatch(compileProject(p).files['game/01-vn-game-flow.rpy'], /call vn_blueprint_alpha/);
});

test('invalid cross-phase or cyclic connections fail atomically, while a missing completion wire is diagnosed exactly', () => {
  const { p, second, a, b } = fixture();
  const opening = addGameFlowStep(p, 'beforeNewGame', { kind: 'blueprint', graphId: 'gamma' });
  const before = structuredClone(p);
  assert.throws(() => connectGameFlowNodes(p, b, a), /循环/);
  assert.throws(() => connectGameFlowNodes(p, a, flowStepNodeId(opening.id)), /同一入口/);
  assert.throws(() => connectGameFlowNodes(p, flowNodeIds.title, a), /没有可编辑/);
  assert.throws(() => connectGameFlowNodes(p, a, flowNodeIds.title, flowNodeIds.newGame), /另一个生命周期/);
  assert.throws(() => connectGameFlowNodes(p, a, flowNodeIds.story, b), /标题菜单/);
  assert.deepEqual(p, before);
  connectGameFlowNodes(p, b);
  assert.equal(gameFlowRoute(p, 'beforeTitle').complete, false);
  const issue = gameFlowTopologyDiagnostics(p).find(d => d.severity === 'error');
  assert.equal(issue?.gameFlow?.stepId, second.id);
  assert.match(issue?.message ?? '', /完成连线/);
  assert.ok(compileProject(p).diagnostics.some(d => d.severity === 'error' && d.code === 'gameFlow.connections'));
});

test('insert splices the selected wire, delete reconnects it, and source-end reconnects release the old source', () => {
  const { p, a, b } = fixture();
  const third = addGameFlowStep(p, 'beforeTitle', { kind: 'blueprint', graphId: 'gamma' }, a), c = flowStepNodeId(third.id);
  assert.equal(gameFlowConnections(p)[a], c);
  assert.equal(gameFlowConnections(p)[c], b);
  p.gameFlow!.positions = { [c]: { x: 111, y: 222 } };
  removeGameFlowStep(p, c);
  assert.equal(gameFlowConnections(p)[a], b);
  assert.equal(p.gameFlow!.positions[c], undefined);
  connectGameFlowNodes(p, flowNodeIds.launch, b, a);
  assert.equal(gameFlowConnections(p)[a], undefined);
  assert.equal(gameFlowConnections(p)[flowNodeIds.launch], b);
});

test('saved wires and layout survive schema roundtrip, UI draft merge and text synchronization', () => {
  const { p, a, b } = fixture();
  const edited = mutateProject(p, draft => {
    connectGameFlowNodes(draft, a, flowNodeIds.title);
    connectGameFlowNodes(draft, b, a);
    connectGameFlowNodes(draft, flowNodeIds.launch, b);
    draft.gameFlow!.positions = { [a]: { x: -450, y: 320 }, [flowNodeIds.title]: { x: 500, y: -220 } };
  });
  const concurrent = mutateProject(p, draft => { draft.version = '2.0.0'; });
  const merged = applyUiDraft(concurrent, { base: p, value: edited });
  assert.equal(merged.version, '2.0.0');
  const loaded = projectSchema.parse(JSON.parse(JSON.stringify(merged)));
  const text = applyTextScript(loaded, projectToText(loaded));
  assert.deepEqual(text.issues, []);
  assert.deepEqual(text.project.gameFlow, loaded.gameFlow);
  assert.deepEqual(gameFlowCanvasNodes(text.project, p.scenes[0].id).find(n => n.id === a)?.position, { x: -450, y: 320 });
  assert.notDeepEqual(p.gameFlow?.connections, edited.gameFlow?.connections);
  assert.equal(p.gameFlow?.positions, undefined);
  assert.equal(gameFlowSchema.safeParse({ ...loaded.gameFlow, positions: { [a]: { x: Infinity, y: 0 } } }).success, false);
});

test('game content belongs to the top-level view independently of the active scene', () => {
  const p = createProject();
  p.scenes.push({ id: 'other', chapterId: p.chapters[0].id, name: '第二幕' });
  const proxy = gameFlowCanvasNodes(p, 'other').find(n => n.id === flowNodeIds.story);
  assert.equal(proxy?.kind, 'storyPortal');
  assert.match(proxy?.detail ?? '', /双击进入/);
  assert.deepEqual(gameFlowCanvasNodes(p, 'other'), gameFlowCanvasNodes(p, p.scenes[0].id));
  assert.ok(gameFlowCanvasEdges(p, 'other').some(e => e.source === flowNodeIds.newGame && e.target === flowNodeIds.story));
});

test('new flow nodes avoid both game and existing story cards without moving them', () => {
  const nodes = [{ id: 'newGame', position: { x: 40, y: -100 } }, { id: 'story', position: { x: 40, y: 120 } }, { id: 'passage', position: { x: 300, y: 120 } }, { id: 'page', position: { x: 360, y: -100 } }];
  const original = structuredClone(nodes), position = flowInsertPosition(nodes, 'newGame');
  for (const node of nodes) assert.ok(position.x + 242 < node.position.x || node.position.x + 242 < position.x || position.y + 144 < node.position.y || node.position.y + 144 < position.y);
  assert.deepEqual(nodes, original);
});

test('normal creation keeps both legacy and explicit routes unchanged and only adds a disconnected inventory item', () => {
  for (const legacy of [true, false]) {
    const { p } = fixture(); if (legacy) delete p.gameFlow!.connections;
    const wires = structuredClone(gameFlowConnections(p)), route = gameFlowRoute(p, 'beforeTitle');
    const step = createGameFlowStep(p, { kind: 'blueprint', graphId: 'gamma' }), id = flowStepNodeId(step.id);
    assert.deepEqual(gameFlowConnections(p), wires);
    assert.deepEqual(gameFlowRoute(p, 'beforeTitle'), route);
    assert.equal(gameFlowAttachments(p).has(id), false);
    assert.equal(gameFlowConnections(p)[id], undefined);
    assert.match(gameFlowCanvasNodes(p).find(node => node.id === id)!.detail, /尚未接入入口/);
    assert.ok(gameFlowTopologyDiagnostics(p).some(issue => issue.severity === 'warning' && issue.gameFlow?.stepId === step.id));
  }
  const p = createProject(), before = structuredClone(gameFlowConnections(p));
  createGameFlowStep(p, { kind: 'page', pageId: 'ui:preferences' });
  assert.deepEqual(gameFlowConnections(p), before);
  assert.deepEqual(gameFlowRoute(p, 'beforeTitle').steps, []);
  assert.deepEqual(gameFlowRoute(p, 'beforeNewGame').steps, []);
});

test('a free branch chain joins either lifecycle with its shared tail, parameters, layout and source transitions intact', () => {
  const p = createProject();
  const steps = ['alpha', 'beta', 'gamma'].map(id => createGameFlowStep(p, { kind: 'blueprint', id, graphId: id, inputs: { message: id, duration: 1.25 } }));
  const [a, b, c] = steps.map(step => flowStepNodeId(step.id));
  connectGameFlowNodes(p, a, c); connectGameFlowNodes(p, b, c);
  setGameFlowTransition(p, a, { mode: 'dissolve', duration: .3 });
  setGameFlowTransition(p, c, { mode: 'none' });
  p.gameFlow!.positions = { [a]: { x: 50, y: 60 }, [b]: { x: -420, y: 300 }, [c]: { x: 200, y: 0 } };
  const before = structuredClone(p), ids = [a, b, c];
  assert.equal(gameFlowConnectionProblem(p, flowNodeIds.newGame, a), undefined);
  assert.deepEqual(p, before, 'Drag validation must not migrate inventory.');
  const joined = mutateProject(p, draft => connectGameFlowNodes(draft, flowNodeIds.newGame, a));
  assert.deepEqual(p, before, 'A connection is a single immutable history step.');
  assert.equal(joined.gameFlow!.beforeTitle.steps.length, 0);
  assert.deepEqual(joined.gameFlow!.beforeNewGame, steps);
  assert.deepEqual(joined.gameFlow!.positions, before.gameFlow!.positions);
  assert.deepEqual(joined.gameFlow!.transitions, before.gameFlow!.transitions);
  for (const id of ids) assert.equal(gameFlowAttachments(joined).get(id), 'beforeNewGame');
  connectGameFlowNodes(joined, c, flowNodeIds.story);
  assert.equal(gameFlowRoute(joined, 'beforeNewGame').complete, true);
  assert.deepEqual(gameFlowRoute(joined, 'beforeNewGame').steps.map(step => step.id), ['alpha', 'gamma']);
  assert.equal(gameFlowTransitionSupport(joined, a).supported, true);
  assert.equal(gameFlowTopologyDiagnostics(joined).filter(issue => issue.severity === 'error').length, 0);
  assert.deepEqual(projectSchema.parse(JSON.parse(JSON.stringify(joined))).gameFlow, joined.gameFlow);
  removeGameFlowStep(joined, c);
  assert.equal(gameFlowConnections(joined)[a], flowNodeIds.story);
  assert.equal(gameFlowConnections(joined)[b], flowNodeIds.story);
  assert.equal(joined.gameFlow!.transitions![c], undefined);
  assert.deepEqual(joined.gameFlow!.transitions![a], { mode: 'dissolve', duration: .3 });
});

test('an old endpoint anchors the whole branch until disconnected, and two lifecycle entries never merge', () => {
  const p = createProject();
  const [a, b, c] = ['alpha', 'beta', 'gamma'].map(id => flowStepNodeId(createGameFlowStep(p, { kind: 'blueprint', id, graphId: id }).id));
  connectGameFlowNodes(p, a, c); connectGameFlowNodes(p, b, c); connectGameFlowNodes(p, c, flowNodeIds.title);
  let before = structuredClone(p);
  assert.throws(() => connectGameFlowNodes(p, flowNodeIds.newGame, a), /同一入口/);
  assert.throws(() => connectGameFlowNodes(p, c, flowNodeIds.story), /原流程/);
  assert.deepEqual(p, before);
  connectGameFlowNodes(p, c);
  connectGameFlowNodes(p, flowNodeIds.launch, b);
  before = structuredClone(p);
  assert.throws(() => connectGameFlowNodes(p, flowNodeIds.newGame, a), /同一入口/);
  assert.throws(() => connectGameFlowNodes(p, flowNodeIds.newGame, b, flowNodeIds.launch), /另一个生命周期/);
  assert.deepEqual(p, before);
  connectGameFlowNodes(p, flowNodeIds.launch, flowNodeIds.title);
  connectGameFlowNodes(p, flowNodeIds.newGame, a);
  assert.deepEqual(p.gameFlow!.beforeNewGame.map(step => step.id), ['alpha', 'beta', 'gamma']);
  connectGameFlowNodes(p, c, flowNodeIds.story);
  connectGameFlowNodes(p, flowNodeIds.newGame, flowNodeIds.story); connectGameFlowNodes(p, c);
  connectGameFlowNodes(p, flowNodeIds.launch, a); connectGameFlowNodes(p, c, flowNodeIds.title);
  assert.deepEqual(p.gameFlow!.beforeTitle.steps.map(step => step.id), ['alpha', 'beta', 'gamma']);
  assert.equal(gameFlowRoute(p, 'beforeTitle').complete, true);
});

test('unanchored cross-inventory chains stay free, and capacity or cycle failures leave every branch untouched', () => {
  const p = createProject();
  const all = Array.from({ length: 65 }, (_, index) => createGameFlowStep(p, { kind: 'blueprint', id: 'step_' + index, graphId: 'graph' }));
  const a = flowStepNodeId(all[0].id), b = flowStepNodeId(all[64].id);
  connectGameFlowNodes(p, a, b);
  assert.equal(findFlowStep(p, a)?.phase, 'beforeTitle'); assert.equal(findFlowStep(p, b)?.phase, 'beforeNewGame');
  assert.equal(gameFlowAttachments(p).has(a), false);
  const before = structuredClone(p);
  assert.throws(() => connectGameFlowNodes(p, b, a), /循环/);
  assert.throws(() => connectGameFlowNodes(p, flowNodeIds.launch, a), /64/);
  assert.deepEqual(p, before);
  connectGameFlowNodes(p, flowNodeIds.newGame, a); connectGameFlowNodes(p, b, flowNodeIds.story);
  assert.equal(gameFlowRoute(p, 'beforeNewGame').complete, true);
  assert.deepEqual(gameFlowRoute(p, 'beforeNewGame').steps.map(step => step.id), [all[0].id, all[64].id]);
  assert.equal(p.gameFlow!.beforeNewGame.length, 2);
});

test('same-wire operations do not solidify legacy data and invalid existing edges remain disconnectable', () => {
  const { p, a, b } = fixture(); delete p.gameFlow!.connections;
  const before = structuredClone(p);
  connectGameFlowNodes(p, a, b);
  assert.deepEqual(p, before);
  assert.equal(p.gameFlow!.connections, undefined);
  p.gameFlow!.connections = { ...gameFlowConnections(p), [b]: a };
  connectGameFlowNodes(p, b);
  assert.equal(gameFlowConnections(p)[b], undefined);
  assert.doesNotMatch(gameFlowTopologyDiagnostics(p).map(issue => issue.message).join('\n'), /循环/);
});

test('moving a source end onto a free module can change its storage phase without moving either source setting', () => {
  const p = createProject();
  const existing = flowStepNodeId(addGameFlowStep(p, 'beforeNewGame', { kind: 'blueprint', graphId: 'graph', id: 'existing' }).id);
  const free = flowStepNodeId(createGameFlowStep(p, { kind: 'blueprint', graphId: 'graph', id: 'free' }).id);
  setGameFlowTransition(p, existing, { mode: 'dissolve', duration: .4 }); setGameFlowTransition(p, free, { mode: 'none' });
  const before = structuredClone(p), beforeInventory = p.gameFlow!.beforeNewGame;
  assert.equal(findFlowStep(p, free)?.phase, 'beforeTitle');
  assert.equal(gameFlowConnectionProblem(p, free, flowNodeIds.story, existing), undefined);
  assert.deepEqual(p, before); assert.equal(p.gameFlow!.beforeNewGame, beforeInventory);
  connectGameFlowNodes(p, free, flowNodeIds.story, existing);
  assert.equal(findFlowStep(p, free)?.phase, 'beforeNewGame');
  assert.equal(gameFlowConnections(p)[existing], undefined);
  assert.equal(gameFlowConnections(p)[free], flowNodeIds.story);
  assert.equal(gameFlowConnections(p)[flowNodeIds.newGame], existing);
  assert.deepEqual(p.gameFlow!.transitions, before.gameFlow!.transitions);
  assert.deepEqual(gameFlowRoute(p, 'beforeNewGame').steps.map(step => step.id), ['existing']);
  assert.equal(gameFlowRoute(p, 'beforeNewGame').complete, false);
});

test('saved malformed cross-inventory routes are diagnosed, while free save-page modules have no title restriction', () => {
  const p = createProject();
  const step = createGameFlowStep(p, { kind: 'page', pageId: 'ui:save', saveMode: 'save' }), id = flowStepNodeId(step.id);
  assert.ok(!gameFlowDiagnostics(p).some(issue => issue.message.includes('标题前没有可保存')));
  p.gameFlow!.connections = { [flowNodeIds.launch]: flowNodeIds.title, [flowNodeIds.newGame]: id, [id]: flowNodeIds.story };
  assert.ok(gameFlowTopologyDiagnostics(p).some(issue => issue.severity === 'error' && issue.message.includes('归属不一致')));
  connectGameFlowNodes(p, flowNodeIds.newGame, flowNodeIds.story); connectGameFlowNodes(p, id);
  connectGameFlowNodes(p, flowNodeIds.launch, id); connectGameFlowNodes(p, id, flowNodeIds.title);
  assert.ok(gameFlowDiagnostics(p).some(issue => issue.message.includes('标题前没有可保存')));
});
