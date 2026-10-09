import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiMusicPreviewFixture } from '../scripts/lib/ui-music-preview-fixture';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { musicRoomEntries } from '../src/core/music-preview';
import { nativeMusicPreview } from '../src/core/ui-native-music-preview';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph } from '../src/core/blueprint';

const click = (componentId: string): UiPreviewEvent => ({ kind: 'click', componentId:componentId.toLowerCase() });
const open = click('open_music');
const play = (assetId: string): UiPreviewEvent => ({ kind: 'music', componentId: 'music_list', action: 'play', assetId });
function fixture(native = false) { const project = createUiMusicPreviewFixture(native); return { project, sample: (events: UiPreviewEvent[]) => previewUiLogic(project, project.ui.components.filter(c => c.page === 'main'), 'ui:main', {}, events) }; }
const view = (preview: ReturnType<typeof previewUiLogic>) => preview.layers.at(-1)!.music.music_list;

test('music list preserves authored order, paginates, gates unlocks and rejects off-page or disabled input without changing the project', () => {
 const { project, sample } = fixture(), before = structuredClone(project);
 assert.deepEqual(view(sample([open])).entries.map(a => a.id), ['track_12','track_11','track_10','track_9']);
 assert.equal(sample([open,play('track_0')]).music.playback, undefined);
 const page: UiPreviewEvent = { kind: 'music', componentId: 'music_list', action: 'page', page: 3 };
 assert.equal(view(sample([open,page])).entries.length, 1);
 assert.equal(sample([open,page,play('track_0')]).music.playback?.assetId, 'track_0');
 assert.equal(view(sample([open,{...page,page:NaN}])).page, 0);
 assert.equal(sample([open,{kind:'musicData',ids:['track_11']},play('track_12')]).music.playback, undefined);
 assert.equal(sample([open,{kind:'musicData',ids:['track_11']},play('track_11')]).music.playback?.assetId, 'track_11');
 assert.deepEqual(project,before); project.ui.components.find(c=>c.id==='musicnext')!.disabled=true;
 assert.equal(sample([open,click('musicNext')]).music.playback,undefined);
});

test('music transport pauses and resumes the same request, restarts on replay, skips locked tracks and ignores stale endings', () => {
 const { sample } = fixture(), events: UiPreviewEvent[] = [open,{kind:'musicData',ids:['track_10','track_12']},play('track_12')];
 const paused=sample([...events,click('musicPlayPause')]);assert.equal(paused.music.playback?.paused,true);
 const resumed=sample([...events,click('musicPlayPause'),play('track_12')]);assert.equal(resumed.music.playback?.requestId,1);assert.equal(resumed.music.playback.paused,false);
 assert.equal(sample([...events,play('track_12')]).music.playback?.requestId,2);
 assert.equal(sample([...events,click('musicNext')]).music.playback?.assetId,'track_10');
 assert.equal(sample([...events,click('musicPrevious')]).music.playback?.assetId,'track_10');
 assert.equal(sample([...events,click('musicNext'),{kind:'musicEnded',requestId:1}]).music.playback?.assetId,'track_10');
 assert.equal(sample([...events,click('musicStop')]).music.playback,undefined);
 assert.equal(sample([open]).components.find(r=>r.component.action==='musicPlayPause')?.state,'disabled');
});

test('playlist completion advances, loop-off stops at end, shuffle is stable and does not repeat until the cycle ends', () => {
 const { sample }=fixture(),events:UiPreviewEvent[]=[open,{kind:'musicData',ids:['track_10','track_11','track_12']},play('track_12')];
 assert.equal(sample([...events,{kind:'musicEnded',requestId:1}]).music.playback?.assetId,'track_10');
 assert.equal(sample([...events,click('musicLoop'),{kind:'musicEnded',requestId:1}]).music.playback,undefined);
 assert.equal(sample([...events,{kind:'musicEnded',requestId:1,failed:true}]).music.playback,undefined);
 events.push(click('musicShuffle'));const order=sample(events).music.order!;assert.equal(new Set(order).size,3);assert.equal(order[0],'track_12');assert.deepEqual(sample(events).music.order,order);
 events.push({kind:'musicEnded',requestId:1});assert.equal(sample(events).music.playback?.assetId,order[1]);
 events.push({kind:'musicEnded',requestId:2});assert.equal(sample(events).music.playback?.assetId,order[2]);
});

test('confirmation blocks input but retains playback; leaving, changing test data, or folding stops audio and reopening resets pagination', () => {
 const { sample }=fixture(),events=[open,play('track_12'),click('music_confirm')];
 const modal=sample([...events,play('track_11'),click('musicStop')]);assert.equal(modal.music.playback?.assetId,'track_12');
 const returned=sample([...events,click('no'),click('music_back')]);assert.equal(returned.music.playback,undefined);assert.equal(returned.musicRoomOpen,false);
 assert.equal(sample([open,play('track_12'),{kind:'musicStop'}]).music.playback,undefined);
 assert.equal(sample([open,play('track_12'),{kind:'musicData',ids:[]}]).music.playback,undefined);
 assert.equal(view(sample([open,{kind:'music',componentId:'music_list',action:'page',page:3},click('music_back'),open])).page,0);
 assert.equal(returned.incomplete,false);
});

test('native music preview supplies scrolling controls, respects custom replacements, and avoids authored ID collisions', () => {
 const { project,sample }=fixture(true),preview=sample([open]),layer=preview.layers.at(-1)!;
 assert.equal(layer.nativeLayout?.kind,'music');assert.ok(layer.nativeLayout!.contentHeight>layer.nativeLayout!.height);
 const list=layer.components.find(r=>r.component.kind==='musicTrackList')!.component;
 const playing=sample([open,{kind:'music',componentId:list.id,action:'play',assetId:'track_0'}]);assert.equal(playing.music.playback?.assetId,'track_0');assert.equal(playing.incomplete,false);
 const collision={...list,kind:'text' as const};project.ui.components.push(collision);
 const unique=nativeMusicPreview(project,'ui:musicRoom',[collision])!;assert.ok(unique.components.every(c=>c.id!==list.id));project.ui.components.pop();
 project.ui.components.push({...list,id:'authored',height:.3});assert.equal(nativeMusicPreview(project,'ui:musicRoom',project.ui.components.filter(c=>c.page==='musicRoom'))!.bodyIds.length,0);
 project.ui.pages!.musicRoom={layout:'custom'};assert.equal(nativeMusicPreview(project,'ui:musicRoom',[]),undefined);
});

test('switching a blueprint-opened music menu stops playback even when the menu continuation retains its instance', () => {
 const {project,sample}=fixture();const graph=createBlueprintGraph('ui','打开音乐菜单'),node=blueprintNodeDefaults('uiAction');node.properties={screen:'music_room'};graph.nodes.push(node);connectBlueprintPins(graph,graph.nodes[0].id,'exec',node.id,'exec_in');project.blueprints.push(graph);
 Object.assign(project.ui.components.find(c=>c.id==='open_music')!,{action:'blueprint',blueprintId:graph.id});
 project.ui.components.push({id:'music_settings',kind:'button',page:'musicRoom',text:'设置',action:'preferences',x:0,y:0,width:.1,height:.1});
 const events=[open,play('track_12')],before=sample(events),after=sample([...events,click('music_settings')]);
 assert.equal(before.layers.at(-1)?.mode,'menu');assert.equal(before.music.playback?.assetId,'track_12');
 assert.equal(after.layers.at(-1)?.instance,before.layers.at(-1)?.instance);assert.equal(after.pageId,'ui:preferences');assert.equal(after.music.playback,undefined);
});

test('playlist discovery includes story music and explicit list entries but excludes unrelated audio and invalid resource types', () => {
 const {project}=fixture();project.assets.push({id:'voice_only',kind:'audio',category:'voice',name:'语音',path:'voice.wav'},{id:'image',kind:'image',name:'图片',path:'image.png'});
 project.ui.components.find(c=>c.id==='music_list')!.list!.assetIds!.push('image');
 assert.equal(musicRoomEntries(project).length,13);assert.ok(musicRoomEntries(project).every(a=>a.id.startsWith('track_')));
 project.nodes.find(n=>n.kind==='passage')!.lines[0].actions=[];
 assert.equal(musicRoomEntries(project).length,13);
});
