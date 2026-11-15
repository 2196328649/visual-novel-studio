import type { Project, UiComponent, Variable, VariableValue } from './model';
import { cloneData } from './project-mutation';
import { uiAssetBinding, uiBoundAssetId } from './ui-asset-binding';
import { uiControlDefinition, uiControlPrimaryProperty, uiControlEffectiveValue, uiControlRangeFields, uiControlRangeProblem, uiControlValueProblem } from './ui-control-properties';
import { applyUiPropertySnapshot, uiProperties, uiPropertyFallbacks, uiPropertyValueProblem, type UiProperty } from './ui-properties';
import { uiPropertyControlFor, uiPropertyControlKey, uiPropertyControlProblem, uiPropertyControlSourceProblem } from './ui-property-control';
import { uiSpineSkinProblem } from './ui-spine';

export interface UiPropertyControlSnapshot {
  component: UiComponent;
  values: Partial<Record<UiProperty, VariableValue>>;
}

const parameterValue = (parameter: Variable, current?: Readonly<Record<string, VariableValue>>) =>
  current && Object.hasOwn(current, parameter.id) ? current[parameter.id] : parameter.initial;

/** Validate a current frame independently from the author's initial values.
 * Invalid sources leave the authored field intact; one bad field cannot erase
 * the remaining dialogue frame. Related range fields are checked together. */
function currentControlValues(project: Project, component: UiComponent, current: Readonly<Record<string, VariableValue>>): UiPropertyControlSnapshot['values'] {
  const values: UiPropertyControlSnapshot['values'] = {};
  for (const [name, control] of Object.entries(component.propertyControls ?? {})) {
    if (!Object.hasOwn(uiProperties, name) || uiPropertyControlSourceProblem(project, component, name, control)) continue;
    const property = uiPropertyControlKey(project, component, name as UiProperty);
    const value = parameterValue(project.variables.find(parameter => parameter.id === control.parameterId)!, current);
    if (!uiPropertyValueProblem(project, property, value)) values[property] = value;
  }
  if (!Object.keys(values).length) return values;
  const definition = uiControlDefinition(project, component);
  if (definition) {
    const range = definition.range && { ...definition.range };
    const rangeProperties = Object.keys(uiControlRangeFields) as (keyof typeof uiControlRangeFields)[];
    if (range && rangeProperties.some(property => Object.hasOwn(values, property))) {
      for (const property of rangeProperties) {
        const value = values[property];
        if (typeof value === 'number') range[uiControlRangeFields[property]] = value;
      }
      if (uiControlRangeProblem(definition, range)) for (const property of rangeProperties) delete values[property];
    }
    const primary = uiControlPrimaryProperty(definition), value = values[primary];
    const maxLength = typeof values.maxLength === 'number' ? values.maxLength : component.input?.maxLength ?? 200;
    // A numeric source outside its display range is valid; clamp the private
    // display below, without rewriting either source or authored defaults.
    if (value !== undefined && uiControlValueProblem({ ...definition, range: undefined }, value, maxLength)) delete values[primary];
  }
  if (values.spineSkin !== undefined && uiSpineSkinProblem(project.assets.find(asset => asset.id === component.assetId), values.spineSkin)) delete values.spineSkin;
  return values;
}

/** Initial parameter values for the design canvas, without executing page logic
 * or writing those values into the authored component or the parameter set. */
export function uiPropertyControlDesignSnapshot(project: Project, authored: UiComponent): UiPropertyControlSnapshot {
  return uiPropertyControlSnapshot(project, authored);
}

/** A read-only render snapshot. Omitting current values preserves the design
 * canvas's initial-value semantics; supplying them samples story parameters. */
export function uiPropertyControlSnapshot(project: Project, authored: UiComponent, current?: Readonly<Record<string, VariableValue>>): UiPropertyControlSnapshot {
  const values: UiPropertyControlSnapshot['values'] = current === undefined ? {} : currentControlValues(project, authored, current);
  if (current === undefined) for (const [name, control] of Object.entries(authored.propertyControls ?? {})) {
    if (!Object.hasOwn(uiProperties, name) || uiPropertyControlProblem(project, authored, name, control)) continue;
    const property = uiPropertyControlKey(project, authored, name as UiProperty);
    values[property] = project.variables.find(parameter => parameter.id === control.parameterId)!.initial;
  }
  const mediaProperty = authored.kind === 'image' ? 'image' : authored.kind === 'video' ? 'video' : undefined;
  const explicitMedia = mediaProperty && uiPropertyControlFor(project, authored, mediaProperty);
  const legacyMedia = explicitMedia ? undefined : uiAssetBinding(project, authored);
  if (!Object.keys(values).length && !legacyMedia) return { component: authored, values };
  const component = cloneData(authored);
  if (legacyMedia) component.assetId = uiBoundAssetId(project, authored, parameterValue(legacyMedia, current));
  if (explicitMedia) delete component.assetParameterId;
  if (['minimum', 'maximum', 'step'].some(property => Object.hasOwn(values, property))) {
    const range = uiControlDefinition(project, authored)?.range;
    if (range) component.controlRange = { ...range };
  }
  for (const [property, value] of Object.entries(values)) applyUiPropertySnapshot(component, property as UiProperty, value!);
  if (current !== undefined) for (const property of ['hoverTextColor', 'selectedTextColor', 'disabledTextColor', 'hoverBackground', 'pressedBackground', 'selectedBackground', 'disabledBackground'] as const) {
    if (Object.hasOwn(values, property)) continue;
    const source = uiPropertyFallbacks(authored, property).find(candidate => Object.hasOwn(values, candidate));
    if (source) applyUiPropertySnapshot(component, property, values[source]!);
  }
  if (typeof values.enabled === 'boolean') component.disabled = !values.enabled;
  const definition = uiControlDefinition(project, component);
  if (definition) {
    const primary = uiControlPrimaryProperty(definition), value = values[primary];
    if (value !== undefined) values[primary] = uiControlEffectiveValue(definition, value);
    if ((current === undefined || Object.hasOwn(values, primary)) && uiPropertyControlFor(project, authored, primary)?.control.mode === 'follow') component.readOnly = true;
  }
  return { component, values };
}
