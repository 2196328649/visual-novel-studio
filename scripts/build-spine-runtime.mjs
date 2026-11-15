import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { nativeBuildWorkspace, runNativeCompiler } from './lib/native-build-workspace.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'win32') throw new Error('The bundled game runtime currently targets Windows x64.');
const vswhere = path.join(process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)', 'Microsoft Visual Studio/Installer/vswhere.exe');
const installation = process.env.VNS_MSVC_ROOT ?? execFileSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8', windowsHide: true }).trim();
if (!installation) throw new Error('Install Visual Studio C++ Build Tools, or set VNS_MSVC_ROOT.');
const build = await nativeBuildWorkspace(root, 'spine-native-build'), output = path.join(root, 'resources/spine');
try {
  const sources = (await fs.readdir(path.join(root, 'vendor/spine-c/src/spine'))).filter(name => name.endsWith('.c')).sort();
  const quote = value => `"${value.replaceAll('"', '')}"`;
  const staged = path.join(build.work, 'vns_spine.dll');
  const args = ['/nologo', '/O2', '/MT', '/LD', '/TC', '/std:c11', '/D_CRT_SECURE_NO_WARNINGS', '/I' + quote(path.join(root, 'vendor/spine-c/include')), '/Fo' + quote(build.work + '/'), quote(path.join(root, 'native/spine/vns_spine.c')), ...sources.map(name => quote(path.join(root, 'vendor/spine-c/src/spine', name))), '/link', '/OUT:' + quote(staged), '/IMPLIB:' + quote(path.join(build.work, 'vns_spine.lib'))];
  const response = path.join(build.work, 'compile.rsp'); await fs.writeFile(response, args.join(' '));
  await fs.writeFile(path.join(build.work, 'compile.cmd'), `@echo off\r\ncall ${quote(path.join(installation, 'VC/Auxiliary/Build/vcvars64.bat'))} >nul\r\nif errorlevel 1 exit /b 1\r\ncl @${quote(response)}\r\nexit /b %errorlevel%\r\n`);
  await runNativeCompiler(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'compile.cmd'], build, 'windows-x86_64');
  const sha256 = createHash('sha256').update(await fs.readFile(staged)).digest('hex');
  const manifest = { abi: 2, platform: 'windows-x86_64', upstream: JSON.parse(await fs.readFile(path.join(root, 'vendor/spine-c/UPSTREAM.json'), 'utf8')), sha256 };
  await fs.mkdir(output, { recursive: true }); await fs.copyFile(staged, path.join(output, 'vns_spine.dll'));
  await fs.copyFile(path.join(root, 'vendor/spine-c/LICENSE'), path.join(output, 'LICENSE-Spine.txt'));
  const record = JSON.stringify(manifest, null, 2) + '\n';
  await fs.writeFile(path.join(output, 'build.json'), record); await fs.writeFile(path.join(build.report, 'build.json'), record);
  console.log('Spine 4.2 runtime ready:', output);
} finally { await build.cleanup(); }