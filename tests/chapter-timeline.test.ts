import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs } from '../src/core/blueprint-authoring';
import { chapterCompositionBlueprint } from '../src/core/chapter-composition-blueprint';
import { replaceChapterWithTimeline } from '../src/core/chapter-timeline';
import { arrangePerformanceTimeline, performanceTimeline, timelineNodeActions } from '../src/core/performance-timeline';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { compileProject } from '../src/runtime/compiler';

test('expanded chapter preserves title, duration and asset input wires and their subsequent overrides',()=>{
 const p=createProject();p.assets=['image_a','image_b','music_a','music_b'].map(id=>({id,name:id,kind:id.startsWith('music')?'audio':'image',path:id+'.png'}));
 const owner=blueprintFromPerformance(p,[{kind:'chapter',title:'默认标题',subtitle:'副标题',duration:4,backgroundId:'image_a',soundId:'music_a',effect:'fade'}],'外层');owner.timelineComponent=true;p.blueprints.push(owner);
 const chapter=owner.nodes.find(n=>n.type==='showChapter')!;
 const fields=performanceInputs(owner).filter(f=>['title','duration','backgroundId','soundId'].includes(f.pinId));exposePerformanceInputs(owner,fields);
 const originalPins=structuredClone(owner.exposedInputs);const originalLinks=owner.links.filter(l=>l.toNodeId===chapter.id&&l.toPinId!=='exec_in').map(l=>l.id);
 const model=performanceTimeline(p,owner);arrangePerformanceTimeline(p,owner,model.clips,model.tracks);
 const action=timelineNodeActions(p,owner,chapter).find(a=>a.kind==='chapter')!;assert.equal(action.kind,'chapter');
 const result=chapterCompositionBlueprint(p,action as any);replaceChapterWithTimeline(p,owner,chapter.id,result);
 assert.deepEqual(owner.exposedInputs,originalPins);assert.equal(owner.links.filter(l=>originalLinks.includes(l.id)&&l.toPinId.startsWith('arg_')).length,4);
 const overrides=Object.fromEntries(fields.map((f,index)=>[originalPins[index].id,({title:'传入的新标题',duration:8,backgroundId:'image_b',soundId:'music_b'} as any)[f.pinId]]));
 const actions=expandPreviewActions(p,[{kind:'blueprint',blueprintId:owner.id,inputs:overrides}],previewActionContext(p));
 const root=actions.find(a=>a.kind==='visual')!;assert.equal(root.kind,'visual');if(root.kind!=='visual')throw Error();
 assert.equal(root.duration,8);assert.ok(JSON.stringify(root).includes('传入的新标题'));assert.ok(JSON.stringify(root).includes('image_b'));assert.ok(actions.some(a=>a.kind==='sound'&&a.assetId==='music_b'));
 assert.deepEqual(compileProject(p).diagnostics.filter(d=>d.severity==='error'),[]);
});

test('an empty default subtitle can expand while retaining its dynamic input and invisible default',()=>{
 const p=createProject();
 const owner=blueprintFromPerformance(p,[{kind:'chapter',title:'标题',subtitle:'',duration:4,effect:'fade'}],'通用标题');p.blueprints.push(owner);
 const node=owner.nodes.find(n=>n.type==='showChapter')!;
 exposePerformanceInputs(owner,performanceInputs(owner).filter(f=>f.pinId==='subtitle'));
 const parameter=owner.exposedInputs[0];
 const source=timelineNodeActions(p,owner,node).find(a=>a.kind==='chapter')!;
 const built=chapterCompositionBlueprint(p,source as any,undefined,{includeEmptySubtitle:true});
 replaceChapterWithTimeline(p,owner,node.id,built);
 assert.equal(built.graph.exposedInputs.find(pin=>pin.id===built.chapterInputs.subtitle)?.defaultValue,'');
 const sample=(value:string)=>expandPreviewActions(p,[{kind:'blueprint',blueprintId:owner.id,inputs:{[parameter.id]:value}}],previewActionContext(p));
 assert.ok(JSON.stringify(sample('运行时副标题')).includes('运行时副标题'));
 assert.ok(!JSON.stringify(sample('')).includes('运行时副标题'));
 assert.deepEqual(compileProject(p).diagnostics.filter(d=>d.severity==='error'),[]);
});
