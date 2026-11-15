import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema } from '../src/core/model';
import { createBlueprintGraph } from '../src/core/blueprint';
import { createCustomUiPage, gameFlowDiagnostics } from '../src/core/game-flow';
import { addGameFlowStep, connectGameFlowNodes, flowNodeIds, flowStepNodeId, gameFlowConnections, gameFlowRoute, removeGameFlowStep } from '../src/core/game-flow-graph';
import { gameFlowTransition, gameFlowTransitionDiagnostics, gameFlowTransitionSupport, setGameFlowTransition } from '../src/core/game-flow-transitions';
import type { FlowTransition } from '../src/core/flow-transition-schema';
import { cloneData, mutateProject } from '../src/core/project-mutation';
import { diagnosticLocation } from '../src/core/diagnostic-location';
import { applyUiDraft } from '../src/core/ui-draft';
import { applyTextScript, projectToText } from '../src/core/text-script';

const dissolve: FlowTransition = { mode: 'dissolve', duration: 0.8 };
const color: FlowTransition = { mode: 'color', outDuration: 0.2, hold: 0.1, inDuration: 0.4, color: '#123456' };

function fixture() {
  const project = createProject('启动连线过渡');
  const graph = { ...createBlueprintGraph('function', '开场动画'), id: 'opening_effect' };
  project.blueprints.push(graph);
  project.assets.push({ id: 'intro_video', name: '开场视频', kind: 'video', path: 'assets/intro.webm' });
  const first = addGameFlowStep(project, 'beforeTitle', { id: 'opening', kind: 'blueprint', graphId: graph.id });
  const second = addGameFlowStep(project, 'beforeTitle', { id: 'movie', kind: 'video', assetId: 'intro_video' });
  const intro = addGameFlowStep(project, 'beforeNewGame', { id: 'new_intro', kind: 'blueprint', graphId: graph.id });
  return { project, first, second, intro, a: flowStepNodeId(first.id), b: flowStepNodeId(second.id), c: flowStepNodeId(intro.id) };
}

test('旧工程默认没有过渡覆盖，读取和首次设置均不固化旧的顺序连线', () => {
  const untouched = createProject(), before = cloneData(untouched);
  assert.deepEqual(gameFlowTransitionSupport(untouched, flowNodeIds.launch), { supported: true, phase: 'beforeTitle', target: flowNodeIds.title });
  assert.equal(gameFlowTransition(untouched, flowNodeIds.launch), undefined);
  assert.deepEqual(gameFlowTransitionDiagnostics(untouched), []);
  assert.equal(setGameFlowTransition(untouched, 'missing', undefined), false);
  assert.deepEqual(untouched, before);
  const { project, a, b } = fixture();
  delete project.gameFlow!.connections;
  const derived = gameFlowConnections(project);
  assert.equal(setGameFlowTransition(project, a, dissolve), true);
  assert.equal(project.gameFlow!.connections, undefined);
  assert.deepEqual(gameFlowConnections(project), derived);
  assert.equal(derived[a], b);
  assert.deepEqual(gameFlowTransition(project, a), dissolve);
  assert.equal(gameFlowTransition(project, b), undefined);
});

test('启动、新游戏及真实步骤的next可配置，系统恢复、菜单事件和取消不能伪装为next', () => {
  const { project, a, b, c } = fixture();
  const page = createCustomUiPage(project, '启动说明');
  const waiting = addGameFlowStep(project, 'beforeTitle', { id: 'waiting', kind: 'page', pageId: page.id });
  const overlay = addGameFlowStep(project, 'beforeNewGame', { id: 'overlay', kind: 'page', pageId: page.id, opening: { presentation: 'overlay', wait: false } });
  for (const source of [flowNodeIds.launch, flowNodeIds.newGame, a, b, c, flowStepNodeId(waiting.id), flowStepNodeId(overlay.id)]) {
    const support = gameFlowTransitionSupport(project, source);
    assert.ok(support.supported, source);
    assert.equal(support.inactiveReason, undefined, source);
    assert.equal(setGameFlowTransition(project, source, { mode: 'none' }), true);
  }
  for (const [source, port, reason] of [
    [flowNodeIds.load, 'restore', /存档/],
    [flowNodeIds.story, 'returnTitle', /返回标题/],
    [flowNodeIds.title, 'button:main:start', /菜单按钮/],
    ['flow:page-events:ui:main', 'button:main:preferences', /菜单按钮/],
    [flowStepNodeId(waiting.id), 'cancel', /取消/],
    [a, 'other', /继续/],
    [a + ':next', 'next', /不存在/],
  ] as const) {
    const support = gameFlowTransitionSupport(project, source, port);
    assert.equal(support.supported, false, source + ':' + port);
    assert.ok(!support.supported);
    assert.match(support.reason, reason);
  }
});

test('过渡编辑原子校验、隔离调用值，同值不产生历史变化', () => {
  const { project, a } = fixture(), before = cloneData(project);
  assert.throws(() => setGameFlowTransition(project, flowNodeIds.title, dissolve), /菜单按钮/);
  assert.throws(() => setGameFlowTransition(project, a + ':next', dissolve), /不存在/);
  for (const duration of [-1, Infinity, NaN]) assert.throws(() => setGameFlowTransition(project, a, { mode: 'dissolve', duration }), /无效/);
  assert.deepEqual(project, before);
  const configured = mutateProject(project, draft => { assert.equal(setGameFlowTransition(draft, a, color), true); });
  assert.deepEqual(project, before);
  const reordered = { color: '#123456', inDuration: 0.4, hold: 0.1, outDuration: 0.2, mode: 'color' } as const;
  assert.equal(mutateProject(configured, draft => { assert.equal(setGameFlowTransition(draft, a, reordered), false); }), configured);
  const input = { mode: 'dissolve' as const, duration: 1 };
  const edited = mutateProject(configured, draft => { setGameFlowTransition(draft, a, input); });
  input.duration = 9;
  assert.deepEqual(gameFlowTransition(edited, a), { mode: 'dissolve', duration: 1 });
  assert.deepEqual(gameFlowTransition(configured, a), color, '上个历史快照可直接恢复');
  const removed = mutateProject(edited, draft => { assert.equal(setGameFlowTransition(draft, a, undefined), true); });
  assert.equal(removed.gameFlow!.transitions, undefined);
  assert.equal(mutateProject(removed, draft => { assert.equal(setGameFlowTransition(draft, a, undefined), false); }), removed);
});

test('改目标和断开保留来源设置，重接源端不搬运原来源的过渡', () => {
  const { project, a, b } = fixture();
  setGameFlowTransition(project, a, dissolve);
  setGameFlowTransition(project, b, color);
  connectGameFlowNodes(project, a, flowNodeIds.title);
  assert.deepEqual(gameFlowTransition(project, a), dissolve);
  connectGameFlowNodes(project, a);
  assert.deepEqual(gameFlowTransition(project, a), dissolve);
  const disconnected = gameFlowTransitionSupport(project, a);
  assert.ok(disconnected.supported);
  assert.equal(disconnected.target, undefined);
  assert.match(disconnected.inactiveReason ?? '', /尚未连接/);
  connectGameFlowNodes(project, a, b);
  const restored = gameFlowTransitionSupport(project, a);
  assert.ok(restored.supported);
  assert.equal(restored.inactiveReason, undefined);
  connectGameFlowNodes(project, b, flowNodeIds.title, a);
  assert.equal(gameFlowConnections(project)[a], undefined);
  assert.deepEqual(gameFlowTransition(project, a), dissolve);
  assert.deepEqual(gameFlowTransition(project, b), color);
});

test('同源同目标重接保留连线和过渡对象，不生成撤销快照', () => {
  const { project, a, b } = fixture();
  setGameFlowTransition(project, a, dissolve);
  const connections = project.gameFlow!.connections, transitions = project.gameFlow!.transitions;
  const transition = gameFlowTransition(project, a), before = cloneData(project);
  for (const previousSource of [undefined, a]) {
    assert.equal(mutateProject(project, draft => { connectGameFlowNodes(draft, a, b, previousSource); }), project);
    connectGameFlowNodes(project, a, b, previousSource);
    assert.equal(project.gameFlow!.connections, connections);
    assert.equal(project.gameFlow!.transitions, transitions);
    assert.equal(gameFlowTransition(project, a), transition);
  }
  assert.deepEqual(project, before);
});

test('旧顺序连线同目标重接不固化拓扑，真实改接才保存连线', () => {
  const untouched = createProject(), before = cloneData(untouched);
  for (const previousSource of [undefined, flowNodeIds.launch]) {
    assert.equal(mutateProject(untouched, draft => { connectGameFlowNodes(draft, flowNodeIds.launch, flowNodeIds.title, previousSource); }), untouched);
    connectGameFlowNodes(untouched, flowNodeIds.launch, flowNodeIds.title, previousSource);
    assert.equal(untouched.gameFlow, undefined);
  }
  assert.deepEqual(untouched, before);
  const { project, a, b } = fixture();
  delete project.gameFlow!.connections;
  setGameFlowTransition(project, a, dissolve);
  for (const previousSource of [undefined, a]) {
    assert.equal(mutateProject(project, draft => { connectGameFlowNodes(draft, a, b, previousSource); }), project);
    connectGameFlowNodes(project, a, b, previousSource);
    assert.equal(project.gameFlow!.connections, undefined);
  }
  const changed = mutateProject(project, draft => { connectGameFlowNodes(draft, a, flowNodeIds.title); });
  assert.notEqual(changed, project);
  assert.equal(changed.gameFlow!.connections![a], flowNodeIds.title);
  assert.equal(changed.gameFlow!.connections![b], flowNodeIds.title);
  assert.equal(project.gameFlow!.connections, undefined);
  assert.deepEqual(gameFlowTransition(changed, a), dissolve);
});

test('重复断开不产生历史，源端改接仍移除旧源连线并保留双方过渡', () => {
  const { project, a, b } = fixture();
  setGameFlowTransition(project, a, dissolve);
  setGameFlowTransition(project, b, color);
  const disconnected = mutateProject(project, draft => { connectGameFlowNodes(draft, a); });
  assert.notEqual(disconnected, project);
  assert.equal(mutateProject(disconnected, draft => { connectGameFlowNodes(draft, a); }), disconnected);
  assert.deepEqual(gameFlowTransition(disconnected, a), dissolve);
  const reconnected = mutateProject(project, draft => { connectGameFlowNodes(draft, b, flowNodeIds.title, a); });
  assert.notEqual(reconnected, project, '新源已有相同目标，仍需断开旧源');
  assert.equal(gameFlowConnections(project)[a], b);
  assert.equal(gameFlowConnections(reconnected)[a], undefined);
  assert.equal(gameFlowConnections(reconnected)[b], flowNodeIds.title);
  assert.deepEqual(gameFlowTransition(reconnected, a), dissolve);
  assert.deepEqual(gameFlowTransition(reconnected, b), color);
});

test('插入新步骤不迁移源过渡，删除只清自身并让前驱保留各自设置', () => {
  const { project, a, b } = fixture();
  setGameFlowTransition(project, flowNodeIds.launch, { mode: 'none' });
  setGameFlowTransition(project, a, dissolve);
  setGameFlowTransition(project, b, color);
  const added = addGameFlowStep(project, 'beforeTitle', { id: 'inserted', kind: 'blueprint', graphId: 'opening_effect' }, a);
  const inserted = flowStepNodeId(added.id);
  assert.equal(gameFlowConnections(project)[a], inserted);
  assert.equal(gameFlowConnections(project)[inserted], b);
  assert.deepEqual(gameFlowTransition(project, a), dissolve);
  assert.equal(gameFlowTransition(project, inserted), undefined);
  setGameFlowTransition(project, inserted, { mode: 'none' });
  const before = cloneData(project);
  const removed = mutateProject(project, draft => { removeGameFlowStep(draft, inserted); });
  assert.deepEqual(project, before, '删除与过渡清理属于同一次可撤销事务');
  assert.equal(gameFlowConnections(removed)[a], b);
  assert.equal(gameFlowTransition(removed, inserted), undefined);
  assert.deepEqual(gameFlowTransition(removed, a), dissolve);
  assert.deepEqual(gameFlowTransition(removed, b), color);
  removeGameFlowStep(removed, a);
  assert.equal(gameFlowConnections(removed)[flowNodeIds.launch], b);
  assert.equal(gameFlowTransition(removed, a), undefined);
  assert.deepEqual(gameFlowTransition(removed, flowNodeIds.launch), { mode: 'none' });
  assert.deepEqual(gameFlowTransition(removed, b), color);
  const alone = fixture();
  setGameFlowTransition(alone.project, alone.a, dissolve);
  removeGameFlowStep(alone.project, alone.a);
  assert.equal(alone.project.gameFlow!.transitions, undefined);
});

test('未接入入口和失效目标说明未启用原因，诊断可定位到来源步骤', () => {
  const { project, first, a, b } = fixture();
  setGameFlowTransition(project, a, dissolve);
  connectGameFlowNodes(project, flowNodeIds.launch, b);
  const detached = gameFlowTransitionSupport(project, a);
  assert.ok(detached.supported);
  assert.match(detached.inactiveReason ?? '', /尚未接入入口/);
  const issue = gameFlowTransitionDiagnostics(project)[0];
  assert.equal(issue.severity, 'warning');
  assert.equal(issue.code, 'gameFlow.transition.inactive');
  assert.deepEqual(issue.gameFlow, { phase: 'beforeTitle', stepId: first.id });
  assert.deepEqual(diagnosticLocation(project, issue).destination, { kind: 'gameFlow', target: { phase: 'beforeTitle', stepId: first.id } });
  assert.ok(gameFlowDiagnostics(project).some(item => item.code === 'gameFlow.transition.inactive'));
  project.gameFlow!.connections![a] = 'flow:step:missing';
  const missing = gameFlowTransitionSupport(project, a);
  assert.ok(missing.supported);
  assert.match(missing.inactiveReason ?? '', /目标流程节点已不存在/);
  assert.deepEqual(gameFlowTransition(project, a), dissolve);
});

test('跨入口和循环拓扑不误报为可执行过渡，已有配置不会因错误连接丢失', () => {
  const { project, a, b, c } = fixture();
  setGameFlowTransition(project, a, dissolve);
  const before = cloneData(project);
  assert.throws(() => connectGameFlowNodes(project, a, c), /同一入口/);
  assert.throws(() => connectGameFlowNodes(project, b, a), /循环/);
  assert.deepEqual(project, before);
  project.gameFlow!.connections![a] = c;
  const crossed = gameFlowTransitionSupport(project, a);
  assert.ok(crossed.supported);
  assert.match(crossed.inactiveReason ?? '', /同一入口/);
  project.gameFlow!.connections![a] = b;
  project.gameFlow!.connections![b] = a;
  const loop = gameFlowTransitionSupport(project, a);
  assert.ok(loop.supported);
  assert.match(loop.inactiveReason ?? '', /循环/);
  assert.deepEqual(gameFlowTransition(project, a), dissolve);
});

test('遗留来源保留可诊断可移除，空字典不会把对象原型当作过渡', () => {
  const { project } = fixture();
  project.gameFlow!.transitions = {};
  assert.equal(gameFlowTransition(project, 'constructor'), undefined);
  project.gameFlow!.transitions = { 'flow:step:removed': color, 'flow:title': dissolve, constructor: { mode: 'none' as const } };
  const loaded = projectSchema.parse(project), before = cloneData(loaded);
  const diagnostics = gameFlowTransitionDiagnostics(loaded);
  assert.equal(diagnostics.length, 3);
  assert.ok(diagnostics.every(issue => issue.severity === 'warning' && issue.code === 'gameFlow.transition.source'));
  assert.deepEqual(loaded, before);
  for (const source of ['flow:step:removed', flowNodeIds.title, 'constructor']) {
    assert.throws(() => setGameFlowTransition(loaded, source, dissolve));
    assert.equal(setGameFlowTransition(loaded, source, undefined), true);
    assert.equal(setGameFlowTransition(loaded, source, undefined), false);
  }
  assert.equal(loaded.gameFlow!.transitions, undefined);
});

test('共享同一资源的两次调用有独立出口设置，库存顺序和名字不决定归属', () => {
  const { project, first, a } = fixture();
  setGameFlowTransition(project, a, color);
  const reused = addGameFlowStep(project, 'beforeTitle', { ...cloneData(first), id: 'opening_again' }, a);
  const duplicate = flowStepNodeId(reused.id);
  assert.equal(gameFlowTransition(project, duplicate), undefined);
  setGameFlowTransition(project, duplicate, dissolve);
  const route = gameFlowRoute(project, 'beforeTitle').steps.map(step => step.id);
  project.gameFlow!.beforeTitle.steps.reverse();
  first.name = '更名后的开场';
  assert.deepEqual(gameFlowRoute(project, 'beforeTitle').steps.map(step => step.id), route);
  assert.deepEqual(gameFlowTransition(project, a), color);
  assert.deepEqual(gameFlowTransition(project, duplicate), dissolve);
});

test('JSON、文本同步和界面草稿合并保留顶层过渡，副本独立可编辑', () => {
  const { project, a, b } = fixture();
  setGameFlowTransition(project, a, dissolve);
  const edited = mutateProject(project, draft => {
    setGameFlowTransition(draft, b, color);
    draft.gameFlow!.positions = { [a]: { x: 25, y: -50 } };
  });
  const concurrent = mutateProject(project, draft => { draft.version = '2.0.0'; });
  const merged = applyUiDraft(concurrent, { base: project, value: edited });
  const loaded = projectSchema.parse(JSON.parse(JSON.stringify(merged)));
  assert.equal(loaded.version, '2.0.0');
  assert.deepEqual(loaded.gameFlow!.transitions, { [a]: dissolve, [b]: color });
  const text = applyTextScript(loaded, projectToText(loaded));
  assert.deepEqual(text.issues.filter(issue => issue.severity === 'error'), []);
  assert.deepEqual(text.project.gameFlow, loaded.gameFlow);
  const copy = cloneData(loaded);
  setGameFlowTransition(copy, a, { mode: 'none' });
  assert.deepEqual(gameFlowTransition(loaded, a), dissolve);
  assert.equal(gameFlowTransition(project, b), undefined);
});

test('顶层过渡复用有限时长与颜色校验，非法内存值有明确来源诊断', () => {
  const { project, intro, c } = fixture();
  for (const invalid of [
    { mode: 'dissolve', duration: Infinity },
    { mode: 'dissolve', duration: -1 },
    { mode: 'color', outDuration: 1, hold: 0, inDuration: 1, color: '#fff' },
    { mode: 'color', outDuration: Number.MAX_VALUE, hold: 0, inDuration: Number.MAX_VALUE, color: '#ffffff' },
  ] as FlowTransition[]) {
    project.gameFlow!.transitions = { [c]: invalid };
    assert.equal(projectSchema.safeParse(project).success, false);
    const issue = gameFlowTransitionDiagnostics(project)[0];
    assert.equal(issue.severity, 'error');
    assert.equal(issue.code, 'gameFlow.transition.value');
    assert.deepEqual(issue.gameFlow, { phase: 'beforeNewGame', stepId: intro.id });
  }
});
