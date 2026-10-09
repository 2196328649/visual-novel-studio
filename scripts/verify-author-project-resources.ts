import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { assetFiles, projectSchema } from '../src/core/model';
import { folderTrail } from '../src/core/content-browser';
import { applyTextScript } from '../src/core/text-script';
import { validateProject } from '../src/core/validate';
import { assetSourcePath } from '../src/desktop/project-store';
import type { RuntimeEvent } from '../src/core/bridge';
import { installedExecutable, launchDesktopFixture } from './lib/desktop-fixture';
import { projectGraphs } from '../src/core/project-resources';

const root = path.resolve('.');
// Match the portable profile's path depth: Ren'Py on Windows cannot traverse
// the author's Spine files below the much longer descriptive artifact path.
const output = path.resolve('artifacts/author-qa', Date.now().toString(36) + '-' + randomUUID().slice(0, 3));
const source = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? 'E:/Project/Visual Novel Studio/我的视觉小说1/project.vns.json');
const original = await fs.readFile(source), project = projectSchema.parse(JSON.parse(process.env.VNS_AUTHOR_CANDIDATE ? await fs.readFile(process.env.VNS_AUTHOR_CANDIDATE, 'utf8') : original.toString()));
const sourceSha256 = createHash('sha256').update(original).digest('hex');
// Preserve unfinished authoring in the real file; only the runtime fixture skips empty command prompts.
const omittedDraftLines = (project.scriptText?.content.split(/\r?\n/) ?? []).flatMap((line, index) => /^\s*[@/／]\s*$/.test(line) ? [index + 1] : []);
if (project.scriptText) project.scriptText.content = project.scriptText.content.split(/\r?\n/).filter((_line, index) => !omittedDraftLines.includes(index + 1)).join('\n');
const parsed = applyTextScript(project, project.scriptText?.content ?? '');
assert.deepEqual(parsed.issues.filter(issue => issue.severity === 'error'), []);
assert.deepEqual(validateProject(parsed.project).filter(issue => issue.severity === 'error'), []);
const image = project.blueprints.find(graph => graph.callName === '章节进入演出'); assert.ok(image);
assert.equal(project.blueprints.length, 2); assert.equal(project.timelinePresets?.length, 3);
assert.equal(image.exposedInputs.find(pin => pin.name === '章节题图')?.defaultValue, 'ai_presentation_title_one');
assert.equal(image.exposedInputs.find(pin => pin.name === '时长')?.defaultValue, 7);
const assetPaths = project.assets.flatMap(asset => assetFiles(asset).map(file => assetSourcePath(path.dirname(source), asset, file)));
const files = await Promise.allSettled(assetPaths.map(file => fs.access(file)));
assert.deepEqual(files.flatMap((file, index) => file.status === 'rejected' ? [assetPaths[index]] : []), []);
project.name += ' · 资源验收副本';
project.assets = project.assets.map(asset => ({ ...asset, externalPath: assetSourcePath(path.dirname(source), asset), externalFiles: Object.fromEntries(assetFiles(asset).map(file => [file, assetSourcePath(path.dirname(source), asset, file)])) }));
const projectFile = path.join(output, 'project/project.vns.json');
await fs.mkdir(path.dirname(projectFile), { recursive: true });
await fs.writeFile(projectFile, JSON.stringify(projectSchema.parse(project), null, 2));
const server = installedExecutable ? undefined : await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**', '**/work/**'] } } });
await server?.listen();
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch';
const errors: string[] = [], checks: string[] = [];
try {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile'), devUrl: server ? 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port : undefined });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, powerSaveBlocker }) => { powerSaveBlocker.start('prevent-display-sleep'); BrowserWindow.getAllWindows()[0].setContentSize(1500, 940); });
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.evaluate(() => { const state = window as any; state.__authorResourceEvents = []; window.studio!.onRuntimeEvent(event => state.__authorResourceEvents.push(event)); });
  await page.locator('[data-workspace-tab="assets"]').click();
  const browser = page.getByRole('region', { name: '资源管理器' });
  phase = 'author blueprints';
  await browser.getByRole('button', { name: '类型筛选' }).click(); await browser.getByLabel('筛选蓝图', { exact: true }).check();
  await browser.getByLabel('资源显示范围', { exact: true }).selectOption('all');
  await browser.getByRole('button', { name: '类型筛选', exact: true }).click();
  await expect(browser.locator('.content-items [data-content-key]')).toHaveCount(2);
  await browser.locator(`[data-content-key="blueprint:${image.id}"]`).click();
  await expect(browser.locator('.content-call-name')).toHaveText('@章节进入演出');
  await page.screenshot({ path: path.join(output, '01-author-blueprints.png') });
  await browser.locator(`[data-content-key="blueprint:${image.id}"]`).dblclick();
  const properties = page.getByRole('button', { name: '展开蓝图属性', exact: true }); if (await properties.count()) await properties.click();
  await page.getByRole('button', { name: '输入与输出', exact: true }).click();
  await expect(page.getByLabel('蓝图调用名称', { exact: true })).toHaveValue('章节进入演出');
  await expect(page.getByLabel('时长的默认值', { exact: true })).toHaveValue('7');
  await expect(page.getByLabel('章节题图的默认值', { exact: true })).toHaveValue('章节题字 · 记第一回 醉梦');
  await page.screenshot({ path: path.join(output, '01-author-defaults.png') });
  await page.locator('[data-workspace-tab="assets"]').click();
  await browser.getByLabel('资源显示范围', { exact: true }).selectOption('all');
  await browser.getByRole('button', { name: '类型筛选', exact: true }).click();
  if (await browser.getByRole('button', { name: '显示全部类型', exact: true }).isEnabled()) await browser.getByRole('button', { name: '显示全部类型', exact: true }).click();
  await browser.getByLabel('筛选时间轴预设', { exact: true }).check();
  await browser.getByRole('button', { name: '类型筛选', exact: true }).click();
  await expect(browser.locator('.content-item.timeline')).toHaveCount(3); await expect(browser.locator('.content-item.blueprint')).toHaveCount(0);
  await browser.locator('[data-content-key="timeline:builtin_chapter_text_timeline"]').click();
  await expect(browser.locator('.content-details')).toContainText('调用方：章节进入演出文字版');
  await page.screenshot({ path: path.join(output, '01-author-timelines.png') });
  checks.push('作者工程的两张蓝图与三项时间轴预设分类独立；图片版显示 @章节进入演出，默认题图和 7 秒时长可见，子时间轴标明调用方。');

  phase = 'author folders and images';
  await browser.getByRole('button', { name: '类型筛选' }).click();
  if (await browser.getByRole('button', { name: '显示全部类型', exact: true }).isEnabled()) await browser.getByRole('button', { name: '显示全部类型', exact: true }).click();
  await browser.getByRole('button', { name: '类型筛选' }).click();
  await browser.locator('.content-breadcrumb').getByRole('button', { name: '项目资源', exact: true }).click();
  await page.screenshot({ path: path.join(output, '02-author-folders.png') });
  const asset = project.assets.find(asset => asset.kind === 'image' && project.contentBrowser?.assignments['asset:' + asset.id]); assert.ok(asset);
  for (const folder of folderTrail(project, project.contentBrowser!.assignments['asset:' + asset.id])) await browser.locator(`[data-content-key="folder:${folder.id}"]`).dblclick();
  await browser.locator(`[data-content-key="asset:${asset.id}"]`).click();
  await expect.poll(() => browser.locator('.content-items').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const images = [...element.querySelectorAll<HTMLImageElement>('.content-thumbnail img')].filter(image => { const rect = image.getBoundingClientRect(); return rect.bottom > bounds.top && rect.top < bounds.bottom; });
    return images.length > 0 && images.every(image => image.complete && image.naturalWidth > 0);
  })).toBe(true);
  const dimensions = await browser.locator('.content-items [data-content-key]').evaluateAll(elements => elements.map(element => {
    const card = element.getBoundingClientRect(), thumbnail = element.querySelector('.content-thumbnail')!.getBoundingClientRect();
    return { card: [card.width, card.height], thumbnail: [thumbnail.width, thumbnail.height] };
  }));
  assert.ok(dimensions.length);
  for (const item of dimensions) { assert.deepEqual(item, dimensions[0]); assert.ok(Math.abs(item.thumbnail[0] - item.thumbnail[1]) < .5); }
  await page.screenshot({ path: path.join(output, '03-author-images.png') });
  checks.push(`原工程 ${project.assets.length} 项素材、${assetPaths.length} 个文件均可读取；实际图片和文件夹使用相同尺寸卡片，预览正常。`);

  phase = 'author preview';
  await page.getByRole('button', { name: '试玩', exact: true }).click();
  await expect(page.locator('.play-workspace')).toHaveAttribute('data-preview-state', /running|failed/, { timeout: 90000 });
  assert.equal(await page.locator('.play-workspace').getAttribute('data-preview-state'), 'running', await page.locator('.play-workspace').innerText());
  const runtime = await page.evaluate(() => (window as any).__authorResourceEvents as RuntimeEvent[]);
  assert.ok(runtime.some(event => event.kind === 'preview' && event.phase === 'running' && event.windowId));
  await page.getByRole('button', { name: '项目窗口', exact: true }).click();
  await expect(page.locator('.project-browser')).toBeVisible(); await expect(page.locator('.play-workspace')).toHaveCount(0);
  const reopened = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  assert.equal(reopened.blueprints.length, 2); assert.equal(reopened.timelinePresets?.length, 3);
  for (const graph of projectGraphs(project)) assert.deepEqual(projectGraphs(reopened).find(item => item.id === graph.id)?.exposedInputs, graph.exposedInputs);
  checks.push('保存后的作者工程保持全部公开参数，能够启动真实试玩，打开项目窗口后正常退出游戏。');
  assert.deepEqual(await fs.readFile(source), original); assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', source, sourceSha256, projectFile, installedExecutable, omittedDraftLines, checks, errors, dimensions, runtime }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  const runtime = await page?.evaluate(() => ((window as any).__authorResourceEvents ?? []).slice(-50)).catch(() => []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, source, sourceSha256, error: String(error), checks, errors, runtime }, null, 2)); throw error;
} finally {
  await page?.evaluate(() => window.studio?.controlPreview?.('stop')).catch(() => {});
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
  await app?.close().catch(() => {}); await server?.close();
  assert.deepEqual(await fs.readFile(source), original); console.log(output);
}
