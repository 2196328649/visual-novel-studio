import { renderActorLayers } from './ActorLayers';
import { performancePreviewAudio, previewAudioKey, previewClipGain } from '../core/preview-audio';
import { previewAudioAt, previewAudioGain, type PreviewAudioEvent } from '../core/preview-audio';
import { NumberInput } from './NumberInput';
import { NumericEditContext, useLiveParameterEdit } from './NumericEditContext';
import { VisualEditingSurface, VisualObjectPreview } from './VisualObjectPreview';
import { actorKey } from '../core/actor-instance';
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { CompositionEditingContext } from './CompositionEditingContext';
import { Clapperboard, Image, Music2, Play, Pause, Square, Volume2 } from 'lucide-react';
import { effectiveCharacter, type Project, type StageAction, type StoryLine } from '../core/model';
import type { TextSourceLocation } from '../core/text-script';
import { initialPreviewStage, linePlaybackAudio, sampleLinePlayback, linePlaybackPlan, type PreviewCamera, type PreviewSelection } from '../core/line-preview';
import { createLinePreviewReader } from '../core/line-preview-cache';
import { persistentVideoPreviewEnd, persistentVideoSpans } from '../core/preview-video';
import { readVideoDuration } from './audio-metadata';
import { DialoguePreview } from './DialoguePreview';
import { InteractionStage } from './StageEditor';
import { StageTools, useStageEditing } from './StageTools';
import type { Commit } from './editor';
import { ChapterStage, ChapterStageLayer } from './ChapterPreview';
import type { PreviewRouteChoices } from '../core/preview-route';
import { performancePlayback } from '../core/standalone-performance';
import { followingPerformancePreview, performanceTransitionDuration, samplePerformanceTransition } from '../core/performance-preview';
import { PlaybackStage } from './UiStagePreview';

export type TextPreviewSelection = PreviewSelection;
export interface TextPreviewProps {
  project: Project; source: string; sourceMap: TextSourceLocation[]; cursorOffset?: number;
  selection?: TextPreviewSelection; assetUrl: (id?: string) => string | undefined;
  headerActions?: ReactNode; alternateContent?: ReactNode; suspended?: boolean;
  commit?: Commit; editDisabled?: string; nodeSelection?: string;
  performanceContent?: (selection: { nodeId?: string; lineId?: string }, select: (selection: PreviewSelection) => void, following: boolean, project: Project, commit?: Commit) => ReactNode;
  onNotice?: (message: string) => void;
  seekRequest?: { time: number; request: number };
  onTimeChange?: (time: number, duration: number) => void;
  minimumDuration?: number;
  playbackRequest?: number;
  embeddedTimeline?: boolean;
  allowSuspend?: boolean;
}
interface LocatedLine extends PreviewSelection { line: StoryLine }
interface ActiveLine { selected?: LocatedLine; nodeId?: string; sourceLine?: number; actionCount?: number }
const cameraTransform = (camera: PreviewCamera) => `translate(${camera.x * 100}%, ${camera.y * 100}%) scale(${camera.zoom}) rotate(${camera.rotation}deg)`;
const actorTransform = (actor: { scale: number; rotation: number }) => `translate(-50%, -100%) scale(${actor.scale}) rotate(${actor.rotation}deg)`;
const easing = (value: string) => ({ linear: 'linear', ease: 'ease-in-out', easein: 'ease-in', easeout: 'ease-out' })[value] ?? 'ease-in-out';

export function TextPreview(props: TextPreviewProps) {
  const [paused, setPaused] = useState(() => {
    try { return localStorage.getItem('vns:text-preview-paused') === 'true'; } catch { return false; }
  });
  const suspendControl = props.allowSuspend ? <button type="button" className="small-button preview-suspend-toggle" aria-pressed={paused} title={paused ? '按当前台词恢复实时预览' : '暂停画面、演出和音频预览，专注文本编辑'} onClick={() => {
    const next = !paused; setPaused(next);
    try { localStorage.setItem('vns:text-preview-paused', String(next)); } catch { /* Optional view preference. */ }
  }}>{paused ? <Play size={13} /> : <Pause size={13} />}{paused ? '恢复实时预览' : '暂停实时预览'}</button> : undefined;
  // Unmount the live subtree so no stage simulation, animation or audio keeps
  // running while the author types. Resume mounts it with the latest props.
  if (props.allowSuspend && paused) return <div className="story-preview-content" data-preview-phase="suspended">
    <div className="text-panel-heading preview-panel-heading"><strong>实时预览</strong><div className="spacer" />{suspendControl}</div>
    <div className="preview-suspended" role="status"><Pause size={26} /><strong>实时预览已暂停</strong><p>可继续编辑剧本。恢复后显示当前台词。</p></div>
  </div>;
  return <EditableTextPreview {...props} suspendControl={suspendControl} />;
}

function EditableTextPreview(props: TextPreviewProps & { suspendControl?: ReactNode }) {
  const live = useLiveParameterEdit(props.project, props.commit);
  return <NumericEditContext.Provider value={live.controls}><LiveTextPreview {...props} project={live.project} commit={live.commit} /></NumericEditContext.Provider>;
}

function LiveTextPreview({ project, source, sourceMap, cursorOffset, selection, assetUrl, headerActions, alternateContent, suspended = false, commit, editDisabled, nodeSelection, performanceContent, onNotice, seekRequest, onTimeChange, minimumDuration = 0, playbackRequest, embeddedTimeline = false, suspendControl }: TextPreviewProps & { suspendControl?: ReactNode }) {
  const compositionEditing = useContext(CompositionEditingContext);
  const compositionRef = useRef(compositionEditing); compositionRef.current = compositionEditing;
  const lines = useMemo(() => project.nodes.flatMap(node => node.kind === 'passage' ? node.lines.map(line => ({ nodeId: node.id, lineId: line.id, line })) : []), [project]);
  const linesByKey = useMemo(() => new Map(lines.map(line => [`${line.nodeId}/${line.lineId}`, line])), [lines]);
  const offsets = useMemo(() => { const result = [0]; for (let index = 0; index < source.length; index++) if (source[index] === '\n') result.push(index + 1); return result; }, [source]);
  const [followCursor, setFollowCursor] = useState(true);
  const [editing, setEditing] = useState(false);
  const [detailSelection, setDetailSelection] = useState<PreviewSelection>();
  useEffect(() => setDetailSelection(undefined), [cursorOffset, selection?.nodeId, selection?.lineId]);
  const [pinned, setPinned] = useState<{ key: string; sourceLine?: number; actionCount?: number }>();
  const active = useMemo<ActiveLine>(() => {
    if (!followCursor && pinned) return { ...pinned, nodeId: pinned.key.split('/')[0], selected: linesByKey.get(pinned.key) };
    if (detailSelection) return { nodeId: detailSelection.nodeId, selected: linesByKey.get(`${detailSelection.nodeId}/${detailSelection.lineId}`) };
    if (selection) return { nodeId: selection.nodeId, selected: linesByKey.get(`${selection.nodeId}/${selection.lineId}`) };
    if (cursorOffset === undefined) return nodeSelection ? { nodeId: nodeSelection, selected: lines.find(line => line.nodeId === nodeSelection) } : { selected: lines[0] };
    let low = 0, high = offsets.length;
    while (low < high) { const mid = (low + high) >>> 1; if (offsets[mid] <= cursorOffset) low = mid + 1; else high = mid; }
    const sourceLine = Math.max(1, low);
    low = 0; high = sourceMap.length;
    while (low < high) { const mid = (low + high) >>> 1; if (sourceMap[mid].sourceLine <= sourceLine) low = mid + 1; else high = mid; }
    const location = sourceMap[low - 1];
    const node = project.nodes.find(node => node.id === nodeSelection);
    if (node && node.kind !== 'passage') return { nodeId: node.id, sourceLine };
    return { nodeId: nodeSelection ?? location?.nodeId, selected: node && node.id !== location?.nodeId ? lines.find(line => line.nodeId === node.id) : location ? linesByKey.get(`${location.nodeId}/${location.lineId}`) : undefined, sourceLine, actionCount: node && node.id !== location?.nodeId ? undefined : location?.actionCount };
  }, [followCursor, pinned, selection, detailSelection, cursorOffset, offsets, sourceMap, lines, linesByKey, nodeSelection, project.nodes]);
  const [routeChoices, setRouteChoices] = useState<PreviewRouteChoices>({});
  useEffect(() => { setRouteChoices({}); setEditing(false); }, [project.id, active.selected?.nodeId]);
  const previewSelection = useMemo(() => active.selected ? { ...active.selected, routeChoices } : undefined, [active.selected, routeChoices]);
  const [readPreview] = useState(createLinePreviewReader);
  const full = useMemo(() => readPreview(project, previewSelection), [readPreview, project, previewSelection]);
  const snapshot = useMemo(() => active.actionCount === undefined ? full : readPreview(project, previewSelection, active.actionCount), [readPreview, project, previewSelection, active.actionCount, full]);
  const [elapsed, setElapsed] = useState<number>();
  const [phase, setPhase] = useState<'idle' | 'actions' | 'dialogue' | 'paused' | 'finished'>('idle');
  const [audioError, setAudioError] = useState('');
  const [audioUntil, setAudioUntil] = useState(0);
  const [seekExtent, setSeekExtent] = useState(0);
  const cancel = useRef<(() => void) | undefined>(undefined);
  const bodyRef = useRef<HTMLDivElement>(null);
  const activeNode = project.nodes.find(node => node.id === (active.nodeId ?? active.selected?.nodeId));
  const chapter = activeNode?.kind === 'chapterTitle' ? activeNode : undefined;
  const playbackBefore = chapter ? initialPreviewStage() : full.before;
  const plan = useMemo(() => linePlaybackPlan(chapter ? initialPreviewStage() : full.before, chapter ? [{ ...chapter, kind: 'chapter', wait: true }] : full.actions), [full.before, full.actions, chapter]);
  const videoSpans = useMemo(() => persistentVideoSpans(playbackBefore, plan), [playbackBefore, plan]);
  const videoSources = JSON.stringify([...new Set(videoSpans.map(span => span.object.assetId).filter((id): id is string => !!id))].map(id => ({ id, url: assetUrl(id) })));
  const [videoDurations, setVideoDurations] = useState<{ key: string; values: Record<string, number> }>({ key: '', values: {} });
  useEffect(() => {
    const controller = new AbortController();
    setVideoDurations({ key: videoSources, values: {} });
    const sources: { id: string; url?: string }[] = JSON.parse(videoSources);
    sources.forEach(({ id, url }) => {
      const update = (duration: number) => { if (!controller.signal.aborted) setVideoDurations(previous => ({ key: videoSources, values: { ...previous.values, [id]: duration } })); };
      void readVideoDuration(url ?? '', controller.signal).then(update).catch(error => {
        if (!controller.signal.aborted) { update(0); setAudioError(error instanceof Error ? error.message : String(error)); }
      });
    });
    return () => controller.abort();
  }, [videoSources]);
  const performanceSettings = useMemo(() => full.line?.silent ? performancePlayback(project, full.line) : chapter ? performancePlayback(project, { actions: [{ ...chapter, kind: 'chapter' }], playback: chapter.playback }) : undefined, [project, full.line, chapter]);
  const following = useMemo(() => performanceSettings && previewSelection ? followingPerformancePreview(project, previewSelection, performanceSettings, full) : undefined, [project, previewSelection, performanceSettings, full]);
  const transitionDuration = performanceTransitionDuration(performanceSettings);
  const speed = Number(project.playerDefaults?.textSpeed ?? 35);
  const textDuration = chapter || full.line?.silent ? 0 : (speed <= 0 ? 0 : Array.from(full.line?.text ?? '').length / speed * 1000) + 700;
  const baseTotal = Math.max(10, minimumDuration * 1000, plan.until + transitionDuration, plan.dialogueAt + textDuration + transitionDuration);
  const performanceEnd = Math.max(10, plan.until, plan.dialogueAt) + transitionDuration;
  const videoUntil = performanceSettings ? 0 : persistentVideoPreviewEnd(videoSpans, videoDurations.key === videoSources ? videoDurations.values : {});
  const videoUntilRef = useRef(videoUntil); videoUntilRef.current = videoUntil;
  const total = Math.max(baseTotal, performanceSettings ? 0 : audioUntil, seekExtent, Number.isFinite(videoUntil) ? videoUntil : Math.max(10000, Math.ceil((elapsed ?? 0) / 1000) * 1000));
  const playing = phase === 'actions' || phase === 'dialogue';
  const stop = useCallback(() => { cancel.current?.(); cancel.current = undefined; setElapsed(undefined); setPhase('idle'); }, []);
  useEffect(() => { cancel.current?.(); cancel.current = undefined; if (elapsed !== undefined) setPhase('paused'); setAudioError(''); setAudioUntil(0); return () => cancel.current?.(); }, [snapshot]);
  useEffect(() => { stop(); setSeekExtent(0); }, [active.selected?.nodeId, active.selected?.lineId, active.nodeId, !!alternateContent, suspended, stop]);
  const seekTo = (time: number) => { if (!Number.isFinite(time)) return; const next = Math.max(0, time); cancel.current?.(); cancel.current = undefined; setEditing(false); setSeekExtent(value => Math.max(value, next)); setElapsed(next); setPhase('paused'); };
  useEffect(() => { if (seekRequest) seekTo(seekRequest.time * 1000); }, [seekRequest?.request]);
  const completedTime = Math.max(plan.until, plan.dialogueAt);
  useEffect(() => { onTimeChange?.((elapsed ?? completedTime) / 1000, total / 1000); }, [elapsed, completedTime, total, onTimeChange]);
  const performanceSample = useMemo(() => elapsed === undefined || !performanceSettings || editing ? undefined : samplePerformanceTransition(playbackBefore, plan, performanceSettings, elapsed), [elapsed, plan, full, chapter, performanceSettings, editing]);
  const sampled = useMemo(() => elapsed === undefined ? undefined : performanceSample?.sample ?? sampleLinePlayback(playbackBefore, plan, elapsed), [elapsed, plan, full, chapter, performanceSample]);
  const visualSample = useMemo(() => sampled ?? sampleLinePlayback(playbackBefore, plan, completedTime), [sampled, playbackBefore, plan, completedTime]);
  const state = visualSample.state;
  const currentKey = active.selected ? active.selected.nodeId + '/' + active.selected.lineId : active.nodeId ? active.nodeId + '/' : '';
  const line = snapshot.line;
  const staticChapter = elapsed === undefined && (active.actionCount !== undefined || line?.silent) ? [...snapshot.actions].reverse().find(action => action.kind === 'chapter') as Extract<StageAction, { kind: 'chapter' }> | undefined : undefined;
  const stageChapter = sampled?.chapter?.action ?? staticChapter;
  const visibleChapter = chapter ?? stageChapter;
  const chapterTime = chapter ? elapsed === undefined ? undefined : elapsed / 1000 : sampled?.chapter?.elapsed;
  const interaction = activeNode?.kind === 'interaction' ? activeNode : undefined;
  const canEdit = !!commit && !!(line || interaction) && !editDisabled && !suspended && !alternateContent;
  useEffect(() => { if (!canEdit) setEditing(false); }, [canEdit]);
  const stageEdit = useStageEditing({ project, selection: previewSelection, state, commit, enabled: editing && canEdit, milliseconds: elapsed });
  const previousDialogue = line?.silent || elapsed !== undefined && elapsed < plan.dialogueAt ? state.dialogue : undefined;
  const text = previousDialogue ? previousDialogue.text : elapsed === undefined ? line?.text ?? '' : elapsed < plan.dialogueAt ? '' : Array.from(full.line?.text ?? '').slice(0, speed <= 0 ? undefined : Math.floor((elapsed - plan.dialogueAt) * speed / 1000)).join('');
  const speaker = project.characters.find(character => character.id === (previousDialogue ?? line)?.speakerId);
  const background = project.assets.find(asset => asset.id === state.backgroundId);
  const music = project.assets.find(asset => asset.id === snapshot.after.musicId);
  const voice = project.assets.find(asset => asset.id === line?.voiceId);
  const soundAction = [...snapshot.actions].reverse().find(action => action.kind === 'sound');
  const sound = soundAction?.kind === 'sound' ? project.assets.find(asset => asset.id === soundAction.assetId) : undefined;
  useEffect(() => { if (audioError) onNotice?.(audioError); }, [audioError, onNotice]);
  useEffect(() => { if (snapshot.context.incomplete) onNotice?.('此演出包含交互逻辑，完整交互效果可在实时试玩中查看。'); }, [snapshot.context.incomplete, onNotice]);

  const play = () => {
    if ((!active.selected && !chapter) || suspended) return;
    cancel.current?.(); setEditing(false); setAudioError(''); onNotice?.('');
    bodyRef.current?.querySelectorAll<HTMLAudioElement>('audio:not([data-preview-bgm])').forEach(audio => audio.pause());
    const startAt = phase === 'finished' ? 0 : elapsed ?? 0;
    const tracks = new Map<string, { audio: HTMLAudioElement; at: number; fade: number; gain: number; stopAt?: number; stopFade?: number; stopGain?: number; event: PreviewAudioEvent }>();
    type AudioEvent = PreviewAudioEvent;
    const events: AudioEvent[] = performancePreviewAudio(linePlaybackAudio(playbackBefore, plan));
    if (full.line?.voiceId && !chapter) events.push({ id: full.line.voiceId, channel: 'voice', at: plan.dialogueAt });
    events.sort((a, b) => a.at - b.at);
    let cancelled = false, frame = 0, audioEnd = audioUntil, lastRendered = -Infinity;
    const started = performance.now();
    const clockTime = () => startAt + performance.now() - started;
    const launch = (event: AudioEvent, time: number, stopGain?: number) => {
      const key = previewAudioKey(event), previous = tracks.get(key);
      if (event.duration !== undefined && time >= event.at + event.duration) return;
      if (!event.id) { if (previous) { previous.stopGain = stopGain ?? previewAudioGain(event.at, previous.at, previous.fade, previous.stopAt, previous.stopFade, previous.stopGain); previous.stopAt = event.at; previous.stopFade = event.fade ?? 0; } return; }
      if (previous) { previous.audio.onloadedmetadata = null; previous.audio.onerror = null; previous.audio.pause(); previous.audio.removeAttribute('src'); previous.audio.load(); }
      const url = assetUrl(event.id); if (!url) return;
      const asset = project.assets.find(asset => asset.id === event.id);
      if (event.duration !== undefined) { audioEnd = Math.max(audioEnd, event.at + event.duration); setAudioUntil(audioEnd); }
      const audio = new Audio(url), defaults = project.playerDefaults;
      const gain = Math.max(0, Math.min(1, (event.volume ?? 1) * Number(defaults?.masterVolume ?? 1) * Number(defaults?.[event.channel === 'music' ? 'musicVolume' : event.channel === 'voice' ? 'voiceVolume' : 'soundVolume'] ?? 1) * (event.channel === 'voice' ? Number(defaults?.characterVolume ?? 1) : 1)));
      audio.loop = event.loop ?? false; audio.volume = gain * previewAudioGain(time, event.at, event.fade ?? 0) * previewClipGain(time, event) * (compositionRef.current?.audioEnabled?.(key, event.id) === false ? 0 : 1);
      tracks.set(key, { audio, at: event.at, fade: event.fade ?? 0, gain, event });
      const active = () => !cancelled && tracks.get(key)?.audio === audio;
      const failed = () => { if (active()) setAudioError('无法播放音频：' + (asset?.name ?? event.channel)); };
      audio.onloadedmetadata = () => {
        if (!active()) return;
        const now = clockTime(), track = tracks.get(key)!;
        const amount = previewAudioGain(now,track.at,track.fade,track.stopAt,track.stopFade,track.stopGain) * previewClipGain(now, event);
        if (amount <= 0 && (track.stopAt !== undefined || event.duration !== undefined && now >= event.at + event.duration)) return;
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          const position = Math.max(0, (now - event.at + (event.offset ?? 0)) / 1000);
          if (!audio.loop && event.duration === undefined) { audioEnd = Math.max(audioEnd, event.at + audio.duration * 1000); setAudioUntil(audioEnd); }
          if (!audio.loop && position >= audio.duration) return;
          audio.currentTime = audio.loop ? position % audio.duration : position;
        }
        audio.volume = gain * amount * (compositionRef.current?.audioEnabled?.(key, event.id) === false ? 0 : 1);
        void audio.play().then(() => { if (!active()) audio.pause(); }).catch(error => { if (error?.name !== 'AbortError') failed(); });
      };
      audio.onerror = failed;
    };
    for (const { source, stop, stopGain } of previewAudioAt(events, startAt)) { launch(source, startAt); if (stop) launch(stop, startAt, stopGain); }

    let nextEvent = events.findIndex(event => event.at > startAt);
    if (nextEvent < 0) nextEvent = events.length;
    cancel.current = () => {
      cancelled = true; cancelAnimationFrame(frame);
      tracks.forEach(({ audio }) => { audio.onerror = null; audio.onloadedmetadata = null; audio.pause(); audio.removeAttribute('src'); audio.load(); });
    };
    setElapsed(startAt); setPhase(startAt < plan.dialogueAt || chapter || full.line?.silent ? 'actions' : 'dialogue');
    const tick = (now: number) => {
      if (cancelled) return;
      const time = startAt + now - started, end = performanceSettings ? performanceEnd : Math.max(baseTotal, audioEnd, videoUntilRef.current);
      while (nextEvent < events.length && events[nextEvent].at <= time) launch(events[nextEvent++], time);
      tracks.forEach(track => {
        const amount = previewAudioGain(time,track.at,track.fade,track.stopAt,track.stopFade,track.stopGain) * previewClipGain(time, track.event);
        track.audio.volume = Math.max(0, Math.min(1, track.gain * amount)) * (compositionRef.current?.audioEnabled?.(previewAudioKey(track.event), track.event.id) === false ? 0 : 1);
        if (amount <= 0 && (track.stopAt !== undefined || track.event.duration !== undefined && time >= track.at + track.event.duration)) track.audio.pause();
      });
      if (time >= end) { cancel.current?.(); cancel.current = undefined; setElapsed(end); setPhase('finished'); return; }
      if (now - lastRendered >= 1000 / 30) { lastRendered = now; setElapsed(time); setPhase(chapter || full.line?.silent || time < plan.dialogueAt ? 'actions' : 'dialogue'); }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  };
  const pause = () => { cancel.current?.(); cancel.current = undefined; setPhase('paused'); };
  const lastPlaybackRequest = useRef(playbackRequest);
  useEffect(() => {
    if (lastPlaybackRequest.current === playbackRequest) return;
    lastPlaybackRequest.current = playbackRequest;
    if (!suspended && !alternateContent && (line || chapter)) (playing ? pause : play)();
  }, [playbackRequest]);
  const skip = () => {
    if (!playing || !performanceSettings?.clickSkip || editing) return;
    cancel.current?.(); cancel.current = undefined; setElapsed(performanceEnd); setPhase('finished');
  };
  const ghost = sampled?.transition;
  const followingState = performanceSample?.showingNext ? following?.sample.state : undefined;
  const followingLine = following && 'line' in following ? following.line : undefined;
  const performanceRevealed = performanceSample && (elapsed ?? 0) >= performanceSample.end + performanceSample.duration;
  const transitionDialogue = performanceRevealed && followingLine && !followingLine.silent ? followingLine : previousDialogue;
  const transitionInterfaceVisible = (followingState ?? state).interfaceVisible !== false && !(performanceSample?.showingNext && following && 'title' in following);
  return <div className="story-preview-content" data-preview-key={currentKey} data-preview-phase={phase} data-preview-editing={editing}>
    <div className="text-panel-heading preview-panel-heading">{!embeddedTimeline && <><strong>实时预览</strong><label className="text-follow-cursor"><input type="checkbox" checked={followCursor} onChange={event => { if (!event.target.checked) setPinned({ key: currentKey, sourceLine: active.sourceLine, actionCount: active.actionCount }); setFollowCursor(event.target.checked); }} />跟随光标</label></>}{suspendControl}<div className="spacer" />
      {!embeddedTimeline && <button type="button" className={`small-button preview-stage-toggle ${editing ? 'active' : ''}`} aria-pressed={editing} disabled={!canEdit} title={editDisabled ?? '直接调整当前台词的角色、镜头或互动区域'} onClick={() => { cancel.current?.(); cancel.current = undefined; if (elapsed !== undefined) setPhase('paused'); setEditing(value => !value); }}><Clapperboard size={13} />编辑舞台</button>}
      <button type="button" className={`small-button line-preview-play ${playing ? 'active' : ''}`} disabled={(!line && !chapter) || !!alternateContent || suspended} onClick={playing ? pause : play}>{playing ? <Pause size={13} /> : <Play size={13} />}{playing ? '暂停预览' : '播放预览'}</button>{elapsed !== undefined && <button type="button" className="icon-button" title="停止预览" aria-label="停止预览" onClick={stop}><Square size={13} /></button>}{headerActions}
    </div>
    {alternateContent ?? <div className="text-live-preview" ref={bodyRef}>
      <div className="preview-stage-frame" onClick={skip} style={{ '--preview-aspect': project.width / project.height } as CSSProperties}><div className="preview-stage-viewport" style={{ aspectRatio: `${project.width} / ${project.height}` }}>{chapter ? <ChapterStage project={project} node={chapter} assetUrl={assetUrl} playing={playing} elapsed={chapterTime} /> : interaction && commit ? <InteractionStage key={interaction.id} project={project} node={interaction} commit={commit} assetUrl={assetUrl} editable={editing && canEdit} /> : <div className={`text-stage ${editing ? 'editing' : ''}`} ref={stageEdit.canvasRef} style={{ aspectRatio: `${project.width} / ${project.height}`, backgroundColor: '#000000' }} onDragOver={event => { if (editing && (event.dataTransfer.types.includes('application/vns-asset') || event.dataTransfer.types.includes('application/vns-character'))) event.preventDefault(); }} onDrop={stageEdit.drop}>
        <VisualEditingSurface><div className="preview-scene-layers"><div className="text-stage-shake" style={{ opacity: ghost ? ghost.type === 'fade' ? ghost.progress < .5 ? 0 : 1 : ghost.progress : 1, mixBlendMode: ghost?.type === 'dissolve' ? 'plus-lighter' : undefined, transform: 'translate(' + (sampled?.shake.x ?? 0) / project.width * 100 + '%, ' + (sampled?.shake.y ?? 0) / project.height * 100 + '%)' }}><div className="text-stage-world" style={{ transform: cameraTransform(state.camera) }}>
          {compositionEditing?.backgroundVisible !== false && (background ? <img className="text-stage-background" src={assetUrl(background.id)} alt={`背景：${background.name}`} draggable={false} /> : !compositionEditing && !performanceSettings && <div className="text-stage-empty"><Image size={24} /><span>未设置背景</span></div>)}
          {stageChapter && !compositionEditing?.isolate && <ChapterStageLayer project={project} chapter={{ action: stageChapter, elapsed: chapterTime }} assetUrl={assetUrl} />}
          {visualSample.visuals.map(frame => <VisualObjectPreview key={frame.object.instanceId} object={frame.object} elapsed={frame.elapsed} frame={frame} project={project} assetUrl={assetUrl} playing={playing && !suspended} editing={compositionEditing ? playing || suspended ? { ...compositionEditing, canSelect: () => false, selected: () => false, transform: undefined } : compositionEditing : editing && canEdit ? {
            selected: (rootId, instanceId) => stageEdit.visual?.rootId === rootId && stageEdit.visual?.object.instanceId === instanceId,
            select: (rootId, instanceId) => stageEdit.setVisualId(JSON.stringify([rootId, instanceId])),
            move: stageEdit.moveVisualTarget,
            transform: stageEdit.moveVisualTarget,
          } : undefined} />)}
          {renderActorLayers([...(state.actorGhosts ?? []), ...state.actors.values()].filter(actor => compositionEditing?.actorVisible?.(actor.characterId, actor.instanceId) !== false), actor => { const character = effectiveCharacter(project, actor.characterId), expression = character?.expressions.find(e => e.id === actor.expressionId), asset = project.assets.find(a => a.id === expression?.assetId);
            const point = stageEdit.point?.id === actorKey(actor) ? stageEdit.point : actor;
            const selected = !!stageEdit.actor && actorKey(stageEdit.actor) === actorKey(actor);
            return <div key={actorKey(actor)} className={`text-stage-actor ${editing && selected ? 'selected' : ''}`} data-character-id={actor.characterId} data-instance-id={actor.instanceId ?? ''} role={editing ? 'button' : undefined} tabIndex={editing ? 0 : undefined} aria-label={editing ? `选择角色 ${character?.name ?? ''}${actor.instanceId ? ` ${actor.instanceId}` : ''}` : undefined} aria-pressed={editing ? selected : undefined} {...stageEdit.actorEvents(actor)} style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%`, height: `${((asset?.height ?? project.height * .88) / project.height) * 100}%`, width: asset?.width ? `${asset.width / project.width * 100}%` : undefined, transform: actorTransform(actor), opacity: actor.opacity, zIndex: actor.layer }}>{expression && <img src={assetUrl(expression.assetId)} alt={`${character?.name ?? '角色'}：${expression.name}`} draggable={false} />}</div>;
          })}
        </div></div>
        {ghost && <div className="preview-transition-ghost" aria-hidden="true" style={{ opacity: ghost.type === 'fade' ? ghost.progress < .5 ? 1 : 0 : 1 - ghost.progress, mixBlendMode: ghost.type === 'dissolve' ? 'plus-lighter' : undefined, transform: cameraTransform(ghost.before.camera) }}>
          {ghost.before.backgroundId && compositionEditing?.backgroundVisible !== false && <img className="text-stage-background" src={assetUrl(ghost.before.backgroundId)} alt="" />}
          {[...ghost.before.visuals.values()].map(frame=><VisualObjectPreview key={frame.object.instanceId} object={frame.object} elapsed={frame.elapsed} frame={frame} project={project} assetUrl={assetUrl} editing={compositionEditing ? { ...compositionEditing, canSelect: () => false, selected: () => false, transform: undefined } : undefined} />)}
          {[...ghost.before.actors.values()].filter(actor => compositionEditing?.actorVisible?.(actor.characterId, actor.instanceId) !== false).map(actor => { const expression = effectiveCharacter(project, actor.characterId)?.expressions.find(item => item.id === actor.expressionId); const asset = project.assets.find(item => item.id === expression?.assetId); return expression && <div key={actorKey(actor)} className="text-stage-actor" style={{ left: actor.x * 100 + '%', top: actor.y * 100 + '%', height: (asset?.height ?? project.height * .88) / project.height * 100 + '%', width: asset?.width ? asset.width / project.width * 100 + '%' : undefined, transform: actorTransform(actor), opacity: actor.opacity, zIndex: actor.layer }}><img src={assetUrl(expression.assetId)} alt="" /></div>; })}
        </div>}
        {ghost?.type === 'fade' && <div className="preview-transition-black" aria-hidden="true" style={{ opacity: 1 - Math.abs(ghost.progress * 2 - 1) }} />}</div></VisualEditingSurface>
        {state.interfaceVisible !== false && (!line?.silent || !!previousDialogue) && !compositionEditing?.isolate && <DialoguePreview project={project} assetUrl={assetUrl} speaker={speaker?.name} text={text} values={snapshot.context.variables} revealing={playing && text !== line?.text} />}
      </div>}
      {performanceSample?.outgoing && <div className="preview-performance-transition" data-performance-transition={performanceSettings?.transition?.mode ?? 'none'} style={{ position: 'absolute', inset: 0, zIndex: 100, pointerEvents: 'none', background: '#000000' }}>
        <div style={{ position: 'absolute', inset: 0, isolation: 'isolate' }}>
        {performanceSample.showingNext && following && <><PlaybackStage project={project} sample={following.sample} assetUrl={assetUrl} playing={playing && !suspended} />{'title' in following && following.title && <div className="preview-performance-title">{project.name}</div>}</>}
        {(!performanceSample.showingNext || performanceSettings?.transition?.mode === 'dissolve' && performanceSample.previousOpacity > 0) && <div style={{ position: 'absolute', inset: 0, opacity: performanceSample.previousOpacity }}><PlaybackStage project={project} sample={performanceSample.sample} assetUrl={assetUrl} /></div>}
        {performanceSample.coverOpacity > 0 && <div className="preview-performance-cover" style={{ position: 'absolute', inset: 0, background: performanceSettings?.transition?.color, opacity: performanceSample.coverOpacity }} />}
        </div>
        {transitionInterfaceVisible && transitionDialogue && !compositionEditing?.isolate && <DialoguePreview project={project} assetUrl={assetUrl} speaker={project.characters.find(character => character.id === transitionDialogue.speakerId)?.name} text={transitionDialogue.text} values={snapshot.context.variables} />}
      </div>}</div></div>
      <div className="preview-control-strip" onKeyDown={event=>{if(event.code!=='Space'||!(event.target instanceof HTMLInputElement)||event.target.type!=='range')return;event.preventDefault();event.stopPropagation();if(!event.repeat)(playing?pause:play)();}}>
      <div className="preview-playback-status" aria-live="polite"><span>{chapter ? playing ? '章节演出中' : phase === 'finished' ? '章节预览结束' : '章节演出' : editing ? interaction ? '编辑互动区域' : '编辑舞台' : interaction ? '互动预览' : phase === 'actions' ? '演出中' : phase === 'dialogue' ? '台词中' : phase === 'finished' ? '预览结束' : ''}</span>{active.sourceLine && <span className="preview-source-position">第 {active.sourceLine} 行</span>}</div>
      {!embeddedTimeline && (line || chapter) && <div className="preview-transport"><input type="range" aria-label="演出预览进度" min={0} max={total / 1000} step={.01} value={(elapsed ?? completedTime) / 1000} onChange={event => seekTo(Number(event.target.value) * 1000)} /><NumberInput className="preview-seek-time" aria-label="定位演出时间（秒）" title="定位演出时间（秒），可超出当前结尾添加后续关键帧" type="number" min={0} step={.1} value={(elapsed ?? completedTime) / 1000} onChange={event => seekTo(Number(event.target.value) * 1000)} /><output>{Number.isFinite(videoUntil) ? `/ ${(total / 1000).toFixed(2)} 秒` : '持续播放'}</output></div>}
      </div>
      {!embeddedTimeline && <div className="text-preview-music">
        {music ? <div className="text-audio-row"><span title={`BGM · ${music.name}（手动试听）`}><Music2 size={14} />{music.name}</span><audio data-preview-bgm key={`music-${music.id}`} aria-label={`试听音乐：${music.name}`} controls preload="metadata" loop={snapshot.after.musicLoop} src={assetUrl(music.id)} /></div> : <div className="text-audio-empty"><Music2 size={14} />未设置 BGM</div>}
      </div>}
      <div className="preview-detail-scroll">
      {snapshot.routeNote && <p className="text-preview-note">{snapshot.routeNote}</p>}
      {(snapshot.routeDecisions.length > 0 || Object.keys(routeChoices).length > 0) && <details className="preview-route-options"><summary>预览路径与选择历史</summary>
        {snapshot.routeDecisions.map((decision, index) => <label key={decision.key} className="field">第 {index + 1} 步 · {decision.name}<select aria-label={`预览分支 ${index + 1}：${decision.name}`} value={decision.selected} onChange={event => {
          stop(); setEditing(false);
          setRouteChoices(Object.fromEntries([...snapshot.routeDecisions.slice(0, index).map(item => [item.key, item.selected]), [decision.key, event.target.value]]));
        }}>{decision.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>)}
        {Object.keys(routeChoices).length > 0 && <button type="button" onClick={() => { stop(); setEditing(false); setRouteChoices({}); }}>恢复自动预览路径</button>}
        <p className="muted">这些选择只用于当前段落的预览，不修改剧情或玩家存档。修改较早的选择后，后续路径会重新计算。</p>
      </details>}
      {(playbackBefore.visuals.size > 0 || playbackBefore.motions.size > 0 || playbackBefore.cameraMotion) && <p className="text-preview-note">延续前文尚未结束的对象、角色与镜头动画；按立即推进台词预览，不计玩家阅读停留时间。</p>}
      {performanceContent?.({ nodeId: active.nodeId ?? active.selected?.nodeId, lineId: active.selected?.lineId }, next => { if (followCursor) setDetailSelection(next); else setPinned({ key: `${next.nodeId}/${next.lineId}` }); }, followCursor, project, commit)}
      {editing && canEdit && previewSelection && <StageTools project={project} selection={previewSelection} state={state} controls={stageEdit} assetUrl={assetUrl} />}
      {!onNotice && editDisabled && <p className="text-preview-note">{editDisabled}</p>}
      {!onNotice && audioError && <p className="text-preview-note" role="status">{audioError}</p>}
      {!embeddedTimeline && <div className="text-live-audio">
        {voice && <div className="text-audio-row"><span><Volume2 size={14} />配音 · {voice.name}</span><audio key={`voice-${voice.id}`} aria-label={`试听配音：${voice.name}`} controls preload="metadata" src={assetUrl(voice.id)} /></div>}
        {sound && <div className="text-audio-row"><span><Volume2 size={14} />{sound.name}</span><audio key={`sound-${sound.id}`} aria-label={`试听音效：${sound.name}`} controls preload="metadata" src={assetUrl(sound.id)} /></div>}
      </div>}
      </div>
    </div>}
  </div>;
}
