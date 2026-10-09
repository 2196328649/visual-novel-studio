import path from 'node:path';
import { z } from 'zod';
import { effectiveCharacter, makeId, type Project } from '../core/model';
import type { AiAttachment } from '../core/ai-attachments';
import type { AiWorkflowProposal } from '../core/ai-workflow';
import { importAssetPaths } from './asset-import';

export const portraitBindingSchema = z.object({
  characterId: z.string().min(1).max(200),
  sourcePath: z.string().min(1).max(4096),
  mode: z.enum(['replace', 'fillMissing']),
  expressionId: z.string().min(1).max(200).optional(),
}).strict();
type PortraitBinding = z.infer<typeof portraitBindingSchema>;
const normalized = (name: string) => name.normalize('NFKC').toLocaleLowerCase().replace(/[\s_\-()[\]{}（）【】「」]+/g, '');
const usual = (name: string) => /^(通常|默认|正常|普通|normal|default|neutral)$/i.test(normalized(name));
const pathKey = (file: string) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);

export const importedPortraitBindingSchema = z.object({
  characterId: z.string().min(1).max(200), mode: z.enum(['replace', 'fillMissing']),
  expressionId: z.string().min(1).max(200).optional(),
  images: z.array(z.object({ assetId: z.string().min(1).max(200), name: z.string().min(1).max(200) }).strict()).min(1).max(500),
  defaultAssetId: z.string().min(1).max(200).optional(),
}).strict();

/** Binding operates on actual imported IDs and is independent of file access/import. */
export function bindImportedPortraits(project: Project, raw: z.infer<typeof importedPortraitBindingSchema>) {
  const binding = importedPortraitBindingSchema.parse(raw), draft = structuredClone(project);
  const effective = effectiveCharacter(draft, binding.characterId);
  if (!effective) throw new Error(`找不到要更换立绘的角色：${binding.characterId}`);
  if (binding.mode === 'fillMissing' && effective.expressions.length) return { project: draft, warnings: [] as string[], fallbacks: [] as { id: string; name: string; assetId: string; fallbackName: string }[], fallbackWarning: undefined as string | undefined, changed: false, detail: `「${effective.name}」已有立绘，按“仅补齐缺失”要求保留。` };
  if (binding.expressionId && !effective.expressions.some(item => item.id === binding.expressionId)) throw new Error(`角色「${effective.name}」没有指定的表情。`);
  if (binding.expressionId && binding.images.length !== 1) throw new Error('只更换一个表情时，请指定一张图片。');
  const names = new Set<string>();
  for (const candidate of binding.images) {
    if (!draft.assets.some(asset => asset.id === candidate.assetId && asset.kind === 'image')) throw new Error(`立绘图片尚未导入：${candidate.assetId}`);
    if (names.has(normalized(candidate.name))) throw new Error(`「${effective.name}」有多个“${candidate.name}”图片，请明确指定表情名称。`);
    names.add(normalized(candidate.name));
  }
  if (binding.defaultAssetId && !binding.images.some(item => item.assetId === binding.defaultAssetId)) throw new Error('默认立绘必须属于本次绑定的图片。');
  const fallback = binding.images.find(item => item.assetId === binding.defaultAssetId) ?? binding.images.find(item => usual(item.name)) ?? binding.images[0];
  const matched = new Set<string>(), unmatched: string[] = [], warnings: string[] = [];
  const expressions = structuredClone(effective.expressions).map(expression => {
    if (binding.expressionId && expression.id !== binding.expressionId) return expression;
    const candidate = binding.images.length === 1 ? fallback : binding.images.find(item => normalized(item.name) === normalized(expression.name)) ?? (usual(expression.name) ? fallback : undefined);
    if (candidate) matched.add(normalized(candidate.name)); else unmatched.push(expression.name);
    return { ...expression, assetId: (candidate ?? fallback).assetId };
  });
  if (!binding.expressionId) for (const candidate of binding.images) {
    if (matched.has(normalized(candidate.name))) continue;
    expressions.push({ id: makeId('expression'), name: candidate.name, assetId: candidate.assetId });
  }
  const character = draft.characters.find(item => item.id === binding.characterId)!;
  character.expressions = expressions;
  character.defaultExpressionId = expressions.some(expression => expression.id === effective.defaultExpressionId) ? effective.defaultExpressionId : expressions.find(expression => expression.assetId === fallback.assetId)?.id ?? expressions[0]?.id;
  const fallbackWarning = unmatched.length ? `「${character.name}」的原表情 ${unmatched.join('、')} 在新目录中没有同名图片，暂用「${fallback.name}」，保留原表情编号；可在角色页重新选择图片。` : undefined;
  if (fallbackWarning) warnings.push(fallbackWarning);
  if (binding.images.length > 1 && !binding.defaultAssetId && !binding.images.some(item => usual(item.name))) warnings.push(`「${character.name}」没有通常或默认图片，暂以「${fallback.name}」作默认立绘，请在方案中检查。`);
  return { project: draft, warnings, fallbackWarning, fallbacks: expressions.filter(item => unmatched.includes(item.name)).map(item => ({ id: item.id, name: item.name, assetId: item.assetId, fallbackName: fallback.name })), changed: JSON.stringify(character) !== JSON.stringify(project.characters.find(item => item.id === binding.characterId)), detail: `「${character.name}」绑定 ${binding.images.length} 张图片，保留原表情编号和演出引用。` };
}

export function portraitImageName(characterName: string, file: string) {
  const stem = path.basename(file, path.extname(file));
  return stem.replace(new RegExp(characterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '').replace(/^[\s_\-()[\]{}（）【】「」]+|[\s_\-()[\]{}（）【】「」]+$/g, '') || '通常';
}

/** Resolve every target before importing; a model may only choose attached sources. */
export function resolvePortraitBindings(project: Project, bindings: PortraitBinding[], attachments: AiAttachment[] = []) {
  const used = new Set<string>();
  return bindings.map(binding => {
    const character = effectiveCharacter(project, binding.characterId);
    if (!character) throw new Error(`找不到要更换立绘的角色：${binding.characterId}`);
    if (used.has(binding.characterId)) throw new Error(`角色「${character.name}」被重复指定了立绘来源，请合并为一项。`);
    used.add(binding.characterId);
    const attachment = path.isAbsolute(binding.sourcePath) && attachments.find(item => pathKey(item.path) === pathKey(binding.sourcePath));
    if (!attachment) throw new Error('立绘来源必须是本次明确引用的图片或目录，不能使用未提供的路径。');
    if (attachment.kind !== 'directory' && !/\.(png|jpe?g|webp|avif)$/i.test(attachment.path)) throw new Error(`「${attachment.name}」不是支持的立绘图片，请使用 PNG、JPEG、WebP 或 AVIF。`);
    if (binding.expressionId && !character.expressions.some(expression => expression.id === binding.expressionId)) throw new Error(`角色「${character.name}」没有指定的表情。`);
    if (binding.expressionId && attachment.kind === 'directory') throw new Error('只更换一个表情时，请指定单张图片。');
    return { ...binding, sourcePath: attachment.path, directory: attachment.kind === 'directory' };
  });
}

export async function applyPortraitBindings(project: Project, bindings: ReturnType<typeof resolvePortraitBindings>, destination: string, proposal: AiWorkflowProposal, check: () => void) {
  let draft = project;
  for (const binding of bindings) {
    check();
    const effective = effectiveCharacter(draft, binding.characterId)!;
    if (binding.mode === 'fillMissing' && effective.expressions.length) {
      proposal.warnings.push(`「${effective.name}」已有立绘，按“仅补齐缺失”要求保留；如需更换，请明确要求替换。`);
      continue;
    }
    const imported = await importAssetPaths(destination, draft, [binding.sourcePath], { mode: binding.directory ? 'folder' : 'files', category: 'portrait', acceptFile: (_relative, kind) => kind === 'image', check });
    check();
    if (imported.report.errors.length) throw new Error(`「${effective.name}」的立绘未完整导入：${imported.report.errors.join('；')}`);
    const candidates = imported.entries.map(entry => {
      const stem = path.basename(entry.source, path.extname(entry.source));
      const name = stem.replace(new RegExp(effective.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '').replace(/^[\s_\-()[\]{}（）【】「」]+|[\s_\-()[\]{}（）【】「」]+$/g, '') || '通常';
      return { ...entry, name: binding.directory ? name : '通常' };
    });
    if (!candidates.length) throw new Error(`「${effective.name}」的所选来源没有可用图片。`);
    const names = new Set<string>();
    for (const candidate of candidates) {
      if (names.has(normalized(candidate.name))) throw new Error(`「${effective.name}」的目录有多个“${candidate.name}”图片，请引用具体角色子目录。`);
      names.add(normalized(candidate.name));
    }
    draft = imported.project;
    const character = draft.characters.find(character => character.id === binding.characterId)!;
    const beforeCharacter = JSON.stringify(character);
    const fallback = candidates.find(candidate => usual(candidate.name)) ?? candidates[0];
    const matched = new Set<string>(), unmatched: string[] = [];
    // Keep IDs used by dialogue and blueprint inputs; inherited expressions
    // become overrides on this character, leaving its base and siblings alone.
    const expressions = structuredClone(effective.expressions).map(expression => {
      if (binding.expressionId && expression.id !== binding.expressionId) return expression;
      const candidate = binding.directory ? candidates.find(candidate => normalized(candidate.name) === normalized(expression.name)) ?? (usual(expression.name) ? fallback : undefined) : fallback;
      if (candidate) matched.add(normalized(candidate.name));
      else unmatched.push(expression.name);
      return { ...expression, assetId: (candidate ?? fallback).assetId };
    });
    if (!binding.expressionId) for (const candidate of candidates) {
      if (matched.has(normalized(candidate.name))) continue;
      expressions.push({ id: makeId('expression'), name: candidate.name, assetId: candidate.assetId });
    }
    character.expressions = expressions;
    character.defaultExpressionId = expressions.some(expression => expression.id === effective.defaultExpressionId)
      ? effective.defaultExpressionId : expressions.find(expression => expression.assetId === fallback.assetId)?.id ?? expressions[0]?.id;
    proposal.summary.importedAssets += imported.report.imported;
    if (JSON.stringify(character) === beforeCharacter) continue;
    proposal.summary.portraitCharacters = (proposal.summary.portraitCharacters ?? 0) + 1;
    proposal.details.push({ speaker: character.name, action: `${binding.mode === 'replace' ? '更换' : '补充'}立绘：${candidates.length} 张图片`, reason: binding.sourcePath + (binding.expressionId ? `；仅表情「${effective.expressions.find(expression => expression.id === binding.expressionId)!.name}」` : '；保留原表情编号和演出引用') });
    if (unmatched.length) proposal.warnings.push(`「${character.name}」的原表情 ${unmatched.join('、')} 在新目录中没有同名图片，暂用「${fallback.name}」，保留原表情编号；可在角色页重新选择图片。`);
    if (binding.directory && !candidates.some(candidate => usual(candidate.name))) proposal.warnings.push(`「${character.name}」的目录没有通常或默认图片，暂以「${fallback.name}」作默认立绘，请在方案中检查。`);
  }
  return draft;
}
