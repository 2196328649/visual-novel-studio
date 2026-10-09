import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema } from '../src/core/model';
import { applyVisualInputs, createVisualObject, patchVisualClipNode, updateVisualNodeObject, videoFadeGain, visualInputFields, visualPose } from '../src/core/visual-object';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs, rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { arrangePerformanceTimeline, editTimelineVisualLifetime, performanceLifetimes, performanceTimeline, timelineNodeActions } from '../src/core/performance-timeline';
import { compileProject } from '../src/runtime/compiler';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { initialPreviewStage, linePlaybackPlan } from '../src/core/line-preview';

test('video input limits belong to their source and apply after nested animation retiming', () => {
 const video={...createVisualObject('video','footage'),duration:4,sourceDuration:6,mediaOffset:1};
 const before=structuredClone(video);
 assert.equal(applyVisualInputs(video,{duration:99,mediaOffset:2}).duration,4);
 assert.equal(applyVisualInputs(video,{mediaOffset:7}).duration,0);
 const changed=applyVisualInputs(video,{assetId:'replacement',duration:9});
 assert.equal(changed.assetId,'replacement');assert.equal(changed.sourceDuration,undefined);assert.equal(changed.duration,9);
 const empty=applyVisualInputs(video,{assetId:'',duration:99});
 assert.equal(empty.assetId,'footage');assert.equal(empty.sourceDuration,6);assert.equal(empty.duration,5);
 const child={...video,mediaOffset:4},group={...createVisualObject('group'),duration:4,retimeOnDuration:true,children:[child]};
 const retimed=applyVisualInputs(group,{duration:8});assert.equal(retimed.children![0].duration,2);assert.equal(retimed.children![0].sourceDuration,6);
 const source=visualInputFields(group).find(field=>field.path.join('/')==='children/0/assetId')!;
 const nestedOverride=applyVisualInputs(group,{duration:8,[source.key]:'replacement'});
 assert.equal(nestedOverride.children![0].sourceDuration,undefined);assert.equal(nestedOverride.children![0].duration,8);
 const node=blueprintFromPerformance(createProject(),[video]).nodes[1];patchVisualClipNode(node,{assetId:'replacement'});
 const raw=rawSavedBlueprintAction(node)!;assert.ok(raw.kind==='visual');assert.equal(raw.sourceDuration,undefined);
 assert.deepEqual(video,before,'Input resolution must preserve the authored source');
 assert.equal(video.duration,4);assert.equal(video.sourceDuration,6);assert.equal(group.children[0].assetId,'footage');
});

test('passed video trim values shorten the preview and native timeline to the same source end', () => {
 const project=createProject();project.assets.push({id:'footage',name:'Footage',kind:'video',path:'footage.webm'});
 const video={...createVisualObject('video','footage'),duration:4,sourceDuration:6,mediaOffset:1};
 const graph=blueprintFromPerformance(project,[video]);project.blueprints.push(graph);
 const model=performanceTimeline(project,graph);arrangePerformanceTimeline(project,graph,model.clips,model.tracks);
 exposePerformanceInputs(graph,performanceInputs(graph).filter(field=>['object_duration','object_mediaOffset'].includes(field.pinId)));
 const inputs=Object.fromEntries(graph.exposedInputs.map(pin=>[pin.id,pin.name==='对象时长'?99:4]));
 const context=previewActionContext(project),actions=expandPreviewActions(project,[{kind:'blueprint',blueprintId:graph.id,inputs}],context);
 const resolved=actions.find(action=>action.kind==='visual')!;assert.equal(resolved.mediaOffset,4);assert.equal(resolved.duration,2);
 assert.equal(context.incomplete,false);assert.equal(linePlaybackPlan(initialPreviewStage(),actions).until,2000);
 const compiled=compileProject(project);assert.deepEqual(compiled.diagnostics.filter(d=>d.severity==='error'),[]);
 const node=graph.nodes.find(node=>rawSavedBlueprintAction(node)?.kind==='visual')!,data='vn_bp_visual_'+node.id;
 const story=compiled.files['game/story.rpy'];assert.ok(story.includes(data+' = vn_visual_with_inputs('));
 assert.ok(story.includes('float('+data+'["duration"])'),'The timeline deadline must use the duration after source clipping');
 assert.ok(story.includes('vn_show_visual(dict('+data+',')||story.includes('vn_show_visual('+data+')'));
});

test('video fades follow the clip clock and multiply its authored opacity without changing source timing', () => {
 const video = {...createVisualObject('video','footage'),duration:4,mediaOffset:3,fadeIn:1,fadeOut:2};
 video.keyframes[0].opacity=.8;
 assert.equal(visualPose(video,.5).opacity * videoFadeGain(video,.5),.4);
 assert.equal(visualPose(video,1.5).opacity * videoFadeGain(video,1.5),.8);
 assert.equal(visualPose(video,3).opacity * videoFadeGain(video,3),.4);
 assert.equal(visualPose(video,4).opacity * videoFadeGain(video,4),0);
 assert.equal(videoFadeGain(video,-1),0);
 assert.equal(videoFadeGain({...video,duration:0},0),0);
 assert.equal(videoFadeGain({...video,fadeIn:10,fadeOut:10},2),.25);
 assert.equal(video.mediaOffset,3);
 assert.equal(visualPose(video,.5).opacity,.8, 'Fade handles must not change the opacity value edited in the inspector');
 assert.equal(visualPose({...video,content:'image'},.5).opacity,.8);
});

test('basic visual edits preserve source clocks, nested literal inputs and bound images through save and export', () => {
 const project=createProject();project.assets.push({id:'red',name:'Red',kind:'image',path:'red.png'},{id:'blue',name:'Blue',kind:'image',path:'blue.png'});
 const child={...createVisualObject('image','red'),duration:2,retimeOnDuration:true};child.keyframes.push({...child.keyframes[0],duration:2,x:.9});
 const sibling=createVisualObject('text'),root={...createVisualObject('group'),duration:3,retimeOnDuration:true,children:[child,sibling]};
 const graph=blueprintFromPerformance(project,[root]);project.blueprints.push(graph);const node=graph.nodes[1];
 const childFields=visualInputFields(root),asset=childFields.find(f=>f.path.join('/')==='children/0/assetId')!,duration=childFields.find(f=>f.path.join('/')==='children/0/duration')!;
 exposePerformanceInputs(graph,[performanceInputs(graph).find(f=>f.pinId==='object_'+asset.key)!]);graph.exposedInputs[0].defaultValue='blue';node.properties.object_duration=6;node.properties['object_'+duration.key]=4;
 const properties={...node.properties},links=structuredClone(graph.links);
 patchVisualClipNode(node,{name:'Renamed',width:.6});
 const resolve=()=>timelineNodeActions(project,graph,node).find(a=>a.kind==='visual')!;
 assert.equal(resolve().duration,6);assert.equal(resolve().children![0].duration,8);assert.equal(resolve().children![0].assetId,'blue');assert.equal(resolve().width,.6);
 const raw=rawSavedBlueprintAction(node)!;assert.ok(raw.kind==='visual');assert.equal(raw.duration,3);assert.deepEqual(raw.children,JSON.parse(JSON.stringify(root.children)));
 assert.deepEqual({...node.properties,action:properties.action},properties);assert.deepEqual(graph.links,links);
 const edited={...raw.children![0],name:'Changed child'};updateVisualNodeObject(node,edited);
 assert.equal(resolve().children![0].duration,8);assert.equal(resolve().children![0].keyframes[1].duration,8);assert.equal(resolve().children![0].assetId,'blue');
 node.properties.object_duration=9;
 assert.equal(resolve().children![0].duration,12);assert.equal(visualPose(resolve().children![0],6).x,.7);
 const saved=applyTextScript(projectSchema.parse(project),projectToText(project)).project;
 assert.deepEqual(compileProject(saved).diagnostics.filter(d=>d.severity==='error'),[]);
 assert.equal(performanceTimeline(saved,saved.blueprints[0]).actionsByNode.get(node.id)?.find(a=>a.kind==='visual')?.children?.[0].assetId,'blue');
});

test('initial pose edits update overriding curves without changing later poses or timing', () => {
 const project=createProject(),object={...createVisualObject('solid'),curves:{x:[{at:0,value:.2,easing:'linear' as const},{at:3,value:.8,easing:'linear' as const}]}};
 const graph=blueprintFromPerformance(project,[object]),node=graph.nodes[1];node.properties.object_duration=6;
 patchVisualClipNode(node,{firstFrame:{x:.1,opacity:.5}});
 const raw=rawSavedBlueprintAction(node)!;assert.ok(raw.kind==='visual');
 assert.equal(visualPose(raw,0).x,.1);assert.equal(raw.keyframes[0].opacity,.5);assert.deepEqual(raw.curves!.x!.at(-1),object.curves.x.at(-1));
 assert.equal(visualPose(applyVisualInputs(raw,{duration:6}),0).x,.1);
 assert.equal(node.properties.object_duration,6);
 const before=structuredClone(node);assert.throws(()=>patchVisualClipNode(node,{width:-1}));assert.deepEqual(node,before);
 assert.throws(()=>updateVisualNodeObject(node,{...raw,instanceId:'missing'}));assert.deepEqual(node,before);
});

test('editing a literal-backed field to its original default clears only that field override', () => {
 const node=blueprintFromPerformance(createProject(),[createVisualObject('text')]).nodes[1];node.properties.object_text='Override';node.properties.object_duration=5;
 patchVisualClipNode(node,{text:'新的文字'});assert.equal(node.properties.object_text,undefined);assert.equal(node.properties.object_duration,5);
});

test('nested lifetime edits use the parent clock and preserve all authored animation and other overrides', () => {
 const project=createProject(),child={...createVisualObject('text'),instanceId:'child',startAt:.5,duration:1,retimeOnDuration:true,curves:{x:[{at:0,value:.2,easing:'linear' as const},{at:1,value:.8,easing:'linear' as const}]}};
 const sibling={...createVisualObject('text'),instanceId:'sibling',duration:2},parent={...createVisualObject('group'),instanceId:'parent',startAt:.5,duration:4,retimeOnDuration:true,children:[child,sibling]};
 const root={...createVisualObject('group'),instanceId:'root',duration:10,retimeOnDuration:true,children:[parent]},graph=blueprintFromPerformance(project,[root]);project.blueprints.push(graph);const node=graph.nodes[1];
 const field=(path:string)=>'object_'+visualInputFields(root).find(f=>f.path.join('/')===path)!.key;
 node.properties.object_duration=20;node.properties[field('children/0/duration')]=6;node.properties[field('children/0/children/0/duration')]=1.5;node.properties[field('children/0/children/0/text')]='Keep text';node.properties[field('children/0/children/1/text')]='Keep sibling';
 const before=structuredClone(node.properties),row=()=>performanceLifetimes(project,graph).find(r=>r.instanceId===child.instanceId)!;
 assert.equal(row().at,2.5);assert.equal(row().until,7);
 editTimelineVisualLifetime(project,graph,node.id,child.instanceId,1.5,false);
 assert.equal(row().at,4);assert.equal(row().until,8.5);
 editTimelineVisualLifetime(project,graph,node.id,child.instanceId,-1.5,true);
 assert.equal(row().at,4);assert.equal(row().until,7);assert.equal(node.properties[field('children/0/children/0/duration')],1);
 const raw=rawSavedBlueprintAction(node)!;assert.ok(raw.kind==='visual');const expected=structuredClone(root);expected.children[0].children[0].startAt=1;
 assert.deepEqual(raw,JSON.parse(JSON.stringify(expected)));assert.deepEqual({...node.properties,action:before.action,[field('children/0/children/0/duration')]:before[field('children/0/children/0/duration')]},before);
 node.properties.object_duration=30;assert.equal(row().at,6);assert.equal(row().until,10.5);
 const resolved=timelineNodeActions(project,graph,node).find(a=>a.kind==='visual')!.children![0].children![0];assert.equal(resolved.text,'Keep text');assert.equal(resolved.curves!.x![1].at,4.5);assert.equal(visualPose(resolved,2.25).x,.5);
 const saved=projectSchema.parse(JSON.parse(JSON.stringify(project)));assert.deepEqual(compileProject(saved).diagnostics.filter(d=>d.severity==='error'),[]);
});

test('nested lifetime trimming uses the visible interval, supports unscaled children and rejects invalid edits atomically', () => {
 const project=createProject(),child={...createVisualObject('text'),instanceId:'child',startAt:1,duration:8,retimeOnDuration:false},root={...createVisualObject('group'),duration:4,retimeOnDuration:true,children:[child]},graph=blueprintFromPerformance(project,[root]);project.blueprints.push(graph);const node=graph.nodes[1];node.properties.object_duration=8;
 const row=()=>performanceLifetimes(project,graph).find(r=>r.instanceId===child.instanceId)!;
 assert.equal(row().at,2);assert.equal(row().until,8);
 editTimelineVisualLifetime(project,graph,node.id,child.instanceId,-2,true);assert.equal(row().until,6);
 editTimelineVisualLifetime(project,graph,node.id,child.instanceId,-10,false);assert.equal(row().at,0);assert.equal(row().until,4);
 const raw=rawSavedBlueprintAction(node)!;assert.ok(raw.kind==='visual');assert.deepEqual(raw.children![0].keyframes,child.keyframes);assert.equal(raw.children![0].duration,8);
 const before=structuredClone(node);for(const [id,delta] of [[child.instanceId,NaN],['missing',1],[root.instanceId,1]] as const){assert.throws(()=>editTimelineVisualLifetime(project,graph,node.id,id,delta,false));assert.deepEqual(node,before);}
 exposePerformanceInputs(graph,[performanceInputs(graph).find(f=>f.pinId==='object_duration')!]);const linked=structuredClone(graph);assert.throws(()=>editTimelineVisualLifetime(project,graph,node.id,child.instanceId,1,true),/连线/);assert.deepEqual(graph,linked);
});
