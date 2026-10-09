import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, projectSchema } from '../src/core/model';
import { createMediaVisual } from '../src/core/media-command';
import { imageTransform, imageTransformText } from '../src/core/image-transform';
import { actionText, applyTextScript, projectToText, textCommandAction } from '../src/core/text-script';
import { textAssistance } from '../src/core/text-completion';
import { linePreviewSnapshot, linePlaybackPlan, sampleLinePlayback } from '../src/core/line-preview';
import { moveStageVisual, stageEditedProject, stageVisualObjects } from '../src/core/stage-edit';
import { compileProject } from '../src/runtime/compiler';

const fixture = () => {
  const project = createProject();
  project.assets = [{ id: 'picture', name: '图片，夜晚', kind: 'image', path: 'picture.png' }, { id: 'music', name: '雨声', kind: 'audio', path: 'rain.ogg', category: 'bgm' }];
  return project;
};
test('background music is the canonical command, with stable references and no old BGM command', () => {
  const project = fixture(), action = { kind: 'music' as const, assetId: 'music', loop: true, fade: .5 };
  assert.equal(actionText(project, action), '@背景音乐：雨声 循环');
  assert.deepEqual(textCommandAction(project, actionText(project, action), true), action);
  assert.equal(textCommandAction(project, '@bgm：雨声'), undefined);
  const source = '@背景音乐：';
  assert.ok(textAssistance(project, source, source.length, true)!.items.some(i => i.id === 'music'));
});
test('image transform is one named structure and preserves scale, rotation and opacity through save and reparse', () => {
  const project = fixture();
  const value = { x: -.2, y: .7, scaleX: .3, scaleY: .6, rotation: 35, opacity: .8 };
  const source = '@显示图片："图片，夜晚"，变换=' + imageTransformText(value) + '，图层=30';
  const action = textCommandAction(project, source, true)!;
  assert.ok(action.kind === 'visual'); assert.deepEqual(imageTransform(action), value);
  assert.equal(action.lifetime, 'line');
  const text = actionText(project, action);
  assert.match(text, /变换=\{"位置"/); assert.doesNotMatch(text, /横向位置=|纵向位置=|宽度=|高度=/);
  assert.deepEqual(textCommandAction(project, text, true), action);
  const node = project.nodes.find(n => n.kind === 'passage')!;
  node.lines = [{ id: 'image_line', text: 'Picture', actions: [action] }];
  const saved = projectSchema.parse(project), reopened = applyTextScript(saved, projectToText(saved));
  assert.deepEqual(reopened.issues, []);
  assert.deepEqual(reopened.project.nodes.find(n => n.id === node.id), saved.nodes.find(n => n.id === node.id));
});
test('image defaults to this line and can explicitly persist or time out', () => {
  for (const lifetime of ['line', 'persistent', 'duration'] as const) {
    const project = fixture(), node = project.nodes.find(n => n.kind === 'passage')!;
    const image = createMediaVisual('image', 'picture', { lifetime, ...(lifetime === 'duration' ? { duration: 3 } : {}) });
    node.lines = [{ id: 'first', text: 'Image', actions: [image] }, { id: 'second', text: 'Next', actions: [] }];
    assert.deepEqual(textCommandAction(project, actionText(project, image), true), image);
    const current = linePreviewSnapshot(project, { nodeId: node.id, lineId: 'first' });
    const sample = sampleLinePlayback(current.before, linePlaybackPlan(current.before, current.actions), 1000);
    assert.ok(sample.state.visuals.has('image'));
    const next = linePreviewSnapshot(project, { nodeId: node.id, lineId: 'second' });
    assert.equal(next.before.visuals.has('image'), lifetime !== 'line');
    assert.match(compileProject(project).files['game/story.rpy'], /vn_finish_line_visuals\(\)/);
  }
  assert.equal(createMediaVisual('image', 'picture').lifetime, 'line');
});
test('unlimited image objects support stage movement, scale and rotation without creating unwanted animation', () => {
  const project = fixture(), node = project.nodes.find(n => n.kind === 'passage')!;
  node.lines = [{ id: 'image_line', text: 'Image', actions: [createMediaVisual('image', 'picture')] }];
  const selection = { nodeId: node.id, lineId: 'image_line' };
  const snapshot = linePreviewSnapshot(project, selection);
  assert.equal(stageVisualObjects(snapshot.after).length, 1);
  const edited = stageEditedProject(project, draft => moveStageVisual(draft, selection, 'image', 'image', { x: .3, y: .7, scale: 1.3, rotation: -15 }))!;
  assert.ok(edited); assert.doesNotMatch(edited.source, /@演出实例/);
  const result = linePreviewSnapshot(edited.project, selection).after.visuals.get('image')!.object;
  assert.deepEqual(imageTransform(result), { x: .3, y: .7, scaleX: 1.3, scaleY: 1.3, rotation: -15, opacity: 1 });
  assert.equal(result.curves, undefined);
});
test('invalid transform structures and contradictory lifetime settings are rejected', () => {
  for (const parameter of ['变换={"尺寸":[1,1]}', '变换={"缩放":1}', '变换={"缩放":[1]}', '变换={"位置":[0.5]}', '变换={"旋转":"oops"}', '变换={"unknown":1}', '变换={"位置":[0,0]', '显示范围=定时显示', '显示范围=仅本句，时长=2']) {
    assert.throws(() => textCommandAction(fixture(), '@显示图片："图片，夜晚"，' + parameter, true), parameter);
  }
});
