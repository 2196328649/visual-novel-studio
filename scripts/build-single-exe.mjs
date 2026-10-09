import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const compiler = path.join(process.env.SystemRoot || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
mkdirSync('resources/single-exe', { recursive: true });
execFileSync(compiler, ['/nologo', '/target:winexe', '/platform:anycpu', '/optimize+', '/utf8output', '/out:' + path.resolve('resources/single-exe/launcher.exe'), '/reference:System.IO.Compression.dll', '/reference:System.IO.Compression.FileSystem.dll', '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll', path.resolve('native/single-exe/Launcher.cs')], { stdio: 'inherit', windowsHide: true });
execFileSync(compiler, ['/nologo', '/target:exe', '/platform:anycpu', '/optimize+', '/out:' + path.resolve('resources/single-exe/icon-tool.exe'), path.resolve('native/single-exe/IconTool.cs')], { stdio: 'inherit', windowsHide: true });
