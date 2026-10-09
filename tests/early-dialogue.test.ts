import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, type StageAction } from '../src/core/model';
import { initialPreviewStage, linePlaybackPlan, linePreviewSnapshot } from '../src/core/line-preview';
import { performancePreviewAudio } from '../src/core/preview-audio';
import { actionText, textCommandAction, applyTextScript, projectToText } from '../src/core/text-script';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { performanceTimeline } from '../src/core/performance-timeline';
import { compileProject } from '../src/runtime/compiler';

test('dialogue marker starts once without consuming later waits', () => {
 const actions: StageAction[] = [{kind:'pause',seconds:1}, {kind:'startDialogue'}, {kind:'pause',seconds:2}, {kind:'startDialogue'}];
 const plan = linePlaybackPlan(initialPreviewStage(), actions);
 assert.equal(plan.dialogueAt, 1000); assert.equal(plan.actionsEnd, 3000); assert.equal(plan.until, 3000);
 assert.equal(linePlaybackPlan(initialPreviewStage(), [{kind:'pause',seconds:3}]).dialogueAt, 3000);
});
test('the following line inherits the stage after all explicit waits, not the early dialogue point', () => {
 const p=createProject(), n=p.nodes.find(n=>n.kind==='passage')!;
 n.lines=[{id:'a',text:'第一句',actions:[{kind:'startDialogue'},{kind:'camera',x:.4,y:0,zoom:1,rotation:0,duration:2,easing:'linear',wait:true}]},{id:'b',text:'第二句',actions:[]}];
 const next=linePreviewSnapshot(p,{nodeId:n.id,lineId:'b'});
 assert.equal(next.before.camera.x,.4); assert.equal(next.before.cameraMotion,undefined);
});
test('dialogue marker roundtrips through text and timeline blueprints', () => {
 const p=createProject(), n=p.nodes.find(n=>n.kind==='passage')!;
 n.lines=[{id:'a',text:'测试',actions:[{kind:'pause',seconds:1},{kind:'startDialogue'},{kind:'pause',seconds:2}]}];
 assert.deepEqual(textCommandAction(p,'@播放台词演出'),{kind:'startDialogue'});
 assert.equal(actionText(p,{kind:'startDialogue'}),'@播放台词演出');
 const parsed=applyTextScript(p,projectToText(p)); assert.deepEqual(parsed.issues,[]);
 const graph=blueprintFromPerformance(p,n.lines[0].actions); p.blueprints.push(graph);
 const timeline=performanceTimeline(p,graph); assert.equal(timeline.reason,undefined); assert.equal(timeline.clips.find(c=>graph.nodes.find(n=>n.id===c.nodeId)?.type==='startDialogue')?.at,1);
 n.lines[0].actions=[{kind:'blueprint',blueprintId:graph.id}];
 assert.equal(linePlaybackPlan(initialPreviewStage(),linePreviewSnapshot(p,{nodeId:n.id,lineId:'a'}).actions).dialogueAt,1000);
 const compiled=compileProject(p); assert.deepEqual(compiled.diagnostics.filter(d=>d.severity==='error'),[]);
 assert.match(compiled.files['game/story.rpy'],/\$ vn_start_dialogue\(\)/);
});
test('performance audition excludes all music buses and preserves timed sound and voice', () => {
 const events = [{id:'bgm',channel:'music' as const,at:-200}, {id:'clip',key:'clip:music',channel:'music' as const,at:100}, {channel:'music' as const,at:300}, {id:'hit',channel:'sound' as const,at:400}, {id:'voice',channel:'voice' as const,at:700}];
 assert.deepEqual(performancePreviewAudio(events),events.slice(3));
});
test('retired automatic speaker command is no longer installed or parsed', () => {
 const p=createProject();
 assert.equal(textCommandAction(p,'@自动显示发言角色'),undefined);
 assert.equal(textCommandAction(p,'@蓝图：自动显示发言角色'),undefined);
 assert.deepEqual(textCommandAction(p,'@显示角色')?.kind,'show');
});
