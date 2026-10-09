import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, type Page } from '@playwright/test';
import { defaultAiConfig } from '../src/core/ai';
import { projectSchema } from '../src/core/model';
import { synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createUiVoicePreviewFixture, writeUiVoicePreviewAudio } from './lib/ui-voice-preview-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { showUiPreviewTestData } from './lib/ui-preview-window';

const root = path.resolve('.'), output = path.join(root, 'artifacts/ai-ui-preview-window', new Date().toISOString().replaceAll(':', '-'));
const profile = path.join(output, 'profile'), projectFile = path.join(output, 'project.vns.json');
await fs.mkdir(profile, { recursive: true });
const { project } = createUiVoicePreviewFixture(); project.name = 'AI 独立 UI 预览窗口验收';
project.ui.components.push({ id: 'window_text', kind: 'text', page: 'main', text: '当前页面原文', x: .08, y: .04, width: .6, height: .1, style: { fontSize: 40 } });
project.ui.instances = [{ id: 'child', name: '预览方案', components: [{ id: 'window_text', kind: 'text', page: 'main', text: '所选方案内容', x: .08, y: .04, width: .6, height: .1, style: { fontSize: 40 } }] }];
synchronizeBlueprintSignatures(project); await writeUiVoicePreviewAudio(output);
const original = JSON.stringify(projectSchema.parse(project)); await fs.writeFile(projectFile, original);
const serverErrors: string[] = []; let requests = 0;
const server = createServer(async (request, response) => {
 try {
  let raw = ''; for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw); requests++;
  assert.match(body.messages[0].content, /openUiPreview/); assert.match(body.messages[0].content, /closeUiPreview/);
  const result = body.messages[0].content.includes('规划器') ? { execute: true, message: '' }
   : { message: '按点击动作时的当前界面打开或关闭预览。', operations: [], editorCommands: ['openUiPreview', 'closeUiPreview', 'openUi', 'openAdvancedUi'] };
  response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }] }));
 } catch (error) { serverErrors.push(String(error)); response.statusCode = 500; response.end(String(error)); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
await fs.writeFile(path.join(profile, 'ai-settings.json'), JSON.stringify({ version: 1, config: { ...defaultAiConfig, baseUrl: 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/v1', model: 'local-mock', rememberKey: false } }));
const app = await launchDesktopFixture({ root, profile, projectFile }), page = await app.firstWindow(); page.setDefaultTimeout(12000);
const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); app.on('window', p => p.on('pageerror', error => errors.push(error.message)));
let assistant: Page | undefined, preview: Page | undefined;
const mode = (name: string) => page.getByLabel('界面编辑模式').getByRole('button', { name, exact: true });
const action = (name: string) => assistant!.getByRole('button', { name, exact: true });
const result = () => assistant!.locator('.ai-editor-commands').last().getByRole('status');
const frame = () => preview!.getByLabel('参数联动预演画面', { exact: true });
const open = async () => {
 const existing = app.windows().find(p => p.url().endsWith('#ui-preview'));
 const created = existing ? undefined : app.waitForEvent('window', { predicate: p => p !== page && p !== assistant });
 await action('打开 UI 预览窗口').click(); preview = existing ?? await created!;
 await expect(preview.getByLabel('UI 交互预览', { exact: true })).toBeVisible(); await expect(result()).toContainText('已显示');
};
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
 await page.locator('[data-workspace-tab="ui"]').click(); await mode('事件图').click();
 const created = app.waitForEvent('window'); await page.getByRole('button', { name: 'AI 助手', exact: true }).click(); assistant = await created;
 await assistant.getByLabel('发给 AI 的内容', { exact: true }).fill('提供打开与关闭当前UI预览窗口的操作，也提供设计和事件图入口。');
 await assistant.getByRole('button', { name: '发送', exact: true }).click(); await expect(action('打开 UI 预览窗口')).toBeVisible();
 assert.equal(app.windows().length, 2, '生成建议尚未操作窗口');
 await action('关闭 UI 预览窗口').click(); await expect(result()).toContainText('尚未打开');
 await mode('设计').click(); await page.locator('[data-hierarchy-id="window_text"]').click();
 await page.getByLabel('文字', { exact: true }).fill('AI 使用未保存的界面修改'); await mode('事件图').click();
 await open(); await expect(frame()).toContainText('AI 使用未保存的界面修改'); await expect(mode('事件图')).toHaveAttribute('aria-pressed', 'true');
 assert.equal((await preview!.evaluate(() => window.studio!.getUiPreviewContext!()))!.pageId, 'ui:main');
 await preview!.getByLabel('按时间预演', { exact: true }).check(); await preview!.getByRole('button', { name: '播放计时', exact: true }).click();
 await expect.poll(async () => Number((await preview!.getByLabel('预演时间').textContent())?.split(' ')[0])).toBeGreaterThan(.2);
 const clock = Number((await preview!.getByLabel('预演时间').textContent())?.split(' ')[0]); await open();
 await expect(preview!.getByRole('button', { name: '暂停计时', exact: true })).toBeVisible();
 await expect.poll(async () => Number((await preview!.getByLabel('预演时间').textContent())?.split(' ')[0])).toBeGreaterThan(clock); assert.equal(app.windows().length, 3);
 await preview!.getByRole('button', { name: '暂停计时', exact: true }).click();
 await mode('设计').click(); await page.getByLabel('选择界面实例').selectOption('child'); await open(); await expect(frame()).toContainText('所选方案内容');
 assert.equal((await preview!.evaluate(() => window.studio!.getUiPreviewContext!()))!.project.ui.activeInstanceId, 'child');
 await mode('事件图').click(); await page.getByLabel('事件图页面').selectOption('waiting_page');
 const leave = page.getByRole('dialog', { name: '保存界面修改', exact: true }); await expect(leave).toBeVisible();
 await action('打开 UI 预览窗口').click(); await expect(result()).toContainText('处理主编辑器中已打开的保存提示');
 await leave.getByRole('button', { name: '取消', exact: true }).click(); await expect(frame()).toContainText('所选方案内容');
 await page.getByLabel('事件图页面').selectOption('waiting_page'); await leave.getByRole('button', { name: '不保存', exact: true }).click(); await open();
 await expect(preview!.getByLabel('当前预演页面')).toHaveText('等待页面');
 await page.getByLabel('事件图页面').selectOption('ui:main'); await mode('设计').click(); await page.locator('[data-hierarchy-id="window_text"]').click(); await page.getByLabel('文字', { exact: true }).fill('AI 使用未保存的界面修改'); await mode('事件图').click();
 await expect(frame()).toContainText('AI 使用未保存的界面修改'); await frame().getByRole('button', { name: '打开语音收藏', exact: true }).click();
 await showUiPreviewTestData(preview!); await preview!.getByText('语音测试数据', { exact: true }).click(); await preview!.getByRole('button', { name: '收藏全部语音', exact: true }).click();
 await frame().locator('[data-voice-control="play:voice_0"]').click();
 await expect.poll(() => preview!.getByLabel('语音预演播放器').evaluate((audio: HTMLAudioElement) => !audio.paused && audio.currentTime > .01)).toBe(true);
 await page.screenshot({ path: path.join(output, 'blueprint.png') }); await preview!.screenshot({ path: path.join(output, 'preview.png') });
 await action('关闭 UI 预览窗口').click(); await expect(result()).toContainText('已关闭'); await expect.poll(() => app.windows().length).toBe(2); assert.ok(preview!.isClosed());
 await expect(page.getByRole('button', { name: '预览窗口', exact: true })).toHaveAttribute('aria-pressed', 'false');
 await expect(page.getByRole('button', { name: '保存界面', exact: true })).toBeEnabled(); assert.equal(await fs.readFile(projectFile, 'utf8'), original);
 await open(); await expect(preview!.getByLabel('当前预演页面')).toHaveText('标题');
 await preview!.getByRole('button', { name: '关闭预览', exact: true }).click(); await expect.poll(() => app.windows().length).toBe(2);
 await action('关闭 UI 预览窗口').click(); await expect(result()).toContainText('尚未打开');
 await app.evaluate(({ BrowserWindow }) => {
  const original = BrowserWindow.prototype.loadFile;
  (globalThis as any).__restoreUiPreviewLoad = () => { BrowserWindow.prototype.loadFile = original; };
  BrowserWindow.prototype.loadFile = function(file, options) { return options?.hash === 'ui-preview' ? Promise.reject(new Error('专项模拟窗口加载失败')) : original.call(this, file, options); };
 });
 await action('打开 UI 预览窗口').click(); await expect(result()).toContainText('专项模拟窗口加载失败'); await expect(page.getByRole('alert')).toContainText('专项模拟窗口加载失败'); assert.equal(app.windows().length, 2);
 await app.evaluate(() => (globalThis as any).__restoreUiPreviewLoad()); await open(); await expect(page.getByRole('alert')).toHaveCount(0);
 await action('关闭 UI 预览窗口').click(); await expect.poll(() => app.windows().length).toBe(2);
 await page.getByLabel('事件图页面').selectOption('waiting_page'); await leave.getByRole('button', { name: '不保存', exact: true }).click(); await mode('设计').click();
 while (await page.getByRole('button', { name: '删除自定义页面', exact: true }).isEnabled()) await page.getByRole('button', { name: '删除自定义页面', exact: true }).click();
 await expect(page.getByRole('button', { name: '预览窗口', exact: true })).toBeDisabled();
 await action('打开 UI 预览窗口').click(); await expect(result()).toContainText('没有可预览'); assert.equal(app.windows().length, 2);
 await page.reload(); await expect(page.locator('.project-title strong')).toHaveText(project.name);
 const reopenedAssistant = app.waitForEvent('window'); await page.getByRole('button', { name: 'AI 助手', exact: true }).click(); assistant = await reopenedAssistant;
 await assistant.getByLabel('发给 AI 的内容', { exact: true }).fill('提供打开与关闭当前UI预览窗口的操作，也提供设计和事件图入口。'); await assistant.getByRole('button', { name: '发送', exact: true }).click(); await expect(action('打开 UI 预览窗口')).toBeVisible();
 await action('打开 UI 预览窗口').click(); await expect(result()).toContainText('先打开要预览'); assert.equal(app.windows().length, 2);
 await action('打开高级界面编辑').click(); await expect(mode('事件图')).toHaveAttribute('aria-pressed', 'true');
 await app.evaluate(({ BrowserWindow }) => {
  const original = BrowserWindow.prototype.loadFile; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  (globalThis as any).__finishUiPreviewLoad = () => { BrowserWindow.prototype.loadFile = original; release(); };
  BrowserWindow.prototype.loadFile = async function(file, options) { await original.call(this, file, options); if (options?.hash === 'ui-preview') await gate; };
 });
 const delayed = app.waitForEvent('window', { predicate: p => p !== page && p !== assistant }); await action('打开 UI 预览窗口').click(); preview = await delayed;
 await expect(preview.getByLabel('UI 交互预览')).toBeVisible(); await page.locator('[data-workspace-tab="script"]').click(); await expect.poll(() => app.windows().length).toBe(2);
 await app.evaluate(() => (globalThis as any).__finishUiPreviewLoad()); await expect(result()).toContainText('预览操作已取消');
 await action('关闭 UI 预览窗口').click(); await expect(result()).toContainText('尚未打开');
 await assistant.screenshot({ path: path.join(output, 'assistant-results.png') });
 assert.equal(await fs.readFile(projectFile, 'utf8'), original); assert.deepEqual(errors, []); assert.deepEqual(serverErrors, []);
 await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', compiledBuild: true, externalApiCalled: false, requests,
  checks: ['生成建议不执行，AI动作经真实独立助手与主编辑器返回结果', '当前页面、方案和未保存UI草稿，无隐式保存', '重复打开不新增窗口或重置计时', '设计/事件图与自定义页面切换同步，已有保存提示不被绕过', '真实WAV试听及AI关闭销毁播放器和窗口', '手动关闭后AI关闭返回取消，重开重置测试会话', '窗口加载失败返回失败，恢复后正常打开', '无页面或不在UI返回取消', '打开期间离开UI，清理窗口并返回取消', '工程磁盘和玩家资料保持隔离'], errors }, null, 2));
} catch (error) { await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: String(error), errors, serverErrors }, null, 2)); await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); await assistant?.screenshot({ path: path.join(output, 'failure-assistant.png') }).catch(() => undefined); throw error; }
finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined); await app.close(); server.closeAllConnections(); server.close(); console.log(output); }
