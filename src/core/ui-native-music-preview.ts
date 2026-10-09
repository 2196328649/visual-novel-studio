import { declaredUiComponents, effectiveUiTheme, type Project, type UiComponent } from './model';
import { dialogueLayout } from './ui';
import type { NativePreferenceLayout } from './ui-native-preview';
import { musicRoomEntries } from './music-preview';

export function nativeMusicPreview(project: Project, pageId: string, authored: UiComponent[]): NativePreferenceLayout | undefined {
 const theme = effectiveUiTheme(project.ui);
 if (pageId !== 'ui:musicRoom' || theme.pages?.musicRoom?.layout === 'custom') return;
 const { width, height } = project, { margin, contentWidth } = dialogueLayout(width, height, theme), font = Math.min(24, theme.fontSize);
 const components: UiComponent[] = [], bodyIds: string[] = [], occupied = new Set([...declaredUiComponents(project), ...authored].map(c => c.id));
 const add = (key: string, kind: UiComponent['kind'], text: string, x: number, y: number, w: number, h: number, patch: Partial<UiComponent> = {}, body = true) => {
  let id = '__preview_native_musicRoom_' + key; while (occupied.has(id)) id += '_'; occupied.add(id);
  components.push({ id, page: 'musicRoom', kind, text, x: x / width, y: y / height, width: w / width, height: h / height, style: { fontSize: font, textColor: theme.textColor, background: kind === 'button' ? '#283133' : undefined, selectedBackground: theme.accent }, ...patch });
  if (body) bodyIds.push(id);
 };
 const buttonH = Math.ceil(font * 1.4) + 16;
 add('title', 'text', '音乐', margin, 22, contentWidth * .6, buttonH, {}, false);
 add('return', 'button', '返回', width - margin - 150, 22, 150, buttonH, { action: 'return' }, false);
 let navX = margin;
 for (const [action, text] of [['save','存档'],['load','读档'],['preferences','设置'],['history','历史'],['gallery','画廊'],['music','音乐'],['mainMenu','标题']] as const) {
  const w = Math.min(96, (contentWidth - 30) / 7);
  add('nav_' + action, 'button', text, navX, 22 + buttonH + 12, w, buttonH, { action }, false); navX += w + 5;
 }
 const top = 22 + 2 * buttonH + 30, viewportH = Math.max(80, height - top - 22);
 const replaced = authored.some(c => ['galleryGrid','musicTrackList','voiceCollection','chapterList','historyList','flowchart','pauseMenu','staffRoll'].includes(c.kind));
 let contentH = 0;
 if (!replaced) {
  const tracks = musicRoomEntries(project), x = margin + 12, w = contentWidth - 42;
  if (!tracks.length) { add('empty', 'text', '暂无音乐', x, 12, w, buttonH); contentH = buttonH + 24; }
  else {
   let y = 12;
   for (const row of [[['musicPrevious','上一首'],['musicPlayPause','播放 / 暂停'],['musicNext','下一首'],['musicStop','停止']], [['musicLoop','循环'],['musicShuffle','随机']]] as const) {
    let left = x;
    for (const [action, text] of row) { const size = text.length * font + 24; add(action, 'button', text, left, y, size, buttonH, { action }); left += size + 10; }
    y += buttonH + 12;
   }
   const listH = tracks.length * (buttonH + 12);
   add('tracks', 'musicTrackList', '', x, y, w, listH, { list: { itemHeight: buttonH, gapY: 12 } }); contentH = y + listH + 12;
  }
 }
 return { kind: 'music', components, bodyIds, top, height: viewportH, contentHeight: contentH };
}
