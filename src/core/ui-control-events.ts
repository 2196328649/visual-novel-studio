import { declaredUiComponents, type Project, type UiComponent } from './model';
import { playerPreferences } from './preferences';

/** Values come from the bound setting; a control event is emitted only for user input. */
export function uiControlValueType(project: Project, component?: UiComponent) {
 if(!component||!['preference','preferenceChoice'].includes(component.kind))return;
 if(component.parameterId)return project.variables.find(v=>v.id===component.parameterId)?.type;
 return component.preference?playerPreferences[component.preference]?.type:undefined;
}
export function uiControlEventType(project: Project, componentId: unknown) {
 return uiControlValueType(project,declaredUiComponents(project).find(c=>c.id===componentId));
}

export const uiTextCommitMethods={enter:'按 Enter',focusLost:'离开输入框'} as const;
export type UiTextCommitMethod=keyof typeof uiTextCommitMethods;
export function uiTextInput(project:Project,component?:UiComponent){
 const variable=project.variables.find(v=>v.id===component?.parameterId);
 return !!component&&['preference','preferenceChoice'].includes(component.kind)&&variable?.type==='string'&&!variable.setting?.options?.length;
}
