import { previewAudioAt, previewAudioGain } from '../src/core/preview-audio';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type StageAction } from '../src/core/model';
import { initialPreviewStage, linePlaybackAudio, linePlaybackPlan, linePreviewSnapshot, sampleLinePlayback } from '../src/core/line-preview';
import { createVisualObject } from '../src/core/visual-object';

test('current-line camera and actor animations stop contributing duration after replacement', () => {
  const before = initialPreviewStage();
  const camera: StageAction = { kind: 'camera', x: 1, y: 0, zoom: 1, rotation: 0, duration: 20, easing: 'linear', wait: false };
  const pause: StageAction = { kind: 'pause', seconds: 1 };
  assert.equal(linePlaybackPlan(before, [camera, pause, { ...camera, duration: 2 }]).until, 3000);
  assert.equal(linePlaybackPlan(before, [camera, pause, { ...camera, duration: 0 }]).until, 1000);
  assert.equal(linePlaybackPlan(before, [{ ...camera, wait: true }, { ...camera, duration: 0 }]).until, 20000);
  const show: Extract<StageAction, { kind: 'show' }> = { kind: 'show', characterId: 'hero', expressionId: 'neutral', layer: 0, instanceId: 'left', x: 0, y: 1, scale: 1, transition: 'none' };
  const motion: Extract<StageAction, { kind: 'animate' }> = { kind: 'animate', characterId: 'hero', instanceId: 'left', wait: false, repeat: false, keyframes: [{ x: 1, y: 1, scale: 1, rotation: 0, opacity: 1, duration: 20, easing: 'linear' }] };
  const hide: StageAction = { kind: 'hide', characterId: 'hero', instanceId: 'left', transition: 'none' };
  const clear: StageAction = { kind: 'background', assetId: 'night', transition: 'none' };
  assert.equal(linePlaybackPlan(before, [show, motion, pause, hide]).until, 1000);
  assert.equal(linePlaybackPlan(before, [show, motion, pause, show]).until, 1000);
  assert.equal(linePlaybackPlan(before, [show, motion, pause, clear]).until, 1000);
  assert.equal(linePlaybackPlan(before, [{ ...show, lifetime: 'persistent' }, motion, pause, clear]).until, 20000);
  assert.equal(linePlaybackPlan(before, [show, motion, pause, { ...hide, instanceId: 'right' }]).until, 20000);
  const plan = linePlaybackPlan(before, [show, motion, pause, hide]);
  assert.equal(sampleLinePlayback(before, plan, plan.until).state.actors.size, 0);
});

test('nonblocking camera continues across dialogue, completes and is replaced from its current pose', () => {
  const project = createProject(), node = project.nodes.find(node => node.kind === 'passage')!;
  const camera: StageAction = { kind: 'camera', x: 1, y: .4, zoom: 2, rotation: 40, duration: 4, easing: 'linear', wait: false };
  node.lines = [{ id: 'one', text: '开始', actions: [camera, { kind: 'pause', seconds: 1 }] }, { id: 'two', text: '继续', actions: [{ kind: 'pause', seconds: 1 }] }, { id: 'three', text: '再继续', actions: [] }];
  const second = linePreviewSnapshot(project, { nodeId: node.id, lineId: 'two' });
  assert.equal(second.before.camera.x, .25); assert.equal(second.after.camera.x, .5);
  assert.equal(second.after.cameraMotion?.elapsed, 2);
  const plan = linePlaybackPlan(second.after, []);
  assert.equal(plan.until, 2000);
  const final = sampleLinePlayback(second.after, plan, 2000).state;
  assert.equal(final.camera.x, 1); assert.equal(final.camera.zoom, 2); assert.equal(final.cameraMotion, undefined);
  const replacement = { ...camera, x: 0, duration: 2 };
  const next = sampleLinePlayback(second.after, linePlaybackPlan(second.after, [replacement]), 500).state;
  assert.equal(next.camera.x, .375); assert.equal(next.cameraMotion?.elapsed, .5);
  assert.equal(second.after.cameraMotion?.elapsed, 2);
  const cleared = linePlaybackPlan(second.after, [{ ...camera, duration: 0 }]);
  assert.equal(cleared.until, 0);
});

test('preview ends when visuals are replaced or cleared, retaining other instances and explicit waits', () => {
  const old = { ...createVisualObject('text'), duration: 20, wait: false };
  const replacement = { ...old, duration: 1 };
  const before = initialPreviewStage();
  before.visuals.set(old.instanceId, { object: old, elapsed: 2 });
  const clear: StageAction = { kind: 'background', assetId: 'night', transition: 'none' };
  const pause: StageAction = { kind: 'pause', seconds: 2 };
  assert.equal(linePlaybackPlan(before, []).until, 18000);
  assert.equal(linePlaybackPlan(before, [replacement]).until, 1000);
  assert.equal(linePlaybackPlan(before, [clear]).until, 0);
  assert.equal(linePlaybackPlan(before, [pause, replacement]).until, 3000);
  assert.equal(linePlaybackPlan(before, [pause, clear]).until, 2000);
  assert.equal(linePlaybackPlan(initialPreviewStage(), [old, pause, clear]).until, 2000);
  assert.equal(linePlaybackPlan(initialPreviewStage(), [{ ...old, wait: true }, clear]).until, 20000);
  before.visuals.set('other', { object: { ...old, instanceId: 'other', duration: 5 }, elapsed: 1 });
  assert.equal(linePlaybackPlan(before, [replacement]).until, 4000);
  assert.equal(before.visuals.get(old.instanceId)?.elapsed, 2);
});

test('a line starts from the preceding stage and expands its scene entry only once', () => {
  const project = createProject();
  const node = project.nodes.find(n => n.kind === 'passage')!;
  project.scenes.find(s => s.id === node.sceneId)!.entryActions = [{ kind: 'music', assetId: 'music', fade: 0, loop: true }];
  node.lines = [{ id: 'one', text: '第一句', actions: [{ kind: 'background', assetId: 'night', transition: 'none' }] }, { id: 'two', text: '第二句', voiceId: 'voice', actions: [{ kind: 'pause', seconds: 1 }] }];
  const first = linePreviewSnapshot(project, { nodeId: node.id, lineId: 'one' });
  assert.deepEqual(first.actions.map(a => a.kind), ['music', 'background']);
  const second = linePreviewSnapshot(project, { nodeId: node.id, lineId: 'two' });
  assert.equal(second.before.backgroundId, 'night'); assert.equal(second.before.musicId, 'music');
  assert.equal(second.line?.voiceId, 'voice'); assert.deepEqual(second.actions.map(a => a.kind), ['pause']);
  assert.equal(project.nodes.find(n => n.id === node.id), node);
});
test('preview sequences blocking transitions and pauses, while BGM fade does not delay dialogue', () => {
  const actions: StageAction[] = [{ kind: 'music', assetId: 'bgm', loop: true, fade: 2 }, { kind: 'background', assetId: 'night', transition: 'dissolve' }, { kind: 'pause', seconds: 0.3 }, { kind: 'shake', direction: 'horizontal' }];
  const before = initialPreviewStage(), plan = linePlaybackPlan(before, actions);
  assert.deepEqual(plan.steps.map(step => step.at), [0, 0, 500, 800]);
  assert.equal(plan.dialogueAt, 1400); assert.equal(plan.until, 2000);
  assert.equal(before.backgroundId, undefined); assert.equal(plan.steps[1].after.backgroundId, 'night');
});
test('nonblocking motion overlaps dialogue and waiting motion delays it', () => {
  const camera: StageAction = { kind: 'camera', x: 0.1, y: 0, zoom: 1.2, rotation: 0, duration: 2, easing: 'ease', wait: false };
  assert.equal(linePlaybackPlan(initialPreviewStage(), [camera]).dialogueAt, 0);
  assert.equal(linePlaybackPlan(initialPreviewStage(), [{ ...camera, wait: true }]).dialogueAt, 2000);
  const animation: StageAction = { kind: 'animate', characterId: 'sui', repeat: true, wait: false, keyframes: [{ x: .5, y: 1, scale: 1, rotation: 0, opacity: 1, duration: 1, easing: 'linear' }] };
  assert.equal(linePlaybackPlan(initialPreviewStage(), [animation]).dialogueAt, 0);
});
test('a command cursor previews a prefix without discarding the following dialogue or voice', () => {
  const project = createProject(), node = project.nodes.find(n => n.kind === 'passage')!;
  node.lines = [{ id: 'line', text: '还未开始的对白', voiceId: 'voice', actions: [{ kind: 'background', assetId: 'night', transition: 'none' }, { kind: 'pause', seconds: 2 }] }];
  const result = linePreviewSnapshot(project, { nodeId: node.id, lineId: 'line' }, 1);
  assert.equal(result.actions.length, 1); assert.equal(result.line?.text, node.lines[0].text); assert.equal(result.line?.voiceId, 'voice');
});


test('nonblocking dissolve and fade retain progress across dialogue and expire or restart cleanly',()=>{
 for(const transition of ['dissolve','fade'] as const){
  const project=createProject(),node=project.nodes.find(n=>n.kind==='passage')!;
  const show:StageAction={kind:'show',characterId:'hero',expressionId:'normal',x:.5,y:1,scale:1,layer:10,lifetime:'persistent',transition,duration:2,wait:false};
  project.assets=[{id:'portrait',name:'立绘',kind:'image',path:'actor.png'}];project.characters=[{id:'hero',name:'角色',color:'#ffffff',expressions:[{id:'normal',name:'通常',assetId:'portrait'}]}];
  node.lines=[{id:'one',text:'开始',actions:[show,{kind:'pause',seconds:.5}]},{id:'two',text:'继续',actions:[{kind:'pause',seconds:.5}]},{id:'three',text:'继续',actions:[]}];
  const snap=linePreviewSnapshot(project,{nodeId:node.id,lineId:'three'}),plan=linePlaybackPlan(snap.before,snap.actions);
  assert.equal(snap.before.transitionMotion?.elapsed,1);assert.equal(plan.until,1000);
  const mid=sampleLinePlayback(snap.before,plan,500);assert.equal(mid.transition?.type,transition);assert.equal(mid.transition?.progress,.75);assert.equal(mid.state.motions.get('hero')?.elapsed,1.5);
  assert.equal(snap.before.transitionMotion?.elapsed,1);
  const end=sampleLinePlayback(snap.before,plan,1000);assert.equal(end.transition,undefined);assert.equal(end.state.transitionMotion,undefined);assert.equal(end.state.motions.size,0);
  const replacement=sampleLinePlayback(snap.before,linePlaybackPlan(snap.before,[{...show,duration:.5}]),250);assert.equal(replacement.transition?.progress,.5);
  const replacedEnd=sampleLinePlayback(snap.before,linePlaybackPlan(snap.before,[{...show,duration:.5}]),500);assert.equal(replacedEnd.transition,undefined);
 }
});


test('transition old layer keeps visual objects and advances their and the old camera clocks across lines',async()=>{
 const {createVisualObject}=await import('../src/core/visual-object');
 const project=createProject(),node=project.nodes.find(n=>n.kind==='passage')!,visual=createVisualObject('solid');visual.duration=4;
 project.assets=[{id:'old',name:'旧背景',kind:'image',path:'old.png'},{id:'next',name:'新背景',kind:'image',path:'next.png'}];
 node.lines=[{id:'one',text:'过渡',actions:[{kind:'background',assetId:'old',transition:'none'},visual,{kind:'camera',x:.4,y:0,zoom:1,rotation:0,duration:4,easing:'linear',wait:false},{kind:'pause',seconds:1},{kind:'background',assetId:'next',transition:'dissolve',duration:2,wait:false},{kind:'pause',seconds:.5}]},{id:'two',text:'继续',actions:[]}];
 const snap=linePreviewSnapshot(project,{nodeId:node.id,lineId:'two'}),plan=linePlaybackPlan(snap.before,snap.actions),frame=sampleLinePlayback(snap.before,plan,500);
 assert.equal(frame.transition?.progress,.5);assert.equal(frame.transition?.before.backgroundId,'old');assert.equal(frame.state.backgroundId,'next');assert.equal(frame.state.visuals.size,0);
 assert.equal(frame.transition?.before.visuals.get(visual.instanceId)?.elapsed,2);assert.ok(Math.abs(frame.transition!.before.camera.x-.2)<1e-9);
 assert.equal(snap.before.transitionMotion?.before.visuals.get(visual.instanceId)?.elapsed,1);
 assert.equal(sampleLinePlayback(snap.before,plan,1500).transition,undefined);
});

test('cross-line audio retains elapsed explicit waits, pending fades and sound offsets',()=>{
 const project=createProject(),node=project.nodes.find(n=>n.kind==='passage')!;
 node.lines=[
  {id:'one',text:'一',actions:[{kind:'music',assetId:'bgm',loop:true,fade:4},{kind:'sound',assetId:'sfx'},{kind:'pause',seconds:1}]},
  {id:'two',text:'二',actions:[{kind:'stopMusic',fade:2},{kind:'pause',seconds:.5}]},
  {id:'three',text:'三',actions:[{kind:'pause',seconds:2}]},
  {id:'four',text:'四',actions:[]},
 ];
 const second=linePreviewSnapshot(project,{nodeId:node.id,lineId:'two'});
 const inherited=linePlaybackAudio(second.before,linePlaybackPlan(second.before,[]));
 assert.equal(inherited.find(e=>e.id==='bgm')?.at,-1000);
 assert.equal(inherited.find(e=>e.id==='sfx')?.at,-1000);
 const third=linePreviewSnapshot(project,{nodeId:node.id,lineId:'three'});
 const active=previewAudioAt(third.before.audio!,0).find(e=>e.source.id==='bgm')!;
 assert.equal(active.source.at,-1500); assert.equal(active.stop?.at,-500); assert.equal(active.stopGain,.25);
 assert.equal(previewAudioGain(0,active.source.at,active.source.fade!,active.stop?.at,active.stop?.fade,active.stopGain),.1875);
 const fourth=linePreviewSnapshot(project,{nodeId:node.id,lineId:'four'});
 assert.ok(!fourth.before.audio!.some(e=>e.channel==='music'));
 assert.equal(fourth.before.audio!.find(e=>e.id==='sfx')?.at,-3500);
 // Reading time is unknown and contributes no invented duration.
 assert.equal(linePreviewSnapshot(project,{nodeId:node.id,lineId:'two'}).before.audio!.find(e=>e.id==='bgm')?.at,-1000);
});
