import { flowNodeAppearance } from '../core/flow-style';
import { isStandaloneNode } from '../core/standalone-performance';
import { uiTextColor } from '../core/ui';
import { uiTextShadow, uiStateColor } from './UiAppearance';
import { UiHistoryPreview } from './UiHistoryPreview';
import { UiMusicCollectionPreview } from './UiMusicCollectionPreview';
import { UiVoiceCollectionPreview } from './UiVoiceCollectionPreview';
import { useState, type CSSProperties } from 'react';
import type { Project, UiButtonState, UiComponent } from '../core/model';
import { storyMenuEntries } from '../core/story-menu';
import type { AssetUrl } from './StageEditor';
import { UiSkinImage, uiFontFamily } from './UiAppearance';
import { galleryLayout } from '../core/gallery-layout';
import { galleryEntries, galleryPagination, galleryUnlockedAssets } from '../core/gallery';
import { UiFlowPreview } from './UiFlowPreview';

type Rect = { x: number; y: number; width: number; height: number };
const rectStyle = (r: Rect): CSSProperties => ({ position: 'absolute', left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.width * 100}%`, height: `${r.height * 100}%` });

export function UiCollectionPreview({ project, component, assetUrl, scale, state, filled = false, saveMode = 'load' }: { project: Project; component: UiComponent; assetUrl: AssetUrl; scale: number; state: UiButtonState; filled?: boolean; saveMode?: 'save' | 'load' }) {
  const list = component.list;
  if(component.kind === 'musicTrackList')return <UiMusicCollectionPreview project={project} component={component} assetUrl={assetUrl} scale={scale} state={state}/>;
  const isSave = component.kind === 'saveSlots';
  const isGallery = component.kind === 'galleryGrid';
  if(component.kind === 'voiceCollection')return <UiVoiceCollectionPreview project={project} component={component} assetUrl={assetUrl} scale={scale} state={state}/>;
  const isStory = component.kind === 'chapterList' || component.kind === 'flowchart';
  if (isGallery) return <GalleryPreview project={project} component={component} assetUrl={assetUrl} scale={scale} state={state} />;
  if (component.kind === 'flowchart' && list?.layout === 'flow') return <UiFlowPreview project={project} component={component} assetUrl={assetUrl} scale={scale} state={state} />;
  if (component.kind === 'historyList') return <UiHistoryPreview project={project} component={component} assetUrl={assetUrl} scale={scale} state={state} />;
  const columns = list?.columns ?? (isSave || isGallery ? 3 : 1);
  const rows = list?.rows ?? (isSave ? 2 : 0);
  const w = component.width * project.width;
  const h = component.height * project.height;
  const gapX = Math.min(list?.gapX ?? (isSave ? 10 : 12), w / (columns * 2));
  const gapY = list?.gapY ?? (isSave ? 10 : 12);
  const defaultNavHeight = isSave || rows ? Math.max(24, Math.min(40, h * 0.1)) : 0;
  const customNav = !!list?.navigationRect && (isSave || rows > 0);
  const nav = customNav && list?.navigationRect ? { x: list.navigationRect.x * w, y: list.navigationRect.y * h, width: list.navigationRect.width * w, height: list.navigationRect.height * h }
    : { x: 0, y: isSave && list?.navigation !== 'bottom' ? 0 : h - defaultNavHeight, width: w, height: defaultNavHeight };
  const fixedAuto = isSave && list?.fixedAutoSlot && columns * rows > 1;
  const pageLabels = Array.from({ length: list?.pageCount ?? 6 }, (_, i) => String(i + 1));
  const navigationLabels = isSave ? fixedAuto ? pageLabels : ['上一页', '自动', '快速', ...pageLabels, '下一页'] : customNav ? Array.from({ length: Math.max(1, Math.ceil((list?.assetIds?.length ?? project.assets.filter(a => a.kind === 'audio').length) / (rows * columns))) }, (_, i) => String(i + 1)) : ['上一页', '1 / 1', '下一页'];
  const navHeight = nav.height, navGap = customNav && !isSave ? 8 : Math.max(2, Math.min(8, Math.floor(nav.width / 150))), navWidth = customNav && !isSave ? Math.min(64, Math.max(20, Math.floor(nav.width / navigationLabels.length) - 8)) : Math.max(1, Math.floor((nav.width - (navigationLabels.length - 1) * navGap) / navigationLabels.length));
  const controlsHeight = 0;
  const gridTop = isSave ? list?.navigation === 'bottom' ? 0 : nav.y + navHeight + gapY : controlsHeight;
  const viewHeight = isSave ? Math.max(1, list?.navigation === 'bottom' ? nav.y - gapY : h - gridTop) : h - (customNav ? 0 : navHeight) - controlsHeight - (rows && !customNav ? gapY : 0);
  const cellW = Math.max(1, Math.min(list?.itemWidth ?? w, Math.floor((w - (columns - 1) * gapX - (isSave || rows ? 0 : 16)) / columns)));
  const cellH = isSave ? Math.max(1, Math.min(list?.itemHeight ?? h, Math.floor((viewHeight - (rows - 1) * gapY) / rows))) : list?.itemHeight ?? (rows ? Math.max(32, Math.floor((viewHeight - (rows - 1) * gapY) / rows)) : Math.max(48, (component.style?.fontSize ?? project.ui.fontSize) + 28));
  const entries = (isSave ? Array.from({ length: rows * columns }, (_, index) => ({ id: String(index), name: '空存档' })) :
    isStory ? storyMenuEntries(project, component.kind as 'chapterList' | 'flowchart') :
    (list?.assetIds ? list.assetIds.flatMap(id => { const asset = project.assets.find(a => a.id === id); return asset ? [asset] : []; }) : project.assets.filter(asset => asset.kind === (isGallery ? 'image' : 'audio')))).slice(0, rows ? rows * columns : 16);
  const capHeight = isSave && (list?.showDelete !== false || (!list?.caption && list?.showLabels !== false)) ? Math.max(18, Math.min(32, cellH * 0.2)) : 0;
  const bodyH = cellH - capHeight;
  const sampleImage = project.assets.find(asset => asset.kind === 'image');
  const sampleNode = project.nodes.find(node => node.kind === 'passage');
  const sampleText = project.nodes.flatMap(n => n.kind === 'passage' ? n.lines.filter(l => !l.silent).map(l => l.text) : []).slice(0, 5).join('\n\n');
  return <div className="ui-collection-preview">
    <div className="ui-collection-preview-grid" style={{ display: 'grid', position: 'absolute', top: gridTop * scale, left: isSave ? (w - (columns * cellW + (columns - 1) * gapX)) * scale / 2 : 0, gridTemplateColumns: `repeat(${columns}, ${cellW * scale}px)`, gridAutoRows: `${cellH * scale}px`, gap: `${gapY * scale}px ${gapX * scale}px`, maxHeight: viewHeight * scale }}>
      {entries.map((entry, index) => {
        const node = project.nodes.find(n => n.id === entry.id);
        const look = component.kind === 'flowchart' ? flowNodeAppearance(project, component, { styleId: 'styleId' in entry && typeof entry.styleId === 'string' ? entry.styleId : undefined, kind: node && isStandaloneNode(node) ? 'chapterTitle' : node?.kind }) : component;
        const hiddenCaption = component.kind === 'flowchart' && (look.skin?.hideText || state === 'disabled' && list?.lockUnread && look.skin?.disabled);
        return <div key={entry.id} className="ui-collection-preview-item" style={{ width: cellW * scale, height: cellH * scale }}>
        <div className="ui-collection-preview-surface" style={{ height: bodyH * scale, backgroundColor: look.skin?.idle ? undefined : uiStateColor(look, state), ...(component.kind === 'flowchart' ? { color: uiTextColor(look, project.ui, state), fontFamily: uiFontFamily(look.style?.fontAssetId ?? project.ui.fontAssetId), fontSize: (look.style?.fontSize ?? project.ui.fontSize) * scale, textShadow: uiTextShadow(look, scale), border: look.style?.borderWidth ? `${look.style.borderWidth * scale}px solid ${look.style.borderColor ?? '#ffffff'}` : undefined, opacity: look.style?.opacity ?? 1 } : {}) }}>
          <UiSkinImage skin={fixedAuto && index === 0 ? list?.autoSlotSkin ?? look.skin : look.skin} state={state} assetUrl={assetUrl} scale={scale} />
          {isSave ? <>
            {filled ? <>
              {list?.thumbnailFrame && <img src={assetUrl(list.thumbnailFrame.assetId)} style={rectStyle(list.thumbnailFrame)} alt="" draggable={false} />}
              {sampleImage && <img src={assetUrl(sampleImage.id)} style={{ ...rectStyle(list?.thumbnail ?? { x: 0.04, y: 0.04, width: 0.92, height: 0.9 }), objectFit: 'fill' }} alt="" draggable={false} />}
              {list?.chapter && <span style={{ ...rectStyle(list.chapter), overflow: 'hidden', textAlign: 'left' }}>{project.chapters[0]?.name ?? ''}</span>}
              {list?.caption && <span style={{ ...rectStyle(list.caption), overflow: 'hidden', textAlign: list.chapter ? 'left' : 'center', whiteSpace: 'pre-wrap', fontSize: (list.summaryFontSize ?? component.style?.fontSize ?? 24) * scale }}>{list.captionMode === 'story' ? `${list.chapter ? '' : (project.chapters[0]?.name ?? '') + '\n\n'}${sampleText}` : '2026-09-10\n12:00'}</span>}
            </> : list?.emptyAssetId ? <img className="ui-skin-image" src={assetUrl(list.emptyAssetId)} alt="" draggable={false} /> : <div className="ui-slot-image" style={{ ...rectStyle(list?.thumbnail ?? { x: 0.04, y: 0.04, width: 0.92, height: 0.9 }), background: '#182227' }}><span>{String(index + 1).padStart(2, '0')}</span></div>}
            {list?.number && <span className="ui-slot-number" style={{ ...rectStyle(list.number), color: list.numberTextColor }}><UiSkinImage skin={list.numberSkin} state="idle" assetUrl={assetUrl} scale={scale} /><span style={{ position: 'relative' }}>{fixedAuto ? index === 0 ? '自动' : `No. ${index}` : String(index + 1).padStart(2, '0')}</span></span>}
            {list?.slotAction && (filled || saveMode === 'save' && !(fixedAuto && index === 0)) && <span style={{ ...rectStyle(list.slotAction), display: 'grid', placeItems: 'center', color: '#ffffff', background: list.slotActionSkin?.idle ? undefined : '#11121b' }}><UiSkinImage skin={saveMode === 'save' && !(fixedAuto && index === 0) ? list.slotSaveSkin ?? list.slotActionSkin : list.slotActionSkin} state={state} assetUrl={assetUrl} scale={scale} />{!(saveMode === 'save' && !(fixedAuto && index === 0) ? list.slotSaveSkin ?? list.slotActionSkin : list.slotActionSkin)?.hideText && <span style={{ position: 'relative' }}>{saveMode === 'load' || fixedAuto && index === 0 ? '读取存档' : '保存存档'}</span>}</span>}
            {state !== 'idle' && list?.hoverOverlayId && <img className="ui-skin-image" src={assetUrl(list.hoverOverlayId)} alt="" draggable={false} />}
          </> : isGallery ? <>
            <img src={assetUrl(state === 'disabled' && list?.lockedAssetId ? list.lockedAssetId : entry.id)} alt="" className="ui-gallery-preview-image" draggable={false} style={{ bottom: list?.showLabels === false ? 8 * scale : (component.style?.fontSize ?? 24) * scale + 12 * scale }} />
            {list?.showLabels !== false && <span className="ui-collection-preview-caption">{state === 'disabled' ? '未解锁' : entry.name}</span>}
          </> : !hiddenCaption && <span className="ui-collection-preview-track"><span>{state === 'disabled' && (!isStory || list?.lockUnread) ? component.kind === 'chapterList' ? '未解锁章节' : '未解锁' : entry.name + (isStory && list?.showProgress ? state === 'selected' ? ' · 当前' : ' · 已读' : '')}</span></span>}
        </div>
        {isSave && capHeight > 0 && <div className="ui-slot-caption" style={{ height: capHeight * scale, fontSize: Math.min(20, cellW / 15) * scale }}>{list?.showLabels !== false && <span>空存档</span>}{list?.showDelete !== false && <span>删除</span>}</div>}
      </div>; })}
    </div>
    {!entries.length && <span className="ui-collection-empty">{isGallery ? '暂无图片' : isStory ? '暂无条目' : '暂无音乐'}</span>}
    {(isSave || rows > 0) && <div className="ui-collection-navigation" style={{ top: isSave || customNav ? nav.y * scale : undefined, bottom: isSave || customNav ? undefined : 0, left: isSave || customNav ? nav.x * scale : undefined, width: isSave || customNav ? nav.width * scale : undefined, gap: isSave || customNav ? navGap * scale : undefined, height: navHeight * scale, fontSize: (customNav && !isSave ? component.style?.fontSize ?? 24 : fixedAuto ? Math.min(44, navHeight - 2, navWidth - 12) : isSave ? Math.max(8, Math.min(20, component.style?.fontSize ?? 20, (navWidth - 16) / 3)) : Math.min(20, component.style?.fontSize ?? 20)) * scale }}>
      {navigationLabels.map(label => isSave || customNav ? <span key={label} style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', minWidth: 0, width: navWidth * scale, height: navHeight * scale, padding: 0, backgroundColor: list?.pageSkin?.idle ? undefined : component.style?.background ?? '#283133' }}><UiSkinImage skin={list?.pageSkin} state={label === '1' ? 'selected' : 'idle'} assetUrl={assetUrl} scale={scale} /><span style={{ position: 'relative', color: label === '1' ? list?.pageSelectedTextColor ?? list?.pageTextColor : list?.pageTextColor }}>{label}</span></span> : <span key={label}>{label}</span>)}
    </div>}
  </div>;
}

export function GalleryPreview({ project, component, assetUrl, scale, state, interaction }: { project: Project; component: UiComponent; assetUrl: AssetUrl; scale: number; state: UiButtonState; interaction?: { page: number; unlocks?: readonly string[]; values?: Record<string, import('../core/model').VariableValue>; onPage: (page: number) => void; onOpen: (groupId: string) => void } }) {
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
      return <Card key={entry.id} type={interaction ? 'button' : undefined} disabled={interaction ? locked : undefined} aria-label={interaction ? (locked ? '未解锁图鉴 ' : '打开图鉴 ') + (entry.name || entry.id) : undefined} data-gallery-group={entry.id} data-gallery-index={index} style={{ ...rectStyle(geometry.cells[index]), padding: 0, border: 0, color: 'inherit', background: 'transparent', font: 'inherit' }} onClick={interaction ? () => interaction.onOpen(entry.id) : undefined} onMouseEnter={interaction ? () => setHover(entry.id) : undefined} onMouseLeave={interaction ? () => { setHover(''); setPressed(''); } : undefined} onFocus={interaction ? () => setHover(entry.id) : undefined} onBlur={interaction ? () => { setHover(''); setPressed(''); } : undefined} onMouseDown={interaction ? () => setPressed(entry.id) : undefined} onMouseUp={interaction ? () => setPressed('') : undefined}>
      {hasUnderlay && list?.lockedAssetId && <img src={assetUrl(list.lockedAssetId)} style={rectStyle(geometry.locked)} alt="" draggable={false} />}
      <UiSkinImage skin={component.skin} state={cardState} assetUrl={assetUrl} scale={scale} />
      {list?.thumbnailFrame && <img src={assetUrl(list.thumbnailFrame.assetId)} style={rectStyle(list.thumbnailFrame)} alt="" draggable={false} />}
      {!locked && entry.thumbnailAssetId ? <img data-gallery-thumbnail src={assetUrl(entry.thumbnailAssetId)} style={{ ...rectStyle(geometry.thumbnail), filter: list?.thumbnailBrightness?.[cardState] === undefined ? undefined : `brightness(${list.thumbnailBrightness[cardState]})`, objectFit: list?.thumbnailFit === 'stretch' ? 'fill' : list?.thumbnailFit ?? 'contain' }} alt="" draggable={false} /> : !hasUnderlay && list?.lockedAssetId ? <img src={assetUrl(list.lockedAssetId)} style={{ ...rectStyle(geometry.locked), objectFit: 'contain' }} alt="" draggable={false} /> : !list?.lockedAssetId ? <span className="ui-collection-preview-track">{locked ? '未解锁' : '暂无分镜'}</span> : null}
      {!locked && list?.showLabels !== false && <span className="ui-collection-preview-caption">{entry.name}</span>}
      {cardState !== 'idle' && list?.hoverOverlayId && <img src={assetUrl(list.hoverOverlayId)} className="ui-skin-image" alt="" draggable={false} />}
    </Card>; })}
    {!entries.length && <span className="ui-collection-empty">暂无图片</span>}
    <div data-gallery-pagination style={{ ...rectStyle(geometry.navigation), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: pageGap * scale, fontSize: pageFontSize * scale, fontFamily: list?.pageFontAssetId ? uiFontFamily(list.pageFontAssetId) : undefined, fontWeight: list?.pageBold ? 700 : 400 }}>{pagination.overflow && <Page disabled={interaction ? pagination.page === 0 : undefined} onClick={interaction ? () => interaction.onPage(pagination.page - 1) : undefined}>上一页</Page>}{pagination.numbers.map(index => <Page key={index} type={interaction ? 'button' : undefined} aria-label={interaction ? `图鉴第 ${index + 1} 页` : undefined} aria-current={interaction && index === pagination.page ? 'page' : undefined} onClick={interaction ? () => interaction.onPage(index) : undefined} data-gallery-page={index + 1} style={{ position: 'relative', flexShrink: 0, width: buttonWidth * scale, height: buttonHeight * scale, display: 'grid', placeItems: 'center', padding: 0, border: 0, background: 'transparent', font: 'inherit', color: 'inherit' }}><UiSkinImage skin={list?.pageSkin} state={index === pagination.page ? 'selected' : 'idle'} assetUrl={assetUrl} scale={scale} /><span style={{ position: 'relative', color: index === pagination.page ? list?.pageSelectedTextColor ?? list?.pageTextColor : list?.pageTextColor }}>{index + 1}</span></Page>)}{pagination.overflow && <Page disabled={interaction ? pagination.page === pages - 1 : undefined} onClick={interaction ? () => interaction.onPage(pagination.page + 1) : undefined}>下一页</Page>}</div>
  </div>;
}

