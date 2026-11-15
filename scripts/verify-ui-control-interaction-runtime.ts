import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createUiControlInteractionFixture } from './lib/ui-control-interaction-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';

const sdk = process.env.VNS_RENPY_SDK ?? path.resolve('resources/runtime');
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts', 'ui-control-interaction-runtime', new Date().toISOString().replaceAll(':', '-'));
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
  const f = createUiControlInteractionFixture(), original = structuredClone(f.project);
  assert.deepEqual(compileProject(f.project).diagnostics.filter(issue => issue.severity === 'error'), []); assert.deepEqual(f.project, original);
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(f.project, null, 2));
  const built = await buildProject({ project: f.project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  const start = ['    pause until screen "main_menu"', '    click id "vn_main_start" pos (0.5, 0.5)', '    pause until eval ("interaction_page" in vn_ui_open_pages)', '    move pos (8, 8)'];
  const tests = String.raw`default vn_test_focus_token = 0
default vn_test_pending_accepted = False

init python:
    def vn_test_invalid_range(minimum, maximum, step):
        before, source = dict(vn_ui_overrides.get("range_slider", {})), vn_var_range_source
        try:
            vn_ui_control_set_range("range_slider", minimum, maximum, step)
        except Exception:
            return before == vn_ui_overrides.get("range_slider", {}) and source == vn_var_range_source
        return False

    def vn_test_invalid_range_reset():
        before = dict(vn_ui_overrides.get("range_slider", {}))
        try:
            vn_ui_reset_property("range_slider", "maximum")
        except Exception:
            return before == vn_ui_overrides.get("range_slider", {})
        return False

    def vn_test_save_pending_focus():
        renpy.store.vn_test_pending_accepted = vn_input_request_focus("focus_a_input", True)
        renpy.save("pending-focus-request")

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

testcase standard_bar_fallback_uses_same_step_rule:
@@START@@
    $ VnParameterValue("range_source").changed(2.5)
    assert eval vn_var_range_source == -15
    $ VnParameterValue("range_source", reverse=True).changed(97.5)
    assert eval vn_var_range_source == -15
    $ VnParameterValue("range_source").changed(100)
    assert eval vn_var_range_source == 80
    $ VnPreferenceValue("musicVolume").changed(0.005)
    assert eval abs(vn_preference_get("musicVolume") - 0.01) < 0.000001
    $ VnPreferenceValue("musicVolume", reverse=True).changed(0.995)
    assert eval abs(vn_preference_get("musicVolume") - 0.01) < 0.000001
    # Preference bars expose normalized 0..1 travel, including the instant-text
    # endpoint. Half a step on the 200-unit track is 0.0025, not 0.5 pixels.
    $ VnPreferenceValue("textSpeed").changed(0.0025)
    assert eval vn_preference_get("textSpeed") == 2
    $ VnPreferenceValue("textSpeed").changed(0.5)
    assert eval vn_preference_get("textSpeed") == 101
    $ VnPreferenceValue("textSpeed").changed(1)
    assert eval vn_preference_get("textSpeed") == 0

testcase authored_and_runtime_ranges_reach_real_bars:
@@START@@
    assert eval vn_ui_get("range_slider", "minimum") == 0 and vn_ui_get("range_slider", "maximum") == 60 and vn_ui_get("range_slider", "step") == 10
    assert eval vn_ui_get("range_slider", "sourceMinimum") == -20 and vn_ui_get("range_slider", "sourceMaximum") == 80 and vn_ui_get("range_slider", "sourceStep") == 5
    assert eval abs(renpy.get_widget("vn_blueprint_pages", "vn_component_range_slider_control").adjustment.value - 0.5) < 0.000001
    click id "vn_component_act_narrow"
    pause 0.05
    assert eval vn_ui_get("range_slider", "numberValue") == 20 and vn_var_range_source == 30 and vn_ui_get("range_mirror", "numberValue") == 30
    assert eval renpy.get_widget("vn_blueprint_pages", "vn_component_range_slider_control").adjustment.value == 1
    assert eval abs(renpy.get_widget("vn_blueprint_pages", "vn_component_range_mirror_control").adjustment.value - 0.5) < 0.000001
    assert eval vn_var_changed_count == 0 and vn_var_committed_count == 0
    screenshot "range-clamp-and-source-mirror"
    click id "vn_component_act_range_reset"
    assert eval vn_ui_get("range_slider", "numberValue") == 30

testcase atomic_crossing_source_assignment_and_reset:
@@START@@
    click id "vn_component_act_override"
    click id "vn_component_act_fixed"
    assert eval vn_ui_get("range_slider", "numberValue") == 12 and vn_var_range_source == 30 and vn_ui_get("range_slider", "normalizedValue") == 0
    assert eval renpy.get_widget("vn_blueprint_pages", "vn_component_range_slider_control").adjustment.adjustable is False
    click id "vn_component_act_range_reset"
    assert eval vn_ui_get("range_slider", "numberValue") == 15
    click id "vn_component_act_wide"
    assert eval vn_ui_get("range_slider", "minimum") == 100 and vn_ui_get("range_slider", "maximum") == 200 and vn_ui_get("range_slider", "step") == 25
    click id "vn_component_act_source"
    assert eval vn_var_range_source == 160 and vn_ui_get("range_slider", "numberValue") == 160 and vn_ui_get("range_mirror", "numberValue") == 80
    assert eval abs(vn_ui_get("range_slider", "normalizedValue") - 0.6) < 0.000001
    click id "vn_component_act_range_reset"
    assert eval vn_ui_get("range_slider", "numberValue") == 60 and vn_var_range_source == 160
    assert eval vn_var_changed_count == 0 and vn_var_committed_count == 0
    screenshot "crossed-range-and-source"

testcase runtime_rejects_invalid_ranges_without_partial_writes:
@@START@@
    $ vn_test_assert_result = vn_test_invalid_range(60, 20, 1)
    assert eval vn_test_assert_result
    $ vn_test_assert_result = vn_test_invalid_range(0, 60, 0)
    assert eval vn_test_assert_result
    $ vn_test_assert_result = vn_test_invalid_range(float("nan"), 60, 1)
    assert eval vn_test_assert_result
    $ vn_test_assert_result = vn_test_invalid_range(-1e308, 1e308, 1)
    assert eval vn_test_assert_result
    click id "vn_component_act_wide"
    $ vn_test_assert_result = vn_test_invalid_range_reset()
    assert eval vn_test_assert_result
    assert eval vn_ui_control_range("range_slider") == {"min": 100, "max": 200, "step": 25}
    click id "vn_component_act_range_reset"
    assert eval vn_ui_control_range("range_slider") == {"min": 0, "max": 60, "step": 10}

testcase real_user_slider_obeys_current_steps:
@@START@@
    click id "vn_component_act_narrow"
    click id "vn_component_range_slider_control" pos (0.48, 0.5)
    assert eval vn_var_range_source in (12, 14, 16, 18)
    assert eval vn_ui_get("range_slider", "numberValue") == vn_var_range_source and vn_ui_get("range_mirror", "numberValue") == vn_var_range_source
    assert eval vn_var_changed_count == 1
    click id "vn_component_act_fixed"
    assert eval renpy.get_widget("vn_blueprint_pages", "vn_component_range_slider_control").adjustment.adjustable is False
    assert eval vn_var_changed_count == 1

testcase queued_focus_movement_and_release_are_not_user_submissions:
@@START@@
    click id "vn_component_act_chain"
    pause until eval vn_var_chain_done
    assert eval vn_var_chain_a_accepted and vn_var_chain_b_accepted
    assert eval not vn_var_chain_a_immediate and vn_var_chain_a_after and vn_var_chain_a_before_move
    assert eval not vn_var_chain_b_immediate and not vn_var_chain_a_moved and vn_var_chain_b_after and not vn_var_chain_b_released
    assert eval not vn_ui_get("focus_a_input", "focused") and not vn_ui_get("focus_b_input", "focused")
    assert eval vn_var_changed_count == 0 and vn_var_committed_count == 0
    screenshot "programmatic-focus-chain"

testcase last_request_wins_and_other_input_release_is_targeted:
@@START@@
    click id "vn_component_act_coalesce"
    pause until eval vn_var_coalesce_done
    assert eval not vn_var_coalesce_a and vn_var_coalesce_b and vn_var_coalesce_b_after_release_a
    assert eval not vn_ui_get("focus_a_input", "focused") and vn_ui_get("focus_b_input", "focused")
    assert eval vn_var_changed_count == 0 and vn_var_committed_count == 0
    type "X" id "vn_component_focus_b_input"
    assert eval vn_var_input_b == "乙X" and vn_var_changed_count == 1
    keysym "K_RETURN" id "vn_component_focus_b_input"
    assert eval vn_var_committed_count == 1 and not vn_ui_get("focus_b_input", "focused")
    screenshot "real-input-after-programmatic-focus"

testcase hiding_disabling_readonly_and_modal_cover_cancel_old_requests:
@@START@@
    click id "vn_component_act_hide"
    assert eval vn_var_hide_accepted and not vn_var_hide_after
    click id "vn_component_act_disable"
    assert eval vn_var_disable_accepted and not vn_var_disable_after
    click id "vn_component_act_readonly"
    assert eval not vn_var_readonly_accepted and not vn_var_readonly_after
    click id "vn_component_act_modal"
    assert eval vn_var_modal_accepted and not vn_var_modal_after
    assert eval not vn_ui_get("focus_a_input", "focused") and VnInputFocusRequests.pending is None
    assert eval vn_var_changed_count == 0 and vn_var_committed_count == 0

testcase fresh_page_can_queue_focus_before_widgets_are_ready:
@@START@@
    click id "vn_component_act_fresh"
    pause until eval vn_var_fresh_after
    assert eval vn_var_fresh_accepted and not vn_var_fresh_immediate
    assert eval vn_ui_get("child_input", "focused") and VnInputFocusRequests.pending is None
    assert eval isinstance(renpy.get_editable_input_value()[0], VnParameterInput)
    screenshot "new-page-focused-input"
    click id "vn_component_child_close"
    assert eval not vn_ui_get("child_input", "focused")

testcase old_focus_request_cannot_reach_a_reopened_page:
@@START@@
    click id "vn_component_act_reopen"
    pause until eval "interaction_child" in vn_ui_open_pages
    assert eval vn_var_child_accepted and not vn_var_child_reopened_focus
    assert eval not vn_ui_get("child_input", "focused") and VnInputFocusRequests.pending is None
    screenshot "reopened-page-no-stale-focus"

testcase native_template_uses_the_same_focus_contract:
@@START@@
    click id "vn_component_act_native"
    pause until screen "preferences"
    pause until eval vn_var_native_after
    assert eval vn_var_native_accepted and not vn_var_native_immediate
    assert eval vn_ui_get("native_focus_input", "focused")
    assert eval vn_var_changed_count == 0 and vn_var_committed_count == 0
    screenshot "native-template-focus"
    click id "vn_component_native_focus_close"
    pause until not screen "preferences"
    assert eval not vn_ui_get("native_focus_input", "focused")

testcase save_load_preserves_range_but_never_pending_or_active_focus:
@@START@@
    click id "vn_component_act_narrow"
    click id "vn_component_act_override"
    click id "vn_component_act_focus_a"
    pause until eval vn_ui_get("focus_a_input", "focused")
    $ vn_test_focus_token = vn_ui_page_token("interaction_page")
    $ renpy.save("range-and-active-focus")
    run FileLoad("range-and-active-focus", confirm=False, slot=True)
    pause until eval "interaction_page" in vn_ui_open_pages
    assert eval vn_ui_control_range("range_slider") == {"min": 10, "max": 20, "step": 2}
    assert eval vn_ui_get("range_slider", "numberValue") == 15 and vn_var_range_source == 30
    assert eval not vn_ui_get("focus_a_input", "focused") and VnInputFocusRequests.pending is None
    assert eval vn_var_committed_count == 0
    $ vn_test_save_pending_focus()
    pause until eval vn_ui_get("focus_a_input", "focused")
    run FileLoad("pending-focus-request", confirm=False, slot=True)
    pause until eval "interaction_page" in vn_ui_open_pages
    assert eval vn_test_pending_accepted and VnInputFocusRequests.pending is None
    pause 0.1
    assert eval not vn_ui_get("focus_a_input", "focused") and vn_var_committed_count == 0
    screenshot "range-restored-focus-cleared"
    click id "vn_component_act_close"
    pause until "范围焦点页面已关闭。"
    run Rollback()
    pause until eval "interaction_page" in vn_ui_open_pages
    assert eval vn_ui_page_token("interaction_page") == vn_test_focus_token
    assert eval not vn_ui_get("focus_a_input", "focused") and VnInputFocusRequests.pending is None

testcase new_game_never_reuses_an_old_input_focus_request:
@@START@@
    click id "vn_component_act_focus_a"
    assert eval vn_ui_get("focus_a_input", "focused")
    run MainMenu(confirm=False)
    pause until screen "main_menu"
    click id "vn_main_start" pos (0.5, 0.5)
    pause until eval "interaction_page" in vn_ui_open_pages
    assert eval not vn_ui_get("focus_a_input", "focused") and VnInputFocusRequests.pending is None
    assert eval vn_ui_control_range("range_slider") == {"min": 0, "max": 60, "step": 10}
    assert eval vn_var_range_source == 30 and vn_var_committed_count == 0

testcase background_task_uses_the_same_range_and_focus_runtime:
@@START@@
    click id "vn_component_act_background"
    pause until eval vn_var_job_done
    pause until eval vn_ui_get("focus_a_input", "focused")
    assert eval vn_ui_control_range("range_slider") == {"min": 25, "max": 45, "step": 5}
    assert eval vn_var_range_source == 30 and vn_var_changed_count == 0 and vn_var_committed_count == 0
    screenshot "background-range-and-focus"
`.replaceAll('@@START@@', start.join('\n'));
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
    report.cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves', 'renpy-saves']);
    if ((report.cleanup as { errors: unknown[] }).errors.length) throw new Error('Verification cleanup failed.');
  } catch (error) { report.status = 'failed'; report.error = [report.error, String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  if (previousSaveRoot === undefined) delete process.env.RENPY_PATH_TO_SAVES; else process.env.RENPY_PATH_TO_SAVES = previousSaveRoot;
  await save(); console.log(path.join(output, 'report.json')); if (report.error) console.error(report.error);
}
