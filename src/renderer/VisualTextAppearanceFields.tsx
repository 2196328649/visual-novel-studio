import type { Project, VisualObject } from '../core/model';
import { AssetReferenceInput } from './AssetReferenceInput';
import { Field } from './components';
import { NumberInput } from './NumberInput';
import './visual-text-appearance.css';

type TextAppearancePatch = Partial<Pick<VisualObject, 'text' | 'fontSize' | 'color' | 'fontAssetId' | 'textItalic' | 'textAlign' | 'textVerticalAlign' | 'textClip' | 'textEffects'>>;
export type VisualTextEffectProperty = keyof NonNullable<VisualObject['textEffects']>;

/** Shared static lettering controls; animation and particle motion stay in their own editors. */
export function VisualTextAppearanceFields({ project, object, onChange, includeContent = true, variant = 'object', linked, onEffectChange }: {
  project: Project; object: VisualObject; onChange: (patch: TextAppearancePatch) => void;
  includeContent?: boolean; variant?: 'object' | 'clip'; linked?: ReadonlySet<string>;
  /** A field writer preserves separately bound outline and shadow values. */
  onEffectChange?: (key: VisualTextEffectProperty, value: number | string) => void;
}) {
  const disabled = (key: string) => !!linked && (linked.has('object_' + key)
    || key.startsWith('textEffects_') && linked.has('object_textEffects')
    || key.startsWith('textClip_') && linked.has('object_textClip'));
  const change = (key: string, patch: TextAppearancePatch) => { if (!disabled(key)) onChange(patch); };
  const changeEffect = (key: VisualTextEffectProperty, value: number | string) => {
    if (disabled('textEffects_' + key)) return;
    if (onEffectChange) onEffectChange(key, value);
    else onChange({ textEffects: { ...object.textEffects, [key]: value } });
  };
  const font = <Field label="字体"><AssetReferenceInput project={project} kind="font" compact={variant === 'clip'} label={variant === 'clip' ? '片段字体' : '对象字体'} disabled={disabled('fontAssetId')} value={object.fontAssetId} empty="默认字体" onChange={fontAssetId => change('fontAssetId', { fontAssetId })} /></Field>;
  const size = <Field label="字号"><NumberInput aria-label={variant === 'clip' ? '片段字号' : '对象字号'} disabled={disabled('fontSize')} value={object.fontSize} min={1} step={1} onChange={event => change('fontSize', { fontSize: Math.max(1, Math.round(event.target.valueAsNumber)) })} /></Field>;
  const color = <Field label="文字颜色"><input aria-label={variant === 'clip' ? '片段颜色' : '对象颜色'} type="color" disabled={disabled('color')} value={object.color} onChange={event => change('color', { color: event.target.value })} /></Field>;
  const italic = <Field label="斜体"><input aria-label="文字斜体" type="checkbox" disabled={disabled('textItalic')} checked={object.textItalic ?? false} onChange={event => change('textItalic', { textItalic: event.target.checked })} /></Field>;
  const content = <textarea className={variant === 'clip' ? 'visual-text-content' : undefined} aria-label={variant === 'clip' ? '片段文字内容' : '对象文字'} disabled={disabled('text')} value={object.text} onChange={event => change('text', { text: event.target.value })} />;
  return <details open className="ui-property-group visual-text-appearance"><summary>文字</summary>
    {includeContent && (variant === 'clip' ? content : <Field label="对象文字">{content}</Field>)}
    {variant === 'clip' && includeContent ? <><div className="visual-text-font-row">{font}{size}</div><div className="visual-text-field-pair visual-text-decoration-row">{color}{italic}</div></> : <>{font}{includeContent && <div className="visual-text-field-pair">{size}{color}</div>}{italic}</>}
    <div className="visual-text-field-pair">
      <Field label="水平对齐"><select aria-label="文字水平对齐" disabled={disabled('textAlign')} value={object.textAlign ?? 'center'} onChange={event => change('textAlign', { textAlign: event.target.value as VisualObject['textAlign'] })}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></Field>
      <Field label="垂直对齐"><select aria-label="文字垂直对齐" disabled={disabled('textVerticalAlign')} value={object.textVerticalAlign ?? 'center'} onChange={event => change('textVerticalAlign', { textVerticalAlign: event.target.value as VisualObject['textVerticalAlign'] })}><option value="top">顶部</option><option value="center">居中</option><option value="bottom">底部</option></select></Field>
    </div>
    <details className="ui-property-group visual-text-style"><summary>文字样式</summary>
      <p className="muted">描边、阴影和裁切作用于整个文字片段。</p>
      {([['outlineWidth', '描边宽度', 0], ['outlineOpacity', '描边不透明度', 1], ['shadowX', '阴影横向偏移', 0], ['shadowY', '阴影纵向偏移', 0], ['shadowBlur', '阴影柔化', 0], ['shadowOpacity', '阴影不透明度', .7]] as const).map(([key, label, fallback]) => <Field key={key} label={label}><NumberInput aria-label={label} disabled={disabled('textEffects_' + key)} value={object.textEffects?.[key] ?? fallback} min={key === 'shadowX' || key === 'shadowY' ? undefined : 0} max={key.endsWith('Opacity') ? 1 : undefined} step={key.endsWith('Opacity') ? .1 : 1} onChange={event => changeEffect(key, event.target.valueAsNumber)} /></Field>)}
      <div className="visual-text-field-pair">{([['outlineColor', '描边颜色'], ['shadowColor', '阴影颜色']] as const).map(([key, label]) => <Field key={key} label={label}><input aria-label={label} type="color" disabled={disabled('textEffects_' + key)} value={object.textEffects?.[key] ?? '#000000'} onChange={event => changeEffect(key, event.target.value)} /></Field>)}</div>
      <Field label="限制文字显示范围"><input aria-label="限制文字显示范围" type="checkbox" disabled={disabled('textClip')} checked={!!object.textClip} onChange={event => change('textClip', { textClip: event.target.checked ? { x: 0, y: 0, width: 1, height: 1 } : undefined })} /></Field>
      {object.textClip && <div className="visual-text-field-pair">{(['x', 'y', 'width', 'height'] as const).map(key => {
        const label = '裁切' + ({ x: '横向位置', y: '纵向位置', width: '宽度', height: '高度' })[key] + ' %';
        return <Field key={key} label={label}><NumberInput aria-label={label} disabled={disabled('textClip_' + key)} value={Number((object.textClip![key] * 100).toPrecision(15))} min={key === 'width' || key === 'height' ? 0 : undefined} step={1} onChange={event => change('textClip_' + key, { textClip: { ...object.textClip!, [key]: event.target.valueAsNumber / 100 } })} /></Field>;
      })}</div>}
    </details>
  </details>;
}
