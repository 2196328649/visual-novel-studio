import assert from 'node:assert/strict';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema, type BlueprintNode } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';
import { compileProject } from '../src/runtime/compiler';
import { createUiImageFixture, uiImageFixturePng } from './lib/ui-image-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { openUiPreviewWindow, showUiPreviewTestData } from './lib/ui-preview-window';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

if (process.env.VNS_INSTALLED_EXE) throw new Error('This acceptance uses an isolated development editor, never the installed application.');
const root = path.resolve('.'), output = path.resolve('artifacts/ui-image-editor', new Date().toISOString().replaceAll(':', '-'));
const f = createUiImageFixture(), projectFile = path.join(output, 'project/project.vns.json');
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
}
try {
  await fs.mkdir(path.join(output, 'project/assets'), { recursive: true });
  await fs.writeFile(path.join(output, 'project/assets/picture-a.png'), uiImageFixturePng());
  await fs.writeFile(path.join(output, 'project/assets/picture-b.png'), uiImageFixturePng(true));
  await fs.writeFile(path.join(output, 'project/assets/picture-broken.png'), 'intentionally invalid image fixture');
  await saveProject(projectFile, f.project);
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/work/**', '**/resources/**', '**/release/**'] } } });
  await server.listen(); const devUrl = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  await launch(devUrl); await openGraph();
  const field = (node: BlueprintNode, name: string) => inspector().getByLabel(node.name + ' · ' + name, { exact: true });
  const savedNode = (saved: Awaited<ReturnType<typeof read>>, id: string) => saved.blueprints.find(g => g.id === f.editGraph.id)!.nodes.find(n => n.id === id)!;

  phase = 'typed image properties and read-only observations'; await select(f.editorSet);
  const property = field(f.editorSet, '组件属性'), value = field(f.editorSet, '属性值');
  await expect(property.locator('option[value="imageStatus"]')).toHaveCount(0); await expect(property.locator('option[value="imageSource"]')).toHaveCount(0);
  await property.selectOption('imageTint'); await value.fill('#aabbcc80'); await value.press('Tab');
  let saved = await save(); assert.equal(savedNode(saved, f.editorSet.id).properties.value, '#aabbcc80');
  await property.selectOption('imageCropX'); await value.fill('0.2'); await value.press('Tab'); saved = await save();
  assert.equal(savedNode(saved, f.editorSet.id).properties.value, .2); assert.equal(savedNode(saved, f.editorSet.id).pins.find(p => p.id === 'value')!.dataType, 'number');
  await select(f.editorGet); await field(f.editorGet, '组件属性').selectOption('imageSource'); saved = await save();
  assert.equal(savedNode(saved, f.editorGet.id).pins.find(p => p.id === 'value')!.dataType, 'asset');
  await page.getByRole('button', { name: '撤销', exact: true }).click(); saved = await save(); assert.equal(savedNode(saved, f.editorGet.id).properties.property, 'imageStatus');
  await page.getByRole('button', { name: '重做', exact: true }).click(); saved = await save(); assert.equal(savedNode(saved, f.editorGet.id).properties.property, 'imageSource');
  await close(); await launch(devUrl); await openGraph(); await select(f.editorSet);
  await expect(field(f.editorSet, '组件属性')).toHaveValue('imageCropX'); await expect(field(f.editorSet, '属性值')).toHaveValue('0.2');
  checks.push('统一属性字段、色块/RGBA、比例范围、资源类型引脚、只读权限、撤销/重做和保存重开。');

  phase = 'design image effects and all fit modes'; await enterDesign(); await page.locator('[data-hierarchy-id="picture"]').click();
  await page.getByLabel('图片缩放', { exact: true }).selectOption('nineSlice');
  const appearance = page.locator('details.ui-inspector-group').filter({ has: page.locator('.ui-group-title').getByText('外观与状态', { exact: true }) });
  if (!await appearance.evaluate(element => (element as HTMLDetailsElement).open)) await appearance.locator(':scope > summary').click();
  const effects = appearance.locator('details').filter({ has: page.locator('summary').getByText('图片裁切、翻转与乘色', { exact: true }) });
  if (!await effects.evaluate(element => (element as HTMLDetailsElement).open)) await effects.locator(':scope > summary').click();
  await page.getByLabel('图片裁切横向起点 %', { exact: true }).fill('12.5'); await page.getByLabel('图片裁切横向起点 %', { exact: true }).press('Tab');
  await page.getByLabel('图片水平翻转', { exact: true }).check(); saved = await save();
  assert.equal(saved.ui.customPages.find(p => p.id === f.page.id)!.components[0].imageEffects!.cropX, .125);
  assert.equal(saved.ui.customPages.find(p => p.id === f.page.id)!.components[0].imageEffects!.flipX, true);
  const capabilities = page.getByLabel('控件蓝图能力', { exact: true }); if (!await capabilities.evaluate(element => (element as HTMLDetailsElement).open)) await capabilities.locator('summary').click();
  await expect(capabilities.locator('[data-ui-property-capability="imageStatus"]')).toContainText('只读'); await expect(capabilities).toContainText('图片加载失败时');
  for (const [width, height] of [[1700, 1000], [1024, 768]]) {
    await app!.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); await page.screenshot({ path: path.join(output, 'image-authoring-' + width + '.png') });
  }
  await close(); await launch(devUrl); await enterDesign(); await page.locator('[data-hierarchy-id="picture"]').click();
  await expect(page.getByLabel('图片缩放', { exact: true })).toHaveValue('nineSlice');
  // Preserve the saved-roundtrip evidence, then restore the canonical preview fixture through the actual fields.
  const restoredAppearance = page.locator('details.ui-inspector-group').filter({ has: page.locator('.ui-group-title').getByText('外观与状态', { exact: true }) });
  if (!await restoredAppearance.evaluate(element => (element as HTMLDetailsElement).open)) await restoredAppearance.locator(':scope > summary').click();
  const restoredEffects = restoredAppearance.locator('details').filter({ has: page.locator('summary').getByText('图片裁切、翻转与乘色', { exact: true }) });
  if (!await restoredEffects.evaluate(element => (element as HTMLDetailsElement).open)) await restoredEffects.locator(':scope > summary').click();
  await expect(page.getByLabel('图片裁切横向起点 %', { exact: true })).toHaveValue('12.5');
  await page.getByRole('button', { name: '重置图片效果', exact: true }).click(); await page.getByLabel('图片缩放', { exact: true }).selectOption('contain'); await save();
  checks.push('设计入口保存源图裁切、翻转和九宫格；能力说明与两个窗口尺寸有截图，重开不丢效果。');

  phase = 'common event shortcuts reuse authored roots';
  await page.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click();
  await page.getByLabel('搜索事件图控件', { exact: true }).fill('被测图片');
  await page.locator('.ui-event-components [data-ui-component-id="picture"]').click();
  await page.getByLabel('图片加载事件', { exact: true }).getByRole('button', { name: '图片加载成功时', exact: true }).click();
  await expect(card(f.eventRoots.loaded.id)).toHaveClass(/selected/);
  await page.getByLabel('图片加载事件', { exact: true }).getByRole('button', { name: '图片加载失败时', exact: true }).click();
  await expect(card(f.eventRoots.failed.id)).toHaveClass(/selected/);
  saved = await save(); assert.equal(saved.blueprints.find(g => g.id === f.graph.id)!.nodes.filter(n => n.type === 'eventImage').length, 2);
  checks.push('图片加载事件使用统一页面图，重复入口定位已有成功/失败节点而不复制事件。');

  phase = 'actual decoded image preview'; await enterDesign(); await save(); const beforePreview = await fs.readFile(projectFile, 'utf8');
  preview = await openUiPreviewWindow(app!, page); preview.setDefaultTimeout(18000); preview.on('pageerror', error => errors.push(error.message));
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#ui-preview'))!.setContentSize(1440, 1000));
  await showUiPreviewTestData(preview); await preview.getByLabel('画面缩放比例', { exact: true }).selectOption('fit');
  const target = (id: string) => preview!.locator('[data-preview-component="' + id + '"]'), act = (name: string) => target('image_action_' + name.toLowerCase()).click();
  const parameter = (name: string) => preview!.getByLabel('预演参数 ' + name, { exact: true });
  const surface = target('picture').locator('svg.ui-image-surface');
  await expect(parameter('image_loaded')).toHaveValue('1'); await expect(surface).toHaveAttribute('data-ui-image-source', 'picture_a');
  await act('observe'); await expect(parameter('image_status')).toHaveValue('loaded'); await expect(parameter('image_width')).toHaveValue('64');
  await act('effects'); await expect(surface.locator(':scope > g')).toHaveAttribute('transform', /scale\(-1 -1\)/);
  for (const mode of ['contain', 'cover', 'stretch', 'nineSlice']) {
    await act(mode); await expect(surface.locator(':scope > g > svg')).toHaveCount(mode === 'nineSlice' ? 9 : 1); await preview.screenshot({ path: path.join(output, 'image-preview-' + mode + '.png') });
  }
  await expect(parameter('image_loaded')).toHaveValue('1'); await act('fail'); await expect(parameter('image_failed')).toHaveValue('1');
  await act('observe'); await expect(parameter('image_status')).toHaveValue('failed'); await expect(parameter('image_event_error')).not.toHaveValue('');
  await act('clear'); await expect(target('picture').locator('svg.ui-image-surface')).toHaveCount(0); await expect(parameter('image_failed')).toHaveValue('1');
  await act('restore'); await expect(parameter('image_loaded')).toHaveValue('2'); await act('swap'); await expect(parameter('image_loaded')).toHaveValue('3');
  await expect(surface).toHaveAttribute('data-ui-image-source', 'picture_b');
  await target('picture_parent').hover(); await expect(target('picture_state').locator('svg.ui-image-surface')).toHaveAttribute('data-ui-image-source', 'picture_b');
  await preview.screenshot({ path: path.join(output, 'image-state-source-and-load-results.png') });
  checks.push('真实浏览器解码反馈、四种缩放/裁切/翻转/乘色、失败/清空/恢复，以及父按钮状态来源。');

  phase = 'modal child, native template and background image task';
  await act('child'); await expect(target('picture_child').locator('svg.ui-image-surface > g > svg')).toHaveCount(1); await target('image_child_close').click();
  await act('native'); await expect(target('picture_native').locator('svg.ui-image-surface > g > svg')).toHaveCount(1); await target('image_native_close').click();
  await preview.getByLabel('按时间预演', { exact: true }).check(); await expect(parameter('image_loaded')).toHaveValue('1');
  await preview.getByRole('button', { name: '播放计时', exact: true }).click(); await act('background');
  await expect(parameter('image_job_done')).toHaveValue('true'); await expect(parameter('image_loaded')).toHaveValue('2');
  await preview.getByRole('button', { name: '暂停计时', exact: true }).click(); await preview.screenshot({ path: path.join(output, 'image-background-task.png') });
  checks.push('模态子页、内置模板与新增页面共用渲染，后台换图共用属性和加载事件。');
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
