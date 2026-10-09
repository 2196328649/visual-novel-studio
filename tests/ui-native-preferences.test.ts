import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveUiComponents } from '../src/core/model';
import { nativePreferencePreview } from '../src/core/ui-native-preview';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { uiNativePreferencesFixture } from '../scripts/lib/ui-native-preferences-fixture';

test('standard settings controls share values with blueprints, options and character volumes without writing the project',()=>{
 const project=uiNativePreferencesFixture(),before=structuredClone(project),events:UiPreviewEvent[]=[{kind:'click',componentId:'open'}];
 const sample=()=>previewUiLogic(project,project.ui.components.filter(c=>c.page==='main'),'ui:main',{},events);
 const id=(text:string)=>sample().components.find(row=>row.component.text===text)!.component.id;
 const click=(text:string)=>events.push({kind:'click',componentId:id(text)}),control=(text:string,value:number)=>events.push({kind:'control',componentId:id(text),value});
 assert.ok(sample().layers[0].nativeLayout);control('音乐音量',.25);assert.equal(sample().preferences.musicVolume,.25);assert.equal(sample().components.find(c=>c.component.id==='linked_volume')?.component.value,.25);
 control('文字速度',0);assert.equal(sample().preferences.textSpeed,0);click('全屏');assert.equal(sample().preferences.fullscreen,true);const size=sample().components.find(r=>r.component.preference==='windowSize')!;assert.equal(size.state,'disabled');events.push({kind:'click',componentId:size.component.id});assert.equal(sample().preferences.windowSize,'1280x720');click('窗口');click('960 × 540');assert.equal(sample().preferences.windowSize,'960x540');
 click('全部文本');assert.equal(sample().preferences.skipAll,true);click('跳过转场');assert.equal(sample().transitions,false);click('全部静音');assert.equal(sample().muted,true);click('全部静音');assert.equal(sample().muted,false);
 click('角色音量');control('小雨',.3);assert.equal(sample().characterVolumes?.hero,.3);assert.equal(sample().characterVolumes?.other,undefined);events.push({kind:'key',key:'K_ESCAPE'});assert.equal(sample().pageId,'ui:preferences');assert.equal(sample().preferences.musicVolume,.25);assert.equal(sample().incomplete,false);assert.deepEqual(project,before);
});

test('reset waits for confirmation, cancels safely and restores only settings to authored defaults',()=>{
 const project=uiNativePreferencesFixture(),events:UiPreviewEvent[]=[{kind:'click',componentId:'open'},{kind:'parameter',id:'story',value:8},{kind:'parameter',id:'custom',value:44},{kind:'parameter',id:'hidden',value:false}];
 const sample=()=>previewUiLogic(project,project.ui.components.filter(c=>c.page==='main'),'ui:main',{},events),id=(text:string)=>sample().components.find(r=>r.component.text===text)!.component.id;
 events.push({kind:'control',componentId:id('音乐音量'),value:.2},{kind:'click',componentId:id('全部静音')});const reset=id('恢复初始设置');events.push({kind:'click',componentId:reset});const first=sample().layers.at(-1)!;assert.equal(first.message,'恢复全部初始设置吗？');assert.equal(sample().preferences.musicVolume,.2);
 events.push({kind:'key',key:'K_ESCAPE'});assert.equal(sample().preferences.musicVolume,.2);events.push({kind:'click',componentId:reset});const second=sample().layers.at(-1)!;events.push({kind:'confirm',requestId:first.instance,value:true});assert.equal(sample().preferences.musicVolume,.2);events.push({kind:'confirm',requestId:second.instance,value:true});assert.equal(sample().preferences.musicVolume,.7);assert.equal(sample().muted,false);assert.equal(sample().variables.custom,25);assert.equal(sample().variables.hidden,true);assert.equal(sample().variables.story,8);assert.equal(sample().pageId,'ui:preferences');assert.equal(sample().incomplete,false);
});

test('native layout respects replacements, schemes, settings visibility and custom page layouts',()=>{
 const project=uiNativePreferencesFixture();project.ui.components.push({id:'replace',page:'preferences',kind:'preference',text:'',preference:'musicVolume',x:0,y:0,width:.2,height:.1});
 const native=nativePreferencePreview(project,'ui:preferences',effectiveUiComponents(project.ui).filter(c=>c.page==='preferences'))!;assert.equal(native.components.filter(c=>c.preference==='musicVolume').length,0);assert.ok(native.components.some(c=>c.parameterId==='custom'));assert.equal(native.components.some(c=>c.parameterId==='hidden'),false);assert.ok(native.contentHeight>native.height);
 project.ui.instances=[{id:'custom-scheme',name:'自定义方案',components:[],pages:{preferences:{layout:'custom'}}}];project.ui.activeInstanceId='custom-scheme';assert.equal(nativePreferencePreview(project,'ui:preferences',[])?.kind,'shortcut');assert.ok(nativePreferencePreview(project,'ui:voiceSettings',[]));
 const result=previewUiLogic(project,[],'ui:preferences');assert.equal(result.layers[0].nativeLayout?.kind,'shortcut');assert.equal(result.components.length,1);assert.equal(result.components[0].component.text,'更多设置');
});
