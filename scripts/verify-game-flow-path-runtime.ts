import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, type BlueprintGraph, type BlueprintNode, type CustomUiPage } from '../src/core/model';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { addGameFlowStep, createCustomUiPage, gameFlowDiagnostics } from '../src/core/game-flow';
import { buildProject, runRenpy } from '../src/runtime/service';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';

// A development-only player in isolated project/save directories. No packaging.
const sdk = process.env.VNS_RENPY_SDK ?? path.resolve('resources/runtime');
const output = path.resolve('artifacts/game-flow-path-runtime', new Date().toISOString().replaceAll(':', '-'));
const source = path.join(output, 'source'), game = path.join(output, 'game');
await fs.mkdir(output, { recursive: true }); await isolateRenpySaves(output);
const report: { status: string; checks: { name: string; code: number; logPath: string }[]; assertions?: number; error?: string } = { status: 'running', checks: [] };
await fs.mkdir(source, { recursive: true });
const saveReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  const logPath = path.join(output, name + '.log'); await fs.writeFile(logPath, result.log);
  report.checks.push({ name, code: result.code, logPath }); await saveReport();
  if (result.code) throw new Error(name + ': ' + result.log.slice(-6000));
}

try {
  const p = createProject('启动路径与页面诊断运行验收'); p.id = 'flow_path_runtime';
  for (const id of ['phase', 'repeat_reason', 'sequence_reason_1', 'sequence_reason_2', 'nested_reentry', 'parent_reason', 'child_reason', 'cancel_reason', 'dynamic_reason'])
    p.variables.push({ id, name: id, type: 'string', initial: '', persistent: false });
  for (const id of ['clock_ticks', 'covered_shows', 'cover_shows', 'covered_ticks', 'never_shows', 'repeat_shows', 'sequence_shows', 'parent_shows', 'child_shows', 'parent_after', 'child_after', 'external_after', 'default_shows', 'actual_shows', 'auto_shows', 'confirm_shows'])
    p.variables.push({ id, name: id, type: 'number', initial: 0, persistent: false });
  p.variables.push({ id: 'dynamic_target', name: '动态页面条件', type: 'boolean', initial: true, persistent: false });
  const graph = (name: string) => { const g = createBlueprintGraph('function', name); p.blueprints.push(g); return g; };
  const eventGraph = (page: CustomUiPage) => p.blueprints.find(g => g.uiPageId === page.id)!;
  const node = (g: BlueprintGraph, type: BlueprintNode['type'], properties: BlueprintNode['properties'] = {}) => {
    const n = blueprintNodeDefaults(type); Object.assign(n.properties, properties); g.nodes.push(n); return n;
  };
  const wire = (g: BlueprintGraph, from: BlueprintNode, to: BlueprintNode, output = 'exec_out', input = 'exec_in') => {
    synchronizeBlueprintSignatures(p);
    assert.equal(connectBlueprintPins(g, from.id, from.type.startsWith('event') && output === 'exec_out' ? 'exec' : output, to.id, input), undefined);
  };
  const chain = (g: BlueprintGraph, ...nodes: BlueprintNode[]) => nodes.slice(1).forEach((n, i) => wire(g, nodes[i], n));
  const increment = (g: BlueprintGraph, after: BlueprintNode, variableId: string) => {
    const read = node(g, 'getVariable', { variableId }), add = node(g, 'math', { b: 1 }), write = node(g, 'setVariable', { variableId });
    wire(g, read, add, 'value', 'a'); wire(g, add, write, 'result', 'value'); wire(g, after, write); return write;
  };
  const mark = (g: BlueprintGraph, after: BlueprintNode, value: string) => {
    const n = node(g, 'setVariable', { variableId: 'phase', value }); wire(g, after, n); return n;
  };
  const open = (g: BlueprintGraph, after: BlueprintNode, page: CustomUiPage, wait = true) => {
    const n = node(g, 'showUiPage', { pageId: page.id, wait }); wire(g, after, n); return n;
  };
  const capture = (g: BlueprintGraph, opened: BlueprintNode, variableId: string) => {
    const n = node(g, 'setVariable', { variableId }); wire(g, opened, n); wire(g, opened, n, 'reason', 'value'); return n;
  };
  const showCounter = (page: CustomUiPage, id: string) => { const g = eventGraph(page); return increment(g, g.nodes[0], id); };
  const addFlow = (g: BlueprintGraph) => addGameFlowStep(p, 'beforeTitle', { kind: 'blueprint', graphId: g.id });

  const timed = createCustomUiPage(p, '等待期间仍执行定时器'), timedEvents = eventGraph(timed);
  increment(timedEvents, node(timedEvents, 'eventTimer', { pageId: timed.id, interval: .02 }), 'clock_ticks');
  const timedFlow = graph('叠加页等待后同步关闭'), timedOpen = open(timedFlow, timedFlow.nodes[0], timed, false), timedDelay = node(timedFlow, 'delay', { seconds: .12 });
  const timedClose = node(timedFlow, 'closeUiPage', { pageId: timed.id }); chain(timedFlow, timedOpen, timedDelay, timedClose); addFlow(timedFlow);
  const covered = createCustomUiPage(p, '暂未获得显示事件的底页'), cover = createCustomUiPage(p, '盖住底页的模态页面');
  const coveredEvents = eventGraph(covered); showCounter(covered, 'covered_shows'); showCounter(cover, 'cover_shows');
  increment(coveredEvents, node(coveredEvents, 'eventTimer', { pageId: covered.id, interval: .02 }), 'covered_ticks');
  const coveredFlow = graph('显示定时器受遮挡而页面定时器继续'), coveredOpen = open(coveredFlow, coveredFlow.nodes[0], covered, false), coverOpen = open(coveredFlow, coveredOpen, cover, false);
  const coveredDelay = node(coveredFlow, 'delay', { seconds: .12 }), coveredClose = node(coveredFlow, 'closeUiPage', { pageId: covered.id });
  chain(coveredFlow, coverOpen, coveredDelay, coveredClose); addFlow(coveredFlow);

  const never = createCustomUiPage(p, '同步关闭而不显示'), repeated = createCustomUiPage(p, '重复打开只保留一份'), gate = createCustomUiPage(p, '同步路径检查点');
  showCounter(never, 'never_shows'); showCounter(repeated, 'repeat_shows');
  const instant = graph('同步开关与立即重入');
  const neverOpen = open(instant, instant.nodes[0], never, false), neverClose = node(instant, 'closeUiPage', { pageId: never.id }); wire(instant, neverOpen, neverClose);
  const repeatedOpen = open(instant, neverClose, repeated, false), reentry = open(instant, repeatedOpen, repeated);
  const reentryReason = capture(instant, reentry, 'repeat_reason'), checkpoint = mark(instant, reentryReason, 'checkpoint');
  const gateOpen = open(instant, checkpoint, gate), repeatedClose = node(instant, 'closeUiPage', { pageId: repeated.id }); wire(instant, gateOpen, repeatedClose); addFlow(instant);

  const sequential = createCustomUiPage(p, '等待关闭后重新打开'); showCounter(sequential, 'sequence_shows');
  const sequence = graph('顺序等待两次');
  const firstOpen = open(sequence, mark(sequence, sequence.nodes[0], 'sequence_1'), sequential), firstReason = capture(sequence, firstOpen, 'sequence_reason_1');
  const secondOpen = open(sequence, mark(sequence, firstReason, 'sequence_2'), sequential); capture(sequence, secondOpen, 'sequence_reason_2'); addFlow(sequence);

  const parent = createCustomUiPage(p, '父页等待子页'), child = createCustomUiPage(p, '子页关闭父页');
  const parentShown = showCounter(parent, 'parent_shows'), parentEvents = eventGraph(parent), childCall = open(parentEvents, parentShown, child);
  increment(parentEvents, childCall, 'parent_after');
  const childEvents = eventGraph(child), childShown = showCounter(child, 'child_shows'), parentAgain = open(childEvents, childShown, parent);
  capture(childEvents, parentAgain, 'nested_reentry');
  const closeParent = graph('关闭父页并取消当前按钮任务'), close = node(closeParent, 'closeUiPage', { pageId: parent.id }); wire(closeParent, closeParent.nodes[0], close);
  increment(closeParent, close, 'child_after');
  child.components[1].clickMode = 'replace'; child.components[1].action = 'start'; child.components[1].events = { beforeClick: closeParent.id };
  const nested = graph('外部等待父页'), parentOpen = open(nested, mark(nested, nested.nodes[0], 'nested'), parent); capture(nested, parentOpen, 'parent_reason'); addFlow(nested);

  const independentParent = createCustomUiPage(p, '外部叠加父页'), independentChild = createCustomUiPage(p, '外部等待子页');
  const independentEvents = eventGraph(independentChild), independentClose = independentEvents.nodes.find(n => n.type === 'closeUiPage')!;
  independentClose.properties.pageId = independentParent.id;
  const external = graph('关闭栈父页返回 parentClosed'), externalParent = open(external, mark(external, external.nodes[0], 'external'), independentParent, false);
  const externalChild = open(external, externalParent, independentChild), externalReason = capture(external, externalChild, 'child_reason');
  increment(external, externalReason, 'external_after'); addFlow(external);

  const cancelOnly = createCustomUiPage(p, '只有取消而没有完成出口'); eventGraph(cancelOnly).links = [];
  const cancelling = graph('取消不是完成'), cancelOpen = open(cancelling, mark(cancelling, cancelling.nodes[0], 'cancel'), cancelOnly);
  capture(cancelling, cancelOpen, 'cancel_reason'); addFlow(cancelling);

  const defaultPage = createCustomUiPage(p, '模块默认页面不会偷换参数'), actualPage = createCustomUiPage(p, '实际动态参数页面');
  showCounter(defaultPage, 'default_shows'); showCounter(actualPage, 'actual_shows');
  const module = graph('按传入的页面打开'); module.exposedInputs.push(blueprintPin('page', '目标页面', 'input', 'ui', defaultPage.id));
  module.exposedOutputs.push(blueprintPin('reason', '关闭原因', 'output', 'string', ''));
  const input = node(module, 'getInput', { inputId: 'page' }), moduleOpen = node(module, 'showUiPage', { interfacePageId: defaultPage.id }), moduleResult = node(module, 'setOutput', { outputId: 'reason' });
  chain(module, module.nodes[0], moduleOpen, moduleResult); wire(module, input, moduleOpen, 'value', 'pageId'); wire(module, moduleOpen, moduleResult, 'reason', 'value');
  const dynamic = graph('动态参数按实际值执行'), selector = node(dynamic, 'select', { true_value: actualPage.id, false_value: defaultPage.id });
  const flag = node(dynamic, 'getVariable', { variableId: 'dynamic_target' }), call = node(dynamic, 'callFunction', { graphId: module.id });
  const dynamicResult = node(dynamic, 'setVariable', { variableId: 'dynamic_reason' });
  chain(dynamic, mark(dynamic, dynamic.nodes[0], 'dynamic'), call, dynamicResult);
  wire(dynamic, flag, selector, 'value', 'condition'); wire(dynamic, selector, call, 'result', 'arg_page'); wire(dynamic, call, dynamicResult, 'out_reason', 'value'); addFlow(dynamic);

  const automatic = createCustomUiPage(p, '自动完成'), confirmation = createCustomUiPage(p, '确认完成');
  for (const page of [automatic, confirmation]) { eventGraph(page).links = []; showCounter(page, page === automatic ? 'auto_shows' : 'confirm_shows'); }
  addGameFlowStep(p, 'beforeTitle', { kind: 'page', pageId: automatic.id, completion: 'auto', duration: .08 });
  addGameFlowStep(p, 'beforeTitle', { kind: 'page', pageId: confirmation.id, completion: 'confirm' });
  const finish = graph('完成验证后进入标题'); mark(finish, finish.nodes[0], 'finished'); addFlow(finish);

  const before = structuredClone(p), diagnostics = gameFlowDiagnostics(p);
  assert.deepEqual(p, before, 'Analysis must not mutate the project.');
  assert.equal(diagnostics.some(d => d.severity === 'error'), false, JSON.stringify(diagnostics));
  assert.ok(diagnostics.some(d => d.code === 'gameFlow.path.pageReentry' && d.nodeId === reentry.id));
  assert.ok(diagnostics.some(d => d.code === 'gameFlow.path.pageReentry' && d.nodeId === parentAgain.id));
  assert.ok(diagnostics.some(d => d.code === 'gameFlow.path.noCompletion' && d.nodeId === cancelOpen.id));
  assert.ok(diagnostics.some(d => d.code === 'gameFlow.path.dynamicPage' && d.nodeId === moduleOpen.id));
  assert.equal(diagnostics.some(d => d.code === 'gameFlow.path.pageReentry' && [firstOpen.id, secondOpen.id].includes(d.nodeId ?? '')), false);
  await fs.writeFile(path.join(output, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2));
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(p, null, 2));
  const built = await buildProject({ project: p, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + '\n' + JSON.stringify(built.diagnostics) });
  const q = JSON.stringify;
  await fs.writeFile(path.join(game, 'game', 'testcases.rpy'), `testsuite global:
    before testcase:
        $ _test.timeout = 12.0
        $ _test.transition_timeout = 0.5
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
    after testcase:
        screenshot "last-state.png"
    teardown:
        exit

testcase path_diagnostics_match_player:
    pause until eval (vn_var_phase == "checkpoint" and vn_ui_page_sessions.get(${q(gate.id)}, {}).get("didShow", False))
    assert eval (vn_var_clock_ticks > 0)
    assert eval (vn_var_covered_shows == 0 and vn_var_cover_shows == 1)
    assert eval (vn_var_covered_ticks > 0)
    assert eval (vn_var_never_shows == 0)
    assert eval (${q(never.id)} not in vn_ui_open_pages)
    assert eval (vn_var_repeat_reason == "alreadyOpen")
    pause 0.05
    assert eval (vn_var_repeat_shows == 0)
    assert eval (len(vn_ui_open_pages) == 2)
    assert eval (vn_ui_page_order == [${q(repeated.id)}, ${q(gate.id)}])
    assert eval (vn_ui_page_sessions[${q(gate.id)}]["parent"] == ${q(repeated.id)})
    assert eval (not renpy.get_screen("main_menu"))
    screenshot "duplicate-open-preserves-instance.png"
    click id ${q('vn_component_' + gate.components[1].id)}
    pause until eval (vn_var_phase == "sequence_1" and vn_var_sequence_shows == 1)
    assert eval (not ${q(repeated.id)} in vn_ui_open_pages)
    assert eval (vn_var_repeat_shows == 1)
    assert eval (vn_var_sequence_reason_1 == "")
    $ first_sequence_token = vn_ui_page_token(${q(sequential.id)})
    click id ${q('vn_component_' + sequential.components[1].id)}
    pause until eval (vn_var_phase == "sequence_2" and vn_var_sequence_shows == 2)
    assert eval (vn_var_sequence_reason_1 == "completed")
    assert eval (vn_var_sequence_reason_2 == "")
    assert eval (vn_ui_page_token(${q(sequential.id)}) != first_sequence_token)
    assert eval (len(vn_ui_open_pages) == 1)
    click id ${q('vn_component_' + sequential.components[1].id)}
    pause until eval (vn_var_phase == "nested" and vn_var_nested_reentry == "alreadyOpen")
    assert eval (vn_var_sequence_reason_2 == "completed")
    assert eval (vn_var_parent_shows == 1 and vn_var_child_shows == 1)
    assert eval (vn_ui_page_order == [${q(parent.id)}, ${q(child.id)}])
    assert eval (not vn_ui_page_interactive(${q(parent.id)}))
    assert eval (vn_ui_page_interactive(${q(child.id)}))
    assert eval (vn_var_parent_after == 0 and vn_var_child_after == 0)
    screenshot "nested-reentry-before-parent-close.png"
    click id ${q('vn_component_' + child.components[1].id)}
    pause until eval (vn_var_phase == "external" and vn_ui_page_sessions.get(${q(independentChild.id)}, {}).get("didShow", False))
    assert eval (vn_var_parent_reason == "completed")
    assert eval (vn_var_parent_after == 0 and vn_var_child_after == 0)
    assert eval (${q(parent.id)} not in vn_ui_open_pages and ${q(child.id)} not in vn_ui_open_pages)
    assert eval (not renpy.get_screen("main_menu"))
    assert eval (vn_ui_page_sessions[${q(independentChild.id)}]["parent"] == ${q(independentParent.id)})
    click id ${q('vn_component_' + independentChild.components[1].id)}
    pause until eval (vn_var_phase == "cancel" and vn_ui_page_sessions.get(${q(cancelOnly.id)}, {}).get("didShow", False))
    assert eval (vn_var_child_reason == "parentClosed")
    assert eval (vn_var_external_after == 1)
    assert eval (${q(independentParent.id)} not in vn_ui_open_pages and ${q(independentChild.id)} not in vn_ui_open_pages)
    assert eval (vn_var_cancel_reason == "")
    screenshot "no-completion-still-cancellable.png"
    keysym "K_ESCAPE"
    pause until eval (vn_var_phase == "dynamic" and vn_var_actual_shows == 1)
    assert eval (vn_var_cancel_reason == "cancelled")
    assert eval (${q(cancelOnly.id)} not in vn_ui_open_pages)
    assert eval (vn_var_default_shows == 0)
    assert eval (${q(defaultPage.id)} not in vn_ui_open_pages)
    assert eval (${q(actualPage.id)} in vn_ui_open_pages)
    click id ${q('vn_component_' + actualPage.components[1].id)}
    pause until eval (vn_var_confirm_shows == 1)
    assert eval (vn_var_dynamic_reason == "completed")
    assert eval (vn_var_auto_shows == 1)
    assert eval (${q(automatic.id)} not in vn_ui_open_pages)
    assert eval (vn_ui_page_sessions[${q(confirmation.id)}]["confirm"])
    assert eval (vn_ui_last_page_reason == "completed")
    screenshot "confirm-completion.png"
    keysym "K_RETURN"
    pause until screen "main_menu"
    assert eval (vn_var_phase == "finished")
    assert eval (vn_var_confirm_shows == 1)
    assert eval (vn_var_repeat_shows == 1 and vn_var_sequence_shows == 2)
    assert eval (vn_var_parent_after == 0 and vn_var_child_after == 0)
    assert eval (not vn_ui_open_pages and not vn_ui_page_sessions)
    assert eval (not vn_ui_page_order and not vn_ui_page_completions)
    assert eval (not vn_ui_pages_modal())
    assert eval (vn_flow_active_step is None)
`);
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 120000 };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  const result = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  await check('native-paths', result);
  if (!/Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log)) throw new Error('Native test did not report a passed testcase');
  report.assertions = Number(result.log.match(/Assertions\s*:\s*(\d+)/)?.[1]);
  assert.equal(report.assertions, 51, 'The complete native assertion set must execute.');
  report.status = 'passed'; await saveReport(); console.log('PASS: ' + path.join(output, 'report.json'));
} catch (error) { report.status = 'failed'; report.error = String(error); await saveReport(); console.error(error); process.exitCode = 1; }
finally {
  try {
    for (const name of ['project.vns.json', 'testcases.rpy']) {
      const file = name === 'project.vns.json' ? path.join(source, name) : path.join(game, 'game', name);
      if (await fs.stat(file).then(stat => stat.isFile()).catch(() => false)) await fs.copyFile(file, path.join(output, name));
    }
    for (const folder of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) if (await fs.stat(folder).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(folder, path.join(output, 'screenshots'), { recursive: true });
    const cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves', 'renpy-saves']); assert.deepEqual(cleanup.errors, []);
  } catch (error) { report.status = 'failed'; report.error = [report.error, String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  await saveReport();
}
