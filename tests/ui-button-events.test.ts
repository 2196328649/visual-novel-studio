import test from 'node:test';
import assert from 'node:assert/strict';
import { buttonEventFixture } from '../scripts/lib/ui-button-event-fixture';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { ensureUiButtonEvent, uiPageGraphs } from '../src/core/ui-logic';
import { projectSchema } from '../src/core/model';
import { compileProject } from '../src/runtime/compiler';
const event=(trigger:'hover'|'unhover'|'press'|'release'|'cancel',componentId='target',inside?:boolean):UiPreviewEvent=>({kind:'button',trigger,componentId,inside});
function fixture(){const f=buttonEventFixture();const preview=(events:UiPreviewEvent[])=>previewUiLogic(f.project,f.project.ui.components,'ui:main',{},events,{timed:true});const trace=(events:UiPreviewEvent[])=>preview(events).components.find(c=>c.component.id==='trace')!.component.text;return {...f,preview,trace};}

test('button entry transitions fire once and ordered release occurs before click',()=>{
 const f=fixture(),events=[event('hover'),event('hover'),event('press'),event('press')];
 let result=f.preview(events);assert.equal(result.components.find(c=>c.component.id==='target')!.state,'pressed');assert.equal(f.trace(events),'HP');
 events.push(event('release'));assert.equal(f.trace(events),'HPRC');events.push(event('unhover'));assert.equal(f.trace(events),'HPRCU');assert.equal(f.preview(events).incomplete,false);
 assert.equal(f.trace([{kind:'click',componentId:'target'}]),'PRC','keyboard-style activation shares press/release/click ordering');
});
test('release outside does not click; reentering during a hold can click; cancellation clears held state',()=>{
 const f=fixture();assert.equal(f.trace([event('hover'),event('press'),event('unhover'),event('release','target',false)]),'HPUR');
 assert.equal(f.trace([event('hover'),event('press'),event('unhover'),event('hover'),event('release','target',true)]),'HPUHRC');
 assert.equal(f.trace([event('hover'),event('press'),event('cancel'),event('release')]),'HP');
});
test('hiding or disabling a held button cancels release and click without reviving it',()=>{
 for(const id of ['hide','disable']){const f=fixture();assert.equal(f.trace([event('hover',id),event('press',id),event('release',id),{kind:'click',componentId:id}]),'HP');const state=f.preview([event('press',id)]).components.find(c=>c.component.id===id)!;assert.equal(id==='hide'?state.visible:state.state,id==='hide'?false:'disabled');}
});
test('a modal page cancels covered button input and does not deliver deferred pointer events',()=>{
 const f=fixture();f.project.ui.customPages.push({id:'modal',name:'覆盖页',components:[],modal:true});const open=f.node('showUiPage',{pageId:'modal',wait:false});f.link(f.endings.get('target:press')!,'exec_out',open,'exec_in');
 const result=f.preview([event('hover'),event('press'),event('release'),{kind:'cancelPage',pageId:'modal'},event('release')]);assert.equal(result.layers.find(l=>l.pageId==='ui:main')!.components.find(c=>c.component.id==='trace')!.component.text,'HP');
 for(const [id,expected] of [['modal','P'],['release_modal','PR']])assert.equal(f.trace([{kind:'click',componentId:id},{kind:'click',componentId:'overlay_close'}]),expected);
 assert.equal(f.trace([event('hover','release_modal'),event('press','release_modal'),event('release','release_modal'),{kind:'click',componentId:'overlay_close'}]),'HPR');
});
test('timer-driven disable cancels presses before a later release even when re-enabled',()=>{
 const f=fixture(),timer=f.node('eventTimer',{pageId:'ui:main',interval:.5,repeat:false}),disable=f.node('setUiProperty',{componentId:'target',property:'enabled',value:false});f.link(timer,'exec',disable,'exec_in');
 const later=f.node('eventTimer',{pageId:'ui:main',interval:.75,repeat:false}),enable=f.node('setUiProperty',{componentId:'target',property:'enabled',value:true});f.link(later,'exec',enable,'exec_in');
 assert.equal(f.trace([event('press'),{kind:'advance',seconds:1},event('release')]),'P');
 assert.equal(f.preview([event('press'),{kind:'advance',seconds:1}]).components.find(c=>c.component.id==='target')!.state,'idle');
 assert.equal(f.trace([event('press','restore'),event('release','restore')]),'P');
 assert.equal(f.trace([{kind:'click',componentId:'restore'}]),'P');
});
test('event identity, scope and validation survive project reload',()=>{
 const f=fixture(),event=ensureUiButtonEvent(f.project,f.graph,'target','ui:main','hover');assert.equal(ensureUiButtonEvent(f.project,f.graph,'target','ui:main','hover').id,event.id);
 const loaded=projectSchema.parse(JSON.parse(JSON.stringify(f.project)));assert.deepEqual(compileProject(loaded).diagnostics.filter(d=>d.severity==='error'),[]);
 loaded.ui.instances=[{id:'other',name:'另一界面',components:[]}];loaded.ui.activeInstanceId='other';assert.equal(uiPageGraphs(loaded,'ui:main').includes(loaded.blueprints[0]),false);
 event.properties.trigger='invalid';assert.ok(compileProject(f.project).diagnostics.some(d=>d.message.includes('按钮交互事件')));
 event.properties.trigger='hover';event.properties.componentId='trace';assert.ok(compileProject(f.project).diagnostics.some(d=>d.message.includes('按钮')));
});
