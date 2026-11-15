import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execute = promisify(execFile);
const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as { version: string };
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('Invalid release version.');
const release = path.join(root, 'release');
const args = process.argv.slice(2);
if (args.some(argument => argument !== '--source')) throw new Error('Usage: prepare-release-artifacts.ts [--source]');

async function sha256(file: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

// GitHub supplies source archives for the release tag. An optional extra ZIP
// uses the reviewed Git commit, never a recursive copy of the local workspace.
async function sourceArchive(): Promise<string> {
  await execute('git', ['diff', '--quiet', 'HEAD', '--'], { cwd: root, windowsHide: true });
  const filename = `Visual-Novel-Studio-${version}-source.zip`;
  const archive = path.join(release, filename);
  const temporary = archive + '.preparing';
  try {
    await execute('git', ['archive', '--format=zip', `--prefix=Visual-Novel-Studio-${version}/`, `--output=${temporary}`, 'HEAD'], {
      cwd: root, windowsHide: true, maxBuffer: 1024 * 1024,
    });
    await fs.rename(temporary, archive);
  } finally {
    await fs.unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
  }
  return filename;
}

const filenames = [
  `Visual Novel Studio Setup ${version}.exe`,
  `Visual-Novel-Studio-${version}-portable-win-x64.zip`,
];
for (const filename of filenames) {
  const stat = await fs.lstat(path.join(release, filename));
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) throw new Error(`Release input is not a nonempty regular file: ${filename}`);
}
const portable = JSON.parse(await fs.readFile(path.join(release, `portable-${version}.json`), 'utf8')) as {
  version: string; bytes: number; sha256: string;
};
const portableFile = path.join(release, filenames[1]);
if (portable.version !== version || portable.bytes !== (await fs.stat(portableFile)).size || portable.sha256 !== await sha256(portableFile)) {
  throw new Error('The portable archive differs from its packaging record. Rebuild the release.');
}
if (args.includes('--source')) filenames.push(await sourceArchive());

const artifacts = await Promise.all(filenames.map(async filename => ({
  filename,
  bytes: (await fs.stat(path.join(release, filename))).size,
  sha256: await sha256(path.join(release, filename)),
})));
const checksumFilename = `SHA256SUMS-${version}.txt`;
await fs.writeFile(path.join(release, checksumFilename), artifacts.map(item => `${item.sha256}  ${item.filename}`).join('\n') + '\n', 'utf8');
const report = { version, checksumFilename, artifacts, source: args.includes('--source') ? 'HEAD' : `GitHub tag v${version}` };
await fs.writeFile(path.join(release, `release-${version}.json`), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report, null, 2));
