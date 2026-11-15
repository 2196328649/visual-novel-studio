import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, newNode, type StoryNode } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';

function passage(id: string, sceneId: string, name: string, text: string): StoryNode {
  const node = newNode('passage', sceneId);
  if (node.kind !== 'passage') throw new Error('expected passage');
  node.id = id;
  node.name = name;
  node.lines[0] = { ...node.lines[0], id: `line_${id}`, text };
  return node;
}

test('projectToText preserves chapter, scene and node array order when source arrays are interleaved', () => {
  const project = createProject('交错顺序');
  project.chapters = [
    { id: 'chapter_a', name: '甲章' },
    { id: 'chapter_b', name: '乙章' },
  ];
  project.scenes = [
    { id: 'scene_b1', chapterId: 'chapter_b', name: '乙一' },
    { id: 'scene_a1', chapterId: 'chapter_a', name: '甲一' },
    { id: 'scene_b2', chapterId: 'chapter_b', name: '乙二' },
    { id: 'scene_a2', chapterId: 'chapter_a', name: '甲二' },
  ];
  project.nodes = [
    passage('node_a2_second', 'scene_a2', '甲二后', '甲二后句。'),
    passage('node_b2', 'scene_b2', '乙二段', '乙二句。'),
    passage('node_a1_second', 'scene_a1', '甲一后', '甲一后句。'),
    passage('node_b1', 'scene_b1', '乙一段', '乙一句。'),
    passage('node_a2_first', 'scene_a2', '甲二先', '甲二先句。'),
    passage('node_a1_first', 'scene_a1', '甲一先', '甲一先句。'),
  ];
  project.entryId = 'node_b1';

  const source = projectToText(project);
  const landmarks = [
    '# 章节：甲章【chapter_a】',
    '# 小章节：甲一【scene_a1】',
    '# 段落：甲一后【node_a1_second】',
    '# 段落：甲一先【node_a1_first】',
    '# 小章节：甲二【scene_a2】',
    '# 段落：甲二后【node_a2_second】',
    '# 段落：甲二先【node_a2_first】',
    '# 章节：乙章【chapter_b】',
    '# 小章节：乙一【scene_b1】',
    '# 段落：乙一段【node_b1】',
    '# 小章节：乙二【scene_b2】',
    '# 段落：乙二段【node_b2】',
  ];
  const positions = landmarks.map(landmark => source.indexOf(landmark));
  assert.ok(positions.every(position => position >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test('projectToText keeps first-match lookup fallbacks and first duplicate IDs', () => {
  const project = createProject('重复与缺失引用');
  project.chapters = [{ id: 'chapter_main', name: '主章' }];
  project.chapters[0].flowchart = { styleId: 'missing_style' };
  project.scenes = [
    { id: 'scene_main', chapterId: 'chapter_main', name: '主场景', baseSceneId: 'scene_base', blueprintId: 'missing_graph' },
    { id: 'scene_base', chapterId: 'chapter_main', name: '首个基础场景' },
    { id: 'scene_base', chapterId: 'chapter_main', name: '后续基础场景' },
  ];
  const first = passage('node_shared', 'scene_main', '首个模块', '第一句。');
  if (first.kind !== 'passage') throw new Error('expected passage');
  first.flowchart = { styleId: 'style_shared' };
  first.lines[0].speakerId = 'speaker_shared';
  first.lines[0].voiceId = 'asset_shared';
  const second = passage('node_shared', 'scene_main', '后续模块', '第二句。');
  project.nodes = [first, second];
  project.entryId = 'node_shared';
  project.characters = [
    { id: 'speaker_shared', name: '首个角色', color: '#ffffff', expressions: [] },
    { id: 'speaker_shared', name: '后续角色', color: '#000000', expressions: [] },
  ];
  project.assets = [
    { id: 'asset_shared', name: '首个声音', kind: 'audio', path: 'first.ogg' },
    { id: 'asset_shared', name: '后续声音', kind: 'audio', path: 'second.ogg' },
  ];
  project.ui.flowStyles = [
    { id: 'style_shared', name: '首个样式' },
    { id: 'style_shared', name: '后续样式' },
  ];

  const source = projectToText(project);
  assert.ok(source.includes('@入口：首个模块【node_shared】'));
  assert.ok(source.includes('@场景基础：首个基础场景【scene_base】'));
  assert.ok(source.includes('@场景蓝图：场景蓝图【missing_graph】'));
  assert.ok(source.includes('样式="首个样式【style_shared】"'));
  assert.ok(source.includes('样式="缺失样式【missing_style】"'));
  assert.ok(source.includes('@配音：首个声音【asset_shared】'));
  assert.ok(source.includes('首个角色：第一句。'));
  assert.ok(source.includes('后续角色：第二句。') === false);
  assert.ok(source.includes('旁白：第二句。'));

  project.entryId = 'missing_node';
  project.scenes[0].baseSceneId = 'missing_scene';
  project.nodes = [passage('node_missing_refs', 'scene_main', '缺少引用', '正文。')];
  const missing = projectToText(project);
  assert.ok(missing.includes('@入口：缺失节点【missing_node】'));
  assert.ok(missing.includes('@场景基础：基础场景【missing_scene】'));
  assert.ok(missing.includes('缺失样式【missing_style】'));
});

test('projectToText output remains byte-stable after a text-script round trip', () => {
  const project = createProject('文本往返');
  const passageNode = project.nodes.find(node => node.kind === 'passage');
  if (passageNode?.kind !== 'passage') throw new Error('expected initial passage');
  passageNode.lines[0].text = '保存后的对白。';

  const source = projectToText(project);
  const parsed = applyTextScript(project, source);
  assert.deepEqual(parsed.issues, []);
  assert.equal(projectToText(parsed.project), source);
});
