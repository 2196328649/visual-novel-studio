import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject,projectSchema } from '../src/core/model';
import { populateAihongGallery } from '../scripts/lib/aihong-gallery';

function fixture(){
 const project=createProject();project.ui.components.push({id:'ai_gallery_items',kind:'galleryGrid',page:'gallery',text:'图鉴',x:.1,y:.2,width:.8,height:.7,list:{rows:2,columns:4,assetIds:['old']}});
 const assets=['a','b'].map((id,i)=>({id,name:'分镜',kind:'image' as const,path:'assets/'+id+'.webp',resourcePath:'event/cg',sourcePathId:i+1}));
 const manifest={assets,groupCount:1,variantCount:1,groups:[{id:'group',name:'图鉴',thumbnail:{resourcePath:'event/cg',candidates:['a','b']},variants:[{label:'分镜',resourcePath:'event/cg',candidates:['a','b']}]}]};
 return {project,manifest};
}
test('template gallery retains alternatives, preserves authored work and is idempotent after saving',()=>{
 const {project,manifest}=fixture(),before=structuredClone(project),result=populateAihongGallery(project,manifest,{'event/cg':'a'});
 assert.equal(result.selected,1);assert.equal(result.alternatives,1);assert.equal(project.assets.find(a=>a.id==='b')!.name,'分镜 · 候选版本 2');
 assert.deepEqual(project.nodes,before.nodes);assert.deepEqual(project.blueprints,before.blueprints);assert.deepEqual(project.ui.components.filter(c=>c.id!=='ai_gallery_items'),before.ui.components.filter(c=>c.id!=='ai_gallery_items'));
 const list=project.ui.components.find(c=>c.id==='ai_gallery_items')!.list!;assert.equal(list.rows,2);assert.equal(list.columns,4);assert.equal(Object.hasOwn(list,'assetIds'),false);assert.deepEqual(list.galleryGroups![0].assetIds,['a']);
 const alternative=project.contentBrowser!.folders.find(f=>f.name==='CG 候选版本')!;assert.equal(project.contentBrowser!.assignments['asset:b'],alternative.id);
 const saved=projectSchema.parse(JSON.parse(JSON.stringify(project))),again=structuredClone(saved);populateAihongGallery(again,manifest,{'event/cg':'a'});assert.deepEqual(again,saved);
});
test('unrecorded choices or an existing unrelated asset ID leave template content untouched',()=>{
 const {project,manifest}=fixture(),before=structuredClone(project);assert.throws(()=>populateAihongGallery(project,manifest,{}),/需要确认版本/);assert.deepEqual(project,before);
 project.assets.push({id:'a',kind:'image',name:'用户素材',path:'user.png'});const collision=structuredClone(project);assert.throws(()=>populateAihongGallery(project,manifest,{'event/cg':'a'}),/已被其他素材使用/);assert.deepEqual(project,collision);
});
