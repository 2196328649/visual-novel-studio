import type { Project, UiComponent, VariableValue } from './model';
import { playerPreferences, playerPreferenceOptions, preferenceInfo, validPlayerPreference, type PlayerPreference } from './preferences';
import { isUiControlRangeProperty, isUiControlValueProperty, uiControlAssignedValue, uiControlDefinition, uiControlRangeFields, uiControlRangeProblem, uiControlValueProblem } from './ui-control-properties';
import { uiPropertyValueProblem } from './ui-properties';

export function uiControlBindingName(project: Project, component: UiComponent): string {
  if (component.parameterId) {
    const parameter = project.variables.find(variable => variable.id === component.parameterId);
    return !parameter ? '参数已删除' : parameter.type === 'asset' ? '参数类型不适用：' + parameter.name : parameter.name;
  }
  return component.preference && playerPreferences[component.preference] ? preferenceInfo(project, component.preference).name : '尚未绑定';
}

export function uiControlKindName(project: Project, component: UiComponent): string {
  if (!['preference', 'preferenceChoice'].includes(component.kind)) return '';
  const definition = uiControlDefinition(project, component);
  return !definition ? '设置控件 · 绑定失效' : definition.choice ? definition.parameterId ? '选项组' : '下拉菜单' : definition.textInput ? '文字输入框' : definition.type === 'boolean' ? '开关' : '滑条';
}

/** Check a simple parameter link against the same initial control contract as
 * program assignment. Dynamically changing ranges or options still belong in
 * the full blueprint editor, where their execution order can be expressed. */
export function uiControlPropertyAssignmentProblem(project: Project, component: UiComponent, property: string, value: VariableValue): string | undefined {
  const problem = uiPropertyValueProblem(project, property, value);
  if (problem) return problem;
  if (!isUiControlRangeProperty(property) && !isUiControlValueProperty(property)) return;
  const control = uiControlDefinition(project, component);
  if (!control) return '当前控件的绑定源已失效。';
  if (isUiControlRangeProperty(property)) {
    if (!control.range) return '当前控件没有数值范围。';
    return uiControlRangeProblem(control, { ...control.range, [uiControlRangeFields[property]]: Number(value) });
  }
  try {
    return uiControlValueProblem(control, uiControlAssignedValue(control, property, value), component.input?.maxLength ?? 200);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Change the source and discard only source-dependent settings which no longer
 * satisfy its contract. Presentation settings remain available when returning
 * to that input mode; one authoring commit owns the entire transition. */
export function changeUiControlBinding(project: Project, component: UiComponent, binding: string): void {
  const before = component.parameterId ? 'parameter:' + component.parameterId : component.preference ?? '';
  if (binding === before) return;
  if (binding.startsWith('parameter:')) {
    const parameter = project.variables.find(variable => variable.id === binding.slice(10));
    if (!parameter || parameter.type === 'asset' || component.action === 'setPlayerPreference') throw new Error('请选择有效的数值、开关或文字参数。');
    component.parameterId = parameter.id;
    delete component.preference;
    delete component.preferenceValue;
    delete component.preferenceCharacterId;
    // Parameter options come from their source. Keep the inactive native
    // dropdown intact so switching back does not discard custom labels.
  } else {
    if (!Object.hasOwn(playerPreferences, binding)) throw new Error('请选择有效的玩家设置。');
    const preference = binding as PlayerPreference;
    if (component.action !== 'setPlayerPreference' && !['preferences', 'voiceSettings'].includes(component.page)) throw new Error('内置玩家设置控件应放在设置或角色音量页；当前页面可绑定作品参数。');
    if (component.kind === 'preference' && playerPreferences[preference].type !== 'number') throw new Error('此滑条只能绑定数值玩家设置。');
    delete component.parameterId;
    component.preference = preference;
    component.preferenceValue = preferenceInfo(project, preference).initial;
    delete component.preferenceCharacterId;
    if (component.kind === 'preferenceChoice' && !component.selector?.options.every(option => validPlayerPreference(preference, option.value))) {
      component.selector = { ...component.selector, options: playerPreferenceOptions(preference, project) };
    }
  }
  if (component.controlRange) {
    const definition = uiControlDefinition(project, component);
    if (!definition || definition.type !== 'number' || uiControlRangeProblem(definition, component.controlRange)) delete component.controlRange;
  }
}
