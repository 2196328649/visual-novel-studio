import { setUiCanvasPreview } from './lib/ui-design-controls';
import { openDisclosureAncestors } from './lib/ui-disclosures';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { launchDesktopFixture, installedExecutable } from './lib/desktop-fixture';

const root = path.resolve('.'), output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/flow-navigation-editor',
  'navigation-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const relativeOutput = path.relative(root, output);
assert.ok(relativeOutput && !path.isAbsolute(relativeOutput) && relativeOutput !== '..' && !relativeOutput.startsWith('..' + path.sep), 'Acceptance output must remain inside this checkout.');
const source = installedExecutable ? path.join(path.dirname(installedExecutable), 'resources/resources/templates/aihong') : path.join(root, 'resources/templates/aihong');
const directory = path.join(output, 'project'), projectFile = path.join(directory, 'project.vns.json');
await fs.cp(source, directory, { recursive: true });
const original = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const originalFlow = original.ui.components.find(c => c.id === 'ai_flowchart_items')!;
// Opt the passages in so the map is long enough to scroll.
for (const node of original.nodes) if (node.kind === 'passage' || node.kind === 'choice') node.flowchart = { ...node.flowchart, visible: true };
await fs.writeFile(projectFile, JSON.stringify(original));
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch';
const checks: string[] = [], errors: string[] = [];
const evidence: Record<string, unknown> = {};
const inspector = () => page!.locator('.ui-inspector[data-ui-flow-view]');
const view = () => inspector().locator('.ui-inspector-view:not([hidden])');
const field = (name: string) => view().getByLabel(name, { exact: true });
const group = (id: string) => view().locator(`[data-ui-inspector-group="${id}"]`);
const openGroup = async (id: string) => { await openDisclosureAncestors(group(id).locator(':scope > summary')); };
const map = async () => {
  if (await inspector().getAttribute('data-ui-flow-view') !== 'map') await inspector().getByRole('button', { name: '返回整张图设置', exact: true }).click();
  await expect(inspector()).toHaveAttribute('data-ui-flow-view', 'map');
};
const base = async () => {
  await map(); await openGroup('flow-style'); await view().getByRole('button', { name: /^本图基础外观/ }).click();
  await expect(inspector()).toHaveAttribute('data-ui-flow-view', 'base');
};
const progress = async (mode: string) => {
  await page!.getByRole('button', { name: '剧情图预览', exact: true }).click();
  const dialog = page!.getByRole('dialog', { name: '剧情图预览', exact: true });
  await dialog.getByLabel('预览玩家进度', { exact: true }).selectOption(mode);
  await dialog.getByRole('button', { name: '关闭剧情图预览', exact: true }).click();
};
const save = async () => { await page!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0, { timeout: 45000 }); };
const captureCanvas = async (name: string) => {
  // Capture the visible canvas without locator.screenshot scrolling its outer
  // viewport. Keep a geometry stability assertion independent of the capture.
  const frames = await page!.locator('.ui-canvas').evaluate(async element => {
    const frames: { x: number; y: number; width: number; height: number }[] = [];
    for (let i = 0; i < 4; i++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const { x, y, width, height } = element.getBoundingClientRect(); frames.push({ x, y, width, height });
    }
    return frames;
  });
  for (const frame of frames.slice(1)) for (const key of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(frame[key] - frames[0][key]) <= 1, `Unstable canvas ${name}: ${JSON.stringify(frames)}`);
  evidence[`capture-${name}`] = frames;
  const image = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(image, 'base64'));
};
const launch = async () => {
  app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile });
  page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  await expect(page.locator('.project-title strong')).toHaveText(original.name);
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window.isMaximized()) window.unmaximize();
    window.webContents.setBackgroundThrottling(false);
    window.setContentSize(1600, 1000);
  });
  await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByLabel('界面编辑模式').getByRole('button', { name: '设计', exact: true }).click();
  await page.getByLabel('设计页面', { exact: true }).selectOption('flowchart');
  await page.locator('[data-hierarchy-id="ai_flowchart_items"]').click();
  await expect(inspector()).toHaveAttribute('data-ui-flow-view', 'map');
  await openGroup('flow-layout');
  await openGroup('flow-browsing');
  if (await field('流程图排列').inputValue() === 'flow') {
    await openGroup('flow-layout-scroll-region');
    await openGroup('flow-layout-main-scrollbar');
    await openGroup('flow-player-current-marker');
  }
};
try {
  await launch();
  const viewport = page!.locator('.ui-story-flow-preview'), horizontal = page!.getByRole('scrollbar', { name: '流程图横向滚动条', exact: true });
  await base();
  await expect(field('基础文字黑底方式')).toHaveValue('soft');
  await expect(field('黑底柔和度')).toHaveValue('14');
  // Selecting the detailed editor exposes exact offsets without rewriting them.
  await field('基础文字黑底方式').selectOption('custom');
  await expect(field('阴影垂直偏移')).toHaveValue('0');
  await expect(field('阴影水平偏移')).toHaveValue('0');
  await expect(field('阴影柔化')).toHaveValue('14');
  await map();
  await expect(field('滑块缩放')).toHaveValue('nineSlice');
  await expect(field('滑块左边距')).toHaveValue('24');
  await expect(field('滑块右边距')).toHaveValue('24');
  const caption = page!.locator('[data-flow-node]').first();
  await expect(caption.locator('[data-flow-caption-shadow]')).toBeVisible();
  const thumbSkin = horizontal.locator('[data-flow-scrollbar-thumb] .ui-skin-image');
  const edgeWidths = await thumbSkin.evaluate(element => { const style = getComputedStyle(element); return { left: style.borderLeftWidth, right: style.borderRightWidth, slice: style.borderImageSlice }; });
  assert.equal(edgeWidths.slice, '0 23 0 24 fill');
  await captureCanvas('00-soft-shadow-nine-slice');
  await base(); await field('基础文字黑底方式').selectOption('custom');
  await field('阴影柔化').fill('14');
  await field('阴影水平偏移').fill('-4');
  await field('阴影水平偏移').press('Tab');
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0, { timeout: 45000 });
  checks.push('默认流程文字使用居中柔和外圈阴影；柔化可编辑保存，滑块使用原图24像素两端和可伸缩中段。');
  await map();
  phase = 'original geometry and drag';
  await expect(field('显示缩放与定位按钮')).not.toBeChecked();
  await expect(field('显示竖向滚动条')).not.toBeChecked();
  await expect(page!.locator('[data-flow-controls]')).toHaveCount(0);
  await expect(page!.getByRole('scrollbar')).toHaveCount(1);
  const canvas = await page!.locator('.ui-canvas').boundingBox(), rail = await horizontal.boundingBox();
  assert.ok(canvas && rail);
  assert.ok(originalFlow.list!.flowScrollbar!.rect);
  assert.ok(Math.abs((rail.x - canvas.x) / canvas.width - originalFlow.list!.flowScrollbar!.rect.x) < .002);
  assert.ok(Math.abs(rail.width / canvas.width - 733 / 1920) < .002);
  await captureCanvas('01-template');
  await horizontal.hover();
  await expect(horizontal).toHaveAttribute('data-scroll-state', 'hover');
  const thumb = await horizontal.locator('[data-flow-scrollbar-thumb]').boundingBox(); assert.ok(thumb);
  await page!.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2); await page!.mouse.down();
  await expect(horizontal).toHaveAttribute('data-scroll-state', 'pressed');
  await page!.mouse.move(rail.x + rail.width - 1, rail.y + rail.height / 2, { steps: 16 }); await page!.mouse.up();
  await expect.poll(() => viewport.evaluate(el => el.scrollLeft / (el.scrollWidth - el.clientWidth))).toBeGreaterThan(.9);
  await horizontal.press('Home'); await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBe(0);
  await viewport.hover(); await page!.mouse.wheel(0, 260);
  await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBeGreaterThan(200);
  const beforePan = await viewport.evaluate(el => el.scrollLeft), panBounds = await viewport.boundingBox(); assert.ok(panBounds);
  await page!.mouse.move(panBounds.x + 200, panBounds.y + 80); await page!.mouse.down({ button: 'middle' });
  await page!.mouse.move(panBounds.x + 100, panBounds.y + 80, { steps: 8 }); await page!.mouse.up({ button: 'middle' });
  await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBeGreaterThan(beforePan + 80);
  await expect(page!.locator('.dirty-dot')).toHaveCount(0, { timeout: 45000 });
  checks.push('模板预览使用原始轨道位置；真实拖动、按下/悬停、Home 和横向滚轮有效，导航不移动组件或弄脏工程。');

  phase = 'authored layout and states';
  await expect(page!.locator('[data-flow-current-marker]')).toHaveCount(0);
  await progress('current');
  const nodeCount = await page!.locator('[data-flow-node]').count();
  assert.ok(nodeCount > 0);
  await expect(page!.locator('[data-flow-current-marker]')).toHaveCount(1);
  await captureCanvas('02-current-marker');
  await field('当前位置标记区域横向 %').fill('-6');
  await progress('all');
  await expect(page!.locator('[data-flow-current-marker]')).toHaveCount(0);
  await field('主滚动条纵向 %').fill('90');
  await field('主滚动条高度 %').fill('5');
  await field('滚动滑块高度').fill('20');
  await field('滚动条轨道厚度').fill('3');
  await openGroup('flow-layout-scroll-brightness');
  await field('滚动滑块按住亮度 %').fill('65');
  await field('显示缩放与定位按钮').check();
  await field('显示竖向滚动条').check();
  await expect(page!.getByRole('scrollbar')).toHaveCount(2);
  await page!.getByRole('button', { name: '放大流程图', exact: true }).click();
  await expect(page!.locator('[data-flow-controls]')).toContainText('110%');
  await page!.getByRole('button', { name: '定位当前位置', exact: true }).click();
  await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBe(0);
  const resizedEdges = await thumbSkin.evaluate(element => { const style = getComputedStyle(element); return { left: style.borderLeftWidth, right: style.borderRightWidth }; });
  assert.deepEqual(resizedEdges, { left: edgeWidths.left, right: edgeWidths.right });
  for (const state of ['pressed', 'disabled', 'idle']) {
    await setUiCanvasPreview(page!, '按钮预览状态', state);
    if (state !== 'idle') await expect(horizontal).toHaveAttribute('data-scroll-state', state);
    await captureCanvas(`02-${state}`);
  }
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0, { timeout: 45000 });
  const saved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))), changed = saved.ui.components.find(c => c.id === originalFlow.id)!;
  assert.deepEqual([changed.x, changed.y, changed.width, changed.height], [originalFlow.x, originalFlow.y, originalFlow.width, originalFlow.height]);
  assert.ok(changed.list!.flowScrollbar!.rect);
  assert.equal(changed.list!.flowScrollbar!.rect.y, .9); assert.equal(changed.list!.flowScrollbar!.rect.height, .05);
  assert.equal(changed.list!.flowScrollbar!.thumbHeight, 20); assert.equal(changed.list!.flowScrollbar!.trackHeight, 3);
  assert.equal(changed.list!.flowScrollbar!.thumb!.brightness!.pressed, .65);
  assert.equal(changed.list!.flowShowControls, true); assert.equal(changed.list!.flowShowVerticalScrollbar, true);
  assert.equal(changed.list!.flowCurrentMarker!.assetId, originalFlow.list!.flowCurrentMarker!.assetId);
  assert.equal(changed.list!.flowCurrentMarker!.rect.x, -.06);
  checks.push('轨道位置/厚度、滑块高度/按下亮度及导航按钮可编辑、预览并由真实保存入口写入工程。');
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy()));
  await app!.close(); app = undefined;
  phase = 'reopen and default fallback'; await launch();
  await base();
  await expect(field('阴影水平偏移')).toHaveValue('-4');
  await expect(field('阴影柔化')).toHaveValue('14');
  await map();
  await expect(field('滑块缩放')).toHaveValue('nineSlice');
  await expect(field('当前位置标记区域横向 %')).toHaveValue('-6');
  await progress('current');
  await expect(page!.locator('[data-flow-current-marker]')).toHaveCount(1);
  await progress('all');
  checks.push('当前位置标记仅在选中预览显示；素材及编辑后的区域通过保存和完整重开保留。');
  await expect(field('主滚动条纵向 %')).toHaveValue('90');
  await expect(field('滚动滑块高度')).toHaveValue('20');
  await field('自定义主滚动条位置').uncheck();
  await expect(page!.getByRole('scrollbar')).toHaveCount(2);
  await page!.getByRole('scrollbar', { name: '流程图横向滚动条', exact: true }).press('End');
  await expect.poll(() => page!.locator('.ui-story-flow-preview').evaluate(el => el.scrollLeft / (el.scrollWidth - el.clientWidth))).toBeGreaterThan(.95);
  await captureCanvas('03-default-navigation');
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0, { timeout: 45000 });
  const restoredScroll = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))).ui.components.find(c => c.id === originalFlow.id)!.list!.flowScrollbar;
  assert.ok(restoredScroll);
  const { rect: oldScrollRect, ...savedScrollAppearance } = changed.list!.flowScrollbar!;
  assert.ok(oldScrollRect);
  assert.deepEqual(restoredScroll, savedScrollAppearance);
  await expect(field('滑块缩放')).toHaveValue('nineSlice');
  await expect(field('滚动滑块高度')).toHaveValue('20');
  await view().getByRole('button', { name: '恢复覆盖整个节点', exact: true }).click();
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0, { timeout: 45000 });
  const restoredMarker = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))).ui.components.find(c => c.id === originalFlow.id)!.list!.flowCurrentMarker;
  assert.equal(restoredMarker?.assetId, originalFlow.list!.flowCurrentMarker!.assetId);
  assert.deepEqual(restoredMarker?.rect, { x: 0, y: 0, width: 1, height: 1 });
  checks.push('完整关闭重开保留设置；取消自定义位置后轨道自动排列，图片、尺寸和亮度保留且可滚动到结尾；恢复标记位置保留其图片。');

  phase = 'directory pagination style and geometry';
  await field('流程图排列').selectOption('grid');
  await openGroup('flow-layout');
  await field('每行数量').fill('1'); await field('每页行数（0 为滚动）').fill('1');
  await openGroup('flow-browsing'); await openGroup('flow-layout-pagination');
  await field('翻页方式').selectOption('numbers');
  // Earlier real saves organize assets into project folders. Resolve the same
  // stable asset ID from the saved project, not its pre-save template path.
  const savedAssets = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))).assets;
  const pageImage = savedAssets.find(asset => asset.id === originalFlow.skin?.idle)!;
  assert.ok(pageImage);
  for (const name of ['页码背景图片', '当前页背景图片']) {
    await view().getByRole('button', { name: `浏览${name}`, exact: true }).click();
    const browser = page!.getByRole('dialog', { name: `${name}资源浏览器`, exact: true });
    await browser.getByLabel('搜索可选资源', { exact: true }).fill(pageImage.path);
    await browser.getByRole('button', { name: `预览资源 ${pageImage.name}`, exact: true }).dblclick();
    await expect(browser).toHaveCount(0);
    await expect(field(name)).toHaveValue(pageImage.name);
  }
  await field('自定义翻页按钮区域位置').check();
  for (const [dimension, value] of [['横向', '25'], ['纵向', '85'], ['宽度', '50'], ['高度', '6']]) await field(`翻页按钮区域${dimension} %`).fill(value);
  await field('翻页按钮区域高度 %').press('Tab');
  const pagination = () => page!.locator('[data-component-id="ai_flowchart_items"] [data-flow-pagination]');
  const paginationGeometry = async () => {
    const parent = (await page!.locator('[data-component-id="ai_flowchart_items"]').boundingBox())!, rect = (await pagination().boundingBox())!;
    return { x: (rect.x - parent.x) / parent.width, y: (rect.y - parent.y) / parent.height, width: rect.width / parent.width, height: rect.height / parent.height };
  };
  const customPagination = await paginationGeometry();
  for (const [key, value] of Object.entries({ x: .25, y: .85, width: .5, height: .06 })) assert.ok(Math.abs(customPagination[key as keyof typeof customPagination] - value) < .003, JSON.stringify(customPagination));
  await field('翻页方式').selectOption('previousNext');
  await expect(pagination().getByRole('button', { name: '剧情目录下一页', exact: true })).toBeVisible();
  assert.deepEqual(await paginationGeometry(), customPagination);
  await field('翻页方式').selectOption('numbers');
  await field('自定义翻页按钮区域位置').uncheck();
  await expect(field('翻页方式')).toHaveValue('numbers');
  await expect(field('页码背景图片')).toHaveValue(pageImage.name);
  await expect(field('当前页背景图片')).toHaveValue(pageImage.name);
  await expect(pagination().getByRole('button', { name: '剧情目录第 2 页', exact: true })).toBeVisible();
  await pagination().getByRole('button', { name: '剧情目录第 2 页', exact: true }).click();
  await expect(pagination().getByRole('button', { name: '剧情目录第 2 页', exact: true })).toHaveAttribute('aria-current', 'page');
  const automaticPagination = await paginationGeometry();
  assert.ok(Math.abs(automaticPagination.x) < .003 && Math.abs(automaticPagination.width - 1) < .003 && Math.abs(automaticPagination.y + automaticPagination.height - 1) < .003 && automaticPagination.height > 0, JSON.stringify(automaticPagination));
  evidence.pagination = { custom: customPagination, automatic: automaticPagination };
  await save();
  const directorySaved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))).ui.components.find(c => c.id === originalFlow.id)!;
  assert.equal(directorySaved.list?.flowPaginationStyle, 'numbers'); assert.equal(directorySaved.list?.navigationRect, undefined);
  assert.deepEqual(directorySaved.list?.pageSkin, { idle: pageImage.id, selected: pageImage.id });
  assert.deepEqual(directorySaved.list?.flowScrollbar, restoredScroll);
  await captureCanvas('04-automatic-number-pagination');
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy()));
  await app!.close(); app = undefined; await launch();
  await openGroup('flow-layout-pagination');
  await expect(field('翻页方式')).toHaveValue('numbers');
  await expect(field('自定义翻页按钮区域位置')).not.toBeChecked();
  await expect(field('页码背景图片')).toHaveValue(pageImage.name);
  await field('流程图排列').selectOption('flow'); await save();
  const branchRestored = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))).ui.components.find(c => c.id === originalFlow.id)!;
  assert.equal(branchRestored.list?.flowPaginationStyle, 'numbers'); assert.deepEqual(branchRestored.list?.pageSkin, directorySaved.list?.pageSkin);
  assert.deepEqual(branchRestored.list?.flowScrollbar, restoredScroll);
  assert.deepEqual([branchRestored.x, branchRestored.y, branchRestored.width, branchRestored.height], [originalFlow.x, originalFlow.y, originalFlow.width, originalFlow.height]);
  checks.push('目录分页的数字/前后按钮形态与区域独立；实际自定义及自动几何正确，恢复自动位置保留两张页码图片、保存重开与切回分支图均保留。');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', installedExecutable, projectFile, checks, evidence, errors }, null, 2));
  console.log(output);
} catch (error) {
  if (app && page && !page.isClosed()) await captureCanvas('failure').catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, evidence, errors, error: String(error) }, null, 2));
  console.log(output); throw error;
} finally {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined);
  await app?.close().catch(() => undefined);
  const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']);
  assert.deepEqual(cleanup.errors, []);
}
