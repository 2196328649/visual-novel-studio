import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp, Plus, Trash2, Variable as VariableIcon } from 'lucide-react';
import { UiLibraryHeading, type UiLibraryCollapse } from './UiLibraryHeading';
import type { BlueprintGraph, BlueprintVariable, Project, Variable, VariableValue } from '../core/model';
import { blueprintStateScopes, blueprintVariableOwner, blueprintVariableUsages, changeBlueprintVariable, createBlueprintVariable, removeBlueprintVariable, validBlueprintStateValue, type BlueprintStateOwner, type BlueprintStateScope } from '../core/blueprint-state';
import { defaultBlueprintValue, synchronizeBlueprintSignatures, type BlueprintNodeType } from '../core/blueprint';
import { BLUEPRINT_MEMBER_MIME, blueprintMemberAccess, type BlueprintMemberReference } from '../core/blueprint-member-access';
import { createUiGraphVariable } from '../core/ui-logic';
import { parameterNameProblem, parameterSets, parameterSetFor, parameterTypeName, parameterResetsWithSettings } from '../core/parameter-sets';
import { uiPages, uiPage } from '../core/ui-pages';
import type { Commit } from './editor';
import { BlueprintValueInput } from './BlueprintValueInput';
import { BlueprintMemberActions, BlueprintMemberButton, BlueprintMemberList, BlueprintMemberName, BlueprintMemberType, blueprintMemberNameProblem, restoreBlueprintMemberFocus, useBlueprintMemberFocus } from './BlueprintMembers';
import { BlueprintMemberTypePicker } from './BlueprintMemberTypePicker';
import { ParameterBehaviorFields } from './ParameterBehaviorFields';
import { blueprintMemberTypes } from './blueprint-member-types';
import { UiEventDetail, useUiEventDraft, useUiEventSidebar } from './UiEventSidebar';
import './blueprint-state.css';
import './event-sidebar-members.css';

const stateVariableTypes = ['boolean', 'number', 'string'] as const;
interface VariableTarget { scope: BlueprintStateScope; pageId: string }

interface Props {
  project: Project; graph?: BlueprintGraph; pageId?: string; commit: Commit; canAddNode: boolean;
  add: (type: BlueprintNodeType, properties?: Record<string, VariableValue>) => void; onNotice: (message: string) => void;
  pageOnly?: boolean;
  /** Folds the section in the event graph's left panel. */
  collapse?: UiLibraryCollapse;
}
export function BlueprintVariables(props: Props) {
  // Page settings can remain mounted while changing pages. Never carry a new definition to another owner.
  return <BlueprintVariablesPanel key={`${props.project.id}/${props.graph?.id ?? ''}/${props.pageId ?? ''}/${!!props.pageOnly}`} {...props} />;
}
function BlueprintVariablesPanel({ project, graph, pageId, commit, canAddNode, add, onNotice, pageOnly = false, collapse }: Props) {
  const sidebar = useUiEventSidebar();
  const draftKey = JSON.stringify(['variable', graph?.id ?? null, pageId ?? null, pageOnly]);
  const [scope, setScope] = useUiEventDraft<BlueprintStateScope>(draftKey + ':scope', pageId ? 'page' : 'call');
  const [selectedPage, setSelectedPage] = useUiEventDraft(draftKey + ':selectedPage', pageId ?? graph?.uiPageId ?? 'ui:main');
  const [creationTarget, setCreationTarget] = useUiEventDraft<VariableTarget | undefined>(draftKey + ':creationTarget', undefined);
  const [visitedDetails, setVisitedDetails] = useState<ReadonlySet<string>>(() => new Set());
  const [creating, setCreating] = useUiEventDraft(draftKey + ':creating', false);
  const [name, setName] = useUiEventDraft(draftKey + ':name', '');
  const [type, setType] = useUiEventDraft<BlueprintVariable['type']>(draftKey + ':type', 'boolean');
  const [initial, setInitial] = useUiEventDraft<VariableValue | undefined>(draftKey + ':initial', false);
  const [setId, setSetId] = useUiEventDraft(draftKey + ':setId', '');
  const [resetWithSettings, setResetWithSettings] = useUiEventDraft(draftKey + ':resetWithSettings', false);
  const [error, setError] = useState(''), [editing, setEditing] = useState<string>(), [query, setQuery] = useState('');
  const [pending, setPending] = useState<{ owner: BlueprintStateOwner; variableId: string; type?: BlueprintVariable['type'] }>();
  const [previousDetail, setPreviousDetail] = useUiEventDraft<string | undefined>(draftKey + ':previousDetail', undefined);
  const detailElement = useRef<HTMLDivElement>(null), [focusDefinition, setFocusDefinition] = useState<string>();
  const addButton = useRef<HTMLButtonElement>(null);
  const memberFocus = useBlueprintMemberFocus();
  const currentTarget = { scope, pageId: selectedPage };
  const targetOwner = (target: VariableTarget): BlueprintStateOwner | undefined => target.scope === 'call' ? graph && { scope: 'call', graphId: graph.id } : target.scope === 'page' ? { scope: 'page', pageId: target.pageId } : undefined;
  const targetDefinitions = (target: VariableTarget) => target.scope === 'call' ? graph?.localVariables ?? [] : target.scope === 'page' ? project.ui.pageVariables?.[target.pageId] ?? [] : [];
  const targetVariables = (target: VariableTarget) => target.scope === 'call' || target.scope === 'page' ? targetDefinitions(target) : project.variables.filter(variable => target.scope === 'player' ? variable.persistent : !variable.persistent);
  const targetPrefix = (target: VariableTarget) => `variable:${target.scope}:${target.scope === 'call' ? graph?.id ?? 'none' : target.scope === 'page' ? target.pageId : project.id}:`;
  const targetHint = (target: VariableTarget) => ({
    call: '每次调用从初始值开始，例如本次计算的临时数值。', page: '本页事件共享，关闭后释放，例如选中的页签。',
    project: '作品共享，随存档与剧情回滚，例如好感度。', player: '保存在本机，跨存档与新游戏保留，例如跨周目解锁进度。',
  })[target.scope];
  const owner = targetOwner(currentTarget), variables = targetVariables(currentTarget);
  const formTarget = creationTarget ?? currentTarget, formOwner = targetOwner(formTarget), formDefinitions = targetDefinitions(formTarget);
  const sets = parameterSets(project);
  const activeSetId = setId || sets[0]?.id || '';
  const setExists = sets.some(set => set.id === activeSetId);
  const nameProblem = formOwner ? blueprintMemberNameProblem(name, formDefinitions) : parameterNameProblem(project, name);
  const availableOwner = scope === 'call' ? !!graph : scope === 'page' ? !!uiPage(project, selectedPage) : sets.length > 0;
  const availableFormOwner = formTarget.scope === 'call' ? !!graph : formTarget.scope === 'page' ? !!uiPage(project, formTarget.pageId) : sets.length > 0;
  const valid = !nameProblem && validBlueprintStateValue(type, initial) && availableFormOwner && (!!formOwner || setExists);
  const search = sidebar?.search ?? query;
  const detailPrefix = targetPrefix(currentTarget);
  const detailId = (id: string) => detailPrefix + id;
  const creationId = targetPrefix(formTarget) + 'new', graphDetailId = `graph:${graph?.id ?? 'none'}`;
  const creationVisible = creating && (!sidebar || sidebar.active === creationId);
  const filtered = variables.filter(variable => variable.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  // Directory filtering must never replace the definition currently being edited.
  const selected = sidebar ? variables.find(variable => detailId(variable.id) === sidebar.active) : filtered.find(variable => variable.id === editing) ?? filtered[0];
  const scopeHint = pageOnly ? '本页事件共享，例如选中的页签。页面关闭后释放，再次打开重置。' : targetHint(currentTarget);
  const detailTargets: VariableTarget[] = [
    ...(!pageOnly && graph ? [{ scope: 'call' as const, pageId: selectedPage }] : []),
    ...uiPages(project).filter(page => !pageOnly || page.id === pageId).map(page => ({ scope: 'page' as const, pageId: page.id })),
    ...(!pageOnly ? (['project', 'player'] as const).map(scope => ({ scope, pageId: selectedPage })) : []),
  ];
  const detailEntries = sidebar ? detailTargets.flatMap(target => targetVariables(target).filter(variable => sidebar.active === targetPrefix(target) + variable.id || visitedDetails.has(targetPrefix(target) + variable.id)).map(variable => ({ target, variable }))) : !creating && selected ? [{ target: currentTarget, variable: selected }] : [];
  useLayoutEffect(() => {
    if (!sidebar?.active.startsWith('variable:') || visitedDetails.has(sidebar.active)) return;
    if (detailEntries.some(entry => targetPrefix(entry.target) + entry.variable.id === sidebar.active)) setVisitedDetails(previous => new Set(previous).add(sidebar.active));
  }, [sidebar?.active, visitedDetails, detailEntries]);
  useEffect(() => {
    if (!sidebar) return;
    const candidates: { scope: BlueprintStateScope; pageId?: string; prefix: string }[] = [
      ...(!pageOnly && graph ? [{ scope: 'call' as const, prefix: `variable:call:${graph.id}:` }] : []),
      ...uiPages(project).filter(page => !pageOnly || page.id === pageId).map(page => ({ scope: 'page' as const, pageId: page.id, prefix: `variable:page:${page.id}:` })),
      ...(!pageOnly ? (['project', 'player'] as const).map(scope => ({ scope, prefix: `variable:${scope}:${project.id}:` })) : []),
    ];
    const target = candidates.sort((a, b) => b.prefix.length - a.prefix.length).find(candidate => sidebar.active.startsWith(candidate.prefix));
    if (target && (target.scope !== scope || target.pageId && target.pageId !== selectedPage)) {
      setScope(target.scope);
      if (target.pageId) setSelectedPage(target.pageId);
    }
  }, [sidebar?.active, graph, project, pageId, pageOnly, scope, selectedPage]);
  useEffect(() => {
    if (!focusDefinition || selected?.id !== focusDefinition) return;
    (detailElement.current?.querySelector<HTMLElement>('input') ?? detailElement.current?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
    setFocusDefinition(undefined);
  }, [focusDefinition, selected?.id]);
  const resetCreation = () => {
    setCreating(false); setName(''); setCreationTarget(undefined); setPreviousDetail(undefined);
    if (sidebar) { setType('boolean'); setInitial(false); setSetId(''); setResetWithSettings(false); }
  };
  const cancelCreation = () => { resetCreation(); setError(''); sidebar?.select(previousDetail ?? graphDetailId); addButton.current?.focus({ preventScroll: true }); };
  const clearSelection = () => { if (!sidebar) { setCreating(false); setCreationTarget(undefined); } setEditing(undefined); setQuery(''); setError(''); if (sidebar?.active.startsWith(detailPrefix)) sidebar.select(graphDetailId); };
  const perform = (label: string, edit: Parameters<Commit>[1]) => {
    let applied = false;
    try {
      const result: unknown = commit(label, draft => { edit(draft); synchronizeBlueprintSignatures(draft); applied = true; }, { separate: true });
      if (result === false) applied = false;
      if (!applied) throw new Error('修改未能保存到当前草稿，请先处理编辑器提示。');
      setError(''); return true;
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); return false; }
  };
  // Shared parameter definitions keep their existing protected editing flow in parameter sets.
  const change = (variable: BlueprintVariable | Variable, patch: Partial<BlueprintVariable>, target = currentTarget) => {
    const owner = targetOwner(target);
    return owner && perform('修改' + blueprintStateScopes[target.scope].name + '变量', draft => {
      const current = blueprintVariableOwner(draft, owner).find(item => item.id === variable.id);
      if (!current) throw new Error('变量已不存在，请重新选择。');
      changeBlueprintVariable(draft, owner, { ...current, ...patch });
    });
  };
  const properties = (variable: { id: string; initial: VariableValue }, target: VariableTarget): Record<string, VariableValue> => ({ variableId: variable.id, scope: target.scope, ...(target.scope === 'page' ? { pageId: target.pageId } : {}) });
  const reference = (variable: { id: string }, target = currentTarget): BlueprintMemberReference => ({ version: 1, projectId: project.id, kind: 'variable', id: variable.id, scope: target.scope,
    ...(target.scope === 'call' && graph ? { graphId: graph.id } : {}), ...(target.scope === 'page' ? { pageId: target.pageId } : {}) });
  const use = (variable: { id: string }, operation: 'read' | 'write', target = currentTarget) => {
    try {
      if (graph) {
        const action = blueprintMemberAccess(project, graph, reference(variable, target)).actions.find(action => action.action === operation);
        if (!action) throw new Error('这个变量不支持该操作。');
        add(action.type, action.properties);
      } else {
        // Page settings can open their first event graph through the host callback.
        const owner = targetOwner(target);
        const current = (owner ? blueprintVariableOwner(project, owner) : project.variables.filter(item => target.scope === 'player' ? item.persistent : !item.persistent)).find(item => item.id === variable.id);
        if (!current) throw new Error('变量定义已不存在，请重新选择变量。');
        if (!validBlueprintStateValue(current.type, current.initial)) throw new Error('变量初始值与类型不匹配，请先修复定义。');
        add(operation === 'read' ? 'getVariable' : 'setVariable', { ...properties(current, target), ...(operation === 'write' ? { value: current.initial } : {}) });
      }
      setError('');
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  const typeHelp = (type: BlueprintVariable['type']) => <div className="blueprint-member-help"><p>{blueprintMemberTypes[type].description}</p>{!sidebar && <small>{blueprintMemberTypes[type].example}</small>}</div>;
  const actions = (variable: BlueprintVariable | Variable, target = currentTarget) => <BlueprintMemberActions actions={[
    { label: '读取', ariaLabel: '读取 ' + variable.name, title: '添加读取节点：' + variable.name, disabled: !canAddNode, onClick: () => use(variable, 'read', target) },
    { label: '设置', ariaLabel: '设置 ' + variable.name, title: '添加设置节点：' + variable.name, disabled: !canAddNode, onClick: () => use(variable, 'write', target) },
  ]} />;
  const detail = (id: string, title: string, children: ReactNode, target = currentTarget) => sidebar ? <UiEventDetail key={id} id={id} title={title} kind={blueprintStateScopes[target.scope].name}><div className="ui-event-member-detail blueprint-state-panel">{children}{error && <p className="blueprint-member-error" role="alert">{error}</p>}</div></UiEventDetail> : children;
  return <section ref={memberFocus.ref} className={'blueprint-state-panel' + (sidebar ? ' ui-event-member-directory' : '')} aria-label={pageOnly ? '页面状态变量' : '蓝图变量'} data-collapsed={collapse?.collapsed || undefined}>
    <UiLibraryHeading title={pageOnly ? '页面状态' : '变量'} icon={<VariableIcon size={14} />} count={variables.length} collapse={collapse}><button type="button" ref={addButton} className="blueprint-member-add" aria-label={pageOnly ? '新建页面状态' : '新建变量'} title={pageOnly ? '新建页面状态' : '新建变量'} aria-expanded={creationVisible} disabled={!availableOwner || !!owner && variables.length >= 128} onClick={() => {
      if (creationVisible) { cancelCreation(); return; }
      if (creating && sidebar && creationId === detailId('new')) { sidebar.select(creationId); return; }
      if (!creating || sidebar?.active !== creationId) setPreviousDetail(sidebar?.active);
      setCreationTarget(currentTarget);
      setName(''); setType('boolean'); setInitial(false); setResetWithSettings(false); if (!setExists) setSetId(sets[0]?.id ?? ''); setQuery(''); setError(''); setCreating(true);
      sidebar?.select(detailId('new'));
    }}><Plus size={15} /><span>新增</span></button></UiLibraryHeading>
    {!sidebar && <p className="blueprint-note">这里新建的变量保存可修改的开关、数值或文字。{pageOnly ? '传入角色、场景等对象时，在“页面输入与结果”添加参数。' : '传入角色、场景等对象时，在“输入与输出”添加参数。'}</p>}
    {!pageOnly && <label className="blueprint-member-field"><span>作用域</span><select aria-label="状态列表作用域" value={scope} onChange={event => { clearSelection(); setScope(event.target.value as BlueprintStateScope); }}>{Object.entries(blueprintStateScopes).map(([key, info]) => <option key={key} value={key}>{info.name}</option>)}</select></label>}
    {scope === 'page' && !pageOnly && <label className="blueprint-member-field"><span>页面</span><select aria-label="状态所属页面" value={selectedPage} onChange={event => { clearSelection(); setSelectedPage(event.target.value); }}>{uiPages(project).map(page => <option key={page.id} value={page.id}>{page.name}{page.disabled ? '（已停用）' : ''}</option>)}</select></label>}
    {!sidebar && <p className="blueprint-state-scope-hint">{scopeHint}<span tabIndex={0} title={blueprintStateScopes[scope].hint} aria-label={blueprintStateScopes[scope].hint}><CircleHelp size={12} /></span></p>}
    {creating && detail(creationId, '新建变量', <form className="blueprint-member-draft" aria-label="创建状态变量" onKeyDown={event => {
      if (event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return;
      if (event.nativeEvent.isComposing || event.keyCode === 229) { if (event.key === 'Enter') event.preventDefault(); return; }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelCreation(); }
    }} onSubmit={event => {
      event.preventDefault(); if (!valid) return;
      let id = '';
      if (perform('创建' + blueprintStateScopes[formTarget.scope].name + (formTarget.scope === 'player' ? '' : '变量'), draft => {
        id = formOwner ? createBlueprintVariable(draft, formOwner, name, type, initial!).id : createUiGraphVariable(draft, name, type, initial!, activeSetId, { persistent: formTarget.scope === 'player', resetWithSettings }).id;
      })) { if (sidebar) { sidebar.select(targetPrefix(formTarget) + id); setFocusDefinition(id); } else memberFocus.request(id); resetCreation(); setEditing(id); onNotice(graph ? '变量已加入当前草稿；可用“读取／设置”按钮或拖到画布使用。' : '变量已加入当前草稿；点击“读取／设置”可进入事件图使用。'); }
    }}>
      {sidebar && <p className="blueprint-note">{targetHint(formTarget)}</p>}
      <div className="blueprint-member-draft-identity"><input autoFocus aria-label="变量名称" aria-invalid={!!name && !!nameProblem} placeholder="名称，如是否完成" maxLength={120} value={name} onChange={event => setName(event.target.value)} /><BlueprintMemberTypePicker label="变量类型" value={type} types={stateVariableTypes} onChange={type => { setType(type); setInitial(defaultBlueprintValue(type)); }} /></div>
      {typeHelp(type)}
      <label className="blueprint-member-field"><span>初始值</span><BlueprintValueInput project={project} type={type} label="变量初始值" value={initial} onChange={setInitial} /></label>
      {!formOwner && <label className="blueprint-member-field"><span>参数集</span><select aria-label="变量所属参数集" value={activeSetId} onChange={event => setSetId(event.target.value)}>{!setExists && <option value={activeSetId} disabled>参数集已删除</option>}{sets.map(set => <option key={set.id} value={set.id}>{set.name}</option>)}</select></label>}
      {!formOwner && <ParameterBehaviorFields compact storageReadOnly labelPrefix="新变量" value={{ persistent: formTarget.scope === 'player', resetWithSettings }} onChange={value => setResetWithSettings(value.resetWithSettings)} />}
      {!formOwner && <p className="blueprint-note">保存方式由当前作用域决定。参数集仅用于分类。</p>}
      {sidebar && !availableFormOwner && <p className="blueprint-member-error" role="alert">所属页面、蓝图或参数集已不存在，请取消后重新选择。</p>}
      {name && nameProblem && <p className="blueprint-member-error" role="status">{nameProblem}</p>}
      <div className="blueprint-member-draft-footer"><button type="button" aria-label="取消" title="取消 · Esc" onClick={cancelCreation}>取消</button><button type="submit" aria-label="创建变量" title="创建变量 · Enter" disabled={!valid}>创建变量</button></div>
    </form>, formTarget)}
    {!sidebar && !creating && graph && canAddNode && <p className="blueprint-note">拖到画布选择读取／设置 · Ctrl 读取 · Alt 设置</p>}
    <BlueprintMemberList query={search} onQuery={setQuery} label="搜索变量" searchable={!sidebar && variables.length > 0}>
      {filtered.map(variable => <div key={variable.id} className="blueprint-member-row" data-blueprint-member-id={variable.id} data-state-variable-id={variable.id} data-selected={!creationVisible && selected?.id === variable.id || undefined}>
        <BlueprintMemberButton name={variable.name} type={variable.type} typeName={owner ? undefined : parameterTypeName(variable as Variable)} selected={!creationVisible && selected?.id === variable.id} label={'编辑变量 ' + variable.name} onSelect={() => { if (!sidebar) setCreating(false); setEditing(variable.id); setError(''); sidebar?.select(detailId(variable.id)); }} variableId={variable.id} dragHint="拖到画布选择读取或设置这个变量" onDragStart={graph && canAddNode ? event => {
          event.stopPropagation();
          event.dataTransfer.setData(BLUEPRINT_MEMBER_MIME, JSON.stringify(reference(variable)));
          event.dataTransfer.effectAllowed = 'copy';
        } : undefined} />
        {!sidebar && actions(variable)}
      </div>)}
      {!filtered.length && !creationVisible && <p className="blueprint-member-empty">{variables.length ? '没有匹配的变量。' : '暂无变量，点击 ＋ 添加。'}</p>}
    </BlueprintMemberList>
    {detailEntries.map(({ target, variable: selected }) => {
      const owner = targetOwner(target), definitions = targetDefinitions(target), id = targetPrefix(target) + selected.id;
      const sharedSet = !owner ? parameterSetFor(project, selected as Variable) : undefined;
      return detail(id, selected.name, <div key={selected.id} ref={element => { if (!sidebar || sidebar.active === id) detailElement.current = element; }} className="blueprint-member-details blueprint-state-definition" data-state-details-id={selected.id}>
      <header>{sidebar ? actions(selected, target) : <strong>{selected.name}</strong>}{owner ? <button type="button" className="blueprint-member-remove" title="删除变量" aria-label="删除变量" onClick={() => { setError(''); setPending({ owner, variableId: selected.id }); }}><Trash2 size={13} /></button> : <BlueprintMemberType type={selected.type} name={parameterTypeName(selected as Variable)} />}</header>
      {sidebar && <p className="blueprint-note">{targetHint(target)}</p>}
      {owner ? <>
        <label className="blueprint-member-field"><span>名称</span><BlueprintMemberName value={selected.name} label={'状态名称 ' + selected.name} problem={value => blueprintMemberNameProblem(value, definitions, selected.id)} onCommit={value => change(selected, { name: value }, target)} /></label>
        <label className="blueprint-member-field"><span>类型</span><BlueprintMemberTypePicker<BlueprintVariable['type']> label={'状态类型 ' + selected.name} value={selected.type as BlueprintVariable['type']} types={stateVariableTypes} onChange={type => { setError(''); setPending({ owner, variableId: selected.id, type }); }} /></label>
        {typeHelp(selected.type as BlueprintVariable['type'])}
        <label className="blueprint-member-field"><span>初始值</span><BlueprintValueInput project={project} type={selected.type} label={'状态初始值 ' + selected.name} value={selected.initial} onChange={value => { if (value !== undefined) change(selected, { initial: value }, target); }} /></label>
        <label className="blueprint-member-field"><span>说明</span><textarea aria-label={'状态说明 ' + selected.name} maxLength={2000} value={('description' in selected ? selected.description : '') ?? ''} onChange={event => change(selected, { description: event.target.value || undefined }, target)} /></label>
      </> : <>
        <dl className="blueprint-state-shared-summary"><dt>参数集</dt><dd>{sharedSet?.name}</dd><dt>保存方式</dt><dd>{(selected as Variable).persistent ? '保存在本机' : '随存档保存'}</dd><dt>恢复初始设置</dt><dd>{parameterResetsWithSettings(project, selected as Variable) ? '参与' : '不参与'}</dd><dt>初始值</dt><dd>{selected.type === 'asset' ? project.assets.find(asset => asset.id === selected.initial)?.name ?? (selected.initial || '无') : selected.initial === true ? '是' : selected.initial === false ? '否' : selected.initial === '' ? '空文字' : String(selected.initial)}</dd></dl>
        <p className="blueprint-note">在“参数集 → {sharedSet?.name} → {selected.name}”中编辑定义，所有使用位置共用。</p>
      </>}
    </div>, target);
    })}
    {sidebar && sidebar.active.startsWith(detailPrefix) && sidebar.active !== creationId && !detailEntries.some(entry => targetPrefix(entry.target) + entry.variable.id === sidebar.active) && detail(sidebar.active, '变量已不存在', <p role="status">这个变量已被删除。请从目录重新选择，或新增变量。</p>)}
    {!sidebar && error && <p className="blueprint-member-error" role="alert">{error}</p>}
    {pending && <StateChangeDialog project={project} pending={pending} error={error} focusPanel={memberFocus.ref.current} onClose={() => setPending(undefined)} onApply={() => {
      const nextVariable = variables.find(variable => variable.id !== pending.variableId);
      const applied = perform(pending.type ? '修改状态类型' : '删除状态变量', draft => {
        const variable = blueprintVariableOwner(draft, pending.owner).find(variable => variable.id === pending.variableId);
        if (!variable) throw new Error('变量已变化，请重新打开影响预览。');
        if (pending.type) changeBlueprintVariable(draft, pending.owner, { ...variable, type: pending.type, initial: defaultBlueprintValue(pending.type) });
        else removeBlueprintVariable(draft, pending.owner, pending.variableId);
      });
      if (applied) {
        setPending(undefined);
        if (!pending.type && sidebar) { sidebar.select(nextVariable ? detailId(nextVariable.id) : graphDetailId); setEditing(nextVariable?.id); if (nextVariable) setFocusDefinition(nextVariable.id); }
      }
    }} />}
  </section>;
}
function StateChangeDialog({ project, pending, error, focusPanel, onClose, onApply }: { project: Project; error?: string; focusPanel: Element | null; pending: { owner: BlueprintStateOwner; variableId: string; type?: BlueprintVariable['type'] }; onClose(): void; onApply(): void }) {
  const ref = useRef<HTMLDialogElement>(null), focus = useRef(document.activeElement as HTMLElement | null);
  const returnPanel = useRef(focusPanel ?? focus.current?.closest('.blueprint-state-panel'));
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); restoreBlueprintMemberFocus(focus.current, returnPanel.current); }; }, []);
  const usages = blueprintVariableUsages(project, pending.owner, pending.variableId);
  return createPortal(<dialog ref={ref} className="blueprint-interface-dialog" aria-label="确认状态修改" onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => { event.stopPropagation(); if (['F5', 'F6'].includes(event.key) || (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault(); }}>
    <header><h2>确认状态修改</h2></header><div className="blueprint-interface-dialog-body"><p>{pending.type ? '类型修改会重置定义的初始值；已有写入值与连线保持原样，由诊断提示需要修复的位置。' : '删除定义不会悄悄删除读取／设置节点或连线；失效引用保留供你修复。'} 一次撤销可以恢复。</p><h3>引用位置 · {usages.length}</h3><ul>{usages.map(usage => <li key={usage.graphId + '/' + usage.nodeId}>{usage.graphName} / {usage.nodeName}</li>)}</ul>{error && <p role="alert">{error}</p>}</div><footer><button className="small-button" autoFocus onClick={onClose}>取消</button><button className="primary" onClick={onApply}>确认修改</button></footer>
  </dialog>, document.body);
}
