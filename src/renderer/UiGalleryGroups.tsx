import { useMemo, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { makeId, type GalleryGroup, type Project, type UiComponent } from '../core/model';
import { galleryEntries } from '../core/gallery';
import { Field } from './components';
import { UiAssetSelect } from './AssetPicker';
import type { AssetUrl } from './StageEditor';
import { GalleryUnlockFields } from './GalleryUnlockFields';
import './ui-collection-content-dialog.css';

type EditOptions = { separate?: boolean };
type GalleryEditorProps = { project: Project; component: UiComponent; edit: (change: (component: UiComponent) => void, options?: EditOptions) => void; assetUrl: AssetUrl };
const maxGalleryEntries = 2048;

/** Content only: grid geometry and detail-page appearance remain in the inspector. */
export function UiGalleryContentFields({ project, component, edit, assetUrl }: GalleryEditorProps) {
  const [selection, setSelection] = useState(''), [query, setQuery] = useState('');
  const [imageSelection, setImageSelection] = useState(''), [variantSelection, setVariantSelection] = useState('');
  const [notice, setNotice] = useState('');
  const assets = useMemo(() => new Map(project.assets.filter(asset => asset.kind === 'image').map(asset => [asset.id, asset])), [project.assets]);
  const allImageIds = useMemo(() => [...assets.keys()], [assets]);
  const groups = component.list?.galleryGroups;
  const search = query.trim().toLocaleLowerCase();
  const filtered = groups?.filter(group => `${group.name} ${group.id}`.toLocaleLowerCase().includes(search)) ?? [];
  const group = filtered.find(item => item.id === selection) ?? filtered[0];
  const index = groups?.findIndex(item => item.id === group?.id) ?? -1;
  const imageIds = component.list?.assetIds ?? allImageIds;
  const filteredImages = imageIds.filter(id => `${assets.get(id)?.name ?? '素材已移除'} ${id}`.toLocaleLowerCase().includes(search));
  const selectedImageId = filteredImages.find(id => id === imageSelection) ?? filteredImages[0];
  const selectedImage = assets.get(selectedImageId ?? '');
  const missingImages = imageIds.filter(id => !assets.has(id)).length;
  const change: GalleryEditorProps['edit'] = (update, options) => edit(current => { if (current.id === component.id && current.kind === 'galleryGrid') update(current); }, options);
  const changeGroup = (id: string, update: (current: GalleryGroup) => void, options?: EditOptions) => change(current => {
    const target = current.list?.galleryGroups?.find(item => item.id === id);
    if (target) update(target);
  }, options);
  const moveGroup = (id: string, offset: number) => {
    setSelection(id);
    change(current => {
      const items = current.list?.galleryGroups, from = items?.findIndex(item => item.id === id) ?? -1;
      if (!items || from < 0 || from + offset < 0 || from + offset >= items.length) return;
      const [item] = items.splice(from, 1); items.splice(from + offset, 0, item);
    }, { separate: true });
  };
  const moveVariant = (groupId: string, id: string, offset: number) => changeGroup(groupId, current => {
    const from = current.assetIds.indexOf(id), to = from + offset;
    if (from < 0 || to < 0 || to >= current.assetIds.length) return;
    [current.assetIds[from], current.assetIds[to]] = [current.assetIds[to], current.assetIds[from]];
  }, { separate: true });
  const manualImages = component.list?.assetIds !== undefined;
  const setImageSource = (manual: boolean) => {
    setQuery(''); setNotice('');
    change(current => {
      if (current.list?.galleryGroups !== undefined) return;
      current.list ??= {};
      if (!manual) delete current.list.assetIds;
      else if (current.list.assetIds === undefined && allImageIds.length <= maxGalleryEntries) current.list.assetIds = [...allImageIds];
    }, { separate: true });
  };
  const addImage = (id?: string) => {
    if (!id) return;
    if (imageIds.includes(id)) { setNotice('这张图片已在清单中。'); return; }
    setNotice(''); setQuery(''); setImageSelection(id);
    change(current => {
      const ids = current.list?.assetIds;
      if (current.list?.galleryGroups === undefined && ids && ids.length < maxGalleryEntries && !ids.includes(id)) ids.push(id);
    }, { separate: true });
  };
  const moveImage = (id: string, offset: number) => change(current => {
    if (current.list?.galleryGroups !== undefined) return;
    const ids = current.list?.assetIds, from = ids?.indexOf(id) ?? -1;
    if (!ids || from < 0 || from + offset < 0 || from + offset >= ids.length) return;
    [ids[from], ids[from + offset]] = [ids[from + offset], ids[from]];
  }, { separate: true });
  return <div className="ui-gallery-content-fields">
    <Field label="启用图鉴分组"><input type="checkbox" aria-label="启用图鉴分组" checked={groups !== undefined} disabled={groups === undefined && imageIds.length > maxGalleryEntries} onChange={event => {
      const enabled = event.target.checked;
      setQuery(''); setSelection(''); setVariantSelection(''); setNotice('');
      change(current => {
        current.list ??= {};
        if (!enabled) delete current.list.galleryGroups;
        else if (current.list.galleryGroups === undefined) {
          const entries = galleryEntries(project, current);
          if (entries.length <= maxGalleryEntries) {
            const usedIds = new Set<string>();
            current.list.galleryGroups = entries.map(entry => {
              const id = usedIds.has(entry.id) ? makeId('gallery') : entry.id;
              usedIds.add(id); return { ...entry, id };
            });
          }
        }
      }, { separate: true });
    }} /></Field>
    <p className="muted ui-collection-help">{groups !== undefined ? '每组在图鉴中显示一张缩略图，打开后按分镜顺序翻阅。关闭分组会移除分组设置，恢复单张图片清单。' : '每张图片单独显示；启用分组后，可以把同一段剧情的多张 CG 放在一起。'}</p>
    {groups === undefined && imageIds.length > maxGalleryEntries && <p className="ui-collection-notice">当前图片超过 {maxGalleryEntries} 张，请先用指定图片清单缩小范围，再启用分组。</p>}
    {groups !== undefined ? <div className="ui-gallery-content-layout">
      <aside className="ui-gallery-content-navigation" aria-label="选择图鉴分组">
        <div className="ui-collection-section-heading"><strong>分组 · {groups.length}</strong><button type="button" disabled={groups.length >= maxGalleryEntries} onClick={() => {
          const id = makeId('gallery'); setQuery(''); setSelection(id); setVariantSelection('');
          change(current => { const items = current.list?.galleryGroups; if (items && items.length < maxGalleryEntries) items.push({ id, name: '新分组', assetIds: [] }); }, { separate: true });
        }}>新增分组</button></div>
        <input aria-label="搜索图鉴分组" placeholder="搜索分组名称" value={query} onChange={event => setQuery(event.target.value)} />
        <div className="ui-gallery-group-list" role="group" aria-label="图鉴分组">
          {!filtered.length && <p className="ui-collection-empty">{groups.length ? '没有匹配的分组' : '暂无分组，点击“新增分组”开始。'}</p>}
          {filtered.map(item => <button type="button" key={item.id} aria-pressed={group?.id === item.id} onClick={() => { setSelection(item.id); setVariantSelection(''); setNotice(''); }}><span>{item.name || '未命名分组'}</span><small>{item.assetIds.length} 张</small></button>)}
        </div>
        {groups.length >= maxGalleryEntries && <p className="muted">最多可添加 {maxGalleryEntries} 组。</p>}
      </aside>
      <section className="ui-gallery-content-detail" aria-label="编辑图鉴分组">
        {group ? <div key={group.id}>
          <div className="ui-collection-section-heading"><strong>第 {index + 1} 组</strong><div className="button-row">
            <button type="button" disabled={index <= 0} onClick={() => moveGroup(group.id, -1)}>上移分组</button>
            <button type="button" disabled={index < 0 || index >= groups.length - 1} onClick={() => moveGroup(group.id, 1)}>下移分组</button>
            <button type="button" onClick={() => { setSelection(groups[index + 1]?.id ?? groups[index - 1]?.id ?? ''); change(current => { if (current.list?.galleryGroups) current.list.galleryGroups = current.list.galleryGroups.filter(item => item.id !== group.id); }, { separate: true }); }}>删除分组</button>
          </div></div>
          {search && <p className="muted">移动按全部分组的顺序进行，搜索只筛选当前清单。</p>}
          <div className="ui-gallery-group-identity">
            <Field label="分组名称"><input aria-label="分组名称" value={group.name} maxLength={120} onChange={event => { const name = event.target.value; setSelection(group.id); setQuery(''); changeGroup(group.id, current => { current.name = name; }); }} /></Field>
            <Field label="分组缩略图"><UiAssetSelect project={project} kind="image" category="all" assetUrl={assetUrl} label="分组缩略图" value={group.thumbnailAssetId} empty="使用第一张分镜" onChange={value => changeGroup(group.id, current => { current.thumbnailAssetId = value; }, { separate: true })} /></Field>
          </div>
          <GalleryUnlockFields project={project} condition={group.unlockWhen} label="分组解锁条件" inherited={group.assetIds.some(id => !!component.list?.galleryUnlockWhen?.[id])} inheritedLabel="沿用各图片条件或剧情显示记录" onChange={(value, options) => changeGroup(group.id, current => { current.unlockWhen = value; }, options)} />
          <div className="ui-collection-section-heading"><strong>分镜 · {group.assetIds.length}</strong><span className="muted">按清单顺序翻阅</span></div>
          <div className="ui-gallery-variants">
            {!group.assetIds.length && <p className="ui-collection-empty">这组还没有图片，在下方添加分镜。</p>}
            {group.assetIds.map((id, variantIndex) => {
              const asset = assets.get(id), inherited = group.unlockWhen ?? component.list?.galleryUnlockWhen?.[id];
              return <div key={id} className="ui-gallery-variant" data-gallery-variant={id}>
                <div className="gallery-variant-heading"><GalleryThumbnail id={asset?.id} assetUrl={assetUrl} /><span>{variantIndex + 1}. {asset?.name ?? '素材已移除'}{!asset && <small className="ui-collection-missing">{id}</small>}</span>
                  <div className="button-row"><button type="button" aria-label={`上移分镜 ${variantIndex + 1}`} disabled={variantIndex === 0} onClick={() => moveVariant(group.id, id, -1)}>上移</button>
                    <button type="button" aria-label={`下移分镜 ${variantIndex + 1}`} disabled={variantIndex === group.assetIds.length - 1} onClick={() => moveVariant(group.id, id, 1)}>下移</button>
                    <button type="button" aria-label={`移除分镜 ${variantIndex + 1}`} onClick={() => changeGroup(group.id, current => { current.assetIds = current.assetIds.filter(value => value !== id); if (current.variantUnlockWhen) delete current.variantUnlockWhen[id]; }, { separate: true })}>移除</button></div>
                </div>
                <button type="button" className="ui-gallery-unlock-toggle" aria-expanded={variantSelection === id} onClick={() => setVariantSelection(variantSelection === id ? '' : id)}>分镜解锁条件 · {group.variantUnlockWhen?.[id] ? '单独设置' : group.unlockWhen ? '沿用分组' : inherited ? '沿用图片' : '剧情显示后解锁'}</button>
                {variantSelection === id && <GalleryUnlockFields project={project} label={`分镜 ${variantIndex + 1} 解锁条件`} condition={group.variantUnlockWhen?.[id]} inherited={!!inherited} inheritedLabel={group.unlockWhen ? undefined : '沿用图片条件'} onChange={(value, options) => changeGroup(group.id, current => {
                  if (!current.assetIds.includes(id)) return;
                  if (value) (current.variantUnlockWhen ??= {})[id] = value;
                  else if (current.variantUnlockWhen) delete current.variantUnlockWhen[id];
                }, options)} />}
              </div>;
            })}
          </div>
          {group.assetIds.length < maxGalleryEntries ? <Field label="添加分镜"><UiAssetSelect project={project} kind="image" category="all" assetUrl={assetUrl} label="添加分镜" empty="搜索或浏览图片" allowEmpty={false} onChange={value => {
            if (!value) return;
            if (group.assetIds.includes(value)) { setNotice('这张图片已在当前分组中。'); return; }
            setNotice(''); changeGroup(group.id, current => { if (current.assetIds.length < maxGalleryEntries && !current.assetIds.includes(value)) current.assetIds.push(value); }, { separate: true });
          }} /></Field> : <p className="muted">每组最多可添加 {maxGalleryEntries} 张分镜。</p>}
        </div> : <p className="ui-collection-empty">选择左侧分组后，在这里编辑名称、图片和解锁条件。</p>}
      </section>
    </div> : <>
      <Field label="图片来源"><select aria-label="图鉴图片来源" value={manualImages ? 'selected' : 'all'} onChange={event => setImageSource(event.target.value === 'selected')}><option value="all">项目中的全部图片</option><option value="selected" disabled={!manualImages && allImageIds.length > maxGalleryEntries}>仅显示指定图片</option></select></Field>
      {!manualImages && allImageIds.length > maxGalleryEntries && <button type="button" onClick={() => change(current => { if (current.list?.galleryGroups === undefined) { current.list ??= {}; current.list.assetIds = []; } }, { separate: true })}>创建空的指定图片清单</button>}
      <div className="ui-collection-section-heading"><p className="muted ui-collection-help">{manualImages ? `已指定 ${imageIds.length} 张图片，按清单顺序显示。` : `当前包含 ${imageIds.length} 张图片，新增图片后自动加入。`}{missingImages > 0 ? `其中 ${missingImages} 张素材已移除。` : ''}</p>{manualImages && imageIds.length > 0 && <button type="button" title="只清空此控件的图片清单，素材仍保留在项目中。" onClick={() => change(current => { if (current.list?.galleryGroups === undefined && current.list?.assetIds) current.list.assetIds = []; }, { separate: true })}>清空图片清单</button>}</div>
      <div className="ui-gallery-content-layout">
        <aside className="ui-gallery-content-navigation" aria-label="选择图鉴图片">
          <input aria-label="搜索图鉴图片" placeholder="搜索图片名称" value={query} onChange={event => setQuery(event.target.value)} />
          <div className="ui-gallery-group-list" role="group" aria-label="图鉴图片">
            {!filteredImages.length && <p className="ui-collection-empty">{imageIds.length ? '没有匹配的图片' : manualImages ? '清单为空，图鉴中不会显示图片。' : '项目中还没有图片。'}</p>}
            {filteredImages.map((id, imageIndex) => <button type="button" key={`${id}-${imageIndex}`} aria-pressed={selectedImageId === id} onClick={() => { setImageSelection(id); setNotice(''); }}><span>{assets.get(id)?.name ?? '素材已移除'}</span>{!assets.has(id) && <small className="ui-collection-missing">丢失</small>}</button>)}
          </div>
          {manualImages && imageIds.length < maxGalleryEntries && <Field label="添加图片"><UiAssetSelect project={project} kind="image" category="all" assetUrl={assetUrl} label="添加图鉴图片" empty="搜索或浏览图片" allowEmpty={false} onChange={addImage} /></Field>}
          {manualImages && imageIds.length >= maxGalleryEntries && <p className="muted">最多可指定 {maxGalleryEntries} 张图片。</p>}
        </aside>
        <section className="ui-gallery-content-detail" aria-label="图片解锁条件">
          {selectedImageId ? <div key={selectedImageId}>
            <div className="ui-gallery-selected-image"><GalleryThumbnail id={selectedImage?.id} assetUrl={assetUrl} /><strong>{selectedImage?.name ?? '素材已移除'}</strong></div>
            {!selectedImage && <p className="ui-collection-missing">图片 {selectedImageId} 已不在项目中，游戏会跳过它。</p>}
            {manualImages && <div className="button-row ui-gallery-image-actions">
              <button type="button" disabled={imageIds.indexOf(selectedImageId) <= 0} onClick={() => moveImage(selectedImageId, -1)}>上移图片</button>
              <button type="button" disabled={imageIds.indexOf(selectedImageId) >= imageIds.length - 1} onClick={() => moveImage(selectedImageId, 1)}>下移图片</button>
              <button type="button" onClick={() => change(current => { if (current.list?.galleryGroups === undefined && current.list?.assetIds) current.list.assetIds = current.list.assetIds.filter(id => id !== selectedImageId); }, { separate: true })}>移除图片</button>
            </div>}
            {search && manualImages && <p className="muted">移动按全部图片的顺序进行，搜索只筛选当前清单。</p>}
            <GalleryUnlockFields project={project} condition={component.list?.galleryUnlockWhen?.[selectedImageId]} onChange={(value, options) => change(current => {
              if (current.list?.galleryGroups !== undefined || !(current.list?.assetIds ?? allImageIds).includes(selectedImageId)) return;
              current.list ??= {};
              if (value) (current.list.galleryUnlockWhen ??= {})[selectedImageId] = value;
              else if (current.list.galleryUnlockWhen) delete current.list.galleryUnlockWhen[selectedImageId];
            }, options)} />
          </div> : <p className="ui-collection-empty">选择左侧图片后，在这里设置解锁条件。</p>}
        </section>
      </div>
    </>}
    {notice && <p className="ui-collection-notice" role="status">{notice}</p>}
  </div>;
}

function GalleryThumbnail({ id, assetUrl }: { id?: string; assetUrl: AssetUrl }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const url = id ? assetUrl(id) : undefined;
  return <span className="ui-gallery-content-thumbnail">{url && url !== failedUrl ? <img src={url} alt="" loading="lazy" onError={() => setFailedUrl(url)} /> : <ImageIcon size={22} aria-hidden="true" />}</span>;
}
