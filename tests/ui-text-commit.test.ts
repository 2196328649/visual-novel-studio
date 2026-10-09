import test from 'node:test';
import assert from 'node:assert/strict';
import { textCommitFixture } from '../scripts/lib/ui-text-commit-fixture';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { ensureUiTextCommittedEvent, uiPageGraphs } from '../src/core/ui-logic';
import { compileProject } from '../src/runtime/compiler';
import { projectSchema } from '../src/core/model';
import { uiTextInput } from '../src/core/ui-control-events';

const preview=(f:ReturnType<typeof textCommitFixture>,events:UiPreviewEvent[])=>previewUiLogic(f.project,f.project.ui.components,'ui:preferences',{},events,{timed:true});
test('text edits and refreshes do not commit; explicit Enter and blur submit the current string and method',()=>{
 const f=textCommitFixture(),edit:UiPreviewEvent={kind:'control',componentId:'name_control',value:'新名称'};
 assert.equal(preview(f,[edit,{kind:'advance',seconds:1}]).variables.commit_count,0);
 for(const method of ['enter','focusLost'] as const){const r=preview(f,[edit,{kind:'textCommit',componentId:'name_control',method}]);assert.equal(r.variables.committed,'新名称');assert.equal(r.variables.commit_method,method);assert.equal(r.variables.commit_count,1);assert.equal(r.incomplete,false);}
 assert.equal(preview(f,[{kind:'textCommit',componentId:'name_control',method:'enter'}]).variables.committed,'初始');
});
test('text commits reject unavailable controls, enumerated strings and other setting types',()=>{
 for(const property of ['visible','enabled']){const f=textCommitFixture(),set=f.node('setUiProperty',{componentId:'name_control',property,value:false});f.link(f.graph.nodes[0],'exec',set,'exec_in');assert.equal(preview(f,[{kind:'textCommit',componentId:'name_control',method:'enter'}]).variables.commit_count,0);}
 const f=textCommitFixture(),open=f.node('showUiPage',{pageId:'commit_modal',wait:false});f.link(f.graph.nodes[0],'exec',open,'exec_in');assert.equal(preview(f,[{kind:'textCommit',componentId:'name_control',method:'focusLost'}]).variables.commit_count,0);
 for(const id of ['level_control','mode_control','voice_control','name_control_text'])assert.equal(uiTextInput(f.project,f.project.ui.components.find(c=>c.id===id)),false);
 assert.throws(()=>ensureUiTextCommittedEvent(f.project,f.graph,'mode_control','ui:preferences'),/文字/);
});
test('commit values are snapshots even when the callback changes the bound parameter',()=>{
 const f=textCommitFixture(),write=f.node('setVariable',{variableId:'name',value:'已清空'}),edge=f.graph.links.find(l=>l.fromNodeId===f.commit.id&&l.fromPinId==='exec')!,target=f.graph.nodes.find(n=>n.id===edge.toNodeId)!;f.graph.links=f.graph.links.filter(l=>l!==edge);f.link(f.commit,'exec',write,'exec_in');f.link(write,'exec_out',target,'exec_in');
 const r=preview(f,[{kind:'textCommit',componentId:'name_control',method:'enter'}]);assert.equal(r.variables.name,'已清空');assert.equal(r.variables.committed,'初始');assert.equal(r.variables.commit_method,'enter');
});
test('commit identity, scheme scope and data pins survive schema and native compilation',()=>{
 const f=textCommitFixture();assert.equal(ensureUiTextCommittedEvent(f.project,f.graph,'name_control','ui:preferences').id,f.commit.id);const loaded=projectSchema.parse(JSON.parse(JSON.stringify(f.project)));assert.deepEqual(compileProject(loaded).diagnostics.filter(d=>d.severity==='error'),[]);assert.deepEqual(f.commit.pins.filter(p=>p.dataType!=='exec').map(p=>[p.id,p.dataType]),[['value','string'],['method','string']]);
 loaded.ui.instances=[{id:'other',name:'其他方案',components:[]}];loaded.ui.activeInstanceId='other';assert.equal(uiPageGraphs(loaded,'ui:preferences').length,0);
 f.commit.properties.componentId='mode_control';assert.ok(compileProject(f.project).diagnostics.some(d=>d.severity==='error'&&d.message.includes('自由文字')));
});
