import test from 'node:test';
import assert from 'node:assert/strict';
import { aiSelectedUiPage,aiSelectedUiComponent,uiPageSelectionSchema,type UiPageSelection } from '../src/core/ai-selection';
import { aiRequestMessages,prepareAiChanges,applyAiChanges } from '../src/core/ai';
import { applyTextScript,projectToText } from '../src/core/text-script';
import { aiUiPageSelectionFixture } from '../scripts/lib/ai-ui-page-selection-fixture';

test('empty UI pages carry the exact page, scheme and authoring mode, including the local settings path',()=>{
 const project=aiUiPageSelectionFixture(),selection:UiPageSelection={pageId:'ui:preferences',uiInstanceId:'child',mode:'events'};
 assert.deepEqual(aiSelectedUiPage(project,selection),{...selection,name:'设置',schemeName:'同名方案',settingsPath:['ui','instances',{id:'child'},'pages','preferences'],selectionUnavailable:false});
 project.ui.activeInstanceId=undefined;assert.deepEqual(aiSelectedUiPage(project,{...selection,uiInstanceId:'base',mode:'design'})?.settingsPath,['ui','pages','preferences']);
 assert.equal(project.blueprints.length,0);assert.equal(project.ui.components.length,0);
 const custom=aiSelectedUiPage(project,{pageId:'second',mode:'events'})!;assert.equal(custom.name,'同名页面');assert.equal(custom.uiInstanceId,undefined);assert.deepEqual(custom.settingsPath,['ui','customPages',{id:'second'}]);
});

test('missing, ambiguous and mismatched UI page selections do not resolve another page or scheme',()=>{
 const project=aiUiPageSelectionFixture();
 for(const selection of [{pageId:'ui:preferences',uiInstanceId:'parent',mode:'design'},{pageId:'ui:missing',uiInstanceId:'child',mode:'events'},{pageId:'missing',mode:'design'}] as UiPageSelection[]){const resolved=aiSelectedUiPage(project,selection)!;assert.equal(resolved.selectionUnavailable,true);assert.equal(resolved.settingsPath,undefined);assert.equal(resolved.name,undefined);}
 project.ui.customPages.push(structuredClone(project.ui.customPages[0]));assert.equal(aiSelectedUiPage(project,{pageId:'first',mode:'events'})?.selectionUnavailable,true);
 assert.equal(uiPageSelectionSchema.safeParse({pageId:'ui:main',mode:'events'}).success,false);assert.equal(uiPageSelectionSchema.safeParse({pageId:'first',uiInstanceId:'child',mode:'events'}).success,false);assert.equal(aiSelectedUiPage(project),undefined);
});

test('current-page components resolve effective overrides and reject hidden or off-page stale selections',()=>{
 const project=aiUiPageSelectionFixture(),selection:UiPageSelection={pageId:'ui:preferences',uiInstanceId:'child',mode:'design'};
 const base={id:'button',kind:'button' as const,page:'preferences' as const,text:'基础',x:0,y:0,width:.1,height:.1};project.ui.components.push(base);
 project.ui.instances![1].components.push({...base,text:'本地'});assert.equal(aiSelectedUiComponent(project,base.id,selection)?.text,'本地');
 project.ui.instances![1].hiddenComponentIds=[base.id];assert.equal(aiSelectedUiComponent(project,base.id,selection),undefined);assert.ok(aiSelectedUiComponent(project,base.id));
 project.ui.customPages[1].components.push({...base,id:'custom-button',page:'custom'});assert.equal(aiSelectedUiComponent(project,'custom-button',{pageId:'first',mode:'events'}),undefined);assert.equal(aiSelectedUiComponent(project,'custom-button',{pageId:'second',mode:'events'})?.id,'custom-button');
});

test('page selection survives both truncation levels in model requests without component or graph selection',()=>{
 const project=aiUiPageSelectionFixture(),selectedUiPage:UiPageSelection={pageId:'second',mode:'events'};
 const read=()=>{const content=aiRequestMessages({id:'page',project,prompt:'修改当前页面',lineIds:[],selectedUiPage}).at(-1)!.content;return JSON.parse(content.slice(content.indexOf('\n{')+1));};
 const full=read();assert.equal(full.selectedUiComponent,undefined);assert.equal(full.selectedBlueprint,undefined);assert.equal(full.selectedUiPage.pageId,'second');
 project.assets=Array.from({length:3000},(_,i)=>({id:'asset_'+i,name:'较长素材名称'.repeat(80),kind:'image',path:i+'.png'}));const partial=read();assert.equal(partial.partial,true);assert.deepEqual(partial.selectedUiPage,full.selectedUiPage);
 project.name='X'.repeat(180000);const minimal=read();assert.equal(minimal.partial,true);assert.ok(minimal.editorFields);assert.deepEqual(minimal.selectedUiPage,full.selectedUiPage);
});

test('text roundtrips and AI preparation preserve the selected ID when UI schemes share a name',()=>{
 const project=aiUiPageSelectionFixture(),source=projectToText(project),read=applyTextScript(project,source);
 assert.deepEqual(read.issues.filter(i=>i.severity==='error'),[]);assert.equal(read.project.ui.activeInstanceId,'child');
 const changes=prepareAiChanges(project,[{kind:'editProject',path:['ui','instances',{id:'child'},'pages','preferences','background'],action:'set',value:'#354657'}],[]);
 assert.equal(applyAiChanges(read.project,changes).ui.instances![1].pages!.preferences!.background,'#354657');
 project.ui.instances![1].name='改名后';assert.equal(applyTextScript(project,source).project.ui.activeInstanceId,'child');
 for(const reference of ['同名方案【missing】','同名方案']){project.ui.instances![1].name='同名方案';const parsed=applyTextScript(project,source.replace('同名方案【child】',reference));assert.ok(parsed.issues.some(i=>i.severity==='error'&&i.message.includes('界面实例')));assert.equal(parsed.project.ui.activeInstanceId,'child');}
 assert.equal(applyTextScript(project,source.replace('同名方案【child】','parent')).project.ui.activeInstanceId,'parent');
 assert.equal(applyTextScript(project,source.replace('同名方案【child】','默认')).project.ui.activeInstanceId,undefined);
});
