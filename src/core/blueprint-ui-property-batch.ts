import { makeId, type BlueprintNode, type BlueprintPin, type VariableValue } from './model';
import { uiProperties, uiPropertyPinType, type UiProperty } from './ui-properties';

export interface BlueprintUiPropertyRow { id: string; property: string; writeMode: string }
export interface BlueprintUiPropertyAssignment { property: string; value: VariableValue; writeMode: string }
export const blueprintUiPropertyBatchVersion = 1;
export const maxBlueprintUiPropertyRows = 64;
const rowIdPattern = /^value(?:_[a-z][a-zA-Z0-9_]{0,47})?$/;

/** Reading never migrates saved nodes. Structural errors keep the original pins
 * and values; semantic errors keep complete rows available for explicit repair. */
export function blueprintUiPropertyDefinition(node: Pick<BlueprintNode, 'properties'>): { rows?: BlueprintUiPropertyRow[]; problems: string[]; legacy: boolean } {
  const problems: string[] = [];
  const legacy = node.properties.propertyBatchVersion === undefined && node.properties.propertyWrites === undefined;
  let raw: unknown;
  if (legacy) raw = [{ id: 'value', property: node.properties.property ?? 'visible', writeMode: node.properties.writeMode ?? 'override' }];
  else {
    if (node.properties.propertyBatchVersion !== blueprintUiPropertyBatchVersion) {
      problems.push('此组件属性节点的数据版本尚不支持；已保留原始配置和连接点。');
      return { problems, legacy };
    }
    try { raw = JSON.parse(String(node.properties.propertyWrites)); }
    catch {
      problems.push('组件属性列表无法读取；请恢复有效的属性定义，原始配置和连接点已保留。');
      return { problems, legacy };
    }
  }
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > maxBlueprintUiPropertyRows
    || raw.some(row => !row || typeof row !== 'object' || Array.isArray(row)
      || typeof row.id !== 'string' || !rowIdPattern.test(row.id)
      || typeof row.property !== 'string' || !row.property.length || typeof row.writeMode !== 'string')) {
    problems.push('组件属性列表需要稳定标识、属性和赋值方式，至少 1 项、最多 ' + maxBlueprintUiPropertyRows + ' 项；原始配置和连接点已保留。');
    return { problems, legacy };
  }
  const rows = (raw as BlueprintUiPropertyRow[]).map(({ id, property, writeMode }) => ({ id, property, writeMode }));
  if (new Set(rows.map(row => row.id)).size !== rows.length) {
    problems.push('组件属性项的标识重复，无法确认已有连线属于哪一项；原始配置和连接点已保留。');
    return { problems, legacy };
  }
  if (new Set(rows.map(row => row.property)).size !== rows.length) {
    problems.push('组件属性不能重复；请为每项选择不同属性，原始配置和连接点已保留。');
  }
  for (const row of rows) {
    if (!Object.hasOwn(uiProperties, row.property)) problems.push('组件属性“' + row.property + '”不存在；请重新选择，原值和连接点已保留。');
    if (row.writeMode !== 'override' && row.writeMode !== 'source') problems.push('组件属性“' + (Object.hasOwn(uiProperties, row.property) ? uiProperties[row.property as UiProperty].name : row.property) + '”的赋值方式无效；请选择临时覆盖或修改绑定源。');
  }
  return { rows, problems, legacy };
}

/** Execution and compilation must reject the entire invalid definition. */
export function blueprintUiPropertyRows(node: BlueprintNode): readonly BlueprintUiPropertyRow[] {
  if (node.type !== 'setUiProperty') return [];
  const definition = blueprintUiPropertyDefinition(node);
  return definition.problems.length ? [] : definition.rows ?? [];
}

/** Metadata and authoring may inspect a retained row even when its property or
 * write mode needs repair; structurally ambiguous definitions have no row. */
export function blueprintUiPropertyRowForPin(node: BlueprintNode, pinId: string): BlueprintUiPropertyRow | undefined {
  return node.type === 'setUiProperty' ? blueprintUiPropertyDefinition(node).rows?.find(row => row.id === pinId) : undefined;
}

export function blueprintUiPropertyRowId(node: BlueprintNode): string {
  const occupied = new Set([...Object.keys(node.properties), ...node.pins.map(pin => pin.id), ...(blueprintUiPropertyDefinition(node).rows ?? []).map(row => row.id)]);
  let id: string;
  do { id = 'value_' + makeId('r'); } while (occupied.has(id));
  return id;
}

/** Only an explicit authoring edit upgrades legacy storage. Retained row IDs
 * keep their saved values; only removed rows lose values. Signature sync owns links. */
export function setBlueprintUiPropertyRows(node: BlueprintNode, rows: readonly BlueprintUiPropertyRow[]): void {
  if (node.type !== 'setUiProperty') throw new Error('此节点不支持组件属性列表。');
  const previous = blueprintUiPropertyDefinition(node);
  if (!previous.rows) throw new Error(previous.problems[0] ?? '组件属性列表无法读取。');
  const propertyWrites = JSON.stringify(rows.map(({ id, property, writeMode }) => ({ id, property, writeMode })));
  const next = blueprintUiPropertyDefinition({ properties: { propertyBatchVersion: blueprintUiPropertyBatchVersion, propertyWrites } });
  if (!next.rows) throw new Error(next.problems[0]);
  const retained = new Set(rows.map(row => row.id));
  if (previous.legacy && retained.has('value') && node.properties.value === undefined) {
    const saved = node.pins.find(pin => pin.id === 'value' && pin.direction === 'input')?.defaultValue;
    if (saved !== undefined) node.properties.value = saved;
  }
  const removed = new Set(previous.rows.filter(row => !retained.has(row.id)).map(row => row.id));
  for (const id of removed) delete node.properties[id];
  // An explicit removal is unambiguous even when other retained rows still
  // share a property. Their diagnostic must not strand this row's input/links.
  if (removed.size) node.pins = node.pins.filter(pin => !removed.has(pin.id));
  node.properties.propertyBatchVersion = blueprintUiPropertyBatchVersion;
  node.properties.propertyWrites = propertyWrites;
  delete node.properties.property;
  delete node.properties.writeMode;
}

export function blueprintUiPropertyPins(node: BlueprintNode): BlueprintPin[] | undefined {
  if (node.type !== 'setUiProperty') return;
  const { rows, legacy } = blueprintUiPropertyDefinition(node);
  if (!rows || new Set(rows.map(row => row.property)).size !== rows.length) return;
  if (legacy) {
    const property = rows[0].property;
    if (!Object.hasOwn(uiProperties, property)) return node.pins;
    const info = uiProperties[property as UiProperty], dataType = uiPropertyPinType(property)!;
    // Generated legacy parameter-binding graphs use these exact pin captions
    // and defaults as their ownership signature. Preserve their entire shape.
    return node.pins.map(pin => pin.id !== 'value' || pin.dataType === dataType ? pin : { ...pin, dataType,
      ...(pin.defaultValue !== undefined && typeof pin.defaultValue !== info.type ? { defaultValue: info.initial } : {}) });
  }
  const fixed = (id: string, name: string, direction: BlueprintPin['direction'], dataType: BlueprintPin['dataType']): BlueprintPin => {
    const previous = node.pins.find(pin => pin.id === id && pin.direction === direction && pin.dataType === dataType);
    return previous ?? { id, name, direction, dataType, required: false };
  };
  const values = rows.map((row): BlueprintPin => {
    const previous = node.pins.find(pin => pin.id === row.id && pin.direction === 'input');
    if (!Object.hasOwn(uiProperties, row.property)) return previous ?? { id: row.id, name: ('未知属性（' + row.property + '）').slice(0, 120), direction: 'input', dataType: 'any', required: false,
      ...(node.properties[row.id] === undefined ? {} : { defaultValue: node.properties[row.id] }) };
    const info = uiProperties[row.property as UiProperty], dataType = uiPropertyPinType(row.property)!;
    const defaultValue = node.properties[row.id] ?? (previous?.dataType === dataType ? previous.defaultValue : undefined) ?? info.initial;
    return { ...(previous ?? {}), id: row.id, name: info.name, direction: 'input', dataType, required: previous?.required ?? false, defaultValue };
  });
  return [fixed('exec_in', '执行', 'input', 'exec'), fixed('componentId', '界面组件', 'input', 'component'), ...values, fixed('exec_out', '完成', 'output', 'exec')];
}
