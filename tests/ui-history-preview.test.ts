import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph } from '../src/core/blueprint';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiHistoryFixture } from '../scripts/lib/ui-history-preview-fixture';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { historyPreviewEntries } from '../src/core/history-preview';
import { nativeHistoryPreview } from '../src/core/ui-native-history-preview';
import { projectSchema } from '../src/core/model';
import { voiceVisitKey } from '../src/core/story-menu';
import { historyPreviewAction } from '../src/core/history-preview';
import { voiceCollectionAction, voiceCollectionView } from '../src/core/voice-preview';

const click=(componentId:string):UiPreviewEvent=>({kind:'click',componentId}),open=click('open_history');
const history=(action:'play'|'favorite',lineId:string,componentId='history_list'):UiPreviewEvent=>({kind:'history',componentId,action,lineId});
function fixture(native=false){const project=createUiHistoryFixture(native);projectSchema.parse(project);return {project,key:(lineId:string)=>voiceVisitKey(project.nodes.find(n=>n.kind==='passage')!.id,lineId),sample:(events:UiPreviewEvent[])=>previewUiLogic(project,project.ui.components.filter(c=>c.page==='main'),'ui:main',{},events)};}

test('history samples preserve non-silent records including duplicates, omit invalid voices and cap selected passages at the runtime history limit',()=>{
 const {project,sample}=fixture(),view=sample([open]);assert.equal(view.history.length,15);assert.equal(view.history.at(-1)?.id,'duplicate_voice');assert.equal(view.history.find(l=>l.id==='unvoiced')?.voiceId,undefined);assert.equal(view.history.find(l=>l.id==='silent_line'),undefined);
 const passage=project.nodes.find(n=>n.kind==='passage')!;passage.lines.push({id:'invalid_voice',text:'缺失语音',voiceId:'absent',actions:[]});assert.equal(sample([open]).history.at(-1)?.available,false);
 passage.lines=Array.from({length:270},(_,i)=>({id:'sample_'+i,text:'对白 '+i,actions:[]}));assert.equal(historyPreviewEntries(project).length,20);assert.equal(historyPreviewEntries(project,{nodeId:passage.id}).length,250);assert.equal(historyPreviewEntries(project,{nodeId:passage.id})[0].id,'sample_20');
});

test('history favorites keep independent dialogue identities for reused audio, preserve playback while toggling and respect unlocks',()=>{
 const {project,sample,key}=fixture(),before=structuredClone(project),events=[open,history('play','voice_line_0'),history('favorite','duplicate_voice')];
 const result=sample(events);assert.equal(result.voice.playback?.assetId,'voice_0');assert.equal(result.voice.playback?.characterGain,.6);assert.deepEqual(result.voice.favorites,[key('duplicate_voice')]);assert.equal(result.history.filter(l=>l.favorite).length,1);assert.equal(result.history.find(l=>l.id==='voice_line_0')?.favorite,false);assert.equal(result.history.find(l=>l.id==='duplicate_voice')?.playing,false);
 const both=sample([...events,history('favorite','voice_line_0')]);assert.deepEqual(both.voice.favorites,[key('duplicate_voice'),key('voice_line_0')]);assert.equal(both.voice.playback?.requestId,1);
 const removed=sample([...events,history('favorite','duplicate_voice')]);assert.deepEqual(removed.voice.favorites,[]);assert.equal(removed.voice.playback?.requestId,1);
 assert.equal(sample([...events,{kind:'voiceData',data:'unlocks',ids:[]},history('play','voice_line_0')]).voice.playback,undefined);
 assert.deepEqual(sample([...events,{kind:'voiceData',data:'unlocks',ids:[]},history('favorite','voice_line_0')]).voice.favorites,[key('duplicate_voice')]);assert.deepEqual(project,before);
});

test('history and favorites page transitions stop the shared channel while retaining favorite state, including same-instance blueprint menus',()=>{
 for(const menu of [false,true]){
 const {project,sample,key}=fixture();
 if(menu){const graph=createBlueprintGraph('ui','打开历史菜单'),node=blueprintNodeDefaults('uiAction');node.properties={screen:'history'};graph.nodes.push(node);connectBlueprintPins(graph,graph.nodes[0].id,'exec',node.id,'exec_in');project.blueprints.push(graph);Object.assign(project.ui.components.find(c=>c.id==='open_history')!,{action:'blueprint',blueprintId:graph.id});}
 const events=[open,history('play','voice_line_0'),history('favorite','voice_line_0'),click('history_favorites')],favorite=sample(events);
 assert.equal(favorite.layers.at(-1)?.mode,menu?'menu':'root');
 assert.equal(favorite.voice.playback,undefined);assert.deepEqual(favorite.voice.favorites,[key('voice_line_0')]);assert.equal(favorite.layers.at(-1)!.voice.voice_list.total,1);
 const replay:UiPreviewEvent={kind:'voice',componentId:'voice_list',action:'play',assetId:key('voice_line_0')};
 assert.equal(sample([...events,replay]).voice.playback?.assetId,'voice_0');const back=sample([...events,replay,click('favorites_history')]);assert.equal(back.voice.playback,undefined);assert.equal(back.history.find(l=>l.id==='voice_line_0')?.favorite,true);assert.equal(back.incomplete,false);
 }
});

test('collected dialogue keeps its caption and character after history eviction, removes only the target sharing an audio file and appends recollection',()=>{
 const {project,key}=fixture(),historyList=project.ui.components.find(c=>c.id==='history_list')!,list=project.ui.components.find(c=>c.id==='voice_list')!;
 list.list={...list.list,voiceOrder:'favorites',voiceRemoveConfirm:true};
 let state=historyPreviewAction(project,historyList,{favorites:[],serial:0},{},{action:'favorite',lineId:'voice_line_0'});
 state=historyPreviewAction(project,historyList,state,{},{action:'favorite',lineId:'duplicate_voice'});
 const text=state.logs![key('voice_line_0')].text,passage=project.nodes.find(n=>n.kind==='passage')!;passage.lines[0].text='后续修订';
 assert.deepEqual(voiceCollectionView(project,list,state).entries.map(e=>e.text),[text,'同一语音的另一条记录']);
 state=voiceCollectionAction(project,list,state,undefined,{action:'play',assetId:key('voice_line_0')}).state;
 const pending=voiceCollectionAction(project,list,state,undefined,{action:'favorite',assetId:key('duplicate_voice')});assert.ok(pending.confirmation);assert.equal(pending.state,state);
 const removed=voiceCollectionAction(project,list,state,undefined,{action:'favorite',assetId:key('duplicate_voice')},undefined,1,{confirmed:true}).state;
 assert.equal(removed.playback?.entryId,key('voice_line_0'));assert.deepEqual(removed.favorites,[key('voice_line_0')]);
 const restored=historyPreviewAction(project,historyList,removed,{},{action:'favorite',lineId:'duplicate_voice'});assert.deepEqual(restored.favorites,[key('voice_line_0'),key('duplicate_voice')]);
 passage.lines=[];assert.equal(voiceCollectionView(project,list,restored).total,2);
 assert.equal(voiceCollectionAction(project,list,restored,undefined,{action:'favorite',assetId:key('voice_line_0')},undefined,1,{confirmed:true}).state.playback,undefined);
 list.list.assetIds=['voice_1'];assert.equal(voiceCollectionView(project,list,restored).total,0);
});

test('reused voice uses the dialogue speaker gain and legacy resource favorites remain separate',()=>{
 const {project,sample,key}=fixture();project.characters.push({id:'other',name:'另一角色',color:'#ffffff',expressions:[]});
 project.nodes.find(n=>n.kind==='passage')!.lines.find(l=>l.id==='duplicate_voice')!.speakerId='other';
 project.ui.components.push({id:'other_volume',page:'history',kind:'preference',text:'另一角色音量',preference:'characterVolume',preferenceCharacterId:'other',x:0,y:0,width:.2,height:.1});
 const events:UiPreviewEvent[]=[open,{kind:'control',componentId:'other_volume',value:.2},history('play','duplicate_voice'),history('favorite','duplicate_voice')];
 const playing=sample(events);assert.equal(playing.voice.playback?.characterGain,.2);assert.equal(playing.voice.playback?.entryId,key('duplicate_voice'));assert.equal(playing.voice.playback?.assetId,'voice_0');
 const result=sample([...events,{kind:'voiceData',data:'favorites',ids:['voice_0',key('duplicate_voice')]},click('history_favorites')]);
 assert.deepEqual(result.layers.at(-1)!.voice.voice_list.entries.map(e=>e.id),['voice_0',key('duplicate_voice')]);
 const replay=sample([...events,{kind:'voiceData',data:'favorites',ids:['voice_0',key('duplicate_voice')]},click('history_favorites'),{kind:'voice',componentId:'voice_list',action:'play',assetId:key('duplicate_voice')}]);assert.equal(replay.voice.playback?.characterGain,.2);
});

test('confirmation blocks history actions without stopping audio, stale completions do not stop replacement playback, and sample changes stop playback',()=>{
 const {sample}=fixture(),events=[open,history('play','voice_line_0'),click('history_confirm')];
 const modal=sample([...events,history('play','voice_line_1'),history('favorite','voice_line_1')]);assert.equal(modal.voice.playback?.assetId,'voice_0');assert.deepEqual(modal.voice.favorites,[]);
 const replaced=sample([...events,click('no'),history('play','voice_line_1'),{kind:'voiceEnded',requestId:1}]);assert.equal(replaced.voice.playback?.assetId,'voice_1');
 const empty=sample([open,history('play','voice_line_0'),{kind:'historyData',empty:true},history('play','voice_line_0')]);assert.equal(empty.history.length,0);assert.equal(empty.voice.playback,undefined);
 assert.equal(sample([open,{kind:'historyData',nodeId:'absent'}]).history.length,15);
});

test('native history and favorites controls are temporary, respect replacements and custom schemes, and can share playback and collection state',()=>{
 const {project,sample}=fixture(true),before=structuredClone(project),opened=sample([open]),layer=opened.layers.at(-1)!;assert.equal(layer.nativeLayout?.kind,'history');
 const list=layer.components.find(r=>r.component.kind==='historyList')!.component;
 const favorite=sample([open,history('favorite','voice_line_0',list.id),click('history_favorites')]);assert.equal(favorite.layers.at(-1)?.nativeLayout?.kind,'voices');assert.equal(Object.values(favorite.layers.at(-1)!.voice)[0].total,1);assert.equal(favorite.incomplete,false);assert.deepEqual(project,before);
 const replaced=nativeHistoryPreview(project,'ui:history',[{...list,id:'authored_history'}])!;assert.equal(replaced.bodyIds.length,0);
 project.ui.instances=[{id:'custom_history',name:'自定义历史',components:[],pages:{history:{layout:'custom'}}}];project.ui.activeInstanceId='custom_history';assert.equal(nativeHistoryPreview(project,'ui:history',[]),undefined);
});
