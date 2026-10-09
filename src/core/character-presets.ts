import { effectiveCharacter, type CharacterDisplayPreset, type Project, type StageAction } from './model';
import { portraitPlacement } from './portrait';

export const defaultDisplayPreset = 'default';
export function defaultShowCharacter(overrides: Partial<Extract<StageAction, { kind: 'show' }>> = {}): Extract<StageAction, { kind: 'show' }> {
  return { kind: 'show', characterId: '', expressionId: '', presetId: 'default', lifetime: 'line', x: .5, y: 1, scale: 1, layer: 10, transition: 'dissolve', ...overrides };
}
export const builtinDisplayPresets: readonly CharacterDisplayPreset[] = [
  { id: 'left', name: '左', x: .25, y: 1, scale: 1, useDefaultFraming: true },
  { id: 'center', name: '中', x: .5, y: 1, scale: 1, useDefaultFraming: true },
  { id: 'right', name: '右', x: .75, y: 1, scale: 1, useDefaultFraming: true },
];

/** Built-in slots also exist in older projects; authored overrides and inheritance stay live. */
export function characterDisplayPresets(project: Project, characterId: string): CharacterDisplayPreset[] {
  const character = effectiveCharacter(project, characterId);
  return [...new Map([...builtinDisplayPresets, ...(character?.displayPresets ?? [])].map(preset => [preset.id, preset])).values()];
}

export function characterDisplayPreset(project: Project, characterId: string, reference = defaultDisplayPreset) {
  const id = reference === defaultDisplayPreset || reference === '角色默认' || reference === '默认'
    ? effectiveCharacter(project, characterId)?.defaultDisplayPresetId ?? 'center' : reference;
  return characterDisplayPresets(project, characterId).find(preset => preset.id === id || preset.name === id);
}

export function displayPresetPlacement(project: Project, characterId: string, expressionId: string, reference = defaultDisplayPreset) {
  const preset = characterDisplayPreset(project, characterId, reference);
  if (!preset) throw new Error(`角色站位预设不存在：${reference}`);
  return preset.useDefaultFraming ? portraitPlacement(project, characterId, expressionId, preset.x, preset.y, preset.scale)
    : { x: preset.x, y: preset.y, scale: preset.scale };
}

/** Missing presetId means legacy/manual geometry, never an implicit new default. */
export function resolveShowAction(project: Project, action: Extract<StageAction, { kind: 'show' }>) {
  return action.presetId && characterDisplayPreset(project, action.characterId, action.presetId)
    ? { ...action, ...displayPresetPlacement(project, action.characterId, action.expressionId, action.presetId) } : action;
}

/** Empty character and expression remain dynamic in saved authoring data. */
export function resolveShowTarget(project: Project, action: Extract<StageAction, { kind: 'show' }>, speakerId?: string) {
  const character = effectiveCharacter(project, action.characterId || speakerId || '');
  if (!character?.expressions.length) return undefined;
  const expression = action.expressionId
    ? character.expressions.find(item => item.id === action.expressionId || item.name === action.expressionId)
    : character.expressions.find(item => item.id === character.defaultExpressionId) ?? character.expressions[0];
  return expression ? { ...action, ...(!action.characterId ? { lifetime: action.lifetime ?? 'line' as const } : {}), characterId: character.id, expressionId: expression.id } : undefined;
}

export function detachDisplayPreset(project: Project, action: Extract<StageAction, { kind: 'show' }>) {
  const { presetId: _preset, ...manual } = resolveShowAction(project, action);
  return manual;
}

export function displayPresetLabel(project: Project, characterId: string, reference?: string) {
  if (!reference) return '手动位置';
  const name = characterDisplayPreset(project, characterId, reference)?.name ?? '缺失预设';
  return reference === defaultDisplayPreset ? `角色默认（${name}）` : name;
}
