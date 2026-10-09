import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type BlueprintNode, type Project } from '../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createUiEventGraph, ensureUiClickEvent } from '../src/core/ui-logic';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { compileProject } from '../src/runtime/compiler';
import { uiAnimationValue } from '../src/core/ui-animation';

function fixture() {
  const p=createProject(); p.ui.components.push(
    {id:'target',kind:'text',page:'main',text:'目标',x:.1,y:.2,width:.3,height:.1},
    ...['play','stop','replace','reset'].map(id=>({id,kind:'button' as const,page:'main' as const,text:id,x:0,y:0,width:.1,height:.1})),
  );
  const graph=createUiEventGraph(p,'ui:main','控件动画');
  const node=(type:BlueprintNode['type'],properties:BlueprintNode['properties']={})=>{const n=blueprintNodeDefaults(type);Object.assign(n.properties,properties);graph.nodes.push(n);return n;};
  const chain=(...nodes:BlueprintNode[])=>{for(let i=0;i<nodes.length-1;i++)assert.equal(connectBlueprintPins(graph,nodes[i].id,nodes[i].type.startsWith('event')?'exec':'exec_out',nodes[i+1].id,'exec_in'),undefined);};
  const event=(id:string)=>ensureUiClickEvent(p,graph,id,'ui:main');
  const animate=(property='x',value=.9,duration=2,wait=true)=>node('animateUiProperty',{componentId:'target',property,value,duration,wait,easing:'linear'});
  const preview=(events:UiPreviewEvent[],timed=true)=>previewUiLogic(p,p.ui.components,'ui:main',{},events,{timed});
  const target=(events:UiPreviewEvent[])=>preview(events).components.find(c=>c.component.id==='target')!.component;
  return {p,graph,node,event,chain,animate,preview,target};
}
const click=(componentId='play'):UiPreviewEvent=>({kind:'click',componentId});
const advance=(seconds:number):UiPreviewEvent=>({kind:'advance',seconds});

test('widget animation interpolates concurrent properties and resumes only at completion',()=>{
  const f=fixture(),x=f.animate('x',.9,2,false),opacity=f.animate('opacity',0,2);
  const done=f.node('setUiProperty',{componentId:'target',property:'text',value:'完成'});f.chain(f.event('play'),x,opacity,done);
  let at=f.target([click(),advance(1)]);assert.equal(at.x,.5);assert.equal(at.style?.opacity,.5);assert.equal(at.text,'目标');
  at=f.target([click(),advance(2)]);assert.equal(at.x,.9);assert.equal(at.style?.opacity,0);assert.equal(at.text,'完成');
  assert.equal(f.preview([click(),advance(2)]).incomplete,false);
  assert.equal(f.preview([click()],false).components.find(c=>c.component.id==='target')!.component.text,'完成');
});

test('replacement samples the current value and resumes the caller after the replacing callback returns',()=>{
  const f=fixture();f.chain(f.event('play'),f.animate(),f.node('setUiProperty',{componentId:'target',property:'text',value:'原等待结束'}));
  f.chain(f.event('replace'),f.animate('x',.1,1));
  const at=f.target([click(),advance(1),click('replace'),advance(.5)]);assert.ok(Math.abs(at.x-.3)<1e-9);assert.equal(at.text,'目标');
  const finished=f.target([click(),advance(1),click('replace'),advance(1)]);assert.equal(finished.x,.1);assert.equal(finished.text,'原等待结束');
});

test('stop freezes selected properties; finish and reset cancel animations deterministically',()=>{
  const f=fixture();f.chain(f.event('play'),f.animate('x',.9,2,false),f.animate('opacity',0,2,false));
  const stop=f.node('stopUiAnimation',{componentId:'target',property:'x',finish:false});f.chain(f.event('stop'),stop);
  let at=f.target([click(),advance(1),click('stop'),advance(1)]);assert.equal(at.x,.5);assert.equal(at.style?.opacity,0);
  stop.properties.finish=true;at=f.target([click(),advance(.5),click('stop')]);assert.equal(at.x,.9);assert.equal(at.style?.opacity,.75);
  f.chain(f.event('reset'),f.node('resetUiComponent',{componentId:'target'}));
  at=f.target([click(),advance(1),click('reset'),advance(3)]);assert.equal(at.x,.1);assert.equal(at.style?.opacity,1);
});

test('direct writes stop just their property and zero duration finishes immediately',()=>{
  const f=fixture();f.chain(f.event('play'),f.animate('x',.9,2,false),f.animate('opacity',0,2,false));
  f.chain(f.event('stop'),f.node('setUiProperty',{componentId:'target',property:'x',value:.35}));
  assert.equal(f.target([click(),advance(.5),click('stop'),advance(3)]).x,.35);
  const instant=f.animate('x',.7,0);f.chain(f.event('replace'),instant,f.node('setUiProperty',{componentId:'target',property:'text',value:'立即完成'}));
  const at=f.target([click('replace')]);assert.equal(at.x,.7);assert.equal(at.text,'立即完成');
});

test('invalid stop inputs leave the running animation intact',()=>{
  const f=fixture();f.chain(f.event('play'),f.animate('x',.9,2,false));
  f.chain(f.event('stop'),f.node('stopUiAnimation',{componentId:'target',property:'all',finish:'yes'}));
  const result=f.preview([click(),advance(.5),click('stop'),advance(1.5)]);
  assert.equal(result.incomplete,true);assert.equal(result.components.find(c=>c.component.id==='target')!.component.x,.9);
});

test('timers can stop animations and chained animations finish within a single large advance',()=>{
  const f=fixture();f.chain(f.event('play'),f.animate('x',.5,1),f.animate('x',.9,1));
  assert.equal(f.target([click(),advance(2)]).x,.9);
  const timer=f.node('eventTimer',{pageId:'ui:main',interval:.5,repeat:false});f.chain(timer,f.node('stopUiAnimation',{componentId:'target',property:'all',finish:false}));
  const at=f.target([click(),advance(2)]);assert.equal(at.x,.9,'cancelled first animation resumes the second from the half-way value');
});

test('invalid animated properties and values are rejected before state changes',()=>{
  for(const patch of [{property:'visible'},{property:'opacity',value:2},{duration:-1},{duration:Infinity},{easing:'unknown'},{value:'0.5'},{property:'value'}]){
    const f=fixture(),animation=f.animate();Object.assign(animation.properties,patch);f.chain(f.event('play'),animation,f.node('setUiProperty',{componentId:'target',property:'text',value:'不得执行'}));
    const result=f.preview([click(),advance(2)]);assert.equal(result.incomplete,true);assert.equal(result.components.find(c=>c.component.id==='target')!.component.text,'目标');
    assert.ok(compileProject(f.p).diagnostics.some(d=>d.severity==='error'),JSON.stringify(patch));
  }
  assert.equal(uiAnimationValue(0,1,.5,'linear'),.5);assert.ok(uiAnimationValue(0,1,.5,'easein')<.5);assert.ok(uiAnimationValue(0,1,.5,'easeout')>.5);
});

test('animation data pins survive serialization and static stage preview stops at UI animation',()=>{
  const f=fixture();f.chain(f.graph.nodes[0],f.animate(),f.node('setUiProperty',{componentId:'target',property:'text',value:'不应提前执行'}));
  synchronizeBlueprintSignatures(f.p);const loaded=projectSchema.parse(JSON.parse(JSON.stringify(f.p)));
  const animation=loaded.blueprints[0].nodes.find(n=>n.type==='animateUiProperty')!;assert.equal(animation.pins.find(p=>p.id==='value')!.dataType,'number');
  const context=previewActionContext(loaded);let written=false;context.ui={get:()=>.1,set:()=>{written=true;return true;},reset:()=>true};
  expandPreviewActions(loaded,[{kind:'blueprint',blueprintId:f.graph.id}],context);assert.equal(context.incomplete,true);assert.equal(written,false);
  assert.deepEqual(compileProject(loaded).diagnostics.filter(d=>d.severity==='error'),[]);
});
