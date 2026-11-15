import type { Project, UiButtonState, UiComponent } from './model';
import { uiControlDefinition } from './ui-control-properties';
import { collectionSupports } from './ui-collection-layout';

/** Authoring surface support is shared by appearance fields and search. */
export function uiInspectorSkinApplies(project: Project, component: UiComponent): boolean {
  return component.kind === 'button' || component.binding === 'tooltip' || collectionSupports(component) || component.kind === 'pauseMenu'
    || component.kind === 'image' && !!component.parentId && !!component.inheritState
    || component.kind === 'preferenceChoice' && !component.parameterId && uiControlDefinition(project, component)?.choice === true;
}

export function uiInspectorAppearanceStates(project: Project, component: UiComponent): readonly UiButtonState[] {
  if (component.binding === 'tooltip' || component.kind === 'historyList') return ['idle'];
  if (component.kind === 'choiceList') return ['idle', 'hover', 'pressed'];
  if (component.kind === 'saveSlots' || component.kind === 'preferenceChoice' && uiInspectorSkinApplies(project, component)) return ['idle', 'hover', 'pressed', 'disabled'];
  if (uiInspectorSkinApplies(project, component) || component.parentId && component.inheritState && ['text', 'panel'].includes(component.kind)) return ['idle', 'hover', 'pressed', 'selected', 'disabled'];
  return ['idle'];
}
