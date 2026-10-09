import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectSchema, type Project } from '../src/core/model';
import { applyTextScript } from '../src/core/text-script';
import { textHeading } from '../src/core/text-headings';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function repair(original: Project, chapterId: string) {
  const project = structuredClone(original), chapter = project.chapters.find(chapter => chapter.id === chapterId);
  assert.ok(chapter && project.scriptText);
  const source = project.scriptText.content;
  const headings = [...source.matchAll(/[^\r\n]+/g)].flatMap(match => {
    const heading = textHeading(match[0]);
    return heading?.kind === '章节' ? [{ heading, line: match[0], at: match.index }] : [];
  });
  assert.equal(project.chapters.length, 1, 'This repair requires one unambiguous existing chapter');
  assert.equal(headings.length, 1, 'This repair requires one authored chapter heading');
  const { heading, line, at } = headings[0], title = line.slice(heading.nameFrom!).trim();
  assert.ok(title && !/【[a-z][a-z0-9_]{0,63}】$/.test(title), 'The authored title must have lost its identity');
  const sceneReference = source.slice(at + line.length).match(/^\s*#{1,3}\s*小章节[^\r\n]*【([a-z][a-z0-9_]{0,63})】\s*$/m)?.[1];
  assert.equal(project.scenes.find(scene => scene.id === sceneReference)?.chapterId, chapterId, 'The following subchapter must identify the same existing chapter');
  const end = at + line.trimEnd().length;
  project.scriptText.content = source.slice(0, end) + `【${chapterId}】` + source.slice(end);
  chapter.name = title;
  projectSchema.parse(project);
  const parsed = applyTextScript(project, project.scriptText.content);
  assert.deepEqual(parsed.issues.filter(issue => issue.severity === 'error'), []);
  assert.deepEqual(parsed.project.chapters.map(item => [item.id, item.name]), [[chapterId, title]]);
  assert.deepEqual(parsed.project.nodes.map(node => node.id), project.nodes.map(node => node.id));
  assert.deepEqual(project.nodes, original.nodes, 'Retain the saved graph and all performances verbatim');
  assert.equal(project.scriptText.content.replace(`【${chapterId}】`, ''), source, 'Retain the author’s complete text draft');
  return project;
}

if (process.argv[2] === '--apply') {
  const manifestFile = path.resolve(process.argv[3]), verificationFile = path.resolve(process.argv[4]);
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  const verification = JSON.parse(await fs.readFile(verificationFile, 'utf8'));
  assert.equal(manifest.status, 'prepared'); assert.equal(verification.status, 'passed');
  assert.equal(path.resolve(verification.manifestFile), manifestFile);
  assert.equal(verification.chapter?.id, manifest.chapter.id);
  assert.equal(await fs.stat(manifest.file + '.autosave').then(() => true, error => {
    if (error.code !== 'ENOENT') throw error; return false;
  }), false, 'Save and close the current editor before applying');
  const before = await fs.readFile(manifest.file), after = await fs.readFile(manifest.candidate);
  assert.equal(digest(before), manifest.before, 'Author project changed; prepare and verify its latest content');
  assert.equal(digest(after), manifest.after, 'Verified candidate changed');
  assert.deepEqual(JSON.parse(after.toString('utf8')), repair(JSON.parse(before.toString('utf8')), manifest.chapter.id));
  const directory = path.dirname(path.resolve(manifest.file));
  const backup = path.join(directory, '.studio/backups', new Date().toISOString().replaceAll(':', '-') + '-chapter-heading');
  const temporary = path.join(directory, '.project.chapter-heading-' + Date.now() + '.tmp');
  assert.ok(path.resolve(backup).startsWith(directory + path.sep));
  assert.equal(path.dirname(temporary), directory);
  await fs.mkdir(backup, { recursive: true });
  await fs.copyFile(manifest.file, path.join(backup, 'project.vns.json'), fs.constants.COPYFILE_EXCL);
  await fs.copyFile(manifestFile, path.join(backup, 'manifest.json'), fs.constants.COPYFILE_EXCL);
  await fs.writeFile(temporary, after, { flag: 'wx' });
  try {
    assert.equal(digest(await fs.readFile(manifest.file)), manifest.before, 'Author project changed before replacement');
    await fs.rename(temporary, manifest.file);
  } finally { await fs.rm(temporary, { force: true }); }
  assert.equal(digest(await fs.readFile(manifest.file)), manifest.after);
  const record = { ...manifest, status: 'applied', backup, verificationFile, appliedAt: new Date().toISOString() };
  await fs.writeFile(path.join(path.dirname(manifestFile), 'applied.json'), JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ status: record.status, file: manifest.file, backup, chapter: manifest.chapter }));
} else {
  const file = path.resolve(process.argv[2]), chapterId = process.argv[3];
  const bytes = await fs.readFile(file), original: Project = JSON.parse(bytes.toString('utf8'));
  const project = repair(original, chapterId), next = JSON.stringify(project, null, 2) + '\n';
  const output = path.resolve('work/chapter-heading-repair', new Date().toISOString().replaceAll(':', '-'));
  const candidate = path.join(output, 'project.vns.json');
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'saved-before.json'), bytes);
  await fs.writeFile(candidate, next);
  const chapter = project.chapters.find(item => item.id === chapterId)!;
  await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({ status: 'prepared', file, candidate, before: digest(bytes), after: digest(next),
    input: 'saved-project', sourceDraftPreserved: true, merged: [], nodesBefore: original.nodes.length, nodesAfter: project.nodes.length,
    dialogueLines: project.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []).length,
    chapter: { id: chapter.id, name: chapter.name, beforeName: original.chapters[0].name },
  }, null, 2));
  console.log(output);
}
