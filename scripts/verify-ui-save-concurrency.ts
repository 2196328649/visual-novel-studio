import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Hold a successful native save response while real directory discovery adds a
// resource. This reproduces the race without mocking either filesystem operation.
const root = path.resolve('.');
const output = path.join(root, 'artifacts/ui-save-concurrency', new Date().toISOString().replaceAll(':', '-'));
const directory = path.join(output, 'project'), projectFile = path.join(directory, 'project.vns.json');
await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
const wav = Buffer.alloc(44 + 800, 128);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28);
wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
await fs.writeFile(path.join(directory, 'assets/existing.wav'), wav);
const project = createProject('界面保存竞争验收');
project.assets.push({ id: 'existing', name: '已有音频', kind: 'audio', path: 'assets/existing.wav' });
await fs.writeFile(projectFile, JSON.stringify(projectSchema.parse(project)));
let app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
let page = await app.firstWindow();
const checks: string[] = [], errors: string[] = [], evidence: Record<string, unknown> = {};
page.on('pageerror', error => errors.push(error.message));
let phase = 'launch';
const saved = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow, ipcMain }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.setBackgroundThrottling(false); window.setContentSize(1500, 1000);
    const state: { hold: boolean; saved: boolean; release?: () => void; scanned: string[]; discovered: string[] } = (globalThis as any).uiSaveReview = { hold: true, saved: false, scanned: [], discovered: [] };
    const original = (ipcMain as any)._invokeHandlers.get('studio:save');
    ipcMain.removeHandler('studio:save');
    ipcMain.handle('studio:save', async (...args) => {
      const result = await original(...args);
      if (state.hold) {
        state.hold = false; state.saved = true;
        await new Promise<void>(resolve => { state.release = resolve; });
      }
      return result;
    });
    const discover = (ipcMain as any)._invokeHandlers.get('studio:discover-assets');
    ipcMain.removeHandler('studio:discover-assets');
    ipcMain.handle('studio:discover-assets', async (event, input) => {
      state.scanned = input.assets.map((asset: { id: string }) => asset.id);
      const result = await discover(event, input);
      if (result) state.discovered = result.project.assets.map((asset: { id: string }) => asset.id);
      return result;
    });
  });
  await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  await page.getByLabel('添加组件菜单', { exact: true }).getByRole('button', { name: '文字', exact: true }).click();
  await page.getByLabel('文字', { exact: true }).fill('保存期间也不能丢失素材');
  phase = 'pending save and discovery';
  await page.getByRole('button', { name: '保存界面', exact: true }).click();
  await expect.poll(() => app.evaluate(() => (globalThis as any).uiSaveReview.saved)).toBe(true);
  const written = await saved();
  assert.equal(written.assets.length, 1);
  assert.ok(written.ui.components.some(component => component.text === '保存期间也不能丢失素材'));
  await fs.writeFile(path.join(directory, 'assets/late.wav'), wav);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => app.evaluate(() => (globalThis as any).uiSaveReview.discovered.length), { timeout: 12000 }).toBe(2);
  // The busy label hides notifications. A subsequent real discovery request
  // must contain the newly accepted asset before the save response is released.
  await expect.poll(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    return app.evaluate(() => (globalThis as any).uiSaveReview.scanned.length);
  }).toBe(2);
  assert.equal((await saved()).assets.length, 1, 'late discovery has not reached the earlier disk snapshot');
  await app.evaluate(() => { (globalThis as any).uiSaveReview.release(); });
  await expect(page.getByRole('button', { name: '保存工程', exact: true })).toBeEnabled();
  await expect(page.getByText('界面已保存', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.dirty-dot')).toHaveCount(1);
  await page.screenshot({ path: path.join(output, 'concurrent-edit-stays-dirty.png') });
  checks.push('界面先真实落盘；等待返回期间发现新素材；返回后仍显示未保存状态，不把旧快照当作当前工程');

  phase = 'save accepted changes';
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const accepted = await saved();
  assert.equal(accepted.assets.length, 2, 'accepting a UI save must preserve the newly discovered asset');
  const late = accepted.assets.find(asset => asset.id !== 'existing')!;
  assert.ok(late.path.endsWith('late.wav'));
  assert.ok(accepted.ui.components.some(component => component.text === '保存期间也不能丢失素材'));
  for (const asset of accepted.assets) await fs.access(path.join(directory, asset.path));
  evidence.assetPaths = accepted.assets.map(asset => ({ id: asset.id, path: asset.path }));
  checks.push('再次保存同时保留界面和新素材，资源目录重定位后两份文件仍存在，没有重复导入');

  phase = 'undo and redo preserve concurrent resource';
  await page.locator('[data-workspace-tab="script"]').click();
  await page.getByRole('button', { name: '撤销', exact: true }).first().click();
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const undone = await saved();
  assert.equal(undone.assets.length, 2);
  assert.equal(undone.ui.components.some(component => component.text === '保存期间也不能丢失素材'), false);
  await page.getByRole('button', { name: '重做', exact: true }).first().click();
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const redone = await saved();
  assert.equal(redone.assets.length, 2);
  assert.ok(redone.ui.components.some(component => component.text === '保存期间也不能丢失素材'));
  for (const asset of redone.assets) await fs.access(path.join(directory, asset.path));
  await fs.writeFile(path.join(output, 'saved-evidence.json'), JSON.stringify({ assets: redone.assets, components: redone.ui.components }, null, 2));
  checks.push('撤销只撤销本次界面改动，晚到素材保留；重做和再次保存不丢资源路径');

  phase = 'reopen';
  await app.close();
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="ui"]').click();
  await expect(page.locator('.ui-component', { hasText: '保存期间也不能丢失素材' })).toHaveCount(1);
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  await page.screenshot({ path: path.join(output, 'reopened.png') });
  checks.push('关闭并重开仍显示已保存界面，且没有重复发现素材产生脏标记');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, evidence, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, error: String(error), checks, evidence, errors }, null, 2));
  throw error;
} finally {
  await app.close();
  const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']);
  assert.deepEqual(cleanup.errors, []);
  console.log(output);
}
