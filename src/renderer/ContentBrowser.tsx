import { selectBrowserAsset } from './resource-selection';
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { AudioLines, Bone, Boxes, ChevronRight, Clapperboard, FileCode2, Film, Folder, FolderOpen, FolderPlus, GitBranch, Image, LayoutGrid, List, Search, SlidersHorizontal, Star, Type, Upload, UserRound, X, Plus, Pencil, Trash2, PanelBottomClose } from 'lucide-react';
import { type AssetCategory, type BlueprintGraph, type Project } from '../core/model';
import type { AssetImportOptions } from '../core/bridge';
import { assetCategories, assetCategoryNames, assetGroupPath, categoryAcceptsKind, folderCategory, setAssetCategory } from '../core/asset-library';
import { contentKindNames, contentRemovalSelection, contentState, copyAssetSelection, createContentFolder, folderTrail, moveContentSelection, moveContentFolder, projectContent, removeContentSelection, renameContent, type ContentItem, type ContentKind } from '../core/content-browser';
import type { Commit } from './editor';
import type { AssetUrl } from './StageEditor';
import { IconButton } from './components';
import { ResourcePreviewDialog } from './AssetPicker';
import { useContentMarquee } from './useContentMarquee';
import { queryContent, type ContentScope } from '../core/content-query';
import './content-browser-filters.css';
import { ContentDeleteDialog } from './ContentDeleteDialog';

interface Props {
  focus?: { assetId: string; request: number };
  project: Project; commit: Commit; open: boolean; onClose: () => void; assetUrl: AssetUrl;
  onOpen: (item: ContentItem) => void; onImport: (options?: AssetImportOptions, spine?: boolean) => void;
  onDropFiles: (transfer: DataTransfer, options: AssetImportOptions) => void;
  onActiveSelection?: (keys: string[]) => void;
  variant?: 'dock' | 'workspace'; busy?: boolean;
  onCreateBlueprint: (kind: BlueprintGraph['kind'] | 'timeline', folderId?: string) => void;
  onRevealAsset?: (id: string) => Promise<void>;
}
const icons = { image: Image, audio: AudioLines, video: Film, font: Type, spine: Bone, script: FileCode2, blueprint: GitBranch, timeline: Clapperboard, character: UserRound, variable: SlidersHorizontal, scene: Boxes };
const readHeight = () => { try { return Number(localStorage.getItem('vns:content-height')) || 290; } catch { return 290; } };
const readTileSize = () => { try { return Math.max(96, Math.min(192, Math.round((Number(localStorage.getItem('vns:content-tile-size')) || 128) / 16) * 16)); } catch { return 128; } };
const contentOrder = new Intl.Collator('zh-CN', { numeric: true });

export function ContentBrowser({ project, commit, open, onClose, assetUrl, onOpen, onImport, onDropFiles, onCreateBlueprint, onRevealAsset, variant = 'dock', busy, onActiveSelection, focus }: Props) {
  const pendingFocus = useRef<{ key: string; folderId: string } | undefined>(undefined);
  const [scope, setScope] = useState<ContentScope>('folder');
  const [folderId, setFolderId] = useState('');
  const [query, setQuery] = useState('');
  const [kinds, setKinds] = useState<ContentKind[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const [previewId, setPreviewId] = useState<string>();
  const [mode, setMode] = useState<'grid' | 'list'>('grid');
  const [tileSize, setTileSize] = useState(readTileSize);
  const [sort, setSort] = useState<'name' | 'kind'>('name');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  const filtersId = useId();
  const [selection, setSelection] = useState<string[]>([]);
  const [height, setHeight] = useState(readHeight);
  const [createMenu, setCreateMenu] = useState(false);
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<{ kind: 'folder' | 'renameFolder' | 'rename'; value: string; folderId?: string }>();
  const [context, setContext] = useState<{ x: number; y: number }>();
  const [cut, setCut] = useState<string[]>([]);
  const [copied, setCopied] = useState<{ project: Project; keys: string[] }>();
  const [dialogError, setDialogError] = useState('');
  const [deleting, setDeleting] = useState<{ keys: string[]; parent?: string }>();
  const [deleteError, setDeleteError] = useState('');
  const removal = useMemo(() => deleting ? contentRemovalSelection(project, deleting.keys) : undefined, [project, deleting]);
  const resize = useRef<{ y: number; height: number } | undefined>(undefined);
  const anchor = useRef<string | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const items = useMemo(() => open ? projectContent(project) : [], [open, project.assets, project.blueprints, project.timelinePresets, project.characters, project.variables, project.scenes, project.chapters, project.nodes]);
  const categories = useMemo(() => open ? assetCategories(project) : new Map<string, AssetCategory>(), [open, project]);
  const assetById = useMemo(() => new Map(project.assets.map(asset => [asset.id, asset])), [project.assets]);
  const openItem = (item: ContentItem) => item.key.startsWith('asset:') ? setPreviewId(item.id) : onOpen(item);
  const folders = project.contentBrowser?.folders ?? [];
  const assignments = project.contentBrowser?.assignments ?? {};
  const favorites = project.contentBrowser?.favorites ?? [];
  const currentFolder = folders.find(folder => folder.id === folderId);
  const trail = folderTrail(project, folderId);
  const normalized = query.trim().toLocaleLowerCase();
  const results = useMemo(() => {
    const searchText = new Map(items.map(item => {
      const asset = item.key.startsWith('asset:') ? assetById.get(item.id) : undefined;
      return [item.key, `${item.name} ${item.callName ?? ''} ${item.detail} ${asset?.sourcePath ?? ''} ${item.path ?? ''} ${contentKindNames[item.kind]} ${asset ? assetGroupPath(project, asset, categories.get(asset.id)) : folderTrail(project, assignments[item.key]).map(folder => folder.name).join('/')}`];
    }));
    return queryContent(project, items, { kinds, query, scope, folderId, searchText });
  }, [items, kinds, query, scope, folderId, assetById, categories, project.contentBrowser]);
  const visible = useMemo(() => [...results.visible].sort((a, b) => (sort === 'kind' ? contentOrder.compare(contentKindNames[a.kind], contentKindNames[b.kind]) : 0) || contentOrder.compare(a.name, b.name)), [results, sort]);
  const selected = items.filter(item => selection.includes(item.key));
  const active = selected.at(-1);
  const selectedAssets = selected.flatMap(item => item.key.startsWith('asset:') ? assetById.get(item.id) ?? [] : []);
  useEffect(() => { const key = selection.at(-1); if (key?.startsWith('asset:')) selectBrowserAsset(project.id, key.slice(6)); }, [project.id, selection]);
  const validSelectionKeys = new Set([...items.map(item=>item.key), ...folders.map(folder=>'folder:'+folder.id)]);
  const selectionSignature = JSON.stringify(open ? selection.filter(key => validSelectionKeys.has(key)) : []);
  useEffect(() => { onActiveSelection?.(JSON.parse(selectionSignature)); }, [selectionSignature, onActiveSelection]);
  useEffect(() => () => onActiveSelection?.([]), [onActiveSelection]);
  const selectedCategory = selectedAssets.length && selectedAssets.every(asset => categories.get(asset.id) === categories.get(selectedAssets[0].id)) ? categories.get(selectedAssets[0].id) : '';
  const childFolders = [...results.childFolders].sort((a, b) => contentOrder.compare(a.name, b.name));
  const selectableKeys = [...childFolders.map(folder => 'folder:' + folder.id), ...visible.map(item => item.key)];
  const selectedFolder = folders.find(folder => selection.length === 1 && selection[0] === 'folder:' + folder.id);
  const marquee = useContentMarquee(selection, setSelection);
  const minimumHeight = Math.min(190, window.innerHeight * 0.5);
  const safeHeight = Math.max(minimumHeight, Math.min(height, window.innerHeight * 0.5));

  useEffect(() => { setFolderId(''); setScope('folder'); setSelection([]); setQuery(''); setKinds([]); setExpanded([]); setDialog(undefined); setDeleting(undefined); setNotice(''); }, [project.id]);
  useEffect(() => {
    if (!filtersOpen) return;
    const close = (event: PointerEvent) => { if (!filtersRef.current?.contains(event.target as Node)) setFiltersOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [filtersOpen]);
  useEffect(() => { if (folderId && !currentFolder) setFolderId(''); }, [folderId, currentFolder]);
  useEffect(() => { try { localStorage.setItem('vns:content-height', String(height)); } catch { /* Layout preference is optional. */ } }, [height]);
  useEffect(() => { try { localStorage.setItem('vns:content-tile-size', String(tileSize)); } catch { /* Layout preference is optional. */ } }, [tileSize]);
  useEffect(() => { if (open && variant === 'dock') searchRef.current?.focus({ preventScroll: true }); }, [open, variant]);
  useEffect(() => { setSelection([]); setContext(undefined); anchor.current = undefined; }, [scope, folderId, query, kinds]);
  useEffect(() => { setCut([]); setCopied(undefined); }, [project.id]);
  useEffect(() => { if (!context) return; const close = () => setContext(undefined); window.addEventListener('pointerdown', close); window.addEventListener('resize', close); return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('resize', close); }; }, [context]);
  const navigate = (id = '') => { setFolderId(id); setScope('folder'); setSelection([]); setNotice(''); setExpanded(previous => [...new Set([...previous, ...folderTrail(project, id).map(folder => folder.id)])]); };
  useEffect(() => {
    if (!open || !focus || !assetById.has(focus.assetId)) return;
    const key = 'asset:' + focus.assetId;
    const destination = project.contentBrowser?.folders.find(folder => folder.id === assignments[key])?.id ?? '';
    pendingFocus.current = { key, folderId: destination };
    setKinds([]); setQuery(''); navigate(destination); setContext(undefined); setDialog(undefined); setPreviewId(undefined);
  }, [focus, open, project.id]);
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || scope !== 'folder' || folderId !== pending.folderId || query || kinds.length || !visible.some(item => item.key === pending.key)) return;
    pendingFocus.current = undefined;
    setSelection([pending.key]); anchor.current = pending.key;
    const frame = requestAnimationFrame(() => {
      const card = Array.from(marquee.surface.current?.querySelectorAll<HTMLElement>('[data-content-key]') ?? []).find(element => element.dataset.contentKey === pending.key);
      card?.scrollIntoView({ block: 'nearest' }); card?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focus, visible, scope, folderId, query, kinds]);
  const importOptions = (destination = scope === 'folder' ? folderId || undefined : undefined): AssetImportOptions => ({ folderId: destination, category: folderCategory(project, destination) });
  const newDialog = (next: NonNullable<typeof dialog>) => { setDialog(next); setDialogError(''); setCreateMenu(false); };
  const drop = (event: DragEvent, destination?: string) => {
    event.preventDefault(); event.stopPropagation();
    setDropActive(false);
    if (busy) return;
    if (event.dataTransfer.types.includes('Files')) { onDropFiles(event.dataTransfer, importOptions(destination)); return; }
    const movedFolder = event.dataTransfer.getData('application/vns-folder');
    if (movedFolder) {
      let moved = false;
      commit('移动内容文件夹', draft => { moved = moveContentFolder(draft, movedFolder, destination); });
      setNotice(moved ? '文件夹已移动' : '无法移入自身、子文件夹或同名位置'); return;
    }
    try {
      const keys: unknown = JSON.parse(event.dataTransfer.getData('application/vns-content'));
      if (Array.isArray(keys) && keys.every(key => typeof key === 'string')) {
        let count = 0;
        commit('移动资源到文件夹', draft => { count = moveContentSelection(draft, keys, destination); });
        setNotice(`已移动 ${count} 项${count < keys.length ? '，无法移动的项目留在原处' : '，可撤销'}`);
      }
    } catch { /* A foreign drop is not a project resource. */ }
  };
  const allowDrop = (event: DragEvent) => {
    if (['Files', 'application/vns-content', 'application/vns-folder'].some(type => event.dataTransfer.types.includes(type))) { event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : event.dataTransfer.types.includes('Files') ? 'copy' : 'move'; }
  };
  const selectKey = (key: string, event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    if (event.shiftKey && anchor.current) {
      const from = selectableKeys.indexOf(anchor.current), to = selectableKeys.indexOf(key);
      if (from >= 0 && to >= 0) { const range = selectableKeys.slice(Math.min(from, to), Math.max(from, to) + 1); setSelection(previous => event.ctrlKey || event.metaKey ? [...new Set([...previous, ...range])] : range); return; }
    }
    setSelection(previous => event.ctrlKey || event.metaKey ? previous.includes(key) ? previous.filter(item => item !== key) : [...previous, key] : [key]);
    anchor.current = key;
  };
  const selectItem = (item: ContentItem, event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => selectKey(item.key, event);
  const toggleFavorites = () => commit('收藏资源', draft => { const state = contentState(draft), keys = selected.map(item => item.key); const remove = keys.every(key => state.favorites.includes(key)); state.favorites = [...new Set(remove ? state.favorites.filter(key => !keys.includes(key)) : [...state.favorites, ...keys])]; });
  const renameSelection = () => { if (selectedFolder) newDialog({ kind: 'renameFolder', value: selectedFolder.name, folderId: selectedFolder.id }); else if (selection.length === 1 && active) newDialog({ kind: 'rename', value: active.name }); };
  const removeSelection = (keys = selection, parent?: string) => {
    if (!keys.length || busy) return;
    setDeleteError(''); setDeleting({ keys: [...keys], parent }); setContext(undefined);
  };
  const confirmRemoval = () => {
    if (!deleting || !removal || busy) return;
    try {
      commit('删除所选资源及文件夹内容', draft => removeContentSelection(draft, deleting.keys));
      if (deleting.parent !== undefined) navigate(deleting.parent);
      setNotice(`已删除 ${removal.items.length} 项资源${removal.folders.length ? `、${removal.folders.length} 个文件夹` : ''}，可撤销。`);
      setSelection([]); setDeleting(undefined);
    } catch (error) { setDeleteError(error instanceof Error ? error.message : String(error)); }
  };
  const copy = () => {
    const keys = selection.filter(key => key.startsWith('asset:') || key.startsWith('folder:'));
    if (!keys.length) return;
    setCopied({ project: structuredClone(project), keys }); setCut([]); setNotice(`已复制 ${keys.length} 项`);
  };
  const cutSelection = () => { setCopied(undefined); setCut(selection); setNotice(`已剪切 ${selection.length} 项`); };
  const reveal = async () => { if (!active?.key.startsWith('asset:') || !onRevealAsset) return; try { await onRevealAsset(active.id); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); } };
  const paste = () => {
    if (busy) return;
    if (copied) {
      try { let keys: string[] = []; commit('粘贴复制的素材', draft => { keys = copyAssetSelection(draft, copied.project, copied.keys, scope === 'folder' ? folderId || undefined : undefined); }); setSelection(keys); setNotice(`已粘贴 ${keys.length} 项，可撤销`); }
      catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
      return;
    }
    if (!cut.length) return;
    let count = 0;
    commit('移动剪切的资源', draft => { count = moveContentSelection(draft, cut, scope === 'folder' ? folderId || undefined : undefined); });
    setNotice('已移动 ' + count + ' 项，可撤销' + (count < cut.length ? '；无法移动的项目保持原位' : '')); setCut([]);
  };
  const startDrag = (event: DragEvent, item: ContentItem) => {
    const keys = selection.includes(item.key) ? selection : [item.key];
    setSelection(keys); event.dataTransfer.effectAllowed = 'copyMove';
    event.dataTransfer.setData('application/vns-content', JSON.stringify(keys));
    if (keys.length === 1) {
      event.dataTransfer.setData(item.kind === 'timeline' ? 'application/vns-timeline' : item.kind === 'blueprint' ? 'application/vns-blueprint' : item.kind === 'character' ? 'application/vns-character' : item.kind === 'variable' ? 'application/vns-variable' : item.kind === 'scene' ? 'application/vns-scene' : 'application/vns-asset', item.id);
    }
  };
  const submitDialog = () => {
    if (!dialog?.value.trim()) { setDialogError('请输入名称'); return; }
    let success = true;
    try { commit(dialog.kind === 'folder' ? '新建内容文件夹' : '重命名内容', draft => {
      if (dialog.kind === 'folder') {
        const created = createContentFolder(draft, dialog.value, folderId || undefined);
        success = !!created;
      }
      else if (dialog.kind === 'rename' && active) renameContent(draft, active, dialog.value);
      else if (dialog.kind === 'renameFolder') {
        const state = contentState(draft), id = dialog.folderId ?? folderId, target = state.folders.find(folder => folder.id === id);
        const name = dialog.value.trim().slice(0, 80);
        if (target && !state.folders.some(folder => folder.id !== id && folder.parentId === target.parentId && folder.name === name)) target.name = name;
        else success = false;
      }
    }); } catch (error) { setDialogError(error instanceof Error ? error.message : String(error)); return; }
    if (success) { setDialog(undefined); setNotice('已更新，可使用撤销恢复'); } else setDialogError('此位置已有同名文件夹，或已达到文件夹数量上限');
  };
  const thumbnail = (item: ContentItem) => {
    const Icon = icons[item.kind];
    return item.assetId && (item.kind === 'image' || item.kind === 'character') ? <img src={assetUrl(item.assetId)} alt="" loading="lazy" /> : <Icon className="content-type-icon" size={48} strokeWidth={1.5} aria-hidden="true" />;
  };
  if (!open) return null;
  return <section className={`content-browser content-${variant} ${dropActive ? 'accepting-files' : ''}`} aria-label="资源管理器" inert={!!deleting} style={{ '--content-tile-size': `${tileSize}px`, ...(variant === 'dock' ? { height: safeHeight } : {}) } as CSSProperties} onDragOver={allowDrop} onDrop={event => drop(event, scope === 'folder' ? folderId || undefined : undefined)} onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) setDropActive(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false); }} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); if (marquee.cancel()) return; dialog ? setDialog(undefined) : context ? setContext(undefined) : filtersOpen ? setFiltersOpen(false) : createMenu ? setCreateMenu(false) : selection.length ? setSelection([]) : variant === 'dock' ? onClose() : undefined; }
    if ((event.target as Element).closest('input, textarea, select, [contenteditable=true]')) return;
    if (event.key === 'F2') { event.preventDefault(); event.stopPropagation(); renameSelection(); }
    if (event.key === 'Delete') { event.preventDefault(); event.stopPropagation(); removeSelection(); }
    if ((event.ctrlKey || event.metaKey) && ['a', 'c', 'x', 'v'].includes(event.key.toLowerCase())) {
      event.preventDefault(); event.stopPropagation();
      if (event.key.toLowerCase() === 'a') setSelection(selectableKeys);
      else if (event.key.toLowerCase() === 'c') copy();
      else if (event.key.toLowerCase() === 'x') cutSelection();
      else paste();
    }
  }}>
    {variant === 'dock' && <div className="content-resizer" role="separator" aria-label="调整资源管理器高度" aria-orientation="horizontal" aria-valuenow={Math.round(safeHeight)} aria-valuemin={Math.round(minimumHeight)} aria-valuemax={Math.round(window.innerHeight * 0.5)} tabIndex={0}
      onPointerDown={event => { resize.current = { y: event.clientY, height: safeHeight }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (resize.current) setHeight(Math.max(minimumHeight, Math.min(window.innerHeight * 0.5, resize.current.height + resize.current.y - event.clientY))); }}
      onPointerUp={() => { resize.current = undefined; }} onPointerCancel={() => { resize.current = undefined; }}
      onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); setHeight(Math.max(minimumHeight, Math.min(window.innerHeight * 0.5, safeHeight + (event.key === 'ArrowUp' ? 24 : -24)))); } }} />}
    <div className="content-toolbar">
      <strong><FolderOpen size={16} />资源管理器</strong>
      <div className="content-create"><button className="small-button" aria-expanded={createMenu} onClick={() => setCreateMenu(!createMenu)}><Plus size={14} />新建</button>{createMenu && <div className="content-create-menu">
        <button onClick={() => newDialog({ kind: 'folder', value: '新文件夹' })}><FolderPlus size={14} />文件夹</button>
        <button onClick={() => { onCreateBlueprint('timeline', folderId || undefined); setCreateMenu(false); }}><Clapperboard size={14} />时间轴预设</button>
        {([['effect', '演出蓝图'], ['function', '蓝图'], ['macro', '用户节点']] as const).map(([type, label]) => <button key={type} onClick={() => { onCreateBlueprint(type, folderId || undefined); setCreateMenu(false); }}><GitBranch size={14} />{label}</button>)}
      </div>}</div>
      <button className="small-button" disabled={busy} onClick={() => onImport(importOptions())}><Upload size={14} />导入素材</button>
      <IconButton title="导入文件夹（保留子文件夹）" disabled={busy} onClick={() => onImport({ ...importOptions(), mode: 'folder' })}><FolderPlus size={16} /></IconButton>
      <IconButton title="导入骨骼动画" disabled={busy} onClick={() => onImport(importOptions(), true)}><Bone size={16} /></IconButton>
      <div className="search content-search"><Search size={14} /><input ref={searchRef} aria-label="搜索资源和蓝图" placeholder="搜索名称、调用名…" value={query} onChange={event => setQuery(event.target.value)} />{query && <IconButton title="清空资源搜索" onClick={() => setQuery('')}><X size={13} /></IconButton>}</div>
      <select className="content-scope" aria-label="资源显示范围" value={scope} onChange={event => setScope(event.target.value as ContentScope)}><option value="folder">在文件夹内</option><option value="all">全部匹配</option><option value="favorites">收藏</option></select>
      <div className="content-filter-menu" ref={filtersRef}>
      <button type="button" className="small-button content-filter-toggle" title={kinds.length ? kinds.map(kind => contentKindNames[kind]).join('、') : '全部类型'} aria-label="类型筛选" aria-expanded={filtersOpen} aria-controls={filtersId} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={14} /><span>类型</span>{kinds.length > 0 && <span className="content-filter-count">{kinds.length}</span>}</button>
      <div id={filtersId} className="content-type-filters" hidden={!filtersOpen} role="group" aria-label="资源类型筛选（可多选）">
        <strong>资源类型 <small>可多选</small></strong>
        {(Object.entries(contentKindNames) as [ContentKind, string][]).map(([kind, label]) => {
          const Icon = icons[kind];
          return <label key={kind} className={kinds.includes(kind) ? 'active' : ''}><input type="checkbox" aria-label={`筛选${label}`} checked={kinds.includes(kind)} onChange={event => setKinds(previous => event.target.checked ? [...previous, kind] : previous.filter(value => value !== kind))} /><Icon size={14}/>{label}<small>{items.filter(item => item.kind === kind).length}</small></label>;
        })}
        <button type="button" className="text-button" disabled={!kinds.length} onClick={() => setKinds([])}>显示全部类型</button>
      </div></div>
      <select className="content-sort" aria-label="资源排序" title="资源排序" value={sort} onChange={event => setSort(event.target.value as typeof sort)}><option value="name">名称排序</option><option value="kind">类型排序</option></select>
      <div className="segmented"><IconButton title="缩略图视图" aria-pressed={mode === 'grid'} className={mode === 'grid' ? 'active' : ''} onClick={() => setMode('grid')}><LayoutGrid size={15} /></IconButton><IconButton title="列表视图" aria-pressed={mode === 'list'} className={mode === 'list' ? 'active' : ''} onClick={() => setMode('list')}><List size={15} /></IconButton></div>
      {variant === 'dock' && <IconButton title="收起资源管理器（Ctrl+空格）" onClick={onClose}><PanelBottomClose size={17} /></IconButton>}
    </div>
    <div className="content-body">
      <nav className="content-tree" aria-label="资源文件夹">
        <button className={scope === 'favorites' ? 'active' : ''} onClick={() => setScope('favorites')}><Star size={14} />收藏</button>
        <div className="content-tree-heading">项目文件夹</div>
        <button className={scope === 'folder' && !folderId ? 'active' : ''} onClick={() => navigate()} onDragOver={allowDrop} onDrop={event => drop(event)}><FolderOpen size={14} /><span>项目资源</span><small>{items.length}</small></button>
        {[...folders].sort((a, b) => folderTrail(project, a.id).map(f => f.name).join('/').localeCompare(folderTrail(project, b.id).map(f => f.name).join('/'), 'zh-CN')).filter(folder => folderTrail(project, folder.id).slice(0, -1).every(parent => expanded.includes(parent.id))).map(folder => <div className="content-folder-row" key={folder.id} style={{ paddingLeft: Math.min(6, folderTrail(project, folder.id).length - 1) * 12 }}>
          <button className="content-folder-disclosure" aria-label={`${expanded.includes(folder.id) ? '收起' : '展开'}文件夹 ${folder.name}`} aria-expanded={expanded.includes(folder.id)} disabled={!folders.some(child => child.parentId === folder.id)} onClick={() => setExpanded(previous => previous.includes(folder.id) ? previous.filter(id => id !== folder.id) : [...previous, folder.id])}><ChevronRight size={12} /></button>
          <button draggable onDragStart={event => { event.dataTransfer.setData('application/vns-folder', folder.id); event.dataTransfer.effectAllowed = 'move'; }} onDragOver={allowDrop} onDrop={event => drop(event, folder.id)} className={scope === 'folder' && folderId === folder.id ? 'active' : ''} onClick={() => navigate(folder.id)} title={folderTrail(project, folder.id).map(f => f.name).join(' / ')}>{scope === 'folder' && folderId === folder.id ? <FolderOpen size={16} /> : <Folder size={16} />}<span>{folder.name}</span></button>
        </div>)}
      </nav>
      <div className="content-main">
        <div className="content-breadcrumb"><button onClick={() => navigate()}>项目资源</button>{scope !== 'folder' ? <><ChevronRight size={12} /><span>{scope === 'favorites' ? '收藏' : '全部匹配'}</span></> : trail.map(folder => <span key={folder.id}><ChevronRight size={12} /><button onClick={() => navigate(folder.id)}>{folder.name}</button></span>)}{(normalized || kinds.length > 0) && <small>{scope === 'folder' ? '保留文件夹结构' : '显示全部匹配资源'}</small>}<div className="spacer" />{currentFolder && scope === 'folder' && <><IconButton title="重命名文件夹" onClick={() => newDialog({ kind: 'renameFolder', value: currentFolder.name })}><Pencil size={13} /></IconButton><IconButton title="删除文件夹及全部内容" onClick={() => removeSelection(['folder:' + folderId], currentFolder.parentId ?? '')}><Trash2 size={13} /></IconButton></>}</div>
        {mode === 'list' && <div className="content-list-heading" aria-hidden="true"><span /><span>名称</span><span>类型</span><span>位置 / 说明</span></div>}
        <div className={`content-items ${mode}`} ref={marquee.surface} tabIndex={0} {...marquee.events} aria-label="资源列表" onDragOver={allowDrop} onDrop={event => drop(event, scope === 'folder' ? folderId || undefined : undefined)}
          onContextMenu={event => { event.preventDefault(); event.stopPropagation(); const key = (event.target as Element).closest<HTMLElement>('[data-content-key]')?.dataset.contentKey; if (key && !selection.includes(key)) setSelection([key]); setContext({ x: Math.min(event.clientX, window.innerWidth - 270), y: Math.min(event.clientY, window.innerHeight - Math.min(460, window.innerHeight - 16)) }); }}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || !selectableKeys.length) return;
            event.preventDefault(); event.stopPropagation();
            const cards = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-content-key]')];
            const columns = mode === 'list' ? 1 : cards.filter(card => Math.abs(card.getBoundingClientRect().top - cards[0].getBoundingClientRect().top) < 2).length || 1;
            const focused = (event.target as HTMLElement).closest<HTMLElement>('[data-content-key]')?.dataset.contentKey ?? selection.at(-1);
            const from = Math.max(0, selectableKeys.indexOf(focused ?? ''));
            const index = event.key === 'Home' ? 0 : event.key === 'End' ? selectableKeys.length - 1 : Math.max(0, Math.min(selectableKeys.length - 1, from + ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key] ?? 0)));
            selectKey(selectableKeys[index], event); cards[index]?.focus({ preventScroll: true }); cards[index]?.scrollIntoView({ block: 'nearest' });
          }}>
          {childFolders.map(folder => <button key={folder.id} data-content-key={'folder:' + folder.id} className={'content-item folder-item ' + (selection.includes('folder:' + folder.id) ? 'selected ' : '') + (cut.includes('folder:' + folder.id) ? 'cut' : '')} aria-pressed={selection.includes('folder:' + folder.id)} draggable onDragStart={event => { const keys = selection.includes('folder:' + folder.id) ? selection : ['folder:' + folder.id]; setSelection(keys); event.dataTransfer.setData('application/vns-content', JSON.stringify(keys)); event.dataTransfer.effectAllowed = 'move'; }} onDragOver={allowDrop} onDrop={event => drop(event, folder.id)} onClick={event => selectKey('folder:' + folder.id, event)} onDoubleClick={() => navigate(folder.id)} onKeyDown={event => { if (event.key === 'Enter') navigate(folder.id); }} title={`双击打开 ${folder.name}`}><div className="content-thumbnail"><Folder className="content-type-icon" size={48} strokeWidth={1.5} aria-hidden="true" /></div><strong>{folder.name}</strong><small>文件夹</small>{mode === 'list' && <span className="content-list-detail">{folderTrail(project, folder.id).map(parent => parent.name).join(' / ')}</span>}</button>)}
          {visible.map(item => {
            const asset = item.key.startsWith('asset:') ? assetById.get(item.id) : undefined;
            const location = asset ? assetGroupPath(project, asset, categories.get(item.id)) : folderTrail(project, assignments[item.key]).map(folder => folder.name).join(' / ');
            return <button key={item.key} data-content-key={item.key} className={`content-item ${item.kind} ${selection.includes(item.key) ? 'selected' : ''} ${cut.includes(item.key) ? 'cut' : ''}`} aria-pressed={selection.includes(item.key)} draggable onDragStart={event => startDrag(event, item)} onClick={event => selectItem(item, event)} onDoubleClick={() => openItem(item)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); openItem(item); } }} title={`${item.name}\n${item.detail}\n${location}\n双击打开；可拖入蓝图或舞台`}><div className="content-thumbnail">{thumbnail(item)}{favorites.includes(item.key) && <Star className="content-favorite-mark" size={12} />}</div><strong>{item.name}</strong><small>{contentKindNames[item.kind]}</small>{mode === 'list' && <span className="content-list-detail">{location || item.detail}</span>}</button>;
          })}
          {marquee.box && <div className="content-marquee" aria-hidden="true" style={marquee.box} />}
          {!visible.length && !childFolders.length && <div className="content-empty"><Search size={25} /><strong>{normalized ? '没有匹配的资源' : scope === 'favorites' ? '尚未收藏资源' : '此处还没有内容'}</strong><span>{normalized ? '尝试缩短关键词，或切换到全部内容' : '可直接拖入系统文件或文件夹，保留原有目录分组'}</span></div>}
        </div>
      </div>
      <aside className="content-details" aria-label="资源预览">{active ? <>
        <div className={`content-preview ${active.kind}`} key={active.key}>{active.kind === 'audio' ? <audio controls preload="none" src={assetUrl(active.id)} /> : active.kind === 'video' ? <video controls preload="metadata" src={assetUrl(active.id)} /> : thumbnail(active)}</div>
        <strong title={active.name}>{selected.length > 1 ? `已选 ${selected.length} 项` : active.name}</strong><span>{active.detail}</span>
        {active.callName && <code className="content-call-name" title="文本调用名">@{active.callName}</code>}
        {selectedAssets.length === selected.length && <label className="content-move">分类<select aria-label="素材分类" value={selectedCategory ?? ''} onChange={event => commit('设置素材分类', draft => setAssetCategory(draft, selectedAssets.map(asset => asset.id), event.target.value as AssetCategory))}><option value="" disabled>多个分类</option>{(Object.entries(assetCategoryNames) as [AssetCategory, string][]).filter(([key]) => selectedAssets.every(asset => categoryAcceptsKind(key, asset.kind))).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>}
        <div className="content-detail-actions"><button className="small-button" onClick={() => openItem(active)}>打开</button><IconButton title="重命名资源（F2）" disabled={selected.length !== 1} onClick={() => newDialog({ kind: 'rename', value: active.name })}><Pencil size={14} /></IconButton><IconButton title={favorites.includes(active.key) ? '取消收藏' : '收藏资源'} aria-pressed={favorites.includes(active.key)} onClick={() => commit('收藏资源', draft => { const state = contentState(draft); const remove = selected.every(item => state.favorites.includes(item.key)); state.favorites = [...new Set(remove ? state.favorites.filter(key => !selection.includes(key)) : [...state.favorites, ...selection])]; })}><Star size={14} /></IconButton></div>
        <label className="content-move">移动到<select aria-label="移动所选资源到文件夹" value={selected.every(item => assignments[item.key] === assignments[active.key]) ? assignments[active.key] ?? '' : '__mixed'} onChange={event => { let count = 0; commit('移动资源到文件夹', draft => { count = moveContentSelection(draft, selection, event.target.value || undefined); }); setNotice(`已移动 ${count} 项，可撤销`); }}><option value="">内容根目录</option><option value="__mixed" disabled>多个文件夹</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folderTrail(project, folder.id).map(f => f.name).join(' / ')}</option>)}</select></label>
        {active.path && <small className="content-path" title={assetById.get(active.id)?.externalPath ?? active.path}>{assetById.get(active.id)?.externalPath ?? assetById.get(active.id)?.sourcePath ?? active.path}</small>}
      </> : <div className="content-detail-empty"><Boxes size={30} /><span>{selectedFolder?.name ?? (selection.length ? '已选 ' + selection.length + ' 项' : '选择资源查看预览')}</span><small>空白处拖动框选 · Ctrl / Shift 多选<br />右键操作 · Ctrl+X / V 移动<br />F2 改名 · Delete 删除 · 撤销恢复</small></div>}</aside>
    </div>
    <div className="content-status"><span>{busy ? '正在导入，请稍候…' : notice || `${visible.length} 项资源${childFolders.length ? ` · ${childFolders.length} 个文件夹` : ''}${selection.length ? ` · 已选 ${selection.length} 项` : ''}`}</span><span className="content-status-help">空白处框选 · 右键操作 · {variant === 'dock' ? 'Ctrl+空格 收起' : '双击打开 · 拖拽分组'}</span>{mode === 'grid' && <label className="content-tile-size">缩略图<input type="range" aria-label="资源缩略图大小" min={96} max={192} step={16} value={tileSize} onChange={event => setTileSize(Number(event.target.value))} /></label>}</div>
    {context && <div className="content-context-menu" role="menu" aria-label="资源操作" style={{ left: Math.max(0, context.x), top: Math.max(8, context.y), maxHeight: 'calc(100vh - 16px)', overflowY: 'auto', width: 264 }} onPointerDown={event => event.stopPropagation()} onClick={() => setContext(undefined)}>
      <button role="menuitem" disabled={selection.length !== 1} onClick={() => selectedFolder ? navigate(selectedFolder.id) : active && openItem(active)}>打开<span>Enter</span></button>
      <button role="menuitem" disabled={selection.length !== 1} onClick={renameSelection}>重命名<span>F2</span></button>
      <button role="menuitem" disabled={!selected.length} onClick={toggleFavorites}>收藏 / 取消收藏</button>
      <button role="menuitem" disabled={selection.length !== 1 || !active?.key.startsWith('asset:') || !onRevealAsset} onClick={() => void reveal()}>在文件资源管理器中查看</button>
      <button role="menuitem" disabled={selection.length !== 1 || !active?.key.startsWith('asset:')} onClick={() => { const asset = assetById.get(active!.id)!; void navigator.clipboard.writeText(asset.externalFiles?.[asset.path] ?? asset.externalPath ?? asset.path).then(() => setNotice('素材路径已复制'), () => setNotice('无法写入剪贴板')); }}>复制文件路径</button>
      <hr />
      <button role="menuitem" disabled={!selection.some(key => key.startsWith('asset:') || key.startsWith('folder:'))} onClick={copy}>复制<span>Ctrl+C</span></button>
      <button role="menuitem" disabled={!selection.length} onClick={cutSelection}>剪切<span>Ctrl+X</span></button>
      <button role="menuitem" disabled={!cut.length && !copied || !!busy} onClick={paste}>粘贴到此处<span>Ctrl+V</span></button>
      <button role="menuitem" onClick={() => setSelection(selectableKeys)}>全选<span>Ctrl+A</span></button>
      <hr />
      <button role="menuitem" onClick={() => newDialog({ kind: 'folder', value: '新文件夹' })}>新建文件夹</button>
      <button role="menuitem" className="danger-text" disabled={!selection.length || !!busy} onClick={() => removeSelection()}>删除<span>Delete</span></button>
    </div>}
    {dropActive && !busy && <div className="content-drop-hint"><Upload size={24} /><strong>松开即可导入</strong><span>{project.resourceSettings?.importMode === 'reference' ? '引用原文件' : '复制到项目'}，保留子文件夹</span></div>}
    {previewId && assetById.has(previewId) && <ResourcePreviewDialog asset={assetById.get(previewId)!} assetUrl={assetUrl} onClose={() => setPreviewId(undefined)} />}
    {removal && <ContentDeleteDialog removal={removal} error={deleteError} onCancel={() => setDeleting(undefined)} onDelete={confirmRemoval} />}
    {dialog && <div className="content-dialog-backdrop"><form className="content-dialog" role="dialog" aria-label={dialog.kind === 'folder' ? '新建文件夹' : '重命名'} onSubmit={event => { event.preventDefault(); submitDialog(); }}><strong>{dialog.kind === 'folder' ? '新建文件夹' : '重命名'}</strong><input autoFocus aria-label="内容名称" maxLength={dialog.kind === 'rename' ? 120 : 80} value={dialog.value} onFocus={event => event.target.select()} onChange={event => setDialog({ ...dialog, value: event.target.value })} />{dialogError && <p role="alert">{dialogError}</p>}<div><button type="button" className="small-button" onClick={() => setDialog(undefined)}>取消</button><button type="submit" className="primary">确定</button></div></form></div>}
  </section>;
}
