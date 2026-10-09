import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { projectSchema } from '../src/core/model';
import { portraitPlacement } from '../src/core/portrait';
import { displayPresetPlacement } from '../src/core/character-presets';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral } from '../src/runtime/literals';
import { chapterSource } from '../src/core/chapter';

const root = path.resolve('.'), template = path.join(root, 'resources/templates/aihong');
const output = path.join(root, 'artifacts/presentation-fidelity-1.3.0', new Date().toISOString().replaceAll(':', '-'));
const build = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const report: Record<string, unknown> = { status: 'running', output };
await fs.mkdir(output, { recursive: true });
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
try {
  const p = projectSchema.parse(JSON.parse(await fs.readFile(path.join(template, 'project.vns.json'), 'utf8')));
  p.id = 'presentation_fidelity_' + Date.now();
  p.playerDefaults = { ...p.playerDefaults, fullscreen: false, windowSize: '1280x720' };
  // Hold the noise field still for the uniform-fade measurement. A separate
  // full-screen fixture below checks the shader at two actual animation times.
  p.ui.chapterTransition = { ...p.ui.chapterTransition, rippleSpeed: 0 };
  const chapter = p.nodes.find(n => n.kind === 'chapterTitle')!; assert.ok(chapter.kind === 'chapterTitle');
  const opening = p.nodes.find(n => n.id === 'opening')!; assert.ok(opening.kind === 'passage');
  const titleImage = p.assets.find(a => a.id === chapter.titleImageId)!.path;
  const background = p.assets.find(a => a.id === chapter.backgroundId)!.path;
  const placements = p.characters.flatMap(c => c.expressions.map(e => ({ character: c.id, expression: e.id, expected: portraitPlacement(p, c.id, e.id) })));
  p.characters[0].displayPresets = [{ id: 'left', name: '左', x: .18, y: 1.05, scale: .85, useDefaultFraming: true }];
  p.characters[0].defaultDisplayPresetId = 'left';
  const presets = p.characters.flatMap(c => c.expressions.flatMap(e => ['default', 'left', 'center', 'right'].map(preset => ({ character: c.id, expression: e.id, preset, expected: displayPresetPlacement(p, c.id, e.id, preset) }))));
  const compiled = await buildProject({ project: p, projectDir: template, sdkRoot: sdk, outputDir: build, development: true });
  assert.ok(compiled.ok, compiled.log + JSON.stringify(compiled.diagnostics));
  const diagnostic = new PNG({ width: 320, height: 180 });
  const cornerColors = [[224, 48, 56], [42, 198, 102], [48, 92, 224], [238, 206, 54]];
  for (let y = 0; y < diagnostic.height; y++) for (let x = 0; x < diagnostic.width; x++) {
    const color = cornerColors[(y >= 90 ? 2 : 0) + (x >= 160 ? 1 : 0)];
    diagnostic.data.set([...color.map(channel => x % 20 < 2 || y % 20 < 2 ? channel * .4 : channel), 255], (y * diagnostic.width + x) * 4);
  }
  await fs.writeFile(path.join(build, 'game/ripple-check.png'), PNG.sync.write(diagnostic));
  const captures = [.05, .23, .29, .36, .50, .63, .79, .95];
  await fs.writeFile(path.join(build, 'game/testcases.rpy'), `init python:
    import time as vn_test_time
    import ctypes as vn_test_ctypes
    from ctypes import wintypes as vn_test_win
    vn_test_geometry = []

    def vn_test_client():
        controller = renpy.display.interface.vn_window_geometry
        window, client = controller.rectangles(controller.hwnd)
        return client.right, client.bottom

    def vn_test_window(width, height):
        controller = renpy.display.interface.vn_window_geometry
        window, client = controller.rectangles(controller.hwnd)
        controller.user.SetWindowPos(controller.hwnd, None, 0, 0, width + window.right - window.left - client.right, height + window.bottom - window.top - client.bottom, 0x0016)

    def vn_test_drag_edges():
        controller = renpy.display.interface.vn_window_geometry
        user = controller.user
        user.GetDpiForWindow.argtypes = [vn_test_win.HWND]
        user.AdjustWindowRectExForDpi.argtypes = [vn_test_ctypes.POINTER(vn_test_win.RECT), vn_test_win.DWORD, vn_test_win.BOOL, vn_test_win.DWORD, vn_test_win.UINT]
        user.SendMessageW.argtypes = [vn_test_win.HWND, vn_test_win.UINT, vn_test_win.WPARAM, vn_test_win.LPARAM]
        user.SendMessageW.restype = vn_test_ctypes.c_ssize_t
        window, client = controller.rectangles(controller.hwnd)
        fw, fh = window.right - window.left - client.right, window.bottom - window.top - client.bottom
        for edge in range(1, 9):
            rect = vn_test_win.RECT(100, 100, 1200 + fw, 850 + fh)
            user.SendMessageW(controller.hwnd, 0x0214, edge, vn_test_ctypes.addressof(rect))
            width, height = rect.right - rect.left - fw, rect.bottom - rect.top - fh
            assert abs(height - width * ${p.height / p.width}) <= 1, (edge, width, height)
        for dpi in (96, 120, 144, 192):
            frame = vn_test_win.RECT(0, 0, 1000, 700)
            user.AdjustWindowRectExForDpi(vn_test_ctypes.byref(frame), user.GetWindowLongPtrW(controller.hwnd, -16), False, 0, dpi)
            dw, dh = frame.right - frame.left - 1000, frame.bottom - frame.top - 700
            for edge in range(1, 9):
                proposed = vn_test_win.RECT(0, 0, 1000 + dw, 700 + dh)
                controller.constrain(proposed, edge, dw, dh)
                assert abs((proposed.bottom - proposed.top - dh) - (proposed.right - proposed.left - dw) * ${p.height / p.width}) <= 1
        vn_test_geometry.append({"liveDpi": user.GetDpiForWindow(controller.hwnd), "client": vn_test_client(), "dragEdges": 8, "frameDpis": [96, 120, 144, 192]})

    def vn_test_portraits():
        for row in ${pythonLiteral(placements)}:
            actual = vn_portrait_placement(row["character"], row["expression"])
            assert all(abs(a - row["expected"][key]) < 0.00001 for a, key in zip(actual, ("x", "y", "scale")))
        for row in ${pythonLiteral(presets)}:
            actual = vn_display_preset_placement(row["character"], row["expression"], row["preset"])
            assert all(abs(a - row["expected"][key]) < 0.00001 for a, key in zip(actual, ("x", "y", "scale")))

    def vn_test_show(character, expression):
        for other in vn_bp_characters:
            renpy.hide("vn_actor_" + other)
        vn_bp_show(character, expression, 0.5, 1, 1, 10, True)
        renpy.restart_interaction()

screen vn_test_ripple(time, strength):
    zorder 999
    modal True
    add Transform("ripple-check.png", xysize=(${p.width}, ${p.height}), mesh=True, shader="vn.chapter_ripple", u_vn_ripple_time=time, u_vn_ripple_strength=strength, u_vn_ripple_speed=${chapterSource.shaders.ripple.speed})

testsuite global:
    before testcase:
        $ _test.timeout = 25.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
    teardown:
        exit

testcase ripple_shader:
    run Show("vn_test_ripple", time=0.0, strength=0.0)
    pause 0.2
    screenshot "ripple-original.png"
    run Show("vn_test_ripple", time=0.0, strength=${chapterSource.shaders.ripple.strength})
    pause 0.2
    screenshot "ripple-time-0.png"
    run Show("vn_test_ripple", time=3.5, strength=${chapterSource.shaders.ripple.strength})
    pause 0.2
    screenshot "ripple-time-3.5.png"
    run Hide("vn_test_ripple")

testcase geometry_and_opening:
    pause 0.3
    assert eval renpy.display.interface.vn_window_geometry.hwnd is not None
    run Function(vn_test_drag_edges)
    run Function(vn_test_window, 1150, 740)
    pause 0.5
    assert eval abs(vn_test_client()[1] - vn_test_client()[0] * ${p.height / p.width}) <= 1
    $ vn_test_geometry.append({"afterExternalResize": vn_test_client()})
    run Function(vn_preference_set, "windowSize", "1280x720")
    pause 0.6
    assert eval abs(vn_test_client()[1] - vn_test_client()[0] * ${p.height / p.width}) <= 1
    run Function(vn_preference_set, "fullscreen", True)
    pause 0.6
    assert eval preferences.fullscreen
    screenshot "fullscreen.png"
    run Function(vn_preference_set, "fullscreen", False)
    pause 0.6
    assert eval not preferences.fullscreen
    assert eval abs(vn_test_client()[1] - vn_test_client()[0] * ${p.height / p.width}) <= 1
    $ vn_test_start = vn_test_time.monotonic()
    run Show("vn_chapter_title", title=${JSON.stringify(chapter.title)}, title_image=${JSON.stringify(titleImage)}, background=${JSON.stringify(background)}, effect="ink", duration=8.0, _vn_wait=False)
${captures.map((t, i) => `    pause until eval vn_test_time.monotonic() - vn_test_start >= ${t * 8}
    screenshot "opening-${i}-${t}.png"`).join('\n')}
    pause until not screen "vn_chapter_title"
    assert screen "main_menu"
    assert eval len(vn_chapter_particles_for(${JSON.stringify(titleImage)}, ${JSON.stringify(chapter.title)})) == 200
    assert eval all(vn_chapter_particle_frame(p, (p["delay"] + 1.0) / 7.0)[0] < 0 and vn_chapter_particle_frame(p, (p["delay"] + 1.0) / 7.0)[1] > 0 for p in vn_chapter_particles_for(${JSON.stringify(titleImage)}, ${JSON.stringify(chapter.title)}))
    $ open(config.basedir + "/geometry.json", "w", encoding="utf-8").write(__import__("json").dumps(vn_test_geometry))

testcase portraits_and_ending:
    click id "vn_component_ai_title_start"
    advance until ${JSON.stringify(opening.lines[3].text)}
    run Function(vn_test_portraits)
${p.characters.filter(c => c.expressions.length).map(c => `    run Function(vn_test_show, ${JSON.stringify(c.id)}, ${JSON.stringify(c.defaultExpressionId ?? c.expressions[0].id)})
    pause 0.15
    screenshot "portrait-${c.id}.png"`).join('\n')}
    run Jump("vn_node_ai_ending_shelter")
    pause until eval vn_performance_active and renpy.showing("vn_visual_ending_title")
    pause 0.8
    assert not screen "say"
    screenshot "ending-black-caption.png"
    pause until screen "main_menu"
    screenshot "ending-return-title.png"
`);
  for (const command of ['lint', 'test']) {
    const r = await runRenpy(sdk, build, command === 'test' ? ['test', '--report-detailed'] : ['lint'], { savedir: path.join(output, 'saves'), timeoutMs: 120_000 });
    await fs.writeFile(path.join(output, command + '.log'), r.log); assert.equal(r.code, 0, r.log.slice(-5500)); console.log(command + ': PASS');
  }
  const screenshots = path.join(build, 'tests/screenshots');
  report.geometry = JSON.parse(await fs.readFile(path.join(build, 'geometry.json'), 'utf8'));
  report.portraitExpressions = placements.length;
  report.sharedPresetPlacements = presets.length;
  const rippleImages = await Promise.all(['original', 'time-0', 'time-3.5'].map(async name => PNG.sync.read(await fs.readFile(path.join(screenshots, `ripple-${name}.png`)))));
  const differences = rippleImages.slice(1).map((image, index) => {
    const previous = rippleImages[index];
    let changed = 0, absolute = 0;
    for (let at = 0; at < image.data.length; at += 4) {
      const delta = [0, 1, 2].reduce((sum, channel) => sum + Math.abs(image.data[at + channel] - previous.data[at + channel]), 0);
      if (delta > 12) changed++;
      absolute += delta;
    }
    return { changedFraction: changed / (image.width * image.height), meanDifference: absolute / (image.width * image.height * 3) };
  });
  for (const difference of differences) { assert.ok(difference.changedFraction > .05, JSON.stringify(difference)); assert.ok(difference.meanDifference > 2, JSON.stringify(difference)); }
  for (const [index, [u, v]] of [[.25, .25], [.75, .25], [.25, .75], [.75, .75]].entries()) {
    const original = rippleImages[0], at = (Math.floor(original.height * v) * original.width + Math.floor(original.width * u)) * 4;
    // Compare channel ordering so the checker lines do not affect orientation.
    const actual = [...original.data.subarray(at, at + 3)];
    assert.equal(actual.indexOf(Math.max(...actual)), cornerColors[index].indexOf(Math.max(...cornerColors[index])));
  }
  report.ripple = { differences, shader: chapterSource.shaders.ripple, fadeTestSpeed: 0 };
  // A uniform fade has the same luminance ratio in every region outside the title.
  const early = PNG.sync.read(await fs.readFile(path.join(screenshots, 'opening-0-0.05.png'))), full = PNG.sync.read(await fs.readFile(path.join(screenshots, 'opening-3-0.36.png')));
  const ratios: number[] = [];
  for (const y of [.1, .25, .75, .9]) for (const x of [.1, .3, .7, .9]) {
    const at = (Math.floor(full.height * y) * full.width + Math.floor(full.width * x)) * 4;
    const a = early.data[at] + early.data[at + 1] + early.data[at + 2], b = full.data[at] + full.data[at + 1] + full.data[at + 2];
    if (b > 50) ratios.push(a / b);
  }
  assert.ok(ratios.length >= 6); assert.ok(Math.max(...ratios) - Math.min(...ratios) < .1, JSON.stringify(ratios));
  report.fadeLuminanceRatios = ratios;
  const ending = PNG.sync.read(await fs.readFile(path.join(screenshots, 'ending-black-caption.png')));
  for (const [x, y] of [[.1, .1], [.9, .1], [.1, .9], [.9, .9]]) { const at = (Math.floor(ending.height * y) * ending.width + Math.floor(ending.width * x)) * 4; assert.equal(ending.data[at] + ending.data[at + 1] + ending.data[at + 2], 0); }
  report.screenshots = (await fs.readdir(screenshots)).map(f => path.join(screenshots, f));
  report.status = 'passed'; await save(); console.log('REPORT ' + path.join(output, 'report.json'));
} catch (error) { report.status = 'failed'; report.error = error instanceof Error ? error.stack : String(error); await save(); console.error(report.error); process.exitCode = 1; }
