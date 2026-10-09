import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, projectSchema, type StageAction } from '../src/core/model';
import { createMediaVisual } from '../src/core/media-command';
import { actionText, applyTextScript, projectToText } from '../src/core/text-script';
import { initialPreviewStage, linePlaybackPlan, sampleLinePlayback } from '../src/core/line-preview';
import { visualPhasePose } from '../src/core/visual-transitions';
import { performanceTiming } from '../src/core/performance-timing';
import { persistentVideoSpans, persistentVideoPreviewEnd } from '../src/core/preview-video';

const still = () => createMediaVisual('image', 'picture', { visualTransitions: { enter: { mode: 'dissolve', duration: .6 }, exit: { mode: 'move', duration: .4 }, replace: { mode: 'fade', duration: .8 } }, transitionWait: true });
test('media transition settings survive readable text, project save and named argument editing', () => {
  const p = createProject('过渡'); p.assets.push({ id: 'picture', kind: 'image', name: '图片', path: 'picture.png' });
  const n = p.nodes.find(n => n.kind === 'passage')!; n.lines[0].actions = [still(), { kind: 'hideVisual', instanceId: 'image', wait: false, exitTransition: { mode: 'dissolve', duration: .3 } }];
  const text = projectToText(p), parsed = applyTextScript(projectSchema.parse(p), text);
  assert.deepEqual(parsed.issues, []); assert.ok(text.includes('入场过渡=渐变')); assert.ok(text.includes('离场秒数=0.3'));
  assert.deepEqual(parsed.project.nodes.find(n => n.kind === 'passage')!.lines[0].actions, n.lines[0].actions);
  assert.ok(actionText(p, still()).startsWith('@显示图片'));
});
test('entry waits independently of lifetime; repeated persistent still keeps its clock', () => {
  const before = initialPreviewStage(), image = still(), plan = linePlaybackPlan(before, [image]);
  assert.equal(plan.dialogueAt, 600); assert.equal(plan.until, 600);
  const shown = sampleLinePlayback(before, plan, 600).state;
  assert.equal(shown.visuals.get('image')!.elapsed, .6);
  const repeat = linePlaybackPlan(shown, [image]); assert.equal(repeat.dialogueAt, 0);
  assert.equal(sampleLinePlayback(shown, repeat, 0).state.visuals.get('image')!.elapsed, .6);
  const phase = visualPhasePose(image, .3); assert.equal(phase.opacity, .5);
});
test('replacement freezes the visible previous state; hide inherits and can override the exit', () => {
  const image = still(), before = initialPreviewStage(); before.visuals.set('image', { object: image, elapsed: 2 });
  const replacement = { ...image, assetId: 'other', transitionWait: false };
  const plan = linePlaybackPlan(before, [replacement]); assert.equal(plan.dialogueAt, 0); assert.equal(plan.until, 800);
  const mid = sampleLinePlayback(before, plan, 200).state; assert.equal(mid.visuals.get('image')!.blend!.elapsed, .2);
  const hiding: StageAction = { kind: 'hideVisual', instanceId: 'image' }, hide = linePlaybackPlan(mid, [hiding]);
  assert.equal(hide.dialogueAt, 400);
  assert.ok(sampleLinePlayback(mid, hide, 200).state.visuals.get('image')!.blend!.previous.blend);
  assert.equal(sampleLinePlayback(mid, hide, 400).state.visuals.size, 0);
  const immediate = linePlaybackPlan(mid, [{ ...hiding, exitTransition: { mode: 'none', duration: 10 } }]);
  assert.equal(immediate.dialogueAt, 0); assert.equal(sampleLinePlayback(mid, immediate, 0).state.visuals.size, 0);
  assert.equal(linePlaybackPlan(before, [{ kind: 'hideVisual', instanceId: 'absent', exitTransition: { mode: 'dissolve', duration: 10 } }]).dialogueAt, 0);
});
test('timed exits fit inside lifetime and affect only the target object', () => {
  const image = { ...still(), persistent: false, duration: 2, wait: true };
  assert.equal(visualPhasePose(image, 1.8).opacity.toFixed(2), '0.50');
  assert.equal(visualPhasePose(image, 1.8).x.toFixed(3), '0.075');
  const before = initialPreviewStage(); before.backgroundId = 'background'; before.visuals.set('untouched', { object: { ...still(), instanceId: 'untouched' }, elapsed: 5 });
  const plan = linePlaybackPlan(before, [image]); assert.equal(plan.dialogueAt, 2000);
  const end = sampleLinePlayback(before, plan, 2000).state;
  assert.equal(end.backgroundId, 'background'); assert.equal(end.visuals.size, 1); assert.ok(end.visuals.has('untouched'));
});
test('performance and carried looping-video clocks stop when an inherited exit completes', () => {
  assert.deepEqual(performanceTiming([still(), { kind: 'hideVisual', instanceId: 'image' }]), { at: 1, until: 1 });
  const video = createMediaVisual('video', 'video', { loop: true, visualTransitions: { exit: { mode: 'dissolve', duration: .5 } } });
  const before = initialPreviewStage(); before.visuals.set('video', { object: video, elapsed: 2 });
  const plan = linePlaybackPlan(before, [{ kind: 'hideVisual', instanceId: 'video', wait: false }]);
  assert.equal(persistentVideoPreviewEnd(persistentVideoSpans(before, plan), { video: 1 }), 500);
  const middle = sampleLinePlayback(before, plan, 200).state, next = linePlaybackPlan(middle, []);
  assert.equal(next.until, 300);
  assert.equal(persistentVideoPreviewEnd(persistentVideoSpans(middle, next), { video: 1 }), 300);
  assert.equal(sampleLinePlayback(middle, next, 300).state.visuals.size, 0);
});
