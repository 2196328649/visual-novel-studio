import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject } from '../src/core/model';
import { projectToText } from '../src/core/text-script';
import { saveProject } from '../src/desktop/project-store';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), require = createRequire(import.meta.url);
const output = path.join(root, 'artifacts/export-settings', new Date().toISOString().replaceAll(':', '-'));
const directory = path.join(output, 'project'), projectFile = path.join(directory, 'project.vns.json');
await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
const icon = new PNG({ width: 96, height: 96 });
for (let at = 0; at < icon.data.length; at += 4) { icon.data[at] = 85; icon.data[at + 1] = 174; icon.data[at + 2] = 163; icon.data[at + 3] = 255; }
await fs.writeFile(path.join(directory, 'assets/icon.png'), PNG.sync.write(icon));
const project = createProject('导出设置桌面验证');
project.assets = [{ id: 'icon', name: '示例游戏图标', kind: 'image', category: 'ui', path: 'assets/icon.png', width: 96, height: 96 }];
project.characters = [{ id: 'sui', name: '穗', color: '#aaddcc', expressions: [{ id: 'normal', name: '通常', assetId: 'icon' }] }];
project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
await saveProject(projectFile, project);
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } });
await server.listen();
const env = Object.fromEntries(Object.entries({ ...process.env, VNS_PROJECT_PATH: projectFile, VNS_USER_DATA: path.join(output, 'profile'), VNS_DEV_URL: `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}` }).filter((entry): entry is [string, string] => entry[1] !== undefined));
delete env.ELECTRON_RUN_AS_NODE; delete env.VNS_TEST_ROOT;
let app: ElectronApplication | undefined, page: Page | undefined;
const checks: string[] = [], errors: string[] = [];
async function launch() {
  app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env });
  // The real UI and IPC are exercised, but no build process can run in this test.
  await app.evaluate(({ ipcMain }) => {
    (globalThis as any).__exportRequests = [];
    ipcMain.removeHandler('studio:export');
    ipcMain.handle('studio:export', (_event, project) => {
      (globalThis as any).__exportRequests.push(project);
      return { ok: true, diagnostics: [], log: '模拟导出入口：没有启动构建工具。' };
    });
    ipcMain.removeHandler('studio:preview');
    ipcMain.handle('studio:preview', () => { throw new Error('This verification must not launch a game.'); });
  });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 960));
}
try {
  await launch();
  await openStoryMode(page!, 'text');
  const input = page!.getByLabel('中文文本剧本', { exact: true }), original = await input.inputValue();
  await input.fill(original + '\n# 段落：指令测试\n/');
  const commands = page!.getByRole('dialog', { name: '中文指令面板', exact: true });
  await expect(commands.getByRole('button', { name: '角色', exact: true })).toHaveCount(0);
  await commands.getByRole('button', { name: '显示角色', exact: true }).click();
  const parameters = page!.getByRole('dialog', { name: '命令参数', exact: true });
  await parameters.getByLabel('纵向位置', { exact: true }).fill('1.2');
  await parameters.getByLabel('缩放', { exact: true }).fill('0.4');
  await parameters.getByRole('button', { name: '插入指令', exact: true }).click();
  expect(await input.inputValue()).toContain('@显示角色：穗，通常，0.5，0.4，1.2');
  await input.fill(original + '\n@xsjs');
  await input.press('Control+End'); await input.press('Control+Space');
  const completions = page!.getByRole('listbox', { name: '文本补全建议', exact: true });
  await expect(completions.getByText('显示角色', { exact: true })).toBeVisible();
  await expect(completions.getByText('角色', { exact: true })).toHaveCount(0);
  await input.press('Escape'); await input.fill(original);
  checks.push('插入面板只保留显示角色；纵向位置、缩放和拼音首字母补全继续可用。');

  await page!.locator('.export-button').click();
  let settings = page!.getByRole('dialog', { name: '作品设置', exact: true });
  await expect(settings.getByRole('heading', { name: '游戏导出', exact: true })).toBeVisible();
  expect(await app!.evaluate(() => (globalThis as any).__exportRequests.length)).toBe(0);
  await settings.getByLabel('导出文件位置', { exact: true }).fill('AihongDemo');
  await settings.getByLabel('游戏版本', { exact: true }).fill('2.3.4');
  await settings.getByRole('button', { name: '浏览游戏图标', exact: true }).click();
  const picker = page!.getByRole('dialog', { name: '游戏图标资源浏览器', exact: true });
  await picker.getByRole('button', { name: '预览资源 示例游戏图标', exact: true }).click();
  await expect(picker.locator('.asset-picker-large img')).toBeVisible();
  await picker.getByRole('button', { name: '使用所选资源', exact: true }).click();
  await expect(settings.getByLabel('游戏图标', { exact: true })).toHaveValue('icon');
  await expect(settings.getByRole('button', { name: '导出', exact: true })).toBeEnabled();
  await settings.screenshot({ path: path.join(output, 'windows-settings.png') });
  checks.push('顶部导出先打开设置；Windows 文件名、版本和带预览的图标选择可编辑，打开设置没有触发导出。');

  await settings.getByRole('button', { name: /^Android APK/ }).click();
  await settings.getByLabel('安装包格式', { exact: true }).selectOption('aab');
  await settings.getByLabel('Android 包名', { exact: true }).fill('com.example.aihong');
  await settings.getByLabel('屏幕方向', { exact: true }).selectOption('portrait');
  await settings.getByLabel('版本代码下限', { exact: true }).fill('2026');
  await settings.getByLabel('允许联网', { exact: true }).check();
  await expect(settings.getByRole('button', { name: '重新检查', exact: true })).toBeEnabled({ timeout: 20_000 });
  const actualEnvironment = await settings.getByRole('list', { name: '导出环境检查', exact: true }).innerText();
  expect(actualEnvironment).toContain('Android 打包工具');
  await settings.getByLabel('Android 包名', { exact: true }).fill('com.错误');
  await expect(settings.getByRole('alert')).toContainText('Android 包名');
  await expect(settings.getByRole('button', { name: '导出', exact: true })).toBeDisabled();
  await settings.getByLabel('Android 包名', { exact: true }).fill('com.example.aihong');
  await expect(settings.getByRole('button', { name: '重新检查', exact: true })).toBeEnabled({ timeout: 20_000 });
  await settings.screenshot({ path: path.join(output, 'android-settings.png') });
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect.poll(async () => JSON.parse(await fs.readFile(projectFile, 'utf8')).exportSettings?.android.packageName).toBe('com.example.aihong');
  const saved = JSON.parse(await fs.readFile(projectFile, 'utf8'));
  expect(saved.exportSettings.android).toMatchObject({ format: 'aab', orientation: 'portrait', versionCode: 2026, internet: true });
  expect(saved.exportSettings.fileName).toBe('AihongDemo'); expect(saved.exportSettings.iconAssetId).toBe('icon'); expect(saved.version).toBe('2.3.4');
  checks.push('Android APK/AAB、包名、方向、版本代码和权限保存到工程；错误包名禁用导出，环境状态来自真实只读检查。');

  await app!.close(); app = undefined; await launch();
  await page!.locator('.export-button').click(); settings = page!.getByRole('dialog', { name: '作品设置', exact: true });
  await expect(settings.getByLabel('安装包格式', { exact: true })).toHaveValue('aab');
  await expect(settings.getByLabel('Android 包名', { exact: true })).toHaveValue('com.example.aihong');
  await expect(settings.getByLabel('屏幕方向', { exact: true })).toHaveValue('portrait');
  await expect(settings.getByLabel('允许联网', { exact: true })).toBeChecked();
  await expect(settings.getByLabel('游戏图标', { exact: true })).toHaveValue('icon');
  await app!.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('studio:export-check');
    ipcMain.handle('studio:export-check', (_event, project) => ({ platform: project.exportSettings?.platform ?? 'windows', ready: true, diagnostics: [], checks: [{ id: 'test', label: '测试环境', status: 'ready', detail: '仅验证参数传递，实际打包入口已隔离。' }] }));
  });
  await expect(settings.getByRole('button', { name: '重新检查', exact: true })).toBeEnabled({ timeout: 20_000 });
  await settings.getByRole('button', { name: '重新检查', exact: true }).click();
  await settings.getByRole('button', { name: '导出', exact: true }).click();
  await expect.poll(() => app!.evaluate(() => (globalThis as any).__exportRequests.length)).toBe(1);
  let requests = await app!.evaluate(() => (globalThis as any).__exportRequests);
  expect(requests[0].exportSettings).toMatchObject(saved.exportSettings);
  await page!.locator('.export-button').click(); settings = page!.getByRole('dialog', { name: '作品设置', exact: true });
  await settings.getByRole('button', { name: /^Windows 64/ }).click();
  await expect(settings.getByLabel('导出文件位置', { exact: true })).toHaveValue('AihongDemo');
  await settings.getByRole('button', { name: '导出', exact: true }).click();
  await expect.poll(() => app!.evaluate(() => (globalThis as any).__exportRequests.length)).toBe(2);
  requests = await app!.evaluate(() => (globalThis as any).__exportRequests);
  expect(requests[1].exportSettings.platform).toBe('windows');
  expect(await fs.stat(path.join(output, 'profile/builds')).then(() => true).catch(() => false)).toBe(false);
  checks.push('关闭并重新打开桌面编辑器后配置一致；模拟导出收到选中的平台与全部配置，没有启动编译或打包。');
  expect(errors).toEqual([]);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, actualPackaging: false, output, checks, actualEnvironment, requests: requests.map((request: typeof project) => request.exportSettings), errors }, null, 2));
  console.log(`PASS: ${checks.length} export/settings checks; no game packages built. ${output}`);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'failure.txt'), String(error)); console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
} finally { await app?.close(); await server.close(); }
