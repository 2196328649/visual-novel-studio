import { emissionMeshPoints } from '../core/emission-mesh';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { effectiveUiTheme, orderedUiComponents, type Project } from '../core/model';
import { chapterFrame, chapterGlyphPoints, chapterParticle, chapterParticleCount, chapterParticleFrame, chapterPresentation, chapterSource, chapterTitleNoise, chapterTitleRect, type ChapterContent } from '../core/chapter';
import { UiComponentContent, uiComponentPreviewStyle } from './UiComponentVisual';
import type { AssetUrl } from './StageEditor';
import { ChapterRipple } from './ChapterRipple';

type Presentation = ReturnType<typeof chapterPresentation>;

export function ChapterBackdrop({ presentation, assetUrl, seconds = 0 }: { presentation: Presentation; assetUrl: AssetUrl; animate?: boolean; seconds?: number }) {
  const background = assetUrl(presentation.backgroundId);
  return <div className="chapter-backdrop">
    {background && <div data-chapter-background-offset style={{ position: 'absolute', inset: 0, transform: `translate(${presentation.backgroundOffsetX * 100}%, ${presentation.backgroundOffsetY * 100}%)` }}>{presentation.effect === 'ink' && presentation.ripple ? <ChapterRipple source={background} seconds={seconds} strength={presentation.rippleStrength} speed={presentation.rippleSpeed} /> : <img className="chapter-backdrop-scene" src={background} alt="章节背景" />}</div>}
    {presentation.effect === 'ink' && presentation.overlayId && <img className="chapter-backdrop-card" src={assetUrl(presentation.overlayId)} alt="" style={presentation.maskId ? { maskImage: `url("${assetUrl(presentation.maskId)}")`, maskSize: '100% 100%' } : undefined} />}
  </div>;
}

export function ChapterPreview({ project, node, assetUrl, scale, onComplete, playing = true, elapsed }: {
  project: Project; node?: ChapterContent; assetUrl: AssetUrl; scale: number; onComplete?: () => void; playing?: boolean; elapsed?: number;
}) {
  const presentation = chapterPresentation(project, node), theme = effectiveUiTheme(project.ui), rect = chapterTitleRect(project);
  const maskId = useId().replaceAll(':', '');
  const noiseMask = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
    const context = canvas.getContext('2d'); if (!context) return '';
    const pixels = context.createImageData(128, 128);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) pixels.data.set([255, 255, 255, Math.round(chapterTitleNoise((x + .5) / 128, (y + .5) / 128) * 255)], (y * 128 + x) * 4);
    context.putImageData(pixels, 0, 0); return canvas.toDataURL();
  }, []);
  const [clock, setClock] = useState(0);
  const [glyph, setGlyph] = useState<{ points: [number, number][]; width: number; height: number }>();
  const mesh = project.assets.find(asset => asset.id === presentation.titleImageId)?.emissionMesh;
  const titleSource = assetUrl(presentation.titleImageId), title = node?.title ?? '第一章';
  useEffect(() => {
    let active = true;
    const read = (source: HTMLImageElement | undefined) => {
      const canvas = document.createElement('canvas');
      canvas.width = source?.naturalWidth ?? 800; canvas.height = source?.naturalHeight ?? 100;
      const context = canvas.getContext('2d'); if (!context) return;
      if (source) context.drawImage(source, 0, 0);
      else { context.font = '54px serif'; context.fillStyle = '#fff'; context.fillText(title, 0, 70); }
      try { if (active) setGlyph({ points: mesh ? emissionMeshPoints(mesh) : chapterGlyphPoints(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height), width: canvas.width, height: canvas.height }); } catch { if (active) setGlyph(undefined); }
    };
    if (titleSource) { const image = new Image(); image.crossOrigin = 'anonymous'; image.onload = () => read(image); image.onerror = () => { if (active) setGlyph(undefined); }; image.src = titleSource; }
    else read(undefined);
    return () => { active = false; };
  }, [titleSource, title, mesh]);
  useEffect(() => {
    if (!playing || elapsed !== undefined) return;
    const started = performance.now(); let frame = 0;
    const update = () => { const value = (performance.now() - started) / 1000; setClock(value); if (value < presentation.duration) frame = requestAnimationFrame(update); else onComplete?.(); };
    frame = requestAnimationFrame(update); return () => cancelAnimationFrame(frame);
  }, [playing, elapsed, presentation.duration, title, onComplete]);
  const time = elapsed !== undefined ? elapsed / presentation.duration : playing ? clock / presentation.duration : .35;
  const frame = chapterFrame(time, presentation.effect);
  const letters: CSSProperties = { animation: 'none', opacity: frame.alpha, transform: `translateX(${frame.shift * project.width * scale * .5}px)`, filter: presentation.effect === 'ink' ? `url(#${maskId})` : undefined };
  const factor = glyph ? Math.min(rect.width * project.width / glyph.width, rect.height * project.height / glyph.height) : 1;
  const iw = (glyph?.width ?? 0) * factor / project.width, ih = (glyph?.height ?? 0) * factor / project.height;
  return <div className={`chapter-preview effect-${presentation.effect} ${playing || elapsed !== undefined ? 'is-playing' : 'is-static'}`} data-elapsed={elapsed ?? clock} aria-label="章节进场预览">
    <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}><defs><filter id={maskId} filterUnits="objectBoundingBox" primitiveUnits="objectBoundingBox" x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
      <feImage href={noiseMask} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="noise" />
      <feComponentTransfer in="noise" result="mask"><feFuncA type="linear" slope="1" intercept={frame.strength} /></feComponentTransfer>
      <feComposite in="SourceGraphic" in2="mask" operator="in" />
    </filter></defs></svg>
    <div className="chapter-preview-presence" style={{ animation: 'none', opacity: frame.surface, background: '#000' }}>
      <ChapterBackdrop presentation={presentation} assetUrl={assetUrl} seconds={time * chapterSource.timing.duration} />
      {theme.pages?.chapterTitle?.layout === 'custom' ? orderedUiComponents(project.ui).filter(c => c.page === 'chapterTitle').map(c => <div key={c.id} className={`ui-component ${c.kind} ${c.kind === 'chapterTitle' ? 'chapter-preview-letters' : ''}`} style={{ ...uiComponentPreviewStyle(project, c, scale), ...(c.kind === 'chapterTitle' ? letters : {}) }}>
        <UiComponentContent project={project} component={c} assetUrl={assetUrl} scale={scale} bindings={{ chapterTitle: title, chapterSubtitle: node?.subtitle, chapterTitleImageId: presentation.titleImageId }} />
      </div>) : <div className="chapter-preview-default chapter-preview-letters" style={{ gap: 12 * scale, fontSize: Math.min(56, Math.max(28, theme.fontSize + 12)) * scale, color: theme.accent, ...letters }}>
        {presentation.titleImageId ? <img src={titleSource} alt={title} style={{ maxWidth: '100%', height: project.height * scale * .16, objectFit: 'contain' }} /> : <><span>{title}</span>{node?.subtitle && <span style={{ fontSize: 24 * scale }}>{node.subtitle}</span>}</>}
      </div>}
      {presentation.effect === 'ink' && presentation.particles && !!glyph?.points.length && Array.from({ length: chapterParticleCount }, (_, i) => {
        const p = chapterParticle(i), [u, v] = glyph.points[(i * 7919) % glyph.points.length];
        const x = rect.x + (rect.width - iw) / 2 + u * iw, y = rect.y + (rect.height - ih) / 2 + v * ih;
        const motion = chapterParticleFrame(p, time); if (!motion.alpha) return null;
        const pixelsPerUnit = project.height / (chapterSource.projection.cameraOrthographicSize * 2), size = p.size * factor * chapterSource.projection.spritePixelsPerUnit * scale;
        return <i key={i} className="chapter-preview-particle" data-origin-x={x} data-origin-y={y} data-particle-index={i} style={{ animation: 'none', opacity: motion.alpha, left: `${(x + motion.dx * pixelsPerUnit / project.width) * 100}%`, top: `${(y + motion.dy * pixelsPerUnit / project.height) * 100}%`, width: size, height: size, transform: 'translate(-50%, -50%)', background: `radial-gradient(closest-side, ${presentation.particleColor}, ${presentation.particleColor}00)` }} />;
      })}
    </div>
  </div>;
}

export function ChapterStage({ project, node, assetUrl, playing, onComplete, elapsed }: { project: Project; node: ChapterContent; assetUrl: AssetUrl; playing: boolean; onComplete?: () => void; elapsed?: number }) {
  const surface = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!surface.current) return;
    const measure = () => setWidth(surface.current?.clientWidth ?? 0);
    const observer = new ResizeObserver(measure); observer.observe(surface.current); measure();
    return () => observer.disconnect();
  }, []);
  return <div className="text-stage chapter-story-stage" ref={surface} style={{ aspectRatio: `${project.width} / ${project.height}` }}><ChapterPreview project={project} node={node} assetUrl={assetUrl} scale={width / project.width} playing={playing} onComplete={onComplete} elapsed={elapsed} /></div>;
}

export function ChapterStageLayer({ project, chapter, assetUrl }: { project: Project; chapter: { action: import('../core/model').StageAction & { kind: 'chapter' }; elapsed?: number }; assetUrl: AssetUrl }) {
  return <div data-stage-chapter-layer={chapter.action.layer ?? 80} style={{ position: 'absolute', inset: 0, zIndex: chapter.action.layer ?? 80, pointerEvents: 'none' }}>
    <ChapterStage project={project} node={chapter.action} assetUrl={assetUrl} playing={false} elapsed={chapter.elapsed} />
  </div>;
}
