import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createBlueprintTaskOwnershipFixture } from './lib/blueprint-task-ownership-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';

const sdk = process.env.VNS_RENPY_SDK ?? path.resolve('resources/runtime');
const output = path.resolve('artifacts/blueprint-task-ownership-runtime', new Date().toISOString().replaceAll(':', '-'));
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
  const f = createBlueprintTaskOwnershipFixture(), original = structuredClone(f.project);
  assert.deepEqual(compileProject(f.project).diagnostics.filter(issue => issue.severity === 'error'), []); assert.deepEqual(f.project, original);
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(f.project, null, 2));
  const built = await buildProject({ project: f.project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  const start = ['    pause until screen "main_menu"', '    click id "vn_main_start" pos (.5, .5)', '    pause until eval "ownership_page" in vn_ui_open_pages', '    move pos (8, 8)'];
  const tests = String.raw`default vn_test_ownership_a = 0.0
default vn_test_ownership_b = 0.0

init 1000 python:
    def vn_test_ownership_active():
        return [record for record in vn_bp_async_tasks.values() if vn_bp_async_active(record)]

    def vn_test_ownership_start(graph, node, seconds=0.0, arguments=None):
        return vn_bp_async_start("page", "ownership_page", @@PAGEGRAPH@@, node, graph, arguments or {}, seconds, "parallel")["handle"]

    def vn_test_ownership_complete(handle, now):
        for index in range(16):
            if not vn_bp_async_active(vn_bp_async_tasks.get(handle, {})): return
            if not vn_bp_async_step(handle, now): raise Exception("Expected ready task step")
        raise Exception("Fixture task failed to terminate within its small graph")

    def vn_test_ownership_retention():
        old = vn_test_ownership_start(@@FAST@@, "old", 120)
        earliest = None
        for index in range(512):
            handle = vn_test_ownership_start(@@FAST@@, "fast:" + str(index))
            if earliest is None: earliest = handle
            vn_test_ownership_complete(handle, vn_bp_time_now())
        before = len(vn_bp_async_tasks) == 513 and vn_bp_async_result(old)["status"] == "queued"
        vn_test_ownership_complete(old, vn_bp_time_now() + 121)
        return (before and len(vn_bp_async_tasks) == 512 and vn_bp_async_result(earliest)["status"] == "missing"
            and vn_bp_async_result(old)["outputs"] == {"false_value": False, "empty_value": ""})

    def vn_test_ownership_unknown_delayed_record():
        handle = vn_test_ownership_start(@@FAST@@, "unknown-record", 120)
        original = dict(vn_bp_async_tasks[handle], version=77)
        vn_bp_async_tasks[handle] = original
        advanced = vn_bp_async_step(handle, vn_bp_time_now())
        result = vn_bp_async_result(handle)
        return advanced and result["status"] == "failed" and result["reason"] == "unsupportedTaskVersion" and vn_bp_async_tasks[handle]["recovery"] == original

    def vn_test_ownership_prepare_legacy_frame():
        global vn_bp_frame, vn_bp_live_frames
        previous = vn_bp_frame
        if not previous: raise Exception("The story page must have a real saved base invocation")
        original = dict(previous, locals=dict(previous.get("locals", {}), legacy_number=0, legacy_bool=False, legacy_text=""),
            controls=dict(previous.get("controls", {}), legacy_gate=True), temporal=dict(previous.get("temporal", {}), legacy_throttle=vn_bp_time_now() + 8))
        vn_bp_live_frames = {key: value for key, value in vn_bp_live_frames.items() if key != str(original.get("id"))}
        original.pop("id", None)
        vn_bp_frame = original
        renpy.test.testexecution.ownership_legacy_frame = __import__("copy").deepcopy(original)
        renpy.retain_after_load()

    def vn_test_ownership_adopt_legacy_frame():
        previous = renpy.test.testexecution.ownership_legacy_frame
        current = vn_bp_require_frame(previous["graph"])
        preserved = (current is not previous and current["locals"] == previous["locals"] and current["controls"] == previous["controls"]
            and current["temporal"] == previous["temporal"] and all(current["values"].get(k) == v for k, v in previous.get("values", {}).items())
            and str(current["id"]) in vn_bp_live_frames)
        started = vn_bp_async_start("call", "", previous["graph"], "legacy-child", @@FAST@@, {}, 60, "parallel")["handle"]
        vn_bp_release_frame(current)
        ended = vn_bp_async_result(started)["reason"] == "callEnded"
        # The real saved script still owns its invocation until the page returns.
        vn_bp_require_frame(previous["graph"])
        return preserved and ended

    def vn_test_ownership_reject_without_call():
        global vn_bp_frame
        before = vn_bp_frame
        try:
            vn_bp_frame = None
            try:
                vn_bp_require_frame(@@PAGEGRAPH@@)
                return False
            except Exception:
                return True
        finally:
            vn_bp_frame = before

    def vn_test_ownership_short_parent():
        global vn_var_ownership_parent
        vn_var_ownership_parent = vn_test_ownership_start(@@PARENT@@, "short-parent", arguments={"lifetime": .05})

testsuite global:
    before testcase:
        $ _test.timeout = 18.0
        $ _test.transition_timeout = 0.05
        $ preferences.text_cps = 0
        $ _test.screenshot_directory = "tests/screenshots"
    after testcase:
        if eval not main_menu:
            run MainMenu(confirm=False)
        pause until screen "main_menu"
        assert eval not vn_bp_async_tasks and not vn_bp_live_frames and not vn_ui_animations
    teardown:
        exit

testcase exact_active_capacity_and_blocked_route:
@@START@@
    click id "vn_component_ownership_action_fill"
    click id "vn_component_ownership_action_fill"
    click id "vn_component_ownership_action_single"
    assert eval len(vn_test_ownership_active()) == 256 and vn_var_ownership_assigned == 256 and vn_var_ownership_blocked == 1
    assert eval vn_var_ownership_first == "" and len(vn_bp_async_tasks) == 256
    screenshot "task-exact-capacity"

testcase replace_at_capacity_frees_only_the_same_group:
@@START@@
    click id "vn_component_ownership_action_replace"
    $ renpy.test.testexecution.ownership_replaced = vn_var_ownership_replace
    click id "vn_component_ownership_action_fill"
    click id "vn_component_ownership_action_fill"
    click id "vn_component_ownership_action_replace"
    assert eval len(vn_test_ownership_active()) == 256 and vn_var_ownership_blocked == 1
    assert eval vn_var_ownership_replace != renpy.test.testexecution.ownership_replaced
    assert eval vn_bp_async_result(renpy.test.testexecution.ownership_replaced)["reason"] == "replaced"

testcase ignore_at_capacity_keeps_the_original_handle:
@@START@@
    click id "vn_component_ownership_action_ignore"
    $ renpy.test.testexecution.ownership_ignored = vn_var_ownership_ignore
    click id "vn_component_ownership_action_fill"
    click id "vn_component_ownership_action_fill"
    click id "vn_component_ownership_action_ignore"
    assert eval len(vn_test_ownership_active()) == 256 and vn_var_ownership_blocked == 2
    assert eval vn_var_ownership_ignore == renpy.test.testexecution.ownership_ignored

testcase completion_order_512_results_and_expired_missing:
@@START@@
    $ vn_test_assert_result = vn_test_ownership_retention()
    assert eval vn_test_assert_result
    assert eval not vn_test_ownership_active() and not any(record.get("kind") == "async" for record in vn_bp_live_frames.values())

testcase three_task_cycle_is_not_a_permanent_wait:
@@START@@
    click id "vn_component_ownership_action_cycles"
    pause until eval not vn_test_ownership_active()
    assert eval sum(1 for record in vn_bp_async_tasks.values() if record.get("reason") == "dependencyCycle") == 1
    assert eval sum(1 for record in vn_bp_async_tasks.values() if record["status"] == "completed") == 2 and vn_var_ownership_resumes == 2
    assert eval not any(record.get("kind") == "async" for record in vn_bp_live_frames.values())

testcase nested_cancel_releases_call_owned_child_not_page_child:
@@START@@
    click id "vn_component_ownership_action_parent"
    pause until eval vn_var_ownership_page_child != ""
    assert eval len(vn_bp_async_tasks[vn_var_ownership_parent]["stack"]) == 2 and vn_var_ownership_side_effect == 42
    click id "vn_component_ownership_action_cancelparent"
    assert eval vn_bp_async_result(vn_var_ownership_parent)["status"] == "cancelled"
    assert eval vn_bp_async_result(vn_var_ownership_call_child)["reason"] == "callEnded"
    pause until eval vn_bp_async_result(vn_var_ownership_page_child)["status"] == "completed"
    assert eval vn_var_ownership_late == 0 and vn_var_ownership_side_effect == 42
    assert eval not any(record.get("kind") == "async" for record in vn_bp_live_frames.values())

testcase normal_parent_completion_ends_call_lease_but_not_page_child:
@@START@@
    $ vn_test_ownership_short_parent()
    pause until eval vn_bp_async_result(vn_var_ownership_parent)["status"] == "completed"
    assert eval vn_bp_async_result(vn_var_ownership_call_child)["reason"] == "callEnded" and vn_var_ownership_late == 1
    pause until eval vn_bp_async_result(vn_var_ownership_page_child)["status"] == "completed"
    assert eval not vn_test_ownership_active()

testcase cancelled_multitrack_task_does_not_stop_a_newer_track:
@@START@@
    click id "vn_component_ownership_action_clip"
    pause until eval vn_ui_get("ownership_target_b", "opacity") < .9
    click id "vn_component_ownership_action_wait"
    click id "vn_component_ownership_action_override"
    pause .08
    click id "vn_component_ownership_action_cancelanimation"
    $ vn_test_ownership_b = vn_ui_get("ownership_target_b", "opacity")
    assert eval vn_bp_async_result(vn_var_ownership_animation)["status"] == "cancelled"
    assert eval all((state.get("task") or {}).get("async") != vn_var_ownership_animation for state in vn_ui_animations.values())
    pause until eval vn_var_ownership_wait_cancelled == 1
    pause .6
    assert eval vn_ui_get("ownership_target_a", "opacity") == 1 and abs(vn_ui_get("ownership_target_b", "opacity") - vn_test_ownership_b) < .002
    assert eval vn_var_ownership_late == 0 and vn_var_ownership_wait_completed == 0 and vn_var_ownership_wait_cancelled == 1
    screenshot "task-cancel-preserves-newer-owner"

testcase successful_detached_animation_survives_result_completion:
@@START@@
    click id "vn_component_ownership_action_detached"
    pause until eval vn_bp_async_result(vn_var_ownership_animation)["status"] == "completed"
    assert eval 0 < vn_ui_get("ownership_target_a", "opacity") < 1
    pause until eval vn_ui_get("ownership_target_a", "opacity") == 0
    assert eval not vn_ui_animations

testcase cancelled_detached_animation_stops_without_rolling_back:
@@START@@
    $ vn_var_ownership_animation = vn_test_ownership_start(@@DETACHED@@, "cancel-detached", arguments={"hold": 2.0})
    pause until eval 0 < vn_ui_get("ownership_target_a", "opacity") < 1
    click id "vn_component_ownership_action_cancelanimation"
    $ vn_test_ownership_a = vn_ui_get("ownership_target_a", "opacity")
    assert eval vn_bp_async_result(vn_var_ownership_animation)["status"] == "cancelled" and not vn_ui_animations
    pause .3
    assert eval abs(vn_ui_get("ownership_target_a", "opacity") - vn_test_ownership_a) < .002

testcase unknown_delayed_record_is_rejected_before_its_far_future_due_time:
@@START@@
    $ vn_test_assert_result = vn_test_ownership_unknown_delayed_record()
    assert eval vn_test_assert_result

testcase real_saved_legacy_call_without_lease_is_adopted_without_data_loss:
@@START@@
    $ vn_test_assert_result = vn_test_ownership_reject_without_call()
    assert eval vn_test_assert_result
    $ vn_test_ownership_prepare_legacy_frame()
    $ renpy.save("task-legacy-frame")
    click id "vn_component_ownership_action_single"
    run FileLoad("task-legacy-frame", confirm=False, slot=True)
    $ vn_test_assert_result = vn_test_ownership_adopt_legacy_frame()
    assert eval vn_test_assert_result
    click id "vn_component_ownership_action_close"
    pause until "任务所有者页关闭后继续。"
    assert eval not vn_bp_live_frames and not vn_ui_open_pages

testcase saved_nested_tasks_restore_their_call_and_page_leases:
@@START@@
    click id "vn_component_ownership_action_parent"
    pause until eval vn_var_ownership_page_child != ""
    $ renpy.save("task-nested-owners")
    click id "vn_component_ownership_action_cancelparent"
    run FileLoad("task-nested-owners", confirm=False, slot=True)
    assert eval vn_bp_async_result(vn_var_ownership_parent)["status"] in ("running", "waiting")
    assert eval vn_bp_async_result(vn_var_ownership_call_child)["status"] in ("queued", "running", "waiting")
    click id "vn_component_ownership_action_cancelparent"
    assert eval vn_bp_async_result(vn_var_ownership_call_child)["reason"] == "callEnded"
    pause until eval vn_bp_async_result(vn_var_ownership_page_child)["status"] == "completed"
    assert eval vn_var_ownership_late == 0

testcase page_close_cancels_every_owner_and_new_game_is_clean:
@@START@@
    click id "vn_component_ownership_action_parent"
    click id "vn_component_ownership_action_single"
    pause until eval vn_var_ownership_page_child != ""
    click id "vn_component_ownership_action_close"
    pause until "任务所有者页关闭后继续。"
    assert eval not vn_test_ownership_active() and not vn_bp_live_frames and vn_var_ownership_side_effect == 42 and vn_var_ownership_late == 0
    run MainMenu(confirm=False)
    pause until screen "main_menu"
    click id "vn_main_start" pos (.5, .5)
    pause until eval "ownership_page" in vn_ui_open_pages
    assert eval not vn_bp_async_tasks and vn_var_ownership_side_effect == 0 and vn_var_ownership_late == 0
`.replaceAll('@@START@@', start.join('\n')).replaceAll('@@FAST@@', JSON.stringify(f.fast.id)).replaceAll('@@PARENT@@', JSON.stringify(f.parent.id)).replaceAll('@@PAGEGRAPH@@', JSON.stringify(f.pageGraph.id)).replaceAll('@@DETACHED@@', JSON.stringify(f.detachedAnimation.id));
  await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 240000 };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  const native = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  await check('runtime', native); report.cases = (tests.match(/^testcase /gm) ?? []).length;
  assert.match(native.log, new RegExp('Test cases\\s*:\\s*' + report.cases + '\\s*\\|\\s*' + report.cases + ' passed'));
  report.assertions = Number(native.log.match(/Assertions\s*:\s*(\d+)/)?.[1]);
  assert.equal(report.assertions, (tests.match(/^    assert /gm) ?? []).length + report.cases!);
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
