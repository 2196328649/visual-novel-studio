import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { makeId, projectSchema } from '../src/core/model';
import { organizeAssetLibrary, assetCategories } from '../src/core/asset-library';
import { importAssetPaths } from '../src/desktop/asset-import';
import { loadProject, saveProject } from '../src/desktop/project-store';
import { organizeAihongResources } from './lib/aihong-resources';

const projectFile = process.argv[2] ?? 'D:/LiuXiangdong/Documents/project.vns.json';
const source = process.argv[3] ?? 'E:/Project/Model/SLY/T/texture/character';
const stamp = new Date().toISOString().replaceAll(':', '-');
const backups: string[] = [];
for (const file of [projectFile, `${projectFile}.autosave`]) {
  if (await fs.stat(file).catch(() => undefined)) {
    const backup = `${file}.before-resource-workspace-${stamp}.bak`;
    await fs.copyFile(file, backup, fs.constants.COPYFILE_EXCL); backups.push(backup);
  }
}
const session = await loadProject(projectFile);
const before = session.project;
const result = await importAssetPaths(path.dirname(projectFile), before, [source], { category: 'portrait' });
if (result.report.errors.length) throw new Error(result.report.errors.join('\n'));
const project = result.project;
const aliases: Record<string, string> = { 满穗: '穗', 林翩翩二十三岁: '林翩翩' };
const characters = new Set<string>();
let expressions = 0;
for (const entry of result.entries) {
  const asset = project.assets.find(asset => asset.id === entry.assetId);
  if (!asset || asset.kind !== 'image') continue;
  const relative = path.relative(source, entry.source).replaceAll('\\', '/');
  const parts = relative.split('/');
  const folderName = parts.length > 1 ? parts[0] : path.basename(entry.source, path.extname(entry.source));
  const name = project.characters.some(character => character.name === aliases[folderName]) ? aliases[folderName] : folderName;
  let character = project.characters.find(character => character.name === name);
  if (!character) {
    character = { id: makeId('character'), name, color: ['#83bda6', '#c6a77f', '#9db6dc', '#cda3b5'][project.characters.length % 4], expressions: [] };
    project.characters.push(character);
  }
  const expressionName = parts.length > 1 ? path.basename(entry.source, path.extname(entry.source)).replace(/^\d+[ _-]*/, '') : '默认';
  if (!character.expressions.some(expression => expression.assetId === asset.id && expression.name === expressionName)) {
    character.expressions.push({ id: `expression_${createHash('sha256').update(`${character.id}/${relative}`).digest('hex').slice(0, 24)}`, name: expressionName, assetId: asset.id });
    expressions++;
  }
  characters.add(character.id);
}
organizeAihongResources(project);
assert.deepEqual(project.nodes, before.nodes, 'Portrait import must preserve all authored story nodes');
assert.deepEqual(project.scriptText, before.scriptText, 'Portrait import must preserve the current text draft');
assert.equal(project.entryId, before.entryId);
projectSchema.parse(project);
await saveProject(projectFile, project);
const categories = assetCategories(project);
const report = { projectFile, recoveredAutosave: session.recovered, backups, imported: result.report, characterCount: characters.size, expressionsAdded: expressions, totalAssets: project.assets.length, preservedNodes: project.nodes.length, preservedTextLength: project.scriptText?.content.length, categories: Object.fromEntries([...new Set(categories.values())].map(category => [category, [...categories.values()].filter(value => value === category).length])) };
await fs.mkdir('artifacts/resource-workspace', { recursive: true });
await fs.writeFile('artifacts/resource-workspace/portrait-import.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
