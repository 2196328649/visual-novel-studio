import { actorTransitionRuleSchema, visualObjectSchema, type VisualObject, type VisualTransitions } from './model';
import { visualTransitionNames } from './visual-transitions';

export function parseVisualRule(mode?: string, duration?: string) {
  if (!mode && !duration) return undefined;
  const aliases = { 无: 'none', 立即: 'none', 溶解: 'dissolve', 渐变: 'dissolve', 淡入淡出: 'fade', 先淡出再淡入: 'fade', 移动: 'move' } as const;
  return actorTransitionRuleSchema.parse({ mode: aliases[mode as keyof typeof aliases] ?? mode ?? 'dissolve', duration: duration ? Number(duration) : .5 });
}
export function parseVisualTransitions(values: string[]): Pick<MediaOptions, 'visualTransitions' | 'transitionWait'> {
  const visualTransitions: VisualTransitions = {};
  for (const [index, phase] of (['enter', 'exit', 'replace'] as const).entries()) {
    const rule = parseVisualRule(values[index * 2], values[index * 2 + 1]);
    if (rule) visualTransitions[phase] = rule;
  }
  const wait = values[6];
  if (wait && !/^(是|否|true|false)$/i.test(wait)) throw new Error('等待过渡需要填写是或否。');
  return { ...(Object.keys(visualTransitions).length ? { visualTransitions } : {}), ...(wait ? { transitionWait: /^(是|true)$/i.test(wait) } : {}) };
}
export function visualTransitionText(object: VisualObject): string[] {
  const fields: string[] = [];
  for (const phase of ['enter', 'exit', 'replace'] as const) {
    const rule = object.visualTransitions?.[phase];
    if (rule) { const label = { enter: '入场', exit: '离场', replace: '替换' }[phase]; fields.push(`${label}过渡=${visualTransitionNames[rule.mode]}`, `${label}秒数=${rule.duration}`); }
  }
  if (object.transitionWait !== undefined) fields.push(`等待过渡=${object.transitionWait ? '是' : '否'}`);
  return fields;
}

export type MediaContent = 'image' | 'video' | 'text';
export type MediaLifetime = 'line' | 'persistent' | 'duration';
export const mediaLifetimeNames = { line: '仅本句', persistent: '持续显示', duration: '定时显示' } as const;
export function mediaLifetime(object: VisualObject): MediaLifetime { return object.lifetime === 'line' ? 'line' : object.persistent ? 'persistent' : 'duration'; }
export function parseMediaLifetime(value?: string): MediaLifetime | undefined {
  if (!value) return;
  const entry = Object.entries(mediaLifetimeNames).find(([id, name]) => id === value || name === value);
  if (!entry) throw new Error('显示范围支持仅本句、持续显示或定时显示。');
  return entry[0] as MediaLifetime;
}
export function withMediaLifetime(object: VisualObject, lifetime: MediaLifetime): VisualObject {
  const { lifetime: _lifetime, ...rest } = object;
  return { ...rest, ...(lifetime === 'line' ? { lifetime: 'line' } : {}), persistent: lifetime !== 'duration', duration: lifetime === 'duration' ? object.duration || 3 : 0, wait: lifetime === 'duration' && object.wait };
}
export interface MediaOptions { instanceId?: string; x?: number; y?: number; width?: number; height?: number; scale?: number; scaleX?: number; scaleY?: number; rotation?: number; opacity?: number; lifetime?: MediaLifetime; duration?: number; layer?: number; wait?: boolean; fit?: VisualObject['imageFit']; loop?: boolean; volume?: number; fontSize?: number; color?: string; visualTransitions?: VisualObject['visualTransitions']; transitionWait?: boolean }
export function createMediaVisual(content: MediaContent, source: string, options: MediaOptions = {}): VisualObject {
  const duration = options.duration ?? 0;
  const lifetime = options.lifetime ?? (duration > 0 ? 'duration' : content === 'image' ? 'line' : 'persistent');
  if (lifetime === 'duration' && duration <= 0) throw new Error('定时显示需要大于 0 的时长。');
  if (lifetime !== 'duration' && duration > 0) throw new Error('填写时长时请选择定时显示。');
  if (options.wait && duration === 0) throw new Error('等待完成需要指定大于 0 的显示时长；持续显示请关闭等待。');
  return visualObjectSchema.parse({ kind: 'visual', content, instanceId: options.instanceId || content, name: { image: '图片', video: '视频', text: '文字' }[content],
    ...(content === 'text' ? { text: source, fontSize: options.fontSize ?? 60, color: options.color ?? '#ffffff' } : { assetId: source, imageFit: options.fit ?? 'contain' }),
    width: options.width ?? (content === 'text' ? .8 : 1), height: options.height ?? (content === 'text' ? .2 : 1), layer: options.layer ?? 20,
    duration, persistent: duration === 0, ...(lifetime === 'line' ? { lifetime: 'line' } : {}), wait: options.wait ?? false,
    ...(options.visualTransitions ? { visualTransitions: options.visualTransitions } : {}),
    ...(options.transitionWait !== undefined ? { transitionWait: options.transitionWait } : {}),
    ...(content === 'video' ? { loop: options.loop ?? false, volume: options.volume ?? 1 } : {}),
    keyframes: [{ x: options.x ?? .5, y: options.y ?? .5, scale: options.scale ?? 1, ...(content === 'image' || options.scaleX !== undefined || options.scaleY !== undefined ? { scaleX: options.scaleX ?? 1, scaleY: options.scaleY ?? 1 } : {}), rotation: options.rotation ?? 0, opacity: options.opacity ?? 1, duration: 0, easing: 'linear' }],
  });
}

/** Complex timeline objects retain their complete serialized performance binding. */
export function isSimpleMediaVisual(object: VisualObject): boolean {
  const keys = new Set('kind content instanceId name assetId text fontSize color width height layer duration persistent wait lifetime imageFit keyframes loop volume visualTransitions transitionWait'.split(' '));
  const frame = object.keyframes[0];
  return ['image', 'video', 'text'].includes(object.content) && Object.entries(object).every(([key, value]) => value === undefined || keys.has(key))
    && object.keyframes.length === 1 && frame.duration === 0 && (object.content === 'image' || frame.scale === 1 && (frame.scaleX ?? 1) === 1 && (frame.scaleY ?? 1) === 1 && frame.rotation === 0 && frame.opacity === 1) && frame.easing === 'linear'
    && !!object.persistent === (object.duration === 0);
}
