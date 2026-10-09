import { useEffect, useRef, useState } from 'react';
import type { previewUiLogic, UiPreviewEvent } from '../core/ui-logic-preview';
import type { AssetUrl } from './StageEditor';

export function UiMusicPreviewAudio({ preview, assetUrl, onEvent }: { preview?: ReturnType<typeof previewUiLogic>; assetUrl: AssetUrl; onEvent: (event: UiPreviewEvent) => void }) {
 const element = useRef<HTMLAudioElement>(null), [error, setError] = useState(''), callback = useRef(onEvent); callback.current = onEvent;
 const playback = preview?.music.playback, url = playback ? assetUrl(playback.assetId) : undefined, requestId = playback?.requestId, paused = playback?.paused;
 const gain = Math.max(0, Math.min(1, (preview?.muted ? 0 : 1) * Number(preview?.preferences.masterVolume ?? 1) * Number(preview?.preferences.musicVolume ?? 1)));
 useEffect(() => { if (element.current) element.current.volume = gain; }, [gain, requestId]);
 useEffect(() => {
  const audio = element.current; if (!audio) return;
  audio.pause();
  if (requestId === undefined) { audio.removeAttribute('src'); audio.load(); return; }
  let cancelled = false; setError('');
  const ended = () => { if (!cancelled) callback.current({ kind: 'musicEnded', requestId }); };
  const failed = () => { if (!cancelled) { setError('音乐试听失败，请检查素材文件和音频格式。'); callback.current({ kind: 'musicEnded', requestId, failed: true }); } };
  if (!url) { failed(); return () => { cancelled = true; }; }
  const source = /^(studio-asset|https?|file):/.test(url) ? new URL(url) : undefined;
  if (source) source.searchParams.set('vns-music-attempt', String(Date.now()) + '-' + requestId);
  audio.src = source?.href ?? url; audio.currentTime = 0;
  audio.addEventListener('ended', ended); audio.addEventListener('error', failed);
  return () => { cancelled = true; audio.removeEventListener('ended', ended); audio.removeEventListener('error', failed); audio.pause(); audio.removeAttribute('src'); audio.load(); };
 }, [url, requestId]);
 useEffect(() => {
  const audio = element.current; if (!audio || !url || requestId === undefined) return;
  if (paused) audio.pause();
  else { let cancelled = false; void audio.play().catch(e => { if (!cancelled && e?.name !== 'AbortError') { setError('音乐试听失败，请检查素材文件和音频格式。'); callback.current({ kind: 'musicEnded', requestId, failed: true }); } }); return () => { cancelled = true; }; }
 }, [paused, requestId, url]);
 useEffect(() => { if (!preview?.music.serial) setError(''); }, [preview?.music.serial]);
 return <><audio key={requestId ?? 'idle'} ref={element} aria-label="音乐预演播放器" style={{ display: 'none' }}/>{error && <p role="status">{error}</p>}</>;
}
