import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Music2, Search, X } from 'lucide-react';
import type { Project, UiComponent } from '../core/model';
import { musicRoomEntries } from '../core/music-preview';
import { UiAssetSelect } from './AssetPicker';
import { Field, IconButton } from './components';
import { UiGalleryContentFields } from './UiGalleryGroups';
import { componentName } from './UiNames';
import type { AssetUrl } from './StageEditor';
import './ui-collection-content-dialog.css';

type CollectionContentProps = {
  project: Project;
  component: UiComponent;
  edit: (change: (component: UiComponent) => void, options?: { separate?: boolean }) => void;
  assetUrl: AssetUrl;
};
const maxCollectionAssets = 2048;
const contentTitles: Partial<Record<UiComponent['kind'], string>> = {
  musicTrackList: '管理音乐曲目', galleryGrid: '管理图鉴内容', voiceCollection: '管理语音素材',
};

/** Writes into the current design through the caller's normal draft/undo transaction. */
export function UiCollectionContentDialog({ project, component, edit, assetUrl, onClose }: CollectionContentProps & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), opener = useRef(document.activeElement as HTMLElement | null);
  const identity = useRef({ id: component.id, kind: component.kind });
  const titleId = useId(), scopeId = useId();
  const valid = component.id === identity.current.id && component.kind === identity.current.kind && !!contentTitles[component.kind];
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      requestAnimationFrame(() => { if (!element?.open && opener.current?.isConnected) opener.current.focus({ preventScroll: true }); });
    };
  }, []);
  useEffect(() => { if (!valid) onClose(); }, [valid, onClose]);
  const update: CollectionContentProps['edit'] = (change, options) => {
    if (!valid) return;
    edit(current => { if (current.id === identity.current.id && current.kind === identity.current.kind) change(current); }, options);
  };
  return createPortal(<dialog ref={dialog} className="dialog ui-collection-content-dialog" aria-labelledby={titleId} aria-describedby={scopeId}
    onCancel={event => {
      // The nested asset browser owns its own Escape action.
      if (event.target !== event.currentTarget) return;
      event.preventDefault(); event.stopPropagation(); onClose();
    }}
    onKeyDownCapture={event => {
      const target = event.target as HTMLElement;
      if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && target.getAttribute('role') === 'combobox' && target.getAttribute('aria-expanded') === 'true') event.preventDefault();
    }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      const modifier = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
      if (['F5', 'F6'].includes(event.key) || modifier && key === 's') event.preventDefault();
    }}
    onClick={event => event.stopPropagation()}>
    <header className="ui-collection-content-header"><div><h2 id={titleId}>{contentTitles[component.kind] ?? '管理列表内容'}</h2><p id={scopeId}>{componentName(component)} · 当前控件的内容</p></div><IconButton title="关闭内容管理" onClick={onClose}><X size={18} /></IconButton></header>
    <div className="ui-collection-content-body">
      {valid && (component.kind === 'galleryGrid' ? <UiGalleryContentFields project={project} component={component} edit={update} assetUrl={assetUrl} /> : <AudioCollectionContent project={project} component={component} edit={update} assetUrl={assetUrl} />)}
    </div>
    <footer className="ui-collection-content-footer"><p>修改会即时应用到当前设计；关闭后可撤销，保存工程后保留。</p><button type="button" className="primary" onClick={onClose}>完成</button></footer>
  </dialog>, document.body);
}

function AudioCollectionContent({ project, component, edit, assetUrl }: CollectionContentProps) {
  const [query, setQuery] = useState(''), [notice, setNotice] = useState('');
  const music = component.kind === 'musicTrackList';
  const assets = useMemo(() => new Map(project.assets.filter(asset => asset.kind === 'audio').map(asset => [asset.id, asset])), [project.assets]);
  const selected = component.list?.assetIds, manual = selected !== undefined;
  const automatic = useMemo(() => manual ? [] : music ? musicRoomEntries(project).map(asset => asset.id) : [...assets.keys()], [manual, music, project, assets]);
  const ids = selected ?? automatic;
  const search = query.trim().toLocaleLowerCase();
  const occurrences = new Map<string, number>();
  const entries = ids.map((id, index) => {
    const occurrence = occurrences.get(id) ?? 0;
    occurrences.set(id, occurrence + 1);
    return { id, index, occurrence, asset: assets.get(id) };
  });
  const filtered = entries.filter(({ id, asset }) => `${asset?.name ?? '素材已移除'} ${asset?.path ?? ''} ${id}`.toLocaleLowerCase().includes(search));
  const missing = entries.filter(entry => !entry.asset).length;
  const name = music ? '曲目' : '语音素材';
  const change: CollectionContentProps['edit'] = (update, options) => edit(current => {
    if (current.id === component.id && current.kind === component.kind && ['musicTrackList', 'voiceCollection'].includes(current.kind)) update(current);
  }, options);
  const source = (useManual: boolean, empty = false) => {
    setQuery(''); setNotice('');
    change(current => {
      if (useManual && !empty && automatic.length > maxCollectionAssets) return;
      current.list ??= {};
      if (!useManual) delete current.list.assetIds;
      else if (empty || current.list.assetIds === undefined) current.list.assetIds = empty ? [] : [...automatic];
    }, { separate: true });
  };
  const add = (id?: string) => {
    if (!id) return;
    if (ids.includes(id)) { setNotice(`这项${name}已在清单中。`); return; }
    setNotice(''); setQuery('');
    change(current => {
      const values = current.list?.assetIds;
      if (values && values.length < maxCollectionAssets && !values.includes(id)) values.push(id);
    }, { separate: true });
  };
  const move = (id: string, occurrence: number, offset: number) => change(current => {
    const values = current.list?.assetIds, from = occurrenceIndex(values, id, occurrence);
    if (!values || from < 0 || from + offset < 0 || from + offset >= values.length) return;
    [values[from], values[from + offset]] = [values[from + offset], values[from]];
  }, { separate: true });
  const remove = (id: string, occurrence: number) => change(current => {
    const values = current.list?.assetIds, at = occurrenceIndex(values, id, occurrence);
    if (values && at >= 0) values.splice(at, 1);
  }, { separate: true });
  return <section className="ui-collection-audio-content" aria-label={music ? '音乐列表曲目' : '语音列表素材范围'}>
    <Field label={music ? '曲目来源' : '素材范围'}><select aria-label={music ? '音乐列表曲目来源' : '语音列表素材范围'} value={manual ? 'selected' : 'automatic'} onChange={event => source(event.target.value === 'selected')}>
      <option value="automatic">{music ? '自动收集剧情配乐' : '不限制来源素材'}</option>
      <option value="selected" disabled={!manual && automatic.length > maxCollectionAssets}>{music ? '手动选择曲目与顺序' : '仅允许指定素材'}</option>
    </select></Field>
    <p className="muted ui-collection-help">{music
      ? manual ? '下方清单就是显示顺序，可添加、移动和移除曲目。' : '自动收集剧情配乐及其他音乐列表中的曲目；新增配乐后自动更新。'
      : '这里只限定语音使用哪些音频素材；游戏条目由剧情和收藏记录生成，显示顺序仍使用列表中的排序设置。'}</p>
    {!manual && automatic.length > maxCollectionAssets && <div className="ui-collection-notice"><p>当前范围超过 {maxCollectionAssets} 项；指定清单最多可保留 {maxCollectionAssets} 项。</p><button type="button" onClick={() => source(true, true)}>从空清单开始选择</button></div>}
    <div className="ui-collection-toolbar"><label className="ui-collection-search"><Search size={16} aria-hidden="true" /><input aria-label={`搜索${name}清单`} placeholder={`搜索${name}名称`} value={query} onChange={event => setQuery(event.target.value)} /></label><span role="status">{search ? `${filtered.length} / ${ids.length}` : ids.length} {music ? '首' : '项'}</span>{manual && ids.length > 0 && <button type="button" title="只清空此控件的清单，素材仍保留在项目中。" onClick={() => source(true, true)}>清空清单</button>}</div>
    {!!missing && <p className="ui-collection-missing">有 {missing} 项素材已移除或类型不符，游戏会跳过它们；可以从清单中移除。</p>}
    {search && manual && music && <p className="muted ui-collection-help">移动仍按完整清单的顺序进行，搜索只筛选显示的行。</p>}
    <ol className="ui-collection-asset-list" aria-label={manual ? `指定${name}清单` : `当前${name}范围`}>
      {filtered.map(({ id, index, occurrence, asset }) => <li key={`${id}-${occurrence}`} className={!asset ? 'is-missing' : undefined} data-collection-asset={id}>
        {music && <span className="ui-collection-row-number" aria-hidden="true">{index + 1}</span>}
        <Music2 size={17} aria-hidden="true" />
        <span className="ui-collection-asset-name"><strong title={asset?.name ?? id}>{asset?.name ?? '素材已移除'}</strong><small title={asset?.path ?? id}>{asset?.path ?? id}</small></span>
        {manual && <div className="button-row">{music && <><button type="button" aria-label={`上移曲目：${asset?.name ?? id}`} disabled={index === 0} onClick={() => move(id, occurrence, -1)}>上移</button><button type="button" aria-label={`下移曲目：${asset?.name ?? id}`} disabled={index === ids.length - 1} onClick={() => move(id, occurrence, 1)}>下移</button></>}
          <button type="button" aria-label={`移除${name}：${asset?.name ?? id}`} onClick={() => remove(id, occurrence)}>移除</button></div>}
      </li>)}
    </ol>
    {!filtered.length && <p className="ui-collection-empty" role="status">{ids.length ? '没有符合搜索条件的素材。' : manual ? music ? '曲目清单为空，游戏中不会显示曲目。在下方添加。' : '指定清单为空，游戏中不会显示语音。在下方添加允许使用的素材。' : music ? '还没有收集到配乐。在剧情中添加配乐，或改为手动选择。' : '项目中还没有音频素材。'}</p>}
    {manual && (ids.length < maxCollectionAssets ? <div className="ui-collection-add"><Field label={`添加${name}`}><UiAssetSelect project={project} kind="audio" category="all" assetUrl={assetUrl} label={`添加${name}`} empty="搜索或浏览音频素材" allowEmpty={false} onChange={add} /></Field></div> : <p className="muted ui-collection-help">已达到 {maxCollectionAssets} 项上限，移除一项后可继续添加。</p>)}
    {notice && <p className="ui-collection-notice" role="status">{notice}</p>}
  </section>;
}

// Imported projects may repeat an asset. Resolve the rendered occurrence in the
// latest draft so a filtered row never moves or removes a different entry.
function occurrenceIndex(ids: string[] | undefined, id: string, occurrence: number) {
  let seen = 0;
  return ids?.findIndex(value => value === id && seen++ === occurrence) ?? -1;
}
