import type { UiComponent } from './model';

export const textEffectInputs = {
  outlineWidth: { name: '描边宽度', value: 0 }, outlineColor: { name: '描边颜色', value: '#000000' }, outlineOpacity: { name: '描边透明度', value: 1 },
  shadowX: { name: '阴影横向偏移', value: 0 }, shadowY: { name: '阴影纵向偏移', value: 0 }, shadowBlur: { name: '阴影柔化', value: 0 }, shadowColor: { name: '阴影颜色', value: '#000000' }, shadowOpacity: { name: '阴影透明度', value: .7 },
} as const;

const alphaColor = (value: string, opacity: number) => value + Math.round(Math.max(0, Math.min(1, opacity)) * 255).toString(16).padStart(2, '0');

/** Graded distance contours give native text a soft halo while its face stays sharp. */
export function softShadowOutlines(blur: number, color: string, opacity: number, x = 0, y = 0): [number, string, number, number][] {
  if (blur <= 0) return [[0, alphaColor(color, opacity), x, y]];
  const result: [number, string, number, number][] = [];
  const steps = Math.min(24, Math.max(2, Math.ceil(blur * 2)));
  let covered = 0;
  for (let step = steps; step >= 0; step--) {
    const radius = blur * 2 * step / steps;
    const target = opacity * Math.exp(-2 * (radius / blur) ** 2);
    const alpha = Math.max(0, (target - covered) / Math.max(.00001, 1 - covered));
    if (alpha >= .5 / 255) result.push([radius, alphaColor(color, alpha), x, y]);
    covered = target;
  }
  return result;
}

/** Radius zero retains the legacy hard shadow; soft contours draw from back to front. */
export function uiTextOutlines(component: Pick<UiComponent, 'style'>, includeSoftShadow = true): [number, string, number, number][] {
  const s = component.style;
  const result: [number, string, number, number][] = [];
  if (s?.shadowBlur && includeSoftShadow) result.push(...softShadowOutlines(s.shadowBlur, s.shadowColor ?? '#000000', s.shadowOpacity ?? .7, s.shadowX, s.shadowY));
  if (s?.outlineWidth) result.push([s.outlineWidth, alphaColor(s.outlineColor ?? '#000000', s.outlineOpacity ?? 1), 0, 0]);
  if (!s?.shadowBlur && (s?.shadowX || s?.shadowY)) result.push([0, alphaColor(s.shadowColor ?? '#000000', s.shadowOpacity ?? 0.7), s.shadowX ?? 0, s.shadowY ?? 0]);
  return result;
}

export function uiTextShadow(component: Pick<UiComponent, 'style'>, scale: number): string | undefined {
  const s = component.style;
  const effects = uiTextOutlines(s?.shadowBlur ? { style: { ...s, shadowBlur: 0, shadowX: 0, shadowY: 0 } } : component).flatMap(([radius, color, dx, dy]) => radius
    ? [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]].map(([x, y]) => `${(dx + x * radius) * scale}px ${(dy + y * radius) * scale}px 0 ${color}`)
    : [`${dx * scale}px ${dy * scale}px 0 ${color}`]);
  if (s?.shadowBlur) effects.push(`${(s.shadowX ?? 0) * scale}px ${(s.shadowY ?? 0) * scale}px ${s.shadowBlur * scale}px ${alphaColor(s.shadowColor ?? '#000000', s.shadowOpacity ?? .7)}`);
  return effects.length ? effects.join(', ') : undefined;
}

/** Clip text inside its authored rectangle without moving its baseline. */
export function textClipCss(clip?: { x: number; y: number; width: number; height: number }): string | undefined {
  return clip ? 'inset(' + [Math.max(0, Math.min(1, clip.y)), Math.max(0, Math.min(1, 1 - clip.x - clip.width)), Math.max(0, Math.min(1, 1 - clip.y - clip.height)), Math.max(0, Math.min(1, clip.x))].map(value => value * 100 + '%').join(' ') + ')' : undefined;
}
