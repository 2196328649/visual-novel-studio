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
const output = path.join(root, 'artifacts/ai-repair-editor', new Date().toISOString().replaceAll(':', '-'));
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
  const structure = data.messages.some((message: any) => message.role === 'user' && message.content.startsWith('用户请求：工程结构测试'));
  if (structure && !data.messages.some((message:any)=>message.role==='user'&&message.content.startsWith('编辑器校验未通过'))) {reply(JSON.stringify({message:'无效尺寸',operations:[{kind:'editProject',path:['width'],action:'set',value:-1}]}));return;}
  if (structure && !raw.startsWith('以下为只读工程数据')) { reply(JSON.stringify({read:[{kind:'schema',field:'ui'},{kind:'blueprintNode',type:'getVariable'},{kind:'project',path:['parameterSets']}],operations:[]})); return; }
  if (structure) { const results=JSON.parse(raw.slice(raw.indexOf('\n')+1)); expect(results[0].result.schema).toBeTruthy();expect(results[1].result.template.type).toBe('getVariable');expect(results[2].error).toContain('路径不存在'); }
  let content = '连接成功。';
  if (structure) content = JSON.stringify({ message: '准备修改 UI 和参数集。', operations: [
    { kind: 'editProject', path: ['ui', 'components'], action: 'append', value: { id: 'ai_title_test', kind: 'text', page: 'main', text: 'AI 标题', x: 0.2, y: 0.1, width: 0.5, height: 0.1 } },
    { kind: 'editProject', path: ['parameterSets'], action: 'set', value: [{ id: 'ai_settings_test', name: '界面参数', kind: 'settings' }] },
    { kind: 'editProject', path: ['width'], action: 'set', value: 1600 }
  ] });
  else if (prompt.includes('无效表情') || prompt.includes('搭配表情')) content = JSON.stringify({ message: '担忧适合这句关心对方的话。', operations: [{ kind: 'setExpression', lineId: 'ai_test_first', expressionId: prompt.includes('无效表情') ? 'missing' : 'worried' }] });
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

  phase = 'project structure proposals';
  await ask('工程结构测试：修改 UI 和参数集'); await waitAnswer('准备修改 UI');
  await proposal().getByRole('button', { name: '应用选中的 3 项修改', exact: true }).click();
  await expect(proposal()).toContainText('已应用修改');
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  const saved = JSON.parse(await fs.readFile(projectFile, 'utf8')) as Project;
  expect(saved.ui.components.find(c => c.id === 'ai_title_test')?.text).toBe('AI 标题');
  expect(saved.parameterSets?.[0].name).toBe('界面参数'); expect(saved.width).toBe(1600);
  await page!.getByRole('button', { name: '撤销', exact: true }).click();
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  const undone = JSON.parse(await fs.readFile(projectFile, 'utf8')) as Project;
  expect(undone.ui.components.some(c => c.id === 'ai_title_test')).toBe(false); expect(undone.width).toBe(project.width);
  await assistant!.screenshot({ path: path.join(output, 'proposal.png') });
  expect(calls.some(call=>call.messages.some(message=>message.role==='user'&&message.content.startsWith('编辑器校验未通过')))).toBe(true);
  checks.push('模拟服务先返回非法尺寸，收到真实校验错误后读取UI Schema与节点模板，再提交完整UI／参数集／尺寸方案，经独立窗口审阅、应用、保存和整批撤销。');
  expect(errors).toEqual([]);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, externalApiCalled: false, errors }, null, 2));
  console.log(output);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure-editor.png') }).catch(() => {});
  await assistant?.screenshot({ path: path.join(output, 'failure-assistant.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, errors, error: String(error) }, null, 2));
  console.error(error); console.log(output); process.exitCode = 1;
} finally { await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => undefined); await app?.close(); await server.close(); mock.closeAllConnections(); mock.close(); }
