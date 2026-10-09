import { promises as fs } from 'node:fs';
import assert from 'node:assert/strict';
import { projectSchema } from '../src/core/model';
import { validateProject } from '../src/core/validate';

for (const directory of ['resources/templates/aihong', 'artifacts/aihong-template']) {
 const file = `${directory}/project.vns.json`;
 const project = projectSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
 assert.equal(project.id, 'project_aihong_ui_template');
 const component = project.ui.components.find(c => c.id === 'ai_voicecollection_items');
 assert.ok(component?.list);
 component.list.voiceOrder = 'favorites';
 component.list.voiceRemoveConfirm = true;
 assert.deepEqual(validateProject(project).filter(i => i.severity === 'error'), []);
 await fs.writeFile(file, JSON.stringify(projectSchema.parse(project), null, 2) + '\n');
 console.log(file);
}
