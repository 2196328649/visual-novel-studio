import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type Project, type UiComponent } from '../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph } from '../src/core/blueprint';
import { previewUiLogic, uiPreviewKeys, type UiPreviewEvent } from '../src/core/ui-logic-preview';

const click=(componentId:string):UiPreviewEvent=>({kind:'click',componentId});
const advance=(seconds:number):UiPreviewEvent=>({kind:'advance',seconds});
function button(id:string,page:UiComponent['page'],action:UiComponent['action']):UiComponent {
 return {id,page,action,kind:'button',text:id,x:0,y:0,width:.2,height:.1};
}
function increment(project:Project,variableId:string,event?:{type:'eventTimer'|'eventKey';pageId:string;interval?:number;key?:string}) {
 const graph=createBlueprintGraph('ui',variableId),entry=event?blueprintNodeDefaults(event.type):graph.nodes[0];
 if(event){entry.properties={pageId:event.pageId,interval:event.interval??1,repeat:true,key:event.key??'K_e'};graph.nodes.push(entry);}
 const read=blueprintNodeDefaults('getVariable'),math=blueprintNodeDefaults('math'),write=blueprintNodeDefaults('setVariable');
 read.properties.variableId=variableId;math.properties={operation:'add',b:1};write.properties.variableId=variableId;
 graph.nodes.push(read,math,write);connectBlueprintPins(graph,entry.id,'exec',write.id,'exec_in');connectBlueprintPins(graph,read.id,'value',math.id,'a');connectBlueprintPins(graph,math.id,'result',write.id,'value');project.blueprints.push(graph);return graph.id;
}
function fixture() {
 const p=createProject();p.variables.push({id:'visits',name:'进入次数',type:'number',initial:0,persistent:false},{id:'count',name:'计数',type:'number',initial:0,persistent:false});
 const settings=button('settings','main','preferences'),voices=button('voices','preferences','voiceSettings');
 p.ui.components.push(settings,voices,button('return_settings','preferences','return'),button('return_voices','voiceSettings','return'),button('save','main','save'),button('load','main','load'),button('return_save','save','return'));
 p.ui.components.push({...button('music_volume','preferences',undefined),kind:'preference',preference:'musicVolume'},{...button('character_volume','voiceSettings',undefined),kind:'preference',preference:'characterVolume'});
 return p;
}

test('menu navigation preserves local values, uses active scheme components, and initializes once on each entry',()=>{
 const p=fixture(),init=increment(p,'visits');p.ui.instances=[{id:'scheme',name:'方案',components:[],blueprintId:init}];p.ui.activeInstanceId='scheme';
 const base=p.ui.components.find(c=>c.id==='voices')!;p.ui.instances[0].components.push({...base,text:'方案角色音量'});
 const before=structuredClone(p),sample=(events:UiPreviewEvent[])=>previewUiLogic(p,p.ui.components.filter(c=>c.page==='main'),'ui:main',{},events);
 const events:UiPreviewEvent[]=[{kind:'parameter',id:'count',value:42},click('settings'),{kind:'control',componentId:'music_volume',value:.25},click('voices'),{kind:'control',componentId:'character_volume',value:.3},click('return_voices')];
 const result=sample(events);assert.equal(result.pageId,'ui:preferences');assert.equal(result.variables.visits,4);assert.equal(result.variables.count,42);assert.equal(result.preferences.musicVolume,.25);assert.equal(result.characterVolumes?.[''],.3);assert.equal(result.components.find(c=>c.component.id==='voices')?.component.text,'方案角色音量');assert.equal(result.incomplete,false);
 const returned=sample([...events,click('return_settings')]);assert.equal(returned.pageId,'ui:main');assert.equal(returned.variables.visits,5);
 assert.equal(sample([...events,click('return_settings'),click('return_settings')]).variables.visits,5);
 assert.deepEqual(p,before);
});

test('navigation rejects inactive, hidden and disabled buttons and keys follow the displayed page',()=>{
 const p=fixture();p.ui.components[0].shortcut='e';increment(p,'count',{type:'eventKey',pageId:'ui:main',key:'K_a'});increment(p,'visits',{type:'eventKey',pageId:'ui:preferences',key:'K_a'});
 const sample=(events:UiPreviewEvent[])=>previewUiLogic(p,p.ui.components.filter(c=>c.page==='main'),'ui:main',{},events);
 p.ui.components[0].disabled=true;assert.equal(sample([click('settings'),{kind:'key',key:'K_e'}]).pageId,'ui:main');p.ui.components[0].disabled=false;
 p.ui.components[0].visibleWhen={kind:'compare',variableId:'count',operator:'eq',value:1};assert.equal(sample([click('settings')]).pageId,'ui:main');delete p.ui.components[0].visibleWhen;
 const opened=sample([{kind:'key',key:'K_e'},click('save'),{kind:'key',key:'K_a'}]);assert.equal(opened.pageId,'ui:preferences');assert.equal(opened.variables.count,0);assert.equal(opened.variables.visits,1);
 assert.deepEqual(uiPreviewKeys(p,opened.pageId,opened.components.map(row=>row.component)),['K_a']);
});

test('page timers stop on leave, restart relative to entry, and ignore duplicate menu opens',()=>{
 const p=fixture();increment(p,'count',{type:'eventTimer',pageId:'ui:main',interval:1});increment(p,'visits',{type:'eventTimer',pageId:'ui:preferences',interval:.5});
 p.ui.components.push(button('same_settings','preferences','preferences'));
 const events=[advance(.75),click('settings'),advance(.25),click('same_settings'),advance(.25),click('return_settings'),advance(.75),advance(.25)];
 const result=previewUiLogic(p,p.ui.components.filter(c=>c.page==='main'),'ui:main',{},events,{timed:true});
 assert.equal(result.elapsed,2.25);assert.equal(result.variables.count,1);assert.equal(result.variables.visits,1);assert.equal(result.fired,2);assert.equal(result.incomplete,false);
});

test('save/load navigation isolates mode controls and returning from a dialogue restores the dialogue',()=>{
 const p=fixture();p.ui.components.push({...button('save_only','save',undefined),saveMode:'save',shortcut:'a'},{...button('load_only','save',undefined),saveMode:'load',shortcut:'a'},button('switch_load','save','load'),button('dialogue_settings','say','preferences'));
 const sample=(events:UiPreviewEvent[])=>previewUiLogic(p,p.ui.components.filter(c=>c.page==='main'),'ui:main',{},events);
 const saved=sample([click('save')]);assert.equal(saved.saveMode,'save');assert.equal(saved.components.find(c=>c.component.id==='save_only')?.visible,true);assert.equal(saved.components.find(c=>c.component.id==='load_only')?.visible,false);
 const loaded=sample([click('save'),click('switch_load')]);assert.equal(loaded.saveMode,'load');assert.equal(loaded.components.find(c=>c.component.id==='save_only')?.visible,false);assert.equal(loaded.components.find(c=>c.component.id==='load_only')?.visible,true);
 assert.equal(sample([click('load'),click('return_save')]).pageId,'ui:main');
 const dialogue=previewUiLogic(p,p.ui.components.filter(c=>c.page==='say'),'ui:say',{},[click('dialogue_settings'),click('voices'),click('return_voices'),click('return_settings')]);assert.equal(dialogue.pageId,'ui:say');
 const standalone=previewUiLogic(p,p.ui.components.filter(c=>c.page==='preferences'),'ui:preferences',{},[click('return_settings')]);assert.equal(standalone.pageId,'ui:main');
});
