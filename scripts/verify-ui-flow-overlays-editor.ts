import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { uiFlowOverlayFixture } from './lib/ui-flow-overlay-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { saveProject } from '../src/desktop/project-store';
import { projectSchema } from '../src/core/model';
import { uiPageFlowEvents } from '../src/core/ui-page-flow';
import { gameFlowCanvasEdges, pageFlowNodeId } from '../src/renderer/game-flow-view';
import { uiPageOpeningPresets } from '../src/core/ui-page-opening';
import { openUiPageSettings } from './lib/ui-design-controls';
import { openDisclosure } from './lib/ui-disclosures';

const root = path.resolve('.'), output = path.resolve('artifacts/ui-flow-overlays-editor', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json'), f = uiFlowOverlayFixture();
const checks: string[] = [], errors: string[] = [], processes: unknown[] = [];
let app: ElectronApplication | undefined, page: Page | undefined, failure: string | undefined, phase = 'prepare';
await fs.mkdir(path.dirname(projectFile), { recursive: true }); await saveProject(projectFile, f.project);
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const node = (id: string) => page!.locator('.react-flow__node[data-id="' + id + '"]');
const button = (name: string) => page!.getByRole('button', { name, exact: true });
async function save() { await button('保存工程').click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); }
async function locate(name: string) {
  await page!.getByLabel('搜索流程图', { exact: true }).fill(name);
  await page!.getByRole('region', { name: '流程图搜索结果' }).getByRole('button').filter({ has: page!.locator('strong', { hasText: new RegExp('^' + name + '$') }) }).first().click();
  await page!.waitForTimeout(230);
}
async function fit() {
  await button('适应全图').click();
  await expect.poll(() => page!.evaluate(async () => {
    const canvas = document.querySelector('.unified-flow-body .react-flow'), viewport = canvas?.querySelector('.react-flow__viewport');
    if (!canvas || !viewport) return false;
    const transform = getComputedStyle(viewport).transform, bounds = canvas.getBoundingClientRect();
    for (let frame = 0; frame < 8; frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (getComputedStyle(viewport).transform !== transform) return false;
    }
    return [...canvas.querySelectorAll('.react-flow__node')].every(node => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0 && box.left >= bounds.left - 1 && box.right <= bounds.right + 1 && box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1; });
  }), { timeout: 8000, message: 'Wait for the flow fit animation and measured cards before dragging.' }).toBe(true);
}
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') }); page = await app.firstWindow();
  page.setDefaultTimeout(25000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(f.project.name);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w.isMaximized()) w.unmaximize(); w.setContentSize(1440, 960); });
  await page.locator('[data-workspace-tab="flowchart"]').click();
}
async function close() { if (!app) return; const process = app.process(); await app.close(); processes.push({ pid: process.pid, exited: process.exitCode !== null || process.signalCode !== null }); app = undefined; }
try {
  await launch(); await locate('标题菜单');
  phase = 'real title exits';
  const initialEvents = uiPageFlowEvents(f.project, 'ui:main');
  for (const event of initialEvents) await expect(node('flow:title').locator('.source[data-handleid="' + event.id + '"]')).toHaveCount(1);
  const loadEvent = initialEvents.find(event => event.nativeSlot === 'main:load')!;
  await page!.getByLabel(loadEvent.name + ' · 流程目标', { exact: true }).selectOption('page:' + f.hud.id + ':load'); await save();
  let stored = await read(), authored = stored.ui.components.find(c => c.nativeSlot === 'main:load')!;
  expect(authored.action).toBe('blueprint'); expect(uiPageFlowEvents(stored, 'ui:main').find(e => e.id === loadEvent.id)?.routes[0].target).toMatchObject({ kind: 'page', pageId: f.hud.id });
  await page!.getByRole('button', { name: /^撤销/ }).first().click(); await save(); expect((await read()).ui.components.some(c => c.nativeSlot === 'main:load')).toBe(false);
  await page!.getByRole('button', { name: /^重做/ }).first().click(); await save();
  checks.push('标题出口对应实际按钮；系统按钮改接生成可编辑控件，原系统按钮不复现，一步撤销重做。');
  phase = 'same target preserves opening'; await locate('标题菜单');
  const openingSection = page!.getByRole('region', { name: '页面事件 ' + loadEvent.name });
  await openingSection.getByLabel(loadEvent.name + '打开预设', { exact: true }).selectOption('dialog'); await save();
  const beforeReconnect = await read(), sameTarget = gameFlowCanvasEdges(beforeReconnect).find(edge => edge.pageEvent?.eventId === loadEvent.id)!.target;
  await fit();
  const sameFrom = await node('flow:title').locator('.source[data-handleid="' + loadEvent.id + '"]').boundingBox(), sameTo = await node(sameTarget).locator('.target[data-handleid="in"]').boundingBox();
  if (!sameFrom || !sameTo) throw new Error('Missing handles for the current page target');
  await page!.mouse.move(sameFrom.x + sameFrom.width / 2, sameFrom.y + sameFrom.height / 2); await page!.mouse.down();
  await page!.mouse.move(sameTo.x + sameTo.width / 2, sameTo.y + sameTo.height / 2, { steps: 20 }); await page!.mouse.up(); await save();
  const afterReconnect = await read(); expect(afterReconnect.ui).toEqual(beforeReconnect.ui); expect(afterReconnect.blueprints).toEqual(beforeReconnect.blueprints);
  expect(uiPageFlowEvents(afterReconnect, 'ui:main').find(event => event.id === loadEvent.id)!.routes[0].opening).toEqual(uiPageOpeningPresets.dialog.value);
  await locate('标题菜单'); await openingSection.getByRole('button', { name: '恢复页面默认打开方式', exact: true }).click(); await save();
  expect(uiPageFlowEvents(await read(), 'ui:main').find(event => event.id === loadEvent.id)!.routes[0].opening).toEqual({});
  await expect(openingSection.getByLabel(loadEvent.name + '打开预设', { exact: true })).toHaveValue('hud');
  await page!.getByRole('button', { name: /^撤销/ }).first().click(); await save();
  expect(uiPageFlowEvents(await read(), 'ui:main').find(event => event.id === loadEvent.id)!.routes[0].opening).toEqual(uiPageOpeningPresets.dialog.value);
  await page!.getByRole('button', { name: /^重做/ }).first().click(); await save();
  expect(uiPageFlowEvents(await read(), 'ui:main').find(event => event.id === loadEvent.id)!.routes[0].opening).toEqual({});
  checks.push('真实拖线回原页面保留本次打开设置，不创建新按钮或蓝图；明确恢复页面默认值可一步撤销重做。');
  phase = 'mouse reconnect'; await fit();
  const sourceHandle = node('flow:title').locator('.source[data-handleid="' + loadEvent.id + '"]');
  await expect(sourceHandle).toHaveCount(1);
  const from = await node('flow:title').locator('.source[data-handleid="' + loadEvent.id + '"]').boundingBox();
  const to = await node('flow:load').locator('.target[data-handleid="in"]').boundingBox(); if (!from || !to) throw new Error('Missing menu handles');
  await fs.writeFile(path.join(output, 'drag-hit-targets.json'), JSON.stringify(await page!.evaluate(({ from, to }) => [from, to].map(box => { const el = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return { box, tag: el?.tagName, className: el?.getAttribute('class'), handle: el?.getAttribute('data-handleid'), node: el?.closest('.react-flow__node')?.getAttribute('data-id') }; }), { from, to }), null, 2));
  await page!.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page!.mouse.down(); await page!.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 }); await page!.mouse.up(); await save();
  stored = await read(); expect(uiPageFlowEvents(stored, 'ui:main').find(e => e.id === loadEvent.id)?.routes[0].target).toMatchObject({ kind: 'page', pageId: 'ui:save', saveMode: 'load' });
  await locate('标题菜单'); await page!.getByLabel(loadEvent.name + ' · 流程目标', { exact: true }).selectOption('page:' + f.hud.id + ':load'); await save();
  const eventSection = page!.getByRole('region', { name: '页面事件 ' + loadEvent.name });
  await eventSection.getByRole('button', { name: '定位原按钮 ↗', exact: true }).click();
  await expect(page!.locator('[data-hierarchy-id="' + authored.id + '"]')).toBeVisible();
  await openDisclosure(page!, '点击与交互');
  await page!.getByLabel('点击行为', { exact: true }).selectOption('preferences'); await button('保存界面').click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  await page!.locator('[data-workspace-tab="flowchart"]').click(); await locate('标题菜单');
  await expect(page!.getByLabel(loadEvent.name + ' · 流程目标', { exact: true })).toHaveValue('page:ui:preferences:load');
  checks.push('实际鼠标拖线同步到按钮；定位原按钮修改点击行为，流程图立即反映同一份数据。');
  phase = 'page navigation and complex events';
  await node('flow:title').dblclick(); await expect(page!.getByRole('region', { name: '流程图', exact: true })).toHaveAttribute('data-flow-scope', 'page:ui:main');
  await page!.getByLabel('查看页面流程', { exact: true }).selectOption(f.parent.id);
  await expect(page!.getByRole('region', { name: '流程图', exact: true })).toHaveAttribute('data-flow-scope', 'page:' + f.parent.id);
  await expect(page!.getByLabel('打开常驻层 · 流程目标', { exact: true })).toBeDisabled();
  await expect(page!.getByRole('button', { name: '事件图 ↗', exact: true }).first()).toBeVisible();
  await page!.screenshot({ path: path.join(output, 'page-events.png') });
  await button('返回上一级').click(); await expect(page!.getByRole('region', { name: '流程图', exact: true })).toHaveAttribute('data-flow-scope', 'page:ui:main');
  checks.push('同一流程图进入页面事件，路径可返回；复杂调用显示真实目的地且不会被拖线覆盖。');
  phase = 'overlay defaults and draft';
  await page!.getByLabel('查看页面流程', { exact: true }).selectOption(f.hud.id); await button('编辑界面').first().click();
  const settings = await openUiPageSettings(page!, '页面行为'); await expect(settings.getByLabel('页面打开预设', { exact: true })).toHaveValue('hud');
  await expect(page!.locator('.ui-canvas')).toHaveClass(/ui-overlay-canvas/);
  await settings.getByLabel('页面打开预设', { exact: true }).selectOption('notice');
  await expect(page!.locator('.ui-canvas')).toHaveClass(/ui-overlay-canvas/);
  expect((await read()).ui.customPages.find(p => p.id === f.hud.id)?.opening?.input).toBe('controls');
  await button('保存界面').click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  expect((await read()).ui.customPages.find(p => p.id === f.hud.id)?.opening).toMatchObject({ wait: false, input: 'none', autoClose: 3 });
  await page!.screenshot({ path: path.join(output, 'overlay-design.png') });
  checks.push('页面预设与透明画布同步；草稿保存前不改磁盘，保存后保留覆盖层配置。');
  phase = 'reopen and narrow'; await page!.locator('[data-workspace-tab="flowchart"]').click(); await page!.getByLabel('查看页面流程', { exact: true }).selectOption(f.hud.id); await close(); await launch();
  await expect(page!.getByRole('region', { name: '流程图', exact: true })).toHaveAttribute('data-flow-scope', 'page:' + f.hud.id);
  await expect(node(pageFlowNodeId(f.hud.id))).toBeVisible();
  for (const width of [1440, 1100]) { await app!.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size, 850), width); await fit(); await expect.poll(() => page!.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page!.screenshot({ path: path.join(output, 'page-flow-' + width + '.png') }); }
  checks.push('重开工程恢复页面层级；1440/1100 窗口未出现页面横向溢出。');
  expect(errors).toEqual([]);
} catch (error) { failure = String(error); console.error(error); process.exitCode = 1; await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); }
finally {
  await close(); await fs.copyFile(projectFile, path.join(output, 'fixture.project.json'));
  const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); if (cleanup.errors.length) { failure = [failure, JSON.stringify(cleanup.errors)].filter(Boolean).join('\n'); process.exitCode = 1; }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: failure ? 'failed' : 'passed', phase, checks, errors, processes, failure, cleanup }, null, 2)); console.log(path.join(output, 'report.json'));
}
