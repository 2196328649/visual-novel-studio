import { addProjectGraphs, projectGraphs } from '../src/core/project-resources';
import { chapterBlueprintPair, createChapterPerformance } from '../src/core/chapter-performances';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { performanceTiming } from '../src/core/performance-timing';
import type { BlueprintGraph, Project } from '../src/core/model';
const duration = (project: Project, graph: BlueprintGraph) => performanceTiming(expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], previewActionContext(project))).until;
import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, projectSchema } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { bindPerformanceBlueprint, editablePerformanceTarget, performanceKind, performanceTargetAt, performanceWorkspaceDraft, targetPerformance } from '../src/core/performance-workspace';
import { isStandaloneNode, standaloneChapter } from '../src/core/standalone-performance';
import { parseProject } from '../src/desktop/project-store';
import { renameBlueprint } from '../src/core/blueprint-names';
import { stageEditedProject } from '../src/core/stage-edit';
import { compileProject } from '../src/runtime/compiler';
import { performanceTimeline, arrangePerformanceTimeline } from '../src/core/performance-timeline';

function chapterTextFixture() {
  const base = createProject('章节文本');
  base.assets.push(
    { id: 'chapter_bg', kind: 'image', name: '章节进场 · 夜宴庭院', path: 'assets/bg.png', category: 'scene' },
    { id: 'chapter_title', kind: 'image', name: '章节题字 · 记第一回 醉梦', path: 'assets/title.png', category: 'ui' },
    { id: 'chapter_music', kind: 'audio', name: '花街柳巷', path: 'assets/music.ogg', category: 'bgm' },
  );
  addProjectGraphs(base, ...chapterBlueprintPair(createChapterPerformance(base, 'text', { kind: 'chapter', title: '第一章', subtitle: '', duration: 7, backgroundId: 'chapter_bg', soundId: 'chapter_music' })));
  const source = '# 段落：第一章\n@章节进入演出文字版：标题=第一章 · 酒醒城破，右侧字=据原剧情「记·第一回」「忆·第一回」节选改编，时长=7，章节背景=章节进场 · 夜宴庭院，章节音效=花街柳巷\n@独立演出\n旁白：城门开了。';
  const parsed = applyTextScript(base, source);
  assert.deepEqual(parsed.issues, []);
  const chapter = parsed.project.nodes.find(isStandaloneNode)!;
  assert.ok(chapter);
  return { parsed, chapter, source };
}

test('逐个编辑演出只替换当前动作，保留相邻动作、调用参数与故事连接', () => {
  const { parsed, chapter } = chapterTextFixture();
  const project = parsed.project, line = chapter.lines[0], next = chapter.next;
  const before = { kind: 'pause' as const, seconds: 1 }, after = { kind: 'shake' as const, direction: 'horizontal' as const, duration: .3, amplitude: 10, wait: true };
  line.actions = [before, ...line.actions, after];
  const target = editablePerformanceTarget(project, { nodeId: chapter.id, lineId: line.id, actionIndex: 1 });
  assert.equal(line.actions.length, 3);
  assert.deepEqual(line.actions[0], before); assert.deepEqual(line.actions[2], after);
  assert.equal(chapter.next, next);
  assert.equal(target.actionIndex, 1);
  assert.deepEqual(targetPerformance(project, target), [line.actions[1]]);
  const graph = projectGraphs(project).find(graph => graph.id === target.graphId)!;
  assert.equal(duration(project, graph), 7);
  assert.equal(line.actions[1].kind, 'blueprint');
  if (line.actions[1].kind === 'blueprint') line.actions[1].inputs = { title: '本次标题' };
  const snapshot = JSON.stringify(project);
  assert.equal(editablePerformanceTarget(project, { nodeId: chapter.id, lineId: line.id, actionIndex: 1 }).graphId, graph.id);
  assert.equal(JSON.stringify(project), snapshot);
  assert.throws(() => editablePerformanceTarget(project, { nodeId: chapter.id, lineId: line.id, actionIndex: 9 }), /不存在/);
});

test('章节蓝图配合显式声明成为独立演出，保留素材、时长及后续对白，并映射到同一编辑目标', () => {
  const { parsed, chapter, source } = chapterTextFixture();
  const call = chapter.lines[0].actions[0]; assert.ok(call.kind === 'blueprint');
  const action = { title: call.inputs?.title, subtitle: call.inputs?.right_text, duration: call.inputs?.duration, backgroundId: call.inputs?.background, soundId: call.inputs?.sound };
  assert.equal(action.title, '第一章 · 酒醒城破');
  assert.equal(action.subtitle, '据原剧情「记·第一回」「忆·第一回」节选改编');
  assert.equal(action.duration, 7);
  assert.deepEqual([action.backgroundId, action.soundId], ['chapter_bg', 'chapter_music']);
  const following = parsed.project.nodes.find(node => node.id === chapter.next);
  assert.ok(following?.kind === 'passage');
  assert.equal(following.lines[0].text, '城门开了。');
  assert.ok(!following.lines[0].silent);
  for (let line = 2; line <= 3; line++) assert.deepEqual(performanceTargetAt(parsed, line), { nodeId: chapter.id, lineId: chapter.lines[0].id, graphId: call.blueprintId });
  const reread = applyTextScript(parsed.project, source);
  assert.deepEqual(reread.project.nodes, parsed.project.nodes);
  const serialized = projectToText(parsed.project);
  assert.equal((serialized.match(/@章节进入演出文字版/g) ?? []).length, 1);
  assert.deepEqual(applyTextScript(parsed.project, serialized).project.nodes, parsed.project.nodes);
});

test('编辑独立演出时创建并复用七秒时间轴，文本和存档保持同一节点及连接', () => {
  const { parsed, chapter, source } = chapterTextFixture();
  parsed.project.scriptText = { ...parsed.project.scriptText!, content: source };
  let target = { nodeId: chapter.id, lineId: chapter.lines[0].id, graphId: undefined as string | undefined };
  const edited = stageEditedProject(parsed.project, draft => { target = { ...target, ...editablePerformanceTarget(draft, target) }; projectGraphs(draft).find(graph => graph.id === target.graphId)!.name = '编辑后的章节'; })!;
  assert.ok(edited);
  const graph = projectGraphs(edited.project).find(graph => graph.id === target.graphId)!;
  assert.equal(graph.timeline, undefined);
  assert.equal(duration(edited.project, graph), 7);
  const count = projectGraphs(edited.project).length;
  assert.deepEqual(editablePerformanceTarget(edited.project, { nodeId: chapter.id }), target);
  assert.equal(projectGraphs(edited.project).length, count);
  const saved = parseProject(JSON.parse(JSON.stringify(edited.project)));
  assert.equal(saved.migrated, false);
  const replay = applyTextScript(saved.project, edited.source);
  assert.deepEqual(replay.issues, []);
  const restored = replay.project.nodes.find(node => node.id === chapter.id)!;
  assert.ok(isStandaloneNode(restored));
  assert.equal(restored.lines[0].id, chapter.lines[0].id);
  assert.equal(restored.next, chapter.next);
  assert.equal(replay.project.nodes.length, parsed.project.nodes.length);
  assert.deepEqual(restored.lines[0].actions, chapter.lines[0].actions);
});

test('viewing a legacy chapter timeline leaves source and data unchanged until its first edit', () => {
  const { parsed, chapter, source } = chapterTextFixture();
  const before = structuredClone(parsed.project), target = { nodeId: chapter.id, lineId: chapter.lines[0].id };
  const workspace = performanceWorkspaceDraft(parsed.project, target);
  assert.deepEqual(parsed.project, before);
  assert.equal(parsed.project.scriptText!.content, source);
  const graph = projectGraphs(workspace.project).find(graph => graph.id === workspace.target?.graphId)!;
  assert.ok(graph); assert.equal(duration(workspace.project, graph), 7);
  const secondView = performanceWorkspaceDraft(parsed.project, target);
  assert.deepEqual(parsed.project, before);
  assert.equal(secondView.project.nodes.length, before.nodes.length);
  const edited = stageEditedProject(parsed.project, draft => {
    workspace.materialize(draft);
    const input = projectGraphs(draft).find(item => item.id === graph.id)!.exposedInputs.find(pin => pin.id === 'duration')!;
    input.defaultValue = 9;
    const node = draft.nodes.find(node => node.id === chapter.id)!; if (node.kind === 'passage' && node.lines[0].actions[0].kind === 'blueprint') delete node.lines[0].actions[0].inputs?.duration;
  })!;
  assert.ok(edited);
  const saved = applyTextScript(projectSchema.parse(JSON.parse(JSON.stringify(edited.project))), edited.source);
  assert.deepEqual(saved.issues, []);
  const call = saved.project.nodes.find(node => node.id === chapter.id)!;
  assert.ok(isStandaloneNode(call)); assert.equal(call.next, chapter.next); assert.equal(call.lines[0].id, chapter.lines[0].id);
  const savedGraph = projectGraphs(saved.project).find(item => item.id === graph.id)!;
  assert.equal(savedGraph.exposedInputs.find(pin => pin.id === 'duration')!.defaultValue, 9);
  assert.equal(duration(saved.project, savedGraph), 9);
  assert.equal(performanceWorkspaceDraft(saved.project, target).project, saved.project);
  assert.deepEqual(parsed.project, before);
});

test('a legacy chapter draft retains its preview line identity when playback is edited', () => {
  const project = createProject('Legacy chapter');
  project.nodes.push({ id: 'legacy_chapter', name: 'Chapter', kind: 'chapterTitle', sceneId: project.scenes[0].id, x: 0, y: 0, title: 'Title', subtitle: '', duration: 7, next: project.entryId });
  const before = structuredClone(project);
  const workspace = performanceWorkspaceDraft(project, { nodeId: 'legacy_chapter' });
  const preview = workspace.project.nodes.find(node => node.id === 'legacy_chapter');
  assert.ok(isStandaloneNode(preview));
  const edited = structuredClone(project);
  workspace.materialize(edited);
  const line = edited.nodes.find(node => node.kind === 'passage' && node.id === 'legacy_chapter');
  assert.ok(isStandaloneNode(line));
  assert.equal(line.lines[0].id, preview.lines[0].id);
  line.lines[0].playback = { clickSkip: true };
  const snapshot = structuredClone(edited);
  workspace.materialize(edited);
  assert.deepEqual(edited, snapshot);
  assert.deepEqual(project, before);
  const reopened = performanceWorkspaceDraft(edited, { nodeId: 'legacy_chapter' });
  assert.equal(reopened.project, edited);
  assert.equal(reopened.target?.graphId, workspace.target?.graphId);
});

test('旧工程加载自动迁移章节并标记备份，重复加载不生成重复演出', () => {
  const project = createProject('旧工程');
  const legacy = { id: 'old_chapter', name: '第一章', kind: 'chapterTitle' as const, sceneId: project.scenes[0].id, x: 415, y: -70, textHeading: false, title: '章名', subtitle: '副标题', duration: 7, next: project.entryId };
  project.nodes.push(legacy);
  const loaded = parseProject(project);
  assert.equal(loaded.migrated, true);
  const chapter = loaded.project.nodes.find(node => node.id === legacy.id)!;
  assert.ok(isStandaloneNode(chapter));
  assert.deepEqual([chapter.name, chapter.sceneId, chapter.x, chapter.y, chapter.next, chapter.textHeading], [legacy.name, legacy.sceneId, 415, -70, legacy.next, false]);
  assert.equal(performanceTimeline(loaded.project, projectGraphs(loaded.project).find(graph => chapter.lines[0].actions[0].kind === 'blueprint' && graph.id === chapter.lines[0].actions[0].blueprintId)!).until, 7);
  assert.equal(loaded.project.nodes.length, project.nodes.length);
  assert.equal(project.nodes.at(-1)?.kind, 'chapterTitle');
  const reloaded = parseProject(loaded.project);
  assert.equal(reloaded.migrated, false);
  assert.deepEqual(reloaded.project.nodes, loaded.project.nodes);
});

test('独立演出与同段后续台词在文本回写和舞台编辑后仍分别执行', () => {
  const base = createProject('独立演出');
  const source = '# 段落：开场\n@等待：2\n@独立演出\n旁白：下一句\n@等待：1\n旁白：配合台词';
  const parsed = applyTextScript(base, source);
  assert.deepEqual(parsed.issues, []);
  const lines = parsed.project.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []);
  assert.deepEqual(lines.map(line => [!!line.silent, line.text, line.actions.length]), [[true, '', 1], [false, '下一句', 0], [false, '配合台词', 1]]);
  parsed.project.scriptText = { ...parsed.project.scriptText!, content: source };
  const edited = stageEditedProject(parsed.project, draft => {
    const node = draft.nodes.find(node => node.kind === 'passage')!;
    if (node.kind === 'passage') node.lines[0].actions = [{ kind: 'pause', seconds: 3 }];
  })!;
  assert.ok(edited);
  const replay = applyTextScript(edited.project, projectToText(edited.project));
  assert.deepEqual(replay.issues, []);
  const next = replay.project.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []);
  assert.deepEqual(next.map(line => [!!line.silent, line.text, line.actions.length]), lines.map(line => [!!line.silent, line.text, line.actions.length]));
  assert.deepEqual(next[0].actions, [{ kind: 'pause', seconds: 3 }]);
  const compiled = compileProject(replay.project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  const output = Object.values(compiled.files).join('\n');
  assert.match(output, /vn_performance_begin[\s\S]{0,500}pause 3/);
  assert.doesNotMatch(output, /window hide/);
});

test('独立演出支持按名称调用、重命名以及工程保存', () => {
  const project = createProject('调用');
  const graph = blueprintFromPerformance(project, [{ kind: 'pause', seconds: 2 }], '过场');
  graph.performanceKind = 'standalone'; addProjectGraphs(project, graph);
  project.scriptText = { format: 'vns-text-1', content: '# 段落：开场\n@过场\n@独立演出：过场模块\n旁白：后来' };
  renameBlueprint(project, graph.id, { name: '新的过场' });
  assert.match(project.scriptText.content, /@新的过场【/);
  assert.match(project.scriptText.content, /@独立演出：过场模块/);
  const parsed = applyTextScript(projectSchema.parse(project), project.scriptText.content);
  assert.deepEqual(parsed.issues, []);
  const lines = parsed.project.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []);
  assert.equal(lines[0].silent, true); assert.equal(lines[1].text, '后来'); assert.equal(lines[1].actions.length, 0);
  assert.deepEqual(lines[0].actions, [{ kind: 'blueprint', blueprintId: graph.id }]);
  assert.equal(performanceKind(projectGraphs(parsed.project)[0]), 'standalone');
});

test('章节七秒演出转为独立时间轴后保留入口、连接、标题与播放时长', () => {
  const parsed = applyTextScript(createProject('章节'), '# 段落：开章\n@章节进入演出文字版：标题=第一章 · 酒醒城破，右侧字=节选改编，时长=7\n@独立演出\n旁白：城门开了。');
  assert.deepEqual(parsed.issues, []);
  const project = parsed.project;
  project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
  const chapter = project.nodes.find(node => node.kind === 'passage' && node.lines[0]?.silent)!;
  const next = 'next' in chapter ? chapter.next : undefined;
  const target = { nodeId: chapter.id };
  const graph = blueprintFromPerformance(project, targetPerformance(project, target), '开章演出');
  const converted = stageEditedProject(project, draft => {
    assert.ok(performanceTimeline(draft, graph).reason, 'compound blueprint remains a graph');
    bindPerformanceBlueprint(draft, target, graph, '独立演出');
  })!;
  assert.ok(converted);
  const node = converted.project.nodes.find(node => node.id === chapter.id)!;
  assert.equal(node.kind, 'passage'); assert.equal('next' in node && node.next, next);
  assert.equal(converted.project.entryId, project.entryId);
  assert.equal(node.kind === 'passage' && node.lines[0].silent, true);
  const saved = projectGraphs(converted.project).find(item => item.id === graph.id)!;
  assert.equal(performanceKind(saved), 'standalone');
  assert.equal(duration(converted.project, saved), 7);
  assert.ok(saved.nodes.some(node => node.type === 'callFunction'));
});
