import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { assetFiles, effectiveUiComponents, projectSchema, type Project } from '../src/core/model';
import { assetSourcePath } from '../src/desktop/project-store';
import { launchDesktopFixture, installedExecutable } from './lib/desktop-fixture';
import { openUiPreviewWindow } from './lib/ui-preview-window';

const baseline = process.argv.includes('--baseline');
const root = path.resolve('.');
const output = path.resolve('artifacts/ui-parent-drop-editor', new Date().toISOString().replaceAll(':', '-') + '-' + (baseline ? 'before' : 'after') + '-' + randomUUID().slice(0, 8));
const source = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? 'E:/Project/Visual Novel Studio/我的视觉小说1/project.vns.json');
const original = await fs.readFile(source);
const project = projectSchema.parse(JSON.parse(original.toString())) as Project;
project.name += ' · 子对象拖放验收';
project.assets = project.assets.map(asset => ({ ...asset, externalPath: assetSourcePath(path.dirname(source), asset),
  externalFiles: Object.fromEntries(assetFiles(asset).map(file => [file, assetSourcePath(path.dirname(source), asset, file)])),
}));
const button = effectiveUiComponents(project.ui).find(c => c.page === 'main' && c.kind === 'button' && c.action === 'start' && c.skin?.idle);
assert.ok(button, 'Author project must contain its skinned start button');
const projectFile = path.join(output, 'project/project.vns.json');
await fs.mkdir(path.dirname(projectFile), { recursive: true });
await fs.writeFile(projectFile, JSON.stringify(project, null, 2));
const server = installedExecutable ? undefined : await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**', '**/work/**'] } } });
await server?.listen();
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch';
const checks: string[] = [], errors: string[] = [];
const launch = async () => {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile'), devUrl: server ? 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port : undefined });
  page = await app.firstWindow();
  page.on('pageerror', e => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="ui"]').click();
};
const close = async () => { await app?.close().catch(() => undefined); app = undefined; };
const saved = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
try {
  await launch();
  const row = (id: string) => page!.locator(`[data-hierarchy-id="${id}"]`);
  const object = (id: string) => page!.locator(`.ui-canvas [data-component-id="${id}"]`);
  await row(button.id).click();
  const parentImage = object(button.id).locator('img').first();
  await expect(parentImage).toBeVisible();
  const idleSrc = await parentImage.getAttribute('src');
  await page!.screenshot({ path: path.join(output, '01-before.png') });
  phase = 'create-image';
  await page!.getByRole('button', { name: '添加组件', exact: true }).click();
  await page!.getByLabel('添加组件菜单', { exact: true }).getByRole('button', { name: '图片', exact: true }).click();
  const added = await page!.locator('.ui-hierarchy-row.selected').getAttribute('data-hierarchy-id');
  assert.ok(added);
  const childBefore = (await object(added).boundingBox())!;
  phase = 'drag-preview';
  await page!.evaluate(() => { (window as any).__parentDropEvents = []; for (const name of ['dragstart', 'dragenter', 'dragover', 'drop', 'dragend']) document.addEventListener(name, e => { const target = (e.target as Element).closest('[data-hierarchy-id]'); (window as any).__parentDropEvents.push([name, target?.getAttribute('data-hierarchy-id')]); }, true); });
  await row(added).scrollIntoViewIfNeeded();
  await row(button.id).scrollIntoViewIfNeeded();
  const from = (await row(added).boundingBox())!, to = (await row(button.id).boundingBox())!;
  await page!.mouse.move(from.x + from.width * .45, from.y + from.height * .5);
  await page!.mouse.down();
  await page!.mouse.move(from.x + from.width * .45 + 12, from.y + from.height * .5, { steps: 3 });
  await page!.mouse.move(to.x + to.width * .45, to.y + to.height * .5, { steps: 14 });
  await page!.mouse.move(to.x + to.width * .45 + 1, to.y + to.height * .5);
  await expect(row(button.id)).toHaveClass(/drop-target/);
  if (!baseline) {
    await expect(page!.locator('.ui-hierarchy-feedback')).toContainText('松开');
    await expect(page!.locator('.ui-parent-guide.is-dropping')).toHaveAttribute('data-parent-id', button.id);
    await expect(row(button.id)).toContainText('设为父对象');
  }
  await page!.screenshot({ path: path.join(output, '02-drag-preview.png') });
  await page!.mouse.up();
  phase = 'drop-result';
  await expect(row(added)).toHaveAttribute('data-parent-id', button.id);
  if (baseline) {
    await expect(parentImage).toHaveCount(0);
    checks.push('复现：新图片拖为开始按钮子对象后，父按钮 img 被移除');
  } else {
    await expect(parentImage).toHaveAttribute('src', idleSrc!);
    await expect(row(added)).toHaveAttribute('aria-selected', 'true');
    await expect(page!.locator('.ui-hierarchy-feedback')).toContainText('已将');
    const childAfter = (await object(added).boundingBox())!;
    for (const key of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(childBefore[key] - childAfter[key]) < 2, `${key} must be preserved`);
    checks.push('拖放保留父按钮图片和子图画面位置，并展示目标、层级和完成提示');
    phase = 'undo-redo';
    await page!.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(row(added)).not.toHaveAttribute('data-parent-id', button.id);
    await expect(parentImage).toHaveAttribute('src', idleSrc!);
    await page!.getByRole('button', { name: '重做', exact: true }).click();
    await expect(row(added)).toHaveAttribute('data-parent-id', button.id);
    await expect(parentImage).toHaveAttribute('src', idleSrc!);
    checks.push('父子关系撤销和重做均保留按钮图片');
  }
  await page!.mouse.move(600, 145);
  await page!.screenshot({ path: path.join(output, '03-after-drop.png') });
  await page!.getByRole('button', { name: '保存界面', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  const current = await saved(), child = effectiveUiComponents(current.ui).find(c => c.id === added)!;
  assert.equal(child.childLayer, baseline ? 'background' : 'foreground');
  assert.deepEqual(effectiveUiComponents(current.ui).find(c => c.id === button.id)!.skin, button.skin);
  if (!baseline) {
    phase = 'preview';
    const preview = await openUiPreviewWindow(app!, page!);
    preview.on('pageerror', e => errors.push(e.message));
    const previewButton = preview.locator(`[data-preview-component="${button.id}"]`);
    await expect(previewButton.locator('img').first()).toBeVisible();
    const previewIdle = await previewButton.locator('img').first().getAttribute('src');
    await previewButton.hover();
    if (button.skin!.hover && button.skin!.hover !== button.skin!.idle) await expect(previewButton.locator('img').first()).not.toHaveAttribute('src', previewIdle!);
    await preview.screenshot({ path: path.join(output, '04-hover-preview.png') });
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().endsWith('#ui-preview')).forEach(w => w.close()));
    phase = 'reopen';
    await close(); await launch();
    await expect(row(added)).toHaveAttribute('data-parent-id', button.id);
    await expect(object(button.id).locator('img').first()).toHaveAttribute('src', idleSrc!);
    await row(added).click();
    await expect(page!.getByLabel('子对象放置位置', { exact: true })).toHaveValue('foreground');
    await page!.getByLabel('子对象放置位置', { exact: true }).selectOption('background');
    await expect(object(button.id).locator('img').first()).toHaveAttribute('src', idleSrc!);
    await page!.getByLabel('子对象放置位置', { exact: true }).selectOption('foreground');
    checks.push('独立预览悬停、保存重开及显式改为背景子图时，父按钮皮肤均保留');
    phase = 'detach-and-invalid-drop';
    await row(added).dragTo(page!.locator('.ui-hierarchy-root'));
    await expect(row(added)).not.toHaveAttribute('data-parent-id', button.id);
    await expect(page!.locator('.ui-hierarchy-feedback')).toContainText('移到页面根级');
    await expect(object(button.id).locator('img').first()).toHaveAttribute('src', idleSrc!);
    await row(added).dragTo(row(button.id));
    await expect(row(added)).toHaveAttribute('data-parent-id', button.id);
    await row(button.id).dragTo(row(added));
    await expect(row(button.id)).not.toHaveAttribute('data-parent-id', added);
    await expect(row(added)).toHaveAttribute('data-parent-id', button.id);
    await expect(page!.locator('.ui-parent-guide.is-dropping')).toHaveCount(0);
    checks.push('拖到页面根级和重新放入可用，循环父子关系被阻止，拖放提示正确清除');
    if (await page!.getByRole('button', { name: '保存界面', exact: true }).isEnabled()) await page!.getByRole('button', { name: '保存界面', exact: true }).click();
    await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  }
  assert.deepEqual(errors, []);
  assert.ok((await fs.readFile(source)).equals(original), 'Original author project must stay unchanged');
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: baseline ? 'reproduced' : 'passed', checks, source, sourceSha256: createHash('sha256').update(original).digest('hex'), button: button.id, child: added, errors }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  const dragEvents = await page?.evaluate(() => (window as any).__parentDropEvents).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, errors, dragEvents, error: String(error) }, null, 2));
  throw error;
} finally { await close(); await server?.close(); console.log(output); }
