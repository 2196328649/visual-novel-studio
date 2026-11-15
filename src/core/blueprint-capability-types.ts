import { isBlueprintFlowControl } from './blueprint-flow-control';
import type { BlueprintNode } from './model';

export const blueprintCapabilityNames = { page: '页面事件', stage: '剧情舞台', dialogue: '当前台词', minigame: '小游戏会话' } as const;
export type BlueprintCapability = keyof typeof blueprintCapabilityNames;
export type BlueprintEnvironment = 'ui' | 'story' | 'startup' | 'minigame';
export const blueprintEnvironments: Record<BlueprintEnvironment, readonly BlueprintCapability[]> = {
  ui: ['page', 'stage'], story: ['stage', 'dialogue', 'page'], startup: ['stage', 'page'], minigame: ['page', 'stage', 'minigame'],
};

/** Requirements describe execution, independently of palette categories and display names. */
export function blueprintNodeCapabilities(node: Pick<BlueprintNode, 'type'> & Partial<Pick<BlueprintNode, 'properties'>>): BlueprintCapability[] {
  if (['getMinigameValue', 'setMinigameValue', 'finishMinigame'].includes(node.type)) return ['minigame'];
  if ((['getVariable', 'setVariable', 'throttle', 'startTask', 'debounce'].includes(node.type) || isBlueprintFlowControl(node.type)) && node.properties?.scope === 'page') return ['page'];
  if (node.type === 'startDialogue') return ['dialogue'];
  if (node.type === 'showCharacter' && !node.properties?.characterId) return ['stage', 'dialogue'];
  if (['switchScene', 'showBackground', 'showCharacter', 'hideCharacter', 'showChapter', 'camera', 'shake', 'savedAction', 'sceneAction', 'effect'].includes(node.type)) return ['stage'];
  if (['eventClick', 'eventButton', 'eventValueChanged', 'eventTextCommitted', 'eventImage', 'eventVideo', 'eventSpine', 'eventTimer', 'eventKey', 'eventPage', 'getPageInput', 'getPageOutput', 'setPageOutput', 'preventPageClose'].includes(node.type)) return ['page'];
  return [];
}
