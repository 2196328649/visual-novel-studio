import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadProject, saveProject } from '../src/desktop/project-store';
import { exportSettings } from '../src/core/export-settings';

const active = JSON.parse(await fs.readFile('artifacts/android-active.json', 'utf8'));
const source = path.resolve('resources/templates/aihong');
const project = (await loadProject(path.join(source, 'project.vns.json'))).project;
project.id = 'android_spine_acceptance'; project.name = 'Android Spine 实测';
project.exportSettings = { ...exportSettings(project), platform: 'android', fileName: 'AndroidSpineAcceptance' };
const destination = path.join(active.output, 'spine-project/project.vns.json');
await saveProject(destination, project, source);
console.log(destination);
