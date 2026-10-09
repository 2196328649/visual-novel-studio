import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requested = process.argv[2] ?? process.env.VNS_RENPY_SDK;
if (!requested) throw new Error('请指定独立的 Ren\u2019Py SDK 目录：node scripts/prepare-runtime.mjs <SDK目录>，或设置 VNS_RENPY_SDK。');
const sdk = path.resolve(requested);
const destination = path.join(studio, 'resources', 'runtime');
if (sdk === destination) throw new Error('SDK 源目录不能与 resources/runtime 目标目录相同。');
const entries = ['renpy.py', 'renpy.exe', 'renpy.sh', 'LICENSE.txt', 'renpy', 'launcher', 'gui', 'sdk-fonts', 'lib/python3.12', 'lib/py3-windows-x86_64', 'lib/py3-linux-x86_64/renpy', 'lib/py3-mac-universal/renpy'];
await fs.access(path.join(sdk, 'renpy.py'));
await fs.mkdir(destination, { recursive: true });
for (const entry of entries) {
  await fs.cp(path.join(sdk, entry), path.join(destination, entry), { recursive: true, filter: source => !['saves', 'cache', '__pycache__'].includes(path.basename(source)) });
  console.log(`Runtime: ${entry}`);
}
console.log(`Bundled runtime: ${destination}`);
