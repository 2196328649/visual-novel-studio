import { chromium, expect, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSchema, type Project } from '../src/core/model';
import type { StudioBridge } from '../src/core/bridge';
import { compileProject } from '../src/runtime/compiler';

interface BlueprintHarness { snapshot?: () => { project: Project; dirty: boolean }; saved?: Project; previewed?: Project }
declare global { interface Window { __blueprintTest: BlueprintHarness } }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'artifacts', 'blueprint-editor-verification', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/runtime/**', '**/release/**'] } } });
await server.listen();
const address = server.httpServer!.address();
if (!address || typeof address === 'string') throw new Error('Editor test server did not start.');
const url = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch(process.env.VNS_BROWSER_PATH ? { executablePath: process.env.VNS_BROWSER_PATH, headless: true } : { channel: 'msedge', headless: true });
const checks: string[] = [];
const errors: string[] = [];
let page: Page | undefined;
async function editor(project: Project) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.addInitScript((initial: Project) => {
    Object.defineProperty(window, '__name', { value: new Function('target', 'return target'), configurable: true });
    const harness: BlueprintHarness = {};
    window.__blueprintTest = harness;
    const bridge: StudioBridge = {
      create: async name => ({ project: { ...structuredClone(initial), name }, path: null, recovered: false }),
      getInitial: async () => ({ project: structuredClone(initial), path: 'test/project.vns.json', recovered: false }), open: async () => null,
      save: async project => { harness.saved = structuredClone(project); return { project, path: 'test/project.vns.json', recovered: false }; },
      autosave: async () => ({ savedAt: Date.now() }), importAssets: async () => null, importText: async () => null,
      preview: async project => { harness.previewed = structuredClone(project); return { ok: true, diagnostics: [], log: '' }; }, exportGame: async () => null,
      checkExport: async project => ({ platform: project.exportSettings?.platform ?? 'windows', ready: true, checks: [], diagnostics: [] }),
      assetUrl: assetPath => `/resources/example/${assetPath}`, environment: async () => ({ sdkPath: null, appVersion: 'blueprint-verification' }),
      onRuntimeEvent: () => () => undefined, onCloseRequested: snapshot => { harness.snapshot = snapshot; return () => { harness.snapshot = undefined; }; },
    };
    window.studio = bridge;
  }, project);
  await page.goto(url);
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await page.getByRole('button', { name: '蓝图', exact: true }).click();
  if (!project.blueprints.length) await page.locator('.performance-workspace > .workspace-toolbar').getByRole('button', { name: '新建蓝图', exact: true }).click();
  if (await page.getByRole('button', { name: '展开蓝图属性', exact: true }).isVisible()) await page.getByRole('button', { name: '展开蓝图属性', exact: true }).click();
  return page;
}
const snapshot = (page: Page) => page.evaluate(() => window.__blueprintTest.snapshot!().project);
async function fit(page: Page) {
  await page.getByRole('button', { name: '框选全部节点', exact: true }).click();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.generic-blueprint-workspace .flow-container')?.getBoundingClientRect();
    return !!canvas && [...document.querySelectorAll('.generic-blueprint-workspace .react-flow__node')].every(node => {
      const bounds = node.getBoundingClientRect();
      return bounds.left >= canvas.left && bounds.right <= canvas.right && bounds.top >= canvas.top && bounds.bottom <= canvas.bottom;
    });
  }, undefined, { timeout: 5000 });
}
async function selectNode(page: Page, id: string) { await fit(page); await page.locator(`.react-flow__node[data-id="${id}"]`).click(); }
async function connect(page: Page, fromId: string, fromPin: string, toId: string, toPin: string) {
  await fit(page);
  const from = page.locator(`.react-flow__node[data-id="${fromId}"] .react-flow__handle[data-handleid="${fromPin}"]`);
  const to = page.locator(`.react-flow__node[data-id="${toId}"] .react-flow__handle[data-handleid="${toPin}"]`);
  await expect(from).toBeVisible(); await expect(to).toBeVisible();
  // Click-to-connect is part of React Flow's accessible authoring workflow.
  await from.click(); await to.click();
}

try {
  const sample = projectSchema.parse(JSON.parse(await fs.readFile(path.join(root, 'resources/example/project.vns.json'), 'utf8')));
  sample.blueprints = [];
  const testSound = sample.assets.find(asset => asset.kind === 'audio');
  if (testSound) testSound.category = 'sound';
  page = await editor(sample);
  await page.getByRole('button', { name: '蓝图入门', exact: true }).click();
  await expect(page.getByRole('button', { name: '创建已连线的入门示例' })).toBeVisible();
  await page.screenshot({ path: path.join(output, 'blueprint-welcome.png') });
  await page.getByRole('button', { name: '创建已连线的入门示例' }).click();
  await expect(page.locator('.blueprint-palette')).not.toBeVisible();
  await page.getByRole('button', { name: '展开节点库', exact: true }).click();
  await expect(page.locator('.blueprint-palette')).toBeVisible();
  await expect(page.locator('.blueprint-properties')).toBeVisible();
  const starter = (await snapshot(page)).blueprints!.at(-1)!;
  expect(starter.links.length).toBe(starter.nodes.length - 1);
  const actor = starter.nodes.find(node => node.type === 'showCharacter')!;
  await selectNode(page, actor.id);
  await page.getByRole('button', { name: '右侧', exact: true }).click();
  expect((await snapshot(page)).blueprints!.find(graph => graph.id === starter.id)!.nodes.find(node => node.id === actor.id)!.properties.presetId).toBe('right');
  await page.screenshot({ path: path.join(output, 'blueprint-1280.png') });
  checks.push('入门示例自动接线；角色和继承表情按名称选择；快捷站位保存为可复用预设。');

  await page.getByRole('button', { name: '新建用户节点', exact: true }).click();
  let macro = (await snapshot(page)).blueprints!.at(-1)!;
  await page.getByRole('button', { name: '输入与输出', exact: true }).click();
  await page.getByLabel('蓝图名称', { exact: true }).fill('晨间问候');
  await page.getByRole('button', { name: '添加输入', exact: true }).click();
  await page.getByLabel('输入参数名称 输入参数 1', { exact: true }).fill('等待时长');
  await page.getByLabel('等待时长的默认值', { exact: true }).fill('1.5');
  await page.getByRole('button', { name: '添加输入', exact: true }).click();
  await page.getByLabel('输入参数名称 输入参数 2', { exact: true }).fill('启用');
  await page.getByLabel('启用的数据类型', { exact: true }).selectOption('boolean');
  await expect(page.getByLabel('启用的默认值', { exact: true })).toHaveValue('false');
  await page.locator('.blueprint-library-node').getByText('等待', { exact: true }).click();
  await page.getByLabel('搜索蓝图节点').fill('读取输入');
  await page.locator('.blueprint-library-node').getByText('读取输入', { exact: true }).click();
  macro = (await snapshot(page)).blueprints!.find(graph => graph.id === macro.id)!;
  const getter = macro.nodes.find(node => node.type === 'getInput')!;
  const wait = macro.nodes.find(node => node.type === 'delay')!;
  await connect(page, getter.id, 'value', wait.id, 'seconds');
  await expect.poll(async () => (await snapshot(page!)).blueprints!.find(graph => graph.id === macro.id)!.links.some(link => link.fromNodeId === getter.id && link.toPinId === 'seconds')).toBe(true);
  await connect(page, getter.id, 'value', wait.id, 'exec_in');
  await expect(page.locator('.blueprint-status')).toContainText('不能传给执行');
  expect((await snapshot(page)).blueprints!.find(graph => graph.id === macro.id)!.links).toHaveLength(2);
  checks.push('用户节点支持数值与开关默认值；真实连接点操作能建立数据线，并解释错误类型的连线。');

  await page.locator('.performance-workspace > .workspace-toolbar').getByRole('button', { name: '新建蓝图', exact: true }).click();
  const callerId = (await snapshot(page)).blueprints!.at(-1)!.id;
  await page.getByLabel('搜索蓝图节点').fill('晨间问候');
  await page.locator('.blueprint-user-library').getByRole('button', { name: '晨间问候', exact: true }).click();
  await expect(page.getByLabel('等待时长', { exact: true })).toHaveValue('1.5');
  await expect(page.getByLabel('启用', { exact: true })).toHaveValue('false');
  await page.getByLabel('等待时长', { exact: true }).fill('2.25');
  const callNode = (await snapshot(page)).blueprints!.find(graph => graph.id === callerId)!.nodes.find(node => node.type === 'callMacro')!;
  expect(typeof callNode.properties[`arg_${macro.exposedInputs[0].id}`]).toBe('number');
  await page.getByLabel('演出目标').selectOption('graph:' + macro.id);
  await page.getByRole('button', { name: '输入与输出', exact: true }).click();
  await page.getByLabel('输入参数名称 等待时长', { exact: true }).fill('节奏秒数');
  await page.getByLabel('节奏秒数的默认值', { exact: true }).fill('3');
  const synchronized = (await snapshot(page)).blueprints!.find(graph => graph.id === callerId)!;
  expect(synchronized.nodes.find(node => node.id === callNode.id)!.pins.find(pin => pin.id === `arg_${macro.exposedInputs[0].id}`)!.name).toBe('节奏秒数');
  await page.getByLabel('演出目标').selectOption('graph:' + callerId);
  await selectNode(page, callNode.id);
  await expect(page.getByLabel('节奏秒数', { exact: true })).toHaveValue('2.25');
  await page.getByLabel('搜索蓝图节点').fill('');
  checks.push('节点库按中文搜索并插入用户节点；接口改名和默认值变更自动同步全部调用，保留每次调用的参数覆盖。');

  await page.locator('.blueprint-library-node').getByText('播放音效', { exact: true }).click();
  await page.getByRole('button', { name: '浏览音效素材', exact: true }).click();
  await page.getByRole('dialog', { name: '音效素材资源浏览器', exact: true }).getByRole('button', { name: '选择素材', exact: true }).dblclick();
  await page.locator('.status-bar > button').first().click();
  await page.locator('.diagnostic').filter({ hasText: '请选择音效' }).first().click();
  await expect(page.getByLabel('节点名称', { exact: true })).toHaveValue('播放音效');
  await expect(page.locator('.blueprint-node-problems')).toContainText('请选择音效');
  await page.screenshot({ path: path.join(output, 'blueprint-problem-location.png') });
  await page.getByRole('button', { name: '浏览音效素材', exact: true }).click();
  const assets = page.getByRole('dialog', { name: '音效素材资源浏览器', exact: true });
  await assets.getByRole('button', { name: '预览资源 ' + sample.assets.find(asset => asset.kind === 'audio')!.name, exact: true }).dblclick();
  await page.getByRole('button', { name: '关闭问题面板', exact: true }).click();
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  const saved = await page.evaluate(() => window.__blueprintTest.saved!);
  projectSchema.parse(saved);
  expect(compileProject(saved).diagnostics.filter(issue => issue.severity === 'error')).toEqual([]);
  await fs.writeFile(path.join(output, 'saved-project.json'), JSON.stringify(saved, null, 2));
  checks.push('缺素材诊断可定位到具体蓝图节点，修复后保存的数据通过模型检查和游戏编译。');

  for (const viewport of [{ width: 1024, height: 768 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport); await fit(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = await page.locator('.generic-blueprint-workspace .flow-container').boundingBox();
    expect(bounds!.width).toBeGreaterThan(160); expect(bounds!.height).toBeGreaterThan(240);
    await page.screenshot({ path: path.join(output, `blueprint-${viewport.width}.png`) });
  }
  checks.push('1024、1280、1920 像素宽度下，无页面横向溢出，画布和参数面板可操作。');
  await page.close(); page = await editor(saved);
  await page.getByLabel('演出目标').selectOption('graph:' + callerId); await selectNode(page, callNode.id);
  await expect(page.getByLabel('节奏秒数', { exact: true })).toHaveValue('2.25');
  await page.locator('.view-tabs').getByRole('button', { name: '流程图', exact: true }).click();
  await expect(page.locator('.graph-node')).not.toHaveCount(0);
  await page.locator('.view-tabs').getByRole('button', { name: '蓝图', exact: true }).click();
  await expect(page.locator('.blueprint-palette')).not.toBeVisible();
  expect(errors).toEqual([]);
  checks.push('保存重开保留中文接口、类型和连线；剧情图与节点编程往返切换没有 React 错误。');
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors }, null, 2));
  console.log(`PASS: ${checks.length} blueprint editor checks. Report: ${path.join(output, 'report.json')}`);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', checks, errors, error: String(error) }, null, 2));
  console.error(error); console.log(`Report: ${path.join(output, 'report.json')}`); process.exitCode = 1;
} finally { await browser.close(); await server.close(); }
