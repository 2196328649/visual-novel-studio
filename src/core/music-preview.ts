import { projectGraphs } from './project-resources';
import { effectiveScene, effectiveUiComponents, type Project, type UiComponent } from './model';
import { expandStageAction } from './text-script';

/** The same playlist is used by the compiled music room and the editor. */
export function musicRoomEntries(project: Project, components = effectiveUiComponents(project.ui)) {
 const entries = project.scenes.flatMap(scene => (effectiveScene(project, scene.id)?.entryActions ?? []).flatMap(action => expandStageAction(project, action)));
 const lines = project.nodes.flatMap(node => node.kind === 'passage' ? node.lines.flatMap(line => line.actions.flatMap(action => expandStageAction(project, action))) : []);
 const blueprintIds = projectGraphs(project).flatMap(graph => graph.nodes.filter(node => node.type === 'playMusic').flatMap(node =>
  graph.links.some(link => link.toNodeId === node.id && link.toPinId === 'assetId') ? project.assets.filter(a => a.kind === 'audio').map(a => a.id) : typeof node.properties.assetId === 'string' ? [node.properties.assetId] : []));
 const ids = new Set([...entries, ...lines].flatMap(action => action.kind === 'music' ? [action.assetId] : []).concat(blueprintIds, components.filter(c => c.kind === 'musicTrackList').flatMap(c => c.list?.assetIds ?? [])));
 return project.assets.filter(asset => asset.kind === 'audio' && ids.has(asset.id));
}

export interface MusicPreviewState {
 serial: number; loop: boolean; shuffle: boolean; order?: string[];
 playback?: { assetId: string; requestId: number; paused: boolean };
}
export type MusicControl = 'musicPrevious' | 'musicNext' | 'musicPlayPause' | 'musicStop' | 'musicLoop' | 'musicShuffle';
export const isMusicControl = (action?: string): action is MusicControl => ['musicPrevious','musicNext','musicPlayPause','musicStop','musicLoop','musicShuffle'].includes(action ?? '');

export function musicCollectionView(project: Project, component: UiComponent, page = 0, unlocks?: readonly string[], playlist = musicRoomEntries(project)) {
 const entries = component.list?.assetIds ? component.list.assetIds.flatMap(id => { const entry = playlist.find(a => a.id === id); return entry ? [entry] : []; }) : playlist;
 const size = component.list?.rows ? component.list.rows * (component.list.columns ?? 1) : Math.max(1, entries.length);
 const pages = Math.max(1, Math.ceil(entries.length / size)), current = Math.min(pages - 1, Math.max(0, Number.isInteger(page) ? page : 0));
 return { page: current, pages, total: entries.length, entries: entries.slice(current * size, (current + 1) * size).map(entry => ({ ...entry, unlocked: !unlocks || unlocks.includes(entry.id) })) };
}

// Seeded shuffling keeps replaying an event log stable as other controls change.
function shuffled(ids: string[], seed: number, first?: string) {
 const result = ids.filter(id => id !== first); let value = seed + 12345;
 for (let i = result.length - 1; i > 0; i--) { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; const j = value % (i + 1); [result[i], result[j]] = [result[j], result[i]]; }
 return first && ids.includes(first) ? [first, ...result] : result;
}

export function musicPreviewAction(state: MusicPreviewState, ids: string[], action: MusicControl | 'play' | 'ended', assetId?: string): MusicPreviewState {
 if (action === 'musicStop') return { ...state, playback: undefined };
 if (action === 'musicLoop') return { ...state, loop: !state.loop };
 if (action === 'musicPlayPause') return state.playback ? { ...state, playback: { ...state.playback, paused: !state.playback.paused } } : state;
 if (action === 'musicShuffle') return { ...state, shuffle: !state.shuffle, order: state.shuffle ? undefined : shuffled(ids, state.serial, state.playback?.assetId) };
 if (!ids.length || action === 'play' && !ids.includes(assetId!)) return state;
 if (action === 'play' && state.playback && state.playback.assetId === assetId && state.playback.paused) return { ...state, playback: { ...state.playback, paused: false } };
 const order = state.shuffle ? action === 'play' ? shuffled(ids, state.serial + 1, assetId) : state.order?.filter(id => ids.includes(id)) ?? shuffled(ids, state.serial) : ids;
 let index = Math.max(0, order.indexOf(state.playback?.assetId ?? ''));
 if (action === 'play') index = order.indexOf(assetId!);
 else if (action === 'musicPrevious') index = (index + order.length - 1) % order.length;
 else if (action === 'musicNext' && state.playback || action === 'ended') {
  if (action === 'ended' && !state.loop && index === order.length - 1) return { ...state, playback: undefined };
  index = (index + 1) % order.length;
 }
 return { ...state, order: state.shuffle ? order : undefined, serial: state.serial + 1, playback: { assetId: order[index], requestId: state.serial + 1, paused: false } };
}

/** Collection geometry in game pixels, shared by static and interactive previews. */
export function musicCollectionLayout(project: Project, component: UiComponent) {
 const list = component.list, w = component.width * project.width, h = component.height * project.height, columns = list?.columns ?? 1, rows = list?.rows ?? 0;
 const gapX = Math.min(Math.round(list?.gapX ?? 12), Math.floor(w / (columns * 2))), gapY = Math.round(list?.gapY ?? 12);
 const cellW = Math.max(1, Math.min(Math.floor(list?.itemWidth ?? w), Math.floor((w - (columns - 1) * gapX - (rows ? 0 : 16)) / columns)));
 const navH = rows && !list?.navigationRect ? Math.min(40, Math.max(24, Math.floor(h * .1))) : 0, viewH = Math.max(1, h - navH - (navH ? gapY : 0));
 const cellH = Math.max(1, Math.round(list?.itemHeight ?? (rows ? Math.max(32, Math.floor((viewH - (rows - 1) * gapY) / rows)) : Math.max(48, (component.style?.fontSize ?? project.ui.fontSize) + 28))));
 const r = list?.navigationRect, navigation = r ? { x: r.x * w, y: r.y * h, width: r.width * w, height: r.height * h } : { x: 0, y: h - navH, width: w, height: navH };
 return { columns, rows, gapX, gapY, cellW, cellH, viewH, navigation };
}
