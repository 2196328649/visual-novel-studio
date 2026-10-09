import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { nativeEnvironment } from './process-env';

const execute = promisify(execFile);
export const singleExeMagic = 'VNS-ONE-EXE-0001';
/** Stream the already validated Ren'Py ZIP into a prebuilt Windows launcher. */
export async function packageSingleExe(options: { archive: string; destination: string; toolsDir: string; title: string; entry: string; icon?: string }) {
  if (!/^[^\\/:]+\/(?:[^\\/:]+)\.exe$/i.test(options.entry) || options.entry.split('/').some(part => part === '..')) throw new Error('单 EXE 的游戏入口路径无效。');
  await fs.copyFile(path.join(options.toolsDir, 'launcher.exe'), options.destination, fs.constants.COPYFILE_EXCL);
  try {
    if (options.icon && await fs.stat(options.icon).then(s => s.isFile(), () => false)) await execute(path.join(options.toolsDir, 'icon-tool.exe'), [options.destination, options.icon], { windowsHide: true, timeout: 30_000 });
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(options.archive)) hash.update(chunk);
    const bytes = (await fs.stat(options.archive)).size;
    if (!bytes) throw new Error('游戏 ZIP 为空，无法创建单 EXE。');
    const manifest = Buffer.from(JSON.stringify({ bytes, sha256: hash.digest('hex'), entry: options.entry, title: options.title }), 'utf8');
    await pipeline(createReadStream(options.archive), createWriteStream(options.destination, { flags: 'a' }));
    const length = Buffer.alloc(4); length.writeInt32LE(manifest.length);
    await fs.appendFile(options.destination, Buffer.concat([manifest, length, Buffer.from(singleExeMagic)]));
  } catch (error) { await fs.rm(options.destination, { force: true }); throw error; }
}

/** Read the ZIP central directory through the SDK Python, without extracting it. */
export async function singleExeEntry(sdkRoot: string, archive: string): Promise<string> {
  const { stdout } = await execute(path.join(sdkRoot, 'lib/py3-windows-x86_64/python.exe'), ['-c', 'import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps([n for n in z.namelist() if n.count("/")==1 and n.lower().endswith(".exe")]))', archive], { windowsHide: true, timeout: 30_000, encoding: 'utf8', env: nativeEnvironment() });
  const entries: string[] = JSON.parse(stdout.trim());
  if (entries.length !== 1) throw new Error('无法确定 ZIP 中唯一的游戏启动文件。');
  return entries[0];
}
