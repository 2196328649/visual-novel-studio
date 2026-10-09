import { useEffect, useRef, useState } from 'react';
import type { Project } from '../core/model';
import type { AudioClip } from '../core/audio-clip';
import { AssetReferenceInput } from './AssetReferenceInput';
import { NumberInput } from './NumberInput';
import { readAudioDuration } from './audio-metadata';
import type { AssetUrl } from './StageEditor';

export function TimelineAudioClipEditor({ project, clip, linked = new Set(), assetUrl, onChange }: { project: Project; clip: AudioClip; linked?: Set<string>; assetUrl?: AssetUrl; onChange: (patch: Partial<AudioClip>) => void }) {
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
  return <div className="timeline-clip-basics timeline-audio-properties">
    <label>片段名称<input aria-label="音频片段名称" value={clip.name} onChange={e => onChange({ name: e.target.value })} /></label>
    <fieldset disabled={linked.has('clip_assetId')}><label>音频素材<AssetReferenceInput project={project} kind="audio" label="片段音频素材" value={clip.assetId} empty="选择音频" onChange={id => void changeSource(id ?? "")} /></label></fieldset>
    {notice && <p role="status">{notice}</p>}
    <label>播放时长（秒）<NumberInput aria-label="音频片段时长" disabled={linked.has('clip_duration')} min={.05} step={.1} value={clip.duration} onChange={e => onChange({ duration: Math.max(.05, Number(e.target.value)) })} /></label>
    <label>素材截取起点（秒）<NumberInput aria-label="音频截取起点" disabled={linked.has('clip_offset')} min={0} step={.1} value={clip.offset} onChange={e => onChange({ offset: Math.max(0, Math.min(clip.sourceDuration === undefined ? Infinity : Math.max(0, clip.sourceDuration - .05), Number(e.target.value))) })} /></label>
    {clip.sourceDuration !== undefined && <p className="muted">原素材 {clip.sourceDuration.toFixed(2)} 秒 · 使用 {clip.offset.toFixed(2)}–{Math.min(clip.sourceDuration, clip.offset + clip.duration).toFixed(2)} 秒</p>}
    <label>音量 %<NumberInput aria-label="音频片段音量" disabled={linked.has('clip_volume')} min={0} max={100} step={1} value={clip.volume * 100} onChange={e => onChange({ volume: Math.max(0, Math.min(1, Number(e.target.value) / 100)) })} /></label>
    {(['fadeIn', 'fadeOut'] as const).map(key => <label key={key}>{key === 'fadeIn' ? '淡入' : '淡出'}（秒）<NumberInput aria-label={key === 'fadeIn' ? '音频淡入秒数' : '音频淡出秒数'} disabled={linked.has('clip_' + key)} min={0} max={clip.duration} step={.1} value={clip[key]} onChange={e => onChange({ [key]: Math.max(0, Math.min(clip.duration, Number(e.target.value))) })} /></label>)}
    <label>音量分类<select aria-label="音频音量分类" value={clip.bus} onChange={e => onChange({ bus: e.target.value as AudioClip['bus'] })}><option value="music">音乐</option><option value="sound">音效</option><option value="voice">语音</option></select></label>
    <p className="muted">到片段末尾自动停止。不同轨道可以同时播放；音量分类决定游戏设置中哪个音量滑块控制它。</p>
  </div>;
}
