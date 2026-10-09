import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { launchDesktopFixture, installedExecutable } from './lib/desktop-fixture';

const root = path.resolve('.'), output = path.join(root, 'artifacts/chapter-framing', new Date().toISOString().replaceAll(':', '-'));
const directory = path.join(output, 'project'), projectFile = path.join(directory, 'project.vns.json');
await fs.cp(installedExecutable ? path.join(path.dirname(installedExecutable), 'resources/resources/templates/aihong') : path.join(root, 'resources/templates/aihong'), directory, { recursive: true });
const originalProject = JSON.parse(await fs.readFile(projectFile, 'utf8'));
const originalMesh = originalProject.assets.find((asset: { id: string }) => asset.id === 'ai_presentation_title_one').emissionMesh;
assert.equal(originalMesh.vertices.length, 172);
assert.equal(originalMesh.triangles.length, 161);
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**'] } } });
await server.listen();
let app: ElectronApplication | undefined, page: Page | undefined;
const errors: string[] = [];
const launch = async () => {
  app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile, devUrl: `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}` });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows()[0], secondary = screen.getAllDisplays().find(d => d.id !== screen.getPrimaryDisplay().id);
    if (secondary) window.setPosition(secondary.workArea.x, secondary.workArea.y);
    window.setContentSize(1520, 980);
  });
  await page.locator('.view-tabs').getByRole('button', { name: '界面', exact: true }).click();
  await page.locator('.ui-toolbar').getByRole('button', { name: '章节标题', exact: true }).click();
  await page.getByRole('tab', { name: '游戏设置', exact: true }).click();
  const settings = page.locator('details.ui-property-group').filter({ has: page.locator('summary').filter({ hasText: /^章节进场$/ }) });
  await settings.locator(':scope > summary').click();
  await settings.locator('.chapter-composition > summary').click();
};
try {
  await launch();
  await expect(page!.getByLabel('背景横向偏移 %', { exact: true })).toHaveValue('13.802');
  await expect(page!.getByLabel('章节粒子颜色', { exact: true })).toHaveValue('#bcbcbc');
  await page!.getByLabel('章节粒子颜色', { exact: true }).fill('#d96231');
  await page!.locator('.ui-canvas').screenshot({ path: path.join(output, '01-original-framing.png') });
  await page!.getByLabel('背景横向偏移 %', { exact: true }).fill('20');
  await page!.getByLabel('背景纵向偏移 %', { exact: true }).fill('-5');
  await expect(page!.locator('[data-chapter-background-offset]').first()).toHaveAttribute('style', /translate\(20%, -5%\)/);
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  const saved = JSON.parse(await fs.readFile(projectFile, 'utf8'));
  assert.equal(saved.ui.chapterTransition.backgroundOffsetX, .2); assert.equal(saved.ui.chapterTransition.backgroundOffsetY, -.05);
  assert.equal(saved.ui.chapterTransition.particleColor, '#d96231');
  assert.deepEqual(saved.assets.find((asset: { id: string }) => asset.id === 'ai_presentation_title_one').emissionMesh, originalMesh);
  await app!.close(); app = undefined;
  await launch();
  await expect(page!.getByLabel('背景横向偏移 %', { exact: true })).toHaveValue('20');
  await expect(page!.getByLabel('背景纵向偏移 %', { exact: true })).toHaveValue('-5');
  await expect(page!.getByLabel('章节粒子颜色', { exact: true })).toHaveValue('#d96231');
  await page!.getByRole('checkbox', { name: '笔触消散时背景轻微波动', exact: true }).uncheck();
  await expect(page!.locator('.chapter-ripple-scene')).toHaveCount(0);
  await expect(page!.locator('[data-chapter-background-offset]').first()).toHaveAttribute('style', /translate\(20%, -5%\)/);
  await page!.locator('.ui-canvas').screenshot({ path: path.join(output, '02-reopened-no-ripple.png') });
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks: ['original framing', 'editable offsets', 'save and reopen', 'particle color edit and reopen', 'source emission mesh survives editor save', 'offset retained without ripple'], errors }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', error: String(error), errors }, null, 2));
  throw error;
} finally { await app?.close(); await server.close(); console.log(output); }
