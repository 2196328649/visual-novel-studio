export const editorThemes = {
  studio: { name: '蓝灰', description: '冷灰面板，低饱和灰蓝层次', background: '#191c20', panel: '#24272c', raised: '#30353b', toolbar: '#202328', input: '#181b1f', text: '#e1e4e9', muted: '#a7b0bb', border: '#41474f', accent: '#c4cfdd', selection: '#363e49', node: '#292e35', nodeTitle: '#333b45', light: false },
  ue5: { name: '石墨', description: '中性深灰，清楚区分面板和控件', background: '#151515', panel: '#242424', raised: '#303030', toolbar: '#1b1b1b', input: '#181818', text: '#e5e5e5', muted: '#a9a9a9', border: '#414141', accent: '#dedede', selection: '#393939', node: '#282828', nodeTitle: '#333333', light: false },
  codexDark: { name: '黑白', description: '默认外观 · 黑灰底色与清晰白字', background: '#181818', panel: '#202020', raised: '#2a2a2a', toolbar: '#1b1b1b', input: '#171717', text: '#ededed', muted: '#a6a6a6', border: '#3d3d3d', accent: '#ededed', selection: '#343434', node: '#252525', nodeTitle: '#303030', light: false },
  codexLight: { name: '亮白', description: '白色纸面与深灰文字，适合明亮环境', background: '#f5f5f5', panel: '#ffffff', raised: '#ededed', toolbar: '#f8f8f8', input: '#ffffff', text: '#242424', muted: '#666666', border: '#d1d1d1', accent: '#242424', selection: '#e4e4e4', node: '#ffffff', nodeTitle: '#f0f0f0', light: true },
} as const;
export type EditorTheme = keyof typeof editorThemes | 'custom';
export const paletteLabels = { background: '工作区背景', panel: '面板', raised: '按钮与悬浮层', toolbar: '工具栏', input: '输入框', text: '文字', muted: '次要文字', border: '边框', accent: '重点色', selection: '选中背景', node: '蓝图节点', nodeTitle: '节点标题' } as const;
export type PaletteColor = keyof typeof paletteLabels;
export type EditorPalette = Record<PaletteColor, string> & { name: string; description: string; light: boolean };
const key = 'vns:editor-theme';
const customKey = 'vns:editor-custom-palette';
export function editorPalette(theme: EditorTheme): EditorPalette {
  if (theme !== 'custom') return editorThemes[theme];
  const colors: Record<PaletteColor, string> = { ...editorThemes.codexDark };
  try {
    const saved = JSON.parse(localStorage.getItem(customKey) ?? '{}');
    for (const color of Object.keys(paletteLabels) as PaletteColor[]) if (typeof saved?.[color] === 'string' && /^#[0-9a-f]{6}$/i.test(saved[color])) colors[color] = saved[color];
  } catch { /* Invalid preferences use the graphite base. */ }
  const rgb = [1, 3, 5].map(at => parseInt(colors.background.slice(at, at + 2), 16));
  return { ...colors, name: '自定义', description: '使用自己的背景、文字和重点色', light: rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > 150 };
}
export function readEditorTheme(): EditorTheme {
  try { const value = localStorage.getItem(key); if (value === 'custom' || value && Object.hasOwn(editorThemes, value)) return value as EditorTheme; } catch { /* Use the default palette. */ }
  return 'codexDark';
}
export function colorContrast(first: string, second: string) {
  const luminance = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
export function readableColor(preferred: string, background: string, minimum = 4.5) {
  return colorContrast(preferred, background) >= minimum ? preferred : colorContrast('#ffffff', background) > colorContrast('#000000', background) ? '#ffffff' : '#000000';
}
function applyEditorTheme(theme: EditorTheme) {
  const palette = editorPalette(theme), root = document.documentElement;
  root.dataset.editorTheme = theme;
  root.dataset.editorLight = String(palette.light);
  root.style.colorScheme = palette.light ? 'light' : 'dark';
  for (const [key, value] of Object.entries(palette)) if (typeof value === 'string' && value.startsWith('#')) root.style.setProperty(`--editor-${key}`, value);
  for (const surface of ['background', 'panel', 'raised', 'toolbar', 'input', 'selection', 'node', 'nodeTitle'] as const) {
    root.style.setProperty(`--editor-${surface}-text`, readableColor(palette.text, palette[surface]));
    root.style.setProperty(`--editor-${surface}-muted`, readableColor(palette.muted, palette[surface]));
  }
  root.style.setProperty('--editor-on-accent', readableColor(palette.background, palette.accent));
  root.style.setProperty('--editor-text', readableColor(palette.text, palette.background));
  root.style.setProperty('--editor-muted', readableColor(palette.muted, palette.background));
}
export function setEditorTheme(theme: EditorTheme) {
  try { localStorage.setItem(key, theme); } catch { /* Theme still applies to this session. */ }
  applyEditorTheme(theme);
  window.dispatchEvent(new Event('editor-theme-change'));
}
export function setCustomEditorPalette(patch: Partial<Record<PaletteColor, string>>) {
  const palette = editorPalette('custom');
  for (const color of Object.keys(paletteLabels) as PaletteColor[]) if (patch[color] && /^#[0-9a-f]{6}$/i.test(patch[color]!)) palette[color] = patch[color]!;
  try { localStorage.setItem(customKey, JSON.stringify(palette)); } catch { /* Keep the selected theme usable. */ }
  setEditorTheme('custom');
}
export function initializeEditorTheme() {
  applyEditorTheme(readEditorTheme());
  window.addEventListener('storage', event => { if (event.key === key || event.key === customKey) { applyEditorTheme(readEditorTheme()); window.dispatchEvent(new Event('editor-theme-change')); } });
}
