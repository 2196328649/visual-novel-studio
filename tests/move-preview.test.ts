import test from 'node:test';
import assert from 'node:assert/strict';
import { initialPreviewStage, linePlaybackPlan, sampleLinePlayback } from '../src/core/line-preview';
import type { StageAction } from '../src/core/model';
const show: StageAction = {kind:'show',characterId:'hero',expressionId:'normal',x:.8,y:1,scale:.6,layer:10,transition:'move',duration:2,wait:false,lifetime:'persistent'};
test('nonwaiting move continues across dialogue boundaries without changing its original pose',()=>{
 const before=initialPreviewStage(),plan=linePlaybackPlan(before,[show,{kind:'pause',seconds:.5}]);
 const first=sampleLinePlayback(before,plan,500).state;
 assert.ok(first.motions.has('hero'));
 const nextPlan=linePlaybackPlan(first,[]);assert.equal(nextPlan.until,1500);
 for(const time of [0,100,500,1000,1500]){
  const actual=sampleLinePlayback(first,nextPlan,time).state,expected=sampleLinePlayback(before,plan,time+500).state;
  for(const key of ['x','y','scale','opacity'] as const)assert.ok(Math.abs(actual.actors.get('hero')![key]-expected.actors.get('hero')![key])<1e-9);
 }
 assert.equal(first.motions.get('hero')!.elapsed,.5);
 assert.ok(!sampleLinePlayback(first,nextPlan,1500).state.motions.has('hero'));
 const hidden=sampleLinePlayback(first,linePlaybackPlan(first,[{kind:'hide',characterId:'hero',transition:'none'}]),100).state;assert.ok(!hidden.motions.has('hero'));
});
