/** Pure boolean nodes share strict values and left-to-right short-circuit rules. */
export const blueprintLogicCatalog = {
  not: { name: '取反（NOT）', category: '状态与计算', hint: '输入为是时输出否，输入为否时输出是。只计算结果，不修改原来的状态。' },
  and: { name: '全部满足（AND）', category: '状态与计算', hint: '两个条件都是是时输出是；第一个为否时不再读取第二个。' },
  or: { name: '任一满足（OR）', category: '状态与计算', hint: '任意一个条件为是就输出是；第一个为是时不再读取第二个。' },
  xor: { name: '条件不同（XOR）', category: '状态与计算', hint: '两个条件不同时输出是，相同时输出否。' },
} as const;

export type BlueprintLogicType = keyof typeof blueprintLogicCatalog;
export function isBlueprintLogicType(type: string): type is BlueprintLogicType {
  return Object.hasOwn(blueprintLogicCatalog, type);
}

export function evaluateBlueprintLogic(type: BlueprintLogicType, input: (pin: 'a' | 'b') => unknown): boolean | undefined {
  const a = input('a');
  if (typeof a !== 'boolean') return undefined;
  if (type === 'not') return !a;
  if (type === 'and' && !a) return false;
  if (type === 'or' && a) return true;
  const b = input('b');
  if (typeof b !== 'boolean') return undefined;
  return type === 'xor' ? a !== b : b;
}
