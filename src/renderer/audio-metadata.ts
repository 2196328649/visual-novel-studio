/** Read metadata without playing, releasing the media element on every exit path. */
export function readMediaDuration(url: string, signal: AbortSignal, kind: 'audio' | 'video' = 'audio'): Promise<number> {
  return new Promise((resolve, reject) => {
    const media = kind === 'video' ? document.createElement('video') : new Audio();
    const finish = (error?: Error) => {
      const duration = media.duration;
      clearTimeout(timeout); signal.removeEventListener('abort', abort);
      media.onloadedmetadata = null; media.onerror = null; media.removeAttribute('src'); media.load();
      if (error) reject(error); else if (!Number.isFinite(duration) || duration <= 0) reject(new Error(`无法读取${kind === 'video' ? '视频' : '音频'}时长，请检查素材文件。`)); else resolve(duration);
    };
    const abort = () => finish(new DOMException('读取已取消', 'AbortError'));
    const timeout = setTimeout(() => finish(new Error(`读取${kind === 'video' ? '视频' : '音频'}时长超时，请检查素材文件后重试。`)), 15000);
    signal.addEventListener('abort', abort, { once: true });
    media.onloadedmetadata = () => finish();
    media.onerror = () => finish(new Error(`无法读取${kind === 'video' ? '视频' : '音频'}，请检查素材文件是否存在且格式可播放。`));
    if (signal.aborted) { abort(); return; }
    media.preload = 'metadata'; media.src = url;
  });
}

export function readAudioDuration(url: string, signal: AbortSignal) { return readMediaDuration(url, signal, 'audio'); }
export function readVideoDuration(url: string, signal: AbortSignal) { return readMediaDuration(url, signal, 'video'); }
