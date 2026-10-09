import { useEffect, useRef, useState } from 'react';
import type { Project, UiButtonState, UiComponent } from '../core/model';
import { historyPreviewView, type HistoryPreviewAction } from '../core/history-preview';
import { uiSkinAsset } from '../core/ui';
import { UiSkinImage } from './UiAppearance';
import { FlowScrollbar } from './UiFlowPreview';
import type { AssetUrl } from './StageEditor';

export function UiHistoryPreview({ project, component, assetUrl, scale, state, native = false, interaction }: {
 project: Project; component: UiComponent; assetUrl: AssetUrl; scale: number; state: UiButtonState; native?: boolean;
 interaction?: { entries: ReturnType<typeof historyPreviewView>; onAction: (action: HistoryPreviewAction) => void };
}) {
 const entries = interaction?.entries ?? historyPreviewView(project, { favorites: [], serial: 0 }), list = component.list, columns = list?.historyLayout === 'columns';
 const gap = (list?.gapX ?? 12) * scale, size = list?.voiceButtonSize ?? 49, font = component.style?.fontSize ?? project.ui.fontSize;
 const nameWidth = Math.min(list?.historyNameWidth ?? 165, Math.max(40, component.width * project.width * .25)) * scale;
 const bar = list?.historyScrollbar;
 const [scroll, setScroll] = useState({ value: 0, page: 0, range: 0 });
 const measure = () => { const e = viewport.current; if (e) setScroll({ value: e.scrollTop / scale, page: e.clientHeight / scale, range: Math.max(0, e.scrollHeight - e.clientHeight) / scale }); };
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
  const visual = !entry.available || state === 'disabled' ? 'disabled' : pressed === id ? 'pressed' : selected ? 'selected' : hover === id ? 'hover' : state;
  const skin = action === 'play' ? list?.voiceReplaySkin : list?.voiceFavoriteSkin;
  return <Button key={id} type={interaction ? 'button' : undefined} data-history-control={id} aria-label={interaction ? label + ' ' + entry.text : undefined} aria-pressed={interaction ? selected : undefined} disabled={interaction ? !entry.available || state === 'disabled' : undefined}
   onClick={interaction ? () => interaction.onAction({ action, lineId: entry.id }) : undefined} onMouseEnter={() => setHover(id)} onMouseLeave={() => { setHover(''); setPressed(''); }} onMouseDown={() => setPressed(id)} onMouseUp={() => setPressed('')} onFocus={() => setHover(id)} onBlur={() => { setHover(''); setPressed(''); }}
   style={{ position: 'relative', display: 'inline-flex', flex: 'none', alignItems: 'center', justifyContent: 'center', width: (native ? label.length * Math.min(font, 24) + 16 : size) * scale, height: (native ? Math.ceil(Math.min(font, 24) * 1.4) + 8 : size) * scale, padding: 0, border: 0, borderRadius: 0, font: 'inherit', fontSize: (native ? Math.min(font, 24) : Math.min(font, 18)) * scale, color: 'inherit', background: uiSkinAsset(skin, visual) ? 'transparent' : visual === 'disabled' ? '#393e3b' : selected || visual === 'hover' ? '#586157' : 'transparent' }}>
   <UiSkinImage skin={skin} state={visual} assetUrl={assetUrl} scale={scale}/>{!skin?.hideText && <span style={{ position: 'relative', textAlign: 'center' }}>{label}</span>}
  </Button>;
 };
 return <div style={{ position: 'relative', width: '100%', height: '100%' }}><div ref={viewport} className="ui-history-preview" data-history-viewport onScroll={e => { const element = e.currentTarget; followBottom.current = element.scrollHeight - element.clientHeight - element.scrollTop < 3; measure(); }} style={{ position: 'relative', width: '100%', height: '100%', overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: bar ? 'none' : undefined, textAlign: 'left' }}>
  <div ref={content} style={{ display: 'flex', flexDirection: 'column', gap: (list?.gapY ?? 12) * scale }}>
   {!entries.length && <span>暂无对话记录</span>}
   {entries.map(entry => <div key={entry.id} data-line-id={entry.id} style={{ position: 'relative', flex: 'none', padding: native ? `${6 * scale}px 0` : `${(list?.historyPaddingY ?? 12) * scale}px ${18 * scale}px`, marginRight: bar ? 0 : 20 * scale, background: native || component.skin?.idle ? undefined : component.style?.background ?? (columns ? 'transparent' : '#283133') }}>
    <UiSkinImage skin={component.skin} state="idle" assetUrl={assetUrl} scale={scale}/>
    <div style={{ position: 'relative', display: columns ? 'flex' : 'block', minHeight: columns ? (list?.historyRowHeight ?? size) * scale : undefined, gap, lineHeight: 1.5, fontWeight: list?.historyBold ? 700 : undefined, letterSpacing: (list?.historyLetterSpacing ?? 0) * scale }}>
     {(columns || entry.speaker) && <span data-history-speaker style={{ display: 'block', width: columns ? nameWidth : undefined, textAlign: columns ? 'right' : undefined, fontSize: (list?.historyNameFontSize ?? font) * scale, flexShrink: 0, overflowWrap: 'anywhere', color: native ? entry.speakerColor ?? project.ui.accent : undefined }}>{entry.speaker}</span>}
     {columns && <span style={{ display: 'flex', flexShrink: 0, width: size * 2 * scale + gap, gap }}>{entry.voiceId && <>{control(entry, 'play')}{control(entry, 'favorite')}</>}</span>}
     <span data-history-text style={{ display: 'block', flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{entry.text}</span>
     {!columns && entry.voiceId && <span style={{ display: 'flex', gap: native ? 15 * scale : gap, marginTop: 6 * scale }}>{control(entry, 'play')}{control(entry, 'favorite')}</span>}
    </div>
   </div>)}
  </div>
 </div>{bar && <FlowScrollbar rect={{ x: bar.rect.x * component.width * project.width, y: bar.rect.y * component.height * project.height, width: bar.rect.width * component.width * project.width, height: bar.rect.height * component.height * project.height }} {...scroll} onChange={value => { if (viewport.current) viewport.current.scrollTop = value * scale; }} vertical trackWidth={bar.trackWidth ?? 5} trackId={bar.trackId} skin={bar.thumb} scale={scale} state={state} assetUrl={assetUrl} label="历史对话滚动条" />}</div>;
}
