import type { Project, UiComponent, VariableValue } from './model';
import { matches } from './preview-route';
import { uiTooltip } from './ui';
import { uiActionAvailable } from './ui-availability';
import { uiControlDefinition, uiControlEffectiveValue, uiControlPrimaryProperty, uiControlValueProblem } from './ui-control-properties';
import { resolveUiHierarchy } from './ui-hierarchy';
import { uiPageTheme } from './ui-page-settings';
import type { UiPropertyControlSnapshot } from './ui-property-control-snapshot';
import { uiProperties, uiPropertyValueProblem } from './ui-properties';

/** Resolve the dialogue's already-sampled components as one hierarchy. This
 * samples state and inherited geometry without executing a second UI graph. */
export function resolveDialogueUi(project: Project, snapshots: readonly UiPropertyControlSnapshot[], variables: Record<string, VariableValue>, hoveredButton?: string) {
  const byId = new Map(snapshots.map(snapshot => [snapshot.component.id, snapshot]));
  const theme = uiPageTheme(project, 'ui:say');
  const condition = (value: UiComponent['visibleWhen'], fallback: boolean) => value ? matches(value, variables) : fallback;
  const rows = resolveUiHierarchy(snapshots.map(snapshot => snapshot.component), {
    viewport: project,
    playerOpacity: Number(project.playerDefaults?.dialogueOpacity ?? 1),
    visible: component => {
      const value = byId.get(component.id)!.values.visible;
      return typeof value === 'boolean' ? value : condition(component.visibleWhen, true);
    },
    state: component => {
      const values = byId.get(component.id)!.values;
      const enabled = typeof values.enabled === 'boolean' ? values.enabled : !component.disabled && condition(component.enabledWhen, true);
      if (!enabled || component.readOnly || component.action && !uiActionAvailable(theme, component.action)) return 'disabled';
      const selected = typeof values.selected === 'boolean' ? values.selected : condition(component.selectedWhen, false);
      return selected ? 'selected' : hoveredButton === component.id ? 'hover' : 'idle';
    },
  });
  const hovered = hoveredButton && rows.find(row => row.component.id === hoveredButton && row.visible && row.state !== 'disabled' && !row.geometry?.clippedOut);
  const controlValues = new Map<string, VariableValue>();
  for (const { component, values } of snapshots) {
    const definition = uiControlDefinition(project, component);
    if (!definition) continue;
    const primary = uiControlPrimaryProperty(definition);
    // `uiPropertyControlSnapshot` omits a current value when it fails the
    // semantic contract (choice membership or the current text limit). Do not
    // read that same invalid value back through the control's base parameter.
    // Range is display-only here, so validate the source without its range and
    // let `uiControlEffectiveValue` clamp it for presentation.
    const maxLength = typeof values.maxLength === 'number' ? values.maxLength : component.input?.maxLength ?? 200;
    const withoutRange = { ...definition, range: undefined };
    const fallback = uiPropertyValueProblem(project, primary, definition.initial) || uiControlValueProblem(withoutRange, definition.initial, maxLength)
      ? uiProperties[primary].initial : definition.initial;
    const source = values[primary] ?? (definition.parameterId && Object.hasOwn(variables, definition.parameterId) ? variables[definition.parameterId] : undefined);
    const validSource = source !== undefined && !uiPropertyValueProblem(project, primary, source) && !uiControlValueProblem(withoutRange, source, maxLength);
    const current = validSource ? source : fallback;
    controlValues.set(component.id, uiControlEffectiveValue(definition, current));
  }
  return { rows, tooltip: hovered ? uiTooltip(hovered.component) : '', controlValues };
}
