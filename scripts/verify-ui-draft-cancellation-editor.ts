import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { createProject, projectSchema, type Project, type UiComponent } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openDisclosureAncestors } from './lib/ui-disclosures';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Correctness acceptance for review items 3 and 8. Run after all changes have
// been implemented and the source editor has been built in the unified pass.
// Every edit/save is isolated; this script never opens the author's project.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Use the isolated compiled source editor for this acceptance.');
const root = path.resolve('.');
const output = path.resolve('artifacts/authoring-fixes-2026-11-11', 'ui-cancellation-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const projectFile = path.join(output, 'fixture/project.vns.json'), profile = path.join(output, 'profile');
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const fixture = createProject('数值取消与草稿参数导航验收');
fixture.id = 'ui_cancellation_acceptance'; fixture.width = 1280; fixture.height = 720;
fixture.variables = [{ id: 'saved_text', name: '已保存来源参数', type: 'string', initial: '已保存参数文字', persistent: false }];
const text = (id: string, x: number, y: number, opacity: number): UiComponent => ({ id, name: id, kind: 'text', page: 'custom', text: id, x, y, width: .3, height: .12, style: { opacity, fontSize: 24 } });
fixture.ui.customPages = [{ id: 'cancel_page', name: '取消与来源检查页', modal: true, components: [
  text('mixed_a', .1, .12, .2), text('mixed_b', .5, .12, .8),
  text('equal_a', .1, .4, .5), text('equal_b', .5, .4, .5),
  { ...text('saved_link', .1, .7, 1), propertyControls: { text: { mode: 'follow', parameterId: 'saved_text' } } },
] }];

let app: ElectronApplication | undefined, page: Page | undefined, failure: unknown, phase = 'prepare';
const checks: { name: string; durationMs: number }[] = [], errors: string[] = [], processes: { pid?: number; exited: boolean }[] = [];
const evidence: Record<string, unknown> = {};
const report: Record<string, unknown> = { status: 'running', checks, errors, processes, evidence, temporaryPaths: [path.dirname(projectFile), profile] };
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const shell = () => page!.getByLabel('共同属性编辑', { exact: true });
const field = (property: string) => shell().locator(`[data-ui-multi-field="${property}"]`);
const opacity = () => shell().getByRole('spinbutton', { name: '共同不透明度 %', exact: true });
const size = () => shell().getByRole('spinbutton', { name: '共同字号', exact: true });
const control = () => page!.getByRole('dialog', { name: '属性控制设置', exact: true });
const leave = () => page!.getByRole('dialog', { name: '保存界面修改', exact: true });
const settle = () => page!.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
const component = (value: Project, id: string) => {
  const target = value.ui.customPages.find(item => item.id === 'cancel_page')!.components.find(item => item.id === id);
  assert.ok(target, 'Expected fixture component: ' + id); return target;
};
async function builtFiles() {
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  const files = ['dist/index.html', 'dist-desktop/main.cjs', 'dist-desktop/preload.cjs',
    ...[...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => 'dist/' + match[1].slice(2))];
  assert.ok(files.some(file => file.startsWith('dist/assets/') && file.endsWith('.js')), 'Build the complete source editor before acceptance.');
  return Promise.all([...new Set(files)].map(async file => ({ file, sha256: hash(await fs.readFile(path.join(root, file))) })));
}
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile }); processes.push({ pid: app.process().pid, exited: false });
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; if (window.isMaximized()) window.unmaximize(); window.setContentSize(1600, 1000); window.webContents.setBackgroundThrottling(false); });
  await expect(page.locator('.project-title strong')).toHaveText(fixture.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html')); report.rendererUrl = page.url();
  await page.evaluate('globalThis.__name = value => value'); await openUi();
}
async function close() {
  if (!app) return;
  const owned = app, child = owned.process(), exited = () => child.exitCode !== null || child.signalCode !== null;
  try { await owned.close(); } finally {
    await expect.poll(exited, { timeout: 15000 }).toBe(true);
    const record = processes.find(item => item.pid === child.pid); if (record) record.exited = exited();
    if (exited()) { app = undefined; page = undefined; }
  }
}
async function openUi() {
  await page!.locator('[data-workspace-tab="ui"]').click();
  await page!.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '设计', exact: true }).click();
  await page!.getByLabel('设计页面', { exact: true }).selectOption('cancel_page');
  await page!.getByLabel('画面缩放比例', { exact: true }).selectOption('50'); await settle();
}
async function select(ids: string[]) {
  await page!.locator(`[data-hierarchy-id="${ids[0]}"] .ui-hierarchy-caption`).click();
  for (const id of ids.slice(1)) await page!.locator(`[data-hierarchy-id="${id}"] .ui-hierarchy-caption`).click({ modifiers: ['Control'] });
  await expect.poll(() => page!.locator('.ui-hierarchy-row.selected').evaluateAll(items => items.map(item => item.getAttribute('data-hierarchy-id')).sort())).toEqual([...ids].sort());
  if (ids.length > 1) { await expect(shell()).toBeVisible(); await openDisclosureAncestors(opacity()); }
  else await expect(shell()).toHaveCount(0);
  await settle();
}
async function screenshot(name: string) {
  await settle(); const png = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(png, 'base64'));
}
async function check(name: string, work: () => Promise<void>) {
  phase = name; const start = Date.now(); await work(); checks.push({ name, durationMs: Date.now() - start });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log('通过：' + name);
}
async function assertNoPending(value: string) {
  await expect(opacity()).toHaveValue(value); await expect(field('opacity')).not.toHaveAttribute('data-pending', 'true');
  await expect(shell().getByRole('button', { name: '应用到 2 个控件', exact: true })).toBeDisabled();
  await expect(button('保存界面')).toBeDisabled();
}
async function fillNumber(input: Locator, value: string) { await input.fill(value); await input.press('Tab'); }
async function apply() { await shell().getByRole('button', { name: '应用到 2 个控件', exact: true }).click(); await expect(shell().locator('[data-pending="true"]')).toHaveCount(0); await settle(); }
async function undo() { await button('撤销').click(); await settle(); }
async function rendered(id: string, value: number) { await expect(page!.locator(`.ui-canvas [data-component-id="${id}"]`)).toHaveCSS('opacity', String(value)); }
async function saveUi() {
  await button('保存界面').click(); await expect(page!.locator('.ui-save-status')).toHaveText('已保存', { timeout: 30000 });
  await expect(button('保存界面')).toBeDisabled(); return read();
}
async function beginDrag(property: Locator, distance = 40) {
  const label = property.locator('.field-label'); await label.scrollIntoViewIfNeeded();
  await label.evaluate(element => { const owner = element.closest('label')!; owner.addEventListener('pointerdown', event => { owner.dataset.verificationPointerId = String(event.pointerId); }, { once: true }); });
  const box = await label.boundingBox(); assert.ok(box);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page!.mouse.move(x, y); await page!.mouse.down(); await page!.mouse.move(x + distance, y, { steps: 6 }); await settle();
  return { x: x + distance, y };
}
async function revealSingleGroup(id: string) {
  const group = page!.locator(`.ui-inspector-view:not([hidden]) [data-ui-inspector-group="${id}"]`);
  await openDisclosureAncestors(group);
  if (await group.getAttribute('open') === null) await group.locator(':scope > summary').click();
}
async function cancelDrag(property: Locator, reason: 'Escape' | 'pointercancel' | 'lostpointercapture') {
  if (reason === 'Escape') await page!.keyboard.press('Escape');
  else await property.locator('.field-label').evaluate((element, reason) => {
    const owner = element.closest('label')!, pointerId = Number(owner.dataset.verificationPointerId);
    if (reason === 'pointercancel') owner.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId }));
    else owner.releasePointerCapture(pointerId);
  }, reason);
  await page!.mouse.up(); await settle();
}
async function openControl() {
  await revealSingleGroup('content');
  const property = page!.locator('.ui-inspector-view:not([hidden]) .field[data-ui-property="text"]');
  await openDisclosureAncestors(property); await property.locator('.field-label').click({ button: 'right' });
  await page!.getByRole('menu', { name: '属性控制菜单', exact: true }).getByRole('menuitem', { name: '关联参数…', exact: true }).click();
  await expect(control()).toBeVisible();
}
async function createDraftParameter(name: string, value: string) {
  await select(['mixed_a']); await openControl(); await control().getByRole('button', { name: '新建参数并关联', exact: true }).click();
  await control().getByLabel('新参数名称', { exact: true }).fill(name); await control().getByLabel('新参数初始值', { exact: true }).fill(value);
  await control().getByRole('button', { name: '应用设置', exact: true }).click(); await expect(control()).toHaveCount(0);
  await expect(button('保存界面')).toBeEnabled(); await openControl();
  const id = await control().getByLabel('来源参数', { exact: true }).inputValue(); assert.ok(id); return id;
}
async function locateSource() { await control().getByRole('button', { name: '查看来源参数', exact: true }).click(); await expect(control()).toHaveCount(0); }

try {
  await fs.mkdir(path.dirname(projectFile), { recursive: true }); report.buildBefore = await builtFiles();
  await saveProject(projectFile, projectSchema.parse(fixture)); const baseline = await read(); await launch();

  await check('混合字段不从零拖起；直接输入Esc恢复空值且没有待改', async () => {
    await select(['mixed_a', 'mixed_b']); await assertNoPending(''); await expect(opacity()).toHaveAttribute('placeholder', '多个值');
    await beginDrag(field('opacity')); await cancelDrag(field('opacity'), 'Escape'); await assertNoPending('');
    await opacity().fill('35'); await expect(field('opacity')).toHaveAttribute('data-pending', 'true'); await opacity().press('Escape');
    await assertNoPending(''); await opacity().press('Tab'); await assertNoPending('');
    assert.deepEqual(await read(), baseline); await screenshot('01-mixed-cancelled');
  });
  await check('取消一字段保留另一个待改；实际应用与一次撤销不带入取消数值', async () => {
    await openDisclosureAncestors(size()); await fillNumber(size(), '66'); await opacity().fill('42'); await opacity().press('Escape');
    await expect(opacity()).toHaveValue(''); await expect(field('opacity')).not.toHaveAttribute('data-pending', 'true'); await expect(field('fontSize')).toHaveAttribute('data-pending', 'true');
    await expect(shell().locator('[data-pending="true"]')).toHaveCount(1); await apply();
    await rendered('mixed_a', .2); await rendered('mixed_b', .8); await expect(size()).toHaveValue('66'); await undo();
    await expect(size()).toHaveValue('24'); await expect(button('保存界面')).toBeDisabled(); assert.deepEqual(await read(), baseline);
  });
  await check('同值无待改的标签拖动Esc完整回到无待改', async () => {
    await select(['equal_a', 'equal_b']); await assertNoPending('50'); await beginDrag(field('opacity'));
    await expect(field('opacity')).toHaveAttribute('data-pending', 'true'); await cancelDrag(field('opacity'), 'Escape'); await assertNoPending('50');
    await rendered('equal_a', .5); await rendered('equal_b', .5);
  });
  await check('已有set待改：键入及拖动取消恢复原待改值，应用后一次撤销', async () => {
    await fillNumber(opacity(), '60'); await opacity().fill('80'); await opacity().press('Escape'); await expect(opacity()).toHaveValue('60');
    await opacity().press('Tab'); await beginDrag(field('opacity')); await cancelDrag(field('opacity'), 'Escape');
    await expect(opacity()).toHaveValue('60'); await expect(field('opacity')).toHaveAttribute('data-pending', 'true'); await apply();
    await rendered('equal_a', .6); await rendered('equal_b', .6); await undo(); await assertNoPending('50');
  });
  await check('已有reset待改：键入Esc恢复reset空值，应用恢复默认且可撤销', async () => {
    await button('恢复共同不透明度 %设计默认值').click(); await expect(opacity()).toHaveValue('');
    await opacity().fill('40'); await opacity().press('Escape'); await expect(opacity()).toHaveValue('');
    await expect(opacity()).toHaveAttribute('placeholder', '待恢复默认'); await expect(field('opacity')).toContainText('待应用：恢复各自设计默认值');
    await expect(button('恢复共同不透明度 %设计默认值')).toBeDisabled(); await opacity().press('Tab'); await apply();
    await rendered('equal_a', 1); await rendered('equal_b', 1); await expect(opacity()).toHaveValue('100'); await undo(); await assertNoPending('50');
    await screenshot('02-reset-cancellation');
  });
  await check('Enter确认前段、下一段Esc回到已确认值；同焦点取消后可继续编辑', async () => {
    await opacity().fill('67'); await opacity().press('Enter'); await opacity().fill('73'); await opacity().press('Escape'); await expect(opacity()).toHaveValue('67');
    await opacity().fill('74'); await opacity().press('Escape'); await expect(opacity()).toHaveValue('67'); await opacity().press('Tab');
    await apply(); await rendered('equal_a', .67); await rendered('equal_b', .67); await undo(); await assertNoPending('50');
  });
  await check('失焦保留待改；pointercancel和真正丢失捕获完整取消手势', async () => {
    await fillNumber(opacity(), '42'); await expect(opacity()).toHaveValue('42'); await expect(field('opacity')).toHaveAttribute('data-pending', 'true');
    await apply(); await rendered('equal_a', .42); await undo(); await assertNoPending('50');
    for (const reason of ['pointercancel', 'lostpointercapture'] as const) {
      await beginDrag(field('opacity')); await expect(field('opacity')).toHaveAttribute('data-pending', 'true'); await cancelDrag(field('opacity'), reason); await assertNoPending('50');
    }
  });
  await check('真实批次应用、一次撤销、重做、保存重开保留两控件数值', async () => {
    await select(['mixed_a', 'mixed_b']); await fillNumber(opacity(), '65'); await apply(); await rendered('mixed_a', .65); await rendered('mixed_b', .65);
    await undo(); await rendered('mixed_a', .2); await rendered('mixed_b', .8); await button('重做').click(); await settle();
    const saved = await saveUi(); assert.equal(component(saved, 'mixed_a').style!.opacity, .65); assert.equal(component(saved, 'mixed_b').style!.opacity, .65);
    assert.deepEqual(saved.variables, baseline.variables); await screenshot('03-saved-batch'); await close(); await launch();
    await select(['mixed_a', 'mixed_b']); await assertNoPending('65'); await rendered('mixed_a', .65); await rendered('mixed_b', .65);
    evidence.savedBatch = { objects: 2, value: .65, undoSteps: 1, reopened: true };
  });
  await check('单选数值键入与拖动Esc回滚、Enter分段及失焦确认保持有效', async () => {
    await select(['mixed_a']); await revealSingleGroup('visibility');
    const input = page!.getByRole('spinbutton', { name: '控件不透明度 %', exact: true }); await openDisclosureAncestors(input);
    const property = page!.locator('.ui-inspector-view:not([hidden]) .field[data-ui-property="opacity"]');
    await input.fill('40'); await input.press('Escape'); await expect(input).toHaveValue('65'); await expect(button('保存界面')).toBeDisabled(); await input.press('Tab');
    await beginDrag(property); await cancelDrag(property, 'Escape'); await expect(input).toHaveValue('65'); await expect(button('保存界面')).toBeDisabled();
    await input.fill('66'); await input.press('Enter'); await input.fill('75'); await input.press('Escape'); await expect(input).toHaveValue('66'); await input.press('Tab');
    await expect(button('保存界面')).toBeEnabled(); await undo(); await expect(input).toHaveValue('65'); await expect(button('保存界面')).toBeDisabled();
    await fillNumber(input, '68'); await rendered('mixed_a', .68); await undo(); await expect(input).toHaveValue('65'); await expect(button('保存界面')).toBeDisabled();
    await fillNumber(input, '68'); await input.focus(); await input.press('Control+z'); await expect(input).toHaveValue('65'); await expect(input).toBeFocused();
    await input.press('Escape'); await expect(input).toHaveValue('65'); await rendered('mixed_a', .65); await expect(button('保存界面')).toBeDisabled();
    await input.fill(''); await input.press('Enter'); await expect(input).toHaveValue('65'); await input.press('Escape');
    await expect(input).toHaveValue('65'); await expect(button('保存界面')).toBeDisabled(); await input.press('Tab');
    await beginDrag(property); await page!.keyboard.press('Control+z'); await expect(input).toHaveValue('65');
    await page!.keyboard.press('Escape'); await page!.mouse.up(); await expect(input).toHaveValue('65'); await expect(button('保存界面')).toBeDisabled();
  });
  let discardedId = '', savedId = '';
  await check('草稿新参数查看来源提示保存；取消保留参数与关联，放弃留在界面', async () => {
    discardedId = await createDraftParameter('取消与放弃来源参数', '应保留直到明确放弃'); assert.ok(!(await read()).variables.some(item => item.id === discardedId));
    await locateSource(); await expect(leave()).toBeVisible(); await screenshot('04-draft-navigation-prompt'); await leave().getByRole('button', { name: '取消', exact: true }).click();
    await expect(leave()).toHaveCount(0); await expect(page!.locator('.ui-canvas')).toBeVisible(); await expect(button('保存界面')).toBeEnabled();
    await openControl(); await expect(control().getByLabel('来源参数', { exact: true })).toHaveValue(discardedId);
    await locateSource(); await expect(leave()).toBeVisible(); await leave().getByRole('button', { name: '不保存', exact: true }).click(); await expect(leave()).toHaveCount(0);
    await expect(page!.locator('.ui-canvas')).toBeVisible(); await expect(button('保存界面')).toBeDisabled();
    await expect(page!.getByText('来源参数已不在当前工程中，未跳转。', { exact: true })).toBeVisible();
    assert.ok(!(await read()).variables.some(item => item.id === discardedId)); await openControl();
    await expect(control().getByLabel('控制方式', { exact: true })).toHaveValue('default'); await expect(control().getByRole('button', { name: '查看来源参数', exact: true })).toHaveCount(0);
    await control().getByRole('button', { name: '取消', exact: true }).click(); await screenshot('05-discarded-target');
  });
  await check('再次新建来源参数保存并继续后导航到真实目标；保存重开关联仍存在', async () => {
    savedId = await createDraftParameter('保存并导航来源参数', '保存后的来源内容'); assert.ok(!(await read()).variables.some(item => item.id === savedId));
    await locateSource(); await expect(leave()).toBeVisible(); await leave().getByRole('button', { name: '保存并继续', exact: true }).click();
    await expect(leave()).toHaveCount(0); await expect(page!.locator('.ui-canvas')).toHaveCount(0);
    await expect(page!.locator(`[data-parameter-id="${savedId}"]`)).toHaveClass(/selected/);
    await expect(page!.getByRole('complementary', { name: '参数设置', exact: true }).getByRole('textbox', { name: '初始值', exact: true })).toHaveValue('保存后的来源内容');
    const saved = await read(); assert.equal(saved.variables.find(item => item.id === savedId)?.initial, '保存后的来源内容');
    assert.deepEqual(component(saved, 'mixed_a').propertyControls?.text, { mode: 'follow', parameterId: savedId });
    assert.ok(!saved.variables.some(item => item.id === discardedId)); await screenshot('06-saved-parameter-target');
    await close(); await launch(); await select(['mixed_a']); await openControl(); await expect(control().getByLabel('来源参数', { exact: true })).toHaveValue(savedId);
    await locateSource(); await expect(leave()).toHaveCount(0); await expect(page!.locator(`[data-parameter-id="${savedId}"]`)).toHaveClass(/selected/);
    evidence.draftNavigation = { discardedId, savedId, cancelRetainedDraft: true, discardStayedInUi: true, savedAndReopened: true };
  });
  await check('既有已保存参数查看来源直接进入对应参数集', async () => {
    await openUi(); await select(['saved_link']); await openControl(); await expect(control().getByLabel('来源参数', { exact: true })).toHaveValue('saved_text');
    await locateSource(); await expect(leave()).toHaveCount(0); await expect(page!.locator('[data-parameter-id="saved_text"]')).toHaveClass(/selected/);
    await expect(page!.locator('.ui-canvas')).toHaveCount(0); await screenshot('07-existing-parameter-target');
  });
  assert.equal(checks.length, 12); assert.deepEqual(errors, []); report.buildAfter = await builtFiles(); assert.deepEqual(report.buildAfter, report.buildBefore);
  await fs.copyFile(projectFile, path.join(output, 'saved-project.json')); report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = String(error);
  if (app && page) await screenshot('failure').catch(error => { report.screenshotError = String(error); });
} finally {
  await close().catch(error => { failure ??= error; report.status = 'failed'; report.closeError = String(error); });
  if (!app && processes.every(item => item.exited)) report.cleanup = await cleanVerificationDirectories(output, ['fixture', 'profile']);
  else report.cleanupSkipped = 'The isolated Electron process has not exited.';
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
}
if (failure) throw failure;
