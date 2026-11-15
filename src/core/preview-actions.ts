import type { UiVideoOperation } from './ui-video';
import { uiControlOptionExecutionPin, uiControlOptionEditInputs, uiControlOptionsKnown, type UiControlOptionEdit, type UiControlOptionResult } from './ui-control-options';
import type { UiControlRange } from './ui-control-properties';
import { uiPageClosedOperationProblem, uiPageContractProblem, uiPageInputValues, uiPageInterface, uiPageNodeContractId, uiPageNodePageId, validUiPageParameterValue } from './ui-page-interface';
import type { BlueprintTaskPreviewHost } from './blueprint-task-preview';
import { blueprintTaskVersion, blueprintTaskScope, blueprintTaskPageId, blueprintTaskFinished, blueprintTaskProblems, transitionBlueprintThrottle, validBlueprintTaskValue } from './blueprint-tasks';
import { evaluateBlueprintChoice, selectBlueprintChoice } from './blueprint-choice';
import { evaluateBlueprintNumeric } from './blueprint-numeric';
import { blueprintFlowControlInitial, blueprintFlowControlPageId, blueprintFlowControlScope, transitionBlueprintFlowControl } from './blueprint-flow-control';
import type { BlueprintTraceRecorder, BlueprintTraceData, BlueprintTraceFrame, BlueprintTraceLocation } from './blueprint-trace';
import { createBlueprintPlaybackOrigins } from './blueprint-playback-origins';
import { blueprintStateScope, blueprintStateVariable, blueprintStatePageId, validBlueprintStateValue } from './blueprint-state';
import { uiPage, uiPageOpenProblem } from './ui-pages';
import { projectGraphs } from './project-resources';
import { evaluateBlueprintLogic } from './blueprint-logic';
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
import { actorKey, actorReference, parseActorInstance, type ShowActor } from './actor-instance';
import { uiPageReason, type UiPageCompletion, type UiPageReason } from './ui-page-session';
import { openingInputFromModal, resolveUiPageOpening, uiPageOpeningProblem, type UiPageOpening } from './ui-page-opening';
import { blueprintUiPropertyDefinition, type BlueprintUiPropertyAssignment } from './blueprint-ui-property-batch';

export interface PreviewActionOrigin { nodeId: string; lineId: string; actionIndex: number; direct: boolean; sceneId?: string; blueprintId?: string; blueprintNodeId?: string; visualTimeScales?: Record<string, number> }
export interface PreviewActionContext {
  /** Duration sampling may prepare only fixed call dependencies; resources remain available. */
  samplingGraphIds?: ReadonlySet<string>;
  /** Explicit global writes let an interactive host transfer parameter animation ownership. */
  setParameter?: (parameterId: string, value: VariableValue) => boolean;
  pageInterface?: { phase: () => string | undefined; get: (pageId: string, direction: 'inputs' | 'outputs', parameterId: string) => VariableValue | undefined; setOutput: (pageId: string, parameterId: string, value: VariableValue) => boolean; preventClose: (pageId: string) => boolean }; tasks?: BlueprintTaskPreviewHost; time?: () => number; trace?: BlueprintTraceRecorder; pageState?: { throttle?: (pageId: string, graphId: string, nodeId: string, entry: string, seconds: unknown) => ReturnType<typeof transitionBlueprintThrottle>; control?: (pageId: string, graphId: string, node: BlueprintNode, entry: string) => ReturnType<typeof transitionBlueprintFlowControl>; instance?: (pageId: string) => number | undefined; get: (pageId: string, variableId: string) => VariableValue | undefined; set: (pageId: string, variableId: string, value: VariableValue) => boolean }; /** Resolve one authored call before expanding its child. */ captureBlueprintCall?: { graphId: string; nodeId: string; inputs?: Record<string, VariableValue> }; /** Internal duration sampling, before row layout exists. */ samplingTimelineNode?: boolean; yieldStageActions?:boolean; preferences?: Partial<Record<PlayerPreference,VariableValue>>; characterVolumes?: Record<string,number>; ui?: {playSpine?:(id:string,animation:unknown,loop:unknown,restart:unknown)=>boolean;pauseSpine?:(id:string,paused:unknown)=>boolean;video?:(id:string,operation:UiVideoOperation,value?:boolean)=>boolean;getOption?:(id:string,index:unknown,valueType:unknown)=>UiControlOptionResult|undefined;editOptions?:(id:string,operation:unknown,input:UiControlOptionEdit)=>boolean;requestFocus?:(id:string,focused:boolean)=>boolean|undefined;setRange?:(id:string,range:UiControlRange)=>boolean;resetRange?:(id:string)=>boolean;get:(id:string,property:string)=>VariableValue|undefined;getDefault?:(id:string,property:string)=>VariableValue|undefined;resetProperty?:(id:string,property:string)=>boolean;set:(id:string,property:string,value:VariableValue|undefined,writeMode?:string)=>boolean;setMany?:(id:string,assignments:readonly BlueprintUiPropertyAssignment[])=>boolean;reset:(id:string)=>boolean;stopAnimation?:(id:string,property:string,finish:boolean)=>boolean;stopPlayback?:(id:string,finish:boolean)=>boolean}; actionOrigins?: Map<StageAction, PreviewActionOrigin>; visualTimeScales?: Map<string, number>; variables: Record<string, VariableValue>; incomplete: boolean; speakerId?: string; actors: Map<string, ShowActor> }
export const previewActionContext = (project: Project): PreviewActionContext => ({ variables: Object.fromEntries(project.variables.map(v => [v.id, v.initial])), incomplete: false, actors: new Map() });

export type PreviewUiAnimationRequest = { kind:'animateUi'; componentId:string; property:string; value:VariableValue|undefined; duration:VariableValue|undefined; easing:string; wait:VariableValue|undefined };
export type PreviewUiRequest = {kind:'taskCheckpoint'} | {kind:'awaitTask';handle:string;graphId?:string} | {kind:"stage";action:StageAction} | PreviewUiAnimationRequest | {kind:'playUiClip';animationId:string;playMode:VariableValue|undefined;loops:VariableValue|undefined;speed:VariableValue|undefined;fromCurrent:VariableValue|undefined;wait:VariableValue|undefined} | { kind: 'openPage'; pageId: string; wait: boolean; modal?: boolean; opening?: UiPageOpening; inputs?: Record<string, VariableValue>; saveMode?: 'save' | 'load' } | { kind: 'closePage'; pageId: string; result: string; reason: UiPageReason; outputs?: Record<string, VariableValue> } | { kind: 'confirm'; message: string } | { kind: 'menu'; screen: string };
export type PreviewUiResult = string | boolean | UiPageCompletion | undefined;
export type PreviewActionIterator = Generator<PreviewUiRequest, void, PreviewUiResult>;

interface PreviewPlayback { project: Project; unsupportedTimelines: Set<string> }
type PreviewOrigins = (Omit<PreviewActionOrigin, 'direct'> | undefined)[];
// A generated timeline join waits for existing clips. Keep this distinction
// outside StageAction so authoring data and ordinary pauses stay unchanged.
const timelineWaitActions = new WeakMap<StageAction, readonly StageAction[]>();
export const previewTimelineWaitActions = (action: StageAction) => timelineWaitActions.get(action);

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
    if (step.value.kind === 'awaitTask' || step.value.kind === 'taskCheckpoint' || step.value.kind === 'animateUi' || step.value.kind === 'playUiClip' || step.value.kind === 'confirm' || step.value.kind === 'menu' || step.value.kind === 'openPage' && step.value.wait) { runner.iterator.return(); break; }
  }
  return runner.actions;
}

/** Shared interpreter; UI callers retain the iterator while waiting for a page result. */
export function previewActionRunner(project: Project, source: StageAction[], context: PreviewActionContext, origins?: (Omit<PreviewActionOrigin, 'direct'> | undefined)[], eventData?:{graphId:string;nodeId:string}&Record<string,VariableValue>, playback?: PreviewPlayback, traceOrigin?: BlueprintTraceLocation & { parentStack?: BlueprintTraceFrame[] }, taskOptions?: { cooperative: boolean }) {
  const authoredProject = project;
  const unsupportedTimelines = playback?.unsupportedTimelines ?? new Set<string>();
  if (playback) project = playback.project;
  else if (!context.captureBlueprintCall) {
    if (!context.samplingTimelineNode) project = timelinePlaybackLayout(project);
    project = interleaveProjectTimelines(project,graph=>unsupportedTimelines.add(graph.id),context.samplingTimelineNode ? context.samplingGraphIds : undefined);
  }
  const traceStack: BlueprintTraceFrame[] = [...traceOrigin?.parentStack ?? []];
  const traceSources = context.trace ? createBlueprintPlaybackOrigins(authoredProject, project) : undefined;
  const traceNodes = new Map<number, string>();
  let cancelReason: string | undefined, failureReason: string | undefined, failures = 0, propertyBatchFailed = false;
  const observe = (data: BlueprintTraceData) => {
    if (!context.trace || !traceSources) return;
    const frame = traceStack.at(-1);
    context.trace.record(traceSources.stack(traceStack), traceSources.data({ nodeId: frame ? traceNodes.get(frame.id) : undefined, ...data }, frame?.graphId));
  };
  const fail = (reason: string, nodeId?: string, code = 'executionFailed') => { context.incomplete = true; failures++; failureReason ??= code; observe({ kind: 'stop', reason, ...(nodeId ? { nodeId } : {}) }); };
  // A rejected v1 transaction propagates through this entire invocation, like
  // its native exception. Existing single-property failures keep their behavior.
  const rejectPropertyBatch = (reason: string, nodeId: string) => { propertyBatchFailed = true; fail(reason, nodeId); };
  const actions: StageAction[] = [];
  const rootOutputs: Record<string, Record<string, VariableValue>> = {};
  const actorOverrides: NonNullable<Extract<StageAction, { kind: 'show' }>['actorTransitions']>[] = [];
  const activeGraphs = new Set<string>();
  let budget = taskOptions?.cooperative ? 100000 : 1024;
  const checkpoint = function* (nodeId: string): Generator<PreviewUiRequest, boolean, PreviewUiResult> {
    if (taskOptions?.cooperative) yield { kind: 'taskCheckpoint' };
    if (--budget < 0) { fail(taskOptions?.cooperative ? '任务达到 100000 个执行步骤的上限，已失败；未执行剩余节点。' : '当前静态预演达到执行步数上限；请使用按时间预演或实际游戏。', nodeId, 'stepLimit'); return false; }
    return true;
  };
  let origin: Omit<PreviewActionOrigin, 'direct'> | undefined, originalKind: StageAction['kind'] | undefined;
  const emit = function* (action: unknown, timelineActions?: readonly StageAction[]):PreviewActionIterator {
    if (action && typeof action === 'object' && 'kind' in action && action.kind === 'show') {
      const show = action as Extract<StageAction, { kind: 'show' }>;
      const resolved = show.characterId && show.expressionId ? show : resolveShowTarget(project, show, context.speakerId);
      if (!resolved) { if (show.characterId || show.expressionId && speakerExpression(project, context.speakerId)) fail('该节点的输入、目标或预览能力不可用。'); return; }
      if (!show.characterId && context.actors.get(actorKey(resolved))?.lifetime === 'persistent') resolved.lifetime = 'persistent';
      action = resolved;
    }
    if (action && typeof action === 'object' && 'kind' in action && action.kind === 'show' && 'presetId' in action && action.presetId) {
      const show = action as Extract<StageAction, { kind: 'show' }>;
      const reference = String(show.presetId), preset = characterDisplayPreset(project, show.characterId, reference);
      if (!preset) { fail('该节点的输入、目标或预览能力不可用。'); return; }
      action = { ...show, presetId: /^(default|默认|角色默认)$/.test(reference) ? 'default' : preset.id };
    }
    const parsed = actionSchema.safeParse(action);
    if (!parsed.success) { fail('该节点的输入、目标或预览能力不可用。'); return; }
    try {
      const action = parsed.data.kind === 'show' ? resolveShowAction(project, parsed.data) : parsed.data;
      if (action.kind === 'show' && !action.lifetime) action.lifetime = context.actors.get(actorKey(action))?.lifetime;
      if (action.kind === 'show') { const rules = resolveActorTransitions(project, action.characterId, action, actorOverrides.length ? Object.assign({}, ...actorOverrides) : undefined); if (rules) action.actorTransitions = rules; }
      actions.push(action);
      if (timelineActions) timelineWaitActions.set(action, timelineActions);
      if (origin) context.actionOrigins?.set(action, { ...origin, direct: activeGraphs.size === 0 && originalKind === action.kind });
      if (action.kind === 'show') context.actors.set(actorKey(action), action);
      if (action.kind === 'hide') context.actors.delete(actorKey(action));
      if (action.kind === 'background') for (const [id, actor] of context.actors) if (actor.lifetime !== 'persistent') context.actors.delete(id);
      if(context.yieldStageActions)yield {kind:'stage',action};
    }
    catch { fail('该节点的输入、目标或预览能力不可用。'); }
  };
  const expand = function* (source: StageAction[], locations?: typeof origins): PreviewActionIterator {
    for (const [index, raw] of source.entries()) {
      if (propertyBatchFailed) return;
      if (locations) { origin = locations[index]; originalKind = raw.kind; }
      for (const action of expandStageAction(project, raw)) {
      if (propertyBatchFailed) return;
      if (action.kind === 'blueprint') { if (action.actorTransitions) actorOverrides.push(action.actorTransitions); rootOutputs[action.blueprintId] = yield* run(action.blueprintId, action.inputs); if (action.actorTransitions) actorOverrides.pop(); }
      else if (action.kind === 'visual') yield* emit(applyVisualInputs(materializeVisualCompositions(project, action), {}));
      else yield* emit(action);
      }
    }
  };
  const run = function* (id: string, args: Record<string, VariableValue> = {}, launch = false, layerBase = 10, callNodeId?: string): Generator<PreviewUiRequest, Record<string, VariableValue>, PreviewUiResult> {
    const output: Record<string, VariableValue> = {};
    const graph = projectGraphs(project)?.find(g => g.id === id);
    if (!graph || unsupportedTimelines.has(id) || activeGraphs.has(id) || activeGraphs.size >= 16 || budget <= 0) {
      fail(!graph ? '调用的蓝图已不存在。' : unsupportedTimelines.has(id) ? '该时间轴尚不能在当前预览中执行，请使用实际试玩。' : activeGraphs.has(id) ? '递归调用已停止，避免无限执行。' : budget <= 0 ? '任务或静态预演达到执行步数上限，未进入后续模块。' : '已达到预演调用深度上限。', callNodeId, budget <= 0 ? 'stepLimit' : 'executionFailed');
      return output;
    }
    activeGraphs.add(id);
    const callLease = context.tasks?.enterCall(graph.id);
    for (const pin of graph.exposedOutputs) if (pin.defaultValue !== undefined) output[pin.id] = pin.defaultValue;
    const frame = context.trace?.frame(id, traceStack, traceOrigin, callNodeId);
    if (frame) traceStack.push(frame);
    observe({ kind: 'enter', graphId: id, nodeId: undefined, reason: callNodeId ? '进入调用模块' : traceOrigin?.trigger ?? '开始执行' });
    let completed = false;
    const failureStart = failures;
    try {
    const actionStart = actions.length;
    const nodes = new Map(graph.nodes.map(n => [n.id, n]));
    const results = new Map<string, Record<string, VariableValue>>();
    const locals: Record<string, VariableValue> = Object.fromEntries((graph.localVariables ?? []).map(variable => [variable.id, variable.initial]));
    const controls = new Map<string, boolean>();
    const cooldowns = new Map<string, number>();
    const loopIndices = new Map<string, number>();
    const reading = new Set<string>();
    const value = (node: BlueprintNode, pin: string): VariableValue | undefined => {
      const link = graph.links.find(l => l.toNodeId === node.id && l.toPinId === pin);
      if (!link) {
        const result = blueprintInputValue(node, pin);
        observe({ kind: 'input', nodeId: node.id, pinId: pin, value: result, available: result !== undefined });
        return result;
      }
      const key = `${link.fromNodeId}/${link.fromPinId}`;
      const from = nodes.get(link.fromNodeId);
      if (!from || reading.has(key)) { fail('该节点的输入、目标或预览能力不可用。'); return undefined; }
      if (context.pageInterface?.phase() === 'closed') { const problem = uiPageClosedOperationProblem(from); if (problem) { fail(problem, from.id); return undefined; } }
      reading.add(key);
      let resolved: VariableValue | undefined;
      let state: Partial<BlueprintTraceData> = {};
      const a = () => value(from, 'a'), b = () => value(from, 'b');
      switch (from.type) {
        case 'event': case 'eventPage': case 'eventValueChanged': case 'eventTextCommitted': case 'eventImage': case 'eventVideo': case 'eventSpine': resolved=eventData?.graphId===graph.id&&eventData.nodeId===from.id?eventData[link.fromPinId]:from.pins.find(p=>p.id===link.fromPinId)?.defaultValue; break;
        case 'literal': resolved = from.properties.value; break;
        case 'getPageInput': case 'getPageOutput': {
          const pageId = pageTarget(from, uiPageNodePageId(graph, from)), direction = from.type === 'getPageInput' ? 'inputs' : 'outputs';
          const expected = uiPageInterface(project, uiPageNodeContractId(graph, from))?.[direction].find(parameter => parameter.id === from.properties.parameterId);
          const actual = pageId ? uiPageInterface(project, pageId)?.[direction].find(parameter => parameter.id === from.properties.parameterId) : undefined;
          resolved = pageId && expected && actual?.dataType === expected.dataType ? context.pageInterface?.get(pageId, direction, actual.id) : undefined;
          if (!expected || !validUiPageParameterValue(expected.dataType, resolved)) { fail('页面参数、实例或类型契约不可用。', from.id); resolved = undefined; }
          break;
        }
        case 'getVariable': {
          const variable = blueprintStateVariable(project, graph, from), scope = blueprintStateScope(project, from);
          if (!variable) { fail('该节点的输入、目标或预览能力不可用。'); break; }
          const targetPageId = scope === 'page' ? pageTarget(from, blueprintStatePageId(graph, from)) : undefined;
          if (scope === 'page' && targetPageId === undefined) { fail('页面输入没有可用的页面标识，不会回退到声明页面。', from.id); break; }
          state = { scope, variableId: variable.id, targetPageId, targetPageInstance: targetPageId ? context.pageState?.instance?.(targetPageId) : undefined };
          resolved = scope === 'call' ? locals[variable.id] : targetPageId !== undefined ? context.pageState?.get(targetPageId, variable.id) : context.variables[variable.id];
          if (!validBlueprintStateValue(variable.type, resolved)) { fail('该节点的输入、目标或预览能力不可用。'); resolved = undefined; }
          break;
        }
        case 'getInput': resolved = args[String(from.properties.inputId)] ?? graph.exposedInputs.find(p => p.id === from.properties.inputId)?.defaultValue; break;
        case 'forLoop': resolved = loopIndices.get(from.id); break;
        case 'showUiPage': resolved = results.get(from.id)?.[link.fromPinId] ?? from.pins.find(pin => pin.id === link.fromPinId)?.defaultValue ?? ''; break;
        case 'startTask': case 'debounce': resolved = results.get(from.id)?.handle ?? ''; break;
        case 'cancelTask': resolved = results.get(from.id)?.cancelled ?? false; break;
        case 'focusUiComponent': resolved = results.get(from.id)?.accepted ?? false; break;
        case 'waitTask': resolved = results.get(from.id)?.[link.fromPinId.replace(/^out_/, '')] ?? (link.fromPinId === 'reason' ? '' : from.pins.find(pin => pin.id === link.fromPinId)?.defaultValue); break;
        case 'taskStatus': { const handle = value(from, 'handle'); if (typeof handle !== 'string' || !context.tasks) fail('读取任务需要有效标识和按时间预演。', from.id); else { const result = context.tasks.result(handle); resolved = link.fromPinId === 'reason' ? result.reason : result.status; } break; }
        case 'callFunction': case 'callMacro': resolved = results.get(from.id)?.[link.fromPinId.replace(/^out_/, '')]; break;
        case 'selectByKey': {
          const result = evaluateBlueprintChoice(from, pin => value(from, pin));
          if (result.ok) resolved = result.value; else fail(result.message, from.id);
          break;
        }
        case 'select': { const condition = value(from, 'condition'); resolved = typeof condition === 'boolean' ? value(from, condition ? 'true_value' : 'false_value') : undefined; break; }
        case 'not': case 'and': case 'or': case 'xor': {
          resolved = evaluateBlueprintLogic(from.type, pin => value(from, pin));
          if (resolved === undefined) fail('该节点的输入、目标或预览能力不可用。');
          break;
        }
        case 'compare': {
          const left = a(), right = b();
          if (left === undefined || right === undefined) break;
          resolved = from.properties.operator === 'ne' ? left !== right : from.properties.operator === 'gt' ? Number(left) > Number(right) : from.properties.operator === 'gte' ? Number(left) >= Number(right) : from.properties.operator === 'lt' ? Number(left) < Number(right) : from.properties.operator === 'lte' ? Number(left) <= Number(right) : left === right;
          break;
        }
        case 'clamp': case 'abs': case 'round': case 'inRange': case 'nearlyEqual': case 'mapRange': case 'lerp': {
          const result = evaluateBlueprintNumeric(from.type, pin => value(from, pin), from.properties.mode ?? 'nearest');
          if (result.ok) resolved = result.value; else fail(result.message, from.id);
          break;
        }
        case 'math': {
          const left = Number(a()), right = Number(b());
          const operation = String(from.properties.operation ?? from.properties.operator ?? 'add');
          const result = ['subtract', 'sub', '-'].includes(operation) ? left - right : ['multiply', 'mul', '*'].includes(operation) ? left * right : ['divide', 'div', '/'].includes(operation) ? left / right : ['modulo', 'mod', '%'].includes(operation) ? left % right : operation === 'min' ? Math.min(left, right) : operation === 'max' ? Math.max(left, right) : left + right;
          if (Number.isFinite(result)) resolved = result;
          break;
        }
        case 'formatText': { const input=value(from,'value'); if(input===undefined){fail('该节点的输入、目标或预览能力不可用。');break;} const text=typeof input==='boolean'?(input?'True':'False'):String(input); resolved=String(value(from,'format')??'{value}').replaceAll('{value}',text); break; }
        case 'getUiControlOption': {
          try {
            if (!uiControlOptionsKnown(from)) throw new Error('选项节点版本不受支持。');
            const option = context.ui?.getOption?.(String(value(from, 'componentId') ?? ''), value(from, 'index'), from.properties.valueType ?? 'string');
            if (!option || !['found', 'label', 'value'].includes(link.fromPinId)) fail('目标不是可用的选择控件。', from.id);
            else resolved = option[link.fromPinId as keyof UiControlOptionResult];
          } catch (error) { fail(error instanceof Error ? error.message : String(error), from.id); }
          break;
        }
        case 'getUiDefault': resolved = context.ui?.getDefault?.(String(value(from,'componentId')??''),String(from.properties.property??'visible')); if(resolved===undefined)fail('该节点的输入、目标或预览能力不可用。'); break;
        case 'getUiProperty': resolved = context.ui?.get(String(value(from,'componentId')??''),String(from.properties.property??'visible')); if(resolved===undefined)fail('该节点的输入、目标或预览能力不可用。'); break;
        case 'getPlayerPreference': { const preference = String(from.properties.preference) as PlayerPreference; const character=String(value(from,'characterId')??''); if(preference==='characterVolume'&&character&&!project.characters.some(c=>c.id===character)){fail('该节点的输入、目标或预览能力不可用。');break;} resolved = (preference==='characterVolume'?context.characterVolumes?.[character]:context.preferences?.[preference]) ?? project.playerDefaults?.[preference] ?? playerPreferences[preference]?.initial; break; }
      }
      reading.delete(key);
      observe({ kind: 'output', nodeId: from.id, pinId: link.fromPinId, value: resolved, available: resolved !== undefined, ...state });
      observe({ kind: 'input', nodeId: node.id, pinId: pin, value: resolved, available: resolved !== undefined, sourceNodeId: from.id, sourcePinId: link.fromPinId });
      if (resolved === undefined) fail('数据输入没有可用结果：目标缺失、来源尚未执行或该数据节点尚不支持预演。', from.id);
      return resolved;
    };
    const pageTarget = (node: BlueprintNode, fallback: string): string | undefined => {
      const input = value(node, 'pageId');
      const target = input === undefined && !graph.links.some(link => link.toNodeId === node.id && link.toPinId === 'pageId') ? fallback : input;
      return typeof target === 'string' ? target : undefined;
    };
    const walk = function* (target: string | { toNodeId: string; toPinId: string } | undefined): Generator<PreviewUiRequest, boolean, PreviewUiResult> {
      if (propertyBatchFailed) return true;
      const id = typeof target === 'string' ? target : target?.toNodeId;
      const entry = typeof target === 'object' ? target.toPinId : 'exec_in';
      if (!id) return false;
      if (!(yield* checkpoint(id))) return true;
      const node = nodes.get(id); if (!node) { fail('执行连线的目标节点已不存在。'); return false; }
      if (context.pageInterface?.phase() === 'closed') { const problem = uiPageClosedOperationProblem(node); if (problem) { fail(problem, node.id); return true; } }
      if (frame) traceNodes.set(frame.id, node.id);
      observe({ kind: 'node', nodeId: node.id });
      const next = (pin = node.type === 'editUiControlOptions' ? uiControlOptionExecutionPin(node) : 'exec_out') => graph.links.find(l => l.fromNodeId === id && l.fromPinId === pin);
      const layer = typeof node.properties.__timelineLayerOffset === 'number' ? layerBase + node.properties.__timelineLayerOffset : undefined;
      const v = (key: string, fallback?: VariableValue) => key === 'layer' && layer !== undefined ? layer : value(node, key) ?? fallback;
      const n = (key: string, fallback = 0) => Number(v(key, fallback));
      const timelineOverrides = (node.type === 'showCharacter' || node.type === 'savedAction') ? parseActorTransitions(node.properties.__timelineActorTransitions) : undefined;
      if (timelineOverrides) actorOverrides.push(timelineOverrides);
      try {
      switch (node.type) {
        case 'event': return yield* walk(next('exec'));
        case 'return': case 'finishMinigame': observe({ kind: 'return', nodeId: node.id, reason: '显式返回' }); return true;
        case 'throttle': {
          if (node.properties.taskVersion !== blueprintTaskVersion || !['call','page'].includes(String(node.properties.scope)) || !context.time) { fail('节流定义无效或当前预览没有时间轴。', node.id); return true; }
          const scope = blueprintTaskScope(node), pageId = scope === 'page' ? pageTarget(node, blueprintTaskPageId(graph, node)) : undefined;
          const result = scope === 'page' ? pageId ? context.pageState?.throttle?.(pageId, graph.id, node.id, entry, value(node, 'seconds')) : undefined : transitionBlueprintThrottle(entry, cooldowns.get(node.id), context.time(), value(node, 'seconds'));
          if (!result) { fail('节流秒数无效或所属页面实例已关闭。', node.id); return true; }
          if (scope === 'call') { if (result.until === undefined) cooldowns.delete(node.id); else cooldowns.set(node.id, result.until); }
          observe({ kind: 'branch', nodeId: node.id, pinId: result.output, scope, reason: '节流入口：' + entry });
          return yield* walk(next(result.output));
        }
        case 'startTask': case 'debounce': {
          const seconds = value(node, 'seconds'), target = projectGraphs(project).find(item => item.id === node.properties.graphId);
          const conflict = node.type === 'debounce' ? 'replace' : node.properties.conflict;
          if (node.properties.taskVersion !== blueprintTaskVersion || !['call','page'].includes(String(node.properties.scope)) || !['parallel','replace','ignore'].includes(String(conflict)) || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0 || !target || blueprintTaskProblems(project, target.id).length || !context.tasks || !callLease) { fail('任务模块、输入或生命周期无效；后台任务需要按时间预演。', node.id); return true; }
          const inputs: Record<string, VariableValue> = {};
          for (const pin of target.exposedInputs) { const input = v('arg_' + pin.id, pin.defaultValue); if (input !== undefined) inputs[pin.id] = input; }
          const scope = blueprintTaskScope(node), pageId = scope === 'page' ? pageTarget(node, blueprintTaskPageId(graph, node)) : undefined;
          const submitted = context.tasks.start({ scope, pageId, sourceGraphId: graph.id, nodeId: node.id, graphId: target.id, inputs, seconds, conflict: conflict as 'parallel' | 'replace' | 'ignore', call: callLease });
          if (!submitted) { fail('任务所属页面实例已失效，未启动任务。', node.id); return true; }
          results.set(node.id, { handle: submitted.handle }); observe({ kind: 'output', nodeId: node.id, pinId: 'handle', value: submitted.handle, available: true, reason: node.type === 'debounce' ? '替换旧任务，等待安静期。' : '安排独立任务。' });
          return yield* walk(next(submitted.output));
        }
        case 'cancelTask': {
          const handle = value(node, 'handle'); if (typeof handle !== 'string' || !context.tasks) { fail('取消任务需要文字标识和按时间预演。', node.id); return true; }
          results.set(node.id, { cancelled: context.tasks.cancel(handle) }); break;
        }
        case 'waitTask': {
          const handle = value(node, 'handle'), graphId = String(node.properties.graphId ?? '');
          if (typeof handle !== 'string' || !context.tasks) { fail('等待任务需要文字标识和按时间预演。', node.id); return true; }
          let result = context.tasks.result(handle, graphId);
          while (!blueprintTaskFinished(result.status)) { yield { kind: 'awaitTask', handle, graphId }; result = context.tasks.result(handle, graphId); }
          const output: Record<string, VariableValue> = { reason: result.reason };
          for (const pin of projectGraphs(project).find(item => item.id === graphId)?.exposedOutputs ?? []) { const value = result.status === 'completed' ? result.outputs[pin.id] ?? pin.defaultValue : pin.defaultValue; if (value !== undefined) output[pin.id] = value; }
          results.set(node.id, output); observe({ kind: 'branch', nodeId: node.id, pinId: result.status, reason: result.reason });
          return yield* walk(next(result.status));
        }
        case 'doOnce': case 'gate': {
          if (node.properties.scope !== undefined && !['call', 'page'].includes(String(node.properties.scope)) || node.properties.initiallyClosed !== undefined && typeof node.properties.initiallyClosed !== 'boolean') { fail('状态型节点的作用域或初始值无效。', node.id); return true; }
          const scope = blueprintFlowControlScope(node), initiallyClosed = blueprintFlowControlInitial(node);
          const pageId = scope === 'page' ? pageTarget(node, blueprintFlowControlPageId(graph, node)) : undefined;
          const result = scope === 'page' ? typeof pageId === 'string' ? context.pageState?.control?.(pageId, graph.id, node, entry) : undefined : transitionBlueprintFlowControl(node.type, entry, controls.get(node.id), initiallyClosed);
          if (!result) { fail('状态型节点的入口无效，或指定的页面实例已关闭。', node.id); return true; }
          if (scope === 'call') controls.set(node.id, result.closed);
          observe({ kind: 'branch', nodeId: node.id, pinId: result.output, scope, value: result.closed, available: true, reason: '入口：' + entry + (result.closed ? '；当前关闭/已执行。' : '；当前可通过。'), targetPageId: typeof pageId === 'string' ? pageId : undefined, targetPageInstance: typeof pageId === 'string' ? context.pageState?.instance?.(pageId) : undefined });
          return yield* walk(next(result.output));
        }
        case 'switchValue': {
          const result = selectBlueprintChoice(node, value(node, 'key'));
          if (!result.ok) { fail(result.message, node.id); return true; }
          observe({ kind: 'branch', nodeId: node.id, pinId: result.pinId, reason: result.caseId ? '命中枚举分支。' : '未匹配，执行其他情况。' });
          return yield* walk(next(result.pinId));
        }
        case 'branch': { const condition = value(node, 'condition'); if (typeof condition !== 'boolean') { fail('该节点的输入、目标或预览能力不可用。'); return true; } observe({ kind: 'branch', nodeId: node.id, pinId: condition ? 'true' : 'false', value: condition, available: true }); return yield* walk(next(condition ? 'true' : 'false')); }
        case 'sequence': for (const pin of node.pins.filter(p => p.direction === 'output' && p.dataType === 'exec')) if (yield* walk(next(pin.id))) return true; return false;
        case 'forLoop': {
          const first = v('first_index', 0), last = v('last_index', 3);
          if (typeof first !== 'number' || typeof last !== 'number' || !Number.isInteger(first) || !Number.isInteger(last) || Math.abs(first) > 100000 || Math.abs(last) > 100000 || (taskOptions?.cooperative ? last - first >= 100000 : last - first >= 256)) { fail(taskOptions?.cooperative ? '计数循环需要范围内的整数，单次最多 100000 次；整个任务另有总执行步数限制。' : '当前静态预演的计数循环需要范围内的整数，最多演示 256 次；请使用按时间预演或实际游戏。', node.id); return true; }
          loopIndices.set(node.id, first);
          while (loopIndices.get(node.id)! <= last) {
            if (yield* walk(next('loop_body'))) return true;
            // The native continuation revisits __next even for an empty body.
            // Charge and yield before advancing so cancellation/return never
            // manufactures a completed index or bypasses the task budget.
            if (!(yield* checkpoint(node.id))) return true;
            loopIndices.set(node.id, loopIndices.get(node.id)! + 1);
            if (frame) traceNodes.set(frame.id, node.id);
            observe({ kind: 'node', nodeId: node.id, reason: '计数循环检查下一轮' });
          }
          return yield* walk(next('completed'));
        }
        case 'setPlayerPreference': { const key=String(node.properties.preference) as PlayerPreference,result=value(node,'value'); const character=String(value(node,'characterId')??'');if(context.preferences&&result!==undefined&&validPlayerPreference(key,result)&&!(key==='characterVolume'&&character&&!project.characters.some(c=>c.id===character))){if(key==='characterVolume'&&context.characterVolumes)context.characterVolumes[character]=Number(result);else context.preferences[key]=result;}else fail('该节点的输入、目标或预览能力不可用。');break; }
        case 'setUiProperty': {
          const definition = blueprintUiPropertyDefinition(node);
          if (definition.legacy) {
            if (!context.ui?.set(String(v('componentId', '')), String(node.properties.property ?? 'visible'), value(node, 'value'), String(node.properties.writeMode ?? 'override'))) fail('该节点的输入、目标或预览能力不可用。', node.id);
            break;
          }
          if (!definition.rows || definition.problems.length) { rejectPropertyBatch(definition.problems.join('；') || '组件属性列表无效。', node.id); return true; }
          const inputFailures = failures, componentId = value(node, 'componentId');
          // Resolve every input before invoking the host. Linked reads therefore
          // see the same state even when this batch swaps two properties.
          const resolved = definition.rows.map(row => ({ property: row.property, value: value(node, row.id), writeMode: row.writeMode }));
          if (failures !== inputFailures || typeof componentId !== 'string' || resolved.some(row => row.value === undefined)) { rejectPropertyBatch('组件属性列表存在不可用的输入，未修改任何属性。', node.id); return true; }
          if (!context.ui?.setMany?.(componentId, resolved as BlueprintUiPropertyAssignment[])) { rejectPropertyBatch('组件属性列表的目标、来源或数值无效，未修改任何属性。', node.id); return true; }
          break;
        }
        case 'playUiAnimation': yield {kind:'playUiClip',animationId:String(node.properties.animationId??''),playMode:node.properties.playMode??'forward',loops:v('loops',1),speed:v('speed',1),fromCurrent:v('fromCurrent',false),wait:v('wait',true)};break;
        case 'stopUiAnimationPlayback': {const finish=v('finish',false);if(typeof finish!=='boolean'||!context.ui?.stopPlayback?.(String(node.properties.animationId??''),finish))fail('该节点的输入、目标或预览能力不可用。');break;}
        case 'animateUiProperty': yield {kind:'animateUi',componentId:String(v('componentId','')),property:String(node.properties.property??'opacity'),value:value(node,'value'),duration:v('duration',.3),easing:String(node.properties.easing??'ease'),wait:v('wait',true)}; break;
        case 'stopUiAnimation': { const finish=v('finish',false);if(typeof finish!=='boolean'||!context.ui?.stopAnimation?.(String(v('componentId','')),String(node.properties.property??'all'),finish))fail('该节点的输入、目标或预览能力不可用。');break; }
        case 'editUiControlOptions': {
          try {
            if (!uiControlOptionsKnown(node)) throw new Error('选项节点版本不受支持。');
            const input: UiControlOptionEdit = { valueType: node.properties.valueType ?? 'string' };
            for (const key of uiControlOptionEditInputs(node)) input[key as keyof UiControlOptionEdit] = value(node, key);
            if (!context.ui?.editOptions?.(String(value(node, 'componentId') ?? ''), node.properties.operation ?? 'insert', input)) fail('目标不是可用的选择控件。');
          } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
          break;
        }
        case 'focusUiComponent': {
          const focused = value(node, 'focused');
          if (typeof focused !== 'boolean' || !context.ui?.requestFocus) { fail('焦点操作需要有效的文字输入控件和开关值。'); break; }
          const accepted = context.ui.requestFocus(String(v('componentId', '')), focused);
          if (accepted === undefined) { fail('目标不是可用的文字输入控件。'); break; }
          results.set(node.id, { accepted }); break;
        }
        case 'setUiControlRange': if(!context.ui?.setRange?.(String(v('componentId','')), { min: value(node,'minimum') as number, max: value(node,'maximum') as number, step: value(node,'step') as number }))fail('控件范围无效，或目标不是可用的数值控件。'); break;
        case 'resetUiControlRange': if(!context.ui?.resetRange?.(String(v('componentId',''))))fail('该控件没有可重置的数值范围。'); break;
        case 'resetUiProperty': if(!context.ui?.resetProperty?.(String(v('componentId','')),String(node.properties.property??'visible')))fail('该节点的输入、目标或预览能力不可用。'); break;
        case 'playSpine': case 'pauseSpine': case 'setSpineSpeed': {
          try {
            const id = String(v('componentId', ''));
            const accepted = node.type === 'playSpine' ? context.ui?.playSpine?.(id, v('animation', ''), v('loop', true), v('restart', true))
              : node.type === 'pauseSpine' ? context.ui?.pauseSpine?.(id, v('paused', true)) : context.ui?.set(id, 'spineSpeed', v('speed', 1));
            if (!accepted) fail('骨骼控件、播放参数或当前页面实例不可用。');
          } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
          break;
        }
        case 'playUiVideo': case 'pauseUiVideo': case 'stopUiVideo': {
          const operation = node.type === 'playUiVideo' ? 'play' : node.type === 'pauseUiVideo' ? 'pause' : 'stop';
          const flag = operation === 'play' ? v('restart', false) : operation === 'pause' ? v('paused', true) : undefined;
          if (flag !== undefined && typeof flag !== 'boolean' || !context.ui?.video?.(String(v('componentId', '')), operation, flag as boolean | undefined)) fail('视频控件、播放参数或当前页面实例不可用。');
          break;
        }
        case 'resetUiComponent': if(!context.ui?.reset(String(v('componentId',''))))fail('该节点的输入、目标或预览能力不可用。'); break;
        case 'setVariable': {
          const result = value(node, 'value'), variable = blueprintStateVariable(project, graph, node), scope = blueprintStateScope(project, node);
          if (!variable || !validBlueprintStateValue(variable.type, result)) { fail('该节点的输入、目标或预览能力不可用。'); return true; }
          const targetPageId = scope === 'page' ? pageTarget(node, blueprintStatePageId(graph, node)) : undefined;
          if (scope === 'page' && targetPageId === undefined) { fail('页面输入没有可用的页面标识，不会回退到声明页面。', node.id); return true; }
          if (scope === 'call') locals[variable.id] = result;
          else if (targetPageId !== undefined) { if (!context.pageState?.set(targetPageId, variable.id, result)) { fail('目标页面未打开、状态已失效或类型不匹配。', node.id); return true; } }
          else if (context.setParameter) { if (!context.setParameter(variable.id, result)) { fail('参数赋值不适用于当前关联属性，原值已保留。', node.id); return true; } }
          else context.variables[variable.id] = result;
          observe({ kind: 'write', nodeId: node.id, variableId: variable.id, scope, value: result, available: true, targetPageId, targetPageInstance: targetPageId ? context.pageState?.instance?.(targetPageId) : undefined });
          break;
        }
        case 'setOutput': { const result = value(node, 'value'); const definition = graph.exposedOutputs.find(pin => pin.id === node.properties.outputId); if (taskOptions?.cooperative && (!definition || !validBlueprintTaskValue(definition.dataType, result))) { fail('任务模块的输出类型与接口不匹配。', node.id); return true; } if (result !== undefined) output[String(node.properties.outputId)] = result; observe({ kind: 'output', nodeId: node.id, pinId: String(node.properties.outputId), value: result, available: result !== undefined }); break; }
        case 'callFunction': case 'callMacro': {
          const target = projectGraphs(project)?.find(g => g.id === node.properties.graphId);
          if (!target) { fail('该节点的输入、目标或预览能力不可用。'); break; }
          const input: Record<string, VariableValue> = {};
          for (const pin of target.exposedInputs) { const argument = v(`arg_${pin.id}`, pin.defaultValue); if (argument !== undefined) input[pin.id] = argument; }
          if (context.captureBlueprintCall?.graphId === graph.id && context.captureBlueprintCall.nodeId === node.id) {
            context.captureBlueprintCall.inputs = input;
            return true;
          }
          const overrides = parseActorTransitions(node.properties.actorTransitions);
          if (overrides) actorOverrides.push(overrides);
          results.set(node.id, yield* run(target.id, input, node.properties.wait === false && canLaunchTimeline(project, target), layer ?? 10, node.id));
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
          let instanceId: string | undefined;
          try { instanceId = parseActorInstance(v('instanceId', '')); }
          catch (error) { fail(error instanceof Error ? error.message : String(error), node.id); break; }
          const existing = context.actors.get(actorKey({ characterId, instanceId }));
          const expression = speakerExpression(project, characterId, v('expressionId'));
          if (expression) yield* emit({ kind: 'show', actorTransitions: parseActorTransitions(node.properties.actorTransitions), ...(node.properties.moveOffsets ? { moveOffsets: nodeMoveOffsets(node) } : {}), ...(node.properties.afterOffsets ? { afterOffsets: nodeAfterOffsets(node) } : {}), characterId, expressionId: expression.id, instanceId, lifetime: !v('characterId') && existing?.lifetime === 'persistent' ? 'persistent' : v('lifetime', '') || undefined, x: n('x', 0.5), y: n('y', 1), scale: n('scale', 1), presetId: v('presetId', '') || undefined, ...(!v('presetId', '') && v('useDefaultFraming', false) ? portraitPlacement(project, characterId, expression.id, n('x', .5), n('y', 1), n('scale', 1)) : {}), layer: n('layer', 10), transition: v('transition', 'dissolve'), duration: n('duration', v('transition') === 'fade' ? 1 : .5), wait: v('wait', true) });
          else if (v('characterId') || v('expressionId') && speakerExpression(project, context.speakerId)) fail('该节点的输入、目标或预览能力不可用。');
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
          } else fail('该节点的输入、目标或预览能力不可用。');
          break;
        }
        case 'hideCharacter': {
          let instanceId: string | undefined;
          try { instanceId = parseActorInstance(v('instanceId', '')); }
          catch (error) { fail(error instanceof Error ? error.message : String(error), node.id); break; }
          yield* emit({ kind: 'hide', characterId: v('characterId'), instanceId, transition: v('transition', 'dissolve'), duration: n('duration', v('transition') === 'fade' ? 1 : .5), wait: v('wait', true) }); break;
        }
        case 'delay': {
          if (launch && node.id === graph.timeline?.tailNodeId) break;
          const timelineActions = node.id === graph.timeline?.tailNodeId ? actions.slice(actionStart) : undefined;
          const timing = timelineActions && performanceTiming(timelineActions);
          yield* emit({ kind: 'pause', seconds: timing ? Math.max(0, timing.until - timing.at) : n('seconds', 1) }, timelineActions); break;
        }
        case 'sceneAction': { const action = textCommandAction(project, String(v('command', ''))); if (action) yield* expand([action]); else fail('该节点的输入、目标或预览能力不可用。'); break; }
        case 'showUiPage': {
          const pageId = String(v('pageId', ''));
          if (!uiPage(project, pageId)) { fail('该节点的输入、目标或预览能力不可用。'); return true; }
          const modal = v('modalMode', 'page');
          if (!['page', 'modal', 'modeless', 'passthrough'].includes(String(modal))) { fail('该节点的输入、目标或预览能力不可用。'); return true; }
          const wait = Object.hasOwn(node.properties, 'wait') || graph.links.some(link => link.toNodeId === node.id && link.toPinId === 'wait') ? v('wait', true) : resolveUiPageOpening(project, pageId, node.pageOpening).wait, saveMode = v('saveMode', 'load');
          if (typeof wait !== 'boolean' || uiPageOpenProblem(project, pageId, wait, String(modal)) || pageId === 'ui:save' && !['save', 'load'].includes(String(saveMode))) { fail('该节点的输入、目标或预览能力不可用。'); return true; }
          const contractProblem = uiPageContractProblem(project, pageId, uiPageNodeContractId(graph, node));
          if (contractProblem) { fail(contractProblem, node.id); return true; }
          const supplied: Record<string, VariableValue> = {};
          for (const pin of node.pins.filter(pin => pin.direction === 'input' && pin.id.startsWith('arg_'))) { const input = value(node, pin.id); if (input !== undefined) supplied[pin.id.slice(4)] = input; }
          let inputs: Record<string, VariableValue>;
          try { inputs = uiPageInputValues(project, pageId, supplied); } catch (error) { fail(error instanceof Error ? error.message : String(error), node.id); return true; }
          const input = openingInputFromModal(modal);
          const opening = resolveUiPageOpening(project, pageId, { ...node.pageOpening, wait, ...(input ? { input } : {}) });
          const openingProblem = uiPageOpeningProblem(project, pageId, opening);
          if (openingProblem) { fail(openingProblem, node.id); return true; }
          const result = yield { kind: 'openPage', pageId, wait, inputs, opening, modal: opening.input === 'block', ...(pageId === 'ui:save' ? { saveMode: saveMode as 'save' | 'load' } : {}) };
          results.set(node.id, result && typeof result === 'object' ? { result: result.result, reason: result.reason, ...Object.fromEntries(Object.entries(result.outputs ?? {}).map(([id, value]) => ['out_' + id, value])) } : { result: String(result ?? ''), reason: 'completed' }); break;
        }
        case 'closeUiPage': {
          const pageId = String(v('pageId', ''));
          if (!uiPage(project, pageId) || uiPage(project, pageId)?.template && !uiPage(project, pageId)?.menuScreen) { fail('该节点的输入、目标或预览能力不可用。'); return true; }
          const problem = uiPageContractProblem(project, pageId, uiPageNodeContractId(graph, node));
          if (problem) { fail(problem, node.id); return true; }
          const outputs: Record<string, VariableValue> = {};
          for (const pin of node.pins.filter(pin => pin.direction === 'input' && pin.id.startsWith('out_'))) if (Object.hasOwn(node.properties, pin.id) || graph.links.some(link => link.toNodeId === node.id && link.toPinId === pin.id)) { const output = value(node, pin.id); if (output !== undefined) outputs[pin.id.slice(4)] = output; }
          yield { kind: 'closePage', pageId, result: String(v('result', '完成')), reason: uiPageReason(v('reason', 'completed')), outputs }; break;
        }
        case 'setPageOutput': {
          const pageId = pageTarget(node, uiPageNodePageId(graph, node)), parameterId = String(node.properties.parameterId ?? '');
          const expected = uiPageInterface(project, uiPageNodeContractId(graph, node))?.outputs.find(parameter => parameter.id === parameterId);
          const actual = pageId ? uiPageInterface(project, pageId)?.outputs.find(parameter => parameter.id === parameterId) : undefined, result = v('value');
          if (!pageId || !expected || actual?.dataType !== expected.dataType || !validUiPageParameterValue(expected.dataType, result) || !context.pageInterface?.setOutput(pageId, parameterId, result)) { fail('页面结果参数、实例或类型不兼容。', node.id); return true; }
          break;
        }
        case 'preventPageClose': { const pageId = pageTarget(node, uiPageNodePageId(graph, node)); if (!pageId || !context.pageInterface) { fail('页面关闭请求上下文不可用。', node.id); return true; } context.pageInterface.preventClose(pageId); break; }
        case 'confirmMessage': {
          const result = yield { kind: 'confirm', message: String(v('message', '确认继续吗？')) };
          return yield* walk(next(result === true ? 'yes' : 'no'));
        }
        case 'uiAction': {
          const screen = String(v('screen', 'pause_menu'));
          if (project.ui.customPages.some(page => page.id === screen)) yield { kind: 'openPage', pageId: screen, wait: true };
          else if (uiPage(project, screen)?.menuScreen && !uiPageOpenProblem(project, screen, true)) yield { kind: 'menu', screen: uiPage(project, screen)!.menuScreen! };
          else if (Object.hasOwn(blueprintScreens, screen)) yield { kind: 'menu', screen };
          else { fail('该节点的输入、目标或预览能力不可用。'); return true; }
          break;
        }
        case 'switchScene': fail('切换剧情场景需要实际试玩，页面预览在此停止。', node.id); return true;
        default: fail('此节点尚不支持页面预览，请使用实际试玩验证。', node.id);
      }
      } finally {
        if (timelineOverrides) actorOverrides.pop();
      }
      return yield* walk(next());
    };
    const entry = graph.nodes.find(n => n.type === 'event');
    if (!entry) fail('该蓝图没有可执行的事件入口。');
    else yield* walk(entry.id);
    completed = true;
    return output;
    } finally {
      const failed = failures !== failureStart;
      observe({ kind: completed && !failed ? 'return' : 'stop', reason: cancelReason ?? (failed ? '本次调用包含未支持的行为或无效输入。' : completed ? '调用执行结束。' : '调用已取消，未继续后续节点。') });
      if (callLease) context.tasks?.leaveCall(callLease);
      activeGraphs.delete(id);
      if (frame) { traceNodes.delete(frame.id); traceStack.pop(); }
    }
  };
  const iterator = (function* (): PreviewActionIterator {
  try { yield* expand(source, origins); } finally {
  if(context.actionOrigins)for(const action of actions){const origin=context.actionOrigins.get(action);if(!origin?.blueprintNodeId)continue;const node=projectGraphs(project).find(g=>g.id===origin.blueprintId)?.nodes.find(n=>n.id===origin.blueprintNodeId);if(node?.properties.__timelineGraph&&node.properties.__timelineNode)context.actionOrigins.set(action,{...origin,blueprintId:String(node.properties.__timelineGraph),blueprintNodeId:String(node.properties.__timelineNode)});}
  }
  })();
  return { actions, iterator, observe, outputs: (id: string) => ({ ...rootOutputs[id] }), failed: () => failures > 0, failureReason: () => failureReason, fail: (reason: string) => fail(reason), traceStack: () => traceSources?.stack(traceStack) ?? traceStack.map(frame => ({ ...frame })), cancel: (reason: string) => { cancelReason = reason; } };
}
