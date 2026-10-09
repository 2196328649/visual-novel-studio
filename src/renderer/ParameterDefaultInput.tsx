import { playerPreferences, type PlayerPreference } from '../core/preferences';
import type { VariableValue } from '../core/model';
import { PreferenceValueInput } from './PlayerPreferences';

export function ParameterDefaultInput({ preference, value, onChange, label }: { preference: PlayerPreference; value?: VariableValue; onChange: (value: VariableValue) => void; label: string }) {
  const info = playerPreferences[preference], current = value ?? info.initial;
  return <div className="parameter-default-control">
    {info.type === 'number' && <input type="range" aria-label={label + '滑条'} min={info.min} max={info.max} step={info.max === 1 ? .01 : 1} value={Number(current)} onChange={event => onChange(Number(event.target.value))} />}
    <PreferenceValueInput preference={preference} value={value} label={label} onChange={onChange} />
    {info.type === 'number' && <small>{info.max === 1 ? `${Math.round(Number(current) * 100)}%` : preference === 'textSpeed' ? '字/秒' : '速度参数'}</small>}
  </div>;
}
