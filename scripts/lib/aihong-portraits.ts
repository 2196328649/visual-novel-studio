import { defaultShowCharacter } from '../../src/core/character-presets';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pngMetadata } from '../../src/desktop/image-metadata';
import { defaultPortraitFraming } from '../../src/core/portrait';
import type { Project } from '../../src/core/model';
import { addPerformanceToLines,  } from '../../src/core/blueprint-authoring';

export const aihongPortraitFolders: Record<string, string> = {
  char_yu: '满穗', char_xia: '大琼华', ai_voice_fangzhiyou: '方知宥', ai_voice_liang: '良',
  ai_voice_linpianpian: '林翩翩二十三岁', ai_voice_sulianyan_2: '苏怜烟', ai_voice_wangsheng: '王生', ai_voice_sulianyan_1: '小雁儿', ai_story_yang: '杨军爷',
};

/** Bind the preset's existing cast; never import into a user's open project. */
export async function addAihongPortraits(project: Project, output: string, source = process.env.VNS_AIHONG_PORTRAITS ?? 'E:/Project/Model/SLY/T/texture/character', fallback?: string) {
  const imported: { character: string; expressions: number }[] = [];
  for (const [characterId, folder] of Object.entries(aihongPortraitFolders)) {
    const character = project.characters.find(character => character.id === characterId);
    if (!character) continue;
    let files: string[], from: string;
    try { from = path.join(source, folder); files = await fs.readdir(from); }
    catch { if (!fallback) throw new Error(`缺少立绘目录：${folder}`); from = path.join(fallback, 'assets/portraits', folder); files = await fs.readdir(from); }
    const expressions = [];
    for (const file of files.filter(file => file.toLowerCase().endsWith('.png')).sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))) {
      const bytes = await fs.readFile(path.join(from, file));
      if (bytes.length < 24 || bytes.subarray(1, 4).toString() !== 'PNG') throw new Error(`立绘不是有效的 PNG：${folder}/${file}`);
      const hash = createHash('sha256').update(`${characterId}/${file}`).digest('hex').slice(0, 20);
      const assetId = `ai_portrait_${hash}`, expressionId = `ai_expression_${hash}`, relative = `assets/portraits/${folder}/${file}`;
      let name = path.basename(file, '.png').replace(/^\d+[ _-]*/, '').replace(new RegExp(`^${character.name}[ _-]*`), '');
      name ||= '通常';
      const asset = { id: assetId, name: `${character.name} · ${name}`, kind: 'image' as const, category: 'portrait' as const, path: relative, sourcePath: `${character.name}/${file}`, ...pngMetadata(bytes) };
      const existing = project.assets.find(item => item.id === assetId);
      if (existing) Object.assign(existing, asset); else project.assets.push(asset);
      expressions.push({ id: expressionId, name, assetId });
      const destination = path.join(output, relative); await fs.mkdir(path.dirname(destination), { recursive: true });
      if (path.resolve(from, file) !== path.resolve(destination)) await fs.writeFile(destination, bytes);
    }
    character.expressions = expressions;
    character.defaultExpressionId = expressions.find(expression => expression.name === '通常')?.id ?? expressions[0]?.id;
    character.portraitFraming ??= { ...defaultPortraitFraming };
    imported.push({ character: character.name, expressions: expressions.length });
  }
  addPerformanceToLines(project, defaultShowCharacter());
  const choices: Record<string, string> = { opening_line_2: '兽视通常', opening_line_4: '兽视通常', opening_line_5: '微笑', opening_line_7: '使眼色', ai_memory_line_2: '好奇', ai_memory_line_4: '疑惑', ai_memory_line_6: '平静', ai_memory_line_8: '微笑', ai_memory_line_11: '温柔', ai_child_line_2: '疲惫', ai_child_line_7: '坚定' };
  for (const node of project.nodes) {
    if (node.kind !== 'passage') { node.textHeading = false; continue; }
    for (const line of node.lines) {
      const name = choices[line.id]; if (!name) continue;
      const expression = project.characters.find(character => character.id === line.speakerId)?.expressions.find(expression => expression.name === name);
      const action = line.actions.find(action => action.kind === 'show' && !action.characterId);
      if (expression && action?.kind === 'show') action.expressionId = expression.id;
    }
  }
  return imported;
}
