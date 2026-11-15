import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { createProject, projectSchema } from '../src/core/model';
import { aiLines, prepareAiChanges, type AiChange } from '../src/core/ai';
import type { AiConversation } from '../src/core/ai-conversations';
import { createBlueprintGraph, blueprintNodeDefaults } from '../src/core/blueprint';
import { addProjectGraphs } from '../src/core/project-resources';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { openStoryMode } from './lib/story-workspace';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';

// Pending acceptance. The coordinator runs this only after all source changes
// are frozen and the source desktop build is complete. No live provider,
// installed app, user project, historical report or build command is used.
if (process.env.VNS_INSTALLED_EXE || process.env.VNS_TEST_ROOT || process.env.VNS_LIVE_AI_TOKEN_FILE) {
  throw new Error('请清除 VNS_INSTALLED_EXE / VNS_TEST_ROOT / VNS_LIVE_AI_TOKEN_FILE，使用本轮隔离源码验收。');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(path.resolve(process.cwd()).toLowerCase(), root.toLowerCase(), '请从 editor 工作区运行。');
const roundRoot = path.join(root, 'artifacts/ai-assistant-ux-2026-11-15');
const artifactRoot = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? path.join(roundRoot, 'assistant-editor'));
const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return !!relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
assert.ok(artifactRoot.toLowerCase() === roundRoot.toLowerCase() || inside(roundRoot, artifactRoot), '产物必须属于本轮 AI 助手审查目录。');
const output = path.join(artifactRoot, `assistant-editor-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
const fixtureA = path.join(output, 'fixture-a'), fixtureB = path.join(output, 'fixture-b');
const profile = path.join(output, 'profile'), startupProfile = path.join(output, 'startup-profile'), inputs = path.join(output, 'inputs');
const evidence = path.join(output, 'evidence'), screenshots = path.join(output, 'screenshots');
const projectAFile = path.join(fixtureA, 'project.vns.json'), projectBFile = path.join(fixtureB, 'project.vns.json');
const attachmentFile = path.join(inputs, '人物 设定.txt');
const importFile = path.join(inputs, '验收保存导入.png');
const discoveryInputFile = path.join(inputs, '验收关闭延迟扫描.png');
const secret = 'isolated-ai-review-key';
const lineId = 'review_first_line', variableId = 'review_number', setId = 'review_parameters', componentId = 'review_caption';
const originalText = '雨停了，我们一起回家。';
const changedText = '天晴了，我们一起回家。';
const nextDraft = '这是主窗口关闭时尚未发送的下一条草稿。';
const projectA = createProject('AI助手隔离验收甲');
projectA.id = 'ai_review_a_' + randomUUID().slice(0, 8);
const passage = projectA.nodes.find(node => node.kind === 'passage')!;
passage.lines = [{ id: lineId, text: originalText, actions: [] }, { id: 'review_second_line', text: '这句保持原样。', actions: [] }];
projectA.parameterSets = [{ id: setId, name: '验收通用参数', kind: 'story', defaults: { persistent: false, resetWithSettings: false } }];
projectA.variables = [{ id: variableId, name: '验收计数', type: 'number', initial: 7, persistent: false, parameterSetId: setId, resetWithSettings: false }];
projectA.ui.components = [{ id: componentId, name: '验收文字控件', kind: 'text', page: 'main', text: '这是独立控件', x: .15, y: .15, width: .5, height: .15 }];
projectA.ui.pages = { main: { layout: 'custom' } };
const graph = createBlueprintGraph('function', '验收节点蓝图');
const readNode = blueprintNodeDefaults('getVariable', 1); readNode.name = '验收读取节点'; readNode.properties.variableId = variableId;
graph.nodes.push(readNode); addProjectGraphs(projectA, graph);
const projectB = createProject('AI助手隔离验收乙'); projectB.id = 'ai_review_b_' + randomUUID().slice(0, 8);

interface ProviderBody { model: string; stream?: boolean; stream_options?: { include_usage?: boolean }; messages: { role: string; content: string }[] }
interface NativeGate {
  requestCalls: { id: string; prompt: string; projectId: string }[];
  requestEvents: { kind: 'request-start' | 'request-settled' | 'cancel-start' | 'cancel-settled'; id: string; at: number }[];
  heldConfig: boolean; holdConfig: boolean; configRelease?: () => void;
  heldInspection: boolean; holdInspection: boolean; inspectionRelease?: () => void;
  configResponses: number; inspectionResponses: number;
  holdConversationId?: string; heldConversation: boolean; conversationRelease?: () => void;
  holdProjectSave: boolean; heldProjectSave: boolean; projectSaveRelease?: () => void;
  holdImport: boolean; heldImport: boolean; importRelease?: () => void;
  holdPreviewStop: boolean; heldPreviewStop: boolean; previewStopRelease?: () => void; previewStopResponses: number;
  holdDiscoveryName?: string; heldDiscovery: boolean; discoveryRelease?: () => void; discoveryResponses: number; heldDiscoveryAssetNames: string[];
  conversationCalls: { id: string; draft: string }[]; projectSaveCalls: number; importCalls: number;
  closeSaveInputs: { projectId?: string; allowed: boolean }[]; closeSaveResponses: number; closeSavePending: number;
  rejectConversationId?: string; conversationRejections: number;
  nextOpenFiles: string[]; nextSaveFile?: string; nextSaveCancelled?: boolean;
  saveDialogs: { title: string; canceled: boolean; file?: string }[];
  messageBoxes: { title: string; message: string }[];
  blockedUrls: string[]; restore: () => void;
}
interface ToolResult { id: string; name: string; ok: boolean; error?: string; data: any }
const checks: { name: string; durationMs: number }[] = [], errors: string[] = [], traces: string[] = [];
const processes: { pid?: number; exited: boolean; code?: number | null; signal?: string | null }[] = [];
const providerCalls: { model: string; stream: boolean; kind: string; question: string }[] = [];
const report: Record<string, any> = { status: 'running', output, checks, errors, traces, processes, providerCalls,
  externalApiCalled: false, renderer: 'dist', temporaryPaths: [fixtureA, fixtureB, profile, startupProfile, inputs],
  expectedChecks: 32,
  limits: ['仅本轮合成工程、文字附件和独立 Electron profile。', '模型回复、文件选择及少量 IPC 延迟使用本地夹具；保存、工具执行、窗口关闭和会话存储使用真实产品接口。', 'Electron 和 Node 请求均只放行本轮 localhost 地址；停止重发使用真实503响应和产品重试退避。', '不验真实模型理解质量、不生成游戏、不访问真实作品或历史产物。'] };
let app: ElectronApplication | undefined, editor: Page | undefined, assistant: Page | undefined;
let traceRunning = false, outputPrepared = false, launchNumber = 0, failure: unknown;
let modelStatus = 200, failChatOnce = false;
const heldStreams = new Set<ServerResponse>();
const cancelledStreams: string[] = [];
const persist = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const tools = (body: ProviderBody): ToolResult[] => {
  const last = body.messages.at(-1)!.content;
  if (!last.startsWith('以下为工具执行结果')) return [];
  return JSON.parse(last.slice(last.indexOf('\n') + 1));
};
const originalQuestion = (body: ProviderBody) => body.messages.find(message => message.role === 'user' && message.content.startsWith('用户请求：'))?.content.split('\n以下JSON')[0].slice('用户请求：'.length) ?? '';
const requestContext = (body: ProviderBody) => {
  const text = body.messages.find(message => message.role === 'user' && message.content.startsWith('用户请求：'))!.content;
  return JSON.parse(text.slice(text.indexOf('\n{') + 1));
};
const call = (id: string, name: string, args: object, taskIds: string[] = []) => ({ id, name, arguments: args, taskIds });
const jsonReply = (response: ServerResponse, content: unknown) => {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 0 } } }));
};
const mock = createServer(async (request, response) => {
  try {
    assert.equal(request.headers.authorization, 'Bearer ' + secret);
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(modelStatus, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(modelStatus === 200 ? { data: [{ id: 'local-review-b' }, { id: 'local-review-a' }, { id: 'local-review-a' }] } : { error: { message: '本地模型列表暂不可用' } })); return;
    }
    assert.equal(request.method, 'POST'); assert.equal(request.url, '/v1/chat/completions');
    let raw = ''; for await (const bytes of request) raw += bytes;
    const body = JSON.parse(raw) as ProviderBody;
    assert.ok(!raw.includes(secret), '密钥不能进入请求正文。');
    assert.ok(['local-review-a', 'local-review-b'].includes(body.model));
    const chat = body.messages[0].content.includes('当前为聊天模式');
    const question = chat ? [...body.messages].reverse().find(message => message.role === 'user' && !message.content.startsWith('以下JSON') && !message.content.startsWith('本次用户选择的参考附件'))!.content : originalQuestion(body);
    providerCalls.push({ model: body.model, stream: !!body.stream, kind: chat ? 'chat' : question ? 'agent' : 'test', question });
    if (chat) {
      if (question === '验收附件引用') assert.ok(body.messages.some(message => message.content.startsWith('本次用户选择的参考附件') && message.content.includes('主角带着一把蓝色纸伞')), '真实附件正文必须进入聊天参考数据。');
      if (failChatOnce) { failChatOnce = false; response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: '本地验收故障，请重试。' } })); return; }
      if (!body.stream) { jsonReply(response, '普通聊天回复。'); return; }
      assert.equal(body.stream_options?.include_usage, true);
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const partial = question.includes('窗口关闭') ? '主窗口关闭前已收到的流式文字。' : question.includes('切换工程') ? '工程甲停止前的部分文字。' : '正在整理这段故事。';
      response.write('data: ' + JSON.stringify({ choices: [{ delta: { content: partial } }] }) + '\n\n');
      if (/窗口关闭|切换工程|手动停止/.test(question)) {
        heldStreams.add(response);
        response.on('close', () => { heldStreams.delete(response); cancelledStreams.push(question); }); return;
      }
      const timer = setTimeout(() => {
        response.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '\n\n**建议**\n- 保留人物动机\n```text\n这是示例对白\n```' }, finish_reason: 'stop' }] }) + '\n\n');
        response.end('data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 256, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 0 } } }) + '\n\ndata: [DONE]\n\n');
      }, 300);
      response.once('close', () => clearTimeout(timer)); return;
    }
    if (!question) { jsonReply(response, '连接成功。'); return; }
    if (question === '验收退避停止后立即重发') {
      response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: '本地验收503，进入真实重试退避。' } })); return;
    }
    if (question === '验收停止释放后的下一条请求') {
      jsonReply(response, { message: '旧请求已停止，下一条请求正常完成。', operations: [] }); return;
    }
    const results = tools(body), lastId = results.at(-1)?.id;
    for (const result of results) assert.equal(result.ok, true, JSON.stringify(result));
    if (question.startsWith('验收事务') || question.startsWith('验收过期')) {
      if (!lastId) {
        jsonReply(response, { tasks: [{ id: 'width', title: '修改作品宽度' }, { id: 'line', title: '修改第一句台词' }], tools: [call('read_width', 'readProject', { kind: 'project', path: ['width'] }, ['width'])] }); return;
      }
      if (lastId === 'read_width') {
        assert.equal(typeof results[0].data.value, 'number');
        jsonReply(response, { tools: [call('edit_width', 'editProject', { operations: [{ kind: 'editProject', path: ['width'], action: 'set', value: 1600 }] }, ['width']), call('edit_line', 'editProject', { operations: [{ kind: 'replaceText', lineId, text: changedText }] }, ['line'])] }); return;
      }
      if (lastId === 'edit_line') {
        jsonReply(response, { tools: [call('check_width', 'checkProject', { checks: [{ path: ['width'], value: 1600 }] }, ['width']), call('check_line', 'checkProject', { checks: [{ path: ['nodes', { id: passage.id }, 'lines', { id: lineId }, 'text'], value: changedText }] }, ['line']), call('review', 'reviewChanges', {})] }); return;
      }
      assert.equal(lastId, 'review'); assert.equal(results.at(-1)!.data.summary.changedLines, 1);
      assert.equal(results.find(item => item.id === 'check_width')!.data.passed, true);
      assert.equal(results.find(item => item.id === 'check_line')!.data.passed, true);
      jsonReply(response, { finish: { message: '已核对作品宽度与第一句台词，请审阅后应用。', tasks: [{ id: 'width', status: 'complete', evidence: ['check_width'] }, { id: 'line', status: 'complete', evidence: ['check_line'] }], editorCommands: ['save'] } }); return;
    }
    if (question.startsWith('验收停止试玩')) {
      if (!lastId) { jsonReply(response, { tasks: [{ id: 'inspect', title: '核对当前工程后停止试玩', kind: 'inspect' }], tools: [call('read_width', 'readProject', { kind: 'project', path: ['width'] }, ['inspect']), call('review', 'reviewChanges', {})] }); return; }
      assert.equal(lastId, 'review'); assert.equal(typeof results.find(item => item.id === 'read_width')!.data.value, 'number');
      jsonReply(response, { finish: { message: '工程无需修改，请点击停止试玩。', tasks: [{ id: 'inspect', status: 'complete', evidence: ['read_width'] }], editorCommands: ['stopPreview'] } }); return;
    }
    if (question.startsWith('验收读取')) {
      const context = requestContext(body), selected = question.includes('参数') ? 'parameter' : question.includes('节点') ? 'blueprint' : 'component';
      if (!lastId) {
        const reads = selected === 'parameter' ? [call('read_selection', 'readProject', { kind: 'project', path: ['variables', { id: variableId }] }, ['inspect'])]
          : selected === 'blueprint' ? [call('read_selection', 'readProject', { kind: 'selectedBlueprint', elements: 'nodes' }, ['inspect']), call('read_template', 'readProject', { kind: 'blueprintNode', type: 'setUiProperty' }, ['inspect'])]
            : [call('read_selection', 'readProject', { kind: 'project', path: ['ui', 'components', { id: componentId }] }, ['inspect'])];
        if (selected === 'parameter') assert.equal(context.selectedParameter.variable.id, variableId);
        if (selected === 'blueprint') assert.equal(context.selectedBlueprint.node.id, readNode.id);
        if (selected === 'component') assert.equal(context.selectedUiComponent.id, componentId);
        jsonReply(response, { tasks: [{ id: 'inspect', title: '检查当前' + selected, kind: 'inspect' }], tools: [...reads, call('review', 'reviewChanges', {})] }); return;
      }
      assert.equal(lastId, 'review'); const result = results.find(item => item.id === 'read_selection')!;
      if (selected === 'parameter') { assert.equal(result.data.value.initial, 7); assert.equal(result.data.value.parameterSetId, setId); }
      if (selected === 'blueprint') { assert.equal(result.data.items[0].id, readNode.id); assert.ok(results.find(item => item.id === 'read_template')!.data.template.pins.length); }
      if (selected === 'component') assert.equal(result.data.value.text, '这是独立控件');
      jsonReply(response, { finish: { message: '已读取当前' + selected + '，无需修改工程。', tasks: [{ id: 'inspect', status: 'complete', evidence: ['read_selection'] }] } }); return;
    }
    throw new Error('未登记的本地验收请求：' + question);
  } catch (error) { errors.push('本地模拟服务：' + String(error)); if (!response.headersSent) response.writeHead(500); response.end('isolated mock failure'); }
});
let apiRoot = '';

async function prepare() {
  const workspace = await fs.realpath(root); let current = root;
  for (const part of path.relative(root, output).split(path.sep)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (current === output) assert.equal(stat, undefined, '每次验收必须使用新目录。');
    if (stat) assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), '不得通过目录链接访问产物。'); else await fs.mkdir(current);
    assert.ok(inside(workspace, await fs.realpath(current)));
  }
  outputPrepared = true;
  for (const folder of [fixtureA, fixtureB, profile, startupProfile, inputs, evidence, screenshots]) await fs.mkdir(folder);
  await saveProject(projectAFile, projectA); await saveProject(projectBFile, projectB);
  await fs.writeFile(attachmentFile, '验收附件：主角带着一把蓝色纸伞。');
  const importImage = new PNG({ width: 2, height: 2 }); importImage.data.fill(255); await fs.writeFile(importFile, PNG.sync.write(importImage));
  const discoveryImage = new PNG({ width: 2, height: 2 }); for (let index = 0; index < discoveryImage.data.length; index += 4) discoveryImage.data.set([45, 110, 180, 255], index);
  await fs.writeFile(discoveryInputFile, PNG.sync.write(discoveryImage));
  await fs.copyFile(projectAFile, path.join(evidence, 'input-project-a.json'));
  await fs.copyFile(projectBFile, path.join(evidence, 'input-project-b.json'));
  report.inputSha256 = digest(await fs.readFile(projectAFile));
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  apiRoot = `http://127.0.0.1:${(mock.address() as { port: number }).port}/v1`;
  report.apiOrigin = new URL(apiRoot).origin;
}
async function check(name: string, work: () => Promise<void>) {
  report.phase = name; const started = Date.now(); await work(); checks.push({ name, durationMs: Date.now() - started }); await persist(); console.log('通过：' + name);
}
async function capture(name: string) {
  if (editor && !editor.isClosed()) await editor.screenshot({ path: path.join(screenshots, name + '-editor.png') });
  if (assistant && !assistant.isClosed()) await assistant.screenshot({ path: path.join(screenshots, name + '-assistant.png') });
}
async function installNativeGates() {
  await app!.evaluate(({ ipcMain, dialog, session }, options) => {
    const handlers = (ipcMain as any)._invokeHandlers as Map<string, (...args: any[]) => any>;
    const original = new Map<string, (...args: any[]) => any>();
    const open = dialog.showOpenDialog, save = dialog.showSaveDialog, messageBox = dialog.showMessageBox, fetch = globalThis.fetch;
    const state = (globalThis as any).__aiReviewGate = { requestCalls: [], requestEvents: [], heldConfig: false, holdConfig: false, heldInspection: false, holdInspection: false, configResponses: 0, inspectionResponses: 0, heldConversation: false, holdProjectSave: false, heldProjectSave: false, holdImport: false, heldImport: false, holdPreviewStop: false, heldPreviewStop: false, previewStopResponses: 0, heldDiscovery: false, discoveryResponses: 0, heldDiscoveryAssetNames: [], conversationCalls: [], projectSaveCalls: 0, importCalls: 0, closeSaveInputs: [], closeSaveResponses: 0, closeSavePending: 0, conversationRejections: 0, nextOpenFiles: [], saveDialogs: [], messageBoxes: [], blockedUrls: [], restore: () => {} } as NativeGate;
    for (const channel of ['studio:ai-request', 'studio:ai-cancel', 'studio:ai-attachments-mentioned', 'studio:ai-config-save', 'studio:ai-conversation-save', 'studio:save', 'studio:import', 'studio:preview-control', 'studio:close-save', 'studio:discover-assets']) {
      const handler = handlers.get(channel); if (!handler) throw new Error('缺少真实 IPC：' + channel); original.set(channel, handler);
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (...args: any[]) => {
        if (channel === 'studio:ai-request') { const request = args[1]; state.requestCalls.push({ id: request.id, prompt: request.prompt, projectId: request.project.id }); state.requestEvents.push({ kind: 'request-start', id: request.id, at: performance.now() }); }
        if (channel === 'studio:ai-cancel') state.requestEvents.push({ kind: 'cancel-start', id: args[1], at: performance.now() });
        if (channel === 'studio:ai-config-save' && args[1].baseUrl !== options.apiRoot) throw new Error('验收禁止配置外部 AI 地址。');
        if (channel === 'studio:ai-conversation-save') {
          state.conversationCalls.push({ id: args[1].id, draft: args[1].draft });
          if (args[1].id === state.holdConversationId && state.closeSavePending > 0) { state.holdConversationId = undefined; state.heldConversation = true; await new Promise<void>(resolve => { state.conversationRelease = resolve; }); state.heldConversation = false; }
        }
        if (channel === 'studio:ai-conversation-save' && args[1].id === state.rejectConversationId) { state.conversationRejections++; throw new Error('会话已达到保存上限，请新建会话。（隔离容量夹具）'); }
        if (channel === 'studio:save') { state.projectSaveCalls++; if (state.holdProjectSave) { state.holdProjectSave = false; state.heldProjectSave = true; await new Promise<void>(resolve => { state.projectSaveRelease = resolve; }); state.heldProjectSave = false; } }
        if (channel === 'studio:import') { state.importCalls++; if (state.holdImport) { state.holdImport = false; state.heldImport = true; await new Promise<void>(resolve => { state.importRelease = resolve; }); state.heldImport = false; } }
        if (channel === 'studio:preview-control' && args[1] === 'stop' && state.holdPreviewStop) { state.holdPreviewStop = false; state.heldPreviewStop = true; await new Promise<void>(resolve => { state.previewStopRelease = resolve; }); state.heldPreviewStop = false; }
        if (channel === 'studio:close-save') { state.closeSaveInputs.push({ projectId: args[1]?.project?.id, allowed: args[1] !== null }); state.closeSavePending++; }
        if (channel === 'studio:ai-attachments-mentioned' && state.holdInspection) {
          state.holdInspection = false; state.heldInspection = true;
          await new Promise<void>(resolve => { state.inspectionRelease = resolve; }); state.heldInspection = false;
        }
        let result;
        try { result = await handler(...args); } finally {
          if (channel === 'studio:close-save') state.closeSavePending--;
          if (channel === 'studio:ai-request') state.requestEvents.push({ kind: 'request-settled', id: args[1].id, at: performance.now() });
          if (channel === 'studio:ai-cancel') state.requestEvents.push({ kind: 'cancel-settled', id: args[1], at: performance.now() });
        }
        if (channel === 'studio:ai-config-save' && state.holdConfig) {
          state.holdConfig = false; state.heldConfig = true;
          await new Promise<void>(resolve => { state.configRelease = resolve; }); state.heldConfig = false;
        }
        if (channel === 'studio:discover-assets' && state.holdDiscoveryName && result?.project?.assets.some((asset: { name: string }) => asset.name === state.holdDiscoveryName)) {
          state.holdDiscoveryName = undefined; state.heldDiscovery = true; state.heldDiscoveryAssetNames = result.project.assets.map((asset: { name: string }) => asset.name);
          await new Promise<void>(resolve => { state.discoveryRelease = resolve; }); state.heldDiscovery = false;
        }
        if (channel === 'studio:ai-config-save') state.configResponses++;
        if (channel === 'studio:ai-attachments-mentioned') state.inspectionResponses++;
        if (channel === 'studio:preview-control' && args[1] === 'stop') state.previewStopResponses++;
        if (channel === 'studio:close-save') state.closeSaveResponses++;
        if (channel === 'studio:discover-assets') state.discoveryResponses++;
        return result;
      });
    }
    const allowed = (file: string) => file.startsWith(options.output + options.separator);
    (dialog as any).showOpenDialog = async () => {
      const files = state.nextOpenFiles; state.nextOpenFiles = [];
      if (!files.length || !files.every(allowed)) throw new Error('未登记本轮文件选择。');
      return { canceled: false, filePaths: files };
    };
    (dialog as any).showSaveDialog = async (...args: any[]) => {
      const title = args.at(-1)?.title ?? '';
      if (state.nextSaveCancelled) { state.nextSaveCancelled = false; state.saveDialogs.push({ title, canceled: true }); return { canceled: true }; }
      const file = state.nextSaveFile; state.nextSaveFile = undefined;
      if (!file || !allowed(file)) throw new Error('未登记本轮保存目标。');
      state.saveDialogs.push({ title, canceled: false, file });
      return { canceled: false, filePath: file };
    };
    (dialog as any).showMessageBox = async (...args: any[]) => {
      const options = args.at(-1); state.messageBoxes.push({ title: options?.title ?? '', message: options?.message ?? '' });
      if (options?.title !== '未能完成关闭') throw new Error('未登记本轮消息框：' + options?.title);
      return { response: 0, checkboxChecked: false };
    };
    (globalThis as any).fetch = (input: any, init: any) => {
      const url = new URL(typeof input === 'object' && input !== null && 'url' in input ? input.url : String(input));
      if (url.origin !== new URL(options.apiRoot).origin) { state.blockedUrls.push(url.href); return Promise.reject(new Error('禁止本轮源桌面请求外部地址。')); }
      return fetch.call(globalThis, input, init);
    };
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      const allowed = new URL(details.url).origin === new URL(options.apiRoot).origin;
      if (!allowed) state.blockedUrls.push(details.url); callback({ cancel: !allowed });
    });
    state.restore = () => {
      state.configRelease?.(); state.inspectionRelease?.(); state.conversationRelease?.(); state.projectSaveRelease?.(); state.importRelease?.(); state.previewStopRelease?.(); state.discoveryRelease?.();
      for (const [channel, handler] of original) { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler); }
      dialog.showOpenDialog = open; dialog.showSaveDialog = save; dialog.showMessageBox = messageBox;
      // Keep both network allowlists active until this isolated process exits,
      // including the production native-close check after IPC wrappers restore.
    };
  }, { apiRoot, output, separator: path.sep });
}
async function launch() {
  app = await launchDesktopFixture({ root, profile, projectFile: projectAFile, confirmClose: true });
  await app.evaluate('globalThis.__name = value => value');
  launchNumber++; const child = app.process(); processes.push({ pid: child.pid, exited: false });
  editor = await app.firstWindow(); assistant = undefined; editor.setDefaultTimeout(15000);
  editor.on('pageerror', error => errors.push(error.message));
  await editor.evaluate('globalThis.__name = value => value');
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; if (window.isMaximized()) window.unmaximize(); window.setContentSize(1500, 960); window.webContents.setBackgroundThrottling(false); });
  await expect(editor.locator('.project-title strong')).toHaveText(projectA.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(editor.url())), path.join(root, 'dist/index.html'));
  await editor.context().tracing.start({ screenshots: true, snapshots: true, sources: false }); traceRunning = true;
  await installNativeGates();
}
async function openAssistant() {
  const opened = app!.waitForEvent('window'); await editor!.getByRole('button', { name: 'AI 助手', exact: true }).click();
  assistant = await opened; assistant.setDefaultTimeout(15000); assistant.on('pageerror', error => errors.push(error.message));
  await assistant.evaluate('globalThis.__name = value => value');
  await app!.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#ai-assistant'))!.webContents.setBackgroundThrottling(false); });
  assert.equal(path.resolve(fileURLToPath(assistant.url().split('#')[0])), path.join(root, 'dist/index.html'));
  await expect(assistant.getByLabel('发给 AI 的内容', { exact: true })).toBeEnabled();
}
const chatButton = (name: string) => (name === 'AI 服务设置' ? assistant!.locator('.ai-assistant > header') : assistant!).getByRole('button', { name, exact: true });
async function openMenu(name: string) {
  const menu = assistant!.getByRole('dialog', { name, exact: true });
  if (!await menu.isVisible()) await chatButton(name).click();
  await expect(menu).toBeVisible(); return menu;
}
async function closeMenu(name: string) {
  const menu = assistant!.getByRole('dialog', { name, exact: true });
  if (await menu.isVisible()) await chatButton(name).click();
  await expect(menu).not.toBeVisible();
}
async function showHistory() {
  if (await chatButton('显示会话列表').isVisible()) await chatButton('显示会话列表').click();
  await expect(assistant!.getByRole('navigation', { name: '历史会话列表', exact: true })).toBeVisible();
}
async function openDetails(page: Page, summary: string | RegExp) {
  const details = page.locator('summary').filter({ hasText: summary }).last().locator('..');
  await expect(details.locator('summary')).toBeVisible();
  if (!await details.evaluate(element => (element as HTMLDetailsElement).open)) await details.locator('summary').click();
  await expect(details).toHaveJSProperty('open', true); return details;
}
async function expectReference(text: string) {
  const menu = await openMenu('参考信息');
  await expect(menu.getByLabel('当前工程上下文', { exact: true })).toContainText(text);
  await closeMenu('参考信息');
}
async function externalAccess(enabled: boolean) {
  const menu = await openMenu('添加参考');
  await menu.getByRole('checkbox', { name: '允许访问项目外文件', exact: true }).setChecked(enabled);
  await closeMenu('添加参考');
}
const currentConversation = () => assistant!.evaluate(async () => {
  const context = (await window.studio!.getAiContext!())!;
  const list = await window.studio!.listAiConversations!(context.project.id);
  return list.activeId ? window.studio!.readAiConversation!(context.project.id, list.activeId) : undefined;
});
const snapshot = () => assistant!.evaluate(async () => (await window.studio!.getAiContext!())!.project);
async function gateFlags(patch: Partial<NativeGate>) { await app!.evaluate((_electron, patch) => Object.assign((globalThis as any).__aiReviewGate, patch), patch); }
async function nativeCounts() { return app!.evaluate(() => { const gate = (globalThis as any).__aiReviewGate as NativeGate; return { requests: gate.requestCalls.length, requestCalls: gate.requestCalls, requestEvents: gate.requestEvents, heldConfig: gate.heldConfig, heldInspection: gate.heldInspection, configResponses: gate.configResponses, inspectionResponses: gate.inspectionResponses, heldConversation: gate.heldConversation, heldProjectSave: gate.heldProjectSave, heldImport: gate.heldImport, heldPreviewStop: gate.heldPreviewStop, previewStopResponses: gate.previewStopResponses, heldDiscovery: gate.heldDiscovery, discoveryResponses: gate.discoveryResponses, heldDiscoveryAssetNames: gate.heldDiscoveryAssetNames, conversationCalls: gate.conversationCalls, projectSaveCalls: gate.projectSaveCalls, importCalls: gate.importCalls, closeSaveInputs: gate.closeSaveInputs, closeSaveResponses: gate.closeSaveResponses, rejections: gate.conversationRejections, saveDialogs: gate.saveDialogs, messageBoxes: gate.messageBoxes, blocked: gate.blockedUrls }; }); }
async function releaseGate(kind: 'config' | 'inspection' | 'conversation' | 'projectSave' | 'import' | 'previewStop' | 'discovery') { await app!.evaluate((_electron, kind) => { const gate = (globalThis as any).__aiReviewGate as NativeGate; const releases = { config: gate.configRelease, inspection: gate.inspectionRelease, conversation: gate.conversationRelease, projectSave: gate.projectSaveRelease, import: gate.importRelease, previewStop: gate.previewStopRelease, discovery: gate.discoveryRelease }; releases[kind]?.(); }, kind); }
async function send(text: string) { await assistant!.getByLabel('发给 AI 的内容', { exact: true }).fill(text); await chatButton('发送').click(); }
async function complete() {
  await expect(chatButton('停止生成')).toHaveCount(0, { timeout: 30000 });
  await expect(chatButton('正在停止…')).toHaveCount(0, { timeout: 30000 });
  await expect(chatButton('发送')).toBeVisible();
  await expect(assistant!.getByLabel('发给 AI 的内容', { exact: true })).toBeEnabled();
}
async function newConversation(mode: 'chat' | 'edit') {
  const previousId = (await currentConversation())?.id;
  await showHistory(); await chatButton('新建会话').click(); await expect(assistant!.locator('.ai-message')).toHaveCount(0); await assistant!.getByLabel('AI 对话模式', { exact: true }).selectOption(mode);
  await expect.poll(async () => { const saved = await currentConversation(); return !!saved && saved.id !== previousId && saved.messages.length === 0; }).toBe(true);
}
async function settleRenderer() { await assistant!.evaluate(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }); }
async function assertRecoverySource(source: AiConversation, draft: string, visibleHistory: string | null) {
  await expect(assistant!.getByLabel('发给 AI 的内容', { exact: true })).toHaveValue(draft);
  await expect(assistant!.locator('.ai-message')).toHaveCount(source.messages.length);
  assert.equal(await assistant!.locator('.ai-conversation').textContent(), visibleHistory);
  const saved = (await currentConversation())!; assert.equal(saved.id, source.id);
  assert.deepEqual(saved.messages.map(message => message.id), source.messages.map(message => message.id));
}
async function readConversation(projectId: string, id: string) { return assistant!.evaluate(({ projectId, id }) => window.studio!.readAiConversation!(projectId, id), { projectId, id }); }
const commandResults = (conversation: AiConversation) => JSON.parse(conversation.messages.at(-1)?.context ?? '{}').editorResults ?? [];
async function stopTrace() {
  if (!traceRunning || !editor) return;
  const name = `trace-${String(launchNumber).padStart(2, '0')}.zip`;
  await editor.context().tracing.stop({ path: path.join(output, name) }); traces.push(name); traceRunning = false;
}
async function closeOwned() {
  if (!app) return;
  const owned = app, child = owned.process(); await stopTrace();
  if (child.exitCode === null && child.signalCode === null) {
    await owned.evaluate(() => { ((globalThis as any).__aiReviewGate as NativeGate | undefined)?.restore(); }).catch(() => undefined);
    await owned.close();
  }
  await expect.poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 15000 }).toBe(true);
  const item = processes.find(item => item.pid === child.pid)!; Object.assign(item, { exited: true, code: child.exitCode, signal: child.signalCode });
  app = undefined; editor = undefined; assistant = undefined;
}

let savedSessionId = '', streamingSessionId = '';
try {
  await prepare(); await persist();
  await check('空profile项目启动页自然关闭取得真实工程并退出', async () => {
    app = await launchDesktopFixture({ root, profile: startupProfile, projectHub: true, confirmClose: true }); launchNumber++;
    await app.evaluate('globalThis.__name = value => value');
    const child = app.process(); processes.push({ pid: child.pid, exited: false }); editor = await app.firstWindow(); editor.setDefaultTimeout(15000);
    editor.on('pageerror', error => errors.push(error.message)); await editor.evaluate('globalThis.__name = value => value');
    assert.equal(path.resolve(fileURLToPath(editor.url())), path.join(root, 'dist/index.html'));
    await expect(editor.getByRole('main', { name: '项目窗口', exact: true })).toBeVisible(); await installNativeGates();
    await capture('startup-before-native-close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await expect.poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 30000 }).toBe(true);
    assert.equal(child.exitCode, 0); assert.equal(child.signalCode, null); Object.assign(processes.at(-1)!, { exited: true, code: child.exitCode, signal: child.signalCode });
    app = undefined; editor = undefined;
  });
  await check('源码入口、隔离工程和独立助手窗口', async () => {
    await launch(); await openStoryMode(editor!, 'script'); await openAssistant();
    const windows = await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ assistant: window.webContents.getURL().endsWith('#ai-assistant'), modal: window.isModal(), parent: !!window.getParentWindow(), resizable: window.isResizable() })));
    assert.deepEqual(windows.find(window => window.assistant), { assistant: true, modal: false, parent: false, resizable: true });
    await editor!.getByRole('button', { name: 'AI 助手', exact: true }).click(); assert.equal(app!.windows().length, 2);
    await app!.evaluate(({ ipcMain }, errorsChannel) => {
      if (ipcMain.listenerCount(errorsChannel) === 0) throw new Error('缺少真实关闭一致性确认 IPC。');
    }, 'studio:close-check-result');
  });
  await check('作品设置获取模型使用未保存地址密钥且去重排序', async () => {
    await editor!.getByRole('button', { name: '作品设置', exact: true }).click(); await editor!.getByRole('button', { name: 'AI 服务', exact: true }).click();
    await editor!.getByLabel('AI API 地址', { exact: true }).fill(apiRoot); await editor!.getByLabel('AI API 密钥', { exact: true }).fill(secret);
    await editor!.getByRole('button', { name: '获取模型列表', exact: true }).click();
    await editor!.getByRole('button', { name: '选择可用模型', exact: true }).click();
    const models = editor!.getByRole('listbox', { name: '可用模型', exact: true });
    await expect(models.getByRole('option')).toHaveText(['local-review-a', 'local-review-b']);
    assert.equal((await editor!.evaluate(() => window.studio!.getAiConfig!())).model, '');
    await models.getByRole('option', { name: 'local-review-a', exact: true }).click();
    await expect(editor!.getByRole('combobox', { name: 'AI 模型名称', exact: true })).toHaveValue('local-review-a');
  });
  await check('真实保存测试连接与双窗口模型同步', async () => {
    await openDetails(editor!, /^更多连接设置$/);
    await editor!.getByRole('checkbox', { name: '在本机安全保存密钥', exact: true }).uncheck();
    await editor!.getByRole('button', { name: '保存并测试连接', exact: true }).click();
    await expect(editor!.locator('.ai-settings [role="status"]')).toContainText('连接成功，服务已返回有效回复。');
    assert.ok(!(await fs.readFile(path.join(profile, 'ai-settings.json'), 'utf8')).includes(secret));
    await editor!.getByRole('button', { name: '完成', exact: true }).click(); await expect(assistant!.locator('.ai-compose-meta small').first()).toHaveText('local-review-a');
  });
  await check('助手设置入口模型列表及404手填', async () => {
    await chatButton('AI 服务设置').click(); await chatButton('获取模型列表').click();
    await chatButton('选择可用模型').click();
    await expect(assistant!.getByRole('listbox', { name: '可用模型', exact: true }).getByRole('option')).toHaveText(['local-review-a', 'local-review-b']);
    await assistant!.getByRole('combobox', { name: 'AI 模型名称', exact: true }).press('Escape');
    modelStatus = 404; await chatButton('获取模型列表').click(); await expect(assistant!.getByRole('alert')).toContainText('404');
    await expect(chatButton('选择可用模型')).toBeDisabled();
    await expect(assistant!.getByRole('combobox', { name: 'AI 模型名称', exact: true })).toBeEnabled();
    await assistant!.getByLabel('AI 模型名称', { exact: true }).fill('local-review-b'); await chatButton('保存 AI 配置').click();
    await expect(assistant!.getByRole('status')).toContainText('AI 配置已保存'); modelStatus = 200;
    await chatButton('返回助手').click(); await expect(assistant!.locator('.ai-compose-meta small').first()).toHaveText('local-review-b');
  });
  await check('配置保存响应暂停期间停止不发连接测试', async () => {
    await chatButton('AI 服务设置').click(); const before = providerCalls.length; await gateFlags({ holdConfig: true });
    await chatButton('保存并测试连接').click(); await expect.poll(async () => (await nativeCounts()).heldConfig).toBe(true);
    await chatButton('停止请求').click(); await releaseGate('config');
    await expect(assistant!.getByRole('status')).toContainText('AI 配置已保存，连接测试已停止。'); assert.equal(providerCalls.length, before);
  });
  await check('配置保存响应暂停期间离开设置不发连接测试', async () => {
    const before = providerCalls.length, responses = (await nativeCounts()).configResponses; await gateFlags({ holdConfig: true }); await chatButton('保存并测试连接').click();
    await expect.poll(async () => (await nativeCounts()).heldConfig).toBe(true); await chatButton('返回助手').click(); await releaseGate('config');
    await expect.poll(async () => (await nativeCounts()).configResponses).toBe(responses + 1);
    // Two rendered frames allow the released IPC continuation to run; no
    // arbitrary delay is used to guess when the response has arrived.
    await settleRenderer();
    assert.equal(providerCalls.length, before);
  });
  await check('聊天流式Markdown及真实零缓存用量', async () => {
    await assistant!.getByLabel('AI 对话模式', { exact: true }).selectOption('chat'); await send('验收流式聊天');
    await expect(assistant!.locator('.ai-message.assistant').last()).toContainText('正在整理'); await complete();
    await expect(assistant!.locator('.ai-message.assistant').last().locator('pre code')).toContainText('示例对白');
    await openDetails(assistant!, /^用量$/);
    await expect(assistant!.locator('.ai-usage').last()).toContainText('缓存命中 0 token'); await capture('stream-and-usage');
  });
  await check('附件选择不发送、聊天请求携带真实附件正文', async () => {
    const before = providerCalls.length; await gateFlags({ nextOpenFiles: [attachmentFile] }); await openMenu('添加参考'); await chatButton('添加文件').click();
    await expect(assistant!.getByLabel('待发送的参考附件', { exact: true })).toContainText('人物 设定.txt'); assert.equal(providerCalls.length, before);
    await send('验收附件引用'); await complete();
    const conversation = await currentConversation(); assert.deepEqual(conversation!.messages.filter(message => message.role === 'user').at(-1)!.attachmentPaths, [attachmentFile]);
  });
  await check('错误重试保留当前会话及消息编号', async () => {
    failChatOnce = true; await send('验收失败重试'); await complete(); await expect(assistant!.locator('.ai-message.assistant').last()).toContainText('本地验收故障');
    await expect.poll(async () => (await currentConversation())?.messages.at(-1)?.status).toBe('failed');
    const before = (await currentConversation())!; await assistant!.locator('.ai-message.assistant').last().getByRole('button', { name: '重试', exact: true }).click(); await complete();
    await expect.poll(async () => (await currentConversation())?.messages.at(-1)?.status).toBeUndefined(); const after = (await currentConversation())!;
    assert.equal(after.id, before.id); assert.deepEqual(after.messages.map(message => message.id), before.messages.map(message => message.id));
  });
  await check('会话重命名置顶搜索及Markdown导出', async () => {
    await openMenu('会话操作'); await chatButton('重命名会话').click(); await assistant!.getByLabel('会话名称', { exact: true }).fill('本轮流式与附件'); await chatButton('保存名称').click(); await openMenu('会话操作'); await chatButton('置顶会话').click();
    await showHistory();
    await assistant!.getByLabel('搜索历史会话', { exact: true }).fill('本轮流式'); await expect(assistant!.getByRole('navigation', { name: '历史会话列表', exact: true }).getByRole('button')).toHaveCount(1);
    const file = path.join(evidence, 'conversation.md'); await gateFlags({ nextSaveFile: file }); await openMenu('会话操作'); await chatButton('导出会话 Markdown').click();
    await expect(assistant!.getByRole('status')).toContainText('聊天记录已导出'); assert.ok((await fs.readFile(file, 'utf8')).includes('验收附件引用'));
    await assistant!.getByLabel('搜索历史会话', { exact: true }).fill('');
  });
  await check('原生关闭助手恢复会话模式与下一条草稿', async () => {
    await assistant!.getByLabel('发给 AI 的内容', { exact: true }).fill('助手关闭前未发送的草稿');
    await expect.poll(async () => (await currentConversation())?.draft).toBe('助手关闭前未发送的草稿'); savedSessionId = (await currentConversation())!.id;
    const closed = assistant!.waitForEvent('close'); await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#ai-assistant'))!.close()); await closed;
    await openAssistant(); await expect(assistant!.getByLabel('发给 AI 的内容', { exact: true })).toHaveValue('助手关闭前未发送的草稿');
    await expect(assistant!.getByLabel('AI 对话模式', { exact: true })).toHaveValue('chat'); await expect.poll(async () => (await currentConversation())?.id).toBe(savedSessionId);
    await expect(assistant!.getByLabel('待发送的参考附件', { exact: true })).toHaveCount(0);
  });
  await check('新会话独立且返回旧会话保留记录', async () => {
    await newConversation('chat'); await send('另一个独立故事'); await complete();
    await showHistory();
    await assistant!.getByRole('navigation', { name: '历史会话列表', exact: true }).getByRole('button', { name: /本轮流式与附件/ }).click();
    await expect(assistant!.locator('.ai-message.user')).toHaveCount(3); await expect.poll(async () => (await currentConversation())?.id).toBe(savedSessionId);
  });
  await check('项目外路径预检查暂停后停止不发送模型请求', async () => {
    await newConversation('chat'); await externalAccess(true);
    const before = (await nativeCounts()).requests, responses = (await nativeCounts()).inspectionResponses; await gateFlags({ holdInspection: true }); await send('验收预检查停止');
    await expect.poll(async () => (await nativeCounts()).heldInspection).toBe(true); await chatButton('停止生成').click(); await complete(); await releaseGate('inspection');
    await expect.poll(async () => (await nativeCounts()).inspectionResponses).toBe(responses + 1);
    await settleRenderer();
    assert.equal((await nativeCounts()).requests, before);
    await expect(assistant!.getByLabel('发给 AI 的内容', { exact: true })).toHaveValue('验收预检查停止');
    await expect(assistant!.locator('.ai-message')).toHaveCount(0); await externalAccess(false);
  });
  await check('真实503重试退避中停止、等待完整清理后立即重发', async () => {
    const question = '验收退避停止后立即重发', nextQuestion = '验收停止释放后的下一条请求';
    await newConversation('edit'); await showHistory();
    const before = await nativeCounts(), beforeProject = await snapshot();
    await send(question);
    // Draft the next request while the first operation is still active. Once
    // its real 503 response enters backoff, no artificial timer releases it.
    await assistant!.getByLabel('发给 AI 的内容', { exact: true }).fill(nextQuestion);
    await expect(assistant!.locator('.ai-progress')).toContainText('正在重试当前回复');
    const interaction = await assistant!.evaluate(async () => {
      const action = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => (button.textContent ?? '').trim() === name);
      const stop = action('停止生成');
      if (!stop || stop.disabled) throw new Error('尚未进入可停止的真实重试等待。');
      const draft = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="发给 AI 的内容"]')!;
      const record = { sawStopping: false, stoppingDisabled: false, modeDisabled: false, historyDisabled: false, menuDisabled: false, sendPresentDuringStop: false, draftDuringStop: '', nextSent: false };
      // The observer drives ordinary DOM click/key events at the first rendered
      // stopping/ready state. It never calls the request/cancel bridge itself.
      return new Promise<typeof record>((resolve, reject) => {
        const finish = (error?: Error) => { clearTimeout(timeout); observer.disconnect(); error ? reject(error) : resolve(record); };
        const inspect = () => {
          const stopping = action('正在停止…');
          if (stopping && !record.sawStopping) {
            record.sawStopping = true; record.stoppingDisabled = stopping.disabled;
            record.modeDisabled = !!document.querySelector<HTMLSelectElement>('select[aria-label="AI 对话模式"]')?.disabled;
            record.historyDisabled = !!action('新建会话')?.disabled;
            record.menuDisabled = !!document.querySelector<HTMLButtonElement>('button[aria-label="会话操作"]')?.disabled;
            record.sendPresentDuringStop = !!action('发送'); record.draftDuringStop = draft.value;
            draft.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
          }
          const send = action('发送');
          if (record.sawStopping && !stopping && send && !send.disabled) {
            if (!draft.value) { finish(new Error('停止期间快捷键意外清除了下一条草稿。')); return; }
            record.nextSent = true; send.click(); finish();
          }
        };
        const observer = new MutationObserver(inspect);
        const timeout = setTimeout(() => finish(new Error('停止后未恢复发送，真实退避请求尚未完整退出。')), 15000);
        observer.observe(document.querySelector('.ai-assistant')!, { subtree: true, childList: true, attributes: true });
        stop.click(); inspect();
      });
    });
    assert.deepEqual(interaction, { sawStopping: true, stoppingDisabled: true, modeDisabled: true, historyDisabled: true, menuDisabled: true, sendPresentDuringStop: false, draftDuringStop: nextQuestion, nextSent: true });
    await complete(); await expect(assistant!.locator('.ai-message')).toHaveCount(4);
    await expect(assistant!.locator('.ai-message.assistant').first()).toContainText('已停止');
    await expect(assistant!.locator('.ai-message.assistant').last()).toContainText('下一条请求正常完成');
    await expect(assistant!.locator('.ai-compose [role="alert"]')).toHaveCount(0);
    await expect.poll(async () => (await currentConversation())?.messages.length).toBe(4);
    const source = (await currentConversation())!, counts = await nativeCounts();
    assert.equal(counts.requests, before.requests + 2, '停止期间快捷键没有额外启动请求。');
    const requests = counts.requestCalls.slice(before.requestCalls.length);
    assert.deepEqual(requests.map(request => request.prompt), [question, nextQuestion]);
    assert.notEqual(requests[0].id, requests[1].id);
    const events = counts.requestEvents.slice(before.requestEvents.length);
    assert.deepEqual(events.map(({ kind, id }) => ({ kind, id })), [
      { kind: 'request-start', id: requests[0].id }, { kind: 'cancel-start', id: requests[0].id },
      { kind: 'request-settled', id: requests[0].id }, { kind: 'cancel-settled', id: requests[0].id },
      { kind: 'request-start', id: requests[1].id }, { kind: 'request-settled', id: requests[1].id },
    ], '取消响应必须晚于旧请求完整退出，下一条请求只能在其后开始。');
    assert.equal(providerCalls.filter(call => call.question === question).length, 1, '被停止的退避任务没有再次请求模型。');
    assert.equal(providerCalls.filter(call => call.question === nextQuestion).length, 1);
    assert.deepEqual(source.messages.map(message => message.id), [requests[0].id + '_user', requests[0].id + '_assistant', requests[1].id + '_user', requests[1].id + '_assistant']);
    assert.equal(source.messages[1].status, 'stopped'); assert.equal(source.messages[3].status, undefined);
    assert.deepEqual(await snapshot(), beforeProject);
    report.retryStopResend = { interaction, events, conversationId: source.id };
    await fs.writeFile(path.join(evidence, 'retry-stop-resend-conversation.json'), JSON.stringify(source, null, 2));
    await capture('retry-stop-resend');
  });
  await check('通用工具读取修改核对finish仅生成可审阅方案', async () => {
    await newConversation('edit'); await openMenu('参考信息'); await assistant!.getByLabel('AI 处理范围', { exact: true }).selectOption('all'); await closeMenu('参考信息');
    await send('验收事务：将作品宽度设为1600并改第一句台词'); await complete();
    const proposal = assistant!.getByRole('region', { name: 'AI 创作方案', exact: true }).last();
    await openDetails(assistant!, /^修改统计$/);
    await expect(proposal.locator('.ai-workflow-counts > span').filter({ hasText: '台词修改' }).locator('b')).toHaveText('1');
    await openDetails(assistant!, /^核对结果 · 2 项$/);
    await expect(proposal.getByLabel('逐项结果核对', { exact: true }).locator('li[data-status="complete"]')).toHaveCount(2);
    await expect(proposal.getByLabel('逐项结果核对', { exact: true }).locator('li[data-status="complete"]').first()).toBeVisible();
    await expect(chatButton('保存工程')).toBeDisabled(); assert.equal((await snapshot()).width, projectA.width); assert.equal(aiLines(await snapshot())[0].line.text, originalText);
    assert.equal(digest(await fs.readFile(projectAFile)), report.inputSha256); await capture('review-before-apply');
  });
  await check('工程设置台词一次应用撤销重做且保存为原状态', async () => {
    await chatButton('应用创作方案').click(); await expect.poll(async () => (await snapshot()).width).toBe(1600);
    await expect(editor!.getByLabel('第1行对白', { exact: true })).toHaveValue(changedText);
    await chatButton('撤销工程修改').click(); await expect.poll(async () => (await snapshot()).width).toBe(projectA.width);
    await expect(editor!.getByLabel('第1行对白', { exact: true })).toHaveValue(originalText);
    await editor!.getByRole('button', { name: '重做', exact: true }).click(); await expect.poll(async () => (await snapshot()).width).toBe(1600);
    await chatButton('撤销工程修改').click(); await editor!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(editor!.locator('.dirty-dot')).toHaveCount(0);
    const saved = projectSchema.parse(JSON.parse(await fs.readFile(projectAFile, 'utf8'))); assert.equal(saved.width, projectA.width); assert.equal(aiLines(saved)[0].line.text, originalText);
  });
  await check('方案生成后手动改稿使整批过期且不覆盖新编辑', async () => {
    await send('验收过期：将作品宽度设为1600并改第一句台词'); await complete();
    await editor!.getByLabel('第1行对白', { exact: true }).fill('这是作者刚刚手动修改的台词。');
    await expectReference('作者刚刚'); await chatButton('应用创作方案').click();
    await expect(assistant!.locator('.ai-compose [role="alert"]')).toContainText(/变化|重新生成/); assert.equal((await snapshot()).width, projectA.width);
    await expect(editor!.getByLabel('第1行对白', { exact: true })).toHaveValue('这是作者刚刚手动修改的台词。');
    await editor!.getByRole('button', { name: '撤销', exact: true }).click(); await expect(editor!.getByLabel('第1行对白', { exact: true })).toHaveValue(originalText);
  });
  await check('新版通用参数选择和工具读取无工程改动', async () => {
    await editor!.locator('[data-workspace-tab="variables"]').click(); await editor!.locator(`[data-parameter-set-id="${setId}"]`).click();
    await editor!.locator(`[data-parameter-id="${variableId}"]`).click(); await expect(editor!.getByLabel('初始值', { exact: true })).toHaveValue('7');
    await expectReference('参数集：验收通用参数 · 验收计数');
    await send('验收读取参数'); await complete(); await expect(assistant!.getByRole('region', { name: 'AI 创作方案', exact: true }).last()).toContainText('没有实际修改，无需应用');
  });
  await check('新版蓝图节点选择及真实节点模板读取', async () => {
    await editor!.locator('[data-workspace-tab="blueprint"]').click(); await editor!.getByLabel('蓝图资源', { exact: true }).selectOption('graph:' + graph.id);
    await fitBlueprintCanvas(editor!); await editor!.locator(`.react-flow__node[data-id="${readNode.id}"] .graph-node-title`).click();
    await expectReference('蓝图：验收节点蓝图 · 验收读取节点'); await send('验收读取节点'); await complete();
    await expect(assistant!.locator('.ai-message.assistant').last()).toContainText('已读取当前blueprint');
  });
  await check('新版独立UI组件选择和工具读取兼容', async () => {
    await editor!.locator('[data-workspace-tab="ui"]').click(); await editor!.locator(`[data-hierarchy-id="${componentId}"]`).click();
    await expect(editor!.getByLabel('控件显示名称', { exact: true })).toHaveValue('验收文字控件');
    await expectReference('控件：验收文字控件'); await send('验收读取组件'); await complete();
    await expect(assistant!.locator('.ai-message.assistant').last()).toContainText('已读取当前component'); await capture('modern-editor-context');
  });
  await check('流式期间实际打开乙工程隔离并保留甲的停止文字草稿', async () => {
    await editor!.locator('[data-workspace-tab="script"]').click();
    await expect(editor!.getByLabel('第1行对白', { exact: true })).toHaveValue(originalText); assert.equal((await snapshot()).width, projectA.width);
    await editor!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(editor!.locator('.dirty-dot')).toHaveCount(0);
    const savedProject = projectSchema.parse(JSON.parse(await fs.readFile(projectAFile, 'utf8'))); assert.equal(aiLines(savedProject)[0].line.text, originalText); assert.equal(savedProject.width, projectA.width);
    await newConversation('chat'); await send('验收切换工程');
    await expect(assistant!.locator('.ai-message.assistant').last()).toContainText('工程甲停止前'); await assistant!.getByLabel('发给 AI 的内容', { exact: true }).fill('甲工程切换前的草稿');
    await gateFlags({ nextOpenFiles: [projectBFile] }); await editor!.getByRole('button', { name: '打开工程', exact: true }).click();
    await expect(editor!.locator('.project-title strong')).toHaveText(projectB.name); await expectReference(projectB.name);
    await expect(assistant!.locator('.ai-message')).toHaveCount(0); await expect(assistant!.getByLabel('发给 AI 的内容', { exact: true })).toHaveValue('');
    await expect.poll(() => cancelledStreams.some(question => question.includes('切换工程'))).toBe(true);
    await expect(editor!.locator('.dirty-dot')).toHaveCount(0); await gateFlags({ nextOpenFiles: [projectAFile] }); await editor!.getByRole('button', { name: '打开工程', exact: true }).click();
    await expect(editor!.locator('.project-title strong')).toHaveText(projectA.name); await expect(assistant!.getByLabel('发给 AI 的内容', { exact: true })).toHaveValue('甲工程切换前的草稿');
    await expect(assistant!.locator('.ai-message.assistant').last()).toContainText('已停止'); await expect(assistant!.locator('.ai-message.assistant').last()).toContainText('工程甲停止前');
  });
  await check('停止试玩回复暂停期间新建历史选择发送重发不改变源会话', async () => {
    await newConversation('edit'); await send('验收停止试玩：核对当前工程后停止试玩'); await complete();
    await expect(chatButton('停止试玩')).toBeEnabled(); await expect.poll(async () => (await currentConversation())?.messages.length).toBe(2);
    const source = (await currentConversation())!, counts = await nativeCounts(); await gateFlags({ holdPreviewStop: true }); await chatButton('停止试玩').click();
    await expect.poll(async () => (await nativeCounts()).heldPreviewStop).toBe(true); await expect(assistant!.locator('.ai-message.assistant').last()).toContainText('正在处理');
    await showHistory(); await chatButton('新建会话').click(); await assistant!.getByRole('navigation', { name: '历史会话列表', exact: true }).getByRole('button', { name: /本轮流式与附件/ }).click();
    await assistant!.getByLabel('发给 AI 的内容', { exact: true }).fill('停止试玩期间不能发送的新请求'); await chatButton('发送').click();
    await assistant!.locator('.ai-message.user').last().getByRole('button', { name: '编辑后重发', exact: true }).click(); await chatButton('发送').click(); await settleRenderer();
    assert.equal((await nativeCounts()).requests, counts.requests); assert.equal((await currentConversation())!.id, source.id);
    await expect(assistant!.locator('.ai-message')).toHaveCount(2); assert.deepEqual((await currentConversation())!.messages.map(message => message.id), source.messages.map(message => message.id));
    assert.deepEqual(commandResults((await currentConversation())!), []);
    await releaseGate('previewStop'); await expect.poll(async () => (await nativeCounts()).previewStopResponses).toBe(counts.previewStopResponses + 1);
    await expect(assistant!.locator('.ai-message.assistant').last()).toContainText('停止试玩 · 已完成');
    await expect.poll(async () => commandResults((await currentConversation())!).length).toBe(1);
    const saved = (await currentConversation())!; assert.equal(saved.id, source.id); assert.deepEqual(commandResults(saved), [{ command: 'stopPreview', result: { status: 'completed', message: '试玩已停止。' } }]);
    await fs.writeFile(path.join(evidence, 'stop-preview-source.json'), JSON.stringify(saved, null, 2));
  });
  await check('停止试玩晚到结果只写源工程不污染相同消息编号分支', async () => {
    await editor!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(editor!.locator('.dirty-dot')).toHaveCount(0);
    await newConversation('edit'); await send('验收停止试玩：强制切换工程后核对结果归属'); await complete();
    await expect.poll(async () => (await currentConversation())?.messages.length).toBe(2); const source = (await currentConversation())!;
    const branch = { ...source, id: 'review_branch_' + randomUUID().slice(0, 8), projectId: projectB.id, title: '相同消息编号分支', draft: '乙工程分支草稿' };
    await assistant!.evaluate(branch => window.studio!.saveAiConversation!(branch), branch);
    const responses = (await nativeCounts()).previewStopResponses; await gateFlags({ holdPreviewStop: true }); await chatButton('停止试玩').click();
    await expect.poll(async () => (await nativeCounts()).heldPreviewStop).toBe(true);
    await gateFlags({ nextOpenFiles: [projectBFile] }); await editor!.getByRole('button', { name: '打开工程', exact: true }).click();
    await expect(editor!.locator('.project-title strong')).toHaveText(projectB.name); await expect(assistant!.getByLabel('发给 AI 的内容', { exact: true })).toHaveValue(branch.draft);
    await expect.poll(async () => (await currentConversation())?.id).toBe(branch.id); await releaseGate('previewStop');
    await expect.poll(async () => (await nativeCounts()).previewStopResponses).toBe(responses + 1);
    await expect.poll(async () => commandResults(await readConversation(projectA.id, source.id)).length).toBe(1); await settleRenderer();
    const savedBranch = (await currentConversation())!; assert.equal(savedBranch.id, branch.id); assert.equal(savedBranch.draft, branch.draft); assert.deepEqual(savedBranch.messages, branch.messages);
    assert.deepEqual(commandResults(savedBranch), []); await expect(assistant!.locator('.ai-message.assistant').last()).not.toContainText('停止试玩 · 已完成');
    await expect(editor!.locator('.dirty-dot')).toHaveCount(0); await gateFlags({ nextOpenFiles: [projectAFile] }); await editor!.getByRole('button', { name: '打开工程', exact: true }).click();
    await expect(editor!.locator('.project-title strong')).toHaveText(projectA.name); await expect.poll(async () => (await currentConversation())?.id).toBe(source.id);
    assert.deepEqual(commandResults((await currentConversation())!), [{ command: 'stopPreview', result: { status: 'completed', message: '试玩已停止。' } }]);
    await fs.writeFile(path.join(evidence, 'stop-preview-branch.json'), JSON.stringify(savedBranch, null, 2));
  });
  let capacitySource: AiConversation, capacityHistory: string | null;
  const capacityDraft = '容量失败时需要备份的草稿';
  await check('容量保存失败取消备份仍保留记录草稿及会话编号', async () => {
    await newConversation('chat'); await send('验收容量恢复前的聊天'); await complete();
    await expect.poll(async () => (await currentConversation())?.messages.length).toBe(2); capacitySource = (await currentConversation())!;
    capacityHistory = await assistant!.locator('.ai-conversation').textContent();
    await gateFlags({ rejectConversationId: capacitySource.id }); await assistant!.getByLabel('发给 AI 的内容', { exact: true }).fill(capacityDraft);
    await expect(assistant!.locator('.ai-compose [role="alert"]')).toContainText('保存上限'); await expect.poll(async () => (await nativeCounts()).rejections).toBeGreaterThan(0);
    const dialogs = (await nativeCounts()).saveDialogs.length; await gateFlags({ nextSaveCancelled: true }); await chatButton('导出并新建会话').click();
    await expect.poll(async () => (await nativeCounts()).saveDialogs.length).toBe(dialogs + 1); await settleRenderer(); await expect(chatButton('导出并新建会话')).toBeEnabled();
    assert.deepEqual((await nativeCounts()).saveDialogs.at(-1), { title: '备份聊天记录和草稿', canceled: true });
    await assertRecoverySource(capacitySource, capacityDraft, capacityHistory);
  });
  await check('容量备份写入已有目录失败仍保留完整会话', async () => {
    const target = path.join(evidence, 'backup-existing-target.json'); await fs.mkdir(target); await fs.writeFile(path.join(target, 'existing.txt'), '本轮既有目标，写入失败也必须保留。');
    const dialogs = (await nativeCounts()).saveDialogs.length; await gateFlags({ nextSaveFile: target }); await chatButton('导出并新建会话').click();
    await expect.poll(async () => (await nativeCounts()).saveDialogs.length).toBe(dialogs + 1);
    await expect(assistant!.locator('.ai-compose > p[role="alert"]')).toContainText(/EPERM|EISDIR|EACCES|directory|rename/i);
    await expect(chatButton('导出并新建会话')).toBeEnabled(); await assertRecoverySource(capacitySource, capacityDraft, capacityHistory);
    assert.equal(await fs.readFile(path.join(target, 'existing.txt'), 'utf8'), '本轮既有目标，写入失败也必须保留。');
    assert.deepEqual(await fs.readdir(target), ['existing.txt']); assert.ok(!(await fs.readdir(evidence)).some(file => file.endsWith('.tmp')));
  });
  await check('容量保存失败可完整备份并创建已保存新会话', async () => {
    const backup = path.join(evidence, 'capacity-conversation-backup.json'); await gateFlags({ nextSaveFile: backup }); await chatButton('导出并新建会话').click();
    await expect(assistant!.locator('.ai-message')).toHaveCount(0); await expect(assistant!.getByLabel('发给 AI 的内容', { exact: true })).toHaveValue('');
    const saved = JSON.parse(await fs.readFile(backup, 'utf8')) as AiConversation; assert.equal(saved.id, capacitySource.id); assert.equal(saved.draft, capacityDraft); assert.deepEqual(saved.messages, capacitySource.messages);
    await expect.poll(async () => { const saved = await currentConversation(); return !!saved && saved.id !== capacitySource.id; }).toBe(true);
    const next = (await currentConversation())!; assert.equal(next.messages.length, 0); await gateFlags({ rejectConversationId: undefined });
  });
  await check('工程保存进行中拒绝原生关闭且仍完成原保存', async () => {
    await editor!.getByLabel('第1行对白', { exact: true }).fill('保存进行中不能关闭，但这句应正常保存。');
    const counts = await nativeCounts(), child = app!.process(); await gateFlags({ holdProjectSave: true });
    await editor!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect.poll(async () => (await nativeCounts()).heldProjectSave).toBe(true);
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().endsWith('#ai-assistant'))!.close());
    await expect.poll(async () => (await nativeCounts()).closeSaveResponses).toBe(counts.closeSaveResponses + 1);
    await expect(editor!.locator('.status-message')).toContainText('正在保存工程');
    assert.equal((await nativeCounts()).closeSaveInputs.at(-1)?.allowed, false); assert.equal((await nativeCounts()).closeSaveInputs.at(-1)?.projectId, undefined); assert.equal(child.exitCode, null); assert.equal(child.signalCode, null);
    assert.equal((await nativeCounts()).heldProjectSave, true); assert.equal((await nativeCounts()).messageBoxes.length, counts.messageBoxes.length);
    await expect(editor!.locator('.app-shell')).not.toHaveAttribute('inert', '');
    await releaseGate('projectSave'); await expect(editor!.getByRole('button', { name: '保存工程', exact: true })).toBeEnabled(); await expect(editor!.locator('.dirty-dot')).toHaveCount(0);
    assert.equal(aiLines(projectSchema.parse(JSON.parse(await fs.readFile(projectAFile, 'utf8'))))[0].line.text, '保存进行中不能关闭，但这句应正常保存。');
    await editor!.getByLabel('第1行对白', { exact: true }).fill(originalText); await editor!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(editor!.locator('.dirty-dot')).toHaveCount(0);
  });
  await check('素材导入进行中拒绝原生关闭且导入仍可完成', async () => {
    await editor!.locator('[data-workspace-tab="assets"]').click(); const before = await snapshot(), counts = await nativeCounts(), child = app!.process();
    await gateFlags({ holdImport: true, nextOpenFiles: [importFile] }); await editor!.getByRole('button', { name: '导入素材', exact: true }).click();
    await expect.poll(async () => (await nativeCounts()).heldImport).toBe(true);
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().endsWith('#ai-assistant'))!.close());
    await expect.poll(async () => (await nativeCounts()).closeSaveResponses).toBe(counts.closeSaveResponses + 1);
    await expect(editor!.locator('.status-message')).toContainText('正在导入素材');
    assert.equal((await nativeCounts()).closeSaveInputs.at(-1)?.allowed, false); assert.equal((await nativeCounts()).closeSaveInputs.at(-1)?.projectId, undefined); assert.equal(child.exitCode, null); assert.equal(child.signalCode, null);
    assert.equal((await nativeCounts()).heldImport, true); assert.equal((await nativeCounts()).messageBoxes.length, counts.messageBoxes.length);
    await releaseGate('import'); await expect(editor!.getByRole('button', { name: '导入素材', exact: true })).toBeEnabled();
    await expect.poll(async () => (await snapshot()).assets.length).toBe(before.assets.length + 1); assert.ok((await snapshot()).assets.some(asset => asset.name === '验收保存导入'));
    await editor!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(editor!.locator('.dirty-dot')).toHaveCount(0);
    await editor!.locator('[data-workspace-tab="script"]').click(); await expect(editor!.getByLabel('第1行对白', { exact: true })).toHaveValue(originalText);
  });
  await check('主关闭等待阻止修改、取消恢复延迟扫描素材和停止会话备份', async () => {
    await assistant!.getByLabel('AI 对话模式', { exact: true }).selectOption('chat'); await send('验收窗口关闭失败');
    await expect(assistant!.locator('.ai-message.assistant').last()).toContainText('主窗口关闭前');
    await expect.poll(async () => (await currentConversation())?.messages.length).toBe(1); const source = (await currentConversation())!;
    const before = await nativeCounts(), draft = '主窗口保存失败仍需保留的最新草稿';
    await editor!.getByRole('button', { name: '作品设置', exact: true }).click(); await expect(editor!.getByLabel('作品名称', { exact: true })).toHaveValue(projectA.name);
    const discoveryName = '验收关闭延迟扫描_' + randomUUID().slice(0, 8), discoveryTarget = path.join(fixtureA, 'assets', discoveryName + '.png');
    await fs.mkdir(path.dirname(discoveryTarget), { recursive: true }); await gateFlags({ holdDiscoveryName: discoveryName }); await fs.copyFile(discoveryInputFile, discoveryTarget);
    await editor!.evaluate(() => window.dispatchEvent(new Event('focus'))); await expect.poll(async () => (await nativeCounts()).heldDiscovery).toBe(true);
    assert.ok((await nativeCounts()).heldDiscoveryAssetNames.includes(discoveryName)); assert.ok(!(await snapshot()).assets.some(asset => asset.name === discoveryName));
    await gateFlags({ holdConversationId: source.id }); await assistant!.getByLabel('发给 AI 的内容', { exact: true }).fill(draft);
    const child = app!.process(); await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().endsWith('#ai-assistant'))!.close());
    await expect.poll(async () => (await nativeCounts()).heldConversation).toBe(true);
    assert.equal((await nativeCounts()).closeSaveInputs.at(-1)?.allowed, true);
    await expect(editor!.locator('.app-shell')).toHaveAttribute('inert', ''); await expect(assistant!.getByLabel('发给 AI 的内容', { exact: true })).toBeDisabled();
    await expect(editor!.locator('.status-message')).toContainText('正在保存并关闭窗口…');
    const frozen = await snapshot();
    const discoveryResponses = (await nativeCounts()).discoveryResponses; await releaseGate('discovery');
    await expect.poll(async () => (await nativeCounts()).discoveryResponses).toBe(discoveryResponses + 1);
    await editor!.evaluate(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }); await settleRenderer();
    assert.equal((await snapshot()).assets.length, frozen.assets.length); assert.ok(!(await snapshot()).assets.some(asset => asset.name === discoveryName));
    const blockedEvents = await editor!.evaluate(() => {
      const field = document.querySelector('.project-settings-dialog input') as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, '关闭等待期不能写入作品名称');
      const inputAllowed = field.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: '关闭等待期不能写入作品名称' }));
      const keyAllowed = window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true }));
      const save = [...document.querySelectorAll<HTMLButtonElement>('.app-header button')].find(button => button.title === '保存工程')!;
      const clickAllowed = save.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return { inputAllowed, keyAllowed, clickAllowed };
    });
    assert.deepEqual(blockedEvents, { inputAllowed: false, keyAllowed: false, clickAllowed: false });
    const changes = prepareAiChanges(frozen, [{ kind: 'replaceText', lineId, text: '关闭等待期不能应用这句台词。' }], [lineId]);
    const rejectedAction = await assistant!.evaluate(async serializedChanges => {
      const changes = JSON.parse(serializedChanges) as AiChange[];
      const context = (await window.studio!.getAiContext!())!;
      try { await window.studio!.runAiEditorAction!({ projectId: context.project.id, kind: 'apply', changes }); return ''; }
      catch (error) { return String(error); }
    }, JSON.stringify(changes));
    assert.ok(rejectedAction.includes('主编辑器正在关闭，请等待关闭完成或取消后再试。')); report.closeWaitRejectedAction = rejectedAction; await settleRenderer();
    assert.equal((await snapshot()).name, frozen.name); assert.equal(aiLines(await snapshot())[0].line.text, aiLines(frozen)[0].line.text);
    assert.equal((await nativeCounts()).projectSaveCalls, before.projectSaveCalls); assert.equal((await nativeCounts()).requests, before.requests);
    await gateFlags({ rejectConversationId: source.id }); await releaseGate('conversation');
    await expect.poll(async () => (await nativeCounts()).messageBoxes.length).toBe(before.messageBoxes.length + 1);
    assert.equal(child.exitCode, null); assert.equal(child.signalCode, null); assert.equal(editor!.isClosed(), false); assert.equal(assistant!.isClosed(), false);
    assert.equal(await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 2);
    assert.match((await nativeCounts()).messageBoxes.at(-1)!.message, /保存上限/); assert.equal((await nativeCounts()).messageBoxes.at(-1)!.title, '未能完成关闭');
    await complete(); await expect(assistant!.getByLabel('发给 AI 的内容', { exact: true })).toHaveValue(draft);
    await expect(editor!.locator('.app-shell')).not.toHaveAttribute('inert', '');
    await expect.poll(async () => (await snapshot()).assets.filter(asset => asset.name === discoveryName).length).toBe(1); await expect(editor!.locator('.dirty-dot')).toHaveCount(1);
    assert.equal((await snapshot()).assets.length, frozen.assets.length + 1);
    await editor!.getByLabel('作品名称', { exact: true }).fill('关闭取消后可以继续编辑'); await expect.poll(async () => (await snapshot()).name).toBe('关闭取消后可以继续编辑');
    await editor!.getByLabel('作品名称', { exact: true }).fill(projectA.name); await editor!.getByRole('button', { name: '完成', exact: true }).click();
    await editor!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(editor!.locator('.dirty-dot')).toHaveCount(0);
    const savedProject = projectSchema.parse(JSON.parse(await fs.readFile(projectAFile, 'utf8'))); assert.equal(savedProject.assets.filter(asset => asset.name === discoveryName).length, 1);
    report.closeCancelledDiscovery = { name: discoveryName, heldNames: (await nativeCounts()).heldDiscoveryAssetNames, saved: true };
    await expect(assistant!.locator('.ai-message.assistant').last()).toContainText('已停止'); await expect(assistant!.locator('.ai-message.assistant').last()).toContainText('主窗口关闭前');
    await expect.poll(() => cancelledStreams.includes('验收窗口关闭失败')).toBe(true);
    await expect(chatButton('导出并新建会话')).toBeEnabled(); const backup = path.join(evidence, 'close-failure-conversation-backup.json');
    await capture('main-close-save-failed'); await gateFlags({ nextSaveFile: backup }); await chatButton('导出并新建会话').click();
    await expect(assistant!.locator('.ai-message')).toHaveCount(0); const saved = JSON.parse(await fs.readFile(backup, 'utf8')) as AiConversation;
    assert.equal(saved.id, source.id); assert.equal(saved.draft, draft); assert.equal(saved.messages.length, 2);
    assert.equal(saved.messages[0].content, '验收窗口关闭失败'); assert.equal(saved.messages[0].id, source.messages[0].id);
    assert.equal(saved.messages[1].status, 'stopped'); assert.ok(saved.messages[1].content.includes('主窗口关闭前'));
    await expect.poll(async () => { const saved = await currentConversation(); return !!saved && saved.id !== source.id; }).toBe(true); await gateFlags({ rejectConversationId: undefined });
  });
  await check('自然关闭主窗口确认流式停止和草稿落盘再退出', async () => {
    await assistant!.getByLabel('AI 对话模式', { exact: true }).selectOption('chat'); await send('验收窗口关闭');
    await expect(assistant!.locator('.ai-message.assistant').last()).toContainText('主窗口关闭前');
    await expect.poll(async () => (await currentConversation())?.messages.length).toBe(1); streamingSessionId = (await currentConversation())!.id;
    await capture('before-native-main-close'); await fs.copyFile(projectAFile, path.join(evidence, 'final-project-a.json'));
    assert.deepEqual((await nativeCounts()).blocked, []); report.nativePhase1 = await nativeCounts(); await stopTrace();
    // Restore fixture IPC wrappers before exercising production close-save and
    // the assistant close ACK; do not use Playwright app.close() for this check.
    await app!.evaluate(() => ((globalThis as any).__aiReviewGate as NativeGate).restore());
    const child = app!.process();
    // The new draft is filled immediately before the native close request,
    // without waiting for the 200ms debounced conversation autosave.
    await assistant!.getByLabel('发给 AI 的内容', { exact: true }).fill(nextDraft);
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().endsWith('#ai-assistant'))!.close());
    await expect.poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 30000 }).toBe(true);
    assert.equal(child.exitCode, 0); assert.equal(child.signalCode, null);
    const record = processes.find(item => item.pid === child.pid)!; Object.assign(record, { exited: true, code: child.exitCode, signal: child.signalCode });
    app = undefined; editor = undefined; assistant = undefined;
    const file = path.join(profile, 'ai-conversations', projectA.id, streamingSessionId + '.json'); const saved = JSON.parse(await fs.readFile(file, 'utf8')) as AiConversation;
    assert.equal(saved.draft, nextDraft); assert.equal(saved.messages.at(-1)!.status, 'stopped'); assert.ok(saved.messages.at(-1)!.content.includes('主窗口关闭前'));
    await fs.copyFile(file, path.join(evidence, 'native-close-conversation.json'));
  });
  await check('同profile完整重启恢复会话并可重新配置继续聊天', async () => {
    await launch(); await openAssistant(); await expect(assistant!.getByLabel('发给 AI 的内容', { exact: true })).toHaveValue(nextDraft);
    await expect(assistant!.locator('.ai-message.assistant').last()).toContainText('已停止'); await expect(assistant!.locator('.ai-message.assistant').last()).toContainText('主窗口关闭前');
    await expect.poll(async () => (await currentConversation())?.id).toBe(streamingSessionId); await expect(assistant!.getByLabel('AI 对话模式', { exact: true })).toHaveValue('chat');
    await chatButton('AI 服务设置').click(); await assistant!.getByLabel('AI API 密钥', { exact: true }).fill(secret); await chatButton('保存 AI 配置').click();
    await expect(assistant!.getByRole('status')).toContainText('AI 配置已保存'); await chatButton('返回助手').click(); await send('重启后继续聊天'); await complete();
    await expect(assistant!.locator('.ai-message.assistant').last()).toContainText('示例对白'); await capture('reopened-session');
    assert.deepEqual((await nativeCounts()).blocked, []); assert.deepEqual(errors, []);
    const closingAssistant = assistant!;
    const closed = closingAssistant.waitForEvent('close');
    await chatButton('关闭 AI 助手').click().catch(error => { if (!closingAssistant.isClosed()) throw error; });
    await closed; assert.equal(editor!.isClosed(), false); assistant = undefined;
  });
  assert.equal(checks.length, report.expectedChecks, '旧31组加真实重试退避停止重发1组均须完成。');
  report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.error = String(error); await capture('failure').catch(captureError => { report.captureError = String(captureError); });
} finally {
  try { await closeOwned(); } catch (error) { failure ??= error; report.status = 'failed'; report.closeError = String(error); }
  for (const response of heldStreams) response.destroy(); mock.closeAllConnections();
  if (mock.listening) await new Promise<void>(resolve => mock.close(() => resolve()));
  if (outputPrepared) {
    await persist();
    if (!app && processes.every(item => item.exited)) {
      try { report.cleanup = await cleanVerificationDirectories(output, ['fixture-a', 'fixture-b', 'profile', 'startup-profile', 'inputs']); assert.deepEqual(report.cleanup.errors, []); }
      catch (error) { failure ??= error; report.status = 'failed'; report.cleanupError = String(error); }
    } else { report.cleanupSkipped = '自有 Electron 进程未确认退出，保留临时目录。'; }
    await persist();
  }
  console.log(output);
}
if (failure) { console.error(failure); process.exitCode = 1; }
