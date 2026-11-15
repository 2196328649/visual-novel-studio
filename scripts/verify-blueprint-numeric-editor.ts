import assert from 'node:assert/strict';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject, projectSchema, type Project, type BlueprintNode } from '../src/core/model';
import { createBlueprintGraph } from '../src/core/blueprint';
import { blueprintNumericCatalog, blueprintNumericInputs, type BlueprintNumericType } from '../src/core/blueprint-numeric';
import { createCustomUiPage } from '../src/core/game-flow';
import { saveProject } from '../src/desktop/project-store';
import { compileProject } from '../src/runtime/compiler';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas, setBlueprintOption } from './lib/blueprint-canvas';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Use isolated development verification, not the installed application.');
const root = path.resolve('.'), output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? path.join(root, 'artifacts'), 'blueprint-numeric-editor', new Date().toISOString().replaceAll(':', '-'));
const verifyDist = process.env.VNS_VERIFY_DIST === '1';
const project = createProject(); project.id = 'blueprint_numeric_authoring'; project.name = '通用数值节点作者验收';
const authored = createBlueprintGraph('function', '数值创作'); project.blueprints.push(authored);
const pageResource = createCustomUiPage(project, '数值操作页面'), pageGraph = project.blueprints.find(graph => graph.uiPageId === pageResource.id)!;
const projectFile = path.join(output, 'project/project.vns.json'); await fs.mkdir(path.dirname(projectFile), { recursive: true }); await saveProject(projectFile, project);
let server: ViteDevServer | undefined, devUrl: string | undefined;
let app: ElectronApplication | undefined, page!: Page, phase = 'launch';
const checks: string[] = [], errors: string[] = [], processes: { pid?: number; exited: boolean }[] = [];
const report: Record<string, unknown> = { status: 'running', renderer: verifyDist ? 'dist' : 'vite', checks, errors, processes };
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const graph = (p: Project, id = authored.id) => p.blueprints.find(item => item.id === id)!;
const inspector = () => page.locator('.blueprint-properties');
const card = (id: string) => page.locator('.react-flow__node[data-id="' + id + '"]');
async function launch() {
  if (!verifyDist && !server) {
    server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/work/**', '**/resources/**', '**/release/**'] } } });
    await server.listen(); devUrl = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  }
  app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile, devUrl });
  page = await app.firstWindow(); page.setDefaultTimeout(16000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  if (verifyDist) assert.equal(fileURLToPath(page.url()), path.join(root, 'dist/index.html'));
  report.rendererUrl = page.url();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1832, 1000));
}
async function close() {
  if (!app) return; const child = app.process(); await app.close(); app = undefined;
  let exited = child.exitCode !== null || child.signalCode !== null;
  if (!exited && child.pid) { try { process.kill(child.pid, 0); } catch { exited = true; } }
  processes.push({ pid: child.pid, exited }); assert.equal(exited, true);
}
async function openGraph() {
  await page.locator('[data-workspace-tab="blueprint"]').click(); await page.getByLabel('蓝图资源', { exact: true }).selectOption('graph:' + authored.id);
  if (!await inspector().isVisible()) await page.getByRole('button', { name: '展开蓝图属性', exact: true }).click();
  await setBlueprintOption(page, '自动接线', false);
}
async function save(ui = false) {
  if (ui) { await page.getByRole('button', { name: '保存界面', exact: true }).click(); await expect(page.locator('.ui-save-status')).toHaveText('已保存'); await expect(page.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled(); }
  await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0); return read();
}
async function select(node: BlueprintNode) { await fitBlueprintCanvas(page); await card(node.id).locator('.graph-node-title strong').click(); await inspector().getByRole('button', { name: '节点参数', exact: true }).click(); }
async function add(type: BlueprintNumericType, search: string) {
  const expand = page.getByRole('button', { name: '展开节点库', exact: true });
  if (!await page.locator('.blueprint-palette').isVisible() && await expand.isVisible()) await expand.click();
  if (await page.locator('.blueprint-palette').isVisible()) {
    await page.getByLabel('搜索蓝图节点').fill(search); await page.locator('.blueprint-library-node').getByText(blueprintNumericCatalog[type].name, { exact: true }).click();
  } else {
    await page.locator('.blueprint-commandbar').getByRole('button', { name: /^添加节点/ }).click();
    const picker = page.getByRole('dialog', { name: '添加蓝图节点', exact: true }); await picker.getByLabel('搜索要添加的节点').fill(search); await picker.getByText(blueprintNumericCatalog[type].name, { exact: true }).click();
  }
}
async function connect(from: BlueprintNode, to: BlueprintNode, input: string) {
  await fitBlueprintCanvas(page); await card(from.id).locator('.react-flow__handle[data-handleid="result"]').click(); await card(to.id).locator('.react-flow__handle[data-handleid="' + input + '"]').click();
}
try {
  await launch(); await openGraph();
  phase = 'numeric catalog';
  for (const [type, search] of [['clamp', 'Clamp'], ['abs', '绝对值'], ['round', 'Round'], ['inRange', '范围判断'], ['nearlyEqual', 'Nearly Equal'], ['mapRange', '映射'], ['lerp', 'Lerp']] as const) await add(type, search);
  let saved = await save();
  for (const type of Object.keys(blueprintNumericCatalog) as BlueprintNumericType[]) {
    const node = graph(saved).nodes.find(node => node.type === type)!; assert.ok(node);
    assert.deepEqual(node.pins.filter(pin => pin.direction === 'input').map(pin => pin.id), blueprintNumericInputs[type].map(pin => pin.id));
    assert.ok(node.pins.every(pin => pin.dataType !== 'exec'));
  }
  checks.push('Seven pure numeric nodes are searchable by Chinese/English and preserve their typed stable pins.');
  const round = graph(saved).nodes.find(node => node.type === 'round')!, absolute = graph(saved).nodes.find(node => node.type === 'abs')!, clamp = graph(saved).nodes.find(node => node.type === 'clamp')!, near = graph(saved).nodes.find(node => node.type === 'nearlyEqual')!;
  phase = 'shared fields'; await select(round);
  await inspector().getByLabel('数值', { exact: true }).fill('-2.5');
  await inspector().getByLabel(round.name + ' · 取整方式', { exact: true }).selectOption('floor');
  await expect(card(round.id).getByLabel(round.name + ' · 数值', { exact: true })).toHaveValue('-2.5');
  await expect(card(round.id).getByLabel(round.name + ' · 取整方式', { exact: true })).toHaveValue('floor');
  saved = await save(); assert.equal(graph(saved).nodes.find(node => node.id === round.id)!.properties.mode, 'floor');
  await page.getByRole('button', { name: '撤销', exact: true }).click(); saved = await save(); assert.equal(graph(saved).nodes.find(node => node.id === round.id)!.properties.mode, 'nearest');
  await page.getByRole('button', { name: '重做', exact: true }).click(); await save();
  checks.push('Card and inspector share numeric/rounding fields; editing is one undo/redo transaction.');
  phase = 'typed connections'; await connect(absolute, round, 'value'); saved = await save();
  assert.ok(graph(saved).links.some(link => link.fromNodeId === absolute.id && link.toNodeId === round.id && link.toPinId === 'value'));
  await select(round); await expect(inspector().getByRole('button', { name: /^定位数值来源：/ })).toBeVisible(); await expect(inspector().getByLabel('数值', { exact: true })).toHaveCount(0);
  await inspector().getByRole('button', { name: /^定位数值来源：/ }).click(); await expect(card(absolute.id)).toHaveClass(/selected/);
  const linkCount = graph(saved).links.length; await connect(near, clamp, 'value'); saved = await save(); assert.equal(graph(saved).links.length, linkCount);
  checks.push('Numeric results connect and expose locatable sources; boolean-to-number connections cannot replace valid authored wires.');
  phase = 'domain diagnostics'; await select(clamp); await inspector().getByLabel('最小值', { exact: true }).fill('3'); saved = await save();
  assert.ok(compileProject(saved).diagnostics.some(issue => issue.nodeId === clamp.id && issue.severity === 'error'));
  await expect(inspector().getByText('最小值不能大于最大值。', { exact: true })).toBeVisible();
  await inspector().getByLabel('最大值', { exact: true }).fill('10'); saved = await save(); assert.deepEqual(compileProject(saved).diagnostics.filter(issue => issue.severity === 'error'), []);
  checks.push('Invalid bounds remain authored and diagnosable; repairing the actual value removes the error.');
  phase = 'copy and reopen'; await select(round); await inspector().getByRole('button', { name: '复制选中节点', exact: true }).click(); saved = await save();
  const copy = graph(saved).nodes.find(node => node.type === 'round' && node.id !== round.id)!; assert.ok(copy); assert.equal(copy.properties.mode, 'floor');
  await inspector().getByRole('button', { name: '删除选中节点', exact: true }).click(); await save(); await page.getByRole('button', { name: '撤销', exact: true }).click(); saved = await save();
  const expected = graph(saved); await close(); await launch(); await openGraph(); assert.deepEqual(graph(await read()), expected);
  checks.push('Copies have independent stable identities; delete/undo and save/reopen preserve pins, values, mode and links.');
  phase = 'page draft'; await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByLabel('界面编辑模式').getByRole('button', { name: '设计', exact: true }).click(); await page.getByLabel('设计页面', { exact: true }).selectOption(pageResource.id);
  await page.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click(); await page.getByLabel('当前页面事件图', { exact: true }).selectOption(pageGraph.id);
  const beforePage = graph(await read(), pageGraph.id); await add('lerp', '插值'); assert.deepEqual(graph(await read(), pageGraph.id), beforePage);
  saved = await save(true); assert.ok(graph(saved, pageGraph.id).nodes.some(node => node.type === 'lerp'));
  await page.screenshot({ path: path.join(output, 'numeric-page-draft.png') });
  await fs.writeFile(path.join(output, 'authored-project.json'), JSON.stringify(saved, null, 2));
  checks.push('The same numeric nodes work in the page-event workspace and remain isolated in its draft until Save UI.');
  assert.deepEqual(errors, []); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); report.phase = phase; await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); console.error(error); process.exitCode = 1; }
finally {
  try { await close(); await server?.close(); const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); assert.deepEqual(cleanup.errors, []); }
  catch (error) { report.status = 'failed'; report.cleanupError = String(error); process.exitCode = 1; }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
}
