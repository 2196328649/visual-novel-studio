import { projectGraphs, addProjectGraphs } from '../src/core/project-resources';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, targets } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { isStandaloneNode, performancePlayback } from '../src/core/standalone-performance';
import { editablePerformanceTarget } from '../src/core/performance-workspace';
import { compileProject } from '../src/runtime/compiler';
import { endingPerformanceId } from '../src/core/builtin-performances';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { performanceTimeline } from '../src/core/performance-timeline';
import { performanceTiming } from '../src/core/performance-timing';
import { textDocument } from '../src/core/text-document';
import { stageEditedProject } from '../src/core/stage-edit';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';

test('standalone playback settings and readable ending unlocks survive text, graph conversion and save', () => {
  const project = createProject();
  project.assets.push({ id: 'cg', kind: 'image', name: '雨后 CG', path: 'assets/cg.png' });
  const parsed = applyTextScript(project, '@章节进入演出文字版：标题=第一章，右侧字=雨后，时长=2\n@演出设置：允许点击跳过=否\n@演出转场：纯色，0.4，0.2，0.7，#000000\n@独立演出：章节进入\n旁白：章节之后。\n@解锁素材：雨后 CG\n@等待：1\n@演出设置：允许点击跳过=是，结束后=返回标题\n@独立演出：片尾\n@返回标题');
  assert.deepEqual(parsed.issues, []);
  const scenes = parsed.project.nodes.filter(isStandaloneNode);
  assert.equal(scenes.length, 2);
  assert.equal(performancePlayback(parsed.project, scenes[0].lines[0]).clickSkip, false);
  assert.deepEqual(scenes[0].lines[0].playback?.transition, { mode: 'color', outDuration: .4, hold: .2, inDuration: .7, color: '#000000' });
  const target = editablePerformanceTarget(parsed.project, { nodeId: scenes[0].id, lineId: scenes[0].lines[0].id });
  assert.ok(target.graphId);
  const saved = projectSchema.parse(parsed.project), text = projectToText(saved);
  assert.doesNotMatch(text, /@实例：/);
  assert.match(text, /@解锁素材：雨后 CG/);
  assert.match(text, /@返回标题界面/);
  assert.doesNotMatch(text, /@解锁CG/);
  const restored = applyTextScript(saved, text);
  assert.deepEqual(restored.issues, []);
  assert.deepEqual(restored.project.nodes, saved.nodes);
  const compiled = compileProject(restored.project);
  assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), []);
  const story = compiled.files['game/story.rpy'];
  assert.match(story, /vn_performance_begin\(\{"clickSkip": False/);
  assert.match(story, /vn_performance_finish\(\{"clickSkip": True, "onComplete": "title"\}\)\n    jump vn_end_return/);
});

test('chapter defaults remain protected through nested blueprint calls and explicit overrides win', () => {
  const project = createProject();
  const parsed = applyTextScript(project, '@章节进入演出文字版：标题=进入，右侧字=副标题，时长=1\n@独立演出\n旁白：之后。');
  const chapter = parsed.project.nodes.find(isStandaloneNode)!;
  editablePerformanceTarget(parsed.project, { nodeId: chapter.id, lineId: chapter.lines[0].id });
  const line = { ...chapter.lines[0], playback: undefined };
  assert.equal(performancePlayback(parsed.project, line).clickSkip, false);
  assert.equal(performancePlayback(parsed.project, { ...line, playback: { clickSkip: true } }).clickSkip, true);
  assert.equal(performancePlayback(project, { actions: [{ kind: 'pause', seconds: 1 }] }).clickSkip, true);
});

test('malformed transition settings and unknown unlocks report source lines', () => {
  const result = applyTextScript(createProject(), '@演出转场：纯色，-1\n@等待：1\n@独立演出：进入\n@返回标题\n@解锁CG：missing');
  assert.deepEqual(result.issues.filter(i => i.severity === 'error').map(i => i.sourceLine), [1, 5]);
});

test('chapter playback settings without a declaration belong to the dialogue call', () => {
  const result = applyTextScript(createProject(), '@章节进入演出文字版：标题=进入，右侧字=副标题，时长=1\n@演出设置：允许点击跳过=否\n@演出转场：纯色，0.4，0.2，0.7，#000000\n旁白：之后。\n@等待：1\n@独立演出：下一段\n@返回标题');
  assert.deepEqual(result.issues, []);
  const chapter = result.project.nodes.find(node => node.kind === 'passage' && node.lines[0].actions[0]?.kind === 'blueprint')!;
  assert.equal(chapter.kind, 'passage');
  if (chapter.kind !== 'passage') return;
  assert.equal(chapter.lines[0].playback?.clickSkip, false);
  assert.equal(chapter.lines[0].playback?.transition?.mode, 'color');
  for (const node of result.project.nodes) {
    if (node.kind === 'passage' && node.id !== chapter.id) assert.equal(node.lines[0].playback, undefined);
  }
});

test('returning to title completes a standalone passage without requiring an outgoing link', () => {
  const project = createProject(), passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines = [{ id: 'ending', text: '', silent: true, actions: [{ kind: 'pause', seconds: .5 }], playback: { onComplete: 'title' } }];
  delete passage.next;
  project.nodes = project.nodes.filter(node => node.kind !== 'end');
  assert.deepEqual(targets(passage), []);
  assert.deepEqual(compileProject(project).diagnostics.filter(d => d.severity === 'error'), []);
  assert.match(compileProject(project).files['game/story.rpy'], /vn_performance_finish\([^\n]+\)\n    jump vn_end_return/);
});

test('ending is an ordinary editable timeline followed by a separate return-title command', () => {
  const original = createProject(), before = structuredClone(original);
  const parsed = applyTextScript(original, '@结局演出\n@独立演出：结局\n@返回标题界面');
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(original, before);
  const graph = projectGraphs(parsed.project).find(graph => graph.id === endingPerformanceId)!;
  assert.equal(graph.timelineComponent, true);
  assert.equal(performanceTimeline(parsed.project, graph).until, 3.6);
  const commands = textDocument(projectToText(parsed.project)).text.split('\n').filter(line => /^@/.test(line));
  assert.deepEqual(commands.filter(line => /结局演出|返回标题|独立演出|@结局[:：]/.test(line)), ['@结局演出', '@独立演出：结局', '@返回标题界面']);
  const restored = applyTextScript(projectSchema.parse(parsed.project), projectToText(parsed.project));
  assert.deepEqual(restored.issues, []);
  assert.deepEqual(restored.project.nodes, parsed.project.nodes);
  assert.equal(projectGraphs(restored.project).filter(graph => graph.id === endingPerformanceId).length, 1);
  const context = previewActionContext(parsed.project);
  const actions = expandPreviewActions(parsed.project, [{ kind: 'blueprint', blueprintId: endingPerformanceId, inputs: { caption: '未完待续', duration: 1.2 } }], context);
  assert.equal(context.incomplete, false);
  assert.deepEqual(performanceTiming(actions), { at: 1.2, until: 1.2 });
  assert.equal(actions.find(action => action.kind === 'visual' && action.content === 'text')?.kind, 'visual');
  const compiled = compileProject(restored.project);
  assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), []);
  assert.match(compiled.files['game/story.rpy'], /call vn_blueprint_builtin_ending_performance/);
  const story = compiled.files['game/story.rpy'];
  assert.doesNotMatch(story.slice(story.indexOf('label start:'), story.indexOf('label vn_finish:')), /call screen vn_ending\(/);
});

test('editing call playback patches its settings without losing prose or adjacent calls', () => {
  for (const changeActions of [false, true]) {
    const source = '@等待：1\n@演出设置：允许点击跳过=是\n\n// 保留这段注释。\n@演出转场：纯色，0.4，0.2，0.7，#000000\n@独立演出：开场\n\n旁白：保留原文和空行。\n\n@等待：2\n@演出设置：允许点击跳过=否\n@独立演出：后续\n@返回标题界面';
    const parsed = applyTextScript(createProject(), source);
    assert.deepEqual(parsed.issues, []);
    const [first, second] = parsed.project.nodes.filter(isStandaloneNode);
    const playback = { clickSkip: false, transition: { mode: 'dissolve' as const, outDuration: .2, hold: 0, inDuration: .4, color: '#102030' } };
    const edited = stageEditedProject(parsed.project, draft => {
      const node = draft.nodes.find(node => node.id === first.id)!;
      assert.ok(isStandaloneNode(node));
      node.lines[0].playback = playback;
      if (changeActions) node.lines[0].actions = [{ kind: 'pause', seconds: 1.5 }];
    })!;
    assert.ok(edited);
    assert.equal(parsed.project.scriptText!.content, source);
    assert.ok(edited.source.includes('\n\n// 保留这段注释。\n'));
    assert.ok(edited.source.endsWith(source.slice(source.indexOf('旁白：保留原文'))));
    assert.equal(edited.source.match(/@演出设置：/g)?.length, 1);
    assert.doesNotMatch(edited.source, /@演出转场：/);
    assert.match(edited.source, /@独立演出：开场，允许点击跳过=否，结束转场=溶解/);
    const restored = applyTextScript(projectSchema.parse(JSON.parse(JSON.stringify(edited.project))), edited.source);
    assert.deepEqual(restored.issues, []);
    const saved = restored.project.nodes.find(node => node.id === first.id)!;
    assert.ok(isStandaloneNode(saved));
    assert.deepEqual(saved.lines[0].playback, playback);
    assert.deepEqual(saved.lines[0].actions, [{ kind: 'pause', seconds: changeActions ? 1.5 : 1 }]);
    assert.deepEqual(restored.project.nodes.find(node => node.id === second.id), second);
  }
});

test('removing a call override restores graph defaults and adding it again stays on that call', () => {
  const project = createProject();
  const graph = blueprintFromPerformance(project, [{ kind: 'pause', seconds: 1 }], '共享片段');
  graph.performanceKind = 'standalone'; graph.playback = { clickSkip: false };
  addProjectGraphs(project, graph);
  const parsed = applyTextScript(project, '@共享片段\n@演出设置：允许点击跳过=是\n@独立演出：第一次\n@共享片段\n@演出设置：允许点击跳过=是\n@演出转场：溶解，0.2，0，0.3\n@独立演出：第二次\n@返回标题界面');
  assert.deepEqual(parsed.issues, []);
  const [first, second] = parsed.project.nodes.filter(isStandaloneNode);
  assert.ok(first && second);
  const cleared = stageEditedProject(parsed.project, draft => {
    const node = draft.nodes.find(node => node.id === second.id)!;
    assert.ok(isStandaloneNode(node)); delete node.lines[0].playback;
  })!;
  assert.ok(cleared);
  assert.equal(cleared.source.match(/@演出设置：/g)?.length, 1);
  assert.doesNotMatch(cleared.source, /@演出转场/);
  const restored = applyTextScript(projectSchema.parse(JSON.parse(JSON.stringify(cleared.project))), cleared.source);
  assert.deepEqual(restored.issues, []);
  const call = restored.project.nodes.find(node => node.id === second.id)!;
  assert.ok(isStandaloneNode(call)); assert.equal(call.lines[0].playback, undefined);
  assert.equal(performancePlayback(restored.project, call.lines[0]).clickSkip, false);
  assert.deepEqual(restored.project.nodes.find(node => node.id === first.id), first);
  const changed = stageEditedProject(restored.project, draft => {
    const node = draft.nodes.find(node => node.id === second.id)!;
    assert.ok(isStandaloneNode(node)); node.lines[0].playback = { clickSkip: true };
  })!;
  assert.ok(changed);
  const saved = changed.project.nodes.find(node => node.id === second.id)!;
  assert.ok(isStandaloneNode(saved)); assert.deepEqual(saved.lines[0].playback, { clickSkip: true });
  assert.deepEqual(changed.project.nodes.find(node => node.id === first.id), first);
  assert.deepEqual(projectGraphs(changed.project).find(item => item.id === graph.id)!.playback, graph.playback);
});

test('new playback settings can be appended to a final explicit standalone call', () => {
  const parsed = applyTextScript(createProject(), '@结局演出\n@独立演出：片尾');
  const node = parsed.project.nodes.find(isStandaloneNode)!;
  const edited = stageEditedProject(parsed.project, draft => {
    const call = draft.nodes.find(item => item.id === node.id)!;
    assert.ok(isStandaloneNode(call)); call.lines[0].playback = { clickSkip: false };
  })!;
  assert.ok(edited); assert.match(edited.source, /@独立演出：片尾，允许点击跳过=否/);
  const restored = applyTextScript(edited.project, edited.source);
  assert.deepEqual(restored.issues, []);
  const saved = restored.project.nodes.find(item => item.id === node.id)!;
  assert.ok(isStandaloneNode(saved)); assert.equal(saved.lines[0].playback?.clickSkip, false);
});

test('chapter edits and conversion to a timeline preserve exactly one copy of playback settings', () => {
  for (const declaration of ['\n@独立演出', '\n@独立演出：章节进入']) for (const convert of [false, true]) {
    const parsed = applyTextScript(createProject(), '@章节进入演出文字版：标题=第一章，右侧字=雨后，时长=2\n@演出设置：允许点击跳过=否\n@演出转场：纯色，0.4，0.2，0.7，#000000' + declaration + '\n旁白：章节之后。');
    assert.deepEqual(parsed.issues, []);
    const chapter = parsed.project.nodes.find(isStandaloneNode)!;
    const edited = stageEditedProject(parsed.project, draft => {
      if (convert) editablePerformanceTarget(draft, { nodeId: chapter.id, lineId: chapter.lines[0].id });
      const node = draft.nodes.find(node => node.id === chapter.id)!;
      assert.ok(isStandaloneNode(node));
      node.lines[0].playback = { clickSkip: true, transition: { mode: 'dissolve', outDuration: .2, hold: 0, inDuration: .3, color: '#ffffff' } };
      if (!convert) {
        const action = node.lines[0].actions[0]; assert.equal(action.kind, 'blueprint');
        if (action.kind === 'blueprint') action.inputs = { ...action.inputs, title: '新的章节标题' };
      }
    })!;
    assert.ok(edited);
    assert.doesNotMatch(edited.source, /@演出(?:设置|转场)：/);
    assert.equal(edited.source.match(/允许点击跳过=是/g)?.length, 1);
    assert.equal(edited.source.match(/结束转场=溶解/g)?.length, 1);
    const restored = applyTextScript(projectSchema.parse(JSON.parse(JSON.stringify(edited.project))), edited.source);
    assert.deepEqual(restored.issues, []);
    const saved = restored.project.nodes.find(node => node.id === chapter.id)!;
    assert.ok(isStandaloneNode(saved));
    assert.deepEqual(saved.lines[0].playback, { clickSkip: true, transition: { mode: 'dissolve', outDuration: .2, hold: 0, inDuration: .3, color: '#ffffff' } });
    const dialogue = restored.project.nodes.find(node => node.kind === 'passage' && !node.lines[0].silent)!;
    assert.ok(dialogue.kind === 'passage'); assert.equal(dialogue.lines[0].text, '章节之后。'); assert.equal(dialogue.lines[0].playback, undefined);
  }
});
