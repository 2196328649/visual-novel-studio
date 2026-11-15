import { playerFlowAllEntries, playerFlowMode, playerFlowPositions, playerFlowView } from '../core/player-flow-content';
import { uiComponentTheme } from '../core/ui-page-settings';
import { useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { Project, UiButtonState, UiComponent } from '../core/model';
import { flowEdgeSegments, flowEdgeUnlocked, moveStoryFlowLayout, snapFlowPosition, storyFlowBrowseLayout, storyFlowLayout, storyFlowDefaults, type FlowBox, type FlowEdge } from '../core/story-flow';
import { flowNodeAppearance } from '../core/flow-style';
import { uiSkinAsset } from '../core/ui';
import { uiIdentity, type UiLayoutGeometry } from '../core/ui-layout';
import { uiScreenToLocalDelta, uiScreenToLocalPoint } from '../core/ui-transform';
import { UiSkinImage } from './UiAppearance';
import { UiFlowEditContext, flowPreviewNodes, playerFlowPreviewEntryIds } from './UiFlowEditing';
import { UiFlowAffectedOutline, UiFlowNodeFace, flowNodePreviewStyle } from './UiFlowNodePreview';
import type { AssetUrl } from './StageEditor';
import './ui-flow-preview.css';

type Rect = { x: number; y: number; width: number; height: number };
const rectStyle = (r: Rect): CSSProperties => ({ position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height });
const clamp = (value: number, max = 1) => Math.max(0, Math.min(max, value));

type FlowLayout = ReturnType<typeof storyFlowLayout>;
interface FlowDragPosition { id: string; x: number; y: number; groupId?: string; graph: FlowLayout; frame: string }
interface FlowNodeDrag extends FlowDragPosition {
  startX: number; startY: number; moved: boolean; pointerId: number; target: HTMLDivElement;
  latest?: { x: number; y: number };
}
interface FlowPan { pointerId: number; target: HTMLDivElement; graph: FlowLayout; frame: string; startX: number; startY: number; left: number; top: number }

export function UiFlowPreview({ project, component, geometry, assetUrl, scale, state }: { project: Project; component: UiComponent; geometry?: UiLayoutGeometry; assetUrl: AssetUrl; scale: number; state: UiButtonState }) {
  const themedProject = useMemo(() => ({ ...project, ui: uiComponentTheme(project, component) }), [project, component]);
  const edit = useContext(UiFlowEditContext), editable = edit?.componentId === component.id;
  const customMode = playerFlowMode(component) === 'custom';
  const groupId = editable ? edit.groupId : undefined;
  const flowView = useMemo(() => playerFlowView(project, component, groupId), [project, component, groupId]);
  const hasCalls = project.nodes.some(node => node.kind === 'call');
  const allEntries = useMemo(() => playerFlowAllEntries(project, component), [project, component]);
  const allEntryIds = useMemo(() => playerFlowPreviewEntryIds(project, component), [project, component]);
  const [hovered, setHovered] = useState<string>(), [pressed, setPressed] = useState<string>();
  const [dragged, setDragged] = useState<FlowDragPosition>();
  const dragging = useRef<FlowNodeDrag | undefined>(undefined);
  const suppressContextMenu = useRef(false);
  const [zoomState, setZoomState] = useState<{ viewId?: string; value: number }>({ value: 1 }), [scroll, setScroll] = useState({ x: 0, y: 0 });
  const zoom = zoomState.viewId === groupId ? zoomState.value : (editable ? edit.viewports?.get(`flow:${groupId ?? ''}`)?.zoom : undefined) ?? 1;
  const setZoom = (next: number | ((value: number) => number)) => {
    const value = typeof next === 'function' ? next(zoom) : next;
    setZoomState({ viewId: groupId, value });
    if (editable) edit.viewports?.set(`flow:${groupId ?? ''}`, { x: scroll.x, y: scroll.y, zoom: value });
  };
  const graphScale = scale * zoom, nodeFrame = JSON.stringify([component.id, geometry?.renderMatrix ?? uiIdentity, graphScale, groupId]);
  const baseGraph = useMemo(() => storyFlowLayout(themedProject, component, groupId, flowView), [themedProject, component, groupId, flowView]);
  const list = component.list, custom = list?.flowScrollbar, showControls = list?.flowShowControls ?? true, showVertical = list?.flowShowVerticalScrollbar ?? true;
  const scrollRef = useRef<HTMLDivElement>(null), pan = useRef<FlowPan | undefined>(undefined);
  const { view, side, contentWidth, contentHeight, scrollbar: horizontal } = storyFlowBrowseLayout(themedProject, component);
  const group = groupId && flowView.kind !== 'root' ? flowView : undefined;
  const breadcrumbHeight = group ? Math.min(44, Math.max(32, Math.floor(view.height * .1))) : 0;
  const canvas = { x: side.x, y: side.y + breadcrumbHeight, width: contentWidth, height: Math.max(1, contentHeight - breadcrumbHeight) };
  // Pointer movement changes geometry only. Story routes and group projection
  // stay cached, and a stale gesture cannot paint into another map or group.
  const activePosition = dragged?.graph === baseGraph && dragged.frame === nodeFrame && dragged.groupId === groupId ? dragged : undefined;
  const graph = useMemo(() => activePosition ? moveStoryFlowLayout(baseGraph, component, activePosition.id, activePosition) : baseGraph, [baseGraph, component, activePosition]);
  const xRange = Math.max(0, graph.width * zoom - canvas.width), yRange = Math.max(0, graph.height * zoom - canvas.height);
  const panFrame = JSON.stringify([component.id, geometry?.renderMatrix ?? uiIdentity, geometry?.width, geometry?.height, geometry?.clipPolygons ?? [], geometry?.visiblePolygon ?? [], geometry?.clippedOut, scale, zoom, groupId, canvas, graph.width, graph.height, xRange, yRange]);
  const thickness = list?.flowLineWidth ?? storyFlowDefaults.flowLineWidth, alongY = list?.flowDirection === 'vertical';
  const previewSession: Parameters<typeof flowPreviewNodes>[3] = editable
    ? { ...edit, view: flowView, ...(customMode || hasCalls ? { entryIds: edit.entryIds ?? allEntryIds } : {}) }
    : customMode || hasCalls ? { view: flowView, preview: { mode: state === 'disabled' ? 'partial' : state === 'selected' ? 'current' : 'all' }, entryIds: allEntryIds } : undefined;
  const entryId = customMode || hasCalls ? project.entryId : graph.locations[project.entryId] ?? project.entryId;
  const { progress, visuals } = flowPreviewNodes(graph.nodes, entryId, list, previewSession, state, { hoveredId: hovered, pressedId: pressed });
  const progressEntryIds = [...new Set(flowView.progressIds ?? graph.nodes.flatMap(node => node.callId ? [] : node.memberIds ?? [node.id]))];
  const positions = playerFlowPositions(component, groupId);
  const locked = (id: string) => !!list?.lockUnread && !progress.reached.has(id);
  const lockedLine = list?.flowLockedLine ?? 'show';
  const edgeLocked = (edge: FlowEdge) => locked(edge.from) || locked(edge.to) || !flowEdgeUnlocked(edge, id => !locked(id));
  const nodes = graph.nodes.filter(node => !(list?.flowLockedNode === 'hide' && locked(node.id)) || visuals.get(node.id)!.forced);
  const shownNodeIds = new Set(nodes.map(node => node.id));
  const edges = graph.edges.filter(edge => shownNodeIds.has(edge.from) && shownNodeIds.has(edge.to)
    && !(list?.flowLockedNode === 'hide' && edgeLocked(edge)) && !(lockedLine === 'hide' && edgeLocked(edge)));
  const selectedEdge = editable && edit.inspector?.kind === 'edge' ? edit.inspector : undefined;
  const selectEdge = (edge: FlowEdge) => edit?.inspect?.({ kind: 'edge', from: edge.from, to: edge.to });
  const movable = editable && edit.movable && !component.editor?.locked;
  const cancelNode = useCallback(() => {
    const active = dragging.current;
    dragging.current = undefined;
    if (active?.target.hasPointerCapture(active.pointerId)) active.target.releasePointerCapture(active.pointerId);
    setDragged(undefined); setPressed(undefined);
  }, []);
  const cancelPan = useCallback(() => {
    const active = pan.current;
    pan.current = undefined;
    if (active?.target.hasPointerCapture(active.pointerId)) active.target.releasePointerCapture(active.pointerId);
  }, []);
  const validDrag = (active: FlowNodeDrag) => editable && active.graph === baseGraph && active.frame === nodeFrame && active.groupId === groupId && active.target.isConnected;
  const validPan = (active: FlowPan) => active.graph === baseGraph && active.frame === panFrame && active.target.isConnected;
  const updatePan = (event: PointerEvent<HTMLDivElement>, final = false) => {
    const active = pan.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (!validPan(active)) { cancelPan(); return; }
    if (!final && (!(event.buttons & 4) || event.buttons & ~4)) {
      if (event.buttons & 2) suppressContextMenu.current = true;
      cancelPan(); return;
    }
    const local = uiScreenToLocalDelta(geometry, { x: event.clientX - active.startX, y: event.clientY - active.startY });
    if (!local) { cancelPan(); return; }
    active.target.scrollLeft = active.left - local.x;
    active.target.scrollTop = active.top - local.y;
  };
  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    const active = pan.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (event.type === 'pointerup' && event.button === 1) updatePan(event, true);
    cancelPan();
  };
  const beginPan = (event: PointerEvent<HTMLDivElement>) => {
    if (pan.current || dragging.current) {
      if (event.button === 2) suppressContextMenu.current = true;
      event.preventDefault(); event.stopPropagation(); cancelPan(); cancelNode(); return;
    }
    if (event.button !== 1 || !event.isPrimary || event.defaultPrevented || !uiScreenToLocalDelta(geometry, { x: 0, y: 0 })) return;
    event.preventDefault(); event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    pan.current = { pointerId: event.pointerId, target, graph: baseGraph, frame: panFrame, startX: event.clientX, startY: event.clientY, left: target.scrollLeft, top: target.scrollTop };
  };
  const beginNode = (event: PointerEvent<HTMLDivElement>, node: FlowBox) => {
    if (!editable || event.button !== 0 || !event.isPrimary || event.defaultPrevented || dragging.current || pan.current || !uiScreenToLocalDelta(geometry, { x: 0, y: 0 }, graphScale)) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = { id: node.id, groupId, graph: baseGraph, frame: nodeFrame, startX: event.clientX, startY: event.clientY, x: node.x, y: node.y, moved: false, pointerId: event.pointerId, target: event.currentTarget };
    setPressed(node.id);
  };
  const moveNode = (event: PointerEvent<HTMLDivElement>) => {
    const active = dragging.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (!validDrag(active)) { cancelNode(); return; }
    if (event.buttons & ~1) {
      if (event.buttons & 2) suppressContextMenu.current = true;
      cancelNode(); return;
    }
    if (!movable) return;
    const delta = { x: event.clientX - active.startX, y: event.clientY - active.startY };
    if (!active.moved && Math.abs(delta.x) + Math.abs(delta.y) < 4) return;
    const local = uiScreenToLocalDelta(geometry, delta, graphScale);
    if (!local) { cancelNode(); return; }
    active.moved = true;
    const others = baseGraph.nodes.filter(node => node.id !== active.id);
    active.latest = event.altKey ? { x: Math.max(0, active.x + local.x), y: Math.max(0, active.y + local.y) } : snapFlowPosition(active.x + local.x, active.y + local.y, others);
    setDragged({ id: active.id, groupId: active.groupId, graph: active.graph, frame: active.frame, ...active.latest });
  };
  const endNode = (event: PointerEvent<HTMLDivElement>) => {
    const active = dragging.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const released = event.type === 'pointerup' && validDrag(active);
    if (released) moveNode(event); // Include a final/coalesced release position.
    // The final update can itself reject a changed frame or secondary button.
    // Cancellation must not reopen the node inspector when the pointer lifts.
    const accepted = released && dragging.current === active;
    const position = accepted && movable ? active.latest : undefined;
    cancelNode();
    if (accepted) {
      edit?.select(active.id);
      if (position) edit?.move(component.id, active.id, position);
    }
  };
  const scaled = (rect: Rect) => rectStyle({ x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, height: rect.height * scale });
  const syncScroll = (el: HTMLDivElement) => {
    const x = el.scrollLeft / scale, y = el.scrollTop / scale;
    setScroll(previous => previous.x === x && previous.y === y ? previous : { x, y });
    if (editable) edit.viewports?.set(`flow:${groupId ?? ''}`, { x, y, zoom });
  };
  const change = (x: number, y = scroll.y) => {
    const el = scrollRef.current;
    if (el) {
      el.scrollLeft = clamp(x, xRange) * scale; el.scrollTop = clamp(y, yRange) * scale;
      // Consecutive keyboard events can arrive before the browser's scroll event.
      syncScroll(el);
    }
  };
  const entryName = (id: string) => graph.nodes.find(node => node.id === id)?.name ?? allEntries.find(node => node.id === id)?.name ?? project.nodes.find(node => node.id === id)?.name ?? id;
  const edgeDescription = (edge: FlowEdge) => {
    const endpoints = `${entryName(edge.from)} 到 ${entryName(edge.to)}`;
    const paths = edge.paths?.map(path => path.nodeIds.length >= 2 ? `${entryName(path.nodeIds[0])} 到 ${entryName(path.nodeIds.at(-1)!)}` : '').filter(Boolean);
    const distinctPaths = [...new Set(paths ?? [])];
    const routes = distinctPaths.length ? `。来源路径：${distinctPaths.slice(0, 3).join('；')}${distinctPaths.length > 3 ? `；另有 ${distinctPaths.length - 3} 条` : ''}` : '';
    return `${endpoints}${edge.label ? `，${edge.label}` : ''}${routes}`;
  };
  useLayoutEffect(() => {
    cancelNode();
    cancelPan();
    setHovered(undefined);
  }, [baseGraph, nodeFrame, groupId, editable, movable, cancelNode, cancelPan]);
  useLayoutEffect(() => { cancelPan(); }, [panFrame, cancelPan]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (dragging.current || pan.current)) { event.preventDefault(); event.stopImmediatePropagation(); cancelNode(); cancelPan(); }
      else if ((event.ctrlKey || event.metaKey) && ['s', 'z', 'y'].includes(event.key.toLowerCase())) { cancelNode(); cancelPan(); }
    };
    const freshPointer = (event: globalThis.PointerEvent) => {
      const secondary = pan.current?.pointerId !== undefined && pan.current.pointerId !== event.pointerId
        || dragging.current?.pointerId !== undefined && dragging.current.pointerId !== event.pointerId;
      if (secondary) {
        event.preventDefault(); event.stopImmediatePropagation(); cancelNode(); cancelPan();
        return;
      }
      suppressContextMenu.current = false;
    };
    // A second mouse button while the first is held does not emit pointerdown.
    const pointer = (event: MouseEvent) => {
      if (dragging.current && event.button !== 0) {
        if (event.button === 2) suppressContextMenu.current = true;
        event.preventDefault(); cancelNode();
      }
      if (pan.current && event.button !== 1) {
        if (event.button === 2) suppressContextMenu.current = true;
        event.preventDefault(); cancelPan();
      }
    };
    const context = (event: MouseEvent) => {
      if (dragging.current || pan.current || suppressContextMenu.current) {
        suppressContextMenu.current = false;
        event.preventDefault(); event.stopImmediatePropagation(); cancelNode(); cancelPan();
      }
    };
    const visibility = () => { if (document.hidden) { cancelNode(); cancelPan(); } };
    const blur = () => { cancelNode(); cancelPan(); };
    window.addEventListener('keydown', key, true); window.addEventListener('pointerdown', freshPointer, true); window.addEventListener('mousedown', pointer, true); window.addEventListener('blur', blur);
    window.addEventListener('contextmenu', context, true);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', freshPointer, true); window.removeEventListener('mousedown', pointer, true); window.removeEventListener('blur', blur);
      window.removeEventListener('contextmenu', context, true);
      document.removeEventListener('visibilitychange', visibility); cancelNode(); cancelPan();
    };
  }, [cancelNode, cancelPan]);
  useLayoutEffect(() => {
    const saved = editable ? edit.viewports?.get(`flow:${groupId ?? ''}`) : undefined;
    setZoomState({ viewId: groupId, value: saved?.zoom ?? 1 });
    const x = saved?.x ?? 0, y = saved?.y ?? 0;
    scrollRef.current?.scrollTo({ left: x * scale, top: y * scale });
    setScroll({ x, y });
  }, [groupId]);
  useLayoutEffect(() => {
    if (!editable || !edit.locate) return;
    const node = graph.nodes.find(item => item.id === edit.locate?.nodeId);
    if (node) change(node.x * zoom - canvas.width / 3, node.y * zoom - canvas.height / 3);
  }, [editable, edit?.locate?.request, canvas.width, canvas.height]);
  useLayoutEffect(() => {
    const el = scrollRef.current!;
    // The native flow map maps an ordinary wheel to horizontal navigation.
    const wheel = (event: WheelEvent) => {
      if (!(alongY ? yRange : xRange) || event.ctrlKey) return;
      event.preventDefault(); event.stopPropagation();
      const step = (event.deltaX || event.deltaY) * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientWidth : 1);
      if (alongY) el.scrollTop += step; else el.scrollLeft += step;
    };
    el.addEventListener('wheel', wheel, { passive: false });
    syncScroll(el);
    return () => el.removeEventListener('wheel', wheel);
  }, [scale, zoom, xRange, yRange, canvas.width, canvas.height, alongY]);
  return <div data-flow-group-view={groupId} data-flow-view-id={flowView.id ?? 'root'} data-flow-view-kind={flowView.kind} style={{ width: '100%', height: '100%', position: 'relative' }} onKeyDown={event => { if (group && event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); if (edit?.backView) edit.backView(); else edit?.enterGroup?.(undefined); } }}>
    {group && <div data-flow-breadcrumb className="ui-flow-breadcrumb" style={{ ...scaled({ x: side.x, y: side.y, width: contentWidth, height: breadcrumbHeight }), fontSize: 12 * scale }} onPointerDown={event => event.stopPropagation()}>
      <button type="button" aria-label={hasCalls ? '返回上一级剧情图' : '返回剧情图'} onClick={() => edit?.backView ? edit.backView() : edit?.enterGroup?.(undefined)}>返回</button>
      <span>剧情图</span><span aria-hidden="true">/</span><strong title={edit?.browseNames?.join(' / ')}>{edit?.browseNames?.join(' / ') || group.name}</strong>
    </div>}
    <div ref={scrollRef} className="ui-story-flow-preview" tabIndex={group ? 0 : undefined} title={alongY ? "滚轮纵向滚动，按住鼠标中键拖动查看" : "滚轮横向滚动，按住鼠标中键拖动查看"} onScroll={event => syncScroll(event.currentTarget)} style={{ ...scaled(canvas), overflow: 'auto', scrollbarWidth: 'none' }}
      onPointerDown={event => { if (event.button === 0 && event.isPrimary && editable && !pan.current && !dragging.current) edit.select(undefined); beginPan(event); }}
      onPointerMove={event => updatePan(event)} onPointerUp={endPan}
      onPointerCancel={event => { if (pan.current?.pointerId === event.pointerId) cancelPan(); }} onLostPointerCapture={event => { if (pan.current?.pointerId === event.pointerId) cancelPan(); }}>
      <div style={{ position: 'relative', width: graph.width * graphScale, height: graph.height * graphScale }}>
        <svg width={graph.width * graphScale} height={graph.height * graphScale} viewBox={`0 0 ${graph.width} ${graph.height}`} style={{ position: 'absolute', inset: 0 }} aria-label="剧情分支连线">
          {edges.map(edge => {
            const key = `${edge.from}:${edge.to}`, selected = selectedEdge?.from === edge.from && selectedEdge.to === edge.to;
            return <g key={key} data-flow-edge={key} data-flow-edge-from={edge.from} data-flow-edge-to={edge.to} data-flow-edge-path-count={edge.paths?.length ?? 0} data-flow-edge-paths={edge.paths ? JSON.stringify(edge.paths) : undefined} data-flow-edge-via={edge.via?.join(' ')} data-flow-edge-selected={selected ? '' : undefined} opacity={lockedLine === 'dim' && edgeLocked(edge) ? .35 : undefined}>
              <title>{edgeDescription(edge)}</title>
              <FlowConnector edge={edge} project={themedProject} list={list} thickness={thickness} assetUrl={assetUrl} />
              {selected && <polyline points={edge.points.map(point => point.join(',')).join(' ')} fill="none" stroke="#71bbdf" strokeWidth={Math.max(6, thickness + 3)} strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />}
              {editable && <polyline className="ui-flow-edge-hit" data-flow-edge-hit points={edge.points.map(point => point.join(',')).join(' ')} fill="none" stroke="transparent" strokeWidth={Math.max(14 / graphScale, thickness + 10)} strokeLinejoin="round" strokeLinecap="round" pointerEvents="stroke" role="button" tabIndex={0} aria-pressed={selected} aria-label={`检查连线：${edgeDescription(edge)}`}
                onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); selectEdge(edge); }}
                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); selectEdge(edge); } }} />}
            </g>;
          })}
        </svg>
        {nodes.map(node => {
          const look = flowNodeAppearance(themedProject, component, node);
          const { state: nodeState, locked: isLocked, current, affected, forced, suffix } = visuals.get(node.id)!;
          const isGroup = !!node.groupId;
          const isCall = !!node.callId, enterable = isGroup || isCall;
          const selected = editable && (edit.nodeId === node.id || edit.inspector?.kind === 'group' && edit.inspector.groupId === node.groupId || edit.inspector?.kind === 'call' && edit.inspector.callId === node.callId);
          const groupMembers = node.memberIds ?? [];
          const nodeId = node.nodeId ?? node.id;
          const manual = positions[node.id];
          return <div key={node.id} data-flow-node={node.id} data-flow-call={node.callId} data-flow-call-target={node.targetId} data-flow-call-view={node.viewId} data-flow-group={isGroup ? node.groupId : undefined} data-flow-group-members={isGroup ? groupMembers.join(' ') : undefined} data-flow-group-member-of={groupId && !isGroup ? groupId : undefined} data-flow-entry-id={!isGroup ? nodeId : undefined} data-flow-real-node-id={!isGroup ? nodeId : undefined} data-flow-selected={selected ? '' : undefined} data-flow-state={nodeState} data-flow-affected={affected ? '' : undefined} data-flow-forced-state={forced ? nodeState : undefined} data-flow-manual={manual ? '' : undefined}
            role={editable ? 'button' : undefined} tabIndex={editable ? 0 : undefined} aria-label={editable ? isCall ? `子剧情：${node.name}` : isGroup ? `剧情分组：${node.name}，包含 ${groupMembers.length} 个节点` : `编辑节点：${node.name}` : undefined} aria-pressed={editable ? selected : undefined}
            title={editable ? isCall ? '单击查看说明；双击或按 Enter 查看子剧情' : isGroup ? '单击查看分组属性；双击或按 Enter 进入' : movable ? '点击编辑文字与样式；拖动调整位置，按住 Alt 不吸附' : '点击编辑文字与样式；当前控件已锁定位置' : undefined}
            onPointerDown={event => beginNode(event, node)} onPointerMove={moveNode} onPointerUp={endNode} onPointerCancel={endNode} onLostPointerCapture={endNode}
            onPointerEnter={() => setHovered(node.id)} onPointerLeave={() => setHovered(undefined)}
            onClick={event => { if (editable && event.detail === 0) edit.select(node.id); }}
            onDoubleClick={event => { if (editable && enterable) { event.preventDefault(); event.stopPropagation(); if (edit.enterView && node.viewId) edit.enterView(node.viewId, node.callId); else if (node.groupId) edit.enterGroup?.(node.groupId); } }}
            onKeyDown={event => { if (editable && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (edit.enterView && node.viewId) edit.enterView(node.viewId, node.callId); else if (isGroup && node.groupId) edit.enterGroup?.(node.groupId); else edit.select(node.id); } else if (editable && event.key === ' ') { event.preventDefault(); event.stopPropagation(); edit.select(node.id); } }}
            style={{ ...rectStyle({ x: node.x * graphScale, y: node.y * graphScale, width: node.width * graphScale, height: node.height * graphScale }), ...flowNodePreviewStyle(themedProject, look, graphScale, nodeState), outline: selected ? '2px solid #71bbdf' : undefined, outlineOffset: selected ? 3 : undefined, ...(editable ? { cursor: movable ? 'move' : 'pointer', touchAction: 'none' } : {}) }}>
            <UiFlowNodeFace node={node} look={look} component={component} width={node.width} height={node.height} scale={graphScale} state={nodeState} locked={isLocked} current={current} suffix={suffix} assetUrl={assetUrl} />
            {isCall && <span className="ui-flow-call-open" aria-hidden="true" style={{ fontSize: 16 * graphScale }}>›</span>}
            {affected && <UiFlowAffectedOutline />}
            {editable && edit.region === 'marker' && current && list?.flowCurrentMarker && <span data-flow-region="marker" className="flow-region-guide" style={{ ...rectStyle({ x: list.flowCurrentMarker.rect.x * node.width * graphScale, y: list.flowCurrentMarker.rect.y * node.height * graphScale, width: list.flowCurrentMarker.rect.width * node.width * graphScale, height: list.flowCurrentMarker.rect.height * node.height * graphScale }) }}>当前位置标记</span>}
          </div>;
        })}
      </div>
    </div>
    {editable && edit.region === 'viewport' && <span data-flow-region="viewport" className="flow-region-guide" style={scaled(canvas)}>剧情显示区域</span>}
    {editable && edit.region === 'scrollbar' && <span data-flow-region="scrollbar" className="flow-region-guide" style={scaled(horizontal)}>主滚动条</span>}
    {/* The authored rail follows the map's own direction. */}
    <FlowScrollbar rect={horizontal} coordinateRect={horizontal} geometry={geometry} ownerId={component.id} scope={baseGraph} page={alongY ? canvas.height : canvas.width} range={alongY ? yRange : xRange} value={alongY ? scroll.y : scroll.x} onChange={value => alongY ? change(scroll.x, value) : change(value)} skin={custom?.thumb} trackId={custom?.trackId} trackHeight={custom?.trackHeight ?? (custom ? 5 : 16)} thumbHeight={custom?.thumbHeight ?? (custom ? 31 : 16)} scale={scale} state={state} assetUrl={assetUrl} />
    {showVertical && <FlowScrollbar vertical rect={{ x: side.x + contentWidth + 8, y: canvas.y, width: 16, height: canvas.height }} coordinateRect={{ x: side.x + contentWidth + 8, y: canvas.y, width: 16, height: canvas.height }} geometry={geometry} ownerId={component.id} scope={baseGraph} page={canvas.height} range={yRange} value={scroll.y} onChange={y => change(scroll.x, y)} scale={scale} state={state} assetUrl={assetUrl} />}
    {showControls && <div data-flow-controls onPointerDown={event => event.stopPropagation()} style={{ ...scaled({ x: view.x + 24, y: view.y + side.height, width: Math.max(1, view.width - 24), height: 38 }), display: 'flex', alignItems: 'center', gap: 18 * scale, fontSize: Math.min(component.style?.fontSize ?? 24, 22) * scale, color: '#f4f0e6' }}>
      {list?.showProgress && <span>已读 {progressEntryIds.filter(id => progress.reached.has(id)).length} / {progressEntryIds.length}</span>}
      <button type="button" aria-label="缩小流程图" onClick={() => setZoom(value => Math.max(.5, Math.round((value - .1) * 10) / 10))}>−</button>
      <span>{Math.round(zoom * 100)}%</span>
      <button type="button" aria-label="放大流程图" onClick={() => setZoom(value => Math.min(1.5, Math.round((value + .1) * 10) / 10))}>+</button>
      <button type="button" disabled={!graph.nodes.length} onClick={() => { const node = graph.nodes.find(item => visuals.get(item.id)?.current) ?? graph.nodes[0]; if (node) change(node.x * zoom - canvas.width / 3, node.y * zoom - canvas.height / 3); }}>定位当前位置</button>
    </div>}
  </div>;
}
function FlowConnector({ edge, project, list, thickness, assetUrl }: { edge: FlowEdge; project: Project; list: UiComponent['list']; thickness: number; assetUrl: AssetUrl }) {
  const id = useId().replaceAll(':', '_');
  const horizontal = project.assets.find(asset => asset.id === list?.flowLineAssetId), vertical = project.assets.find(asset => asset.id === list?.flowVerticalLineAssetId);
  if (!horizontal && !vertical) return <polyline data-flow-path points={edge.points.map(point => point.join(',')).join(' ')} fill="none" stroke={list?.flowLineColor ?? storyFlowDefaults.flowLineColor} strokeWidth={thickness} strokeLinejoin="round" strokeLinecap="round" />;
  return flowEdgeSegments(edge.points).map((segment, index) => {
    const useVertical = !!vertical && (segment.vertical || !horizontal);
    const asset = (useVertical ? vertical : horizontal)!;
    // Scale only across the strip. Repeating along its length keeps dots and dashes
    // the same size on short elbows, long lines and the small pieces of a curve.
    const period = thickness * (useVertical ? (asset.height ?? 16) / (asset.width ?? 16) : (asset.width ?? 16) / (asset.height ?? 16));
    const pattern = `${id}_${index}`, overlap = Math.min(.5, thickness / 4);
    return <g key={index} data-flow-segment data-flow-distance={segment.distance} transform={`translate(${segment.a[0]} ${segment.a[1]}) rotate(${segment.angle})`}>
      <defs><pattern id={pattern} patternUnits="userSpaceOnUse" x={-segment.distance} y={-thickness / 2} width={period} height={thickness} viewBox={`0 0 ${period} ${thickness}`}>
        <image href={assetUrl(asset.id)} width={useVertical ? thickness : period} height={useVertical ? period : thickness} preserveAspectRatio="none" transform={useVertical ? `translate(0 ${thickness}) rotate(-90)` : undefined} />
      </pattern></defs>
      <rect x={-overlap / 2} y={-thickness / 2} width={segment.length + overlap} height={thickness} fill={`url(#${pattern})`} />
    </g>;
  });
}

export function FlowScrollbar({ rect, coordinateRect = rect, geometry, ownerId, scope, page, range, value, onChange, vertical = false, skin, trackId, trackHeight = 16, thumbHeight = 16, scale, state, assetUrl, trackWidth, label, colors, previewState }: { rect: Rect; coordinateRect?: Rect; geometry?: UiLayoutGeometry; ownerId?: string; scope?: object; page: number; range: number; value: number; onChange: (value: number) => void; vertical?: boolean; skin?: UiComponent['skin']; trackId?: string; trackHeight?: number; thumbHeight?: number; scale: number; state: UiButtonState; assetUrl: AssetUrl; trackWidth?: number; label?: string; colors?: Partial<Record<'track' | 'idle' | 'hover' | 'pressed' | 'disabled', string>>; previewState?: UiButtonState }) {
  const drag = useRef<{ pointerId: number; offset: number; frame: string; scope?: object; target: HTMLDivElement } | undefined>(undefined);
  const suppressContextMenu = useRef(false), [hover, setHover] = useState(false), [held, setHeld] = useState(false);
  const dimension = vertical ? rect.height : rect.width;
  const minThumb = skin?.fit === 'nineSlice' ? Math.ceil((vertical ? (skin.borders?.top ?? 12) + (skin.borders?.bottom ?? 12) : (skin.borders?.left ?? 12) + (skin.borders?.right ?? 12)) + 1) : 16;
  const thumbSize = Math.min(dimension, Math.max(minThumb, dimension * page / Math.max(1, page + range))), travel = dimension - thumbSize;
  const position = range ? clamp(value / range) * travel : 0;
  const frame = JSON.stringify([ownerId, geometry?.renderMatrix ?? uiIdentity, geometry?.width, geometry?.height, geometry?.clipPolygons ?? [], geometry?.visiblePolygon ?? [], geometry?.clippedOut, coordinateRect, scale, page, range, vertical, dimension, thumbSize, travel, trackHeight, thumbHeight, trackWidth, skin?.fit, skin?.borders]);
  const actualState = previewState ?? (range <= 0 || state === 'disabled' ? 'disabled' : state !== 'idle' ? state : held ? 'pressed' : hover ? 'hover' : 'idle');
  const cancel = useCallback(() => {
    const active = drag.current;
    drag.current = undefined;
    if (active?.target.hasPointerCapture(active.pointerId)) active.target.releasePointerCapture(active.pointerId);
    setHeld(false);
  }, []);
  const pointerPosition = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = uiScreenToLocalPoint(geometry, { x: event.clientX, y: event.clientY }, { x: bounds.left, y: bounds.top }, coordinateRect, scale);
    return point ? (vertical ? point.y - coordinateRect.y : point.x - coordinateRect.x) : undefined;
  };
  const update = (event: PointerEvent<HTMLDivElement>, active: NonNullable<typeof drag.current>, point = pointerPosition(event)) => {
    if (drag.current !== active || active.frame !== frame || active.scope !== scope || !active.target.isConnected || point === undefined) { cancel(); return; }
    if (travel > 0) onChange(clamp((point - active.offset) / travel) * range);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (event.buttons & ~1 || !(event.buttons & 1)) { cancel(); return; }
    update(event, active);
  };
  const release = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (event.type === 'pointerup' && event.button === 0) update(event, active);
    cancel();
  };
  useLayoutEffect(() => { cancel(); }, [frame, scope, cancel]);
  useEffect(() => {
    const otherPointer = (event: globalThis.PointerEvent) => {
      const active = drag.current;
      if (active && active.pointerId !== event.pointerId) {
        event.preventDefault(); event.stopImmediatePropagation(); cancel();
        return;
      }
      suppressContextMenu.current = false;
    };
    const mouseDown = (event: MouseEvent) => {
      if (drag.current && event.button !== 0) {
        if (event.button === 2) suppressContextMenu.current = true;
        event.preventDefault(); cancel();
      }
    };
    const context = (event: MouseEvent) => {
      if (drag.current || suppressContextMenu.current) {
        suppressContextMenu.current = false; event.preventDefault(); event.stopImmediatePropagation(); cancel();
      }
    };
    const key = (event: KeyboardEvent) => {
      if (drag.current && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); }
    };
    const blur = () => cancel(), visibility = () => { if (document.hidden) cancel(); };
    window.addEventListener('pointerdown', otherPointer, true); window.addEventListener('mousedown', mouseDown, true);
    window.addEventListener('contextmenu', context, true); window.addEventListener('keydown', key, true); window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pointerdown', otherPointer, true); window.removeEventListener('mousedown', mouseDown, true);
      window.removeEventListener('contextmenu', context, true); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility); cancel();
    };
  }, [cancel]);
  return <div data-flow-scrollbar={vertical ? 'vertical' : 'horizontal'} data-scroll-state={actualState} role="scrollbar" aria-label={label ?? (vertical ? '流程图竖向滚动条' : '流程图横向滚动条')} aria-orientation={vertical ? 'vertical' : 'horizontal'} aria-valuemin={0} aria-valuemax={Math.round(range)} aria-valuenow={Math.round(clamp(value, range))} aria-disabled={range <= 0} tabIndex={range > 0 ? 0 : -1} style={{ ...rectStyle({ x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, height: rect.height * scale }), cursor: range > 0 ? 'pointer' : 'default', touchAction: 'none', textShadow: 'none' }}
    onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
    onPointerDown={event => {
      event.stopPropagation();
      if (drag.current) { event.preventDefault(); return; }
      if (event.button !== 0 || !event.isPrimary || range <= 0) return;
      const point = pointerPosition(event);
      if (point === undefined) return;
      event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
      const active = { pointerId: event.pointerId, offset: point >= position && point <= position + thumbSize ? point - position : thumbSize / 2, frame, scope, target: event.currentTarget };
      drag.current = active;
      active.target.setPointerCapture(active.pointerId); setHeld(true); update(event, active, point);
    }}
    onPointerMove={move} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
    onKeyDown={event => { const next = event.key === 'Home' ? 0 : event.key === 'End' ? range : event.key === 'PageDown' ? value + page : event.key === 'PageUp' ? value - page : event.key === (vertical ? 'ArrowDown' : 'ArrowRight') ? value + 40 : event.key === (vertical ? 'ArrowUp' : 'ArrowLeft') ? value - 40 : undefined; if (next !== undefined) { event.preventDefault(); event.stopPropagation(); onChange(clamp(next, range)); } }}>
    <span style={{ position: 'absolute', top: 0, ...(vertical ? { width: trackWidth ? trackWidth * scale : '100%', height: '100%', left: '50%', transform: 'translateX(-50%)' } : { left: 0, width: '100%', height: Math.min(rect.height, trackHeight) * scale, top: '50%', transform: 'translateY(-50%)' }), background: trackId ? undefined : colors?.track ?? '#282e2c', pointerEvents: 'none' }}>{trackId && <img alt="" draggable={false} src={assetUrl(trackId)} style={{ display: 'block', width: '100%', height: '100%' }} />}</span>
    <span data-flow-scrollbar-thumb style={{ position: 'absolute', ...(vertical ? { left: 0, top: position * scale, height: thumbSize * scale, width: '100%' } : { left: position * scale, width: thumbSize * scale, height: Math.min(rect.height, thumbHeight) * scale, top: '50%', transform: 'translateY(-50%)' }), pointerEvents: 'none', background: uiSkinAsset(skin, actualState) ? undefined : actualState === 'disabled' ? colors?.disabled ?? '#626b68' : actualState === 'hover' ? colors?.hover ?? '#fff5de' : actualState === 'pressed' ? colors?.pressed ?? '#c9c0aa' : colors?.idle ?? '#d4cbb5' }}><UiSkinImage skin={skin} state={actualState} assetUrl={assetUrl} scale={scale} /></span>
  </div>;
}
