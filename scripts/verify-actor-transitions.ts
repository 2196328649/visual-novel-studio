import { createShowCharacterFixture } from './lib/show-character-fixture';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject, type ActorTransitions, type StageAction } from '../src/core/model';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { textCommandAction } from '../src/core/text-script';
import { buildProject, runRenpy } from '../src/runtime/service';

const output = path.resolve('artifacts/actor-transitions', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = createProject('角色过渡验收'); project.width = 800; project.height = 450; project.playerDefaults = { textSpeed: 0, fullscreen: false, masterVolume: 0 };
for (const [id, rgb] of [['red', [220, 40, 50]], ['green', [30, 210, 70]]] as const) {
  const png = new PNG({ width: 180, height: 300 });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([...rgb, 255], i);
  await fs.writeFile(path.join(output, id + '.png'), PNG.sync.write(png));
  project.assets.push({ id, name: id, kind: 'image', path: id + '.png', width: 180, height: 300 });
}
const rules: Required<ActorTransitions> = { enter: { mode: 'dissolve', duration: .4 }, exit: { mode: 'dissolve', duration: .7 }, expression: { mode: 'dissolve', duration: .2 } };
project.characters = ['a', 'b'].map(id => ({ id, name: id.toUpperCase(), color: '#ffffff', expressions: [{ id: id + '_normal', name: 'Normal', assetId: 'red' }, { id: id + '_happy', name: 'Happy', assetId: 'green' }] }));
project.blueprints = [createShowCharacterFixture()];
const show = (characterId = 'a', expressionId = 'normal', extra = {}): StageAction => ({ kind: 'show', characterId, expressionId: characterId + '_' + expressionId, x: .5, y: 1, scale: 1, layer: 10, transition: 'dissolve', lifetime: 'line', actorTransitions: rules, ...extra });
const hideGraph = blueprintFromPerformance(project, [{ kind: 'hide', characterId: 'a', transition: 'dissolve', duration: .25 }], '显式隐藏'); project.blueprints.push(hideGraph);
const nestedShow = blueprintFromPerformance(project, [show('b')], '嵌套显示'); project.blueprints.push(nestedShow);
const nestedCall = blueprintFromPerformance(project, [{ kind: 'blueprint', blueprintId: nestedShow.id, actorTransitions: { exit: { mode: 'move', duration: .1 } } }], '嵌套调用'); project.blueprints.push(nestedCall);
const node = project.nodes.find(n => n.kind === 'passage')!;
project.entryId = node.id; node.next = node.id;
node.lines = [
  { id: 'first', text: 'First.', actions: [] },
  { id: 'enter', text: 'Enter.', actions: [show()] },
  { id: 'same', text: 'Same.', actions: [show()] },
  { id: 'expression', text: 'Expression.', actions: [show('a', 'happy')] },
  { id: 'switch', text: 'Switch.', actions: [show('b', 'normal', { actorTransitions: { ...rules, enter: { mode: 'dissolve', duration: .3 } } })] },
  { id: 'none', text: 'None.', actions: [] },
  { id: 'async', text: 'Async.', actions: [show('a', 'normal', { wait: false, lifetime: 'persistent', actorTransitions: { ...rules, enter: { mode: 'move', duration: 1 } } })] },
  { id: 'persistent', text: 'Persistent.', actions: [] },
  { id: 'explicit', text: 'Explicit.', actions: [{ kind: 'hide', characterId: 'a', transition: 'dissolve', duration: .25 }] },
  { id: 'blueprint', speakerId: 'b', text: 'Blueprint.', actions: [{ kind: 'blueprint', blueprintId: 'fixture_show_character', inputs: { default_framing: false, preset: '', x: .5, y: 1 }, actorTransitions: rules }] },
  { id: 'end', text: 'End.', actions: [] },
  { id: 'fade_enter', text: 'Fade enter.', actions: [show('a', 'normal', { actorTransitions: { ...rules, enter: { mode: 'fade', duration: .2 } } })] },
  { id: 'fade_expression', text: 'Fade expression.', actions: [show('a', 'happy', { actorTransitions: { ...rules, expression: { mode: 'fade', duration: .4 }, exit: { mode: 'move', duration: .5 } } })] },
  { id: 'move_exit', text: 'Move exit.', actions: [] },
  { id: 'offsets', text: 'Offsets.', actions: [show('a', 'normal', { lifetime: 'persistent', afterOffsets: { x: [{ at: 0, value: 0, easing: 'linear' }, { at: .2, value: .1, easing: 'linear' }] } })] },
  { id: 'animate', text: 'Animate.', actions: [{ kind: 'animate', characterId: 'a', wait: true, repeat: false, keyframes: [{ x: .4, y: 1, scale: 1, rotation: 0, opacity: 1, duration: .2, easing: 'linear' }] }] },
  { id: 'bluehide', text: 'Blueprint hide.', actions: [{ kind: 'blueprint', blueprintId: hideGraph.id }] },
  { id: 'reset_show', text: 'Reset show.', actions: [show()] },
  { id: 'reset', text: 'Reset.', actions: [{ kind: 'background', assetId: 'red', transition: 'none' }] },
  { id: 'nested', text: 'Nested.', actions: [{ kind: 'blueprint', blueprintId: nestedCall.id, actorTransitions: { expression: { mode: 'fade', duration: .6 } } }] },
  { id: 'default_reset', text: 'Default reset.', actions: [{ kind: 'background', assetId: 'green', transition: 'none' }] },
  { id: 'default_enter', speakerId: 'a', text: 'Default enter.', actions: [textCommandAction(project, '@显示角色')!] },
  { id: 'default_switch', speakerId: 'b', text: 'Default switch.', actions: [textCommandAction(project, '@显示角色')!] },
  { id: 'default_exit', text: 'Default exit.', actions: [] },
];
await fs.writeFile(path.join(output, 'project.vns.json'), JSON.stringify(project));
const game = path.join(output, 'game'), sdk = path.resolve('resources/runtime');
const built = await buildProject({ project, projectDir: output, outputDir: game, sdkRoot: sdk }); assert.ok(built.ok, built.log + JSON.stringify(built.diagnostics));
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
init python:
    import time as qa_time, json as qa_json
    qa_frames = []
    qa_draw = renpy.display.core.Interface.draw_screen
    qa_last_frame = 0
    def qa_actor_x(tag):
        frame = vn_actor_frame(renpy.display.core.displayable_by_tag("master", tag))
        pos = frame.visit()[0].get_placement()[0]
        return getattr(pos, "relative", pos)
    def qa_record(self, root_widget, fullscreen_video, draw):
        global qa_last_frame
        qa_draw(self, root_widget, fullscreen_video, draw)
        if draw and vn_current_line and qa_time.monotonic() - qa_last_frame > .03:
            qa_last_frame = qa_time.monotonic()
            surface = renpy.display.draw.screenshot(renpy.display.interface.surftree)
            if vn_current_line == "none" and len([f for f in qa_frames if f["line"] == "none"]) == 3:
                __import__("pygame_sdl2").image.save(surface, config.basedir + "/exit-mid.png")
            w, h = surface.get_size()
            qa_frames.append(dict(line=vn_current_line, time=qa_time.monotonic(), pixel=list(surface.get_at((int(w * .5), int(h * .5))))[:3]))
    renpy.display.core.Interface.draw_screen = qa_record

testsuite global:
    before testcase:
        $ _test.timeout = 15
        $ _test.transition_timeout = .1
        $ preferences.text_cps = 0
        $ preferences.transitions = 2
        $ preferences.afm_enable = False
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit

testcase phases:
    click id "vn_main_start"
    pause until "First."
    $ started = qa_time.monotonic()
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Enter."
    assert eval .3 < qa_time.monotonic() - started < 1.0
    assert eval vn_actor_instances["vn_actor_a"]["transitions"]["exit"]["duration"] == .7
    screenshot "entered.png"
    $ previous_actor = renpy.display.core.displayable_by_tag("master", "vn_actor_a")
    $ started = qa_time.monotonic()
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Same."
    assert eval qa_time.monotonic() - started < .2
    assert eval renpy.display.core.displayable_by_tag("master", "vn_actor_a") is previous_actor
    $ started = qa_time.monotonic()
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Expression."
    assert eval .12 < qa_time.monotonic() - started < .6
    screenshot "expression.png"
    $ started = qa_time.monotonic()
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Switch."
    assert eval .6 < qa_time.monotonic() - started < .95
    assert eval not renpy.showing("vn_actor_a") and renpy.showing("vn_actor_b")
    screenshot "switched.png"
    $ started = qa_time.monotonic()
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "None."
    assert eval .6 < qa_time.monotonic() - started < 1.1
    assert eval not renpy.showing("vn_actor_b")
    screenshot "departed.png"
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Async."
    pause .2
    $ renpy.session["qa_started_blend"] = vn_actor_instances["vn_actor_a"]["signature"]
    run FileSave("moving", confirm=False, slot=True)
    run FileLoad("moving", confirm=False, slot=True)
    pause until "Async."
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Persistent."
    assert eval vn_actor_instances["vn_actor_a"]["signature"] == renpy.session["qa_started_blend"]
    pause 1.1
    assert eval renpy.showing("vn_actor_a")
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Explicit."
    assert eval not renpy.showing("vn_actor_a")
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Blueprint."
    assert eval vn_actor_instances["vn_actor_b"]["transitions"]["expression"]["duration"] == .2
    assert eval vn_actor_transition_overrides == []
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "End."
    assert eval not renpy.showing("vn_actor_b")
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Fade enter."
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Fade expression."
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Move exit."
    assert eval not renpy.showing("vn_actor_a")
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Offsets."
    pause .3
    assert eval .58 < qa_actor_x("vn_actor_a") < .62
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Animate."
    assert eval .39 < qa_actor_x("vn_actor_a") < .41
    $ started = qa_time.monotonic()
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Blueprint hide."
    assert eval .17 < qa_time.monotonic() - started < .5
    assert eval not renpy.showing("vn_actor_a")
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Reset show."
    $ started = qa_time.monotonic()
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Reset."
    assert eval qa_time.monotonic() - started < .2
    assert eval not vn_actor_pending_exit and not vn_actor_departures
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Nested."
    assert eval vn_actor_instances["vn_actor_b"]["transitions"]["expression"]["duration"] == .6 and vn_actor_instances["vn_actor_b"]["transitions"]["exit"]["duration"] == .1
    assert eval not vn_actor_transition_overrides
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Default reset."
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Default enter."
    assert eval vn_actor_instances["vn_actor_a"]["lifetime"] == "line"
    assert eval vn_actor_instances["vn_actor_a"]["transitions"]["exit"] == dict(mode="dissolve", duration=0.5)
    $ started = qa_time.monotonic()
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Default switch."
    assert eval .4 < qa_time.monotonic() - started < .95
    assert eval not renpy.showing("vn_actor_a") and renpy.showing("vn_actor_b")
    $ started = qa_time.monotonic()
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Default exit."
    assert eval .4 < qa_time.monotonic() - started < .95
    assert eval not vn_actor_instances
    $ qa_json.dump(qa_frames, open(config.basedir + "/frames.json", "w"))
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 60000, env: { PYTHONUNBUFFERED: '1' }, onData: text => process.stdout.write(text) });
await fs.writeFile(path.join(output, 'runtime.log'), result.log); assert.equal(result.code, 0, result.log.slice(-4000));
const frames: { line: string; pixel: number[]; time: number }[] = JSON.parse(await fs.readFile(path.join(game, 'frames.json'), 'utf8'));
for (const line of ['enter', 'expression', 'switch', 'none', 'fade_enter', 'fade_expression', 'move_exit', 'default_enter', 'default_exit']) assert.ok(new Set(frames.filter(f => f.line === line).map(f => f.pixel.join(','))).size >= 3, line + ' actually changes visible pixels');
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', frames: frames.length, checks: ['independent phase durations', 'simultaneous switch uses maximum duration', 'same pose keeps displayable and skips wait', 'persistent, save/load, nonblocking', 'explicit hide and blueprint override', 'bare show defaults to 0.5 second dissolve departure on speaker switch and narration', 'visible pixels animate'] }, null, 2));
console.log(output);
