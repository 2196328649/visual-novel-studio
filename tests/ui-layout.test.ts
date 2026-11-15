import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, effectiveUiComponents, declaredUiComponents, type UiComponent } from '../src/core/model';
import { resolveUiHierarchy, reparentUiComponent } from '../src/core/ui-hierarchy';
import { resolveUiLayout, uiGeometryContains, uiTransformPoint, uiTransformVector, uiInverse, uiLayoutProblem, recoverUiLayout, uiLayoutPropertyFields, uiLayoutObservationProperties } from '../src/core/ui-layout';
import { transformUiLayoutRect } from '../src/core/ui-transform';
import { uiProperties, uiPropertyApplies, uiPropertyDefault, uiPropertyDefaults, uiPropertyValueProblem } from '../src/core/ui-properties';
import { appendUiPreviewEvent, previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { validateProject } from '../src/core/validate';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { compileProject } from '../src/runtime/compiler';
import { createUiLayoutFixture } from '../scripts/lib/ui-layout-fixture';

const viewport={width:1000,height:500};
const c=(id:string,extra:Partial<UiComponent>={}):UiComponent=>({id,page:'main',kind:'panel',text:'',x:0,y:0,width:1,height:1,...extra});
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-7*Math.max(1,Math.abs(b)),a+' != '+b);
const pointNear=(a:{x:number;y:number},b:{x:number;y:number})=>{near(a.x,b.x);near(a.y,b.y);};
const click=(name:string):UiPreviewEvent=>({kind:'click',componentId:'layout_action_'+name});
const sample=(f:ReturnType<typeof createUiLayoutFixture>,events:UiPreviewEvent[]=[])=>previewUiLogic(f.project,f.page.components,f.page.id,{},events,{timed:true,trace:true,host:'story'});
const row=(preview:ReturnType<typeof sample>,id='layout_panel')=>preview.layers.flatMap(l=>l.components).find(r=>r.component.id===id)!;

// Source only: run with the complete un-deferred work at final acceptance.
test('optional layout preserves historical normalized hierarchy and does not mutate a project',()=>{
  const components=[c('p',{x:.2,y:.3,width:.4,height:.2}),c('a',{parentId:'p',x:-.1,y:-.2,width:1.2,height:1.4})],before=structuredClone(components);
  const resolved=resolveUiHierarchy(components,{viewport}),a=resolved.find(r=>r.component.id==='a')!;
  near(a.component.x,.16);near(a.component.y,.26);near(a.component.width,.48);near(a.component.height,.28);
  assert.deepEqual(components,before);assert.equal(a.geometry!.legacy,true);
  const p=createProject('旧布局');p.ui.components=components;
  assert.equal(projectSchema.parse(JSON.parse(JSON.stringify(p))).ui.components[0].layout,undefined);
});

test('non-square pixel geometry scales before clockwise rotation and inherits the entire frame',()=>{
  const components=[c('p',{x:.2,y:.1,width:.4,height:.6,layout:{version:1,anchorX:.5,anchorY:.5,pivotX:.5,pivotY:.5,rotation:90,scaleX:2,scaleY:.5}}),c('a',{parentId:'p',x:.1,y:.2,width:.5,height:.25})];
  const rows=resolveUiLayout(components,viewport),p=rows.get('p')!,a=rows.get('a')!;
  p.matrix.forEach((v,i)=>near(v,[0,2,-.5,0,775,-100][i]));
  a.matrix.forEach((v,i)=>near(v,[0,2,-.5,0,745,-20][i]));
  near(a.bounds.x,707.5);near(a.bounds.y,-20);near(a.bounds.width,37.5);near(a.bounds.height,400);
  const local={x:50,y:20},world=uiTransformPoint(a.matrix,local);pointNear(uiTransformPoint(uiInverse(a.matrix)!,world),local);assert.equal(uiGeometryContains(a,world),true);
  assert.equal(uiGeometryContains(a,{x:746,y:0}),false);
});

test('padding, independent flow order, gaps and hidden slots affect foreground children only',()=>{
  const components=[c('p',{width:.4,height:.5,layout:{version:1,flow:'vertical',gap:7,paddingLeft:10,paddingRight:30,paddingTop:20,paddingBottom:10}}),c('a',{parentId:'p',width:.5,height:.25,layout:{version:1,order:1}}),c('b',{parentId:'p',width:.5,height:.25,layout:{version:1,order:0,scaleX:2}}),c('bg',{parentId:'p',childLayer:'background'})];
  const rows=resolveUiLayout(components,viewport);
  near(rows.get('b')!.matrix[5],20);near(rows.get('a')!.matrix[5],82);near(rows.get('a')!.width,180);near(rows.get('a')!.height,55);
  near(rows.get('bg')!.width,400);near(rows.get('bg')!.height,250);near(rows.get('bg')!.matrix[4],0);
  const hidden=resolveUiLayout(components,viewport,item=>item.id!=='b');near(hidden.get('a')!.matrix[5],20);
  components[1].layer=-100;components[2].editor={listOrder:-1000};
  near(resolveUiLayout(components,viewport).get('a')!.matrix[5],82);
});

test('default flow order is zero and declaration ties survive paint-layer changes in preview',()=>{
  const f=createUiLayoutFixture();for(const item of f.items)delete item.layout!.order;
  const before=sample(f),positions=f.items.map(item=>row(before,item.id).geometry!.matrix[5]);
  f.items[0].layer=999;f.items[1].layer=-999;f.items[2].editor={listOrder:-999};
  const after=sample(f);f.items.forEach((item,i)=>{near(row(after,item.id).geometry!.matrix[5],positions[i]);assert.equal(uiPropertyDefault(f.project,item,'layoutOrder'),0);});
  const defaults=uiPropertyDefaults(f.project,f.page.components);f.items.forEach(item=>assert.equal(defaults[item.id].layoutOrder,0));
});

test('scroll derives from transformed overflow and clamps without rewriting its request',()=>{
  const components=[c('p',{width:.2,height:.2,layout:{version:1,scroll:'vertical',scrollY:999}}),c('a',{parentId:'p',height:3}),c('bg',{parentId:'p',childLayer:'background'})];
  const rows=resolveUiLayout(components,viewport),p=rows.get('p')!;
  near(p.scrollY,200);near(p.scrollMaximumY,200);near(p.contentHeight,300);near(rows.get('a')!.matrix[5],-200);near(rows.get('bg')!.matrix[5],0);
  assert.equal(components[0].layout!.scrollY,999);
  const hidden=resolveUiLayout(components,viewport,item=>item.id!=='a');near(hidden.get('p')!.scrollY,0);near(hidden.get('p')!.scrollMaximumY,0);
  components[1].y=-.5;components[1].height=2;components[0].layout!.scrollY=-999;
  const negative=resolveUiLayout(components,viewport).get('p')!;near(negative.scrollMinimumY,-50);near(negative.scrollY,-50);near(negative.scrollMaximumY,50);
});

test('nested rotated/mirrored clips reject the AABB-only hit while allowing an overflowing descendant',()=>{
  const components=[c('p',{x:.4,y:.4,width:.2,height:.2,layout:{version:1,rotation:35,scaleX:-1,clip:true}}),c('a',{parentId:'p',x:-.5,y:-.5,width:2,height:2})];
  const rows=resolveUiLayout(components,viewport),p=rows.get('p')!,a=rows.get('a')!;
  assert.equal(uiGeometryContains(a,uiTransformPoint(p.matrix,{x:10,y:10})),true);
  assert.equal(uiGeometryContains(a,uiTransformPoint(p.matrix,{x:-10,y:10})),false);
  const overflow=[c('clip',{width:.2,height:.2,layout:{version:1,clip:true}}),c('off',{parentId:'clip',x:2,width:.5}),c('visible',{parentId:'off',x:-4,width:2})];
  const o=resolveUiLayout(overflow,viewport);assert.equal(o.get('off')!.clippedOut,true);assert.equal(o.get('visible')!.clippedOut,false);
  assert.equal(uiGeometryContains(o.get('visible')!,{x:10,y:10}),true);
});

test('collapsed content areas and zero scale cannot receive focus or pointer hits',()=>{
  const rows=resolveUiLayout([c('p',{width:.1,height:.1,layout:{version:1,paddingLeft:1000,paddingRight:1000,clip:true}}),c('a',{parentId:'p'}),c('zero',{layout:{version:1,scaleX:0}})],viewport);
  near(rows.get('p')!.content.x,50);near(rows.get('p')!.content.width,0);
  assert.equal(rows.get('a')!.clippedOut,true);assert.equal(rows.get('zero')!.clippedOut,true);assert.equal(uiGeometryContains(rows.get('zero')!,{x:0,y:0}),false);
});

test('move and resize use inverse affine deltas and keep the opposite handle fixed',()=>{
  const components=[c('p',{width:.8,height:.8,layout:{version:1,rotation:25,scaleX:1.3,scaleY:.8}}),c('a',{parentId:'p',x:.2,y:.2,width:.3,height:.3,layout:{version:1,pivotX:.4,pivotY:.7,rotation:-35,scaleX:1.4,scaleY:.7}})];
  const source=components[1],g=resolveUiLayout(components,viewport).get('a')!;
  const move=transformUiLayoutRect(source,g,'move',{x:37,y:-19})!;
  const moved=resolveUiLayout([components[0],{...source,...move}],viewport).get('a')!;near(moved.matrix[4]-g.matrix[4],37);near(moved.matrix[5]-g.matrix[5],-19);
  const fixed=uiTransformPoint(g.matrix,{x:g.width,y:g.height/2});
  const resize=transformUiLayoutRect(source,g,'w',uiTransformVector(g.matrix,{x:30,y:0}))!;
  const changed=resolveUiLayout([components[0],{...source,...resize}],viewport).get('a')!;
  pointNear(uiTransformPoint(changed.matrix,{x:changed.width,y:changed.height/2}),fixed);near(changed.width,g.width-30);
  const equal=transformUiLayoutRect(source,g,'se',uiTransformVector(g.matrix,{x:50,y:10}),true)!;near(equal.width/equal.height,source.width/source.height);
});

test('reparent keeps affine geometry or explicitly rejects shear without touching source data',()=>{
  const components=[c('p',{x:.1,y:.1,width:.7,height:.6,layout:{version:1,rotation:20,scaleX:1.2,scaleY:1.2}}),c('a',{parentId:'p',x:.2,y:.3,width:.2,height:.4,layout:{version:1,pivotX:.5,pivotY:.5,rotation:17}}),c('target',{x:.6,y:.5,width:.3,height:.4,layout:{version:1,rotation:-40,scaleX:.8,scaleY:.8,paddingLeft:12}})];
  const before=structuredClone(components),g=resolveUiLayout(components,viewport).get('a')!;
  const change=reparentUiComponent(components,'a','target',viewport);assert.deepEqual(components,before);
  const after=resolveUiLayout(components.map(item=>item.id==='a'?{...item,...change}:item),viewport).get('a')!;
  g.matrix.forEach((v,i)=>near(after.matrix[i],v));near(after.width,g.width);near(after.height,g.height);
  components[0].layout!.scaleY=.4;assert.throws(()=>reparentUiComponent(components,'a',undefined,viewport),/斜切/);
});

test('layout versions and future fields round-trip; recovery is explicit and reversible',()=>{
  const f=createUiLayoutFixture();f.panel.layout={version:9,futureField:{mode:'unknown'},rotation:35};
  const parsed=projectSchema.parse(JSON.parse(JSON.stringify(f.project))),saved=parsed.ui.customPages.find(p=>p.id===f.page.id)!.components[0];
  assert.deepEqual(saved.layout,f.panel.layout);assert.ok(uiLayoutProblem(saved));
  assert.ok(validateProject(parsed).some(d=>d.code==='ui.layout.version'&&d.ui?.componentId===saved.id));
  assert.ok(validateBlueprints(parsed).some(d=>d.severity==='error'&&d.message.includes('布局版本')));
  const restored=recoverUiLayout(saved);assert.equal(restored.version,1);assert.deepEqual(JSON.parse(restored.recovery!),f.panel.layout);assert.equal(saved.layout!.version,9);
});

test('layout property capabilities are typed, shared and do not falsely advertise animation',()=>{
  const f=createUiLayoutFixture();
  for(const property of Object.keys(uiLayoutPropertyFields) as (keyof typeof uiLayoutPropertyFields)[]){const info=uiProperties[property];assert.equal(info.writable&&info.readable&&info.bindable&&info.preview&&info.runtime,true);assert.equal(info.animated,false);assert.equal(uiPropertyApplies(f.items[0],property,f.project),true);}
  for(const property of uiLayoutObservationProperties.filter(p=>!['scrollX','scrollY'].includes(p)))assert.equal(uiProperties[property].writable,false);
  assert.ok(uiPropertyValueProblem(f.project,'anchorX',2));assert.ok(uiPropertyValueProblem(f.project,'scaleX',Infinity));assert.ok(uiPropertyValueProblem(f.project,'scrollMode','diagonal'));
  assert.equal(uiPropertyValueProblem(f.project,'scaleX',-1),undefined);assert.equal(uiPropertyDefault(f.project,f.panel,'scrollY'),0);
});

test('inactive scheme children cannot alter active default geometry or flow slots',()=>{
  const p=createProject('方案布局');p.width=1000;p.height=500;
  p.ui.components=[c('p',{width:.2,height:.2,layout:{version:1,flow:'vertical',scroll:'vertical'}}),c('a',{parentId:'p',height:1})];
  p.ui.instances=[{id:'variant',name:'其他方案',components:[c('other',{parentId:'p',height:100})]}];
  const defaults=uiPropertyDefaults(p,[...effectiveUiComponents(p.ui),...p.ui.instances[0].components]);
  near(Number(defaults.p.scrollMaximumY),0);near(Number(defaults.p.contentHeight),100);
});

test('inactive layout defaults use their own parent overrides rather than unrelated variants',()=>{
  const p=createProject('多方案布局');p.width=1000;p.height=500;
  p.ui.components=[c('p',{width:.2,height:.2,layout:{version:1,flow:'vertical'}}),c('a',{parentId:'p',height:1})];
  p.ui.instances=[{id:'one',name:'方案一',components:[{...p.ui.components[0],width:.4,height:.4},c('one-child',{parentId:'p',height:2})]},
    {id:'two',name:'方案二',components:[{...p.ui.components[0],width:.6,height:.6},c('two-child',{parentId:'p',height:20})]}];
  const defaults=uiPropertyDefaults(p,declaredUiComponents(p));
  near(Number(defaults['one-child'].screenWidth),400);near(Number(defaults['one-child'].screenY),200);
  near(Number(defaults['two-child'].screenWidth),600);near(Number(defaults['two-child'].screenY),300);
  near(Number(uiPropertyDefault(p,p.ui.instances[0].components[1],'screenWidth')),400);
});

test('preview overrides affect geometry and clamped observations, never the authored project',()=>{
  const f=createUiLayoutFixture(),before=structuredClone(f.project),initial=sample(f);
  const changed=sample(f,[click('apply'),click('scroll'),click('observe')]),g=row(changed).geometry!;
  near(Number(changed.variables.layout_x),g.bounds.x);near(Number(changed.variables.layout_y),g.bounds.y);near(Number(changed.variables.layout_width),g.bounds.width);near(Number(changed.variables.layout_scroll_y),g.scrollY);near(g.scrollY,g.scrollMaximumY);
  assert.notEqual(row(changed).geometry!.matrix[1],0);assert.deepEqual(f.project,before);
  const restored=sample(f,[click('apply'),click('scroll'),click('hide'),click('reset')]);
  row(initial).geometry!.matrix.forEach((v,i)=>near(row(restored).geometry!.matrix[i],v));near(row(restored).geometry!.scrollY,0);assert.equal(row(restored,'layout_item_0').visible,true);
});

test('modal input and stale page instances cannot scroll a different live page',()=>{
  const f=createUiLayoutFixture(),initial=sample(f),root=initial.layers.find(l=>l.pageId===f.page.id)!.instance;
  const opened=sample(f,[click('child')]),old=opened.layers.find(l=>l.pageId===f.child.id)!.instance;
  const blocked=sample(f,[click('child'),{kind:'scroll',componentId:f.panel.id,pageInstance:root,dx:0,dy:80}]);near(row(blocked).geometry!.scrollY,0);
  const events:UiPreviewEvent[]=[click('child'),{kind:'scroll',componentId:'layout_child_panel',pageInstance:old,dx:0,dy:80},{kind:'click',componentId:'layout_child_close'},click('child')];
  const reopened=sample(f,events);assert.notEqual(reopened.layers.find(l=>l.pageId===f.child.id)!.instance,old);near(row(reopened,'layout_child_panel').geometry!.scrollY,0);
  const stale=sample(f,[...events,{kind:'scroll',componentId:'layout_child_panel',pageInstance:old,dx:0,dy:80}]);near(row(stale,'layout_child_panel').geometry!.scrollY,0);
});

test('wheel replay coalesces same-direction bursts but preserves reversals and instance boundaries',()=>{
  const event:UiPreviewEvent={kind:'scroll',componentId:'p',pageInstance:2,dx:0,dy:40};let events=appendUiPreviewEvent([],event);events=appendUiPreviewEvent(events,event);
  assert.equal(events.length,1);assert.equal((events[0] as typeof event).dy,80);
  events=appendUiPreviewEvent(events,{...event,dy:-40});assert.equal(events.length,2);events=appendUiPreviewEvent(events,{...event,pageInstance:3});assert.equal(events.length,3);
});

test('large sibling sets sample visibility once per identity and do not copy the project into geometry',()=>{
  const components=[c('p',{layout:{version:1,flow:'vertical',scroll:'vertical'}}),...Array.from({length:1000},(_,i)=>c('item_'+i,{parentId:'p',height:.01}))];let visits=0;
  const rows=resolveUiLayout(components,viewport,()=>{visits++;return true;});assert.equal(visits,1001);assert.equal(rows.size,1001);assert.deepEqual(Object.keys(rows.get('p')!.basis).sort(),['height','width','x','y']);
});

test('native compilation contains shared layout snapshots, affine placement and save-safe event scrolling',()=>{
  const f=createUiLayoutFixture(),compiled=compileProject(f.project),source=Object.values(compiled.files).join('\n');
  assert.deepEqual(compiled.diagnostics.filter(d=>d.severity==='error'),[]);
  assert.match(source,/vn_ui_layout_resolve/);assert.match(source,/vn_layout_children:/);assert.match(source,/transform_anchor=True/);assert.match(source,/raw_layout=False/);assert.match(source,/create_native=False/);assert.match(source,/vn_ui_layout_scroll/);assert.match(source,/layout_rows=_vn_layout/);assert.match(source,/vn_ui_layout_paintable/);
  assert.match(source,/def vn_ui_property_changes_applied\(changes, prepared_effects=None\):[\s\S]*?if prepared_effects is None:[\s\S]*?for component_id in videos: vn_ui_video_sync\(component_id\)[\s\S]*?for component_id in spines: vn_ui_spine_sync\(component_id\)[\s\S]*?elif layout: vn_ui_layout_changed\(\)/);
  assert.doesNotMatch(source,/default vn_ui_layout_(?:surfaces|widgets|rows|tasks)/);
  assert.doesNotMatch(source,/renpy\.absolute/); assert.match(source,/Transform\(pos=\(absolute\(x\),absolute\(y\)\), anchor=\(absolute\(px\),absolute\(py\)\)/);
});
