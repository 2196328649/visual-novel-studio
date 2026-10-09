import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema } from '../src/core/model';
import { createMediaVisual } from '../src/core/media-command';
import { actionText, applyTextScript, projectToText, textCommandAction } from '../src/core/text-script';
import { finishPreviewPerformance, initialPreviewStage, linePlaybackPlan, linePreviewSnapshot, sampleLinePlayback } from '../src/core/line-preview';
import { applyVisualInputs, createVisualObject, videoFadeGain, videoPlaybackState } from '../src/core/visual-object';
import { actionTiming } from '../src/core/performance-timing';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs } from '../src/core/blueprint-authoring';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { commandPerformanceBlueprints } from '../src/core/builtin-performances';
import { textAssistance } from '../src/core/text-completion';
import { compileProject } from '../src/runtime/compiler';
import { persistentVideoPreviewEnd, persistentVideoSpans } from '../src/core/preview-video';

function fixture() {
  const project = createProject('通用媒体指令');
  project.assets = [
    { id: 'picture', name: '图片，带逗号', kind: 'image', path: 'picture.png' },
    { id: 'movie', name: '片头，视频', kind: 'video', path: 'movie.webm' },
  ];
  return project;
}

test('media commands round trip named parameters, stable asset references and quoted text', () => {
  const project = fixture();
  const actions = [
    createMediaVisual('image', 'picture', { instanceId: 'overlay', x: 0, y: .2, scaleX: .4, scaleY: .5, layer: -1, fit: 'cover' }),
    createMediaVisual('video', 'movie', { duration: 3, wait: true, loop: true, volume: 0, fit: 'contain' }),
    createMediaVisual('text', '第一章，开始\n第二行 "引号"', { fontSize: 72, color: '#aabbcc', duration: 2 }),
    { kind: 'hideVisual', instanceId: 'overlay' } as const,
  ];
  for (const action of actions) assert.deepEqual(textCommandAction(project, actionText(project, action), true), action);
  assert.match(actionText(project, { ...actions[0], kind: 'visual', retimeBasisDuration: undefined } as typeof actions[0]), /^@显示图片/);
  assert.deepEqual(textCommandAction(project, '@显示图片："图片，带逗号"', true), createMediaVisual('image', 'picture'));
  assert.deepEqual(textCommandAction(project, '@播放视频："片头，视频"，循环=是，音量=0.4', true), createMediaVisual('video', 'movie', { loop: true, volume: .4 }));
  assert.deepEqual(textCommandAction(project, '@隐藏视频：', true), { kind: 'hideVisual', instanceId: 'video' });
  assert.deepEqual(textCommandAction(project, '@隐藏文字：', true), { kind: 'hideVisual', instanceId: 'text' });
  const node = project.nodes.find(node => node.kind === 'passage')!;
  node.lines[0].actions = actions;
  const saved = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  const restored = applyTextScript(saved, projectToText(saved));
  assert.deepEqual(restored.issues, []);
  const restoredNode = restored.project.nodes.find(n => n.id === node.id)!;
  assert.ok(restoredNode.kind === 'passage');
  assert.deepEqual(restoredNode.lines[0].actions, actions);
});

test('invalid media options report errors instead of producing unusable actions', () => {
  const project = fixture();
  for (const suffix of ['时长=-1', '时长=NaN', '宽度=0', '高度=5', '对象ID=BAD-ID', '等待完成=是', '适应方式=未知', '图层=0.5']) {
    const source = '@显示图片："图片，带逗号"，' + suffix;
    assert.throws(() => textCommandAction(project, source, true), source);
    assert.equal(textCommandAction(project, source), undefined);
  }
  for (const suffix of ['循环=随便', '音量=2', '音量=-1']) assert.throws(() => textCommandAction(project, '@显示视频："片头，视频"，' + suffix, true));
  assert.throws(() => textCommandAction(project, '@隐藏对象：错误ID', true));
  assert.equal(textCommandAction(project, '@显示图片：movie', true), undefined);
  assert.equal(textCommandAction(project, '@显示视频：picture', true), undefined);
  assert.throws(() => textCommandAction(project, '@显示文字：测试，颜色=red', true));
});

test('persistent overlays carry across dialogue and silent performances, replace by ID and hide independently', () => {
  const project = fixture(), node = project.nodes.find(node => node.kind === 'passage')!;
  const image = createMediaVisual('image', 'picture', { instanceId: 'overlay', lifetime: 'persistent' });
  const text = createMediaVisual('text', '持续文字');
  node.lines = [
    { id: 'setup', text: '', silent: true, actions: [image, text] },
    { id: 'next', text: '下一句', actions: [] },
    { id: 'hide', text: '仅隐藏图片', actions: [{ kind: 'hideVisual', instanceId: 'overlay' }] },
    { id: 'background', text: '换景清除', actions: [{ kind: 'background', assetId: 'picture', transition: 'none' }] },
  ];
  const snapshot = linePreviewSnapshot(project, { nodeId: node.id, lineId: 'next' });
  assert.deepEqual([...snapshot.before.visuals.keys()], ['overlay', 'text']);
  const carried = sampleLinePlayback(snapshot.before, linePlaybackPlan(snapshot.before, []), 60000).state;
  assert.equal(carried.visuals.size, 2);
  const replacement = createMediaVisual('text', '替换图片的文字', { instanceId: 'overlay' });
  const changed = sampleLinePlayback(carried, linePlaybackPlan(carried, [replacement]), 0).state;
  assert.equal(changed.visuals.size, 2);
  assert.equal(changed.visuals.get('overlay')?.object.text, replacement.text);
  assert.deepEqual([...linePreviewSnapshot(project, { nodeId: node.id, lineId: 'hide' }).after.visuals.keys()], ['text']);
  assert.equal(linePreviewSnapshot(project, { nodeId: node.id, lineId: 'background' }).after.visuals.size, 0);
  const timed = createMediaVisual('image', 'picture', { instanceId: 'overlay', duration: 10 });
  const state = sampleLinePlayback(initialPreviewStage(), linePlaybackPlan(initialPreviewStage(), [timed, replacement]), 0).state;
  finishPreviewPerformance(state, [timed, replacement]);
  assert.equal(state.visuals.get('overlay')?.object.text, replacement.text);
});

test('timed displays expire, optional waits delay dialogue and hiding ends the scheduled lifetime', () => {
  const before = initialPreviewStage(), image = createMediaVisual('image', 'picture', { duration: 2 });
  const plan = linePlaybackPlan(before, [image]);
  assert.equal(plan.dialogueAt, 0); assert.equal(plan.until, 2000);
  assert.equal(sampleLinePlayback(before, plan, 1999).visuals.length, 1);
  assert.equal(sampleLinePlayback(before, plan, 2000).visuals.length, 0);
  assert.equal(linePlaybackPlan(before, [{ ...image, wait: true }]).dialogueAt, 2000);
  const hidden = linePlaybackPlan(before, [image, { kind: 'pause', seconds: .5 }, { kind: 'hideVisual', instanceId: image.instanceId }]);
  assert.equal(hidden.until, 500); assert.equal(sampleLinePlayback(before, hidden, 500).visuals.length, 0);
  assert.equal(linePlaybackPlan(before, [createMediaVisual('image', 'picture')]).until, 0);
  const legacy = { ...createVisualObject('text'), duration: 0 };
  assert.equal(sampleLinePlayback(before, linePlaybackPlan(before, [legacy]), 0).visuals.length, 0);
});

test('video ends transparently without replaying, looping honors its source segment and timed limit', () => {
  const once = createMediaVisual('video', 'movie');
  assert.deepEqual(videoPlaybackState(once, 1, 2), { position: 1, active: true });
  assert.deepEqual(videoPlaybackState(once, 9, 2), { position: 2, active: false });
  const loop = { ...once, loop: true, mediaOffset: .5 };
  assert.deepEqual(videoPlaybackState(loop, 4, 2.5), { position: .5, active: true });
  assert.deepEqual(videoPlaybackState(loop, 4.75, 2.5), { position: 1.25, active: true });
  const timed = { ...loop, duration: 6, persistent: false, sourceDuration: 2.5, wait: true };
  assert.deepEqual(actionTiming(timed), { duration: 6, wait: true });
  assert.equal(applyVisualInputs(timed, {}).duration, 6);
  assert.equal(videoPlaybackState(timed, 5, 2.5).active, true);
  assert.equal(videoPlaybackState(timed, 6, 2.5).active, false);
  assert.deepEqual(actionTiming({ ...timed, loop: false }), { duration: 2, wait: true });
  assert.equal(videoFadeGain(once, 100), 1);
});

test('media blueprint duration overrides switch lifetime and preserve native timing', () => {
  const project = fixture(), object = createMediaVisual('video', 'movie');
  const graph = blueprintFromPerformance(project, [object], '可复用视频'); project.blueprints.push(graph);
  exposePerformanceInputs(graph, performanceInputs(graph).filter(field => field.pinId === 'object_duration' || field.pinId === 'object_loop'));
  const inputs = Object.fromEntries(graph.exposedInputs.map(pin => [pin.id, pin.dataType === 'boolean' ? true : 5]));
  const actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id, inputs }], previewActionContext(project));
  const visual = actions.find(action => action.kind === 'visual')!;
  assert.equal(visual.duration, 5); assert.equal(visual.persistent, false); assert.equal(visual.loop, true);
  assert.equal(linePlaybackPlan(initialPreviewStage(), actions).until, 5000);
  const persistent = applyVisualInputs({ ...visual, wait: true }, { duration: 0 });
  assert.equal(persistent.persistent, true); assert.equal(persistent.wait, false);
  const node = project.nodes.find(node => node.kind === 'passage')!;
  node.lines[0].actions = [object, { kind: 'hideVisual', instanceId: 'video' }];
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), []);
  assert.ok(compiled.files['game/story.rpy'].includes('vn_hide_visual("video", None)'));
});

test('editor playback reaches a persistent video end and keeps looping until hidden or stopped', () => {
  const before = initialPreviewStage(), video = createMediaVisual('video', 'movie');
  const spans = persistentVideoSpans(before, linePlaybackPlan(before, [video]));
  assert.equal(persistentVideoPreviewEnd(spans, { movie: 20 }), 20000);
  assert.equal(persistentVideoPreviewEnd(spans, {}), Infinity, 'Metadata loading must not cut playback short');
  const loop = { ...video, loop: true };
  assert.equal(persistentVideoPreviewEnd(persistentVideoSpans(before, linePlaybackPlan(before, [loop])), { movie: 2 }), Infinity);
  assert.equal(persistentVideoPreviewEnd(persistentVideoSpans(before, linePlaybackPlan(before, [loop])), { movie: 0 }), 0, 'Unreadable media must not leave a preview running forever');
  const hidden = linePlaybackPlan(before, [loop, { kind: 'pause', seconds: 3 }, { kind: 'hideVisual', instanceId: 'video' }]);
  assert.equal(persistentVideoPreviewEnd(persistentVideoSpans(before, hidden), { movie: 2 }), 3000);
  const replaced = linePlaybackPlan(before, [loop, { kind: 'pause', seconds: .5 }, createMediaVisual('text', '代替视频', { instanceId: 'video' })]);
  assert.equal(persistentVideoPreviewEnd(persistentVideoSpans(before, replaced), { movie: 2 }), 500);
  const carried = sampleLinePlayback(before, linePlaybackPlan(before, [video]), 1500).state;
  assert.equal(persistentVideoPreviewEnd(persistentVideoSpans(carried, linePlaybackPlan(carried, [])), { movie: 5 }), 3500);
});

test('advanced objects keep bindings that the simple command cannot represent', () => {
  const project = fixture(), node = project.nodes.find(node => node.kind === 'passage')!;
  const image = createMediaVisual('image', 'picture');
  image.curves = { opacity: [{ at: 0, value: 0, easing: 'linear' }, { at: 1, value: 1, easing: 'ease' }] };
  assert.equal(actionText(project, image), '');
  node.lines[0].actions = [image];
  const result = applyTextScript(project, projectToText(project));
  assert.deepEqual(result.issues, []);
  const restored = result.project.nodes.find(n => n.id === node.id)!;
  assert.ok(restored.kind === 'passage'); assert.deepEqual(restored.lines[0].actions, [image]);
});

test('general catalog exposes media and reusable performances; project stories remain available through the blueprint selector', () => {
  const project = fixture();
  const ui = blueprintFromPerformance(project, [], '标题动画 · 播放'); ui.kind = 'ui';
  const story = blueprintFromPerformance(project, [{ kind: 'pause', seconds: .1 }], '夜宴 · 音乐淡入');
  const reusable = blueprintFromPerformance(project, [createMediaVisual('image', 'picture')], '自定义图片演出');
  exposePerformanceInputs(reusable, performanceInputs(reusable).filter(field => field.pinId === 'object_width'));
  project.blueprints.push(ui, story, reusable);
  const catalog = commandPerformanceBlueprints(project);
  assert.ok(!catalog.some(graph => graph.id === ui.id || graph.id === story.id));
  assert.ok(catalog.some(graph => graph.id === reusable.id));
  const general = textAssistance(project, '@', 1)!.items;
  for (const label of ['显示图片', '显示视频', '显示文字', '隐藏对象', '蓝图']) assert.ok(general.some(item => item.label === label), label);
  assert.ok(!general.some(item => item.label === ui.name || item.label === story.name));
  const selector = textAssistance(project, '@蓝图：', 4, true)!.items;
  assert.ok(selector.some(item => item.id === story.id)); assert.ok(!selector.some(item => item.id === ui.id));
  assert.deepEqual(textCommandAction(project, '@夜宴 · 音乐淡入', true), { kind: 'blueprint', blueprintId: story.id });
  const video = textAssistance(project, '@显示视频：', 6, true)!;
  assert.ok(video.items.some(item => item.id === 'movie')); assert.ok(!video.items.some(item => item.id === 'picture'));
});
