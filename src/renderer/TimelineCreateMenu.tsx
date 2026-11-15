import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';
import { blueprintCatalog } from '../core/blueprint';
import { timelineNodeTypes } from '../core/performance-timeline';
import type { VisualObject } from '../core/model';

type MenuPoint = { x: number; y: number; above?: boolean; anchor?: HTMLElement };

/** Measure the real menu: commands, font size and wrapping all affect its size. */
function useTimelineMenuPlacement(point?: MenuPoint) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = menu.current;
    if (!point || !element) return;
    const position = () => {
      const bounds = element.getBoundingClientRect();
      const anchor = point.anchor?.isConnected ? point.anchor.getBoundingClientRect() : undefined;
      const above = anchor ? anchor.top > window.innerHeight / 2 : point.above;
      const x = anchor?.left ?? point.x, y = anchor ? above ? anchor.top : anchor.bottom : point.y;
      element.style.left = Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8)) + 'px';
      element.style.top = Math.max(8, Math.min(y - (above ? bounds.height : 0), window.innerHeight - bounds.height - 8)) + 'px';
    };
    position();
    const observer = new ResizeObserver(position); observer.observe(element);
    if (point.anchor) observer.observe(point.anchor);
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [point]);
  return menu;
}

export function TimelineContextMenu({ point, label, children }: { point: MenuPoint; label: string; children: ReactNode }) {
  const menu = useTimelineMenuPlacement(point);
  return createPortal(<div ref={menu} className="timeline-context-menu" role="menu" aria-label={label} style={{ left: point.x, top: point.y }} onKeyDown={event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  }}>{children}</div>, document.body);
}

export function TimelineCreateMenu({ onCreate, onAudio, onCommand }: { onCreate: (content: VisualObject['content']) => void; onAudio?: () => void; onCommand?: (type: typeof timelineNodeTypes[number]) => void }) {
  const [point, setPoint] = useState<MenuPoint>();
  const menu = useTimelineMenuPlacement(point);
  useEffect(() => {
    if (!point) return;
    const close = (event: Event) => { if (!(event.target as Element).closest('.timeline-create-menu, .timeline-create-button')) setPoint(undefined); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setPoint(undefined); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); };
  }, [point]);
  return <><button type="button" className="small-button timeline-create-button" aria-expanded={!!point} onClick={event => { const anchor = event.currentTarget, box = anchor.getBoundingClientRect(), above = box.top > innerHeight / 2; setPoint(point ? undefined : { x: box.left, y: above ? box.top : box.bottom, above, anchor }); }}><Plus size={14} />添加片段</button>{point && createPortal(<div ref={menu} role="menu" aria-label="添加片段菜单" className="timeline-add-menu timeline-floating-menu timeline-create-menu" style={{ left: point.x, top: point.y }}>
    {(['image', 'video', 'text', 'solid', 'group', 'particles'] as const).map(content => <button key={content} role="menuitem" onClick={() => { setPoint(undefined); onCreate(content); }}>{{ image: '图片片段', video: '视频片段', text: '文字片段', solid: '色块片段', group: '组合片段', particles: '粒子效果' }[content]}</button>)}
    {onAudio && <button role="menuitem" onClick={() => { setPoint(undefined); onAudio(); }}>音频片段</button>}
    {onCommand && <details className="timeline-add-commands"><summary>演出指令</summary>{timelineNodeTypes.filter(type => type !== 'showChapter').map(type => <button role="menuitem" key={type} onClick={() => { setPoint(undefined); onCommand(type); }}>{blueprintCatalog[type].name}</button>)}</details>}
  </div>, document.body)}</>;
}

export function ClipMenuItems({ onSeek, onProperties, onDuplicate, onGroup, onEnter, onSave, onRemove }: { onSeek: () => void; onProperties: () => void; onDuplicate?: () => void; onGroup?: () => void; onEnter?: () => void; onSave?: () => void; onRemove: () => void }) {
  return <><button role="menuitem" autoFocus onClick={onSeek}>定位到片段开始</button><button role="menuitem" onClick={onProperties}>编辑片段属性</button>{onDuplicate && <button role="menuitem" onClick={onDuplicate}>复制片段</button>}{onGroup && <button role="menuitem" onClick={onGroup}>制作组合</button>}{onEnter && <button role="menuitem" onClick={onEnter}>进入组合</button>}{onSave && <button role="menuitem" onClick={onSave}>保存为组合资源</button>}<button role="menuitem" className="danger-text" onClick={onRemove}>删除片段</button></>;
}
