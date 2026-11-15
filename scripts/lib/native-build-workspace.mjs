import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { finished } from 'node:stream/promises';

const inside = (parent, target) => { const relative = path.relative(parent, target); return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };

/** Stage native outputs inside the repository, retaining only logs/metadata.
 * Compiler intermediates (including its TEMP/TMP) never enter shipped assets. */
export async function nativeBuildWorkspace(root, name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid native build name.');
  const workspace = await fs.realpath(root), parent = path.join(workspace, 'artifacts', name);
  await fs.mkdir(parent, { recursive: true });
  if (!inside(workspace, await fs.realpath(parent))) throw new Error('Native build directory must stay inside the workspace.');
  const report = await fs.mkdtemp(path.join(parent, new Date().toISOString().replaceAll(':', '-') + '-'));
  const work = path.join(report, 'work'); await fs.mkdir(path.join(work, 'tmp'), { recursive: true });
  return { report, work, async cleanup() {
    const resolved = await fs.realpath(work);
    if (!inside(await fs.realpath(report), resolved) || !inside(workspace, resolved)) throw new Error('Refusing native build cleanup outside its run: ' + resolved);
    await fs.rm(work, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
    await fs.writeFile(path.join(report, 'cleanup.json'), JSON.stringify({ removed: resolved }, null, 2));
  } };
}
export async function runNativeCompiler(executable, args, build, name) {
  const log = createWriteStream(path.join(build.report, name + '.log'));
  // Attach the completion listener immediately so write errors cannot be unhandled.
  const closed = finished(log); closed.catch(() => undefined);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(executable, args, { cwd: build.work, windowsHide: true, env: { ...process.env, TEMP: path.join(build.work, 'tmp'), TMP: path.join(build.work, 'tmp'), TMPDIR: path.join(build.work, 'tmp') }, stdio: ['ignore', 'pipe', 'pipe'] });
      const write = chunk => { log.write(chunk); process.stdout.write(chunk); };
      child.stdout.on('data', write); child.stderr.on('data', write);
      child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(name + ' native compilation failed: ' + code)));
    });
  } finally { log.end(); await closed; }
}