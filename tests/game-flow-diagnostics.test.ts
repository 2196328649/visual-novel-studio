import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type BlueprintGraph, type BlueprintNode, type Character, type Project } from '../src/core/model';
import { adaptBlueprintNodeToPin, blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { addGameFlowStep, createCustomUiPage, createPageCall, gameFlowDiagnostics } from '../src/core/game-flow';
import { flowEntry, flowExit } from '../src/core/game-flow-graph';
import { ensureUiClickEvent, createUiEventGraph } from '../src/core/ui-logic';
import { diagnosticLocation } from '../src/core/diagnostic-location';
import { compileProject } from '../src/runtime/compiler';

function character(p: Project) { const c: Character = { id: 'test_character', name: '角色', color: '#ffffff', expressions: [] }; p.characters.push(c); return c; }
function graph(p: Project, name: string) { const g = createBlueprintGraph('function', name); p.blueprints.push(g); return g; }
function node(g: BlueprintGraph, type: BlueprintNode['type'], properties: BlueprintNode['properties'] = {}) {
  const n = blueprintNodeDefaults(type); Object.assign(n.properties, properties); g.nodes.push(n); return n;
}
function wire(p: Project, g: BlueprintGraph, from: BlueprintNode, to: BlueprintNode, output = 'exec_out', input = 'exec_in') {
  synchronizeBlueprintSignatures(p);
  const error = connectBlueprintPins(g, from.id, from.type.startsWith('event') && output === 'exec_out' ? 'exec' : output, to.id, input);
  assert.equal(error, undefined); return to;
}
function call(p: Project, g: BlueprintGraph, called: BlueprintGraph, after = g.nodes[0], args: BlueprintNode['properties'] = {}) {
  const n = node(g, 'callFunction', { graphId: called.id, ...args }); wire(p, g, after, n); return n;
}
function pageGraph(p: Project, id: string) { return p.blueprints.find(g => g.uiPageId === id)!; }
function startup(p: Project, g: BlueprintGraph) { return addGameFlowStep(p, 'beforeTitle', { kind: 'blueprint', graphId: g.id }); }
function issues(p: Project, code?: string) { return gameFlowDiagnostics(p).filter(d => code ? d.code === code : d.code?.startsWith('gameFlow.path.')); }

test('startup follows page show events and nested data dependencies to the actual offending node', () => {
  const p = createProject(), page = createCustomUiPage(p, '开场页面'), inner = graph(p, '内部计算');
  p.variables.push({ id: 'result_value', name: '结果', type: 'number', initial: 0, persistent: false });
  const read = node(inner, 'getMinigameValue'), write = node(inner, 'setVariable', { variableId: 'result_value' });
  wire(p, inner, inner.nodes[0], write); wire(p, inner, read, write, 'value', 'value');
  call(p, pageGraph(p, page.id), inner);
  addGameFlowStep(p, 'beforeTitle', { kind: 'page', pageId: page.id });
  const snapshot = structuredClone(p), found = issues(p, 'gameFlow.path.capability').find(d => d.nodeId === read.id);
  assert.ok(found); assert.match(found.message, /开场页面.*内部计算.*小游戏会话/);
  assert.deepEqual(diagnosticLocation(p, found).destination, { kind: 'blueprint', graphId: inner.id, nodeId: read.id });
  assert.deepEqual(p, snapshot);
  assert.ok(compileProject(p).diagnostics.some(d => d.nodeId === read.id && d.severity === 'error'));
});

test('inactive execution wires, false branches and data short-circuit do not acquire startup capabilities', () => {
  const p = createProject(), g = graph(p, '可达路径'), branch = node(g, 'branch', { condition: false });
  const bad = node(g, 'startDialogue'), detached = node(g, 'getMinigameValue');
  wire(p, g, g.nodes[0], branch); wire(p, g, branch, bad, 'true');
  const and = node(g, 'and', { a: false }), read = node(g, 'getMinigameValue');
  wire(p, g, and, branch, 'result', 'condition'); wire(p, g, read, and, 'value', 'b');
  startup(p, g);
  assert.equal(issues(p).length, 0);
  assert.equal(gameFlowDiagnostics(p).some(d => d.severity === 'error'), false);
  assert.ok(detached);
});

test('nested modules cannot switch the story out from under a startup lifecycle', () => {
  const p = createProject(), outer = graph(p, '外层'), inner = graph(p, '切换模块');
  const jump = node(inner, 'switchScene', { sceneId: p.scenes[0].id }); wire(p, inner, inner.nodes[0], jump); call(p, outer, inner); startup(p, outer);
  const found = issues(p, 'gameFlow.path.jump').find(d => d.nodeId === jump.id);
  assert.ok(found); assert.match(found.message, /外层.*切换模块.*完成并返回/);
});

test('saved and text actions cannot hide dialogue or implicit speaker dependencies', () => {
  for (const type of ['savedAction', 'sceneAction'] as const) {
    const p = createProject(), g = graph(p, '封装动作');
    const bad = node(g, type, type === 'savedAction' ? { action: JSON.stringify({ kind: 'startDialogue' }) } : { command: '@开始台词演出' });
    wire(p, g, g.nodes[0], bad); startup(p, g);
    assert.ok(issues(p, 'gameFlow.path.capability').some(d => d.nodeId === bad.id), type);
  }
});

test('a linked explicit character is not confused with the current speaker', () => {
  const p = createProject(), g = graph(p, '明确角色'), c = character(p);
  g.exposedInputs.push(blueprintPin('character', '角色', 'input', 'character', c.id));
  const literal = node(g, 'getInput', { inputId: 'character' }), show = node(g, 'showCharacter');
  wire(p, g, g.nodes[0], show); wire(p, g, literal, show, 'value', 'characterId'); startup(p, g);
  assert.equal(issues(p, 'gameFlow.path.capability').length, 0);
  assert.equal(gameFlowDiagnostics(p).some(d => /当前台词/.test(d.message)), false);
});

test('a character event blueprint is checked in the actual startup context', () => {
  const p = createProject(), g = graph(p, '显示角色'), c = character(p), inner = graph(p, '角色事件');
  c.blueprintId = inner.id;
  const bad = node(inner, 'startDialogue'); wire(p, inner, inner.nodes[0], bad);
  const show = node(g, 'showCharacter', { characterId: c.id }); wire(p, g, g.nodes[0], show); startup(p, g);
  assert.ok(issues(p, 'gameFlow.path.capability').some(d => d.nodeId === bad.id));
});

test('page parameters cross stable module inputs and are analyzed separately for each call', () => {
  const p = createProject(), safe = createCustomUiPage(p, '正常页'), bad = createCustomUiPage(p, '错误页');
  const badGraph = pageGraph(p, bad.id), use = node(badGraph, 'startDialogue'); wire(p, badGraph, badGraph.nodes[0], use);
  const module = graph(p, '打开参数页'); module.exposedInputs.push(blueprintPin('page', '页面', 'input', 'ui', safe.id));
  const read = node(module, 'getInput', { inputId: 'page' }), open = node(module, 'showUiPage');
  wire(p, module, module.nodes[0], open); wire(p, module, read, open, 'value', 'pageId');
  const outer = graph(p, '调用两次'), first = call(p, outer, module, outer.nodes[0], { arg_page: safe.id });
  call(p, outer, module, first, { arg_page: bad.id }); startup(p, outer);
  assert.ok(issues(p, 'gameFlow.path.capability').some(d => d.nodeId === use.id && /错误页/.test(d.message)));
});

test('dynamic page arguments are not replaced by a module default during validation', () => {
  const p = createProject(), page = createCustomUiPage(p, '默认坏页面'), event = pageGraph(p, page.id);
  const bad = node(event, 'startDialogue'); wire(p, event, event.nodes[0], bad);
  p.variables.push({ id: 'target_flag', name: '动态页面开关', type: 'boolean', initial: true, persistent: false });
  const module = graph(p, '动态入口'); module.exposedInputs.push(blueprintPin('page', '页面', 'input', 'ui', page.id));
  const read = node(module, 'getInput', { inputId: 'page' }), open = node(module, 'showUiPage');
  wire(p, module, module.nodes[0], open); wire(p, module, read, open, 'value', 'pageId');
  const outer = graph(p, '外部入口'), c = call(p, outer, module), variable = node(outer, 'getVariable', { variableId: 'target_flag' });
  const selection = node(outer, 'select', { true_value: page.id, false_value: '' });
  wire(p, outer, variable, selection, 'value', 'condition'); wire(p, outer, selection, c, 'result', 'arg_page'); startup(p, outer);
  assert.ok(issues(p, 'gameFlow.path.dynamicPage').some(d => d.nodeId === open.id && d.severity === 'warning'));
  assert.equal(issues(p, 'gameFlow.path.capability').some(d => d.nodeId === bad.id), false);
});

test('legacy mixed graph invocation stays distinct from the page show event', () => {
  const p = createProject(), page = createCustomUiPage(p, '旧页面'), existing = pageGraph(p, page.id);
  delete existing.uiPageId;
  const open = node(existing, 'showUiPage', { pageId: page.id, wait: true }); wire(p, existing, existing.nodes[0], open); startup(p, existing);
  assert.equal(issues(p).length, 0);
  assert.equal(existing.uiPageId, undefined);
});

test('replaced click callbacks and actions after closing the source page do not execute', () => {
  const p = createProject(), page = createCustomUiPage(p, '按钮页'), g = pageGraph(p, page.id), button = page.components[1];
  const bad = node(g, 'startDialogue'), click = ensureUiClickEvent(p, g, button.id, page.id);
  g.links = g.links.filter(l => l.fromNodeId !== click.id); wire(p, g, click, bad);
  const replacement = graph(p, '替换操作'), close = node(replacement, 'closeUiPage', { pageId: page.id }); wire(p, replacement, replacement.nodes[0], close);
  button.clickMode = 'replace'; button.action = 'blueprint'; button.blueprintId = replacement.id;
  addGameFlowStep(p, 'beforeTitle', { kind: 'page', pageId: page.id });
  assert.equal(issues(p).length, 0);
  button.clickMode = undefined; button.events = { beforeClick: replacement.id }; button.action = 'start';
  assert.equal(issues(p).length, 0);
});

test('page self-open and nested cycles report the already-open behavior, not unbounded recursion', () => {
  const p = createProject(), a = createCustomUiPage(p, 'A 页'), b = createCustomUiPage(p, 'B 页');
  for (const [source, target] of [[a, b], [b, a]]) {
    const g = pageGraph(p, source.id), open = node(g, 'showUiPage', { pageId: target.id, wait: true }); wire(p, g, g.nodes[0], open);
  }
  addGameFlowStep(p, 'beforeTitle', { kind: 'page', pageId: a.id });
  const found = issues(p, 'gameFlow.path.pageReentry'); assert.equal(found.length, 1);
  assert.equal(found[0].severity, 'warning'); assert.match(found[0].message, /A 页.*B 页.*alreadyOpen/);
  const p2 = createProject(), page = createCustomUiPage(p2, '顺序页面'), g = graph(p2, '两次调用');
  const first = node(g, 'showUiPage', { pageId: page.id, wait: true }), second = node(g, 'showUiPage', { pageId: page.id, wait: true });
  wire(p2, g, g.nodes[0], first); wire(p2, g, first, second); startup(p2, g);
  assert.equal(issues(p2, 'gameFlow.path.pageReentry').length, 0);
});

test('an unrelated or disconnected close node cannot prove a waiting page has a completion path', () => {
  const p = createProject(), page = createCustomUiPage(p, '没有完成出口'), g = pageGraph(p, page.id);
  g.links = []; const unused = graph(p, '未调用关闭'); node(unused, 'closeUiPage', { pageId: page.id });
  const step = addGameFlowStep(p, 'beforeTitle', { kind: 'page', pageId: page.id });
  const found = issues(p, 'gameFlow.path.noCompletion'); assert.equal(found.length, 1);
  assert.match(found[0].message, /可达.*完成.*取消/); assert.equal(found[0].severity, 'warning');
  assert.equal(found[0].gameFlow?.stepId, step.id);
});

test('return and constant branches stop unreachable completion routes', () => {
  const p = createProject(), page = createCustomUiPage(p, '早退页面'), g = pageGraph(p, page.id);
  g.links = [];
  const sequence = node(g, 'sequence'), end = node(g, 'return'), close = node(g, 'closeUiPage', { pageId: page.id });
  wire(p, g, g.nodes[0], sequence); wire(p, g, sequence, end, 'then_0'); wire(p, g, sequence, close, 'then_1');
  addGameFlowStep(p, 'beforeTitle', { kind: 'page', pageId: page.id });
  assert.equal(issues(p, 'gameFlow.path.noCompletion').length, 1);
});

test('a nested helper or child page can supply the reachable completion', () => {
  const p = createProject(), parent = createCustomUiPage(p, '父页'), child = createCustomUiPage(p, '子页');
  const parentGraph = pageGraph(p, parent.id); parentGraph.links = [];
  const childGraph = pageGraph(p, child.id), helper = graph(p, '结束父页'), close = node(helper, 'closeUiPage', { pageId: parent.id });
  wire(p, helper, helper.nodes[0], close); call(p, childGraph, helper);
  const open = node(parentGraph, 'showUiPage', { pageId: child.id }); wire(p, parentGraph, parentGraph.nodes[0], open);
  addGameFlowStep(p, 'beforeTitle', { kind: 'page', pageId: parent.id });
  assert.equal(issues(p, 'gameFlow.path.noCompletion').length, 0);
});

test('automatic and confirm completion are valid exits; cancel-only is not success', () => {
  for (const completion of ['auto', 'confirm', 'close'] as const) {
    const p = createProject(), page = createCustomUiPage(p, '出口策略'), g = pageGraph(p, page.id);
    const close = g.nodes.find(n => n.type === 'closeUiPage')!; close.properties.reason = 'cancelled';
    addGameFlowStep(p, 'beforeTitle', { kind: 'page', pageId: page.id, completion });
    assert.equal(issues(p, 'gameFlow.path.noCompletion').length, completion === 'close' ? 1 : 0);
  }
});

test('only the active scheme and inherited page show graphs run on opened built-in pages', () => {
  const p = createProject(); p.ui.instances = [{ id: 'active_theme', name: '使用中', components: [] }, { id: 'inactive_theme', name: '未使用', components: [] }]; p.ui.activeInstanceId = 'inactive_theme';
  const badGraph = createUiEventGraph(p, 'ui:preferences', '未使用方案'), bad = node(badGraph, 'startDialogue'); wire(p, badGraph, badGraph.nodes[0], bad);
  p.ui.activeInstanceId = 'active_theme';
  const g = graph(p, '打开设置'), open = node(g, 'uiAction', { screen: 'preferences' }); wire(p, g, g.nodes[0], open); startup(p, g);
  assert.equal(issues(p, 'gameFlow.path.capability').some(d => d.nodeId === bad.id), false);
  p.ui.instances[0].baseUiId = 'inactive_theme';
  assert.equal(issues(p, 'gameFlow.path.capability').some(d => d.nodeId === bad.id), true);
});

test('disconnected startup inventory is not mistaken for a currently executable route', () => {
  const p = createProject(), g = graph(p, '备用流程'), bad = node(g, 'startDialogue'); wire(p, g, g.nodes[0], bad); startup(p, g);
  p.gameFlow!.connections = { [flowEntry.beforeTitle]: flowExit.beforeTitle, [flowEntry.beforeNewGame]: flowExit.beforeNewGame };
  assert.equal(issues(p).length, 0);
  assert.equal(gameFlowDiagnostics(p).some(d => d.severity === 'error' && /当前台词/.test(d.message)), false);
});


test('module outputs use call results only after execution, not merely because an output wire exists', () => {
  for (const execute of [false, true]) {
    const p = createProject(), safe = createCustomUiPage(p, '默认页面'), bad = createCustomUiPage(p, '实际页面');
    const badGraph = pageGraph(p, bad.id), violation = node(badGraph, 'startDialogue'); wire(p, badGraph, badGraph.nodes[0], violation);
    const helper = graph(p, '返回页面'); helper.exposedOutputs.push(blueprintPin('page', '页面', 'output', 'ui', safe.id));
    const output = node(helper, 'setOutput', { outputId: 'page', value: bad.id }); wire(p, helper, helper.nodes[0], output);
    const outer = graph(p, '读取返回值'), c = node(outer, 'callFunction', { graphId: helper.id }), open = node(outer, 'showUiPage');
    wire(p, outer, c, open, 'out_page', 'pageId');
    if (execute) { wire(p, outer, outer.nodes[0], c); wire(p, outer, c, open); }
    else wire(p, outer, outer.nodes[0], open);
    startup(p, outer);
    assert.equal(issues(p, 'gameFlow.path.capability').some(d => d.nodeId === violation.id), execute);
    assert.equal(issues(p, 'gameFlow.path.dynamicPage').length, 0);
  }
});

test('a module return stops that module, not the caller continuation', () => {
  const p = createProject(), outer = graph(p, '调用者'), inner = graph(p, '提前返回');
  const sequence = node(inner, 'sequence'), end = node(inner, 'return'), dead = node(inner, 'startDialogue');
  wire(p, inner, inner.nodes[0], sequence); wire(p, inner, sequence, end, 'then_0'); wire(p, inner, sequence, dead, 'then_1');
  const called = call(p, outer, inner), reachable = node(outer, 'startDialogue'); wire(p, outer, called, reachable); startup(p, outer);
  assert.deepEqual(issues(p, 'gameFlow.path.capability').map(d => d.nodeId), [reachable.id]);
});

test('counted loops respect an empty range, an exact index and early return', () => {
  for (const mode of ['empty', 'one', 'return'] as const) {
    const p = createProject(), g = graph(p, mode), loop = node(g, 'forLoop', { firstIndex: 1, lastIndex: mode === 'empty' ? 0 : 1 });
    const bad = node(g, 'startDialogue'); wire(p, g, g.nodes[0], loop);
    if (mode === 'return') {
      const end = node(g, 'return'); wire(p, g, loop, end, 'loop_body'); wire(p, g, loop, bad, 'completed');
    } else {
      const branch = node(g, 'branch'), compare = node(g, 'compare', { b: 1, operator: 'eq' });
      wire(p, g, loop, branch, 'loop_body'); wire(p, g, branch, bad, 'true');
      wire(p, g, loop, compare, 'index', 'a'); wire(p, g, compare, branch, 'result', 'condition');
    }
    startup(p, g);
    assert.equal(issues(p, 'gameFlow.path.capability').some(d => d.nodeId === bad.id), mode === 'one', mode);
  }
});

test('a disabled close button is not an exit until a reachable event enables it', () => {
  const p = createProject(), page = createCustomUiPage(p, '禁用按钮'), g = pageGraph(p, page.id), button = page.components[1];
  button.disabled = true; addGameFlowStep(p, 'beforeTitle', { kind: 'page', pageId: page.id });
  assert.equal(issues(p, 'gameFlow.path.noCompletion').length, 1);
  const enable = node(g, 'setUiProperty', { componentId: button.id, property: 'enabled', value: true }); wire(p, g, g.nodes[0], enable);
  assert.equal(issues(p, 'gameFlow.path.noCompletion').length, 0);
});

test('timer and key handlers are reached on their actual page, but unrelated pages are not', () => {
  const p = createProject(), page = createCustomUiPage(p, '事件页'), unrelated = createCustomUiPage(p, '未打开');
  const g = pageGraph(p, page.id), other = pageGraph(p, unrelated.id);
  const timer = node(g, 'eventTimer', { pageId: page.id }), key = node(g, 'eventKey', { pageId: page.id }), first = node(g, 'startDialogue'), second = node(g, 'getMinigameValue');
  p.variables.push({ id: 'event_value', name: '事件值', type: 'number', initial: 0, persistent: false });
  const write = node(g, 'setVariable', { variableId: 'event_value' });
  wire(p, g, timer, first); wire(p, g, key, write); wire(p, g, second, write, 'value', 'value');
  const dead = node(other, 'startDialogue'); wire(p, other, other.nodes[0], dead);
  addGameFlowStep(p, 'beforeTitle', { kind: 'page', pageId: page.id });
  const ids = issues(p, 'gameFlow.path.capability').map(d => d.nodeId);
  assert.ok(ids.includes(first.id)); assert.ok(ids.includes(second.id)); assert.equal(ids.includes(dead.id), false);
});

test('later show callbacks do not run after an earlier callback closes the source instance', () => {
  const p = createProject(), page = createCustomUiPage(p, '显示即关'), g = pageGraph(p, page.id);
  const close = node(g, 'closeUiPage', { pageId: page.id }); wire(p, g, g.nodes[0], close);
  const later = graph(p, '晚到回调'), bad = node(later, 'startDialogue'); wire(p, later, later.nodes[0], bad); page.onShowBlueprintId = later.id;
  addGameFlowStep(p, 'beforeTitle', { kind: 'page', pageId: page.id });
  assert.equal(issues(p).length, 0);
});

test('startup component violations navigate to their page and control while preserving flow context', () => {
  const p = createProject(), page = createCustomUiPage(p, '错误按钮'), button = page.components[1];
  button.clickMode = 'replace'; button.action = 'start';
  const step = addGameFlowStep(p, 'beforeNewGame', { kind: 'page', pageId: page.id });
  const issue = issues(p, 'gameFlow.path.jump').find(d => d.ui?.componentId === button.id)!;
  assert.ok(issue); assert.deepEqual(issue.gameFlow, { phase: 'beforeNewGame', stepId: step.id });
  assert.deepEqual(diagnosticLocation(p, issue).destination, { kind: 'ui', target: { page: 'custom', componentId: button.id, customPageId: page.id } });
});

test('many sequential closed-page steps do not exhaust the state budget or acquire reentry', () => {
  const p = createProject(), page = createCustomUiPage(p, '顺序关闭');
  for (let i = 0; i < 64; i++) addGameFlowStep(p, 'beforeTitle', { kind: 'page', pageId: page.id });
  const before = structuredClone(p);
  assert.deepEqual(issues(p), []); assert.deepEqual(p, before);
});

test('overlays are preserved across consecutive game-flow steps instead of inventing new instances', () => {
  const p = createProject(), page = createCustomUiPage(p, '保留叠加页');
  addGameFlowStep(p, 'beforeTitle', { kind: 'page', pageId: page.id, wait: false });
  const second = addGameFlowStep(p, 'beforeTitle', { kind: 'page', pageId: page.id, wait: true });
  assert.ok(issues(p, 'gameFlow.path.pageReentry').some(d => d.gameFlow?.stepId === second.id));
});


test('a nonwaiting page cannot finish before the next synchronous reopen returns alreadyOpen', () => {
  const p = createProject(), page = createCustomUiPage(p, '延后显示事件'), pg = pageGraph(p, page.id);
  const close = node(pg, 'closeUiPage', { pageId: page.id }); wire(p, pg, pg.nodes[0], close);
  const g = graph(p, '立即重开'), first = node(g, 'showUiPage', { pageId: page.id, wait: false }), second = node(g, 'showUiPage', { pageId: page.id, wait: true });
  const comparison = node(g, 'compare', { b: 'alreadyOpen', operator: 'eq' }), branch = node(g, 'branch'), bad = node(g, 'startDialogue');
  wire(p, g, g.nodes[0], first); wire(p, g, first, second); wire(p, g, second, branch); wire(p, g, branch, bad, 'false');
  adaptBlueprintNodeToPin(comparison, second.pins.find(pin => pin.id === 'reason'));
  wire(p, g, second, comparison, 'reason', 'a'); wire(p, g, comparison, branch, 'result', 'condition'); startup(p, g);
  assert.equal(issues(p, 'gameFlow.path.capability').length, 0);
  assert.equal(issues(p, 'gameFlow.path.pageReentry').length, 1);
});

test('closing an overlay before the first interaction prevents its show and control events', () => {
  const p = createProject(), page = createCustomUiPage(p, '从未显示'), pg = pageGraph(p, page.id);
  const bad = node(pg, 'startDialogue'); wire(p, pg, pg.nodes[0], bad);
  const g = graph(p, '同步开关'), open = node(g, 'showUiPage', { pageId: page.id, wait: false }), close = node(g, 'closeUiPage', { pageId: page.id });
  wire(p, g, g.nodes[0], open); wire(p, g, open, close); startup(p, g);
  assert.equal(issues(p, 'gameFlow.path.capability').length, 0);
});

test('closing a stack parent closes an independently opened child with parentClosed', () => {
  const p = createProject(), parent = createCustomUiPage(p, '栈父页'), child = createCustomUiPage(p, '栈子页'), childGraph = pageGraph(p, child.id);
  const closeParent = node(childGraph, 'closeUiPage', { pageId: parent.id }); wire(p, childGraph, childGraph.nodes[0], closeParent);
  const g = graph(p, '同一外部调用者'), openParent = node(g, 'showUiPage', { pageId: parent.id, wait: false }), openChild = node(g, 'showUiPage', { pageId: child.id, wait: true });
  const compare = node(g, 'compare', { b: 'parentClosed', operator: 'eq' }), branch = node(g, 'branch'), bad = node(g, 'startDialogue');
  wire(p, g, g.nodes[0], openParent); wire(p, g, openParent, openChild); wire(p, g, openChild, branch); wire(p, g, branch, bad, 'false');
  adaptBlueprintNodeToPin(compare, openChild.pins.find(pin => pin.id === 'reason'));
  wire(p, g, openChild, compare, 'reason', 'a'); wire(p, g, compare, branch, 'result', 'condition'); startup(p, g);
  assert.equal(issues(p, 'gameFlow.path.capability').length, 0);
});

test('yielding before a synchronous close still exposes the page timer and control paths', () => {
  const p = createProject(), page = createCustomUiPage(p, '等待期间的事件'), events = pageGraph(p, page.id);
  const timer = node(events, 'eventTimer', { pageId: page.id, interval: .1 }), bad = node(events, 'startDialogue'); wire(p, events, timer, bad);
  const g = graph(p, '等待后关闭'), opened = node(g, 'showUiPage', { pageId: page.id, wait: false }), delay = node(g, 'delay', { seconds: .5 }), close = node(g, 'closeUiPage', { pageId: page.id });
  wire(p, g, g.nodes[0], opened); wire(p, g, opened, delay); wire(p, g, delay, close); startup(p, g);
  assert.ok(issues(p, 'gameFlow.path.capability').some(d => d.nodeId === bad.id));
});

test('an upper OnShow can close a covered parent before the lower OnShow dispatches', () => {
  const p = createProject(), parent = createCustomUiPage(p, '未显示的父页'), child = createCustomUiPage(p, '不可提前关闭的遮挡页');
  const parentEvents = pageGraph(p, parent.id), bad = node(parentEvents, 'startDialogue'); wire(p, parentEvents, parentEvents.nodes[0], bad);
  const childEvents = pageGraph(p, child.id); childEvents.links = [];
  const closeParent = node(childEvents, 'closeUiPage', { pageId: parent.id }); wire(p, childEvents, childEvents.nodes[0], closeParent);
  const g = graph(p, '显示遮挡后一起关闭'), a = node(g, 'showUiPage', { pageId: parent.id, wait: false }), b = node(g, 'showUiPage', { pageId: child.id, wait: false });
  const delay = node(g, 'delay', { seconds: .1 }), close = node(g, 'closeUiPage', { pageId: parent.id });
  wire(p, g, g.nodes[0], a); wire(p, g, a, b); wire(p, g, b, delay); wire(p, g, delay, close); startup(p, g);
  assert.equal(issues(p, 'gameFlow.path.capability').some(d => d.nodeId === bad.id), false);
});

test('a newly uncovered page may dispatch OnShow before an awaited child returns to its caller', () => {
  const p = createProject(), parent = createCustomUiPage(p, '等待返回间隙显示'), child = createCustomUiPage(p, '先关闭的子页');
  const events = pageGraph(p, parent.id), bad = node(events, 'startDialogue'); wire(p, events, events.nodes[0], bad);
  const g = graph(p, '子页返回时才关闭父页'), a = node(g, 'showUiPage', { pageId: parent.id, wait: false }), b = node(g, 'showUiPage', { pageId: child.id, wait: true });
  const close = node(g, 'closeUiPage', { pageId: parent.id });
  wire(p, g, g.nodes[0], a); wire(p, g, a, b); wire(p, g, b, close); startup(p, g);
  assert.ok(issues(p, 'gameFlow.path.capability').some(d => d.nodeId === bad.id));
});

test('saved and text waits also allow page events before the following close', () => {
  for (const type of ['savedAction', 'sceneAction'] as const) {
    const p = createProject(), page = createCustomUiPage(p, '封装等待的事件页'), events = pageGraph(p, page.id);
    const timer = node(events, 'eventTimer', { pageId: page.id, interval: .1 }), bad = node(events, 'startDialogue'); wire(p, events, timer, bad);
    const g = graph(p, '封装等待'), opened = node(g, 'showUiPage', { pageId: page.id, wait: false });
    const pause = node(g, type, type === 'savedAction' ? { action: JSON.stringify({ kind: 'pause', seconds: .5 }) } : { command: '@等待：0.5' });
    const close = node(g, 'closeUiPage', { pageId: page.id });
    wire(p, g, g.nodes[0], opened); wire(p, g, opened, pause); wire(p, g, pause, close); startup(p, g);
    assert.ok(issues(p, 'gameFlow.path.capability').some(d => d.nodeId === bad.id), type);
  }
});

test('dynamic modality is not silently replaced with the design modal default', () => {
  const p = createProject(), parent = createCustomUiPage(p, '可能未被遮挡'), child = createCustomUiPage(p, '动态模态');
  p.variables.push({ id: 'modal_mode', name: '动态模态模式', type: 'string', initial: 'modeless', persistent: false });
  const parentEvents = pageGraph(p, parent.id), bad = node(parentEvents, 'startDialogue'); wire(p, parentEvents, parentEvents.nodes[0], bad);
  const childEvents = pageGraph(p, child.id); childEvents.links = [];
  const closeParent = node(childEvents, 'closeUiPage', { pageId: parent.id }); wire(p, childEvents, childEvents.nodes[0], closeParent);
  const g = graph(p, '动态遮挡'), a = node(g, 'showUiPage', { pageId: parent.id, wait: false }), b = node(g, 'showUiPage', { pageId: child.id, wait: false });
  const mode = node(g, 'getVariable', { variableId: 'modal_mode' }), delay = node(g, 'delay', { seconds: .1 });
  wire(p, g, g.nodes[0], a); wire(p, g, a, b); wire(p, g, mode, b, 'value', 'modalMode'); wire(p, g, b, delay); startup(p, g);
  assert.ok(issues(p, 'gameFlow.path.capability').some(d => d.nodeId === bad.id));
});

test('recursive modules and large loops disclose analysis limits rather than pretending to verify them', () => {
  const p = createProject(), recursive = graph(p, '尚未返回的递归模块'); call(p, recursive, recursive); startup(p, recursive);
  assert.ok(issues(p, 'gameFlow.path.moduleRecursion').some(d => d.severity === 'warning'));
  const p2 = createProject(), g = graph(p2, '超过展开上限的循环'), loop = node(g, 'forLoop', { firstIndex: 0, lastIndex: 32 }), body = node(g, 'delay', { seconds: 0 });
  wire(p2, g, g.nodes[0], loop); wire(p2, g, loop, body, 'loop_body'); startup(p2, g);
  assert.ok(issues(p2, 'gameFlow.path.analysisLimit').some(d => /不能视为已经验证/.test(d.message)));
});

test('Python float formatting must not be pruned using JavaScript integer-looking strings', () => {
  const p = createProject(), g = graph(p, '浮点数文字'), number = node(g, 'math', { a: 1, b: 1, operation: 'divide' });
  const format = node(g, 'formatText'), compare = node(g, 'compare', { b: '1.0', operator: 'eq' }), branch = node(g, 'branch'), bad = node(g, 'startDialogue');
  adaptBlueprintNodeToPin(compare, format.pins.find(pin => pin.id === 'text'));
  wire(p, g, number, format, 'result', 'value'); wire(p, g, format, compare, 'text', 'a'); wire(p, g, compare, branch, 'result', 'condition');
  wire(p, g, g.nodes[0], branch); wire(p, g, branch, bad, 'true'); startup(p, g);
  assert.ok(issues(p, 'gameFlow.path.capability').some(d => d.nodeId === bad.id));
});
