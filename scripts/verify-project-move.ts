import { expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root = process.cwd(), output = path.join(root, 'artifacts/project-move', new Date().toISOString().replaceAll(':', '-'));
const old = path.join(output, 'original', 'project.vns.json'), moved = path.join(output, 'moved', 'project.vns.json'), profile = path.join(output, 'profile');
const saved = await saveProject(old, createProject('移动工程验收'));
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(path.join(profile, 'workspace.json'), JSON.stringify({ path: old, recentProjects: [{ path: old, name: saved.project.name, projectId: saved.project.id, lastOpenedAt: Date.now() }] }));
const app = await launchDesktopFixture({ root, profile, projectFile: old }), page = await app.firstWindow();
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await expect(page.locator('.project-title strong')).toHaveText(saved.project.name, { timeout: 60000 });
  await fs.rename(path.dirname(old), path.dirname(moved));
  await expect(page.getByRole('alert').filter({ hasText: '工程已移动或原位置不可用' })).toBeVisible({ timeout: 15000 });
  await page.getByPlaceholder('输入对白或旁白…').fill('移动后继续写下的对白');
  await expect(page.locator('.status-bar')).toContainText('编辑内容已暂存', { timeout: 15000 });
  const recovery = await page.evaluate(async () => {
    const session = await window.studio!.getInitial();
    return window.studio!.autosave(session.project);
  });
  expect(recovery.locationMissing).toBe(true);
  expect(await fs.stat(path.dirname(old)).catch(() => null)).toBeNull();
  const guard = await page.evaluate(async () => {
    const current = await window.studio!.getInitial();
    try { await window.studio!.save(current.project); return ''; } catch (error) { return String(error); }
  });
  expect(guard).toContain('重新定位工程');
  const info = await page.evaluate(() => window.studio!.getProjectHub!());
  expect(info.recent[0].available).toBe(false); expect(info.recent[0].recoveryAvailable).toBe(true);
  await page.screenshot({ path: path.join(output, 'missing-location.png') });
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, moved);
  await page.getByRole('button', { name: '重新定位工程', exact: true }).click();
  await expect(page.locator('.project-title')).toHaveAttribute('title', moved);
  await expect(page.locator('.project-location-notice')).toHaveCount(0);
  await expect(page.getByPlaceholder('输入对白或旁白…')).toHaveValue('移动后继续写下的对白');
  const recent = await page.evaluate(() => window.studio!.getProjectHub!());
  expect(recent.recent).toHaveLength(1); expect(recent.recent[0].path).toBe(moved);
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect.poll(async () => JSON.parse(await fs.readFile(moved, 'utf8')).name).toBe(saved.project.name);
  await expect.poll(async () => (await fs.readFile(moved, 'utf8')).includes('移动后继续写下的对白')).toBe(true);
  expect(await fs.stat(path.dirname(old)).catch(() => null)).toBeNull();
  expect(errors).toEqual([]);
  await page.screenshot({ path: path.join(output, 'relocated.png') });
  const report = { missingNotice: true, autosaveProtected: true, saveProtected: true, recoveryAvailable: true, relocated: true, recentEntryUpdated: true, oldDirectoryNotRecreated: true, errors };
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, ...report }, null, 2));
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined);
  await app.close();
}
