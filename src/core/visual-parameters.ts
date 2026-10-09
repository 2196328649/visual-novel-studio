import { makeId, type VariableValue, type VisualObject } from './model';
import { visualInstancePath } from './visual-selection';

export type VisualPath = (string | number)[];
export interface VisualValueEntry { path: VisualPath; value: VariableValue }

export function visualAtPath(root: VisualObject, path: number[]) {
  return path.reduce((object, index) => object.children![index], root);
}

export function visualValue(root: VisualObject, path: VisualPath): unknown {
  let value: unknown = root;
  for (const key of path) value = (value as Record<string | number, unknown> | undefined)?.[key];
  return value;
}

/** Resolve a public asset slot through nested interfaces to its actual media type. */
export function visualAssetKind(root: VisualObject, path: VisualPath, seen = new Set<string>()): 'image' | 'video' | 'font' | undefined {
  let object = root, offset = 0;
  while (path[offset] === 'children') {
    const child = object.children?.[Number(path[offset + 1])];
    if (!child) return;
    object = child; offset += 2;
  }
  const tail = path.slice(offset);
  if (tail[0] === 'parameterValues') {
    const key = object.instanceId + '/' + tail[1];
    if (seen.has(key)) return;
    const next = new Set(seen).add(key), parameter = object.parameters?.find(item => item.id === tail[1]);
    const kinds = parameter?.targets.map(target => {
      const relative = visualInstancePath(object, target.instanceId);
      return relative && visualAssetKind(object, [...relative.flatMap(index => ['children', index]), ...target.path], next);
    }) ?? [];
    return kinds.length && kinds.every(kind => kind === kinds[0]) ? kinds[0] : undefined;
  }
  if (tail.at(-1) === 'fontAssetId') return 'font';
  if (tail.at(-1) === 'maskAssetId' || tail[0] === 'glyphParticles') return 'image';
  if (tail.at(-1) === 'assetId') return object.content === 'video' ? 'video' : 'image';
}

/** Forward values across each boundary before applying duration retiming. */
export function visualParameterEntries(root: VisualObject, entries: VisualValueEntry[]): VisualValueEntry[] {
  const values = new Map(entries.map(entry => [JSON.stringify(entry.path), entry]));
  const visit = (object: VisualObject, prefix: VisualPath) => {
    for (const parameter of object.parameters ?? []) {
      const path = [...prefix, 'parameterValues', parameter.id];
      const value = values.get(JSON.stringify(path))?.value ?? object.parameterValues?.[parameter.id] ?? parameter.defaultValue;
      values.set(JSON.stringify(path), { path, value });
      for (const target of parameter.targets) {
        const relative = visualInstancePath(object, target.instanceId);
        if (!relative) continue;
        const path = [...prefix, ...relative.flatMap(index => ['children', index]), ...target.path];
        values.set(JSON.stringify(path), { path, value });
      }
    }
    object.children?.forEach((child, index) => visit(child, [...prefix, 'children', index]));
  };
  visit(root, []);
  return [...values.values()].sort((a, b) => b.path.length - a.path.length);
}

export function addVisualParameter(group: VisualObject, targetId: string, path: VisualPath, dataType: 'number' | 'string' | 'boolean' | 'asset', value: VariableValue, name: string, existingId?: string) {
  if (group.content !== 'group') throw new Error('只有组合可以公开参数。');
  if (!visualInstancePath(group, targetId)) throw new Error('参数目标不在此组合中。');
  if (targetId === group.instanceId && path[0] === 'parameterValues') throw new Error('参数不能连接自身。');
  const existing = group.parameters?.find(item => item.id === existingId);
  if (existingId && (!existing || existing.dataType !== dataType)) throw new Error('请选择同类型的组合参数。');
  const target = { instanceId: targetId, path };
  if (existing) {
    if (!existing.targets.some(item => item.instanceId === targetId && JSON.stringify(item.path) === JSON.stringify(path))) existing.targets.push(target);
    return existing.id;
  }
  if ((group.parameters?.length ?? 0) >= 128) throw new Error('组合最多公开 128 个参数。');
  let clean = name.trim().replace(/[\n，,=：:【】]/g, ' ').slice(0, 110) || '参数', index = 2;
  const base = clean;
  while (group.parameters?.some(item => item.name === clean)) clean = base + ' ' + index++;
  const parameter = { id: makeId('parameter'), name: clean, dataType, defaultValue: value, targets: [target] };
  group.parameters = [...(group.parameters ?? []), parameter];
  return parameter.id;
}

/** Identity-based field matching survives regrouping and sibling reordering. */
export function visualFieldIdentity(root: VisualObject, path: VisualPath) {
  let object = root, offset = 0;
  while (path[offset] === 'children') { object = object.children![Number(path[offset + 1])]; offset += 2; }
  return object.instanceId + '/' + JSON.stringify(path.slice(offset));
}
