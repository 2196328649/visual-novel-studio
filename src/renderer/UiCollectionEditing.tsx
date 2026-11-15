import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ComponentPropsWithRef, type MouseEvent, type ReactNode } from 'react';
import type { CollectionPart } from '../core/ui-collection-layout';
import { collectionInspectorParts } from '../core/ui-collection-inspector';
import type { UiButtonState, UiComponent } from '../core/model';

export interface CollectionEditing {
  selection?: { componentId: string; part: CollectionPart; actionMode?: 'save' | 'load'; reveal?: 'layout' | 'appearance' };
  request: number;
  select: (componentId: string, part: CollectionPart, actionMode?: 'save' | 'load', reveal?: 'layout' | 'appearance') => void;
  clear: () => void;
  previewState: UiButtonState;
  onPreviewStateChange?: (state: UiButtonState) => void;
  savePreviewMode: 'save' | 'load';
  onSavePreviewModeChange?: (mode: 'save' | 'load') => void;
}

const CollectionEditingContext = createContext<CollectionEditing | undefined>(undefined);

/** One editor-only selection is shared by the inspector, canvas, and command handlers. */
export function useUiCollectionEditSession({ scope, components, selectedIds, enabled = true, onSelectComponent, previewState = 'idle', onPreviewStateChange, savePreviewMode = 'save', onSavePreviewModeChange }: {
  scope: string; components: readonly UiComponent[]; selectedIds: readonly string[]; enabled?: boolean;
  onSelectComponent?: (componentId: string) => void;
  previewState?: UiButtonState; onPreviewStateChange?: (state: UiButtonState) => void;
  savePreviewMode?: 'save' | 'load'; onSavePreviewModeChange?: (mode: 'save' | 'load') => void;
}) {
  const [state, setState] = useState<Pick<CollectionEditing, 'selection' | 'request'> & { scope: string }>({ scope, request: 0 });
  const component = state.selection && components.find(item => item.id === state.selection?.componentId);
  const selection = enabled && state.scope === scope && selectedIds.length === 1 && selectedIds[0] === component?.id
    && component && state.selection && collectionInspectorParts(component).includes(state.selection.part) ? state.selection : undefined;
  const select = useCallback((componentId: string, part: CollectionPart, actionMode?: 'save' | 'load', reveal?: 'layout' | 'appearance') => {
    const target = components.find(item => item.id === componentId);
    if (!enabled || !target || !collectionInspectorParts(target).includes(part)) return;
    onSelectComponent?.(componentId);
    setState(previous => ({ scope, selection: { componentId, part, actionMode, reveal }, request: previous.request + 1 }));
  }, [scope, components, enabled, onSelectComponent]);
  const clear = useCallback(() => setState(previous => previous.selection ? { scope: previous.scope, request: previous.request + 1 } : previous), []);
  // Invalid selections are hidden in the current render, then discarded so returning
  // to a previous page or object cannot revive an old internal editing target.
  useEffect(() => {
    if (state.selection && !selection) setState(previous => previous === state ? { scope, request: previous.request + 1 } : previous);
  }, [state, selection, scope]);
  useEffect(() => {
    setState(previous => previous.selection?.actionMode ? { ...previous, selection: { ...previous.selection, actionMode: undefined } } : previous);
  }, [savePreviewMode]);
  return useMemo<CollectionEditing>(() => ({ selection, request: state.request, select, clear, previewState, onPreviewStateChange, savePreviewMode, onSavePreviewModeChange }), [selection, state.request, select, clear, previewState, onPreviewStateChange, savePreviewMode, onSavePreviewModeChange]);
}

export function UiCollectionEditProvider({ children, value }: { children: ReactNode; value: CollectionEditing }) {
  return <CollectionEditingContext.Provider value={value}>{children}</CollectionEditingContext.Provider>;
}

export const useCollectionEditing = () => useContext(CollectionEditingContext);

/** Pointer capture and transform overlays retarget clicks; inspect the visible part underneath. */
export function collectionPartAtPoint(canvas: HTMLElement, x: number, y: number): CollectionEditing['selection'] {
  for (const element of canvas.ownerDocument.elementsFromPoint(x, y)) {
    if (!canvas.contains(element) || element === canvas) return undefined;
    if (element.closest('[data-transform-id]')) {
      if (element.closest('[data-resize-handle]')) return undefined;
      continue;
    }
    const component = element.closest<HTMLElement>('[data-component-id]');
    if (!component || !canvas.contains(component) || component.classList.contains('locked')) return undefined;
    const part = element.closest<HTMLElement>('[data-collection-id][data-collection-part]');
    if (!part || !component.contains(part) || part.dataset.collectionId !== component.dataset.componentId) return undefined;
    const actionMode = part.dataset.collectionActionMode;
    return { componentId: part.dataset.collectionId!, part: part.dataset.collectionPart as CollectionPart, actionMode: actionMode === 'save' || actionMode === 'load' ? actionMode : undefined };
  }
  return undefined;
}

/** Keeps the existing canvas DOM/ref and pointer handlers; only design double-clicks are handled. */
export function UiCollectionCanvas({ onDoubleClickCapture, ...props }: ComponentPropsWithRef<'div'>) {
  const editing = useCollectionEditing();
  const openPart = (event: MouseEvent<HTMLDivElement>) => {
    onDoubleClickCapture?.(event);
    if (event.defaultPrevented || !editing || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const part = collectionPartAtPoint(event.currentTarget, event.clientX, event.clientY);
    if (!part) return;
    event.preventDefault(); event.stopPropagation(); editing.select(part.componentId, part.part, part.actionMode);
  };
  return <div {...props} data-ui-collection-canvas data-ui-editing-part={editing?.selection?.part} onDoubleClickCapture={openPart} />;
}

/** Only design previews opt in: live gallery/history controls retain their player actions. */
export function collectionPartProps(editing: CollectionEditing | undefined, componentId: string, part: CollectionPart, enabled = true, actionMode?: 'save' | 'load') {
  return {
    'data-collection-id': enabled ? componentId : undefined,
    'data-collection-part': enabled ? part : undefined,
    'data-collection-action-mode': enabled ? actionMode : undefined,
    'data-collection-selected': enabled && editing?.selection?.componentId === componentId && editing.selection.part === part ? 'true' : undefined,
    onDoubleClick: enabled && editing ? (event: MouseEvent<HTMLElement>) => {
      if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.currentTarget.closest('[data-ui-collection-canvas]')) return;
      event.preventDefault(); event.stopPropagation(); editing.select(componentId, part, actionMode);
    } : undefined,
  };
}
