import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { aiLines, defaultAiConfig } from '../src/core/ai';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { openStoryMode } from './lib/story-workspace';

// The coordinator runs this only after the complete source change is frozen
// and built. This file never builds, calls a live provider or opens user work.
if (process.env.VNS_INSTALLED_EXE || process.env.VNS_TEST_ROOT || process.env.VNS_LIVE_AI_TOKEN_FILE) throw new Error('UX 验收仅允许隔离源码桌面版。');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(path.resolve(process.cwd()).toLowerCase(), root.toLowerCase());
const roundRoot = path.join(root, 'artifacts/ai-assistant-ux-2026-11-15');
const inside = (parent: string, child: string) => { const relative = path.relative(parent, child); return !!relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
const artifactRoot = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? path.join(roundRoot, 'desktop'));
assert.ok(artifactRoot.toLowerCase() === roundRoot.toLowerCase() || inside(roundRoot, artifactRoot));
const output = path.join(artifactRoot, 'ux-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const projectDir = path.join(output, 'project'), inputs = path.join(output, 'inputs'), screenshots = path.join(output, 'screenshots'), evidence = path.join(output, 'evidence');
const healthyProfile = path.join(output, 'profile-healthy'), recoveryProfile = path.join(output, 'profile-recovery');
const projectFile = path.join(projectDir, 'project.vns.json');
const attachmentFile = path.join(inputs, '这是一个用于检查窄窗口显示的较长人物设定文件名.txt');
const referenceDirectory = path.join(inputs, '参考资料目录');
const fakeKey = 'isolated-ux-review-key', lineId = 'ux_first_line', originalText = '雨停了，我们回家吧。', changedText = '天晴了，我们回家吧。';
const project = createProject('AI助手界面精简隔离验收'); project.id = 'ux_review_' + randomUUID().slice(0, 8);
const firstPassage = project.nodes.find(node => node.kind === 'passage')!;
firstPassage.lines = [{ id: lineId, speakerId: 'ux_actor', text: originalText, actions: [] }];
project.characters = [{ id: 'ux_actor', name: '验收角色', color: '#88aacc', expressions: [] }];
const corruptBytes = Buffer.from('\uFEFF{\r\n  "version": 1, "config": { "model": "保留这段坏配置原文" },\r\n  "unknown": "备份应保留尾部空白"\r\n}\r\n  ', 'utf8');
interface Body { model: string; stream?: boolean; messages: { role: string; content: string }[] }
type DelayedProvider = 'models' | 'test';
interface Gate {
  requests: number; resets: number; models: number; tests: number; saves: number; cancels: number; cancelResponses: number; modelResponses: number; testResponses: number; assistantCloses: number; closeSaves: number;
  nextOpenFiles: string[]; nextSaveFile?: string; renameFailures: number; failConfigReplace: boolean;
  holdAbortKind?: DelayedProvider; heldAbortKind?: DelayedProvider; abortRelease?: () => void;
  holdSave: boolean; heldSave: boolean; saveRelease?: () => void; events: { name: string; at: number }[]; restore: () => void; blocked: string[];
}
const backupFile = /^ai-settings\.json\.before-reset-[a-f0-9-]{36}\.bak$/i;
const checks: { name: string; durationMs: number }[] = [], pageErrors: string[] = [], mockErrors: string[] = [], processes: { pid?: number; exited: boolean }[] = [];
const calls: { model: string; kind: string; question: string }[] = [];
const providerHolds: { kind: DelayedProvider; arrivedAt: number; closedAt?: number; response?: ServerResponse }[] = [], heldResponses = new Set<ServerResponse>();
const report: Record<string, any> = { status: 'running', output, checks, pageErrors, mockErrors, processes, calls, providerHolds, renderer: 'dist', externalApiCalled: false,
  desktopCoverageLimits: ['跨工程切换、主窗口模型/测试/重置关闭、助手保存/重置期间关闭以及进程崩溃不是本专项的桌面矩阵。', '请求取消只验证本地兼容服务，不能推断所有真实服务商行为。'],
  limits: ['仅本轮合成工程、文字参考和独立 profile。', '模型服务为 127.0.0.1；配置、会话、方案工具、文件导出与重置通过真实产品 IPC。', '产品使用 Electron net.fetch；其透传包装、Electron session 与 Node fetch 均只放行本轮 localhost，响应来自真实本地 HTTP 服务。', '取消用例仅延迟本轮精确模型/测试URL实际net.fetch抛出的abort错误；save关闭用例只延迟本轮真实IPC入口，结果仍由真实实现产生。', '仅配置替换失败使用本轮精确目标 fs.rename 故障夹具；备份、保存和重置处理器继续使用真实实现。'] };
let app: ElectronApplication | undefined, editor: Page | undefined, assistant: Page | undefined, activeProfile = '', apiRoot = '', prepared = false, trace = false, launchNumber = 0, failure: unknown;
let modelsStatus = 200, failNextChat = false, holdNextProvider: DelayedProvider | undefined;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const persist = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const jsonReply = (response: ServerResponse, content: unknown) => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: 'stop' }], usage: { prompt_tokens: 80, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } } })); };
const tool = (id: string, name: string, args: object, taskIds: string[] = []) => ({ id, name, arguments: args, taskIds });
const holdProviderResponse = (kind: DelayedProvider, response: ServerResponse) => {
  if (holdNextProvider !== kind) return false;
  holdNextProvider = undefined; const entry = { kind, arrivedAt: Date.now() } as typeof providerHolds[number]; Object.defineProperty(entry, 'response', { value: response, enumerable: false }); providerHolds.push(entry); heldResponses.add(response);
  response.on('close', () => { entry.closedAt = Date.now(); heldResponses.delete(response); }); return true;
};
const mock = createServer(async (request, response) => {
  try {
    assert.equal(request.headers.authorization, 'Bearer ' + fakeKey);
    if (request.method === 'GET' && request.url === '/v1/models') { if (holdProviderResponse('models', response)) return; response.writeHead(modelsStatus, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(modelsStatus === 200 ? { data: [{ id: 'ux-model-b' }, { id: 'ux-model-a' }, { id: 'ux-model-a' }] } : { error: { message: 'UX 本地模型列表不可用' } })); return; }
    assert.equal(request.method, 'POST'); assert.equal(request.url, '/v1/chat/completions');
    let raw = ''; for await (const chunk of request) raw += chunk; assert.ok(!raw.includes(fakeKey)); const body = JSON.parse(raw) as Body;
    assert.ok(['ux-model-a', 'ux-model-b'].includes(body.model));
    const chat = body.messages[0].content.includes('当前为聊天模式');
    const question = chat ? [...body.messages].reverse().find(item => item.role === 'user' && !item.content.startsWith('以下JSON') && !item.content.startsWith('本次用户选择的参考附件'))!.content
      : body.messages.find(item => item.content.startsWith('用户请求：'))?.content.split('\n以下JSON')[0].slice('用户请求：'.length) ?? '';
    calls.push({ model: body.model, kind: chat ? 'chat' : question ? 'agent' : 'test', question });
    if (chat) {
      if (question === 'UX参考聊天') assert.ok(body.messages.some(item => item.content.includes('主角带着一把蓝色纸伞。')));
      if (failNextChat) { failNextChat = false; response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'UX 本地失败，仍可重试。' } })); return; }
      if (!body.stream) { jsonReply(response, '**回复**\n\n已经收到你的故事。'); return; }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '正在整理故事。' } }] }) + '\n\n');
      response.end('data: ' + JSON.stringify({ choices: [{ delta: { content: '\n\n**建议**\n- 保留人物动机\n```text\n示例对白\n```' }, finish_reason: 'stop' }] }) + '\n\ndata: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 80, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } } }) + '\n\ndata: [DONE]\n\n'); return;
    }
    if (!question) { if (holdProviderResponse('test', response)) return; jsonReply(response, '连接成功。'); return; }
    assert.equal(question, 'UX方案：改第一句对白，预留无立绘角色演出，另有一项待确认');
    const last = body.messages.at(-1)!.content;
    const results: { id: string; ok: boolean; data: any }[] = last.startsWith('以下为工具执行结果') ? JSON.parse(last.slice(last.indexOf('\n') + 1)) : [];
    for (const result of results) assert.equal(result.ok, true, JSON.stringify(result));
    if (!results.length) { jsonReply(response, { tasks: [{ id: 'line', title: '改第一句对白' }, { id: 'portrait', title: '预留发言角色演出' }, { id: 'pending', title: '另一项需作者确认' }], tools: [tool('read', 'readProject', { kind: 'project', path: ['nodes', { id: firstPassage.id }, 'lines', { id: lineId }] }, ['line'])] }); return; }
    if (results.at(-1)!.id === 'read') { assert.equal(results[0].data.value.text, originalText); jsonReply(response, { tools: [tool('edit', 'editProject', { operations: [{ kind: 'replaceText', lineId, text: changedText }] }, ['line']), tool('portrait', 'addSpeakerPortraits', {}, ['portrait'])] }); return; }
    if (results.at(-1)!.id === 'portrait') { jsonReply(response, { tools: [tool('check', 'checkProject', { checks: [{ path: ['nodes', { id: firstPassage.id }, 'lines', { id: lineId }, 'text'], value: changedText }] }, ['line']), tool('review', 'reviewChanges', {})] }); return; }
    assert.equal(results.at(-1)!.id, 'review'); assert.equal(results.find(item => item.id === 'check')!.data.passed, true); assert.ok(results.at(-1)!.data.warnings.some((warning: string) => warning.includes('尚无立绘')));
    jsonReply(response, { finish: { message: '对白和预留演出已准备；角色尚无立绘，另一项请作者确认。', tasks: [{ id: 'line', status: 'complete', evidence: ['check'] }, { id: 'portrait', status: 'incomplete', evidence: ['portrait'], detail: '已预留演出，角色尚无立绘。' }, { id: 'pending', status: 'incomplete', evidence: [], detail: '尚未获得作者确认，保留待确认事项。' }] } });
  } catch (error) { mockErrors.push(String(error)); if (!response.headersSent) response.writeHead(500); response.end('isolated UX mock failure'); }
});

async function prepare() {
  const workspace = await fs.realpath(root); let current = root;
  for (const part of path.relative(root, output).split(path.sep)) { current = path.join(current, part); const stat = await fs.lstat(current).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; }); if (current === output) assert.equal(stat, undefined); if (stat) assert.ok(stat.isDirectory() && !stat.isSymbolicLink()); else await fs.mkdir(current); assert.ok(inside(workspace, await fs.realpath(current))); }
  prepared = true; for (const folder of [projectDir, inputs, screenshots, evidence, healthyProfile, recoveryProfile, referenceDirectory]) await fs.mkdir(folder);
  await saveProject(projectFile, projectSchema.parse(project)); await fs.writeFile(attachmentFile, '主角带着一把蓝色纸伞。'); await fs.writeFile(path.join(referenceDirectory, '第二份参考.txt'), '目录参考数据。');
  await fs.writeFile(path.join(recoveryProfile, 'ai-settings.json'), corruptBytes); await fs.writeFile(path.join(evidence, 'corrupt-original.bin'), corruptBytes);
  await fs.copyFile(projectFile, path.join(evidence, 'input-project.json')); report.inputHash = digest(await fs.readFile(projectFile)); report.corruptHash = digest(corruptBytes);
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening'); apiRoot = `http://127.0.0.1:${(mock.address() as { port: number }).port}/v1`;
}
async function check(name: string, work: () => Promise<void>) { report.phase = name; const start = Date.now(); await work(); checks.push({ name, durationMs: Date.now() - start }); await persist(); console.log('通过：' + name); }
async function capture(name: string) { if (editor && !editor.isClosed()) await editor.screenshot({ path: path.join(screenshots, name + '-editor.png') }); if (assistant && !assistant.isClosed()) await assistant.screenshot({ path: path.join(screenshots, name + '-assistant.png') }); }
async function launch(profile: string) {
  activeProfile = profile; app = await launchDesktopFixture({ root, profile, projectFile, confirmClose: true }); launchNumber++; const child = app.process(); processes.push({ pid: child.pid, exited: false });
  await app.evaluate('globalThis.__name = value => value'); editor = await app.firstWindow(); editor.setDefaultTimeout(15000); editor.on('pageerror', error => pageErrors.push(error.message)); await editor.evaluate('globalThis.__name = value => value');
  await expect(editor.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 }); assert.equal(path.resolve(fileURLToPath(editor.url())), path.join(root, 'dist/index.html')); await openStoryMode(editor, 'script');
  await editor.context().tracing.start({ screenshots: true, snapshots: true, sources: false }); trace = true;
  await app.evaluate(({ ipcMain, dialog, session, net }, options) => {
    const handlers = (ipcMain as any)._invokeHandlers as Map<string, (...args: any[]) => any>, originals = new Map<string, (...args: any[]) => any>();
    const open = dialog.showOpenDialog, save = dialog.showSaveDialog, fetch = globalThis.fetch, netFetch = net.fetch;
    const state = (globalThis as any).__uxGate = { requests: 0, resets: 0, models: 0, tests: 0, saves: 0, cancels: 0, cancelResponses: 0, modelResponses: 0, testResponses: 0, assistantCloses: 0, closeSaves: 0, nextOpenFiles: [], renameFailures: 0, failConfigReplace: false, holdSave: false, heldSave: false, events: [], blocked: [], restore: () => {} } as Gate;
    for (const channel of ['studio:ai-request', 'studio:ai-config-save', 'studio:ai-models', 'studio:ai-test', 'studio:ai-config-reset', 'studio:ai-cancel', 'studio:ai-window-close', 'studio:close-save']) {
      const original = handlers.get(channel); if (!original) throw Error('缺少真实 IPC：' + channel); originals.set(channel, original); ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (...args: any[]) => {
        state.events.push({ name: channel + ':enter', at: Date.now() });
        if (channel === 'studio:ai-request') state.requests++; if (channel === 'studio:ai-config-reset') state.resets++; if (channel === 'studio:ai-models') state.models++; if (channel === 'studio:ai-test') state.tests++; if (channel === 'studio:ai-cancel') state.cancels++; if (channel === 'studio:ai-window-close') state.assistantCloses++; if (channel === 'studio:close-save') state.closeSaves++;
        if (channel === 'studio:ai-config-save') {
          state.saves++; if (args[1].baseUrl !== options.apiRoot) throw Error('禁止保存外部 AI 地址。');
          if (state.holdSave) { state.holdSave = false; state.heldSave = true; await new Promise<void>(resolve => { state.saveRelease = resolve; }); state.heldSave = false; }
        }
        try { return await original(...args); }
        finally { if (channel === 'studio:ai-cancel') state.cancelResponses++; if (channel === 'studio:ai-models') state.modelResponses++; if (channel === 'studio:ai-test') state.testResponses++; state.events.push({ name: channel + ':exit', at: Date.now() }); }
      });
    }
    (dialog as any).showOpenDialog = async () => { const files = state.nextOpenFiles; state.nextOpenFiles = []; if (!files.length || !files.every(file => file.startsWith(options.output + options.separator))) throw Error('未登记本轮打开目标。'); return { canceled: false, filePaths: files }; };
    (dialog as any).showSaveDialog = async () => { const file = state.nextSaveFile; state.nextSaveFile = undefined; if (!file?.startsWith(options.output + options.separator)) throw Error('未登记本轮导出目标。'); return { canceled: false, filePath: file }; };
    (globalThis as any).fetch = async (input: any, init: any) => {
      const url = new URL(typeof input === 'object' && input !== null && 'url' in input ? input.url : String(input)); if (url.origin !== new URL(options.apiRoot).origin) { state.blocked.push(url.href); throw Error('禁止本轮源桌面请求外部地址。'); }
      return fetch.call(globalThis, input, init);
    };
    (net as any).fetch = async (input: any, init: any) => {
      const url = new URL(typeof input === 'object' && input !== null && 'url' in input ? input.url : String(input)); if (url.origin !== new URL(options.apiRoot).origin) { state.blocked.push(url.href); throw Error('禁止本轮Electron net.fetch外部地址。'); }
      const kind = url.href === options.apiRoot + '/models' ? 'models' : url.href === options.apiRoot + '/chat/completions' && typeof init?.body === 'string' && JSON.parse(init.body).messages?.[0]?.content === '请只回复：连接成功。' ? 'test' : undefined;
      const delayAbort = !!kind && state.holdAbortKind === kind;
      try { return await netFetch.call(net, input, init); }
      catch (error) { if (delayAbort && init?.signal?.aborted) { state.holdAbortKind = undefined; state.heldAbortKind = kind; state.events.push({ name: kind + ':actual-abort', at: Date.now() }); await new Promise<void>(resolve => { state.abortRelease = resolve; }); state.heldAbortKind = undefined; } throw error; }
    };
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => { const allowed = new URL(details.url).origin === new URL(options.apiRoot).origin; if (!allowed) state.blocked.push(details.url); callback({ cancel: !allowed }); });
    state.restore = () => { state.abortRelease?.(); state.saveRelease?.(); for (const [channel, original] of originals) { ipcMain.removeHandler(channel); ipcMain.handle(channel, original); } dialog.showOpenDialog = open; dialog.showSaveDialog = save; globalThis.fetch = fetch; net.fetch = netFetch; session.defaultSession.webRequest.onBeforeRequest(null); (globalThis as any).__uxRestoreRename?.(); };
  }, { apiRoot, output, separator: path.sep });
  await openAssistant(); await resize(750);
}
async function openAssistant() {
  const opening = app!.waitForEvent('window'); await editor!.getByRole('button', { name: 'AI 助手', exact: true }).click(); assistant = await opening; assistant.setDefaultTimeout(15000); assistant.on('pageerror', error => pageErrors.push(error.message)); await assistant.evaluate('globalThis.__name = value => value');
  assert.equal(path.resolve(fileURLToPath(assistant.url().split('#')[0])), path.join(root, 'dist/index.html')); await expect(assistant.getByLabel('发给 AI 的内容', { exact: true })).toBeEnabled();
  await assistant.evaluate(() => { (globalThis as any).__uxConfigBroadcasts = 0; window.studio!.onAiConfig!(() => { (globalThis as any).__uxConfigBroadcasts++; }); });
}
const button = (name: string) => (name === 'AI 服务设置' ? assistant!.locator('.ai-assistant > header') : assistant!).getByRole('button', { name, exact: true });
const settings = () => assistant!.locator('.ai-settings');
const details = (page: Page, summary: string | RegExp) => page.locator('summary').filter({ hasText: summary }).locator('..');
async function gate(patch: Partial<Gate>) { await app!.evaluate((_electron, patch) => Object.assign((globalThis as any).__uxGate, patch), patch); }
async function gateCounts() { return app!.evaluate(() => { const state = (globalThis as any).__uxGate as Gate; return { requests: state.requests, resets: state.resets, models: state.models, tests: state.tests, saves: state.saves, cancels: state.cancels, cancelResponses: state.cancelResponses, modelResponses: state.modelResponses, testResponses: state.testResponses, assistantCloses: state.assistantCloses, closeSaves: state.closeSaves, heldAbortKind: state.heldAbortKind, heldSave: state.heldSave, renameFailures: state.renameFailures, events: state.events, blocked: state.blocked }; }); }
async function releaseGate(name: 'abortRelease' | 'saveRelease') { await app!.evaluate((_electron, name) => { const state = (globalThis as any).__uxGate as Gate; const release = state[name]; if (!release) throw Error('尚未进入本轮等待：' + name); state[name] = undefined; release(); }, name); }
async function mainSettings() { await editor!.getByRole('button', { name: '作品设置', exact: true }).click(); const dialog = editor!.getByRole('dialog', { name: '作品设置', exact: true }); await dialog.getByRole('button', { name: 'AI 服务', exact: true }).click(); await expect(dialog.getByLabel('AI 模型名称', { exact: true })).toBeEnabled(); return dialog; }
async function startDelayedProvider(kind: DelayedProvider, controls: Page | Locator = assistant!, delayAbort = true) {
  const index = providerHolds.length; holdNextProvider = kind; if (delayAbort) await gate({ holdAbortKind: kind }); await controls.getByRole('button', { name: kind === 'models' ? '获取模型列表' : '保存并测试连接', exact: true }).click();
  await expect.poll(() => providerHolds.length).toBe(index + 1); assert.equal(providerHolds[index].kind, kind); await expect(controls.getByRole('button', { name: '停止请求', exact: true })).toBeVisible(); return providerHolds[index];
}
async function rendererFrames(page: Page, frames: number) { await page.evaluate(async frames => { for (let index = 0; index < frames; index++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); }, frames); }
async function stopTrace() { if (trace && editor && !editor.isClosed()) { await editor.context().tracing.stop({ path: path.join(output, 'trace-' + launchNumber + '.zip') }); trace = false; } }
async function configBroadcasts() { return assistant!.evaluate(() => (globalThis as any).__uxConfigBroadcasts as number); }
async function settle() { await assistant!.evaluate(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }); }
async function currentConversation() { return assistant!.evaluate(async () => { const context = (await window.studio!.getAiContext!())!; const list = await window.studio!.listAiConversations!(context.project.id); return list.activeId ? window.studio!.readAiConversation!(context.project.id, list.activeId) : undefined; }); }
async function snapshot() { return assistant!.evaluate(async () => (await window.studio!.getAiContext!())!.project); }
async function complete() { await expect(button('停止生成')).toHaveCount(0, { timeout: 30000 }); await expect(assistant!.getByLabel('发给 AI 的内容', { exact: true })).toBeEnabled(); }
async function send(question: string, keyboard = false) { await assistant!.getByLabel('发给 AI 的内容', { exact: true }).fill(question); if (keyboard) await assistant!.getByLabel('发给 AI 的内容', { exact: true }).press('Control+Enter'); else await button('发送').click(); await complete(); }
async function openMenu(name: string) { await button(name).click(); return assistant!.getByRole('dialog', { name, exact: true }); }
async function closeAssistant() {
  const closingPage = assistant!;
  await button('关闭 AI 助手').click().catch(error => { if (!closingPage.isClosed()) throw error; });
  await expect.poll(() => closingPage.isClosed()).toBe(true);
}
async function resize(width: number) {
  // Windows display scaling can round setContentSize by a couple of pixels.
  // Calibrate against the renderer's real viewport; layout checks always use it.
  const attempts: { requestedContentWidth: number; nativeContentWidth: number; viewportWidth: number }[] = [];
  let requestedContentWidth = width;
  const setAndMeasure = async (requested: number) => {
    const nativeContentWidth = await app!.evaluate(({ BrowserWindow }, requested) => { const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#ai-assistant'))!; window.webContents.setBackgroundThrottling(false); window.setContentSize(requested, 850); return window.getContentSize()[0]; }, requested);
    await rendererFrames(assistant!, 4); return { requestedContentWidth: requested, nativeContentWidth, viewportWidth: await assistant!.evaluate(() => window.innerWidth) };
  };
  for (let attempt = 0; attempt < 8; attempt++) {
    const measured = await setAndMeasure(requestedContentWidth); attempts.push(measured);
    if (measured.viewportWidth === width) break;
    const corrected = requestedContentWidth + width - measured.viewportWidth;
    const candidates = [corrected, corrected - 1, corrected + 1, corrected - 2, corrected + 2];
    const next = candidates.find(candidate => candidate > 0 && !attempts.some(previous => previous.requestedContentWidth === candidate));
    if (next === undefined) break; requestedContentWidth = next;
  }
  const best = [...attempts].sort((left, right) => Math.abs(left.viewportWidth - width) - Math.abs(right.viewportWidth - width))[0];
  const last = attempts.at(-1)!; if (last.requestedContentWidth !== best.requestedContentWidth) attempts.push(await setAndMeasure(best.requestedContentWidth));
  const actual = attempts.at(-1)!;
  (report.resizeCalibration ??= []).push({ targetWidth: width, actualWidth: actual.viewportWidth, roundingDelta: actual.viewportWidth - width, attempts });
  assert.ok(Math.abs(actual.viewportWidth - width) <= 2, `窗口缩放取整超出容差：${JSON.stringify({ width, attempts })}`);
}
async function noOverflow(name: string, targets: Locator[] = []) {
  const metrics = await assistant!.evaluate(() => ({ width: innerWidth, height: innerHeight, documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), shellWidth: document.querySelector('.ai-assistant')!.scrollWidth }));
  assert.ok(metrics.documentWidth <= metrics.width + 1, JSON.stringify(metrics)); assert.ok(metrics.shellWidth <= metrics.width + 1, JSON.stringify(metrics));
  for (const target of targets) { await expect(target).toBeVisible(); const bounds = await target.boundingBox(); assert.ok(bounds && bounds.x >= -1 && bounds.x + bounds.width <= metrics.width + 1 && bounds.y >= -1 && bounds.y + bounds.height <= metrics.height + 1, name + ': ' + JSON.stringify(bounds)); }
  report[name] = metrics; await capture(name);
}
async function closeOwned() {
  if (!app) return; const owned = app, child = owned.process();
  await stopTrace();
  if (child.exitCode === null && child.signalCode === null) { await owned.evaluate(() => ((globalThis as any).__uxGate as Gate | undefined)?.restore()).catch(() => undefined); await owned.close(); }
  await expect.poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 15000 }).toBe(true); processes.find(item => item.pid === child.pid)!.exited = true; app = undefined; editor = undefined; assistant = undefined;
}
async function configureLocal() { await assistant!.getByLabel('AI API 地址', { exact: true }).fill(apiRoot); await assistant!.getByLabel('AI API 密钥', { exact: true }).fill(fakeKey); await assistant!.getByLabel('AI 模型名称', { exact: true }).fill('ux-model-a'); }
async function installRenameFailure() {
  const configFile = path.join(activeProfile, 'ai-settings.json');
  await app!.evaluate(async (_electron, configFile) => {
    const fileSystem = process.getBuiltinModule('fs'), filePath = process.getBuiltinModule('path'); const original = fileSystem.promises.rename;
    (fileSystem.promises as any).rename = async (source: string, destination: string) => { const state = (globalThis as any).__uxGate as Gate; if (state.failConfigReplace && filePath.resolve(destination).toLowerCase() === filePath.resolve(configFile).toLowerCase()) { state.renameFailures++; throw Object.assign(new Error('UX 配置替换失败夹具'), { code: 'EACCES' }); } return original(source, destination); };
    (globalThis as any).__uxRestoreRename = () => { fileSystem.promises.rename = original; };
  }, configFile);
}

try {
  await prepare(); await persist();
  await check('正常配置仅一个模型输入选择与默认折叠连接设置', async () => {
    await launch(healthyProfile); await button('AI 服务设置').click(); await expect(assistant!.getByLabel('AI API 地址', { exact: true })).toBeEnabled();
    await expect(assistant!.getByLabel('AI 模型名称', { exact: true })).toHaveCount(1); await expect(settings().locator('select[aria-label="可用模型"]')).toHaveCount(0);
    await expect(details(assistant!, '更多连接设置')).not.toHaveAttribute('open', ''); await expect(assistant!.getByLabel('请求超时（秒）', { exact: true })).not.toBeVisible(); await capture('simple-settings');
  });
  await check('未保存地址密钥获取模型、键盘选择及404后仍能手填保存', async () => {
    await configureLocal(); await button('获取模型列表').click(); const list = assistant!.getByRole('listbox', { name: '可用模型', exact: true });
    await button('选择可用模型').click(); await expect(list.getByRole('option')).toHaveText(['ux-model-a', 'ux-model-b']); assert.equal((await assistant!.evaluate(() => window.studio!.getAiConfig!())).model, '');
    const input = assistant!.getByLabel('AI 模型名称', { exact: true }); await input.focus(); await input.press('ArrowDown'); await input.press('Enter'); await expect(input).toHaveValue(/ux-model-[ab]/);
    await input.press('Escape'); modelsStatus = 404; await button('获取模型列表').click(); await expect(settings().getByRole('alert')).toContainText('404'); await input.fill('ux-model-b');
    await button('保存并测试连接').click(); await expect(settings().getByRole('status')).toContainText('连接成功，服务已返回有效回复。'); modelsStatus = 200;
  });
  await check('更多连接设置展开可保存且重新进入默认简洁', async () => {
    await assistant!.getByText('更多连接设置', { exact: true }).click(); await assistant!.getByLabel('请求超时（秒）', { exact: true }).fill('110'); await assistant!.getByLabel('请求超时（秒）', { exact: true }).press('Tab');
    await assistant!.getByLabel('回复格式', { exact: true }).selectOption('false'); await assistant!.getByRole('checkbox', { name: '聊天流式回复', exact: true }).check(); await assistant!.getByRole('checkbox', { name: '在本机安全保存密钥', exact: true }).uncheck();
    await button('保存 AI 配置').click(); await expect(settings().getByRole('status')).toContainText('AI 配置已保存'); const view = await assistant!.evaluate(() => window.studio!.getAiConfig!()); assert.equal(view.timeoutSeconds, 110); assert.equal(view.jsonMode, false); assert.equal(view.keyStorage, 'session');
    assert.ok(!(await fs.readFile(path.join(healthyProfile, 'ai-settings.json'), 'utf8')).includes(fakeKey)); await button('返回助手').click(); await button('AI 服务设置').click(); await expect(details(assistant!, '更多连接设置')).not.toHaveAttribute('open', ''); await button('返回助手').click();
  });
  await check('会话操作收纳且键盘展开关闭、重命名置顶导出和删取消', async () => {
    await assistant!.getByLabel('AI 对话模式', { exact: true }).selectOption('chat'); await send('UX第一条聊天');
    await expect(button('重命名会话')).not.toBeVisible(); await button('会话操作').focus(); await button('会话操作').press('Enter'); const menu = assistant!.getByRole('dialog', { name: '会话操作', exact: true }); await expect(menu).toBeVisible(); await assistant!.keyboard.press('Escape'); await expect(menu).not.toBeVisible();
    await openMenu('会话操作'); await button('重命名会话').click(); await assistant!.getByLabel('会话名称', { exact: true }).fill('UX较长会话名称用于窄窗口检查'); await button('保存名称').click(); await openMenu('会话操作'); await button('置顶会话').click();
    const markdown = path.join(evidence, 'conversation.md'); await gate({ nextSaveFile: markdown }); await openMenu('会话操作'); await button('导出会话 Markdown').click(); await expect(assistant!.getByRole('status')).toContainText('聊天记录已导出'); assert.ok((await fs.readFile(markdown, 'utf8')).includes('UX第一条聊天'));
    await expect.poll(async () => (await currentConversation())?.pinned).toBe(true); const id = (await currentConversation())!.id; await openMenu('会话操作'); await button('删除当前会话').click(); await assistant!.getByRole('alert').getByRole('button', { name: '取消', exact: true }).click(); assert.equal((await currentConversation())!.id, id);
  });
  await check('参考信息和附件菜单默认收纳并持续显示外部路径授权', async () => {
    await expect(assistant!.getByLabel('当前工程上下文', { exact: true })).not.toBeVisible(); const reference = await openMenu('参考信息'); await expect(reference.getByLabel('当前工程上下文', { exact: true })).toContainText(project.name); await reference.getByLabel('AI 处理范围', { exact: true }).selectOption('all'); await assistant!.keyboard.press('Escape');
    const before = calls.length; await openMenu('添加参考'); await gate({ nextOpenFiles: [attachmentFile] }); await button('添加文件').click(); await expect(assistant!.getByLabel('待发送的参考附件', { exact: true })).toContainText(path.basename(attachmentFile)); assert.equal(calls.length, before);
    const attachments = await openMenu('添加参考'); await attachments.getByRole('checkbox', { name: '允许访问项目外文件', exact: true }).check(); await assistant!.keyboard.press('Escape'); await expect(assistant!.getByText('路径访问已开启', { exact: true })).toBeVisible();
    await openMenu('添加参考'); await gate({ nextOpenFiles: [referenceDirectory] }); await button('引用目录').click(); await expect(assistant!.getByLabel('待发送的参考附件', { exact: true })).toContainText('参考资料目录'); await send('UX参考聊天', true);
  });
  await check('常用聊天键盘发送、失败重试与用量默认折叠', async () => {
    await expect(assistant!.locator('.ai-message.assistant').last().locator('pre code')).toContainText('示例对白'); const usage = details(assistant!, /^用量$/).last(); await expect(usage).not.toHaveAttribute('open', ''); await usage.locator('summary').click(); await expect(usage.locator('.ai-usage')).toContainText('缓存命中 0 token');
    failNextChat = true; await send('UX失败重试'); const reply = assistant!.locator('.ai-message.assistant').last(); await expect(reply).toContainText('UX 本地失败'); await expect(reply.getByRole('button', { name: '重试', exact: true })).toBeVisible(); await reply.getByRole('button', { name: '重试', exact: true }).click(); await complete(); await expect(reply).toContainText('示例对白');
    await reply.getByRole('button', { name: '消息操作', exact: true }).click(); await assistant!.getByRole('dialog', { name: '消息操作', exact: true }).getByRole('button', { name: '固定上下文', exact: true }).click(); await expect.poll(async () => (await currentConversation())?.messages.at(-1)?.pinned).toBe(true);
  });
  await check('真实工具方案折叠统计核对、警告未完成常显并可应用撤销', async () => {
    await assistant!.getByRole('button', { name: /移除附件/ }).first().click(); await assistant!.getByRole('button', { name: /移除附件/ }).first().click(); await openMenu('添加参考'); await assistant!.getByRole('checkbox', { name: '允许访问项目外文件', exact: true }).uncheck(); await assistant!.keyboard.press('Escape');
    await assistant!.getByLabel('AI 对话模式', { exact: true }).selectOption('edit'); await send('UX方案：改第一句对白，预留无立绘角色演出，另有一项待确认'); const proposal = assistant!.getByRole('region', { name: 'AI 创作方案', exact: true }).last();
    await expect(proposal.locator('.ai-workflow-warning').filter({ hasText: '尚无立绘' })).toBeVisible(); await expect(proposal.locator('[data-status="incomplete"]')).toHaveCount(2); await expect(proposal.locator('[data-status="incomplete"]').first()).toBeVisible(); await expect(proposal.getByText('另一项需作者确认', { exact: true })).toBeVisible(); await expect(details(assistant!, /^修改统计$/).last()).toHaveJSProperty('open', false); await expect(details(assistant!, /核对结果/).last()).toHaveJSProperty('open', false);
    await expect(details(assistant!, /^查看 \d+ 项剧情与演出安排$/).last()).toHaveJSProperty('open', false);
    assert.equal(aiLines(await snapshot())[0].line.text, originalText); await proposal.getByRole('button', { name: '应用已完成部分', exact: true }).click(); await expect(editor!.getByLabel('第1行对白', { exact: true })).toHaveValue(changedText); await expect(proposal).toContainText('已写入工程'); await editor!.getByRole('button', { name: '撤销', exact: true }).click(); await expect(editor!.getByLabel('第1行对白', { exact: true })).toHaveValue(originalText);
    await editor!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(editor!.locator('.dirty-dot')).toHaveCount(0); await capture('proposal-warnings');
  });
  await check('750和420宽度无横向溢出且菜单设置键盘可达', async () => {
    const before = calls.length; await openMenu('添加参考'); await gate({ nextOpenFiles: [attachmentFile] }); await button('添加文件').click(); await expect(assistant!.getByLabel('待发送的参考附件', { exact: true })).toContainText(path.basename(attachmentFile)); assert.equal(calls.length, before);
    await noOverflow('wide-750', [button('会话操作'), button('参考信息'), button('添加参考'), button('发送')]); await resize(420);
    if (await button('收起会话列表').isVisible()) await button('收起会话列表').click(); await expect(button('显示会话列表')).toBeVisible(); await noOverflow('narrow-420', [button('会话操作'), button('参考信息'), button('添加参考'), button('发送'), assistant!.getByLabel('AI 对话模式', { exact: true }), assistant!.getByLabel('待发送的参考附件', { exact: true })]);
    await button('会话操作').focus(); await button('会话操作').press('Enter'); await noOverflow('narrow-session-menu', [assistant!.getByRole('dialog', { name: '会话操作', exact: true })]); await assistant!.keyboard.press('Escape');
    await button('AI 服务设置').click(); await noOverflow('narrow-settings', [assistant!.getByLabel('AI 模型名称', { exact: true }), button('保存 AI 配置')]); await assistant!.getByText('更多连接设置', { exact: true }).click(); await noOverflow('narrow-more-settings'); await button('返回助手').click();
    assert.deepEqual((await gateCounts()).blocked, []);
  });
  await check('双窗口配置干净同步、未保存输入保护及操作失败刷新恢复状态', async () => {
    await resize(750); await button('AI 服务设置').click(); await expect(button('重新读取配置')).toBeVisible(); const main = await mainSettings(), mainAi = main.locator('.ai-settings'), input = assistant!.getByLabel('AI 模型名称', { exact: true });
    const initialModel = await input.inputValue(), otherModel = initialModel === 'ux-model-a' ? 'ux-model-b' : 'ux-model-a';
    await main.getByLabel('AI 模型名称', { exact: true }).fill(otherModel); await main.getByRole('button', { name: '保存 AI 配置', exact: true }).click(); await expect(mainAi.getByRole('status')).toContainText('AI 配置已保存'); await expect(input).toHaveValue(otherModel); await expect(settings().locator('.ai-config-conflict')).toHaveCount(0);
    const draftModel = 'ux-unsaved-draft'; await input.fill(draftModel); await assistant!.getByLabel('AI API 密钥', { exact: true }).fill('ux-unsaved-key-draft');
    await main.getByLabel('AI 模型名称', { exact: true }).fill(initialModel); await main.getByRole('button', { name: '保存 AI 配置', exact: true }).click(); await expect(mainAi.getByRole('status')).toContainText('AI 配置已保存'); await expect(settings().locator('.ai-config-conflict')).toContainText('配置已在其他窗口更新'); await expect(input).toHaveValue(draftModel); await expect(assistant!.getByLabel('AI API 密钥', { exact: true })).toHaveValue('ux-unsaved-key-draft');
    await expect(button('保存 AI 配置')).toBeDisabled(); await expect(button('保存并测试连接')).toBeDisabled(); await expect(button('获取模型列表')).toBeDisabled(); assert.equal((await assistant!.evaluate(() => window.studio!.getAiConfig!())).model, initialModel); await capture('config-dirty-preserved');
    await button('重新读取配置').click(); await expect(input).toHaveValue(initialModel); await expect(assistant!.getByLabel('AI API 密钥', { exact: true })).toHaveValue(''); await expect(settings().locator('.ai-config-conflict')).toHaveCount(0); await expect(button('保存 AI 配置')).toBeEnabled(); await expect(button('获取模型列表')).toBeEnabled();
    const goodConfig = await fs.readFile(path.join(healthyProfile, 'ai-settings.json')), counts = await gateCounts(), providerCount = calls.length; await fs.writeFile(path.join(healthyProfile, 'ai-settings.json'), corruptBytes);
    await button('获取模型列表').click(); await expect(settings().locator('.ai-config-recovery')).toContainText('配置文件损坏'); await expect(button('备份并重新配置')).toBeVisible(); await expect(button('保存 AI 配置')).toBeDisabled(); await expect(button('获取模型列表')).toBeDisabled(); assert.equal((await gateCounts()).models, counts.models + 1); assert.equal((await gateCounts()).requests, counts.requests); assert.equal(calls.length, providerCount); assert.deepEqual(await fs.readFile(path.join(healthyProfile, 'ai-settings.json')), corruptBytes); await capture('config-operation-error-refresh');
    await fs.writeFile(path.join(healthyProfile, 'ai-settings.json'), goodConfig); await button('重新读取配置').click(); await expect(input).toHaveValue(initialModel); await expect(settings().locator('.ai-config-recovery')).toHaveCount(0);
    await assistant!.getByLabel('AI API 密钥', { exact: true }).fill(fakeKey); await button('保存 AI 配置').click(); await expect(settings().getByRole('status')).toContainText('AI 配置已保存'); await expect(main.getByLabel('AI 模型名称', { exact: true })).toHaveValue(initialModel); await main.getByRole('button', { name: '完成', exact: true }).click(); await button('返回助手').click();
  });
  await check('主窗口模型请求不会被关闭空闲助手取消', async () => {
    const main = await mainSettings(), counts = await gateCounts(), held = await startDelayedProvider('models', main, false); await closeAssistant(); await rendererFrames(editor!, 5);
    const waiting = await gateCounts(); assert.equal(held.closedAt, undefined); assert.equal(waiting.cancels, counts.cancels); assert.equal(waiting.cancelResponses, counts.cancelResponses); assert.equal(waiting.modelResponses, counts.modelResponses); await expect(main.getByRole('button', { name: '停止请求', exact: true })).toBeEnabled();
    assert.ok(held.response && !held.response.destroyed); held.response.writeHead(200, { 'Content-Type': 'application/json' }); held.response.end(JSON.stringify({ data: [{ id: 'ux-model-b' }, { id: 'ux-model-a' }, { id: 'ux-model-a' }] })); await expect(main.locator('.ai-settings').getByRole('status')).toContainText('已获取 2 个模型'); await expect.poll(async () => (await gateCounts()).modelResponses).toBe(counts.modelResponses + 1); assert.equal((await gateCounts()).cancels, counts.cancels);
    await main.getByRole('button', { name: '选择可用模型', exact: true }).click(); await expect(main.getByRole('listbox', { name: '可用模型', exact: true }).getByRole('option')).toHaveText(['ux-model-a', 'ux-model-b']); await capture('main-models-owner-preserved'); await main.getByRole('button', { name: '完成', exact: true }).click(); await openAssistant(); await resize(750);
  });
  await check('模型列表和连接测试返回助手等待真实取消结束后才可发送', async () => {
    await expect(assistant!.getByLabel('待发送的参考附件', { exact: true })).toHaveCount(0); await assistant!.getByLabel('AI 对话模式', { exact: true }).selectOption('chat');
    for (const kind of ['models', 'test'] as const) {
      await button('AI 服务设置').click(); const counts = await gateCounts(), held = await startDelayedProvider(kind); await button('返回助手').click(); await expect(assistant!.getByLabel('发给 AI 的内容', { exact: true })).toBeVisible(); await expect.poll(async () => (await gateCounts()).heldAbortKind).toBe(kind); await expect.poll(() => !!held.closedAt).toBe(true);
      await expect(button('正在完成操作…')).toBeDisabled(); const prompt = 'UX设置返回后继续聊天-' + kind; await assistant!.getByLabel('发给 AI 的内容', { exact: true }).fill(prompt); await assistant!.getByLabel('发给 AI 的内容', { exact: true }).press('Control+Enter'); await rendererFrames(assistant!, 5);
      const waiting = await gateCounts(); assert.equal(waiting.requests, counts.requests); assert.equal(waiting.cancels, counts.cancels + 1); assert.equal(waiting.cancelResponses, counts.cancelResponses); assert.equal(kind === 'models' ? waiting.modelResponses : waiting.testResponses, kind === 'models' ? counts.modelResponses : counts.testResponses); await expect(assistant!.getByLabel('发给 AI 的内容', { exact: true })).toHaveValue(prompt); await capture('return-settings-wait-' + kind);
      await releaseGate('abortRelease'); await expect.poll(async () => (await gateCounts()).cancelResponses).toBe(counts.cancelResponses + 1); await expect(button('发送')).toBeEnabled(); await send(prompt, true); await expect(assistant!.locator('.ai-message.assistant').last()).toContainText('示例对白'); assert.equal((await gateCounts()).requests, counts.requests + 1);
    }
  });
  await check('设置模型和测试等待时关闭助手先完成真实取消再关闭', async () => {
    for (const kind of ['models', 'test'] as const) {
      await button('AI 服务设置').click(); const counts = await gateCounts(), held = await startDelayedProvider(kind), closingPage = assistant!; await button('关闭 AI 助手').click(); await expect.poll(async () => (await gateCounts()).heldAbortKind).toBe(kind); await expect.poll(() => !!held.closedAt).toBe(true); await rendererFrames(editor!, 5);
      assert.equal(closingPage.isClosed(), false); const waiting = await gateCounts(); assert.equal(waiting.assistantCloses, counts.assistantCloses); assert.equal(waiting.cancelResponses, counts.cancelResponses); assert.equal(waiting.cancels, counts.cancels + 1); assert.equal(waiting.requests, counts.requests); await expect(settings()).toBeVisible(); await expect(assistant!.locator('.ai-assistant')).toHaveAttribute('inert', ''); await capture('close-settings-wait-' + kind);
      await releaseGate('abortRelease'); await expect.poll(async () => (await gateCounts()).cancelResponses).toBe(counts.cancelResponses + 1); await expect.poll(() => closingPage.isClosed()).toBe(true); const after = await gateCounts(); assert.equal(after.assistantCloses, counts.assistantCloses + 1); assert.equal(kind === 'models' ? after.modelResponses : after.testResponses, (kind === 'models' ? counts.modelResponses : counts.testResponses) + 1); report['close-settings-' + kind] = after;
      await openAssistant(); await resize(750); await send('UX设置关闭后重开聊天-' + kind, true); await expect(assistant!.locator('.ai-message.assistant').last()).toContainText('示例对白');
    }
    assert.deepEqual((await gateCounts()).blocked, []); await closeOwned();
  });
  await check('坏配置重新读取不发网络且修正后可重新读取', async () => {
    await launch(recoveryProfile); await button('AI 服务设置').click(); await expect(button('重新读取配置')).toBeVisible(); const before = calls.length, counts = await gateCounts(); await button('重新读取配置').click(); await settle(); const invalid = await assistant!.evaluate(() => window.studio!.getAiConfig!()); assert.equal(invalid.loadIssue?.kind, 'corrupt'); assert.ok(invalid.loadIssue?.canReset); assert.deepEqual(await fs.readFile(path.join(recoveryProfile, 'ai-settings.json')), corruptBytes); assert.equal(calls.length, before); assert.deepEqual(await gateCounts(), counts);
    await fs.writeFile(path.join(recoveryProfile, 'ai-settings.json'), JSON.stringify({ version: 1, config: { ...defaultAiConfig, baseUrl: apiRoot, model: 'ux-model-a', rememberKey: false } })); await button('重新读取配置').click(); await expect(assistant!.getByLabel('AI API 地址', { exact: true })).toHaveValue(apiRoot); await expect(assistant!.getByLabel('AI 模型名称', { exact: true })).toBeEnabled();
    await fs.writeFile(path.join(recoveryProfile, 'ai-settings.json'), corruptBytes); await button('重新读取配置').click(); await expect(button('备份并重新配置')).toBeVisible(); await capture('corrupt-config');
  });
  await check('恢复确认取消及真实替换失败保留坏配置原字节', async () => {
    const counts = await gateCounts(), broadcasts = await configBroadcasts(); await button('备份并重新配置').click(); await expect(button('确认备份并重置')).toBeVisible(); await button('取消').click(); assert.equal((await gateCounts()).resets, counts.resets); assert.equal(await configBroadcasts(), broadcasts); assert.deepEqual(await fs.readFile(path.join(recoveryProfile, 'ai-settings.json')), corruptBytes); assert.deepEqual((await fs.readdir(recoveryProfile)).filter(file => backupFile.test(file)), []);
    await installRenameFailure(); await gate({ failConfigReplace: true }); await button('备份并重新配置').click(); await button('确认备份并重置').click(); await expect(settings().locator('p[role="alert"]')).toContainText('旧配置已备份，但重置未完成'); await expect.poll(async () => (await gateCounts()).renameFailures).toBeGreaterThan(0); assert.deepEqual(await fs.readFile(path.join(recoveryProfile, 'ai-settings.json')), corruptBytes); assert.equal((await assistant!.evaluate(() => window.studio!.getAiConfig!())).loadIssue?.kind, 'corrupt');
    assert.equal(await configBroadcasts(), broadcasts); assert.equal((await gateCounts()).resets, counts.resets + 1); const files = (await fs.readdir(recoveryProfile)).filter(file => backupFile.test(file)); assert.equal(files.length, 1); for (const file of files) { assert.deepEqual(await fs.readFile(path.join(recoveryProfile, file)), corruptBytes); await fs.copyFile(path.join(recoveryProfile, file), path.join(evidence, 'failed-reset-' + file)); } await gate({ failConfigReplace: false });
  });
  await check('备份原字节后成功重置且可重新配置继续聊天', async () => {
    const broadcasts = await configBroadcasts(); await button('重新读取配置').click(); await button('备份并重新配置').click(); await button('确认备份并重置').click(); await expect(settings().getByRole('status')).toContainText(/备份|重新配置|重置/); await expect.poll(configBroadcasts).toBe(broadcasts + 1);
    const reset = await assistant!.evaluate(() => window.studio!.getAiConfig!()); assert.equal(reset.loadIssue, undefined); assert.equal(reset.model, ''); assert.equal(reset.hasKey, false);
    const backups = (await fs.readdir(recoveryProfile)).filter(file => backupFile.test(file)); assert.equal(backups.length, 2); for (const file of backups) { assert.deepEqual(await fs.readFile(path.join(recoveryProfile, file)), corruptBytes); await fs.copyFile(path.join(recoveryProfile, file), path.join(evidence, 'reset-' + file)); } assert.ok(!(await fs.readdir(recoveryProfile)).some(file => file.endsWith('.tmp')));
    const status = await settings().getByRole('status').textContent(); assert.ok(backups.some(file => status!.includes(file))); assert.ok(!status!.includes(recoveryProfile)); assert.ok(!/[A-Za-z]:[\\/]/.test(status!)); report.backupNames = backups; await capture('reset-config-backup-name');
    await configureLocal(); await assistant!.getByText('更多连接设置', { exact: true }).click(); await assistant!.getByRole('checkbox', { name: '在本机安全保存密钥', exact: true }).uncheck(); await button('保存 AI 配置').click(); await expect(settings().getByRole('status')).toContainText('AI 配置已保存'); await button('返回助手').click(); await assistant!.getByLabel('AI 对话模式', { exact: true }).selectOption('chat'); await send('UX重置后继续聊天', true); await expect(assistant!.locator('.ai-message.assistant').last()).toContainText('示例对白');
    assert.deepEqual((await gateCounts()).blocked, []); assert.deepEqual(pageErrors, []); assert.deepEqual(mockErrors, []); await capture('recovered-config-chat');
  });
  await check('主窗口设置保存失败保持窗口、重试关闭等真实写入成功再退出', async () => {
    await closeAssistant(); const main = await mainSettings(), finalModel = 'ux-model-b'; await main.getByLabel('AI 模型名称', { exact: true }).fill(finalModel);
    const failedSource = await fs.readFile(path.join(recoveryProfile, 'ai-settings.json')), failedCounts = await gateCounts(), child = app!.process(); await gate({ failConfigReplace: true, holdSave: true }); await main.getByRole('button', { name: '保存 AI 配置', exact: true }).click(); await expect.poll(async () => (await gateCounts()).heldSave).toBe(true); await stopTrace();
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().endsWith('#ai-assistant'))!.close()); await expect(editor!.locator('.status-message')).toContainText('正在保存并关闭窗口'); await rendererFrames(editor!, 5); assert.equal(editor!.isClosed(), false); assert.equal((await gateCounts()).closeSaves, failedCounts.closeSaves); await releaseGate('saveRelease');
    await expect(editor!.locator('.status-message')).toContainText('未能关闭'); await expect(main.locator('.ai-settings p.ai-error')).toContainText('保存 AI 配置失败'); await expect(editor!.locator('.app-shell')).not.toHaveAttribute('inert', ''); await expect(main.getByRole('button', { name: '保存 AI 配置', exact: true })).toBeEnabled(); assert.equal(editor!.isClosed(), false); assert.equal(child.exitCode, null); assert.equal(child.signalCode, null); assert.equal((await gateCounts()).closeSaves, failedCounts.closeSaves + 1); assert.ok((await gateCounts()).renameFailures > failedCounts.renameFailures); assert.deepEqual(await fs.readFile(path.join(recoveryProfile, 'ai-settings.json')), failedSource); await expect(main.getByLabel('AI 模型名称', { exact: true })).toHaveValue(finalModel); await capture('main-settings-save-failed-close-retained'); report.mainSettingsFailedClose = await gateCounts(); await gate({ failConfigReplace: false });
    const closedEvidence = path.join(evidence, 'main-settings-close-events.json'); await app!.evaluate(({ BrowserWindow }, target) => { const fileSystem = process.getBuiltinModule('fs'); const main = BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().endsWith('#ai-assistant'))!; main.once('closed', () => { const state = (globalThis as any).__uxGate as Gate; fileSystem.writeFileSync(target, JSON.stringify({ closedAt: Date.now(), events: state.events, saves: state.saves, closeSaves: state.closeSaves, heldSave: state.heldSave, blocked: state.blocked }, null, 2)); }); }, closedEvidence);
    const before = await fs.readFile(path.join(recoveryProfile, 'ai-settings.json')), counts = await gateCounts(); await gate({ holdSave: true }); await main.getByRole('button', { name: '保存 AI 配置', exact: true }).click(); await expect.poll(async () => (await gateCounts()).heldSave).toBe(true); await expect(main.getByRole('button', { name: '正在保存…', exact: true })).toBeDisabled(); await stopTrace();
    const closingEditor = editor!; await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().endsWith('#ai-assistant'))!.close()); await expect(editor!.locator('.status-message')).toContainText('正在保存并关闭窗口'); await rendererFrames(editor!, 5);
    assert.equal(closingEditor.isClosed(), false); assert.equal(child.exitCode, null); assert.equal(child.signalCode, null); const waiting = await gateCounts(); assert.equal(waiting.heldSave, true); assert.equal(waiting.closeSaves, counts.closeSaves); assert.deepEqual(await fs.readFile(path.join(recoveryProfile, 'ai-settings.json')), before); await expect(editor!.locator('.app-shell')).toHaveAttribute('inert', ''); await capture('main-settings-save-close-wait');
    await releaseGate('saveRelease'); await expect.poll(() => closingEditor.isClosed()).toBe(true); await expect.poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 15000 }).toBe(true);
    const savedBytes = await fs.readFile(path.join(recoveryProfile, 'ai-settings.json')), saved = JSON.parse(savedBytes.toString('utf8')); assert.equal(saved.config.baseUrl, apiRoot); assert.equal(saved.config.model, finalModel); assert.ok(!savedBytes.includes(Buffer.from(fakeKey))); report.finalConfigHash = digest(savedBytes);
    const closed = JSON.parse(await fs.readFile(closedEvidence, 'utf8')) as { closedAt: number; events: { name: string; at: number }[]; saves: number; closeSaves: number; heldSave: boolean; blocked: string[] };
    const eventNames = closed.events.map(event => event.name), saveExit = eventNames.lastIndexOf('studio:ai-config-save:exit'), closeEnter = eventNames.lastIndexOf('studio:close-save:enter'); assert.ok(saveExit >= 0 && closeEnter > saveExit); assert.equal(closed.saves, counts.saves + 1); assert.equal(closed.closeSaves, counts.closeSaves + 1); assert.equal(closed.heldSave, false); assert.deepEqual(closed.blocked, []); report.mainSettingsClose = closed;
    processes.find(item => item.pid === child.pid)!.exited = true; app = undefined; editor = undefined; assistant = undefined; assert.equal(heldResponses.size, 0); assert.deepEqual(pageErrors, []); assert.deepEqual(mockErrors, []); report.status = 'passed';
  });
} catch (error) { failure = error; report.status = 'failed'; report.error = String(error); await capture('failure').catch(() => undefined); }
finally {
  try { await closeOwned(); } catch (error) { failure ??= error; report.status = 'failed'; report.closeError = String(error); }
  mock.closeAllConnections(); if (mock.listening) await new Promise<void>(resolve => mock.close(() => resolve()));
  if (prepared) { await persist(); if (!app && processes.every(item => item.exited)) { try { report.cleanup = await cleanVerificationDirectories(output, ['project', 'inputs', 'profile-healthy', 'profile-recovery']); assert.deepEqual(report.cleanup.errors, []); } catch (error) { failure ??= error; report.status = 'failed'; report.cleanupError = String(error); } } else report.cleanupSkipped = '自有进程尚未确认退出。'; await persist(); }
  console.log(output);
}
if (failure) { console.error(failure); process.exitCode = 1; }
