import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema } from '../src/core/model';
import { applyTextScript, projectToText, standaloneText } from '../src/core/text-script';
import { isStandaloneNode, performancePlayback } from '../src/core/standalone-performance';
import { stageEditedProject } from '../src/core/stage-edit';
import { migratePlaybackSyntax } from '../src/core/playback-syntax-migration';
import { textAssistance } from '../src/core/text-completion';
import { compileProject } from '../src/runtime/compiler';
import { parseProject } from '../src/desktop/project-store';

test('inline standalone parameters preserve names, playback, links and following dialogue', () => {
  const source = '@等待：1\n@独立演出：模块名称="开场，雨停了"，允许点击跳过=否，结束后=继续剧情，结束转场=纯色，淡出=0.4，停留=0.2，淡入=0.7，颜色=#102030\n旁白：雨声渐远。\n@等待：2\n@独立演出：片尾，允许点击跳过=是，结束后=返回标题';
  const parsed = applyTextScript(createProject(), source);
  assert.deepEqual(parsed.issues, []);
  const [first, last] = parsed.project.nodes.filter(isStandaloneNode);
  assert.equal(first.name, '开场，雨停了');
  assert.deepEqual(first.lines[0].playback, { clickSkip: false, onComplete: 'next', transition: { mode: 'color', outDuration: .4, hold: .2, inDuration: .7, color: '#102030' } });
  const dialogue = parsed.project.nodes.find(n => n.kind === 'passage' && n.lines.some(l => l.text === '雨声渐远。'))!;
  assert.ok(dialogue.kind === 'passage'); assert.equal(dialogue.lines[0].playback, undefined);
  assert.equal(first.next, dialogue.id); assert.equal(dialogue.next, last.id);
  const exported = projectToText(parsed.project);
  assert.doesNotMatch(exported, /@演出(?:设置|转场)/);
  const restored = applyTextScript(projectSchema.parse(parsed.project), exported);
  assert.deepEqual(restored.issues, []); assert.deepEqual(restored.project.nodes, parsed.project.nodes);
  const runtime = compileProject(restored.project);
  assert.deepEqual(runtime.diagnostics.filter(d => d.severity === 'error'), []);
  assert.match(runtime.files['game/story.rpy'], /vn_performance_finish\(\{"clickSkip": True, "onComplete": "title"\}\)\n    jump vn_end_return/);
});

test('unnamed declarations, reordered parameters and transition defaults are accepted', () => {
  for (const text of ['@独立演出：允许点击跳过=否，停留=0.3', '@独立演出：，否，，纯色，，0.3']) {
    const parsed = applyTextScript(createProject(), '@等待：1\n' + text + '\n旁白：之后');
    assert.deepEqual(parsed.issues, []);
    const node = parsed.project.nodes.find(isStandaloneNode)!;
    assert.deepEqual(node.lines[0].playback, { clickSkip: false, transition: { mode: 'color', outDuration: .5, hold: .3, inDuration: .5, color: '#000000' } });
    assert.equal(parsed.project.nodes.filter(isStandaloneNode).length, 1);
  }
});

test('inline errors identify the declaration and do not partially consume its actions', () => {
  for (const value of ['允许点击跳过=可能', '结束后=暂停', '结束转场=推拉', '淡出=-1', '停留=61', '淡入=很久', '颜色=red', '未知=1', '允许点击跳过=是，允许点击跳过=否']) {
    const parsed = applyTextScript(createProject(), '@等待：1\n@独立演出：开场，' + value + '\n旁白：保留');
    assert.deepEqual(parsed.issues.filter(i => i.severity === 'error').map(i => i.sourceLine), [2], value);
    const dialogue = parsed.project.nodes.find(n => n.kind === 'passage' && n.lines.some(l => l.text === '保留'))!;
    assert.ok(dialogue.kind === 'passage'); assert.deepEqual(dialogue.lines[0].actions, [{ kind: 'pause', seconds: 1 }]);
  }
});

test('editing and clearing an inline override keeps neighbouring calls and blueprint defaults', () => {
  const parsed = applyTextScript(createProject(), '@章节进入演出文字版：标题=开场\n@独立演出：进入，允许点击跳过=是，结束转场=纯色\n\n// 原注释\n旁白：继续\n@等待：1\n@独立演出：片尾，结束后=返回标题');
  assert.deepEqual(parsed.issues, []);
  const [first, last] = parsed.project.nodes.filter(isStandaloneNode);
  const edited = stageEditedProject(parsed.project, draft => {
    const node = draft.nodes.find(n => n.id === first.id)!;
    assert.ok(isStandaloneNode(node)); delete node.lines[0].playback;
  })!;
  assert.ok(edited); assert.ok(edited.source.includes('// 原注释\n旁白：继续'));
  assert.match(edited.source, /@独立演出：进入\n/); assert.doesNotMatch(edited.source, /允许点击跳过|结束转场|@演出设置|@演出转场/);
  assert.deepEqual(edited.project.nodes.find(n => n.id === last.id), last);
  const restored = parseProject(JSON.parse(JSON.stringify(edited.project))).project;
  const firstRestored = restored.nodes.find(n => n.id === first.id)!;
  assert.ok(isStandaloneNode(firstRestored)); assert.equal(performancePlayback(restored, firstRestored.lines[0]).clickSkip, false);
  assert.equal(restored.scriptText?.playbackSyntax, 'inline');
});

test('load migration merges only standalone settings and preserves authored nodes and text', () => {
  const source = '@等待：1\r\n@演出设置：允许点击跳过=否\r\n\r\n// 保留注释\r\n@演出转场：纯色，0.2，0.1，0.4\r\n@独立演出：进入\r\n旁白：下一句\r\n@等待：2\r\n@演出设置：允许点击跳过=是\r\n旁白：台词的设置仍在这里';
  const project = applyTextScript(createProject(), source).project;
  project.scriptText!.content = source; delete project.scriptText!.playbackSyntax;
  const nodes = structuredClone(project.nodes);
  assert.equal(migratePlaybackSyntax(project), true);
  assert.deepEqual(project.nodes, nodes);
  const content = project.scriptText!.content;
  assert.match(content, /@独立演出：进入，允许点击跳过=否，结束转场=纯色/);
  assert.ok(content.includes('\r\n\r\n// 保留注释\r\n'));
  assert.ok(content.endsWith('@演出设置：允许点击跳过=是\r\n旁白：台词的设置仍在这里'));
  const restored = applyTextScript(project, content);
  assert.deepEqual(restored.issues, []); assert.deepEqual(restored.project.nodes, nodes);
  assert.equal(migratePlaybackSyntax(project), false); assert.equal(project.scriptText!.content, content);
  const saved = parseProject(projectSchema.parse(project)).project;
  assert.deepEqual(saved.nodes, nodes); assert.equal(saved.scriptText!.content, content);
});

test('old punctuation in module names is quoted during migration without splitting modules', () => {
  const name = '雨停了，天亮了';
  const project = applyTextScript(createProject(), '@等待：1\n' + standaloneText(name, { clickSkip: false })).project;
  const nodes = structuredClone(project.nodes);
  project.scriptText!.content = '@等待：1\n@演出设置：允许点击跳过=否\n@独立演出：' + name;
  delete project.scriptText!.playbackSyntax;
  assert.equal(migratePlaybackSyntax(project), true);
  assert.match(project.scriptText!.content, /@独立演出："雨停了，天亮了"，允许点击跳过=否/);
  const restored = applyTextScript(project, project.scriptText!.content);
  assert.deepEqual(restored.issues, []); assert.deepEqual(restored.project.nodes, nodes);
});

test('unfinished legacy drafts remain untouched by playback migration', () => {
  const project = createProject();
  project.scriptText = { format: 'vns-text-1', standaloneSyntax: 'module-names', performanceSyntax: 'explicit', content: '@等待：1\n@演出设置：允许点击跳过=\n@独立演出：进入' };
  const before = structuredClone(project);
  assert.equal(migratePlaybackSyntax(project), false); assert.deepEqual(project, before);
});

test('completion exposes unified settings and hides the separate legacy commands', () => {
  const project = createProject();
  const command = textAssistance(project, '@', 1, true)!;
  assert.ok(command.items.some(i => i.label === '独立演出'));
  assert.ok(!command.items.some(i => ['演出设置', '演出转场'].includes(i.label)));
  const source = '@独立演出：章节进入，允许点击跳过=';
  const assist = textAssistance(project, source, source.length, true)!;
  assert.equal(assist.signature?.name, '独立演出'); assert.equal(assist.parameterIndex, 1);
  assert.deepEqual(assist.items.map(i => i.label), ['是', '否']);
  assert.ok(assist.parameterEdits?.some(i => i.label === '结束转场'));
  assert.ok(!assist.signature?.parameters.some(i => i.name === '结束后'));
  assert.ok(!assist.parameterEdits?.some(i => i.label === '结束后'));
});

test('new positional playback parameters lead directly from skip to transition', () => {
  const parsed = applyTextScript(createProject(), '@等待：1\n@独立演出：开场，否，纯色，0.2，0.3，0.4，#102030\n旁白：继续');
  assert.deepEqual(parsed.issues, []);
  const node = parsed.project.nodes.find(isStandaloneNode)!;
  assert.deepEqual(node.lines[0].playback, { clickSkip: false, transition: { mode: 'color', outDuration: .2, hold: .3, inDuration: .4, color: '#102030' } });
  assert.doesNotMatch(projectToText(parsed.project), /结束后=/);
  assert.equal(parsed.project.nodes.find(n => n.id === node.next)?.kind, 'passage');
});

test('returning to the title is an explicit step after a standalone performance', () => {
  const source = '@等待：1\n@独立演出：片尾，允许点击跳过=是\n// 保留返回前的说明\n@返回标题界面';
  const parsed = applyTextScript(createProject(), source);
  assert.deepEqual(parsed.issues, []);
  const node = parsed.project.nodes.find(isStandaloneNode)!;
  assert.equal(node.lines[0].playback?.onComplete, undefined);
  assert.equal(parsed.project.nodes.find(n => n.id === node.next)?.kind, 'end');
  const edited = stageEditedProject(parsed.project, draft => {
    const changed = draft.nodes.find(n => n.id === node.id)!;
    assert.ok(isStandaloneNode(changed)); changed.lines[0].playback = { clickSkip: false };
  })!;
  assert.ok(edited.source.includes('// 保留返回前的说明\n@返回标题界面'));
  assert.equal(edited.project.nodes.find(n => n.id === node.next)?.kind, 'end');
  assert.doesNotMatch(compileProject(edited.project).files['game/story.rpy'], /"onComplete": "title"/);
});
