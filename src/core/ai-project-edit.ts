import { z } from 'zod';
import { projectSchema, type Project } from './model';
import { projectToText } from './text-script';

export const editableProjectFields = ['name', 'version', 'width', 'height', 'playerDefaults', 'parameterSets', 'exportSettings', 'assets', 'characters', 'variables', 'effects', 'blueprints', 'timelinePresets', 'minigames', 'contentBrowser', 'chapters', 'scenes', 'nodes', 'entryId', 'ui'] as const;
const pathSegmentSchema = z.union([z.string().min(1).max(200), z.number().int().nonnegative(), z.object({ id: z.string().min(1).max(200) }).strict()]);
export const aiProjectEditSchema = z.object({
  kind: z.literal('editProject'),
  path: z.array(pathSegmentSchema).min(1).max(24),
  action: z.enum(['set', 'remove', 'append']),
  value: z.json().optional(),
}).strict().refine(op => editableProjectFields.includes(op.path[0] as typeof editableProjectFields[number]), '此工程字段不可由 AI 修改。')
  .refine(op => op.action === 'remove' || op.value !== undefined, '修改缺少内容。');
export type AiProjectEdit = z.infer<typeof aiProjectEditSchema>;

const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
function assertKeys(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) throw new Error('工程修改包含不允许的属性。');
    assertKeys(child);
  }
}
function keyFor(parent: any, segment: z.infer<typeof pathSegmentSchema>): string | number {
  if (typeof segment === 'object') {
    if (!Array.isArray(parent)) throw new Error('ID 定位只能用于列表。');
    const matches = parent.flatMap((item, index) => item?.id === segment.id ? [index] : []);
    if (matches.length !== 1) throw new Error(`找不到唯一对象：${segment.id}`);
    return matches[0];
  }
  if (typeof segment === 'string' && forbidden.has(segment)) throw new Error('工程修改路径无效。');
  if (Array.isArray(parent) && (typeof segment !== 'number' || segment >= parent.length)) throw new Error('列表位置不存在；增加条目请使用 append。');
  if (!Array.isArray(parent) && typeof segment !== 'string') throw new Error('对象属性必须使用名称。');
  return segment;
}
export function applyProjectEdit(project: Project, operation: AiProjectEdit) {
  assertKeys(operation.value);
  let parent: any = project;
  for (const segment of operation.path.slice(0, -1)) {
    if (!parent || typeof parent !== 'object') throw new Error('工程修改路径不存在。');
    const key = keyFor(parent, segment);
    if (!Object.hasOwn(parent, key)) throw new Error('工程修改路径不存在。');
    parent = parent[key];
  }
  if (!parent || typeof parent !== 'object') throw new Error('工程修改路径不存在。');
  const key = keyFor(parent, operation.path.at(-1)!);
  const before = structuredClone(parent[key]);
  if (operation.action === 'append') {
    if (!Array.isArray(parent[key])) throw new Error('append 只能向已有列表增加条目。');
    parent[key].push(structuredClone(operation.value));
  } else if (operation.action === 'remove') {
    if (!Object.hasOwn(parent, key)) throw new Error('要删除的内容不存在。');
    if (Array.isArray(parent)) parent.splice(Number(key), 1); else delete parent[key];
  } else parent[key] = structuredClone(operation.value);
  return { label: '工程 · ' + operation.path.map(part => typeof part === 'object' ? part.id : part).join(' / '), before: JSON.stringify(before, null, 2) ?? '未设置', after: operation.action === 'remove' ? '已移除' : JSON.stringify(parent[key], null, 2) ?? '未设置' };
}

/** Validate the whole batch, not transient intermediate states of connected edits. */
export function finalizeProjectEdits(project: Project) {
  const parsed = projectSchema.parse(project);
  const check = (raw: any, valid: any) => {
    if (!raw || typeof raw !== 'object') return;
    for (const [key, value] of Object.entries(raw)) {
      if (value !== undefined && (!valid || !Object.hasOwn(valid, key))) throw new Error(`不支持的工程属性：${key}`);
      check(value, valid?.[key]);
    }
  };
  check(project, parsed);
  if (parsed.scriptText) parsed.scriptText = { ...parsed.scriptText, content: projectToText(parsed) };
  return parsed;
}
