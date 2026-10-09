import { projectGraphs } from '../core/project-resources';
import { editTimelineProject } from '../core/timeline-edit-validation';
import type { BlueprintSelection } from '../core/ai-selection';
import { patchAudioClipNode, createAudioClip, syncAudioClipPins } from '../core/audio-clip';
import { readAudioDuration, readVideoDuration } from './audio-metadata';
import { TimelineAudioClipEditor } from './TimelineAudioClipEditor';
import { replaceChapterWithTimeline } from '../core/chapter-timeline';
import { ActionEditor } from './Inspector';
import { setAfterOffsetCurve, nodeAfterOffsets, afterOffsetDuration, moveOffsetTimelineFrames, setMoveOffsetTimelineFrames, supportsEntranceOffsets } from '../core/move-offsets';
import { EntranceOffsetsEditor, entranceOffsetFields } from './EntranceOffsetsEditor';
import { measureChapterText } from './chapter-text-layout';
import { timelineForNode, useTimelineDefault } from '../core/timeline-component';
import { visualInstancePath } from '../core/visual-selection';
import { VisualObjectEditor } from './VisualObjectEditor';
import { VisualPlayheadEditor } from './VisualPlayheadEditor';
import { setTimelineVisualPropertiesAt } from '../core/performance-timeline';
import { PropertyFrameTimeline } from './PropertyFrameTimeline';
import { LifetimeSpan } from './LifetimeSpan';
import { actorAnimationDuration, actorCurveProperties } from '../core/actor-animation';
import { cameraAnimationDuration } from '../core/camera-animation';
import { createCharacterVisualObject, createVisualObject, syncVisualPins, updateVisualNodeObject, patchVisualClipNode, visualCurveFields, visualPropertyAnimated, visualKeyframeTimes, toggleVisualKeyframe, type VisualCurveProperty } from '../core/visual-object';
import { TimelineKeyframes } from './TimelineKeyframes';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent, type CSSProperties } from 'react';
import { ArrowUp, ArrowDown, GripVertical, Plus, Trash2, Workflow, Music2 } from 'lucide-react';
import { makeId, effectiveCharacter, actionSchema, type BlueprintGraph, type BlueprintNode, type Project, type VisualObject, type VariableValue } from '../core/model';
import { blueprintNodeDefaults, blueprintCatalog, callablePins, connectBlueprintPins } from '../core/blueprint';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs, savedBlueprintAction, rawSavedBlueprintAction } from '../core/blueprint-authoring';
import { chapterCompositionBlueprint } from '../core/chapter-composition-blueprint';
import { timelineNodeActions, insertTimelineAction, addTimelineActorAnimation, arrangePerformanceTimeline, performanceTimeline, performanceLifetimes, setTimelineActorEnd, moveTimelineActorLifetime, editTimelineVisualLifetime, timelinePropertyObject, timelineNodeTypes, type TimelineClip } from '../core/performance-timeline';
import { BlueprintInlineValue, BlueprintNodeFields } from './BlueprintNodeFields';
import { BlueprintParameterValue } from './BlueprintCallFields';
import { BlueprintNameField } from './BlueprintNaming';
import { NumberInput } from './NumberInput';
import type { Commit } from './editor';
import type { AssetUrl } from './StageEditor';
import { PerformanceLibrary } from './PerformanceLibrary';
import { PerformanceDock } from './PerformanceDock';
import { createPortal } from 'react-dom';
import { placeTimelineClip, trimTimelineClip, trimTimelineClipLeft } from '../core/timeline-editing';
import { TimelineVisualClipEditor } from './TimelineVisualClipEditor';
import { CompositionWorkspace } from './CompositionWorkspace';
import { AudioWaveform } from './AudioWaveform';
import { CompositionEditingContext } from './CompositionEditingContext';
import { compositionObject, editCompositionEffects, patchCompositionObject, setCompositionField, setCompositionPose, toggleCompositionKeyframe } from '../core/composition-timeline';
import { addCompositionGlyphParticles, detachCompositionResource, duplicateTimelineSelection, exposeCompositionProperty, groupTimelineSelection, insertCompositionResource, removeCompositionParameter, renameCompositionParameter, saveCompositionResource } from '../core/composition-authoring';
import { VisualClipInspector } from './VisualClipInspector';
import { ClipMenuItems, TimelineCreateMenu } from './TimelineCreateMenu';
import { TrackPreviewControls } from './TrackPreviewControls';

type TimelineDragMode = 'move' | 'left' | 'right' | 'fadeIn' | 'fadeOut';
type TimelinePosition = { at: number; duration: number; trackId: string; offset?: number; fadeIn?: number; fadeOut?: number };

function patchMediaFade(graph: BlueprintGraph, node: BlueprintNode, key: 'fadeIn' | 'fadeOut', value: number) {
  const action = savedBlueprintAction(node);
  const pinId = (action?.kind === 'audioClip' ? 'clip_' : 'object_') + key;
  const link = graph.links.find(item => item.toNodeId === node.id && item.toPinId === pinId);
  const input = graph.nodes.find(item => item.id === link?.fromNodeId);
  if (link) {
    const pin = input?.type === 'getInput' ? graph.exposedInputs.find(item => item.id === input.properties.inputId) : undefined;
    if (!pin) throw new Error('淡入淡出由计算连线控制，请在蓝图中修改。');
    pin.defaultValue = value;
  } else if (action?.kind === 'audioClip') patchAudioClipNode(node, { [key]: value });
  else if (action?.kind === 'visual' && action.content === 'video') patchVisualClipNode(node, { [key]: value });
}

export function PerformanceTimeline({ project, graph, commit, assetUrl, time, onSeek, onBlueprint, onOpenTimeline, onNotice, preview, onActiveSelection, focus, onPreviewProject, onTogglePlayback }: {
  onTogglePlayback?: () => void;
  onPreviewProject?: (project?: Project) => void;
  focus?: {graphId:string;nodeId?:string;objectInstanceId?:string;request:number};
  onActiveSelection?: (selection?:BlueprintSelection)=>void;
  project: Project; graph: BlueprintGraph; commit: Commit; assetUrl: AssetUrl; time: number;
  onSeek: (time: number) => void; onBlueprint: () => void; onOpenTimeline?: (id: string, callNodeId?: string) => void; onNotice: (text: string) => void; preview?: ReactNode;
}) {
  const model = useMemo(() => performanceTimeline(project, graph), [project, graph]);
  const lifetimes = useMemo(() => performanceLifetimes(project, graph), [project, graph]);
  const [showLifetimes, setShowLifetimes] = useState(false);
  const [composition, setComposition] = useState<{ graphId: string; nodeId: string; groupId: string; selectedId?: string }>();
  const [selected, setSelected] = useState<string>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hiddenTracks, setHiddenTracks] = useState<string[]>([]);
  const [soloTracks, setSoloTracks] = useState<string[]>([]);
  useEffect(() => { setSelectedIds([]); setHiddenTracks([]); setSoloTracks([]); }, [graph.id]);
  const trackVisible = (id: string) => !hiddenTracks.includes(id) && (!soloTracks.length || soloTracks.includes(id));
  const [nestedSelection, setNestedSelection] = useState<{ nodeId: string; instanceId: string }>();
  const [pinnedProperties, setPinnedProperties] = useState<{ nodeId: string; instanceId?: string }[]>([]);
  const selectObject = (id: string | undefined, instanceId?: string) => {
    setSelected(id); setSelectedIds(id ? [id] : []); setNestedSelection(id && instanceId ? { nodeId: id, instanceId } : undefined);
    setParameters(false);
  };
  const selectRoot = (id: string | undefined) => { selectObject(id); const clip = model.clips.find(item => item.nodeId === id); if (clip && clip.duration > 0 && (time < clip.at || time >= clip.at + clip.duration)) onSeek(clip.at + Math.min(.01, clip.duration / 2)); };
  const selectMultiple = (id: string) => { const next = selectedIds.includes(id) ? selectedIds.filter(item => item !== id) : [...selectedIds, id]; setSelectedIds(next); setSelected(next.at(-1)); setNestedSelection(undefined); setParameters(false); };
  const [zoom, setZoom] = useState(100);
  const [autoFit, setAutoFit] = useState(true);
  const viewExtent = useRef({ graphId: graph.id, end: 5 });
  const [parameters, setParameters] = useState(false);
  const [detailRequest, setDetailRequest] = useState(0);
  const openDetails = (id: string, instanceId?: string) => {
    setComposition(undefined);
    selectObject(id, instanceId); setContext(undefined);
    setDetailRequest(request => request + 1);
  };
  const openComposition = (id: string, instanceId?: string) => {
    const source = graph.nodes.find(item => item.id === id), root = source && rawSavedBlueprintAction(source);
    if (root?.kind !== 'visual' || root.content !== 'group') { openDetails(id, instanceId); return; }
    const path = instanceId ? visualInstancePath(root, instanceId) : [];
    if (!path) return;
    let object = root, parent = root;
    for (const index of path) { parent = object; object = object.children![index]; }
    const group = object.content === 'group' ? object : parent;
    if (group.compositionId) { onOpenTimeline?.(group.compositionId); return; }
    selectObject(id, instanceId); setContext(undefined);
    setComposition({ graphId: graph.id, nodeId: id, groupId: group.instanceId, selectedId: object.content === 'group' ? undefined : object.instanceId });
    const clip = model.clips.find(item => item.nodeId === id);
    const resolved = clip && timelinePropertyObject(project, graph, id, path, clip.at);
    if (resolved?.action.kind === 'visual' && (time < resolved.at || time >= resolved.at + resolved.action.duration)) onSeek(resolved.at + Math.min(.05, resolved.action.duration / 2));
  };
  const [renamingParameter, setRenamingParameter] = useState<string>();
  const [context, setContext] = useState<{ x: number; y: number; trackId: string; nodeId?: string }>();
  useEffect(() => {
    if (!context) return;
    const close = (event: MouseEvent) => { if (!(event.target as Element).closest('.timeline-context-menu')) setContext(undefined); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setContext(undefined); } };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); };
  }, [context]);
  const audioRequest = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => audioRequest.current?.abort(), [graph.id, project.id]);
  const [generatingChapter, setGeneratingChapter] = useState(false);
  const latestProject = useRef(project); latestProject.current = project;
  const openClipEditor = async (item: BlueprintNode) => {
    const existing = timelineForNode(project, item);
    if (existing) { onOpenTimeline?.(existing.id, item.id); return; }
    const action = rawSavedBlueprintAction(item);
    if (action?.kind === 'visual' && action.content === 'group') { openComposition(item.id); return; }
    if (item.type !== 'showChapter') { openDetails(item.id); return; }
    if (generatingChapter) return;
    setGeneratingChapter(true);
    try {
      const source = timelineNodeActions(project, graph, item).find(action => action.kind === 'chapter'); if (!source || source.kind !== 'chapter') throw new Error('无法解析当前标题参数。');
      const textLayout = await measureChapterText(project, source, assetUrl);
      if (latestProject.current !== project) throw new Error('测量期间工程已修改，请重试。');
      const opened = run('展开标题内部时间轴', (draft, target) => {
        const result = chapterCompositionBlueprint(draft, source, textLayout, { includeEmptySubtitle: target.links.some(link => link.toNodeId === item.id && link.toPinId === 'subtitle') });
        const child = replaceChapterWithTimeline(draft, target, item.id, result);
        return { id: child.id, warnings: result.warnings };
      });
      if (opened) { onNotice(opened.value.warnings.join(' ')); onOpenTimeline?.(opened.value.id, item.id); }
    } catch (error) { onNotice(error instanceof Error ? error.message : String(error)); }
    finally { setGeneratingChapter(false); }
  };
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; scrollLeft: number; scrollTop: number; at: number; duration: number; trackId: string; mode: TimelineDragMode; offset?: number; sourceDuration?: number; fadeIn?: number; fadeOut?: number; moved?: boolean }>();
  const [position, setPosition] = useState<TimelinePosition>();
  const [trackDrag, setTrackDrag] = useState<{ id: string; index: number }>();
  const trackDragRef = useRef<typeof trackDrag>(undefined);
  const displayedTracks = useMemo(() => {
    if (!trackDrag) return model.tracks;
    const tracks = [...model.tracks], index = tracks.findIndex(track => track.id === trackDrag.id);
    if (index >= 0) { const [track] = tracks.splice(index, 1); tracks.splice(trackDrag.index, 0, track); }
    return tracks;
  }, [model.tracks, trackDrag]);
  useEffect(() => {
    if (composition) return;
    if (!onPreviewProject) return;
    if (!trackDrag && (!drag || !position)) { onPreviewProject(undefined); return; }
    try {
      const draft = structuredClone(project), target = projectGraphs(draft).find(item => item.id === graph.id)!;
      const clips = model.clips.map(clip => drag?.id === clip.nodeId && position ? { ...clip, ...position } : clip);
      if (drag && position && drag.mode !== 'move') {
        const source = target.nodes.find(node => node.id === drag.id)!;
        const action = savedBlueprintAction(source);
        if (drag.mode === 'fadeIn' || drag.mode === 'fadeOut') {
          patchMediaFade(target, source, drag.mode, position[drag.mode] ?? 0);
        } else if (action?.kind === 'visual') {
          source.properties.object_duration = position.duration;
          if (action.content === 'video') {
            patchVisualClipNode(source, { mediaOffset: position.offset, fadeIn: position.fadeIn, fadeOut: position.fadeOut });
          }
        } else if (action?.kind === 'audioClip') patchAudioClipNode(source, { duration: position.duration, offset: position.offset, fadeIn: position.fadeIn, fadeOut: position.fadeOut });
      }
      arrangePerformanceTimeline(draft, target, clips, displayedTracks);
      onPreviewProject(draft);
    } catch { onPreviewProject(undefined); }
  }, [project, graph, drag?.id, drag?.mode, position?.at, position?.duration, position?.trackId, position?.offset, position?.fadeIn, position?.fadeOut, trackDrag?.id, trackDrag?.index, onPreviewProject, !!composition]);
  useEffect(() => () => onPreviewProject?.(undefined), [onPreviewProject, graph.id]);
  const [snapping, setSnapping] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const dragRef = useRef<typeof drag>(undefined), positionRef = useRef<typeof position>(undefined);
  const pointer = useRef({ x: 0, y: 0, shift: false });
  const pan = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined);
  const space = useRef(false);
  const surface = useRef<HTMLDivElement>(null);
  const changeZoom = (next: number, clientX?: number) => {
    const element = surface.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    const playhead = 130 + time * zoom - element.scrollLeft;
    const anchor = clientX === undefined
      ? (playhead >= 130 && playhead <= element.clientWidth ? playhead : (130 + element.clientWidth) / 2)
      : clientX - bounds.left;
    const at = (element.scrollLeft + anchor - 130) / zoom;
    setAutoFit(false); setZoom(next);
    requestAnimationFrame(() => { element.scrollLeft = 130 + at * next - anchor; });
  };
  const zoomAtPointer = useRef(changeZoom); zoomAtPointer.current = changeZoom;
  const inspectorElement = useRef<HTMLElement>(null);
  const objectDetails = useRef<HTMLDetailsElement>(null);
  useEffect(() => { inspectorElement.current?.scrollTo({ top: 0 }); }, [selected, nestedSelection?.instanceId, parameters]);
  useEffect(() => {
    if (!detailRequest) return;
    const details = objectDetails.current;
    if (details) details.open = true;
    const target = details?.querySelector('summary') ?? inspectorElement.current;
    target?.focus({ preventScroll: true });
    const inspector = inspectorElement.current;
    if (inspector && target) {
      const headerHeight = inspector.querySelector(':scope > header')?.getBoundingClientRect().height ?? 0;
      inspector.scrollTo({ top: inspector.scrollTop + target.getBoundingClientRect().top - inspector.getBoundingClientRect().top - headerHeight - 12 });
    }
  }, [detailRequest]);
  const node = graph.nodes.find(node => node.id === selected);
  const clip = model.clips.find(clip => clip.nodeId === selected);
  const selectedAction = useMemo(() => node && savedBlueprintAction(node), [node]);
  const resolvedAudio = node ? model.actionsByNode.get(node.id)?.find(a=>a.kind==='audioClip') : undefined;
  const authoredVisual = useMemo(() => node && rawSavedBlueprintAction(node), [node]);
  const resolvedVisual = node ? model.actionsByNode.get(node.id)?.find(a=>a.kind==='visual') : undefined;
  const isNested = !!nestedSelection && nestedSelection.nodeId === selected;
  const resolvedPath = isNested && authoredVisual?.kind === 'visual' ? visualInstancePath(authoredVisual, nestedSelection.instanceId) : undefined;
  const nestedPath = resolvedPath ?? [];
  const missingNested = isNested && !resolvedPath;
  let editedObject = authoredVisual?.kind === 'visual' && !missingNested ? authoredVisual : undefined;
  let editedObjectStart = clip?.at ?? 0;
  for (const index of nestedPath) { editedObject = editedObject?.children?.[index]; editedObjectStart += editedObject?.startAt ?? 0; }
  const propertyObject = useMemo(() => selected && clip && !missingNested ? timelinePropertyObject(project, graph, selected, nestedPath, clip.at) : undefined, [project, graph, selected, nestedSelection, clip?.at]);
  const propertyAction = propertyObject?.action;
  const propertyLifetime = propertyAction?.kind === 'visual' ? lifetimes.find(row => row.nodeId === selected && row.instanceId === propertyAction.instanceId) : undefined;
  const visualView = useMemo(() => { try { return selected && editedObject ? compositionObject(project, graph, selected, editedObject.instanceId) : undefined; } catch { return undefined; } }, [project, graph, selected, editedObject?.instanceId]);
  useEffect(() => { if (!composition) onActiveSelection?.({graphId:graph.id,nodeId:!missingNested ? node?.id : undefined,objectInstanceId:isNested && !missingNested ? nestedSelection?.instanceId : undefined}); }, [graph.id, node?.id, isNested, missingNested, nestedSelection?.instanceId, onActiveSelection, !!composition]);
  useEffect(() => () => onActiveSelection?.(undefined), [onActiveSelection]);
  const propertyIdentity = selected ? { nodeId: selected, instanceId: isNested ? nestedSelection?.instanceId : undefined } : undefined;
  const propertyKey = (item: { nodeId: string; instanceId?: string }) => `${item.nodeId}/${item.instanceId ?? ''}`;
  const propertyTargets = useMemo(() => [...pinnedProperties, ...(propertyIdentity && propertyAction ? [propertyIdentity] : [])]
    .filter((item, index, all) => all.findIndex(other => propertyKey(other) === propertyKey(item)) === index)
    .flatMap(identity => {
      const source = graph.nodes.find(node => node.id === identity.nodeId), targetClip = model.clips.find(clip => clip.nodeId === identity.nodeId);
      const root = source && savedBlueprintAction(source);
      const path = identity.instanceId ? root?.kind === 'visual' ? visualInstancePath(root, identity.instanceId) : undefined : [];
      if (!source || !targetClip || !path) return [];
      const resolved = timelinePropertyObject(project, graph, identity.nodeId, path, targetClip.at);
      return resolved ? [{ identity, path, clip: targetClip, resolved, name: resolved.action.kind === 'visual' ? resolved.action.name : source.name }] : [];
    }), [project, graph, model, pinnedProperties, selected, isNested, nestedSelection, propertyAction]);
  const entranceSelected = !isNested && node && supportsEntranceOffsets(node);
  const entranceTargets = [...pinnedProperties, ...(entranceSelected && propertyIdentity ? [propertyIdentity] : [])]
    .filter((item, index, all) => !item.instanceId && all.findIndex(other => propertyKey(other) === propertyKey(item)) === index)
    .flatMap(identity => {
      const source = graph.nodes.find(node => node.id === identity.nodeId), clip = model.clips.find(clip => clip.nodeId === identity.nodeId);
      if (!source || !clip || (clip.entranceDuration ?? clip.duration) <= 0 || !supportsEntranceOffsets(source)) return [];
      try { return actorCurveProperties.flatMap(key => { const frames = moveOffsetTimelineFrames(source, key, clip.entranceDuration ?? clip.duration); return frames?.length ? [{ identity, source, clip, key, frames }] : []; }); } catch { return []; }
    });
  const afterTargets = [...pinnedProperties, ...(entranceSelected && propertyIdentity ? [propertyIdentity] : [])]
    .filter((item,index,all)=>!item.instanceId && all.findIndex(other=>propertyKey(other)===propertyKey(item))===index)
    .flatMap(identity=>{
      const source=graph.nodes.find(node=>node.id===identity.nodeId),clip=model.clips.find(clip=>clip.nodeId===identity.nodeId);
      if(!source||!clip||!supportsEntranceOffsets(source))return [];
      try { const curves=nodeAfterOffsets(source);return actorCurveProperties.flatMap(key=>curves?.[key]?.length?[{identity,source,clip,key,frames:curves[key]!}]:[]); } catch {return [];}
    });
  const propertyEnd = Math.max(0, ...propertyTargets.map(target => target.resolved.at + Math.max(0, ...Object.values(target.resolved.action.curves ?? {}).flatMap(frames => frames.map(frame => frame.at)))));

  const run = <T,>(label: string, edit: (draft: Project, graph: BlueprintGraph) => T): { value: T } | undefined => {
    let result: { value: T } | undefined, failure: unknown;
    try {
      commit(label, draft => {
        try { result = { value: editTimelineProject(draft, graph.id, edit) }; }
        catch (error) { failure = error; throw error; }
      });
    } catch (error) { failure = error; }
    if (failure) { onNotice(failure instanceof Error ? failure.message : String(failure)); return; }
    return result;
  };
  const trackOperations = useRef({ run, model }); trackOperations.current = { run, model };
  useEffect(() => {
    if (!trackDrag) return;
    const move = (event: globalThis.PointerEvent) => {
      const current = trackDragRef.current; if (!current) return;
      const rows = Array.from(surface.current?.querySelectorAll<HTMLElement>('.timeline-track[data-track-id]') ?? []);
      const index = rows.findIndex(row => { const rect = row.getBoundingClientRect(); return event.clientY >= rect.top && event.clientY < rect.bottom; });
      if (index >= 0 && index !== current.index) { trackDragRef.current = { id: current.id, index }; setTrackDrag(trackDragRef.current); }
    };
    const cancel = () => { trackDragRef.current = undefined; setTrackDrag(undefined); };
    const finish = () => {
      const current = trackDragRef.current, { run, model } = trackOperations.current;
      if (current) {
        const tracks = [...model.tracks], index = tracks.findIndex(track => track.id === current.id);
        if (index >= 0 && index !== current.index) { const [track] = tracks.splice(index, 1); tracks.splice(current.index, 0, track); run('调整轨道上下顺序', (draft, target) => arrangePerformanceTimeline(draft, target, model.clips, tracks)); }
      }
      cancel();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', cancel); window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', cancel); };
  }, [!!trackDrag]);
  const arrange = (clips: TimelineClip[]) => run('调整演出轨道', (draft, target) => arrangePerformanceTimeline(draft, target, clips.map(clip => {
    const previous = model.clips.find(item => item.nodeId === clip.nodeId);
    return previous && (previous.at !== clip.at || previous.trackId !== clip.trackId) ? placeTimelineClip(clip, clips) : clip;
  }), model.tracks));
  const editNode = (edit: (node: BlueprintNode, draft: Project, graph: BlueprintGraph) => void, targetId = selected) => run('编辑演出片段 ' + selected, (draft, target) => {
    const changed = target.nodes.find(item => item.id === targetId); if (!changed) return;
    edit(changed, draft, target);
    const action = savedBlueprintAction(changed);
    const audio = rawSavedBlueprintAction(changed);
    if (audio?.kind === 'audioClip') syncAudioClipPins(changed, audio);
    if (audio?.kind === 'visual') syncVisualPins(changed, audio);
    const durations = performanceTimeline(draft, target);
    arrangePerformanceTimeline(draft, target, model.clips.map(clip => ({ ...clip, duration: durations.clips.find(item => item.nodeId === clip.nodeId)?.duration ?? clip.duration })), model.tracks);
  });
  const setInputDefault = (id: string, value: VariableValue) => run('参数默认值', (draft, target) => {
    target.exposedInputs.find(pin => pin.id === id)!.defaultValue = value;
    const durations = performanceTimeline(draft, target);
    arrangePerformanceTimeline(draft, target, model.clips.map(clip => ({ ...clip, duration: durations.clips.find(item => item.nodeId === clip.nodeId)?.duration ?? clip.duration })), model.tracks);
  });
  const editObject = (object: VisualObject) => editNode(node => updateVisualNodeObject(node,object));
  const moveTrack = (id: string, direction: number) => run('调整轨道上下顺序', (draft, target) => {
    const tracks = [...model.tracks], index = tracks.findIndex(track => track.id === id), next = index + direction;
    if (index < 0 || next < 0 || next >= tracks.length) return;
    [tracks[index], tracks[next]] = [tracks[next], tracks[index]];
    arrangePerformanceTimeline(draft, target, model.clips, tracks);
  });
  const resize = (duration: number, clips: TimelineClip[], id = selected, mediaPatch: { offset?: number } = {}) => run('调整片段收尾', (draft, target) => {
    const changed = target.nodes.find(item => item.id === id); if (!changed) return;
    if (supportsEntranceOffsets(changed)) { duration -= afterOffsetDuration(nodeAfterOffsets(changed)); if (duration < 0) throw new Error('片段不能短于后续关键帧时长，请先调整后续关键帧。'); }
    const actionBefore = savedBlueprintAction(changed);
    const durationPin = actionBefore?.kind === 'visual' ? 'object_duration' : actionBefore?.kind === 'audioClip' ? 'clip_duration' : 'duration';
    const link = target.links.find(link => link.toNodeId === changed.id && link.toPinId === durationPin);
    const input = target.nodes.find(item => item.id === link?.fromNodeId);
    if (link && input?.type !== 'getInput') throw new Error('时长由计算连线控制，请在蓝图中修改。');
    if (input?.type === 'getInput') { const pin = target.exposedInputs.find(pin => pin.id === input.properties.inputId); if (pin) pin.defaultValue = duration; }
    else if (changed.type === 'savedAction') {
      const action = savedBlueprintAction(changed);
      if (action?.kind === 'audioClip') { patchAudioClipNode(changed, { duration, ...mediaPatch }); }
      if (action?.kind === 'visual') { changed.properties.object_duration = duration; if (action.content === 'video' && mediaPatch.offset !== undefined) patchVisualClipNode(changed, { mediaOffset: mediaPatch.offset }); }
      if (action?.kind === 'show') { action.duration = duration; changed.properties.action = JSON.stringify(action); }
      if (action?.kind === 'animate') {
        const old = actorAnimationDuration(action);
        action.keyframes.forEach(frame => frame.duration = old ? frame.duration * duration / old : duration / action.keyframes.length);
        for (const frames of Object.values(action.curves ?? {})) frames.forEach(frame => { frame.at = old ? frame.at * duration / old : 0; });
        changed.properties.action = JSON.stringify(action);
      }
      if (action?.kind === 'camera') {
        const old = cameraAnimationDuration(action);
        action.duration = old ? action.duration * duration / old : duration;
        for (const frames of Object.values(action.curves ?? {})) frames.forEach(frame => { frame.at = old ? frame.at * duration / old : 0; });
        changed.properties.action = JSON.stringify(action);
      }
    } else changed.properties[changed.type === 'playMusic' || changed.type === 'stopMusic' ? 'fade' : 'duration'] = duration;
    if (mediaPatch.offset !== undefined && actionBefore && (actionBefore.kind === 'audioClip' || actionBefore.kind === 'visual' && actionBefore.content === 'video')) {
      const pinId = actionBefore.kind === 'audioClip' ? 'clip_offset' : 'object_mediaOffset';
      const mediaLink = target.links.find(item => item.toNodeId === changed.id && item.toPinId === pinId);
      const mediaInput = target.nodes.find(item => item.id === mediaLink?.fromNodeId);
      if (mediaLink && mediaInput?.type !== 'getInput') throw new Error('素材入点由计算连线控制，请在蓝图中修改。');
      if (mediaInput?.type === 'getInput') {
        const pin = target.exposedInputs.find(item => item.id === mediaInput.properties.inputId); if (pin) pin.defaultValue = mediaPatch.offset;
      } else if (actionBefore.kind === 'audioClip') patchAudioClipNode(changed, { offset: mediaPatch.offset });
      else patchVisualClipNode(changed, { mediaOffset: mediaPatch.offset });
    }
    const durations = performanceTimeline(draft, target);
    arrangePerformanceTimeline(draft, target, clips.map(clip => ({ ...clip, duration: durations.clips.find(item => item.nodeId === clip.nodeId)?.duration ?? clip.duration })), model.tracks);
  });
  const addCharacter = (characterId: string | undefined, at = time, trackId?: string) => {
    const character = effectiveCharacter(project, characterId ?? project.characters[0]?.id ?? '');
    if (!character?.expressions.length) { onNotice('先为角色添加至少一个表情图片。'); return; }
    const expression = character.expressions.find(item => item.id === character.defaultExpressionId) ?? character.expressions[0];
    const added = run('添加角色图片片段', (draft, target) => insertTimelineAction(draft, target, createCharacterVisualObject(draft, character.id, expression.id), at, trackId));
    if (added) { selectRoot(added.value); setParameters(false); }
  };
  const addVisual = (content: 'image' | 'text' | 'particles' | 'solid' | 'group', assetId?: string, at = time, trackId = clip?.trackId ?? model.tracks[0]?.id) => {
    const added = run('添加素材片段', (draft, target) => {
      const object = createVisualObject(content, assetId);
      if (content === 'image') { object.name = draft.assets.find(asset => asset.id === assetId)?.name ?? '图片'; object.imageFit = 'contain'; }
      return insertTimelineAction(draft, target, object, at, trackId);
    });
    if (added) { selectRoot(added.value); setParameters(false); }
  };
  const addVideo = async (assetId: string | undefined, at: number, trackId?: string) => {
    const asset = project.assets.find(item => item.id === assetId && item.kind === 'video');
    if (!asset) { onNotice('先在素材库选择视频文件。'); return; }
    audioRequest.current?.abort(); const controller = new AbortController(); audioRequest.current = controller;
    onNotice('正在读取视频时长…');
    try {
      const sourceDuration = await readVideoDuration(assetUrl(asset.id) ?? '', controller.signal);
      if (latestProject.current !== project) { onNotice('读取期间工程已修改，请重新添加视频。'); return; }
      const added = run('添加视频片段', (draft, target) => { const object = createVisualObject('video', asset.id); object.name = asset.name; object.sourceDuration = sourceDuration; object.duration = sourceDuration; object.imageFit = 'contain'; return insertTimelineAction(draft, target, object, at, trackId); });
      if (added) { selectRoot(added.value); setParameters(false); onNotice(''); }
    } catch (error) { if (!controller.signal.aborted) onNotice(error instanceof Error ? error.message : String(error)); }
  };
  const addAudio = async (assetId: string | undefined, at: number, trackId?: string) => {
    const asset = project.assets.find(a => a.id === assetId && a.kind === 'audio');
    if (!asset) { onNotice('先在素材库选择音频文件。'); return; }
    audioRequest.current?.abort(); const controller = new AbortController(); audioRequest.current = controller;
    onNotice('正在读取音频时长…');
    try {
      const duration = await readAudioDuration(assetUrl(asset.id) ?? "", controller.signal);
      if (latestProject.current !== project) { onNotice('读取期间工程已修改，请重新添加音频。'); return; }
      const added = run('添加音频片段', (draft, target) => insertTimelineAction(draft, target, createAudioClip(asset.id, asset.name, duration, asset.category === 'bgm' ? 'music' : asset.category === 'voice' ? 'voice' : 'sound'), at, trackId));
      if (added) { selectRoot(added.value); setParameters(false); onNotice(''); }
    } catch (error) { if (!controller.signal.aborted) onNotice(error instanceof Error ? error.message : String(error)); }
  };
  const add = (type: (typeof timelineNodeTypes)[number] | 'image' | 'audio' | 'video', assetId?: string, at = time, trackId?: string, characterId?: string) => {
    if (type === 'audio') { void addAudio(assetId, at, trackId); return; }
    if (type === 'video') { void addVideo(assetId, at, trackId); return; }
    if (type === 'image') { addVisual('image', assetId, at, trackId); return; }
    if (type === 'showCharacter') { addCharacter(characterId, at, trackId); return; }
    const created = blueprintNodeDefaults(type);
    const character = effectiveCharacter(project, characterId ?? project.characters[0]?.id ?? '');
    if (type === 'showBackground') created.properties.assetId = assetId ?? project.assets.find(asset => asset.kind === 'image' && asset.category === 'scene')?.id ?? project.assets.find(asset => asset.kind === 'image')?.id ?? '';
    if (type === 'hideCharacter') Object.assign(created.properties, { characterId: character?.id ?? '', expressionId: character?.defaultExpressionId ?? character?.expressions[0]?.id ?? '' });
    if (type === 'playMusic' || type === 'playSound') created.properties.assetId = assetId ?? project.assets.find(asset => asset.kind === 'audio' && asset.category === (type === 'playMusic' ? 'bgm' : 'sound'))?.id ?? project.assets.find(asset => asset.kind === 'audio')?.id ?? '';
    if (type === 'showChapter') created.properties.effect = project.ui.chapterTransition?.effect ?? 'fade';
    const added = run('添加演出片段', (draft, target) => {
      const previous = target.nodes.find(item => item.id === target.timeline?.tailNodeId) ?? target.nodes.find(item => item.id === model.clips.at(-1)?.nodeId) ?? target.nodes.find(item => item.type === 'event')!;
      const outgoing = target.links.find(link => link.fromNodeId === previous.id && link.fromPinId === (previous.type === 'event' ? 'exec' : 'exec_out'));
      if (outgoing) target.links = target.links.filter(link => link.id !== outgoing.id);
      target.nodes.push(created);
      connectBlueprintPins(target, previous.id, previous.type === 'event' ? 'exec' : 'exec_out', created.id, 'exec_in');
      if (outgoing) connectBlueprintPins(target, created.id, 'exec_out', outgoing.toNodeId, outgoing.toPinId);
      const updated = performanceTimeline(draft, target), added = updated.clips.find(clip => clip.nodeId === created.id)!;
      arrangePerformanceTimeline(draft, target, [...model.clips, placeTimelineClip({ ...added, at, trackId: trackId ?? added.trackId }, model.clips)], updated.tracks);
    });
    if (added) { setParameters(false); selectRoot(created.id); }
  };
  const remove = () => { const ids = selectedIds.length ? selectedIds : selected ? [selected] : []; if (ids.length && arrange(model.clips.filter(item => !ids.includes(item.nodeId)))) selectRoot(undefined); };
  const duplicate = () => { const result = run('复制演出片段', (draft, target) => duplicateTimelineSelection(draft, target, selectedIds.length ? selectedIds : selected ? [selected] : [])); if (result) { selectRoot(result.value.at(-1)); setSelectedIds(result.value); setContext(undefined); } };
  const makeGroup = () => { const grouped = run('制作演出组合', (draft, target) => groupTimelineSelection(draft, target, selectedIds.length ? selectedIds : selected ? [selected] : [])); if (grouped) { selectRoot(grouped.value); setContext(undefined); } };
  const saveGroup = () => { if (!selected || !editedObject) return; const result = run('保存组合资源', (draft, target) => saveCompositionResource(draft, target, selected, editedObject.instanceId)); if (result) { onNotice('已保存到素材库的“组合”和资源管理器。'); setContext(undefined); } };
  const addResource = (id: string, at = time, trackId?: string) => { const result = run('添加演出资源', (draft, target) => insertCompositionResource(draft, target, id, at, trackId)); if (result) selectRoot(result.value); };
  const snap = (value: number, free = false, exclude?: string) => {
    if (!snapping || free) return Math.max(0, Math.round(value * 1000) / 1000);
    const points = [0, time, ...model.clips.filter(clip => clip.nodeId !== exclude).flatMap(clip => [clip.at, clip.at + clip.duration])];
    const nearest = points.reduce((best, point) => Math.abs(point - value) < Math.abs(best - value) ? point : best, Infinity);
    return Math.max(0, Math.abs(nearest - value) * zoom <= 7 ? nearest : Math.round(value * 20) / 20);
  };
  const fromPointer = (clientX: number) => Math.max(0, (clientX - (surface.current?.getBoundingClientRect().left ?? 0) + (surface.current?.scrollLeft ?? 0) - 130) / zoom);
  const updateDrag = () => {
    const current = dragRef.current; if (!current) return;
    if (Math.hypot(pointer.current.x - current.x, pointer.current.y - current.y) > 3) current.moved = true;
    if (!current.moved) return;
    const delta = (pointer.current.x - current.x + (surface.current?.scrollLeft ?? 0) - current.scrollLeft) / zoom;
    const rows = Array.from(surface.current?.querySelectorAll<HTMLElement>('.timeline-track[data-track-id]') ?? []);
    const hovered = rows.find(row => { const bounds = row.getBoundingClientRect(); return pointer.current.y >= bounds.top && pointer.current.y < bounds.bottom; });
    const index = hovered ? model.tracks.findIndex(track => track.id === hovered.dataset.trackId) : pointer.current.y < (rows[0]?.getBoundingClientRect().top ?? 0) ? 0 : model.tracks.length - 1;
    const targetTrackId = model.tracks[index]?.id ?? current.trackId;
    const base: TimelinePosition = { at: current.at, duration: current.duration, trackId: current.trackId, offset: current.offset, fadeIn: current.fadeIn, fadeOut: current.fadeOut };
    if (current.mode === 'fadeIn' || current.mode === 'fadeOut') {
      const key = current.mode === 'fadeIn' ? 'fadeIn' : 'fadeOut';
      const value = Math.max(0, Math.min(current.duration, Math.round(((current[key] ?? 0) + (key === 'fadeOut' ? -delta : delta)) * 1000) / 1000));
      base[key] = value;
      positionRef.current = base; setPosition(base); return;
    }
    if (current.mode === 'move') {
      const moved = placeTimelineClip({ ...base, at: snap(current.at + delta, pointer.current.shift, current.id), trackId: targetTrackId, nodeId: current.id }, model.clips);
      positionRef.current = moved; setPosition(moved); return;
    }
    const right = current.at + current.duration;
    if (current.mode === 'left') {
      const minimumSourceStart = current.offset === undefined ? 0 : current.at - current.offset;
      const previousEnd = Math.max(0, ...model.clips.filter(item => item.nodeId !== current.id && item.trackId === current.trackId && item.duration > 0 && item.at + item.duration <= current.at + .00001).map(item => item.at + item.duration));
      const requested = snap(current.at + delta, pointer.current.shift, current.id);
      const at = Math.max(previousEnd, minimumSourceStart, Math.min(right - .05, requested));
      const trimmed = trimTimelineClipLeft({ ...base, nodeId: current.id, at, duration: right - at }, model.clips, at, .05);
      base.at = trimmed.at; base.duration = Math.max(.05, trimmed.duration);
      if (current.offset !== undefined) base.offset = Math.max(0, current.offset + trimmed.at - current.at);
    } else {
      const requestedDuration = Math.max(.05, snap(right + delta, pointer.current.shift, current.id) - current.at);
      base.duration = requestedDuration;
      const clipped = trimTimelineClip({ ...base, nodeId: current.id }, model.clips);
      base.duration = clipped.duration;
      if (current.sourceDuration !== undefined && current.offset !== undefined) base.duration = Math.min(base.duration, Math.max(.05, current.sourceDuration - current.offset));
    }
    positionRef.current = base; setPosition(base);
  };
  const latest = useRef({ updateDrag, seek: onSeek, fromPointer }); latest.current = { updateDrag, seek: onSeek, fromPointer };
  useEffect(() => {
    if (!drag && !scrubbing) return;
    let frame = 0;
    const tick = () => {
      const element = surface.current;
      if (element) {
        const bounds = element.getBoundingClientRect(), x = pointer.current.x;
        const delta = x > bounds.right - 34 ? Math.min(22, (x - bounds.right + 34) / 3) : x < bounds.left + 152 ? -Math.min(22, (bounds.left + 152 - x) / 3) : 0;
        const before = element.scrollLeft; if (!dragRef.current || dragRef.current.moved) element.scrollLeft += delta;
        if (element.scrollLeft !== before) { if (dragRef.current) latest.current.updateDrag(); else latest.current.seek(latest.current.fromPointer(x)); }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [!!drag, scrubbing]);
  useEffect(() => {
    const element = surface.current; if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        zoomAtPointer.current(Math.max(.001, Math.min(500, zoom * Math.exp(-event.deltaY * .002))), event.clientX);
      } else if (event.shiftKey) { event.preventDefault(); element.scrollLeft += event.deltaY || event.deltaX; }
    };
    const key = (event: KeyboardEvent) => { if (event.code === 'Space' && element.contains(document.activeElement) && !(event.target as Element).closest('input, textarea, select, [role=slider], .timeline-ruler')) { space.current = event.type === 'keydown'; event.preventDefault(); } };
    const blur = () => { space.current = false; pan.current = undefined; dragRef.current = undefined; positionRef.current = undefined; setDrag(undefined); setPosition(undefined); setScrubbing(false); };
    element.addEventListener('wheel', wheel, { passive: false }); window.addEventListener('keydown', key); window.addEventListener('keyup', key); window.addEventListener('blur', blur);
    return () => { element.removeEventListener('wheel', wheel); window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', blur); };
  }, [zoom, model.reason, !!composition]);
  useEffect(() => { setComposition(undefined); selectRoot(undefined); setPinnedProperties([]); setParameters(false); setAutoFit(true); setShowLifetimes(!!graph.chapterVariant || graph.nodes.some(node => { const action = rawSavedBlueprintAction(node); return action?.kind === 'visual' && action.chapterPresentation; })); }, [graph.id]);
  useEffect(()=>{
    if(focus?.graphId!==graph.id||!focus.nodeId)return;
    setComposition(undefined);
    const target=model.clips.find(c=>c.nodeId===focus.nodeId);if(!target)return;
    let seekAt=target.at;
    if(focus.objectInstanceId){
      const source=graph.nodes.find(n=>n.id===target.nodeId),action=source&&savedBlueprintAction(source);
      const path=action?.kind==='visual'?visualInstancePath(action,focus.objectInstanceId):undefined;
      if(!path||action?.kind!=='visual')return;
      selectObject(target.nodeId,path.length?focus.objectInstanceId:undefined);setShowLifetimes(true);
      if(action.content==='group')openComposition(target.nodeId,focus.objectInstanceId);
      const row=lifetimes.find(row=>row.nodeId===target.nodeId&&row.instanceId===focus.objectInstanceId);
      if(row)seekAt=row.at;else{let object=action;for(const index of path){object=object.children![index];seekAt+=object.startAt??0;}}
    }else selectRoot(target.nodeId);
    setParameters(false);
    const frame=requestAnimationFrame(()=>{onSeek(seekAt);const element=focus.objectInstanceId?Array.from(surface.current?.querySelectorAll<HTMLElement>('.lifetime-span')??[]).find(el=>el.dataset.instanceId===focus.objectInstanceId):Array.from(surface.current?.querySelectorAll<HTMLElement>('.timeline-clip')??[]).find(el=>el.dataset.nodeId===target.nodeId);element?.scrollIntoView({block:'nearest',inline:'nearest'});});
    return ()=>cancelAnimationFrame(frame);
  },[focus?.request, focus?.graphId, graph.id]);

  const requiredEnd = Math.max(5, Math.ceil(propertyEnd + 1), Math.ceil(model.until + 2), Math.ceil(time + 1), Math.ceil((position?.at ?? 0) + (position?.duration ?? 0) + 2));
  if (viewExtent.current.graphId !== graph.id) viewExtent.current = { graphId: graph.id, end: requiredEnd };
  // A shorter clip or collapsed property row must not shrink the scroll surface.
  viewExtent.current.end = Math.max(viewExtent.current.end, requiredEnd);
  const fitTimeline = () => {
    const element = surface.current;
    if (!element || element.clientWidth <= 160) return;
    viewExtent.current.end = requiredEnd;
    setZoom(Math.max(.001, Math.min(240, (element.clientWidth - 160) / requiredEnd)));
    element.scrollLeft = 0;
  };
  const fitCurrentTimeline = useRef(fitTimeline); fitCurrentTimeline.current = fitTimeline;
  useLayoutEffect(() => { fitCurrentTimeline.current(); }, [graph.id, model.reason, !!composition]);
  useEffect(() => {
    const element = surface.current;
    if (!autoFit || !element) return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      // Editing properties often changes height; only an actual width resize fits.
      if (element.clientWidth === width) return;
      width = element.clientWidth; fitCurrentTimeline.current();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [autoFit, graph.id, model.reason, !!composition]);
  const scrubKey = (event: import('react').KeyboardEvent) => { if (event.code === 'Space') { event.preventDefault(); event.stopPropagation(); if (!event.repeat) onTogglePlayback?.(); } };
  const scrubEvents = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId); pointer.current = { x: event.clientX, y: event.clientY, shift: event.shiftKey }; setScrubbing(true); onSeek(fromPointer(event.clientX)); },
    onPointerMove: (event: PointerEvent<HTMLElement>) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; pointer.current = { x: event.clientX, y: event.clientY, shift: event.shiftKey }; onSeek(fromPointer(event.clientX)); },
    onPointerUp: (event: PointerEvent<HTMLElement>) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) { onSeek(fromPointer(event.clientX)); event.currentTarget.releasePointerCapture(event.pointerId); } setScrubbing(false); },
    onPointerCancel: () => setScrubbing(false),
  };
  if (composition?.graphId === graph.id) return <CompositionWorkspace key={graph.id + '/' + composition.nodeId} project={project} graph={graph} nodeId={composition.nodeId} groupId={composition.groupId} initialSelection={composition.selectedId} commit={commit} assetUrl={assetUrl} time={time} onSeek={onSeek} preview={preview} onPreviewProject={onPreviewProject} onNotice={onNotice} onActiveSelection={onActiveSelection}
    onNavigate={(groupId, selectedId) => setComposition({ ...composition, groupId, selectedId })}
    onExit={() => { setComposition(undefined); selectRoot(composition.nodeId); }}
    onOpenResource={id => onOpenTimeline?.(id)} />;
  if (model.reason) return <div className="performance-empty"><p>{model.reason}</p><button onClick={onBlueprint}><Workflow size={14} />打开蓝图</button></div>;
  const end = viewExtent.current.end;
  const tickBase = Math.pow(10, Math.floor(Math.log10(Math.max(1, 60 / zoom))));
  const tickStep = [1, 2, 5, 10].map(value => value * tickBase).find(value => value * zoom >= 60) ?? tickBase * 10;
  const toolbar = <div className="timeline-toolbar">
      <div className="timeline-tool-group" role="group" aria-label="添加内容">
      <TimelineCreateMenu onCreate={content => content === 'video' ? void addVideo(project.assets.find(asset => asset.kind === 'video')?.id, time) : addVisual(content, content === 'image' ? project.assets.find(asset => asset.kind === 'image')?.id : undefined)} onAudio={() => void addAudio(project.assets.find(asset => asset.kind === 'audio')?.id, time)} onCommand={add} />
      <button className="small-button" onClick={() => run('添加演出轨道', (draft, target) => arrangePerformanceTimeline(draft, target, model.clips, [...model.tracks, { id: makeId('track'), name: '轨道 ' + (model.tracks.length + 1) }]))}><Plus size={14} />轨道</button>
      </div><div className="timeline-tool-group" role="group" aria-label="编辑辅助">
      <label><input type="checkbox" aria-label="时间轴吸附" checked={snapping} onChange={event => setSnapping(event.target.checked)} />吸附</label>
      <label title="辅助查看旧角色指令及组合子元素的显示区间"><input type="checkbox" aria-label="显示实例生命周期" checked={showLifetimes} onChange={event => setShowLifetimes(event.target.checked)} />显示区间</label>
      {!!selectedIds.length && <button className="small-button" onClick={makeGroup}>制作组合{selectedIds.length > 1 ? `（${selectedIds.length}）` : ''}</button>}
      {(hiddenTracks.length > 0 || soloTracks.length > 0) && <button className="small-button" onClick={() => { setHiddenTracks([]); setSoloTracks([]); }}>恢复全部预览</button>}
      </div><div className="timeline-tool-group timeline-view-tools" role="group" aria-label="时间轴视图"><output className="timeline-time" aria-label="当前时间">{time.toFixed(2)} 秒</output><output className="timeline-until" aria-label="时间轴完成时间" title="按所有轨道中最晚片段的结束时间自动完成">完成 {model.until.toFixed(2)} 秒</output><button className="small-button" aria-pressed={autoFit} onClick={() => { setAutoFit(true); fitTimeline(); }}>适合窗口</button><label>缩放<select aria-label="轨道缩放" value={[40, 60, 100, 160, 240].includes(zoom) ? zoom : 'custom'} onChange={event => changeZoom(Number(event.target.value))}>{![40, 60, 100, 160, 240].includes(zoom) && <option value="custom">{zoom < 1 ? zoom.toPrecision(2) : Math.round(zoom)}%</option>}{[40, 60, 100, 160, 240].map(value => <option key={value} value={value}>{value}%</option>)}</select></label></div>
    </div>;
    const publicInputs = parameters ? <div id="timeline-component-properties" className="timeline-public-inputs" role="tabpanel" aria-label="时间轴组件属性">
      <div className="timeline-call-names">
        <BlueprintNameField project={project} graph={graph} mode="name" commit={commit} message={onNotice} />

      </div>
      <div className="timeline-duration-summary" aria-label="时间轴完成时间"><div><span>组件结束</span><output>{model.until.toFixed(2)} 秒</output></div><p>按所有轨道片段的最晚结束时间自动完成；修改片段收尾后会即时更新。</p></div>
      <p className="timeline-editing-hint">上方轨道显示在下方轨道前面。同一轨道的片段不能重叠。</p>
      <h4>调用参数</h4><p className="muted">在蓝图调用这段时间轴时，可替换这些内容。</p>
      {!!graph.exposedInputs.length && <div className="timeline-parameter-head"><span>参数名称</span><span>默认内容</span><span /></div>}
      {graph.exposedInputs.length ? graph.exposedInputs.map(pin => <div key={pin.id} className="timeline-public-parameter"><input aria-label={'参数名称 ' + pin.name} value={pin.name} onChange={event => run('参数名称', (_, graph) => { graph.exposedInputs.find(item => item.id === pin.id)!.name = event.target.value; })} /><div className="timeline-parameter-default"><BlueprintParameterValue project={project} graph={graph} pin={pin} value={pin.defaultValue ?? ''} assetUrl={assetUrl} onChange={value => setInputDefault(pin.id, value)} /></div><button className="small-button danger-text" title={'移除参数 ' + pin.name} aria-label={'移除参数 ' + pin.name} onClick={() => run('取消时间轴参数', (_, target) => {
        const inputs = target.nodes.filter(n => n.type === 'getInput' && n.properties.inputId === pin.id).map(n => n.id);
        const links = target.links.filter(l => inputs.includes(l.fromNodeId));
        for (const link of links) useTimelineDefault(target, link.toNodeId, link.toPinId);
        target.nodes = target.nodes.filter(n => !inputs.includes(n.id)); target.exposedInputs = target.exposedInputs.filter(p => p.id !== pin.id);
      })}><Trash2 size={15} /></button></div>) : <p>选中片段，展开“调用参数”并点击“设为参数”，即可在调用时替换图片、文字或声音。</p>}
    </div> : null;
    const tracks = <div className="timeline-scroll" ref={surface} tabIndex={0} aria-label="时间轴画布" data-zoom={zoom}
      onScroll={event => { if (autoFit && event.currentTarget.scrollLeft > 0) setAutoFit(false); }}
      onDragOver={event => { if (['application/vns-asset', 'application/vns-character', 'application/vns-timeline-action', 'application/vnd.vns-composition-object', 'application/vns-blueprint', 'application/vns-timeline'].some(type => event.dataTransfer.types.includes(type))) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
      onDrop={event => {
        const trackId = (event.target as Element).closest<HTMLElement>('[data-track-id]')?.dataset.trackId ?? Array.from(surface.current?.querySelectorAll<HTMLElement>('[data-track-id]') ?? []).find(row => { const bounds = row.getBoundingClientRect(); return event.clientY >= bounds.top && event.clientY < bounds.bottom; })?.dataset.trackId;
        const at = snap(fromPointer(event.clientX));
        const asset = project.assets.find(asset => asset.id === event.dataTransfer.getData('application/vns-asset'));
        const character = project.characters.find(character => character.id === event.dataTransfer.getData('application/vns-character'));
        const type = timelineNodeTypes.find(type => type === event.dataTransfer.getData('application/vns-timeline-action'));
        const content = event.dataTransfer.getData('application/vnd.vns-composition-object');
        const resourceId = (event.dataTransfer.getData('application/vns-blueprint') || event.dataTransfer.getData('application/vns-timeline'));
        if (asset && (asset.kind === 'image' || asset.kind === 'audio' || asset.kind === 'video')) { event.preventDefault(); add(asset.kind === 'image' ? 'image' : asset.kind === 'video' ? 'video' : 'audio', asset.id, at, trackId); }
        else if (character) { event.preventDefault(); add('showCharacter', undefined, at, trackId, character.id); }
        else if (type) { event.preventDefault(); add(type, undefined, at, trackId); }
        else if (projectGraphs(project).some(item => item.id === resourceId && (item.visualComposition || item.compositionContainer || item.timeline))) { event.preventDefault(); addResource(resourceId, at, trackId); }
        else if (['image', 'video', 'text', 'solid', 'group', 'particles'].includes(content)) { event.preventDefault(); if (content === 'video') void addVideo(project.assets.find(asset => asset.kind === 'video')?.id, at, trackId); else addVisual(content as 'image' | 'text' | 'particles' | 'solid' | 'group', content === 'image' ? project.assets.find(asset => asset.kind === 'image')?.id : undefined, at, trackId); }
      }}
      onPointerDownCapture={event => { if (event.button !== 1 && !(event.button === 0 && space.current)) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true }); pan.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMoveCapture={event => { if (!pan.current) return; event.stopPropagation(); event.currentTarget.scrollLeft = pan.current.left + pan.current.x - event.clientX; event.currentTarget.scrollTop = pan.current.top + pan.current.y - event.clientY; }}
      onPointerUpCapture={event => { if (pan.current) { pan.current = undefined; event.stopPropagation(); event.currentTarget.releasePointerCapture(event.pointerId); } }} onPointerCancel={() => { pan.current = undefined; }}>
      <div className="timeline-grid" style={{ width: Math.max(320, 130 + end * zoom), '--timeline-second': zoom * tickStep + 'px' } as CSSProperties}>
        <div className="timeline-ruler" tabIndex={0} onKeyDown={scrubKey} aria-label="时间标尺" {...scrubEvents}><span>秒</span>{Array.from({ length: Math.min(1000, Math.floor(end / tickStep) + 1) }, (_, index) => <i key={index} style={{ left: 130 + index * tickStep * zoom }}>{index * tickStep}</i>)}</div>
        {displayedTracks.map((track, trackIndex) => <div className={'timeline-track' + (trackDrag?.id === track.id ? ' dragging-track' : '') + (!trackVisible(track.id) ? ' preview-hidden' : '')} key={track.id} data-track-id={track.id} onContextMenu={event => { event.preventDefault(); setContext({ x: event.clientX, y: event.clientY, trackId: track.id }); }} onDoubleClick={event => { if (event.target === event.currentTarget) onSeek(snap(fromPointer(event.clientX))); }}>
          <div className="timeline-track-name"><button type="button" className="timeline-track-grip" aria-label={'拖动轨道 ' + track.name} title="拖动调整前后顺序" onPointerDown={event => {
            if (event.button !== 0) return; event.preventDefault();
            trackDragRef.current = { id: track.id, index: trackIndex }; setTrackDrag(trackDragRef.current);
          }}><GripVertical size={14} /></button><input aria-label={'轨道名称 ' + track.name} title={track.name} value={track.name} onChange={event => run('轨道名称', (draft, graph) => arrangePerformanceTimeline(draft, graph, model.clips, model.tracks.map(item => item.id === track.id ? { ...item, name: event.target.value || '轨道' } : item)))} /><TrackPreviewControls name={track.name} hidden={hiddenTracks.includes(track.id)} solo={soloTracks.includes(track.id)} onHidden={() => setHiddenTracks(items => items.includes(track.id) ? items.filter(id => id !== track.id) : [...items, track.id])} onSolo={() => setSoloTracks(items => items.includes(track.id) ? items.filter(id => id !== track.id) : [...items, track.id])} /><span className="timeline-track-order"><button aria-label={'上移轨道 ' + track.name} title="上移：显示在前面" disabled={track.id === model.tracks[0]?.id} onClick={() => moveTrack(track.id, -1)}><ArrowUp size={12} /></button><button aria-label={'下移轨道 ' + track.name} title="下移：显示在后面" disabled={track.id === model.tracks.at(-1)?.id} onClick={() => moveTrack(track.id, 1)}><ArrowDown size={12} /></button></span></div>
          {model.clips.filter(clip => clip.trackId === track.id).map(clip => {
            const item = graph.nodes.find(node => node.id === clip.nodeId)!;
            const actual = drag?.id === clip.nodeId && position ? { ...clip, ...position } : clip;
            const animation = model.actionsByNode.get(item.id)?.find(a=>a.kind==='visual'||a.kind==='audioClip'||a.kind==='animate'||a.kind==='show'||a.kind==='background') ?? savedBlueprintAction(item);
            const clipTitle = item.type === 'callFunction' ? projectGraphs(project).find(graph => graph.id === item.properties.graphId)?.name ?? item.name : animation?.kind === 'visual' || animation?.kind === 'audioClip' ? animation.name : animation?.kind === 'show' ? `${effectiveCharacter(project, animation.characterId)?.name ?? '角色'} · ${effectiveCharacter(project, animation.characterId)?.expressions.find(expression => expression.id === animation.expressionId)?.name ?? '表情'}` : animation?.kind === 'background' ? '背景 · ' + (project.assets.find(asset => asset.id === animation.assetId)?.name ?? item.name) : item.name;
            const thumbnailAssetId = animation?.kind === 'visual' && animation.content === 'image' || animation?.kind === 'background' ? animation.assetId : animation?.kind === 'show' ? effectiveCharacter(project, animation.characterId)?.expressions.find(expression => expression.id === animation.expressionId)?.assetId : undefined;
             const videoAssetId = animation?.kind === 'visual' && animation.content === 'video' ? animation.assetId : undefined;
            const audio = animation?.kind === 'audioClip' ? animation : undefined;
            const audioAssetId = audio?.assetId;
            const thumbnailSource = thumbnailAssetId ? assetUrl(thumbnailAssetId) : undefined;
            const keyframeTimes = animation?.kind === 'visual' ? visualKeyframeTimes(animation) : animation?.kind === 'animate' ? (() => { let at = 0; return animation.keyframes.map(frame => at += frame.duration); })() : [];
            const mediaClass = animation?.kind === 'audioClip' ? 'timeline-audio-clip ' : animation?.kind === 'visual' && animation.content === 'video' ? 'timeline-video-clip ' : '';
            return <div key={clip.nodeId} className={'timeline-clip ' + mediaClass + (selectedIds.includes(clip.nodeId) ? 'selected' : '')} role="button" tabIndex={0} title={clipTitle + ' · ' + actual.at.toFixed(2) + '–' + (actual.at + actual.duration).toFixed(2) + ' 秒'} aria-label={clipTitle + '，开始 ' + actual.at.toFixed(2) + ' 秒'} aria-pressed={selectedIds.includes(clip.nodeId)} data-node-id={clip.nodeId} data-start={actual.at} data-duration={actual.duration} style={{ left: 130 + actual.at * zoom, width: actual.duration > 0 ? Math.max(1, actual.duration * zoom - 2) : 12, paddingInline: actual.duration * zoom < 35 ? 0 : undefined, transform: 'translateY(' + (model.tracks.findIndex(track => track.id === actual.trackId) - model.tracks.findIndex(track => track.id === clip.trackId)) * 54 + 'px)', zIndex: drag?.id === clip.nodeId ? 5 : undefined }}
              onKeyDown={event => { if (event.key === 'Delete') { event.preventDefault(); arrange(model.clips.filter(c => c.nodeId !== clip.nodeId)); } if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); arrange(model.clips.map(c => c.nodeId === clip.nodeId ? { ...c, at: snap(c.at + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : .1)) } : c)); } if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (event.key === 'Enter') void openClipEditor(item); else selectRoot(clip.nodeId); } }}
              data-multiselected={selectedIds.includes(clip.nodeId)}
              onDoubleClick={event => { event.stopPropagation(); void openClipEditor(item); }}
              onContextMenu={event => { event.preventDefault(); event.stopPropagation(); if (!selectedIds.includes(clip.nodeId)) selectRoot(clip.nodeId); setParameters(false); setContext({ x: event.clientX, y: event.clientY, trackId: track.id, nodeId: clip.nodeId }); }}
               onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); setContext(undefined); if (event.ctrlKey || event.metaKey || event.shiftKey) { selectMultiple(clip.nodeId); return; } selectRoot(clip.nodeId); setParameters(false); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId); pointer.current = { x: event.clientX, y: event.clientY, shift: event.shiftKey }; const target = event.target as Element; const media = animation?.kind === 'audioClip' ? animation : animation?.kind === 'visual' && animation.content === 'video' ? animation : undefined; const mode: TimelineDragMode = target.classList.contains('timeline-resize-left') ? 'left' : target.classList.contains('timeline-resize-right') ? 'right' : target.classList.contains('timeline-fade-in') ? 'fadeIn' : target.classList.contains('timeline-fade-out') ? 'fadeOut' : 'move'; const offset = media?.kind === 'audioClip' ? media.offset : media?.mediaOffset; const initial = { at: clip.at, duration: clip.duration, trackId: clip.trackId, offset, fadeIn: media?.fadeIn, fadeOut: media?.fadeOut }; dragRef.current = { id: clip.nodeId, x: event.clientX, y: event.clientY, scrollLeft: surface.current?.scrollLeft ?? 0, scrollTop: surface.current?.scrollTop ?? 0, ...initial, mode, sourceDuration: media?.sourceDuration }; positionRef.current = initial; setDrag(dragRef.current); setPosition(positionRef.current); }}
              onPointerMove={event => { if (dragRef.current?.id !== clip.nodeId) return; pointer.current = { x: event.clientX, y: event.clientY, shift: event.shiftKey }; updateDrag(); }}
               onPointerUp={event => { const current = dragRef.current; if (current?.id === clip.nodeId) { pointer.current = { x: event.clientX, y: event.clientY, shift: event.shiftKey }; updateDrag(); const next = positionRef.current!; const clips = model.clips.map(item => item.nodeId === clip.nodeId ? { ...item, at: next.at, duration: next.duration, trackId: next.trackId } : item); if (current.mode === 'move' && (next.at !== clip.at || next.trackId !== clip.trackId)) arrange(clips); else if (current.mode === 'left' || current.mode === 'right') resize(next.duration, clips, clip.nodeId, { offset: next.offset }); else if (current.mode === 'fadeIn' || current.mode === 'fadeOut') { const key = current.mode; editNode((target, _, targetGraph) => patchMediaFade(targetGraph, target, key, next[key] ?? 0)); } } dragRef.current = undefined; positionRef.current = undefined; setDrag(undefined); setPosition(undefined); }}
              onPointerCancel={() => { dragRef.current = undefined; positionRef.current = undefined; setDrag(undefined); setPosition(undefined); }}>
              {audioAssetId && <AudioWaveform url={assetUrl(audioAssetId)} offset={drag?.id === clip.nodeId ? position?.offset ?? audio.offset : audio.offset} duration={actual.duration} start={actual.at} />}
              {audioAssetId && actual.duration * zoom > 55 && <Music2 className="timeline-audio-icon" size={14} />}
               {videoAssetId && <video className="timeline-clip-filmstrip" src={assetUrl(videoAssetId)} muted autoPlay loop playsInline preload="auto" />} 
              {thumbnailSource && <span className="timeline-clip-thumbnails" aria-hidden="true" data-thumbnail-asset={thumbnailAssetId} style={{ backgroundImage: `url(${JSON.stringify(thumbnailSource)})` }} />}
               <span>{clipTitle}</span><small>{actual.duration ? actual.duration.toFixed(2) + 's' : '触发'}</small>{(() => {
                const media = animation?.kind === 'audioClip' || animation?.kind === 'visual' && animation.content === 'video';
                const fadeIn = Math.min(actual.duration, (drag?.id === clip.nodeId ? position?.fadeIn : undefined) ?? (media ? animation.fadeIn ?? 0 : 0));
                const fadeOut = Math.min(actual.duration, (drag?.id === clip.nodeId ? position?.fadeOut : undefined) ?? (media ? animation.fadeOut ?? 0 : 0));
                return !['playSound', 'callFunction'].includes(item.type) && <><i className={'timeline-resize timeline-resize-right' + (media ? ' media-edge' : '')} title="拖动调整出点" />{media && <i className="timeline-resize timeline-resize-left" title="拖动调整入点" />}{media && actual.duration * zoom > 80 && <>
                  {fadeIn > 0 && <span className="timeline-fade-region" aria-hidden="true" style={{ width: fadeIn * zoom, clipPath: 'polygon(0 0, 100% 0, 0 100%)' }} />}
                  {fadeOut > 0 && <span className="timeline-fade-region" aria-hidden="true" style={{ right: 0, left: 'auto', width: fadeOut * zoom, clipPath: 'polygon(0 0, 100% 0, 100% 100%)' }} />}
                  {(['fadeIn', 'fadeOut'] as const).map(key => {
                    const value = key === 'fadeIn' ? fadeIn : fadeOut;
                    return <i key={key} className={'timeline-fade-handle ' + (key === 'fadeIn' ? 'timeline-fade-in' : 'timeline-fade-out')} role="slider" tabIndex={0} aria-label={clipTitle + (key === 'fadeIn' ? '淡入' : '淡出')} aria-valuemin={0} aria-valuemax={actual.duration} aria-valuenow={Number(value.toFixed(3))} aria-valuetext={value.toFixed(2) + ' 秒'} style={{ [key === 'fadeIn' ? 'left' : 'right']: `clamp(12px, ${value * zoom}px, calc(100% - 12px))` }} title={(key === 'fadeIn' ? '淡入 ' : '淡出 ') + value.toFixed(2) + ' 秒'} onKeyDown={event => {
                      event.stopPropagation();
                      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                      event.preventDefault();
                      const direction = (event.key === 'ArrowRight' ? 1 : -1) * (key === 'fadeIn' ? 1 : -1);
                      const next = event.key === 'Home' ? 0 : event.key === 'End' ? actual.duration : Math.max(0, Math.min(actual.duration, value + direction * (event.shiftKey ? 1 : .1)));
                      editNode((target, _, targetGraph) => patchMediaFade(targetGraph, target, key, next), clip.nodeId);
                    }} />;
                  })}
                </>}</>;
              })()}
              {keyframeTimes.map((frameAt, index) => {
                const offset = clip.duration ? frameAt * actual.duration / clip.duration : 0;
                return <button key={index} className="timeline-keyframe-marker" aria-label={'定位关键帧 ' + (index + 1)} title={'关键帧 ' + (index + 1) + ' · ' + (actual.at + offset).toFixed(2) + ' 秒'} style={{ left: offset * zoom }} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); selectRoot(item.id); setParameters(false); onSeek(actual.at + offset); }}>◆</button>;
              })}
            </div>;
          })}
        </div>)}
        {showLifetimes && lifetimes.map((row, index) => <div className="timeline-track lifetime-track" key={`${row.nodeId}-${index}`} aria-label={`实例生命周期 ${row.name}`}>
          <button type="button" className="lifetime-label" title={row.name + ' · 点击详细编辑'} aria-label={'详细编辑 ' + row.name} style={{ paddingLeft: 6 + (row.depth ?? 0) * 10 }} onClick={() => openDetails(row.nodeId, row.objectPath?.length ? row.instanceId : undefined)}>{row.depth ? '↳ ' : row.kind === 'actor' ? '角色 · ' : '对象 · '}{row.name}</button>
          <LifetimeSpan row={row} zoom={zoom} onSelect={() => selectObject(row.nodeId, row.objectPath?.length ? row.instanceId : undefined)} onOpen={() => openComposition(row.nodeId, row.objectPath?.length ? row.instanceId : undefined)} onEdit={row.objectPath?.length && !graph.links.some(link => link.toNodeId === row.nodeId && link.toPinId.startsWith('object_')) ? (delta, resizing) => run('调整子对象显示区间', (draft, target) => {
            editTimelineVisualLifetime(draft, target, row.nodeId, row.instanceId, delta, resizing);
          }) : row.kind === 'visual' && !row.objectPath?.length ? (delta, resizing) => {
            const duration = Math.max(.05, row.until - row.at + delta);
            const clips = model.clips.map(clip => clip.nodeId === row.nodeId ? { ...clip, ...(resizing ? { duration } : { at: Math.max(0, clip.at + delta) }) } : clip);
            if (resizing) resize(duration, clips, row.nodeId); else arrange(clips);
          } : row.kind === 'actor' ? (delta, resizing) => {
            if (resizing) run('调整角色结束时间', (draft, target) => { setTimelineActorEnd(draft, target, row.nodeId, Math.max(row.at, row.until + delta)); });
            else run('移动角色生命周期', (draft, target) => { moveTimelineActorLifetime(draft, target, row.nodeId, Math.max(0, row.at + delta)); });
          } : undefined} />
        </div>)}
        {propertyTargets.flatMap(target => Object.entries(target.resolved.action.curves ?? {}).map(([key, frames]) => frames?.length ? <div key={`${propertyKey(target.identity)}/${key}`} data-property-owner={propertyKey(target.identity)} className="timeline-track property-curve-track" aria-label={`属性轨道 ${visualCurveFields[key as VisualCurveProperty][0]}`}>
          <span className="lifetime-label" title={`${target.name} · ${visualCurveFields[key as VisualCurveProperty][0]}`}>{target.name} · {visualCurveFields[key as VisualCurveProperty][0]}</span>
          <PropertyFrameTimeline frames={frames} duration={target.clip.duration} label={visualCurveFields[key as VisualCurveProperty][0]} start={target.resolved.at} zoom={zoom} onSeek={onSeek} onChange={frames => editNode(source => {
            const action = actionSchema.parse(JSON.parse(String(source.properties.action)));
            if (action.kind !== 'visual' && action.kind !== 'animate') return;
            if (action.kind === 'visual') {
              let object = action; for (const index of target.path) object = object.children![index];
              object.curves = { ...object.curves };
              if (frames.length) object.curves[key as VisualCurveProperty] = frames.map(frame => ({ ...frame, at: frame.at / target.resolved.scale, value: key === 'rippleSpeed' ? frame.value * target.resolved.scale : frame.value }));
              else delete object.curves[key as VisualCurveProperty];
            } else { action.curves = { ...action.curves }; if (frames.length) action.curves[key as keyof typeof action.curves] = frames; else delete action.curves[key as keyof typeof action.curves]; }
            source.properties.action = JSON.stringify(action);
          }, target.identity.nodeId)} />
        </div> : null))}
        {entranceTargets.map(target => <div key={propertyKey(target.identity) + '/entrance/' + target.key} data-property-owner={propertyKey(target.identity)} className="timeline-track property-curve-track entrance-offset-track" aria-label={'入场偏移轨道 ' + entranceOffsetFields[target.key][0]}>
          <span className="lifetime-label" title={target.source.name + ' · ' + entranceOffsetFields[target.key][0]}>{target.source.name} · {entranceOffsetFields[target.key][0]}</span>
          <PropertyFrameTimeline frames={target.frames} duration={target.clip.entranceDuration ?? target.clip.duration} label={entranceOffsetFields[target.key][0]} start={target.clip.at} zoom={zoom} onSeek={onSeek} onChange={frames => editNode(source => setMoveOffsetTimelineFrames(source, target.key, target.clip.entranceDuration ?? target.clip.duration, frames), target.identity.nodeId)} />
        </div>)}
        {afterTargets.map(target=><div key={propertyKey(target.identity)+'/after/'+target.key} data-property-owner={propertyKey(target.identity)} className="timeline-track property-curve-track after-offset-track" aria-label={'入场后轨道 '+entranceOffsetFields[target.key][0]}>
          <span className="lifetime-label">{target.source.name} · 入场后{entranceOffsetFields[target.key][0]}</span>
          <PropertyFrameTimeline frames={target.frames} duration={afterOffsetDuration(nodeAfterOffsets(target.source))} label={'入场后'+entranceOffsetFields[target.key][0]} start={target.clip.at+(target.clip.entranceDuration ?? target.clip.duration)} zoom={zoom} onSeek={onSeek} onChange={frames=>editNode(source=>{const moved=frames.findIndex((frame,i)=>frame.at!==target.frames[i].at);setAfterOffsetCurve(source,target.key,moved<0?frames:[...frames.filter((_,i)=>i!==moved),frames[moved]]);},target.identity.nodeId)} />
        </div>)}
        <div className="timeline-playhead" style={{ left: 130 + time * zoom }} role="slider" tabIndex={0} aria-label="时间轴播放头" aria-valuemin={0} aria-valuemax={end} aria-valuenow={Number(time.toFixed(3))} {...scrubEvents} onKeyDown={event => { scrubKey(event); if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); onSeek(event.key === 'Home' ? 0 : event.key === 'End' ? model.until : Math.max(0, time + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : .05))); } }}><span className="timeline-playhead-grip" aria-hidden="true" /></div>
      </div>
    </div>;
    const inspector = <>{context && createPortal(<div className="timeline-context-menu" role="menu" aria-label={context.nodeId ? '片段右键菜单' : '轨道右键菜单'} style={{ position: 'fixed', left: Math.min(context.x, window.innerWidth - 240), top: Math.min(context.y, window.innerHeight - 160) }} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')); const index = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); } }}>
      {context.nodeId ? <ClipMenuItems onSeek={() => { const target = model.clips.find(c => c.nodeId === context.nodeId); if (target) onSeek(target.at); setContext(undefined); }} onProperties={() => openDetails(context.nodeId!)} onDuplicate={duplicate} onGroup={makeGroup} onEnter={node && (editedObject?.content === 'group' || timelineForNode(project, node)) ? () => { void openClipEditor(node); setContext(undefined); } : undefined} onSave={editedObject?.content === 'group' ? saveGroup : undefined} onRemove={() => { remove(); setContext(undefined); }} /> : <>
        <button role="menuitem" autoFocus onClick={() => { const input = Array.from(surface.current?.querySelectorAll<HTMLInputElement>('.timeline-track-name input') ?? []).find(input => input.closest<HTMLElement>('[data-track-id]')?.dataset.trackId === context.trackId); setContext(undefined); input?.focus(); input?.select(); }}>重命名轨道</button>
        <button role="menuitem" disabled={!model.clips.some(c => c.trackId === context.trackId)} onClick={() => { if (arrange(model.clips.filter(c => c.trackId !== context.trackId))) selectRoot(undefined); setContext(undefined); }}>清空轨道片段</button>
        <button role="menuitem" disabled={model.tracks.length <= 1} className="danger-text" onClick={() => { if (run('删除轨道及片段', (draft, target) => arrangePerformanceTimeline(draft, target, model.clips.filter(c => c.trackId !== context.trackId), model.tracks.filter(t => t.id !== context.trackId)))) selectRoot(undefined); setContext(undefined); }}>删除轨道及其片段</button>
      </>}
    </div>, document.body)}<div className="timeline-inspector-tabs" role="tablist" aria-label="属性面板类型"><button type="button" role="tab" aria-selected={parameters} aria-controls="timeline-component-properties" onClick={() => setParameters(true)}>时间轴组件</button><button type="button" role="tab" aria-selected={!parameters} aria-controls="timeline-clip-properties" onClick={() => setParameters(false)}>片段</button></div>{publicInputs}
     {node && clip && !parameters && <section id="timeline-clip-properties" ref={inspectorElement} tabIndex={-1} className="timeline-inspector" role="tabpanel" aria-label="演出片段参数">
      <header><strong>{editedObject?.name ?? (isNested ? '子对象不可用' : node.name)}</strong><div className="spacer" />{!isNested && <button className="icon-button danger-text" aria-label="删除片段" title="删除片段" onClick={remove}><Trash2 size={15} /></button>}</header>
      {propertyIdentity && (Object.keys(propertyAction?.curves ?? {}).length > 0 || entranceSelected) && <button aria-pressed={pinnedProperties.some(item => propertyKey(item) === propertyKey(propertyIdentity))} onClick={() => setPinnedProperties(items => items.some(item => propertyKey(item) === propertyKey(propertyIdentity)) ? items.filter(item => propertyKey(item) !== propertyKey(propertyIdentity)) : [...items, propertyIdentity])}>保留属性轨道</button>}
      {!!pinnedProperties.length && <button onClick={() => setPinnedProperties([])}>取消保留所有属性轨道</button>}
      {!isNested && <div className="field-row"><label>开始（秒）<NumberInput aria-label="片段开始秒数" value={clip.at} step={.05} onChange={event => arrange(model.clips.map(item => item.nodeId === node.id ? { ...item, at: Number(event.target.value) } : item))} /></label><label>轨道<select aria-label="片段所在轨道" value={clip.trackId} onChange={event => arrange(model.clips.map(item => item.nodeId === node.id ? { ...item, trackId: event.target.value } : item))}>{model.tracks.map(track => <option key={track.id} value={track.id}>{track.name}</option>)}</select></label></div>}
      {node.type === 'showCharacter' && <button className="small-button" onClick={() => { const added = run('添加实例关键帧', (draft, target) => addTimelineActorAnimation(draft, target, node.id)); if (added) selectRoot(added.value); }}>添加实例关键帧</button>}
      {(node.type === 'showChapter' || timelineForNode(project, node)) && <button className="small-button" disabled={generatingChapter} onClick={() => void openClipEditor(node)}>编辑内部时间轴</button>}
      {selectedAction?.kind === "show" && <ActionEditor project={project} action={selectedAction} entranceOffsets={false} onChange={action => editNode(target => { target.properties.action = JSON.stringify(action); })} />}
      {!isNested && <EntranceOffsetsEditor node={node} edit={editNode} start={clip.at} duration={clip.entranceDuration ?? clip.duration} onSeek={onSeek} />}
      {resolvedAudio && <TimelineAudioClipEditor key={node.id} project={project} clip={resolvedAudio} assetUrl={assetUrl} linked={new Set(graph.links.filter(l => l.toNodeId === node.id).map(l => l.toPinId))} onChange={patch => editNode((target,draft,targetGraph) => {
        patchAudioClipNode(target,patch);
        const resolved = timelineNodeActions(draft,targetGraph,target).find(a=>a.kind==='audioClip');
        if (resolved && !targetGraph.links.some(l=>l.toNodeId===target.id&&l.toPinId==='clip_duration')) {
          const duration = trimTimelineClip({ ...clip, duration: resolved.duration }, model.clips).duration;
          if (duration < resolved.duration) patchAudioClipNode(target,{duration});
        }
      })} />}
      {selectedAction?.kind === 'animate' && <TimelineKeyframes action={selectedAction} start={clip.at} onSeek={onSeek} onChange={action => editNode(node => { node.properties.action = JSON.stringify(action); })} />}
      {isNested && <div className="field-row"><strong>子对象：{editedObject?.name ?? '已移除或标识重复'}</strong><button onClick={() => openDetails(node.id)}>返回外层组合</button></div>}
      {editedObject && !isNested && <>
        <label className="timeline-clip-name">片段名称<input aria-label="片段名称" value={editedObject.name} onChange={event => editNode(target=>patchVisualClipNode(target,{name:event.target.value}))} /></label>
        <label className="timeline-clip-duration">显示时长（秒）<NumberInput aria-label="片段显示时长" min={.05} step={.1} value={clip.duration} onChange={event => { const next = trimTimelineClip({ ...clip, duration: Math.max(.05, Number(event.target.value)) }, model.clips); resize(next.duration, model.clips.map(item => item.nodeId === node.id ? next : item)); }} /></label>
      </>}
      {visualView && <VisualClipInspector key={node.id + '/' + visualView.object.instanceId} project={project} graph={graph} view={visualView} assetUrl={assetUrl} time={time} onSeek={onSeek}
        onChange={patch => run('编辑片段属性', (draft, target) => patchCompositionObject(draft, target, node.id, visualView.object.instanceId, patch))}
        onPose={(key, value) => run('编辑画面变换', (draft, target) => setCompositionPose(draft, target, node.id, visualView.object.instanceId, time, { [key]: value }))}
        onKeyframe={key => run('切换属性关键帧', (draft, target) => toggleCompositionKeyframe(draft, target, node.id, visualView.object.instanceId, time, key))}
        onEffects={next => run('编辑片段动画与效果', (draft, target) => editCompositionEffects(draft, target, node.id, visualView.object.instanceId, next))}
        onParameterValue={(field, value) => run('编辑片段参数', (draft, target) => setCompositionField(draft, target, node.id, visualView.object.instanceId, field.path, value))}
        onExpose={(field, existingId) => run('公开片段参数', (draft, target) => { if (visualView.path.length) { exposeCompositionProperty(draft, target, node.id, visualView.trail.at(-2)!.instanceId, visualView.object.instanceId, field.path, field.name, field.type as 'number' | 'string' | 'boolean' | 'asset', field.value, existingId); } else { const input = performanceInputs(target).find(input => input.nodeId === node.id && input.pinId === 'object_' + field.key)!; let name = field.name, index = 2; while (target.exposedInputs.some(pin => pin.name === name)) name = field.name + ' ' + index++; exposePerformanceInputs(target, [{ ...input, name }]); } })}
        onRemoveParameter={id => run('移除组合参数', (draft, target) => removeCompositionParameter(draft, target, node.id, visualView.object.instanceId, id))}
        onRenameParameter={(id, name) => run('组合参数名称', (draft, target) => renameCompositionParameter(draft, target, node.id, visualView.object.instanceId, id, name))}
        onOpen={() => visualView.object.compositionId ? onOpenTimeline?.(visualView.object.compositionId) : openComposition(node.id, visualView.object.instanceId)} onSave={saveGroup}
        onResource={() => onOpenTimeline?.(visualView.object.compositionId!)} onDetach={() => run('转为本地组合', (draft, target) => detachCompositionResource(draft, target, node.id, visualView.object.instanceId))}
        onGlyphParticles={() => { const result = run('生成字形粒子', (draft, target) => { const groupedId = groupTimelineSelection(draft, target, [node.id]); const root = rawSavedBlueprintAction(target.nodes.find(item => item.id === groupedId)!) as VisualObject; const id = addCompositionGlyphParticles(draft, target, groupedId, root.instanceId, visualView.object.instanceId); return { groupedId, groupId: root.instanceId, id }; }); if (result) setComposition({ graphId: graph.id, nodeId: result.value.groupedId, groupId: result.value.groupId, selectedId: result.value.id }); }} />}
      {!isNested && !editedObject && <BlueprintNodeFields project={project} graph={graph} node={node} edit={editNode} />}
      {!isNested && !editedObject && <details className="timeline-clip-parameters" open={!!resolvedAudio || !editedObject}><summary>调用参数</summary><p className="muted">公开需要在调用时替换的输入。</p>{node.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec' && !['wait', 'layer'].includes(pin.id)).map(pin => {
        const link = graph.links.find(link => link.toNodeId === node.id && link.toPinId === pin.id);
        const input = graph.nodes.find(item => item.id === link?.fromNodeId), exposed = input?.type === 'getInput' ? graph.exposedInputs.find(pin => pin.id === input.properties.inputId) : undefined;
        return <div key={pin.id} className="timeline-parameter"><span>{pin.name}</span>{exposed ? <BlueprintParameterValue project={project} graph={graph} pin={exposed} value={exposed.defaultValue ?? ''} assetUrl={assetUrl} onChange={value => setInputDefault(exposed.id, value)} /> : link ? <button onClick={onBlueprint}>由蓝图连线控制</button> : <BlueprintInlineValue project={project} graph={graph} node={node} pin={pin} edit={editNode} />}
          <button className={'small-button ' + (pin.dataType === 'asset' ? 'timeline-asset-parameter-button' : '')} disabled={!!link && !exposed} onContextMenu={event => { if (exposed) { event.preventDefault(); setRenamingParameter(exposed.id); } }} title={exposed ? '点击取消参数；右键重命名：' + exposed.name : '把此项作为时间轴组件的输入；调用时可以传入本次需要的素材'} onClick={() => exposed ? run('取消时间轴参数', (_, graph) => useTimelineDefault(graph, node.id, pin.id)) : run('公开演出参数', (_, graph) => {
            const field = performanceInputs(graph).find(field => field.nodeId === node.id && field.pinId === pin.id)!;
            let name = field.name, index = 2; while (graph.exposedInputs.some(pin => pin.name === name)) name = field.name + ' ' + index++;
            exposePerformanceInputs(graph, [{ ...field, name }]);
          })}>{exposed ? exposed.name : pin.dataType === 'asset' ? '设为素材参数' : '设为参数'}</button>{exposed && renamingParameter === exposed.id && <input autoFocus aria-label="重命名时间轴参数" defaultValue={exposed.name} onBlur={event => { const name = event.target.value.trim(); if (name) run('重命名时间轴参数', (_, target) => { target.exposedInputs.find(p => p.id === exposed.id)!.name = name; }); setRenamingParameter(undefined); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.currentTarget.value = exposed.name; event.currentTarget.blur(); } }} />} 
        </div>;
      })}</details>}
    </section>}
    {!node && !parameters && <section id="timeline-clip-properties" role="tabpanel" className="timeline-inspector timeline-help"><strong>{graph.name}</strong><p>未选择片段</p></section>}
  </>;
  const rootNodes = new Map(model.clips.flatMap(clip => (model.actionsByNode.get(clip.nodeId) ?? []).flatMap(action => action.kind === 'visual' ? [[action.instanceId, clip] as const] : [])));
  const hiddenActions = model.clips.filter(clip => !trackVisible(clip.trackId)).flatMap(clip => model.actionsByNode.get(clip.nodeId) ?? []);
  const previewActions = [...model.clips].filter(clip => clip.at <= time).sort((a, b) => a.at - b.at).flatMap(clip => (model.actionsByNode.get(clip.nodeId) ?? []).map(action => ({ action, visible: trackVisible(clip.trackId) })));
  const backgroundTrack = previewActions.filter(item => item.action.kind === 'background').at(-1);
  return preview ? <CompositionEditingContext.Provider value={{
    canSelect: (root, id) => root === id && !!rootNodes.get(root) && rawSavedBlueprintAction(graph.nodes.find(node => node.id === rootNodes.get(root)!.nodeId)!)?.kind === 'visual',
    selected: (root, id) => root === id && selectedIds.includes(rootNodes.get(root)?.nodeId ?? ''),
    select: root => { const clip = rootNodes.get(root); if (clip) selectRoot(clip.nodeId); },
    open: root => { const clip = rootNodes.get(root); if (clip) openComposition(clip.nodeId); },
    move: (root, id, patch) => { const clip = rootNodes.get(root); if (clip) run('拖动画面', (draft, target) => setCompositionPose(draft, target, clip.nodeId, id, time, patch)); },
    transform: (root, id, patch) => { const clip = rootNodes.get(root); if (clip) run('变换画面', (draft, target) => setCompositionPose(draft, target, clip.nodeId, id, time, patch)); },
    visible: root => { const clip = rootNodes.get(root); return clip ? trackVisible(clip.trackId) : !soloTracks.length; },
    isolate: !!soloTracks.length,
    backgroundVisible: backgroundTrack?.visible ?? !soloTracks.length,
    actorVisible: (characterId, instanceId) => previewActions.filter(item => item.action.kind === 'show' && item.action.characterId === characterId && item.action.instanceId === instanceId).at(-1)?.visible ?? !soloTracks.length,
    audioEnabled: (key, assetId) => !hiddenActions.some(action => action.kind === 'audioClip' ? key.startsWith('clip:' + action.instanceId) : (action.kind === 'music' || action.kind === 'sound') && action.assetId === assetId) && (!soloTracks.length || model.clips.filter(clip => trackVisible(clip.trackId)).some(clip => (model.actionsByNode.get(clip.nodeId) ?? []).some(action => action.kind === 'audioClip' ? key.startsWith('clip:' + action.instanceId) : (action.kind === 'music' || action.kind === 'sound') && action.assetId === assetId))),
  }}><PerformanceDock panels={{
    library: <PerformanceLibrary commit={commit} project={project} assetUrl={assetUrl} currentGraphId={graph.id} resourceAdd={addResource} compositionAdd={(content, assetId) => content === 'video' ? void addVideo(assetId ?? project.assets.find(asset => asset.kind === 'video')?.id, time) : addVisual(content, assetId ?? (content === 'image' ? project.assets.find(asset => asset.kind === 'image')?.id : undefined))} add={(type, assetId, characterId) => add(type, assetId, time, undefined, characterId)} />,
    preview: <div className="timeline-preview">{preview}</div>,
    timeline: <>{toolbar}{tracks}</>, inspector,
  }} /></CompositionEditingContext.Provider> : <div className="performance-timeline" aria-label="演出轨道编辑器">{toolbar}{tracks}{inspector}</div>;
}
