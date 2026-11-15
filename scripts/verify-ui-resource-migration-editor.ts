import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { loadProject, saveProject } from '../src/desktop/project-store';
import { createUiResourceMigrationFixture } from './lib/ui-resource-migration-fixture';
import { pageInterfacePng } from './lib/ui-page-interface-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Resource migration acceptance uses the current development build in isolation.');
const root = path.resolve('.'), output = path.resolve('artifacts/ui-resource-migration-editor', new Date().toISOString().replaceAll(':', '-'));
const source = path.join(output, 'source'), projectFile = path.join(source, 'project.vns.json');
const f = createUiResourceMigrationFixture();
let app: ElectronApplication | undefined, page: Page | undefined, server: ViteDevServer | undefined, phase = 'prepare';
const report: { status: string; checks: string[]; errors: string[]; error?: string; cleanup?: unknown } = { status: 'running', checks: [], errors: [] };
const read = async () => (await loadProject(projectFile)).project;
const region = () => page!.getByRole('region', { name: '资源管理器', exact: true });
async function browse(key: string, query: string) {
  await page!.locator('[data-workspace-tab="assets"]').click(); await region().getByLabel('资源显示范围', { exact: true }).selectOption('all'); await region().getByLabel('搜索资源和蓝图', { exact: true }).fill(query);
  return region().locator('[data-content-key="' + key + '"]');
}
async function rename(key: string, query: string, name: string) {
  const item = await browse(key, query); await item.click(); await page!.keyboard.press('F2');
  const dialog = page!.getByRole('dialog', { name: '重命名', exact: true }); await dialog.getByLabel('内容名称', { exact: true }).fill(name); await dialog.getByRole('button', { name: '确定', exact: true }).click();
  await expect(dialog).toHaveCount(0); await region().getByLabel('搜索资源和蓝图', { exact: true }).fill(name); await expect(region().locator('[data-content-key="' + key + '"]')).toContainText(name);
}
async function remove(key: string, query: string, blocked: boolean) {
  const item = await browse(key, query); await item.click(); await page!.keyboard.press('Delete');
  const dialog = page!.getByRole('alertdialog', { name: '删除资源', exact: true }); await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  if (blocked) { await expect(dialog.getByRole('alert')).toContainText('仍被'); await dialog.getByRole('button', { name: '取消', exact: true }).click(); await expect(item).toHaveCount(1); }
  else { await expect(dialog).toHaveCount(0); await expect(item).toHaveCount(0); }
}
async function launch() {
  const address = server!.httpServer!.address(); assert.ok(address && typeof address !== 'string');
  app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile, devUrl: 'http://127.0.0.1:' + address.port });
  page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => report.errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(f.project.name, { timeout: 60000 });
}
async function context(index: number) {
  const entry = f.cases[index]; const item = await browse('blueprint:' + entry.graph.id, entry.graph.name); await item.dblclick();
  await expect(page!.getByLabel('事件图页面', { exact: true })).toHaveValue('ui:preferences');
  await expect(page!.getByLabel('当前页面事件图', { exact: true })).toHaveValue(entry.graph.id);
  await expect(page!.getByLabel('选择界面实例', { exact: true })).toHaveValue(entry.instanceId ?? '');
}
try {
  await fs.mkdir(path.join(source, 'assets'), { recursive: true });
  for (const name of ['used.png', 'unused.png']) await fs.writeFile(path.join(source, 'assets', name), Buffer.from(pageInterfacePng, 'base64'));
  await saveProject(projectFile, f.project); await fs.writeFile(path.join(output, 'fixture.project.json'), JSON.stringify(f.project, null, 2));
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/work/**', '**/resources/**', '**/release/**'] } } }); await server.listen(); await launch();
  phase = 'legacy command delete guard'; await remove('blueprint:' + f.module.id, f.module.name, true); report.checks.push('Old-name-only sceneAction caller blocks deletion.');
  phase = 'resource rename'; await rename('asset:resource_used', '在用图片', '在用图片 · 新名称');
  await remove('asset:resource_used', '在用图片 · 新名称', true);
  await page!.getByRole('button', { name: '撤销', exact: true }).click(); await region().getByLabel('搜索资源和蓝图', { exact: true }).fill('在用图片'); await expect(region().locator('[data-content-key="asset:resource_used"]')).toContainText('在用图片');
  await page!.getByRole('button', { name: '重做', exact: true }).click(); await expect(region().locator('[data-content-key="asset:resource_used"]')).toContainText('在用图片 · 新名称');
  phase = 'unused delete undo redo'; await remove('asset:resource_unused', '可删除图片', false);
  await page!.getByRole('button', { name: '撤销', exact: true }).click(); await expect(region().locator('[data-content-key="asset:resource_unused"]')).toHaveCount(1);
  await page!.getByRole('button', { name: '重做', exact: true }).click(); await expect(region().locator('[data-content-key="asset:resource_unused"]')).toHaveCount(0);
  phase = 'module display rename'; await rename('blueprint:' + f.module.id, f.module.name, '模块新显示名');
  await page!.keyboard.press('Control+s'); await expect.poll(async () => (await read()).blueprints.find(graph => graph.id === f.module.id)!.name).toBe('模块新显示名');
  const resources = await read(); assert.deepEqual(resources.assets.map(asset => [asset.id, asset.name, asset.path]), [['resource_used', '在用图片 · 新名称', 'assets/used.png']]);
  assert.equal(resources.blueprints.find(graph => graph.id === f.module.id)!.callName, '稳定调用'); assert.deepEqual(resources.blueprints.find(graph => graph.id === f.module.id)!.exposedInputs, f.module.exposedInputs);
  assert.match(String(resources.blueprints.find(graph => graph.id === f.caller.id)!.nodes.find(node => node.type === 'sceneAction')!.properties.command), /稳定调用【resource_module】/);
  report.checks.push('Resource and module renaming preserves IDs, paths, old call alias and public pins; unused delete is one undoable edit.');
  for (const [index, entry] of f.cases.entries()) {
    phase = 'scheme draft ' + (entry.instanceId ?? 'base'); await context(index);
    await page!.locator('.ui-event-entry').filter({ hasText: entry.event.name }).click();
    const panel = page!.locator('.blueprint-properties'); if (!await panel.isVisible()) await page!.getByRole('button', { name: '展开蓝图属性', exact: true }).click();
    await panel.getByRole('button', { name: '节点参数', exact: true }).click(); const name = panel.getByLabel('节点名称', { exact: true }), changed = entry.event.name + ' · 草稿';
    await name.fill(changed); await name.press('Tab');
    await page!.getByRole('button', { name: '撤销', exact: true }).click(); await expect(name).toHaveValue(entry.event.name);
    await page!.getByRole('button', { name: '重做', exact: true }).click(); await expect(name).toHaveValue(changed);
    const before = await fs.readFile(projectFile, 'utf8');
    await page!.keyboard.press('Control+Space'); const dock = page!.locator('.content-dock'); await expect(dock).toBeVisible();
    await dock.getByLabel('搜索资源和蓝图', { exact: true }).fill(f.caller.name); await dock.locator('[data-content-key="blueprint:' + f.caller.id + '"]').dblclick();
    const leave = page!.getByRole('dialog', { name: '保存界面修改', exact: true }); await expect(leave).toBeVisible(); await leave.getByRole('button', { name: '取消', exact: true }).click();
    await expect(name).toHaveValue(changed); assert.equal(await fs.readFile(projectFile, 'utf8'), before);
    if (await dock.isVisible()) await page!.keyboard.press('Control+Space');
    await page!.getByRole('button', { name: '保存界面', exact: true }).click(); await expect(page!.locator('.ui-save-status')).toHaveText('已保存'); await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled();
    const saved = await read(), graph = saved.blueprints.find(graph => graph.id === entry.graph.id)!;
    assert.equal(graph.nodes.find(node => node.id === entry.event.id)!.name, changed); assert.deepEqual(graph.links, entry.graph.links); assert.deepEqual(graph.exposedInputs, entry.graph.exposedInputs);
    assert.equal(saved.assets[0].name, '在用图片 · 新名称'); assert.equal(graph.nodes.find(node => node.id === entry.set.id)!.properties.value, 'resource_used');
  }
  phase = 'reopen'; const final = await fs.readFile(projectFile); await app!.close(); app = undefined; await launch();
  assert.deepEqual(await fs.readFile(projectFile), final);
  for (let index = 0; index < f.cases.length; index++) await context(index);
  await page!.screenshot({ path: path.join(output, 'reopened.png') });
  assert.deepEqual(report.errors, []); report.checks.push('Base, parent and derived event drafts retain renamed asset references through undo/redo, cancelled navigation, save and reopen.'); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = phase + ': ' + String(error); console.error(error); process.exitCode = 1; if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); }
finally {
  const errors: string[] = [];
  if (app) { const child = app.process(); try { await app.close(); if (child.exitCode === null && child.signalCode === null) { try { process.kill(child.pid!, 0); errors.push('Editor process did not exit.'); } catch { /* process ended */ } } } catch (error) { errors.push(String(error)); } }
  if (server) try { await server.close(); } catch (error) { errors.push(String(error)); }
  try { const cleanup = await cleanVerificationDirectories(output, ['source', 'profile']); report.cleanup = cleanup; errors.push(...cleanup.errors.map(error => error.error)); } catch (error) { errors.push(String(error)); }
  if (errors.length) { report.status = 'failed'; report.errors.push(...errors); process.exitCode = 1; }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(path.join(output, 'report.json'));
}
