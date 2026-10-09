import { chapterBlueprintPair, createChapterPerformance } from '../src/core/chapter-performances';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type Project } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { applyTextDocumentEdit, editTextDocument, sourceTextOffset, textDocument, textEdit, visibleTextLine, visibleTextOffset } from '../src/core/text-document';
import { performanceTextDocument } from '../src/core/text-performance';
import { textChapters } from '../src/core/text-chapters';
import { stageEditedProject } from '../src/core/stage-edit';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { bindPerformanceBlueprint, performanceTargetAt, targetPerformance } from '../src/core/performance-workspace';
import { linePreviewSnapshot } from '../src/core/line-preview';

test('独立演出后的背景定位到下方台词，末句不被自动结束节点遮挡', () => {
  const base = createProject('背景归属');
  base.assets.push({ id: 'courtyard', name: '王家大院 · 夜宴', kind: 'image', path: 'courtyard.png' });
  base.blueprints.push(blueprintFromPerformance(base, [{ kind: 'pause', seconds: .2 }], '章节进入演出'));
  for (const declaration of ['@独立演出：段落 1', '@独立演出']) {
    for (const gap of ['', '\n// 正文背景\n']) {
      const source = `@章节进入演出\n@演出转场：方式=纯色，淡出=0.5，停留=0，淡入=0.5，颜色=#000000\n${declaration}\n${gap}@背景：王家大院 · 夜宴\n旁白：在解州客栈的几个月里，鸢姐姐对我很好。`;
      const parsed = applyTextScript(base, source);
      assert.deepEqual(parsed.issues, []);
      const passages = parsed.project.nodes.filter(node => node.kind === 'passage');
      assert.equal(passages.length, 2);
      const [standalone, dialogue] = passages;
      assert.equal(standalone.lines[0].silent, true);
      assert.equal(standalone.lines[0].actions[0].kind, 'blueprint');
      assert.equal(standalone.lines[0].playback?.transition?.mode, 'color');
      assert.deepEqual(dialogue.lines[0].actions, [{ kind: 'background', assetId: 'courtyard', transition: 'dissolve' }]);
      assert.equal(dialogue.lines[0].playback, undefined);
      assert.equal(standalone.next, dialogue.id);
      const backgroundLine = source.slice(0, source.indexOf('@背景')).split('\n').length;
      assert.equal(parsed.nodeLocations.find(location => location.nodeId === dialogue.id)?.sourceLine, backgroundLine);
      for (const sourceLine of [backgroundLine, backgroundLine + 1]) {
        const target = performanceTargetAt(parsed, sourceLine)!;
        assert.equal(target.nodeId, dialogue.id);
        assert.equal(target.lineId, dialogue.lines[0].id);
        assert.equal(target.graphId, undefined);
        assert.equal(linePreviewSnapshot(parsed.project, { ...target, lineId: target.lineId! }).after.backgroundId, 'courtyard');
      }
      const document = performanceTextDocument(parsed.project, source, true);
      assert.equal(document.text, source.replace('@背景：王家大院 · 夜宴\n', ''));
      const saved = applyTextScript(parsed.project, projectToText(parsed.project));
      assert.deepEqual(saved.issues, []);
      assert.deepEqual(saved.project.nodes, parsed.project.nodes);
      const edited = stageEditedProject(parsed.project, draft => {
        const node = draft.nodes.find(node => node.id === dialogue.id);
        if (node?.kind === 'passage' && node.lines[0].actions[0].kind === 'background') node.lines[0].actions[0].transition = 'none';
      })!;
      assert.ok(edited);
      assert.equal(edited.source, source.replace('@背景：王家大院 · 夜宴', '@背景：王家大院 · 夜宴，转场=无'));
      assert.deepEqual(edited.project.nodes.find(node => node.id === standalone.id), standalone);
    }
  }
});

test('自动生成的故事结束节点不占用最后一条正文的源码定位', () => {
  const parsed = applyTextScript(createProject(), '旁白：最后一句');
  const dialogue = parsed.project.nodes.find(node => node.kind === 'passage')!;
  const ending = parsed.project.nodes.find(node => node.kind === 'end')!;
  assert.equal(parsed.nodeLocations.some(location => location.nodeId === ending.id), false);
  assert.equal(performanceTargetAt(parsed, 1)?.lineId, dialogue.lines[0].id);
  const explicit = applyTextScript(createProject(), '旁白：最后一句\n@返回标题界面');
  assert.equal(performanceTargetAt(explicit, 2), undefined);
  assert.equal(explicit.nodeLocations.find(location => explicit.project.nodes.find(node => node.id === location.nodeId)?.kind === 'end')?.sourceLine, 2);
});

test('在独立演出后的首句前插入背景，隐藏节点标记不能把背景隔成空白行', () => {
  const base = createProject('插入背景');
  base.assets.push({ id: 'courtyard', name: '王家大院 · 夜宴', kind: 'image', path: 'courtyard.png' });
  base.blueprints.push(blueprintFromPerformance(base, [{ kind: 'pause', seconds: .2 }], '章节进入演出'));
  const original = applyTextScript(base, '@章节进入演出\n@演出转场：方式=纯色，淡出=0.5，停留=0，淡入=0.5，颜色=#000000\n@独立演出：段落 1\n旁白：在解州客栈的几个月里，鸢姐姐对我很好。').project;
  const savedSource = projectToText(original);
  const dialogue = original.nodes.find(node => node.kind === 'passage' && !node.lines[0].silent)!;
  assert.equal(dialogue.kind, 'passage');
  const command = '@背景：王家大院 · 夜宴\n';
  for (const hide of [false, true]) {
    const document = performanceTextDocument(original, savedSource, hide);
    const at = document.text.indexOf('旁白：');
    const edit = applyTextDocumentEdit(document, { start: at, end: at, text: command });
    const parsed = applyTextScript(original, edit.source);
    assert.deepEqual(parsed.issues, []);
    assert.equal(parsed.project.nodes.length, original.nodes.length);
    const line: Project['nodes'][number] | undefined = parsed.project.nodes.find(node => node.id === dialogue.id);
    assert.ok(line?.kind === 'passage');
    assert.equal(line.lines[0].id, dialogue.lines[0].id);
    assert.deepEqual(line.lines[0].actions, [{ kind: 'background', assetId: 'courtyard', transition: 'dissolve' }]);
    assert.doesNotMatch(performanceTextDocument(parsed.project, edit.source, true).text, /@背景/);
    assert.equal(edit.sourceOffset(at + command.length), edit.source.indexOf('旁白：'));
    // Documents already edited by an older build have the command before the
    // hidden marker. They must regain the same dialogue ownership on reparse.
    const previouslyEdited = savedSource.slice(0, savedSource.lastIndexOf('@节点标记', savedSource.indexOf('旁白：'))) + command + savedSource.slice(savedSource.lastIndexOf('@节点标记', savedSource.indexOf('旁白：')));
    const repaired = applyTextScript(original, previouslyEdited);
    assert.deepEqual(repaired.issues, []);
    assert.deepEqual(repaired.project.nodes, parsed.project.nodes);
    assert.doesNotMatch(performanceTextDocument(repaired.project, previouslyEdited, true).text, /@背景/);
  }
});

function fixture() {
  const base = createProject('隐藏演出');
  base.assets = [
    { id: 'bg', name: '城门', kind: 'image', path: 'bg.png' },
    { id: 'mask', name: '章节题图', kind: 'image', path: 'mask.png' },
    { id: 'music', name: '入城', kind: 'audio', path: 'music.ogg' },
    { id: 'voice', name: '配音一', kind: 'audio', path: 'voice.ogg' },
  ];
  base.blueprints.push(...chapterBlueprintPair(createChapterPerformance(base, 'text', { kind: 'chapter', title: '城破', subtitle: '第一章', duration: 4.2, backgroundId: 'bg', soundId: 'music', effect: 'ink' })));
  const source = "@入口：章节入场【chapter_intro】\n# 章节：第一章【chapter_one】\n# 小章节：城破【scene_one】\n# 段落：章节入场【chapter_intro】\n@章节进入演出文字版【builtin_chapter_text】：标题=城破，右侧字=第一章，时长=4.2，章节背景=城门【bg】，章节音效=入城【music】\n@独立演出\n@跳转：正文【passage】\n\n# 段落：正文【passage】\n@对白标记：line_one\n@背景：城门【bg】\n@震动：横向\n@配音：配音一【voice】\n旁白：重复台词。\n@对白标记：line_two\n@等待：0.25\n旁白：重复台词。\n@对白标记：line_three\n@镜头：0.1，0.2，1.2，1，15，匀速，否\n旁白：最后一句。\n@跳转：结束【ending】\n# 段落：结束【ending】\n@返回标题界面";
  const initial = applyTextScript(base, source);
  assert.deepEqual(initial.issues, []);
  initial.project.scriptText = { format: 'vns-text-1', content: source };
  const project = initial.project;
  const document = performanceTextDocument(project, source, true);
  const parse = (source: string) => {
    const result = applyTextScript(project, source);
    assert.deepEqual(result.issues, []);
    const node = result.project.nodes.find(node => node.id === 'passage');
    assert.equal(node?.kind, 'passage');
    return node!.kind === 'passage' ? node!.lines : [];
  };
  return { project, source, document, parse, initial };
}

test('隐藏演出是可逆显示投影；保留章节入口、结构、对白和跳转', () => {
  const { project, source, document } = fixture();
  assert.doesNotMatch(document.text, /@背景|@等待|@震动|@配音|@镜头|@章节背景|【|@对白标记/);
  assert.match(document.text, /@章节进入演出文字版：标题=城破，右侧字=第一章，时长=4.2/);
  assert.match(document.text, /@跳转：正文/);
  assert.equal(document.source, source);
  assert.equal(editTextDocument(document, { start: 0, end: 0, text: '' }), source);
  assert.equal(performanceTextDocument(project, document.source, false).text, textDocument(source).text);
  const raw = source.split('\n').findIndex(row => row.startsWith('@震动')) + 1;
  assert.equal(document.text.split('\n')[visibleTextLine(document, raw) - 1], '旁白：重复台词。');
});

test('改写整句台词与重复文本中的插入都保留各句原有演出和身份', () => {
  const { document, parse } = fixture();
  const before = parse(document.source);
  const start = document.text.indexOf('旁白：重复台词。');
  const changed = editTextDocument(document, { start, end: start + '旁白：重复台词。'.length, text: '旁白：改写整句。' });
  assert.deepEqual(parse(changed), [{ ...before[0], text: '改写整句。' }, ...before.slice(1)]);
  const inserted = editTextDocument(document, { start, end: start, text: '旁白：新增。\n' });
  const lines = parse(inserted);
  assert.equal(lines[0].text, '新增。'); assert.deepEqual(lines[0].actions, []);
  assert.deepEqual(lines.slice(1), before);
});

test('章节隐藏演出中连续换行、中文输入和整段恢复不删除未改动对白的绑定', () => {
  const { project, source, parse } = fixture();
  for (const scoped of [false, true]) {
    const build = (raw: string) => performanceTextDocument(project, raw, true, undefined, scoped ? textChapters(raw)[1] : undefined);
    const original = build(source), originalLines = parse(source);
    const at = original.text.indexOf('旁白：重复台词。') + '旁白：重复台词。'.length;
    const newline = applyTextDocumentEdit(original, { start: at, end: at, text: '\n' });
    const afterNewline = build(newline.source);
    const insertion = '旁白：换行后的即时输入验证。';
    const entered = applyTextDocumentEdit(afterNewline, { start: at + 1, end: at + 1, text: insertion });
    const afterInput = build(entered.source);
    const insertedLines = parse(entered.source);
    assert.ok(insertedLines.some(line => line.text === insertion.slice(3)));
    for (const line of originalLines) assert.deepEqual(insertedLines.find(item => item.id === line.id), line);
    // Replacing an editor selection with the previous visible text is also how
    // paste, find/replace and external textarea edits restore a draft.
    const edit = textEdit(afterInput.text, original.text, { start: 0, end: afterInput.text.length });
    const restored = editTextDocument(afterInput, edit);
    assert.deepEqual(parse(restored), originalLines);
  }
});

test('删除有配音与演出的整句时一起移除，不转移给下一句；全选删除不留指令', () => {
  const { document, parse } = fixture();
  const before = parse(document.source);
  const start = document.text.indexOf('旁白：重复台词。');
  const removed = editTextDocument(document, { start, end: start + '旁白：重复台词。\n'.length, text: '' });
  assert.deepEqual(parse(removed), before.slice(1));
  assert.doesNotMatch(removed, /@震动|@配音|@对白标记：line_one/);
  assert.equal(editTextDocument(document, { start: 0, end: document.text.length, text: '' }), '');
});

test('映射新输入的光标、资源引用与正在编辑的指令，回车后可再次隐藏', () => {
  const { project, document, parse } = fixture();
  const at = document.text.indexOf('旁白：最后一句。');
  const inserted = '@等待：1\n';
  const result = applyTextDocumentEdit(document, { start: at, end: at, text: inserted });
  const rawCaret = result.sourceOffset(at + inserted.length);
  const next = performanceTextDocument(project, result.source, true);
  assert.equal(visibleTextOffset(next, rawCaret), next.text.indexOf('旁白：最后一句。'));
  assert.equal(next.text, document.text);
  const rawCommand = result.source.indexOf('@等待：1');
  const row = result.source.slice(0, rawCommand).split('\n').length;
  const editing = performanceTextDocument(project, result.source, true, row);
  assert.match(editing.text, /@等待：1/);
  assert.equal(sourceTextOffset(editing, editing.text.indexOf('@等待：1')), rawCommand);
  assert.deepEqual(parse(result.source).at(-1)!.actions.at(-1), { kind: 'pause', seconds: 1 });
  const rawDialogue = result.source.indexOf('旁白：最后一句。');
  assert.equal(sourceTextOffset(next, next.text.indexOf('旁白：最后一句。')), rawDialogue);
});

test('错误指令与无对白的独立演出保留可选入口，不被错误隐藏', () => {
  const { project, source } = fixture();
  const invalid = source.replace('@等待：0.25', '@等待：不是数字');
  assert.match(performanceTextDocument(project, invalid, true).text, /@等待：不是数字/);
  const standalone = source.replace('旁白：最后一句。', '');
  assert.match(performanceTextDocument(project, standalone, true).text, /@镜头/);
});

test('编辑章节调用末尾时保持光标并保留参数引用', () => {
  const { project, document } = fixture();
  const start = document.text.indexOf('@章节进入演出文字版');
  const end = document.text.indexOf('\n', start);
  const result = applyTextDocumentEdit(document, { start: end, end, text: ' ' });
  const rawCaret = result.sourceOffset(end + 1);
  const rawRow = result.source.slice(0, rawCaret).split('\n').length;
  assert.match(result.source.split('\n')[rawRow - 1], /^@章节进入演出文字版/);
  const after = performanceTextDocument(project, result.source, true, rawRow);
  assert.equal(visibleTextOffset(after, rawCaret), end + 1);
  assert.match(result.source, /城门【bg】/);
});

test('隐藏状态下逐项批量替换不丢失配音、参数或同名对白的 ID', () => {
  const { project, document, parse } = fixture();
  let next = document;
  for (const match of [...document.text.matchAll(/重复台词/g)].reverse()) next = performanceTextDocument(project, editTextDocument(next, { start: match.index!, end: match.index! + 4, text: '批量改写' }), true);
  assert.deepEqual(parse(next.source), parse(document.source).map(line => ({ ...line, text: line.text.replace('重复台词', '批量改写') })));
  const selected = document.text.indexOf('旁白：重复台词。');
  const removed = document.text.slice(0, selected) + document.text.slice(selected + '旁白：重复台词。\n'.length);
  assert.deepEqual(parse(editTextDocument(document, textEdit(document.text, removed, { start: selected, end: selected + '旁白：重复台词。\n'.length }))), parse(document.source).slice(1));
});

test('chapter call edits and encapsulation preserve prose, connections and expanded preview', () => {
  const { project, source, initial } = fixture();
  const row = source.split('\n').findIndex(row => row.startsWith('@章节进入演出文字版')) + 1;
  const target = performanceTargetAt(initial, row)!;
  assert.equal(target.nodeId, 'chapter_intro');
  const changed = stageEditedProject(project, draft => {
    const node = draft.nodes.find(node => node.id === target.nodeId);
    if (node?.kind === 'passage' && node.lines[0].actions[0].kind === 'blueprint') node.lines[0].actions[0].inputs = { ...node.lines[0].actions[0].inputs, duration: 7.5, right_text: '修改副标题' };
  })!;
  assert.ok(changed); assert.match(changed.source, /修改副标题/); assert.match(changed.source, /7.5/);
  assert.equal(changed.source.slice(changed.source.indexOf('# 段落：正文')), source.slice(source.indexOf('# 段落：正文')));
  const actions = targetPerformance(changed.project, target), graph = blueprintFromPerformance(changed.project, actions, '城破章节演出');
  let nextTarget = target;
  const converted = stageEditedProject(changed.project, draft => { nextTarget = bindPerformanceBlueprint(draft, target, graph, '演出 / 章节'); })!;
  assert.ok(converted);
  const node = converted.project.nodes.find(node => node.id === 'chapter_intro');
  assert.equal(node?.kind, 'passage'); assert.equal(node && 'next' in node && node.next, 'passage'); assert.equal(converted.project.entryId, 'chapter_intro');
  assert.doesNotMatch(converted.source, /@章节标题|@章节背景/); assert.match(converted.source, /@城破章节演出/);
  const snapshot = linePreviewSnapshot(converted.project, { nodeId: nextTarget.nodeId, lineId: nextTarget.lineId! });
  const before = linePreviewSnapshot(changed.project, { nodeId: target.nodeId, lineId: target.lineId! });
  assert.deepEqual(snapshot.actions, before.actions); assert.ok(JSON.stringify(snapshot.actions).includes('修改副标题'));
});
