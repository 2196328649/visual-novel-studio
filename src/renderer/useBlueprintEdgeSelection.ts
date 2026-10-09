import { useCallback, useEffect, useState } from 'react';
import { useStoreApi, type Node, type OnEdgesChange } from '@xyflow/react';
import type { StudioEdge } from './SelectableEdge';
import { bezierIntersectsRect, parseBezierPath, type Bezier } from './blueprint-selection';

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
    const paths = new Map<string, { path: string; curve: Bezier }>();
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
          const curve = parseBezierPath(path); if (!curve) continue;
          cached = { path, curve }; paths.set(id, cached);
        }
        if (bezierIntersectsRect(cached.curve, rect, 1.5 / zoom)) ids.add(id);
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

  return { selectedEdgeIds, selectedEdgeId: selectedEdgeIds.size === 1 ? [...selectedEdgeIds][0] : undefined, setSelectedEdgeIds, setSelectedEdgeId, onEdgesChange };
}
