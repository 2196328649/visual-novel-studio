import { projectGraphs } from '../core/project-resources';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, ChevronRight, Copy, GripVertical, Layers, Plus, Trash2 } from 'lucide-react';
import type { BlueprintGraph, Project, VisualObject } from '../core/model';
import type { BlueprintSelection } from '../core/ai-selection';
import { addCompositionChild, compositionFieldBinding, compositionTimeline, duplicateCompositionChild, editCompositionEffects, patchCompositionObject, removeCompositionChild, reorderCompositionChild, setCompositionCurve, setCompositionField, setCompositionPose, setCompositionTiming, toggleCompositionKeyframe, type CompositionObjectView } from '../core/composition-timeline';
import { editTimelineProject } from '../core/timeline-edit-validation';
import { createCharacterVisualObject, createVisualObject, visualCurveFields, type VisualCurveProperty } from '../core/visual-object';
import type { Commit } from './editor';
import type { AssetUrl } from './StageEditor';
import { CompositionEditingContext } from './CompositionEditingContext';
import { NumberInput } from './NumberInput';
import { PerformanceDock } from './PerformanceDock';
import { PerformanceLibrary } from './PerformanceLibrary';
import { PropertyFrameTimeline } from './PropertyFrameTimeline';
import { VisualClipInspector } from './VisualClipInspector';
import { ClipMenuItems, TimelineCreateMenu } from './TimelineCreateMenu';
import { TrackPreviewControls } from './TrackPreviewControls';
import { createPortal } from 'react-dom';
import { addCompositionGlyphParticles, detachCompositionResource, exposeCompositionProperty, groupCompositionSelection, removeCompositionParameter, renameCompositionParameter, saveCompositionResource } from '../core/composition-authoring';
import { instantiateVisualComposition, materializeVisualCompositions } from '../core/visual-composition';
import { exposePerformanceInputs, performanceInputs } from '../core/blueprint-authoring';
import { makeId } from '../core/model';
import { readVideoDuration } from './audio-metadata';
import './composition-workspace.css';

const labelWidth = 200;
const contentNames = { image: '图片', video: '视频', text: '文字', solid: '色块', group: '组合', particles: '粒子' };
const seconds = (value: number) => Math.round(value * 1000) / 1000;
type Timing = { startAt: number; duration: number };
type Gesture = {
  id: string; mode: 'move' | 'start' | 'end'; x: number; scroll: number; zoom: number;
  initial: Timing; current: Timing; project: Project; moved: boolean;
  element: HTMLElement; pointerId: number;
};

export function CompositionWorkspace({ project, graph, nodeId, groupId, initialSelection, commit, assetUrl, time, onSeek, preview, onPreviewProject, onNavigate, onExit, onOpenResource, onNotice, onActiveSelection }: {
  project: Project; graph: BlueprintGraph; nodeId: string; groupId: string; initialSelection?: string;
  commit: Commit; assetUrl: AssetUrl; time: number; onSeek: (time: number) => void; preview?: ReactNode;
  onPreviewProject?: (project?: Project) => void;
  onNavigate: (groupId: string, selectedId?: string) => void; onExit: () => void; onOpenResource: (id: string) => void;
  onNotice: (text: string) => void; onActiveSelection?: (selection?: BlueprintSelection) => void;
}) {
  const [selectedId, setSelectedId] = useState(initialSelection);
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelection ? [initialSelection] : []);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [soloIds, setSoloIds] = useState<string[]>([]);
  const [hideUnrelated, setHideUnrelated] = useState(false);
  const [context, setContext] = useState<{ x: number; y: number; id: string }>();
  const childVisible = (id: string) => !hiddenIds.includes(id) && (!soloIds.length || soloIds.includes(id));
  const [previewDraft, setPreviewDraft] = useState<Project>();
  const [zoom, setZoom] = useState(70);
  const [autoFit, setAutoFit] = useState(true);
  const [snapping, setSnapping] = useState(true);
  const [showFrames, setShowFrames] = useState(false);
  const [dropId, setDropId] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const mediaRequest = useRef<AbortController | undefined>(undefined);
  const surface = useRef<HTMLDivElement>(null);
  const inspector = useRef<HTMLElement>(null);
  const gesture = useRef<Gesture | undefined>(undefined);
  const scrub = useRef(false);
  const pointer = useRef({ x: 0, shift: false });
  const extent = useRef(1);
  const read = useMemo(() => {
    try {
      const draft = previewDraft ?? project, target = projectGraphs(draft).find(item => item.id === graph.id)!;
      return { model: compositionTimeline(draft, target, nodeId, groupId) };
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [project, previewDraft, graph.id, nodeId, groupId]);
  const model = read.model;
  const selected = model?.children.find(child => child.object.instanceId === selectedId);
  const target = selected ?? model?.group;
  const groupAt = model?.group.at ?? 0, duration = model?.group.action.duration ?? 0;
  const localTime = Math.max(0, time - groupAt);
  const visibleEnd = Math.max(0, (model?.group.until ?? 0) - groupAt);
  const frameRows = showFrames && target ? (Object.keys(visualCurveFields) as VisualCurveProperty[]).flatMap(key => {
    const frames = target.action.curves?.[key]; return frames?.length ? [{ key, frames }] : [];
  }) : [];
  const requiredEnd = Math.max(1, duration, ...(model?.children ?? []).map(child => child.at - groupAt + child.action.duration), ...frameRows.flatMap(row => row.frames.map(frame => frame.at + (target?.at ?? groupAt) - groupAt))) + .4;
  extent.current = Math.max(extent.current, requiredEnd);

  const run = <T,>(label: string, edit: (draft: Project, target: BlueprintGraph) => T, separate = false): { value: T } | undefined => {
    let result: { value: T } | undefined;
    try { commit(label, draft => { result = { value: editTimelineProject(draft, graph.id, edit) }; }, { separate }); return result; }
    catch (error) { onNotice(error instanceof Error ? error.message : String(error)); return; }
  };
  const cancelDrag = () => {
    const current = gesture.current; gesture.current = undefined;
    setDragging(false); setPreviewDraft(undefined); onPreviewProject?.(undefined);
    if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
  };
  const latest = useRef({ run, cancelDrag, onSeek, project }); latest.current = { run, cancelDrag, onSeek, project };
  useEffect(() => {
    if (gesture.current && gesture.current.project !== project) cancelDrag();
  }, [project]);
  useEffect(() => {
    const cancel = () => latest.current.cancelDrag();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); cancel(); } };
    window.addEventListener('blur', cancel); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('blur', cancel); window.removeEventListener('keydown', key); onPreviewProject?.(undefined); };
  }, [onPreviewProject]);
  useEffect(() => () => mediaRequest.current?.abort(), []);
  useEffect(() => {
    if (model) onActiveSelection?.({ graphId: graph.id, nodeId, objectInstanceId: selected?.object.instanceId ?? groupId });
  }, [graph.id, nodeId, groupId, selected?.object.instanceId, !!model, onActiveSelection]);
  useEffect(() => {
    inspector.current?.scrollTo({ top: 0 });
    const row = Array.from(surface.current?.querySelectorAll<HTMLElement>('.composition-track-row') ?? []).find(row => row.dataset.instanceId === selected?.object.instanceId);
    row?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected?.object.instanceId]);
  useEffect(() => { setSelectedId(initialSelection); setSelectedIds(initialSelection ? [initialSelection] : []); setShowFrames(false); setHiddenIds([]); setSoloIds([]); setContext(undefined); }, [groupId, initialSelection]);
  useEffect(() => {
    if (!context) return;
    const close = (event: Event) => { if (!(event.target as Element).closest('.timeline-context-menu')) setContext(undefined); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setContext(undefined); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); };
  }, [context]);

  const fit = () => {
    const element = surface.current; if (!element) return;
    extent.current = requiredEnd; setZoom(Math.max(.001, Math.min(240, (element.clientWidth - labelWidth - 24) / requiredEnd)));
    element.scrollLeft = 0; setAutoFit(true);
    requestAnimationFrame(() => surface.current?.querySelector('.composition-track-row.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  };
  const fitRef = useRef(fit); fitRef.current = fit;
  useLayoutEffect(() => { fitRef.current(); }, [groupId]);
  useEffect(() => {
    const element = surface.current; if (!element || !autoFit) return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => { if (element.clientWidth !== width) { width = element.clientWidth; fitRef.current(); } });
    observer.observe(element); return () => observer.disconnect();
  }, [autoFit]);
  const changeZoom = (next: number, x?: number) => {
    const element = surface.current; if (!element) return;
    const anchor = x === undefined ? Math.min(element.clientWidth - 20, Math.max(labelWidth + 20, labelWidth + localTime * zoom - element.scrollLeft)) : x - element.getBoundingClientRect().left;
    const at = (element.scrollLeft + anchor - labelWidth) / zoom;
    setZoom(Math.max(.001, Math.min(500, next))); setAutoFit(false);
    requestAnimationFrame(() => { element.scrollLeft = labelWidth + at * Math.max(.001, Math.min(500, next)) - anchor; });
  };
  const zoomRef = useRef(changeZoom); zoomRef.current = changeZoom;
  useEffect(() => {
    const element = surface.current; if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) { event.preventDefault(); zoomRef.current(zoom * Math.exp(-event.deltaY * .002), event.clientX); }
      else if (event.shiftKey) { event.preventDefault(); element.scrollLeft += event.deltaY || event.deltaX; }
    };
    element.addEventListener('wheel', wheel, { passive: false }); return () => element.removeEventListener('wheel', wheel);
  }, [zoom]);
  const atPointer = (x: number) => {
    const element = surface.current; return element ? Math.max(0, (x - element.getBoundingClientRect().left + element.scrollLeft - labelWidth) / zoom) : 0;
  };
  const select = (child: CompositionObjectView, multiple = false) => {
    const id = child.object.instanceId;
    if (multiple) { const next = selectedIds.includes(id) ? selectedIds.filter(item => item !== id) : [...selectedIds, id]; setSelectedIds(next); setSelectedId(next.at(-1)); return; }
    setSelectedId(id); setSelectedIds([id]);
    if (time < child.at || time >= child.until) onSeek(child.at + Math.min(.05, Math.max(0, child.until - child.at) / 2));
  };
  const timing = (id: string, next: Partial<Timing>, separate = false) => run('调整组合片段时间', (draft, graph) => setCompositionTiming(draft, graph, nodeId, id, next), separate);
  const remove = () => {
    const ids = selectedIds.length ? selectedIds : selectedId ? [selectedId] : [];
    if (run('删除组合片段', (draft, graph) => { for (const id of ids) removeCompositionChild(draft, graph, nodeId, groupId, id); }, true)) { setSelectedId(undefined); setSelectedIds([]); }
  };
  const duplicate = () => {
    if (!selected) return;
    const result = run('复制组合片段', (draft, graph) => duplicateCompositionChild(draft, graph, nodeId, groupId, selected.object.instanceId), true);
    if (result) { setSelectedId(result.value); setSelectedIds([result.value]); }
  };
  const makeGroup = () => { const result = run('制作演出组合', (draft, graph) => groupCompositionSelection(draft, graph, nodeId, groupId, selectedIds.length ? selectedIds : selectedId ? [selectedId] : []), true); if (result) { setSelectedId(result.value); setSelectedIds([result.value]); setContext(undefined); } };
  const saveGroup = () => { if (!target) return; const result = run('保存组合资源', (draft, graph) => saveCompositionResource(draft, graph, nodeId, target.object.instanceId), true); if (result) { onNotice('已保存到素材库的“组合”和资源管理器。'); setContext(undefined); } };
  const addResource = (id: string, at = localTime) => {
    const result = run('添加组合资源', (draft, graph) => { const object = instantiateVisualComposition(draft, id, makeId('object')); materializeVisualCompositions(draft, object, [graph.id]); return addCompositionChild(draft, graph, nodeId, groupId, object, at); }, true);
    if (result) { setSelectedId(result.value); setSelectedIds([result.value]); onSeek(groupAt + at + .01); }
  };
  const add = async (content: VisualObject['content'], assetId?: string, at = localTime, characterId?: string) => {
    try {
      let sourceDuration: number | undefined;
      const resolvedAssetId = assetId ?? (content === 'image' ? project.assets.find(asset => asset.kind === 'image')?.id : content === 'video' ? project.assets.find(asset => asset.kind === 'video')?.id : undefined);
      if (content === 'video') {
        const asset = project.assets.find(item => item.id === resolvedAssetId && item.kind === 'video');
        if (!asset) { onNotice('先在素材库导入视频。'); return; }
        mediaRequest.current?.abort(); const controller = new AbortController(); mediaRequest.current = controller;
        sourceDuration = await readVideoDuration(assetUrl(asset.id) ?? '', controller.signal);
      }
      const object = characterId ? createCharacterVisualObject(project, characterId) : createVisualObject(content, resolvedAssetId);
      if (assetId) object.name = project.assets.find(asset => asset.id === assetId)?.name ?? object.name;
      if (sourceDuration !== undefined) { object.sourceDuration = sourceDuration; object.duration = sourceDuration; object.imageFit = 'contain'; }
      const result = run('添加组合片段', (draft, graph) => addCompositionChild(draft, graph, nodeId, groupId, object, seconds(at)), true);
      if (result) { setSelectedId(result.value); setSelectedIds([result.value]); onSeek(groupAt + at + .01); }
    } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) onNotice(error instanceof Error ? error.message : String(error)); }
  };
  const snap = (value: number, id: string, otherEdge?: number) => {
    if (!snapping || pointer.current.shift || !model) return seconds(value);
    const points = [0, visibleEnd, duration, localTime, ...model.children.filter(child => child.object.instanceId !== id).flatMap(child => [child.at - groupAt, child.at - groupAt + child.action.duration])];
    let correction = 0, distance = 8 / zoom;
    for (const point of points) for (const edge of otherEdge === undefined ? [value] : [value, otherEdge]) {
      if (Math.abs(point - edge) < distance) { distance = Math.abs(point - edge); correction = point - edge; }
    }
    return seconds(value + correction);
  };
  const updateDrag = (x: number, shift: boolean) => {
    pointer.current = { x, shift };
    const current = gesture.current; if (!current) return;
    const delta = (x - current.x + (surface.current?.scrollLeft ?? 0) - current.scroll) / current.zoom;
    if (!current.moved && Math.abs(delta * current.zoom) < 3) return;
    const initial = current.initial, end = initial.startAt + initial.duration;
    let next: Timing;
    if (current.mode === 'move') next = { startAt: Math.max(0, snap(initial.startAt + delta, current.id, end + delta)), duration: initial.duration };
    else if (current.mode === 'end') next = { startAt: initial.startAt, duration: Math.max(.05, seconds(snap(end + delta, current.id) - initial.startAt)) };
    else { const startAt = Math.max(0, Math.min(end - .05, snap(initial.startAt + delta, current.id))); next = { startAt, duration: seconds(end - startAt) }; }
    current.current = next; current.moved = true; setDragging(true);
    try {
      const draft = structuredClone(current.project), graphDraft = projectGraphs(draft).find(item => item.id === graph.id)!;
      setCompositionTiming(draft, graphDraft, nodeId, current.id, current.mode === 'move' ? { startAt: next.startAt } : next);
      setPreviewDraft(draft); onPreviewProject?.(draft);
    } catch { /* Commit reports a validation failure without publishing the draft. */ }
  };
  const dragRef = useRef(updateDrag); dragRef.current = updateDrag;
  useEffect(() => {
    if (!dragging) return;
    let frame: number;
    const scroll = () => {
      const element = surface.current;
      if (element && gesture.current) {
        const rect = element.getBoundingClientRect(), x = pointer.current.x;
        const delta = x > rect.right - 28 ? Math.min(16, (x - rect.right + 28) / 2) : x < rect.left + labelWidth + 20 ? -Math.min(16, (rect.left + labelWidth + 20 - x) / 2) : 0;
        const previous = element.scrollLeft; element.scrollLeft += delta;
        if (element.scrollLeft !== previous) dragRef.current(x, pointer.current.shift);
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll); return () => cancelAnimationFrame(frame);
  }, [dragging]);
  const begin = (event: PointerEvent<HTMLDivElement>, child: CompositionObjectView) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); if (event.ctrlKey || event.metaKey || event.shiftKey) { select(child, true); return; } select(child);
    event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
    const initial = { startAt: child.at - groupAt, duration: child.action.duration };
    gesture.current = { id: child.object.instanceId, mode: (event.target as HTMLElement).dataset.trim as 'start' | 'end' ?? 'move', x: event.clientX, scroll: surface.current?.scrollLeft ?? 0, zoom, initial, current: initial, project, moved: false, element: event.currentTarget, pointerId: event.pointerId };
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current; if (!current) return;
    updateDrag(event.clientX, event.shiftKey);
    const next = current.current;
    if (current.moved && (next.startAt !== current.initial.startAt || next.duration !== current.initial.duration)) timing(current.id, current.mode === 'move' ? { startAt: next.startAt } : next, true);
    cancelDrag();
  };
  const scrubEvents = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || (event.target as Element).closest('.composition-track-head, .composition-track-clip, .composition-property-row')) return;
      event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); scrub.current = true; onSeek(groupAt + atPointer(event.clientX));
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => { if (scrub.current) onSeek(groupAt + atPointer(event.clientX)); },
    onPointerUp: (event: PointerEvent<HTMLElement>) => { if (scrub.current) { scrub.current = false; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } },
    onPointerCancel: () => { scrub.current = false; },
  };
  if (!model || !target) return <div className="performance-empty"><p>{read.error}</p><button onClick={onExit}>返回外层时间轴</button></div>;
  const back = () => model.group.trail.length > 1 ? onNavigate(model.group.trail.at(-2)!.instanceId, groupId) : onExit();
  const computed = new Set(['text', 'assetId', 'fontSize'].filter(key => compositionFieldBinding(graph, target, [key]).computed).map(key => 'object_' + key));
  const durationBinding = compositionFieldBinding(graph, target, ['duration']);
  const visible = time >= target.at && time < target.until;
  const tickBase = Math.pow(10, Math.floor(Math.log10(60 / zoom)));
  const tickStep = [1, 2, 5, 10].map(value => value * tickBase).find(value => value * zoom >= 60) ?? tickBase * 10;
  const open = (child: CompositionObjectView) => { select(child); if (child.object.compositionId) onOpenResource(child.object.compositionId); else if (child.object.content === 'group') onNavigate(child.object.instanceId); };
  const frames = (view: CompositionObjectView) => view === target && frameRows.map(({ key, frames }) => <div key={key} className="composition-property-row">
    <span>{visualCurveFields[key][0]}</span><PropertyFrameTimeline frames={frames} duration={view.action.duration} label={visualCurveFields[key][0]} start={view.at - groupAt} zoom={zoom} labelWidth={labelWidth} onSeek={at => onSeek(groupAt + at)} onChange={next => run('移动组合关键帧', (draft, graph) => setCompositionCurve(draft, graph, nodeId, view.object.instanceId, key, next), true)} />
  </div>);
  const toolbar = <div className="timeline-toolbar composition-tools">
    <TimelineCreateMenu onCreate={content => void add(content)} />
    {!!selectedIds.length && <button className="small-button" onClick={makeGroup}>制作组合{selectedIds.length > 1 ? `（${selectedIds.length}）` : ''}</button>}
    <button className="icon-button" aria-label="复制组合片段" title="复制片段 · Ctrl+D" disabled={!selected || model.children.length >= 128} onClick={duplicate}><Copy size={15} /></button>
    <button className="icon-button" aria-label="删除组合片段" title="删除片段 · Delete" disabled={!selected} onClick={remove}><Trash2 size={15} /></button>
    <label><input type="checkbox" aria-label="组合时间轴吸附" checked={snapping} onChange={event => setSnapping(event.target.checked)} />吸附</label>
    <label><input type="checkbox" aria-label="显示组合关键帧" checked={showFrames} onChange={event => setShowFrames(event.target.checked)} />关键帧</label>
    <label><input type="checkbox" aria-label="隐藏不相关内容" checked={hideUnrelated} onChange={event => setHideUnrelated(event.target.checked)} />隐藏不相关内容</label>
    {(hiddenIds.length > 0 || soloIds.length > 0) && <button className="small-button" onClick={() => { setHiddenIds([]); setSoloIds([]); }}>恢复全部预览</button>}
    <div className="composition-view-tools"><output aria-label="组合当前时间">{localTime.toFixed(2)} / {duration.toFixed(2)} 秒</output><button className="small-button" aria-pressed={autoFit} onClick={fit}>适合窗口</button><label>缩放<input aria-label="组合轨道缩放" type="range" min={10} max={300} step={1} value={Math.max(10, zoom)} onChange={event => changeZoom(Number(event.target.value))} /></label></div>
  </div>;
  const tracks = <div className="timeline-scroll composition-scroll" ref={surface} tabIndex={0} aria-label="组合轨道画布" data-zoom={zoom}
    onKeyDown={event => {
      if ((event.target as Element).closest('input, textarea, select, .property-frame-marker')) return;
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); remove(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); event.stopPropagation(); duplicate(); }
    }}
    onDragOver={event => { if (['application/vns-asset', 'application/vns-character', 'application/vnd.vns-composition-object', 'application/vns-blueprint', 'application/vns-timeline'].some(type => event.dataTransfer.types.includes(type))) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
    onDrop={event => {
      const assetId = event.dataTransfer.getData('application/vns-asset'), characterId = event.dataTransfer.getData('application/vns-character'), content = event.dataTransfer.getData('application/vnd.vns-composition-object'), resourceId = (event.dataTransfer.getData('application/vns-blueprint') || event.dataTransfer.getData('application/vns-timeline'));
      if (!assetId && !characterId && !content && !resourceId) return;
      event.preventDefault(); event.stopPropagation();
      const at = seconds(atPointer(event.clientX));
      if (characterId) add('image', undefined, at, characterId);
       else if (assetId) { const asset = project.assets.find(item => item.id === assetId); if (asset?.kind === 'image' || asset?.kind === 'video') void add(asset.kind, assetId, at); else onNotice('声音请添加到外层时间轴的音频轨道。'); }
      else if (['image', 'video', 'text', 'solid', 'group', 'particles'].includes(content)) add(content as VisualObject['content'], undefined, at);
      else if (projectGraphs(project).some(item => item.id === resourceId && item.visualComposition)) addResource(resourceId, at);
    }}>
    <div className="composition-grid" style={{ width: Math.max(labelWidth + extent.current * zoom + 20, labelWidth + 100), '--composition-tick': tickStep * zoom + 'px' } as CSSProperties} {...scrubEvents}>
      <div className="composition-ruler-main"><span>图层 · 上方在前</span>{Array.from({ length: Math.min(300, Math.ceil(extent.current / tickStep) + 1) }, (_, i) => <i key={i} style={{ left: labelWidth + i * tickStep * zoom }}>{Number((i * tickStep).toFixed(3))}s</i>)}</div>
      <div className="composition-visible-end" style={{ left: labelWidth + visibleEnd * zoom }} title="组合可见区间结束" />
      {!selected && frames(model.group)}
      {model.children.map((child, index) => {
        const id = child.object.instanceId, startAt = child.at - groupAt, duration = child.action.duration, active = selectedIds.includes(id);
        const locked = compositionFieldBinding(graph, child, ['duration']).computed;
        return <Fragment key={id}><div className={'composition-track-row' + (active ? ' selected' : '') + (dropId === id ? ' drop-target' : '') + (!childVisible(id) ? ' preview-hidden' : '')} data-instance-id={id}
          onDragOver={event => { if (event.dataTransfer.types.includes('application/vns-composition-track')) { event.preventDefault(); event.stopPropagation(); setDropId(id); } }}
          onDrop={event => {
            const from = event.dataTransfer.getData('application/vns-composition-track'); if (!from) return;
            event.preventDefault(); event.stopPropagation(); setDropId(undefined);
            if (from !== id) run('调整组合图层顺序', (draft, graph) => reorderCompositionChild(draft, graph, nodeId, groupId, from, index), true);
          }}>
          <div className="composition-track-head">
            <button className="composition-track-grip" draggable aria-label={'拖动图层 ' + child.object.name} title="上下拖动调整图层顺序" onDragStart={event => { event.dataTransfer.setData('application/vns-composition-track', id); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDropId(undefined)}><GripVertical size={14} /></button>
            <button className="composition-track-label" title={child.object.name} aria-label={'选择片段 ' + child.object.name} onClick={event => select(child, event.ctrlKey || event.metaKey || event.shiftKey)} onDoubleClick={() => open(child)}><strong>{child.object.name}</strong><small>{contentNames[child.object.content]}{child.object.content === 'group' ? ` · ${child.object.children?.length ?? 0} 项` : ''}</small></button>
            <TrackPreviewControls name={child.object.name} hidden={hiddenIds.includes(id)} solo={soloIds.includes(id)} onHidden={() => setHiddenIds(items => items.includes(id) ? items.filter(item => item !== id) : [...items, id])} onSolo={() => setSoloIds(items => items.includes(id) ? items.filter(item => item !== id) : [...items, id])} />
            {child.object.content === 'group' ? <button className="composition-enter" aria-label={'进入组合 ' + child.object.name} onClick={() => open(child)}>进入</button> : <div className="composition-order">{([-1, 1] as const).map(direction => <button key={direction} aria-label={(direction < 0 ? '上移图层 ' : '下移图层 ') + child.object.name} disabled={index + direction < 0 || index + direction >= model.children.length} onClick={() => run('调整组合图层顺序', (draft, graph) => reorderCompositionChild(draft, graph, nodeId, groupId, id, index + direction))}>{direction < 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}</button>)}</div>}
          </div>
          <div role="button" tabIndex={0} className={'composition-track-clip content-' + child.object.content + (active ? ' selected' : '') + (child.until <= child.at ? ' outside' : '')} aria-label={'组合片段 ' + child.object.name} aria-pressed={active} data-instance-id={id} data-start={startAt} data-duration={duration} style={{ left: labelWidth + startAt * zoom, width: Math.max(26, duration * zoom) }} title={`${child.object.name} · ${startAt.toFixed(2)}–${(startAt + duration).toFixed(2)} 秒；拖动移动，两端调整时长${child.object.content === 'group' ? '，双击进入组合' : ''}`}
            onPointerDown={event => begin(event, child)} onPointerMove={event => { if (gesture.current?.id === id) updateDrag(event.clientX, event.shiftKey); }} onPointerUp={finish} onPointerCancel={cancelDrag} onLostPointerCapture={() => { if (gesture.current) cancelDrag(); }}
            onDoubleClick={event => { event.stopPropagation(); open(child); }}
            onContextMenu={event => { event.preventDefault(); event.stopPropagation(); if (!selectedIds.includes(id)) select(child); setContext({ x: event.clientX, y: event.clientY, id }); }}
            onKeyDown={event => {
              if (event.key === 'Enter') { event.preventDefault(); open(child); }
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); const delta = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : .1); if (!event.altKey || !locked) timing(id, event.altKey ? { duration: Math.max(.05, seconds(duration + delta)) } : { startAt: Math.max(0, seconds(startAt + delta)) }); }
            }}>
            {!locked && <i className="composition-trim start" data-trim="start" aria-label={'调整片段起点 ' + child.object.name} title="调整开始时间" />}
            {child.object.content === 'image' && child.action.assetId && <img src={assetUrl(child.action.assetId)} alt="" draggable={false} />}
            {child.object.content === 'video' && child.action.assetId && <video src={assetUrl(child.action.assetId)} muted playsInline preload="metadata" />}
            {child.object.content === 'solid' && <span className="composition-swatch" style={{ background: child.action.color }} />}
            {child.object.content === 'group' && <Layers size={15} />}
            <span className="composition-clip-caption"><strong>{child.action.content === 'text' ? child.action.text || child.object.name : child.object.name}</strong><small>{duration.toFixed(2)}s{child.until <= child.at ? ' · 超出组合' : ''}</small></span>
            {!locked && <i className="composition-trim end" data-trim="end" aria-label={'调整片段终点 ' + child.object.name} title="调整结束时间" />}
          </div>
        </div>{active && frames(child)}</Fragment>;
      })}
      {!model.children.length && <div className="composition-empty">从左侧拖入图片或角色，或添加文字。</div>}
      <div className="composition-tail" />
      <div className="composition-playhead" style={{ left: labelWidth + localTime * zoom }} aria-label="组合播放头" />
    </div>
  </div>;
  const properties = <section ref={inspector} className="timeline-inspector composition-inspector" aria-label="组合片段属性">
    <header><strong>{selectedIds.length > 1 ? `已选择 ${selectedIds.length} 个片段` : selected ? contentNames[target.object.content] + '属性' : '当前组合'}</strong><div className="spacer" />{selected && <button className="small-button" onClick={() => { setSelectedId(undefined); setSelectedIds([]); }}>选择当前组合</button>}</header>
    <label className="timeline-clip-name">名称<input aria-label="组合片段名称" value={target.object.name} maxLength={120} onChange={event => run('重命名组合片段', (draft, graph) => patchCompositionObject(draft, graph, nodeId, target.object.instanceId, { name: event.target.value }))} /></label>
    {selected && <label className="timeline-clip-duration">开始（秒）<NumberInput aria-label="组合片段开始时间" value={seconds(target.at - groupAt)} step={.1} onChange={event => timing(target.object.instanceId, { startAt: Math.max(0, Number(event.target.value)) })} /></label>}
    <label className="timeline-clip-duration">时长（秒）<NumberInput aria-label="组合片段时长" disabled={durationBinding.computed} value={seconds(target.action.duration)} step={.1} onChange={event => timing(target.object.instanceId, { duration: Math.max(.05, Number(event.target.value)) })} /></label>
    {!visible && <div className="composition-visibility-note">{target.until <= target.at ? <><span>片段超出组合可见范围</span>{selected && <button onClick={() => { timing(selected.object.instanceId, { startAt: 0 }); onSeek(groupAt + .01); }}>移到开头</button>}</> : <button onClick={() => onSeek(target.at + Math.min(.05, (target.until - target.at) / 2))}>定位到片段</button>}</div>}
    <VisualClipInspector key={target.object.instanceId} project={project} graph={graph} view={target} assetUrl={assetUrl} time={time} onSeek={onSeek}
      onChange={patch => run('编辑组合片段', (draft, graph) => patchCompositionObject(draft, graph, nodeId, target.object.instanceId, patch))}
      onPose={(key, value) => run('调整组合画面', (draft, graph) => setCompositionPose(draft, graph, nodeId, target.object.instanceId, time, { [key]: value }))}
      onKeyframe={key => { if (run('切换组合关键帧', (draft, graph) => toggleCompositionKeyframe(draft, graph, nodeId, target.object.instanceId, time, key), true)) setShowFrames(true); }}
      onEffects={next => run('编辑组合动画与效果', (draft, graph) => editCompositionEffects(draft, graph, nodeId, target.object.instanceId, next))}
      onParameterValue={(field, value) => run('编辑组合参数', (draft, graph) => setCompositionField(draft, graph, nodeId, target.object.instanceId, field.path, value))}
      onExpose={(field, existingId) => run('公开组合参数', (draft, graph) => { if (target.path.length) exposeCompositionProperty(draft, graph, nodeId, target.trail.at(-2)!.instanceId, target.object.instanceId, field.path, field.name, field.type as 'number' | 'string' | 'boolean' | 'asset', field.value, existingId); else { const input = performanceInputs(graph).find(input => input.nodeId === nodeId && input.pinId === 'object_' + field.key)!; let name = field.name, index = 2; while (graph.exposedInputs.some(pin => pin.name === name)) name = field.name + ' ' + index++; exposePerformanceInputs(graph, [{ ...input, name }]); } })}
      onRemoveParameter={target.object.compositionId ? undefined : id => run('移除组合参数', (draft, graph) => removeCompositionParameter(draft, graph, nodeId, target.object.instanceId, id))}
      onRenameParameter={target.object.compositionId ? undefined : (id, name) => run('组合参数名称', (draft, graph) => renameCompositionParameter(draft, graph, nodeId, target.object.instanceId, id, name))}
      onOpen={target.object.compositionId ? () => onOpenResource(target.object.compositionId!) : selected ? () => open(selected) : undefined} onSave={saveGroup} onResource={() => onOpenResource(target.object.compositionId!)} onDetach={() => run('转为本地组合', (draft, graph) => detachCompositionResource(draft, graph, nodeId, target.object.instanceId))}
      onGlyphParticles={() => { const result = run('生成字形粒子', (draft, graph) => addCompositionGlyphParticles(draft, graph, nodeId, groupId, target.object.instanceId), true); if (result) { setSelectedId(result.value); setSelectedIds([result.value]); } }} />
  </section>;
  const isolating = hideUnrelated || !!soloIds.length, allowedIds = new Set(model.group.trail.map(item => item.instanceId));
  const allow = (object: VisualObject) => { allowedIds.add(object.instanceId); object.children?.forEach(allow); };
  allowedIds.add(groupId); model.children.filter(child => childVisible(child.object.instanceId)).forEach(child => allow(child.action));
  const contextChild = model.children.find(child => child.object.instanceId === context?.id);
  return <div className="composition-workspace" aria-label="组合剪辑工作区" data-group-id={groupId}>
    <nav className="composition-breadcrumbs" aria-label="组合编辑路径"><button onClick={back}><ArrowLeft size={15} />返回上层</button><button onClick={onExit}>{graph.name}</button>{model.group.trail.map((item, index) => <Fragment key={item.instanceId}><ChevronRight size={13} /><button aria-current={index === model.group.trail.length - 1 ? 'location' : undefined} onClick={() => { if (index === model.group.trail.length - 1) { setSelectedId(undefined); setSelectedIds([]); } else onNavigate(item.instanceId); }}>{item.name}</button></Fragment>)}</nav>
    {context && contextChild && createPortal(<div className="timeline-context-menu" role="menu" aria-label="片段右键菜单" style={{ position: 'fixed', left: Math.max(8, Math.min(context.x, innerWidth - 240)), top: Math.max(8, Math.min(context.y, innerHeight - 280)) }}><ClipMenuItems onSeek={() => { onSeek(contextChild.at + .01); setContext(undefined); }} onProperties={() => { select(contextChild); setContext(undefined); inspector.current?.focus(); }} onDuplicate={() => { duplicate(); setContext(undefined); }} onGroup={makeGroup} onEnter={contextChild.object.content === 'group' ? () => { open(contextChild); setContext(undefined); } : undefined} onSave={contextChild.object.content === 'group' ? saveGroup : undefined} onRemove={() => { remove(); setContext(undefined); }} /></div>, document.body)}
    <CompositionEditingContext.Provider value={{
      canSelect: (root, id) => root === model.group.root.instanceId && (model.children.some(child => child.object.instanceId === id) || id === groupId && !selected),
      selected: (root, id) => root === model.group.root.instanceId && id === target.object.instanceId,
      select: (_, id) => { setSelectedId(id === groupId ? undefined : id); setSelectedIds(id === groupId ? [] : [id]); },
      open: (_, id) => { const child = model.children.find(item => item.object.instanceId === id); if (child) open(child); },
      move: (_, id, patch) => { run('拖动组合画面', (draft, graph) => setCompositionPose(draft, graph, nodeId, id, time, patch), true); },
      transform: (_, id, patch) => { run('变换组合画面', (draft, graph) => setCompositionPose(draft, graph, nodeId, id, time, patch), true); },
      visible: (root, id) => root === model.group.root.instanceId ? !hiddenIds.includes(id) && (!isolating || allowedIds.has(id)) : !isolating,
      isolate: isolating, backgroundVisible: !isolating, actorVisible: () => !isolating, audioEnabled: () => !isolating,
    }}>
      <PerformanceDock minimumTimelineHeight={300} panels={{ library: <PerformanceLibrary project={project} commit={commit} assetUrl={assetUrl} insideComposition currentGraphId={graph.id} resourceAdd={addResource} compositionAdd={(content, assetId) => void add(content, assetId)} add={(type, assetId, characterId) => { if (type === 'image' || type === 'video' || type === 'showCharacter') void add(type === 'showCharacter' ? 'image' : type, assetId, localTime, characterId); }} />, preview: <div className="timeline-preview">{preview}</div>, timeline: <>{toolbar}{tracks}</>, inspector: properties }} />
    </CompositionEditingContext.Provider>
  </div>;
}
