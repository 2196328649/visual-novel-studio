import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createProject, projectSchema, type VisualObject } from '../src/core/model';
import { chapterCompositionBlueprint } from '../src/core/chapter-composition-blueprint';
import { rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { performanceTimeline } from '../src/core/performance-timeline';
import { projectToText } from '../src/core/text-script';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.'), output = path.join(root, 'artifacts/composition-detail', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = createProject('标题组合详细编辑验收');
const { graph } = chapterCompositionBlueprint(project, { title: '第一章', subtitle: '归途', duration: 7, effect: 'fade' });
project.blueprints.push(graph);
project.scriptText = { format: 'vns-text-1', standaloneSyntax: 'module-names', content: projectToText(project) };
const node = graph.nodes.find(node => rawSavedBlueprintAction(node)?.kind === 'visual')!;
const original = rawSavedBlueprintAction(node) as VisualObject;
assert.equal(original.name, '标题演出组合');
assert.equal(original.duration, 7);
const timeline = performanceTimeline(project, graph);
const projectFile = path.join(output, 'project.vns.json');
await fs.writeFile(projectFile, JSON.stringify(project));
const launch = () => launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
let app = await launch(), page = await app.firstWindow(), phase = 'launch';
const checks: string[] = [], errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
const close = async () => { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())); await app.close(); };
const save = async () => {
  const button = page.getByRole('button', { name: '保存工程', exact: true });
  if (await button.isEnabled()) await button.click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  return projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
};
const details = () => page.locator('.timeline-clip-effects');
const field = (name: string) => page.getByLabel(name, { exact: true }).filter({ visible: true });
const row = (name: string) => page.getByLabel('实例生命周期 ' + name, { exact: true });
const openRoot = async () => {
  await page.locator(`.timeline-clip[data-node-id="${node.id}"]`).click({ position: { x: 35, y: 12 } });
  await page.getByRole('button', { name: '详细编辑', exact: true }).click();
};
const openRow = (name: string) => row(name).getByRole('button', { name: '详细编辑 ' + name, exact: true }).click();
const assertOpen = async (name: string) => {
  await expect(page.getByRole('tab', { name: '片段属性', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(details()).toHaveAttribute('open', '');
  await expect(details().locator(':scope > summary')).toHaveText('动画与效果 · ' + name);
  await expect(details().locator(':scope > summary')).toBeInViewport();
  await expect(details().locator(':scope > summary')).toBeFocused();
  const top = await details().locator(':scope > summary').evaluate(element => element.getBoundingClientRect().top - element.closest('.timeline-inspector')!.getBoundingClientRect().top);
  assert.ok(top < 130, `Detailed editor starts too low: ${top}`);
};
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.unmaximize(); window.setContentSize(1440, 900); });
  await page.locator('[data-workspace-tab="blueprint"]').click();
  await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + graph.id);
  await expect(row('章节标题')).toBeVisible();
  const baseline = await save();

  phase = 'explicit advanced editor from playback settings';
  await page.getByRole('button', { name: '播放设置', exact: true }).click();
  await expect(page.getByLabel('演出播放设置', { exact: true })).toBeVisible();
  await openRoot(); await assertOpen('标题演出组合');
  await expect(field('对象名称')).toHaveValue('标题演出组合');
  await page.screenshot({ path: path.join(output, 'root-detail.png') });
  // Reopening an already selected, manually collapsed group must work too.
  await details().locator(':scope > summary').click();
  await openRoot(); await assertOpen('标题演出组合');
  checks.push('选择灰色组合片段后点击详细编辑，退出播放设置并聚焦高级编辑区；折叠后可重新打开。');

  phase = 'nested navigation';
  await page.getByRole('button', { name: '移动子对象 整体淡入淡出', exact: true }).filter({ visible: true }).dblclick({ position: { x: 25, y: 8 } });
  await assertOpen('整体淡入淡出');
  await page.getByRole('button', { name: '详细编辑子对象 章节标题', exact: true }).click();
  await assertOpen('章节标题');
  await expect(field('对象文字')).toHaveValue('第一章');
  await page.getByRole('button', { name: '返回外层组合', exact: true }).click();
  await assertOpen('标题演出组合');
  for (const name of ['黑色底层', '整体淡入淡出', '章节标题', '章节副标题']) {
    await page.getByRole('button', { name: '播放设置', exact: true }).click();
    await openRow(name);
    await assertOpen(name);
    await expect(field('对象名称')).toHaveValue(name);
  }
  await row('章节标题').getByRole('button', { name: '详细编辑 章节标题', exact: true }).click();
  await assertOpen('章节标题');
  await openRow('黑色底层');
  await assertOpen('黑色底层');
  // Selection alone must also dismiss playback controls.
  await page.getByRole('button', { name: '播放设置', exact: true }).click();
  await row('章节标题').locator('.lifetime-span').click({ position: { x: 35, y: 10 } });
  await expect(field('对象名称')).toHaveValue('章节标题');
  await page.getByRole('button', { name: '详细编辑', exact: true }).click();
  await assertOpen('章节标题');
  const navigated = await save();
  assert.deepEqual(navigated.blueprints, baseline.blueprints);
  checks.push('绿色显示区间的名称按钮和显式详细编辑按钮仍可进入高级编辑，旧组合属性内导航保留；纯导航未修改工程。');

  phase = 'edit, undo and redo';
  await field('对象名称').fill('章节标题 · 已编辑');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(field('对象名称')).toHaveValue('章节标题');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(field('对象名称')).toHaveValue('章节标题 · 已编辑');
  await openRow('黑色底层');
  await field('对象颜色').fill('#112233');
  await openRoot();
  await details().locator(':scope > section > details > summary').filter({ hasText: /^独立属性曲线$/ }).click();
  await field('不透明度 %帧 2 值').fill('85');
  await field('不透明度 %帧 2 值').press('Tab');
  const saved = await save(), savedGraph = saved.blueprints.find(item => item.id === graph.id)!;
  const expected = structuredClone(original);
  expected.children![0].color = '#112233';
  expected.children![1].children!.find(child => child.name === '章节标题')!.name = '章节标题 · 已编辑';
  expected.curves!.opacity![1].value = .85;
  assert.deepEqual(rawSavedBlueprintAction(savedGraph.nodes.find(item => item.id === node.id)!), expected);
  assert.deepEqual(savedGraph.links.filter(link => link.toPinId.startsWith('object_')), graph.links.filter(link => link.toPinId.startsWith('object_')));
  const topology = (links: typeof graph.links) => links.map(({ id, ...ends }) => JSON.stringify(ends)).sort();
  assert.deepEqual(topology(savedGraph.links), topology(graph.links));
  assert.deepEqual(savedGraph.exposedInputs, graph.exposedInputs);
  assert.deepEqual(performanceTimeline(saved, savedGraph).clips, timeline.clips);
  assert.equal(saved.scriptText?.content, baseline.scriptText?.content);
  checks.push('实际修改子对象名称、底层颜色和组合透明度曲线；撤销重做有效，实例标识、参数连线、片段时长和剧本文本保留。');

  phase = 'small window and relocated inspector';
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 760));
  await page.locator('[data-dock-panel="inspector"] > header').dragTo(page.locator('[data-dock-panel="library"] > header'));
  await expect(page.locator('[data-dock-panel="inspector"]')).toHaveAttribute('data-dock-slot', 'left');
  await openRow('章节标题 · 已编辑');
  await assertOpen('章节标题 · 已编辑');
  await page.screenshot({ path: path.join(output, 'child-detail-small.png') });
  checks.push('1100×760 窗口及属性面板移到左侧后，详细编辑仍能展开、滚动定位和聚焦。');

  phase = 'save and reopen';
  await close(); app = await launch(); page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="blueprint"]').click();
  await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + graph.id);
  await openRow('黑色底层');
  await assertOpen('黑色底层');
  await expect(field('对象颜色')).toHaveValue('#112233');
  assert.deepEqual((await save()).blueprints, saved.blueprints);
  assert.deepEqual(errors, []);
  checks.push('完全关闭隔离测试应用再重开，修改保留且详细编辑入口正常，无页面异常。');
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, error: String(error), checks, errors }, null, 2));
  throw error;
} finally { await close(); console.log(output); }
