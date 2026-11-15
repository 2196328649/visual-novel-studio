import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Link2, Unlink } from 'lucide-react';
import { blueprintInputValue } from '../core/blueprint';
import type { ParameterDefaults, Project, UiComponent, UiPropertyControl, VariableValue } from '../core/model';
import { addParameter, parameterDisplayValue, parameterKindNames, parameterNameProblem, parameterSetDefaults, parameterSetFor, parameterSets, storyParametersId, type ParameterKind } from '../core/parameter-sets';
import { projectGraphs } from '../core/project-resources';
import { uiEventInActiveInstance } from '../core/ui-logic';
import { listUiParameterBindings } from '../core/ui-parameter-links';
import { uiProperties, uiPropertyApplies, uiPropertyDefault, type UiProperty } from '../core/ui-properties';
import { isUiControlValueProperty } from '../core/ui-control-properties';
import { uiControlBindingName } from '../core/ui-control-authoring';
import { setUiPropertyControl, uiPropertyControlCandidates, uiPropertyControlChange, uiPropertyControlFor, uiPropertyControlKey, uiPropertyControlModes, uiPropertyControlProblem } from '../core/ui-property-control';
import { uiPropertyControlDesignSnapshot } from '../core/ui-property-control-snapshot';
import { NumberInput } from './NumberInput';
import { SpineSpeedValueInput } from './SpineSpeedInput';
import { NumericEditContext } from './NumericEditContext';
import { bindingNames, componentName } from './UiNames';
import { UiPropertyGroup } from './UiPropertyGroup';
import { useUiInspectorGroupActive } from './UiInspectorContext';
import { ParameterBehaviorFields } from './ParameterBehaviorFields';
import type { Commit } from './editor';
import './ui-property-control.css';

type Mode = keyof typeof uiPropertyControlModes;
type GraphReference = { graphId: string; graphName: string; nodeId?: string; property: UiProperty; managed: boolean; reason?: string };
type FocusReturn = { returnFocus?: HTMLElement; returnFallback?: HTMLElement };
type DialogRequest = FocusReturn & { property?: string; label?: string };
type MenuRequest = FocusReturn & { property: UiProperty; label: string; x: number; y: number };
type NewParameter = { name: string; initial: VariableValue; setId: string; kind: ParameterKind; behavior: ParameterDefaults };
type ControlContext = {
  project: Project; component: UiComponent; pageId: string; disabled: boolean; properties: UiProperty[];
  previewValues: Partial<Record<UiProperty, VariableValue>>;
  references: () => GraphReference[];
  openMenu: (request: MenuRequest) => void; openDialog: (request: DialogRequest) => void;
  apply: (property: string, mode: Mode, parameterId: string, create?: NewParameter) => boolean;
  onOpenGraph?: (id: string, nodeId?: string) => void; onParameter?: (id: string) => void;
};
const Context = createContext<ControlContext | null>(null);
const isProperty = (property: string): property is UiProperty => Object.hasOwn(uiProperties, property);
const propertyName = (property: string) => isProperty(property) ? uiProperties[property].name : `未识别属性：${property}`;
const parameterKindFor = (property: UiProperty): ParameterKind | undefined => {
  const info = uiProperties[property];
  return info.resource ? ['image', 'audio', 'video'].includes(info.resource) ? info.resource as ParameterKind : undefined : info.type;
};
const modeDescription: Record<Mode, string> = {
  default: '沿用此处保存的默认设置和原有内容来源；蓝图可以临时修改这一项。',
  follow: '此属性始终跟随参数，蓝图不能直接赋值或播放这一项的动画。控件的其他属性和事件照常工作。',
  sync: '参数变化会更新此属性；蓝图或玩家主动改值时，变化也写回参数，并同步到关联控件。',
};
function restoreFocus(element?: HTMLElement, fallback?: HTMLElement) {
  const target = [element, fallback].find(item => item?.isConnected && !item.matches(':disabled')
    && !item.closest('[hidden], [inert], fieldset:disabled') && item.getClientRects().length && getComputedStyle(item).visibility !== 'hidden');
  target?.focus({ preventScroll: true });
}

function propertyFieldOrigin(event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>): Element | undefined {
  const target = event.target;
  // Resource browsers use React portals, and nested fields may have their own
  // menus. Only the field physically owning this value may handle the event.
  if (event.defaultPrevented || !(target instanceof Element) || !event.currentTarget.contains(target)
    || target.closest('.field, .ui-design-color-field') !== event.currentTarget) return;
  if (target.closest('.field-help, a, summary, button:not(.ui-property-control-value):not(.ui-asset-thumbnail), [role="button"]:not(.ui-property-control-value):not(.ui-asset-thumbnail)')) return;
  return target;
}

function designSource(project: Project, component: UiComponent, property: UiProperty): string | undefined {
  if (property === 'text' && component.binding) return `系统文字：${bindingNames[component.binding]}`;
  if (property === 'visible' && component.visibleWhen) return '原显示条件';
  if (property === 'enabled' && component.enabledWhen) return '原启用状态与启用条件';
  if (property === 'selected' && component.selectedWhen) return '原选中条件';
  if (isUiControlValueProperty(property)) return uiControlBindingName(project, component);
  if (['image', 'video'].includes(property) && component.assetParameterId) return `素材参数：${project.variables.find(item => item.id === component.assetParameterId)?.name ?? '参数已删除'}，参数为空时使用原素材`;
}

/** Indexed lazily: ordinary typing in an inspector never scans every blueprint. */
function graphReferences(project: Project, component: UiComponent, pageId: string): GraphReference[] {
  const bindings = listUiParameterBindings(project, component.id, pageId);
  const result: GraphReference[] = [];
  const append = (reference: GraphReference) => {
    if (!result.some(item => item.graphId === reference.graphId && item.property === reference.property)) result.push(reference);
  };
  for (const binding of bindings) append({ ...binding, property: uiPropertyControlKey(project, component, binding.property) });
  for (const graph of projectGraphs(project)) {
    if (graph.uiPageId && graph.uiPageId !== pageId || !uiEventInActiveInstance(project, { properties: { uiInstanceId: graph.uiInstanceId ?? '' } })) continue;
    const dynamicTargets = new Set(graph.links.filter(link => link.toPinId === 'componentId').map(link => link.toNodeId));
    for (const node of graph.nodes) {
      const property = node.properties.property;
      if (['animateUiProperty', 'resetUiProperty'].includes(node.type) && !dynamicTargets.has(node.id) && blueprintInputValue(node, 'componentId') === component.id && typeof property === 'string' && isProperty(property)) {
        append({ graphId: graph.id, graphName: graph.name, nodeId: node.id, property: uiPropertyControlKey(project, component, property), managed: false });
      }
      if (node.type !== 'playUiAnimation') continue;
      const animation = project.ui.animations?.find(item => item.id === node.properties.animationId && item.pageId === pageId
        && (!pageId.startsWith('ui:') || uiEventInActiveInstance(project, { properties: { uiInstanceId: item.uiInstanceId ?? 'base' } })));
      for (const track of animation?.tracks ?? []) if (track.componentId === component.id) append({
        graphId: graph.id, graphName: graph.name, nodeId: node.id, property: uiPropertyControlKey(project, component, track.property), managed: false,
      });
    }
  }
  return result;
}

/** A root-control scope only. Collection parts intentionally live outside this provider. */
export function UiPropertyControlProvider({ project, component, pageId, commit, disabled = false, onOpenGraph, onParameter, children }: {
  project: Project; component: UiComponent; pageId: string; commit: Commit; disabled?: boolean;
  onOpenGraph?: (id: string, nodeId?: string) => void; onParameter?: (id: string) => void; children: ReactNode;
}) {
  const [menu, setMenu] = useState<MenuRequest>(), [dialog, setDialog] = useState<DialogRequest>(), [notice, setNotice] = useState('');
  const identity = JSON.stringify([project.id, project.ui.activeInstanceId, pageId, component.id, component.kind]);
  const current = useRef({ identity, disabled }); current.current = { identity, disabled };
  const references = useMemo(() => {
    let cached: GraphReference[] | undefined;
    return () => cached ??= graphReferences(project, component, pageId);
  }, [project, component, pageId]);
  const properties = useMemo(() => [...new Set((Object.keys(uiProperties) as UiProperty[]).filter(property => {
    const info = uiProperties[property];
    return info.writable && info.bindable && uiPropertyApplies(component, property, project) && !!parameterKindFor(uiPropertyControlKey(project, component, property));
  }).map(property => uiPropertyControlKey(project, component, property)))], [project, component]);
  const previewValues = useMemo(() => uiPropertyControlDesignSnapshot(project, component).values, [project, component]);
  useEffect(() => { setMenu(undefined); setDialog(undefined); setNotice(''); }, [identity]);
  useEffect(() => { if (disabled) { setMenu(undefined); setDialog(undefined); } }, [disabled]);
  const canWrite = () => current.current.identity === identity && !current.current.disabled;
  const openDialog = (request: DialogRequest) => { if (canWrite()) { setMenu(undefined); setDialog(request); setNotice(''); } };
  const apply: ControlContext['apply'] = (property, mode, parameterId, create) => {
    if (!canWrite()) return false;
    let applied = false;
    const result: unknown = commit(create ? '新建参数与属性关联' : mode === 'default' ? '恢复属性默认控制' : '更改属性控制来源', draft => {
      if (!canWrite() || draft.id !== project.id || draft.ui.activeInstanceId !== project.ui.activeInstanceId) return;
      let source = parameterId;
      if (mode !== 'default' && create) {
        const problem = parameterNameProblem(draft, create.name);
        if (problem) throw new Error(problem);
        source = addParameter(draft, create.setId, create.kind, create.behavior);
        const parameter = draft.variables.find(item => item.id === source)!;
        parameter.name = create.name.trim(); parameter.initial = create.initial;
      }
      setUiPropertyControl(draft, component.id, pageId, property as UiProperty, mode === 'default' ? undefined : { mode, parameterId: source });
      applied = true;
    }, { separate: true });
    if (result === false) applied = false;
    if (applied) setNotice(mode === 'default' ? '已恢复默认设置，原设计值与内容来源保留。' : '已更新此属性的控制来源，保存界面后生效。');
    return applied;
  };
  const context: ControlContext = { project, component, pageId, disabled, properties, previewValues, references, apply, openDialog, onOpenGraph, onParameter,
    openMenu: request => { if (canWrite()) { setMenu(request); setDialog(undefined); } },
  };
  const closeMenu = (focus = false) => {
    setMenu(undefined);
    if (focus) requestAnimationFrame(() => restoreFocus(menu?.returnFocus, menu?.returnFallback));
  };
  return <Context.Provider value={context}>
    {children}
    {!disabled && notice && <p className="ui-property-control-notice" role="status">{notice}</p>}
    {!disabled && menu && <PropertyMenu context={context} request={menu} close={closeMenu} onFailure={error => setNotice(error instanceof Error ? error.message : String(error))} />}
    {!disabled && dialog && <PropertyDialog key={`${identity}/${dialog.property ?? 'choose'}`} context={context} request={dialog} close={() => setDialog(undefined)} />}
  </Context.Provider>;
}

/** Fields opt in with a registry key, never by their translated label. */
export function useUiPropertyControlField(property?: UiProperty, label?: string): {
  enabled: boolean; bound: boolean; replacement: ReactNode | null;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void; onFieldKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  labelTabIndex: 0 | undefined; sourceDescription: string | undefined;
} {
  const context = useContext(Context);
  const entry = context && property ? uiPropertyControlFor(context.project, context.component, property) : undefined;
  const enabled = !!context && !!property && (!!entry || uiProperties[property].writable && uiPropertyApplies(context.component, property, context.project));
  const name = label ?? (property ? propertyName(property) : '属性');
  const problem = context && entry ? uiPropertyControlProblem(context.project, context.component, entry.property, entry.control) : undefined;
  const parameter = entry ? context?.project.variables.find(item => item.id === entry.control.parameterId) : undefined;
  const preview = entry && context ? context.previewValues[entry.property] : undefined;
  const previewText = parameter && context && preview !== undefined ? `预览值：${parameterDisplayValue(context.project, parameter, preview)}${entry && uiProperties[entry.property].unit ? `（${uiProperties[entry.property].unit}）` : ''}${preview !== parameter.initial ? `；参数初始值：${parameterDisplayValue(context.project, parameter)}` : ''}` : '';
  const sourceDescription = entry ? problem ?? [modeDescription[entry.control.mode], previewText].filter(Boolean).join('\n') : undefined;
  const openMenu = (host: HTMLElement, origin: Element, point?: { x: number; y: number }) => {
    if (!context || !property || !enabled || context.disabled) return;
    const label = host.querySelector<HTMLElement>('.field-label, .ui-design-field-heading > label') ?? host;
    const control = origin.closest<HTMLElement>('input, textarea, select, button, [contenteditable]:not([contenteditable="false"]), [tabindex]');
    const anchor = control && host.contains(control) ? control : label;
    const rect = anchor.getBoundingClientRect();
    context.openMenu({ property, label: name, x: point?.x ?? rect.left, y: point?.y ?? rect.bottom, returnFocus: anchor, returnFallback: label });
  };
  return {
    enabled, bound: !!entry, labelTabIndex: enabled && !context?.disabled ? 0 : undefined, sourceDescription,
    replacement: entry && context ? <button type="button" className={`ui-property-control-value${problem ? ' has-problem' : ''}`} aria-label={`${name}控制来源`} title={sourceDescription} disabled={context.disabled}
      onClick={event => { event.preventDefault(); event.stopPropagation(); context.openDialog({ property, label: name, returnFocus: event.currentTarget }); }}>
      <Link2 size={13} aria-hidden="true" /><span>{entry.control.mode === 'sync' ? '同步' : '跟随'}：{parameter?.name ?? '参数已删除'}</span>
    </button> : null,
    onContextMenu: event => {
      if (!enabled || context?.disabled) return;
      const target = propertyFieldOrigin(event); if (!target) return;
      event.preventDefault(); event.stopPropagation();
      openMenu(event.currentTarget, target, { x: event.clientX, y: event.clientY });
    },
    onFieldKeyDown: event => {
      if (!enabled || context?.disabled || !(event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10')) return;
      const target = propertyFieldOrigin(event); if (!target) return;
      event.preventDefault(); event.stopPropagation();
      openMenu(event.currentTarget, target);
    },
  };
}

function PropertyMenu({ context, request, close, onFailure }: { context: ControlContext; request: MenuRequest; close: (focus?: boolean) => void; onFailure: (error: unknown) => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<Element, { left: number; top: number }>());
  const key = uiPropertyControlKey(context.project, context.component, request.property);
  const entry = uiPropertyControlFor(context.project, context.component, request.property);
  const canAssociate = context.properties.includes(key) || !!entry;
  const references = context.references().filter(item => item.property === key);
  const graphs = [...new Map(references.map(reference => [reference.graphId, reference])).values()];
  useLayoutEffect(() => {
    const element = menu.current; if (!element) return;
    const positions = new Map<Element, { left: number; top: number }>();
    for (let ancestor = request.returnFocus; ancestor; ancestor = ancestor.parentElement ?? undefined) {
      positions.set(ancestor, { left: ancestor.scrollLeft, top: ancestor.scrollTop });
    }
    if (document.scrollingElement) positions.set(document.scrollingElement, { left: document.scrollingElement.scrollLeft, top: document.scrollingElement.scrollTop });
    scrollPositions.current = positions;
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(request.x, window.innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(request.y, window.innerHeight - rect.height - 8))}px`;
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [request]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menu.current?.contains(event.target)) close(); };
    const scrolled = (event: Event) => {
      const target = event.target === document ? document.scrollingElement : event.target;
      if (!(target instanceof Element)) return;
      const initial = scrollPositions.current.get(target);
      // A scroll that positioned the clicked field can be delivered after the
      // menu opens. Dismiss only when an ancestor has actually moved since then.
      if (initial && (target.scrollLeft !== initial.left || target.scrollTop !== initial.top)) close();
    };
    const resized = () => close();
    document.addEventListener('pointerdown', outside, true); document.addEventListener('scroll', scrolled, true); window.addEventListener('resize', resized);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('scroll', scrolled, true); window.removeEventListener('resize', resized); };
  }, [close]);
  return createPortal(<div ref={menu} className="ui-property-control-menu" role="menu" aria-label="属性控制菜单" style={{ left: request.x, top: request.y }}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); close(true); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }}>
    <span className="ui-property-control-menu-title">{request.label}</span>
    <button type="button" role="menuitem" onClick={() => { try { if (context.apply(request.property, 'default', '')) close(true); } catch (error) { onFailure(error); close(true); } }}><span className="ui-property-control-menu-icon">{!entry && <Check size={13} />}</span>默认设置</button>
    <button type="button" role="menuitem" disabled={!canAssociate} title={!canAssociate ? '参数集目前不支持此素材类型；可以使用默认设置或蓝图。' : undefined} onClick={() => context.openDialog(request)}><span className="ui-property-control-menu-icon"><Link2 size={13} /></span>关联参数…</button>
    {context.onOpenGraph && graphs.length > 0 && <div className="ui-property-control-menu-graphs" role="group" aria-label="关联蓝图">
      {graphs.map(graph => <button key={graph.graphId} type="button" role="menuitem" onClick={() => { close(); context.onOpenGraph?.(graph.graphId, graph.nodeId); }}>{graphs.length === 1 ? '查看关联蓝图' : `查看关联蓝图：${graph.graphName}`}</button>)}
    </div>}
  </div>, document.body);
}

function PropertyDialog({ context, request, close }: { context: ControlContext; request: DialogRequest; close: () => void }) {
  const { project, component } = context;
  const [property, setProperty] = useState(request.property ?? context.properties[0] ?? 'visible');
  const entry = isProperty(property) ? uiPropertyControlFor(project, component, property) : undefined;
  const saved = entry?.control ?? component.propertyControls?.[property];
  const [mode, setMode] = useState<Mode>(saved?.mode === 'sync' || saved?.mode === 'follow' ? saved.mode : 'default');
  const [parameterId, setParameterId] = useState(saved?.parameterId ?? '');
  const [creating, setCreating] = useState(false), [name, setName] = useState(''), [initial, setInitial] = useState<VariableValue>(''), [setId, setSetId] = useState(storyParametersId), [error, setError] = useState('');
  const [behavior, setBehavior] = useState<ParameterDefaults>({ persistent: false, resetWithSettings: false });
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef({ anchor: request.returnFocus, label: request.returnFallback ?? request.returnFocus?.closest('[data-ui-property]')?.querySelector<HTMLElement>('.field-label, .ui-design-field-heading > label') });
  const shouldRestoreFocus = useRef(true);
  const key = isProperty(property) ? uiPropertyControlKey(project, component, property) : undefined;
  const info = key ? uiProperties[key] : undefined, kind = key ? parameterKindFor(key) : undefined;
  const applicable = !!key && context.properties.includes(key);
  const candidates = key ? uiPropertyControlCandidates(project, component, key) : [];
  const chosen = project.variables.find(item => item.id === parameterId);
  const references = context.references().filter(item => item.property === key);
  const nameProblem = creating && mode !== 'default' ? parameterNameProblem(project, name) : undefined;
  const sets = parameterSets(project), selectedSet = sets.find(set => set.id === setId);
  const setProblem = creating && mode !== 'default' && !selectedSet ? '参数集已删除，请重新选择分组。' : undefined;
  let previewParameterId = 'var_property_control_preview';
  while (project.variables.some(item => item.id === previewParameterId)) previewParameterId += '_';
  const proposed: UiPropertyControl | undefined = mode !== 'default' ? { mode, parameterId: creating ? previewParameterId : parameterId } : undefined;
  const candidateProject = creating && kind ? { ...project, variables: [...project.variables, { id: previewParameterId, name, type: info!.resource ? 'asset' as const : info!.type, assetKind: info!.resource as 'image' | 'audio' | 'video' | undefined, initial, ...behavior, parameterSetId: setId }] } : project;
  const problem = proposed && (!applicable || !key) ? '这项属性目前不能关联参数。可以恢复默认设置，原有关联记录会被解除。'
    : uiPropertyControlChange(candidateProject, component, mode === 'default' ? property : key ?? property, proposed).problem;
  const savedProblem = saved ? uiPropertyControlProblem(project, component, property, saved) : undefined;
  const defaultValue = key ? uiPropertyDefault(project, component, key) : undefined;
  const defaultText = typeof defaultValue === 'boolean' ? defaultValue ? '开启' : '关闭' : info?.resource && defaultValue ? project.assets.find(asset => asset.id === defaultValue)?.name ?? '素材已移除' : String(defaultValue ?? '') || '空';
  const originalSource = key ? designSource(project, component, key) : undefined;
  const pickProperty = (next: string) => {
    const control = isProperty(next) ? uiPropertyControlFor(project, component, next)?.control : undefined;
    setProperty(next); setMode(control?.mode ?? 'default'); setParameterId(control?.parameterId ?? ''); setCreating(false); setError('');
  };
  useEffect(() => {
    const element = dialog.current; element?.showModal();
    return () => { element?.close(); requestAnimationFrame(() => {
      if (shouldRestoreFocus.current) restoreFocus(returnFocus.current.anchor, returnFocus.current.label ?? undefined);
    }); };
  }, []);
  const startCreating = () => {
    if (!key || !kind) return;
    setName(`${componentName(component)} · ${propertyName(key)}`.slice(0, 120)); setInitial(uiPropertyDefault(project, component, key)); setSetId(storyParametersId); setBehavior({ persistent: false, resetWithSettings: false }); setCreating(true); setError('');
    if (mode === 'default') setMode('follow');
  };
  const apply = () => {
    if (problem || nameProblem || setProblem) return;
    try {
      if (context.apply(mode === 'default' ? property : key ?? property, mode, parameterId, creating && mode !== 'default' && kind ? { name, initial, setId, kind, behavior } : undefined)) close();
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  };
  return createPortal(<dialog ref={dialog} className="dialog ui-property-control-dialog" aria-label="属性控制设置"
    onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }} onClick={event => {
      event.stopPropagation();
      if (event.target !== event.currentTarget) return; const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    }} onKeyDown={event => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.keyCode === 229) { if (event.key === 'Enter') event.preventDefault(); return; }
      if (['F5', 'F6'].includes(event.key) || (event.ctrlKey || event.metaKey) && ['s', 'z', 'y'].includes(event.key.toLowerCase())) event.preventDefault();
    }}>
    <NumericEditContext.Provider value={undefined}><form onSubmit={event => { event.preventDefault(); apply(); }}>
      <h2>属性控制设置</h2><p className="ui-property-control-owner">{componentName(component)} · {request.label ?? propertyName(property)}</p>
      {savedProblem && <p className="ui-property-control-error" role="note">原关联需要修复：{savedProblem}</p>}
      {!request.property && <label className="ui-property-control-form-row">属性<select aria-label="关联属性" value={property} onChange={event => pickProperty(event.target.value)}>{context.properties.map(item => <option key={item} value={item}>{propertyName(item)}</option>)}</select></label>}
      <label className="ui-property-control-form-row">控制方式<select autoFocus aria-label="控制方式" value={mode} onChange={event => { setMode(event.target.value as Mode); setError(''); }}>{Object.entries(uiPropertyControlModes).map(([value, label]) => <option key={value} value={value} disabled={value !== 'default' && !applicable}>{label}</option>)}</select></label>
      <p className="ui-property-control-explanation">{modeDescription[mode]}</p>
      {mode !== 'default' && !creating && <>
        <label className="ui-property-control-form-row">来源参数<select aria-label="来源参数" value={parameterId} onChange={event => { setParameterId(event.target.value); setError(''); }}>
          <option value="">{candidates.length ? '选择参数' : '暂无类型匹配的参数'}</option>
          {parameterId && !candidates.some(item => item.id === parameterId) && <option value={parameterId}>参数已删除或类型不符</option>}
          {parameterSets(project).map(set => <optgroup key={set.id} label={set.name}>{candidates.filter(item => parameterSetFor(project, item).id === set.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>)}
        </select></label>
        <div className="ui-property-control-actions">{kind && applicable && <button type="button" className="text-button" onClick={startCreating}>新建参数并关联</button>}{chosen && context.onParameter && <button type="button" className="text-button" onClick={() => { shouldRestoreFocus.current = false; close(); context.onParameter?.(chosen.id); }}>查看来源参数</button>}</div>
      </>}
      {mode === 'default' && applicable && !creating && <button type="button" className="text-button" onClick={startCreating}>新建参数并关联</button>}
      {creating && mode !== 'default' && info && kind && <fieldset className="ui-property-control-create"><legend>新建{parameterKindNames[kind]}参数</legend>
        <label className="ui-property-control-form-row">名称<input aria-label="新参数名称" maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
        <label className="ui-property-control-form-row">初始值{info.resource ? <select aria-label="新参数初始值" value={String(initial)} onChange={event => setInitial(event.target.value)}><option value="">空素材</option>{project.assets.filter(asset => asset.kind === info.resource).map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select>
          : info.type === 'boolean' ? <select aria-label="新参数初始值" value={String(initial)} onChange={event => setInitial(event.target.value === 'true')}><option value="true">开启</option><option value="false">关闭</option></select>
          : key === 'spineSpeed' ? <SpineSpeedValueInput value={initial} onChange={setInitial} label="新参数初始值" />
          : info.type === 'number' ? <NumberInput aria-label="新参数初始值" min={info.min} max={info.max} step={info.integer ? 1 : 'any'} value={Number(initial)} onChange={event => setInitial(Number(event.target.value))} />
          : info.options ? <select aria-label="新参数初始值" value={String(initial)} onChange={event => setInitial(event.target.value)}>{Object.entries(info.options).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          : <input aria-label="新参数初始值" value={String(initial)} onChange={event => setInitial(event.target.value)} />}</label>
        {info.unit && <small>单位：{info.unit}</small>}{info.color && <small>颜色使用 #RRGGBB 或 #RRGGBBAA。</small>}
        <label className="ui-property-control-form-row">参数集<select aria-label="新参数所属参数集" value={setId} onChange={event => setSetId(event.target.value)}>{!selectedSet && <option value={setId} disabled>参数集已删除</option>}{sets.map(set => <option key={set.id} value={set.id}>{set.name}</option>)}</select></label>
        <ParameterBehaviorFields compact labelPrefix="新参数" value={behavior} onChange={setBehavior} />
        <p className="ui-field-help">分组仅用于分类，更换分组保留这里的保存与恢复选择。</p>
        {selectedSet && <button type="button" className="text-button ui-parameter-creation-defaults" aria-label="采用分组新建默认" onClick={() => setBehavior(parameterSetDefaults(selectedSet))}>采用分组新建默认（{parameterSetDefaults(selectedSet).persistent ? '保存在本机' : '随存档保存'}，{parameterSetDefaults(selectedSet).resetWithSettings ? '参与' : '不参与'}恢复）</button>}
        <button type="button" className="text-button" onClick={() => setCreating(false)}>改用已有参数</button>
      </fieldset>}
      {key && <p className="ui-property-control-default">{originalSource ? `保留的默认来源：${originalSource}` : <>保留的默认值：<span title={defaultText}>{defaultText.length > 160 ? `${defaultText.slice(0, 160)}…` : defaultText}</span>{info?.unit ? `（${info.unit}）` : ''}</>}。解除关联后恢复原设置。</p>}
      {!!references.length && <details className="ui-property-control-references"><summary>已有蓝图控制 · {references.length} 项</summary>
        {references.some(item => item.managed) && <p>应用新设置会替换这一项的旧自动联动。自定义和共享蓝图保留。</p>}
        {references.some(item => !item.managed) && <p>{mode === 'follow' ? '单向跟随时，蓝图不能写入此属性，请在蓝图中改写来源参数。' : mode === 'sync' ? '这些蓝图对本属性的有效改值也会写回参数。' : '已有蓝图仍可临时修改此属性。'}</p>}
        {references.map(reference => <button type="button" className="text-button" key={`${reference.graphId}/${reference.property}`} disabled={!context.onOpenGraph} title={reference.reason} onClick={() => { shouldRestoreFocus.current = false; close(); context.onOpenGraph?.(reference.graphId, reference.nodeId); }}>{reference.managed ? '旧自动联动：' : '蓝图：'}{reference.graphName}</button>)}
      </details>}
      {(problem || nameProblem || setProblem || error) && <p className="ui-property-control-error" role="alert">{error || nameProblem || setProblem || problem}</p>}
      <footer><button type="button" onClick={close}>取消</button><button type="submit" className="primary" disabled={context.disabled || !!problem || !!nameProblem || !!setProblem}>应用设置</button></footer>
    </form></NumericEditContext.Provider>
  </dialog>, document.body);
}

/** Compact, secondary entry for uncommon fields and retained invalid references. */
export function UiPropertyControlSummary({ searchKeywords = [] }: { searchKeywords?: string | readonly string[] }) {
  const context = useContext(Context);
  if (!context) return null;
  const count = Object.keys(context.component.propertyControls ?? {}).length;
  return <UiPropertyGroup id="property-binding" title="已关联属性" summary={count ? `${count} 项` : '按需关联'} searchKeywords={['控制来源', '默认设置', '单向跟随参数', '与参数双向同步', '右键', ...(typeof searchKeywords === 'string' ? [searchKeywords] : searchKeywords)]}>
    <PropertySummaryRows context={context} />
  </UiPropertyGroup>;
}
function PropertySummaryRows({ context }: { context: ControlContext }) {
  const active = useUiInspectorGroupActive();
  const entries = Object.entries(context.component.propertyControls ?? {}), references = active ? context.references() : [];
  return <div className="ui-property-control-summary">
    {entries.map(([property, control]) => {
      const parameter = context.project.variables.find(item => item.id === control.parameterId);
      const problem = uiPropertyControlProblem(context.project, context.component, property, control);
      return <div key={property} data-linked-property={property}>
        <button type="button" className="text-button" aria-label={`编辑${propertyName(property)}控制`} disabled={context.disabled} onClick={event => context.openDialog({ property, returnFocus: event.currentTarget })}>
          <span>{propertyName(property)}</span><small>{control.mode === 'sync' ? '同步' : '跟随'}：{parameter?.name ?? '参数已删除'}</small>
        </button>{problem && <p className="ui-property-control-error" role="alert">{problem}</p>}
      </div>;
    })}
    {!entries.length && <p>右键属性名称或输入框可关联参数；默认设置仍允许蓝图临时控制。</p>}
    <button type="button" className="text-button" disabled={context.disabled || !context.properties.length} onClick={event => context.openDialog({ returnFocus: event.currentTarget })}><Link2 size={13} aria-hidden="true" />关联其他属性…</button>
    {references.length > 0 && <details className="ui-property-control-references"><summary>已有蓝图控制 · {references.length} 项</summary><p>旧联动按原逻辑运行；选择新的控制方式后才会替换可独立管理的联动。</p>{references.map(reference => <div key={`${reference.graphId}/${reference.property}`}>
      <button type="button" className="text-button" disabled={!context.onOpenGraph} onClick={() => context.onOpenGraph?.(reference.graphId, reference.nodeId)}><span>{propertyName(reference.property)} · {reference.managed ? '旧自动联动' : '蓝图'}</span><small>{reference.graphName}</small></button>
      {reference.managed && <button type="button" className="text-button" disabled={context.disabled} onClick={event => context.openDialog({ property: reference.property, returnFocus: event.currentTarget })}><Unlink size={12} aria-hidden="true" />调整控制方式</button>}
    </div>)}</details>}
  </div>;
}
