import { emissionMeshPoints, type EmissionMesh } from '../core/emission-mesh';
import { useEffect, useId, useState } from 'react';
import { chapterGlyphPoints } from '../core/chapter';
import { visualGlyphParticles } from '../core/visual-glyph-particles';
import type { VisualObject } from '../core/model';
import { textGlyph } from './text-glyph';

export function GlyphParticlesPreview({ object, elapsed, width, height, source, mesh, fontSource }: { object: VisualObject; elapsed: number; width: number; height: number; source?: string; mesh?: EmissionMesh; fontSource?: string }) {
  const [glyph, setGlyph] = useState<{ points: [number, number][]; width: number; height: number }>();
  const [error, setError] = useState('');
  const gradientId = useId().replaceAll(':', '');
  const textMode = object.glyphParticles?.source === 'text';
  const textWidth = width * (object.glyphParticles?.rect.width ?? 1), textHeight = height * (object.glyphParticles?.rect.height ?? 1);
  useEffect(() => {
    let active = true; setGlyph(undefined); setError('');
    if (textMode) {
      void textGlyph(object.text, object.fontSize, textWidth, textHeight, fontSource, object.textAlign, object.textVerticalAlign, object.textEffects, object.textClip, object.textItalic).then(result => { if (active) setGlyph(result); }).catch(reason => { if (active) setError(String(reason)); });
      return () => { active = false; };
    }
    if (!source) return;
    const image = new Image(); image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (!active) return;
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d'); if (!context) return;
      context.drawImage(image, 0, 0);
      try { setGlyph({ points: mesh ? emissionMeshPoints(mesh) : chapterGlyphPoints(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height), width: canvas.width, height: canvas.height }); } catch { setGlyph(undefined); }
    };
    image.src = source;
    return () => { active = false; };
  }, [source, mesh, textMode, object.text, object.fontSize, object.textAlign, object.textVerticalAlign, object.textEffects, object.textClip, object.textItalic, textWidth, textHeight, fontSource]);
  if (error) return <g data-glyph-error={error}><title>{error}</title></g>;
  if (!glyph) return null;
  const particles = visualGlyphParticles(object, elapsed, glyph.points, glyph.width, glyph.height, width, height).filter(p => p.opacity > 0 && p.size > 0);
  // A CSS radial gradient inside a foreignObject required an HTML subtree and
  // layout for every particle. Native SVG circles share the same soft sprite.
  const colors = [...new Set(particles.map(p => p.color))];
  const gradients = new Map(colors.map((color, index) => [color, `${gradientId}_${index}`]));
  return <><defs>{colors.map(color => <radialGradient key={color} id={gradients.get(color)}><stop offset="0" stopColor={color} /><stop offset="1" stopColor={color} stopOpacity="0" /></radialGradient>)}</defs>{particles.map((p, i) => <circle data-glyph-particle={i} key={i} cx={(p.x - .5) * width} cy={(p.y - .5) * height} r={p.size / 2} fill={`url(#${gradients.get(p.color)})`} opacity={p.opacity} />)}</>;
}
