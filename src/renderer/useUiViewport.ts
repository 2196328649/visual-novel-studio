import { useCallback, useLayoutEffect, useRef, useState } from 'react';

export function useUiViewport(width: number, height: number) {
  const container = useRef<HTMLDivElement | null>(null);
  const cleanup = useRef<(() => void) | undefined>(undefined);
  const [size, setSize] = useState({ width: 500, height: 400 });
  const [zoom, setZoom] = useState<number | null>(null);
  const fit = Math.min(size.width / width, size.height / height);
  const scale = zoom ?? Math.max(.01, fit);
  const anchor = useRef<{ x: number; y: number; clientX: number; clientY: number } | undefined>(undefined);
  const latest = useRef({ scale }); latest.current = { scale };
  const change = useCallback((next: number | null, point?: { clientX: number; clientY: number }) => {
    const element = container.current, surface = element?.querySelector<HTMLElement>('[data-ui-zoom-surface]');
    if (element && surface) {
      const bounds = surface.getBoundingClientRect(), viewport = element.getBoundingClientRect();
      const clientX = point?.clientX ?? viewport.left + element.clientWidth / 2;
      const clientY = point?.clientY ?? viewport.top + element.clientHeight / 2;
      anchor.current = { x: (clientX - bounds.left) / latest.current.scale, y: (clientY - bounds.top) / latest.current.scale, clientX, clientY };
    }
    setZoom(next === null ? null : Math.round(Math.min(4, Math.max(.1, next)) * 1000) / 1000);
  }, []);
  const observe = useCallback((element: HTMLDivElement | null) => {
    cleanup.current?.(); container.current = element;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      if (rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height });
    });
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !event.deltaY) return;
      event.preventDefault(); event.stopPropagation();
      change(latest.current.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), event);
    };
    observer.observe(element); element.addEventListener('wheel', wheel, { passive: false });
    const dispose = () => { observer.disconnect(); element.removeEventListener('wheel', wheel); };
    cleanup.current = dispose;
    return dispose;
  }, [change]);
  useLayoutEffect(() => {
    const element = container.current, surface = element?.querySelector<HTMLElement>('[data-ui-zoom-surface]'), point = anchor.current;
    if (!element || !surface || !point) return;
    anchor.current = undefined;
    if (zoom === null) { element.scrollLeft = element.scrollTop = 0; return; }
    const bounds = surface.getBoundingClientRect();
    element.scrollLeft += bounds.left + point.x * scale - point.clientX;
    element.scrollTop += bounds.top + point.y * scale - point.clientY;
  }, [scale, zoom]);
  return { observe, scale, fitting: zoom === null, change };
}
