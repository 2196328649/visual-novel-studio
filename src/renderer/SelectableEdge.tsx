import { memo, useLayoutEffect, useRef } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useStore, type Edge, type EdgeProps } from '@xyflow/react';
import { ArrowRightLeft } from 'lucide-react';
import { storyReturnWirePath, type StoryWireBounds } from './story-wire-path';

export type StudioEdge = Edge<{ label: string; readonly?: boolean; caption?: string; storySource?: string; storyPort?: string; storyTarget?: string; gameFlowSource?: string; pageEvent?: { pageId: string; eventId: string }; routeReturns?: boolean; returnLane?: number; transitionLabel?: string; inspectTransition?: (id: string) => void }, 'studio'>;
const wireHitWidth = 28;

const SelectableEdge = memo(function SelectableEdge(props: EdgeProps<StudioEdge>) {
  const endpointBounds = useStore(state => {
    if (!props.data?.routeReturns || props.targetX > props.sourceX + 24) return '';
    const bounds = (id: string): StoryWireBounds | undefined => {
      const node = state.nodeLookup.get(id); if (!node) return;
      return { ...node.internals.positionAbsolute, width: node.measured.width ?? 242, height: node.measured.height ?? 120 };
    };
    return JSON.stringify([bounds(props.source), bounds(props.target)]);
  });
  const [path, x, y] = endpointBounds ? (() => {
    const [source, target] = JSON.parse(endpointBounds) as [StoryWireBounds | null, StoryWireBounds | null];
    return source && target ? storyReturnWirePath(props.sourceX, props.sourceY, props.targetX, props.targetY, source, target, props.data?.returnLane) : getBezierPath(props);
  })() : getBezierPath(props);
  const zoom = useStore(state => state.transform[2]);
  const curve = useRef<SVGGElement>(null);
  useLayoutEffect(() => {
    const group = curve.current, svg = group?.ownerSVGElement;
    if (!group || !svg) return;
    // The default 300 × 150 SVG can clip pointer hits on overflowing strokes.
    // Fit its viewport to the curve, including the screen-sized hit area and
    // reconnect handles, without changing any graph coordinates.
    const bounds = group.getBBox();
    const padding = Math.max((wireHitWidth / 2 + 6) / zoom, 24);
    const left = bounds.x - padding, top = bounds.y - padding;
    const width = bounds.width + padding * 2, height = bounds.height + padding * 2;
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `${left} ${top} ${width} ${height}`);
    svg.style.left = `${left}px`;
    svg.style.top = `${top}px`;
  }, [path, zoom]);
  return <>
    <g ref={curve}><BaseEdge id={props.id} path={path} interactionWidth={wireHitWidth / zoom} style={props.style} markerEnd={props.markerEnd} /></g>
    {props.data?.transitionLabel ? <EdgeLabelRenderer><button type="button" className={'story-wire-transition nodrag nopan' + (props.selected ? ' selected' : '')} data-flow-transition-edge={props.id} aria-label={props.data.label + ' · ' + props.data.transitionLabel} title={props.data.label + '\n' + props.data.transitionLabel + ' · 点击编辑'} style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }} onClick={event => { event.stopPropagation(); props.data?.inspectTransition?.(props.id); }} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); props.data?.inspectTransition?.(props.id); }}>
      {props.data.caption && <span className="story-wire-transition-caption">{props.data.caption}</span>}<ArrowRightLeft size={12} aria-hidden="true" /><span>{props.data.transitionLabel}</span>
    </button></EdgeLabelRenderer> : props.data?.caption && <EdgeLabelRenderer><div className="story-wire-caption" title={props.data.label} style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}>{props.data.caption}</div></EdgeLabelRenderer>}
  </>;
});

export const studioEdgeTypes = { studio: SelectableEdge };
