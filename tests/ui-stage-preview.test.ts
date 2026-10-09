import test from 'node:test';
import assert from 'node:assert/strict';
import { uiStageFixture } from '../scripts/lib/ui-stage-fixture';
import { previewUiLogic } from '../src/core/ui-logic-preview';
import { blueprintNodeDefaults, connectBlueprintPins } from '../src/core/blueprint';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { uiStagePlan } from '../src/core/ui-stage-preview';

test('timed UI events share stage waits, finite image/audio lifetime and subsequent widget animation',()=>{
 const {project,image}=uiStageFixture(),before=structuredClone(project),click={kind:'click' as const,componentId:'play'};
 const at=(seconds:number)=>previewUiLogic(project,project.ui.components,'ui:main',{},[click,{kind:'advance',seconds}],{timed:true});
 const initial=at(.1);assert.equal(initial.incomplete,false);assert.equal(initial.stageWaiting,1);assert.equal(initial.stage.sample.visuals.length,0);assert.equal(initial.components.find(c=>c.component.id==='label')!.component.text,'尚未播放');
 const during=at(.75);assert.equal(during.stage.sample.visuals[0].object.instanceId,image.instanceId);assert.equal(during.stage.sample.visuals[0].elapsed,.5);assert.equal(during.stage.audio[0].at,250);assert.equal(during.stage.audio[0].offset,500);assert.equal(during.stage.audio[0].duration,1500);
 const after=at(1.75);assert.equal(after.stage.sample.visuals.length,0);assert.equal(after.stageWaiting,0);assert.equal(after.components.find(c=>c.component.id==='label')!.component.text,'演出完成');
 const tween=at(2);assert.ok(Math.abs(tween.components.find(c=>c.component.id==='label')!.component.style!.opacity!-.65)<1e-6);
 assert.equal(at(2.25).components.find(c=>c.component.id==='label')!.component.text,'全部完成');assert.deepEqual(project,before);
 const staticPreview=previewUiLogic(project,project.ui.components,'ui:main',{},[click]);assert.equal(staticPreview.incomplete,true);assert.equal(staticPreview.components.find(c=>c.component.id==='label')!.component.text,'尚未播放');
});

test('default transition waits are represented by event timestamps only once',()=>{
 const {image}=uiStageFixture();
 const stage=uiStagePlan([{at:0,action:{kind:'background',assetId:'card',transition:'dissolve'}},{at:.5,action:image}],.75);
 assert.equal(stage.sample.state.backgroundId,'card');assert.equal(stage.sample.visuals.length,1);assert.equal(stage.sample.visuals[0].elapsed,.25);
});

test('nonwaiting timeline leaves finite media running while widget execution continues',()=>{
 const {project,graph,timeline}=uiStageFixture(),model=performanceTimeline(project,timeline);
 arrangePerformanceTimeline(project,timeline,model.clips.map(clip=>({...clip,at:0})),model.tracks);
 graph.nodes.find(n=>n.type==='callFunction')!.properties.wait=false;
 const at=(seconds:number)=>previewUiLogic(project,project.ui.components,'ui:main',{},[{kind:'click',componentId:'play'},{kind:'advance',seconds}],{timed:true});
 const during=at(.1);assert.equal(during.incomplete,false);assert.equal(during.stageWaiting,0);assert.equal(during.stage.sample.visuals.length,1);assert.equal(during.components.find(c=>c.component.id==='label')!.component.text,'演出完成');
 const after=at(.5);assert.equal(after.components.find(c=>c.component.id==='label')!.component.text,'全部完成');assert.equal(after.stage.sample.visuals.length,1);assert.equal(at(1.6).stage.sample.visuals.length,0);
});

test('stage completion opens confirmation and resumes widget changes only after its actual answer',()=>{
 const {project,graph}=uiStageFixture(),call=graph.nodes.find(n=>n.type==='callFunction')!,link=graph.links.find(l=>l.fromNodeId===call.id)!,after=link.toNodeId;
 const confirm=blueprintNodeDefaults('confirmMessage');confirm.properties.message='演出结束，继续？';graph.nodes.push(confirm);graph.links=graph.links.filter(l=>l.id!==link.id);
 connectBlueprintPins(graph,call.id,'exec_out',confirm.id,'exec_in');connectBlueprintPins(graph,confirm.id,'yes',after,'exec_in');
 const events=[{kind:'click' as const,componentId:'play'},{kind:'advance' as const,seconds:2}];
 const waiting=previewUiLogic(project,project.ui.components,'ui:main',{},events,{timed:true});assert.equal(waiting.incomplete,false);assert.equal(waiting.stageWaiting,0);assert.equal(waiting.pageId,'ui:messageBox');assert.equal(waiting.layers.find(p=>p.pageId==='ui:main')!.components.find(c=>c.component.id==='label')!.component.text,'尚未播放');
 const answered=previewUiLogic(project,project.ui.components,'ui:main',{},[...events,{kind:'confirm',requestId:waiting.layers.at(-1)!.instance,value:true},{kind:'advance',seconds:.25}],{timed:true});assert.equal(answered.pageId,'ui:main');assert.equal(answered.components.find(c=>c.component.id==='label')!.component.text,'演出完成');assert.ok(Math.abs(answered.components.find(c=>c.component.id==='label')!.component.style!.opacity!-.65)<1e-6);
});

test('independent UI timers keep running during stage waits and updates are observed when execution resumes',()=>{
 const {project,graph}=uiStageFixture();project.variables.push({id:'ticks',name:'时钟',type:'number',initial:0,persistent:false});
 const timer=blueprintNodeDefaults('eventTimer');timer.properties={pageId:'ui:main',interval:.5,repeat:true};
 const read=blueprintNodeDefaults('getVariable');read.properties.variableId='ticks';const add=blueprintNodeDefaults('math');add.properties={operation:'add',b:1};const write=blueprintNodeDefaults('setVariable');write.properties.variableId='ticks';graph.nodes.push(timer,read,add,write);
 connectBlueprintPins(graph,timer.id,'exec',write.id,'exec_in');connectBlueprintPins(graph,read.id,'value',add.id,'a');connectBlueprintPins(graph,add.id,'result',write.id,'value');
 const result=previewUiLogic(project,project.ui.components,'ui:main',{},[{kind:'click',componentId:'play'},{kind:'advance',seconds:2.25}],{timed:true});assert.equal(result.variables.ticks,4);assert.equal(result.incomplete,false);
});
