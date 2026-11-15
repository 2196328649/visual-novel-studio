import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, newNode, type BlueprintGraph, type BlueprintNode } from '../src/core/model';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { blueprintCapabilitySummary } from '../src/core/blueprint-capabilities';
import { addGameFlowStep, createCustomUiPage } from '../src/core/game-flow';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';

// Development player and isolated saves only; no packaging or installed-app mutation.
const sdk = process.env.VNS_RENPY_SDK ?? 'E:/Tools/renpy-8.5.3-sdk';
const output = path.resolve('artifacts/blueprint-capabilities-runtime', new Date().toISOString().replaceAll(':', '-'));
const source = path.join(output, 'source'), game = path.join(output, 'game');
const report: { status: string; checks: { name: string; code: number; logPath: string }[]; assertions?: number; error?: string } = { status: 'running', checks: [] };
await fs.mkdir(source, { recursive: true });
const saveReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  const logPath = path.join(output, name + '.log'); await fs.writeFile(logPath, result.log);
  report.checks.push({ name, code: result.code, logPath }); await saveReport();
  if (result.code) throw new Error(name + ': ' + result.log.slice(-6000));
}
try {
  const p = createProject('路径能力与旧小游戏运行验收'); p.id = 'blueprint_capabilities_runtime';
  for (const id of ['safe_runs', 'after_close', 'mini_shows', 'final_value', 'after_finish']) p.variables.push({ id, name: id, type: 'number', initial: 0, persistent: false });
  p.variables.push({ id: 'phase', name: 'phase', type: 'string', initial: '', persistent: false });
  const graph = (name: string) => { const g = createBlueprintGraph('function', name); p.blueprints.push(g); return g; };
  const node = (g: BlueprintGraph, type: BlueprintNode['type'], properties: BlueprintNode['properties'] = {}) => {
    const n = blueprintNodeDefaults(type); Object.assign(n.properties, properties); g.nodes.push(n); return n;
  };
  const wire = (g: BlueprintGraph, from: BlueprintNode, to: BlueprintNode, output = 'exec_out', input = 'exec_in') => {
    synchronizeBlueprintSignatures(p);
    assert.equal(connectBlueprintPins(g, from.id, from.type.startsWith('event') && output === 'exec_out' ? 'exec' : output, to.id, input), undefined);
  };
  const chain = (g: BlueprintGraph, ...nodes: BlueprintNode[]) => nodes.slice(1).forEach((n, i) => wire(g, nodes[i], n));
  const mark = (g: BlueprintGraph, id: string, value: number | string) => node(g, 'setVariable', { variableId: id, value });
  const increment = (g: BlueprintGraph, id: string) => {
    const read = node(g, 'getVariable', { variableId: id }), add = node(g, 'math', { b: 1 }), write = mark(g, id, 0);
    wire(g, read, add, 'value', 'a'); wire(g, add, write, 'result', 'value'); return write;
  };

  const conditional = graph('条件模块'); conditional.exposedInputs.push(blueprintPin('enabled', '执行台词', 'input', 'boolean', true));
  const arg = node(conditional, 'getInput', { inputId: 'enabled' }), branch = node(conditional, 'branch'), bad = node(conditional, 'startDialogue');
  wire(conditional, conditional.nodes[0], branch); wire(conditional, arg, branch, 'value', 'condition'); wire(conditional, branch, bad, 'true');
  node(conditional, 'finishMinigame');
  const dormant = graph('仅读取默认输出'); dormant.exposedOutputs.push(blueprintPin('enabled', '默认关闭', 'output', 'boolean', false));
  const dormantBad = node(dormant, 'startDialogue'); wire(dormant, dormant.nodes[0], dormantBad);
  const startup = createCustomUiPage(p, '安全路径启动页面'), events = p.blueprints.find(g => g.uiPageId === startup.id)!;
  const call = node(events, 'callFunction', { graphId: conditional.id, arg_enabled: false });
  const short = node(events, 'and', { a: false }), miniRead = node(events, 'getMinigameValue'), decision = node(events, 'branch'), never = node(events, 'finishMinigame');
  wire(events, miniRead, short, 'value', 'b'); wire(events, short, decision, 'result', 'condition'); wire(events, decision, never, 'true');
  const readOnly = node(events, 'callFunction', { graphId: dormant.id }), outputBranch = node(events, 'branch'), outputBad = node(events, 'startDialogue');
  wire(events, readOnly, outputBranch, 'out_enabled', 'condition'); wire(events, outputBranch, outputBad, 'true');
  const safeRun = increment(events, 'safe_runs'), ready = mark(events, 'phase', 'safe_ready');
  chain(events, events.nodes[0], call, decision); wire(events, decision, outputBranch, 'false'); wire(events, outputBranch, safeRun, 'false'); wire(events, safeRun, ready);
  addGameFlowStep(p, 'beforeTitle', { kind: 'page', pageId: startup.id });

  const mini = createCustomUiPage(p, '旧小游戏页面'), miniEvents = p.blueprints.find(g => g.uiPageId === mini.id)!;
  const initial = graph('小游戏初始化'); initial.kind = 'minigame';
  const initialValue = node(initial, 'setMinigameValue', { key: 'score', value: 7 }); wire(initial, initial.nodes[0], initialValue);
  const closer = node(miniEvents, 'closeUiPage', { pageId: mini.id }), stillAlive = mark(miniEvents, 'after_close', 1), shown = increment(miniEvents, 'mini_shows');
  const miniWrite = node(miniEvents, 'setMinigameValue', { key: 'score', value: 41 }), miniValue = node(miniEvents, 'getMinigameValue', { key: 'score' }), captured = mark(miniEvents, 'final_value', 0);
  wire(miniEvents, miniValue, captured, 'value', 'value'); chain(miniEvents, miniEvents.nodes[0], closer, stillAlive, shown, miniWrite, captured, mark(miniEvents, 'phase', 'mini_ready'));
  const finisher = graph('嵌套结束小游戏'), finish = node(finisher, 'finishMinigame', { result: 'success' }); wire(finisher, finisher.nodes[0], finish);
  const finishCall = node(miniEvents, 'callFunction', { graphId: finisher.id }), afterFinish = mark(miniEvents, 'after_finish', 1);
  const click = miniEvents.nodes.find(n => n.type === 'eventClick')!; chain(miniEvents, click, finishCall, afterFinish);
  p.minigames.push({ id: 'legacy_mini', name: '合法小游戏能力', mode: 'blueprint', blueprintId: initial.id, uiPageId: mini.id });
  const gameNode = newNode('minigame', p.scenes[0].id); assert.equal(gameNode.kind, 'minigame');
  const passage = p.nodes.find(n => n.kind === 'passage')!; assert.equal(passage.kind, 'passage');
  passage.lines[0].text = '小游戏验证完成。';
  Object.assign(gameNode, { id: 'legacy_game_node', minigameId: 'legacy_mini', success: passage.id, failure: passage.id, cancel: passage.id });
  const start = p.nodes.find(n => n.id === p.entryId)!; assert.equal(start.kind, 'start'); start.next = gameNode.id; p.nodes.push(gameNode);

  const before = structuredClone(p), diagnostics = compileProject(p).diagnostics;
  assert.deepEqual(p, before, 'Capability analysis and compilation must not modify the author project.');
  assert.deepEqual(diagnostics.filter(d => d.severity === 'error'), []);
  assert.deepEqual(blueprintCapabilitySummary(p, conditional, { enabled: false }).required, []);
  assert.ok(blueprintCapabilitySummary(p, conditional, { enabled: true }).required.includes('dialogue'));
  const unsafe = structuredClone(p); unsafe.blueprints.find(g => g.id === events.id)!.nodes.find(n => n.id === call.id)!.properties.arg_enabled = true;
  const unsafeDiagnostics = compileProject(unsafe).diagnostics;
  assert.ok(unsafeDiagnostics.some(d => d.code === 'blueprint.path.capability' && d.nodeId === bad.id && d.severity === 'error'));
  const wrongEnvironment = structuredClone(p); addGameFlowStep(wrongEnvironment, 'beforeTitle', { kind: 'page', pageId: mini.id });
  // In ordinary UI the first close really cancels this page before its minigame operations.
  assert.equal(compileProject(wrongEnvironment).diagnostics.some(d => d.code === 'gameFlow.path.capability'), false);
  const wrongMini = wrongEnvironment.blueprints.find(g => g.id === miniEvents.id)!;
  assert.equal(connectBlueprintPins(wrongMini, wrongMini.nodes[0].id, 'exec', stillAlive.id, 'exec_in'), undefined);
  assert.ok(compileProject(wrongEnvironment).diagnostics.some(d => d.code === 'gameFlow.path.capability' && /小游戏会话/.test(d.message)));
  await fs.writeFile(path.join(output, 'diagnostics.json'), JSON.stringify({ valid: diagnostics, unsafe: unsafeDiagnostics }, null, 2));
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(p, null, 2));
  const built = await buildProject({ project: p, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + '\n' + JSON.stringify(built.diagnostics) });
  const q = JSON.stringify;
  const testcase = [
    'testsuite global:',
    '    before testcase:',
    '        $ _test.timeout = 12.0',
    '        $ _test.transition_timeout = 0.5',
    '        $ _test.screenshot_directory = "tests/screenshots"',
    '        $ preferences.text_cps = 0',
    '    after testcase:',
    '        screenshot "last-state.png"',
    '    teardown:',
    '        exit',
    '',
    'testcase capability_paths_and_legacy_minigame:',
    '    pause until eval (vn_var_phase == "safe_ready")',
    '    assert eval (vn_var_safe_runs == 1)',
    '    assert eval (not vn_minigame_context and vn_minigame_finished is None)',
    '    assert eval (' + q(startup.id) + ' in vn_ui_open_pages)',
    '    assert eval (not renpy.get_screen("main_menu"))',
    '    screenshot "safe-unreachable-capabilities.png"',
    '    click id ' + q('vn_component_' + startup.components[1].id),
    '    pause until screen "main_menu"',
    '    assert eval (not vn_ui_open_pages and not vn_ui_page_sessions)',
    '    assert eval (vn_var_safe_runs == 1)',
    '    click id "vn_main_start"',
    '    pause until eval (vn_var_phase == "mini_ready")',
    '    assert eval (vn_minigame_context.get("minigameId") == "legacy_mini")',
    '    assert eval (vn_var_after_close == 1)',
    '    assert eval (vn_var_mini_shows == 1)',
    '    assert eval (vn_var_final_value == 41 and vn_minigame_get("score") == 41)',
    '    assert eval (vn_minigame_finished is None)',
    '    assert eval (not vn_ui_open_pages and not vn_ui_page_sessions)',
    '    assert eval (vn_var_after_finish == 0)',
    '    assert eval (vn_minigame_context.get("didShow") is True)',
    '    $ vn_minigame_set("score", 73)',
    '    run FileSave("legacy_active", confirm=False, slot=True)',
    '    $ vn_minigame_set("score", 99)',
    '    run FileLoad("legacy_active", confirm=False, slot=True)',
    '    pause until eval (vn_var_phase == "mini_ready" and vn_minigame_get("score") == 73)',
    '    assert eval (vn_var_mini_shows == 1 and vn_var_final_value == 41)',
    '    assert eval (vn_minigame_context.get("didShow") is True)',
    '    screenshot "legacy-minigame-context.png"',
    '    click id ' + q('vn_component_' + mini.components[1].id),
    '    pause until "小游戏验证完成。"',
    '    assert eval (vn_minigame_result == "success")',
    '    assert eval (not vn_minigame_context and vn_minigame_finished is None)',
    '    assert eval (vn_var_after_close == 1 and vn_var_final_value == 41)',
    '    assert eval (vn_var_after_finish == 0)',
    '    assert eval (not vn_ui_open_pages and not vn_ui_page_sessions)',
    '    assert eval (not renpy.get_screen("vn_minigame_custom"))',
    '    assert eval (vn_bp_wait is None)',
    '    run MainMenu(confirm=False)',
    '    pause until screen "main_menu"',
    '    click id "vn_main_start"',
    '    pause until eval (vn_var_phase == "mini_ready")',
    '    assert eval (vn_var_mini_shows == 1 and vn_var_after_finish == 0)',
    '    assert eval (vn_minigame_get("score") == 41)',
    '    keysym "K_ESCAPE"',
    '    pause until "小游戏验证完成。"',
    '    assert eval (vn_minigame_result == "cancel")',
    '    assert eval (not vn_minigame_context and vn_minigame_finished is None)',
    '    assert eval (vn_var_after_finish == 0)',
    '    assert eval (not vn_ui_open_pages and not vn_ui_page_sessions)',
    '    screenshot "legacy-minigame-cancel-cleanup.png"',
    '',
  ].join('\n');
  await fs.writeFile(path.join(game, 'game', 'testcases.rpy'), testcase);
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 120000 };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  const result = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  await check('native-capabilities', result);
  assert.match(result.log, /Test cases\s*:\s*1\s*\|\s*1 passed/);
  report.assertions = Number(result.log.match(/Assertions\s*:\s*(\d+)/)?.[1]);
  assert.equal(report.assertions, 29, 'The complete native assertion set must execute.');
  report.status = 'passed'; await saveReport(); console.log('PASS: ' + path.join(output, 'report.json'));
} catch (error) { report.status = 'failed'; report.error = String(error); await saveReport(); console.error(error); process.exitCode = 1; }
