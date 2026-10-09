import { actionSchema, effectiveCharacter, makeId, type AnimationKeyframe, type VisualObject, type BlueprintNode, type BlueprintPin, type Project, type VariableValue } from './model';
import { displayPresetPlacement } from './character-presets';
import { portraitGeometry } from './portrait';
import { visualInstancePath } from './visual-selection';
import { textEffectInputs } from './ui-text-effects';
import { visualParameterEntries } from './visual-parameters';

export interface VisualInputField { key: string; path: (string | number)[]; name: string; type: BlueprintPin['dataType']; value: VariableValue }
export function visualRetimeRatio(object: VisualObject, duration: number) {
  const basis = object.duration || object.retimeBasisDuration;
  return duration > 0 && basis ? duration / basis : 1;
}
/** Resize an authored performance while preserving every sampled pose at the same relative time. */
export function retimeVisualObject(object: VisualObject, duration: number): VisualObject {
  if (!Number.isFinite(duration) || duration < 0) throw new Error('演出时长必须是有限的非负数。');
  const result = structuredClone(object), ratio = visualRetimeRatio(object, duration);
  if (duration === 0) {
    // Keep the authored clock while the object has no lifetime. Persist its basis
    // so resizing after save/reload can recover the original proportions.
    if (object.duration > 0) result.retimeBasisDuration = object.duration;
    result.duration = 0;
    return result;
  }
  const scale = (item: VisualObject, child: boolean) => {
    item.duration *= ratio;
    if (item.retimeBasisDuration !== undefined) item.retimeBasisDuration *= ratio;
    if (child && item.startAt !== undefined) item.startAt *= ratio;
    item.keyframes.forEach(frame => { frame.duration *= ratio; });
    for (const rule of Object.values(item.visualTransitions ?? {})) if (rule) rule.duration = Math.min(60, rule.duration * ratio);
    for (const [property, frames] of Object.entries(item.curves ?? {})) frames?.forEach(frame => { frame.at *= ratio; if (property === 'rippleSpeed') frame.value /= ratio; });
    if (item.dissolve) { item.dissolve.start *= ratio; item.dissolve.end *= ratio; }
    if (item.ripple) item.ripple.speed /= ratio;
    if (item.particles) {
      item.particles.lifetime *= ratio; item.particles.speed /= ratio;
      item.particles.lifeCurves?.speed?.forEach(frame => { frame.value /= ratio; });
      for (const key of ['forceX', 'forceY'] as const) item.particles.lifeCurves?.[key]?.forEach(frame => { frame.value /= ratio * ratio; });
    }
    if (item.glyphParticles) {
      item.glyphParticles.emissionStart *= ratio; item.glyphParticles.timeScale /= ratio;
      for (const key of ['forceX', 'forceY'] as const) item.glyphParticles.lifeCurves?.[key]?.forEach(frame => { frame.value /= ratio * ratio; });
    }
    item.children?.forEach(child => scale(child, true));
  };
  scale(result, false);
  result.duration = duration;
  delete result.retimeBasisDuration;
  return result;
}

export function visualInputFields(object: VisualObject): VisualInputField[] {
  const fields: VisualInputField[] = [];
  const hash = (text: string) => {
    let a = 2166136261, b = 5381;
    for (const char of text) { a = Math.imul(a ^ char.charCodeAt(0), 16777619); b = Math.imul(b, 33) ^ char.charCodeAt(0); }
    return (a >>> 0).toString(16) + '_' + (b >>> 0).toString(16);
  };
  const visit = (item: VisualObject, path: (string | number)[], ids: string[], name: string) => {
    const add = (property: string, label: string, type: BlueprintPin['dataType'], value: VariableValue, tail: (string | number)[] = [property]) => fields.push({ key: path.length ? 'child_' + hash(ids.join('/') + '/' + property) : property, path: [...path, ...tail], name: name + label, type, value });
    add('duration', '对象时长', 'number', item.duration);
    for (const phase of ['enter', 'exit', 'replace'] as const) {
      const rule = item.visualTransitions?.[phase], label = { enter: '入场', exit: '离场', replace: '替换' }[phase];
      if (rule) {
        add('transition_' + phase + '_mode', label + '过渡方式', 'string', rule.mode, ['visualTransitions', phase, 'mode']);
        add('transition_' + phase + '_duration', label + '过渡秒数', 'number', rule.duration, ['visualTransitions', phase, 'duration']);
      }
    }
    add('width', '宽度', 'number', item.width); add('height', '高度', 'number', item.height);
    add('color', '颜色', 'string', item.color);
    add('maskAssetId', '透明度遮罩', 'asset', item.maskAssetId ?? '');
    for (const parameter of item.parameters ?? []) add('parameter_' + parameter.id, parameter.name, parameter.dataType, item.parameterValues?.[parameter.id] ?? parameter.defaultValue, ['parameterValues', parameter.id]);
    if (item.content === 'text' || item.glyphParticles?.source === 'text') { add('text', '对象文字', 'string', item.text); add('fontSize', '对象字号', 'number', item.fontSize); add('fontAssetId', '对象字体', 'asset', item.fontAssetId ?? ''); add('textItalic', '文字斜体', 'boolean', item.textItalic ?? false); }
    if ((item.content === 'text' || item.glyphParticles?.source === 'text') && item.textAlign) add('textAlign', '文字水平对齐', 'string', item.textAlign);
    if ((item.content === 'text' || item.glyphParticles?.source === 'text') && item.textVerticalAlign) add('textVerticalAlign', '文字垂直对齐', 'string', item.textVerticalAlign);
    if (item.content === 'text' || item.glyphParticles?.source === 'text') for (const property of Object.keys(textEffectInputs) as (keyof typeof textEffectInputs)[]) {
      const field = textEffectInputs[property];
      add('textEffects_' + property, field.name, typeof field.value === 'number' ? 'number' : 'string', item.textEffects?.[property] ?? field.value, ['textEffects', property]);
    }
    if (item.content === 'image') add('assetId', '对象图片', 'asset', item.assetId ?? '');
    if (item.content === 'video') {
      add('assetId', '对象视频', 'asset', item.assetId ?? '');
      add('mediaOffset', '视频素材入点', 'number', item.mediaOffset ?? 0);
      add('fadeIn', '视频淡入秒数', 'number', item.fadeIn ?? 0);
      add('fadeOut', '视频淡出秒数', 'number', item.fadeOut ?? 0);
      add('volume', '视频音量', 'number', item.volume ?? 1);
      add('muted', '视频静音', 'boolean', item.muted ?? false);
      add('loop', '视频循环', 'boolean', item.loop ?? false);
    }
    if (item.glyphParticles && item.glyphParticles.source !== 'text') add('glyphAssetId', '字形图片', 'asset', item.glyphParticles.assetId ?? '', ['glyphParticles', 'assetId']);
    if (item.glyphParticles) add('glyphSeed', '字形随机种子', 'number', item.glyphParticles.seed ?? 0, ['glyphParticles', 'seed']);
    if (item.content === 'group' && !item.compositionId) item.children?.forEach((child, index) => visit(child, [...path, 'children', index], [...ids, child.instanceId], name + child.name + ' · '));
  };
  visit(object, [], [], '');
  return fields;
}
export function applyVisualInputs(object: VisualObject, values: Record<string, VariableValue | undefined>, timeScales?: Map<string, number>): VisualObject {
  const result = structuredClone(object);
  // Apply child overrides before scaling their containing performance.
  const entries = visualInputFields(object).filter(field => values[field.key] !== undefined).map(field => ({ path: field.path, value: values[field.key]! }));
  for (const field of visualParameterEntries(object, entries)) {
    let target = result as unknown as Record<string | number, unknown>;
    for (const part of field.path.slice(0, -1)) {
      if (target[part] === undefined) target[part] = {};
      target = target[part] as Record<string | number, unknown>;
    }
    const property = field.path.at(-1)!;
    const value = field.value;
    if ((property === 'maskAssetId' || property === 'assetId' && target.content !== 'video') && value === '') { delete target[property]; continue; }
    if (property === 'fontAssetId' && value === '') continue; // Empty input retains the authored font.
    if (property === 'assetId' && target.content === 'video') {
      if (value === '') continue;
      if (value !== target.assetId) delete target.sourceDuration;
    }
    if (property === 'duration' && target.persistent !== undefined && typeof value === 'number') {
      target.persistent = value === 0;
      if (target.persistent) target.wait = false;
    }
    if (property === 'duration' && target.retimeOnDuration && typeof value === 'number' && value >= 0) {
      const ratio = visualRetimeRatio(target as unknown as VisualObject, value);
      const record = (item: VisualObject) => { timeScales?.set(item.instanceId, (timeScales.get(item.instanceId) ?? 1) * ratio); item.children?.forEach(record); };
      if (timeScales) record(target as unknown as VisualObject);
      const resized = retimeVisualObject(target as unknown as VisualObject, value);
      delete target.retimeBasisDuration;
      Object.assign(target, resized);
    }
    else target[property] = value;
  }
  const limitSources = (item: VisualObject) => {
    if (item.content === 'video' && item.sourceDuration !== undefined) item.duration = Math.max(0, Math.min(item.duration, videoDurationLimit(item)));
    item.children?.forEach(limitSources);
  };
  limitSources(result);
  return result;
}

/** Source metadata stays in seconds even when the containing animation is retimed. */
export function videoDurationLimit(object: VisualObject) {
  return object.loop || object.persistent || object.sourceDuration === undefined ? Infinity : Math.max(0, object.sourceDuration - (object.mediaOffset ?? 0));
}
export function syncVisualPins(node: BlueprintNode, object: VisualObject) {
  const fields = visualInputFields(object);
  const ids = new Set(fields.map(field => 'object_' + field.key));
  node.pins = node.pins.filter(pin => !pin.id.startsWith('object_') || ids.has(pin.id));
  for (const key of Object.keys(node.properties)) if (key.startsWith('object_') && !ids.has(key)) delete node.properties[key];
  for (const field of fields) {
    const id = 'object_' + field.key, existing = node.pins.find(pin => pin.id === id);
    if (existing) { existing.defaultValue = field.value; existing.name = field.name; existing.dataType = field.type; }
    else node.pins.push({ id, name: field.name, direction: 'input', dataType: field.type, defaultValue: field.value, required: false });
  }
}

/** Replace an authored object without baking unrelated literal or linked inputs into it. */
export function updateVisualNodeObject(node: BlueprintNode, object: VisualObject) {
  const root = actionSchema.parse(JSON.parse(String(node.properties.action)));
  if (root.kind !== 'visual') throw new Error('当前片段不是画面对象。');
  const path = visualInstancePath(root, object.instanceId);
  if (!path) throw new Error('对象已移除或实例标识重复。');
  const fields = new Map(visualInputFields(root).map(field => [field.key, field.value]));
  let result = root;
  if (!path.length) result = object;
  else {
    let parent = root;
    for (const index of path.slice(0, -1)) parent = parent.children![index];
    parent.children![path.at(-1)!] = object;
  }
  const checked = actionSchema.parse(result);
  if (checked.kind !== 'visual') throw new Error('不能更改画面片段类型。');
  for (const field of visualInputFields(checked)) {
    if (fields.has(field.key) && fields.get(field.key) !== field.value) delete node.properties['object_' + field.key];
  }
  node.properties.action = JSON.stringify(checked);
  node.name = checked.name;
  syncVisualPins(node, checked);
}

export type VisualClipPatch = Partial<Omit<VisualObject, 'kind' | 'instanceId' | 'keyframes'>> & {
  firstFrame?: Partial<Pick<AnimationKeyframe, 'x' | 'y' | 'scale' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity'>>;
};
export function patchVisualClipNode(node: BlueprintNode, patch: VisualClipPatch) {
  const root = actionSchema.parse(JSON.parse(String(node.properties.action)));
  if (root.kind !== 'visual') throw new Error('当前片段不是画面对象。');
  const { firstFrame, ...properties } = patch;
  if (root.content === 'video' && properties.assetId !== undefined && properties.assetId !== root.assetId && !Object.hasOwn(properties, 'sourceDuration')) delete root.sourceDuration;
  Object.assign(root, properties);
  if (firstFrame) {
    Object.assign(root.keyframes[0], firstFrame);
    for (const [key, value] of Object.entries(firstFrame)) {
      const frames = root.curves?.[key as keyof NonNullable<VisualObject['curves']>];
      if (!frames?.length) continue;
      const start = Math.min(...frames.map(frame => frame.at));
      // Curves override keyframe values, including the initial pose.
      for (const frame of frames) if (frame.at === start) frame.value = value;
    }
  }
  // Clear a directly edited literal even when it happened to equal the raw default.
  const candidate = { ...node, properties: { ...node.properties }, pins: structuredClone(node.pins) };
  updateVisualNodeObject(candidate, root);
  for (const key of Object.keys(properties)) delete candidate.properties['object_' + key];
  Object.assign(node, candidate);
}

export function createVisualObject(content: VisualObject['content'], assetId?: string): VisualObject {
  return { kind: 'visual', instanceId: makeId('object'), name: { image: '图片', text: '文字', particles: '粒子', group: '组合', solid: '色块', video: '视频' }[content], content, assetId,
    text: content === 'text' ? '新的文字' : '', width: content === 'image' || content === 'group' || content === 'solid' || content === 'video' ? 1 : .6, height: content === 'image' || content === 'group' || content === 'solid' || content === 'video' ? 1 : .3,
    layer: 20, color: '#ffffff', fontSize: 60, duration: 3, wait: false,
    keyframes: [{ x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, duration: 0, easing: 'linear' }],
    ...(content === 'video' ? { mediaOffset: 0, volume: 1, fadeIn: 0, fadeOut: 0, muted: false } : {}),
    ...(content === 'particles' ? { particles: { count: 80, seed: 1, lifetime: 2, speed: .15, direction: -90, spread: 60, size: 6, endSize: 1 } } : {}) };
}

/** Create a regular image clip from a character expression.
 * Character metadata is retained as an authoring aid; preview and export use
 * the same visual-object path as any other image clip.
 */
export function createCharacterVisualObject(project: Project, characterId: string, expressionId?: string): VisualObject {
  const character = effectiveCharacter(project, characterId);
  const expression = character?.expressions.find(item => item.id === expressionId)
    ?? character?.expressions.find(item => item.id === character.defaultExpressionId)
    ?? character?.expressions[0];
  if (!character || !expression) throw new Error('角色没有可用的表情图片。');
  const asset = project.assets.find(item => item.id === expression.assetId);
  const geometry = portraitGeometry(asset, project.width, project.height);
  const placement = displayPresetPlacement(project, character.id, expression.id);
  const width = Math.max(.001, Math.min(4, geometry.width / project.width));
  const height = Math.max(.001, Math.min(4, geometry.height / project.height));
  const object = createVisualObject('image', expression.assetId);
  object.name = `角色 · ${character.name}${expression.name ? ` · ${expression.name}` : ''}`;
  object.characterId = character.id;
  object.expressionId = expression.id;
  object.width = width;
  object.height = height;
  object.imageFit = 'contain';
  object.imageAlign = 'bottom';
  object.keyframes[0] = { ...object.keyframes[0], x: placement.x, y: placement.y - height * placement.scale / 2, scale: placement.scale };
  return object;
}

export const visualCurveFields = { x: ['横向位置 %', 100], y: ['纵向位置 %', 100], scale: ['整体缩放 %', 100], scaleX: ['缩放 X %', 100], scaleY: ['缩放 Y %', 100], rotation: ['旋转 度', 1], opacity: ['不透明度 %', 100], dissolveStrength: ['消散强度', 1], rippleStrength: ['波动强度', 1], rippleSpeed: ['波动速度', 1] } as const;
export type VisualCurveProperty = keyof typeof visualCurveFields;
export const visualTransformProperties = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'opacity'] as const;
export type VisualTransformProperty = typeof visualTransformProperties[number];
export const visualFrameValue = (frame: AnimationKeyframe, key: VisualTransformProperty) => frame[key] ?? 1;
const sampledProperties = (object: VisualObject) => visualTransformProperties.filter(key => key !== 'scaleX' && key !== 'scaleY' || object.keyframes.some(frame => frame[key] !== undefined) || !!object.curves?.[key]);
export function visualPropertyAnimated(object: VisualObject, key: VisualTransformProperty) {
  return !!object.curves?.[key]?.length || object.keyframes.some(frame => visualFrameValue(frame, key) !== visualFrameValue(object.keyframes[0], key));
}
export function visualKeyframeTimes(object: VisualObject): number[] {
  const times = Object.values(object.curves ?? {}).flatMap(frames => frames.map(frame => frame.at));
  if (object.keyframes.length > 1) {
    let at = 0;
    times.push(0);
    for (const frame of object.keyframes) { at += frame.duration; times.push(at); }
  }
  return [...new Set(times)].filter(at => at >= 0 && at <= object.duration).sort((a, b) => a - b);
}
export function toggleVisualKeyframe(object: VisualObject, time: number, key: VisualTransformProperty) {
  if (!Number.isFinite(time) || time < 0 || time > object.duration) throw new Error('请把播放头移到片段内。');
  const value = visualFrameValue(visualPose(object, time), key);
  const frames = object.curves?.[key];
  const at = Math.round(time * 1000) / 1000;
  if (frames?.some(frame => Math.abs(frame.at - at) < .001)) {
    const remaining = frames.filter(frame => Math.abs(frame.at - at) >= .001);
    object.curves = { ...object.curves };
    if (remaining.length) object.curves[key] = remaining;
    else delete object.curves[key];
    if (!remaining.length) object.keyframes.forEach(frame => { frame[key] = value; });
  } else if (visualPropertyAnimated(object, key)) setVisualPropertiesAt(object, at, { [key]: value });
  else object.curves = { ...object.curves, [key]: [{ at, value, easing: 'linear' }] };
}
/** Add a local-time property frame while retaining the authored trajectory's endpoints. */
export function setVisualPropertiesAt(object: VisualObject, time: number, patch: Partial<Record<VisualCurveProperty, number>>) {
  if (!Number.isFinite(time) || time < 0) throw new Error('属性帧时间必须是有限的非负数。');
  const curves = structuredClone(object.curves ?? {});
  for (const key of Object.keys(patch) as VisualCurveProperty[]) {
    const value = patch[key]; if (value === undefined || !Number.isFinite(value)) throw new Error('属性帧数值必须有限。');
    let frames = curves[key];
    if (!frames?.length) {
      if (key === 'dissolveStrength') {
        const d = object.dissolve;
        frames = d ? [{ at: 0, value: d.from, easing: 'linear' }, { at: d.start, value: d.from, easing: 'linear' }, { at: Math.max(d.start, d.end), value: d.to, easing: 'linear' }] : [{ at: 0, value: 1, easing: 'linear' }];
      } else if (key === 'rippleStrength' || key === 'rippleSpeed') {
        frames = [{ at: 0, value: key === 'rippleStrength' ? object.ripple?.strength ?? .01 : object.ripple?.speed ?? 1, easing: 'linear' }];
      } else {
        frames = [{ at: 0, value: visualFrameValue(object.keyframes[0], key), easing: 'linear' }];
        let at = 0;
        for (const frame of object.keyframes) { at += frame.duration; frames.push({ at, value: visualFrameValue(frame, key), easing: frame.easing }); }
      }
      // Retain discontinuities; only remove redundant equal frames at one instant.
      frames = frames.filter((frame, index, all) => index === 0 || frame.at !== all[index - 1].at || frame.value !== all[index - 1].value);
      frames.sort((a, b) => a.at - b.at);
      if (frames.at(-1)!.at < object.duration) frames.push({ ...frames.at(-1)!, at: object.duration, easing: 'linear' });
    }
    frames.sort((a, b) => a.at - b.at);
    const existing = frames.filter(frame => Math.abs(frame.at - time) < 1e-8).at(-1);
    if (existing) existing.value = value;
    else {
      if (frames.length >= 64) throw new Error('此属性已有 64 个关键帧，请先移除不需要的帧。');
      frames.push({ at: time, value, easing: frames.find(frame => frame.at > time)?.easing ?? 'linear' });
      frames.sort((a, b) => a.at - b.at);
    }
    curves[key] = frames;
  }
  object.curves = curves;
}
export function visualCurve(object: Pick<VisualObject, 'curves'>, key: VisualCurveProperty, time: number, fallback: number): number {
  const frames = object.curves?.[key];
  if (!frames?.length) return fallback;
  const sorted = [...frames].sort((a, b) => a.at - b.at);
  let previous = sorted[0];
  if (time < previous.at) return previous.value;
  for (const frame of sorted.slice(1)) {
    if (time < frame.at && frame.at > previous.at) {
      const t = (time - previous.at) / (frame.at - previous.at);
      const k = frame.easing === 'outquad' ? 1 - (1 - t) ** 2 : frame.easing === 'linear' ? t : frame.easing === 'easein' ? 1 - Math.cos(t * Math.PI / 2) : frame.easing === 'easeout' ? Math.sin(t * Math.PI / 2) : .5 - Math.cos(t * Math.PI) / 2;
      return previous.value + (frame.value - previous.value) * k;
    }
    previous = frame;
  }
  return previous.value;
}
/** A nonlooping video becomes transparent at its end, just like Ren'Py Movie. */
export function videoPlaybackState(object: Pick<VisualObject, 'duration' | 'persistent' | 'loop' | 'mediaOffset'>, elapsed: number, sourceDuration: number) {
  const start = object.mediaOffset ?? 0;
  const available = Number.isFinite(sourceDuration) ? Math.max(0, sourceDuration - start) : Infinity;
  const lifetime = object.persistent ? Infinity : object.duration;
  const segment = Math.min(lifetime, available);
  const active = elapsed >= 0 && elapsed < lifetime && (object.loop ? segment > 0 : elapsed < available);
  const offset = Math.max(0, elapsed);
  const position = start + (object.loop && Number.isFinite(segment) && segment > 0 ? offset % segment : Math.min(offset, available));
  return { position, active };
}
export function videoFadeGain(object: Pick<VisualObject, 'duration' | 'persistent' | 'fadeIn' | 'fadeOut'>, time: number): number {
  const duration = object.persistent ? Infinity : object.duration;
  if (time < 0 || time >= duration) return 0;
  const enter = Math.min(duration, object.fadeIn ?? 0);
  const leave = Math.min(duration, object.fadeOut ?? 0);
  return (enter ? Math.min(1, time / enter) : 1) * (leave ? Math.min(1, (duration - time) / leave) : 1);
}
export function visualPose(object: VisualObject, time: number): AnimationKeyframe {
  const pose = baseVisualPose(object, time);
  const result = { ...pose, ...Object.fromEntries(sampledProperties(object).map(key => [key, visualCurve(object, key, time, visualFrameValue(pose, key))])) };
  result.opacity = Math.max(0, Math.min(1, result.opacity));
  return result;
}
function baseVisualPose(object: VisualObject, time: number): AnimationKeyframe {
  let previous = object.keyframes[0];
  for (const frame of object.keyframes) {
    if (frame.duration > 0 && time < frame.duration) {
      const t = Math.max(0, time / frame.duration);
      const k = frame.easing === 'linear' ? t : frame.easing === 'easein' ? 1 - Math.cos(t * Math.PI / 2) : frame.easing === 'easeout' ? Math.sin(t * Math.PI / 2) : .5 - Math.cos(t * Math.PI) / 2;
      return { ...frame, ...Object.fromEntries(sampledProperties(object).map(key => [key, visualFrameValue(previous, key) + (visualFrameValue(frame, key) - visualFrameValue(previous, key)) * k])) };
    }
    time -= frame.duration; previous = frame;
  }
  return previous;
}
export function visualDissolve(object: VisualObject, time: number) {
  const d = object.dissolve;
  if (!d) return visualCurve(object, 'dissolveStrength', time, 1);
  const t = d.end > d.start ? Math.max(0, Math.min(1, (time - d.start) / (d.end - d.start))) : time >= d.start ? 1 : 0;
  return visualCurve(object, 'dissolveStrength', time, d.from + (d.to - d.from) * t);
}
export function visualParticles(object: VisualObject, time: number) {
  const p = object.particles;
  if (!p) return [];
  const forceX = particleForceSampler(p.lifeCurves?.forceX), forceY = particleForceSampler(p.lifeCurves?.forceY);
  const distance = p.lifeCurves?.speed?.length ? particleForceSampler(p.lifeCurves.speed, false) : undefined;
  const random = (index: number, channel: number) => {
    let value = (p.seed ^ Math.imul(index + 1, 374761393) ^ Math.imul(channel + 1, 668265263)) >>> 0;
    value = Math.imul(value ^ (value >>> 13), 1274126177) >>> 0;
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
  };
  return Array.from({ length: p.count }, (_, index) => {
    const age = (time + random(index, 0) * p.lifetime) % p.lifetime;
    const t = age / p.lifetime, angle = (p.direction + (random(index, 1) - .5) * p.spread) * Math.PI / 180;
    const travelled = distance ? distance(t) * p.lifetime : p.speed * age;
    const color = particleLifeColor(object.color, p.lifeCurves, t);
    return { x: random(index, 2) + Math.cos(angle) * travelled + forceX(t) * p.lifetime ** 2,
      y: random(index, 3) + Math.sin(angle) * travelled + forceY(t) * p.lifetime ** 2, color,
      size: Math.max(0, visualCurve({ curves: { x: p.lifeCurves?.size } }, 'x', t, p.size + (p.endSize - p.size) * t)),
      opacity: Math.max(0, Math.min(1, visualCurve({ curves: { x: p.lifeCurves?.opacity } }, 'x', t, Math.sin(Math.PI * t)))) };
  });
}

type ParticleFrames = NonNullable<NonNullable<VisualObject['particles']>['lifeCurves']>['forceX'];
export function particleLifeColor(color: string, curves: Partial<Record<'red' | 'green' | 'blue', ParticleFrames>> | undefined, time: number) {
  return '#' + (['red', 'green', 'blue'] as const).map((key, index) => {
    const value = visualCurve({ curves: { x: curves?.[key] } }, 'x', time, parseInt(color.slice(1 + index * 2, 3 + index * 2), 16));
    return Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0');
  }).join('');
}
// Eight-point Gauss-Legendre integration on each smooth curve segment. Integrate
// acceleration twice from birth; sampling order and render frame rate cannot affect motion.
export function particleForceOffset(frames: ParticleFrames, age: number) {
  return particleForceSampler(frames)(age);
}
export function particleForceSampler(frames: ParticleFrames, acceleration = true) {
  if (!frames?.length) return (_age: number) => 0;
  const nodes = [.1834346424956498, .525532409916329, .7966664774136267, .9602898564975363];
  const weights = [.362683783378362, .3137066458778873, .2223810344533745, .1012285362903763];
  const sorted = [...frames].sort((a, b) => a.at - b.at);
  const boundaries = [...new Set([0, ...sorted.map(frame => frame.at), 1])].sort((a, b) => a - b);
  const integrate = (local: NonNullable<ParticleFrames>, left: number, right: number) => {
    const half = (right - left) / 2, mid = (right + left) / 2;
    let area = 0, moment = 0;
    for (let j = 0; j < nodes.length; j++) for (const sign of [-1, 1]) {
      const at = mid + sign * half * nodes[j];
      const value = half * weights[j] * visualCurve({ curves: { x: local } }, 'x', at, 0);
      area += value; moment += at * value;
    }
    return { area, moment };
  };
  let area = 0, moment = 0;
  const segments = boundaries.slice(1).map((right, index) => {
    const left = boundaries[index], previous = sorted.filter(frame => frame.at <= left).at(-1) ?? sorted[0], next = sorted.find(frame => frame.at > left);
    const local = next && next !== previous ? [previous, next] : [previous];
    const segment = { left, right, local, area, moment }, integral = integrate(local, left, right);
    area += integral.area; moment += integral.moment;
    return segment;
  });
  return (age: number) => {
    if (age <= 0) return 0;
    const segment = segments.find(segment => age <= segment.right) ?? segments.at(-1)!;
    const partial = integrate(segment.local, segment.left, age);
    return acceleration ? age * (segment.area + partial.area) - segment.moment - partial.moment : segment.area + partial.area;
  };
}
