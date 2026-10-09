import { useEffect, useRef, useState, type PointerEvent } from 'react';

type Box = { left: number; top: number; width: number; height: number };

/** Select intersecting cards in content coordinates, including while edge-scrolling. */
export function useContentMarquee(selection: string[], onSelection: (keys: string[]) => void) {
  const surface = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box>();
  const gesture = useRef<{ x: number; y: number; clientX: number; clientY: number; base: string[]; mode: 'replace' | 'add' | 'toggle'; moved: boolean; pointerId: number } | undefined>(undefined);
  const frame = useRef(0);
  const current = useRef(selection); current.current = selection;
  const change = useRef(onSelection); change.current = onSelection;
  const update = () => {
    const element = surface.current, drag = gesture.current;
    if (!element || !drag) return;
    const bounds = element.getBoundingClientRect();
    const x = Math.max(0, Math.min(element.clientWidth, drag.clientX - bounds.left)) + element.scrollLeft;
    const y = Math.max(0, Math.min(element.clientHeight, drag.clientY - bounds.top)) + element.scrollTop;
    if (Math.hypot(x - drag.x, y - drag.y) >= 4) drag.moved = true;
    if (!drag.moved) return;
    const area = { left: Math.min(x, drag.x), top: Math.min(y, drag.y), width: Math.abs(x - drag.x), height: Math.abs(y - drag.y) };
    const hits = [...element.querySelectorAll<HTMLElement>('[data-content-key]')].filter(card => {
      const rect = card.getBoundingClientRect();
      const left = rect.left - bounds.left + element.scrollLeft, top = rect.top - bounds.top + element.scrollTop;
      return left <= area.left + area.width && left + rect.width >= area.left && top <= area.top + area.height && top + rect.height >= area.top;
    }).map(card => card.dataset.contentKey!);
    const next = drag.mode === 'replace' ? hits : drag.mode === 'add' ? [...new Set([...drag.base, ...hits])] : [...drag.base.filter(key => !hits.includes(key)), ...hits.filter(key => !drag.base.includes(key))];
    setBox(area);
    if (next.length !== current.current.length || next.some((key, index) => key !== current.current[index])) { current.current = next; change.current(next); }
  };
  const tick = () => {
    const element = surface.current, drag = gesture.current;
    if (!element || !drag) return;
    if (drag.moved) {
      const bounds = element.getBoundingClientRect();
      const speed = (at: number, start: number, end: number) => at < start + 28 ? -Math.min(18, (start + 28 - at) / 3) : at > end - 28 ? Math.min(18, (at - end + 28) / 3) : 0;
      element.scrollTop += speed(drag.clientY, bounds.top, bounds.bottom);
      element.scrollLeft += speed(drag.clientX, bounds.left, bounds.right);
      update();
    }
    frame.current = requestAnimationFrame(tick);
  };
  const finish = (cancel = false) => {
    const drag = gesture.current;
    if (!drag) return false;
    if (cancel) change.current(drag.base);
    else { update(); if (!drag.moved && drag.mode === 'replace') change.current([]); }
    gesture.current = undefined; cancelAnimationFrame(frame.current); setBox(undefined);
    if (surface.current?.hasPointerCapture(drag.pointerId)) surface.current.releasePointerCapture(drag.pointerId);
    return true;
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return { surface, box, cancel: () => finish(true), events: {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || (event.target as Element).closest('[data-content-key], input, select, textarea, a')) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX - rect.left >= event.currentTarget.clientWidth || event.clientY - rect.top >= event.currentTarget.clientHeight) return;
      event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { x: event.clientX - rect.left + event.currentTarget.scrollLeft, y: event.clientY - rect.top + event.currentTarget.scrollTop, clientX: event.clientX, clientY: event.clientY, base: [...current.current], mode: event.ctrlKey || event.metaKey ? 'toggle' : event.shiftKey ? 'add' : 'replace', moved: false, pointerId: event.pointerId };
      frame.current = requestAnimationFrame(tick);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => { const drag = gesture.current; if (drag) { drag.clientX = event.clientX; drag.clientY = event.clientY; update(); } },
    onPointerUp: () => finish(), onPointerCancel: () => finish(true),
  } };
}
