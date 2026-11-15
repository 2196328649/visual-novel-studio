import { useEffect, useState } from 'react';
import type { UiComponent } from '../core/model';
import { uiControlRangeProblem, type UiControlDefinition, type UiControlRange } from '../core/ui-control-properties';
import { Field } from './components';
import { NumberInput } from './NumberInput';
import { UiPropertyGroup } from './UiPropertyGroup';

const rangeKeys = ['min', 'max', 'step'] as const;
const rangeProperties = { min: 'minimum', max: 'maximum', step: 'step' } as const;
const rangeLabels = { min: '控件范围下限', max: '控件范围上限', step: '用户调整步长' } as const;

/** A small atomic editor: changing both endpoints never saves an invalid intermediate range. */
export function UiControlRangeFields({ component, control, edit }: {
  component: UiComponent; control?: UiControlDefinition; edit: (change: (component: UiComponent) => void, options?: { separate?: boolean }) => void;
}) {
  const range = control?.range ?? component.controlRange ?? { min: 0, max: 1, step: .01 };
  const [draft, setDraft] = useState(() => ({ min: String(range.min), max: String(range.max), step: String(range.step) }));
  useEffect(() => { setDraft({ min: String(range.min), max: String(range.max), step: String(range.step) }); }, [component.id, component.parameterId, component.preference, range.min, range.max, range.step]);
  const hasControls = rangeKeys.some(key => component.propertyControls?.[rangeProperties[key]]);
  const editable = rangeKeys.filter(key => !component.propertyControls?.[rangeProperties[key]]);
  const mergeEditable = (target: UiComponent, values: UiControlRange): UiControlRange => {
    const next = { ...(target.controlRange ?? range) };
    for (const key of rangeKeys) if (!target.propertyControls?.[rangeProperties[key]]) next[key] = values[key];
    return next;
  };
  // A field may become linked while an unapplied draft exists. Only visible,
  // unlinked fields may participate in the atomic design-default update.
  const next = mergeEditable(component, Object.fromEntries(rangeKeys.map(key => [key, draft[key].trim() === '' ? NaN : Number(draft[key])])) as unknown as UiControlRange);
  const problem = !control || control.type !== 'number' ? '范围覆盖只适用于已绑定的数值控件。' : uiControlRangeProblem(control, next);
  const source = control?.sourceRange;
  const dirty = editable.some(key => next[key] !== range[key]);
  const restored = source && mergeEditable(component, source);
  const restoreProblem = hasControls && restored ? uiControlRangeProblem(control, restored) : undefined;
  const canRestore = !!component.controlRange && (!hasControls || !!restored && editable.some(key => restored[key] !== range[key]) && !restoreProblem);
  return <UiPropertyGroup id="control-range" className="ui-control-range" title={component.controlRange ? '控件数值范围 · 已单独设置' : '自定义控件范围'} summary={`${range.min}～${range.max} · 步长 ${range.step}${!component.controlRange ? ' · 跟随来源' : ''}`} defaultOpen={!!component.controlRange} searchKeywords="控件范围 下限 上限 最小 最大 步长 恢复 来源">
    <p className="muted ui-field-help">只限制这个控件的显示和玩家输入，不改变来源参数。</p>
    {hasControls && <p className="muted ui-field-help">应用或恢复范围只修改未关联项；已关联项的原设计默认值保留，当前显示仍由参数决定。</p>}
    {source && <p className="muted ui-field-help">来源范围：{source.min}～{source.max}，步长 {source.step}。</p>}
    <div className="field-row">{rangeKeys.map(key => <Field key={key} label={rangeLabels[key]} uiProperty={rangeProperties[key]}><NumberInput aria-label={rangeLabels[key]} type="number" step="any" value={draft[key]} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} /></Field>)}</div>
    {problem && <p role="alert" className="ui-field-help">{problem}</p>}
    {dirty && !problem && <p className="muted ui-field-help" role="status">范围已修改，应用后生效。</p>}
    <button type="button" className="small-button" disabled={!!problem || !editable.length || !dirty && (!!component.controlRange || hasControls)} onClick={() => edit(target => { target.controlRange = mergeEditable(target, next); }, { separate: true })}>应用整个控件范围</button>
    <button type="button" className="text-button" disabled={!canRestore} title={restoreProblem ? '保留已关联项默认值时无法恢复：' + restoreProblem : hasControls ? '只恢复未关联项；已关联项的原设计默认值保留。' : undefined} onClick={() => edit(target => {
      if (!rangeKeys.some(key => target.propertyControls?.[rangeProperties[key]])) delete target.controlRange;
      else if (source) target.controlRange = mergeEditable(target, source);
    }, { separate: true })}>{hasControls ? '恢复未关联项的来源范围' : '恢复绑定源范围'}</button>
    <UiPropertyGroup id="control-range-help" className="ui-control-range-help" title="范围如何生效" searchKeywords="数值 显示 参数 引擎边界 步长 程序"><p className="muted ui-field-help">缩小后再扩大范围会重新显示原来源值；程序赋值不按步长取整。{control?.preference ? '玩家设置不能超出此引擎边界。' : '参数范围是默认显示设置，不限制作品状态。'}</p></UiPropertyGroup>
  </UiPropertyGroup>;
}
