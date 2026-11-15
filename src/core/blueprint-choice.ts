import type { BlueprintNode, BlueprintPin, VariableValue } from './model';

export const blueprintChoiceCatalog = {
  switchValue: { name: '多路分支（Switch）', category: '流程控制', hint: '按文字、数值或开关枚举选择一条执行路线；未匹配走“其他情况”。名称可改、可重排，已连线的稳定分支不会换位。' },
  selectByKey: { name: '多路选择（Select By Key）', category: '状态与计算', hint: '根据匹配值选择一个有类型的结果；只读取命中的值，未匹配才读取默认值。可用于难度、角色类型、页面结果等枚举，不必手写 JSON。' },
} as const;
export type BlueprintChoiceType = keyof typeof blueprintChoiceCatalog;
export const blueprintChoiceKeyTypes = { string: '文字', number: '数值', boolean: '开关' } as const;
export const blueprintChoiceValueTypes = { ...blueprintChoiceKeyTypes, asset: '素材', character: '角色', scene: '场景', ui: '页面', component: '控件' } as const;
export type BlueprintChoiceKeyType = keyof typeof blueprintChoiceKeyTypes;
export type BlueprintChoiceValueType = keyof typeof blueprintChoiceValueTypes;
export interface BlueprintChoiceCase { id: string; name: string; key: VariableValue }
export const maxBlueprintChoices = 16;
export const isBlueprintChoiceType = (type: string): type is BlueprintChoiceType => Object.hasOwn(blueprintChoiceCatalog, type);
export const blueprintChoicePinId = (id: string) => 'case_' + id;
export const blueprintChoiceDefault = (type: string): VariableValue => type === 'number' ? 0 : type === 'boolean' ? false : '';
export function blueprintChoiceDefaultCases(type: BlueprintChoiceKeyType = 'string'): BlueprintChoiceCase[] {
  return [{ id: 'a', name: '选项 A', key: type === 'number' ? 0 : type === 'boolean' ? false : 'A' }, { id: 'b', name: '选项 B', key: type === 'number' ? 1 : type === 'boolean' ? true : 'B' }];
}
export const validBlueprintChoiceValue = (type: string, value: unknown): value is VariableValue => type === 'number' ? typeof value === 'number' && Number.isFinite(value) : type === 'boolean' ? typeof value === 'boolean' : typeof value === 'string';

/** Versioned internal storage is edited through named rows, not a JSON text field.
 * Invalid/unknown data is diagnosed and retained, never replaced on import. */
export function blueprintChoiceDefinition(node: Pick<BlueprintNode, 'properties'>): { keyType?: BlueprintChoiceKeyType; valueType?: BlueprintChoiceValueType; cases?: BlueprintChoiceCase[]; problems: string[] } {
  const problems: string[] = [];
  const keyType = String(node.properties.keyType ?? 'string'), valueType = String(node.properties.valueType ?? 'number');
  if (!Object.hasOwn(blueprintChoiceKeyTypes, keyType)) problems.push('请选择有效的匹配值类型（文字、数值或开关）。');
  if (!Object.hasOwn(blueprintChoiceValueTypes, valueType)) problems.push('请选择有效的结果类型。');
  const definition = { keyType: Object.hasOwn(blueprintChoiceKeyTypes, keyType) ? keyType as BlueprintChoiceKeyType : undefined, valueType: Object.hasOwn(blueprintChoiceValueTypes, valueType) ? valueType as BlueprintChoiceValueType : undefined, problems };
  if (node.properties.choiceVersion !== undefined && node.properties.choiceVersion !== 1) { problems.push('此多路节点的数据版本尚不支持；已保留原始配置和连接点。'); return definition; }
  let raw: unknown;
  try { raw = JSON.parse(String(node.properties.cases)); } catch { problems.push('分支配置无法读取；请恢复该节点的分支定义，原值不会自动丢弃。'); return definition; }
  if (!Array.isArray(raw) || raw.length > maxBlueprintChoices || raw.some(item => !item || typeof item !== 'object' || typeof item.id !== 'string' || !/^[a-z][a-zA-Z0-9_]{0,47}$/.test(item.id) || typeof item.name !== 'string' || !['string', 'number', 'boolean'].includes(typeof item.key))) {
    problems.push('分支需要稳定标识、名称和匹配值，最多 ' + maxBlueprintChoices + ' 项；请恢复有效的分支定义。'); return definition;
  }
  const cases = raw as BlueprintChoiceCase[];
  if (new Set(cases.map(item => item.id)).size !== cases.length) { problems.push('分支标识重复，无法确认已有连线属于哪一项；请恢复有效的分支定义。'); return definition; }
  for (const item of cases) if (!item.name.trim() || item.name.length > 100) problems.push('分支名称需要 1～100 个字符；请填写名称，不会删除该分支。');
  for (const item of cases) if (!validBlueprintChoiceValue(keyType, item.key)) problems.push('“' + item.name + '”的匹配值类型不符；请重新输入，不会自动转换。');
  if (cases.some((item, index) => cases.slice(0, index).some(previous => previous.key === item.key))) problems.push('匹配值不能重复；每个输入只能命中一项。');
  return { ...definition, cases };
}
export function blueprintChoicePins(node: BlueprintNode): BlueprintPin[] | undefined {
  const definition = blueprintChoiceDefinition(node), { cases, keyType, valueType } = definition;
  if (!cases || !keyType || !valueType) return;
  const pin = (id: string, name: string, direction: BlueprintPin['direction'], dataType: BlueprintPin['dataType'], initial?: VariableValue): BlueprintPin => {
    const before = node.pins.find(pin => pin.id === id && pin.dataType === dataType && pin.direction === direction);
    const defaultValue = before?.defaultValue ?? initial;
    return { id, name, direction, dataType, required: false, ...(defaultValue === undefined ? {} : { defaultValue }) };
  };
  const key = pin('key', '匹配值', 'input', keyType, blueprintChoiceDefault(keyType));
  return node.type === 'switchValue'
    ? [pin('exec_in', '执行', 'input', 'exec'), key, ...cases.map(item => pin(blueprintChoicePinId(item.id), item.name.slice(0, 100) || '未命名分支', 'output', 'exec')), pin('default', '其他情况', 'output', 'exec')]
    : [key, ...cases.map(item => pin(blueprintChoicePinId(item.id), item.name.slice(0, 100) || '未命名分支', 'input', valueType, blueprintChoiceDefault(valueType))), pin('default', '默认值', 'input', valueType, blueprintChoiceDefault(valueType)), pin('result', '选中的值', 'output', valueType)];
}
export function selectBlueprintChoice(node: BlueprintNode, key: unknown): { ok: true; pinId: string; caseId?: string } | { ok: false; message: string } {
  const definition = blueprintChoiceDefinition(node);
  if (definition.problems.length) return { ok: false, message: definition.problems[0] };
  if (!validBlueprintChoiceValue(definition.keyType!, key)) return { ok: false, message: '匹配值需要' + blueprintChoiceKeyTypes[definition.keyType!] + '，不能使用其他类型代替。' };
  const found = definition.cases!.find(item => item.key === key);
  return { ok: true, pinId: found ? blueprintChoicePinId(found.id) : 'default', ...(found ? { caseId: found.id } : {}) };
}
/** A key is read once; unused choices (including default) are never evaluated. */
export function evaluateBlueprintChoice(node: BlueprintNode, read: (pin: string) => unknown): { ok: true; value: VariableValue; pinId: string } | { ok: false; message: string } {
  const selected = selectBlueprintChoice(node, read('key')); if (!selected.ok) return selected;
  const value = read(selected.pinId), type = blueprintChoiceDefinition(node).valueType!;
  return validBlueprintChoiceValue(type, value) ? { ok: true, value, pinId: selected.pinId } : { ok: false, message: '选中结果需要有效的' + blueprintChoiceValueTypes[type] + '，不能自动转换其他类型。' };
}
