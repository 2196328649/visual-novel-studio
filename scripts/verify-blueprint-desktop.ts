import { openStoryMode } from './lib/story-workspace';
import { _electron as electron, expect, type ElectronApplication } from '@playwright/test';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { assetFiles, projectSchema } from '../src/core/model';
import { version as studioVersion } from '../package.json';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packaged = process.argv.includes('--packaged');
const output = path.join(root, 'artifacts', packaged ? 'blueprint-packaged-verification' : 'blueprint-desktop-verification', new Date().toISOString().replaceAll(':', '-'));
const deployment = packaged ? path.resolve(process.env.VNS_BLUEPRINT_VERIFY_ROOT ?? 'E:/VNS-Blueprint-Verification', randomUUID().slice(0, 8)) : undefined;
const input = path.join(deployment ?? output, 'input');
const userData = deployment ? path.join(deployment, 'profile') : path.join(os.tmpdir(), `vns-bp-${randomUUID().slice(0, 8)}`);
const exportsDir = path.join(deployment ?? output, 'exports');
const templateFile = path.join(deployment ?? output, 'aihong', 'project.vns.json');
const binaries: Record<string, string> = {};
const checks: string[] = [];
const errors: string[] = [];
let application: ElectronApplication | undefined;
async function run(executable: string, args: string[], cwd: string, extraEnv: Record<string, string> = {}) {
  return new Promise<{ code: number; log: string }>((resolve, reject) => {
    const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...extraEnv };
    const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; const timer = setTimeout(() => child.kill(), 180000);
    child.stdout?.on('data', data => { log += String(data); }); child.stderr?.on('data', data => { log += String(data); });
    child.on('error', error => { clearTimeout(timer); reject(error); }); child.on('close', code => { clearTimeout(timer); resolve({ code: code ?? 1, log }); });
  });
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  const verificationRoot = path.join(root, 'artifacts', 'blueprint-editor-verification');
  const candidates = (await fs.readdir(verificationRoot)).sort().reverse();
  let authoredPath: string | undefined;
  for (const candidate of candidates) {
    const report = await fs.readFile(path.join(verificationRoot, candidate, 'report.json'), 'utf8').then(JSON.parse).catch(() => undefined);
    if (report?.status === 'passed') { authoredPath = path.join(verificationRoot, candidate, 'saved-project.json'); break; }
  }
  if (!authoredPath) throw new Error('Run verify-blueprint-editor.ts successfully first.');
  const project = projectSchema.parse(JSON.parse(await fs.readFile(authoredPath, 'utf8')));
  const macro = project.blueprints!.find(graph => graph.name === '晨间问候')!;
  const caller = project.blueprints!.find(graph => graph.nodes.some(node => node.type === 'callMacro' && node.properties.graphId === macro.id))!;
  const call = caller.nodes.find(node => node.type === 'callMacro')!;
  const passage = project.nodes.find(node => node.kind === 'passage' && node.lines.length)!;
  if (passage.kind !== 'passage') throw new Error('No opening passage.');
  await fs.cp(path.join(root, 'resources', 'example'), input, { recursive: true });
  const projectFile = path.join(input, 'project.vns.json');
  await fs.writeFile(projectFile, JSON.stringify(project, null, 2));
  if (deployment) {
    await fs.cp(path.join(root, 'release', 'win-unpacked'), path.join(deployment, 'Studio'), { recursive: true });
    await fs.mkdir(userData, { recursive: true }); await fs.mkdir(exportsDir, { recursive: true });
    await fs.writeFile(path.join(userData, 'workspace.json'), JSON.stringify({ path: projectFile }));
    for (const file of ['Visual Novel Studio.exe', 'resources/app.asar']) binaries[file] = createHash('sha256').update(await fs.readFile(path.join(deployment, 'Studio', file))).digest('hex');
  }
  application = await electron.launch({ executablePath: deployment ? path.join(deployment, 'Studio', 'Visual Novel Studio.exe') : require('electron'), args: deployment ? [`--user-data-dir=${userData}`] : [root], cwd: deployment ?? root,
    env: { ...process.env, VNS_DEV_URL: deployment ? 'http://127.0.0.1:1' : '', VNS_PROJECT_PATH: deployment ? path.join(deployment, 'missing-project') : projectFile, VNS_TEST_ROOT: output, VNS_USER_DATA: userData, VNS_RENPY_SDK: path.join(deployment ?? root, deployment ? 'missing-sdk' : 'resources/runtime') }, timeout: 120000 });
  if (deployment) {
    const environment = await application.evaluate(({ app }) => ({ packaged: app.isPackaged, userData: app.getPath('userData'), appPath: app.getAppPath(), version: app.getVersion() }));
    expect(environment.packaged).toBe(true); expect(path.resolve(environment.userData)).toBe(path.resolve(userData)); expect(environment.appPath.startsWith(root)).toBe(false);
    expect(environment.version).toBe(studioVersion);
    await fs.writeFile(path.join(output, 'environment.json'), JSON.stringify(environment, null, 2));
    // Only native file/directory choices are supplied by this test. The packaged
    // renderer, IPC, project store, private runtime and exporter are unchanged.
    await application.evaluate(({ dialog }, exportsDir) => {
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const options = args.at(-1) as { title?: string };
        if (options.title !== '选择游戏导出目录') throw new Error(`Unexpected directory dialog: ${options.title}`);
        return { canceled: false, filePaths: [exportsDir] };
      }) as typeof dialog.showOpenDialog;
    }, exportsDir);
    await application.evaluate(({ dialog }, templateFile) => {
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const options = args.at(-1) as { title?: string };
        if (options.title !== '创建哀鸿界面工程') throw new Error(`Unexpected save dialog: ${options.title}`);
        return { canceled: false, filePath: templateFile };
      }) as typeof dialog.showSaveDialog;
    }, templateFile);
    checks.push('Packaged application launched outside the SDK/source tree and ignored invalid development environment paths; only native file and directory choices are supplied by the test.');
  }
  const page = await application.firstWindow({ timeout: 120000 }); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 720));
  await page.getByRole('button', { name: '蓝图', exact: true }).click(); await page.getByLabel('蓝图类型').selectOption('graph');
  await page.getByLabel('演出目标').selectOption('graph:' + caller.id);
  await page.locator(`.react-flow__node[data-id="${call.id}"]`).click();
  await page.getByLabel('节奏秒数', { exact: true }).fill('0.04');
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  let saved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  expect(saved.blueprints!.find(graph => graph.id === caller.id)!.nodes.find(node => node.id === call.id)!.properties[`arg_${macro.exposedInputs[0].id}`]).toBe(0.04);
  await page.screenshot({ path: path.join(output, 'desktop-blueprint.png') });
  checks.push('Bundled Electron renderer edited a typed Chinese macro parameter and saved it through native IPC.');

  await openStoryMode(page, 'script');
  await page.locator(`#line-${passage.lines[0].id} textarea`).click();
  await page.getByLabel('添加演出动作', { exact: true }).selectOption('blueprint');
  await page.getByLabel('通用蓝图', { exact: true }).selectOption(caller.id);
  await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
  saved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  const savedPassage = saved.nodes.find(node => node.id === passage.id)!;
  expect(savedPassage.kind === 'passage' && savedPassage.lines[0].actions.some(action => action.kind === 'blueprint' && action.blueprintId === caller.id)).toBe(true);
  await page.reload(); await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await page.locator(`#line-${passage.lines[0].id} textarea`).click();
  await expect(page.getByLabel('通用蓝图', { exact: true })).toHaveValue(caller.id);
  checks.push('A reusable blueprint was attached to dialogue through Chinese controls, saved on disk and reopened.');

  await page.getByRole('button', { name: '试玩', exact: true }).click();
  await expect(page.locator('.status-message')).toContainText('试玩已启动', { timeout: 90000 });
  checks.push('Native preview compiled and launched the newest authored blueprint project.');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  await page.getByRole('dialog', { name: '作品设置', exact: true }).getByRole('button', { name: '选择目录并导出', exact: true }).click();
  await expect(page.locator('.status-message')).toContainText('游戏已导出', { timeout: 300000 });
  expect(errors).toEqual([]);
  const zip = path.join(exportsDir, `${saved.id}-${saved.version}-win.zip`); await fs.access(zip);
  checks.push('The desktop export button produced a standalone Windows ZIP using the saved typed graph.');

  if (deployment) {
    if (await page.getByRole('button', { name: '关闭问题面板', exact: true }).count()) await page.getByRole('button', { name: '关闭问题面板', exact: true }).click();
    await page.getByRole('button', { name: '新建工程', exact: true }).click();
    await page.getByLabel('工程模板', { exact: true }).selectOption('aihong');
    await page.getByLabel('作品名称', { exact: true }).fill('哀鸿 · 桌面工作台验证');
    await page.getByRole('button', { name: '创建作品', exact: true }).click();
    await expect(page.locator('.project-title strong')).toHaveText('哀鸿 · 桌面工作台验证');
    const preset = projectSchema.parse(JSON.parse(await fs.readFile(templateFile, 'utf8')));
    expect(preset.chapters).toHaveLength(2); expect(preset.scenes).toHaveLength(6); expect(preset.nodes).toHaveLength(30);
    expect(preset.nodes.filter(node => node.kind === 'end')).toHaveLength(3);
    expect(preset.contentBrowser!.folders.length).toBeGreaterThan(5);
    for (const relative of preset.assets.flatMap(assetFiles)) await fs.access(path.join(path.dirname(templateFile), relative));
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
    await page.keyboard.press('Control+Space');
    await expect(page.getByRole('region', { name: '资源管理器' })).toBeVisible();
    await page.getByLabel('搜索资源和蓝图').fill('方院 · 雨天');
    const home = page.locator('[data-content-key="asset:ai_story_home"]'); await home.click();
    await expect.poll(() => home.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.locator('.content-toolbar').getByRole('button', { name: '新建', exact: true }).click();
    await page.locator('.content-create-menu').getByRole('button', { name: '文件夹', exact: true }).click();
    await page.getByLabel('内容名称').fill('桌面归档');
    await page.locator('.content-dialog').getByRole('button', { name: '确定', exact: true }).click();
    await page.getByLabel('移动所选资源到文件夹').selectOption({ label: '桌面归档' });
    await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
    const organized = projectSchema.parse(JSON.parse(await fs.readFile(templateFile, 'utf8')));
    expect(organized.contentBrowser!.assignments['asset:ai_story_home']).toBe(organized.contentBrowser!.folders.find(folder => folder.name === '桌面归档')!.id);
    expect(organized.assets).toEqual(preset.assets);
    await page.reload(); await expect(page.locator('.project-title strong')).toHaveText(preset.name);
    await page.keyboard.press('Control+Space');
    await expect(page.getByRole('navigation', { name: '资源文件夹' })).toContainText('桌面归档');
    await page.getByRole('button', { name: '所有蓝图', exact: true }).click();
    await page.locator('[data-content-key="blueprint:ai_bp_banquet"]').dblclick();
    await expect(page.getByLabel('演出目标')).toHaveValue('graph:' + 'ai_bp_banquet');
    await expect(page.locator('.blueprint-palette')).not.toBeVisible();
    await page.getByRole('button', { name: '框选全部节点', exact: true }).click();
    let previousTransform = '';
    await expect.poll(async () => {
      const current = await page.locator('.react-flow__viewport').evaluate(element => getComputedStyle(element).transform);
      const stopped = current === previousTransform; previousTransform = current; return stopped;
    }, { intervals: [100, 200, 400] }).toBe(true);
    const edge = page.locator('.react-flow__edge').first(), edgeCount = await page.locator('.react-flow__edge').count(), nodeCount = await page.locator('.react-flow__node').count();
    const point = await edge.locator('.react-flow__edge-path').evaluate(element => {
      const line = element as SVGPathElement, midpoint = line.getTotalLength() / 2, matrix = line.getScreenCTM()!;
      const here = line.getPointAtLength(midpoint).matrixTransform(matrix), ahead = line.getPointAtLength(midpoint + 1).matrixTransform(matrix);
      const dx = ahead.x - here.x, dy = ahead.y - here.y, length = Math.hypot(dx, dy) || 1;
      return { x: here.x - dy / length * 10, y: here.y + dx / length * 10 };
    });
    await page.mouse.click(point.x, point.y); await expect(edge).toHaveClass(/selected/);
    await page.keyboard.press('Delete'); await expect(page.locator('.react-flow__edge')).toHaveCount(edgeCount - 1);
    await expect(page.locator('.react-flow__node')).toHaveCount(nodeCount);
    await page.keyboard.press('Control+z'); await expect(page.locator('.react-flow__edge')).toHaveCount(edgeCount);
    await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
    await page.screenshot({ path: path.join(output, 'packaged-aihong-workbench.png') });
    checks.push('Packaged 1.1 template created two chapters, six scenes and three endings with every bundled asset; native resource organization survived reload, previews loaded, and wide wire selection/delete/undo worked.');
    await page.getByRole('button', { name: '试玩', exact: true }).click();
    await expect(page.locator('.status-message')).toContainText('试玩已启动', { timeout: 90000 });
    expect(errors).toEqual([]);
    checks.push('The new two-chapter Aihong template compiled and launched through the packaged application and its private runtime.');
  }
  await application.close(); application = undefined;

  const unpackRoot = path.join(deployment ?? output, 'unpacked');
  const unpack = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:VNS_BP_ZIP, $env:VNS_BP_UNPACK)"], root, { VNS_BP_ZIP: zip, VNS_BP_UNPACK: unpackRoot });
  await fs.writeFile(path.join(output, 'unpack.log'), unpack.log); expect(unpack.code).toBe(0);
  const game = path.join(unpackRoot, (await fs.readdir(unpackRoot, { withFileTypes: true })).find(entry => entry.isDirectory())!.name);
  const story = await fs.readFile(path.join(game, 'game', 'story.rpy'), 'utf8');
  expect(story).toContain(`call vn_blueprint_${macro.id}(0.04, False)`); expect(story).not.toContain('VNS_EVENT:');
  const audio = saved.assets.find(asset => asset.kind === 'audio')!;
  await fs.writeFile(path.join(game, 'game', 'testcases.rpy'), `testsuite global:
    before testcase:
        $ _test.timeout = 12.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        if not screen "main_menu":
            run MainMenu(confirm=False)
    teardown:
        exit

testcase desktop_authored_blueprint_in_exported_game:
    click id "vn_main_start"
    advance until ${JSON.stringify(passage.lines[0].text)}
    assert eval (vn_current_line == ${JSON.stringify(passage.lines[0].id)})
    assert eval (renpy.music.get_playing(channel="sound") == ${JSON.stringify(audio.path.replaceAll('\\', '/'))})
    screenshot "desktop-authored-blueprint.png"
    run FileSave("desktop_blueprint", confirm=False, slot=True)
    advance
    run FileLoad("desktop_blueprint", confirm=False, slot=True)
    pause until ${JSON.stringify(passage.lines[0].text)}
    assert eval (vn_current_line == ${JSON.stringify(passage.lines[0].id)})
    assert eval (renpy.music.get_playing(channel="sound") == ${JSON.stringify(audio.path.replaceAll('\\', '/'))})
    run MainMenu(confirm=False)
`);
  const tested = await run(path.join(game, `${saved.id}.exe`), ['--savedir', path.join(output, 'export-saves'), game, 'test', '--report-detailed'], game, { PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`, PYTHONHOME: '', PYTHONPATH: '', RENPY_BASE: '' });
  await fs.writeFile(path.join(output, 'export-runtime.log'), tested.log);
  expect(tested.code, tested.log.slice(-6000)).toBe(0); expect(tested.log).toMatch(/Assertions\s*:\s*4\s*\|\s*4 passed/);
  checks.push('Exported EXE ran with only system PATH, executed the UI-authored macro and sound, and passed four save/load assertions.');
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors, authoredPath, projectFile, templateFile: packaged ? templateFile : undefined, zip, game, userData, packaged, deployment, binaries, version: studioVersion }, null, 2));
  console.log(`PASS: ${checks.length} desktop checks. Report: ${path.join(output, 'report.json')}`);
}
try { await main(); } catch (error) {
  await fs.mkdir(output, { recursive: true });
  if (application) await (await application.firstWindow()).screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', checks, errors, error: String(error), userData }, null, 2));
  console.error(error); console.log(`Report: ${path.join(output, 'report.json')}`); process.exitCode = 1;
} finally { await application?.close(); }
