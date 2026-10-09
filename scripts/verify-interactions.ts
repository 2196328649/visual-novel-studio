import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject, projectSchema, type StoryNode } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';
import { endingPerformanceNodes } from '../src/core/ending-migration';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'artifacts', 'interaction-verification', new Date().toISOString().replaceAll(':', '-'));
const sdkRoot = path.join(root, 'resources', 'runtime');
const exampleDir = path.join(root, 'resources', 'example');
const sample = projectSchema.parse(JSON.parse(await fs.readFile(path.join(exampleDir, 'project.vns.json'), 'utf8')));
const project = createProject('动态演出与互动验收');
project.id = 'interaction_verification';
project.assets = sample.assets;
project.characters = sample.characters;
project.ui.menuBackgroundId = sample.ui.menuBackgroundId;
const sceneId = project.scenes[0].id;
const base = (id: string) => ({ id, sceneId, name: id, x: 0, y: 0 });
const actor = project.characters[0];
const background = project.assets.find(asset => asset.id === sample.ui.menuBackgroundId) ?? project.assets.find(asset => asset.kind === 'image')!;
project.effects = [{ id: 'intro_effect', name: '入场镜头', commands: ['镜头：0.02，0，1.05，0.2', '震动：横向'] }];
project.entryId = 'start';
project.nodes = [
  { ...base('start'), kind: 'start', next: 'intro' },
  { ...base('intro'), kind: 'passage', next: 'menu', lines: [{ id: 'intro_line', text: '选择一项互动。', actions: [
    { kind: 'background', assetId: background.id, transition: 'none' },
    { kind: 'show', characterId: actor.id, expressionId: actor.expressions[0].id, x: 0.5, y: 1, scale: 0.8, layer: 10, transition: 'none' },
    { kind: 'animate', characterId: actor.id, wait: true, repeat: false, keyframes: [
      { x: 0.5, y: 1, scale: 0.8, rotation: 0, opacity: 1, duration: 0, easing: 'linear' },
      { x: 0.6, y: 1, scale: 0.8, rotation: 2, opacity: 1, duration: 0.2, easing: 'easeout' },
    ] },
    { kind: 'effect', effectId: 'intro_effect' },
  ] }] },
  { ...base('menu'), kind: 'choice', prompt: '选择互动', choices: [
    { id: 'option_hotspot', text: '查看场景', target: 'hotspots' },
    { id: 'option_password', text: '密码锁', target: 'password' },
    { id: 'option_clicks', text: '限时点击', target: 'clicks' },
  ] },
  { ...base('hotspots'), kind: 'interaction', prompt: '查看人物所在区域', showHints: true, timeoutSeconds: 2, timeout: 'failure', cancel: 'cancel', hotspots: [{ id: 'actor_hotspot', name: '查看人物', x: 0.35, y: 0.2, width: 0.3, height: 0.45, characterId: actor.id, target: 'success' }] },
  { ...base('password'), kind: 'minigame', template: 'password', title: '密码锁', prompt: '输入归来的口令', password: '归来', caseSensitive: false, attempts: 2, targetClicks: 3, timeLimit: 3, success: 'success', failure: 'failure', cancel: 'cancel' },
  { ...base('clicks'), kind: 'minigame', template: 'timedClicks', title: '限时点击', prompt: '完成三次点击', password: '', caseSensitive: false, attempts: 2, targetClicks: 3, timeLimit: 3, success: 'success', failure: 'failure', cancel: 'cancel' },
  ...endingPerformanceNodes(project, base('success'), '互动成功'),
  ...endingPerformanceNodes(project, base('failure'), '互动失败'),
  { ...base('cancel'), kind: 'passage', lines: [{ id: 'cancel_line', text: '已取消', actions: [] }], next: 'menu' },
] satisfies StoryNode[];

const driver = `init python:
    import pygame_sdl2 as vn_test_pygame
    def vn_test_text(value):
        vn_test_pygame.event.post(vn_test_pygame.event.Event(vn_test_pygame.TEXTINPUT, text=value, test=True))

testsuite global:
    before testcase:
        $ _test.timeout = 10.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        if not screen "main_menu":
            run MainMenu(confirm=False)
    teardown:
        exit

testcase hotspot_click:
    click id "vn_main_start"
    advance until screen "choice"
    click "查看场景"
    assert screen "vn_interaction"
    screenshot "hotspots.png"
    click id "vn_hotspot_actor_hotspot"
    assert "互动成功"

testcase hotspot_timeout:
    click id "vn_main_start"
    advance until screen "choice"
    click "查看场景"
    pause until eval (vn_current_node == "failure")
    assert "互动失败"

testcase hotspot_cancel:
    click id "vn_main_start"
    advance until screen "choice"
    click "查看场景"
    click id "vn_interaction_cancel"
    assert "已取消"

testcase password_success:
    click id "vn_main_start"
    advance until screen "choice"
    click "密码锁"
    assert screen "vn_minigame_password"
    run Function(vn_test_text, "归来")
    pause until eval (vn_minigame_answer == "归来")
    screenshot "password.png"
    click id "vn_minigame_submit"
    assert "互动成功"

testcase password_failure:
    click id "vn_main_start"
    advance until screen "choice"
    click "密码锁"
    type "wrong" id "vn_minigame_input"
    click id "vn_minigame_submit"
    assert eval (vn_minigame_remaining == 1)
    type "wrong" id "vn_minigame_input"
    click id "vn_minigame_submit"
    assert "互动失败"

testcase password_cancel:
    click id "vn_main_start"
    advance until screen "choice"
    click "密码锁"
    click id "vn_minigame_cancel"
    assert "已取消"

testcase timed_success:
    click id "vn_main_start"
    advance until screen "choice"
    click "限时点击"
    click id "vn_minigame_click"
    click id "vn_minigame_click"
    screenshot "timed-clicks.png"
    click id "vn_minigame_click"
    assert "互动成功"

testcase timed_failure:
    click id "vn_main_start"
    advance until screen "choice"
    click "限时点击"
    pause until eval (vn_current_node == "failure")
    assert "互动失败"

testcase timed_cancel:
    click id "vn_main_start"
    advance until screen "choice"
    click "限时点击"
    click id "vn_minigame_cancel"
    assert "已取消"

testcase saved_progress:
    click id "vn_main_start"
    advance until screen "choice"
    click "密码锁"
    type "wrong" id "vn_minigame_input"
    click id "vn_minigame_submit"
    assert eval (vn_minigame_remaining == 1)
    run FileSave("interaction_progress", confirm=False, slot=True)
    type "wrong" id "vn_minigame_input"
    click id "vn_minigame_submit"
    assert "互动失败"
    run FileLoad("interaction_progress", confirm=False, slot=True)
    assert screen "vn_minigame_password"
    assert eval (vn_minigame_remaining == 1)
    run Function(vn_test_text, "归来")
    pause until eval (vn_minigame_answer == "归来")
    click id "vn_minigame_submit"
    assert "互动成功"

testcase saved_timed_progress:
    click id "vn_main_start"
    advance until screen "choice"
    click "限时点击"
    click id "vn_minigame_click"
    pause until eval (vn_minigame_time_left <= 2.4)
    $ vn_test_text.saved_time = vn_minigame_time_left
    run FileSave("timed_progress", confirm=False, slot=True)
    pause until eval (vn_current_node == "failure")
    assert "互动失败"
    run FileLoad("timed_progress", confirm=False, slot=True)
    assert screen "vn_minigame_timed_clicks"
    assert eval (vn_minigame_clicks == 1)
    assert eval (vn_test_text.saved_time - 0.3 <= vn_minigame_time_left <= vn_test_text.saved_time)
    click id "vn_minigame_click"
    click id "vn_minigame_click"
    assert "互动成功"

testcase saved_hotspot_time:
    click id "vn_main_start"
    advance until screen "choice"
    click "查看场景"
    pause until eval (vn_interaction_remaining <= 1.4)
    $ vn_test_text.saved_time = vn_interaction_remaining
    run FileSave("hotspot_progress", confirm=False, slot=True)
    pause until eval (vn_current_node == "failure")
    run FileLoad("hotspot_progress", confirm=False, slot=True)
    assert screen "vn_interaction"
    assert eval (vn_test_text.saved_time - 0.3 <= vn_interaction_remaining <= vn_test_text.saved_time)
    click id "vn_hotspot_actor_hotspot"
    assert "互动成功"

testcase native_save_menu:
    click id "vn_main_start"
    advance until screen "choice"
    click "限时点击"
    click id "vn_minigame_click"
    pause until eval (vn_minigame_time_left <= 2.4)
    click "存档"
    assert screen "save"
    $ vn_test_text.menu_time = vn_minigame_time_left
    pause 0.5
    assert eval (vn_minigame_time_left == vn_test_text.menu_time)
    run FilePage(1)
    click id "vn_file_slot_1"
    assert eval renpy.can_load("1-1")
    screenshot "interaction-save-menu.png"
    click "返回游戏"
    assert screen "vn_minigame_timed_clicks"
    click id "vn_minigame_cancel"
    assert "已取消"
    click "读档"
    assert screen "load"
    click id "vn_file_slot_1"
    if screen "confirm":
        click "确认"
    assert screen "vn_minigame_timed_clicks"
    assert eval (vn_minigame_clicks == 1)
    assert eval (vn_test_text.menu_time - 0.3 <= vn_minigame_time_left <= vn_test_text.menu_time)
    click id "vn_minigame_click"
    click id "vn_minigame_click"
    assert "互动成功"

testcase reentry_resets_state:
    click id "vn_main_start"
    advance until screen "choice"
    click "密码锁"
    type "wrong" id "vn_minigame_input"
    click id "vn_minigame_submit"
    assert eval (vn_minigame_remaining == 1)
    click id "vn_minigame_cancel"
    advance until screen "choice"
    click "密码锁"
    assert eval (vn_minigame_remaining == 2 and vn_minigame_answer == "")
    click id "vn_minigame_cancel"
    advance until screen "choice"
    click "限时点击"
    click id "vn_minigame_click"
    pause until eval (vn_minigame_time_left <= 2.4)
    click id "vn_minigame_cancel"
    advance until screen "choice"
    click "限时点击"
    assert eval (vn_minigame_clicks == 0 and vn_minigame_time_left > 2.5)
    click id "vn_minigame_cancel"
    advance until screen "choice"
    click "查看场景"
    pause until eval (vn_interaction_remaining <= 1.4)
    click id "vn_interaction_cancel"
    advance until screen "choice"
    click "查看场景"
    assert eval (vn_interaction_remaining > 1.5)
    click id "vn_hotspot_actor_hotspot"
    assert "互动成功"
`;

function assertTestResult(result: { code: number; log: string }) {
  if (result.code !== 0 || !/Test cases\s*:\s*14\s*\|\s*14 passed/.test(result.log) || !/Assertions\s*:\s*40\s*\|\s*40 passed/.test(result.log)) {
    throw new Error(`Runtime verification did not pass all 14 cases and 40 assertions (${result.code}).`);
  }
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
      stream.on('data', (text: string) => { log = (log + text).slice(-1_000_000); process.stdout.write(text); });
    }
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code: timedOut ? 124 : (code ?? 1), log }); });
  });
}

async function verifyExport(report: Record<string, unknown>) {
  const releaseDir = path.join(output, 'release-build');
  const distributionDir = path.join(output, 'distributions');
  const exportReport: Record<string, unknown> = { passed: false, releaseDir, distributionDir };
  report.export = exportReport;
  const release = await buildProject({ project, projectDir: exampleDir, sdkRoot, outputDir: releaseDir, development: false });
  await fs.writeFile(path.join(output, 'export-build.log'), release.log + JSON.stringify(release.diagnostics));
  if (!release.ok) throw new Error(`Release build failed: ${release.log}\n${JSON.stringify(release.diagnostics)}`);
  // Include disposable fixtures in the build directory so ZIP exclusions are exercised.
  await fs.writeFile(path.join(releaseDir, 'game', 'testcases.rpy'), driver);
  await fs.mkdir(path.join(releaseDir, 'tests'), { recursive: true });
  await fs.mkdir(path.join(releaseDir, 'game', 'saves'), { recursive: true });
  await fs.writeFile(path.join(releaseDir, 'tests', 'export-sentinel.txt'), 'verification-only');
  await fs.writeFile(path.join(releaseDir, 'game', 'saves', 'export-sentinel.save'), 'verification-only');
  const distribution = await runRenpy(sdkRoot, path.join(sdkRoot, 'launcher'), ['distribute', releaseDir, '--package', 'win', '--destination', distributionDir], { timeoutMs: 300_000 });
  await fs.writeFile(path.join(output, 'export-distribute.log'), distribution.log);
  if (distribution.code !== 0) throw new Error(`Windows distribution failed (${distribution.code}).`);
  const zipPath = path.join(distributionDir, `${project.id}-${project.version}-win.zip`);
  const originalHash = createHash('sha256').update(await fs.readFile(zipPath)).digest('hex');
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-interaction-export-'));
  const relative = path.relative(root, temporaryRoot);
  if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw new Error('Export test extraction must be outside the source directory.');
  const extractionRoot = path.join(temporaryRoot, 'unpacked');
  const entriesPath = path.join(output, 'export-entries.json');
  Object.assign(exportReport, { zipPath, sha256: originalHash, temporaryRoot, extractionRoot });
  const extracted = await runExecutable('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $archive = [System.IO.Compression.ZipFile]::OpenRead($env:VNS_INTERACTION_ZIP); try { $names = @($archive.Entries | ForEach-Object { $_.FullName }); [System.IO.File]::WriteAllText($env:VNS_INTERACTION_ENTRIES, (ConvertTo-Json -InputObject $names), [System.Text.UTF8Encoding]::new($false)) } finally { $archive.Dispose() }; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:VNS_INTERACTION_ZIP, $env:VNS_INTERACTION_UNPACK)",
  ], temporaryRoot, { VNS_INTERACTION_ZIP: zipPath, VNS_INTERACTION_ENTRIES: entriesPath, VNS_INTERACTION_UNPACK: extractionRoot });
  await fs.writeFile(path.join(output, 'export-unpack.log'), extracted.log);
  if (extracted.code !== 0) throw new Error(`Windows ZIP extraction failed (${extracted.code}).`);
  const entries = JSON.parse(await fs.readFile(entriesPath, 'utf8')) as string[];
  const leaked = entries.filter(entry => /^[^/]+\/(game\/(testcases\.rpyc?|saves)|tests|isolated-saves|verification|verification-report\.json)(\/|$)/i.test(entry) || /export-sentinel\.(save|txt)$/i.test(entry));
  if (leaked.length) throw new Error(`Verification data leaked into the ZIP: ${leaked.join(', ')}`);
  const directories = (await fs.readdir(extractionRoot, { withFileTypes: true })).filter(entry => entry.isDirectory());
  if (directories.length !== 1) throw new Error('Expected exactly one project directory in the Windows ZIP.');
  const unpackedProject = path.join(extractionRoot, directories[0].name);
  const required = [`${project.id}.exe`, `${project.id}.py`, 'game/story.rpyc', 'game/screens.rpyc', 'game/fonts/SourceHanSansLite.ttf', 'LICENSE-RenPy.txt', 'renpy/LICENSE.txt', 'SAMPLE-CREDITS.md', ...project.assets.map(asset => `game/${asset.path}`)];
  for (const file of required) await fs.access(path.join(unpackedProject, file));
  const source = await fs.readFile(path.join(unpackedProject, 'game', 'story.rpy'), 'utf8');
  if (source.includes('VNS_EVENT:')) throw new Error('Development instrumentation leaked into the release.');
  Object.assign(exportReport, { unpackedProject, checkedFiles: required.length, archiveEntries: entries.length, excludesTestData: true });
  // The existing ZIP stays untouched; only this temporary copy receives the driver.
  await fs.writeFile(path.join(unpackedProject, 'game', 'testcases.rpy'), driver);
  const tested = await runExecutable(path.join(unpackedProject, `${project.id}.exe`), ['--savedir', path.join(temporaryRoot, 'isolated-saves'), unpackedProject, 'test', '--report-detailed'], unpackedProject);
  await fs.writeFile(path.join(output, 'export-runtime.log'), tested.log);
  assertTestResult(tested);
  if (tested.log.includes('VNS_EVENT:')) throw new Error('The release executable emitted development events.');
  const finalHash = createHash('sha256').update(await fs.readFile(zipPath)).digest('hex');
  if (finalHash !== originalHash) throw new Error('Windows ZIP changed while testing its extracted copy.');
  Object.assign(exportReport, { passed: true, testCases: 14, assertions: 40, archiveUnchanged: true, screenshots: path.join(unpackedProject, 'tests', 'screenshots') });
}

await fs.mkdir(output, { recursive: true });
const report: Record<string, unknown> = { passed: false, output, runtime: sdkRoot };
try {
  await fs.writeFile(path.join(output, 'project.vns.json'), JSON.stringify(project, null, 2));
  const build = await buildProject({ project, projectDir: exampleDir, sdkRoot, outputDir: output, development: true });
  await fs.writeFile(path.join(output, 'build.log'), build.log + JSON.stringify(build.diagnostics));
  if (!build.ok) throw new Error(`Build failed: ${build.log}\n${JSON.stringify(build.diagnostics)}`);
  await fs.writeFile(path.join(output, 'game', 'testcases.rpy'), driver);
  const tested = await runRenpy(sdkRoot, output, ['test', '--report-detailed'], { savedir: path.join(output, 'isolated-saves'), timeoutMs: 180_000, onData: value => process.stdout.write(value) });
  await fs.writeFile(path.join(output, 'runtime.log'), tested.log);
  assertTestResult(tested);
  if (process.argv.includes('--export')) await verifyExport(report);
  report.passed = true;
  report.testCases = 14;
  report.assertions = 40;
  report.scenarios = ['hotspot click/timeout/cancel', 'Chinese password success/failure/cancel', 'timed clicks success/failure/cancel', 'save/load remaining attempts, clicks and timer', 'native save/load UI with paused timer', 'reentry resets attempts, clicks and timers', 'character animation and reusable camera effect'];
} catch (error) { report.error = String(error); process.exitCode = 1; }
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
