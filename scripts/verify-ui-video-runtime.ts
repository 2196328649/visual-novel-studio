import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createUiVideoFixture, writeUiVideoFixtureAssets } from './lib/ui-video-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';

const sdk = process.env.VNS_RENPY_SDK ?? 'E:/Tools/renpy-8.5.3-sdk';
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts', 'ui-video-runtime', new Date().toISOString().replaceAll(':', '-'));
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
  const f = createUiVideoFixture(), original = structuredClone(f.project);
  assert.deepEqual(compileProject(f.project).diagnostics.filter(issue => issue.severity === 'error'), []); assert.deepEqual(f.project, original);
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(f.project, null, 2));
  await writeUiVideoFixtureAssets(source);
  const built = await buildProject({ project: f.project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  const start = ['    pause until screen "main_menu"', '    click id "vn_main_start" pos (0.5, 0.5)', '    pause until eval ("video_page" in vn_ui_open_pages)', '    move pos (8, 8)'];
  const tests = String.raw`default vn_test_video_position = 0.0
default vn_test_video_token = None
default vn_test_video_sequence = 0

init 1000 python:
    def vn_test_video_reject(property, value):
        before = __import__("copy").deepcopy(vn_ui_overrides)
        try:
            vn_ui_set("movie", property, value)
        except Exception:
            return before == vn_ui_overrides
        return False

    def vn_test_video_unknown_record():
        original = {"version": 77, "payload": ["保留", 0, False]}
        vn_ui_video_states["movie"] = original
        rejected = vn_ui_get("movie", "videoStatus") == "failed"
        try:
            vn_ui_video_control("movie", "play")
            return False
        except Exception:
            pass
        vn_ui_reset("movie")
        return rejected and vn_ui_video_recovery["movie"] == original and vn_ui_video_states["movie"]["version"] == 1

    def vn_test_video_old_owner_cleanup():
        component_id = "movie_child"
        previous = dict(vn_ui_video_live()[component_id])
        old_token = vn_ui_page_token("video_child")
        vn_ui_close_page("video_child", "")
        vn_ui_open_page("video_child")
        vn_ui_set(component_id, "videoLoop", False)
        current = vn_ui_video_states[component_id]
        vn_ui_video_live()[component_id] = previous
        vn_ui_video_poll()
        return vn_ui_page_token("video_child") != old_token and vn_ui_video_states.get(component_id) is current

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

testcase real_frames_metadata_and_once_only_terminal_event:
@@START@@
    pause until eval vn_ui_get("movie", "videoPlaying")
    assert eval vn_ui_get("movie", "videoDurationKnown") and 1.5 < vn_ui_get("movie", "videoDuration") < 2.5
    assert eval not vn_ui_get("movie", "videoCanSeek") and vn_var_video_ended == 0 and vn_var_video_failed == 0
    screenshot "video-actual-decoded-frames"
    pause until eval vn_var_video_ended == 1
    click id "vn_component_video_action_observe"
    assert eval vn_var_video_status == "ended" and vn_var_video_progress == 1
    assert eval vn_var_video_event_asset == "movie_a" and vn_var_video_event_known and vn_var_video_event_error == ""
    assert eval abs(vn_var_video_event_position - vn_var_video_event_duration) < .03
    $ renpy.restart_interaction()
    pause .2
    assert eval vn_var_video_ended == 1 and vn_var_video_failed == 0
    screenshot "video-ended-poster"

testcase pause_resume_stop_and_restart:
@@START@@
    pause until eval vn_ui_get("movie", "videoPosition") > .15
    click id "vn_component_video_action_pause"
    $ vn_test_video_position = vn_ui_get("movie", "videoPosition")
    pause .3
    assert eval vn_ui_get("movie", "videoPaused") and abs(vn_ui_get("movie", "videoPosition") - vn_test_video_position) < .08
    assert eval vn_ui_get("movie_mirror", "videoPlaying")
    screenshot "video-paused-independent-instance"
    click id "vn_component_video_action_resume"
    pause until eval vn_ui_get("movie", "videoPosition") > vn_test_video_position + .1
    click id "vn_component_video_action_stop"
    pause .2
    assert eval vn_ui_get("movie", "videoStatus") == "stopped" and vn_ui_get("movie", "videoPosition") == 0
    assert eval vn_var_video_ended == 0 and vn_var_video_failed == 0
    click id "vn_component_video_action_play"
    pause until eval vn_ui_get("movie", "videoPlaying")
    assert eval vn_ui_get("movie", "videoPosition") < 1
    click id "vn_component_video_action_restart"
    pause until eval vn_ui_get("movie", "videoPlaying")
    assert eval vn_ui_get("movie", "videoPosition") < .5

testcase loop_boundary_and_toggling_do_not_restart_current_segment:
@@START@@
    click id "vn_component_video_action_loop"
    pause until eval vn_ui_get("movie", "videoPlaying")
    pause 4.4
    assert eval vn_var_video_ended == 0 and vn_var_video_failed == 0 and vn_ui_get("movie", "videoLoop")
    pause until eval .2 < vn_ui_get("movie", "videoPosition") < 1.2
    $ vn_test_video_position = vn_ui_get("movie", "videoPosition")
    click id "vn_component_video_action_once"
    assert eval vn_ui_get("movie", "videoPosition") >= vn_test_video_position - .1
    pause until eval vn_var_video_ended == 1
    assert eval vn_ui_get("movie", "videoStatus") == "ended" and not vn_ui_get("movie", "videoLoop")

testcase source_identity_clear_restore_and_blueprint_only_resource:
@@START@@
    pause until eval vn_ui_get("movie", "videoPosition") > .15
    $ vn_test_video_position = vn_ui_get("movie", "videoPosition")
    $ vn_test_video_sequence = vn_ui_video_states["movie"]["sourceSequence"]
    click id "vn_component_video_action_same"
    assert eval vn_ui_video_states["movie"]["sourceSequence"] == vn_test_video_sequence and vn_ui_get("movie", "videoPosition") >= vn_test_video_position - .05
    click id "vn_component_video_action_swap"
    pause until eval vn_ui_get("movie", "videoPlaying")
    assert eval vn_ui_get("movie", "video") == "movie_b" and vn_ui_get("movie", "videoPosition") < 1
    assert eval vn_ui_get("movie", "videoDurationKnown") and 2.5 < vn_ui_get("movie", "videoDuration") < 3.5
    click id "vn_component_video_action_restore"
    pause until eval vn_ui_get("movie", "videoPlaying")
    assert eval vn_ui_video_states["movie"]["sourceSequence"] > vn_test_video_sequence and vn_ui_get("movie", "video") == "movie_a"
    click id "vn_component_video_action_clear"
    pause .1
    assert eval vn_ui_get("movie", "videoStatus") == "empty" and renpy.music.get_playing(channel=vn_ui_videos["movie"]["channel"]) is None
    assert eval vn_var_video_ended == 0 and vn_var_video_failed == 0
    screenshot "video-cleared-poster"

testcase genuine_decoder_failure_and_explicit_recovery:
@@START@@
    click id "vn_component_video_action_fail"
    pause until eval vn_var_video_failed == 1
    assert eval vn_ui_get("movie", "videoStatus") == "failed" and vn_var_video_event_asset == "movie_broken" and vn_var_video_event_error != ""
    pause .2
    assert eval vn_var_video_failed == 1 and vn_var_video_ended == 0
    screenshot "video-real-decoder-failure"
    click id "vn_component_video_action_stop"
    click id "vn_component_video_action_play"
    pause until eval vn_var_video_failed == 2
    $ vn_test_assert_result = vn_test_video_reject("videoPosition", .5) and vn_test_video_reject("video", "movie_poster")
    assert eval vn_test_assert_result
    $ vn_test_assert_result = vn_test_video_reject("videoLoop", "false") and vn_test_video_unknown_record()
    assert eval vn_test_assert_result
    pause until eval vn_ui_get("movie", "videoPlaying")
    assert eval vn_ui_get("movie", "video") == "movie_a" and vn_ui_get("movie", "videoError") == ""

testcase hidden_and_author_pause_are_independent:
@@START@@
    pause until eval vn_ui_get("movie", "videoPosition") > .15
    click id "vn_component_video_action_hide"
    pause .05
    $ vn_test_video_position = vn_ui_get("movie", "videoPosition")
    pause .3
    assert eval vn_ui_get("movie", "videoPaused") and abs(vn_ui_get("movie", "videoPosition") - vn_test_video_position) < .08
    click id "vn_component_video_action_show"
    pause until eval vn_ui_get("movie", "videoPosition") > vn_test_video_position + .1
    click id "vn_component_video_action_pause"
    click id "vn_component_video_action_hide"
    click id "vn_component_video_action_show"
    $ vn_test_video_position = vn_ui_get("movie", "videoPosition")
    pause .2
    assert eval vn_ui_get("movie", "videoPaused") and abs(vn_ui_get("movie", "videoPosition") - vn_test_video_position) < .08
    assert eval vn_var_video_ended == 0

testcase nested_pages_native_template_and_late_old_owner:
@@START@@
    click id "vn_component_video_action_child"
    pause until eval vn_ui_get("movie_child", "videoPlaying")
    assert eval not vn_ui_video_states["movie"]["suspended"]
    pause until eval vn_var_video_ended == 1
    assert eval vn_ui_get("movie_child", "videoPlaying") and vn_var_video_failed == 0
    $ vn_test_assert_result = vn_test_video_old_owner_cleanup()
    assert eval vn_test_assert_result
    pause until eval vn_ui_get("movie_child", "videoPlaying")
    screenshot "video-modal-child-and-old-owner-isolation"
    click id "vn_component_video_child_close"
    pause until eval "video_child" not in vn_ui_open_pages
    assert eval "movie_child" not in vn_ui_video_states and "movie_child" not in vn_ui_video_live()
    click id "vn_component_video_action_reset"
    pause until eval vn_ui_get("movie", "videoPosition") > .15
    click id "vn_component_video_action_native"
    pause until screen "preferences"
    pause until eval vn_ui_get("movie_native", "videoPlaying")
    assert eval vn_ui_get("movie", "videoPaused")
    $ vn_test_video_position = vn_ui_get("movie", "videoPosition")
    pause .2
    assert eval abs(vn_ui_get("movie", "videoPosition") - vn_test_video_position) < .08
    screenshot "video-native-template"
    click id "vn_component_video_native_close"
    pause until eval renpy.get_screen("preferences") is None
    pause until eval vn_ui_get("movie", "videoPosition") > vn_test_video_position + .1
    assert eval "movie_native" not in vn_ui_video_states

testcase background_task_uses_shared_player_state:
@@START@@
    click id "vn_component_video_action_background"
    pause until eval vn_var_video_job_done
    assert eval vn_ui_get("movie", "video") == "movie_b" and vn_ui_get("movie", "videoPaused")
    assert eval vn_var_video_ended == 0 and vn_var_video_failed == 0
    screenshot "video-background-control"

testcase paused_save_load_position_resume_rollback_and_new_game:
@@START@@
    pause until eval vn_ui_get("movie", "videoPosition") > .25
    click id "vn_component_video_action_pause"
    $ vn_test_video_position = vn_ui_get("movie", "videoPosition")
    $ vn_test_video_token = vn_ui_page_token("video_page")
    $ renpy.save("video-state")
    click id "vn_component_video_action_swap"
    pause until eval vn_ui_get("movie", "videoPlaying")
    run FileLoad("video-state", confirm=False, slot=True)
    pause until eval vn_ui_get("movie", "videoPaused")
    assert eval vn_ui_get("movie", "video") == "movie_a" and abs(vn_ui_get("movie", "videoPosition") - vn_test_video_position) < .1
    click id "vn_component_video_action_resume"
    pause until eval vn_ui_get("movie", "videoPlaying")
    assert eval vn_ui_get("movie", "videoPosition") >= vn_test_video_position - .1
    click id "vn_component_video_action_pause"
    click id "vn_component_video_action_close"
    pause until "视频页关闭后继续剧情。"
    assert eval "movie" not in vn_ui_video_states and "movie" not in vn_ui_video_live()
    run Rollback()
    pause until eval "video_page" in vn_ui_open_pages
    assert eval vn_ui_page_token("video_page") == vn_test_video_token and vn_ui_get("movie", "video") == "movie_a"
    assert eval vn_ui_get("movie", "videoPaused") and vn_ui_get("movie", "videoPosition") >= vn_test_video_position - .1
    screenshot "video-restored-from-save-and-rollback"
    run MainMenu(confirm=False)
    pause until screen "main_menu"
    pause until eval not vn_ui_video_live()
    assert eval "movie" not in vn_ui_video_states and not vn_ui_video_live()
    click id "vn_main_start" pos (.5, .5)
    pause until eval vn_ui_get("movie", "videoPlaying")
    assert eval vn_ui_get("movie", "videoPosition") < .6 and vn_var_video_ended == 0 and vn_var_video_failed == 0

testcase terminal_save_does_not_replay_completion:
@@START@@
    pause until eval vn_var_video_ended == 1
    $ renpy.save("video-ended")
    click id "vn_component_video_action_restart"
    pause until eval vn_ui_get("movie", "videoPlaying")
    run FileLoad("video-ended", confirm=False, slot=True)
    pause .2
    assert eval vn_ui_get("movie", "videoStatus") == "ended" and vn_var_video_ended == 1
    assert eval renpy.music.get_playing(channel=vn_ui_videos["movie"]["channel"]) is None
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
