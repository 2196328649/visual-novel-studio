import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2 } from 'lucide-react';
import { makeId, maxBlueprintInputs, maxBlueprintOutputs, type BlueprintGraph, type BlueprintPin, type Project, type VariableValue } from '../core/model';
import { blueprintUsages, type BlueprintUsage } from '../core/blueprint-usages';
import { inspectBlueprintInterfaceChange, type BlueprintInterfaceChange } from '../core/blueprint-interface';
import { blueprintTypeNames, defaultBlueprintValue, type BlueprintDataType, type BlueprintNodeType } from '../core/blueprint';
import { BLUEPRINT_MEMBER_MIME, blueprintMemberAccess, type BlueprintMemberReference } from '../core/blueprint-member-access';
import { BlueprintParameterValue } from './BlueprintCallFields';
import { BlueprintValueInput } from './BlueprintValueInput';
import { BlueprintMemberActions, BlueprintMemberButton, BlueprintMemberList, BlueprintMemberName, blueprintMemberNameProblem, restoreBlueprintMemberFocus, useBlueprintMemberFocus } from './BlueprintMembers';
import { BlueprintMemberTypePicker } from './BlueprintMemberTypePicker';
import { blueprintMemberTypes } from './blueprint-member-types';
import { useUiEventDraft } from './UiEventSidebar';
import './blueprint-interface.css';

const interfaceTypes = (Object.keys(blueprintTypeNames) as BlueprintDataType[]).filter(type => type !== 'exec');
const referenceTypes: readonly BlueprintDataType[] = ['asset', 'scene', 'character', 'ui', 'component'];
const editedDefault = (type: BlueprintDataType, value: VariableValue | undefined) => value === undefined && referenceTypes.includes(type) ? '' : value;
type InterfacePatch = Extract<BlueprintInterfaceChange, { kind: 'update' }>['patch'];

/** Inputs and outputs use the same compact member browser as variables; only the selected definition is expanded. */
export function BlueprintInterfaceMembers({ project, graph, direction, onChange, add, canAddNode = !!add, label: memberLabel }: {
  project: Project; graph: BlueprintGraph; direction: BlueprintPin['direction']; onChange(change: BlueprintInterfaceChange): boolean;
  add?: (type: BlueprintNodeType, properties: Record<string, VariableValue>) => void; canAddNode?: boolean; label?: string;
}) {
  const pins = direction === 'input' ? graph.exposedInputs : graph.exposedOutputs;
  const label = memberLabel ?? (direction === 'input' ? '输入参数' : '输出结果'), shortLabel = memberLabel ?? (direction === 'input' ? '输入' : '输出');
  const [query, setQuery] = useState(''), [selectedId, setSelectedId] = useState<string>();
  const [draft, setDraft] = useUiEventDraft<BlueprintPin | undefined>(`graph-interface:${graph.id}:${direction}:draft`, undefined);
  const [useError, setUseError] = useState('');
  const addButton = useRef<HTMLButtonElement>(null);
  const deleting = useRef<{ id: string; origin: HTMLElement | null } | undefined>(undefined);
  const memberFocus = useBlueprintMemberFocus();
  const filtered = pins.filter(pin => pin.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selected = filtered.find(pin => pin.id === selectedId) ?? filtered[0];
  const nameProblem = draft && blueprintMemberNameProblem(draft.name, pins);
  useEffect(() => {
    // Creation may have waited for the existing caller-impact dialog. Close only once it was actually applied.
    if (draft && pins.some(pin => pin.id === draft.id)) { memberFocus.request(draft.id); setSelectedId(draft.id); setDraft(undefined); }
    if (deleting.current && !pins.some(pin => pin.id === deleting.current!.id)) {
      if (!deleting.current.origin?.isConnected && document.activeElement === document.body) memberFocus.request();
      deleting.current = undefined;
    }
  }, [pins, draft]);
  const cancel = () => { setDraft(undefined); addButton.current?.focus({ preventScroll: true }); };
  const typePatch = (dataType: BlueprintDataType): InterfacePatch => ({ dataType, defaultValue: referenceTypes.includes(dataType) ? undefined : defaultBlueprintValue(dataType) });
  const edit = (pin: BlueprintPin, patch: InterfacePatch) => onChange({ kind: 'update', direction, pinId: pin.id, patch });
  const typeSelect = (pin: BlueprintPin, ariaLabel: string, apply: (patch: InterfacePatch) => void) => <BlueprintMemberTypePicker label={ariaLabel} value={pin.dataType} types={interfaceTypes} onChange={type => apply(typePatch(type))} />;
  const reference = (pin: BlueprintPin): BlueprintMemberReference => ({ version: 1, projectId: project.id, kind: direction, graphId: graph.id, id: pin.id });
  const use = (pin: BlueprintPin) => {
    try { const action = blueprintMemberAccess(project, graph, reference(pin)).actions[0]; setUseError(''); add?.(action.type, action.properties); }
    catch (error) { setUseError(error instanceof Error ? error.message : String(error)); }
  };
  const help = (pin: BlueprintPin) => <div className="blueprint-member-help"><p>{blueprintMemberTypes[pin.dataType].description}</p><small>{blueprintMemberTypes[pin.dataType].example}</small></div>;
  return <section ref={memberFocus.ref} className="blueprint-interface-members" aria-label={label} data-interface-direction={direction}>
    <div className="blueprint-member-heading"><strong>{label}<small>{pins.length}</small></strong><button type="button" ref={addButton} className="blueprint-member-add" aria-label={'添加' + shortLabel} title={'添加' + shortLabel} aria-expanded={!!draft} disabled={pins.length >= (direction === 'input' ? maxBlueprintInputs : maxBlueprintOutputs)} onClick={() => {
      if (draft) { cancel(); return; }
      setQuery(''); setDraft({ id: makeId(direction === 'input' ? 'bpin' : 'bpout'), name: '', direction, dataType: 'number', required: false, defaultValue: 0 });
    }}><Plus size={14} /><span>新增</span></button></div>
    <p className="blueprint-note">{direction === 'input' ? '调用这张蓝图时传入的值，只读取。拖到画布即可使用。' : '这张蓝图交回的结果。拖到画布写入，调用完成后返回。'}</p>
    {draft && <form className="blueprint-member-draft" aria-label={'创建' + label} onKeyDown={event => {
      if (event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return;
      if (event.nativeEvent.isComposing || event.keyCode === 229) { if (event.key === 'Enter') event.preventDefault(); return; }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
    }} onSubmit={event => { event.preventDefault(); if (!nameProblem) onChange({ kind: 'add', direction, pin: { ...draft, name: draft.name.trim() } }); }}>
      <div className="blueprint-member-draft-identity"><input autoFocus aria-label={'新' + label + '名称'} aria-invalid={!!draft.name && !!nameProblem} maxLength={120} placeholder={direction === 'input' ? '名称，如目标场景' : '名称，如是否完成'} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} />{typeSelect(draft, '新' + label + '类型', patch => setDraft({ ...draft, ...patch }))}</div>
      {help(draft)}
      {(draft.defaultValue !== undefined || referenceTypes.includes(draft.dataType)) && <label className={'blueprint-member-field' + (draft.dataType === 'asset' ? ' blueprint-member-field-wide' : '')}><span>默认值</span><BlueprintValueInput project={project} label={'新' + label + '默认值'} type={draft.dataType} value={draft.defaultValue} onChange={value => setDraft({ ...draft, defaultValue: editedDefault(draft.dataType, value) })} /></label>}
      <details className="blueprint-member-options"><summary>默认值与调用要求</summary><label className="blueprint-member-check"><input type="checkbox" aria-label={'新' + label + '使用默认值'} checked={draft.defaultValue !== undefined} onChange={event => setDraft({ ...draft, defaultValue: event.target.checked ? defaultBlueprintValue(draft.dataType) : undefined })} />使用默认值</label>{direction === 'input' && <label className="blueprint-member-check"><input type="checkbox" aria-label="新输入参数调用时必填" checked={draft.required} onChange={event => setDraft({ ...draft, required: event.target.checked })} />调用时必填</label>}</details>
      {draft.name && nameProblem && <p className="blueprint-member-error" role="status">{nameProblem}</p>}
      <div className="blueprint-member-draft-footer"><button type="button" onClick={cancel}>取消</button><button type="submit" disabled={!!nameProblem}>{'创建' + shortLabel}</button></div>
    </form>}
    <BlueprintMemberList query={query} onQuery={setQuery} label={'搜索' + label} searchable={pins.length > 0}>
      {filtered.map(pin => <div key={pin.id} className="blueprint-member-row" data-blueprint-member-id={pin.id} data-interface-pin-id={pin.id} data-selected={!draft && selected?.id === pin.id || undefined}>
        <BlueprintMemberButton name={pin.name} type={pin.dataType} typeName={blueprintMemberTypes[pin.dataType].name} selected={!draft && selected?.id === pin.id} label={'编辑' + label + ' ' + pin.name} onSelect={() => { setDraft(undefined); setSelectedId(pin.id); setUseError(''); }} dragHint={direction === 'input' ? '拖到画布读取这个输入' : '拖到画布写入这个结果'} onDragStart={canAddNode ? event => { event.stopPropagation(); event.dataTransfer.setData(BLUEPRINT_MEMBER_MIME, JSON.stringify(reference(pin))); event.dataTransfer.effectAllowed = 'copy'; } : undefined} />
        <BlueprintMemberActions actions={[{ label: direction === 'input' ? '读取' : '写入结果', ariaLabel: (direction === 'input' ? '读取输入 ' : '写入输出 ') + pin.name, title: direction === 'input' ? '添加读取输入节点：' + pin.name : '添加写入输出节点：' + pin.name, disabled: !canAddNode, onClick: () => use(pin) }]} />
      </div>)}
      {!filtered.length && !draft && <p className="blueprint-member-empty">{pins.length ? '没有匹配的' + label + '。' : '暂无' + label + '，点击 ＋ 添加。'}</p>}
    </BlueprintMemberList>
    {!draft && selected && <div key={selected.id} className="blueprint-member-details blueprint-interface-card" data-interface-details-id={selected.id}>
      <header><strong>{selected.name}</strong><button type="button" className="blueprint-member-remove" aria-label={`删除${label} ${selected.name}`} title={'删除' + label} onClick={() => { deleting.current = { id: selected.id, origin: document.activeElement as HTMLElement | null }; if (!onChange({ kind: 'remove', direction, pinId: selected.id })) deleting.current = undefined; }}><Trash2 size={13} /></button></header>
      <label className="blueprint-member-field"><span>名称</span><BlueprintMemberName value={selected.name} label={`${label}名称 ${selected.name}`} problem={value => blueprintMemberNameProblem(value, pins, selected.id)} onCommit={value => edit(selected, { name: value })} /></label>
      <label className="blueprint-member-field"><span>类型</span>{typeSelect(selected, `${selected.name}的数据类型`, patch => edit(selected, patch))}</label>
      {help(selected)}
      <label className="blueprint-member-check"><input type="checkbox" aria-label={`${selected.name}使用默认值`} checked={selected.defaultValue !== undefined} onChange={event => edit(selected, { defaultValue: event.target.checked ? defaultBlueprintValue(selected.dataType) : undefined })} />使用默认值</label>
      {(selected.defaultValue !== undefined || referenceTypes.includes(selected.dataType)) && <label className={'blueprint-member-field' + (['asset', 'character'].includes(selected.dataType) ? ' blueprint-member-field-wide' : '')}><span>默认值</span>{direction === 'input' ? <BlueprintParameterValue project={project} graph={graph} label={`${selected.name}的默认值`} pin={selected} value={selected.defaultValue ?? defaultBlueprintValue(selected.dataType)} onChange={value => edit(selected, { defaultValue: value })} /> : <BlueprintValueInput project={project} label={`${selected.name}的默认值`} type={selected.dataType} value={selected.defaultValue} onChange={value => edit(selected, { defaultValue: editedDefault(selected.dataType, value) })} />}</label>}
      {direction === 'input' && <label className="blueprint-member-check"><input type="checkbox" aria-label={`${selected.name}调用时必填`} checked={selected.required} onChange={event => edit(selected, { required: event.target.checked })} />调用时必填</label>}
      <label className="blueprint-member-field"><span>说明</span><textarea aria-label={`${selected.name}的说明`} maxLength={2000} value={selected.description ?? ''} onChange={event => edit(selected, { description: event.target.value || undefined })} /></label>
    </div>}
    {useError && <p className="blueprint-member-error" role="alert">{useError}</p>}
  </section>;
}

export function BlueprintUsageList({ project, graphId, onLocate, canLocate }: {
  project: Project; graphId: string; onLocate(usage: BlueprintUsage): void; canLocate(usage: BlueprintUsage): boolean;
}) {
  const usages = useMemo(() => blueprintUsages(project, graphId), [project, graphId]);
  return <section className="blueprint-usage-section" aria-label="模块调用位置"><h3>调用与绑定 · {usages.length}</h3>
    <p className="blueprint-note">列出直接调用与事件绑定（含派生界面方案），不代表每个位置都会执行。各处未填写的参数沿用模块默认值。</p>
    {usages.length ? <ul>{usages.map(usage => <li key={usage.key}>{canLocate(usage)
      ? <button className="text-button" title={'定位：' + usage.label} onClick={() => onLocate(usage)}>{usage.label}</button>
      : <span>{usage.label}<small>在对应资源属性中查看</small></span>}</li>)}</ul> : <p className="blueprint-note">尚未被其他图、剧情或页面调用。</p>}
  </section>;
}

export function BlueprintInterfaceChangeDialog({ project, graphId, change, onClose, onApply }: {
  project: Project; graphId: string; change: BlueprintInterfaceChange; onClose(): void; onApply(confirmationKey: string): string | undefined;
}) {
  const dialog = useRef<HTMLDialogElement>(null), returnFocus = useRef(document.activeElement as HTMLElement | null);
  const focusPanel = useRef(returnFocus.current?.closest('.blueprint-interface-members'));
  const [error, setError] = useState('');
  const result = useMemo(() => { try { return { plan: inspectBlueprintInterfaceChange(project, graphId, change) }; } catch (error) { return { error: String(error) }; } }, [project, graphId, change]);
  useEffect(() => {
    const element = dialog.current; element?.showModal();
    return () => { element?.close(); restoreBlueprintMemberFocus(returnFocus.current, focusPanel.current); };
  }, []);
  const submit = () => { if (result.plan) setError(onApply(result.plan.confirmationKey) ?? ''); };
  return createPortal(<dialog ref={dialog} className="blueprint-interface-dialog" aria-label="确认接口修改" onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => {
    event.stopPropagation();
    if (['F5', 'F6'].includes(event.key) || (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault();
  }}><form onSubmit={event => { event.preventDefault(); submit(); }}>
    <header><h2>确认接口修改</h2><button type="button" className="small-button" aria-label="关闭接口影响预览" onClick={onClose}>关闭</button></header>
    <div className="blueprint-interface-dialog-body"><p>当前模块有 {result.plan?.callCount ?? 0} 处直接调用或绑定。接口与调用者会在同一次编辑中同步；一次撤销可以恢复。取消不会修改工程。</p>
      {result.plan && <><h3>需要检查的影响 · {result.plan.impacts.length}</h3><ul>{result.plan.impacts.map(impact => <li key={impact.key} data-impact-kind={impact.kind}><strong>{impact.label}</strong><p>{impact.message}</p></li>)}</ul>
        {!result.plan.impacts.length && <p>调用位置已更新，当前没有失效连接或参数。</p>}
        <p className="blueprint-note">类型不兼容的连线与填写值保留并由诊断提示，不会被悄悄强制转换。删除参数会断开相应连线；引用旧参数的读取/写入节点仍需修复。</p></>}
      {(error || result.error) && <p role="alert">{error || result.error}</p>}
    </div><footer><button type="button" className="small-button" autoFocus onClick={onClose}>取消</button><button type="submit" className="primary" disabled={!result.plan}>确认修改</button></footer>
  </form></dialog>, document.body);
}
