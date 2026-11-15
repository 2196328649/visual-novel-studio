import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { projectSchema } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';
import { createBlueprintContextMatrixFixture, type BlueprintContextMatrixCase } from './lib/blueprint-context-matrix-fixture';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Use the isolated development editor for the context matrix.');
const root = path.resolve('.'), output = path.resolve('artifacts/blueprint-context-matrix-editor', new Date().toISOString().replaceAll(':', '-'));
const f = createBlueprintContextMatrixFixture(), projectFile = path.join(output, 'project/project.vns.json');
await fs.mkdir(path.dirname(projectFile), { recursive: true });
let app: ElectronApplication | undefined, server: ViteDevServer | undefined, page: Page | undefined, exited = true, phase = 'prepare';
const report: { status: string; scope: string; expectedCases: number; cases: unknown[]; errors: string[]; error?: string } = {
  status: 'running', scope: 'All built-in pages with base, parent and derived ownership plus an authored page; actual resource, search, diagnostic, control-event and caller entry, draft undo/redo/save/reopen. Deliberate missing-control diagnostics are never executed.', expectedCases: f.cases.length, cases: [], errors: [],
};
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const node = (id: string) => page!.locator('.react-flow__node[data-id="' + id + '"]');
async function close() {
  if (!app) return; const processHandle = app.process(); await app.close(); app = undefined;
  exited = processHandle.exitCode !== null || processHandle.signalCode !== null;
  if (!exited && processHandle.pid) { try { process.kill(processHandle.pid, 0); } catch { exited = true; } }
  assert.equal(exited, true, 'The isolated editor must exit without a save prompt.');
}
async function launch() {
  const address = server!.httpServer!.address(); assert.ok(address && typeof address !== 'string');
  app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile, devUrl: 'http://127.0.0.1:' + address.port }); exited = false;
  page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => report.errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(f.project.name, { timeout: 60000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1700, 1000));
}
async function openResource(id: string, query = '') {
  await page!.locator('[data-workspace-tab="assets"]').click();
  const browser = page!.getByRole('region', { name: '资源管理器', exact: true });
  await browser.getByLabel('搜索资源和蓝图', { exact: true }).fill(query);
  await browser.locator('[data-content-key="blueprint:' + id + '"]').dblclick();
}
async function context(item: BlueprintContextMatrixCase, selectedId?: string) {
  await expect(page!.getByLabel('事件图页面', { exact: true })).toHaveValue(item.pageId);
  await expect(page!.getByLabel('当前页面事件图', { exact: true })).toHaveValue(item.graph.id);
  if (item.pageId.startsWith('ui:')) await expect(page!.getByLabel('选择界面实例', { exact: true })).toHaveValue(item.instanceId ?? '');
  if (selectedId) await expect(node(selectedId)).toHaveClass(/selected/);
}
async function view() {
  await page!.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  return { selected: (await page!.locator('.react-flow__node.selected').evaluateAll(elements => elements.map(element => element.getAttribute('data-id')))).sort(),
    transform: await page!.locator('.react-flow__viewport').evaluate(element => { const value = new DOMMatrix(getComputedStyle(element).transform); return [value.a, value.d, value.e, value.f]; }) };
}
try {
  await saveProject(projectFile, f.project);
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/work/**', '**/resources/**', '**/release/**'] } } }); await server.listen(); await launch();
  for (const item of f.cases) {
    phase = item.graph.id + ' / resource and event'; const before = await fs.readFile(projectFile, 'utf8');
    await openResource(item.graph.id); await context(item); await fitBlueprintCanvas(page!);
    await page!.locator('.ui-event-entry').filter({ hasText: item.event.name }).click(); await context(item, item.event.id);
    // Wait for the explicit event location's fit animation before recording it.
    await expect.poll(async () => { const a = await view(); await page!.waitForTimeout(80); return JSON.stringify(a) === JSON.stringify(await view()); }).toBe(true);
    const remembered = await view();
    phase = item.graph.id + ' / search and unmount'; await openResource(item.graph.id, item.graph.name); await context(item, item.event.id);
    await expect.poll(async () => { const actual = await view(); return JSON.stringify(actual.selected) === JSON.stringify(remembered.selected) && actual.transform.every((value, index) => Math.abs(value - remembered.transform[index]) < .5); }).toBe(true);
    assert.equal(await fs.readFile(projectFile, 'utf8'), before, 'Read-only entry must not write a draft or change the active game scheme.');
    phase = item.graph.id + ' / diagnostic'; await page!.locator('.status-bar > button').first().click();
    const diagnostic = page!.locator('.problems-panel .diagnostic-item[data-node-id="' + item.issue.id + '"] .diagnostic-main').first();
    await expect(diagnostic).toBeVisible(); await diagnostic.click(); await context(item, item.issue.id);
    await page!.getByRole('button', { name: '关闭问题面板', exact: true }).click();
    phase = item.graph.id + ' / call'; await openResource(f.caller.id, f.caller.name);
    await expect(page!.getByLabel('演出目标', { exact: true })).toHaveValue('graph:' + f.caller.id);
    await page!.locator('.blueprint-node-outline').getByRole('button', { name: item.call.name, exact: true }).click();
    await node(item.call.id).locator('.graph-node-title strong').dblclick(); await context(item);
    await page!.getByRole('button', { name: '返回调用位置', exact: true }).click(); await expect(node(item.call.id)).toHaveClass(/selected/);
    await node(item.call.id).locator('.graph-node-title strong').dblclick(); await context(item);
    phase = item.graph.id + ' / shared draft'; await page!.locator('.ui-event-entry').filter({ hasText: item.event.name }).click();
    const properties = page!.locator('.blueprint-properties');
    if (!await properties.isVisible()) await page!.getByRole('button', { name: '展开蓝图属性', exact: true }).click();
    await properties.getByRole('button', { name: '节点参数', exact: true }).click();
    const name = properties.getByLabel('节点名称', { exact: true }), savedName = item.event.name + ' · 已修改';
    await name.fill(savedName); await name.press('Tab'); await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeEnabled();
    await page!.getByRole('button', { name: '撤销', exact: true }).click(); await expect(name).toHaveValue(item.event.name);
    await page!.getByRole('button', { name: '重做', exact: true }).click(); await expect(name).toHaveValue(savedName);
    assert.equal(await fs.readFile(projectFile, 'utf8'), before);
    // Leaving via the resource dock must consult this same UI draft history.
    await page!.keyboard.press('Control+Space'); const dock = page!.locator('.content-dock'); await expect(dock).toBeVisible();
    await dock.getByLabel('搜索资源和蓝图', { exact: true }).fill(f.caller.name); await dock.locator('[data-content-key="blueprint:' + f.caller.id + '"]').dblclick();
    const leave = page!.getByRole('dialog', { name: '保存界面修改', exact: true }); await expect(leave).toBeVisible(); await leave.getByRole('button', { name: '取消', exact: true }).click();
    await context(item, item.event.id); await expect(name).toHaveValue(savedName);
    if (await dock.isVisible()) { await page!.keyboard.press('Control+Space'); await expect(dock).toHaveCount(0); }
    await page!.getByRole('button', { name: '保存界面', exact: true }).click(); await expect(page!.locator('.ui-save-status')).toHaveText('已保存'); await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled();
    const saved = await read(), graph = saved.blueprints.find(graph => graph.id === item.graph.id)!;
    assert.equal(graph.nodes.find(node => node.id === item.event.id)!.name, savedName); assert.deepEqual(graph.links, item.graph.links); assert.equal(graph.uiPageId, item.graph.uiPageId); assert.equal(graph.uiInstanceId, item.graph.uiInstanceId);
    assert.equal(saved.ui.activeInstanceId, 'context_other');
    await page!.screenshot({ path: path.join(output, item.graph.id + '.png') });
    report.cases.push({ pageId: item.pageId, instanceId: item.instanceId ?? 'base', graphId: item.graph.id, eventId: item.event.id, issueId: item.issue.id, callId: item.call.id, savedName });
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ ...report, phase }, null, 2));
  }
  phase = 'save and reopen'; const bytes = await fs.readFile(projectFile, 'utf8'); await close(); await launch();
  assert.equal(await fs.readFile(projectFile, 'utf8'), bytes);
  for (const item of f.cases) {
    await openResource(item.graph.id, item.graph.name); await context(item);
    await expect(node(item.event.id).locator('.graph-node-title strong')).toHaveText(item.event.name + ' · 已修改');
  }
  assert.equal(report.cases.length, report.expectedCases); assert.deepEqual(report.errors, []); report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = phase + ': ' + String(error); console.error(report.error); process.exitCode = 1;
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
} finally {
  try { await close(); } catch (error) { report.status = 'failed'; report.errors.push(String(error)); process.exitCode = 1; }
  await server?.close();
  if (exited) { const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); if (cleanup.errors.length) { report.status = 'failed'; report.errors.push(JSON.stringify(cleanup.errors)); process.exitCode = 1; } }
  else { report.status = 'failed'; report.errors.push('Live fixture process retained; cleanup refused.'); process.exitCode = 1; }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ ...report, phase }, null, 2)); console.log(output);
}