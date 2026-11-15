import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject, type UiComponent } from '../src/core/model';
import { compileProject } from '../src/runtime/compiler';
import { pythonLiteral as q } from '../src/runtime/literals';
import { buildProject, runRenpy } from '../src/runtime/service';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';

// Run only after the coordinated implementation/build is complete. All assets,
// saves and generated games belong to this run; the author's game is never read.
const sdk = process.env.VNS_RENPY_SDK ?? path.resolve('resources/runtime');
const output = path.resolve('artifacts/ui-inspector-appearance-runtime', new Date().toISOString().replaceAll(':', '-') + '-' + process.pid);
const source = path.join(output, 'source'), game = path.join(output, 'game');
const pixelReportPath = path.join(output, 'pixels.json');
interface PixelSample { name: string; passed: boolean; actual: unknown; expected: unknown }
interface PixelReport { samples: PixelSample[] }
const report: {
  status: string;
  checks: { name: string; code: number; logPath: string }[];
  cases?: number;
  assertions?: number;
  pixelChecks?: number;
  failedPixelChecks?: string[];
  error?: string;
  cleanup?: unknown;
  coverage: string[];
  limitations: string[];
} = {
  status: 'running', checks: [],
  coverage: [
    '黑白不透明底合成验证 RGBA 边框：四边、圆角、透明中心、零宽、过宽和过大半径',
    '真实图片与视频：圆角透明、媒体不会盖住前景边框',
    '进度 0%、50%、100%：轨道只画一次、填充与边框正确叠加',
    '父按钮背景子图、自身圆角、前景子图的顺序与矩形点击区域',
    '图片继承普通、悬停、按住、禁用状态和加载结果',
    '运行中修改与恢复圆角、边框，图片加载状态保持有效',
  ],
  limitations: ['不加载 Spine 二进制；Spine 的生成代码与属性能力由单元用例覆盖。', '需要本地 ffmpeg 生成 1 秒纯色视频，不连接外部服务。'],
};

await fs.mkdir(path.join(source, 'assets'), { recursive: true });
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  const logPath = path.join(output, name + '.log');
  await fs.writeFile(logPath, result.log);
  report.checks.push({ name, code: result.code, logPath });
  await save();
  if (result.code) throw new Error(name + ': ' + result.log.slice(-9000));
}

function solidPng(color: string) {
  const png = new PNG({ width: 32, height: 32 });
  const rgb = [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16));
  for (let index = 0; index < png.data.length; index += 4) png.data.set([...rgb, 255], index);
  return PNG.sync.write(png);
}

function fixture() {
  const project = createProject('通用外观与圆角验收');
  project.id = 'ui_inspector_appearance_runtime';
  project.width = 1000; project.height = 700;
  project.resourceSettings = { importMode: 'copy', directory: 'assets', ...project.resourceSettings, syncFolders: false };
  project.ui.pages = { main: { layout: 'custom', background: '#102030' } };
  const colors = {
    appearance_idle: '#2878b8', appearance_hover: '#40c060', appearance_pressed: '#d09020',
    appearance_disabled: '#707880', appearance_background: '#e0a030',
    appearance_foreground: '#d030b0', appearance_parent: '#308050',
  };
  project.assets = Object.entries(colors).map(([id]) => ({ id, name: id, kind: 'image' as const, category: 'ui' as const, path: `assets/${id}.png`, width: 32, height: 32 }));
  project.assets.push({ id: 'appearance_movie', name: '纯色验收视频', kind: 'video', path: 'assets/appearance_movie.webm' });
  const control = (id: string, kind: UiComponent['kind'], x: number, y: number, width: number, height: number, extra: Partial<UiComponent> = {}): UiComponent => ({
    id, kind, page: 'main', text: '', x: x / project.width, y: y / project.height,
    width: width / project.width, height: height / project.height, ...extra,
  });
  const mediaLook = { radius: 32, borderWidth: 8, borderColor: '#f0402080' };
  project.ui.components = [
    control('appearance_title', 'text', 40, 14, 900, 38, { text: '圆角、半透明边框、状态图片与子控件', style: { fontSize: 26 } }),
    control('rounded_image', 'image', 40, 70, 200, 120, { assetId: 'appearance_idle', style: { ...mediaLook, imageFit: 'cover' } }),
    control('rounded_video', 'video', 280, 70, 200, 120, { assetId: 'appearance_movie', posterId: 'appearance_idle', loop: true, style: mediaLook }),
    control('rounded_panel', 'panel', 520, 70, 200, 120, { style: { background: '#22446680', radius: 32, borderWidth: 8, borderColor: '#00ddff80' } }),
    control('parent_button', 'button', 40, 270, 240, 160, {
      skin: { idle: 'appearance_parent', hover: 'appearance_parent', pressed: 'appearance_parent', disabled: 'appearance_parent', hideText: true, fit: 'stretch' },
      style: { radius: 40, borderWidth: 4, borderColor: '#ffffff' },
    }),
    { id: 'background_child', page: 'main', kind: 'image', text: '', parentId: 'parent_button', childLayer: 'background', inheritState: false, x: 0, y: 0, width: 1, height: 1, assetId: 'appearance_background', style: { imageFit: 'stretch' } },
    { id: 'foreground_child', page: 'main', kind: 'image', text: '', parentId: 'parent_button', childLayer: 'foreground', inheritState: false, x: 0, y: 0, width: .125, height: .1875, assetId: 'appearance_foreground', style: { imageFit: 'stretch' } },
    control('state_host', 'button', 360, 270, 240, 160, {
      skin: { hideText: true }, style: { background: '#00000000', hoverBackground: '#00000000', pressedBackground: '#00000000', selectedBackground: '#00000000', disabledBackground: '#00000000' },
    }),
    { id: 'state_image', page: 'main', kind: 'image', text: '', parentId: 'state_host', inheritState: true, x: 0, y: 0, width: 1, height: 1, assetId: 'appearance_idle',
      skin: { hover: 'appearance_hover', pressed: 'appearance_pressed', disabled: 'appearance_disabled' }, style: { ...mediaLook, radius: 40, imageFit: 'stretch' } },
    ...[0, .5, 1].map((value, index) => control(`progress_${index}`, 'progress', 40 + index * 280, 500, 240, 40, {
      value, style: { background: '#22446680', selectedBackground: '#44cc8880', radius: 20, borderWidth: 5, borderColor: '#ffffff80' },
    })),
    control('appearance_notes', 'text', 40, 575, 870, 85, { text: '上排：图片、视频与半透明容器\n中排：圆角按钮的背景/前景子图、继承状态图片\n下排：进度 0% / 50% / 100%', style: { fontSize: 20, textColor: '#d5dfeb' } }),
  ];
  return { project, colors };
}

const previousSaves = process.env.RENPY_PATH_TO_SAVES;
try {
  await isolateRenpySaves(output);
  const { project, colors } = fixture();
  const original = structuredClone(project);
  assert.deepEqual(compileProject(project).diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.deepEqual(project, original, 'The fixture compiler cannot mutate authored appearance.');
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(project, null, 2));
  for (const [id, color] of Object.entries(colors)) await fs.writeFile(path.join(source, `assets/${id}.png`), solidPng(color));
  execFileSync(process.env.VNS_FFMPEG ?? 'ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2878b8:size=64x64:rate=6', '-t', '1', '-c:v', 'libvpx', '-pix_fmt', 'yuv420p', '-an', path.join(source, 'assets/appearance_movie.webm')], { windowsHide: true, timeout: 30000 });
  const built = await buildProject({ project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  await fs.mkdir(path.join(game, 'tests/pixels'), { recursive: true });
  await fs.mkdir(path.join(game, 'tests/screenshots'), { recursive: true });

  const tests = String.raw`init -999 python:
    import renpy as _qa_appearance_engine
    _qa_appearance_engine.safe_mode_checked = True

init 1000 python:
    def qa_appearance_record(name, passed, actual, expected):
        import json
        if not hasattr(qa_appearance_record, "samples"):
            qa_appearance_record.samples = []
        qa_appearance_record.samples.append(dict(name=name, passed=bool(passed), actual=actual, expected=expected))
        with open(@@PIXEL_REPORT@@, "w", encoding="utf-8") as output:
            json.dump(dict(samples=qa_appearance_record.samples), output, ensure_ascii=False, indent=2)
        if not passed:
            raise AssertionError("%s: actual=%r, expected=%r" % (name, actual, expected))
        return True

    def qa_appearance_pixel(surface, name, point, expected, tolerance=3):
        actual = list(surface.get_at(point))
        return qa_appearance_record(name, all(abs(a - b) <= tolerance for a, b in zip(actual, expected)), dict(point=list(point), rgba=actual), dict(rgba=list(expected), tolerance=tolerance))

    def qa_appearance_alpha(surface, name, point, expected, tolerance=3):
        actual = list(surface.get_at(point))
        return qa_appearance_record(name, abs(actual[3] - expected) <= tolerance, dict(point=list(point), rgba=actual), dict(alpha=expected, tolerance=tolerance))

    class QaAppearanceSurface(object):
        def __init__(self, surface, width, height):
            self.native, self.width, self.height = surface, width, height

        def get_size(self):
            return (self.width, self.height)

        def get_at(self, point):
            # Keep native pixels, mapping virtual pixel centers for window/DPI scaling.
            width, height = self.native.get_size()
            x = min(width - 1, max(0, int((point[0] + .5) * width / self.width)))
            y = min(height - 1, max(0, int((point[1] + .5) * height / self.height)))
            return self.native.get_at((x, y))

    def qa_appearance_reference(*colors):
        # Native Solid composition is independent of the round/border shader.
        if not hasattr(qa_appearance_reference, "cache"):
            qa_appearance_reference.cache = {}
        if colors in qa_appearance_reference.cache:
            return qa_appearance_reference.cache[colors]
        reference = Fixed(*[Solid(color, xysize=(8, 8)) for color in colors], xysize=(8, 8))
        surface = QaAppearanceSurface(renpy.render_to_surface(reference, 8, 8, resize=False), 8, 8)
        result = list(surface.get_at((4, 4)))
        qa_appearance_reference.cache[colors] = result
        return result

    def qa_appearance_render(display, width, height, name):
        import os
        import renpy.pygame as pygame
        rendered = renpy.render(display, width, height, 0.0, 0.0)
        # resize=True takes an extra smoothscale path through a transparent Surface,
        # even at equal sizes. Sample and save the same unscaled renderer readback.
        surface = renpy.render_to_surface(rendered, resize=False)
        qa_appearance_record(name + "-size", (rendered.width, rendered.height) == (width, height) and min(surface.get_size()) > 0,
            dict(virtual=[rendered.width, rendered.height], native=list(surface.get_size())), dict(virtual=[width, height]))
        pygame.image.save(surface, os.path.join(config.basedir, "tests", "pixels", name + ".png"))
        return QaAppearanceSurface(surface, width, height)

    def qa_appearance_composite(display, width, height, name):
        surfaces = [qa_appearance_render(Fixed(Solid(color, xysize=(width, height)), display, xysize=(width, height)), width, height, name + "-on-" + label)
            for label, color in (("black", "#000000"), ("white", "#ffffff"))]
        black, white = qa_appearance_reference("#000000"), qa_appearance_reference("#ffffff")
        span = [w - b for b, w in zip(black[:3], white[:3])]
        qa_appearance_record(name + "-opaque-reference", min(span) >= 250 and surfaces[0].native.get_size() == surfaces[1].native.get_size(),
            dict(rgbSpan=span, nativeSizes=[list(surface.native.get_size()) for surface in surfaces]), dict(minRgbSpan=250, matchingSizes=True))
        return dict(surfaces=surfaces, span=span)

    def qa_appearance_coverage(black, white, span):
        # On opaque backdrops Cwhite - Cblack = (1 - alpha) * (white - black).
        # This checks effective opacity without trusting transparent readback alpha.
        return [255.0 * (1.0 - (w - b) / float(scale)) for b, w, scale in zip(black[:3], white[:3], span)]

    def qa_appearance_composition(sample, name, point, colors, alpha, tolerance=3):
        actual = [list(surface.get_at(point)) for surface in sample["surfaces"]]
        for index, (label, backdrop) in enumerate((("black", "#000000"), ("white", "#ffffff"))):
            expected = qa_appearance_reference(backdrop, *colors)[:3]
            rgb = actual[index][:3]
            qa_appearance_record(name + "-on-" + label, all(abs(a - b) <= tolerance for a, b in zip(rgb, expected)),
                dict(point=list(point), rgb=rgb), dict(rgb=expected, tolerance=tolerance))
        coverage = qa_appearance_coverage(actual[0], actual[1], sample["span"])
        qa_appearance_record(name + "-alpha", all(abs(value - alpha) <= tolerance for value in coverage),
            dict(point=list(point), alphaFromRgb=coverage, black=actual[0], white=actual[1]), dict(alpha=alpha, tolerance=tolerance))
        return True

    def qa_appearance_widget(identity):
        widget = renpy.get_displayable("main_menu", "vn_component_" + identity, base=True)
        if widget is None:
            raise AssertionError("Missing authored control: " + identity)
        return widget

    def qa_appearance_capture(identity, name, composite=False):
        row = vn_ui_layout_row(identity)
        width, height = int(row["width"] + .5), int(row["height"] + .5)
        capture = qa_appearance_composite if composite else qa_appearance_render
        return capture(qa_appearance_widget(identity), width, height, name)

    def qa_appearance_ring():
        color = "#f0402080"
        native = qa_appearance_composite(Solid(color, xysize=(8, 8)), 8, 8, "native-half")
        qa_appearance_composition(native, "native-half", (4, 4), (color,), 128)
        for radius in (0, 24):
            name = "border-r" + str(radius)
            display = vn_ui_border(160, 96, dict(radius=radius, borderWidth=8, borderColor=color))
            sample = qa_appearance_composite(display, 160, 96, name)
            points = [(80, 3), (156, 48), (80, 92), (3, 48)]
            points += [(8, 8), (151, 8), (151, 87), (8, 87)] if radius else [(3, 3), (156, 3), (156, 92), (3, 92)]
            for index, point in enumerate(points):
                qa_appearance_composition(sample, name + "-edge-" + str(index), point, (color,), 128)
            qa_appearance_composition(sample, name + "-center", (80, 48), (), 0)
            black, white = [surface.native for surface in sample["surfaces"]]
            width, height = black.get_size()
            maximum = max(max(qa_appearance_coverage(list(black.get_at((x, y))), list(white.get_at((x, y))), sample["span"])) for y in range(height) for x in range(width))
            qa_appearance_record(name + "-no-overlap-alpha", maximum <= 131, maximum, dict(maxAlpha=131))
            if radius:
                qa_appearance_composition(sample, name + "-outside", (1, 1), (), 0)
        empty_border = vn_ui_border(160, 96, dict(borderWidth=0, radius=24)) is None
        qa_appearance_record("zero-border", empty_border, empty_border, True)
        thick = qa_appearance_composite(vn_ui_border(20, 12, dict(borderWidth=100, radius=100, borderColor=color)), 20, 12, "border-clamped-thick")
        qa_appearance_composition(thick, "thick-border-no-hole", (10, 6), (color,), 128)
        return True

    def qa_appearance_media(identity, name, color, rounded=True, border=True, tolerance=4):
        surface = qa_appearance_capture(identity, name)
        width, height = surface.get_size()
        qa_appearance_pixel(surface, name + "-center", (width // 2, height // 2), qa_appearance_reference(color), tolerance)
        qa_appearance_alpha(surface, name + "-corner", (1, 1), 0 if rounded else 255)
        expected = qa_appearance_reference(color, "#f0402080") if border else qa_appearance_reference(color)
        qa_appearance_pixel(surface, name + "-front-border", (width // 2, 3), expected, tolerance)
        return True

    def qa_appearance_panel():
        sample = qa_appearance_capture("rounded_panel", "panel-translucent", composite=True)
        qa_appearance_composition(sample, "panel-single-background", (100, 60), ("#22446680",), 128)
        qa_appearance_composition(sample, "panel-border-composition", (100, 3), ("#22446680", "#00ddff80"), 192)
        qa_appearance_composition(sample, "panel-corner", (1, 1), (), 0)
        return True

    def qa_appearance_progress():
        track, fill, border = "#22446680", "#44cc8880", "#ffffff80"
        for index, value in enumerate((0, .5, 1)):
            name = "progress-" + str(int(value * 100))
            sample = qa_appearance_capture("progress_" + str(index), name, composite=True)
            for x, filled in ((60, value > 0), (180, value == 1)):
                colors = (track, fill) if filled else (track,)
                qa_appearance_composition(sample, name + "-content-" + str(x), (x, 20), colors, 192 if filled else 128)
                qa_appearance_composition(sample, name + "-border-" + str(x), (x, 2), colors + (border,), 224 if filled else 192)
            qa_appearance_composition(sample, name + "-corner", (1, 1), (), 0)
        return True

    def qa_appearance_children():
        surface = qa_appearance_capture("parent_button", "parent-children-unclipped")
        qa_appearance_pixel(surface, "foreground-child-outside-parent-round", (4, 4), qa_appearance_reference("#d030b0"))
        qa_appearance_pixel(surface, "background-child-outside-parent-round", (235, 4), qa_appearance_reference("#e0a030"))
        qa_appearance_pixel(surface, "parent-surface-above-background", (120, 80), qa_appearance_reference("#308050"))
        qa_appearance_pixel(surface, "parent-border-above-background", (120, 2), qa_appearance_reference("#ffffff"))
        return True

    def qa_appearance_radius_clamp():
        large = qa_appearance_render(vn_ui_round(Solid("#2878b8"), 100, 60, dict(radius=999)), 100, 60, "radius-larger-than-control")
        limit = qa_appearance_render(vn_ui_round(Solid("#2878b8"), 100, 60, dict(radius=30)), 100, 60, "radius-at-limit")
        equal = all(large.get_at((x, y)) == limit.get_at((x, y)) for y in range(60) for x in range(100))
        qa_appearance_record("radius-clamps-to-half-short-side", equal, equal, True)
        plain = Solid("#2878b8")
        original = vn_ui_round(plain, 100, 60, dict(radius=0)) is plain
        qa_appearance_record("zero-radius-retains-original-displayable", original, original, True)
        return True

    qa_appearance_original_click = vn_ui_play_click
    def vn_ui_play_click(component_id):
        qa_appearance_record.clicks = getattr(qa_appearance_record, "clicks", []) + [component_id]
        return qa_appearance_original_click(component_id)

testsuite global:
    before testcase:
        $ _test.timeout = 18.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
    teardown:
        exit

testcase rgba_border_geometry:
    pause until screen "main_menu"
    move pos (8, 680)
    assert eval qa_appearance_ring()
    assert eval qa_appearance_radius_clamp()
    assert eval qa_appearance_panel()
    screenshot "01-rgba-round-surfaces.png"

testcase authored_image_and_real_video:
    pause until screen "main_menu"
    move pos (8, 680)
    pause until eval vn_ui_get("rounded_image", "imageStatus") == "loaded"
    pause until eval vn_ui_get("rounded_video", "videoStatus") == "playing"
    assert eval vn_ui_get("rounded_video", "videoPlaying")
    assert eval qa_appearance_media("rounded_image", "image-rounded", "#2878b8")
    assert eval qa_appearance_media("rounded_video", "video-rounded", "#2878b8", tolerance=10)
    screenshot "02-media-border-in-front.png"

testcase progress_track_and_fill_alpha:
    pause until screen "main_menu"
    move pos (8, 680)
    assert eval qa_appearance_progress()
    screenshot "03-progress-zero-half-full.png"

testcase parent_background_foreground_and_pointer:
    pause until screen "main_menu"
    move pos (8, 680)
    pause until eval vn_ui_get("background_child", "imageStatus") == "loaded" and vn_ui_get("foreground_child", "imageStatus") == "loaded"
    assert eval qa_appearance_children()
    $ qa_appearance_click_count = getattr(qa_appearance_record, "clicks", []).count("parent_button")
    click id "vn_component_parent_button" pos (.98, .02)
    pause 0.1
    assert eval qa_appearance_record.clicks.count("parent_button") == qa_appearance_click_count + 1
    screenshot "04-parent-children-and-click.png"

testcase inherited_image_states:
    pause until screen "main_menu"
    move pos (8, 680)
    pause until eval vn_ui_get("state_image", "imageSource") == "appearance_idle" and vn_ui_get("state_image", "imageStatus") == "loaded"
    assert eval qa_appearance_media("state_image", "state-idle", "#2878b8")
    move id "vn_component_state_host" pos (.5, .5)
    pause until eval vn_ui_get("state_image", "imageSource") == "appearance_hover" and vn_ui_get("state_image", "imageStatus") == "loaded"
    assert eval qa_appearance_media("state_image", "state-hover", "#40c060")
    $ renpy.test.testmouse.press_mouse(1)
    pause until eval vn_ui_get("state_image", "imageSource") == "appearance_pressed" and vn_ui_get("state_image", "imageStatus") == "loaded"
    assert eval qa_appearance_media("state_image", "state-pressed", "#d09020")
    $ renpy.test.testmouse.release_mouse(1)
    pause 0.1
    $ vn_ui_set("state_host", "enabled", False)
    pause until eval vn_ui_get("state_image", "imageSource") == "appearance_disabled" and vn_ui_get("state_image", "imageStatus") == "loaded"
    assert eval qa_appearance_media("state_image", "state-disabled", "#707880")
    screenshot "05-image-state-disabled.png"
    $ vn_ui_set("state_host", "enabled", True)
    move pos (8, 680)
    pause until eval vn_ui_get("state_image", "imageSource") == "appearance_idle"
    $ qa_appearance_click_count = getattr(qa_appearance_record, "clicks", []).count("state_host")
    click id "vn_component_state_host" pos (.01, .01)
    pause 0.1
    assert eval qa_appearance_record.clicks.count("state_host") == qa_appearance_click_count + 1

testcase live_radius_reset_and_media_lifecycle:
    pause until screen "main_menu"
    move pos (8, 680)
    pause until eval vn_ui_get("rounded_image", "imageStatus") == "loaded"
    $ vn_ui_set("rounded_image", "radius", 0)
    pause 0.1
    assert eval qa_appearance_media("rounded_image", "image-square", "#2878b8", rounded=False)
    assert eval vn_ui_get("rounded_image", "imageStatus") == "loaded" and vn_ui_get("rounded_image", "imageSource") == "appearance_idle"
    $ vn_ui_set("rounded_image", "borderWidth", 0)
    pause 0.1
    assert eval qa_appearance_media("rounded_image", "image-square-no-border", "#2878b8", rounded=False, border=False)
    $ vn_ui_reset_property("rounded_image", "radius")
    $ vn_ui_reset_property("rounded_image", "borderWidth")
    pause 0.1
    assert eval vn_ui_get("rounded_image", "radius") == 32 and vn_ui_get("rounded_image", "borderWidth") == 8
    assert eval qa_appearance_media("rounded_image", "image-round-restored", "#2878b8")
    $ vn_ui_set("rounded_image", "visible", False)
    pause 0.1
    assert eval renpy.get_displayable("main_menu", "vn_component_rounded_image") is None
    $ vn_ui_set("rounded_image", "visible", True)
    pause until eval vn_ui_get("rounded_image", "imageStatus") == "loaded"
    assert eval qa_appearance_media("rounded_image", "image-visible-again", "#2878b8")
    screenshot "06-live-radius-restored.png"
`.replace('@@PIXEL_REPORT@@', q(pixelReportPath.replaceAll('\\', '/')));
  await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 180000 };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  const native = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  await check('runtime', native);
  report.cases = (tests.match(/^testcase /gm) ?? []).length;
  assert.match(native.log, new RegExp('Test cases\\s*:\\s*' + report.cases + '\\s*\\|\\s*' + report.cases + ' passed'));
  report.assertions = Number(native.log.match(/Assertions\s*:\s*(\d+)/)?.[1]);
  assert.equal(report.assertions, (tests.match(/^    assert /gm) ?? []).length, 'Every authored interaction assertion must run.');
  const pixels = JSON.parse(await fs.readFile(pixelReportPath, 'utf8')) as PixelReport;
  report.pixelChecks = pixels.samples.length;
  report.failedPixelChecks = pixels.samples.filter(sample => !sample.passed).map(sample => sample.name);
  assert.ok(report.pixelChecks >= 90, 'All pixel groups must reach their checks.');
  assert.deepEqual(report.failedPixelChecks, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = String(error); process.exitCode = 1;
} finally {
  try {
    const pixels = JSON.parse(await fs.readFile(pixelReportPath, 'utf8')) as PixelReport;
    report.pixelChecks = pixels.samples.length;
    report.failedPixelChecks = pixels.samples.filter(sample => !sample.passed).map(sample => sample.name);
  } catch { /* A failure before Ren'Py starts has no pixel report. */ }
  try {
    for (const name of ['screenshots', 'pixels']) for (const directory of [path.join(game, 'tests', name), path.join(game, 'game/tests', name)]) {
      if (await fs.stat(directory).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(directory, path.join(output, name === 'pixels' ? 'pixel-images' : name), { recursive: true });
    }
  } catch (error) {
    report.status = 'failed'; report.error = [report.error, 'Screenshot preservation failed: ' + String(error)].filter(Boolean).join('\n'); process.exitCode = 1;
  }
  // Preservation or assertion failures still clean only this run's resolved dirs.
  try {
    report.cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves', 'renpy-saves']);
    if ((report.cleanup as { errors: unknown[] }).errors.length) throw new Error('Verification cleanup failed.');
  } catch (error) {
    report.status = 'failed'; report.error = [report.error, String(error)].filter(Boolean).join('\n'); process.exitCode = 1;
  }
  if (previousSaves === undefined) delete process.env.RENPY_PATH_TO_SAVES; else process.env.RENPY_PATH_TO_SAVES = previousSaves;
  await save(); console.log(path.join(output, 'report.json'));
  if (report.error) console.error(report.error);
}
