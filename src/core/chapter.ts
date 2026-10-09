import { effectiveUiTheme, type Project, type StoryNode } from './model';
import chapterSource from './chapter-source.json';
export { chapterSource };

export type ChapterTitleNode = Extract<StoryNode, { kind: 'chapterTitle' }>;
export type ChapterContent = Pick<ChapterTitleNode, 'title' | 'subtitle' | 'duration' | 'effect' | 'backgroundId' | 'titleImageId' | 'soundId'>;
export const chapterEffectNames = { none: '无动画', fade: '淡入淡出', ink: '笔触消散' };
export function chapterPresentation(project: Project, node?: ChapterContent) {
  const theme = effectiveUiTheme(project.ui);
  return { effect: node?.effect ?? theme.chapterTransition?.effect ?? 'fade', duration: Math.max(0.01, node?.duration ?? 4.2),
    backgroundId: node?.backgroundId ?? theme.pages?.chapterTitle?.backgroundId, titleImageId: node?.titleImageId,
    backgroundOffsetX: theme.chapterTransition?.backgroundOffsetX ?? 0, backgroundOffsetY: theme.chapterTransition?.backgroundOffsetY ?? 0,
    overlayId: theme.chapterTransition?.overlayId, maskId: theme.chapterTransition?.maskId,
    dissolveId: theme.chapterTransition?.dissolveId, particles: theme.chapterTransition?.particles !== false, particleColor: theme.chapterTransition?.particleColor ?? '#ffffff',
    ripple: theme.chapterTransition?.ripple !== false, rippleStrength: theme.chapterTransition?.rippleStrength ?? chapterSource.shaders.ripple.strength, rippleSpeed: theme.chapterTransition?.rippleSpeed ?? chapterSource.shaders.ripple.speed };
}
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const outQuad = (v: number) => 1 - (1 - clamp(v)) ** 2;
export const chapterParticleCount = Math.round(chapterSource.particle.rate * chapterSource.particle.emissionDuration);
export function chapterParticle(index: number, userSeed = 0) {
  let seed = (index + 1729) ^ Math.imul(userSeed, 0x9e3779b9);
  // Mix adjacent particle IDs before the first LCG draw; otherwise every size
  // lands near the same end of its range. Unity's original random seed is unknown.
  seed = Math.imul(seed ^ (seed >>> 16), 0x21f0aaad);
  seed = Math.imul(seed ^ (seed >>> 15), 0x735a2d97);
  seed = (seed ^ (seed >>> 15)) >>> 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const { particle: p, timing: t } = chapterSource;
  return { delay: t.move + t.holdTitle + index / p.rate / t.simulationSpeed,
    life: p.lifetime, size: mix(p.size[0], p.size[1], random()), forceX: random(), forceY: random(), noiseX: random() * 10, noiseY: random() * 10 };
}

type CurveKey = { time: number; value: number; inSlope: number; outSlope: number };
/** Exact double integral of Unity's unweighted cubic Hermite force curves. */
export function chapterCurveDisplacement(keys: CurveKey[], age: number) {
  const lifetime = chapterSource.particle.lifetime, t = clamp(age / lifetime);
  let force = 0, moment = 0;
  for (let i = 0; i < keys.length; i++) {
    const a = keys[i], b = keys[i + 1] ?? { ...a, time: 1 };
    const width = b.time - a.time;
    if (t <= a.time || width <= 0) break;
    const u = Math.min(1, (t - a.time) / width), m0 = keys[i + 1] ? a.outSlope * width : 0, m1 = keys[i + 1] ? b.inSlope * width : 0;
    const c = [a.value, m0, -3 * a.value + 3 * b.value - 2 * m0 - m1, 2 * a.value - 2 * b.value + m0 + m1];
    const integral = width * c.reduce((sum, v, k) => sum + v * u ** (k + 1) / (k + 1), 0);
    force += integral;
    moment += a.time * integral + width ** 2 * c.reduce((sum, v, k) => sum + v * u ** (k + 2) / (k + 2), 0);
  }
  return (t * force - moment) * lifetime ** 2;
}
export const chapterForceSampleRate = 120;
export const chapterForceSamples = Array.from({ length: chapterSource.particle.lifetime * chapterForceSampleRate + 1 }, (_, i) =>
  (['x', 'y'] as const).flatMap(axis => (['min', 'max'] as const).map(kind => chapterCurveDisplacement(chapterSource.particle.force[axis][kind], i / chapterForceSampleRate) * chapterSource.particle.force[axis].multiplier)));

/** Gradient-noise arithmetic recovered from TitleDisappear's shipped DXBC. */
export function chapterGradientNoise(x: number, y: number) {
  const frac = (v: number) => v - Math.floor(v), mod = (v: number) => v - Math.floor(v / 289) * 289;
  const direction = (px: number, py: number) => {
    let v = mod((34 * mod(px) + 1) * mod(px)) + mod(py);
    v = frac(mod((34 * v + 1) * v) / 41) * 2 - 1;
    const dx = v - Math.floor(v + .5), dy = Math.abs(v) - .5, length = Math.hypot(dx, dy);
    return [dx / length, dy / length];
  };
  const ix = Math.floor(x), iy = Math.floor(y), fx = frac(x), fy = frac(y);
  const dot = (dx: number, dy: number) => { const g = direction(ix + dx, iy + dy); return g[0] * (fx - dx) + g[1] * (fy - dy); };
  const fade = (v: number) => v ** 3 * (v * (v * 6 - 15) + 10);
  return mix(mix(dot(0, 0), dot(0, 1), fade(fy)), mix(dot(1, 0), dot(1, 1), fade(fy)), fade(fx));
}
export const chapterTitleNoise = (u: number, v: number) => clamp(chapterGradientNoise(u * chapterSource.shaders.title.scale, (1 - v) * chapterSource.shaders.title.scale) + .5);
export const chapterTitleOpacity = (u: number, v: number, strength: number) => clamp(chapterTitleNoise(u, v) + strength);

/** Sample in source world units; callers project into their own screen dimensions. */
export function chapterParticleFrame(p: ReturnType<typeof chapterParticle>, time: number) {
  const age = (time * chapterSource.timing.duration - p.delay) * chapterSource.timing.simulationSpeed;
  if (age < 0 || age >= p.life) return { dx: 0, dy: 0, alpha: 0 };
  const cursor = age * chapterForceSampleRate, index = Math.min(chapterForceSamples.length - 2, Math.floor(cursor));
  const a = chapterForceSamples[index], b = chapterForceSamples[index + 1], f = cursor - index;
  const dx = mix(mix(a[0], b[0], f), mix(a[1], b[1], f), p.forceX), dy = mix(mix(a[2], b[2], f), mix(a[3], b[3], f), p.forceY);
  // Unity's internal noise seed is unavailable. Keep its strength/frequency with deterministic smooth noise in both engines.
  const noise = chapterSource.particle.noise, amount = noise.strength / (noise.damping ? noise.frequency : 1);
  const perturb = (x: number, y: number) => (chapterGradientNoise(x + dx * noise.frequency, y + dy * noise.frequency) - chapterGradientNoise(x, y)) * amount;
  return { dx: dx + perturb(p.noiseX, p.noiseY), dy: -dy - perturb(p.noiseY + 19, p.noiseX + 31), alpha: 1 };
}

export function chapterTitleRect(project: Project) {
  const c = effectiveUiTheme(project.ui).components.find(c => c.page === 'chapterTitle' && c.kind === 'chapterTitle');
  return c ? { x: c.x, y: c.y, width: c.width, height: c.height } : { x: .1, y: .4, width: .8, height: .16 };
}

export function chapterGlyphPoints(data: ArrayLike<number>, width: number, height: number) {
  const points: [number, number][] = [], step = Math.max(1, Math.floor(Math.min(width, height) / 80));
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) if (data[(y * width + x) * 4 + 3] > 80) points.push([(x + .5) / width, (y + .5) / height]);
  return points;
}

export function chapterFrame(time: number, effect: string) {
  const ramp = (a: number, b: number) => Math.max(0, Math.min(1, (time - a) / (b - a)));
  if (effect === 'ink') {
    const t = chapterSource.timing, seconds = time * t.duration;
    const erase = outQuad((seconds - t.move - t.holdTitle) / t.disappear);
    return { surface: outQuad(seconds / t.fadeIn) * clamp(1 - t.fadeTarget * outQuad((seconds - t.fadeIn - t.holdBackground) / t.fadeOut)),
      alpha: 1, shift: outQuad(seconds / t.move) - 1, erase, strength: mix(1, -1, erase) };
  }
  return { surface: effect === 'none' ? 1 : ramp(0, .22) * (1 - ramp(.83, 1)),
    alpha: effect === 'none' ? 1 : ramp(.12, .2) * (1 - ramp(.73, .95)), shift: 0, erase: 0, strength: 1 };
}
