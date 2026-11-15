import { openBlueprintOptions, closeBlueprintOptions, setBlueprintOption } from './lib/blueprint-canvas';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, projectSchema, type BlueprintGraph, type BlueprintNode, type Project } from '../src/core/model';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createCustomUiPage } from '../src/core/game-flow';
import { compileProject } from '../src/runtime/compiler';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';

if (process.env.VNS_INSTALLED_EXE) throw new Error('This regression runs only the development editor, never an installed release.');
const root = path.resolve('.');
const output = path.join(root, 'artifacts/blueprint-capabilities-editor', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json');
await fs.mkdir(path.dirname(projectFile), { recursive: true });
const p = createProject('蓝图能力路径统一验收');
p.characters.push({ id: 'explicit_actor', name: '明确角色', color: '#ffffff', expressions: [] });
const custom = createCustomUiPage(p, '能力检查页面');
const events = p.blueprints.find(g => g.uiPageId === custom.id)!;
const node = (g: BlueprintGraph, type: BlueprintNode['type'], properties: BlueprintNode['properties'] = {}) => {
  const n = blueprintNodeDefaults(type); Object.assign(n.properties, properties); g.nodes.push(n); return n;
};
const wire = (project: Project, g: BlueprintGraph, from: BlueprintNode, to: BlueprintNode, output = 'exec_out', input = 'exec_in') => {
  synchronizeBlueprintSignatures(project);
  expect(connectBlueprintPins(g, from.id, from.type.startsWith('event') && output === 'exec_out' ? 'exec' : output, to.id, input)).toBeUndefined();
};
const safe = createBlueprintGraph('function', '安全模块'), unsafe = createBlueprintGraph('function', '需要台词的模块');
p.blueprints.push(safe, unsafe);
const branch = node(safe, 'branch', { condition: false }), unreachable = node(safe, 'startDialogue');
wire(p, safe, safe.nodes[0], branch); wire(p, safe, branch, unreachable, 'true'); node(safe, 'finishMinigame');
const culprit = node(unsafe, 'startDialogue'); wire(p, unsafe, unsafe.nodes[0], culprit);
const conditional = createBlueprintGraph('function', '按输入决定的模块'); p.blueprints.push(conditional);
conditional.exposedInputs.push(blueprintPin('enabled', '启用', 'input', 'boolean', true));
const input = node(conditional, 'getInput', { inputId: 'enabled' }), decide = node(conditional, 'branch'), conditionalBad = node(conditional, 'startDialogue');
wire(p, conditional, conditional.nodes[0], decide); wire(p, conditional, input, decide, 'value', 'condition'); wire(p, conditional, decide, conditionalBad, 'true');
const falseValue = node(events, 'literal', { value: false }), trueValue = node(events, 'literal', { value: true });
falseValue.pins[0].dataType = trueValue.pins[0].dataType = 'boolean';
Object.assign(falseValue, { x: 900, y: 60 }); Object.assign(trueValue, { x: 900, y: 380 });
expect(compileProject(p).diagnostics.filter(d => d.severity === 'error')).toEqual([]);
await saveProject(projectFile, p);
const original = await fs.readFile(projectFile, 'utf8');
const checks: string[] = [], errors: string[] = [], processes: { pid?: number; alive: boolean }[] = [];
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch', failure: string | undefined;
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const graphNode = (id: string) => page!.locator('.react-flow__node[data-id="' + id + '"]');
async function open(file = projectFile, profileName = 'profile') {
  app = await launchDesktopFixture({ root, profile: path.join(output, profileName), projectFile: file, sdkRoot: 'E:/Tools/renpy-8.5.3-sdk' });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(p.name);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 960));
}
async function close() {
  if (!app) return;
  const pid = app.process().pid; await app.close(); app = undefined;
  let alive = false; if (pid) try { process.kill(pid, 0); alive = true; } catch { /* Exited. */ }
  processes.push({ pid, alive }); expect(alive).toBe(false);
}
async function enterPage() {
  await page!.locator('.view-tabs').getByRole('button', { name: '界面', exact: true }).click();
  await page!.getByLabel('界面编辑模式').getByRole('button', { name: '设计', exact: true }).click();
  await page!.getByLabel('设计页面', { exact: true }).selectOption(custom.id);
  await page!.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click();
  await expect(page!.locator('.ui-event-library')).toBeVisible();
  await expect(page!.getByLabel('当前页面事件图', { exact: true })).toHaveValue(events.id);
}
async function search(name: string) {
  await page!.locator('.blueprint-commandbar').getByRole('button', { name: /添加节点/ }).click();
  await page!.getByLabel('搜索要添加的节点', { exact: true }).fill(name);
  return page!.locator('.node-picker-results button').filter({ has: page!.getByText(name, { exact: true }) });
}
async function dragFrom(id: string) {
  await page!.getByRole('button', { name: '框选全部节点', exact: true }).click();
  await page!.waitForTimeout(240); // Wait for the existing fit-view animation.
  const source = await graphNode(id).locator('.react-flow__handle.source[data-handleid="value"]').boundingBox();
  const canvas = await page!.locator('.generic-blueprint-workspace .flow-container').boundingBox();
  if (!source || !canvas) throw new Error('Missing drag source or canvas');
  await page!.mouse.move(source.x + source.width / 2, source.y + source.height / 2); await page!.mouse.down();
  await page!.mouse.move(canvas.x + canvas.width - 24, canvas.y + 24, { steps: 20 }); await page!.mouse.up();
  await expect(page!.getByRole('dialog', { name: '添加蓝图节点', exact: true })).toBeVisible();
  await page!.getByLabel('搜索要添加的节点', { exact: true }).fill(conditional.name);
  return page!.locator('.node-picker-results button').filter({ has: page!.getByText(conditional.name, { exact: true }) });
}
async function dismiss() { await page!.getByRole('button', { name: '关闭节点搜索', exact: true }).click(); }
async function save() {
  await page!.getByRole('button', { name: '保存界面', exact: true }).click();
await expect(page!.locator('.ui-save-status')).toHaveText('已保存');  await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
}
try {
  await open(); await enterPage();
  phase = 'available module filtering';
  await expect((await openBlueprintOptions(page!)).getByLabel('仅当前环境可用', { exact: true })).toBeChecked(); await closeBlueprintOptions(page!);
  await expect(await search(safe.name)).toHaveCount(1); await dismiss();
  await expect(await search(unsafe.name)).toHaveCount(0); await dismiss();
  await expect(await search('结束小游戏')).toHaveCount(0); await dismiss();
  await expect(await search('显示角色')).toHaveCount(1); await dismiss();
  expect(await fs.readFile(projectFile, 'utf8')).toBe(original);
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  checks.push('仅当前环境可用保留含不可达危险节点的安全模块及明确角色，过滤真实台词/小游戏要求；筛选不修改工程。');

  phase = 'rejected insertion';
  await setBlueprintOption(page!, '仅当前环境可用', false);
  const initialCount = events.nodes.length;
  await (await search(unsafe.name)).click();
  await expect(page!.locator('.blueprint-status')).toContainText('当前台词');
  await expect(page!.locator('.react-flow__node')).toHaveCount(initialCount);
  await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled();
  await page!.screenshot({ path: path.join(output, 'unsafe-insertion-rejected.png') });
  checks.push('显示所有节点后仍不能绕过能力检查；不安全插入给出原因且不产生草稿或节点。');

  phase = 'safe insertion and history';
  await setBlueprintOption(page!, '仅当前环境可用', true);
  await page!.locator('.ui-event-entry').filter({ hasText: '页面显示时' }).click();
  await (await search(safe.name)).click();
  await expect(page!.locator('.react-flow__node')).toHaveCount(initialCount + 1);
  const callId = (await page!.locator('.react-flow__node.selected').getAttribute('data-id'))!;
  await page!.getByRole('button', { name: /^撤销/ }).click(); await expect(graphNode(callId)).toHaveCount(0);
  await page!.getByRole('button', { name: /^重做/ }).click(); await expect(graphNode(callId)).toHaveCount(1);
  await save();
  let saved = await read(), storedGraph = saved.blueprints.find(g => g.id === events.id)!;
  expect(storedGraph.nodes.find(n => n.id === callId)?.properties.graphId).toBe(safe.id);
  expect(storedGraph.links.some(l => l.fromNodeId === events.nodes[0].id && l.toNodeId === callId)).toBe(true);
  expect(compileProject(saved).diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  checks.push('安全模块从实际 OnShow 自动接线；插入与连线一同撤销/重做，保存后编译无错误。');

  phase = 'explicit character insertion';
  await graphNode(callId).click();
  await (await search('显示角色')).click();
  await expect(page!.locator('.react-flow__node')).toHaveCount(initialCount + 2);
  const showId = (await page!.locator('.react-flow__node.selected').getAttribute('data-id'))!;
  await save(); saved = await read(); storedGraph = saved.blueprints.find(g => g.id === events.id)!;
  expect(storedGraph.nodes.find(n => n.id === showId)?.properties.characterId).toBe('explicit_actor');
  expect(storedGraph.links.some(l => l.fromNodeId === callId && l.toNodeId === showId)).toBe(true);
  expect(compileProject(saved).diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  await page!.getByRole('button', { name: '输入与输出', exact: true }).click();
  const summary = page!.locator('.blueprint-note').filter({ hasText: '主调用入口（默认参数）运行要求' });
  await expect(summary).toContainText('剧情舞台'); await expect(summary).not.toContainText('小游戏会话'); await expect(summary).not.toContainText('当前台词');
  for (const width of [1280, 1024]) {
    await app!.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width);
    await expect.poll(() => page!.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await page!.screenshot({ path: path.join(output, 'capability-summary-' + width + '.png') });
  }
  checks.push('显示角色默认保存明确角色而非隐式说话人；摘要只显示实际主入口要求，1024/1280窗口无页面级横向溢出。');

  phase = 'effective pending wire';
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 960));
  await expect(await search(conditional.name)).toHaveCount(0); await dismiss();
  const compatible = await dragFrom(falseValue.id); await expect(compatible).toHaveCount(1); await compatible.click();
  const wiredId = (await page!.locator('.react-flow__node.selected').getAttribute('data-id'))!;
  await page!.getByRole('button', { name: /^撤销/ }).click(); await expect(graphNode(wiredId)).toHaveCount(0);
  await page!.getByRole('button', { name: /^重做/ }).click(); await expect(graphNode(wiredId)).toHaveCount(1);
  await save();
  const wiredGraph = (await read()).blueprints.find(g => g.id === events.id)!;
  expect(wiredGraph.links.some(l => l.fromNodeId === falseValue.id && l.toNodeId === wiredId && l.toPinId === 'arg_enabled')).toBe(true);
  await expect(await dragFrom(trueValue.id)).toHaveCount(0); await dismiss();
  await page!.screenshot({ path: path.join(output, 'pending-wire-filter.png') });
  checks.push('拖线候选按将要接入的实际参数筛选：默认危险的模块接受明确 false，拒绝 true；节点与数据线可一起撤销重做并保存。');

  phase = 'reopen';
  const persisted = await fs.readFile(projectFile, 'utf8');
  await close(); await open(); await enterPage();
  await expect(graphNode(callId)).toHaveCount(1); await expect(graphNode(showId)).toHaveCount(1); await expect(graphNode(wiredId)).toHaveCount(1);
  await expect(await search(safe.name)).toHaveCount(1); await dismiss();
  await expect(await search(unsafe.name)).toHaveCount(0); await dismiss();
  expect(await fs.readFile(projectFile, 'utf8')).toBe(persisted);
  await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled();
  checks.push('关闭重开后节点、连线和能力筛选保持一致；浏览没有产生未保存修改。');
  await close();

  phase = 'standalone UI diagnostic navigation';
  const invalid = await read(), invalidGraph = invalid.blueprints.find(g => g.id === events.id)!;
  const badCall = node(invalidGraph, 'callFunction', { graphId: unsafe.id }); wire(invalid, invalidGraph, invalidGraph.nodes[0], badCall);
  const issue = compileProject(invalid).diagnostics.find(d => d.code === 'blueprint.path.capability' && d.nodeId === culprit.id)!;
  expect(issue).toBeTruthy(); expect(issue.gameFlow).toBeUndefined();
  const invalidFile = path.join(output, 'invalid/project.vns.json'); await fs.mkdir(path.dirname(invalidFile), { recursive: true }); await saveProject(invalidFile, invalid);
  const invalidOriginal = await fs.readFile(invalidFile, 'utf8');
  await open(invalidFile, 'invalid-profile');
  if (!await page!.locator('.problems-panel').isVisible()) await page!.locator('.status-bar > button').first().click();
  const row = page!.locator('.problems-panel .diagnostic-main').filter({ hasText: issue.message }); await expect(row).toHaveCount(1); await row.click();
  await expect(graphNode(culprit.id)).toHaveClass(/selected/);
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  expect(await fs.readFile(invalidFile, 'utf8')).toBe(invalidOriginal);
  await page!.screenshot({ path: path.join(output, 'standalone-ui-diagnostic.png') });
  checks.push('独立 UI 实际调用的能力错误使用 blueprint.path.capability，并精确定位嵌套模块节点；导航不改写工程。');
  expect(errors).toEqual([]);
} catch (error) {
  failure = String(error); await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); console.error(phase, error);
} finally {
  try { await close(); } catch (error) { failure ??= String(error); }
  await fs.writeFile(path.join(output, 'cleanup.json'), JSON.stringify(processes, null, 2));
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: failure ? 'failed' : 'passed', phase, checks, errors, failure, projectFile, packaged: false, userProjectModified: false }, null, 2));
}
console.log((failure ? 'FAIL: ' : 'PASS: ') + path.join(output, 'report.json'));
if (failure) process.exitCode = 1;
