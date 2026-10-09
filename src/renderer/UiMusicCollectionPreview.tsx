import { useState, type CSSProperties } from 'react';
import type { Project, UiComponent, UiButtonState } from '../core/model';
import { musicCollectionLayout, musicCollectionView } from '../core/music-preview';
import { uiSkinAsset } from '../core/ui';
import { UiSkinImage } from './UiAppearance';
import type { AssetUrl } from './StageEditor';

export function UiMusicCollectionPreview({ project, component, assetUrl, scale, state, interaction }: {
 project: Project; component: UiComponent; assetUrl: AssetUrl; scale: number; state: UiButtonState;
 interaction?: { view: ReturnType<typeof musicCollectionView>; playingId?: string; onPage: (page: number) => void; onPlay: (id: string) => void };
}) {
 const geometry = musicCollectionLayout(project, component), view = interaction?.view ?? musicCollectionView(project, component), list = component.list;
 const [hover, setHover] = useState(''), [pressed, setPressed] = useState(''), Button = interaction ? 'button' : 'span';
 const draw = (id: string, label: string, caption: string, skin: UiComponent['skin'], style: CSSProperties, onClick: () => void, disabled = false, selected = false) => {
  const visual = disabled || state === 'disabled' ? 'disabled' : pressed === id ? 'pressed' : selected ? 'selected' : hover === id ? 'hover' : state;
  return <Button key={id} type={interaction ? 'button' : undefined} aria-label={interaction ? label : undefined} disabled={interaction ? disabled || state === 'disabled' : undefined} aria-pressed={interaction && id.startsWith('track:') ? selected : undefined} aria-current={interaction && id.startsWith('page:') && selected ? 'page' : undefined} data-music-control={id}
   onClick={interaction ? onClick : undefined} onMouseEnter={() => setHover(id)} onMouseLeave={() => { setHover(''); setPressed(''); }} onMouseDown={() => setPressed(id)} onMouseUp={() => setPressed('')} onFocus={() => setHover(id)} onBlur={() => { setHover(''); setPressed(''); }}
   style={{ position: 'relative', display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: 0, font: 'inherit', color: 'inherit', flexShrink: 0, ...style, background: uiSkinAsset(skin, visual) ? 'transparent' : visual === 'disabled' ? '#393e3b' : visual === 'selected' || visual === 'hover' ? '#586157' : component.style?.background ?? '#283133' }}>
   <UiSkinImage skin={skin} state={visual} assetUrl={assetUrl} scale={scale}/>{!skin?.hideText && <span style={{ position: 'relative', maxWidth: '100%', padding: 4 * scale, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{caption}</span>}
  </Button>;
 };
 const { navigation: nav } = geometry;
 return <div className="ui-music-collection-preview" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
  <div data-music-viewport style={{ height: geometry.viewH * scale, overflowY: 'auto' }}><div style={{ display: 'grid', gridTemplateColumns: `repeat(${geometry.columns}, ${geometry.cellW * scale}px)`, gridAutoRows: geometry.cellH * scale, columnGap: geometry.gapX * scale, rowGap: geometry.gapY * scale }}>
   {view.entries.map(entry => draw('track:' + entry.id, (entry.unlocked ? '播放音乐 ' : '未解锁音乐 ') + entry.name, entry.unlocked && state !== 'disabled' ? entry.name : '未解锁', component.skin, { width: geometry.cellW * scale, height: geometry.cellH * scale }, () => interaction?.onPlay(entry.id), !entry.unlocked, interaction?.playingId === entry.id))}
  </div>{!view.total && <span>暂无音乐</span>}</div>
  {!!geometry.rows && <div data-music-pagination style={{ position: 'absolute', left: nav.x * scale, top: nav.y * scale, width: nav.width * scale, height: nav.height * scale, display: 'flex', alignItems: 'center', justifyContent: list?.navigationRect ? 'flex-start' : 'center', gap: 8 * scale, fontSize: (list?.navigationRect ? component.style?.fontSize ?? project.ui.fontSize : Math.min(22, component.style?.fontSize ?? project.ui.fontSize)) * scale }}>
   {list?.navigationRect ? Array.from({ length: view.pages }, (_, page) => draw('page:' + page, `音乐第 ${page + 1} 页`, String(page + 1), list.pageSkin, { width: Math.min(64, Math.max(20, Math.floor(nav.width / view.pages) - 8)) * scale, height: '100%', color: page === view.page ? list.pageSelectedTextColor ?? list.pageTextColor : list.pageTextColor }, () => interaction?.onPage(page), false, page === view.page)) : <>
    {draw('previous', '上一页', '上一页', undefined, { height: '100%' }, () => interaction?.onPage(view.page - 1), view.page === 0)}
    <span aria-label="音乐页码">{view.page + 1} / {view.pages}</span>
    {draw('next', '下一页', '下一页', undefined, { height: '100%' }, () => interaction?.onPage(view.page + 1), view.page === view.pages - 1)}
   </>}
  </div>}
 </div>;
}
