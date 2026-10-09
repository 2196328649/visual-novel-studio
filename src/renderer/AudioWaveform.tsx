import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { acquireAudioWaveform, waveformPeakBetween, type WaveformData } from './audio-waveform';

export function AudioWaveform({ url, offset, duration, start }: {
  url?: string;
  offset: number;
  duration: number;
  start: number;
}) {
  const surface = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState<{ url?: string; data?: WaveformData; state: 'ready' | 'loading' | 'error' }>({ state: 'loading' });
  const waveform = loaded.url === url ? loaded.data : undefined;
  const state = !url ? 'empty' : loaded.url === url ? loaded.state : 'loading';

  useEffect(() => {
    if (!url) return;
    let current = true;
    setLoaded({ url, state: 'loading' });
    const request = acquireAudioWaveform(url);
    void request.promise.then(data => { if (current) setLoaded({ url, data, state: 'ready' }); }, () => {
      if (current) setLoaded({ url, state: 'error' });
    });
    return () => { current = false; request.release(); };
  }, [url]);

  useLayoutEffect(() => {
    const element = surface.current, bitmap = canvas.current;
    if (!element || !bitmap) return;
    const viewport = element.closest<HTMLElement>('.timeline-scroll');
    let frame = 0;
    const draw = () => {
      const rect = element.getBoundingClientRect(), view = viewport?.getBoundingClientRect();
      // A long song at high zoom must not allocate a canvas hundreds of
      // thousands of pixels wide. Paint just the visible source range.
      const left = Math.max(0, view ? view.left + 130 - rect.left : 0);
      const right = Math.min(rect.width, view ? view.right - rect.left : rect.width);
      const width = Math.max(0, Math.ceil(right - left));
      const height = rect.height;
      const ratio = Math.min(3, window.devicePixelRatio || 1);
      bitmap.style.left = left + 'px';
      bitmap.style.width = width + 'px';
      bitmap.width = Math.max(1, Math.ceil(width * ratio));
      bitmap.height = Math.max(1, Math.ceil(height * ratio));
      const context = bitmap.getContext('2d');
      if (!context || !waveform || !width || duration <= 0 || rect.width <= 0) return;
      context.scale(ratio, ratio);
      context.fillStyle = '#b7eee0';
      const secondsPerPixel = duration / rect.width;
      // Normalize against the whole source, so trimming doesn't amplify a
      // quiet section. Avoid amplifying nearly silent background noise.
      const scale = Math.max(.05, waveform.maximum);
      for (let x = 0; x < width; x++) {
        const from = offset + (left + x) * secondsPerPixel;
        if (from >= waveform.duration) continue;
        const peak = waveformPeakBetween(waveform, from, from + secondsPerPixel);
        const amplitude = Math.min(1, peak / scale);
        const size = Math.max(1, amplitude * (height - 4));
        context.fillRect(x, (height - size) / 2, 1, size);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); });
    };
    draw();
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    if (viewport) observer.observe(viewport);
    viewport?.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [waveform, offset, duration, start]);

  return <span ref={surface} className="timeline-audio-waveform" aria-hidden="true" data-waveform-state={state} data-waveform-offset={offset} data-waveform-duration={duration}>
    <canvas ref={canvas} />
    {(state === 'loading' || state === 'error') && <span className="timeline-waveform-status">{state === 'loading' ? '波形加载中…' : '波形无法读取'}</span>}
  </span>;
}

