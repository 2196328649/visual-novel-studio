import { expect, type CDPSession, type ElectronApplication, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { projectSchema, type Project } from '../src/core/model';
import { aiConfigSchema } from '../src/core/ai';
import { installedExecutable, launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.');
const baseline = process.argv.includes('--baseline');
const output = path.join(root, 'artifacts/release-authoring', new Date().toISOString().replaceAll(':', '-'));
const profile = path.join(output, 'profile'), projectFile = path.join(output, 'project/project.vns.json');
const templateDirectory = installedExecutable ? path.join(path.dirname(installedExecutable), 'resources/resources/templates/aihong') : path.join(root, 'resources/templates/aihong');
const template = projectSchema.parse(JSON.parse(await fs.readFile(path.join(templateDirectory, 'project.vns.json'), 'utf8')));
const name = '正式版模板与布局检查';
const checks: string[] = [], errors: string[] = [], metrics: Record<string, unknown> = {};
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch';
let credential = '';
await fs.mkdir(output, { recursive: true });
const sha256 = async (file: string) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const save = async (): Promise<Project> => {
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0, { timeout: 20_000 });
  return projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
};
const scriptObservers = new Map<Page, { urls: Set<string>; session: CDPSession }>();
const loadedScripts = async (window: Page) => {
  let observer = scriptObservers.get(window);
  if (!observer) {
    const urls = new Set<string>(), session = await window.context().newCDPSession(window);
    observer = { urls, session }; scriptObservers.set(window, observer);
    session.on('Debugger.scriptParsed', script => { if (script.url.includes('/assets/') && /\.js(?:[?#]|$)/.test(script.url)) urls.add(script.url); });
    // Local file resources do not always populate the Resource Timing API. The
    // debugger enumerates already loaded scripts and observes the later import.
    await session.send('Debugger.enable');
  }
  return [...observer.urls].map(url => ({ url }));
};
try {
  const startup = performance.now();
  app = await launchDesktopFixture({ root, profile });
  page = await app.firstWindow({ timeout: 120_000 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await expect(page.locator('.project-title strong')).not.toBeEmpty({ timeout: 120_000 });
  metrics.firstLaunchMs = Math.round(performance.now() - startup);
  metrics.initialScripts = await loadedScripts(page);
  if (!baseline) expect((metrics.initialScripts as { url: string }[]).some(entry => entry.url.includes('elk.bundled'))).toBe(false);
  await app.evaluate(({ BrowserWindow, dialog }, projectFile) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 940);
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: projectFile });
  }, projectFile);

  phase = 'new bundled template';
  await page.getByRole('button', { name: '新建工程', exact: true }).click();
  await page.locator('.dialog').getByLabel('作品名称', { exact: true }).fill(name);
  await page.locator('.dialog').getByLabel('工程模板', { exact: true }).selectOption('aihong');
  await page.getByRole('button', { name: '创建作品', exact: true }).click();
  await expect(page.locator('.project-title strong')).toHaveText(name, { timeout: 60_000 });
  const original = await save();
  expect(original.id).not.toBe(template.id);
  expect(original.assets).toEqual(template.assets);
  expect(original.characters).toEqual(template.characters);
  expect(original.ui).toEqual(template.ui);
  expect(original.blueprints).toEqual(template.blueprints);
  for (const asset of original.assets) {
    expect(await sha256(path.join(path.dirname(projectFile), asset.path))).toBe(await sha256(path.join(templateDirectory, asset.path)));
  }
  metrics.template = { assets: original.assets.length, characters: original.characters.length, expressions: original.characters.reduce((sum, character) => sum + character.expressions.length, 0), blueprints: original.blueprints?.length, uiComponents: original.ui.components.length };
  checks.push(`使用实际新建工程控件复制随包模板；资源、角色、界面和蓝图完整，${original.assets.length} 项资源内容逐项校验。`);

  phase = 'AI window and configured provider';
  const assistantStarted = performance.now();
  const opened = app.waitForEvent('window');
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  const assistant = await opened;
  assistant.on('pageerror', error => errors.push(error.message));
  await expect(assistant.getByLabel('发给 AI 的内容', { exact: true })).toBeVisible({ timeout: 30_000 });
  metrics.aiWindowMs = Math.round(performance.now() - assistantStarted);
  if (!baseline) expect((await loadedScripts(assistant)).some(entry => entry.url.includes('elk.bundled'))).toBe(false);
  const tokenFile = process.env.VNS_LIVE_AI_TOKEN_FILE;
  if (tokenFile) {
    // Read credentials only into this isolated test session; never print or persist the key.
    const values = (await fs.readFile(tokenFile, 'utf8')).replace(/^\uFEFF/, '').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    if (values.length !== 3) throw new Error('AI 测试配置必须是三行地址、密钥和模型。');
    const baseUrl = values[0].replace(/^(?:base[_ -]?url|url|api[_ -]?(?:url|base)|模型地址|地址)\s*[:=：]\s*/i, '');
    const apiKey = values[1].replace(/^(?:api[_ -]?key|key|密钥)\s*[:=：]\s*/i, '');
    credential = apiKey;
    const model = values[2].replace(/^(?:model(?:[_ -]?name)?|模型名称|模型)\s*[:=：]\s*/i, '');
    const config = aiConfigSchema.safeParse({ baseUrl, model, jsonMode: true, timeoutSeconds: 180, rememberKey: false });
    if (!config.success || !apiKey || !model) throw new Error('AI 测试配置格式无效。');
    await assistant.getByRole('button', { name: 'AI 服务设置', exact: true }).first().click();
    await assistant.getByLabel('API 地址', { exact: true }).fill(baseUrl);
    await assistant.getByLabel('API 密钥', { exact: true }).fill(apiKey);
    await assistant.getByLabel('模型名称', { exact: true }).fill(model);
    await assistant.getByLabel('在本机安全保存密钥', { exact: true }).uncheck();
    await assistant.getByRole('button', { name: '保存并测试连接', exact: true }).click();
    await expect(assistant.locator('.ai-settings [role="status"]')).toContainText('连接成功', { timeout: 180_000 });
    const current = await page.evaluate(() => window.studio!.getAiConfig!());
    expect(current.model).toBe(model); expect(current.keyStorage).toBe('session');
    expect((await fs.readFile(path.join(profile, 'ai-settings.json'), 'utf8')).includes(apiKey)).toBe(false);
    metrics.provider = { host: new URL(baseUrl).host, model, connection: 'passed', storage: 'session' };
    checks.push('安装版 AI 窗口使用桌面 token.txt 的服务完成真实连接；两窗口配置同步，密钥仅保留在测试会话。');
  } else checks.push('独立 AI 窗口正常打开，未重复执行已验证的付费整篇任务。');
  await assistant.getByRole('button', { name: '关闭 AI 助手', exact: true }).click();
  await page.bringToFront();

  phase = 'story auto layout';
  await page.locator('.view-tabs').getByRole('button', { name: '蓝图', exact: true }).click();
  await page.getByLabel('蓝图类型', { exact: true }).selectOption('story');
  const beforeStory = (await save()).nodes.map(node => ({ id: node.id, x: node.x, y: node.y }));
  const layoutStarted = performance.now();
  await page.getByRole('button', { name: '自动布局', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: '自动布局', exact: true })).toBeEnabled({ timeout: 30_000 });
  metrics.firstLayoutMs = Math.round(performance.now() - layoutStarted);
  expect((await save()).nodes.map(node => ({ id: node.id, x: node.x, y: node.y }))).not.toEqual(beforeStory);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await save()).nodes.map(node => ({ id: node.id, x: node.x, y: node.y }))).toEqual(beforeStory);
  if (!baseline) expect((await loadedScripts(page)).filter(entry => entry.url.includes('elk.bundled'))).toHaveLength(1);
  checks.push('剧情自动布局首次调用正常，位置变化可一次撤销；优化版只在首次点击时加载排版引擎。');

  phase = 'reusable blueprint auto layout';
  await page.getByLabel('蓝图类型', { exact: true }).selectOption('graph');
  const graph = original.blueprints!.find(graph => graph.nodes.length > 2)!;
  await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + graph.id);
  const positions = (project: Project) => project.blueprints!.find(item => item.id === graph.id)!.nodes.map(node => ({ id: node.id, x: node.x, y: node.y }));
  const beforeGraph = positions(await save());
  await page.getByRole('button', { name: '自动排列蓝图', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: '自动排列蓝图', exact: true })).toBeEnabled({ timeout: 30_000 });
  const arranged = positions(await save());
  expect(arranged).not.toEqual(beforeGraph);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(positions(await save())).toEqual(beforeGraph);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(positions(await save())).toEqual(arranged);
  if (!baseline) expect((await loadedScripts(page)).filter(entry => entry.url.includes('elk.bundled'))).toHaveLength(1);
  await page.screenshot({ path: path.join(output, 'blueprint-layout.png') });
  checks.push('可复用蓝图自动排列、撤销和重做通过；排版引擎在两个工作区复用。');

  phase = 'saved template restart';
  await openStoryMode(page, 'text');
  const source = page.getByRole('textbox', { name: '中文文本剧本', exact: true });
  const text = await source.inputValue();
  await page.reload();
  await expect(page.locator('.project-title strong')).toHaveText(name, { timeout: 30_000 });
  await openStoryMode(page, 'text');
  await expect(source).toHaveValue(text);
  await page.screenshot({ path: path.join(output, 'installed-template.png') });
  checks.push('新版模板保存后重开，完整文本与工程身份保留。');
  expect(errors).toEqual([]);
  const binaries = installedExecutable ? { executable: await sha256(installedExecutable), asar: await sha256(path.join(path.dirname(installedExecutable), 'resources/app.asar')) } : undefined;
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', baseline, installedExecutable, packaged: !!installedExecutable, checks, errors, metrics, binaries, projectFile }, null, 2));
  console.log(JSON.stringify({ output, checks: checks.length, metrics, status: 'passed' }, null, 2));
} catch (error) {
  const failure = credential ? String(error).split(credential).join('[REDACTED]') : String(error);
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', baseline, phase, errors, checks, metrics, failure, installedExecutable }, null, 2));
  console.error(phase, failure); console.log(output); process.exitCode = 1;
} finally { await app?.close().catch(() => undefined); }
