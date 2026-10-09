import test from 'node:test';
import assert from 'node:assert/strict';
import { controlAiPreview } from '../src/renderer/ai-preview-control';
import type { RuntimeEvent } from '../src/core/bridge';
test('AI preview controls await acknowledgement and clean up on success, stop, failure and timeout',async()=>{
 let listener:((e:RuntimeEvent)=>void)|undefined,cleanups=0,calls:string[]=[];
 const bridge={onRuntimeEvent:(cb:(e:RuntimeEvent)=>void)=>{listener=cb;return()=>{listener=undefined;cleanups++;};},controlPreview:async(command:any)=>{calls.push(command);}};
 assert.equal((await controlAiPreview(bridge,'idle','pause')).status,'cancelled');assert.equal(calls.length,0);
 assert.equal((await controlAiPreview(bridge,'paused','pause')).status,'completed');assert.equal(calls.length,0);
 const pending=controlAiPreview(bridge,'running','pause');await Promise.resolve();assert.deepEqual(calls,['pause']);listener!({kind:'preview',phase:'paused',message:''});assert.equal((await pending).status,'completed');assert.equal(cleanups,1);
 const stopped=controlAiPreview(bridge,'paused','resume');listener!({kind:'preview',phase:'idle',message:''});assert.equal((await stopped).status,'cancelled');
 const failed=controlAiPreview(bridge,'running','pause');listener!({kind:'preview',phase:'failed',message:'原生失败'});assert.equal((await failed).message,'原生失败');
 assert.equal((await controlAiPreview(bridge,'running','pause',5)).status,'failed');assert.equal(listener,undefined);assert.equal(cleanups,4);
});
