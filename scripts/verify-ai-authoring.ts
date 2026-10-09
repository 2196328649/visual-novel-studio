import { defaultShowCharacter } from '../src/core/character-presets';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, type Project } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), require = createRequire(import.meta.url);
const output = path.join(root, 'artifacts/ai-authoring', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json'), profile = path.join(output, 'profile');
const project = createProject('AI 独立窗口与连续对话验证');
project.characters = [{ id: 'su', name: '苏怜烟', color: '#ddaaaa', defaultExpressionId: 'normal', expressions: [{ id: 'normal', name: '通常', assetId: 'portrait' }, { id: 'worried', name: '担忧', assetId: 'portrait' }] }];
project.assets = [{ id: 'portrait', name: '验证用立绘', kind: 'image', category: 'portrait', path: 'assets/portrait.png', width: 1, height: 1 }];
await fs.mkdir(path.join(path.dirname(projectFile), 'assets'), { recursive: true });
await fs.writeFile(path.join(path.dirname(projectFile), 'assets/portrait.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1cAAAAASUVORK5CYII=', 'base64'));
const passage = project.nodes.find(node => node.kind === 'passage')!;
passage.lines = [{ id: 'ai_test_first', speakerId: 'su', text: '你没有受伤吧？', actions: [] }, { id: 'ai_test_narration', text: '雨停了。', actions: [] }];
await saveProject(projectFile, project);

let stoppedRequests = 0, cancelledResponses = 0, modelRequests = 0, modelsStatus = 200, delayedRequests = 0;
let finishDelayed: (() => void) | undefined;
const calls: { messages: { role: string; content: string }[]; model: string; response_format?: unknown }[] = [];
const mock = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/v1/models') {
    modelRequests++;
    response.writeHead(modelsStatus, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(modelsStatus === 200 ? { data: [{ id: 'local-other' }, { id: 'local-mock' }, { id: 'local-mock' }] } : { error: { message: 'This service does not support model discovery.' } }));
    return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') { response.writeHead(404); response.end(); return; }
  let bytes = ''; for await (const chunk of request) bytes += chunk;
  const data = JSON.parse(bytes), raw = String(data.messages.at(-1).content), prompt = raw.split('\n以下JSON')[0];
  calls.push(data);
  const reply = (content: string) => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] })); };
  if (prompt.includes('停止测试')) { stoppedRequests++; response.once('close', () => { if (!response.writableEnded) cancelledResponses++; }); return; }
  if (prompt.includes('等待期间编辑')) { delayedRequests++; finishDelayed = () => reply(JSON.stringify({ message: '这是根据发送时内容生成的建议。', operations: [{ kind: 'replaceText', lineId: 'ai_test_first', text: 'AI 的过期建议' }] })); return; }
  let content = '连接成功。';
  if (prompt.includes('无效表情') || prompt.includes('搭配表情')) content = JSON.stringify({ message: '担忧适合这句关心对方的话。', operations: [{ kind: 'setExpression', lineId: 'ai_test_first', expressionId: prompt.includes('无效表情') ? 'missing' : 'worried' }] });
  else if (prompt.includes('精简')) content = JSON.stringify({ message: '建议精简台词，并在之前等待半秒。', operations: [{ kind: 'replaceText', lineId: 'ai_test_first', text: '你还好吗？' }, { kind: 'addAction', lineId: 'ai_test_first', action: { kind: 'pause', seconds: 0.5 } }] });
  else if (prompt.includes('检查当前台词') || prompt.includes('检查文本草稿')) {
    const context = JSON.parse(raw.slice(raw.indexOf('台词范围：\n') + '台词范围：\n'.length));
    content = JSON.stringify({ message: `当前内容：${context.lines.map((line: { text: string }) => line.text).join(' / ')}`, operations: [] });
  } else if (prompt.includes('继续解释')) content = JSON.stringify({ message: '担忧对应角色已有的表情；刚才的建议仍可在上方审阅。', operations: [] });
  else if (prompt.includes('如何封装')) content = '选中完整的 @ 演出，右键选择「封装选中演出为蓝图…」，再设置名称、分组和输入默认值。';
  reply(content);
});
mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
const apiRoot = `http://127.0.0.1:${(mock.address() as { port: number }).port}/v1`;
const server = await createViteServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } }); await server.listen();
const env = Object.fromEntries(Object.entries({ ...process.env, VNS_PROJECT_PATH: projectFile, VNS_USER_DATA: profile, VNS_TEST_ROOT: path.join(output, 'created-projects'), VNS_DEV_URL: `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}` }).filter((entry): entry is [string, string] => entry[1] !== undefined)); delete env.ELECTRON_RUN_AS_NODE;
let app: ElectronApplication | undefined, page: Page | undefined, assistant: Page | undefined, phase = 'launch';
const checks: string[] = [], errors: string[] = [];
const launch = async () => {
  app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env, timeout: 60000 });
  app.on('window', window => window.on('pageerror', error => errors.push(error.message)));
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1450, 940));
};
const openAssistant = async () => {
  const opened = app!.waitForEvent('window');
  await page!.getByRole('button', { name: 'AI 助手', exact: true }).click();
  assistant = await opened;
  await expect(assistant.locator('.ai-assistant-window')).toBeVisible();
};
const ask = async (prompt: string) => {
  await assistant!.getByLabel('发给 AI 的内容', { exact: true }).fill(prompt);
  await assistant!.getByRole('button', { name: '发送', exact: true }).click();
};
const waitAnswer = async (text: string) => {
  await expect(assistant!.locator('.ai-message.assistant').last()).toContainText(text);
  await expect(assistant!.getByRole('button', { name: '发送', exact: true })).toBeVisible();
};
const proposal = () => assistant!.locator('.ai-proposal').last();
try {
  await launch();
  phase = 'discover models from unsaved settings';
  await page!.getByRole('button', { name: '作品设置', exact: true }).click();
  await page!.getByRole('button', { name: 'AI 服务', exact: true }).click();
  await page!.getByLabel('API 地址', { exact: true }).fill(apiRoot);
  await page!.getByLabel('API 密钥', { exact: true }).fill('desktop-test-secret');
  await page!.getByRole('button', { name: '获取模型列表', exact: true }).click();
  await expect(page!.getByLabel('可用模型')).toBeVisible();
  expect(modelRequests).toBe(1);
  expect((await page!.evaluate(() => window.studio!.getAiConfig!())).model).toBe('');
  await expect(page!.getByLabel('可用模型').locator('option')).toHaveText(['选择模型（2 个）', 'local-mock', 'local-other']);
  await page!.getByLabel('可用模型').selectOption('local-mock');
  await expect(page!.getByLabel('模型名称', { exact: true })).toHaveValue('local-mock');
  await page!.getByRole('button', { name: '保存并测试连接', exact: true }).click();
  await expect(page!.getByText('连接成功，服务已返回有效回复。', { exact: true })).toBeVisible();
  const config = await page!.evaluate(() => window.studio!.getAiConfig!());
  expect(config.hasKey).toBe(true); expect(config.keyStorage).toBe('encrypted'); expect(JSON.stringify(config)).not.toContain('desktop-test-secret');
  expect(await fs.readFile(path.join(profile, 'ai-settings.json'), 'utf8')).not.toContain('desktop-test-secret');
  await page!.screenshot({ path: path.join(output, 'ai-settings.png') });
  await page!.getByRole('button', { name: '完成', exact: true }).click();
  checks.push('使用未保存地址与密钥获取模型，去重排序并填入模型名称；获取本身不保存配置，系统加密保存密钥。');

  phase = 'independent nonmodal window and live editor context';
  await openAssistant();
  await expect(page!.locator('.ai-assistant')).toHaveCount(0);
  await expect(assistant!.getByRole('button', { name: /^(问引擎|表情建议|编辑工程)$/ })).toHaveCount(0);
  const native = await app!.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#ai-assistant'))!; return { modal: window.isModal(), parent: !!window.getParentWindow(), resizable: window.isResizable() }; });
  expect(native).toEqual({ modal: false, parent: false, resizable: true });
  await page!.getByLabel('第2行对白', { exact: true }).fill('雨暂时停了。');
  await expect(assistant!.locator('.ai-current-line')).toContainText('雨暂时停了。');
  await assistant!.getByLabel('AI 处理范围').selectOption('line');
  await ask('检查当前台词'); await waitAnswer('雨暂时停了。');
  expect(calls.at(-1)!.messages.at(-1)!.content).toContain('雨暂时停了。');
  await page!.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page!.getByLabel('第2行对白', { exact: true })).toHaveValue('雨停了。');
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  await page!.getByLabel('第1行对白', { exact: true }).click();
  await expect(assistant!.locator('.ai-current-line')).toContainText('你没有受伤吧？');
  await assistant!.getByLabel('AI 处理范围').selectOption('scene');
  checks.push('AI 为无父窗口、非模态的独立可缩放窗口；主编辑器可继续编辑，当前台词与未保存内容实时进入对话范围。');

  phase = 'continuous conversation with retained proposals and shared undo';
  await ask('如何封装演出？'); await waitAnswer('右键选择');
  await ask('请为第一句搭配表情。'); await waitAnswer('担忧适合');
  await expect(proposal().getByRole('img', { name: '建议表情：担忧' })).toBeVisible();
  await expect.poll(() => proposal().locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  await ask('继续解释这个建议'); await waitAnswer('刚才的建议仍可');
  await expect(assistant!.locator('.ai-proposal')).toHaveCount(1);
  expect(calls.at(-1)!.messages.some(message => message.role === 'assistant' && message.content.includes('suggestedOperations'))).toBe(true);
  await proposal().getByRole('button', { name: '应用选中的 1 项修改', exact: true }).click();
  await expect(proposal().locator('header')).toContainText('已应用修改');
  await expect(page!.locator('.dirty-dot')).toHaveCount(1);
  await assistant!.getByRole('button', { name: '撤销工程修改', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  await ask('请重新为第一句搭配表情。'); await waitAnswer('担忧适合');
  await expect(assistant!.locator('.ai-proposal')).toHaveCount(2);
  await proposal().getByRole('button', { name: '应用选中的 1 项修改', exact: true }).click();
  await expect(proposal().locator('header')).toContainText('已应用修改');
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  const saved = JSON.parse(await fs.readFile(projectFile, 'utf8')) as Project;
  const savedLines = saved.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []);
  expect(savedLines.find(line => line.id === 'ai_test_first')!.actions).toEqual([defaultShowCharacter({ expressionId: 'worried' })]);
  expect(savedLines.find(line => line.id === 'ai_test_narration')!.actions).toEqual([]);
  expect(JSON.stringify(saved)).not.toContain('desktop-test-secret');
  await assistant!.screenshot({ path: path.join(output, 'assistant-conversation.png') });
  await page!.screenshot({ path: path.join(output, 'editor-with-assistant-open.png') });
  checks.push('同一对话中问用法、建议表情并追问，历史建议保留；图片可预览，应用确认后写入主工程，助手撤销恢复。');

  phase = 'selective edit, locate, duplicate open and main undo';
  await ask('精简第一句，并等待半秒。'); await waitAnswer('建议精简');
  await proposal().getByLabel('应用建议 2', { exact: true }).uncheck();
  await proposal().getByRole('button', { name: '应用选中的 1 项修改', exact: true }).click();
  await expect(page!.getByLabel('第1行对白', { exact: true })).toHaveValue('你还好吗？');
  await expect(page!.locator('.story-line').first()).not.toContainText('等待');
  await page!.getByLabel('第2行对白', { exact: true }).click();
  await expect(assistant!.locator('.ai-current-line')).toContainText('雨停了。');
  await proposal().getByRole('button', { name: '定位台词', exact: true }).first().click();
  await expect(assistant!.locator('.ai-current-line')).toContainText('你还好吗？');
  await page!.getByRole('button', { name: 'AI 助手', exact: true }).click();
  expect(app!.windows().length).toBe(2);
  await expect(assistant!.locator('.ai-assistant-window')).toBeVisible();
  await page!.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page!.getByLabel('第1行对白', { exact: true })).toHaveValue('你没有受伤吧？');
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  checks.push('只应用勾选项，主工具栏撤销与助手共用历史；定位保留助手，重复打开聚焦同一窗口。');

  phase = 'reject stale proposals after concurrent manual editing';
  await ask('等待期间编辑'); await expect.poll(() => delayedRequests).toBe(1);
  await page!.getByLabel('第1行对白', { exact: true }).fill('我刚刚手动改了这句。');
  await expect(assistant!.locator('.ai-current-line')).toContainText('我刚刚手动改了这句。');
  finishDelayed!(); await waitAnswer('发送时内容');
  await proposal().getByRole('button', { name: '应用选中的 1 项修改', exact: true }).click();
  await expect(assistant!.locator('.ai-compose [role="alert"]')).toContainText('已发生变化');
  await expect(proposal().locator('header')).toContainText('待应用修改');
  await expect(page!.getByLabel('第1行对白', { exact: true })).toHaveValue('我刚刚手动改了这句。');
  await page!.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  checks.push('生成期间可手动编辑；过期建议由主编辑器拒绝，助手显示原因且不误标为已应用。');

  phase = 'unsaved IDE text and invalid suggestions';
  await openStoryMode(page!, 'text');
  const text = page!.getByLabel('中文文本剧本', { exact: true }), source = await text.inputValue();
  await text.fill(source.replace('你没有受伤吧？', '这是尚未保存的文本草稿。'));
  await ask('检查文本草稿'); await waitAnswer('这是尚未保存的文本草稿。');
  await page!.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(text).toHaveValue(source);
  await openStoryMode(page!, 'script');
  await ask('无效表情');
  await expect(assistant!.locator('.ai-compose [role="alert"]')).toContainText('没有建议中的表情');
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  await ask('停止测试'); await expect.poll(() => stoppedRequests).toBe(1);
  await assistant!.getByRole('button', { name: '停止生成', exact: true }).click();
  await expect(assistant!.locator('.ai-compose [role="alert"]')).toContainText('已停止');
  await expect.poll(() => cancelledResponses).toBe(1);
  checks.push('文本编辑模式的未保存草稿也可提问；无效表情被拦截，请求可取消，均不改工程。');

  phase = 'model refresh, unsupported discovery and narrow layout';
  await page!.getByRole('button', { name: '作品设置', exact: true }).click();
  await page!.getByRole('button', { name: 'AI 服务', exact: true }).click();
  await page!.getByLabel('模型名称', { exact: true }).fill('local-other');
  await page!.getByRole('button', { name: '保存 AI 配置', exact: true }).click();
  await expect(page!.getByText('AI 配置已保存。', { exact: true })).toBeVisible();
  await page!.getByRole('button', { name: '完成', exact: true }).click();
  await assistant!.bringToFront();
  await expect(assistant!.locator('.ai-compose')).toContainText('模型：local-other');
  await assistant!.getByRole('button', { name: 'AI 服务设置', exact: true }).click();
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#ai-assistant'))!.setContentSize(440, 620));
  modelsStatus = 404;
  await assistant!.getByRole('button', { name: '获取模型列表', exact: true }).click();
  await expect(assistant!.getByRole('alert')).toContainText('404');
  await expect(assistant!.getByRole('alert')).toContainText('手动填写');
  await assistant!.getByLabel('模型名称', { exact: true }).fill('manual-model');
  await assistant!.getByRole('button', { name: '保存 AI 配置', exact: true }).click();
  await expect(assistant!.getByText('AI 配置已保存。', { exact: true })).toBeVisible();
  expect(await assistant!.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await assistant!.screenshot({ path: path.join(output, 'assistant-settings-narrow.png') });
  await assistant!.getByRole('button', { name: '返回助手', exact: true }).click();
  await expect(assistant!.locator('.ai-compose')).toContainText('模型：manual-model');
  await expect(assistant!.getByRole('button', { name: '发送', exact: true })).toBeVisible();
  expect(await assistant!.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await assistant!.screenshot({ path: path.join(output, 'assistant-narrow.png') });
  modelsStatus = 200;
  checks.push('主编辑器保存模型后助手自动刷新；不支持模型列表时可手填，440×620 窗口设置与对话可用。');

  phase = 'project switch cancels old requests and clears old proposals';
  await ask('停止测试'); await expect.poll(() => stoppedRequests).toBe(2);
  await page!.getByRole('button', { name: '新建工程', exact: true }).click();
  await page!.getByLabel('作品名称', { exact: true }).fill('另一个测试工程');
  await page!.getByRole('button', { name: '创建作品', exact: true }).click();
  await expect(page!.locator('.project-title strong')).toHaveText('另一个测试工程');
  await expect(assistant!.locator('.ai-workspace-context')).toContainText('另一个测试工程');
  await expect(assistant!.locator('.ai-message')).toHaveCount(0);
  await expect.poll(() => cancelledResponses).toBe(2);
  const staleActionError = await assistant!.evaluate(async oldId => {
    try { await window.studio!.runAiEditorAction!({ projectId: oldId, kind: 'undo' }); return ''; } catch (error) { return String(error); }
  }, project.id);
  expect(staleActionError).toContain('工程已切换');
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  checks.push('切换工程时取消旧请求、清空旧建议，并拒绝来自旧工程的修改操作。');

  phase = 'native close and restart preserve project and encrypted settings';
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#ai-assistant'))!.close());
  await expect.poll(() => app!.windows().length).toBe(1);
  await expect(page!.locator('.project-title strong')).toHaveText('另一个测试工程');
  await openAssistant();
  await assistant!.getByRole('button', { name: '关闭 AI 助手', exact: true }).click();
  await expect.poll(() => app!.windows().length).toBe(1);
  assistant = undefined;
  await app!.close(); app = undefined;
  await launch();
  expect((await page!.evaluate(() => window.studio!.getAiConfig!())).hasKey).toBe(true);
  expect((await page!.evaluate(() => window.studio!.getAiConfig!())).model).toBe('manual-model');
  await expect(page!.getByLabel('第1行对白', { exact: true })).toHaveValue('你没有受伤吧？');
  expect(await fs.readFile(projectFile, 'utf8')).not.toContain('desktop-test-secret');
  const reopened = JSON.parse(await fs.readFile(projectFile, 'utf8')) as Project;
  expect(reopened.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []).find(line => line.id === 'ai_test_first')!.actions).toEqual(savedLines[0].actions);
  checks.push('系统关闭按钮与助手关闭按钮只关闭助手；完整重启后工程表情、手填模型和加密密钥保留。');

  expect(errors).toEqual([]);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, requests: calls.length, modelRequests, errors, externalApiCalled: false, packaged: false, userProjectModified: false }, null, 2));
  console.log(`PASS: ${checks.length} checks. ${output}`);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure-editor.png') }).catch(() => {});
  await assistant?.screenshot({ path: path.join(output, 'failure-assistant.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, errors, error: String(error) }, null, 2));
  console.error(error); console.log(output); process.exitCode = 1;
} finally { await app?.close(); await server.close(); mock.closeAllConnections(); mock.close(); }
