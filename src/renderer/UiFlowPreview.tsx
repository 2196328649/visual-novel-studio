import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { Project, UiButtonState, UiComponent } from '../core/model';
import { storyFlowLayout } from '../core/story-flow';
import { flowNodeAppearance } from '../core/flow-style';
import { uiTextColor } from '../core/ui';
import { uiTextShadow, UiSkinImage, uiFontFamily, uiStateColor } from './UiAppearance';
import type { AssetUrl } from './StageEditor';

type Rect = { x: number; y: number; width: number; height: number };
const rectStyle = (r: Rect): CSSProperties => ({ position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height });
const clamp = (value: number, max = 1) => Math.max(0, Math.min(max, value));

export function UiFlowPreview({ project, component, assetUrl, scale, state }: { project: Project; component: UiComponent; assetUrl: AssetUrl; scale: number; state: UiButtonState }) {
  const graph = useMemo(() => storyFlowLayout(project, component), [project, component]);
  const list = component.list, custom = list?.flowScrollbar, showControls = list?.flowShowControls ?? true, showVertical = list?.flowShowVerticalScrollbar ?? true;
  const [zoom, setZoom] = useState(1), [scroll, setScroll] = useState({ x: 0, y: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined);
  const width = component.width * project.width, height = component.height * project.height;
  const relative = list?.flowViewport ?? { x: 0, y: 0, width: 1, height: 1 };
  const view = { x: relative.x * width, y: relative.y * height, width: relative.width * width, height: relative.height * height };
  const side = { x: view.x + (list?.flowViewport ? 0 : 16), y: view.y, width: Math.max(1, view.width - (list?.flowViewport ? 0 : 32)), height: Math.max(1, view.height - (showControls ? 44 : 0)) };
  const contentWidth = Math.max(1, side.width - (showVertical ? 24 : 0)), contentHeight = Math.max(1, side.height - (custom ? 0 : 24));
  const xRange = Math.max(0, graph.width * zoom - contentWidth), yRange = Math.max(0, graph.height * zoom - contentHeight);
  const thickness = list?.flowLineWidth ?? 4, graphScale = scale * zoom;
  const scaled = (rect: Rect) => rectStyle({ x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, height: rect.height * scale });
  const change = (x: number, y = scroll.y) => { const el = scrollRef.current; if (el) { el.scrollLeft = clamp(x, xRange) * scale; el.scrollTop = clamp(y, yRange) * scale; } };
  useLayoutEffect(() => {
    const el = scrollRef.current!;
    // The native flow map maps an ordinary wheel to horizontal navigation.
    const wheel = (event: WheelEvent) => {
      if (!xRange || event.ctrlKey) return;
      event.preventDefault(); event.stopPropagation();
      el.scrollLeft += (event.deltaX || event.deltaY) * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientWidth : 1);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    setScroll({ x: el.scrollLeft / scale, y: el.scrollTop / scale });
    return () => el.removeEventListener('wheel', wheel);
  }, [scale, zoom, xRange, yRange, contentWidth, contentHeight]);
  const horizontal = custom ? { x: custom.rect.x * width, y: custom.rect.y * height, width: custom.rect.width * width, height: custom.rect.height * height } : { x: side.x, y: side.y + contentHeight + 8, width: contentWidth, height: 16 };
  return <div style={{ width: '100%', height: '100%', position: 'relative' }}>
    <div ref={scrollRef} className="ui-story-flow-preview" title="滚轮横向滚动，按住鼠标中键拖动查看" onScroll={event => setScroll({ x: event.currentTarget.scrollLeft / scale, y: event.currentTarget.scrollTop / scale })} style={{ ...scaled({ x: side.x, y: side.y, width: contentWidth, height: contentHeight }), overflow: 'auto', scrollbarWidth: 'none' }}
      onPointerDown={event => { if (event.button !== 1) return; event.preventDefault(); event.stopPropagation(); pan.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (pan.current) { event.currentTarget.scrollLeft = pan.current.left + pan.current.x - event.clientX; event.currentTarget.scrollTop = pan.current.top + pan.current.y - event.clientY; } }}
      onPointerUp={event => { if (pan.current) { pan.current = undefined; event.currentTarget.releasePointerCapture(event.pointerId); } }} onPointerCancel={() => { pan.current = undefined; }} onLostPointerCapture={() => { pan.current = undefined; }}>
      <div style={{ position: 'relative', width: graph.width * graphScale, height: graph.height * graphScale }}>
        <svg width={graph.width * graphScale} height={graph.height * graphScale} viewBox={`0 0 ${graph.width} ${graph.height}`} style={{ position: 'absolute', inset: 0 }} aria-label="剧情分支连线">
          {graph.edges.map((edge, index) => <g key={index} data-flow-edge={`${edge.from}:${edge.to}`}><title>{edge.label}</title>{edge.points.slice(1).map((point, i) => {
            const a = edge.points[i], horizontal = a[1] === point[1], file = horizontal ? list?.flowLineAssetId : list?.flowVerticalLineAssetId;
            return file ? <image key={i} href={assetUrl(file)} x={Math.min(a[0], point[0]) - (horizontal ? 0 : thickness / 2)} y={Math.min(a[1], point[1]) - (horizontal ? thickness / 2 : 0)} width={Math.max(thickness, Math.abs(a[0] - point[0]))} height={Math.max(thickness, Math.abs(a[1] - point[1]))} preserveAspectRatio="none" /> : <line key={i} x1={a[0]} y1={a[1]} x2={point[0]} y2={point[1]} stroke={list?.flowLineColor ?? '#8c7963'} strokeWidth={thickness} />;
          })}</g>)}
        </svg>
        {graph.nodes.map(node => {
          const look = flowNodeAppearance(project, component, node), skin = look.skin;
          const hiddenCaption = skin?.hideText || state === 'disabled' && list?.lockUnread && skin?.disabled;
          return <div key={node.id} data-flow-node={node.id} style={{ ...rectStyle({ x: node.x * graphScale, y: node.y * graphScale, width: node.width * graphScale, height: node.height * graphScale }), display: 'grid', placeItems: 'center', textAlign: 'center', textShadow: uiTextShadow(look, graphScale), fontSize: (look.style?.fontSize ?? 24) * graphScale, fontFamily: uiFontFamily(look.style?.fontAssetId ?? project.ui.fontAssetId), color: uiTextColor(look, project.ui, state), background: skin?.idle ? undefined : uiStateColor(look, state), border: look.style?.borderWidth ? `${look.style.borderWidth * graphScale}px solid ${look.style.borderColor ?? project.ui.accent}` : undefined, borderRadius: (look.style?.radius ?? 0) * graphScale, opacity: look.style?.opacity ?? 1, boxSizing: 'border-box' }}>{state === 'selected' && list?.flowCurrentMarker && <img data-flow-current-marker alt="" draggable={false} src={assetUrl(list.flowCurrentMarker.assetId)} style={{ position: 'absolute', left: list.flowCurrentMarker.rect.x * node.width * graphScale, top: list.flowCurrentMarker.rect.y * node.height * graphScale, width: list.flowCurrentMarker.rect.width * node.width * graphScale, height: list.flowCurrentMarker.rect.height * node.height * graphScale, pointerEvents: 'none' }} />}<UiSkinImage skin={skin} state={state} assetUrl={assetUrl} scale={graphScale} />{!hiddenCaption && <FlowCaption width={Math.max(1, node.width - 72) * graphScale} height={Math.max(1, node.height - 16) * graphScale}>{state === 'disabled' && list?.lockUnread ? '未到达' : node.name}</FlowCaption>}</div>;
        })}
      </div>
    </div>
    <FlowScrollbar rect={horizontal} page={contentWidth} range={xRange} value={scroll.x} onChange={x => change(x)} skin={custom?.thumb} trackId={custom?.trackId} trackHeight={custom?.trackHeight ?? (custom ? 5 : 16)} thumbHeight={custom?.thumbHeight ?? (custom ? 31 : 16)} scale={scale} state={state} assetUrl={assetUrl} />
    {showVertical && <FlowScrollbar vertical rect={{ x: side.x + contentWidth + 8, y: side.y, width: 16, height: contentHeight }} page={contentHeight} range={yRange} value={scroll.y} onChange={y => change(scroll.x, y)} scale={scale} state={state} assetUrl={assetUrl} />}
    {showControls && <div data-flow-controls onPointerDown={event => event.stopPropagation()} style={{ ...scaled({ x: view.x + 24, y: view.y + side.height, width: Math.max(1, view.width - 24), height: 38 }), display: 'flex', alignItems: 'center', gap: 18 * scale, fontSize: Math.min(component.style?.fontSize ?? 24, 22) * scale, color: '#f4f0e6' }}>
      {list?.showProgress && <span>已读 {state === 'disabled' ? 0 : graph.nodes.length} / {graph.nodes.length}</span>}
      <button type="button" aria-label="缩小流程图" onClick={() => setZoom(value => Math.max(.5, Math.round((value - .1) * 10) / 10))}>−</button>
      <span>{Math.round(zoom * 100)}%</span>
      <button type="button" aria-label="放大流程图" onClick={() => setZoom(value => Math.min(1.5, Math.round((value + .1) * 10) / 10))}>+</button>
      <button type="button" disabled={!graph.nodes.length} onClick={() => { const node = graph.nodes.find(item => item.id === project.entryId) ?? graph.nodes[0]; if (node) change(node.x * zoom - view.width / 3, node.y * zoom - view.height / 3); }}>定位当前位置</button>
    </div>}
  </div>;
}

export function FlowScrollbar({ rect, page, range, value, onChange, vertical = false, skin, trackId, trackHeight = 16, thumbHeight = 16, scale, state, assetUrl, trackWidth, label }: { rect: Rect; page: number; range: number; value: number; onChange: (value: number) => void; vertical?: boolean; skin?: UiComponent['skin']; trackId?: string; trackHeight?: number; thumbHeight?: number; scale: number; state: UiButtonState; assetUrl: AssetUrl; trackWidth?: number; label?: string }) {
  const dragOffset = useRef<number | undefined>(undefined), [hover, setHover] = useState(false), [held, setHeld] = useState(false);
  const dimension = vertical ? rect.height : rect.width;
  const minThumb = skin?.fit === 'nineSlice' ? (vertical ? (skin.borders?.top ?? 12) + (skin.borders?.bottom ?? 12) : (skin.borders?.left ?? 12) + (skin.borders?.right ?? 12)) + 1 : 16;
  const thumbSize = Math.min(dimension, Math.max(minThumb, dimension * page / Math.max(1, page + range))), travel = dimension - thumbSize;
  const position = range ? clamp(value / range) * travel : 0;
  const actualState = range <= 0 || state === 'disabled' ? 'disabled' : state !== 'idle' ? state : held ? 'pressed' : hover ? 'hover' : 'idle';
  const pointerPosition = (event: PointerEvent<HTMLDivElement>) => { const bounds = event.currentTarget.getBoundingClientRect(); return (vertical ? event.clientY - bounds.top : event.clientX - bounds.left) / scale; };
  const move = (event: PointerEvent<HTMLDivElement>) => { if (dragOffset.current !== undefined && travel > 0) onChange(clamp((pointerPosition(event) - dragOffset.current) / travel) * range); };
  const release = (event: PointerEvent<HTMLDivElement>) => { dragOffset.current = undefined; setHeld(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); };
  return <div data-flow-scrollbar={vertical ? 'vertical' : 'horizontal'} data-scroll-state={actualState} role="scrollbar" aria-label={label ?? (vertical ? '流程图竖向滚动条' : '流程图横向滚动条')} aria-orientation={vertical ? 'vertical' : 'horizontal'} aria-valuemin={0} aria-valuemax={Math.round(range)} aria-valuenow={Math.round(value)} aria-disabled={range <= 0} tabIndex={range > 0 ? 0 : -1} style={{ ...rectStyle({ x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, height: rect.height * scale }), cursor: range > 0 ? 'pointer' : 'default', touchAction: 'none', textShadow: 'none' }}
    onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
    onPointerDown={event => { event.stopPropagation(); if (event.button !== 0 || range <= 0) return; event.preventDefault(); event.currentTarget.focus(); const point = pointerPosition(event); dragOffset.current = point >= position && point <= position + thumbSize ? point - position : thumbSize / 2; event.currentTarget.setPointerCapture(event.pointerId); setHeld(true); move(event); }}
    onPointerMove={move} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={() => { dragOffset.current = undefined; setHeld(false); }}
    onKeyDown={event => { const next = event.key === 'Home' ? 0 : event.key === 'End' ? range : event.key === 'PageDown' ? value + page : event.key === 'PageUp' ? value - page : event.key === (vertical ? 'ArrowDown' : 'ArrowRight') ? value + 40 : event.key === (vertical ? 'ArrowUp' : 'ArrowLeft') ? value - 40 : undefined; if (next !== undefined) { event.preventDefault(); event.stopPropagation(); onChange(clamp(next, range)); } }}>
    <span style={{ position: 'absolute', top: 0, ...(vertical ? { width: trackWidth ? trackWidth * scale : '100%', height: '100%', left: '50%', transform: 'translateX(-50%)' } : { width: '100%', height: Math.min(rect.height, trackHeight) * scale, top: '50%', transform: 'translateY(-50%)' }), background: trackId ? undefined : '#282e2c', pointerEvents: 'none' }}>{trackId && <img alt="" draggable={false} src={assetUrl(trackId)} style={{ display: 'block', width: '100%', height: '100%' }} />}</span>
    <span data-flow-scrollbar-thumb style={{ position: 'absolute', ...(vertical ? { top: position * scale, height: thumbSize * scale, width: '100%' } : { left: position * scale, width: thumbSize * scale, height: Math.min(rect.height, thumbHeight) * scale, top: '50%', transform: 'translateY(-50%)' }), pointerEvents: 'none', background: skin?.idle ? undefined : actualState === 'disabled' ? '#626b68' : actualState === 'hover' ? '#fff5de' : actualState === 'pressed' ? '#c9c0aa' : '#d4cbb5' }}><UiSkinImage skin={skin} state={actualState} assetUrl={assetUrl} scale={scale} /></span>
  </div>;
}

function FlowCaption({ children, width, height }: { children: string; width: number; height: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const text = ref.current!;
    const fit = () => { text.style.transform = `scale(${Math.min(1, width / Math.max(1, text.offsetWidth), height / Math.max(1, text.offsetHeight))})`; };
    const observer = new ResizeObserver(fit); observer.observe(text); fit();
    return () => observer.disconnect();
  }, [children, width, height]);
  return <span ref={ref} style={{ position: 'relative', whiteSpace: 'nowrap', width: 'max-content' }}>{children}</span>;
}
