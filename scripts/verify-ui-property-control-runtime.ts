import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createUiPropertyControlFixture, uiPropertyControlFixturePng } from './lib/ui-property-control-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral as q } from '../src/runtime/literals';

// Run only after all product changes and the editor build are complete.
const sdk = process.env.VNS_RENPY_SDK ?? path.resolve('resources/runtime');
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ? path.join(process.env.VNS_ARTIFACT_ROOT, 'ui-property-control-runtime') : 'artifacts/ui-property-control-2026-11-09', 'runtime-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const source = path.join(output, 'source'), game = path.join(output, 'game'), saves = path.join(output, 'saves');
const authorFile = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? '../我的视觉小说1/project.vns.json');
const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
const report: Record<string, unknown> = { status: 'running', authorFile, checks: [], temporaryPaths: [source, game, saves, path.join(output, 'renpy-saves')] };
const previousRenpySaves = process.env.RENPY_PATH_TO_SAVES;
let authorHash: string | undefined, failure: unknown;
await fs.mkdir(output, { recursive: true });
const saveReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  const logPath = path.join(output, name + '.log'); await fs.writeFile(logPath, result.log);
  (report.checks as unknown[]).push({ name, code: result.code, logPath }); await saveReport();
  assert.equal(result.code, 0, name + ': ' + result.log.slice(-10000));
}

try {
  report.renpySaves = await isolateRenpySaves(output);
  authorHash = digest(await fs.readFile(authorFile)); report.authorSha256Before = authorHash;
  const fixture = createUiPropertyControlFixture({ runtimePersistent: true }), original = structuredClone(fixture.project);
  report.fixtureProjectId = fixture.project.id;
  const compiled = compileProject(fixture.project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), [], 'The runtime fixture must contain no intentionally broken control source.');
  assert.deepEqual(fixture.project, original, 'Compilation must not migrate or mutate authored property controls.');
  await fs.mkdir(path.join(source, 'assets'), { recursive: true });
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(fixture.project, null, 2));
  for (const name of ['property-control-a.png', 'property-control-b.png']) await fs.writeFile(path.join(source, 'assets', name), uiPropertyControlFixturePng());
  const built = await buildProject({ project: fixture.project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + '\n' + JSON.stringify(built.diagnostics, null, 2) });
  const start = ['    pause until screen "main_menu"', '    click id "vn_main_start" pos (0.5, 0.5)', '    pause until eval ("pc_page" in vn_ui_open_pages)', '    move pos (8, 8)'].join('\n');
  const tests = String.raw`default pc_test_page_token = 0
default pc_test_alpha = 0.0
default pc_test_animation_token = 0
default pc_test_animation_elapsed = 0.0
default pc_test_persistent_alpha = 0.0
default pc_test_operation_ok = False
default pc_test_persistent_reset_ok = False

init python:
    def pc_follow_refuses(operation, component_id, property, value):
        try:
            if operation == "animate":
                vn_ui_animate(component_id, property, value, 0.2, "linear")
            else:
                vn_ui_set(component_id, property, value, write_mode=operation)
        except Exception as error:
            return "单向跟随" in str(error)
        return False

    def pc_reset_without_parameter_write(whole):
        before = vn_parameter_get("pc_alpha")
        if whole:
            vn_ui_reset("pc_alpha_a")
        else:
            vn_ui_reset_property("pc_alpha_a", "opacity")
        return vn_parameter_get("pc_alpha") == before

    def pc_read_reports_invalid_value():
        try:
            vn_ui_get("pc_alpha_a", "opacity")
        except Exception as error:
            return "范围" in str(error)
        return False

    def pc_save_sync_animation_checkpoint():
        global pc_test_alpha, pc_test_page_token, pc_test_animation_token, pc_test_animation_elapsed
        state = vn_ui_animations[("pc_alpha_a", "opacity")]
        pc_test_alpha = vn_parameter_get("pc_alpha")
        pc_test_page_token = vn_ui_page_token("pc_page")
        pc_test_animation_token, pc_test_animation_elapsed = state["token"], state["elapsed"]
        pc_observe_sync_animation_restore.checkpoint = pc_sync_animation_observation()
        pc_observe_sync_animation_restore.restored = None
        pc_observe_sync_animation_restore.armed = True
        pc_log_sync_animation_restore("checkpoint", pc_observe_sync_animation_restore.checkpoint)
        # Snapshot and save in one step so no animation frame separates them.
        renpy.save("property-control-playing-animation")

    def pc_sync_animation_observation():
        state = vn_ui_animations.get(("pc_alpha_a", "opacity"))
        task = (state.get("task") or {}) if state is not None else {}
        sample = getattr(vn_ui_animation_tick, "samples", {}).get((state["token"], ("pc_alpha_a", "opacity"))) if state is not None else None
        return dict(alpha=vn_parameter_get("pc_alpha"), elapsed=state.get("elapsed") if state is not None else None,
            token=state.get("token") if state is not None else None, pageOpen="pc_page" in vn_ui_open_pages,
            pageToken=vn_ui_page_token("pc_page"), taskPage=task.get("page"), taskPageToken=task.get("pageToken"),
            clock=renpy.display.core.get_time(), clockSampleMatchesState=bool(sample and sample[0] is state))

    def pc_log_sync_animation_restore(phase, observation=None):
        import json
        probe = pc_observe_sync_animation_restore
        current = observation if observation is not None else pc_sync_animation_observation()
        checkpoint, restored = getattr(probe, "checkpoint", None), getattr(probe, "restored", None)
        data = dict(phase=phase, observation=current, checkpoint=checkpoint, restored=restored)
        if checkpoint is not None and restored is not None:
            data["restoredAlphaDelta"] = restored["alpha"] - checkpoint["alpha"]
            data["restoredElapsedDelta"] = restored["elapsed"] - checkpoint["elapsed"] if restored["elapsed"] is not None else None
            data["wallSecondsAfterLoad"] = current["clock"] - restored["clock"]
            data["animationSecondsAfterLoad"] = current["elapsed"] - restored["elapsed"] if current["elapsed"] is not None and restored["elapsed"] is not None else None
        print("PROPERTY_CONTROL_ANIMATION_RESTORE " + json.dumps(data, ensure_ascii=True), flush=True)

    def pc_observe_sync_animation_restore():
        # Observe after the normal load callbacks, before a reconstructed
        # interaction can run timer frames. Do not advance or pause the driver.
        if not getattr(pc_observe_sync_animation_restore, "armed", False): return
        pc_observe_sync_animation_restore.armed = False
        pc_observe_sync_animation_restore.restored = pc_sync_animation_observation()
        pc_log_sync_animation_restore("after_load", pc_observe_sync_animation_restore.restored)

    def pc_end_sync_animation_restore_probe():
        # Function attributes are outside the saved store and survive loading.
        pc_observe_sync_animation_restore.armed = False
        pc_observe_sync_animation_restore.checkpoint = None
        pc_observe_sync_animation_restore.restored = None

    # Count the public save boundary without suppressing the real disk write.
    # Function attributes are transient and survive a new-game store reset.
    def pc_persistent_save_probe(*args, **kwargs):
        result = pc_persistent_save_probe.original(*args, **kwargs)
        pc_persistent_save_probe.values.append(vn_parameter_get("pc_persistent_alpha"))
        return result

    def pc_begin_persistent_probe():
        pc_persistent_save_probe.original = renpy.save_persistent
        pc_persistent_save_probe.values = []
        renpy.save_persistent = pc_persistent_save_probe

    def pc_end_persistent_probe():
        original = getattr(pc_persistent_save_probe, "original", None)
        if original is not None:
            renpy.save_persistent = original
            pc_persistent_save_probe.original = None
            print("PROPERTY_CONTROL_PERSISTENT_SAVES " + repr(pc_persistent_save_probe.values))

    def pc_persistent_disk_value():
        import importlib
        import os
        saved = importlib.import_module("renpy.persistent").load(os.path.join(renpy.config.savedir, "persistent"))
        return getattr(saved, "vn_var_pc_persistent_alpha", None)

    def pc_reset_persistent_animation():
        before = vn_parameter_get("pc_persistent_alpha")
        vn_ui_reset("pc_persist_a")
        return vn_parameter_get("pc_persistent_alpha") == before

init 1000 python:
    config.after_load_callbacks.append(pc_observe_sync_animation_restore)

testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
    after testcase:
        $ pc_end_persistent_probe()
        $ pc_end_sync_animation_restore_probe()
        if eval not main_menu:
            run MainMenu(confirm=False)
        pause until screen "main_menu"
    teardown:
        exit

testcase new_parameter_source_wins_and_design_defaults_remain:
@@START@@
    assert eval vn_ui_get("pc_slider", "numberValue") == 30 and vn_parameter_get("pc_legacy_number") == 10
    assert eval vn_ui_get("pc_slider_follow", "numberValue") == 30 and vn_ui_get("pc_clamped", "numberValue") == 30
    assert eval vn_ui_get("pc_input", "stringValue") == "参数初值" and vn_parameter_get("pc_legacy_name") == "旧姓名"
    assert eval vn_ui_get("pc_text_follow", "text") == "参数文字" and vn_ui_get("pc_text_sync", "text") == "参数文字"
    assert eval vn_ui_default("pc_text_sync", "text") == "双向标题设计值" and vn_ui_default("pc_alpha_a", "opacity") == 0.9
    assert eval vn_ui_get("pc_alpha_a", "opacity") == 0.4 and vn_ui_get("pc_alpha_b", "opacity") == 0.4 and vn_ui_get("pc_alpha_follow", "opacity") == 0.4
    assert eval vn_ui_get("pc_alpha_a", "x") == 0.12 and vn_parameter_get("pc_position") == 0.12
    assert eval vn_ui_get("pc_image_control", "image") == "pc_asset_a" and vn_ui_default("pc_image_control", "image") == "pc_asset_b"
    assert eval vn_parameter_get("pc_changed_count") == 0 and vn_parameter_get("pc_commit_count") == 0
    screenshot "01-initial-parameter-values"
    click id "vn_component_pc_program" pos (0.5, 0.5)
    pause until eval vn_parameter_get("pc_number") == 70
    assert eval vn_ui_get("pc_slider", "numberValue") == 70 and vn_ui_get("pc_slider_follow", "numberValue") == 70
    assert eval vn_ui_get("pc_clamped", "numberValue") == 40 and vn_parameter_get("pc_number") == 70
    assert eval vn_ui_get("pc_slider", "normalizedValue") == 0.7 and vn_parameter_get("pc_legacy_number") == 10
    assert eval vn_ui_get("pc_input", "stringValue") == "蓝图输入" and vn_parameter_get("pc_text") == "蓝图输入" and vn_parameter_get("pc_legacy_name") == "旧姓名"
    assert eval vn_ui_get("pc_choices", "optionIndex") == 1 and vn_ui_get("pc_choices_follow", "optionIndex") == 1 and vn_parameter_get("pc_choice") == "困难"
    assert eval vn_ui_get("pc_toggle", "booleanValue") is False and vn_parameter_get("pc_flag") is False
    assert eval vn_ui_get("pc_text_follow", "text") == "蓝图标题" and vn_parameter_get("pc_caption") == "蓝图标题"
    assert eval vn_ui_get("pc_alpha_a", "opacity") == 0.6 and vn_ui_get("pc_alpha_b", "opacity") == 0.6 and vn_parameter_get("pc_alpha") == 0.6
    assert eval vn_ui_get("pc_default", "text") == "临时文字" and vn_ui_default("pc_default", "text") == "原始设计文字"
    assert eval vn_ui_get("pc_image_control", "image") == "pc_asset_b" and vn_parameter_get("pc_image") == "pc_asset_b"
    assert eval not any(property in vn_ui_overrides.get(identity, {}) for identity, property in (("pc_slider", "numberValue"), ("pc_input", "stringValue"), ("pc_text_sync", "text"), ("pc_alpha_a", "opacity"), ("pc_image_control", "image")))
    assert eval vn_parameter_get("pc_changed_count") == 0 and vn_parameter_get("pc_commit_count") == 0
    screenshot "02-blueprint-synchronizes-controls"

testcase follow_blocks_only_its_property_including_value_aliases:
@@START@@
    # Ren'Py evaluates assert conditions twice; perform each attempted write once.
    $ pc_test_operation_ok = pc_follow_refuses("override", "pc_slider_follow", "numberValue", 50)
    assert eval pc_test_operation_ok
    $ pc_test_operation_ok = pc_follow_refuses("source", "pc_slider_follow", "normalizedValue", 0.5)
    assert eval pc_test_operation_ok
    $ pc_test_operation_ok = pc_follow_refuses("override", "pc_choices_follow", "optionIndex", 2)
    assert eval pc_test_operation_ok
    $ pc_test_operation_ok = pc_follow_refuses("override", "pc_text_follow", "text", "不应写入")
    assert eval pc_test_operation_ok
    $ pc_test_operation_ok = pc_follow_refuses("override", "pc_text_follow", "visible", False)
    assert eval pc_test_operation_ok
    $ pc_test_operation_ok = pc_follow_refuses("animate", "pc_alpha_follow", "opacity", 0.2)
    assert eval pc_test_operation_ok
    assert eval vn_parameter_get("pc_number") == 30 and vn_parameter_get("pc_choice") == "简单" and vn_parameter_get("pc_alpha") == 0.4
    $ vn_ui_set("pc_text_follow", "fontSize", 31)
    assert eval vn_ui_get("pc_text_follow", "fontSize") == 31 and vn_ui_get("pc_text_follow", "text") == "参数文字"
    click id "vn_component_pc_slider_follow_control" pos (0.95, 0.5)
    assert eval vn_parameter_get("pc_number") == 30 and vn_parameter_get("pc_changed_count") == 0
    click id "vn_component_pc_parameter" pos (0.5, 0.5)
    pause until eval vn_parameter_get("pc_number") == 90
    assert eval vn_ui_get("pc_slider_follow", "numberValue") == 90 and vn_ui_get("pc_clamped", "numberValue") == 40
    assert eval vn_parameter_get("pc_number") == 90 and vn_parameter_get("pc_legacy_number") == 10
    assert eval vn_ui_get("pc_text_follow", "text") == "参数标题" and vn_ui_get("pc_text_follow", "fontSize") == 31
    $ vn_parameter_set("pc_visible", False)
    assert eval vn_ui_get("pc_text_follow", "visible") is False
    $ vn_parameter_set("pc_visible", True)
    assert eval vn_ui_get("pc_text_follow", "visible") is True and vn_parameter_get("pc_changed_count") == 0
    screenshot "03-follow-and-clamped-display"

testcase player_values_sync_once_without_writing_the_old_source:
@@START@@
    $ vn_parameter_set("pc_text", "")
    pause 0.1
    click id "vn_component_pc_input_edit" pos (0.5, 0.5)
    type "AB" id "vn_component_pc_input"
    assert eval vn_parameter_get("pc_text") == "AB" and vn_parameter_get("pc_legacy_name") == "旧姓名"
    assert eval vn_parameter_get("pc_changed_count") == 2 and vn_parameter_get("pc_commit_count") == 0
    keysym "K_RETURN" id "vn_component_pc_input"
    assert eval vn_parameter_get("pc_commit_count") == 1 and vn_ui_get("pc_input", "focused") is False
    click id "vn_component_pc_slider_control" pos (0.82, 0.5)
    assert eval vn_parameter_get("pc_number") > 60 and vn_ui_get("pc_slider", "numberValue") == vn_parameter_get("pc_number") and vn_ui_get("pc_slider_follow", "numberValue") == vn_parameter_get("pc_number")
    assert eval vn_parameter_get("pc_legacy_number") == 10 and vn_parameter_get("pc_changed_count") == 3
    click id "vn_component_pc_choices_option_2" pos (0.5, 0.5)
    assert eval vn_parameter_get("pc_choice") == "旁观" and vn_ui_get("pc_choices_follow", "optionIndex") == 2 and vn_parameter_get("pc_changed_count") == 4
    click id "vn_component_pc_choices_option_2" pos (0.5, 0.5)
    assert eval vn_parameter_get("pc_changed_count") == 4
    click id "vn_component_pc_toggle_toggle" pos (0.5, 0.5)
    assert eval vn_parameter_get("pc_flag") is False and vn_parameter_get("pc_changed_count") == 5
    click id "vn_component_pc_parameter" pos (0.5, 0.5)
    assert eval vn_parameter_get("pc_changed_count") == 5 and vn_parameter_get("pc_commit_count") == 1
    screenshot "04-player-input-and-event-counts"

testcase reset_clears_transient_state_without_rewinding_parameters:
@@START@@
    click id "vn_component_pc_program" pos (0.5, 0.5)
    click id "vn_component_pc_reset" pos (0.5, 0.5)
    assert eval vn_ui_get("pc_default", "text") == "原始设计文字"
    assert eval vn_ui_get("pc_slider", "numberValue") == 70 and vn_parameter_get("pc_number") == 70 and vn_parameter_get("pc_legacy_number") == 10
    assert eval vn_ui_get("pc_input", "stringValue") == "蓝图输入" and vn_parameter_get("pc_text") == "蓝图输入"
    assert eval vn_ui_get("pc_alpha_a", "opacity") == 0.6 and vn_parameter_get("pc_alpha") == 0.6
    assert eval vn_ui_get("pc_image_control", "image") == "pc_asset_b" and vn_parameter_get("pc_image") == "pc_asset_b"
    $ vn_ui_reset("pc_slider")
    $ vn_ui_reset("pc_alpha_a")
    $ vn_ui_reset_property("pc_slider_follow", "normalizedValue")
    assert eval vn_parameter_get("pc_number") == 70 and vn_ui_get("pc_slider", "numberValue") == 70 and vn_ui_get("pc_slider_follow", "numberValue") == 70
    assert eval vn_parameter_get("pc_alpha") == 0.6 and vn_ui_get("pc_alpha_a", "opacity") == 0.6
    $ vn_ui_get("pc_alpha_a", "screenX")
    $ vn_ui_get("pc_alpha_a", "screenWidth")
    $ vn_ui_get("pc_alpha_a", "opacity")
    assert eval vn_parameter_get("pc_position") == 0.12 and vn_parameter_get("pc_alpha") == 0.6
    assert eval vn_parameter_get("pc_changed_count") == 0 and vn_parameter_get("pc_commit_count") == 0

testcase parameter_animation_has_one_driver_and_direct_writes_stop_it:
@@START@@
    click id "vn_component_pc_anim_a" pos (0.5, 0.5)
    pause 0.25
    assert eval 0.4 < vn_parameter_get("pc_alpha") < 0.95
    assert eval abs(vn_ui_get("pc_alpha_a", "opacity") - vn_parameter_get("pc_alpha")) < 0.000001 and abs(vn_ui_get("pc_alpha_b", "opacity") - vn_parameter_get("pc_alpha")) < 0.000001
    assert eval abs(vn_ui_get("pc_alpha_follow", "opacity") - vn_parameter_get("pc_alpha")) < 0.000001
    click id "vn_component_pc_anim_b" pos (0.5, 0.5)
    pause 0.7
    assert eval abs(vn_parameter_get("pc_alpha") - 0.15) < 0.000001
    pause 0.6
    assert eval abs(vn_parameter_get("pc_alpha") - 0.15) < 0.000001 and abs(vn_ui_get("pc_alpha_a", "opacity") - 0.15) < 0.000001
    click id "vn_component_pc_anim_a" pos (0.5, 0.5)
    pause 0.15
    $ vn_parameter_set("pc_alpha", 0.65)
    pause 1.2
    assert eval vn_parameter_get("pc_alpha") == 0.65 and vn_ui_get("pc_alpha_a", "opacity") == 0.65 and vn_ui_get("pc_alpha_b", "opacity") == 0.65
    click id "vn_component_pc_anim_a" pos (0.5, 0.5)
    pause 0.15
    $ pc_test_alpha = vn_parameter_get("pc_alpha")
    $ vn_parameter_set("pc_alpha", pc_test_alpha)
    pause 1.2
    assert eval vn_parameter_get("pc_alpha") == pc_test_alpha
    assert eval "opacity" not in vn_ui_overrides.get("pc_alpha_a", {}) and "opacity" not in vn_ui_overrides.get("pc_alpha_b", {})
    click id "vn_component_pc_anim_a" pos (0.5, 0.5)
    pause 0.15
    $ pc_test_operation_ok = pc_reset_without_parameter_write(False)
    assert eval pc_test_operation_ok
    $ pc_test_alpha = vn_parameter_get("pc_alpha")
    pause 1.1
    assert eval vn_parameter_get("pc_alpha") == pc_test_alpha
    click id "vn_component_pc_anim_a" pos (0.5, 0.5)
    pause 0.15
    $ pc_test_operation_ok = pc_reset_without_parameter_write(True)
    assert eval pc_test_operation_ok
    $ pc_test_alpha = vn_parameter_get("pc_alpha")
    pause 1.1
    assert eval vn_parameter_get("pc_alpha") == pc_test_alpha
    assert eval vn_parameter_get("pc_changed_count") == 0 and vn_parameter_get("pc_commit_count") == 0
    screenshot "05-animation-driver-replacement"

testcase saved_parameter_values_and_page_scope_restore_together:
@@START@@
    click id "vn_component_pc_program" pos (0.5, 0.5)
    $ pc_test_page_token = vn_ui_page_token("pc_page")
    $ renpy.save("property-control-checkpoint")
    click id "vn_component_pc_parameter" pos (0.5, 0.5)
    assert eval vn_parameter_get("pc_number") == 90 and vn_parameter_get("pc_alpha") == 0.8
    run FileLoad("property-control-checkpoint", confirm=False, slot=True)
    pause until eval vn_parameter_get("pc_number") == 70
    assert eval vn_ui_page_token("pc_page") == pc_test_page_token and vn_ui_get("pc_slider", "numberValue") == 70
    assert eval vn_ui_get("pc_input", "stringValue") == "蓝图输入" and vn_ui_get("pc_text_follow", "text") == "蓝图标题"
    assert eval vn_parameter_get("pc_alpha") == 0.6 and vn_ui_get("pc_alpha_b", "opacity") == 0.6
    assert eval vn_ui_get("pc_default", "text") == "临时文字" and vn_parameter_get("pc_legacy_number") == 10
    click id "vn_component_pc_close" pos (0.5, 0.5)
    pause until "属性控制页面已关闭。"
    assert eval "pc_page" not in vn_ui_open_pages and "pc_default" not in vn_ui_overrides
    run Jump(@@FIRST@@)
    pause until eval "pc_page" in vn_ui_open_pages
    assert eval vn_ui_page_token("pc_page") != pc_test_page_token
    assert eval vn_ui_get("pc_slider", "numberValue") == 70 and vn_ui_get("pc_input", "stringValue") == "蓝图输入"
    assert eval vn_ui_get("pc_default", "text") == "原始设计文字" and vn_parameter_get("pc_number") == 70
    screenshot "06-saved-and-reopened-sources"

testcase playing_nonpersistent_sync_animation_restores_progress_and_continues:
@@START@@
    click id "vn_component_pc_anim_a" pos (0.5, 0.5)
    pause 0.25
    $ pc_save_sync_animation_checkpoint()
    assert eval renpy.can_load("property-control-playing-animation") and 0.4 < pc_test_alpha < 0.85 and 0.15 < pc_test_animation_elapsed < 0.8
    assert eval vn_ui_animations[("pc_alpha_a", "opacity")]["task"]["page"] == "pc_page" and vn_ui_animations[("pc_alpha_a", "opacity")]["task"]["pageToken"] == pc_test_page_token
    $ vn_parameter_set("pc_alpha", 0.1)
    assert eval not vn_ui_animation_active(pc_test_animation_token) and vn_parameter_get("pc_alpha") == 0.1
    pause 1.1
    assert eval vn_parameter_get("pc_alpha") == 0.1 and vn_ui_get("pc_alpha_b", "opacity") == 0.1
    run FileLoad("property-control-playing-animation", confirm=False, slot=True)
    $ pc_log_sync_animation_restore("before_assertions")
    assert eval pc_observe_sync_animation_restore.restored is not None
    assert eval "pc_page" in vn_ui_open_pages and vn_ui_page_token("pc_page") == pc_test_page_token
    assert eval vn_ui_animation_active(pc_test_animation_token) and vn_ui_animations[("pc_alpha_a", "opacity")]["token"] == pc_test_animation_token
    # Compare the restoration boundary exactly. Separate testcase instructions
    # yield frames, during which this running animation must keep advancing.
    assert eval pc_observe_sync_animation_restore.restored["alpha"] == pc_test_alpha == pc_observe_sync_animation_restore.checkpoint["alpha"]
    assert eval pc_observe_sync_animation_restore.restored["elapsed"] == pc_test_animation_elapsed == pc_observe_sync_animation_restore.checkpoint["elapsed"]
    assert eval pc_observe_sync_animation_restore.restored["token"] == pc_test_animation_token and pc_observe_sync_animation_restore.restored["pageToken"] == pc_test_page_token and pc_observe_sync_animation_restore.restored["taskPageToken"] == pc_test_page_token
    assert eval vn_ui_get("pc_alpha_a", "opacity") == vn_parameter_get("pc_alpha") and vn_ui_get("pc_alpha_b", "opacity") == vn_parameter_get("pc_alpha") and vn_ui_get("pc_alpha_follow", "opacity") == vn_parameter_get("pc_alpha")
    pause 0.2
    assert eval pc_test_alpha + 0.04 < vn_parameter_get("pc_alpha") < 0.95
    assert eval vn_ui_animations[("pc_alpha_a", "opacity")]["token"] == pc_test_animation_token and vn_ui_animations[("pc_alpha_a", "opacity")]["elapsed"] > pc_test_animation_elapsed + 0.1
    pause until eval not vn_ui_animation_active(pc_test_animation_token)
    assert eval vn_parameter_get("pc_alpha") == 0.95 and vn_ui_get("pc_alpha_a", "opacity") == 0.95 and vn_ui_get("pc_alpha_b", "opacity") == 0.95 and vn_ui_get("pc_alpha_follow", "opacity") == 0.95
    assert eval "opacity" not in vn_ui_overrides.get("pc_alpha_a", {}) and "opacity" not in vn_ui_overrides.get("pc_alpha_b", {}) and vn_ui_default("pc_alpha_a", "opacity") == 0.9
    assert eval vn_parameter_get("pc_changed_count") == 0 and vn_parameter_get("pc_commit_count") == 0
    screenshot "08-restored-playing-sync-animation"

testcase unopened_parameter_source_can_be_repaired_before_page_reopens:
@@START@@
    click id "vn_component_pc_close" pos (0.5, 0.5)
    pause until "属性控制页面已关闭。"
    $ vn_parameter_set("pc_alpha", 2.0)
    assert eval vn_parameter_get("pc_alpha") == 2.0 and pc_read_reports_invalid_value()
    $ vn_ui_set("pc_alpha_a", "opacity", 0.55)
    assert eval vn_parameter_get("pc_alpha") == 0.55 and vn_ui_get("pc_alpha_a", "opacity") == 0.55
    run Jump(@@FIRST@@)
    pause until eval "pc_page" in vn_ui_open_pages
    assert eval vn_ui_get("pc_alpha_b", "opacity") == 0.55 and vn_ui_get("pc_alpha_follow", "opacity") == 0.55
    assert eval vn_parameter_get("pc_changed_count") == 0 and vn_parameter_get("pc_commit_count") == 0

testcase persistent_sync_animation_batches_saves_and_survives_new_game:
@@START@@
    $ vn_parameter_set("pc_persistent_alpha", 0.25)
    assert eval pc_persistent_disk_value() == 0.25
    $ pc_begin_persistent_probe()
    $ vn_ui_animate("pc_persist_a", "opacity", 0.8, 1.0, "linear")
    pause 0.2
    assert eval len(pc_persistent_save_probe.values) == 0
    assert eval 0.25 < vn_parameter_get("pc_persistent_alpha") < 0.8 and vn_ui_get("pc_persist_a", "opacity") == vn_ui_get("pc_persist_b", "opacity")
    pause until eval vn_parameter_get("pc_persistent_alpha") == 0.8
    assert eval pc_persistent_save_probe.values == [0.8] and pc_persistent_disk_value() == 0.8
    $ vn_ui_animate("pc_persist_b", "opacity", 0.1, 1.0, "linear")
    pause 0.2
    assert eval len(pc_persistent_save_probe.values) == 1
    $ vn_ui_stop_animation("pc_persist_b", "opacity", False)
    $ pc_test_persistent_alpha = vn_parameter_get("pc_persistent_alpha")
    assert eval 0.1 < pc_test_persistent_alpha < 0.8 and vn_ui_get("pc_persist_a", "opacity") == pc_test_persistent_alpha
    assert eval len(pc_persistent_save_probe.values) == 2 and pc_persistent_save_probe.values[-1] == pc_test_persistent_alpha and pc_persistent_disk_value() == pc_test_persistent_alpha
    pause 1.1
    assert eval len(pc_persistent_save_probe.values) == 2 and vn_parameter_get("pc_persistent_alpha") == pc_test_persistent_alpha
    $ vn_ui_reset("pc_persist_a")
    $ vn_ui_reset_property("pc_persist_b", "opacity")
    assert eval vn_parameter_get("pc_persistent_alpha") == pc_test_persistent_alpha and len(pc_persistent_save_probe.values) == 2
    $ vn_ui_animate("pc_persist_a", "opacity", 0.95, 1.0, "linear")
    pause 0.15
    assert eval len(pc_persistent_save_probe.values) == 2
    $ pc_test_persistent_reset_ok = pc_reset_persistent_animation()
    $ pc_test_persistent_alpha = vn_parameter_get("pc_persistent_alpha")
    assert eval pc_test_persistent_reset_ok and len(pc_persistent_save_probe.values) == 3 and pc_persistent_disk_value() == pc_test_persistent_alpha
    pause 1.1
    assert eval vn_parameter_get("pc_persistent_alpha") == pc_test_persistent_alpha and len(pc_persistent_save_probe.values) == 3
    $ vn_ui_set("pc_persist_b", "opacity", 0.65)
    $ vn_parameter_set("pc_number", 88)
    assert eval len(pc_persistent_save_probe.values) == 4 and pc_persistent_disk_value() == 0.65
    assert eval "opacity" not in vn_ui_overrides.get("pc_persist_a", {}) and "opacity" not in vn_ui_overrides.get("pc_persist_b", {})
    $ pc_end_persistent_probe()
    run MainMenu(confirm=False)
    pause until screen "main_menu"
    click id "vn_main_start" pos (0.5, 0.5)
    pause until eval ("pc_page" in vn_ui_open_pages)
    assert eval vn_parameter_get("pc_persistent_alpha") == 0.65 and pc_persistent_disk_value() == 0.65
    assert eval vn_ui_get("pc_persist_a", "opacity") == 0.65 and vn_ui_get("pc_persist_b", "opacity") == 0.65
    assert eval vn_parameter_get("pc_number") == 30 and vn_parameter_get("pc_alpha") == 0.4
    $ vn_ui_reset("pc_persist_a")
    assert eval vn_parameter_get("pc_persistent_alpha") == 0.65 and vn_ui_default("pc_persist_a", "opacity") == 0.9
    assert eval vn_parameter_get("pc_changed_count") == 0 and vn_parameter_get("pc_commit_count") == 0
    screenshot "07-persistent-animation-new-game"
`.replaceAll('@@START@@', start).replaceAll('@@FIRST@@', q('vn_node_' + fixture.firstPassageId));
  await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
  const runOptions = { savedir: saves, timeoutMs: 180000 };
  await check('lint', await runRenpy(sdk, game, ['lint'], runOptions));
  const native = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...runOptions, onData: text => process.stdout.write(text) });
  await check('runtime', native);
  const cases = (tests.match(/^testcase /gm) ?? []).length, assertions = (tests.match(/^    assert /gm) ?? []).length;
  assert.match(native.log, new RegExp('Test cases\\s*:\\s*' + cases + '\\s*\\|\\s*' + cases + ' passed'));
  assert.equal(Number(native.log.match(/Assertions\s*:\s*(\d+)/)?.[1]), assertions);
  report.cases = cases; report.assertions = assertions; report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.error = error instanceof Error ? error.stack : String(error);
} finally {
  try {
    for (const directory of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) {
      if (await fs.stat(directory).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(directory, path.join(output, 'screenshots'), { recursive: true });
    }
  } catch (error) { report.status = 'failed'; report.screenshotError = String(error); failure ??= error; }
  try {
    const after = digest(await fs.readFile(authorFile)); report.authorSha256After = after;
    if (authorHash !== undefined) assert.equal(after, authorHash, 'Isolated acceptance must not change the author project.');
  } catch (error) { report.status = 'failed'; report.sourceProtectionError = String(error); failure ??= error; }
  try {
    report.cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves', 'renpy-saves']);
    assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []);
  } catch (error) { report.status = 'failed'; report.cleanupError = String(error); failure ??= error; }
  if (previousRenpySaves === undefined) delete process.env.RENPY_PATH_TO_SAVES;
  else process.env.RENPY_PATH_TO_SAVES = previousRenpySaves;
  await saveReport(); console.log(path.join(output, 'report.json'));
}
if (failure) throw failure;
