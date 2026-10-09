import { promises as fs } from 'node:fs';
import path from 'node:path';
import { assetFiles, projectSchema } from '../src/core/model';
import { simplifySample } from '../src/core/sample-cleanup';
import { parseProject, atomicWrite, assetSourcePath } from '../src/desktop/project-store';
import { relocateProjectAssets } from '../src/core/asset-relocation';
import { resolveResourcePath, relativeResourcePath } from '../src/desktop/resource-paths';
import { validateProject } from '../src/core/validate';

const apply = process.argv.includes('--apply');
for (const argument of process.argv.slice(2).filter(arg => arg !== '--apply')) {
  const root = path.resolve(argument), file = path.join(root, 'project.vns.json');
  let input = JSON.parse(await fs.readFile(file, 'utf8'));
  const auto = await fs.readFile(file + '.autosave', 'utf8').then(JSON.parse).catch(() => undefined);
  if (auto?.project.id === input.id && auto.savedAt > (await fs.stat(file)).mtimeMs) input = auto.project;
  let project = parseProject(input).project;
  project = relocateProjectAssets(project, project.assets.filter(a => !a.externalPath && !Object.keys(a.externalFiles ?? {}).length).map(a => ({ assetId: a.id, files: Object.fromEntries(assetFiles(a).map(relative => [relative, relativeResourcePath(root, resolveResourcePath(root, relative, a.id))])) })));
  const before = project.assets.length;
  const { removedAssets, storyImages } = simplifySample(project);
  project = projectSchema.parse(project);
  const errors = validateProject(project).filter(issue => issue.severity === 'error');
  if (errors.length) throw Error(JSON.stringify(errors));
  const retainedFiles = new Set(project.assets.flatMap(asset => assetFiles(asset).map(relative => assetSourcePath(root, asset, relative).toLowerCase())));
  for (const asset of project.assets) for (const relative of assetFiles(asset)) await fs.access(assetSourcePath(root, asset, relative));
  const deletions = new Set<string>();
  for (const asset of removedAssets) for (const relative of assetFiles(asset)) {
    if (asset.externalPath || asset.externalFiles?.[relative]) continue;
    const target = path.resolve(assetSourcePath(root, asset, relative));
    if (!target.toLowerCase().startsWith((root + path.sep).toLowerCase())) throw Error('Out of project: ' + target);
    if (!retainedFiles.has(target.toLowerCase())) deletions.add(target);
  }
  if (apply) {
    await atomicWrite(file, JSON.stringify(project, null, 2) + '\n');
    await fs.rm(file + '.autosave', { force: true });
    for (const target of deletions) await fs.rm(target, { force: true });
  }
  console.log(JSON.stringify({root,apply,before,after:project.assets.length,removedImages:removedAssets.length,files:deletions.size,storyImages:storyImages.map(id=>project.assets.find(a=>a.id===id)?.name),removedPages:project.ui.disabledPages}));
}
