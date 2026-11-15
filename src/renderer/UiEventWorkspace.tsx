import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen, RotateCcw } from 'lucide-react';
import { defaultUiEventLayout, editorLayoutEvent, editorLayoutKeys, readUiEventLayout, uiEventLayoutBounds, uiEventWorkspaceWidths, writeUiEventLayout } from '../core/editor-layout';
import './ui-event-workspace.css';

export interface UiEventWorkspaceProps {
  directory: ReactNode;
  canvas: ReactNode;
  details: ReactNode;
  directoryScroll?: { current: number };
  detailScrollKey?: string;
  detailScroll?: Map<string, number>;
  label?: string;
}

function readLayout() {
  try { return readUiEventLayout(localStorage); } catch { return defaultUiEventLayout(); }
}

/** A single sidebar: navigation stays above one independently scrolling detail editor. */
export function UiEventWorkspace({ directory, canvas, details, directoryScroll, detailScrollKey = '', detailScroll, label = '界面事件图工作区' }: UiEventWorkspaceProps) {
  const [layout, setLayout] = useState(readLayout);
  const [extent, setExtent] = useState({ width: 0, height: 0 });
  const [overlayOpen, setOverlayOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const directoryElement = useRef<HTMLDivElement>(null);
  const detailElement = useRef<HTMLDivElement>(null);
  const railButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const directoryButton = useRef<HTMLButtonElement>(null);
  const fallbackDirectoryScroll = useRef(0);
  const fallbackDetailScroll = useRef(new Map<string, number>());
  const restoringDirectory = useRef(false);
  const restoringDetails = useRef(false);
  const resize = useRef<{ axis: 'width' | 'height'; pointer: number; origin: number; value: number; extent: number } | undefined>(undefined);
  const currentLayout = useRef(layout);
  currentLayout.current = layout;
  const sidebarId = useId(), directoryId = useId(), detailsId = useId();
  const directoryMemory = directoryScroll ?? fallbackDirectoryScroll;
  const detailMemory = detailScroll ?? fallbackDetailScroll.current;
  const { narrow, sidebarWidth, maxSidebarWidth } = uiEventWorkspaceWidths(layout.sidebarWidth, extent.width);
  const sidebarVisible = narrow ? overlayOpen : !layout.sidebarCollapsed;
  const directoryVisible = sidebarVisible && !layout.directoryCollapsed;
  const usableHeight = Math.max(0, extent.height - uiEventLayoutBounds.divider);
  const directoryHeight = Math.min(Math.max(76, usableHeight * layout.directoryRatio / 100), Math.max(34, usableHeight - Math.min(132, usableHeight * .55)));

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth, height = element.clientHeight;
      setExtent(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const refresh = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== editorLayoutKeys.uiLogic) return;
      const next = readLayout();
      setLayout(next);
      // Explicit AI actions can open the temporary drawer in a narrow window.
      setOverlayOpen(!next.sidebarCollapsed);
    };
    window.addEventListener(editorLayoutEvent, refresh);
    return () => window.removeEventListener(editorLayoutEvent, refresh);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { writeUiEventLayout(localStorage, layout); } catch { /* The session remains usable without storage. */ }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [layout]);
  useEffect(() => () => {
    try { writeUiEventLayout(localStorage, currentLayout.current); } catch { /* Preserve the in-memory layout. */ }
  }, []);

  // The second assignment runs after portal content has mounted. Hiding the
  // sidebar never replaces these elements, their children, or the detail target.
  useLayoutEffect(() => {
    if (!directoryVisible || !directoryElement.current) return;
    const element = directoryElement.current, saved = directoryMemory.current;
    restoringDirectory.current = true;
    element.scrollTop = saved;
    const frame = requestAnimationFrame(() => { element.scrollTop = saved; restoringDirectory.current = false; });
    return () => { cancelAnimationFrame(frame); restoringDirectory.current = false; };
  }, [directoryMemory, directoryVisible]);
  useLayoutEffect(() => {
    if (!sidebarVisible || !detailElement.current) return;
    const element = detailElement.current, saved = detailMemory.get(detailScrollKey) ?? 0;
    restoringDetails.current = true;
    element.scrollTop = saved;
    const frame = requestAnimationFrame(() => { element.scrollTop = saved; restoringDetails.current = false; });
    return () => { cancelAnimationFrame(frame); restoringDetails.current = false; };
  }, [detailMemory, detailScrollKey, sidebarVisible]);

  const setWidth = (value: number) => setLayout(current => ({ ...current, sidebarWidth: Math.round(Math.max(uiEventLayoutBounds.sidebarMin, Math.min(maxSidebarWidth, value))) }));
  const setRatio = (value: number) => setLayout(current => ({ ...current, directoryRatio: Math.round(Math.max(uiEventLayoutBounds.directoryMin, Math.min(uiEventLayoutBounds.directoryMax, value))) }));
  const toggleSidebar = () => {
    if (narrow) setOverlayOpen(!sidebarVisible);
    else setLayout(current => ({ ...current, sidebarCollapsed: !current.sidebarCollapsed }));
    requestAnimationFrame(() => (sidebarVisible ? railButton : closeButton).current?.focus());
  };
  const finishResize = (element: HTMLDivElement, pointer: number) => {
    resize.current = undefined;
    if (element.hasPointerCapture(pointer)) element.releasePointerCapture(pointer);
  };

  return <div ref={root} className="ui-event-workspace" aria-label={label} data-sidebar-collapsed={!sidebarVisible} data-sidebar-overlay={narrow && sidebarVisible}
    style={{ gridTemplateColumns: `${narrow || !sidebarVisible ? uiEventLayoutBounds.rail : sidebarWidth}px ${narrow || !sidebarVisible ? 0 : uiEventLayoutBounds.divider}px minmax(0, 1fr)` }}>
    <aside className="ui-event-sidebar-rail" hidden={sidebarVisible} aria-label="事件图左栏已收起">
      <button ref={railButton} type="button" className="ui-event-panel-button" aria-label="展开事件图左栏" title="展开事件图左栏" aria-expanded={false} aria-controls={sidebarId} onClick={toggleSidebar}><PanelLeftOpen size={16} /></button>
      <span aria-hidden="true">我的界面</span>
    </aside>
    <aside id={sidebarId} className="ui-event-sidebar" hidden={!sidebarVisible} aria-label="我的界面与详情"
      style={{ width: narrow ? sidebarWidth : undefined, gridTemplateRows: layout.directoryCollapsed ? '34px 0 minmax(0, 1fr)' : `${directoryHeight}px ${uiEventLayoutBounds.divider}px minmax(0, 1fr)` }}
      onKeyDown={event => { if (narrow && event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); toggleSidebar(); } }}>
      <section className="ui-event-directory" aria-label="我的界面目录">
        <header className="ui-event-panel-heading">
          <button ref={directoryButton} type="button" className="ui-event-directory-toggle" aria-expanded={!layout.directoryCollapsed} aria-controls={directoryId} onClick={() => setLayout(current => ({ ...current, directoryCollapsed: !current.directoryCollapsed }))}>
            {layout.directoryCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}<strong>我的界面</strong>
          </button>
          <button ref={closeButton} type="button" className="ui-event-panel-button" aria-label="收起事件图左栏" title="收起事件图左栏" aria-expanded={true} aria-controls={sidebarId} onClick={toggleSidebar}><PanelLeftClose size={16} /></button>
        </header>
        <div id={directoryId} ref={directoryElement} className="ui-event-directory-scroll" hidden={layout.directoryCollapsed} onScroll={event => { if (directoryVisible && !restoringDirectory.current) directoryMemory.current = event.currentTarget.scrollTop; }}>{directory}</div>
      </section>
      <div className="ui-event-divider ui-event-height-divider" hidden={layout.directoryCollapsed} role="separator" tabIndex={0} aria-label="调整目录与详情高度" aria-orientation="horizontal" aria-controls={`${directoryId} ${detailsId}`} aria-valuemin={uiEventLayoutBounds.directoryMin} aria-valuemax={uiEventLayoutBounds.directoryMax} aria-valuenow={layout.directoryRatio} aria-valuetext={`目录占左栏 ${layout.directoryRatio}%`}
        onDoubleClick={() => setRatio(defaultUiEventLayout().directoryRatio)}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); setLayout(current => ({ ...current, directoryCollapsed: true })); directoryButton.current?.focus(); return; }
          const delta = event.key === 'ArrowDown' ? 2 : event.key === 'ArrowUp' ? -2 : 0;
          if (event.key === 'Home' || event.key === 'End' || delta) { event.preventDefault(); setRatio(event.key === 'Home' ? uiEventLayoutBounds.directoryMin : event.key === 'End' ? uiEventLayoutBounds.directoryMax : layout.directoryRatio + delta * (event.shiftKey ? 5 : 1)); }
        }}
        onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); resize.current = { axis: 'height', pointer: event.pointerId, origin: event.clientY, value: directoryHeight * 100 / Math.max(1, usableHeight), extent: Math.max(1, usableHeight) }; }}
        onPointerMove={event => { const current = resize.current; if (current?.axis === 'height' && current.pointer === event.pointerId) setRatio(current.value + (event.clientY - current.origin) * 100 / current.extent); }}
        onPointerUp={event => finishResize(event.currentTarget, event.pointerId)} onPointerCancel={event => finishResize(event.currentTarget, event.pointerId)} onLostPointerCapture={() => { resize.current = undefined; }} />
      <section className="ui-event-details" aria-label="详情">
        <header className="ui-event-panel-heading"><strong>详情</strong><button type="button" className="ui-event-panel-button" aria-label="恢复默认事件图布局" title="恢复默认宽度、目录高度和展开状态" onClick={() => { setLayout(defaultUiEventLayout()); setOverlayOpen(false); }}><RotateCcw size={14} /></button></header>
        <div id={detailsId} ref={detailElement} className="ui-event-detail-scroll" onScroll={event => { if (sidebarVisible && !restoringDetails.current) detailMemory.set(detailScrollKey, event.currentTarget.scrollTop); }}>{details}</div>
      </section>
    </aside>
    <div className="ui-event-divider ui-event-width-divider" hidden={!sidebarVisible || narrow} role="separator" tabIndex={0} aria-label="调整事件图左栏宽度" aria-orientation="vertical" aria-controls={sidebarId} aria-valuemin={uiEventLayoutBounds.sidebarMin} aria-valuemax={Math.max(uiEventLayoutBounds.sidebarMin, Math.floor(maxSidebarWidth))} aria-valuenow={Math.round(sidebarWidth)} aria-valuetext={`${Math.round(sidebarWidth)} 像素`}
      onDoubleClick={() => setWidth(defaultUiEventLayout().sidebarWidth)}
      onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); toggleSidebar(); return; }
        const delta = event.key === 'ArrowRight' ? 8 : event.key === 'ArrowLeft' ? -8 : 0;
        if (event.key === 'Home' || event.key === 'End' || delta) { event.preventDefault(); setWidth(event.key === 'Home' ? uiEventLayoutBounds.sidebarMin : event.key === 'End' ? maxSidebarWidth : sidebarWidth + delta * (event.shiftKey ? 4 : 1)); }
      }}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); resize.current = { axis: 'width', pointer: event.pointerId, origin: event.clientX, value: sidebarWidth, extent: 1 }; }}
      onPointerMove={event => { const current = resize.current; if (current?.axis === 'width' && current.pointer === event.pointerId) setWidth(current.value + event.clientX - current.origin); }}
      onPointerUp={event => finishResize(event.currentTarget, event.pointerId)} onPointerCancel={event => finishResize(event.currentTarget, event.pointerId)} onLostPointerCapture={() => { resize.current = undefined; }} />
    <section className="ui-event-canvas" aria-label="事件图画布">{canvas}</section>
  </div>;
}
