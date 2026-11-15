import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { uiPageFlowEvents } from '../src/core/ui-page-flow';
import { pageFlowNodeId } from '../src/renderer/game-flow-view';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { openDisclosure } from './lib/ui-disclosures';

const root = path.resolve('.');
const output = path.resolve('artifacts/ui-flow-exit-states-editor', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json');
const project = createProject('设置出口状态验收');
const template = projectSchema.parse(JSON.parse(await fs.readFile(path.join(root, 'resources/templates/aihong/project.vns.json'), 'utf8')));
const arrowIds = template.ui.components.filter(component => /^ai_settings_(voice)?languagesetting_btn(pre|next)$/.test(component.id)).map(component => component.id);
project.ui.pages = { preferences: { layout: 'custom' } };
project.ui.disabledPages = ['gallery'];
project.variables.push({ id: 'progress', name: '章节进度', type: 'number', initial: 0, persistent: false });
function addButton(id: string, text: string, extra: Partial<UiComponent> = {}) {
  const index = project.ui.components.length;
  project.ui.components.push({ id, name: text, text, page: 'preferences', kind: 'button', action: 'return',
    x: .05 + index % 3 * .3, y: .15 + Math.floor(index / 3) * .15, width: .25, height: .09, ...extra });
}
// Reproduce the unchanged older project, including its unused return action.
for (const [index, id] of arrowIds.entries()) addButton(id, '此示例仅含中文内容', { name: undefined, disabled: true, x: .05 + index * .06, y: .08, width: .04, height: .05 });
addButton('settings_return', '返回');
addButton('settings_voices', '角色音量', { action: 'voiceSettings' });
addButton('settings_title', '返回标题', { action: 'mainMenu' });
addButton('settings_quit', '退出游戏', { action: 'quit' });
addButton('settings_future', '后续开放入口', { disabled: true, flowEvent: { visible: true } });
addButton('settings_enable', '进度解锁入口', { enabledWhen: { kind: 'compare', variableId: 'progress', operator: 'gte', value: 2 } });
addButton('settings_visible', '显示受限入口', { visibleWhen: { kind: 'compare', variableId: 'progress', operator: 'gt', value: 0 } });
addButton('settings_both', '显示与启用入口', { visibleWhen: { kind: 'compare', variableId: 'progress', operator: 'gt', value: 0 }, enabledWhen: { kind: 'compare', variableId: 'progress', operator: 'gte', value: 2 } });
addButton('settings_unavailable', '画廊入口', { action: 'gallery' });
const checks: string[] = [], errors: string[] = [], processes: unknown[] = [];
let app: ElectronApplication | undefined, page: Page | undefined, failure: string | undefined, phase = 'prepare';
await fs.mkdir(path.dirname(projectFile), { recursive: true });
await saveProject(projectFile, project);
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const eventsNode = () => page!.locator('.react-flow__node[data-id="' + pageFlowNodeId('ui:preferences') + '"]');
const section = (name: string) => page!.getByRole('region', { name: '页面事件 ' + name, exact: true });
async function showSettings() {
  await page!.locator('[data-workspace-tab="flowchart"]').click();
  await page!.getByLabel('查看页面流程', { exact: true }).selectOption('ui:preferences');
  await expect(eventsNode()).toBeVisible();
}
async function saveUi() {
  await page!.getByRole('button', { name: '保存界面', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
}
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; if (window.isMaximized()) window.unmaximize(); window.setContentSize(1440, 960); });
}
async function close() {
  if (!app) return;
  const process = app.process(); await app.close();
  processes.push({ pid: process.pid, exited: process.exitCode !== null || process.signalCode !== null }); app = undefined;
}
try {
  await launch(); await showSettings();
  phase = 'settings placeholders';
  for (const id of arrowIds) await expect(eventsNode().locator('.source[data-handleid="button:' + id + '"]')).toHaveCount(0);
  for (const name of ['返回', '角色音量', '返回标题', '退出游戏']) await expect(section(name)).toBeVisible();
  await expect(page!.locator('.unified-flow-body')).not.toContainText('此示例仅含中文内容');
  const untouched = await read();
  expect(untouched.ui.components.filter(component => arrowIds.includes(component.id)).every(component => component.disabled && component.action === 'return')).toBe(true);
  checks.push('旧工程四个禁用语言箭头不生成出口或连线，返回/角色音量/标题/退出正常保留，查看不迁移或改写原数据。');

  phase = 'distinct states and actual conditions';
  await expect(section('后续开放入口').locator('h4 small')).toHaveText('已禁用');
  await expect(section('进度解锁入口').locator('h4 small')).toHaveText('有启用条件');
  await expect(section('进度解锁入口')).toContainText('启用条件：章节进度 ≥ 2');
  await expect(section('显示受限入口').locator('h4 small')).toHaveText('有显示条件');
  await expect(section('显示受限入口')).toContainText('显示条件：章节进度 > 0');
  await expect(section('显示与启用入口').locator('h4 small')).toHaveText('有显示条件 · 有启用条件');
  await expect(section('画廊入口').locator('h4 small')).toHaveText('目标已停用');
  await expect(eventsNode()).not.toContainText(' · 按条件');
  checks.push('画布和属性分开标出已禁用、目标停用、显示条件、启用条件；属性直接显示具体参数条件。');
  await page!.screenshot({ path: path.join(output, 'settings-exit-states.png') });

  phase = 'explicit publication and undo';
  await section('后续开放入口').getByRole('button', { name: '定位原按钮 ↗', exact: true }).click();
  await openDisclosure(page!, '点击与交互');
  await expect(page!.getByLabel('按钮流程图出口', { exact: true })).toHaveValue('show');
  await page!.getByLabel('按钮流程图出口', { exact: true }).selectOption('auto'); await saveUi();
  await showSettings(); await expect(section('后续开放入口')).toHaveCount(0);
  await page!.getByRole('button', { name: /^撤销/ }).first().click();
  await expect(section('后续开放入口').locator('h4 small')).toHaveText('已禁用');
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  checks.push('手动公开的禁用按钮可定位；恢复自动后隐藏，撤销后按已禁用恢复，不改变运行时启用状态。');

  phase = 'reenable and persist';
  await section('后续开放入口').getByRole('button', { name: '定位原按钮 ↗', exact: true }).click();
  await openDisclosure(page!, '点击与交互');
  await page!.getByLabel('按钮流程图出口', { exact: true }).selectOption('auto');
  await page!.getByLabel('暂时禁用', { exact: true }).uncheck(); await saveUi();
  await showSettings(); await expect(section('后续开放入口').locator('h4 small')).toHaveCount(0);
  const stored = await read();
  expect(stored.ui.components.find(component => component.id === 'settings_future')).toMatchObject({ disabled: false, action: 'return' });
  expect(uiPageFlowEvents(stored, 'ui:preferences').some(event => event.componentId === 'settings_future')).toBe(true);
  await close(); await launch(); await showSettings();
  await expect(section('后续开放入口').locator('h4 small')).toHaveCount(0);
  await expect(section('进度解锁入口')).toContainText('启用条件：章节进度 ≥ 2');
  for (const width of [1440, 1100]) {
    await app!.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width);
    await expect.poll(() => page!.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page!.screenshot({ path: path.join(output, 'settings-exits-' + width + '.png') });
  }
  checks.push('重新启用后自动恢复正常出口，保存重开仍正确；1440/1100窗口没有页面横向溢出。');
  expect(errors).toEqual([]);
} catch (error) {
  failure = String(error); console.error(error); process.exitCode = 1;
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
} finally {
  await close(); await fs.copyFile(projectFile, path.join(output, 'fixture.project.json'));
  const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']);
  if (cleanup.errors.length) { failure = [failure, JSON.stringify(cleanup.errors)].filter(Boolean).join('\n'); process.exitCode = 1; }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: failure ? 'failed' : 'passed', phase, checks, errors, processes, failure, cleanup }, null, 2));
  console.log(path.join(output, 'report.json'));
}
