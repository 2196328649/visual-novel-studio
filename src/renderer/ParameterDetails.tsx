import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { effectiveUiComponents, localUiComponents, uiComponentLimit, variableAssetKind, type Project, type Variable } from '../core/model';
import { createParameterControl, parameterControlPageProblem, parameterKindNames, parameterNameProblem, parameterRange, parameterResetsWithSettings, parameterSets, parameterSetFor, type ParameterKind } from '../core/parameter-sets';
import { changeParameterStorage, parameterUsages, type ParameterUsage } from '../core/parameter-usages';
import { displayScale } from '../core/preferences';
import { uiPages } from '../core/ui-pages';
import type { Commit } from './editor';
import { Field, ParameterKindSelect, ValueInput } from './components';
import { NumberInput } from './NumberInput';
import { ParameterNameInput } from './ParameterNameInput';
import { ParameterUsageList } from './ParameterUsageList';
import { ParameterBehaviorFields } from './ParameterBehaviorFields';

type EditParameter = (change: (variable: Variable) => void) => void;

/** Numeric presentation belongs to an explicitly placed control, independently of storage. */
function ParameterNumberControlFields({ variable, edit }: { variable: Variable; edit: EditParameter }) {
  const scale = displayScale(variable.setting ?? {});
  return <>
    <h4>滑条范围</h4>
    <p className="parameter-help">限制玩家操作控件时的范围，剧情与蓝图仍可写入其他数值。步长是每次调整的间隔。</p>
    <div className="field-row parameter-range-fields">{(['min', 'max', 'step'] as const).map(key => <Field key={key} label={{ min: '最小值', max: '最大值', step: '步长' }[key]}>
      <NumberInput type="number" step="any" aria-label={{ min: '滑条最小值', max: '滑条最大值', step: '滑条步长' }[key]} value={+(parameterRange(variable)[key] * scale).toFixed(6)} onChange={event => {
        const next = event.target.valueAsNumber / scale;
        if (!Number.isFinite(next)) return;
        edit(v => {
          const range = parameterRange(v);
          range[key] = key === 'step' ? Math.max(.0001, next) : next;
          if (range.min >= range.max) { if (key === 'min') range.max = range.min + range.step; else range.min = range.max - range.step; }
          v.setting = { ...v.setting, ...range };
        });
      }} />
    </Field>)}</div>
    <div className="parameter-inline-fields">
      <Field label="显示方式" hint="百分比按 0～1 保存，在这里按 0～100% 显示和输入。"><select aria-label="数值显示方式" value={variable.setting?.display ?? 'number'} onChange={event => {
        const display = event.target.value as 'number' | 'percent';
        edit(v => {
          const moved = display === 'percent' && !v.setting?.display && parameterRange(v).max > 1 && v.setting?.max === undefined;
          v.setting = { ...v.setting, display: display === 'percent' ? display : undefined, ...(display === 'percent' ? { unit: undefined } : {}), ...(moved ? { min: 0, max: 1, step: .01 } : {}) };
        });
      }}><option value="number">数值</option><option value="percent">百分比</option></select></Field>
      {variable.setting?.display !== 'percent' && <Field label="单位" hint="显示在数值后面，例如秒、点、字/秒。"><input aria-label="数值单位" maxLength={12} value={variable.setting?.unit ?? ''} onChange={event => {
        const unit = event.target.value;
        edit(v => { v.setting = { ...v.setting, unit: unit || undefined }; });
      }} /></Field>}
    </div>
  </>;
}

function ParameterControlPlacement({ project, variable, commit, openUi }: {
  project: Project; variable: Variable; commit: Commit; openUi: (id: string, pageId?: string) => void;
}) {
  const pages = useMemo(() => uiPages(project).filter(page => !parameterControlPageProblem(project, page.id)), [project]);
  const [requestedPageId, setRequestedPageId] = useState('ui:preferences');
  const [error, setError] = useState('');
  const target = pages.find(page => page.id === requestedPageId) ?? pages[0];
  const custom = target && !target.template ? project.ui.customPages.find(page => page.id === target.id) : undefined;
  const components = target ? custom?.components ?? effectiveUiComponents(project.ui).filter(component => component.page === target.kind) : [];
  const control = components.find(component => ['preference', 'preferenceChoice'].includes(component.kind) && component.parameterId === variable.id);
  const full = !control && (custom?.components ?? localUiComponents(project.ui)).length >= uiComponentLimit;
  const place = () => {
    if (!target) return;
    setError('');
    try {
      if (control) { openUi(control.id, target.id); return; }
      let id = '';
      commit('添加参数控件', draft => { id = createParameterControl(draft, variable.id, target.id); }, { separate: true });
      openUi(id, target.id);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  };
  return <div className="parameter-control-placement">
    <Field label="目标界面"><select aria-label="目标界面" value={target?.id ?? ''} disabled={!pages.length} onChange={event => { setRequestedPageId(event.target.value); setError(''); }}>
      {!pages.length && <option value="">暂无可用界面</option>}
      {pages.map(page => <option key={page.id} value={page.id}>{page.name}</option>)}
    </select></Field>
    <button type="button" className="small-button" data-parameter-control-action={control ? 'locate' : 'create'} disabled={!target || full} onClick={place}>
      {control ? `定位“${target!.name}”中的控件` : `添加控件到“${target?.name ?? '界面'}”`}
    </button>
    {full && <p className="parameter-help">目标界面的控件已达上限，请先移除不需要的控件。</p>}
    {!pages.length && <p className="parameter-help">先在界面库中添加或启用一个界面。</p>}
    {error && <p className="parameter-form-error" role="alert">{error}</p>}
  </div>;
}

export function ParameterDetails({ project, variable, edit, commit, onRename, move, remove, changeKind, openUi, locate, copyReference }: {
  project: Project; variable: Variable; edit: EditParameter; commit: Commit;
  onRename: (name: string) => void;
  move: (setId: string) => void; remove: () => void; changeKind: (kind: ParameterKind) => void;
  openUi?: (id: string, pageId?: string) => void; locate?: (usage: ParameterUsage) => void; copyReference: () => void;
}) {
  const usages = useMemo(() => parameterUsages(project, variable.id), [project, variable.id]);
  const sets = parameterSets(project), set = parameterSetFor(project, variable);
  const asset = variableAssetKind(variable);
  const resetWithSettings = parameterResetsWithSettings(project, variable);
  const scale = displayScale(variable.setting ?? {}), unit = variable.setting?.display === 'percent' ? '%' : variable.setting?.unit;
  return <aside className="parameter-detail parameter-variable-detail" aria-label="参数设置">
    <header><div><small>参数</small><h2>{variable.name || '未命名参数'}</h2></div></header>
    <section className="parameter-detail-section parameter-common-fields" aria-label="通用属性">
      <Field label="参数名称"><ParameterNameInput label="参数名称" value={variable.name} problem={name => parameterNameProblem(project, name, variable.id)} onCommit={onRename} /></Field>
      <Field label="参数类型" hint="改变类型会重置初始值，并清除原来的控件范围或选项。"><ParameterKindSelect variable={variable} onKindChange={changeKind} /></Field>
      <Field label={'初始值' + (unit ? `（${unit}）` : '')}>
        {variable.type === 'number' && scale !== 1
          ? <NumberInput aria-label="初始值" type="number" step="any" value={+(Number(variable.initial) * scale).toFixed(4)} onChange={event => {
            const next = event.target.valueAsNumber;
            if (Number.isFinite(next)) edit(v => { v.initial = next / scale; });
          }} />
          : <ValueInput label="初始值" project={project} variable={variable} value={variable.initial} onChange={value => edit(v => { v.initial = value; })} />}
      </Field>
      <ParameterBehaviorFields value={{ persistent: variable.persistent, resetWithSettings }} onChange={next => {
        commit('参数保存与恢复配置', draft => {
          changeParameterStorage(draft, variable.id, next.persistent);
          const parameter = draft.variables.find(item => item.id === variable.id);
          if (parameter) parameter.resetWithSettings = next.resetWithSettings;
        }, { separate: true });
      }} />
      <p className="parameter-help parameter-lifecycle-summary">{variable.persistent ? '跨存档保留本机已有值，开始新游戏也保留。' : '开始新游戏时使用初始值，读档时恢复存档中的值。'}</p>
      <details className="parameter-lifecycle-details"><summary>保存行为说明</summary>
        <dl className="parameter-lifecycle">
          <div><dt>开始新游戏</dt><dd>{variable.persistent ? '保留本机已有值' : '恢复初始值'}</dd></div>
          <div><dt>读取存档</dt><dd>{variable.persistent ? '保留本机已有值，不随旧存档回退' : '恢复该存档中的值'}</dd></div>
          <div><dt>退出后重新打开</dt><dd>{variable.persistent ? '继续保留本机已有值' : '读档可继续；新游戏从初始值开始'}</dd></div>
          <div><dt>恢复初始设置</dt><dd>{resetWithSettings ? '恢复这个参数的初始值' : '保持这个参数的值'}</dd></div>
        </dl>
        <p className="parameter-help">这里编辑的是初始值，不会立即改变正在试玩的游戏。未保存的剧情进度不会单独保存；返回标题不等于删除存档。</p>
      </details>
    </section>
    {asset ? <section className="parameter-detail-section"><h3>如何使用</h3>
      <p className="parameter-help">{{ image: '保存一张图片，例如玩家选择的头像或结局插图。', audio: '保存一段音频，例如当前主题曲。', video: '保存一段视频，例如解锁的过场动画。' }[asset]}</p>
      <ul className="parameter-usage">
        {asset !== 'audio' && <li>界面中的{parameterKindNames[asset]}组件：把“{asset === 'video' ? '视频' : '图片'}来源”选为这个参数，参数改变时自动更新。</li>}
        <li>剧情中：<code>@设置：{variable.name}=素材名</code> 换成其他{parameterKindNames[asset]}，写“无”清空。</li>
        <li>蓝图中：用“读取状态”取出后连到{{ image: '显示背景、设置控件属性', audio: '播放音乐、播放音效（参数为空时不播放）', video: '设置控件属性' }[asset]}。</li>
      </ul>
    </section> : <details className="ui-property-group parameter-advanced"><summary>界面控件（可选）</summary>
      <p className="parameter-help">参数可以只供剧情或蓝图使用。需要让玩家调整时，再选择界面并添加控件；此处的配置不会自动生成菜单。</p>
      {variable.type === 'number' && <ParameterNumberControlFields variable={variable} edit={edit} />}
      {variable.type === 'string' && <Field label="可选项" layout="stacked" hint="每行一个选项；留空时，玩家可以自由输入文字。"><textarea aria-label="可选项" value={variable.setting?.options?.join('\n') ?? ''} onChange={event => {
        const options = event.target.value ? event.target.value.split('\n').slice(0, 64).map(value => value.slice(0, 200)) : undefined;
        edit(v => { v.setting = { ...v.setting, options }; });
      }} /></Field>}
      {variable.type === 'boolean' && <p className="parameter-help">开关参数使用开启／关闭控件，无需配置范围。</p>}
      {openUi && <ParameterControlPlacement project={project} variable={variable} commit={commit} openUi={openUi} />}
    </details>}
    <details className="ui-property-group parameter-advanced"><summary>分组与引用 · {usages.length} 处</summary>
      <div className="parameter-inline-fields"><Field label="所属参数集"><select aria-label="所属参数集" value={set.id} onChange={event => move(event.target.value)}>{sets.map(set => <option key={set.id} value={set.id}>{set.name}</option>)}</select></Field></div>
      <p className="parameter-help">移动分组保留已有引用、保存和恢复配置。这里列出直接绑定；控件事件会继续沿用控件的绑定。</p>
      <ParameterUsageList usages={usages} locate={locate} />
      <button type="button" className="small-button" onClick={copyReference}>复制文本引用</button>
    </details>
    <footer><button type="button" className="small-button danger-text" onClick={remove}><Trash2 size={13} />删除参数</button></footer>
  </aside>;
}
