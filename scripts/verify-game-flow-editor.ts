import { openUiPageOptions, openUiPageUsage } from './lib/ui-design-controls';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, projectSchema } from '../src/core/model';
import { createCustomUiPage } from '../src/core/game-flow';
import { flowNodeIds, flowStepNodeId, gameFlowRoute } from '../src/core/game-flow-graph';
import { createBlueprintGraph } from '../src/core/blueprint';
import { compileProject } from '../src/runtime/compiler';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

const root = path.resolve('.');
const output = path.join(root, 'artifacts/game-flow-editor', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json');
await fs.mkdir(path.dirname(projectFile), { recursive: true });
const initial = createProject('统一流程蓝图验收');
initial.ui.components.push({ id: 'title_info', kind: 'button', page: 'main', name: '标题说明按钮', text: '查看说明', action: 'preferences', x: .6, y: .6, width: .3, height: .1 });
createCustomUiPage(initial, '已有页面');
initial.blueprints.push(createBlueprintGraph('function', '启动演出'));
initial.scenes.push({ id: 'other_scene', chapterId: initial.chapters[0].id, name: '其他场景' });
initial.nodes.push({ kind: 'passage', id: 'other_passage', name: '其他剧情', sceneId: 'other_scene', x: 40, y: 120, next: initial.nodes.find(n => n.kind === 'end')!.id, lines: [{ id: 'other_line', text: '其他场景内容', actions: [] }] });
await saveProject(projectFile, initial);
const checks: string[] = [], errors: string[] = [];
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch';
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const node = (id: string) => page!.locator('.react-flow__node[data-id="' + id + '"]');
async function save() {
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
}
async function focus(id: string) {
  const saved = await read();
  const label = id === flowNodeIds.story ? '游戏内容' : id === flowNodeIds.launch ? '游戏启动' : id === flowNodeIds.title ? '标题菜单' : id === flowNodeIds.newGame ? '新游戏' : id === flowNodeIds.load ? '读取存档'
    : saved.nodes.find(node => node.id === id)?.name ?? [...(saved.gameFlow?.beforeTitle.steps ?? []), ...(saved.gameFlow?.beforeNewGame ?? [])].find(step => flowStepNodeId(step.id) === id)?.name
    ?? (await import('../src/core/game-flow-graph')).flowNodeName(saved, id);
  await page!.getByLabel('搜索流程图', { exact: true }).fill(label);
  await page!.getByRole('region', { name: '流程图搜索结果', exact: true }).getByRole('button').filter({ has: page!.locator('strong', { hasText: new RegExp('^' + label + '$') }) }).first().click();
  await expect(node(id)).toHaveClass(/selected/);
  await page!.waitForTimeout(220);
}
async function fit() {
  await page!.getByRole('button', { name: '适应全图', exact: true }).click();
  await page!.waitForTimeout(220);
}
async function dragWire(source: string, target: string) {
  await fit();
  const a = await node(source).locator('.react-flow__handle.source[data-handleid="next"]').boundingBox();
  const b = await node(target).locator('.react-flow__handle.target[data-handleid="in"]').boundingBox();
  if (!a || !b) throw new Error('Missing wire handles');
  await page!.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page!.mouse.down();
  await page!.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
  await page!.mouse.up();
}
try {
  app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile });
  page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  await expect(page.locator('.project-title strong')).toHaveText(initial.name);
  await page.locator('.view-tabs').getByRole('button', { name: '流程图', exact: true }).click();
  await expect(page.getByRole('region', { name: '流程图', exact: true })).toBeVisible();
  await expect(page.locator('.react-flow')).toHaveCount(1);
  await expect(page.getByLabel('流程图层级')).toHaveCount(0);
  await expect(node(flowNodeIds.launch)).toBeVisible();
  await expect(node(flowNodeIds.title)).toBeVisible();
  await expect(node(flowNodeIds.story)).toBeVisible();
  await expect(node(initial.entryId)).toHaveCount(0);
  expect((await read()).gameFlow).toBeUndefined();
  checks.push('旧工程顶层显示启动、标题、新游戏、读档与游戏内容容器，查看不改写工程。');

  phase = 'load page navigation';
  for (const method of ['double-click', 'inspector']) {
    await focus(flowNodeIds.load);
    if (method === 'double-click') { await node(flowNodeIds.load).dblclick(); await page.getByRole('button', { name: '编辑界面', exact: true }).first().click(); }
    else await page.getByRole('button', { name: '编辑读档页面', exact: true }).click();
    await expect(page.getByLabel('设计页面', { exact: true })).toHaveValue('save');
    await page.getByRole('button', { name: '画布预览', exact: true }).click();
    await expect(page.getByLabel('存读档预览页面', { exact: true })).toHaveValue('load');
    await page.getByRole('button', { name: '关闭画布预览', exact: true }).click();
    await expect(page.locator('.dirty-dot')).toHaveCount(0);
    await page.locator('[data-workspace-tab="flowchart"]').click();
  }
  checks.push('读档节点双击与属性入口均打开存读档设计页的读档预览，不制造未保存修改。');

  phase = 'create page and connect';
  await page.locator('.view-tabs').getByRole('button', { name: '界面', exact: true }).click();
  await openUiPageOptions(page); await page.getByRole('button', { name: '新建自定义页面', exact: true }).click();
  const wizard = page.getByRole('dialog', { name: '页面使用位置', exact: true });
  await expect(wizard).toHaveCount(0);
  await openUiPageUsage(page);
  await expect(wizard).toBeVisible();
  await wizard.getByLabel('页面接入位置').selectOption('beforeTitle');
  await wizard.getByRole('button', { name: '添加使用位置', exact: true }).click();
  await expect(wizard.getByRole('status')).toContainText('已加入标题前流程');
  await page.screenshot({ path: path.join(output, 'page-connection.png') });
  await wizard.getByRole('button', { name: '在流程蓝图中查看' }).click();
  const leave = page.getByRole('dialog', { name: '保存界面修改' });
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: '保存并继续' }).click();
  await expect(page.getByRole('region', { name: '流程图', exact: true })).toBeVisible();
  let saved = await read();
  const custom = saved.ui.customPages.at(-1)!, first = saved.gameFlow!.beforeTitle.steps[0], a = flowStepNodeId(first.id);
  await expect(node(a)).toHaveClass(/selected/);
  await expect(page.getByLabel('节点页面')).toHaveValue(custom.id);
  expect(saved.blueprints.find(g => g.uiPageId === custom.id)?.nodes.some(n => n.type === 'showUiPage')).toBe(false);
  checks.push('页面接入向导保存 UI 草稿后定位到同一蓝图的准确页面节点；内部事件与调用入口分开。');

  phase = 'node parameters';
  await page.getByLabel('节点完成方式').selectOption('auto');
  await page.getByLabel('节点停留秒数').fill('0.5');
  await page.locator('.ui-page-opening-details > summary').click();
  await page.getByLabel('节点底层输入').selectOption('modeless');
  await focus(flowNodeIds.launch);
  for (const repeat of ['launch', 'title', 'profile', 'version']) {
    await page.getByLabel('启动节点执行时机').selectOption(repeat);
    await save();
    expect((await read()).gameFlow!.beforeTitle.repeat).toBe(repeat);
  }
  checks.push('启动节点的四种执行时机均可在作者界面选择并保存为对应策略。');
  await page.getByLabel('首次执行版本').fill('2026.10');
  await focus(a);
  await page.getByRole('button', { name: '插入蓝图演出', exact: true }).click();
  const add = page.getByRole('dialog', { name: '添加流程节点', exact: true });
  await add.locator(`[data-node-picker-item="blueprint:${initial.blueprints.at(-1)!.id}"]`).click();
  await save(); saved = await read();
  const second = saved.gameFlow!.beforeTitle.steps.at(-1)!, b = flowStepNodeId(second.id);
  await expect(node(b)).toHaveClass(/selected/);
  expect(saved.gameFlow!.connections![a]).toBe(b);
  expect(saved.gameFlow!.beforeTitle.steps[0]).toMatchObject({ kind: 'page', duration: .5, modal: false });
  await page.screenshot({ path: path.join(output, 'node-inspector.png') });
  checks.push('选中节点后在右侧编辑完成方式、时长和模态；从选中连线插入蓝图演出并自动衔接。');

  phase = 'wires undo and delete';
  await focus(a); await page.getByLabel('流程后续节点').selectOption(flowNodeIds.title);
  await focus(b); await page.getByLabel('流程后续节点').selectOption(a);
  await dragWire(flowNodeIds.launch, b);
  await save(); saved = await read();
  expect(gameFlowRoute(saved, 'beforeTitle').steps.map(s => s.id)).toEqual([second.id, first.id]);
  await page.getByRole('button', { name: /^撤销/ }).click();
  await save(); expect(gameFlowRoute(await read(), 'beforeTitle').steps.map(s => s.id)).toEqual([first.id]);
  await page.getByRole('button', { name: /^重做/ }).click();
  await save(); expect(gameFlowRoute(await read(), 'beforeTitle').steps.map(s => s.id)).toEqual([second.id, first.id]);
  const canvasBeforeSelection = await page.locator('.flow-container').boundingBox();
  await page.locator('.react-flow__edge[data-id="' + flowNodeIds.launch + ':next"]').click({ force: true });
  await expect(page.locator('.story-connections, .connection-label')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '断开选中连线', exact: true })).toHaveCount(0);
  expect(await page.locator('.flow-container').boundingBox()).toEqual(canvasBeforeSelection);
  expect(await page.locator('.react-flow__edge.selected .react-flow__edgeupdater').evaluateAll(elements => elements.every(element => getComputedStyle(element).opacity === '0'))).toBe(true);
  await page.screenshot({ path: path.join(output, 'selected-wire.png') });
  await page.keyboard.press('Delete');
  await save(); expect(gameFlowRoute(await read(), 'beforeTitle').complete).toBe(false);
  await page.getByRole('button', { name: /^撤销/ }).click();
  await save(); expect(gameFlowRoute(await read(), 'beforeTitle').complete).toBe(true);
  await page.locator('.react-flow__edge[data-id="flow:load:restore"]').click({ force: true });
  await page.keyboard.press('Delete');
  await expect(page.locator('.react-flow__edge[data-id="flow:load:restore"]')).toHaveCount(1);
  await focus(b);
  const title = await node(b).locator('.graph-node-title strong').boundingBox();
  if (!title) throw new Error('Missing node title');
  const oldPosition = (await read()).gameFlow!.positions![b];
  await page.mouse.move(title.x + title.width / 2, title.y + title.height / 2);
  await page.mouse.down(); await page.mouse.move(title.x + title.width / 2 + 40, title.y + title.height / 2 + 30, { steps: 10 }); await page.mouse.up();
  await save(); expect((await read()).gameFlow!.positions![b]).not.toEqual(oldPosition);
  checks.push('真实拖线改变执行顺序；撤销/重做、断开与恢复、节点拖动持久化通过，内置读档路径不可误删。');

  phase = 'existing button connection';
  await focus(a);
  await page.getByRole('button', { name: '编辑页面与内部事件' }).click();
  await expect(page.getByLabel('设计页面', { exact: true })).toHaveValue(custom.id);
  await openUiPageUsage(page);
  await wizard.getByLabel('页面接入位置').selectOption('button');
  await wizard.getByLabel('页面接入按钮', { exact: true }).selectOption('base:title_info');
  await expect(wizard.locator('.page-connection-bindings')).toContainText('设置');
  await wizard.getByLabel('页面接入按钮方式').selectOption('append');
  await wizard.getByRole('button', { name: '添加使用位置', exact: true }).click();
  await wizard.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '保存界面', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0); saved = await read();
  expect(saved.ui.components.find(c => c.id === 'title_info')?.action).toBe('preferences');
  expect(saved.ui.components.find(c => c.id === 'title_info')?.events?.beforeClick).toBeTruthy();
  await openUiPageUsage(page);
  const usages = wizard.locator('details').filter({ has: page.locator(':scope > summary', { hasText: '打开位置' }) });
  if (await usages.getAttribute('open') === null) await usages.locator(':scope > summary').click();
  await expect(wizard.getByRole('button', { name: '按钮 · 基础界面 / 标题 / 标题说明按钮', exact: true })).toBeVisible();
  await wizard.getByRole('button', { name: /流程蓝图 · 标题前流程/ }).click();
  await expect(node(a)).toHaveClass(/selected/);
  checks.push('接入已有按钮保留原操作；使用位置可回到同一画布的准确节点。');

  phase = 'new game and cross-scene entry';
  await focus(flowNodeIds.newGame);
  await page.getByRole('button', { name: '插入页面', exact: true }).click();
  await add.locator(`[data-node-picker-item="page:${custom.id}"]`).click();
  await save(); saved = await read();
  const opening = saved.gameFlow!.beforeNewGame[0];
  expect(gameFlowRoute(saved, 'beforeNewGame').steps.map(s => s.id)).toEqual([opening.id]);
  expect(saved.gameFlow!.connections![flowStepNodeId(opening.id)]).toBe(flowNodeIds.story);
  const insertedBounds = await node(flowStepNodeId(opening.id)).boundingBox();
  expect(insertedBounds).not.toBeNull();
  for (const card of await page.locator('.react-flow__node').all()) {
    if (await card.getAttribute('data-id') === flowStepNodeId(opening.id)) continue;
    const bounds = await card.boundingBox();
    if (insertedBounds && bounds) expect(insertedBounds.x + insertedBounds.width <= bounds.x || bounds.x + bounds.width <= insertedBounds.x || insertedBounds.y + insertedBounds.height <= bounds.y || bounds.y + bounds.height <= insertedBounds.y).toBe(true);
  }
  await expect(page.locator('.react-flow__node-story')).toHaveCount(0);
  const passageId = initial.nodes.find(n => n.kind === 'passage')!.id;
  await focus(flowNodeIds.story);
  await page.locator('.story-entry-setting > summary').click();
  await page.getByLabel('新的故事入口', { exact: true }).selectOption(passageId);
  await page.getByRole('button', { name: '设为故事入口…', exact: true }).click();
  await page.getByRole('dialog', { name: '更改故事入口', exact: true }).getByRole('button', { name: '更改入口', exact: true }).click();
  await save(); expect((await read()).entryId).toBe(passageId);
  await page.getByRole('button', { name: /^撤销/ }).click();
  await save(); expect((await read()).entryId).toBe(initial.entryId);
  await focus('other_passage');
  await expect(page.getByRole('region', { name: '流程图', exact: true })).toHaveAttribute('data-flow-scope', 'scene:other_scene:');
  await focus(initial.entryId);
  await expect(node(initial.entryId)).toBeVisible();
  checks.push('新游戏页面连接游戏内容，故事入口通过明确设置与确认修改；全工程搜索跨小章节定位实际节点。');

  phase = 'project settings and reload';
  await page.getByRole('button', { name: '作品设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '作品设置', exact: true });
  await settings.getByRole('button', { name: '作品信息', exact: true }).click();
  await expect(settings.getByRole('button', { name: '编辑游戏流程', exact: true })).toHaveCount(0);
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  const beforeReload = await read();
  await page.reload();
  await expect(page.locator('.project-title strong')).toHaveText(initial.name);
  await page.locator('.view-tabs').getByRole('button', { name: '流程图', exact: true }).click();
  await focus(flowNodeIds.launch);
  await expect(page.getByLabel('首次执行版本')).toHaveValue('2026.10');
  await focus(a); await expect(page.getByLabel('节点停留秒数')).toHaveValue('0.5');
  for (const width of [1024, 1280, 1920]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows().find(w => !w.isDestroyed())!.setContentSize(size, 768), width);
    await fit();
    await expect.poll(() => page!.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('.react-flow')).toHaveCount(1);
    await expect(page.getByLabel('流程节点属性')).toBeVisible();
    await page.screenshot({ path: path.join(output, 'unified-flow-' + width + '.png') });
  }
  expect((await read()).gameFlow).toEqual(beforeReload.gameFlow);
  expect(compileProject(await read()).diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  checks.push('作品信息没有特殊流程入口；保存重开保留节点、连线、参数及布局；1024/1280/1920 无页面横向溢出。');
  expect(errors).toEqual([]);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors, projectFile }, null, 2));
  console.log('PASS: ' + path.join(output, 'report.json'));
} catch (e) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, errors, error: String(e), projectFile }, null, 2));
  console.error(phase, e); console.log('Report: ' + path.join(output, 'report.json')); process.exitCode = 1;
} finally {
  if (app) {
    const pid = app.process().pid; await app.close();
    let alive = false; if (pid) { try { process.kill(pid, 0); alive = true; } catch { /* fixture exited */ } }
    await fs.writeFile(path.join(output, 'processes.json'), JSON.stringify({ pid, alive }));
    if (alive) { console.error('Fixture process remained alive'); process.exitCode = 1; }
  }
  const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']);
  expect(cleanup.errors).toEqual([]);
}
