import { useEffect, useState } from 'react';
import { editorPalette, readEditorTheme, readableColor } from './editor-theme';
import { textLineColor } from '../core/text-colors';

export const textPaletteLabels = { background: '文本背景', text: '普通文字', heading: '章节与小章节', command: '演出指令', narration: '旁白', comment: '注释', selection: '选中背景' } as const;
export type TextPalette = Record<keyof typeof textPaletteLabels, string>;
export type TextPaletteSettings = { colors: Partial<TextPalette>; speakers: Record<string, string> };
const key = 'vns:text-palette';
const eventName = 'text-palette-change';
const validColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export function readTextPalette(): TextPaletteSettings {
  const result: TextPaletteSettings = { colors: {}, speakers: Object.create(null) };
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
    for (const name of Object.keys(textPaletteLabels) as (keyof TextPalette)[]) if (validColor(saved?.colors?.[name])) result.colors[name] = saved.colors[name];
    for (const [name, color] of Object.entries(saved?.speakers ?? {})) if (validColor(color)) result.speakers[name] = color;
  } catch { /* Use theme defaults when preferences are invalid. */ }
  return result;
}
export function saveTextPalette(settings: TextPaletteSettings) {
  try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* Optional local preference. */ }
  window.dispatchEvent(new Event(eventName));
}
export function defaultTextPalette(): TextPalette {
  const theme = editorPalette(readEditorTheme());
  return { background: theme.background, text: readableColor(theme.text, theme.background), heading: theme.light ? '#7441a1' : '#c5b3ef', command: theme.light ? '#126858' : '#86cfc1', narration: theme.light ? '#526174' : '#aabbd0', comment: readableColor(theme.muted, theme.background), selection: theme.selection };
}
export function useTextPalette() {
  const [settings, setSettings] = useState(readTextPalette);
  const [defaults, setDefaults] = useState(defaultTextPalette);
  useEffect(() => {
    const update = () => { setSettings(readTextPalette()); setDefaults(defaultTextPalette()); };
    const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) update(); };
    window.addEventListener(eventName, update); window.addEventListener('storage', storage); window.addEventListener('editor-theme-change', update);
    return () => { window.removeEventListener(eventName, update); window.removeEventListener('storage', storage); window.removeEventListener('editor-theme-change', update); };
  }, []);
  return { settings, palette: { ...defaults, ...settings.colors } };
}
export function speakerTextColor(name: string, settings: TextPaletteSettings, palette: TextPalette) {
  if (Object.hasOwn(settings.speakers, name)) return settings.speakers[name];
  if (name === '旁白') return palette.narration;
  const rgb = [1, 3, 5].map(at => parseInt(palette.background.slice(at, at + 2), 16));
  const light = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > 150;
  return `hsl(${textLineColor(name + '：').hue ?? 0} 65% ${light ? 30 : 76}%)`;
}
