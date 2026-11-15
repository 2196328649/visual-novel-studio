import { uiCanvasHitIds } from '../core/ui-canvas-selection';
import { uiSelectionRoots } from '../core/ui-arrange';
import { cloneData } from "../core/project-mutation";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { editableUiComponent, localUiComponents, makeId, uiComponentLimit, type Project, type UiComponent } from '../core/model';
import { duplicateUiSubtree, reparentUiComponent, resolveUiHierarchy, uiSubtreeIds } from '../core/ui-hierarchy';
import { removeUiObject } from '../core/ui-hierarchy-edit';
import { componentName } from './UiNames';
import { uiPropertyControlFor } from '../core/ui-property-control';
import { prepareUiComponentsForPaste } from '../core/ui-component-page';
import type { Commit } from './editor';
import type { useUiViewport } from './useUiViewport';

export function useUiEditorCommands({ project, components, designComponents = components, page, customPageId, selectedId, selectedIds, select, selectMany, nudge, commit, canEdit, viewport, enabled, visible, partEditing }: {
  project: Project; components: UiComponent[]; page: UiComponent['page']; customPageId?: string; selectedId?: string;
  designComponents?: UiComponent[];
  selectedIds: string[]; selectMany: (ids: readonly string[]) => void; nudge: (delta: { x: number; y: number }) => void; visible: (component: UiComponent) => boolean;
  select: (id?: string) => void; commit: Commit; canEdit: (id: string) => boolean; enabled: boolean;
  viewport: ReturnType<typeof useUiViewport>;
  partEditing?: { componentId: string; onExit: () => void; label?: string; exitLabel?: string };
}) {
  const [clipboard, setClipboard] = useState<{ roots: string[]; components: UiComponent[] }>();
  const [menu, setMenu] = useState<{ x: number; y: number; id?: string; hits: string[]; part?: boolean }>();
  const [error, setError] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const menuReturnFocus = useRef<HTMLElement | null>(null);
  const rows = resolveUiHierarchy(designComponents, { design: true, viewport: project, visible });
  const actionIds = (id: string) => uiSelectionRoots(components, selectedIds.includes(id) ? selectedIds : [id]);
  const copiedCount = (id: string) => new Set(actionIds(id).flatMap(root => [...uiSubtreeIds(components, root)])).size;
  const local = page === 'custom' ? project.ui.customPages.find(p => p.id === customPageId)?.components ?? [] : localUiComponents(project.ui);
  const targetList = (draft: Project) => page === 'custom' ? draft.ui.customPages.find(p => p.id === customPageId)!.components : localUiComponents(draft.ui);
  const editable = (draft: Project, id: string) => page === 'custom' ? targetList(draft).find(c => c.id === id) : editableUiComponent(draft.ui, id);
  const edit = (id: string, title: string, change: (c: UiComponent) => void) => {
    if (partEditing || !canEdit(id)) return;
    commit(title, draft => { const c = editable(draft, id); if (c) change(c); });
  };
  const copy = (id: string): boolean => {
    if (partEditing) return false;
    const roots = actionIds(id);
    if (!roots.length) return false;
    try {
      const copied = roots.flatMap(root => {
        const source = components.find(c => c.id === root)!, subtree = uiSubtreeIds(components, root);
        const change = source.parentId ? reparentUiComponent(components, root, undefined, project) : {};
        const chunk = cloneData(components.filter(c => subtree.has(c.id)));
        Object.assign(chunk.find(c => c.id === root)!, change, { parentId: undefined, childLayer: undefined });
        return chunk;
      });
      setClipboard({ roots, components: copied }); setError(''); return true;
    } catch (error) { setError((error as Error).message); return false; }
  };
  const insert = (items: UiComponent[], roots: string[], title: string) => {
    if (partEditing || !items.length || local.length + items.length > uiComponentLimit || page === 'custom' && !customPageId) return;
    try {
      const newRoots: string[] = [];
      const cloned = roots.flatMap(id => {
        const ids = uiSubtreeIds(items, id), subtree = items.filter(c => ids.has(c.id)), result = duplicateUiSubtree(subtree, id, () => makeId('ui'));
        const root = result[subtree.findIndex(c => c.id === id)];
        if (root) { root.editor = { ...root.editor, listOrder: Math.max(0, ...components.map(c => c.editor?.listOrder ?? 0)) + newRoots.length + 1 }; newRoots.push(root.id); }
        return result;
      });
      const prepared = prepareUiComponentsForPaste(cloned, page);
      if (!newRoots.length) return;
      commit(title, draft => { targetList(draft).push(...prepared); }, { separate: true }); selectMany(newRoots); setError('');
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  const duplicate = (id: string) => { const roots = actionIds(id), ids = new Set(roots.flatMap(root => [...uiSubtreeIds(components, root)])); insert(components.filter(c => ids.has(c.id)), roots, '复制界面组件及子对象'); };
  const paste = () => { if (clipboard) insert(clipboard.components, clipboard.roots, '粘贴界面组件及子对象'); };
  const lockedSelection = (id: string) => (selectedIds.includes(id) ? selectedIds : [id]).some(target => rows.find(r => r.component.id === target)?.component.editor?.locked);
  const remove = (id: string) => {
    if (partEditing) return;
    if (lockedSelection(id)) { setError('所选控件包含锁定项，请先解锁或取消选择。'); return; }
    const ids = actionIds(id);
    try {
      commit('删除界面组件', draft => { for (const target of ids) removeUiObject(draft, target); }, { separate: true });
      select(undefined); setError('');
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  const depth = (id: string, front: boolean) => {
    const c = components.find(c => c.id === id); if (!c) return;
    if (uiPropertyControlFor(project, c, 'layer')) { setError('显示层级已关联参数；请在属性中调整来源，或改回默认设置后再操作。'); return; }
    const peers = designComponents.filter(other => other.parentId === c.parentId && (other.childLayer ?? 'foreground') === (c.childLayer ?? 'foreground'));
    const values = peers.map(other => other.layer ?? designComponents.findIndex(c => c.id === other.id));
    edit(id, front ? '控件置顶' : '控件置底', c => { c.layer = front ? Math.max(...values) + 1 : Math.min(...values) - 1; });
  };
  const hitsAt = (event: { clientX: number; clientY: number }, canvas: HTMLElement) => {
    const b = canvas.getBoundingClientRect(), point = { x: (event.clientX - b.left) / b.width * project.width, y: (event.clientY - b.top) / b.height * project.height };
    return uiCanvasHitIds(rows, point, project, true);
  };
  const openMenu = (event: MouseEvent, id?: string) => {
    event.preventDefault(); event.stopPropagation();
    menuReturnFocus.current = (event.target as HTMLElement).closest('.ui-workspace')?.querySelector<HTMLElement>('.ui-scroll') ?? null;
    const canvas = (event.target as HTMLElement).closest<HTMLElement>('.ui-canvas'), hits = canvas ? hitsAt(event, canvas) : [];
    if (partEditing && canvas) {
      setMenu({ x: event.clientX, y: event.clientY, id: partEditing.componentId, hits, part: true });
      return;
    }
    const target = id ?? (hits.includes(selectedId ?? '') ? selectedId : hits[0]);
    if (partEditing || !target || !selectedIds.includes(target)) select(target);
    setMenu({ x: event.clientX, y: event.clientY, id: target, hits });
  };
  const cycle = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.altKey || event.button !== 0) return;
    const hits = hitsAt(event, event.currentTarget).filter(id => !rows.find(r => r.component.id === id)?.component.editor?.locked);
    if (!hits.length) return;
    event.preventDefault(); event.stopPropagation(); select(hits[(hits.indexOf(selectedId ?? '') + 1) % hits.length]);
  };
  const partComponentId = partEditing?.componentId;
  useEffect(() => { setMenu(undefined); }, [page, customPageId, project.id, project.ui.activeInstanceId, enabled]);
  useEffect(() => {
    setMenu(current => {
      if (!current) return current;
      // A hierarchy right-click exits part editing and opens an object menu in
      // the same event. Keep that new menu, but discard menus from the old mode.
      const sameMode = current.part ? current.id === partComponentId : !partComponentId;
      return sameMode ? current : undefined;
    });
  }, [partComponentId]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(undefined); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setMenu(undefined); } };
    document.addEventListener('pointerdown', close, true); window.addEventListener('keydown', escape); window.addEventListener('blur', close);
    const element = menuRef.current;
    if (element) {
      const bounds = element.getBoundingClientRect();
      element.style.left = Math.max(8, Math.min(menu.x, innerWidth - bounds.width - 8)) + 'px';
      element.style.top = Math.max(8, Math.min(menu.y, innerHeight - bounds.height - 8)) + 'px';
      element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
    return () => {
      document.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', escape); window.removeEventListener('blur', close);
      if (document.activeElement === document.body || element?.contains(document.activeElement)) menuReturnFocus.current?.focus({ preventScroll: true });
    };
  }, [menu]);
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!enabled || event.defaultPrevented || event.altKey || event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    if (target.closest('input,textarea,select,[contenteditable=true]') || !target.closest('.ui-scroll,.ui-hierarchy')) return;
    const modifier = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    if (partEditing && key === 'escape') { event.preventDefault(); event.stopPropagation(); partEditing.onExit(); return; }
    // These are controls inside a map, not the selected UI component itself.
    // In capture phase their own key handlers have not had a chance to run yet.
    if (target.closest('[data-flow-node],[role="scrollbar"],[data-flow-controls],[data-flow-pagination],[data-flow-group-view]')) return;
    const selected = components.find(c => c.id === (target.closest('[data-hierarchy-id]')?.getAttribute('data-hierarchy-id') ?? selectedId));
    if (partEditing) {
      if (modifier && ['+', '=', '-', '0'].includes(key)) { event.preventDefault(); viewport.change(key === '0' ? null : viewport.scale * (key === '-' ? 1 / 1.15 : 1.15)); return; }
      if (modifier && ['a', 'c', 'v', 'd', 'x'].includes(key) || ['delete', 'backspace', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
        event.preventDefault(); event.stopPropagation(); return;
      }
    }
    if (modifier && key === 'a') { event.preventDefault(); selectMany(rows.filter(row => row.visible && !row.component.editor?.locked).map(row => row.component.id)); return; }
    if (modifier && ['+', '=', '-', '0'].includes(key)) { event.preventDefault(); viewport.change(key === '0' ? null : viewport.scale * (key === '-' ? 1 / 1.15 : 1.15)); return; }
    if (modifier && ['c', 'v', 'd', 'x'].includes(key)) {
      event.preventDefault();
      if (key === 'v') paste();
      else if (selected) { if (key === 'd') duplicate(selected.id); else { const copied = copy(selected.id); if (copied && key === 'x') remove(selected.id); } }
      return;
    }
    if (key === 'escape') { event.preventDefault(); select(undefined); return; }
    if (!selected) return;
    if (key === 'delete' && !modifier) { event.preventDefault(); remove(selected.id); return; }
    if (!modifier && target.closest('.ui-scroll') && ['arrowleft','arrowright','arrowup','arrowdown'].includes(key)) {
      event.preventDefault();
      const amount = event.shiftKey ? 10 : 1;
      nudge({ x: key === 'arrowleft' ? -amount : key === 'arrowright' ? amount : 0, y: key === 'arrowup' ? -amount : key === 'arrowdown' ? amount : 0 });
    }
  };
  const c = components.find(c => c.id === menu?.id), locked = rows.find(r => r.component.id === c?.id)?.component.editor?.locked, multiple = !!c && selectedIds.includes(c.id) && selectedIds.length > 1;
  const action = (label: string, fn: () => void, shortcut?: string, disabled = false) => <button type="button" role="menuitem" disabled={disabled} onClick={() => { try { fn(); } catch (error) { setError((error as Error).message); } setMenu(undefined); }}><span>{label}</span>{shortcut && <kbd>{shortcut}</kbd>}</button>;
  const menuElement = menu && createPortal(<div className="ui-component-menu" role="menu" aria-label="控件右键菜单" ref={menuRef} style={{ left: menu.x, top: menu.y }} onContextMenu={e => e.preventDefault()} onKeyDown={e => {
    if (!['ArrowDown','ArrowUp','Home','End'].includes(e.key)) return;
    e.preventDefault(); const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')), index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
  }}>
    {menu.part ? <>
      <div className="ui-context-selection">{partEditing?.label ?? '正在编辑列表部件；位置与外观在右侧调整。'}</div>
      {action(partEditing?.exitLabel ?? '返回整个控件', () => partEditing?.onExit(), 'Esc')}
      {menu.hits.filter(id => id !== partEditing?.componentId).map(id => action('选择：' + componentName(components.find(c => c.id === id)!), () => select(id)))}
    </> : <>
    {multiple && <div className="ui-context-selection">已选 {selectedIds.length} 项 · 操作包含子对象</div>}
    {c && <>{action('复制控件及子对象', () => copy(c.id), 'Ctrl+C')}{action('剪切控件及子对象', () => { if (copy(c.id)) remove(c.id); }, 'Ctrl+X', lockedSelection(c.id))}{action('创建副本', () => duplicate(c.id), 'Ctrl+D', local.length + copiedCount(c.id) > uiComponentLimit)}</>}
    {action('粘贴控件', paste, 'Ctrl+V', !clipboard || local.length + clipboard.components.length > uiComponentLimit)}
    {c && !multiple && <><hr/>{action('置顶', () => depth(c.id, true), undefined, !canEdit(c.id))}{action('置底', () => depth(c.id, false), undefined, !canEdit(c.id))}
      {action(c.editor?.locked ? '解锁控件' : '锁定控件', () => edit(c.id, '切换控件锁定', c => { c.editor = { ...c.editor, locked: !c.editor?.locked }; }), undefined, !canEdit(c.id))}
      {action(c.editor?.hidden ? '在画布显示' : '在画布隐藏', () => edit(c.id, '切换画布可见性', c => { c.editor = { ...c.editor, hidden: !c.editor?.hidden }; }), undefined, !canEdit(c.id))}
      {c.parentId && <>{action('选择父控件', () => select(c.parentId))}{action('移到页面根级', () => edit(c.id, '解除父级', c => Object.assign(c, reparentUiComponent(components, c.id, undefined, project))), undefined, !!locked || !canEdit(c.id))}</>}
      <hr/>{action('删除控件', () => remove(c.id), 'Delete', !!locked)}</>}
    {c && multiple && <><hr/>{action('删除所选控件', () => remove(c.id), 'Delete', lockedSelection(c.id))}{action('只选择此控件', () => select(c.id))}</>}
    {menu.hits.length > 1 && <><hr/>{menu.hits.map(id => action('选择：' + componentName(components.find(c => c.id === id)!), () => select(id)))}</>}
    </>}
  </div>, document.body);
  return { keyDown, openMenu, cycle, menuElement: <>{menuElement}{error && <div className="ui-command-error" role="alert">{error}<button className="text-button" onClick={() => setError('')}>知道了</button></div>}</> };
}
