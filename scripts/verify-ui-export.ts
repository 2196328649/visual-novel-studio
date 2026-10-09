import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSchema } from '../src/core/model';
import { runRenpy } from '../src/runtime/service';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRun = path.resolve(process.env.VNS_UI_VERIFIED_RUN ?? path.join(root, 'artifacts', 'ui-runtime-verification', '2026-09-08T13-13-27-642Z'));
const sdkRoot = path.join(root, 'resources', 'runtime');
const output = path.join(root, 'artifacts', 'ui-export-verification', new Date().toISOString().replaceAll(':', '-'));
const report: { passed: boolean; output: string; sourceRun: string; scope: string; exports: Record<string, unknown>[]; error?: string } = {
  passed: false, output, sourceRun,
  scope: 'Reuses the already tested custom five-page UI builds. Each Windows ZIP is extracted outside the source tree and tested using its own EXE with the original 23-assertion driver.',
  exports: [],
};
const hash = async (file: string) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const writeReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));

async function runExecutable(executable: string, args: string[], cwd: string, extraEnv: Record<string, string> = {}) {
  return new Promise<{ code: number; log: string }>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...extraEnv };
    delete env.PYTHONHOME;
    delete env.PYTHONPATH;
    delete env.RENPY_BASE;
    const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 180_000);
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8');
      stream.on('data', (text: string) => { log = (log + text).slice(-1_000_000); process.stdout.write(text); });
    }
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code: timedOut ? 124 : code ?? 1, log }); });
  });
}

async function verifyResolution(width: number, height: number) {
  const resolution = `${width}x${height}`;
  const sourceBuild = path.join(sourceRun, resolution);
  const destination = path.join(output, resolution);
  const releaseDir = path.join(destination, 'release-build');
  const distributionDir = path.join(destination, 'distributions');
  const project = projectSchema.parse(JSON.parse(await fs.readFile(path.join(sourceBuild, 'authored-project.json'), 'utf8')));
  const driver = await fs.readFile(path.join(sourceBuild, 'game', 'testcases.rpy'), 'utf8');
  const entry: Record<string, unknown> = { passed: false, resolution, sourceBuild, releaseDir, distributionDir, projectId: project.id };
  report.exports.push(entry);
  await fs.mkdir(releaseDir, { recursive: true });
  // Reuse exact game output, excluding the original verifier's external player saves.
  await fs.cp(path.join(sourceBuild, 'game'), path.join(releaseDir, 'game'), { recursive: true });
  await fs.copyFile(path.join(sourceBuild, 'LICENSE-RenPy.txt'), path.join(releaseDir, 'LICENSE-RenPy.txt'));
  const verifiedHashes = Object.fromEntries(await Promise.all(['story.rpy', 'screens.rpy', 'options.rpy', 'testcases.rpy'].map(async file => {
    const original = await hash(path.join(sourceBuild, 'game', file));
    if (original !== await hash(path.join(releaseDir, 'game', file))) throw new Error(`Staging changed the verified game file: ${file}`);
    return [file, original];
  })));
  await fs.mkdir(path.join(releaseDir, 'tests'), { recursive: true });
  await fs.mkdir(path.join(releaseDir, 'game', 'saves'), { recursive: true });
  await fs.writeFile(path.join(releaseDir, 'tests', 'export-sentinel.txt'), 'verification-only');
  await fs.writeFile(path.join(releaseDir, 'game', 'saves', 'export-sentinel.save'), 'verification-only');
  Object.assign(entry, { verifiedGameHashes: verifiedHashes });
  await writeReport();
  console.log(`${resolution}: building Windows ZIP from verified release output`);
  const distribution = await runRenpy(sdkRoot, path.join(sdkRoot, 'launcher'), ['distribute', releaseDir, '--package', 'win', '--destination', distributionDir], { timeoutMs: 300_000 });
  await fs.writeFile(path.join(destination, 'distribute.log'), distribution.log);
  if (distribution.code !== 0) throw new Error(`${resolution} distribution failed (${distribution.code}).`);
  const zipPath = path.join(distributionDir, `${project.id}-${project.version}-win.zip`);
  const originalHash = await hash(zipPath);
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-ui-export-'));
  const relative = path.relative(root, temporaryRoot);
  if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw new Error('ZIP extraction must be outside the source tree.');
  const extractionRoot = path.join(temporaryRoot, 'unpacked');
  const entriesPath = path.join(destination, 'zip-entries.json');
  Object.assign(entry, { zipPath, sha256: originalHash, temporaryRoot });
  await writeReport();
  const extraction = await runExecutable('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '$archive = [System.IO.Compression.ZipFile]::OpenRead($env:VNS_UI_ZIP)',
    'try {',
    '  $names = @($archive.Entries | ForEach-Object { $_.FullName })',
    '  [System.IO.File]::WriteAllText($env:VNS_UI_ENTRIES, (ConvertTo-Json -InputObject $names), [System.Text.UTF8Encoding]::new($false))',
    '} finally { $archive.Dispose() }',
    '[System.IO.Compression.ZipFile]::ExtractToDirectory($env:VNS_UI_ZIP, $env:VNS_UI_UNPACK)',
  ].join('\n')], temporaryRoot, { VNS_UI_ZIP: zipPath, VNS_UI_ENTRIES: entriesPath, VNS_UI_UNPACK: extractionRoot });
  await fs.writeFile(path.join(destination, 'unpack.log'), extraction.log);
  if (extraction.code !== 0) throw new Error(`${resolution} ZIP extraction failed (${extraction.code}).`);
  const entries = JSON.parse(await fs.readFile(entriesPath, 'utf8')) as string[];
  const leaked = entries.filter(file => /^[^/]+\/(game\/(testcases\.rpyc?|saves)|tests|player-saves|isolated-saves|verification)(\/|$)/i.test(file) || /export-sentinel\.(save|txt)$/i.test(file));
  if (leaked.length) throw new Error(`${resolution} ZIP contains verification data: ${leaked.join(', ')}`);
  const directories = (await fs.readdir(extractionRoot, { withFileTypes: true })).filter(item => item.isDirectory());
  if (directories.length !== 1) throw new Error(`${resolution} ZIP should have one root directory.`);
  const unpackedProject = path.join(extractionRoot, directories[0].name);
  const required = [`${project.id}.exe`, `${project.id}.py`, 'game/story.rpyc', 'game/screens.rpyc', 'game/fonts/SourceHanSansLite.ttf', 'LICENSE-RenPy.txt', 'renpy/LICENSE.txt', 'SAMPLE-CREDITS.md', ...project.assets.map(asset => `game/${asset.path}`)];
  for (const file of required) await fs.access(path.join(unpackedProject, file));
  for (const file of ['story.rpy', 'screens.rpy', 'options.rpy']) {
    if (await hash(path.join(unpackedProject, 'game', file)) !== verifiedHashes[file]) throw new Error(`${resolution} ZIP changed the verified ${file}.`);
  }
  if ((await fs.readFile(path.join(unpackedProject, 'game', 'story.rpy'), 'utf8')).includes('VNS_EVENT:')) throw new Error('Release includes development instrumentation.');
  // Only the disposable extracted copy receives the original UI test driver.
  await fs.writeFile(path.join(unpackedProject, 'game', 'testcases.rpy'), driver);
  Object.assign(entry, { unpackedProject, archiveEntries: entries.length, checkedFiles: required.length, excludesTestData: true });
  await writeReport();
  console.log(`${resolution}: running ZIP's own executable and original 23 assertions`);
  const tested = await runExecutable(path.join(unpackedProject, `${project.id}.exe`), ['--savedir', path.join(temporaryRoot, 'isolated-saves'), unpackedProject, 'test', '--report-detailed'], unpackedProject);
  await fs.writeFile(path.join(destination, 'runtime.log'), tested.log);
  if (tested.code !== 0 || !/Test cases\s*:\s*1\s*\|\s*1 passed/.test(tested.log) || !/Assertions\s*:\s*23\s*\|\s*23 passed/.test(tested.log)) throw new Error(`${resolution} exported EXE did not pass all 23 assertions (${tested.code}).`);
  if (tested.log.includes('VNS_EVENT:')) throw new Error('Exported EXE emitted development events.');
  if (await hash(zipPath) !== originalHash) throw new Error(`${resolution} original ZIP changed while its copy was tested.`);
  const screenshots = path.join(destination, 'screenshots');
  await fs.cp(path.join(unpackedProject, 'tests', 'screenshots'), screenshots, { recursive: true });
  Object.assign(entry, { passed: true, testCases: 1, assertions: 23, archiveUnchanged: true, screenshots });
  await writeReport();
}

await fs.mkdir(output, { recursive: true });
try {
  const baseline = JSON.parse(await fs.readFile(path.join(sourceRun, 'report.json'), 'utf8')) as { status?: string };
  if (baseline.status !== 'passed') throw new Error('The selected source UI runtime verification has not passed.');
  for (const [width, height] of [[1280, 720], [640, 360]]) await verifyResolution(width, height);
  report.passed = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
await writeReport();
console.log(JSON.stringify(report, null, 2));
