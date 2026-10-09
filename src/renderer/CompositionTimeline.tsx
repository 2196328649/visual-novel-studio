import { useRef, useState } from 'react';
import type { VisualObject } from '../core/model';
import { retimeVisualObject } from '../core/visual-object';

type Timing = { startAt: number; duration: number };
type Gesture = Timing & { index: number; x: number; pixelsPerSecond: number; resize: boolean; current: Timing };

export function CompositionTimeline({ object, onChange, onSeek, onOpenObject, start }: { object: VisualObject; onChange: (object: VisualObject) => void; onSeek?: (time: number) => void; onOpenObject?: (instanceId: string) => void; start: number }) {
  const gesture = useRef<Gesture | undefined>(undefined);
  const [draft, setDraft] = useState<{ index: number; timing: Timing }>();
  const cancel = () => { gesture.current = undefined; setDraft(undefined); };
  const children = object.children ?? [];
  const end = Math.max(1, object.duration, ...children.map(child => (child.startAt ?? 0) + child.duration));
  const commit = (index: number, timing: Timing) => onChange({ ...object, children: children.map((child, i) => i === index ? { ...(child.retimeOnDuration ? retimeVisualObject(child, timing.duration) : child), ...timing } : child) });
  const update = (x: number) => {
    const current = gesture.current;
    if (!current) return;
    const delta = (x - current.x) / current.pixelsPerSecond;
    const value = Math.max(0, Math.round(((current.resize ? current.duration : current.startAt) + delta) * 20) / 20);
    current.current = { startAt: current.resize ? current.startAt : value, duration: current.resize ? value : current.duration };
    setDraft({ index: current.index, timing: current.current });
  };
  return <section className="composition-timeline" aria-label="组合内部时间轴">
    <div className="composition-ruler"><span>0 秒</span><span>{end.toFixed(2)} 秒</span></div>
    {children.map((child, index) => {
      const timing = draft?.index === index ? draft.timing : { startAt: child.startAt ?? 0, duration: child.duration };
      return <div key={child.instanceId} className="composition-row">
        {onOpenObject ? <button type="button" className="composition-row-name" title={child.name + ' · 点击详细编辑'} aria-label={'详细编辑子对象 ' + child.name} onClick={() => onOpenObject(child.instanceId)}>{child.name}</button> : <span className="composition-row-name" title={child.name}>{child.name}</span>}
        <div className="composition-track">
          <i className="composition-end" style={{ left: `${object.duration / end * 100}%` }} title="组合结束" />
          <div role="button" tabIndex={0} aria-label={`移动子对象 ${child.name}`} className="composition-clip" data-start={timing.startAt} data-duration={timing.duration} title={`${timing.startAt.toFixed(2)}–${(timing.startAt + timing.duration).toFixed(2)} 秒；拖动移动，右边缘调整时长`} style={{ left: `${timing.startAt / end * 100}%`, width: `${timing.duration / end * 100}%` }}
            onDoubleClick={event => { event.stopPropagation(); onOpenObject?.(child.instanceId); }}
            onPointerDown={event => {
              if (event.button !== 0) return;
              event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
              gesture.current = { index, ...timing, current: timing, x: event.clientX, pixelsPerSecond: event.currentTarget.parentElement!.getBoundingClientRect().width / end, resize: (event.target as HTMLElement).dataset.resize === 'true' };
            }}
            onPointerMove={event => { if (gesture.current?.index === index) update(event.clientX); }}
            onPointerUp={event => {
              const current = gesture.current;
              if (!current || current.index !== index) return;
              update(event.clientX); gesture.current = undefined; setDraft(undefined);
              if (current.current.startAt !== current.startAt || current.current.duration !== current.duration) commit(index, current.current);
              else onSeek?.(start + current.startAt);
            }}
            onPointerCancel={cancel}
            onLostPointerCapture={cancel}
            onKeyDown={event => {
              if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); cancel(); return; }
              if (gesture.current) return;
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (event.key === 'Enter' && onOpenObject) onOpenObject(child.instanceId); else onSeek?.(start + timing.startAt); }
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); const key = event.altKey ? 'duration' : 'startAt'; commit(index, { ...timing, [key]: Math.max(0, Math.round((timing[key] + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : .1)) * 100) / 100) }); }
            }}>
            <span>{timing.duration.toFixed(2)}s</span><i data-resize="true" className="composition-resize" title="拖动调整子对象时长" />
          </div>
        </div>
      </div>;
    })}
    <p className="muted">拖动片段移动，拖动右边缘调整时长，Esc 取消拖动。方向键移动，Alt＋方向键调整时长；竖线标记组合结束。</p>
  </section>;
}
