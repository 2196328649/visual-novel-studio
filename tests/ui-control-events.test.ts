import test from 'node:test';
import assert from 'node:assert/strict';
import { controlEventFixture } from '../scripts/lib/ui-control-event-fixture';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { projectSchema } from '../src/core/model';
import { ensureUiValueChangedEvent, uiPageGraphs } from '../src/core/ui-logic';
import { synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { compileProject } from '../src/runtime/compiler';

const preview=(f:ReturnType<typeof controlEventFixture>,events:UiPreviewEvent[])=>previewUiLogic(f.project,f.project.ui.components,'ui:preferences',{},events,{timed:true});
test('control events expose typed previous and new values after actual user changes',()=>{
 const f=controlEventFixture();let result=preview(f,[]);for(const c of f.controls)assert.equal(result.variables[c.id+'_count'],0);
 for(const [id,value,previous] of [['level_control',42,10],['toggle_control',true,false],['mode_control','困难','普通'],['name_control','新名称','初始'],['volume_control',.5,1],['voice_control',true,false]] as const){
  result=preview(f,[{kind:'control',componentId:id,value},{kind:'control',componentId:id,value}]);assert.equal(result.variables[id+'_value'],value);assert.equal(result.variables[id+'_previous'],previous);assert.equal(result.variables[id+'_count'],1);assert.equal(result.incomplete,false);
 }
});
test('programmatic writes and preview test parameters do not emit control events',()=>{
 const f=controlEventFixture(),set=f.node('setVariable',{variableId:'level',value:25});f.link(f.graph.nodes[0],'exec',set,'exec_in');
 const result=preview(f,[{kind:'parameter',id:'level',value:40},{kind:'advance',seconds:1},{kind:'control',componentId:'level_control',value:41}]);assert.equal(result.variables.level_control_count,1);assert.equal(result.variables.level_control_previous,40);
});
test('hidden, disabled and modally covered controls reject user changes',()=>{
 for(const property of ['visible','enabled']){const f=controlEventFixture(),set=f.node('setUiProperty',{componentId:'level_control',property,value:false});f.link(f.graph.nodes[0],'exec',set,'exec_in');const result=preview(f,[{kind:'control',componentId:'level_control',value:50}]);assert.equal(result.variables.level,10);assert.equal(result.variables.level_control_count,0);}
 const f=controlEventFixture();f.project.ui.customPages.push({id:'modal',name:'覆盖页',modal:true,components:[]});const open=f.node('showUiPage',{pageId:'modal',wait:false});f.link(f.graph.nodes[0],'exec',open,'exec_in');assert.equal(preview(f,[{kind:'control',componentId:'level_control',value:50}]).variables.level_control_count,0);
});
test('event values remain the input snapshot even if handlers rewrite the setting',()=>{
 const f=controlEventFixture(),entry=f.entries.get('level_control')!,write=f.node('setVariable',{variableId:'level',value:90});const first=f.graph.links.find(l=>l.fromNodeId===entry.id&&l.fromPinId==='exec')!;const target=f.graph.nodes.find(n=>n.id===first.toNodeId)!;f.graph.links=f.graph.links.filter(l=>l!==first);f.link(entry,'exec',write,'exec_in');f.link(write,'exec_out',target,'exec_in');
 const result=preview(f,[{kind:'control',componentId:'level_control',value:20}]);assert.equal(result.variables.level,90);assert.equal(result.variables.level_control_value,20);assert.equal(result.variables.level_control_previous,10);assert.equal(result.variables.level_control_count,1);
});
test('control signatures, event identity and scope survive serialization and reject invalid sources',()=>{
 const f=controlEventFixture();assert.equal(ensureUiValueChangedEvent(f.project,f.graph,'toggle_control','ui:preferences').id,f.entries.get('toggle_control')!.id);const loaded=projectSchema.parse(JSON.parse(JSON.stringify(f.project)));assert.deepEqual(compileProject(loaded).diagnostics.filter(d=>d.severity==='error'),[]);
 assert.equal(f.entries.get('toggle_control')!.pins.find(p=>p.id==='value')!.dataType,'boolean');assert.equal(f.entries.get('mode_control')!.pins.find(p=>p.id==='previous')!.dataType,'string');
 loaded.ui.instances=[{id:'other',name:'另一界面',components:[]}];loaded.ui.activeInstanceId='other';assert.equal(uiPageGraphs(loaded,'ui:preferences').length,0);synchronizeBlueprintSignatures(loaded);assert.equal(loaded.blueprints[0].nodes.find(n=>n.id===f.entries.get('toggle_control')!.id)!.pins.find(p=>p.id==='value')!.dataType,'boolean');
 f.entries.get('level_control')!.properties.componentId='level_control_text';assert.ok(compileProject(f.project).diagnostics.some(d=>d.severity==='error'&&d.message.includes('已绑定参数')));
 f.entries.get('level_control')!.properties.componentId='toggle_control';synchronizeBlueprintSignatures(f.project);assert.ok(compileProject(f.project).diagnostics.some(d=>d.severity==='error'&&d.message.includes('类型')));
});
