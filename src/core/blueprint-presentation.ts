import { isBlueprintNumericType } from './blueprint-numeric';
import type { BlueprintNode, BlueprintPin } from './model';
import { uiProperties, type UiProperty } from './ui-properties';
import { playerPreferences, type PlayerPreference } from './preferences';
import { blueprintUiPropertyRowForPin } from './blueprint-ui-property-batch';

export const blueprintMathOperations = { add: '相加 ＋', subtract: '相减 −', multiply: '相乘 ×', divide: '相除 ÷', modulo: '取余数', min: '取较小值', max: '取较大值' };
export function blueprintComparisonOperations(type: BlueprintPin['dataType']): Record<string, string> {
  return type === 'number' ? { eq: '等于', ne: '不等于', gt: '大于', gte: '大于或等于', lt: '小于', lte: '小于或等于' } : { eq: '等于', ne: '不等于' };
}
export type BlueprintNodeFamily = 'event' | 'value' | 'module' | 'action' | 'annotation';
export function blueprintNodePresentation(node: BlueprintNode): { family: BlueprintNodeFamily; compact: boolean } {
  const family: BlueprintNodeFamily = node.type === 'comment' ? 'annotation' : node.type.startsWith('event') ? 'event' : ['callFunction', 'callMacro', 'startTask', 'debounce', 'waitTask'].includes(node.type) ? 'module' : node.pins.every(pin => pin.dataType !== 'exec') ? 'value' : 'action';
  return { family, compact: family === 'value' && (isBlueprintNumericType(node.type) || ['not', 'and', 'or', 'xor', 'math', 'compare', 'select', 'selectByKey', 'literal'].includes(node.type)) };
}
/** Single-source reads render like UE "Get" nodes: one row with the source
 * name and its value pin. Their source is chosen in the details panel. */
export function blueprintGetterNode(node: BlueprintNode) {
  return ['getVariable', 'getInput', 'getPlayerPreference', 'getMinigameValue'].includes(node.type)
    && !node.pins.some(pin => pin.direction === 'input') && node.pins.filter(pin => pin.direction === 'output').length === 1;
}
export interface BlueprintNumericPresentation { unit?: string; min?: number; max?: number; step?: number | 'any' }
/** Editor hints do not change stored units or runtime coercion/validation. */
export function blueprintNumericPresentation(node: BlueprintNode, pinId: string): BlueprintNumericPresentation {
  if (['getUiControlOption', 'editUiControlOptions'].includes(node.type) && ['index', 'toIndex'].includes(pinId)) return { step: 1, unit: '从 0 开始' };
  if (node.type === 'nearlyEqual' && pinId === 'tolerance') return { min: 0, step: 'any' };
  if (node.type === 'lerp' && pinId === 'alpha') return { unit: '比例', step: .01 };
  if (node.type === 'setUiProperty' || pinId === 'value' && node.type === 'animateUiProperty') {
    const property = node.type === 'setUiProperty' ? blueprintUiPropertyRowForPin(node, pinId)?.property : String(node.properties.property);
    const info = property && Object.hasOwn(uiProperties, property) ? uiProperties[property as UiProperty] : undefined;
    return info?.type === 'number' ? { unit: info.unit, min: info.min, max: info.max, step: info.integer ? 1 : 'any' } : {};
  }
  if (pinId === 'value' && node.type === 'setPlayerPreference') {
    // Blueprints may set anything the engine accepts; the player's slider range does not apply.
    const info = playerPreferences[node.properties.preference as PlayerPreference];
    return info?.type === 'number' ? { min: info.limit?.min, max: info.limit?.max, step: info.step ?? 1, unit: info.display === 'percent' ? '0–1' : info.unit } : {};
  }
  if (node.type === 'forLoop' && ['first_index', 'last_index'].includes(pinId)) return { min: -100000, max: 100000, step: 1 };
  if (['throttle', 'startTask', 'debounce'].includes(node.type) && pinId === 'seconds') return { min: 0, step: .01, unit: '秒' };
  if (node.type === 'delay' && pinId === 'seconds') return { min: 0, step: .1, unit: '秒' };
  if (['playMusic', 'stopMusic'].includes(node.type) && pinId === 'fade') return { min: 0, step: .1, unit: '秒' };
  if (['camera', 'shake', 'showChapter', 'switchScene', 'showCharacter', 'hideCharacter', 'animateUiProperty'].includes(node.type) && pinId === 'duration') return { min: 0, step: .1, unit: '秒' };
  if (node.type === 'camera' && pinId === 'zoom') return { min: .01, unit: '倍' };
  if (node.type === 'camera' && pinId === 'rotation') return { unit: '°' };
  if (node.type === 'setSpineSpeed' && pinId === 'speed') return { min: uiProperties.spineSpeed.min, max: uiProperties.spineSpeed.max, step: .1, unit: uiProperties.spineSpeed.unit };
  if (node.type === 'playUiAnimation' && pinId === 'speed') return { unit: '倍' };
  if (node.type === 'playUiAnimation' && pinId === 'loops') return { unit: '次', step: 1 };
  if (node.type === 'shake' && pinId === 'amplitude') return { unit: '画面比例' };
  if (node.type === 'showCharacter' && pinId === 'scale') return { step: .05 };
  if (node.type === 'showCharacter' && pinId === 'layer') return { step: 1 };
  return {};
}
