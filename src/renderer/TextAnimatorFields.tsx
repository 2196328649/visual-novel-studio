import type { ReactNode } from 'react';
import { textEasings, textEntranceEffects, textOrders, type TextAnimation, type TextMotion } from '../core/model';
import { entranceAnimations, exitAnimations, fullAnimation, textEasingNames, textOrderNames } from '../core/text-animation';
import { defaultEntranceTime, defaultExitTime, defaultExitTotal, textEntranceNames, textExitNames } from '../core/text-presentation';
import { Field } from './components';
import { NumberInput } from './NumberInput';

type Phase = 'entrance' | 'exit';
type Wrap = (key: keyof TextMotion, field: ReactNode) => ReactNode;

/** One entrance or exit: pick a named effect, then adjust any part of it. Shared by dialogue and timeline text. */
export function TextAnimatorFields({ phase, motion, onChange, wrap = (_key, field) => field, clip = false }: { phase: Phase; motion: TextMotion; onChange: (patch: Partial<TextMotion>) => void; wrap?: Wrap; /** On a timeline clip, where the exit ends with the clip rather than following a click. */ clip?: boolean }) {
  const entering = phase === 'entrance', word = entering ? '入场' : '退场';
  const name = (entering ? motion.entrance : motion.exit) ?? 'none';
  const own = entering ? motion.entranceAnimation : motion.exitAnimation;
  const animationKey = entering ? 'entranceAnimation' : 'exitAnimation';
  const full = name === 'none' ? undefined : fullAnimation(entering ? entranceAnimations : exitAnimations, name, own);
  const adjust = (patch: TextAnimation) => {
    const next = { ...own, ...patch };
    for (const key of Object.keys(next) as (keyof TextAnimation)[]) if (next[key] === undefined) delete next[key];
    onChange({ [animationKey]: Object.keys(next).length ? next : undefined });
  };
  const number = (label: string, value: number, change: (value: number) => void, step = 1, valid: (value: number) => boolean = () => true) => <Field label={label}><NumberInput aria-label={label} type="number" step={step} value={+value.toFixed(4)} onChange={event => { const next = event.target.valueAsNumber; if (Number.isFinite(next) && valid(next)) change(next); }} /></Field>;
  return <>
    {wrap(entering ? 'entrance' : 'exit', <Field label={word + '效果'}><select aria-label={word + '效果'} value={name} onChange={event => { const value = event.target.value as NonNullable<TextMotion['entrance']>; onChange(entering ? { entrance: value, entranceAnimation: undefined } : { exit: value, exitAnimation: undefined }); }}>{textEntranceEffects.map(id => <option key={id} value={id}>{(entering ? textEntranceNames : textExitNames)[id]}</option>)}</select></Field>)}
    {full && <>
      {entering
        ? wrap('entranceTime', number('每个字入场时间（秒）', motion.entranceTime ?? defaultEntranceTime[name], value => onChange({ entranceTime: value }), .05, value => value >= 0))
        : <>
          {wrap('exitTotal', number('退场总时长（秒）', motion.exitTotal ?? defaultExitTotal, value => onChange({ exitTotal: value }), .05, value => value > 0))}
          {wrap('exitTime', number('每个字退场时间（秒）', motion.exitTime ?? defaultExitTime, value => onChange({ exitTime: value }), .05, value => value >= 0))}
        </>}
      {!entering && !clip && <p className="text-look-hint muted">玩家点击后播放，再次点击可跳过。快进和回退时不播放。</p>}
      <details className="ui-property-group text-animator" open={!!own}><summary>调整{word}动画{own ? ' · 已调整' : ''}</summary>
        <p className="text-look-hint muted">{entering ? '每个字从这里设置的状态变到正常。' : '每个字从正常变到这里设置的状态后消失。'}</p>
        <div className="field-row">
          {number(word + '横向位移', full.x, x => adjust({ x }))}
          {number(word + '纵向位移', full.y, y => adjust({ y }))}
        </div>
        <div className="field-row">
          {number(word + '缩放 %', full.scale * 100, value => adjust({ scale: value / 100 }), 10)}
          {number(word + '旋转角度', full.rotation, rotation => adjust({ rotation }), 15)}
        </div>
        <div className="field-row">
          {number(word + '不透明度 %', full.opacity * 100, value => adjust({ opacity: value / 100 }), 10, value => value >= 0 && value <= 100)}
          <Field label={word + '水平翻转'}><input aria-label={word + '水平翻转'} type="checkbox" checked={full.flip} onChange={event => adjust({ flip: event.target.checked })} /></Field>
        </div>
        <div className="field-row">
          <Field label={word + '运动曲线'}><select aria-label={word + '运动曲线'} value={full.easing} onChange={event => adjust({ easing: event.target.value as TextAnimation['easing'] })}>{textEasings.map(id => <option key={id} value={id}>{textEasingNames[id]}</option>)}</select></Field>
          <Field label={word + '顺序'}><select aria-label={word + '顺序'} value={full.order} onChange={event => adjust({ order: event.target.value as TextAnimation['order'] })}>{textOrders.map(id => <option key={id} value={id}>{textOrderNames[id]}</option>)}</select></Field>
        </div>
        {own && <button type="button" className="small-button" onClick={() => onChange({ [animationKey]: undefined })}>恢复这个效果的默认动画</button>}
      </details>
    </>}
  </>;
}
