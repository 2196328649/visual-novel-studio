import { createShowCharacterFixture } from '../scripts/lib/show-character-fixture';
import { chapterBlueprintPair, createChapterPerformance } from '../src/core/chapter-performances';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type Project } from '../src/core/model';
import { addPerformanceToLines, assignBlueprintGroup, blueprintFromPerformance, blueprintGroup, exposePerformanceInputs, performanceFromText, performanceInputs } from '../src/core/blueprint-authoring';
import { actionText, applyTextScript, projectToText, textCommandAction } from '../src/core/text-script';
import { editTextDocument, textDocument } from '../src/core/text-document';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { linePlaybackAudio, linePlaybackPlan, linePreviewSnapshot } from '../src/core/line-preview';
import { textAssistance } from '../src/core/text-completion';
import { compileProject } from '../src/runtime/compiler';
import { validateProject } from '../src/core/validate';

function fixture(): Project {
  const project = createProject();
  project.assets = [{ id: 'night', name: '庭院', kind: 'image', path: 'assets/night.png', category: 'scene' }, { id: 'title', name: '记第一回', kind: 'image', path: 'assets/title.png', category: 'ui' }, { id: 'music', name: '花街柳巷', kind: 'audio', path: 'assets/music.ogg', category: 'bgm' }, { id: 'happy', name: '苏怜烟笑', kind: 'image', path: 'assets/happy.png', category: 'portrait' }, { id: 'sad', name: '苏怜烟忧', kind: 'image', path: 'assets/sad.png', category: 'portrait' }];
  project.characters = [{ id: 'sulianyan', name: '苏怜烟', color: '#ffaa99', defaultExpressionId: 'worried', expressions: [{ id: 'normal', name: '通常', assetId: 'happy' }, { id: 'worried', name: '担忧', assetId: 'sad' }] }, { id: 'no_portrait', name: '路人', color: '#ffffff', expressions: [] }];
  return project;
}
test('stored chapter actions retain parameterized graph execution during migration', () => {
  const project = fixture();
  const actions = [{ kind: 'chapter' as const, title: '第一章', subtitle: '酒醒城破', duration: 4.2, backgroundId: 'night', titleImageId: 'title', soundId: 'music' }];
  assert.equal(actions.length, 1);
  const graph = blueprintFromPerformance(project, actions, '章节入场');
  exposePerformanceInputs(graph, performanceInputs(graph)); project.blueprints.push(graph);
  assignBlueprintGroup(project, graph.id, '演出 / 章节 / 入场'); assert.equal(blueprintGroup(project, graph.id), '演出 / 章节 / 入场');
  assert.deepEqual(validateProject(project).filter(issue => issue.severity === 'error'), []);
  const duration = graph.exposedInputs.find(pin => pin.name === '时长')!;
  const call = textCommandAction(project, `@蓝图：章节入场，时长=1.2`, true)!;
  assert.deepEqual(call, { kind: 'blueprint', blueprintId: graph.id, inputs: { [duration.id]: 1.2 } });
  const context = previewActionContext(project), expanded = expandPreviewActions(project, [call], context);
  assert.deepEqual(expanded, [{ ...actions[0], duration: 1.2, effect: undefined, wait: true }]); assert.equal(context.incomplete, false);
  const passage = project.nodes.find(node => node.kind === 'passage')!; passage.lines[0].actions = [call]; passage.lines[0].text = '天亮了。';
  const snapshot = linePreviewSnapshot(project, { nodeId: passage.id, lineId: passage.lines[0].id });
  assert.equal(linePlaybackPlan(snapshot.before, snapshot.actions).dialogueAt, 1200);
  assert.equal(snapshot.after.musicId, undefined); assert.ok(linePlaybackAudio(snapshot.before, linePlaybackPlan(snapshot.before, snapshot.actions)).some(event => event.channel === 'sound' && event.id === 'music')); assert.equal(snapshot.after.backgroundId, undefined);
  const compiled = compileProject(project); assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.match(compiled.files['game/story.rpy'], /call screen vn_chapter_title\(title=vn_bp_in_/);
  assert.match(compiled.files['game/story.rpy'], new RegExp(`vn_bp_in_${graph.id}_${duration.id}=1.2`));
});

test('chapter blueprint encapsulation accepts named and quoted resources and rejects retired directives', () => {
  const project = fixture(); project.assets.find(asset => asset.id === 'title')!.name = '第一回，题字';
  project.blueprints.push(...chapterBlueprintPair(createChapterPerformance(project, 'image', { kind: 'chapter', title: '', subtitle: '', duration: 7, titleImageId: 'title', backgroundId: 'night', soundId: 'music' })));
  const actions = performanceFromText(project, '@章节进入演出图片版：章节题图="第一回，题字"，时长=2，章节背景=庭院，章节音效=花街柳巷');
  assert.deepEqual(actions, [{ kind: 'blueprint', blueprintId: 'builtin_chapter_image', inputs: { title_image: 'title', duration: 2, background: 'night', sound: 'music' } }]);
  assert.throws(() => performanceFromText(project, '@章节标题：一'), /不是可封装/);
  assert.throws(() => performanceFromText(project, '@章节进入演出图片版：错误参数=记第一回'), /没有参数/);
});

test('named arguments, quoted punctuation and hidden references survive an edit and round trip', () => {
  const project = fixture(); const graph = blueprintFromPerformance(project, [{ kind: 'chapter', title: '一', subtitle: '', duration: 2 }], '入场');
  exposePerformanceInputs(graph, performanceInputs(graph)); project.blueprints.push(graph);
  const input = graph.exposedInputs.find(pin => pin.name === '标题')!;
  const action = { kind: 'blueprint' as const, blueprintId: graph.id, inputs: { [input.id]: '一，二 = "三"' } };
  const command = actionText(project, action), document = textDocument(command);
  assert.equal(document.text, '@入场：标题="一，二 = \\"三\\""'.replaceAll('\\\\', '\\'));
  assert.doesNotMatch(document.text, /【|input_|blueprint_/);
  assert.deepEqual(textCommandAction(project, command, true), action);
  const at = document.text.indexOf('二');
  const edited = editTextDocument(document, { start: at, end: at + 1, text: '两' });
  const result = textCommandAction(project, edited, true);
  assert.equal(result?.kind === 'blueprint' && result.inputs?.[input.id], '一，两 = "三"');
  assert.throws(() => textCommandAction(project, '@蓝图：入场，时长=很多', true), /数值/);
  assert.doesNotThrow(() => textCommandAction(project, '@蓝图：入场，时长=很多'));
});

test('silent performance containers keep line identity and never emit a blank say statement', () => {
  const project = fixture(); const graph = blueprintFromPerformance(project, [{ kind: 'pause', seconds: 0.2 }], '片刻'); project.blueprints.push(graph);
  const parsed = applyTextScript(project, "# 段落：演出\n@蓝图：片刻\n@独立演出\n# 段落：随后\n苏怜烟：天亮了。\n@返回标题界面");
  assert.deepEqual(parsed.issues, []);
  const silent = parsed.project.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []).find(line => line.silent)!;
  assert.ok(silent);
  const source = projectToText(parsed.project), reloaded = applyTextScript(parsed.project, source);
  assert.deepEqual(reloaded.issues, []);
  assert.deepEqual(reloaded.project.nodes, parsed.project.nodes);
  const result = compileProject(reloaded.project);
  assert.deepEqual(result.diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.doesNotMatch(result.files['game/story.rpy'], new RegExp(`id vn_say_\\w+_${silent.id}`));
  assert.doesNotMatch(textDocument(source).text, /旁白：\s*\n/);
});

test('auto speaker follows each line, honors role default, preserves overrides and excludes narration', () => {
  const project = fixture(); const graph = createShowCharacterFixture(); project.blueprints.push(graph);
  const node = project.nodes.find(node => node.kind === 'passage')!;
  node.lines = [{ id: 'first', speakerId: 'sulianyan', text: '不要走。', actions: [] }, { id: 'narration', text: '风停了。', actions: [] }, { id: 'second', speakerId: 'sulianyan', text: '没事了。', actions: [{ kind: 'blueprint', blueprintId: graph.id, inputs: { expression: 'normal', y: 1.4, preset: '', default_framing: false } }] }, { id: 'third', speakerId: 'no_portrait', text: '有人吗？', actions: [] }];
  assert.equal(addPerformanceToLines(project, { kind: 'blueprint', blueprintId: graph.id }), 2);
  assert.equal(node.lines[1].actions.length, 0); assert.equal(node.lines[2].actions.length, 1);
  const first = linePreviewSnapshot(project, { nodeId: node.id, lineId: 'first' }); assert.equal(first.actions[0].kind === 'show' && first.actions[0].expressionId, 'worried');
  const second = linePreviewSnapshot(project, { nodeId: node.id, lineId: 'second' }); assert.equal(second.after.actors.get('sulianyan')?.expressionId, 'normal'); assert.equal(second.after.actors.get('sulianyan')?.y, 1.4);
  assert.deepEqual(linePreviewSnapshot(project, { nodeId: node.id, lineId: 'third' }).actions, []);
  assert.equal(addPerformanceToLines(project, { kind: 'blueprint', blueprintId: graph.id }, new Set(['narration']), true), 1);
  const result = compileProject(project); assert.deepEqual(result.diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.match(result.files['game/story.rpy'], /vn_current_speaker = "sulianyan"/); assert.match(result.files['game/story.rpy'], /if vn_bp_show_speaker\(/);
});

test('blueprint completion offers named inputs and the current speaker expressions by initials', () => {
  const project = fixture(); project.blueprints.push(createShowCharacterFixture());
  const input = '@蓝图：跟随发言人测试，bq';
  assert.equal(textAssistance(project, input, input.length)?.items[0]?.label, '表情');
  const expression = '@蓝图：跟随发言人测试，表情=dy\n苏怜烟：不要走。';
  assert.equal(textAssistance(project, expression, expression.indexOf('\n'))?.items[0]?.label, '担忧');
});

test('a handwritten authored call roundtrips without mutating its source', () => {
  const source = fixture(); source.blueprints.push(createShowCharacterFixture()); const original = JSON.stringify(source);
  const parsed = applyTextScript(source, "# 段落：开场\n@蓝图：跟随发言人测试，表情=normal\n苏怜烟：天亮了。\n@返回标题界面");
  assert.deepEqual(parsed.issues, []);
  assert.equal(JSON.stringify(source), original);
  assert.equal(parsed.project.blueprints.filter(graph => graph.id === 'fixture_show_character').length, 1);
  assert.deepEqual(compileProject(parsed.project).diagnostics.filter(issue => issue.severity === 'error'), []);
  const again = applyTextScript(parsed.project, projectToText(parsed.project));
  assert.deepEqual(again.issues, []);
  assert.equal(again.project.blueprints.filter(graph => graph.id === 'fixture_show_character').length, 1);
});

test('showing a speaker preserves other actors and narration does not hide the stage', () => {
  const project = fixture(), graph = createShowCharacterFixture(); project.blueprints.push(graph);
  const action = { kind: 'blueprint' as const, blueprintId: graph.id, inputs: { expression: 'normal' } };
  const context = previewActionContext(project); context.speakerId = 'sulianyan';
  const active = expandPreviewActions(project, [action], context);
  assert.equal(active.filter(action => action.kind === 'hide').length, 0);
  assert.equal(active.filter(action => action.kind === 'show' && action.characterId === 'sulianyan').length, 1);
  const alongside = expandPreviewActions(project, [{ ...action, inputs: { expression: 'worried' } }], context);
  assert.equal(alongside.some(action => action.kind === 'hide'), false);
  context.speakerId = undefined;
  assert.deepEqual(expandPreviewActions(project, [action], context), []);
});
