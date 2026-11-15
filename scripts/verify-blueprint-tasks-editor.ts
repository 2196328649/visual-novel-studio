import assert from 'node:assert/strict';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createBlueprintTaskFixture } from './lib/blueprint-task-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas, setBlueprintOption } from './lib/blueprint-canvas';
import { blueprintNodeDefaults, createBlueprintGraph } from '../src/core/blueprint';
import { blueprintTaskCatalog, type BlueprintTaskNodeType } from '../src/core/blueprint-tasks';
import { projectSchema, type Project, type BlueprintNode } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Only isolated development acceptance is permitted.');
const root = path.resolve('.'), output = path.resolve('artifacts/blueprint-tasks-editor', new Date().toISOString().replaceAll(':', '-'));
const f = createBlueprintTaskFixture(), authored = createBlueprintGraph('function', '任务节点创作'), unknown = blueprintNodeDefaults('startTask'); unknown.properties.taskVersion = 77; authored.nodes.push(unknown); f.project.blueprints.push(authored);
const projectFile = path.join(output, 'project/project.vns.json'); await fs.mkdir(path.dirname(projectFile), { recursive: true }); await saveProject(projectFile, f.project);
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**','**/work/**','**/resources/**','**/release/**'] } } }); await server.listen();
const devUrl = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch';
const checks: string[] = [], errors: string[] = [], processes: { pid?: number; exited: boolean }[] = [];
const report: Record<string, unknown> = { status: 'running', checks, errors, processes };
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const graph = (project: Project, id: string) => project.blueprints.find(graph => graph.id === id)!;
const inspector = () => page!.locator('.blueprint-properties');
const card = (node: BlueprintNode) => page!.locator('.react-flow__node[data-id="' + node.id + '"]');
async function launch() {
  app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile, devUrl }); page = await app.firstWindow(); page.setDefaultTimeout(16000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(f.project.name, { timeout: 45000 }); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1832, 1000));
}
async function close() {
  if (!app) return; const child = app.process(); await app.close(); app = undefined;
  let exited = child.exitCode !== null || child.signalCode !== null; if (!exited && child.pid) { try { process.kill(child.pid, 0); } catch { exited = true; } }
  processes.push({ pid: child.pid, exited }); assert.equal(exited, true);
}
async function openGraph(id: string) {
  await page!.locator('[data-workspace-tab="blueprint"]').click(); await page!.getByLabel('演出目标', { exact: true }).selectOption('graph:' + id);
  if (!await inspector().isVisible()) await page!.getByRole('button', { name: '展开蓝图属性', exact: true }).click(); await setBlueprintOption(page!, '自动接线', false);
}
async function select(node: BlueprintNode) { await fitBlueprintCanvas(page!); await card(node).locator('.graph-node-title strong').click(); await inspector().getByRole('button', { name: '节点参数', exact: true }).click(); }
async function save(ui = false) {
  if (ui) { await page!.getByRole('button', { name: '保存界面', exact: true }).click(); await expect(page!.locator('.ui-save-status')).toHaveText('已保存'); await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled(); }
  await page!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); return read();
}
async function add(type: BlueprintTaskNodeType, search: string) {
  const expand = page!.getByRole('button', { name: '展开节点库', exact: true }); if (!await page!.locator('.blueprint-palette').isVisible() && await expand.isVisible()) await expand.click();
  if (await page!.locator('.blueprint-palette').isVisible()) { await page!.getByLabel('搜索蓝图节点').fill(search); await page!.locator('.blueprint-library-node').getByText(blueprintTaskCatalog[type].name, { exact: true }).click(); }
  else { await page!.locator('.blueprint-commandbar').getByRole('button', { name: /^添加节点/ }).click(); const picker = page!.getByRole('dialog', { name: '添加蓝图节点', exact: true }); await picker.getByLabel('搜索要添加的节点').fill(search); await picker.getByText(blueprintTaskCatalog[type].name, { exact: true }).click(); }
}
try {
  await launch(); await openGraph(authored.id);
  phase = 'catalog'; for (const [type, search] of [['throttle','Throttle'],['debounce','防抖'],['startTask','Start Task'],['waitTask','Await Task'],['cancelTask','取消任务'],['taskStatus','Task Status']] as const) await add(type, search);
  let saved = await save(); const nodes = graph(saved, authored.id).nodes;
  for (const type of Object.keys(blueprintTaskCatalog)) assert.ok(nodes.some(node => node.type === type));
  const task = nodes.find(node => node.type === 'startTask' && node.id !== unknown.id)!, wait = nodes.find(node => node.type === 'waitTask')!;
  phase = 'task definition'; await select(task); await inspector().getByLabel(task.name + ' · 任务模块', { exact: true }).selectOption(f.worker.id);
  await inspector().getByLabel(task.name + ' · 生命周期', { exact: true }).selectOption('page'); await inspector().getByLabel('所属页面', { exact: true }).selectOption(f.page.id);
  await inspector().getByLabel(task.name + ' · 重复启动', { exact: true }).selectOption('replace'); await inspector().getByLabel('延后秒数', { exact: true }).fill('0.25'); await page!.keyboard.press('Tab');
  saved = await save(); const configured = graph(saved, authored.id).nodes.find(node => node.id === task.id)!;
  assert.equal(configured.properties.scope, 'page'); assert.equal(configured.properties.conflict, 'replace'); assert.equal(configured.properties.seconds, .25); assert.ok(configured.pins.some(pin => pin.id === 'arg_payload_input'));
  checks.push('All six nodes are discoverable; authoring uses ordinary module interfaces and page/call lifetimes.');
  phase = 'typed task results and wire'; await select(wait); await inspector().getByLabel(wait.name + ' · 任务模块', { exact: true }).selectOption(f.worker.id); await fitBlueprintCanvas(page!);
  const from = card(task).locator('.react-flow__handle.source[data-handleid="handle"]'), to = card(wait).locator('.react-flow__handle.target[data-handleid="handle"]');
  const a = await from.boundingBox(), b = await to.boundingBox(); assert.ok(a && b); await page!.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page!.mouse.down(); await page!.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 }); await page!.mouse.up();
  saved = await save(); assert.ok(graph(saved, authored.id).links.some(link => link.fromNodeId === task.id && link.fromPinId === 'handle' && link.toNodeId === wait.id && link.toPinId === 'handle')); assert.ok(graph(saved, authored.id).nodes.find(node => node.id === wait.id)!.pins.some(pin => pin.id === 'out_false_output' && pin.dataType === 'boolean'));
  checks.push('A real data-wire drag connects an opaque task handle, and Await exposes typed module outputs.');
  phase = 'scope undo'; await select(task); await inspector().getByLabel(task.name + ' · 生命周期', { exact: true }).selectOption('call'); saved = await save(); assert.ok(!graph(saved, authored.id).nodes.find(node => node.id === task.id)!.pins.some(pin => pin.id === 'pageId'));
  await page!.getByRole('button', { name: '撤销', exact: true }).click(); saved = await save(); assert.deepEqual(graph(saved, authored.id).nodes.find(node => node.id === task.id), configured);
  phase = 'unknown version'; await select(unknown); await expect(inspector().getByText(/任务定义版本无法识别/)).toBeVisible(); assert.equal(graph(saved, authored.id).nodes.find(node => node.id === unknown.id)!.properties.taskVersion, 77);
  await inspector().getByRole('button', { name: '恢复此任务节点', exact: true }).click(); await inspector().getByRole('button', { name: '保留原定义', exact: true }).click();
  await inspector().getByRole('button', { name: '恢复此任务节点', exact: true }).click(); await inspector().getByRole('button', { name: '确认恢复任务', exact: true }).click(); saved = await save();
  const recovered = graph(saved, authored.id).nodes.find(node => node.id === unknown.id)!; assert.equal(recovered.properties.taskVersion, 1); assert.equal(JSON.parse(String(recovered.properties.taskRecovery)).properties.taskVersion, 77);
  checks.push('Unknown versions survive save until explicit recovery; scope changes and recovery remain undoable.');
  phase = 'reopen'; const expected = graph(saved, authored.id); await close(); await launch(); await openGraph(authored.id); assert.deepEqual(graph(await read(), authored.id), expected); await select(task); await page!.screenshot({ path: path.join(output, 'task-fields-reopened.png') });
  phase = 'page draft'; await page!.locator('[data-workspace-tab="ui"]').click(); await page!.getByLabel('界面编辑模式').getByRole('button', { name: '设计', exact: true }).click(); await page!.getByLabel('设计页面', { exact: true }).selectOption(f.page.id); await page!.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click(); await page!.getByLabel('当前页面事件图', { exact: true }).selectOption(f.pageGraph.id);
  const diskPage = graph(await read(), f.pageGraph.id); await select(f.throttle); await inspector().getByLabel('冷却秒数', { exact: true }).fill('0.75'); await page!.keyboard.press('Tab'); assert.deepEqual(graph(await read(), f.pageGraph.id), diskPage);
  saved = await save(true); assert.equal(graph(saved, f.pageGraph.id).nodes.find(node => node.id === f.throttle.id)!.properties.seconds, .75);
  await fs.writeFile(path.join(output, 'authored-project.json'), JSON.stringify(saved, null, 2)); assert.deepEqual(errors, []);
  checks.push('Page events use the same fields and isolated draft history; reopening preserves task definitions and wires.'); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.phase = phase; report.error = String(error); if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); console.error(error); process.exitCode = 1; }
finally {
  try { await close(); await server.close(); const cleanup = await cleanVerificationDirectories(output, ['project','profile']); report.cleanup = cleanup; assert.deepEqual(cleanup.errors, []); }
  catch (error) { report.status = 'failed'; report.cleanupError = String(error); process.exitCode = 1; }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
}
