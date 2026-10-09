import test from 'node:test';
import assert from 'node:assert/strict';
import { editorLayoutSchema, updateEditorLayout, editorLayoutKeys, readEditorLayouts, editorLayoutStateSchema } from '../src/core/editor-layout';
function memory(){const data=new Map<string,string>();return {data,getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}};}
test('layout changes retain other dimensions, swap panels and recover defaults without touching unrelated preferences',()=>{
 const storage=memory();storage.setItem('unrelated','kept');updateEditorLayout(storage,{workspace:'timeline',sizes:{left:25,top:80}});updateEditorLayout(storage,{workspace:'timeline',swap:['left','right']});let layout=JSON.parse(storage.getItem(editorLayoutKeys.timeline)!);assert.equal(layout.left,25);assert.equal(layout.right,24);assert.equal(layout.panels.right,'library');assert.equal(layout.top,80);
 updateEditorLayout(storage,{workspace:'timeline',reset:true});layout=JSON.parse(storage.getItem(editorLayoutKeys.timeline)!);assert.equal(layout.left,18);assert.equal(layout.panels.left,'library');assert.equal(storage.getItem('unrelated'),'kept');
 updateEditorLayout(storage,{workspace:'uiLogic',sizes:{right:30}});assert.equal(storage.getItem(editorLayoutKeys.ui),null);assert.equal(JSON.parse(storage.getItem(editorLayoutKeys.uiLogic)!).right,30);
 updateEditorLayout(storage,{workspace:'blueprint',sizes:{palette:350},swap:true});assert.equal(storage.getItem(editorLayoutKeys.blueprint+':reversed'),'true');updateEditorLayout(storage,{workspace:'blueprint',reset:true});assert.equal(storage.getItem(editorLayoutKeys.blueprint+':reversed'),'false');assert.equal(JSON.parse(storage.getItem(editorLayoutKeys.blueprint)!).palette,194);
});
test('invalid layout requests do not write preferences and corrupt stored layouts recover safely',()=>{
 const storage=memory();for(const raw of [{workspace:'timeline',sizes:{top:99}},{workspace:'ui',sizes:{}},{workspace:'blueprint',reset:true,swap:true},{workspace:'ui',swap:['left','missing']},{workspace:'unknown',reset:true}]){assert.equal(editorLayoutSchema.safeParse(raw).success,false);assert.throws(()=>updateEditorLayout(storage,raw as any));}assert.equal(storage.data.size,0);
 storage.setItem(editorLayoutKeys.ui,JSON.stringify({left:999,panels:{left:'unknown'}}));updateEditorLayout(storage,{workspace:'ui',sizes:{top:50}});const result=JSON.parse(storage.getItem(editorLayoutKeys.ui)!);assert.equal(result.left,30);assert.equal(result.top,50);assert.equal(result.panels.left,'hierarchy');
});


test('layout snapshots read only public preferences, normalize damage and refresh after changes',()=>{
 const storage=memory();storage.setItem('unrelated-secret','must-not-be-sent');
 storage.setItem(editorLayoutKeys.ui,JSON.stringify({left:100,top:50,panels:{left:'hierarchy'}}));
 storage.setItem(editorLayoutKeys.blueprint,'broken json');const before=[...storage.data];
 const initial=readEditorLayouts(storage);assert.equal(editorLayoutStateSchema.safeParse(initial).success,true);
 assert.equal(initial.ui.left,30);assert.equal(initial.ui.top,50);assert.equal(initial.ui.panels.left,'hierarchy');
 assert.equal(initial.blueprint.palette,194);assert.deepEqual([...storage.data],before);assert.ok(!JSON.stringify(initial).includes('must-not-be-sent'));
 updateEditorLayout(storage,{workspace:'timeline',swap:['top','bottom'],sizes:{top:50}});
 const next=readEditorLayouts(storage);assert.equal(next.timeline.panels.top,'timeline');assert.equal(next.timeline.top,50);assert.equal(initial.timeline.panels.top,'preview');
 assert.deepEqual(next.ui,initial.ui);
 const inaccessible=readEditorLayouts({getItem(){throw new Error('unavailable');}});assert.equal(inaccessible.timeline.top,60);
});
