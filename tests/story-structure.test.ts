import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { currentScriptText } from '../src/core/script-text';
import { addStorySection, deleteStorySection, readStoryStructure } from '../src/core/story-structure';
import { applyTextScript } from '../src/core/text-script';

const source = '// 保留注释和排版\n# 章节：第一章【chapter_one】\n# 小章节：起点【scene_one】\n# 段落：开场【node_one】\n旁白：第一章结束。\n\n# 章节：第二章【chapter_two】\n# 小章节：相遇【scene_two】\n# 段落：相遇【node_two】\n旁白：第二章开始。\n';
const fixture = () => {
  const project = createProject();
  project.scriptText = currentScriptText(source);
  return project;
};

test('directory deletion uses unsaved text and preserves unrelated source verbatim', () => {
  for (const kind of ['chapter', 'scene'] as const) {
    const project = fixture();
    project.scriptText!.content = source.replace('第一章结束。', '未保存的新台词。');
    const original = structuredClone(project);
    const result = deleteStorySection(project, kind, kind === 'chapter' ? 'chapter_two' : 'scene_two');
    assert.deepEqual(project, original);
    assert.deepEqual(result.issues, []);
    assert.ok(result.project.scriptText!.content.startsWith(project.scriptText!.content.slice(0, project.scriptText!.content.indexOf('# 章节：第二章'))));
    assert.ok(!result.project.scenes.some(scene => scene.id === 'scene_two'));
    assert.ok(!result.project.nodes.some(node => node.id === 'node_two'));
    assert.equal(result.project.chapters.some(chapter => chapter.id === 'chapter_two'), kind === 'scene');
  }
});

test('带括号参数的章节与小章节仍可从目录删除，且保留相邻章节', () => {
  for (const kind of ['chapter', 'scene'] as const) {
    const project = fixture();
    project.scriptText!.content = source.replaceAll('# 章节：', '# 章节(显示名称="流程图:标题)尾部")：').replaceAll('# 小章节：', '# 小章节（流程图=是）：');
    const boundary = project.scriptText!.content.indexOf('# 章节(', 40);
    const result = deleteStorySection(project, kind, kind === 'chapter' ? 'chapter_two' : 'scene_two');
    assert.deepEqual(result.issues, []);
    assert.ok(result.project.scriptText!.content.startsWith(project.scriptText!.content.slice(0, boundary)));
    assert.ok(!result.project.scenes.some(scene => scene.id === 'scene_two'));
    assert.ok(!result.project.nodes.some(node => node.id === 'node_two'));
  }
});

test('a referenced deleted chapter cannot be resurrected by the import parser', () => {
  const project = fixture();
  project.scriptText!.content = source.replace('旁白：第一章结束。', '旁白：第一章结束。\n@调用：第二章【chapter_two】');
  const result = deleteStorySection(project, 'chapter', 'chapter_two');
  assert.ok(!result.project.chapters.some(chapter => chapter.id === 'chapter_two'));
  assert.ok(!result.project.nodes.some(node => node.id === 'node_two'));
  assert.ok(result.issues.some(issue => issue.message.includes('找不到跳转目标')));
  assert.ok(result.project.scriptText!.content.includes('@调用：第二章【chapter_two】'));
});

test('new chapters and scenes preserve pending prose edits and can be deleted immediately', () => {
  const project = fixture();
  const added = addStorySection(project, 'chapter', '新建章节');
  assert.deepEqual(added.issues, []);
  assert.ok(added.project.scriptText!.content.startsWith(source));
  const chapterId = added.project.scenes.find(scene => scene.id === added.sceneId)!.chapterId;
  const removed = deleteStorySection(added.project, 'chapter', chapterId);
  assert.ok(removed.project.scriptText!.content.startsWith(source));
  assert.ok(!removed.project.scenes.some(scene => scene.id === added.sceneId));
  const scene = addStorySection(project, 'scene', '新增小章节', 'chapter_one');
  assert.ok(scene.project.scriptText!.content.indexOf('新增小章节') < scene.project.scriptText!.content.indexOf('# 章节：第二章'));
  assert.ok(scene.project.scriptText!.content.endsWith(source.slice(source.indexOf('# 章节：第二章'))));
  assert.deepEqual(deleteStorySection(scene.project, 'scene', scene.sceneId).issues, []);
});

test('directory deletion protects the story entry and the final chapter', () => {
  assert.throws(() => deleteStorySection(fixture(), 'chapter', 'chapter_one'), /故事入口/);
  assert.throws(() => deleteStorySection(fixture(), 'scene', 'scene_one'), /故事入口/);
});

test('ordinary text flows across chapter headings and finishes after the final dialogue', () => {
  const { project, issues } = readStoryStructure(fixture());
  assert.deepEqual(issues, []);
  const first = project.nodes.find(node => node.id === 'node_one')!;
  const second = project.nodes.find(node => node.id === 'node_two')!;
  assert.equal(first.kind, 'passage'); assert.equal(second.kind, 'passage');
  if (first.kind === 'passage' && second.kind === 'passage') {
    assert.equal(first.next, second.id);
    assert.equal(project.nodes.find(node => node.id === second.next)?.kind, 'end');
  }
  for (const stop of ['@返回标题界面', '@跳转：无']) {
    const stopped = applyTextScript(fixture(), source.replace('旁白：第一章结束。', '旁白：第一章结束。\n' + stop));
    const node = stopped.project.nodes.find(node => node.id === 'node_one')!;
    assert.ok(!('next' in node) || node.next !== 'node_two');
  }
});
