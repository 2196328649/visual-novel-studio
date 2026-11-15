import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Project, UiButtonState, UiComponent } from '../core/model';
import { uiComponentTheme } from '../core/ui-page-settings';
import { playerFlowMode, playerFlowView } from '../core/player-flow-content';
import { storyFlowDirectoryLayout, storyFlowPaginationStyle } from '../core/story-flow';
import { flowNodeAppearance } from '../core/flow-style';
import { isStandaloneNode } from '../core/standalone-performance';
import { UiFlowEditContext, flowPreviewNodes, playerFlowPreviewEntryIds } from './UiFlowEditing';
import { UiFlowAffectedOutline, UiFlowNodeFace, flowNodePreviewStyle } from './UiFlowNodePreview';
import { UiSkinImage } from './UiAppearance';
import type { AssetUrl } from './StageEditor';
import './ui-flow-preview.css';

export function UiFlowDirectoryPreview({ project, component, assetUrl, scale, state }: { project: Project; component: UiComponent; assetUrl: AssetUrl; scale: number; state: UiButtonState }) {
  const themed = useMemo(() => ({ ...project, ui: uiComponentTheme(project, component) }), [project, component]);
  const editing = useContext(UiFlowEditContext), editable = editing?.componentId === component.id;
  const customMode = playerFlowMode(component) === 'custom';
  const groupId = editable ? editing.groupId : undefined;
  const view = useMemo(() => playerFlowView(project, component, groupId), [project, component, groupId]);
  const group = groupId && view.kind !== 'root' ? view : undefined;
  const hasCalls = project.nodes.some(node => node.kind === 'call');
  const [page, setPage] = useState(0), [hovered, setHovered] = useState<string>(), [pressed, setPressed] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const handledLocate = useRef<string | undefined>(undefined);
  const entries = view.entries;
  const allEntryIds = useMemo(() => playerFlowPreviewEntryIds(project, component), [project, component]);
  const breadcrumbHeight = group ? Math.min(44, Math.max(32, Math.floor(component.height * project.height * .1))) : 0;
  const layout = storyFlowDirectoryLayout(themed, component, themed.ui.fontSize, breadcrumbHeight), { columns, rows, cellWidth, cellHeight, gapX, gapY, viewHeight } = layout;
  const previewSession: Parameters<typeof flowPreviewNodes>[3] = editable
    ? { ...editing, view, ...(customMode || hasCalls ? { entryIds: editing.entryIds ?? allEntryIds } : {}) }
    : customMode || hasCalls ? { view, preview: { mode: state === 'disabled' ? 'partial' : state === 'selected' ? 'current' : 'all' }, entryIds: allEntryIds } : undefined;
  const { visuals } = flowPreviewNodes(entries, project.entryId, component.list, previewSession, state, { hoveredId: hovered, pressedId: pressed });
  const directoryEntries = entries.filter(entry => {
    const visual = visuals.get(entry.id)!;
    return !(component.list?.flowLockedNode === 'hide' && visual.locked) || visual.forced;
  });
  const pageSize = rows ? rows * columns : Math.max(1, directoryEntries.length), pageCount = Math.max(1, Math.ceil(directoryEntries.length / pageSize));
  const activePage = Math.min(page, pageCount - 1), shown = directoryEntries.slice(activePage * pageSize, (activePage + 1) * pageSize);
  useLayoutEffect(() => {
    const saved = editable ? editing.viewports?.get(`grid:${groupId ?? ''}`) : undefined;
    setPage(saved?.page ?? 0);
    if (root.current) root.current.scrollTop = (saved?.y ?? 0) * scale;
    setHovered(undefined); setPressed(undefined);
  }, [component.id, groupId, customMode, component.list?.layout]);
  useEffect(() => { setPage(current => Math.min(current, pageCount - 1)); }, [pageCount]);
  useLayoutEffect(() => {
    if (!editable || !editing.locate) return;
    const request = `${component.id}:${groupId ?? ''}:${editing.locate.request}:${pageSize}`;
    if (handledLocate.current === request) return;
    const index = directoryEntries.findIndex(entry => entry.id === editing.locate?.nodeId);
    if (index >= 0 && rows && Math.floor(index / pageSize) !== activePage) { setPage(Math.floor(index / pageSize)); return; }
    handledLocate.current = request;
    const container = root.current, node = container?.querySelector<HTMLElement>('[data-flow-node="' + CSS.escape(editing.locate.nodeId) + '"]');
    if (container && node) container.scrollTo({ top: Math.max(0, node.offsetTop - container.clientHeight / 3) });
  }, [editable, editing?.locate?.request, groupId, pageSize, activePage]);
  const navigate = (next: number) => {
    const page = Math.max(0, Math.min(pageCount - 1, next));
    setPage(page);
    if (editable) editing.viewports?.set(`grid:${groupId ?? ''}`, { x: 0, y: (root.current?.scrollTop ?? 0) / scale, page });
  };
  const { navigation } = layout, paginationStyle = storyFlowPaginationStyle(component.list);
  const nav = { left: navigation.x * scale, top: navigation.y * scale, width: navigation.width * scale, height: navigation.height * scale };
  return <div className="ui-collection-preview ui-flow-directory" data-flow-group-view={groupId} data-flow-view-id={view.id ?? 'root'} data-flow-view-kind={view.kind} tabIndex={group ? 0 : undefined} onKeyDown={event => { if (group && event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); if (editing?.backView) editing.backView(); else editing?.enterGroup?.(undefined); } }} onPointerDown={event => { if (editable && event.button === 0 && event.target === event.currentTarget) editing.select(undefined); }}>
    {group && <div data-flow-breadcrumb className="ui-flow-breadcrumb" style={{ left: 0, top: 0, width: '100%', height: breadcrumbHeight * scale, position: 'absolute', fontSize: 12 * scale }} onPointerDown={event => event.stopPropagation()}>
      <button type="button" aria-label={hasCalls ? '返回上一级剧情图' : '返回剧情图'} onClick={() => editing?.backView ? editing.backView() : editing?.enterGroup?.(undefined)}>返回</button>
      <span>剧情图</span><span aria-hidden="true">/</span><strong title={editing?.browseNames?.join(' / ')}>{editing?.browseNames?.join(' / ') || group.name}</strong>
    </div>}
    <div ref={root} className="ui-flow-directory-grid" style={{ display: 'grid', position: 'absolute', left: 0, right: 0, top: layout.bodyTop * scale, height: viewHeight * scale, gridTemplateColumns: `repeat(${columns}, ${cellWidth * scale}px)`, gridAutoRows: `${cellHeight * scale}px`, gap: `${gapY * scale}px ${gapX * scale}px`, alignContent: 'start', overflowY: rows ? 'hidden' : 'auto', overflowX: 'hidden' }} onWheel={event => { if (!rows) event.stopPropagation(); }} onScroll={event => { if (editable) editing.viewports?.set(`grid:${groupId ?? ''}`, { x: 0, y: event.currentTarget.scrollTop / scale, page: activePage }); }}>
      {shown.map(entry => {
        const node = project.nodes.find(node => node.id === (entry.nodeId ?? entry.id));
        const look = flowNodeAppearance(themed, component, { ...entry, kind: entry.groupId ? 'passage' : isStandaloneNode(node) ? 'chapterTitle' : node?.kind });
        const { state: nodeState, locked, current, affected, forced, suffix } = visuals.get(entry.id)!;
        const isGroup = !!entry.groupId, isCall = !!entry.callId;
        const selected = editable && (editing.nodeId === entry.id || editing.inspector?.kind === 'group' && editing.inspector.groupId === entry.groupId || editing.inspector?.kind === 'call' && editing.inspector.callId === entry.callId);
        return <div key={entry.id} data-flow-node={entry.id} data-flow-call={entry.callId} data-flow-call-target={entry.targetId} data-flow-call-view={entry.viewId} data-flow-group={entry.groupId} data-flow-group-members={entry.memberIds?.join(' ')} data-flow-group-member-of={groupId && !isGroup ? groupId : undefined} data-flow-entry-id={!isGroup ? entry.nodeId ?? entry.id : undefined} data-flow-real-node-id={!isGroup ? entry.nodeId ?? entry.id : undefined} data-flow-state={nodeState} data-flow-selected={selected ? '' : undefined} data-flow-affected={affected ? '' : undefined} data-flow-forced-state={forced ? nodeState : undefined} role={editable ? 'button' : undefined} tabIndex={editable ? 0 : undefined} aria-label={editable ? isCall ? `子剧情：${entry.name}` : isGroup ? `剧情分组：${entry.name}，包含 ${entry.memberIds?.length ?? 0} 个节点` : `编辑节点：${entry.name}` : undefined} aria-pressed={editable ? selected : undefined}
          title={editable && isCall ? '单击查看说明；双击或按 Enter 查看子剧情' : editable && isGroup ? '单击查看分组属性；双击或按 Enter 进入' : undefined}
          onPointerDown={event => { if (editable && event.button === 0) { event.stopPropagation(); setPressed(entry.id); } }}
          onPointerUp={() => setPressed(undefined)} onPointerCancel={() => setPressed(undefined)}
          onClick={event => { if (editable) { event.stopPropagation(); editing.select(entry.id); } }}
          onDoubleClick={event => { if (editable && (isCall || isGroup)) { event.preventDefault(); event.stopPropagation(); if (editing.enterView && entry.viewId) editing.enterView(entry.viewId, entry.callId); else if (entry.groupId) editing.enterGroup?.(entry.groupId); } }}
          onPointerEnter={() => setHovered(entry.id)} onPointerLeave={() => { setHovered(undefined); setPressed(undefined); }}
          onKeyDown={event => { if (editable && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (editing.enterView && entry.viewId) editing.enterView(entry.viewId, entry.callId); else if (isGroup && entry.groupId) editing.enterGroup?.(entry.groupId); else editing.select(entry.id); } else if (editable && event.key === ' ') { event.preventDefault(); event.stopPropagation(); editing.select(entry.id); } }}
          style={{ position: 'relative', width: cellWidth * scale, height: cellHeight * scale, ...flowNodePreviewStyle(themed, look, scale, nodeState), outline: selected ? '2px solid #71bbdf' : undefined, outlineOffset: -2 }}>
          <UiFlowNodeFace node={{ ...entry, kind: entry.groupId ? 'passage' : node?.kind }} look={look} component={component} width={cellWidth} height={cellHeight} scale={scale} state={nodeState} locked={locked} current={current} suffix={suffix} assetUrl={assetUrl} />
          {isCall && <span className="ui-flow-call-open" aria-hidden="true" style={{ fontSize: 16 * scale }}>›</span>}
          {affected && <UiFlowAffectedOutline />}
        </div>;
      })}
    </div>
    {!directoryEntries.length && <span className="ui-collection-empty">暂无条目</span>}
    {!!rows && <div data-flow-pagination className="ui-collection-navigation" style={{ ...nav, fontSize: Math.min(themed.ui.fontSize, 22) * scale }} onPointerDown={event => event.stopPropagation()}>
      {paginationStyle === 'numbers' ? Array.from({ length: pageCount }, (_, index) => <button type="button" key={index} aria-label={`剧情目录第 ${index + 1} 页`} aria-current={index === activePage ? 'page' : undefined} onClick={() => navigate(index)} style={{ position: 'relative', width: Math.min(64, Math.max(20, navigation.width / pageCount - 8)) * scale, height: '100%', color: index === activePage ? component.list?.pageSelectedTextColor ?? themed.ui.accent : component.list?.pageTextColor ?? themed.ui.textColor }}><UiSkinImage skin={component.list?.pageSkin} state={index === activePage ? 'selected' : 'idle'} assetUrl={assetUrl} scale={scale} /><span style={{ position: 'relative' }}>{index + 1}</span></button>) : <><button type="button" aria-label="剧情目录上一页" disabled={!activePage} onClick={() => navigate(activePage - 1)}>上一页</button><span>{activePage + 1} / {pageCount}</span><button type="button" aria-label="剧情目录下一页" disabled={activePage + 1 >= pageCount} onClick={() => navigate(activePage + 1)}>下一页</button></>}
    </div>}
  </div>;
}
