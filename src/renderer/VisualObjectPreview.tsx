import { uiTextShadow, textClipCss } from '../core/ui-text-effects';
import { visualPhasePose } from '../core/visual-transitions';
import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { chapterTitleNoise } from '../core/chapter';
import { ChapterRipple } from './ChapterRipple';
import type { Project, VisualObject } from '../core/model';
import { videoFadeGain, videoPlaybackState, visualCurve, visualDissolve, visualParticles, visualPose } from '../core/visual-object';
import type { AssetUrl } from './StageEditor';
import { GlyphParticlesPreview } from './GlyphParticlesPreview';
let sharedTitleNoise: string | undefined;

export interface VisualEditing {
  canSelect?: (rootId: string, instanceId: string) => boolean;
  open?: (rootId: string, instanceId: string) => void;
  selected: (rootId: string, instanceId: string) => boolean;
  select: (rootId: string, instanceId: string) => void;
  move: (rootId: string, instanceId: string, patch: { x: number; y: number }) => void;
  transform?: (rootId: string, instanceId: string, patch: { x?: number; y?: number; scale?: number; scaleX?: number; scaleY?: number; rotation?: number }) => void;
  visible?: (rootId: string, instanceId: string) => boolean;
  isolate?: boolean;
  backgroundVisible?: boolean;
  actorVisible?: (characterId: string, instanceId?: string) => boolean;
  audioEnabled?: (key: string, assetId?: string) => boolean;
}
const VisualGuideContext = createContext<SVGSVGElement | null>(null);
/** Keep editing guides above every visual layer and outside content masks and fades. */
export function VisualEditingSurface({ children }: { children: ReactNode }) {
  const [surface, setSurface] = useState<SVGSVGElement | null>(null);
  return <VisualGuideContext.Provider value={surface}>{children}<svg ref={setSurface} className="visual-editing-surface" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none', zIndex: 10000 }} /></VisualGuideContext.Provider>;
}
export function VisualObjectPreview({ frame, ...props }: Parameters<typeof BaseVisualObjectPreview>[0] & { frame?: import('../core/preview-visuals').PreviewVisual }) {
  const blend = frame?.blend;
  if (!blend) return <BaseVisualObjectPreview {...props} skipEnter={frame?.skipEnter ?? props.skipEnter} />;
  const progress = Math.min(1, blend.elapsed / blend.rule.duration), split = blend.rule.mode === 'fade' && !blend.exiting;
  const incoming = split ? Math.max(0, progress * 2 - 1) : progress, outgoing = split ? Math.max(0, 1 - progress * 2) : 1 - progress;
  const position = { position: 'absolute' as const, inset: 0, pointerEvents: 'none' as const };
  return <div data-visual-transition={props.object.instanceId} style={{ ...position, isolation: 'isolate', zIndex: props.object.layer }}>
    <div style={{ ...position, opacity: outgoing, mixBlendMode: blend.rule.mode === 'dissolve' ? 'plus-lighter' : undefined, transform: blend.rule.mode === 'move' ? `translateX(${progress * 15}%)` : undefined }}><VisualObjectPreview {...props} object={blend.previous.object} elapsed={blend.previous.elapsed} mediaAdvance={(props.mediaAdvance ?? 0) + blend.elapsed} frame={blend.previous} editing={undefined} /></div>
    {!blend.exiting && <div style={{ ...position, opacity: incoming, mixBlendMode: blend.rule.mode === 'dissolve' ? 'plus-lighter' : undefined, transform: blend.rule.mode === 'move' ? `translateX(${(progress - 1) * 15}%)` : undefined }}><BaseVisualObjectPreview {...props} skipEnter /></div>}
  </div>;
}
function BaseVisualObjectPreview({ object, elapsed, project, assetUrl, editing, playing = false, rootId = object.instanceId, skipEnter = false, mediaAdvance = 0 }: { object: VisualObject; elapsed: number; project: Project; assetUrl: AssetUrl; editing?: VisualEditing; playing?: boolean; rootId?: string; skipEnter?: boolean; mediaAdvance?: number }) {
  const sampledPose = visualPose(object, elapsed);
  const visible = editing?.visible?.(rootId, object.instanceId) !== false;
  const [point, setPoint] = useState<Partial<typeof sampledPose>>();
  const drag = useRef<{ inverse: DOMMatrix; start: DOMPoint; pose: typeof sampledPose; mode: 'move' | 'scale' | 'rotate'; next: Partial<typeof sampledPose>; element: SVGElement; pointerId: number } | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const guideSurface = useContext(VisualGuideContext);
  const [guideMatrix, setGuideMatrix] = useState('');
  const [handleUnit, setHandleUnit] = useState(1);
  const cancel = () => {
    const current = drag.current; drag.current = undefined; setPoint(undefined);
    if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
  };
  useEffect(() => { cancel(); }, [object, elapsed, !!editing]);
  useEffect(() => () => { const current = drag.current; if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId); }, []);
  useEffect(() => { const video = videoRef.current; return () => video?.pause(); }, [object.assetId, visible]);
  useEffect(() => { window.addEventListener('blur', cancel); return () => window.removeEventListener('blur', cancel); }, []);
  useEffect(() => {
    const video = videoRef.current;
    if (object.content !== 'video' || !video) return;
    const sync = () => {
      const { position: target, active } = videoPlaybackState(object, elapsed + mediaAdvance, video.duration);
      if (video.readyState >= 1 && Number.isFinite(target) && Math.abs(video.currentTime - target) > .04) video.currentTime = target;
      video.style.visibility = active ? 'visible' : 'hidden';
      video.muted = object.muted ?? false;
      video.volume = Math.max(0, Math.min(1, (object.volume ?? 1) * videoFadeGain(object, elapsed)));
      if (editing?.visible?.(rootId, object.instanceId) === false) { video.pause(); return; }
      if (playing && active && !(editing?.canSelect?.(rootId, object.instanceId) ?? !!editing)) {
        if (video.paused) void video.play().catch(() => undefined);
      } else video.pause();
    };
    sync();
    video.addEventListener('loadedmetadata', sync);
    return () => video.removeEventListener('loadedmetadata', sync);
  }, [object.content, object.assetId, object.mediaOffset, object.muted, object.volume, object.duration, object.persistent, object.loop, object.fadeIn, object.fadeOut, elapsed, mediaAdvance, editing, playing]);
  const phase = visualPhasePose(object, elapsed, skipEnter);
  const pose = { ...sampledPose, ...point, x: (point?.x ?? sampledPose.x) + phase.x, opacity: sampledPose.opacity * phase.opacity };
  useLayoutEffect(() => {
    if (!editing?.selected(rootId, object.instanceId)) return;
    const measure = () => {
      const matrix = svgRef.current?.getScreenCTM();
      if (matrix) { const unit = 1 / Math.max(.001, Math.hypot(matrix.a, matrix.b) * Math.abs(pose.scale)); setHandleUnit(before => Math.abs(before - unit) < .001 ? before : unit); }
      const surfaceMatrix = guideSurface?.getScreenCTM();
      if (matrix && surfaceMatrix && Math.abs(surfaceMatrix.a * surfaceMatrix.d - surfaceMatrix.b * surfaceMatrix.c) > 1e-12) {
        const relative = surfaceMatrix.inverse().multiply(matrix);
        const value = `matrix(${relative.a} ${relative.b} ${relative.c} ${relative.d} ${relative.e} ${relative.f})`;
        setGuideMatrix(before => before === value ? before : value);
      }
    };
    measure();
    const observer = new ResizeObserver(measure); if (svgRef.current) observer.observe(svgRef.current); if (guideSurface) observer.observe(guideSurface);
    return () => observer.disconnect();
  });
  const selected = editing?.selected(rootId, object.instanceId);
  const id = useId().replaceAll(':', '');
  const noise = useMemo(() => {
    if (!object.dissolve && !object.curves?.dissolveStrength) return undefined;
    if (sharedTitleNoise) return sharedTitleNoise;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d')!; const pixels = context.createImageData(128, 128);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) pixels.data.set([255, 255, 255, Math.round(chapterTitleNoise((x + .5) / 128, (y + .5) / 128) * 255)], (y * 128 + x) * 4);
    context.putImageData(pixels, 0, 0); return sharedTitleNoise = canvas.toDataURL();
  }, [!!object.dissolve, !!object.curves?.dissolveStrength]);
  const hasRipple = !!(object.ripple || object.curves?.rippleStrength || object.curves?.rippleSpeed);
  const imageAlignment = object.imageAlign === 'top' ? 'xMidYMin' : object.imageAlign === 'bottom' ? 'xMidYMax' : 'xMidYMid';
  const fontId = object.fontAssetId ?? project.ui.fontAssetId;
  const fontSource = fontId ? assetUrl(fontId) : window.studio?.defaultFontUrl?.();
  const fontFamily = fontId ? `vns_${fontId}` : 'vns_runtime_default';
  const begin = (event: PointerEvent<SVGElement>, mode: 'move' | 'scale' | 'rotate') => {
    if (event.button !== 0 || !editing) return;
    const matrix = svgRef.current?.getScreenCTM(); if (!matrix || Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) < 1e-12) return;
    event.preventDefault(); event.stopPropagation(); editing.select(rootId, object.instanceId);
    event.currentTarget.focus({ preventScroll: true });
    const inverse = matrix.inverse(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { inverse, start: new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse), pose: sampledPose, next: {}, mode, element: event.currentTarget, pointerId: event.pointerId };
  };
  const move = (event: PointerEvent<SVGElement>) => {
    const current = drag.current; if (!current) return;
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(current.inverse), initial = current.pose;
    const cx = initial.x * project.width, cy = initial.y * project.height;
    if (current.mode === 'move') current.next = { x: initial.x + (local.x - current.start.x) / project.width, y: initial.y + (local.y - current.start.y) / project.height };
    else if (current.mode === 'scale') {
      const radians = initial.rotation * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
      const startX = (current.start.x - cx) * cosine + (current.start.y - cy) * sine;
      const startY = -(current.start.x - cx) * sine + (current.start.y - cy) * cosine;
      const nextX = (local.x - cx) * cosine + (local.y - cy) * sine;
      const nextY = -(local.x - cx) * sine + (local.y - cy) * cosine;
      const ratio = Math.hypot(local.x - cx, local.y - cy) / Math.max(.01, Math.hypot(current.start.x - cx, current.start.y - cy));
      const nonzero = (value: number) => Math.abs(value) < .01 ? value < 0 ? -.01 : .01 : value;
      current.next = { scaleX: nonzero((initial.scaleX ?? 1) * (event.shiftKey ? ratio : Math.abs(startX) > .01 ? nextX / startX : 1)), scaleY: nonzero((initial.scaleY ?? 1) * (event.shiftKey ? ratio : Math.abs(startY) > .01 ? nextY / startY : 1)) };
    } else {
      let delta = (Math.atan2(local.y - cy, local.x - cx) - Math.atan2(current.start.y - cy, current.start.x - cx)) * 180 / Math.PI;
      if (delta > 180) delta -= 360; if (delta < -180) delta += 360;
      let rotation = initial.rotation + delta; if (event.shiftKey) rotation = Math.round(rotation / 15) * 15;
      current.next = { rotation };
    }
    setPoint(current.next);
  };
  const finish = (event: PointerEvent<SVGElement>) => {
    event.stopPropagation(); move(event); const current = drag.current;
    if (current && Object.entries(current.next).some(([key, value]) => current.pose[key as keyof typeof sampledPose] !== value)) {
      if (editing?.transform) editing.transform(rootId, object.instanceId, current.next);
      else if (current.next.x !== undefined && current.next.y !== undefined) editing?.move(rootId, object.instanceId, { x: current.next.x, y: current.next.y });
    }
    cancel();
  };
  const gestureEvents = { onPointerMove: move, onPointerUp: finish, onPointerCancel: cancel, onLostPointerCapture: cancel, onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); } } };
  const selectionRect = editing && (editing.canSelect?.(rootId, object.instanceId) ?? true) && <rect data-visual-handle={object.instanceId} x={-object.width * project.width / 2} y={-object.height * project.height / 2} width={object.width * project.width} height={object.height * project.height} fill="transparent" stroke={selected ? '#67c8ff' : 'none'} strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'all', cursor: 'move', touchAction: 'none' }} role="button" tabIndex={0} aria-label={`选择对象 ${object.name}`} aria-pressed={!!selected}
      onFocus={() => editing.select(rootId, object.instanceId)}
      onClick={event => event.stopPropagation()}
      onDoubleClick={event => { event.stopPropagation(); editing.open?.(rootId, object.instanceId); }}
      onPointerDown={event => begin(event, 'move')} onPointerMove={move} onPointerUp={finish}
      onPointerCancel={cancel} onLostPointerCapture={cancel}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); return; }
        const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        if (!delta) return; event.preventDefault(); event.stopPropagation();
        const step = event.shiftKey ? .05 : .01;
        editing.move(rootId, object.instanceId, { x: sampledPose.x + delta[0] * step, y: sampledPose.y + delta[1] * step });
      }} />;
  const transformHandles = selected && editing?.transform && <g className="visual-transform-handles" fill="#ffffff" stroke="#67c8ff" strokeWidth={2}>
      {([-1, 1] as const).flatMap(x => ([-1, 1] as const).map(y => <circle key={x + '/' + y} data-visual-scale={object.instanceId} cx={x * object.width * project.width / 2} cy={y * object.height * project.height / 2} r={7 * handleUnit} vectorEffect="non-scaling-stroke" role="button" tabIndex={0} aria-label={'缩放对象 ' + object.name} style={{ pointerEvents: 'all', cursor: 'nwse-resize', touchAction: 'none' }} onPointerDown={event => begin(event, 'scale')} {...gestureEvents} />))}
      <line x1={0} x2={0} y1={-object.height * project.height / 2} y2={-object.height * project.height / 2 - 28 * handleUnit} vectorEffect="non-scaling-stroke" />
      <circle data-visual-rotate={object.instanceId} cx={0} cy={-object.height * project.height / 2 - 28 * handleUnit} r={7 * handleUnit} vectorEffect="non-scaling-stroke" role="button" tabIndex={0} aria-label={'旋转对象 ' + object.name} style={{ pointerEvents: 'all', cursor: 'grab', touchAction: 'none' }} onPointerDown={event => begin(event, 'rotate')} {...gestureEvents} />
    </g>;
  const poseTransform = `translate(${pose.x * project.width},${pose.y * project.height}) rotate(${pose.rotation}) scale(${pose.scale * (pose.scaleX ?? 1)},${pose.scale * (pose.scaleY ?? 1)})`;
  const portalGuides = selected && guideSurface && guideMatrix;
  if (!visible) return null;
  return <><svg ref={svgRef} data-visual-instance={object.instanceId} viewBox={`0 0 ${project.width} ${project.height}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: object.layer, pointerEvents: 'none', overflow: 'visible' }}>
    <defs><filter id={id + '_dissolve'} x="0" y="0" width="1" height="1" filterUnits="objectBoundingBox" primitiveUnits="objectBoundingBox" colorInterpolationFilters="sRGB"><feImage href={noise} width="1" height="1" preserveAspectRatio="none" result="noise" /><feComponentTransfer in="noise" result="mask"><feFuncA type="linear" slope="1" intercept={visualDissolve(object, elapsed)} /></feComponentTransfer><feComposite in="SourceGraphic" in2="mask" operator="in" /></filter><mask id={id + '_mask'} maskContentUnits="objectBoundingBox" style={{ maskType: 'alpha' }}><image href={assetUrl(object.maskAssetId)} width="1" height="1" preserveAspectRatio="none" /></mask></defs>
    <g transform={poseTransform}>
    {!portalGuides && selectionRect}
    <g opacity={pose.opacity * (object.content === 'video' ? videoFadeGain(object, elapsed) : 1)} filter={object.dissolve || object.curves?.dissolveStrength ? `url(#${id}_dissolve)` : undefined} mask={object.maskAssetId ? `url(#${id}_mask)` : undefined}>
      {object.content === 'solid' && <rect x={-object.width * project.width / 2} y={-object.height * project.height / 2} width={object.width * project.width} height={object.height * project.height} fill={object.color} />}
      {object.content === 'group' && <foreignObject x={-object.width * project.width / 2} y={-object.height * project.height / 2} width={object.width * project.width} height={object.height * project.height}>
        <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', isolation: 'isolate' }}>{(object.children ?? []).filter(child => elapsed >= (child.startAt ?? 0) && (child.persistent || elapsed < (child.startAt ?? 0) + child.duration)).map(child => <VisualObjectPreview key={child.instanceId} object={child} elapsed={elapsed - (child.startAt ?? 0)} project={{ ...project, width: object.width * project.width, height: object.height * project.height }} assetUrl={assetUrl} editing={editing} playing={playing} rootId={rootId} />)}</div>
      </foreignObject>}
      {object.content === 'image' && !hasRipple && <image href={assetUrl(object.assetId)} x={-object.width * project.width / 2} y={-object.height * project.height / 2} width={object.width * project.width} height={object.height * project.height} preserveAspectRatio={object.imageFit === 'contain' ? imageAlignment + ' meet' : object.imageFit === 'cover' ? imageAlignment + ' slice' : 'none'} style={{ overflow: 'hidden' }} />}
      {object.content === 'image' && hasRipple && <foreignObject x={-object.width * project.width / 2} y={-object.height * project.height / 2} width={object.width * project.width} height={object.height * project.height}><ChapterRipple source={assetUrl(object.assetId) ?? ''} seconds={elapsed} strength={visualCurve(object, 'rippleStrength', elapsed, object.ripple?.strength ?? .01)} speed={visualCurve(object, 'rippleSpeed', elapsed, object.ripple?.speed ?? 1)} fit={object.imageFit ?? 'stretch'} fitBeforeRipple alignY={object.imageAlign === 'top' ? 0 : object.imageAlign === 'bottom' ? 1 : .5} /></foreignObject>}
      {object.content === 'video' && <foreignObject x={-object.width * project.width / 2} y={-object.height * project.height / 2} width={object.width * project.width} height={object.height * project.height} style={{ overflow: 'hidden' }}><video ref={videoRef} loop={object.loop ?? false} src={assetUrl(object.assetId)} preload="auto" playsInline controls={false} style={{ width: '100%', height: '100%', objectFit: object.imageFit === 'contain' ? 'contain' : object.imageFit === 'cover' ? 'cover' : 'fill', pointerEvents: 'none' }} /></foreignObject>}
      {object.content === 'text' && <foreignObject x={-object.width * project.width / 2} y={-object.height * project.height / 2} width={object.width * project.width} height={object.height * project.height}>
        {fontSource && <style>{`@font-face { font-family: ${JSON.stringify(fontFamily)}; src: url(${JSON.stringify(fontSource)}); }`}</style>}
        <div data-visual-text style={{ width: '100%', height: '100%', display: 'flex', alignItems: object.textVerticalAlign === 'top' ? 'flex-start' : object.textVerticalAlign === 'bottom' ? 'flex-end' : 'center', justifyContent: object.textAlign === 'left' ? 'flex-start' : object.textAlign === 'right' ? 'flex-end' : 'center', overflow: 'hidden', color: object.color, textShadow: uiTextShadow({ style: object.textEffects }, 1), clipPath: textClipCss(object.textClip), fontSize: object.fontSize, fontFamily: fontSource ? fontFamily : 'sans-serif', fontStyle: object.textItalic ? 'italic' : 'normal', fontSynthesis: 'style', lineHeight: 'normal', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', textAlign: object.textAlign ?? 'center' }}><span>{object.text}</span></div>
      </foreignObject>}
      {object.content === 'particles' && object.glyphParticles && <GlyphParticlesPreview fontSource={fontSource} mesh={project.assets.find(asset => asset.id === object.glyphParticles?.assetId)?.emissionMesh} object={object} elapsed={elapsed} width={object.width * project.width} height={object.height * project.height} source={assetUrl(object.glyphParticles.assetId)} />}
      {object.content === 'particles' && !object.glyphParticles && visualParticles(object, elapsed).map((p, i) => <rect key={i} x={(p.x - .5) * object.width * project.width - p.size / 2} y={(p.y - .5) * object.height * project.height - p.size / 2} width={p.size} height={p.size} fill={p.color} opacity={p.opacity} />)}
    </g>
    {!portalGuides && transformHandles}</g>
  </svg>{portalGuides && createPortal(<g transform={guideMatrix}><g transform={poseTransform}>{selectionRect}{transformHandles}</g></g>, guideSurface)}</>;
}
