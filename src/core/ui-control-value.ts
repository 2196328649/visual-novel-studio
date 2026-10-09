import type { BlueprintNodeType } from './blueprint';
import type { Project, UiComponent, VariableValue } from './model';
import { playerPreferences } from './preferences';

type ValueNode = { type: BlueprintNodeType; properties: Record<string, VariableValue> };
type ControlValue = { label: string; read: ValueNode; write: ValueNode; error?: never } | { error: string; label?: never; read?: never; write?: never };

/** A control edits its binding. Keep the target identity when creating ordinary graph nodes. */
export function uiControlValue(project: Project, component?: UiComponent): ControlValue | undefined {
 if (!component || !['preference', 'preferenceChoice'].includes(component.kind)) return;
 if (component.parameterId) {
  const variable = project.variables.find(v => v.id === component.parameterId);
  if (!variable) return { error: '绑定的变量已不存在，请在设计中重新选择。' };
  return {
   label: variable.name + '（变量）',
   read: { type: 'getVariable', properties: { variableId: variable.id } },
   write: { type: 'setVariable', properties: { variableId: variable.id, value: variable.initial } },
  };
 }
 const preference = component.preference, info = preference && playerPreferences[preference];
 if (!preference || !info) return { error: '尚未绑定值，请在设计中选择变量或玩家设置。' };
 const properties: Record<string, VariableValue> = { preference };
 let name = info.name;
 if (preference === 'characterVolume') {
  const character = project.characters.find(c => c.id === component.preferenceCharacterId);
  if (component.preferenceCharacterId && !character) return { error: '绑定的角色已不存在，请在设计中重新选择。' };
  properties.characterId = component.preferenceCharacterId ?? '';
  name = character ? character.name + ' · 角色音量' : '默认角色音量';
 }
 return {
  label: name + '（玩家设置）',
  read: { type: 'getPlayerPreference', properties },
  write: { type: 'setPlayerPreference', properties: { ...properties, value: project.playerDefaults?.[preference] ?? info.initial } },
 };
}
