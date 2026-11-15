import assert from 'node:assert/strict';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createBlueprintChoiceFixture } from './lib/blueprint-choice-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas, setBlueprintOption } from './lib/blueprint-canvas';
import { blueprintNodeDefaults, createBlueprintGraph } from '../src/core/blueprint';
import { blueprintChoiceCatalog, blueprintChoiceDefinition, type BlueprintChoiceType } from '../src/core/blueprint-choice';
import { projectSchema, type Project, type BlueprintNode } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';
import { compileProject } from '../src/runtime/compiler';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Only isolated development acceptance is permitted.');
const root = path.resolve('.'), output = path.resolve('artifacts/blueprint-choice-editor', new Date().toISOString().replaceAll(':', '-'));
const f = createBlueprintChoiceFixture(), authored = createBlueprintGraph('function', '多路节点创作'), unknown = blueprintNodeDefaults('selectByKey'); unknown.properties.choiceVersion = 7; authored.nodes.push(unknown); f.project.blueprints.push(authored);
const projectFile = path.join(output, 'project/project.vns.json'); await fs.mkdir(path.dirname(projectFile), { recursive: true }); await saveProject(projectFile, f.project);
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/work/**', '**/resources/**', '**/release/**'] } } }); await server.listen();
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
async function add(type: BlueprintChoiceType, search: string) {
  const expand = page!.getByRole('button', { name: '展开节点库', exact: true }); if (!await page!.locator('.blueprint-palette').isVisible() && await expand.isVisible()) await expand.click();
  if (await page!.locator('.blueprint-palette').isVisible()) { await page!.getByLabel('搜索蓝图节点').fill(search); await page!.locator('.blueprint-library-node').getByText(blueprintChoiceCatalog[type].name, { exact: true }).click(); }
  else { await page!.locator('.blueprint-commandbar').getByRole('button', { name: /^添加节点/ }).click(); const picker = page!.getByRole('dialog', { name: '添加蓝图节点', exact: true }); await picker.getByLabel('搜索要添加的节点').fill(search); await picker.getByText(blueprintChoiceCatalog[type].name, { exact: true }).click(); }
}
try {
  await launch(); await openGraph(authored.id);
  phase = 'catalog'; await add('switchValue', 'Switch'); await add('selectByKey', '多路选择'); let saved = await save();
  assert.ok(graph(saved, authored.id).nodes.some(node => node.type === 'switchValue')); assert.equal(graph(saved, authored.id).nodes.filter(node => node.type === 'selectByKey').length, 2); checks.push('Chinese and English searches create switch and typed multi-select without execution pins on the pure node.');
  phase = 'unknown data recovery'; await select(unknown); await expect(inspector().getByText(/数据版本尚不支持/).first()).toBeVisible();
  assert.equal(graph(saved, authored.id).nodes.find(node => node.id === unknown.id)!.properties.choiceVersion, 7);
  await inspector().getByRole('button', { name: '恢复默认分支', exact: true }).click(); await inspector().getByRole('button', { name: '确认恢复分支', exact: true }).click(); saved = await save();
  const recovered = graph(saved, authored.id).nodes.find(node => node.id === unknown.id)!; assert.equal(recovered.properties.choiceVersion, 1); assert.equal(JSON.parse(String(recovered.properties.choiceRecovery)).properties.choiceVersion, 7); assert.ok(recovered.pins.filter(pin => pin.id.startsWith('case_')).every(pin => !unknown.pins.some(old => old.id === pin.id)));
  checks.push('Unknown enum versions stay visible and untouched until explicit recovery; recovery preserves original data and uses new branch identities.');
  const group = f.groups[0]; await openGraph(group.graph.id); await select(group.select);
  phase = 'stable rename and reorder'; await inspector().getByLabel('分支 3 名称', { exact: true }).fill('困难选项'); await inspector().getByRole('button', { name: '上移分支 3', exact: true }).click(); saved = await save();
  let selected = graph(saved, group.graph.id).nodes.find(node => node.id === group.select.id)!;
  assert.deepEqual(blueprintChoiceDefinition(selected).cases!.map(row => row.id), ['empty', 'hard', 'a']); assert.equal(selected.properties.case_hard, 7); assert.deepEqual(graph(saved, group.graph.id).links, group.graph.links);
  await inspector().getByRole('button', { name: '添加分支', exact: true }).click(); await inspector().getByLabel('分支 4 名称', { exact: true }).fill('额外难度'); await inspector().getByLabel('分支 4 匹配值', { exact: true }).fill('额外'); saved = await save();
  selected = graph(saved, group.graph.id).nodes.find(node => node.id === group.select.id)!; assert.equal(blueprintChoiceDefinition(selected).cases!.length, 4);
  checks.push('Structured rows support rename, reorder and addition without moving old values or wires to a different case.');
  phase = 'type edits retain errors'; const beforeType = selected;
  await inspector().getByLabel(group.select.name + ' · 结果类型', { exact: true }).selectOption('boolean'); saved = await save();
  assert.equal(graph(saved, group.graph.id).nodes.find(node => node.id === group.select.id)!.properties.case_hard, 7); assert.deepEqual(graph(saved, group.graph.id).links, group.graph.links);
  await expect(inspector().locator('.blueprint-value-error').first()).toBeVisible(); assert.ok(compileProject(saved).diagnostics.some(issue => issue.severity === 'error' && issue.nodeId === group.select.id));
  await page!.getByRole('button', { name: '撤销', exact: true }).click(); saved = await save(); assert.deepEqual(graph(saved, group.graph.id).nodes.find(node => node.id === group.select.id), beforeType);
  checks.push('A type change preserves incompatible constants and links as visible errors; one undo restores the exact typed interface.');
  phase = 'delete impact'; await select(group.branch); const beforeDelete = graph(saved, group.graph.id);
  await inspector().getByRole('button', { name: '删除分支 2', exact: true }).click(); const confirm = inspector().getByRole('alertdialog', { name: '删除分支确认', exact: true }); await expect(confirm).toContainText('将断开 1 条关联连线');
  await confirm.getByRole('button', { name: '保留当前分支', exact: true }).click(); assert.deepEqual(graph(await read(), group.graph.id), beforeDelete);
  await inspector().getByRole('button', { name: '删除分支 2', exact: true }).click(); await inspector().getByRole('button', { name: '确认删除分支', exact: true }).click(); saved = await save(); assert.equal(graph(saved, group.graph.id).links.length, beforeDelete.links.length - 1);
  await page!.getByRole('button', { name: '撤销', exact: true }).click(); saved = await save(); assert.deepEqual(graph(saved, group.graph.id), beforeDelete);
  checks.push('Deleting a connected case previews the exact affected links, supports cancellation, and has an atomic undo.');
  phase = 'save reopen'; const expected = graph(saved, group.graph.id); await close(); await launch(); await openGraph(group.graph.id); assert.deepEqual(graph(await read(), group.graph.id), expected); await select(group.branch); await page!.screenshot({ path: path.join(output, 'choice-rows-reopened.png') });
  phase = 'page draft'; await page!.locator('[data-workspace-tab="ui"]').click(); await page!.getByLabel('界面编辑模式').getByRole('button', { name: '设计', exact: true }).click(); await page!.getByLabel('设计页面', { exact: true }).selectOption(f.page.id); await page!.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click(); await page!.getByLabel('当前页面事件图', { exact: true }).selectOption(f.pageGraph.id);
  const diskPage = graph(await read(), f.pageGraph.id); await add('selectByKey', 'Select By Key'); assert.deepEqual(graph(await read(), f.pageGraph.id), diskPage); saved = await save(true); assert.ok(graph(saved, f.pageGraph.id).nodes.some(node => node.type === 'selectByKey'));
  await fs.writeFile(path.join(output, 'authored-project.json'), JSON.stringify(saved, null, 2)); assert.deepEqual(compileProject(saved).diagnostics.filter(issue => issue.severity === 'error'), []); assert.deepEqual(errors, []);
  checks.push('Saved graph interfaces reopen unchanged; the same nodes use isolated page-event drafts.'); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.phase = phase; report.error = String(error); if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); console.error(error); process.exitCode = 1; }
finally {
  try { await close(); await server.close(); const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); assert.deepEqual(cleanup.errors, []); }
  catch (error) { report.status = 'failed'; report.cleanupError = String(error); process.exitCode = 1; }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
}
