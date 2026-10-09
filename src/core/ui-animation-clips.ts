import { uiPageNames } from './ui-names';
import { effectiveUiComponents, makeId, uiAnimationClipSchema, type Project, type UiAnimationClip, type UiAnimationTrack, type UiComponent } from './model';
import { uiAnimationValue, validUiAnimation, type UiAnimationProperty } from './ui-animation';
import { uiPropertyApplies } from './ui';

export const uiAnimationPlayModes = { forward: '正放', reverse: '倒放', pingpong: '往返' };
export type UiAnimationPlayMode = keyof typeof uiAnimationPlayModes;
export interface UiAnimationPlayback { mode: UiAnimationPlayMode; loops: number; speed: number; offset: number; clipDuration: number }
export function validUiAnimationPlayback(mode: unknown, loops: unknown, speed: unknown, fromCurrent: unknown): boolean {
  return typeof mode === 'string' && Object.hasOwn(uiAnimationPlayModes, mode)
    && typeof loops === 'number' && Number.isInteger(loops) && loops >= 0 && loops <= 1000000
    && typeof speed === 'number' && Number.isFinite(speed) && speed >= .01 && speed <= 100
    && typeof fromCurrent === 'boolean';
}
export function uiAnimationPlaybackDuration(playback: UiAnimationPlayback): number {
  const { clipDuration, mode, loops, speed, offset } = playback;
  return clipDuration === 0 ? 0 : loops === 0 ? Infinity : Math.max(0, clipDuration * (mode === 'pingpong' ? 2 : 1) * loops - offset) / speed;
}
/** Offset measures distance along the new direction, not wall-clock seconds. */
export function uiAnimationPlaybackTime(playback: UiAnimationPlayback, elapsed: number): number {
  const { clipDuration: duration, mode, loops, speed, offset } = playback;
  if (duration === 0) return 0;
  const cycle = duration * (mode === 'pingpong' ? 2 : 1), distance = offset + Math.max(0, elapsed) * speed;
  if (loops > 0 && distance >= cycle * loops) return mode === 'forward' ? duration : 0;
  const local = distance % cycle;
  return mode === 'reverse' ? duration - local : mode === 'pingpong' && local > duration ? cycle - local : local;
}

export function uiClipComponents(project: Project, clip: Pick<UiAnimationClip, 'pageId' | 'uiInstanceId'>): UiComponent[] {
  if (!clip.pageId.startsWith('ui:')) return project.ui.customPages.find(p => p.id === clip.pageId)?.components ?? [];
  return effectiveUiComponents({...project.ui, activeInstanceId: clip.uiInstanceId === 'base' ? undefined : clip.uiInstanceId}).filter(c => 'ui:' + c.page === clip.pageId);
}
export function uiPageAnimations(project: Project, pageId: string): UiAnimationClip[] {
  return (project.ui.animations ?? []).filter(a => a.pageId === pageId && (!pageId.startsWith('ui:') || (a.uiInstanceId ?? 'base') === (project.ui.activeInstanceId ?? 'base')));
}
export function uiAnimationInitial(component: UiComponent, property: UiAnimationProperty): number {
  return property === 'opacity' ? component.style?.opacity ?? 1 : component[property] ?? 0;
}
/** The key's easing describes arrival at that key; after the last key, hold. */
export function sampleUiAnimationTrack(track: UiAnimationTrack, time: number, initial: number): number {
  let previous = { time: 0, value: initial };
  for (const key of [...track.keys].sort((a,b) => a.time - b.time)) {
    if (time < key.time) return uiAnimationValue(previous.value, key.value, (time - previous.time) / (key.time - previous.time), key.easing);
    previous = key;
  }
  return previous.value;
}
export function uiAnimationClipProblems(project: Project, clip: UiAnimationClip): string[] {
  const parsed = uiAnimationClipSchema.safeParse(clip);
  if (!parsed.success) return ['动画名称、时长、轨道或关键帧格式无效。'];
  const problems: string[] = [], components = uiClipComponents(project, clip), seen = new Set<string>(), ids = new Set<string>();
  if (clip.pageId.startsWith('ui:') && (clip.pageId==='ui:custom'||!Object.hasOwn(uiPageNames,clip.pageId.slice(3)))) problems.push('动画的页面已不存在。');
  if (clip.pageId.startsWith('ui:') && clip.uiInstanceId && clip.uiInstanceId !== 'base' && !project.ui.instances?.some(i => i.id === clip.uiInstanceId)) problems.push('动画的界面方案已不存在。');
  if (!clip.pageId.startsWith('ui:') && !project.ui.customPages.some(p => p.id === clip.pageId)) problems.push('动画的页面已不存在。');
  for (const track of clip.tracks) {
    const component = components.find(c => c.id === track.componentId), identity = JSON.stringify([track.componentId, track.property]);
    if (!component || !uiPropertyApplies(component, track.property)) problems.push('轨道引用的控件或属性不属于该页面。');
    if (seen.has(identity)) problems.push('同一控件属性只能有一条轨道。');
    seen.add(identity);
    if (ids.has(track.id)) problems.push('轨道标识重复。'); ids.add(track.id);
    const times = new Set<number>();
    for (const key of track.keys) {
      if (ids.has(key.id)) problems.push('关键帧标识重复。'); ids.add(key.id);
      if (times.has(key.time)) problems.push('同一轨道不能在同一时间有多个关键帧。'); times.add(key.time);
      if (key.time > clip.duration || !validUiAnimation(track.property, key.value, key.time, key.easing)) problems.push('关键帧超出动画时长或属性值范围。');
    }
  }
  return [...new Set(problems)];
}
export function createUiAnimationClip(project: Project, pageId: string): UiAnimationClip {
  const names = new Set(uiPageAnimations(project,pageId).map(a => a.name));
  let name = '界面动画', number = 2; while (names.has(name)) name = '界面动画 ' + number++;
  const clip: UiAnimationClip = { id: makeId('ui_animation'), name, pageId, ...(pageId.startsWith('ui:') ? {uiInstanceId: project.ui.activeInstanceId ?? 'base'} : {}), duration: 1, tracks: [] };
  (project.ui.animations ??= []).push(clip); return clip;
}
export function addUiAnimationTrack(clip: UiAnimationClip, component: UiComponent, property: UiAnimationProperty): UiAnimationTrack {
  const existing = clip.tracks.find(t => t.componentId === component.id && t.property === property);
  if (existing) return existing;
  const value = uiAnimationInitial(component, property);
  const track: UiAnimationTrack = { id: makeId('ui_track'), componentId: component.id, property, keys: [{id:makeId('ui_key'),time:0,value,easing:'linear'}, ...(clip.duration > 0 ? [{id:makeId('ui_key'),time:clip.duration,value,easing:'linear' as const}] : [])] };
  clip.tracks.push(track); return track;
}
