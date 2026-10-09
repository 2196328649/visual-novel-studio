import { actionSchema, makeId, type BlueprintNode, type BlueprintPin, type StageAction, type VariableValue } from './model';

export type AudioClip = Extract<StageAction, { kind: 'audioClip' }>;
export function createAudioClip(assetId: string, name: string, duration: number, bus: AudioClip['bus'] = 'sound'): AudioClip {
  return { kind: 'audioClip', instanceId: makeId('audio'), assetId, name, duration, sourceDuration: duration, offset: 0, volume: 1, fadeIn: 0, fadeOut: 0, bus, wait: false };
}
export function audioClipFields(clip: AudioClip) {
  return ([['assetId', '音频素材', 'asset'], ['duration', '片段时长', 'number'], ['offset', '素材截取起点', 'number'], ['volume', '片段音量', 'number'], ['fadeIn', '淡入秒数', 'number'], ['fadeOut', '淡出秒数', 'number']] as const)
    .map(([key, name, type]) => ({ key, name, type, value: clip[key] }));
}
/** Metadata belongs to the authored source, so an asset override must not inherit its length. */
export function applyAudioClipInputs(clip: AudioClip, values: Record<string, VariableValue | undefined>): AudioClip {
  const result = { ...clip };
  for (const field of audioClipFields(clip)) {
    const value = values[field.key];
    if (value === undefined || field.key === 'assetId' && value === '') continue;
    if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || field.key === 'volume' && value > 1)) throw new Error(field.name + '超出允许范围。');
    (result as unknown as Record<string, unknown>)[field.key] = value;
  }
  if (result.assetId !== clip.assetId) delete result.sourceDuration;
  if (result.sourceDuration !== undefined) result.duration = Math.max(0, Math.min(result.duration, result.sourceDuration - result.offset));
  return result;
}
export function syncAudioClipPins(node: BlueprintNode, clip: AudioClip) {
  for (const field of audioClipFields(clip)) {
    const id = 'clip_' + field.key;
    const pin: BlueprintPin = { id, name: field.name, direction: 'input', dataType: field.type, required: false, defaultValue: field.value };
    const index = node.pins.findIndex(item => item.id === id);
    if (index >= 0) Object.assign(node.pins[index], pin); else node.pins.push(pin);
  }
}

/** Patch authored fields only; other literal overrides and linked inputs remain intact. */
export function patchAudioClipNode(node: BlueprintNode, patch: Partial<AudioClip>) {
  const source = actionSchema.parse(JSON.parse(String(node.properties.action)));
  if (source.kind !== 'audioClip') throw new Error('当前片段不是音频。');
  const result = actionSchema.parse({ ...source, ...patch });
  if (result.kind !== 'audioClip') throw new Error('不能更改音频片段类型。');
  node.properties.action = JSON.stringify(result);
  for (const key of Object.keys(patch)) delete node.properties['clip_' + key];
  node.name = result.name;
  syncAudioClipPins(node, result);
}

export function audioClipDurationLimit(clip: AudioClip) {
  return clip.sourceDuration === undefined ? Infinity : Math.max(0, clip.sourceDuration - clip.offset);
}
