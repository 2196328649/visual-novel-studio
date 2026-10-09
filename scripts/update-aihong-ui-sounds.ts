import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { projectSchema } from '../src/core/model';
import { loadProject, saveProject } from '../src/desktop/project-store';
import { addAihongUiSounds } from './lib/aihong-ui-sounds';

const files = process.argv.slice(2);
for (const file of files.length ? files : ['resources/templates/aihong/project.vns.json', 'artifacts/aihong-template/project.vns.json']) {
  const resolved = path.resolve(file), directory = path.dirname(resolved);
  const session = await loadProject(resolved), project = session.project;
  assert.ok(project.ui.components.some(c => c.id === 'ai_title_start'), 'Not an Aihong-based project');
  const before = JSON.stringify(project), stamp = new Date().toISOString().replaceAll(':', '-');
  const backup = files.length ? resolved + '.before-ui-sounds-' + stamp : path.resolve('artifacts/aihong-ui-sounds/template-backups', (resolved.includes('resources') ? 'bundled-' : 'generated-') + stamp + '.json');
  await fs.mkdir(path.dirname(backup), { recursive: true });
  await fs.writeFile(backup, before + '\n', { flag: 'wx' });
  const story = JSON.stringify([project.nodes, project.scriptText, project.scenes, project.chapters]);
  await addAihongUiSounds(project, directory);
  assert.equal(JSON.stringify([project.nodes, project.scriptText, project.scenes, project.chapters]), story);
  const valid = projectSchema.parse(project);
  // Template asset paths are also consumed by source generators; do not move
  // their existing files as a side effect of adding two sounds.
  const saved = files.length ? await saveProject(resolved, valid) : { project: valid };
  if (!files.length) await fs.writeFile(resolved, JSON.stringify(valid, null, 2) + '\n');
  console.log(JSON.stringify({ file: resolved, hoverSoundId: saved.project.ui.hoverSoundId, overrides: saved.project.ui.components.filter(c => c.hoverSoundId !== undefined).length, backup }));
}
