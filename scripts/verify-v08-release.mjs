import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createReadStream, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile), root = path.resolve('.');
const { version } = JSON.parse(await fs.readFile('package.json', 'utf8'));
const output = path.resolve('artifacts/release-validation', `${version}-${new Date().toISOString().replaceAll(':', '-')}`);
await fs.mkdir(output, { recursive: true });
const installer = path.resolve('release', `Visual Novel Studio Setup ${version}.exe`);
const portable = path.resolve('release', `Visual-Novel-Studio-${version}-portable-win-x64.zip`);
// Full 7-Zip is required: 7za sees only the embedded 7z, omitting NSIS custom files.
const sevenZip = path.resolve(process.env.VNS_FULL_7ZIP ?? 'artifacts/full-7zip/bin/7z.exe');
const digest = async file => { const h = createHash('sha256'); for await (const b of createReadStream(file)) h.update(b); return h.digest('hex'); };
const source = path.resolve('release/win-unpacked'), files = [];
async function collect(relative = '') {
  for (const entry of await fs.readdir(path.join(source, relative), { withFileTypes: true })) {
    const file = path.join(relative, entry.name);
    if (entry.isDirectory()) await collect(file); else if (entry.isFile()) files.push({ file, sha256: await digest(path.join(source, file)) });
  }
}
await collect();
const checks = [];
for (const [kind, archive] of [['installer', installer], ['portable', portable]]) {
  const destination = path.join(output, kind);
  // Read the installer archive; never execute its installation/registry actions.
  const extraction = await execute(sevenZip, ['x', '-y', ...(kind === 'installer' ? ['-tNsis'] : []), '-o' + destination, archive], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (kind === 'installer') await execute(sevenZip, ['x', '-y', '-o' + destination, path.join(destination, '$PLUGINSDIR/app-64.7z')], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  await fs.writeFile(path.join(output, kind + '-extraction.log'), extraction.stdout + extraction.stderr);
  const app = kind === 'installer' ? destination : path.join(destination, `Visual-Novel-Studio-${version}`);
  const mismatches = [];
  for (const item of files) if (await digest(path.join(app, item.file)).catch(() => 'missing') !== item.sha256) mismatches.push(item.file);
  assert.deepEqual(mismatches, [], kind + ' content must match the release build');
  assert.ok(await fs.stat(path.join(app, 'resources/resources/single-exe/launcher.exe')));
  assert.ok(await fs.stat(path.join(app, 'resources/resources/single-exe/icon-tool.exe')));
  checks.push({ kind, archive, bytes: (await fs.stat(archive)).size, sha256: await digest(archive), files: files.length, executable: path.join(app, 'Visual Novel Studio.exe'), mismatches });
}
await fs.writeFile(path.resolve('release', `SHA256SUMS-${version}.txt`), checks.map(c => `${c.sha256}  ${path.basename(c.archive)}`).join('\n') + '\n');
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', version, checks, installerExecution: false }, null, 2));
console.log(output);
