import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { expect } from '@playwright/test';
import { createServer } from 'vite';
import { createProject } from '../src/core/model';
import { exportSettings } from '../src/core/export-settings';
import { launchDesktopFixture, installedExecutable } from './lib/desktop-fixture';
import { nativeEnvironment } from '../src/runtime/process-env';

const root = path.resolve('.'), execute = promisify(execFile);
const output = path.join(root, 'artifacts/export-setup', new Date().toISOString().replaceAll(':', '-'));
const profile = path.join(output, 'profile'), projectFile = path.join(output, 'project/project.vns.json'), distribution = path.join(output, 'distribution');
await fs.mkdir(path.dirname(projectFile), { recursive: true }); await fs.mkdir(distribution, { recursive: true });
const project = createProject('一键配置与导出验收');
project.exportSettings = { ...exportSettings(project), fileName: 'OneClick-Game' };
const passage = project.nodes.find(node => node.kind === 'passage')!;
passage.lines = [{ id: 'setup_line_1', text: '一键配置之后，游戏可以独立运行。', actions: [] }, { id: 'setup_line_2', text: '存档读取后仍然继续这一段故事。', actions: [] }];
await fs.writeFile(projectFile, JSON.stringify(project));
const server = installedExecutable ? undefined : await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } });
await server?.listen();
const app = await launchDesktopFixture({ root, profile, projectFile, devUrl: server ? `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}` : undefined });
const page = await app.firstWindow(), errors: string[] = [], checks: string[] = [];
page.on('pageerror', error => errors.push(error.message));
let phase = 'one-click setup';
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1480, 1000));
  await page.locator('.export-button').click();
  await expect(page.getByRole('button', { name: '一键配置', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '一键配置', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '导出环境已就绪' })).toBeVisible({ timeout: 180_000 });
  const environment = await page.evaluate(() => window.studio!.environment());
  assert.ok(environment.sdkPath?.toLowerCase().startsWith(profile.toLowerCase()));
  await fs.access(path.join(environment.sdkPath!, '.ready'));
  await expect(page.getByRole('button', { name: '选择目录并导出', exact: true })).toBeEnabled();
  await page.screenshot({ path: path.join(output, 'windows-ready.png') });
  checks.push('真实桌面按钮准备私有运行时，复检成功后启用导出。');

  phase = 'Android consent guard';
  await page.getByRole('button', { name: /^Android APK/ }).click();
  await expect(page.getByRole('button', { name: '重新检查', exact: true })).toBeEnabled({ timeout: 20_000 });
  const consent = page.getByRole('checkbox', { name: /我已阅读并同意/ });
  await expect(consent).not.toBeChecked();
  await expect(page.getByRole('button', { name: '一键配置', exact: true })).toBeDisabled();
  await page.screenshot({ path: path.join(output, 'android-consent.png') });
  checks.push('Android 首次配置明确显示许可链接；未同意时不下载、不接受许可。');

  phase = 'real Windows export';
  await page.getByRole('button', { name: /^Windows 64/ }).click();
  await expect(page.getByRole('button', { name: '选择目录并导出', exact: true })).toBeEnabled();
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, distribution);
  await page.getByRole('button', { name: '选择目录并导出', exact: true }).click();
  const zip = path.join(distribution, `OneClick-Game-${project.version}-win.zip`);
  await expect.poll(async () => {
    const size = await fs.stat(zip).then(stat => stat.size, () => 0);
    const failures = await page.locator('.diagnostic.error').allTextContents();
    assert.ok(!failures.length, failures.join('\n'));
    return size;
  }, { timeout: 180_000, intervals: [1000, 2000] }).toBeGreaterThan(1_000_000);
  await expect(page.locator('.export-button')).toBeEnabled({ timeout: 60_000 });
  checks.push('由真实设置页进入正式编译与打包，生成 Windows 游戏 ZIP。');
  const sha256 = createHash('sha256').update(await fs.readFile(zip)).digest('hex');
  const unpacked = path.join(output, 'standalone');
  await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName System.IO.Compression.FileSystem\n[System.IO.Compression.ZipFile]::ExtractToDirectory($env:VNS_SETUP_ZIP, $env:VNS_SETUP_UNPACK)'], { windowsHide: true, env: { ...process.env, VNS_SETUP_ZIP: zip, VNS_SETUP_UNPACK: unpacked }, timeout: 180_000 });
  const folder = (await fs.readdir(unpacked, { withFileTypes: true })).find(entry => entry.isDirectory())!;
  const game = path.join(unpacked, folder.name), exe = path.join(game, 'OneClick-Game.exe');
  await fs.access(exe);
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), `testsuite global:
    before testcase:
        $ _test.timeout = 20
        $ preferences.text_cps = 0
    teardown:
        exit
testcase one_click_game:
    assert screen "main_menu"
    run Start()
    advance until "一键配置之后，游戏可以独立运行。"
    run FileSave("oneclick", confirm=False, slot=True)
    assert eval renpy.can_load("oneclick")
    advance until "存档读取后仍然继续这一段故事。"
    run FileLoad("oneclick", confirm=False, slot=True)
    assert "一键配置之后，游戏可以独立运行。"
    run MainMenu(confirm=False)
    assert screen "main_menu"
`);
  phase = 'standalone executable';
  let log = '';
  const code = await new Promise<number>((resolve, reject) => {
    const env = nativeEnvironment({ PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' });
    const child = spawn(exe, ['--savedir', path.join(output, 'game-saves'), game, 'test', '--report-detailed'], { cwd: game, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill(), 90_000);
    child.stdout.on('data', data => { log += data.toString(); }); child.stderr.on('data', data => { log += data.toString(); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve(code ?? 1); });
  });
  await fs.writeFile(path.join(output, 'standalone.log'), log);
  assert.equal(code, 0, log.slice(-5000)); assert.match(log, /4 passed/);
  assert.deepEqual(errors, []);
  checks.push('解压后的游戏 EXE 使用系统 PATH 启动，标题、推进、存档、读取与返回标题通过。');
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, environment, zip, sha256, exe, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, errors, error: String(error) }, null, 2));
  console.error(phase + ': ' + String(error).slice(0, 1800)); process.exitCode = 1;
} finally { await app.close(); await server?.close(); }
console.log('REPORT ' + path.join(output, 'report.json'));
