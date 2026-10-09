import assert from 'node:assert/strict';
import { createProject, type BlueprintNode } from '../../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createUiEventGraph, ensureUiButtonEvent, ensureUiClickEvent } from '../../src/core/ui-logic';
import { createUiAnimationClip, addUiAnimationTrack } from '../../src/core/ui-animation-clips';

export function animationPlaybackFixture(authored=true) {
 const project=createProject('控件动画方向与循环');project.ui.pages={...project.ui.pages,main:{layout:'custom'}};
 project.ui.components.push({id:'target',name:'动画文字',kind:'text',page:'main',text:'跟随蓝图移动',x:.1,y:.5,width:.25,height:.1},
  ...['hover','loops','infinite','stop','finish','reset','start'].map((id,i)=>({id,name:({hover:'悬停触发按钮',loops:'往返播放按钮',infinite:'无限播放按钮',stop:'停止按钮',finish:'完成按钮',reset:'重置按钮',start:'开始按钮'}[id])!,kind:'button' as const,page:'main' as const,text:({hover:'悬停展开',loops:'往返两次',infinite:'无限倒放',stop:'停在当前位置',finish:'到达方向终点',reset:'重置',start:'进入存档测试'}[id])!,x:.03+(i%4)*.24,y:i<4?.1:.27,width:.22,height:.1,...(id==='start'?{action:'start' as const}:{})})),
  {id:'trace',kind:'text',page:'main',text:'等待操作',x:.1,y:.75,width:.8,height:.1},
  {id:'saved_target',kind:'text',page:'say',text:'循环保存恢复',x:.1,y:.1,width:.25,height:.1});
 project.variables.push({id:'play_loops',name:'循环次数',type:'number',initial:2,persistent:false},{id:'play_speed',name:'播放倍率',type:'number',initial:2,persistent:false});
 const clip=createUiAnimationClip(project,'ui:main');clip.name='提示展开';clip.duration=2;
 const x=addUiAnimationTrack(clip,project.ui.components[0],'x');x.keys[1].value=.7;x.keys[1].time=2;
 const opacity=addUiAnimationTrack(clip,project.ui.components[0],'opacity');opacity.keys[1].value=.3;opacity.keys[1].time=2;
 const savedClip=createUiAnimationClip(project,'ui:say');savedClip.duration=4;const saved=addUiAnimationTrack(savedClip,project.ui.components.find(c=>c.id==='saved_target')!,'x');saved.keys[1].value=.9;saved.keys[1].time=4;
 if(authored){
  const graph=createUiEventGraph(project,'ui:main','控件动画事件');
  const node=(type:BlueprintNode['type'],properties:BlueprintNode['properties']={})=>{const n=blueprintNodeDefaults(type);Object.assign(n.properties,properties);graph.nodes.push(n);return n;};
  const link=(a:BlueprintNode,out:string,b:BlueprintNode,input:string)=>assert.equal(connectBlueprintPins(graph,a.id,out,b.id,input),undefined);
  const chain=(...nodes:BlueprintNode[])=>{for(let i=1;i<nodes.length;i++)link(nodes[i-1],nodes[i-1].type.startsWith('event')?'exec':'exec_out',nodes[i],'exec_in');};
  const event=(id:string)=>ensureUiClickEvent(project,graph,id,'ui:main');
  for(const trigger of ['hover','unhover'] as const)chain(ensureUiButtonEvent(project,graph,'hover','ui:main',trigger),node('playUiAnimation',{animationId:clip.id,playMode:trigger==='hover'?'forward':'reverse',fromCurrent:true,wait:false}));
  const loops=node('playUiAnimation',{animationId:clip.id,playMode:'pingpong'});chain(event('loops'),loops,node('setUiProperty',{componentId:'trace',property:'text',value:'往返完成'}));
  for(const [id,pin] of [['play_loops','loops'],['play_speed','speed']])link(node('getVariable',{variableId:id}),'value',loops,pin);
  chain(event('infinite'),node('playUiAnimation',{animationId:clip.id,playMode:'reverse',loops:0}),node('setUiProperty',{componentId:'trace',property:'text',value:'无限等待已结束'}));
  for(const id of ['stop','finish'])chain(event(id),node('stopUiAnimationPlayback',{animationId:clip.id,finish:id==='finish'}));
  chain(event('reset'),node('resetUiComponent',{componentId:'target'}),node('setUiProperty',{componentId:'trace',property:'text',value:'等待操作'}));
  const savedGraph=createUiEventGraph(project,'ui:say','循环存档'),play=blueprintNodeDefaults('playUiAnimation');Object.assign(play.properties,{animationId:savedClip.id,playMode:'pingpong',loops:0,speed:2,wait:false});savedGraph.nodes.push(play);connectBlueprintPins(savedGraph,savedGraph.nodes[0].id,'exec',play.id,'exec_in');
 }
 const passage=project.nodes.find(n=>n.kind==='passage')!;passage.lines=[{id:'save_line',text:'在往返回程中保存，读取后继续回程。',actions:[]}];project.entryId=passage.id;
 synchronizeBlueprintSignatures(project);return {project,clip,savedClip};
}
