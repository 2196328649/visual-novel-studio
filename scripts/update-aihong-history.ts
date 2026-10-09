import { readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { applyTemplateHistory, historyTemplateAssets } from '../src/core/template-history';
const root = 'resources/templates/aihong';
const project = projectSchema.parse(JSON.parse(await readFile(path.join(root, 'project.vns.json'), 'utf8')));
const manifest = JSON.parse(await readFile('artifacts/aihong-ui-assets/manifest.json', 'utf8'));
for (const id of historyTemplateAssets) {
  if (project.assets.some(a => a.id === id)) continue;
  const { source, sha256, ...asset } = manifest.assets.find((a: any) => a.id === id);
  await copyFile(path.join('artifacts/aihong-ui-assets', asset.path), path.join(root, asset.path));
  project.assets.push({ ...asset, category: 'ui' });
}
applyTemplateHistory(project.ui.components.find(c => c.id === 'ai_history_items')!);
await writeFile(path.join(root, 'project.vns.json'), JSON.stringify(project, null, 2) + '\n');
console.log('Updated bundled history page and original scrollbar assets.');
