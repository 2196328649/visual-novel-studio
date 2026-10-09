import { promises as fs } from 'node:fs';
import path from 'node:path';
import { assetSchema, projectSchema } from '../src/core/model';
import { UnityUi } from './lib/unity-ui';
import { addAihongGalleryNavigation } from './lib/aihong-gallery-navigation';

const root = path.resolve('.'), source = path.join(root, 'artifacts/aihong-ui-assets');
const ui = await UnityUi.load(path.join(root, 'artifacts/aihong-ui-inspection/2026-09-10-layout'));
const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'));
for (const directory of ['artifacts/aihong-template', 'resources/templates/aihong']) {
  const projectFile = path.join(root, directory, 'project.vns.json');
  const project = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  const used = new Set<string>();
  addAihongGalleryNavigation(project, ui, record => {
    const asset = manifest.assets.find((a: any) => record && a.source.file === record.file && a.source.pathId === record.pathId);
    if (!asset) throw new Error('Missing original pagination font');
    if (!project.assets.some(a => a.id === asset.id)) project.assets.push(assetSchema.parse(asset));
    used.add(asset.id); return asset.id;
  });
  for (const id of used) {
    const asset = project.assets.find(a => a.id === id)!;
    const destination = path.join(root, directory, asset.path); await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(source, asset.path), destination);
  }
  await fs.writeFile(projectFile, JSON.stringify(projectSchema.parse(project), null, 2) + '\n');
  console.log(JSON.stringify({ directory, list: project.ui.components.find(c => c.id === 'ai_gallery_items')!.list }));
}
