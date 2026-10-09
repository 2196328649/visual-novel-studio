import { z } from 'zod';
import { currentScriptText } from './script-text';
import { effectiveCharacter, type Project, type StoryLine } from './model';
import { applyTextScript, projectToText } from './text-script';

export type TextExportMode = 'commands' | 'revision' | 'dialogue';
const lineMapEntry = z.object({ id: z.string(), speaker: z.string(), text: z.string() });
export const dialogueMapSchema = z.object({ format: z.literal('vns-dialogue-map-1'), projectId: z.string(), entries: z.array(lineMapEntry).max(100000) });
export type DialogueMap = z.infer<typeof dialogueMapSchema>;
export interface ImportedText { name: string; text: string; mapping?: DialogueMap }
export interface TextExport { text: string; mapping?: DialogueMap }
export interface DialogueRevision { id?: string; speaker?: string; text: string; row: number }
export interface TextRevisionPreview { project: Project; changes: { id: string; speaker: string; before: string; after: string }[]; method: 'ids' | 'mapping' | 'order'; ignoredCommands: number }

/** Use the same chapter/scene order as the text serializer, including branch passages. */
export function dialogueRows(project: Project) {
  return project.chapters.flatMap(chapter => project.scenes.filter(scene => scene.chapterId === chapter.id).flatMap(scene => project.nodes.filter(node => node.sceneId === scene.id).flatMap(node => node.kind === 'passage' ? node.lines.filter(line => !line.silent).map(line => ({ node, line })) : [])));
}

export function currentTextProject(project: Project): Project {
  if (!project.scriptText) return structuredClone(project);
  const parsed = applyTextScript(project, project.scriptText.content);
  const error = parsed.issues.find(issue => issue.severity === 'error');
  if (error) throw new Error(`请先修正当前剧本第 ${error.sourceLine} 行：${error.message}`);
  return parsed.project;
}

export function exportText(project: Project, mode: TextExportMode, includeSpeaker = true): TextExport {
  const current = currentTextProject(project);
  if (mode === 'commands') return { text: projectToText(current) };
  const entries = dialogueRows(current).map(({ line }) => ({ id: line.id, speaker: effectiveCharacter(current, line.speakerId ?? '')?.name ?? '旁白', text: line.text }));
  const text = entries.map(entry => {
    const parts = entry.text.split('\n');
    const first = (includeSpeaker ? entry.speaker + '：' : '') + parts[0];
    const rest = parts.slice(1).map(part => mode === 'revision' ? '@续行：' + part : '\t' + part);
    return [...(mode === 'revision' ? ['@对白标记：' + entry.id] : []), first, ...rest].join('\n');
  }).join('\n');
  return { text: text + '\n', mapping: { format: 'vns-dialogue-map-1', projectId: project.id, entries } };
}

export function readDialogueRevision(text: string, silentIds = new Set<string>()): { entries: DialogueRevision[]; ignoredCommands: number } {
  const entries: DialogueRevision[] = [];
  let pending: string | undefined, ignoredCommands = 0, definitionOpen = false;
  for (const [index, raw] of text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n').entries()) {
    const value = raw.trim();
    if (/^[@／/]?效果结束\s*$/.test(value)) { definitionOpen = false; ignoredCommands++; continue; }
    if (definitionOpen) { if (value) ignoredCommands++; continue; }
    if (/^[@／/]效果定义\s*[:：]/.test(value)) { definitionOpen = true; ignoredCommands++; continue; }
    const marker = value.match(/^@对白标记\s*[:：]\s*([a-z][a-z0-9_]{0,63})\s*$/);
    if (marker) {
      if (pending && pending !== marker[1] && !silentIds.has(pending)) throw new Error(`第 ${index + 1} 行的对白标记前缺少台词。`);
      pending = marker[1]; continue;
    }
    const continuation = raw.match(/^(?:@续行\s*[:：]|\t)(.*)$/);
    if (continuation) {
      if (!entries.length || pending) throw new Error(`第 ${index + 1} 行续行没有对应的台词。`);
      entries.at(-1)!.text += '\n' + continuation[1]; continue;
    }
    if (!value || /^\/\//.test(value)) continue;
    if (/^#|^[-—…\.·]{3,}$/.test(value)) { if (pending && silentIds.has(pending)) pending = undefined; continue; }
    if (/^[@／/](?:节点标记|开始|返回|选择|返回标题界面|章节标题|跳转|调用|设置|变量|实例|复用节点|节点实例|互动实例|小游戏实例)(?:\s*[:：]|\s*$)/.test(value) && pending && silentIds.has(pending)) pending = undefined;
    if (/^[@／/]/.test(value)) { ignoredCommands++; continue; }
    const dialogue = raw.match(/^([^:：]{1,80})\s*[:：]\s?(.*)$/);
    entries.push({ ...(pending ? { id: pending } : {}), ...(dialogue ? { speaker: dialogue[1].trim() } : {}), text: dialogue ? dialogue[2] : raw, row: index + 1 });
    pending = undefined;
  }
  if (pending && !silentIds.has(pending)) throw new Error('最后一个对白标记后缺少台词。');
  if (!entries.length) throw new Error('文件中没有可更新的台词。');
  return { entries, ignoredCommands };
}

/** Keep comments and every intervening command in their original source positions. */
function reviseSource(project: Project, changes: Map<string, StoryLine>) {
  const source = project.scriptText?.content ?? projectToText(project);
  const sourceRows = source.replace(/\r\n?/g, '\n').split('\n');
  const marked = new Set(sourceRows.flatMap(row => { const match = row.trim().match(/^@对白标记\s*[:：]\s*([a-z][a-z0-9_]{0,63})\s*$/); return match ? [match[1]] : []; }));
  const parsed = applyTextScript(project, source);
  const positions = new Map<string, number[]>();
  for (const location of parsed.sourceMap) if (!location.reference && location.actionCount === undefined && changes.has(location.lineId)) {
    positions.set(location.lineId, [...(positions.get(location.lineId) ?? []), location.sourceLine - 1]);
  }
  // Instance-only passages have no editable source lines; serialize their intact model.
  if ([...changes.keys()].some(id => !positions.has(id))) return undefined;
  const replacements = new Map<number, string>();
  for (const [id, line] of changes) {
    const rows = [...new Set(positions.get(id)!)].sort((a, b) => a - b);
    const speaker = effectiveCharacter(project, line.speakerId ?? '')?.name ?? '旁白';
    replacements.set(rows[0], [...(marked.has(id) ? [] : ['@对白标记：' + id]), ...line.text.split('\n').map((part, index) => (index ? '@续行：' : speaker + '：') + part)].join('\n'));
    for (const row of rows.slice(1)) replacements.set(row, '');
  }
  return sourceRows.map((line, row) => replacements.get(row) ?? line).join('\n');
}

export function previewDialogueRevision(project: Project, imported: ImportedText, allowOrder = false): TextRevisionPreview {
  const current = currentTextProject(project), rows = dialogueRows(current);
  const silentIds = new Set(current.nodes.flatMap(node => node.kind === 'passage' ? node.lines.filter(line => line.silent).map(line => line.id) : []));
  const { entries, ignoredCommands } = readDialogueRevision(imported.text, silentIds);
  const existing = new Map(rows.map(({ line }) => [line.id, line]));
  let method: TextRevisionPreview['method'];
  if (entries.every(entry => entry.id)) method = 'ids';
  else if (entries.some(entry => entry.id)) throw new Error('部分台词缺少行标识。请补齐标识，或改用完整剧本导入以新增台词。');
  else if (imported.mapping) {
    const mapping = dialogueMapSchema.parse(imported.mapping);
    if (mapping.projectId !== project.id) throw new Error('对白对应表属于另一个工程，请在原工程中更新。');
    if (mapping.entries.length !== entries.length) throw new Error('台词数量与导出时不同，不能按行自动回填。请使用带行标识的修订稿，或完整导入。');
    if (entries.some((entry, index) => entry.text !== mapping.entries[index].text && mapping.entries.some((original, other) => other !== index && original.text === entry.text && (!entry.speaker || original.speaker === entry.speaker)))) throw new Error('检测到原有台词的位置发生变化，不能按对应表回填。需要重排时请使用带行标识的修订稿。');
    entries.forEach((entry, index) => { entry.id = mapping.entries[index].id; });
    method = 'mapping';
  } else {
    if (!allowOrder) throw new Error('文件没有行标识或对应表。可明确选择「按当前对白顺序替换」，再核对下方逐句预览。');
    if (entries.length !== rows.length) throw new Error(`文件有 ${entries.length} 句，工程有 ${rows.length} 句。数量不同不能按顺序替换，请使用带行标识的修订稿。`);
    entries.forEach((entry, index) => { entry.id = rows[index].line.id; });
    method = 'order';
  }
  const seen = new Set<string>(), changes: TextRevisionPreview['changes'] = [], replacements = new Map<string, StoryLine>();
  const baseline = new Map(imported.mapping?.projectId === project.id ? imported.mapping.entries.map(entry => [entry.id, entry]) : []);
  for (const entry of entries) {
    const line = existing.get(entry.id!);
    if (!line) throw new Error(`第 ${entry.row} 行的台词标识在当前工程中不存在。`);
    if (seen.has(line.id)) throw new Error(`第 ${entry.row} 行重复使用了台词标识 ${line.id}。`);
    seen.add(line.id);
    const speaker = effectiveCharacter(current, line.speakerId ?? '')?.name ?? '旁白';
    if (entry.speaker && entry.speaker !== speaker) throw new Error(`第 ${entry.row} 行发言人「${entry.speaker}」与原台词「${speaker}」不符，请核对顺序。仅更新文本不会更换角色。`);
    const before = baseline.get(line.id);
    if (before && before.text !== line.text && entry.text !== line.text) throw new Error(`「${speaker}：${line.text.slice(0, 35)}」在导出后已被修改，请重新导出或核对后使用带标识的修订稿。`);
    if (entry.text === line.text) continue;
    changes.push({ id: line.id, speaker, before: line.text, after: entry.text });
    replacements.set(line.id, { ...line, text: entry.text });
  }
  const revisedSource = reviseSource(current, replacements);
  for (const { line } of rows) { const replacement = replacements.get(line.id); if (replacement) line.text = replacement.text; }
  current.scriptText = currentScriptText(revisedSource ?? projectToText(current), imported.name);
  return { project: current, changes, method, ignoredCommands };
}
