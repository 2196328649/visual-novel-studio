import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createUiControlPropertyFixture, uiControlPropertyFixturePng } from './lib/ui-control-property-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral as q } from '../src/runtime/literals';

const sdk = process.env.VNS_RENPY_SDK ?? path.resolve('resources/runtime');
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts', 'ui-control-properties-runtime', new Date().toISOString().replaceAll(':', '-'));
const source = path.join(output, 'source'), game = path.join(output, 'game');
const previousSaveRoot = process.env.RENPY_PATH_TO_SAVES;
const report: { status: string; checks: { name: string; code: number; logPath: string }[]; cases?: number; assertions?: number; error?: string; cleanup?: unknown } = { status: 'running', checks: [] };
await fs.mkdir(path.join(source, 'assets'), { recursive: true });
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  const logPath = path.join(output, name + '.log'); await fs.writeFile(logPath, result.log);
  report.checks.push({ name, code: result.code, logPath }); await save();
  if (result.code) throw new Error(name + ': ' + result.log.slice(-9000));
}
try {
  await isolateRenpySaves(output);
  const f = createUiControlPropertyFixture(), original = structuredClone(f.project);
  assert.deepEqual(compileProject(f.project).diagnostics.filter(issue => issue.severity === 'error'), []); assert.deepEqual(f.project, original);
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(f.project, null, 2));
  await fs.writeFile(path.join(source, 'assets/control-track.png'), uiControlPropertyFixturePng());
  const built = await buildProject({ project: f.project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  const start = ['    pause until screen "main_menu"', '    click id "vn_main_start" pos (0.5, 0.5)', '    pause until eval ("control_page" in vn_ui_open_pages)', '    move pos (8, 8)'];
  const first = f.project.nodes.find(node => node.kind === 'passage')!.id;
  const tests = String.raw`default vn_test_control_token = 0

testsuite global:
    before testcase:
        $ _test.timeout = 12.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ persistent.vn_var_control_flag = True
        $ preferences.text_cps = 0
    after testcase:
        if eval not main_menu:
            run MainMenu(confirm=False)
        pause until screen "main_menu"
    teardown:
        exit

testcase temporary_values_reach_real_controls_without_source_writes:
@@START@@
    click id "vn_component_temporary" pos (0.5, 0.5)
    pause 0.1
    assert eval vn_ui_get("slider", "numberValue") == 0
    assert eval vn_var_shared_number == 30
    assert eval vn_ui_get("mirror", "numberValue") == 30
    assert eval abs(vn_ui_get("slider", "normalizedValue") - 0.2) < 0.000001
    assert eval vn_ui_get("input", "stringValue") == ""
    assert eval vn_var_input_name == "原值"
    assert eval vn_ui_get("toggle", "booleanValue") is False and persistent.vn_var_control_flag is True
    assert eval vn_ui_get("choices", "optionIndex") == 1 and vn_var_control_mode == "简单"
    assert eval vn_ui_get("choices", "optionLabel") == "困难"
    assert eval renpy.get_widget("vn_blueprint_pages", "vn_component_input").content == ""
    assert eval abs(renpy.get_widget("vn_blueprint_pages", "vn_component_slider_control").adjustment.value - 0.8) < 0.000001
    assert eval vn_ui_get("slider", "sliderTrackImage") == "control_track"
    assert eval vn_ui_get("input", "placeholder") == "蓝图占位 🦊"
    assert eval vn_var_changed_count == 0 and vn_var_committed_count == 0
    screenshot "temporary-control-properties"
    click id "vn_component_reset" pos (0.5, 0.5)
    pause 0.1
    assert eval vn_ui_get("slider", "numberValue") == 30
    assert eval renpy.get_widget("vn_blueprint_pages", "vn_component_input").content == "原值"
    assert eval vn_ui_get("choices", "optionIndex") == 0
    assert eval vn_ui_get("slider", "sliderTrackImage") == "control_track"
    assert eval vn_var_changed_count == 0 and vn_var_committed_count == 0

testcase program_source_and_alias_reset:
@@START@@
    click id "vn_component_temporary" pos (0.5, 0.5)
    click id "vn_component_source" pos (0.5, 0.5)
    pause until eval vn_var_read_number == 60
    assert eval vn_ui_get("slider", "numberValue") == 60 and vn_ui_get("mirror", "numberValue") == 60 and vn_var_shared_number == 60
    assert eval vn_var_read_ratio == 0.8 and vn_var_read_min == -20 and vn_var_read_max == 80 and vn_var_read_step == 5
    assert eval vn_var_read_index == 2 and vn_var_read_count == 3 and vn_var_read_label == "旁观"
    assert eval vn_var_read_default == "原值" and vn_var_input_name == "源🦊"
    assert eval persistent.vn_var_control_flag is False
    assert eval renpy.get_widget("vn_blueprint_pages", "vn_component_input").content == "源🦊"
    click id "vn_component_reset" pos (0.5, 0.5)
    assert eval vn_ui_get("slider", "numberValue") == 60 and vn_var_control_mode == "旁观"
    assert eval vn_var_changed_count == 0 and vn_var_committed_count == 0
    screenshot "source-values-and-style"

testcase real_user_input_and_focus:
@@START@@
    click id "vn_component_temporary" pos (0.5, 0.5)
    click id "vn_component_input_edit" pos (0.5, 0.5)
    assert eval vn_ui_get("input", "focused") is True
    type "ABCD" id "vn_component_input"
    assert eval vn_var_input_name == "ABCD" and vn_var_changed_count == 4
    type "E" id "vn_component_input"
    assert eval vn_var_input_name == "ABCD" and vn_var_changed_count == 4
    keysym "K_RETURN" id "vn_component_input"
    assert eval vn_var_committed_count == 1 and vn_ui_get("input", "focused") is False
    click id "vn_component_slider_control" pos (0.8, 0.5)
    assert eval vn_ui_get("slider", "numberValue") == vn_var_shared_number and vn_ui_get("mirror", "numberValue") == vn_var_shared_number
    assert eval vn_var_changed_count == 5
    click id "vn_component_choices_option_2"
    assert eval vn_var_control_mode == "旁观" and vn_ui_get("choices", "optionIndex") == 2
    assert eval vn_var_changed_count == 6
    click id "vn_component_choices_option_2"
    assert eval vn_var_changed_count == 6
    screenshot "user-input-controls"

testcase readonly_save_load_and_reopen:
@@START@@
    click id "vn_component_temporary" pos (0.5, 0.5)
    click id "vn_component_lock" pos (0.5, 0.5)
    assert eval vn_ui_get("input", "readOnly") is True
    click id "vn_component_slider_control" pos (0.9, 0.5)
    click id "vn_component_toggle_toggle"
    click id "vn_component_input_edit"
    assert eval vn_ui_get("input", "focused") is False
    assert eval vn_var_shared_number == 30 and persistent.vn_var_control_flag is True and vn_var_changed_count == 0
    $ vn_test_control_token = vn_ui_page_token("control_page")
    $ renpy.save("control-property-checkpoint")
    click id "vn_component_source" pos (0.5, 0.5)
    assert eval vn_var_shared_number == 60 and vn_var_input_name == "源🦊" and vn_var_changed_count == 0
    run FileLoad("control-property-checkpoint", confirm=False, slot=True)
    pause until eval vn_var_shared_number == 30
    assert eval vn_ui_get("slider", "numberValue") == 0 and vn_ui_get("input", "readOnly") is True
    assert eval vn_ui_page_token("control_page") == vn_test_control_token
    assert eval vn_ui_get("input", "focused") is False
    assert eval persistent.vn_var_control_flag is False
    click id "vn_component_close" pos (0.5, 0.5)
    pause until "控件属性页面已关闭。"
    assert eval not vn_ui_open_pages and not vn_ui_page_order
    assert eval "slider" not in vn_ui_overrides
    run Jump(@@FIRST@@)
    pause until eval "control_page" in vn_ui_open_pages
    assert eval vn_ui_page_token("control_page") != vn_test_control_token
    assert eval vn_ui_get("slider", "numberValue") == 30 and vn_ui_get("input", "stringValue") == "原值"
    assert eval vn_ui_get("input", "readOnly") is False and vn_ui_get("input", "maxLength") == 6
    assert eval vn_ui_get("slider", "sliderTrackImage") == ""
    assert eval vn_ui_get("toggle", "booleanValue") is False
`.replaceAll('@@START@@', start.join('\n')).replaceAll('@@FIRST@@', q('vn_node_' + first));
  await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 180000 };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  const native = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  await check('runtime', native); report.cases = (tests.match(/^testcase /gm) ?? []).length;
  assert.match(native.log, new RegExp('Test cases\\s*:\\s*' + report.cases + '\\s*\\|\\s*' + report.cases + ' passed'));
  report.assertions = Number(native.log.match(/Assertions\s*:\s*(\d+)/)?.[1]);
  assert.equal(report.assertions, (tests.match(/^    assert /gm) ?? []).length);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); process.exitCode = 1; }
finally {
  try {
    for (const directory of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) {
      if (await fs.stat(directory).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(directory, path.join(output, 'screenshots'), { recursive: true });
    }
  } catch (error) { report.status = 'failed'; report.error = [report.error, 'Screenshot preservation failed: ' + String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  // Preservation failures must never bypass fixture cleanup.
  try {
    report.cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves', 'renpy-saves']);
    if ((report.cleanup as { errors: unknown[] }).errors.length) throw new Error('Verification cleanup failed.');
  } catch (error) { report.status = 'failed'; report.error = [report.error, String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  if (previousSaveRoot === undefined) delete process.env.RENPY_PATH_TO_SAVES; else process.env.RENPY_PATH_TO_SAVES = previousSaveRoot;
  await save(); console.log(path.join(output, 'report.json')); if (report.error) console.error(report.error);
}
