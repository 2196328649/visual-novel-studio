import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { validateProject } from '../src/core/validate';
import { loadProject, saveProject } from '../src/desktop/project-store';
import { addAihongPresentation, aihongPresentationAssets } from './lib/aihong-presentation';

const targets = process.argv.slice(2);
if (!targets.length) targets.push('resources/templates/aihong/project.vns.json', 'artifacts/aihong-template/project.vns.json');
const source = process.env.VNS_AIHONG_PRESENTATION_ASSETS ?? 'E:/Project/Model/SLY/T/Assets';
for (const file of targets) {
  const original = await fs.readFile(file, 'utf8');
  const session = await loadProject(file);
  const project = session.project;
  if (!project.ui.components.some(c => c.id === 'ai_title_animation')) throw new Error(`Not a known Aihong template: ${file}`);
  addAihongPresentation(project);
  for (const definition of aihongPresentationAssets) {
    const asset = project.assets.find(a => a.id === definition.id)!;
    const destination = path.resolve(path.dirname(file), asset.path);
    const bytes = await fs.readFile(path.join(source, definition.source));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    // Leave an existing resource intact; it may have been deliberately replaced.
    try { await fs.writeFile(destination, bytes, { flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (asset.kind === 'image') { const image = await fs.readFile(destination); asset.width = image.readUInt32BE(16); asset.height = image.readUInt32BE(20); }
  }
  const parsed = projectSchema.parse(project);
  const errors = validateProject(parsed).filter(d => d.severity === 'error');
  if (errors.length) throw new Error(JSON.stringify(errors));
  const backup = `${file}.before-chapter-mask-update.bak`;
  try { await fs.writeFile(backup, original, { flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  try { await fs.copyFile(`${file}.autosave`, `${file}.autosave.before-chapter-mask-update.bak`, fs.constants.COPYFILE_EXCL); } catch (error) { if (!['ENOENT', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
  await saveProject(file, parsed);
  console.log(JSON.stringify({ file: path.resolve(file), backup: path.resolve(backup), recoveredLatestAutosave: session.recovered, menuMusic: parsed.ui.menuMusicId, chapters: parsed.nodes.filter(n => n.kind === 'chapterTitle').length }));
}
