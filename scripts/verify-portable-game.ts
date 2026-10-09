import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { nativeEnvironment } from '../src/runtime/process-env';

const root = path.resolve(process.argv[2]);
const game = path.join(root, 'game/Portable-Story-1.0.0-win');
const output = path.join(root, 'game-recheck-' + Date.now());
await fs.mkdir(output);
const testFile = path.join(game, 'game/testcases.rpy');
const tests = await fs.readFile(testFile, 'utf8');
await fs.writeFile(testFile, tests.replace(/_test\.screenshot_directory = .*/, `_test.screenshot_directory = ${JSON.stringify(path.join(output, 'screenshots').replaceAll('\\', '/'))}`));
let log = '';
const code = await new Promise<number>((resolve, reject) => {
  const child = spawn(path.join(game, 'Portable-Story.exe'), ['--savedir', path.join(output, 'saves'), game, 'test', '--report-detailed'], {
    cwd: game, windowsHide: true, env: nativeEnvironment({ PATH: `${process.env.SystemRoot}/System32;${process.env.SystemRoot}`, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }), stdio: ['ignore', 'pipe', 'pipe'],
  });
  const timer = setTimeout(() => child.kill(), 240000);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log += data.toString(); });
  child.on('error', error => { clearTimeout(timer); reject(error); });
  child.on('close', code => { clearTimeout(timer); resolve(code ?? 1); });
});
await fs.writeFile(path.join(output, 'run.log'), log);
console.log(log.slice(-8000)); console.log(output);
process.exitCode = code || (/Test cases\s*:\s*1\s*\|\s*1 passed/.test(log) ? 0 : 1);
