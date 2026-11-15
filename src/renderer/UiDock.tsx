import { defaultDockLayout, editorLayoutEvent, editorLayoutKeys, readDockLayout, writeDockLayout } from '../core/editor-layout';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

const slots = ['left', 'top', 'bottom', 'right'] as const;
type Slot = typeof slots[number];
type Panel = 'hierarchy' | 'canvas' | 'settings' | 'inspector';
const names: Record<Panel, string> = { hierarchy: '组件列表', canvas: '画布', settings: '页面设置', inspector: '组件属性' };
const positions: Record<Slot, string> = { left: '左侧', top: '中间上方', bottom: '中间下方', right: '右侧' };
const key = editorLayoutKeys.ui;
const defaults = (top = 74) => defaultDockLayout('ui', top);
function readLayout(storageKey: string, defaultTop=74) {
  return readDockLayout({ getItem: () => localStorage.getItem(storageKey) }, 'ui', defaultTop);
}

export function UiDock({ panels, panelActions, addComponent, storageKey = key, labels = names, compactSettings = false, autoSizeSettings = false, showReset = true, onToggleSettings, label = "界面面板布局", defaultTop=74 }: { panels: Record<Panel, ReactNode>; panelActions?: Partial<Record<Panel, ReactNode>>; defaultTop?:number; compactSettings?:boolean; autoSizeSettings?: boolean; showReset?: boolean; onToggleSettings?: () => void; addComponent?: ReactNode; storageKey?: string; labels?: Record<Panel, string>; label?: string }) {
  const [layout, setLayout] = useState(() => readLayout(storageKey,defaultTop));
  useEffect(()=>{const refresh=(event:Event)=>{if((event as CustomEvent<string>).detail===storageKey)setLayout(readLayout(storageKey,defaultTop));};window.addEventListener(editorLayoutEvent,refresh);return()=>window.removeEventListener(editorLayoutEvent,refresh);},[storageKey,defaultTop]);
  useEffect(() => { if (onToggleSettings && compactSettings && layout.panels.bottom !== 'settings') onToggleSettings(); }, [onToggleSettings, compactSettings, layout.panels.bottom]);
  const [dragging, setDragging] = useState<Slot>();
  const dragFromControl = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const resize = useRef<{ axis: 'left' | 'right' | 'top'; x: number; y: number; value: number; extent: number } | undefined>(undefined);
  useEffect(() => { try { writeDockLayout(localStorage, 'ui', layout, storageKey); } catch { /* Keep the current session layout. */ } }, [layout, storageKey]);
  const swap = (from: Slot, to: Slot) => setLayout(current => ({ ...current, panels: { ...current.panels, [from]: current.panels[to], [to]: current.panels[from] } }));
  const setSize = (axis: 'left' | 'right' | 'top', value: number) => { if (axis === 'top' && compactSettings && layout.panels.bottom === 'settings') onToggleSettings?.(); setLayout(current => ({ ...current, [axis]: Math.max(axis === 'top' ? 35 : axis === 'left' ? 12 : 15, Math.min(axis === 'top' ? 85 : axis === 'left' ? 30 : 32, value)) })); };
  const autoBottom = autoSizeSettings && layout.panels.bottom === 'settings';
  return <div ref={root} className="performance-timeline performance-dock ui-dock" data-auto-settings={autoBottom} aria-label={label} style={{ gridTemplateColumns: `${layout.left}fr 6px ${100 - layout.left - layout.right}fr 6px ${layout.right}fr`, gridTemplateRows: autoBottom ? 'minmax(150px, 1fr) 6px max-content' : compactSettings&&layout.panels.bottom==='settings'?"minmax(150px, 1fr) 6px " + (onToggleSettings ? '32px' : '76px'):`minmax(150px, ${layout.top}fr) 6px minmax(120px, ${100 - layout.top}fr)` }}>
    {slots.map(slot => {
      const panel = layout.panels[slot];
      return <section key={panel} className={'performance-dock-panel dock-' + slot} data-dock-panel={panel} data-dock-slot={slot} data-dock-collapsed={panel === 'settings' && compactSettings && !!onToggleSettings} aria-label={labels[panel] + '面板'}
        onDragOver={event => { if (event.dataTransfer.types.includes('application/vns-ui-panel')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
        onDrop={event => { const from = event.dataTransfer.getData('application/vns-ui-panel') as Slot; if (slots.includes(from)) { event.preventDefault(); swap(from, slot); setDragging(undefined); } }}>
        <header className="performance-dock-title" draggable onPointerDownCapture={event => {
          // Native dragstart targets the header even when the pointer starts on a control.
          // The settings disclosure fills its title, so it still drags the panel; a click without moving only toggles it.
          const target = event.target as Element;
          dragFromControl.current = !target.closest('.ui-dock-disclosure') && !!target.closest('button, input, select, textarea, a, summary, .ui-dock-actions');
        }} onDragStart={event => { if (dragFromControl.current) { event.preventDefault(); return; } event.dataTransfer.setData('application/vns-ui-panel', slot); event.dataTransfer.effectAllowed = 'move'; setDragging(slot); }} onDragEnd={() => setDragging(undefined)} title="拖到另一个面板以交换位置">
          {panel === 'settings' && onToggleSettings && slot === 'bottom' ? <button type="button" className="ui-dock-disclosure" aria-label="参数绑定" aria-expanded={!compactSettings} onClick={onToggleSettings}>{compactSettings ? <ChevronRight size={13} /> : <ChevronDown size={13} />}<strong>{labels[panel]}</strong></button> : <strong>{labels[panel]}</strong>}{panel === 'hierarchy' && addComponent}
          {(panelActions?.[panel] || panel === 'settings' && showReset) && <div className="ui-dock-actions">
            {panelActions?.[panel]}
            {panel === 'settings' && showReset && <button type="button" className="small-button" aria-label="恢复默认界面布局" title="只恢复编辑器面板的位置和尺寸" onClick={() => setLayout(defaults(defaultTop))}>恢复面板布局</button>}
          </div>}
        </header>
        <div className="performance-dock-content" hidden={panel === 'settings' && compactSettings && !!onToggleSettings}>{panels[panel]}</div>
        {dragging && dragging !== slot && <div className="performance-dock-drop">交换到{positions[slot]}</div>}
      </section>;
    })}
    {(['left', 'right', 'top'] as const).map(axis => axis === 'top' && autoBottom ? <div key={axis} className="ui-layout-divider performance-dock-divider divider-top" aria-hidden="true" /> : <div key={axis} className={'performance-dock-divider divider-' + axis} role="separator" tabIndex={0} aria-label={axis === 'top' ? autoSizeSettings ? `调整${labels[layout.panels.top]}与${labels[layout.panels.bottom]}高度` : '调整画布与页面设置高度' : axis === 'left' ? '调整左侧面板宽度' : '调整右侧面板宽度'} aria-orientation={axis === 'top' ? 'horizontal' : 'vertical'} aria-valuenow={Math.round(layout[axis])} aria-valuemin={axis === 'top' ? 35 : axis === 'left' ? 12 : 15} aria-valuemax={axis === 'top' ? 85 : axis === 'left' ? 30 : 32}
      onDoubleClick={() => setSize(axis, defaults(defaultTop)[axis])}
      onKeyDown={event => { const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 2 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -2 : 0; if (event.key === 'Home' || delta) { event.preventDefault(); setSize(axis, event.key === 'Home' ? defaults(defaultTop)[axis] : layout[axis] + delta * (axis === 'right' ? -1 : 1)); } }}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); resize.current = { axis, x: event.clientX, y: event.clientY, value: layout[axis], extent: axis === 'top' ? root.current!.clientHeight : root.current!.clientWidth }; }}
      onPointerMove={event => { const current = resize.current; if (current?.axis === axis) setSize(axis, current.value + (axis === 'top' ? event.clientY - current.y : (event.clientX - current.x) * (axis === 'right' ? -1 : 1)) * 100 / current.extent); }}
      onPointerUp={event => { resize.current = undefined; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { resize.current = undefined; }} onLostPointerCapture={() => { resize.current = undefined; }} />)}
  </div>;
}
