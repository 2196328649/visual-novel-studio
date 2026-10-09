import test from 'node:test';
import assert from 'node:assert/strict';
import { createBranchingProject, projectFolderName } from '../src/core/project-templates';
import { searchStory, storySearchIndex } from '../src/core/story-search';
import { validateProject } from '../src/core/validate';
import { targets } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { compileProject } from '../src/runtime/compiler';

test('starter template has two reachable endings, independent IDs and an editable text round trip', () => {
  const project = createBranchingProject('新故事'), another = createBranchingProject('另一个故事');
  assert.notEqual(project.id, another.id);
  assert.ok(project.nodes.every(node => !another.nodes.some(other => node.id === other.id)));
  assert.deepEqual(validateProject(project), []);
  const visited = new Set<string>();
  const visit = (id: string) => { if (visited.has(id)) return; visited.add(id); const node = project.nodes.find(node => node.id === id)!; for (const target of targets(node)) if (target.target) visit(target.target); };
  visit(project.entryId);
  assert.equal(visited.size, project.nodes.length);
  assert.equal(project.nodes.filter(node => node.kind === 'end').length, 2);
  const parsed = applyTextScript(project, projectToText(project));
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.project.nodes.filter(node => node.kind === 'end').length, 2);
  assert.equal(parsed.project.nodes.filter(node => node.kind === 'choice').length, 1);
  assert.deepEqual(compileProject(parsed.project).diagnostics, []);
});

test('story search identifies exact repeated dialogue lines and combines speaker and chapter keywords', () => {
  const project = createBranchingProject('查找故事');
  const passages = project.nodes.filter(node => node.kind === 'passage').filter(node => node.lines.some(line => !line.silent));
  project.characters = [{ id: 'speaker', name: '小雨', color: '#ffffff', expressions: [] }];
  passages[1].textHeading = false;
  passages[1].lines[1].speakerId = 'speaker';
  passages[1].lines[1].text = '同样的对白';
  passages[2].lines[1].text = '同样的对白';
  const index = storySearchIndex(project);
  assert.equal(searchStory(index, '同样的对白').total, 2);
  const matches = searchStory(index, '小雨 一同回家 同样').entries;
  assert.equal(matches.length, 1);
  assert.equal(matches[0].lineId, passages[1].lines[1].id);
  assert.equal(matches[0].nodeId, passages[1].id);
  assert.equal(matches[0].label, '小雨：同样的对白');
  assert.equal(searchStory(index, '借给对方').entries[0].kind, '选择');
  assert.equal(searchStory(index, '明天的约定').entries[0].kind, '演出文字');
  assert.equal(searchStory(index, '不存在的词').total, 0);
});

test('multiline endings and choices keep their content and targets across text mode', () => {
  const project = createBranchingProject('复杂选项');
  const choice = project.nodes.find(node => node.kind === 'choice')!;
  choice.prompt = '第一行\n第二行';
  choice.choices[0].text = '前往 A -> B\n继续';
  const parsed = applyTextScript(project, projectToText(project));
  assert.deepEqual(parsed.issues, []);
  for (const node of project.nodes.filter(node => node.kind === 'choice' || node.kind === 'end')) {
    assert.deepEqual(parsed.project.nodes.find(other => other.id === node.id), node);
  }
  assert.deepEqual(validateProject(parsed.project), []);
});

test('story search bounds rendered results, excludes silent cues and normalizes case and full width', () => {
  const project = createBranchingProject('大量对白');
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines = Array.from({ length: 5000 }, (_, i) => ({ id: `line_${i}`, text: `ＡＢＣ 台词 ${i}`, actions: [], silent: i === 0 }));
  const index = storySearchIndex(project), result = searchStory(index, 'abc 台词');
  assert.equal(result.total, 4999); assert.equal(result.entries.length, 100);
  assert.equal(result.entries[0].lineId, 'line_1');
  assert.equal(searchStory(index, '  ').total, 0);
  assert.equal(searchStory(index, 'abc', 10).entries.length, 10);
});

test('suggested project folders reject device names and trailing dots without changing normal Chinese names', () => {
  assert.equal(projectFolderName('雨中的车站'), '雨中的车站');
  for (const name of ['CON', 'NUL.txt', 'LPT1', 'COM¹']) assert.ok(projectFolderName(name).startsWith('作品_'));
  assert.equal(projectFolderName(' ... '), '未命名作品');
  assert.equal(projectFolderName('a/b:story. '), 'a_b_story');
});
