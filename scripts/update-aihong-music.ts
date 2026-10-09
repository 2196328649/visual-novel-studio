import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { validateProject } from '../src/core/validate';
import { addAihongMusic, aihongMusicTracks } from './lib/aihong-music';

const source = 'E:/Project/Model/SLY/T/Assets/Resources/starveling/sound/BGM';
for (const directory of ['resources/templates/aihong', 'artifacts/aihong-template']) {
  const file = path.join(directory, 'project.vns.json');
  const project = projectSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
  if (project.id !== 'project_aihong_ui_template') throw new Error(`Unexpected template: ${file}`);
  addAihongMusic(project);
  for (const [, name] of aihongMusicTracks) await fs.access(path.join(source, name + '.ogg'));
  for (const [index, [, name]] of aihongMusicTracks.entries()) {
    await fs.copyFile(path.join(source, name + '.ogg'), path.join(directory, project.assets.find(a => a.id === project.ui.components.find(c => c.id === 'ai_musicroom_items')!.list!.assetIds![index])!.path));
  }
  const valid = projectSchema.parse(project), errors = validateProject(valid).filter(i => i.severity === 'error');
  if (errors.length) throw new Error(JSON.stringify(errors));
  await fs.writeFile(file, JSON.stringify(valid, null, 2) + '\n');
  console.log(file);
}
