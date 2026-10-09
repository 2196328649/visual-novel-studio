import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';
import { blueprintCatalog } from '../core/blueprint';
import { timelineNodeTypes } from '../core/performance-timeline';
import type { VisualObject } from '../core/model';

export function TimelineCreateMenu({ onCreate, onAudio, onCommand }: { onCreate: (content: VisualObject['content']) => void; onAudio?: () => void; onCommand?: (type: typeof timelineNodeTypes[number]) => void }) {
  const [point, setPoint] = useState<{ x: number; y: number; above: boolean }>();
  useEffect(() => {
    if (!point) return;
    const close = (event: Event) => { if (!(event.target as Element).closest('.timeline-create-menu, .timeline-create-button')) setPoint(undefined); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setPoint(undefined); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); };
  }, [point]);
  return <><button type="button" className="small-button timeline-create-button" aria-expanded={!!point} onClick={event => { const box = event.currentTarget.getBoundingClientRect(), above = box.top > innerHeight / 2; setPoint(point ? undefined : { x: Math.min(box.left, innerWidth - 240), y: above ? innerHeight - box.top : box.bottom, above }); }}><Plus size={14} />添加片段</button>{point && createPortal(<div role="menu" aria-label="添加片段菜单" className="timeline-add-menu timeline-floating-menu timeline-create-menu" style={{ left: point.x, ...(point.above ? { bottom: point.y } : { top: point.y }) }}>
    {(['image', 'video', 'text', 'solid', 'group', 'particles'] as const).map(content => <button key={content} role="menuitem" onClick={() => { setPoint(undefined); onCreate(content); }}>{{ image: '图片片段', video: '视频片段', text: '文字片段', solid: '色块片段', group: '组合片段', particles: '粒子效果' }[content]}</button>)}
    {onAudio && <button role="menuitem" onClick={() => { setPoint(undefined); onAudio(); }}>音频片段</button>}
    {onCommand && <details className="timeline-add-commands"><summary>演出指令</summary>{timelineNodeTypes.filter(type => type !== 'showChapter').map(type => <button role="menuitem" key={type} onClick={() => { setPoint(undefined); onCommand(type); }}>{blueprintCatalog[type].name}</button>)}</details>}
  </div>, document.body)}</>;
}

export function ClipMenuItems({ onSeek, onProperties, onDuplicate, onGroup, onEnter, onSave, onRemove }: { onSeek: () => void; onProperties: () => void; onDuplicate?: () => void; onGroup?: () => void; onEnter?: () => void; onSave?: () => void; onRemove: () => void }) {
  return <><button role="menuitem" autoFocus onClick={onSeek}>定位到片段开始</button><button role="menuitem" onClick={onProperties}>编辑片段属性</button>{onDuplicate && <button role="menuitem" onClick={onDuplicate}>复制片段</button>}{onGroup && <button role="menuitem" onClick={onGroup}>制作组合</button>}{onEnter && <button role="menuitem" onClick={onEnter}>进入组合</button>}{onSave && <button role="menuitem" onClick={onSave}>保存为组合资源</button>}<button role="menuitem" className="danger-text" onClick={onRemove}>删除片段</button></>;
}
