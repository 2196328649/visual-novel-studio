import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Project } from '../core/model';
import type { AudioClip } from '../core/audio-clip';
import { AssetReferenceInput } from './AssetReferenceInput';
import { NumberInput } from './NumberInput';
import { readAudioDuration } from './audio-metadata';
import type { AssetUrl } from './StageEditor';

export function TimelineAudioClipEditor({ project, clip, linked = new Set(), assetUrl, onChange, timelinePlacement }: { project: Project; clip: AudioClip; linked?: Set<string>; assetUrl?: AssetUrl; onChange: (patch: Partial<AudioClip>) => void; timelinePlacement?: { at: number; onStartChange: (at: number) => void; trackControl: ReactNode } }) {
  const pending = useRef<AbortController | undefined>(undefined);
  const current = useRef(clip); current.current = clip;
  const [notice, setNotice] = useState('');
  useEffect(() => () => pending.current?.abort(), []);
  const changeSource = async (assetId: string) => {
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    try {
      if (!assetUrl) { onChange({ assetId, sourceDuration: undefined }); return; }
      setNotice('正在读取音频时长…');
      const duration = await readAudioDuration(assetUrl(assetId) ?? "", controller.signal);
      if (current.current !== clip) { setNotice('片段已修改，请重新选择素材。'); return; }
      onChange({ assetId, sourceDuration: duration, offset: 0, duration: Math.min(clip.duration, duration) }); setNotice('');
    } catch (error) { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : String(error)); }
  };
  const durationField = <label>时长（秒）<NumberInput aria-label="音频片段时长" disabled={linked.has('clip_duration')} min={.05} step={.1} value={clip.duration} onChange={e => onChange({ duration: Math.max(.05, Number(e.target.value)) })} /></label>;
  const offsetField = <label>截取起点（秒）<NumberInput aria-label="音频截取起点" disabled={linked.has('clip_offset')} min={0} step={.1} value={clip.offset} onChange={e => onChange({ offset: Math.max(0, Math.min(clip.sourceDuration === undefined ? Infinity : Math.max(0, clip.sourceDuration - .05), Number(e.target.value))) })} /></label>;
  return <div className="timeline-clip-basics timeline-audio-properties">
    <label className="timeline-clip-identity">名称<input aria-label="音频片段名称" value={clip.name} onChange={e => onChange({ name: e.target.value })} /></label>
    {timelinePlacement && <><div className="timeline-timing-fields"><label>开始（秒）<NumberInput aria-label="片段开始秒数" min={0} step={.05} value={timelinePlacement.at} onChange={event => timelinePlacement.onStartChange(event.target.valueAsNumber)} /></label>{durationField}</div>{timelinePlacement.trackControl}</>}
    <fieldset disabled={linked.has('clip_assetId')}><label>音频素材<AssetReferenceInput project={project} kind="audio" compact label="片段音频素材" value={clip.assetId} empty="选择音频" onChange={id => void changeSource(id ?? "")} /></label></fieldset>
    {notice && <p role="status">{notice}</p>}
    {timelinePlacement ? offsetField : <div className="timeline-audio-pair">{durationField}{offsetField}</div>}
    {clip.sourceDuration !== undefined && <p className="timeline-audio-source-info">原素材 {clip.sourceDuration.toFixed(2)} 秒 · 使用 {clip.offset.toFixed(2)}–{Math.min(clip.sourceDuration, clip.offset + clip.duration).toFixed(2)} 秒</p>}
    <label>音量 %<NumberInput aria-label="音频片段音量" disabled={linked.has('clip_volume')} min={0} max={100} step={1} value={clip.volume * 100} onChange={e => onChange({ volume: Math.max(0, Math.min(1, Number(e.target.value) / 100)) })} /></label>
    <div className="timeline-audio-pair">{(['fadeIn', 'fadeOut'] as const).map(key => <label key={key}>{key === 'fadeIn' ? '淡入' : '淡出'}（秒）<NumberInput aria-label={key === 'fadeIn' ? '音频淡入秒数' : '音频淡出秒数'} disabled={linked.has('clip_' + key)} min={0} max={clip.duration} step={.1} value={clip[key]} onChange={e => onChange({ [key]: Math.max(0, Math.min(clip.duration, Number(e.target.value))) })} /></label>)}</div>
    {[...linked].some(key => key.startsWith('clip_')) && <p className="muted">灰色属性已关联参数，可在下方“可替换参数”中查看来源。</p>}
    <details className="timeline-audio-advanced"><summary>游戏音量：{({ music: '音乐', sound: '音效', voice: '语音' })[clip.bus]}</summary><label>音量分类<select aria-label="音频音量分类" value={clip.bus} onChange={e => onChange({ bus: e.target.value as AudioClip['bus'] })}><option value="music">音乐</option><option value="sound">音效</option><option value="voice">语音</option></select></label>
    <p className="muted">由游戏设置中对应的音量控制。片段到末尾自动停止，不同轨道可同时播放。</p></details>
  </div>;
}
