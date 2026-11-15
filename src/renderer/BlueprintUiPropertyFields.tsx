import type { ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { authoringItem } from '../core/authoring-index';
import { blueprintInputSource, blueprintInputValue } from '../core/blueprint';
import { blueprintUiPropertyDefinition, blueprintUiPropertyRowForPin, blueprintUiPropertyRowId, maxBlueprintUiPropertyRows, setBlueprintUiPropertyRows, type BlueprintUiPropertyRow } from '../core/blueprint-ui-property-batch';
import { blueprintUiPropertyControlTargets, createBlueprintUiPropertyControlAnalysis, type BlueprintUiPropertyControlAnalysis } from '../core/blueprint-ui-property-control';
import type { BlueprintGraph, BlueprintNode, BlueprintPin, Project, VariableValue } from '../core/model';
import { playerPreferences } from '../core/preferences';
import { isUiControlValueProperty, uiControlDefinition, uiControlPrimaryProperty } from '../core/ui-control-properties';
import { uiProperties, uiPropertyApplies, uiPropertyDefault, uiPropertyPinType, uiPropertyValueProblem, type UiProperty } from '../core/ui-properties';
import { uiSpineNamedChoices } from '../core/ui-spine';
import { immutableAuthoringIndex } from './authoring-index';
import type { BlueprintFieldProps } from './BlueprintNodeFields';
import { BlueprintValueInput } from './BlueprintValueInput';
import { SpineSpeedValueInput } from './SpineSpeedInput';
import './blueprint-ui-property-fields.css';

// A renderer snapshot can contain many setter cards. Their policy lookup shares
// one index, while authoring always resolves rows from the live node draft.
const analyses = new WeakMap<Project, BlueprintUiPropertyControlAnalysis>();
export function blueprintUiPropertyAnalysis(project: Project) {
  let analysis = analyses.get(project);
  if (!analysis) { analysis = createBlueprintUiPropertyControlAnalysis(project); analyses.set(project, analysis); }
  return analysis;
}

function propertyInfo(property: string) { return Object.hasOwn(uiProperties, property) ? uiProperties[property as UiProperty] : undefined; }
function propertyName(property: string) { return propertyInfo(property)?.name ?? `未知属性（${property}）`; }
function componentLinked(graph: BlueprintGraph, node: BlueprintNode) { return graph.links.some(link => link.toNodeId === node.id && link.toPinId === 'componentId'); }
function authoringComponent(project: Project, graph: BlueprintGraph, node: BlueprintNode) {
  if (componentLinked(graph, node)) return;
  const certain = blueprintUiPropertyAnalysis(project).component(graph, node);
  if (certain) return certain;
  // The active scheme is useful for authoring choices, never evidence that all
  // possible runtime schemes share its parameter control policy.
  const index = immutableAuthoringIndex.ui(project), component = authoringItem(index.byId, blueprintInputValue(node, 'componentId'));
  return component && (!graph.uiPageId || (index.byPage.get(graph.uiPageId) ?? []).some(item => item.id === component.id)) ? component : undefined;
}
function propertyContext(project: Project, graph: BlueprintGraph, node: BlueprintNode) {
  const component = authoringComponent(project, graph, node), dynamic = componentLinked(graph, node), control = component && uiControlDefinition(project, component);
  const available = (Object.keys(uiProperties) as UiProperty[]).filter(property => {
    const info = uiProperties[property];
    return info.writable && (component ? uiPropertyApplies(component, property, project, control) : dynamic || !info.kinds);
  });
  const canonical = (property: string) => control && isUiControlValueProperty(property) ? uiControlPrimaryProperty(control) : property;
  return { component, available, canonical };
}
const common = new Set(['visible', 'enabled', 'selected', 'x', 'y', 'width', 'height', 'opacity', 'text', 'image', 'numberValue', 'stringValue', 'booleanValue', 'value']);
const groups = ['常用', '位置与布局', '内容与控件值', '外观', '交互与其他'] as const;
function groupFor(property: UiProperty): typeof groups[number] {
  const path = uiProperties[property].path;
  if (common.has(property)) return '常用';
  if (path[0] === 'layout' || property === 'layer') return '位置与布局';
  if (isUiControlValueProperty(property) || ['minimum', 'maximum', 'step', 'placeholder', 'maxLength'].includes(property) || property.startsWith('spine') || property.startsWith('video')) return '内容与控件值';
  if (uiProperties[property].resource || ['style', 'skin', 'slider', 'imageEffects'].includes(path[0])) return '外观';
  return '交互与其他';
}
function propertyOptions(properties: readonly UiProperty[]) {
  return groups.map(group => {
    const options = properties.filter(property => groupFor(property) === group);
    return options.length ? <optgroup key={group} label={group}>{options.map(property => <option key={property} value={property}>{uiProperties[property].name}</option>)}</optgroup> : null;
  });
}
function initialValue(project: Project, graph: BlueprintGraph, node: BlueprintNode, property: UiProperty) {
  const component = authoringComponent(project, graph, node);
  const initial = component && uiPropertyApplies(component, property, project) ? uiPropertyDefault(project, component, property) : uiProperties[property].initial;
  return property === 'optionIndex' && initial === -1 ? 0 : initial;
}
function usedProperties(rows: readonly BlueprintUiPropertyRow[], canonical: (property: string) => string, exceptId?: string) { return new Set(rows.filter(row => row.id !== exceptId).map(row => canonical(row.property))); }
function invalidSourceMode(project: Project, graph: BlueprintGraph, node: BlueprintNode, row: BlueprintUiPropertyRow) {
  return row.writeMode === 'source' && !!propertyInfo(row.property) && !isUiControlValueProperty(row.property) && !blueprintUiPropertyAnalysis(project).mayUsePropertySource(graph, node, row.property);
}
function updateRows(node: BlueprintNode, rows: readonly BlueprintUiPropertyRow[]) {
  const definition = blueprintUiPropertyDefinition(node);
  if (!definition.rows) return;
  if (definition.legacy && rows.length === 1 && rows[0].id === 'value') {
    node.properties.property = rows[0].property; node.properties.writeMode = rows[0].writeMode;
  } else setBlueprintUiPropertyRows(node, rows);
}

/** The same typed value editor is used beside a pin and in the inspector. */
export function BlueprintUiPropertyValue({ project, graph, node, pin, edit, label, surface = 'inspector' }: BlueprintFieldProps & { pin: BlueprintPin; label: string; surface?: 'card' | 'inspector' }) {
  const row = blueprintUiPropertyRowForPin(node, pin.id), info = row && propertyInfo(row.property);
  const value = blueprintInputValue(node, pin.id) ?? info?.initial;
  const change = (next: VariableValue | undefined) => edit(target => {
    const live = blueprintUiPropertyRowForPin(target, pin.id);
    if (!live || live.property !== row?.property) return;
    const fallback = propertyInfo(live.property)?.initial;
    if (next === undefined && fallback === undefined) delete target.properties[pin.id];
    else target.properties[pin.id] = next ?? fallback!;
  });
  if (row?.property === 'spineSpeed') return <SpineSpeedValueInput value={value ?? 1} onChange={change} label={label} />;
  if (row?.property === 'spineSkin') {
    const choices = uiSpineNamedChoices(project.assets, 'skin'), selected = String(value ?? '');
    return <div className="blueprint-value-input"><select aria-label={label} value={selected} onChange={event => change(event.target.value)}>
      <option value="">默认皮肤</option>
      {selected && (!Object.hasOwn(choices, selected) || typeof value !== 'string') && <option value={selected}>原值不可用 · {selected}</option>}
      {Object.entries(choices).map(([name, text]) => <option key={name} value={name}>{text}</option>)}
    </select></div>;
  }
  if (info?.options) return <select aria-label={label} value={String(value ?? info.initial)} onChange={event => change(event.target.value)}>
    {!Object.hasOwn(info.options, String(value ?? info.initial)) && <option value={String(value ?? info.initial)}>失效选项 · {String(value ?? info.initial)}</option>}
    {Object.entries(info.options).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
  </select>;
  if (info?.color) {
    const text = String(value ?? info.initial), swatch = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(text) ? text.slice(0, 7) : '#000000';
    return <div className="blueprint-color-value"><input type="color" aria-label={label + ' · 色块'} value={swatch} onChange={event => change(event.target.value)} /><input aria-label={label} value={text} onChange={event => change(event.target.value)} /></div>;
  }
  const component = blueprintUiPropertyAnalysis(project).component(graph, node), control = component && uiControlDefinition(project, component);
  const limit = control?.preference ? playerPreferences[control.preference].limit : undefined;
  const min = row?.property === 'numberValue' ? limit?.min : row?.property === 'optionIndex' ? 0 : info?.min;
  const max = row?.property === 'numberValue' ? limit?.max : row?.property === 'optionIndex' ? undefined : info?.max;
  return <BlueprintValueInput compact={surface === 'card'} unit={info?.unit} project={project} label={label} type={info && row ? uiPropertyPinType(row.property)! : pin.dataType} value={value} onChange={change} assetKind={info?.resource} min={min} max={max} step={info?.integer ? 1 : 'any'} />;
}

interface PropertyFieldsProps extends BlueprintFieldProps {
  surface?: 'card' | 'inspector';
  collapsed?: boolean;
  renderHandle?: (pin: BlueprintPin) => ReactNode;
  inputSources?: ReadonlyMap<string, string>;
  inputSourceNodes?: ReadonlyMap<string, string>;
  onLocateNode?: (id: string) => void;
  onDisconnect?: (pinId: string) => void;
}

/** Stable row IDs are also the input IDs; changing a compatible property never
 * replaces its connection, and deleting a row is one normal history edit. */
export function BlueprintUiPropertyFields({ project, graph, node, edit, surface = 'inspector', collapsed = false, renderHandle, inputSources, inputSourceNodes, onLocateNode, onDisconnect }: PropertyFieldsProps) {
  const definition = blueprintUiPropertyDefinition(node), rows = definition.rows ?? [], analysis = blueprintUiPropertyAnalysis(project);
  const { component, available, canonical } = propertyContext(project, graph, node), used = usedProperties(rows, canonical);
  const addable = available.filter(property => !used.has(canonical(property)));
  const controls = rows.flatMap(row => { const control = analysis.property(graph, node, row.property); return control ? [control] : []; });
  const following = controls.filter(item => item.control.mode === 'follow'), syncing = controls.filter(item => item.control.mode === 'sync');
  const problems = [...definition.problems, ...controls.flatMap(control => control.problem ? [control.problem] : [])];
  for (const row of rows) {
    const info = propertyInfo(row.property);
    if (!info) continue;
    if (invalidSourceMode(project, graph, node, row)) problems.push(info.name + '没有可修改的绑定源，请选择临时覆盖。');
    if (usedProperties(rows, canonical, row.id).has(canonical(row.property))) problems.push(info.name + '与其他项修改同一属性，请保留一项。');
    if (!info.writable) problems.push(info.name + '为只读属性。');
    else if (component && !uiPropertyApplies(component, row.property as UiProperty, project)) problems.push('当前组件不支持“' + info.name + '”。');
    else if (!graph.links.some(link => link.toNodeId === node.id && link.toPinId === row.id)) {
      const problem = uiPropertyValueProblem(project, row.property, blueprintInputValue(node, row.id) ?? info.initial);
      if (problem) problems.push(problem);
    }
  }
  const status = problems.length ? [...new Set(problems)].join(' ') + ' 整组属性都不会修改。'
    : following.length ? blueprintUiPropertyControlTargets(following) + '单向跟随参数，整组属性都不会修改。'
    : syncing.length ? blueprintUiPropertyControlTargets(syncing) + '双向同步；整组有效时写回对应参数，任一项无效则都不修改。'
    : analysis.contextDependent(graph, node) ? '目标按运行时检查；任一项无效或单向跟随参数，整组属性都不修改。'
    : !component ? '先选择界面组件或为目标接线；可用属性会随目标变化。'
    : `一次执行同时设置 ${rows.length} 项；任一项无效，整组都不修改。`;
  const changeProperty = (id: string, property: string) => edit(target => {
    const current = blueprintUiPropertyDefinition(target).rows, context = propertyContext(project, graph, target);
    if (!current || !current.some(row => row.id === id) || !context.available.includes(property as UiProperty) || usedProperties(current, context.canonical, id).has(context.canonical(property))) return;
    const row = current.find(row => row.id === id)!;
    if (row.property === property) return;
    updateRows(target, current.map(row => row.id === id ? { ...row, property, writeMode: 'override' } : row));
    target.properties[id] = initialValue(project, graph, target, property as UiProperty);
  });
  const changeMode = (id: string, writeMode: string) => edit(target => {
    const current = blueprintUiPropertyDefinition(target).rows;
    if (!current || !current.some(row => row.id === id) || !['override', 'source'].includes(writeMode)) return;
    updateRows(target, current.map(row => row.id === id ? { ...row, writeMode } : row));
  });
  const remove = (id: string) => edit(target => {
    const current = blueprintUiPropertyDefinition(target).rows;
    if (!current || current.length <= 1 || !current.some(row => row.id === id)) return;
    setBlueprintUiPropertyRows(target, current.filter(row => row.id !== id));
  });
  const add = (property: string) => edit(target => {
    const current = blueprintUiPropertyDefinition(target).rows, context = propertyContext(project, graph, target);
    if (!current || current.length >= maxBlueprintUiPropertyRows || usedProperties(current, context.canonical).has(context.canonical(property)) || !context.available.includes(property as UiProperty)) return;
    const id = blueprintUiPropertyRowId(target);
    setBlueprintUiPropertyRows(target, [...current, { id, property, writeMode: 'override' }]);
    target.properties[id] = initialValue(project, graph, target, property as UiProperty);
  });
  return <div className={`blueprint-property-fields blueprint-property-fields-${surface}`} data-property-batch-version={definition.legacy ? 'legacy' : String(node.properties.propertyBatchVersion ?? '')}>
    {rows.map((row, index) => {
      const info = propertyInfo(row.property), name = propertyName(row.property);
      const pin: BlueprintPin = node.pins.find(pin => pin.id === row.id && pin.direction === 'input') ?? { id: row.id, name, direction: 'input', dataType: uiPropertyPinType(row.property) ?? 'any', required: false };
      const connection = graph.links.find(link => link.toNodeId === node.id && link.toPinId === row.id);
      const source = connection && (inputSources?.get(row.id) ?? blueprintInputSource(project, graph, node.id, row.id, immutableAuthoringIndex)?.label ?? '缺失节点');
      const sourceNode = connection && (inputSourceNodes?.get(row.id) ?? graph.nodes.find(node => node.id === connection.fromNodeId)?.id);
      const control = analysis.property(graph, node, row.property), invalidMode = !['override', 'source'].includes(row.writeMode) || invalidSourceMode(project, graph, node, row);
      const showMode = isUiControlValueProperty(row.property) && !control || invalidMode;
      const usedByOthers = usedProperties(rows, canonical, row.id);
      const choices = available.filter(property => property === row.property || !usedByOthers.has(canonical(property)));
      const rowTitle = [name, info?.description, control && `${control.control.mode === 'follow' ? '单向跟随' : '双向同步'}参数“${control.parameterName}”`, connection && '来自：' + source].filter(Boolean).join('\n');
      return <div className="blueprint-property-entry" key={row.id} data-property-id={row.property} data-property-row-id={row.id}>
        <div className={`blueprint-pin-slot input blueprint-property-row ${collapsed ? 'collapsed' : ''}`} data-pin-id={row.id} data-pin-direction="input" data-pin-type={pin.dataType} title={rowTitle}>
          {renderHandle?.(pin)}
          {collapsed ? <span className="blueprint-pin-label blueprint-property-name">{name}</span> : <>
            <select className="blueprint-property-select nodrag nopan nowheel" aria-label={`${node.name} · 第${index + 1}项属性`} title={rowTitle} value={row.property} onPointerDown={event => event.stopPropagation()} onChange={event => changeProperty(row.id, event.target.value)}>
              {!choices.includes(row.property as UiProperty) && <option value={row.property}>{name}（当前不可用）</option>}{propertyOptions(choices)}
            </select>
            <div className="blueprint-pin-value nodrag nopan nowheel" onPointerDown={event => event.stopPropagation()}>
              {connection ? <div className="blueprint-property-source"><button type="button" className="blueprint-pin-source" title={'来自：' + source} aria-label={`定位${name}来源：${source}`} disabled={!sourceNode || !onLocateNode} onClick={event => { event.stopPropagation(); if (sourceNode) onLocateNode?.(sourceNode); }}>来自：{source}</button>
                {surface === 'inspector' && onDisconnect && <button type="button" className="blueprint-property-icon" title={`断开${name}的数据线`} aria-label={`断开${name}的数据线`} onClick={() => onDisconnect(row.id)}><X size={12} /></button>}
              </div> : <BlueprintUiPropertyValue project={project} graph={graph} node={node} pin={pin} edit={edit} label={`${node.name} · ${name}`} surface={surface} />}
            </div>
            <button type="button" className="blueprint-property-icon blueprint-property-remove nodrag nopan" aria-label={`删除第${index + 1}项属性：${name}`} title={rows.length === 1 ? '至少保留一项属性' : `删除“${name}”及其连线；可撤销`} disabled={rows.length === 1} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); remove(row.id); }}><X size={12} /></button>
          </>}
        </div>
        {!collapsed && showMode && <label className="blueprint-property-mode nodrag nopan nowheel" onPointerDown={event => event.stopPropagation()} title="默认设置的控件值可临时覆盖，或写回原绑定源；不会触发用户改值事件。">
          <span>赋值方式</span><select aria-label={`${node.name} · ${name} · 赋值方式`} value={row.writeMode} onChange={event => changeMode(row.id, event.target.value)}>{!['override', 'source'].includes(row.writeMode) && <option value={row.writeMode}>失效方式 · {row.writeMode}</option>}<option value="override">临时覆盖本控件</option><option value="source">{invalidSourceMode(project, graph, node, row) ? '修改绑定源（无来源）' : '修改绑定源'}</option></select>
        </label>}
      </div>;
    })}
    {!collapsed && <>
      {definition.rows && <div className="blueprint-property-add nodrag nopan nowheel" onPointerDown={event => event.stopPropagation()}><Plus size={12} /><select aria-label={`${node.name} · 添加属性`} title="选择要同时设置的属性；每项都可单独接线。" value="" disabled={!addable.length || rows.length >= maxBlueprintUiPropertyRows} onChange={event => { if (event.target.value) add(event.target.value); }}>
        <option value="">{rows.length >= maxBlueprintUiPropertyRows ? `最多 ${maxBlueprintUiPropertyRows} 项属性` : addable.length ? '添加属性' : '已添加全部可用属性'}</option>{propertyOptions(addable)}
      </select></div>}
      <small className="blueprint-property-status" role="status" data-warning={problems.length > 0 || following.length > 0 || undefined} title={status}>{status}</small>
    </>}
  </div>;
}
