import { useState } from 'react';
import { makeId, type GalleryGroup, type Project, type UiComponent } from '../core/model';
import { galleryEntries } from '../core/gallery';
import { Field } from './components';
import { UiAssetSelect } from './AssetPicker';
import { NumberInput } from './NumberInput';
import type { AssetUrl } from './StageEditor';
import { GalleryUnlockFields } from './GalleryUnlockFields';

export function UiGalleryGroups({ project, component, edit, assetUrl }: { project: Project; component: UiComponent; edit: (change: (component: UiComponent) => void) => void; assetUrl: AssetUrl }) {
  const [selection, setSelection] = useState(''), [query, setQuery] = useState('');
  const [imageSelection, setImageSelection] = useState('');
  const groups = component.list?.galleryGroups;
  const filtered = groups?.filter(group => group.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? [];
  const group = filtered.find(item => item.id === selection) ?? filtered[0];
  const index = groups?.findIndex(item => item.id === group?.id) ?? -1;
  const images = galleryEntries(project, component);
  const selectedImage = images.find(item => item.id === imageSelection) ?? images[0];
  const changeGroup = (change: (group: GalleryGroup) => void) => edit(c => { const target = c.list?.galleryGroups?.find(item => item.id === group?.id); if (target) change(target); });
  const move = (offset: number) => { if (group) setSelection(group.id); edit(c => {
    const items = c.list?.galleryGroups;
    if (items && index + offset >= 0 && index + offset < items.length) { const [item] = items.splice(index, 1); items.splice(index + offset, 0, item); }
  }); };
  return <details className="ui-property-group" open><summary>图鉴分组与分镜</summary>
    <Field label="启用图鉴分组"><input type="checkbox" aria-label="启用图鉴分组" checked={groups !== undefined} onChange={event => edit(c => { c.list = { ...c.list, galleryGroups: event.target.checked ? galleryEntries(project, c) : undefined }; })} /></Field>
    <p className="muted">把同一段剧情的多张 CG 合并为一组，打开后按顺序翻阅。解锁条件可按剧情显示记录或参数判断。</p>
    {groups && <>
      <input aria-label="搜索图鉴分组" placeholder="搜索分组名称" value={query} onChange={event => setQuery(event.target.value)} />
      <div className="ui-gallery-group-list" role="group" aria-label="图鉴分组">{!filtered.length && <p className="muted">无匹配分组</p>}{filtered.map(item => <button type="button" key={item.id} aria-pressed={group?.id === item.id} onClick={() => setSelection(item.id)}><span>{item.name || '未命名分组'}</span><small>{item.assetIds.length} 张</small></button>)}</div>
      <div className="button-row">
        <button type="button" onClick={() => { const id = makeId('gallery'); setQuery(''); setSelection(id); edit(c => { c.list = { ...c.list, galleryGroups: [...(c.list?.galleryGroups ?? []), { id, name: '新分组', assetIds: [] }] }; }); }}>新增分组</button>
        <button type="button" disabled={!group} onClick={() => edit(c => { c.list!.galleryGroups = c.list!.galleryGroups!.filter(item => item.id !== group!.id); })}>删除分组</button>
        <button type="button" disabled={index <= 0} onClick={() => move(-1)}>上移分组</button>
        <button type="button" disabled={index < 0 || index >= groups.length - 1} onClick={() => move(1)}>下移分组</button>
      </div>
      {group && <div key={group.id}>
        <Field label="分组名称"><input aria-label="分组名称" value={group.name} maxLength={120} onChange={event => { setSelection(group.id); setQuery(''); changeGroup(item => { item.name = event.target.value; }); }} /></Field>
        <Field label="分组缩略图"><UiAssetSelect project={project} kind="image" category="all" assetUrl={assetUrl} label="分组缩略图" value={group.thumbnailAssetId} empty="使用第一张分镜" onChange={value => changeGroup(item => { item.thumbnailAssetId = value; })} /></Field>
        <GalleryUnlockFields project={project} condition={group.unlockWhen} label="分组解锁条件" onChange={value => changeGroup(item => { item.unlockWhen = value; })} />
        <div className="ui-gallery-variants">{group.assetIds.map((id, variantIndex) => <div key={id} className="ui-gallery-variant" data-gallery-variant={id}>
          <div className="gallery-variant-heading"><img src={assetUrl(id)} alt="" loading="lazy" /><span>{variantIndex + 1}. {project.assets.find(asset => asset.id === id)?.name ?? id}</span></div>
          <div className="button-row"><button type="button" aria-label={`上移分镜 ${variantIndex + 1}`} disabled={variantIndex === 0} onClick={() => changeGroup(item => { [item.assetIds[variantIndex - 1], item.assetIds[variantIndex]] = [item.assetIds[variantIndex], item.assetIds[variantIndex - 1]]; })}>上移</button>
            <button type="button" aria-label={`下移分镜 ${variantIndex + 1}`} disabled={variantIndex === group.assetIds.length - 1} onClick={() => changeGroup(item => { [item.assetIds[variantIndex + 1], item.assetIds[variantIndex]] = [item.assetIds[variantIndex], item.assetIds[variantIndex + 1]]; })}>下移</button>
            <button type="button" aria-label={`移除分镜 ${variantIndex + 1}`} onClick={() => changeGroup(item => { item.assetIds.splice(variantIndex, 1); if (item.variantUnlockWhen) delete item.variantUnlockWhen[id]; })}>移除</button></div>
          <details><summary>分镜解锁条件</summary><GalleryUnlockFields project={project} label={`分镜 ${variantIndex + 1} 解锁条件`} condition={group.variantUnlockWhen?.[id]} inherited={!!group.unlockWhen} onChange={value => changeGroup(item => { if (value) (item.variantUnlockWhen ??= {})[id] = value; else if (item.variantUnlockWhen) delete item.variantUnlockWhen[id]; })} /></details>
        </div>)}</div>
        <Field label="添加分镜"><UiAssetSelect project={project} kind="image" category="all" assetUrl={assetUrl} label="添加分镜" empty="选择图片" allowedIds={project.assets.filter(asset => asset.kind === 'image' && !group.assetIds.includes(asset.id)).map(asset => asset.id)} onChange={value => { if (value) changeGroup(item => { if (!item.assetIds.includes(value)) item.assetIds.push(value); }); }} /></Field>
      </div>}
    </>}
    {!groups && <>
      <Field label="图鉴图片"><select aria-label="设置解锁条件的图鉴图片" value={selectedImage?.id ?? ''} onChange={event => setImageSelection(event.target.value)}>{!images.length && <option value="">暂无图片</option>}{images.map(image => <option key={image.id} value={image.id}>{image.name}</option>)}</select></Field>
      {selectedImage && <GalleryUnlockFields project={project} condition={component.list?.galleryUnlockWhen?.[selectedImage.id]} onChange={value => edit(current => { current.list ??= {}; if (value) (current.list.galleryUnlockWhen ??= {})[selectedImage.id] = value; else if (current.list.galleryUnlockWhen) delete current.list.galleryUnlockWhen[selectedImage.id]; })} />}
    </>}
    <Field label="详情图片缩放"><select aria-label="详情图片缩放" value={component.list?.galleryFit ?? 'contain'} onChange={event => edit(c => { c.list = { ...c.list, galleryFit: event.target.value as 'contain' | 'cover' | 'stretch' }; })}><option value="contain">完整显示</option><option value="cover">裁切铺满</option><option value="stretch">拉伸铺满</option></select></Field>
    <Field label="最后一张再点击"><select aria-label="最后一张再点击" value={component.list?.galleryEndAction ?? 'close'} onChange={event => edit(c => { c.list = { ...c.list, galleryEndAction: event.target.value as 'close' | 'loop' }; })}><option value="close">返回图鉴</option><option value="loop">从第一张循环</option></select></Field>
    <Field label="详情显示翻页和关闭按钮"><input type="checkbox" aria-label="详情显示翻页和关闭按钮" checked={component.list?.galleryShowControls ?? true} onChange={event => edit(c => { c.list = { ...c.list, galleryShowControls: event.target.checked }; })} /></Field>
    <Field label="最多同时显示页码"><NumberInput aria-label="最多同时显示页码" min={1} max={99} value={component.list?.galleryPageButtonLimit ?? 9} onChange={event => edit(c => { c.list = { ...c.list, galleryPageButtonLimit: Math.max(1, Math.min(99, Number(event.target.value) || 1)) }; })} /></Field>
    <details className="ui-property-group"><summary>页码大小与文字</summary>
      {(['pageButtonWidth', 'pageButtonHeight', 'pageGap', 'pageFontSize'] as const).map(key => <Field key={key} label={{ pageButtonWidth: '页码按钮宽度', pageButtonHeight: '页码按钮高度', pageGap: '页码按钮间距', pageFontSize: '页码字号' }[key]}><NumberInput min={key === 'pageGap' ? 0 : key === 'pageFontSize' ? 12 : 16} max={key === 'pageGap' ? 128 : key === 'pageFontSize' ? 96 : 256} value={component.list?.[key] ?? ''} placeholder="自动" onChange={event => edit(c => { c.list = { ...c.list, [key]: event.target.value === '' ? undefined : Number(event.target.value) }; })} /></Field>)}
      <Field label="页码字体"><UiAssetSelect project={project} kind="font" assetUrl={assetUrl} label="页码字体" value={component.list?.pageFontAssetId} empty="沿用组件字体" onChange={value => edit(c => { c.list = { ...c.list, pageFontAssetId: value }; })} /></Field>
      <Field label="页码粗体"><input type="checkbox" checked={component.list?.pageBold ?? false} onChange={event => edit(c => { c.list = { ...c.list, pageBold: event.target.checked }; })} /></Field>
      <Field label="页码文字颜色"><input type="color" value={component.list?.pageTextColor ?? component.style?.textColor ?? project.ui.textColor} onChange={event => edit(c => { c.list = { ...c.list, pageTextColor: event.target.value }; })} /></Field>
    </details>
  </details>;
}
