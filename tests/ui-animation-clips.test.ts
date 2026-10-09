import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type BlueprintNode, type UiAnimationKey } from '../src/core/model';
import { createUiAnimationClip, addUiAnimationTrack, sampleUiAnimationTrack, uiAnimationClipProblems, uiPageAnimations, uiClipComponents } from '../src/core/ui-animation-clips';
import { blueprintNodeDefaults, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createUiEventGraph, ensureUiClickEvent } from '../src/core/ui-logic';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { compileProject } from '../src/runtime/compiler';
import { applyUiDraft } from '../src/core/ui-draft';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';

const key=(id:string,time:number,value:number,easing:UiAnimationKey['easing']='linear'):UiAnimationKey=>({id,time,value,easing});
const click=(componentId='play'):UiPreviewEvent=>({kind:'click',componentId});
const advance=(seconds:number):UiPreviewEvent=>({kind:'advance',seconds});
function fixture(){
 const p=createProject();p.ui.components.push({id:'target',kind:'text',page:'main',text:'起始',x:.1,y:.1,width:.3,height:.1},...['play','stop','replace','reset'].map(id=>({id,kind:'button' as const,page:'main' as const,text:id,x:0,y:0,width:.1,height:.1})));
 const clip=createUiAnimationClip(p,'ui:main');clip.duration=3;const x=addUiAnimationTrack(clip,p.ui.components[0],'x'),opacity=addUiAnimationTrack(clip,p.ui.components[0],'opacity');x.keys=[key('x0',0,.1),key('x1',1,.9),key('x2',2,.3)];opacity.keys=[key('o0',0,1),key('o2',2,0)];
 const graph=createUiEventGraph(p,'ui:main','动画事件');
 const node=(type:BlueprintNode['type'],properties:BlueprintNode['properties']={})=>{const n=blueprintNodeDefaults(type);Object.assign(n.properties,properties);graph.nodes.push(n);return n;};
 const chain=(...nodes:BlueprintNode[])=>{for(let i=0;i<nodes.length-1;i++)assert.equal(connectBlueprintPins(graph,nodes[i].id,nodes[i].type.startsWith('event')?'exec':'exec_out',nodes[i+1].id,'exec_in'),undefined);};
 const event=(id:string)=>ensureUiClickEvent(p,graph,id,'ui:main');
 const play=node('playUiAnimation',{animationId:clip.id,wait:true});chain(event('play'),play,node('setUiProperty',{componentId:'target',property:'text',value:'已结束'}));
 const preview=(events:UiPreviewEvent[],timed=true)=>previewUiLogic(p,p.ui.components,'ui:main',{},events,{timed});
 const target=(events:UiPreviewEvent[])=>preview(events).components.find(c=>c.component.id==='target')!.component;
 synchronizeBlueprintSignatures(p);
 return {p,clip,x,opacity,graph,node,chain,event,play,preview,target};
}
test('named animation follows multiple keyframes, parallel properties and a held tail before continuing',()=>{
 const f=fixture();let t=f.target([click(),advance(.5)]);assert.equal(t.x,.5);assert.equal(t.style?.opacity,.75);assert.equal(t.text,'起始');
 t=f.target([click(),advance(1.5)]);assert.ok(Math.abs(t.x-.6)<1e-9);assert.equal(t.style?.opacity,.25);
 t=f.target([click(),advance(2.5)]);assert.equal(t.x,.3);assert.equal(t.text,'起始');
 t=f.target([click(),advance(3)]);assert.equal(t.x,.3);assert.equal(t.text,'已结束');assert.equal(f.preview([click(),advance(3)]).incomplete,false);
 assert.equal(f.preview([click()],false).components[0].component.text,'已结束');
});
test('keyframe sampling sorts time, uses per-segment easing and the captured value before the first key',()=>{
 const f=fixture();f.x.keys=[key('last',2,.9,'easein'),key('first',1,.5)];
 assert.ok(Math.abs(sampleUiAnimationTrack(f.x,.5,.1)-.3)<1e-9);assert.equal(sampleUiAnimationTrack(f.x,1,.1),.5);assert.ok(sampleUiAnimationTrack(f.x,1.5,.1)<.7);assert.equal(sampleUiAnimationTrack(f.x,3,.1),.9);
 f.chain(f.event('reset'),f.node('setUiProperty',{componentId:'target',property:'x',value:.3}));
 assert.equal(f.target([click('reset'),click(),advance(.5)]).x,.4);
});
test('replacing one property leaves other tracks waiting; named stop cannot cancel the replacement',()=>{
 const f=fixture();f.chain(f.event('replace'),f.node('animateUiProperty',{componentId:'target',property:'x',value:.7,duration:2,easing:'linear',wait:false}));
 f.chain(f.event('stop'),f.node('stopUiAnimationPlayback',{animationId:f.clip.id,finish:true}));
 let t=f.target([click(),advance(.5),click('replace'),advance(.5)]);assert.ok(Math.abs(t.x-.55)<1e-9);assert.equal(t.text,'起始');
 t=f.target([click(),advance(.5),click('replace'),click('stop'),advance(2)]);assert.equal(t.x,.7);assert.equal(t.style?.opacity,0);assert.equal(t.text,'已结束');
});
test('named stop freezes all remaining tracks and resumes the caller once',()=>{
 const f=fixture();f.chain(f.event('stop'),f.node('stopUiAnimationPlayback',{animationId:f.clip.id,finish:false}));
 const t=f.target([click(),advance(.5),click('stop'),advance(3)]);assert.equal(t.x,.5);assert.equal(t.style?.opacity,.75);assert.equal(t.text,'已结束');
});
test('restarting a named animation waits for the replacement callback before restoring the outer continuation',()=>{
 const f=fixture();f.chain(f.event('replace'),f.node('playUiAnimation',{animationId:f.clip.id,wait:true}),f.node('setUiProperty',{componentId:'target',property:'text',value:'替换回调'}));
 assert.equal(f.target([click(),advance(.5),click('replace'),advance(2)]).text,'起始');
 const t=f.target([click(),advance(.5),click('replace'),advance(3)]);assert.equal(t.text,'已结束');assert.equal(t.x,.3);
});
test('animation clips are page and scheme scoped and retain independent identities through draft merge and reload',()=>{
 const f=fixture(),base=structuredClone(f.p);f.p.ui.instances=[{id:'skin',name:'另一方案',components:[]}];f.p.ui.activeInstanceId='skin';
 const other=createUiAnimationClip(f.p,'ui:main');assert.deepEqual(uiPageAnimations(f.p,'ui:main').map(a=>a.id),[other.id]);assert.ok(uiClipComponents(f.p,f.clip).some(c=>c.id==='target'));
 f.x.keys[1].value=.6;const concurrent=structuredClone(base);concurrent.name='外部修改';const merged=projectSchema.parse(applyUiDraft(concurrent,{base,value:f.p}));assert.equal(merged.name,'外部修改');assert.equal(merged.ui.animations![0].tracks[0].keys[1].value,.6);
 synchronizeBlueprintSignatures(merged);assert.deepEqual(compileProject(merged).diagnostics.filter(d=>d.severity==='error'),[]);
});
test('invalid keyframes, duplicate tracks and missing references fail before playback mutates state',()=>{
 for(const corrupt of [(f:ReturnType<typeof fixture>)=>f.x.keys.push(key('late',4,.5)),(f:ReturnType<typeof fixture>)=>f.x.keys.push(key('same_time',1,.3)),(f:ReturnType<typeof fixture>)=>f.opacity.keys[1].value=2,(f:ReturnType<typeof fixture>)=>f.x.componentId='missing',(f:ReturnType<typeof fixture>)=>f.clip.tracks.push({...structuredClone(f.x),id:'duplicate'})]){
  const f=fixture();corrupt(f);assert.ok(uiAnimationClipProblems(f.p,f.clip).length);const preview=f.preview([click(),advance(3)]);assert.equal(preview.incomplete,true);assert.equal(preview.components[0].component.text,'起始');assert.equal(preview.components[0].component.x,.1);assert.ok(compileProject(f.p).diagnostics.some(d=>d.severity==='error'));
 }
 const f=fixture();f.p.ui.animations=[];assert.ok(compileProject(f.p).diagnostics.some(d=>d.message.includes('界面动画')));
});
test('empty and instantaneous clips finish, while static stage expansion never runs their continuation early',()=>{
 const f=fixture();f.clip.tracks=[];assert.equal(f.target([click()]).text,'已结束');
 f.clip.tracks=[f.x];f.x.keys=[key('zero',0,.8)];f.clip.duration=0;assert.equal(f.target([click()]).x,.8);assert.equal(f.target([click()]).text,'已结束');
 f.chain(f.graph.nodes[0],f.node('playUiAnimation',{animationId:f.clip.id,wait:false}),f.node('setUiProperty',{componentId:'target',property:'text',value:'不可执行'}));
 const context=previewActionContext(f.p);let written=false;context.ui={get:()=>.1,set:()=>{written=true;return true;},reset:()=>true};expandPreviewActions(f.p,[{kind:'blueprint',blueprintId:f.graph.id}],context);assert.equal(context.incomplete,true);assert.equal(written,false);
});

test('reverse samples the original eased curve and finishes at its captured initial value',()=>{
 const f=fixture();f.play.properties.playMode='reverse';f.x.keys=[key('end',3,.9,'easein')];
 assert.equal(f.target([click()]).x,.9);
 assert.ok(Math.abs(f.target([click(),advance(.5)]).x-sampleUiAnimationTrack(f.x,2.5,.1))<1e-9);
 const t=f.target([click(),advance(3)]);assert.equal(t.x,.1);assert.equal(t.style?.opacity,1);assert.equal(t.text,'已结束');
});
test('loop count and speed data pins control finite playback; pingpong includes both legs',()=>{
 const f=fixture();Object.assign(f.play.properties,{playMode:'pingpong',loops:1,speed:1});
 for(const [id,value] of [['loops',2],['speed',3]] as const){const literal=f.node('literal',{value});literal.pins[0].dataType='number';assert.equal(connectBlueprintPins(f.graph,literal.id,'value',f.play.id,id),undefined);}
 let t=f.target([click(),advance(1)]);assert.equal(t.x,.3);assert.equal(t.text,'起始');
 t=f.target([click(),advance(2)]);assert.equal(t.x,.1);assert.equal(t.style?.opacity,1);assert.equal(t.text,'起始');
 t=f.target([click(),advance(3.5)]);assert.ok(Math.abs(t.x-.6)<1e-9);assert.equal(t.text,'起始');
 t=f.target([click(),advance(4)]);assert.equal(t.x,.1);assert.equal(t.text,'已结束');
 assert.deepEqual(compileProject(f.p).diagnostics.filter(d=>d.severity==='error'),[]);
});
test('infinite playback holds the continuation until stop; finish uses the directional endpoint',()=>{
 for(const mode of ['forward','reverse','pingpong']){
  const f=fixture();Object.assign(f.play.properties,{playMode:mode,loops:0,speed:2});f.chain(f.event('stop'),f.node('stopUiAnimationPlayback',{animationId:f.clip.id,finish:true}));
  assert.equal(f.target([click(),advance(10)]).text,'起始');
  const t=f.target([click(),advance(10),click('stop'),advance(1)]);assert.equal(t.text,'已结束');assert.equal(t.x,mode==='forward'?.3:.1);
  const untimed=f.preview([click()],false);assert.equal(untimed.incomplete,true);assert.equal(untimed.components[0].component.text,'起始');
 }
});
test('mid-flight reversal preserves position and the captured source before the first key',()=>{
 const f=fixture();f.x.keys=[key('late',2,.9)];f.play.properties.wait=false;
 f.chain(f.event('replace'),f.node('playUiAnimation',{animationId:f.clip.id,playMode:'reverse',fromCurrent:true,wait:true}),f.node('setUiProperty',{componentId:'target',property:'text',value:'倒放完成'}));
 const before=f.target([click(),advance(.75)]),after=f.target([click(),advance(.75),click('replace')]);assert.equal(after.x,before.x);assert.equal(after.style?.opacity,before.style?.opacity);
 assert.ok(Math.abs(f.target([click(),advance(.75),click('replace'),advance(.25)]).x-.3)<1e-9);
 const t=f.target([click(),advance(.75),click('replace'),advance(.75)]);assert.equal(t.x,.1);assert.equal(t.text,'倒放完成');
});
test('changing direction twice keeps the same curve; a replaced track causes an explicit restart',()=>{
 const f=fixture();f.play.properties.wait=false;f.play.properties.fromCurrent=true;
 f.chain(f.event('replace'),f.node('playUiAnimation',{animationId:f.clip.id,playMode:'reverse',fromCurrent:true,wait:false}));
 f.chain(f.event('stop'),f.node('setUiProperty',{componentId:'target',property:'opacity',value:.8}));
 const events=[click(),advance(.75),click('replace'),advance(.25),click()];assert.equal(f.target(events).x,.5);assert.equal(f.target([...events,advance(.5)]).x,.9);
 const t=f.target([click(),advance(.5),click('stop'),click('replace')]);assert.equal(t.x,.3);assert.equal(t.style?.opacity,0);
});
test('invalid literal or connected playback options fail atomically and keep active animations',()=>{
 for(const properties of [{playMode:'bad'},{loops:-1},{loops:1.5},{loops:1000001},{speed:0},{speed:101},{speed:Infinity},{fromCurrent:'true'}]){
  const f=fixture();Object.assign(f.play.properties,properties);assert.ok(compileProject(f.p).diagnostics.some(d=>d.severity==='error'));const p=f.preview([click()]);assert.equal(p.incomplete,true);assert.equal(p.components[0].component.x,.1);
 }
 const f=fixture();f.play.properties.wait=false;const bad=f.node('playUiAnimation',{animationId:f.clip.id}),literal=f.node('literal',{value:-3});literal.pins[0].dataType='number';f.chain(f.event('replace'),bad);connectBlueprintPins(f.graph,literal.id,'value',bad.id,'speed');
 const p=f.preview([click(),advance(.5),click('replace'),advance(.5)]);assert.equal(p.incomplete,true);assert.equal(p.components[0].component.x,.9);
});
test('legacy nodes gain playback pins without changing saved values or links',()=>{
 const f=fixture();delete f.play.properties.playMode;delete f.play.properties.loops;delete f.play.properties.speed;delete f.play.properties.fromCurrent;f.play.pins=f.play.pins.filter(p=>!['loops','speed','fromCurrent'].includes(p.id));const links=structuredClone(f.graph.links);
 synchronizeBlueprintSignatures(f.p);synchronizeBlueprintSignatures(f.p);assert.deepEqual(f.graph.links,links);assert.equal(f.play.pins.filter(p=>p.id==='speed').length,1);assert.equal(f.target([click(),advance(3)]).text,'已结束');
 const loaded=projectSchema.parse(JSON.parse(JSON.stringify(f.p)));assert.deepEqual(compileProject(loaded).diagnostics.filter(d=>d.severity==='error'),[]);
});
test('infinite empty and zero-duration clips terminate without scheduling a loop',()=>{
 const f=fixture();Object.assign(f.play.properties,{loops:0,playMode:'reverse'});f.clip.tracks=[];assert.equal(f.target([click()]).text,'已结束');
 f.clip.duration=0;f.x.keys=[key('instant',0,.7)];f.clip.tracks=[f.x];assert.equal(f.target([click()]).x,.7);assert.equal(f.target([click()]).text,'已结束');
});
