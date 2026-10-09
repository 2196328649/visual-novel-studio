import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph } from '../src/core/blueprint';
import { projectSchema } from '../src/core/model';
import { createGalleryFixture } from './lib/gallery-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.'), output = path.join(process.env.VNS_ARTIFACT_ROOT??path.join(root,'artifacts'), 'ui-gallery-preview', new Date().toISOString().replaceAll(':', '-'));
const fixture = path.join(output, 'project'), projectFile = path.join(fixture, 'project.vns.json');
const project = await createGalleryFixture(fixture);
const gallery = project.ui.components.find(c => c.id === 'test_gallery')!;
gallery.list!.galleryShowControls = true;
project.ui.pages!.main = { layout: 'custom' };
project.ui.components.push({ id: 'open_gallery', kind: 'button', page: 'main', text: '进入图鉴', action: 'gallery', x: .2, y: .3, width: .6, height: .3, style: { fontSize: 64 } },
  { id: 'gallery_return', kind: 'button', page: 'gallery', text: '返回标题', action: 'return', x: .7, y: .015, width: .25, height: .08, style: { fontSize: 36 } });
project.variables.push({ id: 'key_count', name: '页面按键', type: 'number', initial: 0, persistent: false });
const graph = createBlueprintGraph('ui', '图鉴按键'), key = blueprintNodeDefaults('eventKey'), set = blueprintNodeDefaults('setVariable');
key.properties = { pageId: 'ui:gallery', key: 'K_RIGHT' }; set.properties = { variableId: 'key_count', value: 1 };
graph.nodes.push(key, set); connectBlueprintPins(graph, key.id, 'exec', set.id, 'exec_in'); project.blueprints.push(graph);
await fs.writeFile(projectFile, JSON.stringify(projectSchema.parse(project)));
const app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') }), page = await app.firstWindow(), errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByRole('button', { name: '高级 UI 蓝图', exact: true }).click();
  await page.locator('.ui-logic-preview > summary').click();
  const divider = page.getByRole('separator', { name: '调整画布与页面设置高度', exact: true });
  for (let i = 0; i < 18; i++) await divider.press('ArrowUp');
  const before = await fs.readFile(projectFile, 'utf8'), frame = page.getByLabel('参数联动预演画面', { exact: true });
  const pageName = page.getByLabel('当前预演页面', { exact: true }), detail = frame.locator('.ui-gallery-detail-preview');
  await frame.getByRole('button', { name: '进入图鉴', exact: true }).click();
  await expect(pageName).toHaveText('画廊');
  await expect(frame.locator('[data-gallery-group]')).toHaveCount(8);
  await expect(frame.locator('[data-gallery-page]')).toHaveCount(12);
  await expect(frame.locator('[data-gallery-thumbnail]').first()).toHaveAttribute('src', /thumb\.png/);
  await expect.poll(() => frame.locator('[data-gallery-thumbnail]').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await frame.getByRole('button', { name: '打开图鉴 第 1 组', exact: true }).click();
  await expect(detail.locator('img')).toHaveAttribute('data-gallery-detail-asset', 'full_c');
  await expect(detail.locator('img')).toHaveCSS('object-fit', 'cover');
  await expect(detail.getByRole('button', { name: '查看下一张图鉴', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(detail.locator('img')).toHaveAttribute('data-gallery-detail-asset', 'full_a');
  await expect(page.getByLabel('预演参数 页面按键', { exact: true })).toHaveValue('0');
  await expect(frame.locator('[inert]')).toHaveCount(1);
  await detail.getByRole('button', { name: '上一张', exact: true }).click();
  await expect(detail.locator('img')).toHaveAttribute('data-gallery-detail-asset', 'full_c');
  await detail.getByRole('button', { name: '下一张', exact: true }).click();
  await detail.getByRole('button', { name: '下一张', exact: true }).click();
  await expect(detail.locator('img')).toHaveAttribute('data-gallery-detail-asset', 'full_b');
  await detail.getByRole('button', { name: '下一张', exact: true }).click();
  await expect(detail).toHaveCount(0);
  await expect(frame.getByRole('button', { name: '打开图鉴 第 1 组', exact: true })).toBeFocused();
  await frame.focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('预演参数 页面按键', { exact: true })).toHaveValue('1');
  await frame.getByRole('button', { name: '图鉴第 12 页', exact: true }).click();
  await expect(frame.locator('[data-gallery-group]')).toHaveCount(6);
  await expect(frame.getByRole('button', { name: '图鉴第 12 页', exact: true })).toHaveAttribute('aria-current', 'page');
  await frame.getByRole('button', { name: '打开图鉴 第 94 组', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  await expect(frame.getByRole('button', { name: '打开图鉴 第 94 组', exact: true })).toBeVisible();
  await frame.getByRole('button', { name: '打开图鉴 第 94 组', exact: true }).click();
  await detail.getByRole('button', { name: '查看下一张图鉴', exact: true }).click({ button: 'right' });
  await expect(detail).toHaveCount(0);
  await frame.screenshot({ path: path.join(output, 'last-page-frame.png') });
  await page.screenshot({ path: path.join(output, 'last-page.png') });
  await frame.getByRole('button', { name: '返回标题', exact: true }).click();
  await frame.getByRole('button', { name: '进入图鉴', exact: true }).click();
  await expect(frame.getByRole('button', { name: '打开图鉴 第 1 组', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '恢复测试值', exact: true }).click();
  await frame.getByRole('button', { name: '进入图鉴', exact: true }).click();
  await page.getByText('图鉴测试数据', { exact: true }).click();
  await page.getByLabel('全部图片已解锁', { exact: true }).uncheck();
  await expect(page.getByLabel('图鉴测试解锁数量', { exact: true })).toHaveText('0 / 3');
  await expect(frame.getByRole('button', { name: '未解锁图鉴 第 1 组', exact: true })).toBeDisabled();
  for (const name of ['full_c', 'full_a']) {
    await page.getByRole('button', { name: '浏览添加已解锁图片', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '预览资源 ' + name, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '使用所选资源', exact: true }).click();
  }
  await expect(page.getByLabel('图鉴测试解锁数量', { exact: true })).toHaveText('2 / 3');
  await expect(frame.getByRole('button', { name: '未解锁图鉴 第 2 组', exact: true })).toBeDisabled();
  await frame.getByRole('button', { name: '打开图鉴 第 1 组', exact: true }).click();
  await expect(detail.getByLabel('当前图鉴分镜', { exact: true })).toHaveText('1 / 2');
  await expect(detail.locator('img')).toHaveAttribute('data-gallery-detail-asset', 'full_c');
  await detail.getByRole('button', { name: '下一张', exact: true }).click();
  await expect(detail.locator('img')).toHaveAttribute('data-gallery-detail-asset', 'full_a');
  await expect.poll(() => detail.locator('img').evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
  const shown = PNG.sync.read(await frame.screenshot({ path: path.join(output, 'partial-unlock-frame.png') }));
  // Inert content still paints: compare the actual detail with its underlay hidden.
  // This catches visual stacking failures that keyboard and click checks cannot.
  await frame.locator('[inert]').evaluate(element => (element as HTMLElement).style.visibility = 'hidden');
  let hidden: PNG;
  try { hidden = PNG.sync.read(await frame.screenshot()); }
  finally { await frame.locator('[inert]').evaluate(element => (element as HTMLElement).style.removeProperty('visibility')); }
  expect({ width: shown.width, height: shown.height }).toEqual({ width: hidden.width, height: hidden.height });
  let underlayPixels = 0;
  for (let i = 0; i < shown.data.length; i += 4) if (shown.data.subarray(i, i + 4).some((value, channel) => value !== hidden.data[i + channel])) underlayPixels++;
  expect(underlayPixels, '详情不得透出底层卡片、页码或返回按钮').toBe(0);
  await page.screenshot({ path: path.join(output, 'partial-unlock-detail.png') });
  await detail.getByRole('button', { name: '关闭图鉴详情', exact: true }).click();
  await page.getByRole('button', { name: '取消解锁 full_c', exact: true }).click();
  await expect(page.getByLabel('图鉴测试解锁数量', { exact: true })).toHaveText('1 / 3');
  await frame.getByRole('button', { name: '打开图鉴 第 1 组', exact: true }).click();
  await expect(detail.locator('img')).toHaveAttribute('data-gallery-detail-asset', 'full_a');
  await detail.getByRole('button', { name: '查看下一张图鉴', exact: true }).click();
  await expect(detail).toHaveCount(0);
  await page.getByRole('button', { name: '恢复测试值', exact: true }).click();
  await expect(pageName).toHaveText('标题');
  await expect(page.getByLabel('预演参数 页面按键', { exact: true })).toHaveValue('0');
  await frame.getByRole('button', { name: '进入图鉴', exact: true }).click();
  await page.getByText('图鉴测试数据', { exact: true }).click();
  await expect(page.getByLabel('全部图片已解锁', { exact: true })).toBeChecked();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  expect(await fs.readFile(projectFile, 'utf8')).toBe(before); expect(errors).toEqual([]);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', compiledBuild: true, underlayPixels, checks: ['高级UI从标题进入图鉴，独立缩略图与94组12页', '详情顺序/上一张/末张返回，方向键不触发底层蓝图', 'Esc/右键/关闭返回当前页，焦点恢复，离页重入第一页', '测试解锁筛选只显示可用分镜，清空与恢复', '详情逐像素确认底层卡片、页码与返回按钮不透出', '全程不修改UI草稿与磁盘'], errors }, null, 2));
  console.log(output);
} catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); throw error; }
finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => undefined); await app.close(); }
