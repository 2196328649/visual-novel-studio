import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSchema } from '../src/core/model';
import type { VariableValue } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdkRoot = path.join(appRoot, 'resources', 'runtime');
const exampleDir = path.join(appRoot, 'resources', 'example');
const outputDir = path.join(appRoot, 'artifacts', 'runtime-verification');
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const runDir = path.join(outputDir, 'verification', runId);
const screenshotDirectory = `tests/screenshots/${runId}`;
const report: {
  runId: string;
  runtime: string;
  project: string;
  screenshotDirectory: string;
  steps: { name: string; code: number; logPath: string }[];
  distributionFiles: string[];
  unpackedProject?: string;
  unpackedScreenshotDirectory?: string;
  status: 'running' | 'passed' | 'failed';
  error?: string;
} = {
  runId, runtime: sdkRoot, project: outputDir,
  screenshotDirectory: path.join(outputDir, screenshotDirectory),
  steps: [], distributionFiles: [], status: 'running',
};

const testcase = `# Generated runtime verification for the bundled example.
testsuite global:
    before testcase:
        $ _test.timeout = 8.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = ${JSON.stringify(screenshotDirectory)}
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
        if not screen "main_menu":
            run MainMenu(confirm=False)

    teardown:
        exit

testcase ending_alone:
    click id "vn_main_start"
    advance until screen "choice"
    assert eval (vn_current_node == "choice_invite")
    click "今天先回家"
    assert eval (vn_current_node == "ending_alone")
    assert eval (vn_var_affection == 0)
    assert "有些故事，留待下一场雨。"
    screenshot "ending-alone.png"
    advance until screen "main_menu"

testcase ending_friend:
    click id "vn_main_start"
    advance until screen "choice"
    click "一起去图书馆"
    pause until "窗边还留着几滴雨水。"
    assert "窗边还留着几滴雨水。"
    assert eval (vn_current_node == "library" and vn_var_affection == 1)
    assert eval renpy.showing("vn_actor_char_yu")
    assert eval renpy.showing("vn_actor_char_xia")
    screenshot "library.png"
    advance until screen "choice"
    assert eval (vn_current_node == "choice_help")
    click "约好下次再来"
    advance until eval (vn_current_node == "ending_friend")
    assert eval (vn_var_affection == 1)
    assert "我们约好了，下次再见。"
    screenshot "ending-friend.png"
    advance until screen "main_menu"

testcase ending_warm:
    click id "vn_main_start"
    advance until screen "choice"
    click "一起去图书馆"
    pause until "窗边还留着几滴雨水。"
    assert "窗边还留着几滴雨水。"
    advance until screen "choice"
    click "留下来帮忙"
    pause until "走过草地时，云间透出了阳光。"
    assert "走过草地时，云间透出了阳光。"
    assert eval (vn_current_node == "walk" and vn_var_affection == 2)
    advance until eval (vn_current_node == "ending_warm")
    assert "雨后，新的故事开始了。"
    assert eval (vn_var_affection == 2)
    screenshot "ending-warm.png"
    advance until screen "main_menu"

testcase save_load_rollback:
    click id "vn_main_start"
    advance until screen "choice"
    click "一起去图书馆"
    pause until "窗边还留着几滴雨水。"
    assert "窗边还留着几滴雨水。"
    assert eval (vn_current_node == "library" and vn_var_affection == 1)
    run FileSave("vns_runtime_state", confirm=False, slot=True)
    assert eval renpy.can_load("vns_runtime_state")
    advance until screen "choice"
    click "留下来帮忙"
    pause until "走过草地时，云间透出了阳光。"
    assert "走过草地时，云间透出了阳光。"
    assert eval (vn_var_affection == 2)
    run FileLoad("vns_runtime_state", confirm=False, slot=True)
    pause until "窗边还留着几滴雨水。"
    assert "窗边还留着几滴雨水。"
    assert eval (vn_current_node == "library" and vn_var_affection == 1)
    screenshot "after-load.png"
    run Rollback() until screen "choice"
    assert eval (vn_current_node == "choice_invite" and vn_var_affection == 0)
    screenshot "after-rollback.png"
    click "今天先回家"
    assert eval (vn_current_node == "ending_alone" and vn_var_affection == 0)
    advance until screen "main_menu"

testcase player_screens:
    screenshot "main-menu.png"
    click id "vn_main_start"
    advance until "我正要去图书馆。"
    screenshot "dialogue.png"
    click "历史"
    assert screen "history"
    screenshot "history.png"
    click "返回游戏"
    assert not screen "history"
    click "存档"
    assert screen "save"
    run FilePage(1)
    click id "vn_file_slot_1"
    if screen "confirm":
        click "确认"
    assert eval renpy.can_load("1-1")
    screenshot "save.png"
    click "返回游戏"
    click "读档"
    assert screen "load"
    screenshot "load.png"
    click id "vn_file_slot_1"
    if screen "confirm":
        click "确认"
    assert not screen "load"
    assert "我正要去图书馆。"
    click "设置"
    assert screen "preferences"
    screenshot "preferences.png"
    click "返回游戏"
    assert not screen "preferences"
    click "设置"
    click "画廊"
    assert screen "gallery"
    screenshot "gallery.png"
    click id "vn_gallery_asset_f1198e9a72940a65bfded78c"
    assert screen "vn_gallery_image"
    screenshot "gallery-image.png"
    click "关闭"
    assert not screen "vn_gallery_image"
    click "音乐"
    assert screen "music_room"
    click "哀鸿 · 葬花埋香"
    assert eval bool(renpy.music.get_playing(channel="vn_musicroom"))
    screenshot "music-room.png"
    click "返回游戏"
    assert not screen "music_room"
    pause until eval (renpy.music.get_playing(channel="vn_musicroom") is None)
    assert eval (renpy.music.get_playing(channel="vn_musicroom") is None)
    assert eval bool(renpy.music.get_playing(channel="music"))
    run MainMenu(confirm=False)
    assert screen "main_menu"
`;

async function writeReport(): Promise<void> {
  await fs.writeFile(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  await fs.writeFile(path.join(outputDir, 'verification-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
}

async function recordStep(name: string, code: number, log: string): Promise<void> {
  const logPath = path.join(runDir, `${name}.log`);
  await fs.writeFile(logPath, log, 'utf8');
  report.steps.push({ name, code, logPath });
  await writeReport();
  console.log(`${name}: ${code === 0 ? 'PASS' : 'FAIL'} (${logPath})`);
  if (code !== 0) throw new Error(`${name} failed with status ${code}.\n${log.slice(-5000)}`);
}

async function runExecutable(executable: string, args: string[], cwd: string, extraEnv: Record<string, string> = {}): Promise<{ code: number; log: string }> {
  return new Promise((resolve, reject) => {
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
      stream.on('data', (text: string) => { log += text; process.stdout.write(text); });
    }
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code: timedOut ? 124 : (code ?? 1), log }); });
  });
}

async function verifyExport(project: ReturnType<typeof projectSchema.parse>): Promise<void> {
  const zipPath = path.join(appRoot, 'artifacts', 'runtime-distributions', `${project.id}-${project.version}-win.zip`);
  await fs.access(zipPath);
  report.distributionFiles = [zipPath];
  const unpackedRoot = path.join(appRoot, 'artifacts', 'runtime-unpacked', runId);
  const unpacked = await runExecutable('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:VNS_QA_PACKAGE, $env:VNS_QA_UNPACK)",
  ], appRoot, { VNS_QA_PACKAGE: zipPath, VNS_QA_UNPACK: unpackedRoot });
  await recordStep('unpack-windows', unpacked.code, unpacked.log);
  const roots = (await fs.readdir(unpackedRoot, { withFileTypes: true })).filter(entry => entry.isDirectory());
  if (roots.length !== 1) throw new Error('Expected exactly one project directory in the Windows ZIP.');
  const unpackedProject = path.join(unpackedRoot, roots[0].name);
  report.unpackedProject = unpackedProject;
  report.unpackedScreenshotDirectory = path.join(unpackedProject, screenshotDirectory);
  const requiredFiles = [
    `${project.id}.exe`, `${project.id}.py`, 'game/story.rpyc', 'game/screens.rpyc',
    'game/fonts/SourceHanSansLite.ttf', 'LICENSE-RenPy.txt', 'renpy/LICENSE.txt', 'SAMPLE-CREDITS.md',
    ...project.assets.map(asset => `game/${asset.path}`),
  ];
  for (const file of requiredFiles) await fs.access(path.join(unpackedProject, file));
  if ((await fs.readFile(path.join(unpackedProject, 'game', 'story.rpy'), 'utf8')).includes('VNS_EVENT:')) {
    throw new Error('Development event instrumentation leaked into the Windows release.');
  }
  for (const file of ['game/testcases.rpy', 'game/testcases.rpyc', 'game/saves', 'tests', 'verification', 'verification-report.json']) {
    if (await fs.access(path.join(unpackedProject, file)).then(() => true, () => false)) {
      throw new Error(`Verification artifact leaked into Windows ZIP: ${file}`);
    }
  }
  await recordStep('package-contents', 0, JSON.stringify({ requiredFiles, excludedArtifacts: true }, null, 2));
  // Only the disposable extraction receives a driver; the shipped ZIP is unchanged.
  await fs.writeFile(path.join(unpackedProject, 'game', 'testcases.rpy'), testcase, 'utf8');
  const tested = await runExecutable(path.join(unpackedProject, `${project.id}.exe`), [
    '--savedir', path.join(runDir, 'unpacked-saves'), unpackedProject,
    'test', '--report-detailed', '--report-skipped',
  ], unpackedProject);
  await recordStep('unpacked-exe-testcases', tested.code, tested.log);
  if (tested.log.includes('VNS_EVENT:')) throw new Error('The release EXE emitted development inspection events.');
  if (!/Assertions\s*:\s*43\s*\|\s*43 passed/.test(tested.log) || !/Test cases\s*:\s*5\s*\|\s*5 passed/.test(tested.log)) {
    throw new Error('The unpacked EXE did not report all expected runtime tests.');
  }
}

async function main(): Promise<void> {
  await fs.mkdir(runDir, { recursive: true });
  await writeReport();
  const project = projectSchema.parse(JSON.parse(await fs.readFile(path.join(exampleDir, 'project.vns.json'), 'utf8')));
  if (process.argv.includes('--export-only')) {
    await verifyExport(project);
    report.status = 'passed';
    await writeReport();
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const build = await buildProject({ project, projectDir: exampleDir, sdkRoot, outputDir, development: true });
  await recordStep('compile', build.ok ? 0 : 1, build.log + '\n' + JSON.stringify(build.diagnostics));
  await fs.writeFile(path.join(outputDir, 'game', 'testcases.rpy'), testcase, 'utf8');
  const lint = await runRenpy(sdkRoot, outputDir, ['lint']);
  await recordStep('lint', lint.code, lint.log);
  // Ren'Py also scans game/saves even when --savedir is supplied.
  try { await fs.rename(path.join(outputDir, 'game', 'saves'), path.join(runDir, 'previous-local-saves')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const test = await runRenpy(sdkRoot, outputDir, ['test', '--report-detailed', '--report-skipped'], {
    savedir: path.join(runDir, 'saves'), timeoutMs: 180_000,
    onData: text => process.stdout.write(text),
  });
  await recordStep('testcases', test.code, test.log);
  const debugStates = test.log.split(/\r?\n/).filter(line => line.startsWith('VNS_EVENT:')).map(line => JSON.parse(line.slice('VNS_EVENT:'.length)) as {
    nodeId: string | null; lineId: string | null; variables: Record<string, VariableValue>;
  });
  const rollbackRun = test.log.slice(test.log.indexOf('- save_load_rollback'), test.log.indexOf('- player_screens'));
  const rollbackStates = rollbackRun.split(/\r?\n/).filter(line => line.startsWith('VNS_EVENT:')).map(line => JSON.parse(line.slice('VNS_EVENT:'.length)) as {
    nodeId: string | null; lineId: string | null; variables: Record<string, VariableValue>;
  });
  let stateIndex = 0;
  for (const expected of [
    { nodeId: 'library', affection: 1 }, { nodeId: 'walk', affection: 2 },
    { nodeId: 'library', affection: 1 }, { nodeId: 'choice_invite', affection: 0 },
  ]) {
    const found = rollbackStates.findIndex((state, index) => index >= stateIndex && state.nodeId === expected.nodeId && state.variables.affection === expected.affection);
    if (found < 0) throw new Error(`Runtime inspection missed restored state ${JSON.stringify(expected)}.`);
    stateIndex = found + 1;
  }
  await recordStep('runtime-state-events', 0, JSON.stringify({ eventCount: debugStates.length, rollbackStates }, null, 2));
  const release = await buildProject({ project, projectDir: exampleDir, sdkRoot, outputDir, development: false });
  await recordStep('release-compile', release.ok ? 0 : 1, release.log + '\n' + JSON.stringify(release.diagnostics));
  const distributionDir = path.join(appRoot, 'artifacts', 'runtime-distributions');
  const distribution = await runRenpy(sdkRoot, path.join(sdkRoot, 'launcher'), [
    'distribute', outputDir, '--package', 'win', '--destination', distributionDir,
  ], { timeoutMs: 300_000 });
  await recordStep('distribute-windows', distribution.code, distribution.log);
  await verifyExport(project);
  report.status = 'passed';
  await writeReport();
  console.log(JSON.stringify(report, null, 2));
}

try { await main(); }
catch (error) {
  report.status = 'failed';
  report.error = error instanceof Error ? error.message : String(error);
  await fs.mkdir(runDir, { recursive: true });
  await writeReport();
  console.error(report.error);
  process.exitCode = 1;
}
