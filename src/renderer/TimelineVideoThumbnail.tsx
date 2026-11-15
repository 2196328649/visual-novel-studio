import { useEffect, useRef, useState } from 'react';

/** One paused frame at the source in-point, loaded only while the clip is near
 * the visible timeline. Thumbnail videos never participate in playback. */
export function TimelineVideoThumbnail({ src, offset = 0 }: { src?: string; offset?: number }) {
  const container = useRef<HTMLSpanElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const seek = () => {
    const element = video.current;
    if (!element || element.readyState < 1) return;
    element.pause();
    const at = Math.max(0, Math.min(Number.isFinite(element.duration) ? Math.max(0, element.duration - .05) : offset, offset));
    if (Math.abs(element.currentTime - at) > .001) element.currentTime = at;
  };
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { root: element.closest('.timeline-scroll'), rootMargin: '80px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(seek, [src, offset, visible]);
  return <span ref={container} className="timeline-video-thumbnail" aria-hidden="true">
    {visible && src && <video ref={video} key={src} className="timeline-clip-filmstrip" src={src} muted playsInline preload="metadata" onLoadedMetadata={seek} onLoadedData={seek} />}
  </span>;
}
