/** One key catalogue for authored shortcuts, event nodes and desktop preview. */
export const uiShortcutKeys: Record<string, string> = {
  K_SPACE: '空格', K_RETURN: '回车', K_ESCAPE: 'Esc', K_UP: '↑', K_DOWN: '↓', K_LEFT: '←', K_RIGHT: '→',
  ...Object.fromEntries('abcdefghijklmnopqrstuvwxyz0123456789'.split('').map(key => ['K_' + key, key.toUpperCase()])),
  ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => ['K_F' + (index + 1), 'F' + (index + 1)])),
};

export function uiShortcutKey(value: string | undefined): string | undefined {
  if (!value) return;
  if (Object.hasOwn(uiShortcutKeys, value)) return value;
  const aliases: Record<string, string> = { ' ': 'K_SPACE', Enter: 'K_RETURN', Escape: 'K_ESCAPE', ArrowUp: 'K_UP', ArrowDown: 'K_DOWN', ArrowLeft: 'K_LEFT', ArrowRight: 'K_RIGHT' };
  const key = aliases[value] ?? (/^F(?:[1-9]|1[0-2])$/i.test(value) ? 'K_' + value.toUpperCase() : /^[a-z0-9]$/i.test(value) ? 'K_' + value.toLowerCase() : undefined);
  return key && Object.hasOwn(uiShortcutKeys, key) ? key : undefined;
}
