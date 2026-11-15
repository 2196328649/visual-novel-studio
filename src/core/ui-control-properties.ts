import type { Project, UiComponent, VariableValue } from './model';
import { parameterRange } from './parameter-sets';
import { playerPreferences, playerPreferenceOptions, preferenceInfo } from './preferences';
import { uiTextInput } from './ui-control-events';
import { uiControlOptionMatches, type UiControlOption } from './ui-control-options';

export interface UiControlRange { min: number; max: number; step: number }

export interface UiControlDefinition {
  type: 'number' | 'string' | 'boolean';
  initial: VariableValue;
  parameterId?: string;
  preference?: UiComponent['preference'];
  characterId?: string;
  /** Effective authored range; runtime copies replace only this field. */
  range?: UiControlRange;
  /** Binding metadata, not an implicit constraint on story-variable assignments. */
  sourceRange?: UiControlRange;
  instantAtEnd?: boolean;
  slider: boolean;
  textInput: boolean;
  /** Stable binding kind; an empty runtime list never turns into free text. */
  choice: boolean;
  options: UiControlOption[];
}
export const uiControlValueProperties = ['numberValue', 'stringValue', 'booleanValue', 'normalizedValue', 'optionIndex'] as const;
export function isUiControlValueProperty(property: string): boolean { return (uiControlValueProperties as readonly string[]).includes(property); }
export function uiControlPrimaryProperty(info: UiControlDefinition) { return info.type === 'number' ? 'numberValue' : info.type === 'boolean' ? 'booleanValue' : 'stringValue'; }
export const uiControlRangeFields = { minimum: 'min', maximum: 'max', step: 'step' } as const;
export type UiControlRangeProperty = keyof typeof uiControlRangeFields;
export function isUiControlRangeProperty(property: string): property is UiControlRangeProperty { return Object.hasOwn(uiControlRangeFields, property); }
export function uiControlRangeProblem(info: UiControlDefinition | undefined, range: UiControlRange): string | undefined {
  if (info && info.type !== 'number') return '范围只适用于数值控件。';
  if (![range.min, range.max, range.step].every(value => typeof value === 'number' && Number.isFinite(value))) return '控件范围与步长必须是有限数值。';
  if (range.max < range.min) return '控件范围下限不能大于上限；跨越原范围时请一次设置整个范围。';
  if (!Number.isFinite(range.max - range.min)) return '控件范围跨度过大。';
  if (range.step <= 0) return '控件步长必须大于 0。';
  if (range.max > range.min && range.step / (range.max - range.min) === 0) return '控件步长相对范围过小，无法表示用户调整。';
  const limit = info?.preference ? playerPreferences[info.preference].limit : undefined;
  if (limit && (range.min < limit.min || limit.max !== undefined && range.max > limit.max)) return '控件范围不能超过玩家设置的引擎边界。';
}
export function uiControlWithRange(info: UiControlDefinition, values?: Partial<Record<UiControlRangeProperty, VariableValue>>): UiControlDefinition {
  if (!info.range) return info;
  return { ...info, range: { min: Number(values?.minimum ?? info.range.min), max: Number(values?.maximum ?? info.range.max), step: Number(values?.step ?? info.range.step) } };
}
/** Range changes are display-only. Expanding/resetting reveals the original source or override again. */
export function uiControlEffectiveValue(info: UiControlDefinition, value: VariableValue): VariableValue {
  if (info.type !== 'number' || !info.range || typeof value !== 'number') return value;
  const { min, max } = info.range;
  if (info.instantAtEnd) {
    if (value === 0) return min === 0 ? 0 : max;
    if (min === 0) return Math.max(Math.min(1, max), Math.min(max, value));
  }
  return Math.max(min, Math.min(max, value));
}
/** Travel includes a final sentinel slot when zero means instant text. */
export function uiControlTravel(info: UiControlDefinition): { start: number; span: number; instant: boolean } {
  const range = info.range!;
  const instant = !!info.instantAtEnd && range.min === 0 && range.max > 0;
  const start = instant ? Math.min(1, range.max) : range.min;
  return { start, span: range.max === range.min ? 0 : range.max - start + (instant ? Math.min(range.step, range.max) : 0), instant };
}

/** One shared description of a control's binding. Build once per runtime/preview snapshot. */
export function uiControlDefinition(project: Project, component: UiComponent): UiControlDefinition | undefined {
  if (!['preference', 'preferenceChoice'].includes(component.kind)) return;
  if (component.parameterId) {
    const parameter = project.variables.find(item => item.id === component.parameterId);
    // Asset parameters have no player-facing control.
    if (!parameter || parameter.type === 'asset') return;
    return { type: parameter.type, initial: parameter.initial, parameterId: parameter.id,
      sourceRange: parameter.type === 'number' ? parameterRange(parameter) : undefined,
      range: parameter.type === 'number' ? component.controlRange ?? parameterRange(parameter) : undefined,
      slider: parameter.type === 'number', textInput: uiTextInput(project, component), choice: parameter.type === 'string' && !!parameter.setting?.options?.length,
      options: parameter.type === 'string' ? (parameter.setting?.options ?? []).map(value => ({ label: value, value })) : [] };
  }
  const key = component.preference;
  if (!key || !playerPreferences[key]) return;
  // The author's range for this setting; a control may narrow it further.
  const preference = preferenceInfo(project, key);
  const sourceRange = preference.type === 'number' ? { min: preference.min, max: preference.max, step: preference.step } : undefined;
  return { type: preference.type, initial: preference.initial, preference: key, characterId: component.preferenceCharacterId,
    sourceRange, range: sourceRange && (component.controlRange ?? sourceRange),
    instantAtEnd: key === 'textSpeed', slider: component.kind === 'preference', textInput: false, choice: component.kind === 'preferenceChoice',
    options: component.kind === 'preferenceChoice' ? component.selector?.options ?? playerPreferenceOptions(key, project) : [] };
}

export function uiControlPropertyApplies(info: UiControlDefinition | undefined, property: string): boolean {
  if (property === 'numberValue' || property === 'normalizedValue' || ['minimum', 'maximum', 'step', 'sourceMinimum', 'sourceMaximum', 'sourceStep'].includes(property)) return info?.type === 'number';
  if (property === 'stringValue') return info?.type === 'string';
  if (property === 'booleanValue') return info?.type === 'boolean';
  if (['optionCount', 'optionIndex', 'optionLabel'].includes(property)) return !!info?.choice;
  if (['placeholder', 'maxLength', 'focused'].includes(property)) return !!info?.textInput;
  if (property.startsWith('slider')) return !!info?.slider;
  if (property === 'readOnly') return !!info;
  return true;
}
export function uiControlRatio(info: UiControlDefinition, value: VariableValue): number {
  const travel = uiControlTravel(info), current = Number(uiControlEffectiveValue(info, value));
  return travel.span === 0 ? 0 : travel.instant && current === 0 ? 1 : Math.max(0, Math.min(1, (current - travel.start) / travel.span));
}
export function uiControlFromRatio(info: UiControlDefinition, ratio: number): number {
  const travel = uiControlTravel(info);
  return travel.instant && ratio === 1 ? 0 : Math.min(info.range!.max, travel.start + ratio * travel.span);
}
/** Decimal places of a finite number, e.g. 2 for 0.05 and 7 for 1e-7. */
const decimals = (value: number) => {
  const [digits, exponent] = String(value).split('e');
  return Math.max(0, (digits.split('.')[1]?.length ?? 0) - Number(exponent ?? 0));
};
/** Match native input: nearest step from the lower endpoint, with both endpoints reachable. */
export function uiControlUserValue(info: UiControlDefinition, ratio: number): number {
  const normalized = Math.max(0, Math.min(1, ratio)), travel = uiControlTravel(info), range = info.range!;
  const value = uiControlFromRatio(info, normalized);
  if (normalized === 0 || normalized === 1 || travel.span === 0) return value;
  const count = (value - travel.start) / range.step;
  // Round to the step's precision so 35 steps of 0.01 give 0.35, not 0.35000000000000003.
  const snapped = Number.isFinite(count) ? Number((travel.start + Math.floor(count + .5) * range.step).toFixed(Math.min(15, Math.max(decimals(travel.start), decimals(range.step))))) : value;
  return Math.max(travel.start, Math.min(range.max, snapped));
}
export function uiControlPropertyDefault(info: UiControlDefinition, property: string): VariableValue | undefined {
  if (property === uiControlPrimaryProperty(info)) return uiControlEffectiveValue(info, info.initial);
  if (property === 'minimum') return info.range?.min;
  if (property === 'maximum') return info.range?.max;
  if (property === 'step') return info.range?.step;
  if (property === 'sourceMinimum') return info.sourceRange?.min;
  if (property === 'sourceMaximum') return info.sourceRange?.max;
  if (property === 'sourceStep') return info.sourceRange?.step;
  if (property === 'normalizedValue' && info.range) return uiControlRatio(info, info.initial);
  if (property === 'optionCount') return info.options.length;
  if (property === 'optionIndex') return info.options.findIndex(option => uiControlOptionMatches(option.value, uiControlEffectiveValue(info, info.initial)));
  if (property === 'optionLabel') return info.options.find(option => uiControlOptionMatches(option.value, uiControlEffectiveValue(info, info.initial)))?.label ?? '';
}
/** Program assignment is deliberately not a user-input event. Both paths still enforce the control contract. */
export function uiControlAssignedValue(info: UiControlDefinition, property: string, value: VariableValue): VariableValue {
  if (property === 'normalizedValue') return uiControlFromRatio(info, Number(value));
  if (property === 'optionIndex') {
    const option = info.options[Number(value)];
    if (!Number.isInteger(value) || !option) throw new Error('选项索引必须指向现有选项；-1 只表示当前值没有匹配项。');
    return option.value;
  }
  return value;
}
export function uiControlValueProblem(info: UiControlDefinition, value: VariableValue, maxLength = 200): string | undefined {
  if (typeof value !== info.type) return '控件值与绑定源类型不匹配。';
  if (typeof value === 'number' && (!Number.isFinite(value) || info.range && (value < info.range.min || value > info.range.max))) return '控件数值超出当前有效范围。';
  if (info.choice && !info.options.some(option => uiControlOptionMatches(option.value, value))) return '控件值不在当前选项中。';
  if (info.textInput && typeof value === 'string' && Array.from(value).length > maxLength) return '文字长度超出输入框限制。';
}
