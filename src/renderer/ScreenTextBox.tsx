import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

export interface TextPlacement { x: number; y: number; width: number }
const round = (value: number) => +value.toFixed(4);
const snapCentre = (value: number) => Math.abs(value - .5) < .012 ? .5 : value;

/** Screen text the author can drag straight on the preview: the box moves the text centre,
 * the side handles change its width around the centre. Centre lines snap; Alt turns that off. */
export function ScreenTextBox({ placement, fontSize, align, onPlace, children }: { placement: TextPlacement; fontSize: number; align: 'left' | 'center' | 'right'; onPlace?: (placement: TextPlacement) => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<TextPlacement>();
  // The latest position, not the last rendered one: a release can arrive before the final move has rendered.
  const latest = useRef<TextPlacement>(undefined);
  const drag = useRef<{ start: TextPlacement; x: number; y: number; width: number; height: number; mode: 'move' | 'resize'; side: number; moved: boolean; id: number }>(undefined);
  const shown = draft ?? placement;
  useEffect(() => { if (!onPlace) { drag.current = undefined; setDraft(undefined); } }, [onPlace]);
  const begin = (event: ReactPointerEvent<HTMLElement>, mode: 'move' | 'resize', side = 0) => {
    const parent = box.current?.parentElement?.getBoundingClientRect();
    if (!onPlace || !parent?.width || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    box.current!.setPointerCapture(event.pointerId);
    drag.current = { start: placement, x: event.clientX, y: event.clientY, width: parent.width, height: parent.height, mode, side, moved: false, id: event.pointerId };
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    const dx = (event.clientX - active.x) / active.width, dy = (event.clientY - active.y) / active.height;
    if (!active.moved && Math.abs(event.clientX - active.x) + Math.abs(event.clientY - active.y) < 3) return;
    active.moved = true;
    const snap = event.altKey ? (value: number) => value : snapCentre;
    latest.current = active.mode === 'move' ? { ...active.start, x: snap(active.start.x + dx), y: snap(active.start.y + dy) } : { ...active.start, width: Math.max(.05, active.start.width + 2 * active.side * dx) };
    setDraft(latest.current);
  };
  const finish = (event: ReactPointerEvent<HTMLElement>) => {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    drag.current = undefined;
    if (box.current?.hasPointerCapture(event.pointerId)) box.current.releasePointerCapture(event.pointerId);
    if (active.moved && latest.current && event.type === 'pointerup') onPlace?.({ x: round(latest.current.x), y: round(latest.current.y), width: round(latest.current.width) });
    latest.current = undefined;
    setDraft(undefined);
  };
  const nudge = (event: ReactKeyboardEvent) => {
    const step = event.shiftKey ? .05 : .005;
    const change = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (event.key === 'Escape' && drag.current) { drag.current = undefined; setDraft(undefined); event.stopPropagation(); return; }
    if (!change || !onPlace) return;
    event.preventDefault(); event.stopPropagation();
    onPlace({ ...placement, x: round(placement.x + change[0]), y: round(placement.y + change[1]) });
  };
  const editable = !!onPlace;
  return <>
    {draft?.x === .5 && <div className="dialogue-screen-guide is-vertical" aria-hidden="true" />}
    {draft?.y === .5 && <div className="dialogue-screen-guide is-horizontal" aria-hidden="true" />}
    <div ref={box} className={`dialogue-screen-text${editable ? ' is-draggable' : ''}${draft ? ' is-dragging' : ''}`} data-text-placement="screen"
      style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.width * 100}%`, fontSize, textAlign: align }}
      {...(editable ? { role: 'group', tabIndex: 0, 'aria-label': '画面文字位置，可拖动或用方向键调整', title: '拖动调整位置；两侧手柄调整宽度；按住 Alt 不吸附中线' } : {})}
      onPointerDown={event => begin(event, 'move')} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onClick={editable ? event => event.stopPropagation() : undefined} onKeyDown={editable ? nudge : undefined}>
      {children}
      {editable && <><span className="dialogue-screen-handle is-left" aria-hidden="true" onPointerDown={event => begin(event, 'resize', -1)} /><span className="dialogue-screen-handle is-right" aria-hidden="true" onPointerDown={event => begin(event, 'resize', 1)} /></>}
    </div>
  </>;
}
