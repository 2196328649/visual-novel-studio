import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, FolderCog, Plus, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { Project, Variable } from '../core/model';
import { addParameter, addParameterSet, builtinParameterSets, copyParameter, copyParameterSet, gameParametersId, moveParameter, parameterSetFor, parameterSets, parameterValueText, pasteParameter, removeParameterSet, storyParametersId, type ParameterClipboard } from '../core/parameter-sets';
import { completionScore } from '../core/text-completion';
import { playerPreferenceKeys, playerPreferences } from '../core/preferences';
import { ParameterDefaultInput } from './ParameterDefaultInput';
import type { Commit } from './editor';
import type { ResourceSelection } from './Inspector';
import { ParameterDetails } from './ParameterDetails';
import { ParameterContextMenu, type ParameterMenuAction } from './ParameterContextMenu';
import './parameter-sets.css';

type Target = { kind: 'set' | 'variable'; id: string };
let sharedClipboard: ParameterClipboard | undefined;

export function ParameterSets({ project, commit, resource, select, openUi, onActiveSelection, initialSetId }: { initialSetId?: string; project: Project; commit: Commit; resource?: ResourceSelection; select: (resource: ResourceSelection) => void; openUi?: (id: string) => void; onActiveSelection?: (selection?: { setId: string; variableId?: string }) => void }) {
  const workspace = useRef<HTMLDivElement>(null);
  const sets = parameterSets(project);
  const [setId, setSetId] = useState<string | undefined>(initialSetId);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [focusedSetId, setFocusedSetId] = useState<string>();
  const [clipboard, setClipboard] = useState(sharedClipboard);
  const [context, setContext] = useState<{ x: number; y: number; target?: Target; move?: boolean }>();
  const [renaming, setRenaming] = useState<{ target: Target; name: string }>();
  const [deleting, setDeleting] = useState<string>();
  const [notice, setNotice] = useState('');
  const [nameError, setNameError] = useState('');
  const remember = (value?: ParameterClipboard) => { sharedClipboard = value; setClipboard(value); };
  const closeContext = useCallback(() => { setContext(undefined); workspace.current?.focus({ preventScroll: true }); }, []);
  const attempt = (action: () => void) => { try { action(); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); } };

  useEffect(() => {
    const variable = resource?.kind === 'variable' ? project.variables.find(variable => variable.id === resource.id) : undefined;
    if (variable) { setSetId(parameterSetFor(project, variable).id); setSelectedId(variable.id); }
  }, [resource?.id]);
  const set = sets.find(set => set.id === setId), selected = project.variables.find(variable => variable.id === selectedId);
  const selectedVariableId = selected && parameterSetFor(project, selected).id === set?.id ? selected.id : undefined;
  useEffect(() => { onActiveSelection?.(set ? { setId: set.id, variableId: selectedVariableId } : undefined); }, [set?.id, selectedVariableId, onActiveSelection]);
  useEffect(() => () => onActiveSelection?.(undefined), [onActiveSelection]);
  const matches = (name: string) => completionScore(name, query) > 0;
  const variables = project.variables.filter(variable => parameterSetFor(project, variable).id === setId && matches(variable.name));
  const edit = (change: (variable: Variable) => void) => commit('编辑参数 ' + selectedId, draft => { const variable = draft.variables.find(variable => variable.id === selectedId); if (variable) change(variable); });
  const chooseVariable = (id: string) => { setSelectedId(id); select({ kind: 'variable', id }); };
  const openSet = (id: string) => { setSetId(id); setQuery(''); setSelectedId(project.variables.find(variable => parameterSetFor(project, variable).id === id)?.id); };
  const add = (type: Variable['type']) => { if (!set) return; let id = ''; commit('添加参数', draft => { id = addParameter(draft, set.id, type); }); setQuery(''); chooseVariable(id); };
  const newSet = () => attempt(() => { let id = ''; commit('新建参数集', draft => { id = addParameterSet(draft); }); openSet(id); });
  const copy = (target: Target, cut = false) => attempt(() => {
    remember(target.kind === 'set' ? copyParameterSet(project, target.id) : copyParameter(project, target.id, cut));
    setNotice(cut ? '已剪切参数，进入目标参数集后粘贴。' : target.kind === 'set' && target.id === gameParametersId ? '已复制自定义参数；内置游戏设置保留在原分组。' : '已复制，可在参数集内或列表空白处粘贴。');
  });
  const paste = (value = clipboard) => attempt(() => {
    if (!value) return;
    let result: { setId: string; variableId?: string } | undefined;
    commit(value.kind === 'variable' && value.cut ? '移动参数' : '粘贴参数', draft => { result = pasteParameter(draft, value, set?.id); });
    setSetId(result!.setId); setQuery(''); setSelectedId(result!.variableId);
    if (result!.variableId) select({ kind: 'variable', id: result!.variableId });
    if (value.kind === 'variable' && value.cut) remember(undefined);
    setNotice(value.kind === 'variable' && value.cut ? '参数已移动，原有引用和存储方式已保留。' : '副本已创建，可用 Ctrl+Z 撤销。');
  });
  const duplicate = (target: Target) => attempt(() => paste(target.kind === 'set' ? copyParameterSet(project, target.id) : copyParameter(project, target.id)));
  const rename = (target: Target) => {
    const item = target.kind === 'set' ? sets.find(set => set.id === target.id) : project.variables.find(variable => variable.id === target.id);
    if (item) { setNameError(''); setRenaming({ target, name: item.name }); }
  };
  const submitName = () => {
    if (!renaming) return;
    const name = renaming.name.trim(), target = renaming.target;
    if (!name) { setNameError('名称不能为空。'); return; }
    const items = target.kind === 'set' ? sets : project.variables;
    if (items.some(item => item.id !== target.id && item.name === name)) { setNameError('已存在同名项目，请换一个名称。'); return; }
    commit(target.kind === 'set' ? '重命名参数集' : '重命名参数', draft => {
      if (target.kind === 'variable') { const variable = draft.variables.find(variable => variable.id === target.id); if (variable) variable.name = name; }
      else {
        let item = draft.parameterSets?.find(set => set.id === target.id);
        if (!item) { const original = parameterSets(draft).find(set => set.id === target.id); if (!original) return; item = { ...original }; (draft.parameterSets ??= []).push(item); }
        item.name = name;
      }
    });
    setRenaming(undefined); workspace.current?.focus();
  };
  const deleteVariable = (id: string) => { commit('删除参数', draft => { draft.variables = draft.variables.filter(variable => variable.id !== id); }); setSelectedId(undefined); setDeleting(undefined); setNotice('参数已删除，可用 Ctrl+Z 撤销。'); };
  const remove = (target: Target) => attempt(() => {
    if (target.kind === 'variable') { setDeleting(target.id); return; }
    commit('移除参数集分组', draft => removeParameterSet(draft, target.id));
    if (setId === target.id) setSetId(storyParametersId);
    setFocusedSetId(undefined); setNotice('分组已移除，参数已移至故事状态；引用和存储方式已保留。');
  });
  const move = (id: string, destination: string) => attempt(() => { commit('移动参数', draft => moveParameter(draft, id, destination)); setSetId(destination); setQuery(''); chooseVariable(id); });
  const canPaste = !!clipboard && (clipboard.kind === 'set' || !!set && (!clipboard.cut || clipboard.projectId === project.id && project.variables.some(variable => variable.id === clipboard.variable.id)));
  const keyboardTarget: Target | undefined = set ? selectedVariableId ? { kind: 'variable', id: selectedVariableId } : undefined : focusedSetId ? { kind: 'set', id: focusedSetId } : undefined;
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
    if (context || renaming || deleting || (event.target as Element).closest('input, textarea, select, [contenteditable=true]')) return;
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
      for (const type of ['number', 'boolean', 'string'] as const) actions.push({ label: '新建' + { number: '数值', boolean: '开关', string: '文字' }[type] + '参数', run: () => add(type) });
    } else actions.push({ label: '新建参数集', run: newSet });
    actions.push({ label: '粘贴', shortcut: 'Ctrl+V', disabled: !canPaste, run: () => paste() });
    if (target?.kind === 'variable') {
      actions.push({ label: '移至参数集…', separator: true, run: () => setContext({ ...context!, move: true }) });
      actions.push({ label: '复制文本引用', run: () => { const variable = project.variables.find(variable => variable.id === target.id)!; void navigator.clipboard.writeText('@设置：' + variable.name + '=' + JSON.stringify(variable.initial)).then(() => setNotice('已复制文本引用。'), () => setNotice('无法写入系统剪贴板。')); } });
    }
    if (target) actions.push({ label: target.kind === 'set' ? '移除分组（保留参数）' : '删除参数', shortcut: 'Delete', separator: true, danger: true, disabled: target.kind === 'set' && builtinParameterSets.some(set => set.id === target.id), run: () => remove(target) });
    return actions;
  };
  return <div className="parameter-sets-workspace" ref={workspace} tabIndex={-1} onKeyDown={shortcuts} inert={!!renaming || !!deleting}>
    <div className="workspace-toolbar">{set && <button className="small-button" onClick={() => { setSetId(undefined); setQuery(''); }}><ArrowLeft size={14} />参数集</button>}<SlidersHorizontal size={15} /><strong>{set?.name ?? '参数集'}</strong>
      <div className="search library-search"><Search size={14} /><input aria-label="搜索参数集或参数" value={query} placeholder={set ? '搜索参数…' : '搜索参数集…'} onChange={event => setQuery(event.target.value)} /></div><div className="spacer" />
      {!set ? <button className="primary small-button" onClick={newSet}><Plus size={14} />新建参数集</button> : <div className="segmented">{(['number', 'boolean', 'string'] as const).map(type => <button key={type} onClick={() => add(type)}><Plus size={12} />{{ number: '数值', boolean: '开关', string: '文字' }[type]}</button>)}</div>}
    </div>
    {!set ? <div className="parameter-set-cards" onContextMenu={showContext}>{sets.filter(set => matches(set.name) || project.variables.some(variable => parameterSetFor(project, variable).id === set.id && matches(variable.name))).map(set => {
      const values = project.variables.filter(variable => parameterSetFor(project, variable).id === set.id);
      const count = values.length + (set.id === gameParametersId ? playerPreferenceKeys.length : 0);
      return <button className="parameter-set-card" data-parameter-set-id={set.id} key={set.id} onFocus={() => setFocusedSetId(set.id)} onClick={() => openSet(set.id)}><header><FolderCog size={23} /><strong>{set.name}</strong><small>{count} 个参数</small></header><p>{set.description || (set.kind === 'settings' ? '玩家可调整的设置' : '剧情与蓝图共享的数据')}</p><div className="parameter-card-values">{(set.id === gameParametersId ? playerPreferenceKeys.slice(0, 2).map(key => ({ name: playerPreferences[key].name, value: project.playerDefaults?.[key] ?? playerPreferences[key].initial })) : []).concat(values.slice(0, 4).map(variable => ({ name: variable.name, value: variable.initial }))).slice(0, 4).map((value, index) => <span key={index}>{value.name}<b>{parameterValueText(value.value)}</b></span>)}</div><footer>{set.kind === 'settings' ? '游戏设置' : '故事参数'} · 点击进入编辑</footer></button>;
    })}</div> : <div className="parameter-set-body">
      <div className="parameter-set-main" onContextMenu={showContext}>
        <details key={set.id} className="ui-property-group"><summary>参数集设置</summary><div className="parameter-set-details"><label>名称<input aria-label="参数集名称" maxLength={120} value={set.name} onChange={event => commit('参数集名称', draft => { const sets = draft.parameterSets ??= []; let target = sets.find(item => item.id === set.id); if (!target) { target = { ...set }; sets.push(target); } target.name = event.target.value || set.name; })} /></label><label>用途<select aria-label="参数集用途" value={set.kind} disabled={builtinParameterSets.some(item => item.id === set.id)} onChange={event => commit('参数集用途', draft => { const target = draft.parameterSets?.find(item => item.id === set.id); if (target) target.kind = event.target.value as 'story' | 'settings'; })}><option value="story">故事与蓝图参数</option><option value="settings">玩家设置</option></select></label></div><p className="parameter-help">用途决定新参数的默认存储方式，以及是否提供默认设置菜单。修改用途不改变已有参数的存储方式。</p></details>
        {set.id === gameParametersId && <details className="builtin-parameters" open={!variables.length}><summary>内置游戏设置 · {playerPreferenceKeys.length} 项</summary><p className="parameter-help">这些是玩家偏好的出厂默认值，玩家的实际选择保存在本地，跨存档与重启保留。改这里不会覆盖玩家已有设置。音量与不透明度：0–1（1 = 100%）；文字速度：字/秒，0 为立即显示。自动播放间隔越大，等待越久。角色单独音量是所有角色的默认值。</p>{playerPreferenceKeys.filter(key => matches(playerPreferences[key].name)).map(key => <label key={key}><span>{playerPreferences[key].name}</span><ParameterDefaultInput label={'初始' + playerPreferences[key].name} preference={key} value={project.playerDefaults?.[key]} onChange={value => commit('游戏设置默认值', draft => { draft.playerDefaults = { ...draft.playerDefaults, [key]: value }; })} /></label>)}</details>}
        <div className="parameter-table"><header><span>参数名称</span><span>类型</span><span>初始值</span><span>存储</span></header>{variables.map(variable => <button key={variable.id} data-parameter-id={variable.id} className={`${selectedId === variable.id ? 'selected' : ''} ${clipboard?.kind === 'variable' && clipboard.cut && clipboard.variable.id === variable.id ? 'is-cut' : ''}`} onClick={() => chooseVariable(variable.id)}><span>{variable.name}</span><small>{{ number: '数值', boolean: '开关', string: '文字' }[variable.type]}</small><span>{parameterValueText(variable.initial)}</span><small>{variable.persistent ? '跨存档保留' : '随剧情存档'}</small></button>)}</div>
        {!variables.length && <p className="parameter-empty">用上方按钮或右键菜单添加数值、开关、文字参数。</p>}
        {!builtinParameterSets.some(item => item.id === set.id) && <button className="small-button danger-text" onClick={() => remove({ kind: 'set', id: set.id })}><Trash2 size={13} />移除分组并将参数移至故事状态</button>}
      </div>
      {selected && parameterSetFor(project, selected).id === set.id ? <ParameterDetails key={selected.id} project={project} variable={selected} edit={edit} commit={commit} move={next => move(selected.id, next)} remove={() => deleteVariable(selected.id)} openUi={openUi} /> : <aside className="parameter-detail parameter-detail-empty"><SlidersHorizontal size={32} /><h2>选择一个参数</h2><p>在左侧选择参数，编辑初始值、存储方式和可选的界面控件。</p></aside>}
    </div>}
    <div className="parameter-status" role="status">{notice || '右键打开操作菜单 · F2 重命名 · Ctrl+D 创建副本 · Ctrl+Z 撤销'}</div>
    {context && <ParameterContextMenu key={`${context.x}:${context.y}:${!!context.move}`} x={context.x} y={context.y} actions={menuActions()} close={closeContext} />}
    {renaming && createPortal(<div className="modal-backdrop" onKeyDown={event => { if (event.key === 'Escape') setRenaming(undefined); }}><form className="dialog parameter-name-dialog" role="dialog" aria-modal="true" aria-label="重命名" onSubmit={event => { event.preventDefault(); submitName(); }}><h2>重命名{renaming.target.kind === 'set' ? '参数集' : '参数'}</h2><input aria-label="新名称" autoFocus maxLength={120} value={renaming.name} onFocus={event => event.target.select()} onChange={event => setRenaming({ ...renaming, name: event.target.value })} />{nameError && <p role="alert">{nameError}</p>}<footer><button type="button" onClick={() => setRenaming(undefined)}>取消</button><button type="submit" className="primary">确定</button></footer></form></div>, document.body)}
    {deleting && createPortal(<div className="modal-backdrop" onKeyDown={event => { if (event.key === 'Escape') setDeleting(undefined); }}><section className="dialog parameter-name-dialog" role="dialog" aria-modal="true" aria-label="删除参数"><h2>删除“{project.variables.find(variable => variable.id === deleting)?.name}”？</h2><p>引用此参数的剧情或控件需要重新绑定。删除后可用 Ctrl+Z 撤销。</p><footer><button autoFocus onClick={() => setDeleting(undefined)}>取消</button><button className="danger-text" onClick={() => deleteVariable(deleting)}>确认删除参数</button></footer></section></div>, document.body)}
  </div>;
}

