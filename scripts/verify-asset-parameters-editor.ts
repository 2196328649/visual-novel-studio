// Authoring path for image parameters: add from the parameter panel's 素材 menu, pick the
// initial image, bind an image component's 图片来源 to it, and see the bound image on the canvas.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createProject, projectSchema, type Project } from '../src/core/model';
import { projectToText } from '../src/core/text-script';
import { compileProject } from '../src/runtime/compiler';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openDisclosure } from './lib/ui-disclosures';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

const root = path.resolve('.'), output = path.join(root, 'artifacts/asset-parameters-editor', new Date().toISOString().replaceAll(':', '-'));
const projectDir = path.join(output, 'project'), projectFile = path.join(projectDir, 'project.vns.json');
const report: { status: string; checks: string[]; error?: string; cleanup?: unknown } = { status: 'running', checks: [] };
await fs.mkdir(path.join(projectDir, 'assets'), { recursive: true });
const example = projectSchema.parse(JSON.parse(await fs.readFile(path.join(root, 'resources/example/project.vns.json'), 'utf8')));
const [imageA, imageB] = example.assets.filter(asset => asset.kind === 'image');
const project = createProject('素材参数编辑验收');
project.assets = [{ ...imageA, name: '头像甲' }, { ...imageB, name: '头像乙' }];
for (const asset of project.assets) await fs.copyFile(path.join(root, 'resources/example', asset.path), path.join(projectDir, asset.path));
project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
await fs.writeFile(projectFile, JSON.stringify(projectSchema.parse(project)));
const app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') }), page = await app.firstWindow();
const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
const saved = async () => JSON.parse(await fs.readFile(projectFile, 'utf8')) as Project;
async function visibleImage(assetId: string) {
  const probe = page.locator(`.ui-canvas img[data-ui-image-probe="${assetId}"]`);
  await expect.poll(() => probe.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0), { timeout: 15000 }).toBe(true);
  await expect(page.locator(`.ui-canvas [data-ui-image-source="${assetId}"] image`).first()).toBeVisible();
}
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await page.locator('[data-workspace-tab="variables"]').click();
  await page.locator('.parameter-set-card').filter({ hasText: '故事状态' }).click();
  await page.locator('.toolbar-menu > summary').filter({ hasText: '素材' }).click();
  await page.getByRole('group', { name: '素材', exact: true }).getByRole('button', { name: '图片', exact: true }).click();
  const detail = page.getByRole('complementary', { name: '参数设置', exact: true });
  await expect(detail.getByLabel('参数类型', { exact: true })).toHaveValue('image');
  await detail.getByLabel('参数名称', { exact: true }).fill('头像');
  await detail.getByRole('button', { name: '浏览初始值', exact: true }).click();
  await page.getByRole('dialog', { name: '初始值资源浏览器', exact: true }).getByRole('button', { name: '预览资源 头像甲', exact: true }).dblclick();
  await expect(page.locator('.parameter-table button.selected')).toContainText('头像甲');
  await expect(detail.getByRole('heading', { name: '如何使用' })).toBeVisible();
  await expect(detail.locator('summary').filter({ hasText: '界面控件' })).toHaveCount(0);
  await page.screenshot({ path: path.join(output, '01-image-parameter.png') });
  await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const variable = (await saved()).variables.find(item => item.name === '头像');
  assert.deepEqual(variable && { type: variable.type, assetKind: variable.assetKind, initial: variable.initial }, { type: 'asset', assetKind: 'image', initial: imageA.id });
  report.checks.push('从参数集“素材”菜单添加图片参数，初始值在资源浏览器中选择，列表显示素材名，不出现玩家控件设置。');

  await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  await page.getByLabel('添加组件菜单', { exact: true }).getByRole('button', { name: '图片', exact: true }).click();
  await page.getByLabel('图片来源', { exact: true }).selectOption({ label: '参数：头像' });
  await expect(page.getByText('参数为空时显示', { exact: true })).toBeVisible();
  await expect(page.locator(`.ui-canvas [data-ui-image-source="${imageA.id}"]`)).toHaveCount(1);
  await visibleImage(imageA.id);
  await openDisclosure(page, '内容与素材');
  await page.screenshot({ path: path.join(output, '02-bound-image.png') });
  await page.getByRole('button', { name: '保存界面', exact: true }).click();
  await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
  // Change only the parameter: the canvas must follow it, not the component's own image.
  await page.locator('[data-workspace-tab="variables"]').click();
  const storySet = page.locator('.parameter-set-card').filter({ hasText: '故事状态' });
  if (await storySet.isVisible()) await storySet.click();
  await page.locator('.parameter-table button').filter({ hasText: '头像' }).click();
  await detail.getByRole('button', { name: '浏览初始值', exact: true }).click();
  await page.getByRole('dialog', { name: '初始值资源浏览器', exact: true }).getByRole('button', { name: '预览资源 头像乙', exact: true }).dblclick();
  await expect(page.locator('.parameter-table button.selected')).toContainText('头像乙');
  await page.locator('[data-workspace-tab="ui"]').click();
  await expect(page.locator(`.ui-canvas [data-ui-image-source="${imageB.id}"]`)).toHaveCount(1);
  await visibleImage(imageB.id);
  await page.screenshot({ path: path.join(output, '03-canvas-follows-parameter.png') });
  await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const final = projectSchema.parse(await saved());
  const component = final.ui.components.find(item => item.kind === 'image');
  assert.equal(component?.assetParameterId, variable!.id);
  assert.notEqual(component?.assetId, imageB.id);
  assert.equal(final.variables.find(item => item.id === variable!.id)?.initial, imageB.id);
  assert.deepEqual(compileProject(final).diagnostics.filter(item => item.severity === 'error'), []);
  report.checks.push('图片组件的“图片来源”可选图片参数；只改参数初始值时画布随之切换（组件自身图片不变），保存后编译无错误。');
  assert.deepEqual(errors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1;
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
} finally {
  await app.close().catch(() => undefined);
  report.cleanup = await cleanVerificationDirectories(output, ['project', 'profile']).catch(error => String(error));
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(path.join(output, 'report.json'));
  if (report.error) console.error(report.error);
}
