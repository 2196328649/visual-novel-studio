import { useEffect, useRef, type RefObject } from 'react';

/** Consume a wheel gesture in the popup, not in the editor behind it. */
export function useMenuWheel(ref: RefObject<HTMLElement | null>, move: (direction: number) => void, scrollSelector?: string) {
  const handler = useRef(move); handler.current = move;
  useEffect(() => {
    const element = ref.current; if (!element) return;
    let last = 0;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); event.stopPropagation();
      if (scrollSelector) { const list = element.querySelector<HTMLElement>(scrollSelector); if (list) list.scrollTop += event.deltaY * (event.deltaMode === 1 ? 24 : 1); return; }
      if (!event.deltaY || performance.now() - last < 65) return;
      last = performance.now(); handler.current(Math.sign(event.deltaY));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [ref, scrollSelector]);
}
export const moveMenuIndex = (index: number, direction: number, length: number) => length ? (index + direction + length) % length : 0;
