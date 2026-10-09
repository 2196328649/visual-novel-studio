import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { effectiveUiComponents, localUiComponents, uiComponentLimit, type Project, type Variable } from '../core/model';
import { createParameterControl, parameterRange, parameterSets, parameterSetFor } from '../core/parameter-sets';
import type { Commit } from './editor';
import { Field, ValueInput } from './components';
import { NumberInput } from './NumberInput';

export function ParameterDetails({ project, variable, edit, commit, move, remove, openUi }: { project: Project; variable: Variable; edit: (change: (variable: Variable) => void) => void; commit: Commit; move: (setId: string) => void; remove: () => void; openUi?: (id: string) => void }) {
  const [deleting, setDeleting] = useState(false);
  const sets = parameterSets(project), set = parameterSetFor(project, variable);
  const control = effectiveUiComponents(project.ui).find(c => c.parameterId === variable.id && c.page === 'preferences');
  return <aside className="parameter-detail" aria-label="参数设置">
    <header><div><small>参数设置</small><h2>{variable.name || '未命名参数'}</h2></div><span className="parameter-storage-tag">{variable.persistent ? '本地持久化' : '随存档保存'}</span></header>
    <section className="parameter-detail-section"><h3>基本信息</h3><div className="field-row">
      <Field label="参数名称"><input value={variable.name} onChange={event => edit(v => { v.name = event.target.value; })} /></Field>
      <Field label="参数类型" hint="改变类型会将初始值重置，并清除原来的控件范围或选项。"><select value={variable.type} onChange={event => edit(v => { v.type = event.target.value as Variable['type']; v.initial = v.type === 'number' ? 0 : v.type === 'boolean' ? false : ''; v.setting = undefined; })}><option value="number">数值</option><option value="boolean">开关</option><option value="string">文字</option></select></Field>
    </div><Field label="初始值"><ValueInput label="初始值" variable={variable} value={variable.initial} onChange={value => edit(v => { v.initial = value; })} /></Field><p className="parameter-help">{variable.persistent ? '玩家本机还没有这个参数时使用初始值。修改这里不会覆盖玩家已经保存的值。' : '开始新游戏时使用初始值；读档会恢复存档记录的值。'}这里编辑的是默认值，不是正在试玩中的实时值。</p></section>
    <section className="parameter-detail-section"><h3>保存在哪里</h3><div className="parameter-storage-options" role="group" aria-label="参数存储方式">
      <button type="button" aria-pressed={!variable.persistent} onClick={() => edit(v => { v.persistent = false; })}><strong>随存档保存</strong><span>好感度、剧情进度、背包等</span></button>
      <button type="button" aria-pressed={variable.persistent} onClick={() => edit(v => { v.persistent = true; })}><strong>本地持久化</strong><span>全局解锁、跨周目记录、自定义设置</span></button>
    </div><dl className="parameter-lifecycle"><div><dt>开始新游戏</dt><dd>{variable.persistent ? '保留本机已有值' : '恢复初始值'}</dd></div><div><dt>读取存档</dt><dd>{variable.persistent ? '保留本机已有值，不随旧存档回退' : '恢复该存档中的值'}</dd></div><div><dt>退出后重新打开游戏</dt><dd>{variable.persistent ? '继续保留本机已有值' : '读档可继续；新游戏从初始值开始'}</dd></div></dl><p className="parameter-help">{variable.persistent ? '保存在玩家本地的游戏数据中，不随单个存档保存。游戏设置中的“恢复默认”可重置属于玩家设置的参数。' : '未保存的剧情进度不会单独持久化；返回标题不等于删除存档。'}目前没有独立的“每次启动都清空且不进存档”模式。</p></section>
    <details className="ui-property-group parameter-advanced"><summary>界面控件（可选）{control ? ' · 已绑定' : ''}</summary><p className="parameter-help">只有需要让玩家操作这个参数时才配置。剧情中的 @设置、读取状态和设置状态不需要这里的控件。</p>
      {set.kind === 'settings' && <label className="parameter-toggle"><input type="checkbox" checked={variable.setting?.visible !== false} onChange={event => edit(v => { v.setting = { ...v.setting, visible: event.target.checked }; })} />显示在默认设置菜单</label>}
      {variable.type === 'number' && <><h4>滑条范围</h4><p className="parameter-help">控制玩家拖动滑条时的范围，不限制剧情或蓝图赋值。步长是每次调整的间隔。</p><div className="field-row">{(['min', 'max', 'step'] as const).map(key => <Field key={key} label={{ min: '最小值', max: '最大值', step: '步长' }[key]}><NumberInput aria-label={'设置滑条' + key} type="number" step="any" value={parameterRange(variable)[key]} onChange={event => { const next = Number(event.target.value); if (!Number.isFinite(next)) return; edit(v => { const range = parameterRange(v); range[key] = key === 'step' ? Math.max(.0001, next) : next; if (range.min >= range.max) { if (key === 'min') range.max = range.min + range.step; else range.min = range.max - range.step; } v.setting = { ...v.setting, ...range }; }); }} /></Field>)}</div></>}
      {variable.type === 'string' && <Field label="可选项" hint="每行一个选项；留空时，玩家可以自由输入文字。"><textarea value={variable.setting?.options?.join('\n') ?? ''} onChange={event => edit(v => { v.setting = { ...v.setting, options: event.target.value ? event.target.value.split('\n').slice(0, 64).map(value => value.slice(0, 200)) : undefined }; })} /></Field>}
      {variable.type === 'boolean' && <p className="parameter-help">开关参数会显示为开启／关闭控件，无需设置滑条范围。</p>}
      {openUi && <button type="button" className="small-button" disabled={localUiComponents(project.ui).length >= uiComponentLimit && !control} onClick={() => { let id = ''; commit('添加参数设置控件', draft => { id = createParameterControl(draft, variable.id); }); openUi(id); }}>{control ? '定位已有设置控件' : '添加到设置界面'}并调整布局</button>}
    </details>
    <details className="ui-property-group parameter-advanced"><summary>分组与引用</summary><Field label="所属参数集"><select value={set.id} onChange={event => move(event.target.value)}>{sets.map(set => <option key={set.id} value={set.id}>{set.name}</option>)}</select></Field><p className="parameter-help">移动分组保留已有引用和存储方式。用文本中的 @设置 或蓝图的“读取状态、设置状态”使用此参数。</p><code className="parameter-example">@设置：{variable.name}=值</code></details>
    <footer>{deleting ? <><p>删除后引用此参数的剧情或控件需要重新绑定。可用编辑器撤销恢复。</p><button type="button" className="small-button" onClick={() => setDeleting(false)}>取消</button><button type="button" className="small-button danger-text" onClick={remove}>确认删除参数</button></> : <button type="button" className="small-button danger-text" onClick={() => setDeleting(true)}><Trash2 size={13} />删除参数</button>}</footer>
  </aside>;
}
