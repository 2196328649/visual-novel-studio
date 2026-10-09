import { actorTransitionDefaults, actorTransitionModes, actorTransitionPhases } from '../core/actor-transitions';
import type { ActorTransitions } from '../core/model';
import { NumberInput } from './NumberInput';

export function ActorTransitionFields({ value, defaults = actorTransitionDefaults(), onChange, label = '角色过渡', inheritLabel }: { value?: ActorTransitions; defaults?: Required<ActorTransitions>; onChange: (value: ActorTransitions | undefined) => void; label?: string; inheritLabel?: string }) {
  return <fieldset className="actor-transition-fields" aria-label={label}><legend>{label}</legend>
    {Object.entries(actorTransitionPhases).map(([id, name]) => {
      const phase = id as keyof ActorTransitions, rule = value?.[phase] ?? defaults[phase];
      return <div className="field-row" key={phase}>
        <label className="field">{name}<select aria-label={label + ' · ' + name} value={value?.[phase]?.mode ?? ''} onChange={event => {
          const next = { ...value }; if (!event.target.value) delete next[phase]; else next[phase] = { mode: event.target.value as typeof rule.mode, duration: rule.duration || .5 };
          onChange(Object.keys(next).length ? next : undefined);
        }}><option value="">继承（{inheritLabel ?? actorTransitionModes[defaults[phase].mode]}）</option>{Object.entries(actorTransitionModes).map(([mode, text]) => <option key={mode} value={mode}>{text}</option>)}</select></label>
        <label className="field">时长（秒）<NumberInput aria-label={label + ' · ' + name + '时长'} type="number" min={0} max={60} step={.1} disabled={rule.mode === 'none' || !!inheritLabel && !value?.[phase]} placeholder="继承" value={inheritLabel && !value?.[phase] ? '' : rule.duration} onChange={event => onChange({ ...value, [phase]: { ...rule, duration: Math.max(0, Math.min(60, Number(event.target.value) || 0)) } })} /></label>
      </div>;
    })}
    <p className="muted">换人时离场与入场同时进行；相同角色、表情和站位保持不变。自动离场沿用显示时的设置；手动隐藏按隐藏指令设置。</p>
  </fieldset>;
}
