import type { UiComponent, UiTheme } from './model';

export const uiScreenPages: Record<string, UiComponent['page']> = {
  main_menu: 'main', save: 'save', load: 'save', preferences: 'preferences', voice_settings: 'voiceSettings',
  pause_menu: 'pause', history: 'history', gallery: 'gallery', music_room: 'musicRoom',
  voice_collection: 'voiceCollection', chapter_select: 'chapterSelect', flowchart: 'flowchart', staff_roll: 'staff',
};
export function uiScreenAvailable(theme: UiTheme, screen: string) {
  const page = uiScreenPages[screen];
  return !page || !theme.disabledPages?.includes(page);
}
export function uiActionAvailable(theme: UiTheme, action: NonNullable<UiComponent['action']>) {
  const page = ({ load: 'save', music: 'musicRoom', mainMenu: 'main' } as Record<string, string>)[action] ?? action;
  return !theme.disabledPages?.includes(page as UiComponent['page']);
}

/** Omit disabled optional screens entirely from the exported player. */
export function omitDisabledUiScreens(source: string, theme: UiTheme) {
  const names = new Set(Object.entries(uiScreenPages).filter(([, page]) => theme.disabledPages?.includes(page)).map(([name]) => name));
  for (const page of theme.disabledPages ?? []) names.add('vn_components_' + page);
  return source.replace(/^screen ([a-zA-Z0-9_]+)\([^\n]*\):\n[\s\S]*?(?=^screen |^init |^define |^default |^style |$(?![\s\S]))/gm, (block, name: string) => names.has(name) ? '' : block);
}
