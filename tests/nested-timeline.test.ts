import { addProjectGraphs, projectGraphs } from '../src/core/project-resources';
import { timelineInterleaveDiagnostics } from '../src/core/timeline-interleave';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { blueprintFromPerformance, performanceInputs, exposePerformanceInputs } from '../src/core/blueprint-authoring';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins } from '../src/core/blueprint';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { chapterCompositionBlueprint } from '../src/core/chapter-composition-blueprint';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { performanceTiming } from '../src/core/performance-timing';
import { canLaunchTimeline } from '../src/core/timeline-launch';
import { compileProject } from '../src/runtime/compiler';

test('nested title timelines remain editable, retain subsequent clip timing and compile as a call', () => {
 const project=createProject();
 const child=chapterCompositionBlueprint(project,{title:'标题',subtitle:'',duration:7,effect:'fade'}).graph;child.timelineComponent=true;addProjectGraphs(project, child);
 const parent=blueprintFromPerformance(project,[],'外层');parent.timelineComponent=true;addProjectGraphs(project, parent);
 const call=blueprintNodeDefaults('callFunction');call.properties.graphId=child.id;call.pins=callablePins(child);parent.nodes.push(call);
 connectBlueprintPins(parent,parent.nodes[0].id,'exec',call.id,'exec_in');
 let model=performanceTimeline(project,parent);assert.equal(model.reason,undefined);assert.equal(model.clips.length,1);
 const stop=blueprintNodeDefaults('stopMusic');stop.properties.fade=0;parent.nodes.push(stop);connectBlueprintPins(parent,call.id,'exec_out',stop.id,'exec_in');
 model=performanceTimeline(project,parent);const duration=model.clips[0].duration;
 const clips=model.clips.map(clip=>({...clip,at:clip.nodeId===call.id?2:duration+4}));
 arrangePerformanceTimeline(project,parent,clips,model.tracks);
 const moved=performanceTimeline(project,parent);assert.equal(moved.clips[0].at,2);assert.ok(Math.abs(moved.clips[1].at-(duration+4))<.001);
 const compiled=compileProject(project);assert.ok(compiled.files['game/story.rpy'].includes(`call vn_blueprint_${child.id}`));
 const copy=structuredClone(project), outer=projectGraphs(copy).find(graph=>graph.id===parent.id)!;
 assert.equal(canLaunchTimeline(copy,child),true);
 arrangePerformanceTimeline(copy,outer,clips.map(clip=>({...clip,at:2})),model.tracks);
 const overlapping=performanceTimeline(copy,outer);assert.deepEqual(overlapping.clips.map(clip=>clip.at),[2,2]);
 const actions=expandPreviewActions(copy,[{kind:'blueprint',blueprintId:outer.id}],previewActionContext(copy));
 const stopIndex=actions.findIndex(action=>action.kind==='stopMusic');
 assert.equal(performanceTiming(actions.slice(0,stopIndex)).at,2);
 assert.equal(performanceTiming(actions).at,2+duration);
 const code=compileProject(copy).files['game/story.rpy'];
 assert.ok(code.includes(`vn_bp_launch_${child.id}=True`));
 assert.ok(code.includes(`float(_return)`));
 // A delayed child shares its parent's schedule without moving the parent's later clips.
 const delayed=projectGraphs(copy).find(graph=>graph.id===child.id)!;
 const inner=performanceTimeline(copy,delayed);
 arrangePerformanceTimeline(copy,delayed,inner.clips.map(clip=>({...clip,at:1})),inner.tracks);
 assert.equal(canLaunchTimeline(copy,delayed),false);
 const before=structuredClone(copy);
 assert.deepEqual(performanceTimeline(copy,outer).clips.map(clip=>clip.at),[2,2]);
 const mixedContext=previewActionContext(copy);mixedContext.actionOrigins=new Map();
 const mixed=expandPreviewActions(copy,[{kind:'blueprint',blueprintId:outer.id}],mixedContext,[{nodeId:'origin_passage',lineId:'origin_line',actionIndex:0}]);
 const mixedStop=mixed.findIndex(action=>action.kind==='stopMusic'),visual=mixed.findIndex(action=>action.kind==='visual');
 assert.equal(performanceTiming(mixed.slice(0,mixedStop)).at,2);
 assert.equal(performanceTiming(mixed.slice(0,visual)).at,3);
 assert.equal(mixedContext.actionOrigins.get(mixed[visual])?.blueprintId,delayed.id);
 assert.equal(performanceTiming(mixed).at,3+duration);
 assert.deepEqual(copy,before);
 arrangePerformanceTimeline(copy,outer,overlapping.clips,overlapping.tracks);
 const compiledMixed=compileProject(copy);assert.ok(!compiledMixed.diagnostics.some(d=>d.severity==='error'));
 const parentCode=compiledMixed.files['game/story.rpy'].split('label vn_blueprint_'+outer.id)[1].split('\nlabel ')[0];
 assert.ok(!parentCode.includes('call vn_blueprint_'+child.id));
});


test('interleaving preserves separate argument values for repeated delayed timeline calls',()=>{
 const project=createProject();
 const built=chapterCompositionBlueprint(project,{title:'默认标题',subtitle:'',duration:2,effect:'fade'}),child=built.graph;child.timelineComponent=true;addProjectGraphs(project, child);
 let model=performanceTimeline(project,child);arrangePerformanceTimeline(project,child,model.clips.map(c=>({...c,at:.5})),model.tracks);
 const root=blueprintFromPerformance(project,[],'重复调用');addProjectGraphs(project, root);let previous=root.nodes[0];
 for(const title of ['甲标题','乙标题']){const call=blueprintNodeDefaults('callFunction');call.properties={graphId:child.id,['arg_'+built.chapterInputs.title]:title,['arg_'+built.chapterInputs.duration]:title==='甲标题'?1:3};call.pins=callablePins(child);root.nodes.push(call);connectBlueprintPins(root,previous.id,previous.type==='event'?'exec':'exec_out',call.id,'exec_in');previous=call;}
 model=performanceTimeline(project,root);arrangePerformanceTimeline(project,root,model.clips.map((c,i)=>({...c,at:i*.2,trackId:'call_'+i})),model.clips.map((_,i)=>({id:'call_'+i,name:'调用 '+i})));
 const before=structuredClone(project),context=previewActionContext(project);const actions=expandPreviewActions(project,[{kind:'blueprint',blueprintId:root.id}],context);
 assert.equal(context.incomplete,false);assert.equal(performanceTiming(actions).at,3.7);assert.match(JSON.stringify(actions),/甲标题/);assert.match(JSON.stringify(actions),/乙标题/);assert.deepEqual(project,before);
 const output=compileProject(project);assert.equal(output.diagnostics.some(d=>d.severity==='error'),false);
});


test('delayed timeline asset arguments retain explicit empty and supplied resources',()=>{
 const project=createProject();project.assets.push({id:'default_image',name:'默认图片',kind:'image',path:'default.png'},{id:'other_image',name:'传入图片',kind:'image',path:'other.png'});
 const child=blueprintFromPerformance(project,[{kind:'background',assetId:'default_image',transition:'none',duration:0,wait:false}],'图片时间轴');addProjectGraphs(project, child);
 exposePerformanceInputs(child,performanceInputs(child).filter(field=>field.pinId==='assetId'));assert.equal(child.exposedInputs.length,1);
 let model=performanceTimeline(project,child);arrangePerformanceTimeline(project,child,model.clips.map(c=>({...c,at:.5})),model.tracks);
 const root=blueprintFromPerformance(project,[],'素材参数调用');addProjectGraphs(project, root);
 root.exposedInputs=[{id:'image_input',name:'图片',direction:'input',dataType:'asset',required:false,defaultValue:''}];
 const read=blueprintNodeDefaults('getInput');read.properties.inputId='image_input';
 const call=blueprintNodeDefaults('callFunction');call.properties.graphId=child.id;call.pins=callablePins(child);root.nodes.push(read,call);
 assert.equal(connectBlueprintPins(root,root.nodes[0].id,'exec',call.id,'exec_in'),undefined);assert.equal(connectBlueprintPins(root,read.id,'value',call.id,'arg_'+child.exposedInputs[0].id),undefined);
 model=performanceTimeline(project,root);arrangePerformanceTimeline(project,root,model.clips,model.tracks);
 for(const [value,expected] of [['',undefined],['other_image','other_image']] as const){
  const context=previewActionContext(project),actions=expandPreviewActions(project,[{kind:'blueprint',blueprintId:root.id,inputs:{image_input:value}}],context);
  assert.equal(context.incomplete,!value);assert.equal(actions.find(a=>a.kind==='background')?.assetId,expected);
 }
 assert.equal(compileProject(project).diagnostics.some(d=>d.severity==='error'),false);
});


test('unsupported dynamic child delays report an error instead of silently serializing playback',()=>{
 const project=createProject(),child=chapterCompositionBlueprint(project,{title:'标题',subtitle:'',duration:1,effect:'fade'}).graph;addProjectGraphs(project, child);
 let model=performanceTimeline(project,child);arrangePerformanceTimeline(project,child,model.clips.map(c=>({...c,at:.5})),model.tracks);
 const parent=blueprintFromPerformance(project,[],'父时间轴');addProjectGraphs(project, parent);
 const call=blueprintNodeDefaults('callFunction');call.properties.graphId=child.id;call.pins=callablePins(child);parent.nodes.push(call);connectBlueprintPins(parent,parent.nodes[0].id,'exec',call.id,'exec_in');
 model=performanceTimeline(project,parent);arrangePerformanceTimeline(project,parent,model.clips,model.tracks);
 const delay=child.nodes.find(n=>n.type==='delay'&&n.id!==child.timeline?.tailNodeId)!;
 const duration=blueprintNodeDefaults('literal');duration.properties.value=.5;duration.pins.find(p=>p.id==='value')!.dataType='number';child.nodes.push(duration);assert.equal(connectBlueprintPins(child,duration.id,'value',delay.id,'seconds'),undefined);
 const before=structuredClone(project),diagnostics=timelineInterleaveDiagnostics(project);assert.equal(diagnostics.length,1);assert.match(diagnostics[0].message,/内部等待时长由数据连线控制/);assert.equal(diagnostics[0].nodeId,delay.id);
 const compiled=compileProject(project);assert.ok(compiled.diagnostics.some(d=>d.message.includes('不能交错播放')));assert.deepEqual(compiled.files,{});
 const context=previewActionContext(project);assert.deepEqual(expandPreviewActions(project,[{kind:'blueprint',blueprintId:parent.id}],context),[]);assert.equal(context.incomplete,true);
 const unrelated=previewActionContext(project);expandPreviewActions(project,[{kind:'pause',seconds:.1}],unrelated);assert.equal(unrelated.incomplete,false);assert.deepEqual(project,before);
 call.properties.wait=true;assert.deepEqual(timelineInterleaveDiagnostics(project),[]);assert.equal(compileProject(project).diagnostics.some(d=>d.severity==='error'),false);
});

test('timeline expansion budget exhaustion is a compile error with actionable diagnostics',()=>{
 const project=createProject();
 const child=blueprintFromPerformance(project,Array.from({length:235},()=>({kind:'stopMusic' as const,fade:0})),'大型子时间轴');addProjectGraphs(project, child);
 let model=performanceTimeline(project,child);arrangePerformanceTimeline(project,child,model.clips.map(c=>({...c,at:.1})),model.tracks);
 const parent=blueprintFromPerformance(project,[],'大型父时间轴');addProjectGraphs(project, parent);let previous=parent.nodes[0];
 for(let i=0;i<18;i++){const call=blueprintNodeDefaults('callFunction');call.properties.graphId=child.id;call.pins=callablePins(child);parent.nodes.push(call);connectBlueprintPins(parent,previous.id,previous.type==='event'?'exec':'exec_out',call.id,'exec_in');previous=call;}
 model=performanceTimeline(project,parent);arrangePerformanceTimeline(project,parent,model.clips.map((c,i)=>({...c,at:0,trackId:'call_'+i})),model.clips.map((_,i)=>({id:'call_'+i,name:'调用 '+i})));
 const before=structuredClone(project),diagnostics=timelineInterleaveDiagnostics(project);assert.ok(diagnostics.some(d=>d.message.includes('超过4096')));
 const compiled=compileProject(project);assert.deepEqual(compiled.files,{});assert.ok(compiled.diagnostics.some(d=>d.message.includes('超过4096')));assert.deepEqual(project,before);
});
