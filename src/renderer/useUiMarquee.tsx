import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { UiHierarchyRow } from '../core/ui-hierarchy';
import type { UiPixelRect, UiPoint } from '../core/ui-layout';
import { uiMarqueeCandidates, uiMarqueeHits, uiMarqueeRect, uiMarqueeSelection, type UiMarqueeCandidate, type UiMarqueeMode } from '../core/ui-marquee';
import { uiCanvasClickSelection, uiCanvasDragThreshold, uiCanvasHitIds, uiCanvasMoveTarget } from '../core/ui-canvas-selection';
import { useStableCallbacks } from './useStableCallbacks';
import type { useUiComponentTransform } from './useUiComponentTransform';
import { collectionPartAtPoint } from './UiCollectionEditing';

interface Options {
  canvas: RefObject<HTMLDivElement | null>; rows: readonly UiHierarchyRow[];
  width: number; height: number; scale: number; scope: string; revision: unknown; enabled: boolean;
  selectedIds: readonly string[]; selectMany: (ids: readonly string[]) => void;
  transform: Pick<ReturnType<typeof useUiComponentTransform>, 'beginMove' | 'move' | 'end' | 'cancel'>;
}
interface Gesture {
  surface: HTMLDivElement; canvas: HTMLDivElement; capture: HTMLElement; pointerId: number;
  kind: 'marquee' | 'move' | 'blocked'; hits: string[];
  scope: string; revision: unknown; selectionKey: string; scale: number;
  start: UiPoint; origin: UiPoint; pointer: UiPoint; moved: boolean;
  base: string[]; mode: UiMarqueeMode; candidates: UiMarqueeCandidate[];
  unitX: number; unitY: number; previousFrame: number;
}
interface ClickHistory {
  scope: string; revision: unknown; scale: number; selectionKey: string; point: UiPoint; hits: string[];
  canvas: DOMRect;
}
interface View { canvas: DOMRect; viewport: UiPixelRect; unitX: number; unitY: number; cssX: number; cssY: number }
const clamp = (value: number, start: number, length: number) => Math.max(start, Math.min(start + length, value));
const equalIds = (a: readonly string[] | undefined, b: readonly string[]) => !!a && a.length === b.length && a.every((id, index) => id === b[index]);
const interactive = '[data-transform-id],[data-resize-handle],.ui-native-region,[data-flow-node],[data-flow-controls],[data-flow-pagination],[data-flow-breadcrumb],button,input,select,textarea,a,summary,[role="button"],[role="scrollbar"],[contenteditable="true"]';
const internalInteractive = '[data-flow-node],[data-flow-controls],[data-flow-pagination],[data-flow-breadcrumb],[role="scrollbar"],.ui-story-flow-preview,.ui-flow-directory';

function measure(surface: HTMLDivElement, canvas: HTMLDivElement, width: number, height: number): View | undefined {
  const bounds = canvas.getBoundingClientRect(), outer = surface.getBoundingClientRect();
  if (!bounds.width || !bounds.height || !surface.offsetWidth || !surface.offsetHeight) return;
  const cssX = outer.width / surface.offsetWidth, cssY = outer.height / surface.offsetHeight;
  return { canvas: bounds, viewport: { x: outer.left + surface.clientLeft * cssX, y: outer.top + surface.clientTop * cssY, width: surface.clientWidth * cssX, height: surface.clientHeight * cssY },
    unitX: width / bounds.width, unitY: height / bounds.height, cssX, cssY };
}

/** Coordinates clicks, complete-frame marquee selection and moves. Selection is
 * committed only after a stationary click or completed marquee, never on press. */
export function useUiMarquee(options: Options) {
  const latest = useRef(options); latest.current = options;
  const gesture = useRef<Gesture | undefined>(undefined), frame = useRef(0);
  const layer = useRef<HTMLDivElement>(null), box = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const pendingClick = useRef<Gesture | undefined>(undefined), history = useRef<ClickHistory | undefined>(undefined);
  const [preview, setPreview] = useState<string[]>();
  const previewRef = useRef<string[] | undefined>(undefined);
  const selectionKey = JSON.stringify(options.selectedIds);
  const finishGesture = useCallback(() => {
    const drag = gesture.current; gesture.current = undefined;
    cancelAnimationFrame(frame.current); frame.current = 0;
    if (layer.current) layer.current.hidden = true;
    if (box.current) delete box.current.dataset.uiMarquee;
    if (previewRef.current) { previewRef.current = undefined; setPreview(undefined); }
    if (!drag) return;
    suppressClick.current = drag.moved;
    if (drag.kind === 'move') latest.current.transform.cancel();
    if (drag.capture.hasPointerCapture(drag.pointerId)) drag.capture.releasePointerCapture(drag.pointerId);
  }, []);
  const cancel = useCallback(() => {
    const active = !!gesture.current;
    pendingClick.current = undefined; history.current = undefined; finishGesture();
    if (active) suppressClick.current = true;
  }, [finishGesture]);
  const valid = (drag: Gesture) => {
    const current = latest.current;
    return current.enabled && current.scope === drag.scope && current.revision === drag.revision && current.scale === drag.scale
      && JSON.stringify(current.selectedIds) === drag.selectionKey && current.canvas.current === drag.canvas && drag.surface.isConnected;
  };
  const viewFor = (drag: Gesture) => {
    if (!valid(drag)) return;
    const view = measure(drag.surface, drag.canvas, latest.current.width, latest.current.height);
    if (!view || Math.abs(view.unitX - drag.unitX) > 1e-6 || Math.abs(view.unitY - drag.unitY) > 1e-6) return;
    return view;
  };
  const refresh = (drag: Gesture, view: View) => {
    const end = { x: clamp(drag.pointer.x, view.viewport.x, view.viewport.width), y: clamp(drag.pointer.y, view.viewport.y, view.viewport.height) };
    const area = uiMarqueeRect(drag.start, { x: (end.x - view.canvas.left) * view.unitX, y: (end.y - view.canvas.top) * view.unitY });
    const hits = uiMarqueeHits(drag.candidates, area, .03 * Math.max(view.unitX, view.unitY));
    const next = uiMarqueeSelection(drag.base, hits, drag.mode);
    if (!equalIds(previewRef.current, next)) { previewRef.current = next; setPreview(next); }
    if (layer.current && box.current) {
      const start = { x: view.canvas.left + drag.start.x / view.unitX, y: view.canvas.top + drag.start.y / view.unitY };
      const drawing = uiMarqueeRect(start, end);
      Object.assign(layer.current.style, { left: view.viewport.x + 'px', top: view.viewport.y + 'px', width: view.viewport.width + 'px', height: view.viewport.height + 'px' });
      Object.assign(box.current.style, { left: drawing.x - view.viewport.x + 'px', top: drawing.y - view.viewport.y + 'px', width: drawing.width + 'px', height: drawing.height + 'px' });
      box.current.dataset.uiMarquee = ''; layer.current.hidden = false;
    }
    return next;
  };
  const { tick } = useStableCallbacks({ tick: (time: number) => {
    frame.current = 0;
    const drag = gesture.current;
    if (!drag) return;
    let view = viewFor(drag);
    if (!view) { cancel(); return; }
    const elapsed = drag.previousFrame ? Math.min(32, time - drag.previousFrame) / (1000 / 60) : 1;
    drag.previousFrame = time;
    const speed = (value: number, start: number, length: number) => {
      const edge = Math.min(28, length / 4);
      return value < start + edge ? -Math.min(16, (start + edge - value) / 3) : value > start + length - edge ? Math.min(16, (value - start - length + edge) / 3) : 0;
    };
    const { surface } = drag, left = surface.scrollLeft, top = surface.scrollTop;
    surface.scrollLeft += speed(drag.pointer.x, view.viewport.x, view.viewport.width) * elapsed / view.cssX;
    surface.scrollTop += speed(drag.pointer.y, view.viewport.y, view.viewport.height) * elapsed / view.cssY;
    if (left !== surface.scrollLeft || top !== surface.scrollTop) view = viewFor(drag);
    if (!view) { cancel(); return; }
    refresh(drag, view); frame.current = requestAnimationFrame(tick);
  } });
  useLayoutEffect(() => {
    if (gesture.current) cancel();
    pendingClick.current = undefined;
    const previous = history.current;
    if (!options.enabled || previous && (previous.scope !== options.scope || previous.revision !== options.revision || previous.scale !== options.scale || previous.selectionKey !== selectionKey)) history.current = undefined;
  }, [options.scope, options.revision, options.enabled, options.width, options.height, options.scale, selectionKey, cancel]);
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase(), modifier = event.ctrlKey || event.metaKey;
      if (!gesture.current) { if (key === 'escape') history.current = undefined; return; }
      if (key === 'escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); }
      // Do not edit the old inspector selection while a different group is only
      // highlighted by the drag. Zoom remains available and cancels the gesture.
      else if (['delete', 'backspace', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key) || modifier && ['a', 'c', 'v', 'd', 'x', 'z', 'y'].includes(key)) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    };
    const pointerDown = (event: globalThis.PointerEvent) => {
      if (!gesture.current) suppressClick.current = false;
      pendingClick.current = undefined;
      if (event.button !== 0 || event.altKey || !(event.target instanceof Node) || !latest.current.canvas.current?.contains(event.target)
        || history.current && Math.hypot(event.clientX - history.current.point.x, event.clientY - history.current.point.y) >= uiCanvasDragThreshold) history.current = undefined;
    };
    const visibility = () => { if (document.hidden) cancel(); };
    window.addEventListener('keydown', keyDown, true); window.addEventListener('pointerdown', pointerDown, true); window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('keydown', keyDown, true); window.removeEventListener('pointerdown', pointerDown, true); window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', visibility); cancel();
    };
  }, [cancel]);
  const clickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (suppressClick.current && event.button === 0 && event.detail > 0) { event.preventDefault(); event.stopPropagation(); return; }
    const click = pendingClick.current; pendingClick.current = undefined;
    // Native double-clicks enter collection parts. Their second click must not
    // switch to a different object before UiCollectionCanvas receives dblclick.
    if (event.detail > 1 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
      && latest.current.canvas.current && collectionPartAtPoint(latest.current.canvas.current, event.clientX, event.clientY)) { history.current = undefined; return; }
    if (!click || event.button !== 0 || event.detail < 1 || !valid(click)) return;
    const current = latest.current, view = viewFor(click);
    if (!view || Math.hypot(event.clientX - click.pointer.x, event.clientY - click.pointer.y) >= uiCanvasDragThreshold) return;
    const previous = history.current;
    const repeat = !!previous && previous.scope === current.scope && previous.revision === current.revision && previous.scale === current.scale
      && previous.selectionKey === JSON.stringify(click.base) && equalIds(previous.hits, click.hits)
      && Math.hypot(previous.point.x - event.clientX, previous.point.y - event.clientY) < uiCanvasDragThreshold
      && (['left', 'top', 'width', 'height'] as const).every(key => Math.abs(previous.canvas[key] - view.canvas[key]) < .01);
    const next = click.mode === 'replace' ? uiCanvasClickSelection(current.rows, click.hits, click.base, current, repeat)
      : click.hits[0] ? uiMarqueeSelection(click.base, [click.hits[0]], 'toggle') : click.base;
    history.current = click.mode === 'replace' ? { scope: current.scope, revision: current.revision, scale: current.scale, selectionKey: JSON.stringify(next),
      point: { x: event.clientX, y: event.clientY }, hits: click.hits, canvas: view.canvas } : undefined;
    if (!equalIds(current.selectedIds, next)) current.selectMany(next);
  };
  const endCancelled = (event: PointerEvent<HTMLDivElement>) => { if (gesture.current?.pointerId === event.pointerId) cancel(); };
  const begin = (event: PointerEvent<HTMLDivElement>, component?: HTMLElement) => {
      const current = latest.current, canvas = current.canvas.current;
      if (!current.enabled || !canvas || gesture.current || event.button !== 0 || !event.isPrimary || event.altKey || event.defaultPrevented) return;
      if (!(event.target instanceof Element)) return;
      if (component ? !canvas.contains(component) : event.target.closest('.ui-component,' + interactive)) return;
      if (component && current.selectedIds.includes(component.dataset.componentId!) && event.target.closest(internalInteractive)) {
        history.current = undefined; pendingClick.current = undefined; return;
      }
      const surface = event.currentTarget, view = measure(surface, canvas, current.width, current.height);
      if (!view || event.clientX < view.viewport.x || event.clientY < view.viewport.y || event.clientX >= view.viewport.x + view.viewport.width || event.clientY >= view.viewport.y + view.viewport.height) return;
      const pointer = { x: event.clientX, y: event.clientY };
      const start = { x: (pointer.x - view.canvas.left) * view.unitX, y: (pointer.y - view.canvas.top) * view.unitY };
      const hits = uiCanvasHitIds(current.rows, start, current), moveId = component && !event.ctrlKey && !event.metaKey && !event.shiftKey
        ? uiCanvasMoveTarget(current.rows, hits, current.selectedIds, current) : undefined;
      const candidates = moveId ? [] : uiMarqueeCandidates(current.rows, current);
      const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
      if (component && !hits.includes(component.dataset.componentId!)) return;
      const capture = component ?? surface;
      const moved = moveId && current.transform.beginMove(moveId, event, capture);
      // Prevent nested design previews from acting before their object is chosen.
      event.preventDefault(); surface.focus({ preventScroll: true });
      // CSS quantizes lengths before applying rotation/scale. Cache the actual
      // un-clipped border boxes once, so even very large transforms match pixels.
      for (const element of canvas.querySelectorAll<HTMLElement>('[data-component-id]')) {
        const candidate = byId.get(element.dataset.componentId!);
        if (!candidate) continue;
        const rect = element.getBoundingClientRect();
        candidate.bounds = { x: (rect.left - view.canvas.left) * view.unitX, y: (rect.top - view.canvas.top) * view.unitY, width: rect.width * view.unitX, height: rect.height * view.unitY };
      }
      // Capturing on the original object preserves the native click/double-click
      // path through UiCollectionCanvas, including a first click while unselected.
      // A selected control that cannot move (for example a parameter-owned X/Y)
      // keeps its selection and the transform's problem message. A failed move
      // must not quietly reinterpret the gesture as a new marquee selection.
      gesture.current = { surface, canvas, capture, kind: moveId ? moved ? 'move' : 'blocked' : 'marquee', hits, pointerId: event.pointerId, scope: current.scope, revision: current.revision, selectionKey: JSON.stringify(current.selectedIds), scale: current.scale,
        start, origin: pointer, pointer, moved: false,
        base: [...current.selectedIds], mode: event.ctrlKey || event.metaKey ? 'toggle' : event.shiftKey ? 'add' : 'replace',
        candidates, unitX: view.unitX, unitY: view.unitY, previousFrame: 0 };
      capture.setPointerCapture(event.pointerId);
      return true;
  };
  return { previewIds: options.enabled ? preview : undefined, overlay: createPortal(<div ref={layer} className="ui-marquee-overlay" hidden aria-hidden="true"><div ref={box} className="ui-marquee" /></div>, document.body), events: {
    onPointerDownCapture: (event: PointerEvent<HTMLDivElement>) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('[data-transform-id]')) { history.current = undefined; pendingClick.current = undefined; return; }
      const component = event.target.closest<HTMLElement>('[data-component-id]');
      if (component && begin(event, component)) event.stopPropagation();
    },
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => begin(event),
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const drag = gesture.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag.pointer = { x: event.clientX, y: event.clientY };
      if (Math.hypot(drag.pointer.x - drag.origin.x, drag.pointer.y - drag.origin.y) >= uiCanvasDragThreshold) drag.moved = true;
      if (drag.kind === 'move') latest.current.transform.move(event);
      else if (drag.kind === 'marquee' && drag.moved && !frame.current) frame.current = requestAnimationFrame(tick);
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      const drag = gesture.current;
      if (!drag || drag.pointerId !== event.pointerId || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      drag.pointer = { x: event.clientX, y: event.clientY };
      if (Math.hypot(drag.pointer.x - drag.origin.x, drag.pointer.y - drag.origin.y) >= uiCanvasDragThreshold) drag.moved = true;
      const view = viewFor(drag);
      if (!view) { cancel(); return; }
      const next = drag.moved && drag.kind === 'marquee' ? refresh(drag, view) : undefined;
      if (drag.kind === 'move') latest.current.transform.end(event);
      finishGesture();
      if (drag.moved) history.current = undefined;
      else pendingClick.current = drag;
      if (next && !equalIds(latest.current.selectedIds, next)) latest.current.selectMany(next);
    },
    onPointerCancel: endCancelled, onLostPointerCapture: endCancelled,
    onScrollCapture: () => { history.current = undefined; pendingClick.current = undefined; },
    onClickCapture: clickCapture,
    onDoubleClickCapture: (event: MouseEvent<HTMLDivElement>) => {
      if (suppressClick.current && event.button === 0) { event.preventDefault(); event.stopPropagation(); }
    },
  } };
}
