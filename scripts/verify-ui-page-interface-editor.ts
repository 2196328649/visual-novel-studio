import { openUiPageUsage } from './lib/ui-design-controls';
import assert from 'node:assert/strict';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUiPageInterfaceFixture, pageInterfacePng } from './lib/ui-page-interface-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { fitBlueprintCanvas, setBlueprintOption } from './lib/blueprint-canvas';
import { projectSchema, type Project, type BlueprintNode } from '../src/core/model';
import { blueprintNodeDefaults, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createCustomUiPage, addGameFlowStep } from '../src/core/game-flow';
import { uiPageInterfaceCatalog } from '../src/core/ui-page-interface';
import { saveProject } from '../src/desktop/project-store';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Do not use an installed/release editor for acceptance.');
const root = path.resolve('.'), output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? path.join(root, 'artifacts'), 'ui-page-interface-editor', new Date().toISOString().replaceAll(':', '-'));
const f = createUiPageInterfaceFixture(), authored = createBlueprintGraph('function', '页面接口节点创作'); f.project.blueprints.push(authored);
const authoredOpen = blueprintNodeDefaults('showUiPage'), consumer = blueprintNodeDefaults('setVariable'); authoredOpen.properties.pageId = f.child.id; consumer.properties.variableId = 'result_number'; consumer.x = 630; consumer.y = 200; authored.nodes.push(authoredOpen, consumer);
const step = addGameFlowStep(f.project, 'beforeTitle', { kind: 'page', pageId: f.child.id, inputs: { number: 0 } });
const future = createCustomUiPage(f.project, '未来版本页面'); f.project.ui.pageInterfaces![future.id] = structuredClone(f.project.ui.pageInterfaces![f.child.id]);
synchronizeBlueprintSignatures(f.project); f.project.ui.pageInterfaces![future.id].version = 77;
const projectFile = path.join(output, 'project/project.vns.json'), builtRenderer = process.env.VNS_VERIFY_BUILT_RENDERER === '1';
const checks: string[] = [], errors: string[] = [], processes: { pid?: number; exited: boolean }[] = [];
const report: Record<string, unknown> = { status: 'running', renderer: builtRenderer ? 'built' : 'development', checks, errors, processes };
let app: ElectronApplication | undefined, page: Page | undefined, server: ViteDevServer | undefined, devUrl = '', phase = 'setup';
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const graph = (project: Project, id: string) => project.blueprints.find(graph => graph.id === id)!;
const inspector = () => page!.locator('.blueprint-properties');
const card = (node: BlueprintNode) => page!.locator('.react-flow__node[data-id="' + node.id + '"]');
const typeNames = { boolean: '开关', number: '数值' } as const;
async function chooseType(owner: Locator, label: string, type: keyof typeof typeNames) {
  const trigger = owner.getByRole('combobox', { name: label, exact: true });
  await expect(trigger).toHaveJSProperty('tagName', 'BUTTON'); await trigger.click();
  const options = page!.getByRole('listbox', { name: label + '选项', exact: true, includeHidden: true });
  await expect(options).toBeVisible(); await options.getByRole('option', { name: typeNames[type], exact: true }).click();
  await expect(options).toHaveCount(1); await expect(options).toBeHidden();
}
async function size(width: number, height: number) {
  const window = await app!.browserWindow(page!);
  await window.evaluate(window => { if (window.isMinimized()) window.restore(); if (window.isMaximized()) window.unmaximize(); });
  await expect.poll(() => window.evaluate(window => window.isMaximized())).toBe(false);
  await window.evaluate((window, value) => { window.setContentSize(value.width, value.height); window.show(); window.focus(); }, { width, height });
  // Windows display scaling may round the requested client size by one pixel.
  await expect.poll(() => page!.evaluate(value => Math.max(Math.abs(innerWidth - value.width), Math.abs(innerHeight - value.height)), { width, height })).toBeLessThanOrEqual(2);
}
async function launch() {
  app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile, devUrl }); page = await app.firstWindow(); page.setDefaultTimeout(18000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(f.project.name, { timeout: 45000 });
  if (builtRenderer) assert.equal(fileURLToPath(page.url()), path.join(root, 'dist/index.html'));
  report.rendererUrl = page.url();
  await size(1360, 800);
}
async function close() {
  if (!app) return; const child = app.process(); await app.close();
  let exited = child.exitCode !== null || child.signalCode !== null; if (!exited && child.pid) { try { process.kill(child.pid, 0); } catch { exited = true; } }
  processes.push({ pid: child.pid, exited }); assert.equal(exited, true); app = undefined; page = undefined;
}
async function save(ui = false) {
  if (ui) { const saveUi = page!.getByRole('button', { name: '保存界面', exact: true }); if (await saveUi.isEnabled()) await saveUi.click(); await expect(saveUi).toBeDisabled(); }
  await page!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); return read();
}
async function openGraph() {
  await page!.locator('[data-workspace-tab="blueprint"]').click(); await page!.getByLabel('蓝图资源', { exact: true }).selectOption('graph:' + authored.id);
  if (!await inspector().isVisible()) await page!.getByRole('button', { name: '展开蓝图属性', exact: true }).click(); await setBlueprintOption(page!, '自动接线', false);
}
async function select(node: BlueprintNode) { await fitBlueprintCanvas(page!); await card(node).locator('.graph-node-title strong').click(); await inspector().getByRole('button', { name: '节点参数', exact: true }).click(); }
async function openPage(id: string) {
  await page!.locator('[data-workspace-tab="ui"]').click(); await page!.getByLabel('界面编辑模式').getByRole('button', { name: '设计', exact: true }).click();
  await page!.getByLabel('设计页面', { exact: true }).selectOption(id.startsWith('ui:') ? id.slice(3) : id);
  await page!.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click();
  await expect(page!.getByLabel('页面输入与结果', { exact: true })).toBeVisible();
}
try {
  await fs.mkdir(path.join(output, 'project/assets'), { recursive: true }); await fs.writeFile(path.join(output, 'project/assets/interface.png'), Buffer.from(pageInterfacePng, 'base64')); await saveProject(projectFile, f.project);
  if (!builtRenderer) { server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/work/**', '**/resources/**', '**/release/**'] } } }); await server.listen(); devUrl = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port; }
  await launch(); await openGraph();
  phase = 'Chinese/English page node discovery';
  for (const [type, query] of [['eventPage', 'OnClosed'], ['getPageInput', 'Get Page Input'], ['getPageOutput', '结果快照'], ['setPageOutput', 'Set Page Output'], ['preventPageClose', '否决关闭']] as const) {
    await page!.getByRole('button', { name: '添加节点', exact: true }).click(); const picker = page!.getByRole('dialog', { name: '添加蓝图节点', exact: true });
    await picker.getByLabel('搜索要添加的节点').fill(query); await picker.getByText(uiPageInterfaceCatalog[type].name, { exact: true }).click();
  }
  let saved = await save(); for (const type of Object.keys(uiPageInterfaceCatalog)) assert.ok(graph(saved, authored.id).nodes.some(node => node.type === type));
  const event = graph(saved, authored.id).nodes.find(node => node.type === 'eventPage')!; await select(event); await inspector().getByLabel(event.name + ' · 时机', { exact: true }).selectOption('closed');
  const input = graph(saved, authored.id).nodes.find(node => node.type === 'getPageInput')!; await select(input); await inspector().getByLabel(input.name + ' · 页面', { exact: true }).selectOption(f.child.id); await inspector().getByLabel(input.name + ' · 参数', { exact: true }).selectOption('number');
  saved = await save(); assert.equal(graph(saved, authored.id).nodes.find(node => node.id === input.id)!.pins.find(pin => pin.id === 'value')?.dataType, 'number');
  checks.push('All five interface/lifecycle nodes are discoverable with Chinese and English names; phase and parameter pickers update real saved signatures.');
  phase = 'drag typed result and change target'; await fitBlueprintCanvas(page!);
  const from = card(authoredOpen).locator('.react-flow__handle.source[data-handleid="out_number_result"]'), to = card(consumer).locator('.react-flow__handle.target[data-handleid="value"]');
  const a = await from.boundingBox(), b = await to.boundingBox(); assert.ok(a && b); await page!.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page!.mouse.down(); await page!.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 }); await page!.mouse.up();
  saved = await save(); const linked = graph(saved, authored.id).links.find(link => link.fromNodeId === authoredOpen.id && link.toNodeId === consumer.id)!; assert.ok(linked);
  await select(authoredOpen); await inspector().getByLabel(authoredOpen.name + ' · 页面', { exact: true }).selectOption(f.parent.id);
  await expect(inspector().getByRole('alertdialog', { name: '修改页面接口确认' })).toBeVisible(); await inspector().getByRole('button', { name: '保留原页面', exact: true }).click();
  saved = await save(); assert.ok(graph(saved, authored.id).links.some(link => link.id === linked.id));
  await inspector().getByLabel(authoredOpen.name + ' · 页面', { exact: true }).selectOption(f.parent.id); await inspector().getByRole('button', { name: '确认更换页面', exact: true }).click();
  saved = await save(); assert.ok(!graph(saved, authored.id).links.some(link => link.id === linked.id));
  await page!.getByRole('button', { name: '撤销', exact: true }).click(); saved = await save(); assert.ok(graph(saved, authored.id).links.some(link => link.id === linked.id));
  checks.push('A real result-wire drag is preserved on cancellation; incompatible target replacement confirms disconnection and is undoable.');
  phase = 'page interface draft'; await openPage(f.child.id); const pane = page!.getByLabel('页面输入与结果', { exact: true });
  const originalDisk = (await read()).ui.pageInterfaces![f.child.id], originalBytes = await fs.readFile(projectFile, 'utf8');
  await pane.locator('.ui-page-parameters').first().getByRole('button', { name: '新增', exact: true }).click();
  await expect(pane.getByLabel('页面参数名称', { exact: true })).toBeFocused();
  await expect(pane.getByRole('button', { name: '创建参数', exact: true })).toBeDisabled();
  await pane.getByLabel('页面参数名称', { exact: true }).fill('取消的页面参数');
  await pane.getByLabel('页面参数名称', { exact: true }).press('Escape');
  await expect(pane.getByRole('form', { name: '创建页面参数', exact: true })).toHaveCount(0);
  await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled();
  assert.equal(await fs.readFile(projectFile, 'utf8'), originalBytes);
  await pane.locator('.ui-page-parameters').first().getByRole('button', { name: '新增', exact: true }).click();
  await pane.getByLabel('页面参数名称', { exact: true }).fill('不应转移到另页的输入');
  await openPage(f.parent.id); await expect(page!.getByRole('form', { name: '创建页面参数', exact: true })).toHaveCount(0);
  await openPage(f.child.id); await expect(pane.getByRole('form', { name: '创建页面参数', exact: true })).toHaveCount(0);
  await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled();
  assert.equal(await fs.readFile(projectFile, 'utf8'), originalBytes);
  await pane.locator('.ui-page-parameters').first().getByRole('button', { name: '新增', exact: true }).click();
  await pane.getByLabel('页面参数名称', { exact: true }).fill('奖励值'); await chooseType(pane, '页面参数类型', 'number');
  await expect(pane.getByRole('combobox', { name: '页面参数类型', exact: true })).toContainText('数值'); await pane.getByRole('button', { name: '创建参数', exact: true }).click();
  assert.deepEqual((await read()).ui.pageInterfaces![f.child.id], originalDisk);
  saved = await save(true); const added = saved.ui.pageInterfaces![f.child.id].inputs.find(parameter => parameter.name === '奖励值')!; assert.ok(added); assert.equal(added.defaultValue, 0);
  const beforeSearch = await fs.readFile(projectFile, 'utf8');
  await pane.getByLabel('搜索页面输入', { exact: true }).fill('奖励');
  await expect(pane.locator('[data-page-parameter-direction="inputs"] [data-page-parameter-id]')).toHaveCount(1);
  await expect(pane.locator('[data-page-parameter-id="' + added.id + '"]')).toBeVisible();
  await pane.getByLabel('搜索页面输入', { exact: true }).fill('');
  await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled(); assert.equal(await fs.readFile(projectFile, 'utf8'), beforeSearch);
  const numberRow = pane.locator('[data-page-parameter-id="number"]'), numberSelect = numberRow.locator('.blueprint-member-select');
  await numberSelect.click(); await expect(numberSelect).toHaveAttribute('aria-pressed', 'true');
  const number = pane.locator('[data-page-parameter-details-id="number"]');
  await expect(pane.locator('[data-page-parameter-direction="inputs"] [data-page-parameter-details-id]')).toHaveCount(1);
  await chooseType(number, '数值输入 · 类型', 'boolean');
  const impact = pane.getByRole('alertdialog', { name: '修改页面接口影响' }); await expect(impact.getByText(/1 个流程步骤/)).toBeVisible();
  await impact.getByRole('button', { name: '确认修改页面接口', exact: true }).click();
  await expect(number.getByRole('combobox', { name: '数值输入 · 类型', exact: true })).toContainText('开关');
  assert.equal((await read()).ui.pageInterfaces![f.child.id].inputs.find(parameter => parameter.id === 'number')?.dataType, 'number');
  // Saving commits and ends the discardable UI draft; exercise its history before that checkpoint.
  await page!.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(number.getByRole('combobox', { name: '数值输入 · 类型', exact: true })).toContainText('数值');
  await page!.getByRole('button', { name: '重做', exact: true }).click();
  await expect(number.getByRole('combobox', { name: '数值输入 · 类型', exact: true })).toContainText('开关');
  saved = await save(true);
  assert.equal(saved.ui.pageInterfaces![f.child.id].inputs.find(parameter => parameter.id === 'number')?.dataType, 'boolean');
  const flowStep = saved.gameFlow!.beforeTitle.steps.find(item => item.id === step.id)!; assert.ok(flowStep.kind === 'page'); assert.equal(flowStep.inputs?.number, 0);
  await chooseType(number, '数值输入 · 类型', 'number');
  await impact.getByRole('button', { name: '确认修改页面接口', exact: true }).click();
  saved = await save(true); assert.equal(saved.ui.pageInterfaces![f.child.id].inputs.find(parameter => parameter.id === 'number')?.dataType, 'number');
  checks.push('Page interfaces stay in the page draft until save, with undo/redo before the checkpoint; type changes show flow usage and retain mismatching arguments for explicit repair.');
  phase = 'native template connection'; await openPage('ui:preferences'); await openUiPageUsage(page!);
  const dialog = page!.getByRole('dialog', { name: '页面使用位置', exact: true }); await expect(dialog.getByText('页面已不存在', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('页面接入位置').selectOption('beforeNewGame'); await dialog.getByLabel('页面接入输入 · 提供 数值输入', { exact: true }).check(); await dialog.getByLabel('页面接入输入 数值输入', { exact: true }).fill('0'); await page!.keyboard.press('Tab');
  await expect(dialog.getByLabel('页面接入预设', { exact: true })).toHaveValue('page'); await expect(dialog.getByLabel('页面接入预设', { exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '添加使用位置', exact: true }).click(); await expect(dialog.getByRole('status')).toContainText('新游戏前流程'); await dialog.getByRole('button', { name: '完成', exact: true }).click();
  saved = await save(true); assert.ok(saved.gameFlow!.beforeNewGame.some(item => item.kind === 'page' && item.pageId === 'ui:preferences' && item.inputs?.number === 0 && item.wait));
  checks.push('Built-in menu templates use the same connection entry and typed inputs, while their host enforces waiting/modality.');
  phase = 'future definition recovery'; await openPage(future.id); const futurePane = page!.getByLabel('页面输入与结果', { exact: true });
  await expect(futurePane.getByRole('alert')).toContainText('77'); await futurePane.getByRole('button', { name: '恢复页面接口', exact: true }).click(); await futurePane.getByRole('button', { name: '保留原定义', exact: true }).click();
  saved = await save(true); assert.equal(saved.ui.pageInterfaces![future.id].version, 77);
  await futurePane.getByRole('button', { name: '恢复页面接口', exact: true }).click(); await futurePane.getByRole('button', { name: '确认修改页面接口', exact: true }).click(); saved = await save(true);
  assert.equal(saved.ui.pageInterfaces![future.id].version, 1); assert.equal(JSON.parse(saved.ui.pageInterfaces![future.id].recovery!).version, 77);
  phase = 'reopen and compact panel'; const expected = structuredClone(saved.ui.pageInterfaces); await close(); await launch(); await openPage(f.child.id); assert.deepEqual((await read()).ui.pageInterfaces, expected);
  await page!.screenshot({ path: path.join(output, 'interfaces-reopened.png') }); await size(1100, 780);
  await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeVisible(); await expect(page!.locator('.ui-editor-header').getByRole('button', { name: '页面使用位置', exact: true })).toHaveCount(0); await expect(page!.locator('.ui-event-library').getByRole('button', { name: '页面使用位置', exact: true })).toBeVisible(); await page!.screenshot({ path: path.join(output, 'interfaces-compact.png') });
  await fs.writeFile(path.join(output, 'authored-project.json'), JSON.stringify(await read(), null, 2)); assert.deepEqual(errors, []);
  checks.push('Unknown definitions require explicit recovery and keep recovery data; interface edits persist after reopening and core controls remain visible in the compact layout.'); report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.phase = phase; report.error = String(error);
  if (page) {
    report.failureWindow = await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ bounds: window.getBounds(), content: window.getContentBounds(), minimized: window.isMinimized(), maximized: window.isMaximized(), visible: window.isVisible(), focused: window.isFocused() }))).catch(() => undefined);
    report.failureCanvas = await page.evaluate(() => ({ visibility: document.visibilityState, size: [innerWidth, innerHeight], panes: [...document.querySelectorAll('.blueprint-workspace .react-flow')].map(pane => ({ bounds: pane.getBoundingClientRect().toJSON(), transform: pane.querySelector('.react-flow__viewport')?.getAttribute('style'), nodes: [...pane.querySelectorAll('.react-flow__node')].map(node => ({ id: node.getAttribute('data-id'), bounds: node.getBoundingClientRect().toJSON() })) })) })).catch(() => undefined);
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  }
  console.error(error); process.exitCode = 1;
}
finally {
  try { await close(); } catch (error) { report.status = 'failed'; report.closeError = String(error); process.exitCode = 1; }
  try { await server?.close(); } catch (error) { report.status = 'failed'; report.serverError = String(error); process.exitCode = 1; }
  try { if (app) throw new Error('Fixture is still running.'); const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); report.cleanup = cleanup; assert.deepEqual(cleanup.errors, []); }
  catch (error) { report.status = 'failed'; report.cleanupError = String(error); process.exitCode = 1; }
  await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
}
