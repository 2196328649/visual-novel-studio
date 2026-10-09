import { actionSchema, actorCurvesSchema, moveOffsetsSchema, type BlueprintNode, type StageAction } from './model';
import { actorCurveProperties } from './actor-animation';
import { visualCurve } from './visual-object';
type Show = Extract<StageAction, { kind: 'show' }>;
type OffsetSource = BlueprintNode | Show;
type Pose = Pick<Show, 'x' | 'y' | 'scale'> & { rotation: number; opacity: number };
export function supportsEntranceOffsets(node: BlueprintNode) {
  if (['showCharacter'].includes(node.type)) return true;
  if (node.type !== 'savedAction') return false;
  try { return actionSchema.parse(JSON.parse(String(node.properties.action))).kind === 'show'; } catch { return false; }
}
export function nodeMoveOffsets(node: OffsetSource): Show['moveOffsets'] {
  if ('kind' in node) return node.moveOffsets;
  if (node.type === 'savedAction') { const action = actionSchema.parse(JSON.parse(String(node.properties.action))); return action.kind === 'show' ? action.moveOffsets : undefined; }
  return node.properties.moveOffsets ? moveOffsetsSchema.parse(JSON.parse(String(node.properties.moveOffsets))) : undefined;
}
function writeMoveOffsets(node: OffsetSource, curves: Show['moveOffsets']) {
  const parsed = moveOffsetsSchema.parse(curves ?? {}), value = Object.keys(parsed).length ? parsed : undefined;
  if ('kind' in node) { if (value) node.moveOffsets = value; else delete node.moveOffsets; }
  else if (node.type === 'savedAction') {
    const action = actionSchema.parse(JSON.parse(String(node.properties.action)));
    if (action.kind !== 'show') throw new Error('请选择角色显示动作。');
    if (value) action.moveOffsets = value; else delete action.moveOffsets;
    node.properties.action = JSON.stringify(action);
  } else if (value) node.properties.moveOffsets = JSON.stringify(value); else delete node.properties.moveOffsets;
}
export function applyMoveOffsets<T extends Pose>(pose: T, action: Show, progress: number): T {
  const result = { ...pose };
  for (const property of actorCurveProperties) result[property] += visualCurve({ curves: action.moveOffsets }, property, progress, 0);
  result.opacity = Math.max(0, Math.min(1, result.opacity));
  return result;
}
export function setMoveOffsets(node: OffsetSource, phase: number, current: Pose, patch: Partial<Pose>) {
  const curves = structuredClone(nodeMoveOffsets(node) ?? {});
  for (const property of actorCurveProperties) {
    const value = patch[property]; if (value === undefined || !Number.isFinite(value)) continue;
    const offset = visualCurve({ curves }, property, phase, 0) + value - current[property];
    const frames = curves[property]?.map(frame => ({ ...frame })) ?? [{ at: 0, value: 0, easing: 'linear' as const }, { at: 1, value: 0, easing: 'linear' as const }];
    const existing = frames.find(frame => Math.abs(frame.at - phase) < 1e-8);
    if (existing) existing.value = offset; else frames.push({ at: phase, value: offset, easing: 'linear' });
    frames.sort((a,b)=>a.at-b.at); curves[property] = frames;
  }
  writeMoveOffsets(node, curves);
}

/** Normalized entrance curves stay independent from dynamically evaluated input values. */
export function setMoveOffsetCurve(node: OffsetSource, property: typeof actorCurveProperties[number], frames: NonNullable<Show['moveOffsets']>[typeof property] | undefined) {
  const curves = { ...nodeMoveOffsets(node) };
  if (frames?.length) {
    const unique = new Map(frames.map(frame => [frame.at, { ...frame }]));
    curves[property] = [...unique.values()].sort((a, b) => a.at - b.at);
  } else delete curves[property];
  writeMoveOffsets(node, curves);
}

export function moveOffsetTimelineFrames(node: BlueprintNode, property: typeof actorCurveProperties[number], duration: number) {
  return nodeMoveOffsets(node)?.[property]?.map(frame => ({ ...frame, at: frame.at * duration }));
}
export function setMoveOffsetTimelineFrames(node: BlueprintNode, property: typeof actorCurveProperties[number], duration: number, frames: NonNullable<NonNullable<Show['moveOffsets']>[typeof property]>) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('入场时长必须大于 0 才能在秒刻度上移动偏移帧。');
  const previous = moveOffsetTimelineFrames(node, property, duration);
  const changed = frames.findIndex((frame, index) => frame.at !== previous?.[index]?.at);
  const ordered = changed < 0 ? frames : [...frames.filter((_, index) => index !== changed), frames[changed]];
  setMoveOffsetCurve(node, property, ordered.map(frame => ({ ...frame, at: Math.max(0, Math.min(1, frame.at / duration)) })));
}

/** Curves in seconds after the original entrance; independent of its normalized offsets. */
export function nodeAfterOffsets(node: OffsetSource): Show['afterOffsets'] {
  if ('kind' in node) return node.afterOffsets;
  if (node.type === 'savedAction') { const action = actionSchema.parse(JSON.parse(String(node.properties.action))); return action.kind === 'show' ? action.afterOffsets : undefined; }
  return node.properties.afterOffsets ? actorCurvesSchema.parse(JSON.parse(String(node.properties.afterOffsets))) : undefined;
}
export function afterOffsetDuration(curves: Show['afterOffsets']) {
  return Math.max(0, ...Object.values(curves ?? {}).flatMap(frames => frames.map(frame => frame.at)));
}
export function setAfterOffsetCurve(node: OffsetSource, property: typeof actorCurveProperties[number], frames: NonNullable<Show['afterOffsets']>[typeof property] | undefined) {
  const curves = { ...nodeAfterOffsets(node) };
  if (frames?.length) curves[property] = [...new Map(frames.map(frame => [frame.at, { ...frame }])).values()].sort((a,b)=>a.at-b.at);
  else delete curves[property];
  const parsed = actorCurvesSchema.parse(curves), value = Object.keys(parsed).length ? parsed : undefined;
  if ('kind' in node) { if (value) node.afterOffsets = value; else delete node.afterOffsets; }
  else if (node.type === 'savedAction') {
    const action = actionSchema.parse(JSON.parse(String(node.properties.action)));
    if (action.kind !== 'show') throw new Error('请选择角色显示动作。');
    if (value) action.afterOffsets = value; else delete action.afterOffsets;
    node.properties.action = JSON.stringify(action);
  } else if (value) node.properties.afterOffsets = JSON.stringify(value); else delete node.properties.afterOffsets;
}
export function setAfterOffsets(node: OffsetSource, seconds: number, current: Pose, patch: Partial<Pose>) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('后续关键帧时间必须是有限的非负数。');
  const draft = structuredClone(node), oldDuration = afterOffsetDuration(nodeAfterOffsets(node));
  for (const property of actorCurveProperties) {
    const value = patch[property]; if (value === undefined || !Number.isFinite(value)) continue;
    const curves = nodeAfterOffsets(draft), frames = curves?.[property]?.map(frame => ({ ...frame })) ?? [{ at: 0, value: 0, easing: 'linear' as const }];
    if (seconds > oldDuration && frames.at(-1)!.at < oldDuration) frames.push({ at: oldDuration, value: frames.at(-1)!.value, easing: 'linear' });
    const offset = visualCurve({curves}, property, seconds, 0) + value - current[property];
    setAfterOffsetCurve(draft, property, [...frames, { at: seconds, value: offset, easing: 'linear' }]);
  }
  Object.assign(node, draft);
}
export function applyAfterOffsets<T extends Pose>(pose: T, action: Show, seconds: number): T {
  if (seconds < 0) return pose;
  const result = { ...pose };
  for (const property of actorCurveProperties) result[property] += visualCurve({curves: action.afterOffsets}, property, seconds, 0);
  result.opacity = Math.max(0, Math.min(1, result.opacity));
  return result;
}
