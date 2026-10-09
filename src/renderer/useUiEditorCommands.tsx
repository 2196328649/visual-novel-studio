import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { editableUiComponent, localUiComponents, makeId, uiComponentLimit, type Project, type UiComponent } from '../core/model';
import { duplicateUiSubtree, reparentUiComponent, resolveUiHierarchy, uiSubtreeIds } from '../core/ui-hierarchy';
import { removeUiObject } from '../core/ui-hierarchy-edit';
import { componentName } from './UiNames';
import type { Commit } from './editor';
import type { useUiViewport } from './useUiViewport';

export function useUiEditorCommands({ project, components, page, customPageId, selectedId, select, commit, canEdit, viewport, enabled }: {
  project: Project; components: UiComponent[]; page: UiComponent['page']; customPageId?: string; selectedId?: string;
  select: (id?: string) => void; commit: Commit; canEdit: (id: string) => boolean; enabled: boolean;
  viewport: ReturnType<typeof useUiViewport>;
}) {
  const [clipboard, setClipboard] = useState<{ root: string; components: UiComponent[] }>();
  const [menu, setMenu] = useState<{ x: number; y: number; id?: string; hits: string[] }>();
  const menuRef = useRef<HTMLDivElement>(null);
  const menuReturnFocus = useRef<HTMLElement | null>(null);
  const rows = resolveUiHierarchy(components, { design: true });
  const local = page === 'custom' ? project.ui.customPages.find(p => p.id === customPageId)?.components ?? [] : localUiComponents(project.ui);
  const targetList = (draft: Project) => page === 'custom' ? draft.ui.customPages.find(p => p.id === customPageId)!.components : localUiComponents(draft.ui);
  const editable = (draft: Project, id: string) => page === 'custom' ? targetList(draft).find(c => c.id === id) : editableUiComponent(draft.ui, id);
  const edit = (id: string, title: string, change: (c: UiComponent) => void) => {
    if (!canEdit(id)) return;
    commit(title, draft => { const c = editable(draft, id); if (c) change(c); });
  };
  const copy = (id: string) => {
    const subtree = uiSubtreeIds(components, id), root = rows.find(row => row.component.id === id)?.component;
    if (!root) return;
    const copied = structuredClone(components.filter(c => subtree.has(c.id)));
    Object.assign(copied.find(c => c.id === id)!, { x: root.x, y: root.y, width: root.width, height: root.height, parentId: undefined, childLayer: undefined });
    setClipboard({ root: id, components: copied });
  };
  const insert = (items: UiComponent[], rootId: string, title: string) => {
    if (!items.length || local.length + items.length > uiComponentLimit || page === 'custom' && !customPageId) return;
    const rootIndex = items.findIndex(c => c.id === rootId), cloned = duplicateUiSubtree(items, rootId, () => makeId('ui'));
    cloned.forEach(c => { c.page = page; c.editor = { ...c.editor, hidden: false, locked: false }; });
    const root = cloned[rootIndex];
    if (!root) return;
    root.editor = { ...root.editor, listOrder: Math.max(0, ...components.map(c => c.editor?.listOrder ?? 0)) + 1 };
    commit(title, draft => { targetList(draft).push(...cloned); }); select(root.id);
  };
  const duplicate = (id: string) => insert(components.filter(c => uiSubtreeIds(components, id).has(c.id)), id, '复制界面组件及子对象');
  const paste = () => { if (clipboard) insert(clipboard.components, clipboard.root, '粘贴界面组件及子对象'); };
  const remove = (id: string) => { commit('删除界面组件', draft => removeUiObject(draft, id)); select(undefined); };
  const depth = (id: string, front: boolean) => {
    const c = components.find(c => c.id === id); if (!c) return;
    const peers = components.filter(other => other.parentId === c.parentId && (other.childLayer ?? 'foreground') === (c.childLayer ?? 'foreground'));
    const values = peers.map(other => other.layer ?? components.findIndex(c => c.id === other.id));
    edit(id, front ? '控件置顶' : '控件置底', c => { c.layer = front ? Math.max(...values) + 1 : Math.min(...values) - 1; });
  };
  const hitsAt = (event: { clientX: number; clientY: number }, canvas: HTMLElement) => {
    const b = canvas.getBoundingClientRect(), x = (event.clientX - b.left) / b.width, y = (event.clientY - b.top) / b.height;
    return [...rows].reverse().filter(row => row.visible && x >= row.component.x && y >= row.component.y && x < row.component.x + row.component.width && y < row.component.y + row.component.height).map(row => row.component.id);
  };
  const openMenu = (event: MouseEvent, id?: string) => {
    event.preventDefault(); event.stopPropagation();
    menuReturnFocus.current = (event.target as HTMLElement).closest('.ui-workspace')?.querySelector<HTMLElement>('.ui-scroll') ?? null;
    const canvas = (event.target as HTMLElement).closest<HTMLElement>('.ui-canvas'), hits = canvas ? hitsAt(event, canvas) : [];
    const target = id ?? (hits.includes(selectedId ?? '') ? selectedId : hits[0]);
    select(target); setMenu({ x: event.clientX, y: event.clientY, id: target, hits });
  };
  const cycle = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.altKey || event.button !== 0) return;
    const hits = hitsAt(event, event.currentTarget).filter(id => !rows.find(r => r.component.id === id)?.component.editor?.locked);
    if (!hits.length) return;
    event.preventDefault(); event.stopPropagation(); select(hits[(hits.indexOf(selectedId ?? '') + 1) % hits.length]);
  };
  useEffect(() => { setMenu(undefined); }, [page, customPageId, project.ui.activeInstanceId, enabled]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(undefined); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setMenu(undefined); } };
    document.addEventListener('pointerdown', close); window.addEventListener('keydown', escape); window.addEventListener('blur', close);
    const element = menuRef.current;
    if (element) {
      const bounds = element.getBoundingClientRect();
      element.style.left = Math.max(8, Math.min(menu.x, innerWidth - bounds.width - 8)) + 'px';
      element.style.top = Math.max(8, Math.min(menu.y, innerHeight - bounds.height - 8)) + 'px';
      element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
    return () => {
      document.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape); window.removeEventListener('blur', close);
      if (document.activeElement === document.body || element?.contains(document.activeElement)) menuReturnFocus.current?.focus({ preventScroll: true });
    };
  }, [menu]);
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!enabled || event.defaultPrevented || event.altKey || event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    if (target.closest('input,textarea,select,[contenteditable=true]') || !target.closest('.ui-scroll,.ui-hierarchy')) return;
    const selected = components.find(c => c.id === (target.closest('[data-hierarchy-id]')?.getAttribute('data-hierarchy-id') ?? selectedId));
    const modifier = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    if (modifier && ['+', '=', '-', '0'].includes(key)) { event.preventDefault(); viewport.change(key === '0' ? null : viewport.scale * (key === '-' ? 1 / 1.15 : 1.15)); return; }
    if (modifier && ['c', 'v', 'd', 'x'].includes(key)) {
      event.preventDefault();
      if (key === 'v') paste();
      else if (selected) { if (key === 'd') duplicate(selected.id); else { copy(selected.id); if (key === 'x' && !rows.find(r => r.component.id === selected.id)?.component.editor?.locked) remove(selected.id); } }
      return;
    }
    if (key === 'escape') { event.preventDefault(); select(undefined); return; }
    if (!selected || rows.find(r => r.component.id === selected.id)?.component.editor?.locked) return;
    if (key === 'delete' && !modifier) { event.preventDefault(); remove(selected.id); return; }
    if (!modifier && target.closest('.ui-scroll') && ['arrowleft','arrowright','arrowup','arrowdown'].includes(key)) {
      event.preventDefault();
      const parent = rows.find(r => r.component.id === selected.parentId)?.component, amount = event.shiftKey ? 10 : 1;
      edit(selected.id, '微调界面组件位置', c => {
        c.x += (key === 'arrowleft' ? -amount : key === 'arrowright' ? amount : 0) / (project.width * (parent?.width ?? 1));
        c.y += (key === 'arrowup' ? -amount : key === 'arrowdown' ? amount : 0) / (project.height * (parent?.height ?? 1));
      });
    }
  };
  const c = components.find(c => c.id === menu?.id), locked = rows.find(r => r.component.id === c?.id)?.component.editor?.locked;
  const action = (label: string, fn: () => void, shortcut?: string, disabled = false) => <button type="button" role="menuitem" disabled={disabled} onClick={() => { fn(); setMenu(undefined); }}><span>{label}</span>{shortcut && <kbd>{shortcut}</kbd>}</button>;
  const menuElement = menu && createPortal(<div className="ui-component-menu" role="menu" aria-label="控件右键菜单" ref={menuRef} style={{ left: menu.x, top: menu.y }} onContextMenu={e => e.preventDefault()} onKeyDown={e => {
    if (!['ArrowDown','ArrowUp','Home','End'].includes(e.key)) return;
    e.preventDefault(); const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')), index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
  }}>
    {c && <>{action('复制控件及子对象', () => copy(c.id), 'Ctrl+C')}{action('剪切控件及子对象', () => { copy(c.id); remove(c.id); }, 'Ctrl+X', !!locked)}{action('创建副本', () => duplicate(c.id), 'Ctrl+D', local.length + uiSubtreeIds(components, c.id).size > uiComponentLimit)}</>}
    {action('粘贴控件', paste, 'Ctrl+V', !clipboard || local.length + clipboard.components.length > uiComponentLimit)}
    {c && <><hr/>{action('置顶', () => depth(c.id, true), undefined, !canEdit(c.id))}{action('置底', () => depth(c.id, false), undefined, !canEdit(c.id))}
      {action(c.editor?.locked ? '解锁控件' : '锁定控件', () => edit(c.id, '切换控件锁定', c => { c.editor = { ...c.editor, locked: !c.editor?.locked }; }), undefined, !canEdit(c.id))}
      {action(c.editor?.hidden ? '在画布显示' : '在画布隐藏', () => edit(c.id, '切换画布可见性', c => { c.editor = { ...c.editor, hidden: !c.editor?.hidden }; }), undefined, !canEdit(c.id))}
      {c.parentId && <>{action('选择父控件', () => select(c.parentId))}{action('移到页面根级', () => edit(c.id, '解除父级', c => Object.assign(c, reparentUiComponent(components, c.id))), undefined, !!locked || !canEdit(c.id))}</>}
      <hr/>{action('删除控件', () => remove(c.id), 'Delete', !!locked)}</>}
    {menu.hits.length > 1 && <><hr/>{menu.hits.map(id => action('选择：' + componentName(components.find(c => c.id === id)!), () => select(id)))}</>}
  </div>, document.body);
  return { keyDown, openMenu, cycle, menuElement };
}
