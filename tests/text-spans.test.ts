import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, projectSchema, textEasings, textOrders, type Project, type StoryLine, type TextPresentationStyle } from '../src/core/model';
import { animationSpec, applyEasing, entranceAnimations, fullAnimation, orderPosition } from '../src/core/text-animation';
import { isSimpleMediaVisual } from '../src/core/media-command';
import { createVisualObject } from '../src/core/visual-object';
import { compiledDialogueText, defaultEntranceTime, mergeTextStyles, textExitFrame, textExitPlan, defaultLoopSpeed, defaultLoopStrength, textCharacterFrame, textRevealPlan, textRuntimeLook, typeSoundIndexes, typeSoundTimes } from '../src/core/text-presentation';
import { applySpanStyle, clearSpanStyle, normalizeTextMarks, parseTextMarkup, rebaseTextMarks, renpyMarkedText, setLineText, setTextPause, sharedSpanStyle, textCharacterMarks } from '../src/core/text-spans';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { patchStageSource } from '../src/core/stage-edit';
import { validateProject } from '../src/core/validate';
import { compileProject } from '../src/runtime/compiler';

const defaults = { strength: defaultLoopStrength, speed: defaultLoopSpeed, entrance: defaultEntranceTime };
function project(lines: Partial<StoryLine>[]): Project {
  const p = createProject();
  p.characters = [{ id: 'hero', name: '主角', color: '#ffffff', expressions: [] }];
  const passage = p.nodes.find(node => node.kind === 'passage');
  if (passage?.kind !== 'passage') throw new Error('template has no passage');
  passage.lines = lines.map((line, index) => ({ id: `line_${index}`, text: '我不想死。', actions: [], ...line }));
  return p;
}
const passageLines = (p: Project) => p.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []);

test('range edits split, merge and keep the other fields of neighbouring effects', () => {
  const text = '一二三四五六';
  let spans = applySpanStyle(text, undefined, 1, 4, { color: '#ff0000' });
  spans = applySpanStyle(text, spans, 2, 3, { bold: true });
  assert.deepEqual(spans, [
    { start: 1, end: 2, style: { color: '#ff0000' } },
    { start: 2, end: 3, style: { color: '#ff0000', bold: true } },
    { start: 3, end: 4, style: { color: '#ff0000' } },
  ]);
  assert.deepEqual(sharedSpanStyle(text, spans, 1, 4), { color: '#ff0000' });
  // Removing the only differing field joins the pieces again.
  assert.deepEqual(applySpanStyle(text, spans, 2, 3, { bold: undefined }), [{ start: 1, end: 4, style: { color: '#ff0000' } }]);
  assert.deepEqual(clearSpanStyle(text, spans, 2, 6), [{ start: 1, end: 2, style: { color: '#ff0000' } }]);
  assert.deepEqual(setTextPause(setTextPause([], 3, 1), 1, 2), [{ at: 1, seconds: 2 }, { at: 3, seconds: 1 }]);
  assert.deepEqual(setTextPause([{ at: 1, seconds: 2 }], 1, undefined), []);
});

test('offsets count characters, so effects survive characters outside the basic plane', () => {
  const text = '𠮷𠮷野家';
  const spans = applySpanStyle(text, undefined, 1, 3, { color: '#ff0000' });
  assert.deepEqual(spans, [{ start: 1, end: 3, style: { color: '#ff0000' } }]);
  assert.equal(renpyMarkedText(createProject(), text, { spans }, defaults), '𠮷{color=#ff0000}𠮷野{/color}家');
});

test('editing the words keeps effects on the same words', () => {
  const spans = [{ start: 2, end: 4, style: { color: '#ff0000' } }], pauses = [{ at: 2, seconds: 1 }];
  // Typing before moves them, typing after leaves them.
  assert.deepEqual(rebaseTextMarks('我不想死。', '可是我不想死。', { spans, pauses }), { spans: [{ start: 4, end: 6, style: spans[0].style }], pauses: [{ at: 4, seconds: 1 }] });
  assert.deepEqual(rebaseTextMarks('我不想死。', '我不想死！！', { spans, pauses }).spans, spans);
  // Typing inside extends the effect; replacing a marked word keeps its effect.
  assert.deepEqual(rebaseTextMarks('我不想死。', '我不想要死。', { spans }).spans, [{ start: 2, end: 5, style: spans[0].style }]);
  assert.deepEqual(rebaseTextMarks('我不想死。', '我不愿意死。', { spans }).spans, [{ start: 2, end: 5, style: spans[0].style }]);
  // Deleting the marked words removes the effect and the pause before them.
  assert.deepEqual(rebaseTextMarks('我不想死。', '我。', { spans, pauses: [{ at: 3, seconds: 1 }] }), { spans: [], pauses: [] });
  // A pause waits before its word, so words typed in front of that word come before the pause.
  assert.deepEqual(rebaseTextMarks('我不想死。', '我不也想死。', { pauses }).pauses, [{ at: 3, seconds: 1 }]);
  assert.deepEqual(rebaseTextMarks('', '新的一句', { spans: [], pauses: [] }), { spans: [], pauses: [] });
  const line = { text: '我不想死。', textSpans: spans };
  setLineText(line, '我。');
  assert.equal(line.text, '我。');
  assert.equal(line.textSpans, undefined);
});

test('deleting the exact marked words also deletes their leading pause without shifting unrelated pauses', () => {
  const before = '甲不要乙', marks = { spans: [{ start: 1, end: 3, style: { bold: true as const } }], pauses: [{ at: 1, seconds: .7 }, { at: 3, seconds: .4 }, { at: 4, seconds: .2 }] };
  assert.deepEqual(rebaseTextMarks(before, '甲乙', marks), { spans: [], pauses: [{ at: 1, seconds: .4 }, { at: 2, seconds: .2 }] });
  assert.deepEqual(rebaseTextMarks('不要', '', { spans: marks.spans, pauses: [{ at: 0, seconds: .7 }] }), { spans: [], pauses: [] });
  // Replacing the words retains their effect and pause; inserting before them
  // shifts the pause so it still waits for the original words.
  assert.deepEqual(rebaseTextMarks(before, '甲需要乙', marks).pauses, marks.pauses);
  assert.deepEqual(rebaseTextMarks(before, '甲真不要乙', marks).pauses, [{ at: 2, seconds: .7 }, { at: 4, seconds: .4 }, { at: 5, seconds: .2 }]);
});

test('compiled words keep authored braces literal and only generated tags live', () => {
  const p = createProject();
  p.assets.push({ id: 'font_a', name: '手写', kind: 'font', path: 'assets\\fonts\\hand.ttf' });
  const text = '{w}[name]不想';
  const spans = [{ start: 3, end: 7, style: { color: '#ff0000', sizeScale: 1.5, bold: true as const, fontAssetId: 'font_a', speed: .5, loop: 'shake' as const, loopStrength: 2 } }];
  assert.equal(renpyMarkedText(p, text, { spans }, defaults), '{{w}{color=#ff0000}{size=*1.5}{b}{font=assets/fonts/hand.ttf}{cps=*0.5}{vn_fx=-|shake@2@1}[[nam{/vn_fx}{/cps}{/font}{/b}{/size}{/color}e]不想');
  assert.equal(renpyMarkedText(p, text, {}, defaults), '{{w}[[name]不想');
  // A pause is a blank glyph lasting its seconds; pauses end before the effect that follows opens.
  assert.equal(renpyMarkedText(p, '一二三', { spans: [{ start: 1, end: 3, style: { italic: true } }], pauses: [{ at: 1, seconds: 2 }, { at: 3, seconds: .5 }] }, defaults), '一{cps=0.5}{space=0}{/cps}{i}二三{/i}{cps=2}{space=0}{/cps}');
  assert.equal(renpyMarkedText(p, '一二', { spans: [{ start: 0, end: 1, style: { loop: 'pulse', loopStrength: 40, loopSpeed: 2 } }] }, defaults), '{vn_fx=-|pulse@40@2}一{/vn_fx}二');
});

test('instant lines drop waits and speed changes but keep the look of their words', () => {
  const p = createProject();
  const line = { text: '一二三', textPresentation: { speed: 'instant' as const }, textSpans: [{ start: 0, end: 1, style: { color: '#ff0000', speed: 3 } }], textPauses: [{ at: 1, seconds: 1 }] };
  assert.equal(compiledDialogueText(p, line), '{color=#ff0000}一{/color}二三');
});

test('reveal timing matches the game glyph by glyph and duration stays exact', () => {
  const spans = [{ start: 1, end: 2, style: { speed: .5 } }], pauses = [{ at: 2, seconds: 1 }];
  const plan = textRevealPlan({ speed: 'cps', cps: 10 }, '一二三', 35, { spans, pauses });
  assert.deepEqual(plan.times.map(time => +time.toFixed(6)), [.1, .3, 1.4]);
  assert.ok(Math.abs(plan.seconds - 1.4) < 1e-9);
  const timed = textRevealPlan({ speed: 'duration', duration: 3, entrance: 'fade', entranceTime: .5 }, '一二\n三', 35, { spans, pauses });
  // 2.5 seconds minus the pause leaves 1.5 for a weight of 4 characters.
  assert.ok(Math.abs(timed.cps - 4 / 1.5) < 1e-9);
  assert.equal(timed.seconds, 3);
  assert.ok(Math.abs(timed.times[2] + timed.entranceTime - 3) < 1e-9);
  // A conflicting pause preserves the original display budget for the words.
  const extended = textRevealPlan({ speed: 'duration', duration: .5 }, '一二', 35, { pauses: [{ at: 1, seconds: 2 }] });
  assert.deepEqual([extended.cps, extended.seconds, extended.pauseSeconds, extended.extended], [4, 2.5, 2, true]);
  const look = textRuntimeLook(createProject(), { speed: 'duration', duration: 3 }, '一二三', { spans, pauses })!;
  assert.ok(Math.abs((look.cps as number) - 4 / 2) < 1e-9);
  // A pause at a line break is carried to the next visible character.
  assert.equal(textCharacterMarks('一\n二', { pauses: [{ at: 1, seconds: 1 }] }).characters[1].pause, 1);
  assert.equal(textCharacterMarks('一二', { pauses: [{ at: 2, seconds: 1 }] }).trailing, 1);
});

test('duration conflicts preserve readable words, explicit pauses and the compiled entrance cap', () => {
  const p = createProject();
  for (const at of [0, 1, 2]) {
    const marks = { pauses: [{ at, seconds: 2 }] };
    const plain = textRevealPlan({ speed: 'duration', duration: 1 }, '一二', 35, marks);
    assert.equal(plain.seconds, 3);
    assert.equal(plain.cps, 2);
    assert.equal(plain.extended, true);
    const style = { speed: 'duration', duration: 1, entrance: 'fade', entranceTime: 9 } as const;
    const animated = textRevealPlan(style, '一二', 35, marks);
    assert.equal(animated.seconds, 3);
    assert.equal(animated.entranceTime, .5);
    assert.equal(textRuntimeLook(p, style, '一二', marks)!.cps, animated.cps);
    const line = { text: '一二', textPresentation: style, textSpans: [{ start: 0, end: 1, style: { entranceTime: 9 } }], textPauses: marks.pauses };
    assert.ok(compiledDialogueText(p, line).includes('{cps=0.5}{space=0}{/cps}'));
    assert.ok(compiledDialogueText(p, line).includes('{vn_fx=0,0,1,1,0,0,0.5,0,0|-}'));
  }
  const boundary = textRevealPlan({ speed: 'duration', duration: 1 }, '一二', 35, { pauses: [{ at: 1, seconds: 1 }] });
  assert.deepEqual([boundary.cps, boundary.seconds, boundary.extended], [2, 2, true]);
  const fits = textRevealPlan({ speed: 'duration', duration: 3 }, '一二', 35, { pauses: [{ at: 1, seconds: 1 }] });
  assert.deepEqual([fits.cps, fits.seconds, fits.extended], [1, 3, false]);
});

test('local entrances end on their own last visible frame, including reverse and trailing pauses', () => {
  const style = { speed: 'cps', cps: 10, entrance: 'fade', entranceTime: .1, entranceAnimation: { order: 'reverse' } } as const;
  const marks = { spans: [{ start: 0, end: 1, style: { entranceTime: 1 } }] };
  const plan = textRevealPlan(style, '一二三四', 35, marks);
  assert.deepEqual(plan.times, [.1, .2, .3, .4]);
  assert.deepEqual(plan.starts, [.3, .2, .1, 0]);
  assert.equal(plan.seconds, 1.3, 'the first letter finishes last after reversing the entrance order');
  assert.ok(textCharacterFrame(style, plan, 0, 1.2, 1).opacity < 1);
  assert.deepEqual(textCharacterFrame(style, plan, 0, 1.3, 1), { opacity: 1 });
  const tailed = textRevealPlan(style, '一二三四', 35, { ...marks, pauses: [{ at: 4, seconds: 2 }] });
  assert.equal(tailed.seconds, 2.4, 'a trailing pause stays after the unanimated glyph sequence');
  assert.deepEqual(tailed.starts, plan.starts, 'a trailing pause does not stretch entrance order');
  const allOff = textRevealPlan(style, '一二', 35, { spans: [{ start: 0, end: 2, style: { entrance: 'none' } }], pauses: [{ at: 2, seconds: .4 }] });
  assert.equal(allOff.seconds, .6, 'an invisible pause does not inherit a visible entrance delay');
});

test('empty paragraphs preserve only explicit pauses unless text is instant', () => {
  const project = createProject();
  for (const text of ['', '\n\n']) {
    const marks = { pauses: [{ at: text.length, seconds: 2 }] };
    const style = { speed: 'duration', duration: 1, entrance: 'fade', entranceTime: .3 } as const;
    const plan = textRevealPlan(style, text, 35, marks);
    assert.equal(plan.count, 0);
    assert.equal(plan.seconds, 2, 'no duration is allocated to nonexistent words');
    assert.equal(plan.pauseSeconds, 2);
    assert.equal(plan.extended, true);
    assert.ok(plan.cps > 0, 'native text must keep its explicit pause active');
    assert.equal(textRuntimeLook(project, style, text, marks)!.cps, plan.cps);
    assert.equal(textRevealPlan({ speed: 'duration', duration: 3 }, text, 35, marks).seconds, 2);
    assert.equal(textRevealPlan({ speed: 'cps', cps: 5 }, text, 35, marks).seconds, 2);
    assert.equal(textRevealPlan(undefined, text, 35, marks).seconds, 2);
    assert.equal(textRevealPlan(undefined, text, 0, marks).seconds, 0);
    assert.equal(textRevealPlan({ speed: 'instant' }, text, 35, marks).seconds, 0);
    assert.equal(textRevealPlan(style, text, 35).seconds, 0);
  }
  assert.deepEqual(textCharacterMarks('\n一\n\n二').characters.map(character => character.glyphIndex), [1, 3]);
});

test('every duration order solves the latest local entrance without shortening its final frame', () => {
  const marks = { spans: [{ start: 0, end: 1, style: { entranceTime: .65 } }, { start: 2, end: 3, style: { speed: .5 } }, { start: 3, end: 4, style: { entrance: 'none' as const } }], pauses: [{ at: 1, seconds: .2 }, { at: 4, seconds: .1 }] };
  for (const order of textOrders) {
    const style: TextPresentationStyle = { speed: 'duration', duration: 2, entrance: 'fade', entranceTime: .15, entranceAnimation: { order } };
    const plan = textRevealPlan(style, '一二三四', 35, marks);
    assert.ok(Math.abs(plan.seconds - 2) < 1e-8, order);
    assert.equal(plan.extended, false);
    assert.ok(plan.starts.every((start, index) => start + plan.entranceTimes[index] <= plan.seconds + 1e-8), order);
    const slower = textRevealPlan({ ...style, speed: 'cps', cps: plan.cps * .95 }, '一二三四', 35, marks);
    assert.ok(slower.seconds > 2, `${order} should use all available display time`);
    assert.ok(plan.entranceTimes.every(time => time <= .85));
  }
  const leading = { pauses: [{ at: 0, seconds: 1.5 }] };
  for (const order of textOrders) {
    const plan = textRevealPlan({ speed: 'duration', duration: 1, entrance: 'drop', entranceTime: .25, entranceAnimation: { order } }, '一二三四', 35, leading);
    assert.ok(Math.abs(plan.seconds - 2.5) < 1e-8, `conflicting leading pause / ${order}`);
  }
});

test('random ordering is repeatable with native pause-glyph indexes and single precision', () => {
  const native = textCharacterMarks('一\n二三', { pauses: [{ at: 1, seconds: .2 }, { at: 2, seconds: .3 }, { at: 4, seconds: .5 }] });
  assert.deepEqual(native.characters.map(character => character.glyphIndex), [0, 3, 4]);
  assert.equal(native.characters[1].pause, .5);
  assert.equal(native.trailing, .5);
  const style = { speed: 'cps', cps: 10, entrance: 'fade', entranceTime: .2, entranceAnimation: { order: 'random' } } as const;
  const plan = textRevealPlan(style, '一\n二三', 35, { pauses: [{ at: 1, seconds: .2 }, { at: 2, seconds: .3 }] });
  assert.ok(Math.abs(plan.starts[1] - orderPosition('random', 0, 3) * plan.times[2]) < 1e-8);
  for (const index of [0, 1, 2, 17, 1024, 4092, 8190]) {
    const first = Math.fround(Math.fround(Math.fround(index % 4093) * 109) + 37) % 4093;
    const single = Math.fround(Math.fround(first * first) + 17) % 4093 / 4093;
    assert.equal(orderPosition('random', 0, index), single);
  }
});

test('out-of-range and overlapping data is fitted, not fatal', () => {
  assert.deepEqual(normalizeTextMarks('一二', { spans: [{ start: 0, end: 9, style: { color: '#ff0000' } }, { start: 1, end: 2, style: { bold: true } }], pauses: [{ at: 9, seconds: 1 }] }), {
    spans: [{ start: 0, end: 1, style: { color: '#ff0000' } }, { start: 1, end: 2, style: { bold: true } }], pauses: [],
  });
  assert.throws(() => projectSchema.parse(project([{ textSpans: [{ start: 2, end: 2, style: {} }] }])));
  assert.throws(() => projectSchema.parse(project([{ textPauses: [{ at: 0, seconds: 0 }] }])));
});

test('text mode writes and reads marks, and brackets in the words stay words', () => {
  const textSpans = [{ start: 1, end: 3, style: { color: '#ff0000', sizeScale: 1.3, bold: true as const, loop: 'shake' as const, loopStrength: 2 } }, { start: 4, end: 5, style: { speed: .5 } }];
  const p = project([{ speakerId: 'hero', text: '我不想死，\n真的', textSpans, textPauses: [{ at: 3, seconds: 1 }, { at: 8, seconds: .5 }] }, { text: '〖书名｜无效〗不是标记。' }, { text: '普通。' }]);
  const source = projectToText(p);
  assert.ok(source.includes('主角：我〖不想｜颜色=#ff0000，大小=130，粗体，持续效果=抖动，幅度=2〗〖停顿=1〗死〖，｜速度=0.5〗'));
  assert.ok(source.includes('@续行：真的〖停顿=0.5〗'));
  assert.ok(source.includes('旁白：〖〖书名｜无效〗不是标记。'));
  const parsed = applyTextScript(p, source);
  assert.deepEqual(parsed.issues.filter(issue => issue.severity === 'error'), []);
  const [first, second, third] = passageLines(parsed.project);
  assert.equal(first.text, '我不想死，\n真的');
  assert.deepEqual(first.textSpans, textSpans);
  assert.deepEqual(first.textPauses, [{ at: 3, seconds: 1 }, { at: 8, seconds: .5 }]);
  assert.equal(second.text, '〖书名｜无效〗不是标记。');
  assert.equal(second.textSpans, undefined);
  assert.equal(third.textSpans, undefined);
  assert.equal(projectToText(parsed.project), source);
});

test('typed marks accept short words and report mistakes in place', () => {
  const p = project([{}]);
  const source = projectToText(p).replace('我不想死。', '我〖不想死｜抖动，粗体，慢，#ff0000〗〖停顿=1秒〗。');
  const parsed = applyTextScript(p, source);
  assert.deepEqual(parsed.issues.filter(issue => issue.severity === 'error'), []);
  const line = passageLines(parsed.project)[0];
  assert.equal(line.text, '我不想死。');
  assert.deepEqual(line.textSpans, [{ start: 1, end: 4, style: { color: '#ff0000', bold: true, speed: .5, loop: 'shake' } }]);
  assert.deepEqual(line.textPauses, [{ at: 4, seconds: 1 }]);
  const bad = applyTextScript(p, projectToText(p).replace('我不想死。', '我〖不想死｜飞走〗。'));
  assert.ok(bad.issues.some(issue => issue.severity === 'warning' && issue.message.includes('飞走')));
  assert.deepEqual(bad.issues.filter(issue => issue.severity === 'error'), []);
  assert.equal(passageLines(bad.project)[0].text, '我〖不想死｜飞走〗。');
  assert.throws(() => parseTextMarkup('〖停顿=0〗'));
  // Unfinished or unmatched brackets are ordinary words.
  assert.equal(parseTextMarkup('〖不想死').text, '〖不想死');
  assert.equal(parseTextMarkup('不想死〗').text, '不想死〗');
});

test('panel edits rewrite the dialogue row and keep its speaker and other lines', () => {
  const p = project([{ speakerId: 'hero' }, { text: '第二句\n两行' }]);
  const source = projectToText(p);
  const parsed = applyTextScript(p, source);
  const after = structuredClone(parsed.project);
  passageLines(after)[0].textSpans = [{ start: 1, end: 4, style: { color: '#ff0000' } }];
  passageLines(after)[1].textPauses = [{ at: 4, seconds: 1 }];
  const patched = patchStageSource(parsed.project, after, source, parsed.sourceMap, parsed.nodeLocations);
  assert.ok(patched.includes('主角：我〖不想死｜颜色=#ff0000〗。'));
  assert.ok(patched.includes('旁白：第二句\n@续行：〖停顿=1〗两行'));
  assert.equal(patched.match(/第二句/g)?.length, 1);
  const again = applyTextScript(after, patched);
  assert.deepEqual(passageLines(again.project).map(line => [line.text, line.textSpans, line.textPauses]), passageLines(after).map(line => [line.text, line.textSpans, line.textPauses]));
});

test('compiled projects carry marks and warn about a missing span font', () => {
  const p = project([{ textSpans: [{ start: 1, end: 3, style: { loop: 'wave', fontAssetId: 'gone' } }], textPauses: [{ at: 3, seconds: 1 }] }]);
  const built = compileProject(p);
  assert.deepEqual(built.diagnostics.filter(d => d.severity === 'error'), []);
  const story = built.files['game/story.rpy'];
  assert.ok(story.includes('{vn_fx=-|wave@5@2}不想{/vn_fx}{cps=1}{space=0}{/cps}死'));
  assert.equal(story.split('{vn_fx=').length - 1, 2);
  assert.ok(Object.values(built.files).join('\n').includes('config.custom_text_tags["vn_fx"]'));
  assert.ok(validateProject(p).some(d => d.severity === 'warning' && d.lineId === 'line_0' && d.message.includes('字体')));
});

test('part-line entrances replace the line entrance and keep the timing exact', () => {
  const line = { spans: [{ start: 1, end: 2, style: { entrance: 'slam' as const, entranceTime: .5 } }, { start: 2, end: 3, style: { entrance: 'none' as const } }] };
  const plan = textRevealPlan({ speed: 'cps', cps: 10, entrance: 'fade', entranceTime: .2 }, '一二三', 35, line);
  assert.deepEqual(plan.animations.map(item => item && [item.scale, item.opacity]), [[1, 0], [2.5, 0], undefined]);
  assert.deepEqual(plan.entranceTimes, [.2, .5, 0]);
  // The second character starts at .2 and has .5 seconds, which outlasts the last character's .3.
  assert.equal(plan.seconds, .7);
  const style = { speed: 'cps', cps: 10, entrance: 'fade', entranceTime: .2 } as const;
  assert.match(textCharacterFrame(style, plan, 1, .45, 1).transform!, /^scale/);
  assert.deepEqual(textCharacterFrame(style, plan, 2, .31, 1), { opacity: 1 });
  // A plain line can also gain an entrance on a few words only.
  assert.deepEqual(textRevealPlan({ speed: 'cps', cps: 10 }, '一二', 35, { spans: [{ start: 1, end: 2, style: { entrance: 'drop' } }] }).entranceTimes, [0, defaultEntranceTime.drop]);
  // With a whole-line duration, the last character's own entrance still ends on time.
  const timed = textRevealPlan({ speed: 'duration', duration: 2 }, '一二三', 35, { spans: [{ start: 2, end: 3, style: { entrance: 'fade', entranceTime: .4 } }] });
  assert.ok(Math.abs(timed.times[2] + timed.entranceTimes[2] - 2) < 1e-9);
  assert.equal(textRevealPlan({ speed: 'duration', duration: 1 }, '一', 35, { spans: [{ start: 0, end: 1, style: { entrance: 'fade', entranceTime: 9 } }] }).entranceTimes[0], .5);
  const p = createProject();
  assert.equal(renpyMarkedText(p, '一二三', line, defaults), '一{vn_fx=0,0,2.5,2.5,0,0,0.5,0,0|-}二{/vn_fx}{vn_fx=none|-}三{/vn_fx}');
  assert.equal(renpyMarkedText(p, '一', { spans: [{ start: 0, end: 1, style: { entrance: 'drop', loop: 'none' } }] }, defaults), '{vn_fx=0,-36,1,1,0,0,0.3,1,0|none}一{/vn_fx}');
  // Colour-only parts follow the line's effects without a tag; instant lines drop entrances.
  assert.equal(renpyMarkedText(p, '一', { spans: [{ start: 0, end: 1, style: { color: '#ff0000' } }] }, defaults), '{color=#ff0000}一{/color}');
  assert.equal(compiledDialogueText(p, { text: '一', textPresentation: { speed: 'instant' }, textSpans: [{ start: 0, end: 1, style: { entrance: 'slam' } }] }), '一');
});

test('a time-only span override reaches the game with the inherited full entrance and duration cap', () => {
  const p = createProject();
  const line: StoryLine = { id: 'timed_part', text: '一二三', actions: [], textPresentation: { speed: 'cps', cps: 10, entrance: 'drop', entranceTime: .2, entranceAnimation: { x: 12, order: 'reverse' } }, textSpans: [{ start: 1, end: 2, style: { entranceTime: .8 } }] };
  const plan = textRevealPlan(line.textPresentation, line.text, 35, { spans: line.textSpans });
  assert.deepEqual(plan.entranceTimes, [.2, .8, .2]);
  assert.ok(compiledDialogueText(p, line).includes('{vn_fx=12,-36,1,1,0,0,0.8,1,1|-}二{/vn_fx}'));
  line.textPresentation = { ...line.textPresentation, speed: 'duration', duration: .6 };
  assert.ok(compiledDialogueText(p, line).includes('{vn_fx=12,-36,1,1,0,0,0.3,1,1|-}'));
  const source = projectToText(project([line]));
  assert.deepEqual(passageLines(applyTextScript(p, source).project)[0].textSpans, line.textSpans);
  line.textPresentation = { speed: 'instant' };
  assert.equal(compiledDialogueText(p, line), line.text);
});

test('text mode reads and writes part-line entrances', () => {
  const textSpans = [{ start: 1, end: 3, style: { entrance: 'slam' as const, entranceTime: .3, loop: 'none' as const } }];
  const p = project([{ text: '我不想死。', textSpans }]);
  const source = projectToText(p);
  assert.ok(source.includes('我〖不想｜入场=逐字砸入，入场时间=0.3，持续效果=无〗死。'));
  assert.deepEqual(passageLines(applyTextScript(p, source).project)[0].textSpans, textSpans);
  const typed = applyTextScript(p, projectToText(project([{}])).replace('我不想死。', '我〖不想死｜逐字落下〗。'));
  assert.deepEqual(passageLines(typed.project)[0].textSpans, [{ start: 1, end: 4, style: { entrance: 'drop' } }]);
});

test('typing sound skips punctuation, follows pauses and speed changes, and stays silent when told', () => {
  assert.deepEqual(typeSoundIndexes('一，二 三。四', 1), [0, 2, 4, 6]);
  assert.deepEqual(typeSoundIndexes('一二，三四五', 2), [0, 3, 5]);
  const p = createProject();
  p.assets.push({ id: 'blip', name: '打字', kind: 'audio', path: 'assets\\音效\\blip.ogg' });
  const marks = { spans: [{ start: 1, end: 2, style: { speed: .5 } }], pauses: [{ at: 2, seconds: 1 }] };
  const look = textRuntimeLook(p, { typeSoundId: 'blip', typeSoundEvery: 1, typeSoundVolume: .5 }, '一二三', marks)!;
  assert.deepEqual(look.typeSound, { path: 'assets/音效/blip.ogg', volume: .5, marks: [[0, 1], [0, 3], [1, 4]] });
  const plan = textRevealPlan({ speed: 'cps', cps: 10 }, '一二三', 35, marks);
  assert.deepEqual(typeSoundTimes({ typeSoundId: 'blip', typeSoundEvery: 1 }, '一二三', plan), plan.times);
  assert.deepEqual(typeSoundTimes({ typeSoundId: 'blip', typeSoundVolume: 0 }, '一二三', plan), []);
  assert.equal(textRuntimeLook(p, { typeSoundId: 'blip', typeSoundVolume: 0 }, '一二')!.typeSound, undefined);
  assert.equal(textRuntimeLook(p, { typeSoundId: 'blip', speed: 'instant' }, '一二')!.typeSound, undefined);
  assert.equal(textRuntimeLook(p, { typeSoundId: 'gone' }, '一二')!.typeSound, undefined);
  const missing = project([{ textPresentation: { typeSoundId: 'gone' } }]);
  assert.ok(validateProject(missing).some(d => d.severity === 'warning' && d.message.includes('打字音')));
  // The sound survives text mode.
  const q = project([{ textPresentation: { typeSoundId: 'blip', typeSoundEvery: 3, typeSoundVolume: .5 } }]);
  q.assets.push({ id: 'blip', name: '打字', kind: 'audio', path: 'assets/blip.ogg' });
  const source = projectToText(q);
  assert.ok(source.includes('@文字演出：打字音=打字【blip】，打字音间隔=3，打字音音量=0.5'));
  assert.deepEqual(passageLines(applyTextScript(q, source).project)[0].textPresentation, { typeSoundId: 'blip', typeSoundEvery: 3, typeSoundVolume: .5 });
});

test('the animator adjusts named effects, orders characters and plans exits', () => {
  const style = { speed: 'cps', cps: 10, entrance: 'zoom', entranceTime: .2, entranceAnimation: { rotation: 90, x: 40, order: 'reverse', easing: 'easeOut' } } as const;
  const plan = textRevealPlan(style, '一二三四', 35);
  assert.deepEqual(plan.animations[0], { x: 40, y: 0, scale: 0, flip: false, rotation: 90, opacity: 0, easing: 'easeOut', order: 'reverse' });
  // Reverse: the last character starts first, the first last.
  assert.equal(textCharacterFrame(style, plan, 3, .05, 1).opacity > 0, true);
  assert.equal(textCharacterFrame(style, plan, 0, .05, 1).opacity, 0);
  assert.equal(textCharacterFrame(style, plan, 0, .4, 1).opacity > 0, true);
  const middle = textCharacterFrame(style, plan, 3, .1, 2);
  assert.match(middle.transform!, /translate\(20px, 0px\) rotate\(22\.5deg\) scale\(0\.75\)/);
  // Changing to another effect drops adjustments made to the earlier one.
  assert.equal(mergeTextStyles(style, { entrance: 'fade' }).entranceAnimation, undefined);
  assert.deepEqual(mergeTextStyles(style, { entranceAnimation: { y: 5 } }).entranceAnimation, { rotation: 90, x: 40, order: 'reverse', easing: 'easeOut', y: 5 });
  assert.equal(animationSpec(fullAnimation(entranceAnimations, 'flip', { rotation: 180 }), .25), '0,0,-1,1,3.1416,0,0.25,0,0');
  for (const easing of textEasings) { assert.ok(Math.abs(applyEasing(easing, 0)) < 1e-9, easing); assert.ok(Math.abs(applyEasing(easing, 1) - 1) < 1e-9, easing); }
  assert.deepEqual([orderPosition('center', .5, 0), orderPosition('edges', .5, 0), orderPosition('reverse', .25, 0)], [0, 1, .75]);
  const leaving = textExitPlan({ exit: 'rise', exitTotal: 1, exitTime: .4, exitAnimation: { order: 'reverse' } }, '一二\n三')!;
  assert.deepEqual([leaving.total, leaving.time, leaving.spread, leaving.count, leaving.animation.y], [1, .4, .6, 3, -36]);
  // Reverse exit: the last character goes first and is gone; the first still holds.
  assert.equal(textExitFrame(leaving, 2, .5, 1).opacity, 0);
  assert.deepEqual(textExitFrame(leaving, 0, .1, 1), { opacity: 1 });
  assert.equal(textExitPlan({ exit: 'none' }, '一'), undefined);
  assert.equal(textExitPlan({ exit: 'fade' }, ''), undefined);
  assert.ok(textExitPlan({ exit: 'fade', exitTotal: .1 }, '一')!.time <= .1);
  const p = createProject();
  const look = textRuntimeLook(p, { exit: 'fade', entrance: 'fade' }, '一二')!;
  assert.deepEqual(look.exit, { anim: '0,0,1,1,0,0,0.25,0,0', total: .4, count: 2 });
  assert.deepEqual(look.reveal, [0, 2]);
  const compiled = compileProject(project([{ textPresentation: { exit: 'fade' } }, {}])).files['game/story.rpy'];
  assert.equal(compiled.match(/vn_text_play_exit\(\)/g)?.length, 1);
});

test('text mode keeps every animator setting; text animation uses media commands while multiple keyframes stay complex', () => {
  const look = { entrance: 'drop', entranceTime: .3, entranceAnimation: { x: 10, y: -80, scale: .5, flip: true, rotation: 45, opacity: .5, easing: 'bounce', order: 'random' }, exit: 'zoom', exitTotal: .8, exitTime: .3, exitAnimation: { order: 'center', easing: 'easeIn' } } as const;
  const p = project([{ textPresentation: look }]);
  const source = projectToText(p);
  assert.ok(source.includes('入场=逐字落下，入场时间=0.3，入场横移=10，入场纵移=-80，入场缩放=50，入场翻转=是，入场旋转=45，入场透明度=50，入场曲线=弹跳，入场顺序=随机'));
  assert.ok(source.includes('退场=逐字缩小，退场总时长=0.8，退场时间=0.3，退场曲线=先慢后快，退场顺序=从中间向两边'));
  const parsed = applyTextScript(p, source);
  assert.deepEqual(parsed.issues.filter(issue => issue.severity === 'error'), []);
  assert.deepEqual(passageLines(parsed.project)[0].textPresentation, look);
  assert.equal(projectToText(parsed.project), source);
  const bad = applyTextScript(p, source.replace('入场曲线=弹跳', '入场曲线=乱跳'));
  assert.ok(bad.issues.some(issue => issue.message.includes('入场曲线')));
  const clip = createVisualObject('text');
  assert.ok(isSimpleMediaVisual(clip));
  assert.ok(isSimpleMediaVisual({ ...clip, textMotion: { entrance: 'fade' } }));
  assert.ok(!isSimpleMediaVisual({ ...clip, textMotion: { entrance: 'fade' }, keyframes: [...clip.keyframes, { ...clip.keyframes[0], x: .8, duration: 1 }] }));
  assert.ok(projectSchema.safeParse(project([{ actions: [{ ...clip, textMotion: { speed: 'duration', duration: 1, entrance: 'fade', exit: 'zoom' } }] }])).success);
  assert.ok(projectSchema.safeParse(project([{ textPresentation: { entranceAnimation: { opacity: 2 } } }])).success === false);
});
