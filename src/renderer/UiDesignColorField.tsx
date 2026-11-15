import { useEffect, useId, useState, type CSSProperties } from 'react';
import { RotateCcw } from 'lucide-react';
import type { UiProperty } from '../core/ui-properties';
import { NumberInput } from './NumberInput';
import { useUiPropertyControlField } from './UiPropertyControl';
import './ui-common-appearance.css';

/** Shared RGB/RGBA input. The swatch and numeric opacity always describe the same value. */
export function UiDesignColorField({ label, value, onChange, source, onReset, canReset = !!onReset, property, disabled = false, allowAlpha = true }: {
  label: string; value: string; onChange: (value: string) => void;
  source?: string; onReset?: () => void; canReset?: boolean; property?: UiProperty; disabled?: boolean; allowAlpha?: boolean;
}) {
  const id = useId();
  const control = useUiPropertyControlField(property, label);
  const normalized = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value) ? (allowAlpha ? value : value.slice(0, 7)).toLowerCase() : '#000000';
  const [draft, setDraft] = useState(normalized);
  useEffect(() => { setDraft(normalized); }, [normalized]);
  const valid = (text: string) => (allowAlpha ? /^#[0-9a-f]{6}([0-9a-f]{2})?$/i : /^#[0-9a-f]{6}$/i).test(text);
  const alpha = allowAlpha && normalized.length === 9 ? Number.parseInt(normalized.slice(7), 16) : 255;
  const changed = (color: string) => { const next = color.toLowerCase(); setDraft(next); if (next !== normalized) onChange(next); };
  return <div className="ui-design-color-field" data-ui-design-field={property} data-ui-property={control.enabled ? property : undefined} data-ui-property-bound={control.bound || undefined} onContextMenu={control.onContextMenu} onKeyDown={control.onFieldKeyDown}>
    <div className="ui-design-field-heading"><label htmlFor={control.bound ? undefined : id} tabIndex={control.labelTabIndex}>{label}</label>
      {!control.bound && onReset && canReset && <button type="button" className="ui-design-reset" title={`恢复${label}`} aria-label={`恢复${label}`} disabled={disabled} onClick={onReset}><RotateCcw size={12} aria-hidden="true" /></button>}
    </div>
    {control.bound ? control.replacement : <div className={`ui-design-color-controls${allowAlpha ? '' : ' no-alpha'}`}>
      <span className="ui-design-swatch" style={{ '--swatch-color': normalized } as CSSProperties}>
        <input type="color" aria-label={`${label}色块`} value={normalized.slice(0, 7)} disabled={disabled} onChange={event => changed(event.target.value + (alpha === 255 ? '' : alpha.toString(16).padStart(2, '0')))} />
      </span>
      <input id={id} type="text" className="ui-design-hex" aria-label={`${label}颜色值`} value={draft} spellCheck={false} maxLength={allowAlpha ? 9 : 7} disabled={disabled} aria-invalid={!valid(draft)}
        onChange={event => { const text = event.target.value; setDraft(text); if (valid(text)) onChange(text.toLowerCase()); }}
        onBlur={() => { if (!valid(draft)) setDraft(normalized); }}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setDraft(normalized); } }} />
      {allowAlpha && <label className="ui-design-alpha"><NumberInput aria-label={`${label}不透明度 %`} title="不透明度" min={0} max={100} step={1} disabled={disabled} value={Math.round(alpha / 255 * 100)} onChange={event => {
        const opacity = Math.round(Math.max(0, Math.min(100, Number(event.target.value))) / 100 * 255);
        changed(normalized.slice(0, 7) + (opacity === 255 ? '' : opacity.toString(16).padStart(2, '0')));
      }} /><span aria-hidden="true">%</span></label>}
      {allowAlpha && <button type="button" className="ui-design-transparent" aria-label={`${label}无填充`} title="设为透明" disabled={disabled || alpha === 0} onClick={() => changed('#00000000')}>无</button>}
    </div>}
    {!control.bound && source && <small className="ui-design-source" data-ui-design-source={property}>{source}</small>}
  </div>;
}
