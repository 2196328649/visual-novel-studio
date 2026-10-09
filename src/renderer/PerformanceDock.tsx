import { editorLayoutEvent, readDockLayout } from '../core/editor-layout';
import { useEffect, useRef, useState, type ReactNode } from 'react';

const slots = ['left', 'top', 'bottom', 'right'] as const;
type Slot = typeof slots[number];
type Panel = 'library' | 'preview' | 'timeline' | 'inspector';
const names: Record<Panel, string> = { library: '素材', preview: '预览', timeline: '时间轴', inspector: '属性' };
const positions: Record<Slot, string> = { left: '左侧', top: '中间上方', bottom: '中间下方', right: '右侧' };
const defaults = () => ({ left: 18, right: 24, top: 60, panels: { left: 'library', top: 'preview', bottom: 'timeline', right: 'inspector' } as Record<Slot, Panel> });
const key = 'vns-performance-dock-v1';
function readLayout() {
  return readDockLayout(localStorage, 'timeline');
}

export function PerformanceDock({ panels, minimumTimelineHeight }: { panels: Record<Panel, ReactNode>; minimumTimelineHeight?: number }) {
  const [layout, setLayout] = useState(readLayout);
  useEffect(()=>{const refresh=(event:Event)=>{if((event as CustomEvent<string>).detail===key)setLayout(readLayout());};window.addEventListener(editorLayoutEvent,refresh);return()=>window.removeEventListener(editorLayoutEvent,refresh);},[]);
  const [dragging, setDragging] = useState<Slot>();
  const root = useRef<HTMLDivElement>(null);
  const resize = useRef<{ axis: 'left' | 'right' | 'top'; x: number; y: number; value: number; extent: number } | undefined>(undefined);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(layout)); } catch { /* Keep the current session layout. */ } }, [layout]);
  const swap = (from: Slot, to: Slot) => setLayout(current => ({ ...current, panels: { ...current.panels, [from]: current.panels[to], [to]: current.panels[from] } }));
  const setSize = (axis: 'left' | 'right' | 'top', value: number) => setLayout(current => ({ ...current, [axis]: Math.max(axis === 'top' ? 35 : axis === 'left' ? 12 : 15, Math.min(axis === 'top' ? 85 : axis === 'left' ? 30 : 32, value)) }));
  return <div ref={root} className="performance-timeline performance-dock" aria-label="演出轨道编辑器" style={{ gridTemplateColumns: `${layout.left}fr 6px ${100 - layout.left - layout.right}fr 6px ${layout.right}fr`, gridTemplateRows: `minmax(${layout.panels.top === 'timeline' ? minimumTimelineHeight ?? 150 : 150}px, ${layout.top}fr) 6px minmax(${layout.panels.bottom === 'timeline' ? minimumTimelineHeight ?? 200 : 200}px, ${100 - layout.top}fr)` }}>
    {slots.map(slot => {
      const panel = layout.panels[slot];
      return <section key={panel} className={'performance-dock-panel dock-' + slot} data-dock-panel={panel} data-dock-slot={slot} aria-label={names[panel] + '面板'}
        onDragOver={event => { if (event.dataTransfer.types.includes('application/vns-performance-panel')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
        onDrop={event => { const from = event.dataTransfer.getData('application/vns-performance-panel') as Slot; if (slots.includes(from)) { event.preventDefault(); swap(from, slot); setDragging(undefined); } }}>
        <header className="performance-dock-title" draggable onDragStart={event => { event.dataTransfer.setData('application/vns-performance-panel', slot); event.dataTransfer.effectAllowed = 'move'; setDragging(slot); }} onDragEnd={() => setDragging(undefined)} title="拖到另一个面板以交换位置">
          <strong>{names[panel]}</strong>
          {panel === 'library' && <button type="button" className="small-button" aria-label="恢复默认演出布局" title="素材在左，时间轴在下" onClick={() => setLayout(defaults())}>重置布局</button>}
        </header>
        <div className="performance-dock-content">{panels[panel]}</div>
        {dragging && dragging !== slot && <div className="performance-dock-drop">交换到{positions[slot]}</div>}
      </section>;
    })}
    {(['left', 'right', 'top'] as const).map(axis => <div key={axis} className={'performance-dock-divider divider-' + axis} role="separator" tabIndex={0} aria-label={axis === 'top' ? '调整预览与时间轴高度' : axis === 'left' ? '调整左侧面板宽度' : '调整右侧面板宽度'} aria-orientation={axis === 'top' ? 'horizontal' : 'vertical'} aria-valuenow={Math.round(layout[axis])} aria-valuemin={axis === 'top' ? 35 : axis === 'left' ? 12 : 15} aria-valuemax={axis === 'top' ? 85 : axis === 'left' ? 30 : 32}
      onDoubleClick={() => setSize(axis, defaults()[axis])}
      onKeyDown={event => { const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 2 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -2 : 0; if (event.key === 'Home' || delta) { event.preventDefault(); setSize(axis, event.key === 'Home' ? defaults()[axis] : layout[axis] + delta * (axis === 'right' ? -1 : 1)); } }}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); resize.current = { axis, x: event.clientX, y: event.clientY, value: layout[axis], extent: axis === 'top' ? root.current!.clientHeight : root.current!.clientWidth }; }}
      onPointerMove={event => { const current = resize.current; if (current?.axis === axis) setSize(axis, current.value + (axis === 'top' ? event.clientY - current.y : (event.clientX - current.x) * (axis === 'right' ? -1 : 1)) * 100 / current.extent); }}
      onPointerUp={event => { resize.current = undefined; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { resize.current = undefined; }} onLostPointerCapture={() => { resize.current = undefined; }} />)}
  </div>;
}
