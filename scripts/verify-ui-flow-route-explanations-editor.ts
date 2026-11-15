import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { saveProject } from '../src/desktop/project-store';
import { projectSchema } from '../src/core/model';
import { uiFlowRouteExplanationFixture } from './lib/ui-flow-route-explanation-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { pageFlowNodeId } from '../src/renderer/game-flow-view';

const root = path.resolve('.'), output = path.resolve('artifacts/editor-refinements-2026-11-10', 'page-routes-' + new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json'), fixture = uiFlowRouteExplanationFixture();
const checks: string[] = [], errors: string[] = [], processes: unknown[] = [];
let app: ElectronApplication | undefined, page: Page | undefined, failure: string | undefined, phase = 'prepare';
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const section = (name: string) => page!.getByRole('region', { name: '页面事件 ' + name, exact: true });
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const openPaths = async (card: Locator) => { const paths = card.locator('.page-flow-paths'); if (await paths.getAttribute('open') === null) await paths.locator('summary').click(); await expect(paths.locator('[data-route-path]').first()).toBeVisible(); };
async function locate(name: string) {
  await page!.getByLabel('搜索流程图', { exact: true }).fill(name);
  await page!.getByRole('region', { name: '流程图搜索结果' }).getByRole('button').filter({ has: page!.locator('strong', { hasText: name }) }).first().click();
}
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') }); page = await app.firstWindow();
  page.setDefaultTimeout(25000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(fixture.project.name);
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; if (window.isMaximized()) window.unmaximize(); window.setContentSize(1440, 960); });
}
async function showRoutes() {
  await page!.locator('[data-workspace-tab="flowchart"]').click();
  if (!await page!.getByLabel('查看页面流程', { exact: true }).count()) {
    await locate('标题菜单'); await page!.locator('.react-flow__node[data-id="flow:title"]').dblclick();
  }
  await page!.getByLabel('查看页面流程', { exact: true }).selectOption(fixture.parent.id);
  await expect(page!.getByRole('region', { name: '流程图', exact: true })).toHaveAttribute('data-flow-scope', 'page:' + fixture.parent.id);
  await expect(page!.locator('.react-flow__node[data-id="' + pageFlowNodeId(fixture.parent.id) + '"]')).toHaveClass(/selected/);
  await expect(page!.getByLabel('页面流程属性', { exact: true })).toBeVisible();
}
async function close() {
  if (!app) return;
  const owned = app, process = owned.process(); await owned.close(); app = undefined;
  processes.push({ pid: process.pid, exited: process.exitCode !== null || process.signalCode !== null });
}
try {
  await fs.mkdir(path.dirname(projectFile), { recursive: true }); await saveProject(projectFile, fixture.project);
  const baseline = await read(); await launch(); await showRoutes();

  phase = 'conditional routes';
  const conditional = section(fixture.conditional.component.name!);
  await expect(conditional.getByLabel(fixture.conditional.component.name + ' · 流程目标', { exact: true })).toBeDisabled();
  await expect(conditional.locator('[data-route-summary] strong')).toHaveText('条件分支');
  await expect(conditional).not.toContainText('执行多个步骤');
  await expect(conditional.locator('.page-flow-route-card')).toHaveCount(2);
  await expect(conditional.locator('[data-route-path]')).toHaveCount(0);
  const yes = conditional.locator('[data-route-node="' + fixture.conditional.first.id + '"]'); await openPaths(yes);
  await expect(yes.locator('[data-route-step="condition"]')).toContainText('章节进度');
  await expect(yes.locator('[data-route-step="condition"]')).toContainText('大于或等于 2');
  await yes.locator('.page-flow-paths > summary').click(); await expect(yes.locator('[data-route-path]')).toHaveCount(0);
  await openPaths(yes); await expect(yes.locator('[data-route-step="condition"]')).toContainText('章节进度');
  checks.push('展开后可再次收起，收起不保留明细节点；重新展开仍显示同一条原始路线。');
  await page!.screenshot({ path: path.join(output, 'conditional.png') });
  await yes.locator('[data-route-step="condition"] button').click();
  await expect(page!.locator('.react-flow__node.selected[data-id="' + fixture.conditional.branch.id + '"]')).toBeVisible();
  await page!.screenshot({ path: path.join(output, 'located-condition.png') });
  checks.push('条件路线保留两个可能去向，默认折叠明细；展开显示实际参数和条件，可定位原分支节点。');

  phase = 'merged routes'; await showRoutes();
  const merged = section(fixture.merged.component.name!); await expect(merged.locator('.page-flow-route-card')).toHaveCount(1);
  await openPaths(merged.locator('.page-flow-route-card')); await expect(merged.locator('[data-route-path]')).toHaveCount(2);
  await expect(merged.locator('[data-route-path="0"]')).toContainText('满足时：'); await expect(merged.locator('[data-route-path="1"]')).toContainText('不满足时：');
  await page!.screenshot({ path: path.join(output, 'merged-paths.png') });
  checks.push('分支合流只保留一张目标卡片，两种来路分别展开，不丢条件、不额外制造目标。');

  phase = 'sequence and waits';
  const sequence = section(fixture.sequence.component.name!); await expect(sequence.locator('[data-route-summary] strong')).toHaveText('含顺序步骤');
  for (const [index, label] of ['第一步', '第二步'].entries()) { const card = sequence.locator('.page-flow-route-card').nth(index); await openPaths(card); await expect(card.locator('[data-route-step="sequence"]')).toContainText(label); }
  const continued = section(fixture.continued.component.name!), tail = continued.locator('[data-route-node="' + fixture.continued.second.id + '"]');
  await openPaths(tail); await expect(tail.locator('[data-route-step="wait"]')).toContainText('详细说明'); await expect(tail.locator('[data-route-step="wait"]')).toContainText('关闭并返回后继续');
  checks.push('顺序节点显示真实第一步／第二步，直连后续说明等待前一页面关闭，路线卡片排列不冒充实际执行顺序。');

  phase = 'shared call locating';
  const nested = section(fixture.nested.component.name!), nestedCard = nested.locator('.page-flow-route-card');
  await openPaths(nestedCard); await expect(nestedCard.locator('[data-route-step="call"]')).toContainText('共享说明模块');
  await nestedCard.locator('[data-route-step="call"] button').click();
  await expect(page!.locator('.react-flow__node.selected[data-id="' + fixture.nested.call.id + '"]')).toBeVisible();
  await showRoutes(); await section(fixture.nested.component.name!).getByRole('button', { name: '事件图 ↗', exact: true }).click();
  await expect(page!.locator('.react-flow__node.selected[data-id="' + fixture.nested.open.id + '"]')).toBeVisible();
  checks.push('嵌套调用可分别定位父图调用节点与被调用图中的页面节点，复杂目标保留只读保护。');

  phase = 'dynamic and asynchronous routes'; await showRoutes();
  const dynamic = section(fixture.dynamic.component.name!), dynamicCard = dynamic.locator('.page-flow-route-card');
  await expect(dynamic.locator('[data-route-summary] strong')).toContainText('动态去向');
  await openPaths(dynamicCard); await expect(dynamicCard).toContainText('页面由输入决定：输入 · 目标页面');
  await expect(dynamicCard.getByRole('button', { name: '进入 ↗', exact: true })).toHaveCount(0);
  const opening = section(fixture.dynamicOpening.component.name!);
  await expect(opening.locator('[data-route-summary] strong')).toHaveText('运行时输入');
  await expect(opening.locator('.page-flow-route-opening')).toContainText('继续时机由输入决定：输入 · 是否等待玩家关闭');
  await expect(opening.locator('.page-flow-route-opening')).toContainText('底层输入由输入决定：输入 · 输入接管方式');
  await expect(opening.locator('.page-flow-route-opening')).not.toContainText('显示后继续');
  const asynchronous = section(fixture.asynchronous.component.name!); await expect(asynchronous.locator('[data-route-summary] strong')).toHaveText('条件分支 · 异步步骤');
  for (const [index, status] of ['已完成', '已取消'].entries()) { const card = asynchronous.locator('.page-flow-route-card').nth(index); await openPaths(card); await expect(card).toContainText('等待任务后：' + status); await expect(card).toContainText('后台准备信息'); }
  await page!.screenshot({ path: path.join(output, 'dynamic-and-task.png') });
  checks.push('动态页面保留输入来源，不用默认目标替代；动态打开方式不显示旧默认值；后台任务完成／取消分别说明。');

  phase = 'narrow layout';
  for (const width of [1440, 1100]) {
    await app!.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width);
    await expect.poll(() => page!.evaluate(() => {
      const inspector = document.querySelector('.page-flow-inspector');
      return document.documentElement.scrollWidth <= innerWidth && !!inspector && inspector.scrollWidth <= inspector.clientWidth + 1
        && [...inspector.querySelectorAll('.page-flow-route-card')].every(card => card.scrollWidth <= card.clientWidth + 1);
    })).toBe(true);
    await merged.scrollIntoViewIfNeeded(); await page!.screenshot({ path: path.join(output, 'routes-' + width + '.png') });
  }
  checks.push('1440 与 1100 宽窗口中展开的来源路径可换行，目标卡片和属性栏没有横向溢出。');

  phase = 'save and reopen';
  await button('保存工程').click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  let stored = await read(); expect(stored.blueprints).toEqual(baseline.blueprints); expect(stored.ui).toEqual(baseline.ui); expect(stored.nodes).toEqual(baseline.nodes);
  await close(); await launch(); await showRoutes();
  await expect(section(fixture.conditional.component.name!).locator('[data-route-summary] strong')).toHaveText('条件分支');
  await expect(section(fixture.merged.component.name!).locator('.page-flow-route-card')).toHaveCount(1);
  stored = await read(); expect(stored.blueprints).toEqual(baseline.blueprints); expect(stored.ui).toEqual(baseline.ui); expect(stored.nodes).toEqual(baseline.nodes);
  checks.push('定位、折叠、换页、显式保存与重开保留原按钮、蓝图及剧情数据，路线解释不新增另一套行为配置。');
  expect(errors).toEqual([]);
} catch (error) {
  failure = String(error); process.exitCode = 1; console.error(error);
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
} finally {
  try { await close(); } catch (error) { failure = [failure, 'close: ' + error].filter(Boolean).join('\n'); process.exitCode = 1; }
  await fs.mkdir(output, { recursive: true });
  let cleanup: unknown;
  try {
    if (app) throw new Error('The isolated fixture is still running.');
    await fs.copyFile(projectFile, path.join(output, 'fixture.project.json')).catch(() => undefined);
    cleanup = await cleanVerificationDirectories(output, ['project', 'profile']);
    expect((cleanup as { errors: unknown[] }).errors).toEqual([]);
  } catch (error) { failure = [failure, 'cleanup: ' + error].filter(Boolean).join('\n'); process.exitCode = 1; }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: failure ? 'failed' : 'passed', phase, checks, errors, processes, failure, cleanup }, null, 2));
  console.log(path.join(output, 'report.json'));
}
