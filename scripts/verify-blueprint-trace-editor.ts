import { openUiPageOptions } from './lib/ui-design-controls';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createBlueprintTraceFixture } from './lib/blueprint-trace-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openUiPreviewWindow, showUiPreviewTestData } from './lib/ui-preview-window';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { projectSchema } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';
import { compileProject } from '../src/runtime/compiler';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Only an isolated development editor may be used.');
const root = path.resolve('.'), output = path.join(root, 'artifacts/blueprint-trace-editor', new Date().toISOString().replaceAll(':', '-'));
const f = createBlueprintTraceFixture(); f.project.id += '_' + Date.now();
const projectFile = path.join(output, 'project/project.vns.json'); await fs.mkdir(path.dirname(projectFile), { recursive: true }); await saveProject(projectFile, f.project);
const compilerErrors = compileProject(f.project).diagnostics.filter(d => d.severity === 'error');
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/work/**', '**/resources/**', '**/release/**'] } } });
await server.listen(); const devUrl = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
let app: ElectronApplication | undefined, editor: Page | undefined, phase = 'launch', failure: string | undefined;
let preview!: Page;
const checks: string[] = [], errors: string[] = [], processChecks: { pid?: number; alive: boolean }[] = [];
const record = (message: string) => { checks.push(message); console.log('PASS ' + checks.length + ': ' + message); };
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const panel = () => preview!.getByLabel('蓝图执行轨迹', { exact: true });
const row = (kind: string, nodeId: string) => panel().locator('[data-trace-kind="' + kind + '"][data-trace-node="' + nodeId + '"]').last();
const graphNode = (id: string) => editor!.locator('.react-flow__node[data-id="' + id + '"]');
async function pageEditor(pageId = f.root.id, graphId = f.rootGraph.id) {
  await editor!.locator('[data-workspace-tab="ui"]').click();
  await editor!.getByLabel('界面编辑模式').getByRole('button', { name: '设计', exact: true }).click();
  await editor!.getByLabel('设计页面', { exact: true }).selectOption(pageId.startsWith('ui:') ? pageId.slice(3) : pageId);
  await editor!.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click();
  await editor!.getByLabel('当前页面事件图', { exact: true }).selectOption(graphId); await fitBlueprintCanvas(editor!);
}
async function openPreview() {
  preview = await openUiPreviewWindow(app!, editor!); preview.setDefaultTimeout(16000); preview.on('pageerror', error => errors.push(error.message));
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#ui-preview'))!.setContentSize(1120, 850));
  await preview.getByLabel('按时间预演', { exact: true }).check();
  await preview.getByRole('button', { name: '恢复测试值', exact: true }).click();
}
async function showTrace() { if (!await panel().isVisible()) await preview!.getByRole('button', { name: /^执行轨迹 ·/ }).click(); }
async function filter(kind = 'all', query = '') {
  await panel().getByLabel('轨迹类型', { exact: true }).selectOption(kind); await panel().getByLabel('筛选调用', { exact: true }).selectOption('');
  await panel().getByLabel('搜索执行轨迹', { exact: true }).fill(query); await panel().getByLabel('跟随最新', { exact: true }).check();
}
async function runValues(componentId = f.observe.id) {
  if (await panel().isVisible()) await panel().getByRole('button', { name: '返回画面', exact: true }).click();
  await preview!.locator('[data-preview-component="' + componentId + '"]').click(); await showTrace();
}
async function closePreview() { if (preview && !preview.isClosed()) { await preview.getByRole('button', { name: '关闭预览', exact: true }).click(); await expect.poll(() => preview!.isClosed()).toBe(true); } }
try {
  expect(compilerErrors).toEqual([]);
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile'), devUrl, sdkRoot: 'E:/Tools/renpy-8.5.3-sdk' });
  editor = await app.firstWindow(); editor.setDefaultTimeout(18000); editor.on('pageerror', error => errors.push(error.message));
  await expect(editor.locator('.project-title strong')).toHaveText(f.project.name, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1480, 940));
  await pageEditor(); const original = await fs.readFile(projectFile, 'utf8'); await openPreview();

  phase = 'scalar observations'; await runValues(); await filter('writes');
  for (const [index, value] of ['0', 'false', '""（空文本）'].entries()) { await row('write', f.writes[index].id).click(); await expect(panel().locator('[data-trace-value] pre')).toHaveText(value); }
  await expect(panel().getByLabel('轨迹详情')).toContainText('本次调用'); await expect(panel().getByLabel('轨迹详情')).toContainText('实例 #1');
  await expect(panel().locator('.blueprint-trace-stack li')).toHaveCount(3);
  await preview.screenshot({ path: path.join(output, 'trace-values-stack.png') });
  record('真实页面事件记录 0 / false / 空文本，详情保留本次调用、页面实例和三层调用链。');

  phase = 'timing and unchanged state';
  await panel().getByRole('button', { name: '返回画面', exact: true }).click(); await preview.getByRole('button', { name: '推进 0.1 秒', exact: true }).click();
  await preview.locator('[data-preview-component="' + f.concurrent.id + '"]').click(); await showTrace(); await filter('calls');
  await row('wait', f.pause.id).click(); await expect(panel().getByLabel('轨迹详情')).toContainText('等待舞台演出或延迟');
  const ids = await panel().getByLabel('筛选调用').locator('option').allTextContents(); expect(ids.filter(text => text.includes(f.values.name))).toHaveLength(2);
  await preview.getByRole('button', { name: '推进 1 秒', exact: true }).click(); await expect(preview.getByLabel('预演时间')).toHaveText('1.10 秒');
  await filter('writes', '已完成调用'); await expect(panel().locator('.blueprint-trace-entry')).toHaveCount(2);
  await panel().getByRole('button', { name: '返回画面', exact: true }).click(); await showTrace(); await filter('writes', '已完成调用'); await expect(panel().locator('.blueprint-trace-entry')).toHaveCount(2);
  await showUiPreviewTestData(preview); await expect(preview.getByLabel('预演参数 作品观察结果', { exact: true })).toHaveValue('0');
  await preview.locator('.ui-preview-test-data > summary').click(); expect(await fs.readFile(projectFile, 'utf8')).toBe(original);
  await expect(editor.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled();
  record('并发调用身份分离，等待/恢复遵循计时；开关与筛选轨迹不重放副作用、不改变测试值或工程。');

  phase = 'source and control navigation'; await filter('events'); await row('node', f.primary.call.id).click();
  await panel().getByRole('button', { name: '定位节点', exact: true }).click();
  await expect(graphNode(f.primary.call.id)).toHaveClass(/selected/); await expect(editor.getByLabel('当前页面事件图')).toHaveValue(f.rootGraph.id);
  await expect(panel().locator('footer').getByRole('status')).toContainText('已定位');
  await panel().getByRole('button', { name: '定位触发控件', exact: true }).click();
  await expect(editor.locator('[data-component-id="' + f.observe.id + '"]')).toHaveClass(/selected/);
  expect(await fs.readFile(projectFile, 'utf8')).toBe(original);
  await pageEditor(); await showTrace(); await filter('values', '返回观察值'); await row('input', f.output.id).click();
  await panel().getByRole('button', { name: '定位值来源', exact: true }).click();
  await expect(editor.getByLabel('演出目标', { exact: true })).toHaveValue('graph:' + f.values.id); await expect(graphNode(f.readZero.id)).toHaveClass(/selected/);
  await expect.poll(() => preview!.isClosed()).toBe(true);
  record('日志定位准确进入原事件图、原控件及输入值来源节点；只读定位不制造草稿，离开页面后关闭独立预览。');

  phase = 'call site navigation'; await pageEditor(); await openPreview(); await runValues(); await filter('writes'); await row('write', f.writes[0].id).click();
  await panel().getByRole('button', { name: '返回调用点 · ' + f.childCall.name, exact: true }).click();
  await expect(editor.getByLabel('演出目标', { exact: true })).toHaveValue('graph:' + f.parent.id); await expect(graphNode(f.childCall.id)).toHaveClass(/selected/);
  await expect.poll(() => preview!.isClosed()).toBe(true); expect(await fs.readFile(projectFile, 'utf8')).toBe(original);
  record('调用链中的返回调用点实际定位到父模块的原调用节点，只读跳转不重新执行或修改工程。');

  phase = 'unsupported and cancelled execution'; await pageEditor(); await openPreview(); await runValues();
  await panel().getByRole('button', { name: '返回画面', exact: true }).click(); await preview.locator('[data-preview-component="' + f.root.components[1].id + '"]').click(); await showTrace(); await filter('problems');
  await expect(panel().locator('.blueprint-trace-entries')).toContainText('页面实例关闭');
  await preview.getByRole('button', { name: '恢复测试值', exact: true }).click(); await runValues(f.unsupported.id); await filter('problems');
  await expect(panel().locator('.blueprint-trace-entries')).toContainText('需要实际试玩'); await row('stop', f.unsupportedNode.id).first().click();
  await expect(panel().getByLabel('轨迹详情')).toContainText('实际游戏切换场景');
  await expect(panel().getByRole('button', { name: '在实际游戏中验证', exact: true })).toBeEnabled();
  await preview.screenshot({ path: path.join(output, 'trace-unsupported.png') });
  record('关闭页面有明确取消原因；未支持的切场景显示源节点和实际游戏验证入口，不伪装为成功。');

  phase = 'draft cancel and save'; await closePreview();
  await editor.getByLabel('界面编辑模式').getByRole('button', { name: '设计', exact: true }).click();
  await openUiPageOptions(editor); await editor.getByLabel('自定义页面名称', { exact: true }).fill('未保存的轨迹页面名称');
  await editor.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click();
  await openPreview(); await runValues(); await filter('writes'); await row('write', f.writes[0].id).click(); await panel().getByRole('button', { name: '定位节点', exact: true }).click();
  const leave = editor.getByRole('dialog', { name: '保存界面修改', exact: true }); await expect(leave).toBeVisible(); await leave.getByRole('button', { name: '取消', exact: true }).click();
  await expect(panel().locator('footer').getByRole('status')).toContainText('已取消'); await expect(editor.getByRole('button', { name: '保存界面', exact: true })).toBeEnabled();
  expect((await read()).ui.customPages.find(p => p.id === f.root.id)!.name).toBe(f.root.name);
  await panel().getByRole('button', { name: '定位节点', exact: true }).click(); await leave.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect(editor.getByLabel('演出目标', { exact: true })).toHaveValue('graph:' + f.values.id);
  expect((await read()).ui.customPages.find(p => p.id === f.root.id)!.name).toBe('未保存的轨迹页面名称');
  record('轨迹定位沿用草稿提示；取消保留草稿和当前页面，保存完成后才进入模块。');

  phase = 'discard stale draft graph'; await pageEditor(); await graphNode(f.primary.call.id).locator('.graph-node-title strong').click();
  await editor.getByRole('button', { name: '封装所选节点', exact: true }).click();
  const encapsulate = editor.getByRole('dialog', { name: '封装为用户节点', exact: true }); await encapsulate.getByLabel('用户节点名称').fill('待丢弃轨迹模块'); await encapsulate.getByRole('button', { name: '创建并替换', exact: true }).click();
  await openPreview(); const live = await preview.evaluate(() => window.studio!.getUiPreviewContext!()); const unsaved = live!.project.blueprints.find(g => g.name === '待丢弃轨迹模块')!; expect(unsaved).toBeTruthy();
  await runValues(); await filter('calls'); await panel().locator('[data-trace-kind="enter"][data-trace-graph="' + unsaved.id + '"]').click();
  await panel().getByRole('button', { name: '定位蓝图', exact: true }).click(); await leave.getByRole('button', { name: '不保存', exact: true }).click();
  await expect(panel().getByRole('alert')).toContainText('蓝图已不存在'); await expect(editor.getByLabel('当前页面事件图')).toHaveValue(f.rootGraph.id);
  await expect(editor.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled(); expect((await read()).blueprints.some(g => g.id === unsaved.id)).toBe(false);
  record('放弃草稿后重新校验待定位目标；仅存在于草稿的模块消失即报错，不错误跳转。');

  phase = 'bounded history and small viewports'; await preview.getByRole('button', { name: '恢复测试值', exact: true }).click();
  if (await panel().isVisible()) await panel().getByRole('button', { name: '返回画面', exact: true }).click();
  for (let i = 0; i < 42; i++) { await preview.locator('[data-preview-component="' + f.observe.id + '"]').click(); await preview.getByRole('button', { name: '推进 1 秒', exact: true }).click(); }
  await showTrace(); await filter(); await expect(panel().locator('.blueprint-trace-notice')).toContainText('超出上限');
  expect(await panel().locator('.blueprint-trace-entry').count()).toBeLessThanOrEqual(60); await panel().getByRole('button', { name: '较早', exact: true }).click(); await expect(panel().getByLabel('跟随最新')).not.toBeChecked();
  for (const [width, height] of [[1024, 768], [640, 480]]) {
    await app.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#ui-preview'))!.setContentSize(width, height), [width, height]);
    await expect(panel()).toBeInViewport(); await expect(panel().getByRole('button', { name: '在实际游戏中验证', exact: true })).toBeInViewport();
    expect(await preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await panel().locator('.blueprint-trace-entries').boundingBox())!.height, 'The visible list must have readable space, not only a sliver above the actions.').toBeGreaterThanOrEqual(120);
    await preview.screenshot({ path: path.join(output, 'trace-list-' + width + '.png') });
    await panel().locator('.blueprint-trace-entry').last().click(); await expect(panel().getByRole('button', { name: '收起详情', exact: true })).toBeInViewport();
    await preview.screenshot({ path: path.join(output, 'trace-detail-' + width + '.png') }); await panel().getByRole('button', { name: '收起详情', exact: true }).click();
  }
  record('记录上限明确提示丢弃数量，列表每页最多 60 条；1024 / 640 宽窗口可筛选、翻页和查看详情，无横向溢出。');

  phase = 'template and ipc sender boundaries'; await closePreview(); await pageEditor('ui:preferences', f.templateGraph.id); await openPreview(); await runValues(f.template.id); await filter('writes'); await row('write', f.writes[0].id).click();
  await expect(panel().getByLabel('轨迹详情')).toContainText('设置 · 实例 #1'); await panel().getByRole('button', { name: '定位触发控件', exact: true }).click();
  await expect(editor.locator('[data-component-id="' + f.template.id + '"]')).toHaveClass(/selected/);
  const refusedEditor = await editor.evaluate(async projectId => { try { await window.studio!.requestUiPreviewAction!({ kind: 'play', projectId }); return ''; } catch (error) { return String(error); } }, f.project.id); expect(refusedEditor).toContain('请从预览窗口');
  const refusedForeign = await preview.evaluate(async () => { try { await window.studio!.requestUiPreviewAction!({ kind: 'play', projectId: 'foreign-project' }); return ''; } catch (error) { return String(error); } }); expect(refusedForeign).toContain('工程已切换');
  record('内置模板沿用相同事件/调用/页面实例轨迹；定位保持基础方案，IPC 拒绝主窗口伪造请求及其他工程。');

  phase = 'real game entry'; await panel().getByRole('button', { name: '在实际游戏中验证', exact: true }).click();
  await expect(editor.locator('.play-workspace')).toHaveAttribute('data-preview-state', 'running', { timeout: 120000 });
  await editor.screenshot({ path: path.join(output, 'trace-real-game-running.png') }); await editor.locator('.play-stop').click(); await expect(editor.locator('.play-workspace')).toHaveCount(0);
  const saved = await read(); expect(saved.variables.find(v => v.id === 'trace_result')!.initial).toBe(-1); expect(saved.ui.activeInstanceId).toBeUndefined();
  expect(compileProject(saved).diagnostics.filter(d => d.severity === 'error')).toEqual([]); expect(errors).toEqual([]);
  record('实际游戏验证入口确实保存并启动隔离 Ren’Py，随后停止；没有把预演测试值或临时观察状态写入工程。');
} catch (error) {
  failure = error instanceof Error ? error.stack ?? error.message : String(error);
  await editor?.screenshot({ path: path.join(output, 'failure-editor.png') }).catch(() => undefined);
  if (preview && !preview.isClosed()) {
    await preview.screenshot({ path: path.join(output, 'failure-preview.png') }).catch(() => undefined);
    const layout = await preview.evaluate(() => ({ viewport: [innerWidth, innerHeight], boxes: [...document.querySelectorAll('.ui-preview-controls,.ui-preview-content,.blueprint-trace,.blueprint-trace > *, .blueprint-trace footer > *')].map(element => { const box = element.getBoundingClientRect(), style = getComputedStyle(element); return { tag: element.tagName, className: element.className, text: element.textContent?.slice(0, 60), x: box.x, y: box.y, width: box.width, height: box.height, flex: style.flex, minHeight: style.minHeight, maxHeight: style.maxHeight }; }) })).catch(() => undefined);
    await fs.writeFile(path.join(output, 'failure-layout.json'), JSON.stringify(layout, null, 2));
  }
} finally {
  if (app) {
    await editor?.evaluate(() => window.studio?.controlPreview?.('stop')).catch(() => undefined);
    const pid = app.process().pid; await app.close().catch(() => undefined); let alive = false;
    if (pid) try { process.kill(pid, 0); alive = true; } catch { /* isolated process exited */ }
    processChecks.push({ pid, alive }); if (alive) failure ??= 'Isolated Electron did not exit.';
  }
  await server.close();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: failure ? 'failed' : 'passed', phase, checks, compilerErrors, errors, processes: processChecks, failure, projectFile }, null, 2));
  console.log(output); if (failure) { console.error(failure); process.exitCode = 1; }
}
