import { useRef, useState } from 'react';
import type { TimelineLifetime } from '../core/performance-timeline';

export function LifetimeSpan({ row, zoom, onSelect, onOpen, onEdit }: { row: TimelineLifetime; zoom: number; onSelect: () => void; onOpen?: () => void; onEdit?: (delta: number, resize: boolean) => void }) {
  const gesture = useRef<{ x: number; delta: number; resize: boolean } | undefined>(undefined);
  const [draft, setDraft] = useState<{ delta: number; resize: boolean }>();
  const cancel = () => { gesture.current = undefined; setDraft(undefined); };
  const move = (x: number) => { const g = gesture.current; if (!g) return; g.delta = Math.round((x - g.x) / zoom * 20) / 20; setDraft({ delta: g.delta, resize: g.resize }); };
  const at = row.at + (draft && !draft.resize ? draft.delta : 0), length = Math.max(.05, row.until - row.at + (draft?.resize ? draft.delta : 0));
  return <button className="lifetime-span" data-instance-id={row.instanceId} data-start={row.at} data-end={row.until} style={{ left: 130 + at * zoom, width: Math.max(12, length * zoom), borderRightStyle: row.openEnded ? 'dashed' : 'solid', touchAction: 'none' }} title={`${row.name}：${row.at.toFixed(2)} 秒${row.openEnded ? '起持续显示' : `至 ${row.until.toFixed(2)} 秒`}${onEdit ? '；拖动移动，右边缘调整时长，Esc 取消' : ''}`}
    onClick={() => { if (!onEdit) onSelect(); }}
    onDoubleClick={event => { event.stopPropagation(); (onOpen ?? onSelect)(); }}
    onPointerDown={event => { if (!onEdit || event.button !== 0) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); gesture.current = { x: event.clientX, delta: 0, resize: (event.target as HTMLElement).dataset.resize === 'lifetime' }; }}
    onPointerMove={event => move(event.clientX)}
    onPointerUp={event => { const g = gesture.current; if (!g) return; move(event.clientX); cancel(); if (g.delta) onEdit?.(g.delta, g.resize); onSelect(); }}
    onPointerCancel={cancel} onLostPointerCapture={cancel}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (event.key === 'Enter') (onOpen ?? onSelect)(); else onSelect(); } else if (onEdit && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onEdit((event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : .1), event.altKey); } }}>
    {row.openEnded ? '持续 →' : `${length.toFixed(2)}s`}{onEdit && <i data-resize="lifetime" className="composition-resize" title="调整子对象时长" />}
  </button>;
}
