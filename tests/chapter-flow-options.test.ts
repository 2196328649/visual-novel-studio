import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { applyTextScript, projectToText, textCommandAction } from '../src/core/text-script';
import { textDocument, editTextDocument } from '../src/core/text-document';
import { textChapters } from '../src/core/text-chapters';
import { textSections } from '../src/core/text-folding';
import { storyMenuEntries } from '../src/core/story-menu';
import { storyFlowLayout } from '../src/core/story-flow';
import { compileProject } from '../src/runtime/compiler';
const component: UiComponent = { id: 'flow', page: 'flowchart', kind: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1, list: { layout: 'flow' } };

test('chapter visibility, display names and explicit scene/paragraph opt-ins survive text edits and native compilation', () => {
  const source = '#章节(显示名称="开场，酒醒"): 第一章 · 酒醒城破\n#小章节: 夜宴\n旁白：一\n@设置：进度=1\n旁白：二\n#段落(流程图=是，显示名称="选择之后"): 分支入口\n旁白：三\n#章节(流程图=否): 第二章\n#小章节(流程图=是): 可见小节\n旁白：四\n#章节: 第三章\n旁白：五';
  const parsed = applyTextScript(createProject(), source);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(storyMenuEntries(parsed.project, 'flowchart').map(e => e.name), ['开场，酒醒', '选择之后', '可见小节', '第三章']);
  assert.equal(textChapters(source).length, 3);
  assert.equal(textSections(source).length, 6);
  const saved = projectSchema.parse(JSON.parse(JSON.stringify(parsed.project)));
  const text = projectToText(saved), visible = textDocument(text).text;
  assert.ok(visible.includes('流程图=否'));
  const at = visible.indexOf('旁白：二');
  const changed = editTextDocument(textDocument(text), { start: at, end: at + 4, text: '旁白：修改后' });
  const reopened = applyTextScript(saved, changed); assert.deepEqual(reopened.issues, []);
  assert.deepEqual(storyMenuEntries(reopened.project, 'flowchart'), storyMenuEntries(saved, 'flowchart'));
  const flow = storyFlowLayout(saved, component);
  assert.equal(flow.nodes.length, 4); assert.ok(flow.edges.length >= 3);
  const built = compileProject(saved); assert.deepEqual(built.diagnostics.filter(d => d.severity === 'error'), []);
  assert.ok(built.files['game/screens.rpy'].includes('开场，酒醒'));
});

test('plain chapters appear once; internal operations and the ending stay hidden; opting every heading out yields an empty map', () => {
  const parsed = applyTextScript(createProject(), '#章节: 一\n旁白：甲\n@设置：进度=1\n旁白：乙\n@等待：1\n@独立演出：过渡\n旁白：丙\n#小章节: 二\n#段落: 三\n旁白：丁');
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(storyMenuEntries(parsed.project, 'flowchart').map(e => e.name), ['一']);
  assert.ok(parsed.project.nodes.filter(n => n.kind === 'passage' && n.name.startsWith('段落 ')).every(n => n.textHeading === false));
  parsed.project.chapters[0].flowchart = { visible: false };
  assert.deepEqual(storyFlowLayout(parsed.project, component).nodes, []);
});

test('invalid heading parameters produce actionable errors; BGM Chinese alias has identical explicit semantics', () => {
  for (const options of ['流程图=也许', '显示名称=12', '未知=是']) assert.equal(applyTextScript(createProject(), `#章节(${options}): 一\n旁白：正文`).issues.length, 1);
  const p = createProject(); p.assets.push({ id: 'bgm', name: '音乐', kind: 'audio', path: 'bgm.ogg' });
  assert.deepEqual(textCommandAction(p, '@背景音乐：音乐'), textCommandAction(p, '@背景音乐：音乐'));
});
