import { useRef, useState } from 'react';
import type { VisualObject } from '../core/model';

type Frames = NonNullable<NonNullable<VisualObject['curves']>['x']>;
export function PropertyFrameTimeline({ frames, duration, label, start, onChange, onSeek, zoom, unit = '秒', labelWidth = 130 }: { frames: Frames; duration: number; label: string; start: number; onChange: (frames: Frames) => void; onSeek?: (time: number) => void; zoom?: number; unit?: string; labelWidth?: number }) {
  const gesture = useRef<{ index: number; x: number; at: number; scale: number; value: number } | undefined>(undefined);
  const [draft, setDraft] = useState<{ index: number; at: number }>();
  const end = Math.max(1, duration, ...frames.map(frame => frame.at));
  const cancel = () => { gesture.current = undefined; setDraft(undefined); };
  const commit = (index: number, at: number) => onChange(frames.map((frame, i) => i === index ? { ...frame, at } : frame));
  const move = (x: number) => {
    const g = gesture.current; if (!g) return;
    g.value = Math.max(0, Math.round((g.at + (x - g.x) / g.scale) * 20) / 20);
    setDraft({ index: g.index, at: g.value });
  };
  return <div aria-label={`${label}关键帧时间轴`} className={'property-frame-timeline' + (zoom ? ' property-frame-shared' : '')}>
    {!zoom && <div className="composition-ruler"><span>0 {unit}</span><span>{end.toFixed(2)} {unit}</span></div>}
    <div className="property-frame-track">
      {frames.map((frame, index) => { const at = draft?.index === index ? draft.at : frame.at;
        return <button key={index} className="property-frame-marker" aria-label={`${label}时间轴帧 ${index + 1}`} data-time={at} data-absolute-time={start + at} title={`${(zoom ? start + at : at).toFixed(2)} ${unit}；拖动调整，${onSeek ? 'Enter 定位，' : ''}Esc 取消`} style={{ left: zoom ? labelWidth + (start + at) * zoom : `${at / end * 100}%` }}
          onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId); gesture.current = { index, x: event.clientX, at, value: at, scale: zoom ?? event.currentTarget.parentElement!.getBoundingClientRect().width / end }; }}
          onPointerMove={event => { if (gesture.current?.index === index) move(event.clientX); }}
          onPointerUp={event => { const g = gesture.current; if (!g || g.index !== index) return; move(event.clientX); cancel(); if (g.value !== g.at) commit(index, g.value); else onSeek?.(start + g.at); }}
          onPointerCancel={cancel} onLostPointerCapture={cancel}
          onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); return; }
            if (gesture.current) return;
            if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); onChange(frames.filter((_, i) => i !== index)); }
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); commit(index, Math.max(0, Math.round((at + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : .1)) * 100) / 100)); }
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSeek?.(start + at); }
          }}>◆</button>;
      })}
    </div>
    {!zoom && <p className="muted">拖动菱形或用方向键调整{unit === '秒' ? '时间' : unit}，{onSeek ? 'Enter 定位，' : ''}Esc 取消拖动。</p>}
  </div>;
}
