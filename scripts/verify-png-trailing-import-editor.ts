import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { createProject, type Project } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Run only after the complete implementation, shared tests and editor build.
// The optional original-image.png evidence is read locally; never open the
// author's project. Default runs use a small synthetic PNG with trailing bytes.
if (process.env.VNS_INSTALLED_EXE) throw new Error('请使用隔离的源码构建版验收。');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(path.resolve(process.cwd()).toLowerCase(), root.toLowerCase());
const permitted = path.join(root, 'artifacts/png-trailing-import-2026-11-14');
const output = path.join(permitted, 'editor', `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
const projectDir = path.join(output, 'project'), profile = path.join(output, 'profile');
const projectFile = path.join(projectDir, 'project.vns.json');
const evidence = path.join(output, 'evidence'), screenshots = path.join(output, 'screenshots');
const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

async function prepareOutput() {
  const workspace = await fs.realpath(root);
  let current = root;
  for (const part of path.relative(root, output).split(path.sep)) {
    current = path.join(current, part);
    const info = await fs.lstat(current).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (current === output) assert.equal(info, undefined, '每次验收使用全新目录。');
    if (info) assert.ok(info.isDirectory() && !info.isSymbolicLink());
    else await fs.mkdir(current);
    assert.ok(inside(workspace, await fs.realpath(current)));
  }
  await fs.mkdir(evidence); await fs.mkdir(screenshots);
}

function syntheticImage() {
  const image = new PNG({ width: 96, height: 144 });
  for (let y = 8; y < 136; y++) for (let x = 8; x < 88; x++) image.data.set([100, 160, 210, 255], (y * image.width + x) * 4);
  return Buffer.concat([PNG.sync.write(image), Buffer.from('\0export metadata\xff', 'latin1')]);
}

const checks: { name: string; elapsedMs: number }[] = [], errors: string[] = [], images: unknown[] = [];
const processes: { launch: number; pid?: number; exited: boolean; exitCode: number | null; signalCode: string | null }[] = [];
const report: Record<string, unknown> = { status: 'running', output, checks, errors, images, processes,
  scope: '隔离工程的原字节自动发现、缩略图和大图实际解码、保存重开及重复扫描；不读取或改写真实工程。' };
let app: ElectronApplication | undefined, page: Page | undefined, child: ChildProcess | undefined;
let traceStarted = false, imageBytes: Buffer, assetId: string, name: string, relative: string;
let beforeImageMtime: number;
const writeReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const browser = () => page!.getByRole('region', { name: '资源管理器', exact: true }).filter({ visible: true });
const card = () => browser().locator(`[data-content-key="asset:${assetId}"]`);
async function check(label: string, action: () => Promise<void>) {
  report.phase = label; const started = performance.now(); await action();
  checks.push({ name: label, elapsedMs: performance.now() - started }); await writeReport(); console.log('通过：' + label);
}
async function screenshot(label: string) {
  const result = await app!.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return window.webContents.capturePage().then(image => {
      const size = image.getSize(), scale = Math.min(1, 1280 / Math.max(size.width, size.height));
      const resized = scale < 1 ? image.resize({ width: Math.round(size.width * scale), height: Math.round(size.height * scale), quality: 'best' }) : image;
      return { bytes: resized.toPNG().toString('base64'), width: resized.getSize().width, height: resized.getSize().height };
    });
  });
  assert.ok(Math.max(result.width, result.height) <= 1280);
  const destination = path.join(screenshots, label + '.png'); await fs.writeFile(destination, Buffer.from(result.bytes, 'base64'));
  images.push({ file: path.relative(output, destination), width: result.width, height: result.height });
}
async function launch() {
  app = await launchDesktopFixture({ root, profile, projectFile }); child = app.process();
  processes.push({ launch: processes.length + 1, pid: child.pid, exited: false, exitCode: child.exitCode, signalCode: child.signalCode });
  page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText('PNG尾部数据发现验收', { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())).toLowerCase(), path.join(root, 'dist/index.html').toLowerCase());
  await page.evaluate('globalThis.__name = value => value');
  const window = await app.browserWindow(page);
  await window.evaluate(current => { if (current.isMaximized()) current.unmaximize(); current.setContentSize(1280, 900); current.show(); current.focus(); current.webContents.setBackgroundThrottling(false); });
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false }); traceStarted = true;
  await page.locator('[data-workspace-tab="assets"]').click();
  await expect(browser()).toBeVisible();
  await browser().getByLabel('资源显示范围', { exact: true }).selectOption('all');
  await browser().getByLabel('搜索资源和蓝图', { exact: true }).fill(name);
}
async function closeOwnedApp() {
  if (!app) return;
  const owned = app, ownedChild = child!;
  const failures: unknown[] = [];
  if (traceStarted) {
    try { await owned.context().tracing.stop({ path: path.join(output, `trace-${processes.length}.zip`) }); }
    catch (error) { failures.push(error); report.traceError = String(error); }
    traceStarted = false;
  }
  try { await owned.close(); }
  catch (error) { failures.push(error); }
  const exited = () => ownedChild.exitCode !== null || ownedChild.signalCode !== null;
  try { await expect.poll(exited, { timeout: 15000 }).toBe(true); }
  catch (error) { failures.push(error); }
  Object.assign(processes.at(-1)!, { exited: exited(), exitCode: ownedChild.exitCode, signalCode: ownedChild.signalCode });
  if (exited()) { app = undefined; page = undefined; child = undefined; }
  if (failures.length) throw new AggregateError(failures, '验收编辑器关闭或trace保存失败。');
}
async function assertImageUnchanged() {
  assert.deepEqual(await fs.readFile(path.join(projectDir, relative)), imageBytes);
  assert.equal((await fs.stat(path.join(projectDir, relative))).mtimeMs, beforeImageMtime);
}
async function assertPreview() {
  await expect(card()).toHaveCount(1); await card().scrollIntoViewIfNeeded();
  await expect.poll(() => card().locator('img').evaluate(image => ({ loaded: (image as HTMLImageElement).complete, width: (image as HTMLImageElement).naturalWidth }))).toEqual({ loaded: true, width: imageBytes.readUInt32BE(16) });
  await card().dblclick();
  const detail = page!.getByRole('dialog', { name: '资源详情 ' + name, exact: true }); await expect(detail).toBeVisible();
  await expect.poll(() => detail.locator('img').evaluate(image => ({ loaded: (image as HTMLImageElement).complete, width: (image as HTMLImageElement).naturalWidth, height: (image as HTMLImageElement).naturalHeight }))).toEqual({ loaded: true, width: imageBytes.readUInt32BE(16), height: imageBytes.readUInt32BE(20) });
  await screenshot('preview-' + processes.length);
  await detail.getByRole('button', { name: '关闭资源预览', exact: true }).click();
}

await prepareOutput();
try {
  imageBytes = await fs.readFile(path.join(permitted, 'original-image.png')).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return syntheticImage();
    throw error;
  });
  assert.throws(() => PNG.sync.read(imageBytes), /unrecognised content at end of stream/, '夹具必须包含旧解析器拒绝的PNG尾部数据。');
  assetId = 'asset_' + hash(imageBytes).slice(0, 24); name = assetId; relative = 'assets/未分类/' + name + '.png';
  const project = createProject('PNG尾部数据发现验收'); project.assets = []; project.characters = [];
  await saveProject(projectFile, project);
  await fs.mkdir(path.dirname(path.join(projectDir, relative)), { recursive: true }); await fs.writeFile(path.join(projectDir, relative), imageBytes);
  beforeImageMtime = (await fs.stat(path.join(projectDir, relative))).mtimeMs;
  await fs.copyFile(projectFile, path.join(evidence, 'before-discovery.project.json'));
  await fs.writeFile(path.join(evidence, 'original-image.png'), imageBytes);
  assert.equal((JSON.parse(await fs.readFile(projectFile, 'utf8')) as Project).assets.length, 0);
  report.fixture = { assetId, bytes: imageBytes.length, width: imageBytes.readUInt32BE(16), height: imageBytes.readUInt32BE(20), sha256: hash(imageBytes), relative };
  await writeReport(); await launch();

  await check('既有未登记PNG被真实自动扫描发现，缩略图加载完整原字节', async () => {
    await expect(card()).toHaveCount(1, { timeout: 30000 });
    await expect.poll(() => card().locator('img').evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    await expect(page!.locator('.dirty-dot')).toHaveCount(1); await assertImageUnchanged(); await screenshot('discovered-list');
  });
  await check('双击预览由Chromium实际显示原始PNG，尺寸准确', async () => { await assertPreview(); await assertImageUnchanged(); });
  await check('实际保存登记和元数据，现有PNG不重写或改路径', async () => {
    await page!.getByRole('button', { name: '保存工程', exact: true }).click();
    await expect(page!.locator('.dirty-dot')).toHaveCount(0, { timeout: 30000 });
    const saved = JSON.parse(await fs.readFile(projectFile, 'utf8')) as Project;
    assert.equal(saved.assets.length, 1); assert.equal(saved.assets[0].id, assetId); assert.equal(saved.assets[0].path, relative);
    assert.equal(saved.assets[0].width, imageBytes.readUInt32BE(16)); assert.equal(saved.assets[0].height, imageBytes.readUInt32BE(20));
    await assertImageUnchanged(); await fs.copyFile(projectFile, path.join(evidence, 'after-discovery.project.json'));
  });
  await check('关闭重开保留唯一登记与真实预览，重复扫描不增加素材', async () => {
    const beforeReopen = await fs.readFile(projectFile, 'utf8'); await closeOwnedApp(); await launch();
    await expect(card()).toHaveCount(1); await assertPreview();
    // Focus uses the real product's scan hook; wait through at least one timer.
    await page!.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page!.waitForTimeout(5200);
    await expect(card()).toHaveCount(1); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
    assert.equal(await fs.readFile(projectFile, 'utf8'), beforeReopen); await assertImageUnchanged();
    await fs.copyFile(projectFile, path.join(evidence, 'reopened.project.json')); await screenshot('reopened-list');
  });
  assert.deepEqual(errors, []); assert.equal(checks.length, 4); report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1;
  if (app && page) await screenshot('failure').catch(() => undefined);
} finally {
  try { await closeOwnedApp(); }
  catch (error) { report.status = 'failed'; report.closeError = String(error); process.exitCode = 1; }
  try {
    if (app || processes.some(record => !record.exited)) throw new Error('测试编辑器尚未确认退出。');
    const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); report.cleanup = cleanup; assert.deepEqual(cleanup.errors, []);
  } catch (error) { report.status = 'failed'; report.cleanupError = String(error); process.exitCode = 1; }
  await writeReport(); console.log((report.status === 'passed' ? 'PASS: ' : 'FAIL: ') + path.join(output, 'report.json'));
  if (report.error) console.error(report.error);
}
