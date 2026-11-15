import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { uiFlowOverlayFixture } from './lib/ui-flow-overlay-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';
import { buildProject, runRenpy } from '../src/runtime/service';
import { setUiFlowTarget, uiPageFlowEvents } from '../src/core/ui-page-flow';
import { uiPageOpeningPresets } from '../src/core/ui-page-opening';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Only isolated development games may be used.');
const sdk = process.env.VNS_RENPY_SDK ?? path.resolve('resources/runtime');
const output = path.resolve('artifacts/ui-flow-overlays-runtime', new Date().toISOString().replaceAll(':', '-'));
const source = path.join(output, 'source'), game = path.join(output, 'game');
await fs.mkdir(source, { recursive: true }); await isolateRenpySaves(output);
const report: { status: string; cases?: number; assertions?: number; checks: unknown[]; cleanup?: unknown; error?: string } = { status: 'running', checks: [] };
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  await fs.writeFile(path.join(output, name + '.log'), result.log); report.checks.push({ name, code: result.code }); await save();
  assert.equal(result.code, 0, name + ': ' + result.log.slice(-7000));
}
try {
  const f = uiFlowOverlayFixture(), q = JSON.stringify;
  const menu = uiPageFlowEvents(f.project, 'ui:main').find(e => e.nativeSlot === 'main:load')!;
  const menuTarget = { kind: 'page' as const, pageId: f.dialog.id };
  setUiFlowTarget(f.project, 'ui:main', menu.id, menuTarget, { ...uiPageOpeningPresets.dialog.value, closeOnEscape: false });
  setUiFlowTarget(f.project, 'ui:main', menu.id, menuTarget);
  const menuButton = f.project.ui.components.find(c => c.nativeSlot === 'main:load')!;
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(f.project, null, 2));
  const built = await buildProject({ project: f.project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  const click = (id: string) => '    click id ' + q('vn_component_' + id) + ' pos (0.5, 0.5)';
  const inPage = (id: string) => q(id) + ' in vn_ui_open_pages';
  const start = ['    pause until screen "main_menu"', '    click id "vn_main_start" pos (0.5, 0.5)', '    pause until "覆盖层验收开始。"'];
  const parent = [...start, '    run Jump("vn_node_overlay_entry")', '    pause until eval (' + inPage(f.parent.id) + ' and vn_ui_page_sessions[' + q(f.parent.id) + '].get("didShow"))'];
  const clean = ['    assert eval (not vn_ui_open_pages and not vn_ui_page_order)', '    assert eval (not vn_ui_lifecycle_failures)', '    assert eval (len(renpy.game.contexts) == (renpy.test.testexecution.overlay_title_depth if main_menu else 1))'];
  const tests = [
    'testcase overlay_real_menu_retarget:', '    pause until screen "main_menu"', click(menuButton.id), '    pause until eval (' + inPage(f.dialog.id) + ')',
    '    assert eval (main_menu and not renpy.get_screen("load"))',
    '    assert eval (not vn_ui_page_sessions[' + q(f.dialog.id) + ']["opening"]["closeOnEscape"])',
    '    keysym "K_ESCAPE"', '    assert eval (' + inPage(f.dialog.id) + ')',
    '    screenshot "menu-button-overlay.png"', click(f.dialog.components[1].id), '    pause until eval (not vn_ui_open_pages)', ...clean, '',
    'testcase overlay_passive_show_auto_and_input:', ...parent, click(f.openNotice.component.id), '    pause until eval (vn_var_notice_shows == 1)',
    '    assert eval (vn_var_shown_returns == 1 and not vn_ui_page_interactive(' + q(f.notice.id) + '))', click(f.under.id), '    assert eval (vn_var_under_clicks == 1)',
    '    screenshot "passive-transparent.png"', '    pause until eval (not (' + inPage(f.notice.id) + '))',
    '    assert eval (vn_var_page_closed == 1 and vn_var_shown_returns == 1 and vn_var_passive_keys == 0)', click(f.parent.components[1].id), '    pause until "调用者已关闭。"', ...clean, '',
    'testcase overlay_modal_wait_and_escape:', ...parent, click(f.openDialog.component.id), '    pause until eval (' + inPage(f.dialog.id) + ')',
    '    assert eval (not vn_ui_page_interactive(' + q(f.parent.id) + ') and vn_var_wait_returns == 0)',
    '    click pos (0.18, 0.3)', '    assert eval (vn_var_under_clicks == 0)', '    screenshot "modal-transparent.png"',
    '    keysym "K_ESCAPE"', '    pause until eval (vn_var_wait_returns == 1)', '    assert eval (not (' + inPage(f.dialog.id) + '))',
    click(f.parent.components[1].id), '    pause until "调用者已关闭。"', ...clean, '',
    'testcase overlay_repeat_and_owner_lifetime:', ...parent, click(f.openHud.component.id), '    pause until eval (vn_var_hud_shows == 1)',
    '    $ renpy.test.testexecution.overlay_token = vn_ui_page_token(' + q(f.hud.id) + ')', click(f.openHud.component.id), '    pause until eval (vn_var_shown_returns == 2)',
    '    assert eval (vn_ui_page_token(' + q(f.hud.id) + ') == renpy.test.testexecution.overlay_token and vn_var_hud_shows == 1)',
    click(f.openOwned.component.id), '    pause until eval (' + inPage(f.owned.id) + ')', click(f.parent.components[1].id), '    pause until "调用者已关闭。"',
    '    assert eval (' + inPage(f.hud.id) + ' and not (' + inPage(f.owned.id) + '))', '    assert eval (vn_var_parent_returns == 1)',
    '    run Jump("vn_node_overlay_second")', '    pause until "已经进入第二章节。"', '    assert eval (' + inPage(f.hud.id) + ')',
    click('overlay_hud_button'), '    assert eval (vn_var_hud_clicks == 1)', click(f.hud.components[1].id), ...clean, '',
    'testcase overlay_scene_lifetime:', ...parent, click(f.openScene.component.id), '    pause until eval (' + inPage(f.scene.id) + ')',
    click(f.parent.components[1].id), '    pause until "调用者已关闭。"', '    assert eval (' + inPage(f.scene.id) + ')',
    '    run Jump("vn_node_overlay_second")', '    pause until "已经进入第二章节。"', ...clean, '',
    'testcase overlay_passive_escape_reaches_owner:', ...parent, click(f.openOwned.component.id), '    pause until eval (' + inPage(f.owned.id) + ')',
    '    keysym "K_ESCAPE"', '    pause until "调用者已关闭。"', '    assert eval (vn_var_parent_returns == 1)', ...clean, '',
    'testcase overlay_save_load_snapshot:', ...parent, click(f.openHud.component.id), '    pause until eval (vn_var_hud_shows == 1)', click('overlay_hud_button'),
    '    $ renpy.test.testexecution.overlay_saved_token = vn_ui_page_token(' + q(f.hud.id) + ')', '    run FileSave("overlay_state", confirm=False, slot=True)',
    click(f.hud.components[1].id), '    run FileLoad("overlay_state", confirm=False, slot=True)', '    pause until eval (' + inPage(f.hud.id) + ')',
    '    assert eval (vn_ui_page_token(' + q(f.hud.id) + ') == renpy.test.testexecution.overlay_saved_token and vn_var_hud_shows == 1 and vn_var_hud_clicks == 1)',
    click('overlay_hud_button'), '    assert eval (vn_var_hud_clicks == 2)', click(f.hud.components[1].id), click(f.parent.components[1].id), '    pause until "调用者已关闭。"', ...clean, '',
    'testcase overlay_timer_load_and_native_menu:', ...parent,
    '    run Function(vn_ui_open_page, ' + q(f.notice.id) + ', opening={"presentation":"overlay", "input":"none", "lifetime":"game", "closeOnEscape":False, "autoClose":2.5})',
    '    pause until eval (vn_var_notice_shows == 1)', '    pause 0.3', '    run FileSave("overlay_timer", confirm=False, slot=True)',
    '    pause until eval (not (' + inPage(f.notice.id) + '))', '    run FileLoad("overlay_timer", confirm=False, slot=True)',
    '    pause until eval (' + inPage(f.notice.id) + ')', '    assert eval (vn_var_notice_shows == 1 and vn_var_page_closed == 0)',
    '    run VnUiMenu("preferences")', '    pause until screen "preferences"', '    pause 2.8',
    '    assert eval (' + inPage(f.notice.id) + ' and ' + q(f.notice.id) + ' not in vn_ui_visible_page_order())', '    keysym "K_ESCAPE"',
    '    pause until eval (' + q(f.notice.id) + ' in vn_ui_visible_page_order())', '    pause until eval (not (' + inPage(f.notice.id) + '))',
    '    assert eval (vn_var_page_closed == 1 and vn_var_notice_shows == 1)', click(f.parent.components[1].id), '    pause until "调用者已关闭。"', ...clean, '',
    'testcase overlay_rollback_and_title_cleanup:', ...start, '    run Jump("vn_node_overlay_rollback")', '    pause until "回滚之前。"', '    click', '    pause until "回滚之后。"',
    '    pause until eval (' + inPage(f.hud.id) + ')', '    run Rollback(force=True, checkpoints=1)', '    pause until "回滚之前。"', '    assert eval (not (' + inPage(f.hud.id) + '))',
    '    click', '    pause until "回滚之后。"', '    pause until eval (' + inPage(f.hud.id) + ')', '    assert eval (vn_var_hud_shows == 1)',
    '    run MainMenu(confirm=False)', '    pause until screen "main_menu"', ...clean, '    click id "vn_main_start" pos (0.5, 0.5)', '    pause until "覆盖层验收开始。"', '    assert eval (vn_var_hud_shows == 0 and vn_var_hud_clicks == 0)', ...clean, '',
  ];
  const text = ['testsuite global:', '    before testcase:', '        $ _test.timeout = 18.0', '        $ _test.transition_timeout = 0.05', '        $ _test.screenshot_directory = "tests/screenshots"', '        $ preferences.text_cps = 0', '        pause until screen "main_menu"', '        $ renpy.test.testexecution.overlay_title_depth = len(renpy.game.contexts)', '    after testcase:', '        if eval not main_menu:', '            run MainMenu(confirm=False)', '        pause until screen "main_menu"', '    teardown:', '        exit', '', ...tests].join('\n');
  await fs.writeFile(path.join(output, 'testcases.rpy'), text); await fs.writeFile(path.join(game, 'game/testcases.rpy'), text);
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 300000 };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  const actual = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  await check('overlays', actual);
  report.cases = tests.filter(line => line.startsWith('testcase ')).length;
  report.assertions = tests.filter(line => line.startsWith('    assert ')).length;
  assert.match(actual.log, new RegExp('Test cases\\s*:\\s*' + report.cases + '\\s*\\|\\s*' + report.cases + ' passed'));
  assert.equal(Number(actual.log.match(/Assertions\s*:\s*(\d+)/)?.[1]), report.assertions);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); console.error(error); process.exitCode = 1; }
finally {
  try {
    if (await fs.stat(path.join(source, 'project.vns.json')).catch(() => undefined)) await fs.copyFile(path.join(source, 'project.vns.json'), path.join(output, 'fixture.project.json'));
    for (const from of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) if (await fs.stat(from).catch(() => undefined)) await fs.cp(from, path.join(output, 'screenshots'), { recursive: true });
    report.cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves', 'renpy-saves']);
  } catch (error) { report.status = 'failed'; report.error = [report.error, String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  await save(); console.log(path.join(output, 'report.json'));
}
