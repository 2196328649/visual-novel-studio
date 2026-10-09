import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { dialogueRows, exportText, previewDialogueRevision } from '../src/core/text-exchange';

function fixture() {
  const project = applyTextScript(createProject('修订'), "# 段落：开场\n甲：重复对白\n@等待：0.5\n甲：重复对白\n旁白：夜色\n@续行：渐深\n@返回标题界面").project;
  project.assets.push({ id: 'voice', name: '配音', kind: 'audio', path: 'assets/voice.ogg' });
  dialogueRows(project)[1].line.voiceId = 'voice';
  project.scriptText = { format: 'vns-text-1', content: projectToText(project).replace('@等待：0.5', '// 不改动这条演出\n@等待：0.5') };
  return project;
}

test('revision IDs support duplicate dialogue, reordered subsets and multiline edits without moving commands', () => {
  const project = fixture(), before = dialogueRows(project);
  const text = `@对白标记：${before[2].line.id}\n旁白：夜深\n@续行：风起\n@对白标记：${before[1].line.id}\n甲：第二句改写`;
  const result = previewDialogueRevision(project, { name: '修订.txt', text });
  assert.equal(result.method, 'ids'); assert.equal(result.changes.length, 2);
  const after = dialogueRows(result.project);
  assert.deepEqual(after.map(({ line }) => line.actions), before.map(({ line }) => line.actions));
  assert.deepEqual(after.map(({ line }) => line.id), before.map(({ line }) => line.id));
  assert.equal(after[0].line.text, '重复对白'); assert.equal(after[1].line.voiceId, 'voice');
  assert.equal(after[2].line.text, '夜深\n风起');
  assert.ok(result.project.scriptText!.content.includes('// 不改动这条演出\n@等待：0.5'));
  const parsed = applyTextScript(result.project, result.project.scriptText!.content);
  assert.deepEqual(parsed.issues.filter(issue => issue.severity === 'error'), []);
  assert.deepEqual(parsed.project.nodes, result.project.nodes);
});

test('pure dialogue uses a companion map and refuses changed row count, wrong project and stale text', () => {
  const project = fixture(), exported = exportText(project, 'dialogue');
  assert.ok(!exported.text.includes('@')); assert.ok(!exported.text.includes('【'));
  const revised = { name: '对白.txt', ...exported, text: exported.text.replace('夜色', '天色') };
  const result = previewDialogueRevision(project, revised);
  assert.equal(result.method, 'mapping'); assert.equal(result.changes.length, 1);
  assert.throws(() => previewDialogueRevision(project, { ...revised, text: revised.text + '甲：新句\n' }), /数量/);
  assert.throws(() => previewDialogueRevision({ ...project, id: 'other' }, revised), /另一个工程/);
  const stale = structuredClone(project); dialogueRows(stale)[2].line.text = '已手工改写'; stale.scriptText = { format: 'vns-text-1', content: projectToText(stale) };
  assert.throws(() => previewDialogueRevision(stale, revised), /导出后已被修改/);
});

test('full command export roundtrips; unmarked revisions require explicit order and preserve graph identity', () => {
  const project = fixture(), full = exportText(project, 'commands');
  assert.deepEqual(applyTextScript(project, full.text).project.nodes, project.nodes);
  const plain = exportText(project, 'dialogue').text.replace('夜色', '暮色');
  assert.throws(() => previewDialogueRevision(project, { name: 'plain.txt', text: plain }), /没有行标识/);
  const result = previewDialogueRevision(project, { name: 'plain.txt', text: plain }, true);
  assert.equal(result.method, 'order');
  assert.deepEqual(result.project.nodes.filter(node => node.kind !== 'passage'), project.nodes.filter(node => node.kind !== 'passage'));
  const id = dialogueRows(project)[0].line.id;
  assert.throws(() => previewDialogueRevision(project, { name: 'bad.txt', text: `@对白标记：${id}\n甲：1\n@对白标记：${id}\n甲：2` }), /重复使用/);
});

test('dialogue-only updates read full scripts with silent staging and do not accumulate markers', () => {
  const project = fixture();
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines.unshift({ id: 'silent_open', silent: true, text: '', actions: [{ kind: 'pause', seconds: .25 }] });
  passage.lines.push({ id: 'silent_close', silent: true, text: '', actions: [{ kind: 'pause', seconds: .1 }] });
  project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
  const linesBefore = project.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []);
  let current = applyTextScript(project, project.scriptText.content).project;
  assert.deepEqual(current.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []), linesBefore);
  for (const word of ['天色', '暮色', '夜色']) {
    const imported = exportText(current, 'commands').text.replace(/旁白：(夜色|天色|暮色)/, '旁白：' + word);
    const result = previewDialogueRevision(current, { name: '含指令.txt', text: imported });
    assert.deepEqual(result.project.nodes.map(node => node.kind === 'passage' ? node.lines.map(line => line.actions) : node), current.nodes.map(node => node.kind === 'passage' ? node.lines.map(line => line.actions) : node));
    assert.equal((result.project.scriptText!.content.match(/@对白标记/g) ?? []).length, passage.lines.length);
    assert.deepEqual(applyTextScript(result.project, result.project.scriptText!.content).project.nodes, result.project.nodes);
    current = result.project;
  }
});

test('sidecar import detects reordered unchanged dialogue even when the speaker is the same', () => {
  const project = fixture();
  const rows = dialogueRows(project);
  rows[0].line.text = '第一句话'; rows[1].line.text = '第二句话';
  project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
  const exported = exportText(project, 'dialogue');
  const reordered = exported.text.replace('第一句话', '临时').replace('第二句话', '第一句话').replace('临时', '第二句话');
  assert.throws(() => previewDialogueRevision(project, { name: '乱序.txt', ...exported, text: reordered }), /位置发生变化/);
});
