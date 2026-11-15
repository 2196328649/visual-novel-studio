import assert from 'node:assert/strict';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createBlueprintDebugFixture } from './lib/blueprint-debug-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { saveProject } from '../src/desktop/project-store';
import { addGameFlowStep } from '../src/core/game-flow-graph';
import { projectSchema } from '../src/core/model';
import type { RuntimeEvent } from '../src/core/bridge';

declare global { interface Window { __debugEvents: RuntimeEvent[] } }
if (process.env.VNS_INSTALLED_EXE) throw new Error('This acceptance must use an isolated development editor, never the installed application.');
const root = path.resolve('.'), output = path.resolve('artifacts/blueprint-debug-editor', new Date().toISOString().replaceAll(':', '-'));
const f = createBlueprintDebugFixture(); addGameFlowStep(f.project, 'beforeTitle', { kind: 'blueprint', graphId: f.rootGraph.id });
const projectFile = path.join(output, 'project/project.vns.json'); await fs.mkdir(path.dirname(projectFile), { recursive: true }); await saveProject(projectFile, f.project);
const before = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/work/**', '**/resources/**', '**/release/**'] } } }); await server.listen();
const devUrl = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch';
const errors: string[] = [], checks: string[] = [], processes: { pid?: number; exited: boolean }[] = [], report: Record<string, unknown> = { status: 'running', checks, errors, processes };
const debug = () => page!.getByRole('region', { name: '原生蓝图调试', exact: true });
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile'), devUrl, sdkRoot: process.env.VNS_RENPY_SDK ?? 'E:/Tools/renpy-8.5.3-sdk' });
  page = await app.firstWindow(); page.setDefaultTimeout(25000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(f.project.name, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await page.evaluate(() => { window.__debugEvents = []; window.studio!.onRuntimeEvent(event => window.__debugEvents.push(event)); });
}
async function stop() { if (page) await page.evaluate(async () => { await window.studio!.controlPreview?.('stop'); }); }
async function close() {
  if (!app) return; await stop(); const child = app.process(); await app.close(); app = undefined;
  let exited = child.exitCode !== null || child.signalCode !== null; if (!exited && child.pid) { try { process.kill(child.pid, 0); } catch { exited = true; } }
  processes.push({ pid: child.pid, exited }); assert.equal(exited, true);
}
async function paused(name: string) { await expect(debug()).toHaveAttribute('data-debug-phase', 'paused'); await expect(debug().locator('.blueprint-debug-site')).toContainText(name); await expect(debug().getByRole('button', { name: '步过', exact: true })).toBeEnabled(); }
try {
  await launch(); phase = 'enable and configure'; await page!.keyboard.press('F5');
  await expect(page!.getByRole('region', { name: '实时试玩工作区' })).toHaveAttribute('data-preview-state', 'running', { timeout: 120000 });
  await page!.getByRole('button', { name: '蓝图调试', exact: true }).click(); await expect(debug()).toBeVisible();
  await debug().getByText('断点设置（0）', { exact: true }).click(); await debug().getByLabel('断点蓝图').selectOption(f.rootGraph.id); await debug().getByLabel('断点执行节点').selectOption(f.rootFirst.id); await debug().getByRole('button', { name: '切换断点', exact: true }).click();
  await expect(debug().getByText('断点设置（1）', { exact: true })).toBeVisible(); await expect(debug().getByText('等待游戏确认调试命令…', { exact: true })).toHaveCount(0);
  const savedPoints = await page!.evaluate(id => JSON.parse(localStorage.getItem('vns:preview-settings:' + id) ?? '{}').blueprintBreakpoints, f.project.id);
  assert.deepEqual(savedPoints, [{ graphId: f.rootGraph.id, nodeId: f.rootFirst.id }]); checks.push('Breakpoints are authored through UI and saved as local playtest settings, not project data.');
  phase = 'startup breakpoint'; await page!.getByRole('button', { name: '重新运行', exact: true }).click(); await paused(f.rootFirst.name);
  const firstSession = await page!.evaluate(() => window.__debugEvents.filter(event => event.kind === 'blueprintDebug' && event.blueprintDebug?.phase === 'paused').at(-1)?.sessionId); assert.ok(firstSession);
  assert.equal(await page!.locator('.dirty-dot').count(), 0); await page!.screenshot({ path: path.join(output, 'startup-breakpoint.png') });
  checks.push('A title-before-flow breakpoint makes the real playtest controllable, including before its first visual frame.');
  phase = 'single stepping'; await debug().getByRole('button', { name: '步过', exact: true }).click(); await paused(f.rootCall.name);
  await debug().getByRole('button', { name: '步入', exact: true }).click(); await paused(f.worker.nodes[0].name);
  const trace = debug().locator('[data-trace-kind="enter"][data-trace-graph="' + f.worker.id + '"]').last(); await trace.click();
  await expect(debug().locator('.blueprint-trace-stack > li')).toHaveCount(2);
  for (const [width, height] of [[1280, 800], [1024, 640], [900, 640]]) {
    await app!.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
    await expect(debug().getByRole('button', { name: '步入', exact: true })).toBeVisible();
    assert.ok(await page!.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    await page!.screenshot({ path: path.join(output, 'debug-' + width + 'x' + height + '.png') });
  }
  checks.push('Real nested calls expose the source call node; the trace/controls remain usable at 1280, 1024 and 900 widths.');
  phase = 'return navigation'; await debug().getByRole('button', { name: new RegExp('返回调用点') }).click();
  await expect(page!.locator('.react-flow__node.selected[data-id="' + f.rootCall.id + '"]')).toBeVisible();
  assert.equal(await page!.getByRole('region', { name: '实时试玩工作区' }).count(), 0); checks.push('Clicking the real call stack returns to the exact source graph and selected call node, without resuming the breakpoint.');
  await close(); phase = 'reopen'; await launch(); await page!.keyboard.press('F5'); await paused(f.rootFirst.name);
  const newSession = await page!.evaluate(() => window.__debugEvents.filter(event => event.kind === 'blueprintDebug' && event.blueprintDebug?.phase === 'paused').at(-1)?.sessionId); assert.notEqual(newSession, firstSession);
  const stale = await page!.evaluate(async sessionId => { try { await window.studio!.controlBlueprintDebug!({ sessionId, action: 'continue' }); return ''; } catch (error) { return String(error); } }, firstSession!); assert.match(stale, /会话/);
  await paused(f.rootFirst.name); checks.push('Reopening preserves local breakpoints but creates a fresh session; stale IPC cannot resume the new game.');
  phase = 'continue and disable'; await debug().getByRole('button', { name: '断点继续', exact: true }).click(); await expect(debug()).toHaveAttribute('data-debug-phase', 'running');
  await debug().getByLabel('下次运行启用').uncheck(); await page!.getByRole('button', { name: '重新运行', exact: true }).click();
  await expect(page!.getByRole('region', { name: '实时试玩工作区' })).toHaveAttribute('data-preview-state', 'running', { timeout: 120000 });
  await expect(debug().getByRole('button', { name: '暂停蓝图', exact: true })).toBeDisabled(); await expect(debug().getByText('本次未启用蓝图调试。', { exact: true })).toBeVisible();
  await stop(); assert.deepEqual(projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))), before); assert.deepEqual(errors, []);
  checks.push('Debugging can be disabled for the next real build; ordinary playback remains available and project data is unchanged.'); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.phase = phase; report.error = String(error); process.exitCode = 1; console.error(error); if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); }
finally {
  if (page) await fs.writeFile(path.join(output, 'runtime-events.json'), JSON.stringify(await page.evaluate(() => window.__debugEvents).catch(() => []), null, 2));
  await close().catch(error => { report.status = 'failed'; report.closeError = String(error); process.exitCode = 1; }); await server.close();
  const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); if (cleanup.errors.length) { report.status = 'failed'; report.cleanupErrors = cleanup.errors; process.exitCode = 1; }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
}
