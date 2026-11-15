import { useMemo, useRef, useState } from 'react';
import type { TimelineLifetime } from '../core/performance-timeline';
import { releaseTimelinePointer, useTimelineGestureCancellation, type TimelinePointerCapture } from './useTimelineGestureCancellation';

export function LifetimeSpan({ row, zoom, onSelect, onOpen, onEdit, context }: { row: TimelineLifetime; zoom: number; onSelect: () => void; onOpen?: () => void; onEdit?: (delta: number, resize: boolean) => void; context?: unknown }) {
  const revision = useMemo(() => ({}), [context, row.nodeId, row.instanceId, row.at, row.until, zoom, !!onEdit]);
  const gesture = useRef<(TimelinePointerCapture & { x: number; delta: number; resize: boolean; revision: object }) | undefined>(undefined);
  const [draft, setDraft] = useState<{ delta: number; resize: boolean }>();
  const cancel = () => { const current = gesture.current; gesture.current = undefined; setDraft(undefined); releaseTimelinePointer(current); };
  useTimelineGestureCancellation(cancel, () => [gesture.current], [revision]);
  const move = (x: number) => { const g = gesture.current; if (!g) return; if (g.revision !== revision) { cancel(); return; } g.delta = Math.round((x - g.x) / zoom * 20) / 20; setDraft({ delta: g.delta, resize: g.resize }); };
  const at = row.at + (draft && !draft.resize ? draft.delta : 0), length = Math.max(.05, row.until - row.at + (draft?.resize ? draft.delta : 0));
  return <button className="lifetime-span" data-instance-id={row.instanceId} data-start={row.at} data-end={row.until} style={{ left: 130 + at * zoom, width: Math.max(12, length * zoom), borderRightStyle: row.openEnded ? 'dashed' : 'solid', touchAction: 'none' }} title={`${row.name}：${row.at.toFixed(2)} 秒${row.openEnded ? '起持续显示' : `至 ${row.until.toFixed(2)} 秒`}${onEdit ? '；拖动移动，右边缘调整时长，Esc 取消' : ''}`}
    onClick={() => { if (!onEdit) onSelect(); }}
    onDoubleClick={event => { event.stopPropagation(); (onOpen ?? onSelect)(); }}
    onPointerDown={event => { if (!onEdit || event.button !== 0 || gesture.current) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId); gesture.current = { x: event.clientX, delta: 0, resize: (event.target as HTMLElement).dataset.resize === 'lifetime', revision, element: event.currentTarget, pointerId: event.pointerId }; }}
    onPointerMove={event => { if (gesture.current?.pointerId === event.pointerId) move(event.clientX); }}
    onPointerUp={event => { const g = gesture.current; if (!g || g.pointerId !== event.pointerId) return; move(event.clientX); if (gesture.current !== g) return; cancel(); if (g.delta) onEdit?.(g.delta, g.resize); onSelect(); }}
    onKeyDown={event => { if (event.nativeEvent.isComposing) return; if (event.key === 'Escape') { event.preventDefault(); cancel(); return; } if (gesture.current) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (event.key === 'Enter') (onOpen ?? onSelect)(); else onSelect(); } else if (onEdit && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onEdit((event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : .1), event.altKey); } }}>
    {row.openEnded ? '持续 →' : `${length.toFixed(2)}s`}{onEdit && <i data-resize="lifetime" className="composition-resize" title="调整子对象时长" />}
  </button>;
}
