import { useEffect, useLayoutEffect, useRef, type DependencyList } from 'react';

export type TimelinePointerCapture = { element: HTMLElement; pointerId: number };

export function releaseTimelinePointer(capture?: TimelinePointerCapture) {
  if (capture?.element.hasPointerCapture(capture.pointerId)) capture.element.releasePointerCapture(capture.pointerId);
}

/** Every timeline gesture retires its refs before releasing capture. Native
 * cancellation and navigation therefore cannot turn a late pointerup into an edit. */
export function useTimelineGestureCancellation(
  cancel: () => void,
  captures: () => readonly (TimelinePointerCapture | undefined)[],
  context: DependencyList,
) {
  const latest = useRef({ cancel, captures }); latest.current = { cancel, captures };
  useLayoutEffect(() => {
    if (latest.current.captures().some(Boolean)) latest.current.cancel();
  }, context);
  useEffect(() => {
    const cancelActive = () => { if (latest.current.captures().some(Boolean)) latest.current.cancel(); };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !latest.current.captures().some(Boolean)) return;
      event.preventDefault(); event.stopPropagation(); cancelActive();
    };
    const pointer = (event: PointerEvent) => {
      if (latest.current.captures().some(capture => capture?.pointerId === event.pointerId && (event.type !== 'lostpointercapture' || capture.element === event.target))) cancelActive();
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancelActive);
    window.addEventListener('pointercancel', pointer, true);
    window.addEventListener('lostpointercapture', pointer, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', cancelActive);
      window.removeEventListener('pointercancel', pointer, true);
      window.removeEventListener('lostpointercapture', pointer, true);
      cancelActive();
    };
  }, []);
}
