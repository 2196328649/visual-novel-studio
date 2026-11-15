import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultDockLayout, defaultUiEventLayout, editorLayoutDescription, editorLayoutSchema, updateEditorLayout, editorLayoutKeys, readBlueprintLayout, readDockLayout, readEditorLayouts, readUiEventLayout, editorLayoutStateSchema, uiEventWorkspaceWidths, writeBlueprintLayout, writeDockLayout, writeUiEventLayout } from '../src/core/editor-layout';
function memory(){const data=new Map<string,string>();return {data,getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}};}
test('layout changes retain other dimensions, swap panels and recover defaults without touching unrelated preferences',()=>{
 const storage=memory();storage.setItem('unrelated','kept');updateEditorLayout(storage,{workspace:'timeline',sizes:{left:25,top:80}});updateEditorLayout(storage,{workspace:'timeline',swap:['left','right']});let layout=JSON.parse(storage.getItem(editorLayoutKeys.timeline)!);assert.equal(layout.left,25);assert.equal(layout.right,24);assert.equal(layout.panels.right,'library');assert.equal(layout.top,80);
 updateEditorLayout(storage,{workspace:'timeline',reset:true});layout=JSON.parse(storage.getItem(editorLayoutKeys.timeline)!);assert.equal(layout.left,18);assert.equal(layout.panels.left,'library');assert.equal(storage.getItem('unrelated'),'kept');
 updateEditorLayout(storage,{workspace:'uiLogic',sizes:{sidebarWidth:400}});assert.equal(storage.getItem(editorLayoutKeys.ui),null);assert.equal(JSON.parse(storage.getItem(editorLayoutKeys.uiLogic)!).sidebarWidth,400);
 updateEditorLayout(storage,{workspace:'blueprint',sizes:{palette:350},swap:true});assert.equal(storage.getItem(editorLayoutKeys.blueprint+':reversed'),'false');updateEditorLayout(storage,{workspace:'blueprint',reset:true});assert.equal(storage.getItem(editorLayoutKeys.blueprint+':reversed'),'true');assert.equal(JSON.parse(storage.getItem(editorLayoutKeys.blueprint)!).palette,194);
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

test('UI events have one sidebar while blueprint, design and timeline keep their own layouts',()=>{
 const storage=memory();
 assert.deepEqual(readBlueprintLayout(storage),{palette:194,properties:280,reversed:true});
 assert.deepEqual(defaultUiEventLayout(),{sidebarWidth:340,directoryRatio:32,sidebarCollapsed:false,directoryCollapsed:false});
 assert.deepEqual(defaultDockLayout('ui'),{left:18,right:24,top:74,panels:{left:'hierarchy',top:'canvas',bottom:'settings',right:'inspector'}});
 assert.deepEqual(defaultDockLayout('timeline'),{left:18,right:24,top:60,panels:{left:'library',top:'preview',bottom:'timeline',right:'inspector'}});
 assert.deepEqual(readDockLayout(storage,'ui',60),defaultDockLayout('ui',60));
 assert.deepEqual(readUiEventLayout(storage),defaultUiEventLayout());assert.equal(storage.data.size,0);
 const first=defaultUiEventLayout();first.directoryCollapsed=true;
 assert.equal(defaultUiEventLayout().directoryCollapsed,false);
});

test('legacy blueprint widths survive read-only direction migration and explicit new directions persist',()=>{
 for(const previous of ['true','false']){
  const storage=memory();storage.setItem(editorLayoutKeys.blueprint,JSON.stringify({palette:355,properties:412}));storage.setItem(editorLayoutKeys.blueprint+':reversed',previous);
  const before=[...storage.data],migrated=readBlueprintLayout(storage);
  assert.deepEqual(migrated,{palette:355,properties:412,reversed:true});assert.deepEqual([...storage.data],before);
  assert.equal(writeBlueprintLayout(storage,migrated),editorLayoutKeys.blueprint);
  assert.equal(JSON.parse(storage.getItem(editorLayoutKeys.blueprint)!).inspectorLayoutVersion,2);
  assert.deepEqual(readBlueprintLayout(storage),migrated);
  writeBlueprintLayout(storage,{...migrated,reversed:false});assert.equal(storage.getItem(editorLayoutKeys.blueprint+':reversed'),'false');assert.equal(readBlueprintLayout(storage).reversed,false);
  updateEditorLayout(storage,{workspace:'blueprint',sizes:{palette:400}});assert.deepEqual(readBlueprintLayout(storage),{palette:400,properties:412,reversed:false});
  updateEditorLayout(storage,{workspace:'blueprint',swap:true});assert.equal(readBlueprintLayout(storage).reversed,true);
  updateEditorLayout(storage,{workspace:'blueprint',reset:true});assert.deepEqual(readBlueprintLayout(storage),{palette:194,properties:280,reversed:true});
 }
});

test('legacy event dock migrates one useful sidebar width without combining the two sides or writing on read',()=>{
 const storage=memory(),legacy={left:20,right:28,top:51,panels:{left:'hierarchy',top:'settings',bottom:'canvas',right:'inspector'}};
 storage.setItem(editorLayoutKeys.uiLogic,JSON.stringify(legacy));const before=[...storage.data];
 const migrated=readUiEventLayout(storage);
 assert.deepEqual(migrated,{sidebarWidth:403,directoryRatio:32,sidebarCollapsed:false,directoryCollapsed:false});
 assert.deepEqual([...storage.data],before);
 updateEditorLayout(storage,{workspace:'uiLogic',sizes:{directoryRatio:45},directoryCollapsed:true});
 assert.deepEqual(readUiEventLayout(storage),{...migrated,directoryRatio:45,directoryCollapsed:true});
 const written=JSON.parse(storage.getItem(editorLayoutKeys.uiLogic)!);
 assert.equal(written.eventSidebarVersion,1);assert.equal('panels' in written,false);assert.equal('right' in written,false);
 const persisted=[...storage.data];assert.deepEqual(readUiEventLayout(storage),{...migrated,directoryRatio:45,directoryCollapsed:true});assert.deepEqual([...storage.data],persisted);
 updateEditorLayout(storage,{workspace:'uiLogic',sizes:{sidebarWidth:450},sidebarCollapsed:true});
 assert.deepEqual(readUiEventLayout(storage),{...migrated,sidebarWidth:450,directoryRatio:45,directoryCollapsed:true,sidebarCollapsed:true});
 const other=JSON.stringify({left:21});storage.setItem(editorLayoutKeys.ui,other);
 updateEditorLayout(storage,{workspace:'uiLogic',reset:true});assert.deepEqual(readUiEventLayout(storage),defaultUiEventLayout());assert.equal(storage.getItem(editorLayoutKeys.ui),other);
});

test('event dock migration interprets the inspector side, bounds damage and ignores unrelated central placement',()=>{
 const storage=memory();
 for(const [panels,width] of [
  [{left:'canvas',top:'hierarchy',bottom:'settings',right:'inspector'},418],
  [{left:'hierarchy',top:'canvas',bottom:'inspector',right:'settings'},317],
  [{left:'inspector',top:'canvas',bottom:'settings',right:'hierarchy'},317],
  [{left:'canvas',top:'inspector',bottom:'hierarchy',right:'settings'},340],
 ] as const){
  storage.setItem(editorLayoutKeys.uiLogic,JSON.stringify({left:22,right:29,top:48,panels,inspectorLayoutVersion:2}));const before=[...storage.data];
  assert.deepEqual(readUiEventLayout(storage),{...defaultUiEventLayout(),sidebarWidth:width});assert.deepEqual([...storage.data],before);
 }
 const panels={left:'inspector',top:'canvas',bottom:'settings',right:'hierarchy'};
 for(const raw of ['invalid json',JSON.stringify({panels}),JSON.stringify({panels:{left:'inspector'}}),JSON.stringify({left:'24',panels})]){
  storage.setItem(editorLayoutKeys.uiLogic,raw);assert.deepEqual(readUiEventLayout(storage),defaultUiEventLayout());
 }
 storage.setItem(editorLayoutKeys.uiLogic,JSON.stringify({left:-99,right:32,panels}));assert.equal(readUiEventLayout(storage).sidebarWidth,280);
 storage.setItem(editorLayoutKeys.uiLogic,JSON.stringify({left:999,right:32,panels}));assert.equal(readUiEventLayout(storage).sidebarWidth,432);
});

test('event sidebar preferences retain explicit collapsed states and never repeat the old dock migration',()=>{
 const storage=memory(),explicit={sidebarWidth:510,directoryRatio:19,sidebarCollapsed:true,directoryCollapsed:true};
 writeUiEventLayout(storage,explicit);assert.deepEqual(readUiEventLayout(storage),explicit);
 const raw=JSON.parse(storage.getItem(editorLayoutKeys.uiLogic)!);
 storage.setItem(editorLayoutKeys.uiLogic,JSON.stringify({...raw,left:30,right:32,panels:{left:'hierarchy',top:'canvas',bottom:'settings',right:'inspector'}}));
 assert.deepEqual(readUiEventLayout(storage),explicit);
 updateEditorLayout(storage,{workspace:'uiLogic',directoryCollapsed:false,sidebarCollapsed:false});
 assert.deepEqual(readUiEventLayout(storage),{...explicit,directoryCollapsed:false,sidebarCollapsed:false});
 storage.setItem(editorLayoutKeys.uiLogic,JSON.stringify({eventSidebarVersion:1,sidebarWidth:900,directoryRatio:-50,sidebarCollapsed:'true',directoryCollapsed:true}));
 assert.deepEqual(readUiEventLayout(storage),{sidebarWidth:560,directoryRatio:16,sidebarCollapsed:false,directoryCollapsed:true});
});

test('event layout actions reject legacy swaps and right panels without writing any preferences',()=>{
 const storage=memory();storage.setItem(editorLayoutKeys.uiLogic,JSON.stringify({legacy:'kept'}));const before=[...storage.data];
 for(const raw of [
  {workspace:'uiLogic',swap:['left','right']},{workspace:'uiLogic',sizes:{right:30}},
  {workspace:'uiLogic',sizes:{}},{workspace:'uiLogic',sizes:{directoryRatio:85}},
  {workspace:'uiLogic',sizes:{sidebarWidth:200}},{workspace:'uiLogic',reset:true,directoryCollapsed:false},
  {workspace:'uiLogic',reset:true,sizes:{sidebarWidth:360}},{workspace:'uiLogic',sidebarCollapsed:'false'},
 ]){
  assert.equal(editorLayoutSchema.safeParse(raw).success,false);assert.throws(()=>updateEditorLayout(storage,raw as any));assert.deepEqual([...storage.data],before);
 }
 const action={workspace:'uiLogic' as const,sizes:{sidebarWidth:360,directoryRatio:30},directoryCollapsed:false};
 assert.equal(editorLayoutSchema.safeParse(action).success,true);updateEditorLayout(storage,action);
 assert.equal(editorLayoutDescription(action),'左栏宽度 360 px；目录高度 30%；展开目录');
 assert.equal(editorLayoutStateSchema.shape.uiLogic.safeParse({...defaultUiEventLayout(),right:20}).success,false);
});

test('narrow event workspaces preserve a usable canvas and do not overwrite the preferred sidebar width',()=>{
 const storage=memory();writeUiEventLayout(storage,{...defaultUiEventLayout(),sidebarWidth:500});
 const before=[...storage.data],layout=readUiEventLayout(storage);
 assert.deepEqual(uiEventWorkspaceWidths(layout.sidebarWidth,1440),{narrow:false,sidebarWidth:500,maxSidebarWidth:560});
 assert.deepEqual(uiEventWorkspaceWidths(layout.sidebarWidth,800),{narrow:false,sidebarWidth:474,maxSidebarWidth:474});
 assert.deepEqual(uiEventWorkspaceWidths(layout.sidebarWidth,606),{narrow:false,sidebarWidth:280,maxSidebarWidth:280});
 assert.deepEqual(uiEventWorkspaceWidths(layout.sidebarWidth,500),{narrow:true,sidebarWidth:464,maxSidebarWidth:464});
 assert.deepEqual(uiEventWorkspaceWidths(layout.sidebarWidth,20),{narrow:true,sidebarWidth:0,maxSidebarWidth:0});
 assert.deepEqual(uiEventWorkspaceWidths(Number.NaN,Number.NaN),{narrow:true,sidebarWidth:0,maxSidebarWidth:0});
 assert.deepEqual([...storage.data],before);assert.equal(readUiEventLayout(storage).sidebarWidth,500);
});

test('shared writers keep custom keys and migration metadata outside the public read-only state',()=>{
 const storage=memory(),customKey='custom-ui-animation-layout',custom=defaultDockLayout('ui',60);
 custom.left=23;assert.equal(writeDockLayout(storage,'ui',custom,customKey),customKey);assert.equal(storage.getItem(editorLayoutKeys.ui),null);
 assert.deepEqual(readDockLayout({getItem:()=>storage.getItem(customKey)},'ui',60),custom);
 const logic=defaultUiEventLayout();assert.equal(writeUiEventLayout(storage,logic),editorLayoutKeys.uiLogic);
 writeBlueprintLayout(storage,{palette:222,properties:333,reversed:false});const before=[...storage.data];
 const snapshot=readEditorLayouts({getItem:key=>storage.getItem(key)});
 assert.deepEqual(snapshot.uiLogic,logic);assert.equal(snapshot.blueprint.reversed,false);assert.equal(JSON.stringify(snapshot).includes('inspectorLayoutVersion'),false);assert.equal(JSON.stringify(snapshot).includes('eventSidebarVersion'),false);
 assert.equal(editorLayoutStateSchema.safeParse(snapshot).success,true);assert.deepEqual([...storage.data],before);
 const unavailable=readEditorLayouts({getItem(){throw new Error('storage unavailable');}});
 assert.deepEqual(unavailable.uiLogic,defaultUiEventLayout());assert.equal(unavailable.blueprint.reversed,true);
 const timeline=defaultDockLayout('timeline');writeDockLayout(storage,'timeline',timeline);assert.deepEqual(JSON.parse(storage.getItem(editorLayoutKeys.timeline)!),timeline);
 writeDockLayout(storage,'ui',defaultDockLayout('ui'));assert.deepEqual(JSON.parse(storage.getItem(editorLayoutKeys.ui)!),defaultDockLayout('ui'));
});
