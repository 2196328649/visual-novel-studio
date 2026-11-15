import assert from 'node:assert/strict';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema, type BlueprintNode } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';
import { compileProject } from '../src/runtime/compiler';
import { createUiControlOptionsFixture } from './lib/ui-control-options-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { openUiPreviewWindow, showUiPreviewTestData } from './lib/ui-preview-window';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

if (process.env.VNS_INSTALLED_EXE) throw new Error('This acceptance uses an isolated development editor, never the installed application.');
const root = path.resolve('.'), output = path.resolve('artifacts/ui-control-options-editor', new Date().toISOString().replaceAll(':', '-'));
const f = createUiControlOptionsFixture(), projectFile = path.join(output, 'project/project.vns.json');
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
  await fs.mkdir(path.join(output, 'project'), { recursive: true }); await saveProject(projectFile, f.project);
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/work/**', '**/resources/**', '**/release/**'] } } });
  await server.listen(); const devUrl = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  await launch(devUrl); await openGraph();
  const field = (node: BlueprintNode, name: string) => inspector().getByLabel(node.name + ' · ' + name, { exact: true });
  const savedGraph = (saved: Awaited<ReturnType<typeof read>>) => saved.blueprints.find(graph => graph.id === f.editGraph.id)!;
  const savedNode = (saved: Awaited<ReturnType<typeof read>>, id: string) => savedGraph(saved).nodes.find(node => node.id === id)!;

  phase = 'operation disconnection confirmation and undo'; await select(f.editorEdit);
  await expect(field(f.editorEdit, '选择控件').locator('option[value="free_input"]')).toHaveCount(0);
  await field(f.editorEdit, '选项操作').selectOption('clear');
  const confirmation = inspector().getByRole('alertdialog', { name: '修改选项连接点确认' });
  await expect(confirmation).toContainText('1 条'); await confirmation.getByRole('button', { name: '保留原连接', exact: true }).click();
  await expect(field(f.editorEdit, '选项操作')).toHaveValue('insert');
  await field(f.editorEdit, '选项操作').selectOption('clear'); await confirmation.getByRole('button', { name: '确认修改选项操作', exact: true }).click();
  let saved = await save(); assert.equal(savedNode(saved, f.editorEdit.id).properties.operation, 'clear');
  assert.equal(savedGraph(saved).links.some(link => link.toNodeId === f.editorEdit.id && link.toPinId === 'label'), false);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); saved = await save();
  assert.equal(savedNode(saved, f.editorEdit.id).properties.operation, 'insert'); assert.equal(savedGraph(saved).links.some(link => link.toNodeId === f.editorEdit.id && link.toPinId === 'label'), true);
  await page.getByRole('button', { name: '重做', exact: true }).click(); saved = await save(); assert.equal(savedNode(saved, f.editorEdit.id).properties.operation, 'clear');
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await save();
  checks.push('取消不删线，确认后只移除不适用输入，一次撤销/重做恢复原字段和连接。');

  phase = 'typed option authoring and saved signatures'; await select(f.editorEdit);
  await field(f.editorEdit, '选项值类型').selectOption('boolean'); await expect(inspector().getByText(/原值类型不符/)).toBeVisible();
  await field(f.editorEdit, '选择控件').selectOption('boolean_choice'); await field(f.editorEdit, '选项值').selectOption('false');
  saved = await save(); assert.equal(savedNode(saved, f.editorEdit.id).properties.value, false); assert.equal(savedNode(saved, f.editorEdit.id).pins.find(pin => pin.id === 'value')!.dataType, 'boolean');
  await select(f.editorRead); await field(f.editorRead, '选项值类型').selectOption('number'); await field(f.editorRead, '选择控件').selectOption('number_choice');
  saved = await save(); assert.equal(savedNode(saved, f.editorRead.id).pins.find(pin => pin.id === 'value')!.dataType, 'number');
  await close(); await launch(devUrl); await openGraph(); await select(f.editorEdit);
  await expect(field(f.editorEdit, '选项值类型')).toHaveValue('boolean'); await expect(field(f.editorEdit, '选项值')).toHaveValue('false'); await expect(field(f.editorEdit, '选择控件')).toHaveValue('boolean_choice');
  checks.push('数值/开关/文字类型共享字段；旧常量不自动转换；保存重开保留类型、零/否值及引脚。');

  phase = 'unknown-version explicit recovery'; await close(); saved = await read();
  const old = savedNode(saved, f.editorEdit.id); old.properties.optionsVersion = 99; const unknown = JSON.stringify({ properties: old.properties, pins: old.pins });
  await saveProject(projectFile, saved); await launch(devUrl); await openGraph(); await select(f.editorEdit);
  await expect(inspector().getByText(/选项节点版本不受支持/)).toBeVisible();
  assert.equal(savedNode(await read(), f.editorEdit.id).properties.optionsVersion, 99);
  await inspector().getByRole('button', { name: '恢复当前选项配置', exact: true }).click();
  await inspector().getByRole('alertdialog', { name: '恢复选项节点确认' }).getByRole('button', { name: '确认恢复选项节点', exact: true }).click();
  await field(f.editorEdit, '选择控件').selectOption('choice'); saved = await save();
  assert.equal(savedNode(saved, f.editorEdit.id).properties.optionsVersion, 1); assert.equal(savedNode(saved, f.editorEdit.id).properties.optionsRecovery, unknown);
  checks.push('未知版本原样保存；明确恢复保留原定义，不以同步代替迁移。');

  phase = 'design capability and common-window layout'; await enterDesign(); await page.locator('[data-hierarchy-id="choice"]').click();
  await expect(page.getByLabel('控件蓝图操作')).toContainText('编辑本实例选项'); await expect(page.getByLabel('控件蓝图操作')).toContainText('读取选项标签和值');
  await page.locator('[data-hierarchy-id="free_input"]').click(); await expect(page.getByLabel('控件蓝图操作')).not.toContainText('编辑本实例选项');
  for (const [width, height] of [[1700, 1000], [1024, 768]]) {
    await app!.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); await page.screenshot({ path: path.join(output, 'option-authoring-' + width + '.png') });
  }
  await save(); const beforePreview = await fs.readFile(projectFile, 'utf8');
  phase = 'actual choice input and list semantics'; preview = await openUiPreviewWindow(app!, page); preview.setDefaultTimeout(18000); preview.on('pageerror', error => errors.push(error.message));
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#ui-preview'))!.setContentSize(1440, 1000));
  await showUiPreviewTestData(preview); await preview.getByLabel('画面缩放比例', { exact: true }).selectOption('fit');
  const target = (id: string) => preview!.locator('[data-preview-component="' + id + '"]');
  const act = (name: string) => target('option_act_' + name).click();
  const choice = target('choice').getByRole('combobox'), mirror = target('mirror').getByRole('combobox');
  const parameter = (name: string) => preview!.getByLabel('预演参数 ' + name, { exact: true });
  const reset = async () => { await preview!.getByRole('button', { name: '恢复测试值', exact: true }).click(); await expect(choice).toHaveValue('0'); await expect(parameter('用户改值次数')).toHaveValue('0'); };
  await expect(choice.locator('option')).toHaveCount(2); await act('append'); await expect(choice.locator('option')).toHaveCount(3);
  await act('rename'); await expect(choice.locator('option').nth(0)).toHaveText('初始改名'); await act('move'); await expect(choice).toHaveValue('1');
  await expect(mirror.locator('option')).toHaveCount(2); await expect(parameter('选项来源')).toHaveValue('初始'); await expect(parameter('用户改值次数')).toHaveValue('0');
  await choice.selectOption('2'); await expect(parameter('选项来源')).toHaveValue('动态'); await expect(parameter('用户改值次数')).toHaveValue('1'); await expect(mirror).toHaveValue('-1');
  await preview.screenshot({ path: path.join(output, 'live-option-order-and-source.png') });
  await reset(); await act('append'); await act('override'); await act('clear');
  await expect(choice).toBeDisabled(); await expect(choice.locator('option:checked')).toHaveText('暂无选项'); await expect(target('choice').getByRole('textbox')).toHaveCount(0);
  await act('reset'); await expect(choice).toBeEnabled(); await expect(choice).toHaveValue('-1'); await expect(parameter('选项来源')).toHaveValue('初始');
  await act('whole'); await expect(choice).toHaveValue('0'); await expect(parameter('用户改值次数')).toHaveValue('0');
  await act('readonly'); await act('append'); await expect(choice).toBeDisabled(); await expect(choice.locator('option')).toHaveCount(3);
  checks.push('真实选择事件写来源一次；列表改动、清空和恢复不写来源；空选择框不变成输入框，只读仍允许蓝图编辑。');

  phase = 'child/template lifecycle and timed tasks'; await reset(); await act('child'); await target('child_append').click();
  await expect(target('child_choice').getByRole('combobox').locator('option')).toHaveCount(3); await target('child_close').click(); await act('child');
  await expect(target('child_choice').getByRole('combobox').locator('option')).toHaveCount(2); await target('child_close').click();
  await act('native'); await target('native_append').click(); await expect(target('native_choice').getByRole('combobox').locator('option')).toHaveCount(3);
  await target('native_choice').getByRole('combobox').selectOption('1'); await target('native_close').click(); await act('native');
  await expect(target('native_choice').getByRole('combobox')).toHaveValue('1'); await expect(target('native_choice').getByRole('combobox').locator('option')).toHaveCount(2); await target('native_close').click();
  await preview.getByLabel('按时间预演', { exact: true }).check(); await preview.getByRole('button', { name: '播放计时', exact: true }).click(); await act('background');
  await expect(parameter('job_done')).toHaveValue('true'); await expect(choice.locator('option').nth(2)).toHaveText('后台新增'); await expect(parameter('用户改值次数')).toHaveValue('0');
  await preview.getByRole('button', { name: '暂停计时', exact: true }).click(); await preview.screenshot({ path: path.join(output, 'background-and-instance-options.png') });
  checks.push('新页面和内置模板重开不继承列表覆盖，来源按生命周期保留；后台任务使用同一选项节点。');
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
