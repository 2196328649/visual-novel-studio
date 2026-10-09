import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { editTextDocument, patchTextDocument, textDocument, textEdit, visibleTextLine, visibleTextOffset, refreshTextReferenceNames } from '../src/core/text-document';
import { performanceTextFolds } from '../src/core/text-performance';

test('a shortened document tolerates a dialogue location from the previous render', () => {
  const before = '# 章节：测试\n@对白标记：line_tail\n\n\n\n旁白：最后一句。';
  const parsed = applyTextScript(createProject(), before);
  const after = '# 章节：测试\n@对白标记：line_tail\n旁白：最后一句。';
  assert.equal(textDocument(after, parsed.sourceMap).text, '# 章节：测试\n旁白：最后一句。');
});

test('a shortened document ignores performance folds outside its remaining lines', () => {
  assert.equal(textDocument('旁白：保留。', [], { performances: [{ sourceLine: 5, targetLine: 1 }] }).text, '旁白：保留。');
});

test('hiding performances after deleting a chapter ignores obsolete dialogue rows', () => {
  const before = '# 章节：测试\n@对白标记：line_tail\n@震动：横向\n旁白：最后一句。';
  const parsed = applyTextScript(createProject(), before);
  assert.deepEqual(performanceTextFolds('# 章节：测试', parsed), []);
  assert.deepEqual(performanceTextFolds('', parsed), []);
});

function fixture() {
  const project = createProject('隐藏对白编号');
  project.assets.push({ id: 'voice', name: '问候', kind: 'audio', path: 'assets/voice.ogg' });
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines = [
    { id: 'line_first', text: '第一句。', voiceId: 'voice', actions: [{ kind: 'shake', direction: 'horizontal' }] },
    { id: 'line_middle', text: '相同的对白。', actions: [] },
    { id: 'line_last', text: '相同的对白。', actions: [] },
  ];
  const source = projectToText(project);
  const document = textDocument(source, applyTextScript(project, source).sourceMap);
  const parse = (source: string) => {
    const result = applyTextScript(project, source);
    assert.deepEqual(result.issues.filter(issue => issue.severity === 'error'), []);
    const node = result.project.nodes.find(node => node.id === passage.id)!;
    assert.equal(node.kind, 'passage');
    return node.kind === 'passage' ? node.lines : [];
  };
  return { project, source, document, lines: passage.lines, parse };
}

test('正文和预览行号跳过内部编号，保留演出、配音与原始工程文本', () => {
  const { project, source, document } = fixture();
  assert.ok(source.includes('@对白标记：line_first'));
  assert.ok(!document.text.includes('@对白标记'));
  assert.ok(document.text.includes('@配音：问候'));
  assert.ok(document.text.includes('@震动：横向'));
  for (const location of applyTextScript(project, source).sourceMap) {
    assert.equal(document.text.split('\n')[visibleTextLine(document, location.sourceLine) - 1], textDocument(source.split('\n')[location.sourceLine - 1]).text);
  }
  assert.equal(editTextDocument(document, { start: 0, end: 0, text: '' }), source);
});

test('只隐藏结构与指令中的引用编号，保留对白、选项、标题和参数中的括号文字', () => {
  const source = [
    '# 小章节：夜宴【scene_night】',
    '@背景音乐：夜曲【music_night】 循环',
    '@显示角色：苏怜烟【su】，通常【normal】，0.5，1',
    '@选项：保留【literal】 -> 夜宴【passage_night】',
    '@章节标题：保留【literal】｜第一章｜2',
    '@选择：保留【literal】',
    '旁白：保留【literal】',
    '@跳转：目标="夜宴【passage_night】"，备注="【literal】"',
    '@演出实例：夜宴 第1行【line_night】 使用【txt_performance_night】',
    '@效果定义：推镜【effect_push】',
    '@动作：背景：夜宴【asset_night】',
    '@效果结束',
  ].join('\n');
  const document = textDocument(source);
  assert.equal(document.text, [
    '# 小章节：夜宴', '@背景音乐：夜曲 循环', '@显示角色：苏怜烟，通常，0.5，1',
    '@选项：保留【literal】 -> 夜宴', '@章节标题：保留【literal】｜第一章｜2', '@选择：保留【literal】', '旁白：保留【literal】',
    '@跳转：目标="夜宴"，备注="【literal】"', '@演出实例：夜宴 第1行', '@效果定义：推镜', '@动作：背景：夜宴', '@效果结束',
  ].join('\n'));
  assert.equal(editTextDocument(document, { start: document.text.length, end: document.text.length, text: '\n旁白：新增。' }), source + '\n旁白：新增。');
  assert.equal(visibleTextOffset(document, source.indexOf(' 循环')), document.text.indexOf(' 循环'));
});

test('重命名段落时保留隐藏编号与所有已有连接', () => {
  const { project, document } = fixture();
  const node = project.nodes.find(node => node.kind === 'passage')!;
  const start = document.text.indexOf(`# 段落：${node.name}`) + '# 段落：'.length;
  const edited = editTextDocument(document, { start, end: start + node.name.length, text: '改名后的段落' });
  assert.ok(edited.includes(`# 段落：改名后的段落【${node.id}】`));
  const result = applyTextScript(project, edited);
  assert.deepEqual(result.issues, []);
  assert.equal(result.project.nodes.find(item => item.id === node.id)?.name, '改名后的段落');
  assert.equal(result.project.nodes.find(item => item.kind === 'start')?.next, node.id);
  const refreshed = refreshTextReferenceNames(result.project, edited);
  assert.ok(textDocument(refreshed).text.includes('@跳转：改名后的段落'));
  assert.deepEqual(applyTextScript(result.project, refreshed).project.nodes, result.project.nodes);
});

test('清空章节名称后重新输入，仍保留章节身份与下属小章节', () => {
  const project = createProject('章节改名'), chapter = project.chapters[0];
  let document = textDocument(projectToText(project));
  const start = document.text.indexOf('# 章节：') + '# 章节：'.length;
  document = textDocument(editTextDocument(document, { start, end: start + chapter.name.length, text: '' }));
  assert.ok(document.source.includes(`【${chapter.id}】`));
  assert.ok(!document.text.includes(`【${chapter.id}】`));
  const source = editTextDocument(document, { start, end: start, text: '归' });
  const parsed = applyTextScript(project, source);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.project.chapters.map(item => [item.id, item.name]), [[chapter.id, '归']]);
  assert.equal(parsed.project.scenes[0].chapterId, chapter.id);
});

test('整行替换章节标题或输入括号参数时，名称标识不会丢失或出现在正文', () => {
  const project = createProject('章节参数'), chapter = project.chapters[0];
  const document = textDocument(projectToText(project));
  const start = document.text.indexOf('# 章节：'), end = document.text.indexOf('\n', start);
  const replacement = editTextDocument(document, { start, end, text: '#章节(流程图=否):归' });
  assert.ok(replacement.includes(`#章节(流程图=否):归【${chapter.id}】`));
  const parsed = applyTextScript(project, replacement);
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.project.chapters[0].id, chapter.id);
  assert.equal(parsed.project.chapters[0].flowchart?.visible, false);
  const colon = document.text.indexOf('：', start);
  const opened = textDocument(editTextDocument(document, { start: colon, end: colon, text: '(' }));
  assert.ok(opened.source.includes(`【${chapter.id}】`));
  assert.ok(!opened.text.includes(`【${chapter.id}】`));
  const closed = editTextDocument(opened, { start: colon + 1, end: colon + 1, text: ')' });
  assert.ok(closed.includes(`【${chapter.id}】`));
  assert.equal(applyTextScript(project, closed).project.chapters[0].id, chapter.id);
});

test('只保留同一类目录定义的身份，删除标题或粘贴另一身份时不遗留旧编号', () => {
  for (const kind of ['章节', '小章节', '段落']) {
    const source = `#${kind}：旧名称【heading_id】\n旁白：保留正文。`, document = textDocument(source), end = document.text.indexOf('\n');
    const renamed = editTextDocument(document, { start: 0, end, text: `#${kind}（流程图=否）：新名称` });
    assert.ok(renamed.includes('新名称【heading_id】'));
    for (const replacement of ['旁白：变成正文。', '', '#章节：新的章节【replacement_id】']) {
      const edited = editTextDocument(document, { start: 0, end, text: replacement });
      assert.ok(!edited.includes('【heading_id】'));
      assert.equal(textDocument(edited).text, textDocument(replacement).text + '\n旁白：保留正文。');
    }
    const deleted = editTextDocument(document, { start: 0, end: end + 1, text: '' });
    assert.equal(deleted, '旁白：保留正文。');
  }
});

test('同名素材的隐藏引用保持不变，手动改素材名称则使用新目标', () => {
  const { project, source } = fixture();
  project.assets.push(
    { id: 'bg_one', kind: 'image', name: '夜宴', path: 'assets/a.png' },
    { id: 'bg_two', kind: 'image', name: '夜宴', path: 'assets/b.png' },
    { id: 'bg_garden', kind: 'image', name: '庭院', path: 'assets/c.png' },
  );
  const raw = source.replace('@震动：横向', '@背景：夜宴【bg_two】');
  const document = textDocument(raw, applyTextScript(project, raw).sourceMap);
  const line = document.text.indexOf('第一句。');
  const unrelated = editTextDocument(document, { start: line, end: line, text: '改写的' });
  const before = applyTextScript(project, unrelated).project.nodes.find(node => node.kind === 'passage')!;
  assert.equal(before.lines[0].actions[0].kind === 'background' && before.lines[0].actions[0].assetId, 'bg_two');
  const start = document.text.indexOf('@背景：夜宴') + '@背景：'.length;
  const changed = editTextDocument(document, { start, end: start + '夜宴'.length, text: '庭院' });
  assert.ok(!changed.includes('【bg_two】'));
  const after = applyTextScript(project, changed).project.nodes.find(node => node.kind === 'passage')!;
  assert.equal(after.lines[0].actions[0].kind === 'background' && after.lines[0].actions[0].assetId, 'bg_garden');
});

test('把指令改成正文不泄露旧编号，批量替换仍保留其余引用和配音', () => {
  const { project, document, lines } = fixture();
  const voice = document.text.indexOf('@配音：问候');
  const edited = editTextDocument(document, { start: voice, end: voice + '@配音'.length, text: '旁白' });
  assert.ok(edited.includes('旁白：问候\n'));
  assert.ok(!edited.includes('问候【voice】'));
  let batch = document;
  const occurrences = [...document.text.matchAll(/相同的对白/g)].map(match => match.index).reverse();
  for (const start of occurrences) batch = textDocument(editTextDocument(batch, { start, end: start + '相同的对白'.length, text: '批量改写' }));
  const result = applyTextScript(project, batch.source).project.nodes.find(node => node.kind === 'passage')!;
  assert.deepEqual(result.lines, [lines[0], ...lines.slice(1).map(line => ({ ...line, text: '批量改写。' }))]);
});

test('改写整句台词保留该句编号、配音和已编辑演出', () => {
  const { document, lines, parse } = fixture();
  const start = document.text.indexOf('旁白：第一句。');
  const source = editTextDocument(document, { start, end: start + '旁白：第一句。'.length, text: '旁白：改写后的第一句。' });
  assert.deepEqual(parse(source), [{ ...lines[0], text: '改写后的第一句。' }, ...lines.slice(1)]);
});

test('在对白前插入演出指令不会把原对白编号分配给其他行', () => {
  const { document, lines, parse } = fixture();
  const start = document.text.indexOf('旁白：第一句。');
  const source = editTextDocument(document, { start, end: start, text: '@等待：0.75\n' });
  assert.deepEqual(parse(source), [{ ...lines[0], actions: [...lines[0].actions, { kind: 'pause', seconds: 0.75 }] }, ...lines.slice(1)]);
});

test('在重复台词前新增一句时，原来的两句各自保留编号', () => {
  const { document, lines, parse } = fixture();
  const start = document.text.indexOf('旁白：相同的对白。');
  const source = editTextDocument(document, { start, end: start, text: '旁白：新增对白。\n' });
  const edited = parse(source);
  assert.equal(edited.length, 4);
  assert.deepEqual(edited[0], lines[0]);
  assert.ok(!lines.some(line => line.id === edited[1].id));
  assert.deepEqual(edited.slice(2), lines.slice(1));
});

test('删除整行同时移除隐藏编号，不生成空白对白或改变后一句编号', () => {
  const { document, lines, parse } = fixture();
  const start = document.text.indexOf('旁白：相同的对白。');
  const source = editTextDocument(document, { start, end: start + '旁白：相同的对白。\n'.length, text: '' });
  assert.ok(!source.includes('@对白标记：line_middle'));
  assert.deepEqual(parse(source), [lines[0], lines[2]]);
});

test('删除换行合并对白时保留第一句编号，全选删除不遗留标记', () => {
  const { document, lines, parse } = fixture();
  const start = document.text.indexOf('旁白：相同的对白。') + '旁白：相同的对白。'.length;
  const source = editTextDocument(document, { start, end: start + 1, text: '' });
  assert.deepEqual(parse(source), [lines[0], { ...lines[1], text: '相同的对白。旁白：相同的对白。' }]);
  assert.equal(editTextDocument(document, { start: 0, end: document.text.length, text: '' }), '');
});

test('斜杠指令输入尚未完成时编号仍隐藏，取消输入后身份和演出保持完整', () => {
  const { project, document, lines, parse } = fixture();
  const start = document.text.indexOf('旁白：第一句。');
  const intermediate = editTextDocument(document, { start, end: start, text: '/' });
  const partial = textDocument(intermediate, applyTextScript(project, intermediate).sourceMap);
  assert.equal(partial.text, document.text.slice(0, start) + '/' + document.text.slice(start));
  const restored = editTextDocument(partial, { start, end: start + 1, text: '' });
  assert.deepEqual(parse(restored), lines);
});

test('选区让重复文字的剪切、替换和插入保留正确位置', () => {
  const { document, lines, parse } = fixture();
  const start = document.text.indexOf('旁白：相同的对白。');
  const end = start + '旁白：相同的对白。\n'.length;
  const next = document.text.slice(0, start) + document.text.slice(end);
  assert.deepEqual(parse(editTextDocument(document, textEdit(document.text, next, { start, end }))), [lines[0], lines[2]]);
  assert.deepEqual(textEdit('哈哈哈', '哈哈哈哈', { start: 1, end: 1 }), { start: 1, end: 1, text: '哈' });
});

test('普通对白逐字编辑可复用长文档投影并保留隐藏编号', () => {
  const { project, source, document } = fixture();
  let current = source, patched = document;
  for (const character of '继续补写') {
    const next = current.replace('第一句。', `第一句。${character}`);
    const change = textEdit(current, next);
    const start = visibleTextOffset(patched, change.start), end = visibleTextOffset(patched, change.end);
    const nextDocument = patchTextDocument(patched, next, { start, end, text: change.text });
    assert.ok(nextDocument);
    assert.equal(nextDocument.text, textDocument(next, applyTextScript(project, next).sourceMap).text);
    assert.match(nextDocument.source, /@对白标记：line_first/);
    patched = nextDocument;
    current = next;
  }
  const newline = textEdit(current, current.replace('第一句。', '第一句。\n旁白：新句。'));
  assert.equal(patchTextDocument(patched, current.replace('第一句。', '第一句。\n旁白：新句。'), { start: visibleTextOffset(patched, newline.start), end: visibleTextOffset(patched, newline.end), text: newline.text }), undefined);
});

test('仅隐藏合法编号，保留正文提及、错误指令和效果定义中的文字', () => {
  const raw = '@对白标记：名称【line_ok】\r\n旁白：这里提到了 @对白标记。\r\n@对白标记：bad】\r\n@效果定义：测试\r\n@对白标记：line_in_effect\r\n@效果结束';
  const document = textDocument(raw);
  assert.equal(document.text, '旁白：这里提到了 @对白标记。\n@对白标记：bad】\n@效果定义：测试\n@对白标记：line_in_effect\n@效果结束');
  assert.equal(visibleTextLine(document, 2), 1);
});

test('完整镜头参数经过文本改写与序列化后仍能回到同一句对白', () => {
  const { project } = fixture();
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines[0].actions = [{ kind: 'camera', x: 0.1, y: 0.2, zoom: 1.2, rotation: 15, duration: 1, easing: 'linear', wait: false }];
  const source = projectToText(project);
  assert.ok(source.includes('@镜头：0.1，0.2，1.2，1，15，匀速，否'));
  const parsed = applyTextScript(project, source);
  const document = textDocument(source, parsed.sourceMap);
  const start = document.text.indexOf('第一句。');
  const edited = editTextDocument(document, { start, end: start + '第一句。'.length, text: '这一句改了文字。' });
  const applied = applyTextScript(project, edited);
  const final = applied.project.nodes.find(node => node.id === passage.id && node.kind === 'passage')!;
  assert.equal(final.kind, 'passage');
  assert.deepEqual(final.kind === 'passage' && final.lines[0], { ...passage.lines[0], text: '这一句改了文字。' });
  assert.deepEqual(applyTextScript(applied.project, projectToText(applied.project)).project.nodes, applied.project.nodes);
});
