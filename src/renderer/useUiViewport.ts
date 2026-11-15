import { useCallback, useLayoutEffect, useRef, useState } from 'react';

type View = { zoom: number | null; left: number; top: number };

/** Authoring-only camera memory, never stored in a project or a preview value. */
export function useUiViewport(width: number, height: number, scopeKey = 'preview') {
  const container = useRef<HTMLDivElement | null>(null);
  const cleanup = useRef<(() => void) | undefined>(undefined);
  const views = useRef(new Map<string, View>());
  const [size, setSize] = useState({ width: 500, height: 400 });
  const [current, setCurrent] = useState<{ key: string; zoom: number | null }>({ key: scopeKey, zoom: null });
  const zoom = current.key === scopeKey ? current.zoom : views.current.get(scopeKey)?.zoom ?? null;
  const scale = zoom ?? Math.max(.01, Math.min(size.width / width, size.height / height));
  const anchor = useRef<{ key: string; x: number; y: number; clientX: number; clientY: number } | undefined>(undefined);
  const restoring = useRef<{ key: string; left: number; top: number } | undefined>(undefined);
  const latest = useRef({ scale, zoom, scopeKey }); latest.current = { scale, zoom, scopeKey };
  const change = useCallback((next: number | null, point?: { clientX: number; clientY: number }) => {
    if (next !== null && !Number.isFinite(next)) return;
    const element = container.current, surface = element?.querySelector<HTMLElement>('[data-ui-zoom-surface]');
    if (element && surface) {
      const bounds = surface.getBoundingClientRect(), viewport = element.getBoundingClientRect();
      const clientX = point?.clientX ?? viewport.left + element.clientWidth / 2;
      const clientY = point?.clientY ?? viewport.top + element.clientHeight / 2;
      anchor.current = { key: scopeKey, x: (clientX - bounds.left) / latest.current.scale, y: (clientY - bounds.top) / latest.current.scale, clientX, clientY };
    }
    restoring.current = undefined;
    const value = next === null ? null : Math.round(Math.min(4, Math.max(.1, next)) * 1000) / 1000;
    const previous = views.current.get(scopeKey);
    views.current.set(scopeKey, { zoom: value, left: element?.scrollLeft ?? previous?.left ?? 0, top: element?.scrollTop ?? previous?.top ?? 0 });
    setCurrent({ key: scopeKey, zoom: value });
  }, [scopeKey]);
  const observe = useCallback((element: HTMLDivElement | null) => {
    cleanup.current?.(); cleanup.current = undefined; container.current = element; anchor.current = undefined;
    if (!element) return;
    const saved = views.current.get(scopeKey);
    const pending = { key: scopeKey, left: saved?.left ?? 0, top: saved?.top ?? 0 };
    restoring.current = pending;
    const measure = (width: number, height: number) => {
      if (width > 0 && height > 0) setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    const style = getComputedStyle(element);
    measure(element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
    const observer = new ResizeObserver(entries => measure(entries[0].contentRect.width, entries[0].contentRect.height));
    const remember = () => {
      // Ref cleanup can run before the first layout (including StrictMode). Do not
      // replace a saved camera with the new element's temporary zero scroll.
      if (restoring.current === pending) return;
      const previous = views.current.get(scopeKey);
      views.current.set(scopeKey, { zoom: latest.current.scopeKey === scopeKey ? latest.current.zoom : previous?.zoom ?? null, left: element.scrollLeft, top: element.scrollTop });
    };
    const wheel = (event: WheelEvent) => {
      if (!event.deltaY) return;
      restoring.current = undefined;
      if (!event.ctrlKey) return;
      event.preventDefault(); event.stopPropagation();
      change(latest.current.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), event);
    };
    // The synchronous content measurement above is committed before this frame.
    // An explicit component locate runs a frame later and intentionally wins.
    const frame = requestAnimationFrame(() => {
      if (restoring.current !== pending || container.current !== element) return;
      element.scrollLeft = pending.left; element.scrollTop = pending.top;
      restoring.current = undefined; remember();
    });
    observer.observe(element); element.addEventListener('wheel', wheel, { passive: false }); element.addEventListener('scroll', remember, { passive: true });
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      // React may already have removed siblings and clamped this scroller.
      // Keep the last live scroll snapshot, not the partially dismantled layout.
      disposed = true; cancelAnimationFrame(frame); observer.disconnect();
      element.removeEventListener('wheel', wheel); element.removeEventListener('scroll', remember);
      if (restoring.current === pending) restoring.current = undefined;
      if (container.current === element) container.current = null;
      if (cleanup.current === dispose) cleanup.current = undefined;
    };
    cleanup.current = dispose;
    return dispose;
  }, [change, scopeKey]);
  useLayoutEffect(() => {
    const element = container.current, surface = element?.querySelector<HTMLElement>('[data-ui-zoom-surface]'), point = anchor.current;
    if (!element || !surface || !point || point.key !== scopeKey) return;
    anchor.current = undefined;
    if (zoom === null) element.scrollLeft = element.scrollTop = 0;
    else {
      const bounds = surface.getBoundingClientRect();
      element.scrollLeft += bounds.left + point.x * scale - point.clientX;
      element.scrollTop += bounds.top + point.y * scale - point.clientY;
    }
    views.current.set(scopeKey, { zoom, left: element.scrollLeft, top: element.scrollTop });
  }, [scopeKey, scale, zoom]);
  return { observe, scale, fitting: zoom === null, change };
}
