import { useEffect, useMemo, useRef, useState } from 'react';
import { uiProperties, uiPropertyApplies, uiPropertyDefault, type UiProperty } from '../core/ui-properties';
import { setUiPropertyControl, uiPropertyControlCandidates, uiPropertyControlChange, uiPropertyControlFor, uiPropertyControlKey, uiPropertyControlModes, uiPropertyControlProblem } from '../core/ui-property-control';
import { listUiParameterBindings, detachUiParameterBinding, type UiParameterBindingInfo } from '../core/ui-parameter-links';
import { addParameter, parameterNameProblem, parameterSetDefaults, parameterSetFor, parameterSets, storyParametersId, parameterKindNames, type ParameterKind } from '../core/parameter-sets';
import { NumberInput } from './NumberInput';
import type { ParameterDefaults, Project, UiComponent, UiPropertyControl, Variable, VariableValue } from '../core/model';
import type { Commit } from './editor';
import { componentName } from './UiNames';
import { UiPropertyGroup } from './UiPropertyGroup';
import { useUiInspectorGroupActive } from './UiInspectorContext';
import { ParameterBehaviorFields } from './ParameterBehaviorFields';
import './ui-control-authoring.css';

type ControlMode = keyof typeof uiPropertyControlModes;
type BindingMode = ControlMode | 'invalid';
type PendingControl = { mode: ControlMode; parameterId: string };
const knownProperty = (property: string): property is UiProperty => Object.hasOwn(uiProperties, property);
const propertyName = (property: string) => knownProperty(property) ? uiProperties[property].name : '未识别属性：' + property;
const validMode = (mode: unknown): mode is UiPropertyControl['mode'] => mode === 'follow' || mode === 'sync';

function propertyKind(property: string): ParameterKind | undefined {
  if (!knownProperty(property)) return;
  const info = uiProperties[property];
  if (!info.resource) return info.type;
  return ['image', 'audio', 'video'].includes(info.resource) ? info.resource as ParameterKind : undefined;
}

export function UiParameterBindings({ project, components, pageId, commit, selectedComponentId, onComponentSelect, onGraphChange, embedded = false, fixedSelection = false, disabled = false }: {
  project: Project; components: UiComponent[]; pageId: string; commit: Commit; selectedComponentId?: string;
  onComponentSelect: (id?: string) => void; onGraphChange: (id: string) => void;
  embedded?: boolean; fixedSelection?: boolean; disabled?: boolean;
}) {
  const [localComponentId, setLocalComponentId] = useState(selectedComponentId);
  const component = components.find(item => item.id === (embedded && !fixedSelection ? localComponentId : selectedComponentId)) ?? (!fixedSelection ? components[0] : undefined);
  const selectionKey = JSON.stringify([project.id, pageId, project.ui.activeInstanceId, selectedComponentId]);
  const lastSelection = useRef(selectionKey);
  useEffect(() => { if (lastSelection.current !== selectionKey) { lastSelection.current = selectionKey; setLocalComponentId(selectedComponentId); } }, [selectionKey, selectedComponentId]);
  useEffect(() => {
    if (!embedded && !fixedSelection && component?.id !== selectedComponentId) onComponentSelect(component?.id);
  }, [component?.id, selectedComponentId, onComponentSelect, embedded, fixedSelection]);
  const scope = JSON.stringify([project.id, pageId, pageId.startsWith('ui:') ? project.ui.activeInstanceId ?? 'base' : 'custom', component?.id]);
  return <fieldset disabled={disabled} className={'ui-parameter-bindings' + (embedded ? ' ui-parameter-bindings-embedded' : '')}>
    {!fixedSelection && <div className="workspace-toolbar ui-parameter-binding-fields"><label>控件<select aria-label="联动组件" value={component?.id ?? ''} onChange={event => embedded ? setLocalComponentId(event.target.value) : onComponentSelect(event.target.value)}>{components.map(item => <option key={item.id} value={item.id}>{componentName(item)}</option>)}</select></label></div>}
    {component ? <UiParameterBindingEditor key={scope} project={project} component={component} pageId={pageId} commit={commit} onGraphChange={onGraphChange} disabled={disabled} /> : <p className="ui-field-help">先选择一个控件，再设置属性来源。</p>}
  </fieldset>;
}

function UiParameterBindingEditor({ project, component, pageId, commit, onGraphChange, disabled }: {
  project: Project; component: UiComponent; pageId: string; commit: Commit; onGraphChange: (id: string) => void; disabled: boolean;
}) {
  const [property, setProperty] = useState('visible'), [pending, setPending] = useState<PendingControl>(), [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const active = useUiInspectorGroupActive(), lastBindings = useRef<UiParameterBindingInfo[]>([]);
  const bindings = useMemo(() => {
    // Keep unfinished form values when the group closes, without rescanning graphs.
    if (active) lastBindings.current = listUiParameterBindings(project, component.id, pageId);
    return lastBindings.current;
  }, [active, project, component.id, pageId]);
  const canonical = (key: string) => knownProperty(key) ? uiPropertyControlKey(project, component, key) : key;
  const available = [...new Set((Object.keys(uiProperties) as UiProperty[]).filter(key =>
    uiProperties[key].writable && uiProperties[key].bindable && propertyKind(key) && uiPropertyApplies(component, key, project)).map(canonical))];
  const linked = [...new Set([...Object.keys(component.propertyControls ?? {}).map(canonical), ...bindings.map(binding => canonical(binding.property))])];
  const properties = [...new Set([...available, ...linked])];
  const selectedProperty = properties.includes(property) ? property : properties[0] ?? 'visible';
  const applicable = available.includes(selectedProperty), known = knownProperty(selectedProperty);
  const savedKeys = Object.keys(component.propertyControls ?? {}).filter(key => canonical(key) === selectedProperty);
  const control = known ? uiPropertyControlFor(project, component, selectedProperty)?.control : component.propertyControls?.[selectedProperty];
  const mode: BindingMode = pending?.mode ?? (savedKeys.length ? validMode(control?.mode) ? control!.mode : 'invalid' : 'default');
  const current = bindings.filter(binding => canonical(binding.property) === selectedProperty);
  const managed = current.filter(binding => binding.managed), custom = current.filter(binding => !binding.managed);
  // A legacy ratio/index graph does not store the same units as the actual value.
  const parameterId = pending?.parameterId ?? control?.parameterId ?? (managed.length === 1 && managed[0].property === selectedProperty ? managed[0].variableId ?? '' : '');
  const variables = known ? uiPropertyControlCandidates(project, component, selectedProperty) : [];
  const variable = variables.find(item => item.id === parameterId), savedVariable = project.variables.find(item => item.id === control?.parameterId);
  const savedProblem = savedKeys.length ? uiPropertyControlProblem(project, component, selectedProperty, control!) : undefined;
  const proposedProblem = mode === 'default' ? uiPropertyControlChange(project, component, selectedProperty).problem
    : known && validMode(mode) && variable ? uiPropertyControlChange(project, component, selectedProperty, { mode, parameterId: variable.id }).problem : undefined;
  const kind = applicable ? propertyKind(selectedProperty) : undefined;
  const changed = mode === 'default' ? !!savedKeys.length || !!managed.length
    : validMode(mode) && (control?.mode !== mode || control?.parameterId !== parameterId || savedKeys.length !== 1 || savedKeys[0] !== selectedProperty || !!managed.length);
  const canApply = changed && !proposedProblem && (mode === 'default' || validMode(mode) && applicable && !!variable);
  const currentLabel = savedKeys.length ? validMode(control?.mode) ? uiPropertyControlModes[control!.mode] + '：' + (savedVariable?.name ?? '参数已删除') : '关联配置需要修复'
    : '默认设置' + (managed.length ? ' · 保留旧自动联动' : custom.length ? ' · 含蓝图控制' : '');
  const chooseProperty = (key: string) => { setProperty(key); setPending(undefined); setCreating(false); setNotice(''); };
  const failed = (error: unknown) => setNotice(error instanceof Error ? error.message : String(error));
  const apply = () => {
    if (disabled || !canApply) return;
    try {
      let applied = false;
      commit(mode === 'default' ? '恢复属性默认设置' : '关联控件属性与参数', draft => {
        setUiPropertyControl(draft, component.id, pageId, selectedProperty as UiProperty, mode === 'default' ? undefined : { mode, parameterId });
        applied = true;
      }, { separate: true });
      if (!applied) return;
      setPending(undefined); setCreating(false);
      setNotice(mode === 'default' ? '已恢复原设计设置；参数本身保持不变。' : mode === 'follow' ? '此属性已单向跟随参数。蓝图可修改来源参数。' : '此属性已与参数双向同步。蓝图或玩家改值会同步到参数。');
    } catch (error) { failed(error); }
  };
  const detach = (binding: UiParameterBindingInfo) => {
    if (disabled) return;
    try {
      let applied = false;
      commit('解除旧界面参数联动', draft => { detachUiParameterBinding(draft, binding.graphId, pageId); applied = true; }, { separate: true });
      if (applied) setNotice('已解除这项旧自动联动，原设计设置和来源参数保留。');
    } catch (error) { failed(error); }
  };
  const createParameter = (name: string, initial: VariableValue, setId: string, behavior: ParameterDefaults) => {
    if (disabled || !kind || !known || !validMode(mode)) return;
    try {
      let applied = false;
      const result: unknown = commit('创建参数并关联控件属性', draft => {
        if (draft.id !== project.id || draft.ui.activeInstanceId !== project.ui.activeInstanceId) return;
        const nameProblem = parameterNameProblem(draft, name);
        if (nameProblem) throw new Error(nameProblem);
        const id = addParameter(draft, setId, kind, behavior);
        const parameter = draft.variables.find(item => item.id === id)!;
        parameter.name = name.trim(); parameter.initial = initial;
        setUiPropertyControl(draft, component.id, pageId, selectedProperty, { mode, parameterId: id });
        applied = true;
      }, { separate: true });
      if (!applied || result === false) return;
      setPending(undefined); setCreating(false); setNotice('参数和属性关联已加入界面草稿，保存界面后生效。');
    } catch (error) { failed(error); }
  };
  return <>
    <p className="ui-field-help">也可在设计属性面板中，右键属性名称设置来源。</p>
    {notice && <p role="status" className="ui-field-help">{notice}</p>}
    <div className="workspace-toolbar ui-parameter-binding-fields">
      <label>属性<select aria-label="联动属性" value={selectedProperty} disabled={!properties.length} onChange={event => chooseProperty(event.target.value)}>{properties.map(key => <option key={key} value={key}>{propertyName(key)}{!available.includes(key) ? '（需要修复）' : ''}</option>)}</select></label>
      <label>控制方式<select aria-label="属性控制方式" value={mode} onChange={event => { setPending({ mode: event.target.value as ControlMode, parameterId }); setCreating(false); setNotice(''); }}>{mode === 'invalid' && <option value="invalid" disabled>已保存的控制方式无效</option>}{(Object.entries(uiPropertyControlModes) as [ControlMode, string][]).map(([key, name]) => <option key={key} value={key} disabled={key !== 'default' && !applicable}>{name}</option>)}</select></label>
      {validMode(mode) && <label>来源参数<select aria-label="联动参数" value={parameterId} onChange={event => { setPending({ mode, parameterId: event.target.value }); setNotice(''); }}><option value="">{variables.length ? '选择参数' : '需要匹配类型的参数'}</option>{parameterId && !variable && <option value={parameterId} disabled>参数已删除或类型不符</option>}{parameterSets(project).map(set => <optgroup key={set.id} label={set.name}>{variables.filter(item => parameterSetFor(project, item).id === set.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>)}</select></label>}
      <button type="button" className="small-button" disabled={!canApply} onClick={apply}>{mode === 'default' ? '恢复默认设置' : '应用关联'}</button>
      {kind && validMode(mode) && <button type="button" className="text-button" onClick={() => setCreating(value => !value)} aria-expanded={creating}>新建参数并联动</button>}
    </div>
    <p className="ui-field-help" data-ui-property-current-source={selectedProperty}>当前：{currentLabel}</p>
    <p className="muted ui-field-help">{mode === 'default' ? '使用原设计值、继承或系统来源，蓝图仍可调整。' : mode === 'follow' ? '显示参数的值；这一项属性不再接受直接改写。需要变化时修改来源参数。' : mode === 'sync' ? '显示参数的值；蓝图或玩家修改这一项属性时，也会更新参数和其他关联控件。' : '请选择有效的控制方式，或恢复默认设置。'}</p>
    {savedProblem && <p role="alert" className="ui-field-help">当前关联：{savedProblem}</p>}
    {proposedProblem && proposedProblem !== savedProblem && <p role="alert" className="ui-field-help">{proposedProblem}</p>}
    {!applicable && !!savedKeys.length && <p className="muted ui-field-help">这项关联当前不可使用，可以恢复默认设置；原数据在修改前会保留。</p>}
    {!!managed.length && <p className="muted ui-field-help">原自动联动保持原行为。应用控制方式时，会将这一属性的独立自动联动转换为新的设置。</p>}
    {!!current.length && <div className="ui-parameter-binding-list" aria-label="此属性的已有联动">{current.map(binding => {
      const source = project.variables.find(item => item.id === binding.variableId);
      return <div key={binding.graphId + '/' + binding.property} className="ui-parameter-binding-card" data-binding-graph={binding.graphId}>
        <strong>{binding.managed ? '旧自动联动' : '蓝图控制'}：{binding.sourceMissing ? '参数已删除' : source?.name ?? '由逻辑决定'}</strong>
        <span className="muted">{binding.graphName}</span>
        <div className="button-row"><button type="button" className="small-button" onClick={() => onGraphChange(binding.graphId)}>打开蓝图</button>{binding.managed && <button type="button" className="text-button danger-text" onClick={() => detach(binding)}>解除旧联动</button>}</div>
        {binding.reason && <p className="muted ui-field-help">{binding.reason}</p>}
      </div>;
    })}</div>}
    {!!custom.length && <p className="muted ui-field-help">自定义或共享蓝图会保留。单向跟随会限制它对这一属性的直接改写；双向同步会将改写送到来源参数。</p>}
    {!!linked.filter(key => key !== selectedProperty).length && <UiPropertyGroup id="parameter-links-other-fields" title="其他已关联属性" summary={linked.filter(key => key !== selectedProperty).length + ' 项'} searchKeywords="关联 联动 参数 蓝图 属性 来源">{linked.filter(key => key !== selectedProperty).map(key => <button key={key} type="button" className="text-button" onClick={() => chooseProperty(key)}>{propertyName(key)}</button>)}</UiPropertyGroup>}
    {creating && known && kind && validMode(mode) && <UiBindingParameter key={selectedProperty} project={project} component={component} property={selectedProperty} kind={kind} mode={mode} onCancel={() => setCreating(false)} onCreate={createParameter} />}
  </>;
}

function UiBindingParameter({ project, component, property, kind, mode, onCreate, onCancel }: {
  project: Project; component: UiComponent; property: UiProperty; kind: ParameterKind; mode: UiPropertyControl['mode'];
  onCreate: (name: string, initial: VariableValue, setId: string, behavior: ParameterDefaults) => void; onCancel: () => void;
}) {
  const { type, resource } = uiProperties[property];
  const [name, setName] = useState((componentName(component) + ' · ' + propertyName(property)).slice(0, 120));
  const [initial, setInitial] = useState<VariableValue>(() => uiPropertyDefault(project, component, property));
  const [setId, setSetId] = useState(storyParametersId);
  const [behavior, setBehavior] = useState<ParameterDefaults>({ persistent: false, resetWithSettings: false });
  const nameProblem = parameterNameProblem(project, name);
  // Validate exactly as an existing source without adding a parameter to the project.
  let candidateId = '__ui_property_parameter_draft__';
  while (project.variables.some(item => item.id === candidateId)) candidateId += '_';
  const candidate: Variable = { id: candidateId, name, type: resource ? 'asset' : type, initial, ...behavior, parameterSetId: setId,
    ...(kind === 'image' || kind === 'audio' || kind === 'video' ? { assetKind: kind } : {}) };
  const valueProblem = uiPropertyControlChange({ ...project, variables: [...project.variables, candidate] }, component, property, { mode, parameterId: candidate.id }).problem;
  const sets = parameterSets(project), selectedSet = sets.find(set => set.id === setId), setExists = !!selectedSet;
  const valid = !nameProblem && !valueProblem && setExists;
  return <form className="workspace-toolbar ui-parameter-binding-fields" aria-label="新建联动参数" onKeyDown={event => {
    if (event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) { if (event.key === 'Enter') event.preventDefault(); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
  }} onSubmit={event => { event.preventDefault(); if (valid) onCreate(name.trim(), initial, setId, behavior); }}>
    <label>参数名称<input aria-label="新参数名称" maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
    <span>类型：{parameterKindNames[kind]}</span>
    <label>初始值{resource ? <select aria-label="新参数初始值" value={String(initial)} onChange={event => setInitial(event.target.value)}><option value="">空素材</option>{project.assets.filter(asset => asset.kind === resource).map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select> : type === 'boolean' ? <input aria-label="新参数初始值" type="checkbox" checked={Boolean(initial)} onChange={event => setInitial(event.target.checked)} /> : type === 'number' ? <NumberInput aria-label="新参数初始值" value={Number(initial)} onChange={event => setInitial(Number(event.target.value))} /> : <input aria-label="新参数初始值" value={String(initial)} onChange={event => setInitial(event.target.value)} />}</label>
    <label>参数集<select aria-label="新参数所属参数集" value={setId} onChange={event => setSetId(event.target.value)}>{!setExists && <option value={setId} disabled>参数集已删除</option>}{sets.map(set => <option key={set.id} value={set.id}>{set.name}</option>)}</select></label>
    <ParameterBehaviorFields compact labelPrefix="新参数" value={behavior} onChange={setBehavior} />
    <p className="ui-field-help">分组仅用于分类，更换分组保留这里的保存与恢复选择。</p>
    {selectedSet && <button type="button" className="text-button ui-parameter-creation-defaults" aria-label="采用分组新建默认" onClick={() => setBehavior(parameterSetDefaults(selectedSet))}>采用分组新建默认（{parameterSetDefaults(selectedSet).persistent ? '保存在本机' : '随存档保存'}，{parameterSetDefaults(selectedSet).resetWithSettings ? '参与' : '不参与'}恢复）</button>}
    <button className="small-button" type="submit" disabled={!valid}>创建参数并联动</button><button className="small-button" type="button" onClick={onCancel}>取消</button>
    {nameProblem && <span role="status">{nameProblem}</span>}
    {valueProblem && <span role="status">{valueProblem}</span>}
  </form>;
}
