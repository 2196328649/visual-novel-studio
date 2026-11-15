import assert from 'node:assert/strict';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema, type BlueprintNode } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';
import { compileProject } from '../src/runtime/compiler';
import { uiImageFixturePng } from './lib/ui-image-fixture';
import { createUiLayoutFixture, uiLayoutFixtureExpectations } from './lib/ui-layout-fixture';
import { resolveUiLayout, uiTransformPoint, type UiLayoutGeometry } from '../src/core/ui-layout';
import { applyUiPropertySnapshot, uiProperties, type UiProperty } from '../src/core/ui-properties';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { openUiPreviewWindow, showUiPreviewTestData } from './lib/ui-preview-window';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

if (process.env.VNS_INSTALLED_EXE) throw new Error('This acceptance uses an isolated development editor, never the installed application.');
const root = path.resolve('.'), output = path.resolve('artifacts/ui-layout-editor', new Date().toISOString().replaceAll(':', '-'));
const f = createUiLayoutFixture(), projectFile = path.join(output, 'project/project.vns.json');
let server: ViteDevServer | undefined, app: ElectronApplication | undefined, page!: Page, preview: Page | undefined, phase = 'setup';
const checks: string[] = [], errors: string[] = [], processes: { pid?: number; exited: boolean }[] = [];
const report: Record<string, unknown> = { status: 'running', checks, errors, processes };
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const inspector = () => page.locator('.blueprint-properties');
const card = (id: string) => page.locator('.react-flow__node[data-id="' + id + '"]');
async function save() {
  const uiSave = page.getByRole('button', { name: '保存界面', exact: true });
  if (await uiSave.isVisible() && await uiSave.isEnabled()) await uiSave.click();
  await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
  return read();
}
async function launch(devUrl: string) {
  app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile, devUrl });
  page = await app.firstWindow(); page.setDefaultTimeout(18000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(f.project.name, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1700, 1000));
}
async function close() {
  const problems: string[] = [];
  if (preview && !preview.isClosed()) {
    try {
      await preview.getByRole('button', { name: '关闭预览', exact: true }).click();
      await expect.poll(() => preview!.isClosed()).toBe(true);
    } catch (error) { problems.push('Preview did not close normally: ' + String(error)); }
  }
  if (!app) { preview = undefined; if (problems.length) throw new Error(problems.join('\n')); return; }
  const owned = app, child = owned.process();
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  // Keep ownership until the child really exits. A failed preview or save prompt
  // cannot prevent cleanup of this isolated fixture, or lose the retry handle.
  // Quit through the editor's normal path (unsaved fixture edits are discarded by the fixture).
  // app.exit() after a closed UI preview window crashes Electron during shutdown on Windows.
  if (!exited()) await owned.evaluate(({ app }) => app.quit()).catch(() => undefined);
  try {
    await expect.poll(exited, { timeout: 15000 }).toBe(true);
  } catch (error) {
    problems.push('Editor required forced termination: ' + String(error));
    if (!exited()) child.kill();
    try { await expect.poll(exited, { timeout: 15000 }).toBe(true); }
    catch (exitError) { problems.push(String(exitError)); }
  }
  const state = processes.find(record => record.pid === child.pid);
  if (state) state.exited = exited(); else processes.push({ pid: child.pid, exited: exited() });
  if (exited()) { if (app === owned) app = undefined; preview = undefined; }
  else problems.push('Owned editor process is still alive; its handle and directories were retained.');
  if (problems.length) throw new Error(problems.join('\n'));
}
async function openGraph() {
  await page.locator('[data-workspace-tab="blueprint"]').click(); await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + f.editGraph.id);
  if (!await inspector().isVisible()) await page.getByRole('button', { name: '展开蓝图属性', exact: true }).click();
}
async function select(node: BlueprintNode) {
  await fitBlueprintCanvas(page); await card(node.id).locator('.graph-node-title strong').click();
  await inspector().getByRole('button', { name: '节点参数', exact: true }).click();
}
async function enterDesign() {
  await page.locator('.view-tabs').getByRole('button', { name: '界面', exact: true }).click();
  await page.getByLabel('界面编辑模式').getByRole('button', { name: '设计', exact: true }).click();
  await page.getByLabel('设计页面', { exact: true }).selectOption(f.page.id);
  const snap = page.getByRole('button', { name: '智能吸附', exact: true });
  if (await snap.getAttribute('aria-pressed') === 'true') await snap.click();
}
const near = (actual: number, expected: number, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, actual + ' != ' + expected);
const component = (saved: Awaited<ReturnType<typeof read>>, id: string) => saved.ui.customPages.find(p => p.id === f.page.id)!.components.find(c => c.id === id)!;
const geometry = (saved: Awaited<ReturnType<typeof read>>, id: string) => resolveUiLayout(saved.ui.customPages.find(p => p.id === f.page.id)!.components, saved).get(id)!;
async function numberField(label: string, value: number) { const field = page.getByLabel(label, { exact: true }); await field.fill(String(value)); await field.press('Tab'); }
async function designTarget(id: string) {
  await page.locator('[data-hierarchy-id="' + id + '"]').click();
  const group = page.locator('details.ui-layout-fields');
  if (!await group.evaluate(element => (element as HTMLDetailsElement).open)) await group.locator(':scope > summary').click();
}
async function surface(host: Page, planeSelector: string, selector: string, g: UiLayoutGeometry) {
  const plane = await host.locator(planeSelector).boundingBox(); assert.ok(plane);
  const scale = plane.width / f.project.width;
  const actual = await host.locator(selector).evaluate(element => {
    const style = getComputedStyle(element), m = new DOMMatrixReadOnly(style.transform);
    return { matrix: [m.a, m.b, m.c, m.d, m.e, m.f], width: parseFloat(style.width), height: parseFloat(style.height), visibility: style.visibility, clip: style.clipPath };
  });
  g.renderMatrix.forEach((value, i) => near(actual.matrix[i], value * (i >= 4 ? scale : 1), i >= 4 ? .05 : .00001));
  near(actual.width, g.width * scale, 1); near(actual.height, g.height * scale, 1);
  if (g.clippedOut) assert.equal(actual.visibility, 'hidden');
  else if (g.clipPolygons.length) assert.match(actual.clip, /^polygon\(/);
  return actual;
}
async function designSurface(saved: Awaited<ReturnType<typeof read>>, id: string) { return surface(page, '.ui-canvas', '[data-component-id="' + id + '"]', geometry(saved, id)); }
async function designSnapshot(id: string) {
  return page.locator('[data-component-id="' + id + '"]').evaluate(element => {
    const style = getComputedStyle(element);
    return { transform: style.transform, width: style.width, height: style.height };
  });
}
try {
  await fs.mkdir(path.join(output, 'project/assets'), { recursive: true });
  await fs.writeFile(path.join(output, 'project/assets/layout-grid.png'), uiImageFixturePng());
  await saveProject(projectFile, f.project);
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/work/**', '**/resources/**', '**/release/**'] } } });
  await server.listen(); const devUrl = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  await launch(devUrl); await openGraph();
  const field = (node: BlueprintNode, name: string) => inspector().getByLabel(node.name + ' · ' + name, { exact: true });
  const savedNode = (saved: Awaited<ReturnType<typeof read>>, id: string) => saved.blueprints.find(g => g.id === f.editGraph.id)!.nodes.find(n => n.id === id)!;

  phase = 'shared typed layout fields and read-only observations'; await select(f.editorSet);
  const property = field(f.editorSet, '组件属性'), value = field(f.editorSet, '属性值');
  for (const id of ['scrollMaximumY', 'contentHeight', 'screenWidth']) await expect(property.locator('option[value="' + id + '"]')).toHaveCount(0);
  await property.selectOption('layoutFlow'); await value.selectOption('horizontal'); let saved = await save();
  assert.equal(savedNode(saved, f.editorSet.id).properties.value, 'horizontal'); assert.equal(savedNode(saved, f.editorSet.id).pins.find(p => p.id === 'value')!.dataType, 'string');
  await property.selectOption('layoutRotation'); await value.fill('27'); await value.press('Tab'); saved = await save();
  assert.equal(savedNode(saved, f.editorSet.id).properties.value, 27); assert.equal(savedNode(saved, f.editorSet.id).pins.find(p => p.id === 'value')!.dataType, 'number');
  await select(f.editorGet); await field(f.editorGet, '组件属性').selectOption('contentHeight'); await save();
  await page.getByRole('button', { name: '撤销', exact: true }).click(); saved = await save(); assert.equal(savedNode(saved, f.editorGet.id).properties.property, 'scrollMaximumY');
  await page.getByRole('button', { name: '重做', exact: true }).click(); saved = await save(); assert.equal(savedNode(saved, f.editorGet.id).properties.property, 'contentHeight');
  checks.push('布局枚举/数值引脚、只读观察权限和一次撤销重做。');

  phase = 'affine authoring, drag, resize and reparent'; await enterDesign(); await designTarget(f.panel.id);
  for (const [property, value] of Object.entries({ pivotX: .5, pivotY: .5, layoutRotation: 18, scaleX: .9, scaleY: .9 })) await numberField(uiProperties[property as UiProperty].name, value);
  await numberField('横向位置 %', 30); await numberField('纵向位置 %', 40); saved = await save();
  await designSurface(saved, f.panel.id); await designSurface(saved, f.items[0].id);
  await expect(page.getByLabel('容器设计滚动范围', { exact: true })).toContainText('有效位置');
  await designTarget(f.items[0].id);
  const beforeDrag = geometry(saved, f.items[0].id), canvas = await page.locator('.ui-canvas').boundingBox(); assert.ok(canvas);
  const beforeDragView = await designSnapshot(f.items[0].id), beforeDragBytes = await fs.readFile(projectFile, 'utf8');
  const startPoint = uiTransformPoint(beforeDrag.renderMatrix, { x: beforeDrag.width * .45, y: beforeDrag.height * .45 }), scale = canvas.width / f.project.width;
  await page.mouse.move(canvas.x + startPoint.x * scale, canvas.y + startPoint.y * scale); await page.mouse.down();
  await page.mouse.move(canvas.x + startPoint.x * scale + 18, canvas.y + startPoint.y * scale + 10, { steps: 8 }); await page.mouse.up();
  const draggedView = await designSnapshot(f.items[0].id); assert.notDeepEqual(draggedView, beforeDragView);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect.poll(() => designSnapshot(f.items[0].id)).toEqual(beforeDragView);
  await page.getByRole('button', { name: '重做', exact: true }).click(); await expect.poll(() => designSnapshot(f.items[0].id)).toEqual(draggedView);
  assert.equal(await fs.readFile(projectFile, 'utf8'), beforeDragBytes); saved = await save();
  const afterDrag = geometry(saved, f.items[0].id); near(afterDrag.matrix[4] - beforeDrag.matrix[4], 18 / scale, .1); near(afterDrag.matrix[5] - beforeDrag.matrix[5], 10 / scale, .1);
  await designSurface(saved, f.items[0].id);
  const resizeBefore = geometry(saved, f.items[0].id), handle = await page.locator('[data-transform-id="layout_item_0"] [data-resize-handle="se"]').boundingBox(); assert.ok(handle);
  const beforeResizeView = await designSnapshot(f.items[0].id), beforeResizeBytes = await fs.readFile(projectFile, 'utf8');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2 + 15, handle.y + handle.height / 2 + 8, { steps: 8 }); await page.mouse.up();
  const resizedView = await designSnapshot(f.items[0].id); assert.notDeepEqual(resizedView, beforeResizeView);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect.poll(() => designSnapshot(f.items[0].id)).toEqual(beforeResizeView);
  await page.getByRole('button', { name: '重做', exact: true }).click(); await expect.poll(() => designSnapshot(f.items[0].id)).toEqual(resizedView);
  assert.equal(await fs.readFile(projectFile, 'utf8'), beforeResizeBytes); saved = await save();
  const resized = geometry(saved, f.items[0].id); near(resized.matrix[4], resizeBefore.matrix[4], .1); near(resized.matrix[5], resizeBefore.matrix[5], .1); assert.notEqual(resized.width, resizeBefore.width); await designSurface(saved, f.items[0].id);
  const reparentBefore = geometry(saved, f.items[0].id);
  const parentField = page.getByLabel('父对象', { exact: true });
  await parentField.selectOption(''); await expect(parentField).toHaveValue('');
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(parentField).toHaveValue(f.panel.id); await designSurface(saved, f.items[0].id);
  await page.getByRole('button', { name: '重做', exact: true }).click(); await expect(parentField).toHaveValue('');
  saved = await save(); assert.equal(component(saved, f.items[0].id).parentId, undefined);
  const detached = geometry(saved, f.items[0].id); reparentBefore.matrix.forEach((v, i) => near(detached.matrix[i], v)); near(detached.width, reparentBefore.width); near(detached.height, reparentBefore.height);
  await parentField.selectOption(f.panel.id); saved = await save(); assert.equal(component(saved, f.items[0].id).parentId, f.panel.id);
  await designTarget(f.panel.id); await page.screenshot({ path: path.join(output, 'layout-affine-authoring.png') });
  await close(); await launch(devUrl); await enterDesign(); await designTarget(f.panel.id);
  await expect(page.getByLabel(uiProperties.layoutRotation.name, { exact: true })).toHaveValue('18'); await expect(page.getByLabel(uiProperties.scaleX.name, { exact: true })).toHaveValue('0.9');
  for (const [width, height] of [[1700, 1000], [1024, 768]]) {
    await app!.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); await page.screenshot({ path: path.join(output, 'layout-authoring-' + width + '.png') });
  }
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1700, 1000));
  for (const [property, value] of Object.entries({ pivotX: 0, pivotY: 0, layoutRotation: 0, scaleX: 1, scaleY: 1 })) await numberField(uiProperties[property as UiProperty].name, value);
  await numberField('横向位置 %', 4); await numberField('纵向位置 %', 6); saved = await save(); await designSurface(saved, f.panel.id);
  checks.push('真实非轴对齐拖动、固定对角缩放、保形重新设父级、撤销/重做、保存重开及两个窗口尺寸。');

  // Authoring deliberately changed child rectangles. The independent preview
  // assertions start from their canonical fixture, not those edited rectangles.
  await close(); saved.ui.customPages.find(p => p.id === f.page.id)!.components = structuredClone(f.page.components);
  await saveProject(projectFile, saved); await launch(devUrl); await enterDesign();

  phase = 'real wheel, clipped clicks and shared affine rendering'; const beforePreview = await fs.readFile(projectFile, 'utf8');
  const expected = uiLayoutFixtureExpectations(f); await fs.writeFile(path.join(output, 'layout-expectations.json'), JSON.stringify(expected, null, 2));
  preview = await openUiPreviewWindow(app!, page); preview.setDefaultTimeout(18000); preview.on('pageerror', error => errors.push(error.message));
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#ui-preview'))!.setContentSize(1440, 1000));
  await showUiPreviewTestData(preview); await preview.getByLabel('画面缩放比例', { exact: true }).selectOption('fit');
  const target = (id: string) => preview!.locator('[data-preview-component="' + id + '"]'), act = (name: string) => target('layout_action_' + name).click();
  const parameter = (name: string) => preview!.getByLabel('预演参数 ' + name, { exact: true });
  const planeSelector = '[aria-label="参数联动预演画面"]';
  const previewSurface = async (name: string, id: string) => {
    const components = structuredClone(f.page.components), changes = expected[name].changes;
    for (const entry of changes) applyUiPropertySnapshot(components.find(c => c.id === entry.componentId)!, entry.property, entry.value);
    const visible = new Map(changes.filter(entry => entry.property === 'visible').map(entry => [entry.componentId, Boolean(entry.value)]));
    return surface(preview!, planeSelector, '[data-preview-component="' + id + '"]', resolveUiLayout(components, f.project, c => visible.get(c.id) ?? true).get(id)!);
  };
  const at = async (point: number[] | null, click = true) => { assert.ok(point); const box = await preview!.locator(planeSelector).boundingBox(); assert.ok(box); const x = box.x + point[0] * box.width / f.project.width, y = box.y + point[1] * box.height / f.project.height; if (click) await preview!.mouse.click(x, y); else await preview!.mouse.move(x, y); };
  await expect(parameter('layout_hit')).toHaveValue('0'); await at(expected.initial.outsideThird); await expect(parameter('layout_hit')).toHaveValue('0');
  await at(expected.initial.insideThird); await expect(parameter('layout_hit')).toHaveValue('3');
  await act('apply'); await act('observe'); near(Number(await parameter('layout_x').inputValue()), expected.transformed.rows.layout_panel.bounds[0], .01);
  await previewSurface('transformed', f.panel.id); await previewSurface('transformed', f.items[0].id);
  await target('layout_item_0').click(); await expect(parameter('layout_hit')).toHaveValue('1');
  await at(expected.transformed.outsideThird); await expect(parameter('layout_hit')).toHaveValue('1');
  await at(expected.transformed.insideThird); await expect(parameter('layout_hit')).toHaveValue('3');
  await preview.screenshot({ path: path.join(output, 'layout-preview-transformed.png') });
  await act('scroll'); await act('observe'); near(Number(await parameter('layout_scroll_y').inputValue()), expected.scrolled.rows.layout_panel.scrollY, .01);
  await previewSurface('scrolled', f.items[0].id); await previewSurface('scrolled', f.items[2].id);
  await preview.screenshot({ path: path.join(output, 'layout-preview-scrolled.png') });
  await act('reset'); await act('apply'); await at(expected.transformed.wheel, false); await preview.mouse.wheel(0, 300); await act('observe');
  await expect.poll(async () => Number(await parameter('layout_scroll_y').inputValue())).toBeGreaterThan(0);
  near(Number(await parameter('layout_scroll_y').inputValue()), Math.min(40, expected.transformed.rows.layout_panel.scrollMaximumY), .01);
  await act('scroll'); await act('hide'); await act('observe'); near(Number(await parameter('layout_scroll_y').inputValue()), expected.hidden.rows.layout_panel.scrollY, .01);
  checks.push('真实鼠标滚轮、旋转后裁剪外点击拒绝/裁剪内点击成功、滚动夹紧、隐藏项不占槽位及截图。');

  phase = 'modal children and system template share scrolling'; await act('reset'); await act('child');
  const childToken = await target('layout_child_panel').evaluate(element => element.closest('[data-preview-instance]')?.getAttribute('data-preview-instance'));
  const parentBefore = await target(f.panel.id).getAttribute('style');
  const childBefore = await target('layout_child_tall').evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).f);
  assert.ok(childToken);
  // Passive panels do not receive pointer events; their layout plane routes
  // real wheel input by geometry, just as it does in the running game.
  const childBox = await target('layout_child_panel').boundingBox(); assert.ok(childBox);
  await expect(preview.locator(planeSelector)).toBeVisible();
  assert.equal(await preview.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.hasAttribute('data-ui-layout-plane'), { x: childBox.x + childBox.width / 2, y: childBox.y + childBox.height / 2 }), true);
  await preview.mouse.move(childBox.x + childBox.width / 2, childBox.y + childBox.height / 2); await preview.mouse.wheel(0, 300);
  await expect.poll(() => target('layout_child_tall').evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).f)).toBeLessThan(childBefore - .1);
  assert.equal(await target(f.panel.id).getAttribute('style'), parentBefore); await preview.screenshot({ path: path.join(output, 'layout-modal-scroll.png') });
  await target('layout_child_close').click(); await act('child');
  assert.notEqual(await target('layout_child_panel').evaluate(element => element.closest('[data-preview-instance]')?.getAttribute('data-preview-instance')), childToken);
  near(await target('layout_child_tall').evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).f), childBefore, .05);
  await target('layout_child_close').click(); await act('native'); await target('layout_native_item_0').click(); await expect(parameter('layout_hit')).toHaveValue('10');
  await target('layout_native_item_0').hover(); await preview.mouse.wheel(0, 300); await preview.screenshot({ path: path.join(output, 'layout-template-scroll.png') }); await target('layout_native_close').click();
  checks.push('父页在模态子页输入期间不滚动；子页重开使用新实例；系统模板复用同一点击和滚动机制。');

  phase = 'focused controls lose focus only when geometry becomes unavailable';
  await preview.getByLabel('按时间预演', { exact: true }).check(); await preview.getByRole('button', { name: '播放计时', exact: true }).click(); await act('controls');
  const input = target('layout_input').locator('input[data-ui-text-input]');
  await target('layout_controls_animate').click(); await expect(input).toBeFocused(); await expect(input).not.toBeFocused({ timeout: 10000 }); await expect(parameter('layout_committed')).toHaveValue('0');
  await target('layout_controls_reset').click(); await target('layout_controls_focus').click(); await expect(input).toBeFocused();
  const controlsBox = await target('layout_controls_panel').boundingBox(); assert.ok(controlsBox);
  await preview.mouse.move(controlsBox.x + controlsBox.width - 20, controlsBox.y + controlsBox.height - 20);
  for (let i = 0; i < 5; i++) await preview.mouse.wheel(0, 120);
  await expect(input).not.toBeFocused(); await expect(parameter('layout_committed')).toHaveValue('0'); await preview.screenshot({ path: path.join(output, 'layout-clipped-input-focus.png') });
  await target('layout_controls_close').click(); await act('background'); await expect(parameter('layout_background_done')).toHaveValue('1'); await act('observe'); await expect(parameter('layout_scroll_y')).toHaveValue('80');
  await preview.getByRole('button', { name: '暂停计时', exact: true }).click(); await preview.screenshot({ path: path.join(output, 'layout-background-task.png') });
  checks.push('实际输入焦点被几何动画/滚动清理而不提交；后台任务与用户滚轮使用相同有效滚动属性。');
  assert.equal(await fs.readFile(projectFile, 'utf8'), beforePreview); await close(); saved = await read();
  assert.deepEqual(compileProject(saved).diagnostics.filter(issue => issue.severity === 'error'), []); assert.deepEqual(errors, []); report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.stack : String(error);
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); process.exitCode = 1;
} finally {
  try { await close(); } catch (error) { report.status = 'failed'; report.closeError = String(error); process.exitCode = 1; }
  try { await server?.close(); } catch (error) { report.status = 'failed'; report.serverError = String(error); process.exitCode = 1; }
  try {
    if (app) throw new Error('Cannot remove an isolated fixture while its owned editor is still running.');
    if (await fs.stat(output).catch(() => undefined)) {
      const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); report.cleanup = cleanup;
      if (cleanup.errors.length) throw new Error('Fixture cleanup did not finish.');
    }
  } catch (error) { report.status = 'failed'; report.cleanupError = String(error); process.exitCode = 1; }
  report.phase = phase; await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(path.join(output, 'report.json')); if (report.error) console.error(report.error);
}
