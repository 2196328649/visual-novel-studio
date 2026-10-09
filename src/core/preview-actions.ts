import { projectGraphs } from './project-resources';
import { parseActorTransitions, resolveActorTransitions } from './actor-transitions';
import { timelinePlaybackLayout } from './performance-timeline';
import { applyAudioClipInputs, audioClipFields } from './audio-clip';
import { interleaveProjectTimelines } from './timeline-interleave';
import { canLaunchTimeline } from './timeline-launch';
import { nodeMoveOffsets, nodeAfterOffsets } from './move-offsets';
import { applyVisualInputs, visualInputFields } from './visual-object';
import { materializeVisualCompositions } from './visual-composition';
import { actionSchema, type BlueprintNode, type Project, type StageAction, type VariableValue } from './model';
import { blueprintInputValue, blueprintScreens } from './blueprint';
import { expandStageAction, textCommandAction } from './text-script';
import { validPlayerPreference, playerPreferences, type PlayerPreference } from './preferences';
import { rawSavedBlueprintAction, speakerExpression } from './blueprint-authoring';
import { performanceTiming } from './performance-timing';
import { portraitPlacement } from './portrait';
import { characterDisplayPreset, resolveShowAction, resolveShowTarget } from './character-presets';
import { actorKey, actorReference, type ShowActor } from './actor-instance';

export interface PreviewActionOrigin { nodeId: string; lineId: string; actionIndex: number; direct: boolean; sceneId?: string; blueprintId?: string; blueprintNodeId?: string; visualTimeScales?: Record<string, number> }
export interface PreviewActionContext { /** Resolve one authored call before expanding its child. */ captureBlueprintCall?: { graphId: string; nodeId: string; inputs?: Record<string, VariableValue> }; /** Internal duration sampling, before row layout exists. */ samplingTimelineNode?: boolean; yieldStageActions?:boolean; preferences?: Partial<Record<PlayerPreference,VariableValue>>; characterVolumes?: Record<string,number>; ui?: {get:(id:string,property:string)=>VariableValue|undefined;set:(id:string,property:string,value:VariableValue|undefined)=>boolean;reset:(id:string)=>boolean;stopAnimation?:(id:string,property:string,finish:boolean)=>boolean;stopPlayback?:(id:string,finish:boolean)=>boolean}; actionOrigins?: Map<StageAction, PreviewActionOrigin>; visualTimeScales?: Map<string, number>; variables: Record<string, VariableValue>; incomplete: boolean; speakerId?: string; actors: Map<string, ShowActor> }
export const previewActionContext = (project: Project): PreviewActionContext => ({ variables: Object.fromEntries(project.variables.map(v => [v.id, v.initial])), incomplete: false, actors: new Map() });

export type PreviewUiAnimationRequest = { kind:'animateUi'; componentId:string; property:string; value:VariableValue|undefined; duration:VariableValue|undefined; easing:string; wait:VariableValue|undefined };
export type PreviewUiRequest = {kind:"stage";action:StageAction} | PreviewUiAnimationRequest | {kind:'playUiClip';animationId:string;playMode:VariableValue|undefined;loops:VariableValue|undefined;speed:VariableValue|undefined;fromCurrent:VariableValue|undefined;wait:VariableValue|undefined} | { kind: 'openPage'; pageId: string; wait: boolean } | { kind: 'closePage'; pageId: string; result: string } | { kind: 'confirm'; message: string } | { kind: 'menu'; screen: string };
export type PreviewActionIterator = Generator<PreviewUiRequest, void, string | boolean | undefined>;

interface PreviewPlayback { project: Project; unsupportedTimelines: Set<string> }
type PreviewOrigins = (Omit<PreviewActionOrigin, 'direct'> | undefined)[];

/** A single route/stage traversal shares its private timeline preparation.
 * Keep this scoped to the traversal: authoring callers can mutate projects in place.
 * Variables, speakers, actors and call arguments are still evaluated for every line. */
export function createPreviewActionExpander(project: Project) {
  let playback: PreviewPlayback | undefined;
  return (source: StageAction[], context: PreviewActionContext, origins?: PreviewOrigins): StageAction[] => {
    if (!source.length) return [];
    if (context.captureBlueprintCall || context.samplingTimelineNode) return expandPreviewActions(project, source, context, origins);
    if (!playback) {
      const unsupportedTimelines = new Set<string>();
      playback = { project: interleaveProjectTimelines(timelinePlaybackLayout(project), graph => unsupportedTimelines.add(graph.id)), unsupportedTimelines };
    }
    return collectPreviewActions(previewActionRunner(project, source, context, origins, undefined, playback), context);
  };
}

/** Static callers stop at player input instead of applying the continuation early. */
export function expandPreviewActions(project: Project, source: StageAction[], context: PreviewActionContext, origins?: (Omit<PreviewActionOrigin, 'direct'> | undefined)[]): StageAction[] {
  return collectPreviewActions(previewActionRunner(project, source, context, origins), context);
}

function collectPreviewActions(runner: ReturnType<typeof previewActionRunner>, context: PreviewActionContext): StageAction[] {
  for (let step = runner.iterator.next(); !step.done; step = runner.iterator.next('')) {
    context.incomplete = true;
    if (step.value.kind === 'animateUi' || step.value.kind === 'playUiClip' || step.value.kind === 'confirm' || step.value.kind === 'menu' || step.value.kind === 'openPage' && step.value.wait) { runner.iterator.return(); break; }
  }
  return runner.actions;
}

/** Shared interpreter; UI callers retain the iterator while waiting for a page result. */
export function previewActionRunner(project: Project, source: StageAction[], context: PreviewActionContext, origins?: (Omit<PreviewActionOrigin, 'direct'> | undefined)[], eventData?:{graphId:string;nodeId:string}&Record<string,VariableValue>, playback?: PreviewPlayback) {
  const unsupportedTimelines = playback?.unsupportedTimelines ?? new Set<string>();
  if (playback) project = playback.project;
  else if (!context.captureBlueprintCall) {
    if (!context.samplingTimelineNode) project = timelinePlaybackLayout(project);
    project = interleaveProjectTimelines(project,graph=>unsupportedTimelines.add(graph.id));
  }
  const actions: StageAction[] = [];
  const actorOverrides: NonNullable<Extract<StageAction, { kind: 'show' }>['actorTransitions']>[] = [];
  const activeGraphs = new Set<string>();
  let budget = 1024;
  let origin: Omit<PreviewActionOrigin, 'direct'> | undefined, originalKind: StageAction['kind'] | undefined;
  const emit = function* (action: unknown):PreviewActionIterator {
    if (action && typeof action === 'object' && 'kind' in action && action.kind === 'show') {
      const show = action as Extract<StageAction, { kind: 'show' }>;
      const resolved = show.characterId && show.expressionId ? show : resolveShowTarget(project, show, context.speakerId);
      if (!resolved) { if (show.characterId || show.expressionId && speakerExpression(project, context.speakerId)) context.incomplete = true; return; }
      if (!show.characterId && context.actors.get(actorKey(resolved))?.lifetime === 'persistent') resolved.lifetime = 'persistent';
      action = resolved;
    }
    if (action && typeof action === 'object' && 'kind' in action && action.kind === 'show' && 'presetId' in action && action.presetId) {
      const show = action as Extract<StageAction, { kind: 'show' }>;
      const reference = String(show.presetId), preset = characterDisplayPreset(project, show.characterId, reference);
      if (!preset) { context.incomplete = true; return; }
      action = { ...show, presetId: /^(default|默认|角色默认)$/.test(reference) ? 'default' : preset.id };
    }
    const parsed = actionSchema.safeParse(action);
    if (!parsed.success) { context.incomplete = true; return; }
    try {
      const action = parsed.data.kind === 'show' ? resolveShowAction(project, parsed.data) : parsed.data;
      if (action.kind === 'show' && !action.lifetime) action.lifetime = context.actors.get(actorKey(action))?.lifetime;
      if (action.kind === 'show') { const rules = resolveActorTransitions(project, action.characterId, action, actorOverrides.length ? Object.assign({}, ...actorOverrides) : undefined); if (rules) action.actorTransitions = rules; }
      actions.push(action);
      if (origin) context.actionOrigins?.set(action, { ...origin, direct: activeGraphs.size === 0 && originalKind === action.kind });
      if (action.kind === 'show') context.actors.set(actorKey(action), action);
      if (action.kind === 'hide') context.actors.delete(actorKey(action));
      if (action.kind === 'background') for (const [id, actor] of context.actors) if (actor.lifetime !== 'persistent') context.actors.delete(id);
      if(context.yieldStageActions)yield {kind:'stage',action};
    }
    catch { context.incomplete = true; }
  };
  const expand = function* (source: StageAction[], locations?: typeof origins): PreviewActionIterator {
    for (const [index, raw] of source.entries()) {
      if (locations) { origin = locations[index]; originalKind = raw.kind; }
      for (const action of expandStageAction(project, raw)) {
      if (action.kind === 'blueprint') { if (action.actorTransitions) actorOverrides.push(action.actorTransitions); yield* run(action.blueprintId, action.inputs); if (action.actorTransitions) actorOverrides.pop(); }
      else if (action.kind === 'visual') yield* emit(applyVisualInputs(materializeVisualCompositions(project, action), {}));
      else yield* emit(action);
      }
    }
  };
  const run = function* (id: string, args: Record<string, VariableValue> = {}, launch = false, layerBase = 10): Generator<PreviewUiRequest, Record<string, VariableValue>, string | boolean | undefined> {
    const output: Record<string, VariableValue> = {};
    const graph = projectGraphs(project)?.find(g => g.id === id);
    if (!graph || unsupportedTimelines.has(id) || activeGraphs.has(id) || activeGraphs.size >= 16 || budget <= 0) { context.incomplete = true; return output; }
    activeGraphs.add(id);
    const actionStart = actions.length;
    const nodes = new Map(graph.nodes.map(n => [n.id, n]));
    const results = new Map<string, Record<string, VariableValue>>();
    const loopIndices = new Map<string, number>();
    const reading = new Set<string>();
    const value = (node: BlueprintNode, pin: string): VariableValue | undefined => {
      const link = graph.links.find(l => l.toNodeId === node.id && l.toPinId === pin);
      if (!link) return blueprintInputValue(node, pin);
      const key = `${link.fromNodeId}/${link.fromPinId}`;
      const from = nodes.get(link.fromNodeId);
      if (!from || reading.has(key)) { context.incomplete = true; return undefined; }
      reading.add(key);
      let resolved: VariableValue | undefined;
      const a = () => value(from, 'a'), b = () => value(from, 'b');
      switch (from.type) {
        case 'event': case 'eventValueChanged': case 'eventTextCommitted': resolved=eventData?.graphId===graph.id&&eventData.nodeId===from.id?eventData[link.fromPinId]:from.pins.find(p=>p.id===link.fromPinId)?.defaultValue; break;
        case 'literal': resolved = from.properties.value; break;
        case 'getVariable': resolved = context.variables[String(from.properties.variableId)]; break;
        case 'getInput': resolved = args[String(from.properties.inputId)] ?? graph.exposedInputs.find(p => p.id === from.properties.inputId)?.defaultValue; break;
        case 'forLoop': resolved = loopIndices.get(from.id); break;
        case 'showUiPage': resolved = results.get(from.id)?.result ?? ''; break;
        case 'callFunction': case 'callMacro': resolved = results.get(from.id)?.[link.fromPinId.replace(/^out_/, '')]; break;
        case 'select': { const condition = value(from, 'condition'); resolved = typeof condition === 'boolean' ? value(from, condition ? 'true_value' : 'false_value') : undefined; break; }
        case 'compare': {
          const left = a(), right = b();
          if (left === undefined || right === undefined) break;
          resolved = from.properties.operator === 'ne' ? left !== right : from.properties.operator === 'gt' ? Number(left) > Number(right) : from.properties.operator === 'gte' ? Number(left) >= Number(right) : from.properties.operator === 'lt' ? Number(left) < Number(right) : from.properties.operator === 'lte' ? Number(left) <= Number(right) : left === right;
          break;
        }
        case 'math': {
          const left = Number(a()), right = Number(b());
          const operation = String(from.properties.operation ?? from.properties.operator ?? 'add');
          const result = ['subtract', 'sub', '-'].includes(operation) ? left - right : ['multiply', 'mul', '*'].includes(operation) ? left * right : ['divide', 'div', '/'].includes(operation) ? left / right : ['modulo', 'mod', '%'].includes(operation) ? left % right : operation === 'min' ? Math.min(left, right) : operation === 'max' ? Math.max(left, right) : left + right;
          if (Number.isFinite(result)) resolved = result;
          break;
        }
        case 'formatText': { const input=value(from,'value'); if(input===undefined){context.incomplete=true;break;} const text=typeof input==='boolean'?(input?'True':'False'):String(input); resolved=String(value(from,'format')??'{value}').replaceAll('{value}',text); break; }
        case 'getUiProperty': resolved = context.ui?.get(String(value(from,'componentId')??''),String(from.properties.property??'visible')); if(resolved===undefined)context.incomplete=true; break;
        case 'getPlayerPreference': { const preference = String(from.properties.preference) as PlayerPreference; const character=String(value(from,'characterId')??''); if(preference==='characterVolume'&&character&&!project.characters.some(c=>c.id===character)){context.incomplete=true;break;} resolved = (preference==='characterVolume'?context.characterVolumes?.[character]:context.preferences?.[preference]) ?? project.playerDefaults?.[preference] ?? playerPreferences[preference]?.initial; break; }
      }
      reading.delete(key);
      return resolved;
    };
    const walk = function* (id: string | undefined): Generator<PreviewUiRequest, boolean, string | boolean | undefined> {
      if (!id) return false;
      if (--budget < 0) { context.incomplete = true; return true; }
      const node = nodes.get(id); if (!node) return false;
      const next = (pin = 'exec_out') => graph.links.find(l => l.fromNodeId === id && l.fromPinId === pin)?.toNodeId;
      const layer = typeof node.properties.__timelineLayerOffset === 'number' ? layerBase + node.properties.__timelineLayerOffset : undefined;
      const v = (key: string, fallback?: VariableValue) => key === 'layer' && layer !== undefined ? layer : value(node, key) ?? fallback;
      const n = (key: string, fallback = 0) => Number(v(key, fallback));
      switch (node.type) {
        case 'event': return yield* walk(next('exec'));
        case 'return': case 'finishMinigame': return true;
        case 'branch': { const condition = value(node, 'condition'); if (typeof condition !== 'boolean') { context.incomplete = true; return true; } return yield* walk(next(condition ? 'true' : 'false')); }
        case 'sequence': for (const pin of node.pins.filter(p => p.direction === 'output' && p.dataType === 'exec')) if (yield* walk(next(pin.id))) return true; return false;
        case 'forLoop': {
          const first = n('first_index'), last = n('last_index');
          if (!Number.isInteger(first) || !Number.isInteger(last) || last - first > 256) { context.incomplete = true; return true; }
          for (let index = first; index <= last; index++) { loopIndices.set(node.id, index); if (yield* walk(next('loop_body'))) return true; }
          return yield* walk(next('completed'));
        }
        case 'setPlayerPreference': { const key=String(node.properties.preference) as PlayerPreference,result=value(node,'value'); const character=String(value(node,'characterId')??'');if(context.preferences&&result!==undefined&&validPlayerPreference(key,result)&&!(key==='characterVolume'&&character&&!project.characters.some(c=>c.id===character))){if(key==='characterVolume'&&context.characterVolumes)context.characterVolumes[character]=Number(result);else context.preferences[key]=result;}else context.incomplete=true;break; }
        case 'setUiProperty': if(!context.ui?.set(String(v('componentId','')),String(node.properties.property??'visible'),value(node,'value')))context.incomplete=true; break;
        case 'playUiAnimation': yield {kind:'playUiClip',animationId:String(node.properties.animationId??''),playMode:node.properties.playMode??'forward',loops:v('loops',1),speed:v('speed',1),fromCurrent:v('fromCurrent',false),wait:v('wait',true)};break;
        case 'stopUiAnimationPlayback': {const finish=v('finish',false);if(typeof finish!=='boolean'||!context.ui?.stopPlayback?.(String(node.properties.animationId??''),finish))context.incomplete=true;break;}
        case 'animateUiProperty': yield {kind:'animateUi',componentId:String(v('componentId','')),property:String(node.properties.property??'opacity'),value:value(node,'value'),duration:v('duration',.3),easing:String(node.properties.easing??'ease'),wait:v('wait',true)}; break;
        case 'stopUiAnimation': { const finish=v('finish',false);if(typeof finish!=='boolean'||!context.ui?.stopAnimation?.(String(v('componentId','')),String(node.properties.property??'all'),finish))context.incomplete=true;break; }
        case 'resetUiComponent': if(!context.ui?.reset(String(v('componentId',''))))context.incomplete=true; break;
        case 'setVariable': { const result = value(node, 'value'); if (result !== undefined) context.variables[String(node.properties.variableId)] = result; else context.incomplete = true; break; }
        case 'setOutput': { const result = value(node, 'value'); if (result !== undefined) output[String(node.properties.outputId)] = result; break; }
        case 'callFunction': case 'callMacro': {
          const target = projectGraphs(project)?.find(g => g.id === node.properties.graphId);
          if (!target) { context.incomplete = true; break; }
          const input: Record<string, VariableValue> = {};
          for (const pin of target.exposedInputs) { const argument = v(`arg_${pin.id}`, pin.defaultValue); if (argument !== undefined) input[pin.id] = argument; }
          if (context.captureBlueprintCall?.graphId === graph.id && context.captureBlueprintCall.nodeId === node.id) {
            context.captureBlueprintCall.inputs = input;
            return true;
          }
          const overrides = parseActorTransitions(node.properties.actorTransitions);
          if (overrides) actorOverrides.push(overrides);
          results.set(node.id, yield* run(target.id, input, node.properties.wait === false && canLaunchTimeline(project, target), layer ?? 10));
          if (overrides) actorOverrides.pop();
          break;
        }
        case 'startDialogue': yield* emit({ kind: 'startDialogue' }); break;
        case 'playMusic': yield* emit({ kind: 'music', assetId: v('assetId'), loop: v('loop', true), fade: n('fade', 0.3) }); break;
        case 'playSound': if (v('assetId') && v('channel', 'sound') === 'sound') yield* emit({ kind: 'sound', assetId: v('assetId') }); break;
        case 'stopMusic': if (v('channel', 'music') === 'music') yield* emit({ kind: 'stopMusic', fade: n('fade', 0.3) }); break;
        case 'showBackground': yield* emit({ kind: 'background', assetId: v('assetId'), transition: v('transition', 'dissolve'), duration: n('duration', v('transition') === 'fade' ? 1 : .5), wait: v('wait', true) }); break;
        case 'showCharacter': {
          const first = actions.length;
          const characterId = String(v('characterId') || context.speakerId || '');
          const existing = context.actors.get(actorKey({ characterId, instanceId: String(v('instanceId', '')) }));
          const expression = speakerExpression(project, characterId, v('expressionId'));
          if (expression) yield* emit({ kind: 'show', actorTransitions: parseActorTransitions(node.properties.actorTransitions), ...(node.properties.moveOffsets ? { moveOffsets: nodeMoveOffsets(node) } : {}), ...(node.properties.afterOffsets ? { afterOffsets: nodeAfterOffsets(node) } : {}), characterId, expressionId: expression.id, instanceId: v('instanceId', '') || undefined, lifetime: !v('characterId') && existing?.lifetime === 'persistent' ? 'persistent' : v('lifetime', '') || undefined, x: n('x', 0.5), y: n('y', 1), scale: n('scale', 1), presetId: v('presetId', '') || undefined, ...(!v('presetId', '') && v('useDefaultFraming', false) ? portraitPlacement(project, characterId, expression.id, n('x', .5), n('y', 1), n('scale', 1)) : {}), layer: n('layer', 10), transition: v('transition', 'dissolve'), duration: n('duration', v('transition') === 'fade' ? 1 : .5), wait: v('wait', true) });
          else if (v('characterId') || v('expressionId') && speakerExpression(project, context.speakerId)) context.incomplete = true;
          if (origin && actions.length === first + 1) context.actionOrigins?.set(actions[first], { ...origin, direct: false, blueprintId: graph.id, blueprintNodeId: node.id });
          break;
        }
        case 'showChapter': yield* emit({ kind: 'chapter', title: v('title', '第一章'), subtitle: v('subtitle', ''), duration: n('duration', 4.2), backgroundId: v('backgroundId') || undefined, titleImageId: v('titleImageId') || undefined, soundId: v('soundId') || undefined, effect: v('effect') || undefined, wait: v('wait', true), ...(layer === undefined ? {} : { layer }) }); break;
        case 'camera': {
          const first = actions.length;
          yield* emit({ kind: 'camera', x: n('x'), y: n('y'), zoom: n('zoom', 1), rotation: n('rotation'), duration: n('duration', 0.5), easing: v('easing', 'ease'), wait: v('wait', true) });
          if (origin && actions.length === first + 1) context.actionOrigins?.set(actions[first], { ...origin, direct: false, blueprintId: graph.id, blueprintNodeId: node.id });
          break;
        }
        case 'shake': yield* emit({ kind: 'shake', direction: v('direction', 'vertical'), duration: n('duration', 0.6), amplitude: n('amplitude', 20), wait: v('wait', true) }); break;
        case 'effect': yield* expand([{ kind: 'effect', effectId: String(v('effectId')) }]); break;
        case 'savedAction': {
          let action = rawSavedBlueprintAction(node);
          if (action?.kind === 'visual') action = materializeVisualCompositions(project, action);
          if (layer !== undefined && (action?.kind === 'visual' || action?.kind === 'show' || action?.kind === 'chapter')) action = { ...action, layer };
          if (action?.kind === 'audioClip') action = applyAudioClipInputs(action, Object.fromEntries(audioClipFields(action).map(field => [field.key, v('clip_' + field.key, field.value)])));
          const scales = new Map<string, number>();
          if (action?.kind === 'visual') {
            action = applyVisualInputs(action, Object.fromEntries(visualInputFields(action).map(field => [field.key, v('object_' + field.key, field.value)])), scales);
            for (const [id, scale] of scales) context.visualTimeScales?.set(id, scale);
          }
          if (action) {
            const first = actions.length; yield* expand([action]);
            if (['show', 'animate', 'camera', 'visual'].includes(action.kind) && origin && actions.length === first + 1) context.actionOrigins?.set(actions[first], { ...origin, direct: false, blueprintId: graph.id, blueprintNodeId: node.id, ...(action.kind === 'visual' ? { visualTimeScales: Object.fromEntries(scales) } : {}) });
          } else context.incomplete = true;
          break;
        }
        case 'hideCharacter': yield* emit({ kind: 'hide', characterId: v('characterId'), instanceId: v('instanceId', '') || undefined, transition: v('transition', 'dissolve'), duration: n('duration', v('transition') === 'fade' ? 1 : .5), wait: v('wait', true) }); break;
        case 'delay': {
          if (launch && node.id === graph.timeline?.tailNodeId) break;
          const timing = node.id === graph.timeline?.tailNodeId ? performanceTiming(actions.slice(actionStart)) : undefined;
          yield* emit({ kind: 'pause', seconds: timing ? Math.max(0, timing.until - timing.at) : n('seconds', 1) }); break;
        }
        case 'sceneAction': { const action = textCommandAction(project, String(v('command', ''))); if (action) yield* expand([action]); else context.incomplete = true; break; }
        case 'showUiPage': {
          const pageId = String(v('pageId', ''));
          if (!project.ui.customPages.some(page => page.id === pageId)) { context.incomplete = true; return true; }
          const result = yield { kind: 'openPage', pageId, wait: v('wait', true) !== false };
          results.set(node.id, { result: String(result ?? '') }); break;
        }
        case 'closeUiPage': {
          const pageId = String(v('pageId', ''));
          if (!project.ui.customPages.some(page => page.id === pageId)) { context.incomplete = true; return true; }
          yield { kind: 'closePage', pageId, result: String(v('result', '完成')) }; break;
        }
        case 'confirmMessage': {
          const result = yield { kind: 'confirm', message: String(v('message', '确认继续吗？')) };
          return yield* walk(next(result === true ? 'yes' : 'no'));
        }
        case 'uiAction': {
          const screen = String(v('screen', 'pause_menu'));
          if (project.ui.customPages.some(page => page.id === screen)) yield { kind: 'openPage', pageId: screen, wait: true };
          else if (Object.hasOwn(blueprintScreens, screen)) yield { kind: 'menu', screen };
          else { context.incomplete = true; return true; }
          break;
        }
        case 'switchScene': context.incomplete = true; return true;
        default: context.incomplete = true;
      }
      return yield* walk(next());
    };
    yield* walk(graph.nodes.find(n => n.type === 'event')?.id);
    activeGraphs.delete(id);
    return output;
  };
  const iterator = (function* (): PreviewActionIterator {
  try { yield* expand(source, origins); } finally {
  if(context.actionOrigins)for(const action of actions){const origin=context.actionOrigins.get(action);if(!origin?.blueprintNodeId)continue;const node=projectGraphs(project).find(g=>g.id===origin.blueprintId)?.nodes.find(n=>n.id===origin.blueprintNodeId);if(node?.properties.__timelineGraph&&node.properties.__timelineNode)context.actionOrigins.set(action,{...origin,blueprintId:String(node.properties.__timelineGraph),blueprintNodeId:String(node.properties.__timelineNode)});}
  }
  })();
  return { actions, iterator };
}
