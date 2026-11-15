import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { projectSchema, type Project } from '../src/core/model';
import { compileProject } from '../src/runtime/compiler';
import { saveProject } from '../src/desktop/project-store';
import { storyGroupsFixture } from '../tests/fixtures/story-groups';
import { storyGroupNodeId, storySceneNodeId } from '../src/core/story-groups';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { gameFlowCanvasEdges } from '../src/renderer/game-flow-view';

const root = path.resolve('.'), output = path.join(root, 'artifacts/story-groups-editor', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json');
const checks: string[] = [], errors: string[] = [], metrics: Record<string, unknown> = {};
let app: ElectronApplication | undefined, page: Page | undefined, failure: string | undefined, phase = 'prepare';
await fs.mkdir(path.dirname(projectFile), { recursive: true });
const initial = storyGroupsFixture(); await saveProject(projectFile, initial);
const digest = (p: Project) => createHash('sha256').update(JSON.stringify(compileProject(p).files)).digest('hex');
const runtimeBefore = digest(initial);
const node = (id: string) => page!.locator('.react-flow__node[data-id="' + id + '"]');
const workspace = () => page!.getByRole('region', { name: '流程图', exact: true });
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
async function save() { await page!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); }
async function fit() { await page!.getByRole('button', { name: '适应全图', exact: true }).click(); await page!.waitForTimeout(230); }
async function locate(name: string, id?: string) {
  await page!.getByLabel('搜索流程图', { exact: true }).fill(name);
  const results = page!.getByRole('region', { name: '流程图搜索结果', exact: true });
  await results.getByRole('button').filter({ has: page!.locator('strong', { hasText: new RegExp('^' + name + '$') }) }).first().click();
  if (id) await expect(node(id)).toHaveClass(/selected/);
  await page!.waitForTimeout(220);
}
async function undo() { await page!.getByRole('button', { name: /^撤销/ }).first().click(); await page!.waitForTimeout(70); }
async function redo() { await page!.getByRole('button', { name: /^重做/ }).first().click(); await page!.waitForTimeout(70); }
async function viewport() { return page!.locator('.react-flow__viewport').evaluate(element => getComputedStyle(element).transform); }
async function clickNode(id: string, modifiers?: ('Control' | 'Shift')[]) { await node(id).locator('.graph-node-title strong').click({ modifiers }); }
async function groupByMenu(name: string, selected: string[], marquee = false) {
  await fit();
  if (marquee) {
    const bounds = await Promise.all(selected.map(id => node(id).boundingBox()));
    if (bounds.some(item => !item)) throw new Error('Missing selected node bounds');
    const boxes = bounds as { x: number; y: number; width: number; height: number }[];
    const x = Math.min(...boxes.map(box => box.x)) - 12, y = Math.min(...boxes.map(box => box.y)) - 12;
    const right = Math.max(...boxes.map(box => box.x + box.width)) + 12, bottom = Math.max(...boxes.map(box => box.y + box.height)) + 12;
    await page!.mouse.move(x, y); await page!.mouse.down(); await page!.mouse.move(right, bottom, { steps: 15 }); await page!.mouse.up();
  } else { await clickNode(selected[0]); for (const id of selected.slice(1)) await clickNode(id, ['Control']); }
  for (const id of selected) await expect(node(id)).toHaveClass(/selected/);
  await node(selected[0]).locator('.graph-node-title strong').click({ button: 'right' });
  await page!.getByRole('menuitem', { name: /打组为剧情组/ }).click();
  const dialog = page!.getByRole('dialog', { name: '打组为剧情组', exact: true });
  await dialog.getByLabel('剧情组名称').fill(name); await dialog.getByRole('button', { name: '创建剧情组', exact: true }).click();
  await save(); return (await read()).storyGroups!.find(group => group.name === name)!;
}
async function dragWire(source: string, sourcePort: string, target: string, targetPort: string) {
  await fit(); const a = await node(source).locator('.source[data-handleid="' + sourcePort + '"]').boundingBox();
  const b = await node(target).locator('.target[data-handleid="' + targetPort + '"]').boundingBox();
  if (!a || !b) throw new Error('Missing wire handles');
  await page!.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page!.mouse.down();
  await page!.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 }); await page!.mouse.up();
}
try {
  app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(initial.name);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 960));
  await page.locator('[data-workspace-tab="flowchart"]').click(); await expect(workspace()).toHaveAttribute('data-flow-scope', 'game'); await fit();
  await expect(node('flow:story')).toBeVisible(); await expect(page.locator('.react-flow__node-story')).toHaveCount(0);
  await expect(page.locator('.react-flow__edge-path[marker-end]')).toHaveCount(gameFlowCanvasEdges(initial).length);
  await page.screenshot({ path: path.join(output, '01-game-overview.png') });
  await node('flow:story').dblclick(); await expect(workspace()).toHaveAttribute('data-flow-scope', 'content');
  await expect(node(storySceneNodeId('station'))).toBeVisible(); await expect(node('flow:launch')).toHaveCount(0);
  await fit(); await page.screenshot({ path: path.join(output, '02-game-content.png') });
  await node(storySceneNodeId('station')).dblclick(); await expect(workspace()).toHaveAttribute('data-flow-scope', 'scene:station:'); await fit();
  expect((await read()).storyGroups).toBeUndefined(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
  checks.push('旧工程只读进入顶层、游戏内容和小章节；单一工作区显示层级路径，顶层六条执行线均带方向箭头。');

  phase = 'group boundaries';
  const group = await groupByMenu('车站支线', ['choice', 'leave_story', 'stay_story'], true), groupId = storyGroupNodeId(group.id);
  expect(group.nodeIds.slice().sort()).toEqual(['choice', 'leave_story', 'stay_story']);
  await expect(node(groupId)).toHaveClass(/selected/);
  await expect(node(groupId).locator('.target[data-handleid^="in:"]')).toHaveCount(2);
  await expect(node(groupId).locator('.source')).toHaveCount(2);
  expect(digest(await read())).toBe(runtimeBefore);
  await undo(); await expect(node(groupId)).toHaveCount(0); await expect(node('choice')).toBeVisible();
  await redo(); await expect(node(groupId)).toBeVisible(); await save();
  await fit(); await clickNode(groupId); await page.screenshot({ path: path.join(output, '03-grouped-branches.png') });
  await node(groupId).focus(); await page.keyboard.press('Delete'); await save();
  expect(digest(await read())).toBe(runtimeBefore); expect((await read()).storyGroups).toHaveLength(1);
  checks.push('真实框选和右键打组；两入口、两出口保留具体映射，一步撤销重做；选中组按 Delete 不删除内容或断开隐藏连线。');

  phase = 'group movement naming and layout';
  await locate('车站支线', groupId);
  const beforeMove = await read(), title = await node(groupId).locator('.graph-node-title strong').boundingBox();
  if (!title) throw new Error('Missing group title');
  await page.mouse.move(title.x + title.width / 2, title.y + title.height / 2); await page.mouse.down();
  await page.mouse.move(title.x + title.width / 2 + 80, title.y + title.height / 2 + 45, { steps: 15 }); await page.mouse.up();
  await save(); const moved = (await read()).storyGroups!.find(item => item.id === group.id)!;
  expect({ x: moved.x, y: moved.y }).not.toEqual({ x: group.x, y: group.y });
  expect((await read()).nodes).toEqual(beforeMove.nodes); expect(digest(await read())).toBe(runtimeBefore);
  await undo(); await save(); expect((await read()).storyGroups).toEqual(beforeMove.storyGroups);
  await clickNode(groupId); await page.getByRole('button', { name: '重命名', exact: true }).click();
  const rename = page.getByRole('dialog', { name: '重命名剧情组', exact: true });
  await rename.getByLabel('剧情组名称').fill('不应保存的名称');
  await rename.getByRole('button', { name: '取消', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(rename).toBeHidden(); await expect(node(groupId)).toContainText('车站支线');
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  await page.getByRole('button', { name: '重命名', exact: true }).click();
  await rename.getByLabel('剧情组名称').fill('临时组名'); await rename.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(node(groupId)).toContainText('临时组名'); await undo(); await save(); await expect(node(groupId)).toContainText('车站支线');
  const beforeLayout = await read();
  await page.getByRole('button', { name: '整理当前布局', exact: true }).click();
  await expect(page.getByRole('button', { name: '整理当前布局', exact: true })).toBeEnabled({ timeout: 30000 }); await save(); await fit();
  const arranged = await read(); expect(arranged.storyGroups).not.toEqual(beforeLayout.storyGroups); expect(digest(arranged)).toBe(runtimeBefore);
  const boxes = await page.locator('.react-flow__node').evaluateAll(elements => elements.map(element => { const b = element.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }));
  for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
    const x = boxes[a], y = boxes[b]; expect(x.x + x.width <= y.x || y.x + y.width <= x.x || x.y + x.height <= y.y || y.y + y.height <= x.y).toBe(true);
  }
  const returnCard = await page.locator('.react-flow__node-storyContainer').filter({ has: page.locator('.graph-node-title strong', { hasText: /^返回标题$/ }) }).boundingBox();
  const returnSource = await node('end').boundingBox();
  expect(returnCard && returnSource && returnCard.x >= returnSource.x + returnSource.width).toBeTruthy();
  await page.screenshot({ path: path.join(output, '03b-arranged-groups.png') });
  await undo(); await save(); const restored = await read(); expect(restored.nodes).toEqual(beforeLayout.nodes); expect(restored.storyGroups).toEqual(beforeLayout.storyGroups); expect(restored.gameFlow).toEqual(beforeLayout.gameFlow);
  checks.push('真实拖动剧情组只改变外层位置；重命名与整理当前布局均可一步撤销，整理后卡片互不重叠，游戏产物保持一致。');

  phase = 'navigation and view restoration';
  await fit(); const outerViewport = await viewport();
  await node(groupId).dblclick(); await expect(workspace()).toHaveAttribute('data-flow-scope', 'scene:station:' + group.id);
  await expect(node('choice')).toBeVisible(); await expect(node('opening')).toHaveCount(0);
  await fit(); await page.screenshot({ path: path.join(output, '04-inside-group.png') });
  await page.getByRole('button', { name: '返回上一级', exact: true }).click();
  await expect.poll(viewport).toBe(outerViewport);
  await locate('灯下的谈话', 'stay_story'); await expect(workspace()).toHaveAttribute('data-flow-scope', 'scene:station:' + group.id);
  await node('stay_story').dblclick(); await expect(page.locator('.script-workspace')).toBeVisible();
  await page.locator('[data-workspace-tab="flowchart"]').click(); await expect(workspace()).toHaveAttribute('data-flow-scope', 'scene:station:' + group.id);
  await expect(node('stay_story')).toHaveClass(/selected/);
  checks.push('双击进入、面包屑返回恢复原视口；全工程搜索直接进入组内；从组内台词编辑返回仍保留当前组与节点。');

  phase = 'nested grouping and edits';
  const inner = await groupByMenu('灯下片段', ['stay_story']), innerId = storyGroupNodeId(inner.id);
  expect(inner.parentId).toBe(group.id);
  await node(innerId).focus(); await page.keyboard.press('Enter'); await expect(workspace()).toHaveAttribute('data-flow-scope', 'scene:station:' + inner.id);
  await locate('灯下的谈话', 'stay_story');
  await expect(page.locator('.flow-node-properties').getByLabel('名称', { exact: true })).toHaveValue('灯下的谈话');
  await page.locator('.flow-node-properties').getByRole('button', { name: '复制', exact: true }).click(); await save();
  let copied = (await read()).nodes.find(item => !initial.nodes.some(old => old.id === item.id))!;
  expect((await read()).storyGroups!.find(item => item.id === inner.id)!.nodeIds).toContain(copied.id);
  await expect(node(copied.id)).toHaveClass(/selected/); await expect(page.locator('.flow-node-properties').getByLabel('名称', { exact: true })).toHaveValue('灯下的谈话 副本');
  await undo(); await save(); expect(digest(await read())).toBe(runtimeBefore);
  await locate('灯下的谈话', 'stay_story'); await node('stay_story').dblclick();
  await page.locator('#node-stay_story .passage-header').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '在下方添加剧情模块', exact: true }).click(); await save();
  copied = (await read()).nodes.find(item => !initial.nodes.some(old => old.id === item.id))!;
  expect((await read()).storyGroups!.find(item => item.id === inner.id)!.nodeIds).toContain(copied.id);
  await page.locator('[data-workspace-tab="flowchart"]').click();
  await locate(copied.name, copied.id); await expect(workspace()).toHaveAttribute('data-flow-scope', 'scene:station:' + inner.id);
  await undo(); await save(); expect(digest(await read())).toBe(runtimeBefore);
  await page.getByLabel('添加剧情节点', { exact: true }).selectOption('passage'); await save();
  let saved = await read(); const added = saved.nodes.find(node => !initial.nodes.some(old => old.id === node.id))!;
  expect(saved.storyGroups!.find(item => item.id === inner.id)!.nodeIds).toContain(added.id);
  await expect(node(added.id)).toHaveClass(/selected/);
  await page.getByRole('button', { name: '返回上一级', exact: true }).click(); await clickNode(innerId);
  await expect(node(innerId).locator('.warning')).toContainText('问题');
  const insideIssue = page.locator('.flow-node-properties .story-boundary-link.warning').filter({ hasText: '从故事入口无法到达' });
  await expect(insideIssue).toHaveCount(1); await insideIssue.click();
  await expect(workspace()).toHaveAttribute('data-flow-scope', 'scene:station:' + inner.id); await expect(node(added.id)).toHaveClass(/selected/);
  await page.getByRole('button', { name: '返回上一级', exact: true }).click();
  if (!await page.locator('.problems-panel').isVisible()) await page.locator('.status-bar > button').first().click();
  await page.locator('.problems-panel .diagnostic-item[data-code="unreachable-node"][data-node-id="' + added.id + '"] .diagnostic-main').click();
  await expect(workspace()).toHaveAttribute('data-flow-scope', 'scene:station:' + inner.id); await expect(node(added.id)).toHaveClass(/selected/);
  await expect(page.locator('.flow-node-properties').getByLabel('名称', { exact: true })).toHaveValue(added.name);
  await page.locator('.status-bar > button').first().click();
  await node(added.id).focus(); await page.keyboard.press('Delete'); await save();
  await expect(workspace()).toHaveAttribute('data-flow-scope', 'scene:station:' + inner.id);
  expect((await read()).storyGroups!.find(item => item.id === inner.id)!.nodeIds).not.toContain(added.id);
  await undo(); await save(); expect((await read()).storyGroups!.find(item => item.id === inner.id)!.nodeIds).toContain(added.id);
  await redo(); await save();
  await expect(workspace()).toHaveAttribute('data-flow-scope', 'scene:station:' + inner.id);
  await page.getByRole('button', { name: '返回上一级', exact: true }).click(); await clickNode(innerId);
  await page.getByRole('button', { name: '解组，保留内容', exact: true }).click(); await save();
  expect((await read()).storyGroups!.some(item => item.id === inner.id)).toBe(false);
  expect((await read()).storyGroups!.find(item => item.id === group.id)!.nodeIds).toContain('stay_story');
  await undo(); await save();
  await expect(node(innerId)).toBeVisible();
  checks.push('嵌套组支持键盘进入；组内复制、模块插入、新增、删除和撤销重做维护归属；内部问题及全局诊断可重复定位同一节点；解组保留成员。');

  phase = 'target choice and connections';
  await page.getByRole('button', { name: '返回上一级', exact: true }).click();
  await dragWire('opening', 'next', groupId, 'choose');
  const targetDialog = page.getByRole('dialog', { name: '选择剧情组入口', exact: true }); await expect(targetDialog).toBeVisible();
  await targetDialog.getByLabel('剧情组入口节点').selectOption('stay_story'); await targetDialog.getByRole('button', { name: '连接到此处', exact: true }).click(); await save();
  expect((await read()).nodes.filter(node => node.kind === 'passage').find(node => node.id === 'opening')?.next).toBe('stay_story');
  await undo(); await save(); expect(digest(await read())).toBe(runtimeBefore);
  await clickNode(groupId);
  await page.locator('.story-entry-setting > summary').click(); await page.getByLabel('新的故事入口', { exact: true }).selectOption('stay_story');
  await page.getByRole('button', { name: '设为故事入口…', exact: true }).click();
  const entryDialog = page.getByRole('dialog', { name: '更改故事入口', exact: true }); await expect(entryDialog).toContainText('抵达车站');
  await entryDialog.getByRole('button', { name: '更改入口', exact: true }).click(); await save(); expect((await read()).entryId).toBe('stay_story');
  await undo(); await save(); expect((await read()).entryId).toBe('opening');
  checks.push('向组的其他入口拖线时选择内部目标，只修改对应源出口；显式改变故事入口显示旧值和新值，均可一步撤销。');

  phase = 'save reopen and sizes';
  await locate('灯下的谈话', 'stay_story'); const beforeReload = await read();
  await save(); await page.reload(); await expect(page.locator('.project-title strong')).toHaveText(initial.name);
  await page.locator('[data-workspace-tab="flowchart"]').click(); await expect(workspace()).toHaveAttribute('data-flow-scope', 'scene:station:' + inner.id);
  await expect(node('stay_story')).toHaveClass(/selected/);
  await expect(page.locator('.flow-node-properties').getByLabel('名称', { exact: true })).toHaveValue('灯下的谈话');
  await page.locator('.flow-node-properties').getByLabel('名称', { exact: true }).fill('灯下的谈话（复核）'); await save();
  expect((await read()).nodes.find(item => item.id === 'stay_story')!.name).toBe('灯下的谈话（复核）');
  expect((await read()).nodes.find(item => item.id === 'opening')!.name).toBe('抵达车站');
  await undo(); await save();
  expect((await read()).storyGroups).toEqual(beforeReload.storyGroups); expect(digest(await read())).toBe(runtimeBefore);
  for (const width of [1024, 1280, 1920]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width);
    await expect.poll(() => page!.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByLabel('搜索流程图')).toBeVisible(); await expect(page.getByRole('button', { name: '返回上一级', exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(output, '05-nested-' + width + '.png') });
  }
  await locate('车站支线', groupId); await fit();
  await page.screenshot({ path: path.join(output, '06-final-overview.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await locate('车站支线', groupId);
  const groupTitle = node(groupId).locator('.graph-node-title strong');
  expect(await groupTitle.evaluate(element => { const matrix = new DOMMatrix(getComputedStyle(element.closest('.react-flow__viewport')!).transform); return parseFloat(getComputedStyle(element).fontSize) * matrix.a; })).toBeGreaterThanOrEqual(11);
  await page.screenshot({ path: path.join(output, '07-group-detail.png') });
  metrics.runtimeBefore = runtimeBefore; metrics.runtimeAfter = digest(await read()); metrics.groups = (await read()).storyGroups;
  await fs.writeFile(path.join(output, 'saved-project.json'), JSON.stringify(await read(), null, 2));
  checks.push('保存重开恢复嵌套组、选中与准确属性，改名不串到其他节点；1024/1280/1920 导航可用，定位卡片字号可读；最终编译输出与打组前一致。');
  expect(errors).toEqual([]);
} catch (error) { failure = String(error); console.error(phase, error); await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); }
finally {
  if (app) { const pid = app.process().pid; await app.close(); let alive = false; if (pid) try { process.kill(pid, 0); alive = true; } catch { /* closed */ }
    await fs.writeFile(path.join(output, 'processes.json'), JSON.stringify({ pid, alive })); if (alive) failure ??= 'Fixture process remained alive'; }
  try { const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); expect(cleanup.errors).toEqual([]); } catch (error) { failure ??= String(error); }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: failure ? 'failed' : 'passed', phase, checks, metrics, errors, failure }, null, 2));
}
console.log((failure ? 'FAIL: ' : 'PASS: ') + path.join(output, 'report.json')); if (failure) process.exitCode = 1;
