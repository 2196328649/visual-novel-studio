import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { applyTextScript } from '../src/core/text-script';
import { validateProject } from '../src/core/validate';
const output = path.resolve('artifacts/followup-projects', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const files = ['resources/templates/aihong/project.vns.json', 'E:/Project/Visual Novel Studio/我的视觉小说1/project-v0.8.vns.json'];
const checks = [];
for (const file of files) {
 const source = await fs.readFile(file, 'utf8'); const project = projectSchema.parse(JSON.parse(source));
 assert.ok(!source.includes('自动显示发言角色') && !source.includes('showSpeaker'));
 assert.deepEqual(validateProject(project).filter(d => d.severity === 'error'), []);
 const parsed = applyTextScript(project, project.scriptText!.content);
 assert.deepEqual(parsed.issues, []);
 assert.deepEqual(validateProject(parsed.project).filter(d => d.severity === 'error'), []);
 checks.push({ file: path.resolve(file), sha256: createHash('sha256').update(source).digest('hex'), nodes: project.nodes.length, assets: project.assets.length, sourceValid: true });
}
const original = await fs.readFile('E:/Project/Visual Novel Studio/我的视觉小说1/project.vns.json');
const backup = await fs.readFile('work/pre-unified-show/author-project.json');
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, originalMatchesBackup: original.equals(backup), originalSha256: createHash('sha256').update(original).digest('hex') }, null, 2));
console.log(output);
