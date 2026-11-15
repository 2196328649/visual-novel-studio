import { cloneData } from "./project-mutation";
import { actionSchema, makeId, type BlueprintGraph, type BlueprintNode, type Project, type VariableValue, type VisualObject } from './model';
import { rawSavedBlueprintAction } from './blueprint-authoring';
import { arrangePerformanceTimeline, performanceTimeline, timelineNodeActions } from './performance-timeline';
import { renewVisualIdentities, visualInstancePath } from './visual-selection';
import { visualAtPath } from './visual-parameters';
import { retimeVisualObject, setVisualPropertiesAt, toggleVisualKeyframe, updateVisualNodeObject, visualInputFields, visualPropertyAnimated, type VisualClipPatch, type VisualCurveProperty, type VisualTransformProperty } from './visual-object';

export interface CompositionObjectView {
  node: BlueprintNode;
  root: VisualObject;
  object: VisualObject;
  action: VisualObject;
  path: number[];
  at: number;
  until: number;
  scale: number;
  parentScale: number;
  trail: { instanceId: string; name: string }[];
}

/** Authored identities and resolved clocks stay separate throughout composition editing. */
function compositionSource(project: Project, graph: BlueprintGraph, nodeId: string) {
  const node = graph.nodes.find(item => item.id === nodeId), root = node && rawSavedBlueprintAction(node);
  if (!node || root?.kind !== 'visual') throw new Error('找不到组合片段。');
  const clip = performanceTimeline(project, graph).clips.find(item => item.nodeId === nodeId);
  const scales = new Map<string, number>();
  const action = timelineNodeActions(project, graph, node, scales).find(item => item.kind === 'visual');
  if (!clip || action?.kind !== 'visual') throw new Error('无法读取组合时间轴。');
  return { node, root, action, scales, at: clip.at };
}

function objectView(source: ReturnType<typeof compositionSource>, instanceId: string): CompositionObjectView {
  const path = visualInstancePath(source.root, instanceId);
  if (!path) throw new Error('对象已移除或实例标识重复。');
  let object = source.root, action = source.action, at = source.at, until = at + action.duration, parentScale = 1;
  const trail = [{ instanceId: object.instanceId, name: object.name }];
  for (const index of path) {
    parentScale = source.scales.get(object.instanceId) ?? 1;
    object = object.children![index]; action = action.children![index];
    at += action.startAt ?? 0; until = Math.min(until, at + action.duration);
    trail.push({ instanceId: object.instanceId, name: object.name });
  }
  const scale = source.scales.get(instanceId) ?? 1;
  if (!(scale > 0) || !(parentScale > 0)) throw new Error('无法确定组合的时间比例。');
  return { node: source.node, root: source.root, object, action, path, at, until, scale, parentScale, trail };
}

export function compositionObject(project: Project, graph: BlueprintGraph, nodeId: string, instanceId: string) {
  return objectView(compositionSource(project, graph, nodeId), instanceId);
}

export function compositionTimeline(project: Project, graph: BlueprintGraph, nodeId: string, groupId: string) {
  const source = compositionSource(project, graph, nodeId), group = objectView(source, groupId);
  if (group.object.content !== 'group') throw new Error('当前对象不是组合。');
  // Equal layers follow painting order: the last sibling is in front.
  const children = (group.object.children ?? []).map(child => objectView(source, child.instanceId))
    .sort((a, b) => b.action.layer - a.action.layer || b.path.at(-1)! - a.path.at(-1)!);
  return { group, children };
}

export function compositionFieldBinding(graph: BlueprintGraph, view: CompositionObjectView, tail: (string | number)[]) {
  let path = [...view.path.flatMap(index => ['children', index]), ...tail];
  const seen = new Set<string>();
  // Follow public interfaces outward, including a parameter forwarded through another group.
  while (!seen.has(JSON.stringify(path))) {
    seen.add(JSON.stringify(path));
    let forwarded: (string | number)[] | undefined;
    const visit = (object: VisualObject, prefix: (string | number)[]) => {
      for (const parameter of object.parameters ?? []) for (const target of parameter.targets) {
        const relative = visualInstancePath(object, target.instanceId);
        if (relative && JSON.stringify([...prefix, ...relative.flatMap(index => ['children', index]), ...target.path]) === JSON.stringify(path)) forwarded = [...prefix, 'parameterValues', parameter.id];
      }
      object.children?.forEach((child, index) => visit(child, [...prefix, 'children', index]));
    };
    visit(view.root, []);
    if (!forwarded) break; path = forwarded;
  }
  const field = visualInputFields(view.root).find(item => JSON.stringify(item.path) === JSON.stringify(path));
  const pinId = field && 'object_' + field.key;
  const link = pinId && graph.links.find(item => item.toNodeId === view.node.id && item.toPinId === pinId);
  const reader = link ? graph.nodes.find(item => item.id === link.fromNodeId) : undefined;
  const input = reader?.type === 'getInput' ? graph.exposedInputs.find(item => item.id === reader.properties.inputId) : undefined;
  return { pinId, input, computed: !!link && !input, publicPath: JSON.stringify(path) !== JSON.stringify([...view.path.flatMap(index => ['children', index]), ...tail]) ? path : undefined };
}

/** Effect editors display the resolved clock; write only changed properties to the source clock. */
export function editCompositionEffects(project: Project, graph: BlueprintGraph, nodeId: string, instanceId: string, next: VisualObject) {
  const view = compositionObject(project, graph, nodeId, instanceId), object = cloneData(view.object);
  const normalized = view.scale === 1 ? next : retimeVisualObject(next, next.duration / view.scale);
  for (const key of Object.keys(next) as (keyof VisualObject)[]) {
    if (JSON.stringify(next[key]) !== JSON.stringify(view.action[key])) (object as unknown as Record<string, unknown>)[key] = normalized[key];
  }
  updateVisualNodeObject(view.node, object);
}

function writeField(graph: BlueprintGraph, view: CompositionObjectView, tail: (string | number)[], value: VariableValue | undefined) {
  const binding = compositionFieldBinding(graph, view, tail);
  if (binding.computed) throw new Error('此属性由蓝图计算，请在组件连线中修改。');
  if (!binding.pinId) throw new Error('当前对象没有此属性。');
  if (value === undefined) {
    // Reset the override, retaining the authored resource/parameter fallback.
    // Public inputs cannot store undefined, so restore their pin's default.
    delete view.node.properties[binding.pinId];
    if (binding.input) binding.input.defaultValue = visualInputFields(view.root).find(field => 'object_' + field.key === binding.pinId)!.value;
  } else if (binding.input) binding.input.defaultValue = value;
  else view.node.properties[binding.pinId] = value;
}

export function setCompositionField(project: Project, graph: BlueprintGraph, nodeId: string, instanceId: string, tail: (string | number)[], value: VariableValue) {
  const before = performanceTimeline(project, graph);
  writeField(graph, compositionObject(project, graph, nodeId, instanceId), tail, value);
  const after = performanceTimeline(project, graph);
  if (before.clips.some(clip => clip.duration !== after.clips.find(item => item.nodeId === clip.nodeId)?.duration)) arrangePerformanceTimeline(project, graph, before.clips.map(clip => ({ ...clip, duration: after.clips.find(item => item.nodeId === clip.nodeId)?.duration ?? clip.duration })), before.tracks);
}

/** Positions and durations are seconds on the containing group's displayed clock. */
export function setCompositionTiming(project: Project, graph: BlueprintGraph, nodeId: string, instanceId: string, timing: { startAt?: number; duration?: number }) {
  const view = compositionObject(project, graph, nodeId, instanceId);
  if (Object.values(timing).some(value => !Number.isFinite(value) || value < 0)) throw new Error('时间必须是有限的非负数。');
  if (timing.startAt !== undefined && !view.path.length) throw new Error('请在外层时间轴移动组合。');
  if (timing.duration !== undefined && compositionFieldBinding(graph, view, ['duration']).computed) throw new Error('此时长由蓝图计算，请在组件连线中修改。');
  const before = performanceTimeline(project, graph);
  if (timing.startAt !== undefined) {
    view.object.startAt = timing.startAt / view.parentScale;
    updateVisualNodeObject(view.node, view.object);
  }
  if (timing.duration !== undefined) writeField(graph, view, ['duration'], timing.duration / view.parentScale);
  // A shared duration parameter can also affect other clips. Preserve positions
  // and let editTimelineProject validate the complete caller tree atomically.
  const after = performanceTimeline(project, graph);
  if (after.reason) throw new Error(after.reason);
  if (before.clips.some(clip => clip.duration !== after.clips.find(item => item.nodeId === clip.nodeId)?.duration)) {
    arrangePerformanceTimeline(project, graph, before.clips.map(clip => ({ ...clip, duration: after.clips.find(item => item.nodeId === clip.nodeId)?.duration ?? clip.duration })), before.tracks);
  }
}

export function patchCompositionObject(project: Project, graph: BlueprintGraph, nodeId: string, instanceId: string, patch: VisualClipPatch) {
  const before = performanceTimeline(project, graph);
  const view = compositionObject(project, graph, nodeId, instanceId), object = cloneData(view.object);
  const { firstFrame, ...properties } = patch;
  for (const key of Object.keys(properties)) if (compositionFieldBinding(graph, view, [key]).computed) throw new Error('此属性由蓝图计算，请在组件连线中修改。');
  if (object.content === 'video' && properties.assetId !== undefined && properties.assetId !== view.action.assetId) {
    if (!Object.hasOwn(properties, 'sourceDuration')) delete object.sourceDuration;
    // Keep source metadata attached to the new asset even when its value is public.
    object.assetId = properties.assetId;
  }
  const bound: [string, VariableValue | undefined][] = [];
  for (const [key, value] of Object.entries(properties)) {
    const binding = compositionFieldBinding(graph, view, [key]);
    if (binding.pinId && (value === undefined || ['string', 'number', 'boolean'].includes(typeof value))) bound.push([key, value as VariableValue | undefined]);
    else Object.assign(object, { [key]: value });
  }
  if (firstFrame) Object.assign(object.keyframes[0], firstFrame);
  updateVisualNodeObject(view.node, object);
  for (const [key, value] of bound) writeField(graph, view, [key], value);
  const after = performanceTimeline(project, graph);
  if (before.clips.some(clip => clip.duration !== after.clips.find(item => item.nodeId === clip.nodeId)?.duration)) arrangePerformanceTimeline(project, graph, before.clips.map(clip => ({ ...clip, duration: after.clips.find(item => item.nodeId === clip.nodeId)?.duration ?? clip.duration })), before.tracks);
}

export function setCompositionPose(project: Project, graph: BlueprintGraph, nodeId: string, instanceId: string, time: number, patch: Partial<Record<VisualTransformProperty, number>>) {
  const view = compositionObject(project, graph, nodeId, instanceId);
  // A property without keyframes has one value for the whole clip, so it can be
  // edited from anywhere; only animated properties need a time inside the clip.
  const outside = !Number.isFinite(time) || time < view.at || time >= view.until;
  if (outside && (Object.keys(patch) as VisualTransformProperty[]).some(key => visualPropertyAnimated(view.object, key))) throw new Error('请把播放头移到片段的可见区间内。');
  const object = cloneData(view.object), local = outside ? 0 : (time - view.at) / view.scale;
  for (const key of Object.keys(patch) as VisualTransformProperty[]) {
    const value = patch[key]!;
    if (!Number.isFinite(value)) throw new Error('属性值必须是有限数值。');
    if (visualPropertyAnimated(object, key)) setVisualPropertiesAt(object, local, { [key]: value });
    else object.keyframes.forEach(frame => { frame[key] = value; });
  }
  updateVisualNodeObject(view.node, object);
}

export function toggleCompositionKeyframe(project: Project, graph: BlueprintGraph, nodeId: string, instanceId: string, time: number, key: VisualTransformProperty) {
  const view = compositionObject(project, graph, nodeId, instanceId);
  if (!Number.isFinite(time) || time < view.at || time >= view.until) throw new Error('请把播放头移到片段的可见区间内。');
  const object = cloneData(view.object), duration = object.duration;
  // A non-retimed duration override may extend past the authored duration.
  object.duration = view.action.duration / view.scale;
  toggleVisualKeyframe(object, (time - view.at) / view.scale, key);
  object.duration = duration;
  updateVisualNodeObject(view.node, object);
}

export function setCompositionCurve(project: Project, graph: BlueprintGraph, nodeId: string, instanceId: string, key: VisualCurveProperty, frames: NonNullable<VisualObject['curves']>[VisualCurveProperty]) {
  const view = compositionObject(project, graph, nodeId, instanceId), object = cloneData(view.object);
  object.curves = { ...object.curves };
  if (frames?.length) object.curves[key] = frames.map(frame => ({ ...frame, at: frame.at / view.scale, value: key === 'rippleSpeed' ? frame.value * view.scale : frame.value })).sort((a, b) => a.at - b.at);
  else delete object.curves[key];
  updateVisualNodeObject(view.node, object);
}

export function addCompositionChild(project: Project, graph: BlueprintGraph, nodeId: string, groupId: string, child: VisualObject, startAt: number) {
  if (child.content === 'image' && !project.assets.some(asset => asset.id === child.assetId && asset.kind === 'image')) throw new Error('请先在素材中导入图片。');
  if (child.content === 'video' && !project.assets.some(asset => asset.id === child.assetId && asset.kind === 'video')) throw new Error('请先在素材中导入视频。');
  const view = compositionObject(project, graph, nodeId, groupId);
  if (view.object.content !== 'group' || (view.object.children?.length ?? 0) >= 128) throw new Error('组合最多容纳 128 个对象。');
  if (!Number.isFinite(startAt) || startAt < 0) throw new Error('开始时间必须是有限的非负数。');
  const object = cloneData(view.object);
  const sourceLimit = child.content === 'video' && child.sourceDuration !== undefined ? Math.max(0, child.sourceDuration - (child.mediaOffset ?? 0)) : Infinity;
  const added = retimeVisualObject(child, Math.min(child.duration, sourceLimit, Math.max(.05, view.action.duration - startAt)) / view.scale);
  added.startAt = startAt / view.scale;
  added.layer = Math.max(-1, ...(object.children ?? []).map(item => item.layer)) + 1;
  object.children = [...(object.children ?? []), added];
  updateVisualNodeObject(view.node, object);
  return added.instanceId;
}

export function removeCompositionChild(project: Project, graph: BlueprintGraph, nodeId: string, groupId: string, instanceId: string) {
  const view = compositionObject(project, graph, nodeId, groupId), object = cloneData(view.object);
  if (!object.children?.some(child => child.instanceId === instanceId)) throw new Error('找不到组合内的片段。');
  object.children = object.children.filter(child => child.instanceId !== instanceId);
  updateVisualNodeObject(view.node, object);
  const pins = new Set(view.node.pins.map(pin => pin.id));
  graph.links = graph.links.filter(link => link.toNodeId !== nodeId || pins.has(link.toPinId));
}

export function reorderCompositionChild(project: Project, graph: BlueprintGraph, nodeId: string, groupId: string, instanceId: string, index: number) {
  const model = compositionTimeline(project, graph, nodeId, groupId), children = [...model.children];
  const before = children.findIndex(child => child.object.instanceId === instanceId);
  if (before < 0 || !Number.isInteger(index) || index < 0 || index >= children.length) throw new Error('轨道位置无效。');
  const [moved] = children.splice(before, 1); children.splice(index, 0, moved);
  const layers = new Map(children.map((child, i) => [child.object.instanceId, children.length - i - 1]));
  const object = cloneData(model.group.object);
  object.children!.forEach(child => { child.layer = layers.get(child.instanceId)!; });
  updateVisualNodeObject(model.group.node, object);
}

export function duplicateCompositionChild(project: Project, graph: BlueprintGraph, nodeId: string, groupId: string, instanceId: string) {
  return duplicateCompositionSelection(project, graph, nodeId, groupId, [instanceId])[0];
}

/** Copy a selection in one edit, keeping each clip's clock and relative painting order. */
export function duplicateCompositionSelection(project: Project, graph: BlueprintGraph, nodeId: string, groupId: string, instanceIds: string[]) {
  const model = compositionTimeline(project, graph, nodeId, groupId), selected = new Set(instanceIds);
  const sources = model.children.filter(child => selected.has(child.object.instanceId));
  if (!sources.length || sources.length !== selected.size) throw new Error('所选片段已不存在，请重新选择。');
  if (model.children.length + sources.length > 128) throw new Error('组合最多容纳 128 个对象，请减少要复制的片段。');
  if (model.group.object.compositionId) throw new Error('请先打开组合资源，或转为本地组合。');

  const root = cloneData(model.group.root), parent = visualAtPath(root, model.group.path), ids = new Map<string, string>();
  const copies = sources.map(source => {
    const object = renewVisualIdentities(cloneData(source.object), id => {
      const next = makeId('object'); ids.set(id, next); return next;
    });
    object.name = (object.name + ' 副本').slice(0, 120);
    const index = parent.children!.length; parent.children!.push(object);
    return { source, object, index };
  });
  // Ancestor parameters that controlled a source also control its copy. A copied
  // group's own parameter targets were remapped within its fresh identity tree.
  let ancestor = root;
  for (let depth = 0; depth <= model.group.path.length; depth++) {
    for (const parameter of ancestor.parameters ?? []) {
      const targets = parameter.targets.flatMap(target => ids.has(target.instanceId) ? [{ ...target, instanceId: ids.get(target.instanceId)! }] : []);
      if (parameter.targets.length + targets.length > 128) throw new Error('复制后，同一组合参数控制的属性超过 128 项，请减少要复制的片段。');
      parameter.targets.push(...targets);
    }
    if (depth < model.group.path.length) ancestor = ancestor.children![model.group.path[depth]];
  }
  const copyIds = new Map(copies.map(copy => [copy.source.object.instanceId, copy.object.instanceId]));
  const order = model.children.flatMap(child => {
    const id = child.object.instanceId, copyId = copyIds.get(id);
    return copyId ? [copyId, id] : [id];
  });
  const layers = new Map(order.map((id, index) => [id, order.length - index - 1]));
  parent.children!.forEach(child => { child.layer = layers.get(child.instanceId)!; });

  const oldFields = visualInputFields(model.group.root), newFields = new Map(visualInputFields(root).map(field => [JSON.stringify(field.path), field]));
  const inputs = copies.flatMap(({ source, index }) => {
    const prefix = source.path.flatMap(index => ['children', index]);
    const nextPrefix = [...model.group.path.flatMap(index => ['children', index]), 'children', index];
    return oldFields.filter(field => prefix.every((part, i) => field.path[i] === part)).map(field => {
      const next = newFields.get(JSON.stringify([...nextPrefix, ...field.path.slice(prefix.length)]));
      if (!next) throw new Error('无法保留复制片段的参数。');
      const oldPin = 'object_' + field.key, pinId = 'object_' + next.key;
      return { pinId, value: model.group.node.properties[oldPin], links: graph.links.filter(link => link.toNodeId === nodeId && link.toPinId === oldPin) };
    });
  });
  updateVisualNodeObject(model.group.node, root);
  for (const input of inputs) {
    if (input.value !== undefined) model.group.node.properties[input.pinId] = input.value;
    graph.links.push(...input.links.map(link => ({ ...link, id: makeId('link'), toPinId: input.pinId })));
  }
  return copies.map(copy => copy.object.instanceId);
}
