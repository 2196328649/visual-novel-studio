import { textLoopEffects, type TextMotion } from '../core/model';
import { defaultLoopSpeed, defaultLoopStrength, textLoopNames, textSpeedNames } from '../core/text-presentation';
import { TextAnimatorFields } from './TextAnimatorFields';
import { Field } from './components';
import { NumberInput } from './NumberInput';
import './text-presentation.css';

/** Optional animation for displayed text and timeline clips, on the object's own clock. */
export function TextMotionFields({ motion, onChange }: { motion?: TextMotion; onChange: (motion?: TextMotion) => void }) {
  const current = motion ?? {}, speed = motion ? motion.speed ?? 'player' : 'instant', loop = current.loop ?? 'none';
  const change = (patch: Partial<TextMotion>) => {
    // Adding only an entrance or loop keeps the current reveal mode.
    const next: TextMotion = { speed, ...current, ...patch };
    for (const key of Object.keys(next) as (keyof TextMotion)[]) if (next[key] === undefined) delete next[key];
    onChange(next);
  };
  const number = (label: string, value: number, update: (value: number) => void, valid: (value: number) => boolean, step = 1) => <Field label={label}><NumberInput aria-label={label} value={value} step={step} onChange={event => { if (valid(event.target.valueAsNumber)) update(event.target.valueAsNumber); }} /></Field>;
  return <details className="ui-property-group text-motion-fields" open={!!motion}><summary>文字动画</summary>
    <p className="text-look-hint muted">可选设置；不设置时文字立即完整显示。</p>
    {motion && <button type="button" className="small-button" onClick={() => onChange(undefined)}>清除文字动画</button>}
    <Field label="文字显示方式"><select aria-label="文字显示方式" value={speed} onChange={event => {
      const value = event.target.value as NonNullable<TextMotion['speed']>;
      change({ speed: value, ...(value === 'duration' && !current.duration ? { duration: 1 } : {}), ...(value === 'cps' && !current.cps ? { cps: 20 } : {}) });
    }}>{(Object.entries(textSpeedNames) as [NonNullable<TextMotion['speed']>, string][]).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
    {speed === 'duration' && number('逐字显示时长（秒）', current.duration ?? 1, duration => change({ duration }), value => value > 0, .1)}
    {speed === 'cps' && number('每秒字数', current.cps ?? 20, cps => change({ cps }), value => value > 0)}
    <TextAnimatorFields phase="entrance" motion={current} onChange={change} />
    <Field label="持续效果"><select aria-label="持续效果" value={loop} onChange={event => change({ loop: event.target.value as TextMotion['loop'], loopStrength: undefined, loopSpeed: undefined })}>{textLoopEffects.map(id => <option key={id} value={id}>{textLoopNames[id]}</option>)}</select></Field>
    {loop !== 'none' && number(loop === 'pulse' ? '明暗变化 %' : '幅度（像素）', current.loopStrength ?? defaultLoopStrength[loop], loopStrength => change({ loopStrength }), value => value >= 0)}
    {(loop === 'wave' || loop === 'pulse') && number('每秒次数', current.loopSpeed ?? defaultLoopSpeed[loop], loopSpeed => change({ loopSpeed }), value => value > 0, .1)}
    <TextAnimatorFields phase="exit" motion={current} onChange={change} clip />
    <p className="text-look-hint muted">退场在显示时长结束前播放完。时长为 0 时持续显示，不播放逐字退场；可用“隐藏对象”结束显示。</p>
  </details>;
}
