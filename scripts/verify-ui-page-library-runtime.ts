import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, type UiComponent } from '../src/core/model';
import { uiMenuShortcutScreen } from '../src/core/ui-availability';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral as py } from '../src/runtime/literals';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Use isolated development games.');
const sdk = process.env.VNS_RENPY_SDK ?? path.resolve('resources/runtime');
const output = path.resolve('artifacts/ui-page-library-runtime', new Date().toISOString().replaceAll(':', '-'));
const report: { status: string; runs: unknown[]; checks: unknown[]; error?: string } = { status: 'running', runs: [], checks: [] };
await fs.mkdir(output, { recursive: true });
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }, count?: number) {
  await fs.writeFile(path.join(output, name + '.log'), result.log); report.checks.push({ name, code: result.code, count }); await save();
  assert.equal(result.code, 0, name + ': ' + result.log.slice(-10000));
  if (count !== undefined) assert.match(result.log, new RegExp('Test cases\\s*:\\s*' + count + '\\s*\\|\\s*' + count + ' passed'));
}
try {
  for (const mode of ['settings_fallback', 'pause_fallback', 'no_menu'] as const) {
    const run = path.join(output, mode), work = path.join(run, 'work'), source = path.join(work, 'source'), game = path.join(work, 'game');
    await fs.mkdir(source, { recursive: true });
    try {
      const p = createProject('内置页面停用验收'); p.id = 'page_library_' + mode;
      p.assets = []; p.characters = []; p.blueprints = []; p.timelinePresets = [];
      const passage = p.nodes.find(node => node.kind === 'passage')!;
      p.nodes = [passage, p.nodes.find(node => node.kind === 'end')!]; p.entryId = passage.id;
      passage.lines = [{ id: 'library_anchor', text: '停用页面验收锚点。', actions: [] }];
      p.ui.components = []; p.ui.pages = {};
      const control = (id: string, page: UiComponent['page'], kind: UiComponent['kind'] = 'text'): UiComponent => ({ id, page, kind, text: '原控件', x: .1, y: .1, width: .6, height: .2 });
      p.ui.components.push({ ...control('library_obsolete', 'main', 'button'), action: 'gallery', text: '停用目标按钮', x: .76, y: .8, width: .21, height: .08 }, { ...control('library_pause', 'pause', 'pauseMenu'), x: .2, y: .25, width: .6, height: .6 });
      p.ui.pages.pause = { layout: 'custom' };
      // Disabled authored hosts must still provide Ren'Py's mandatory widgets.
      for (const page of ['say', 'choice', 'messageBox', 'keyboard', 'chapterTitle'] as const) p.ui.pages[page] = { layout: 'custom' };
      p.ui.components.push({ ...control('library_say', 'say'), binding: 'dialogue' }, control('library_choice', 'choice', 'choiceList'), { ...control('library_confirmation', 'messageBox'), binding: 'confirmation' });
      p.ui.disabledPages = ['gallery', 'musicRoom', 'say', 'choice', 'messageBox', 'keyboard', 'chapterTitle', 'save', ...(mode === 'settings_fallback' ? ['voiceSettings'] as const : ['preferences'] as const), ...(mode === 'no_menu' ? ['pause'] as const : [])];
      p.ui.menuShortcutPage = 'save';
      const shortcut = uiMenuShortcutScreen(p.ui);
      assert.equal(shortcut, mode === 'settings_fallback' ? 'preferences' : mode === 'pause_fallback' ? 'pause_menu' : undefined);
      const compiled = compileProject(p);
      assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
      await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(p));
      await fs.writeFile(path.join(run, 'fixture.project.json'), JSON.stringify(p, null, 2));
      const built = await buildProject({ project: p, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
      await check(mode + '-build', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
      const start = ['    pause until screen "main_menu"', '    run Start()', '    pause until "停用页面验收锚点。"'];
      const tests: string[] = [
        'testsuite global:', '    before testcase:', '        $ _test.timeout = 18.0', '        $ _test.transition_timeout = 0.05',
        '        $ _test.screenshot_directory = "tests/screenshots"', '        $ preferences.text_cps = 0',
        '    after testcase:', '        if eval not main_menu:', '            run MainMenu(confirm=False)', '        pause until screen "main_menu"', '    teardown:', '        exit', '',
        'init python:',
        '    def library_captions(screen):',
        '        displayable = renpy.get_screen(screen)',
        '        pending = [displayable] if displayable else []',
        '        seen, captions = set(), []',
        '        while pending:',
        '            current = pending.pop()',
        '            if id(current) in seen: continue',
        '            seen.add(id(current))',
        '            if isinstance(current, renpy.text.text.Text): captions.append("".join(part for part in current.text if isinstance(part, str)))',
        '            if hasattr(current, "visit"): pending.extend(child for child in current.visit() if child is not None)',
        '        return captions', '',
        'label library_legacy_screen:', '    call screen library_legacy_screen_ui', '    return', '',
        'screen library_legacy_screen_ui():', '    tag menu', '    textbutton "关闭兼容菜单" action Return()', '',
        'label library_input:', '    $ library_answer = renpy.input("请输入验收文字", default="", length=4)', '    "输入结果已接收。"', '    return', '',
        'label library_choice:', '    menu:', '        "继续验收":', '            "选项已返回。"', '    return', '',
        'testcase library_native_targets:', '    pause until screen "main_menu"',
        '    assert eval (not renpy.has_screen("save") and not renpy.has_screen("load") and not renpy.has_screen("gallery") and not renpy.has_screen("music_room"))',
        '    assert eval (not VnUiMenu("gallery").get_sensitive() and not VnUiMenu("missing_screen").get_sensitive())',
        '    assert eval (not renpy.get_widget("main_menu", "vn_component_library_obsolete").is_sensitive())',
        '    assert eval ("读取存档" not in library_captions("main_menu") and "画廊" not in library_captions("main_menu"))',
        '    $ VnUiMenu("gallery")()', '    assert screen "main_menu"', '    screenshot "title-disabled.png"', '',
        'testcase library_escape_fallback:', ...start,
        '    assert eval (_game_menu_screen == ' + py(shortcut ?? null) + ')',
        '    assert eval (VnUiMenu().get_sensitive() == ' + py(!!shortcut) + ')',
      ];
      if (shortcut) tests.push('    keysym "K_ESCAPE"', '    pause until screen ' + py(shortcut), '    screenshot "shortcut.png"', '    keysym "K_ESCAPE"', '    pause until "停用页面验收锚点。"',
        '    run VnUiMenu()', '    pause until screen ' + py(shortcut), '    keysym "K_ESCAPE"', '    pause until "停用页面验收锚点。"');
      else tests.push('    $ VnUiMenu()()', '    keysym "K_ESCAPE"', '    assert screen "say"',
        '    assert eval (not renpy.has_screen("save") and not renpy.has_screen("preferences") and not renpy.has_screen("pause_menu"))',
        '    assert eval (not renpy.context()._menu and renpy.get_screen("menu") is None)');
      tests.push('', 'testcase library_disabled_confirm_and_dialogue:', ...start,
        '    assert eval (renpy.get_widget("say", "what") is not None)',
        '    run Confirm("停用自制界面后的确认框", NullAction(), NullAction())', '    pause until screen "confirm"',
        '    assert eval (renpy.get_widget("confirm", "vn_confirm_yes") is not None and renpy.get_widget("confirm", "vn_confirm_no") is not None)',
        '    screenshot "confirmation-fallback.png"', '    click id "vn_confirm_no" pos (0.5, 0.5)', '    assert not screen "confirm"', '    pause until "停用页面验收锚点。"', '',
        'testcase library_disabled_choice_and_input:', ...start, '    run Jump("library_choice")', '    pause until screen "choice"',
        '    click "继续验收"', '    pause until "选项已返回。"', '    run Jump("library_input")', '    pause until screen "input"',
        '    type "ok" id "input"', '    keysym "K_RETURN"', '    pause until "输入结果已接收。"', '    assert eval (library_answer == "ok")', '',
        'testcase library_disabled_legacy_chapter:', ...start,
        '    run Function(renpy.show_screen, "vn_chapter_title", title="兼容章节文字", duration=30, effect="none", _vn_wait=False)',
        '    pause until screen "vn_chapter_title"', '    assert eval ("兼容章节文字" in library_captions("vn_chapter_title"))',
        '    run Hide("vn_chapter_title")', '    assert not screen "vn_chapter_title"', '',
        'testcase library_menu_suffix_compatibility:', ...start, '    assert eval (VnUiMenu("library_legacy").get_sensitive())',
        '    run VnUiMenu("library_legacy")', '    pause until screen "library_legacy_screen_ui"', '    click "关闭兼容菜单"', '    pause until "停用页面验收锚点。"', '');
      if (mode !== 'no_menu') tests.push('testcase library_pause_widget:', ...start, '    run VnUiMenu("pause_menu")', '    pause until screen "pause_menu"',
        '    assert eval ("保存进度" not in library_captions("pause_menu") and "读取存档" not in library_captions("pause_menu"))',
        '    assert eval (("设置" in library_captions("pause_menu")) == ' + py(mode === 'settings_fallback') + ')',
        '    assert eval ("继续游戏" in library_captions("pause_menu"))', '    screenshot "pause-widget.png"',
        '    click "继续游戏"', '    pause until "停用页面验收锚点。"', '');
      if (mode !== 'settings_fallback') tests.push('testcase library_voice_back_without_settings:', ...start,
        '    run VnUiMenu("voice_settings")', '    pause until screen "voice_settings"',
        '    assert eval ("返回设置" not in library_captions("voice_settings"))',
        '    click id "vn_game_menu_return" pos (0.5, 0.5)', '    pause until "停用页面验收锚点。"', '');
      const sourceText = tests.join('\n'), count = tests.filter(line => line.startsWith('testcase ')).length;
      await fs.writeFile(path.join(run, 'testcases.rpy'), sourceText); await fs.writeFile(path.join(game, 'game/testcases.rpy'), sourceText);
      const options = { savedir: path.join(work, 'saves'), timeoutMs: 300000 };
      await check(mode + '-lint', await runRenpy(sdk, game, ['lint'], options));
      await check(mode + '-test', await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) }), count);
      report.runs.push({ mode, shortcut: shortcut ?? null, cases: count, assertions: tests.filter(line => line.trimStart().startsWith('assert ')).length });
    } finally {
      for (const directory of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) if (await fs.stat(directory).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(directory, path.join(run, 'screenshots'), { recursive: true });
      for (const file of ['errors.txt', 'traceback.txt', 'log.txt']) if (await fs.stat(path.join(game, file)).then(stat => stat.isFile()).catch(() => false)) await fs.copyFile(path.join(game, file), path.join(run, file));
      const cleanup = await cleanVerificationDirectories(run, ['work']); assert.deepEqual(cleanup.errors, []);
    }
  }
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); console.error(error); process.exitCode = 1; }
finally { await save(); console.log(path.join(output, 'report.json')); }
