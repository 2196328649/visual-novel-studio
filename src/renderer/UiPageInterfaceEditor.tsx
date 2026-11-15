import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeftRight, Plus, Trash2 } from 'lucide-react';
import { maxBlueprintInputs, maxBlueprintOutputs, type BlueprintGraph, type Project, type UiPageParameter, type VariableValue } from '../core/model';
import { changeUiPageParameter, createUiPageParameter, removeUiPageParameter, recoverUiPageInterface, uiPageInterface, uiPageInterfaceKnown, uiPageInterfaceUsages, uiPageParameterDefault, uiPageParameterTypes, validUiPageParameterValue } from '../core/ui-page-interface';
import { synchronizeBlueprintSignatures, type BlueprintNodeType } from '../core/blueprint';
import { BLUEPRINT_MEMBER_MIME, blueprintMemberAccess, type BlueprintMemberReference } from '../core/blueprint-member-access';
import { BlueprintMemberActions, BlueprintMemberButton, BlueprintMemberList, BlueprintMemberName, blueprintMemberNameProblem, useBlueprintMemberFocus } from './BlueprintMembers';
import { BlueprintMemberTypePicker } from './BlueprintMemberTypePicker';
import { blueprintMemberTypes } from './blueprint-member-types';
import { BlueprintValueInput } from './BlueprintValueInput';
import { UiLibraryHeading, type UiLibraryCollapse } from './UiLibraryHeading';
import { UiEventDetail, useUiEventDraft, useUiEventSidebar } from './UiEventSidebar';
import type { Commit } from './editor';
import './blueprint-page-interface.css';
import './event-sidebar-members.css';

type Direction = 'inputs' | 'outputs';
interface Props { project: Project; pageId: string; graph?: BlueprintGraph; commit: Commit; add: (type: BlueprintNodeType, properties?: Record<string, VariableValue>) => void; embedded?: boolean; canAddNode?: boolean; collapse?: UiLibraryCollapse }
interface NewParameter { direction: Direction; name: string; dataType: UiPageParameter['dataType']; defaultValue?: VariableValue; useDefault: boolean; required: boolean }
type PendingChange = { direction: Direction; parameterId: string; type?: UiPageParameter['dataType'] } | 'recover';
const pageParameterTypes = Object.keys(uiPageParameterTypes) as UiPageParameter['dataType'][];

export function UiPageInterfaceEditor(props: Props) {
  // The settings panel can stay mounted while its page or graph changes. Drafts must never migrate to that new owner.
  return <UiPageInterfacePanel key={`${props.project.id}/${props.pageId}/${props.graph?.id ?? ''}`} {...props} />;
}
function UiPageInterfacePanel({ project, pageId, graph, commit, add, embedded = false, canAddNode = !!graph, collapse }: Props) {
  const sidebar = useUiEventSidebar();
  const draftKey = JSON.stringify(['page-interface', pageId]);
  const [creating, setCreating] = useUiEventDraft<NewParameter | undefined>(draftKey + ':creating', undefined), [error, setError] = useState('');
  const [queries, setQueries] = useState<Record<Direction, string>>({ inputs: '', outputs: '' });
  const [selectedIds, setSelectedIds] = useState<Partial<Record<Direction, string>>>({});
  const [pending, setPending] = useState<PendingChange>();
  const memberFocus = useBlueprintMemberFocus();
  const [previousDetail, setPreviousDetail] = useUiEventDraft<{ graphId: string; detail: string } | undefined>(draftKey + ':previousDetail', undefined);
  const detailElements = useRef<Partial<Record<Direction, HTMLDivElement | null>>>({});
  const [focusDefinition, setFocusDefinition] = useState<{ direction: Direction; id: string }>();
  const addButtons = useRef<Partial<Record<Direction, HTMLButtonElement | null>>>({});
  const impact = useRef<HTMLDivElement>(null), returnFocus = useRef<HTMLElement | null>(null);
  const definition = uiPageInterface(project, pageId), known = uiPageInterfaceKnown(definition);
  const detailId = (direction: Direction, id: string) => `${direction === 'inputs' ? 'page-input' : 'page-output'}:${pageId}:${id}`;
  const recoveryId = `page-interface:${pageId}:recover`, graphDetailId = `graph:${graph?.id ?? 'none'}`;
  useEffect(() => { if (pending) { impact.current?.focus({ preventScroll: true }); impact.current?.scrollIntoView({ block: 'nearest' }); } }, [pending, sidebar?.active]);
  useEffect(() => {
    if (!focusDefinition || !definition?.[focusDefinition.direction].some(parameter => parameter.id === focusDefinition.id)) return;
    const element = detailElements.current[focusDefinition.direction];
    if (!element) return;
    (element.querySelector<HTMLElement>('input') ?? element.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
    setFocusDefinition(undefined);
  }, [focusDefinition, definition, sidebar?.active]);
  const perform = (label: string, action: (draft: Project) => void) => {
    try { let applied = false; const result: unknown = commit(label, draft => { action(draft); synchronizeBlueprintSignatures(draft); applied = true; }, { separate: true }); if (!applied || result === false) throw new Error('修改没有保存到当前草稿。'); setError(''); return true; }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); return false; }
  };
  const currentParameter = (draft: Project, direction: Direction, id: string) => {
    const parameter = uiPageInterface(draft, pageId)?.[direction].find(item => item.id === id);
    if (!parameter) throw new Error('页面参数已不存在，请重新选择。');
    return parameter;
  };
  const change = (direction: Direction, parameter: UiPageParameter, patch: Partial<UiPageParameter>) => perform('修改页面' + (direction === 'inputs' ? '输入' : '结果'), draft => { changeUiPageParameter(draft, pageId, direction, { ...currentParameter(draft, direction, parameter.id), ...patch }); });
  const requestChange = (next: PendingChange) => { returnFocus.current = document.activeElement as HTMLElement | null; setError(''); setPending(next); sidebar?.select(next === 'recover' ? recoveryId : detailId(next.direction, next.parameterId)); };
  const closeChange = () => { setPending(undefined); if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true }); else memberFocus.request(pending && pending !== 'recover' ? pending.parameterId : undefined); };
  const cancelCreation = () => {
    const direction = creating?.direction;
    const returnTo = previousDetail?.graphId === (graph?.id ?? 'none') ? previousDetail.detail : graphDetailId;
    setCreating(undefined); setPreviousDetail(undefined); setError(''); sidebar?.select(returnTo);
    if (direction) addButtons.current[direction]?.focus({ preventScroll: true });
  };
  const uses = pending && pending !== 'recover' ? uiPageInterfaceUsages(project, pageId, pending.direction, pending.parameterId) : [];
  const reference = (direction: Direction, id: string): BlueprintMemberReference => ({ version: 1, projectId: project.id, kind: direction === 'inputs' ? 'pageInput' : 'pageOutput', pageId, id });
  const use = (direction: Direction, parameter: UiPageParameter, operation: 'read' | 'write') => {
    try {
      if (graph) {
        const action = blueprintMemberAccess(project, graph, reference(direction, parameter.id)).actions.find(action => action.action === operation);
        if (!action) throw new Error('这个页面参数不支持该操作。');
        add(action.type, action.properties);
      } else {
        // Page settings can create the page's first graph through their host.
        const current = currentParameter(project, direction, parameter.id);
        add(operation === 'write' ? 'setPageOutput' : direction === 'inputs' ? 'getPageInput' : 'getPageOutput', { pageId, parameterId: current.id, ...(operation === 'write' ? { value: uiPageParameterDefault(current) } : {}) });
      }
      setError('');
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  const help = (type: UiPageParameter['dataType']) => <div className="blueprint-member-help"><p>{blueprintMemberTypes[type].description}</p>{!sidebar && <small>{blueprintMemberTypes[type].example}</small>}</div>;
  const actions = (direction: Direction, parameter: UiPageParameter) => <BlueprintMemberActions actions={[
    { label: '读取', ariaLabel: '读取' + (direction === 'inputs' ? '页面输入' : '页面结果') + ' ' + parameter.name, title: '添加读取节点：' + parameter.name, disabled: !canAddNode, onClick: () => use(direction, parameter, 'read') },
    ...(direction === 'outputs' ? [{ label: '设置', ariaLabel: '设置页面结果 ' + parameter.name, title: '添加设置结果节点：' + parameter.name, disabled: !canAddNode, onClick: () => use(direction, parameter, 'write') }] : []),
  ]} />;
  const impactContent = pending && <div ref={impact} role="alertdialog" aria-label="修改页面接口影响" tabIndex={-1} onKeyDownCapture={event => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); closeChange(); }
    if (['Delete', 'Backspace', 'F5', 'F6'].includes(event.key) || (event.ctrlKey || event.metaKey) && ['d', 's'].includes(event.key.toLowerCase())) event.preventDefault();
  }}><h4>{pending === 'recover' ? '恢复页面接口' : pending.type ? '修改参数类型' : '删除页面参数'}</h4><p>{pending === 'recover' ? '旧定义会保存在恢复数据中，新接口从空定义开始。现有接口连接点将断开，读取/写入节点保留供修复。' : pending.type ? '接口默认值改用新类型的初始值；调用实参和连线不做隐式转换，失配项保留供修复。' : '打开/关闭节点中已删除的连接点将断开；读取/设置节点和旧实参保留供修复。'}</p>{pending !== 'recover' && <><p>影响 {uses.filter(use => use.kind === 'node').length} 个蓝图节点、{uses.filter(use => use.kind === 'flow').length} 个流程步骤、{uses.reduce((total, use) => total + use.links, 0)} 条关联连线。流程旧实参保留供修复。</p><ul>{uses.map(use => <li key={use.key}>{use.label}</li>)}</ul></>}
    <div className="ui-page-parameter-actions"><button type="button" onClick={() => {
      const next = pending !== 'recover' && !pending.type ? definition?.[pending.direction].find(parameter => parameter.id !== pending.parameterId) : undefined;
      if (perform('修改页面接口', draft => {
        if (pending === 'recover') recoverUiPageInterface(draft, pageId);
        else if (pending.type) changeUiPageParameter(draft, pageId, pending.direction, { ...currentParameter(draft, pending.direction, pending.parameterId), dataType: pending.type, defaultValue: uiPageParameterDefault({ dataType: pending.type }) });
        else removeUiPageParameter(draft, pageId, pending.direction, pending.parameterId);
      })) {
        if (sidebar && pending !== 'recover' && (pending.type || next)) setFocusDefinition({ direction: pending.direction, id: pending.type ? pending.parameterId : next!.id });
        else memberFocus.request(pending !== 'recover' && pending.type ? pending.parameterId : next?.id);
        if (sidebar && (pending === 'recover' || !pending.type)) sidebar.select(pending !== 'recover' && next ? detailId(pending.direction, next.id) : graphDetailId);
        setPending(undefined);
      }
    }}>确认修改页面接口</button><button type="button" onClick={closeChange}>保留原定义</button></div>
  </div>;
  const detail = (id: string, title: string, kind: string, children: ReactNode, showImpact = false) => sidebar ? <UiEventDetail key={id} id={id} title={title} kind={kind}><div className="ui-event-member-detail ui-page-interface">{children}{error && <p className="blueprint-member-error" role="alert">{error}</p>}{showImpact && impactContent}</div></UiEventDetail> : children;
  const members = (direction: Direction) => {
    const parameters = definition?.[direction] ?? [], label = direction === 'inputs' ? '页面输入' : '页面结果';
    const query = sidebar?.search ?? queries[direction], filtered = parameters.filter(parameter => parameter.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    const selected = sidebar ? parameters.find(parameter => detailId(direction, parameter.id) === sidebar.active) : filtered.find(parameter => parameter.id === selectedIds[direction]) ?? filtered[0];
    const draft = creating?.direction === direction ? creating : undefined;
    const creationId = detailId(direction, 'new'), creationVisible = !!draft && (!sidebar || sidebar.active === creationId);
    const directionHint = direction === 'inputs' ? '打开界面时传入，只能读取。' : '页面正常完成时返回，可在页面内读取和设置。';
    const problem = draft && blueprintMemberNameProblem(draft.name, parameters);
    const valid = !!draft && !problem && (!draft.useDefault || validUiPageParameterValue(draft.dataType, draft.defaultValue));
    return <div key={direction} className="ui-page-parameters" data-page-parameter-direction={direction}>
      <div className="blueprint-member-heading"><strong>{direction === 'inputs' ? '打开时输入' : '完成时结果'}<small>{parameters.length}</small></strong><button ref={button => { addButtons.current[direction] = button; }} className="blueprint-member-add" type="button" aria-label="新增" title={'新增' + label} aria-expanded={creationVisible} disabled={parameters.length >= (direction === 'inputs' ? maxBlueprintInputs : maxBlueprintOutputs)} onClick={() => {
        if (creationVisible) { cancelCreation(); return; }
        if (draft && sidebar) { sidebar.select(creationId); return; }
        if (!creating || sidebar?.active !== detailId(creating.direction, 'new')) setPreviousDetail(sidebar ? { graphId: graph?.id ?? 'none', detail: sidebar.active } : undefined);
        setCreating({ direction, name: '', dataType: 'string', defaultValue: '', useDefault: true, required: false }); setQueries(previous => ({ ...previous, [direction]: '' })); setError('');
        sidebar?.select(creationId);
      }}><Plus size={14} /><span>新增</span></button></div>
      {!sidebar && <p className="blueprint-note">{direction === 'inputs' ? '由打开这个页面的地方传入，只读取。' : '页面内可以读取和设置，正常完成时交回结果。'}{graph && '拖到画布即可使用。'}</p>}
      {draft && detail(creationId, '新建' + label, label, <form className="blueprint-member-draft" aria-label="创建页面参数" onKeyDown={event => {
        if (!event.currentTarget.contains(event.target as Node) || event.defaultPrevented) return;
        if (event.nativeEvent.isComposing || event.keyCode === 229) { if (event.key === 'Enter') event.preventDefault(); return; }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelCreation(); }
      }} onSubmit={event => {
        event.preventDefault(); if (!valid) return;
        let id = '';
        if (perform('创建页面参数', project => {
          const parameter = createUiPageParameter(project, pageId, direction, draft.name, draft.dataType); id = parameter.id;
          changeUiPageParameter(project, pageId, direction, { ...parameter, required: draft.required, defaultValue: draft.useDefault ? draft.defaultValue : undefined });
        })) { if (sidebar) { sidebar.select(detailId(direction, id)); setFocusDefinition({ direction, id }); } else memberFocus.request(id); setSelectedIds(previous => ({ ...previous, [direction]: id })); setCreating(undefined); setPreviousDetail(undefined); }
      }}>
        {sidebar && <p className="blueprint-note">{directionHint}</p>}
        <div className="blueprint-member-draft-identity"><input autoFocus aria-label="页面参数名称" aria-invalid={!!draft.name && !!problem} placeholder={direction === 'inputs' ? '名称，如要显示的角色' : '名称，如玩家的选择'} maxLength={120} value={draft.name} onChange={event => setCreating({ ...draft, name: event.target.value })} /><BlueprintMemberTypePicker label="页面参数类型" types={pageParameterTypes} value={draft.dataType} onChange={dataType => setCreating({ ...draft, dataType, defaultValue: uiPageParameterDefault({ dataType }) })} /></div>
        {help(draft.dataType)}
        {draft.useDefault && <label className={'blueprint-member-field' + (draft.dataType === 'asset' ? ' blueprint-member-field-wide' : '')}><span>默认值</span><BlueprintValueInput project={project} label="页面参数默认值" type={draft.dataType} value={draft.defaultValue} onChange={value => setCreating({ ...draft, defaultValue: value === undefined && !['number', 'boolean', 'string'].includes(draft.dataType) ? '' : value })} /></label>}
        {direction === 'inputs' && <details className="blueprint-member-options"><summary>默认值与打开要求</summary><label className="blueprint-member-check"><input type="checkbox" aria-label="页面参数使用默认值" checked={draft.useDefault} onChange={event => setCreating({ ...draft, useDefault: event.target.checked })} />使用默认值</label><label className="blueprint-member-check"><input type="checkbox" aria-label="页面参数必填" checked={draft.required} onChange={event => setCreating({ ...draft, required: event.target.checked })} />打开时必填</label></details>}
        {draft.name && problem && <p className="blueprint-member-error" role="status">{problem}</p>}
        <div className="blueprint-member-draft-footer"><button type="button" onClick={cancelCreation}>取消</button><button type="submit" aria-label="创建参数" disabled={!valid}>创建{direction === 'inputs' ? '输入' : '结果'}</button></div>
      </form>)}
      <BlueprintMemberList query={query} onQuery={value => setQueries(previous => ({ ...previous, [direction]: value }))} label={'搜索' + label} searchable={!sidebar && parameters.length > 0}>
        {filtered.map(parameter => <div key={parameter.id} className="blueprint-member-row" data-blueprint-member-id={parameter.id} data-page-parameter-id={parameter.id} data-selected={!creationVisible && selected?.id === parameter.id || undefined}>
          <BlueprintMemberButton name={parameter.name} type={parameter.dataType} typeName={blueprintMemberTypes[parameter.dataType].name} selected={!creationVisible && selected?.id === parameter.id} label={'编辑' + label + ' ' + parameter.name} onSelect={() => { if (!sidebar) setCreating(undefined); setSelectedIds(previous => ({ ...previous, [direction]: parameter.id })); setError(''); sidebar?.select(detailId(direction, parameter.id)); }} dragHint={direction === 'inputs' ? '拖到画布读取页面输入' : '拖到画布选择读取或设置页面结果'} onDragStart={graph && canAddNode ? event => { event.stopPropagation(); event.dataTransfer.setData(BLUEPRINT_MEMBER_MIME, JSON.stringify(reference(direction, parameter.id))); event.dataTransfer.effectAllowed = 'copy'; } : undefined} />
          {!sidebar && actions(direction, parameter)}
        </div>)}
        {!filtered.length && !creationVisible && <p className="blueprint-member-empty">{parameters.length ? '没有匹配的' + label + '。' : '暂无' + label + '，点击 ＋ 添加。'}</p>}
      </BlueprintMemberList>
      {parameters.filter(parameter => sidebar || !creationVisible && selected?.id === parameter.id).map(selected => detail(detailId(direction, selected.id), selected.name, label, <div key={selected.id} ref={element => { if (!sidebar || sidebar.active === detailId(direction, selected.id)) detailElements.current[direction] = element; }} className="blueprint-member-details ui-page-parameter-definition" data-page-parameter-details-id={selected.id}>
        <header>{sidebar ? actions(direction, selected) : <strong>{selected.name}</strong>}<button type="button" className="blueprint-member-remove" aria-label={'删除页面参数 ' + selected.name} title="删除页面参数" onClick={() => requestChange({ direction, parameterId: selected.id })}><Trash2 size={13} /></button></header>
        {sidebar && <p className="blueprint-note">{directionHint}</p>}
        <label className="blueprint-member-field"><span>名称</span><BlueprintMemberName value={selected.name} label={selected.name + ' · 名称'} problem={value => blueprintMemberNameProblem(value, parameters, selected.id)} onCommit={value => change(direction, selected, { name: value })} /></label>
        <label className="blueprint-member-field"><span>类型</span><BlueprintMemberTypePicker label={selected.name + ' · 类型'} types={pageParameterTypes} value={selected.dataType} onChange={type => requestChange({ direction, parameterId: selected.id, type })} /></label>
        {help(selected.dataType)}
        {direction === 'inputs' && <label className="blueprint-member-check"><input type="checkbox" aria-label={selected.name + ' · 使用默认值'} checked={selected.defaultValue !== undefined} onChange={event => change(direction, selected, { defaultValue: event.target.checked ? uiPageParameterDefault(selected) : undefined })} />使用默认值</label>}
        {(direction === 'outputs' || selected.defaultValue !== undefined) && <label className={'blueprint-member-field' + (selected.dataType === 'asset' ? ' blueprint-member-field-wide' : '')}><span>默认值</span><BlueprintValueInput project={project} label={selected.name + ' · 默认值'} type={selected.dataType} value={uiPageParameterDefault(selected)} onChange={value => change(direction, selected, { defaultValue: value ?? uiPageParameterDefault({ dataType: selected.dataType }) })} /></label>}
        {direction === 'inputs' && <label className="blueprint-member-check"><input type="checkbox" aria-label={selected.name + ' · 必填'} checked={selected.required} onChange={event => change(direction, selected, { required: event.target.checked })} />必填输入</label>}
        <label className="blueprint-member-field"><span>说明</span><textarea aria-label={selected.name + ' · 说明'} key={selected.description} defaultValue={selected.description ?? ''} maxLength={2000} onBlur={event => { if (event.target.value !== (selected.description ?? '')) change(direction, selected, { description: event.target.value }); }} /></label>
        <p className="blueprint-note">{embedded && !sidebar ? '点击成员行的“读取／设置”会进入事件图。' : direction === 'inputs' ? '读取节点的彩色输出连接到需要这个值的动作参数。' : '设置结果需要连接白色执行线，结果会在页面正常完成时返回。'}</p>
      </div>, !!pending && pending !== 'recover' && pending.direction === direction && pending.parameterId === selected.id))}
      {sidebar && sidebar.active.startsWith(detailId(direction, '')) && sidebar.active !== creationId && !selected && detail(sidebar.active, label + '已不存在', label, <p role="status">这个参数已被删除。请从目录重新选择，或新增参数。</p>)}
    </div>;
  };
  return <section ref={memberFocus.ref} className={'ui-page-interface' + (sidebar ? ' ui-event-member-directory' : '')} aria-label="页面输入与结果" data-collapsed={collapse?.collapsed || undefined}>
    {!embedded && <UiLibraryHeading title="页面输入与结果" icon={collapse && <ArrowLeftRight size={14} />} count={collapse && (definition?.inputs.length ?? 0) + (definition?.outputs.length ?? 0)} collapse={collapse} />}{!sidebar && <p className="blueprint-note">打开时接收输入，正常完成时返回结果。各方案共用定义，值只属于本次打开的页面。</p>}
    {!known ? <>
      <p role="alert">接口版本 {definition?.version} 不受支持，原定义与连接点已保留。</p>
      {sidebar ? <><button type="button" onClick={() => sidebar.select(recoveryId)}>查看恢复选项</button>{detail(recoveryId, '恢复页面接口', '页面输入与结果', <><p role="alert">接口版本 {definition?.version} 不受支持，原定义与连接点已保留。</p>{pending !== 'recover' && <button type="button" onClick={() => requestChange('recover')}>恢复页面接口</button>}</>, pending === 'recover')}</> : <button type="button" onClick={() => requestChange('recover')}>恢复页面接口</button>}
    </> : (['inputs', 'outputs'] as const).map(members)}
    {!sidebar && error && <p className="blueprint-member-error" role="alert">{error}</p>}
    {!sidebar && impactContent}
  </section>;
}
