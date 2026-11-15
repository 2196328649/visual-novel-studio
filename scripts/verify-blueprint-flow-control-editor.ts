import { openBlueprintOptions, closeBlueprintOptions, setBlueprintOption } from './lib/blueprint-canvas';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createBlueprintFlowControlFixture } from './lib/blueprint-flow-control-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { projectSchema, type Project, type BlueprintNode } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';
import { compileProject } from '../src/runtime/compiler';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Only isolated development verification is permitted.');
const root = path.resolve('.'), output = path.join(root, 'artifacts/blueprint-flow-control-editor', new Date().toISOString().replaceAll(':', '-'));
const f = createBlueprintFlowControlFixture(), project = f.project;
const authored = f.graph('作者控制节点'), pageAuthored = f.graph('页面节点创作'), nativeAuthored = f.graph('模板节点创作');
Object.assign(pageAuthored, { kind: 'ui', uiPageId: f.root.id }); Object.assign(nativeAuthored, { kind: 'ui', uiPageId: 'ui:preferences', uiInstanceId: 'base' });
const projectFile = path.join(output, 'project/project.vns.json'); await fs.mkdir(path.dirname(projectFile), { recursive: true }); await saveProject(projectFile, project);
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**', '**/work/**'] } } });
await server.listen(); const devUrl = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch', failure: string | undefined;
const checks: string[] = [], errors: string[] = [], processes: { pid?: number; alive: boolean }[] = [];
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const graph = (p: Project, id = authored.id) => p.blueprints.find(g => g.id === id)!;
const inspector = () => page!.locator('.blueprint-properties');
const card = (id: string) => page!.locator('.react-flow__node[data-id="' + id + '"]');
const record = (message: string) => { checks.push(message); console.log('PASS ' + checks.length + ': ' + message); };
async function launch() {
  app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile, devUrl, sdkRoot: 'E:/Tools/renpy-8.5.3-sdk' });
  page = await app.firstWindow(); page.setDefaultTimeout(14000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 }); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000));
}
async function close() {
  if (!app) return; const pid = app.process().pid; await app.close(); app = undefined;
  let alive = false; if (pid) try { process.kill(pid, 0); alive = true; } catch { /* fixture exited */ }
  processes.push({ pid, alive }); expect(alive).toBe(false);
}
async function save(ui = false) {
  if (ui) { await page!.getByRole('button', { name: '保存界面', exact: true }).click(); await expect(page!.locator('.ui-save-status')).toHaveText('已保存'); await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled(); }
  await page!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); return read();
}
async function openGraph(id: string) {
  await page!.locator('[data-workspace-tab="blueprint"]').click(); await page!.getByLabel('演出目标', { exact: true }).selectOption('graph:' + id); await fitBlueprintCanvas(page!);
  if (!await inspector().isVisible()) await page!.getByRole('button', { name: '展开蓝图属性', exact: true }).click();
}
async function select(id: string) { await fitBlueprintCanvas(page!); await card(id).locator('.graph-node-title strong').click(); await inspector().getByRole('button', { name: '节点参数', exact: true }).click(); }
async function add(search: string, name: string) {
  const expand = page!.getByRole('button', { name: '展开节点库', exact: true });
  if (!await page!.locator('.blueprint-palette').isVisible() && await expand.isVisible()) await expand.click();
  if (await page!.locator('.blueprint-palette').isVisible()) {
    await page!.getByLabel('搜索蓝图节点').fill(search); await page!.locator('.blueprint-library-node').getByText(name, { exact: true }).click();
  } else {
    await page!.locator('.blueprint-commandbar').getByRole('button', { name: /^添加节点/ }).click();
    const picker = page!.getByRole('dialog', { name: '添加蓝图节点', exact: true });
    await picker.getByLabel('搜索要添加的节点').fill(search); await picker.getByText(name, { exact: true }).click(); await expect(picker).toHaveCount(0);
  }
}
async function connect(from: string, out: string, to: string, input: string) {
  await fitBlueprintCanvas(page!);
  await card(from).locator('.react-flow__handle[data-handleid="' + out + '"]').click();
  await card(to).locator('.react-flow__handle[data-handleid="' + input + '"]').click();
}
async function enterPage(id: string, graphId: string) {
  await page!.locator('.view-tabs').getByRole('button', { name: '界面', exact: true }).click();
  await page!.getByLabel('界面编辑模式').getByRole('button', { name: '设计', exact: true }).click();
  await page!.getByLabel('设计页面', { exact: true }).selectOption(id.startsWith('ui:') ? id.slice(3) : id);
  await page!.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click();
  await page!.getByLabel('当前页面事件图', { exact: true }).selectOption(graphId);
}
try {
  await launch(); const original = await read(); await openGraph(authored.id);
  phase = 'palette and initial state'; await add('Do Once', '执行一次（Do Once）');
  let saved = await save(); const once = graph(saved).nodes.find(n => n.type === 'doOnce')!;
  expect(once.properties.scope).toBe('call'); expect(once.properties.initiallyClosed).toBe(false); await select(once.id);
  expect(await inspector().getByLabel(once.name + ' · 状态作用域', { exact: true }).locator('option').allTextContents()).toEqual(['本次调用', '页面实例']);
  await inspector().getByLabel(once.name + ' · 初始关闭', { exact: true }).selectOption('true'); saved = await save(); expect(graph(saved).nodes.find(n => n.id === once.id)!.properties.initiallyClosed).toBe(true);
  await page!.getByRole('button', { name: '撤销', exact: true }).click(); saved = await save(); expect(graph(saved).nodes.find(n => n.id === once.id)!.properties.initiallyClosed).toBe(false);
  await page!.getByRole('button', { name: '重做', exact: true }).click(); saved = await save(); expect(graph(saved).nodes.find(n => n.id === once.id)!.properties.initiallyClosed).toBe(true);
  await page!.getByRole('button', { name: '撤销', exact: true }).click(); await save();
  record('中英文搜索创建执行一次；初始开关和两种生命周期真实保存，一次撤销/重做。');

  phase = 'multi-entry wires'; await add('Gate', '门控（Gate）'); saved = await save(); const gate = graph(saved).nodes.find(n => n.type === 'gate')!;
  expect(gate.pins.filter(p => p.direction === 'input').map(p => p.id)).toEqual(['exec_in', 'open', 'close', 'toggle', 'reset']);
  await setBlueprintOption(page!, '自动接线', false);
  await page!.getByRole('button', { name: '自动排列蓝图', exact: true }).click(); await expect(page!.getByRole('button', { name: '自动排列蓝图', exact: true })).toBeEnabled();
  await connect(authored.nodes[0].id, 'exec', gate.id, 'open'); await connect(gate.id, 'updated', once.id, 'exec_in'); saved = await save();
  expect(graph(saved).links.some(l => l.fromNodeId === authored.nodes[0].id && l.toNodeId === gate.id && l.toPinId === 'open')).toBe(true);
  await connect(gate.id, 'updated', once.id, 'reset'); saved = await save(); expect(graph(saved).links.some(l => l.fromNodeId === gate.id && l.toNodeId === once.id && l.toPinId === 'reset')).toBe(true);
  await page!.getByRole('button', { name: '撤销', exact: true }).click(); saved = await save(); expect(graph(saved).links.some(l => l.fromNodeId === gate.id && l.toPinId === 'exec_in')).toBe(true);
  await page!.getByRole('button', { name: '重做', exact: true }).click(); await save();
  await connect(once.id, 'exec_out', gate.id, 'close'); saved = await save();
  expect(graph(saved).links.some(l => l.fromNodeId === once.id && l.toNodeId === gate.id && l.toPinId === 'close')).toBe(true);
  expect(compileProject(saved).diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  record('真实连接点区分打开门、尝试执行与重置；改接可撤销，有限的关门/重置回线不会被误判为死循环。');

  phase = 'scope and page contract'; await select(once.id); await inspector().getByLabel(once.name + ' · 状态作用域', { exact: true }).selectOption('page');
  await inspector().getByLabel(once.name + ' · 状态所属页面', { exact: true }).selectOption(f.root.id); saved = await save();
  const scoped = structuredClone(graph(saved).nodes.find(n => n.id === once.id)!); expect(scoped.properties.pageId).toBe(f.root.id);
  await inspector().getByLabel(once.name + ' · 状态作用域', { exact: true }).selectOption('call'); saved = await save(); expect(graph(saved).nodes.find(n => n.id === once.id)!.pins.some(p => p.id === 'pageId')).toBe(false);
  await page!.getByRole('button', { name: '撤销', exact: true }).click(); saved = await save(); expect(graph(saved).nodes.find(n => n.id === once.id)).toEqual(scoped);
  record('普通蓝图可显式选择页面实例；作用域切换只移除页面输入，撤销完整恢复所属页面和重置连线。');

  phase = 'copy/delete and reopen'; await select(once.id); await inspector().getByRole('button', { name: '复制选中节点', exact: true }).click(); saved = await save();
  const copy = graph(saved).nodes.find(n => n.type === 'doOnce' && n.id !== once.id)!; expect(copy.id).not.toBe(once.id); expect(copy.properties).toEqual(scoped.properties);
  await inspector().getByRole('button', { name: '删除选中节点', exact: true }).click(); saved = await save(); expect(graph(saved).nodes.some(n => n.id === copy.id)).toBe(false);
  await page!.getByRole('button', { name: '撤销', exact: true }).click(); saved = await save(); expect(graph(saved).nodes.find(n => n.id === copy.id)).toEqual(copy);
  await close(); await launch(); await openGraph(authored.id); saved = await read(); expect(graph(saved).nodes.find(n => n.id === once.id)).toEqual(scoped);
  expect(graph(saved).nodes.find(n => n.id === copy.id)).toEqual(copy); expect(graph(saved).links.some(l => l.fromNodeId === gate.id && l.toPinId === 'reset')).toBe(true);
  await page!.getByRole('button', { name: '自动排列蓝图', exact: true }).click(); await expect(page!.getByRole('button', { name: '自动排列蓝图', exact: true })).toBeEnabled(); await save();
  await select(gate.id); await page!.screenshot({ path: path.join(output, 'control-entries-reopened.png') });
  record('复制具有新的节点身份；删除和撤销、保存重开保留各自配置与具体执行入口。');

  phase = 'authored page draft'; await enterPage(f.root.id, pageAuthored.id); const diskBeforePage = await read();
  await add('门控', '门控（Gate）'); expect(graph(await read(), pageAuthored.id)).toEqual(graph(diskBeforePage, pageAuthored.id));
  saved = await save(true); const pageGate = graph(saved, pageAuthored.id).nodes.find(n => n.type === 'gate')!;
  expect(pageGate.properties).toMatchObject({ scope: 'page', pageId: f.root.id, initiallyClosed: true });
  record('新增页面默认使用所属页面实例；改动先在界面草稿，保存界面后才写入工程。');

  phase = 'native template and narrow layout'; await enterPage('ui:preferences', nativeAuthored.id); await add('执行一次', '执行一次（Do Once）'); saved = await save(true);
  const nativeOnce = graph(saved, nativeAuthored.id).nodes.find(n => n.type === 'doOnce')!;
  expect(nativeOnce.properties).toMatchObject({ scope: 'page', pageId: 'ui:preferences', initiallyClosed: false });
  await select(nativeOnce.id); await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1024, 768));
  await fitBlueprintCanvas(page!);
  await inspector().getByLabel(nativeOnce.name + ' · 状态所属页面', { exact: true }).scrollIntoViewIfNeeded();
  await expect(inspector().getByLabel(nativeOnce.name + ' · 状态作用域', { exact: true })).toBeInViewport({ ratio: .99 });
  await expect(inspector().getByLabel(nativeOnce.name + ' · 状态所属页面', { exact: true })).toBeInViewport({ ratio: .99 });
  expect(await page!.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page!.screenshot({ path: path.join(output, 'control-native-template-1024.png') });
  expect(saved.minigames).toEqual(original.minigames); expect(saved.scriptText?.content).toBe(original.scriptText?.content); expect(errors).toEqual([]);
  expect(compileProject(saved).diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  record('内置设置模板使用同一节点与页面实例接口；1024 宽可操作，没有小游戏定义、文本改写或编译错误。');
} catch (error) {
  failure = String(error); console.error('FAIL [' + phase + ']: ' + failure); await page?.screenshot({ path: path.join(output, 'failure.png'), timeout: 10000, animations: 'disabled' }).catch(() => undefined);
} finally {
  try { await close(); } catch (error) { failure ??= 'Fixture cleanup: ' + String(error); } await server.close();
  const report = { status: failure || errors.length ? 'failed' : 'passed', phase, checks, errors, failure, processes, projectFile };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log('Report: ' + path.join(output, 'report.json')); if (report.status !== 'passed') process.exitCode = 1;
}
