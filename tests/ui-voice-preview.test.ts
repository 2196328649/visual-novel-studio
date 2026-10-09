import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiVoicePreviewFixture } from '../scripts/lib/ui-voice-preview-fixture';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { voiceCollectionView, defaultVoiceRemoveMessage } from '../src/core/voice-preview';
const click=(componentId:string):UiPreviewEvent=>({kind:'click',componentId});
const voice=(action:'play'|'favorite',assetId:string):UiPreviewEvent=>({kind:'voice',componentId:'voice_list',action,assetId});
const all:UiPreviewEvent={kind:'voiceData',data:'favorites'};
const open=click('open_voices');
function fixture(){const setup=createUiVoicePreviewFixture(),{project}=setup;return {...setup,sample:(events:UiPreviewEvent[])=>previewUiLogic(project,project.ui.components.filter(c=>c.page==='main'),'ui:main',{},events,{timed:true})};}
const view=(p:ReturnType<typeof previewUiLogic>)=>p.layers.find(layer=>layer.pageId==='ui:voiceCollection')!.voice.voice_list;

test('voice test data starts empty, keeps authored order and clamps pagination after removing the last favorite',()=>{
 const {sample,project}=fixture(),before=structuredClone(project);assert.equal(view(sample([open])).total,0);
 const page:UiPreviewEvent={kind:'voice',componentId:'voice_list',action:'page',page:1};
 assert.equal(view(sample([all,open])).entries.length,12);
 const last=sample([all,open,page]);assert.equal(view(last).entries[0].id,'voice_12');
 const deleted=sample([all,open,page,voice('favorite','voice_12')]);assert.equal(view(deleted).page,0);assert.equal(view(deleted).pages,1);assert.equal(deleted.voice.favorites.length,12);
 const refilled=sample([all,open,page,voice('favorite','voice_12'),all]);assert.equal(view(refilled).page,0);assert.deepEqual(project,before);
});
test('locked entries cannot play or toggle but a locked custom favorite can be removed; stale and off-page actions are ignored',()=>{
 const {sample}=fixture();const events:UiPreviewEvent[]=[all,{kind:'voiceData',data:'unlocks',ids:['voice_1']},open];
 assert.equal(sample([...events,voice('play','voice_0')]).voice.playback,undefined);
 assert.equal(sample([...events,voice('play','voice_12')]).voice.playback,undefined);
 assert.equal(sample([...events,voice('favorite','voice_0')]).voice.favorites.includes('voice_0'),false);
 const unlocked=sample([...events,voice('play','voice_1')]);assert.equal(unlocked.voice.playback?.assetId,'voice_1');
 assert.equal(sample([...events,{kind:'voice',componentId:'voice_list',action:'filter'},voice('favorite','voice_0')]).voice.favorites.includes('voice_0'),true);
});
test('playback replaces and restarts, stale completions do not stop the new voice, and deleting another favorite keeps playing',()=>{
 const {sample}=fixture(),events=[all,open,voice('play','voice_0')];
 const first=sample(events);assert.equal(first.voice.playback?.characterGain,.6);
 const repeated=sample([...events,voice('play','voice_0')]);assert.equal(repeated.voice.playback?.requestId,2);
 const replaced=sample([...events,voice('play','voice_1'),{kind:'voiceEnded',requestId:1}]);assert.equal(replaced.voice.playback?.assetId,'voice_1');
 assert.equal(sample([...events,voice('favorite','voice_1')]).voice.playback?.assetId,'voice_0');
 assert.equal(sample([...events,voice('favorite','voice_0')]).voice.playback,undefined);
 assert.equal(sample([...events,{kind:'voiceEnded',requestId:1}]).voice.playback,undefined);
});
test('confirmation blocks collection input without stopping voice, page exit stops it and reopening preserves favorites but resets the page',()=>{
 const {sample}=fixture(),events=[all,open,voice('play','voice_0'),click('voice_confirm')];
 const confirm=sample([...events,voice('favorite','voice_0'),voice('play','voice_1')]);assert.equal(confirm.voice.playback?.assetId,'voice_0');assert.equal(confirm.voice.favorites.length,13);
 const returned=sample([...events,click('no'),click('voices_back')]);assert.equal(returned.voice.playback,undefined);
 const again=sample([all,open,{kind:'voice',componentId:'voice_list',action:'page',page:1},voice('favorite','voice_12'),click('voices_back'),open]);assert.equal(view(again).page,0);assert.equal(again.voice.favorites.length,12);assert.equal(again.incomplete,false);
});
test('filter resets page, unpaged lists expose all entries and ordinary favorite toggles do not stop playback',()=>{
 const {project,sample}=fixture();const component=project.ui.components.find(c=>c.id==='voice_list')!;
 component.list={favoritesOnly:false,showVoiceControls:true};
 const events=[all,open,voice('play','voice_0')];assert.equal(view(sample(events)).entries.length,13);
 const removed=sample([...events,voice('favorite','voice_0')]);assert.equal(removed.voice.favorites.includes('voice_0'),false);assert.equal(removed.voice.playback?.assetId,'voice_0');
 assert.equal(view(sample([...events,{kind:'voice',componentId:'voice_list',action:'filter'}])).favoritesOnly,true);
});

test('favorite ordering follows additions, appends a recollected voice and filters unknown or disallowed favorites',()=>{
 const {project,sample}=fixture(),component=project.ui.components.find(c=>c.id==='voice_list')!;
 component.list={...component.list,voiceOrder:'favorites'};
 const favorites:UiPreviewEvent={kind:'voiceData',data:'favorites',ids:['voice_2','voice_0','voice_1']};
 assert.deepEqual(view(sample([favorites,open])).entries.map(e=>e.id),['voice_2','voice_0','voice_1']);
 const recollect=[favorites,open,voice('favorite','voice_0'),{kind:'voice',componentId:'voice_list',action:'filter'} as UiPreviewEvent,voice('favorite','voice_0'),{kind:'voice',componentId:'voice_list',action:'filter'} as UiPreviewEvent];
 assert.deepEqual(view(sample(recollect)).entries.map(e=>e.id),['voice_2','voice_1','voice_0']);
 component.list.assetIds=['voice_0','voice_2'];
 assert.deepEqual(voiceCollectionView(project,component,{favorites:['missing','voice_2','voice_1','voice_2','voice_0'],serial:0}).entries.map(e=>e.id),['voice_2','voice_0']);
 assert.equal(view(sample([...recollect,click('voices_back'),open])).entries[0].id,'voice_2');
});

test('deletion confirmation preserves playback and pagination until acceptance and cancels through Escape',()=>{
 const {project,sample}=fixture(),component=project.ui.components.find(c=>c.id==='voice_list')!;
 component.list={...component.list,voiceRemoveConfirm:true};
 const page:UiPreviewEvent={kind:'voice',componentId:'voice_list',action:'page',page:1};
 const pending=[all,open,page,voice('play','voice_12'),voice('favorite','voice_12')];
 const requested=sample(pending),confirmation=requested.layers.at(-1)!;
 assert.equal(confirmation.message,defaultVoiceRemoveMessage);assert.equal(requested.voice.favorites.length,13);assert.equal(view(requested).page,1);assert.equal(requested.voice.playback?.assetId,'voice_12');
 const blocked=sample([...pending,voice('favorite','voice_0'),voice('play','voice_1')]);assert.equal(blocked.voice.favorites.length,13);assert.equal(blocked.voice.playback?.assetId,'voice_12');
 const cancelled=sample([...pending,{kind:'key',key:'K_ESCAPE'}]);assert.equal(cancelled.pageId,'ui:voiceCollection');assert.equal(view(cancelled).page,1);assert.equal(cancelled.voice.favorites.length,13);assert.equal(cancelled.voice.playback?.assetId,'voice_12');
 const accepted=sample([...pending,{kind:'confirm',requestId:confirmation.instance,value:true}]);assert.equal(accepted.pageId,'ui:voiceCollection');assert.equal(view(accepted).page,0);assert.equal(accepted.voice.favorites.length,12);assert.equal(accepted.voice.playback,undefined);
 assert.equal(sample([...pending,{kind:'confirm',requestId:confirmation.instance+1,value:true}]).voice.favorites.length,13);
});

test('standard confirmation works without custom item geometry and removes locked favorites by identity',()=>{
 const {project,sample}=fixture(),component=project.ui.components.find(c=>c.id==='voice_list')!;
 component.list={favoritesOnly:true,voiceOrder:'favorites',voiceRemoveConfirm:true,voiceRemoveMessage:'删除 [name] {b} 收藏吗？'};
 project.ui.pages!.messageBox={layout:'native'};
 const pending=[all,{kind:'voiceData',data:'unlocks',ids:[]} as UiPreviewEvent,open,voice('favorite','voice_2')];
 const current=sample(pending),confirmation=current.layers.at(-1)!;
 assert.equal(confirmation.message,component.list.voiceRemoveMessage);assert.equal(confirmation.nativeConfirm,true);
 assert.equal(sample([...pending,click('yes')]).voice.favorites.length,13);
 const accepted=sample([...pending,{kind:'confirm',requestId:confirmation.instance,value:true}]);assert.equal(accepted.voice.favorites.includes('voice_2'),false);assert.equal(accepted.voice.favorites.length,12);assert.equal(accepted.incomplete,false);
 // A test-data change while the dialog is open must not toggle/re-add its old target.
 const gone=sample([...pending,{kind:'voiceData',data:'favorites',ids:['voice_0']},{kind:'confirm',requestId:confirmation.instance,value:true}]);assert.deepEqual(gone.voice.favorites,['voice_0']);
});
