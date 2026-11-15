import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ArrowLeft, FolderCog, Plus, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import type { Project, Variable } from '../core/model';
import { addParameter, addParameterSet, builtinParameterSets, changeParameterSetDefaults, copyParameter, copyParameterSet, gameParametersId, moveParameter, parameterAssignment, parameterDisplayValue, parameterKindNames, parameterNameProblem, parameterValueText, parameterSetDefaults, parameterSetFor, parameterSets, parameterTypeName, pasteParameter, type ParameterKind, removeParameterSet, renameParameterSet, storyParametersId, type ParameterClipboard } from '../core/parameter-sets';
import { changeParameterKind, removeParameter, renameParameter, type ParameterUsage } from '../core/parameter-usages';
import { completionScore } from '../core/text-completion';
import { formatNumber, playerPreferenceKeys, preferenceInfo, type PlayerPreference } from '../core/preferences';
import { PreferenceDetails } from './PreferenceDetails';
import { ToolbarMenu } from './components';
import type { Commit } from './editor';
import type { ResourceSelection } from './Inspector';
import { ParameterDetails } from './ParameterDetails';
import { ParameterContextMenu, type ParameterMenuAction } from './ParameterContextMenu';
import { ParameterChangeDialog, type ParameterChange } from './ParameterChangeDialog';
import { ParameterNameInput } from './ParameterNameInput';
import { ParameterRenameDialog } from './ParameterRenameDialog';
import { ParameterSetCreateDialog } from './ParameterSetCreateDialog';
import { ParameterBehaviorFields } from './ParameterBehaviorFields';
import './parameter-sets.css';

type Target = { kind: 'set' | 'variable'; id: string };
let sharedClipboard: ParameterClipboard | undefined;

export function ParameterSets({ project, commit, resource, select, openUi, onActiveSelection, initialSetId, locate }: { initialSetId?: string; project: Project; commit: Commit; resource?: ResourceSelection; select: (resource: ResourceSelection) => void; openUi?: (id: string, pageId?: string) => void; onActiveSelection?: (selection?: { setId: string; variableId?: string }) => void; locate?: (usage: ParameterUsage) => void }) {
  const workspace = useRef<HTMLDivElement>(null);
  const deleteFocusTarget = useRef<{ kind: 'variable' | 'preference'; id: string } | undefined>(undefined);
  const deleteFocusPending = useRef(false);
  const lastResourceKey = useRef<string | undefined>(undefined);
  const internalResourceKey = useRef<string | undefined>(undefined);
  const sets = parameterSets(project);
  const [setId, setSetId] = useState<string | undefined>(initialSetId);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedPreference, setSelectedPreference] = useState<PlayerPreference>();
  const [focusedSetId, setFocusedSetId] = useState<string>();
  const [clipboard, setClipboard] = useState(sharedClipboard);
  const [context, setContext] = useState<{ x: number; y: number; target?: Target; move?: boolean }>();
  const [renaming, setRenaming] = useState<{ target: Target; name: string }>();
  const [changing, setChanging] = useState<ParameterChange>();
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const [nameError, setNameError] = useState('');
  const remember = (value?: ParameterClipboard) => { sharedClipboard = value; setClipboard(value); };
  const closeContext = useCallback(() => { setContext(undefined); workspace.current?.focus({ preventScroll: true }); }, []);
  const attempt = (action: () => void) => { try { action(); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); } };

  useEffect(() => {
    const key = `${project.id}|${resource ? `${resource.kind}:${resource.id}` : ''}`;
    if (lastResourceKey.current === key) return;
    const previous = lastResourceKey.current;
    lastResourceKey.current = key;
    const internal = internalResourceKey.current === key;
    internalResourceKey.current = undefined;
    if (previous !== undefined && !internal) setQuery('');
    const variable = resource?.kind === 'variable' ? project.variables.find(variable => variable.id === resource.id) : undefined;
    if (variable) { setSetId(parameterSetFor(project, variable).id); setSelectedId(variable.id); setSelectedPreference(undefined); }
  }, [project.id, resource?.kind, resource?.id]);
  const set = sets.find(set => set.id === setId), selected = project.variables.find(variable => variable.id === selectedId);
  const matches = (name: string) => completionScore(name, query) > 0;
  const variables = project.variables.filter(variable => parameterSetFor(project, variable).id === setId && matches(variable.name));
  const preferences = set?.id === gameParametersId ? playerPreferenceKeys.filter(key => matches(preferenceInfo(project, key).name)) : [];
  const visibleSets = sets.filter(item => matches(item.name)
    || project.variables.some(variable => parameterSetFor(project, variable).id === item.id && matches(variable.name))
    || item.id === gameParametersId && playerPreferenceKeys.some(key => matches(preferenceInfo(project, key).name)));
  const selectedIsVisible = !!set && !!selected && variables.some(variable => variable.id === selected.id);
  const selectedPreferenceIsVisible = !!selectedPreference && preferences.includes(selectedPreference);
  const shownPreference = set?.id === gameParametersId
    ? selectedPreferenceIsVisible ? selectedPreference : !selectedIsVisible ? preferences[0] : undefined
    : undefined;
  const displayedVariable = set && !shownPreference
    ? selectedIsVisible ? selected : variables[0]
    : undefined;
  const selectedVariableId = displayedVariable?.id;
  const visibleItemKey = JSON.stringify([preferences, variables.map(variable => variable.id)]);
  const visibleSetKey = visibleSets.map(item => item.id).join('\0');
  useEffect(() => {
    if (!set) {
      if (!visibleSets.some(item => item.id === focusedSetId)) setFocusedSetId(visibleSets[0]?.id);
      return;
    }
    if (shownPreference) { setSelectedId(undefined); setSelectedPreference(shownPreference); }
    else if (displayedVariable) { setSelectedId(displayedVariable.id); setSelectedPreference(undefined); }
    else { setSelectedId(undefined); setSelectedPreference(undefined); }
  }, [set?.id, visibleItemKey, visibleSetKey]);
  useEffect(() => { onActiveSelection?.(set ? { setId: set.id, variableId: selectedVariableId } : undefined); }, [set?.id, selectedVariableId, onActiveSelection]);
  useEffect(() => () => onActiveSelection?.(undefined), [onActiveSelection]);
  const hasVariables = project.variables.some(variable => parameterSetFor(project, variable).id === setId);
  const edit = (change: (variable: Variable) => void) => {
    const id = displayedVariable?.id;
    if (id) commit('编辑参数 ' + id, draft => { const variable = draft.variables.find(variable => variable.id === id); if (variable) change(variable); });
  };
  const chooseVariable = (id: string) => {
    setSelectedPreference(undefined); setSelectedId(id);
    const key = `${project.id}|variable:${id}`;
    if (resource?.kind !== 'variable' || resource.id !== id) internalResourceKey.current = key;
    select({ kind: 'variable', id });
  };
  const choosePreference = (key: PlayerPreference) => { setSelectedId(undefined); setSelectedPreference(key); };
  const openSet = (id: string) => {
    const target = sets.find(item => item.id === id);
    const nameMatches = target ? matches(target.name) : false;
    const member = project.variables.find(variable => parameterSetFor(project, variable).id === id && matches(variable.name));
    const preference = id === gameParametersId ? playerPreferenceKeys.find(key => matches(preferenceInfo(project, key).name)) : undefined;
    setSetId(id);
    if (!target) { setQuery(''); setSelectedId(undefined); setSelectedPreference(undefined); return; }
    if (nameMatches) {
      setQuery('');
      const firstVariable = project.variables.find(variable => parameterSetFor(project, variable).id === id);
      setSelectedId(firstVariable?.id);
      setSelectedPreference(firstVariable ? undefined : id === gameParametersId ? playerPreferenceKeys[0] : undefined);
    } else if (preference) { setSelectedPreference(preference); setSelectedId(undefined); }
    else { setSelectedPreference(undefined); setSelectedId(member?.id); }
  };
  const clearQueryIfRenamedOut = (target: Target, name: string) => {
    const oldName = target.kind === 'set'
      ? sets.find(item => item.id === target.id)?.name
      : project.variables.find(item => item.id === target.id)?.name;
    if (query && oldName && matches(oldName) && !matches(name)) setQuery('');
  };
  const clearQueryIfPreferenceRenamedOut = (preference: PlayerPreference, name: string) => {
    const oldName = preferenceInfo(project, preference).name;
    if (query && matches(oldName) && !matches(name)) setQuery('');
  };
  const restoreDeletedFocus = useCallback(() => {
    if (!deleteFocusPending.current) return false;
    deleteFocusPending.current = false;
    const target = deleteFocusTarget.current;
    deleteFocusTarget.current = undefined;
    const rows = [...(workspace.current?.querySelectorAll<HTMLElement>('[data-parameter-id], [data-builtin-preference]') ?? [])];
    const row = target && rows.find(element => element.dataset.parameterId === target.id || element.dataset.builtinPreference === target.id);
    (row ?? workspace.current?.querySelector<HTMLElement>('.parameter-add-kinds button') ?? workspace.current)?.focus({ preventScroll: true });
    return true;
  }, []);
  // Built-in settings are rows of the game settings set, shown before its custom parameters.
  const preferenceText = (key: PlayerPreference) => { const info = preferenceInfo(project, key); return typeof info.initial === 'number' ? formatNumber(info.initial, info) : parameterValueText(info.initial); };
  const add = (type: ParameterKind) => attempt(() => { if (!set) return; let id = ''; commit('添加参数', draft => { id = addParameter(draft, set.id, type); }); setQuery(''); chooseVariable(id); });
  const newSet = () => setCreating(true);
  const copy = (target: Target, cut = false) => attempt(() => {
    remember(target.kind === 'set' ? copyParameterSet(project, target.id) : copyParameter(project, target.id, cut));
    setNotice(cut ? '已剪切参数，进入目标参数集后粘贴。' : target.kind === 'set' && target.id === gameParametersId ? '已复制自定义参数；内置设置保留在原分组。' : '已复制，可在参数集内或列表空白处粘贴。');
  });
  const paste = (value = clipboard) => attempt(() => {
    if (!value) return;
    let result: { setId: string; variableId?: string } | undefined;
    commit(value.kind === 'variable' && value.cut ? '移动参数' : '粘贴参数', draft => { result = pasteParameter(draft, value, set?.id); });
    setSetId(result!.setId); setQuery(''); setSelectedPreference(undefined); setSelectedId(result!.variableId);
    if (result!.variableId) select({ kind: 'variable', id: result!.variableId });
    if (value.kind === 'variable' && value.cut) remember(undefined);
    setNotice(value.kind === 'variable' && value.cut ? '参数已移动，原有引用、保存和恢复配置已保留。' : '副本已创建，可用 Ctrl+Z 撤销。');
  });
  const duplicate = (target: Target) => attempt(() => paste(target.kind === 'set' ? copyParameterSet(project, target.id) : copyParameter(project, target.id)));
  const rename = (target: Target) => {
    const item = target.kind === 'set' ? sets.find(set => set.id === target.id) : project.variables.find(variable => variable.id === target.id);
    if (item) { setNameError(''); setRenaming({ target, name: item.name }); }
  };
  const submitName = () => {
    if (!renaming) return;
    const name = renaming.name.trim(), target = renaming.target;
    const problem = parameterNameProblem(project, name, target.id, target.kind);
    if (problem) { setNameError(problem); return; }
    try {
      commit(target.kind === 'set' ? '重命名参数集' : '重命名参数', draft => {
        if (target.kind === 'variable') renameParameter(draft, target.id, name);
        else renameParameterSet(draft, target.id, name);
      }, { separate: true });
      clearQueryIfRenamedOut(target, name);
    } catch (failure) { setNameError(failure instanceof Error ? failure.message : String(failure)); return; }
    setRenaming(undefined); workspace.current?.focus();
  };
  const remove = (target: Target) => attempt(() => {
    if (target.kind === 'variable') { setChanging({ id: target.id }); return; }
    commit('移除参数集分组', draft => removeParameterSet(draft, target.id));
    if (setId === target.id) setSetId(storyParametersId);
    setFocusedSetId(undefined); setNotice('分组已移除，参数已移至故事状态；引用、保存和恢复配置已保留。');
  });
  const move = (id: string, destination: string) => attempt(() => { commit('移动参数', draft => moveParameter(draft, id, destination)); setSetId(destination); setQuery(''); chooseVariable(id); });
  const copyReference = (id: string) => {
    const variable = project.variables.find(variable => variable.id === id);
    if (variable) void navigator.clipboard.writeText(parameterAssignment(project, variable)).then(() => setNotice('已复制文本引用。'), () => setNotice('无法写入系统剪贴板。'));
  };
  const canPaste = !!clipboard && (clipboard.kind === 'set' || !!set && (!clipboard.cut || clipboard.projectId === project.id && project.variables.some(variable => variable.id === clipboard.variable.id)));
  const visibleFocusedSetId = visibleSets.some(item => item.id === focusedSetId) ? focusedSetId : undefined;
  const keyboardTarget: Target | undefined = set ? selectedVariableId ? { kind: 'variable', id: selectedVariableId } : undefined : visibleFocusedSetId ? { kind: 'set', id: visibleFocusedSetId } : undefined;
  const showContext = (event: MouseEvent) => {
    if ((event.target as Element).closest('input, textarea, select, [contenteditable=true]')) return;
    event.preventDefault(); event.stopPropagation();
    const element = (event.target as Element).closest<HTMLElement>('[data-parameter-id], [data-parameter-set-id]');
    const target: Target | undefined = element?.dataset.parameterId ? { kind: 'variable', id: element.dataset.parameterId } : element?.dataset.parameterSetId ? { kind: 'set', id: element.dataset.parameterSetId } : undefined;
    if (target?.kind === 'variable') chooseVariable(target.id);
    else if (target) setFocusedSetId(target.id);
    setContext({ x: event.clientX, y: event.clientY, target });
  };
  const shortcuts = (event: KeyboardEvent) => {
    const source = event.target as Element;
    if (context || renaming || changing || creating || source.closest('input, textarea, select, [contenteditable=true]')
      || source !== workspace.current && !source.closest('[data-parameter-id], [data-parameter-set-id]')) return;
    const control = event.ctrlKey || event.metaKey;
    let handled = true;
    if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
      const element = keyboardTarget ? workspace.current?.querySelector<HTMLElement>(`[data-parameter-${keyboardTarget.kind === 'set' ? 'set-id' : 'id'}="${keyboardTarget.id}"]`) : workspace.current;
      const bounds = element?.getBoundingClientRect();
      setContext({ x: bounds?.x ?? 20, y: (bounds?.y ?? 20) + 30, target: keyboardTarget });
    } else if (event.key === 'F2' && keyboardTarget) rename(keyboardTarget);
    else if (event.key === 'Delete' && keyboardTarget) { if (keyboardTarget.kind === 'variable' || !builtinParameterSets.some(set => set.id === keyboardTarget.id)) remove(keyboardTarget); }
    else if (control && event.key.toLowerCase() === 'c' && keyboardTarget) copy(keyboardTarget);
    else if (control && event.key.toLowerCase() === 'x' && keyboardTarget?.kind === 'variable') copy(keyboardTarget, true);
    else if (control && event.key.toLowerCase() === 'v' && canPaste) paste();
    else if (control && event.key.toLowerCase() === 'd' && keyboardTarget) duplicate(keyboardTarget);
    else handled = false;
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  };
  const menuActions = (): ParameterMenuAction[] => {
    const target = context?.target;
    if (context?.move && target?.kind === 'variable') return sets.map(destination => ({ label: destination.name, disabled: parameterSetFor(project, project.variables.find(variable => variable.id === target.id)!).id === destination.id, run: () => move(target.id, destination.id) }));
    const actions: ParameterMenuAction[] = [];
    if (target) {
      if (target.kind === 'set') actions.push({ label: '打开参数集', run: () => openSet(target.id) });
      actions.push({ label: '重命名', shortcut: 'F2', run: () => rename(target) }, { label: '创建副本', shortcut: 'Ctrl+D', run: () => duplicate(target) });
      if (target.kind === 'variable') actions.push({ label: '剪切', shortcut: 'Ctrl+X', separator: true, run: () => copy(target, true) });
      actions.push({ label: '复制', shortcut: 'Ctrl+C', separator: target.kind === 'set', run: () => copy(target) });
    } else if (set) {
      for (const type of ['number', 'boolean', 'string', 'image', 'audio', 'video'] as const) actions.push({ label: '新建' + parameterKindNames[type] + '参数', separator: type === 'image', run: () => add(type) });
    } else actions.push({ label: '新建参数集', run: () => newSet() });
    actions.push({ label: '粘贴', shortcut: 'Ctrl+V', disabled: !canPaste, run: () => paste() });
    if (target?.kind === 'variable') {
      actions.push({ label: '移至参数集…', separator: true, run: () => setContext({ ...context!, move: true }) });
      actions.push({ label: '复制文本引用', run: () => copyReference(target.id) });
    }
    if (target) actions.push({ label: target.kind === 'set' ? '移除分组（保留参数）' : '删除参数', shortcut: 'Delete', separator: true, danger: true, disabled: target.kind === 'set' && builtinParameterSets.some(set => set.id === target.id), run: () => remove(target) });
    return actions;
  };
  return <div className="parameter-sets-workspace" ref={workspace} tabIndex={-1} onKeyDown={shortcuts} inert={!!renaming || !!changing || creating}>
    <div className="workspace-toolbar">{set && <button className="small-button" onClick={() => setSetId(undefined)}><ArrowLeft size={14} />参数集</button>}<SlidersHorizontal size={15} /><strong>{set?.name ?? '参数集'}</strong>
      <div className="search library-search"><Search size={14} /><input aria-label="搜索参数集或参数" value={query} placeholder={set ? '搜索参数…' : '搜索参数集…'} onChange={event => setQuery(event.target.value)} />{query && <button type="button" className="icon-button" aria-label="清除搜索" title="清除搜索" onClick={() => setQuery('')}><X size={13} /></button>}</div><div className="spacer" />
      {!set ? <button className="primary small-button" onClick={newSet}><Plus size={14} />新建参数集</button> : <div className="segmented parameter-add-kinds">{(['number', 'boolean', 'string'] as const).map(type => <button key={type} onClick={() => add(type)}><Plus size={12} />{parameterKindNames[type]}</button>)}<ToolbarMenu label="素材">{(['image', 'audio', 'video'] as const).map(type => <button key={type} type="button" onClick={() => add(type)}><Plus size={12} />{parameterKindNames[type]}</button>)}</ToolbarMenu></div>}
    </div>
    {!set ? <div className="parameter-set-cards" onContextMenu={showContext}>{visibleSets.map(set => {
      const values = project.variables.filter(variable => parameterSetFor(project, variable).id === set.id);
      const count = values.length + (set.id === gameParametersId ? playerPreferenceKeys.length : 0);
      const defaults = parameterSetDefaults(set);
      return <button className="parameter-set-card" data-parameter-set-id={set.id} data-selected={visibleFocusedSetId === set.id || undefined} key={set.id} onFocus={() => setFocusedSetId(set.id)} onClick={() => openSet(set.id)}><header><FolderCog size={23} /><strong>{set.name}</strong><small>{count} 个参数</small></header><p>{set.description || '剧情、蓝图与界面共用的变量分组'}</p><div className="parameter-card-values">{(set.id === gameParametersId ? playerPreferenceKeys.slice(0, 2).map(key => ({ name: preferenceInfo(project, key).name, value: preferenceText(key) as string | number | boolean })) : []).concat(values.slice(0, 4).map(variable => ({ name: variable.name, value: parameterDisplayValue(project, variable) }))).slice(0, 4).map((value, index) => <span key={index}>{value.name}<b>{typeof value.value === 'string' ? value.value : parameterValueText(value.value)}</b></span>)}</div><footer>新参数：{defaults.persistent ? '保存在本机' : '随存档保存'} · {defaults.resetWithSettings ? '参与' : '不参与'}恢复初始设置</footer></button>;
    })}{!visibleSets.length && query && <p className="parameter-empty" role="status">没有匹配的参数集或参数。<button type="button" className="text-button" onClick={() => setQuery('')}>清除搜索</button></p>}</div> : <div className={`parameter-set-body ${hasVariables || set.id === gameParametersId ? '' : 'parameter-set-body-single'}`}>
      <div className="parameter-set-main" onContextMenu={showContext}>
        <section key={set.id} className="parameter-set-config" aria-label="参数集配置">
          <label className="parameter-inline-field"><span>名称</span><ParameterNameInput label="参数集名称" value={set.name} problem={name => parameterNameProblem(project, name, set.id, 'set')} onCommit={name => { commit('重命名参数集', draft => renameParameterSet(draft, set.id, name), { separate: true }); clearQueryIfRenamedOut({ kind: 'set', id: set.id }, name); }} /></label>
          <details className="parameter-set-defaults"><summary>新参数默认配置<span>{parameterSetDefaults(set).persistent ? '保存在本机' : '随存档保存'}</span></summary>
            <ParameterBehaviorFields value={parameterSetDefaults(set)} onChange={defaults => attempt(() => commit('新参数默认配置', draft => changeParameterSetDefaults(draft, set.id, defaults), { separate: true }))} labelPrefix="新参数默认" compact />
            <p className="parameter-help">仅用于在此分组新建的参数，已有参数及移入参数保持各自配置。{set.id === gameParametersId ? '内置游戏设置保持原有行为。' : ''}</p>
          </details>
        </section>
        <div className="parameter-table"><header><span>参数名称</span><span>类型</span><span>初始值</span><span>保存方式</span></header>{preferences.map(key => { const info = preferenceInfo(project, key); return <button key={key} data-builtin-preference={key} className={`parameter-builtin-row ${shownPreference === key ? 'selected' : ''} ${info.visible ? '' : 'is-hidden-setting'}`} onFocus={() => choosePreference(key)} onClick={() => choosePreference(key)}><span>{info.name}{!info.visible && <em>不在菜单显示</em>}</span><small title="内置设置，不能删除">{parameterKindNames[info.type]}</small><span>{preferenceText(key)}</span><small>保存在本机</small></button>; })}{variables.map(variable => <button key={variable.id} data-parameter-id={variable.id} className={`${displayedVariable?.id === variable.id ? 'selected' : ''} ${clipboard?.kind === 'variable' && clipboard.cut && clipboard.variable.id === variable.id ? 'is-cut' : ''}`} onFocus={() => chooseVariable(variable.id)} onClick={() => chooseVariable(variable.id)}><span>{variable.name}</span><small>{parameterTypeName(variable)}</small><span>{parameterDisplayValue(project, variable)}</span><small>{variable.persistent ? '保存在本机' : '随存档保存'}</small></button>)}</div>
        {!variables.length && !preferences.length && <p className="parameter-empty" role={query ? 'status' : undefined}>{query ? <>没有匹配的参数。<button type="button" className="text-button" onClick={() => setQuery('')}>清除搜索</button></> : '用上方按钮或右键菜单添加数值、开关、文字参数，或从“素材”添加图片、音频、视频参数。'}</p>}
        {!builtinParameterSets.some(item => item.id === set.id) && <button className="small-button danger-text" onClick={() => remove({ kind: 'set', id: set.id })}><Trash2 size={13} />移除分组并将参数移至故事状态</button>}
      </div>
      {shownPreference ? <PreferenceDetails key={shownPreference} project={project} preference={shownPreference} commit={commit} onNameChange={name => clearQueryIfPreferenceRenamedOut(shownPreference, name)} /> : !hasVariables && set.id !== gameParametersId ? null : displayedVariable ? <ParameterDetails key={displayedVariable.id} project={project} variable={displayedVariable} edit={edit} commit={commit} onRename={name => { commit('重命名参数', draft => renameParameter(draft, displayedVariable.id, name), { separate: true }); clearQueryIfRenamedOut({ kind: 'variable', id: displayedVariable.id }, name); }} move={next => move(displayedVariable.id, next)} remove={() => setChanging({ id: displayedVariable.id })} changeKind={kind => setChanging({ id: displayedVariable.id, kind })} openUi={openUi} locate={locate} copyReference={() => copyReference(displayedVariable.id)} /> : <aside className="parameter-detail parameter-detail-empty"><SlidersHorizontal size={32} /><h2>{query ? '没有匹配的参数' : '选择一个参数'}</h2><p>{query ? '清除搜索或修改关键词后继续。' : '在左侧选择参数，编辑名称、初始值、保存和恢复配置。'}</p></aside>}
    </div>}
    <div className="parameter-status" role="status">{notice || '右键打开操作菜单 · F2 重命名 · Ctrl+D 创建副本 · Ctrl+Z 撤销'}</div>
    {context && <ParameterContextMenu key={`${context.x}:${context.y}:${!!context.move}`} x={context.x} y={context.y} actions={menuActions()} close={closeContext} />}
    {renaming && <ParameterRenameDialog title={'重命名' + (renaming.target.kind === 'set' ? '参数集' : '参数')} name={renaming.name} error={nameError} setName={name => { setRenaming({ ...renaming, name }); setNameError(''); }} close={() => setRenaming(undefined)} submit={submitName} />}
    {creating && <ParameterSetCreateDialog project={project} close={() => setCreating(false)} create={(name, defaults) => {
      let id = ''; commit('新建参数集', draft => { id = addParameterSet(draft, name, 'story', defaults); }, { separate: true });
      setCreating(false); openSet(id); setNotice('参数集已创建，可用 Ctrl+Z 撤销。');
    }} />}
    {changing && <ParameterChangeDialog project={project} change={changing} close={() => setChanging(undefined)} locate={locate} restoreFocus={restoreDeletedFocus} apply={replacement => {
      const index = variables.findIndex(variable => variable.id === changing.id);
      const nextVariable = variables[index + 1] ?? variables[index - 1];
      const nextPreference = !nextVariable ? preferences.at(-1) : undefined;
      commit(changing.kind ? '更改参数类型' : replacement ? '替换引用并删除参数' : '删除参数', draft => {
        if (changing.kind) changeParameterKind(draft, changing.id, changing.kind);
        else removeParameter(draft, changing.id, replacement);
      }, { separate: true });
      if (!changing.kind) {
        setSelectedId(nextVariable?.id);
        setSelectedPreference(nextVariable ? undefined : nextPreference);
        deleteFocusTarget.current = nextVariable ? { kind: 'variable', id: nextVariable.id } : nextPreference ? { kind: 'preference', id: nextPreference } : undefined;
        deleteFocusPending.current = true;
      }
      setChanging(undefined); setNotice('修改已应用，可用 Ctrl+Z 撤销。');
    }} />}
  </div>;
}

