import { uiTextOutlines } from '../core/ui-text-effects';
import { defaultVoiceRemoveMessage } from '../core/voice-preview';
import { musicRoomEntries } from '../core/music-preview';
import { NumberInput } from './NumberInput';
import { useState } from 'react';
import type { Project, UiButtonState, UiComponent, UiSkin } from '../core/model';
import { skinKinds, uiFitNames, uiSkinAsset, uiStateNames } from '../core/ui';
import { ConditionEditor, Field } from './components';
import type { AssetUrl } from './StageEditor';
import { UiAssetSelect } from './AssetPicker';
import { UiGalleryGroups } from './UiGalleryGroups';
export { UiAssetSelect } from './AssetPicker';

export function uiFontFamily(assetId?: string): string | undefined {
  return assetId ? `"vns_${assetId}", "Microsoft YaHei", sans-serif` : '"vns_runtime_default", "Microsoft YaHei", sans-serif';
}

export { uiTextShadow } from '../core/ui-text-effects';

export function UiFontFaces({ project, assetUrl }: { project: Project; assetUrl: AssetUrl }) {
  const defaultSource = window.studio?.defaultFontUrl?.();
  return <style>{defaultSource ? `@font-face { font-family: vns_runtime_default; src: url(${JSON.stringify(defaultSource)}); }` : ''}{project.assets.filter(asset => asset.kind === 'font').map(asset => `@font-face { font-family: "vns_${asset.id}"; src: url(${JSON.stringify(assetUrl(asset.id))}); font-display: swap; }`).join('\n')}</style>;
}

export function UiSkinImage({ skin, state, assetUrl, scale, className = '' }: { skin?: UiSkin; state: UiButtonState; assetUrl: AssetUrl; scale: number; className?: string }) {
  const assetId = uiSkinAsset(skin, state);
  if (!assetId) return null;
  const opacity = state === 'disabled' && !skin?.disabled ? 0.45 : 1;
  const filter = skin?.brightness?.[state] === undefined ? undefined : `brightness(${skin.brightness[state]})`;
  if (skin?.fit === 'nineSlice') {
    const b = skin.borders ?? { left: 12, top: 12, right: 12, bottom: 12 };
    return <div aria-hidden="true" className={`ui-skin-image ${className}`} style={{ opacity, filter, borderStyle: 'solid', borderColor: 'transparent', borderWidth: `${b.top * scale}px ${b.right * scale}px ${b.bottom * scale}px ${b.left * scale}px`, borderImageSource: `url(${JSON.stringify(assetUrl(assetId))})`, borderImageSlice: `${b.top} ${b.right} ${b.bottom} ${b.left} fill`, borderImageRepeat: 'stretch' }} />;
  }
  return <img aria-hidden="true" className={`ui-skin-image ${className}`} src={assetUrl(assetId)} alt="" draggable={false} style={{ opacity, filter, objectFit: skin?.fit === 'stretch' || !skin?.fit ? 'fill' : skin.fit }} />;
}

export function uiStateColor(component: UiComponent, state: UiButtonState): string {
  const s = component.style;
  return (state === 'disabled' ? s?.disabledBackground ?? '#22282a' : state === 'pressed' ? s?.pressedBackground ?? s?.hoverBackground ?? '#3b8f80' : state === 'selected' ? s?.selectedBackground ?? s?.hoverBackground ?? '#3b8f80' : state === 'hover' ? s?.hoverBackground ?? s?.background ?? '#3b8f80' : s?.background ?? '#283133');
}

export function UiAppearanceFields({ project, component, edit, assetUrl, section = 'all', omitIdle = false }: { section?: 'all' | 'appearance' | 'content' | 'interaction'; omitIdle?: boolean; project: Project; component: UiComponent; edit: (change: (component: UiComponent) => void) => void; assetUrl: AssetUrl }) {
  const appearance = section === 'all' || section === 'appearance', content = section === 'all' || section === 'content', interaction = section === 'all' || section === 'interaction';
  const skinnable = skinKinds.has(component.kind) || component.kind === 'image' && !!component.parentId || component.kind === 'panel' || component.kind === 'progress' || component.binding === 'tooltip';
  const collection = ['saveSlots', 'galleryGrid', 'musicTrackList', 'voiceCollection', 'chapterList', 'historyList', 'flowchart'].includes(component.kind);
  const skin = component.skin;
  const fit = component.kind === 'image' ? component.style?.imageFit ?? 'contain' : skin?.fit ?? 'stretch';
  return <>
    {interaction && component.kind === 'button' && <>
      <Field label="悬停音效"><select aria-label="按钮悬停音效" value={component.hoverSoundId === null ? '__silent' : component.hoverSoundId ?? ''} onChange={event => edit(c => { c.hoverSoundId = event.target.value === '__silent' ? null : event.target.value || undefined; })}><option value="">使用界面默认音效</option><option value="__silent">不播放</option>{project.assets.filter(a => a.kind === 'audio').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      <Field label="悬停提示" hint="图片按钮默认显示按钮文字；留空可关闭提示。"><input aria-label="悬停提示" value={component.tooltip ?? (component.skin?.hideText ? component.text : '')} onChange={event => edit(c => { c.tooltip = event.target.value; })} /></Field>
      <Field label="快捷键"><select aria-label="按钮快捷键" value={component.shortcut ?? ''} onChange={event => edit(c => { c.shortcut = event.target.value || undefined; })}><option value="">无</option>{'abcdefghijklmnopqrstuvwxyz1234567890'.split('').map(key => <option key={key} value={`K_${key}`}>{key.toUpperCase()}</option>)}{Array.from({ length: 12 }, (_, i) => <option key={i} value={`K_F${i + 1}`}>F{i + 1}</option>)}</select></Field>
    </>}
    {appearance && component.kind === 'button' && <>
      <details className="ui-property-group"><summary>按钮文字状态</summary>{(['hoverTextColor', 'selectedTextColor', 'disabledTextColor'] as const).map(key => <Field key={key} label={{ hoverTextColor: '悬停文字颜色', selectedTextColor: '选中文字颜色', disabledTextColor: '禁用文字颜色' }[key]}><input type="color" value={component.style?.[key] ?? component.style?.textColor ?? project.ui.textColor} onChange={event => edit(c => { c.style = { ...c.style, [key]: event.target.value }; })} /></Field>)}</details>
    </>}
    {content && component.kind === 'choiceList' && <><div className="field-row">
      <Field label="选项高度"><NumberInput aria-label="选项高度" value={component.list?.itemHeight ?? 80} onChange={event => edit(c => { c.list = { ...c.list, itemHeight: Number(event.target.value) }; })} /></Field>
      <Field label="选项间距"><NumberInput aria-label="选项间距" value={component.list?.gapY ?? 10} onChange={event => edit(c => { c.list = { ...c.list, gapY: Number(event.target.value) }; })} /></Field>
    </div><details className="ui-property-group"><summary>选项文字区域</summary>
      <p className="muted ui-field-help">位置相对于每个选项按钮，可为图片装饰留出空间。</p>
      <UiRectFields name="选项文字" value={component.list?.caption} onChange={value => edit(c => { c.list = { ...c.list, caption: value }; })} />
    </details></>}
    {interaction && component.page === 'save' && <Field label="显示在哪个页面"><select value={component.saveMode ?? ''} onChange={event => edit(c => { c.saveMode = event.target.value as UiComponent['saveMode'] || undefined; })}><option value="">存档和读档</option><option value="save">仅存档</option><option value="load">仅读档</option></select></Field>}
    {appearance && (skinnable || component.kind === 'image') && <>
      <div className="inspector-section-title">{component.kind === 'image' ? '图片显示' : '图片皮肤'}</div>
      {skinnable && (Object.entries(uiStateNames) as [UiButtonState, string][]).filter(([state]) => !omitIdle || state !== 'idle').map(([state, name]) => <Field key={state} label={`${name}图片`} hint={state === 'pressed' ? '鼠标按住时显示，松开后恢复。' : state === 'selected' ? '自动播放、静音等开关开启时显示。' : undefined}>
        <UiAssetSelect assetUrl={assetUrl} project={project} kind="image" label={`${name}图片`} value={component.kind === 'image' && state === 'idle' ? component.assetId : skin?.[state]} empty={state === 'idle' ? '使用背景色' : '沿用普通图片'} onChange={value => edit(c => { if (c.kind === 'image' && state === 'idle') c.assetId = value; else c.skin = { ...c.skin, [state]: value }; })} />
      </Field>)}
      {skinnable && <details className="ui-property-group"><summary>图片状态明暗</summary>{(Object.entries(uiStateNames) as [UiButtonState, string][]).map(([state, name]) => <Field key={state} label={`${name}亮度 %`}><NumberInput min={0} max={100} step={1} value={Math.round((skin?.brightness?.[state] ?? 1) * 100)} onChange={event => edit(c => { c.skin = { ...c.skin, brightness: { ...c.skin?.brightness, [state]: Math.max(0, Math.min(100, Number(event.target.value))) / 100 } }; })} /></Field>)}</details>}
      {!(omitIdle && component.kind === 'image') && <Field label="图片缩放"><select value={fit} onChange={event => edit(c => {
        if (c.kind === 'image') c.style = { ...c.style, imageFit: event.target.value as NonNullable<UiComponent['style']>['imageFit'] };
        else c.skin = { ...c.skin, fit: event.target.value as UiSkin['fit'] };
      })}>{Object.entries(uiFitNames).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></Field>}
      {fit === 'nineSlice' && <><p className="muted ui-field-help">保持四个角的大小，只拉伸边缘和中间区域。边距填写原图片中的像素数。</p><div className="ui-border-fields">{(['left', 'top', 'right', 'bottom'] as const).map(edge => <Field key={edge} label={`${{ left: '左', top: '上', right: '右', bottom: '下' }[edge]}边距`}><NumberInput type="number"   value={skin?.borders?.[edge] ?? 12} onChange={event => edit(c => { c.skin = { ...c.skin, borders: { left: 12, top: 12, right: 12, bottom: 12, ...c.skin?.borders, [edge]: Number(event.target.value) } }; })} /></Field>)}</div></>}
      {component.kind === 'button' && <Field label="图片已含文字"><input type="checkbox" checked={skin?.hideText ?? false} onChange={event => edit(c => { c.skin = { ...c.skin, hideText: event.target.checked }; })} /></Field>}
      {skinnable && <button className="text-button" disabled={!skin} onClick={() => edit(c => { c.skin = undefined; })}>清除图片皮肤</button>}
    </>}
    {content && collection && <>
      {component.kind === 'musicTrackList' && <UiListAssets project={project} component={component} edit={edit} />}
      <div className="inspector-section-title">列表布局</div>
      {component.kind === 'musicTrackList' && <Field label="浏览方式"><select aria-label="音乐列表浏览方式" value={component.list?.rows ? 'pages' : 'scroll'} onChange={event => edit(c => { c.list = { ...c.list, rows: event.target.value === 'pages' ? 12 : undefined }; })}><option value="scroll">滚动列表</option><option value="pages">按页切换</option></select></Field>}
      <div className="field-row">{(['columns', 'rows'] as const).filter(key => component.kind !== 'musicTrackList' || key !== 'rows' || component.list?.rows).map(key => <Field key={key} label={key === 'columns' ? component.kind === 'musicTrackList' ? '每行曲目数' : '每行数量' : '每页行数'}><NumberInput type="number" min={component.kind === 'musicTrackList' ? 1 : undefined} value={component.list?.[key] ?? (key === 'columns' ? component.kind === 'saveSlots' || component.kind === 'galleryGrid' ? 3 : 1 : component.kind === 'saveSlots' ? 2 : 0)} onChange={event => edit(c => { c.list = { ...c.list, [key]: component.kind === 'musicTrackList' ? Math.max(1, Number(event.target.value)) : Number(event.target.value) ? Number(event.target.value) : undefined }; })} /></Field>)}</div>
      {!['saveSlots', 'musicTrackList'].includes(component.kind) && <p className="muted ui-field-help">每页行数为 0 时，使用滚动列表。</p>}
      <div className="field-row">{(['gapX', 'gapY'] as const).map(key => <Field key={key} label={key === 'gapX' ? '横向间距' : '纵向间距'}><NumberInput type="number"   value={component.list?.[key] ?? 12} onChange={event => edit(c => { c.list = { ...c.list, [key]: Number(event.target.value) }; })} /></Field>)}</div>
      <div className="field-row">{(['itemWidth', 'itemHeight'] as const).map(key => <Field key={key} label={key === 'itemWidth' ? '条目宽度' : '条目高度'}><NumberInput type="number"   value={component.list?.[key] ?? 0} onChange={event => edit(c => { c.list = { ...c.list, [key]: Number(event.target.value) ? Number(event.target.value) : undefined }; })} /></Field>)}</div>
      {['saveSlots', 'galleryGrid'].includes(component.kind) && <Field label="显示条目文字"><input type="checkbox" checked={component.list?.showLabels ?? true} onChange={event => edit(c => { c.list = { ...c.list, showLabels: event.target.checked }; })} /></Field>}
      {component.kind === 'saveSlots' && <Field label="显示删除存档"><input type="checkbox" checked={component.list?.showDelete ?? true} onChange={event => edit(c => { c.list = { ...c.list, showDelete: event.target.checked }; })} /></Field>}
      {component.kind === 'saveSlots' && <details className="ui-property-group"><summary>存档格内部布局</summary>
        <Field label="固定显示自动存档"><input type="checkbox" checked={component.list?.fixedAutoSlot ?? false} onChange={event => edit(c => { c.list = { ...c.list, fixedAutoSlot: event.target.checked }; })} /></Field>
        <Field label="手动存档页数"><NumberInput value={component.list?.pageCount ?? 6} onChange={event => edit(c => { c.list = { ...c.list, pageCount: Number(event.target.value) }; })} /></Field>
        <Field label="对白摘要字号"><NumberInput value={component.list?.summaryFontSize ?? component.style?.fontSize ?? 24} onChange={event => edit(c => { c.list = { ...c.list, summaryFontSize: Number(event.target.value) }; })} /></Field>
        <Field label="分页位置"><select value={component.list?.navigation ?? 'top'} onChange={event => edit(c => { c.list = { ...c.list, navigation: event.target.value as 'top' | 'bottom' }; })}><option value="top">顶部</option><option value="bottom">底部</option></select></Field>
        <UiRectFields name="存档分页" value={component.list?.navigationRect} onChange={value => edit(c => { c.list = { ...c.list, navigationRect: value }; })} />
        {(['pageTextColor', 'pageSelectedTextColor'] as const).map(key => <Field key={key} label={key === 'pageTextColor' ? '分页文字颜色' : '选中页文字颜色'}><input type="color" value={component.list?.[key] ?? component.list?.pageTextColor ?? component.style?.textColor ?? project.ui.textColor} onChange={event => edit(c => { c.list = { ...c.list, [key]: event.target.value }; })} /></Field>)}
        {(['idle', 'selected'] as const).map(state => <Field key={state} label={`分页${uiStateNames[state]}图片`}><UiAssetSelect assetUrl={assetUrl} project={project} kind="image" label={`分页${uiStateNames[state]}图片`} value={component.list?.pageSkin?.[state]} onChange={value => edit(c => { c.list = { ...c.list, pageSkin: { ...c.list?.pageSkin, [state]: value, fit: 'stretch' } }; })} /></Field>)}
        <Field label="存档文字内容"><select value={component.list?.captionMode ?? 'time'} onChange={event => edit(c => { c.list = { ...c.list, captionMode: event.target.value as 'time' | 'story' }; })}><option value="time">保存时间</option><option value="story">章节和对白摘要</option></select></Field>
        {(['emptyAssetId', 'hoverOverlayId'] as const).map(key => <Field key={key} label={key === 'emptyAssetId' ? '空槽图片' : '悬停装饰图'}><UiAssetSelect assetUrl={assetUrl} project={project} kind="image" label={key === 'emptyAssetId' ? '空槽图片' : '悬停装饰图'} value={component.list?.[key]} onChange={value => edit(c => { c.list = { ...c.list, [key]: value }; })} /></Field>)}
        {(['thumbnail', 'chapter', 'caption', 'number', 'slotAction'] as const).map(key => <UiRectFields key={key} name={{ thumbnail: '缩略图', chapter: '存档章节', caption: '存档文字', number: '槽位编号', slotAction: '读写按钮' }[key]} value={component.list?.[key]} onChange={value => edit(c => { c.list = { ...c.list, [key]: value }; })} />)}
        <Field label="编号文字颜色"><input type="color" value={component.list?.numberTextColor ?? component.style?.textColor ?? project.ui.textColor} onChange={event => edit(c => { c.list = { ...c.list, numberTextColor: event.target.value }; })} /></Field>
        {(['numberSkin', 'slotActionSkin', 'slotSaveSkin', 'autoSlotSkin'] as const).map(key => <Field key={key} label={{ numberSkin: '编号底图', slotActionSkin: '读取按钮底图', slotSaveSkin: '保存按钮底图', autoSlotSkin: '自动档底图' }[key]}><UiAssetSelect project={project} assetUrl={assetUrl} kind="image" label={{ numberSkin: '编号底图', slotActionSkin: '读取按钮底图', slotSaveSkin: '保存按钮底图', autoSlotSkin: '自动档底图' }[key]} value={component.list?.[key]?.idle} onChange={value => edit(c => { c.list = { ...c.list, [key]: { ...c.list?.[key], idle: value, fit: 'stretch' } }; })} /></Field>)}
        {(['slotActionSkin', 'slotSaveSkin'] as const).map(key => <Field key={key} label={key === 'slotActionSkin' ? '读取按钮使用图片内文字' : '保存按钮使用图片内文字'}><input type="checkbox" checked={component.list?.[key]?.hideText ?? false} onChange={event => edit(c => { c.list = { ...c.list, [key]: { ...c.list?.[key], hideText: event.target.checked } }; })} /></Field>)}
        <Field label="缩略图相框"><UiAssetSelect assetUrl={assetUrl} project={project} kind="image" label="缩略图相框" value={component.list?.thumbnailFrame?.assetId} onChange={value => edit(c => { c.list = { ...c.list, thumbnailFrame: value ? { x: 0.05, y: 0.05, width: 0.9, height: 0.6, ...c.list?.thumbnailFrame, assetId: value } : undefined }; })} /></Field>
        {component.list?.thumbnailFrame && <UiRectFields name="相框" value={component.list.thumbnailFrame} onChange={value => edit(c => { if (c.list?.thumbnailFrame) c.list.thumbnailFrame = value ? { ...value, assetId: c.list.thumbnailFrame.assetId } : undefined; })} />}
      </details>}
      {component.kind === 'musicTrackList' && !!component.list?.rows && <details className="ui-property-group"><summary>音乐分页位置</summary>
        <UiRectFields name="音乐分页" value={component.list?.navigationRect} onChange={value => edit(c => { c.list = { ...c.list, navigationRect: value }; })} />
      </details>}
      {component.kind === 'galleryGrid' && <Field label="未解锁图片"><UiAssetSelect assetUrl={assetUrl} project={project} kind="image" label="未解锁图片" value={component.list?.lockedAssetId} onChange={value => edit(c => { c.list = { ...c.list, lockedAssetId: value }; })} /></Field>}
      {component.kind === 'galleryGrid' && <>
        <Field label="画廊排列"><select aria-label="画廊排列" value={component.list?.layout ?? 'grid'} onChange={event => edit(c => { c.list = { ...c.list, layout: event.target.value as 'grid' | 'staggered' }; })}><option value="grid">等距网格</option><option value="staggered">上下错列</option></select></Field>
        {component.list?.layout === 'staggered' && <Field label="隔行横移"><NumberInput value={component.list.staggerX ?? 120} onChange={event => edit(c => { c.list = { ...c.list, staggerX: Number(event.target.value) }; })} /></Field>}
        <details className="ui-property-group"><summary>画廊图片与分页位置</summary>
          <Field label="缩略图缩放"><select value={component.list?.thumbnailFit ?? 'contain'} onChange={event => edit(c => { c.list = { ...c.list, thumbnailFit: event.target.value as 'contain' | 'cover' | 'stretch' }; })}><option value="contain">完整显示</option><option value="cover">裁切铺满相框</option><option value="stretch">拉伸铺满相框</option></select></Field>
          <details className="ui-property-group"><summary>缩略图状态明暗</summary>{Object.entries(uiStateNames).map(([state, name]) => <Field key={state} label={`缩略图${name}亮度 %`}><NumberInput min={0} max={100} value={Math.round((component.list?.thumbnailBrightness?.[state as UiButtonState] ?? 1) * 100)} onChange={event => edit(c => { c.list = { ...c.list, thumbnailBrightness: { ...c.list?.thumbnailBrightness, [state]: Math.max(0, Math.min(100, Number(event.target.value))) / 100 } }; })} /></Field>)}</details>
          {(['thumbnail', 'lockedRect', 'navigationRect'] as const).map(key => <UiRectFields key={key} name={{ thumbnail: '画廊图片', lockedRect: '锁定图片', navigationRect: '分页按钮' }[key]} value={component.list?.[key]} onChange={value => edit(c => { c.list = { ...c.list, [key]: value }; })} />)}
          {(['idle', 'selected'] as const).map(state => <Field key={state} label={`分页${uiStateNames[state]}图片`}><UiAssetSelect assetUrl={assetUrl} project={project} kind="image" label={`分页${uiStateNames[state]}图片`} value={component.list?.pageSkin?.[state]} onChange={value => edit(c => { c.list = { ...c.list, pageSkin: { ...c.list?.pageSkin, [state]: value, fit: 'stretch' } }; })} /></Field>)}
        </details>
      </>}
      {component.kind === 'flowchart' && <><Field label="流程图排列"><select aria-label="流程图排列" value={component.list?.layout === 'flow' ? 'flow' : 'grid'} onChange={event => edit(c => { c.list = { ...c.list, layout: event.target.value as 'flow' | 'grid' }; })}><option value="flow">横向分支图</option><option value="grid">目录列表</option></select></Field>
        {component.list?.layout === 'flow' && <details className="ui-property-group"><summary>流程图连线与分类图片</summary>
          {(['flowLineAssetId', 'flowVerticalLineAssetId'] as const).map(key => <Field key={key} label={key === 'flowLineAssetId' ? '水平连线图片' : '垂直连线图片'}><UiAssetSelect project={project} assetUrl={assetUrl} kind="image" label={key === 'flowLineAssetId' ? '水平连线图片' : '垂直连线图片'} value={component.list?.[key]} onChange={value => edit(c => { c.list = { ...c.list, [key]: value }; })} /></Field>)}
          <Field label="连线粗细"><NumberInput value={component.list?.flowLineWidth ?? 4} onChange={event => edit(c => { c.list = { ...c.list, flowLineWidth: Number(event.target.value) }; })} /></Field>
          {(['flowEndSkin', 'flowChapterSkin'] as const).map(key => <Field key={key} label={key === 'flowEndSkin' ? '结局背景图片' : '章节背景图片'}><UiAssetSelect project={project} assetUrl={assetUrl} kind="image" label={key === 'flowEndSkin' ? '结局背景图片' : '章节背景图片'} value={component.list?.[key]?.idle} onChange={value => edit(c => { c.list = { ...c.list, [key]: { ...c.list?.[key], idle: value, fit: 'stretch' } }; })} /></Field>)}
        </details>}
        {component.list?.layout === 'flow' && <details className="ui-property-group"><summary>流程图显示区域与导航</summary>
          <Field label="当前位置标记"><UiAssetSelect project={project} assetUrl={assetUrl} kind="image" label="当前位置标记" value={component.list.flowCurrentMarker?.assetId} onChange={value => edit(c => { c.list = { ...c.list, flowCurrentMarker: value ? { assetId: value, rect: c.list?.flowCurrentMarker?.rect ?? { x: 0, y: 0, width: 1, height: 1 } } : undefined }; })} /></Field>
          {component.list.flowCurrentMarker && <UiRectFields name="当前位置标记区域" value={component.list.flowCurrentMarker.rect} onChange={value => edit(c => { if (value && c.list?.flowCurrentMarker) c.list.flowCurrentMarker.rect = value; })} />}
          <UiRectFields name="流程图显示区域" value={component.list?.flowViewport} onChange={value => edit(c => { c.list = { ...c.list, flowViewport: value }; })} />
          <Field label="显示缩放与定位按钮"><input type="checkbox" checked={component.list?.flowShowControls ?? true} onChange={event => edit(c => { c.list = { ...c.list, flowShowControls: event.target.checked }; })} /></Field>
          <Field label="显示竖向滚动条"><input type="checkbox" checked={component.list?.flowShowVerticalScrollbar ?? true} onChange={event => edit(c => { c.list = { ...c.list, flowShowVerticalScrollbar: event.target.checked }; })} /></Field>
          <UiRectFields name="横向滚动条" value={component.list?.flowScrollbar?.rect} onChange={value => edit(c => { c.list = { ...c.list, flowScrollbar: value ? { ...c.list?.flowScrollbar, rect: value } : undefined }; })} />
          {component.list?.flowScrollbar && <>
            <Field label="滚动条轨道图片"><UiAssetSelect project={project} assetUrl={assetUrl} kind="image" label="滚动条轨道图片" value={component.list.flowScrollbar.trackId} onChange={value => edit(c => { c.list!.flowScrollbar!.trackId = value; })} /></Field>
            {(['idle', 'hover', 'pressed', 'disabled'] as const).map(state => <Field key={state} label={`滚动滑块${uiStateNames[state]}图片`}><UiAssetSelect project={project} assetUrl={assetUrl} kind="image" label={`滚动滑块${uiStateNames[state]}图片`} value={component.list?.flowScrollbar?.thumb?.[state]} onChange={value => edit(c => { const scroll = c.list!.flowScrollbar!; scroll.thumb = { ...scroll.thumb, [state]: value }; })} /></Field>)}
            <Field label="滑块缩放"><select aria-label="滑块缩放" value={component.list.flowScrollbar.thumb?.fit ?? 'stretch'} onChange={event => edit(c => { const scroll = c.list!.flowScrollbar!; scroll.thumb = { ...scroll.thumb, fit: event.target.value as UiSkin['fit'] }; })}><option value="stretch">整张拉伸</option><option value="nineSlice">九宫格 · 保持两端</option><option value="contain">完整显示</option></select></Field>
            {component.list.flowScrollbar.thumb?.fit === 'nineSlice' && <><p className="muted ui-field-help">边距使用原图像素；左右两端保持大小，中间随可见范围伸缩。</p><div className="ui-border-fields">{(['left', 'top', 'right', 'bottom'] as const).map(edge => <Field key={edge} label={`滑块${{ left: '左', top: '上', right: '右', bottom: '下' }[edge]}边距`}><NumberInput min={0} value={component.list?.flowScrollbar?.thumb?.borders?.[edge] ?? 12} onChange={event => edit(c => { const scroll = c.list!.flowScrollbar!; scroll.thumb = { ...scroll.thumb, borders: { left: 12, top: 12, right: 12, bottom: 12, ...scroll.thumb?.borders, [edge]: Math.max(0, Number(event.target.value)) } }; })} /></Field>)}</div></>}
            <details className="ui-property-group"><summary>滚动滑块状态明暗</summary>{(['idle', 'hover', 'pressed', 'disabled'] as const).map(state => <Field key={state} label={`滚动滑块${uiStateNames[state]}亮度 %`}><NumberInput value={Math.round((component.list?.flowScrollbar?.thumb?.brightness?.[state] ?? 1) * 100)} onChange={event => edit(c => { const scroll = c.list!.flowScrollbar!; scroll.thumb = { ...scroll.thumb, brightness: { ...scroll.thumb?.brightness, [state]: Math.max(0, Math.min(100, Number(event.target.value))) / 100 } }; })} /></Field>)}</details>
            <Field label="滚动条轨道厚度"><NumberInput value={component.list.flowScrollbar.trackHeight ?? 5} min={1} max={128} onChange={event => edit(c => { c.list!.flowScrollbar!.trackHeight = Number(event.target.value); })} /></Field>
            <Field label="滚动滑块高度"><NumberInput value={component.list.flowScrollbar.thumbHeight ?? 31} min={4} max={128} onChange={event => edit(c => { c.list!.flowScrollbar!.thumbHeight = Number(event.target.value); })} /></Field>
          </>}
        </details>}
      </>}
      {['chapterList', 'flowchart'].includes(component.kind) && <>
        <Field label="锁定未到达的剧情"><input type="checkbox" checked={component.list?.lockUnread ?? false} onChange={event => edit(c => { c.list = { ...c.list, lockUnread: event.target.checked }; })} /></Field>
        <Field label="显示已读和当前位置"><input type="checkbox" checked={component.list?.showProgress ?? false} onChange={event => edit(c => { c.list = { ...c.list, showProgress: event.target.checked }; })} /></Field>
        <Field label="游戏中跳转前确认"><input type="checkbox" checked={component.list?.confirmJump ?? true} onChange={event => edit(c => { c.list = { ...c.list, confirmJump: event.target.checked }; })} /></Field>
      </>}
      {component.kind === 'voiceCollection' && <Field label="默认只看收藏"><input type="checkbox" checked={component.list?.favoritesOnly ?? false} onChange={event => edit(c => { c.list = { ...c.list, favoritesOnly: event.target.checked }; })} /></Field>}
      {component.kind === 'voiceCollection' && <details className="ui-property-group"><summary>收藏条目与分页</summary>
        <Field label="收藏排列顺序"><select value={component.list?.voiceOrder ?? 'source'} onChange={event => edit(c => { c.list = { ...c.list, voiceOrder: event.target.value as 'source' | 'favorites' }; })}><option value="source">资源顺序</option><option value="favorites">收藏先后顺序</option></select></Field>
        <Field label="删除收藏前确认"><input type="checkbox" checked={component.list?.voiceRemoveConfirm ?? false} onChange={event => edit(c => { c.list = { ...c.list, voiceRemoveConfirm: event.target.checked }; })} /></Field>
        {component.list?.voiceRemoveConfirm && <Field label="删除收藏提示"><input value={component.list.voiceRemoveMessage ?? ''} placeholder={defaultVoiceRemoveMessage} maxLength={2000} onChange={event => edit(c => { c.list = { ...c.list, voiceRemoveMessage: event.target.value || undefined }; })} /></Field>}
        <Field label="显示筛选和停止按钮"><input type="checkbox" checked={component.list?.showVoiceControls ?? true} onChange={event => edit(c => { c.list = { ...c.list, showVoiceControls: event.target.checked }; })} /></Field>
        <Field label="收藏文字内容"><select value={component.list?.voiceCaptionMode ?? 'speaker'} onChange={event => edit(c => { c.list = { ...c.list, voiceCaptionMode: event.target.value as 'speaker' | 'text' }; })}><option value="speaker">姓名和对白摘要</option><option value="text">仅对白</option></select></Field>
        <Field label="单行显示并省略长文本"><input type="checkbox" checked={component.list?.voiceSingleLine ?? false} onChange={event => edit(c => { c.list = { ...c.list, voiceSingleLine: event.target.checked }; })} /></Field>
        {(['caption', 'voiceFavoriteRect', 'navigationRect'] as const).map(key => <UiRectFields key={key} name={{ caption: '收藏文字', voiceFavoriteRect: '收藏按钮', navigationRect: '收藏分页' }[key]} value={component.list?.[key]} onChange={value => edit(c => { c.list = { ...c.list, [key]: value }; })} />)}
        {(['idle', 'selected'] as const).map(state => <Field key={state} label={`收藏分页${uiStateNames[state]}图片`}><UiAssetSelect assetUrl={assetUrl} project={project} kind="image" label={`收藏分页${uiStateNames[state]}图片`} value={component.list?.pageSkin?.[state]} onChange={value => edit(c => { c.list = { ...c.list, pageSkin: { ...c.list?.pageSkin, [state]: value, fit: 'stretch', hideText: false } }; })} /></Field>)}
      </details>}
      {component.kind === 'historyList' && <>
        <Field label="历史条目排列"><select value={component.list?.historyLayout ?? 'stacked'} onChange={event => edit(c => { c.list = { ...c.list, historyLayout: event.target.value as 'stacked' | 'columns' }; })}><option value="stacked">姓名在对白上方</option><option value="columns">姓名、语音按钮与对白分列</option></select></Field>
        <Field label="姓名列宽度"><NumberInput type="number"   value={component.list?.historyNameWidth ?? 165} onChange={event => edit(c => { c.list = { ...c.list, historyNameWidth: Number(event.target.value) }; })} /></Field>
        <Field label="姓名字号"><NumberInput type="number" value={component.list?.historyNameFontSize ?? component.style?.fontSize ?? 30} onChange={event => edit(c => { c.list = { ...c.list, historyNameFontSize: Number(event.target.value) }; })} /></Field>
        <Field label="历史行最小高度"><NumberInput type="number" value={component.list?.historyRowHeight ?? component.list?.voiceButtonSize ?? 49} onChange={event => edit(c => { c.list = { ...c.list, historyRowHeight: Number(event.target.value) }; })} /></Field>
        <Field label="历史行上下留白"><NumberInput type="number" value={component.list?.historyPaddingY ?? 12} onChange={event => edit(c => { c.list = { ...c.list, historyPaddingY: Number(event.target.value) }; })} /></Field>
        <Field label="历史文字加粗"><input type="checkbox" checked={component.list?.historyBold ?? false} onChange={event => edit(c => { c.list = { ...c.list, historyBold: event.target.checked }; })} /></Field>
        <Field label="历史文字字距"><NumberInput type="number" min={-4} max={30} value={component.list?.historyLetterSpacing ?? 0} onChange={event => edit(c => { c.list = { ...c.list, historyLetterSpacing: Number(event.target.value) }; })} /></Field>
        {component.list?.historyScrollbar && <details className="ui-property-group"><summary>历史滚动条</summary>
          <UiRectFields name="滚动条" value={component.list.historyScrollbar.rect} onChange={value => edit(c => { if (value && c.list?.historyScrollbar) c.list.historyScrollbar.rect = value; })} />
          <Field label="历史滚动条轨道"><UiAssetSelect project={project} kind="image" assetUrl={assetUrl} label="历史滚动条轨道" value={component.list.historyScrollbar.trackId} onChange={value => edit(c => { if (c.list?.historyScrollbar) c.list.historyScrollbar.trackId = value; })} /></Field>
          {(['idle', 'hover'] as const).map(state => <Field key={state} label={`历史滑块${uiStateNames[state]}图片`}><UiAssetSelect project={project} kind="image" assetUrl={assetUrl} label={`历史滑块${uiStateNames[state]}图片`} value={component.list?.historyScrollbar?.thumb?.[state]} onChange={value => edit(c => { if (c.list?.historyScrollbar) c.list.historyScrollbar.thumb = { ...c.list.historyScrollbar.thumb, [state]: value }; })} /></Field>)}
        </details>}
      </>}
      {['historyList', 'voiceCollection'].includes(component.kind) && <details className="ui-property-group"><summary>语音按钮图片</summary>
        <Field label="语音按钮大小"><NumberInput type="number"   value={component.list?.voiceButtonSize ?? 49} onChange={event => edit(c => { c.list = { ...c.list, voiceButtonSize: Number(event.target.value) }; })} /></Field>
        {(['voiceReplaySkin', 'voiceFavoriteSkin'] as const).filter(key => component.kind === 'historyList' || key === 'voiceFavoriteSkin').map(key => <details className="ui-property-group" key={key}><summary>{key === 'voiceReplaySkin' ? '重播语音' : '收藏语音'}</summary>{Object.entries(uiStateNames).map(([state, name]) => <Field key={state} label={`${name}图片`}><UiAssetSelect project={project} kind="image" assetUrl={assetUrl} label={`${key === 'voiceReplaySkin' ? '重播' : '收藏'}${name}图片`} value={component.list?.[key]?.[state as UiButtonState]} empty="默认 / 沿用普通图片" onChange={value => edit(c => { c.list = { ...c.list, [key]: { ...c.list?.[key], [state]: value, fit: 'contain', hideText: true } }; })} /></Field>)}</details>)}
      </details>}
      {component.kind === 'galleryGrid' && <UiGalleryGroups key={component.id} project={project} component={component} edit={edit} assetUrl={assetUrl} />}
      {(component.kind === 'voiceCollection' || component.kind === 'galleryGrid' && !component.list?.galleryGroups) && <UiListAssets project={project} component={component} edit={edit} />}
    </>}
    {appearance && !['image', 'video', 'spine', 'panel'].includes(component.kind) && <Field label="组件字体"><UiAssetSelect assetUrl={assetUrl} project={project} kind="font" label="组件字体" value={component.style?.fontAssetId} empty="使用主题字体" onChange={value => edit(c => { c.style = { ...c.style, fontAssetId: value }; })} /></Field>}
    {appearance && ['text', 'flowchart'].includes(component.kind) && <details className="ui-property-group"><summary>文字描边与阴影</summary>
      <Field label="描边宽度"><NumberInput aria-label="描边宽度" type="number"   step={0.5} value={component.style?.outlineWidth ?? 0} onChange={event => edit(c => { c.style = { ...c.style, outlineWidth: Number(event.target.value) }; })} /></Field>
      <Field label="描边颜色"><input aria-label="描边颜色" type="color" value={component.style?.outlineColor ?? '#000000'} onChange={event => edit(c => { c.style = { ...c.style, outlineColor: event.target.value }; })} /></Field>
      <Field label="描边不透明度"><input aria-label="描边不透明度" type="range" min={0} max={1} step={0.01} value={component.style?.outlineOpacity ?? 1} onChange={event => edit(c => { c.style = { ...c.style, outlineOpacity: Number(event.target.value) }; })} /></Field>
      {(['shadowX', 'shadowY'] as const).map(key => <Field key={key} label={key === 'shadowX' ? '阴影水平偏移' : '阴影垂直偏移'}><NumberInput aria-label={key === 'shadowX' ? '阴影水平偏移' : '阴影垂直偏移'} step={0.5} value={component.style?.[key] ?? 0} onChange={event => edit(c => { c.style = { ...c.style, [key]: Number(event.target.value) }; })} /></Field>)}
      <Field label="阴影柔化" hint="增大后形成文字周围的柔和阴影；偏移为 0 时向四周扩散。"><NumberInput aria-label="阴影柔化" min={0} max={64} step={.5} value={component.style?.shadowBlur ?? 0} onChange={event => edit(c => { c.style = { ...c.style, shadowBlur: Math.max(0, Math.min(64, Number(event.target.value))) }; })} /></Field>
      <Field label="阴影颜色"><input aria-label="阴影颜色" type="color" value={component.style?.shadowColor ?? '#000000'} onChange={event => edit(c => { c.style = { ...c.style, shadowColor: event.target.value }; })} /></Field>
      <Field label="阴影不透明度"><input aria-label="阴影不透明度" type="range" min={0} max={1} step={0.01} value={component.style?.shadowOpacity ?? 0.7} onChange={event => edit(c => { c.style = { ...c.style, shadowOpacity: Number(event.target.value) }; })} /></Field>
    </details>}
    {interaction && <><div className="inspector-section-title">显示与可用条件</div>
    {component.kind === 'button' && <Field label="暂时禁用"><input type="checkbox" checked={component.disabled ?? false} onChange={event => edit(c => { c.disabled = event.target.checked; })} /></Field>}
    {(['visibleWhen', ...(component.kind === 'button' ? ['enabledWhen', 'selectedWhen'] as const : [])] as const).map(key => <div key={key}>
      <Field label={key === 'visibleWhen' ? '按条件显示' : key === 'enabledWhen' ? '按条件启用' : '按条件选中'}><input type="checkbox" checked={!!component[key]} onChange={event => edit(c => { c[key] = event.target.checked ? { kind: 'all', conditions: [] } : undefined; })} /></Field>
      {component[key] && <ConditionEditor project={project} condition={component[key]} onChange={condition => edit(c => { c[key] = condition; })} />}
    </div>)}</>}
  </>;
}

type Rect = { x: number; y: number; width: number; height: number };
function UiRectFields({ name, value, onChange }: { name: string; value?: Rect; onChange: (value?: Rect) => void }) {
  return <div className="ui-inner-rect"><Field label={`自定义${name}位置`}><input type="checkbox" checked={!!value} onChange={event => onChange(event.target.checked ? { x: 0.05, y: 0.05, width: 0.9, height: 0.4 } : undefined)} /></Field>
    {value && <div className="ui-border-fields">{(['x', 'y', 'width', 'height'] as const).map(key => <Field key={key} label={`${name}${{ x: '横向', y: '纵向', width: '宽度', height: '高度' }[key]} %`}><NumberInput type="number" step={0.1}   value={Number((value[key] * 100).toFixed(2))} onChange={event => onChange({ ...value, [key]: Number(event.target.value) / 100 })} /></Field>)}</div>}
  </div>;
}

function UiListAssets({ project, component, edit }: { project: Project; component: UiComponent; edit: (change: (component: UiComponent) => void) => void }) {
  const [query, setQuery] = useState('');
  const kind = component.kind === 'galleryGrid' ? 'image' : 'audio';
  if (component.kind === 'musicTrackList') {
    const automatic = musicRoomEntries(project), selected = component.list?.assetIds;
    const available = project.assets.filter(asset => asset.kind === 'audio' && asset.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    const update = (ids: string[] | undefined) => edit(c => { c.list = { ...c.list, assetIds: ids }; });
    const move = (index: number, direction: number) => {
      const ids = [...(selected ?? [])], target = index + direction;
      if (target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      update(ids);
    };
    return <section className="ui-music-track-editor" aria-label="音乐列表曲目">
      <div className="inspector-section-title">音乐曲目</div>
      <Field label="曲目来源"><select aria-label="音乐列表曲目来源" value={selected ? 'selected' : 'automatic'} onChange={event => update(event.target.value === 'selected' ? automatic.map(asset => asset.id) : undefined)}><option value="automatic">自动收集剧情配乐</option><option value="selected">手动选择曲目与顺序</option></select></Field>
      <p className="muted ui-field-help">{selected ? `已选择 ${selected.length} 首；列表按下方顺序显示。` : `自动收集 ${automatic.length} 首配乐；新增剧情配乐后，列表会随之更新。`}</p>
      {selected && <>
        {selected.length ? <ol className="ui-music-track-order">{selected.map((id, index) => {
          const asset = project.assets.find(asset => asset.id === id), name = asset?.name ?? '素材已移除';
          return <li key={id}><span title={name}>{index + 1}. {name}</span><button type="button" aria-label={`上移曲目：${name}`} disabled={index === 0} onClick={() => move(index, -1)}>上移</button><button type="button" aria-label={`下移曲目：${name}`} disabled={index === selected.length - 1} onClick={() => move(index, 1)}>下移</button><button type="button" aria-label={`移除曲目：${name}`} onClick={() => update(selected.filter(value => value !== id))}>移除</button></li>;
        })}</ol> : <p className="ui-field-help" role="status">当前列表为空，请在下面勾选曲目。</p>}
        <input className="ui-list-asset-search" aria-label="搜索音乐列表曲目" placeholder="搜索曲目名称" value={query} onChange={event => setQuery(event.target.value)} />
        <div className="ui-list-asset-picker">{available.map(asset => <label key={asset.id}><input type="checkbox" aria-label={`加入音乐列表：${asset.name}`} checked={selected.includes(asset.id)} onChange={event => update(event.target.checked ? [...new Set([...selected, asset.id])] : selected.filter(id => id !== asset.id))} />{asset.name}</label>)}</div>
        {!available.length && <p className="muted ui-field-help">没有找到符合名称的音频。</p>}
      </>}
    </section>;
  }
  return <details className="ui-property-group"><summary>列表中的素材</summary>
    <Field label="仅显示指定素材"><input type="checkbox" checked={!!component.list?.assetIds} onChange={event => edit(c => { c.list = { ...c.list, assetIds: event.target.checked ? [] : undefined }; })} /></Field>
    {component.list?.assetIds && <><input className="ui-list-asset-search" aria-label="筛选列表素材" placeholder="搜索素材名称" value={query} onChange={event => setQuery(event.target.value)} /><div className="ui-list-asset-picker">{project.assets.filter(asset => asset.kind === kind && asset.name.includes(query)).map(asset => <label key={asset.id}><input type="checkbox" checked={component.list?.assetIds?.includes(asset.id) ?? false} onChange={event => edit(c => { c.list = { ...c.list, assetIds: event.target.checked ? [...new Set([...(c.list?.assetIds ?? []), asset.id])] : c.list?.assetIds?.filter(id => id !== asset.id) }; })} />{asset.name}</label>)}</div></>}
  </details>;
}
