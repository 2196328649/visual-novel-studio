import { simplifySample } from '../src/core/sample-cleanup';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSchema } from '../src/core/model';
import { validateProject } from '../src/core/validate';
import { applyTextScript } from '../src/core/text-script';
import { prepareAihongAuthoring } from './lib/aihong-authoring';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const relative of ['resources/templates/aihong', 'artifacts/aihong-template']) {
  const directory = path.join(root, relative), file = path.join(directory, 'project.vns.json');
  if (!(await fs.stat(file).catch(() => undefined))) continue;
  const project = projectSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
  assert.equal(project.id, 'project_aihong_ui_template');
  prepareAihongAuthoring(project);
  simplifySample(project);
  const valid = projectSchema.parse(project);
  assert.deepEqual(validateProject(valid).filter(issue => issue.severity === 'error'), []);
  const parsed = applyTextScript(valid, valid.scriptText!.content);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.project.nodes)), JSON.parse(JSON.stringify(valid.nodes)));
  await fs.writeFile(file, JSON.stringify(valid, null, 2) + '\n');
  await fs.copyFile(path.join(root, 'docs/aihong-story-sample.md'), path.join(directory, '示例说明.md'));
  console.log(`${relative}: authoring source synchronized`);
}
