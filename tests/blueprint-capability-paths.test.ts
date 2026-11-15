import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type BlueprintGraph, type BlueprintNode, type Project } from '../src/core/model';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { blueprintCapabilityProblem, blueprintRequiredCapabilities, blueprintCapabilitySummary } from '../src/core/blueprint-capabilities';
import { blueprintNodeCapabilitySummary } from '../src/core/blueprint-execution-analysis';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { createCustomUiPage, addGameFlowStep, gameFlowDiagnostics } from '../src/core/game-flow';
import { createUiEventGraph } from '../src/core/ui-logic';
import { diagnosticLocation } from '../src/core/diagnostic-location';
import { compileProject } from '../src/runtime/compiler';

const graph = (p: Project, name: string) => { const g = createBlueprintGraph('function', name); p.blueprints.push(g); return g; };
const node = (g: BlueprintGraph, type: BlueprintNode['type'], properties: BlueprintNode['properties'] = {}) => { const n = blueprintNodeDefaults(type); Object.assign(n.properties, properties); g.nodes.push(n); return n; };
const wire = (p: Project, g: BlueprintGraph, from: BlueprintNode, to: BlueprintNode, output = 'exec_out', input = 'exec_in') => {
  synchronizeBlueprintSignatures(p);
  assert.equal(connectBlueprintPins(g, from.id, from.type.startsWith('event') && output === 'exec_out' ? 'exec' : output, to.id, input), undefined);
};
const pageGraph = (p: Project, id: string) => p.blueprints.find(g => g.uiPageId === id)!;
const errors = (p: Project) => validateBlueprints(p).filter(d => d.severity === 'error');

test('UI validation and compilation ignore disconnected nodes and constant-false execution paths', () => {
  const p = createProject(), page = createCustomUiPage(p, '可安全启动'), g = pageGraph(p, page.id);
  const branch = node(g, 'branch', { condition: false }), bad = node(g, 'startDialogue');
  node(g, 'finishMinigame');
  wire(p, g, g.nodes[0], branch); wire(p, g, branch, bad, 'true'); addGameFlowStep(p, 'beforeTitle', { kind: 'page', pageId: page.id });
  const before = structuredClone(p);
  assert.deepEqual(errors(p), []); assert.deepEqual(gameFlowDiagnostics(p).filter(d => d.severity === 'error'), []);
  assert.deepEqual(compileProject(p).diagnostics.filter(d => d.severity === 'error'), []); assert.deepEqual(p, before);
});

test('UI short-circuit does not read an unused minigame expression', () => {
  const p = createProject(), page = createCustomUiPage(p, '短路页面'), g = pageGraph(p, page.id);
  const and = node(g, 'and', { a: false }), read = node(g, 'getMinigameValue'), branch = node(g, 'branch'), bad = node(g, 'startDialogue');
  wire(p, g, read, and, 'value', 'b'); wire(p, g, and, branch, 'result', 'condition'); wire(p, g, g.nodes[0], branch); wire(p, g, branch, bad, 'true');
  assert.deepEqual(errors(p), []);
});

test('actual UI dependencies report the consumed nested node and preserve its destination', () => {
  const p = createProject(), page = createCustomUiPage(p, '模块调用页面'), g = pageGraph(p, page.id), inner = graph(p, '内部模块');
  p.variables.push({ id: 'score', name: '数值', type: 'number', initial: 0, persistent: false });
  const read = node(inner, 'getMinigameValue'), write = node(inner, 'setVariable', { variableId: 'score' });
  wire(p, inner, inner.nodes[0], write); wire(p, inner, read, write, 'value', 'value');
  const call = node(g, 'callFunction', { graphId: inner.id }); wire(p, g, g.nodes[0], call);
  const issue = errors(p).find(d => d.nodeId === read.id)!; assert.ok(issue); assert.equal(issue.code, 'blueprint.path.capability');
  assert.match(issue.message, /模块调用页面.*内部模块.*小游戏会话/);
  assert.deepEqual(diagnosticLocation(p, issue).destination, { kind: 'blueprint', graphId: inner.id, nodeId: read.id });
  assert.equal(errors(p).some(d => d.nodeId === call.id), false);
});

test('replaced click events and callbacks after source-page close do not acquire capabilities', () => {
  const p = createProject(), page = createCustomUiPage(p, '替换按钮'), g = pageGraph(p, page.id), button = page.components[1];
  const click = g.nodes.find(n => n.type === 'eventClick')!, bad = node(g, 'startDialogue'); g.links = []; wire(p, g, click, bad);
  const closer = graph(p, '先关闭页面'), close = node(closer, 'closeUiPage', { pageId: page.id }); wire(p, closer, closer.nodes[0], close);
  const badCallback = graph(p, '不应执行的回调'), callbackBad = node(badCallback, 'startDialogue'); wire(p, badCallback, badCallback.nodes[0], callbackBad);
  button.clickMode = 'replace'; button.action = 'blueprint'; button.blueprintId = closer.id;
  assert.deepEqual(errors(p), []);
  button.clickMode = undefined; button.events = { beforeClick: closer.id, onClick: badCallback.id }; button.blueprintId = badCallback.id;
  assert.deepEqual(errors(p), []);
});

test('only active and inherited UI scheme events require capabilities in the compiled player', () => {
  const p = createProject(); p.ui.instances = [{ id: 'active', name: '当前方案', components: [] }, { id: 'inactive', name: '备用方案', components: [] }];
  p.ui.activeInstanceId = 'inactive'; const g = createUiEventGraph(p, 'ui:preferences', '备用事件'), bad = node(g, 'startDialogue'); wire(p, g, g.nodes[0], bad);
  p.ui.activeInstanceId = 'active'; assert.deepEqual(errors(p), []);
  p.ui.instances[0].baseUiId = 'inactive'; assert.ok(errors(p).some(d => d.nodeId === bad.id));
});

test('explicit character input does not imply a current-speaker dependency in UI', () => {
  const p = createProject(); p.characters.push({ id: 'actor', name: '角色', color: '#ffffff', expressions: [] });
  const page = createCustomUiPage(p, '明确角色'), g = pageGraph(p, page.id); g.exposedInputs.push(blueprintPin('actor', '角色', 'input', 'character', 'actor'));
  const input = node(g, 'getInput', { inputId: 'actor' }), show = node(g, 'showCharacter'); wire(p, g, g.nodes[0], show); wire(p, g, input, show, 'value', 'characterId');
  assert.equal(errors(p).some(d => /当前台词/.test(d.message)), false);
});

test('a minigame-owned page is valid in minigame use but still invalid as ordinary startup UI', () => {
  const p = createProject(), page = createCustomUiPage(p, '小游戏页面'), g = pageGraph(p, page.id), finish = node(g, 'finishMinigame'); wire(p, g, g.nodes[0], finish);
  p.minigames.push({ id: 'mini', name: '小游戏', uiPageId: page.id, mode: 'blueprint', blueprintId: g.id });
  assert.equal(errors(p).some(d => /小游戏会话/.test(d.message)), false);
  addGameFlowStep(p, 'beforeTitle', { kind: 'page', pageId: page.id });
  assert.ok(gameFlowDiagnostics(p).some(d => d.nodeId === finish.id && d.severity === 'error'));
});

test('callable capability summaries ignore UI event roots and disconnected inventory', () => {
  const p = createProject(), g = graph(p, '可复用计算');
  const callback = node(g, 'eventTimer', { pageId: 'ui:main' }), bad = node(g, 'finishMinigame'); wire(p, g, callback, bad);
  node(g, 'startDialogue');
  assert.deepEqual(blueprintRequiredCapabilities(p, g), []);
  assert.equal(blueprintCapabilityProblem(p, { type: 'callFunction', properties: { graphId: g.id } }, 'ui'), undefined);
});

test('callable capability requirements follow effective argument values, including unknown linked values', () => {
  const p = createProject(), inner = graph(p, '有条件的模块'); inner.exposedInputs.push(blueprintPin('flag', '启用', 'input', 'boolean', true));
  const input = node(inner, 'getInput', { inputId: 'flag' }), branch = node(inner, 'branch'), bad = node(inner, 'startDialogue');
  wire(p, inner, inner.nodes[0], branch); wire(p, inner, input, branch, 'value', 'condition'); wire(p, inner, branch, bad, 'true');
  const descriptor = { type: 'callFunction' as const, properties: { graphId: inner.id, arg_flag: false } };
  assert.equal(blueprintCapabilityProblem(p, descriptor, 'ui'), undefined);
  assert.match(blueprintCapabilityProblem(p, { ...descriptor, properties: { ...descriptor.properties, arg_flag: true } }, 'ui')!, /当前台词/);
  const page = createCustomUiPage(p, '真实传参'), events = pageGraph(p, page.id), call = node(events, 'callFunction', descriptor.properties); wire(p, events, events.nodes[0], call);
  assert.deepEqual(errors(p), []);
  p.variables.push({ id: 'runtime_flag', name: '动态开关', type: 'boolean', initial: false, persistent: false });
  const read = node(events, 'getVariable', { variableId: 'runtime_flag' }); wire(p, events, read, call, 'value', 'arg_flag');
  assert.ok(errors(p).some(d => d.nodeId === bad.id));
  assert.match(blueprintCapabilityProblem(p, call, 'ui')!, /当前台词/);
});

test('legacy mixed callable roots are not silently treated as OnShow', () => {
  const p = createProject(), page = createCustomUiPage(p, '旧混合页面'), g = pageGraph(p, page.id); delete g.uiPageId;
  const bad = node(g, 'startDialogue'); wire(p, g, g.nodes[0], bad);
  assert.deepEqual(errors(p), []);
  page.onShowBlueprintId = g.id; assert.ok(errors(p).some(d => d.nodeId === bad.id));
});

test('declared capabilities remain a contract even when the callable body is empty', () => {
  const p = createProject(), inner = graph(p, '声明小游戏能力'); inner.requiredCapabilities = ['minigame'];
  assert.match(blueprintCapabilityProblem(p, { type: 'callFunction', properties: { graphId: inner.id } }, 'ui')!, /小游戏会话/);
  const page = createCustomUiPage(p, '契约调用页'), g = pageGraph(p, page.id), call = node(g, 'callFunction', { graphId: inner.id }); wire(p, g, g.nodes[0], call);
  assert.ok(errors(p).some(d => /小游戏会话/.test(d.message)));
});

test('saved and text actions expose their actual UI capability requirements', () => {
  for (const type of ['savedAction', 'sceneAction'] as const) {
    const p = createProject(), page = createCustomUiPage(p, '封装动作页面'), g = pageGraph(p, page.id);
    const bad = node(g, type, type === 'savedAction' ? { action: JSON.stringify({ kind: 'startDialogue' }) } : { command: '@开始台词演出' }); wire(p, g, g.nodes[0], bad);
    assert.ok(errors(p).some(d => d.nodeId === bad.id && /当前台词/.test(d.message)), type);
    assert.match(blueprintCapabilityProblem(p, bad, 'ui')!, /当前台词/, type);
  }
});

test('structural errors in disconnected nodes are still validated', () => {
  const p = createProject(), page = createCustomUiPage(p, '结构检查'), g = pageGraph(p, page.id), missing = node(g, 'callFunction', { graphId: 'missing_module' });
  assert.ok(errors(p).some(d => d.nodeId === missing.id));
});


test('callable summaries include surviving nonwaiting page events but not synchronously closed pages', () => {
  const p = createProject(), page = createCustomUiPage(p, '延后显示'), events = pageGraph(p, page.id), bad = node(events, 'startDialogue');
  wire(p, events, events.nodes[0], bad);
  const g = graph(p, '打开覆盖页'), open = node(g, 'showUiPage', { pageId: page.id, wait: false }); wire(p, g, g.nodes[0], open);
  assert.ok(blueprintRequiredCapabilities(p, g).includes('dialogue'));
  assert.match(blueprintCapabilityProblem(p, { type: 'callFunction', properties: { graphId: g.id } }, 'ui')!, /当前台词/);
  const close = node(g, 'closeUiPage', { pageId: page.id }); wire(p, g, open, close);
  assert.equal(blueprintRequiredCapabilities(p, g).includes('dialogue'), false);
  assert.equal(blueprintCapabilityProblem(p, { type: 'callFunction', properties: { graphId: g.id } }, 'ui'), undefined);
});

test('reading an unexecuted module output uses its default without invoking its capability requirements', () => {
  const p = createProject(), inner = graph(p, '未执行模块'); inner.exposedOutputs.push(blueprintPin('flag', '启用', 'output', 'boolean', false));
  const bad = node(inner, 'startDialogue'); wire(p, inner, inner.nodes[0], bad);
  const g = graph(p, '仅读取结果'), call = node(g, 'callFunction', { graphId: inner.id }), branch = node(g, 'branch'), finish = node(g, 'finishMinigame');
  wire(p, g, g.nodes[0], branch); wire(p, g, call, branch, 'out_flag', 'condition'); wire(p, g, branch, finish, 'true');
  assert.deepEqual(blueprintCapabilitySummary(p, g), { required: [], incomplete: false });
});

test('candidate pure-data checks retain boolean short-circuit and select-value semantics', () => {
  const p = createProject(), g = graph(p, '数据依赖'), read = node(g, 'getMinigameValue'), and = node(g, 'and', { a: false });
  wire(p, g, read, and, 'value', 'b');
  const before = structuredClone(p);
  assert.equal(blueprintCapabilityProblem(p, and, 'ui', g), undefined);
  const select = node(g, 'select', { condition: false, false_value: false }); wire(p, g, read, select, 'value', 'true_value');
  assert.equal(blueprintCapabilityProblem(p, select, 'ui', g), undefined);
  and.properties.a = true;
  assert.match(blueprintCapabilityProblem(p, and, 'ui', g)!, /小游戏会话/);
  assert.deepEqual(p.blueprints[0].exposedInputs, before.blueprints[0].exposedInputs);
});

test('pending candidates are checked in caller context without mutating its graph', () => {
  const p = createProject(), g = graph(p, '待插入'), candidate = blueprintNodeDefaults('startDialogue'), before = structuredClone(p);
  assert.match(blueprintCapabilityProblem(p, candidate, 'ui', g)!, /当前台词/);
  assert.deepEqual(p, before);
});

test('runtime character inputs produce an incomplete summary instead of silently assuming a speaker', () => {
  const p = createProject(), g = graph(p, '动态角色'); g.exposedInputs.push(blueprintPin('actor', '角色', 'input', 'character', ''));
  const read = node(g, 'getInput', { inputId: 'actor' }), show = node(g, 'showCharacter'); wire(p, g, g.nodes[0], show); wire(p, g, read, show, 'value', 'characterId');
  const caller = graph(p, '调用动态角色'); caller.exposedInputs.push(blueprintPin('actor', '角色', 'input', 'character', ''));
  const input = node(caller, 'getInput', { inputId: 'actor' }), call = node(caller, 'callFunction', { graphId: g.id });
  wire(p, caller, caller.nodes[0], call); wire(p, caller, input, call, 'value', 'arg_actor');
  assert.equal(blueprintCapabilitySummary(p, caller).incomplete, false);
  assert.equal(blueprintNodeCapabilitySummary(p, call, caller).incomplete, true);
});

test('closeUiPage does not cancel a legacy minigame root but finishMinigame does', () => {
  const p = createProject(), page = createCustomUiPage(p, '旧小游戏'), g = pageGraph(p, page.id), close = node(g, 'closeUiPage', { pageId: page.id }), bad = node(g, 'startDialogue');
  wire(p, g, g.nodes[0], close); wire(p, g, close, bad);
  assert.equal(errors(p).some(d => d.nodeId === bad.id), false);
  p.minigames.push({ id: 'mini', name: '旧小游戏', uiPageId: page.id, mode: 'blueprint', blueprintId: g.id });
  assert.ok(errors(p).some(d => d.nodeId === bad.id));
  const finish = node(g, 'finishMinigame'); wire(p, g, g.nodes[0], finish);
  assert.equal(errors(p).some(d => d.nodeId === bad.id), false);
});


test('inactive nested dialogue actions still generate structurally valid indented RenPy blocks', () => {
  for (const type of ['startDialogue', 'savedAction', 'sceneAction'] as const) {
    const p = createProject(), page = createCustomUiPage(p, '嵌套结构'), g = pageGraph(p, page.id);
    const outer = node(g, 'branch', { condition: false }), inner = node(g, 'branch', { condition: false });
    const bad = node(g, type, type === 'savedAction' ? { action: JSON.stringify({ kind: 'startDialogue' }) } : type === 'sceneAction' ? { command: '@开始台词演出' } : {});
    wire(p, g, g.nodes[0], outer); wire(p, g, outer, inner, 'true'); wire(p, g, inner, bad, 'true');
    const result = compileProject(p); assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error'), []);
    const lines = result.files['game/story.rpy'].split('\n');
    const index = lines.findIndex((line, i) => line.trim() === '$ vn_start_dialogue()' && result.sourceMap['game/story.rpy:' + (i + 1)]?.nodeId === bad.id);
    assert.ok(index >= 6, type);
    assert.deepEqual(lines.slice(index - 6, index + 1), [
      '            $ vn_actor_flush()',
      '            if vn_game_flow_transition_holding():',
      '                $ renpy.checkpoint(hard=False)',
      '            $ vn_flow_transition_flush()',
      '            $ vn_performance_reveal()',
      '            $ vn_apply_scene_transition()',
      '            $ vn_start_dialogue()',
    ], type);
  }
});


test('legacy minigame show dispatch is token-scoped and restored sessions do not replay callbacks', () => {
  const p = createProject(), page = createCustomUiPage(p, '旧小游戏显示');
  const init = graph(p, '小游戏初始化'); init.kind = 'minigame';
  p.minigames.push({ id: 'legacy', name: '旧小游戏', uiPageId: page.id, mode: 'blueprint', blueprintId: init.id });
  const compiled = compileProject(p); assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), []);
  const runtime = compiled.files['game/00-vn-ui.rpy'], screens = compiled.files['game/screens.rpy'];
  assert.ok(runtime.includes('"didShow": False'));
  assert.ok(runtime.includes('context.get("token") != token or context.get("didShow", True)'));
  assert.ok(runtime.indexOf('vn_minigame_context = dict(context, didShow=True)') < runtime.indexOf('task = vn_bp_task_create(page_id)', runtime.indexOf('def vn_minigame_page_shown')));
  assert.ok(screens.includes('elif vn_minigame_owns_page("' + page.id + '")'));
  assert.ok(screens.includes('timer 0.001 action Function(vn_minigame_page_shown, "' + page.id + '"'));
});
