import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createBlueprintTaskBoundaryFixture } from './lib/blueprint-task-boundary-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Boundary acceptance uses isolated development games only.');
const sdk = process.env.VNS_RENPY_SDK ?? path.resolve('resources/runtime');
const selectedCase = process.argv.find(argument => argument.startsWith('--case='))?.slice(7);
const diagnoseBudget = process.argv.includes('--diagnose-budget');
const output = path.resolve('artifacts/blueprint-task-boundaries-runtime', new Date().toISOString().replaceAll(':', '-'));
const source = path.join(output, 'source'), game = path.join(output, 'game');
const report: { status: string; checks: { name: string; code: number; logPath: string }[]; cases?: number; assertions?: number; error?: string; cleanup?: unknown } = { status: 'running', checks: [] };
await fs.mkdir(source, { recursive: true });
await isolateRenpySaves(output);
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  const logPath = path.join(output, name + '.log'); await fs.writeFile(logPath, result.log); report.checks.push({ name, code: result.code, logPath }); await save();
  assert.equal(result.code, 0, name + ': ' + result.log.slice(-7000));
}
try {
  const f = createBlueprintTaskBoundaryFixture(), before = structuredClone(f.project);
  assert.deepEqual(compileProject(f.project).diagnostics.filter(d => d.severity === 'error'), []); assert.deepEqual(f.project, before);
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(f.project, null, 2));
  const built = await buildProject({ project: f.project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  const q = JSON.stringify, click = (id: string) => '    click id ' + q('vn_component_' + id) + ' pos (0.5, 0.5)';
  const start = ['    pause until screen "main_menu"', '    click id "vn_main_start" pos (0.5, 0.5)', '    pause until "准备验收任务边界。"'];
  const open = ['    run Jump(' + q('vn_node_' + f.interactive.id) + ')', '    pause until eval (' + q(f.page.id) + ' in vn_ui_open_pages)'];
  const close = [click(f.page.components[1].id), '    pause until "任务边界页面已返回。"', '    assert eval (not vn_ui_open_pages and not vn_ui_state_records and not vn_bp_live_frames)', '    assert eval (not any(vn_bp_async_active(record) for record in vn_bp_async_tasks.values()))', '    assert eval (len(renpy.game.contexts) == 1 and vn_bp_frame is None and vn_bp_wait is None)'];
  const result = 'vn_bp_async_result(vn_var_boundary_handle)';
  const finished = '    pause until eval (' + result + '["status"] == "completed") timeout 10.0';
  const progressing = '    pause until eval (vn_bp_async_tasks.get(vn_var_boundary_handle, {}).get("steps", 0) >= 64)';
  const diagnostics = diagnoseBudget ? `init python:
    def vn_test_boundary_trace():
        record = vn_bp_async_tasks.get(vn_var_boundary_handle)
        if not record: return
        state = renpy.test.testexecution
        now = __import__("time").perf_counter()
        if not hasattr(state, "boundary_started"):
            state.boundary_started = state.boundary_last = now
            state.boundary_profile = __import__("cProfile").Profile()
            state.boundary_profile.enable()
        if now - state.boundary_started > 5 and state.boundary_profile:
            state.boundary_profile.disable()
            state.boundary_profile.dump_stats(config.basedir + "/boundary-runtime.prof")
            state.boundary_profile = None
        if now - state.boundary_last > 10 or record["status"] == "failed":
            print("BOUNDARY_PROGRESS", round(now-state.boundary_started, 3), record.get("steps", "terminal"), record["status"], record.get("reason"))
            state.boundary_last = now
    config.interact_callbacks.append(vn_test_boundary_trace)
` : '';
  const test = [
    diagnostics, "testsuite global:", "    before testcase:", "        $ _test.timeout = 18.0", "        $ _test.transition_timeout = 0.05", "        $ _test.screenshot_directory = \"tests/screenshots\"", "        $ preferences.text_cps = 0", "    after testcase:", "        if eval not main_menu:", "            run MainMenu(confirm=False)", "        pause until screen \"main_menu\"", "    teardown:", "        exit", "",
    'testcase task_boundary_empty_body_600:', ...start, ...open, click('boundary_normal'), finished,
    '    assert eval (' + result + '["outputs"] == {"final_index": 600, "completed": True})', ...close, '',
    'testcase task_boundary_empty_range:', ...start, ...open, click('boundary_empty'), finished,
    '    assert eval (' + result + '["outputs"] == {"final_index": 5, "completed": True})', ...close, '',
    'testcase task_boundary_early_return:', ...start, ...open, click('boundary_early'), finished,
    '    assert eval (' + result + '["outputs"] == {"final_index": 2, "completed": False})', ...close, '',
    'testcase task_boundary_fair_empty_loop:', ...start, ...open, click('boundary_long'), progressing, click('boundary_short'),
    '    pause until eval (vn_var_short_done == 1)', '    assert eval (' + result + '["status"] in ("running", "waiting"))', finished,
    '    assert eval (' + result + '["outputs"]["final_index"] == 6000)', ...close, '',
    'testcase task_boundary_cancel_empty_loop:', ...start, ...open, click('boundary_long'), progressing, click('boundary_cancel'),
    '    assert eval (' + result + '["status"] == "cancelled" and ' + result + '["reason"] == "cancelled")',
    '    pause 0.2', '    assert eval (' + result + '["outputs"] == {})', ...close, '',
    'testcase task_boundary_own_step_budget:', ...start, ...open, click('boundary_limit'),
    '    pause until eval (' + result + '["status"] == "failed") timeout ' + (diagnoseBudget ? '180.0' : '90.0'),
    '    assert eval (' + result + '["reason"] == "stepLimit" and ' + result + '["outputs"] == {})', ...close, '',
    'testcase task_boundary_save_loop_continuation:', ...start, ...open, click('boundary_long'), progressing,
    '    $ renpy.test.testexecution.boundary_saved_handle = vn_var_boundary_handle',
    '    $ renpy.test.testexecution.boundary_saved_steps = vn_bp_async_tasks[vn_var_boundary_handle]["steps"]',
    '    run FileSave("boundary_loop", confirm=False, slot=True)', finished,
    '    run FileLoad("boundary_loop", confirm=False, slot=True)',
    '    assert eval (vn_var_boundary_handle == renpy.test.testexecution.boundary_saved_handle)',
    '    assert eval (' + result + '["status"] in ("running", "waiting"))',
    '    assert eval (vn_bp_async_tasks[vn_var_boundary_handle]["steps"] >= renpy.test.testexecution.boundary_saved_steps)', finished,
    '    assert eval (' + result + '["outputs"] == {"final_index": 6000, "completed": True})', ...close, '',
  ].join('\n');
  await fs.writeFile(path.join(output, 'testcases.rpy'), test); await fs.writeFile(path.join(game, 'game/testcases.rpy'), test);
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 240000 };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  const native = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped', ...(selectedCase ? [selectedCase] : [])], { ...options, onData: text => process.stdout.write(text) });
  await check('boundaries', native); report.cases = selectedCase ? 1 : (test.match(/^testcase /gm) ?? []).length;
  const counts = native.log.match(/Test cases\s*:\s*(\d+)\s*\|\s*(\d+) passed/); assert.ok(counts); assert.equal(Number(counts[2]), report.cases);
  if (!selectedCase) assert.equal(Number(counts[1]), report.cases);
  const checkedSource = selectedCase ? test.split('testcase ' + selectedCase + ':')[1]?.split('\ntestcase ')[0] : test;
  assert.ok(checkedSource); report.assertions = Number(native.log.match(/Assertions\s*:\s*(\d+)/)?.[1]); assert.equal(report.assertions, (checkedSource.match(/^    assert /gm) ?? []).length);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); console.error(error); process.exitCode = 1; }
finally {
  try {
    if (diagnoseBudget) await fs.copyFile(path.join(game, 'boundary-runtime.prof'), path.join(output, 'boundary-runtime.prof')).catch(() => undefined);
    for (const [from, to] of [[path.join(source, 'project.vns.json'), path.join(output, 'fixture.project.json')], [path.join(game, 'game/testcases.rpy'), path.join(output, 'testcases.rpy')]]) {
      if (await fs.stat(from).then(stat => stat.isFile()).catch(() => false)) await fs.copyFile(from, to);
    }
    for (const directory of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) {
      if (await fs.stat(directory).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(directory, path.join(output, 'screenshots'), { recursive: true });
    }
  } catch (error) { report.status = 'failed'; report.error = [report.error, 'Evidence preservation failed: ' + String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  try { const cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves', 'renpy-saves']); report.cleanup = cleanup; assert.deepEqual(cleanup.errors, []); } catch (error) { report.status = 'failed'; report.cleanup = { error: String(error) }; process.exitCode = 1; }
  await save(); console.log(path.join(output, 'report.json'));
}
