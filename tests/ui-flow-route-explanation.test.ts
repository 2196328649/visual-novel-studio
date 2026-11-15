import assert from 'node:assert/strict';
import test from 'node:test';
import { blueprintNodeDefaults, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { blueprintTaskProblems } from '../src/core/blueprint-tasks';
import { createUiFlowRouteAnalyzer } from '../src/core/ui-flow-route-explanation';
import { setBlueprintPageOpening } from '../src/core/ui-page-opening';
import { setUiFlowTarget, uiFlowEventRouteSummary, uiFlowRouteBadges, uiFlowRouteOpeningSummary, uiPageFlowEvents, type UiFlowEvent, type UiFlowRoute } from '../src/core/ui-page-flow';
import { pageFlowCanvas } from '../src/renderer/game-flow-view';
import { uiFlowRouteExplanationFixture } from '../scripts/lib/ui-flow-route-explanation-fixture';

type Fixture = ReturnType<typeof uiFlowRouteExplanationFixture>;
const event = (fixture: Fixture, componentId: string) => uiPageFlowEvents(fixture.project, fixture.parent.id).find(event => event.componentId === componentId)!;
const text = (route: UiFlowRoute) => route.paths?.flatMap(path => path.steps.map(step => step.label)).join('\n') ?? '';
const analyze = (fixture: Fixture, graphId: string, rootId?: string) => createUiFlowRouteAnalyzer(fixture.project)(graphId, rootId, { kind: 'trigger', label: '点击按钮', graphId, nodeId: rootId });

test('conditional destinations retain both authored branches, named inputs and locating sources without evaluating project state', () => {
  const f = uiFlowRouteExplanationFixture(), before = structuredClone(f.project), selected = event(f, f.conditional.component.id);
  assert.equal(selected.editable, false); assert.equal(selected.routes.length, 2);
  assert.equal(uiFlowEventRouteSummary(selected).title, '条件分支');
  const yes = selected.routes.find(route => route.nodeId === f.conditional.first.id)!, no = selected.routes.find(route => route.nodeId === f.conditional.second.id)!;
  assert.match(text(yes), /满足时：.*章节进度.*大于或等于 2/); assert.match(text(no), /不满足时：.*章节进度.*大于或等于 2/);
  for (const route of selected.routes) {
    assert.deepEqual(uiFlowRouteBadges(route), ['按条件']);
    assert.equal(route.paths![0].steps.find(step => step.kind === 'condition')!.nodeId, f.conditional.branch.id);
    assert.equal(route.paths![0].steps[0].nodeId, f.conditional.entry.id);
  }
  assert.throws(() => setUiFlowTarget(f.project, f.parent.id, selected.id, { kind: 'system', action: 'return' }), /原事件图/);
  assert.deepEqual(f.project, before);
  f.project.variables.find(variable => variable.id === 'route_progress')!.initial = 99;
  assert.deepEqual(event(f, f.conditional.component.id).routes, selected.routes, 'design initial values do not prune possible branches');
});

test('merging branches share one destination card while retaining both condition paths and real operations', () => {
  const f = uiFlowRouteExplanationFixture(), selected = event(f, f.merged.component.id);
  assert.equal(selected.routes.length, 1); assert.equal(selected.routes[0].paths?.length, 2);
  assert.match(text(selected.routes[0]), /满足时：/); assert.match(text(selected.routes[0]), /不满足时：/);
  assert.ok(selected.routes[0].paths!.every(path => path.steps.some(step => step.kind === 'operation')));
  assert.equal(pageFlowCanvas(f.project, f.parent.id).edges.filter(edge => edge.pageEvent?.eventId === selected.id).length, 1);
  assert.equal(uiFlowEventRouteSummary(selected).title, '条件分支');
});

test('sequence outlets express their declared step order and direct continuations express page wait semantics', () => {
  const f = uiFlowRouteExplanationFixture(), ordered = event(f, f.sequence.component.id);
  assert.equal(uiFlowEventRouteSummary(ordered).title, '含顺序步骤');
  assert.deepEqual(ordered.routes.map(route => route.paths![0].steps.find(step => step.kind === 'sequence')!.order), [1, 2]);
  assert.match(text(ordered.routes[0]), /第一步/); assert.match(text(ordered.routes[1]), /第二步/);
  const continued = event(f, f.continued.component.id), next = continued.routes.find(route => route.nodeId === f.continued.second.id)!;
  assert.match(text(next), /详细说明.*关闭并返回后继续/); assert.equal(next.paths![0].sequential, true);
  setBlueprintPageOpening(f.continued.first, { wait: false });
  assert.match(text(event(f, f.continued.component.id).routes.find(route => route.nodeId === f.continued.second.id)!), /详细说明.*显示后继续，不等待关闭/);
});

test('flat route count never promises sequential execution without supporting path facts', () => {
  const selected: UiFlowEvent = { id: 'legacy', pageId: 'ui:main', name: '旧路线', editable: false, routes: [
    { target: { kind: 'page', pageId: 'ui:preferences' }, label: 'A' }, { target: { kind: 'system', action: 'return' }, label: 'B' },
  ] };
  assert.equal(uiFlowEventRouteSummary(selected).title, '多个可能去向');
  assert.doesNotMatch(uiFlowEventRouteSummary(selected).description, /依次打开|执行多个步骤/);
});

test('an explicit condition outranks a legacy variable fallback and missing old condition pins still explain that fallback', () => {
  const f = uiFlowRouteExplanationFixture(), branch = f.conditional.branch;
  f.graph.links = f.graph.links.filter(link => link.toNodeId !== branch.id || link.toPinId !== 'condition');
  branch.properties.variableId = 'route_progress'; branch.properties.value = 7; branch.properties.condition = false;
  let selected = event(f, f.conditional.component.id);
  assert.match(text(selected.routes[0]), /满足时：关闭/); assert.doesNotMatch(text(selected.routes[0]), /章节进度/);
  delete branch.properties.condition; branch.pins = branch.pins.filter(pin => pin.id !== 'condition');
  selected = event(f, f.conditional.component.id);
  assert.match(text(selected.routes[0]), /章节进度 等于 7/);
});

test('click handlers keep the existing before/event/callback ordering and leave the preset action last', () => {
  const f = uiFlowRouteExplanationFixture(), before = createBlueprintGraph('function', '点击前准备'), callback = createBlueprintGraph('function', '点击后确认');
  f.project.blueprints.push(before, callback);
  f.wire(before, before.nodes[0], f.open(before, f.first)); f.wire(callback, callback.nodes[0], f.open(callback, f.second));
  const component = f.continued.component; component.events = { beforeClick: before.id, onClick: callback.id }; component.action = 'return';
  const selected = event(f, component.id), roots = selected.routes.map(route => route.paths![0].steps[0]);
  assert.match(roots[0].label, /点击处理 1 · 点击前接入/);
  assert.match(roots[1].label, /点击处理 2 · 点击事件/); assert.match(roots[3].label, /点击处理 3 · 绑定的点击事件/);
  assert.equal(roots[0].order, 1); assert.equal(roots[1].order, 2); assert.equal(roots[3].order, 3);
  assert.deepEqual(selected.routes.at(-1)!.target, { kind: 'system', action: 'return' });
  assert.match(text(selected.routes.at(-1)!), /前面的点击处理完成且按钮仍可用/);
});

test('nested shared calls keep their call-site paths and remain protected from simple target editing', () => {
  const f = uiFlowRouteExplanationFixture(), secondCaller = f.node(f.graph, 'callFunction', { graphId: f.nested.graph.id }), root = f.button('route_shared_again', '另一个共享入口');
  f.wire(f.graph, root.entry, secondCaller);
  const selected = event(f, f.nested.component.id), route = selected.routes[0];
  assert.equal(selected.editable, false); assert.equal(route.graphId, f.nested.graph.id); assert.equal(route.nodeId, f.nested.open.id);
  assert.ok(route.paths![0].steps.some(step => step.kind === 'call' && step.graphId === f.graph.id && step.nodeId === f.nested.call.id));
  assert.ok(event(f, root.component.id).routes[0].paths![0].steps.some(step => step.nodeId === secondCaller.id));
  assert.equal(route.paths?.length, 1);
});

test('legal background tasks are distinguished from waiting on each possible completion status', () => {
  const f = uiFlowRouteExplanationFixture();
  assert.deepEqual(blueprintTaskProblems(f.project, f.asynchronous.graph.id), []);
  const failed = f.open(f.graph, f.second), missing = f.open(f.graph, f.second);
  f.wire(f.graph, f.asynchronous.wait, failed, 'failed'); f.wire(f.graph, f.asynchronous.wait, missing, 'missing');
  const selected = event(f, f.asynchronous.component.id);
  assert.equal(selected.routes.length, 4); assert.match(uiFlowEventRouteSummary(selected).title, /条件分支 · 异步步骤/);
  for (const [id, status] of [[f.asynchronous.first.id, '已完成'], [f.asynchronous.second.id, '已取消'], [failed.id, '执行失败'], [missing.id, '标识失效']]) {
    const route = selected.routes.find(route => route.nodeId === id)!;
    assert.match(text(route), new RegExp('等待任务后：' + status)); assert.match(text(route), /后台准备信息/);
    assert.ok(route.paths![0].steps.some(step => step.kind === 'wait' && step.nodeId === f.asynchronous.wait.id));
    assert.ok(uiFlowRouteBadges(route).includes('异步步骤'));
  }
  f.asynchronous.task.type = 'debounce'; synchronizeBlueprintSignatures(f.project);
  assert.ok(event(f, f.asynchronous.component.id).routes.every(route => uiFlowRouteBadges(route).includes('异步步骤')));
});

test('dynamic destinations and opening inputs never display the inactive default as the effective behavior', () => {
  const f = uiFlowRouteExplanationFixture(), dynamic = event(f, f.dynamic.component.id).routes[0];
  assert.deepEqual(dynamic.target, { kind: 'logic', graphId: f.dynamic.graph.id, nodeId: f.dynamic.open.id, dynamic: true });
  assert.match(text(dynamic), /页面由输入决定：输入 · 目标页面/); assert.equal(uiFlowRouteOpeningSummary(f.project, dynamic), undefined);
  const openingEvent = event(f, f.dynamicOpening.component.id), opening = openingEvent.routes[0];
  assert.equal(opening.target.kind, 'page'); assert.match(text(opening), /继续时机由输入决定：输入 · 是否等待玩家关闭/);
  assert.match(text(opening), /底层输入由输入决定：输入 · 输入接管方式/);
  assert.equal(uiFlowEventRouteSummary(openingEvent).title, '运行时输入');
  const summary = uiFlowRouteOpeningSummary(f.project, opening)!;
  assert.match(summary, /输入 · 是否等待玩家关闭/); assert.match(summary, /输入 · 输入接管方式/);
  assert.doesNotMatch(summary, /显示后继续|输入穿透/);
  const targetCard = pageFlowCanvas(f.project, f.parent.id).nodes.find(node => node.event?.id === openingEvent.id && node.target?.kind === 'page')!;
  assert.equal(targetCard.detail, summary, 'canvas and inspector describe the same effective input sources');
  const tail = f.open(f.dynamic.graph, f.second); f.wire(f.dynamic.graph, f.dynamic.open, tail);
  setBlueprintPageOpening(f.dynamic.open, { wait: false });
  assert.match(text(event(f, f.dynamic.component.id).routes.find(route => route.nodeId === tail.id)!), /该页面.*显示后继续/);
});

test('dynamic save mode and close reason identify their input sources independently of the page target', () => {
  const f = uiFlowRouteExplanationFixture(); f.nested.open.properties.pageId = 'ui:save';
  const mode = f.node(f.nested.graph, 'literal', { value: 'save' });
  f.wire(f.nested.graph, mode, f.nested.open, 'value', 'saveMode');
  const route = event(f, f.nested.component.id).routes[0];
  assert.equal(route.target.kind, 'logic'); assert.match(text(route), /存读档用途由输入决定：常量/);
  const close = f.node(f.nested.graph, 'closeUiPage', { pageId: f.parent.id }), reason = f.node(f.nested.graph, 'literal', { value: 'cancelled' });
  f.wire(f.nested.graph, close, f.open(f.nested.graph, f.second)); f.wire(f.nested.graph, reason, close, 'value', 'reason');
  f.wire(f.nested.graph, f.nested.graph.nodes[0], close);
  const closed = event(f, f.nested.component.id);
  assert.match(text(closed.routes[0]), /关闭原因由输入决定：常量/);
  assert.deepEqual(closed.routes[0].target, { kind: 'system', action: 'return', reason: undefined });
  assert.match(text(closed.routes[1]), /关闭请求未中断当前调用时/);
});

test('legacy uiAction waits for a custom page even when its modern default says display then continue', () => {
  const f = uiFlowRouteExplanationFixture(), legacy = f.node(f.graph, 'uiAction', { screen: f.second.id }), next = f.open(f.graph, f.first);
  f.wire(f.graph, f.conditional.entry, legacy); f.wire(f.graph, legacy, next);
  const selected = event(f, f.conditional.component.id), route = selected.routes.find(route => route.nodeId === legacy.id)!;
  assert.deepEqual(route.opening, { wait: true }); assert.match(uiFlowRouteOpeningSummary(f.project, route)!, /等待关闭/);
  assert.doesNotMatch(uiFlowRouteOpeningSummary(f.project, route)!, /显示后继续/);
  assert.match(text(selected.routes.find(route => route.nodeId === next.id)!), /简短说明.*关闭并返回后继续/);
});

test('gate reset follows only its update outlet and loops expose repetition without unfolding every iteration', () => {
  const f = uiFlowRouteExplanationFixture(), gate = f.node(f.graph, 'gate'), updated = f.open(f.graph, f.first), through = f.open(f.graph, f.second);
  f.wire(f.graph, f.conditional.entry, gate, 'exec', 'reset'); f.wire(f.graph, gate, updated, 'updated'); f.wire(f.graph, gate, through, 'exec_out');
  let selected = event(f, f.conditional.component.id);
  assert.equal(selected.routes.length, 1); assert.equal(selected.routes[0].nodeId, updated.id); assert.match(text(selected.routes[0]), /重置完成后继续/);
  assert.ok(!uiFlowRouteBadges(selected.routes[0]).includes('按条件'));
  const loop = f.node(f.graph, 'forLoop', { firstIndex: 0, lastIndex: 999 });
  f.wire(f.graph, f.conditional.entry, loop); f.wire(f.graph, loop, updated, 'loop_body'); f.wire(f.graph, loop, through, 'completed');
  selected = event(f, f.conditional.component.id);
  assert.equal(selected.routes.length, 2); assert.ok(uiFlowRouteBadges(selected.routes.find(route => route.nodeId === updated.id)!).includes('循环'));
  assert.match(text(selected.routes.find(route => route.nodeId === through.id)!), /循环全部结束后继续/);
  assert.equal(selected.routeAnalysis?.limited, false);
});

test('switch names, unmatched cases and player confirmation describe separate possible routes', () => {
  const f = uiFlowRouteExplanationFixture(), choice = f.node(f.graph, 'switchValue');
  choice.properties.cases = JSON.stringify([{ id: 'happy', name: '好结局', key: 'HAPPY' }, { id: 'bad', name: '坏结局', key: 'BAD' }]);
  f.wire(f.graph, f.conditional.entry, choice); f.wire(f.graph, choice, f.conditional.first, 'case_happy'); f.wire(f.graph, choice, f.conditional.second, 'default');
  let selected = event(f, f.conditional.component.id);
  assert.match(text(selected.routes.find(route => route.nodeId === f.conditional.first.id)!), /HAPPY.*好结局/);
  assert.match(text(selected.routes.find(route => route.nodeId === f.conditional.second.id)!), /未匹配其他分支时/);
  const confirm = f.node(f.graph, 'confirmMessage', { message: '是否继续？' });
  f.wire(f.graph, f.conditional.entry, confirm); f.wire(f.graph, confirm, f.conditional.first, 'yes'); f.wire(f.graph, confirm, f.conditional.second, 'no');
  selected = event(f, f.conditional.component.id);
  assert.match(text(selected.routes[0]), /等待玩家确定.*是否继续/); assert.match(text(selected.routes[1]), /等待玩家取消/);
});

test('recursion, missing calls and long or cyclic paths stay bounded and visibly incomplete', () => {
  const f = uiFlowRouteExplanationFixture(), recursive = f.node(f.nested.graph, 'callFunction', { graphId: f.nested.graph.id });
  f.wire(f.nested.graph, f.nested.open, recursive);
  let selected = event(f, f.nested.component.id);
  assert.equal(selected.routeAnalysis?.limited, true); assert.equal(uiFlowEventRouteSummary(selected).title, '部分路线可追踪');
  assert.ok(selected.routes.some(route => /递归调用/.test(text(route)))); assert.ok(selected.routes.length < 4);
  f.nested.call.properties.graphId = 'missing_module'; selected = event(f, f.nested.component.id);
  assert.match(text(selected.routes[0]), /调用的蓝图已不存在/);
  const chain = createBlueprintGraph('function', '长调用路径'); f.project.blueprints.push(chain); let tail = chain.nodes[0];
  for (let index = 0; index < 40; index++) { const next = f.node(chain, 'setVariable', { variableId: 'route_count', value: index }); f.wire(chain, tail, next); tail = next; }
  const target = f.open(chain, f.first); f.wire(chain, tail, target);
  const result = analyze(f, chain.id); assert.equal(result.analysis.limited, true); assert.equal(result.routes[0].paths![0].limited, true); assert.equal(result.routes[0].paths![0].steps.length, 32);
  chain.links.push({ id: 'route_illegal_cycle', fromNodeId: target.id, fromPinId: 'exec_out', toNodeId: tail.id, toPinId: 'exec_in' });
  assert.equal(analyze(f, chain.id).analysis.limited, true);
});

test('many merged paths are capped without duplicating destination cards and duplicate execution outlets follow actual first wires', () => {
  const f = uiFlowRouteExplanationFixture(), graph = createBlueprintGraph('function', '多路径合流'); f.project.blueprints.push(graph);
  let tail = graph.nodes[0];
  for (let index = 0; index < 4; index++) {
    const branch = f.node(graph, 'branch'), join = f.node(graph, 'setVariable', { variableId: 'route_count', value: index });
    f.wire(graph, tail, branch); f.wire(graph, branch, join, 'true'); f.wire(graph, branch, join, 'false'); tail = join;
  }
  const target = f.open(graph, f.first); f.wire(graph, tail, target);
  let result = analyze(f, graph.id); assert.equal(result.routes.length, 1); assert.equal(result.routes[0].paths?.length, 4); assert.equal(result.analysis.limited, true);
  const hiddenTarget = f.open(graph, f.second);
  graph.links.push({ id: 'route_duplicate_execution', fromNodeId: tail.id, fromPinId: 'exec_out', toNodeId: hiddenTarget.id, toPinId: 'exec_in' });
  result = analyze(f, graph.id); assert.equal(result.routes.length, 1); assert.equal(result.routes[0].nodeId, target.id); assert.equal(result.analysis.limited, true);
});

test('only the actual main event is followed when calling a module and early return stops its local continuation', () => {
  const f = uiFlowRouteExplanationFixture(), extraEntry = f.node(f.nested.graph, 'event'), extraOpen = f.open(f.nested.graph, f.second);
  f.wire(f.nested.graph, extraEntry, extraOpen);
  assert.equal(event(f, f.nested.component.id).routes.length, 1);
  const stop = f.node(f.nested.graph, 'return'); f.wire(f.nested.graph, f.nested.graph.nodes[0], stop);
  stop.pins.push({ id: 'exec_out', name: '损坏的继续端口', direction: 'output', dataType: 'exec', required: false });
  f.nested.graph.links.push({ id: 'route_return_stale_link', fromNodeId: stop.id, fromPinId: 'exec_out', toNodeId: extraOpen.id, toPinId: 'exec_in' });
  assert.equal(analyze(f, f.nested.graph.id).routes.length, 0);
  f.nested.graph.nodes = f.nested.graph.nodes.filter(node => node.type !== 'event');
  assert.match(text(analyze(f, f.nested.graph.id).routes[0]), /调用入口已不存在/);
});

test('a truncated automatic button keeps a visible event instead of implying it has no route', () => {
  const f = uiFlowRouteExplanationFixture(); delete f.conditional.component.flowEvent;
  f.graph.links = f.graph.links.filter(link => link.fromNodeId !== f.conditional.entry.id);
  f.graph.links.push({ id: 'route_missing_target', fromNodeId: f.conditional.entry.id, fromPinId: 'exec', toNodeId: 'missing_target', toPinId: 'exec_in' });
  const selected = event(f, f.conditional.component.id);
  assert.ok(selected); assert.equal(selected.routeAnalysis?.limited, true); assert.equal(selected.routes[0].target.kind, 'logic');
  assert.equal(uiFlowEventRouteSummary(selected).title, '部分路线可追踪');
});

test('launchable timeline continuations state that animation continues asynchronously', () => {
  const f = uiFlowRouteExplanationFixture(), timeline = createBlueprintGraph('function', '背景动效'); (f.project.timelinePresets ??= []).push(timeline);
  const tail = blueprintNodeDefaults('delay'); timeline.nodes.push(tail); timeline.timeline = { tracks: [], clips: [], tailNodeId: tail.id };
  f.wire(timeline, timeline.nodes[0], tail);
  f.nested.call.properties.graphId = timeline.id; f.nested.call.properties.wait = false;
  const next = f.open(f.graph, f.first); f.wire(f.graph, f.nested.call, next);
  const selected = event(f, f.nested.component.id);
  assert.equal(selected.routes.length, 1); assert.match(text(selected.routes[0]), /时间轴.*启动后继续，不等待播放完成/);
  assert.ok(uiFlowRouteBadges(selected.routes[0]).includes('异步步骤')); assert.doesNotMatch(text(selected.routes[0]), /正常返回/);
});
