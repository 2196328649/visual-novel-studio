import { addProjectGraphs, projectGraphs } from '../src/core/project-resources';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema } from '../src/core/model';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs } from '../src/core/blueprint-authoring';
import { blueprintNodeDefaults } from '../src/core/blueprint';
import { linePreviewSnapshot, linePlaybackPlan, sampleLinePlayback } from '../src/core/line-preview';
import { moveStageActor, stageEditedProject } from '../src/core/stage-edit';
import { projectToText, applyTextScript } from '../src/core/text-script';
import { compileProject } from '../src/runtime/compiler';

test('dynamic move offsets retain wiring, speaker identity, endpoints and normalized time across lines',()=>{
 for(const speaker of [false,true])for(const later of [false,true]){
  const p=createProject();p.assets=[{id:'portrait',name:'立绘',kind:'image',path:'actor.png'}];
  p.characters=['hero','other'].map(id=>({id,name:id,color:'#ffffff',expressions:[{id:id==='hero'?'normal':'other_normal',name:'通常',assetId:'portrait'}]}));
  const graph=blueprintFromPerformance(p,[{kind:'show',characterId:'hero',expressionId:'normal',x:.5,y:1,scale:.6,layer:10,transition:'move',duration:2,wait:false,lifetime:'persistent'},{kind:'pause',seconds:.5}],'动态入场');
  const show=graph.nodes.find(n=>n.type==='showCharacter')!;
  if(speaker){show.type='showCharacter';show.properties.characterId='';show.pins=blueprintNodeDefaults('showCharacter').pins;}
  exposePerformanceInputs(graph,performanceInputs(graph).filter(f=>['x','duration'].includes(f.pinId)));
  addProjectGraphs(p, graph);
  const passage=p.nodes.find(n=>n.kind==='passage')!;
  passage.lines=[{id:'first',speakerId:'hero',text:'第一句',actions:[{kind:'blueprint',blueprintId:graph.id}]},{id:'second',speakerId:'other',text:'第二句',actions:[]}];
  const selection={nodeId:passage.id,lineId:later?'second':'first'},time=later?500:1000,links=structuredClone(graph.links);
  p.scriptText={format:'vns-text-1',content:projectToText(p)};
  const edited=stageEditedProject(p,draft=>moveStageActor(draft,selection,'hero',{x:.7,rotation:20},time))!;assert.ok(edited);
  const saved=applyTextScript(projectSchema.parse(JSON.parse(JSON.stringify(edited.project))),edited.source).project;
  const g=projectGraphs(saved).find(g=>g.id===graph.id)!,source=g.nodes.find(n=>n.id===show.id)!;
  assert.deepEqual(g.links,links);assert.equal(source.type,show.type);assert.equal(projectGraphs(saved).length,1);
  const sample=(ms:number)=>{const snap=linePreviewSnapshot(saved,selection);return sampleLinePlayback(snap.before,linePlaybackPlan(snap.before,snap.actions),ms).state.actors.get('hero')!;};
  assert.ok(Math.abs(sample(time).x-.7)<1e-9);assert.equal(sample(time).rotation,20);
  assert.equal(sample(later?1500:2000).x,.5);assert.equal(sample(later?1500:2000).rotation,0);
  moveStageActor(saved,selection,'hero',{x:.75},time);assert.ok(Math.abs(sample(time).x-.75)<1e-9);
  const x=g.exposedInputs.find(p=>g.links.some(l=>l.toPinId==='x'&&g.nodes.find(n=>n.id===l.fromNodeId)?.properties.inputId===p.id))!;
  const duration=g.exposedInputs.find(p=>g.links.some(l=>l.toPinId==='duration'&&g.nodes.find(n=>n.id===l.fromNodeId)?.properties.inputId===p.id))!;
  const first=saved.nodes.find(n=>n.id===passage.id)!;assert.equal(first.kind,'passage');if(first.kind!=='passage')throw Error();
  first.lines[0].actions=[{kind:'blueprint',blueprintId:g.id,inputs:{[x.id]:.8,[duration.id]:4}}];
  assert.ok(Math.abs(sample(later?1500:2000).x-1.05)<1e-9);assert.equal(sample(later?3500:4000).x,.8);
  if(speaker){
    first.lines[0].speakerId='other';source.properties.expressionId='';
    const snap=linePreviewSnapshot(saved,selection),pose=sampleLinePlayback(snap.before,linePlaybackPlan(snap.before,snap.actions),later?1500:2000).state.actors.get('other');
    assert.ok(pose);assert.ok(Math.abs(pose.x-1.05)<1e-9);
  }
  assert.deepEqual(compileProject(saved).diagnostics.filter(d=>d.severity==='error'),[]);
 }
});

test('dynamic dissolve and fade edit offsets without fixing inputs or replacing transitions',()=>{
 for(const transition of ['dissolve','fade'] as const)for(const speaker of [false,true])for(const wait of [false,true]){
  const p=createProject();p.assets=[{id:'portrait',name:'立绘',kind:'image',path:'actor.png'}];
  p.characters=[{id:'hero',name:'角色',color:'#ffffff',expressions:[{id:'normal',name:'通常',assetId:'portrait'}]}];
  const graph=blueprintFromPerformance(p,[{kind:'show',characterId:'hero',expressionId:'normal',x:.5,y:1,scale:.6,layer:10,transition,duration:2,wait,lifetime:'persistent'},{kind:'pause',seconds:.5}],'共享入场');
  const show=graph.nodes.find(n=>n.type==='showCharacter')!;
  if(speaker){show.type='showCharacter';show.properties.characterId='';show.pins=blueprintNodeDefaults('showCharacter').pins;}
  exposePerformanceInputs(graph,performanceInputs(graph).filter(f=>['x','duration'].includes(f.pinId)));addProjectGraphs(p, graph);
  const passage=p.nodes.find(n=>n.kind==='passage')!;
  passage.lines=[{id:'first',speakerId:'hero',text:'第一句',actions:[{kind:'blueprint',blueprintId:graph.id}]},{id:'next',speakerId:'hero',text:'第二句',actions:[]}];
  const selection={nodeId:passage.id,lineId:'first'},links=structuredClone(graph.links);
  const sample=(ms:number,lineId='first')=>{const snap=linePreviewSnapshot(p,{...selection,lineId});return sampleLinePlayback(snap.before,linePlaybackPlan(snap.before,snap.actions),ms);};
  moveStageActor(p,selection,'hero',{x:.7,rotation:20,opacity:.6},1000);
  assert.deepEqual(graph.links,links);assert.equal(graph.nodes.find(n=>n.id===show.id)!.type,show.type);assert.equal(projectGraphs(p).length,1);
  const mid=sample(1000);assert.equal(mid.transition?.type,transition);assert.equal(mid.transition?.progress,.5);
  assert.ok(Math.abs(mid.state.actors.get('hero')!.x-.7)<1e-9);assert.equal(mid.state.actors.get('hero')!.opacity,.6);
  assert.equal(sample(2000).state.actors.get('hero')!.x,.5);assert.equal(sample(2000).state.actors.get('hero')!.opacity,1);
  if(!wait){assert.equal(sample(500,'next').state.actors.get('hero')!.x,.7);moveStageActor(p,{...selection,lineId:'next'},'hero',{x:.75},500);assert.equal(sample(1000).state.actors.get('hero')!.x,.75);}
  const input=(pin:string)=>graph.exposedInputs.find(i=>graph.links.some(l=>l.toPinId===pin&&graph.nodes.find(n=>n.id===l.fromNodeId)?.properties.inputId===i.id))!.id;
  passage.lines[0].actions=[{kind:'blueprint',blueprintId:graph.id,inputs:{[input('x')]:.8,[input('duration')]:4}}];
  assert.ok(Math.abs(sample(2000).state.actors.get('hero')!.x-(wait?1:1.05))<1e-9);assert.equal(sample(4000).state.actors.get('hero')!.x,.8);
  const saved=applyTextScript(projectSchema.parse(JSON.parse(JSON.stringify(p))),projectToText(p)).project;
  assert.deepEqual(projectGraphs(saved)[0].links,links);
  const compiled=compileProject(saved);assert.deepEqual(compiled.diagnostics.filter(d=>d.severity==='error'),[]);assert.match(compiled.files['game/story.rpy'],/offset_duration=/);
 }
});

test('first cross-line dissolve and fade edit locates a dynamic source with no existing offsets',()=>{
 for(const transition of ['dissolve','fade'] as const)for(const speaker of [false,true])for(const wait of [false]){
  const p=createProject();p.assets=[{id:'portrait',name:'立绘',kind:'image',path:'actor.png'}];
  p.characters=[{id:'hero',name:'角色',color:'#ffffff',expressions:[{id:'normal',name:'通常',assetId:'portrait'}]}];
  const graph=blueprintFromPerformance(p,[{kind:'show',characterId:'hero',expressionId:'normal',x:.5,y:1,scale:.6,layer:10,transition,duration:2,wait,lifetime:'persistent'},{kind:'pause',seconds:.5}],'共享入场');
  const show=graph.nodes.find(n=>n.type==='showCharacter')!;
  if(speaker){show.type='showCharacter';show.properties.characterId='';show.pins=blueprintNodeDefaults('showCharacter').pins;}
  exposePerformanceInputs(graph,performanceInputs(graph).filter(f=>['x','duration'].includes(f.pinId)));addProjectGraphs(p, graph);
  const passage=p.nodes.find(n=>n.kind==='passage')!;
  passage.lines=[{id:'first',speakerId:'hero',text:'第一句',actions:[{kind:'blueprint',blueprintId:graph.id}]},{id:'next',speakerId:'hero',text:'第二句',actions:[]}];
  const selection={nodeId:passage.id,lineId:'first'},links=structuredClone(graph.links);
  const sample=(ms:number,lineId='first')=>{const snap=linePreviewSnapshot(p,{...selection,lineId});return sampleLinePlayback(snap.before,linePlaybackPlan(snap.before,snap.actions),ms);};
  moveStageActor(p,{...selection,lineId:'next'},'hero',{x:.7,rotation:20,opacity:.6},500);
  assert.deepEqual(graph.links,links);assert.equal(graph.nodes.find(n=>n.id===show.id)!.type,show.type);assert.equal(projectGraphs(p).length,1);
  const mid=sample(1000);assert.equal(mid.transition?.type,transition);assert.equal(mid.transition?.progress,.5);
  assert.ok(Math.abs(mid.state.actors.get('hero')!.x-.7)<1e-9);assert.equal(mid.state.actors.get('hero')!.opacity,.6);
  assert.equal(sample(2000).state.actors.get('hero')!.x,.5);assert.equal(sample(2000).state.actors.get('hero')!.opacity,1);
  if(!wait){assert.equal(sample(500,'next').state.actors.get('hero')!.x,.7);moveStageActor(p,{...selection,lineId:'next'},'hero',{x:.75},500);assert.equal(sample(1000).state.actors.get('hero')!.x,.75);}
  const input=(pin:string)=>graph.exposedInputs.find(i=>graph.links.some(l=>l.toPinId===pin&&graph.nodes.find(n=>n.id===l.fromNodeId)?.properties.inputId===i.id))!.id;
  passage.lines[0].actions=[{kind:'blueprint',blueprintId:graph.id,inputs:{[input('x')]:.8,[input('duration')]:4}}];
  assert.ok(Math.abs(sample(2000).state.actors.get('hero')!.x-(wait?1:1.05))<1e-9);assert.equal(sample(4000).state.actors.get('hero')!.x,.8);
  const saved=applyTextScript(projectSchema.parse(JSON.parse(JSON.stringify(p))),projectToText(p)).project;
  assert.deepEqual(projectGraphs(saved)[0].links,links);
  const compiled=compileProject(saved);assert.deepEqual(compiled.diagnostics.filter(d=>d.severity==='error'),[]);assert.match(compiled.files['game/story.rpy'],/offset_duration=/);
 }
});

test('entrance curve edits merge colliding frames, preserve other properties and remove empty offsets atomically',async()=>{
 const {setMoveOffsetCurve,nodeMoveOffsets}=await import('../src/core/move-offsets');
 const node=blueprintNodeDefaults('showCharacter');node.properties.characterId='hero';
 setMoveOffsetCurve(node,'x',[{at:1,value:0,easing:'linear'},{at:.5,value:.2,easing:'ease'},{at:0,value:0,easing:'linear'},{at:.5,value:.3,easing:'easeout'}]);
 assert.deepEqual(nodeMoveOffsets(node)?.x?.map(f=>[f.at,f.value]),[[0,0],[.5,.3],[1,0]]);
 setMoveOffsetCurve(node,'rotation',[{at:.5,value:20,easing:'linear'}]);
 const saved=JSON.stringify(node);assert.throws(()=>setMoveOffsetCurve(node,'x',[{at:1.1,value:0,easing:'linear'}]));assert.equal(JSON.stringify(node),saved);
 setMoveOffsetCurve(node,'x',[]);assert.equal(nodeMoveOffsets(node)?.x,undefined);assert.equal(nodeMoveOffsets(node)?.rotation?.[0].value,20);
 setMoveOffsetCurve(node,'rotation',undefined);assert.equal(Object.hasOwn(node.properties,'moveOffsets'),false);assert.equal(node.properties.characterId,'hero');
});

test('shared seconds tracks write normalized progress and keep dynamic duration changes independent',async()=>{
 const {moveOffsetTimelineFrames,setMoveOffsetTimelineFrames,setMoveOffsetCurve,nodeMoveOffsets}=await import('../src/core/move-offsets');
 const node=blueprintNodeDefaults('showCharacter');setMoveOffsetCurve(node,'x',[{at:0,value:0,easing:'linear'},{at:.5,value:.3,easing:'easeout'},{at:1,value:0,easing:'linear'}]);
 let frames=moveOffsetTimelineFrames(node,'x',4)!;assert.deepEqual(frames.map(f=>f.at),[0,2,4]);
 frames[1].at=3;setMoveOffsetTimelineFrames(node,'x',4,frames);assert.equal(nodeMoveOffsets(node)?.x?.[1].at,.75);
 assert.deepEqual(moveOffsetTimelineFrames(node,'x',8)?.map(f=>f.at),[0,6,8]);
 const saved=JSON.stringify(node);assert.throws(()=>setMoveOffsetTimelineFrames(node,'x',0,frames));assert.equal(JSON.stringify(node),saved);
 frames=moveOffsetTimelineFrames(node,'x',4)!;frames[1].at=9;setMoveOffsetTimelineFrames(node,'x',4,frames);assert.deepEqual(nodeMoveOffsets(node)?.x?.map(f=>[f.at,f.value]),[[0,0],[1,.3]]);
});

test('legacy saved and direct show offsets edit in place across lines and roundtrip without materializing',async()=>{
 const {nodeMoveOffsets,setMoveOffsetCurve}=await import('../src/core/move-offsets');
 const {performanceTimeline,arrangePerformanceTimeline}=await import('../src/core/performance-timeline');
 for(const savedNode of [false,true])for(const later of [false,true])for(const transition of ['move','dissolve','fade'] as const){
  const p=createProject();p.assets=[{id:'portrait',name:'立绘',kind:'image',path:'actor.png'}];p.characters=[{id:'hero',name:'角色',color:'#ffffff',expressions:[{id:'normal',name:'通常',assetId:'portrait'}]}];
  const action={kind:'show' as const,characterId:'hero',expressionId:'normal',x:.5,y:1,scale:.6,layer:10,transition,duration:2,wait:false,lifetime:'persistent' as const,moveOffsets:{x:[{at:0,value:0,easing:'linear' as const},{at:.5,value:.1,easing:'linear' as const},{at:1,value:0,easing:'linear' as const}]}};
  const graph=blueprintFromPerformance(p,[action,{kind:'pause',seconds:.5}],'旧演出'),node=graph.nodes.find(n=>n.type==='showCharacter')!;
  node.type='savedAction';node.pins=blueprintNodeDefaults('savedAction').pins;node.properties={action:JSON.stringify(action)};
  const passage=p.nodes.find(n=>n.kind==='passage')!;
  if(savedNode)addProjectGraphs(p, graph);
  passage.lines=[{id:'first',text:'第一句',actions:savedNode?[{kind:'blueprint',blueprintId:graph.id}]:[action,{kind:'pause',seconds:.5}]},{id:'next',text:'第二句',actions:[]}];
  const selection={nodeId:passage.id,lineId:later?'next':'first'},time=later?500:1000;
  p.scriptText={format:'vns-text-1',content:projectToText(p)};
  const result=stageEditedProject(p,draft=>moveStageActor(draft,selection,'hero',{x:.7},time))!;assert.ok(result);
  const restored=applyTextScript(projectSchema.parse(JSON.parse(JSON.stringify(result.project))),result.source).project;
  const snap=linePreviewSnapshot(restored,selection),pose=sampleLinePlayback(snap.before,linePlaybackPlan(snap.before,snap.actions),time).state.actors.get('hero')!;
  assert.ok(Math.abs(pose.x-.7)<1e-9);assert.equal(projectGraphs(restored).length,savedNode?1:0);
  if(savedNode){const n=projectGraphs(restored)[0].nodes.find(n=>n.id===node.id)!;assert.equal(n.type,'savedAction');assert.equal(n.properties.moveOffsets,undefined);assert.ok(nodeMoveOffsets(n)?.x);setMoveOffsetCurve(n,'x',undefined);assert.equal(JSON.parse(String(n.properties.action)).moveOffsets,undefined);
   projectGraphs(restored)[0].timelineComponent=true;const model=performanceTimeline(restored,projectGraphs(restored)[0]);assert.equal(model.reason,undefined);arrangePerformanceTimeline(restored,projectGraphs(restored)[0],model.clips,model.tracks);assert.equal(performanceTimeline(restored,projectGraphs(restored)[0]).until,2);
  }else{const n=restored.nodes.find(n=>n.id===passage.id)!;assert.equal(n.kind,'passage');if(n.kind==='passage'){assert.equal(n.lines[0].actions.length,2);assert.deepEqual(n.lines[1].actions,[]);}}
  assert.deepEqual(compileProject(restored).diagnostics.filter(d=>d.severity==='error'),[]);
 }
});


test('post-entrance seconds preserve original motion and dynamic inputs in same and later lines',async()=>{
 const {nodeAfterOffsets}=await import('../src/core/move-offsets');
 const {performanceTimeline,arrangePerformanceTimeline}=await import('../src/core/performance-timeline');
 for(const kind of ['direct','saved','dynamic','speaker'] as const)for(const transition of ['none','move','dissolve','fade'] as const)for(const wait of [false,true])for(const later of [false,true]){
  const p=createProject();p.assets=[{id:'portrait',name:'立绘',kind:'image',path:'actor.png'}];p.characters=[{id:'hero',name:'角色',color:'#ffffff',expressions:[{id:'normal',name:'通常',assetId:'portrait'}]}];
  const show={kind:'show' as const,characterId:'hero',expressionId:'normal',x:.5,y:1,scale:.6,layer:10,transition,duration:2,wait,lifetime:'persistent' as const};
  if(kind==='direct')Object.assign(show,{moveOffsets:{x:[{at:0,value:0,easing:'linear'},{at:1,value:0,easing:'linear'}]}});
  const entrance=transition==='none'?0:2;
  const graph=blueprintFromPerformance(p,[show,{kind:'pause',seconds:.5}],'共享动作'),node=graph.nodes.find(n=>n.type==='showCharacter')!;
  if(kind==='saved'){node.type='savedAction';node.pins=blueprintNodeDefaults('savedAction').pins;node.properties={action:JSON.stringify(show)};}
  if(kind==='speaker'){node.type='showCharacter';node.properties.characterId='';node.pins=blueprintNodeDefaults('showCharacter').pins;node.properties.expressionId='';}
  if(kind==='dynamic'||kind==='speaker')exposePerformanceInputs(graph,performanceInputs(graph).filter(f=>['x','duration'].includes(f.pinId)));
  if(kind!=='direct')addProjectGraphs(p, graph);
  const passage=p.nodes.find(n=>n.kind==='passage')!;
  passage.lines=[{id:'first',speakerId:'hero',text:'第一句',actions:kind==='direct'?[show,{kind:'pause',seconds:.5}]:[{kind:'blueprint',blueprintId:graph.id}]},{id:'next',speakerId:'hero',text:'第二句',actions:[]}];
  const selection={nodeId:passage.id,lineId:later?'next':'first'},prior=(wait?entrance:0)+.5,time=(entrance+1-(later?prior:0))*1000,links=structuredClone(graph.links);
  const sample=(project:typeof p,lineId:string,ms:number)=>{const snap=linePreviewSnapshot(project,{nodeId:passage.id,lineId});return sampleLinePlayback(snap.before,linePlaybackPlan(snap.before,snap.actions),ms).state.actors.get('hero')!;};
  const before=[0,.25,.5,1,1.9].filter(t=>t<entrance).map(t=>[t,sample(p,'first',t*1000)] as const);
  p.scriptText={format:'vns-text-1',content:projectToText(p)};
  const edited=stageEditedProject(p,draft=>moveStageActor(draft,selection,'hero',{x:.7,rotation:20},time))!;assert.ok(edited);
  const saved=applyTextScript(projectSchema.parse(JSON.parse(JSON.stringify(edited.project))),edited.source).project;
  for(const [t,pose]of before){const actual=sample(saved,'first',t*1000);for(const key of ['x','y','scale','rotation','opacity'] as const)assert.equal(actual[key],pose[key]);}
  assert.ok(Math.abs(sample(saved,selection.lineId,time).x-.7)<1e-9);assert.equal(sample(saved,selection.lineId,time).rotation,20);
  const snap=linePreviewSnapshot(saved,{nodeId:passage.id,lineId:'first'});assert.equal(linePlaybackPlan(snap.before,snap.actions).dialogueAt,prior*1000);
  assert.equal(projectGraphs(saved).length,kind==='direct'?0:1);
  if(kind!=='direct'){
   const g=projectGraphs(saved)[0],n=g.nodes.find(n=>n.id===node.id)!;assert.deepEqual(g.links,links);assert.equal(nodeAfterOffsets(n)?.x?.at(-1)?.at,1);
   if(kind==='dynamic'||kind==='speaker'){
    const field=(pin:string)=>g.exposedInputs.find(i=>g.links.some(l=>l.toPinId===pin&&g.nodes.find(n=>n.id===l.fromNodeId)?.properties.inputId===i.id))!;
    const line=saved.nodes.find(n=>n.id===passage.id)!;if(line.kind!=='passage')throw Error();line.lines[0].actions=[{kind:'blueprint',blueprintId:g.id,inputs:{[field('x').id]:.8,[field('duration').id]:4}}];
    assert.ok(Math.abs(sample(saved,'first',(transition==='none'?1:5)*1000).x-1)<1e-9);
   }
   g.timelineComponent=true;const model=performanceTimeline(saved,g);arrangePerformanceTimeline(saved,g,model.clips,model.tracks);
   assert.ok(performanceTimeline(saved,g).until>=entrance+1);
  }
  assert.deepEqual(compileProject(saved).diagnostics.filter(d=>d.severity==='error'),[]);
 }
});


test('plain nonblocking direct entrances keep their earlier motion when extended after completion',()=>{
 for(const transition of ['move','dissolve','fade'] as const){
  const p=createProject();p.assets=[{id:'portrait',name:'立绘',kind:'image',path:'actor.png'}];p.characters=[{id:'hero',name:'角色',color:'#ffffff',expressions:[{id:'normal',name:'通常',assetId:'portrait'}]}];
  const passage=p.nodes.find(n=>n.kind==='passage')!;passage.lines=[{id:'line',text:'台词',actions:[{kind:'show',characterId:'hero',expressionId:'normal',x:.5,y:1,scale:.6,layer:10,transition,duration:2,wait:false},{kind:'pause',seconds:.5}]}];
  const selection={nodeId:passage.id,lineId:'line'},sample=(ms:number)=>{const snap=linePreviewSnapshot(p,selection);return sampleLinePlayback(snap.before,linePlaybackPlan(snap.before,snap.actions),ms).state.actors.get('hero')!;};
  const earlier=sample(1000);moveStageActor(p,selection,'hero',{x:.8},3000);
  assert.equal(sample(1000).x,earlier.x);assert.equal(sample(1000).opacity,earlier.opacity);assert.equal(sample(3000).x,.8);assert.equal(passage.lines[0].actions.length,2);
 }
});
