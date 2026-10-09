import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useId } from 'react';
import { AssetImportContext } from './AssetImportContext';
import { createPortal } from 'react-dom';
import { Image, Music2, Film, Type, Bone, Search, X, Check, Folder } from 'lucide-react';
import type { Asset, AssetCategory, Project } from '../core/model';
import { assetCategories, assetCategoryNames, categoryAcceptsKind, groupedAssets } from '../core/asset-library';
import type { AssetUrl } from './StageEditor';
import { completionScore } from '../core/text-completion';

const kindNames = { image: '图片', audio: '音频', video: '视频', font: '字体', spine: '骨骼', script: '脚本', all: '资源' };
const categoryCache = new WeakMap<Project, Map<string, AssetCategory>>();
function previewCategories(project: Project) {
  let result = categoryCache.get(project);
  if (!result) { result = assetCategories(project); categoryCache.set(project, result); }
  return result;
}

export function ResourcePreviewDialog({ asset, assetUrl, onClose }: { asset: Asset; assetUrl: AssetUrl; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => previous?.focus({ preventScroll: true });
  }, []);
  return createPortal(<dialog ref={dialog} className="asset-picker-dialog resource-preview-dialog" aria-label={`资源详情 ${asset.name}`} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <header><div><strong>{asset.name}</strong><span>{asset.category ? assetCategoryNames[asset.category] : kindNames[asset.kind]}{asset.width && asset.height ? ` · ${asset.width} × ${asset.height}` : ''}</span></div><button className="icon-button" aria-label="关闭资源预览" onClick={onClose}><X size={18} /></button></header>
    <div className="resource-preview-media"><AssetPicture asset={asset} assetUrl={assetUrl} detail /></div>
    <footer><code>{asset.sourcePath ?? asset.path}</code><button type="button" onClick={onClose}>关闭</button></footer>
  </dialog>, document.body);
}

function AssetPicture({ asset, assetUrl, detail = false }: { asset?: Asset; assetUrl: AssetUrl; detail?: boolean }) {
  const [failed, setFailed] = useState(false);
  const url = assetUrl(asset?.id);
  useEffect(() => setFailed(false), [url]);
  if (!asset) return <Image size={22} aria-hidden="true" />;
  if (asset.kind === 'image' && url && !failed) return <img src={url} alt={detail ? asset.name : ''} loading={detail ? 'eager' : 'lazy'} draggable={false} onError={() => setFailed(true)} />;
  if (detail && asset.kind === 'audio') return <audio aria-label={`试听 ${asset.name}`} controls preload="metadata" src={url} />;
  if (detail && asset.kind === 'video') return <video aria-label={`预览 ${asset.name}`} controls preload="metadata" src={url} />;
  if (detail && asset.kind === 'font') return <><style>{`@font-face { font-family: "picker_${asset.id}"; src: url(${JSON.stringify(url)}); }`}</style><span className="asset-picker-font" style={{ fontFamily: `"picker_${asset.id}", sans-serif` }}>春江潮水连海平<br />中文字体预览 Aa 123</span></>;
  const Icon = asset.kind === 'audio' ? Music2 : asset.kind === 'video' ? Film : asset.kind === 'font' ? Type : asset.kind === 'spine' ? Bone : Image;
  return <><Icon size={detail ? 42 : 22} aria-hidden="true" />{failed && <small>图片无法预览</small>}</>;
}

/** Keep the compact keyboard selector, with a visual browser for large asset libraries. */
export function UiAssetSelect({ project, kind, value, onChange, assetUrl, label, empty = '沿用默认', category = kind === 'image' ? 'ui' : kind === 'audio' ? 'bgm' : kind, allowedIds, importExtensions, buttonOnly = false, onBrowserOpenChange, allowEmpty = true }: {
  project: Project; kind: Asset['kind'] | 'all'; value?: string; onChange: (value?: string) => void; assetUrl: AssetUrl; label?: string; empty?: string; category?: AssetCategory | 'all'; allowedIds?: string[]; importExtensions?: string[]; buttonOnly?: boolean; onBrowserOpenChange?: (open: boolean) => void; allowEmpty?: boolean;
}) {
  const displayLabel = label ?? `选择${kindNames[kind]}`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [candidate, setCandidate] = useState<string>();
  const importAsset = useContext(AssetImportContext);
  const [importing, setImporting] = useState(false), [importError, setImportError] = useState('');
  const [importedSelection, setImportedSelection] = useState<string>();
  const [scopeCategory, setScopeCategory] = useState<AssetCategory | 'all'>(category);
  const [group, setGroup] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLSpanElement>(null), suggestions = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [inlineOpen, setInlineOpen] = useState(false), [inlineQuery, setInlineQuery] = useState(''), [optionIndex, setOptionIndex] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 200 });
  const categories = useMemo(() => previewCategories(project), [project]);
  const assets = project.assets.filter(asset => (kind === 'all' || asset.kind === kind) && (!allowedIds || allowedIds.includes(asset.id)));
  const compact = assets.filter(asset => category === 'all' || categories.get(asset.id) === category || asset.id === value);
  const inlineChoices = inlineOpen ? compact.map(asset => ({ asset, score: completionScore(asset.name, inlineQuery, [asset.path, asset.sourcePath ?? '']) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 60).map(item => item.asset) : [];
  const options = allowEmpty && !inlineQuery.trim() ? [undefined, ...inlineChoices] : inlineChoices;
  const groups = open ? groupedAssets(project, assets.filter(asset => scopeCategory === 'all' || categories.get(asset.id) === scopeCategory)) : [];
  const selected = assets.find(asset => asset.id === value);
  const inspected = assets.find(asset => asset.id === candidate);
  const filteredGroups = groups.filter(item => !group || item.name === group).map(item => ({ ...item, assets: item.assets.filter(asset => completionScore(asset.name, query, [asset.path, asset.sourcePath ?? '', item.name]) > 0) })).filter(item => item.assets.length);
  const filtered = filteredGroups.flatMap(item => item.assets);
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    return () => { if (!onBrowserOpenChange) trigger.current?.focus({ preventScroll: true }); };
  }, [open]);
  const close = () => { if (importing) return; dialog.current?.close(); setOpen(false); onBrowserOpenChange?.(false); };
  const choose = (id?: string) => { if (!id && !allowEmpty) return; if (id && !assets.some(asset => asset.id === id)) { setImportError('素材类型不适用于当前选项。'); return; } onChange(id); close(); };
  useEffect(() => {
    if (!importing && importedSelection && project.assets.some(asset => asset.id === importedSelection)) {
      setImportedSelection(undefined); choose(importedSelection);
    }
  }, [project, importedSelection, importing]);
  const pickInline = (id?: string) => { setInlineOpen(false); setInlineQuery(''); onChange(id); };
  useLayoutEffect(() => {
    if (!inlineOpen) return;
    const place = () => { const bounds = field.current?.getBoundingClientRect(); if (bounds) setPosition({ left: Math.max(4, Math.min(bounds.left, innerWidth - 240)), top: bounds.bottom + 240 > innerHeight ? Math.max(4, bounds.top - 240) : bounds.bottom + 3, width: Math.max(220, bounds.width) }); };
    place(); window.addEventListener('resize', place);
    const dismiss = (event: PointerEvent) => { if (!field.current?.contains(event.target as Node) && !suggestions.current?.contains(event.target as Node)) setInlineOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => { window.removeEventListener('resize', place); document.removeEventListener('pointerdown', dismiss); };
  }, [inlineOpen]);
  useEffect(() => { suggestions.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' }); }, [optionIndex]);
  return <span className={`ui-asset-field ${buttonOnly ? 'asset-browse-only' : ''}`} ref={field}>
    {!buttonOnly && <><span className="ui-asset-mini" aria-hidden="true"><AssetPicture asset={selected} assetUrl={assetUrl} /></span><input role="combobox" aria-label={displayLabel} aria-autocomplete="list" aria-expanded={inlineOpen} aria-controls={inlineOpen ? listId : undefined} aria-activedescendant={inlineOpen && options.length ? `${listId}-${optionIndex}` : undefined} value={inlineOpen ? inlineQuery : selected?.name ?? (value ? '素材已丢失' : '')} placeholder={selected?.name ?? empty} onFocus={() => { setInlineQuery(''); setInlineOpen(true); setOptionIndex(0); }} onChange={event => { setInlineQuery(event.target.value); setInlineOpen(true); setOptionIndex(0); }} onBlur={() => setInlineOpen(false)} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); setInlineOpen(false); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setInlineOpen(true); setOptionIndex(index => Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))); }
      if (event.key === 'Enter' && inlineOpen) { event.preventDefault(); event.stopPropagation(); if (optionIndex < options.length) pickInline(options[optionIndex]?.id); }
    }} /></>}
    <button type="button" ref={trigger} className="ui-asset-thumbnail" aria-label={`浏览${displayLabel}`} title={selected ? `${selected.name}\n${selected.sourcePath ?? selected.path}\n点击浏览${kindNames[kind]}` : `浏览${kindNames[kind]}`} onClick={() => { setInlineOpen(false); setCandidate(value); setQuery(''); setScopeCategory(category); setGroup(''); onBrowserOpenChange?.(true); setOpen(true); }}>
      <Folder size={15} />{buttonOnly && <span>{selected?.name ?? (value ? '素材已丢失' : '选择资源…')}</span>}
    </button>
    {inlineOpen && createPortal(<div className="asset-combobox-options" ref={suggestions} id={listId} role="listbox" aria-label={`${displayLabel}搜索结果`} style={position} onMouseDown={event => event.preventDefault()} onWheel={event => event.stopPropagation()}>{options.map((asset, index) => <button type="button" role="option" key={asset?.id ?? 'empty'} id={`${listId}-${index}`} aria-selected={optionIndex === index} onClick={() => pickInline(asset?.id)}><span className="ui-asset-mini"><AssetPicture asset={asset} assetUrl={assetUrl} /></span><span>{asset?.name ?? empty}<small>{asset?.path}</small></span></button>)}{!options.length && <p>没有匹配的资源</p>}</div>, field.current?.closest('dialog') ?? document.body)}
    {open && createPortal(<dialog className="asset-picker-dialog" aria-label={`${displayLabel}资源浏览器`} ref={dialog} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } }}>
      <header><div><strong>选择{kindNames[kind]}</strong><span>{displayLabel} · {assets.length} 项{kind === 'all' ? '资源' : '可用' + kindNames[kind]}</span></div><button type="button" className="icon-button" aria-label="关闭资源浏览器" onClick={close}><X size={18} /></button></header>
      <div className="asset-picker-search"><Search size={16} /><input autoFocus aria-label="搜索可选资源" placeholder="搜索名称、角色或文件夹…" value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="可选素材分类" value={scopeCategory} onChange={event => { setScopeCategory(event.target.value as typeof scopeCategory); setGroup(''); }}><option value="all">全部{kindNames[kind]}</option>{(Object.entries(assetCategoryNames) as [AssetCategory, string][]).filter(([key]) => (kind === 'all' || categoryAcceptsKind(key, kind))).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select><span>{filtered.length} 项</span></div>
      <div className="asset-picker-body"><nav className="asset-picker-folders" aria-label="可选素材文件夹"><button type="button" className={!group ? 'active' : ''} onClick={() => setGroup('')}><Folder size={14} />当前分类全部</button>{groups.map(item => <button type="button" key={item.name} className={group === item.name ? 'active' : ''} title={item.name} onClick={() => setGroup(item.name)}><Folder size={14} /><span>{item.name}</span><small>{item.assets.length}</small></button>)}</nav><div className="asset-picker-grid" role="group" aria-label="可选资源">
        {allowEmpty && <button type="button" className={`asset-picker-card ${!candidate ? 'selected' : ''}`} aria-pressed={!candidate} onClick={() => setCandidate(undefined)} onDoubleClick={() => choose(undefined)}><span className="asset-picker-card-image"><X size={24} /></span><span>{empty}</span></button>}
        {filteredGroups.map(group => <div className="asset-picker-group" key={group.name}><h3>{group.name}</h3><div>{group.assets.map(asset => <button type="button" key={asset.id} className={`asset-picker-card ${candidate === asset.id ? 'selected' : ''}`} aria-label={`预览资源 ${asset.name}`} aria-pressed={candidate === asset.id} onClick={() => setCandidate(asset.id)} onDoubleClick={() => choose(asset.id)}>
          <span className="asset-picker-card-image"><AssetPicture asset={asset} assetUrl={assetUrl} />{candidate === asset.id && <Check className="asset-picker-check" size={15} />}</span><span title={asset.name}>{asset.name}</span>{asset.width && asset.height ? <small>{asset.width} × {asset.height}</small> : <small>{asset.path.split('.').at(-1)?.toUpperCase()}</small>}
        </button>)}</div></div>)}
        {!filtered.length && <p className="asset-picker-empty">没有匹配的{kindNames[kind]}，请调整搜索词。</p>}
      </div><aside className="asset-picker-detail" aria-label="资源预览">
        <div className="asset-picker-large" key={candidate ?? 'empty'}><AssetPicture asset={inspected} assetUrl={assetUrl} detail /></div>
        <strong>{inspected?.name ?? empty}</strong>{inspected && <><span>{assetCategoryNames[categories.get(inspected.id) ?? 'other']}{inspected.width && inspected.height ? ` · ${inspected.width} × ${inspected.height}` : ''}</span><code>{inspected.sourcePath ?? inspected.path}</code></>}
        <small>单击查看预览，双击使用资源。</small>
      </aside></div>
      {importError && <p role="alert" className="export-errors">{importError}</p>}
      <footer>{importAsset && kind !== 'spine' && (!allowedIds || importExtensions) && <button type="button" disabled={importing} title={project.resourceSettings?.importMode === 'reference' ? '按项目设置引用原文件' : '按项目设置复制进素材文件夹'} onClick={async () => {
        setImporting(true); setImportError('');
        try { const extensions = importExtensions ?? ({ image: ['png', 'jpg', 'jpeg', 'webp', 'avif'], audio: ['ogg', 'opus', 'wav', 'mp3', 'flac'], video: ['webm', 'mp4', 'ogv'], font: ['ttf', 'otf'], script: ['rpy'], all: undefined }[kind]); const asset = await importAsset({ single: true, extensions, category: category === 'all' ? undefined : category }); if (asset) setImportedSelection(asset.id); }
        catch (error) { setImportError(error instanceof Error ? error.message : String(error)); }
        finally { setImporting(false); }
      }}><Folder size={15} />{importing ? '正在导入…' : '选择项目外素材'}</button>}<span className="spacer" /><button type="button" disabled={importing} onClick={close}>取消</button><button type="button" className="primary" disabled={importing || !!candidate && !inspected || !candidate && !allowEmpty} onClick={() => choose(candidate)}>{!candidate && !allowEmpty ? '请选择素材' : '使用' + (inspected ? '所选资源' : empty)}</button></footer>
    </dialog>, document.body)}
  </span>;
}
