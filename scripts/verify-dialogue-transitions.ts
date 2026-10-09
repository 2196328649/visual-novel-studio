import { createShowCharacterFixture } from './lib/show-character-fixture';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';

const output = path.resolve('artifacts/dialogue-transitions', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = createProject('Dialogue transition regression');
project.width = 800; project.height = 450;
project.playerDefaults = { textSpeed: 0, masterVolume: 0, fullscreen: false };
for (const [id, rgb] of [['red', [210, 50, 70]], ['green', [40, 180, 95]]] as const) {
  const png = new PNG({ width: 80, height: 45 });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([...rgb, 255], i);
  await fs.writeFile(path.join(output, id + '.png'), PNG.sync.write(png));
  project.assets.push({ id, name: id, kind: 'image', path: id + '.png' });
}
project.characters = [{ id: 'actor', name: 'Actor', color: '#ffffff', expressions: [{ id: 'normal', name: 'Normal', assetId: 'red' }] }];
project.blueprints = [createShowCharacterFixture()];
const sceneId = project.scenes[0].id;
project.scenes.push({ id: 'other_scene', name: 'Other scene', chapterId: project.chapters[0].id, entryActions: [{ kind: 'background', assetId: 'green', transition: 'none' }] });
project.entryId = 'story';
project.nodes = [{ id: 'story', name: 'Story', kind: 'passage', sceneId, x: 0, y: 0, next: 'scene_jump', lines: [
  { id: 'first', text: 'First stable dialogue.', actions: [{ kind: 'background', assetId: 'red', transition: 'none' }] },
  { id: 'dissolve', text: 'Background completed.', actions: [{ kind: 'background', assetId: 'green', transition: 'dissolve', duration: .7 }] },
  { id: 'speaker', speakerId: 'actor', text: 'Speaker completed.', actions: [{ kind: 'blueprint', blueprintId: 'fixture_show_character', inputs: { duration: .7, lifetime: 'persistent', layer: 500 } }] },
  { id: 'fade', text: 'Fade completed.', actions: [{ kind: 'background', assetId: 'red', transition: 'fade', duration: .7 }] },
  { id: 'performance', text: '', silent: true, playback: { clickSkip: false, transition: { mode: 'color', outDuration: .5, hold: .2, inDuration: .5, color: '#000000' } }, actions: [{ kind: 'pause', seconds: .3 }] },
  { id: 'after', text: 'Performance completed.', actions: [{ kind: 'background', assetId: 'green', transition: 'none' }] },
  { id: 'move', text: 'Move completed.', actions: [{ kind: 'hide', characterId: 'actor', transition: 'move', duration: .7 }] },
  { id: 'nonblocking', text: 'Nonblocking first.', actions: [{ kind: 'background', assetId: 'red', transition: 'dissolve', duration: 2, wait: false }] },
  { id: 'next', text: 'Nonblocking next.', actions: [] },
  { id: 'disabled', text: 'Disabled transition completed.', actions: [{ kind: 'background', assetId: 'green', transition: 'fade', duration: 3 }] },
  { id: 'interrupt', text: 'Interrupted transition completed.', actions: [{ kind: 'background', assetId: 'red', transition: 'fade', duration: 3 }] },
] },
{ id: 'scene_jump', name: 'Scene jump', kind: 'jump', sceneId, x: 0, y: 0, target: 'other', sceneTransition: { mode: 'fade', duration: .7, color: '#000000', fromSceneId: sceneId, toSceneId: 'other_scene' } },
{ id: 'other', name: 'Other', kind: 'passage', sceneId: 'other_scene', x: 0, y: 0, next: 'story', lines: [{ id: 'scene', text: 'Scene transition completed.', actions: [] }] }];
const game = path.join(output, 'game'), sdk = path.resolve('resources/runtime');
const built = await buildProject({ project, projectDir: output, outputDir: game, sdkRoot: sdk });
assert.ok(built.ok, built.log + JSON.stringify(built.diagnostics));
if (process.argv.includes('--baseline')) {
  const file = path.join(game, 'game/story.rpy');
  const story = await fs.readFile(file, 'utf8');
  await fs.writeFile(file, story.replace('return renpy.with_statement({"master": transition, None: Pause(duration)})', 'return renpy.with_statement(transition)')
    .replaceAll('renpy.hide_screen("vn_performance_cover", layer="master")', 'renpy.hide_screen("vn_performance_cover")')
    .replace('color=transition["color"], _layer="master", _zorder=cover_order', 'color=transition["color"]'));
}
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
init 1000 python:
    import time as qa_time, json as qa_json, zlib as qa_zlib
    qa_frames = []
    qa_last_line = None
    qa_last_sample = 0
    qa_draw = renpy.display.core.Interface.draw_screen
    def qa_record_draw(self, root_widget, fullscreen_video, draw):
        global qa_last_line, qa_last_sample
        qa_draw(self, root_widget, fullscreen_video, draw)
        if draw and vn_current_node in ("story", "other") and qa_time.monotonic() - qa_last_sample >= .03:
            qa_last_sample = qa_time.monotonic()
            if qa_last_line != vn_current_line:
                print("QA_LINE", vn_current_line, flush=True)
                qa_last_line = vn_current_line
            surface = renpy.display.draw.screenshot(renpy.display.interface.surftree)
            w, h = surface.get_size()
            region = bytes(c for y in range(int(h * 2 / 3), h, 8) for x in range(0, w, 8) for c in surface.get_at((x, y))[:3])
            root_transition = renpy.get_ongoing_transition()
            qa_frames.append(dict(time=qa_time.monotonic(), line=vn_current_line,
                retained=vn_retained_dialogue, text=renpy.get_widget("say", "what").text if renpy.get_widget("say", "what") else None,
                ui=qa_zlib.crc32(region),
                pixel=list(surface.get_at((int(w / 2), int(h / 5))))[:3],
                root=type(self.instantiated_transition.get(None)).__name__ if root_transition else None,
                master=bool(renpy.get_ongoing_transition("master"))))
    renpy.display.core.Interface.draw_screen = qa_record_draw

# An opaque dialogue panel makes any unintended UI fading measurable independently of the stage.
screen say(who, what):
    zorder 100
    fixed:
        ypos 300
        ysize 150
        add Solid("#202020")
        text what id "what" xpos 30 ypos 30 size 26 color "#ffffff" font "DejaVuSans.ttf" slow_cps 0

testsuite global:
    before testcase:
        $ _test.timeout = 15
        $ _test.transition_timeout = .1
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.transitions = 2
    teardown:
        exit

testcase dialogue:
    click id "vn_main_start"
    pause until "First stable dialogue."
    pause .15
    click pos (700, 100)
    pause until "Background completed."
    pause .15
    click pos (700, 100)
    pause until "Speaker completed."
    pause .15
    click pos (700, 100)
    pause until "Fade completed."
    pause .15
    click pos (700, 100)
    pause until "Performance completed."
    pause .15
    click pos (700, 100)
    pause until "Move completed."
    pause .15
    click pos (700, 100)
    pause until "Nonblocking first."
    assert eval renpy.get_ongoing_transition("master") is not None
    $ qa_transition_start = renpy.display.interface.transition_time["master"]
    advance
    pause until "Nonblocking next."
    assert eval renpy.display.interface.transition_time["master"] == qa_transition_start
    pause 2.1
    $ preferences.transitions = 0
    $ qa_started = qa_time.monotonic()
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Disabled transition completed."
    assert eval qa_time.monotonic() - qa_started < 1
    $ preferences.transitions = 2
    $ qa_started = qa_time.monotonic()
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause .2
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Interrupted transition completed."
    assert eval qa_time.monotonic() - qa_started < 1.5
    pause .15
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Scene transition completed."
    screenshot "finished.png"
    $ qa_json.dump(qa_frames, open(config.basedir + "/frames.json", "w"))
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 60000, onData: text => process.stdout.write(text), env: { RENPY_RENDERER: 'gl2', PYTHONUNBUFFERED: '1' } });
await fs.writeFile(path.join(output, 'runtime.log'), result.log);
assert.equal(result.code, 0, result.log.slice(-6000));
type Frame = { time: number; line: string; retained: [string | null, string] | null; text: string[]; ui: number; pixel: number[]; root: string | null; master: boolean };
const frames: Frame[] = JSON.parse(await fs.readFile(path.join(game, 'frames.json'), 'utf8'));
const checks = ['dissolve', 'speaker', 'fade', 'performance', 'after', 'move', 'scene'].map(line => {
  const during = frames.filter(f => f.line === line && (f.root || f.master));
  assert.ok(during.length >= 3, line + ' actually animates');
  return { line, frames: during.length, uiHashes: [...new Set(during.map(f => f.ui))], elapsed: during.at(-1)!.time - during[0].time, roots: [...new Set(during.map(f => f.root))] };
});
console.log(output, JSON.stringify(checks));
if (!process.argv.includes('--baseline')) {
  for (const check of checks) {
    assert.equal(check.uiHashes.length, 1, check.line + ' keeps dialogue pixels unchanged throughout transition');
    assert.ok(check.elapsed >= .35, check.line + ' preserves blocking duration');
    assert.deepEqual(check.roots, ['NoTransition'], check.line + ' only master visually transitions');
  }
  // Samples are 60 ms apart, so allow the closest frame to miss the exact black midpoint.
  assert.ok(frames.some(f => f.line === 'fade' && f.pixel.every(c => c < 32)), 'stage still fades through black');
  assert.ok(frames.some(f => f.line === 'performance' && f.pixel.every(c => c < 5)), 'performance cover also covers high-zorder actors');
}
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', baseline: process.argv.includes('--baseline'), checks, frameCount: frames.length }, null, 2));
