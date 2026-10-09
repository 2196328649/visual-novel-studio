import { projectGraphs, addProjectGraphs } from './project-resources';
import { setAfterOffsets, setMoveOffsets, nodeMoveOffsets, supportsEntranceOffsets } from './move-offsets';
import { availableBlueprintName } from './blueprint-names';
import { blueprintFromPerformance, rawSavedBlueprintAction } from './blueprint-authoring';
import type { PreviewActionOrigin } from './preview-actions';
import { actionSchema, type Project, type StageAction } from './model';
import { blueprintInputValue, blueprintNodeDefaults, callablePins } from './blueprint';
import { setCameraPoseAt, type CameraAction, type CameraPose } from './camera-animation';
import { setVisualPropertiesAt, type VisualCurveProperty } from './visual-object';
import { visualInstancePath } from './visual-selection';
import type { PreviewStage } from './line-preview';
import type { VisualObject } from './model';
import { isStandaloneNode } from './standalone-performance';
import { actorKey, actorReference } from './actor-instance';
import { detachDisplayPreset } from './character-presets';
import { actorCurveProperties, setActorAnimationPoseAt } from './actor-animation';
import { actionTiming } from './performance-timing';
import { linePlaybackPlan, sampleLinePlayback } from './line-preview';
import { linePreviewSnapshot, type PreviewActor, type PreviewSelection } from './line-preview';
import { applyTextScript, linePerformanceText, playbackText, standaloneText, projectToText, textReference, type TextSourceLocation, type TextNodeLocation } from './text-script';

export type StageCommit = (label: string, edit: (project: Project) => void) => { source: string; sourceMap: TextSourceLocation[] } | undefined;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const lastIndex = (actions: StageAction[], match: (action: StageAction) => boolean) => actions.reduce((found, action, index) => match(action) ? index : found, -1);
const lineFor = (project: Project, selection: PreviewSelection) => {
  const node = project.nodes.find(node => node.id === selection.nodeId);
  return node?.kind === 'passage' ? node.lines.find(line => line.id === selection.lineId) : undefined;
};
const opaque = (action: StageAction) => ['effect', 'blueprint', 'characterFeature'].includes(action.kind);
const actorAction = (action: StageAction): action is Extract<StageAction, { kind: 'show' | 'hide' | 'animate' | 'characterFeature' }> => ['show', 'hide', 'animate', 'characterFeature'].includes(action.kind);
const actorKeyOf = (action: StageAction) => {
  if (!actorAction(action)) return;
  const instanceId = 'instanceId' in action && typeof action.instanceId === 'string' ? action.instanceId : undefined;
  return actorKey({ characterId: action.characterId, ...(instanceId ? { instanceId } : {}) });
};
const affectsActor = (action: StageAction, id: string) => action.kind === 'background' || opaque(action) || actorKeyOf(action) === id;
const showActor = ({ characterId, instanceId, lifetime, expressionId, x, y, scale, layer, transition, presetId }: PreviewActor): Extract<StageAction, { kind: 'show' }> => ({ kind: 'show', characterId, instanceId, lifetime, expressionId, x, y, scale, layer, transition, ...(presetId ? { presetId } : {}) });

function editDynamicEntrance(project: Project, origin: PreviewActionOrigin | undefined, action: Extract<StageAction, { kind: 'show' }>, phase: number, current: PreviewActor, patch: Partial<PreviewActor>) {
  if (!['move', 'dissolve', 'fade'].includes(action.transition) || phase < 0 || phase > 1) return false;
  if (origin?.direct) {
    const actions = origin.sceneId ? project.scenes.find(scene => scene.id === origin.sceneId)?.entryActions : lineFor(project, origin)?.actions;
    const source = actions?.[origin.actionIndex];
    if (source?.kind === 'show' && (source.moveOffsets || !source.characterId)) { setMoveOffsets(source, phase, current, patch); return true; }
  }
  const graph = projectGraphs(project).find(graph => graph.id === origin?.blueprintId);
  const node = graph?.nodes.find(node => node.id === origin?.blueprintNodeId);
  if (!graph || !node || !supportsEntranceOffsets(node)) return false;
  const dynamic = node.type === 'showCharacter' && !node.properties.characterId || nodeMoveOffsets(node) || graph.links.some(link => link.toNodeId === node.id && node.pins.some(pin => pin.id === link.toPinId && pin.dataType !== 'exec'));
  if (!dynamic) return false;
  setMoveOffsets(node, phase, current, patch);
  return true;
}

function editAfterEntrance(project: Project, origin: PreviewActionOrigin | undefined, seconds: number, current: PreviewActor, patch: Partial<PreviewActor>) {
  if (seconds < 0 || !origin) return false;
  const graph = projectGraphs(project).find(graph => graph.id === origin.blueprintId), node = graph?.nodes.find(node => node.id === origin.blueprintNodeId);
  if (node && supportsEntranceOffsets(node)) { setAfterOffsets(node, seconds, current, patch); return true; }
  const actions = origin.direct ? origin.sceneId ? project.scenes.find(scene => scene.id === origin.sceneId)?.entryActions : lineFor(project, origin)?.actions : undefined;
  const action = actions?.[origin.actionIndex];
  if (action?.kind === 'show' && (!action.characterId || action.moveOffsets || action.afterOffsets || action.wait === false && action.transition !== 'none')) { setAfterOffsets(action, seconds, current, patch); return true; }
  return false;
}

function showSource(project: Project, origin: PreviewActionOrigin | undefined, resolved: Extract<StageAction, { kind: 'show' }>) {
  if (!origin) return;
  if (origin.blueprintId && origin.blueprintNodeId) {
    const graph = projectGraphs(project).find(graph => graph.id === origin.blueprintId);
    const node = graph?.nodes.find(node => node.id === origin.blueprintNodeId);
    if (!graph || !node) return;
    const saved = rawSavedBlueprintAction(node);
    if (node.type !== 'showCharacter' && saved?.kind !== 'show') return;
    if (graph.links.some(link => link.toNodeId === node.id && node.pins.some(pin => pin.id === link.toPinId && pin.dataType !== 'exec'))) throw new Error('角色显示参数由数据连线控制，请在来源蓝图中编辑。');
    const action = saved?.kind === 'show' ? saved : { ...resolved, lifetime: blueprintInputValue(node, 'lifetime') || undefined } as Extract<StageAction, { kind: 'show' }>;
    return { action, replace: (actions: StageAction[]) => {
      const child = blueprintFromPerformance(project, actions, availableBlueprintName(project, '入场动作'));
      child.timelineComponent = true;
      addProjectGraphs(project, child);
      node.type = 'callFunction'; node.properties = { graphId: child.id }; node.pins = callablePins(child);
    } };
  }
  const actions = origin.direct ? origin.sceneId ? project.scenes.find(scene => scene.id === origin.sceneId)?.entryActions : lineFor(project, origin)?.actions : undefined;
  const action = actions?.[origin.actionIndex];
  if (actions && action?.kind === 'show') return { action, replace: (replacement: StageAction[]) => { actions.splice(origin.actionIndex, 1, ...replacement); } };
}

function animationSource(project: Project, origin?: PreviewActionOrigin) {
  if (!origin) return;
  if (origin.blueprintId && origin.blueprintNodeId) {
    const graph = projectGraphs(project).find(graph => graph.id === origin.blueprintId);
    const node = graph?.nodes.find(node => node.id === origin.blueprintNodeId);
    const action = node && rawSavedBlueprintAction(node);
    if (node && action?.kind === 'animate') return { action, name: `共享演出 ${graph!.name} / ${node.name}`, save: () => { node.properties.action = JSON.stringify(action); } };
  }
  if (origin.sceneId) {
    const scene = project.scenes.find(scene => scene.id === origin.sceneId);
    const action = origin.direct && scene?.entryActions?.[origin.actionIndex];
    if (action && action.kind === 'animate') return { action, name: `场景入口 ${scene!.name}`, save: () => {} };
    return;
  }
  const line = origin.direct ? lineFor(project, origin) : undefined;
  const action = line && line.actions[origin.actionIndex];
  if (action?.kind === 'animate') return { action, name: line!.text.slice(0, 24) || origin.lineId, save: () => {} };
}

function cameraSource(project: Project, origin: PreviewActionOrigin | undefined, resolved: CameraAction) {
  if (!origin) return;
  if (origin.blueprintId && origin.blueprintNodeId) {
    const graph = projectGraphs(project).find(graph => graph.id === origin.blueprintId);
    const node = graph?.nodes.find(node => node.id === origin.blueprintNodeId);
    const saved = node && rawSavedBlueprintAction(node);
    if (node && saved?.kind === 'camera') return { action: saved, name: `共享演出 ${graph!.name} / ${node.name}`, save: () => { node.properties.action = JSON.stringify(saved); } };
    if (node?.type === 'camera') {
      if (graph!.links.some(link => link.toNodeId === node.id && node.pins.some(pin => pin.id === link.toPinId && pin.dataType !== 'exec'))) throw new Error('镜头参数由数据连线控制，请在来源蓝图中编辑。');
      const action = structuredClone(resolved);
      return { action, name: `共享演出 ${graph!.name} / ${node.name}`, save: () => {
        node.type = 'savedAction'; node.properties = { action: JSON.stringify(actionSchema.parse(action)) }; node.pins = blueprintNodeDefaults('savedAction').pins;
      } };
    }
    return;
  }
  const actions = origin.sceneId ? project.scenes.find(scene => scene.id === origin.sceneId)?.entryActions : lineFor(project, origin)?.actions;
  const action = origin.direct && actions?.[origin.actionIndex];
  if (action && action.kind === 'camera') return { action, name: origin.sceneId ? `场景入口 ${project.scenes.find(scene => scene.id === origin.sceneId)!.name}` : '台词镜头', save: () => {} };
}

export function moveStageCamera(project: Project, selection: PreviewSelection, patch: Partial<CameraPose>, milliseconds?: number) {
  const line = lineFor(project, selection); if (!line) return;
  const snapshot = linePreviewSnapshot(project, selection), plan = linePlaybackPlan(snapshot.before, snapshot.actions);
  const time = milliseconds ?? plan.dialogueAt;
  if (!Number.isFinite(time) || time < 0) throw new Error('镜头编辑时间必须是有限的非负数。');
  const step = plan.steps.filter(step => step.at <= time && step.action.kind === 'camera').at(-1);
  const motion = !step ? snapshot.before.cameraMotion : undefined;
  const action = step?.action.kind === 'camera' ? step.action : motion?.action;
  if (action) {
    const source = cameraSource(project, snapshot.context.actionOrigins?.get(action), action);
    if (!source) throw new Error('无法定位镜头动画的可编辑来源，请打开来源演出。');
    const localTime = step ? (time - step.at) / 1000 : motion!.elapsed + time / 1000;
    setCameraPoseAt(source.action, localTime, step?.before.camera ?? motion!.initial, patch);
    source.save();
    return `已修改${source.name}，动画内 ${localTime.toFixed(2)} 秒；使用此来源的预览也会更新。`;
  }
  const entry = linePreviewSnapshot(project, selection, 0), entryPlan = linePlaybackPlan(entry.before, entry.actions);
  if (time < entryPlan.dialogueAt) throw new Error('场景入口尚未结束，请在入口结束后插入镜头帧。');
  const initial = sampleLinePlayback(entry.before, entryPlan, entryPlan.dialogueAt).state.camera;
  const duration = (time - entryPlan.dialogueAt) / 1000;
  const created: CameraAction = { kind: 'camera', x: initial.x, y: initial.y, zoom: initial.zoom, rotation: initial.rotation, duration, easing: 'linear', wait: false };
  setCameraPoseAt(created, duration, initial, patch);
  line.actions.unshift(created);
}

export function stageVisualObjects(state: PreviewStage) {
  const result: { rootId: string; object: VisualObject; elapsed: number; name: string }[] = [];
  for (const [rootId, visual] of state.visuals) {
    const visit = (object: VisualObject, elapsed: number, name: string) => {
      if (elapsed < 0 || !object.persistent && elapsed >= object.duration) return;
      result.push({ rootId, object, elapsed, name });
      if (object.content === 'group') object.children?.forEach(child => visit(child, elapsed - (child.startAt ?? 0), name + ' / ' + child.name));
    };
    visit(visual.object, visual.elapsed, visual.object.name);
  }
  return result;
}

export function moveStageVisual(project: Project, selection: PreviewSelection, rootId: string, instanceId: string, patch: Partial<Record<VisualCurveProperty, number>>, milliseconds?: number) {
  const snapshot = linePreviewSnapshot(project, selection), plan = linePlaybackPlan(snapshot.before, snapshot.actions);
  const time = milliseconds ?? Math.max(plan.dialogueAt, plan.until);
  if (!Number.isFinite(time) || time < 0) throw new Error('对象编辑时间必须是有限的非负数。');
  const state = sampleLinePlayback(snapshot.before, plan, time).state;
  const visible = stageVisualObjects(state).filter(item => item.rootId === rootId && item.object.instanceId === instanceId);
  if (visible.length !== 1) throw new Error('当前时刻对象不存在或实例标识重复。');
  const origin = snapshot.context.actionOrigins?.get(state.visuals.get(rootId)!.object);
  if (!origin) throw new Error('无法定位视觉对象的可编辑来源。');
  const graph = projectGraphs(project).find(graph => graph.id === origin.blueprintId);
  const node = graph?.nodes.find(node => node.id === origin.blueprintNodeId);
  const actions = origin.sceneId ? project.scenes.find(scene => scene.id === origin.sceneId)?.entryActions : lineFor(project, origin)?.actions;
  const action = node ? rawSavedBlueprintAction(node) : origin.direct ? actions?.[origin.actionIndex] : undefined;
  if (action?.kind !== 'visual') throw new Error('无法定位视觉对象的可编辑来源，请打开来源演出。');
  const path = visualInstancePath(action, instanceId);
  if (!path) throw new Error('对象已移除或实例标识重复。');
  let object = action; for (const index of path) object = object.children![index];
  const scale = origin.visualTimeScales?.[instanceId] ?? 1;
  const localTime = visible[0].elapsed / scale, originalPatch = { ...patch };
  if (originalPatch.rippleSpeed !== undefined) originalPatch.rippleSpeed *= scale;
  if (milliseconds === undefined && object.keyframes.length === 1 && !object.curves && Object.keys(originalPatch).every(key => ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'opacity'].includes(key))) Object.assign(object.keyframes[0], originalPatch);
  else setVisualPropertiesAt(object, localTime, originalPatch);
  if (node) node.properties.action = JSON.stringify(actionSchema.parse(action));
  return `已修改${graph ? '共享演出 ' + graph.name : origin.sceneId ? '场景入口对象' : '台词对象'}，对象内 ${localTime.toFixed(2)} 秒。`;
}

/** Change the effective action without deleting earlier steps in an authored sequence. */
export function setStageAction(project: Project, selection: PreviewSelection, action: StageAction) {
  const line = lineFor(project, selection);
  if (!line) return;
  const index = lastIndex(line.actions, item => item.kind === action.kind && (!actorAction(action) || actorKeyOf(item) === actorKeyOf(action)));
  const overwritten = index < 0 || line.actions.slice(index + 1).some(item => opaque(item) || actorAction(action) && affectsActor(item, actorKeyOf(action)!));
  if (overwritten) line.actions.push(action);
  else line.actions[index] = action;
}

/** A drag edits an animation's destination when it owns the final pose. */
export function moveStageActor(project: Project, selection: PreviewSelection, id: string, patch: Partial<Pick<PreviewActor, 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'expressionId' | 'layer'>>, milliseconds?: number) {
  const posePatch = { x: patch.x, y: patch.y, scale: patch.scale, rotation: patch.rotation, opacity: patch.opacity };
  if (milliseconds === undefined && (patch.rotation !== undefined || patch.opacity !== undefined)) {
    const snapshot = linePreviewSnapshot(project, selection);
    milliseconds = linePlaybackPlan(snapshot.before, snapshot.actions).dialogueAt;
  }
  if (milliseconds !== undefined && actorCurveProperties.some(key => patch[key] !== undefined)) {
    const snapshot = linePreviewSnapshot(project, selection), plan = linePlaybackPlan(snapshot.before, snapshot.actions);
    const currentPose = sampleLinePlayback(snapshot.before, plan, milliseconds).state.actors.get(id);
    if (!currentPose) throw new Error('当前时刻角色不可见，无法写入位置帧。');
    let stepIndex = -1;
    plan.steps.forEach((step, index) => {
      if (step.at <= milliseconds && (actorKeyOf(step.action) === id || step.action.kind === 'background' && step.before.actors.get(id)?.lifetime !== 'persistent')) stepIndex = index;
    });
    const step = plan.steps[stepIndex], line = lineFor(project, selection);
    if (step?.action.kind === 'show' && milliseconds >= step.at + step.duration && editAfterEntrance(project, snapshot.context.actionOrigins?.get(step.action), (milliseconds - step.at - step.duration) / 1000, currentPose, posePatch)) return '已写入入场后的属性帧，保留原入场与动态参数。';
    if (step?.action.kind === 'show' && ['dissolve', 'fade', 'move'].includes(step.action.transition) && milliseconds < step.at + step.duration) {
      const origin = snapshot.context.actionOrigins?.get(step.action);
      if (editDynamicEntrance(project, origin, step.action, (milliseconds - step.at) / step.duration, currentPose, posePatch)) return '已写入入场偏移帧；动态输入保留，关键帧随入场时长缩放。';
      const source = showSource(project, origin, step.action), original = source?.action, initial = step.after.actors.get(id);
      if (source && original && initial) {
        const timing = actionTiming(step.action), localTime = (milliseconds - step.at) / 1000, moving = step.action.transition === 'move';
        const previous = step.before.actors.get(id);
        const startPose = moving ? { ...initial, x: previous?.x ?? initial.x - .15, y: previous?.y ?? initial.y, scale: previous?.scale ?? initial.scale, opacity: previous?.opacity ?? 0 } : initial;
        const frame = (pose: PreviewActor, duration: number, easing: 'linear' | 'easeout') => ({ x: pose.x, y: pose.y, scale: pose.scale, rotation: pose.rotation, opacity: pose.opacity, duration, easing });
        const animation: Extract<StageAction, { kind: 'animate' }> = { kind: 'animate', ...actorReference(initial), wait: false, repeat: false,
          keyframes: [...(moving ? [frame(startPose, 0, 'linear')] : []), frame(initial, timing.duration, moving ? 'easeout' : 'linear')] };
        setActorAnimationPoseAt(animation, localTime, startPose, posePatch);
        const show = moving ? { ...detachDisplayPreset(project, original), x: startPose.x, y: startPose.y, scale: startPose.scale, transition: 'none' as const, wait: false } : { ...original, wait: false };
        source.replace([show, animation, ...(timing.wait ? [{ kind: 'pause' as const, seconds: timing.duration }] : [])]);
        return '已写入入场期间的属性帧，保留原过渡时长和后续动作时刻。';
      }
    }
    const entry = linePreviewSnapshot(project, selection, 0), entryPlan = linePlaybackPlan(entry.before, entry.actions);
    if (line && stepIndex < entry.actions.length) {
      if (step?.action.kind === 'animate') {
        const source = animationSource(project, snapshot.context.actionOrigins?.get(step.action));
        const initial = step.before.actors.get(id);
        if (!source || !initial) throw new Error('无法定位场景入口动画的可编辑来源。');
        const localTime = (milliseconds - step.at) / 1000;
        setActorAnimationPoseAt(source.action, localTime, initial, posePatch);
        source.save();
        return `已修改${source.name}，动画内 ${localTime.toFixed(2)} 秒；共享此来源的调用也会更新。`;
      }
      const start = entryPlan.dialogueAt, state = sampleLinePlayback(entry.before, entryPlan, start).state;
      const initial = state.actors.get(id);
      if (!initial || milliseconds < start) throw new Error('角色入场尚未结束，请在入场结束后插入位置帧。');
      const candidate = state.motions.get(id) ?? state.settledShows.get(id);
      const sourceOrigin = candidate?.sourceShow && entry.context.actionOrigins?.get(candidate.sourceShow);
      const inherited = candidate?.sourceShow && sourceOrigin?.direct && !candidate.sourceShow.moveOffsets && !candidate.sourceShow.afterOffsets && candidate.elapsed >= actionTiming(candidate.sourceShow).duration ? undefined : candidate;
      if (inherited) {
        if (inherited.sourceShow) {
          const origin = entry.context.actionOrigins?.get(inherited.sourceShow);
          const phase = (inherited.elapsed + (milliseconds - start) / 1000) / actionTiming(inherited.sourceShow).duration;
          const after = inherited.elapsed + (milliseconds - start) / 1000 - actionTiming(inherited.sourceShow).duration;
          if (editAfterEntrance(project, origin, after, currentPose, posePatch)) return '已写回前文入场后的属性帧，保留原入场与动态参数。';
          if (editDynamicEntrance(project, origin, inherited.sourceShow, phase, currentPose, posePatch)) return '已写回前文入场偏移帧；动态输入保留，关键帧随入场时长缩放。';
          const source = showSource(project, origin, inherited.sourceShow), original = source?.action;
          if (!source || !original) throw new Error('无法定位前文入场的可编辑来源，请打开来源演出。');
          const localTime = inherited.elapsed + (milliseconds - start) / 1000;
          const animation = structuredClone(inherited.action), pose = inherited.initial;
          animation.keyframes.unshift({ x: pose.x, y: pose.y, scale: pose.scale, rotation: pose.rotation, opacity: pose.opacity, duration: 0, easing: 'linear' });
          setActorAnimationPoseAt(animation, localTime, pose, posePatch);
          const timing = actionTiming(inherited.sourceShow);
          const shown = inherited.sourceShow.transition === 'move' ? { ...detachDisplayPreset(project, original), x: pose.x, y: pose.y, scale: pose.scale, transition: 'none' as const, wait: false } : { ...original, wait: false };
          source.replace([shown, animation, ...(timing.wait ? [{ kind: 'pause' as const, seconds: timing.duration }] : [])]);
          return `已修改前文入场，动画内 ${localTime.toFixed(2)} 秒，保留原终点和后续动作时刻。`;
        }
        const origin = entry.context.actionOrigins?.get(inherited.action);
        const source = animationSource(project, origin);
        if (!source) throw new Error('无法定位继承动画的可编辑来源，请打开来源演出。');
        const localTime = inherited.elapsed + (milliseconds - start) / 1000;
        setActorAnimationPoseAt(source.action, localTime, inherited.initial, posePatch);
        source.save();
        return `已修改前文动画：${source.name}，动画内 ${localTime.toFixed(2)} 秒。`;
      }
      const duration = (milliseconds - start) / 1000;
      const animation: Extract<StageAction, { kind: 'animate' }> = { kind: 'animate', ...actorReference(initial), wait: false, repeat: false,
        keyframes: [{ x: initial.x, y: initial.y, scale: initial.scale, rotation: initial.rotation, opacity: initial.opacity, duration, easing: 'linear' }] };
      setActorAnimationPoseAt(animation, duration, initial, posePatch);
      line.actions.unshift(animation);
      return;
    }
    if (!line || (step?.action.kind !== 'animate' && step?.action.kind !== 'show')) throw new Error('当前时刻的角色来自前文，请打开来源演出编辑关键帧。');
    const origin = snapshot.context.actionOrigins?.get(step.action);
    const owner = origin?.direct && !origin.sceneId && origin.nodeId === selection.nodeId && origin.lineId === selection.lineId ? origin.actionIndex : -1;
    const action = line.actions[owner];
    if (action?.kind === 'show' && step.action.kind === 'show') {
      const timing = actionTiming(step.action), start = step.at + (timing.wait ? timing.duration * 1000 : 0);
      if (milliseconds < start) throw new Error('角色入场尚未结束，请在入场结束后插入位置帧。');
      const initial = sampleLinePlayback(snapshot.before, plan, start).state.actors.get(id);
      if (!initial) throw new Error('动画开始时角色不可见。');
      const duration = (milliseconds - start) / 1000;
      const animation: Extract<StageAction, { kind: 'animate' }> = { kind: 'animate', ...actorReference(initial), wait: false, repeat: false,
        keyframes: [{ x: initial.x, y: initial.y, scale: initial.scale, rotation: initial.rotation, opacity: initial.opacity, duration, easing: 'linear' }] };
      setActorAnimationPoseAt(animation, duration, initial, posePatch);
      line.actions.splice(owner + 1, 0, animation);
      return;
    }
    const initial = step.before.actors.get(id), source = animationSource(project, origin);
    if (!source || !initial) throw new Error('无法定位当前动画的可编辑来源，请打开对应演出。');
    setActorAnimationPoseAt(source.action, (milliseconds - step.at) / 1000, initial, posePatch);
    source.save();
    if (origin?.blueprintId) return `已修改${source.name}，所有调用该演出的地方都会使用新关键帧。`;
    return;
  }
  const line = lineFor(project, selection), actor = linePreviewSnapshot(project, selection).after.actors.get(id);
  if (!line || !actor) return;
  const index = lastIndex(line.actions, action => affectsActor(action.kind === 'show' && !action.characterId ? { ...action, characterId: line.speakerId ?? '' } : action, id));
  const action = line.actions[index];
  const changesGeometry = Object.keys(patch).some(key => ['x', 'y', 'scale'].includes(key));
  const adjust = (show: Extract<StageAction, { kind: 'show' }>) => ({ ...(changesGeometry ? !show.characterId ? { ...show, presetId: undefined, x: actor.x, y: actor.y, scale: actor.scale } : detachDisplayPreset(project, show) : show), ...patch });
  if (action?.kind === 'animate' && action.keyframes.length && Object.keys(patch).every(key => ['x', 'y', 'scale'].includes(key))) {
    for (const property of ['x', 'y', 'scale'] as const) {
      const value = patch[property];
      if (value === undefined) continue;
      const curve = action.curves?.[property];
      if (curve?.length) {
        // Curves own their property; editing a base frame would have no visible effect.
        const final = curve.reduce((latest, frame) => frame.at >= latest.at ? frame : latest);
        final.value = value;
      } else action.keyframes[action.keyframes.length - 1][property] = value;
    }
  } else if (action?.kind === 'show') line.actions[index] = adjust(action);
  else if (action?.kind === 'animate') {
    const before = line.actions.slice(0, index).reverse().find(item => affectsActor(item, id));
    if (before?.kind === 'show') { const next = adjust(before); delete before.presetId; Object.assign(before, next); }
    else {
      const initial = linePreviewSnapshot(project, selection, index).after.actors.get(id) ?? actor;
      line.actions.splice(index, 0, { ...adjust(showActor(initial)), transition: 'none' });
    }
  } else {
    line.actions.push({ ...adjust(showActor(actor)), transition: 'dissolve', actorTransitions: { ...actor.actorTransitions, enter: { mode: 'move', duration: .5 }, expression: { mode: 'move', duration: .5 } } });
    if (actor.rotation || actor.opacity !== 1) line.actions.push({ kind: 'animate', ...actorReference(actor), repeat: false, wait: false, keyframes: [{ x: patch.x ?? actor.x, y: patch.y ?? actor.y, scale: patch.scale ?? actor.scale, rotation: actor.rotation, opacity: actor.opacity, duration: 0, easing: 'linear' }] });
  }
}

/** Replace only this dialogue's performance directives, retaining prose, spacing and references. */
export function patchStageSource(before: Project, after: Project, source: string, sourceMap: TextSourceLocation[], nodeLocations?: TextNodeLocation[]): string {
  const rows = source.replace(/\r\n?/g, '\n').split('\n');
  const remove = new Set<number>(), insert = new Map<number, string[]>();
  const original = new Map(before.nodes.flatMap(node => node.kind === 'passage' ? node.lines.map(line => [`${node.id}/${line.id}`, line] as const) : []));
  for (const node of after.nodes) {
    if (node.kind !== 'passage') continue;
    for (const line of node.lines) {
      const prior = original.get(`${node.id}/${line.id}`);
      if (!prior || (same(prior.actions, line.actions) && prior.voiceId === line.voiceId && same(prior.playback, line.playback))) continue;
      const locations = sourceMap.filter(location => !location.reference && location.nodeId === node.id && location.lineId === line.id);
      const dialogue = locations.find(location => location.actionCount === undefined);
      const actionRows = locations.filter(location => location.actionCount !== undefined && !location.playback).map(location => location.sourceLine - 1);
      const playbackRows = locations.filter(location => location.playback).map(location => location.sourceLine - 1);
      if (!dialogue && !line.silent) throw new Error('请先为当前段落添加台词，再编辑舞台。');
      const at = dialogue ? dialogue.sourceLine - 1 : actionRows[0];
      if (at === undefined) throw new Error('找不到此演出在文本中的位置。');
      if (!same(prior.actions, line.actions)) {
        const actions = actionRows;
        [...actions, ...playbackRows].forEach(row => remove.add(row));
        insert.set(Math.min(actions[0] ?? at, playbackRows[0] ?? at), [...linePerformanceText(after, node, line), ...(line.silent ? [standaloneText(isStandaloneNode(node) ? node.name : undefined, line.playback)] : playbackText(line.playback))]);
      } else if (!same(prior.playback, line.playback)) {
        playbackRows.forEach(row => remove.add(row));
        const declaration = actionRows.find(row => /^\s*[@／/]\s*独立演出\s*(?:[:：]|$)/.test(rows[row]));
        const boundary = line.silent ? declaration ?? (actionRows.at(-1) ?? at) + 1 : playbackRows[0] ?? at;
        if (line.silent && declaration !== undefined) remove.add(declaration);
        insert.set(boundary, [...(insert.get(boundary) ?? []), ...(line.silent ? [standaloneText(isStandaloneNode(node) ? node.name : undefined, line.playback)] : playbackText(line.playback))]);
      }
      if (prior.voiceId !== line.voiceId) {
        let start = at - 1;
        const otherLines = new Set(sourceMap.filter(location => !location.reference && location.lineId !== line.id && location.actionCount === undefined).map(location => location.sourceLine - 1));
        while (start >= 0 && !otherLines.has(start) && !/^\s*#/.test(rows[start])) start--;
        for (let row = start + 1; row < at; row++) if (/^\s*[@／/]\s*配音\s*[:：]/.test(rows[row])) remove.add(row);
        if (line.voiceId) insert.set(at, [...(insert.get(at) ?? []), `@配音：${textReference(after.assets.find(asset => asset.id === line.voiceId)?.name ?? '配音', line.voiceId)}`]);
      }
    }
  }
  return [...rows.flatMap((row, index) => [...(insert.get(index) ?? []), ...(remove.has(index) ? [] : [row])]), ...(insert.get(rows.length) ?? [])].join('\n');
}

/** Apply text and a visual edit in one history entry, so undo restores both together. */
export function stageEditedProject(project: Project, edit: (project: Project) => void, read: typeof applyTextScript = applyTextScript) {
  const source = project.scriptText?.content ?? projectToText(project);
  const parsed = read(project, source);
  if (parsed.issues.some(issue => issue.severity === 'error')) return;
  const next = structuredClone(parsed.project);
  edit(next);
  if (same(parsed.project, next)) return;
  const editedSource = next.scriptText?.content ?? source;
  const editedLocations = editedSource === source ? parsed : applyTextScript(next, editedSource);
  const patched = patchStageSource(parsed.project, next, editedSource, editedLocations.sourceMap, editedLocations.nodeLocations);
  const verified = applyTextScript(next, patched);
  if (verified.issues.some(issue => issue.severity === 'error')) return;
  return { project: verified.project, source: patched, sourceMap: verified.sourceMap, parsed: verified };
}
