import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { createProject, projectSchema, type Project, type UiComponent } from '../src/core/model';
import { createBlueprintGraph } from '../src/core/blueprint';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openDisclosureAncestors } from './lib/ui-disclosures';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Run only in the final unified acceptance. Reads the author's file for hash
// protection; every edit, save, font copy and Electron profile is isolated.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Multi-selection acceptance requires the isolated compiled source build.');
const root = path.resolve('.');
const output = path.resolve('artifacts/editor-refinements-2026-11-10/ui-multi-edit', 'editor-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const profile = path.join(output, 'profile'), projectFile = path.join(output, 'project/project.vns.json');
const authorFile = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? '../我的视觉小说1/project.vns.json');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const text = (id: string, patch: Partial<UiComponent> = {}): UiComponent => ({ id, name: id, text: id, kind: 'text', page: 'main', x: .08, y: .14, width: .25, height: .12, ...patch });
const custom = (id: string, patch: Partial<UiComponent> = {}) => text(id, { page: 'custom', ...patch });
const project = createProject('多选共同属性验收');
project.id = 'ui_multi_edit_acceptance'; project.width = 1280; project.height = 720;
project.resourceSettings = { importMode: 'copy', directory: 'assets', syncFolders: false };
project.ui.pages = { main: { layout: 'custom', appearance: { fontSize: 28, textColor: '#cfd8e0', fontAssetId: 'multi_font_a' } }, choice: { layout: 'custom' } };
project.assets = ['a', 'b', 'c'].map((suffix, index) => ({ id: 'multi_font_' + suffix, kind: 'font' as const, name: ['项目中文字体', '项目西文字体', '项目第三字体'][index], path: 'assets/font-' + suffix + '.ttf' }));
project.variables = [{ id: 'multi_size', name: '来源字号参数', type: 'number', initial: 56, persistent: false }];
const graph = createBlueprintGraph('ui', '保留的点击行为'); graph.id = 'multi_click_graph';
project.blueprints = [graph];
project.ui.components = [
  text('multi_a', { name: '标题甲', style: { fontSize: 24, fontAssetId: 'multi_font_a', textColor: '#cfd8e0', opacity: .35, shadowX: 5, shadowY: 2 } }),
  text('multi_b', { kind: 'button', name: '按钮乙', action: 'start', x: .37, y: .16, width: .22, events: { onClick: graph.id }, style: { fontSize: 40, fontAssetId: 'multi_font_b', opacity: .8, hoverTextColor: '#ffcc22', borderWidth: 2, borderColor: '#ffffff' } }),
  text('multi_c', { name: '未选中的标题', x: .08, y: .56, style: { fontSize: 22, textColor: '#88aaee', opacity: .9 } }),
  text('multi_parent', { name: '父文字', x: .67, y: .15, width: .25, height: .36, style: { fontSize: 22, opacity: .8 } }),
  text('multi_child', { name: '子文字', parentId: 'multi_parent', x: .1, y: .5, width: .8, height: .35, style: { fontSize: 20, opacity: .6 } }),
  text('multi_list', { page: 'choice', kind: 'choiceList', name: '独立列表表面', x: .15, y: .2, width: .55, height: .4, list: { itemHeight: 55 } }),
  text('multi_list_peer', { page: 'choice', name: '列表同页普通文字', x: .1, y: .7, style: { fontSize: 24, opacity: .9 } }),
];
project.ui.instances = [
  { id: 'multi_base', name: '上级测试方案', components: [{ ...structuredClone(project.ui.components[0]), style: { ...project.ui.components[0].style, fontSize: 31 } }] },
  { id: 'multi_derived', name: '派生测试方案', baseUiId: 'multi_base', components: [] },
];
project.ui.customPages = [{ id: 'multi_restrictions', name: '来源与锁定范围', modal: true, appearance: { fontSize: 33, fontAssetId: 'multi_font_b', textColor: '#bbccee' }, components: [
  custom('multi_free', { name: '可编辑文字', x: .05, y: .07, style: { fontSize: 24, textColor: '#ffffff', opacity: .9 } }),
  custom('multi_follow', { name: '单向字号文字', x: .38, y: .07, style: { fontSize: 31, textColor: '#ddeeff', opacity: .8 }, propertyControls: { fontSize: { mode: 'follow', parameterId: 'multi_size' } } }),
  custom('multi_sync', { kind: 'button', name: '双向字号按钮', x: .68, y: .07, style: { fontSize: 37, opacity: .7 }, propertyControls: { fontSize: { mode: 'sync', parameterId: 'multi_size' } } }),
  custom('multi_locked', { name: '锁定文字', x: .05, y: .32, editor: { locked: true }, style: { fontSize: 29 } }),
  custom('multi_invalid', { name: '来源已失效', x: .38, y: .32, style: { fontSize: 41 }, propertyControls: { fontSize: { mode: 'follow', parameterId: 'deleted_multi_parameter' } } }),
  custom('multi_locked_parent', { kind: 'panel', name: '锁定父框架', x: .05, y: .6, width: .35, height: .25, editor: { locked: true } }),
  custom('multi_locked_child', { name: '锁定框架内文字', parentId: 'multi_locked_parent', x: .1, y: .1, width: .8, height: .6 }),
  custom('multi_hidden_text', { kind: 'button', name: '无文字皮肤按钮', x: .48, y: .62, skin: { hideText: true } }),
] }];

let app: ElectronApplication | undefined, page: Page | undefined, authorHash: string | undefined;
let phase = 'setup', failure: unknown, baseline: Project, saved: Project;
const checks: { name: string; durationMs: number }[] = [], errors: string[] = [], processes: { pid?: number; exited: boolean }[] = [];
const evidence: Record<string, unknown> = {};
const report: Record<string, unknown> = { status: 'running', compiledBuild: true, checks, errors, processes, evidence, authorFile, temporaryPaths: [path.dirname(projectFile), profile] };
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const shell = () => page!.getByLabel('共同属性编辑', { exact: true });
const field = (property: string) => shell().locator(`[data-ui-multi-field="${property}"]`);
const size = () => shell().getByRole('spinbutton', { name: '共同字号', exact: true });
const opacity = () => shell().getByRole('spinbutton', { name: '共同不透明度 %', exact: true });
const color = () => shell().getByRole('textbox', { name: '共同文字颜色', exact: true });
const font = () => shell().getByRole('combobox', { name: '共同字体', exact: true });
const menu = () => page!.getByRole('menu', { name: '共同属性菜单', exact: true });
const object = (id: string) => page!.locator(`.ui-canvas [data-component-id="${id}"]`);
const row = (id: string) => page!.locator(`[data-hierarchy-id="${id}"]`);
const source = (property: string, id: string) => field(property).locator(`[data-ui-multi-source="${id}"]`);
const settle = async () => page!.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
const component = (value: Project, id: string) => {
  const result = [...value.ui.components, ...value.ui.customPages.flatMap(page => page.components)].find(item => item.id === id);
  assert.ok(result, 'Expected fixture component: ' + id); return result;
};

async function builtFiles() {
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  const files = ['dist/index.html', 'dist-desktop/main.cjs', 'dist-desktop/preload.cjs',
    ...[...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => 'dist/' + match[1].slice(2))];
  assert.ok(files.some(file => file.startsWith('dist/assets/') && file.endsWith('.js')), 'The final renderer build must exist before acceptance.');
  return Promise.all([...new Set(files)].map(async file => ({ file, sha256: hash(await fs.readFile(path.join(root, file))) })));
}
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile }); processes.push({ pid: app.process().pid, exited: false });
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; if (window.isMaximized()) window.unmaximize(); window.setContentSize(1600, 1000); window.webContents.setBackgroundThrottling(false); });
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html')); report.rendererUrl = page.url();
  await page.evaluate('globalThis.__name = value => value');
  await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '设计', exact: true }).click();
  await page.getByLabel('画面缩放比例', { exact: true }).selectOption('50'); await settle();
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
async function screenshot(name: string) {
  await settle(); const png = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(png, 'base64'));
}
async function check(name: string, run: () => Promise<void>) {
  phase = name; const start = Date.now(); await run(); checks.push({ name, durationMs: Date.now() - start });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log('通过：' + name);
}
async function openPage(id: string) {
  if (await page!.getByLabel('设计页面', { exact: true }).inputValue() !== id) await page!.getByLabel('设计页面', { exact: true }).selectOption(id);
  await page!.getByLabel('画面缩放比例', { exact: true }).selectOption('50'); await settle();
}
async function select(ids: string[]) {
  assert.ok(ids.length); await row(ids[0]).locator('.ui-hierarchy-caption').click();
  for (const id of ids.slice(1)) await row(id).locator('.ui-hierarchy-caption').click({ modifiers: ['Control'] });
  await expect.poll(() => page!.locator('.ui-hierarchy-row.selected').evaluateAll(elements => elements.map(element => element.getAttribute('data-hierarchy-id')).sort())).toEqual([...ids].sort());
  if (ids.length > 1) { await expect(shell().locator('[data-ui-multi-count]')).toHaveAttribute('data-ui-multi-count', String(ids.length)); await reveal('opacity'); }
  else await expect(shell()).toHaveCount(0);
  await settle();
}
async function reveal(property: string) {
  const group = shell().locator(`[data-ui-inspector-group="${property === 'opacity' ? 'multi-visibility' : 'multi-text'}"]`);
  if (await group.getAttribute('open') === null) await group.locator(':scope > summary').click();
  await expect(field(property)).toBeVisible(); await field(property).scrollIntoViewIfNeeded();
}
async function sources(property: string) {
  await reveal(property); const details = field(property).locator('.ui-multi-sources');
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
  await expect(details.locator('.ui-multi-source-row')).toHaveCount(2); return details;
}
async function openMenu(property: string, target: Locator, keyboard = false) {
  await reveal(property); await target.scrollIntoViewIfNeeded();
  if (keyboard) { await target.focus(); await target.press('Shift+F10'); } else await target.click({ button: 'right' });
  await expect(menu()).toBeVisible(); await settle(); await expect(menu()).toBeVisible();
}
async function chooseFont(id: string) {
  await reveal('font'); await font().fill(id);
  await page!.getByRole('listbox', { name: '共同字体搜索结果', exact: true }).getByRole('option').filter({ hasText: id }).click();
}
async function fillNumber(target: Locator, value: string) { await target.fill(value); await target.press('Tab'); }
async function apply() { await shell().getByRole('button', { name: /^应用到 \d+ 个控件$/ }).click(); await expect(shell().locator('[data-pending="true"]')).toHaveCount(0); await settle(); }
async function undo() { await button('撤销').click(); await settle(); }
async function redo() { await button('重做').click(); await settle(); }
async function changedDraft() { await expect(button('保存界面')).toBeEnabled(); await expect(button('撤销')).toBeEnabled(); }
async function save() {
  if (await button('保存界面').isEnabled()) await button('保存界面').click();
  await expect(page!.locator('.ui-save-status')).toHaveText('已保存', { timeout: 30000 }); await expect(button('保存界面')).toBeDisabled(); return read();
}
async function unchanged(reference: Project) { await expect(button('保存界面')).toBeDisabled(); assert.deepEqual(await read(), reference); }
async function rendered(id: string) { return object(id).evaluate(element => {
  const node = element as HTMLElement, style = getComputedStyle(node);
  return { opacity: node.style.opacity, color: style.color, font: style.fontFamily, fontSize: style.fontSize,
    x: node.style.left, y: node.style.top, width: node.style.width, height: node.style.height, text: node.textContent };
}); }
async function computedColor(value: string) { return page!.evaluate(value => {
  // Use the browser's own CSS serialization independently of the product:
  // hex alpha 80 may be serialized as 0.5, without trailing zeroes.
  const reference = document.createElement('span');
  reference.style.cssText = 'all: initial !important; display: none !important';
  reference.style.setProperty('color', value, 'important'); document.body.append(reference);
  try { return getComputedStyle(reference).color; } finally { reference.remove(); }
}, value); }
async function expectBatch() {
  await reveal('fontSize'); await expect(size()).toHaveValue('36'); await expect(color()).toHaveValue('#12345680'); await expect(font()).toHaveValue('项目第三字体');
  await reveal('opacity'); await expect(opacity()).toHaveValue('65');
  const expectedColor = await computedColor('#12345680'); evidence.colorRendering = { authored: '#12345680', computed: expectedColor };
  for (const id of ['multi_a', 'multi_b']) { const state = await rendered(id); assert.equal(state.opacity, '0.65'); assert.match(state.font, /vns_multi_font_c/); assert.equal(state.fontSize, '18px'); assert.equal(state.color, expectedColor, id + ' must render the full authored RGBA color.'); }
}
async function switchScheme(id: string) {
  await button('页面选项').click(); const dialog = page!.getByRole('dialog', { name: '页面选项', exact: true }), picker = dialog.getByLabel('选择界面实例', { exact: true });
  await openDisclosureAncestors(picker); await picker.selectOption(id);
  // Changing the view key remounts page options and closes its popover. Reopen
  // only to verify the actual selected scheme, then close the new popover.
  await expect(dialog).toBeHidden(); await expect(button('页面选项')).toHaveAttribute('aria-expanded', 'false');
  await button('页面选项').click(); await expect(dialog).toBeVisible(); await openDisclosureAncestors(picker); await expect(picker).toHaveValue(id);
  await dialog.getByRole('button', { name: '关闭页面选项', exact: true }).click(); await expect(dialog).toBeHidden();
  await page!.getByLabel('画面缩放比例', { exact: true }).selectOption('50'); await settle();
}
async function panelWidth(width: number) {
  const panel = await page!.locator('[data-dock-panel="inspector"]').boundingBox(), divider = await page!.getByRole('separator', { name: '调整右侧面板宽度', exact: true }).boundingBox(); assert.ok(panel && divider);
  const x = divider.x + divider.width / 2, y = divider.y + Math.min(90, divider.height / 2);
  await page!.mouse.move(x, y); await page!.mouse.down(); await page!.mouse.move(x + panel.width - width, y, { steps: 6 }); await page!.mouse.up(); await settle();
  const actual = await page!.locator('[data-dock-panel="inspector"]').boundingBox(); assert.ok(actual && Math.abs(actual.width - width) <= 8, 'Actual inspector width: ' + actual?.width);
}
async function assertFits() {
  const layout = await shell().locator('.inspector-scroll').evaluate(element => {
    const rect = element.getBoundingClientRect();
    const visible = [...element.querySelectorAll<HTMLElement>('input,button,summary,.field-label')].filter(item => {
      if (!item.getClientRects().length || !item.getBoundingClientRect().width) return false;
      for (let parent = item.closest('details'); parent; parent = parent.parentElement?.closest('details') ?? null) if (!parent.open && !parent.querySelector(':scope > summary')?.contains(item)) return false;
      return true;
    }).map(item => { const bounds = item.getBoundingClientRect(); return { label: item.getAttribute('aria-label') ?? item.textContent?.trim().slice(0, 50), left: bounds.left, right: bounds.right }; });
    return { left: rect.left, right: rect.right, width: element.clientWidth, scrollWidth: element.scrollWidth, visible };
  });
  assert.ok(layout.scrollWidth <= layout.width + 2, 'No horizontal overflow: ' + JSON.stringify(layout));
  assert.deepEqual(layout.visible.filter(item => item.left < layout.left - 2 || item.right > layout.right + 2), []); return layout;
}

try {
  await fs.mkdir(path.join(path.dirname(projectFile), 'assets'), { recursive: true });
  authorHash = hash(await fs.readFile(authorFile)); report.authorSha256Before = authorHash;
  report.buildBefore = await builtFiles();
  for (const [suffix, file] of [['a', 'sdk-fonts/SourceHanSansLite.ttf'], ['b', 'renpy/common/DejaVuSans.ttf'], ['c', 'renpy/common/DejaVuSans-Bold.ttf']]) await fs.copyFile(path.join(root, 'resources/runtime', file), path.join(path.dirname(projectFile), 'assets/font-' + suffix + '.ttf'));
  await saveProject(projectFile, projectSchema.parse(project)); baseline = await read(); saved = baseline; report.fixtureSha256Before = hash(await fs.readFile(projectFile)); await launch();

  await check('真实框选打开共同面板：混合值、同值不同来源、上通用下功能', async () => {
    const canvas = await page!.locator('.ui-canvas').boundingBox(); assert.ok(canvas);
    await page!.mouse.move(canvas.x + .04 * canvas.width, canvas.y + .09 * canvas.height); await page!.mouse.down();
    await page!.mouse.move(canvas.x + .62 * canvas.width, canvas.y + .33 * canvas.height, { steps: 8 }); await page!.mouse.up();
    await expect(shell().locator('[data-ui-multi-count]')).toHaveAttribute('data-ui-multi-count', '2');
    await reveal('fontSize'); await expect(size()).toHaveValue(''); await expect(size()).toHaveAttribute('placeholder', '多个值');
    await expect(font()).toHaveAttribute('placeholder', '多个值'); await expect(color()).toHaveValue('#cfd8e0');
    await sources('textColor'); await expect(source('textColor', 'multi_a')).toContainText('本控件'); await expect(source('textColor', 'multi_b')).toContainText('页面默认');
    await expect(field('textColor').locator('summary')).toContainText('来源不同');
    assert.deepEqual(await shell().locator('[data-ui-inspector-region]').evaluateAll(elements => elements.map(element => element.getAttribute('data-ui-inspector-region'))), ['common', 'function']);
    await unchanged(saved); await screenshot('01-mixed-values-and-sources');
  });

  await check('数值、颜色、字体的值区右键和键盘菜单均保留正确范围', async () => {
    for (const [property, target] of [['fontSize', size()], ['textColor', color()], ['font', font()]] as const) {
      await openMenu(property, target); await expect(menu().getByRole('menuitem')).toHaveCount(2);
      await expect(page!.getByRole('menu', { name: '属性控制菜单', exact: true })).toHaveCount(0);
      await page!.keyboard.press('Escape'); await expect(menu()).toHaveCount(0); await expect(target).toBeFocused();
      await openMenu(property, target, true); await menu().getByRole('menuitem', { name: '查看各对象来源', exact: true }).click();
      await expect(menu()).toHaveCount(0); await expect(field(property).locator('.ui-multi-sources')).toHaveJSProperty('open', true);
    }
    await button('浏览共同字体').click(); const browser = page!.getByRole('dialog', { name: '共同字体资源浏览器', exact: true });
    await expect(browser).toBeVisible(); await expect(menu()).toHaveCount(0); await browser.getByRole('button', { name: '取消', exact: true }).click(); await unchanged(saved);
  });

  const originalPaint: Record<string, Awaited<ReturnType<typeof rendered>>> = {};
  await check('四项待改值不提前写入草稿或画布，所有项目字体可选', async () => {
    for (const id of ['multi_a', 'multi_b', 'multi_c']) originalPaint[id] = await rendered(id);
    await chooseFont('项目第三字体'); await reveal('fontSize'); await fillNumber(size(), '36'); await color().fill('#12345680'); await color().press('Tab');
    await reveal('opacity'); await fillNumber(opacity(), '65'); await expect(shell().locator('[data-pending="true"]')).toHaveCount(4);
    for (const id of ['multi_a', 'multi_b', 'multi_c']) assert.deepEqual(await rendered(id), originalPaint[id]);
    await unchanged(saved); await screenshot('02-staged-four-properties');
  });

  await check('一次应用四项、一次真实撤销全部恢复，后续批次独立撤销', async () => {
    await apply(); await changedDraft(); await expectBatch(); assert.deepEqual(await rendered('multi_c'), originalPaint.multi_c);
    await undo(); await reveal('fontSize'); await expect(size()).toHaveValue('');
    for (const id of ['multi_a', 'multi_b', 'multi_c']) assert.deepEqual(await rendered(id), originalPaint[id]); await unchanged(saved);
    await redo(); await expectBatch(); await reveal('opacity'); await fillNumber(opacity(), '45'); await apply();
    await expect(opacity()).toHaveValue('45'); await undo(); await expectBatch(); await undo(); await unchanged(saved);
    await redo(); await expectBatch(); saved = await save();
    const expected = structuredClone(baseline.ui);
    for (const id of ['multi_a', 'multi_b']) { const target = expected.components.find(item => item.id === id)!; target.style = { ...target.style, fontAssetId: 'multi_font_c', fontSize: 36, textColor: '#12345680', opacity: .65 }; }
    assert.deepEqual(saved.ui, expected); assert.deepEqual(saved.variables, baseline.variables); assert.deepEqual(saved.blueprints, baseline.blueprints); assert.deepEqual(saved.nodes, baseline.nodes);
    evidence.atomicBatch = { objects: 2, properties: 4, undoSteps: 1, unselectedUnchanged: true, parametersAndBlueprintsUnchanged: true }; await screenshot('03-applied-batch');
  });

  await check('相同显式值不会产生撤销记录，取消待改值恢复当前设计值', async () => {
    const applyButton = shell().getByRole('button', { name: /^应用到 \d+ 个控件$/ });
    await expect(button('撤销')).toBeDisabled(); await reveal('fontSize'); await fillNumber(size(), '36');
    await expect(shell().locator('[data-pending="true"]')).toHaveCount(0); await expect(applyButton).toBeDisabled();
    await expect(button('撤销')).toBeDisabled(); await unchanged(saved);
    // Filling the unchanged native input does not emit a change. Create a real
    // pending edit, then return to the saved value to exercise apply's no-op path.
    await fillNumber(size(), '47'); await expect(field('fontSize')).toHaveAttribute('data-pending', 'true');
    await fillNumber(size(), '36'); await expect(field('fontSize')).toHaveAttribute('data-pending', 'true');
    await expect(shell().locator('[data-pending="true"]')).toHaveCount(1); await expect(applyButton).toBeEnabled(); await apply();
    await expect(shell().getByRole('status')).toHaveText('这些属性已是所填的值。');
    await expect(button('撤销')).toBeDisabled(); await expect(applyButton).toBeDisabled(); await unchanged(saved); await expectBatch();
    await fillNumber(size(), '47'); await shell().getByRole('button', { name: '取消共同字号待改值', exact: true }).click();
    await expect(size()).toHaveValue('36'); await expect(shell().locator('[data-pending="true"]')).toHaveCount(0); await unchanged(saved);
  });

  await check('恢复默认后可连续重填数字与八位颜色，不丢失输入焦点', async () => {
    await reveal('fontSize'); await button('恢复共同字号设计默认值').click(); await expect(size()).toHaveValue('');
    await size().focus(); await size().pressSequentially('58', { delay: 50 }); await expect(size()).toBeFocused(); await expect(size()).toHaveValue('58');
    await button('恢复共同文字颜色设计默认值').click(); await color().focus(); await color().pressSequentially('#44556680', { delay: 40 });
    await expect(color()).toBeFocused(); await expect(color()).toHaveValue('#44556680');
    await shell().getByRole('button', { name: '取消待改值', exact: true }).click(); await expect(size()).toHaveValue('36'); await expect(color()).toHaveValue('#12345680'); await unchanged(saved);
    await openMenu('fontSize', size(), true); await menu().getByRole('menuitem', { name: '恢复各自设计默认值…', exact: true }).click();
    await expect(menu()).toHaveCount(0); await expect(field('fontSize')).toBeFocused(); await expect(size()).toHaveValue('');
    await shell().getByRole('button', { name: '取消待改值', exact: true }).click(); await unchanged(saved);
  });

  await check('恢复设计默认只删指定字段，保留颜色透明度及点击行为', async () => {
    const before = saved; await reveal('fontSize'); await button('恢复共同字号设计默认值').click(); await button('恢复共同字体设计默认值').click(); await apply();
    await changedDraft();
    await expect(size()).toHaveValue('28'); await expect(font()).toHaveValue('项目中文字体');
    await undo(); await expectBatch(); await unchanged(saved); await redo(); saved = await save();
    const expected = structuredClone(before.ui);
    for (const id of ['multi_a', 'multi_b']) { const style = expected.components.find(item => item.id === id)!.style!; delete style.fontSize; delete style.fontAssetId; }
    assert.deepEqual(saved.ui, expected); assert.deepEqual(saved.blueprints, before.blueprints);
  });

  await check('换选区或页面丢弃未应用字段，不把原选择的输入带到新对象', async () => {
    await reveal('fontSize'); await fillNumber(size(), '62'); await select(['multi_c']); await select(['multi_a', 'multi_b']); await reveal('fontSize');
    await expect(size()).toHaveValue('28'); await expect(shell().locator('[data-pending="true"]')).toHaveCount(0);
    await fillNumber(size(), '64'); await openPage('multi_restrictions'); await select(['multi_free', 'multi_follow']);
    await expect(shell().locator('[data-pending="true"]')).toHaveCount(0); await unchanged(saved);
  });

  await check('包含列表或无文字按钮时仅提供共同透明度', async () => {
    for (const [pageId, peer, other] of [['choice', 'multi_list_peer', 'multi_list'], ['multi_restrictions', 'multi_free', 'multi_hidden_text']]) {
      await openPage(pageId); await select([peer, other]); await expect(field('fontSize')).toHaveCount(0); await expect(field('font')).toHaveCount(0); await expect(field('textColor')).toHaveCount(0);
      await fillNumber(opacity(), '55'); await apply(); assert.equal((await rendered(peer)).opacity, '0.55'); assert.equal((await rendered(other)).opacity, '0.55');
      await undo(); await unchanged(saved);
    }
  });

  await check('锁定对象和锁定祖先阻止整批，准备后锁定也不会部分应用', async () => {
    for (const other of ['multi_locked', 'multi_locked_child']) {
      await select(['multi_free', other]); await expect(opacity()).toBeDisabled(); await reveal('fontSize'); await expect(size()).toBeDisabled();
      await sources('fontSize'); await expect(source('fontSize', other)).toContainText('锁定'); await expect(shell().getByRole('button', { name: /^应用到/ })).toBeDisabled(); await unchanged(saved);
    }
    await select(['multi_free', 'multi_follow']); await fillNumber(opacity(), '42');
    await row('multi_follow').getByRole('button', { name: '锁定 单向字号文字', exact: true }).click();
    await expect(opacity()).toBeDisabled(); await expect(shell().getByRole('button', { name: /^应用到/ })).toBeDisabled();
    assert.equal((await rendered('multi_free')).opacity, '0.9'); assert.equal((await rendered('multi_follow')).opacity, '0.8');
    await undo(); await shell().getByRole('button', { name: '取消待改值', exact: true }).click(); await unchanged(saved);
  });

  await check('单向与双向来源按属性限制，批量颜色不解除关联或写回参数', async () => {
    const before = saved;
    for (const [other, mode, expectedSize] of [['multi_follow', '单向跟随参数', 31], ['multi_sync', '与参数双向同步', 37]] as const) {
      await select(['multi_free', other]); await reveal('fontSize'); await expect(size()).toBeDisabled(); await sources('fontSize');
      await expect(source('fontSize', other)).toContainText(mode); await expect(source('fontSize', other)).toContainText('56 px');
      await reveal('textColor'); await expect(color()).toBeEnabled(); await color().fill('#884422'); await color().press('Tab'); await apply();
      saved = await save(); assert.equal(component(saved, other).style!.fontSize, expectedSize);
      assert.equal(component(saved, other).style!.textColor, '#884422'); assert.equal(component(saved, 'multi_free').style!.textColor, '#884422');
      assert.deepEqual(component(saved, other).propertyControls, component(before, other).propertyControls); assert.deepEqual(saved.variables, before.variables); assert.deepEqual(saved.blueprints, before.blueprints);
    }
    await screenshot('04-parameter-source-restrictions');
  });

  await check('失效来源仍受保护，可定位到单个对象排查', async () => {
    await select(['multi_free', 'multi_invalid']); await reveal('fontSize'); await expect(size()).toBeDisabled(); await sources('fontSize');
    await expect(source('fontSize', 'multi_invalid')).toContainText('来源参数已删除');
    await field('fontSize').click({ button: 'right', position: { x: 1, y: 2 } }); await expect(menu()).toBeVisible();
    await expect(menu().getByRole('menuitem', { name: '恢复各自设计默认值…', exact: true })).toBeDisabled(); await page!.keyboard.press('Escape');
    await source('fontSize', 'multi_invalid').getByRole('button', { name: '单独查看此控件', exact: true }).click();
    await expect(shell()).toHaveCount(0); await expect(row('multi_invalid')).toHaveAttribute('aria-selected', 'true'); await unchanged(saved);
  });

  await check('继承控件明确提示整控件覆盖，应用和撤销均不修改上级方案', async () => {
    await openPage('main'); await switchScheme('multi_derived'); saved = await save(); assert.equal(saved.ui.activeInstanceId, 'multi_derived'); const before = saved;
    await select(['multi_a', 'multi_b']); await expect(shell().locator('.ui-multi-inherited')).toContainText('2 个继承控件'); await expect(shell().locator('.ui-multi-inherited')).toContainText('整控件副本');
    await sources('fontSize'); await expect(source('fontSize', 'multi_a')).toContainText('上级测试方案'); await expect(source('fontSize', 'multi_b')).toContainText('基础界面');
    await fillNumber(size(), '44'); await apply(); await expect(shell().locator('.ui-multi-inherited')).toHaveCount(0); await expect(row('multi_a')).toContainText('覆盖');
    await undo(); await expect(shell().locator('.ui-multi-inherited')).toContainText('2 个继承控件'); await unchanged(saved);
    await redo(); saved = await save(); const expected = structuredClone(before.ui), derived = expected.instances!.find(item => item.id === 'multi_derived')!;
    derived.components = [structuredClone(expected.instances!.find(item => item.id === 'multi_base')!.components[0]), structuredClone(expected.components.find(item => item.id === 'multi_b')!)];
    for (const target of derived.components) target.style = { ...target.style, fontSize: 44 };
    assert.deepEqual(saved.ui, expected); await screenshot('05-inherited-whole-control-overrides');
  });

  await check('父子同时选中时分别写透明度，不因几何移动规则漏掉子对象', async () => {
    const before = saved;
    await select(['multi_parent', 'multi_child']); const beforeParent = await rendered('multi_parent'), beforeChild = await rendered('multi_child');
    await fillNumber(opacity(), '50'); await apply(); await changedDraft(); await expect(opacity()).toHaveValue('50'); await sources('opacity');
    for (const id of ['multi_parent', 'multi_child']) await expect(source('opacity', id).locator(':scope > div > span')).toHaveText('50%');
    // The flat canvas carries accumulated ancestor opacity; authored values
    // remain local, so a 50% child of a 50% parent is rendered at 25%.
    assert.equal((await rendered('multi_parent')).opacity, '0.5'); assert.equal((await rendered('multi_child')).opacity, '0.25');
    await undo(); assert.deepEqual(await rendered('multi_parent'), beforeParent); assert.deepEqual(await rendered('multi_child'), beforeChild); await unchanged(saved);
    await redo(); saved = await save(); const expected = structuredClone(before.ui), derived = expected.instances!.find(item => item.id === 'multi_derived')!;
    for (const id of ['multi_parent', 'multi_child']) {
      const target = structuredClone(expected.components.find(item => item.id === id)!); target.style = { ...target.style, opacity: .5 }; derived.components.push(target);
      assert.equal(saved.ui.instances!.find(item => item.id === 'multi_derived')!.components.find(item => item.id === id)!.style!.opacity, .5);
    }
    assert.deepEqual(saved.ui, expected); assert.deepEqual(saved.variables, before.variables); assert.deepEqual(saved.blueprints, before.blueprints); assert.deepEqual(saved.nodes, before.nodes);
    evidence.parentChildOpacity = { authored: { parent: .5, child: .5 }, rendered: { parent: .5, child: .25 }, undoSteps: 1, unrelatedFieldsUnchanged: true };
  });

  await check('明暗主题和窄栏均无横向溢出，字段来源菜单留在可视范围', async () => {
    await select(['multi_a', 'multi_b']); const layouts: unknown[] = [];
    for (const theme of ['黑白', '亮白']) {
      await button('作品设置').click(); await button('编辑器外观').click();
      const themeButton = page!.getByRole('group', { name: '编辑器配色', exact: true }).getByRole('button', { name: new RegExp('^' + theme) });
      await themeButton.click(); await expect(themeButton).toHaveAttribute('aria-pressed', 'true');
      await expect(page!.locator('html')).toHaveAttribute('data-editor-theme', theme === '亮白' ? 'codexLight' : 'codexDark');
      await button('关闭作品设置').click(); await expect(page!.getByRole('dialog', { name: '作品设置', exact: true })).toBeHidden();
      for (const width of [260, 360]) {
        await panelWidth(width); await sources('fontSize'); layouts.push({ theme, width, layout: await assertFits() });
        await openMenu('font', font(), true); const bounds = await menu().boundingBox(), viewport = await page!.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1);
        await screenshot(`06-${theme === '亮白' ? 'light' : 'dark'}-${width}`); await page!.keyboard.press('Escape'); await unchanged(saved);
      }
    }
    evidence.layouts = layouts;
  });

  await check('保存关闭重开保留共同修改、关联及继承范围，不残留待改值', async () => {
    const final = saved; await close(); await launch(); await select(['multi_a', 'multi_b']); await reveal('fontSize');
    await expect(size()).toHaveValue('44'); await expect(shell().locator('[data-pending="true"]')).toHaveCount(0);
    await expect(field('fontSize').locator('.ui-multi-sources > summary')).toContainText('当前方案控件'); await unchanged(final);
    assert.deepEqual((await read()).variables, baseline.variables); assert.deepEqual((await read()).blueprints, baseline.blueprints);
    report.fixtureSha256After = hash(await fs.readFile(projectFile)); await screenshot('07-reopened-multi-selection');
  });

  assert.equal(checks.length, 16); assert.deepEqual(errors, [], 'Renderer must not raise runtime errors.'); report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = String(error);
  if (app && page && !page.isClosed()) await screenshot('failure').catch(capture => { report.captureError = String(capture); });
} finally {
  try { await close(); } catch (error) { report.status = 'failed'; report.closeError = String(error); failure ??= error; }
  report.processCleanup = { allOwnedExited: !app && processes.every(record => record.exited), remainingPids: processes.filter(record => !record.exited).map(record => record.pid) };
  try { report.buildAfter = await builtFiles(); if (report.buildBefore !== undefined) assert.deepEqual(report.buildAfter, report.buildBefore, 'Do not rebuild during this acceptance.'); }
  catch (error) { report.status = 'failed'; report.buildProtectionError = String(error); failure ??= error; }
  try { const after = hash(await fs.readFile(authorFile)); report.authorSha256After = after; if (authorHash !== undefined) assert.equal(after, authorHash, 'The author project changed during isolated acceptance.'); }
  catch (error) { report.status = 'failed'; report.sourceProtectionError = String(error); failure ??= error; }
  try {
    if (app || processes.some(record => !record.exited)) throw new Error('Owned fixture process still alive; preserve its directories.');
    report.cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []);
  } catch (error) { report.status = 'failed'; report.cleanupError = String(error); failure ??= error; }
  await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
}
if (failure) throw failure;
