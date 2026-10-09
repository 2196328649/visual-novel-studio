import { promises as fs } from 'node:fs';
import { projectSchema } from '../src/core/model';
import { validateProject } from '../src/core/validate';

// Only generated templates; preserve story, resources and player data.
for (const directory of ['resources/templates/aihong', 'artifacts/aihong-template']) {
  const file = `${directory}/project.vns.json`;
  const project = projectSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
  if (project.id !== 'project_aihong_ui_template') throw new Error(`Unexpected template: ${file}`);
  const components = project.ui.components;
  const title = components.find(c => c.id === 'ai_settings_title');
  const background = components.findIndex(c => c.id === 'ai_voice_background');
  const close = components.find(c => c.id === 'ai_voice_close');
  if (!title || background < 0 || !close) throw new Error(`Missing voice page: ${file}`);
  if (!components.some(c => c.id === 'ai_voice_system_title')) {
    components.splice(background + 1, 0, { ...structuredClone(title), id: 'ai_voice_system_title', page: 'voiceSettings' });
  }
  close.text = '退出音量设定';
  close.style = { ...close.style, fontSize: 22, fontAssetId: components.find(c => c.id === 'ai_voice_title')?.style?.fontAssetId, align: 'center' };
  const errors = validateProject(project).filter(issue => issue.severity === 'error');
  if (errors.length) throw new Error(JSON.stringify(errors));
  await fs.writeFile(file, JSON.stringify(projectSchema.parse(project), null, 2) + '\n');
  console.log(file);
}
