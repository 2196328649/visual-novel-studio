import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { type Project, type UiComponent } from '../core/model';
import { resolveUiHierarchy } from '../core/ui-hierarchy';
import { transformUiLayoutRect, type UiRect, type UiTransformMode } from '../core/ui-transform';
import { uiLayoutProblem, type UiLayoutGeometry } from '../core/ui-layout';
import { applyUiRectChanges, planUiArrangement, uiRectChangeProblem, type UiRectChange } from '../core/ui-arrange';
import { createUiSnapContext, snapUiMove, type UiSnapContext, type UiSnapGuide } from '../core/ui-snap';
import { useStableCallbacks } from './useStableCallbacks';
import { uiCanvasDragThreshold } from '../core/ui-canvas-selection';
import type { Commit } from './editor';

interface DragPoint { clientX: number; clientY: number; altKey: boolean; shiftKey: boolean }
interface Preview { changes: UiRectChange[]; guides: UiSnapGuide[] }
interface Drag {
  id: string; page: UiComponent['page']; ownerId?: string; pointerId: number; target: HTMLElement;
  mode: UiTransformMode; x: number; y: number; rect: UiRect; unitX: number; unitY: number;
  component: UiComponent; geometry: UiLayoutGeometry; ids: string[];
  origin: { x: number; y: number }; snap?: UiSnapContext; last: DragPoint; moved: boolean; managed: boolean;
}

export function useUiComponentTransform({ canvas, components, designComponents = components, page, ownerId, project, commit, selectedIds, select, canEdit, visible, onProblem, snapEnabled, enabled, selectionOnly = false }: {
  canvas: RefObject<HTMLDivElement | null>; components: UiComponent[]; page: UiComponent['page']; ownerId?: string;
  designComponents?: UiComponent[];
  project: Project; commit: Commit; selectedIds: string[]; select: (id?: string, additive?: boolean) => void; canEdit: (id: string) => boolean;
  visible: (component: UiComponent) => boolean; onProblem: (message: string) => void;
  snapEnabled: boolean; enabled: boolean;
  /** An internal part is being edited; canvas clicks may choose objects but never drag them. */
  selectionOnly?: boolean;
}) {
  const current = useRef<Drag | undefined>(undefined);
  const [preview, setPreview] = useState<Preview>({ changes: [], guides: [] });
  const cancel = useCallback(() => {
    const drag = current.current; current.current = undefined;
    setPreview(previous => previous.changes.length || previous.guides.length ? { changes: [], guides: [] } : previous);
    if (drag?.target.hasPointerCapture(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId);
  }, []);
  useEffect(() => { cancel(); }, [components, designComponents, page, ownerId, visible, enabled, selectionOnly, project.width, project.height, cancel]);
  useEffect(() => {
    const drag = current.current;
    if (drag && (drag.ids.length !== selectedIds.length || drag.ids.some(id => !selectedIds.includes(id)))) cancel();
  }, [selectedIds, cancel]);
  const point = (drag: Drag, event: DragPoint): Preview => {
    const empty: Preview = { changes: [], guides: [] };
    drag.last = { clientX: event.clientX, clientY: event.clientY, altKey: event.altKey, shiftKey: event.shiftKey };
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= uiCanvasDragThreshold) drag.moved = true;
    if (!drag.moved) return empty;
    const bounds = canvas.current?.getBoundingClientRect();
    if (!bounds || Math.abs(bounds.width * drag.unitX - project.width) > .01 || Math.abs(bounds.height * drag.unitY - project.height) > .01) { cancel(); return empty; }
    const raw = { x: (event.clientX - drag.x + drag.origin.x - bounds.left) * drag.unitX, y: (event.clientY - drag.y + drag.origin.y - bounds.top) * drag.unitY };
    const snapped = snapUiMove(drag.snap, raw, { x: drag.unitX, y: drag.unitY }, drag.mode === 'move' && snapEnabled && !event.altKey);
    const rect = drag.mode === 'move' ? undefined : transformUiLayoutRect(drag.component, drag.geometry, drag.mode, raw, event.shiftKey);
    let plan = drag.mode === 'move' ? planUiArrangement(designComponents, drag.ids, project, { kind: 'move', delta: snapped.delta }, visible) : { changes: rect ? [{ id: drag.id, rect }] : [], problem: undefined };
    let problem = plan.problem ?? uiRectChangeProblem(project, { page: drag.page, ownerId: drag.ownerId }, plan.changes);
    // Snapping must not turn a legal vertical drag into a write to a linked X
    // (or vice versa), including in a rotated parent's coordinate frame.
    if (problem && drag.mode === 'move' && (raw.x !== snapped.delta.x || raw.y !== snapped.delta.y)) {
      const unsnapped = planUiArrangement(designComponents, drag.ids, project, { kind: 'move', delta: raw }, visible);
      const rawProblem = unsnapped.problem ?? uiRectChangeProblem(project, { page: drag.page, ownerId: drag.ownerId }, unsnapped.changes);
      if (!rawProblem) { plan = unsnapped; problem = undefined; snapped.guides = []; }
    }
    if (problem) { onProblem(problem); return empty; }
    onProblem('');
    return { changes: plan.changes, guides: snapped.guides };
  };
  const { modifiersChanged } = useStableCallbacks({ modifiersChanged: (event: KeyboardEvent) => {
    const drag = current.current;
    if (!drag || !['Alt', 'Shift'].includes(event.key)) return;
    event.preventDefault();
    setPreview(point(drag, { ...drag.last, altKey: event.altKey, shiftKey: event.shiftKey }));
  } });
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && current.current) {
        // Managed moves share their entire lifetime with the canvas coordinator,
        // including an Escape before pending pointer capture becomes active.
        if (!current.current.managed) { event.preventDefault(); event.stopImmediatePropagation(); cancel(); }
      }
      else modifiersChanged(event);
    };
    window.addEventListener('keydown', escape, true); window.addEventListener('keyup', modifiersChanged, true); window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('keydown', escape, true); window.removeEventListener('keyup', modifiersChanged, true); window.removeEventListener('blur', cancel); cancel(); };
  }, [cancel, modifiersChanged]);
  const begin = (id: string, mode: UiTransformMode, event: PointerEvent<HTMLElement>, target = event.currentTarget, managed = false) => {
      if (!enabled || event.button !== 0 || event.defaultPrevented || current.current) return;
      // The first gesture on an unselected object belongs to click/marquee
      // selection. Becoming selected during that gesture never starts a move.
      if (!selectionOnly && mode === 'move' && !selectedIds.includes(id)) return;
      const authored = designComponents.find(c => c.id === id), rows = resolveUiHierarchy(designComponents, { design: true, viewport: project, visible });
      const row = rows.find(row => row.component.id === id), bounds = canvas.current?.getBoundingClientRect();
      if (!authored || !row?.visible || row.component.editor?.locked || !bounds?.width || !bounds.height) return;
      event.preventDefault(); event.stopPropagation();
      canvas.current?.closest<HTMLElement>('.ui-scroll')?.focus({ preventScroll: true });
      if (mode === 'move' && (event.ctrlKey || event.metaKey || event.shiftKey)) { select(id, true); return; }
      if (selectionOnly) {
        // Clicking the part's owning object keeps the part view. Choosing another
        // object leaves it, but the same gesture must not start moving that object.
        if (!selectedIds.includes(id)) select(id);
        return;
      }
      const ids = mode === 'move' && selectedIds.includes(id) ? selectedIds : [id];
      if (ids.length === 1 && !selectedIds.includes(id)) select(id);
      const problem = !canEdit(id) ? '当前控件暂不能编辑。' : uiLayoutProblem(authored)
        ?? (!row.geometry || !row.geometry.basis.width || !row.geometry.basis.height ? '父对象的可用尺寸为零，暂时无法移动或缩放。' : undefined);
      if (problem || !row.geometry) { if (problem) onProblem(problem); return; }
      if (mode === 'move') {
        const plan = planUiArrangement(designComponents, ids, project, { kind: 'move', delta: { x: 0, y: 0 } }, visible);
        if (plan.problem) { onProblem(plan.problem); return; }
      }
      onProblem('');
      current.current = { id, page, ownerId, pointerId: event.pointerId, target, mode, moved: false, managed,
        x: event.clientX, y: event.clientY, rect: { x: authored.x, y: authored.y, width: authored.width, height: authored.height },
        unitX: project.width / bounds.width, unitY: project.height / bounds.height,
        component: authored, geometry: row.geometry, ids,
        origin: { x: bounds.left, y: bounds.top }, snap: mode === 'move' ? createUiSnapContext(designComponents, ids, project, visible) : undefined,
        last: { clientX: event.clientX, clientY: event.clientY, altKey: event.altKey, shiftKey: event.shiftKey },
      };
      target.setPointerCapture(event.pointerId);
      return true;
  };
  const move = (event: PointerEvent<HTMLElement>) => {
      const drag = current.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!enabled || selectionOnly) { cancel(); return; }
      setPreview(point(drag, event));
  };
  const end = (event: PointerEvent<HTMLElement>) => {
      const drag = current.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!enabled || selectionOnly) { cancel(); return; }
      const { changes } = point(drag, event); cancel();
      if (!changes.length || drag.page !== page || drag.ownerId !== ownerId || changes.length === 1 && changes[0].id === drag.id && (['x', 'y', 'width', 'height'] as const).every(key => changes[0].rect[key] === drag.rect[key])) return;
      commit(drag.mode === 'move' ? '移动界面组件' : '调整界面组件大小', draft => {
        applyUiRectChanges(draft, { page: drag.page, ownerId: drag.ownerId }, changes);
      }, { separate: true });
  };
  const handlers = (id: string, mode: UiTransformMode = 'move') => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => begin(id, mode, event),
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (current.current?.id === id && !current.current.managed) move(event);
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (current.current?.id === id && !current.current.managed) end(event);
    },
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
  });
  return { preview: preview.changes, guides: preview.guides, handlers, move, end, cancel,
    beginMove: (id: string, event: PointerEvent<HTMLElement>, target: HTMLElement) => begin(id, 'move', event, target, true) };
}
