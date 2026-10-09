import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { prepareBuilderTools } from './prepare-builder-tools.mjs';
import { prepareNotices } from './prepare-notices.mjs';

const require = createRequire(import.meta.url);
async function run(script, args = [], env = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit', windowsHide: true, env });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`Build failed: ${script} (${code})`)));
  });
}
await fs.access('resources/runtime/renpy.py');
await fs.access('resources/example/project.vns.json');
await fs.access('resources/templates/aihong/project.vns.json');
await fs.access('resources/spine/vns_spine.py');
const spineBuild = JSON.parse(await fs.readFile('resources/spine/build.json', 'utf8'));
if (createHash('sha256').update(await fs.readFile('resources/spine/vns_spine.dll')).digest('hex') !== spineBuild.sha256) throw new Error('Spine runtime checksum differs from its build record. Run pnpm spine:build.');
const androidSpine = JSON.parse(await fs.readFile('resources/spine/android/build.json', 'utf8'));
for (const abi of ['armeabi-v7a', 'arm64-v8a', 'x86_64']) {
  if (createHash('sha256').update(await fs.readFile(`resources/spine/android/${abi}/libvns_spine.so`)).digest('hex') !== androidSpine.files[abi]) throw new Error(`Android Spine runtime checksum differs for ${abi}. Run pnpm spine:build:android.`);
}
await prepareNotices();
await run('scripts/build-single-exe.mjs');
await run(require.resolve('typescript/bin/tsc'), ['--noEmit']);
await run(path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js'), ['build']);
await import('./build-desktop.mjs');
const cache = await prepareBuilderTools();
await run(path.join(path.dirname(require.resolve('electron-builder/package.json')), 'cli.js'), ['--win', 'nsis', '--x64', `--config.electronDist=${path.dirname(require('electron'))}`], { ...process.env, ELECTRON_BUILDER_CACHE: cache });
await run('scripts/package-portable.mjs');
