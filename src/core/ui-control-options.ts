import type { BlueprintNode, BlueprintPin, VariableValue } from './model';
import type { UiControlDefinition } from './ui-control-properties';
import { validPlayerPreference } from './preferences';

export interface UiControlOption { label: string; value: VariableValue }
export const uiControlOptionsVersion = 1;
export const maxUiControlOptions = 256;
export const maxUiControlOptionLabel = 2000;
export const uiControlOptionTypes = { string: '文字', number: '数值', boolean: '开关' } as const;
export type UiControlOptionType = keyof typeof uiControlOptionTypes;
export const uiControlOptionOperations = { insert: '插入选项', replace: '修改选项', remove: '移除选项', move: '移动选项', clear: '清空选项', reset: '恢复设计选项' } as const;
export type UiControlOptionOperation = keyof typeof uiControlOptionOperations;
export interface UiControlOptionEdit { index?: unknown; toIndex?: unknown; label?: unknown; value?: unknown; valueType?: unknown }
export interface UiControlOptionResult { found: boolean; label: string; value: VariableValue }
export const uiControlOptionCatalog = {
  editUiControlOptions: { name: '编辑控件选项', category: '界面与动画', keywords: ['Options', 'Insert', 'Remove', 'Move', '选项列表', '添加选项', '删除选项', '重置选项'], hint: '用类型化字段插入、修改、移除、移动或清空本实例的选项；恢复设计选项不重置绑定值。列表变更不自动选择、不写来源、不发用户改值事件。' },
  getUiControlOption: { name: '读取控件选项', category: '界面与动画', keywords: ['Get Option', '选项标签', '选项值', '遍历选项'], hint: '按从 0 开始的索引读取当前有效列表，返回是否存在、标签和有类型的值。越界返回否和类型默认值；动态控件必须符合所选值类型。' },
} as const;
export const isUiControlOptionNode = (type: string): type is keyof typeof uiControlOptionCatalog => Object.hasOwn(uiControlOptionCatalog, type);
export const uiControlOptionDefault = (type: string): VariableValue => type === 'number' ? 0 : type === 'boolean' ? false : '';
export const uiControlOptionUsesValue = (node: Pick<BlueprintNode, 'type' | 'properties'>) => node.type === 'getUiControlOption' || ['insert', 'replace'].includes(String(node.properties.operation ?? 'insert'));
/** Early development nodes used exec; preserve that connected identity on load. */
export const uiControlOptionExecutionPin = (node: Pick<BlueprintNode, 'pins'>) => node.pins.some(pin => pin.id === 'exec' && pin.direction === 'output' && pin.dataType === 'exec') ? 'exec' : 'exec_out';
export const uiControlOptionsKnown = (node: Pick<BlueprintNode, 'properties'>) => (node.properties.optionsVersion ?? uiControlOptionsVersion) === uiControlOptionsVersion;
/** Read only active operands. Dormant values can contain stale or unsupported links. */
export function uiControlOptionEditInputs(node: Pick<BlueprintNode, 'properties'>): string[] {
  const operation = String(node.properties.operation ?? 'insert');
  return [...(['insert', 'replace', 'remove', 'move'].includes(operation) ? ['index'] : []), ...(operation === 'move' ? ['toIndex'] : []), ...(['insert', 'replace'].includes(operation) ? ['label', 'value'] : [])];
}

/** Match scalar settings in both hosts without treating false and zero as equal. */
export function uiControlOptionMatches(actual: VariableValue, expected: VariableValue): boolean {
  return typeof actual === typeof expected && (typeof actual === 'number' && typeof expected === 'number' ? Math.abs(actual - expected) < 0.0000001 : actual === expected);
}
/** DOM callbacks carry the exact list snapshot; a delayed old selection is ignored. */
export const uiControlOptionsKey = (options: readonly UiControlOption[]) => JSON.stringify(options.map(option => [option.label, option.value]));
export function uiControlOptionTypeProblem(info: UiControlDefinition | undefined, type: unknown): string | undefined {
  if (!info?.choice) return '选项操作只适用于选择控件，不能把自由输入框或滑条变成列表。';
  if (typeof type !== 'string' || !Object.hasOwn(uiControlOptionTypes, type)) return '请选择有效的选项值类型。';
  if (type !== info.type) return '选项值类型与目标控件的绑定类型不匹配。';
}
export function uiControlOptionValueProblem(info: UiControlDefinition, value: unknown): string | undefined {
  if (typeof value !== info.type || typeof value === 'number' && !Number.isFinite(value)) return '选项值必须符合绑定类型，数值必须有限。';
  if (info.preference && !validPlayerPreference(info.preference, value)) return '选项值超出玩家设置的引擎边界或可用值。';
}
function optionIndex(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(name + '必须是有限整数。');
  return value;
}
export function readUiControlOption(info: UiControlDefinition, index: unknown, type: unknown): UiControlOptionResult {
  const problem = uiControlOptionTypeProblem(info, type); if (problem) throw new Error(problem);
  const entry = info.options[optionIndex(index, '选项索引')];
  return entry ? { found: true, label: entry.label, value: entry.value } : { found: false, label: '', value: uiControlOptionDefault(String(type)) };
}
/** Undefined means remove the list override, not clear it. Validate before any mutation. */
export function editUiControlOptions(info: UiControlDefinition, operation: unknown, input: UiControlOptionEdit): UiControlOption[] | undefined {
  if (!info.choice) throw new Error('选项操作只适用于选择控件。');
  if (typeof operation !== 'string' || !Object.hasOwn(uiControlOptionOperations, operation)) throw new Error('请选择有效的选项操作。');
  if (operation === 'reset') return;
  if (operation === 'clear') return [];
  const index = optionIndex(input.index, '选项索引'), source = info.options;
  if (index < 0 || index > source.length || operation !== 'insert' && index === source.length) throw new Error('选项索引超出当前列表；插入可使用数量作为末尾索引。');
  if (operation === 'insert' && source.length >= maxUiControlOptions) throw new Error('每个控件最多 ' + maxUiControlOptions + ' 个运行时选项。');
  const next = source.map(option => ({ ...option }));
  if (operation === 'insert' || operation === 'replace') {
    const problem = uiControlOptionTypeProblem(info, input.valueType) ?? uiControlOptionValueProblem(info, input.value);
    if (problem) throw new Error(problem);
    if (typeof input.label !== 'string' || !input.label.length || Array.from(input.label).length > maxUiControlOptionLabel) throw new Error('选项标签需要 1～' + maxUiControlOptionLabel + ' 个 Unicode 字符。');
    const entry = { label: input.label, value: input.value as VariableValue };
    next.splice(index, operation === 'insert' ? 0 : 1, entry);
  } else if (operation === 'remove') next.splice(index, 1);
  else {
    const target = optionIndex(input.toIndex, '目标索引');
    if (target < 0 || target >= source.length) throw new Error('目标索引必须指向移动后的有效位置。');
    const [entry] = next.splice(index, 1); next.splice(target, 0, entry);
  }
  return next;
}
export function uiControlOptionPins(node: BlueprintNode): BlueprintPin[] | undefined {
  const operation = String(node.properties.operation ?? 'insert'), type = String(node.properties.valueType ?? 'string');
  if (!uiControlOptionsKnown(node) || !Object.hasOwn(uiControlOptionTypes, type) || node.type === 'editUiControlOptions' && !Object.hasOwn(uiControlOptionOperations, operation)) return;
  const pin = (id: string, name: string, direction: BlueprintPin['direction'], dataType: BlueprintPin['dataType'], initial?: VariableValue): BlueprintPin => {
    const before = node.pins.find(item => item.id === id && item.direction === direction && item.dataType === dataType);
    const defaultValue = before?.defaultValue ?? initial;
    return { id, name, direction, dataType, required: false, ...(defaultValue === undefined ? {} : { defaultValue }) };
  };
  const target = pin('componentId', '选择控件', 'input', 'component');
  const index = pin('index', '选项索引（从 0 开始）', 'input', 'number', 0);
  if (node.type === 'getUiControlOption') return [target, index, pin('found', '选项存在', 'output', 'boolean'), pin('label', '选项标签', 'output', 'string'), pin('value', '选项值', 'output', type as UiControlOptionType)];
  return [pin('exec_in', '执行', 'input', 'exec'), target,
    ...(['insert', 'replace', 'remove', 'move'].includes(operation) ? [index] : []),
    ...(operation === 'move' ? [pin('toIndex', '移动后目标索引', 'input', 'number', 0)] : []),
    ...(['insert', 'replace'].includes(operation) ? [pin('label', '选项标签', 'input', 'string', '选项'), pin('value', '选项值', 'input', type as UiControlOptionType, uiControlOptionDefault(type))] : []),
    pin(uiControlOptionExecutionPin(node), '执行', 'output', 'exec')];
}
