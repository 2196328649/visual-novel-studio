import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject } from '../src/core/model';
import { createMediaVisual } from '../src/core/media-command';
import { buildProject, runRenpy } from '../src/runtime/service';

const output = path.resolve('artifacts/media-lifetime', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
console.log(output);
const png = new PNG({ width: 160, height: 90 });
for (let i = 0; i < png.data.length; i += 4) png.data.set([220, 40, 50, 255], i);
await fs.writeFile(path.join(output, 'red.png'), PNG.sync.write(png));
const project = createProject('图片范围与变换原生验收');
project.width = 800; project.height = 450;
project.playerDefaults = { textSpeed: 0, fullscreen: false, masterVolume: 0 };
project.assets = [{ id: 'red', name: '红色图片', kind: 'image', path: 'red.png', width: 160, height: 90 }];
const lineImage = createMediaVisual('image', 'red', {
  x: .4, y: .3, scaleX: .3, scaleY: .2, rotation: 90, fit: 'contain',
  transitionWait: true, visualTransitions: { enter: { mode: 'dissolve', duration: .2 }, exit: { mode: 'dissolve', duration: .25 } },
});
const persistent = createMediaVisual('image', 'red', { instanceId: 'persistent', lifetime: 'persistent', x: .6, y: .35, width: .2, height: .2 });
const node = project.nodes.find(item => item.kind === 'passage')!;
project.entryId = node.id;
node.lines = [
  { id: 'line_image', text: 'Line scoped image.', actions: [lineImage] },
  { id: 'after_line', text: 'After line.', actions: [] },
  { id: 'persistent', text: 'Persistent image.', actions: [persistent] },
  { id: 'persistent_next', text: 'Persistent survives.', actions: [] },
  { id: 'hide', text: 'Explicitly hidden.', actions: [{ kind: 'hideVisual', instanceId: 'persistent' }] },
  { id: 'timed', text: 'Timed image.', actions: [createMediaVisual('image', 'red', { duration: .4, x: .5, y: .3, width: .2, height: .2 })] },
  { id: 'performance', text: '', silent: true, actions: [createMediaVisual('image', 'red'), { kind: 'pause', seconds: .25 }] },
  { id: 'after_performance', text: 'After performance.', actions: [] },
];
await fs.writeFile(path.join(output, 'project.vns.json'), JSON.stringify(project, null, 2));
const game = path.join(output, 'game'), sdk = path.resolve('resources/runtime');
const built = await buildProject({ project, projectDir: output, outputDir: game, sdkRoot: sdk });
assert.ok(built.ok, built.log + JSON.stringify(built.diagnostics));
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
testsuite global:
    before testcase:
        $ _test.timeout = 15
        $ _test.transition_timeout = .1
        $ preferences.text_cps = 0
        $ preferences.transitions = 2
    teardown:
        exit

testcase image_lifetimes:
    click id "vn_main_start"
    pause until "Line scoped image."
    pause .1
    assert eval vn_visual_instances["vn_visual_image"]["data"]["lifetime"] == "line"
    assert eval vn_visual_instances["vn_visual_image"]["data"]["keyframes"][0]["scaleX"] == .3
    assert eval vn_visual_instances["vn_visual_image"]["data"]["keyframes"][0]["scaleY"] == .2
    assert eval vn_visual_instances["vn_visual_image"]["data"]["keyframes"][0]["rotation"] == 90
    screenshot "transformed.png"
    run FileSave("image_line", confirm=False, slot=True)
    run FileLoad("image_line", confirm=False, slot=True)
    pause until "Line scoped image."
    assert eval "vn_visual_image" in vn_visual_instances
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "After line."
    pause .45
    $ vn_visual_cleanup()
    assert eval "vn_visual_image" not in vn_visual_instances
    assert eval not renpy.showing("vn_visual_image")
    screenshot "line-cleared.png"
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Persistent image."
    assert eval "vn_visual_persistent" in vn_visual_instances
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Persistent survives."
    pause .45
    assert eval renpy.showing("vn_visual_persistent")
    assert eval "vn_visual_persistent" in vn_visual_instances
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Explicitly hidden."
    assert eval not renpy.showing("vn_visual_persistent")
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Timed image."
    assert eval "vn_visual_image" in vn_visual_instances
    pause .6
    $ vn_visual_cleanup()
    assert eval "vn_visual_image" not in vn_visual_instances
    screenshot "timed-cleared.png"
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "After performance."
    assert eval not vn_visual_instances
    assert eval not renpy.showing("vn_visual_image")
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], {
  savedir: path.join(output, 'saves'), timeoutMs: 60_000, env: { PYTHONUNBUFFERED: '1' }, onData: data => process.stdout.write(data),
});
await fs.writeFile(path.join(output, 'runtime.log'), result.log);
assert.equal(result.code, 0, result.log.slice(-6000));
const screenshot = async (name: string) => {
  const files = async (directory: string): Promise<string[]> => (await Promise.all((await fs.readdir(directory, { withFileTypes: true })).map(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : path.join(directory, entry.name)))).flat();
  const file = (await files(game)).find(file => path.basename(file) === name); assert.ok(file, 'missing ' + name);
  await fs.copyFile(file, path.join(output, name)); return PNG.sync.read(await fs.readFile(file));
};
const redBounds = (png: PNG) => {
  let left = png.width, right = -1, top = png.height, bottom = -1, count = 0;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const i = (y * png.width + x) * 4;
    if (png.data[i] > 170 && png.data[i + 1] < 75 && png.data[i + 2] < 90) {
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); count++;
    }
  }
  return { left, right, top, bottom, count };
};
const transformed = await screenshot('transformed.png'), bounds = redBounds(transformed);
const scaleX = transformed.width / project.width, scaleY = transformed.height / project.height;
assert.ok(Math.abs(scaleX - scaleY) < .01, 'game aspect ratio');
assert.ok(Math.abs((bounds.left + bounds.right) / 2 / scaleX - 320) < 3, JSON.stringify(bounds));
assert.ok(Math.abs((bounds.top + bounds.bottom) / 2 / scaleY - 135) < 3, JSON.stringify(bounds));
assert.ok(Math.abs((bounds.right - bounds.left + 1) / scaleX - 90) < 4, JSON.stringify(bounds));
assert.ok(Math.abs((bounds.bottom - bounds.top + 1) / scaleY - 240) < 4, JSON.stringify(bounds));
assert.equal(redBounds(await screenshot('line-cleared.png')).count, 0);
assert.equal(redBounds(await screenshot('timed-cleared.png')).count, 0);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', bounds,
  checks: ['rendered position, size, scale and rotation', 'line scope across save/load and dialogue advance', 'explicit persistent scope', 'explicit hide', 'timed disappearance', 'standalone performance cleanup'],
}, null, 2));
