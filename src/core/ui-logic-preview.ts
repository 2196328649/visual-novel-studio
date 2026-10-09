import { projectGraphs, withProjectGraphs } from './project-resources';
import { resolveUiHierarchy, uiAncestors } from './ui-hierarchy';
import { historyPreviewEntries, historyPreviewView, historyPreviewAction, type HistoryPreviewSource, type HistoryPreviewAction } from './history-preview';
import { nativeHistoryPreview } from './ui-native-history-preview';
import { musicRoomEntries, musicCollectionView, musicPreviewAction, isMusicControl, type MusicPreviewState } from './music-preview';
import { nativeMusicPreview } from './ui-native-music-preview';
import { uiStagePlan, type UiStageEvent } from './ui-stage-preview';
import { actionTiming } from './performance-timing';
import { uiTextInput, uiTextCommitMethods, type UiTextCommitMethod } from './ui-control-events';
import { isUiButtonEvent, type UiButtonEvent } from './ui-button-events';
import { sampleUiAnimationTrack, uiAnimationClipProblems, validUiAnimationPlayback, uiAnimationPlaybackDuration, uiAnimationPlaybackTime, type UiAnimationPlayback } from './ui-animation-clips';
import type { UiAnimationTrack } from './model';
import { isUiAnimationProperty, validUiAnimation, uiAnimationValue, type UiAnimationEasing } from './ui-animation';
import { voiceCollectionAction, voiceCollectionView, voiceCollectionEntries, type VoiceCollectionView, type VoicePreviewState, type VoicePreviewAction } from './voice-preview';
import { storyVoiceEntries, storyVoiceLogEntries } from './story-menu';
import { playerPreferences, validPlayerPreference, type PlayerPreference } from './preferences';
import { settingsParameters, validParameterSetting } from './parameter-sets';
import { nativeParameterSettingsPage, nativePreferencePreview, type NativePreferenceLayout } from './ui-native-preview';
import { blueprintKeyNames } from './blueprint';
import { effectiveUiTheme, effectiveUiComponents, sortUiComponents, declaredUiComponents, type Project, type UiComponent, type VariableValue } from './model';
import { previewActionContext, previewActionRunner } from './preview-actions';
import { matches } from './preview-route';
import { uiProperties, uiPropertyApplies, type UiProperty } from './ui';
import { uiEventInActiveInstance, uiGraphOnPage } from './ui-logic';
import { galleryPreviewAction, type GalleryPreviewAction, type GalleryPreviewState } from './gallery-preview';

export const uiPreviewDurationLimit=60;
export const uiPreviewTimerLimit=4096;
export type UiPreviewEvent=({kind:'history';componentId:string}&HistoryPreviewAction)|({kind:'historyData'}&HistoryPreviewSource)|{kind:'music';componentId:string;action:'page';page:number}|{kind:'music';componentId:string;action:'play';assetId:string}|{kind:'musicData';ids?:string[]}|{kind:'musicEnded';requestId:number;failed?:boolean}|{kind:'musicStop'}|{kind:'textCommit';componentId:string;method:UiTextCommitMethod}|{kind:'button';componentId:string;trigger:UiButtonEvent|'cancel';inside?:boolean}|{kind:'voice';componentId:string}&VoicePreviewAction|{kind:'voiceData';data:'favorites'|'unlocks';ids?:string[]}|{kind:'voiceEnded';requestId:number}|{kind:'confirm';requestId:number;value:boolean}|{kind:'cancelPage';pageId:string}|{kind:'control';componentId:string;value:VariableValue}|{kind:'advance';seconds:number}|{kind:'key';key:string}|{kind:'click';componentId:string}|{kind:'parameter';id:string;value:VariableValue}|({kind:'gallery';componentId:string}&GalleryPreviewAction);

const menuPages:Partial<Record<NonNullable<UiComponent['action']>,UiComponent['page']>>={
 preferences:'preferences',voiceSettings:'voiceSettings',save:'save',load:'save',pause:'pause',
 history:'history',gallery:'gallery',music:'musicRoom',voiceCollection:'voiceCollection',
 chapterSelect:'chapterSelect',flowchart:'flowchart',staff:'staff',
};

export function uiPreviewShortcutKey(shortcut:string|undefined):string|undefined {
 if(!shortcut)return;
 if(Object.hasOwn(blueprintKeyNames,shortcut))return shortcut;
 if(/^[a-z0-9]$/.test(shortcut))return uiPreviewKeyboardKey(shortcut);
}
export function uiPreviewKeys(project:Project,pageId:string,components?:UiComponent[]):string[] {
 const pageComponents=components??(pageId.startsWith('ui:')?effectiveUiComponents(project.ui).filter(c=>c.page===pageId.slice(3)):project.ui.customPages.find(p=>p.id===pageId)?.components??[]);
 return [...new Set([...projectGraphs(project).flatMap(graph=>graph.nodes.filter(node=>node.type==='eventKey'&&uiGraphOnPage(project,graph,pageId)&&node.properties.pageId===pageId&&uiEventInActiveInstance(project,node)).map(node=>String(node.properties.key??'K_SPACE'))),...pageComponents.filter(c=>c.kind==='button').map(c=>uiPreviewShortcutKey(c.shortcut)).filter((key):key is string=>!!key)])].filter(key=>Object.hasOwn(blueprintKeyNames,key));
}
export function uiPreviewKeyboardKey(key:string):string|undefined {
 const names:Record<string,string>={' ':'K_SPACE',Enter:'K_RETURN',Escape:'K_ESCAPE',ArrowUp:'K_UP',ArrowDown:'K_DOWN',ArrowLeft:'K_LEFT',ArrowRight:'K_RIGHT'};
 const value=names[key]??'K_'+key.toLowerCase();return Object.hasOwn(blueprintKeyNames,value)?value:undefined;
}

interface PreviewTimer { graphId: string; nodeId: string; interval: number; start: number; next: number; count: number; repeat: boolean }
interface PreviewPage {
 id: string; components: UiComponent[]; modal: boolean; mode: 'root' | 'waiting' | 'shown' | 'confirm' | 'menu'; instance: number; message?: string; nativeConfirm?: boolean; saveMode?: 'save' | 'load'; pausedAt?: number;
 musicPages: Record<string,number>; voice: Record<string,VoiceCollectionView>; timers: PreviewTimer[]; gallery: GalleryPreviewState; resume?: (result: string | boolean) => void;
 nativeLayout?: NativePreferenceLayout;
}

/** Replay local authoring input, retaining interpreter continuations across custom pages. */
export function previewUiLogic(project: Project, initialComponents: UiComponent[], initialPageId: string, values: Record<string, VariableValue> = {}, events: UiPreviewEvent[] = [], options: { timed?: boolean; galleryUnlocks?: readonly string[]; voiceUnlocks?: readonly string[]; voiceFavorites?: readonly string[] } = {}) {
 type Runner=ReturnType<typeof previewActionRunner>&{label:string;done:()=>void;deferred?:(()=>void)[]};
 let activeRunner:Runner|undefined;
 const animations=new Map<string,{id:string;property:string;from:number;to:number;start:number;duration:number;easing:UiAnimationEasing;track?:UiAnimationTrack;clip?:string;playback?:UiAnimationPlayback;done?:()=>void}>();
 const buttonStates=new Map<string,{page:PreviewPage;hover:boolean;held:boolean}>();
 const animationKey=(id:string,property:string)=>JSON.stringify([id,property]);
 const stageEvents:UiStageEvent[]=[];
 const stageWaits=new Map<Runner,number>();
 const context = previewActionContext(project), overrides = new Map<string, Record<string, VariableValue>>();
 context.yieldStageActions=true;
 for (const variable of project.variables) if (typeof values[variable.id] === variable.type) context.variables[variable.id] = values[variable.id];
 const preferenceDefaults = { ...Object.fromEntries(Object.entries(playerPreferences).map(([key,info])=>[key,info.initial])), ...project.playerDefaults };
 context.preferences = { ...preferenceDefaults }; context.characterVolumes = {};
 let muted = false, transitions = true;
 const returnPageId = ['ui:say', 'ui:choice'].includes(initialPageId) ? initialPageId : 'ui:main';
 const theme = effectiveUiTheme(project.ui); let serial = 0;
 let elapsed = 0, fired = 0, exhausted = false, invocations = 0, runDepth = 0, flushing = false;
 let voice:VoicePreviewState={favorites:[...(options.voiceFavorites??[])],serial:0}, voiceUnlocks=options.voiceUnlocks;
 const voiceEntries=storyVoiceEntries(project);
 let historySource:HistoryPreviewSource={}, voiceOwner:{instance:number;pageId:string}|undefined;
 const musicEntries=musicRoomEntries(project);
 let music:MusicPreviewState={serial:0,loop:true,shuffle:false}, musicUnlocks:string[]|undefined, musicOwner:{instance:number;pageId:string}|undefined;
 const unlockedMusic=()=>musicEntries.filter(a=>!musicUnlocks||musicUnlocks.includes(a.id)).map(a=>a.id);
 const resumes: (() => void)[] = [];
 const running = new Set<string>();
 const all = [...new Map([...declaredUiComponents(project), ...initialComponents].map(component => [component.id, component])).values()], nativeIds = new Set<string>();
 const makePage = (id: string, components: UiComponent[], mode: PreviewPage['mode']): PreviewPage => {
  const nativeLayout = nativePreferencePreview(project,id,components,initialPageId==='ui:preferences'?initialComponents:undefined) ?? nativeMusicPreview(project,id,components) ?? nativeHistoryPreview(project,id,components);
  for(const component of nativeLayout?.components??[]){nativeIds.add(component.id);if(!all.some(c=>c.id===component.id))all.push(component);}
  return { id, instance: ++serial, components: sortUiComponents([...(nativeLayout?.components??[]),...components]), nativeLayout, mode, modal: project.ui.customPages.find(p => p.id === id)?.modal ?? true, musicPages: {}, voice: {}, timers: [], gallery: { pages: {} } };
 };
 let root = makePage(initialPageId, initialComponents, 'root');
 root.saveMode = initialPageId === 'ui:save' ? 'load' : undefined;
 let rootOpen = true;
 const openPages: PreviewPage[] = [];
 const layers = () => {
  const menu = [...openPages].reverse().find(p => p.mode === 'menu');
  const pages = menu ? openPages.slice(openPages.indexOf(menu) + 1) : openPages;
  return [ ...(menu ? [menu] : rootOpen ? [root] : []), ...pages.filter(p => p.mode === 'waiting'), ...pages.filter(p => p.mode === 'shown').sort((a,b) => project.ui.customPages.findIndex(p=>p.id===a.id)-project.ui.customPages.findIndex(p=>p.id===b.id)), ...pages.filter(p=>p.mode==='confirm') ];
 };
 const syncTimers = () => {
  const displayed = layers();
  const owner=musicOwner;
  if(owner&&!displayed.some(page=>page.instance===owner.instance&&page.id===owner.pageId)){music={...music,playback:undefined};musicOwner=undefined;}
  const voicePage=voiceOwner;
  if(voicePage&&!displayed.some(page=>page.instance===voicePage.instance&&page.id===voicePage.pageId)){voice={...voice,playback:undefined};voiceOwner=undefined;}
  for (const page of [root, ...openPages]) {
   if (!displayed.includes(page)) { page.pausedAt ??= elapsed; }
   else if (page.pausedAt !== undefined) { const delta = elapsed - page.pausedAt; for (const timer of page.timers) { timer.start += delta; timer.next += delta; } delete page.pausedAt; }
  }
 };
 const pageIsOpen = (page: PreviewPage) => rootOpen && page === root || openPages.includes(page);
 const detailPage = () => layers().some(page=>page.mode==='confirm') ? undefined : layers().reverse().find(page => !!page.gallery.detail);
 const active = () => detailPage() ?? layers().at(-1);
 const interactivePages = () => {
  const pages = layers();
  const reverseBoundary = [...pages].reverse().findIndex(page => page.modal);
  const boundary = reverseBoundary < 0 ? 0 : pages.length - reverseBoundary - 1;
  return pages.slice(Math.max(0, boundary));
 };
 const componentMusicDisabled=(c:UiComponent)=>isMusicControl(c.action)&&((c.action==='musicPlayPause'&&!music.playback)||(['musicPrevious','musicNext'].includes(c.action)&&!unlockedMusic().length));
 const get = (id: string, property: string): VariableValue | undefined => {
  const c = all.find(c => c.id === id); if (!c || !Object.hasOwn(uiProperties, property) || !uiPropertyApplies(c, property as UiProperty)) return;
  const animation=animations.get(animationKey(id,property));
  if(animation?.track)return sampleUiAnimationTrack(animation.track,animation.playback?uiAnimationPlaybackTime(animation.playback,elapsed-animation.start):elapsed-animation.start,animation.from);
  if(animation)return uiAnimationValue(animation.from,animation.to,(elapsed-animation.start)/animation.duration,animation.easing);
  const override = overrides.get(id); if (override && Object.hasOwn(override, property)) return override[property];
  if (property === 'visible') return !c.visibleWhen || matches(c.visibleWhen, context.variables);
  if (property === 'enabled' && componentMusicDisabled(c)) return false;
  if (property === 'enabled') return !c.disabled && (!c.enabledWhen || matches(c.enabledWhen, context.variables)) && !(c.action==='setPlayerPreference'&&c.preference==='windowSize'&&context.preferences?.fullscreen) && !(nativeIds.has(c.id)&&returnPageId==='ui:main'&&(c.action==='save'||c.action==='history'));
  if (property === 'selected') {
   if(c.selectedWhen)return matches(c.selectedWhen,context.variables);
   if(c.action==='window'||c.action==='fullscreen')return !!context.preferences?.fullscreen===(c.action==='fullscreen');
   if(c.action==='skipSeen'||c.action==='skipAll')return !!context.preferences?.skipAll===(c.action==='skipAll');
   if(c.action==='musicPlayPause')return music.playback?.paused??false;
   if(c.action==='musicLoop')return music.loop;
   if(c.action==='musicShuffle')return music.shuffle;
   if(c.action==='mute')return muted;
   if(c.action==='transitions')return transitions;
   if(c.action==='setPlayerPreference'&&c.preference)return (c.preference==='characterVolume'?context.characterVolumes?.[c.preferenceCharacterId??'']??context.preferences?.characterVolume:context.preferences?.[c.preference])===c.preferenceValue;
   return false;
  }
  if (property === 'opacity') return c.style?.opacity ?? 1;
  return c[property as 'text' | 'x' | 'y' | 'width' | 'height' | 'value'] ?? uiProperties[property as UiProperty].initial;
 };
 const stopAnimation=(id:string,property:string,finish:boolean)=>{
  if(!all.some(c=>c.id===id)||property!=='all'&&!isUiAnimationProperty(property))return false;
  for(const [key,animation] of animations)if(animation.id===id&&(property==='all'||animation.property===property)){
   const value=finish?animation.to:get(id,animation.property)!;
   animations.delete(key);overrides.set(id,{...overrides.get(id),[animation.property]:value});
   if(animation.done){if(activeRunner)(activeRunner.deferred??=[]).push(animation.done);else resumes.push(animation.done);}
  }
  return true;
 };
 const stopPlayback=(id:string,finish:boolean)=>{
  if(!project.ui.animations?.some(a=>a.id===id))return false;
  for(const animation of [...animations.values()])if(animation.clip===id)stopAnimation(animation.id,animation.property,finish);
  return true;
 };
 context.ui = { get, stopAnimation, stopPlayback, set: (id, property, value) => {
  if (get(id, property) === undefined || typeof value !== uiProperties[property as UiProperty].type || typeof value === 'number' && (!Number.isFinite(value) || ['opacity', 'value'].includes(property) && (value < 0 || value > 1))) return false;
  if(isUiAnimationProperty(property))stopAnimation(id,property,false);
  overrides.set(id, { ...overrides.get(id), [property]: value! });
  if((property==='visible'||property==='enabled')&&value===false)buttonStates.delete(id);
  return true;
 }, reset: id => { if (!all.some(c => c.id === id)) return false; stopAnimation(id,'all',false);overrides.delete(id); return true; } };
 const ownVisible = (component: UiComponent, page?: PreviewPage) => get(component.id, 'visible') !== false && !(component.page === 'save' && component.saveMode && component.saveMode !== (page ?? active())?.saveMode);
 const visible = (component: UiComponent, page?: PreviewPage) => ownVisible(component, page) && uiAncestors((page ?? active())?.components ?? all, component.id).every(c => ownVisible(c, page));
 const ownEnabled = (component: UiComponent) => get(component.id, 'enabled') !== false;
 const enabled = (component: UiComponent) => ownEnabled(component) && uiAncestors(all, component.id).every(ownEnabled);
 const syncButtonStates=()=>{for(const [id,state] of buttonStates){const c=state.page.components.find(c=>c.id===id);if(!c||!pageIsOpen(state.page)||!interactivePages().includes(state.page)||detailPage()||!visible(c,state.page)||!enabled(c))buttonStates.delete(id);}};
 const setPreference = (key: PlayerPreference, value: VariableValue | undefined, character = '') => {
  if (value === undefined || !validPlayerPreference(key, value) || key === 'characterVolume' && character && !project.characters.some(c => c.id === character)) return false;
  if (key === 'characterVolume') context.characterVolumes![character] = Number(value); else context.preferences![key] = value;
  return true;
 };
 const flush = () => {
  if (flushing || runDepth) return;
  flushing = true;
  try { while (resumes.length && !exhausted) resumes.shift()!(); } finally { flushing = false; }
 };
 const finishPage = (page: PreviewPage, result: string | boolean) => {
  if(!pageIsOpen(page))return;
  if (page === root) rootOpen = false; else openPages.splice(openPages.indexOf(page), 1);
  syncButtonStates();
  page.gallery = { pages: {} }; page.timers = [];
  if (page.resume) resumes.push(() => page.resume!(result));
  syncTimers();
 };
 const close = (pageId: string, result: string) => { const page = layers().find(p=>p.id===pageId && p.mode!=='confirm'); if(page)finishPage(page,result); };
 const cancel = (page: PreviewPage) => { if(page.mode==='confirm')finishPage(page,false);else if(page.id===nativeParameterSettingsPage)navigate('ui:preferences');else if(page.mode==='menu'){if(page.id==='ui:voiceSettings')navigate('ui:preferences');else finishPage(page,'');}else if(!page.id.startsWith('ui:'))close(page.id,'取消');else if(page.nativeLayout)navigate(page.id==='ui:voiceSettings'?'ui:preferences':returnPageId); };
 const menuPageIds: Record<string,UiComponent['page']> = { pause_menu:'pause',save:'save',load:'save',preferences:'preferences',voice_settings:'voiceSettings',history:'history',gallery:'gallery',music_room:'musicRoom',voice_collection:'voiceCollection',chapter_select:'chapterSelect',flowchart:'flowchart',staff_roll:'staff' };
 const drive = (runner: Runner, result?: string | boolean) => {
  if (exhausted) return;
  let finished = false;
  const caller=activeRunner;activeRunner=runner;
  runDepth++;
  try {
   let step = runner.iterator.next(result);
   while (!step.done && !exhausted) {
    if (++invocations > uiPreviewTimerLimit) { exhausted = true; context.incomplete = true; runner.iterator.return(); finished = true; break; }
    const request = step.value;
    if(request.kind==='stage'){
     if(!options.timed){context.incomplete=true;runner.iterator.return();finished=true;break;}
     stageEvents.push({at:elapsed,action:request.action});
     const timing=actionTiming(request.action);
     if(timing.wait&&timing.duration>0){stageWaits.set(runner,elapsed+timing.duration);return;}
    }
    else if(request.kind==='playUiClip'){
     const clip=project.ui.animations?.find(a=>a.id===request.animationId);
     if(!clip||uiAnimationClipProblems(project,clip).length||typeof request.wait!=='boolean'||!validUiAnimationPlayback(request.playMode,request.loops,request.speed,request.fromCurrent)){
      context.incomplete=true;runner.iterator.return();finished=true;break;
     }
     const sources=clip.tracks.map(t=>get(t.componentId,t.property));
     if(sources.some(v=>typeof v!=='number')){context.incomplete=true;runner.iterator.return();finished=true;break;}
     const previous=clip.tracks.map(t=>animations.get(animationKey(t.componentId,t.property))),first=previous[0];
     const continuing=!!request.fromCurrent&&!!first?.playback&&previous.every(a=>a?.clip===clip.id&&a.playback===first.playback);
     const position=continuing?uiAnimationPlaybackTime(first!.playback!,elapsed-first!.start):undefined;
     const playback:UiAnimationPlayback={clipDuration:clip.duration,mode:request.playMode as UiAnimationPlayback['mode'],loops:Number(request.loops),speed:Number(request.speed),offset:position===undefined?0:request.playMode==='reverse'?clip.duration-position:position};
     const duration=uiAnimationPlaybackDuration(playback),endTime=playback.mode==='forward'?clip.duration:0;
     stopPlayback(clip.id,false);
     let remaining=clip.tracks.length;
     const done=()=>{if(--remaining===0)drive(runner);};
     for(const [index,track] of clip.tracks.entries()){
      stopAnimation(track.componentId,track.property,false);
      const from=continuing?previous[index]!.from:Number(sources[index]),to=sampleUiAnimationTrack(track,endTime,from);
      if(!options.timed||duration===0)context.ui!.set(track.componentId,track.property,Number.isFinite(duration)?to:sampleUiAnimationTrack(track,uiAnimationPlaybackTime(playback,0),from));
      else animations.set(animationKey(track.componentId,track.property),{id:track.componentId,property:track.property,from,to,start:elapsed,duration,easing:'linear',track,clip:clip.id,playback,...(request.wait?{done}: {})});
     }
     if(duration>0&&clip.tracks.length&&request.wait){
      if(options.timed)return;
      if(!Number.isFinite(duration)){context.incomplete=true;runner.iterator.return();finished=true;break;}
     }
    }
    else if(request.kind==='animateUi'){
     const source=get(request.componentId,request.property);
     if(typeof source!=='number'||!validUiAnimation(request.property,request.value,request.duration,request.easing)||typeof request.wait!=='boolean'){
      context.incomplete=true;runner.iterator.return();finished=true;break;
     }
     stopAnimation(request.componentId,request.property,false);
     const duration=Number(request.duration),target=Number(request.value);
     if(!options.timed||duration===0||source===target)context.ui!.set(request.componentId,request.property,target);
     else{
      animations.set(animationKey(request.componentId,request.property),{id:request.componentId,property:request.property,from:source,to:target,start:elapsed,duration,easing:request.easing as UiAnimationEasing,...(request.wait?{done:()=>drive(runner)}:{})});
      if(request.wait)return;
     }
    }
    else if (request.kind === 'closePage') close(request.pageId, request.result);
    else if (request.kind === 'confirm' || request.kind === 'menu') {
     const id = request.kind === 'confirm' ? 'messageBox' : menuPageIds[request.screen];
     const custom = id === 'messageBox' && theme.pages?.messageBox?.layout === 'custom';
     const page = makePage('ui:' + id, request.kind === 'confirm' && !custom ? [] : effectiveUiComponents(project.ui).filter(c=>c.page===id), request.kind);
     page.resume = value => drive(runner,value);
     if(request.kind==='confirm'){page.message=request.message;page.nativeConfirm=!custom;}
     else if(request.screen==='save'||request.screen==='load')page.saveMode=request.screen;
     openPages.push(page); syncButtonStates(); syncTimers(); if(!page.nativeConfirm)show(page); return;
    }
    else if (!layers().some(p => p.id === request.pageId)) {
     const definition = project.ui.customPages.find(p => p.id === request.pageId);
     if (!definition) { context.incomplete = true; runner.iterator.return(); finished = true; break; }
     const page = makePage(definition.id, definition.components, request.wait ? 'waiting' : 'shown');
     if (request.wait) page.resume = value => drive(runner, value);
     openPages.push(page); syncButtonStates(); syncTimers(); show(page);
     if (request.wait) return;
    }
    step = runner.iterator.next('');
   }
   finished = finished || !!step.done;
  } finally {
   activeRunner=caller;
   if (finished) { running.delete(runner.label); runner.done(); resumes.push(...runner.deferred??[]);runner.deferred=[]; }

   runDepth--; flush();
  }
 };
 const run = (graphId: string, eventId?: string, done: () => void = () => {}, eventData?:Record<string,VariableValue>) => {
  const label = JSON.stringify([graphId, eventId]);
  if (running.has(label)) { done(); return; }
  if (++invocations > uiPreviewTimerLimit) { exhausted = true; context.incomplete = true; return; }
  const graph = projectGraphs(project).find(g => g.id === graphId); if (!graph) { context.incomplete = true; done(); return; }
  const event = eventId && graph.nodes.find(node => node.id === eventId);
  const sampled = event ? { ...graph, nodes: [{ ...event, type: 'event' as const }, ...graph.nodes.filter(node => node.id !== event.id)] } : graph;
  running.add(label);
  drive({ ...previewActionRunner(withProjectGraphs({ ...project }, projectGraphs(project).map(g => g.id === graphId ? sampled : g)), [{ kind: 'blueprint', blueprintId: graphId }], context,undefined,eventData&&eventId?{graphId,nodeId:eventId,...eventData}:undefined), label, done });
 };
 const sequence = (steps: ((next: () => void) => void)[]) => {
  let index = 0;
  const next = () => { if(exhausted || index >= steps.length)return; runDepth++; try { steps[index++](next); } finally { runDepth--; flush(); } };
  next();
 };
 const checkComponents = (components: UiComponent[]) => {
  if (components.some(c => !['text', 'button', 'image', 'panel', 'progress', 'spine', 'video', 'galleryGrid', 'voiceCollection', 'musicTrackList', 'historyList'].includes(c.kind) && !(['preference', 'preferenceChoice'].includes(c.kind) && (project.variables.some(v => v.id === c.parameterId) || (!c.parameterId && c.preference && (c.preference !== 'characterVolume' || !c.preferenceCharacterId || project.characters.some(char => char.id === c.preferenceCharacterId))))))) context.incomplete = true;
  if (components.some(c => c.kind === 'button' && c.shortcut && !uiPreviewShortcutKey(c.shortcut))) context.incomplete = true;
 };
 const show = (page: PreviewPage) => {
  checkComponents(page.components);
  if(page.id===nativeParameterSettingsPage)return;
  page.timers = projectGraphs(project).flatMap(graph => graph.nodes.filter(node => node.type === 'eventTimer' && uiGraphOnPage(project,graph,page.id) && node.properties.pageId === page.id && uiEventInActiveInstance(project, node)).flatMap(node => {
   const interval = node.properties.interval ?? 1;
   if (typeof interval !== 'number' || !Number.isFinite(interval) || interval <= 0) { context.incomplete = true; return []; }
   return [{ graphId: graph.id, nodeId: node.id, interval, start: elapsed, next: elapsed + interval, count: 1, repeat: node.properties.repeat !== false }];
  }));
  const ids = new Set([...projectGraphs(project).filter(g=>g.uiPageId===page.id&&g.nodes.some(n=>n.type==='event')&&uiGraphOnPage(project,g,page.id)).map(g=>g.id), project.ui.customPages.find(p => p.id === page.id)?.onShowBlueprintId, ...(page.id.startsWith('ui:') ? [project.ui.instances?.find(i => i.id === project.ui.activeInstanceId)?.blueprintId] : []), ...page.components.map(c => c.events?.onShow)]);
  sequence([...ids].filter((id):id is string=>!!id).map(id=>next=>{if(pageIsOpen(page))run(id,undefined,next);else next();}));
 };
 const normalizeVoices=()=>{for(const page of [root,...openPages])for(const component of page.components.filter(c=>c.kind==='voiceCollection')){const view=voiceCollectionView(project,component,voice,page.voice[component.id],voiceUnlocks);page.voice[component.id]={page:view.page,favoritesOnly:view.favoritesOnly};}};
 const update = () => {
  normalizeVoices();syncButtonStates();
  if (options.timed) return;
  for (const page of layers()) for (const timer of page.timers) if (pageIsOpen(page) && !exhausted) run(timer.graphId, timer.nodeId);
 };
 const navigate = (target: string, mode?: 'save' | 'load') => {
  const menu = [...openPages].reverse().find(p=>p.mode==='menu'), current = menu ?? root;
  if(target===current.id&&mode===current.saveMode&&(menu||rootOpen))return;
  const next = makePage(target,target===initialPageId?initialComponents:effectiveUiComponents(project.ui).filter(c=>'ui:'+c.page===target),menu?'menu':'root');
  next.saveMode=mode;
  if(menu){next.instance=menu.instance;next.resume=menu.resume;openPages.splice(openPages.indexOf(menu),1,next);}else{root=next;rootOpen=true;}
  syncTimers();show(next);
 };
 const advance = (seconds: number) => {
  if (!options.timed || !Number.isFinite(seconds) || seconds < 0) { context.incomplete = true; return; }
  const target = Math.min(uiPreviewDurationLimit, elapsed + seconds);
  while (!exhausted) {
   let next: PreviewTimer | undefined;
   for (const page of layers()) for (const timer of page.timers) if (timer.next <= target + 1e-9 && (!next || timer.next < next.next - 1e-9)) next = timer;
   const end=Math.min(...[...animations.values()].map(a=>a.start+a.duration));
   const stageEnd=Math.min(...stageWaits.values());
   const at=Math.min(next?.next??Infinity,end,stageEnd);
   if(at>target+1e-9)break;
   if (fired >= uiPreviewTimerLimit) { exhausted = true; context.incomplete = true; return; }
   elapsed=at;fired++;
   for(const [runner,until] of [...stageWaits])if(until<=elapsed+1e-9){stageWaits.delete(runner);drive(runner);}
   for(const animation of [...animations.values()])if(animation.start+animation.duration<=elapsed+1e-9)stopAnimation(animation.id,animation.property,true);
   flush();
   // Completion may close a page or install a new animation before its timer.
   if(next&&next.next<=elapsed+1e-9&&layers().some(p=>p.timers.includes(next!))){
    next.next=next.repeat?next.start+(++next.count)*next.interval:Infinity;
    run(next.graphId,next.nodeId);
   }
  }
  elapsed = target; if (target >= uiPreviewDurationLimit) exhausted = true;
 };
 const locate = (componentId: string) => {
  for (const page of [...interactivePages()].reverse()) { const component = page.components.find(c => c.id === componentId); if (component) return { page, component }; }
 };
 const click = (page: PreviewPage, component: UiComponent) => {
  if (!pageIsOpen(page)||!interactivePages().includes(page)||detailPage()||component.kind !== 'button' || !visible(component, page) || get(component.id, 'enabled') === false) return;
  const steps: ((next: () => void) => void)[] = [];
  for(const graph of projectGraphs(project))for(const node of graph.nodes)if(node.type==='eventClick'&&node.properties.componentId===component.id&&uiGraphOnPage(project,graph,page.id)&&uiEventInActiveInstance(project,node))steps.push(next=>run(graph.id,node.id,next));
  if(component.events?.onClick)steps.push(next=>run(component.events!.onClick!,undefined,next));
  if(component.action==='blueprint'&&component.blueprintId)steps.push(next=>run(component.blueprintId!,undefined,next));
  else steps.push(next=>{
   if (component.id === page.nativeLayout?.moreSettingsId) navigate(nativeParameterSettingsPage);
   else if (component.action === 'setPlayerPreference' && component.preference && setPreference(component.preference, component.preferenceValue, component.preferenceCharacterId)) {}
   else if(component.action==='window'||component.action==='fullscreen')setPreference('fullscreen',component.action==='fullscreen');
   else if(component.action==='skipSeen'||component.action==='skipAll')setPreference('skipAll',component.action==='skipAll');
   else if(isMusicControl(component.action)){music=musicPreviewAction(music,unlockedMusic(),component.action);if(music.playback&&musicOwner===undefined)musicOwner={instance:page.instance,pageId:page.id};}
   else if(component.action==='mute')muted=!muted;
   else if(component.action==='transitions')transitions=!transitions;
   else if(component.action==='resetPreferences'){
    const custom=theme.pages?.messageBox?.layout==='custom';
    const confirmation=makePage('ui:messageBox',custom?effectiveUiComponents(project.ui).filter(c=>c.page==='messageBox'):[],'confirm');
    confirmation.message='恢复全部初始设置吗？';confirmation.nativeConfirm=!custom;
    confirmation.resume=value=>{if(value===true){context.preferences={...preferenceDefaults};context.characterVolumes={};muted=false;for(const variable of settingsParameters(project))context.variables[variable.id]=variable.initial;}next();};
    openPages.push(confirmation);syncButtonStates();syncTimers();if(custom)show(confirmation);return;
   }
   else if(component.action==='mainMenu'){
    openPages.length=0;stageWaits.clear();animations.clear();resumes.length=0;
    root=makePage('ui:main',initialPageId==='ui:main'?initialComponents:effectiveUiComponents(project.ui).filter(c=>c.page==='main'),'root');rootOpen=true;syncTimers();show(root);
   }
   else if (component.action && menuPages[component.action]) navigate('ui:' + menuPages[component.action], component.action === 'save' || component.action === 'load' ? component.action : undefined);
   else if (page.mode==='confirm' && (component.action==='confirmYes'||component.action==='confirmNo')) finishPage(page, component.action==='confirmYes');
   else if (component.action === 'return') { if(page.id===nativeParameterSettingsPage)navigate('ui:preferences');else if (page.mode==='menu' && component.page!=='voiceSettings')finishPage(page,''); else if (!page.id.startsWith('ui:')) close(page.id, ''); else navigate(component.page === 'voiceSettings' ? 'ui:preferences' : returnPageId); }
   else if (component.action) context.incomplete = true;
   next();
  });
  sequence(steps);
 };
 const buttonEvent=(page:PreviewPage,c:UiComponent,trigger:UiButtonEvent,done:()=>void=()=>{})=>{
  if(detailPage()||c.kind!=='button'||!pageIsOpen(page)||!interactivePages().includes(page)||!visible(c,page)||!enabled(c)){done();return;}
  const handlers=projectGraphs(project).flatMap(g=>uiGraphOnPage(project,g,page.id)?g.nodes.filter(n=>n.type==='eventButton'&&n.properties.componentId===c.id&&n.properties.trigger===trigger&&uiEventInActiveInstance(project,n)).map(n=>({g,n})):[]);
  sequence([...handlers.map(({g,n})=>(next:()=>void)=>run(g.id,n.id,next)),()=>done()]);
 };
 const activate=(page:PreviewPage,c:UiComponent)=>{
  const state={page,hover:false,held:true};buttonStates.set(c.id,state);
  buttonEvent(page,c,'press',()=>{syncButtonStates();if(buttonStates.get(c.id)!==state)return;state.held=false;
   buttonEvent(page,c,'release',()=>{syncButtonStates();if(buttonStates.get(c.id)===state)click(page,c);});
  });
 };
 const pointer=(page:PreviewPage,c:UiComponent,trigger:UiButtonEvent|'cancel',inside?:boolean)=>{
  if(c.kind!=='button')return;
  const state=buttonStates.get(c.id)??{page,hover:false,held:false};buttonStates.set(c.id,state);
  if(trigger==='cancel'){buttonStates.delete(c.id);return;}
  if(trigger==='hover'||trigger==='unhover'){
   const hover=trigger==='hover';if(state.hover===hover)return;state.hover=hover;buttonEvent(page,c,trigger);
  }else if(trigger==='press'){
   if(state.held)return;state.held=true;state.hover=true;buttonEvent(page,c,'press');
  }else if(trigger==='release'){
   if(!state.held)return;state.held=false;if(inside!==undefined)state.hover=inside;
   buttonEvent(page,c,'release',()=>{syncButtonStates();if(buttonStates.get(c.id)===state&&state.hover)click(page,c);});
  }
 };
 show(root); update();
 if (events.length > 256) context.incomplete = true;
 for (const event of events.slice(0, 256)) {
  if (exhausted) break;
  if(event.kind==='historyData'){if(event.nodeId&&!project.nodes.some(n=>n.kind==='passage'&&n.id===event.nodeId))continue;historySource={nodeId:event.nodeId,empty:event.empty};voice={...voice,playback:undefined};continue;}
  if(event.kind==='musicStop'){music={...music,playback:undefined};continue;}
  if(event.kind==='musicEnded'){if(music.playback?.requestId===event.requestId)music=event.failed?{...music,playback:undefined}:musicPreviewAction(music,unlockedMusic(),'ended');continue;}
  if(event.kind==='musicData'){musicUnlocks=event.ids?.filter(id=>musicEntries.some(a=>a.id===id));music={...music,playback:undefined,order:undefined};continue;}
  if(event.kind==='voiceEnded'){if(voice.playback?.requestId===event.requestId)voice={...voice,playback:undefined};continue;}
  if(event.kind==='voiceData'){
   const candidates=[...voiceCollectionEntries(project,voice),...storyVoiceLogEntries(project)];
   const ids=event.ids?.filter(id=>(event.data==='favorites'?candidates:voiceEntries).some(entry=>entry.id===id));
   if(event.data==='favorites'){
    const favorites=[...new Set(ids??voiceEntries.map(entry=>entry.id))],logs={...voice.logs};
    for(const entry of candidates)if(entry.id!==entry.assetId&&favorites.includes(entry.id)&&!logs[entry.id])logs[entry.id]={...entry};
    voice={...voice,favorites,logs};
   }else voiceUnlocks=ids;
   voice={...voice,playback:undefined};normalizeVoices();continue;
  }
  syncButtonStates();
  if (event.kind === 'advance') { advance(event.seconds); syncButtonStates();continue; }
  const detail = detailPage();
  if (detail && ['click', 'button', 'control', 'textCommit', 'key', 'gallery', 'cancelPage', 'confirm', 'voice', 'music', 'history'].includes(event.kind)) {
   const component = detail.components.find(c => c.id === detail.gallery.detail!.componentId);
   const keyActions: Record<string, 'close' | 'previous' | 'next'> = { K_ESCAPE: 'close', K_LEFT: 'previous', K_RIGHT: 'next' };
   const action = event.kind === 'key' && keyActions[event.key];
   if (component && event.kind === 'gallery' && event.componentId === component.id) detail.gallery = galleryPreviewAction(project, component, detail.gallery, event, options.galleryUnlocks, context.variables);
   else if (component && action) detail.gallery = galleryPreviewAction(project, component, detail.gallery, { action }, options.galleryUnlocks, context.variables);
   update(); continue;
  }
  if(event.kind==='confirm'){const page=active();if(page?.mode==='confirm'&&page.instance===event.requestId){finishPage(page,event.value);flush();}}
  else if (event.kind === 'cancelPage') { const page=active();if(page?.id===event.pageId){cancel(page);flush();} }
  else if (event.kind === 'parameter') {
   const variable = project.variables.find(v => v.id === event.id);
   if (!variable || typeof event.value !== variable.type || typeof event.value === 'number' && !Number.isFinite(event.value)) { context.incomplete = true; continue; }
   context.variables[event.id] = event.value;
  } else if (event.kind === 'key') {
   if (!Object.hasOwn(blueprintKeyNames, event.key)) { context.incomplete = true; continue; }
   for (const page of [...interactivePages()].reverse()) {
    const shortcut = [...page.components].reverse().find(c => c.kind === 'button' && uiPreviewShortcutKey(c.shortcut) === event.key && visible(c, page));
    if (shortcut) { click(page, shortcut); break; }
    const handlers = page.nativeConfirm ? [] : projectGraphs(project).flatMap(graph => graph.nodes.filter(n => n.type === 'eventKey' && uiGraphOnPage(project,graph,page.id) && n.properties.pageId === page.id && String(n.properties.key ?? 'K_SPACE') === event.key && uiEventInActiveInstance(project, n)).map(node => ({ graph, node })));
    if (handlers.length) { sequence(handlers.map(({graph,node})=>next=>run(graph.id,node.id,next))); break; }
    if (event.key === 'K_ESCAPE' && (page.mode==='confirm'||page.mode==='menu'||page.nativeLayout||!page.id.startsWith('ui:'))) { cancel(page); flush(); break; }
   }
  } else {
   const found = locate(event.componentId); if (!found || !visible(found.component,found.page) || !enabled(found.component)) continue;
   const { page, component } = found;
   if (event.kind === 'button') {if(event.trigger==='cancel'||isUiButtonEvent(event.trigger))pointer(page,component,event.trigger,event.inside);else context.incomplete=true;}
   else if (event.kind === 'click') activate(page, component);
   else if(event.kind==='music' && component.kind==='musicTrackList'){
    const view=musicCollectionView(project,component,page.musicPages[component.id],musicUnlocks,musicEntries);
    if(event.action==='page'){if(Number.isInteger(event.page)&&event.page>=0&&event.page<view.pages)page.musicPages[component.id]=event.page;}
    else if(view.entries.some(a=>a.id===event.assetId&&a.unlocked)){music=musicPreviewAction(music,unlockedMusic(),'play',event.assetId);musicOwner={instance:page.instance,pageId:page.id};}
   }
   else if(event.kind==='history'){
    const previous=voice.playback?.requestId;
    const line=historyPreviewEntries(project,historySource).find(l=>l.id===event.lineId);
    const gain=context.characterVolumes?.[line?.speakerId??'']??context.characterVolumes?.['']??Number(context.preferences?.characterVolume??1);
    voice=historyPreviewAction(project,component,voice,historySource,event,voiceUnlocks,gain);
    if(event.action==='play'&&voice.playback&&voice.playback.requestId!==previous)voiceOwner={instance:page.instance,pageId:page.id};
   }
   else if(event.kind==='voice'){
    const previous=voice.playback?.requestId;
    const entry='assetId' in event?voiceCollectionEntries(project,voice).find(entry=>entry.id===event.assetId):undefined;
    const gain=context.characterVolumes?.[entry?.speakerId??'']??context.characterVolumes?.['']??Number(context.preferences?.characterVolume??1);
    const result=voiceCollectionAction(project,component,voice,page.voice[component.id],event,voiceUnlocks,gain);
    if(result.confirmation){
     const custom=theme.pages?.messageBox?.layout==='custom';
     const confirmation=makePage('ui:messageBox',custom?effectiveUiComponents(project.ui).filter(c=>c.page==='messageBox'):[],'confirm');
     confirmation.message=result.confirmation.message;confirmation.nativeConfirm=!custom;
     confirmation.resume=value=>{
      if(value!==true||!pageIsOpen(page)||!layers().includes(page)||!visible(component,page)||!enabled(component))return;
      const accepted=voiceCollectionAction(project,component,voice,page.voice[component.id],event,voiceUnlocks,gain,{confirmed:true});
      voice=accepted.state;page.voice[component.id]=accepted.view;
     };
     openPages.push(confirmation);syncButtonStates();syncTimers();if(custom)show(confirmation);
    }else{voice=result.state;page.voice[component.id]=result.view;}
    if(event.action==='play'&&voice.playback&&voice.playback.requestId!==previous)voiceOwner={instance:page.instance,pageId:page.id};
   }
   else if (event.kind === 'gallery') page.gallery = galleryPreviewAction(project, component, page.gallery, event, options.galleryUnlocks, context.variables);
   else if(event.kind==='textCommit'){
    if(!uiTextInput(project,component)||!Object.hasOwn(uiTextCommitMethods,event.method)){context.incomplete=true;continue;}
    const value=context.variables[component.parameterId!];
    const handlers=projectGraphs(project).flatMap(g=>uiGraphOnPage(project,g,page.id)?g.nodes.filter(n=>n.type==='eventTextCommitted'&&n.properties.componentId===component.id&&uiEventInActiveInstance(project,n)).map(n=>({g,n})):[]);
    sequence(handlers.map(({g,n})=>next=>run(g.id,n.id,next,{value,method:event.method})));
   }
   else if (event.kind === 'control' && ['preference', 'preferenceChoice'].includes(component.kind)) {
    const variable = project.variables.find(v => v.id === component.parameterId);
    const previous=variable?context.variables[variable.id]:component.preference==='characterVolume'?context.characterVolumes?.[component.preferenceCharacterId??'']??context.preferences?.characterVolume:context.preferences?.[component.preference!];
    if (variable) { if (!validParameterSetting(variable, event.value)) { context.incomplete = true; continue; } context.variables[variable.id] = event.value; }
    else if (!component.parameterId && component.preference && setPreference(component.preference, event.value, component.preferenceCharacterId)) {}
    else {context.incomplete = true;continue;}
    if(previous!==event.value&&previous!==undefined){
     const handlers=projectGraphs(project).flatMap(g=>uiGraphOnPage(project,g,page.id)?g.nodes.filter(n=>n.type==='eventValueChanged'&&n.properties.componentId===component.id&&uiEventInActiveInstance(project,n)).map(n=>({g,n})):[]);
     sequence(handlers.map(({g,n})=>next=>run(g.id,n.id,next,{value:event.value,previous})));
    }
   }
  }
  update();
 }
 syncButtonStates();
 const componentSnapshot = (page: PreviewPage) => {
  const rows = page.components.map(component => {
  const c = structuredClone(component);
  for (const property of ['x', 'y', 'width', 'height', 'text', 'value'] as const) { const value = get(c.id, property); if (value !== undefined) (c as any)[property] = value; }
  c.style = { ...c.style, opacity: Number(get(c.id, 'opacity')) };
  return { component: c, visible: ownVisible(c,page), state: !ownEnabled(c) ? 'disabled' as const : buttonStates.get(c.id)?.held&&buttonStates.get(c.id)?.hover?'pressed' as const : get(c.id, 'selected') === true ? 'selected' as const : buttonStates.get(c.id)?.hover?'hover' as const : 'idle' as const };
 });
  const byId = new Map(rows.map(row => [row.component.id, row]));
  return resolveUiHierarchy(rows.map(row => row.component), { state: c => byId.get(c.id)!.state, visible: c => byId.get(c.id)!.visible, playerOpacity: Number(context.preferences?.dialogueOpacity ?? 1) });
 };
 const snapshot = (page: PreviewPage) => ({ pageId: page.id, instance: page.instance, hidden: !layers().includes(page), message: page.message, nativeConfirm: page.nativeConfirm, nativeLayout:page.nativeLayout, music: Object.fromEntries(page.components.filter(c=>c.kind==='musicTrackList').map(c=>[c.id,musicCollectionView(project,c,page.musicPages[c.id],musicUnlocks,musicEntries)])), voice: Object.fromEntries(page.components.filter(c=>c.kind==='voiceCollection').map(c=>[c.id,voiceCollectionView(project,c,voice,page.voice[c.id],voiceUnlocks)])), mode: page.mode, modal: page.modal, gallery: page.gallery, interactive: !detailPage() && interactivePages().includes(page), components: componentSnapshot(page) });
 const current = active(), visibleLayers = layers(), rendered = [...[root,...openPages].filter(p=>pageIsOpen(p)&&!visibleLayers.includes(p)),...visibleLayers].map(snapshot), top = current ? snapshot(current) : undefined;
 const keys = detailPage() ? ['K_ESCAPE', 'K_LEFT', 'K_RIGHT'] : [...new Set(interactivePages().flatMap(p => [...(p.nativeConfirm?[]:uiPreviewKeys(project, p.id, p.components.filter(c=>visible(c,p)))), ...(!p.id.startsWith('ui:')||p.mode==='confirm'||p.mode==='menu'||p.nativeLayout ? ['K_ESCAPE'] : [])]))];
 return { stage:uiStagePlan(stageEvents,elapsed), stageWaiting:stageWaits.size, historySource, history:historyPreviewView(project,voice,historySource,voiceUnlocks), music, musicUnlocks, musicRoomOpen:visibleLayers.some(p=>p.id==='ui:musicRoom'), voice, voiceUnlocks, muted, transitions, pageId: current?.id ?? root.id, returnPageId, gallery: current?.gallery ?? { pages: {} } as GalleryPreviewState, saveMode: current?.saveMode, layers: rendered, keys, closed: !current, waitingPages: openPages.filter(p => ['waiting','confirm','menu'].includes(p.mode)).map(p => p.id), characterVolumes: context.characterVolumes, preferences: Object.fromEntries(Object.entries(playerPreferences).map(([key, info]) => [key, context.preferences?.[key as PlayerPreference] ?? info.initial])), elapsed, fired, exhausted, incomplete: context.incomplete, variables: context.variables, components: top?.components ?? [] };
}

