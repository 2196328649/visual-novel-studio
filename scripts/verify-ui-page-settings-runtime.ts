import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createUiPageInterfaceFixture, pageInterfacePng } from './lib/ui-page-interface-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { setUiPageAppearance, uiPageTheme } from '../src/core/ui-page-settings';
import { createUiParameterBinding } from '../src/core/ui-logic';
import { projectForExport } from '../src/core/export-assets';
import { type UiComponent } from '../src/core/model';
import { compileProject } from '../src/runtime/compiler';
import { pythonLiteral as py } from '../src/runtime/literals';
import { buildProject, runRenpy } from '../src/runtime/service';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Use only isolated development games.');
const sdk = process.env.VNS_RENPY_SDK ?? 'E:/Tools/renpy-8.5.3-sdk';
const output = path.resolve('artifacts/ui-page-settings-runtime', new Date().toISOString().replaceAll(':', '-'));
const source = path.join(output, 'source'), game = path.join(output, 'game');
const report: { status: string; checks: { name: string; code: number }[]; cases?: number; assertions?: number; error?: string; cleanup?: unknown } = { status: 'running', checks: [] };
await fs.mkdir(path.join(source, 'assets'), { recursive: true });
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  await fs.writeFile(path.join(output, name + '.log'), result.log); report.checks.push({ name, code: result.code }); await save();
  assert.equal(result.code, 0, name + ': ' + result.log.slice(-10000));
}
function silence() {
  const wav = Buffer.alloc(44 + 1600); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(1600, 40);
  return wav;
}
try {
  const f = createUiPageInterfaceFixture({ allMenus: true }), project = f.project;
  project.name = '独立页面设置 · 运行时验收'; project.id = 'page_settings_acceptance';
  project.ui.fontSize = 26; project.ui.textColor = '#e6eeec'; project.ui.accent = '#bc8748'; project.ui.hoverSoundId = 'global_hover';
  project.assets.push({ id: 'page_font', name: '仅页面引用字体', kind: 'font', path: 'assets/page.ttf' },
    { id: 'global_hover', name: '全局悬停', kind: 'audio', path: 'assets/global.wav' }, { id: 'page_hover', name: '仅页面引用音效', kind: 'audio', path: 'assets/page.wav' });
  const text = (id: string, page: UiComponent['page'], caption: string, x = .08, y = .73): UiComponent => ({ id, page, kind: 'text', text: caption, x, y, width: .42, height: .11 });
  const appearance = (pageId: string, fontSize: number, textColor: string, accent: string, fontAssetId?: string, hoverSoundId?: string) => {
    setUiPageAppearance(project, pageId, 'fontSize', fontSize); setUiPageAppearance(project, pageId, 'textColor', textColor);
    setUiPageAppearance(project, pageId, 'accent', accent);
    if (fontAssetId !== undefined) setUiPageAppearance(project, pageId, 'fontAssetId', fontAssetId);
    if (hoverSoundId !== undefined) setUiPageAppearance(project, pageId, 'hoverSoundId', hoverSoundId);
  };
  appearance('ui:main', 38, '#dbeafe', '#398aab', 'page_font', 'page_hover');
  appearance('ui:say', 34, '#e3e5f2', '#b59edb', '', '');
  appearance('ui:messageBox', 20, '#f4dca8', '#9c7550', 'page_font', '');
  appearance('ui:chapterTitle', 20, '#c7e4eb', '#e1ae71', 'page_font', '');
  appearance(f.parent.id, 32, '#bae6d1', '#469e85');
  appearance(f.child.id, 38, '#ffd58a', '#ae7757', 'page_font', '');
  project.ui.components.push(text('ps_main', 'main', '标题页默认外观', .52, .18));
  f.parent.components.push(text('ps_parent', 'custom', '父页面 · 32 / 绿'));
  f.child.components.push(text('ps_child', 'custom', '子页面 · 38 / 金', .08, .69),
    { ...text('ps_explicit', 'custom', '控件独立样式 · 18 / 蓝', .54, .69), style: { fontSize: 18, textColor: '#8fd3ff' } },
    { ...text('ps_bound', 'custom', '共享参数控制显示', .08, .56), kind: 'button', width: .32, height: .09, style: { fontSize: 20 } });
  project.variables.push({ id: 'ps_visible', name: '页面联动开关', type: 'boolean', initial: true, persistent: false });
  createUiParameterBinding(project, 'ps_bound', 'visible', 'ps_visible', f.child.id);
  const colors = ['#b9d9e8', '#f2d7a0', '#c5e4d5'];
  for (const [index, menu] of f.menus.entries()) {
    const kind = menu.pageId.slice(3) as UiComponent['page'];
    appearance(menu.pageId, 18 + index % 3 * 2, colors[index % 3], '#7b9eae', index % 2 ? '' : 'page_font', index % 2 ? '' : 'page_hover');
    project.ui.pages![kind]!.layout = 'native';
    // Keep fixture-only action controls in a narrow rail, separate from page samples.
    menu.components.forEach((component, i) => Object.assign(component, { x: .78, y: .19 + i * .085, width: .2, height: .07, style: { fontSize: 14 } }));
    project.ui.components.push(text('ps_' + kind.toLowerCase(), kind, '本页默认值', .55, .84));
  }
  const before = structuredClone(project);
  assert.deepEqual(compileProject(project).diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.deepEqual(project, before);
  // Exercise the pruning path without fixture blueprints that intentionally retain all resources.
  const exportProbe = structuredClone(project); exportProbe.blueprints = []; exportProbe.ui.disabledPages = ['gallery'];
  assert.ok(projectForExport(exportProbe).assets.some(asset => asset.id === 'page_font'));
  assert.ok(projectForExport(exportProbe).assets.some(asset => asset.id === 'page_hover'));
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(project, null, 2));
  await fs.writeFile(path.join(source, 'assets/interface.png'), Buffer.from(pageInterfacePng, 'base64'));
  await fs.copyFile(path.join(sdk, 'sdk-fonts/SourceHanSansLite.ttf'), path.join(source, 'assets/page.ttf'));
  for (const file of ['global.wav', 'page.wav']) await fs.writeFile(path.join(source, 'assets', file), silence());
  const built = await buildProject({ project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await check('development-compile', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  for (const file of ['page.ttf', 'page.wav']) assert.ok((await fs.stat(path.join(game, 'game/assets', file))).isFile());

  const q = JSON.stringify, click = (id: string) => '    click id ' + q('vn_component_' + id) + ' pos (0.5, 0.5)';
  const start = ['    pause until screen "main_menu"', '    click id "vn_main_start" pos (0.5, 0.5)', '    pause until "准备验收统一页面接口。"'];
  const parent = ['    run Jump(' + q('vn_node_' + f.interactive.id) + ')', '    pause until eval (' + q(f.parent.id) + ' in vn_ui_open_pages)'];
  const child = [click('pi_open_child'), '    pause until eval (vn_var_focus_count == 1)'];
  const closeParent = [click(f.parent.components[1].id), '    pause until "页面接口验收已返回。"', '    assert eval (not vn_ui_open_pages and not vn_ui_state_records and not vn_bp_live_frames and not vn_ui_lifecycle_failures)'];
  const probes = [
    'testsuite global:', '    before testcase:', '        $ _test.timeout = 18.0', '        $ _test.transition_timeout = 0.05',
    '        $ _test.screenshot_directory = "tests/screenshots"', '        $ preferences.text_cps = 0',
    '    after testcase:', '        if eval not main_menu:', '            run MainMenu(confirm=False)', '        pause until screen "main_menu"', '    teardown:', '        exit', '',
    'init python:',
    '    def ps_text(screen, identity):', '        found = []',
    '        renpy.get_widget(screen, identity).visit_all(lambda d: found.append(d) if isinstance(d, renpy.text.text.Text) else None)', '        return found[0]',
    '    def ps_caption(screen, caption):', '        found = []',
    '        renpy.get_screen(screen).visit_all(lambda d: found.append(d) if isinstance(d, renpy.text.text.Text) and d.get_all_text() == caption else None)', '        return found[0]',
    '    def ps_native_styles(page, font, size, color):',
    '        prefix = vn_ui_native_prefix(page)', '        value = getattr(style, prefix + "_text")',
    '        return value.font == font and value.size == size and value.color == Color(color)',
    '    def ps_record(page_id):', '        return next(record for record in vn_ui_interface_records.values() if record["page"] == page_id and vn_bp_task_alive(record["task"]))', '',
  ];
  const tests = [
    'testcase page_settings_title_and_dialogue:', '    pause until screen "main_menu"', '    move pos (4, 4)',
    '    assert eval (ps_native_styles("main", "assets/page.ttf", 38, "#dbeafe"))',
    '    assert eval (ps_text("main_menu", "vn_main_start").style.font == "assets/page.ttf")',
    '    assert eval (ps_text("main_menu", "vn_component_ps_main").style.size == 38 and ps_text("main_menu", "vn_component_ps_main").style.color == Color("#dbeafe"))',
    '    assert eval (style.vn_page_main_button.hover_sound == "assets/page.wav")',
    '    screenshot "01-title.png"', ...start,
    '    assert eval (renpy.get_widget("say", "what").style.size == 34 and renpy.get_widget("say", "what").style.color == Color("#e3e5f2"))',
    '    assert eval (renpy.get_widget("say", "what").style.font == "fonts/SourceHanSansLite.ttf")', '    screenshot "02-dialogue.png"', '',
    'testcase page_settings_layer_isolation_and_reset:', ...start, ...parent,
    '    assert eval (vn_ui_default("ps_parent", "fontSize") == 32 and vn_ui_default("ps_child", "fontSize") == 38)',
    '    assert eval (vn_ui_get("ps_parent", "textColor") == "#bae6d1" and vn_ui_get("ps_explicit", "textColor") == "#8fd3ff")',
    '    screenshot "03-parent-page.png"', ...child,
    '    assert eval (ps_record(' + q(f.child.id) + ')["inputs"] == ' + py(f.supplied) + ')',
    '    assert eval (ps_text("vn_blueprint_pages", "vn_component_ps_child").style.font == "assets/page.ttf" and ps_text("vn_blueprint_pages", "vn_component_ps_child").style.size == 38)',
    '    assert eval (ps_text("vn_blueprint_pages", "vn_component_ps_explicit").style.size == 18)',
    '    assert eval (vn_ui_get("pi_child_complete", "hoverSound") == "" and vn_ui_hover_overrides["pi_child_complete"] is None)',
    '    assert eval (vn_ui_get("pi_open_child", "hoverSound") == "global_hover" and vn_ui_hover_overrides["pi_open_child"] == "assets/global.wav")',
    '    run Function(vn_ui_set, "ps_child", "fontSize", 46)', '    run Function(vn_ui_set, "ps_child", "textColor", "#ffffff")',
    '    assert eval (vn_ui_get("ps_child", "fontSize") == 46 and vn_ui_default("ps_child", "fontSize") == 38 and vn_ui_get("ps_parent", "fontSize") == 32)',
    '    run Function(vn_ui_reset_property, "ps_child", "fontSize")',
    '    assert eval (vn_ui_get("ps_child", "fontSize") == 38 and vn_ui_get("ps_child", "textColor") == "#ffffff")',
    '    run Function(vn_ui_reset, "ps_child")',
    '    assert eval (ps_text("vn_blueprint_pages", "vn_component_ps_child").style.color == Color("#ffd58a"))',
    '    screenshot "04-child-page.png"', click('pi_child_stage'), click('pi_child_complete'), '    pause until eval (vn_var_resumed_count == 1)',
    '    assert eval (vn_var_result_number == 0 and vn_var_result_flag is False and vn_var_result_text == "" and vn_var_closed_count == 1)',
    '    assert eval (ps_text("vn_blueprint_pages", "vn_component_ps_parent").style.color == Color("#bae6d1"))', ...closeParent, '',
    'testcase page_settings_shared_parameter_and_reopen:', ...start, ...parent, ...child,
    '    assert eval (vn_ui_get("ps_bound", "visible"))', '    $ vn_var_ps_visible = False', '    pause until eval (not vn_ui_get("ps_bound", "visible"))',
    '    assert eval (renpy.get_widget("vn_blueprint_pages", "vn_component_ps_bound") is None)',
    '    $ vn_var_ps_visible = True', '    pause until eval (vn_ui_get("ps_bound", "visible"))',
    '    assert eval (renpy.get_widget("vn_blueprint_pages", "vn_component_ps_bound") is not None)',
    '    run Function(vn_ui_set, "ps_child", "fontSize", 46)', click('pi_child_cancel'), '    pause until eval (vn_var_resumed_count == 1)',
    click('pi_open_child'), '    pause until eval (vn_var_created_count == 2)',
    '    assert eval (vn_ui_get("ps_child", "fontSize") == 38 and vn_var_ps_visible is True)',
    click('pi_child_complete'), '    pause until eval (vn_var_resumed_count == 2)', ...closeParent, '',
    'testcase page_settings_native_confirmation:', ...start,
    '    run Function(renpy.show_screen, "confirm", message="页面消息框默认外观", yes_action=Hide("confirm"), no_action=Hide("confirm"))',
    '    pause until screen "confirm"', '    move pos (4, 4)',
    '    assert eval (ps_text("confirm", "vn_confirm_yes").style.font == "assets/page.ttf" and ps_text("confirm", "vn_confirm_yes").style.size == 20)',
    '    assert eval (ps_text("confirm", "vn_confirm_yes").style.color == Color("#f4dca8") and style.vn_page_messageBox_button.hover_sound is None)',
    '    screenshot "05-confirmation.png"', '    click id "vn_confirm_no" pos (0.5, 0.5)', '    assert not screen "confirm"', '',
    'testcase page_settings_native_chapter:', ...start,
    '    run Function(renpy.show_screen, "vn_chapter_title", title="章节页默认外观", subtitle="独立副标题样式", duration=30, effect="none", _vn_wait=False)',
    '    pause until screen "vn_chapter_title"', '    screenshot "06-chapter.png"',
    '    assert eval (ps_caption("vn_chapter_title", "章节页默认外观").style.font == "assets/page.ttf")',
    '    assert eval (ps_caption("vn_chapter_title", "章节页默认外观").style.size == 32 and ps_caption("vn_chapter_title", "章节页默认外观").style.color == Color("#e1ae71"))',
    '    assert eval (ps_caption("vn_chapter_title", "独立副标题样式").style.size == 20 and ps_caption("vn_chapter_title", "独立副标题样式").style.color == Color("#c7e4eb"))',
    '    run Hide("vn_chapter_title")', '    assert not screen "vn_chapter_title"', '',
    'testcase page_settings_voice_returns_to_settings:', ...start, ...parent, click('pi_open_voicesettings'),
    '    pause until screen "voice_settings"', '    click id "vn_game_menu_return" pos (0.5, 0.5)', '    pause until screen "preferences"',
    '    assert eval (vn_var_resumed_count == 0 and vn_var_closed_count == 1)',
    '    assert eval (ps_text("preferences", "vn_game_menu_return").style.color == Color("#f2d7a0"))',
    click('pi_preferences_complete'), '    pause until eval (vn_var_resumed_count == 1)',
    '    assert eval (vn_var_closed_count == 2 and vn_var_result_reason == "navigated" and vn_var_result_number == -7)', ...closeParent, '',
  ];
  for (const [index, menu] of f.menus.entries()) {
    const kind = menu.pageId.slice(3), theme = uiPageTheme(project, menu.pageId);
    const font = theme.fontAssetId ? 'assets/page.ttf' : 'fonts/SourceHanSansLite.ttf';
    tests.push('testcase page_settings_native_' + kind + ':', ...start, ...parent, click(menu.button.id), '    pause until screen ' + q(menu.screen),
      '    pause until eval (vn_var_focus_count == 1)', '    move pos (4, 4)',
      '    assert eval (ps_record(' + q(menu.pageId) + ')["inputs"] == ' + py(f.supplied) + ')',
      '    assert eval (ps_native_styles(' + [kind, font, theme.fontSize, theme.textColor].map(py).join(', ') + '))',
      '    assert eval (ps_text(' + q(menu.screen) + ', "vn_game_menu_return").style.font == ' + q(font) + ' and ps_text(' + q(menu.screen) + ', "vn_game_menu_return").style.color == Color(' + q(theme.textColor) + '))',
      '    assert eval (vn_ui_default(' + q('ps_' + kind.toLowerCase()) + ', "fontSize") == ' + theme.fontSize + ' and vn_ui_default("ps_parent", "fontSize") == 32)',
      '    assert eval (getattr(style, ' + q('vn_page_' + kind + '_button') + ').hover_sound == ' + py(theme.hoverSoundId ? 'assets/page.wav' : undefined) + ')');
    if (['save', 'preferences', 'staff'].includes(kind)) tests.push('    screenshot ' + q('native-' + kind + '.png'));
    if (index % 2) tests.push(click(menu.prefix + 'stage'), click(menu.prefix + 'complete'), '    pause until eval (vn_var_resumed_count == 1)',
      '    assert eval (vn_var_result_number == 0 and vn_var_result_flag is False and vn_var_result_text == "" and vn_var_result_reason == "completed")');
    else tests.push(kind === 'voiceSettings' ? '    keysym "K_ESCAPE"' : '    click id "vn_game_menu_return" pos (0.5, 0.5)', '    pause until eval (vn_var_resumed_count == 1)',
      '    assert eval (vn_var_result_number == -7 and vn_var_result_flag is True and vn_var_result_reason == "cancelled")');
    tests.push('    assert eval (vn_var_request_count == 1 and vn_var_closed_count == 1)', ...closeParent, '');
  }
  const test = [...probes, ...tests].join('\n');
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), test);
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 360000 };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  const result = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  await check('page-settings', result); report.cases = tests.filter(line => line.startsWith('testcase ')).length;
  assert.match(result.log, new RegExp('Test cases\\s*:\\s*' + report.cases + '\\s*\\|\\s*' + report.cases + ' passed'));
  report.assertions = Number(result.log.match(/Assertions\s*:\s*(\d+)/)?.[1]);
  assert.equal(report.assertions, tests.filter(line => line.startsWith('    assert ')).length); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); console.error(error); process.exitCode = 1; }
finally {
  try {
    for (const [from, to] of [[path.join(source, 'project.vns.json'), 'fixture.project.json'], [path.join(game, 'game/testcases.rpy'), 'testcases.rpy']]) {
      if (await fs.stat(from).then(stat => stat.isFile()).catch(() => false)) await fs.copyFile(from, path.join(output, to));
    }
    for (const directory of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) {
      if (await fs.stat(directory).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(directory, path.join(output, 'screenshots'), { recursive: true });
    }
  } catch (error) { report.status = 'failed'; report.error = [report.error, 'Evidence: ' + String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  try { report.cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves']); assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []); }
  catch (error) { report.status = 'failed'; report.error = [report.error, 'Cleanup: ' + String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  await save(); console.log(path.join(output, 'report.json'));
}
