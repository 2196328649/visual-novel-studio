import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadProject } from '../src/desktop/project-store';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve('.'), sdk = path.join(root, 'resources/runtime');
const output = path.join(root, 'artifacts/confirm-localization', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const results: unknown[] = [];
for (const fixture of ['example', 'templates/aihong']) {
  const source = path.join(root, 'resources', fixture), custom = fixture.includes('aihong');
  const project = (await loadProject(path.join(source, 'project.vns.json'))).project;
  const game = path.join(output, custom ? 'custom' : 'default');
  assert.equal((await buildProject({ project, projectDir: source, outputDir: game, sdkRoot: sdk })).ok, true);
  if (process.argv.includes('--baseline') && !custom) {
    await fs.copyFile(path.join(root, 'artifacts/confirm-localization/2026-09-29T03-42-38.163Z/default/game/screens.rpy'), path.join(game, 'game/screens.rpy'));
  }
  const yes = custom ? 'id "vn_component_ai_confirm_yes"' : '"确认"';
  const no = custom ? 'id "vn_component_ai_confirm_no"' : '"取消"';
  const messageComponent = project.ui.components?.find(c => c.binding === 'confirmation');
  const messageWidth = Math.round((messageComponent?.width ?? 1) * project.width);
  const messageHeight = Math.round((messageComponent?.height ?? 1) * project.height);
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
define config.savedir = ${JSON.stringify(path.join(game, 'saves').replaceAll('\\', '/'))}
init python:
    def qa_confirm_texts():
        texts = []
        renpy.get_screen("confirm").visit_all(lambda d: texts.append(d.get_all_text()) if isinstance(d, renpy.text.text.Text) else None)
        return texts

    def qa_confirm_fits():
        if not ${custom ? 'True' : 'False'}:
            return True
        message = renpy.get_screen("confirm").scope["message"]
        texts = []
        renpy.get_screen("confirm").visit_all(lambda d: texts.append(d) if isinstance(d, renpy.text.text.Text) and d.get_all_text() == message else None)
        if len(texts) != 1:
            return False
        width, height = renpy.render(texts[0], ${messageWidth}, 32768, 0, 0).get_size()
        with open(config.basedir + "/geometry.jsonl", "a", encoding="utf8") as report:
            report.write(__import__("json").dumps(dict(message=message, width=width, height=height, available_width=${messageWidth}, available_height=${messageHeight}), ensure_ascii=False) + "\\n")
        return width == ${messageWidth} and height <= ${messageHeight}

testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.set_mute("music", True)
    teardown:
        exit

testcase chinese_confirmations:
    assert screen "main_menu"
    click id ${JSON.stringify(custom ? 'vn_component_ai_title_start' : 'vn_main_start')}
    pause until screen "say"
    run FileSave("localized", confirm=False, slot=True)
    assert eval renpy.can_load("localized")
    run FileSave("localized", confirm=True, slot=True)
    assert screen "confirm"
    pause 0.2
    $ open(config.basedir + "/prompt.json", "w", encoding="utf8").write(__import__("json").dumps({"message": renpy.get_screen("confirm").scope.get("message"), "layout": layout.OVERWRITE_SAVE, "gui": gui.OVERWRITE_SAVE}, ensure_ascii=False))
    screenshot "01-overwrite.png"
    assert eval "确认覆盖这个存档吗？" in qa_confirm_texts()
    assert eval qa_confirm_fits()
    click ${no}
    assert screen "say"
    run FileLoad("localized", confirm=True, slot=True)
    assert screen "confirm"
    assert eval "读取存档后，尚未保存的进度将丢失。确认读取吗？" in qa_confirm_texts()
    assert eval qa_confirm_fits()
    screenshot "02-load.png"
    click ${no}
    assert screen "say"
    run FileLoad("localized", confirm=True, slot=True)
    click ${yes}
    pause until screen "say"
    assert screen "say"
    run FileDelete("localized", confirm=True, slot=True)
    assert screen "confirm"
    assert eval "确认删除这个存档吗？" in qa_confirm_texts()
    assert eval qa_confirm_fits()
    screenshot "03-delete.png"
    click ${no}
    assert eval renpy.can_load("localized")
    run MainMenu(confirm=True)
    assert screen "confirm"
    assert eval "返回标题后，尚未保存的进度将丢失。确认返回吗？" in qa_confirm_texts()
    assert eval qa_confirm_fits()
    screenshot "04-main-menu.png"
    click ${no}
    assert screen "say"
    run Quit(confirm=True)
    assert screen "confirm"
    assert eval "确认退出游戏吗？" in qa_confirm_texts()
    assert eval qa_confirm_fits()
    screenshot "05-quit.png"
    click ${no}
    assert screen "say"
${custom ? `    run Confirm("请阅读这段较长的确认提示。" * 30 + "这是最后一句。", NullAction())
    assert screen "confirm"
    assert id "vn_component_ai_confirm_message_scroll"
    $ vp = renpy.get_widget("confirm", "vn_component_ai_confirm_message_viewport")
    assert eval vp.yadjustment.range > 0
    screenshot "06-long-before.png"
    drag id "vn_component_ai_confirm_message_scroll" pos (0.5, 0.02) to id "vn_component_ai_confirm_message_scroll" pos (0.5, 0.99) steps 20
    pause 0.1
    assert eval vp.yadjustment.value == vp.yadjustment.range
    screenshot "07-long-end.png"
    click ${no}
    assert screen "say"
` : ''}
    run MainMenu(confirm=False)
    assert screen "main_menu"
`);
  const run = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(game, 'saves') });
  await fs.writeFile(path.join(game, 'run.log'), run.log);
  results.push({ fixture, code: run.code, game });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: run.code === 0 ? 'running' : 'failed', results }, null, 2));
  console.log(fixture, run.log.slice(-3000));
  assert.equal(run.code, 0);
}
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', results }, null, 2));
console.log('REPORT ' + path.join(output, 'report.json'));
