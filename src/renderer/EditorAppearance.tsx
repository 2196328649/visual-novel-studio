import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { editorThemes, editorPalette, paletteLabels, readEditorTheme, setEditorTheme, setCustomEditorPalette, type EditorTheme, type PaletteColor } from './editor-theme';

export function EditorAppearance() {
  const [theme, setTheme] = useState(readEditorTheme);
  const [custom, setCustom] = useState(() => editorPalette('custom'));
  useEffect(() => { const update = () => { setTheme(readEditorTheme()); setCustom(editorPalette('custom')); }; window.addEventListener('editor-theme-change', update); return () => window.removeEventListener('editor-theme-change', update); }, []);
  return <><h3>编辑器外观</h3><p className="muted">配色立即生效，保存在本机。工程和游戏中的界面使用各自的设计。</p>
    <div className="editor-theme-picker" role="group" aria-label="编辑器配色">{Object.entries({ codexDark: editorThemes.codexDark, codexLight: editorThemes.codexLight, ue5: editorThemes.ue5, studio: editorThemes.studio, custom }).map(([id, palette]) => <button type="button" key={id} className="editor-theme-card" aria-pressed={theme === id} onClick={() => { setEditorTheme(id as EditorTheme); setTheme(id as EditorTheme); }}>
      <div className="editor-theme-sample" style={{ background: palette.background, borderColor: palette.border }}><span style={{ background: palette.toolbar }} /><i style={{ background: palette.panel }} /><div style={{ background: palette.node, borderColor: palette.accent }}><b style={{ background: palette.nodeTitle }} /><small style={{ background: palette.accent }} /></div></div>
      <strong>{palette.name}{theme === id && <Check size={15} />}</strong><small>{palette.description}</small>
    </button>)}</div>
    <div className="custom-palette-toolbar"><strong>自定义配色</strong><button type="button" className="small-button" onClick={() => setCustomEditorPalette(editorPalette(theme === 'custom' ? 'codexDark' : theme))}>{theme === 'custom' ? '恢复黑白配色' : '以当前风格为起点'}</button></div>
    <p className="muted">文字与底色对比不足时会自动使用清晰的深色或浅色文字。</p>
    <div className="custom-palette-fields">{(Object.entries(paletteLabels) as [PaletteColor, string][]).map(([key, label]) => <label key={key}><span>{label}</span><input type="color" aria-label={`自定义${label}`} value={custom[key]} onChange={event => setCustomEditorPalette({ [key]: event.target.value })} /><code>{custom[key]}</code></label>)}</div>
  </>;
}
