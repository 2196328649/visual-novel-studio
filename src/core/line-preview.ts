import { actorTransitionSeconds, actorTransitionDefaults, sameActorPose } from './actor-transitions';
import { advancePreviewVisual, previewVisualAction, type PreviewVisual } from './preview-visuals';
export type { PreviewVisual } from './preview-visuals';
import type { ActorTransitionRule } from './model';
import { carryPreviewAudio, type PreviewAudioEvent } from './preview-audio';
import { applyMoveOffsets, applyAfterOffsets, afterOffsetDuration } from './move-offsets';
import { effectiveScene, type Project, type StageAction, type StoryLine } from './model';
import { createPreviewActionExpander, previewActionContext } from './preview-actions';
import { actionTiming } from './performance-timing';
import { actorKey, actorReference } from './actor-instance';
import { actorAnimationDuration, actorCurvePose, sampleActorAnimation, type ActorAnimation } from './actor-animation';
import { cameraAnimationDuration, sampleCamera } from './camera-animation';
import { matches, previewRoute, type PreviewRouteChoices } from './preview-route';

export interface PreviewSelection { nodeId: string; lineId: string; routeChoices?: PreviewRouteChoices }
export type PreviewActor = Extract<StageAction, { kind: 'show' }> & { rotation: number; opacity: number; blendGroup?: string };
export type PreviewCamera = Extract<StageAction, { kind: 'camera' }>;
export interface PreviewActorMotion { action: ActorAnimation; initial: PreviewActor; elapsed: number; sourceShow?: Extract<StageAction, { kind: 'show' }> }
export interface PreviewTransitionMotion { before: PreviewStage; elapsed: number; duration: number; type: string }
export interface PreviewActorBlend { previous?: PreviewActor; current?: PreviewActor; rule: ActorTransitionRule; elapsed: number }
export interface PreviewStage { actorBlends?: Map<string, PreviewActorBlend>; actorGhosts?: PreviewActor[]; pendingActorExits?: Set<string>; interfaceVisible?: boolean; dialogue?: StoryLine; dialogueNodeId?: string; audio?: PreviewAudioEvent[]; settledShows: Map<string, PreviewActorMotion>; transitionMotion?: PreviewTransitionMotion; cameraMotion?: { action: PreviewCamera; initial: PreviewCamera; elapsed: number }; motions: Map<string, PreviewActorMotion>; visuals: Map<string, PreviewVisual>; backgroundId?: string; actors: Map<string, PreviewActor>; camera: PreviewCamera; musicId?: string; musicLoop: boolean }
export const initialPreviewStage = (): PreviewStage => ({ settledShows: new Map(), motions: new Map(), visuals: new Map(), actors: new Map(), camera: { kind: 'camera', x: 0, y: 0, zoom: 1, rotation: 0, duration: 0, easing: 'ease', wait: false }, musicLoop: true });
export const clonePreviewStage = (state: PreviewStage): PreviewStage => ({ ...state, actorBlends: new Map(state.actorBlends), pendingActorExits: new Set(state.pendingActorExits), settledShows: new Map(state.settledShows), motions: new Map(state.motions), visuals: new Map(state.visuals), actors: new Map(state.actors), camera: { ...state.camera } });
export function applyPreviewAction(state: PreviewStage, action: StageAction) {
  switch (action.kind) {
    case 'hideInterface': state.interfaceVisible = false; break;
    case 'showInterface': state.interfaceVisible = true; break;
    case 'visual': case 'hideVisual': {
      const { item } = previewVisualAction(state.visuals.get(action.instanceId), action);
      if (item) state.visuals.set(action.instanceId, item); else state.visuals.delete(action.instanceId);
      break;
    }
    case 'background': state.visuals.clear(); state.backgroundId = action.assetId; state.pendingActorExits?.clear(); for (const [id, blend] of state.actorBlends ?? []) if (!blend.current || blend.current.lifetime !== 'persistent') state.actorBlends!.delete(id); for (const [id, actor] of state.actors) if (actor.lifetime !== 'persistent') { state.actors.delete(id); state.motions.delete(id); state.settledShows.delete(id); } break;
    case 'show': { const key = actorKey(action); state.motions.delete(key); state.settledShows.delete(key); state.actors.set(key, { ...action, lifetime: action.lifetime ?? state.actors.get(key)?.lifetime, rotation: 0, opacity: 1 }); break; }
    case 'hide': state.settledShows.delete(actorKey(action)); state.actors.delete(actorKey(action)); state.motions.delete(actorKey(action)); break;
    case 'music': state.musicId = action.assetId; state.musicLoop = action.loop; break;
    case 'stopMusic': state.musicId = undefined; break;

    case 'camera': state.camera = action; delete state.cameraMotion; break;
    case 'animate': { state.settledShows.delete(actorKey(action)); const key = actorKey(action), actor = state.actors.get(key), frame = action.keyframes.at(-1); if (actor && frame) state.actors.set(key, actorCurvePose(action, actorAnimationDuration(action), { ...actor, presetId: undefined, x: frame.x, y: frame.y, scale: frame.scale, rotation: frame.rotation, opacity: frame.opacity })); break; }
  }
}
export function finishPreviewLine(state: PreviewStage) {
  for (const [id, actor] of state.actors) if (actor.lifetime === 'line') { if (actor.actorTransitions) { (state.pendingActorExits ??= new Set()).add(id); } else { state.actors.delete(id); state.motions.delete(id); state.settledShows.delete(id); } }
  for (const [id, visual] of state.visuals) if (visual.object.lifetime === 'line' && !visual.blend?.exiting) {
    const { item } = previewVisualAction(visual, { kind: 'hideVisual', instanceId: id, wait: false });
    if (item) state.visuals.set(id, item); else state.visuals.delete(id);
  }
}
export function finishPreviewPerformance(state: PreviewStage, actions: StageAction[]) {
  const visualIds = new Set(actions.flatMap(action => action.kind === 'visual' ? [action.instanceId] : []));
  const audioIds = new Set(actions.flatMap(action => action.kind === 'audioClip' ? ['clip:' + action.instanceId] : []));
  for (const id of visualIds) if (!state.visuals.get(id)?.object.persistent || state.visuals.get(id)?.object.lifetime === 'line') state.visuals.delete(id);
  state.audio = state.audio?.filter(event => { const key = event.key; return !key || ![...audioIds].some(id => key === id || key.startsWith(id + ':next')); });
}
export function linePreviewSnapshot(project: Project, selected?: PreviewSelection, actionCount?: number) {
  const state = initialPreviewStage(), context = previewActionContext(project);
  const expandActions = createPreviewActionExpander(project);
  context.actionOrigins = new Map();
  let sceneId: string | undefined;
  let before = initialPreviewStage();
  let actions: StageAction[] = [], selectedLine: StoryLine | undefined;
  const route = selected ? previewRoute(project, selected.nodeId, selected.routeChoices, expandActions) : undefined;
  const routeNote = !selected ? '' : !route ? `未找到${Object.keys(selected.routeChoices ?? {}).length ? '符合所选分支的' : '从故事入口到此处的'}可用路径；仅预览当前段落，不继承其他段落状态。` : route.choices.length ? `按${Object.keys(selected.routeChoices ?? {}).length ? '所选' : '一条可达'}示例路径预览（并非玩家历史）：${route.choices.join(' → ')}` : '';
  const routeDecisions = route?.decisions ?? [];
  if (!selected) return { before, after: state, actions, line: selectedLine, context, routeNote, routeDecisions };
  context.incomplete = !route || route.incomplete;
  const routeNodes = route?.nodes ?? project.nodes.filter(node => node.id === selected.nodeId);
  for (const node of routeNodes) {
    if (node.kind === 'jump' && node.sceneTransition) sceneId = undefined;
    if (node.kind === 'set' && (!node.when || matches(node.when, context.variables))) context.variables[node.variableId] = node.operation === 'add' ? Number(context.variables[node.variableId]) + Number(node.value) : node.value;
    if (node.kind === 'chapterTitle') {
      const chapterPlan=linePlaybackPlan(state,[{...node,kind:'chapter',wait:true}]);
      const chapterState=sampleLinePlayback(state,chapterPlan,chapterPlan.dialogueAt).state;
      state.audio=chapterState.audio; state.musicId=chapterState.musicId; state.musicLoop=chapterState.musicLoop;
    }
    if (node.kind !== 'passage') continue;
    for (const line of node.lines) {
      const selectedHere = node.id === selected.nodeId && line.id === selected.lineId;
      const scene = effectiveScene(project, node.sceneId);
      const entry = sceneId !== node.sceneId ? [...(scene?.entryActions ?? []), ...(scene?.blueprintId ? [{ kind: 'blueprint' as const, blueprintId: scene.blueprintId }] : [])] : [];
      sceneId = node.sceneId;
      context.speakerId = line.speakerId;
      const authored = line.actions.slice(0, selectedHere ? actionCount : undefined);
      // effectiveScene retains the authored entry array, including through inheritance.
      // Record its owner rather than writing an override onto the scene instance.
      const entryOwner = scene?.entryActions && project.scenes.find(item => item.entryActions === scene.entryActions);
      const current = expandActions([...entry, ...authored], context, [
        ...entry.map((_, actionIndex) => ({ nodeId: node.id, lineId: line.id, sceneId: entryOwner?.id ?? node.sceneId, actionIndex })),
        ...authored.map((_, actionIndex) => ({ nodeId: node.id, lineId: line.id, actionIndex })),
      ]);
      if (selectedHere) before = clonePreviewStage(state);
      const prior = clonePreviewStage(state);
      current.forEach(action => applyPreviewAction(state, action));
      const plan = linePlaybackPlan(prior, current);
      // Standalone performances finish before the next line. Dialogue advances
      // only explicit waits because player reading time is unknown.
      const sampled = sampleLinePlayback(prior, plan, line.silent && !selectedHere ? Math.max(plan.dialogueAt, plan.until) : plan.actionsEnd ?? plan.dialogueAt).state;
      state.actorBlends = sampled.actorBlends; state.actorGhosts = sampled.actorGhosts; state.pendingActorExits = sampled.pendingActorExits;
      state.actors = sampled.actors; state.motions = sampled.motions; state.settledShows = sampled.settledShows; state.visuals = sampled.visuals;
      state.audio = sampled.audio;
      state.camera = sampled.camera; state.cameraMotion = sampled.cameraMotion; state.transitionMotion = sampled.transitionMotion;
      if (!line.silent) { state.dialogue = line; state.dialogueNodeId = node.id; }
      if (selectedHere) { selectedLine = line; actions = current; return { before, after: state, actions, line: selectedLine, context, routeNote, routeDecisions }; }
      if (line.silent) finishPreviewPerformance(state, current);
      else { finishPreviewLine(state); for (const [id, actor] of context.actors) if (actor.lifetime === 'line' && !actor.actorTransitions) context.actors.delete(id); }
    }
  }
  return { before, after: state, actions, line: selectedLine, context, routeNote, routeDecisions };
}
export interface PreviewStep { at: number; duration: number; action: StageAction; before: PreviewStage; after: PreviewStage; actorTransition?: ActorTransitionRule; actorUnchanged?: boolean }
export interface LinePlaybackPlan { steps: PreviewStep[]; dialogueAt: number; until: number; actionsEnd?: number }
/** All timings are milliseconds. Nonblocking motion overlaps the following actions/dialogue. */
export function linePlaybackPlan(before: PreviewStage, actions: StageAction[]): LinePlaybackPlan {
  const steps: PreviewStep[] = [];
  const state = clonePreviewStage(before);
  let at = 0, until = 0, actorWaitUntil = 0, dialogueAt: number | undefined;
  for (const item of before.visuals.values()) if (item.blend) until = Math.max(until, (item.blend.rule.duration - item.blend.elapsed) * 1000);
  const continued = new Set(actions.filter(action => action.kind === 'show').map(actorKey));
  const departures: StageAction[] = [...(before.pendingActorExits ?? [])].filter(id => actions[0]?.kind !== 'background' && !continued.has(id) && !actions.some(action => action.kind === 'hide' && actorKey(action) === id)).flatMap(id => {
    const actor = before.actors.get(id), rule = actor?.actorTransitions?.exit;
    return actor && rule ? [{ kind: 'hide' as const, ...actorReference(actor), transition: rule.mode, duration: rule.duration, wait: actor.wait !== false }] : [];
  });
  const visualEnds = new Map([...before.visuals].filter(([, item]) => !item.object.persistent).map(([id, item]) => [id, Math.max(0, (actionTiming(item.object).duration - item.elapsed) * 1000)]));
  const finishVisual = (id: string) => {
    const end = visualEnds.get(id);
    if (end !== undefined) until = Math.max(until, Math.min(at, end));
    visualEnds.delete(id);
  };
  for (const action of [...departures, ...actions]) {
    const modern = action.kind === 'show' ? !!action.actorTransitions : action.kind === 'hide' && !!state.actors.get(actorKey(action))?.actorTransitions;
    if (!modern) at = Math.max(at, actorWaitUntil);
    if (action.kind === 'startDialogue' && dialogueAt === undefined) dialogueAt = at;
    const prior = sampleLinePlayback(before, { steps, dialogueAt: at, until: at }, at).state;
    const previous = action.kind === 'show' || action.kind === 'hide' ? prior.actors.get(actorKey(action)) : undefined;
    const unchanged = action.kind === 'show' && modern && !!previous && sameActorPose(previous, action);
    const rule = modern ? action.kind === 'show' ? unchanged ? { mode: 'none' as const, duration: 0 } : (action.actorTransitions?.[previous?.characterId === action.characterId ? 'expression' : 'enter'] ?? actorTransitionDefaults(action.transition, action.duration).enter) : action.kind === 'hide' ? { mode: action.transition, duration: action.duration ?? .5 } : undefined : undefined;
    const visual = action.kind === 'visual' || action.kind === 'hideVisual' ? previewVisualAction(prior.visuals.get(action.instanceId), action) : undefined;
    const timing = actionTiming(action), duration = (rule ? actorTransitionSeconds(rule) : action.kind === 'hideVisual' ? visual!.seconds : timing.duration) * 1000, wait = action.kind === 'hideVisual' ? action.wait !== false : timing.wait;
    applyPreviewAction(state, action);
    if (action.kind === 'show' || action.kind === 'hide') state.pendingActorExits?.delete(actorKey(action));
    steps.push({ at, duration, action, before: prior, after: clonePreviewStage(state), actorTransition: rule, actorUnchanged: unchanged });
    if (action.kind === 'background') for (const id of visualEnds.keys()) finishVisual(id);
    if (action.kind === 'visual') {
      finishVisual(action.instanceId);
      if (!action.persistent) visualEnds.set(action.instanceId, at + duration);
      until = Math.max(until, at + visual!.seconds * 1000);
    } else if (action.kind === 'hideVisual') { finishVisual(action.instanceId);
      until = Math.max(until, at + duration);
    } else if (action.kind !== 'camera' && action.kind !== 'animate') until = Math.max(until, at + duration + (action.kind === 'show' ? afterOffsetDuration(action.afterOffsets) * 1000 : 0));
    if (wait) { if (modern) actorWaitUntil = Math.max(actorWaitUntil, at + duration); else at += duration; }
    else if (action.kind === 'visual' && action.transitionWait) at += visual!.seconds * 1000;
  }
  at = Math.max(at, actorWaitUntil);
  until = Math.max(until, at, ...visualEnds.values());
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index], action = step.action;
    if (action.kind !== 'camera' && action.kind !== 'animate') continue;
    let end = step.at + step.duration;
    for (let next = index + 1; next < steps.length; next++) {
      const replacement = steps[next];
      if (replacement.at >= end) break;
      const candidate = replacement.action;
      const replaces = action.kind === 'camera' ? candidate.kind === 'camera' :
        (candidate.kind === 'show' || candidate.kind === 'hide' || candidate.kind === 'animate') && actorKey(candidate) === actorKey(action) ||
        candidate.kind === 'background' && step.before.actors.get(actorKey(action))?.lifetime !== 'persistent';
      if (replaces) { end = replacement.at; break; }
    }
    until = Math.max(until, end);
  }
  if (before.cameraMotion) {
    const remaining = Math.max(0, cameraAnimationDuration(before.cameraMotion.action) - before.cameraMotion.elapsed) * 1000;
    until = Math.max(until, Math.min(remaining, steps.find(step => step.action.kind === 'camera')?.at ?? remaining));
  }
  for (const [id, motion] of before.motions) {
    const duration = actorAnimationDuration(motion.action) + (motion.sourceShow ? afterOffsetDuration(motion.sourceShow.afterOffsets) : 0);
    let end = Math.max(0, duration - (motion.action.repeat && duration > 0 ? motion.elapsed % duration : motion.elapsed)) * 1000;
    for (const step of steps) {
      const action = step.action;
      if ((action.kind === 'show' || action.kind === 'hide' || action.kind === 'animate') && actorKey(action) === id || action.kind === 'background' && before.actors.get(id)?.lifetime !== 'persistent') { end = Math.min(end, step.at); break; }
    }
    until = Math.max(until, end);
  }
  if (before.transitionMotion) {
    const remaining = Math.max(0, before.transitionMotion.duration - before.transitionMotion.elapsed) * 1000;
    const next = steps.find(step => 'transition' in step.action && !['none', 'move'].includes(step.action.transition));
    until = Math.max(until, Math.min(remaining, next?.at ?? remaining));
  }
  for (const [id, blend] of before.actorBlends ?? []) {
    const remaining = Math.max(0, actorTransitionSeconds(blend.rule) - blend.elapsed) * 1000;
    const replacement = steps.find(step => !step.actorUnchanged && ((step.action.kind === 'show' || step.action.kind === 'hide') && actorKey(step.action) === id || step.action.kind === 'background' && blend.current?.lifetime !== 'persistent'));
    until = Math.max(until, Math.min(remaining, replacement?.at ?? remaining));
  }
  return { steps, dialogueAt: dialogueAt ?? at, until, actionsEnd: at };
}

/** Sound events use the same millisecond clock as stage actions. */
export function linePlaybackAudio(before:PreviewStage,plan:LinePlaybackPlan):PreviewAudioEvent[] {
 const events:PreviewAudioEvent[]=[...(before.audio??(before.musicId?[{id:before.musicId,channel:'music' as const,at:0,loop:before.musicLoop}]:[]))];
 for(const step of plan.steps) {
  const action=step.action;
  if(action.kind==='music')events.push({id:action.assetId,channel:'music',at:step.at,loop:action.loop,fade:step.duration});
  if(action.kind==='chapter'&&action.soundId)events.push({id:action.soundId,channel:'sound',at:step.at});
  if(action.kind==='audioClip'){let key='clip:'+action.instanceId;while(events.some(e=>e.key===key))key+=':next';events.push({id:action.assetId,key,channel:action.bus,at:step.at,duration:step.duration,offset:action.offset*1000,volume:action.volume,fade:Math.min(action.fadeIn*1000,step.duration),fadeOut:Math.min(action.fadeOut*1000,step.duration)});}
  if(action.kind==='sound')events.push({id:action.assetId,channel:'sound',at:step.at});
  if(action.kind==='stopMusic')events.push({channel:'music',at:step.at,fade:step.duration});
 }
 return events.sort((a,b)=>a.at-b.at);
}

/** Sample an actual time, including overlapping motion and chapter masks. */
export function sampleLinePlayback(before: PreviewStage, plan: ReturnType<typeof linePlaybackPlan>, milliseconds: number): { state: PreviewStage; chapter?: { action: Extract<StageAction, {kind: 'chapter'}>; elapsed: number }; transition?: { before: PreviewStage; progress: number; type: string }; shake: {x:number;y:number}; visuals: PreviewVisual[] } {
  const state = clonePreviewStage(before);
  let chapter: { action: Extract<StageAction, { kind: 'chapter' }>; elapsed: number } | undefined;
  let transition: { before: PreviewStage; progress: number; type: string } | undefined;
  let shake = { x: 0, y: 0 };
  if (state.transitionMotion) {
    const motion = state.transitionMotion, elapsed = motion.elapsed + Math.max(0, milliseconds) / 1000;
    if (elapsed < motion.duration) {
      state.transitionMotion = { ...motion, elapsed };
      transition = { before: sampleLinePlayback(motion.before, {steps: [], dialogueAt: 0, until: 0}, elapsed * 1000).state, progress: elapsed / motion.duration, type: motion.type };
    } else delete state.transitionMotion;
  }
  if (state.cameraMotion) {
    const motion = state.cameraMotion, elapsed = motion.elapsed + Math.max(0, milliseconds) / 1000;
    state.camera = sampleCamera(motion.initial, motion.action, elapsed);
    state.cameraMotion = elapsed < cameraAnimationDuration(motion.action) ? { ...motion, elapsed } : undefined;
  }
  for (const [id, motion] of state.settledShows) state.settledShows.set(id, { ...motion, elapsed: motion.elapsed + Math.max(0, milliseconds) / 1000 });
  for (const [id, motion] of state.motions) {
    const elapsed = motion.elapsed + Math.max(0, milliseconds) / 1000;
    if (state.actors.has(id)) {
      const pose = sampleActorAnimation(motion.action, elapsed, motion.initial);
      const duration = actorAnimationDuration(motion.action);
      state.actors.set(id, motion.sourceShow ? applyAfterOffsets(applyMoveOffsets(pose, motion.sourceShow, duration > 0 ? Math.min(1, elapsed / duration) : 1), motion.sourceShow, elapsed - duration) : pose);
    }
    if (!motion.action.repeat && elapsed >= actorAnimationDuration(motion.action) + (motion.sourceShow ? afterOffsetDuration(motion.sourceShow.afterOffsets) : 0)) { state.motions.delete(id); if (motion.sourceShow) state.settledShows.set(id, {...motion,elapsed}); }
    else state.motions.set(id, { ...motion, elapsed });
  }
  for (const [id, blend] of state.actorBlends ?? []) state.actorBlends!.set(id, { ...blend, elapsed: blend.elapsed + Math.max(0, milliseconds) / 1000 });
  const visuals = state.visuals;
  for (const [id, item] of visuals) {
    const next = advancePreviewVisual(item, Math.max(0, milliseconds) / 1000);
    if (next) visuals.set(id, next); else visuals.delete(id);
  }
  for (const step of plan.steps) {
    if (step.at > milliseconds) break;
    const { action, duration } = step, elapsed = Math.max(0, milliseconds - step.at);
    const progress = duration > 0 ? Math.min(1, elapsed / duration) : 1;
    applyPreviewAction(state, action);
    if (action.kind === 'show' || action.kind === 'hide') state.pendingActorExits?.delete(actorKey(action));
    if (step.actorTransition && (action.kind === 'show' || action.kind === 'hide')) {
      const id = actorKey(action);
      if (action.kind === 'show' && (action.moveOffsets || action.afterOffsets)) {
        const actor = step.after.actors.get(id)!;
        const motion: ActorAnimation = { kind: 'animate', ...actorReference(actor), wait: false, repeat: false, keyframes: [{ x: actor.x, y: actor.y, scale: actor.scale, rotation: 0, opacity: 1, duration: duration / 1000, easing: 'linear' }] };
        state.actors.set(id, applyAfterOffsets(applyMoveOffsets(actor, action, progress), action, (elapsed - duration) / 1000));
        const ongoing = elapsed < duration + afterOffsetDuration(action.afterOffsets) * 1000;
        (ongoing ? state.motions : state.settledShows).set(id, { action: motion, initial: actor, elapsed: elapsed / 1000, sourceShow: action });
      }
      if (!step.actorUnchanged) {
        if (elapsed < duration) (state.actorBlends ??= new Map()).set(id, { previous: step.before.actors.get(id), current: action.kind === 'show' ? step.after.actors.get(id) : undefined, rule: step.actorTransition, elapsed: elapsed / 1000 });
        else state.actorBlends?.delete(id);
      }
      continue;
    }
    if ('transition' in action && action.transition !== 'none' && progress < 1 && !(action.kind === 'show' && action.transition === 'move')) {
      const prior = { ...step.before, transitionMotion: undefined };
      transition = { before: sampleLinePlayback(prior, {steps: [], dialogueAt: 0, until: 0}, elapsed).state, progress, type: action.transition };
      state.transitionMotion = { before: prior, elapsed: elapsed / 1000, duration: duration / 1000, type: action.transition };
    }
    if ('transition' in action && !['none', 'move'].includes(action.transition) && progress === 1) { transition = undefined; delete state.transitionMotion; }
    if (action.kind === 'show') {
      const key = actorKey(action), actor = step.after.actors.get(key)!;
      const previous = step.before.actors.get(key), moving = action.transition === 'move';
      const initial = moving ? { ...actor, x: previous?.x ?? actor.x - .15, y: previous?.y ?? actor.y, scale: previous?.scale ?? actor.scale, opacity: previous?.opacity ?? 0 } : actor;
      const motion: ActorAnimation = { kind: 'animate', ...actorReference(actor), wait: false, repeat: false, keyframes: [{ x: actor.x, y: actor.y, scale: actor.scale, rotation: actor.rotation, opacity: 1, duration: duration / 1000, easing: moving ? 'easeout' : 'linear' }] };
      const pose = sampleActorAnimation(motion, elapsed / 1000, initial);
      state.actors.set(key, applyAfterOffsets(applyMoveOffsets(pose, action, progress), action, (elapsed - duration) / 1000));
      const ongoing = elapsed < duration + afterOffsetDuration(action.afterOffsets) * 1000;
      if (!ongoing) state.motions.delete(key);
      (ongoing ? state.motions : state.settledShows).set(key, { action: motion, initial, elapsed: elapsed / 1000, sourceShow: action });
    }
    if (action.kind === 'camera') {
      state.camera = sampleCamera(step.before.camera, action, elapsed / 1000);
      state.cameraMotion = elapsed < duration ? { action, initial: step.before.camera, elapsed: elapsed / 1000 } : undefined;
    }
    if (action.kind === 'animate') {
      const key = actorKey(action), initial = step.before.actors.get(key);
      if (initial) {
        state.actors.set(key, sampleActorAnimation(action, elapsed / 1000, initial));
        if (action.repeat || elapsed < duration) state.motions.set(key, { action, initial, elapsed: elapsed / 1000 });
        else state.motions.delete(key);
      }
    }
    if (action.kind === 'shake' && progress < 1) {
      const offset = Math.sin(elapsed / 1000 * 16 * Math.PI * 2) * (action.amplitude ?? 20) * (1 - progress);
      shake = action.direction === 'horizontal' ? { x: offset, y: 0 } : { x: 0, y: offset };
    }
    if (action.kind === 'chapter') chapter = elapsed < duration ? { action, elapsed: elapsed / 1000 } : undefined;
    if (action.kind === 'visual' || action.kind === 'hideVisual') {
      const created = previewVisualAction(step.before.visuals.get(action.instanceId), action).item;
      const next = created && advancePreviewVisual(created, elapsed / 1000);
      if (next) visuals.set(action.instanceId, next); else visuals.delete(action.instanceId);
    }
  }
  state.actorGhosts = [];
  for (const [id, blend] of state.actorBlends ?? []) {
    const seconds = actorTransitionSeconds(blend.rule), progress = seconds ? Math.min(1, blend.elapsed / seconds) : 1;
    const split = blend.rule.mode === 'fade' && blend.previous && blend.current;
    const blendGroup = blend.rule.mode === 'dissolve' && blend.previous && blend.current && progress < 1 ? id : undefined;
    const incoming = split ? Math.max(0, progress * 2 - 1) : progress, outgoing = split ? Math.max(0, 1 - progress * 2) : 1 - progress;
    if (blend.current && state.actors.has(id)) { const actor = state.motions.has(id) || state.settledShows.has(id) ? state.actors.get(id)! : blend.current; state.actors.set(id, { ...actor, blendGroup, opacity: actor.opacity * incoming, x: actor.x + (blend.rule.mode === 'move' ? (progress - 1) * .15 : 0) }); }
    if (blend.previous && outgoing > 0) state.actorGhosts.push({ ...blend.previous, blendGroup, instanceId: 'transition_' + id.replaceAll(':', '_'), opacity: blend.previous.opacity * outgoing, x: blend.previous.x + (blend.rule.mode === 'move' ? progress * .15 : 0) });
    if (progress >= 1) state.actorBlends!.delete(id);
  }
  state.audio = carryPreviewAudio(linePlaybackAudio(before,plan),milliseconds);
  return { state, chapter, transition, shake, visuals: [...visuals.values()] };
}
