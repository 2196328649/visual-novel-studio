import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, type BlueprintGraph, type BlueprintNode } from '../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createCustomUiPage } from '../src/core/game-flow';
import { addGameFlowStep, connectGameFlowNodes, flowNodeIds, flowStepNodeId } from '../src/core/game-flow-graph';
import { buildProject, runRenpy } from '../src/runtime/service';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';

const root = path.resolve('.'), sdk = process.env.VNS_RENPY_SDK ?? path.resolve('resources/runtime');
const output = path.join(root, 'artifacts/game-flow-runtime', new Date().toISOString().replaceAll(':', '-'));
const source = path.join(output, 'source'), game = path.join(output, 'game');
const report: { status: string; checks: { name: string; code: number; logPath: string }[]; error?: string } = { status: 'running', checks: [] };
await fs.mkdir(source, { recursive: true });
const saveReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  const logPath = path.join(output, name + '.log'); await fs.writeFile(logPath, result.log);
  report.checks.push({ name, code: result.code, logPath }); await saveReport();
  if (result.code) throw new Error(name + ': ' + result.log.slice(-6000));
}
try {
  await isolateRenpySaves(output);
  const p = createProject('统一流程蓝图运行验收'); p.id = 'flow_runtime_verification';
  p.ui.disabledPages = ['gallery'];
  p.variables.push(
    { id: 'launch_order', name: '启动顺序', type: 'string', initial: '', persistent: true },
    { id: 'launch_count', name: '启动次数', type: 'number', initial: 0, persistent: true },
    { id: 'new_count', name: '新游戏次数', type: 'number', initial: 0, persistent: true },
    { id: 'choice', name: '开局选择', type: 'string', initial: 'default', persistent: false },
    { id: 'local_number', name: '本局数值', type: 'number', initial: 7, persistent: false },
    { id: 'local_flag', name: '本局开关', type: 'boolean', initial: true, persistent: false },
    { id: 'player_setting', name: '玩家设置', type: 'string', initial: 'default-setting', persistent: true },
  );
  const append = (graph: BlueprintGraph, previous: BlueprintNode, type: BlueprintNode['type'], properties: BlueprintNode['properties']) => {
    const node = blueprintNodeDefaults(type); node.properties = properties; graph.nodes.push(node); synchronizeBlueprintSignatures(p);
    const error = connectBlueprintPins(graph, previous.id, previous.type === 'event' ? 'exec' : 'exec_out', node.id, 'exec_in'); if (error) throw new Error(error);
    return node;
  };
  const increment = (graph: BlueprintGraph, previous: BlueprintNode, variableId: string) => {
    const write = append(graph, previous, 'setVariable', { variableId, value: 0 });
    const read = blueprintNodeDefaults('getVariable'), math = blueprintNodeDefaults('math');
    read.properties.variableId = variableId; math.properties = { operation: 'add', b: 1 };
    graph.nodes.push(read, math); synchronizeBlueprintSignatures(p);
    connectBlueprintPins(graph, read.id, 'value', math.id, 'a'); connectBlueprintPins(graph, math.id, 'result', write.id, 'value');
    return write;
  };
  const a = createBlueprintGraph('function', '启动 A'), b = createBlueprintGraph('function', '启动 B'), prepare = createBlueprintGraph('function', '初始化选择');
  p.blueprints.push(a, b, prepare);
  increment(a, append(a, a.nodes[0], 'setVariable', { variableId: 'launch_order', value: 'A' }), 'launch_count');
  append(b, b.nodes[0], 'setVariable', { variableId: 'launch_order', value: 'B' });
  append(prepare, increment(prepare, prepare.nodes[0], 'new_count'), 'setVariable', { variableId: 'choice', value: 'chosen' });
  const titleEdit = createBlueprintGraph('function', '标题回调修改状态'); p.blueprints.push(titleEdit);
  let previous = titleEdit.nodes[0];
  for (const [variableId, value] of Object.entries({ choice: 'title-dirty', local_number: 99, local_flag: false, player_setting: 'retained-setting' })) {
    previous = append(titleEdit, previous, 'setVariable', { variableId, value });
  }
  p.ui.components.push({ id: 'edit_title_state', kind: 'button', page: 'main', text: '修改标题状态', action: 'blueprint', blueprintId: titleEdit.id, x: .6, y: .15, width: .3, height: .1 });
  const splash = createCustomUiPage(p, '启动页面'), setup = createCustomUiPage(p, '开局页面');
  const sa = addGameFlowStep(p, 'beforeTitle', { kind: 'blueprint', graphId: a.id });
  const sb = addGameFlowStep(p, 'beforeTitle', { kind: 'blueprint', graphId: b.id });
  const ss = addGameFlowStep(p, 'beforeTitle', { kind: 'page', pageId: splash.id, allowSkip: true });
  // Inventory is A, B, page; authored wires are B -> A -> page.
  connectGameFlowNodes(p, flowStepNodeId(sa.id), flowStepNodeId(ss.id));
  connectGameFlowNodes(p, flowStepNodeId(sb.id), flowStepNodeId(sa.id));
  connectGameFlowNodes(p, flowNodeIds.launch, flowStepNodeId(sb.id));
  addGameFlowStep(p, 'beforeNewGame', { kind: 'page', pageId: setup.id });
  addGameFlowStep(p, 'beforeNewGame', { kind: 'blueprint', graphId: prepare.id });
  const passage = p.nodes.find(n => n.kind === 'passage')!;
  passage.lines[0].text = '统一蓝图已进入剧情。';
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(p, null, 2));
  const built = await buildProject({ project: p, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + '\n' + JSON.stringify(built.diagnostics) });
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

testcase unified_flow_lifecycle:
    pause until eval (${JSON.stringify(splash.id)} in vn_ui_open_pages)
    assert eval (persistent.vn_var_launch_order == "A")
    assert eval (persistent.vn_var_launch_count == 1)
    assert eval (not renpy.get_screen("main_menu"))
    screenshot "cold-start-page.png"
    click "跳过"
    pause until screen "main_menu"
    assert eval (not vn_ui_open_pages)
    assert eval (not vn_ui_page_sessions)
    assert eval (vn_flow_active_step is None)
    pause 0.3
    screenshot "title-after-startup.png"
    assert eval (not vn_ui_pages_modal())
    assert eval (not renpy.get_screen("vn_blueprint_pages").modal)
    click id "vn_component_edit_title_state"
    assert eval (vn_var_choice == "title-dirty")
    assert eval (vn_var_local_number == 99 and vn_var_local_flag is False)
    assert eval (persistent.vn_var_player_setting == "retained-setting")
    click id "vn_main_start"
    pause until eval (${JSON.stringify(setup.id)} in vn_ui_open_pages)
    assert eval (vn_var_choice == "default")
    assert eval (vn_var_local_number == 7 and vn_var_local_flag is True)
    assert eval (persistent.vn_var_player_setting == "retained-setting")
    assert eval (persistent.vn_var_new_count == 0)
    click id ${JSON.stringify('vn_component_' + setup.components[1].id)}
    pause until "统一蓝图已进入剧情。"
    assert eval (vn_var_choice == "chosen")
    assert eval (persistent.vn_var_new_count == 1)
    assert eval (not vn_ui_open_pages)
    $ vn_var_choice = "saved"
    $ vn_var_local_number = 77
    $ vn_var_local_flag = False
    run FileSave("flow_save", confirm=False, slot=True)
    run MainMenu(confirm=False)
    pause until screen "main_menu"
    assert eval (persistent.vn_var_launch_count == 1)
    assert eval (not vn_ui_open_pages)
    run FileLoad("flow_save", confirm=False, slot=True)
    pause until "统一蓝图已进入剧情。"
    assert eval (vn_var_choice == "saved")
    assert eval (vn_var_local_number == 77 and vn_var_local_flag is False)
    assert eval (persistent.vn_var_player_setting == "retained-setting")
    assert eval (persistent.vn_var_new_count == 1)
    run MainMenu(confirm=False)
    pause until screen "main_menu"
    click id "vn_component_edit_title_state"
    click id "vn_main_start"
    pause until eval (${JSON.stringify(setup.id)} in vn_ui_open_pages)
    assert eval (vn_var_choice == "default")
    assert eval (vn_var_local_number == 7 and vn_var_local_flag is True)
    assert eval (persistent.vn_var_player_setting == "retained-setting")
    click id ${JSON.stringify('vn_component_' + setup.components[1].id)}
    pause until "统一蓝图已进入剧情。"
    assert eval (persistent.vn_var_new_count == 2)
    assert eval (vn_var_choice == "chosen")
    screenshot "story-after-new-game.png"
`);
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 120000 };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  const result = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  await check('native-lifecycle', result);
  if (!/Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log)) throw new Error('Native test did not report a passed testcase');
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
