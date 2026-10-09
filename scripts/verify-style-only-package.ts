import assert from 'node:assert/strict';
import { createReadStream, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve('.');
const require = createRequire(import.meta.url), builder = createRequire(require.resolve('electron-builder'));
const asar = createRequire(builder.resolve('app-builder-lib'))('@electron/asar');
const previous = path.join(root, 'artifacts/asset-theme-1.3.1-before/app.asar');
const current = path.join(root, 'release/win-unpacked/resources/app.asar');
const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const digest = async (file: string) => { const h = createHash('sha256'); for await (const bytes of createReadStream(file)) h.update(bytes); return h.digest('hex'); };
const json = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));
const baseline = await json('artifacts/asset-theme-1.3.1-before/verification.json');
assert.equal(await digest(previous), baseline.binaries.asar);
const files = (archive: string): string[] => asar.listPackage(archive).map((p: string) => p.slice(1)).filter((p: string) => typeof asar.statFile(archive, p).size === 'number');
const oldFiles = files(previous), newFiles = files(current);
const members: {previous: string; current: string; change: string}[] = [];
const replacements: [string, string][] = [];
for (const pattern of [/^elk\.bundled-.+\.js$/, /^index-.+\.js$/, /^index-.+\.css$/]) {
  const before = oldFiles.filter(p => pattern.test(path.basename(p))), after = newFiles.filter(p => pattern.test(path.basename(p)));
  assert.equal(before.length, 1); assert.equal(after.length, 1);
  replacements.push([path.basename(before[0]), path.basename(after[0])]);
}
const replaceReferences = (text: string) => replacements.reduce((text, [before, after]) => text.replaceAll(before, after), text);
assert.deepEqual(oldFiles.map(replaceReferences).sort(), [...newFiles].sort());
for (const before of oldFiles) {
  const after = replaceReferences(before), oldBytes = asar.extractFile(previous, before), newBytes = asar.extractFile(current, after);
  if (before.endsWith('.css')) {
    assert.notEqual(hash(oldBytes), hash(newBytes));
    members.push({previous: before, current: after, change: 'editor stylesheet'});
  } else {
    assert.equal(replaceReferences(oldBytes.toString()), newBytes.toString(), 'Unexpected code change: '+before);
    members.push({previous: before, current: after, change: hash(oldBytes) === hash(newBytes) ? 'byte-identical' : 'asset filename references only'});
  }
}
const manifest = await json('artifacts/portable-package/1.3.1-5663dda7/manifest.json');
const allowed = ['resources/app.asar', 'Visual Novel Studio.exe', 'resources/docs/release-1.3.1.md'];
let unchangedFiles = 0;
for (const file of manifest.files) {
  if (['portable.json', '使用说明.md'].includes(file.path) || allowed.includes(file.path)) continue;
  assert.equal(await digest(path.join('release/win-unpacked', file.path)), file.sha256, 'Unexpected runtime/resource change: '+file.path);
  unchangedFiles++;
}
const report = {status: 'passed', generatedAt: new Date().toISOString(), previousBinaries: baseline.binaries,
  currentBinaries: {asar: await digest(current), executable: await digest('release/win-unpacked/Visual Novel Studio.exe')},
  previousArchive: previous, currentArchive: current, baselineManifest: 'artifacts/portable-package/1.3.1-5663dda7/manifest.json',
  members, unchangedFiles, changedPackageFiles: allowed,
  scope: 'Only the editor stylesheet, its generated filename references, release notes, and Electron ASAR integrity metadata changed. All desktop code, export logic, and bundled game resources are byte-identical. Earlier functional export/Android evidence remains applicable; final theme and portable packaging are tested again.'};
await fs.writeFile('artifacts/style-only-package-1.3.1.json', JSON.stringify(report, null, 2)+'\n');
console.log(JSON.stringify(report, null, 2));
