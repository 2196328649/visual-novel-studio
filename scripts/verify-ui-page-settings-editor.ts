import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { effectiveUiComponents, projectSchema } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';
import { createUiPageSettingsFixture } from './lib/ui-page-settings-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openUiPageOptions, openUiPageSettings, openUiGlobalSettings, resetUiPanelLayout, selectUiDesignScheme } from './lib/ui-design-controls';
import { openUiPreviewWindow, showUiPreviewTestData } from './lib/ui-preview-window';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Use only the isolated development editor.');
const root = path.resolve('.'), output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? path.join(root, 'artifacts'), 'ui-page-settings-editor', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json'), builtRenderer = process.env.VNS_VERIFY_BUILT_RENDERER === '1';
const f = createUiPageSettingsFixture(), original = structuredClone(f.project);
const checks: string[] = [], errors: string[] = [], processes: { pid?: number; exited: boolean }[] = [];
const report: Record<string, unknown> = { status: 'running', renderer: builtRenderer ? 'built' : 'development', checks, errors, processes };
let app: ElectronApplication | undefined, page: Page | undefined, server: ViteDevServer | undefined, phase = 'setup';
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const mode = (name: string) => page!.getByLabel('界面编辑模式').getByRole('button', { name, exact: true });
const row = (id: string) => page!.locator('[data-hierarchy-id="' + id + '"]');
const object = (id: string) => page!.locator('.ui-canvas [data-component-id="' + id + '"]');
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const record = (message: string) => { checks.push(message); console.log('PASS ' + checks.length + ': ' + message); };
async function save() {
  if (await button('保存界面').isEnabled()) await button('保存界面').click();
  await expect(page!.locator('.ui-save-status')).toHaveText('已保存');
  await expect(page!.locator('.ui-save-status')).toHaveAttribute('data-dirty', 'false');
  return read();
}
async function size(width: number, height: number) {
  const window = await app!.browserWindow(page!);
  await window.evaluate((window, value) => { if (window.isMinimized()) window.restore(); if (window.isMaximized()) window.unmaximize(); window.setContentSize(value.width, value.height); }, { width, height });
  await expect.poll(() => page!.evaluate(expected => Math.abs(innerWidth - expected), width)).toBeLessThanOrEqual(2);
}
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile'), devUrl: server ? 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port : undefined });
  page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(f.project.name, { timeout: 45000 });
  if (builtRenderer) assert.equal(fileURLToPath(page.url()), path.join(root, 'dist/index.html'));
  report.rendererUrl = page.url(); await size(1440, 940); await page.locator('[data-workspace-tab="ui"]').click();
}
async function close() {
  if (!app) return;
  const child = app.process(); await app.close();
  const state = { pid: child.pid, exited: child.exitCode !== null || child.signalCode !== null };
  processes.push(state); assert.equal(state.exited, true); app = undefined;
}
async function openPage(id: string) {
  await mode('设计').click(); await page!.getByLabel('设计页面', { exact: true }).selectOption(id);
  await expect(page!.getByRole('dialog', { name: '保存界面修改', exact: true })).toHaveCount(0);
  await expect(page!.getByLabel('当前页面设置', { exact: true })).toHaveAttribute('data-page-id', id.startsWith('page_') ? id : 'ui:' + id);
}
async function font(id: string) {
  return object(id).evaluate(element => Number((parseFloat(getComputedStyle(element).fontSize) / (element.closest('.ui-canvas')!.getBoundingClientRect().width / 1280)).toFixed(3)));
}
async function checkPanelWidth() {
  await expect.poll(() => page!.locator('.ui-inspector-shell .inspector-scroll').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect.poll(() => page!.locator('.ui-editor-header').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}
try {
  await fs.mkdir(path.dirname(projectFile), { recursive: true }); await saveProject(projectFile, f.project);
  if (!builtRenderer) { server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/work/**', '**/resources/**', '**/release/**'] } } }); await server.listen(); }
  await launch(); await openUiPageSettings(page!);
  phase = 'page-scoped appearance and draft navigation';
  await expect(page!.getByRole('tab', { name: '游戏设置', exact: true })).toHaveCount(0);
  await expect(page!.getByLabel('当前页面设置', { exact: true })).toContainText('派生方案');
  await expect(page!.getByLabel('页面默认字号', { exact: true })).toHaveValue('30');
  await page!.getByLabel('页面默认字号', { exact: true }).fill('42');
  await expect.poll(() => font('page_main_text')).toBe(42);
  await button('撤销').click(); await expect.poll(() => font('page_main_text')).toBe(30);
  await button('重做').click(); await expect.poll(() => font('page_main_text')).toBe(42);
  await openPage('preferences'); await expect(page!.getByLabel('页面默认字号', { exact: true })).toHaveValue('28');
  await openPage('main'); await expect(page!.getByLabel('页面默认字号', { exact: true })).toHaveValue('42');
  assert.deepEqual((await read()).ui, original.ui);
  await page!.getByLabel('页面文字色', { exact: true }).fill('#dba671');
  await expect(object('page_main_text')).toHaveCSS('color', 'rgb(219, 166, 113)');
  await button('恢复继承文字色').click(); await expect(object('page_main_text')).toHaveCSS('color', 'rgb(184, 217, 223)');
  await expect(page!.getByLabel('页面默认字号', { exact: true })).toHaveValue('42');
  await checkPanelWidth(); await page!.screenshot({ path: path.join(output, 'page-settings.png') });
  let saved = await save(); assert.deepEqual(saved.ui.instances![0].pages?.main?.appearance, { fontSize: 42 });
  assert.deepEqual(saved.ui.components, original.ui.components); assert.equal(saved.ui.fontSize, original.ui.fontSize); assert.deepEqual(saved.playerDefaults, original.playerDefaults);
  record('页面设置替代游戏设置；页面外观独立覆盖、逐项恢复继承，撤销重做与跨页面未保存草稿均正常。');

  phase = 'panel reset preserves selection, step and draft';
  await row('page_main_text').click(); await row('page_main_button').click({ modifiers: ['Control'] });
  await expect(page!.locator('[data-ui-selection-count]')).toHaveAttribute('data-ui-selection-count', '2');
  const step = page!.locator('.ui-nudge-step input'); await step.fill('7.5'); await step.press('Enter');
  await button('向右微调').click(); const disk = await read();
  const designBefore = await object('page_main_text').getAttribute('style');
  await page!.getByRole('separator', { name: '调整左侧面板宽度', exact: true }).press('ArrowRight');
  await page!.locator('[data-dock-panel="hierarchy"] > header > strong').dragTo(page!.locator('[data-dock-panel="inspector"] > header > strong'));
  await expect(page!.locator('[data-dock-panel="hierarchy"]')).toHaveAttribute('data-dock-slot', 'right');
  await expect(page!.locator('[data-dock-panel="settings"]').getByRole('button', { name: /恢复|重置/ })).toHaveCount(0);
  const otherLayouts = await page!.evaluate(() => ['vns-ui-logic-dock-v1', 'vns-performance-dock-v1', 'vns-blueprint-panel-widths-v1'].map(key => localStorage.getItem(key)));
  await resetUiPanelLayout(page!);
  await expect(page!.locator('[data-dock-panel="hierarchy"]')).toHaveAttribute('data-dock-slot', 'left');
  await expect(page!.getByRole('separator', { name: '调整左侧面板宽度', exact: true })).toHaveAttribute('aria-valuenow', '18');
  await expect(page!.locator('[data-ui-selection-count]')).toHaveAttribute('data-ui-selection-count', '2'); await expect(step).toHaveValue('7.5');
  await expect(object('page_main_text')).toHaveAttribute('style', designBefore!);
  assert.deepEqual(await read(), disk); await expect(page!.locator('.ui-save-status')).toHaveAttribute('data-dirty', 'true');
  assert.deepEqual(await page!.evaluate(() => ['vns-ui-logic-dock-v1', 'vns-performance-dock-v1', 'vns-blueprint-panel-widths-v1'].map(key => localStorage.getItem(key))), otherLayouts);
  await button('撤销').click(); await save();
  record('恢复面板布局收进顶部菜单，只恢复编辑器面板；保留多选、微调步长、未保存修改、撤销记录和其他工作区布局。');

  phase = 'page interface and private state';
  // Multiple selection uses the common-properties panel. Return to one object
  // before switching to the ordinary inspector's page settings tab.
  await row('page_main_text').click();
  await expect(page!.locator('[data-ui-selection-count]')).toHaveAttribute('data-ui-selection-count', '1');
  let settings = await openUiPageSettings(page!, '输入与结果');
  const inputs = settings.getByLabel('页面输入与结果', { exact: true });
  const beforeInterface = await fs.readFile(projectFile, 'utf8');
  await inputs.locator('[data-page-parameter-direction="inputs"]').getByRole('button', { name: '新增', exact: true }).click();
  await expect(inputs.getByLabel('页面参数名称', { exact: true })).toBeFocused();
  await expect(inputs.getByRole('button', { name: '创建参数', exact: true })).toBeDisabled();
  await inputs.getByLabel('页面参数名称', { exact: true }).fill('取消的页面输入');
  await inputs.getByRole('button', { name: '取消', exact: true }).click();
  await expect(inputs.getByRole('form', { name: '创建页面参数', exact: true })).toHaveCount(0);
  await expect(button('保存界面')).toBeDisabled(); assert.equal(await fs.readFile(projectFile, 'utf8'), beforeInterface);
  await inputs.locator('.ui-page-parameters').first().getByRole('button', { name: '新增', exact: true }).click();
  await inputs.getByLabel('页面参数名称', { exact: true }).fill('奖励值'); await inputs.getByLabel('页面参数类型', { exact: true }).selectOption('number');
  await inputs.getByRole('button', { name: '创建参数', exact: true }).click();
  await inputs.locator('.ui-page-parameters').last().getByRole('button', { name: '新增', exact: true }).click();
  await inputs.getByLabel('页面参数名称', { exact: true }).fill('已确认'); await inputs.getByLabel('页面参数类型', { exact: true }).selectOption('boolean');
  await inputs.getByRole('button', { name: '创建参数', exact: true }).click();
  await inputs.getByRole('button', { name: '编辑页面输入 奖励值', exact: true }).click();
  await expect(inputs.locator('[data-page-parameter-direction="inputs"] [data-page-parameter-details-id]')).toHaveCount(1);
  await expect(inputs.getByLabel('奖励值 · 默认值', { exact: true })).toHaveValue('0');
  await inputs.getByRole('button', { name: '编辑页面结果 已确认', exact: true }).click();
  await expect(inputs.locator('[data-page-parameter-direction="outputs"] [data-page-parameter-details-id]')).toHaveCount(1);
  await expect(inputs.getByLabel('已确认 · 默认值', { exact: true })).toHaveValue('false');
  settings = await openUiPageSettings(page!, '页面状态');
  const beforePageState = await fs.readFile(projectFile, 'utf8');
  await settings.getByRole('button', { name: '新建页面状态', exact: true }).click();
  await expect(settings.getByLabel('变量名称', { exact: true })).toBeFocused();
  await settings.getByLabel('变量名称', { exact: true }).fill('取消的页面状态');
  await settings.getByRole('button', { name: '取消', exact: true }).click();
  await expect(settings.getByRole('form', { name: '创建状态变量', exact: true })).toHaveCount(0);
  assert.equal(await fs.readFile(projectFile, 'utf8'), beforePageState);
  await settings.getByRole('button', { name: '新建页面状态', exact: true }).click();
  await settings.getByLabel('变量名称', { exact: true }).fill('当前选择'); await settings.getByLabel('变量类型', { exact: true }).selectOption('number');
  await settings.getByRole('button', { name: '创建变量', exact: true }).click();
  await expect(settings.getByRole('button', { name: '编辑变量 当前选择', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(settings.locator('.blueprint-state-definition')).toHaveCount(1);
  await expect(settings.getByLabel('状态列表作用域', { exact: true })).toHaveCount(0);
  saved = await save(); assert.equal(saved.ui.pageInterfaces?.['ui:main'].inputs[0].name, '奖励值'); assert.equal(saved.ui.pageInterfaces?.['ui:main'].outputs[0].name, '已确认');
  assert.equal(saved.ui.pageVariables?.['ui:main']?.[0].name, '当前选择'); assert.deepEqual(saved.variables, original.variables);
  await settings.getByRole('button', { name: '读取 当前选择', exact: true }).click();
  await expect(mode('事件图')).toHaveAttribute('aria-pressed', 'true');
  saved = await save(); const own = saved.blueprints.find(graph => graph.uiPageId === 'ui:main' && graph.uiInstanceId === 'page_scheme')!;
  assert.ok(own.nodes.some(node => node.type === 'getVariable' && node.properties.scope === 'page' && node.properties.pageId === 'ui:main'));
  assert.deepEqual(saved.blueprints.find(graph => graph.id === f.inherited.id), original.blueprints.find(graph => graph.id === f.inherited.id));
  await expect(page!.getByLabel('当前页面事件图', { exact: true })).toHaveValue(own.id);
  record('输入、结果和页面状态统一可取消的新项与单项详情，零值和假值保留；读取进入本页事件图，定义不复制为全局参数，也不改写继承蓝图。');

  phase = 'local lifecycle shortcuts';
  await mode('设计').click(); await openUiPageSettings(page!, '页面事件'); await button('编辑请求关闭时事件').click();
  saved = await save(); const ownWithEvent = saved.blueprints.find(graph => graph.id === own.id)!;
  assert.equal(ownWithEvent.nodes.filter(node => node.type === 'eventPage' && node.properties.phase === 'closeRequested').length, 1);
  await mode('设计').click(); await openUiPageSettings(page!, '页面事件'); await button('编辑请求关闭时事件').click();
  await expect(page!.locator('.ui-save-status')).toHaveAttribute('data-dirty', 'false');
  assert.deepEqual((await read()).blueprints.find(graph => graph.id === own.id), ownWithEvent);
  record('显示、关闭请求和关闭完成事件可直达，重复打开复用入口，不产生重复事件或多余修改。');

  phase = 'shared parameter binding and independent preview';
  await mode('设计').click(); settings = await openUiPageSettings(page!, '属性关联参数');
  const beforeBinding = await read();
  await settings.getByLabel('联动组件', { exact: true }).selectOption('page_main_button'); await settings.getByLabel('联动属性', { exact: true }).selectOption('visible');
  await settings.getByLabel('属性控制方式', { exact: true }).selectOption('follow'); await settings.getByLabel('联动参数', { exact: true }).selectOption('page_unlocked');
  await settings.getByRole('button', { name: '应用关联', exact: true }).click();
  await expect(mode('设计')).toHaveAttribute('aria-pressed', 'true'); saved = await save();
  const binding = effectiveUiComponents(saved.ui).find(component => component.id === 'page_main_button')!;
  assert.deepEqual(binding.propertyControls?.visible, { mode: 'follow', parameterId: 'page_unlocked' });
  assert.deepEqual(saved.blueprints, beforeBinding.blueprints); assert.deepEqual(saved.timelinePresets, beforeBinding.timelinePresets); assert.deepEqual(saved.variables, original.variables);
  assert.deepEqual(saved.ui.components, beforeBinding.ui.components);
  const preview = await openUiPreviewWindow(app!, page!); preview.on('pageerror', error => errors.push(error.message));
  await showUiPreviewTestData(preview); const testValue = preview.getByLabel('预演参数 已解锁', { exact: true });
  await expect(preview.locator('[data-preview-component="page_main_button"]')).toHaveCount(0);
  await testValue.selectOption('true'); await expect(preview.locator('[data-preview-component="page_main_button"]')).toBeVisible();
  await testValue.selectOption('false'); await expect(preview.locator('[data-preview-component="page_main_button"]')).toHaveCount(0);
  await preview.screenshot({ path: path.join(output, 'parameter-preview.png') }); await preview.close();
  record('属性关联直接引用原参数并只写入当前派生控件，不生成轮询蓝图；真实独立预览中修改测试值立即控制控件显示，测试值不污染工程。');

  phase = 'custom pages, global settings and persistence';
  await openPage('page_notes'); { const size = page!.getByLabel('页面默认字号', { exact: true }); await size.selectText(); await size.pressSequentially('38'); await expect(size).toHaveValue('38'); await size.blur(); }
  await page!.getByLabel('页面默认字体', { exact: true }).selectOption('@builtin'); await page!.getByLabel('页面按钮悬停音效', { exact: true }).selectOption('@silent');
  settings = await openUiPageSettings(page!, '页面行为'); await settings.locator('.ui-page-opening-details > summary').click(); await settings.getByLabel('页面打开输入方式', { exact: true }).selectOption('modeless');
  await openPage('page_overlay'); await expect(page!.getByLabel('页面默认字号', { exact: true })).toHaveValue('28');
  await openPage('page_notes'); await expect(page!.getByLabel('页面默认字号', { exact: true })).toHaveValue('38');
  await button('全局主题与玩家设置').click(); const global = page!.getByRole('dialog', { name: '作品设置', exact: true }); await expect(global.getByText('全局主题与玩家设置', { exact: true })).toBeVisible();
  await expect(global.getByLabel('菜单快捷键打开', { exact: true })).toBeVisible();
  await global.getByLabel('菜单快捷键打开', { exact: true }).selectOption('pause');
  assert.equal((await read()).ui.menuShortcutPage, original.ui.menuShortcutPage);
  await global.getByRole('button', { name: '完成', exact: true }).click(); saved = await save();
  const notes = saved.ui.customPages.find(page => page.id === 'page_notes')!;
  assert.deepEqual(notes.appearance, { fontSize: 38, fontAssetId: '', hoverSoundId: '' }); assert.equal(notes.modal, false);
  assert.deepEqual(saved.ui.customPages.find(page => page.id === 'page_overlay'), original.ui.customPages.find(page => page.id === 'page_overlay'));
  assert.deepEqual(saved.playerDefaults, original.playerDefaults);
  assert.equal(saved.ui.menuShortcutPage, 'pause');
  const expected = saved; await close(); await launch(); await openPage('page_notes');
  await expect(page!.getByLabel('页面默认字号', { exact: true })).toHaveValue('38'); assert.deepEqual(await read(), expected);
  await openPage('main'); await selectUiDesignScheme(page!, ''); await openUiPageSettings(page!); await expect(page!.getByLabel('页面默认字号', { exact: true })).toHaveValue('30');
  await selectUiDesignScheme(page!, 'page_scheme'); await openUiPageSettings(page!); await expect(page!.getByLabel('页面默认字号', { exact: true })).toHaveValue('42'); await save();
  record('自定义页面外观与模态互相隔离；全局设置仍可达，保存重开和方案切换保留各自覆盖。');

  phase = 'animation defaults and independent panel reset';
  const designLayout = await page!.evaluate(() => localStorage.getItem('vns-ui-dock-v1'));
  await mode('事件图').click();
  await page!.locator('[data-ui-animation-id="page_theme_animation"]').getByRole('button', { name: '页面外观动画预览', exact: true }).click();
  await expect(page!.getByLabel('控件动画画布', { exact: true })).toBeVisible();
  await expect.poll(() => page!.locator('[data-animation-preview="page_main_text"]').evaluate(element => Math.round(parseFloat(getComputedStyle(element).fontSize) * 1280 / element.closest('.ui-animation-preview')!.getBoundingClientRect().width))).toBe(42);
  await page!.getByRole('separator', { name: '调整左侧面板宽度', exact: true }).press('ArrowRight');
  await button('恢复默认界面布局').click();
  await expect(page!.getByRole('separator', { name: '调整左侧面板宽度', exact: true })).toHaveAttribute('aria-valuenow', '18');
  assert.equal(await page!.evaluate(() => localStorage.getItem('vns-ui-dock-v1')), designLayout);
  await expect(page!.locator('.ui-save-status')).toHaveAttribute('data-dirty', 'false');
  await page!.screenshot({ path: path.join(output, 'page-settings-animation.png') });
  await button('返回事件图').click(); await mode('设计').click();
  record('动画画布也沿用本页默认外观；动画面板仍可单独恢复布局，不影响设计工作区和工程数据。');

  phase = 'responsive and light appearance';
  await size(1024, 768); await openUiPageSettings(page!, '属性关联参数'); await checkPanelWidth();
  await page!.screenshot({ path: path.join(output, 'page-settings-narrow.png') });
  await page!.locator('[data-dock-panel="inspector"] > header > strong').dragTo(page!.locator('[data-dock-panel="hierarchy"] > header > strong')); await checkPanelWidth();
  await page!.screenshot({ path: path.join(output, 'page-settings-docked.png') }); await resetUiPanelLayout(page!);
  await button('作品设置').click(); const dialog = page!.getByRole('dialog', { name: '作品设置', exact: true });
  await dialog.getByRole('button', { name: '编辑器外观', exact: true }).click(); await dialog.locator('.editor-theme-card').filter({ has: page!.locator('strong', { hasText: '亮白' }) }).click(); await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await size(1440, 940); await openUiPageSettings(page!); await checkPanelWidth(); await page!.screenshot({ path: path.join(output, 'page-settings-light.png') });
  await expect(button('保存界面')).toBeDisabled(); assert.deepEqual(errors, []);
  record('窄窗口、面板换位和浅色主题无横向溢出；页面导航、折叠分组与单行顶部工具栏保持可用。');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.phase = phase; report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1; console.error(error);
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
} finally {
  try { await close(); } catch (error) { report.status = 'failed'; report.closeError = String(error); process.exitCode = 1; }
  try { await server?.close(); } catch (error) { report.status = 'failed'; report.serverError = String(error); process.exitCode = 1; }
  try { if (app) throw new Error('Fixture is still running.'); report.cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []); } catch (error) { report.status = 'failed'; report.cleanupError = String(error); process.exitCode = 1; }
  await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
}
