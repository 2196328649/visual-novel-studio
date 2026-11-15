import { useCallback, useEffect, useState } from 'react';
import { useStoreApi, type Node, type OnEdgesChange } from '@xyflow/react';
import type { StudioEdge } from './SelectableEdge';
import { bezierIntersectsRect, parseBezierSegments, type Bezier } from './blueprint-selection';

const sameIds = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every(id => b.has(id));

export function useBlueprintEdgeSelection<NodeType extends Node>(scopeId: string | undefined) {
  const store = useStoreApi<NodeType, StudioEdge>();
  const [selectedEdgeIds, setIds] = useState<ReadonlySet<string>>(new Set());
  const setSelectedEdgeIds = useCallback((ids: ReadonlySet<string>) => setIds(previous => sameIds(previous, ids) ? previous : ids), []);
  const setSelectedEdgeId = useCallback((id?: string) => setSelectedEdgeIds(new Set(id ? [id] : [])), [setSelectedEdgeIds]);
  useEffect(() => setSelectedEdgeId(), [scopeId, setSelectedEdgeId]);

  const onEdgesChange: OnEdgesChange<StudioEdge> = useCallback(changes => {
    // React Flow normally selects every edge incident to a selected node. While
    // dragging a marquee, the rendered curves below are the source of truth.
    if (store.getState().userSelectionRect) return;
    setIds(previous => {
      const next = new Set(previous);
      for (const change of changes) {
        if (change.type === 'select') change.selected ? next.add(change.id) : next.delete(change.id);
        else if (change.type === 'remove') next.delete(change.id);
      }
      return sameIds(previous, next) ? previous : next;
    });
  }, [store]);

  useEffect(() => {
    let frame = 0;
    let pending: { rect: { x: number; y: number; width: number; height: number }; zoom: number } | undefined;
    const paths = new Map<string, { path: string; curves: Bezier[] }>();
    const flush = () => {
      cancelAnimationFrame(frame); frame = 0;
      if (!pending) return;
      const { rect, zoom } = pending; pending = undefined;
      const ids = new Set<string>(), state = store.getState();
      for (const element of state.domNode?.querySelectorAll<SVGPathElement>('.react-flow__edge-path') ?? []) {
        const id = element.closest('.react-flow__edge')?.getAttribute('data-id');
        const edge = id ? state.edgeLookup.get(id) : undefined;
        if (!id || !edge || edge.hidden || edge.selectable === false) continue;
        const path = element.getAttribute('d') ?? '';
        let cached = paths.get(id);
        if (cached?.path !== path) {
          const curves = parseBezierSegments(path); if (!curves.length) continue;
          cached = { path, curves }; paths.set(id, cached);
        }
        if (cached.curves.some(curve => bezierIntersectsRect(curve, rect, 1.5 / zoom))) ids.add(id);
      }
      setSelectedEdgeIds(ids);
    };
    const unsubscribe = store.subscribe((state, previous) => {
      if (state.userSelectionRect === previous.userSelectionRect) return;
      const rect = state.userSelectionRect;
      if (!rect) { flush(); paths.clear(); return; }
      if (!state.userSelectionActive) return;
      const [x, y, zoom] = state.transform;
      pending = { rect: { x: (rect.x - x) / zoom, y: (rect.y - y) / zoom, width: rect.width / zoom, height: rect.height / zoom }, zoom };
      if (!frame) frame = requestAnimationFrame(flush);
    });
    return () => { unsubscribe(); cancelAnimationFrame(frame); };
  }, [store, setSelectedEdgeIds]);

  useEffect(() => {
    // Wires keep a wide hit area for clicking, but React Flow starts a marquee
    // only on the bare pane. A press on a wire stays a wire click until it
    // moves; then it becomes the same marquee as one started beside the wire.
    let press: { pointerId: number; x: number; y: number } | undefined;
    const down = (event: PointerEvent) => {
      press = undefined;
      const { domNode, elementsSelectable, connection } = store.getState();
      const target = event.target instanceof Element ? event.target : null;
      if (event.button !== 0 || event.pointerType === 'touch' || !elementsSelectable || connection.inProgress || !target || !domNode?.contains(target)) return;
      // Endpoint handles still reconnect the wire.
      if (target.closest('.react-flow__edge') && !target.closest('.react-flow__edgeupdater')) press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const move = (event: PointerEvent) => {
      if (!press || event.pointerId !== press.pointerId) return;
      if (!(event.buttons & 1)) { press = undefined; return; }
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < 6) return;
      const start = press; press = undefined;
      const { domNode, transform, userSelectionRect } = store.getState(), pane = domNode?.querySelector<HTMLElement>('.react-flow__pane');
      // A Shift selection may already own this press.
      if (!domNode || !pane?.classList.contains('selection') || userSelectionRect) return;
      pane.setPointerCapture(event.pointerId);
      const bounds = domNode.getBoundingClientRect(), x = start.x - bounds.left, y = start.y - bounds.top;
      store.setState({ userSelectionRect: { startX: (x - transform[0]) / transform[2], startY: (y - transform[1]) / transform[2], x, y, width: 0, height: 0 } });
    };
    const end = (event: PointerEvent) => { if (event.pointerId === press?.pointerId) press = undefined; };
    window.addEventListener('pointerdown', down, true); window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', end, true); window.addEventListener('pointercancel', end, true);
    return () => {
      window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', end, true); window.removeEventListener('pointercancel', end, true);
    };
  }, [store]);

  return { selectedEdgeIds, selectedEdgeId: selectedEdgeIds.size === 1 ? [...selectedEdgeIds][0] : undefined, setSelectedEdgeIds, setSelectedEdgeId, onEdgesChange };
}
