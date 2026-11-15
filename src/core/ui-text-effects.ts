import type { UiComponent } from './model';

/** A soft, dark backing for lettering over textured node artwork. */
export const softTextBackdrop = { shadowX: 0, shadowY: 0, shadowBlur: 14, shadowSpread: 4, shadowColor: '#000000', shadowOpacity: .9 } as const;

export const textEffectInputs = {
  outlineWidth: { name: '描边宽度', value: 0 }, outlineColor: { name: '描边颜色', value: '#000000' }, outlineOpacity: { name: '描边透明度', value: 1 },
  shadowX: { name: '阴影横向偏移', value: 0 }, shadowY: { name: '阴影纵向偏移', value: 0 }, shadowBlur: { name: '阴影柔化', value: 0 }, shadowColor: { name: '阴影颜色', value: '#000000' }, shadowOpacity: { name: '阴影透明度', value: .7 },
} as const;

const alphaColor = (value: string, opacity: number) => value.slice(0, 7) + Math.round(Math.max(0, Math.min(1, opacity)) * (value.length === 9 ? parseInt(value.slice(7), 16) : 255)).toString(16).padStart(2, '0');

/** Graded distance contours give native text a soft halo while its face stays sharp. */
export function softShadowOutlines(blur: number, color: string, opacity: number, x = 0, y = 0, spread = 0): [number, string, number, number][] {
  if (blur <= 0) return [[spread, alphaColor(color, opacity), x, y]];
  const result: [number, string, number, number][] = [];
  const steps = Math.min(24, Math.max(2, Math.ceil(blur * 2)));
  // Apply the source color alpha before contour composition, not to every layer.
  const effectiveOpacity = Math.max(0, Math.min(1, opacity)) * (color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1);
  let covered = 0;
  for (let step = steps; step >= 0; step--) {
    const radius = blur * 2 * step / steps;
    const target = effectiveOpacity * Math.exp(-2 * (radius / blur) ** 2);
    const alpha = Math.max(0, (target - covered) / Math.max(.00001, 1 - covered));
    if (alpha >= .5 / 255) result.push([spread + radius, alphaColor(color.slice(0, 7), alpha), x, y]);
    covered = target;
  }
  return result;
}

/** Radius zero retains the legacy hard shadow; soft contours draw from back to front. */
export function uiTextOutlines(component: Pick<UiComponent, 'style'>, includeSoftShadow = true): [number, string, number, number][] {
  const s = component.style;
  const result: [number, string, number, number][] = [];
  if (s?.shadowBlur && includeSoftShadow) result.push(...softShadowOutlines(s.shadowBlur, s.shadowColor ?? '#000000', s.shadowOpacity ?? .7, s.shadowX, s.shadowY, s.shadowSpread));
  if (s?.outlineWidth) result.push([s.outlineWidth, alphaColor(s.outlineColor ?? '#000000', s.outlineOpacity ?? 1), 0, 0]);
  if (!s?.shadowBlur && (s?.shadowX || s?.shadowY || s?.shadowSpread)) result.push([s.shadowSpread ?? 0, alphaColor(s.shadowColor ?? '#000000', s.shadowOpacity ?? 0.7), s.shadowX ?? 0, s.shadowY ?? 0]);
  return result;
}

export function uiTextShadow(component: Pick<UiComponent, 'style'>, scale: number): string | undefined {
  const s = component.style;
  const effects = uiTextOutlines(s?.shadowBlur ? { style: { ...s, shadowBlur: 0, shadowSpread: 0, shadowX: 0, shadowY: 0 } } : component).flatMap(([radius, color, dx, dy]) => radius
    ? [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]].map(([x, y]) => `${(dx + x * radius) * scale}px ${(dy + y * radius) * scale}px 0 ${color}`)
    : [`${dx * scale}px ${dy * scale}px 0 ${color}`]);
  if (s?.shadowBlur) {
    const spread = s.shadowSpread ?? 0, x = s.shadowX ?? 0, y = s.shadowY ?? 0, color = s.shadowColor ?? '#000000', opacity = s.shadowOpacity ?? .7;
    // CSS shadows cannot grow, so a ring of blurred copies stands in for the thickened one the game blurs.
    if (spread) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [.7, .7], [-.7, .7], [.7, -.7], [-.7, -.7]]) effects.push(`${(x + dx * spread) * scale}px ${(y + dy * spread) * scale}px ${s.shadowBlur * scale}px ${alphaColor(color, 1 - (1 - opacity) ** .25)}`);
    else effects.push(`${x * scale}px ${y * scale}px ${s.shadowBlur * scale}px ${alphaColor(color, opacity)}`);
  }
  return effects.length ? effects.join(', ') : undefined;
}

/** Clip text inside its authored rectangle without moving its baseline. */
export function textClipCss(clip?: { x: number; y: number; width: number; height: number }): string | undefined {
  return clip ? 'inset(' + [Math.max(0, Math.min(1, clip.y)), Math.max(0, Math.min(1, 1 - clip.x - clip.width)), Math.max(0, Math.min(1, 1 - clip.y - clip.height)), Math.max(0, Math.min(1, clip.x))].map(value => value * 100 + '%').join(' ') + ')' : undefined;
}
