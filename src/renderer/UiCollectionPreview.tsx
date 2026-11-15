import { uiComponentTheme } from '../core/ui-page-settings';
import { uiStateColor } from './UiAppearance';
import { UiHistoryPreview } from './UiHistoryPreview';
import { UiMusicCollectionPreview } from './UiMusicCollectionPreview';
import { UiVoiceCollectionPreview } from './UiVoiceCollectionPreview';
import { useState, type CSSProperties } from 'react';
import type { Project, UiButtonState, UiComponent } from '../core/model';
import type { UiLayoutGeometry } from '../core/ui-layout';
import { storyMenuEntries } from '../core/story-menu';
import type { AssetUrl } from './StageEditor';
import { UiSkinImage, uiFontFamily } from './UiAppearance';
import { galleryLayout } from '../core/gallery-layout';
import { galleryEntries, galleryPagination, galleryUnlockedAssets } from '../core/gallery';
import { UiFlowPreview } from './UiFlowPreview';
import { UiFlowDirectoryPreview } from './UiFlowDirectoryPreview';
import { collectionPixelRect, saveSlotLayout } from '../core/ui-collection-layout';
import { collectionTextStyle, type CollectionTextStyle } from '../core/ui-collection-text';
import { uiComponentFontSize } from '../core/ui';
import { collectionPartProps, useCollectionEditing } from './UiCollectionEditing';

type Rect = { x: number; y: number; width: number; height: number };
const rectStyle = (r: Rect): CSSProperties => ({ position: 'absolute', left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.width * 100}%`, height: `${r.height * 100}%` });
const pixelStyle = (r: Rect, scale: number): CSSProperties => ({ position: 'absolute', left: r.x * scale, top: r.y * scale, width: r.width * scale, height: r.height * scale });
const textStyle = (style: CollectionTextStyle, scale: number): CSSProperties => ({ fontFamily: uiFontFamily(style.fontAssetId), fontSize: style.fontSize * scale, color: style.textColor, textAlign: style.align });

export function UiCollectionPreview({ project, component, geometry, assetUrl, scale, state, filled = false, saveMode = 'load' }: { project: Project; component: UiComponent; geometry?: UiLayoutGeometry; assetUrl: AssetUrl; scale: number; state: UiButtonState; filled?: boolean; saveMode?: 'save' | 'load' }) {
  const editing = useCollectionEditing();
  if (component.kind === 'flowchart') return component.list?.layout === 'flow' ? <UiFlowPreview project={project} component={component} geometry={geometry} assetUrl={assetUrl} scale={scale} state={state} /> : <UiFlowDirectoryPreview project={project} component={component} assetUrl={assetUrl} scale={scale} state={state} />;
  project = { ...project, ui: uiComponentTheme(project, component) };
  const list = component.list;
  if(component.kind === 'musicTrackList')return <UiMusicCollectionPreview project={project} component={component} assetUrl={assetUrl} scale={scale} state={state}/>;
  const isSave = component.kind === 'saveSlots';
  if(component.kind === 'voiceCollection')return <UiVoiceCollectionPreview project={project} component={component} assetUrl={assetUrl} scale={scale} state={state}/>;
  const isStory = component.kind === 'chapterList';
  if (component.kind === 'galleryGrid') return <GalleryPreview project={project} component={component} assetUrl={assetUrl} scale={scale} state={state} />;
  if (component.kind === 'historyList') return <UiHistoryPreview project={project} component={component} geometry={geometry} assetUrl={assetUrl} scale={scale} state={state} />;
  const save = isSave ? saveSlotLayout(project, component) : undefined;
  const columns = save?.columns ?? list?.columns ?? 1;
  const rows = save?.rows ?? list?.rows ?? 0;
  const w = save?.width ?? component.width * project.width;
  const h = save?.height ?? component.height * project.height;
  const gapX = save?.gapX ?? Math.min(list?.gapX ?? 12, w / (columns * 2));
  const gapY = save?.gapY ?? list?.gapY ?? 12;
  const defaultNavHeight = rows ? Math.max(24, Math.min(40, h * 0.1)) : 0;
  const customNav = !!list?.navigationRect && (isSave || rows > 0);
  const nav = save?.navigation ?? (customNav && list?.navigationRect ? { x: list.navigationRect.x * w, y: list.navigationRect.y * h, width: list.navigationRect.width * w, height: list.navigationRect.height * h }
    : { x: 0, y: h - defaultNavHeight, width: w, height: defaultNavHeight });
  const sourceEntries = isSave ? Array.from({ length: rows * columns }, (_, index) => ({ id: String(index), name: '空存档' })) :
    isStory ? storyMenuEntries(project, 'chapterList') :
    list?.assetIds ? list.assetIds.flatMap(id => { const asset = project.assets.find(a => a.id === id); return asset ? [asset] : []; }) : project.assets.filter(asset => asset.kind === 'audio');
  const fixedAuto = save?.fixedAuto ?? false;
  const pageCount = rows ? Math.max(1, Math.ceil(sourceEntries.length / (rows * columns))) : 1;
  const navigationLabels = save?.navigationLabels ?? (customNav ? Array.from({ length: pageCount }, (_, i) => String(i + 1)) : ['上一页', `1 / ${pageCount}`, '下一页']);
  const navHeight = nav.height, navGap = save?.navGap ?? (customNav ? 8 : Math.max(2, Math.min(8, Math.floor(nav.width / 150)))), navWidth = save?.navWidth ?? (customNav ? Math.min(64, Math.max(20, Math.floor(nav.width / navigationLabels.length) - 8)) : Math.max(1, Math.floor((nav.width - (navigationLabels.length - 1) * navGap) / navigationLabels.length)));
  const gridTop = save?.gridTop ?? 0;
  const viewHeight = save?.gridHeight ?? h - (customNav ? 0 : navHeight) - (rows && !customNav ? gapY : 0);
  const cellW = save?.cellWidth ?? Math.max(1, Math.min(list?.itemWidth ?? w, Math.floor((w - (columns - 1) * gapX - (rows ? 0 : 16)) / columns)));
  const cellH = save?.cellHeight ?? list?.itemHeight ?? (rows ? Math.max(32, Math.floor((viewHeight - (rows - 1) * gapY) / rows)) : Math.max(48, (component.style?.fontSize ?? project.ui.fontSize) + 28));
  const entries = sourceEntries.slice(0, rows ? rows * columns : 16);
  const capHeight = save?.captionHeight ?? 0;
  const bodyH = save?.bodyHeight ?? cellH;
  const sampleImage = project.assets.find(asset => asset.kind === 'image');
  const sampleNode = project.nodes.find(node => node.kind === 'passage');
  const sampleScene = project.scenes.find(scene => scene.id === sampleNode?.sceneId);
  const sampleHeading = project.chapters.find(chapter => chapter.id === sampleScene?.chapterId)?.name ?? sampleScene?.name ?? '';
  const sampleText = project.nodes.flatMap(n => n.kind === 'passage' ? n.lines.filter(l => !l.silent).map(l => l.text) : []).slice(0, 5).join('\n\n');
  const sampleStory = [list?.chapter ? '' : sampleHeading, sampleText].filter(Boolean).join('\n\n');
  const sampleCaption = filled ? list?.captionMode === 'story' && sampleStory ? sampleStory : '2026-09-10\n12:00' : '空存档';
  const font = uiComponentFontSize(component, project.ui, project.width, project.height);
  const chapterText = textStyle(collectionTextStyle(project, component, 'chapter'), scale);
  const captionText = textStyle(collectionTextStyle(project, component, 'caption'), scale);
  const numberRect = list?.number ? collectionPixelRect(list.number, cellW, bodyH) : undefined;
  const numberText = textStyle(collectionTextStyle(project, component, 'number'), scale);
  const navText = textStyle(collectionTextStyle(project, component, 'navigation'), scale);
  const saveRectStyle = (rect: Rect) => pixelStyle(collectionPixelRect(rect, cellW, bodyH), scale);
  return <div className="ui-collection-preview">
    <div className="ui-collection-preview-grid" style={{ display: 'grid', position: 'absolute', top: gridTop * scale, left: (save?.gridLeft ?? 0) * scale, gridTemplateColumns: `repeat(${columns}, ${cellW * scale}px)`, gridAutoRows: `${cellH * scale}px`, gap: `${gapY * scale}px ${gapX * scale}px`, maxHeight: viewHeight * scale }}>
      {entries.map((entry, index) => {
        const look = component;
        const autoSlot = fixedAuto && index === 0, slotSkin = autoSlot ? list?.autoSlotSkin ?? look.skin : look.skin;
        const slotState = autoSlot && state === 'selected' ? 'idle' : state;
        const actionSkin = saveMode === 'save' && !autoSlot ? list?.slotSaveSkin ?? list?.slotActionSkin : list?.slotActionSkin;
        return <div key={entry.id} {...collectionPartProps(editing, component.id, 'item')} className="ui-collection-preview-item" style={{ width: cellW * scale, height: cellH * scale }}>
        <div {...(autoSlot ? collectionPartProps(editing, component.id, 'autoSlot') : {})} className="ui-collection-preview-surface" style={{ height: bodyH * scale, backgroundColor: slotSkin?.idle ? undefined : uiStateColor(look, slotState, project.ui.accent) }}>
          <UiSkinImage skin={slotSkin} state={slotState} assetUrl={assetUrl} scale={scale} />
          {save ? <>
            {filled || !list?.emptyAssetId ? <>
              {list?.thumbnailFrame && <img {...collectionPartProps(editing, component.id, 'thumbnailFrame')} src={assetUrl(list.thumbnailFrame.assetId)} style={saveRectStyle(list.thumbnailFrame)} alt="" draggable={false} />}
              {filled && sampleImage ? <img {...collectionPartProps(editing, component.id, 'thumbnail')} src={assetUrl(sampleImage.id)} style={{ ...rectStyle(save.thumbnail), objectFit: 'fill' }} alt="" draggable={false} /> : <div {...collectionPartProps(editing, component.id, 'thumbnail')} className="ui-slot-image" style={{ ...rectStyle(save.thumbnail), background: '#182227', fontSize: 18 * scale }}><span>{String(index + 1).padStart(2, '0')}</span></div>}
              {list?.showLabels !== false && list?.chapter && <span {...collectionPartProps(editing, component.id, 'chapter')} style={{ ...saveRectStyle(list.chapter), ...chapterText, overflow: 'hidden' }}>{filled ? sampleHeading : ''}</span>}
              {list?.showLabels !== false && list?.caption && <span {...collectionPartProps(editing, component.id, 'caption')} style={{ ...saveRectStyle(list.caption), ...captionText, overflowY: 'auto', overflowX: 'hidden', whiteSpace: 'pre-wrap' }}>{sampleCaption}</span>}
            </> : <img className="ui-skin-image" src={assetUrl(list.emptyAssetId)} alt="" draggable={false} />}
            {list?.number && numberRect && <span {...collectionPartProps(editing, component.id, 'number')} className="ui-slot-number" style={{ ...pixelStyle(numberRect, scale), ...numberText, display: 'flex', alignItems: 'center' }}><UiSkinImage skin={list.numberSkin} state="idle" assetUrl={assetUrl} scale={scale} /><span style={{ position: 'relative', width: '100%' }}>{autoSlot ? '自动' : fixedAuto ? `No. ${index}` : String(index + 1).padStart(2, '0')}</span></span>}
            {slotState !== 'idle' && list?.hoverOverlayId && <img className="ui-skin-image" src={assetUrl(list.hoverOverlayId)} alt="" draggable={false} />}
          </> : <span className="ui-collection-preview-track"><span>{state === 'disabled' && (!isStory || list?.lockUnread) ? component.kind === 'chapterList' ? '未解锁章节' : '未解锁' : entry.name + (isStory && list?.showProgress ? state === 'selected' ? ' · 当前' : ' · 已读' : '')}</span></span>}
        </div>
        {isSave && list?.slotAction && (filled || saveMode === 'save' && !autoSlot) && <span {...collectionPartProps(editing, component.id, 'slotAction', true, autoSlot ? 'load' : saveMode)} style={{ ...saveRectStyle(list.slotAction), display: 'grid', placeItems: 'center', color: '#ffffff', background: actionSkin?.idle ? undefined : '#11121b', fontSize: Math.max(1, Math.min(font, collectionPixelRect(list.slotAction, cellW, bodyH).height - 8)) * scale }}><UiSkinImage skin={actionSkin} state={state} assetUrl={assetUrl} scale={scale} />{!actionSkin?.hideText && <span style={{ position: 'relative' }}>{saveMode === 'load' || autoSlot ? '读取存档' : '保存存档'}</span>}</span>}
        {isSave && capHeight > 0 && <div className="ui-slot-caption" style={{ position: 'absolute', left: 0, bottom: 0, width: '100%', height: capHeight * scale, justifyContent: 'flex-start' }}>{list?.showLabels !== false && !list?.caption && <span {...collectionPartProps(editing, component.id, 'caption')} style={{ ...captionText, width: Math.max(1, cellW - (list?.showDelete !== false ? 60 : 0)) * scale, flexShrink: 0 }}>{filled ? '2026-09-10 12:00' : '空存档'}</span>}{list?.showDelete !== false && !autoSlot && <span style={{ width: Math.min(60, cellW) * scale, flexShrink: 0, fontSize: Math.min(18, font) * scale }}>删除</span>}</div>}
      </div>; })}
    </div>
    {!entries.length && <span className="ui-collection-empty">{isStory ? '暂无条目' : '暂无音乐'}</span>}
    {(isSave || rows > 0) && <div {...collectionPartProps(editing, component.id, 'navigationRect')} className="ui-collection-navigation" style={{ top: isSave || customNav ? nav.y * scale : undefined, bottom: isSave || customNav ? undefined : 0, left: isSave || customNav ? nav.x * scale : undefined, width: isSave || customNav ? nav.width * scale : undefined, gap: isSave || customNav ? navGap * scale : undefined, height: navHeight * scale, ...(save ? { ...navText, justifyContent: 'flex-start' } : { fontSize: (customNav ? component.style?.fontSize ?? 24 : Math.min(20, component.style?.fontSize ?? 20)) * scale }) }}>
      {navigationLabels.map(label => isSave || customNav ? <span key={label} style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', minWidth: 0, width: navWidth * scale, height: navHeight * scale, padding: 0, backgroundColor: list?.pageSkin?.idle ? undefined : component.style?.background ?? '#283133' }}><UiSkinImage skin={list?.pageSkin} state={state !== 'idle' ? state : label === '1' ? 'selected' : 'idle'} assetUrl={assetUrl} scale={scale} />{(!save || !list?.pageSkin?.hideText) && <span style={{ position: 'relative', ...(save ? { width: Math.max(1, navWidth - 16) * scale, textAlign: navText.textAlign } : {}), color: label === '1' ? list?.pageSelectedTextColor ?? (save ? navText.color : list?.pageTextColor) : save ? navText.color : list?.pageTextColor }}>{label}</span>}</span> : <span key={label}>{label}</span>)}
    </div>}
  </div>;
}

export function GalleryPreview({ project, component, assetUrl, scale, state, interaction }: { project: Project; component: UiComponent; assetUrl: AssetUrl; scale: number; state: UiButtonState; interaction?: { page: number; unlocks?: readonly string[]; values?: Record<string, import('../core/model').VariableValue>; onPage: (page: number) => void; onOpen: (groupId: string) => void } }) {
  const editing = useCollectionEditing();
  const [hover, setHover] = useState(''), [pressed, setPressed] = useState('');
  const geometry = galleryLayout(project, component), list = component.list;
  const entries = galleryEntries(project, component);
  const pages = Math.max(1, Math.ceil(entries.length / geometry.cells.length));
  const pagination = galleryPagination(pages, interaction?.page ?? 0, list?.galleryPageButtonLimit ?? 9);
  const navWidth = geometry.navigation.width * component.width * project.width;
  const pageGap = list?.pageGap ?? 8, pageFontSize = list?.pageFontSize ?? Math.min(component.style?.fontSize ?? 24, 24);
  const buttonWidth = list?.pageButtonWidth ?? Math.min(64, Math.max(20, Math.floor(navWidth / pagination.numbers.length) - pageGap));
  const buttonHeight = list?.pageButtonHeight ?? Math.min(57, geometry.navigation.height * component.height * project.height);
  const Card = interaction ? 'button' : 'div', Page = interaction ? 'button' : 'span';
  return <div className={'ui-gallery-layout' + (interaction ? ' ui-gallery-interactive' : '')} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
    {entries.slice(pagination.page * geometry.cells.length, (pagination.page + 1) * geometry.cells.length).map((entry, index) => {
      const locked = state === 'disabled' || !!interaction && !galleryUnlockedAssets(component, entry, interaction.unlocks, interaction.values).length;
      const hasUnderlay = locked && !!list?.lockedRect;
      const cardState = locked ? 'disabled' : pressed === entry.id ? 'pressed' : hover === entry.id ? 'hover' : state;
      return <Card key={entry.id} {...collectionPartProps(editing, component.id, 'item', !interaction)} type={interaction ? 'button' : undefined} disabled={interaction ? locked : undefined} aria-label={interaction ? (locked ? '未解锁图鉴 ' : '打开图鉴 ') + (entry.name || entry.id) : undefined} data-gallery-group={entry.id} data-gallery-index={index} style={{ ...rectStyle(geometry.cells[index]), padding: 0, border: 0, color: 'inherit', background: 'transparent', font: 'inherit' }} onClick={interaction ? () => interaction.onOpen(entry.id) : undefined} onMouseEnter={interaction ? () => setHover(entry.id) : undefined} onMouseLeave={interaction ? () => { setHover(''); setPressed(''); } : undefined} onFocus={interaction ? () => setHover(entry.id) : undefined} onBlur={interaction ? () => { setHover(''); setPressed(''); } : undefined} onMouseDown={interaction ? () => setPressed(entry.id) : undefined} onMouseUp={interaction ? () => setPressed('') : undefined}>
      {hasUnderlay && list?.lockedAssetId && <img {...collectionPartProps(editing, component.id, 'lockedRect', !interaction)} src={assetUrl(list.lockedAssetId)} style={rectStyle(geometry.locked)} alt="" draggable={false} />}
      <UiSkinImage skin={component.skin} state={cardState} assetUrl={assetUrl} scale={scale} />
      {list?.thumbnailFrame && <img {...collectionPartProps(editing, component.id, 'thumbnailFrame', !interaction)} src={assetUrl(list.thumbnailFrame.assetId)} style={rectStyle(list.thumbnailFrame)} alt="" draggable={false} />}
      {!locked && entry.thumbnailAssetId ? <img {...collectionPartProps(editing, component.id, 'thumbnail', !interaction)} data-gallery-thumbnail src={assetUrl(entry.thumbnailAssetId)} style={{ ...rectStyle(geometry.thumbnail), filter: list?.thumbnailBrightness?.[cardState] === undefined ? undefined : `brightness(${list.thumbnailBrightness[cardState]})`, objectFit: list?.thumbnailFit === 'stretch' ? 'fill' : list?.thumbnailFit ?? 'contain' }} alt="" draggable={false} /> : !hasUnderlay && list?.lockedAssetId ? <img {...collectionPartProps(editing, component.id, 'lockedRect', !interaction)} src={assetUrl(list.lockedAssetId)} style={{ ...rectStyle(geometry.locked), objectFit: 'contain' }} alt="" draggable={false} /> : !list?.lockedAssetId ? <span {...collectionPartProps(editing, component.id, locked ? 'lockedRect' : 'thumbnail', !interaction)} className="ui-collection-preview-track">{locked ? '未解锁' : '暂无分镜'}</span> : null}
      {!locked && list?.showLabels !== false && <span className="ui-collection-preview-caption">{entry.name}</span>}
      {cardState !== 'idle' && list?.hoverOverlayId && <img src={assetUrl(list.hoverOverlayId)} className="ui-skin-image" alt="" draggable={false} />}
    </Card>; })}
    {!entries.length && <span className="ui-collection-empty">暂无图片</span>}
    <div {...collectionPartProps(editing, component.id, 'navigationRect', !interaction)} data-gallery-pagination style={{ ...rectStyle(geometry.navigation), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: pageGap * scale, fontSize: pageFontSize * scale, fontFamily: list?.pageFontAssetId ? uiFontFamily(list.pageFontAssetId) : undefined, fontWeight: list?.pageBold ? 700 : 400 }}>{pagination.overflow && <Page disabled={interaction ? pagination.page === 0 : undefined} onClick={interaction ? () => interaction.onPage(pagination.page - 1) : undefined}>上一页</Page>}{pagination.numbers.map(index => <Page key={index} type={interaction ? 'button' : undefined} aria-label={interaction ? `图鉴第 ${index + 1} 页` : undefined} aria-current={interaction && index === pagination.page ? 'page' : undefined} onClick={interaction ? () => interaction.onPage(index) : undefined} data-gallery-page={index + 1} style={{ position: 'relative', flexShrink: 0, width: buttonWidth * scale, height: buttonHeight * scale, display: 'grid', placeItems: 'center', padding: 0, border: 0, background: 'transparent', font: 'inherit', color: 'inherit' }}><UiSkinImage skin={list?.pageSkin} state={!interaction && state !== 'idle' ? state : index === pagination.page ? 'selected' : 'idle'} assetUrl={assetUrl} scale={scale} />{!list?.pageSkin?.hideText && <span style={{ position: 'relative', color: index === pagination.page ? list?.pageSelectedTextColor ?? list?.pageTextColor : list?.pageTextColor }}>{index + 1}</span>}</Page>)}{pagination.overflow && <Page disabled={interaction ? pagination.page === pages - 1 : undefined} onClick={interaction ? () => interaction.onPage(pagination.page + 1) : undefined}>下一页</Page>}</div>
  </div>;
}

