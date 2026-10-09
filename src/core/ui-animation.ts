import { uiProperties, type UiProperty } from './ui';

export const uiAnimationProperties = ['x', 'y', 'width', 'height', 'opacity', 'value'] as const;
export type UiAnimationProperty = (typeof uiAnimationProperties)[number];
export const uiAnimationEasings = { linear: '匀速', ease: '缓入缓出', easein: '缓入', easeout: '缓出' } as const;
export type UiAnimationEasing = keyof typeof uiAnimationEasings;
export const isUiAnimationProperty = (property: string): property is UiAnimationProperty => (uiAnimationProperties as readonly string[]).includes(property);
export function validUiAnimation(property: string, value: unknown, duration: unknown, easing: string): boolean {
  return isUiAnimationProperty(property) && typeof value === 'number' && Number.isFinite(value)
    && (!['opacity', 'value'].includes(property) || value >= 0 && value <= 1)
    && typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 && duration <= 3600
    && Object.hasOwn(uiAnimationEasings, easing);
}
export function uiAnimationValue(from: number, to: number, progress: number, easing: UiAnimationEasing): number {
  const t = Math.max(0, Math.min(1, progress));
  const eased = easing === 'linear' ? t : easing === 'easein' ? 1 - Math.cos(t * Math.PI / 2) : easing === 'easeout' ? Math.sin(t * Math.PI / 2) : .5 - Math.cos(t * Math.PI) / 2;
  return from + (to - from) * eased;
}
export const uiAnimationPropertyNames = Object.fromEntries(uiAnimationProperties.map(key => [key, uiProperties[key as UiProperty].name]));
