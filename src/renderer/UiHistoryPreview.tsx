import { uiComponentTheme } from '../core/ui-page-settings';
import { useEffect, useRef, useState } from 'react';
import type { Project, UiButtonState, UiComponent } from '../core/model';
import type { UiLayoutGeometry } from '../core/ui-layout';
import { historyPreviewView, type HistoryPreviewAction } from '../core/history-preview';
import { uiComponentBounds, uiComponentFontSize, uiSkinAsset } from '../core/ui';
import { collectionTextStyle } from '../core/ui-collection-text';
import { collectionPixelRect } from '../core/ui-collection-layout';
import { UiSkinImage, uiFontFamily } from './UiAppearance';
import { FlowScrollbar } from './UiFlowPreview';
import type { AssetUrl } from './StageEditor';
import { collectionPartProps, useCollectionEditing } from './UiCollectionEditing';

export function UiHistoryPreview({ project, component, geometry, assetUrl, scale, state, native = false, interaction }: {
 project: Project; component: UiComponent; geometry?: UiLayoutGeometry; assetUrl: AssetUrl; scale: number; state: UiButtonState; native?: boolean;
 interaction?: { entries: ReturnType<typeof historyPreviewView>; onAction: (action: HistoryPreviewAction) => void };
}) {
 const editing = useCollectionEditing();
 project = { ...project, ui: uiComponentTheme(project, component) };
 const entries = interaction?.entries ?? historyPreviewView(project, { favorites: [], serial: 0 }), list = component.list, columns = list?.historyLayout === 'columns';
 const bounds = uiComponentBounds(component, project.width, project.height);
 const gap = Math.min(Math.trunc((list?.gapX ?? 12) + .5), Math.max(0, Math.trunc(bounds.width / ((list?.columns ?? 1) * 2)))) * scale;
 const size = list?.voiceButtonSize ?? 49, font = uiComponentFontSize(component, project.ui, project.width, project.height);
 const nameWidth = Math.min(Math.trunc(list?.historyNameWidth ?? 165), Math.max(40, Math.trunc(bounds.width * .25))) * scale;
 const nameText = collectionTextStyle(project, component, 'historyName'), bodyText = collectionTextStyle(project, component, 'historyText');
 const bar = list?.historyScrollbar;
 const scrollbarRect = bar ? collectionPixelRect(bar.rect, bounds.width, bounds.height) : undefined;
 const [scroll, setScroll] = useState({ value: 0, page: 0, range: 0 });
 const measure = () => {
  const e = viewport.current;
  if (!e) return;
  const value = e.scrollTop / scale, page = e.clientHeight / scale, range = Math.max(0, e.scrollHeight - e.clientHeight) / scale;
  setScroll(previous => previous.value === value && previous.page === page && previous.range === range ? previous : { value, page, range });
 };
 const viewport = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null), followBottom = useRef(true), identities = entries.map(line => line.id).join(':');
 const [hover, setHover] = useState(''), [pressed, setPressed] = useState(''), Button = interaction ? 'button' : 'span';
 useEffect(() => { followBottom.current = true; if (interaction && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; }, [identities, !!interaction]);
 useEffect(() => {
  if (!viewport.current || !content.current) return;
  const observer = new ResizeObserver(() => { if (followBottom.current && interaction && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; measure(); });
  observer.observe(viewport.current); observer.observe(content.current); return () => observer.disconnect();
 }, [!!interaction, scale]);
 const control = (entry: typeof entries[number], action: HistoryPreviewAction['action']) => {
  const id = entry.id + ':' + action, label = action === 'play' ? '重播语音' : entry.favorite ? '取消收藏' : '收藏语音', selected = action === 'play' ? entry.playing : entry.favorite;
  const visual = !interaction && !native && state !== 'idle' ? state : !entry.available || state === 'disabled' ? 'disabled' : pressed === id ? 'pressed' : selected ? 'selected' : hover === id ? 'hover' : state;
  const skin = action === 'play' ? list?.voiceReplaySkin : list?.voiceFavoriteSkin;
  return <Button key={id} {...collectionPartProps(editing, component.id, action === 'play' ? 'voiceReplay' : 'voiceFavoriteRect', !interaction && !native)} type={interaction ? 'button' : undefined} data-history-control={id} aria-label={interaction ? label + ' ' + entry.text : undefined} aria-pressed={interaction ? selected : undefined} disabled={interaction ? !entry.available || state === 'disabled' : undefined}
   onClick={interaction ? () => interaction.onAction({ action, lineId: entry.id }) : undefined} onMouseEnter={() => setHover(id)} onMouseLeave={() => { setHover(''); setPressed(''); }} onMouseDown={() => setPressed(id)} onMouseUp={() => setPressed('')} onFocus={() => setHover(id)} onBlur={() => { setHover(''); setPressed(''); }}
   style={{ position: 'relative', display: 'inline-flex', flex: 'none', alignItems: 'center', justifyContent: 'center', width: (native ? label.length * Math.min(font, 24) + 16 : size) * scale, height: (native ? Math.ceil(Math.min(font, 24) * 1.4) + 8 : size) * scale, padding: 0, border: 0, borderRadius: 0, font: 'inherit', fontSize: (native ? Math.min(font, 24) : Math.min(font, 18)) * scale, color: 'inherit', background: uiSkinAsset(skin, visual) ? 'transparent' : visual === 'disabled' ? '#393e3b' : selected || visual === 'hover' ? '#586157' : 'transparent' }}>
   <UiSkinImage skin={skin} state={visual} assetUrl={assetUrl} scale={scale}/>{!skin?.hideText && <span style={{ position: 'relative', textAlign: 'center' }}>{label}</span>}
  </Button>;
 };
 return <div style={{ position: 'relative', width: '100%', height: '100%' }}><div ref={viewport} className="ui-history-preview" data-history-viewport onScroll={e => { const element = e.currentTarget; followBottom.current = element.scrollHeight - element.clientHeight - element.scrollTop < 3; measure(); }} style={{ position: 'relative', width: '100%', height: '100%', overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: bar ? 'none' : undefined, textAlign: 'left' }}>
  <div ref={content} style={{ display: 'flex', flexDirection: 'column', gap: Math.trunc((list?.gapY ?? 12) + .5) * scale }}>
   {!entries.length && <span>暂无对话记录</span>}
   {entries.map(entry => <div key={entry.id} {...collectionPartProps(editing, component.id, 'item', !interaction && !native)} data-line-id={entry.id} style={{ position: 'relative', flex: 'none', padding: native ? `${6 * scale}px 0` : `${(list?.historyPaddingY ?? 12) * scale}px ${18 * scale}px`, marginRight: bar ? 0 : 20 * scale, background: native || component.skin?.idle ? undefined : component.style?.background ?? (columns ? 'transparent' : '#283133') }}>
    <UiSkinImage skin={component.skin} state="idle" assetUrl={assetUrl} scale={scale}/>
    <div style={{ position: 'relative', display: columns ? 'flex' : 'block', minHeight: columns ? (list?.historyRowHeight ?? size) * scale : undefined, gap, lineHeight: 1.5, fontWeight: list?.historyBold ? 700 : undefined, letterSpacing: (list?.historyLetterSpacing ?? 0) * scale }}>
     {(columns || entry.speaker) && <span {...collectionPartProps(editing, component.id, 'historyName', !interaction && !native)} data-history-speaker style={{ display: 'block', width: columns ? nameWidth : '100%', textAlign: nameText.align, fontFamily: uiFontFamily(nameText.fontAssetId), fontSize: nameText.fontSize * scale, flexShrink: 0, overflowWrap: 'anywhere', color: native ? list?.textStyles?.historyName?.textColor ?? entry.speakerColor ?? project.ui.accent : nameText.textColor }}>{entry.speaker}</span>}
     {columns && <span style={{ display: 'flex', flexShrink: 0, width: size * 2 * scale + gap, gap }}>{entry.voiceId && <>{control(entry, 'play')}{control(entry, 'favorite')}</>}</span>}
     <span {...collectionPartProps(editing, component.id, 'historyText', !interaction && !native)} data-history-text style={{ display: 'block', flex: 1, minWidth: 0, width: columns || native ? undefined : Math.max(1, bounds.width - 60) * scale, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', textAlign: bodyText.align, fontFamily: uiFontFamily(bodyText.fontAssetId), fontSize: bodyText.fontSize * scale, color: bodyText.textColor }}>{entry.text}</span>
     {!columns && entry.voiceId && <span style={{ display: 'flex', gap: native ? 15 * scale : gap, marginTop: 6 * scale }}>{control(entry, 'play')}{control(entry, 'favorite')}</span>}
    </div>
   </div>)}
  </div>
 </div>{bar && scrollbarRect && <div {...collectionPartProps(editing, component.id, 'historyScrollbar', !interaction && !native)} style={{ position: 'absolute', left: scrollbarRect.x * scale, top: scrollbarRect.y * scale, width: scrollbarRect.width * scale, height: scrollbarRect.height * scale }}><FlowScrollbar rect={{ ...scrollbarRect, x: 0, y: 0 }} coordinateRect={scrollbarRect} geometry={geometry} ownerId={component.id} {...scroll} onChange={value => { if (viewport.current) { viewport.current.scrollTop = value * scale; measure(); } }} vertical trackWidth={Math.max(1, Math.trunc(bar.trackWidth ?? 5))} trackId={bar.trackId} skin={bar.thumb} scale={scale} state={state === 'selected' ? 'idle' : state} previewState={!interaction && !native ? state === 'selected' ? 'idle' : state : undefined} assetUrl={assetUrl} colors={{ track: '#777777', idle: '#dddddd', hover: '#ffffff', pressed: '#c9c0aa', disabled: '#626b68' }} label="历史对话滚动条" /></div>}</div>;
}
