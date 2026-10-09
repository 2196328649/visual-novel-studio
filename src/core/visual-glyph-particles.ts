import { chapterParticle, chapterParticleFrame, chapterSource } from './chapter';
import type { VisualObject } from './model';
import { particleForceSampler, particleLifeColor, visualCurve } from './visual-object';

/** Glyph origins and the recovered chapter force/noise model, in the object's local rectangle. */
export function visualGlyphParticles(object: VisualObject, time: number, points: [number, number][], sourceWidth: number, sourceHeight: number, width: number, height: number) {
  const config = object.glyphParticles;
  if (!config || !points.length) return [];
  const rect = config.rect;
  const factor = Math.min(rect.width * width / sourceWidth, rect.height * height / sourceHeight);
  const iw = sourceWidth * factor / width, ih = sourceHeight * factor / height;
  const curves = config.lifeCurves, forceX = particleForceSampler(curves?.forceX), forceY = particleForceSampler(curves?.forceY);
  return Array.from({ length: config.count }, (_, index) => {
    const seed = config.seed ?? 0;
    const p = chapterParticle(index, seed), [u, v] = points[(index * 7919 + seed * 104729) % points.length];
    p.delay += config.emissionStart * config.timeScale - chapterSource.timing.move - chapterSource.timing.holdTitle;
    const motion = chapterParticleFrame(p, time * config.timeScale / chapterSource.timing.duration);
    const pixelsPerUnit = height / (chapterSource.projection.cameraOrthographicSize * 2);
    const life = p.life / (chapterSource.timing.simulationSpeed * config.timeScale);
    const age = Math.max(0, Math.min(1, (time * config.timeScale - p.delay) * chapterSource.timing.simulationSpeed / p.life));
    const dx = curves?.forceX?.length ? forceX(age) * life ** 2 : motion.dx * pixelsPerUnit / width * config.motionScale;
    const dy = curves?.forceY?.length ? forceY(age) * life ** 2 : motion.dy * pixelsPerUnit / height * config.motionScale;
    return { x: rect.x + (rect.width - iw) / 2 + u * iw + dx,
      y: rect.y + (rect.height - ih) / 2 + v * ih + dy,
      size: p.size * factor * chapterSource.projection.spritePixelsPerUnit * config.sizeScale * Math.max(0, visualCurve({ curves: { x: curves?.size } }, 'x', age, 1)),
      opacity: motion.alpha * Math.max(0, Math.min(1, visualCurve({ curves: { x: curves?.opacity } }, 'x', age, 1))),
      color: particleLifeColor(object.color, curves, age) };
  });
}
