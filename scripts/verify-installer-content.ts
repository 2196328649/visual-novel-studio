import assert from 'node:assert/strict';
import { createReadStream, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve('.'), version = JSON.parse(await fs.readFile('package.json', 'utf8')).version;
const verification = path.resolve(process.env.VNS_INSTALL_VERIFY_ROOT ?? 'E:/VNS-Release-Verification-1.2.1-20260927');
const destination = path.join(verification, 'Studio'), projectFile = path.join(verification, 'upgrade-project/project.vns.json');
const installer = path.join(root, 'release', `Visual Novel Studio Setup ${version}.exe`);
const output = path.join(root, 'artifacts', `installation-content-${version}-${Date.now()}.json`);
const digest = async (file: string) => { const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex'); };
const before = await digest(projectFile), installerSha256 = await digest(installer);
const code = await new Promise<number>((resolve, reject) => {
  const child = spawn(installer, ['/S', '/currentuser', `/D=${destination}`], { cwd: root, windowsHide: true, stdio: 'ignore' });
  const timer = setTimeout(() => child.kill(), 180000);
  child.on('error', error => { clearTimeout(timer); reject(error); });
  child.on('close', code => { clearTimeout(timer); resolve(code ?? 1); });
});
assert.equal(code, 0);
const files: string[] = [];
async function walk(directory: string, relative = '') {
  for (const entry of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
    const file = path.join(relative, entry.name);
    if (entry.isDirectory()) await walk(directory, file); else if (entry.isFile()) files.push(file);
  }
}
const source = path.join(root, 'release/win-unpacked'); await walk(source);
const mismatches: string[] = [];
for (const relative of files) if (await digest(path.join(source, relative)) !== await digest(path.join(destination, relative)).catch(() => 'missing')) mismatches.push(relative);
const after = await digest(projectFile);
const report = { passed: !mismatches.length && before === after, version, installer, installerSha256, destination, projectFile, before, after, files: files.length, mismatches, asar: await digest(path.join(destination, 'resources/app.asar')) };
await fs.writeFile(output, JSON.stringify(report, null, 2)); console.log(output);
assert.deepEqual(mismatches, []); assert.equal(before, after);
