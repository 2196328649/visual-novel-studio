import { selectUiDesignScheme } from './lib/ui-design-controls';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createBlueprintTraceFixture } from './lib/blueprint-trace-fixture';
import { createUiEventGraph } from '../src/core/ui-logic';
import { uiInstanceSchema } from '../src/core/model';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas, openBlueprintOptions, closeBlueprintOptions, setBlueprintOption } from './lib/blueprint-canvas';
import { saveProject } from '../src/desktop/project-store';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Only the isolated development editor is permitted.');
// Captured before this implementation; do not regenerate this from the new UI.
const baselineSource = 'artifacts/blueprint-toolbar-editor/2026-10-13T11-09-16.384Z/report.json';
const root = path.resolve('.'), output = path.join(root, 'artifacts/blueprint-toolbar-editor', new Date().toISOString().replaceAll(':', '-'));
const f = createBlueprintTraceFixture(); f.project.name = '蓝图紧凑工具栏验收';
f.root.name = '很长的页面名称 · 夜间设置与交互选项'; f.rootGraph.name = '很长的事件图名称 · 点击按钮后调用模块并更新本页面状态';
f.project.ui.instances = [uiInstanceSchema.parse({ id: 'toolbar_parent', name: '基础配色方案', components: [] }), uiInstanceSchema.parse({ id: 'toolbar_derived', name: '很长的派生界面方案名称 · 夜间设置', baseUiId: 'toolbar_parent', components: [] })];
// A derived scheme inherits its parent scheme's events; default-interface events run only while no scheme is active.
f.project.ui.activeInstanceId = 'toolbar_parent'; const inherited = createUiEventGraph(f.project, 'ui:preferences', '配色方案设置事件');
f.project.ui.activeInstanceId = 'toolbar_derived'; const derived = createUiEventGraph(f.project, 'ui:preferences', '夜间方案设置事件'); f.project.ui.activeInstanceId = undefined;
const projectFile = path.join(output, 'project/project.vns.json'); await fs.mkdir(path.dirname(projectFile), { recursive: true }); await saveProject(projectFile, f.project);
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/work/**', '**/resources/**', '**/release/**'] } } });
await server.listen(); const devUrl = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
let app: ElectronApplication | undefined, editor: Page | undefined, phase = 'launch', failure: string | undefined;
const checks: string[] = [], errors: string[] = [], geometry: Record<string, unknown>[] = [], processes: { pid?: number; alive: boolean }[] = [];
const record = (message: string) => { checks.push(message); console.log('PASS ' + checks.length + ': ' + message); };
const button = (name: string) => editor!.getByRole('button', { name, exact: true });
const mode = (name: string) => editor!.getByLabel('界面编辑模式').getByRole('button', { name, exact: true });
async function size(width: number, height: number) { await app!.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height }); await expect.poll(async () => Math.abs(await editor!.evaluate(() => window.innerWidth) - width)).toBeLessThanOrEqual(1); }
async function events(pageId: string, graphId: string) { await editor!.locator('[data-workspace-tab="ui"]').click(); await mode('事件图').click(); await editor!.getByLabel('事件图页面', { exact: true }).selectOption(pageId); await expect(editor!.getByLabel('当前页面事件图', { exact: true })).toHaveValue(graphId); await fitBlueprintCanvas(editor!); }
const graphNode = (id: string) => editor!.locator('.react-flow__node[data-id="' + id + '"]');
const matrix = () => editor!.locator('.react-flow__viewport').evaluate(element => { const value = new DOMMatrix(getComputedStyle(element).transform); return [value.a, value.d, value.e, value.f]; });
async function capture(name: string, host = '.ui-advanced-workspace') {
  const workspace = editor!.locator(host), canvas = workspace.locator('.flow-container'); await expect(canvas).toBeVisible();
  const outer = (await workspace.boundingBox())!, bounds = (await canvas.boundingBox())!;
  const bars = await workspace.locator('.workspace-toolbar').evaluateAll(elements => elements.filter(el => el.getBoundingClientRect().height && el.getBoundingClientRect().bottom <= (document.querySelector('.flow-container')?.getBoundingClientRect().top ?? 0)).map(el => ({ className: el.className, height: el.getBoundingClientRect().height, width: el.getBoundingClientRect().width, scrollWidth: el.scrollWidth })));
  geometry.push({ name, window: await editor!.evaluate(() => ({ width: innerWidth, height: innerHeight })), workspace: outer, canvas: bounds, reservedTop: bounds.y - outer.y, bars });
  const toolbarGeometry = await workspace.locator('.ui-editor-header, .blueprint-commandbar, .performance-context-toolbar').evaluateAll(elements => elements.map(element => ({ width: element.clientWidth, scroll: element.scrollWidth, height: element.getBoundingClientRect().height })));
  expect(toolbarGeometry.length).toBe(2); for (const bar of toolbarGeometry) { expect(bar.height).toBeLessThanOrEqual(44.5); expect(bar.scroll).toBeLessThanOrEqual(bar.width + 1); }
  const previous = name.startsWith('module-') ? 136.4 : name.startsWith('custom-') ? 258.4 : 212.4;
  expect(bounds.y - outer.y).toBeLessThanOrEqual(previous - 40);
  expect(bounds.height).toBeGreaterThan(200); expect(bounds.x + bounds.width).toBeLessThanOrEqual(outer.x + outer.width + 1);
  await workspace.screenshot({ path: path.join(output, name + '.png') });
}
try {
  app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile, devUrl, sdkRoot: 'E:/Tools/renpy-8.5.3-sdk' });
  editor = await app.firstWindow(); editor.setDefaultTimeout(18000); editor.on('pageerror', error => errors.push(error.message)); await expect(editor.locator('.project-title strong')).toHaveText(f.project.name);
  phase = 'template geometry'; await size(1832, 1000); await events('ui:preferences', f.templateGraph.id); await capture('template-1832');
  await size(1024, 768); await capture('template-1024');
  phase = 'custom geometry'; await events(f.root.id, f.rootGraph.id); await capture('custom-1024'); await size(1600, 1000); await capture('custom-1600');
  phase = 'generic geometry'; await editor.locator('[data-workspace-tab="blueprint"]').click(); await editor.getByLabel('演出目标', { exact: true }).selectOption('graph:' + f.values.id); await fitBlueprintCanvas(editor); await capture('module-1600', '.performance-workspace'); await size(1024, 768); await capture('module-1024', '.performance-workspace');
  record('内置设置页、新增页面和公共模块均记录真实画布几何与截图，包含 1832 / 1600 / 1024 宽。');
  phase = 'options and source navigation';
  const originalBytes = await fs.readFile(projectFile, 'utf8');
  await button('蓝图选项').focus(); await editor.keyboard.press('Space');
  const options = editor.getByRole('dialog', { name: '蓝图选项', exact: true }); await expect(options).toBeVisible(); await expect(options).toContainText(f.values.name); await expect(options).toContainText('公共模块');
  await expect(editor.getByRole('dialog', { name: '添加蓝图节点', exact: true })).toHaveCount(0);
  const optionBounds = (await options.boundingBox())!; expect(optionBounds.x).toBeGreaterThanOrEqual(0); expect(optionBounds.x + optionBounds.width).toBeLessThanOrEqual(1024);
  await editor.keyboard.press('Escape'); await expect(options).toBeHidden(); await expect(button('蓝图选项')).toBeFocused();
  await openBlueprintOptions(editor); await options.getByRole('checkbox', { name: '自动接线', exact: true }).uncheck(); await closeBlueprintOptions(editor);
  await graphNode(f.output.id).locator('.graph-node-title').click(); await graphNode(f.output.id).locator('button.blueprint-pin-source').click(); await expect(graphNode(f.readZero.id)).toHaveClass(/selected/);
  expect(await fs.readFile(projectFile, 'utf8')).toBe(originalBytes); await expect(editor.locator('.dirty-dot')).toHaveCount(0);
  record('选项面板可用键盘打开与关闭，不被工具栏裁切；来源链接定位原节点，不制造编辑。');

  phase = 'page mode and camera memory'; await events(f.root.id, f.rootGraph.id);
  await editor.locator('[data-ui-component-id="' + f.observe.id + '"]').click(); await graphNode(f.primary.call.id).locator('.graph-node-title').click();
  const pane = (await editor.locator('.flow-container').boundingBox())!; const fitMatrix = await matrix();
  await editor.mouse.move(pane.x + 8, pane.y + 8); await editor.mouse.wheel(0, -120); await expect.poll(matrix).not.toEqual(fitMatrix);
  await button('定位选中节点').click(); await expect.poll(async () => (await matrix())[0]).toBeGreaterThanOrEqual(.64);
  await setBlueprintOption(editor, '自动接线', false);
  const graphView = await matrix(); await mode('设计').click(); await expect(editor.locator('[data-component-id="' + f.observe.id + '"]')).toHaveClass(/selected/);
  await editor.getByLabel('画面缩放比例', { exact: true }).selectOption('150');
  const design = editor.getByLabel('界面设计画布', { exact: true }); await design.evaluate(element => { element.scrollLeft = 170; element.scrollTop = 130; });
  const designView = await design.evaluate(element => [element.scrollLeft, element.scrollTop]);
  await mode('事件图').click(); await expect(editor.getByLabel('当前页面事件图', { exact: true })).toHaveValue(f.rootGraph.id);
  await expect(graphNode(f.primary.call.id)).toHaveClass(/selected/); await expect.poll(matrix).toEqual(graphView);
  await expect((await openBlueprintOptions(editor)).getByRole('checkbox', { name: '自动接线', exact: true })).not.toBeChecked(); await closeBlueprintOptions(editor);
  await mode('设计').click(); await expect(editor.getByLabel('画面缩放比例')).toHaveValue('150'); await expect.poll(() => design.evaluate(element => [element.scrollLeft, element.scrollTop])).toEqual(designView);
  await mode('事件图').click(); await expect(button('保存界面')).toBeDisabled();
  record('设计与事件图往返保留控件、当前图、节点、视口、缩放滚动及自动接线选项，切换本身不产生草稿。');

  phase = 'binding drawer and module library';
  const drawer = editor.locator('.ui-dock [data-dock-panel="settings"]'); await expect(button('参数绑定')).toHaveAttribute('aria-expanded', 'false');
  expect((await drawer.boundingBox())!.height).toBeLessThanOrEqual(33); await button('参数绑定').click(); await expect(button('参数绑定')).toHaveAttribute('aria-expanded', 'true'); expect((await drawer.boundingBox())!.height).toBeGreaterThan(100);
  await button('参数绑定').click(); await expect(drawer).toHaveAttribute('data-dock-collapsed', 'true');
  const modules = editor.locator('.blueprint-module-library'); await modules.locator('summary').focus(); await editor.keyboard.press('Space'); await expect(modules.getByLabel('搜索可复用模块')).toBeVisible();
  await expect(editor.getByRole('dialog', { name: '添加蓝图节点', exact: true })).toHaveCount(0);
  await modules.getByLabel('搜索可复用模块').fill('零值'); const beforeModule = await matrix();
  await modules.getByRole('button', { name: '打开模块：' + f.values.name, exact: true }).click(); await expect(editor.getByLabel('演出目标')).toHaveValue('graph:' + f.values.id);
  await expect(editor.locator('.performance-context-toolbar').getByRole('button', { name: '返回调用位置', exact: true })).toBeVisible(); await button('返回调用位置').click();
  await expect(editor.getByLabel('事件图页面')).toHaveValue(f.root.id); await expect.poll(matrix).toEqual(beforeModule); await expect(button('保存界面')).toBeDisabled();
  await editor.locator('[data-ui-component-id="' + f.observe.id + '"]').click(); await button('在设计中定位').click(); await expect(editor.locator('[data-component-id="' + f.observe.id + '"]')).toHaveClass(/selected/); await expect(editor.locator('[data-component-id="' + f.observe.id + '"]')).toBeInViewport();
  await mode('事件图').click();
  record('参数绑定折叠后只留标题；左侧模块可搜索并沿用返回栈；控件可显式定位到设计画面，原图不被修改。');

  phase = 'scheme ownership and empty page'; await events('ui:preferences', f.templateGraph.id);
  await selectUiDesignScheme(editor, 'toolbar_derived'); await expect(editor.getByLabel('当前页面事件图')).toHaveValue(derived.id);
  await expect((await openBlueprintOptions(editor)).locator('.blueprint-context-label')).toContainText('夜间设置'); await closeBlueprintOptions(editor);
  await expect(editor.getByLabel('当前页面事件图').locator('option[value="' + f.templateGraph.id + '"]')).toHaveCount(0);
  await editor.getByLabel('当前页面事件图').selectOption(inherited.id); await expect(editor.locator('.ui-event-notice').first()).toContainText('方案「基础配色方案」');
  await button('撤销').click(); await expect(editor.getByLabel('选择界面实例')).toHaveValue(''); await expect(button('保存界面')).toBeDisabled();
  await editor.getByLabel('事件图页面').selectOption('ui:history'); await expect(editor.locator('.ui-event-empty')).toBeVisible(); await expect(button('创建页面事件图')).toBeVisible(); await expect(button('预览窗口')).toBeEnabled();
  record('方案可直接切换，优先显示本方案的事件图；父方案的事件图可继承查看并提示原归属，默认界面的图不混入；空页面仍可创建事件与预览。');

  phase = 'draft decisions and save'; await events(f.root.id, f.rootGraph.id); await button('页面使用位置').click(); await expect(editor.locator('dialog[open]')).toContainText(f.root.name); await editor.locator('dialog[open]').getByRole('button', { name: /关闭/ }).click();
  await button('新建事件图').click(); const created = await editor.getByLabel('当前页面事件图').inputValue(); expect(created).not.toBe(f.rootGraph.id); await expect(button('保存界面')).toBeEnabled();
  // Switching pages keeps the draft without asking; leaving the UI workspace asks to save or discard.
  const leave = editor.getByRole('dialog', { name: '保存界面修改', exact: true });
  await editor.getByLabel('事件图页面').selectOption(f.child.id); await expect(editor.getByLabel('事件图页面')).toHaveValue(f.child.id); await expect(leave).toHaveCount(0); await expect(button('保存界面')).toBeEnabled();
  await editor.getByLabel('事件图页面').selectOption(f.root.id); await expect(editor.getByLabel('当前页面事件图')).toHaveValue(created);
  await editor.locator('[data-workspace-tab="script"]').click(); await leave.getByRole('button', { name: '取消', exact: true }).click(); await expect(leave).toHaveCount(0);
  await expect(editor.getByLabel('当前页面事件图')).toHaveValue(created); await expect(editor.getByLabel('事件图页面')).toHaveValue(f.root.id); await expect(button('保存界面')).toBeEnabled();
  await editor.locator('[data-workspace-tab="script"]').click(); await leave.getByRole('button', { name: '不保存', exact: true }).click(); await expect(leave).toHaveCount(0); await expect(editor.locator('[data-workspace-tab="script"]')).toHaveClass(/active/);
  await events(f.root.id, f.rootGraph.id); await expect(button('保存界面')).toBeDisabled(); await expect(editor.getByLabel('当前页面事件图').locator('option[value="' + created + '"]')).toHaveCount(0);
  await button('新建事件图').click(); const savedId = await editor.getByLabel('当前页面事件图').inputValue(); await button('保存界面').click(); await expect(editor!.locator('.ui-save-status')).toHaveText('已保存'); await expect(button('保存界面')).toBeDisabled();
  await expect.poll(async () => JSON.parse(await fs.readFile(projectFile, 'utf8')).blueprints.some((graph: { id: string }) => graph.id === savedId)).toBe(true);
  await editor.reload(); await expect(editor.locator('.project-title strong')).toHaveText(f.project.name); await events(f.root.id, f.rootGraph.id); await editor.getByLabel('当前页面事件图').selectOption(savedId); await expect(editor.locator('.react-flow__node')).toHaveCount(1);
  record('新建、页面使用位置、切换页面保留草稿、离开界面时取消/放弃/保存和保存重开均正常；放弃的新图不被界面记忆重新选中。');
  expect(errors).toEqual([]);
} catch (error) {
  failure = error instanceof Error ? error.stack ?? error.message : String(error); await editor?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
} finally {
  if (app) { const pid = app.process().pid; await app.close(); let alive = false; if (pid) try { process.kill(pid, 0); alive = true; } catch { /* Expected isolated process exit. */ } processes.push({ pid, alive }); }
  await server.close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: failure ? 'failed' : 'passed', baselineSource, phase, checks, geometry, errors, processes, projectFile, failure }, null, 2));
  console.log(output); if (failure) { console.error(failure); process.exitCode = 1; }
}
