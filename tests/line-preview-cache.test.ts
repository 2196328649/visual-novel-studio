import { createShowCharacterFixture } from '../scripts/lib/show-character-fixture';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type Project } from '../src/core/model';
import { createLinePreviewReader } from '../src/core/line-preview-cache';
import { linePreviewSnapshot } from '../src/core/line-preview';
import { applyTextScript } from '../src/core/text-script';

function fixture() {
  const base = createProject();
  base.assets.push({ id: 'bg', name: '城门', kind: 'image', path: 'bg.png' });
  base.blueprints.push(createShowCharacterFixture());
  return applyTextScript(base, '# 段落：正文【passage】\n@对白标记：first\n@背景：城门【bg】\n旁白：前一行。\n@对白标记：second\n@镜头：0.1，0.2，1.2，0，0，匀速，否\n旁白：正在编辑的台词。').project;
}
const selection = { nodeId: 'passage', lineId: 'second' };
test('相邻段落复用对白标记时，保留对白只刷新对应段落的文字', () => {
  const project = fixture(), first = project.nodes.find(n => n.id === 'passage');
  assert.ok(first?.kind === 'passage');
  project.nodes.push({ ...structuredClone(first), id: 'other', lines: [{ ...structuredClone(first.lines[0]), text: '另一个段落。' }] });
  const read = createLinePreviewReader();
  read(project, selection);
  const next = editDialogue(project, 0, '正确段落的新对白。');
  assert.equal(read(next, selection).before.dialogue?.text, '正确段落的新对白。');
  assert.deepEqual(read(next, selection), linePreviewSnapshot(next, selection));
});
function editDialogue(project: Project, index: number, text: string) {
  const next = structuredClone(project), node = next.nodes.find(node => node.id === 'passage');
  assert.equal(node?.kind, 'passage');
  if (node?.kind === 'passage') node.lines[index].text = text;
  next.scriptText = { format: 'vns-text-1', content: 'changed source' };
  return next;
}

test('纯对白编辑复用舞台推演，但返回当前全文和配音所在的对白对象', () => {
  const project = fixture(), read = createLinePreviewReader();
  const initial = read(project, selection);
  const next = editDialogue(project, 1, '新台词。');
  const updated = read(next, selection);
  assert.equal(updated.before, initial.before);
  assert.equal(updated.after.actors, initial.after.actors);
  assert.equal(updated.actions, initial.actions);
  assert.equal(updated.line?.text, '新台词。');
  assert.deepEqual(updated, linePreviewSnapshot(next, selection));
  assert.equal(read(next, selection), updated);
  const prior = read(editDialogue(next, 0, '前文改写。'), selection);
  assert.equal(prior.after.actors, initial.after.actors);
  assert.equal(prior.before.dialogue?.text, '前文改写。');
  assert.equal(initial.after.dialogue?.text, '正在编辑的台词。');
  assert.equal(initial.line?.text, '正在编辑的台词。');
});

test('演出、场景、角色、蓝图和参数变化使舞台缓存失效', () => {
  const project = fixture();
  const changes: ((next: Project) => void)[] = [
    next => { const node = next.nodes.find(node => node.id === 'passage'); if (node?.kind === 'passage') node.lines[0].actions = []; },
    next => { const node = next.nodes.find(node => node.id === 'passage'); if (node?.kind === 'passage') node.lines[1].speakerId = 'new_speaker'; },
    next => { next.scenes[0].name += '改'; },
    next => { next.characters.push({ id: 'new_speaker', name: '新人', color: '#ffffff', expressions: [] }); },
    next => { next.variables.push({ id: 'flag', name: '开关', type: 'boolean', initial: true, persistent: false }); },
    next => { next.assets[0].path = 'changed.png'; },
    next => { next.blueprints = []; },
    next => { next.nodes.reverse(); },
  ];
  for (const change of changes) {
    const read = createLinePreviewReader(), initial = read(project, selection), next = structuredClone(project);
    change(next);
    assert.notEqual(JSON.stringify(next), JSON.stringify(project));
    const updated = read(next, selection);
    assert.notEqual(updated.after, initial.after);
    assert.deepEqual(updated, linePreviewSnapshot(next, selection));
  }
});

test('不同对白、截断的演出与路径选择各自计算，不把显示文字字段一概忽略', () => {
  const project = fixture(), read = createLinePreviewReader();
  const full = read(project, selection), partial = read(project, selection, 0);
  assert.notEqual(partial.after, full.after);
  assert.deepEqual(partial, linePreviewSnapshot(project, selection, 0));
  assert.equal(read(project, selection).after, full.after);
  const first = read(project, { ...selection, lineId: 'first' });
  assert.notEqual(first.after, full.after);
  const alternate = { ...selection, routeChoices: { absent: 'branch' } };
  assert.deepEqual(read(project, alternate), linePreviewSnapshot(project, alternate));
  const next = structuredClone(project);
  next.nodes.push({ id: 'end', name: '结束', kind: 'end', sceneId: next.scenes[0].id, x: 0, y: 0 });
  const end = read(next, selection);
  const changed = structuredClone(next);
  const node = changed.nodes.at(-1)!;
  if (node.kind === 'end') node.name = '改后的返回节点';
  assert.notEqual(read(changed, selection).after, end.after);
});
