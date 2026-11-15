import type { UiComponent, UiTheme } from './model';
import { builtinUiPages, uiActionPages, uiScreenPages } from './ui-page-catalog';
export { uiScreenPages } from './ui-page-catalog';

export function uiScreenAvailable(theme: UiTheme, screen: string) {
  const page = uiScreenPages[screen];
  return !page || !theme.disabledPages?.includes(page);
}
export function uiActionAvailable(theme: UiTheme, action: NonNullable<UiComponent['action']>) {
  const page = uiActionPages[action];
  return !page || !theme.disabledPages?.includes(page);
}

/** A removed menu must not remain the Esc/right-click target in older projects. */
export function uiMenuShortcut(theme: UiTheme): NonNullable<UiTheme['menuShortcutPage']> | undefined {
  return ([theme.menuShortcutPage ?? 'save', 'save', 'preferences', 'pause'] as const)
    .find(action => uiActionAvailable(theme, action));
}
export function uiMenuShortcutScreen(theme: UiTheme) {
  const shortcut = uiMenuShortcut(theme);
  return shortcut === 'pause' ? 'pause_menu' : shortcut;
}

/** Omit disabled optional screens entirely from the exported player. */
export function omitDisabledUiScreens(source: string, theme: UiTheme) {
  const names = new Set(Object.entries(uiScreenPages).filter(([, page]) => !builtinUiPages[page].keepHost && theme.disabledPages?.includes(page)).map(([name]) => name));
  for (const page of theme.disabledPages ?? []) names.add('vn_components_' + page);
  const kept = source.replace(/^screen ([a-zA-Z0-9_]+)\([^\n]*\):\n[\s\S]*?(?=^screen |^init |^define |^default |^style |$(?![\s\S]))/gm, (block, name: string) => names.has(name) ? '' : block);
  // Engine screens that stay (input, confirm) may still include a removed page's
  // components; Ren'Py refuses to start when a used screen is missing.
  return kept.replace(/^([ \t]+)use ([a-zA-Z0-9_]+).*$/gm, (line, indent: string, name: string) => names.has(name) ? indent + 'pass' : line);
}
