import { cleanVerificationDirectories } from './lib/verification-cleanup';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createBlueprintFlowControlFixture } from './lib/blueprint-flow-control-fixture';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';

const sdk = process.env.VNS_RENPY_SDK ?? 'E:/Tools/renpy-8.5.3-sdk';
const output = path.resolve('artifacts/blueprint-flow-control-runtime', new Date().toISOString().replaceAll(':', '-'));
const source = path.join(output, 'source'), game = path.join(output, 'game');
const report: { status: string; checks: { name: string; code: number; logPath: string }[]; cases?: number; assertions?: number; error?: string; cleanup?: unknown } = { status: 'running', checks: [] };
await fs.mkdir(source, { recursive: true });
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  const logPath = path.join(output, name + '.log'); await fs.writeFile(logPath, result.log); report.checks.push({ name, code: result.code, logPath }); await save();
  if (result.code) throw new Error(name + ': ' + result.log.slice(-7000));
}
try {
  const f = createBlueprintFlowControlFixture(), { project, root, child } = f, before = structuredClone(project);
  assert.deepEqual(compileProject(project).diagnostics.filter(d => d.severity === 'error'), []); assert.deepEqual(project, before);
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(project, null, 2));
  const built = await buildProject({ project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  const q = JSON.stringify, click = (id: string) => '    click id ' + q('vn_component_' + id) + ' pos (0.5, 0.5)';
  const start = ['    pause until screen "main_menu"', '    click id "vn_main_start" pos (0.5, 0.5)', '    pause until "准备检查状态控制节点。"'];
  const open = ['    run Jump(' + q('vn_node_' + f.interactive.id) + ')', '    pause until eval (' + q(root.id) + ' in vn_ui_open_pages)'];
  const close = [click(root.components[1].id), '    pause until "状态控制页面已返回。"', '    assert eval (not vn_ui_open_pages and not vn_ui_page_sessions and not vn_ui_state_records)', '    assert eval (len(renpy.game.contexts) == 1 and vn_bp_frame is None and vn_bp_task is None and vn_bp_wait is None)'];
  const childOpen = [click('control_child'), '    pause until eval (' + q(child.id) + ' in vn_ui_open_pages)'];
  const childClose = [click(child.components[1].id), '    pause until eval (' + q(child.id) + ' not in vn_ui_open_pages)'];
  const test = [
    'testsuite global:', '    before testcase:', '        $ _test.timeout = 8.0', '        $ _test.screenshot_directory = "tests/screenshots"', '        $ preferences.text_cps = 0',
    '    after testcase:', '        if eval not main_menu:', '            run MainMenu(confirm=False)', '        pause until screen "main_menu"', '    teardown:', '        exit', '',
    'testcase control_page_once_and_gate:', ...start, ...open,
    click('control_once_a'), click('control_once_b'), '    assert eval (vn_var_once_hits == 1 and vn_var_once_blocked == 1)',
    '    assert eval (vn_ui_state_get(' + q(root.id) + ', "counter") == 7)',
    click('control_once_reset'), '    assert eval (vn_var_once_hits == 1 and vn_var_once_resets == 1)',
    click('control_once_a'), '    assert eval (vn_var_once_hits == 2)',
    click('control_gate_enter'), '    assert eval (vn_var_gate_blocked == 1 and vn_var_gate_hits == 0)',
    click('control_gate_open'), '    assert eval (vn_var_gate_updates == 1 and vn_var_gate_hits == 0)',
    click('control_gate_enter'), click('control_gate_close'), click('control_gate_enter'), click('control_gate_toggle'), click('control_gate_enter'), click('control_gate_reset'), click('control_gate_enter'),
    '    assert eval (vn_var_gate_hits == 2 and vn_var_gate_blocked == 3 and vn_var_gate_updates == 4)',
    '    screenshot "state-control-page.png"', ...close, '',
    'testcase control_nondefault_initial_state:', ...start, ...open, click('control_initials'),
    '    assert eval (vn_var_once_hits == 1 and vn_var_once_blocked == 1 and vn_var_once_resets == 1)',
    '    assert eval (vn_var_gate_hits == 2 and vn_var_gate_blocked == 1 and vn_var_gate_updates == 2)', ...close, '',
    'testcase control_local_calls:', ...start, ...open,
    click('control_local'), '    assert eval (vn_var_local_hits == 2 and vn_var_local_blocked == 2)',
    click('control_local'), '    assert eval (vn_var_local_hits == 4 and vn_var_local_blocked == 4)', ...close, '',
    'testcase control_shared_page_parameter:', ...start, ...open,
    click('control_shared_root'), click('control_shared_root'), '    assert eval (vn_var_shared_hits == 1 and vn_var_shared_blocked == 1)',
    ...childOpen, click('control_shared_child'), click('control_shared_child'), '    assert eval (vn_var_shared_hits == 2 and vn_var_shared_blocked == 2)',
    ...childClose, click('control_shared_root'), '    assert eval (vn_var_shared_hits == 2 and vn_var_shared_blocked == 3)',
    ...childOpen, click('control_shared_child'), '    assert eval (vn_var_shared_hits == 3 and vn_var_shared_blocked == 3)', ...childClose, ...close, '',
    'testcase control_reset_after_work:', ...start, ...open,
    click('control_rearm_a'), click('control_rearm_b'), '    assert eval (vn_var_rearm_hits == 1 and vn_var_rearm_blocked == 1 and vn_var_rearm_done == 0)',
    '    pause until eval (vn_var_rearm_done == 1)', click('control_rearm_b'), '    pause until eval (vn_var_rearm_done == 2)',
    '    assert eval (vn_var_rearm_hits == 2 and vn_var_rearm_blocked == 1 and vn_var_rearm_done == 2)', ...close, '',
    'testcase control_close_work_open:', ...start, ...open,
    click('control_busy_a'), click('control_busy_b'), '    assert eval (vn_var_busy_hits == 1 and vn_var_busy_blocked == 1 and vn_var_busy_done == 0)',
    '    pause until eval (vn_var_busy_done == 1)', click('control_busy_b'), '    pause until eval (vn_var_busy_done == 2)',
    '    assert eval (vn_var_busy_hits == 2 and vn_var_busy_blocked == 1 and vn_var_busy_done == 2)', ...close, '',
    'testcase control_atomic_while_waiting:', ...start, ...open,
    click('control_wait_a'), '    pause until eval (vn_var_wait_started == 1)', click('control_wait_b'),
    '    assert eval (vn_var_wait_started == 1 and vn_var_wait_blocked == 1 and vn_var_wait_done == 0)',
    '    pause until eval (vn_var_wait_done == 1)', '    assert eval (vn_var_wait_started == 1 and vn_var_wait_blocked == 1)', ...close, '',
    'testcase control_close_reopen_cancels_old_task:', ...start, ...open,
    click('control_once_a'), click('control_wait_a'), '    pause until eval (vn_var_wait_started == 1)', ...close,
    '    assert eval (vn_var_wait_done == 0)', ...open, click('control_once_a'), click('control_wait_b'),
    '    assert eval (vn_var_once_hits == 2 and vn_var_wait_started == 2)', '    pause until eval (vn_var_wait_done == 1)',
    '    assert eval (vn_var_wait_started == 2 and vn_var_wait_blocked == 0)', ...close, '',
    'testcase control_page_save_restore:', ...start, ...open,
    click('control_once_a'), click('control_gate_open'), '    $ renpy.test.testexecution.control_saved_records = vn_ui_state_records',
    '    run FileSave("control_page", confirm=False, slot=True)',
    click('control_once_reset'), click('control_gate_close'),
    '    assert eval (vn_ui_state_records != renpy.test.testexecution.control_saved_records)',
    '    run FileLoad("control_page", confirm=False, slot=True)', '    pause until eval (' + q(root.id) + ' in vn_ui_open_pages)',
    '    assert eval (vn_ui_state_records == renpy.test.testexecution.control_saved_records)',
    click('control_once_b'), click('control_gate_enter'),
    '    assert eval (vn_var_once_hits == 1 and vn_var_once_blocked == 1 and vn_var_once_resets == 0)',
    '    assert eval (vn_var_gate_hits == 1 and vn_var_gate_updates == 1)', ...close,
    // A waiting screen is itself the preceding rollback checkpoint. Restore
    // that live instance and its consumed/open controls, not a guessed dialogue.
    '    run Rollback()', '    pause until eval (' + q(root.id) + ' in vn_ui_open_pages)',
    '    assert eval (vn_ui_state_records == renpy.test.testexecution.control_saved_records)',
    '    assert eval (vn_var_once_hits == 1 and vn_var_once_blocked == 0 and vn_var_gate_hits == 0)',
    click('control_once_b'), click('control_gate_enter'),
    '    assert eval (vn_var_once_hits == 1 and vn_var_once_blocked == 1 and vn_var_gate_hits == 1)', ...close, '',
    ...([0, .2] as const).flatMap(elapsed => [
      'testcase control_call_save_' + (elapsed ? 'partial' : 'first_wait') + ':', ...start,
      '    run Jump(' + q('vn_node_' + f.saved.id) + ')', '    pause until eval (vn_var_saved_hits == 1)', '    pause ' + elapsed,
      '    assert eval (vn_bp_frame.get("controls", {}).get(' + q(f.savedOnce.id) + ') is True and vn_var_saved_blocked == 0)',
      '    $ renpy.test.testexecution.control_saved_frame = vn_bp_frame', '    run FileSave("control_call_wait", confirm=False, slot=True)',
      '    run FileLoad("control_call_wait", confirm=False, slot=True)',
      '    assert eval (vn_bp_frame == renpy.test.testexecution.control_saved_frame and vn_var_saved_hits == 1 and vn_var_saved_done == 0)',
      '    pause until "调用控制状态已完成。"', '    assert eval (vn_var_saved_hits == 1 and vn_var_saved_blocked == 1 and vn_var_saved_done == 1 and vn_bp_frame is None)',
      '    run Rollback()', '    pause until "准备检查状态控制节点。"',
      '    assert eval (vn_var_saved_hits == 0 and vn_var_saved_blocked == 0 and vn_var_saved_done == 0 and vn_bp_frame is None)', '',
    ]),
    'testcase control_native_template:', ...start, ...open,
    click('control_once_a'), click('control_native'), '    pause until screen "preferences"',
    '    assert eval (vn_ui_native_page_is_open("ui:preferences"))',
    click('control_native_once'), click('control_native_once'), '    assert eval (vn_var_once_hits == 2 and vn_var_once_blocked == 1)',
    click('control_native_close'), '    pause until eval (vn_var_native_done == 1)',
    click('control_once_b'), '    assert eval (vn_var_once_hits == 2 and vn_var_once_blocked == 2)',
    click('control_native'), '    pause until screen "preferences"', click('control_native_once'), '    assert eval (vn_var_once_hits == 3)',
    '    screenshot "state-control-native-template.png"', click('control_native_close'), '    pause until eval (vn_var_native_done == 2)', ...close, '',
    'testcase control_new_game_resets_state:', ...start, ...open, click('control_once_a'), click('control_gate_open'), ...close,
    '    run MainMenu(confirm=False)', ...start, ...open, click('control_once_a'), click('control_gate_enter'),
    '    assert eval (vn_var_once_hits == 1 and vn_var_once_blocked == 0 and vn_var_gate_hits == 0 and vn_var_gate_blocked == 1)', ...close, '',
    'testcase control_legacy_frame_shape:', ...start,
    '    $ renpy.test.testexecution.control_outer_frame = vn_bp_frame',
    '    $ vn_bp_frame = dict(graph=' + q(f.local.id) + ', values={})',
    '    $ renpy.test.testexecution.control_old_frame = vn_bp_frame',
    '    $ renpy.test.testexecution.control_step_result = vn_bp_control_step("call", None, ' + q(f.local.id) + ', ' + q(f.localOnce.id) + ', "doOnce", "exec_in", False)',
    '    assert eval (renpy.test.testexecution.control_step_result == "exec_out")',
    '    assert eval ("controls" not in renpy.test.testexecution.control_old_frame)',
    '    $ renpy.test.testexecution.control_step_result = vn_bp_control_step("call", None, ' + q(f.local.id) + ', ' + q(f.localOnce.id) + ', "doOnce", "exec_in", False)',
    '    assert eval (renpy.test.testexecution.control_step_result == "blocked")',
    '    $ vn_bp_frame = renpy.test.testexecution.control_outer_frame', '',
  ].join('\n');
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), test);
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 160000 };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  const native = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  await check('controls', native); report.cases = (test.match(/^testcase /gm) ?? []).length;
  assert.match(native.log, new RegExp('Test cases\\s*:\\s*' + report.cases + '\\s*\\|\\s*' + report.cases + ' passed'));
  report.assertions = Number(native.log.match(/Assertions\s*:\s*(\d+)/)?.[1]); assert.equal(report.assertions, (test.match(/^    assert /gm) ?? []).length);
  report.status = 'passed'; await save(); console.log('PASS: ' + path.join(output, 'report.json'));
} catch (error) { report.status = 'failed'; report.error = String(error); await save(); console.error(error); process.exitCode = 1; }
finally {
  try {
    for (const [from, to] of [[path.join(source, 'project.vns.json'), path.join(output, 'fixture.project.json')], [path.join(game, 'game/testcases.rpy'), path.join(output, 'testcases.rpy')]]) {
      if (await fs.stat(from).then(stat => stat.isFile()).catch(() => false)) await fs.copyFile(from, to);
    }
    for (const directory of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) {
      if (await fs.stat(directory).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(directory, path.join(output, 'screenshots'), { recursive: true });
    }
  } catch (error) { report.status = 'failed'; report.error = [report.error, 'Evidence preservation failed: ' + String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  try {
    report.cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves']);
    if ((report.cleanup as { errors: unknown[] }).errors.length) throw new Error('Verification cleanup failed.');
  } catch (error) { report.status = 'failed'; report.error = [report.error, String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  await save();
}
