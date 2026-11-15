import assert from 'node:assert/strict';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema, type BlueprintNode } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';
import { compileProject } from '../src/runtime/compiler';
import { createUiPropertyFixture, uiPropertyFixtureTone, uiPropertyFixturePng } from './lib/ui-property-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { openUiPreviewWindow } from './lib/ui-preview-window';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

if (process.env.VNS_INSTALLED_EXE) throw new Error('This acceptance uses an isolated development editor, never the installed application.');
const root = path.resolve('.'), output = path.resolve('artifacts/ui-property-surfaces-editor', new Date().toISOString().replaceAll(':', '-'));
const f = createUiPropertyFixture(), projectFile = path.join(output, 'project/project.vns.json');
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
  await fs.writeFile(path.join(output, 'project/assets/click.wav'), uiPropertyFixtureTone());
  await fs.writeFile(path.join(output, 'project/assets/property-skin.png'), uiPropertyFixturePng()); await saveProject(projectFile, f.project);
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/work/**', '**/resources/**', '**/release/**'] } } });
  await server.listen(); const devUrl = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  await launch(devUrl); await openGraph();
  phase = 'read and write property permissions';
  await select(f.editorGet);
  await inspector().getByLabel('界面组件', { exact: true }).selectOption('probe');
  await inspector().getByLabel(f.editorGet.name + ' · 组件属性', { exact: true }).selectOption('pressed');
  let saved = await save();
  assert.equal(saved.blueprints.find(graph => graph.id === f.editGraph.id)!.nodes.find(node => node.id === f.editorGet.id)!.pins.find(pin => pin.id === 'value')!.dataType, 'boolean');
  await select(f.editorSet); const properties = inspector().getByLabel(f.editorSet.name + ' · 组件属性', { exact: true });
  await expect(properties.locator('option[value="screenX"]')).toHaveCount(0); await expect(properties.locator('option[value="pressed"]')).toHaveCount(0);
  await properties.selectOption('shadowBlur');
  const value = inspector().getByLabel(f.editorSet.name + ' · 属性值', { exact: true }); await value.fill('7'); await value.press('Tab');
  saved = await save();
  assert.equal(saved.blueprints.find(graph => graph.id === f.editGraph.id)!.nodes.find(node => node.id === f.editorSet.id)!.properties.value, 7);
  checks.push('读属性可选按下状态并同步开关引脚；写属性排除只读项，阴影模糊可编辑并保存。');

  phase = 'single transaction and persistence';
  await select(f.editorReset); await inspector().getByLabel(f.editorReset.name + ' · 组件属性', { exact: true }).selectOption('shadowBlur'); await save();
  await page.getByRole('button', { name: '撤销', exact: true }).click(); saved = await save();
  assert.equal(saved.blueprints.find(graph => graph.id === f.editGraph.id)!.nodes.find(node => node.id === f.editorReset.id)!.properties.property, 'textColor');
  await page.getByRole('button', { name: '重做', exact: true }).click(); saved = await save();
  assert.equal(saved.blueprints.find(graph => graph.id === f.editGraph.id)!.nodes.find(node => node.id === f.editorReset.id)!.properties.property, 'shadowBlur');
  await close(); await launch(devUrl); await openGraph(); await select(f.editorSet);
  await expect(inspector().getByLabel(f.editorSet.name + ' · 组件属性', { exact: true })).toHaveValue('shadowBlur');
  await expect(inspector().getByLabel(f.editorSet.name + ' · 属性值', { exact: true })).toHaveValue('7');
  checks.push('属性变更一次撤销/重做，保存重开后字段和数据类型仍正确。');

  phase = 'design capability directory';
  const beforeView = await fs.readFile(projectFile, 'utf8'); await enterDesign();
  await page.locator('[data-hierarchy-id="caption"]').click();
  const capabilities = page.getByLabel('控件蓝图能力', { exact: true }); await capabilities.locator('summary').click();
  await expect(capabilities.locator('[data-ui-property-capability="shadowBlur"]')).toContainText('0～不限');
  await expect(capabilities.locator('[data-ui-property-capability="screenX"]')).toContainText('只读');
  for (const [width, height] of [[1700, 1000], [1024, 768]]) {
    await app!.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: path.join(output, 'capabilities-' + width + '.png') });
  }
  assert.equal(await fs.readFile(projectFile, 'utf8'), beforeView);
  checks.push('设计能力目录使用共享定义，显示范围/权限/来源；1700 和 1024 窗口不横向溢出，查看不改工程。');

  phase = 'actual isolated page preview';
  preview = await openUiPreviewWindow(app!, page); preview.setDefaultTimeout(18000); preview.on('pageerror', error => errors.push(error.message));
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#ui-preview'))!.setContentSize(1220, 850));
  const target = (id: string) => preview!.locator('[data-preview-component="' + id + '"]');
  await target('apply').click();
  await expect(target('caption')).toHaveCSS('color', 'rgb(39, 193, 233)');
  await expect.poll(() => target('frame').evaluate(element => getComputedStyle(element, '::after').borderTopColor)).toBe('rgb(69, 170, 85)');
  await expect.poll(() => target('frame').evaluate(element => parseFloat(getComputedStyle(element, '::after').borderTopWidth))).toBeGreaterThan(0);
  await expect(target('frame')).toHaveCSS('isolation', 'isolate');
  await expect(target('probe').locator('.ui-skin-image')).toBeVisible();
  await expect.poll(() => target('probe').evaluate(element => getComputedStyle(element, '::after').borderTopColor)).toBe('rgb(160, 187, 204)');
  await expect.poll(() => target('probe').evaluate(element => getComputedStyle(element, '::after').zIndex)).toBe('2');
  await expect.poll(() => target('frame').evaluate(element => getComputedStyle(element).backgroundColor)).toContain('18, 34, 51');
  const bounds = (await target('top').boundingBox())!;
  await preview.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(preview.getByLabel('预演参数 hits_top', { exact: true })).toHaveValue('1');
  await target('swap').click();
  await preview.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(preview.getByLabel('预演参数 hits_bottom', { exact: true })).toHaveValue('1');
  await preview.screenshot({ path: path.join(output, 'live-property-layer-preview.png') });
  await target('reset').click(); await expect(target('caption')).toHaveCSS('color', 'rgb(221, 238, 255)');
  await preview.getByRole('button', { name: '恢复测试值', exact: true }).click();
  await expect(target('caption')).toHaveCSS('color', 'rgb(221, 238, 255)');
  assert.equal(await fs.readFile(projectFile, 'utf8'), beforeView);
  checks.push('真实页面预演消费样式覆盖；同一坐标先命中上层、交换后命中下层，单项重置与恢复测试值不改工程。');
  await close(); saved = await read(); assert.deepEqual(compileProject(saved).diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.deepEqual(errors, []); report.status = 'passed';
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
