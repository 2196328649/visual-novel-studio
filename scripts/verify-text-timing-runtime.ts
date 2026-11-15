import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject, type StoryLine, type TextPresentation } from '../src/core/model';
import { createVisualObject } from '../src/core/visual-object';
import { effectiveTextStyle, textRevealPlan } from '../src/core/text-presentation';
import { lineMarks, textCharacterMarks } from '../src/core/text-spans';
import { pythonLiteral as q } from '../src/runtime/literals';
import { buildProject, runRenpy } from '../src/runtime/service';
import { isolateRenpySaves } from './lib/renpy-saves';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { preserveRenpyScreenshots } from './lib/text-typography';

// Observe layouts and screenshots produced by the real renderer. Calling
// Text.render ourselves would change the clock/layout this acceptance measures.
const sdk = path.resolve(process.env.VNS_RENPY_SDK ?? 'resources/runtime');
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts', 'text-timing-runtime',
  new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const projectDir = path.join(output, 'project'), game = path.join(output, 'game');
const shots = path.join(output, 'screenshots'), traces = path.join(output, 'traces');
const relativeOutput = path.relative(path.resolve('.'), output);
assert.ok(relativeOutput && relativeOutput !== '..' && !relativeOutput.startsWith('..' + path.sep) && !path.isAbsolute(relativeOutput),
  'VNS_ARTIFACT_ROOT must be inside this checkout, so isolated runtime data can be cleaned safely.');

type Mode = 'natural' | 'hidden' | 'clicked' | 'early' | 'clip' | 'clipExit';
interface TimingCase {
  id: string;
  line: StoryLine;
  playerCps: number;
  mode: Mode;
  clipText?: string;
  clipStyle?: TextPresentation;
}
const project = createProject('文字计时一致性验收');
project.id = 'vns_text_timing_acceptance';
project.width = 800; project.height = 450;
project.playerDefaults = { textSpeed: 10, masterVolume: 0, fullscreen: false };
project.ui.fontSize = 34;
project.ui.textColor = '#55ff55';
project.ui.background = '#101010';
project.ui.accent = '#888888';
project.ui.dialogueHeight = .78;
project.ui.pages = { say: { showQuickMenu: false } };
project.ui.continueIndicatorId = 'tt_continue';
project.ui.continueIndicatorWidth = 12;
project.assets.push({ id: 'tt_continue', name: '继续标记', kind: 'image', path: 'assets/continue.png', width: 12, height: 12 });
const passage = project.nodes.find(node => node.kind === 'passage');
assert.ok(passage?.kind === 'passage');
passage.lines = [{ id: 'tt_ready', text: '文字计时验收已准备。', actions: [], textPresentation: { speed: 'instant', color: '#888888' } }];
const cases: TimingCase[] = [];
function add(id: string, text: string, style: TextPresentation, extra: Partial<StoryLine> = {}, mode: Mode = 'natural', playerCps = 10) {
  const item: TimingCase = { id, playerCps, mode, line: { id, text, actions: [], textPresentation: { color: '#55ff55', ...style }, ...extra } };
  cases.push(item);
  return item;
}
const words = '甲乙丙丁戊己庚辛';
add('tt_duration', words, { speed: 'duration', duration: 1 });
for (const [position, at] of [['start', 0], ['middle', 4], ['end', 8]] as const) {
  add('tt_pause_' + position, words, { speed: 'duration', duration: 1, entrance: 'fade', entranceTime: .2 }, { textPauses: [{ at, seconds: 2 }] });
}
for (const order of ['forward', 'reverse', 'center', 'edges', 'random'] as const) {
  add('tt_order_' + order, words, { speed: 'duration', duration: 1, entrance: 'fade', entranceTime: .1, entranceAnimation: { order } },
    { textSpans: [{ start: 0, end: 2, style: { entranceTime: .8, color: '#ff55ff', sizeScale: 1.3 } }] });
}
add('tt_blank_random', '\n甲乙\n\n丙丁戊己', { speed: 'duration', duration: 1, entrance: 'fade', entranceTime: .25, entranceAnimation: { order: 'random' } });
add('tt_spaces', '甲 乙 丙 丁', { speed: 'duration', duration: 1 });
add('tt_empty_pause', '', { speed: 'duration', duration: 1 }, { textPauses: [{ at: 0, seconds: 2 }] });
add('tt_newlines_pause', '\n\n', { speed: 'duration', duration: 1 }, { textPauses: [{ at: 2, seconds: 2 }] });
add('tt_player_zero', words, { speed: 'player' }, { textSpans: [{ start: 6, end: 8, style: { color: '#55ffff' } }], textPauses: [{ at: 4, seconds: 2 }] }, 'natural', 0);
const colored = { textSpans: [{ start: 0, end: 2, style: { color: '#ff55ff', sizeScale: 1.3 } },
  { start: 6, end: 8, style: { color: '#55ffff' } }], textPauses: [{ at: 4, seconds: 2 }] };
add('tt_player_zero_loop', words, { speed: 'player', loop: 'pulse', loopStrength: 0 }, colored, 'natural', 0);
add('tt_instant', words, { speed: 'instant', entrance: 'fade', loop: 'pulse', loopStrength: 0 }, colored);
add('tt_hidden', words, { speed: 'duration', duration: 1, entrance: 'fade', entranceTime: .1, entranceAnimation: { order: 'reverse' } },
  { textSpans: [{ start: 0, end: 2, style: { entranceTime: .8, color: '#ff55ff', sizeScale: 2, loop: 'wave' } }] }, 'hidden');
add('tt_clicked', words, { speed: 'cps', cps: 3, entrance: 'fade', entranceTime: .2 }, {}, 'clicked');
add('tt_early', '提前开始的台词在动作结束和读取存档以后不应重新逐字显示。', { speed: 'cps', cps: 3 }, { actions: [
  { kind: 'pause', seconds: .1 }, { kind: 'startDialogue' }, { kind: 'pause', seconds: 1.4 },
  { kind: 'startDialogue' }, { kind: 'pause', seconds: 1.4 },
] }, 'early');
for (const exit of [false, true]) {
  const id = exit ? 'tt_clip_instant_exit' : 'tt_clip_blank_random';
  const text = exit ? '独立浮空文字' : '\n甲乙\n\n丙丁';
  const style: TextPresentation = exit
    ? { speed: 'instant', loop: 'pulse', loopStrength: 0, exit: 'fade', exitTotal: .8, exitTime: .6 }
    : { speed: 'duration', duration: 1, entrance: 'fade', entranceTime: .25, entranceAnimation: { order: 'random' } };
  const clip = createVisualObject('text');
  Object.assign(clip, { instanceId: id, text, fontSize: 36, color: '#55ff55', duration: 2.4, wait: false, lifetime: undefined,
    width: .85, height: .8, textMotion: style,
    keyframes: [{ x: .5, y: .4, scale: 1, rotation: 0, opacity: 1, duration: 0, easing: 'linear' }] });
  const item = add(id, '独立文字计时。', { speed: 'instant', color: '#888888' }, { actions: [clip] }, exit ? 'clipExit' : 'clip');
  item.clipText = text; item.clipStyle = style;
}
for (const [index, item] of cases.entries()) {
  project.nodes.push({ kind: 'passage', id: 'node_' + item.id, name: item.id, sceneId: passage.sceneId, x: index * 220, y: 350,
    lines: [item.line, { id: item.id + '_after', text: '下一句。', actions: [], textPresentation: { speed: 'instant', color: '#888888' } }], next: passage.next });
}
const expected = Object.fromEntries(cases.map(item => {
  const text = item.clipText ?? item.line.text;
  const marks = item.clipText === undefined ? lineMarks(item.line) : {};
  const plan = textRevealPlan(item.clipStyle ?? effectiveTextStyle(project, item.line), text, item.playerCps, marks);
  const indexes = textCharacterMarks(text, marks).characters.map(character => character.glyphIndex);
  return [item.id, { mode: item.mode, line: item.line.id, clipText: item.clipText, playerCps: item.playerCps, plan,
    characters: Array.from(text).filter(character => character !== '\n').map(character => character.codePointAt(0)), indexes,
    nativeSeconds: item.mode === 'clipExit' ? 2.4 : plan.seconds }];
}));

function nativeCases() {
  return cases.map(item => {
    let body: string;
    if (item.mode === 'early') body = `    pause until eval (vn_line_dialogue or {}).get("started") is not None and tt_has_frame()
    pause .2
    assert eval renpy.get_widget("say", "what").slow
    click id "what"
    pause .08
    assert eval vn_current_line == ${q(item.id)} and vn_line_dialogue.get("revealed")
    run Function(tt_save_clicked)
    assert eval renpy.can_load("tt-clicked")
    run FileLoad("tt-clicked", confirm=False, slot=True)
    pause until eval len(tt_probe.loads) == 1
    assert eval vn_line_dialogue.get("revealed") and vn_line_dialogue.get("started") == tt_probe.saved_started
    pause 3.1
    assert eval vn_current_line == ${q(item.id)} and not renpy.get_widget("say", "what").slow
    assert eval vn_line_dialogue.get("started") == tt_probe.saved_started and vn_line_dialogue.get("revealed")
    screenshot "early-loaded.png"`;
    else if (item.mode === 'clicked') body = `    pause until eval tt_has_frame()
    pause .4
    assert eval renpy.get_widget("say", "what").slow
    $ tt_probe.clicked = True
    click id "what"
    pause .12
    assert eval vn_current_line == ${q(item.id)} and not renpy.get_widget("say", "what").slow
    screenshot "click-completed.png"
    click id "what"
    pause until eval vn_current_line == ${q(item.id + '_after')}
    assert eval tt_slow_done_count() == 1`;
    else if (item.mode === 'clipExit') body = `    pause until eval tt_has_frame()
    pause .3
    screenshot "clip-instant-visible.png"
    pause 1.75
    screenshot "clip-exit-late.png"
    pause .6
    screenshot "clip-exit-ended.png"
    assert eval tt_has_shot("first") and tt_has_shot("exit")`;
    else body = `    pause until eval tt_has_frame()
    pause until eval tt_finished()
    pause .2
    assert eval tt_layout_matches()
    screenshot ${q(item.id + '-stable.png')}`;
    return `testcase ${item.id}:
    pause until screen "main_menu"
    click id "vn_main_start"
    pause until eval vn_current_line == "tt_ready" and renpy.get_widget("say", "what") is not None
    $ preferences.text_cps = ${item.playerCps}
    $ vn_interface_visible = ${q(!['hidden', 'clip', 'clipExit'].includes(item.mode))}
    $ tt_begin(${q(item.id)})
    run Jump(${q('vn_node_node_' + item.id)})
    move pos (5, 5)
${body}
`;
  }).join('\n');
}

function observer() {
  return String.raw`
init -999 python:
    import renpy as tt_engine
    tt_engine.safe_mode_checked = True
init 999 python:
    import builtins as tt_builtins
    import json as tt_json
    import os as tt_os
    import time as tt_time

    def tt_probe():
        pass
    with open(@@EXPECTED@@, "r", encoding="utf-8") as tt_expected_file:
        tt_probe.expected = tt_json.load(tt_expected_file)
    tt_probe.case = None
    tt_probe.watch = False
    tt_probe.frames = []
    tt_probe.events = []
    tt_probe.loads = []
    tt_probe.shots = {}
    tt_probe.latest = None
    tt_probe.widget = None
    tt_probe.serial = 0
    tt_probe.drawn_serial = -1
    tt_probe.saved_started = None
    tt_probe.clicked = False

    def tt_begin(name):
        tt_probe.case, tt_probe.watch = name, True
        tt_probe.frames, tt_probe.events, tt_probe.loads = [], [], []
        tt_probe.shots, tt_probe.latest, tt_probe.widget = {}, None, None
        tt_probe.serial, tt_probe.drawn_serial = 0, -1
        tt_probe.saved_started, tt_probe.clicked = None, False

    def tt_render(self, width, height, st, at):
        result = tt_render.original(self, width, height, st, at)
        if not tt_probe.watch:
            return result
        spec = tt_probe.expected[tt_probe.case]
        if vn_current_line != spec["line"]:
            return result
        clip = isinstance(self, VnClipText)
        if spec.get("clipText") is not None:
            if not clip or self.get_all_text() != spec["clipText"]:
                return result
        elif clip or self is not renpy.get_widget("say", "what") or self.get_all_text() != (vn_line_dialogue or {}).get("text"):
            return result
        layout = self.get_layout()
        if layout is None:
            return result
        glyphs = []
        for paragraph in layout.paragraph_glyphs:
            for glyph in paragraph:
                uniforms = {}
                if glyph.shader is not None:
                    uniforms = {key: float(value) for key, value in dict(glyph.shader.uniforms).items()
                        if key.startswith(("u_textshader_vn_anim_", "u_textshader_vn_anim_out_")) and isinstance(value, (float, int))}
                glyphs.append(dict(character=int(glyph.character), index=int(glyph.index), time=float(glyph.time), duration=float(glyph.duration), uniforms=uniforms))
        tt_probe.serial += 1
        tt_probe.widget = self
        ctc = self.ctc if isinstance(self.ctc, tt_builtins.list) else [self.ctc]
        ctc_times = [float(blit[-1]) for blit in (layout.displayable_blits or []) if any(blit[0] is value for value in ctc)]
        tt_probe.latest = dict(serial=tt_probe.serial, case=tt_probe.case, line=vn_current_line,
            subject=id(self), kind=type(self).__name__, st=float(st), at=float(at), slow=bool(self.slow),
            maximum=float(layout.max_time), getTime=float(self.get_time()), cps=float(layout.cps or 0),
            glyphs=glyphs, ctcTimes=ctc_times, shader=str(self.style.textshader), hidden=bool(getattr(self, "vn_timing_only", False)),
            retained=bool(vn_text_is_retained(self.get_all_text())), timingEnabled=bool(getattr(self, "vn_reveal_timing", False)),
            started=(vn_line_dialogue or {}).get("started"), revealed=bool((vn_line_dialogue or {}).get("revealed")),
            clicked=tt_probe.clicked, load=len(tt_probe.loads))
        return result

    def tt_draw(self, *args, **kwargs):
        result = tt_draw.original(self, *args, **kwargs)
        row = tt_probe.latest
        if not tt_probe.watch or row is None or row["serial"] == tt_probe.drawn_serial:
            return result
        tt_probe.drawn_serial = row["serial"]
        frame = dict(row, drawnAt=tt_time.monotonic())
        tt_probe.frames.append(frame)
        flags = ["first"] if len(tt_probe.frames) == 1 else []
        target = tt_probe.expected[tt_probe.case]["nativeSeconds"]
        if frame["slow"] and .15 < frame["st"] < max(.2, target * .8):
            flags.append("partial")
        if not frame["slow"]:
            flags.append("complete")
        if frame["slow"] and target - .13 <= frame["st"] < target:
            flags.append("before-complete")
        if tt_probe.expected[tt_probe.case]["mode"] == "clipExit" and 2.1 <= frame["st"] <= 2.3:
            flags.append("exit")
        if frame["load"]:
            flags.append("loaded")
        missing = [flag for flag in flags if flag not in tt_probe.shots]
        if missing:
            surface = renpy.display.draw.screenshot(renpy.game.interface.surftree)
            for flag in missing:
                tt_probe.shots[flag] = surface.copy()
        return result

    def tt_say_event(event, **kwargs):
        if tt_probe.watch and vn_current_line == tt_probe.expected[tt_probe.case]["line"]:
            tt_probe.events.append(dict(event=event, time=tt_time.monotonic(), line=vn_current_line,
                started=(vn_line_dialogue or {}).get("started"), revealed=bool((vn_line_dialogue or {}).get("revealed"))))

    def tt_load():
        if tt_probe.watch:
            tt_probe.loads.append(dict(time=tt_time.monotonic(), line=vn_current_line,
                started=(vn_line_dialogue or {}).get("started"), revealed=bool((vn_line_dialogue or {}).get("revealed"))))

    def tt_save_clicked():
        tt_probe.saved_started = vn_line_dialogue.get("started")
        tt_probe.clicked = True
        assert tt_probe.saved_started is not None and vn_line_dialogue.get("revealed")
        renpy.save("tt-clicked")

    # Test conditions must be pure: Ren'Py may evaluate an assert twice.
    def tt_has_frame():
        return bool(tt_probe.frames)
    def tt_has_shot(name):
        return name in tt_probe.shots
    def tt_finished():
        return bool(tt_probe.frames and not tt_probe.frames[-1]["slow"])
    def tt_layout_matches():
        target = tt_probe.expected[tt_probe.case]["nativeSeconds"]
        return bool(tt_probe.frames) and all(abs(row["maximum"] - target) < .005 and abs(row["getTime"] - target) < .005 for row in tt_probe.frames)
    def tt_slow_done_count():
        return sum(row["event"] == "slow_done" for row in tt_probe.events)

    def tt_dump():
        if tt_probe.case is None:
            return
        for name, surface in tt_probe.shots.items():
            renpy.pygame.image.save(surface, tt_os.path.join(@@SHOTS@@, tt_probe.case + "-" + name + ".png"))
        with open(tt_os.path.join(@@TRACES@@, tt_probe.case + ".json"), "w", encoding="utf-8") as handle:
            tt_json.dump(dict(case=tt_probe.case, frames=tt_probe.frames, events=tt_probe.events, loads=tt_probe.loads,
                savedStarted=tt_probe.saved_started, shots=list(tt_probe.shots)), handle, ensure_ascii=False, indent=2)

    tt_render.original = VnTimedText.render
    VnTimedText.render = tt_render
    tt_draw.original = renpy.display.core.Interface.draw_screen
    renpy.display.core.Interface.draw_screen = tt_draw
    config.all_character_callbacks.append(tt_say_event)
    config.after_load_callbacks.append(tt_load)

testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.transition_timeout = 2.0
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 10
        $ preferences.afm_enable = False
        $ config.skipping = None
        $ vn_interface_visible = True
    after testcase:
        $ tt_dump()
        $ tt_probe.watch = False
        run MainMenu(confirm=False)
        pause until screen "main_menu"
    teardown:
        $ tt_dump()
        exit
`.replaceAll('@@EXPECTED@@', q(path.join(output, 'expected.json')))
    .replaceAll('@@SHOTS@@', q(shots)).replaceAll('@@TRACES@@', q(traces)) + '\n' + nativeCases();
}

interface Glyph { character: number; index: number; time: number; duration: number; uniforms: Record<string, number> }
interface Frame {
  st: number; slow: boolean; maximum: number; getTime: number; cps: number; glyphs: Glyph[];
  hidden: boolean; revealed: boolean; clicked: boolean; load: number; shader: string; ctcTimes: number[]; retained: boolean; timingEnabled: boolean;
}
interface Trace { frames: Frame[]; events: { event: string }[]; loads: { started: number; revealed: boolean }[]; savedStarted: number; shots: string[] }
async function ink(file: string) {
  const image = PNG.sync.read(await fs.readFile(file));
  let green = 0, magenta = 0, cyan = 0, yellow = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    const [r, g, b, a] = image.data.subarray(index, index + 4);
    if (a < 128) continue;
    if (g > 125 && g - r > 50 && g - b > 50) green++;
    if (r > 125 && b > 125 && r - g > 50 && b - g > 50) magenta++;
    if (g > 125 && b > 125 && g - r > 50 && b - r > 50) cyan++;
    if (r > 150 && g > 150 && b < 80) yellow++;
  }
  return { green, magenta, cyan, yellow, width: image.width, height: image.height };
}
async function validateTrace(item: TimingCase) {
  const spec = expected[item.id];
  const trace: Trace = JSON.parse(await fs.readFile(path.join(traces, item.id + '.json'), 'utf8'));
  if (item.id.startsWith('tt_pause_')) assert.equal(spec.plan.seconds, 3, 'A two-second explicit pause preserves the one-second words budget');
  if (['tt_empty_pause', 'tt_newlines_pause'].includes(item.id)) assert.equal(spec.plan.seconds, 2, 'Empty text waits only for its explicit pause');
  if (item.id === 'tt_duration' || item.id.startsWith('tt_order_') || item.id === 'tt_blank_random' || item.id === 'tt_clip_blank_random') {
    assert.ok(Math.abs(spec.plan.seconds - 1) < 1e-7, item.id + ': preview missed the authored one-second target');
  }
  const first = trace.frames[0];
  assert.ok(first, item.id + ': no real drawn frame');
  assert.ok(first.st <= .2, item.id + ': first text frame was already late: ' + first.st);
  const normal = !['clicked', 'early', 'clipExit'].includes(item.mode);
  for (const frame of trace.frames) {
    if (item.mode === 'early' && frame.retained && !frame.timingEnabled) {
      // The old sentence can be retained while the saved stage action resumes.
      // It has no new reveal clock; still require it to remain fully revealed.
      assert.ok(frame.revealed && !frame.slow, 'retained saved words started typing again');
    } else assert.ok(Math.abs(frame.maximum - spec.nativeSeconds) < .005, item.id + ': native layout duration differs from preview: ' + JSON.stringify({ native: frame.maximum, expected: spec.nativeSeconds }));
    assert.ok(Math.abs(frame.getTime - frame.maximum) < .00001, item.id + ': get_time disagrees with rendered layout');
  }
  if (normal) {
    assert.equal(first.slow, spec.plan.seconds > 0, item.id + ': wrong slow state on the first real frame');
    const completed = trace.frames.find(frame => !frame.slow);
    assert.ok(completed, item.id + ': text never completed');
    assert.ok(completed.st >= spec.plan.seconds - .005 && completed.st <= spec.plan.seconds + .3,
      item.id + ': rendered completion missed the planned time: ' + JSON.stringify({ st: completed.st, expected: spec.plan.seconds }));
  }
  if (spec.plan.cps > 0 && item.mode !== 'clipExit') {
    const glyphs = first.glyphs.filter(glyph => ![0, 0x200b, 0xfeff, 0xfffc].includes(glyph.character));
    assert.deepEqual(glyphs.map(glyph => glyph.character), spec.characters, item.id + ': actual native glyphs differ');
    assert.deepEqual(glyphs.map(glyph => glyph.index), spec.indexes, item.id + ': pause/empty-line glyph indexes differ');
    glyphs.forEach((glyph, index) => assert.ok(Math.abs(glyph.time - spec.plan.times[index]) < .005,
      item.id + ': raw native reveal time differs at glyph ' + index));
  }
  if (spec.plan.cps === 0 && item.mode !== 'clipExit') {
    assert.ok(trace.frames.every(frame => !frame.slow && frame.maximum === 0), item.id + ': instant text resumed typing');
  }
  if (item.mode === 'early') {
    assert.equal(trace.loads.length, 1, 'early dialogue must perform one actual load');
    assert.equal(trace.loads[0].started, trace.savedStarted, 'load changed the saved dialogue start');
    assert.equal(trace.loads[0].revealed, true, 'load lost clicked completion');
    const afterLoad = trace.frames.filter(frame => frame.load > 0);
    assert.ok(afterLoad.length > 0 && afterLoad.every(frame => !frame.slow && frame.revealed), 'loaded early dialogue restarted typing');
  }
  if (item.mode === 'clicked') assert.equal(trace.events.filter(event => event.event === 'slow_done').length, 1, 'click must complete once');
  const pixels: Record<string, Awaited<ReturnType<typeof ink>>> = {};
  for (const name of trace.shots) pixels[name] = await ink(path.join(shots, item.id + '-' + name + '.png'));
  if (item.mode === 'hidden') {
    assert.ok(trace.frames.every(frame => frame.hidden), 'hidden test did not use the timing carrier');
    for (const sample of Object.values(pixels)) assert.equal(sample.green + sample.magenta, 0, 'hidden carrier leaked local text pixels');
  }
  if (['tt_order_reverse', 'tt_player_zero_loop', 'tt_instant'].includes(item.id)) {
    assert.ok(pixels.complete.green > 80 && pixels.complete.magenta > 80, item.id + ': visible color positive control is missing');
    if (spec.plan.cps === 0) {
      assert.ok(pixels.first.green > 80 && pixels.first.magenta > 80 && pixels.first.cyan > 80,
        item.id + ': first instant frame lost the separately colored final words after an authored pause');
    }
  }
  if (item.id === 'tt_player_zero') assert.ok(pixels.first.green > 120 && pixels.first.cyan > 80, 'zero-speed unshaded first frame lost the final words after its pause');
  if (item.id === 'tt_duration') {
    assert.ok(trace.frames.some(frame => frame.glyphs.some(glyph => [0xfeff, 0xfffc].includes(glyph.character))), 'continue indicator was not laid out');
    assert.ok(pixels.complete.yellow > 10, 'continue indicator did not appear at completion');
  }
  if (item.id.startsWith('tt_order_')) {
    assert.ok(trace.frames.some(frame => frame.ctcTimes.length > 0), item.id + ': continue indicator has no native blit');
    for (const frame of trace.frames) for (const time of frame.ctcTimes) {
      assert.ok(Math.abs(time - frame.maximum) < .005, item.id + ': continue indicator time differs from the actual entrance completion');
    }
    assert.ok(pixels['before-complete'], item.id + ': no frame near the entrance completion');
    assert.equal(pixels['before-complete'].yellow, 0, item.id + ': continue indicator appeared while text was still entering');
    assert.ok(pixels.complete.yellow > 10, item.id + ': continue indicator was missing after the text finished');
  }
  if (item.mode === 'clipExit') {
    assert.ok(pixels.first.green > 100, 'instant independent text did not appear on the first frame');
    assert.ok(pixels.exit && pixels.exit.green < pixels.first.green * .95, 'independent text exit did not visibly progress');
    const ended = await findNativeShot('clip-exit-ended.png');
    const endedInk = await ink(ended);
    assert.equal(endedInk.green, 0, 'independent text remained after its exit');
    pixels.ended = endedInk;
  }
  return { id: item.id, mode: item.mode, frames: trace.frames.length, expectedSeconds: spec.nativeSeconds,
    first: { st: first.st, slow: first.slow, maximum: first.maximum }, pixels };
}
async function findNativeShot(name: string) {
  const files = await fs.readdir(shots, { recursive: true });
  const found = files.find(file => path.basename(file) === name);
  assert.ok(found, 'Missing native screenshot: ' + name);
  return path.join(shots, found);
}

const previousSaveRoot = process.env.RENPY_PATH_TO_SAVES;
const report: Record<string, unknown> = { status: 'running', output, cases: cases.map(item => item.id),
  checks: [], limitations: ['Simple Chinese glyphs and spaces; this fixture does not assert complex font shaping.', 'No UI editor screenshots; this acceptance exercises native Ren’Py text rendering.'] };
let failure: unknown;
await fs.mkdir(projectDir, { recursive: true });
await fs.mkdir(shots, { recursive: true });
await fs.mkdir(traces, { recursive: true });
try {
  await isolateRenpySaves(output);
  await fs.mkdir(path.join(projectDir, 'assets'), { recursive: true });
  const marker = new PNG({ width: 12, height: 12 });
  for (let index = 0; index < marker.data.length; index += 4) marker.data.set([255, 230, 0, 255], index);
  await fs.writeFile(path.join(projectDir, 'assets/continue.png'), PNG.sync.write(marker));
  await fs.writeFile(path.join(output, 'fixture.json'), JSON.stringify(project, null, 2));
  await fs.writeFile(path.join(projectDir, 'project.vns.json'), JSON.stringify(project, null, 2));
  await fs.writeFile(path.join(output, 'expected.json'), JSON.stringify(expected, null, 2));
  const source = observer();
  await fs.writeFile(path.join(output, 'testcases.rpy'), source);
  report.expectedCases = cases.length;
  report.expectedAssertions = (source.match(/^    assert /gm) ?? []).length;
  const built = await buildProject({ project, projectDir, outputDir: game, sdkRoot: sdk });
  await fs.writeFile(path.join(output, 'build.log'), built.log);
  assert.ok(built.ok, built.log + '\n' + JSON.stringify(built.diagnostics));
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), source);
  const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 240000,
    env: { RENPY_RENDERER: 'gl2', PYTHONUNBUFFERED: '1' }, onData: text => process.stdout.write(text) });
  await fs.writeFile(path.join(output, 'runtime.log'), result.log);
  await preserveRenpyScreenshots(game, shots);
  assert.equal(result.code, 0, result.log.slice(-12000));
  for (const item of cases) (report.checks as unknown[]).push(await validateTrace(item));
  report.status = 'passed';
} catch (error) {
  failure = error;
  report.status = 'failed';
  report.error = error instanceof Error ? error.stack : String(error);
} finally {
  try {
    await preserveRenpyScreenshots(game, shots);
    for (const relative of ['log.txt', 'traceback.txt', 'errors.txt', 'game/log.txt', 'game/traceback.txt', 'game/errors.txt']) {
      const file = path.join(game, relative);
      if (await fs.stat(file).then(stat => stat.isFile()).catch(() => false)) await fs.copyFile(file, path.join(output, relative.replaceAll('/', '-')));
    }
    const nativeReports = (await fs.readdir(game, { recursive: true }).catch(() => [] as string[]))
      .filter(file => /report[^/\\]*\.(json|xml|txt|html)$/i.test(file));
    for (const relative of nativeReports) {
      const target = path.join(output, 'native-reports', relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(path.join(game, relative), target);
    }
  } catch (error) { report.evidenceError = String(error); failure ??= error; report.status = 'failed'; }
  if (previousSaveRoot === undefined) delete process.env.RENPY_PATH_TO_SAVES;
  else process.env.RENPY_PATH_TO_SAVES = previousSaveRoot;
  try {
    const cleanup = await cleanVerificationDirectories(output, ['project', 'game', 'saves', 'renpy-saves']);
    report.cleanup = cleanup;
    if (cleanup.errors.length) throw new Error('Isolated runtime cleanup failed: ' + JSON.stringify(cleanup.errors));
  } catch (error) { report.cleanupError = String(error); failure ??= error; report.status = 'failed'; }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(output);
}
if (failure) throw failure;
