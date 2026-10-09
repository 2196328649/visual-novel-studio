import { promises as fs } from 'node:fs';
import { organizeAihongResources } from './lib/aihong-resources';
import { loadProject, saveProject } from '../src/desktop/project-store';

// Metadata only: do not rebuild the template, copy media, compile or package.
for (const file of process.argv.slice(2)) {
  const session = await loadProject(file);
  organizeAihongResources(session.project);
  await saveProject(file, session.project);
  console.log(`${file}: ${session.project.assets.length} assets in ${session.project.contentBrowser?.folders.length} folders`);
}
