import assert from 'node:assert/strict';
import test from 'node:test';
import { applyTextDocumentEdit, sourceTextOffset, textDocument, visibleTextOffset } from '../src/core/text-document';
import { foldTextDocument, textSections, visibleTextSections } from '../src/core/text-folding';

const source = '# 章节：一\n# 小章节：庭院\n# 段落：相遇\n旁白：藏起来的台词。\n# 段落：离开\n旁白：仍可编辑。\n# 章节：二\n旁白：后续。';
test('章节、小章节、段落按层级折叠，嵌套状态保留且原文不变', () => {
  const base = textDocument(source), sections = textSections(base.text);
  const collapsed = new Set(sections.filter(section => ['一', '相遇'].includes(section.name)).map(section => section.key));
  const folded = foldTextDocument(base, collapsed);
  assert.equal(folded.source, source);
  assert.equal(folded.text, '# 章节：一\n# 章节：二\n旁白：后续。');
  assert.equal(visibleTextSections(folded, collapsed).length, 2);
  collapsed.delete(sections.find(section => section.name === '一')!.key);
  const inner = foldTextDocument(base, collapsed);
  assert.ok(inner.text.includes('# 小章节：庭院'));
  assert.ok(!inner.text.includes('藏起来'));
  assert.equal(foldTextDocument(base, new Set()).text, source);
});
test('折叠中改标题和后文不丢失正文，删除整个折叠章节会删除其内容', () => {
  const base = textDocument(source), key = textSections(source)[0].key;
  const folded = foldTextDocument(base, new Set([key]));
  const title = folded.text.indexOf('一');
  const renamed = applyTextDocumentEdit(folded, { start: title, end: title + 1, text: '第一章' });
  assert.equal(renamed.source, source.replace('一', '第一章'));
  const after = folded.text.indexOf('后续');
  const edited = applyTextDocumentEdit(folded, { start: after, end: after + 2, text: '新后文' });
  assert.equal(edited.source, source.replace('后续', '新后文'));
  assert.equal(sourceTextOffset(folded, after), source.indexOf('后续'));
  assert.equal(visibleTextOffset(folded, source.indexOf('后续')), after);
  const deleted = applyTextDocumentEdit(folded, { start: 0, end: folded.text.indexOf('# 章节：二'), text: '' });
  assert.equal(deleted.source, '# 章节：二\n旁白：后续。');
});
