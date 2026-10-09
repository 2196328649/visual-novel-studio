import { useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { RotateCcw, X } from 'lucide-react';
import { textLineColor } from '../core/text-colors';
import { IconButton } from './components';
import { colorContrast } from './editor-theme';
import { saveTextPalette, speakerTextColor, textPaletteLabels, useTextPalette, type TextPalette } from './text-palette';

export function TextColorSettings({ source, onClose }: { source: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { settings, palette } = useTextPalette();
  const speakers = useMemo(() => [...new Set(source.split('\n').map(line => textLineColor(line).speaker).filter((name): name is string => !!name && name !== '旁白'))], [source]);
  useEffect(() => { const element = dialog.current; const previous = document.activeElement as HTMLElement | null; element?.showModal(); return () => { element?.close(); previous?.focus(); }; }, []);
  return createPortal(<dialog ref={dialog} className="text-colors-dialog" aria-label="文本配色设置" onKeyDown={event => { if (event.key === 'F5' || event.key === 'F6') event.stopPropagation(); }} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><div><h2>文本配色</h2><p>修改立即预览，保存在本机。标注颜色在“彩色标注”开启时生效。</p></div><IconButton title="关闭文本配色设置" onClick={onClose}><X size={18} /></IconButton></header>
    <div className="text-colors-body"><section><h3>文本与标注</h3><div className="text-color-fields">{(Object.entries(textPaletteLabels) as [keyof TextPalette, string][]).map(([name, label]) => <label key={name}><span>{label}</span><input type="color" aria-label={label + '颜色'} value={palette[name]} onChange={event => saveTextPalette({ ...settings, colors: { ...settings.colors, [name]: event.target.value } })} /><code>{palette[name]}</code></label>)}</div>
      {colorContrast(palette.text, palette.background) < 3 && <p role="status">普通文字与背景接近，建议拉开明暗差异。</p>}
      <h3>当前文本的发言人</h3><p className="muted">默认按名字自动分配颜色，也可逐个指定。不会改变游戏中的角色姓名颜色。</p>
      <div className="text-speaker-colors">{speakers.map(name => <div key={name}><span style={{ color: speakerTextColor(name, settings, palette) }}>{name}</span><label><input type="checkbox" aria-label={'自定义发言人颜色 ' + name} checked={Object.hasOwn(settings.speakers, name)} onChange={event => { const next = { ...settings.speakers }; if (event.target.checked) next[name] = palette.text; else delete next[name]; saveTextPalette({ ...settings, speakers: next }); }} />自定义</label>{Object.hasOwn(settings.speakers, name) && <input type="color" aria-label={'发言人颜色 ' + name} value={settings.speakers[name]} onChange={event => saveTextPalette({ ...settings, speakers: { ...settings.speakers, [name]: event.target.value } })} />}</div>)}</div>
      {!speakers.length && <p className="muted">输入“角色名：对白”后，可在这里设置该角色的颜色。</p>}
    </section><aside><h3>效果预览</h3><div className="text-color-preview" style={{ background: palette.background, color: palette.text }}><p style={{ color: palette.heading }}># 章节：初次相遇</p><p style={{ color: palette.command }}>@背景：庭院</p><p style={{ color: palette.narration }}>旁白：故事从这里开始。</p>{speakers.slice(0, 4).map(name => <p key={name} style={{ color: speakerTextColor(name, settings, palette) }}>{name}：这是我的对白。</p>)}<p style={{ color: palette.comment }}>// 这是一条注释</p><p>普通文字</p><span style={{ background: palette.selection }}>选中的文本</span></div><p className="muted">恢复默认后，文本背景和文字会重新跟随编辑器主题。</p></aside></div>
    <footer><button type="button" className="small-button" onClick={() => saveTextPalette({ colors: {}, speakers: {} })}><RotateCcw size={14} />恢复默认配色</button><button type="button" className="primary" onClick={onClose}>完成</button></footer>
  </dialog>, document.body);
}
