import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createProject, projectSchema, type Project } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

const root = path.resolve('.'), output = path.resolve('artifacts/ui-draft-recovery-editor', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json'), profile = path.join(output, 'profile');
const p = createProject('界面草稿恢复验收');
p.ui.components.push({ id: 'draft_button', kind: 'button', name: '恢复测试按钮', text: '初始按钮', page: 'main', action: 'start', x: .15, y: .2, width: .5, height: .15 });
const checks: string[] = [], errors: string[] = [], processes: { pid?: number; exited: boolean }[] = [];
const report: Record<string, unknown> = { status: 'running', checks, errors, processes };
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'setup';
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const disk = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const recovery = async () => JSON.parse(await fs.readFile(projectFile + '.autosave', 'utf8')) as { project: Project; uiDraft?: Project; projectDirty?: boolean };
const absent = async () => !await fs.stat(projectFile + '.autosave').then(() => true).catch(() => false);
const record = (text: string) => { checks.push(text); console.log('PASS: ' + text); };
async function launch(confirmClose = false) {
  app = await launchDesktopFixture({ root, projectFile, profile, confirmClose }); page = await app.firstWindow();
  page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(p.name, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.webContents.setBackgroundThrottling(false); w.setContentSize(1440, 960); });
}
async function close() {
  if (!app) return; const child = app.process(); await app.close();
  const exited = child.exitCode !== null || child.signalCode !== null; processes.push({ pid: child.pid, exited }); assert.ok(exited); app = undefined;
}
async function ui() {
  await page!.locator('[data-workspace-tab="ui"]').click();
  await page!.getByLabel('界面编辑模式').getByRole('button', { name: '设计', exact: true }).click();
  await page!.getByLabel('设计页面', { exact: true }).selectOption('main');
  await page!.locator('[data-hierarchy-id="draft_button"]').click();
}
async function text(value: string) { await page!.getByLabel('文字', { exact: true }).fill(value); await page!.getByLabel('文字', { exact: true }).press('Tab'); }
async function waitRecovery(value: string) {
  await expect.poll(async () => (await recovery().catch(() => undefined))?.uiDraft?.ui.components.find(c => c.id === 'draft_button')?.text, { timeout: 15000 }).toBe(value);
}
async function discard() {
  await page!.locator('[data-workspace-tab="script"]').click();
  const dialog = page!.getByRole('dialog', { name: '保存界面修改', exact: true }); await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '不保存', exact: true }).click(); await expect(dialog).toBeHidden();
}
async function interaction() {
  const group = page!.locator('.ui-inspector-group').filter({ has: page!.locator(':scope > summary', { hasText: '点击与交互' }) });
  if (await group.getAttribute('open') === null) await group.locator(':scope > summary').click();
}
try {
  await fs.mkdir(path.dirname(projectFile), { recursive: true }); await saveProject(projectFile, p); await launch(); await ui();
  const primary = await fs.readFile(projectFile, 'utf8');
  phase = 'recover UI-only edit';
  await text('未保存的界面草稿'); await waitRecovery('未保存的界面草稿');
  assert.equal((await recovery()).projectDirty, false); assert.equal((await recovery()).project.ui.components.find(c => c.id === 'draft_button')?.text, '初始按钮');
  assert.equal(await fs.readFile(projectFile, 'utf8'), primary);
  await close(); await launch();
  await expect(button('保存界面')).toBeEnabled(); await expect(page!.locator('.dirty-dot')).toHaveCount(1);
  await ui(); await expect(page!.getByLabel('文字', { exact: true })).toHaveValue('未保存的界面草稿');
  await page!.screenshot({ path: path.join(output, 'recovered-ui-only.png') });
  await discard(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); await expect.poll(absent).toBe(true);
  await close(); await launch(); await ui(); await expect(page!.getByLabel('文字', { exact: true })).toHaveValue('初始按钮');
  record('仅编辑界面也会生成恢复副本；进程重启后仍为可放弃草稿，放弃后再次重启不会复活。');

  phase = 'unfinished UI';
  await interaction(); await page!.getByLabel('点击行为', { exact: true }).selectOption('blueprint');
  await text('尚未选择蓝图'); await waitRecovery('尚未选择蓝图');
  assert.equal(projectSchema.safeParse((await recovery()).uiDraft).success, false);
  await close(); await launch(); await ui(); await interaction();
  await expect(page!.getByLabel('点击行为', { exact: true })).toHaveValue('blueprint');
  await button('保存界面').click(); await expect(page!.locator('.status-bar')).toContainText('失败');
  assert.equal(await fs.readFile(projectFile, 'utf8'), primary);
  await page!.getByLabel('点击行为', { exact: true }).selectOption('start'); await button('保存界面').click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0, { timeout: 45000 }); await expect.poll(absent).toBe(true);
  await close(); await launch(); await ui(); await expect(page!.getByLabel('文字', { exact: true })).toHaveValue('尚未选择蓝图');
  await expect(button('保存界面')).toBeDisabled();
  record('未完成按钮绑定可恢复并继续编辑；严格保存仍拒绝无效绑定，修复后保存和重开正确。');

  phase = 'in-flight autosave then discard';
  await app!.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get('studio:autosave');
    const state = (globalThis as any).recoveryHold = { hold: true, written: false, cleared: false, release: undefined as undefined | (() => void) };
    ipcMain.removeHandler('studio:autosave');
    ipcMain.handle('studio:autosave', async (...args) => {
      const result = await original(...args);
      if (args[2]?.clear) state.cleared = true;
      if (state.hold && args[2]?.uiDraft) { state.hold = false; state.written = true; await new Promise<void>(resolve => { state.release = resolve; }); }
      return result;
    });
  });
  await text('写入返回延迟'); await expect.poll(() => app!.evaluate(() => (globalThis as any).recoveryHold.written), { timeout: 15000 }).toBe(true);
  await discard(); await expect.poll(absent).toBe(true); await app!.evaluate(() => { (globalThis as any).recoveryHold.release(); });
  await page!.reload(); await expect(page!.locator('.project-title strong')).toHaveText(p.name); await ui();
  await expect(page!.getByLabel('文字', { exact: true })).toHaveValue('尚未选择蓝图'); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  record('已写入但返回延迟的自动恢复不会覆盖后续放弃决定；窗口重载保持已保存内容。');

  phase = 'mixed project and UI recovery';
  await page!.locator('[data-workspace-tab="script"]').click();
  const line = page!.locator('.dialogue-input').first(); await line.fill('主工程独立修改'); await line.press('Tab');
  await ui(); await text('混合修改中的界面'); await waitRecovery('混合修改中的界面');
  assert.equal((await recovery()).projectDirty, true);
  await close(); await launch(); await ui(); await discard();
  await expect(page!.locator('.dirty-dot')).toHaveCount(1); await expect(page!.locator('.dialogue-input').first()).toHaveValue('主工程独立修改');
  const mixed = await recovery(); assert.equal(mixed.uiDraft, undefined); assert.equal(mixed.projectDirty, true);
  await button('保存工程').click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  assert.equal((await disk()).ui.components.find(c => c.id === 'draft_button')?.text, '尚未选择蓝图');
  await close(); await launch(); await expect(page!.locator('.dialogue-input').first()).toHaveValue('主工程独立修改');
  record('主工程与界面同时改动时分别恢复；放弃界面仍保留剧情改动和其恢复副本。');

  phase = 'close unfinished without saving';
  await close(); await launch(true); await ui(); await interaction(); await page!.getByLabel('点击行为', { exact: true }).selectOption('blueprint');
  await text('关闭时放弃的未完成控件'); await waitRecovery('关闭时放弃的未完成控件');
  const child = app!.process();
  await app!.evaluate(({ dialog, BrowserWindow }) => {
    dialog.showMessageBox = (async (_window: unknown, options: any) => {
      if (options.title !== '保存工程') throw new Error('Unexpected close dialog: ' + options.title);
      return { response: 1, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
    BrowserWindow.getAllWindows()[0].close();
  });
  await expect.poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 20000 }).toBe(true);
  processes.push({ pid: child.pid, exited: true }); app = undefined;
  await expect.poll(absent).toBe(true); await launch(); await ui(); await interaction();
  await expect(page!.getByLabel('点击行为', { exact: true })).toHaveValue('start'); await expect(button('保存界面')).toBeDisabled();
  record('原生关闭提示可以放弃未完成的界面控件，进程退出并清除恢复副本；不绕过正常保存校验。');
  assert.deepEqual(errors, []); report.status = 'passed';
  await fs.writeFile(path.join(output, 'saved-evidence.json'), JSON.stringify(await disk(), null, 2));
} catch (error) {
  report.status = 'failed'; report.phase = phase; report.error = String(error); console.error(phase, error); process.exitCode = 1;
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
} finally {
  await close(); report.cleanup = await cleanVerificationDirectories(output, ['project', 'profile']);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
}
