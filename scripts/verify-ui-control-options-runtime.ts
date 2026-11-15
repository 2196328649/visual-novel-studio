import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createUiControlOptionsFixture } from './lib/ui-control-options-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';

const sdk = process.env.VNS_RENPY_SDK ?? path.resolve('resources/runtime');
const output = path.resolve('artifacts/ui-control-options-runtime', new Date().toISOString().replaceAll(':', '-'));
const source = path.join(output, 'source'), game = path.join(output, 'game');
const report: { status: string; checks: { name: string; code: number; logPath: string }[]; cases?: number; assertions?: number; error?: string; cleanup?: unknown } = { status: 'running', checks: [] };
await fs.mkdir(path.join(source, 'assets'), { recursive: true });
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  const logPath = path.join(output, name + '.log'); await fs.writeFile(logPath, result.log);
  report.checks.push({ name, code: result.code, logPath }); await save();
  if (result.code) throw new Error(name + ': ' + result.log.slice(-9000));
}
try {
  const f = createUiControlOptionsFixture(), original = structuredClone(f.project);
  assert.deepEqual(compileProject(f.project).diagnostics.filter(issue => issue.severity === 'error'), []); assert.deepEqual(f.project, original);
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(f.project, null, 2));
  const built = await buildProject({ project: f.project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  const start = ['    pause until screen "main_menu"', '    click id "vn_main_start" pos (0.5, 0.5)', '    pause until eval ("options_page" in vn_ui_open_pages)', '    move pos (8, 8)'];
  const tests = String.raw`default vn_test_option_action = None
default vn_test_option_token = None

init python:
    def vn_test_options_reject(component_id, operation, **arguments):
        before = __import__("copy").deepcopy(vn_ui_control_option_overrides)
        source = vn_ui_control_source(component_id)
        try:
            vn_ui_control_edit_options(component_id, operation, **arguments)
        except Exception:
            return before == vn_ui_control_option_overrides and source == vn_ui_control_source(component_id)
        return False

    def vn_test_options_limits():
        for i in range(254):
            vn_ui_control_edit_options("choice", "insert", index=i + 2, label=str(i), value=str(i))
        full = vn_test_options_reject("choice", "insert", index=256, label="超额", value="超额")
        vn_ui_control_edit_options("choice", "remove", index=255)
        vn_ui_control_edit_options("choice", "insert", index=255, label="😀" * 2000, value="")
        unicode = vn_ui_control_option("choice", 255, "string")["value"] == ""
        invalid = vn_test_options_reject("choice", "replace", index=0, label="😀" * 2001, value="无效")
        vn_ui_control_edit_options("choice", "reset")
        return full and unicode and invalid

    def vn_test_unknown_options():
        original = dict(vn_ui_control_option_overrides.get("choice", {}))
        vn_ui_control_option_overrides["choice"] = {"version": 99, "payload": ["保留", False, 0]}
        try:
            vn_ui_control_options("choice")
        except Exception:
            vn_ui_control_edit_options("choice", "reset")
            return vn_ui_control_option_recovery["choice"] == {"version": 99, "payload": ["保留", False, 0]} and vn_ui_get("choice", "optionCount") == 2
        return False

testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
    after testcase:
        if eval not main_menu:
            run MainMenu(confirm=False)
        pause until screen "main_menu"
    teardown:
        exit

testcase current_list_properties_and_typed_read:
@@START@@
    click id "vn_component_option_act_append"
    click id "vn_component_option_act_rename"
    click id "vn_component_option_act_move"
    click id "vn_component_option_act_observe"
    assert eval (vn_var_observed_count, vn_var_observed_index, vn_var_observed_label) == (3, 1, "初始改名")
    assert eval (vn_var_read_found, vn_var_read_label, vn_var_read_value) == (True, "另一个", "另一个")
    assert eval vn_var_choice_source == "初始" and vn_var_changed_count == 0
    assert eval vn_ui_get("mirror", "optionCount") == 2
    screenshot "dynamic-option-order-and-labels"

testcase actual_parameter_choice_writes_source_once_and_invalidates_old_list_actions:
@@START@@
    click id "vn_component_option_act_append"
    $ vn_test_option_action = VnSelectControlOption("choice", 1, vn_ui_control_options_key("choice"), vn_bp_task_create("options_page"))
    click id "vn_component_choice_option_2"
    assert eval vn_var_choice_source == "动态" and vn_ui_get("mirror", "stringValue") == "动态"
    assert eval vn_var_changed_count == 1 and vn_ui_get("mirror", "optionIndex") == -1
    click id "vn_component_option_act_move"
    $ vn_test_option_action()
    assert eval vn_var_choice_source == "动态" and vn_var_changed_count == 1
    assert eval not vn_test_option_action.get_sensitive()

testcase three_scalar_kinds_and_real_native_popup:
@@START@@
    $ vn_ui_control_edit_options("choice", "insert", index=0, label="显式空", value="", value_type="string")
    click id "vn_component_choice_option_0"
    assert eval vn_var_choice_source == "" and vn_var_changed_count == 1
    click id "vn_component_option_act_native"
    pause until screen "preferences"
    $ vn_ui_control_edit_options("boolean_choice", "insert", index=0, label="显式否", value=False, value_type="boolean")
    $ vn_ui_control_edit_options("number_choice", "replace", index=0, label="显式零", value=0, value_type="number")
    assert eval vn_ui_control_option("boolean_choice", 0, "boolean") == {"found": True, "label": "显式否", "value": False}
    assert eval vn_ui_control_option("number_choice", 0, "number") == {"found": True, "label": "显式零", "value": 0}
    click id "vn_component_number_choice_choice"
    pause until screen "vn_preference_popup"
    screenshot "numeric-option-popup"
    click id "vn_preference_option_0"
    pause until not screen "vn_preference_popup"
    assert eval vn_preference_get("musicVolume") == 0 and vn_var_changed_count == 2
    click id "vn_component_boolean_choice_choice"
    pause until screen "vn_preference_popup"
    click id "vn_preference_option_2"
    assert eval vn_preference_get("skipAll") and vn_var_changed_count == 3

testcase clear_remove_and_resets_never_select_or_write_source:
@@START@@
    click id "vn_component_option_act_append"
    click id "vn_component_option_act_override"
    click id "vn_component_option_act_clear"
    assert eval vn_ui_get("choice", "stringValue") == "动态" and vn_var_choice_source == "初始"
    assert eval vn_ui_get("choice", "optionCount") == 0 and vn_ui_get("choice", "optionIndex") == -1
    assert eval not vn_ui_controls["choice"]["textInput"]
    assert eval vn_ui_control_option("choice", 0, "string") == {"found": False, "label": "", "value": ""}
    click id "vn_component_option_act_reset"
    assert eval vn_ui_get("choice", "stringValue") == "动态" and vn_ui_get("choice", "optionIndex") == -1
    click id "vn_component_option_act_whole"
    assert eval vn_ui_get("choice", "stringValue") == "初始" and vn_ui_get("choice", "optionIndex") == 0
    click id "vn_component_option_act_remove"
    assert eval vn_ui_get("choice", "stringValue") == "初始" and vn_ui_get("choice", "optionIndex") == -1
    assert eval vn_var_changed_count == 0
    screenshot "removed-current-value-retained"

testcase atomic_rejections_unicode_limit_and_unknown_record_recovery:
@@START@@
    $ vn_test_assert_result = vn_test_options_reject("choice", "insert", index=9, label="错", value="错")
    assert eval vn_test_assert_result
    $ vn_test_assert_result = vn_test_options_reject("choice", "replace", index=0, label="", value="错")
    assert eval vn_test_assert_result
    $ vn_test_assert_result = vn_test_options_reject("choice", "insert", index=0, label="错", value=False, value_type="boolean")
    assert eval vn_test_assert_result
    $ vn_test_assert_result = vn_test_options_reject("choice", "move", index=0, to_index=2)
    assert eval vn_test_assert_result
    $ vn_test_assert_result = vn_test_options_reject("choice", "remove", index=float("nan"))
    assert eval vn_test_assert_result
    $ vn_test_assert_result = vn_test_options_reject("choice", "clear", version=True)
    assert eval vn_test_assert_result
    click id "vn_component_option_act_native"
    pause until screen "preferences"
    $ vn_test_assert_result = vn_test_options_reject("number_choice", "insert", index=0, label="超界", value=2, value_type="number")
    assert eval vn_test_assert_result
    $ vn_test_assert_result = vn_test_options_reject("boolean_choice", "insert", index=0, label="错类型", value=0, value_type="boolean")
    assert eval vn_test_assert_result
    click id "vn_component_native_close"
    pause until not screen "preferences"
    $ vn_test_assert_result = vn_test_options_limits()
    assert eval vn_test_assert_result
    $ vn_test_assert_result = vn_test_unknown_options()
    assert eval vn_test_assert_result
    assert eval vn_var_choice_source == "初始" and vn_var_changed_count == 0

testcase read_only_and_changed_popup_are_non_actionable:
@@START@@
    click id "vn_component_option_act_native"
    pause until screen "preferences"
    click id "vn_component_number_choice_choice"
    pause until screen "vn_preference_popup"
    $ vn_test_option_action = VnSelectControlOption("number_choice", 0, vn_ui_control_options_key("number_choice"), vn_bp_task_create("ui:preferences"))
    $ vn_ui_control_edit_options("number_choice", "replace", index=0, label="新零", value=0, value_type="number")
    pause until not screen "vn_preference_popup"
    $ vn_test_option_action()
    assert eval vn_preference_get("musicVolume") == 0.5 and vn_var_changed_count == 0
    $ vn_ui_control_set_range("number_choice", 0.25, 0.75, 0.1)
    assert eval not VnSelectControlOption("number_choice", 0, vn_ui_control_options_key("number_choice"), vn_bp_task_create("ui:preferences")).get_sensitive()
    assert eval vn_ui_get("number_choice", "optionCount") == 3
    click id "vn_component_native_close"
    pause until not screen "preferences"
    click id "vn_component_option_act_readonly"
    click id "vn_component_option_act_append"
    assert eval vn_ui_get("choice", "optionCount") == 3
    assert eval not VnSelectControlOption("choice", 2, vn_ui_control_options_key("choice"), vn_bp_task_create("options_page")).get_sensitive()
    assert eval vn_var_choice_source == "初始" and vn_var_changed_count == 0

testcase child_close_reopen_and_template_instances:
@@START@@
    click id "vn_component_option_act_child"
    pause until eval "options_child" in vn_ui_open_pages
    $ vn_test_option_action = VnSelectControlOption("child_choice", 1, vn_ui_control_options_key("child_choice"), vn_bp_task_create("options_child"))
    click id "vn_component_child_append"
    assert eval vn_ui_get("child_choice", "optionCount") == 3 and vn_ui_get("choice", "optionCount") == 2
    click id "vn_component_child_close"
    pause until not screen "vn_custom_page_options_child"
    click id "vn_component_option_act_child"
    pause until eval "options_child" in vn_ui_open_pages
    $ vn_test_option_action()
    assert eval vn_var_choice_source == "初始" and vn_ui_get("child_choice", "optionCount") == 2
    assert eval not vn_test_option_action.get_sensitive()
    click id "vn_component_child_close"
    pause until not screen "vn_custom_page_options_child"
    click id "vn_component_option_act_native"
    pause until screen "preferences"
    click id "vn_component_native_append"
    assert eval vn_ui_get("native_choice", "optionCount") == 3
    click id "vn_component_native_choice_choice"
    pause until screen "vn_preference_popup"
    screenshot "template-option-popup"
    click id "vn_preference_option_1"
    assert eval vn_preference_get("skipAll")
    click id "vn_component_native_close"
    pause until not screen "preferences"
    click id "vn_component_option_act_native"
    pause until screen "preferences"
    assert eval vn_ui_get("native_choice", "optionCount") == 2 and vn_preference_get("skipAll")

testcase lists_and_overrides_survive_save_load_and_rollback_but_not_new_game:
@@START@@
    click id "vn_component_option_act_append"
    click id "vn_component_option_act_override"
    $ vn_test_option_token = vn_ui_page_token("options_page")
    $ renpy.save("dynamic-options")
    click id "vn_component_option_act_clear"
    run FileLoad("dynamic-options", confirm=False, slot=True)
    pause until eval "options_page" in vn_ui_open_pages
    assert eval vn_ui_get("choice", "optionCount") == 3 and vn_ui_get("choice", "stringValue") == "动态"
    assert eval vn_var_choice_source == "初始" and vn_var_changed_count == 0
    screenshot "options-restored-from-save"
    click id "vn_component_option_act_close"
    pause until "选项列表页面已关闭。"
    assert eval "choice" not in vn_ui_control_option_overrides
    run Rollback()
    pause until eval "options_page" in vn_ui_open_pages
    assert eval vn_ui_page_token("options_page") == vn_test_option_token
    assert eval vn_ui_get("choice", "optionCount") == 3 and vn_ui_get("choice", "stringValue") == "动态"
    run MainMenu(confirm=False)
    pause until screen "main_menu"
    click id "vn_main_start" pos (0.5, 0.5)
    pause until eval "options_page" in vn_ui_open_pages
    assert eval vn_ui_get("choice", "optionCount") == 2 and vn_ui_get("choice", "stringValue") == "初始"

testcase background_uses_the_same_option_operation:
@@START@@
    click id "vn_component_option_act_background"
    pause until eval vn_var_job_done
    assert eval vn_ui_get("choice", "optionCount") == 3
    assert eval vn_ui_control_option("choice", 2, "string")["value"] == "任务" and vn_var_changed_count == 0
    screenshot "background-options"
`.replaceAll('@@START@@', [...start, '    $ vn_preference_set("skipAll", False)', '    $ vn_preference_set("musicVolume", 0.5)'].join('\n'));
  await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 240000 };
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
    report.cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves']);
    if ((report.cleanup as { errors: unknown[] }).errors.length) throw new Error('Verification cleanup failed.');
  } catch (error) { report.status = 'failed'; report.error = [report.error, String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  await save(); console.log(path.join(output, 'report.json')); if (report.error) console.error(report.error);
}
