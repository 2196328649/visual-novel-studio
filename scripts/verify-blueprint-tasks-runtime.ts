import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createBlueprintTaskFixture } from './lib/blueprint-task-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Task acceptance uses isolated development games only.');
const sdk = process.env.VNS_RENPY_SDK ?? path.resolve('resources/runtime');
const selectedCase = process.argv.find(argument => argument.startsWith('--case='))?.slice(7);
const profileBurst = process.argv.includes('--profile-burst');
const output = path.resolve('artifacts/blueprint-tasks-runtime', new Date().toISOString().replaceAll(':', '-'));
const source = path.join(output, 'source'), game = path.join(output, 'game');
const report: { status: string; checks: { name: string; code: number; logPath: string }[]; cases?: number; assertions?: number; error?: string; cleanup?: unknown } = { status: 'running', checks: [] };
await fs.mkdir(source, { recursive: true });
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  const logPath = path.join(output, name + '.log'); await fs.writeFile(logPath, result.log); report.checks.push({ name, code: result.code, logPath }); await save();
  assert.equal(result.code, 0, name + ': ' + result.log.slice(-7000));
}
try {
  const f = createBlueprintTaskFixture(), before = structuredClone(f.project);
  assert.deepEqual(compileProject(f.project).diagnostics.filter(d => d.severity === 'error'), []); assert.deepEqual(f.project, before);
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(f.project, null, 2));
  const built = await buildProject({ project: f.project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  const q = JSON.stringify, click = (id: string) => '    click id ' + q('vn_component_' + id) + ' pos (0.5, 0.5)';
  const start = ['    pause until screen "main_menu"', '    click id "vn_main_start" pos (0.5, 0.5)', '    pause until "准备验收通用任务。"'];
  const open = ['    run Jump(' + q('vn_node_' + f.interactive.id) + ')', '    pause until eval (' + q(f.page.id) + ' in vn_ui_open_pages)'];
  const close = [click(f.page.components[1].id), '    pause until "通用任务页面已返回。"', '    assert eval (not vn_ui_open_pages and not vn_ui_state_records and not vn_bp_live_frames)', '    assert eval (not any(vn_bp_async_active(record) for record in vn_bp_async_tasks.values()))', '    assert eval (len(renpy.game.contexts) == 1 and vn_bp_frame is None and vn_bp_wait is None)'];
  const test = [
    "testsuite global:", "    before testcase:", "        $ _test.timeout = 18.0", "        $ _test.transition_timeout = 0.05", "        $ _test.screenshot_directory = \"tests/screenshots\"", "        $ preferences.text_cps = 0", "    after testcase:", "        if eval not main_menu:", "            run MainMenu(confirm=False)", "        pause until screen \"main_menu\"", "    teardown:", "        exit", "",
    'testcase task_same_event_debounce:', ...start, ...open,
    '    screenshot "task-workbench.png"',
    ...(profileBurst ? ['    $ renpy.test.testexecution.task_profile = __import__("cProfile").Profile()', '    $ renpy.test.testexecution.task_profile.enable()'] : []),
    ...(profileBurst ? ['    $ print("TASK_BURST_BEGIN", renpy.display.core.get_time(), vn_bp_temporal_clock)'] : []),
    click('task_debounce'), '    pause 0.1', click('task_debounce'), '    pause 0.1', click('task_debounce'), '    pause 0.15',
    ...(profileBurst ? ['    $ print("TASK_BURST_END", renpy.display.core.get_time(), vn_bp_temporal_clock, [(r["serial"], r["status"]) for r in vn_bp_async_tasks.values()])'] : []),
    ...(profileBurst ? ['    $ renpy.test.testexecution.task_profile.disable()', '    $ renpy.test.testexecution.task_profile.dump_stats(config.basedir + "/tasks-runtime.prof")'] : []),
    '    assert eval (vn_var_payload == 3 and vn_var_started == 0)',
    '    pause until eval (vn_var_finished == 1)', '    assert eval (vn_var_started == 1 and vn_var_last_value == 3)',
    '    assert eval (sum(1 for r in vn_bp_async_tasks.values() if r["status"] == "cancelled") == 2)',
    '    assert eval (vn_bp_async_result(vn_var_handle)["outputs"] == {"value_output": 3, "false_output": False, "empty_output": ""})', ...close, '',
    'testcase task_independent_long_short:', ...start, ...open,
    click('task_slow'), '    pause until eval (vn_var_started == 1)', click('task_fast'), '    pause until eval (vn_var_finished == 1)',
    '    assert eval (vn_var_started == 2 and vn_var_last_value == 2)',
    '    assert eval (sum(1 for r in vn_bp_async_tasks.values() if vn_bp_async_active(r)) == 1)',
    '    pause until eval (vn_var_finished == 2)', '    assert eval (vn_var_last_value == 1)', ...close, '',
    'testcase task_cancel_running_and_waiter:', ...start, ...open,
    click('task_slow'), '    pause until eval (vn_var_started == 1)', click('task_await'), click('task_cancel'),
    '    pause until eval (vn_var_await_cancelled == 1)', '    pause 1.6',
    '    assert eval (vn_var_finished == 0 and vn_var_await_done == 0 and vn_var_cancelled is True)',
    click('task_cancel'), '    assert eval (vn_var_cancelled is False and vn_var_await_cancelled == 1)', ...close, '',
    'testcase task_pending_cancel_missing:', ...start, ...open,
    click('task_await'), '    assert eval (vn_var_await_missing == 1)', click('task_debounce'), click('task_cancel'), '    pause 0.8',
    '    assert eval (vn_var_started == 0 and vn_var_finished == 0 and vn_var_cancelled is True)', ...close, '',
    'testcase task_replacement_is_not_timer_only:', ...start, ...open,
    '    $ vn_var_duration = 1.0', click('task_replace'), '    pause until eval (vn_var_started == 1)', click('task_replace'),
    '    pause until eval (vn_var_finished == 1)', '    assert eval (vn_var_started == 2 and vn_var_last_value == 2)',
    '    assert eval (sum(1 for r in vn_bp_async_tasks.values() if r.get("reason") == "replaced") == 1)', ...close, '',
    'testcase task_ignore_and_call_scope:', ...start, ...open,
    '    $ vn_var_duration = 1.0', click('task_ignore'), click('task_ignore'), '    pause until eval (vn_var_finished == 1)',
    '    assert eval (vn_var_started == 1)', click('task_orphan'), '    pause 0.2', '    assert eval (vn_var_started == 1)',
    '    assert eval (any(r.get("reason") == "callEnded" for r in vn_bp_async_tasks.values()))',
    click('task_call'), '    pause until eval (vn_var_call_done == 1)', '    assert eval (vn_var_started == 2 and vn_var_finished == 2)', ...close, '',
    'testcase task_throttle_reset_boundary:', ...start, ...open,
    click('task_throttle'), click('task_throttle'), '    assert eval (vn_var_throttle_pass == 1 and vn_var_throttled == 1)',
    '    pause 0.55', click('task_throttle'), click('task_throttle_reset'), '    assert eval (vn_var_throttle_pass == 2 and vn_var_throttle_reset == 1)',
    click('task_throttle'), '    assert eval (vn_var_throttle_pass == 3)', ...close, '',
    'testcase task_nested_frames:', ...start, ...open,
    click('task_nested'), '    pause until eval (vn_var_finished == 1)',
    '    assert eval (vn_var_started == 1 and vn_bp_async_result(vn_var_handle)["outputs"] == {"value_output": 7, "false_output": False, "empty_output": ""})', ...close, '',
    'testcase task_cancel_animation_resource:', ...start, ...open,
    click('task_animation'), '    pause until eval (bool(vn_ui_animations))', '    pause 0.2', click('task_cancel'),
    '    $ renpy.test.testexecution.task_cancelled_opacity = vn_ui_get(' + q(f.page.components[0].id) + ', "opacity")',
    '    pause 1.4', '    assert eval (vn_var_finished == 0 and not vn_ui_animations)',
    '    assert eval (0 < renpy.test.testexecution.task_cancelled_opacity < 1)',
    '    assert eval (abs(vn_ui_get(' + q(f.page.components[0].id) + ', "opacity") - renpy.test.testexecution.task_cancelled_opacity) < 0.03)', ...close, '',
    'testcase task_queued_save_remaining_quiet_time:', ...start, ...open,
    '    $ vn_var_quiet = 1.5', click('task_debounce'), '    pause 0.2', '    run FileSave("task_queued", confirm=False, slot=True)',
    '    pause until eval (vn_var_finished == 1)', '    run FileLoad("task_queued", confirm=False, slot=True)',
    '    assert eval (vn_var_payload == 1 and vn_var_started == 0)', '    pause 0.2', '    assert eval (vn_var_started == 0)',
    '    pause until eval (vn_var_finished == 1)', '    assert eval (vn_var_started == 1 and vn_var_last_value == 1)', ...close, '',
    'testcase task_lost_callback_owner_on_load:', ...start, ...open,
    '    $ vn_var_duration = 2.0', click('task_call'), '    pause until eval (vn_var_started == 1)',
    '    run FileSave("task_callback", confirm=False, slot=True)', '    run FileLoad("task_callback", confirm=False, slot=True)',
    '    pause until eval (' + q(f.page.id) + ' in vn_ui_open_pages)', '    pause 2.2',
    '    assert eval (vn_var_started == 1 and vn_var_finished == 0 and vn_var_call_done == 0)',
    '    assert eval (not any(vn_bp_async_active(r) for r in vn_bp_async_tasks.values()))',
    click('task_fast'), '    pause until eval (vn_var_finished == 1)', '    assert eval (vn_var_started == 2)', ...close, '',
    'testcase task_page_save_remaining_time:', ...start, ...open,
    '    $ vn_var_duration = 2.0', click('task_replace'), '    pause until eval (vn_var_started == 1)', '    pause 0.2',
    '    $ renpy.test.testexecution.task_saved_handle = vn_var_handle', '    run FileSave("task_page_wait", confirm=False, slot=True)',
    '    pause until eval (vn_var_finished == 1)', '    pause 0.3', '    run FileLoad("task_page_wait", confirm=False, slot=True)',
    '    pause until eval (' + q(f.page.id) + ' in vn_ui_open_pages)',
    '    assert eval (vn_var_handle == renpy.test.testexecution.task_saved_handle and vn_var_started == 1 and vn_var_finished == 0)',
    '    pause 0.2', '    assert eval (vn_var_finished == 0)', '    pause until eval (vn_var_finished == 1)',
    '    assert eval (vn_var_started == 1 and vn_var_last_value == 1)', ...close, '',
    'testcase task_call_save_remaining_time:', ...start,
    '    $ vn_var_duration = 3.0', '    click', '    pause until eval (vn_var_started == 1)', '    pause 0.2',
    '    run FileSave("task_call_wait", confirm=False, slot=True)', '    pause until "调用内任务已完成。"',
    '    run FileLoad("task_call_wait", confirm=False, slot=True)', '    assert eval (vn_var_started == 1 and vn_var_finished == 0 and vn_var_call_done == 0)',
    '    pause 0.2', '    assert eval (vn_var_finished == 0)', '    pause until "调用内任务已完成。"',
    '    assert eval (vn_var_finished == 1 and vn_var_call_done == 1 and not vn_bp_live_frames)',
    '    $ print("TASK_ROLLBACK_STATE", renpy.can_rollback(), renpy.game.log.rollback_limit, len(renpy.game.contexts), [(rb.context.current, rb.hard_checkpoint, rb.retain_after_load) for rb in renpy.game.log.log[-8:]])',
    '    run Rollback()', '    pause until "准备验收通用任务。"',
    '    assert eval (vn_var_started == 0 and vn_var_finished == 0 and vn_var_call_done == 0 and not vn_bp_live_frames)', '',
    'testcase task_close_reopen_no_old_continuation:', ...start, ...open,
    click('task_slow'), '    pause until eval (vn_var_started == 1)', ...close, ...open, '    pause 1.6',
    '    assert eval (vn_var_finished == 0)', click('task_fast'), '    pause until eval (vn_var_finished == 1)', '    assert eval (vn_var_started == 2 and vn_var_last_value == 2)', ...close, '',
    'testcase task_native_template_lifetime:', ...start, ...open,
    click('task_native'), '    pause until screen "preferences"', click('task_native_debounce'), click('task_native_debounce'), click('task_native_close'),
    '    pause until eval (vn_var_native_done == 1)', '    pause 0.8', '    assert eval (vn_var_started == 0)',
    click('task_native'), '    pause until screen "preferences"', click('task_native_debounce'), '    pause until eval (vn_var_finished == 1)',
    '    assert eval (vn_var_started == 1 and vn_var_last_value == 3)', click('task_native_close'), '    pause until eval (vn_var_native_done == 2)', ...close, '',
    'testcase task_return_title_cleans_all_owners:', ...start, ...open,
    click('task_slow'), '    pause until eval (vn_var_started == 1)', '    run MainMenu(confirm=False)', '    pause until screen "main_menu"',
    '    assert eval (not vn_bp_async_tasks and not vn_bp_live_frames and not vn_ui_open_pages)',
    '    click id "vn_main_start" pos (0.5, 0.5)', '    pause until "准备验收通用任务。"', '    assert eval (vn_var_started == 0 and vn_var_finished == 0)', '',
  ].join('\n');
  await fs.writeFile(path.join(source, 'testcases.rpy'), test); await fs.writeFile(path.join(game, 'game/testcases.rpy'), test);
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 240000 };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  const native = await runRenpy(sdk, game, ['test', ...(selectedCase ? [selectedCase] : []), '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  await check('tasks', native); report.cases = selectedCase ? 1 : (test.match(/^testcase /gm) ?? []).length;
  const counts = native.log.match(/Test cases\s*:\s*(\d+)\s*\|\s*(\d+) passed/); assert.ok(counts);
  assert.equal(Number(counts[2]), report.cases); if (!selectedCase) assert.equal(Number(counts[1]), report.cases);
  const checkedSource = selectedCase ? test.split('testcase ' + selectedCase + ':')[1]?.split('\ntestcase ')[0] : test;
  assert.ok(checkedSource); report.assertions = Number(native.log.match(/Assertions\s*:\s*(\d+)/)?.[1]); assert.equal(report.assertions, (checkedSource.match(/^    assert /gm) ?? []).length);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); console.error(error); process.exitCode = 1; }
finally {
  try {
    for (const [from, to] of [[path.join(source, 'project.vns.json'), path.join(output, 'fixture.project.json')], [path.join(game, 'game/testcases.rpy'), path.join(output, 'testcases.rpy')]]) {
      if (await fs.stat(from).then(stat => stat.isFile()).catch(() => false)) await fs.copyFile(from, to);
    }
    if (profileBurst) await fs.copyFile(path.join(game, 'tasks-runtime.prof'), path.join(output, 'tasks-runtime.prof')).catch(() => undefined);
    for (const directory of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) {
      if (await fs.stat(directory).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(directory, path.join(output, 'screenshots'), { recursive: true });
    }
  } catch (error) { report.status = 'failed'; report.error = [report.error, 'Evidence preservation failed: ' + String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  try { const cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves']); report.cleanup = cleanup; assert.deepEqual(cleanup.errors, []); } catch (error) { report.status = 'failed'; report.cleanup = { error: String(error) }; process.exitCode = 1; }
  await save(); console.log(path.join(output, 'report.json'));
}
