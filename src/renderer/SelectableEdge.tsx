import { memo, useLayoutEffect, useRef } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useStore, type Edge, type EdgeProps } from '@xyflow/react';
import { Unplug } from 'lucide-react';

export type StudioEdge = Edge<{ label: string; disconnect: (id: string) => void; showLabel?: boolean }, 'studio'>;
const wireHitWidth = 28;

const SelectableEdge = memo(function SelectableEdge(props: EdgeProps<StudioEdge>) {
  const [path, x, y] = getBezierPath(props);
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
    {props.selected && props.data?.showLabel !== false && <EdgeLabelRenderer><div className="connection-label nodrag nopan" style={{ transform: `translate(-50%, -100%) translate(${x}px, ${y - 10}px)` }}>
      <span>{props.data?.label}</span><button title="断开选中连线" aria-label="断开选中连线" onClick={event => { event.stopPropagation(); props.data?.disconnect(props.id); }}><Unplug size={14} /></button>
    </div></EdgeLabelRenderer>}
  </>;
});

export const studioEdgeTypes = { studio: SelectableEdge };
