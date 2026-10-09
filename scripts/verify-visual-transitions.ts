import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject } from '../src/core/model';
import { createMediaVisual } from '../src/core/media-command';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { buildProject, runRenpy } from '../src/runtime/service';

const output = path.resolve('artifacts/visual-transitions', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = createProject('图片过渡验收'); project.width = 800; project.height = 450; project.playerDefaults = { textSpeed: 0, fullscreen: false, masterVolume: 0 };
for (const [id, rgb] of [['red', [220, 40, 50]], ['green', [30, 210, 70]]] as const) {
  const png = new PNG({ width: 160, height: 160 });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([...rgb, 255], i);
  await fs.writeFile(path.join(output, id + '.png'), PNG.sync.write(png));
  project.assets.push({ id, name: id, kind: 'image', path: id + '.png', width: 160, height: 160 });
}
const image = createMediaVisual('image', 'red', { lifetime: 'persistent', x: .5, y: .3, width: .3, height: .5, transitionWait: true, visualTransitions: { enter: { mode: 'dissolve', duration: .5 }, exit: { mode: 'dissolve', duration: .5 }, replace: { mode: 'dissolve', duration: .6 } } });
const timed = { ...image, persistent: false, duration: 1.2, wait: true };
const graph = blueprintFromPerformance(project, [image, { kind: 'hideVisual', instanceId: 'image' }], '图片蓝图'); project.blueprints.push(graph);
const node = project.nodes.find(n => n.kind === 'passage')!; node.next = node.id;
node.lines = [
  { id: 'first', text: 'First.', actions: [] },
  { id: 'enter', text: 'Enter.', actions: [image] },
  { id: 'same', text: 'Same.', actions: [image] },
  { id: 'replace', text: 'Replace.', actions: [{ ...image, assetId: 'green' }] },
  { id: 'fade', text: 'Fade.', actions: [{ ...image, visualTransitions: { ...image.visualTransitions, replace: { mode: 'fade', duration: .7 } } }] },
  { id: 'hide', text: 'Hide.', actions: [{ kind: 'hideVisual', instanceId: 'image' }] },
  { id: 'async', text: 'Async.', actions: [{ ...image, transitionWait: false }] },
  { id: 'interrupt', text: 'Interrupt.', actions: [{ ...image, assetId: 'green', transitionWait: false }] },
  { id: 'async_hide', text: 'Async hide.', actions: [{ kind: 'hideVisual', instanceId: 'image', wait: false, exitTransition: { mode: 'move', duration: .5 } }] },
  { id: 'timed', text: 'Timed.', actions: [timed] },
  { id: 'blueprint', text: 'Blueprint.', actions: [{ kind: 'blueprint', blueprintId: graph.id }] },
  { id: 'before_reset', text: 'Before reset.', actions: [image] },
  { id: 'reset', text: 'Reset.', actions: [{ kind: 'background', assetId: 'red', transition: 'none' }] },
];
await fs.writeFile(path.join(output, 'project.vns.json'), JSON.stringify(project));
const game = path.join(output, 'game'), sdk = path.resolve('resources/runtime');
const built = await buildProject({ project, projectDir: output, outputDir: game, sdkRoot: sdk }); assert.ok(built.ok, built.log + JSON.stringify(built.diagnostics));
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
init 100 python:
    import time as qa_time, json as qa_json
    qa_frames = []
    qa_draw = renpy.display.core.Interface.draw_screen
    def qa_record(self, root_widget, fullscreen_video, draw):
        qa_draw(self, root_widget, fullscreen_video, draw)
        if draw and vn_current_line:
            surface = renpy.display.draw.screenshot(renpy.display.interface.surftree)
            w, h = surface.get_size()
            qa_frames.append(dict(line=vn_current_line, time=qa_time.monotonic(), pixel=list(surface.get_at((int(w * .5), int(h * .3))))[:3]))
    renpy.display.core.Interface.draw_screen = qa_record

testsuite global:
    before testcase:
        $ _test.timeout = 15
        $ _test.transition_timeout = .1
        $ preferences.text_cps = 0
        $ preferences.transitions = 2
    teardown:
        exit

testcase phases:
    click id "vn_main_start"
    pause until "First."
    $ started = qa_time.monotonic()
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Enter."
    assert eval .4 < qa_time.monotonic() - started < 1.0
    assert eval "vn_visual_image" in vn_visual_instances
    $ previous = renpy.display.core.displayable_by_tag("master", "vn_visual_image")
    $ started = qa_time.monotonic()
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Same."
    assert eval qa_time.monotonic() - started < .3
    assert eval renpy.display.core.displayable_by_tag("master", "vn_visual_image") is previous
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Replace."
    screenshot "replaced.png"
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Fade."
    $ started = qa_time.monotonic()
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Hide."
    assert eval .4 < qa_time.monotonic() - started < 1.0
    assert eval not renpy.showing("vn_visual_image")
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Async."
    pause .15
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Interrupt."
    pause .15
    run FileSave("moving", confirm=False, slot=True)
    run FileLoad("moving", confirm=False, slot=True)
    pause until "Interrupt."
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Async hide."
    pause .7
    $ vn_visual_cleanup()
    assert eval not renpy.showing("vn_visual_image")
    $ started = qa_time.monotonic()
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Timed."
    assert eval 1.1 < qa_time.monotonic() - started < 1.8
    $ vn_visual_cleanup()
    assert eval "vn_visual_image" not in vn_visual_instances
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Blueprint."
    assert eval not renpy.showing("vn_visual_image")
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Before reset."
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Reset."
    assert eval not vn_visual_instances
    $ qa_json.dump(qa_frames, open(config.basedir + "/frames.json", "w"))
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 60000, env: { PYTHONUNBUFFERED: '1' }, onData: text => process.stdout.write(text) });
await fs.writeFile(path.join(output, 'runtime.log'), result.log); assert.equal(result.code, 0, result.log.slice(-5000));
const frames: { line: string; pixel: number[] }[] = JSON.parse(await fs.readFile(path.join(game, 'frames.json'), 'utf8'));
for (const line of ['enter', 'replace', 'fade', 'hide', 'async', 'interrupt', 'async_hide', 'timed']) assert.ok(new Set(frames.filter(f => f.line === line).map(f => f.pixel.join(','))).size >= 3, line + ' changes rendered pixels');
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', frames: frames.length, checks: ['independent waits', 'same still no flash', 'entry exit replace pixels', 'interrupted transition save/load', 'timed lifetime', 'blueprint', 'background reset'] }, null, 2));
console.log(output);
