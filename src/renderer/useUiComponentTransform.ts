import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { editableUiComponent, type Project, type UiComponent } from '../core/model';
import { resolveUiHierarchy } from '../core/ui-hierarchy';
import { transformUiRect, type UiRect, type UiTransformMode } from '../core/ui-transform';
import type { Commit } from './editor';

interface Drag {
  id: string; page: UiComponent['page']; ownerId?: string; pointerId: number; target: HTMLElement;
  mode: UiTransformMode; x: number; y: number; rect: UiRect; unitX: number; unitY: number;
  minWidth: number; minHeight: number;
}

export function useUiComponentTransform({ canvas, components, page, ownerId, project, commit, select, canEdit }: {
  canvas: RefObject<HTMLDivElement | null>; components: UiComponent[]; page: UiComponent['page']; ownerId?: string;
  project: Project; commit: Commit; select: (id?: string) => void; canEdit: (id: string) => boolean;
}) {
  const current = useRef<Drag | undefined>(undefined);
  const [preview, setPreview] = useState<{ id: string; rect: UiRect }>();
  const cancel = useCallback(() => {
    const drag = current.current; current.current = undefined; setPreview(undefined);
    if (drag?.target.hasPointerCapture(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId);
  }, []);
  useEffect(() => { cancel(); }, [components, page, ownerId, cancel]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && current.current) { event.preventDefault(); event.stopImmediatePropagation(); cancel(); }
    };
    window.addEventListener('keydown', escape, true); window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('keydown', escape, true); window.removeEventListener('blur', cancel); cancel(); };
  }, [cancel]);
  const point = (drag: Drag, event: PointerEvent<HTMLElement>) => Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 3 ? undefined
    : transformUiRect(drag.rect, drag.mode, (event.clientX - drag.x) * drag.unitX, (event.clientY - drag.y) * drag.unitY,
      { preserveAspectRatio: event.shiftKey, minWidth: drag.minWidth, minHeight: drag.minHeight });
  const handlers = (id: string, mode: UiTransformMode = 'move') => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || current.current) return;
      const authored = components.find(c => c.id === id), rows = resolveUiHierarchy(components, { design: true });
      const row = rows.find(row => row.component.id === id), bounds = canvas.current?.getBoundingClientRect();
      if (!authored || !row?.visible || row.component.editor?.locked || !bounds?.width || !bounds.height) return;
      event.preventDefault(); event.stopPropagation(); select(id);
      canvas.current?.closest<HTMLElement>('.ui-scroll')?.focus({ preventScroll: true });
      if (!canEdit(id)) return;
      const parent = rows.find(row => row.component.id === authored.parentId)?.component;
      if (parent && (!parent.width || !parent.height)) return;
      const parentWidth = parent?.width ?? 1, parentHeight = parent?.height ?? 1;
      current.current = { id, page, ownerId, pointerId: event.pointerId, target: event.currentTarget, mode,
        x: event.clientX, y: event.clientY, rect: { x: authored.x, y: authored.y, width: authored.width, height: authored.height },
        unitX: 1 / (bounds.width * parentWidth), unitY: 1 / (bounds.height * parentHeight),
        minWidth: 1 / (project.width * parentWidth), minHeight: 1 / (project.height * parentHeight),
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const drag = current.current;
      if (drag?.id !== id || drag.pointerId !== event.pointerId) return;
      const rect = point(drag, event); setPreview(rect ? { id, rect } : undefined);
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      const drag = current.current;
      if (drag?.id !== id || drag.pointerId !== event.pointerId) return;
      const rect = point(drag, event); cancel();
      if (!rect || drag.page !== page || drag.ownerId !== ownerId || (['x', 'y', 'width', 'height'] as const).every(key => rect[key] === drag.rect[key])) return;
      commit(mode === 'move' ? '移动界面组件' : '调整界面组件大小', draft => {
        const changed = drag.page === 'custom'
          ? draft.ui.customPages.find(item => item.id === drag.ownerId)?.components.find(item => item.id === id)
          : draft.ui.activeInstanceId === drag.ownerId ? editableUiComponent(draft.ui, id) : undefined;
        if (changed) Object.assign(changed, rect);
      });
    },
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
  });
  return { preview, handlers };
}
