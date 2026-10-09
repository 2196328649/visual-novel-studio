import type { ActorTransitionRule, VisualTransitions } from '../core/model';
import { visualTransitionNames } from '../core/visual-transitions';
import { NumberInput } from './NumberInput';

export function VisualTransitionField({ label, value, inherit, onChange }: { label: string; value?: ActorTransitionRule; inherit?: boolean; onChange: (value?: ActorTransitionRule) => void }) {
  return <div className="field-row visual-transition-field"><label>{label}<select aria-label={label} value={value?.mode ?? (inherit ? 'inherit' : 'none')} onChange={event => onChange(event.target.value === 'inherit' ? undefined : { mode: event.target.value as ActorTransitionRule['mode'], duration: value?.duration || .5 })}>
    {inherit && <option value="inherit">沿用显示时设置</option>}{Object.entries(visualTransitionNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
  </select></label><label>秒数<NumberInput aria-label={label + '秒数'} type="number" value={value?.duration ?? .5} min={0} max={60} step={.1} disabled={!value || value.mode === 'none'} onChange={event => value && onChange({ ...value, duration: Math.max(0, Math.min(60, Number(event.target.value))) })} /></label></div>;
}
export function VisualTransitionsEditor({ value, wait, onChange, onWaitChange }: { value?: VisualTransitions; wait?: boolean; onChange: (value: VisualTransitions) => void; onWaitChange: (wait: boolean) => void }) {
  return <details className="ui-property-group" open={!!value}><summary>进出场过渡</summary>
    {(['enter', 'exit', 'replace'] as const).map(phase => <VisualTransitionField key={phase} label={{ enter: '入场过渡', exit: '离场过渡', replace: '替换过渡' }[phase]} value={value?.[phase] ?? (phase === 'replace' ? value?.enter : undefined)} onChange={rule => onChange({ ...value, [phase]: rule })} />)}
    <label className="check-field"><input type="checkbox" aria-label="等待图片过渡" checked={!!wait} onChange={event => onWaitChange(event.target.checked)} />等待入场或替换过渡后继续</label>
    <p className="muted">替换过渡用于同一个对象 ID 换成另一张图片，例如 image 从日间照片切换到夜间照片；使用不同 ID 时两张图片会同时显示。仅本句在推进台词后离场；定时显示的离场包含在总时长内；持续显示在隐藏对象时离场。</p>
  </details>;
}
