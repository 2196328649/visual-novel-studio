import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'win32') throw new Error('The bundled game runtime currently targets Windows x64.');
const vswhere = path.join(process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)', 'Microsoft Visual Studio/Installer/vswhere.exe');
const installation = process.env.VNS_MSVC_ROOT ?? execFileSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8', windowsHide: true }).trim();
if (!installation) throw new Error('Install Visual Studio C++ Build Tools, or set VNS_MSVC_ROOT.');
const build = path.join(root, 'artifacts/spine-native-build');
const output = path.join(root, 'resources/spine');
await fs.mkdir(build, { recursive: true }); await fs.mkdir(output, { recursive: true });
const sources = (await fs.readdir(path.join(root, 'vendor/spine-c/src/spine'))).filter(name => name.endsWith('.c')).sort();
const quote = value => `"${value.replaceAll('"', '')}"`;
const args = ['/nologo', '/O2', '/MT', '/LD', '/TC', '/std:c11', '/D_CRT_SECURE_NO_WARNINGS', '/I' + quote(path.join(root, 'vendor/spine-c/include')), '/Fo' + quote(build + '/'), quote(path.join(root, 'native/spine/vns_spine.c')), ...sources.map(name => quote(path.join(root, 'vendor/spine-c/src/spine', name))), '/link', '/OUT:' + quote(path.join(output, 'vns_spine.dll')), '/IMPLIB:' + quote(path.join(build, 'vns_spine.lib'))];
const response = path.join(build, 'compile.rsp');
await fs.writeFile(response, args.join(' '));
const command = path.join(build, 'compile.cmd');
await fs.writeFile(command, `@echo off\r\ncall ${quote(path.join(installation, 'VC/Auxiliary/Build/vcvars64.bat'))} >nul\r\nif errorlevel 1 exit /b 1\r\ncl @${quote(response)}\r\nexit /b %errorlevel%\r\n`);
await new Promise((resolve, reject) => {
  const child = spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'compile.cmd'], { cwd: build, windowsHide: true, stdio: 'inherit' });
  child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(`Native build failed: ${code}`)));
});
await fs.copyFile(path.join(root, 'vendor/spine-c/LICENSE'), path.join(output, 'LICENSE-Spine.txt'));
await fs.writeFile(path.join(output, 'build.json'), JSON.stringify({ abi: 1, platform: 'windows-x86_64', upstream: JSON.parse(await fs.readFile(path.join(root, 'vendor/spine-c/UPSTREAM.json'), 'utf8')), sha256: createHash('sha256').update(await fs.readFile(path.join(output, 'vns_spine.dll'))).digest('hex') }, null, 2) + '\n');
console.log('Spine 4.2 runtime ready:', output);
