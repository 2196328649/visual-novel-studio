import assert from 'node:assert/strict';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema, type BlueprintNode } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';
import { compileProject } from '../src/runtime/compiler';
import { createUiVideoFixture, writeUiVideoFixtureAssets } from './lib/ui-video-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { openUiPreviewWindow, showUiPreviewTestData } from './lib/ui-preview-window';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

if (process.env.VNS_INSTALLED_EXE) throw new Error('This acceptance uses an isolated development editor, never the installed application.');
const root = path.resolve('.'), output = path.resolve('artifacts/ui-video-editor', new Date().toISOString().replaceAll(':', '-'));
const f = createUiVideoFixture(), projectFile = path.join(output, 'project/project.vns.json');
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
  await writeUiVideoFixtureAssets(path.join(output, 'project'));
  await saveProject(projectFile, f.project);
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/work/**', '**/resources/**', '**/release/**'] } } });
  await server.listen(); const devUrl = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  await launch(devUrl); await openGraph();
  const field = (node: BlueprintNode, name: string) => inspector().getByLabel(node.name + ' · ' + name, { exact: true });
  const savedNode = (saved: Awaited<ReturnType<typeof read>>, id: string) => saved.blueprints.find(g => g.id === f.editGraph.id)!.nodes.find(n => n.id === id)!;
  const chooseAsset = async (label: string, name: string) => {
    const surface = label.startsWith(f.editorSet.name + ' · ') ? inspector() : page.locator('.ui-workspace');
    await surface.getByRole('button', { name: '浏览' + label, exact: true }).click();
    const browser = page.getByRole('dialog', { name: label + '资源浏览器', exact: true });
    await expect(browser.getByRole('button', { name: '预览资源 视频封面', exact: true })).toHaveCount(0);
    await browser.getByRole('button', { name: '预览资源 ' + name, exact: true }).dblclick();
  };

  phase = 'resource typed properties, permissions and undo/redo'; await select(f.editorSet);
  const property = field(f.editorSet, '组件属性');
  for (const name of ['videoStatus', 'videoPosition', 'videoDuration', 'videoCanSeek']) await expect(property.locator('option[value="' + name + '"]')).toHaveCount(0);
  await property.selectOption('video'); await chooseAsset(f.editorSet.name + ' · 属性值', '视频 b');
  let saved = await save(); assert.equal(savedNode(saved, f.editorSet.id).properties.value, 'movie_b'); assert.equal(savedNode(saved, f.editorSet.id).pins.find(pin => pin.id === 'value')!.dataType, 'asset');
  await property.selectOption('videoLoop'); await field(f.editorSet, '属性值').selectOption('true'); saved = await save(); assert.equal(savedNode(saved, f.editorSet.id).properties.value, true);
  await select(f.editorGet); await field(f.editorGet, '组件属性').selectOption('videoDuration'); saved = await save(); assert.equal(savedNode(saved, f.editorGet.id).pins.find(pin => pin.id === 'value')!.dataType, 'number');
  await page.getByRole('button', { name: '撤销', exact: true }).click(); saved = await save(); assert.equal(savedNode(saved, f.editorGet.id).properties.property, 'videoStatus');
  await page.getByRole('button', { name: '重做', exact: true }).click(); saved = await save(); assert.equal(savedNode(saved, f.editorGet.id).properties.property, 'videoDuration');
  await close(); await launch(devUrl); await openGraph(); await select(f.editorSet);
  await expect(field(f.editorSet, '组件属性')).toHaveValue('videoLoop'); await expect(field(f.editorSet, '属性值')).toHaveValue('true');
  checks.push('视频资源类型过滤、资源/数值/开关引脚、只读权限、撤销重做和保存重开。');

  phase = 'shared design capabilities and persisted video defaults'; await enterDesign(); await page.locator('[data-hierarchy-id="movie"]').click();
  await chooseAsset('视频素材', '视频 b'); await page.getByLabel('循环播放', { exact: true }).check(); saved = await save();
  assert.equal(saved.ui.customPages.find(p => p.id === f.page.id)!.components[0].assetId, 'movie_b'); assert.equal(saved.ui.customPages.find(p => p.id === f.page.id)!.components[0].loop, true);
  const capabilities = page.getByLabel('控件蓝图能力', { exact: true }); if (!await capabilities.evaluate(element => (element as HTMLDetailsElement).open)) await capabilities.locator('summary').click();
  await expect(capabilities.locator('[data-ui-property-capability="videoPosition"]')).toContainText('只读'); await expect(capabilities).toContainText('视频播放结束时'); await expect(capabilities).toContainText('视频播放失败时');
  await expect(capabilities.getByLabel('控件蓝图操作', { exact: true })).toContainText('暂停或继续视频');
  for (const [width, height] of [[1700, 1000], [1024, 768]]) {
    await app!.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); await page.screenshot({ path: path.join(output, 'video-authoring-' + width + '.png') });
  }
  await close(); await launch(devUrl); await enterDesign(); await page.locator('[data-hierarchy-id="movie"]').click();
  await expect(page.getByLabel('视频素材', { exact: true })).toHaveValue('视频 b'); await expect(page.getByLabel('循环播放', { exact: true })).toBeChecked();
  await chooseAsset('视频素材', '视频 a'); await page.getByLabel('循环播放', { exact: true }).uncheck(); await save();
  checks.push('设计视频与循环设置真实保存重开；共享能力列表和常见窗口宽度无全页横向溢出。');

  phase = 'shared event shortcuts reuse the existing event roots';
  await page.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click();
  await page.getByLabel('搜索事件图控件', { exact: true }).fill('被测视频'); await page.locator('.ui-event-components [data-ui-component-id="movie"]').click();
  for (const [trigger, title] of [['ended', '视频播放结束时'], ['failed', '视频播放失败时']]) {
    await page.getByLabel('视频播放事件', { exact: true }).getByRole('button', { name: title, exact: true }).click(); await expect(card(f.eventRoots[trigger].id)).toHaveClass(/selected/);
  }
  saved = await save(); assert.equal(saved.blueprints.find(g => g.id === f.graph.id)!.nodes.filter(n => n.type === 'eventVideo').length, 2);
  checks.push('视频事件使用统一页面图及继承规则；重复添加入口定位既有节点。');

  phase = 'actual browser decoder, playback control and poster'; await enterDesign(); await save(); const beforePreview = await fs.readFile(projectFile, 'utf8');
  preview = await openUiPreviewWindow(app!, page); preview.setDefaultTimeout(18000); preview.on('pageerror', error => errors.push(error.message));
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#ui-preview'))!.setContentSize(1440, 1000));
  await showUiPreviewTestData(preview); await preview.getByLabel('画面缩放比例', { exact: true }).selectOption('fit');
  const target = (id: string) => preview!.locator('[data-preview-component="' + id + '"]'), act = (name: string) => target('video_action_' + name).click();
  const parameter = (name: string) => preview!.getByLabel('预演参数 ' + name, { exact: true });
  const video = target('movie').locator('video.ui-video'), reset = () => preview!.getByRole('button', { name: '恢复测试值', exact: true }).click();
  const time = () => video.evaluate(element => (element as HTMLVideoElement).currentTime);
  await reset(); await act('loop'); await expect(video).toHaveAttribute('data-ui-video-status', 'playing');
  await expect.poll(time).toBeGreaterThan(.1); assert.ok(await video.evaluate(element => (element as HTMLVideoElement).duration > 1.5));
  await act('pause'); await expect(video).toHaveJSProperty('paused', true); const paused = await time();
  await preview.waitForTimeout(250); assert.ok(Math.abs(await time() - paused) < .08); await act('observe'); await expect(parameter('video_status')).toHaveValue('paused');
  await expect(target('movie_mirror').locator('video')).toHaveJSProperty('paused', false);
  await preview.screenshot({ path: path.join(output, 'video-preview-paused-and-independent.png') });
  await act('resume'); await expect(video).toHaveJSProperty('paused', false);
  await act('stop'); await expect(video).toHaveAttribute('data-ui-video-status', 'stopped'); assert.equal(await time(), 0);
  const cover = target('movie').locator('.ui-video-surface > img'), coverBounds = await cover.boundingBox(), frameBounds = await target('movie').locator('.ui-video-surface').boundingBox();
  assert.ok(coverBounds && frameBounds); for (const key of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(coverBounds[key] - frameBounds[key]) < 1);
  await expect(parameter('video_ended')).toHaveValue('0'); await act('once'); await act('play');
  await expect(video).toHaveAttribute('data-ui-video-status', 'playing'); await expect(parameter('video_ended')).toHaveValue('1'); await act('observe');
  await expect(parameter('video_status')).toHaveValue('ended'); await expect(parameter('video_event_asset')).toHaveValue('movie_a'); await expect(parameter('video_event_known')).toHaveValue('true'); await expect(parameter('video_can_seek')).toHaveValue('false');
  await preview.screenshot({ path: path.join(output, 'video-real-end-and-poster.png') });
  checks.push('实际 HTML 视频解码、暂停/继续/停止/播放、独立控件、一次结束事件及封面同位显示；未注入虚假媒体事件。');

  phase = 'loop, source change, decoder error, hide and clear';
  await reset(); await act('loop'); await expect(video).toHaveAttribute('data-ui-video-status', 'playing'); await preview.waitForTimeout(4300); await expect(parameter('video_ended')).toHaveValue('0');
  await act('swap'); await expect(video).toHaveAttribute('data-ui-video-source', 'movie_b'); await expect(video).toHaveAttribute('data-ui-video-status', 'playing');
  await act('hide'); await act('observe'); await expect(parameter('video_paused')).toHaveValue('true');
  await act('show'); await expect(video).toHaveAttribute('data-ui-video-status', 'playing'); await act('fail');
  await expect(parameter('video_failed')).toHaveValue('1'); await act('observe'); await expect(parameter('video_status')).toHaveValue('failed'); await expect(parameter('video_event_error')).not.toHaveValue('');
  await preview.screenshot({ path: path.join(output, 'video-real-decode-failure.png') });
  await act('clear'); await expect(video).toHaveAttribute('data-ui-video-status', 'empty'); await expect(parameter('video_ended')).toHaveValue('0'); await expect(parameter('video_failed')).toHaveValue('1');
  await act('restore'); await expect(video).toHaveAttribute('data-ui-video-source', 'movie_a'); await expect(video).toHaveAttribute('data-ui-video-status', 'playing');
  checks.push('真实循环边界不触发结束，动态替换视频、隐藏暂停、损坏文件失败、清空及恢复设计素材。');

  phase = 'modal child, native host suspension and background task';
  await reset(); await act('child'); await expect(target('movie_child').locator('video')).toHaveAttribute('data-ui-video-status', 'playing');
  await expect(parameter('video_ended')).toHaveValue('1'); await expect(target('movie_child').locator('video')).toHaveJSProperty('paused', false); await target('video_child_close').click();
  await act('restart'); await act('loop'); await expect(video).toHaveAttribute('data-ui-video-status', 'playing'); await expect.poll(time).toBeGreaterThan(.15);
  const beforeNative = await time(); await act('native'); await expect(target('movie_native').locator('video')).toHaveAttribute('data-ui-video-status', 'playing');
  await preview.screenshot({ path: path.join(output, 'video-native-template.png') }); await target('video_native_close').click();
  await expect(video).toHaveAttribute('data-ui-video-status', 'playing'); assert.ok(await time() >= beforeNative - .15);
  await preview.getByLabel('按时间预演', { exact: true }).check(); await preview.getByRole('button', { name: '播放计时', exact: true }).click(); await act('background');
  await expect(parameter('video_job_done')).toHaveValue('true'); await expect(video).toHaveAttribute('data-ui-video-source', 'movie_b'); await expect(video).toHaveAttribute('data-ui-video-status', 'paused');
  await preview.getByRole('button', { name: '暂停计时', exact: true }).click(); await preview.screenshot({ path: path.join(output, 'video-background-task.png') });
  checks.push('模态子页不伪装父页失效；内置模板/新增页面使用同一视频机制；宿主恢复保留位置，后台命令走共享状态。');
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
