import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { editTextDocument, textDocument } from '../src/core/text-document';
import { compileProject } from '../src/runtime/compiler';

function fixture() {
  const source = "# 章节：第一章\n# 小章节：夜宴\n# 段落：开场\n@章节进入演出文字版：标题=第一章 · 酒醒城破，右侧字=据原剧情节选改编，时长=4.2\n@独立演出\n旁白：没有为这句台词声明新段落。\n@选择：要出门吗？\n@选项：出门 -> 结束\n@选项：留下 -> 结束\n# 段落：结束\n@返回标题界面";
  const parsed = applyTextScript(createProject(), source);
  assert.deepEqual(parsed.issues, []);
  return { project: parsed.project, source };
}

test('unlabeled dialogue and choices keep their flow IDs without manufacturing visible directory declarations', () => {
  const { project } = fixture();
  const source = projectToText(project), parsed = applyTextScript(project, source);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.project.nodes, project.nodes);
  const visible = textDocument(source, parsed.sourceMap).text;
  assert.deepEqual(visible.split('\n').filter(line => line.startsWith('# 段落')), ['# 段落：结束']);
  assert.match(visible, /@独立演出：开场/);
  assert.doesNotMatch(visible, /节点标记|对白标记|【[a-z_0-9]+】/);
  assert.ok(project.nodes.filter(node => node.kind === 'passage' && node.lines.some(line => !line.silent) || node.kind === 'choice').every(node => node.textHeading === false));
  assert.deepEqual(compileProject(parsed.project).files, compileProject(project).files);
});

test('editing the first implicit dialogue keeps node identity, line identity and blueprint layout', () => {
  const { project } = fixture();
  const passage = project.nodes.find(node => node.kind === 'passage' && node.lines.some(line => !line.silent))!;
  assert.ok(passage.kind === 'passage');
  passage.x = 471; passage.y = -318;
  const source = projectToText(project), document = textDocument(source, applyTextScript(project, source).sourceMap);
  const position = document.text.indexOf('没有为这句台词');
  const edited = editTextDocument(document, { start: position, end: position + '没有为这句台词'.length, text: '修改这句台词，但仍然没有' });
  const parsed = applyTextScript(project, edited);
  assert.deepEqual(parsed.issues, []);
  const restored = parsed.project.nodes.find(node => node.id === passage.id);
  assert.ok(restored?.kind === 'passage');
  assert.equal(restored.lines[0].id, passage.lines[0].id);
  assert.equal(restored.x, 471); assert.equal(restored.y, -318);
  assert.equal(restored.textHeading, false);
  assert.doesNotMatch(textDocument(edited).text, /节点标记|段落 1/);
});

test('adding a real heading to implicit content names the existing node rather than creating an empty extra paragraph', () => {
  const { project } = fixture();
  const passage = project.nodes.find(node => node.kind === 'passage' && node.lines.some(line => !line.silent))!;
  const source = projectToText(project), document = textDocument(source, applyTextScript(project, source).sourceMap);
  const position = document.text.indexOf('旁白：');
  const edited = editTextDocument(document, { start: position, end: position, text: '# 段落：自己命名的段落\n' });
  const parsed = applyTextScript(project, edited);
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.project.nodes.length, project.nodes.length);
  const renamed = parsed.project.nodes.find(node => node.id === passage.id)!;
  assert.equal(renamed.name, '自己命名的段落');
  assert.notEqual(renamed.textHeading, false);
  assert.match(textDocument(projectToText(parsed.project)).text, /# 段落：自己命名的段落/);
});
