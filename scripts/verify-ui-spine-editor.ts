import assert from 'node:assert/strict';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema, type BlueprintNode } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';
import { compileProject } from '../src/runtime/compiler';
import { createUiSpineFixture, writeUiSpineFixtureAssets } from './lib/ui-spine-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { openUiPreviewWindow, showUiPreviewTestData } from './lib/ui-preview-window';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

if (process.env.VNS_INSTALLED_EXE) throw new Error('This acceptance uses an isolated development editor, never the installed application.');
const root = path.resolve('.'), output = path.resolve('artifacts/ui-spine-editor', new Date().toISOString().replaceAll(':', '-'));
const f = createUiSpineFixture(), projectFile = path.join(output, 'project/project.vns.json');
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
  await writeUiSpineFixtureAssets(path.join(output, 'project')); await saveProject(projectFile, f.project);
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/work/**', '**/resources/**', '**/release/**'] } } });
  await server.listen(); const devUrl = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  await launch(devUrl); await openGraph();
  const field = (node: BlueprintNode, name: string) => inspector().getByLabel(node.name + ' · ' + name, { exact: true });
  const savedNode = (saved: Awaited<ReturnType<typeof read>>, id: string) => saved.blueprints.find(g => g.id === f.editGraph.id)!.nodes.find(n => n.id === id)!;
  phase = 'typed assets, skin/animation names, read-only permissions and undo';
  await select(f.editorSet);
  const property = field(f.editorSet, '组件属性');
  for (const name of ['spineAnimation', 'spinePosition', 'spineStatus', 'spineDuration']) await expect(property.locator('option[value="' + name + '"]')).toHaveCount(0);
  await page.getByRole('button', { name: '浏览' + f.editorSet.name + ' · 属性值', exact: true }).click();
  const browser = page.getByRole('dialog', { name: f.editorSet.name + ' · 属性值资源浏览器', exact: true });
  await expect(browser.getByRole('button', { name: '预览资源 普通图片', exact: true })).toHaveCount(0);
  await browser.getByRole('button', { name: '预览资源 骨骼 b', exact: true }).dblclick();
  let saved = await save(); assert.equal(savedNode(saved, f.editorSet.id).properties.value, 'rig_b'); assert.equal(savedNode(saved, f.editorSet.id).pins.find(pin => pin.id === 'value')!.dataType, 'asset');
  await select(f.editorSkin); await field(f.editorSkin, '属性值').selectOption('alternate');
  await select(f.editorPlay); await field(f.editorPlay, '动画').selectOption('bounce');
  await select(f.editorGet); await field(f.editorGet, '组件属性').selectOption('spineDuration'); saved = await save();
  assert.equal(savedNode(saved, f.editorGet.id).pins.find(pin => pin.id === 'value')!.dataType, 'number');
  await page.getByRole('button', { name: '撤销', exact: true }).click(); saved = await save(); assert.equal(savedNode(saved, f.editorGet.id).properties.property, 'spineStatus');
  await page.getByRole('button', { name: '重做', exact: true }).click(); await save();
  await close(); await launch(devUrl); await openGraph(); await select(f.editorSkin); await expect(field(f.editorSkin, '属性值')).toHaveValue('alternate');
  await select(f.editorPlay); await expect(field(f.editorPlay, '动画')).toHaveValue('bounce');
  checks.push('骨骼资源过滤、皮肤/动画名称选择、动态素材动画、只读权限、类型化引脚、撤销重做和保存重开。');

  phase = 'design playback fields, capabilities and shared event shortcuts';
  await enterDesign(); await page.locator('[data-hierarchy-id="rig"]').click();
  await page.getByLabel('骨骼皮肤', { exact: true }).selectOption('alternate'); await save();
  const capabilities = page.getByLabel('控件蓝图能力', { exact: true }); if (!await capabilities.evaluate(element => (element as HTMLDetailsElement).open)) await capabilities.locator('summary').click();
  await expect(capabilities.locator('[data-ui-property-capability="spinePosition"]')).toContainText('只读');
  await expect(capabilities).toContainText('骨骼动画完成时'); await expect(capabilities).toContainText('骨骼播放失败时');
  for (const [width, height] of [[1700, 1000], [1024, 768]]) {
    await app!.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); await page.screenshot({ path: path.join(output, 'spine-authoring-' + width + '.png') });
  }
  await close(); await launch(devUrl); await enterDesign(); await page.locator('[data-hierarchy-id="rig"]').click();
  await expect(page.getByLabel('骨骼皮肤', { exact: true })).toHaveValue('alternate'); await page.getByLabel('骨骼皮肤', { exact: true }).selectOption('default'); await save();
  await page.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click();
  await page.getByLabel('搜索事件图控件', { exact: true }).fill('被测骨骼'); await page.locator('.ui-event-components [data-ui-component-id="rig"]').click();
  for (const [trigger, title] of [['completed', '骨骼动画完成时'], ['failed', '骨骼播放失败时']]) {
    await page.getByLabel('骨骼播放事件', { exact: true }).getByRole('button', { name: title, exact: true }).click(); await expect(card(f.eventRoots[trigger].id)).toHaveClass(/selected/);
  }
  saved = await save(); assert.equal(saved.blueprints.find(g => g.id === f.graph.id)!.nodes.filter(n => n.type === 'eventSpine').length, 2);
  checks.push('设计皮肤保存重开、完整能力说明、1024/1700 宽度布局及重复事件快捷入口定位。');

  phase = 'real WebGL runtime, pause, skins, transforms and once-only completion';
  await enterDesign(); await save(); const beforePreview = await fs.readFile(projectFile, 'utf8');
  preview = await openUiPreviewWindow(app!, page); preview.setDefaultTimeout(18000); preview.on('pageerror', error => errors.push(error.message));
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#ui-preview'))!.setContentSize(1440, 1000));
  await showUiPreviewTestData(preview); await preview.getByLabel('画面缩放比例', { exact: true }).selectOption('fit');
  const target = (id: string) => preview!.locator('[data-preview-component="' + id + '"]'), act = (name: string) => target('spine_action_' + name).click();
  const parameter = (name: string) => preview!.getByLabel('预演参数 ' + name, { exact: true });
  const canvas = target('rig').locator('canvas'), reset = () => preview!.getByRole('button', { name: '恢复测试值', exact: true }).click();
  const time = async () => Number(await canvas.getAttribute('data-spine-time'));
  await reset(); await expect(canvas).toHaveAttribute('data-spine-state', 'paused'); await act('play'); await expect(canvas).toHaveAttribute('data-spine-state', 'playing');
  await expect.poll(time).toBeGreaterThan(.15); await act('pause'); await expect(canvas).toHaveAttribute('data-spine-state', 'paused'); const at = await time();
  await preview.waitForTimeout(250); assert.ok(Math.abs(await time() - at) < .002); await act('skin'); await expect(canvas).toHaveAttribute('data-spine-skin', 'alternate'); assert.ok(Math.abs(await time() - at) < .002);
  await expect(target('rig_mirror').locator('canvas')).toHaveAttribute('data-spine-state', 'playing');
  await preview.screenshot({ path: path.join(output, 'spine-paused-skin-and-independent-track.png') });
  await act('transform'); assert.ok(Math.abs(await time() - at) < .002); await preview.screenshot({ path: path.join(output, 'spine-internal-transform.png') });
  await act('observe'); await expect(parameter('spine_paused')).toHaveValue('true'); await expect(parameter('spine_known')).toHaveValue('true');
  await act('resume'); await expect(parameter('spine_completed')).toHaveValue('1'); await act('observe');
  await expect(parameter('spine_status')).toHaveValue('completed'); await expect(parameter('spine_progress')).toHaveValue('1'); await expect(parameter('spine_event_skin')).toHaveValue('alternate');
  await preview.waitForTimeout(250); await expect(parameter('spine_completed')).toHaveValue('1');
  checks.push('实际 WebGL 运行库播放、皮肤变化和内部变换不重播、独立轨道、暂停保姿态、真实完成及事件快照；未注入媒体反馈。');

  phase = 'loops, zero speed, source changes, actual decode failure and clear';
  await reset(); await act('play'); await act('loop'); await preview.waitForTimeout(5000); await expect(parameter('spine_completed')).toHaveValue('0');
  await act('zero'); await expect(canvas).toHaveAttribute('data-spine-state', 'paused'); const held = await time(); await preview.waitForTimeout(200); assert.ok(Math.abs(await time() - held) < .002);
  await act('speed'); await expect(canvas).toHaveAttribute('data-spine-state', 'playing'); await act('swap'); await expect(canvas).toHaveAttribute('data-spine-animation', 'bounce');
  await act('hide'); await act('observe'); await expect(parameter('spine_paused')).toHaveValue('true'); await act('show'); await expect(canvas).toHaveAttribute('data-spine-state', 'playing');
  await act('fail'); await expect(parameter('spine_failed')).toHaveValue('1'); await act('observe'); await expect(parameter('spine_status')).toHaveValue('failed'); await expect(parameter('spine_event_error')).not.toHaveValue('');
  await preview.screenshot({ path: path.join(output, 'spine-real-decode-failure.png') });
  await act('clear'); await act('observe'); await expect(parameter('spine_status')).toHaveValue('empty'); await expect(parameter('spine_completed')).toHaveValue('0');
  await act('reset'); await expect(canvas).toHaveAttribute('data-spine-state', 'paused'); await act('instant'); await expect(parameter('spine_completed')).toHaveValue('1'); await act('observe'); await expect(parameter('spine_progress')).toHaveValue('1');
  checks.push('真实循环无完成事件、零速度、动态素材、隐藏恢复、损坏 JSON 失败、清空/重置及零时长动画。');

  phase = 'child page, native template and background commands';
  await reset(); await act('play'); await act('child'); await expect(parameter('spine_child_completed')).toHaveValue('1'); await expect(parameter('spine_completed')).toHaveValue('1');
  await target('spine_child_close').click(); await act('child'); await expect(parameter('spine_child_completed')).toHaveValue('2'); await target('spine_child_close').click();
  await act('native'); await expect(parameter('spine_native_completed')).toHaveValue('1'); await preview.screenshot({ path: path.join(output, 'spine-native-template.png') }); await target('spine_native_close').click();
  await preview.getByLabel('按时间预演', { exact: true }).check(); await preview.getByRole('button', { name: '播放计时', exact: true }).click(); await act('background');
  await expect(parameter('spine_job_done')).toHaveValue('true'); await expect(canvas).toHaveAttribute('data-spine-state', 'paused'); await expect(canvas).toHaveAttribute('data-spine-animation', 'bounce');
  await preview.getByRole('button', { name: '暂停计时', exact: true }).click();
  checks.push('模态父页继续动画、子页重开新实例、内置模板完成事件和后台播放/暂停共用状态。');
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
