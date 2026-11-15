import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createNativePageLifecycleFixture } from './lib/native-page-lifecycle-fixture';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';

const sdk = process.env.VNS_RENPY_SDK ?? 'E:/Tools/renpy-8.5.3-sdk';
const output = path.resolve('artifacts/native-page-lifecycle-runtime', new Date().toISOString().replaceAll(':', '-'));
const source = path.join(output, 'source'), game = path.join(output, 'game');
const report: { status: string; checks: { name: string; code: number; logPath: string }[]; assertions?: number; error?: string; cleanup?: unknown } = { status: 'running', checks: [] };
await fs.mkdir(source, { recursive: true });
await isolateRenpySaves(output);
const saveReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  const logPath = path.join(output, name + '.log'); await fs.writeFile(logPath, result.log);
  report.checks.push({ name, code: result.code, logPath }); await saveReport();
  if (result.code) throw new Error(name + ': ' + result.log.slice(-6500));
}
try {
  const { project, child } = createNativePageLifecycleFixture(), original = structuredClone(project);
  assert.deepEqual(compileProject(project).diagnostics.filter(d => d.severity === 'error'), []);
  assert.deepEqual(project, original, 'Compilation must not mutate the authored fixture.');
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(project, null, 2));
  const built = await buildProject({ project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + '\n' + JSON.stringify(built.diagnostics) });
  const q = JSON.stringify;
  const testcase = [
    'testsuite global:',
    '    before testcase:',
    '        $ _test.timeout = 35.0',
    '        $ _test.transition_timeout = 0.5',
    '        $ _test.screenshot_directory = "tests/screenshots"',
    '        $ preferences.text_cps = 0',
    '    after testcase:',
    '        screenshot "after-test.png"',
    '    teardown:',
    '        exit',
    '',
    'testcase native_menu_lifecycle:',
    '    pause until screen "main_menu"',
    '    # Equal actions must preserve a held button across animation refreshes.',
    '    assert eval (VnUiNavigate(Return()) == VnUiNavigate(Return()))',
    '    assert eval (VnUiNavigate(Return()) != VnUiNavigate(Return(1)))',
    '    assert eval (VnUiActions("ui:preferences", [Return()]) == VnUiActions("ui:preferences", [Return()]))',
    '    assert eval (VnUiActions("ui:preferences", [Return()]) != VnUiActions("ui:gallery", [Return()]))',
    '    click id "vn_main_start"',
    '    pause until "内置页面生命周期测试剧情。"',
    '    click id "vn_component_native_open_preferences"',
    '    pause until screen "preferences"',
    '    pause 0.08',
    '    assert eval (vn_var_preference_shows == 1)',
    '    click id "vn_component_native_animate"',
    '    pause 0.08',
    '    assert eval (("native_target", "opacity") in vn_ui_animations)',
    '    assert eval (vn_ui_animations[("native_target", "opacity")]["task"].get("page") == "ui:preferences")',
    '    click id "vn_component_native_gallery"',
    '    pause until screen "gallery"',
    '    pause 0.08',
    '    assert eval (vn_var_gallery_shows == 1)',
    '    assert eval (("native_target", "opacity") not in vn_ui_animations)',
    '    assert eval ("native_target" not in vn_ui_overrides)',
    '    click id "vn_component_native_back"',
    '    pause until screen "preferences"',
    '    pause 0.08',
    '    assert eval (vn_var_preference_shows == 2)',
    '    screenshot "native-reopened-menu.png"',
    '    assert eval (vn_ui_get("native_target", "opacity") == 1)',
    '    assert eval (vn_bp_wait is None)',
    '',
    '    # Switching during a waiting callback must unwind to the real menu.',
    '    click id "vn_component_native_delay"',
    '    pause until eval (vn_var_waiting == 1)',
    '    assert eval (vn_var_after_wait == 0)',
    '    click id "vn_component_native_gallery"',
    '    pause until screen "gallery"',
    '    pause 0.08',
    '    assert eval (vn_bp_wait is None)',
    '    assert eval (vn_var_after_wait == 0)',
    '    pause 2.1',
    '    assert eval (renpy.get_screen("gallery") is not None)',
    '    assert eval (vn_var_after_wait == 0)',
    '',
    '    screenshot "native-switch-cancelled.png"',
    '    # Return and Escape must exit the owning menu, not just its delay.',
    '    click id "vn_component_native_back"',
    '    pause until screen "preferences"',
    '    click id "vn_component_native_delay"',
    '    pause until eval (vn_var_waiting == 2)',
    '    click id "vn_component_native_return"',
    '    pause until "内置页面生命周期测试剧情。"',
    '    assert eval (vn_var_after_wait == 0 and vn_bp_wait is None)',
    '    assert eval (not renpy.get_screen("preferences"))',
    '    click id "vn_component_native_open_preferences"',
    '    pause until screen "preferences"',
    '    click id "vn_component_native_delay"',
    '    pause until eval (vn_var_waiting == 3)',
    '    keysym "K_ESCAPE"',
    '    pause until "内置页面生命周期测试剧情。"',
    '    assert eval (vn_var_after_wait == 0 and vn_bp_wait is None)',
    '    assert eval (not renpy.get_screen("preferences"))',
    '    screenshot "native-return-cancelled.png"',
    '    # Children belong to the menu that opened them.',
    '    click id "vn_component_native_open_preferences"',
    '    pause until screen "preferences"',
    '    click id "vn_component_native_child"',
    '    pause until eval (' + q(child.id) + ' in vn_ui_open_pages)',
    '    assert eval (vn_ui_page_token(' + q(child.id) + ') is not None)',
    '    click id "vn_component_native_gallery"',
    '    pause until screen "gallery"',
    '    pause 0.08',
    '    assert eval (' + q(child.id) + ' not in vn_ui_open_pages)',
    '    assert eval (' + q(child.id) + ' not in vn_ui_page_sessions)',
    '    assert eval (not vn_ui_page_order)',
    '    assert eval (vn_bp_wait is None)',
    '',
    '    # A save retains the base statement, not transient menu callbacks.',
    '    click id "vn_component_native_back"',
    '    pause until screen "preferences"',
    '    click id "vn_component_native_animate"',
    '    click id "vn_component_native_child"',
    '    pause until eval (' + q(child.id) + ' in vn_ui_open_pages)',
    '    assert eval (vn_var_preference_shows == 6)',
    '    $ vn_parameter_set("saved_shows", vn_var_preference_shows)',
    '    run FileSave("native_menu", confirm=False, slot=True)',
    '    run FileLoad("native_menu", confirm=False, slot=True)',
    '    pause until "内置页面生命周期测试剧情。"',
    '    assert eval (vn_var_preference_shows == 6 and vn_var_saved_shows == 6)',
    '    assert eval (not renpy.get_screen("preferences"))',
    '    assert eval (not any(session["page"] == "ui:preferences" for session in vn_ui_native_page_sessions.values()))',
    '    assert eval (("native_target", "opacity") not in vn_ui_animations and "native_target" not in vn_ui_overrides)',
    '    assert eval (not vn_ui_open_pages and not vn_ui_page_sessions)',
    '    assert eval (vn_bp_wait is None and vn_var_after_wait == 0)',
    '    screenshot "native-save-load-cleanup.png"',
    '    # An OnShow dispatcher must not swallow a deferred Return value.',
    '    click id "vn_component_native_show_wait"',
    '    pause until eval (vn_var_waiting == 4)',
    '    assert eval (vn_var_auto_wait is False)',
    '    click id "vn_component_native_return"',
    '    pause until "内置页面生命周期测试剧情。"',
    '    assert eval (vn_var_after_wait == 0 and vn_bp_wait is None)',
    '    assert eval (not renpy.get_screen("preferences"))',
    '    screenshot "native-onshow-return.png"',
    '    # Player rollback restores the base page and drops transient menu owners.',
    '    advance',
    '    pause until "第二句用于验证内置页面回滚。"',
    '    click id "vn_component_native_open_preferences"',
    '    pause until screen "preferences"',
    '    click id "vn_component_native_animate"',
    '    click id "vn_component_native_child"',
    '    pause until eval (' + q(child.id) + ' in vn_ui_open_pages)',
    '    # Ordinary Rollback is deliberately insensitive in native menu contexts.',
    '    assert eval (not Rollback().get_sensitive())',
    '    click id "vn_component_native_return"',
    '    pause 0.1',
    '    pause until "第二句用于验证内置页面回滚。"',
    '    assert eval Rollback().get_sensitive()',
    '    run Rollback()',
    '    pause until "内置页面生命周期测试剧情。"',
    '    assert eval (not renpy.get_screen("preferences"))',
    '    assert eval (not any(session["page"] == "ui:preferences" for session in vn_ui_native_page_sessions.values()))',
    '    assert eval (("native_target", "opacity") not in vn_ui_animations and "native_target" not in vn_ui_overrides)',
    '    assert eval (not vn_ui_open_pages and not vn_ui_page_sessions)',
    '    assert eval (vn_bp_wait is None and vn_var_after_wait == 0)',
    '    screenshot "native-rollback-cleanup.png"',
    '    # Replacing a menu must not finish its surviving external caller.',
    '    run MainMenu(confirm=False)',
    '    pause until screen "main_menu"',
    '    click id "vn_component_native_external"',
    '    pause until screen "preferences"',
    '    assert eval (vn_var_external_after == 0)',
    '    click id "vn_component_native_gallery"',
    '    pause until screen "gallery"',
    '    assert eval (vn_var_external_after == 0)',
    '    click id "vn_component_native_back"',
    '    pause until screen "preferences"',
    '    click id "vn_component_native_return"',
    '    pause until screen "main_menu"',
    '    assert eval (vn_var_external_after == 1)',
    '    screenshot "native-external-return.png"',
    '    assert eval (not vn_ui_open_pages and not vn_ui_page_sessions)',
    '    assert eval (vn_bp_wait is None)',
    '',
  ].join('\n');
  await fs.writeFile(path.join(game, 'game', 'testcases.rpy'), testcase);
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 120000 };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  const result = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  await check('native-lifecycle', result);
  assert.match(result.log, /Test cases\s*:\s*1\s*\|\s*1 passed/);
  report.assertions = Number(result.log.match(/Assertions\s*:\s*(\d+)/)?.[1]);
  assert.equal(report.assertions, (testcase.match(/^    assert /gm) ?? []).length, 'Every native assertion must execute.');
  report.status = 'passed'; await saveReport(); console.log('PASS: ' + path.join(output, 'report.json'));
} catch (error) { report.status = 'failed'; report.error = String(error); await saveReport(); console.error(error); process.exitCode = 1; }
finally {
  try {
    for (const [from, to] of [[path.join(source, 'project.vns.json'), 'fixture.project.json'], [path.join(game, 'game/testcases.rpy'), 'testcases.rpy']]) {
      if (await fs.stat(from).then(stat => stat.isFile()).catch(() => false)) await fs.copyFile(from, path.join(output, to));
    }
    for (const directory of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) {
      if (await fs.stat(directory).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(directory, path.join(output, 'screenshots'), { recursive: true });
    }
  } catch (error) { report.status = 'failed'; report.error = [report.error, 'Evidence: ' + String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  try { report.cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves', 'renpy-saves']); assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []); }
  catch (error) { report.status = 'failed'; report.error = [report.error, 'Cleanup: ' + String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  await saveReport();
}
