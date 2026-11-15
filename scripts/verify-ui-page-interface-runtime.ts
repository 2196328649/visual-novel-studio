import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createUiPageInterfaceFixture, pageInterfacePng } from './lib/ui-page-interface-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';
import { compileProject } from '../src/runtime/compiler';
import { pythonLiteral } from '../src/runtime/literals';
import { buildProject, runRenpy } from '../src/runtime/service';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Only isolated development games may be used for this acceptance.');
const sdk = process.env.VNS_RENPY_SDK ?? 'E:/Tools/renpy-8.5.3-sdk';
const output = path.resolve('artifacts/ui-page-interface-runtime', new Date().toISOString().replaceAll(':', '-'));
const source = path.join(output, 'source'), game = path.join(output, 'game');
const report: { status: string; checks: { name: string; code: number; logPath: string }[]; cases?: number; assertions?: number; error?: string; cleanup?: unknown } = { status: 'running', checks: [] };
await fs.mkdir(path.join(source, 'assets'), { recursive: true });
await isolateRenpySaves(output);
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  const logPath = path.join(output, name + '.log'); await fs.writeFile(logPath, result.log); report.checks.push({ name, code: result.code, logPath }); await save();
  assert.equal(result.code, 0, name + ': ' + result.log.slice(-9000));
}
try {
  const f = createUiPageInterfaceFixture({ allMenus: true }), before = structuredClone(f.project);
  assert.deepEqual(compileProject(f.project).diagnostics.filter(issue => issue.severity === 'error'), []); assert.deepEqual(f.project, before);
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(f.project, null, 2));
  await fs.writeFile(path.join(source, 'assets/interface.png'), Buffer.from(pageInterfacePng, 'base64'));
  const built = await buildProject({ project: f.project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await check('development-compile', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  assert.equal((await fs.stat(path.join(game, 'game/assets/interface.png'))).isFile(), true, 'An asset referenced only by page interfaces must be exported.');
  const q = JSON.stringify, py = pythonLiteral;
  const click = (id: string) => '    click id ' + q('vn_component_' + id) + ' pos (0.5, 0.5)';
  const start = ['    pause until screen "main_menu"', '    click id "vn_main_start" pos (0.5, 0.5)', '    pause until "准备验收统一页面接口。"'];
  const parent = ['    run Jump(' + q('vn_node_' + f.interactive.id) + ')', '    pause until eval (' + q(f.parent.id) + ' in vn_ui_open_pages)'];
  const child = [click('pi_open_child'), '    pause until eval (vn_var_focus_count == 1)'];
  const base = ['    run Jump(' + q('vn_node_' + f.saved.id) + ')', '    pause until eval (' + q(f.child.id) + ' in vn_ui_open_pages and vn_var_focus_count == 1)'];
  const typed = '    assert eval (vn_var_result_number == 0 and vn_var_result_flag is False and vn_var_result_text == "")';
  const defaults = '    assert eval (vn_var_result_number == -7 and vn_var_result_flag is True and vn_var_result_text == "输出默认")';
  const owned = py([f.parent.id, f.child.id, ...f.menus.map(page => page.pageId)]);
  const clean = ['    assert eval (not any(record["page"] in ' + owned + ' for record in vn_ui_interface_records.values()))', '    assert eval (not vn_ui_open_pages and not vn_ui_state_records and not vn_bp_live_frames and vn_bp_frame is None and vn_bp_wait is None)', '    assert eval (len(renpy.game.contexts) == 1 and not vn_ui_lifecycle_failures)'];
  const closeParent = [click(f.parent.components[1].id), '    pause until "页面接口验收已返回。"', ...clean];
  const expectedOutputs = py(Object.fromEntries(Object.entries(f.supplied).map(([id, value]) => [id + '_result', value])));
  const probes = [
    "testsuite global:", "    before testcase:", "        $ _test.timeout = 18.0", "        $ _test.transition_timeout = 0.05", "        $ _test.screenshot_directory = \"tests/screenshots\"", "        $ preferences.text_cps = 0", "    after testcase:", "        if eval not main_menu:", "            run MainMenu(confirm=False)", "        pause until screen \"main_menu\"", "    teardown:", "        exit", "",
    'init python:',
    '    def pi_record(page_id):',
    '        return next(record for record in vn_ui_interface_records.values() if record["page"] == page_id and vn_bp_task_alive(record["task"]))',
    '    def pi_invalid_inputs_are_rejected(page_id):',
    '        for value in (False, "0", float("inf")):',
    '            try:',
    '                vn_ui_interface_inputs(page_id, {"number": value})',
    '                return False',
    '            except Exception:',
    '                pass',
    '        return True',
    '    def pi_unknown_saved_version(page_id):',
    '        record = pi_record(page_id)',
    '        vn_ui_interface_store(record["key"], dict(record, version=77, futureSchema={"opaque": [0, False, ""]}))',
    '    def pi_unknown_read_is_rejected(page_id):',
    '        try:',
    '            vn_ui_interface_get(page_id, "inputs", "number", "number")',
    '            return False',
    '        except Exception as error:',
    '            return "版本" in str(error)',
    '',
  ];
  const tests = [
    'testcase page_interface_typed_completion:', ...start, ...parent, ...child,
    '    assert eval (pi_record(' + q(f.child.id) + ')["inputs"] == ' + py(f.supplied) + ')',
    '    assert eval (pi_invalid_inputs_are_rejected(' + q(f.child.id) + '))',
    click('pi_child_stage'), '    assert eval (pi_record(' + q(f.child.id) + ')["outputs"] == ' + expectedOutputs + ')', click('pi_child_complete'),
    '    pause until eval (vn_var_resumed_count == 1)', typed,
    '    assert eval (vn_var_order == "CSFRLX" and vn_var_closed_input == 0 and vn_var_closed_number == 0 and vn_var_closed_flag is False)', ...closeParent, '',
    'testcase page_interface_custom_button_return:', ...start, ...parent, ...child, click('pi_child_stage'), click('pi_child_action_return'),
    '    pause until eval (vn_var_resumed_count == 1)', typed,
    '    assert eval (vn_var_result_reason == "completed" and vn_var_closed_count == 1 and vn_var_request_count == 1)', ...closeParent, '',
    'testcase page_interface_override_and_cancel:', ...start, ...parent, ...child, click('pi_child_stage'), click('pi_child_override'),
    '    pause until eval (vn_var_resumed_count == 1)', '    assert eval (vn_var_result_number == 9 and vn_var_result_flag is False and vn_var_result_text == "")',
    click('pi_open_child'), '    pause until eval (vn_var_created_count == 2)', click('pi_child_stage'), click('pi_child_cancel'),
    '    pause until eval (vn_var_resumed_count == 2)', defaults, '    assert eval (vn_var_result_reason == "cancelled" and vn_var_closed_count == 2)', ...closeParent, '',
    'testcase page_interface_duplicate_and_reopen:', ...start, ...parent, ...child, click('pi_child_stage'),
    '    $ renpy.test.testexecution.pi_old_token = vn_ui_page_token(' + q(f.child.id) + ')',
    click('pi_child_duplicate'), '    pause until eval (vn_var_already_count == 1)',
    '    assert eval (vn_var_duplicate_reason == "alreadyOpen" and vn_var_created_count == 1 and vn_var_resumed_count == 0)',
    '    assert eval (pi_record(' + q(f.child.id) + ')["inputs"]["number"] == 0)', click('pi_child_complete'), '    pause until eval (vn_var_resumed_count == 1)',
    click('pi_open_child'), '    pause until eval (vn_var_created_count == 2)',
    '    assert eval (vn_ui_page_token(' + q(f.child.id) + ') != renpy.test.testexecution.pi_old_token)',
    click('pi_child_complete'), '    pause until eval (vn_var_resumed_count == 2)', defaults, ...closeParent, '',
    'testcase page_interface_wait_veto_and_retry:', ...start, ...parent, ...child,
    '    $ vn_var_request_delay = 0.5', '    $ vn_var_veto = True', click('pi_child_complete'),
    '    pause until eval (vn_var_request_count == 1)', '    run Function(vn_ui_close_page, ' + q(f.child.id) + ', "重复", "cancelled")',
    '    pause 0.65', '    assert eval (vn_var_request_count == 1 and vn_var_resumed_count == 0)',
    '    assert eval (not pi_record(' + q(f.child.id) + ').get("closeRequest") and not pi_record(' + q(f.child.id) + ').get("closing"))',
    '    $ vn_var_veto = False', click('pi_child_complete'), '    pause until eval (vn_var_resumed_count == 1)',
    '    assert eval (vn_var_request_count == 2 and vn_var_closed_count == 1)', ...closeParent, '',
    'testcase page_interface_native_confirm_veto_then_accept:', ...start, ...parent, ...child, click('pi_child_stage'),
    '    $ vn_var_ask_confirm = True', '    $ renpy.test.testexecution.pi_confirm_token = vn_ui_page_token(' + q(f.child.id) + ')', click('pi_child_complete'),
    '    pause until screen "confirm"', '    click id "vn_confirm_no" pos (0.5, 0.5)',
    '    pause until eval (not pi_record(' + q(f.child.id) + ').get("closeRequest"))',
    '    assert eval (vn_ui_page_token(' + q(f.child.id) + ') == renpy.test.testexecution.pi_confirm_token and vn_var_resumed_count == 0)',
    '    assert eval (vn_var_request_count == 1 and vn_var_closed_count == 0)', click('pi_child_complete'),
    '    pause until screen "confirm"', '    click id "vn_confirm_yes" pos (0.5, 0.5)', '    pause until eval (vn_var_resumed_count == 1)',
    '    assert eval (vn_var_request_count == 2 and vn_var_closed_count == 1 and vn_var_result_number == 0 and vn_var_result_flag is False)',
    '    assert eval (vn_var_result_text == "" and vn_var_result_reason == "completed")', ...closeParent, '',
    'testcase page_interface_forced_parent:', ...start, ...parent, ...child, click('pi_child_stage'),
    '    $ vn_var_veto = True', '    $ vn_var_request_delay = 3.0', click('pi_child_parent'), '    pause until "页面接口验收已返回。"',
    '    assert eval (vn_var_request_count == 0 and vn_var_blur_count == 0 and vn_var_closed_count == 1 and vn_var_resumed_count == 0)',
    '    assert eval (vn_var_closed_number == -7 and vn_var_closed_flag is True)', ...clean, '',
    'testcase page_interface_save_restores_snapshot:', ...start, ...base, click('pi_child_stage'),
    '    $ renpy.test.testexecution.pi_old_token = vn_ui_page_token(' + q(f.child.id) + ')', '    run FileSave("page_interface", confirm=False, slot=True)',
    click('pi_child_override'), '    pause until "存档页面已返回。"', '    run FileLoad("page_interface", confirm=False, slot=True)',
    '    pause until eval (' + q(f.child.id) + ' in vn_ui_open_pages)',
    '    assert eval (vn_ui_page_token(' + q(f.child.id) + ') == renpy.test.testexecution.pi_old_token and vn_var_created_count == 1 and vn_var_resumed_count == 0)',
    '    assert eval (pi_record(' + q(f.child.id) + ')["outputs"] == ' + expectedOutputs + ')', click('pi_child_complete'), '    pause until "存档页面已返回。"', typed, ...clean, '',
    'testcase page_interface_load_drops_pending_callback_not_base_page:', ...start, ...base, click('pi_child_stage'),
    '    $ vn_var_request_delay = 2.0', click('pi_child_complete'), '    pause until eval (vn_var_request_count == 1)',
    '    run FileSave("page_close_pending", confirm=False, slot=True)', '    pause until "存档页面已返回。"', '    run FileLoad("page_close_pending", confirm=False, slot=True)',
    '    pause until eval (' + q(f.child.id) + ' in vn_ui_open_pages)',
    '    assert eval (not pi_record(' + q(f.child.id) + ').get("closeRequest") and not pi_record(' + q(f.child.id) + ').get("closing"))',
    '    assert eval (vn_var_created_count == 1 and vn_var_request_count == 1 and vn_var_resumed_count == 0)',
    '    $ vn_var_request_delay = 0.0', click('pi_child_complete'), '    pause until "存档页面已返回。"', typed,
    '    assert eval (vn_var_request_count == 2 and vn_var_resumed_count == 1)', ...clean, '',
    'testcase page_interface_unknown_saved_record_is_preserved:', ...start, ...base, click('pi_child_stage'),
    '    run Function(pi_unknown_saved_version, ' + q(f.child.id) + ')', '    run FileSave("page_future_record", confirm=False, slot=True)',
    '    run FileLoad("page_future_record", confirm=False, slot=True)', '    pause until eval (' + q(f.child.id) + ' in vn_ui_open_pages)',
    '    assert eval (any(r["reason"] == "unsupportedInterfaceVersion" and r["record"]["version"] == 77 and r["record"]["futureSchema"]["opaque"] == [0, False, ""] for r in vn_ui_interface_recovery.values()))',
    '    assert eval (pi_unknown_read_is_rejected(' + q(f.child.id) + '))', click('pi_child_complete'), '    pause until "存档页面已返回。"', defaults,
    '    assert eval (vn_var_created_count == 1 and vn_var_request_count == 0 and vn_var_closed_count == 0 and vn_var_result_reason == "navigated")', ...clean, '',
    'testcase page_interface_menu_replacement:', ...start, ...parent, click('pi_open_preferences'), '    pause until screen "preferences"',
    click('pi_preferences_stage'), click('pi_replace_menu'), '    pause until screen "staff_roll"',
    '    assert eval (vn_var_resumed_count == 0 and vn_var_closed_count == 1)', click('pi_staff_stage'), click('pi_staff_complete'),
    '    pause until eval (vn_var_resumed_count == 1)', defaults, '    assert eval (vn_var_result_reason == "navigated" and vn_var_closed_count == 2)', ...closeParent, '',
    'testcase page_interface_same_page_menu_alias_is_new_instance:', ...start, ...parent, click('pi_open_save'), '    pause until screen "load"',
    click('pi_save_stage'), '    run VnUiMenu("save")', '    pause until screen "save"',
    '    assert eval (vn_var_created_count == 2 and vn_var_resumed_count == 0)', click('pi_save_stage'), click('pi_save_complete'),
    '    pause until eval (vn_var_resumed_count == 1)', defaults, '    assert eval (vn_var_result_reason == "navigated")', ...closeParent, '',
    'testcase page_interface_native_parent_teardown:', ...start, ...parent, click('pi_open_preferences'), '    pause until screen "preferences"',
    '    $ vn_var_veto = True', '    $ vn_var_request_delay = 3.0',
    '    run Function(vn_ui_close_page, ' + q(f.parent.id) + ', "", "navigated", force=True)', '    pause until "页面接口验收已返回。"',
    '    assert eval (vn_var_request_count == 0 and vn_var_blur_count == 0 and vn_var_closed_count == 1)', ...clean, '',
  ];
  for (const menu of f.menus) for (const reason of ['complete', 'back']) tests.push(
    'testcase page_interface_' + menu.pageId.slice(3) + '_' + reason + ':', ...start, ...parent,
    click(menu.button.id), '    pause until screen ' + q(menu.screen), '    pause until eval (vn_var_focus_count == 1)',
    '    assert eval (pi_record(' + q(menu.pageId) + ')["inputs"] == ' + py(f.supplied) + ')',
    click(menu.prefix + 'stage'), menu.pageId === 'ui:voiceSettings' && reason === 'back' ? '    keysym "K_ESCAPE"' : click(menu.prefix + reason), '    pause until eval (vn_var_resumed_count == 1)', reason === 'complete' ? typed : defaults,
    '    assert eval (vn_var_request_count == 1 and vn_var_closed_count == 1 and vn_var_result_reason == ' + q(reason === 'complete' ? 'completed' : 'cancelled') + ')', ...closeParent, '');
  const test = [...probes, ...tests].join('\n');
  await fs.writeFile(path.join(source, 'testcases.rpy'), test); await fs.writeFile(path.join(game, 'game/testcases.rpy'), test);
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 360000 };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  const native = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  await check('page-interfaces', native); report.cases = tests.filter(line => line.startsWith('testcase ')).length;
  assert.match(native.log, new RegExp('Test cases\\s*:\\s*' + report.cases + '\\s*\\|\\s*' + report.cases + ' passed'));
  report.assertions = Number(native.log.match(/Assertions\s*:\s*(\d+)/)?.[1]); assert.equal(report.assertions, tests.filter(line => line.startsWith('    assert ')).length);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); console.error(error); process.exitCode = 1; }
finally {
  try {
    for (const [from, to] of [[path.join(source, 'project.vns.json'), path.join(output, 'fixture.project.json')], [path.join(game, 'game/testcases.rpy'), path.join(output, 'testcases.rpy')]]) {
      if (await fs.stat(from).then(stat => stat.isFile()).catch(() => false)) await fs.copyFile(from, to);
    }
    for (const directory of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) {
      if (await fs.stat(directory).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(directory, path.join(output, 'screenshots'), { recursive: true });
    }
  } catch (error) { report.status = 'failed'; report.error = [report.error, 'Evidence preservation failed: ' + String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  try { const cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves', 'renpy-saves']); report.cleanup = cleanup; assert.deepEqual(cleanup.errors, []); }
  catch (error) { report.status = 'failed'; report.cleanup = { error: String(error) }; process.exitCode = 1; }
  await save(); console.log(path.join(output, 'report.json'));
}
