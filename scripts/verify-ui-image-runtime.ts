import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createUiImageFixture, uiImageFixturePng } from './lib/ui-image-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';

const sdk = process.env.VNS_RENPY_SDK ?? 'E:/Tools/renpy-8.5.3-sdk';
const output = path.resolve('artifacts/ui-image-runtime', new Date().toISOString().replaceAll(':', '-'));
const source = path.join(output, 'source'), game = path.join(output, 'game');
const previousSaveRoot = process.env.RENPY_PATH_TO_SAVES;
const report: { status: string; checks: { name: string; code: number; logPath: string }[]; cases?: number; assertions?: number; error?: string; cleanup?: unknown; decoder?: unknown; oversampledPixels?: unknown } = { status: 'running', checks: [] };
await fs.mkdir(path.join(source, 'assets'), { recursive: true });
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  const logPath = path.join(output, name + '.log'); await fs.writeFile(logPath, result.log);
  report.checks.push({ name, code: result.code, logPath }); await save();
  if (result.code) throw new Error(name + ': ' + result.log.slice(-9000));
}
try {
  await isolateRenpySaves(output);
  const f = createUiImageFixture();
  f.project.assets.push({ id: 'picture_oversampled', name: '奇数尺寸透明边缘 @2', kind: 'image', path: 'assets/picture-oversampled@2.png', width: 65, height: 33 });
  const original = structuredClone(f.project);
  assert.deepEqual(compileProject(f.project).diagnostics.filter(issue => issue.severity === 'error'), []); assert.deepEqual(f.project, original);
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(f.project, null, 2));
  await fs.writeFile(path.join(source, 'assets/picture-a.png'), uiImageFixturePng());
  await fs.writeFile(path.join(source, 'assets/picture-b.png'), uiImageFixturePng(true));
  await fs.writeFile(path.join(source, 'assets/picture-broken.png'), 'intentionally invalid image fixture');
  const oversampled = new PNG({ width: 65, height: 33 });
  oversampled.data.fill(0);
  for (let y = 4; y < 29; y++) for (let x = 4; x < 61; x++) {
    const offset = (y * oversampled.width + x) * 4;
    oversampled.data.set([225, 70, 135, 255], offset);
  }
  await fs.writeFile(path.join(source, 'assets/picture-oversampled@2.png'), PNG.sync.write(oversampled));
  const built = await buildProject({ project: f.project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  const start = ['    pause until screen "main_menu"', '    click id "vn_main_start" pos (0.5, 0.5)', '    pause until eval ("image_page" in vn_ui_open_pages)', '    move pos (8, 8)'];
  const rebuilds = Array.from({ length: 8 }, (_, index) => `    $ vn_ui_set("picture", "width", ${index % 2 ? '.42' : '.41'})\n    pause .06\n    $ vn_test_image_note_rebuild()`).join('\n');
  const tests = String.raw`default vn_test_image_token = None

init 1000 python:
    import builtins as vn_test_builtins, json as vn_test_json
    vn_test_image_decode_original = renpy.display.pgrender.load_image
    vn_test_image_decodes = vn_test_builtins.dict()
    vn_test_image_probe = vn_test_builtins.dict()
    vn_test_image_evidence = vn_test_builtins.dict()

    def vn_test_image_decode(filelike, filename, *args, **kwargs):
        key = filename.replace("\\", "/")
        if key in ("assets/picture-a.png", "assets/picture-b.png", "assets/picture-broken.png", "assets/picture-oversampled@2.png"):
            vn_test_image_decodes[key] = vn_test_image_decodes.get(key, 0) + 1
        return vn_test_image_decode_original(filelike, filename, *args, **kwargs)
    renpy.display.pgrender.load_image = vn_test_image_decode

    def vn_test_image_decode_count(name):
        return vn_test_image_decodes.get("assets/picture-" + name + ".png", 0)

    def vn_test_image_begin_rebuilds():
        vn_test_image_probe.update(marker=vn_ui_image_live()["picture"]["marker"], rebuilds=0, before=vn_test_image_decode_count("a"))

    def vn_test_image_note_rebuild():
        marker = vn_ui_image_live()["picture"]["marker"]
        vn_test_image_probe["rebuilds"] += int(marker is not vn_test_image_probe["marker"])
        vn_test_image_probe["marker"] = marker

    def vn_test_image_end_rebuilds():
        vn_test_image_evidence["rebuilds"] = vn_test_builtins.dict(rebuilds=vn_test_image_probe["rebuilds"], before=vn_test_image_probe["before"], after=vn_test_image_decode_count("a"), loadedEvents=vn_var_image_loaded)

    def vn_test_image_write_evidence():
        data = vn_test_builtins.dict(decodes=vn_test_image_decodes, evidence=vn_test_image_evidence, renderer=renpy.get_renderer_info(), cacheSurfaces=config.cache_surfaces)
        with open(config.basedir + "/decoder.json", "w", encoding="utf-8") as stream: vn_test_json.dump(data, stream, indent=2)

    def vn_test_image_reject(property, value):
        before = __import__("copy").deepcopy(vn_ui_overrides)
        try:
            vn_ui_set("picture", property, value)
        except Exception:
            return before == vn_ui_overrides
        return False

    def vn_test_image_stale_report():
        old = dict(vn_ui_image_live()["picture"], status="loaded", error="", width=64, height=32)
        count = vn_var_image_loaded
        vn_ui_set("picture", "image", "picture_b")
        vn_ui_set("picture", "image", "picture_a")
        vn_ui_image_pending()["picture"] = old
        vn_ui_image_poll()
        return vn_var_image_loaded == count and "picture" not in vn_ui_image_loads

    def vn_test_image_unknown_record():
        vn_ui_image_loads["picture"] = {"version": True, "payload": ["保留", 0, False]}
        rejected = vn_ui_get("picture", "imageStatus") == "failed" and "版本" in vn_ui_get("picture", "imageError")
        vn_ui_reset("picture")
        recovered = vn_ui_image_recovery["picture"]
        return rejected and recovered["version"] is True and recovered["payload"] == ["保留", 0, False]

testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
    after testcase:
        $ vn_test_image_write_evidence()
        if eval not main_menu:
            run MainMenu(confirm=False)
        pause until screen "main_menu"
    teardown:
        $ renpy.display.pgrender.load_image = vn_test_image_decode_original
        exit

testcase actual_decoder_and_typed_result_snapshot:
@@START@@
    pause until eval vn_ui_get("picture", "imageStatus") == "loaded"
    assert eval vn_var_image_loaded == 1 and vn_var_image_failed == 0
    assert eval vn_var_image_event_width == 64 and vn_var_image_event_height == 32 and vn_var_image_event_error == ""
    click id "vn_component_image_action_observe"
    assert eval vn_var_image_status == "loaded" and vn_var_image_width == 64 and vn_var_image_height == 32
    $ renpy.restart_interaction()
    pause 0.1
    assert eval vn_var_image_loaded == 1
    screenshot "image-initial-loaded"

testcase crop_flip_tint_all_fits_and_zero_area:
@@START@@
    pause until eval vn_var_image_loaded == 1
    click id "vn_component_image_action_effects"
    assert eval vn_ui_get("picture", "imageCropX") == .25 and vn_ui_get("picture", "imageCropWidth") == .5
    assert eval vn_ui_get("picture", "imageFlipX") and vn_ui_get("picture", "imageFlipY")
    assert eval vn_ui_get("picture", "imageTint") == "#80ffff80"
    assert eval vn_ui_image_crop(64, 32, dict(cropX=.25, cropWidth=.5)) == (16, 0, 32, 32)
    screenshot "image-contain-crop-tint"
    click id "vn_component_image_action_cover"
    assert eval vn_ui_get("picture", "imageFit") == "cover"
    screenshot "image-cover-crop-tint"
    click id "vn_component_image_action_stretch"
    assert eval vn_ui_get("picture", "imageFit") == "stretch"
    screenshot "image-stretch-crop-tint"
    click id "vn_component_image_action_nineslice"
    assert eval vn_ui_get("picture", "imageFit") == "nineSlice"
    screenshot "image-nine-slice-crop-tint"
    $ vn_ui_set("picture", "imageCropWidth", 0)
    assert eval vn_ui_get("picture", "imageStatus") == "loaded"
    assert eval vn_var_image_loaded == 1
    screenshot "image-empty-crop-transparent"
    click id "vn_component_image_action_reset"
    assert eval vn_ui_get("picture", "imageCropX") == 0 and vn_ui_get("picture", "imageCropWidth") == 1
    assert eval not vn_ui_get("picture", "imageFlipX") and vn_ui_get("picture", "imageTint") == "#ffffff"
    assert eval vn_var_image_loaded == 1

testcase missing_decode_failure_clear_restore_and_source_change:
@@START@@
    pause until eval vn_var_image_loaded == 1
    click id "vn_component_image_action_fail"
    pause until eval vn_ui_get("picture", "imageStatus") == "failed"
    assert eval vn_var_image_failed == 1 and vn_var_image_loaded == 1
    assert eval vn_var_image_event_width == 0 and vn_var_image_event_height == 0 and vn_var_image_event_error != ""
    screenshot "image-real-decoder-failure"
    click id "vn_component_image_action_clear"
    assert eval vn_ui_get("picture", "imageStatus") == "empty" and vn_ui_get("picture", "imageSource") == ""
    assert eval vn_var_image_failed == 1 and vn_var_image_loaded == 1
    click id "vn_component_image_action_restore"
    pause until eval vn_var_image_loaded == 2
    assert eval vn_ui_get("picture", "imageSource") == "picture_a" and vn_ui_get("picture", "imageError") == ""
    click id "vn_component_image_action_swap"
    pause until eval vn_var_image_loaded == 3
    assert eval vn_ui_get("picture", "imageSource") == "picture_b"

testcase immutable_rejections_stale_reports_and_explicit_recovery:
@@START@@
    pause until eval vn_var_image_loaded == 1
    $ vn_test_assert_result = vn_test_image_reject("imageCropX", 1.1)
    assert eval vn_test_assert_result
    $ vn_test_assert_result = vn_test_image_reject("imageCropWidth", float("nan"))
    assert eval vn_test_assert_result
    $ vn_test_assert_result = vn_test_image_reject("imageFlipX", 1)
    assert eval vn_test_assert_result
    $ vn_test_assert_result = vn_test_image_reject("imageTint", "red")
    assert eval vn_test_assert_result
    $ vn_test_assert_result = vn_test_image_reject("imageStatus", "loaded")
    assert eval vn_test_assert_result
    $ vn_test_assert_result = vn_test_image_reject("image", "missing")
    assert eval vn_test_assert_result
    $ vn_test_assert_result = vn_test_image_stale_report()
    assert eval vn_test_assert_result
    pause until eval vn_var_image_loaded == 2
    $ vn_test_assert_result = vn_test_image_unknown_record()
    assert eval vn_test_assert_result
    pause until eval vn_ui_get("picture", "imageStatus") == "loaded"
    assert eval vn_ui_image_loads["picture"]["version"] == 1 and type(vn_ui_image_loads["picture"]["version"]) is int

testcase inherited_state_images_and_regular_page_hosts:
@@START@@
    pause until eval vn_ui_get("picture_state", "imageStatus") == "loaded"
    assert eval vn_ui_get("picture_state", "imageSource") == "picture_a"
    move id "vn_component_picture_parent" pos (.5, .5)
    pause until eval vn_ui_get("picture_state", "imageSource") == "picture_b"
    screenshot "image-parent-hover-source"
    move pos (8, 8)
    pause until eval vn_ui_get("picture_state", "imageSource") == "picture_a"
    click id "vn_component_image_action_child"
    pause until eval vn_ui_get("picture_child", "imageStatus") == "loaded"
    $ vn_test_image_token = vn_ui_page_token("image_child")
    screenshot "image-modal-child"
    click id "vn_component_image_child_close"
    pause until eval "image_child" not in vn_ui_open_pages
    assert eval "picture_child" not in vn_ui_image_loads
    click id "vn_component_image_action_child"
    pause until eval vn_ui_get("picture_child", "imageStatus") == "loaded"
    assert eval vn_ui_page_token("image_child") != vn_test_image_token
    click id "vn_component_image_child_close"
    click id "vn_component_image_action_native"
    pause until screen "preferences"
    pause until eval vn_ui_get("picture_native", "imageStatus") == "loaded"
    assert eval vn_ui_get("picture_native", "imageSource") == "picture_b" and vn_ui_get("picture_native", "imageFlipY")
    screenshot "image-native-template"
    click id "vn_component_image_native_close"
    pause until eval renpy.get_screen("preferences") is None
    assert eval "picture_native" not in vn_ui_image_loads

testcase save_load_rollback_close_and_new_game:
@@START@@
    pause until eval vn_var_image_loaded == 1
    click id "vn_component_image_action_effects"
    $ vn_test_image_token = vn_ui_page_token("image_page")
    $ renpy.save("image-state")
    click id "vn_component_image_action_swap"
    pause until eval vn_var_image_loaded == 2
    run FileLoad("image-state", confirm=False, slot=True)
    pause until eval vn_ui_get("picture", "imageStatus") == "loaded"
    assert eval vn_var_image_loaded == 1 and vn_ui_get("picture", "imageSource") == "picture_a"
    assert eval vn_ui_get("picture", "imageCropX") == .25 and vn_ui_get("picture", "imageTint") == "#80ffff80"
    screenshot "image-restored-from-save"
    click id "vn_component_image_action_close"
    pause until "图片页关闭后继续剧情。"
    assert eval "picture" not in vn_ui_image_loads and "picture" not in vn_ui_image_revisions
    run Rollback()
    pause until eval "image_page" in vn_ui_open_pages
    assert eval vn_ui_page_token("image_page") == vn_test_image_token
    assert eval vn_ui_get("picture", "imageCropX") == .25 and vn_var_image_loaded == 1
    run MainMenu(confirm=False)
    pause until screen "main_menu"
    click id "vn_main_start" pos (.5, .5)
    pause until eval vn_var_image_loaded == 1
    assert eval vn_ui_get("picture", "imageCropX") == 0 and vn_ui_get("picture", "imageTint") == "#ffffff"

testcase background_source_change_uses_the_same_image_path:
@@START@@
    pause until eval vn_var_image_loaded == 1
    click id "vn_component_image_action_background"
    pause until eval vn_var_image_job_done
    pause until eval vn_var_image_loaded == 2
    assert eval vn_ui_get("picture", "imageSource") == "picture_b"
    screenshot "image-background-source-change"

testcase automatic_page_timer_preserves_one_load_per_open:
@@START@@
    pause until eval vn_ui_get("picture", "imageStatus") == "loaded"
    assert eval vn_var_image_loaded == 1
    click id "vn_component_image_action_close"
    pause until "图片页关闭后继续剧情。"
    $ vn_ui_open_page("image_page", opening=dict(autoClose=1.2))
    pause until eval vn_ui_get("picture", "imageStatus") == "loaded"
    pause .25
    assert eval "image_page" in vn_ui_open_pages and vn_ui_page_sessions["image_page"]["autoElapsed"] > .1
    assert eval vn_var_image_loaded == 2 and vn_ui_get("picture", "imageSource") == "picture_a"
    pause until eval "image_page" not in vn_ui_open_pages
    assert eval vn_var_image_loaded == 2 and "picture" not in vn_ui_image_loads and "picture" not in vn_ui_image_revisions

testcase rebuilt_images_reuse_decode_and_preserve_physical_oversample_size:
@@START@@
    pause until eval vn_var_image_loaded == 1
    pause .1
    assert eval vn_test_image_decode_count("a") > 0
    $ vn_test_image_begin_rebuilds()
@@REBUILDS@@
    $ vn_test_image_end_rebuilds()
    assert eval vn_test_image_probe["rebuilds"] == 8
    assert eval vn_test_image_decode_count("a") == vn_test_image_probe["before"]
    assert eval vn_var_image_loaded == 1 and vn_ui_get("picture", "imageSourceWidth") == 64 and vn_ui_get("picture", "imageSourceHeight") == 32
    click id "vn_component_image_action_swap"
    pause until eval vn_var_image_loaded == 2
    assert eval vn_ui_get("picture", "imageSource") == "picture_b" and vn_var_image_event_width == 64 and vn_var_image_event_height == 32
    $ vn_test_broken_before = vn_test_image_decode_count("broken")
    click id "vn_component_image_action_fail"
    pause until eval vn_ui_get("picture", "imageStatus") == "failed"
    assert eval vn_test_image_decode_count("broken") > vn_test_broken_before and vn_var_image_failed == 1
    assert eval vn_var_image_event_width == 0 and vn_var_image_event_height == 0 and vn_var_image_event_error != ""
    $ vn_ui_set("picture", "image", "picture_oversampled")
    pause until eval vn_var_image_loaded == 3
    assert eval vn_ui_get("picture", "imageSource") == "picture_oversampled" and vn_ui_get("picture", "imageError") == ""
    assert eval vn_ui_get("picture", "imageSourceWidth") == 65 and vn_ui_get("picture", "imageSourceHeight") == 33
    assert eval type(vn_var_image_event_width) is int and type(vn_var_image_event_height) is int and vn_var_image_event_width == 65 and vn_var_image_event_height == 33
    assert eval vn_test_image_decode_count("oversampled@2") > 0
    $ vn_test_image_evidence["oversampled"] = vn_test_builtins.dict(width=vn_var_image_event_width, height=vn_var_image_event_height, decodes=vn_test_image_decode_count("oversampled@2"))
    move pos (8, 8)
    pause .15
    screenshot "image-oversampled-odd-transparent"
`.replaceAll('@@START@@', start.join('\n')).replaceAll('@@REBUILDS@@', rebuilds);
  await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 240000 };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  const native = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  await check('runtime', native); report.cases = (tests.match(/^testcase /gm) ?? []).length;
  assert.match(native.log, new RegExp('Test cases\\s*:\\s*' + report.cases + '\\s*\\|\\s*' + report.cases + ' passed'));
  report.assertions = Number(native.log.match(/Assertions\s*:\s*(\d+)/)?.[1]);
  assert.equal(report.assertions, (tests.match(/^    assert /gm) ?? []).length);
  report.decoder = JSON.parse(await fs.readFile(path.join(game, 'decoder.json'), 'utf8'));
  let oversampleScreenshot: string | undefined;
  for (const directory of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) {
    const files = await fs.readdir(directory).catch(() => []);
    const filename = files.find(file => file.endsWith('image-oversampled-odd-transparent.png'));
    if (filename) { oversampleScreenshot = path.join(directory, filename); break; }
  }
  assert.ok(oversampleScreenshot, 'The odd-sized oversampled image must produce an actual screenshot.');
  const actual = PNG.sync.read(await fs.readFile(oversampleScreenshot));
  const pixel = (x: number, y: number) => {
    const offset = (Math.round(y * actual.height / 720) * actual.width + Math.round(x * actual.width / 1280)) * 4;
    return [...actual.data.subarray(offset, offset + 3)];
  };
  const content = pixel(180, 85), transparentBorder = pixel(96, 35);
  report.oversampledPixels = { screenshot: 'screenshots/' + path.basename(oversampleScreenshot), size: [actual.width, actual.height], content, transparentBorder };
  assert.ok(content.every((channel, index) => Math.abs(channel - [225, 70, 135][index]) <= 5), 'The loaded @2 image must actually draw its authored opaque content.');
  assert.ok(transparentBorder.every((channel, index) => Math.abs(channel - [38, 56, 71][index]) <= 5), 'The transparent edge must preserve the actual page background.');
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); process.exitCode = 1; }
finally {
  try {
    if (await fs.stat(path.join(game, 'decoder.json')).catch(() => undefined)) await fs.copyFile(path.join(game, 'decoder.json'), path.join(output, 'decoder.json'));
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
