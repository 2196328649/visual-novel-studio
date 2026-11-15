import { openUiPageOptions } from './lib/ui-design-controls';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium, expect, type Browser, type Page } from '@playwright/test';
import { preview as serveBuild } from 'vite';
import { createBlueprintTraceFixture } from './lib/blueprint-trace-fixture';
import { projectSchema } from '../src/core/model';

const output = path.resolve('artifacts/blueprint-trace-browser', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const f = createBlueprintTraceFixture(); f.project.id += '_browser_' + Date.now();
const server = await serveBuild({ preview: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
const address = server.httpServer.address(); if (!address || typeof address !== 'object') throw Error('No server address.');
const url = 'http://127.0.0.1:' + address.port;
let browser: Browser | undefined, editor: Page | undefined, preview: Page | undefined, phase = 'launch', failure: string | undefined, closed = false;
const errors: string[] = [], checks: string[] = [];
const record = (message: string) => { checks.push(message); console.log('PASS ' + checks.length + ': ' + message); };
const panel = () => preview!.getByLabel('蓝图执行轨迹', { exact: true });
async function enterPage() {
 await editor!.locator('[data-workspace-tab="ui"]').click();
 await editor!.getByLabel('界面编辑模式').getByRole('button', { name: '设计', exact: true }).click();
 await editor!.getByLabel('设计页面', { exact: true }).selectOption(f.root.id);
 await editor!.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click(); await editor!.getByLabel('当前页面事件图').selectOption(f.rootGraph.id);
}
async function openPreview() {
 const opened = editor!.waitForEvent('popup'); await editor!.getByRole('button', { name: '预览窗口', exact: true }).click(); preview = await opened;
 preview.setDefaultTimeout(15000); await expect(preview.getByLabel('UI 交互预览', { exact: true })).toBeVisible();
 await preview.getByLabel('按时间预演', { exact: true }).check();
 await preview.locator('[data-preview-component="' + f.observe.id + '"]').click(); await preview.getByRole('button', { name: /^执行轨迹 ·/ }).click();
}
try {
 browser = await chromium.launch({ channel: 'msedge', headless: true }); const context = await browser.newContext({ viewport: { width: 1440, height: 920 } });
 context.on('page', page => page.on('pageerror', error => errors.push(error.message))); editor = await context.newPage(); editor.setDefaultTimeout(18000);
 await editor.addInitScript(project => { if (location.protocol === 'http:') localStorage.setItem('visual-novel-studio-browser-project', JSON.stringify(project)); }, projectSchema.parse(f.project));
 await editor.goto(url); await expect(editor.locator('.project-title strong')).toHaveText(f.project.name); await enterPage(); await openPreview();
 phase = 'same origin navigation'; await panel().getByLabel('轨迹类型').selectOption('events'); await panel().locator('[data-trace-kind="node"][data-trace-node="' + f.primary.call.id + '"]').click();
 await panel().getByRole('button', { name: '定位节点', exact: true }).click(); await expect(editor.locator('.react-flow__node[data-id="' + f.primary.call.id + '"]')).toHaveClass(/selected/);
 await expect(panel().locator('footer').getByRole('status')).toContainText('已定位');
 await panel().getByRole('button', { name: '定位触发控件', exact: true }).click(); await expect(editor.locator('[data-component-id="' + f.observe.id + '"]')).toHaveClass(/selected/);
 await expect(editor.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled();
 record('生产构建的浏览器弹窗通过同源消息完成节点/控件定位并收到结果，不制造界面草稿。');

 phase = 'sender and project checks';
 const peerOpened = editor.waitForEvent('popup'); await editor.evaluate(url => { window.open(url + '#ui-preview', 'trace-spoof-peer'); }, url); const peer = await peerOpened; await peer.waitForLoadState('domcontentloaded');
 await peer.evaluate(({ projectId, pageId }) => window.opener.postMessage({ kind: 'studio:ui-preview-action', requestId: 'spoof', action: { kind: 'locate', projectId, pageId } }, location.origin), { projectId: f.project.id, pageId: f.child.id });
 // A browser task turn after the message has been delivered, not an arbitrary execution pause.
 await editor.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
 await expect(editor.getByLabel('设计页面')).toHaveValue(f.root.id); await peer.close();
 // Keep the browser-only listener out of tsx's function-name instrumentation.
 const foreign = await preview!.evaluate<{ status: string; message: string }>(`new Promise((resolve, reject) => {
  const requestId = 'foreign-project-check', opener = window.opener;
  const timer = setTimeout(() => { window.removeEventListener('message', listener); reject(Error('No checked response.')); }, 5000);
  function listener(event) { if (event.source === opener && event.origin === location.origin && event.data?.kind === 'studio:ui-preview-action-result' && event.data.requestId === requestId) { clearTimeout(timer); window.removeEventListener('message', listener); resolve(event.data.result); } }
  window.addEventListener('message', listener); opener.postMessage({ kind: 'studio:ui-preview-action', requestId, action: { kind: 'play', projectId: 'foreign-project' } }, location.origin);
 })`);
 expect(foreign.status).toBe('failed'); expect(foreign.message).toContain('工程已切换'); await expect(editor.locator('.play-workspace')).toHaveCount(0);
 record('同源但非所属弹窗的消息被忽略；所属弹窗的跨工程请求收到明确失败，不触发试玩。');

 phase = 'dirty cancel and closing request';
 await openUiPageOptions(editor); await editor.getByLabel('自定义页面名称').fill('浏览器草稿仍应保留');
 await editor.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click();
 await expect(preview!.getByLabel('预览起点')).toContainText('浏览器草稿仍应保留');
 await panel().getByLabel('轨迹类型').selectOption('writes'); await panel().locator('[data-trace-kind="write"][data-trace-node="' + f.writes[0].id + '"]').click();
 await panel().getByRole('button', { name: '定位节点', exact: true }).click();
 const leave = editor.getByRole('dialog', { name: '保存界面修改', exact: true }); await leave.getByRole('button', { name: '取消', exact: true }).click();
 await expect(panel().locator('footer').getByRole('status')).toContainText('已取消'); await expect(editor.getByRole('button', { name: '保存界面', exact: true })).toBeEnabled();
 await panel().getByRole('button', { name: '定位节点', exact: true }).click(); await expect(leave).toBeVisible();
 await preview!.getByRole('button', { name: '关闭预览', exact: true }).click(); await expect.poll(() => preview!.isClosed()).toBe(true);
 await leave.getByRole('button', { name: '不保存', exact: true }).click(); await expect(editor.getByLabel('当前页面事件图')).toHaveValue(f.rootGraph.id);
 await expect(editor.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled();
 record('浏览器定位同样等待草稿决定；取消保留草稿，关闭弹窗后即使再处理提示也不会执行旧的延迟跳转。');

 phase = 'reload and narrow source navigation'; await openPreview(); await preview!.reload(); await expect(preview!.getByLabel('UI 交互预览')).toBeVisible();
 await preview!.getByLabel('按时间预演').check(); await preview!.locator('[data-preview-component="' + f.observe.id + '"]').click(); await preview!.getByRole('button', { name: /^执行轨迹 ·/ }).click();
 await preview!.setViewportSize({ width: 640, height: 480 }); await panel().getByLabel('轨迹类型').selectOption('writes'); await panel().locator('[data-trace-kind="write"][data-trace-node="' + f.writes[1].id + '"]').click();
 await expect(panel().locator('[data-trace-value] pre')).toHaveText('false'); await expect(panel().getByRole('button', { name: '返回画面', exact: true })).toBeInViewport();
 await preview!.screenshot({ path: path.join(output, 'browser-trace-640.png') });
 await panel().getByRole('button', { name: '定位节点', exact: true }).click(); await expect(editor.getByLabel('演出目标')).toHaveValue('graph:' + f.values.id); await expect.poll(() => preview!.isClosed()).toBe(true);
 record('弹窗重载后重新连接；640×480 详情可读并可定位源模块，离开页面自动关闭弹窗。');
 expect(errors).toEqual([]);
} catch (error) {
 failure = error instanceof Error ? error.stack ?? error.message : String(error);
 await editor?.screenshot({ path: path.join(output, 'failure-editor.png') }).catch(() => undefined); if (preview && !preview.isClosed()) await preview.screenshot({ path: path.join(output, 'failure-preview.png') }).catch(() => undefined);
} finally {
 await browser?.close(); closed = !!browser; await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
 await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: failure ? 'failed' : 'passed', phase, renderer: 'dist', browser: 'Edge headless, isolated context', checks, errors, browserClosed: closed, failure }, null, 2));
 console.log(output); if (failure) { console.error(failure); process.exitCode = 1; }
}
