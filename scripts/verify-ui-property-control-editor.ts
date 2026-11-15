import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { projectSchema, type Project, type UiComponent } from '../src/core/model';
import { projectGraphs } from '../src/core/project-resources';
import { createUiPropertyControlFixture, uiPropertyControlFixturePng } from './lib/ui-property-control-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openDisclosureAncestors } from './lib/ui-disclosures';
import { openUiPreviewForTest, showUiPreviewTestData } from './lib/ui-preview-window';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Use the final built renderer. This script never starts Vite or touches the installed editor.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Property-control acceptance requires the isolated source build.');
const root = path.resolve('.');
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/ui-property-control-2026-11-09', 'editor-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const projectFile = path.join(output, 'project/project.vns.json'), profile = path.join(output, 'profile');
const authorFile = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? '../我的视觉小说1/project.vns.json');
const fixture = createUiPropertyControlFixture({ editor: true });
const original = projectSchema.parse(fixture.project);
const component = (project: Project, id: string): UiComponent => {
  const result = [...project.ui.components, ...project.ui.customPages.flatMap(page => page.components)].find(item => item.id === id);
  assert.ok(result, 'Fixture component must exist: ' + id); return result;
};
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const checks: { name: string; durationMs: number }[] = [], errors: string[] = [], processes: { pid?: number; exited: boolean }[] = [];
const evidence: Record<string, unknown> = {};
const report: Record<string, unknown> = { status: 'running', checks, errors, processes, evidence, authorFile, compiledBuild: true, temporaryPaths: [path.dirname(projectFile), profile] };
let app: ElectronApplication | undefined, page: Page | undefined, preview: Page | undefined;
let authorHash: string | undefined, phase = 'setup', failure: unknown;
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const shell = () => page!.locator('.ui-inspector');
const view = () => shell().locator('.ui-inspector-view:not([hidden])');
const group = (id: string) => view().locator(`[data-ui-inspector-group="${id}"]`);
const field = (property: string) => view().locator(`.field[data-ui-property="${property}"]`);
const source = (property: string) => field(property).locator('.ui-property-control-value');
const canvasComponent = (id: string) => page!.locator(`.ui-canvas [data-component-id="${id}"]`);
const menu = () => page!.getByRole('menu', { name: '属性控制菜单', exact: true });
const dialog = () => page!.getByRole('dialog', { name: '属性控制设置', exact: true });
const settle = async () => page!.evaluate(async () => {
  await document.fonts.ready;
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
});
const persistReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));

async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile });
  processes.push({ pid: app.process().pid, exited: false });
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window.isMaximized()) window.unmaximize();
    window.setContentSize(1440, 960); window.webContents.setBackgroundThrottling(false);
  });
  await expect(page.locator('.project-title strong')).toHaveText(original.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="ui"]').click();
  await page.evaluate('globalThis.__name = value => value');
}
async function close() {
  if (!app) return;
  const owned = app, child = owned.process(), exited = () => child.exitCode !== null || child.signalCode !== null;
  try { await owned.close(); }
  finally {
    await expect.poll(exited, { timeout: 15000 }).toBe(true);
    const record = processes.find(item => item.pid === child.pid); if (record) record.exited = exited();
    if (exited()) { app = undefined; page = undefined; preview = undefined; }
  }
}
async function screenshot(name: string, windowPage = page!) {
  const url = windowPage.url();
  const png = await app!.evaluate(async ({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL() === url)!;
    return (await window.webContents.capturePage()).toPNG().toString('base64');
  }, url);
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(png, 'base64'));
}
async function check(name: string, run: () => Promise<void>) {
  phase = name; const start = Date.now(); await run();
  checks.push({ name, durationMs: Date.now() - start }); await persistReport(); console.log('通过：' + name);
}
async function select(id: string) {
  const container = original.ui.customPages.find(item => item.components.some(control => control.id === id)); assert.ok(container);
  const picker = page!.getByLabel('设计页面', { exact: true });
  if (await picker.inputValue() !== container.id) await picker.selectOption(container.id);
  await page!.locator(`[data-hierarchy-id="${id}"]`).click();
  await expect(page!.locator(`[data-hierarchy-id="${id}"]`)).toHaveAttribute('aria-selected', 'true');
  const search = shell().getByLabel('搜索控件属性', { exact: true });
  if (await search.inputValue()) await shell().getByRole('button', { name: '清除属性搜索', exact: true }).click();
  await settle(); await expect(view()).toHaveCount(1);
}
async function openGroup(id: string) {
  const target = group(id); await expect(target).toHaveCount(1); await openDisclosureAncestors(target);
  if (await target.getAttribute('open') === null) await target.locator(':scope > summary').click();
  await expect(target).toHaveJSProperty('open', true); return target;
}
async function reveal(property: string) {
  await openGroup(['opacity', 'visible'].includes(property) ? 'visibility' : ['x', 'y', 'width', 'height'].includes(property) ? 'layout' : ['align', 'fontSize', 'font'].includes(property) ? 'appearance' : 'content');
  await expect(field(property)).toHaveCount(1); await openDisclosureAncestors(field(property));
  await field(property).scrollIntoViewIfNeeded(); return field(property);
}
async function canvasPosition(id: string) {
  return canvasComponent(id).evaluate(element => {
    const bounds = element.getBoundingClientRect(), canvas = element.closest('.ui-canvas')!.getBoundingClientRect();
    return { x: (bounds.left - canvas.left) / canvas.width, y: (bounds.top - canvas.top) / canvas.height };
  });
}
async function openMenu(property: string, keyboard = false) {
  const label = (await reveal(property)).locator('.field-label');
  await expect(label).toHaveAttribute('tabindex', '0');
  if (keyboard) { await label.focus(); await label.press('Shift+F10'); }
  else await label.click({ button: 'right' });
  await expect(menu()).toBeVisible(); return label;
}
async function openSettings(property: string, keyboard = false) {
  await openMenu(property, keyboard);
  await menu().getByRole('menuitem', { name: '关联参数…', exact: true }).click();
  await expect(dialog()).toBeVisible(); return dialog();
}
async function apply(property: string, mode: 'follow' | 'sync', parameterId: string) {
  await openSettings(property);
  await dialog().getByLabel('控制方式', { exact: true }).selectOption(mode);
  await dialog().getByLabel('来源参数', { exact: true }).selectOption(parameterId);
  await dialog().getByRole('button', { name: '应用设置', exact: true }).click();
  await expect(dialog()).toHaveCount(0); await settle();
}
async function restore(property: string) {
  await openMenu(property);
  await menu().getByRole('menuitem', { name: '默认设置', exact: true }).click();
  await expect(menu()).toHaveCount(0); await settle();
}
async function save() {
  const button = page!.getByRole('button', { name: '保存界面', exact: true });
  if (await button.isEnabled()) await button.click();
  await expect(page!.locator('.ui-save-status')).toHaveText('已保存', { timeout: 30000 });
  await expect(button).toBeDisabled(); return read();
}
async function undo() { await page!.getByRole('button', { name: '撤销', exact: true }).click(); await settle(); }
async function redo() { await page!.getByRole('button', { name: '重做', exact: true }).click(); await settle(); }
async function unchanged(before: Project) {
  await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled();
  assert.deepEqual(await read(), before);
}
async function panelWidth(width: number) {
  const panel = await page!.locator('[data-dock-panel="inspector"]').boundingBox();
  const divider = await page!.getByRole('separator', { name: '调整右侧面板宽度', exact: true }).boundingBox(); assert.ok(panel && divider);
  const x = divider.x + divider.width / 2, y = divider.y + Math.min(100, divider.height / 2);
  await page!.mouse.move(x, y); await page!.mouse.down(); await page!.mouse.move(x + panel.width - width, y, { steps: 5 }); await page!.mouse.up();
  await settle(); const actual = await page!.locator('[data-dock-panel="inspector"]').boundingBox();
  assert.ok(actual && Math.abs(actual.width - width) <= 8, 'Requested inspector width: ' + width + ', actual: ' + actual?.width);
}
async function assertFits(target: Locator) {
  const result = await target.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const visible = Array.from(element.querySelectorAll<HTMLElement>('input,select,textarea,button,.field-label,summary')).filter(item => {
      const bounds = item.getBoundingClientRect();
      if (!bounds.width || !bounds.height || item.closest('[hidden],[inert]') || getComputedStyle(item).visibility === 'hidden') return false;
      for (let parent = item.closest('details'); parent; parent = parent.parentElement?.closest('details') ?? null) if (!parent.open && !parent.querySelector(':scope > summary')?.contains(item)) return false;
      return true;
    }).map(item => { const bounds = item.getBoundingClientRect(); return { label: item.getAttribute('aria-label') ?? item.textContent?.trim().slice(0, 60), left: bounds.left, right: bounds.right, width: bounds.width }; });
    return { left: rect.left, right: rect.right, width: element.clientWidth, scrollWidth: element.scrollWidth, visible };
  });
  assert.ok(result.scrollWidth <= result.width + 2, 'Horizontal overflow: ' + JSON.stringify(result));
  assert.deepEqual(result.visible.filter(item => item.left < result.left - 2 || item.right > result.right + 2), [], 'Interactive controls must fit their panel.');
  return result;
}

try {
  await fs.mkdir(path.join(path.dirname(projectFile), 'assets'), { recursive: true });
  authorHash = digest(await fs.readFile(authorFile)); report.authorSha256Before = authorHash;
  await fs.writeFile(projectFile, JSON.stringify(original, null, 2));
  for (const name of ['property-control-a.png', 'property-control-b.png']) await fs.writeFile(path.join(path.dirname(projectFile), 'assets', name), uiPropertyControlFixturePng());
  await launch();

  await check('文字输入和标签均支持右键与菜单快捷键，取消后恢复焦点且不改设计值', async () => {
    await select('pc_author'); await reveal('text'); const before = await save();
    const input = field('text').getByRole('textbox'); await expect(input).toHaveValue('设计原文');
    await input.click({ button: 'right' }); await expect(menu()).toBeVisible(); await page!.keyboard.press('Escape');
    await expect(menu()).toHaveCount(0); await expect(input).toBeFocused(); await expect(input).toHaveValue('设计原文');
    await input.press('ControlOrMeta+A');
    assert.deepEqual(await input.evaluate(element => ({ start: (element as HTMLInputElement).selectionStart, end: (element as HTMLInputElement).selectionEnd })), { start: 0, end: 4 }, 'The field menu must leave ordinary text-selection shortcuts available.');
    await input.press('Shift+F10'); await expect(menu()).toBeVisible(); await page!.keyboard.press('Escape');
    await expect(input).toBeFocused(); await expect(input).toHaveValue('设计原文');
    await input.press('ContextMenu'); await expect(menu()).toBeVisible(); await page!.keyboard.press('Escape'); await expect(input).toBeFocused();
    const label = await openMenu('text', true); await page!.keyboard.press('Escape');
    await expect(menu()).toHaveCount(0); await expect(label).toBeFocused();
    await openMenu('text'); await page!.keyboard.press('Escape'); await expect(label).toBeFocused();
    await input.click({ button: 'right' }); await menu().getByRole('menuitem', { name: '关联参数…', exact: true }).click();
    await expect(dialog()).toBeVisible(); await expect(dialog().getByLabel('控制方式', { exact: true })).toHaveValue('default');
    await dialog().getByLabel('控制方式', { exact: true }).selectOption('follow');
    const options = await dialog().getByLabel('来源参数', { exact: true }).locator('option').evaluateAll(items => items.map(item => (item as HTMLOptionElement).value));
    assert.ok(options.includes('pc_caption')); assert.ok(!options.includes('pc_number') && !options.includes('pc_flag'), 'Parameter candidates must match the attribute type.');
    await dialog().getByLabel('来源参数', { exact: true }).selectOption('pc_caption');
    await dialog().getByRole('button', { name: '取消', exact: true }).click(); await expect(dialog()).toHaveCount(0);
    await expect(input).toBeFocused();
    await unchanged(before); evidence.entry = { labelMouse: true, labelShiftF10: true, inputMouse: true, inputShiftF10: true, inputMenuKey: true, selectAll: true, escapeFocus: true, dialogFocus: true, cancelUnchanged: true, typedCandidates: options };
  });

  await check('数字、下拉和颜色值区共享属性菜单，帮助与操作按钮不触发关联', async () => {
    await select('pc_author'); const before = await save();
    const checkValue = async (value: Locator) => {
      const originalValue = await value.inputValue();
      await value.click({ button: 'right' }); await expect(menu()).toBeVisible();
      await page!.keyboard.press('Escape'); await expect(menu()).toHaveCount(0); await expect(value).toBeFocused();
      await value.press('Shift+F10'); await expect(menu()).toBeVisible();
      await page!.keyboard.press('Escape'); await expect(value).toBeFocused(); await expect(value).toHaveValue(originalValue);
    };
    await reveal('opacity'); await checkValue(field('opacity').getByRole('spinbutton'));
    await field('opacity').locator('.field-help > summary').click({ button: 'right' }); await expect(menu()).toHaveCount(0); await page!.keyboard.press('Escape');
    await reveal('align'); await checkValue(field('align').getByRole('combobox'));
    const color = view().locator('.ui-design-color-field[data-ui-property="textColor"]');
    await openDisclosureAncestors(color); await color.scrollIntoViewIfNeeded();
    await checkValue(color.locator('input[type="color"]'));
    await checkValue(color.locator('.ui-design-hex'));
    await checkValue(color.getByRole('spinbutton'));
    await color.locator('.ui-design-transparent').click({ button: 'right' }); await expect(menu()).toHaveCount(0); await page!.keyboard.press('Escape');
    await unchanged(before); evidence.valueFields = { number: true, select: true, colorSwatch: true, colorHex: true, colorAlpha: true, helpExcluded: true, actionExcluded: true, cancelUnchanged: true };
  });

  await check('素材输入可设置来源，资源搜索结果和浏览器不会打开外层属性菜单', async () => {
    await select('pc_image_control'); const before = await save();
    // Keep this change in the UI draft: saving intentionally clears its undo history.
    await restore('image');
    const assetField = await reveal('image'), input = assetField.getByRole('combobox');
    await input.click({ button: 'right' }); await expect(menu()).toBeVisible();
    await page!.keyboard.press('Escape'); await expect(input).toBeFocused();
    const options = page!.getByRole('listbox', { name: '图片素材搜索结果', exact: true });
    await expect(options).toBeVisible();
    await options.getByRole('option').first().click({ button: 'right' }); await expect(menu()).toHaveCount(0);
    await page!.keyboard.press('Escape');
    await assetField.getByRole('button', { name: '浏览图片素材', exact: true }).click();
    const browser = page!.getByRole('dialog', { name: '图片素材资源浏览器', exact: true }); await expect(browser).toBeVisible();
    await expect.poll(() => browser.evaluate(element => element.contains(document.activeElement))).toBe(true);
    const search = browser.getByRole('textbox', { name: '搜索可选资源', exact: true });
    await search.click(); await expect(search).toBeFocused();
    await search.press('Shift+F10'); await expect(menu()).toHaveCount(0);
    await search.click({ button: 'right' }); await expect(menu()).toHaveCount(0);
    await page!.keyboard.press('Escape');
    if (await browser.count()) await browser.getByRole('button', { name: '取消', exact: true }).click();
    await expect(browser).toHaveCount(0);
    assert.deepEqual(await read(), before, 'Browsing and cancelling source settings must not save the temporary source removal.');
    await undo(); await expect(source('image')).toHaveText('同步：同步图片');
    assert.deepEqual((await save()).ui, before.ui);
    evidence.assetBoundary = { inputMenu: true, returnedToInput: true, resultsExcluded: true, browserFocusContained: true, searchClickedAndFocused: true, browserMouseExcluded: true, browserKeyboardExcluded: true, unsavedDraftUndo: true, fixtureRestored: true };
  });

  await check('单向、双向和默认设置逐项切换，可撤销且保留设计值和参数初值', async () => {
    await select('pc_author'); const before = await save();
    await apply('text', 'follow', 'pc_caption'); await expect(source('text')).toHaveText('跟随：同步标题');
    await expect(canvasComponent('pc_author')).toContainText('参数文字');
    await expect(field('text').getByRole('textbox')).toHaveCount(0);
    await undo(); await expect(field('text').getByRole('textbox')).toHaveValue('设计原文');
    await redo(); await expect(source('text')).toHaveText('跟随：同步标题');
    let saved = await save(); assert.deepEqual(component(saved, 'pc_author').propertyControls, { text: { mode: 'follow', parameterId: 'pc_caption' } });
    assert.equal(component(saved, 'pc_author').text, '设计原文'); assert.deepEqual(saved.variables, before.variables); assert.deepEqual(saved.blueprints, before.blueprints);
    await apply('text', 'sync', 'pc_caption'); await expect(source('text')).toHaveText('同步：同步标题');
    await expect(canvasComponent('pc_author')).toContainText('参数文字');
    await undo(); await expect(source('text')).toHaveText('跟随：同步标题'); await redo();
    saved = await save(); assert.equal(component(saved, 'pc_author').propertyControls!.text.mode, 'sync');
    await source('text').click({ button: 'right' }); await expect(menu()).toBeVisible();
    await menu().getByRole('menuitem', { name: '默认设置', exact: true }).click();
    await expect(field('text').getByRole('textbox')).toHaveValue('设计原文');
    await expect(field('text').locator('.field-label')).toBeFocused();
    await undo(); await expect(source('text')).toHaveText('同步：同步标题'); await redo();
    saved = await save(); assert.equal(component(saved, 'pc_author').propertyControls, undefined);
    await apply('opacity', 'follow', 'pc_alpha'); await expect(source('opacity')).toHaveText('跟随：同步透明度');
    saved = await save(); assert.equal(component(saved, 'pc_author').style!.opacity, .65); assert.deepEqual(saved.variables, before.variables);
    await openGroup('property-binding'); await expect(group('property-binding').locator('[data-linked-property="opacity"]')).toContainText('同步透明度');
    await screenshot('01-follow-opacity-and-source-summary'); evidence.modeSwitches = { textDefault: '设计原文', opacityDefault: .65, variablesUnchanged: true, noGeneratedTimerGraphs: true, undoRedo: true, sourceValueMenu: true, removedSourceFocusFallback: true };
  });

  await check('新建参数和关联是一次操作，取消与撤销都不留下孤立参数', async () => {
    await select('pc_new'); const before = await save();
    await openSettings('text'); await dialog().getByLabel('控制方式', { exact: true }).selectOption('sync');
    await dialog().getByRole('button', { name: '新建参数并关联', exact: true }).click();
    await dialog().getByLabel('新参数名称', { exact: true }).fill('取消的参数');
    await dialog().getByRole('button', { name: '取消', exact: true }).click(); await unchanged(before);
    await openSettings('text'); await dialog().getByLabel('控制方式', { exact: true }).selectOption('sync');
    await dialog().getByRole('button', { name: '新建参数并关联', exact: true }).click();
    await dialog().getByLabel('新参数名称', { exact: true }).fill('面板新增同步文字');
    await dialog().getByLabel('新参数初始值', { exact: true }).fill('新参数初始文本');
    await dialog().getByLabel('新参数所属参数集', { exact: true }).selectOption('parameters_story');
    await dialog().getByRole('button', { name: '应用设置', exact: true }).click(); await expect(dialog()).toHaveCount(0);
    await expect(source('text')).toHaveText('同步：面板新增同步文字');
    await undo(); await expect(field('text').getByRole('textbox')).toHaveValue('新参数样本');
    await openSettings('text'); await dialog().getByLabel('控制方式', { exact: true }).selectOption('sync');
    await expect(dialog().getByLabel('来源参数', { exact: true }).locator('option').filter({ hasText: '面板新增同步文字' })).toHaveCount(0);
    await dialog().getByRole('button', { name: '取消', exact: true }).click(); await redo();
    const saved = await save(), added = saved.variables.filter(variable => !before.variables.some(item => item.id === variable.id));
    assert.equal(added.length, 1); assert.equal(added[0].name, '面板新增同步文字'); assert.equal(added[0].initial, '新参数初始文本'); assert.equal(added[0].type, 'string');
    assert.deepEqual(component(saved, 'pc_new').propertyControls, { text: { mode: 'sync', parameterId: added[0].id } });
    assert.equal(component(saved, 'pc_new').text, '新参数样本'); evidence.atomicCreate = { addedParameterId: added[0].id, cancelLeavesNothing: true, undoRemovesParameterAndLink: true };
  });

  await check('设计画布显示参数初值，单轴微调不覆盖另一个轴的参数来源', async () => {
    await select('pc_author'); const before = await save(), baseline = component(before, 'pc_author');
    await expect(canvasComponent('pc_author')).toContainText('设计原文');
    await apply('text', 'follow', 'pc_caption'); await expect(canvasComponent('pc_author')).toContainText('参数文字');
    await apply('text', 'sync', 'pc_caption'); await expect(canvasComponent('pc_author')).toContainText('参数文字');
    await undo(); await expect(source('text')).toHaveText('跟随：同步标题'); await expect(canvasComponent('pc_author')).toContainText('参数文字');
    await undo(); await expect(field('text').getByRole('textbox')).toHaveValue('设计原文'); await expect(canvasComponent('pc_author')).toContainText('设计原文');
    assert.deepEqual((await save()).ui, before.ui);

    await apply('x', 'follow', 'pc_position'); await expect(source('x')).toHaveText('跟随：子对象横向位置');
    let drawn = await canvasPosition('pc_author'); assert.ok(Math.abs(drawn.x - .12) < .001, 'Canvas X must use the parameter initial value: ' + JSON.stringify(drawn));
    const bound = await save(); assert.equal(component(bound, 'pc_author').x, baseline.x); assert.equal(bound.variables.find(item => item.id === 'pc_position')!.initial, .12);
    await expect(page!.getByRole('button', { name: '向右微调', exact: true })).toBeDisabled();
    await expect(page!.getByRole('button', { name: '向下微调', exact: true })).toBeEnabled();
    const canvas = page!.getByLabel('界面设计画布', { exact: true });
    await canvas.focus(); await page!.keyboard.press('ArrowRight');
    await expect(page!.getByRole('status').filter({ hasText: '横向位置（父级比例）已关联参数' })).toBeVisible();
    await unchanged(bound); drawn = await canvasPosition('pc_author'); assert.ok(Math.abs(drawn.x - .12) < .001);
    const beforeNudge = drawn;
    await canvas.focus(); await page!.keyboard.press('ArrowDown'); await settle();
    drawn = await canvasPosition('pc_author');
    assert.ok(Math.abs(drawn.x - .12) < .001, 'Moving Y must keep the displayed bound X.');
    // Compare two rendered positions: the canvas border belongs to neither
    // authored coordinate and must not be counted as part of the movement.
    assert.ok(Math.abs((drawn.y - beforeNudge.y) * original.height - 1) < .15, 'Moving down must change one game pixel: ' + JSON.stringify({ beforeNudge, drawn }));
    const moved = await save(), movedControl = component(moved, 'pc_author');
    assert.equal(movedControl.x, baseline.x, 'Moving Y must not copy the displayed X into the saved design value.');
    assert.ok(Math.abs((movedControl.y - baseline.y) * original.height - 1) < .00001);
    assert.deepEqual(moved.variables, bound.variables); assert.deepEqual(movedControl.propertyControls, component(bound, 'pc_author').propertyControls);

    // Saving clears the editor undo stack. Move back through the same public
    // author action, then check a fresh move+undo before removing the test link.
    await canvas.focus(); await page!.keyboard.press('ArrowUp'); await save();
    await canvas.focus(); await page!.keyboard.press('ArrowDown'); await undo();
    await restore('x'); await expect(field('x').getByRole('spinbutton')).toBeVisible();
    // Store the exact original decimal after inverse pixel arithmetic, so this
    // comparison measures authored changes rather than binary rounding noise.
    await view().getByLabel('位置尺寸单位', { exact: true }).selectOption('percent');
    await field('y').getByRole('spinbutton').fill(String(baseline.y * 100)); await field('y').getByRole('spinbutton').press('Tab');
    const restored = await save(); assert.deepEqual(restored.ui, before.ui); assert.deepEqual(restored.variables, before.variables);
    evidence.designCanvas = { followsTextParameter: true, syncTextParameter: true, originalTextPreserved: true, displayedBoundX: .12, authoredX: baseline.x, yNudgePixels: 1, xNudgeRefused: true, undoRestores: true };
    await screenshot('01b-design-canvas-source-and-movement');
  });

  await check('失效参数与错误类型明确显示，修复只改当前属性来源', async () => {
    await select('pc_invalid'); await reveal('opacity'); const before = await save();
    await expect(source('opacity')).toHaveText('跟随：参数已删除'); await openGroup('property-binding');
    await expect(group('property-binding').locator('[data-linked-property="opacity"]').getByRole('alert')).toContainText('已删除');
    await openSettings('opacity'); await dialog().getByRole('button', { name: '取消', exact: true }).click(); await unchanged(before);
    await apply('opacity', 'follow', 'pc_alpha');
    const repaired = await save(); assert.deepEqual(component(repaired, 'pc_invalid').propertyControls, { opacity: { mode: 'follow', parameterId: 'pc_alpha' } });
    await select('pc_mismatch'); await openGroup('property-binding');
    await expect(group('property-binding').locator('[data-linked-property="text"]').getByRole('alert')).toContainText('不匹配');
    await restore('text'); await expect(field('text').getByRole('textbox')).toHaveValue('错误类型样本');
    const saved = await save(); assert.equal(component(saved, 'pc_mismatch').propertyControls, undefined); assert.deepEqual(saved.variables, repaired.variables);
    evidence.sourceRepair = { missingWasPreservedUntilExplicitRepair: true, wrongTypeResetToOriginalDesign: true };
  });

  await check('旧自动联动只在显式改模式时转换，自定义蓝图保持完整', async () => {
    assert.ok(fixture.legacyGraph && fixture.customGraph);
    await select('pc_legacy_auto'); const before = await save();
    const legacy = projectGraphs(before).find(graph => graph.id === fixture.legacyGraph!.id); assert.ok(legacy);
    await openGroup('property-binding'); await expect(group('property-binding')).toContainText('旧自动联动');
    await openSettings('text'); await dialog().getByRole('button', { name: '取消', exact: true }).click(); await unchanged(before);
    await apply('text', 'follow', 'pc_caption');
    await undo(); await openGroup('property-binding'); await expect(group('property-binding')).toContainText('旧自动联动');
    await redo(); await expect(source('text')).toHaveText('跟随：同步标题');
    let saved = await save(); assert.equal(projectGraphs(saved).some(graph => graph.id === legacy.id), false);
    assert.deepEqual(component(saved, 'pc_legacy_auto').propertyControls, { text: { mode: 'follow', parameterId: 'pc_caption' } });
    await select('pc_custom'); const custom = projectGraphs(saved).find(graph => graph.id === fixture.customGraph!.id); assert.ok(custom);
    await openMenu('text'); await expect(menu().getByRole('menuitem', { name: '查看关联蓝图', exact: true })).toBeVisible(); await page!.keyboard.press('Escape');
    await apply('text', 'sync', 'pc_caption'); saved = await save();
    assert.deepEqual(projectGraphs(saved).find(graph => graph.id === custom.id), custom);
    await openGroup('property-binding'); await expect(group('property-binding')).toContainText('已有蓝图控制');
    evidence.legacy = { automaticGraphId: legacy.id, customGraphId: custom.id, automaticRemovedOnlyByApply: true, customPreserved: true };
  });

  await check('控件当前值有统一来源入口，解除后保留原参数及类型', async () => {
    await select('pc_slider'); await reveal('numberValue'); const before = await save();
    await expect(source('numberValue')).toHaveText('同步：同步数值');
    await restore('numberValue'); await expect(field('numberValue')).toContainText('10');
    await undo(); await expect(source('numberValue')).toHaveText('同步：同步数值');
    assert.deepEqual((await save()).ui, before.ui);
    await select('pc_input'); await reveal('stringValue'); await expect(source('stringValue')).toHaveText('同步：同步输入文字');
    await select('pc_choices_follow'); await reveal('stringValue'); await expect(source('stringValue')).toHaveText('跟随：同步选项');
    await unchanged(await read()); evidence.currentValueSource = { number: true, text: true, options: true, oldBindingUnchanged: true };
  });

  await check('明暗主题与220、360像素属性栏的来源、右键和设置窗口均完整可用', async () => {
    await select('pc_author'); const before = await save(), layouts: unknown[] = [];
    for (const theme of ['黑白', '亮白']) {
      await page!.getByRole('button', { name: '作品设置', exact: true }).click();
      await page!.getByRole('button', { name: '编辑器外观', exact: true }).click();
      await page!.getByRole('group', { name: '编辑器配色', exact: true }).getByRole('button', { name: new RegExp('^' + theme) }).click();
      await page!.getByRole('button', { name: '关闭作品设置', exact: true }).click();
      for (const width of [220, 360]) {
        await panelWidth(width); await reveal('opacity'); await openGroup('property-binding');
        const inspector = await assertFits(shell().locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," inspector-scroll ")][1]'));
        await openSettings('opacity', true); const windowLayout = await assertFits(dialog());
        await expect(dialog().getByLabel('控制方式', { exact: true })).toHaveValue('follow');
        await expect(dialog().getByLabel('来源参数', { exact: true })).toHaveValue('pc_alpha');
        await screenshot(`02-${theme === '亮白' ? 'light' : 'dark'}-${width}-settings`);
        await dialog().getByRole('button', { name: '取消', exact: true }).click();
        layouts.push({ theme, width, inspector, windowLayout });
      }
    }
    await unchanged(before); evidence.responsive = layouts;
  });

  await check('独立交互预览的蓝图、玩家输入与单向来源遵守同一读写规则', async () => {
    await panelWidth(360); await select('pc_slider'); await save(); const before = await fs.readFile(projectFile, 'utf8');
    preview = await openUiPreviewForTest(app!, page!, errors); preview.setDefaultTimeout(18000);
    await app!.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith('#ui-preview'))!;
      window.setContentSize(1280, 960); window.webContents.setBackgroundThrottling(false);
    });
    await expect(preview.getByLabel('当前预演页面', { exact: true })).toHaveText(fixture.page.name); await showUiPreviewTestData(preview);
    const target = (id: string) => preview!.locator(`[data-preview-component="${id}"]`);
    const parameter = (name: string) => preview!.getByLabel('预演参数 ' + name, { exact: true });
    const slider = target('pc_slider').locator('input[type="range"]'), mirror = target('pc_slider_follow').locator('input[type="range"]');
    const clamped = target('pc_clamped').locator('input[type="range"]'), input = target('pc_input').getByRole('textbox');
    await expect(slider).toHaveValue('30'); await expect(mirror).toHaveValue('30'); await expect(mirror).toBeDisabled();
    await expect(input).toHaveValue('参数初值'); await expect(parameter('保留的旧姓名')).toHaveValue('旧姓名');
    await expect(target('pc_choices_follow').getByRole('combobox')).toBeDisabled();
    await target('pc_program').click();
    await expect(slider).toHaveValue('70'); await expect(mirror).toHaveValue('70'); await expect(clamped).toHaveValue('40');
    await expect(parameter('同步数值')).toHaveValue('70'); await expect(parameter('保留的旧数值')).toHaveValue('10');
    await expect(input).toHaveValue('蓝图输入'); await expect(parameter('同步输入文字')).toHaveValue('蓝图输入');
    await expect(target('pc_text_follow')).toContainText('蓝图标题'); await expect(target('pc_default')).toContainText('临时文字');
    await expect(target('pc_choices').getByRole('combobox')).toHaveValue('1');
    await expect(parameter('玩家改值次数')).toHaveValue('0'); await expect(parameter('玩家提交次数')).toHaveValue('0');
    await target('pc_parameter').click(); await expect(slider).toHaveValue('90'); await expect(clamped).toHaveValue('40'); await expect(parameter('同步数值')).toHaveValue('90');
    await expect(target('pc_text_sync')).toContainText('参数标题');
    await target('pc_reset').click(); await expect(slider).toHaveValue('90'); await expect(target('pc_default')).toContainText('原始设计文字');
    await expect(parameter('玩家改值次数')).toHaveValue('0');
    // Exercise the actual replace-selection gesture, including focus and selection,
    // without clearing first or adding an extra change event.
    await expect(input).toHaveValue('参数更新');
    await input.click(); await input.press('ControlOrMeta+A'); await expect(input).toBeFocused();
    assert.deepEqual(await input.evaluate(element => {
      const control = element as HTMLInputElement;
      return { start: control.selectionStart, end: control.selectionEnd };
    }), { start: 0, end: '参数更新'.length }, 'Select-all must cover the previous value before replacement.');
    await preview.keyboard.insertText('玩家输入'); await input.press('Enter');
    await expect(parameter('同步输入文字')).toHaveValue('玩家输入'); await expect(parameter('保留的旧姓名')).toHaveValue('旧姓名');
    await expect(parameter('玩家改值次数')).toHaveValue('1'); await expect(parameter('玩家提交次数')).toHaveValue('1');
    await slider.focus(); await slider.press('Home');
    await expect(slider).toHaveValue('0'); await expect(mirror).toHaveValue('0'); await expect(clamped).toHaveValue('20');
    await expect(parameter('同步数值')).toHaveValue('0'); await expect(parameter('玩家改值次数')).toHaveValue('2');
    await slider.press('Home'); await expect(parameter('玩家改值次数')).toHaveValue('2');
    await target('pc_choices').getByRole('combobox').selectOption('2'); await expect(parameter('同步选项')).toHaveValue('旁观');
    await expect(target('pc_choices_follow').getByRole('combobox')).toHaveValue('2'); await expect(parameter('玩家改值次数')).toHaveValue('3');
    await target('pc_toggle').getByRole('checkbox').uncheck(); await expect(parameter('玩家改值次数')).toHaveValue('4');
    await target('pc_parameter').click(); await expect(parameter('玩家改值次数')).toHaveValue('4');
    assert.equal(await fs.readFile(projectFile, 'utf8'), before, 'Preview interaction must not write the authored project.');
    await screenshot('03-independent-preview-read-write', preview); evidence.previewValues = { oldSourcesUntouched: true, clampingDoesNotWriteBack: true, inputReplacement: 'click-select-all-insert-text', selectionVerified: true, programEvents: 0, playerChanges: 4, playerCommits: 1, sameValueDoesNotRepeat: true };
  });

  await check('按时间预演的同参数动画互相替换，直接写参数停在指定值', async () => {
    assert.ok(preview);
    const target = (id: string) => preview!.locator(`[data-preview-component="${id}"]`);
    const parameter = () => preview!.getByLabel('预演参数 同步透明度', { exact: true });
    await preview.getByRole('button', { name: '恢复测试值', exact: true }).click();
    await preview.getByRole('checkbox', { name: '按时间预演', exact: true }).check(); await showUiPreviewTestData(preview);
    await expect(parameter()).toHaveValue('0.4');
    await target('pc_anim_a').click(); await preview.getByRole('button', { name: '推进 0.1 秒', exact: true }).click();
    const first = Number(await parameter().inputValue()); assert.ok(first > .4 && first < .95, 'Animation should write an intermediate value to the parameter: ' + first);
    const bOpacity = await target('pc_alpha_b').evaluate(element => Number((element as HTMLElement).style.opacity));
    assert.ok(Math.abs(bOpacity - first) < .000001, 'Other synchronized controls must render the same intermediate value.');
    const childOpacity = await target('pc_alpha_a').evaluate(element => Number((element as HTMLElement).style.opacity));
    assert.ok(Math.abs(childOpacity - first * .5) < .000001, 'A half-opacity parent changes the rendered child opacity, never its parameter value.');
    assert.equal(Number(await parameter().inputValue()), first);
    await target('pc_anim_b').click(); await preview.getByRole('button', { name: '推进 1 秒', exact: true }).click(); await expect(parameter()).toHaveValue('0.15');
    await preview.getByRole('button', { name: '推进 1 秒', exact: true }).click(); await expect(parameter()).toHaveValue('0.15');
    await target('pc_anim_a').click(); await preview.getByRole('button', { name: '推进 0.1 秒', exact: true }).click();
    await parameter().fill('0.65'); await parameter().press('Tab'); await preview.getByRole('button', { name: '推进 1 秒', exact: true }).click();
    await expect(parameter()).toHaveValue('0.65');
    await expect(preview.getByLabel('预演参数 子对象横向位置', { exact: true })).toHaveValue('0.12');
    await expect(preview.getByLabel('预演参数 玩家改值次数', { exact: true })).toHaveValue('0');
    await screenshot('04-independent-preview-animation', preview); evidence.previewAnimation = { intermediate: first, childRenderedOpacity: childOpacity, replacementTarget: .15, directWriteStopsAt: .65, noPlayerEvents: true };
    await preview.close(); preview = undefined;
  });

  await check('保存重开仍保留来源、原始值和新参数，没有静默改写其他控件', async () => {
    const before = await save(); await close(); await launch();
    assert.deepEqual(await read(), before);
    await select('pc_author'); await reveal('opacity'); await expect(source('opacity')).toHaveText('跟随：同步透明度');
    await reveal('text'); await expect(field('text').getByRole('textbox')).toHaveValue('设计原文');
    await select('pc_new'); await reveal('text'); await expect(source('text')).toHaveText('同步：面板新增同步文字');
    await select('pc_slider'); await reveal('numberValue'); await expect(source('numberValue')).toHaveText('同步：同步数值');
    const after = await read();
    for (const id of fixture.page.components.map(item => item.id)) assert.deepEqual(component(after, id), component(original, id), 'Authoring scenarios must not alter runtime fixture: ' + id);
    evidence.finalProjectSha256 = digest(await fs.readFile(projectFile)); await screenshot('05-reopened-control-source');
  });

  assert.deepEqual(errors, [], 'Editor and independent preview must not raise renderer errors.'); report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = error instanceof Error ? error.stack : String(error);
  if (app && page && !page.isClosed()) await screenshot('failure').catch(capture => { report.captureError = String(capture); });
} finally {
  try { await close(); } catch (error) { report.status = 'failed'; report.closeError = String(error); failure ??= error; }
  try {
    const after = digest(await fs.readFile(authorFile)); report.authorSha256After = after;
    if (authorHash !== undefined) assert.equal(after, authorHash, 'Isolated acceptance must not modify the author project.');
  } catch (error) { report.status = 'failed'; report.sourceProtectionError = String(error); failure ??= error; }
  try {
    if (app || processes.some(item => !item.exited)) throw new Error('Owned editor is still running; preserve its fixture directories.');
    report.cleanup = await cleanVerificationDirectories(output, ['project', 'profile']);
    assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []);
  } catch (error) { report.status = 'failed'; report.cleanupError = String(error); failure ??= error; }
  await fs.mkdir(output, { recursive: true }); await persistReport(); console.log(path.join(output, 'report.json'));
}
if (failure) throw failure;
