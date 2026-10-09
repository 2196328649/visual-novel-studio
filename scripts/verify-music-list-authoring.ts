import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { projectSchema } from '../src/core/model';
import { createUiMusicPreviewFixture, writeUiMusicPreviewAudio } from './lib/ui-music-preview-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openUiPreviewWindow } from './lib/ui-preview-window';

const root = path.resolve('.'), output = path.join(root, 'artifacts/music-list-authoring', new Date().toISOString().replaceAll(':', '-'));
const project = createUiMusicPreviewFixture(false), projectFile = path.join(output, 'project.vns.json');
await writeUiMusicPreviewAudio(output);
await fs.writeFile(projectFile, JSON.stringify(project));
let app!: ElectronApplication, page!: Page;
let phase = 'launch';
const errors: string[] = [], checks: string[] = [];
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') }); page = await app.firstWindow();
  app.on('window', window => window.on('pageerror', error => errors.push(error.message))); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByLabel('界面编辑模式').getByRole('button', { name: '设计', exact: true }).click();
  await page.getByLabel('设计页面', { exact: true }).selectOption('musicRoom');
  await page.locator('[data-hierarchy-id="music_list"]').click();
}
async function close() { await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await app?.close().catch(() => {}); }
try {
  await launch(); phase = 'source and searchable selection';
  const source = page.getByLabel('音乐列表曲目来源', { exact: true });
  await source.selectOption('automatic'); await expect(page.getByText('自动收集 13 首配乐；新增剧情配乐后，列表会随之更新。', { exact: true })).toBeVisible();
  await source.selectOption('selected');
  for (const asset of project.assets) await page.getByRole('button', { name: '移除曲目：' + asset.name, exact: true }).click();
  await expect(page.getByText('当前列表为空，请在下面勾选曲目。', { exact: true })).toBeVisible();
  const search = page.getByLabel('搜索音乐列表曲目', { exact: true });
  for (const number of [2, 1, 3]) {
    await search.fill('测试音乐 ' + number);
    await page.getByRole('checkbox', { name: '加入音乐列表：测试音乐 ' + number, exact: true }).check();
  }
  await search.fill('不存在的曲目'); await expect(page.getByText('没有找到符合名称的音频。', { exact: true })).toBeVisible();
  await search.fill('');
  await page.getByRole('button', { name: '上移曲目：测试音乐 3', exact: true }).click();
  await page.getByRole('button', { name: '下移曲目：测试音乐 2', exact: true }).click();
  await page.getByRole('button', { name: '移除曲目：测试音乐 1', exact: true }).click();
  await expect(page.locator('.ui-music-track-order li > span')).toHaveText(['1. 测试音乐 3', '2. 测试音乐 2']);
  checks.push('自动收集与手动选择明确显示；名称搜索、空列表、上移、下移和移除真实生效。');
  phase = 'browsing and save';
  const browsing = page.getByLabel('音乐列表浏览方式', { exact: true });
  await browsing.selectOption('scroll'); await expect(page.getByLabel('每页行数', { exact: true })).toHaveCount(0);
  await browsing.selectOption('pages'); await page.getByLabel('每页行数', { exact: true }).fill('1');
  await page.getByRole('button', { name: '保存界面', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0, { timeout: 45000 });
  const saved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  assert.deepEqual(saved.ui.components.find(component => component.id === 'music_list')!.list?.assetIds, ['track_2', 'track_1']);
  assert.equal(saved.ui.components.find(component => component.id === 'music_list')!.list?.rows, 1);
  await page.screenshot({ path: path.join(output, 'authoring.png') }); await close();
  phase = 'reopen and player order'; await launch();
  await expect(page.getByLabel('音乐列表曲目来源', { exact: true })).toHaveValue('selected');
  await expect(page.locator('.ui-music-track-order li > span')).toHaveText(['1. 测试音乐 3', '2. 测试音乐 2']);
  await expect(page.getByLabel('音乐列表浏览方式', { exact: true })).toHaveValue('pages');
  const preview = await openUiPreviewWindow(app, page), frame = preview.getByLabel('参数联动预演画面', { exact: true });
  await expect(frame.locator('[data-music-control^="track:"]')).toHaveCount(2);
  assert.deepEqual(await frame.locator('[data-music-control^="track:"]').evaluateAll(elements => elements.map(element => element.getAttribute('data-music-control'))), ['track:track_2', 'track:track_1']);
  await frame.screenshot({ path: path.join(output, 'player-order.png') });
  checks.push('滚动和分页可显式切换；保存重开保留选曲顺序，独立预览按同一顺序显示曲目。');
  assert.deepEqual(errors, []); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, errors, error: String(error) }, null, 2)); throw error;
} finally { await close(); console.log(output); }
