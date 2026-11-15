import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, projectSchema, type Project, type StoryLine, type TextSpanStyle } from '../src/core/model';
import { applySpanStyle, dialogueMarkupRows, lineMarkupSyntax, normalizeTextMarks, parseTextMarkup, plainTextMarkupRange, quotedTextMarkupDeclaration, readMarkedRow, spanMarkupText } from '../src/core/text-spans';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { patchStageSource, stageEditedProject } from '../src/core/stage-edit';
import { dialogueRows, exportText, previewDialogueRevision, readDialogueRevision } from '../src/core/text-exchange';
import { editTextDocument, refreshTextReferenceNames, sourceTextOffset, textDocument } from '../src/core/text-document';
import { textReferenceSpans } from '../src/core/text-references';
import { textLineColor } from '../src/core/text-colors';
import { textAssistance } from '../src/core/text-completion';
import { compiledDialogueText } from '../src/core/text-presentation';

const red = { color: '#ff0000' };
const lines = (project: Project) => project.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []);
function fixture(entries: Partial<StoryLine>[]) {
  const project = createProject('字面括号样式');
  project.characters = [{ id: 'hero', name: '主角', color: '#ffffff', expressions: [] }];
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines = entries.map((line, index) => ({ id: `quoted_line_${index}`, text: '', actions: [], ...line }));
  return project;
}
function roundtrip(project: Project) {
  const source = projectToText(project), parsed = applyTextScript(project, source);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(lines(parsed.project).map(line => [line.id, line.speakerId, line.text, line.textSpans, line.textPauses]), lines(project).map(line => [line.id, line.speakerId, line.text, line.textSpans, line.textPauses]));
  assert.equal(projectToText(parsed.project), source);
  return parsed;
}

test('literal delimiters keep whole-line and delimiter-only styles through script roundtrips', () => {
  const text = '甲〖乙〗丙';
  const project = fixture([
    { text, textSpans: [{ start: 0, end: 5, style: red }] },
    { text, textSpans: [{ start: 1, end: 2, style: red }, { start: 3, end: 4, style: { bold: true } }] },
  ]);
  const parsed = roundtrip(project);
  assert.equal(projectToText(project).split(quotedTextMarkupDeclaration).length - 1, 2);
  assert.equal(compiledDialogueText(parsed.project, lines(parsed.project)[0]), '{color=#ff0000}甲〖乙〗丙{/color}');
  assert.equal(compiledDialogueText(parsed.project, lines(parsed.project)[1]), '甲{color=#ff0000}〖{/color}乙{b}〗{/b}丙');
});

test('quoted parts preserve adjacent styles, astral characters, newlines and pause boundaries', () => {
  const text = '😀〖𠮷〗\n乙\\"|｜尾';
  let spans = applySpanStyle(text, undefined, 0, Array.from(text).length, red);
  spans = applySpanStyle(text, spans, 2, 4, { bold: true, speed: .5 });
  spans = applySpanStyle(text, spans, 5, 9, { italic: true });
  const project = fixture([{ speakerId: 'hero', text, textSpans: spans, textPauses: [{ at: 1, seconds: .25 }, { at: 4, seconds: .5 }, { at: 5, seconds: .75 }, { at: Array.from(text).length, seconds: 1 }] }]);
  const parsed = roundtrip(project);
  assert.equal(lines(parsed.project)[0].text, text);
  assert.deepEqual(normalizeTextMarks(text, { spans, pauses: lines(project)[0].textPauses }), { spans: lines(parsed.project)[0].textSpans, pauses: lines(parsed.project)[0].textPauses });
  assert.match(projectToText(project), /\\n/);
});

test('quoted literals preserve unstyled whitespace, carriage returns and empty leading continuations', () => {
  for (const text of [' 〖甲〗 \n\n 乙\r\n 尾 ', '\n\n〖甲〗\n', '\t〖甲〗\r']) {
    const bracket = Array.from(text).indexOf('〖');
    const project = fixture([{ text, textSpans: [{ start: bracket, end: bracket + 1, style: red }] }]);
    const parsed = roundtrip(project), source = projectToText(project);
    assert.equal(readDialogueRevision(source).entries[0].text, text);
    assert.equal(lines(parsed.project)[0].text, text);
    if (text.startsWith('\n')) assert.ok(source.includes('旁白：〖""〗\n@续行：〖""〗'));
  }
  assert.deepEqual(parseTextMarkup('〖" 甲\\r\\n〗〖乙 "〗', 'quoted'), { text: ' 甲\r\n〗〖乙 ', spans: [], pauses: [] });
  assert.equal(parseTextMarkup('〖" 甲\\r\\n〗〖乙 "〗').text, '〖" 甲\\r\\n〗〖乙 "〗');
  const source = `${quotedTextMarkupDeclaration}\n旁白：${spanMarkupText('〖甲〗', '粗体', 'quoted')}\n@续行：\n@续行：${spanMarkupText('乙', '斜体', 'quoted')}`;
  const parsed = applyTextScript(createProject(), source);
  assert.deepEqual(parsed.issues, []);
  assert.equal(lines(parsed.project)[0].text, '〖甲〗\n\n乙');
  assert.deepEqual(lines(parsed.project)[0].textSpans, [{ start: 0, end: 3, style: { bold: true } }, { start: 5, end: 6, style: { italic: true } }]);
  assert.equal(parsed.sourceMap.find(location => location.sourceLine === 3)?.markupSyntax, 'quoted');
  assert.equal(parsed.sourceMap.find(location => location.sourceLine === 4)?.markupSyntax, 'quoted');
  assert.equal(readDialogueRevision(source).entries[0].text, '〖甲〗\n\n乙');
  const plain = fixture([{ text: '  原文\r\n 尾 ' }]);
  assert.equal(lineMarkupSyntax(plain, lines(plain)[0]), 'quoted');
  roundtrip(plain);
  const marked = fixture([{ text: ' 〖甲〗 ', textSpans: [{ start: 1, end: 2, style: red }] }]);
  const cleared = stageEditedProject(marked, draft => { delete lines(draft)[0].textSpans; });
  assert.ok(cleared);
  assert.equal(lines(cleared.project)[0].text, ' 〖甲〗 ');
  assert.equal(lines(cleared.project)[0].textSpans, undefined);
});

test('all styled parts opt into quoted words while plain lookalike markup remains literal', () => {
  const text = '〖"看似标记"｜粗体〗\\n〗〗😀';
  const project = fixture([{ text, textSpans: [{ start: 0, end: 1, style: red }, { start: 1, end: 7, style: { italic: true } }] }]);
  const parsed = roundtrip(project);
  const rows = dialogueMarkupRows(project, lines(project)[0], '旁白：');
  assert.match(rows[1], /〖"\\"看似标记\\""｜斜体〗/);
  assert.equal(lines(parsed.project)[0].text, text);
  const ordinary = fixture([{ text: '〖"看似标记"｜飞走〗、〖停顿=1〗和\\n。' }]);
  assert.equal(lineMarkupSyntax(ordinary, lines(ordinary)[0]), 'legacy');
  roundtrip(ordinary);
});

test('old quoted-looking words, backslashes, doubled closing delimiters and aliases retain old meanings', () => {
  const row = '〖"旧\\n原文"|粗体〗〗〗〖〖停顿=1〗';
  const parsed = readMarkedRow(createProject(), row);
  assert.equal(parsed.text, '"旧\\n原文"〗〗〖停顿=1〗');
  assert.deepEqual(parsed.spans, [{ start: 0, end: 7, style: { bold: true } }]);
  const old = fixture([{ text: '普通\\n〗〗', textSpans: [{ start: 0, end: 2, style: red }] }]);
  const rows = dialogueMarkupRows(old, lines(old)[0], '旁白：');
  assert.deepEqual(rows, ['旁白：〖普通｜颜色=#ff0000〗\\n〗〗']);
  roundtrip(old);
  assert.equal(parseTextMarkup('未闭合〖原文').text, '未闭合〖原文');
});

test('special font names use quoted values without changing names or stable font references', () => {
  for (const name of ['字体，A,B=等号＝;；', '字体〖名〗|｜', '字体"引号"\\路径', '字体\n换行', '字体【正文】']) {
    const project = fixture([{ text: '甲〖乙〗丙', textSpans: [{ start: 0, end: 5, style: { ...red, fontAssetId: 'special_font' } }] }]);
    project.assets = [{ id: 'special_font', name, kind: 'font', path: 'assets/font.otf' }];
    const parsed = roundtrip(project);
    const source = projectToText(project), document = textDocument(source, parsed.sourceMap);
    assert.equal(refreshTextReferenceNames(parsed.project, source), source);
    assert.ok(document.text.includes(JSON.stringify(name + '【special_font】')));
    assert.deepEqual(textReferenceSpans(document.text.split('\n').find(row => row.startsWith('旁白：'))!), []);
  }
  const simple = fixture([{ text: '普通', textSpans: [{ start: 0, end: 2, style: { fontAssetId: 'special_font' } }] }]);
  simple.assets = [{ id: 'special_font', name: '字体，名', kind: 'font', path: 'assets/font.otf' }];
  assert.equal(lineMarkupSyntax(simple, lines(simple)[0]), 'quoted');
  roundtrip(simple);
});

test('one declaration applies to its own dialogue and contiguous continuations, never later dialogue', () => {
  const source = `${quotedTextMarkupDeclaration}\n旁白：${spanMarkupText('〖😀〗', '粗体', 'quoted')}\n@续行：${spanMarkupText('第二行', '斜体', 'quoted')}\n主角：〖"旧\\n"｜粗体〗`;
  const parsed = applyTextScript(createProject(), source);
  assert.deepEqual(parsed.issues, []);
  assert.equal(lines(parsed.project)[0].text, '〖😀〗\n第二行');
  assert.equal(lines(parsed.project)[1].text, '"旧\\n"');
  assert.equal(parsed.sourceMap.find(location => location.sourceLine === 2)?.markupSyntax, 'quoted');
  assert.equal(parsed.sourceMap.find(location => location.sourceLine === 3)?.markupSyntax, 'quoted');
  assert.equal(parsed.sourceMap.find(location => location.sourceLine === 4)?.markupSyntax, undefined);
  assert.ok(parsed.sourceMap.every(location => location.sourceLine !== 1));
});

test('blank, command, comment and section boundaries cancel declarations before another line', () => {
  const legacy = '〖"旧\\n"｜粗体〗';
  for (const boundary of ['', '// 注释', '; 注释', '@等待：0.1', '# 段落：后段', '---']) {
    const parsed = applyTextScript(createProject(), `${quotedTextMarkupDeclaration}\n${boundary}\n旁白：${legacy}`);
    assert.ok(parsed.issues.some(issue => issue.severity === 'error' && issue.message.includes('局部文字语法')));
    assert.equal(lines(parsed.project).at(-1)!.text, '"旧\\n"', boundary);
  }
  for (const source of [quotedTextMarkupDeclaration, '@局部文字语法：未知\n旁白：' + legacy, quotedTextMarkupDeclaration + '\n@对白标记：无效\n旁白：' + legacy]) {
    const parsed = applyTextScript(createProject(), source);
    assert.ok(parsed.issues.some(issue => issue.severity === 'error'));
    if (source.includes(legacy)) assert.equal(lines(parsed.project).at(-1)!.text, '"旧\\n"');
  }
  const empty = applyTextScript(createProject(), `${quotedTextMarkupDeclaration}\n旁白：\n@续行：${legacy}`);
  assert.deepEqual(empty.issues, []);
  assert.equal(lines(empty.project)[0].text, '\n"旧\\n"');
  assert.equal(readDialogueRevision(`${quotedTextMarkupDeclaration}\n旁白：\n@续行：${legacy}`).entries[0].text, '\n' + legacy);
});

test('malformed quoted syntax preserves the whole draft row and blocks style-free acceptance', () => {
  for (const row of ['〖"未闭合｜粗体〗', '〖"\\q"｜粗体〗', '〖"甲"粗体〗', '〖"甲"｜粗体', '〖"甲"｜飞走〗', '〖"甲"｜〗', '〖未加引号｜粗体〗', '〖"甲"｜颜色="#ff0000"多余〗', '〖停顿=0〗']) {
    const source = `${quotedTextMarkupDeclaration}\n旁白：${row}\n主角：〖"旧\\n"｜粗体〗`;
    const parsed = applyTextScript(createProject(), source);
    assert.ok(parsed.issues.some(issue => issue.severity === 'error' && issue.sourceLine === 2), row);
    assert.equal(lines(parsed.project)[0].text, row);
    assert.equal(parsed.project.scriptText!.content, source);
    assert.equal(lines(parsed.project)[1].text, '"旧\\n"');
  }
});

test('property edits add and remove declarations through the shared writer without moving actions', () => {
  const project = fixture([{ speakerId: 'hero', text: '甲〖乙〗丙', actions: [{ kind: 'pause', seconds: .1 }] }, { text: '下一句' }]);
  const source = projectToText(project), before = applyTextScript(project, source), after = structuredClone(before.project);
  lines(after)[0].textSpans = [{ start: 0, end: 5, style: red }];
  const patched = patchStageSource(before.project, after, source, before.sourceMap, before.nodeLocations);
  assert.ok(patched.includes(quotedTextMarkupDeclaration + '\n主角：'));
  const parsed = applyTextScript(after, patched);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(lines(parsed.project)[0].textSpans, lines(after)[0].textSpans);
  assert.deepEqual(lines(parsed.project).map(line => line.actions), lines(project).map(line => line.actions));
  const cleared = structuredClone(parsed.project); delete lines(cleared)[0].textSpans;
  const cleanSource = patchStageSource(parsed.project, cleared, patched, parsed.sourceMap, parsed.nodeLocations);
  assert.ok(!cleanSource.includes(quotedTextMarkupDeclaration));
  assert.deepEqual(lines(applyTextScript(cleared, cleanSource).project).map(line => [line.text, line.textSpans]), lines(cleared).map(line => [line.text, line.textSpans]));
  const committed = stageEditedProject(project, draft => { lines(draft)[0].textSpans = [{ start: 1, end: 2, style: red }]; });
  assert.ok(committed);
  assert.deepEqual(lines(committed.project)[0].textSpans, [{ start: 1, end: 2, style: red }]);
});

test('visible document edits keep declaration, hidden identity, new markup and continuation navigation', () => {
  const project = fixture([{ text: '〖甲〗\n未设样式', textSpans: [{ start: 0, end: 3, style: red }] }]);
  const source = projectToText(project), parsed = applyTextScript(project, source), document = textDocument(source, parsed.sourceMap);
  const start = document.text.indexOf('未设样式');
  const next = editTextDocument(document, { start, end: start + 4, text: spanMarkupText('改写😀', '斜体', 'quoted') });
  const after = applyTextScript(project, next);
  assert.deepEqual(after.issues, []);
  assert.equal(lines(after.project)[0].id, lines(project)[0].id);
  assert.equal(lines(after.project)[0].text, '〖甲〗\n改写😀');
  assert.deepEqual(lines(after.project)[0].textSpans, [{ start: 0, end: 3, style: red }, { start: 4, end: 7, style: { italic: true } }]);
  const nextDocument = textDocument(next, after.sourceMap), continuationStart = nextDocument.text.indexOf('@续行：');
  const sourceLine = next.slice(0, sourceTextOffset(nextDocument, continuationStart)).split('\n').length;
  assert.equal(after.sourceMap.find(location => location.sourceLine === sourceLine)?.markupSyntax, 'quoted');
  assert.deepEqual(textLineColor(quotedTextMarkupDeclaration), { kind: 'command' });
  assert.equal(textLineColor('旁白：〖"甲"｜粗体〗').kind, 'speaker');
  assert.equal(textAssistance(project, quotedTextMarkupDeclaration, quotedTextMarkupDeclaration.length)?.signature?.name, '局部文字语法');
  assert.equal(textAssistance(project, '旁白：〖"甲"｜粗体〗', 10), undefined);
});

test('source context marking accepts plain words and mark boundaries while rejecting nested marks and escapes', () => {
  const row = '普通' + spanMarkupText('〖甲\\"〗', '字体="字体〖名〗|｜【font_test】"，粗体', 'quoted') + '尾字';
  const inside = row.indexOf('甲'), tail = row.indexOf('尾字');
  assert.equal(plainTextMarkupRange(row, 0, 2, 'quoted'), true);
  assert.equal(plainTextMarkupRange(row, inside, inside + 1, 'quoted'), false);
  assert.equal(plainTextMarkupRange(row, inside, inside, 'quoted'), false);
  assert.equal(plainTextMarkupRange(row, tail, tail + 2, 'quoted'), true);
  assert.equal(plainTextMarkupRange(row, 2, 2, 'quoted'), true);
  assert.equal(plainTextMarkupRange(row, tail, tail, 'quoted'), true);
  const literal = '〖" 原文〗 "〗直接编辑';
  assert.equal(plainTextMarkupRange(literal, literal.indexOf('原文'), literal.indexOf('原文') + 2, 'quoted'), false);
  assert.equal(plainTextMarkupRange(literal, literal.indexOf('直接'), literal.length, 'quoted'), true);
  assert.equal(plainTextMarkupRange('〖旧文字｜粗体〗直接编辑', 1, 3), false);
  assert.equal(plainTextMarkupRange('〖〖直接编辑', 2, 6, 'quoted'), true);
  assert.equal(plainTextMarkupRange('普通〖"未闭合', 5, 6, 'quoted'), false);
});

test('quoted dialogue keeps syntax prefix before words when editing voice, whole-line look and actions', () => {
  const base = fixture([{ speakerId: 'hero', text: '甲〖乙〗丙', textSpans: [{ start: 0, end: 5, style: red }] }, { text: '下一句' }]);
  base.assets.push({ id: 'voice_new', name: '新配音', kind: 'audio', path: 'assets/voice.ogg' });
  const source = projectToText(base).replace(quotedTextMarkupDeclaration, '// 保留注释\n' + quotedTextMarkupDeclaration);
  base.scriptText = { format: 'vns-text-1', content: source };
  const edits: ((line: StoryLine) => void)[] = [
    line => { line.textPresentation = { color: '#334455' }; },
    line => { line.voiceId = 'voice_new'; },
    line => { line.actions = [{ kind: 'pause', seconds: .25 }]; },
    line => { line.textSpans = [{ start: 1, end: 2, style: { bold: true } }]; line.textPresentation = { color: '#334455' }; line.voiceId = 'voice_new'; line.actions = [{ kind: 'pause', seconds: .25 }]; },
  ];
  for (const edit of edits) {
    const changed = stageEditedProject(base, draft => edit(lines(draft)[0]));
    assert.ok(changed);
    assert.ok(changed.source.includes('// 保留注释'));
    assert.ok(changed.source.includes(quotedTextMarkupDeclaration + '\n主角：'));
    assert.equal(changed.source.split(quotedTextMarkupDeclaration).length - 1, 1);
    assert.equal(lines(changed.project)[0].text, lines(base)[0].text);
    const removed = stageEditedProject(changed.project, draft => { lines(draft)[0].actions = []; delete lines(draft)[0].voiceId; delete lines(draft)[0].textPresentation; });
    assert.ok(removed);
    assert.ok(removed.source.includes(quotedTextMarkupDeclaration + '\n主角：'));
    assert.deepEqual(lines(removed.project)[0].actions, []);
  }
  const separated = `${quotedTextMarkupDeclaration}\n\n旁白：普通`;
  const parsed = applyTextScript(createProject(), separated), after = structuredClone(parsed.project);
  lines(after)[0].textSpans = [{ start: 0, end: 2, style: red }];
  const patched = patchStageSource(parsed.project, after, separated, parsed.sourceMap);
  assert.ok(patched.startsWith(quotedTextMarkupDeclaration + '\n\n'), 'an inactive earlier declaration must not be removed from a different row');
});

test('dialogue revisions retain literal styles, decode quoted full scripts and remove obsolete declarations', () => {
  const project = fixture([{ text: '甲〖乙〗丙', textSpans: [{ start: 1, end: 2, style: red }, { start: 3, end: 4, style: red }] }, { text: '第二句' }]);
  project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
  const full = exportText(project, 'commands');
  assert.equal(readDialogueRevision(full.text).entries[0].text, '甲〖乙〗丙');
  assert.equal(previewDialogueRevision(project, { name: '完整剧本.txt', text: full.text }).changes.length, 0);
  const revised = previewDialogueRevision(project, { name: '修订.txt', text: `@对白标记：${lines(project)[0].id}\n旁白：甲〖乙〗丁` });
  assert.equal(dialogueRows(revised.project)[0].line.text, '甲〖乙〗丁');
  assert.equal(revised.project.scriptText!.content.split(quotedTextMarkupDeclaration).length - 1, 1);
  assert.deepEqual(lines(applyTextScript(revised.project, revised.project.scriptText!.content).project)[0].textSpans, lines(project)[0].textSpans);
  const without = previewDialogueRevision(revised.project, { name: '无括号.txt', text: `@对白标记：${lines(project)[0].id}\n旁白：纯文字` });
  assert.ok(!without.project.scriptText!.content.includes(quotedTextMarkupDeclaration));
  const saved = projectSchema.parse(JSON.parse(JSON.stringify(revised.project)));
  assert.deepEqual(lines(applyTextScript(saved, saved.scriptText!.content).project)[0].textSpans, lines(revised.project)[0].textSpans);
});

test('dialogue revision previews resolve JSON font names from the current project and still validate parameters', () => {
  const project = fixture([{ text: '甲〖乙〗丙', textSpans: [{ start: 0, end: 5, style: { ...red, fontAssetId: 'named_font' } }] }]);
  project.assets = [{ id: 'named_font', name: '字体，名', kind: 'font', path: 'assets/named-font.otf' }];
  project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
  const imported = (words: string, parameters = '字体="字体，名"，粗体') => `@对白标记：${lines(project)[0].id}\n${quotedTextMarkupDeclaration}\n旁白：${spanMarkupText(words, parameters, 'quoted')}`;
  const source = imported('甲〖乙〗丁');
  const accepted = applyTextScript(project, source);
  assert.deepEqual(accepted.issues, []);
  assert.equal(lines(accepted.project)[0].textSpans?.[0].style.fontAssetId, 'named_font');
  assert.equal(readDialogueRevision(source, new Set(), project).entries[0].text, '甲〖乙〗丁');
  const preview = previewDialogueRevision(project, { name: '名称字体修订.txt', text: source });
  assert.equal(preview.changes.length, 1);
  assert.equal(lines(preview.project)[0].text, '甲〖乙〗丁');
  assert.deepEqual(lines(preview.project)[0].textSpans, lines(project)[0].textSpans);
  assert.equal(previewDialogueRevision(project, { name: '名称字体完整剧本.txt', text: imported('甲〖乙〗丙') }).changes.length, 0);
  assert.throws(() => readDialogueRevision(source), /找不到字体素材/);
  assert.throws(() => previewDialogueRevision(project, { name: '坏颜色.txt', text: imported('甲〖乙〗丁', '字体="字体，名"，颜色="#zz0000"') }), /颜色请填写六位颜色/);
  assert.throws(() => previewDialogueRevision(project, { name: '缺失字体.txt', text: imported('甲〖乙〗丁', '字体="不存在，字体"') }), /找不到字体素材/);
});

test('all supported local style fields survive quoted syntax unchanged', () => {
  const style: TextSpanStyle = { color: '#123456', sizeScale: 1.25, bold: true, italic: true, fontAssetId: 'font_test', speed: .5, entrance: 'slam', entranceTime: .3, loop: 'wave', loopStrength: 2, loopSpeed: 1.5 };
  const project = fixture([{ text: '〖😀〗', textSpans: [{ start: 0, end: 3, style }] }]);
  project.assets = [{ id: 'font_test', name: '字体，名', kind: 'font', path: 'assets/font.otf' }];
  roundtrip(project);
});
