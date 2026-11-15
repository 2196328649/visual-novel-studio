import { resetUiPanelLayout } from './lib/ui-design-controls';
import { selectUiDesignScheme, openUiPageOptions, openUiPageUsage } from './lib/ui-design-controls';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { projectSchema, uiInstanceSchema } from '../src/core/model';
import { createUiEventGraph } from '../src/core/ui-logic';
import { saveProject } from '../src/desktop/project-store';
import { createBlueprintTraceFixture } from './lib/blueprint-trace-fixture';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openUiPreviewWindow } from './lib/ui-preview-window';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Use only the isolated development editor for this acceptance.');
const root = path.resolve('.');
const output = path.join(root, 'artifacts/ui-header-unified', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json');
const builtRenderer = process.env.VNS_VERIFY_BUILT_RENDERER === '1';
const f = createBlueprintTraceFixture();
f.project.name = '界面布局验收';
f.root.name = '很长的自定义页面名称 · 操作说明与页面行为';
f.project.ui.instances = [
  uiInstanceSchema.parse({ id: 'header_base', name: '基础配色方案', components: [] }),
  uiInstanceSchema.parse({ id: 'header_derived', name: '很长的派生方案名称 · 夜间设置与交互选项', baseUiId: 'header_base', components: [] }),
];
f.project.ui.activeInstanceId = 'header_derived';
const derived = createUiEventGraph(f.project, 'ui:preferences', '派生方案设置事件');
f.project.ui.activeInstanceId = undefined;
const checks: string[] = [], errors: string[] = [], geometry: unknown[] = [], processes: { pid?: number; exited: boolean }[] = [];
const report: Record<string, unknown> = { status: 'running', renderer: builtRenderer ? 'built' : 'development', checks, errors, geometry, processes };
let app: ElectronApplication | undefined, page: Page | undefined, server: ViteDevServer | undefined, phase = 'setup';
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const mode = (name: string) => page!.getByLabel('界面编辑模式').getByRole('button', { name, exact: true });
const header = () => page!.locator('.ui-workspace > .ui-editor-header');
const canvasPanel = () => page!.locator('.ui-dock [data-dock-panel="canvas"]');
const canvasTitle = () => canvasPanel().locator(':scope > .performance-dock-title');
const zoom = () => canvasTitle().getByLabel('画面缩放比例', { exact: true });
const design = () => page!.getByLabel('界面设计画布', { exact: true });
const usageDialog = () => page!.getByRole('dialog', { name: '页面使用位置', exact: true });
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const record = (message: string) => { checks.push(message); console.log('PASS ' + checks.length + ': ' + message); };
const matrix = () => page!.locator('.react-flow__viewport').evaluate(element => {
  const value = new DOMMatrix(getComputedStyle(element).transform); return [value.a, value.d, value.e, value.f];
});
async function size(width: number, height = width === 1024 ? 768 : 960) {
  const window = await app!.browserWindow(page!);
  await window.evaluate((window, value) => {
    if (window.isMinimized()) window.restore();
    if (window.isMaximized()) window.unmaximize();
    window.setContentSize(value.width, value.height);
  }, { width, height });
  await expect.poll(async () => Math.abs(await page!.evaluate(() => innerWidth) - width)).toBeLessThanOrEqual(2);
}
async function checkCanvasTools() {
  await expect(canvasTitle().getByRole('group', { name: '画面缩放', exact: true })).toHaveCount(1);
  await expect(header().locator('.ui-zoom-controls')).toHaveCount(0);
  await expect.poll(() => canvasTitle().evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return element.scrollWidth <= element.clientWidth + 1 && [...element.querySelectorAll('button, select')].every(control => {
      const box = control.getBoundingClientRect();
      return box.width >= 28 && box.height >= 28 && box.left >= bounds.left - 1 && box.right <= bounds.right + 1 && box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1;
    });
  })).toBe(true);
}
async function fitDesign() {
  await canvasTitle().getByRole('button', { name: '适合窗口', exact: true }).click();
  await expect(zoom()).toHaveValue('fit');
  await expect.poll(() => design().evaluate(element => {
    const box = element.querySelector('[data-ui-zoom-surface]')!.getBoundingClientRect(), style = getComputedStyle(element);
    return box.width <= element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) + 1 && box.height <= element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) + 1;
  })).toBe(true);
}
async function capture(name: string, isDesign: boolean) {
  await expect(page!.locator('.ui-workspace > .workspace-toolbar')).toHaveCount(1);
  await expect(page!.locator('.ui-workspace > .ui-toolbar')).toHaveCount(0);
  await expect(header().getByRole('button', { name: '页面使用位置', exact: true })).toHaveCount(0);
  await expect(button('接入游戏')).toHaveCount(0);
  await expect(header().getByRole('button', { name: '保存界面', exact: true })).toBeVisible();
  await expect(header().getByRole('button', { name: '预览窗口', exact: true })).toBeEnabled();
  const value = await header().evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return { header: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, width: element.clientWidth, scroll: element.scrollWidth, groups: [...element.querySelectorAll('.ui-editor-mode-group, .ui-blueprint-page, .ui-editor-save-controls')].map(item => {
      const box = item.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height };
    }) };
  });
  expect(value.groups).toHaveLength(3);
  expect(value.header.height).toBeLessThanOrEqual(44.5);
  expect(value.scroll).toBeLessThanOrEqual(value.width + 1);
  for (const box of value.groups) {
    expect(Math.abs(box.y + box.height / 2 - value.header.y - value.header.height / 2)).toBeLessThanOrEqual(1);
    expect(box.x).toBeGreaterThanOrEqual(value.header.x);
    expect(box.x + box.width).toBeLessThanOrEqual(value.header.x + value.header.width + 1);
  }
  if (isDesign) { await checkCanvasTools(); await fitDesign(); }
  else await expect(page!.locator('.ui-zoom-controls')).toHaveCount(0);
  await expect.poll(() => page!.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  geometry.push({ name, ...value });
  await page!.locator('.ui-workspace').screenshot({ path: path.join(output, name + '.png') });
}
async function openDesign(pageId: string) {
  await mode('设计').click();
  await page!.getByLabel('设计页面', { exact: true }).selectOption(pageId.startsWith('ui:') ? pageId.slice(3) : pageId);
}

try {
  await fs.mkdir(path.dirname(projectFile), { recursive: true }); await saveProject(projectFile, f.project);
  const original = await read(), originalBytes = await fs.readFile(projectFile, 'utf8');
  if (!builtRenderer) { server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/work/**', '**/resources/**', '**/release/**'] } } }); await server.listen(); }
  const devUrl = server ? 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port : undefined;
  app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile, devUrl });
  page = await app.firstWindow(); page.setDefaultTimeout(18000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(f.project.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="ui"]').click(); await mode('设计').click();

  phase = 'single design header';
  for (const width of [1920, 1600, 1280, 1024]) { await size(width); await capture('design-' + width, true); }
  record('1920 / 1600 / 1280 / 1024 宽度均只有一行页面工具栏；页面、模式、预览和保存同排，缩放只在画布标题栏。');

  phase = 'secondary usage explanation';
  await expect(page.locator('.ui-dock [data-dock-panel="settings"]').getByRole('button', { name: '页面使用位置', exact: true })).toHaveCount(0);
  await openUiPageOptions(page);
  await button('页面使用位置').focus(); await page.keyboard.press('Enter');
  await expect(usageDialog()).toContainText('保存即可，无需额外设置');
  await expect(usageDialog()).toContainText('游戏启动 → 标题');
  await expect(usageDialog().getByLabel('页面接入位置')).toHaveValue('resource');
  await usageDialog().getByLabel('页面接入位置').selectOption('beforeTitle');
  await expect(usageDialog().getByRole('button', { name: '添加使用位置', exact: true })).toBeDisabled();
  await page.screenshot({ path: path.join(output, 'page-usages-explanation.png') });
  await page.keyboard.press('Escape'); await expect(usageDialog()).toHaveCount(0);
  await expect(button('页面选项')).toBeFocused(); await expect(button('保存界面')).toBeDisabled();
  record('页面使用位置是次级入口，说明内置页面只改外观无需设置；保留系统页限制，关闭后回焦且不产生草稿。');

  phase = 'zoom and docking';
  await zoom().selectOption('150');
  await expect.poll(() => page!.locator('[data-ui-zoom-surface]').evaluate(element => element.getBoundingClientRect().width)).toBeCloseTo(f.project.width * 1.5, 2);
  await canvasTitle().getByRole('button', { name: '缩小', exact: true }).click(); await expect.poll(async () => Number(await zoom().inputValue())).toBeLessThan(150);
  const zoomedOut = Number(await zoom().inputValue());
  await canvasTitle().getByRole('button', { name: '放大 (Ctrl+滚轮)', exact: true }).click(); await expect.poll(async () => Number(await zoom().inputValue())).toBeGreaterThan(zoomedOut);
  await fitDesign();
  await canvasTitle().locator(':scope > strong').dragTo(page.locator('.ui-dock [data-dock-panel="hierarchy"] > .performance-dock-title > strong'));
  await expect(canvasPanel()).toHaveAttribute('data-dock-slot', 'left');
  await page.getByRole('separator', { name: '调整左侧面板宽度', exact: true }).focus();
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('separator', { name: '调整左侧面板宽度', exact: true })).toHaveAttribute('aria-valuenow', '12');
  await checkCanvasTools(); await fitDesign();
  await page.locator('.ui-workspace').screenshot({ path: path.join(output, 'canvas-docked-narrow.png') });
  const layout = await page.evaluate(() => localStorage.getItem('vns-ui-dock-v1'));
  const a = (await canvasTitle().getByRole('button', { name: '放大 (Ctrl+滚轮)', exact: true }).boundingBox())!;
  const b = (await page.locator('.ui-dock [data-dock-panel="hierarchy"] > .performance-dock-title').boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 }); await page.mouse.up();
  expect(await page.evaluate(() => localStorage.getItem('vns-ui-dock-v1'))).toBe(layout);
  await expect(page.locator('.performance-dock-drop')).toHaveCount(0);
  await resetUiPanelLayout(page!); await expect(canvasPanel()).toHaveAttribute('data-dock-slot', 'top');
  await checkCanvasTools(); await fitDesign();
  record('缩小、放大、比例和适合窗口有效；画布换位及缩到最窄时工具仍跟随且不裁切，从工具拖动不会误换面板。');

  phase = 'mode and camera memory';
  await size(1280); await openDesign(f.root.id);
  await page.locator('[data-hierarchy-id="' + f.observe.id + '"]').click();
  await zoom().selectOption('150');
  await expect.poll(() => page!.locator('[data-ui-zoom-surface]').evaluate(element => element.getBoundingClientRect().width)).toBeCloseTo(f.project.width * 1.5, 2);
  await design().evaluate(async element => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    element.scrollLeft = 170; element.scrollTop = 130;
  });
  const camera = await design().evaluate(element => [element.scrollLeft, element.scrollTop]);
  report.designCameraBefore = await design().evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop, width: element.clientWidth, height: element.clientHeight, scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight }));
  await mode('事件图').click(); await expect(page.getByLabel('当前页面事件图', { exact: true })).toHaveValue(f.rootGraph.id);
  await expect(page.locator('[data-ui-component-id="' + f.observe.id + '"]')).toHaveClass(/active/);
  await fitBlueprintCanvas(page);
  const graphNode = page.locator('.react-flow__node[data-id="' + f.primary.call.id + '"]');
  await graphNode.locator('.graph-node-title').click(); await button('定位选中节点').click();
  await expect.poll(async () => (await matrix())[0]).toBeGreaterThanOrEqual(.64);
  await expect.poll(() => page!.locator('.react-flow__viewport').evaluate(async element => {
    const transform = getComputedStyle(element).transform;
    for (let frame = 0; frame < 4; frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (getComputedStyle(element).transform !== transform) return false;
    }
    return true;
  })).toBe(true);
  const graphCamera = await matrix();
  await mode('设计').click(); await expect(zoom()).toHaveValue('150');
  report.designCameraRestored = await design().evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop, width: element.clientWidth, height: element.clientHeight, scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight }));
  await expect.poll(() => design().evaluate(element => [element.scrollLeft, element.scrollTop])).toEqual(camera);
  await expect(page.locator('[data-component-id="' + f.observe.id + '"]')).toHaveClass(/selected/);
  await mode('事件图').click(); await expect(graphNode).toHaveClass(/selected/); await expect.poll(matrix).toEqual(graphCamera);
  const roundTrips: { before: number[]; after: number[] }[] = [];
  report.designCameraRoundTrips = roundTrips;
  for (let turn = 0; turn < 6; turn++) {
    await mode('设计').click(); await expect(zoom()).toHaveValue('150');
    // Include the scroll limits: removing a toolbar during unmount briefly
    // enlarges the old viewport, which must not overwrite its saved camera.
    await design().evaluate((element, turn) => {
      element.scrollLeft = turn % 2 ? element.scrollWidth - element.clientWidth : 170;
      element.scrollTop = turn % 2 ? element.scrollHeight - element.clientHeight : 130;
    }, turn);
    const before = await design().evaluate(element => [element.scrollLeft, element.scrollTop]);
    await mode('事件图').click(); await expect(graphNode).toHaveClass(/selected/); await expect.poll(matrix).toEqual(graphCamera);
    await mode('设计').click(); await expect(zoom()).toHaveValue('150');
    await expect.poll(() => design().evaluate(element => [element.scrollLeft, element.scrollTop])).toEqual(before);
    roundTrips.push({ before, after: await design().evaluate(element => [element.scrollLeft, element.scrollTop]) });
    await mode('事件图').click();
  }
  await size(1024); await capture('events-custom-1024', false);
  await expect(page.locator('.ui-event-library').getByRole('button', { name: '页面使用位置', exact: true })).toBeVisible();
  await button('页面使用位置').click(); await expect(usageDialog()).toContainText(f.root.name);
  await usageDialog().getByRole('button', { name: '关闭页面使用位置', exact: true }).click();
  await expect(button('保存界面')).toBeDisabled();
  record('设计与事件图连续往返保留页面、选中控件、节点与两个画布视口（含滚动边界）；长页面名称不挤出工具栏，事件图仍可查看页面使用位置。');

  phase = 'schemes and empty pages';
  await page.getByLabel('事件图页面', { exact: true }).selectOption('ui:preferences');
  await selectUiDesignScheme(page, 'header_derived');
  await expect(page.getByLabel('当前页面事件图', { exact: true })).toHaveValue(derived.id);
  await capture('events-scheme-1024', false); await size(1600); await capture('events-scheme-1600', false);
  await button('撤销').click(); await expect(page.getByLabel('选择界面实例', { exact: true })).toHaveValue('');
  await expect(button('保存界面')).toBeDisabled();
  await page.getByLabel('事件图页面', { exact: true }).selectOption('ui:history');
  await expect(page.locator('.ui-event-empty')).toBeVisible();
  await button('页面使用位置').click(); await expect(usageDialog()).toContainText('页面使用位置');
  await usageDialog().getByRole('button', { name: '取消', exact: true }).click();
  const preview = await openUiPreviewWindow(app, page); preview.on('pageerror', error => errors.push(error.message));
  await expect(preview.getByLabel('画面缩放比例', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: '关闭预览', exact: true }).click();
  await expect(button('预览窗口')).toHaveAttribute('aria-pressed', 'false');
  assert.equal(await fs.readFile(projectFile, 'utf8'), originalBytes);
  record('长方案名保持单行；切换方案仍进入对应事件图；空页面的次级入口与独立预览可用，以上查看操作未改动工程文件。');

  phase = 'create page and persist usage';
  await openDesign(f.root.id); await openUiPageOptions(page); await button('新建自定义页面').click();
  const createdId = await page.getByLabel('设计页面', { exact: true }).inputValue();
  assert.ok(createdId && !original.ui.customPages.some(item => item.id === createdId));
  await expect(usageDialog()).toHaveCount(0); await expect(design()).toBeVisible();
  await openUiPageOptions(page); await page.getByLabel('自定义页面名称', { exact: true }).fill('新的说明页面');
  await button('页面使用位置').click();
  await expect(usageDialog()).toContainText('可以先设计并保存页面');
  await usageDialog().getByLabel('页面接入位置').selectOption('beforeTitle');
  await usageDialog().getByRole('button', { name: '添加使用位置', exact: true }).click();
  await expect(usageDialog().getByRole('status')).toContainText('已加入标题前流程');
  await usageDialog().getByRole('button', { name: '完成', exact: true }).click();
  await button('保存界面').click(); await expect(page!.locator('.ui-save-status')).toHaveText('已保存'); await expect(button('保存界面')).toBeDisabled();
  await expect.poll(async () => (await read()).gameFlow?.beforeTitle.steps.some(step => step.kind === 'page' && step.pageId === createdId)).toBe(true);
  const saved = await read();
  assert.equal(saved.ui.customPages.find(item => item.id === createdId)?.name, '新的说明页面');
  assert.deepEqual(saved.ui.customPages.filter(item => item.id !== createdId), original.ui.customPages);
  assert.deepEqual(saved.ui.components, original.ui.components); assert.deepEqual(saved.ui.instances, original.ui.instances);
  assert.deepEqual(saved.ui.pageVariables, original.ui.pageVariables); assert.deepEqual(saved.ui.pageInterfaces, original.ui.pageInterfaces);
  assert.deepEqual(saved.nodes, original.nodes);
  for (const graph of original.blueprints) assert.deepEqual(saved.blueprints.find(item => item.id === graph.id), graph);
  await page.reload(); await expect(page.locator('.project-title strong')).toHaveText(f.project.name);
  await page.locator('[data-workspace-tab="ui"]').click(); await openDesign(createdId);
  await expect(page.getByLabel('自定义页面名称', { exact: true })).toHaveValue('新的说明页面');
  await openUiPageUsage(page);
  const entrySection = usageDialog().locator('.page-connection-usage').filter({ has: page.locator(':scope > summary', { hasText: '打开位置' }) });
  if (await entrySection.getAttribute('open') === null) await entrySection.locator(':scope > summary').click();
  await expect(usageDialog().getByRole('button', { name: /流程蓝图 · 标题前流程/ })).toBeVisible();
  await usageDialog().getByRole('button', { name: '取消', exact: true }).click();
  await expect(button('保存界面')).toBeDisabled();
  record('新建页面直接进入设计，不强制弹向导；主动添加使用位置后保存、重开均保留，原有页面、组件、方案、蓝图和绑定未丢失。');

  phase = 'light theme';
  await button('作品设置').click(); const settings = page.getByRole('dialog', { name: '作品设置', exact: true });
  await settings.getByRole('button', { name: '编辑器外观', exact: true }).click();
  await settings.locator('.editor-theme-card').filter({ has: page.locator('strong', { hasText: '亮白' }) }).click();
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-editor-theme', 'codexLight');
  await size(1280); await capture('design-light-1280', true);
  assert.deepEqual(errors, []); record('深浅两种主题均保留既有视觉风格，主编辑器及预览无 renderer 异常。');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.phase = phase; report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); console.error(error); process.exitCode = 1;
} finally {
  try {
    if (app) {
      const child = app.process(); await app.close();
      let exited = child.exitCode !== null || child.signalCode !== null;
      if (!exited && child.pid) try { process.kill(child.pid, 0); } catch { exited = true; }
      processes.push({ pid: child.pid, exited }); assert.equal(exited, true);
    }
  } catch (error) { report.status = 'failed'; report.closeError = String(error); process.exitCode = 1; }
  try { await server?.close(); } catch (error) { report.status = 'failed'; report.serverError = String(error); process.exitCode = 1; }
  try {
    const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); report.cleanup = cleanup; assert.deepEqual(cleanup.errors, []);
  } catch (error) { report.status = 'failed'; report.cleanupError = String(error); process.exitCode = 1; }
  await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
}
