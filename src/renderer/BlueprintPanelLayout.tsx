import { editorLayoutEvent, editorLayoutKeys, readBlueprintLayout, writeBlueprintLayout } from '../core/editor-layout';
import { useEffect, useRef, useState, type DragEvent } from 'react';
const defaults = readBlueprintLayout({ getItem: () => null });
type Panel = 'palette' | 'properties';

export function useBlueprintPanelLayout(paletteOpen: boolean, propertiesOpen: boolean) {
  const [layout, setLayout] = useState(() => readBlueprintLayout(localStorage));
  const { reversed } = layout;
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ side: Panel; x: number; width: number } | undefined>(undefined);
  useEffect(() => { try { writeBlueprintLayout(localStorage, layout); } catch { /* Keep session preferences. */ } }, [layout]);
  useEffect(() => {
    const refresh = (event: Event) => {
      if ((event as CustomEvent<string>).detail === editorLayoutKeys.blueprint) setLayout(readBlueprintLayout(localStorage));
    };
    window.addEventListener(editorLayoutEvent, refresh);
    return () => window.removeEventListener(editorLayoutEvent, refresh);
  }, []);

  const handle = (side: Panel) => ({
    draggable: true, title: '拖到另一侧面板标题交换位置',
    onDragStart: (event: DragEvent) => {
      event.stopPropagation(); event.dataTransfer.setData('application/vns-blueprint-panel', side); event.dataTransfer.effectAllowed = 'move';
    },
    onDragOver: (event: DragEvent) => {
      if (event.dataTransfer.types.includes('application/vns-blueprint-panel')) {
        event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
      }
    },
    onDrop: (event: DragEvent) => {
      const from = event.dataTransfer.getData('application/vns-blueprint-panel');
      if ((from === 'palette' || from === 'properties') && from !== side) {
        event.preventDefault(); event.stopPropagation(); setLayout(current => ({ ...current, reversed: !current.reversed }));
      }
    },
  });
  const direction = (side: Panel) => (side === 'palette' ? 1 : -1) * (reversed ? -1 : 1);
  const set = (side: Panel, value: number) => setLayout(current => ({ ...current, [side]: Math.max(side === 'palette' ? 140 : 180, Math.min(side === 'palette' ? 500 : 600, value)) }));
  const divider = (side: Panel) => <div key={'divider-' + side} className={'blueprint-panel-divider divider-' + side} role="separator" tabIndex={0}
    aria-label={side === 'palette' ? '调整节点库宽度' : '调整蓝图属性宽度'} aria-orientation="vertical" aria-valuenow={layout[side]} aria-valuemin={side === 'palette' ? 140 : 180} aria-valuemax={side === 'palette' ? 500 : 600}
    onDoubleClick={() => set(side, defaults[side])}
    onKeyDown={event => {
      const delta = event.key === 'ArrowRight' ? 10 : event.key === 'ArrowLeft' ? -10 : 0;
      if (delta || event.key === 'Home') { event.preventDefault(); set(side, event.key === 'Home' ? defaults[side] : layout[side] + delta * direction(side)); }
    }}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { side, x: event.clientX, width: layout[side] };
    }}
    onPointerMove={event => { const start = drag.current; if (start?.side === side) set(side, start.width + (event.clientX - start.x) * direction(side)); }}
    onPointerUp={event => { drag.current = undefined; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { drag.current = undefined; }} onLostPointerCapture={() => { drag.current = undefined; }} />;
  const columns = [
    ...(paletteOpen ? [`minmax(100px, min(28%, ${layout.palette}px))`, '6px'] : []),
    'minmax(160px, 1fr)',
    ...(propertiesOpen ? ['6px', `minmax(140px, min(36%, ${layout.properties}px))`] : []),
  ];
  return { root, reversed, handle, style: { gridTemplateColumns: (reversed ? columns.reverse() : columns).join(' ') }, divider };
}
