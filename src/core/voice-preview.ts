import type { Project, UiComponent } from './model';
import { storyVoiceEntries, storyVoiceLogEntries, type VoiceLogEntry } from './story-menu';

export interface VoiceCollectionView { page: number; favoritesOnly: boolean }
export interface VoicePreviewState { favorites: string[]; logs?: Record<string, VoiceLogEntry>; serial: number; playback?: { assetId: string; entryId?: string; requestId: number; characterGain: number } }
export type VoicePreviewAction = { action: 'page'; page: number } | { action: 'filter' } | { action: 'stop' } | { action: 'play'; assetId: string } | { action: 'favorite'; assetId: string };
export const defaultVoiceRemoveMessage = '确定删除这条语音收藏吗？';
export const customVoiceItem = (component: UiComponent) => !!(component.list?.caption || component.list?.voiceFavoriteRect || component.list?.voiceSingleLine || component.list?.voiceCaptionMode === 'text');
export const removingVoiceFavorite = (_component: UiComponent, favoritesOnly: boolean) => favoritesOnly;
interface VoiceCollectionActionResult { state: VoicePreviewState; view: VoiceCollectionView; confirmation?: { message: string } }

export function voiceCollectionEntries(project: Project, state: VoicePreviewState): VoiceLogEntry[] {
 const snapshots = new Map(storyVoiceLogEntries(project).filter(entry => state.favorites.includes(entry.id)).map(entry => [entry.id, entry]));
 for (const entry of Object.values(state.logs ?? {})) if (state.favorites.includes(entry.id)) snapshots.set(entry.id, entry);
 return [...storyVoiceEntries(project), ...snapshots.values()];
}

export function toggleVoiceFavorite(state: VoicePreviewState, entry: VoiceLogEntry): VoicePreviewState {
 const favorite = state.favorites.includes(entry.id), logs = { ...state.logs };
 if (favorite) delete logs[entry.id];
 else if (entry.id !== entry.assetId) logs[entry.id] = { ...entry };
 return { ...state, logs, favorites: favorite ? state.favorites.filter(id => id !== entry.id) : [...state.favorites, entry.id] };
}

export function voiceCollectionView(project: Project, component: UiComponent, state: VoicePreviewState, saved?: VoiceCollectionView, unlocks?: readonly string[]) {
 const favoritesOnly = saved?.favoritesOnly ?? component.list?.favoritesOnly ?? false;
 const favorites = new Set(state.favorites), unlocked = unlocks && new Set(unlocks), allowed = component.list?.assetIds;
 const entries = voiceCollectionEntries(project, state).filter(entry => (!allowed || allowed.includes(entry.assetId)) && (!favoritesOnly || favorites.has(entry.id)));
 if (favoritesOnly && component.list?.voiceOrder === 'favorites') {
  const positions = new Map([...favorites].map((id, index) => [id, index]));
  entries.sort((a, b) => positions.get(a.id)! - positions.get(b.id)!);
 }
 const size = component.list?.rows ? component.list.rows * (component.list.columns ?? 1) : Math.max(1, entries.length);
 const pages = Math.max(1, Math.ceil(entries.length / size)), page = Math.min(pages - 1, Math.max(0, saved?.page ?? 0));
 return { page, pages, favoritesOnly, total: entries.length, entries: entries.slice(page * size, (page + 1) * size).map(entry => ({ ...entry, unlocked: project.assets.some(a => a.id === entry.assetId && a.kind === 'audio') && (!unlocked || unlocked.has(entry.assetId)), favorite: favorites.has(entry.id) })) };
}

export function voiceCollectionAction(project: Project, component: UiComponent, state: VoicePreviewState, saved: VoiceCollectionView | undefined, action: VoicePreviewAction, unlocks?: readonly string[], characterGain = 1, options: { confirmed?: boolean } = {}): VoiceCollectionActionResult {
 const current = voiceCollectionView(project, component, state, saved, unlocks), view = { page: current.page, favoritesOnly: current.favoritesOnly };
 if(component.kind !== 'voiceCollection')return {state,view};
 if(action.action === 'stop')return {state:{...state,playback:undefined},view};
 if(action.action === 'filter')return {state,view:{page:0,favoritesOnly:!view.favoritesOnly}};
 if(action.action === 'page')return {state,view:Number.isInteger(action.page)&&action.page>=0&&action.page<current.pages?{...view,page:action.page}:view};
 const entry=current.entries.find(entry=>entry.id===action.assetId);if(!entry)return {state,view};
 const remove=removingVoiceFavorite(component,view.favoritesOnly)&&action.action==='favorite';
 if(remove?!entry.favorite:!entry.unlocked)return {state,view};
 if(remove&&component.list?.voiceRemoveConfirm&&!options.confirmed)return {state,view,confirmation:{message:component.list.voiceRemoveMessage??defaultVoiceRemoveMessage}};
 if(action.action==='play')return {state:{...state,serial:state.serial+1,playback:{assetId:entry.assetId,entryId:entry.id,requestId:state.serial+1,characterGain}},view};
 const next={...toggleVoiceFavorite(state,entry),playback:remove&&(state.playback?.entryId??state.playback?.assetId)===entry.id?undefined:state.playback};
 return {state:next,view:{...view,page:voiceCollectionView(project,component,next,view,unlocks).page}};
}

/** Matches the generated collection's geometry in game pixels. */
export function voiceCollectionLayout(project: Project, component: UiComponent) {
 const list=component.list,w=component.width*project.width,h=component.height*project.height,columns=list?.columns??1,rows=list?.rows??0,font=component.style?.fontSize??project.ui.fontSize;
 const gapX=Math.min(Math.round(list?.gapX??12),Math.floor(w/(columns*2))),gapY=Math.round(list?.gapY??12);
 const cellW=Math.max(1,Math.min(Math.floor(list?.itemWidth??w),Math.floor((w-(columns-1)*gapX-(rows?0:16))/columns)));
 const navH=rows&&!list?.navigationRect?Math.min(40,Math.max(24,Math.floor(h*.1))):0,controlsH=list?.showVoiceControls!==false?Math.min(42,Math.floor(h*.12)):0;
 const top=controlsH?controlsH+gapY:0,viewH=Math.max(1,h-navH-(navH?gapY:0)-top);
 const cellH=Math.max(1,Math.round(list?.itemHeight??(rows?Math.max(32,Math.floor((viewH-(rows-1)*gapY)/rows)):Math.max(48,font+28))));
 const favoriteSize=Math.min(list?.voiceButtonSize??49,Math.floor(cellW/3));
 const rect=(r:{x:number;y:number;width:number;height:number},width:number,height:number)=>({x:Math.floor(r.x*width),y:Math.floor(r.y*height),width:Math.max(1,Math.floor(r.width*width)),height:Math.max(1,Math.floor(r.height*height))});
 const favorite=list?.voiceFavoriteRect?rect(list.voiceFavoriteRect,cellW,cellH):{x:cellW-favoriteSize,y:Math.floor((cellH-favoriteSize)/2),width:favoriteSize,height:favoriteSize};
 const caption=list?.caption?rect(list.caption,cellW,cellH):{x:8,y:0,width:Math.max(1,favorite.x-16),height:cellH};
 const navigation=list?.navigationRect?rect(list.navigationRect,w,h):{x:0,y:h-navH,width:w,height:navH};
 return {w,h,columns,rows,gapX,gapY,cellW,cellH,controlsH,controlsW:Math.max(1,Math.min(180,Math.floor((w-20)/2))),top,viewH,favorite,caption,navigation};
}
