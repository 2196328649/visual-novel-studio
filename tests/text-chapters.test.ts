import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { applyTextScript } from '../src/core/text-script';
import { textChapters, textChapterAtLine, selectedTextChapter } from '../src/core/text-chapters';
import { applyTextDocumentEdit, patchTextDocument, sourceTextOffset, textDocument, textDocumentContainsLine, visibleTextLine, visibleTextOffset } from '../src/core/text-document';
import { performanceTextDocument } from '../src/core/text-performance';
import { textSections } from '../src/core/text-folding';

const source = `@入口：开场【first_passage】
# 章节：第一章【first_chapter】
# 小章节：开场【first_scene】
# 段落：开场【first_passage】
@对白标记：first_line
旁白：第一章的对白。
@跳转：相遇【second_passage】

# 章节：第二章【second_chapter】
# 小章节：相遇【second_scene】
# 段落：相遇【second_passage】
@对白标记：second_line
@震动：横向
旁白：相同的对白。
@对白标记：second_repeat
旁白：相同的对白。
@跳转：告别【last_passage】

# 章节：第三章【last_chapter】
# 小章节：告别【last_scene】
# 段落：告别【last_passage】
@对白标记：last_line
旁白：第三章的对白。
`;
const base = createProject('章节隔离');

test('incremental edits in a later chapter preserve hidden performances and caret mapping', () => {
  for (const separator of ['\n', '\r\n']) for (const hide of [false, true]) {
    let current = source.replaceAll('\n', separator);
    const range = textChapters(current)[2];
    const prefix = current.slice(0, range.start), suffix = current.slice(range.end);
    let document = performanceTextDocument(base, current, hide, undefined, range);
    const edits = [
      { from: '相同的对白。', to: '相同的对白修改了。' },
      { from: '修改了', to: '继续编辑' },
      { from: '继续编辑', to: '' },
    ];
    for (const { from, to } of edits) {
      const start = document.text.lastIndexOf(from);
      assert.ok(start >= 0);
      const edit = { start, end: start + from.length, text: to };
      const result = applyTextDocumentEdit(document, edit);
      const patched = patchTextDocument(document, result.source, edit);
      assert.ok(patched, 'plain dialogue edits must use the incremental projection');
      current = result.source;
      const expected = performanceTextDocument(base, current, hide, undefined, textChapters(current)[2]);
      assert.deepEqual(patched, expected);
      for (let offset = 0; offset <= patched.text.length; offset++) {
        assert.equal(sourceTextOffset(patched, offset), sourceTextOffset(expected, offset));
        assert.equal(visibleTextOffset(patched, sourceTextOffset(patched, offset)), offset);
      }
      assert.equal(visibleTextOffset(patched, result.sourceOffset(start + to.length)), start + to.length);
      assert.ok(current.startsWith(prefix) && current.endsWith(suffix));
      document = patched;
    }
    const parsed = applyTextScript(base, current);
    assert.deepEqual(parsed.issues, []);
    const passage = parsed.project.nodes.find(node => node.id === 'second_passage');
    assert.equal(passage?.kind, 'passage');
    if (passage?.kind === 'passage') {
      assert.deepEqual(passage.lines.map(line => [line.id, line.text]), [['second_line', '相同的对白。'], ['second_repeat', '相同的对白。']]);
      assert.deepEqual(passage.lines[0].actions, [{ kind: 'shake', direction: 'horizontal' }]);
      assert.deepEqual(passage.lines[1].actions, []);
    }
  }
});

test('chapter ranges expose only the selected chapter and map navigation to full source', () => {
  const parsed = applyTextScript(base, source);
  assert.deepEqual(parsed.issues, []);
  const chapters = textChapters(source, parsed.project.chapters);
  assert.deepEqual(chapters.map(chapter => chapter.name), ['序言与全局设置', '第一章', '第二章', '第三章']);
  const range = chapters[2], document = textDocument(source, parsed.sourceMap, { range });
  assert.ok(document.text.startsWith('# 章节：第二章'));
  assert.ok(!document.text.includes('第一章') && !document.text.includes('第三章') && !document.text.includes('【'));
  const raw = source.indexOf('旁白：相同'), visible = document.text.indexOf('旁白：相同');
  assert.equal(sourceTextOffset(document, visible), raw);
  assert.equal(visibleTextOffset(document, raw), visible);
  const location = parsed.sourceMap.find(item => !item.reference && item.lineId === 'second_line' && item.actionCount === undefined)!;
  assert.equal(document.text.split('\n')[visibleTextLine(document, location.sourceLine) - 1], '旁白：相同的对白。');
  assert.equal(textChapterAtLine(chapters, location.sourceLine)?.chapterId, 'second_chapter');
  assert.equal(textDocumentContainsLine(document, 1), false);
});

test('章节参数逐字输入期间保留当前编辑范围，引号内标点不成为标题', () => {
  const original = textChapters(source)[2];
  for (const options of ['(', '()', '(流程图=否)', '（显示名称="夜:归)城, A"）']) {
    const edited = source.replace('# 章节：第二章', '# 章节' + options + '：第二章');
    const chapters = textChapters(edited), current = selectedTextChapter(chapters, { key: original.key, index: 2 });
    assert.equal(current.key, original.key);
    assert.equal(current.name, '第二章');
    assert.equal(current.chapterId, 'second_chapter');
    assert.ok(edited.slice(current.start, current.end).includes('相同的对白。'));
    assert.ok(!edited.slice(current.start, current.end).includes('第三章'));
    const section = textSections(textDocument(edited).text).find(section => section.name === '第二章');
    assert.ok(section);
    assert.equal(section.level, 1);
  }
});

test('editing a repeated dialogue keeps its ID and folded actions without touching other chapters', () => {
  const range = textChapters(source)[2], document = performanceTextDocument(base, source, true, undefined, range);
  assert.ok(!document.text.includes('@震动'));
  const start = document.text.lastIndexOf('相同的对白。');
  const edited = applyTextDocumentEdit(document, { start, end: start + '相同的对白。'.length, text: '只修改这句。' });
  assert.ok(edited.source.startsWith(source.slice(0, range.start)));
  assert.ok(edited.source.endsWith(source.slice(range.end)));
  assert.equal(edited.source.slice(edited.sourceOffset(start), edited.sourceOffset(start) + 6), '只修改这句。');
  const parsed = applyTextScript(base, edited.source);
  assert.deepEqual(parsed.issues, []);
  const passage = parsed.project.nodes.find(node => node.id === 'second_passage');
  assert.equal(passage?.kind, 'passage');
  if (passage?.kind === 'passage') {
    assert.deepEqual(passage.lines.map(line => [line.id, line.text]), [['second_line', '相同的对白。'], ['second_repeat', '只修改这句。']]);
    assert.equal(passage.lines[0].actions[0].kind, 'shake');
    assert.equal(passage.next, 'last_passage');
  }
});

test('select-all replacement or deletion cannot consume the next chapter separator', () => {
  const range = textChapters(source)[2], document = textDocument(source, [], { range });
  for (const replacement of ['', '# 章节：新的一章\n旁白：新的结尾']) {
    const edited = applyTextDocumentEdit(document, { start: 0, end: document.text.length, text: replacement }).source;
    assert.equal(edited, source.slice(0, range.start) + replacement + source.slice(range.end));
    assert.ok(edited.includes('\n# 章节：第三章【last_chapter】'));
    assert.equal(textChapters(edited).at(-1)?.name, '第三章');
  }
});

test('CRLF source retains the exact bytes outside the edited chapter and correct caret offsets', () => {
  const original = source.replaceAll('\n', '\r\n');
  const range = textChapters(original)[2], document = textDocument(original, [], { range });
  const at = document.text.indexOf('相同的对白。');
  assert.equal(sourceTextOffset(document, at), original.indexOf('相同的对白。'));
  const edited = applyTextDocumentEdit(document, { start: at, end: at, text: '修改：' }).source;
  assert.ok(edited.startsWith(original.slice(0, range.start)));
  assert.ok(edited.endsWith(original.slice(range.end)));
});

test('four chapters of five thousand dialogues keep the editing surface limited to one chapter', () => {
  const longSource = Array.from({ length: 4 }, (_, chapter) => `# 章节：第${chapter}章【chapter_${chapter}】\n` + Array.from({ length: 5000 }, (_, index) => `@对白标记：line_${chapter}_${index}\n旁白：第${chapter}章的第${index}句对白。`).join('\n')).join('\n');
  const range = textChapters(longSource)[2], document = textDocument(longSource, [], { range });
  assert.equal(document.text.split('\n').length, 5001);
  const at = document.text.indexOf('第2章的第4999句');
  const edited = applyTextDocumentEdit(document, { start: at, end: at, text: '修订：' }).source;
  assert.ok(edited.startsWith(longSource.slice(0, range.start)));
  assert.ok(edited.endsWith(longSource.slice(range.end)));
  assert.equal((edited.match(/@对白标记/g) ?? []).length, 20000);
});

test('empty chapters remain editable and effect definitions do not create false chapter boundaries', () => {
  assert.equal(textChapters('')[0].key, 'unsectioned');
  const chapters = textChapters('@效果定义：示例\n# 章节：只是定义内容\n@效果结束\n# 章节：\n# 章节：结尾');
  assert.deepEqual(chapters.map(chapter => chapter.name), ['序言与全局设置', '未命名章节', '结尾']);
});

test('restoring a chapter after save does not select a newly inserted preamble', () => {
  const chapters = textChapters('@入口：开场\n#章节：开场\n旁白：正文。\n#章节：结尾\n旁白：结束。');
  assert.equal(selectedTextChapter(chapters, { key: 'unsectioned', index: 0 }).name, '开场');
  assert.equal(selectedTextChapter(chapters, { key: 'chapter:1', index: 0 }).name, '结尾');
  assert.equal(selectedTextChapter(chapters, { key: 'frontmatter', index: 0 }).name, '序言与全局设置');
  assert.equal(selectedTextChapter(chapters, { key: 'deleted', index: 99 }).name, '结尾');
});
