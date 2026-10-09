import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Eye, EyeOff, GripVertical, Layers, LockKeyhole, Scan, Search, UnlockKeyhole } from 'lucide-react';
import type { UiComponent } from '../core/model';
import { reparentUiComponent, reorderUiList, uiAncestors, uiListOrder, uiSubtreeIds } from '../core/ui-hierarchy';
import type { UiParentDrop } from './UiParentGuide';
import { componentName, componentNames } from './UiNames';
import { IconButton } from './components';

type ListDrop = { targetId: string | null; placement: 'inside' | 'before' | 'after' };
type DropNotice = ListDrop & UiParentDrop;

export function UiHierarchy({ components, visible: isVisible, selectedId, select, edit, move, reparent, reorder, canEdit, canReorder, title, origin, highlight, locate, previewDrop, contextMenu }: {
  components: UiComponent[]; selectedId?: string; select: (id?: string) => void;
  visible: (component: UiComponent) => boolean;
  edit: (id: string, change: (component: UiComponent) => void) => void;
  move: (id: string, index: number) => void; reparent: (id: string, parentId?: string) => boolean; canEdit: (id: string) => boolean; canReorder: boolean;
  reorder: (id: string, targetId: string, placement: 'before' | 'after') => boolean;
  title: string; origin: (id: string) => string; highlight: (id?: string) => void; locate: (id: string) => void;
  previewDrop: (drop?: UiParentDrop) => void;
  contextMenu?: (event: React.MouseEvent, id?: string) => void;
}) {
  const [query, setQuery] = useState(''), [expanded, setExpanded] = useState(true), [collapsed, setCollapsed] = useState(new Set<string>());
  const [renaming, setRenaming] = useState<string>(), [name, setName] = useState('');
  const [dragging, setDragging] = useState<string>(), [dropTarget, setDropTarget] = useState<ListDrop>();
  const [dropError, setDropError] = useState(''), [notice, setNotice] = useState<DropNotice>();
  const rows = useRef(new Map<string, HTMLDivElement>());
  const ordered = uiListOrder(components).filter(isVisible), byId = new Map(components.map(c => [c.id, c]));
  const childMap = new Map<string | undefined, UiComponent[]>();
  for (const c of ordered) childMap.set(c.parentId, [...childMap.get(c.parentId) ?? [], c]);
  const children = (id?: string) => childMap.get(id) ?? [];
  const selected = byId.get(selectedId ?? ''), siblings = children(selected?.parentId), index = siblings.findIndex(c => c.id === selectedId);
  const dropParent = dropTarget?.placement === 'inside' ? dropTarget.targetId ?? undefined : byId.get(dropTarget?.targetId ?? '')?.parentId;
  const sourceParent = byId.get(dragging ?? '')?.parentId;
  const ancestorIds = uiAncestors(components, selectedId ?? '').map(c => c.id).join('/');
  const matching = query ? new Set(ordered.filter(c => `${componentName(c)} ${c.id} ${componentNames[c.kind]}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).flatMap(c => [c.id, ...uiAncestors(components, c.id).map(p => p.id)])) : new Set<string>();
  const visible: { component: UiComponent; depth: number }[] = [];
  const visit = (parentId?: string, depth = 1) => { for (const c of children(parentId)) { if (query && !matching.has(c.id)) continue; visible.push({ component: c, depth }); if ((!collapsed.has(c.id) || query) && depth < 32) visit(c.id, depth + 1); } };
  visit();
  useEffect(() => {
    setCollapsed(previous => { const next = new Set(previous); for (const id of ancestorIds.split('/')) next.delete(id); return next.size === previous.size ? previous : next; });
    const frame = requestAnimationFrame(() => rows.current.get(selectedId ?? '')?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [selectedId, ancestorIds]);
  useEffect(() => { setQuery(''); setExpanded(true); setCollapsed(new Set()); setRenaming(undefined); setDragging(undefined); setDropTarget(undefined); setDropError(''); setNotice(undefined); }, [title]);
  useEffect(() => {
    previewDrop(dragging && dropTarget && dropParent !== sourceParent ? { sourceId: dragging, parentId: dropParent } : undefined);
    return () => previewDrop(undefined);
  }, [dragging, dropTarget, dropParent, sourceParent, previewDrop]);
  const toggle = (id: string) => setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const rename = (c: UiComponent) => { if (canEdit(c.id)) { setName(componentName(c)); setRenaming(c.id); } };
  const finishRename = () => { if (renaming && name.trim()) edit(renaming, c => { c.name = name.trim().slice(0, 120); }); setRenaming(undefined); };
  const dropProblem = (source: string, target: ListDrop) => {
    const c = byId.get(source);
    if (!c || !canReorder || !canEdit(source)) return '当前对象无法调整。';
    if (target.placement !== 'inside') {
      try { return target.targetId && reorderUiList(components, source, target.targetId, target.placement).length ? '' : '已经位于这个列表位置。'; }
      catch (e) { return (e as Error).message; }
    }
    const parentId = target.targetId ?? undefined;
    if (parentId && uiSubtreeIds(components, source).has(parentId)) return '不能放入自身或自己的子对象。';
    if (c.parentId === parentId) return parentId ? '已经是这个控件的子对象。' : '已经位于页面根级。';
    try { reparentUiComponent(components, source, parentId); return ''; } catch (e) { return (e as Error).message; }
  };
  const rowDrop = (event: React.DragEvent, targetId: string): ListDrop => {
    const bounds = event.currentTarget.getBoundingClientRect(), edge = Math.min(12, bounds.height * .28);
    return { targetId, placement: event.clientY < bounds.top + edge ? 'before' : event.clientY > bounds.bottom - edge ? 'after' : 'inside' };
  };
  const dragOver = (event: React.DragEvent, target: ListDrop) => {
    if (!dragging) return;
    event.stopPropagation();
    const problem = dropProblem(dragging, target);
    setDropError(problem); setDropTarget(previous => problem ? undefined : previous?.targetId === target.targetId && previous.placement === target.placement ? previous : target);
    event.dataTransfer.dropEffect = problem ? 'none' : 'move';
    if (!problem) event.preventDefault();
  };
  const dragLeave = (event: React.DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setDropTarget(undefined); setDropError(''); }
  };
  const endDrag = () => { setDragging(undefined); setDropTarget(undefined); setDropError(''); };
  const drop = (event: React.DragEvent, target: ListDrop) => {
    event.preventDefault(); event.stopPropagation();
    const source = event.dataTransfer.getData('application/x-vns-ui-layer') || dragging;
    const parentId = target.placement === 'inside' ? target.targetId ?? undefined : byId.get(target.targetId ?? '')?.parentId;
    if (source && source === dragging && !dropProblem(source, target) && (target.placement === 'inside' ? reparent(source, parentId) : reorder(source, target.targetId!, target.placement))) {
      setExpanded(true);
      if (parentId) setCollapsed(previous => { const next = new Set(previous); next.delete(parentId); return next; });
      select(source); setNotice({ sourceId: source, parentId, ...target });
    }
    endDrag();
  };
  const source = byId.get(dragging ?? ''), target = byId.get(dropTarget?.targetId ?? '');
  let markerIndex = dropTarget && dropTarget.placement !== 'inside' ? visible.findIndex(row => row.component.id === dropTarget.targetId) : -1;
  const markerDepth = visible[markerIndex]?.depth ?? 1;
  if (markerIndex >= 0 && dropTarget?.placement === 'after') while (visible[markerIndex + 1]?.depth > markerDepth) markerIndex++;
  const completed = notice && selectedId === notice.sourceId && byId.get(notice.sourceId)?.parentId === notice.parentId ? byId.get(notice.sourceId) : undefined;
  return <aside className="ui-hierarchy" aria-label="控件层级">
    <header><Layers size={16} /><strong>层级</strong><span>{ordered.length}</span></header>
    <div className="ui-hierarchy-search"><Search size={14} /><input aria-label="搜索控件" placeholder="搜索名称、类型…" value={query} onChange={e => setQuery(e.target.value)} /></div>
    <div className="ui-hierarchy-tools">
      <IconButton title="在列表中上移" disabled={!selected || index <= 0 || !canReorder || !canEdit(selected.id) || !!query} onClick={() => move(selected!.id, index - 1)}><ArrowUp size={15} /></IconButton>
      <IconButton title="在列表中下移" disabled={!selected || index === siblings.length - 1 || !canReorder || !canEdit(selected.id) || !!query} onClick={() => move(selected!.id, index + 1)}><ArrowDown size={15} /></IconButton>
      <IconButton title="定位所选控件" disabled={!selected || selected.editor?.hidden} onClick={() => selected && locate(selected.id)}><Scan size={15} /></IconButton><span>整理列表顺序</span>
    </div>
    <div className="ui-hierarchy-tree" role="tree" aria-label="界面控件树">
      <div role="treeitem" aria-expanded={expanded || !!query} aria-selected={!selectedId} className={`ui-hierarchy-root${dropTarget?.targetId === null ? ' drop-target' : ''}`} tabIndex={selectedId ? -1 : 0} onClick={() => select(undefined)} onDragOver={e => dragOver(e, { targetId: null, placement: 'inside' })} onDragLeave={dragLeave} onDrop={e => drop(e, { targetId: null, placement: 'inside' })}>
        <button type="button" aria-label={expanded ? '折叠画布层级' : '展开画布层级'} onClick={e => { e.stopPropagation(); setExpanded(!expanded); }}>{expanded || query ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button><Layers size={14} /><span title={title}>{title}</span>
      </div>
      {(expanded || query) && <div role="group">{visible.map(({ component: c, depth }, i) => {
        const hasChildren = children(c.id).length > 0;
        return <div key={c.id} role="treeitem" aria-level={depth + 1} aria-expanded={hasChildren ? !collapsed.has(c.id) : undefined} aria-selected={c.id === selectedId} tabIndex={c.id === selectedId || !selectedId && i === 0 ? 0 : -1}
          ref={element => { if (element) rows.current.set(c.id, element); else rows.current.delete(c.id); }} data-hierarchy-id={c.id} data-parent-id={c.parentId} style={{ paddingLeft: 8 + (depth - 1) * 16 }}
          className={`ui-hierarchy-row ${c.id === selectedId ? 'selected' : ''} ${c.editor?.hidden ? 'hidden-preview' : ''} ${dropTarget?.placement === 'inside' && dropTarget.targetId === c.id ? 'drop-target' : ''} ${dragging === c.id ? 'drag-source' : ''}`}
          draggable={canReorder && canEdit(c.id) && !query && !renaming} onDragStart={e => { setDragging(c.id); setNotice(undefined); highlight(undefined); e.dataTransfer.setData('application/x-vns-ui-layer', c.id); e.dataTransfer.effectAllowed = 'move'; }}
          onDragOver={e => dragOver(e, rowDrop(e, c.id))} onDragLeave={dragLeave} onDrop={e => drop(e, rowDrop(e, c.id))} onDragEnd={endDrag}
          onContextMenu={e => contextMenu?.(e, c.id)} onMouseEnter={() => { if (!dragging) highlight(c.id); }} onMouseLeave={() => highlight(undefined)} onClick={e => { select(c.id); e.currentTarget.focus(); }} onDoubleClick={() => rename(c)}
          onKeyDown={e => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'F2') { e.preventDefault(); rename(c); }
            else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(c.id); }
            else if (e.key === 'ArrowRight' && hasChildren) { e.preventDefault(); setCollapsed(s => { const n = new Set(s); n.delete(c.id); return n; }); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); if (hasChildren && !collapsed.has(c.id)) toggle(c.id); else if (c.parentId) select(c.parentId); }
            else { const next = e.key === 'ArrowDown' ? Math.min(visible.length - 1, i + 1) : e.key === 'ArrowUp' ? Math.max(0, i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? visible.length - 1 : -1; if (next >= 0) { e.preventDefault(); select(visible[next].component.id); rows.current.get(visible[next].component.id)?.focus(); } }
          }}>
          {hasChildren ? <button type="button" className="ui-hierarchy-toggle" aria-label={`${collapsed.has(c.id) ? '展开' : '折叠'} ${componentName(c)}`} onClick={e => { e.stopPropagation(); toggle(c.id); }}>{collapsed.has(c.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</button> : <GripVertical size={12} className="ui-hierarchy-grip" />}
          <div className="ui-hierarchy-caption">{renaming === c.id ? <input autoFocus aria-label="控件名称" value={name} maxLength={120} onFocus={e => e.currentTarget.select()} onChange={e => setName(e.target.value)} onClick={e => e.stopPropagation()} onBlur={finishRename} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') finishRename(); if (e.key === 'Escape') setRenaming(undefined); }} /> : <span title={`${componentName(c)}\n${c.id}`}>{componentName(c)}</span>}<small>{dropTarget?.placement === 'inside' && dropTarget.targetId === c.id ? <b>↳ 松开，设为父对象</b> : <>{componentNames[c.kind]}{c.parentId ? c.childLayer === 'background' ? ' · 背景子对象' : ' · 前方子对象' : ''}{origin(c.id) ? ` · ${origin(c.id)}` : ''}</>}</small></div>
          {i === markerIndex && <span className={`ui-hierarchy-insert insert-${dropTarget!.placement}`} data-list-drop-target={dropTarget!.targetId} data-list-drop-position={dropTarget!.placement} aria-hidden="true" style={{ left: 8 + (markerDepth - 1) * 16 }} />}
          <button type="button" className="ui-hierarchy-toggle" disabled={!canEdit(c.id)} aria-label={`${c.editor?.hidden ? '在画布显示' : '在画布隐藏'} ${componentName(c)}`} title="仅控制设计画布中的可见性（包括子对象）" onClick={e => { e.stopPropagation(); edit(c.id, c => { c.editor = { ...c.editor, hidden: !c.editor?.hidden }; }); }}>{c.editor?.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
          <button type="button" className="ui-hierarchy-toggle" disabled={!canEdit(c.id)} aria-label={`${c.editor?.locked ? '解锁' : '锁定'} ${componentName(c)}`} title="锁定组件及子对象的画布拖动" onClick={e => { e.stopPropagation(); edit(c.id, c => { c.editor = { ...c.editor, locked: !c.editor?.locked }; }); }}>{c.editor?.locked ? <LockKeyhole size={14} /> : <UnlockKeyhole size={14} />}</button>
        </div>;
      })}{!visible.length && <p className="ui-hierarchy-empty">{query ? '没有匹配的控件' : '点击标题栏 + 添加组件'}</p>}</div>}
    </div>
    <footer className={`ui-hierarchy-feedback${source ? ' dragging' : completed ? ' completed' : ''}`} role="status" aria-live="polite">
      {source ? <><strong>{dropError || (target ? dropTarget?.placement === 'inside' ? `松开，将「${componentName(source)}」放入「${componentName(target)}」` : `松开，将「${componentName(source)}」移到「${componentName(target)}」${dropTarget?.placement === 'before' ? '之前' : '之后'}` : dropTarget?.targetId === null ? `松开，将「${componentName(source)}」移到页面根级` : '拖到行间排序，拖到行中设置父级')}</strong><span>{dropTarget?.placement !== 'inside' && dropParent === source.parentId ? '调整列表顺序 · 显示层级保持原值' : '画面位置与大小保持不变。'}</span></>
        : completed ? <><strong>{notice?.placement !== 'inside' ? `已调整「${componentName(completed)}」的列表位置` : notice?.parentId ? `已将「${componentName(completed)}」放入「${componentName(byId.get(notice.parentId)!)}」` : `已将「${componentName(completed)}」移到页面根级`}</strong><span>{notice?.placement !== 'inside' ? '显示层级保持原值 · 可撤销' : '位置已保留 · 可撤销此次调整'}</span></>
          : <>拖到行间排序，拖到行中设为子对象。<br />拖到页面名称移到根级。<br />显示层级在右侧属性中设置。</>}
    </footer>
  </aside>;
}
