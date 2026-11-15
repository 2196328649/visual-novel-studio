import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { addResetValidationControl, parameterLifecycleFixture, placeParameterControls, uiMoreSettingsFixture } from './lib/ui-more-settings-fixture';
import { buildProject, runRenpy } from '../src/runtime/service';
import { isolateRenpySaves } from './lib/renpy-saves';
import { renderedScreenTextHelper } from './lib/renpy-screen-test';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

const root = path.resolve('.'), output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/parameter-generalization',
  'explicit-controls-runtime-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const sdk = path.resolve(process.env.VNS_RENPY_SDK ?? 'resources/runtime'), relative = path.relative(root, output);
if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Acceptance output must stay inside the workspace.');
await fs.mkdir(output, { recursive: true });
const reports: Record<string, unknown>[] = [], report: Record<string, unknown> = { status: 'running', reports };
const previousSaves = process.env.RENPY_PATH_TO_SAVES;
let failure: unknown;
const header = `${renderedScreenTextHelper}
init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
init python:
    def qa_control_probe(label, component_id):
        import json
        screen = renpy.get_screen("preferences")
        identity = "vn_component_" + component_id + "_control"
        widget = renpy.get_widget("preferences", identity)
        focus = renpy.test.testfocus.focus_from_displayable(widget) if widget is not None else None
        point = renpy.test.testmouse.mouse_pos or renpy.get_mouse_pos()
        hit = renpy.display.render.focus_at_point(*point)
        adjustment = getattr(widget, "adjustment", None)
        print("PARAMETER_CONTROL_PROBE " + json.dumps({
            "label": label, "component": component_id, "value": vn_ui_control_get(component_id),
            "range": vn_ui_control_range(component_id), "available": vn_ui_control_available(component_id),
            "box": [focus.x, focus.y, focus.w, focus.h] if focus is not None else None,
            "widget": type(widget).__name__, "mouse": point,
            "hit": [key for key, item in screen.widgets.items() if item is getattr(hit, "widget", None)],
            "adjustment": [adjustment.value, adjustment.range] if adjustment is not None else None,
        }, ensure_ascii=False))

    def qa_prepare_test_exit():
        import faulthandler
        print("PARAMETER_CONTROL_TEARDOWN " + repr({"main_menu": main_menu, "contexts": [context.current for context in renpy.game.contexts]}), flush=True)
        # A stalled native shutdown must retain its thread stacks and still fail
        # the runner's exit-code/timeout check; never infer success from assertions.
        faulthandler.dump_traceback_later(30, repeat=False)
testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        $ qa_prepare_test_exit()
        exit
`;
const explicitCase = `testcase explicit_parameter_controls:
    click id "vn_component_open_wait"
    pause until screen "preferences"
    assert eval vn_parameter_get("story") == 3
    assert eval "更多设置" not in vns_test_rendered_texts("preferences")
    assert eval renpy.get_widget("preferences", "vn_parameter_custom") is None
    assert eval renpy.get_widget("preferences", "vn_parameter_hidden") is None
    $ qa_control_probe("before-custom", "custom_control")
    click id "vn_component_custom_control_control" pos (0.7, 0.5)
    $ qa_control_probe("after-custom", "custom_control")
    screenshot "custom-slider-click.png"
    assert eval 43 <= vn_parameter_get("custom") <= 47
    click id "vn_component_enabled_control_toggle"
    assert eval vn_parameter_get("enabled") is False
    click id "vn_component_language_control_option_1"
    assert eval vn_parameter_get("language") == "English"
    click id "vn_component_nickname_control_edit"
    type "X" id "vn_component_nickname_control"
    keysym "K_RETURN" id "vn_component_nickname_control"
    assert eval vn_parameter_get("nickname") == "PlayerX"
    click id "vn_component_bottom_control_control" pos (0.6, 0.5)
    $ qa_control_probe("after-bottom", "bottom_control")
    assert eval 17 <= vn_parameter_get("bottom") <= 19
    click id "vn_component_placed_control_toggle"
    assert eval vn_parameter_get("placed") is False
    $ vn_parameter_set("hidden", False)
    assert eval vn_parameter_get("story") == 3
    screenshot "explicit-controls.png"
    click id "vn_component_settings_reset"
    pause until screen "confirm"
    click "取消"
    assert eval vn_parameter_get("language") == "English"
    assert eval vn_parameter_get("hidden") is False
    click id "vn_component_settings_back"
    pause until screen "main_menu"
    assert eval vn_parameter_get("story") == 9
    click id "vn_component_open_wait"
    pause until screen "preferences"
    assert eval vn_parameter_get("nickname") == "PlayerX"
    click id "vn_component_settings_reset"
    pause until screen "confirm"
    click "确认"
    assert eval vn_parameter_get("custom") == 25 and vn_parameter_get("enabled") is True
    assert eval vn_parameter_get("language") == "中文" and vn_parameter_get("nickname") == "Player"
    assert eval vn_parameter_get("hidden") is True and vn_parameter_get("placed") is True
    assert eval vn_parameter_get("bottom") == 10
    keysym "K_ESCAPE"
    pause until screen "main_menu"
    assert eval vn_parameter_get("story") == 9
    # A restored old screen redirects to the real settings page without adding controls.
    run ShowMenu("vn_parameter_settings_menu")
    pause until screen "preferences"
    assert not screen "vn_parameter_settings_menu"
    assert eval "更多设置" not in vns_test_rendered_texts("preferences")
    click id "vn_component_settings_back"
    pause until screen "main_menu"
`;
const rejectionCase = `default qa_reset_error = ""
init python:
    def qa_reset_snapshot():
        return (
            {key: vn_parameter_get(key) for key in vn_parameter_info},
            {key: vn_preference_get(key) for key in vn_preference_info},
            dict(persistent._character_volume),
            {mixer: _preferences.get_mute(mixer) for mixer in vn_preference_mixers.values()},
            vn_ui_get("reset_range", "maximum"),
        )

    def qa_rejected_reset_unchanged():
        global qa_reset_error
        before = qa_reset_snapshot()
        try:
            vn_reset_preferences()
        except Exception as error:
            qa_reset_error = str(error)
            return "下限" in qa_reset_error and qa_reset_snapshot() == before
        return False

testcase reset_is_atomic:
    $ vn_parameter_set("reset_minimum", 10)
    $ vn_parameter_set("custom", 44)
    $ vn_parameter_set("hidden", False)
    $ vn_parameter_set("story", 8)
    run ShowMenu("preferences")
    pause until screen "preferences"
    click id "vn_component_narrow_range"
    assert eval vn_ui_get("reset_range", "maximum") == 20
    $ vn_preference_set("musicVolume", .2)
    $ vn_preference_set("textSpeed", 80)
    $ vn_preference_set("characterVolume", .3, "hero")
    $ _preferences.set_mute("music", True)
    assert eval qa_rejected_reset_unchanged()
    assert eval vn_parameter_get("reset_minimum") == 10 and vn_parameter_get("custom") == 44
    assert eval vn_parameter_get("hidden") is False and vn_parameter_get("story") == 8
    assert eval abs(vn_preference_get("musicVolume") - .2) < .001 and _preferences.get_mute("music") is True
    assert eval abs(vn_preference_get("characterVolume", "hero") - .3) < .001
    assert eval "更多设置" not in vns_test_rendered_texts("preferences")
    screenshot "rejected-reset-unchanged.png"
    # Repair the live range; the same reset now succeeds through the real confirmation.
    $ vn_ui_set("reset_range", "maximum", 100)
    click id "vn_component_settings_reset"
    pause until screen "confirm"
    click "确认"
    assert eval vn_parameter_get("reset_minimum") == 50 and vn_parameter_get("custom") == 25
    assert eval vn_parameter_get("hidden") is True and vn_parameter_get("story") == 8
    assert eval abs(vn_preference_get("musicVolume") - .7) < .001 and _preferences.get_mute("music") is False
    assert eval abs(vn_preference_get("characterVolume", "hero") - .8) < .001
    screenshot "reset-after-range-repair.png"
`;
const lifecycleCase = `init python:
    def qa_lifecycle_values():
        return [vn_parameter_get(key) for key in ("lc_slot_keep", "lc_slot_reset", "lc_local_reset", "lc_local_keep", "lc_legacy", "lc_progress", "lc_read_value")]

    def qa_no_automatic_parameter_ui():
        text = vns_test_rendered_texts("preferences")
        return "更多设置" not in text and all(caption not in text for caption in ("旧设置组", "旧设置参数", "保留的本机变量", "跨周目剧情进度")) and not any(isinstance(identity, str) and identity.startswith("vn_parameter_") for identity in renpy.get_screen("preferences").widgets)

testcase independent_storage_and_reset_lifecycle:
    # Four explicit combinations plus legacy settings and persistent story progress.
    run Start()
    pause until eval vn_current_line == "lc_wait" and renpy.get_screen("say") is not None
    assert eval qa_lifecycle_values() == [1, 2, 3, 4, 5, 6, -1]
    assert eval set(vn_parameter_reset_ids) == set(["lc_slot_reset", "lc_local_reset", "lc_legacy"])
    run ShowMenu("preferences")
    pause until screen "preferences"
    assert eval qa_no_automatic_parameter_ui()
    assert eval renpy.get_widget("preferences", "vn_component_lc_slider_control") is not None
    # Player input, blueprint read and blueprint write all target the same variable.
    click id "vn_component_lc_slider_control" pos (0.6, 0.5)
    $ qa_control_probe("lifecycle-after-slider", "lc_slider")
    assert eval 58 <= vn_parameter_get("lc_slot_reset") <= 62
    click id "vn_component_lc_read_button"
    assert eval vn_parameter_get("lc_read_value") == vn_parameter_get("lc_slot_reset")
    click id "vn_component_lc_write_button"
    assert eval vn_parameter_get("lc_slot_reset") == 37 and vn_ui_control_get("lc_slider") == 37
    click id "vn_component_lc_read_button"
    assert eval vn_parameter_get("lc_read_value") == 37
    screenshot "lifecycle-shared-variable.png"
    click id "vn_component_lc_back"
    pause until eval renpy.get_screen("preferences") is None and vn_current_line == "lc_wait"
    run Function(vn_parameter_set, "lc_slot_keep", 101)
    run Function(vn_parameter_set, "lc_local_reset", 103)
    run Function(vn_parameter_set, "lc_local_keep", 104)
    run Function(vn_parameter_set, "lc_legacy", 105)
    run Function(vn_parameter_set, "lc_progress", 106)
    assert eval qa_lifecycle_values() == [101, 37, 103, 104, 105, 106, 37]
    # Write a real Ren'Py save, change every value, then load the unchanged file.
    run FileSave("parameter_lifecycle", confirm=False, slot=True)
    assert eval FileLoadable("parameter_lifecycle", slot=True)
    run Function(vn_parameter_set, "lc_slot_keep", 201)
    run Function(vn_parameter_set, "lc_slot_reset", 202)
    run Function(vn_parameter_set, "lc_local_reset", 203)
    run Function(vn_parameter_set, "lc_local_keep", 204)
    run Function(vn_parameter_set, "lc_legacy", 205)
    run Function(vn_parameter_set, "lc_progress", 206)
    run Function(vn_parameter_set, "lc_read_value", 999)
    assert eval qa_lifecycle_values() == [201, 202, 203, 204, 205, 206, 999]
    run FileLoad("parameter_lifecycle", confirm=False, slot=True)
    pause until eval vn_current_line == "lc_wait" and renpy.get_screen("say") is not None
    assert eval qa_lifecycle_values() == [101, 37, 203, 204, 205, 206, 37]
    run ShowMenu("preferences")
    pause until screen "preferences"
    assert eval qa_no_automatic_parameter_ui()
    assert eval vn_ui_control_get("lc_slider") == 37
    screenshot "lifecycle-after-load.png"
    # Reset qualification is independent of local storage and current grouping.
    run Function(vn_reset_preferences)
    assert eval qa_lifecycle_values() == [101, 2, 3, 204, 5, 206, 37]
    assert eval vn_ui_control_get("lc_slider") == 2
    screenshot "lifecycle-after-settings-reset.png"
    # New game resets all save-slot values, and retains every local value even
    # when that local variable participates in an explicit settings reset.
    run Function(vn_parameter_set, "lc_slot_keep", 301)
    run Function(vn_parameter_set, "lc_slot_reset", 302)
    run Function(vn_parameter_set, "lc_local_reset", 303)
    run Function(vn_parameter_set, "lc_local_keep", 304)
    run Function(vn_parameter_set, "lc_legacy", 305)
    run Function(vn_parameter_set, "lc_progress", 306)
    run Function(vn_parameter_set, "lc_read_value", 333)
    click id "vn_component_lc_back"
    pause until eval renpy.get_screen("preferences") is None
    run MainMenu(confirm=False)
    pause until screen "main_menu"
    run Start()
    pause until eval vn_current_line == "lc_wait" and renpy.get_screen("say") is not None
    assert eval qa_lifecycle_values() == [1, 2, 303, 304, 305, 306, -1]
    run ShowMenu("preferences")
    pause until screen "preferences"
    assert eval qa_no_automatic_parameter_ui()
    assert eval vn_ui_control_get("lc_slider") == 2
    screenshot "lifecycle-after-new-game.png"
    # Finish the restarted game's menu context before the test runner exits,
    # matching the real navigation cleanup used by other save/load acceptance.
    click id "vn_component_lc_back"
    pause until eval renpy.get_screen("preferences") is None
    run MainMenu(confirm=False)
    pause until screen "main_menu"
`;
try {
  for (const mode of ['custom', 'replaced', 'atomic', 'lifecycle'] as const) {
    const folder = path.join(output, mode), source = path.join(folder, 'source'), game = path.join(folder, 'game');
    await fs.mkdir(source, { recursive: true });
    const current: Record<string, unknown> = { mode, status: 'running' }; reports.push(current);
    console.log(JSON.stringify({ mode, status: 'running', folder }));
    let preserved = false;
    try {
      await isolateRenpySaves(folder);
      const project = mode === 'lifecycle' ? parameterLifecycleFixture() : uiMoreSettingsFixture(mode === 'replaced' ? 'replaced' : 'custom');
      if (mode === 'atomic') addResetValidationControl(project); else if (mode !== 'lifecycle') placeParameterControls(project);
      if (mode === 'lifecycle') current.policies = project.variables.map(variable => ({ id: variable.id, persistent: variable.persistent, resetWithSettings: variable.resetWithSettings ?? 'legacy-settings-group', parameterSetId: variable.parameterSetId }));
      await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(project));
      const built = await buildProject({ project, projectDir: source, outputDir: game, sdkRoot: sdk });
      await fs.writeFile(path.join(folder, 'compile.log'), built.log + '\n' + JSON.stringify(built.diagnostics, null, 2));
      assert.ok(built.ok, built.log + '\n' + JSON.stringify(built.diagnostics));
      const testcases = header + (mode === 'atomic' ? rejectionCase : mode === 'lifecycle' ? lifecycleCase : explicitCase);
      await fs.writeFile(path.join(folder, 'testcases.rpy'), testcases); await fs.writeFile(path.join(game, 'game/testcases.rpy'), testcases);
      current.expectedAssertions = testcases.split('\n').filter(line => line.trim().startsWith('assert ')).length;
      const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(folder, 'saves'), timeoutMs: 120000, onData: text => process.stdout.write(text), env: { RENPY_RENDERER: 'gl2', PYTHONUNBUFFERED: '1' } });
      await fs.writeFile(path.join(folder, 'runtime.log'), result.log);
      current.code = result.code; current.assertions = Number(result.log.match(/Assertions\s*:\s*(\d+)/)?.[1] ?? NaN);
      current.cases = Number(result.log.match(/Test cases\s*:\s*(\d+)/)?.[1] ?? NaN);
      assert.ok(result.code === 0 && /Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log), result.log.slice(-9000));
      assert.equal(current.assertions, current.expectedAssertions, 'Native executed assertion count must match the authored case.'); current.status = 'passed';
      console.log(JSON.stringify({ mode, status: current.status, code: current.code, cases: current.cases, assertions: current.assertions }));
    } catch (error) { current.status = 'failed'; current.error = String(error); throw error; }
    finally {
      try {
        for (const directory of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) {
          if (await fs.stat(directory).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(directory, path.join(folder, 'screenshots'), { recursive: true });
        }
        for (const filename of ['errors.txt', 'traceback.txt', 'log.txt']) {
          if (await fs.stat(path.join(game, filename)).then(stat => stat.isFile()).catch(() => false)) await fs.copyFile(path.join(game, filename), path.join(folder, filename));
        }
        preserved = true;
      } finally {
        if (!preserved) throw new Error('Evidence preservation failed; retained this run for review.');
        current.cleanup = await cleanVerificationDirectories(folder, ['source', 'game', 'saves', 'renpy-saves']);
        assert.deepEqual((current.cleanup as { errors: unknown[] }).errors, []);
      }
    }
  }
  report.status = 'passed';
} catch (error) { failure = error; report.status = 'failed'; report.error = String(error); }
finally {
  if (previousSaves === undefined) delete process.env.RENPY_PATH_TO_SAVES; else process.env.RENPY_PATH_TO_SAVES = previousSaves;
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
}
if (failure) throw failure;
