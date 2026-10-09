import { declaredUiComponents, effectiveUiTheme, type Project, type UiComponent } from './model';
import { dialogueLayout } from './ui';
import type { NativePreferenceLayout } from './ui-native-preview';

/** Native history and favorites use temporary collections with the same controls as authored lists. */
export function nativeHistoryPreview(project: Project, pageId: string, authored: UiComponent[]): NativePreferenceLayout | undefined {
 if (pageId !== 'ui:history' && pageId !== 'ui:voiceCollection') return;
 const page = pageId === 'ui:history' ? 'history' : 'voiceCollection', theme = effectiveUiTheme(project.ui);
 if (theme.pages?.[page]?.layout === 'custom') return;
 const { width, height } = project, { margin, contentWidth } = dialogueLayout(width, height, theme), font = Math.min(24, theme.fontSize);
 const components: UiComponent[] = [], bodyIds: string[] = [], occupied = new Set([...declaredUiComponents(project), ...authored].map(c => c.id));
 const add = (key: string, kind: UiComponent['kind'], text: string, x: number, y: number, w: number, h: number, patch: Partial<UiComponent> = {}, body = false) => {
  let id = '__preview_native_' + page + '_' + key; while (occupied.has(id)) id += '_'; occupied.add(id);
  components.push({ id, page, kind, text, x: x / width, y: y / height, width: w / width, height: h / height, style: { fontSize: font, textColor: theme.textColor, background: kind === 'button' ? '#283133' : undefined, selectedBackground: theme.accent }, ...patch });
  if (body) bodyIds.push(id);
 };
 const buttonH = Math.ceil(font * 1.4) + 16;
 add('title', 'text', page === 'history' ? '历史' : '语音收藏', margin, 22, contentWidth * .6, buttonH);
 add('return', 'button', '返回', width - margin - 150, 22, 150, buttonH, { action: 'return' });
 let navX = margin;
 for (const [action, text] of [['save','存档'],['load','读档'],['preferences','设置'],['history','历史'],['gallery','画廊'],['music','音乐'],['mainMenu','标题']] as const) {
  const w = Math.min(96, (contentWidth - 30) / 7);
  add('nav_' + action, 'button', text, navX, 22 + buttonH + 12, w, buttonH, { action }); navX += w + 5;
 }
 const top = 22 + 2 * buttonH + 30, viewportH = Math.max(80, height - top - 22);
 const replaced = authored.some(c => ['galleryGrid','musicTrackList','voiceCollection','chapterList','historyList','flowchart','pauseMenu','staffRoll'].includes(c.kind));
 if (!replaced) add('entries', page === 'history' ? 'historyList' : 'voiceCollection', '', margin + 12, 0, contentWidth - 36, viewportH, { list: page === 'history' ? { historyLayout: 'stacked' } : { favoritesOnly: true } }, true);
 return { kind: page === 'history' ? 'history' : 'voices', components, bodyIds, top, height: viewportH, contentHeight: viewportH };
}
