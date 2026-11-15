import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, type StoryLine, type TextPresentation } from '../src/core/model';
import { createVisualObject } from '../src/core/visual-object';
import { textCommandAction } from '../src/core/text-script';
import { effectiveTextStyle, textRuntimeLook } from '../src/core/text-presentation';
import { uiPageTheme } from '../src/core/ui-page-settings';
import { buildProject, runRenpy } from '../src/runtime/service';
import { isolateRenpySaves } from './lib/renpy-saves';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { preserveRenpyScreenshots } from './lib/text-typography';

// Plays per-line text looks in the real game: style, reveal speed, every entrance and
// loop shader, screen placement, and the previous words keeping their look between lines.
const root = path.resolve('.'), sdk = path.join(root, 'resources/runtime');
const artifactRoot = process.env.VNS_ARTIFACT_ROOT ? path.resolve(process.env.VNS_ARTIFACT_ROOT) : path.join(root, 'artifacts');
const output = path.join(artifactRoot, 'text-presentation-runtime', new Date().toISOString().replaceAll(':', '-'));
const projectDir = path.join(output, 'project'), game = path.join(output, 'game');
await fs.mkdir(projectDir, { recursive: true });
await isolateRenpySaves(output);

try {
const project = createProject('文字演出验收');
const passage = project.nodes.find(node => node.kind === 'passage');
assert.ok(passage?.kind === 'passage');
const line = (id: string, text: string, textPresentation?: TextPresentation, extra: Partial<StoryLine> = {}): StoryLine => ({ id, text, actions: [], ...(textPresentation ? { textPresentation } : {}), ...extra });
const styled = line('styled', '红色的大字逐个砸下来。', { color: '#ff3030', sizeScale: 1.5, bold: true, speed: 'duration', duration: 2, entrance: 'slam', loop: 'wave' });
const kept = line('kept', '这一句之前会停顿。', undefined, { actions: [{ kind: 'pause', seconds: 1.5 }] });
const screen = line('screen', '画面中央的大字', { presetId: 'builtin_text_title', y: .4, speed: 'instant' });
const effects = ([['drop', 'pulse'], ['rise', 'shake'], ['flip', 'none'], ['zoom', 'none'], ['fade', 'none']] as const)
  .map(([entrance, loop], index) => line(`effect_${entrance}`, `效果${index + 1}：${entrance}`, { entrance, loop, speed: 'cps', cps: 8 }));
// Part-line effects: a shaking big word, a wait inside the line, and a loop inside a line that has an entrance.
const marked = line('marked', '我不想死，真的。', { speed: 'cps', cps: 20 }, { textSpans: [{ start: 1, end: 4, style: { color: '#ff3030', sizeScale: 1.5, bold: true, loop: 'shake', loopStrength: 2 } }], textPauses: [{ at: 4, seconds: 1.5 }] });
const combo = line('combo', '这段是波浪的词。', { speed: 'cps', cps: 40, entrance: 'fade', color: '#88ccff' }, { textSpans: [{ start: 3, end: 7, style: { loop: 'wave', color: '#ffee66' } }] });
// Part-line entrances replace the line's on those words; the rest of the line keeps its own.
const partial = line('partial', '局部入场的句子。', { speed: 'cps', cps: 30, entrance: 'fade', loop: 'wave' }, { textSpans: [{ start: 0, end: 2, style: { entrance: 'slam', loop: 'shake' } }, { start: 2, end: 4, style: { entrance: 'none', loop: 'none' } }] });
const timeOnly = line('time_only', '只改局部入场时间。', { speed: 'cps', cps: 10, entrance: 'drop', entranceTime: .2, entranceAnimation: { x: 12, order: 'reverse' } }, { textSpans: [{ start: 0, end: 2, style: { entranceTime: .8 } }] });
project.textPresets = [
  { id: 'base_look', name: '基础演出', style: { italic: true, color: '#112233', entrance: 'drop', entranceAnimation: { x: 40, rotation: 90 } } },
  { id: 'child_look', name: '派生演出', style: { color: '#00ff66', entrance: 'fade', entranceAnimation: { y: 14 } } },
];
project.characters.push(
  { id: 'base_speaker', name: '基础角色', color: '#ffffff', expressions: [], textPresentation: { presetId: 'base_look', color: '#ff0000' } },
  { id: 'child_speaker', name: '派生角色', color: '#ffffff', expressions: [], baseCharacterId: 'base_speaker', textPresentation: { presetId: 'child_look' } },
);
const inherited = line('inherited', '派生预设保留继承字形。', { speed: 'cps', cps: 20 }, { speakerId: 'child_speaker' });
const clipText = createVisualObject('text');
Object.assign(clipText, { instanceId: 'clip_words', text: '时间轴上的逐字文字', fontSize: 72, duration: 2.4, wait: false, lifetime: undefined, textMotion: { speed: 'duration', duration: .8, entrance: 'drop', entranceTime: .3, entranceAnimation: { y: -50 }, loop: 'wave', loopStrength: 3, exit: 'zoom', exitTotal: .5 } });
const clipLine = line('clip_line', '时间轴文字这一句。', undefined, { actions: [clipText] });
// A deliberately long, silent pulse exposes missing stop/cleanup, without
// making the acceptance window sound repeatedly on the user's desktop.
const samples = 24000, wav = Buffer.alloc(44 + samples);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + samples, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(samples, 40);
wav.fill(128, 44);
await fs.mkdir(path.join(projectDir, 'assets'), { recursive: true }); await fs.writeFile(path.join(projectDir, 'assets/blip.wav'), wav);
project.assets.push({ id: 'blip', name: '打字音', kind: 'audio', path: 'assets/blip.wav' });
const typed = line('typed', '打字音的一句话，后面还很长很长很长很长。', { speed: 'cps', cps: 15, typeSoundId: 'blip', typeSoundEvery: 1 });
const typedNatural = line('typed_natural', '自然结束打字音。', { speed: 'cps', cps: 10, typeSoundId: 'blip', typeSoundEvery: 1 });
// The animator: adjusted movement, an order other than left to right, and an exit after the player advances.
const ordered = line('ordered', '从右到左旋转飞入的一句。', { speed: 'cps', cps: 25, entrance: 'zoom', entranceTime: .4, entranceAnimation: { rotation: 180, x: 60, order: 'reverse', easing: 'back' } });
const scattered = line('scattered', '随机出现然后飘走的文字。', { speed: 'duration', duration: 1, entrance: 'fade', entranceAnimation: { order: 'random', y: 30 }, exit: 'rise', exitTotal: 1.2, exitTime: .5, exitAnimation: { order: 'random' } });
const afterExit = line('after_exit', '退场之后的下一句。', undefined, { actions: [{ kind: 'pause', seconds: 1 }] });
const displayText = (source: string) => {
  const action = textCommandAction(project, source, true);
  assert.ok(action?.kind === 'visual' && action.content === 'text');
  return action;
};
const floating = line('floating', '两段浮空文字和这句台词同时显示。', { color: '#11ddaa', speed: 'instant', loop: 'shake' }, { actions: [
  displayText('@显示文字：第一段浮空文字，对象ID=caption_a，纵向位置=0.25，字号=64，颜色=#ffcc66，逐字时长=1，入场=逐字落下，入场翻转=否，持续效果=波浪'),
  displayText('@显示文字：第二段浮空文字，对象ID=caption_b，纵向位置=0.5，字号=36，颜色=#66ccff，速度=瞬间显示，持续效果=呼吸'),
] });
const replaced = line('floating_replaced', '只替换第一段，第二段继续显示。', { speed: 'instant' }, { actions: [displayText('@显示文字：替换后的普通文字，对象ID=caption_a，纵向位置=0.25')] });
const hiddenText = line('floating_hidden', '只隐藏第二段，第一段和台词保留。', { speed: 'instant' }, { actions: [{ kind: 'hideVisual', instanceId: 'caption_b' }] });
clipLine.actions.unshift({ kind: 'hideVisual', instanceId: 'caption_a' });
const hidden = line('hidden', '界面隐藏时这句的抖动不会出错。', undefined, { textSpans: [{ start: 0, end: 4, style: { loop: 'shake' } }] });
const plain = line('plain', '最后一句普通台词。');
passage.lines = [styled, kept, screen, ...effects, marked, combo, partial, timeOnly, inherited, typed, typedNatural, ordered, scattered, afterExit, floating, replaced, hiddenText, clipLine, hidden, plain];

const theme = uiPageTheme(project, 'ui:say');
const look = textRuntimeLook(project, effectiveTextStyle(project, styled), styled.text)!;
const what = 'renpy.get_widget("say", "what")';
const hex = (expression: string) => `Color(${expression}.style.color).hexcode`;
const built = await buildProject({ project, projectDir, outputDir: game, sdkRoot: sdk });
assert.ok(built.ok, built.log);
const effectSteps = effects.map(item => `    advance until ${JSON.stringify(item.text)}
    pause .3
    assert eval "vn_anim:" in ${what}.style.textshader
    screenshot ${JSON.stringify(`effect-${item.textPresentation!.entrance}.png`)}`).join('\n');
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
init python:
    def vn_test_words(words):
        widget = renpy.get_widget("say", "what")
        return widget is not None and words in str(widget.text[0])
    def vn_test_clip_shader(*names):
        found = []
        def walk(displayable):
            if isinstance(displayable, VnClipText):
                found.append(str(displayable.style.textshader))
            for child in displayable.visit() or []:
                if child is not None:
                    walk(child)

        for entry in renpy.game.context().scene_lists.layers["master"]:
            walk(entry.displayable)
        return any(all(name in shader for name in names) for shader in found)
    def vn_test_shader(*names):
        tokens = renpy.get_widget("say", "what").tokens
        return any(str(value).startswith("shader=") and all(name in str(value) for name in names) for kind, value in tokens)
testsuite global:
    before testcase:
        $ _test.timeout = 30.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase text_presentation:
    click id "vn_main_start"
    pause until ${JSON.stringify(styled.text)}
    pause .3
    # The line's own colour, size, weight, speed and shaders reach the dialogue text.
    assert eval ${hex(what)} == "#ff3030"
    assert eval ${what}.style.size == ${Math.round(theme.fontSize * 1.5)}
    assert eval ${what}.style.bold
    assert eval abs(${what}.style.slow_cps - ${look.cps}) < 1e-6
    assert eval "u__scale=(2.5,2.5)" in ${what}.style.textshader and "wave" in ${what}.style.textshader
    assert eval ${what}.slow
    screenshot "styled-revealing.png"
    pause 2.2
    # The whole line is shown within its two-second duration.
    assert eval not ${what}.slow
    screenshot "styled-complete.png"
    click
    pause .5
    # During the next line's pause the previous words keep their own look.
    assert eval ${what}.text[0] == ${JSON.stringify(styled.text)} and ${hex(what)} == "#ff3030"
    assert eval not ${what}.slow
    pause until ${JSON.stringify(kept.text)}
    assert eval ${hex(what)} == ${JSON.stringify(theme.textColor.slice(0, 7).toLowerCase())}
    assert eval ${what}.style.textshader is None
    advance until ${JSON.stringify(screen.text)}
    pause .3
    # Screen placement hides the dialogue window and centres the words on the screen.
    assert eval renpy.get_widget("say", "window") is None
    assert eval ${what}.style.xpos == ${Math.round(project.width * .5)} and ${what}.style.ypos == ${Math.round(project.height * .4)}
    assert eval not ${what}.slow
    screenshot "screen-text.png"
${effectSteps}
    advance until eval vn_test_words("不想死")
    pause .6
    # The words before the wait are shown; the line is still revealing during the wait.
    assert eval ${what}.slow
    assert eval vn_test_shader("typewriter", "jitter")
    screenshot "marked-paused.png"
    pause 1.7
    assert eval not ${what}.slow
    screenshot "marked-complete.png"
    advance until eval vn_test_words("波浪的词")
    pause .6
    # The part-line loop joins the line's entrance shader, and the whole line keeps its own colour.
    assert eval vn_test_shader("vn_anim:", "wave")
    assert eval ${hex(what)} == "#88ccff"
    assert eval ${what}.text[0].count("{vn_fx=") == 1
    # History and save excerpts read the plain words.
    assert eval any(renpy.filter_text_tags(str(entry.what), allow=[]) == ${JSON.stringify(marked.text)} for entry in _history_list)
    screenshot "combo.png"
    advance until eval vn_test_words("的句子")
    pause .15
    # These words use their own entrance and loop, not the line's wave.
    assert eval vn_test_shader("u__scale=(2.5,2.5)", "jitter") and not vn_test_shader("jitter", "wave")
    # These words turn the line's effects off and simply appear.
    assert eval any(value == "shader=vn_typewriter" for kind, value in ${what}.tokens)
    # The rest of the line keeps its own shader.
    assert eval "vn_anim:" in ${what}.style.textshader and "wave" in ${what}.style.textshader
    screenshot "partial-entrance.png"
    advance until eval vn_test_words("局部入场时间")
    pause .2
    assert eval vn_test_shader("u__duration=0.8", "u__offset=(12,-36)", "u__order=1")
    assert eval "u__duration=0.2" in ${what}.style.textshader
    screenshot "time-only-span.png"
    advance until ${JSON.stringify(inherited.text)}
    pause .2
    assert eval ${hex(what)} == "#00ff66" and ${what}.style.italic
    assert eval "u__offset=(0,14)" in ${what}.style.textshader and "u__rotation=0:" in ${what}.style.textshader
    screenshot "inherited-preset.png"
    assert eval VnTypeSound.played == 0
    advance until eval vn_test_words("打字音的")
    pause .6
    # The sound plays as the words reveal, and stops when the player completes the line.
    assert eval VnTypeSound.played >= 4
    assert eval ${what}.slow
    assert eval renpy.music.get_playing(channel="vn_typing") is not None
    click
    pause .1
    assert eval not ${what}.slow
    assert eval renpy.music.get_playing(channel="vn_typing") is None
    $ vn_test_sounds = VnTypeSound.played
    pause .5
    assert eval VnTypeSound.played == vn_test_sounds
    # A game-menu boundary stops an outstanding typing pulse too.
    $ renpy.music.play("assets/blip.wav", channel="vn_typing")
    run ShowMenu("preferences")
    assert screen "preferences"
    assert eval renpy.music.get_playing(channel="vn_typing") is None
    click id "vn_game_menu_return"
    pause until eval not renpy.get_screen("preferences")
    pause .2
    assert eval renpy.music.get_playing(channel="vn_typing") is None
    assert eval VnTypeSound.played == vn_test_sounds
    advance until ${JSON.stringify(typedNatural.text)}
    pause .3
    assert eval ${what}.slow and renpy.music.get_playing(channel="vn_typing") is not None
    pause 1
    assert eval not ${what}.slow and renpy.music.get_playing(channel="vn_typing") is None
    screenshot "typing-finished.png"
    advance until eval vn_test_words("旋转飞入")
    pause .3
    # Adjusted values and the chosen order reach the shader.
    assert eval "u__offset=(60,0)" in ${what}.style.textshader and "u__order=1" in ${what}.style.textshader and "u__ease=4" in ${what}.style.textshader
    screenshot "ordered-reverse.png"
    advance until eval vn_test_words("随机出现")
    pause .5
    assert eval "u__order=4" in ${what}.style.textshader
    screenshot "scattered-random.png"
    pause 1
    assert eval not ${what}.slow
    # After the player advances, the words leave on the exit shader, before the next line.
    click
    pause .4
    assert eval vn_text_exiting
    assert eval vn_test_words("随机出现")
    assert eval "vn_anim_out:" in ${what}.style.textshader
    assert eval ${what}.slow
    screenshot "scattered-leaving.png"
    pause 1.1
    # The next line's pause does not bring the words back.
    assert eval vn_retained_dialogue is None and not vn_text_exiting
    screenshot "after-exit-pause.png"
    pause until eval vn_test_words("退场之后")
    assert eval "vn_anim" not in str(${what}.style.textshader)
    advance until ${JSON.stringify(floating.text)}
    pause .4
    assert eval renpy.showing("vn_visual_caption_a") and renpy.showing("vn_visual_caption_b")
    assert eval renpy.get_widget("say", "window") is not None and ${hex(what)} == "#11ddaa"
    assert eval "jitter" in ${what}.style.textshader and vn_test_clip_shader("vn_anim:", "wave") and vn_test_clip_shader("vn_pulse")
    screenshot "two-floating-texts.png"
    advance until ${JSON.stringify(replaced.text)}
    pause .2
    assert eval renpy.showing("vn_visual_caption_a") and renpy.showing("vn_visual_caption_b")
    assert eval vn_test_clip_shader("vn_pulse") and not vn_test_clip_shader("wave")
    screenshot "replace-one-text.png"
    advance until ${JSON.stringify(hiddenText.text)}
    pause .2
    assert eval renpy.showing("vn_visual_caption_a") and not renpy.showing("vn_visual_caption_b")
    assert eval renpy.get_widget("say", "window") is not None and ${what}.style.textshader is None
    screenshot "hide-one-text.png"
    advance until eval vn_test_words("时间轴文字")
    pause .4
    # A timeline text clip reveals on the same shader, on its own clock, then leaves before its end.
    assert eval vn_test_clip_shader("vn_anim:", "wave", "vn_anim_out:")
    screenshot "clip-revealing.png"
    pause 1
    screenshot "clip-revealed.png"
    pause .5
    screenshot "clip-leaving.png"
    $ vn_interface_visible = False
    click
    pause until eval vn_test_words("界面隐藏")
    # With the interface hidden the invisible text still carries the line; its tag is harmless.
    assert eval ${what}.style.size == 1 and "{vn_fx=" in ${what}.text[0]
    $ vn_interface_visible = True
    advance until ${JSON.stringify(plain.text)}
    pause .2
    assert eval renpy.get_widget("say", "window") is not None and ${what}.style.textshader is None
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 120000, env: { RENPY_RENDERER: 'gl2' } });
await fs.writeFile(path.join(output, 'runtime.log'), result.log);
assert.equal(result.code, 0, result.log.slice(-6000));
assert.match(result.log, /Status: PASSED/);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', lines: passage.lines.length, cps: look.cps, assertions: Number(result.log.match(/Assertions :\s+(\d+)/)?.[1] ?? 0) }, null, 2));
} catch (error) {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', error: String(error) }, null, 2));
  throw error;
} finally {
  await preserveRenpyScreenshots(game, path.join(output, 'screenshots'));
  const cleanup = await cleanVerificationDirectories(output, ['project', 'game', 'saves', 'renpy-saves']);
  assert.deepEqual(cleanup.errors, []);
  console.log(output);
}
