import assert from 'node:assert/strict';
import { createReadStream, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve('.'), version = '1.3.2';
const json = async (file: string) => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const digest = async (file: string) => { const h = createHash('sha256'); for await (const b of createReadStream(file)) h.update(b); return h.digest('hex'); };
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
async function walk(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const item of await fs.readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const file = path.join(prefix, item.name);
    if (item.isDirectory()) out.push(...await walk(dir, file)); else if (item.isFile()) out.push(file);
  }
  return out;
}
const installationFile = path.join('artifacts', (await fs.readdir('artifacts')).filter(f => /^installation-content-1\.3\.2-\d+\.json$/.test(f)).sort().at(-1)!);
const installation = await json(installationFile);
assert.equal(installation.passed, true);
assert.equal(installation.version, version);
assert.equal(await digest(installation.installer), installation.installerSha256);
assert.equal(await digest(installation.projectFile), installation.before);
const packed = path.join(root, 'release/win-unpacked'), installed = installation.destination;
for (const file of await walk(packed)) assert.equal(await digest(path.join(packed, file)), await digest(path.join(installed, file)), file);
const require = createRequire(import.meta.url), builderRequire = createRequire(require.resolve('electron-builder'));
const asar = createRequire(builderRequire.resolve('app-builder-lib'))('@electron/asar');
const archive = path.join(packed, 'resources/app.asar');
assert.equal(JSON.parse(asar.extractFile(archive, 'package.json').toString()).version, version);
let codeFiles = 0, contentFiles = 0;
for (const folder of ['dist', 'dist-desktop']) for (const file of await walk(folder)) {
  assert.equal(sha(asar.extractFile(archive, path.join(folder, file))), await digest(path.join(folder, file)), file); codeFiles++;
}
for (const folder of ['resources', 'docs']) for (const file of await walk(folder)) {
  const normalized = file.replaceAll('\\', '/');
  if (folder === 'resources' && normalized.startsWith('runtime/') && (normalized.startsWith('runtime/tmp/') || /(?:^|\/)(?:__pycache__|cache|saves)\//.test(normalized) || /(?:^|\/)(?:log|traceback|errors)\.txt$/.test(normalized))) continue;
  assert.equal(await digest(path.join(folder, file)), await digest(path.join(packed, 'resources', folder, file)), file); contentFiles++;
}
const portableFile = path.join('artifacts/portable-verification', (await fs.readdir('artifacts/portable-verification')).sort().at(-1)!, 'report.json');
const portable = await json(portableFile), manifest = await json((await json('release/portable-1.3.2.json')).manifest);
assert.equal(portable.status, 'passed');
assert.equal(await digest(portable.zip), portable.zipSha256);
for (const item of manifest.files) assert.equal(await digest(path.join(portable.portable.directory, item.path)), item.sha256, item.path);
const protectedFiles = await json('artifacts/protected-files-1.3.1.json');
for (const item of protectedFiles) assert.equal(await digest(item.path), item.sha256, item.path);
for (const line of (await fs.readFile('release/SHA256SUMS-1.3.1.txt', 'utf8')).trim().split(/\r?\n/)) {
  const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
  assert.ok(match, line); assert.equal(await digest(path.isAbsolute(match[2]) ? match[2] : path.join('release', match[2])), match[1]);
}
const artifacts = [];
for (const file of [installation.installer, portable.zip]) artifacts.push({ file, sha256: await digest(file), bytes: (await fs.stat(file)).size });
await fs.writeFile('release/SHA256SUMS-1.3.2.txt', artifacts.map(a => a.sha256 + '  ' + path.basename(a.file)).join('\n') + '\n');
await fs.writeFile('artifacts/package-integrity-1.3.2.json', JSON.stringify({ status: 'passed', version, checkedAt: new Date().toISOString(), installation: installationFile, portable: portableFile, codeFiles, contentFiles, portableFiles: manifest.files.length, protectedFiles: protectedFiles.length, previousReleasePreserved: '1.3.1', binaries: { executable: await digest(path.join(packed, 'Visual Novel Studio.exe')), asar: await digest(archive) }, artifacts }, null, 2));
console.log('Package integrity passed');
