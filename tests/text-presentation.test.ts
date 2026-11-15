import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, effectiveCharacter, projectSchema, type Project, type StoryLine } from '../src/core/model';
import { builtinTextPresets, effectiveTextStyle, mergeTextStyles, resolveTextStyle, speakerTextStyle, textCharacterFrame, textRevealPlan, textRuntimeLook, visibleCharacterCount } from '../src/core/text-presentation';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { patchStageSource } from '../src/core/stage-edit';
import { validateProject } from '../src/core/validate';
import { compileProject } from '../src/runtime/compiler';

function project(lines: Partial<StoryLine>[]): Project {
  const p = createProject();
  p.characters = [{ id: 'hero', name: '主角', color: '#ffffff', expressions: [] }];
  const passage = p.nodes.find(node => node.kind === 'passage');
  if (passage?.kind !== 'passage') throw new Error('template has no passage');
  passage.lines = lines.map((line, index) => ({ id: `line_${index}`, text: '你好，世界。', actions: [], ...line }));
  return p;
}
const passageLines = (p: Project) => p.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []);

test('looks layer theme, speaker, preset and line, field by field', () => {
  const p = project([{ speakerId: 'hero', textPresentation: { presetId: 'builtin_text_whisper', color: '#00ff00', textEffects: { outlineWidth: 2 } } }]);
  p.characters[0].textPresentation = { fontAssetId: 'font_a', sizeScale: 1.2, textEffects: { outlineColor: '#112233' } };
  const style = effectiveTextStyle(p, passageLines(p)[0]);
  // The preset sets size, the line its colour; the speaker's font and outline colour remain.
  assert.equal(style.fontAssetId, 'font_a');
  assert.equal(style.sizeScale, .85);
  assert.equal(style.color, '#00ff00');
  assert.equal(style.italic, true);
  assert.deepEqual(style.textEffects, { outlineColor: '#112233', outlineWidth: 2 });
  assert.deepEqual(mergeTextStyles({ color: '#111111' }, undefined, { bold: true }), { color: '#111111', bold: true });
});

test('a derived character inherits and overrides its base look', () => {
  const p = project([]);
  p.characters.push({ id: 'twin', name: '分身', color: '#ffffff', expressions: [], baseCharacterId: 'hero', textPresentation: { color: '#ff0000' } });
  p.characters[0].textPresentation = { italic: true, color: '#0000ff' };
  assert.deepEqual(effectiveCharacter(p, 'twin')!.textPresentation, { italic: true, color: '#ff0000' });
});

test('character presets resolve per inheritance layer, matching the character panel and game', () => {
  const p = project([{ speakerId: 'twin' }]);
  p.textPresets = [
    { id: 'base_look', name: '基础', style: { italic: true, color: '#112233', entrance: 'drop', entranceAnimation: { x: 40, rotation: 90 } } },
    { id: 'child_look', name: '派生', style: { color: '#00ff66', entrance: 'fade', entranceAnimation: { y: 14 } } },
  ];
  p.characters[0].textPresentation = { presetId: 'base_look', color: '#ff0000' };
  p.characters.push({ id: 'twin', name: '分身', color: '#ffffff', expressions: [], baseCharacterId: 'hero', textPresentation: { presetId: 'child_look' } });
  const expected = { italic: true, color: '#00ff66', entrance: 'fade', entranceAnimation: { y: 14 } };
  assert.deepEqual(speakerTextStyle(p, 'twin'), expected);
  assert.deepEqual(effectiveTextStyle(p, passageLines(p)[0]), expected);
  assert.deepEqual(speakerTextStyle(p, 'twin'), mergeTextStyles(speakerTextStyle(p, 'hero'), resolveTextStyle(p, p.characters[1].textPresentation)));
  assert.equal(textRuntimeLook(p, speakerTextStyle(p, 'twin'), '派生台词')!.color, '#00ff66');
  // Changing the child preset must not erase still-inherited fields, and a
  // grandchild override must not flatten away the child's preset either.
  p.characters.push({ id: 'third', name: '再派生', color: '#ffffff', expressions: [], baseCharacterId: 'twin', textPresentation: { bold: true } });
  assert.deepEqual(speakerTextStyle(p, 'third'), { ...expected, bold: true });
  p.characters[0].baseCharacterId = 'third';
  assert.equal(speakerTextStyle(p, 'third').bold, true, 'invalid cycles still terminate and are left to diagnostics');
});

test('an explicit new animation discards adjustments from the previous effect before applying its own', () => {
  const base = { entrance: 'drop', entranceAnimation: { x: 40, rotation: 90 }, exit: 'slam', exitAnimation: { scale: 3, y: 12 } } as const;
  assert.deepEqual(mergeTextStyles(base, { entrance: 'fade', entranceAnimation: { y: 10 }, exit: 'rise', exitAnimation: { order: 'reverse' } }), {
    entrance: 'fade', entranceAnimation: { y: 10 }, exit: 'rise', exitAnimation: { order: 'reverse' },
  });
  assert.deepEqual(mergeTextStyles(base, { entranceAnimation: { y: 10 } }).entranceAnimation, { x: 40, rotation: 90, y: 10 });
  assert.deepEqual(base.entranceAnimation, { x: 40, rotation: 90 });
});

test('duration speed finishes the whole line, entrance included, in the given time', () => {
  const text = '一二三四五\n六七八九十';
  assert.equal(visibleCharacterCount(text), 10);
  const plan = textRevealPlan({ speed: 'duration', duration: 2, entrance: 'fade', entranceTime: .4 }, text, 35);
  assert.equal(plan.seconds, 2);
  assert.ok(Math.abs(plan.cps - 10 / 1.6) < 1e-9);
  assert.equal(plan.entranceTime, .4);
  // An entrance longer than half the line is shortened so the words still appear.
  assert.equal(textRevealPlan({ speed: 'duration', duration: 1, entrance: 'fade', entranceTime: 3 }, text, 35).entranceTime, .5);
  assert.deepEqual(textRevealPlan({ speed: 'instant' }, text, 35), { cps: 0, followsPlayer: false, count: 10, entranceTime: 0, seconds: 0, times: new Array(10).fill(0), starts: new Array(10).fill(0), animations: new Array(10).fill(undefined), entranceTimes: new Array(10).fill(0), pauseSeconds: 0, extended: false });
  assert.equal(textRevealPlan({ speed: 'cps', cps: 5 }, text, 35).seconds, 2);
  const player = textRevealPlan(undefined, text, 20);
  assert.equal(player.followsPlayer, true); assert.equal(player.seconds, .5);
  // A duration mode without a duration falls back to the player's speed.
  assert.equal(textRevealPlan({ speed: 'duration' }, text, 20).followsPlayer, true);
});

test('preview frames follow the entrance curve of each character', () => {
  const style = { speed: 'cps', cps: 10, entrance: 'zoom', entranceTime: .2 } as const;
  const plan = textRevealPlan(style, '一二三', 35);
  assert.equal(textCharacterFrame(style, plan, 1, .05, 1).opacity, 0);
  // As in Ren'Py, each character waits one character's time before it starts.
  const half = textCharacterFrame(style, plan, 1, .3, 1);
  assert.ok(Math.abs(half.opacity - .5) < 1e-9 && /^scale\(0\.(5|49999)/.test(half.transform!), JSON.stringify(half));
  assert.deepEqual(textCharacterFrame(style, plan, 1, .4, 1), { opacity: 1 });
  assert.deepEqual(textCharacterFrame(style, plan, 2, undefined, 1), { opacity: 1 });
  const typed = textRevealPlan({ speed: 'cps', cps: 10 }, '一二三', 35);
  assert.equal(textCharacterFrame({}, typed, 2, .29, 1).opacity, 0);
  assert.equal(textCharacterFrame({}, typed, 2, .31, 1).opacity, 1);
});

test('compiled lines carry their look; plain lines and the say screen stay unchanged', () => {
  const p = project([{ textPresentation: { speed: 'duration', duration: 2, entrance: 'slam', entranceTime: .2, loop: 'wave', color: '#ff0000', placement: 'screen', y: .3 } }, {}]);
  p.assets.push({ id: 'font_a', name: '标题字体', kind: 'font', path: 'assets/fonts/title.ttf' });
  passageLines(p)[1].textPresentation = { fontAssetId: 'font_a', sizeScale: 1.5 };
  const built = compileProject(p);
  assert.deepEqual(built.diagnostics.filter(d => d.severity === 'error'), []);
  const story = built.files['game/story.rpy'];
  const look = textRuntimeLook(p, effectiveTextStyle(p, passageLines(p)[0]), '你好，世界。')!;
  assert.ok(Math.abs(Number(look.cps) - 6 / 1.8) < 1e-12);
  assert.deepEqual(look.place, { x: .5, y: .3, width: .8 });
  assert.equal(look.align, .5);
  assert.ok(story.includes('"presentation": {'));
  assert.ok(story.includes('"anim": "0,0,2.5,2.5,0,0,0.2,0,0"'));
  assert.ok(story.includes('"font": "assets/fonts/title.ttf", "scale": 1.5'));
  assert.equal(story.match(/"presentation"/g)?.length, 2);
  const screens = built.files['game/screens.rpy'];
  assert.ok(screens.includes('vn_dialogue_text what id "what" vn_line_style True'));
  assert.ok(screens.includes('vn_dialogue_text what id "what" color "#00000000" size 1 vn_line_style "timing"'));
  assert.match(story, /\$ vn_showing_retained = False\n    \$ renpy\.checkpoint\(hard=False\)\n    "你好，世界。" id vn_say_/);
  assert.ok(screens.includes('$ _vn_text_place = vn_line_text_place(what)'));
  const runtime = Object.values(built.files).join('\n');
  assert.ok(runtime.includes('vn_text_register_anim("vn_anim_out", True)') && runtime.includes('"vn_pulse"'));
  assert.ok(!compileProject(project([{}])).files['game/story.rpy'].includes('"presentation"'));
});

test('text mode writes and reads @文字演出 without losing any field', () => {
  const look = { presetId: 'builtin_text_memory', fontAssetId: 'font_a', sizeScale: 1.3, color: '#ff5a4f', bold: true, italic: false, align: 'center', textEffects: { outlineWidth: 2, outlineColor: '#000000', shadowX: -1, shadowOpacity: .5 },
    speed: 'duration', duration: 2.5, placement: 'screen', x: .5, y: .3, width: .7, entrance: 'drop', entranceTime: .3, loop: 'pulse', loopStrength: 30, loopSpeed: .5 } as const;
  const p = project([{ speakerId: 'hero', textPresentation: look }, { text: '普通的一句。' }]);
  p.assets.push({ id: 'font_a', name: '标题字体', kind: 'font', path: 'assets/fonts/title.ttf' });
  const source = projectToText(p);
  assert.match(source, /@文字演出：预设=回忆【builtin_text_memory】，字体=标题字体【font_a】，大小=130，颜色=#ff5a4f，粗体=是，斜体=否，对齐=居中/);
  assert.equal(source.match(/@文字演出/g)?.length, 1);
  const parsed = applyTextScript(p, source);
  assert.deepEqual(parsed.issues.filter(issue => issue.severity === 'error'), []);
  const [first, second] = passageLines(parsed.project);
  assert.deepEqual(first.textPresentation, look);
  assert.equal(second.textPresentation, undefined);
  assert.equal(projectToText(parsed.project), source);
});

test('typed @文字演出 accepts names and plain values and reports mistakes', () => {
  const p = project([{}]);
  const source = projectToText(p).replace('@对白标记', '@文字演出：预设=低语，时长=3，入场=逐字淡入\n主角：慢慢说。\n@对白标记');
  const parsed = applyTextScript(p, source);
  const line = passageLines(parsed.project).find(item => item.text === '慢慢说。')!;
  assert.deepEqual(line.textPresentation, { presetId: 'builtin_text_whisper', speed: 'duration', duration: 3, entrance: 'fade' });
  const bad = applyTextScript(p, projectToText(p).replace('@对白标记', '@文字演出：时长=0，入场=飞走\n主角：错。\n@对白标记'));
  assert.ok(bad.issues.some(issue => issue.message.includes('时长')));
});

test('stage edits rewrite only the changed @文字演出 row', () => {
  const p = project([{ speakerId: 'hero', textPresentation: { color: '#ff0000' } }, { text: '第二句。' }]);
  const source = projectToText(p);
  const parsed = applyTextScript(p, source);
  const after = structuredClone(parsed.project);
  passageLines(after)[0].textPresentation = { color: '#00ff00', speed: 'cps', cps: 12 };
  delete passageLines(after)[1].textPresentation;
  passageLines(after)[1].textPresentation = { speed: 'instant' };
  const patched = patchStageSource(parsed.project, after, source, parsed.sourceMap, parsed.nodeLocations);
  assert.equal(patched.match(/@文字演出/g)?.length, 2);
  assert.ok(patched.includes('@文字演出：颜色=#00ff00，速度=按速度，每秒字数=12\n主角：你好，世界。'));
  assert.ok(patched.includes('@文字演出：速度=瞬间显示\n旁白：第二句。'));
  assert.ok(!patched.includes('#ff0000'));
  const again = applyTextScript(after, patched);
  assert.deepEqual(passageLines(again.project).map(line => line.textPresentation), passageLines(after).map(line => line.textPresentation));
});

test('missing presets and fonts warn without blocking export; the schema rejects bad values', () => {
  const p = project([{ textPresentation: { presetId: 'gone', fontAssetId: 'nofont' } }]);
  const warnings = validateProject(p).filter(d => d.lineId === 'line_0');
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every(d => d.severity === 'warning'));
  assert.throws(() => projectSchema.parse({ ...p, textPresets: [{ id: 'x', name: '', style: {} }] }));
  assert.throws(() => projectSchema.parse(project([{ textPresentation: { duration: -1 } }])));
  assert.ok(builtinTextPresets.every(preset => projectSchema.shape.textPresets.unwrap().element.shape.style.safeParse(preset.style).success));
});
