import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve('.');
const template = path.join(root, 'resources/templates/aihong');
const sdk = path.join(root, 'resources/runtime');
const output = path.join(root, 'artifacts/ui-fidelity-1.3.0', new Date().toISOString().replaceAll(':', '-'));
const build = path.join(output, 'game');
const report: { status: string; steps: { name: string; code: number }[]; screenshots?: string[]; error?: string } = { status: 'running', steps: [] };
await fs.mkdir(output, { recursive: true });
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function step(name: string, result: { code: number; log: string }) {
  await fs.writeFile(path.join(output, name + '.log'), result.log);
  report.steps.push({ name, code: result.code }); await save();
  assert.equal(result.code, 0, result.log.slice(-7000));
  console.log(name + ': PASS');
}
try {
  const project = projectSchema.parse(JSON.parse(await fs.readFile(path.join(template, 'project.vns.json'), 'utf8')));
  project.id = 'fidelity_' + Date.now();
  project.playerDefaults = { ...project.playerDefaults, fullscreen: false, windowSize: '1280x720' };
  const opening = project.nodes.find(n => n.id === 'opening');
  assert.ok(opening?.kind === 'passage');
  assert.ok(opening.lines.length > 2);
  const target = opening.lines[Math.min(3, opening.lines.length - 1)];
  const result = await buildProject({ project, projectDir: template, sdkRoot: sdk, outputDir: build, development: true });
  await step('compile', { code: result.ok ? 0 : 1, log: result.log + JSON.stringify(result.diagnostics) });
  await fs.writeFile(path.join(build, 'game/testcases.rpy'), `define _test.timeout = 25.0

testsuite global:
    before testcase:
        $ _test.timeout = 25.0
        $ _test.transition_timeout = 0.1
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
    teardown:
        exit

testcase settings_and_dialogue:
    assert screen "main_menu"
    click id "vn_component_ai_title_settings"
    assert screen "preferences"
    move pos (5, 5)
    screenshot "01-settings-window.png"
    click id "vn_component_ai_settings_resolution_choice"
    assert screen "vn_preference_popup"
    screenshot "02-resolutions.png"
    keysym "K_ESCAPE"
    assert eval vn_preference_get("dialogueOpacity") == 1
    assert eval VnPreferenceValue("dialogueOpacity", reverse=True).get_adjustment().value == 0
    assert eval VnPreferenceValue("autoForwardTime", reverse=True).get_adjustment().value == 30 - vn_preference_get("autoForwardTime")
    click id "vn_component_ai_settings_buttonback"
    click id "vn_component_ai_title_start"
    advance until ${JSON.stringify(target.text)}
    keysym "K_ESCAPE"
    assert screen "preferences"
    screenshot "03-escape-settings.png"
    keysym "K_ESCAPE"
    assert screen "say"
    assert ${JSON.stringify(target.text)}
    move id "vn_component_ai_dialogue_plotmap"
    pause 0.25
    assert eval GetTooltip() == "流程图(A)"
    assert eval renpy.get_widget("say", "vn_component_ai_dialogue_tooltip") is not None
    screenshot "03-dialogue-tooltip.png"
    keysym "K_a"
    assert screen "flowchart"
    click id "vn_component_ai_flowchart_back"
    assert screen "say"
    move id "vn_component_ai_dialogue_save"
    pause 0.1
    assert eval GetTooltip() == "保存进度"
    move id "vn_component_ai_dialogue_load"
    pause 0.1
    assert eval GetTooltip() == "读取存档"
    move id "vn_component_ai_dialogue_auto"
    pause 0.1
    assert eval GetTooltip() == "自动播放"
    move id "vn_component_ai_dialogue_skip"
    pause 0.1
    assert eval GetTooltip() == "跳过"
    move id "vn_component_ai_dialogue_history"
    pause 0.1
    assert eval GetTooltip() == "对话历史"
    move id "vn_component_ai_dialogue_config"
    pause 0.1
    assert eval GetTooltip() == "设置"
    move id "vn_component_ai_dialogue_hideui"
    pause 0.1
    assert eval GetTooltip() == "隐藏界面"

testcase save_load_and_choices:
    run Function(renpy.force_autosave, take_screenshot=True, block=True)
    click id "vn_component_ai_dialogue_save"
    run FilePage("1")
    assert screen "save"
    assert eval renpy.get_widget("save", "vn_file_slot_auto") is not None
    assert eval not isinstance(renpy.get_widget("save", "vn_file_slot_auto").action, FileSave)
    click id "vn_file_slot_1_action"
    pause until eval renpy.can_load("1-1")
    assert eval ${JSON.stringify(target.text)} in FileJson(1, "vn_ui_excerpt")
    assert eval ${JSON.stringify(opening.lines[1].text)} in FileJson(1, "vn_ui_excerpt")
    assert eval "\\n\\n" in FileJson(1, "vn_ui_excerpt")
    move pos (5, 5)
    screenshot "04-save.png"
    click id "vn_file_page_11"
    assert eval FileCurrentPage() == "11"
    click id "vn_file_slot_4_action"
    pause until eval renpy.can_load("11-4")
    assert eval FileJson(4, "vn_ui_excerpt", page="11") == FileJson(1, "vn_ui_excerpt", page="1")
    click id "vn_file_page_1"
    click id "vn_component_ai_save_back"
    assert screen "say"
    run Function(vn_preference_set, "musicVolume", 0.33)
    click id "vn_component_ai_dialogue_load"
    assert screen "load"
    assert eval FileLoadable(1, page="auto")
    move pos (5, 5)
    screenshot "05-load.png"
    click id "vn_file_slot_1_action"
    if screen "confirm":
        click id "vn_component_ai_confirm_yes"
    pause until screen "say"
    assert eval abs(vn_preference_get("musicVolume") - 0.33) < 0.001
    advance until screen "choice"
    assert eval renpy.get_widget("choice", "vn_component_ai_story_choices_choice_0").vn_bounds == (960, 82)
    move pos (5, 5)
    screenshot "06-choices.png"
    click id "vn_component_ai_story_choices_choice_0"
    pause until not screen "choice"
    run MainMenu(confirm=False)
    assert screen "main_menu"
`);
  await step('lint', await runRenpy(sdk, build, ['lint']));
  await step('runtime', await runRenpy(sdk, build, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 160_000 }));
  const screenshots = path.join(build, 'tests/screenshots');
  report.screenshots = (await fs.readdir(screenshots)).filter(f => f.endsWith('.png')).map(f => path.join(screenshots, f));
  report.status = 'passed'; await save(); console.log('REPORT ' + path.join(output, 'report.json'));
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error);
  await save(); console.error(report.error); process.exitCode = 1;
}
