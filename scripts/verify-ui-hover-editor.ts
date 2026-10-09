import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { expect } from '@playwright/test';
import { buttonEventFixture } from './lib/ui-button-event-fixture';
import { addAihongUiSounds } from './lib/aihong-ui-sounds';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openUiPreviewWindow } from './lib/ui-preview-window';

const root = path.resolve('.'), output = path.join(root, 'artifacts/ui-hover-editor', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const { project } = buttonEventFixture();
await addAihongUiSounds(project, output);
project.ui.components.find(c => c.id === 'target')!.hoverSoundId = 'ai_ui_hover_highlight';
project.ui.components.find(c => c.id === 'disable')!.disabled = true;
const file = path.join(output, 'project.vns.json');
await fs.writeFile(file, JSON.stringify(project));
const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
const beforeHash = digest(await fs.readFile(path.join(output, project.assets.find(a => a.id === 'ai_ui_hover')!.path)));
const app = await launchDesktopFixture({ root, projectFile: file, profile: path.join(output, 'profile') }), page = await app.firstWindow();
const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="ui"]').click();
  const preview = await openUiPreviewWindow(app, page); preview.on('pageerror', e => errors.push(e.message));
  await preview.evaluate(() => {
    const state = window as any; state.hoverAudio = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { state.hoverAudio.push({ src: this.src, volume: this.volume }); return play.call(this); };
  });
  const calls = () => preview.evaluate(() => (window as any).hoverAudio as { src: string; volume: number }[]);
  await preview.mouse.move(1, 1);
  await preview.locator('[data-preview-component="target"]').hover();
  await expect.poll(async () => (await calls()).length).toBe(1);
  assert.ok(decodeURIComponent((await calls())[0].src).includes('Highlight_New.ogg'));
  await preview.waitForTimeout(300);
  assert.equal((await calls()).length, 1);
  await preview.locator('[data-preview-component="disable"]').hover();
  assert.equal((await calls()).length, 1);
  await preview.locator('[data-preview-component="target"]').hover();
  await expect.poll(async () => (await calls()).length).toBe(2);
  await preview.locator('[data-preview-component="modal"]').click();
  await preview.locator('[data-preview-component="overlay_close"]').hover();
  assert.ok(decodeURIComponent((await calls()).at(-1)!.src).includes('鼠标滑动.ogg'));
  await preview.screenshot({ path: path.join(output, 'hover-preview.png') });
  await preview.close();
  await page.locator('[data-workspace-tab="assets"]').click();
  // A fresh fixture has no saved asset-folder assignments; search across all content.
  await page.getByRole('textbox', { name: '搜索资源和蓝图', exact: true }).fill('鼠标滑动');
  const card = page.locator('[data-content-key="asset:ai_ui_hover"]');
  await card.click(); await card.press('F2');
  await page.getByLabel('内容名称', { exact: true }).fill('菜单悬停');
  await page.getByRole('dialog', { name: '重命名', exact: true }).getByRole('button', { name: '确定', exact: true }).click();
  const save = async () => {
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await expect(page.locator('.dirty-dot')).toHaveCount(0);
    return JSON.parse(await fs.readFile(file, 'utf8'));
  };
  const renamed = await save();
  assert.equal(renamed.assets.find((a: any) => a.id === 'ai_ui_hover').path, 'assets/音效/界面/菜单悬停.ogg');
  assert.equal(digest(await fs.readFile(path.join(output, 'assets/音效/界面/菜单悬停.ogg'))), beforeHash);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  const undone = await save(); assert.equal(undone.assets.find((a: any) => a.id === 'ai_ui_hover').path, 'assets/音效/界面/鼠标滑动.ogg');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  const redone = await save(); assert.equal(redone.assets.find((a: any) => a.id === 'ai_ui_hover').path, 'assets/音效/界面/菜单悬停.ogg');
  assert.deepEqual(redone.nodes, renamed.nodes); assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks: ['悬停一次播放、停留不重复、禁用静音、进入模态菜单继续反馈', '素材重命名、保存、撤销保存和重做保存保持声音字节和剧情'] }, null, 2));
} catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }); throw error; }
finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())); await app.close(); console.log(output); }
