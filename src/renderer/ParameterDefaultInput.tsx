import { displayScale, preferenceInfo, type PlayerPreference } from '../core/preferences';
import type { Project, VariableValue } from '../core/model';
import { NumberInput } from './NumberInput';
import { PreferenceValueInput } from './PlayerPreferences';

/** A built-in setting's initial value within the author's range. Percentages are typed as 0–100; the project stores 0–1. */
export function ParameterDefaultInput({ project, preference, value, onChange, label }: { project: Project; preference: PlayerPreference; value?: VariableValue; onChange: (value: VariableValue) => void; label: string }) {
  const info = preferenceInfo(project, preference), current = value ?? info.initial;
  if (info.type !== 'number') return <div className="parameter-default-control"><PreferenceValueInput project={project} preference={preference} value={value} label={label} onChange={onChange} /></div>;
  const scale = displayScale(info), numeric = Number(current);
  return <div className="parameter-default-control">
    <input type="range" aria-label={label + '滑条'} min={info.min} max={info.max} step={info.step} value={numeric} onChange={event => onChange(Number(event.target.value))} />
    <NumberInput aria-label={label} type="number" min={info.min * scale} max={info.max * scale} step={info.step * scale} value={+(numeric * scale).toFixed(4)} onChange={event => { const next = event.target.valueAsNumber; if (Number.isFinite(next)) onChange(next / scale); }} />
    <small title={info.help}>{info.display === 'percent' ? '%' : info.unit}</small>
  </div>;
}
