import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Use a checksum-verified local archive when the package downloader cannot transfer it.
const require = createRequire(import.meta.url);
const packagePath = require.resolve('electron/package.json');
const electronRequire = createRequire(packagePath);
const { extract } = electronRequire('@electron-internal/extract-zip');
const version = electronRequire('./package.json').version;
const filename = `electron-v${version}-win32-x64.zip`;
const archive = path.resolve(process.argv[2] ?? `artifacts/downloads/${filename}`);
const expected = electronRequire('./checksums.json')[filename];
const actual = createHash('sha256').update(await fs.readFile(archive)).digest('hex');
if (!expected || actual !== expected) throw new Error('Electron archive checksum does not match the installed package.');
const root = path.dirname(packagePath);
await extract(archive, { dir: path.join(root, 'dist') });
await fs.writeFile(path.join(root, 'path.txt'), 'electron.exe');
console.log(`Electron ${version} installed from verified archive.`);
