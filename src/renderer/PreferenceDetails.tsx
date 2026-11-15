import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Project } from '../core/model';
import { displayScale, formatNumber, playerPreferences, preferenceInfo, preferenceInRange, preferenceRangeProblem, type PlayerPreference } from '../core/preferences';
import { parameterKindNames } from '../core/parameter-sets';
import type { Commit } from './editor';
import { Field } from './components';
import { NumberInput } from './NumberInput';
import { ParameterDefaultInput } from './ParameterDefaultInput';

type Own = NonNullable<NonNullable<Project['playerPreferenceSettings']>[PlayerPreference]>;
const shownNumber = (value: number) => +value.toFixed(6);

/** A built-in setting in the same panel layout as a custom parameter; only its kind and removal are fixed. */
export function PreferenceDetails({ project, preference, commit, onNameChange }: { project: Project; preference: PlayerPreference; commit: Commit; onNameChange: (name: string) => void }) {
  const base = playerPreferences[preference], info = preferenceInfo(project, preference);
  const own = project.playerPreferenceSettings?.[preference];
  const [rangeError, setRangeError] = useState('');
  const scale = displayScale(info), number = base.type === 'number', unit = info.display === 'percent' ? '%' : info.unit;
  const changeOwn = (label: string, change: (own: Own, draft: Project) => void) => commit(label, draft => {
    const next: Own = { ...draft.playerPreferenceSettings?.[preference] };
    change(next, draft);
    for (const key of Object.keys(next) as (keyof Own)[]) if (next[key] === undefined) delete next[key];
    const all = { ...draft.playerPreferenceSettings };
    if (Object.keys(next).length) all[preference] = next; else delete all[preference];
    if (Object.keys(all).length) draft.playerPreferenceSettings = all; else delete draft.playerPreferenceSettings;
  });
  const setRange = (key: 'min' | 'max' | 'step', typed: number) => {
    if (!Number.isFinite(typed)) return;
    const value = typed / scale, range = { min: info.min, max: info.max, step: info.step, [key]: value };
    // Moving one end past the other carries the other end along, so a whole new range can be typed in any order.
    if (key === 'min' && range.min >= range.max) range.max = range.min + range.step;
    if (key === 'max' && range.max <= range.min) range.min = Math.max(base.limit!.min, range.max - range.step);
    const problem = preferenceRangeProblem(preference, range);
    setRangeError(problem ?? '');
    if (problem) return;
    changeOwn('游戏设置范围', (next, draft) => {
      next.min = range.min === base.min ? undefined : range.min;
      next.max = range.max === base.max ? undefined : range.max;
      next.step = range.step === base.step ? undefined : range.step;
      // The initial value follows the range, so the first run never starts outside it.
      const fitted = { ...info, ...range };
      if (!preferenceInRange(fitted, info.initial)) draft.playerDefaults = { ...draft.playerDefaults, [preference]: Math.max(range.min, Math.min(range.max, Number(info.initial))) };
    });
  };
  return <aside className="parameter-detail" aria-label="内置设置" data-preference={preference}>
    <header><div><small>内置游戏设置</small><h2>{info.name}</h2></div></header>
    <section className="parameter-detail-section"><h3>基本信息</h3>
      <div className="field-row">
        <Field label="显示名称" hint={'设置菜单和蓝图中显示的名称；留空使用“' + base.name + '”。'}><input aria-label="显示名称" maxLength={40} placeholder={base.name} value={own?.name ?? ''} onChange={event => { const name = event.target.value; changeOwn('游戏设置名称', next => { next.name = name.trim() ? name : undefined; }); onNameChange(name.trim() || base.name); }} /></Field>
        <Field label="参数类型"><input aria-label="参数类型" readOnly value={parameterKindNames[base.type] + ' · 内置'} /></Field>
      </div>
      <Field label="初始值"><ParameterDefaultInput project={project} label={'初始' + base.name} preference={preference} value={project.playerDefaults?.[preference]} onChange={value => commit('游戏设置默认值', draft => { draft.playerDefaults = { ...draft.playerDefaults, [preference]: value }; })} /></Field>
      <p className="parameter-help">玩家第一次打开游戏和“恢复初始设置”时使用。玩家改过的设置保存在本机，不会被这里覆盖。{base.help ? ' ' + base.help : ''}</p>
    </section>
    <section className="parameter-detail-section"><h3>默认设置菜单</h3>
      <label className="parameter-toggle"><input type="checkbox" aria-label="显示在默认设置菜单" checked={info.visible} onChange={event => { const visible = event.target.checked; changeOwn('游戏设置显示', next => { next.visible = visible ? undefined : false; }); }} />显示在默认设置菜单</label>
      {!info.visible && <p className="parameter-help">玩家在默认菜单里看不到这项；初始值、蓝图和你放在界面上的控件仍然有效。</p>}
      {number && <><h4>滑条范围</h4>
        <p className="parameter-help">玩家拖动滑条时的范围{unit ? `（单位：${unit}）` : ''}。蓝图不受这个范围限制；玩家本机存的值超出范围时，启动游戏时会调整到范围内。</p>
        <div className="field-row">{(['min', 'max', 'step'] as const).map(key => <Field key={key} label={{ min: '最小值', max: '最大值', step: '步长' }[key]}><NumberInput aria-label={{ min: '滑条最小值', max: '滑条最大值', step: '滑条步长' }[key]} type="number" step="any" value={shownNumber(info[key] * scale)} onChange={event => setRange(key, event.target.valueAsNumber)} /></Field>)}</div>
        {rangeError && <p className="parameter-help danger-text" role="alert">{rangeError}</p>}
        <p className="parameter-help">当前：{formatNumber(info.min, info)} ～ {formatNumber(info.max, info)}{preference === 'textSpeed' && info.min === 0 ? '，滑条最右端为立即显示' : ''}</p>
        {base.limit?.max === 1 ? <Field label="显示方式"><select aria-label="显示方式" value={info.display ?? 'number'} onChange={event => { const display = event.target.value as 'number' | 'percent'; changeOwn('游戏设置显示方式', next => { next.display = display === base.display ? undefined : display; }); }}><option value="percent">百分比</option><option value="number">小数（0～1）</option></select></Field>
          : <Field label="单位"><input aria-label="单位" maxLength={12} placeholder={base.unit} value={own?.unit ?? base.unit ?? ''} onChange={event => { const typed = event.target.value; changeOwn('游戏设置单位', next => { next.unit = typed === base.unit ? undefined : typed; }); }} /></Field>}
      </>}
    </section>
    <footer><button type="button" className="small-button" disabled={!own && project.playerDefaults?.[preference] === undefined} onClick={() => { setRangeError(''); changeOwn('恢复游戏设置', (next, draft) => {
      for (const key of Object.keys(next) as (keyof Own)[]) delete next[key];
      if (draft.playerDefaults) { const { [preference]: _removed, ...rest } = draft.playerDefaults; draft.playerDefaults = Object.keys(rest).length ? rest : undefined; }
    }); onNameChange(base.name); }}><RotateCcw size={13} />恢复这一项的默认设置</button></footer>
  </aside>;
}
