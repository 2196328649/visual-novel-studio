import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const bundles = [
  { release: 'nsis@1.2.1', file: 'nsis-bundle-3.12.tar.gz', sha256: '56997fdefe25e7928a1a68b4583d08b240b66cf660234053b20131a74cc082f4' },
  { release: '7zip@1.0.0', file: '7zip-win-x64.tar.gz', sha256: 'be071f15bd6da2f78fe81c6ddef2009b0c4d8a51f36b780cb806c7e6df95e1b3' },
];

export async function prepareBuilderTools() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('The Windows installer build requires Windows x64.');
  const cache = path.resolve(process.env.ELECTRON_BUILDER_CACHE || 'artifacts/builder-cache');
  for (const bundle of bundles) {
    const destination = path.join(cache, bundle.release, bundle.file);
    const checksum = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
    if (await checksum(destination).catch(() => '') === bundle.sha256) continue;
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.download`;
    const url = `https://github.com/electron-userland/electron-builder-binaries/releases/download/${encodeURIComponent(bundle.release)}/${bundle.file}`;
    console.log(`Downloading verified build tool: ${bundle.file}`);
    try {
      // Windows' networking stack respects system proxy settings used on managed desktops.
      await new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$ErrorActionPreference = "Stop"; $ProgressPreference = "SilentlyContinue"; Invoke-WebRequest -UseBasicParsing -Uri $env:VNS_TOOL_URL -OutFile $env:VNS_TOOL_FILE'], {
          stdio: 'inherit', windowsHide: true, env: { ...process.env, VNS_TOOL_URL: url, VNS_TOOL_FILE: temporary },
        });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error(`Build tool download failed (${code}).`)));
      });
      if (await checksum(temporary) !== bundle.sha256) throw new Error(`Build tool checksum mismatch: ${bundle.file}`);
      await fs.rename(temporary, destination);
    } finally { await fs.rm(temporary, { force: true }); }
  }
  return cache;
}
