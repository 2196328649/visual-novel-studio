import { editableUiComponent, effectiveUiComponents, uiComponentLimit, variableAssetKind, type Project, type UiComponent, type UiPropertyControl, type Variable } from './model';
import { uiProperties, uiPropertyApplies, uiPropertyPinType, uiPropertyValueProblem, type UiProperty } from './ui-properties';
import { isUiControlRangeProperty, isUiControlValueProperty, uiControlDefinition, uiControlPrimaryProperty, uiControlRangeFields, uiControlRangeProblem, uiControlValueProblem } from './ui-control-properties';
import { uiControlPropertyAssignmentProblem } from './ui-control-authoring';
import { detachUiParameterBinding, listUiParameterBindings } from './ui-parameter-links';

export type { UiPropertyControl } from './model';
export const uiPropertyControlModes = { default: '默认设置', follow: '单向跟随参数', sync: '与参数双向同步' } as const;
const supportedAssets = new Set(['image', 'audio', 'video']);
const known = (property: string): property is UiProperty => Object.hasOwn(uiProperties, property);

/** Ratios and selected-option indices are alternate views of the same writable value. */
export function uiPropertyControlKey(project: Project, component: UiComponent, property: UiProperty): UiProperty {
  if (!isUiControlValueProperty(property)) return property;
  const definition = uiControlDefinition(project, component);
  return definition ? uiControlPrimaryProperty(definition) : property;
}

/** Reading the source never validates a changing value, rewrites a key or migrates old graphs. */
export function uiPropertyControlFor(project: Project, component: UiComponent, property: UiProperty): { property: UiProperty; control: UiPropertyControl } | undefined {
  const key = uiPropertyControlKey(project, component, property), entries = component.propertyControls;
  if (!entries) return;
  if (Object.hasOwn(entries, key)) return { property: key, control: entries[key] };
  const alias = Object.keys(entries).find(candidate => known(candidate) && uiPropertyControlKey(project, component, candidate) === key);
  return alias ? { property: key, control: entries[alias] } : undefined;
}

/** Valid metadata is independent from the parameter's current (or initial) value. */
export function uiPropertyControlSourceProblem(project: Project, component: UiComponent, property: string, control: UiPropertyControl): string | undefined {
  if (!known(property)) return '此属性尚不受支持，原关联已保留：' + property;
  const key = uiPropertyControlKey(project, component, property), info = uiProperties[key];
  if (!info.writable || !info.bindable || !uiPropertyApplies(component, property, project) || !uiPropertyApplies(component, key, project)) return '当前控件不支持关联这项属性：' + uiProperties[property].name;
  if (!control || !['follow', 'sync'].includes(control.mode)) return '属性控制方式无效，请重新选择默认设置、单向跟随或双向同步。';
  if (!control.parameterId || typeof control.parameterId !== 'string') return '请选择来源参数。';
  const aliases = Object.keys(component.propertyControls ?? {}).filter(candidate => known(candidate) && uiPropertyControlKey(project, component, candidate) === key);
  if (aliases.length > 1) return '同一当前值有多项参数关联，请重新选择这一项的控制来源。';
  if (aliases.some(candidate => !uiPropertyApplies(component, candidate as UiProperty, project))) return '保存的当前值属性不适用于此控件，请重新选择这一项的控制来源。';
  if (info.resource && !supportedAssets.has(info.resource)) return '参数集目前不支持此素材类型，请使用默认设置或蓝图。';
  const parameter = project.variables.find(variable => variable.id === control.parameterId);
  if (!parameter) return '来源参数已删除，关联已保留，请重新选择参数或恢复默认设置。';
  if (parameter.type !== uiPropertyPinType(key) || parameter.type === 'asset' && variableAssetKind(parameter) !== info.resource) return '来源参数类型与“' + info.name + '”不匹配，请重新选择。';
}

function initialControlValue(project: Project, component: UiComponent, property: UiProperty) {
  const linked = uiPropertyControlFor(project, component, property);
  if (!linked || uiPropertyControlSourceProblem(project, component, property, linked.control)) return;
  const value = project.variables.find(variable => variable.id === linked.control.parameterId)!.initial;
  return uiPropertyValueProblem(project, property, value) ? undefined : value;
}

/** Authoring validates the initial value; preview/runtime separately validate current values. */
export function uiPropertyControlProblem(project: Project, component: UiComponent, property: string, control: UiPropertyControl): string | undefined {
  const sourceProblem = uiPropertyControlSourceProblem(project, component, property, control);
  if (sourceProblem || !known(property)) return sourceProblem;
  const parameter = project.variables.find(variable => variable.id === control.parameterId)!;
  const key = uiPropertyControlKey(project, component, property);
  // A source parameter can exceed a slider's display range. Clamping belongs
  // to presentation and must never rewrite or disqualify that source value.
  let valueProblem = uiPropertyValueProblem(project, key, parameter.initial);
  if (!valueProblem && isUiControlRangeProperty(key)) {
    const definition = uiControlDefinition(project, component)!;
    const range = { ...definition.range! };
    // Read the complete starting range; comparing a linked minimum against
    // only the original maximum would reject valid linked range pairs.
    for (const candidate of Object.keys(uiControlRangeFields) as (keyof typeof uiControlRangeFields)[]) {
      const value = candidate === key ? parameter.initial : initialControlValue(project, component, candidate);
      if (typeof value === 'number') range[uiControlRangeFields[candidate]] = value;
    }
    valueProblem = uiControlRangeProblem(definition, range);
  } else if (!valueProblem && key === 'numberValue') {
    valueProblem = uiControlValueProblem({ ...uiControlDefinition(project, component)!, range: undefined }, parameter.initial);
  } else if (!valueProblem) {
    const maxLength = initialControlValue(project, component, 'maxLength');
    const effective = typeof maxLength === 'number' ? { ...component, input: { ...component.input, maxLength } } : component;
    valueProblem = uiControlPropertyAssignmentProblem(project, effective, key, parameter.initial);
  }
  return valueProblem ? '来源参数的初始值不适用：' + valueProblem : undefined;
}

/** Candidates match type; invalid initial values stay selectable with an explicit explanation. */
export function uiPropertyControlCandidates(project: Project, component: UiComponent, property: UiProperty): Variable[] {
  if (!known(property)) return [];
  const key = uiPropertyControlKey(project, component, property), info = uiProperties[key];
  if (!info.writable || !info.bindable || !uiPropertyApplies(component, property, project) || !uiPropertyApplies(component, key, project) || info.resource && !supportedAssets.has(info.resource)) return [];
  return project.variables.filter(variable => variable.type === uiPropertyPinType(key) && (variable.type !== 'asset' || variableAssetKind(variable) === info.resource));
}

/** Include unknown and conflicting entries so the inspector can offer repair instead of hiding them. */
export function uiPropertyControlProblems(project: Project, component: UiComponent): { property: string; message: string }[] {
  return Object.entries(component.propertyControls ?? {}).flatMap(([property, control]) => {
    const message = uiPropertyControlProblem(project, component, property, control);
    return message ? [{ property, message }] : [];
  });
}

function linkedInputOverflow(project: Project, component: UiComponent): number {
  if (!uiControlDefinition(project, component)?.textInput) return 0;
  const value = initialControlValue(project, component, 'stringValue');
  if (typeof value !== 'string') return 0;
  const linkedLimit = initialControlValue(project, component, 'maxLength');
  const limit = typeof linkedLimit === 'number' ? linkedLimit : component.input?.maxLength ?? 200;
  return Math.max(0, Array.from(value).length - limit);
}

/** Preview the exact edit before a dialog or command commits it. Existing unrelated errors remain repairable. */
export function uiPropertyControlChange(project: Project, component: UiComponent, property: string, control?: UiPropertyControl): { controls: NonNullable<UiComponent['propertyControls']>; problem?: string } {
  const key = known(property) ? uiPropertyControlKey(project, component, property) : property;
  const controls = { ...component.propertyControls };
  for (const candidate of Object.keys(controls)) if (candidate === key || known(candidate) && uiPropertyControlKey(project, component, candidate) === key) delete controls[candidate];
  if (control) controls[key] = { mode: control.mode, parameterId: control.parameterId };
  const next = { ...component, propertyControls: controls };
  if (control) {
    const problem = uiPropertyControlProblem(project, next, property, control);
    if (problem) return { controls, problem };
  }
  const lengthWorsened = key === 'maxLength' && linkedInputOverflow(project, next) > linkedInputOverflow(project, component);
  for (const [candidate, existing] of Object.entries(controls)) {
    if (candidate === key) continue;
    const problem = uiPropertyControlProblem(project, next, candidate, existing);
    if (!problem) continue;
    const previous = uiPropertyControlProblem(project, component, candidate, existing);
    if (problem !== previous || lengthWorsened && known(candidate) && uiPropertyControlKey(project, next, candidate) === 'stringValue') {
      const name = known(candidate) ? uiProperties[candidate].name : candidate;
      return { controls, problem: `此修改会使“${name}”的关联失效或加重原问题：${problem}请先调整该属性或来源参数。` };
    }
  }
  return { controls };
}

/** Mutate only a caller's project draft. Validation completes before any component or graph write. */
export function setUiPropertyControl(project: Project, componentId: string, pageId: string, property: UiProperty, control?: UiPropertyControl): void {
  const standard = pageId.startsWith('ui:');
  if (standard && project.ui.activeInstanceId && !project.ui.instances?.some(instance => instance.id === project.ui.activeInstanceId)) throw new Error('当前界面方案已不存在。');
  const page = standard ? undefined : project.ui.customPages.find(item => item.id === pageId);
  const component = standard ? effectiveUiComponents(project.ui).find(item => item.id === componentId && 'ui:' + item.page === pageId) : page?.components.find(item => item.id === componentId);
  if (!component) throw new Error('控件已删除或不属于当前页面，请重新选择。');
  // An unknown saved key can still be removed through its repair menu.
  if (!known(property) && control) throw new Error('此属性尚不受支持：' + property);
  const key = known(property) ? uiPropertyControlKey(project, component, property) : property;
  const { controls: next, problem } = uiPropertyControlChange(project, component, property, control);
  if (problem) throw new Error(problem);
  const old = component.propertyControls ?? {};
  const changed = Object.keys(old).length !== Object.keys(next).length || Object.keys(next).some(candidate => old[candidate]?.mode !== next[candidate].mode || old[candidate]?.parameterId !== next[candidate].parameterId);
  // Existing independent timer bindings are removed only by this explicit author operation.
  // User-authored/shared/inherited graphs remain intact and are reported as controlling sources.
  const obsolete = known(property) ? listUiParameterBindings(project, componentId, pageId).filter(binding => binding.managed && uiPropertyControlKey(project, component, binding.property) === key) : [];
  if (!changed && !obsolete.length) return;
  if (changed && standard) {
    const local = project.ui.instances?.find(instance => instance.id === project.ui.activeInstanceId)?.components ?? project.ui.components;
    if (!local.some(item => item.id === componentId) && local.length >= uiComponentLimit) throw new Error('当前界面的对象数量已达上限，无法建立继承覆盖。');
  }
  // All detach operations have already passed the same ownership check above.
  for (const binding of obsolete) detachUiParameterBinding(project, binding.graphId, pageId);
  if (!changed) return;
  const editable = standard ? editableUiComponent(project.ui, componentId)! : component;
  if (Object.keys(next).length) editable.propertyControls = next;
  else delete editable.propertyControls;
}
