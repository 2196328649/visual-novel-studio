import assert from 'node:assert/strict';
import { createReadStream, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const digest = async file => { const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex'); };
const version = (await read('package.json')).version;
assert.equal(version, '0.8.0');
assert.equal(process.argv.length, 8, 'Supply release, portable, packaged-editor, regression, followup and project-check report directories.');
const regressionFile = path.resolve(process.argv[5], 'report.json');
const editorFile = path.resolve(process.argv[4], 'report.json');
const portableFile = path.resolve(process.argv[3], 'report.json');
const releaseFile = path.resolve(process.argv[2], 'report.json');
const followupFile = path.resolve(process.argv[6], 'report.json'), projectsFile = path.resolve(process.argv[7], 'report.json');
const followup = await read(followupFile), projects = await read(projectsFile);
const regression = await read(regressionFile), editor = await read(editorFile), portable = await read(portableFile), release = await read(releaseFile);
for (const result of [regression, editor, portable, release, followup, projects]) assert.equal(result.status, 'passed');
assert.equal(regression.results.length, 13); assert.ok(regression.results.every(r => r.code === 0));
assert.equal(followup.results.length, 7);
for (const item of followup.results) { assert.equal(item.code, 0); assert.equal((await read(item.report)).status, 'passed'); }
const unitFile = path.resolve('work/v08-followup-final-tests.log');
const unit = await fs.readFile(unitFile, 'utf8'), count = Number(unit.match(/tests (\d+)/)?.[1]);
assert.ok(count >= 926); assert.match(unit, new RegExp('pass ' + count + '\\b')); assert.match(unit, /fail 0\b/); assert.match(unit, /skipped 0\b/);
assert.equal((await fs.readFile('work/v08-types-followup-final.log', 'utf8')).trim(), '');
for (const item of release.checks) assert.equal(await digest(item.archive), item.sha256);
const tested = await read(path.join(path.dirname(editorFile), 'tested-app.json'));
const finalApp = release.checks.find(c => c.kind === 'installer').executable;
assert.equal(await digest(finalApp), tested.binaries.executable);
assert.equal(await digest(path.join(path.dirname(finalApp), 'resources/app.asar')), tested.binaries.asar);

assert.equal(portable.packageSha256, release.checks.find(c => c.kind === 'portable').sha256);
const result = {
  status: 'passed', version, verifiedAt: new Date().toISOString(), platform: 'Windows 10 x64',
  unitTests: { passed: count, failed: 0, log: unitFile },
  typecheck: 'passed', buildLog: path.resolve('work/v08-package-followup-final.log'),
  regression: { report: regressionFile, scripts: regression.results.length, results: regression.results },
  followup: { report: followupFile, scripts: followup.results.length, results: followup.results },
  projects: { report: projectsFile, checks: projects.checks },
  packagedEditor: { report: editorFile, binaries: tested.binaries, finalBinariesMatch: true },
  portable: { report: portableFile, packageSha256: portable.packageSha256, finalArchiveTested: true },
  artifacts: release.checks, packageContentReport: releaseFile,
  limitations: ['Windows runtime verification; Android device installation was not rerun.', 'Installer content was extracted and executed; no install/uninstall changes were made to the user system.', 'Single EXE games extract into temporary storage; normal exit cleans engine files, saves stay in the user directory.'],
};
const report = path.resolve('release/verification-0.8.0.json');
await fs.writeFile(report, JSON.stringify(result, null, 2) + '\n');
await fs.copyFile('docs/acceptance-0.8.md', 'release/acceptance-0.8.md');
console.log(JSON.stringify({ status: result.status, report, finalArchiveTested: true, artifacts: release.checks.map(({ archive, bytes, sha256 }) => ({ archive, bytes, sha256 })) }, null, 2));
