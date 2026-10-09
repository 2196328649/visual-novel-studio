import test from 'node:test';
import assert from 'node:assert/strict';
import { uiEventSchemeFixture } from '../scripts/lib/ui-event-scheme-fixture';
import { uiEventAuthoringGraph, ownsUiEventGraph, findUiControlEvent, ensureUiButtonEvent, ensureUiClickEvent, ensureUiValueChangedEvent, ensureUiTextCommittedEvent, createUiEventGraph } from '../src/core/ui-logic';
import { blueprintNodeDefaults, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { effectiveUiComponents, projectSchema } from '../src/core/model';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { compileProject } from '../src/runtime/compiler';

test('new control events are owned by the current scheme and reuse its graph without mutating the parent',()=>{
 const {project,parent}=uiEventSchemeFixture(),before=structuredClone(parent),child=uiEventAuthoringGraph(project,'ui:preferences','设置',parent.id);
 assert.equal(child.uiInstanceId,'child');assert.notEqual(child.id,parent.id);assert.equal(uiEventAuthoringGraph(project,'ui:preferences','设置',parent.id).id,child.id);
 ensureUiButtonEvent(project,child,'trigger','ui:preferences','press');ensureUiClickEvent(project,child,'trigger','ui:preferences');ensureUiValueChangedEvent(project,child,'slider','ui:preferences');ensureUiTextCommittedEvent(project,child,'input','ui:preferences');
 assert.deepEqual(parent,before);assert.ok(child.nodes.filter(n=>n.type!=='event').every(n=>n.properties.uiInstanceId==='child'));
 assert.equal(findUiControlEvent(project,'ui:preferences','input','eventTextCommitted')?.g.id,child.id);assert.equal(findUiControlEvent(project,'ui:preferences','trigger','eventButton','hover')?.g.id,parent.id);
 const second=createUiEventGraph(project,'ui:preferences','另一张图');assert.equal(uiEventAuthoringGraph(project,'ui:preferences','设置',second.id).id,second.id);
 project.ui.activeInstanceId='sibling';const sibling=uiEventAuthoringGraph(project,'ui:preferences','设置',child.id);assert.equal(sibling.uiInstanceId,'sibling');assert.notEqual(sibling.id,child.id);
});

test('parent and local events both run on the child, while parent and sibling never acquire the new local handlers',()=>{
 const {project,parent}=uiEventSchemeFixture(),child=uiEventAuthoringGraph(project,'ui:preferences','设置',parent.id);
 const inherited=parent.nodes.find(n=>n.type==='eventButton')!,local=ensureUiButtonEvent(project,child,'trigger','ui:preferences','hover'),changed=ensureUiValueChangedEvent(project,child,'slider','ui:preferences'),committed=ensureUiTextCommittedEvent(project,child,'input','ui:preferences');
 for(const [graph,event,id] of [[parent,inherited,'parent_seen'],[child,local,'child_seen'],[child,changed,'changed_seen'],[child,committed,'commit_seen']] as const){project.variables.push({id,name:id,type:'boolean',initial:false,persistent:false});const node=blueprintNodeDefaults('setVariable');node.properties={variableId:id,value:true};graph.nodes.push(node);connectBlueprintPins(graph,event.id,'exec',node.id,'exec_in');}
 synchronizeBlueprintSignatures(project);const loaded=projectSchema.parse(JSON.parse(JSON.stringify(project))),events:UiPreviewEvent[]=[{kind:'button',componentId:'trigger',trigger:'hover'},{kind:'control',componentId:'slider',value:.8},{kind:'textCommit',componentId:'input',method:'enter'}];
 for(const id of ['parent','child','sibling']){loaded.ui.activeInstanceId=id;const result=previewUiLogic(loaded,effectiveUiComponents(loaded.ui),'ui:preferences',{},events);assert.equal(result.variables.parent_seen,true);for(const variable of ['child_seen','changed_seen','commit_seen'])assert.equal(result.variables[variable],id==='child');assert.equal(result.incomplete,false);assert.deepEqual(compileProject(loaded).diagnostics.filter(d=>d.severity==='error'),[]);}
});

test('unscoped legacy graphs and graphs owned by another page are not reused for new events; custom pages have page ownership',()=>{
 const {project,parent}=uiEventSchemeFixture();parent.uiInstanceId=undefined;assert.equal(ownsUiEventGraph(project,parent,'ui:preferences'),false);
 const local=uiEventAuthoringGraph(project,'ui:preferences','设置',parent.id);assert.equal(local.uiInstanceId,'child');
 const other=uiEventAuthoringGraph(project,'ui:main','标题',local.id);assert.equal(other.uiPageId,'ui:main');
 project.ui.customPages=[{id:'overlay',name:'弹窗',modal:true,components:[]}];const custom=uiEventAuthoringGraph(project,'overlay','弹窗',other.id);assert.equal(custom.uiInstanceId,undefined);project.ui.activeInstanceId='sibling';assert.equal(uiEventAuthoringGraph(project,'overlay','弹窗').id,custom.id);
 assert.throws(()=>uiEventAuthoringGraph(project,'missing','不存在'),/不存在/);
});
