import { expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.');
const active = JSON.parse(await fs.readFile(path.join(root, 'artifacts/android-active.json'), 'utf8'));
const output: string = process.env.VNS_ANDROID_VERIFY_ROOT ?? active.output;
const profile = path.join(output, 'profile');
const projectFile = process.env.VNS_ANDROID_PROJECT ?? path.join(output, 'project/project.vns.json');
// Never let an earlier APK satisfy the completion check for a new export.
const distribution = await fs.mkdtemp(path.join(output, (process.env.VNS_ANDROID_EXPORT_NAME ?? 'distribution') + '-'));
await fs.writeFile(path.join(output, 'last-export.json'), JSON.stringify({ distribution, projectFile, startedAt: new Date().toISOString() }, null, 2));
const project = JSON.parse(await fs.readFile(projectFile, 'utf8'));
const setup = JSON.parse(await fs.readFile(path.join(output, 'setup-result.json'), 'utf8'));
const app = await launchDesktopFixture({ root, profile, projectFile, sdkRoot: setup.environment.sdkPath });
const page = await app.firstWindow();
const errors: string[] = []; let log = '';
page.on('pageerror', error => errors.push(error.message));
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 960));
  await page.exposeFunction('recordAndroidExport', async (event: { kind: string; message: string }) => {
    if (event.kind === 'log') { log += event.message; await fs.writeFile(path.join(distribution, 'export.log'), log); }
  });
  await page.evaluate(() => window.studio!.onRuntimeEvent(event => { void (window as any).recordAndroidExport(event); }));
  await page.locator('.export-button').click();
  await expect(page.getByRole('button', { name: '选择目录并导出', exact: true })).toBeEnabled({ timeout: 30000 });
  const environment = await page.evaluate(() => window.studio!.environment());
  const check = await page.evaluate(project => window.studio!.checkExport(project), project);
  expect(check.ready).toBe(true);
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, distribution);
  await page.getByRole('button', { name: '选择目录并导出', exact: true }).click();
  let exportFailure = '';
  await expect.poll(async () => {
    const failures = await page.locator('.diagnostic.error').allTextContents();
    if (failures.length) { exportFailure = failures.join('\n'); return 1; }
    return (await fs.readdir(distribution)).filter(name => /\.(apk|aab)$/.test(name)).length;
  }, { timeout: 1300000, intervals: [2000, 5000] }).toBeGreaterThan(0);
  expect(exportFailure).toBe('');
  await expect(page.locator('.export-button')).toBeEnabled({ timeout: 60000 });
  const files = await Promise.all((await fs.readdir(distribution)).filter(name => /\.(apk|aab)$/.test(name)).map(async name => {
    const file = path.join(distribution, name), bytes = await fs.readFile(file);
    expect(bytes.length).toBeGreaterThan(1000000);
    return { file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }));
  expect(errors).toEqual([]);
  await page.screenshot({ path: path.join(distribution, 'export-result.png') });
  await fs.writeFile(path.join(distribution, 'report.json'), JSON.stringify({ status: 'passed', environment, projectFile, check, files, errors }, null, 2));
  console.log(`ANDROID EXPORT PASS: ${distribution}`);
} catch (error) {
  await page.screenshot({ path: path.join(distribution, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(distribution, 'report.json'), JSON.stringify({ status: 'failed', error: String(error), errors }, null, 2));
  console.error(error); process.exitCode = 1;
} finally { await app.close(); }
