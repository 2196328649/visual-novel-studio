import { uiSpineRequest, uiSpineSkinProblem, uiSpineSpeedProblem, playUiSpine, pauseUiSpine, resetUiSpine, suspendUiSpine, acceptUiSpineReport, uiSpineObservation, uiSpineObservationProperties, type UiSpineRequest, type UiSpineReport } from './ui-spine';
import { uiVideoRequest, controlUiVideo, suspendUiVideo, acceptUiVideoReport, uiVideoObservation, type UiVideoRequest, type UiVideoReport } from './ui-video';
import { resolveUiLayout, uiLayoutPropertyFields, uiLayoutObservation, isUiLayoutObservation, uiLayoutProblem, type UiLayoutGeometry } from './ui-layout';
import { uiImageAsset, uiImageRequest, acceptUiImageReport, type UiImageReport, type UiImageRequest } from './ui-image';
import { uiAssetBinding, uiBoundAssetId } from './ui-asset-binding';
import { editUiControlOptions, readUiControlOption, uiControlOptionMatches, uiControlOptionsKey, type UiControlOption } from './ui-control-options';
import { uiPageInputValues, uiPageInterface, uiPageOutputDefaults, validUiPageParameterValue, uiPageLifecyclePhases, type UiPageLifecyclePhase } from './ui-page-interface';
import { resolveUiPageOpening, type ResolvedUiPageOpening } from './ui-page-opening';
import { uiPageCompletion } from './ui-page-session';
import { uiPageLifecycleHandlers, uiPageShowGraphIds } from './ui-logic';
import type { PreviewTaskSubmission } from './blueprint-task-preview';
import { blueprintTaskActiveLimit, blueprintTaskResultLimit, blueprintTaskFinished, transitionBlueprintThrottle, validBlueprintTaskValue, type BlueprintTaskCompletion } from './blueprint-tasks';
import { blueprintFlowControlInitial, isBlueprintFlowControl, transitionBlueprintFlowControl } from './blueprint-flow-control';
import { BlueprintTraceRecorder, type BlueprintTraceData } from './blueprint-trace';
import { validBlueprintStateValue } from './blueprint-state';
import { uiPage, uiPageOpenProblem } from './ui-pages';
import { uiPageComponents } from './ui-logic';
import { uiShortcutKey } from './ui-shortcuts';
import { cloneData } from "./project-mutation";
import { uiPropertyDefaults, uiPropertyFallbacks, uiPropertyWritable, uiPropertyValueProblem, applyUiPropertySnapshot } from './ui-properties';
import { projectGraphs, withProjectGraphs } from './project-resources';
import { resolveUiHierarchy, uiAncestors, uiSubtreeIds, uiPaintOrder } from './ui-hierarchy';
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
import { playerPreferenceKeys, preferenceInfo, validPlayerPreference, type PlayerPreference } from './preferences';
import { parametersResetWithSettings } from './parameter-sets';
import { nativePreferencePreview, type NativePreferenceLayout } from './ui-native-preview';
import { nativeMainButtons } from './ui-native-main';
import { blueprintKeyNames } from './blueprint';
import { effectiveUiTheme, effectiveUiComponents, declaredUiComponents, variableValueType, type Project, type UiComponent, type UiButtonState, type VariableValue } from './model';
import { previewActionContext, previewActionRunner, type PreviewUiResult } from './preview-actions';
import type { UiPageCompletion, UiPageReason } from './ui-page-session';
import { matches } from './preview-route';
import { uiProperties, type UiProperty } from './ui';
import { uiControlDefinition, uiControlPrimaryProperty, uiControlRatio, uiControlAssignedValue, uiControlValueProblem, isUiControlValueProperty, uiControlWithRange, uiControlEffectiveValue, isUiControlRangeProperty, uiControlRangeFields, uiControlRangeProblem } from './ui-control-properties';
import { uiEventInActiveInstance, uiGraphOnPage, uiClickHandlers } from './ui-logic';
import { galleryPreviewAction, type GalleryPreviewAction, type GalleryPreviewState } from './gallery-preview';
import { uiActionPages, uiScreenPages } from './ui-page-catalog';
import { uiActionAvailable, uiScreenAvailable } from './ui-availability';
import { uiPropertyControlFor, uiPropertyControlSourceProblem } from './ui-property-control';
import { maxBlueprintUiPropertyRows, type BlueprintUiPropertyAssignment } from './blueprint-ui-property-batch';

export interface UiPreviewFocusCommand { sequence: number; componentId: string; pageId: string; pageInstance: number; focused: boolean; active?: { componentId: string; pageInstance: number } }

export interface UiPreviewClickFeedback { sequence: number; assetId: string; componentId: string; pageId: string; pageInstance: number }

export const uiPreviewDurationLimit=60;
export const uiPreviewTimerLimit=4096;
export type UiPreviewEvent=({kind:'spine';componentId:string}&UiSpineReport)|({kind:'video';componentId:string}&UiVideoReport)|{kind:'scroll';componentId:string;pageInstance:number;dx:number;dy:number}|({kind:'image';componentId:string}&UiImageReport)|({kind:'history';componentId:string}&HistoryPreviewAction)|({kind:'historyData'}&HistoryPreviewSource)|{kind:'music';componentId:string;action:'page';page:number}|{kind:'music';componentId:string;action:'play';assetId:string}|{kind:'musicData';ids?:string[]}|{kind:'musicEnded';requestId:number;failed?:boolean}|{kind:'musicStop'}|{kind:'textCommit';componentId:string;pageInstance?:number;method:UiTextCommitMethod}|{kind:'button';componentId:string;trigger:UiButtonEvent|'cancel';inside?:boolean}|{kind:'voice';componentId:string}&VoicePreviewAction|{kind:'voiceData';data:'favorites'|'unlocks';ids?:string[]}|{kind:'voiceEnded';requestId:number}|{kind:'confirm';requestId:number;value:boolean}|{kind:'cancelPage';pageId:string}|{kind:'focus';componentId:string;pageInstance?:number;focused:boolean}|{kind:'control';componentId:string;pageInstance?:number;value:VariableValue;optionsKey?:string;optionIndex?:number}|{kind:'advance';seconds:number}|{kind:'key';key:string}|{kind:'click';componentId:string}|{kind:'parameter';id:string;value:VariableValue}|({kind:'gallery';componentId:string}&GalleryPreviewAction);

export const uiPreviewImageReportLimit = 8192;
export const uiPreviewInputCount = (events: readonly UiPreviewEvent[]) => events.filter(event => event.kind !== 'image' && event.kind !== 'video' && event.kind !== 'spine').length;
/**
 * Timed preview replays its events against the current project. An edit only needs to restart
 * the timer when it changes what that replay shows now; imported files, folder moves and other
 * asset-library bookkeeping leave the result as it was.
 */
export function sameUiPreviewResult(before: ReturnType<typeof previewUiLogic>, after: ReturnType<typeof previewUiLogic>): boolean {
  const plain = (_key: string, value: unknown) => value instanceof Map ? [...value] : value instanceof Set ? [...value] : value;
  try { return JSON.stringify(before, plain) === JSON.stringify(after, plain); }
  catch { return false; }
}
/** Decoder feedback has its own bounded budget, not the 256 user-input slots. */
export function appendUiPreviewEvent(events: UiPreviewEvent[], event: UiPreviewEvent): UiPreviewEvent[] {
  const previous = events.at(-1);
  if (event.kind === 'scroll' && previous?.kind === 'scroll' && previous.componentId === event.componentId && previous.pageInstance === event.pageInstance && Math.sign(previous.dx) === Math.sign(event.dx) && Math.sign(previous.dy) === Math.sign(event.dy)) return [...events.slice(0, -1), { ...event, dx: previous.dx + event.dx, dy: previous.dy + event.dy }];
  if (event.kind === 'video' || event.kind === 'spine') {
    if (event.status === 'progress' && previous?.kind === event.kind && previous.status === 'progress' && previous.componentId === event.componentId && previous.pageInstance === event.pageInstance && previous.assetId === event.assetId && previous.sourceSequence === event.sourceSequence && previous.sequence === event.sequence && previous.sample < event.sample) return [...events.slice(0, -1), event];
    if (events.some(previous => previous.kind === event.kind && previous.componentId === event.componentId && previous.pageInstance === event.pageInstance && previous.assetId === event.assetId && previous.sourceSequence === event.sourceSequence && previous.sequence === event.sequence && previous.sample === event.sample)) return events;
    return events.length - uiPreviewInputCount(events) > uiPreviewImageReportLimit ? events : [...events, event];
  }
  if (event.kind !== 'image') return uiPreviewInputCount(events) >= 256 ? events : [...events, event];
  if (events.some(previous => previous.kind === 'image' && previous.componentId === event.componentId && previous.pageInstance === event.pageInstance && previous.sequence === event.sequence && previous.assetId === event.assetId)) return events;
  return events.length - uiPreviewInputCount(events) > uiPreviewImageReportLimit ? events : [...events, event];
}

export function uiPreviewShortcutKey(shortcut:string|undefined):string|undefined {
 return uiShortcutKey(shortcut);
}
export function uiPreviewKeys(project:Project,pageId:string,components?:UiComponent[]):string[] {
 const pageComponents=components??(pageId.startsWith('ui:')?effectiveUiComponents(project.ui).filter(c=>c.page===pageId.slice(3)):project.ui.customPages.find(p=>p.id===pageId)?.components??[]);
 return [...new Set([...projectGraphs(project).flatMap(graph=>graph.nodes.filter(node=>node.type==='eventKey'&&uiGraphOnPage(project,graph,pageId)&&node.properties.pageId===pageId&&uiEventInActiveInstance(project,node)).map(node=>String(node.properties.key??'K_SPACE'))),...pageComponents.filter(c=>c.kind==='button').map(c=>uiPreviewShortcutKey(c.shortcut)).filter((key):key is string=>!!key)])].filter(key=>Object.hasOwn(blueprintKeyNames,key));
}
export function uiPreviewKeyboardKey(key:string):string|undefined {
 return uiShortcutKey(key);
}

interface PreviewTimer { graphId: string; nodeId: string; interval: number; start: number; next: number; count: number; repeat: boolean }
interface PreviewLifecycle { phase: UiPageLifecyclePhase; page: PreviewPage; completion?: UiPageCompletion; inputs: Record<string, VariableValue>; requestId?: number }
interface PreviewPage {
 inputs: Record<string, VariableValue>; outputs: Record<string, VariableValue>; interfaceProblem?: string;
 created: boolean; createdReady: boolean; focused: boolean; closing?: boolean; requestSerial: number; closeRequest?: { id: number; prevented: boolean };
 controls: Map<string, boolean>;
 cooldowns: Map<string, number>;
 variables: Record<string, VariableValue>;
 id: string; components: UiComponent[]; modal: boolean; mode: 'root' | 'waiting' | 'shown' | 'confirm' | 'menu'; instance: number; message?: string; nativeConfirm?: boolean; saveMode?: 'save' | 'load'; pausedAt?: number;
 /** The page this one was navigated from, used by Escape/right-click to step back. */
 enteredFrom?: string;
 musicPages: Record<string,number>; voice: Record<string,VoiceCollectionView>; timers: PreviewTimer[]; gallery: GalleryPreviewState; resume?: (result: PreviewUiResult) => void;
 parent?: PreviewPage;
 opening: ResolvedUiPageOpening; autoCloseAt?: number;
 nativeLayout?: NativePreferenceLayout;
}

interface UiPropertyBatchMediaPage {
 readonly components: readonly UiComponent[]; readonly instance: number; readonly displayed: boolean; readonly saveMode?: 'save' | 'load';
}
export interface UiPropertyBatchMediaSnapshot {
 read: (id: string, property: string) => VariableValue | undefined;
 geometry: ReadonlyMap<string, UiLayoutGeometry>;
 shown: (component: UiComponent, page: UiPropertyBatchMediaPage) => boolean;
 imageState: (component: UiComponent) => UiButtonState;
}
const batchMediaProperties = Object.fromEntries(['image', 'video', 'spine'].map(kind => [kind,
 (Object.keys(uiProperties) as UiProperty[]).filter(property => property.startsWith(kind) && uiProperties[property].writable),
])) as Record<'image' | 'video' | 'spine', UiProperty[]>;
const batchMediaGeometryFields = ['width', 'height', 'matrix', 'renderMatrix', 'localRenderMatrix', 'clipPolygons', 'visiblePolygon', 'clippedOut', 'visible'] as const;
/** Only requests whose effective settings or presentation are affected by this
 * batch are inspected. An unrelated stale, invalid or pending record must not
 * veto an ordinary property write or be adopted by its commit. */
export function prepareUiPropertyBatchMedia(project: Project, pages: readonly UiPropertyBatchMediaPage[], target: { id: string; values: Readonly<Record<string, VariableValue>> },
 before: UiPropertyBatchMediaSnapshot, after: UiPropertyBatchMediaSnapshot,
 requests: { images: ReadonlyMap<string, UiImageRequest>; videos: ReadonlyMap<string, UiVideoRequest>; spines: ReadonlyMap<string, UiSpineRequest> }) {
 const images = new Map<string, UiImageRequest>(), videos = new Map<string, UiVideoRequest>(), spines = new Map<string, UiSpineRequest>();
 for (const page of pages) for (const component of page.components) {
  const kind = component.kind; if (kind !== 'image' && kind !== 'video' && kind !== 'spine') continue;
  const id = component.id, previousGeometry = before.geometry.get(id), geometry = after.geometry.get(id);
  const wasShown = before.shown(component, page), shown = after.shown(component, page);
  const suspended = !page.displayed || !shown || !!geometry?.clippedOut;
  const explicit = target.id === id && batchMediaProperties[kind].some(property => Object.hasOwn(target.values, property));
  const changed = batchMediaProperties[kind].some(property => !Object.is(before.read(id, property), after.read(id, property)))
   || wasShown !== shown || batchMediaGeometryFields.some(field => JSON.stringify(previousGeometry?.[field]) !== JSON.stringify(geometry?.[field]));
  if (kind === 'image') {
   const base = String(after.read(id, 'image') ?? ''), previousBase = String(before.read(id, 'image') ?? '');
   const asset = uiImageAsset({ ...component, assetId: base }, after.imageState(component));
   const previousAsset = uiImageAsset({ ...component, assetId: previousBase }, before.imageState(component));
   if (explicit || changed || asset !== previousAsset) images.set(id, uiImageRequest(requests.images.get(id), asset, page.instance, base));
  } else if (explicit || changed) {
   if (kind === 'video') {
    const request = uiVideoRequest(requests.videos.get(id), String(after.read(id, 'video') ?? ''), after.read(id, 'videoLoop') !== false, page.instance);
    videos.set(id, suspendUiVideo(request, suspended));
   } else {
    const speed = after.read(id, 'spineSpeed'), problem = uiSpineSpeedProblem(speed); if (problem) throw new Error(problem);
    const asset = project.assets.find(item => item.id === after.read(id, 'spineAsset') && item.kind === 'spine');
    const settings = { ...component.spine, animation: asset?.id === component.assetId ? component.spine?.animation : undefined,
     skin: String(after.read(id, 'spineSkin') ?? ''), loop: after.read(id, 'spineLoop') !== false, speed: speed as number };
    const request = uiSpineRequest(requests.spines.get(id), asset, settings, page.instance);
    spines.set(id, suspendUiSpine(request, suspended));
   }
  }
 }
 return { images, videos, spines };
}

/** Replay local authoring input, retaining interpreter continuations across custom pages. */
export function previewUiLogic(project: Project, initialComponents: UiComponent[], initialPageId: string, values: Record<string, VariableValue> = {}, events: UiPreviewEvent[] = [], options: { host?: 'title' | 'story'; pageInputs?: Record<string, VariableValue>; trace?: boolean | { limit?: number }; timed?: boolean; galleryUnlocks?: readonly string[]; voiceUnlocks?: readonly string[]; voiceFavorites?: readonly string[] } = {}) {
 type Runner=ReturnType<typeof previewActionRunner>&{label:string;eventKey?:string;done:()=>void;deferred?:(()=>void)[];owner?:PreviewPage;cancelled?:boolean;traceWaiting?:boolean;taskHandle?:string;lifecycle?:PreviewLifecycle;onStopped?:()=>void};
 let activeRunner:Runner|undefined;
 type Animation = {id:string;property:string;from:number;to:number;start:number;duration:number;easing:UiAnimationEasing;track?:UiAnimationTrack;clip?:string;playback?:UiAnimationPlayback;done?:()=>void;owner?:PreviewPage;taskHandle?:string;parameterId?:string};
 const animations=new Map<string,Animation>();
 const buttonStates=new Map<string,{page:PreviewPage;hover:boolean;held:boolean}>();
 let inputFocus: { page: PreviewPage; componentId: string } | undefined;
 let pendingInputFocus: { page: PreviewPage; componentId: string; focused: boolean } | undefined;
 let inputFocusCommand: UiPreviewFocusCommand | undefined, inputFocusSequence = 0;
 const clickFeedback: UiPreviewClickFeedback[] = [];
 const animationKey=(id:string,property:string)=>JSON.stringify([id,property]);
 const stageEvents:UiStageEvent[]=[];
 const stageOwners=new Map<UiStageEvent,PreviewPage>();
 const stageWaits=new Map<Runner,number>();
 const context = previewActionContext(project), overrides = new Map<string, Record<string, VariableValue>>();
 const optionOverrides = new Map<string, UiControlOption[]>();
 const imageRequests = new Map<string, UiImageRequest>();
 const videoRequests = new Map<string, UiVideoRequest>();
 const spineRequests = new Map<string, UiSpineRequest>();
 const spineProblems = new Map<string, string>();
  context.yieldStageActions=true;
 for (const variable of project.variables) if (typeof values[variable.id] === variableValueType(variable)) context.variables[variable.id] = values[variable.id];
 const preferenceDefaults = Object.fromEntries(playerPreferenceKeys.map(key=>[key,preferenceInfo(project,key).initial]));
 context.preferences = { ...preferenceDefaults }; context.characterVolumes = {};
 let muted = false, transitions = true;
 let host = options.host ?? (['ui:say', 'ui:choice'].includes(initialPageId) ? 'story' : 'title');
 let returnPageId = host === 'story' ? ['ui:say', 'ui:choice'].includes(initialPageId) ? initialPageId : 'ui:say' : 'ui:main';
 const theme = effectiveUiTheme(project.ui); let serial = 0;
 let elapsed = 0, fired = 0, exhausted = false, invocations = 0, runDepth = 0, flushing = false;
 let stopReason: string | undefined;
 let trigger = '页面显示', triggerComponent: string | undefined;
 const trace = options.trace ? new BlueprintTraceRecorder({ limit: typeof options.trace === 'object' ? options.trace.limit : undefined, time: () => elapsed }) : undefined;
 context.trace = trace;
 context.time = () => elapsed;
 const incomplete = (reason: string, location: Partial<BlueprintTraceData> = {}) => {
  context.incomplete = true;
  const data: BlueprintTraceData = { kind: 'stop', reason, ...location };
  if (activeRunner) activeRunner.observe(data); else trace?.record([], data);
 };
 const exhaust = (reason: string, location: Partial<BlueprintTraceData> = {}) => {
  exhausted = true; stopReason ??= reason;
  incomplete(reason + ' 本次预演已停止，活动任务与等待仍未完成；这不是任务完成、失败或取消的结果。', location);
 };
 const stopRunner = (runner: Runner, reason: string) => { context.incomplete = true; runner.fail(reason); runner.cancel(reason); runner.iterator.return(); const stopped = runner.onStopped; runner.onStopped = undefined; stopped?.(); };
 let voice:VoicePreviewState={favorites:[...(options.voiceFavorites??[])],serial:0}, voiceUnlocks=options.voiceUnlocks;
 const voiceEntries=storyVoiceEntries(project);
 let historySource:HistoryPreviewSource={}, voiceOwner:{instance:number;pageId:string}|undefined;
 const musicEntries=musicRoomEntries(project);
 let music:MusicPreviewState={serial:0,loop:true,shuffle:false}, musicUnlocks:string[]|undefined, musicOwner:{instance:number;pageId:string}|undefined;
 const unlockedMusic=()=>musicEntries.filter(a=>!musicUnlocks||musicUnlocks.includes(a.id)).map(a=>a.id);
 const resumes: (() => void)[] = [];
 let syncPageFocus = () => {};
 const running = new Set<string>();
 const runners = new Set<Runner>();
 type TaskRecord = BlueprintTaskCompletion & { handle: string; serial: number; completedOrder?: number; submission?: PreviewTaskSubmission; due?: number; owner?: PreviewPage; runner?: Runner };
 const tasks = new Map<string, TaskRecord>(), taskWaits = new Map<Runner, { handle: string; graphId?: string }>(), taskReady = new Set<Runner>();
 let taskSerial = 0, taskFinishedSerial = 0, callSerial = 0, nextTaskPump = 0;
 const finishTask = (handle: string, status: 'completed' | 'cancelled' | 'failed', reason: string, outputs: Record<string, VariableValue> = {}) => {
  const task = tasks.get(handle); if (!task || blueprintTaskFinished(task.status)) return false;
  const runner = task.runner;
  tasks.set(handle, { handle, serial: task.serial, completedOrder: ++taskFinishedSerial, graphId: task.graphId, status, reason, outputs: status === 'completed' ? { ...outputs } : {} });
  if (runner) { taskReady.delete(runner); taskWaits.delete(runner); if (status !== 'completed') cancelRunner(runner); }
  for (const animation of [...animations.values()]) if (animation.taskHandle === handle) { if (status === 'completed') delete animation.taskHandle; else stopAnimation(animation.id, animation.property, false); }
  for (const [waiter, request] of [...taskWaits]) if (request.handle === handle) { taskWaits.delete(waiter); resumes.push(() => drive(waiter)); }
  const completed = [...tasks.values()].filter(item => blueprintTaskFinished(item.status)).sort((a,b) => (a.completedOrder ?? a.serial) - (b.completedOrder ?? b.serial));
  for (const item of completed.slice(0, Math.max(0, completed.length - blueprintTaskResultLimit))) tasks.delete(item.handle);
  return true;
 };
 const pageResults: (UiPageCompletion & { pageId: string; instance: number })[] = [];
 const all = [...new Map([...declaredUiComponents(project), ...initialComponents].map(component => [component.id, component])).values()], nativeIds = new Set<string>();
 const componentById = new Map(all.map(component => [component.id, component])), propertyDefaults = uiPropertyDefaults(project, all);
 const controlDefinitions = new Map(all.map(component => [component.id, uiControlDefinition(project, component)]));
 // Image/video components bound to a parameter follow it, as in the game.
 const assetBindings = new Map(all.flatMap(component => { const variable = uiAssetBinding(project, component); return variable ? [[component.id, variable] as const] : []; }));
 const propertyFallbacks = new Map(all.map(component => [component.id, Object.fromEntries((Object.keys(uiProperties) as UiProperty[]).map(property => [property, uiPropertyFallbacks(component, property)]))]));
 const makePage = (id: string, components: UiComponent[], mode: PreviewPage['mode'], supplied?: Record<string, VariableValue>): PreviewPage => {
  let inputs: Record<string, VariableValue> = {}, interfaceProblem: string | undefined;
  try { inputs = uiPageInputValues(project, id, supplied, id.startsWith('ui:')); }
  catch (error) { interfaceProblem = error instanceof Error ? error.message : String(error); incomplete(interfaceProblem, { pageId: id }); }
  const nativeLayout = nativePreferencePreview(project,id,components) ?? nativeMusicPreview(project,id,components) ?? nativeHistoryPreview(project,id,components)
    ?? (id === 'ui:main' ? { kind: 'shortcut' as const, components: nativeMainButtons(project, components), bodyIds: [], top: 0, height: 0, contentHeight: 0 } : undefined);
  const layoutComponents = [...(nativeLayout?.components ?? []), ...components], layoutDefaults = uiPropertyDefaults(project, layoutComponents);
  for (const component of nativeLayout?.components ?? []) {
   nativeIds.add(component.id);
   if (!componentById.has(component.id)) {
    all.push(component); componentById.set(component.id, component); controlDefinitions.set(component.id, uiControlDefinition(project, component)); propertyDefaults[component.id] = layoutDefaults[component.id];
    propertyFallbacks.set(component.id, Object.fromEntries((Object.keys(uiProperties) as UiProperty[]).map(property => [property, uiPropertyFallbacks(component, property)])));
   }
  }
  if (nativeLayout) for (const component of layoutComponents) if (propertyDefaults[component.id]) propertyDefaults[component.id].layer = layoutDefaults[component.id]?.layer;
  const opening = resolveUiPageOpening(project, id);
  return { id, inputs, outputs: uiPageOutputDefaults(project, id), interfaceProblem, created: false, createdReady: false, focused: false, requestSerial: 0, controls: new Map(), cooldowns: new Map(), variables: Object.fromEntries((project.ui.pageVariables?.[id] ?? []).map(variable => [variable.id, variable.initial])), instance: ++serial, components: [...(nativeLayout?.components??[]),...components], nativeLayout, mode, opening, modal: opening.input === 'block', musicPages: {}, voice: {}, timers: [], gallery: { pages: {} } };
 };
 let root = makePage(initialPageId, initialComponents, 'root', options.pageInputs);
 root.saveMode = initialPageId === 'ui:save' ? 'load' : undefined;
 let rootOpen = true;
 const openPages: PreviewPage[] = [];
 const layers = () => {
  const menu = [...openPages].reverse().find(p => p.mode === 'menu');
  const pages = menu ? openPages.slice(openPages.indexOf(menu) + 1) : openPages;
  return [ ...(menu ? [menu] : rootOpen ? [root] : []), ...pages.filter(p => p.mode !== 'confirm'), ...pages.filter(p=>p.mode==='confirm') ];
 };
 const syncTimers = () => {
  const displayed = layers();
  const owner=musicOwner;
  if(owner&&!displayed.some(page=>page.instance===owner.instance&&page.id===owner.pageId)){music={...music,playback:undefined};musicOwner=undefined;}
  const voicePage=voiceOwner;
  if(voicePage&&!displayed.some(page=>page.instance===voicePage.instance&&page.id===voicePage.pageId)){voice={...voice,playback:undefined};voiceOwner=undefined;}
  for (const page of [root, ...openPages]) {
   if (!displayed.includes(page)) { page.pausedAt ??= elapsed; }
   else if (page.pausedAt !== undefined) { const delta = elapsed - page.pausedAt; for (const timer of page.timers) { timer.start += delta; timer.next += delta; } if (page.autoCloseAt !== undefined) page.autoCloseAt += delta; delete page.pausedAt; }
  }
  syncPageFocus();
 };
 const pageIsOpen = (page: PreviewPage) => rootOpen && page === root || openPages.includes(page);
 const statePage = (pageId: string) => {
  if (activeRunner?.lifecycle?.phase === 'closed' && activeRunner.lifecycle.page.id === pageId) return undefined;
  const owner = activeRunner?.owner;
  const page = owner?.id === pageId ? owner : [...openPages, root].find(page => page.id === pageId && pageIsOpen(page));
  return page && pageIsOpen(page) ? page : undefined;
 };
 context.pageInterface = {
  phase: () => activeRunner?.lifecycle?.phase,
  get: (pageId, direction, parameterId) => {
   const lifecycle = activeRunner?.lifecycle;
   if (lifecycle?.phase === 'closed' && lifecycle.page.id === pageId) return (direction === 'inputs' ? lifecycle.inputs : lifecycle.completion?.outputs ?? {})[parameterId];
   return statePage(pageId)?.[direction][parameterId];
  },
  setOutput: (pageId, parameterId, value) => {
   const page = statePage(pageId), parameter = uiPageInterface(project, pageId)?.outputs.find(parameter => parameter.id === parameterId);
   if (!page || !parameter || !validUiPageParameterValue(parameter.dataType, value)) return false;
   page.outputs = { ...page.outputs, [parameterId]: value }; return true;
  },
  preventClose: pageId => {
   const lifecycle = activeRunner?.lifecycle;
   const request = lifecycle?.page.closeRequest;
   if (lifecycle?.phase !== 'closeRequested' || lifecycle.page.id !== pageId || !request || request.id !== lifecycle.requestId) return false;
   request.prevented = true; return true;
  },
 };
 context.tasks = {
  enterCall: graphId => ({ id: ++callSerial, graphId, alive: true }),
  leaveCall: call => { call.alive = false; for (const task of [...tasks.values()]) if (task.submission?.scope === 'call' && task.submission.call === call) finishTask(task.handle, 'cancelled', 'callEnded'); },
  start: submission => {
   if (!options.timed) return;
   const owner = submission.scope === 'page' ? statePage(submission.pageId ?? '') : activeRunner?.owner;
   if (submission.scope === 'page' && !owner || !submission.call.alive) return;
   const definition = projectGraphs(project).find(graph => graph.id === submission.graphId); if (!definition) return;
   for (const pin of definition.exposedInputs) {
    const value = submission.inputs[pin.id] ?? pin.defaultValue, type = pin.dataType;
    if (value === undefined && pin.defaultValue === undefined && !pin.required) continue;
    if (!validBlueprintTaskValue(type, value)) return;
    if (pin.required && ['asset','character','scene','ui','component'].includes(type) && !value) return;
   }
   const previous = [...tasks.values()].filter(task => task.submission && !blueprintTaskFinished(task.status) && task.submission.sourceGraphId === submission.sourceGraphId && task.submission.nodeId === submission.nodeId && task.submission.scope === submission.scope && (submission.scope === 'page' ? task.owner === owner : task.submission.call === submission.call));
   if (previous.length && submission.conflict === 'ignore') return { handle: previous.at(-1)!.handle, output: 'blocked' };
   if (submission.conflict === 'replace') for (const task of previous) finishTask(task.handle, 'cancelled', 'replaced');
   if ([...tasks.values()].filter(task => !blueprintTaskFinished(task.status)).length >= blueprintTaskActiveLimit) return { handle: '', output: 'blocked' };
   const serial = ++taskSerial, handle = 'task:preview:' + serial;
   tasks.set(handle, { handle, serial, graphId: submission.graphId, status: 'queued', reason: '', outputs: {}, due: elapsed + submission.seconds, owner, submission: { ...submission, inputs: { ...submission.inputs } } });
   return { handle, output: 'exec_out' };
  },
  cancel: handle => finishTask(handle, 'cancelled', 'cancelled'),
  result: (handle, graphId) => {
   const task = tasks.get(handle);
   if (!task) return { status: 'missing', reason: 'missing', outputs: {} };
   if (graphId && task.graphId !== graphId) return { status: 'failed', reason: 'moduleMismatch', outputs: {} };
   return { status: task.status, reason: task.reason, graphId: task.graphId, outputs: { ...task.outputs } };
  },
 };
 context.pageState = {
  throttle: (pageId, graphId, nodeId, entry, seconds) => {
   const page = statePage(pageId); if (!page) return;
   const key = JSON.stringify([graphId, nodeId]), result = transitionBlueprintThrottle(entry, page.cooldowns.get(key), elapsed, seconds);
   if (result) { if (result.until === undefined) page.cooldowns.delete(key); else page.cooldowns.set(key, result.until); }
   return result;
  },
  control: (pageId, graphId, node, entry) => {
   const page = statePage(pageId); if (!page || !isBlueprintFlowControl(node.type)) return;
   const key = JSON.stringify([graphId, node.id]);
   const result = transitionBlueprintFlowControl(node.type, entry, page.controls.get(key), blueprintFlowControlInitial(node));
   if (result) page.controls.set(key, result.closed);
   return result;
  },
  instance: pageId => statePage(pageId)?.instance,
  get: (pageId, variableId) => statePage(pageId)?.variables[variableId],
  set: (pageId, variableId, value) => {
   const page = statePage(pageId), variable = project.ui.pageVariables?.[pageId]?.find(variable => variable.id === variableId);
   if (!page || !variable || !validBlueprintStateValue(variable.type, value)) return false;
   page.variables = { ...page.variables, [variableId]: value }; return true;
  },
 };
 const detailPage = () => layers().some(page=>page.mode==='confirm') ? undefined : layers().reverse().find(page => !!page.gallery.detail);
 const active = () => detailPage() ?? [...layers()].reverse().find(page => page.opening.input !== 'none');
 const interactivePages = () => {
  const pages = layers();
  const reverseBoundary = [...pages].reverse().findIndex(page => page.modal);
  const boundary = reverseBoundary < 0 ? 0 : pages.length - reverseBoundary - 1;
  return pages.slice(Math.max(0, boundary)).filter(page => page.opening.input !== 'none');
 };
 const componentMusicDisabled=(c:UiComponent)=>isMusicControl(c.action)&&((c.action==='musicPlayPause'&&!music.playback)||(['musicPrevious','musicNext'].includes(c.action)&&!unlockedMusic().length));
 const propertySourceCache = new Map<string, Map<string, ReturnType<typeof uiPropertyControlFor>>>();
 const propertySource = (id: string, property: string) => {
  let cached = propertySourceCache.get(id);
  if (cached?.has(property)) return cached.get(property);
  const component = componentById.get(id);
  const source = component && Object.hasOwn(uiProperties, property) ? uiPropertyControlFor(project, component, property as UiProperty) : undefined;
  if (!cached) { cached = new Map(); propertySourceCache.set(id, cached); }
  cached.set(property, source); return source;
 };
 const sourceProblems = new Set<string>();
 const sourceProblem = (id: string, property: string, reason: string) => {
  const key = JSON.stringify([id, property, reason]);
  if (sourceProblems.has(key)) return;
  sourceProblems.add(key);
  incomplete((componentById.get(id)?.text || '控件') + ' · ' + (uiProperties[property as UiProperty]?.name ?? property) + '：' + reason, { componentId: id });
 };
 const readPropertySource = (id: string, property: string, pending?: Record<string, VariableValue>): VariableValue | undefined => {
  const source = propertySource(id, property); if (!source) return;
  const problem = uiPropertyControlSourceProblem(project, componentById.get(id)!, source.property, source.control);
  if (problem) { sourceProblem(id, property, problem); return; }
  const value = pending && Object.hasOwn(pending, source.control.parameterId) ? pending[source.control.parameterId] : context.variables[source.control.parameterId];
  const valueProblem = uiPropertyValueProblem(project, source.property, value);
  if (valueProblem) { sourceProblem(id, property, '来源参数当前值无效：' + valueProblem); return; }
  return value;
 };
 const effectiveControl = (id: string, pending?: Record<string, VariableValue>, instanceValues = overrides.get(id)) => {
  const info = controlDefinitions.get(id); if (!info) return;
  const values = { ...instanceValues };
  const parameters = Object.fromEntries(Object.entries(pending ?? {}).flatMap(([property, value]) => {
   const source = propertySource(id, property); return source ? [[source.control.parameterId, value]] : [];
  }));
  if (info.range) for (const property of Object.keys(uiControlRangeFields)) {
   if (pending && Object.hasOwn(pending, property)) values[property] = pending[property];
   else if (propertySource(id, property)) {
    const value = readPropertySource(id, property, parameters); if (value === undefined) return;
    values[property] = value;
   }
  }
  const result = { ...uiControlWithRange(info, values), options: optionOverrides.get(id) ?? info.options };
  const problem = result.range && uiControlRangeProblem(result, result.range);
  if (problem) { sourceProblem(id, 'minimum', problem); return; }
  return result;
 };
 let layoutReadCache: Map<string, UiLayoutGeometry> | undefined;
 const layoutFor = (page?: PreviewPage): Map<string, UiLayoutGeometry> => {
  const components = (page?.components ?? all).map(component => {
   const c = { ...component, layout: component.layout ? { ...component.layout } : undefined };
   for (const property of ['x', 'y', 'width', 'height', ...Object.keys(uiLayoutPropertyFields)] as UiProperty[]) {
    const value = get(c.id, property, true); if (value !== undefined) applyUiPropertySnapshot(c, property, value);
   }
   return c;
  });
  return resolveUiLayout(components, project, c => ownVisible(c, page));
 };
 const geometryFor = (id: string): UiLayoutGeometry | undefined => layoutReadCache?.get(id) ?? layoutFor([root, ...openPages].find(page => pageIsOpen(page) && page.components.some(c => c.id === id))).get(id);
 const get = (id: string, property: string, rawLayout = false): VariableValue | undefined => {
  const c = componentById.get(id); if (!c || !Object.hasOwn(propertyDefaults[id] ?? {}, property)) return;
  // A property override must not resurrect an action whose target was removed.
  if (property === 'enabled' && c.action && !uiActionAvailable(theme, c.action)) return false;
  if ((Object.hasOwn(uiLayoutPropertyFields, property) || isUiLayoutObservation(property)) && uiLayoutProblem(c)) return;
  if (!rawLayout && isUiLayoutObservation(property)) { const geometry = geometryFor(id); return geometry && uiLayoutObservation(geometry, property); }
  if ((uiSpineObservationProperties as readonly string[]).includes(property)) {
   const request = spineRequestForId(id), problem = spineProblems.get(id);
   if (problem && property === 'spineStatus') return 'failed';
   if (problem && property === 'spineError') return problem;
   if (problem && ['spinePlaying', 'spinePaused'].includes(property)) return false;
   return request ? uiSpineObservation(request, property) : propertyDefaults[id]?.[property as UiProperty];
  }
  if (property.startsWith('video') && !['video', 'videoPoster', 'videoLoop'].includes(property)) {
    const request = videoRequestForId(id); return request ? uiVideoObservation(request, property) : propertyDefaults[id]?.[property as UiProperty];
   }
   if (['imageStatus', 'imageError', 'imageSource', 'imageSourceWidth', 'imageSourceHeight'].includes(property)) {
    const request = imageRequestForId(id);
    return property === 'imageStatus' ? request?.status ?? 'empty' : property === 'imageError' ? request?.error ?? '' : property === 'imageSource' ? request?.assetId ?? '' : property === 'imageSourceWidth' ? request?.width ?? 0 : request?.height ?? 0;
   }
   if (property === 'focused') return !!inputFocus && inputFocus.componentId === id && pageIsOpen(inputFocus.page) && interactivePages().includes(inputFocus.page) && !detailPage() && visible(c, inputFocus.page) && !geometryFor(id)?.clippedOut && enabled(c) && get(id, 'readOnly') !== true;
  if (property === 'hovered' || property === 'pressed') {
   const state = buttonStates.get(id);
   return !!state && pageIsOpen(state.page) && interactivePages().includes(state.page) && !detailPage() && visible(c, state.page) && !geometryFor(id)?.clippedOut && enabled(c) && state.hover && (property === 'hovered' || state.held);
  }
  const definition = controlDefinitions.get(id);
  // Following one current value prevents player edits of that value, not the
  // control's other attributes or blueprint events.
  if (property === 'readOnly' && definition && propertySource(id, uiControlPrimaryProperty(definition))?.control?.mode === 'follow') return true;
  const control = definition && (isUiControlValueProperty(property) || isUiControlRangeProperty(property) || ['optionCount', 'optionLabel'].includes(property)) ? effectiveControl(id) : undefined;
  const source = propertySource(id, property);
  if (source) {
   if (source.property !== property && isUiControlValueProperty(property)) {
    if (!control) return;
    const current = get(id, source.property); if (current === undefined) return;
    return property === 'normalizedValue' ? uiControlRatio(control, current) : property === 'optionIndex' ? control.options.findIndex(option => uiControlOptionMatches(option.value, current)) : current;
   }
   const value = readPropertySource(id, property); if (value === undefined) return;
   if (isUiControlRangeProperty(property) && !control) return;
   if (definition && source.property === uiControlPrimaryProperty(definition)) {
    if (!control) return;
    // A narrower numeric control clamps only its displayed value. Source
    // values, including values observed by another control, remain untouched.
    const problem = uiControlValueProblem({ ...control, range: undefined }, value, Number(get(id, 'maxLength') ?? 200));
    if (problem) { sourceProblem(id, property, '来源参数当前值无效：' + problem); return; }
    return uiControlEffectiveValue(control, value);
   }
   if (property === 'spineSkin') {
    const problem = uiSpineSkinProblem(project.assets.find(asset => asset.id === get(id, 'spineAsset')), value);
    if (problem) { sourceProblem(id, property, problem); return; }
   }
   return value;
  }
  if (definition && !control && (isUiControlValueProperty(property) || isUiControlRangeProperty(property) || ['optionLabel', 'optionCount'].includes(property))) return;
  const animation=animations.get(animationKey(id,property));
  if(animation?.track)return sampleUiAnimationTrack(animation.track,animation.playback?uiAnimationPlaybackTime(animation.playback,elapsed-animation.start):elapsed-animation.start,animation.from);
  if(animation)return uiAnimationValue(animation.from,animation.to,(elapsed-animation.start)/animation.duration,animation.easing);
  const override = overrides.get(id); if (override && Object.hasOwn(override, property)) return control && property === uiControlPrimaryProperty(control) ? uiControlEffectiveValue(control, override[property]) : override[property];
  for (const fallback of propertyFallbacks.get(id)?.[property] ?? []) {
   if (propertySource(id, fallback)) return get(id, fallback);
   if (override && Object.hasOwn(override, fallback)) return override[fallback];
  }
  const bound = assetBindings.get(id);
  if (bound && property === (c.kind === 'video' ? 'video' : 'image')) {
   const shown = uiBoundAssetId(project, c, context.variables[bound.id] ?? bound.initial);
   if (shown !== c.assetId) return shown;
  }
  if (control) {
   const primary = uiControlPrimaryProperty(control);
   if (property === primary) return uiControlEffectiveValue(control, (control.parameterId ? context.variables[control.parameterId] : control.preference === 'characterVolume' ? context.characterVolumes?.[control.characterId ?? ''] ?? context.preferences?.characterVolume : context.preferences?.[control.preference!]) ?? control.initial);
   if (property === 'normalizedValue') { const current = get(id, primary); return current === undefined ? undefined : uiControlRatio(control, current); }
   if (property === 'optionCount') return control.options.length;
   if (property === 'optionIndex' || property === 'optionLabel') {
    const current = get(id, primary); if (current === undefined) return;
    const index = control.options.findIndex(option => uiControlOptionMatches(option.value, current));
    return property === 'optionIndex' ? index : control.options[index]?.label ?? '';
   }
  }
  if (property === 'spineSkin' && String(get(id, 'spineAsset') ?? '') !== c.assetId) return '';
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
  if (property === 'text' && c.binding === 'title') return project.name;
  return propertyDefaults[id]?.[property as UiProperty];
 };
 const animationValue = (animation: Animation) => animation.track
  ? sampleUiAnimationTrack(animation.track, animation.playback ? uiAnimationPlaybackTime(animation.playback, elapsed - animation.start) : elapsed - animation.start, animation.from)
  : uiAnimationValue(animation.from, animation.to, (elapsed - animation.start) / animation.duration, animation.easing);
 type PendingProperties = { id: string; values: Record<string, VariableValue> };
 type PendingPreference = { key: PlayerPreference; character: string; value: VariableValue };
 const preferenceKey = (key: PlayerPreference, character = '') => JSON.stringify([key, key === 'characterVolume' ? character : '']);
 type PendingPreferences = ReadonlyMap<string, PendingPreference>;
 const preferenceCandidate = (key: PlayerPreference, character: string | undefined, pending: PendingPreferences): VariableValue | undefined => pending.get(preferenceKey(key, character))?.value
  ?? (key === 'characterVolume' ? context.characterVolumes?.[character ?? ''] ?? context.preferences?.characterVolume : context.preferences?.[key]);
 /** Candidate reads are private and never call media-request or focus setters.
  * Values remain unclamped here so input/option checks can inspect the source. */
 const propertyCandidates = (pending: Record<string, VariableValue>, target: PendingProperties | undefined, preferences: PendingPreferences) => {
  const variables = { ...context.variables, ...pending };
  const raw = (id: string, property: string): VariableValue | undefined => {
   const component = componentById.get(id); if (!component || !Object.hasOwn(propertyDefaults[id] ?? {}, property)) return;
   if (property === 'enabled' && component.action && !uiActionAvailable(theme, component.action)) return false;
   const info = controlDefinitions.get(id);
   if (property === 'readOnly' && info && propertySource(id, uiControlPrimaryProperty(info))?.control.mode === 'follow') return true;
   if (propertySource(id, property)) return readPropertySource(id, property, pending);
   const local = target?.id === id ? target.values : undefined;
   if (local && Object.hasOwn(local, property)) return local[property];
   const animation = animations.get(animationKey(id, property)); if (animation) return animationValue(animation);
   const values = overrides.get(id);
   if (values && Object.hasOwn(values, property)) return values[property];
   for (const fallback of propertyFallbacks.get(id)?.[property] ?? []) {
    if (propertySource(id, fallback) || local && Object.hasOwn(local, fallback) || values && Object.hasOwn(values, fallback)) return raw(id, fallback);
   }
   const bound = assetBindings.get(id);
   if (bound && property === (component.kind === 'video' ? 'video' : 'image')) {
    const shown = uiBoundAssetId(project, component, variables[bound.id] ?? bound.initial);
    if (shown !== component.assetId) return shown;
   }
   if (info && property === uiControlPrimaryProperty(info)) return (info.parameterId ? variables[info.parameterId] : info.preference ? preferenceCandidate(info.preference, info.characterId, preferences) : undefined) ?? info.initial;
   if (property === 'spineSkin' && raw(id, 'spineAsset') !== component.assetId) return '';
   if (property === 'visible') return !component.visibleWhen || matches(component.visibleWhen, variables);
   if (property === 'enabled') return !componentMusicDisabled(component) && !component.disabled && (!component.enabledWhen || matches(component.enabledWhen, variables))
    && !(component.action === 'setPlayerPreference' && component.preference === 'windowSize' && preferenceCandidate('fullscreen', undefined, preferences))
    && !(nativeIds.has(id) && returnPageId === 'ui:main' && (component.action === 'save' || component.action === 'history'));
   if (property === 'selected') {
    if (component.selectedWhen) return matches(component.selectedWhen, variables);
    if (component.action === 'window' || component.action === 'fullscreen') return !!preferenceCandidate('fullscreen', undefined, preferences) === (component.action === 'fullscreen');
    if (component.action === 'skipSeen' || component.action === 'skipAll') return !!preferenceCandidate('skipAll', undefined, preferences) === (component.action === 'skipAll');
    if (component.action === 'musicPlayPause') return music.playback?.paused ?? false;
    if (component.action === 'musicLoop') return music.loop;
    if (component.action === 'musicShuffle') return music.shuffle;
    if (component.action === 'mute') return muted;
    if (component.action === 'transitions') return transitions;
    return component.action === 'setPlayerPreference' && component.preference ? preferenceCandidate(component.preference, component.preferenceCharacterId, preferences) === component.preferenceValue : false;
   }
   if (property === 'text' && component.binding === 'title') return project.name;
   return propertyDefaults[id]?.[property as UiProperty];
  };
  return raw;
 };
 const parameterWritesValid = (pending: Record<string, VariableValue>, target?: PendingProperties, batchPreferences?: PendingPreferences): boolean => {
  for (const [id, value] of Object.entries(pending)) {
   const parameter = project.variables.find(item => item.id === id);
   if (!parameter || typeof value !== variableValueType(parameter) || typeof value === 'number' && !Number.isFinite(value)) return false;
  }
  const readers = new Set([root, ...openPages].filter(pageIsOpen).flatMap(page => page.components.map(component => component.id)));
  if (target) readers.add(target.id);
  const candidate = batchPreferences && propertyCandidates(pending, target, batchPreferences);
  for (const id of readers) {
   const component = componentById.get(id)!;
   const properties = Object.entries(component.propertyControls ?? {}).filter(([, control]) => control && Object.hasOwn(pending, control.parameterId)).map(([property]) => property);
   const local = target?.id === id ? target.values : undefined;
   const info = controlDefinitions.get(id), primary = info && uiControlPrimaryProperty(info);
   if (batchPreferences && info && primary && !propertySource(id, primary) && !Object.hasOwn(overrides.get(id) ?? {}, primary)
    && (info.parameterId && Object.hasOwn(pending, info.parameterId) || info.preference && batchPreferences.has(preferenceKey(info.preference, info.characterId)))) properties.push(primary);
   const changed = [...new Set([...properties, ...Object.keys(local ?? {})])];
   const related = changed.some(property => isUiControlRangeProperty(property) || isUiControlValueProperty(property) || property === 'maxLength');
   if (batchPreferences ? !changed.length : !properties.length && !related) continue;
   for (const property of properties) {
    const source = propertySource(id, property);
    if (!source && batchPreferences) continue;
    const problem = uiPropertyControlSourceProblem(project, component, property, batchPreferences ? source!.control : component.propertyControls![property]);
    if (problem) { sourceProblem(id, property, problem); return false; }
   }
   let failed = false;
   const raw = (property: string): VariableValue | undefined => {
    if (candidate) { const value = candidate(id, property); if (value === undefined) failed = true; return value; }
    const source = propertySource(id, property);
    if (!source) return local && Object.hasOwn(local, property) ? local[property] : overrides.get(id)?.[property] ?? propertyDefaults[id]?.[property as UiProperty];
    const metadataProblem = uiPropertyControlSourceProblem(project, component, source.property, source.control);
    if (metadataProblem) { failed = true; sourceProblem(id, property, metadataProblem); return; }
    const value = Object.hasOwn(pending, source.control.parameterId) ? pending[source.control.parameterId] : context.variables[source.control.parameterId];
    const problem = uiPropertyValueProblem(project, source.property, value);
    if (problem) { failed = true; sourceProblem(id, property, problem); return; }
    return value;
   };
   for (const property of batchPreferences ? changed : properties) {
    const value = raw(property);
    const valueProblem = batchPreferences && uiPropertyValueProblem(project, propertySource(id, property)?.property ?? property, value);
    if (valueProblem) { failed = true; sourceProblem(id, property, valueProblem); }
    if ((property === 'spineSkin' || batchPreferences && property === 'spineAsset') && value !== undefined) {
     const problem = uiSpineSkinProblem(project.assets.find(asset => asset.id === raw('spineAsset')), property === 'spineSkin' ? value : raw('spineSkin'));
     if (problem) { failed = true; sourceProblem(id, property, problem); }
    }
   }
   if (failed) return false;
   if (info && related) {
    const rangeValues: Record<string, VariableValue> = {};
    if (info.range) for (const property of Object.keys(uiControlRangeFields)) { const value = raw(property); if (value !== undefined) rangeValues[property] = value; }
    const control = { ...uiControlWithRange(info, rangeValues), options: optionOverrides.get(id) ?? info.options };
    const rangeProblem = control.range && uiControlRangeProblem(control, control.range);
    if (rangeProblem) { sourceProblem(id, 'minimum', rangeProblem); return false; }
    const primary = uiControlPrimaryProperty(control);
    if ((batchPreferences || propertySource(id, primary)) && changed.some(property => isUiControlValueProperty(property) || property === 'maxLength')) {
     const value = raw(primary), maxLength = control.textInput ? raw('maxLength') : undefined;
     if (value !== undefined) {
      const directValue = batchPreferences && local && Object.hasOwn(local, primary);
      const problem = uiControlValueProblem(directValue ? control : { ...control, range: undefined }, value, Number(maxLength ?? 200));
      if (problem) { sourceProblem(id, primary, problem); return false; }
     }
    }
   }
   if (failed) return false;
  }
  return true;
 };
 const writeParameters = (pending: Record<string, VariableValue>, driver?: Animation, target?: PendingProperties): boolean => {
  if (!parameterWritesValid(pending, target)) return false;
  // Even an equal explicit write transfers ownership away from an animation.
  // Internal clock samples carry their driver so they cannot cancel themselves.
  if (!driver) for (const animation of [...animations.values()]) if (animation.parameterId && Object.hasOwn(pending, animation.parameterId)) stopAnimation(animation.id, animation.property, false);
  Object.assign(context.variables, pending);
  return true;
 };
 const writeParameter = (parameterId: string, value: VariableValue, driver?: Animation, target?: PendingProperties): boolean => writeParameters({ [parameterId]: value }, driver, target);
 context.setParameter = (parameterId, value) => writeParameter(parameterId, value);
 const writableSource = (id: string, property: string): boolean => {
  const source = propertySource(id, property); if (!source) return true;
  const problem = uiPropertyControlSourceProblem(project, componentById.get(id)!, source.property, source.control);
  if (problem) { sourceProblem(id, property, problem); return false; }
  if (source.control.mode === 'follow') { sourceProblem(id, property, '此属性正在单向跟随参数，不能直接赋值或播放属性动画；请修改来源参数或更改控制方式。'); return false; }
  return true;
 };
 const writePropertyValue = (id: string, property: string, value: VariableValue, driver?: Animation): boolean => {
  const source = propertySource(id, property);
  if (source) {
   if (!writeParameter(source.control.parameterId, value, driver, { id, values: { [source.property]: value } })) return false;
   const values = overrides.get(id); if (values) delete values[source.property];
  } else overrides.set(id, { ...overrides.get(id), [property]: value });
  return true;
 };
 const sampleParameterAnimations = () => {
  const drivers = [...animations.values()].filter(animation => !!animation.parameterId);
  if (!drivers.length) return;
  const pending = Object.fromEntries(drivers.map(animation => [animation.parameterId!, animationValue(animation)]));
  if (parameterWritesValid(pending) && drivers.every(animation => parameterWritesValid(pending, { id: animation.id, values: { [animation.property]: pending[animation.parameterId!] } }))) Object.assign(context.variables, pending);
  else for (const animation of drivers) stopAnimation(animation.id, animation.property, false);
 };
 const releaseAnimations = (selected: Animation[], finish: boolean): boolean => {
  const pending = Object.fromEntries(selected.filter(animation => animation.parameterId && finish).map(animation => [animation.parameterId!, animation.to]));
  if (finish && (!parameterWritesValid(pending) || selected.some(animation => !parameterWritesValid(pending, { id: animation.id, values: { [animation.property]: animation.to } })))) return false;
  // Stopping/resetting without finishing only releases parameter drivers.
  // Their last clock sample remains unchanged; no render read writes back.
  if (finish) Object.assign(context.variables, pending);
  for (const animation of selected) {
   animations.delete(animationKey(animation.id, animation.property));
   if (!animation.parameterId) writePropertyValue(animation.id, animation.property, finish ? animation.to : animationValue(animation));
   if(animation.done){if(activeRunner)(activeRunner.deferred??=[]).push(animation.done);else resumes.push(animation.done);}
  }
  return true;
 };
 const stopAnimation=(id:string,property:string,finish:boolean):boolean=>{
  if(!all.some(c=>c.id===id)||property!=='all'&&!isUiAnimationProperty(property))return false;
  return releaseAnimations([...animations.values()].filter(animation => animation.id === id && (property === 'all' || animation.property === property)), finish);
 };
 const stopPlayback=(id:string,finish:boolean):boolean=>{
  if(!project.ui.animations?.some(a=>a.id===id))return false;
  return releaseAnimations([...animations.values()].filter(animation => animation.clip === id), finish);
 };
 const setProperties = (id: string, assignments: readonly BlueprintUiPropertyAssignment[]): boolean => {
  const component = componentById.get(id);
  if (!component || !Array.isArray(assignments) || !assignments.length || assignments.length > maxBlueprintUiPropertyRows) return false;
  const info = controlDefinitions.get(id), primary = info && uiControlPrimaryProperty(info);
  const values: Record<string, VariableValue> = {}, local: Record<string, VariableValue> = {};
  const parameters: Record<string, VariableValue> = Object.create(null), preferences = new Map<string, PendingPreference>(), cleared = new Set<string>(), properties = new Set<string>();
  const target: PendingProperties = { id, values };
  const addParameter = (property: string, parameterId: string, value: VariableValue): boolean => {
   if (Object.hasOwn(parameters, parameterId) && parameters[parameterId] !== value) {
    sourceProblem(id, property, '多项属性正同步同一参数，不能在同一次操作中写入不同值。'); return false;
   }
   parameters[parameterId] = value; return true;
  };
  const stage = (property: string, value: VariableValue, writeMode: string): boolean => {
   const source = propertySource(id, property);
   if (source) {
    if (!addParameter(property, source.control.parameterId, value)) return false;
    cleared.add(property);
   } else if (writeMode === 'source') {
    if (!info || property !== primary) return false;
    if (info.parameterId) { if (!addParameter(property, info.parameterId, value)) return false; }
    else {
     const key = info.preference, character = info.characterId ?? '';
     if (!key || !validPlayerPreference(key, value) || key === 'characterVolume' && character && !project.characters.some(item => item.id === character)) return false;
     preferences.set(preferenceKey(key, character), { key, character, value });
    }
    cleared.add(property);
   } else local[property] = value;
   values[property] = value; return true;
  };
  // Reject all malformed rows and aliases before producing any candidate value.
  const rows: { property: string; input: string; value: VariableValue; writeMode: string }[] = [];
  for (const row of assignments) {
   if (!row || typeof row !== 'object' || !uiPropertyWritable(row.property) || !Object.hasOwn(propertyDefaults[id] ?? {}, row.property) || !['override', 'source'].includes(row.writeMode)) return false;
   const problem = uiPropertyValueProblem(project, row.property, row.value);
   if (problem) { sourceProblem(id, row.property, problem); return false; }
   if (Object.hasOwn(uiLayoutPropertyFields, row.property) && uiLayoutProblem(component) || !writableSource(id, row.property)) return false;
   const property = isUiControlValueProperty(row.property) ? primary : row.property;
   if (!property || isUiControlRangeProperty(property) && !info?.range) return false;
   if (properties.has(property)) { sourceProblem(id, property, '同一属性或当前值的不同表示不能在一批中重复设置。'); return false; }
   properties.add(property); rows.push({ property, input: row.property, value: row.value, writeMode: row.writeMode });
  }
  let effects: ReturnType<typeof preparePropertyBatchEffects>, nextOverrides: Record<string, VariableValue>, displaced: Animation[];
  try {
   for (const row of rows) {
    if (row.input === 'normalizedValue') continue;
    const value = isUiControlValueProperty(row.input) ? uiControlAssignedValue({ ...info!, options: optionOverrides.get(id) ?? info!.options }, row.input, row.value) : row.value;
    if (!stage(row.property, value, row.writeMode)) return false;
   }
   const candidateControl = () => {
    if (!info) return;
    const raw = propertyCandidates(parameters, target, preferences), range: Record<string, VariableValue> = {};
    if (info.range) for (const property of Object.keys(uiControlRangeFields)) {
     const value = raw(id, property); if (value === undefined) return;
     range[property] = value;
    }
    const control = { ...uiControlWithRange(info, range), options: optionOverrides.get(id) ?? info.options };
    const problem = control.range && uiControlRangeProblem(control, control.range);
    if (problem) { sourceProblem(id, 'minimum', problem); return; }
    return control;
   };
   for (const row of rows.filter(row => row.input === 'normalizedValue')) {
    const control = candidateControl(); if (!control?.range) return false;
    if (!stage(row.property, uiControlAssignedValue(control, row.input, row.value), row.writeMode)) return false;
    const final = candidateControl(); if (!final?.range) return false;
    if (Object.keys(uiControlRangeFields).some(property => {
     const field = uiControlRangeFields[property as keyof typeof uiControlRangeFields]; return control.range![field] !== final.range![field];
    })) { sourceProblem(id, row.input, '归一化值的来源同时改变了本控件范围，无法确定同一次换算；请设置实际数值或使用独立的范围参数。'); return false; }
   }
   if (properties.has('spineAsset') && !properties.has('spineSkin') && !propertySource(id, 'spineSkin')) {
    const previous = propertyCandidates({}, undefined, new Map())(id, 'spineAsset'), next = propertyCandidates(parameters, target, preferences)(id, 'spineAsset');
    if (previous !== next) { values.spineSkin = ''; local.spineSkin = ''; }
   }
   // The empty preference map also opts into strict batch checks for ordinary
   // control bindings and existing local text when only maxLength changes.
   if (!parameterWritesValid(parameters, target, preferences)) return false;
   effects = preparePropertyBatchEffects(parameters, target, preferences);
   nextOverrides = { ...overrides.get(id), ...local }; for (const property of cleared) delete nextOverrides[property];
   displaced = [...animations.values()].filter(animation => animation.parameterId ? Object.hasOwn(parameters, animation.parameterId) : animation.id === id && properties.has(animation.property));
  } catch (error) {
   sourceProblem(id, rows[0]?.property ?? '', error instanceof Error ? error.message : String(error)); return false;
  }
  // From this point there are no more fallible checks. Continuations are only
  // queued, so they cannot observe a partly written batch.
  for (const animation of displaced) {
   animations.delete(animationKey(animation.id, animation.property));
   if (animation.done) { if (activeRunner) (activeRunner.deferred ??= []).push(animation.done); else resumes.push(animation.done); }
  }
  Object.assign(context.variables, parameters);
  for (const { key, character, value } of preferences.values()) {
   if (key === 'characterVolume') context.characterVolumes![character] = Number(value); else context.preferences![key] = value;
  }
  overrides.set(id, nextOverrides);
  for (const [identity, request] of effects.images) imageRequests.set(identity, request);
  for (const [identity, request] of effects.videos) videoRequests.set(identity, request);
  for (const [identity, request] of effects.spines) { spineRequests.set(identity, request); spineProblems.delete(identity); }
  for (const identity of effects.cancelButtons) buttonStates.delete(identity);
  if (effects.clearPendingFocus) pendingInputFocus = undefined;
  if (effects.clearFocus && inputFocus) { const previous = inputFocus; inputFocus = undefined; inputFocusFeedback(previous.page, previous.componentId, false); }
  return true;
 };
 context.ui = { get, setMany: setProperties, playSpine: (id, animation, loop, restart) => {
   const request = spineRequestForId(id); if (!request) return false;
   const followsLoop = propertySource(id, 'spineLoop')?.control?.mode === 'follow';
   const effectiveLoop = followsLoop ? get(id, 'spineLoop') : loop;
   if (followsLoop && effectiveLoop === undefined) return false;
   const next = playUiSpine(request, project.assets.find(a => a.id === request.assetId), animation, effectiveLoop, restart);
   if (!followsLoop && (!writableSource(id, 'spineLoop') || !writePropertyValue(id, 'spineLoop', next.loop))) return false;
   spineRequests.set(id, next); return true;
  }, pauseSpine: (id, paused) => { const request = spineRequestForId(id); if (!request) return false; spineRequests.set(id, pauseUiSpine(request, paused)); return true; }, video: (id, operation, value) => {
   const request = videoRequestForId(id); if (!request) return false;
   videoRequests.set(id, controlUiVideo(request, operation, value)); return true;
  }, getOption: (id, index, type) => {
  const control = effectiveControl(id); return control && readUiControlOption(control, index, type);
 }, editOptions: (id, operation, input) => {
  const control = effectiveControl(id); if (!control) return false;
  const next = editUiControlOptions(control, operation, input);
  if (next === undefined) optionOverrides.delete(id); else optionOverrides.set(id, next);
  return true;
 }, requestFocus: (id, focused) => {
  const control = controlDefinitions.get(id); if (!control?.textInput) return;
  const page = [root, ...openPages].find(page=>pageIsOpen(page)&&page.components.some(component=>component.id===id));
  if (!page || focused && !canInputFocus(page, id)) return false;
  pendingInputFocus = { page, componentId: id, focused }; return true;
 }, getDefault: (id, property) => {
  return propertyDefaults[id]?.[property as UiProperty];
 }, resetProperty: (id, property) => {
  if (!uiPropertyWritable(property) || !Object.hasOwn(propertyDefaults[id] ?? {}, property)) return false;
  if (Object.hasOwn(uiLayoutPropertyFields, property) && uiLayoutProblem(componentById.get(id)!)) return false;
  const control = controlDefinitions.get(id), key = control && isUiControlValueProperty(property) ? uiControlPrimaryProperty(control) : property;
  const values = { ...overrides.get(id) }; delete values[key];
  if (property === 'spineAsset') delete values.spineSkin;
  if (control && isUiControlRangeProperty(property) && !effectiveControl(id, undefined, values)) return false;
  if (isUiAnimationProperty(property)) stopAnimation(id, property, false);
  overrides.set(id, values); if (property === 'image') imageRequestForId(id); if (property === 'video' || property === 'videoLoop') videoRequestForId(id); if (property.startsWith('spine')) spineRequestForId(id); syncInputFocus(); return true;
 }, setRange: (id, range) => {
  const control = controlDefinitions.get(id); if (!control?.range || uiControlRangeProblem(control, range)) return false;
  const pending = { minimum: range.min, maximum: range.max, step: range.step }, parameters = new Map<string, VariableValue>();
  for (const [property, value] of Object.entries(pending)) {
   if (!writableSource(id, property)) return false;
   const source = propertySource(id, property); if (!source) continue;
   if (parameters.has(source.control.parameterId) && parameters.get(source.control.parameterId) !== value) { sourceProblem(id, property, '范围的多项属性关联同一个参数，不能同时写入不同值。'); return false; }
   parameters.set(source.control.parameterId, value);
  }
  // Validation uses the final range and all changed sources before any write.
  if (!writeParameters(Object.fromEntries(parameters), undefined, { id, values: pending })) return false;
  const values = { ...overrides.get(id) };
  for (const [property, value] of Object.entries(pending)) { if (propertySource(id, property)) delete values[property]; else values[property] = value; }
  overrides.set(id, values);
  return true;
 }, resetRange: id => {
  const control = controlDefinitions.get(id); if (!control?.range) return false;
  const values = { ...overrides.get(id) }; for (const property of Object.keys(uiControlRangeFields)) delete values[property];
  if (!effectiveControl(id, undefined, values)) return false;
  overrides.set(id, values); return true;
 }, stopAnimation, stopPlayback, set: (id, property, value, writeMode = 'override') => {
  if (property === 'spineSpeed') { const problem = uiSpineSpeedProblem(value); if (problem) { sourceProblem(id, property, problem); return false; } }
  if (!uiPropertyWritable(property) || !Object.hasOwn(propertyDefaults[id] ?? {}, property) || uiPropertyValueProblem(project, property, value) || !['override', 'source'].includes(writeMode) || !writableSource(id, property)) return false;
  if (Object.hasOwn(uiLayoutPropertyFields, property) && uiLayoutProblem(componentById.get(id)!)) return false;
  if (property === 'spineSkin' && uiSpineSkinProblem(project.assets.find(a => a.id === get(id, 'spineAsset')), value)) return false;
  const control = isUiControlValueProperty(property) || isUiControlRangeProperty(property) ? effectiveControl(id, isUiControlRangeProperty(property) ? { [property]: value! } : undefined) : undefined;
  if (isUiControlRangeProperty(property) && !control?.range) return false;
  const source = propertySource(id, property);
  if (isUiControlValueProperty(property)) {
   if (!control) return false;
   try { value = uiControlAssignedValue(control, property, value!); } catch { return false; }
   if (uiControlValueProblem(control, value!, Number(get(id, 'maxLength') ?? 200))) return false;
   property = uiControlPrimaryProperty(control);
   if (!source && writeMode === 'source') {
    if (control.parameterId) { if (!writeParameter(control.parameterId, value!)) return false; }
    else if (!control.preference || !setPreference(control.preference, value!, control.characterId)) return false;
    const values = overrides.get(id); if (values) delete values[property];
    syncInputFocus(); return true;
   }
  } else if (!source && writeMode === 'source') return false;
  if (!parameterWritesValid(source ? { [source.control.parameterId]: value! } : {}, { id, values: { [property]: value! } })) return false;
  if(!source && isUiAnimationProperty(property))stopAnimation(id,property,false);
  if (property === 'spineAsset' && get(id, property) !== value) overrides.set(id, { ...overrides.get(id), spineSkin: '' });
  if (!writePropertyValue(id, property, value!)) return false;
  if (property === 'image') imageRequestForId(id); if (property === 'video' || property === 'videoLoop') videoRequestForId(id); if (property.startsWith('spine')) spineRequestForId(id);
   if((property==='visible'||property==='enabled')&&value===false)buttonStates.delete(id);
  syncInputFocus(); return true;
 }, reset: id => {
  if (!all.some(c => c.id === id)) return false;
  const oldSpine = spineRequests.get(id);
  stopAnimation(id, 'all', false); overrides.delete(id); optionOverrides.delete(id); imageRequestForId(id);
  const request = videoRequestForId(id); if (request?.assetId) videoRequests.set(id, controlUiVideo(request, 'play', true));
  spineRequests.delete(id); const initialSpine = spineRequestForId(id); if (initialSpine) spineRequests.set(id, resetUiSpine(oldSpine, initialSpine));
  syncInputFocus(); return true;
 } };
 const ownVisible = (component: UiComponent, page?: PreviewPage) => get(component.id, 'visible') !== false && !(component.page === 'save' && component.saveMode && component.saveMode !== (page ?? active())?.saveMode);
 const visible = (component: UiComponent, page?: PreviewPage) => ownVisible(component, page) && uiAncestors((page ?? active())?.components ?? all, component.id).every(c => ownVisible(c, page));
 const ownEnabled = (component: UiComponent) => get(component.id, 'enabled') !== false;
 const enabled = (component: UiComponent) => ownEnabled(component) && uiAncestors(all, component.id).every(ownEnabled);
 const ownImageState = (component: UiComponent): import('./model').UiButtonState => !ownEnabled(component) || get(component.id, 'readOnly') === true ? 'disabled' : buttonStates.get(component.id)?.held && buttonStates.get(component.id)?.hover ? 'pressed' : get(component.id, 'selected') === true ? 'selected' : buttonStates.get(component.id)?.hover ? 'hover' : 'idle';
 const inheritedImageState = (component: UiComponent, seen = new Set<string>()): import('./model').UiButtonState => {
  if (seen.has(component.id) || seen.size >= 32) return 'idle';
  seen.add(component.id);
  const parent = component.parentId ? componentById.get(component.parentId) : undefined, state = parent && inheritedImageState(parent, seen);
  return state === 'disabled' ? 'disabled' : component.inheritState && state ? state : ownImageState(component);
 };
 const imageRequestForId = (id: string, owner?: PreviewPage): UiImageRequest | undefined => {
  const component = componentById.get(id); if (component?.kind !== 'image') return;
  const page = owner ?? [root, ...openPages].find(page => pageIsOpen(page) && page.components.some(c => c.id === id)); if (!page) return;
  const assetId = uiImageAsset({ ...component, assetId: String(get(id, 'image') ?? '') }, inheritedImageState(component));
  const request = uiImageRequest(imageRequests.get(id), assetId, page.instance, String(get(id, 'image') ?? '')); imageRequests.set(id, request); return request;
 };
 const videoRequestForId = (id: string, owner?: PreviewPage): UiVideoRequest | undefined => {
  const component = componentById.get(id); if (component?.kind !== 'video') return;
  const page = owner ?? [root, ...openPages].find(page => pageIsOpen(page) && page.components.some(c => c.id === id)); if (!page) return;
  const request = suspendUiVideo(uiVideoRequest(videoRequests.get(id), String(get(id, 'video') ?? ''), get(id, 'videoLoop') !== false, page.instance), !layers().includes(page) || !visible(component, page) || !!geometryFor(id)?.clippedOut);
  videoRequests.set(id, request); return request;
 };
 const spineRequestForId = (id: string, owner?: PreviewPage): UiSpineRequest | undefined => {
  const component = componentById.get(id); if (component?.kind !== 'spine') return;
  const page = owner ?? [root, ...openPages].find(page => pageIsOpen(page) && page.components.some(c => c.id === id)); if (!page) return;
  const asset = project.assets.find(a => a.id === get(id, 'spineAsset') && a.kind === 'spine');
  const speed = get(id, 'spineSpeed'), speedProblem = uiSpineSpeedProblem(speed);
  if (speedProblem) {
   sourceProblem(id, 'spineSpeed', speedProblem); spineProblems.set(id, speedProblem);
   // Preserve any previous request; never turn an invalid source into speed 1.
   return;
  }
  spineProblems.delete(id);
  const settings = { ...component.spine, animation: asset?.id === component.assetId ? component.spine?.animation : undefined,
   skin: String(get(id, 'spineSkin') ?? ''), loop: get(id, 'spineLoop') !== false, speed: speed as number };
  const request = suspendUiSpine(uiSpineRequest(spineRequests.get(id), asset, settings, page.instance), !layers().includes(page) || !visible(component, page) || !!geometryFor(id)?.clippedOut);
  spineRequests.set(id, request); return request;
 };
 const syncSpineRequests = () => { for (const page of [root, ...openPages]) if (pageIsOpen(page)) for (const component of page.components) if (component.kind === 'spine') spineRequestForId(component.id, page); };
 const syncVideoRequests = () => { for (const page of [root, ...openPages]) if (pageIsOpen(page)) for (const component of page.components) if (component.kind === 'video') videoRequestForId(component.id, page); };
 const syncImageRequests = () => { for (const page of [root, ...openPages]) if (pageIsOpen(page)) for (const component of page.components) if (component.kind === 'image') imageRequestForId(component.id, page); };
 const canInputFocus = (page: PreviewPage, id: string) => {
  const component = componentById.get(id);
  return !!component && pageIsOpen(page) && interactivePages().includes(page) && !detailPage() && visible(component, page) && !geometryFor(id)?.clippedOut && enabled(component) && get(id, 'readOnly') !== true;
 };
 const inputFocusFeedback = (page: PreviewPage, componentId: string, focused: boolean) => {
  inputFocusCommand = { sequence: ++inputFocusSequence, pageId: page.id, pageInstance: page.instance, componentId, focused, active: inputFocus && { componentId: inputFocus.componentId, pageInstance: inputFocus.page.instance } };
 };
 const syncInputFocus = () => {
  if (pendingInputFocus && (!pageIsOpen(pendingInputFocus.page) || pendingInputFocus.focused && !canInputFocus(pendingInputFocus.page, pendingInputFocus.componentId))) pendingInputFocus = undefined;
  if (inputFocus && !canInputFocus(inputFocus.page, inputFocus.componentId)) { const previous = inputFocus; inputFocus = undefined; inputFocusFeedback(previous.page, previous.componentId, false); }
 };
 const applyInputFocus = () => {
  syncInputFocus();
  const request = pendingInputFocus; pendingInputFocus = undefined;
  if (!request) return;
  if (request.focused) inputFocus = { page: request.page, componentId: request.componentId };
  else if (inputFocus?.page === request.page && inputFocus.componentId === request.componentId) inputFocus = undefined;
  inputFocusFeedback(request.page, request.componentId, request.focused);
 };
 const syncButtonStates=()=>{for(const [id,state] of buttonStates){const c=state.page.components.find(c=>c.id===id);if(!c||!pageIsOpen(state.page)||!interactivePages().includes(state.page)||detailPage()||!visible(c,state.page)||geometryFor(id)?.clippedOut||!enabled(c))buttonStates.delete(id);}syncInputFocus();};
 /** Build media requests and focus decisions against the final candidate. Pure
  * request constructors may reject metadata; no live request is replaced yet. */
 const preparePropertyBatchEffects = (parameters: Record<string, VariableValue>, target: PendingProperties, preferences: PendingPreferences) => {
  const raw = propertyCandidates(parameters, target, preferences), previous = propertyCandidates({}, undefined, new Map());
  const pages = [root, ...openPages].filter(pageIsOpen), displayed = layers(), interactive = interactivePages();
  const geometry = new Map<string, UiLayoutGeometry>(), previousGeometry = new Map<string, UiLayoutGeometry>();
  const ownShown = (component: UiComponent, page?: Pick<PreviewPage, 'saveMode'>, read = raw) => read(component.id, 'visible') !== false && !(component.page === 'save' && component.saveMode && component.saveMode !== page?.saveMode);
  const shown = (component: UiComponent, page: Pick<UiPropertyBatchMediaPage, 'components' | 'saveMode'>, read = raw) => ownShown(component, page, read) && uiAncestors(page.components, component.id).every(parent => ownShown(parent, page, read));
  const usable = (component: UiComponent, read = raw) => read(component.id, 'enabled') !== false && uiAncestors(all, component.id).every(parent => read(parent.id, 'enabled') !== false);
  // Individually finite values may still overflow when scaled by a parent or
  // composed into a transform. Reject the candidate before changing live state.
  const finiteGeometry = (value: unknown): boolean => typeof value === 'number' ? Number.isFinite(value)
   : Array.isArray(value) ? value.every(finiteGeometry)
   : value !== null && typeof value === 'object' ? Object.values(value).every(finiteGeometry) : true;
  const measure = (source: UiComponent[], page?: PreviewPage, read = raw, measured = geometry, validate = true) => {
   const components = source.map(component => {
    const candidate = { ...component, layout: component.layout ? { ...component.layout } : undefined };
    for (const property of ['x', 'y', 'width', 'height', ...Object.keys(uiLayoutPropertyFields)] as UiProperty[]) {
     const value = read(component.id, property); if (value !== undefined) applyUiPropertySnapshot(candidate, property, value);
    }
    return candidate;
   });
   for (const [id, layout] of resolveUiLayout(components, project, component => ownShown(component, page, read))) {
    if (validate && !finiteGeometry(layout)) throw new Error('本次设置后的布局超出可计算范围；请缩小位置、尺寸、旋转或缩放数值。');
    measured.set(id, layout);
   }
  };
  for (const page of pages) { measure(page.components, page); measure(page.components, page, previous, previousGeometry, false); }
  // Addressing an unopened page must not create a page instance, but its new
  // layout still needs to be renderable when that page is later displayed.
  if (!pages.some(page => page.components.some(component => component.id === target.id))) {
   const component = componentById.get(target.id)!;
   const custom = component.page === 'custom' ? project.ui.customPages.find(page => page.components.some(item => item.id === target.id)) : undefined;
   const components = custom?.components ?? effectiveUiComponents(project.ui).filter(item => item.page === component.page);
   if (components.some(item => item.id === target.id)) measure(components);
  }
  const cancelButtons = new Set<string>(), previousCancelledButtons = new Set<string>();
  for (const [id, state] of buttonStates) {
   const component = componentById.get(id);
   if (!component || !pageIsOpen(state.page) || !interactive.includes(state.page) || detailPage() || !shown(component, state.page) || geometry.get(id)?.clippedOut || !usable(component)) cancelButtons.add(id);
   if (!component || !pageIsOpen(state.page) || !interactive.includes(state.page) || detailPage() || !shown(component, state.page, previous) || previousGeometry.get(id)?.clippedOut || !usable(component, previous)) previousCancelledButtons.add(id);
  }
  const imageState = (component: UiComponent, read = raw, cancelled = cancelButtons, seen = new Set<string>()): UiButtonState => {
   if (seen.has(component.id) || seen.size >= 32) return 'idle';
   seen.add(component.id);
   const parent = component.parentId && componentById.get(component.parentId), inherited = parent && imageState(parent, read, cancelled, seen);
   if (inherited === 'disabled' || component.inheritState && inherited) return inherited;
   const state = cancelled.has(component.id) ? undefined : buttonStates.get(component.id);
   return read(component.id, 'enabled') === false || read(component.id, 'readOnly') === true ? 'disabled' : state?.held && state.hover ? 'pressed' : read(component.id, 'selected') === true ? 'selected' : state?.hover ? 'hover' : 'idle';
  };
  const { images, videos, spines } = prepareUiPropertyBatchMedia(project, pages.map(page => ({ components: page.components, instance: page.instance, displayed: displayed.includes(page), saveMode: page.saveMode })), target,
   { read: previous, geometry: previousGeometry, shown: (component, page) => shown(component, page, previous), imageState: component => imageState(component, previous, previousCancelledButtons) },
   { read: raw, geometry, shown, imageState }, { images: imageRequests, videos: videoRequests, spines: spineRequests });
  const focusAvailable = (request: { page: PreviewPage; componentId: string }) => {
   const component = componentById.get(request.componentId);
   return !!component && pageIsOpen(request.page) && interactive.includes(request.page) && !detailPage() && shown(component, request.page)
    && !geometry.get(request.componentId)?.clippedOut && usable(component) && raw(request.componentId, 'readOnly') !== true;
  };
  return { images, videos, spines, cancelButtons, clearPendingFocus: !!pendingInputFocus && (!pageIsOpen(pendingInputFocus.page) || pendingInputFocus.focused && !focusAvailable(pendingInputFocus)), clearFocus: !!inputFocus && !focusAvailable(inputFocus) };
 };
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
 const cancelRunner = (runner: Runner, reason = '所属生命周期结束或任务已取消，未继续后续步骤。') => {
  if (runner.cancelled) return;
  if (runner.taskHandle && !blueprintTaskFinished(tasks.get(runner.taskHandle)?.status ?? 'missing')) { finishTask(runner.taskHandle, 'cancelled', 'ownerClosed'); return; }
  taskReady.delete(runner); taskWaits.delete(runner);
  runner.cancel(reason);
  runner.cancelled = true;
  const stopped = runner.onStopped; runner.onStopped = undefined; stopped?.();
  stageWaits.delete(runner); running.delete(runner.label); runners.delete(runner);
  // Close the active generator at drive's next safe checkpoint instead of
  // re-entering it from a nested on-show callback.
  if (runner !== activeRunner) { runner.iterator.return(); resumes.push(...runner.deferred ?? []); runner.deferred = []; }
 };
 const finishPage = (page: PreviewPage, result: PreviewUiResult, done: (closed: boolean) => void = () => {}, force = true) => {
  if (!pageIsOpen(page)) { done(true); return; }
  page.closing = true;
  const notification = result && typeof result === 'object' ? result : uiPageCompletion(project, page.id, typeof result === 'string' ? result : '', result === false ? 'cancelled' : 'completed', page.outputs);
  const finish = () => {
   if (!pageIsOpen(page)) { done(true); return; }
   trace?.record(activeRunner?.traceStack() ?? [], { kind: 'page', pageId: page.id, pageInstance: page.instance, reason: '页面关闭：' + notification.reason, value: notification.result, available: true });
   for (const child of [...openPages].reverse()) if (child.parent === page) finishPage(child, uiPageCompletion(project, child.id, '', 'parentClosed'));
   if (page === root) rootOpen = false; else openPages.splice(openPages.indexOf(page), 1);
   page.focused = false; page.closeRequest = undefined;
   const ids = new Set(page.components.map(component => component.id));
   for (const task of [...tasks.values()]) if (task.owner === page) finishTask(task.handle, 'cancelled', 'ownerClosed');
   for (const runner of [...runners]) if (runner.owner === page) cancelRunner(runner, '页面实例关闭：' + notification.reason + '；未继续后续步骤。');
   for (const event of stageEvents) if (stageOwners.get(event) === page) event.cancelledAt ??= elapsed;
   for (const [key, animation] of animations) if (ids.has(animation.id) || animation.owner === page) { animations.delete(key); if (animation.done) resumes.push(animation.done); }
   for (const id of ids) { overrides.delete(id); optionOverrides.delete(id); imageRequests.delete(id); videoRequests.delete(id); spineRequests.delete(id); spineProblems.delete(id); }
   pageResults.push({ pageId: page.id, instance: page.instance, ...notification });
   syncButtonStates(); page.gallery = { pages: {} }; page.timers = [];
   const resume = page.resume; page.resume = undefined;
   dispatchLifecycle(page, 'closed', notification, () => { if (resume) resumes.push(() => resume(result)); syncTimers(); done(true); });
  };
  if (!force && page.focused) { page.focused = false; dispatchLifecycle(page, 'focusLost', undefined, ok => { if (ok || !pageIsOpen(page)) finish(); else { page.closing = false; syncPageFocus(); done(false); } }); }
  else finish();
 };
 const close = (pageId: string, result: string, reason: UiPageReason = 'completed', supplied: Record<string, VariableValue> = {}, done: (closed: boolean) => void = () => {}) => {
  const page = [root, ...openPages].find(page => pageIsOpen(page) && page.id === pageId && page.mode !== 'confirm');
  if (!page || page.closing || page.closeRequest) { done(false); return; }
  let proposed: UiPageCompletion;
  try { proposed = uiPageCompletion(project, pageId, result, reason, { ...page.outputs, ...supplied }); }
  catch (error) { incomplete(error instanceof Error ? error.message : String(error), { pageId }); done(false); return; }
  const requestId = ++page.requestSerial;
  page.closeRequest = { id: requestId, prevented: false };
  dispatchLifecycle(page, 'closeRequested', proposed, ok => {
   const request = page.closeRequest;
   if (!pageIsOpen(page) || request?.id !== requestId) { done(false); return; }
   page.closeRequest = undefined;
   if (!ok || request.prevented) { done(false); return; }
   try { const completion = uiPageCompletion(project, pageId, result, reason, { ...page.outputs, ...supplied }); finishPage(page, completion, done, false); }
   catch (error) { incomplete(error instanceof Error ? error.message : String(error), { pageId }); done(false); }
  }, requestId);
 };
 const cancel = (page: PreviewPage) => {
  if (page.mode === 'confirm') finishPage(page, false);
  else if (page.id === 'ui:voiceSettings' && uiActionAvailable(theme, 'preferences')) navigate('ui:preferences');
  else if (page.mode === 'menu' || !page.id.startsWith('ui:')) close(page.id, page.id.startsWith('ui:') ? '' : '取消', 'cancelled');
  else if (uiPage(project, page.id)?.menuScreen) close(page.id, '', 'cancelled', {}, closed => { if (closed) navigate(returnPageId); });
 };
 // Escape/right-click: a settings sub-page entered from 设置 steps back there;
 // one opened directly (for example by a blueprint menu call) closes like any menu.
 const back = (page: PreviewPage) => {
  if (page.id === 'ui:voiceSettings' && page.mode === 'menu' && page.enteredFrom !== 'ui:preferences') close(page.id, '', 'cancelled');
  else cancel(page);
 };
 const waitTrace = (runner: Runner, reason: string, seconds?: number) => { runner.traceWaiting = true; runner.observe({ kind: 'wait', reason, value: seconds, available: seconds !== undefined }); };
 const drive = (runner: Runner, result?: PreviewUiResult) => {
  if (exhausted || runner.cancelled) return;
  if (runner.owner && !pageIsOpen(runner.owner)) { cancelRunner(runner); return; }
  let finished = false;
  if (runner.taskHandle) { const task = tasks.get(runner.taskHandle); if (!task || blueprintTaskFinished(task.status)) return; task.status = 'running'; }
  taskReady.delete(runner); taskWaits.delete(runner);
  if (runner.traceWaiting) { runner.traceWaiting = false; runner.observe({ kind: 'resume', reason: result && typeof result === 'object' ? result.reason : '等待完成，继续原调用。', value: result && typeof result === 'object' ? result.result : result, available: result !== undefined }); }
  const caller=activeRunner;activeRunner=runner;
  runDepth++;
  try {
   let step = runner.iterator.next(result);
   while (!step.done && !exhausted && !runner.cancelled) {
    if (++invocations > uiPreviewTimerLimit) { exhaust('本次预演的节点／任务次数达到上限。'); return; }
    const request = step.value;
    let completion: PreviewUiResult = '';
    if (request.kind === 'taskCheckpoint') { taskReady.add(runner); return; }
    else if (request.kind === 'awaitTask') {
     const status = context.tasks!.result(request.handle, request.graphId).status;
     if (!blueprintTaskFinished(status)) {
      let dependency: string | undefined = request.handle;
      const seen = new Set<string>(runner.taskHandle ? [runner.taskHandle] : []);
      while (dependency) { if (seen.has(dependency)) break; seen.add(dependency); const dependencyRunner: Runner | undefined = tasks.get(dependency)?.runner; dependency = dependencyRunner ? taskWaits.get(dependencyRunner)?.handle : undefined; }
      if (dependency) { if (runner.taskHandle) finishTask(runner.taskHandle, 'failed', 'dependencyCycle'); else { stopRunner(runner, '任务等待形成循环依赖。'); finished = true; } return; }
      taskWaits.set(runner, { handle: request.handle, graphId: request.graphId }); waitTrace(runner, '等待独立任务完成或取消。'); return;
     }
    }
    else if(request.kind==='stage'){
     if(!options.timed){stopRunner(runner, '舞台演出需要开启按时间预演；未执行后续节点。');finished=true;break;}
     const event:UiStageEvent={at:elapsed,action:request.action};
     stageEvents.push(event); if(runner.owner)stageOwners.set(event,runner.owner);
     const timing=actionTiming(request.action);
     if(timing.wait&&timing.duration>0){stageWaits.set(runner,elapsed+timing.duration);waitTrace(runner, '等待舞台演出或延迟。', timing.duration);return;}
    }
    else if(request.kind==='playUiClip'){
     const clip=project.ui.animations?.find(a=>a.id===request.animationId);
     if(!clip||uiAnimationClipProblems(project,clip).length||typeof request.wait!=='boolean'||!validUiAnimationPlayback(request.playMode,request.loops,request.speed,request.fromCurrent)){
      stopRunner(runner, '界面动画片段缺失、轨道无效或播放参数不受支持，未执行后续节点。');finished=true;break;
     }
     const sources=clip.tracks.map(t=>get(t.componentId,t.property));
     if(sources.some(v=>typeof v!=='number')){stopRunner(runner, '界面动画的目标控件或数值属性不可用，未执行后续节点。');finished=true;break;}
     const parameterDrivers = new Set<string>();
     let controlsValid = true;
     for (const track of clip.tracks) {
      if (!writableSource(track.componentId, track.property)) { controlsValid = false; break; }
      const source = propertySource(track.componentId, track.property);
      if (source) {
       if (parameterDrivers.has(source.control.parameterId)) { sourceProblem(track.componentId, track.property, '同一动画片段的多条轨道不能同时驱动同一个参数。'); controlsValid = false; break; }
       parameterDrivers.add(source.control.parameterId);
      }
      if (track.keys.some(key => !!uiPropertyValueProblem(project, track.property, key.value))) { controlsValid = false; break; }
     }
     if (!controlsValid) { stopRunner(runner, '界面动画的属性控制来源不允许此次播放；没有修改任何轨道。'); finished = true; break; }
     const previous=clip.tracks.map(t=>animations.get(animationKey(t.componentId,t.property))),first=previous[0];
     const continuing=!!request.fromCurrent&&!!first?.playback&&previous.every(a=>a?.clip===clip.id&&a.playback===first.playback);
     const position=continuing?uiAnimationPlaybackTime(first!.playback!,elapsed-first!.start):undefined;
     const playback:UiAnimationPlayback={clipDuration:clip.duration,mode:request.playMode as UiAnimationPlayback['mode'],loops:Number(request.loops),speed:Number(request.speed),offset:position===undefined?0:request.playMode==='reverse'?clip.duration-position:position};
     const duration=uiAnimationPlaybackDuration(playback),endTime=playback.mode==='forward'?clip.duration:0;
     const prepared = clip.tracks.map((track, index) => {
      const from = continuing ? previous[index]!.from : Number(sources[index]);
      return { track, from, to: sampleUiAnimationTrack(track, endTime, from), parameterId: propertySource(track.componentId, track.property)?.control.parameterId };
     });
     const endValues = Object.fromEntries(prepared.filter(item => item.parameterId).map(item => [item.parameterId!, item.to]));
     const startValues = Object.fromEntries(prepared.filter(item => item.parameterId).map(item => [item.parameterId!, sampleUiAnimationTrack(item.track, uiAnimationPlaybackTime(playback, 0), item.from)]));
     const sampledTimes = new Set([0, clip.duration, ...clip.tracks.flatMap(track => track.keys.map(key => key.time))]);
     const samplesValid = [...sampledTimes].every(time => {
      const pending = Object.fromEntries(prepared.filter(item => item.parameterId).map(item => [item.parameterId!, sampleUiAnimationTrack(item.track, time, item.from)]));
      return prepared.every(item => parameterWritesValid(pending, { id: item.track.componentId, values: { [item.track.property]: sampleUiAnimationTrack(item.track, time, item.from) } }));
     });
     if (!samplesValid || !parameterWritesValid(startValues) || !parameterWritesValid(endValues)) { stopRunner(runner, '界面动画的关键值不适用于关联参数的读者；没有修改任何轨道。'); finished = true; break; }
     stopPlayback(clip.id,false);
     let remaining=clip.tracks.length;
     const done=()=>{if(--remaining===0)drive(runner);};
     for(const {track,from,to,parameterId} of prepared){
      stopAnimation(track.componentId,track.property,false);
      if (parameterId) for (const animation of [...animations.values()]) if (animation.parameterId === parameterId) stopAnimation(animation.id, animation.property, false);
      if(options.timed&&duration>0)animations.set(animationKey(track.componentId,track.property),{id:track.componentId,property:track.property,from,to,start:elapsed,duration,easing:'linear',track,clip:clip.id,playback,owner:runner.owner,taskHandle:runner.taskHandle,parameterId,...(request.wait?{done}: {})});
     }
     if (!options.timed || duration === 0) {
      writeParameters(Number.isFinite(duration) ? endValues : startValues);
      for (const { track, from, to, parameterId } of prepared) {
       const values = { ...overrides.get(track.componentId) };
       if (parameterId) delete values[track.property];
       else values[track.property] = Number.isFinite(duration) ? to : sampleUiAnimationTrack(track, uiAnimationPlaybackTime(playback, 0), from);
       overrides.set(track.componentId, values);
      }
      syncInputFocus();
     }
     sampleParameterAnimations();
     if(duration>0&&clip.tracks.length&&request.wait){
      if(options.timed){waitTrace(runner, '等待界面动画片段。', duration);return;}
      if(!Number.isFinite(duration)){stopRunner(runner, '循环动画无法在非计时预演中等到完成，请开启按时间预演。');finished=true;break;}
     }
    }
    else if(request.kind==='animateUi'){
     const source=get(request.componentId,request.property);
     if(typeof source!=='number'||!validUiAnimation(request.property,request.value,request.duration,request.easing)||uiPropertyValueProblem(project,request.property,request.value)||typeof request.wait!=='boolean'||!writableSource(request.componentId,request.property)){
      stopRunner(runner, '属性动画的目标、目标值、时长或缓动参数无效，未执行后续节点。');finished=true;break;
     }
     const parameterId = propertySource(request.componentId, request.property)?.control.parameterId;
     if (parameterId && !parameterWritesValid({ [parameterId]: request.value! }, { id: request.componentId, values: { [request.property]: request.value! } })) { stopRunner(runner, '属性动画的目标值不适用于关联参数的读者。'); finished = true; break; }
     stopAnimation(request.componentId,request.property,false);
     if (parameterId) for (const animation of [...animations.values()]) if (animation.parameterId === parameterId) stopAnimation(animation.id, animation.property, false);
     const duration=Number(request.duration),target=Number(request.value);
     if(!options.timed||duration===0||source===target)context.ui!.set(request.componentId,request.property,target);
     else{
      animations.set(animationKey(request.componentId,request.property),{id:request.componentId,property:request.property,from:source,to:target,start:elapsed,duration,easing:request.easing as UiAnimationEasing,owner:runner.owner,taskHandle:runner.taskHandle,parameterId,...(request.wait?{done:()=>drive(runner)}:{})});
      if(request.wait){waitTrace(runner, '等待界面属性动画。', duration);return;}
     }
    }
    else if (request.kind === 'closePage') {
     let synchronous = true, completed = false;
     close(request.pageId, request.result, request.reason, request.outputs, () => { if (synchronous) completed = true; else resumes.push(() => drive(runner)); });
     synchronous = false;
     if (!completed) { waitTrace(runner, '等待页面关闭请求处理完成。'); return; }
    }
    else if (request.kind === 'confirm' || request.kind === 'menu') {
     if (request.kind === 'menu' && request.screen === 'save' && host === 'title') { stopRunner(runner, '标题宿主没有可保存的游戏进度；请选择读取存档。'); finished = true; break; }
     const id = request.kind === 'confirm' ? 'messageBox' : uiScreenPages[request.screen];
     if (request.kind === 'menu' && (!id || !uiPage(project, 'ui:' + id)?.menuScreen || !uiScreenAvailable(theme, request.screen))) {
      stopRunner(runner, '要打开的菜单已停用或不存在。'); finished = true; break;
     }
     const custom = id === 'messageBox' && !theme.disabledPages?.includes('messageBox') && theme.pages?.messageBox?.layout === 'custom';
     const page = makePage('ui:' + id, effectiveUiComponents(project.ui).filter(c=>c.page===id && !theme.disabledPages?.includes(c.page)), request.kind);
     page.parent = active();
     page.resume = value => drive(runner,value);
     if(request.kind==='confirm'){page.message=request.message;page.nativeConfirm=!custom;}
     else if(request.screen==='save'||request.screen==='load')page.saveMode=request.screen;
     waitTrace(runner, request.kind === 'confirm' ? '等待确认结果。' : '等待菜单关闭。');
      openPages.push(page); syncButtonStates(); syncTimers(); show(page); return;
    }
    else if (request.kind === 'openPage') {
     if (request.pageId === 'ui:save' && request.saveMode === 'save' && host === 'title') { stopRunner(runner, '标题宿主没有可保存的游戏进度；请选择读取存档。'); finished = true; break; }
     const existing = [root, ...openPages].find(p => pageIsOpen(p) && p.id === request.pageId);
     completion = uiPageCompletion(project, request.pageId, '', existing ? 'alreadyOpen' : 'shown');
     if (existing && openPages.includes(existing)) {
      const family = new Set([existing]);
      for (const page of openPages.slice(openPages.indexOf(existing) + 1)) if (page.parent && family.has(page.parent)) family.add(page);
      if (!openPages.slice(openPages.indexOf(existing) + 1).some(page => page.modal && !family.has(page))) {
       const moving = openPages.filter(page => family.has(page));
       openPages.splice(0, openPages.length, ...openPages.filter(page => !family.has(page)), ...moving); syncTimers();
      }
     }
     if (!existing) {
      const definition = uiPage(project, request.pageId);
      if (!definition || uiPageOpenProblem(project, request.pageId, request.wait, request.modal === false ? 'modeless' : 'page')) { stopRunner(runner, !definition ? '要打开的页面已不存在。' : uiPageOpenProblem(project, request.pageId, request.wait, request.modal === false ? 'modeless' : 'page')!); finished = true; break; }
      const page = makePage(definition.id, uiPageComponents(project, definition.id), definition.template ? 'menu' : request.wait ? 'waiting' : 'shown', request.inputs);
      page.saveMode = request.saveMode;
      page.opening = resolveUiPageOpening(project, page.id, { wait: request.wait, ...(request.modal === undefined ? {} : { input: request.modal ? 'block' : 'controls' }), ...request.opening });
      page.parent = page.opening.lifetime === 'owner' ? runner.owner : undefined; page.modal = page.opening.input === 'block';
      if (request.wait) { page.resume = value => drive(runner, value); waitTrace(runner, '等待页面关闭或返回结果。'); }
      openPages.push(page); syncButtonStates(); syncTimers(); show(page);
      if (request.wait) return;
     }
    }
    if (runner.cancelled) break;
    step = runner.iterator.next(completion);
   }
   finished = finished || !!step.done;
  } finally {
   if (runner.taskHandle && !finished && !runner.cancelled && !taskReady.has(runner) && !exhausted) { const task = tasks.get(runner.taskHandle); if (task && !blueprintTaskFinished(task.status)) task.status = 'waiting'; }
   activeRunner=caller;
   if (runner.cancelled) runner.iterator.return();
   if (finished || runner.cancelled) {
    taskReady.delete(runner); taskWaits.delete(runner);
    running.delete(runner.label); runners.delete(runner); stageWaits.delete(runner);
    if (!runner.cancelled) runner.done();
    resumes.push(...runner.deferred??[]);runner.deferred=[];
   }

   runDepth--; flush();
  }
 };
 const run = (graphId: string, eventId?: string, done: () => void = () => {}, eventData?:Record<string,VariableValue>, sourcePage?: PreviewPage, eventTrigger?: string, lifecycle?: PreviewLifecycle, onStopped?: () => void) => {
  if (++invocations > uiPreviewTimerLimit) { exhaust('本次预演的事件／任务次数达到上限。', { graphId, nodeId: eventId, pageId: sourcePage?.id, pageInstance: sourcePage?.instance }); return; }
  const graph = projectGraphs(project).find(g => g.id === graphId); if (!graph) { incomplete('事件要调用的蓝图已不存在。', { graphId, pageId: sourcePage?.id, pageInstance: sourcePage?.instance, componentId: triggerComponent }); if (onStopped) onStopped(); else done(); return; }
  const event = eventId ? graph.nodes.find(node => node.id === eventId) : undefined;
  const owner = lifecycle?.phase === 'closed' ? undefined : sourcePage ?? layers().find(p => graph.uiPageId === p.id || event?.properties.componentId && p.components.some(c => c.id === event.properties.componentId)) ?? activeRunner?.owner ?? active();
  if (owner && !pageIsOpen(owner)) { onStopped?.(); return; }
  const label = JSON.stringify([graphId, eventId, sourcePage?.instance ?? owner?.instance, lifecycle?.phase]);
  // An ordinary event stays busy while its page is open, so a page its own handler
  // opened (such as a second confirmation) cannot run it again. A closed page's
  // unfinished run does not block a newly opened page.
  // Page-show callbacks belong to their page instance, like lifecycle callbacks, so
  // two pages that share a show graph each run it. Button callbacks and blueprint
  // actions also have no event node but stay busy, as in the game.
  const pageShow = !eventId && eventTrigger === '页面显示';
  const eventKey = lifecycle || pageShow ? undefined : JSON.stringify([graphId, eventId]);
  if (running.has(label) || eventKey && [...runners].some(item => item.eventKey === eventKey && !item.cancelled && (!item.owner || pageIsOpen(item.owner)))) { trace?.record([], { kind: 'stop', graphId, nodeId: eventId, pageId: owner?.id, pageInstance: owner?.instance, reason: '同一页面事件仍在执行，重复触发已忽略。' }); done(); return; }
  const location = { pageId: sourcePage?.id ?? owner?.id, pageInstance: sourcePage?.instance ?? owner?.instance, componentId: typeof event?.properties.componentId === 'string' ? event.properties.componentId : triggerComponent,
    trigger: eventTrigger ?? event?.type ?? trigger, parentStack: activeRunner?.traceStack() };
   trace?.record(location.parentStack ?? [], { kind: 'event', graphId, nodeId: eventId ?? graph.nodes.find(node => node.type === 'event')?.id, pageId: owner?.id, pageInstance: owner?.instance, componentId: location.componentId, trigger: location.trigger, reason: '触发蓝图事件' });
   const sampled = event ? { ...graph, nodes: [{ ...event, type: 'event' as const }, ...graph.nodes.filter(node => node.id !== event.id)] } : graph;
  running.add(label);
  const runner: Runner = { ...previewActionRunner(withProjectGraphs({ ...project }, projectGraphs(project).map(g => g.id === graphId ? sampled : g)), [{ kind: 'blueprint', blueprintId: graphId }], context,undefined,eventData&&eventId?{graphId,nodeId:eventId,...eventData}:undefined,undefined,location), label, eventKey, done: () => { if (lifecycle && runner.failed()) { const stopped = runner.onStopped; runner.onStopped = undefined; stopped?.(); } else done(); }, owner, lifecycle, onStopped };
  runners.add(runner); drive(runner);
 };
 const dispatchLifecycle = (page: PreviewPage, phase: UiPageLifecyclePhase, completion: UiPageCompletion | undefined, done: (ok: boolean) => void = () => {}, requestId?: number) => {
  const handlers = uiPageLifecycleHandlers(project, page.id, phase);
  const snapshot = completion ? { ...completion, ...(completion.outputs ? { outputs: { ...completion.outputs } } : {}) } : undefined;
  const lifecycle: PreviewLifecycle = { phase, page, completion: snapshot, inputs: { ...page.inputs }, requestId };
  const data = { result: completion?.result ?? '', reason: completion?.reason ?? '', ...Object.fromEntries(Object.entries(completion?.outputs ?? page.outputs).map(([id, value]) => ['out_' + id, value])) };
  let index = 0, settled = false, failed = false;
  const settle = (ok: boolean) => { if (!settled) { settled = true; done(ok); } };
  const next = () => {
   if (settled) return;
   if (exhausted || phase !== 'closed' && !pageIsOpen(page)) { settle(false); return; }
   const handler = handlers[index++]; if (!handler) { settle(!failed); return; }
   run(handler.graphId, handler.nodeId, next, data, page, uiPageLifecyclePhases[phase].name, lifecycle, () => { if (phase === 'closed') { failed = true; next(); } else settle(false); });
  };
  next();
 };
 let syncingFocus = false;
 syncPageFocus = () => {
  if (syncingFocus) return;
  const target = active(), focused = [root, ...openPages].filter(page => page.focused);
  const desired = target?.createdReady && !target.closing && pageIsOpen(target) ? target : undefined;
  if (focused.length === (desired ? 1 : 0) && (!desired || focused[0] === desired)) return;
  syncingFocus = true;
  const remaining = focused.filter(page => page !== desired);
  const next = () => {
   const previous = remaining.shift();
   if (previous) { previous.focused = false; dispatchLifecycle(previous, 'focusLost', undefined, next); return; }
   const current = active();
   if (current?.createdReady && !current.closing && pageIsOpen(current) && !current.focused) {
    current.focused = true;
    dispatchLifecycle(current, 'focusGained', undefined, () => { syncingFocus = false; syncPageFocus(); });
   } else { syncingFocus = false; }
  };
  next();
 };
 const sequence = (steps: ((next: () => void) => void)[], owner?: PreviewPage) => {
  let index = 0;
  const next = () => { if(exhausted || index >= steps.length || owner && !pageIsOpen(owner))return; runDepth++; try { steps[index++](next); } finally { runDepth--; flush(); } };
  next();
 };
 const checkComponents = (page: PreviewPage) => {
  for (const c of page.components) {
   const simple = ['text', 'button', 'image', 'panel', 'progress', 'spine', 'video', 'galleryGrid', 'voiceCollection', 'musicTrackList', 'historyList'].includes(c.kind);
   const parameter = ['preference', 'preferenceChoice'].includes(c.kind) && (project.variables.some(v => v.id === c.parameterId) || (!c.parameterId && c.preference && (c.preference !== 'characterVolume' || !c.preferenceCharacterId || project.characters.some(char => char.id === c.preferenceCharacterId))));
   if (!simple && !parameter) incomplete('此控件类型或参数绑定尚不支持页面预演，请在实际游戏中验证。', { pageId: page.id, pageInstance: page.instance, componentId: c.id });
   if (c.kind === 'button' && c.shortcut && !uiPreviewShortcutKey(c.shortcut)) incomplete('按钮快捷键尚不支持页面预演，请在实际游戏中验证。', { pageId: page.id, pageInstance: page.instance, componentId: c.id });
   for (const [property, control] of Object.entries(c.propertyControls ?? {})) {
    const problem = uiPropertyControlSourceProblem(project, c, property, control);
    if (problem) sourceProblem(c.id, property, problem);
    else get(c.id, property);
   }
  }
 };
 const show = (page: PreviewPage) => {
  if (page.interfaceProblem) return;
  if (page.opening.autoClose > 0) page.autoCloseAt = elapsed + page.opening.autoClose;
  trace?.record(activeRunner?.traceStack() ?? [], { kind: 'page', pageId: page.id, pageInstance: page.instance, reason: '页面显示' });
  checkComponents(page);
  page.timers = projectGraphs(project).flatMap(graph => graph.nodes.filter(node => node.type === 'eventTimer' && uiGraphOnPage(project,graph,page.id) && node.properties.pageId === page.id && uiEventInActiveInstance(project, node)).flatMap(node => {
   const interval = node.properties.interval ?? 1;
   if (typeof interval !== 'number' || !Number.isFinite(interval) || interval <= 0) { incomplete('定时事件间隔必须是大于零的有限秒数。', { graphId: graph.id, nodeId: node.id, pageId: page.id, pageInstance: page.instance }); return []; }
   return [{ graphId: graph.id, nodeId: node.id, interval, start: elapsed, next: elapsed + interval, count: 1, repeat: node.properties.repeat !== false }];
  }));
  const ids = uiPageShowGraphIds(project, page.id);
  const onShow = () => {
   if (!pageIsOpen(page)) return;
   sequence([...ids].filter((id):id is string=>!!id).map(id=>next=>run(id,undefined,next,undefined,page,'页面显示')), page);
   syncPageFocus();
  };
  if (page.created) onShow();
  else { page.created = true; dispatchLifecycle(page, 'created', undefined, ok => { if (ok) { page.createdReady = true; onShow(); } }); }
 };
 const normalizeVoices=()=>{for(const page of [root,...openPages])for(const component of page.components.filter(c=>c.kind==='voiceCollection')){const view=voiceCollectionView(project,component,voice,page.voice[component.id],voiceUnlocks);page.voice[component.id]={page:view.page,favoritesOnly:view.favoritesOnly};}};
 const update = (tickInputs = true) => {
  normalizeVoices();syncButtonStates();
  if (!options.timed && tickInputs) for (const page of layers()) for (const timer of page.timers) if (pageIsOpen(page) && !exhausted) run(timer.graphId, timer.nodeId, undefined, undefined, page);
  applyInputFocus(); syncImageRequests(); syncVideoRequests(); syncSpineRequests();
 };
 const navigate = (target: string, mode?: 'save' | 'load') => {
  if (uiPage(project, target)?.disabled) { incomplete('要打开的页面已停用。', { pageId: target }); return; }
  if (target === 'ui:save' && mode === 'save' && host === 'title') { incomplete('标题宿主没有可保存的游戏进度；请选择读取存档。', { pageId: target }); return; }
  const menu = [...openPages].reverse().find(p=>p.mode==='menu'), current = menu ?? root;
  if(target===current.id&&mode===current.saveMode&&(menu||rootOpen))return;
  const next = makePage(target,target===initialPageId?initialComponents:effectiveUiComponents(project.ui).filter(c=>'ui:'+c.page===target),menu?'menu':'root');
  next.saveMode=mode;next.enteredFrom=current.id;
  // Replacing a menu is a real page exit, not a reassignment of its layout.
  // Keep the external menu call suspended, but cancel the old page's work and
  // children before displaying a fresh instance (including save -> load).
  const index = menu ? openPages.indexOf(menu) : -1, resume = current.resume;
  current.resume = undefined; next.parent = current.parent;
  finishPage(current, uiPageCompletion(project, current.id, '', 'navigated'));
  // Keep the original menu caller suspended, without publishing a replacement's result.
  next.resume = resume ? () => resume(uiPageCompletion(project, current.id, '', 'navigated')) : undefined;
  if (menu) openPages.splice(Math.min(index, openPages.length), 0, next);
  else { root = next; rootOpen = true; }
  syncTimers();show(next);
 };
 const nextTaskTime = () => Math.min(...[...tasks.values()].filter(task => task.status === 'queued').map(task => task.due ?? Infinity), taskReady.size ? nextTaskPump : Infinity);
 const pumpTasks = () => {
  for (const task of [...tasks.values()]) if (task.status === 'queued' && (task.due ?? Infinity) <= elapsed + 1e-9 && task.submission) {
   if (task.owner && !pageIsOpen(task.owner) || task.submission.scope === 'call' && !task.submission.call.alive) { finishTask(task.handle, 'cancelled', 'ownerClosed'); continue; }
   const runner: Runner = { ...previewActionRunner(project, [{ kind: 'blueprint', blueprintId: task.submission.graphId, inputs: task.submission.inputs }], context, undefined, undefined, undefined, { pageId: task.owner?.id, pageInstance: task.owner?.instance, trigger: '后台任务', parentStack: [] }, { cooperative: true }), owner: task.owner, label: task.handle, taskHandle: task.handle, done: () => { finishTask(task.handle, runner.failed() ? 'failed' : 'completed', runner.failureReason() ?? 'completed', runner.outputs(task.graphId!)); } };
   task.runner = runner; task.status = 'running'; runners.add(runner); drive(runner);
  }
  let budget = 64;
  while (budget && taskReady.size) {
   const ready = [...taskReady];
   for (const runner of ready) { if (!budget) break; if (taskReady.has(runner)) { drive(runner); budget--; } }
  }
  nextTaskPump = elapsed + .02;
  flush();
 };
 const advance = (seconds: number) => {
  if (!options.timed || !Number.isFinite(seconds) || seconds < 0) { incomplete('推进时间需要开启按时间预演，且秒数必须为非负有限值。'); return; }
  const target = Math.min(uiPreviewDurationLimit, elapsed + seconds);
  while (!exhausted) {
   let next: PreviewTimer | undefined;
   for (const page of layers()) for (const timer of page.timers) if (timer.next <= target + 1e-9 && (!next || timer.next < next.next - 1e-9)) next = timer;
   const end=Math.min(...[...animations.values()].map(a=>a.start+a.duration));
   const stageEnd=Math.min(...stageWaits.values());
   const taskAt = nextTaskTime();
   const closeAt = Math.min(...layers().map(page => page.autoCloseAt ?? Infinity));
   const at=Math.min(next?.next??Infinity,end,stageEnd,taskAt,closeAt);
   if(at>target+1e-9)break;
   if (fired >= uiPreviewTimerLimit) { exhaust('计时事件或动画完成次数达到本次预演上限。'); return; }
   elapsed=Math.max(elapsed,at);fired++;sampleParameterAnimations();
   for (const page of [...layers()].reverse()) if (page.autoCloseAt !== undefined && page.autoCloseAt <= elapsed + 1e-9) { delete page.autoCloseAt; close(page.id, '完成', 'completed'); }
   for(const [runner,until] of [...stageWaits])if(until<=elapsed+1e-9){stageWaits.delete(runner);drive(runner);}
   for(const animation of [...animations.values()])if(animation.start+animation.duration<=elapsed+1e-9)stopAnimation(animation.id,animation.property,true);
   flush();
   if (nextTaskTime() <= elapsed + 1e-9) pumpTasks();
   // Completion may close a page or install a new animation before its timer.
   if(next&&next.next<=elapsed+1e-9&&layers().some(p=>p.timers.includes(next!))){
    next.next=next.repeat?next.start+(++next.count)*next.interval:Infinity;
    run(next.graphId,next.nodeId,undefined,undefined,layers().find(p=>p.timers.includes(next!)));
   }
   applyInputFocus(); syncImageRequests(); syncVideoRequests(); syncSpineRequests();
  }
  if (exhausted) return;
  elapsed = target; sampleParameterAnimations(); applyInputFocus(); syncImageRequests(); syncVideoRequests(); syncSpineRequests(); if (target >= uiPreviewDurationLimit) exhaust('本次预演达到 60 秒时长上限。');
 };
 const locate = (componentId: string) => {
  for (const page of [...interactivePages()].reverse()) { const component = page.components.find(c => c.id === componentId); if (component) return { page, component }; }
 };
 const click = (page: PreviewPage, component: UiComponent) => {
  if (!pageIsOpen(page)||!interactivePages().includes(page)||detailPage()||component.kind !== 'button' || !visible(component, page) || get(component.id, 'enabled') === false) return;
  const sound = String(get(component.id, 'clickSound') ?? '');
  const soundProblem = uiPropertyValueProblem(project, 'clickSound', sound);
  if (soundProblem) { incomplete(soundProblem, { pageId: page.id, pageInstance: page.instance, componentId: component.id }); return; }
  clickFeedback.push({ sequence: clickFeedback.length + 1, assetId: sound, componentId: component.id, pageId: page.id, pageInstance: page.instance });
  const steps: ((next: () => void) => void)[] = [];
  for (const handler of uiClickHandlers(project, page.id, component.id)) steps.push(next => run(handler.graphId, handler.nodeId, next, undefined, page));
  if (component.action !== 'blueprint') steps.push(next=>{
   if (component.action === 'setPlayerPreference' && component.preference && setPreference(component.preference, component.preferenceValue, component.preferenceCharacterId)) {}
   else if(component.action==='window'||component.action==='fullscreen')setPreference('fullscreen',component.action==='fullscreen');
   else if(component.action==='skipSeen'||component.action==='skipAll')setPreference('skipAll',component.action==='skipAll');
   else if(isMusicControl(component.action)){music=musicPreviewAction(music,unlockedMusic(),component.action);if(music.playback&&musicOwner===undefined)musicOwner={instance:page.instance,pageId:page.id};}
   else if(component.action==='mute')muted=!muted;
   else if(component.action==='transitions')transitions=!transitions;
   else if(component.action==='resetPreferences'){
    const custom=!theme.disabledPages?.includes('messageBox')&&theme.pages?.messageBox?.layout==='custom';
    const confirmation=makePage('ui:messageBox',effectiveUiComponents(project.ui).filter(c=>c.page==='messageBox'&&!theme.disabledPages?.includes(c.page)),'confirm');
    confirmation.parent=page;confirmation.message='恢复全部初始设置吗？';confirmation.nativeConfirm=!custom;
    confirmation.resume=value=>{if(value===true){const initial=Object.fromEntries(parametersResetWithSettings(project).map(variable=>[variable.id,variable.initial]));if(writeParameters(initial)){context.preferences={...preferenceDefaults};context.characterVolumes={};muted=false;}}next();};
    openPages.push(confirmation);syncButtonStates();syncTimers();show(confirmation);return;
   }
   else if(component.action==='mainMenu'){
     host='title';returnPageId='ui:main';
    for (const oldPage of [root, ...openPages].reverse()) finishPage(oldPage, { result: '', reason: 'navigated' });
    for (const runner of [...runners]) cancelRunner(runner);
    runners.clear();running.clear();openPages.length=0;stageWaits.clear();animations.clear();overrides.clear();optionOverrides.clear();resumes.length=0;
    root=makePage('ui:main',initialPageId==='ui:main'?initialComponents:effectiveUiComponents(project.ui).filter(c=>c.page==='main'),'root');rootOpen=true;syncTimers();show(root);
   }
   else if (component.action && uiActionPages[component.action]) navigate('ui:' + uiActionPages[component.action], component.action === 'save' || component.action === 'load' ? component.action : undefined);
   else if (page.mode==='confirm' && (component.action==='confirmYes'||component.action==='confirmNo')) finishPage(page, component.action==='confirmYes');
   else if (component.action === 'return') { if (page.id.startsWith('ui:')) cancel(page); else close(page.id, '', 'completed'); }
   else if (component.action) incomplete('此按钮的系统操作尚不支持页面预演，请在实际游戏中验证：' + component.action, { pageId: page.id, pageInstance: page.instance, componentId: component.id });
   next();
  });
  sequence(steps, page);
 };
 const buttonEvent=(page:PreviewPage,c:UiComponent,trigger:UiButtonEvent,done:()=>void=()=>{})=>{
  if(detailPage()||c.kind!=='button'||!pageIsOpen(page)||!interactivePages().includes(page)||!visible(c,page)||!enabled(c)){done();return;}
  const handlers=projectGraphs(project).flatMap(g=>uiGraphOnPage(project,g,page.id)?g.nodes.filter(n=>n.type==='eventButton'&&n.properties.componentId===c.id&&n.properties.trigger===trigger&&uiEventInActiveInstance(project,n)).map(n=>({g,n})):[]);
  sequence([...handlers.map(({g,n})=>(next:()=>void)=>run(g.id,n.id,next,undefined,page)),()=>done()], page);
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
 let inputCount = 0, imageReportCount = 0;
 for (const event of events) {
  if (event.kind === 'image' || event.kind === 'video' || event.kind === 'spine' ? ++imageReportCount > uiPreviewImageReportLimit : ++inputCount > 256) {
   incomplete(event.kind === 'image' || event.kind === 'video' || event.kind === 'spine' ? '本次媒体反馈超过 8192 条；请恢复测试值，并检查是否在媒体事件中循环换图或重播。' : '本次预演操作超过 256 条；请恢复测试值后继续。'); break;
  }
  trigger = event.kind === 'button' ? event.trigger : event.kind;
  triggerComponent = 'componentId' in event ? event.componentId : undefined;
  if (event.kind !== 'advance') trace?.record([], { kind: 'event', pageId: active()?.id, pageInstance: active()?.instance, componentId: triggerComponent, trigger, reason: '预演输入' });
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
  if (event.kind === 'advance') { advance(event.seconds); syncButtonStates(); syncImageRequests(); syncVideoRequests(); syncSpineRequests(); continue; }
  if (event.kind === 'spine') {
   const page = [root, ...openPages].find(page => pageIsOpen(page) && page.instance === event.pageInstance && page.components.some(c => c.id === event.componentId && c.kind === 'spine'));
   const request = spineRequestForId(event.componentId);
   if (!page || !request) continue;
   const accepted = acceptUiSpineReport(request, event); if (!accepted) continue;
   spineRequests.set(event.componentId, accepted);
   if (event.status === 'completed' || event.status === 'failed') {
    const handlers = projectGraphs(project).flatMap(g => uiGraphOnPage(project, g, page.id) ? g.nodes.filter(n => n.type === 'eventSpine' && n.properties.componentId === event.componentId && n.properties.trigger === event.status && uiEventInActiveInstance(project, n)).map(n => ({ g, n })) : []);
    const payload = { assetId: accepted.assetId, animation: accepted.animation, skin: accepted.skin, position: accepted.position, duration: accepted.duration, error: accepted.error };
    sequence(handlers.map(({ g, n }) => next => run(g.id, n.id, next, payload, page)), page);
   }
   update(false); continue;
  }
  if (event.kind === 'video') {
   const page = [root, ...openPages].find(page => pageIsOpen(page) && page.instance === event.pageInstance && page.components.some(c => c.id === event.componentId && c.kind === 'video'));
   const request = videoRequestForId(event.componentId);
   if (!page || !request) continue;
   const accepted = acceptUiVideoReport(request, event); if (!accepted) continue;
   videoRequests.set(event.componentId, accepted);
   if (event.status === 'ended' || event.status === 'failed') {
    const handlers = projectGraphs(project).flatMap(g => uiGraphOnPage(project, g, page.id) ? g.nodes.filter(n => n.type === 'eventVideo' && n.properties.componentId === event.componentId && n.properties.trigger === event.status && uiEventInActiveInstance(project, n)).map(n => ({ g, n })) : []);
    const payload = { assetId: accepted.assetId, position: accepted.position, duration: accepted.duration, durationKnown: accepted.durationKnown, error: accepted.error };
    sequence(handlers.map(({ g, n }) => next => run(g.id, n.id, next, payload, page)), page);
   }
   update(false); continue;
  }
  if (event.kind === 'image') {
   const page = [root, ...openPages].find(page => pageIsOpen(page) && page.instance === event.pageInstance && page.components.some(c => c.id === event.componentId && c.kind === 'image'));
   const component = page?.components.find(c => c.id === event.componentId), request = imageRequestForId(event.componentId);
   if (!page || !component || !request || !layers().includes(page) || !visible(component, page)) continue;
   const accepted = acceptUiImageReport(request, event); if (!accepted) continue;
   imageRequests.set(component.id, accepted);
   const handlers = projectGraphs(project).flatMap(g => uiGraphOnPage(project, g, page.id) ? g.nodes.filter(n => n.type === 'eventImage' && n.properties.componentId === component.id && n.properties.trigger === event.status && uiEventInActiveInstance(project, n)).map(n => ({ g, n })) : []);
   const payload = { assetId: accepted.assetId, error: accepted.error, width: accepted.width, height: accepted.height };
   sequence(handlers.map(({ g, n }) => next => run(g.id, n.id, next, payload, page)), page);
   update(false); continue;
  }
  const detail = detailPage();
  if (detail && ['click', 'button', 'control', 'textCommit', 'key', 'gallery', 'cancelPage', 'confirm', 'voice', 'music', 'history', 'scroll'].includes(event.kind)) {
   const component = detail.components.find(c => c.id === detail.gallery.detail!.componentId);
   const keyActions: Record<string, 'close' | 'previous' | 'next'> = { K_ESCAPE: 'close', K_LEFT: 'previous', K_RIGHT: 'next' };
   const action = event.kind === 'key' && keyActions[event.key];
   if (component && event.kind === 'gallery' && event.componentId === component.id) detail.gallery = galleryPreviewAction(project, component, detail.gallery, event, options.galleryUnlocks, context.variables);
   else if (component && action) detail.gallery = galleryPreviewAction(project, component, detail.gallery, { action }, options.galleryUnlocks, context.variables);
   update(); continue;
  }
  if(event.kind==='confirm'){const page=active();if(page?.mode==='confirm'&&page.instance===event.requestId){finishPage(page,event.value);flush();}}
  else if (event.kind === 'cancelPage') { const page=[...interactivePages()].reverse().find(page => page.opening.closeOnEscape);if(page?.id===event.pageId){back(page);flush();} }
  else if (event.kind === 'parameter') {
   const variable = project.variables.find(v => v.id === event.id);
   if (!variable || typeof event.value !== variableValueType(variable) || typeof event.value === 'number' && !Number.isFinite(event.value)) { incomplete('测试参数已不存在，或输入值与其类型不匹配。', { variableId: event.id }); continue; }
   if (!writeParameter(event.id, event.value)) incomplete('测试参数值不适用于当前关联属性，原值已保留。', { variableId: event.id });
  } else if (event.kind === 'key') {
   if (!Object.hasOwn(blueprintKeyNames, event.key)) { incomplete('该按键尚不支持页面预演：' + event.key); continue; }
   for (const page of [...interactivePages()].reverse()) {
    const shortcut = uiPaintOrder(page.components).reverse().find(c => c.kind === 'button' && uiPreviewShortcutKey(c.shortcut) === event.key && visible(c, page) && !geometryFor(c.id)?.clippedOut);
    if (shortcut) { click(page, shortcut); break; }
    const handlers = projectGraphs(project).flatMap(graph => graph.nodes.filter(n => n.type === 'eventKey' && uiGraphOnPage(project,graph,page.id) && n.properties.pageId === page.id && String(n.properties.key ?? 'K_SPACE') === event.key && uiEventInActiveInstance(project, n)).map(node => ({ graph, node })));
    if (handlers.length) { sequence(handlers.map(({graph,node})=>next=>run(graph.id,node.id,next,undefined,page)), page); break; }
    if (event.key === 'K_ESCAPE' && page.opening.closeOnEscape && (page.mode==='confirm'||page.mode==='menu'||page.nativeLayout && page.id !== 'ui:main'||!page.id.startsWith('ui:'))) { back(page); flush(); break; }
   }
  } else {
   const found = locate(event.componentId); if (!found || !visible(found.component,found.page) || geometryFor(found.component.id)?.clippedOut || !enabled(found.component)) { trace?.record([], { kind: 'stop', componentId: event.componentId, pageId: found?.page.id, pageInstance: found?.page.instance, trigger, reason: !found ? '控件不存在或不在可交互页面。' : '控件隐藏或不可用，事件未触发。' }); continue; }
   const { page, component } = found;
   if ('pageInstance' in event && event.pageInstance !== undefined && event.pageInstance !== page.instance) continue;
   if (event.kind === 'button') {if(event.trigger==='cancel'||isUiButtonEvent(event.trigger))pointer(page,component,event.trigger,event.inside);else incomplete('该按钮触发方式尚不支持页面预演。', { pageId: page.id, pageInstance: page.instance, componentId: component.id });}
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
     const custom=!theme.disabledPages?.includes('messageBox')&&theme.pages?.messageBox?.layout==='custom';
     const confirmation=makePage('ui:messageBox',effectiveUiComponents(project.ui).filter(c=>c.page==='messageBox'&&!theme.disabledPages?.includes(c.page)),'confirm');
     confirmation.parent=page;confirmation.message=result.confirmation.message;confirmation.nativeConfirm=!custom;
     confirmation.resume=value=>{
      if(value!==true||!pageIsOpen(page)||!layers().includes(page)||!visible(component,page)||!enabled(component))return;
      const accepted=voiceCollectionAction(project,component,voice,page.voice[component.id],event,voiceUnlocks,gain,{confirmed:true});
      voice=accepted.state;page.voice[component.id]=accepted.view;
     };
     openPages.push(confirmation);syncButtonStates();syncTimers();show(confirmation);
    }else{voice=result.state;page.voice[component.id]=result.view;}
    if(event.action==='play'&&voice.playback&&voice.playback.requestId!==previous)voiceOwner={instance:page.instance,pageId:page.id};
   }
   else if (event.kind === 'gallery') page.gallery = galleryPreviewAction(project, component, page.gallery, event, options.galleryUnlocks, context.variables);
   else if (event.kind === 'scroll') {
     const geometry = geometryFor(component.id), mode = get(component.id, 'scrollMode');
     if (!geometry || geometry.clippedOut || !Number.isFinite(event.dx) || !Number.isFinite(event.dy)) continue;
     for (const [property, enabledAxis, delta, current, minimum, maximum] of [
      ['scrollX', mode === 'horizontal' || mode === 'both', event.dx, geometry.scrollX, geometry.scrollMinimumX, geometry.scrollMaximumX],
      ['scrollY', mode === 'vertical' || mode === 'both', event.dy, geometry.scrollY, geometry.scrollMinimumY, geometry.scrollMaximumY],
     ] as const) if (enabledAxis && delta && propertySource(component.id, property)?.control?.mode !== 'follow') {
      const value = Math.max(minimum, Math.min(maximum, current + delta));
      // A blocked/clamped wheel event does not publish a computed layout value.
      if (value !== current) context.ui!.set(component.id, property, value);
     }
     for (const id of uiSubtreeIds(page.components, component.id)) buttonStates.delete(id);
     syncInputFocus();
    }
    else if (event.kind === 'focus') {
    if (event.focused && uiTextInput(project, component) && get(component.id, 'readOnly') !== true) inputFocus = { page, componentId: component.id };
    else if (inputFocus?.componentId === component.id) inputFocus = undefined;
   }
   else if(event.kind==='textCommit'){
    if (get(component.id, 'readOnly') === true) continue;
    if (inputFocus?.componentId === component.id) inputFocus = undefined;
    if(!uiTextInput(project,component)||!Object.hasOwn(uiTextCommitMethods,event.method)){incomplete('文字提交目标不是有效输入框，或提交方式不受支持。', { pageId: page.id, pageInstance: page.instance, componentId: component.id });continue;}
    const value=get(component.id, 'stringValue')!;
    const handlers=projectGraphs(project).flatMap(g=>uiGraphOnPage(project,g,page.id)?g.nodes.filter(n=>n.type==='eventTextCommitted'&&n.properties.componentId===component.id&&uiEventInActiveInstance(project,n)).map(n=>({g,n})):[]);
    sequence(handlers.map(({g,n})=>next=>run(g.id,n.id,next,{value,method:event.method},page)), page);
   }
   else if (event.kind === 'control' && ['preference', 'preferenceChoice'].includes(component.kind)) {
    if (get(component.id, 'readOnly') === true) continue;
    const control = effectiveControl(component.id);
    if (!control) { incomplete('控件绑定已失效。', { pageId: page.id, componentId: component.id }); continue; }
    if (control.choice && (event.optionsKey !== undefined && event.optionsKey !== uiControlOptionsKey(control.options) || event.optionIndex !== undefined && (!Number.isSafeInteger(event.optionIndex) || !control.options[event.optionIndex] || !uiControlOptionMatches(control.options[event.optionIndex].value, event.value)))) continue;
    const primary = uiControlPrimaryProperty(control), previous = get(component.id, primary);
    const problem = uiControlValueProblem(control, event.value, Number(get(component.id, 'maxLength') ?? 200));
    // A DOM selection can race a later range change even if the list is unchanged.
    if (problem && control.choice && event.optionsKey !== undefined) continue;
    if (problem) { incomplete(problem, { pageId: page.id, pageInstance: page.instance, componentId: component.id }); continue; }
    if (!context.ui!.set(component.id, primary, event.value, 'source')) { incomplete('控件绑定拒绝本次输入。', { pageId: page.id, componentId: component.id }); continue; }
    const current = get(component.id, primary);
    if (previous !== undefined && current !== undefined && !uiControlOptionMatches(previous, current)) {
     const handlers=projectGraphs(project).flatMap(g=>uiGraphOnPage(project,g,page.id)?g.nodes.filter(n=>n.type==='eventValueChanged'&&n.properties.componentId===component.id&&uiEventInActiveInstance(project,n)).map(n=>({g,n})):[]);
     sequence(handlers.map(({g,n})=>next=>run(g.id,n.id,next,{value:current!,previous},page)), page);
    }
   }
  }
  update();
 }
 syncButtonStates(); syncImageRequests(); syncVideoRequests(); syncSpineRequests();
 const componentSnapshot = (page: PreviewPage) => {
   const previousLayoutCache = layoutReadCache; layoutReadCache = layoutFor(page);
  const rows = page.components.map(component => {
  const c = cloneData(component);
  for (const property of Object.keys(uiProperties) as UiProperty[]) {
    if (!uiProperties[property].writable) continue;
    if (property === 'text' && c.binding && !Object.hasOwn(overrides.get(c.id) ?? {}, 'text') && !propertySource(c.id, 'text')) continue;
    const value = get(c.id, property); if (value !== undefined) applyUiPropertySnapshot(c, property, value);
  }
  return { component: c, visible: ownVisible(c,page), state: !ownEnabled(c) || get(c.id, 'readOnly') === true ? 'disabled' as const : buttonStates.get(c.id)?.held&&buttonStates.get(c.id)?.hover?'pressed' as const : get(c.id, 'selected') === true ? 'selected' as const : buttonStates.get(c.id)?.hover?'hover' as const : 'idle' as const };
 });
  const byId = new Map(rows.map(row => [row.component.id, row]));
  layoutReadCache = previousLayoutCache;
   return resolveUiHierarchy(rows.map(row => row.component), { viewport: project, state: c => byId.get(c.id)!.state, visible: c => byId.get(c.id)!.visible, playerOpacity: Number(context.preferences?.dialogueOpacity ?? 1) });
 };
 const snapshot = (page: PreviewPage) => ({ pageId: page.id, instance: page.instance, opening: page.opening, inputs: { ...page.inputs }, outputs: { ...page.outputs }, created: page.createdReady, focused: page.focused, closing: !!page.closing, closeRequested: !!page.closeRequest, variables: { ...page.variables }, hidden: !layers().includes(page), message: page.message, nativeConfirm: page.nativeConfirm, nativeLayout:page.nativeLayout, music: Object.fromEntries(page.components.filter(c=>c.kind==='musicTrackList').map(c=>[c.id,musicCollectionView(project,c,page.musicPages[c.id],musicUnlocks,musicEntries)])), voice: Object.fromEntries(page.components.filter(c=>c.kind==='voiceCollection').map(c=>[c.id,voiceCollectionView(project,c,voice,page.voice[c.id],voiceUnlocks)])), mode: page.mode, modal: page.modal, gallery: page.gallery, interactive: !detailPage() && interactivePages().includes(page), components: componentSnapshot(page) });
 const current = active(), visibleLayers = layers(), rendered = [...[root,...openPages].filter(p=>pageIsOpen(p)&&!visibleLayers.includes(p)),...visibleLayers].map(snapshot), top = current ? snapshot(current) : undefined;
 const cancelTarget = [...interactivePages()].reverse().find(p => p.opening.closeOnEscape && (!p.id.startsWith('ui:') || p.mode === 'confirm' || p.mode === 'menu' || p.nativeLayout && p.id !== 'ui:main'));
 const keys = detailPage() ? ['K_ESCAPE', 'K_LEFT', 'K_RIGHT'] : [...new Set([...interactivePages().flatMap(p => uiPreviewKeys(project, p.id, p.components.filter(c=>visible(c,p) && !geometryFor(c.id)?.clippedOut))), ...(cancelTarget ? ['K_ESCAPE'] : [])])];
 const openComponentIds = new Set([root, ...openPages].filter(pageIsOpen).flatMap(page => page.components.map(component => component.id)));
 // An unopened page's explicit source may not accept the current parameter.
 // Inspect it when that page opens, rather than diagnosing it through this
 // compatibility snapshot of every control declared in the project.
 const snapshotControlActive = (id: string) => openComponentIds.has(id) || !Object.keys(componentById.get(id)?.propertyControls ?? {}).length;
 const controlValues = Object.fromEntries([...controlDefinitions].filter(([, control]) => !!control).map(([id, control]) => [id, snapshotControlActive(id) ? get(id, uiControlPrimaryProperty(control!)) : undefined]));
 const controlOptions = Object.fromEntries([...controlDefinitions].filter(([, control]) => control?.choice).map(([id, control]) => [id, ((snapshotControlActive(id) ? effectiveControl(id)?.options : undefined) ?? control!.options).map(option => ({ ...option }))]));
 const focusedComponentId = inputFocus && get(inputFocus.componentId, 'focused') === true ? inputFocus.componentId : undefined;
 return { spineProblems: Object.fromEntries(spineProblems), spineRequests: Object.fromEntries([...spineRequests].map(([id, request]) => [id, { ...request }])), videoRequests: Object.fromEntries([...videoRequests].map(([id, request]) => [id, { ...request }])), imageRequests: Object.fromEntries([...imageRequests].map(([id, request]) => [id, { ...request }])), controlValues, controlOptions, focusedComponentId, inputFocusCommand, clickFeedback, tasks: [...tasks.values()].map(({ handle, graphId, status, reason, outputs }) => ({ handle, graphId, status, reason, outputs: { ...outputs } })), taskWaiting: taskWaits.size, trace: trace?.snapshot(), pageResults, stage:uiStagePlan(stageEvents,elapsed), stageWaiting:stageWaits.size, historySource, history:historyPreviewView(project,voice,historySource,voiceUnlocks), music, musicUnlocks, musicRoomOpen:visibleLayers.some(p=>p.id==='ui:musicRoom'), voice, voiceUnlocks, muted, transitions, pageId: current?.id ?? root.id, host, returnPageId, gallery: current?.gallery ?? { pages: {} } as GalleryPreviewState, saveMode: current?.saveMode, layers: rendered, keys, cancelPageId: cancelTarget?.id, closed: visibleLayers.length === 0, waitingPages: openPages.filter(p => ['waiting','confirm','menu'].includes(p.mode)).map(p => p.id), characterVolumes: context.characterVolumes, preferences: Object.fromEntries(playerPreferenceKeys.map(key => [key, context.preferences?.[key] ?? preferenceDefaults[key]])), elapsed, fired, exhausted, stopReason, incomplete: context.incomplete, variables: context.variables, components: top?.components.filter(row => top.pageId !== 'ui:main' || !nativeIds.has(row.component.id)) ?? [] };
}

