import test from 'node:test';
import assert from 'node:assert/strict';
import { requestBlueprintSelection, type BlueprintSelectionRequest } from '../src/renderer/blueprint-editor-selection';

test('selection completion requires canvas acknowledgement and late callbacks cannot revive an expired request',async()=>{
 let request:BlueprintSelectionRequest|undefined;
 const pending=requestBlueprintSelection({nodeIds:['node'],linkIds:[],frame:false},value=>{request=value;});
 assert.equal(request?.active(),true);request!.finish({status:'completed',message:'selected'});assert.equal((await pending).status,'completed');assert.equal(request?.active(),false);
 request!.finish({status:'failed',message:'late'});assert.equal((await pending).status,'completed');
 const timeout=await requestBlueprintSelection({nodeIds:[],linkIds:[],frame:false},value=>{request=value;},1);assert.equal(timeout.status,'failed');assert.equal(request?.active(),false);
 request!.finish({status:'completed',message:'late'});assert.equal(timeout.status,'failed');
 const failed=await requestBlueprintSelection({nodeIds:[],linkIds:[],frame:false},()=>{throw new Error('closed');});assert.equal(failed.status,'failed');assert.equal(failed.message,'closed');
});
