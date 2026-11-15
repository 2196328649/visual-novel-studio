import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { createBlueprintStateFixture } from './lib/blueprint-state-fixture';
import { blueprintStateRuntimeCases } from './lib/blueprint-state-runtime-cases';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createBlueprintInvocationFixture } from './lib/blueprint-invocation-fixture';
import { createBlueprintEncapsulationFixture, encapsulateInvocationFixture } from './lib/blueprint-encapsulation-fixture';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';

const sdk = process.env.VNS_RENPY_SDK ?? 'E:/Tools/renpy-8.5.3-sdk';
const encapsulated = process.argv.includes('--encapsulated'), stateful = process.argv.includes('--state');
if (encapsulated && stateful) throw new Error('Choose either --encapsulated or --state for an isolated verification batch.');
const output = path.resolve(stateful ? 'artifacts/blueprint-state-runtime' : encapsulated ? 'artifacts/blueprint-encapsulation-runtime' : 'artifacts/blueprint-invocation-runtime', new Date().toISOString().replaceAll(':', '-'));
const source = path.join(output, 'source'), game = path.join(output, 'game');
const report: { status: string; checks: { name: string; code: number; logPath: string }[]; cases?: number; assertions?: number; error?: string; cleanup?: unknown } = { status: 'running', checks: [] };
await fs.mkdir(source, { recursive: true });
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  const logPath = path.join(output, name + '.log'); await fs.writeFile(logPath, result.log);
  report.checks.push({ name, code: result.code, logPath }); await save();
  if (result.code) throw new Error(name + ': ' + result.log.slice(-6000));
}
try {
  const fixture = stateful ? createBlueprintStateFixture() : encapsulated ? createBlueprintEncapsulationFixture() : createBlueprintInvocationFixture();
  if (stateful) fixture.callers.cache_a.nodes.find(node => node.type === 'callFunction')!.properties.arg_seconds = 1.6;
  if (encapsulated) encapsulateInvocationFixture(fixture as ReturnType<typeof createBlueprintEncapsulationFixture>);
  const { project, root, childA, childB, interactive, saved, snapshot } = fixture;
  const before = structuredClone(project);
  assert.deepEqual(compileProject(project).diagnostics.filter(d => d.severity === 'error'), []);
  assert.deepEqual(project, before);
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(project, null, 2));
  const built = await buildProject({ project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  const q = JSON.stringify;
  const start = ['    pause until screen "main_menu"', '    click id "vn_main_start" pos (0.5, 0.5)', '    pause until "准备检查调用隔离。"'];
  const open = ['    run Jump(' + q('vn_node_' + interactive.id) + ')', '    pause until eval (' + q(root.id) + ' in vn_ui_open_pages)'];
  const close = ['    click id ' + q('vn_component_' + root.components[1].id) + ' pos (0.5, 0.5)', '    pause until "调用隔离检查已返回。"', '    assert eval (not vn_ui_open_pages and not vn_ui_page_sessions)', '    assert eval (len(renpy.game.contexts) == 1 and vn_bp_task is None and vn_bp_wait is None and vn_bp_frame is None)'];
  const test = [
    'testsuite global:',
    '    before testcase:',
    '        $ _test.timeout = 8.0',
    '        $ _test.screenshot_directory = "tests/screenshots"',
    '        $ preferences.text_cps = 0',
    '    after testcase:',
    '        if eval not main_menu:', '            run MainMenu(confirm=False)',
    '        pause until screen "main_menu"',
    '    teardown:',
    '        exit',
    '',
    ...(['snapshot', 'cache', 'loop'] as const).flatMap(kind => [
      'testcase invocation_' + kind + ':', ...start, ...open,
      '    $ invocation_parent_frame = vn_bp_frame',
      '    click id ' + q('vn_component_invoke_' + kind + '_a') + ' pos (0.5, 0.5)',
      '    pause until eval (vn_var_ready == 1)',
      '    $ invocation_suspended_frame = vn_bp_frame',
      '    assert eval (vn_bp_frame is not invocation_parent_frame)',
      '    click id ' + q('vn_component_invoke_' + kind + '_b') + ' pos (0.5, 0.5)',
      '    pause until eval (vn_var_done_b == 1)',
      '    assert eval (vn_bp_frame is invocation_suspended_frame)',
      '    assert eval (vn_var_' + kind + '_b == ' + (kind === 'loop' ? 1 : 22) + ')',
      '    pause until eval (vn_var_done_a == 1)',
      '    assert eval (vn_bp_frame is invocation_parent_frame)',
      '    assert eval (vn_var_' + kind + '_a == ' + (kind === 'loop' ? 6 : 11) + ')',
      '    assert eval (vn_var_ready == 2 and len(renpy.game.contexts) == 1)',
      '    screenshot "invocation-' + kind + '.png"', ...close, '',
    ]),
    'testcase invocation_page_results:', ...start, ...open,
    '    click id "vn_component_invoke_page_a" pos (0.5, 0.5)',
    '    pause until eval (' + q(childA.id) + ' in vn_ui_open_pages)',
    '    click id ' + q('vn_component_' + childA.components[1].id) + ' pos (0.5, 0.5)',
    '    pause until eval (vn_var_ready == 1)',
    '    click id "vn_component_invoke_page_b" pos (0.5, 0.5)',
    '    pause until eval (' + q(childB.id) + ' in vn_ui_open_pages)',
    '    click id ' + q('vn_component_' + childB.components[1].id) + ' pos (0.5, 0.5)',
    '    pause until eval (vn_var_done_b == 1)',
    '    assert eval (vn_var_page_b == "B")',
    '    pause until eval (vn_var_done_a == 1)',
    '    assert eval (vn_var_page_a == "A")',
    '    assert eval (vn_var_ready == 2 and len(renpy.game.contexts) == 1)',
    ...close, '',
    ...([0, .25] as const).flatMap(elapsed => [
    'testcase invocation_save_' + (elapsed ? 'partial' : 'immediate') + '_and_rollback:', ...start,
    '    run Jump(' + q('vn_node_' + saved.id) + ')',
    '    pause until eval (vn_var_ready == 1)',
    '    pause ' + elapsed,
    '    assert eval (vn_bp_frame is not None and vn_bp_wait is not None)',
    '    $ renpy.test.testexecution.invocation_saved_frame = vn_bp_frame',
    '    $ renpy.test.testexecution.invocation_saved_wait = dict(vn_bp_wait)',
    '    run FileSave("invocation_wait", confirm=False, slot=True)',
    ...(elapsed ? ['    pause until eval (vn_var_done_a == 1)', '    assert eval (vn_var_cache_a == 11)'] : []),
    '    run FileLoad("invocation_wait", confirm=False, slot=True)',
    '    pause until eval (' + q(root.id) + ' in vn_ui_open_pages)',
    '    assert eval (vn_var_ready == 1 and vn_var_done_a == 0 and vn_var_cache_a == 0)',
    '    assert eval (vn_bp_frame == renpy.test.testexecution.invocation_saved_frame)',
    '    assert eval (renpy.test.testexecution.invocation_saved_wait["elapsed"] <= vn_bp_wait["elapsed"] < renpy.test.testexecution.invocation_saved_wait["elapsed"] + 0.3)',
    '    click id "vn_component_invoke_cache_b" pos (0.5, 0.5)',
    '    pause until eval (vn_var_done_b == 1)',
    '    assert eval (vn_var_cache_b == 22)',
    '    assert eval (vn_bp_frame == renpy.test.testexecution.invocation_saved_frame)',
    '    pause until eval (vn_var_done_a == 1)',
    '    assert eval (vn_var_cache_a == 11)',
    '    click id ' + q('vn_component_' + root.components[1].id) + ' pos (0.5, 0.5)',
    '    pause until "可保存调用已完成。"',
    '    assert eval (not vn_ui_open_pages and vn_bp_task is None and vn_bp_wait is None and vn_bp_frame is None)',
    '    run Rollback()',
    '    pause until "准备检查调用隔离。"',
    '    assert eval (vn_var_ready == 0 and vn_var_cache_a == 0 and not vn_ui_open_pages)',
    '    run Jump(' + q('vn_node_' + saved.id) + ')',
    '    pause until eval (vn_var_done_a == 1)',
    '    assert eval (vn_var_cache_a == 11 and vn_var_cache_b == 0)',
    '    click id ' + q('vn_component_' + root.components[1].id) + ' pos (0.5, 0.5)',
    '    pause until "可保存调用已完成。"',
    '    screenshot "invocation-save-' + (elapsed ? 'partial' : 'immediate') + '-rollback.png"',
    '',
    ]),
    'testcase invocation_cancel_and_reenter:', ...start, ...open,
    '    click id "vn_component_invoke_snapshot_a" pos (0.5, 0.5)',
    '    pause until eval (vn_var_ready == 1)', ...close,
    '    assert eval (vn_var_done_a == 0 and vn_var_snapshot_a == 0)',
    ...open,
    '    click id "vn_component_invoke_snapshot_b" pos (0.5, 0.5)',
    '    pause until eval (vn_var_done_b == 1)',
    '    assert eval (vn_var_snapshot_b == 22)',
    '    pause 0.9',
    '    assert eval (vn_var_done_a == 0 and vn_var_snapshot_a == 0)',
    ...close, '',
    'testcase invocation_legacy_slot_fallback:', ...start,
    '    $ vn_bp_frame = None',
    '    $ vn_bp_out_' + snapshot.id + '_value = 37',
    '    assert eval (vn_bp_local(' + q('vn_bp_out_' + snapshot.id + '_value') + ') == 37)',
    '    $ vn_bp_frame = vn_bp_enter_frame("probe", {})',
    '    assert eval (vn_bp_local(' + q('vn_bp_out_' + snapshot.id + '_value') + ') is None)',
    '    assert eval (vn_bp_local(' + q('vn_bp_out_' + snapshot.id + '_value') + ', 5) == 5)',
    '    $ invocation_empty_frame = vn_bp_frame',
    '    $ vn_bp_capture_local(' + q('vn_bp_out_' + snapshot.id + '_value') + ', 41)',
    '    assert eval (not invocation_empty_frame["values"] and vn_bp_frame["id"] == invocation_empty_frame["id"])',
    '    assert eval (vn_bp_local(' + q('vn_bp_out_' + snapshot.id + '_value') + ') == 41)',
    '    $ vn_bp_publish_frame()',
    '    assert eval (vn_bp_out_' + snapshot.id + '_value == 41)',
    '    $ vn_bp_frame = None', '',
    ...(stateful ? blueprintStateRuntimeCases(fixture as ReturnType<typeof createBlueprintStateFixture>, start, open, close) : []),
  ].join('\n');
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), test);
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 120000 };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  const native = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  await check('invocation', native);
  report.cases = (test.match(/^testcase /gm) ?? []).length;
  assert.match(native.log, new RegExp('Test cases\\s*:\\s*' + report.cases + '\\s*\\|\\s*' + report.cases + ' passed'));
  report.assertions = Number(native.log.match(/Assertions\s*:\s*(\d+)/)?.[1]);
  assert.equal(report.assertions, (test.match(/^    assert /gm) ?? []).length);
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
