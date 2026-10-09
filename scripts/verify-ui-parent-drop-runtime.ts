import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject, type UiComponent } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve('.'), output = path.resolve('artifacts/ui-parent-drop-runtime', new Date().toISOString().replaceAll(':', '-'));
const project = createProject('父子图层像素验收'); project.width = 800; project.height = 600;
project.ui.pages = { main: { layout: 'custom', background: '#20252a' } };
const colors: Record<string, number[]> = { idle: [200, 60, 70], hover: [55, 190, 110], pressed: [55, 95, 220], selected: [190, 65, 200], disabled: [125, 135, 145], backdrop: [245, 195, 40], ornament: [35, 215, 230] };
await fs.mkdir(path.join(output, 'assets'), { recursive: true });
for (const [id, rgb] of Object.entries(colors)) {
  const png = new PNG({ width: 32, height: 32 });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([...rgb, 255], i);
  const relative = `assets/${id}.png`; await fs.writeFile(path.join(output, relative), PNG.sync.write(png));
  project.assets.push({ id: `asset_${id}`, kind: 'image', name: id, path: relative, width: 32, height: 32 });
}
const parent: UiComponent = { id: 'parent', kind: 'button', page: 'main', text: '图片按钮', action: 'preferences', x: .1, y: .25, width: .3, height: .3,
  skin: { idle: 'asset_idle', hover: 'asset_hover', pressed: 'asset_pressed', selected: 'asset_selected', disabled: 'asset_disabled', hideText: true, fit: 'stretch' } };
const background: UiComponent = { id: 'backdrop', kind: 'image', page: 'main', parentId: 'parent', childLayer: 'background', text: '', assetId: 'asset_backdrop', x: -.15, y: -.15, width: 1.3, height: 1.3, style: { imageFit: 'stretch' } };
project.ui.components = [parent, background,
  { id: 'ornament', kind: 'image', page: 'main', parentId: 'parent', childLayer: 'foreground', text: '', assetId: 'asset_ornament', skin: { disabled: 'asset_ornament' }, x: .1, y: .1, width: .15, height: .15, style: { imageFit: 'stretch' } },
  { ...parent, id: 'solid', text: '', x: .6, skin: undefined, style: { background: '#443388', hoverBackground: '#cc7733', pressedBackground: '#33aa66', selectedBackground: '#dd4466', disabledBackground: '#556677' } },
  { ...background, id: 'solid_backdrop', parentId: 'solid' },
];
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const built = await buildProject({ project, projectDir: output, outputDir: game, sdkRoot: sdk, development: true });
await fs.writeFile(path.join(output, 'build.json'), JSON.stringify(built, null, 2)); assert.ok(built.ok, JSON.stringify(built));
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
init -999 python:
    import renpy as _qa_engine
    _qa_engine.safe_mode_checked = True
testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase parent_surface:
    pause until screen "main_menu"
    move pos (10, 10)
    pause 0.2
    screenshot "01-idle.png"
    move id "vn_component_parent"
    pause 0.2
    screenshot "02-hover.png"
    $ renpy.test.testmouse.press_mouse(1)
    pause 0.2
    assert eval renpy.get_widget("main_menu", "vn_component_parent").vn_held
    screenshot "03-pressed.png"
    $ renpy.test.testmouse.release_mouse(1)
    pause until screen "preferences"
    keysym "K_ESCAPE"
    pause until screen "main_menu"
    move pos (10, 10)
    $ vn_ui_set("parent", "selected", True)
    pause 0.2
    screenshot "04-selected.png"
    $ vn_ui_set("parent", "enabled", False)
    pause 0.2
    screenshot "05-disabled.png"
    $ vn_ui_set("parent", "enabled", True)
    $ vn_ui_set("parent", "selected", False)
    move id "vn_component_solid"
    pause 0.2
    screenshot "06-solid-hover.png"
    $ renpy.test.testmouse.press_mouse(1)
    pause 0.2
    screenshot "07-solid-pressed.png"
    $ renpy.test.testmouse.release_mouse(1)
    pause until screen "preferences"
    keysym "K_ESCAPE"
    pause until screen "main_menu"
    move pos (10, 10)
    $ vn_ui_set("solid", "selected", True)
    pause 0.2
    screenshot "08-solid-selected.png"
    $ vn_ui_set("solid", "enabled", False)
    pause 0.2
    screenshot "09-solid-disabled.png"
    $ vn_ui_set("solid", "enabled", True)
    # A foreground image remains decorative and passes clicks to its parent.
    click pos (122, 181)
    pause until screen "preferences"
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 120000, env: { SDL_VIDEO_WINDOW_POS: '2400,0' } });
await fs.writeFile(path.join(output, 'runtime.log'), result.log);
assert.equal(result.code, 0, result.log.slice(-5000));
const pixelChecks: { file: string; rgb: number[]; expected: number[]; point: number[] }[] = [];
const sample = async (file: string, x: number, y: number, expected: number[]) => {
  const png = PNG.sync.read(await fs.readFile(path.join(game, 'tests/screenshots', file)));
  const offset = (Math.floor(y * png.height / 600) * png.width + Math.floor(x * png.width / 800)) * 4;
  const rgb = [...png.data.subarray(offset, offset + 3)]; pixelChecks.push({ file, point: [x, y], rgb, expected });
  assert.ok(rgb.every((c, i) => Math.abs(c - expected[i]) <= 3), `${file} at ${x},${y}: ${rgb} != ${expected}`);
};
for (const [i, state] of ['idle', 'hover', 'pressed', 'selected', 'disabled'].entries()) {
  const file = `0${i + 1}-${state}.png`;
  await sample(file, 200, 240, colors[state]);
  await sample(file, 122, 181, colors.ornament);
}
await sample('01-idle.png', 60, 200, colors.backdrop);
await sample('01-idle.png', 600, 240, [0x44, 0x33, 0x88]);
for (const [file, rgb] of [['06-solid-hover.png', [0xcc, 0x77, 0x33]], ['07-solid-pressed.png', [0x33, 0xaa, 0x66]], ['08-solid-selected.png', [0xdd, 0x44, 0x66]], ['09-solid-disabled.png', [0x55, 0x66, 0x77]]] as const) await sample(file, 600, 240, [...rgb]);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks: ['原生五种按钮状态保留父级图片', '背景图在父级后方、前方子图正常覆盖', '无皮肤按钮的五种底色保留', '点击前方子图仍触发父按钮'], pixelChecks }, null, 2));
console.log(output);
