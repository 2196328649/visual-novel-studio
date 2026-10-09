import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, type Project, type PassageNode } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { mergeImportedPassages } from '../scripts/lib/merge-imported-passages';

function fixture() {
  const project = createProject('导入正文');
  const first = project.nodes.find(node => node.kind === 'passage') as PassageNode;
  first.textHeading = false; first.lines[0].text = '我一定会写信。';
  const second: PassageNode = { ...structuredClone(first), id: 'continued_body', name: '段落 2',
    lines: [{ id: 'arrival_line', text: '几日后，我们到了客栈。', actions: [{ kind: 'pause', seconds: .2 }] }] };
  first.next = second.id; project.nodes.splice(2, 0, second);
  return { project, first, second };
}
function source(project: Project) {
  project.scriptText = { format: 'vns-text-1', content: projectToText(project), standaloneSyntax: 'module-names', performanceSyntax: 'explicit' };
  return project;
}

test('合并导入正文的隐藏分段，保留所有台词、演出与行 ID，保存重读不再拆开', () => {
  const { project, first, second } = fixture(); source(project);
  const snapshot = structuredClone(project), result = mergeImportedPassages(project);
  assert.deepEqual(project, snapshot);
  assert.equal(result.merged.length, 1);
  const joined = result.project.nodes.find(node => node.id === first.id) as PassageNode;
  assert.deepEqual(joined.lines, [...first.lines, ...second.lines]);
  assert.equal(joined.next, second.next);
  assert.ok(!result.project.scriptText!.content.includes(second.id));
  for (const text of [result.project.scriptText!.content, projectToText(result.project)]) {
    const parsed = applyTextScript(result.project, text);
    assert.deepEqual(parsed.issues, []);
    assert.deepEqual(parsed.project.nodes.map(node => node.id), result.project.nodes.map(node => node.id));
    assert.equal(projectToText(parsed.project), projectToText(result.project));
  }
  assert.deepEqual(mergeImportedPassages(result.project).merged, []);
});

test('正文空行不产生新的模块', () => {
  const { project } = fixture();
  const parsed = applyTextScript(project, '旁白：我一定会写信。\n\n旁白：几日后，我们到了客栈。');
  assert.deepEqual(parsed.issues, []);
  const passages = parsed.project.nodes.filter(node => node.kind === 'passage');
  assert.equal(passages.length, 1);
  assert.equal(passages[0].lines.length, 2);
});

test('保留尚未同步到节点的文本修改，不用旧节点覆盖最新台词', () => {
  const { project, first } = fixture(); source(project);
  project.scriptText!.content = project.scriptText!.content.replace('我一定会写信。', '我刚刚修改了这句台词。');
  const result = mergeImportedPassages(project);
  const stored = result.project.nodes.find(node => node.id === first.id) as PassageNode;
  assert.equal(stored.lines[0].text, first.lines[0].text);
  assert.ok(result.project.scriptText!.content.includes('我刚刚修改了这句台词。'));
  const parsed = applyTextScript(result.project, result.project.scriptText!.content);
  assert.deepEqual(parsed.issues, []);
  const visible = parsed.project.nodes.find(node => node.id === first.id) as PassageNode;
  assert.equal(visible.lines[0].text, '我刚刚修改了这句台词。');
  assert.equal(visible.lines.length, 2);
});

test('手动段落标题、独立演出、小章节与断开的连线保持边界', () => {
  for (const change of [
    ({ second }: ReturnType<typeof fixture>) => { delete second.textHeading; },
    ({ second }: ReturnType<typeof fixture>) => { second.lines[0].silent = true; },
    ({ second }: ReturnType<typeof fixture>) => { second.sceneId = 'another_scene'; },
    ({ first }: ReturnType<typeof fixture>) => { delete first.next; },
    ({ second }: ReturnType<typeof fixture>) => { second.flowchart = { visible: true }; },
  ]) {
    const value = fixture(); change(value); source(value.project);
    assert.deepEqual(mergeImportedPassages(value.project).merged, []);
  }
});

test('入口、额外跳转及正文中的显式目标引用不能被合并掉', () => {
  {
    const { project, second } = fixture(); project.entryId = second.id; source(project);
    assert.deepEqual(mergeImportedPassages(project).merged, []);
  }
  {
    const { project, second } = fixture();
    project.nodes.push({ id: 'branch_jump', kind: 'jump', name: '另一条路线', sceneId: second.sceneId, x: 0, y: 0, target: second.id });
    source(project);
    assert.deepEqual(mergeImportedPassages(project).merged, []);
  }
  {
    const { project, first, second } = fixture(); source(project);
    project.scriptText!.content = project.scriptText!.content.replace(`@节点标记：${second.name}【${second.id}】`, `@跳转：${second.name}\n@节点标记：${second.name}【${second.id}】`);
    assert.equal(first.next, second.id);
    assert.deepEqual(mergeImportedPassages(project).merged, []);
  }
});

test('连续多处分段一次合并，后面的独立演出保持原有内容和连接', () => {
  const { project, first, second } = fixture();
  const third: PassageNode = { ...structuredClone(second), id: 'continued_third', name: '段落 3', lines: [{ id: 'third_line', text: '我们住了下来。', actions: [] }] };
  const standalone: PassageNode = { ...structuredClone(second), id: 'closing_performance', name: '结尾演出', lines: [{ id: 'closing_line', text: '', silent: true, actions: [{ kind: 'pause', seconds: 1 }] }] };
  second.next = third.id; third.next = standalone.id;
  project.nodes.splice(3, 0, third, standalone); source(project);
  const result = mergeImportedPassages(project);
  assert.equal(result.merged.length, 2);
  const joined = result.project.nodes.find(node => node.id === first.id) as PassageNode;
  assert.equal(joined.lines.length, 3); assert.equal(joined.next, standalone.id);
  assert.deepEqual(result.project.nodes.find(node => node.id === standalone.id), standalone);
});
