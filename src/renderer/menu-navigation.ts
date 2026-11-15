import { useEffect, type RefObject } from 'react';

/** Consume a wheel gesture in the popup, not in the editor behind it: it scrolls the list like its scrollbar. */
export function useMenuWheel(ref: RefObject<HTMLElement | null>, scrollSelector: string) {
  useEffect(() => {
    const element = ref.current; if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); event.stopPropagation();
      const list = element.querySelector<HTMLElement>(scrollSelector);
      if (list) list.scrollTop += event.deltaY * (event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? list.clientHeight : 1);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [ref, scrollSelector]);
}
export const moveMenuIndex = (index: number, direction: number, length: number) => length ? (index + direction + length) % length : 0;
