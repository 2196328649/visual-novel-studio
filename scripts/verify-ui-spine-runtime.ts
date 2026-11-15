import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createUiSpineFixture, writeUiSpineFixtureAssets } from './lib/ui-spine-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';

const sdk = process.env.VNS_RENPY_SDK ?? 'E:/Tools/renpy-8.5.3-sdk';
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts', 'ui-spine-runtime', new Date().toISOString().replaceAll(':', '-'));
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
  await isolateRenpySaves(output);
  const f = createUiSpineFixture();
  for (const [index, mode] of (['sync', 'follow'] as const).entries()) {
    const parameterId = 'spine_' + mode + '_speed';
    f.project.variables.push({ id: parameterId, name: mode + '速度参数', type: 'number', initial: 9, persistent: false });
    f.page.components.push({ ...structuredClone(f.rig), id: 'rig_speed_' + mode, name: mode + '速度读者', x: .58 + index * .045, y: .02, width: .035, height: .08,
      propertyControls: { spineSpeed: { mode, parameterId } } });
  }
  const original = structuredClone(f.project);
  assert.deepEqual(compileProject(f.project).diagnostics.filter(issue => issue.severity === 'error'), []); assert.deepEqual(f.project, original);
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(f.project, null, 2)); await writeUiSpineFixtureAssets(source);
  const built = await buildProject({ project: f.project, projectDir: source, sdkRoot: sdk, spineRuntimeDir: path.resolve('resources/spine'), outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  const start = ['    pause until screen "main_menu"', '    click id "vn_main_start" pos (0.5, 0.5)', '    pause until eval ("spine_page" in vn_ui_open_pages)', '    pause until eval vn_ui_get("rig", "spinePaused")', '    move pos (8, 8)'];
  const tests = String.raw`default vn_test_spine_position = 0.0
default vn_test_spine_token = None
default vn_test_spine_source = 0

init 1000 python:
    def vn_test_spine_reject(property, value):
        before = __import__("copy").deepcopy(vn_ui_overrides)
        record = vn_spine_states.get("rig")
        try:
            vn_ui_set("rig", property, value)
        except Exception as error:
            return (before == vn_ui_overrides and vn_spine_states.get("rig") is record
                and (property != "spineSpeed" or "0～32" in str(error)))
        return False

    def vn_test_spine_speed_reject(value):
        before = __import__("copy").deepcopy(vn_ui_overrides)
        record = vn_spine_states.get("rig")
        try:
            vns_spine.speed("rig", value)
        except Exception as error:
            return before == vn_ui_overrides and vn_spine_states.get("rig") is record and "0～32" in str(error)
        return False

    def vn_test_spine_parameter_reject(mode, value):
        component_id, parameter_id = "rig_speed_" + mode, "spine_" + mode + "_speed"
        parameter, record = vn_parameter_get(parameter_id), vn_spine_states.get(component_id)
        overrides = __import__("copy").deepcopy(vn_ui_overrides)
        try:
            vn_parameter_set(parameter_id, value)
        except Exception as error:
            return ("0～32" in str(error) and vn_parameter_get(parameter_id) == parameter
                and vn_spine_states.get(component_id) is record and vn_ui_overrides == overrides)
        return False

    def vn_test_spine_saved_follow_source_reject():
        component_id, parameter_id = "rig_speed_follow", "spine_follow_speed"
        previous, record = vn_parameter_get(parameter_id), vn_spine_states.get(component_id)
        try:
            setattr(renpy.store, "vn_var_" + parameter_id, 1e9)
            try:
                vns_spine.snapshot(component_id, strict=True)
            except Exception as error:
                return "0～32" in str(error) and vn_parameter_get(parameter_id) == 1e9 and vn_spine_states.get(component_id) is record
            return False
        finally:
            setattr(renpy.store, "vn_var_" + parameter_id, previous)

    def vn_test_spine_unsafe_records_preserved():
        current = dict(vn_spine_states["rig"])
        for value in (32.0001, 1e9, 1e308, float("nan"), float("inf"), True):
            for original in (dict(current, speed=value), dict(animation="swing", skin="default", loop=False, paused=True, speed=value, time=.35, revision=3)):
                vn_spine_states["rig"] = original
                if "0～32" not in vns_spine.problem(original) or vn_ui_get("rig", "spineStatus") != "failed": return False
                try:
                    vns_spine.pause("rig", False)
                    return False
                except Exception as error:
                    if "0～32" not in str(error) or vn_spine_states.get("rig") is not original: return False
                vn_ui_reset("rig")
                if vn_spine_recovery["rig"] is not original or vns_spine.problem(vn_spine_states["rig"]): return False
        return True

    def vn_test_spine_final_native_boundary():
        class NoNativeCalls:
            called = False
            def __getattr__(self, name):
                self.called = True
                raise AssertionError("Invalid speed reached native DLL: " + name)
        native = vns_spine.Native.__new__(vns_spine.Native)
        native.handle, native.dll, native.last_frame = None, NoNativeCalls(), 123.0
        original = dict(vn_spine_states["rig"])
        for value in (32.0001, 1e9, 1e308, float("nan"), float("inf"), True):
            row = dict(original, speed=value, paused=False, suspended=False, status="playing")
            for operation in (lambda: native.configure(row, row), lambda: native.advance(row)):
                try:
                    operation()
                    return False
                except Exception as error:
                    if "0～32" not in str(error) or native.dll.called or native.last_frame != 123.0: return False
        return True

    def vn_test_spine_legacy_speed_nine():
        old = dict(animation="swing", skin="default", loop=False, paused=True, speed=9.0, time=.35, revision=3)
        vn_ui_overrides.pop("rig", None)
        vn_spine_states["rig"] = old
        vns_spine.sync("rig")
        row = vns_spine.snapshot("rig", strict=True)
        return (vn_spine_recovery["rig"] == old and row["version"] == 1 and row["time"] == .35
            and row["paused"] and row["speed"] == 9 and vn_ui_get("rig", "spineSpeed") == 9)

    def vn_test_spine_unknown_record():
        original = {"version": 77, "payload": ["保留", 0, False]}
        vn_spine_states["rig"] = original
        rejected = vn_ui_get("rig", "spineStatus") == "failed"
        try:
            vns_spine.play("rig", "swing")
            return False
        except Exception:
            pass
        vn_ui_reset("rig")
        return rejected and vn_spine_recovery["rig"] == original and vn_spine_states["rig"]["version"] == 1

    def vn_test_spine_legacy_first_command():
        old = dict(animation="swing", skin="alternate", loop=True, paused=True, speed=.5, time=.35, revision=3)
        vn_ui_overrides.pop("rig", None)
        vn_spine_states["rig"] = old
        vns_spine.pause("rig", False)
        row = vns_spine.snapshot("rig", strict=True)
        return (vn_spine_recovery["rig"] == old and row["version"] == 1 and row["time"] == .35
            and row["skin"] == "alternate" and row["speed"] == .5 and row["loop"] and not row["paused"]
            and vn_ui_get("rig", "spineSkin") == "alternate" and vn_ui_get("rig", "spineSpeed") == .5)

    def vn_test_spine_stale_sample():
        live = vns_spine._live["rig"]
        old = vn_spine_states["rig"]
        stale = dict(base=old, owner=old["owner"], sequence=old["sequence"], sourceSequence=old["sourceSequence"], assetId=old["assetId"],
            values=dict(status="completed", time=2.4, duration=2.4, durationKnown=True, error=""))
        vns_spine.pause("rig", True)
        live["pending"] = stale
        vns_spine.poll()
        return vn_var_spine_completed == 0 and vn_spine_states["rig"]["paused"] and vn_spine_states["rig"]["status"] != "completed"

    def vn_test_spine_old_owner_cleanup():
        previous = dict(vns_spine._live["rig_child"])
        old_token = vn_ui_page_token("spine_child")
        vn_ui_close_page("spine_child", "")
        vn_ui_open_page("spine_child")
        vns_spine.pause("rig_child", True)
        current = vn_spine_states["rig_child"]
        vns_spine._live["rig_child"] = previous
        vns_spine.poll()
        return vn_ui_page_token("spine_child") != old_token and vn_spine_states.get("rig_child") is current

testsuite global:
    before testcase:
        $ _test.timeout = 18.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
    after testcase:
        if eval not main_menu:
            run MainMenu(confirm=False)
        pause until screen "main_menu"
    teardown:
        exit

testcase actual_native_runtime_and_once_only_completed_event:
@@START@@
    assert eval vn_ui_get("rig", "spinePaused") and vn_var_spine_completed == 0
    click id "vn_component_spine_action_play"
    pause until eval vn_ui_get("rig", "spinePlaying")
    assert eval vn_ui_get("rig", "spineDurationKnown") and abs(vn_ui_get("rig", "spineDuration") - 2.4) < .001
    assert eval vns_spine._resources["rig"].handle is not None and vn_var_spine_failed == 0
    screenshot "spine-real-native-geometry"
    pause until eval vn_var_spine_completed == 1
    click id "vn_component_spine_action_observe"
    assert eval vn_var_spine_status == "completed" and vn_var_spine_progress == 1
    assert eval vn_var_spine_event_asset == "rig_a" and vn_var_spine_event_animation == "swing" and vn_var_spine_event_skin == "default"
    assert eval abs(vn_var_spine_event_position - vn_var_spine_event_duration) < .001 and vn_var_spine_event_error == ""
    $ renpy.restart_interaction()
    pause .15
    assert eval vn_var_spine_completed == 1

testcase pause_skin_transform_and_independent_player:
@@START@@
    click id "vn_component_spine_action_play"
    pause until eval vn_ui_get("rig", "spinePosition") > .2
    click id "vn_component_spine_action_pause"
    pause until eval vn_ui_get("rig", "spinePaused")
    $ vn_test_spine_position = vn_ui_get("rig", "spinePosition")
    $ vn_test_spine_source = vn_spine_states["rig"]["sourceSequence"]
    click id "vn_component_spine_action_skin"
    click id "vn_component_spine_action_transform"
    pause .15
    assert eval vn_ui_get("rig", "spineSkin") == "alternate" and vns_spine._resources["rig"].skin == "alternate"
    assert eval abs(vn_ui_get("rig", "spinePosition") - vn_test_spine_position) < .002 and vn_spine_states["rig"]["sourceSequence"] == vn_test_spine_source
    assert eval vn_ui_get("rig", "spineFit") == "manual" and vn_ui_get("rig", "spineFlipX") and vn_ui_get("rig", "spineRotation") == 25
    assert eval vn_ui_get("rig_mirror", "spinePlaying") and vns_spine._resources["rig_mirror"].handle != vns_spine._resources["rig"].handle
    screenshot "spine-paused-skin-transform"
    click id "vn_component_spine_action_resume"
    pause until eval vn_ui_get("rig", "spinePosition") > vn_test_spine_position + .1
    assert eval vn_var_spine_completed == 0

testcase loop_changes_zero_speed_and_actual_terminal_transition:
@@START@@
    click id "vn_component_spine_action_play"
    click id "vn_component_spine_action_loop"
    pause 5.0
    assert eval vn_var_spine_completed == 0 and vn_ui_get("rig", "spinePlaying")
    click id "vn_component_spine_action_zero"
    pause until eval vn_ui_get("rig", "spinePaused")
    $ vn_test_spine_position = vn_ui_get("rig", "spinePosition")
    pause .2
    assert eval abs(vn_ui_get("rig", "spinePosition") - vn_test_spine_position) < .002
    click id "vn_component_spine_action_speed"
    click id "vn_component_spine_action_once"
    pause until eval vn_var_spine_completed == 1
    assert eval vn_ui_get("rig", "spineStatus") == "completed"
    click id "vn_component_spine_action_loop"
    pause .15
    assert eval vn_var_spine_completed == 1 and vn_ui_get("rig", "spineStatus") == "completed"

testcase source_replacement_same_source_hide_clear_and_reset:
@@START@@
    click id "vn_component_spine_action_play"
    pause until eval vn_ui_get("rig", "spinePosition") > .15
    click id "vn_component_spine_action_pause"
    $ vn_test_spine_position = vn_ui_get("rig", "spinePosition")
    $ vn_test_spine_source = vn_spine_states["rig"]["sourceSequence"]
    click id "vn_component_spine_action_same"
    click id "vn_component_spine_action_hide"
    click id "vn_component_spine_action_show"
    assert eval vn_spine_states["rig"]["paused"] and vn_spine_states["rig"]["sourceSequence"] == vn_test_spine_source
    assert eval abs(vn_ui_get("rig", "spinePosition") - vn_test_spine_position) < .002
    click id "vn_component_spine_action_skin"
    click id "vn_component_spine_action_swap"
    pause until eval vn_ui_get("rig", "spinePaused")
    assert eval vn_ui_get("rig", "spineAsset") == "rig_b" and vn_ui_get("rig", "spineAnimation") == "bounce" and vn_ui_get("rig", "spineSkin") == ""
    click id "vn_component_spine_action_restore"
    pause until eval vn_ui_get("rig", "spinePaused")
    assert eval vn_ui_get("rig", "spineAsset") == "rig_a" and vn_ui_get("rig", "spineSkin") == "default" and vn_spine_states["rig"]["sourceSequence"] > vn_test_spine_source
    click id "vn_component_spine_action_clear"
    pause until eval vn_ui_get("rig", "spineStatus") == "empty"
    assert eval "rig" not in vns_spine._resources and vn_var_spine_completed == 0 and vn_var_spine_failed == 0
    click id "vn_component_spine_action_reset"
    pause until eval vn_ui_get("rig", "spinePaused")
    assert eval vn_ui_get("rig", "spinePosition") == 0 and vn_ui_get("rig", "spineAnimation") == "swing"

testcase real_decode_failure_and_atomic_bad_values:
@@START@@
    $ vn_test_assert_result = vn_test_spine_reject("spineAsset", "not_spine") and vn_test_spine_reject("spineSkin", "missing")
    assert eval vn_test_assert_result
    $ vn_test_assert_result = vn_test_spine_reject("spineSpeed", -1) and vn_test_spine_reject("spinePosition", .5)
    assert eval vn_test_assert_result
    click id "vn_component_spine_action_fail"
    pause until eval vn_var_spine_failed == 1
    click id "vn_component_spine_action_observe"
    assert eval vn_var_spine_status == "failed" and vn_var_spine_event_asset == "rig_broken" and vn_var_spine_event_error != ""
    screenshot "spine-real-json-decode-failure"
    $ renpy.restart_interaction()
    pause .1
    assert eval vn_var_spine_failed == 1 and vn_var_spine_completed == 0
    click id "vn_component_spine_action_reset"
    pause until eval vn_ui_get("rig", "spinePaused")
    $ vn_test_assert_result = vn_test_spine_unknown_record()
    assert eval vn_test_assert_result

testcase paused_speed_nine_preserves_position_and_rejects_invalid_numbers:
@@START@@
    $ vn_test_spine_position = vn_ui_get("rig", "spinePosition")
    $ vn_test_spine_source = vn_spine_states["rig"]["sourceSequence"]
    $ vn_ui_set("rig", "spineSpeed", 9)
    pause .1
    assert eval vn_ui_get("rig", "spineSpeed") == 9 and vn_ui_get("rig", "spinePaused")
    assert eval vn_ui_get("rig", "spinePosition") == vn_test_spine_position and vn_spine_states["rig"]["sourceSequence"] == vn_test_spine_source
    $ vns_spine.speed("rig", 9)
    assert eval vn_ui_get("rig", "spineSpeed") == 9 and vn_ui_get("rig", "spinePosition") == vn_test_spine_position
    $ vn_test_assert_result = all(vn_test_spine_reject("spineSpeed", value) and vn_test_spine_speed_reject(value) for value in (-1, 32.0001, 1e9, 1e308, float("nan"), float("inf"), True))
    assert eval vn_test_assert_result and vn_ui_get("rig", "spineSpeed") == 9
    $ vn_test_assert_result = vn_test_spine_legacy_speed_nine()
    assert eval vn_test_assert_result and vn_var_spine_completed == 0 and vn_var_spine_failed == 0

testcase active_speed_thirty_two_continues_and_finishes_once:
@@START@@
    $ vns_spine.speed("rig", 32)
    $ vns_spine.play("rig", "swing", True, True)
    pause until eval vn_ui_get("rig", "spinePlaying")
    $ vn_test_spine_source = vn_spine_states["rig"]["lastSample"]
    pause .2
    assert eval vn_ui_get("rig", "spineSpeed") == 32 and vn_ui_get("rig", "spinePlaying")
    assert eval vn_spine_states["rig"]["lastSample"] > vn_test_spine_source and vn_var_spine_completed == 0
    assert eval vns_spine._resources["rig"].handle is not None and vn_var_spine_failed == 0
    $ vns_spine.play("rig", "swing", False, True)
    pause until eval vn_var_spine_completed == 1
    assert eval vn_ui_get("rig", "spineStatus") == "completed" and abs(vn_ui_get("rig", "spinePosition") - 2.4) < .001
    pause .1
    assert eval vn_var_spine_completed == 1 and vn_var_spine_failed == 0

testcase sync_and_follow_parameter_speeds_reject_atomically:
@@START@@
    $ vns_spine.speed("rig_speed_sync", 32)
    $ vn_parameter_set("spine_follow_speed", 32)
    pause .1
    assert eval vn_parameter_get("spine_sync_speed") == 32 and vn_ui_get("rig_speed_sync", "spineSpeed") == 32
    assert eval vn_parameter_get("spine_follow_speed") == 32 and vn_ui_get("rig_speed_follow", "spineSpeed") == 32
    assert eval vn_spine_states["rig_speed_sync"]["paused"] and vn_spine_states["rig_speed_follow"]["paused"]
    $ vn_test_assert_result = all(vn_test_spine_parameter_reject(mode, value) for mode in ("sync", "follow") for value in (32.0001, 1e9, 1e308))
    assert eval vn_test_assert_result
    $ vn_test_assert_result = vn_test_spine_saved_follow_source_reject()
    assert eval vn_test_assert_result and vn_parameter_get("spine_follow_speed") == 32
    $ vn_parameter_set("spine_sync_speed", 9)
    $ vn_parameter_set("spine_follow_speed", 9)
    assert eval vn_ui_get("rig_speed_sync", "spineSpeed") == 9 and vn_ui_get("rig_speed_follow", "spineSpeed") == 9

testcase unsafe_saved_speeds_and_final_dll_guard:
@@START@@
    $ vn_test_assert_result = vn_test_spine_unsafe_records_preserved()
    assert eval vn_test_assert_result
    $ vn_test_assert_result = vn_test_spine_final_native_boundary()
    assert eval vn_test_assert_result
    pause until eval vn_ui_get("rig", "spinePaused")
    assert eval vn_ui_get("rig", "spineSpeed") == 1 and vn_ui_get("rig", "spinePaused")

testcase zero_duration_animation_and_stale_report:
@@START@@
    click id "vn_component_spine_action_play"
    pause until eval vn_ui_get("rig", "spinePlaying")
    $ vn_test_assert_result = vn_test_spine_stale_sample()
    assert eval vn_test_assert_result
    click id "vn_component_spine_action_instant"
    pause until eval vn_var_spine_completed == 1
    assert eval vn_ui_get("rig", "spineDurationKnown") and vn_ui_get("rig", "spineDuration") == 0 and vn_ui_get("rig", "spineProgress") == 1

testcase native_and_custom_page_instances_cleanup_and_focus:
@@START@@
    click id "vn_component_spine_action_play"
    click id "vn_component_spine_action_child"
    pause until eval vn_var_spine_child_completed == 1
    pause until eval vn_var_spine_completed == 1
    assert eval not vn_spine_states["rig"]["suspended"]
    $ vn_test_assert_result = vn_test_spine_old_owner_cleanup()
    assert eval vn_test_assert_result
    click id "vn_component_spine_child_close"
    pause until eval "spine_child" not in vn_ui_open_pages
    assert eval "rig_child" not in vn_spine_states and "rig_child" not in vns_spine._resources
    click id "vn_component_spine_action_restart"
    click id "vn_component_spine_action_loop"
    pause until eval vn_ui_get("rig", "spinePosition") > .15
    click id "vn_component_spine_action_native"
    pause until screen "preferences"
    pause until eval vn_var_spine_native_completed == 1
    assert eval vn_ui_get("rig", "spinePaused")
    $ vn_test_spine_position = vn_ui_get("rig", "spinePosition")
    pause .15
    assert eval abs(vn_ui_get("rig", "spinePosition") - vn_test_spine_position) < .002
    screenshot "spine-native-template"
    click id "vn_component_spine_native_close"
    pause until eval renpy.get_screen("preferences") is None
    pause until eval vn_ui_get("rig", "spinePosition") > vn_test_spine_position + .05
    assert eval "rig_native" not in vn_spine_states

testcase background_commands_and_legacy_first_mutation:
@@START@@
    $ vn_test_assert_result = vn_test_spine_legacy_first_command()
    assert eval vn_test_assert_result
    pause until eval vn_ui_get("rig", "spinePlaying")
    assert eval vn_ui_get("rig", "spineSpeed") == .5 and vn_ui_get("rig", "spineSkin") == "alternate"
    click id "vn_component_spine_action_background"
    pause until eval vn_var_spine_job_done
    assert eval vn_ui_get("rig", "spineAsset") == "rig_b" and vn_ui_get("rig", "spineAnimation") == "bounce" and vn_ui_get("rig", "spinePaused")
    assert eval vn_var_spine_completed == 0 and vn_var_spine_failed == 0

testcase save_load_rollback_and_new_game_restore_plain_data:
@@START@@
    click id "vn_component_spine_action_play"
    pause until eval vn_ui_get("rig", "spinePosition") > .25
    click id "vn_component_spine_action_pause"
    click id "vn_component_spine_action_skin"
    $ vn_test_spine_position = vn_ui_get("rig", "spinePosition")
    $ vn_test_spine_token = vn_ui_page_token("spine_page")
    $ renpy.save("spine-state")
    click id "vn_component_spine_action_swap"
    run FileLoad("spine-state", confirm=False, slot=True)
    pause until eval vn_ui_get("rig", "spinePaused")
    assert eval vn_ui_get("rig", "spineAsset") == "rig_a" and vn_ui_get("rig", "spineSkin") == "alternate"
    assert eval abs(vn_ui_get("rig", "spinePosition") - vn_test_spine_position) < .002
    click id "vn_component_spine_action_resume"
    pause until eval vn_ui_get("rig", "spinePosition") > vn_test_spine_position + .1
    click id "vn_component_spine_action_pause"
    click id "vn_component_spine_action_close"
    pause until "骨骼页关闭后继续剧情。"
    assert eval "rig" not in vn_spine_states and "rig" not in vns_spine._resources
    run Rollback()
    pause until eval "spine_page" in vn_ui_open_pages
    assert eval vn_ui_page_token("spine_page") == vn_test_spine_token and vn_ui_get("rig", "spinePaused") and vn_ui_get("rig", "spineSkin") == "alternate"
    assert eval vn_ui_get("rig", "spinePosition") >= vn_test_spine_position
    screenshot "spine-save-load-and-rollback"
    run MainMenu(confirm=False)
    pause until screen "main_menu"
    pause until eval not vns_spine._resources and not vns_spine._live
    assert eval "rig" not in vn_spine_states and not vns_spine._resources and not vns_spine._live
    click id "vn_main_start" pos (.5, .5)
    pause until eval vn_ui_get("rig", "spinePaused")
    assert eval vn_ui_get("rig", "spinePosition") == 0 and vn_var_spine_completed == 0 and vn_var_spine_failed == 0

testcase completed_save_does_not_repeat_completion:
@@START@@
    click id "vn_component_spine_action_quick"
    pause until eval vn_var_spine_completed == 1
    $ renpy.save("spine-completed")
    click id "vn_component_spine_action_restart"
    run FileLoad("spine-completed", confirm=False, slot=True)
    pause .2
    assert eval vn_ui_get("rig", "spineStatus") == "completed" and vn_var_spine_completed == 1
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
  await save(); console.log(path.join(output, 'report.json')); if (report.error) console.error(report.error);
}
