import assert from 'node:assert/strict';
import { createReadStream, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { _electron as electron, expect } from '@playwright/test';
import { nativeEnvironment } from '../src/runtime/process-env';
import { projectFolderName } from '../src/core/project-templates';
import { openStoryMode } from './lib/story-workspace';
import { singleExeMagic } from '../src/runtime/single-exe';

const root = path.resolve('.'), execute = promisify(execFile);
const version = JSON.parse(await fs.readFile('package.json', 'utf8')).version;
const archive = path.resolve('release', `Visual-Novel-Studio-${version}-portable-win-x64.zip`);
const hash = createHash('sha256'); for await (const bytes of createReadStream(archive)) hash.update(bytes); const packageSha256 = hash.digest('hex');
const output = path.resolve('artifacts/v08-portable', new Date().toISOString().replaceAll(':', '-'));
const run = await fs.mkdtemp('E:/VNS08Portable-'); await fs.mkdir(output, { recursive: true });
await execute(path.resolve('artifacts/builder-cache/7zip@1.0.0/7zip-win-x64-a34pt/bin/7za.exe'), ['x', '-y', '-o' + run, path.resolve('release', `Visual-Novel-Studio-${version}-portable-win-x64.zip`)], { windowsHide: true });
let directory = path.join(run, `Visual-Novel-Studio-${version}`);
const name = '便携版验收', marker = '移动便携目录后依旧保存的台词。', projects = path.join(run, '作品');
const projectFile = path.join(projects, projectFolderName(name), 'project.vns.json');
const errors: string[] = [], checks: string[] = [];
async function launch() {
  const app = await electron.launch({ executablePath: path.join(directory, 'Visual Novel Studio.exe'), args: [], cwd: directory,
    env: nativeEnvironment({ PATH: `${process.env.SystemRoot}/System32;${process.env.SystemRoot}`, VNS_USER_DATA: path.join(run, 'ignored-profile'), VNS_RENPY_SDK: path.join(run, 'ignored-sdk'), VNS_DEV_URL: 'http://127.0.0.1:1' }), timeout: 120000 });
  const actual = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, data: app.getPath('userData'), version: app.getVersion() }));
  assert.equal(actual.packaged, true); assert.equal(actual.version, version); assert.equal(actual.data.toLowerCase(), path.join(directory, 'data').toLowerCase());
  const page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  await app.evaluate(({ BrowserWindow, shell }) => { BrowserWindow.getAllWindows()[0].setContentSize(1440, 960); (globalThis as any).qaOpened = []; shell.openPath = async file => { (globalThis as any).qaOpened.push(file); return ''; }; });
  return { app, page };
}
let { app, page } = await launch(), phase = 'create';
try {
  await expect(page.getByLabel('新项目名称', { exact: true })).toBeVisible({ timeout: 45000 });
  await page.getByLabel('新项目名称', { exact: true }).fill(name);
  await page.getByLabel('新项目保存位置', { exact: true }).fill(projects);
  await page.getByRole('button', { name: '创建并打开项目', exact: true }).click();
  await expect(page.locator('.project-title strong')).toHaveText(name, { timeout: 45000 });
  await openStoryMode(page, 'script'); await page.getByLabel('第1行对白', { exact: true }).fill(marker);
  await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
  assert.ok((await fs.readFile(projectFile, 'utf8')).includes(marker));
  await page.screenshot({ path: path.join(output, 'created.png') });
  checks.push('源码目录外，仅系统 PATH 启动；项目窗口创建并保存中文工程，数据写入便携目录。');
  await app.close(); phase = 'move and reopen';
  const moved = path.join(run, '移动后的叙事工坊');
  for (const candidate of [directory, moved]) assert.ok(path.resolve(candidate).startsWith(path.resolve(run) + path.sep));
  await fs.rename(directory, moved); directory = moved;
  ({ app, page } = await launch());
  await expect(page.locator('.recent-project-open').filter({ hasText: name })).toBeVisible({ timeout: 45000 });
  await page.locator('.recent-project-open').filter({ hasText: name }).click();
  await expect(page.locator('.project-title strong')).toHaveText(name); await openStoryMode(page, 'script');
  await expect(page.getByLabel('第1行对白', { exact: true })).toHaveValue(marker);
  checks.push('移动整个便携目录后，最近工程与已保存台词恢复，运行时路径不依赖原位置。');
  phase = 'single EXE export';
  const destination = path.join(run, '导出');
  await page.locator('.export-button').click(); const settings = page.getByRole('dialog', { name: '作品设置', exact: true });
  await settings.getByLabel('Windows 打包格式', { exact: true }).selectOption('exe');
  await settings.getByLabel('导出文件位置', { exact: true }).fill(path.join(destination, 'PortableStory')); await settings.getByLabel('导出文件位置', { exact: true }).press('Tab');
  await expect(settings.getByRole('button', { name: '导出', exact: true })).toBeEnabled({ timeout: 60000 });
  await settings.getByRole('button', { name: '导出', exact: true }).click();
  await expect.poll(() => app.evaluate(() => (globalThis as any).qaOpened), { timeout: 180000, intervals: [1000, 2000] }).toEqual([destination]);
  const packages = await fs.readdir(destination); assert.equal(packages.length, 1); assert.ok(packages[0].endsWith('.exe'));
  const game = path.join(destination, packages[0]), file = await fs.open(game, 'r');
  try { const size = (await file.stat()).size; assert.ok(size > 1000000); const magic = Buffer.alloc(singleExeMagic.length); await file.read(magic, 0, magic.length, size - magic.length); assert.equal(magic.toString(), singleExeMagic); } finally { await file.close(); }
  await page.screenshot({ path: path.join(output, 'portable-exported-exe.png') });
  checks.push('从移动后的便携编辑器实际导出单 EXE，只生成一个游戏文件，并打开目标目录。');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', version, run, archive, packageSha256, projectFile, game, checks, errors }, null, 2));
} catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, error: String(error), errors }, null, 2)); throw error; }
finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close().catch(() => {}); console.log(output); }
