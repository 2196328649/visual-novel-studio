import assert from 'node:assert/strict';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { storyMenuEntries } from '../src/core/story-menu';
import { storyFlowDirectoryLayout } from '../src/core/story-flow';
import { storyFlowOwner } from '../src/core/story-flow-authoring';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openDisclosureAncestors } from './lib/ui-disclosures';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

const root = path.resolve('.'), output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/player-flowchart-editor', 'player-editor-' + new Date().toISOString().replaceAll(':', '-'));
const relativeOutput = path.relative(root, output);
assert.ok(relativeOutput && !path.isAbsolute(relativeOutput) && relativeOutput !== '..' && !relativeOutput.startsWith('..' + path.sep),
  'VNS_ARTIFACT_ROOT must keep acceptance output inside this checkout.');
const file = path.join(output, 'project/project.vns.json');
const parsed = applyTextScript(createProject('玩家剧情图优化验收'), '#章节：第一章\n#小章节(流程图=是)：第一小节\n旁白：起点\n#段落(流程图=是)：分支甲\n旁白：分支内容\n#章节：第二章\n旁白：第二章正文\n#章节：第三章\n旁白：第三章正文');
assert.deepEqual(parsed.issues, []);
const project = parsed.project;
project.ui.pages = { ...project.ui.pages, flowchart: { layout: 'custom' } };
project.ui.components = project.ui.components.filter(c => c.page !== 'flowchart');
const map: UiComponent = { id: 'qa_map', name: '玩家剧情图', text: '', kind: 'flowchart', page: 'flowchart', x: .03, y: .08, width: .94, height: .86, list: { layout: 'flow', columns: 2, rows: 3, lockUnread: true }, style: { fontSize: 40, textColor: '#dce7db', background: '#32434d', captionParts: [{ fontSize: 18, color: '#e3ab64' }, {}] } };
project.ui.components.push(map);
project.ui.components.push({ id: 'qa_decoration', kind: 'text', page: 'flowchart', name: '装饰文字', text: '地图', x: .03, y: 0, width: .2, height: .05 });
project.ui.flowStyles = [{ id: 'shared_style', name: '主线样式', style: { fontSize: 54 } }];
project.chapters.at(-1)!.flowchart = { ...project.chapters.at(-1)!.flowchart, styleId: 'shared_style' };
project.scriptText!.content = projectToText(project);
const originalEntries = storyMenuEntries(project, 'flowchart'), first = originalEntries[0], second = originalEntries[1];
await fs.mkdir(path.dirname(file), { recursive: true });
await saveProject(file, project);
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch';
const checks: string[] = [], errors: string[] = [], evidence: Record<string, unknown> = {};
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
const inspector = () => page!.locator('.ui-inspector');
const view = () => inspector().locator('.ui-inspector-view:not([hidden])');
const flow = () => view().locator('.ui-player-flow-inspector');
const field = (name: string) => view().getByLabel(name, { exact: true });
const flowGroup = (id: string) => view().locator(`[data-ui-inspector-group="${id}"]`);
const propertySearch = () => inspector().getByRole('searchbox', { name: '搜索控件属性', exact: true });
async function openGroup(id: string) {
  const summary = flowGroup(id).locator(':scope > summary'); await openDisclosureAncestors(summary); await expect(summary).toBeVisible();
}
async function scope(expected: 'map' | 'node' | 'base' | 'preset' | 'sources') {
  await expect(inspector()).toHaveAttribute('data-ui-flow-view', expected);
  await expect(view()).toHaveCount(1); await expect(flow()).toHaveAttribute('data-flow-inspector-target', expected);
  if (expected !== 'map') {
    const retained = inspector().locator('[data-ui-inspector-view="component"]');
    await expect(retained).toBeHidden(); await expect(retained).toHaveJSProperty('inert', true);
    await expect(field('控件不透明度 %')).toHaveCount(0);
  }
}
async function clearSearch() {
  if (await propertySearch().inputValue()) await inspector().getByRole('button', { name: '清除属性搜索', exact: true }).click();
}
async function returnMap() {
  if (await inspector().getAttribute('data-ui-flow-view') !== 'map') await inspector().getByRole('button', { name: '返回整张图设置', exact: true }).click();
  await scope('map'); await clearSearch();
}
async function selectNode(id: string) {
  await returnMap(); await openGroup('flow-content'); await field('选择剧情图节点').selectOption(id); await scope('node');
}
async function editBase() {
  await returnMap(); await openGroup('flow-style'); await flow().getByRole('button', { name: /^本图基础外观/ }).click(); await scope('base');
}
async function previewField(name: string, value: string) {
  await page!.getByRole('button', { name: '剧情图预览', exact: true }).click();
  const menu = page!.getByRole('dialog', { name: '剧情图预览', exact: true });
  await menu.getByLabel(name, { exact: true }).selectOption(value);
  await menu.getByRole('button', { name: '关闭剧情图预览', exact: true }).click();
}
async function restorePresetFontSize() {
  await field('预设字号').click({ button: 'right' });
  await page!.getByRole('menuitem', { name: '恢复本图基础设置', exact: true }).click();
}
const save = async () => { await page!.getByRole('button', { name: '保存界面', exact: true }).click(); await expect(page!.locator('.ui-save-status')).toHaveText('已保存', { timeout: 30000 }); };
async function launch() {
  app = await launchDesktopFixture({ root, projectFile: file, profile: path.join(output, 'profile') });
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; if (window.isMaximized()) window.unmaximize(); window.setContentSize(1440, 960); });
  await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByLabel('设计页面', { exact: true }).selectOption('flowchart');
  await page.locator('[data-hierarchy-id="qa_map"]').click();
}
try {
  await launch();
  phase = 'actual defaults and directory round-trip';
  for (const id of ['flow-mode', 'flow-content', 'flow-style', 'flow-layout', 'flow-browsing', 'flow-player']) await expect(flowGroup(id).locator(':scope > summary')).toBeVisible();
  await expect(flow().getByRole('button', { name: /^管理显示的剧情/ })).toHaveCount(1);
  await openGroup('flow-layout');
  await expect(field('每行数量')).toHaveCount(0);
  for (const [label, value] of [['节点宽度', '350'], ['节点高度', '80'], ['横向间距', '100'], ['纵向间距', '90']]) await expect(field(label)).toHaveValue(value);
  await field('流程图排列').selectOption('grid');
  await expect(field('每行数量')).toHaveValue('2');
  await expect(field('每页行数（0 为滚动）')).toHaveValue('3');
  await field('流程图排列').selectOption('flow');
  checks.push('整图按展示方式、剧情节点、外观、排列、浏览和玩家操作分组；真实默认值与切换保留旧参数。');

  phase = 'node selection and segmented content';
  const canvas = page!.locator('[data-component-id="qa_map"]');
  await canvas.locator(`[data-flow-node="${first.id}"]`).click();
  await scope('node'); await openGroup('flow-other-node');
  await expect(field('选择剧情图节点')).toHaveValue(first.id);
  await expect(field('当前节点文字')).toContainText('第一章 / 第一小节');
  phase = 'keyboard targets inside the map';
  const nodeButton = canvas.locator(`[data-flow-node="${first.id}"]`), geometryBefore = await canvas.getAttribute('style');
  await nodeButton.focus();
  for (const key of ['Delete', 'Control+x', 'Control+d', 'ArrowRight', 'ArrowDown']) await nodeButton.press(key);
  await expect(canvas).toHaveCount(1);
  assert.equal(await canvas.getAttribute('style'), geometryBefore);
  await expect(page!.locator('[data-hierarchy-id="qa_map"]')).toHaveCount(1);
  await page!.getByRole('tab', { name: '页面设置', exact: true }).click();
  await nodeButton.press('Enter');
  await expect(page!.getByRole('tab', { name: '组件设置', exact: true })).toHaveAttribute('aria-selected', 'true');
  checks.push('节点焦点下删除、剪切、复制及方向键不会误改整张图；从页面设置点回节点会展示节点属性。');
  phase = 'node selection and segmented content';
  await field('节点文字第 1 段').fill('记 第一回');
  await page!.getByRole('button', { name: '添加文字段', exact: true }).click();
  await field('节点文字第 2 段').fill('醉梦 {原样}');
  await field('当前节点外观预设').selectOption('shared_style');
  await expect(canvas.locator(`[data-flow-node="${first.id}"] [data-flow-part="1"]`)).toHaveText('醉梦 {原样}');
  await save();
  const saved = await read();
  assert.equal(saved.chapters[0].flowchart?.name, undefined);
  assert.equal(storyFlowOwner(saved, first.owner)?.flowchart?.name, '记 第一回｜醉梦 {原样}');
  assert.equal(storyFlowOwner(saved, first.owner)?.flowchart?.styleId, 'shared_style');
  const reparsed = applyTextScript(saved, saved.scriptText!.content);
  assert.deepEqual(reparsed.issues, []);
  assert.deepEqual(storyMenuEntries(reparsed.project, 'flowchart'), storyMenuEntries(saved, 'flowchart'));
  checks.push('点画布定位真实小节来源，分段文字和预设同步保存到剧本，可重新解析。');

  phase = 'node, preset, and whole-map navigation preserves context';
  const nodeSearch = () => field('查找剧情图节点');
  await openGroup('flow-other-node');
  await nodeSearch().fill('第一章');
  await propertySearch().fill('编辑这个外观预设');
  await page!.getByRole('button', { name: '编辑这个外观预设', exact: true }).click();
  await scope('preset'); await expect(propertySearch()).toHaveValue('');
  await expect(inspector().locator('[data-ui-inspector-breadcrumb]')).toBeFocused();
  await expect(flow()).toContainText('2 处剧情引用');
  await propertySearch().fill('同入口');
  await expect(flowGroup('flow-preset-usages')).toBeVisible();
  await expect(flowGroup('flow-preset-usages')).toHaveJSProperty('open', true);
  await propertySearch().fill('返回当前节点内容');
  await page!.getByRole('button', { name: '返回当前节点内容', exact: true }).click();
  await scope('node'); await expect(propertySearch()).toHaveValue('编辑这个外观预设');
  await expect(inspector().locator('[data-ui-inspector-breadcrumb]')).toBeFocused(); await clearSearch();
  // Each object owns its search. Navigation is not an authoring change.
  await expect(field('当前节点文字')).toContainText('剧情来源：第一章 / 第一小节');
  await expect(field('当前节点文字')).toContainText('文字同步到其他“跟随剧本”的剧情图');
  await propertySearch().fill('返回整张图设置');
  await page!.getByRole('button', { name: '返回整张图设置', exact: true }).click();
  await scope('map'); await expect(propertySearch()).toHaveValue('');
  await openGroup('flow-content'); await expect(field('选择剧情图节点')).toHaveValue('');
  await expect(page!.locator('[data-hierarchy-id="qa_map"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page!.locator('[data-ui-inspector-breadcrumb]')).toBeInViewport();
  await expect(page!.locator('[data-ui-inspector-region="common"] > h3')).toContainText('作用于整张图');
  await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled();
  assert.deepEqual(await read(), saved, 'Navigation and searches must not change the project.');
  await field('选择剧情图节点').selectOption(first.id); await scope('node'); await clearSearch();
  await expect(field('节点文字第 2 段')).toHaveValue('醉梦 {原样}');
  await returnMap(); await openGroup('flow-mode'); await flowGroup('flow-mode').getByRole('button', { name: /^管理显示的剧情/ }).click(); await scope('sources');
  await propertySearch().fill('共用'); await expect(flowGroup('flow-sources')).toBeVisible(); await clearSearch();
  await expect(flowGroup('flow-sources')).toHaveJSProperty('open', true); await selectNode(first.id); await clearSearch();
  await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled();
  assert.deepEqual(await read(), saved, 'Opening the source manager must not change story visibility or UI data.');
  checks.push('节点、预设、整图和剧情来源具有独立对象视图与属性搜索；导航不写工程，整图字段隐藏且不可交互。');

  phase = 'shared style versus assignment and inheritance';
  await page!.getByRole('button', { name: '编辑这个外观预设', exact: true }).click();
  await expect(field('编辑节点外观预设')).toHaveValue('shared_style');
  await scope('preset'); await expect(flow()).not.toContainText('共享样式');
  await clearSearch(); await openGroup('flow-preset-manage');
  await expect(page!.getByRole('button', { name: '新建预设', exact: true })).toBeVisible();
  await expect(page!.getByRole('button', { name: '复制预设', exact: true })).toBeEnabled();
  await expect(page!.getByRole('button', { name: '删除预设', exact: true })).toBeDisabled();
  await expect(flowGroup('flow-preset-manage')).toContainText('2 处剧情引用');
  await previewField('预览视觉状态', 'hover');
  await expect(flow().locator('[data-flow-sample-state]')).toHaveAttribute('data-flow-sample-state', 'hover');
  await openGroup('flow-preset-skin');
  await field('悬停底色颜色值').fill('#224466');
  await expect(flow().locator('.flow-node-sample > div')).toHaveCSS('background-color', 'rgb(34, 68, 102)');
  await previewField('预览视觉状态', 'idle'); await openGroup('flow-preset-base-text');
  await field('预设字号').fill('64');
  await field('预设文字对齐').selectOption('left');
  const textBounds = async () => canvas.locator(`[data-flow-node="${first.id}"]`).evaluate(element => {
    const box = element.getBoundingClientRect(), area = element.querySelector('[data-flow-caption-area]')!.getBoundingClientRect(), text = element.querySelector('[data-flow-caption]')!.getBoundingClientRect();
    return { x: text.x - area.x, right: area.right - text.right, boxWidth: box.width, areaWidth: area.width, textWidth: text.width };
  });
  await expect.poll(async () => { const bounds = await textBounds(); return bounds.textWidth - bounds.areaWidth; }).toBeLessThan(2);
  const left = await textBounds(); assert.ok(Math.abs(left.x) < 2, JSON.stringify(left));
  await field('预设文字对齐').selectOption('right');
  await expect.poll(async () => { const bounds = await textBounds(); return bounds.textWidth - bounds.areaWidth; }).toBeLessThan(2);
  const right = await textBounds(); assert.ok(Math.abs(right.right) < 2, JSON.stringify(right));
  await restorePresetFontSize();
  await expect(field('预设字号')).toHaveValue('40');
  await field('预设名称').fill('主线 "归"');
  await save();
  const inherited = await read();
  assert.equal(inherited.ui.flowStyles![0].style?.fontSize, undefined);
  assert.equal(inherited.ui.flowStyles![0].style?.align, 'right');
  assert.deepEqual(applyTextScript(inherited, inherited.scriptText!.content).issues, []);
  evidence.align = { left, right };
  checks.push('节点外观预设入口、按钮和提示统一；准确显示使用数量；左右对齐、恢复继承与含引号改名保存一致。');

  phase = 'input stays protected while a real save response is delayed';
  await selectNode(first.id);
  await field('节点文字第 2 段').fill('保存中的新文字');
  await app!.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get('studio:save');
    const state = (globalThis as any).flowSaveHold = { pending: false, once: true, release: undefined as undefined | (() => void) };
    ipcMain.removeHandler('studio:save');
    ipcMain.handle('studio:save', async (...args) => {
      const result = await original(...args);
      if (state.once) { state.once = false; state.pending = true; await new Promise<void>(resolve => { state.release = resolve; }); }
      return result;
    });
  });
  await page!.getByRole('button', { name: '保存界面', exact: true }).click();
  await expect.poll(() => app!.evaluate(() => (globalThis as any).flowSaveHold.pending)).toBe(true);
  const pendingField = field('节点文字第 2 段');
  await expect(pendingField).toBeDisabled();
  await expect(page!.locator('.editor-layout')).toHaveAttribute('inert', '');
  await pendingField.evaluate(element => (element as HTMLInputElement).focus());
  await page!.keyboard.type('不应写入');
  await expect(pendingField).toHaveValue('保存中的新文字');
  await app!.evaluate(() => (globalThis as any).flowSaveHold.release());
  await expect(page!.locator('.ui-save-status')).toHaveText('已保存');
  assert.equal(storyFlowOwner(await read(), first.owner)?.flowchart?.name, '记 第一回｜保存中的新文字');
  await pendingField.fill('醉梦 {原样}'); await save();
  checks.push('真实保存延迟期间输入被禁用，不能产生看似成功却未提交的文字；保存结束可继续编辑。');

  phase = 'same entry precedence and undo';
  await returnMap(); await openGroup('flow-mode'); await flowGroup('flow-mode').getByRole('button', { name: /^管理显示的剧情/ }).click(); await scope('sources');
  await expect(flow().locator('.flow-source-list')).toContainText('同一入口显示：第一章 / 第一小节');
  await field('显示小章节：第一小节').uncheck();
  await selectNode(first.id); await expect(field('节点文字第 1 段')).toHaveValue('第一章');
  await page!.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(field('节点文字第 1 段')).toHaveValue('记 第一回');
  await expect(field('当前节点外观预设')).toHaveValue('shared_style');
  checks.push('隐藏同入口的小节后自动呈现章节来源，撤销准确恢复小节文字和样式。');

  phase = 'progress and selection do not mutate';
  if (await page!.getByRole('button', { name: '保存界面', exact: true }).isEnabled()) await save();
  await previewField('预览视觉状态', 'auto');
  await previewField('预览玩家进度', 'partial');
  await expect(canvas.locator('[data-flow-state="disabled"]')).not.toHaveCount(0);
  await previewField('预览玩家进度', 'current');
  await previewField('预览当前节点', second.id);
  await expect(canvas.locator('[data-flow-state="selected"]')).toHaveCount(1);
  await selectNode(second.id);
  await expect(page!.locator('.ui-save-status')).toHaveText('已保存');
  await page!.screenshot({ path: path.join(output, 'current-node-and-properties.png') });
  checks.push('进度预览仅有一个当前位置，选择节点和预览不会弄脏工程。');

  phase = 'directory pagination and shared geometry';
  await returnMap(); await openGroup('flow-layout');
  await field('流程图排列').selectOption('grid');
  await field('每行数量').fill('1');
  await field('每页行数（0 为滚动）').fill('1');
  const lastId = originalEntries.at(-1)!.id;
  await selectNode(lastId);
  await expect(canvas.locator(`[data-flow-node="${lastId}"]`)).toHaveCount(1);
  const cell = storyFlowDirectoryLayout(project, { ...map, list: { ...map.list, layout: 'grid', columns: 1, rows: 1 } });
  await expect(flow().locator('.flow-node-sample')).toHaveAttribute('data-flow-sample-width', String(cell.cellWidth));
  await expect(flow().locator('.flow-node-sample')).toHaveAttribute('data-flow-sample-height', String(cell.cellHeight));
  await expect(canvas.locator('[data-flow-pagination]')).toContainText(`${originalEntries.length} / ${originalEntries.length}`);
  await canvas.getByRole('button', { name: '剧情目录上一页', exact: true }).click();
  await expect(canvas.locator(`[data-flow-node="${lastId}"]`)).toHaveCount(0);
  await selectNode(first.id);
  assert.ok(Math.abs((await textBounds()).right) < 2);
  await returnMap(); await openGroup('flow-layout');
  await field('每行数量').fill('2');
  await field('每页行数（0 为滚动）').fill('3');
  await field('流程图排列').selectOption('flow');
  const visibility = page!.locator('.ui-inspector-view:not([hidden]) [data-ui-inspector-group="visibility"]');
  if (await visibility.getAttribute('open') === null) await visibility.locator(':scope > summary').click();
  await field('控件不透明度 %').fill('75');
  await save(); assert.equal((await read()).ui.components.find(component => component.id === map.id)?.style?.opacity, .75);
  await field('控件不透明度 %').fill('100'); await save();
  checks.push('目录节点选择可自动翻页，翻页按钮可操作；目录样例复用真实尺寸和对齐；整图透明度仍可单独调整。');

  phase = 'narrow panel and saved reopen';
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 800));
  await editBase(); await openGroup('flow-base-caption-parts');
  evidence.panel = await flow().evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }));
  assert.ok((evidence.panel as { scrollWidth: number; width: number }).scrollWidth <= (evidence.panel as { width: number }).width + 2, JSON.stringify(evidence.panel));
  await page!.screenshot({ path: path.join(output, 'narrow-panel.png') });
  await returnMap(); await openGroup('flow-style'); await flow().getByRole('button', { name: '管理全部外观预设', exact: true }).click(); await scope('preset');
  await field('编辑节点外观预设').selectOption('shared_style');
  evidence.presetPanel = await flow().evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }));
  assert.ok((evidence.presetPanel as { scrollWidth: number; width: number }).scrollWidth <= (evidence.presetPanel as { width: number }).width + 2, JSON.stringify(evidence.presetPanel));
  await field('编辑节点外观预设').scrollIntoViewIfNeeded();
  await page!.screenshot({ path: path.join(output, 'narrow-preset-panel.png') });
  await app!.close(); app = undefined; await launch(); await selectNode(first.id);
  await expect(field('节点文字第 2 段')).toHaveValue('醉梦 {原样}');
  await expect(field('当前节点外观预设')).toHaveValue('shared_style');
  await page!.getByRole('button', { name: '编辑这个外观预设', exact: true }).click();
  await openGroup('flow-preset-base-text');
  await expect(field('预设字号')).toHaveValue('40');
  await expect(field('预设文字对齐')).toHaveValue('right');
  checks.push('窄面板没有横向溢出；重开保留分段、样式分配、对齐和继承值。');

  phase = 'pending script guard with multiple components selected';
  await app!.close(); app = undefined;
  const unfinished = await read(); unfinished.scriptText!.content += '\n@不存在的剧情命令：尚未完成';
  await fs.writeFile(file, JSON.stringify(unfinished));
  await launch();
  await expect(flow()).toContainText('剧本文本有尚未同步的修改');
  await page!.locator('[data-hierarchy-id="qa_decoration"]').click();
  await page!.locator('[data-hierarchy-id="qa_map"]').click({ modifiers: ['Control'] });
  await expect(page!.locator('[data-hierarchy-id][aria-selected="true"]')).toHaveCount(2);
  await expect(flow()).toHaveCount(0);
  await expect(field('选择剧情图节点')).toHaveCount(0);
  // Internal flow fields require one selected map. Multiple selection must not
  // leave a single-map inspector available; selecting one map restores guards.
  await page!.locator('[data-hierarchy-id="qa_map"]').click();
  await openGroup('flow-mode'); await flowGroup('flow-mode').getByRole('button', { name: /^管理显示的剧情/ }).click(); await scope('sources');
  await expect(field('显示小章节：第一小节')).toBeDisabled();
  await editBase(); await openGroup('flow-base-base-text'); await expect(field('基础字号')).toBeEnabled();
  assert.equal((await read()).scriptText!.content, unfinished.scriptText!.content);
  checks.push('未同步剧本时多选控件也不能绕过内容保护，外观仍可调整，原文本保持完整。');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, evidence, errors }, null, 2));
} catch (error) {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, error: String(error), checks, evidence, errors }, null, 2));
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); throw error;
} finally {
  await app?.close().catch(() => undefined);
  const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); assert.deepEqual(cleanup.errors, []);
  console.log(output);
}
