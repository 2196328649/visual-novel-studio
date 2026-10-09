import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectSchema, type Project } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { mergeImportedPassages } from './lib/merge-imported-passages';

if (process.argv[2] === '--apply') {
  const manifestFile = path.resolve(process.argv[3]), verificationFile = path.resolve(process.argv[4]);
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  const verification = JSON.parse(await fs.readFile(verificationFile, 'utf8'));
  assert.equal(manifest.status, 'prepared'); assert.equal(manifest.input, 'saved-project');
  assert.equal(verification.status, 'passed'); assert.equal(verification.phase, 'after');
  assert.equal(path.resolve(verification.manifestFile), manifestFile);
  const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
  const before = await fs.readFile(manifest.file), after = await fs.readFile(manifest.candidate);
  assert.equal(hash(before), manifest.before, 'Project changed; prepare and verify the latest saved content');
  assert.equal(hash(after), manifest.after, 'Verified candidate changed');
  assert.equal(await fs.stat(manifest.file + '.autosave').then(() => true, error => {
    if (error.code !== 'ENOENT') throw error; return false;
  }), false, 'Save and close the current editor before applying');
  const original: Project = JSON.parse(before.toString('utf8')), candidate: Project = JSON.parse(after.toString('utf8'));
  projectSchema.parse(candidate);
  assert.deepEqual(mergeImportedPassages(original).project, candidate, 'Only the verified node and marker merge may be applied');
  const directory = path.dirname(path.resolve(manifest.file));
  const backup = path.join(directory, '.studio/backups', new Date().toISOString().replaceAll(':', '-') + '-imported-passages');
  const temporary = path.join(directory, '.project.paragraph-repair-' + Date.now() + '.tmp');
  assert.ok(path.resolve(backup).startsWith(directory + path.sep));
  assert.equal(path.dirname(temporary), directory);
  await fs.mkdir(backup, { recursive: true });
  await fs.copyFile(manifest.file, path.join(backup, 'project.vns.json'), fs.constants.COPYFILE_EXCL);
  await fs.copyFile(manifestFile, path.join(backup, 'manifest.json'), fs.constants.COPYFILE_EXCL);
  await fs.writeFile(temporary, after, { flag: 'wx' });
  try {
    assert.equal(hash(await fs.readFile(manifest.file)), manifest.before, 'Project changed before replacement');
    await fs.rename(temporary, manifest.file);
  } finally { await fs.rm(temporary, { force: true }); }
  assert.equal(hash(await fs.readFile(manifest.file)), manifest.after);
  const record = { ...manifest, status: 'applied', backup, verificationFile, appliedAt: new Date().toISOString() };
  await fs.writeFile(path.join(path.dirname(manifestFile), 'applied.json'), JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ status: record.status, file: manifest.file, backup, nodesBefore: manifest.nodesBefore, nodesAfter: manifest.nodesAfter, dialogueLines: manifest.dialogueLines }));
  process.exit(0);
}

const file = path.resolve(process.argv[2]);
const bytes = await fs.readFile(file);
let original: Project = JSON.parse(bytes.toString('utf8'));
let recoveryBytes: Buffer | undefined;
try {
  const recovery = await fs.readFile(file + '.autosave');
  const value = JSON.parse(recovery.toString('utf8'));
  if (value.project?.id === original.id && value.savedAt > (await fs.stat(file)).mtimeMs) {
    projectSchema.parse(value.project);
    original = value.project; recoveryBytes = recovery;
  }
} catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
projectSchema.parse(original);
const input = applyTextScript(original, original.scriptText?.content ?? projectToText(original));
assert.deepEqual(input.issues.filter(issue => issue.severity === 'error'), [], 'The latest text draft must parse before repair');
const sourceDraftPreserved = projectToText(input.project) !== projectToText(original);
const { project, merged } = mergeImportedPassages(original);
assert.ok(merged.length, 'No unreferenced imported passage boundaries to merge');
const dialogue = (value: Project) => value.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []);
assert.deepEqual(dialogue(project), dialogue(original), 'Every saved dialogue, action, voice and stable line ID must be preserved');
const withoutStory = ({ nodes: _nodes, scriptText: _scriptText, ...rest }: Project) => rest;
assert.deepEqual(withoutStory(project), withoutStory(original), 'Only the paragraph nodes and their hidden markers may change');
const parsed = applyTextScript(project, project.scriptText!.content);
assert.deepEqual(parsed.issues.filter(issue => issue.severity === 'error'), []);
assert.deepEqual(parsed.project.nodes.map(node => node.id), project.nodes.map(node => node.id));
const expected = mergeImportedPassages(input.project);
assert.deepEqual(expected.merged, merged);
assert.equal(projectToText(parsed.project), projectToText(expected.project), 'Preserve any text draft independently of the stored graph');
assert.deepEqual(mergeImportedPassages(project).merged, [], 'Repair must be idempotent');
const output = path.resolve('work/imported-passage-repair', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const candidate = path.join(output, 'project.vns.json'), next = JSON.stringify(project, null, 2) + '\n';
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
await fs.writeFile(path.join(output, 'before.json'), JSON.stringify(original, null, 2) + '\n');
await fs.writeFile(path.join(output, 'parsed-before.json'), JSON.stringify(input.project, null, 2) + '\n');
await fs.writeFile(path.join(output, 'saved-before.json'), bytes);
if (recoveryBytes) await fs.writeFile(path.join(output, 'autosave-before.json'), recoveryBytes);
await fs.writeFile(candidate, next);
await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({ status: 'prepared', file, candidate,
  before: digest(bytes), after: digest(next), recoveryBefore: recoveryBytes ? digest(recoveryBytes) : undefined,
  input: recoveryBytes ? 'latest-autosave' : 'saved-project', sourceDraftPreserved, nodesBefore: original.nodes.length, nodesAfter: project.nodes.length,
  dialogueLines: dialogue(project).length, merged,
}, null, 2));
console.log(output);
