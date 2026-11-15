import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { projectSchema, type Project, type UiComponent } from '../src/core/model';
import { builtinUiPages } from '../src/core/ui-page-catalog';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { setUiCanvasPreview } from './lib/ui-design-controls';
import { createUiInspectorGeneralizationFixture } from './lib/ui-inspector-generalization-fixture';
import { uiFixturePng } from './lib/ui-fixture-image';
import { openDisclosureAncestors } from './lib/ui-disclosures';

// Prepared independently of product implementation. The coordinator runs this
// only after the complete change is built; no Vite server or installed editor.
if (process.env.VNS_INSTALLED_EXE) throw new Error('This acceptance must use the isolated development editor.');
const root = path.resolve('.');
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/ui-inspector-hierarchy-2026-11-08', 'hierarchy-editor-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const relativeOutput = path.relative(root, output);
assert.ok(relativeOutput && !path.isAbsolute(relativeOutput) && relativeOutput !== '..' && !relativeOutput.startsWith('..' + path.sep),
  'VNS_ARTIFACT_ROOT must keep acceptance output inside this checkout.');
const profile = path.join(output, 'profile');
const sourceFile = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? '../我的视觉小说1/project.vns.json');
const fontSource = path.join(root, 'resources/templates/aihong/assets/ai_ui_3510f58115c3cc3c.ttf');
const fontId = 'qa_hierarchy_font', fontName = '分层验收项目字体';
const component = (project: Project, id: string): UiComponent => {
  const result = project.ui.components.find(item => item.id === id);
  assert.ok(result, 'Fixture component still exists: ' + id); return result;
};
const mainProject = createUiInspectorGeneralizationFixture().project;
mainProject.id = 'ui_inspector_hierarchy'; mainProject.name = '分层控件属性验收';
mainProject.assets.push({ id: fontId, name: fontName, kind: 'font', category: 'font', path: 'hierarchy-font.ttf' });
component(mainProject, 'qa_button_a').style = { ...component(mainProject, 'qa_button_a').style, opacity: .65 };
component(mainProject, 'qa_button_b').disabled = false;
const saveFixture = component(mainProject, 'qa_save');
Object.assign(saveFixture, { name: '主存档列表', x: .06, y: .08, width: .74, saveMode: 'save' });
saveFixture.list = { ...saveFixture.list, fixedAutoSlot: true, slotAction: { x: .69, y: .06, width: .25, height: .14 } };
mainProject.ui.components.push({ ...structuredClone(saveFixture), id: 'qa_save_peer', name: '第二个存档列表', x: .83, y: .12, width: .15, height: .3 });
component(mainProject, 'qa_staff').text = '制作人员\n\n原始名单';
const otherProject = structuredClone(mainProject);
otherProject.id = 'ui_inspector_hierarchy_other'; otherProject.name = '同 ID 控件的另一个工程';
component(otherProject, 'qa_save').name = '另一个工程的存档列表';
component(otherProject, 'qa_save').list!.summaryFontSize = 37;
component(otherProject, 'qa_staff').text = '其他工程的名单';
type Fixture = { project: Project; file: string };
const primary: Fixture = { project: projectSchema.parse(mainProject), file: path.join(output, 'project/project.vns.json') };
const secondary: Fixture = { project: projectSchema.parse(otherProject), file: path.join(output, 'other-project/project.vns.json') };
let active = primary;
let app: ElectronApplication | undefined, page: Page | undefined, sourceHash: string | undefined, phase = 'setup', failure: unknown;
const checks: { name: string; status: 'passed'; durationMs: number }[] = [];
const errors: string[] = [], processes: { pid: number | undefined; exited: boolean }[] = [];
const evidence: Record<string, unknown> = {};
const report: Record<string, unknown> = { status: 'running', sourceFile, checks, errors, processes, evidence, compiledBuild: true, temporaryPaths: [path.dirname(primary.file), path.dirname(secondary.file), profile] };
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const read = async (fixture = active) => projectSchema.parse(JSON.parse(await fs.readFile(fixture.file, 'utf8')));
const shell = () => page!.locator('.ui-inspector');
// A part or flow-object editor retains its root view, hidden, to preserve drafts.
// Query the active view rather than accidentally filling an invisible root field.
const view = () => shell().locator('.ui-inspector-view:not([hidden])');
const region = (name: 'common' | 'function') => view().locator(`[data-ui-inspector-region="${name}"]`);
const group = (id: string) => view().locator(`[data-ui-inspector-group="${id}"]`);
const field = (name: string) => view().getByLabel(name, { exact: true });
const search = () => shell().getByLabel('搜索控件属性', { exact: true });
const partPicker = () => shell().locator('select:is([aria-label="编辑列表部件"],[aria-label="当前列表部件"]):visible');
const breadcrumbs = () => shell().locator('[data-ui-inspector-breadcrumb]:visible');
const functionTitle = () => region('function').locator('[data-ui-inspector-function-title]');
const canvas = (id: string) => page!.locator(`.ui-canvas [data-component-id="${id}"]`);
const canvasArea = () => page!.getByLabel('界面设计画布', { exact: true });
const opacity = () => field('控件不透明度 %');
const settle = async () => page!.evaluate(async () => {
  await document.fonts.ready;
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
});

async function launch() {
  active = primary;
  app = await launchDesktopFixture({ root, projectFile: primary.file, profile });
  processes.push({ pid: app.process().pid, exited: false });
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window.isMaximized()) window.unmaximize();
    window.setContentSize(1440, 960); window.webContents.setBackgroundThrottling(false);
  });
  await expect(page.locator('.project-title strong')).toHaveText(primary.project.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="ui"]').click();
  await page.evaluate('globalThis.__name = value => value');
}
async function close() {
  if (!app) return;
  const owned = app, child = owned.process();
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  try { await owned.close(); }
  finally {
    await expect.poll(exited, { timeout: 15000 }).toBe(true);
    const record = processes.find(item => item.pid === child.pid); if (record) record.exited = exited();
    if (exited()) { app = undefined; page = undefined; }
  }
}
async function screenshot(name: string) {
  await settle();
  const encoded = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(encoded, 'base64'));
}
async function check(name: string, work: () => Promise<void>) {
  phase = name; const started = Date.now(); await work();
  checks.push({ name, status: 'passed', durationMs: Date.now() - started });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log('通过：' + name);
}
async function select(id: string) {
  const target = component(active.project, id), picker = page!.getByLabel('设计页面', { exact: true });
  if (await picker.inputValue() !== target.page) {
    if (await picker.locator(`option[value="${target.page}"]`).count()) await picker.selectOption(target.page);
    else {
      await page!.getByRole('button', { name: '更多内置页面', exact: true }).click();
      const name = builtinUiPages[target.page as keyof typeof builtinUiPages].name;
      await page!.getByRole('button', { name: '编辑' + name, exact: true }).click();
    }
  }
  await page!.locator(`[data-hierarchy-id="${id}"]`).click();
  await expect(page!.locator(`[data-hierarchy-id="${id}"]`)).toHaveAttribute('aria-selected', 'true');
  await settle(); await expect(view()).toHaveCount(1);
}
async function save() {
  const button = page!.getByRole('button', { name: '保存界面', exact: true });
  if (await button.isEnabled()) await button.click();
  await expect(page!.locator('.ui-save-status')).toHaveText('已保存', { timeout: 30000 });
  await expect(button).toBeDisabled(); return read();
}
async function undo() { await page!.getByRole('button', { name: '撤销', exact: true }).click(); await settle(); }
async function redo() { await page!.getByRole('button', { name: '重做', exact: true }).click(); await settle(); }
async function clearSearch() {
  if (await search().inputValue()) await shell().getByRole('button', { name: '清除属性搜索', exact: true }).click();
  await settle();
}
async function openGroup(id: string, open = true) {
  const target = group(id); await expect(target).toHaveCount(1);
  await openDisclosureAncestors(target);
  if (await target.evaluate(element => (element as HTMLDetailsElement).open) !== open) await target.locator(':scope > summary').click();
  await expect(target).toHaveJSProperty('open', open); return target;
}
async function number(name: string, value: string) {
  const target = field(name); await expect(target).toBeVisible();
  await target.fill(value); await target.press('Tab'); await settle();
}
async function assertRoot() {
  assert.equal(await shell().getAttribute('data-ui-inspector-part'), null, 'Returning to a root control must clear part scope.');
  await expect(view()).toHaveCount(1);
  await expect(view()).toHaveAttribute('data-ui-inspector-view', 'component');
  await expect(view()).toHaveJSProperty('inert', false);
  await expect(group('layout')).toHaveCount(1); await expect(group('visibility')).toHaveCount(1);
  await expect(group('part-layout')).toHaveCount(0); await expect(group('part-appearance')).toHaveCount(0);
  await expect(shell().getByRole('button', { name: '返回整个控件', exact: true })).toHaveCount(0);
}
async function assertPart(name: string) {
  await expect(shell()).toHaveAttribute('data-ui-inspector-part', name);
  await expect(view()).toHaveCount(1); await expect(partPicker()).toHaveValue(name);
  await expect(view()).toHaveAttribute('data-ui-inspector-view', 'part');
  const retained = shell().locator('[data-ui-inspector-view="component"]');
  await expect(retained).toHaveCount(1); await expect(retained).toBeHidden(); await expect(retained).toHaveJSProperty('inert', true);
  await expect(region('common').locator('[data-ui-inspector-group="part-layout"]')).toHaveCount(1);
  await expect(region('function').locator('[data-ui-inspector-group="part-appearance"]')).toHaveCount(1);
  for (const id of ['layout', 'visibility', 'content', 'appearance', 'interaction', 'collection-layout', 'children', 'property-binding']) await expect(group(id)).toHaveCount(0);
  await expect(field('位置尺寸单位')).toHaveCount(0);
  await expect(view().locator('input[aria-label^="横向位置"],input[aria-label^="纵向位置"],input[aria-label="宽度 px"],input[aria-label="宽度 %"]')).toHaveCount(0);
  await expect(shell().getByRole('button', { name: '删除控件', exact: true })).toHaveCount(0);
  await expect(shell().getByRole('button', { name: '在本方案隐藏', exact: true })).toHaveCount(0);
  await expect(shell().getByRole('button', { name: '恢复整个继承控件', exact: true })).toHaveCount(0);
  await expect(shell().getByRole('button', { name: '返回整个控件', exact: true })).toBeVisible();
  await expect(breadcrumbs()).toHaveCount(1);
}
async function enterPart(name: string) {
  await clearSearch();
  if (await shell().getAttribute('data-ui-inspector-part') === null) {
    await openGroup('appearance');
    await expect(partPicker()).toHaveCount(1);
    if (await partPicker().inputValue() === name) await view().getByRole('button', { name: '编辑条目部件', exact: true }).click();
    else await partPicker().selectOption(name);
  } else await partPicker().selectOption(name);
  await settle(); await assertPart(name);
}
async function returnRoot() {
  await clearSearch(); await shell().getByRole('button', { name: '返回整个控件', exact: true }).click();
  await settle(); await assertRoot();
}
async function doubleClickPart(id: string, name: string, index = 0, modifiers?: ('Shift' | 'Control' | 'Alt')[]) {
  const target = canvas(id).locator(`[data-collection-part="${name}"]`).nth(index);
  await target.scrollIntoViewIfNeeded(); await settle();
  const bounds = await target.boundingBox(); assert.ok(bounds && bounds.width > 0 && bounds.height > 0);
  for (const modifier of modifiers ?? []) await page!.keyboard.down(modifier);
  try { await page!.mouse.dblclick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); }
  finally { for (const modifier of [...(modifiers ?? [])].reverse()) await page!.keyboard.up(modifier); }
  await settle();
  if (!modifiers) await assertPart(name);
}
async function assertUnchanged(before: Project, fixture = active) {
  await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled();
  const after = await read(fixture);
  assert.deepEqual(after.ui, before.ui, 'Navigation/search must not author any UI values.');
  assert.deepEqual(after.variables, before.variables);
}
async function groupState() {
  return view().locator('[data-ui-inspector-group]').evaluateAll(elements => Object.fromEntries(elements.map(element => [element.getAttribute('data-ui-inspector-group'), (element as HTMLDetailsElement).open])));
}
async function assertOrdered() {
  const order = await view().evaluate(element => {
    const common = element.querySelector<HTMLElement>('[data-ui-inspector-region="common"]')!, functionality = element.querySelector<HTMLElement>('[data-ui-inspector-region="function"]')!;
    const a = common.getBoundingClientRect(), b = functionality.getBoundingClientRect();
    return { commonBeforeFunction: !!(common.compareDocumentPosition(functionality) & Node.DOCUMENT_POSITION_FOLLOWING), commonTop: a.top, commonBottom: a.bottom, functionTop: b.top };
  });
  assert.equal(order.commonBeforeFunction, true); assert.ok(order.commonBottom <= order.functionTop + 1, JSON.stringify(order)); return order;
}
async function measurePanel() {
  return shell().evaluate(element => {
    const viewport = element.closest<HTMLElement>('.inspector-scroll')!, bounds = viewport.getBoundingClientRect();
    const visible = (item: HTMLElement) => {
      const rect = item.getBoundingClientRect();
      if (!rect.width || !rect.height || getComputedStyle(item).visibility === 'hidden' || item.closest('[hidden]')) return false;
      for (let parent = item.closest('details'); parent; parent = parent.parentElement?.closest('details') ?? null) {
        if (!parent.open && !parent.querySelector(':scope > summary')?.contains(item)) return false;
      }
      return true;
    };
    const fields = Array.from(element.querySelectorAll<HTMLElement>('input,select,textarea,summary,.field-label,[data-ui-inspector-function-title],[data-ui-inspector-breadcrumb]')).filter(visible).map(item => {
      const rect = item.getBoundingClientRect();
      return { label: item.getAttribute('aria-label') ?? item.textContent?.trim().slice(0, 80), x: rect.x, right: rect.right, width: rect.width, height: rect.height };
    });
    return { width: viewport.clientWidth, scrollWidth: viewport.scrollWidth, scrollTop: viewport.scrollTop, scrollHeight: viewport.scrollHeight, height: viewport.clientHeight, left: bounds.left, right: bounds.right, fields };
  });
}
async function assertFits() {
  const layout = await measurePanel();
  assert.ok(layout.scrollWidth <= layout.width + 1, 'Inspector horizontal overflow: ' + JSON.stringify(layout));
  assert.deepEqual(layout.fields.filter(item => item.x < layout.left - 2 || item.right > layout.right + 2), [], 'Every visible input, heading, and label must fit inside the panel.');
  return layout;
}
async function textContrast() {
  const values = await shell().evaluate(element => {
    const pixel = document.createElement('canvas'); pixel.width = 1; pixel.height = 1;
    const context = pixel.getContext('2d', { willReadFrequently: true })!;
    const color = (value: string) => { context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data]; };
    const over = (front: number[], back: number[]) => front.slice(0, 3).map((value, index) => value * front[3] / 255 + back[index] * (1 - front[3] / 255));
    const luminance = (rgb: number[]) => rgb.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    return Array.from(element.querySelectorAll<HTMLElement>('.field-label,.ui-group-title,.ui-design-source,.ui-collection-source,[data-ui-inspector-function-title]')).filter(item => {
      const rect = item.getBoundingClientRect();
      if (!rect.width || !rect.height || !item.textContent?.trim() || item.closest('[hidden]') || getComputedStyle(item).visibility === 'hidden') return false;
      for (let parent = item.closest('details'); parent; parent = parent.parentElement?.closest('details') ?? null) {
        if (!parent.open && !parent.querySelector(':scope > summary')?.contains(item)) return false;
      }
      return true;
    }).map(item => {
      const ancestors: Element[] = [];
      for (let current: Element | null = item; current; current = current.parentElement) ancestors.unshift(current);
      const background = ancestors.reduce((behind, current) => over(color(getComputedStyle(current).backgroundColor), behind), [255, 255, 255]);
      const foreground = over(color(getComputedStyle(item).color), background), a = luminance(foreground), b = luminance(background);
      return { text: item.textContent!.trim().slice(0, 80), foreground, background, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
  });
  assert.ok(values.length > 0);
  for (const value of values) assert.ok(value.ratio >= 4.5, 'Label contrast: ' + JSON.stringify(value)); return values;
}
async function panelWidth(width: number) {
  const bounds = await page!.locator('[data-dock-panel="inspector"]').boundingBox();
  const divider = await page!.getByRole('separator', { name: '调整右侧面板宽度', exact: true }).boundingBox(); assert.ok(bounds && divider);
  const x = divider.x + divider.width / 2, y = divider.y + Math.min(100, divider.height / 2);
  await page!.mouse.move(x, y); await page!.mouse.down(); await page!.mouse.move(x + bounds.width - width, y, { steps: 4 }); await page!.mouse.up(); await settle();
  const actual = await page!.locator('[data-dock-panel="inspector"]').boundingBox();
  assert.ok(actual && Math.abs(actual.width - width) <= 8, `Cannot exercise requested ${width}px panel: ${actual?.width}`);
}
async function switchAppearance(name: string) {
  const input = field('允许玩家操作');
  await input.scrollIntoViewIfNeeded();
  await input.evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)); });
  const geometry = await input.evaluate(element => {
    const control = element as HTMLInputElement, track = getComputedStyle(control), thumb = getComputedStyle(control, '::after');
    const transform = new DOMMatrixReadOnly(thumb.transform === 'none' ? undefined : thumb.transform);
    return {
      checked: control.checked, width: control.offsetWidth, height: control.offsetHeight,
      left: parseFloat(track.borderLeftWidth) + parseFloat(thumb.left) + transform.m41,
      top: parseFloat(track.borderTopWidth) + parseFloat(thumb.top) + transform.m42,
      thumbWidth: parseFloat(thumb.width), thumbHeight: parseFloat(thumb.height),
      trackColor: track.backgroundColor, thumbColor: thumb.backgroundColor,
    };
  });
  assert.ok(geometry.left > 0 && geometry.top > 0);
  assert.ok(geometry.left + geometry.thumbWidth < geometry.width && geometry.top + geometry.thumbHeight < geometry.height, 'Slider must remain inside the track.');
  const center = { x: geometry.left + geometry.thumbWidth / 2, y: geometry.top + geometry.thumbHeight / 2 };
  assert.equal(center.x > geometry.width / 2, geometry.checked, 'Slider position must communicate the current state.');
  const png = PNG.sync.read(await input.screenshot({ path: path.join(output, name + '-control.png') }));
  const pixel = (x: number, y: number) => {
    const offset = (Math.floor(y * png.height / geometry.height) * png.width + Math.floor(x * png.width / geometry.width)) * 4;
    return [...png.data.subarray(offset, offset + 3)];
  };
  const thumb = pixel(center.x, center.y), track = pixel(geometry.width - center.x, center.y);
  const luminance = (rgb: number[]) => rgb.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const a = luminance(thumb), b = luminance(track), contrast = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  assert.ok(contrast >= 4.5, 'Actual slider/track pixels must remain distinguishable: ' + JSON.stringify({ name, thumb, track, contrast, geometry }));
  await input.locator('..').locator('..').screenshot({ path: path.join(output, name + '.png') });
  return { ...geometry, pixels: { thumb, track }, contrast };
}
async function fieldArrangement(input: Locator, inline: boolean) {
  const layout = await input.evaluate(element => {
    const field = element.closest<HTMLElement>('.field')!, label = field.querySelector<HTMLElement>(':scope > .field-control > .field-label')!;
    const rect = (value: Element) => { const r = value.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const help = field.querySelector(':scope > .field-help > summary');
    return { label: rect(label), input: rect(element), field: rect(field), help: help ? rect(help) : undefined };
  });
  if (inline) {
    assert.ok(layout.label.right + 3 <= layout.input.x, 'Label and input need a gap: ' + JSON.stringify(layout));
    assert.ok(Math.min(layout.label.bottom, layout.input.bottom) > Math.max(layout.label.y, layout.input.y), 'Label and input must share a row.');
    assert.ok(layout.input.width >= 80, 'Inline input must remain usable: ' + JSON.stringify(layout));
    if (layout.help) assert.ok(layout.help.x >= layout.input.right + 1, 'Help must not cover the input or its dropdown arrow.');
  } else assert.ok(layout.label.bottom <= layout.input.y + 1, 'Complex/narrow field must retain full input width: ' + JSON.stringify(layout));
  assert.ok(layout.input.right <= layout.field.right + 1);
  return layout;
}
async function openProject(fixture: Fixture) {
  await app!.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, fixture.file);
  await page!.getByRole('button', { name: '打开工程', exact: true }).click();
  await expect(page!.locator('.project-title strong')).toHaveText(fixture.project.name, { timeout: 45000 });
  active = fixture; await page!.locator('[data-workspace-tab="ui"]').click(); await settle();
}

try {
  await fs.mkdir(output, { recursive: true });
  sourceHash = sha256(await fs.readFile(sourceFile)); report.sourceSha256Before = sourceHash;
  report.rendererIndexSha256 = sha256(await fs.readFile(path.join(root, 'dist/index.html')));
  report.desktopMainSha256 = sha256(await fs.readFile(path.join(root, 'dist-desktop/main.cjs')));
  for (const fixture of [primary, secondary]) {
    await fs.mkdir(path.dirname(fixture.file), { recursive: true });
    await fs.writeFile(fixture.file, JSON.stringify(fixture.project, null, 2));
    for (const asset of fixture.project.assets) {
      const destination = path.join(path.dirname(fixture.file), asset.path);
      if (asset.kind === 'font') await fs.copyFile(fontSource, destination);
      else await fs.writeFile(destination, uiFixturePng());
    }
  }
  await launch();

  await check('通用区域在功能区域之前，标题使用真实控件类型', async () => {
    const cases = [
      ['qa_button_a', '按钮'], ['qa_image', '图片'], ['qa_slider', '滑条'], ['qa_input', '文字输入框'],
      ['qa_choice', '下拉菜单'], ['qa_save', '存档槽'], ['qa_history', '历史列表'], ['qa_flow', '玩家剧情图'], ['qa_staff', '制作人员名单'],
    ];
    const original = await save(), inventory: unknown[] = [];
    for (const [id, title] of cases) {
      await select(id); await assertRoot(); await clearSearch();
      await expect(region('common')).toHaveCount(1); await expect(region('function')).toHaveCount(1);
      for (const groupId of ['layout', 'visibility', 'children']) await expect(region('common').locator(`[data-ui-inspector-group="${groupId}"]`)).toHaveCount(1);
      await expect(region('function').locator('[data-ui-inspector-group="children"]')).toHaveCount(0);
      await expect(functionTitle()).toHaveText(title);
      await openGroup('layout'); await openGroup('visibility');
      await expect(region('common').getByLabel('位置尺寸单位', { exact: true })).toBeVisible();
      await expect(region('common').getByLabel('控件不透明度 %', { exact: true })).toBeVisible();
      await expect(region('function').locator('[data-ui-design-field="opacity"]')).toHaveCount(0);
      if (id === 'qa_flow') for (const flowGroup of ['flow-mode', 'flow-content', 'flow-style', 'flow-layout', 'flow-browsing', 'flow-player', 'flow-sources-entry']) await expect(region('function').locator(`[data-ui-inspector-group="${flowGroup}"]`)).toHaveCount(1);
      else for (const functionGroup of ['content', 'appearance', 'interaction']) await expect(region('function').locator(`[data-ui-inspector-group="${functionGroup}"]`)).toHaveCount(1);
      inventory.push({ id, title, order: await assertOrdered(), layout: await assertFits() });
    }
    await assertUnchanged(original); evidence.inventory = inventory; await screenshot('01-common-before-function');
  });

  await check('子对象在通用属性中连续添加，保持父对象选择并可逐次撤销', async () => {
    await select('qa_panel'); await clearSearch(); await openGroup('layout', false); await openGroup('visibility', false);
    await openGroup('children'); await openGroup('structure-create');
    const original = await save(), parentName = component(original, 'qa_panel').name;
    const originalChildren = original.ui.components.filter(item => item.parentId === 'qa_panel');
    const childList = () => region('common').getByRole('list', { name: '子对象列表', exact: true });
    const additions = [
      { button: '添加子图片', name: '子图片', kind: 'image', layer: 'foreground', inheritState: true },
      { button: '添加背景子图', name: '背景', kind: 'image', layer: 'background', inheritState: true },
      { button: '添加子文字', name: '子文字', kind: 'text', layer: 'foreground', inheritState: true },
      { button: '添加子按钮', name: '子按钮', kind: 'button', layer: 'foreground', inheritState: false },
    ] as const;
    for (const [index, addition] of additions.entries()) {
      await region('common').getByRole('button', { name: addition.button, exact: true }).click(); await settle();
      await expect(page!.locator('[data-hierarchy-id="qa_panel"]')).toHaveAttribute('aria-selected', 'true');
      await expect(page!.locator('[data-hierarchy-id][aria-selected="true"]')).toHaveCount(1);
      await expect(shell().getByLabel('控件显示名称', { exact: true })).toHaveValue(parentName ?? '');
      await expect(group('children')).toHaveJSProperty('open', true); await expect(group('structure-create')).toHaveJSProperty('open', true);
      await expect(childList().getByRole('listitem')).toHaveCount(originalChildren.length + index + 1);
      await expect(childList().getByRole('button', { name: addition.name, exact: true })).toBeVisible();
    }
    for (let index = additions.length - 1; index >= 0; index--) {
      await undo(); await expect(childList().getByRole('listitem')).toHaveCount(originalChildren.length + index);
      await expect(childList().getByRole('button', { name: additions[index].name, exact: true })).toHaveCount(0);
      await expect(page!.locator('[data-hierarchy-id="qa_panel"]')).toHaveAttribute('aria-selected', 'true');
    }
    for (const [index, addition] of additions.entries()) {
      await redo(); await expect(childList().getByRole('listitem')).toHaveCount(originalChildren.length + index + 1);
      await expect(childList().getByRole('button', { name: addition.name, exact: true })).toBeVisible();
      await expect(page!.locator('[data-hierarchy-id="qa_panel"]')).toHaveAttribute('aria-selected', 'true');
    }
    const addedProject = await save(), added = addedProject.ui.components.filter(item => !original.ui.components.some(before => before.id === item.id));
    assert.equal(added.length, 4);
    assert.deepEqual(addedProject.ui.components.filter(item => !added.some(child => child.id === item.id)), original.ui.components);
    for (const [index, item] of added.entries()) {
      assert.equal(item.parentId, 'qa_panel'); assert.equal(item.page, 'main');
      assert.equal(item.name, additions[index].name); assert.equal(item.kind, additions[index].kind);
      assert.equal(item.childLayer, additions[index].layer); assert.equal(item.inheritState, additions[index].inheritState);
    }
    await screenshot('01-common-children-keeps-parent');
    await childList().getByRole('button', { name: '子文字', exact: true }).click(); await settle();
    await expect(page!.locator(`[data-hierarchy-id="${added[2].id}"]`)).toHaveAttribute('aria-selected', 'true');
    await expect(shell().getByLabel('控件显示名称', { exact: true })).toHaveValue('子文字');
    // Selecting a child is explicit. Return through the actual parent button,
    // then remove only this check's added objects via the normal Delete command.
    await openGroup('layout'); await openGroup('structure-parent');
    await view().getByRole('button', { name: '编辑父对象：' + parentName, exact: true }).click(); await settle();
    await expect(page!.locator('[data-hierarchy-id="qa_panel"]')).toHaveAttribute('aria-selected', 'true');
    await expect(group('children')).toHaveJSProperty('open', true);
    for (const item of added) {
      await page!.locator(`[data-hierarchy-id="${item.id}"]`).click(); await canvasArea().focus(); await page!.keyboard.press('Delete'); await settle();
    }
    await select('qa_panel'); assert.deepEqual((await save()).ui, original.ui);
    evidence.childCreation = { parentRetained: true, consecutiveAdditions: 4, oneUndoPerAddition: true, explicitChildSelection: true, sourceValuesRestored: true };
  });

  await check('同类切换保留功能任务、预览状态和通用位置单位', async () => {
    await select('qa_button_a'); await openGroup('layout'); await openGroup('visibility', false); await openGroup('appearance'); await openGroup('appearance-text');
    await field('位置尺寸单位').selectOption('pixel'); await expect(field('宽度 px')).toHaveValue('409.6');
    await field('外观预览状态').selectOption('hover');
    await expect(canvas('qa_button_a')).toHaveAttribute('data-preview-state', 'hover');
    await field('字号').scrollIntoViewIfNeeded(); await settle();
    const before = await measurePanel(), original = await save();
    await select('qa_button_b');
    await expect(group('appearance')).toHaveJSProperty('open', true); await expect(field('外观预览状态')).toHaveValue('hover');
    await expect(field('位置尺寸单位')).toHaveValue('pixel'); await expect(field('宽度 px')).toHaveValue('409.6');
    const after = await measurePanel();
    assert.ok(Math.abs(after.scrollTop - before.scrollTop) <= 48, JSON.stringify({ before: before.scrollTop, after: after.scrollTop }));
    if (before.scrollTop > 80) assert.ok(after.scrollTop > 40);
    await assertUnchanged(original); evidence.continuity = { before, after };
  });

  await check('字体与通用透明度恢复互不影响，功能整组恢复保留通用值', async () => {
    await select('qa_button_a'); await openGroup('visibility'); await openGroup('appearance'); await openGroup('appearance-text');
    const original = component(await save(), 'qa_button_a');
    await field('字体').fill(fontName); await field('字体').press('Enter'); await settle();
    await expect(field('字体')).toHaveValue(fontName);
    await expect(canvas('qa_button_a')).toHaveCSS('font-family', new RegExp('vns_' + fontId));
    await expect.poll(() => page!.evaluate(async id => {
      await document.fonts.ready;
      const family = `vns_${id}`;
      return Array.from(document.fonts).some(face => face.family.replaceAll('"', '') === family && face.status === 'loaded')
        && document.fonts.check(`20px "${family}"`, '打开设置');
    }, fontId), { message: 'The selected project font must load rather than remain a fallback.' }).toBe(true);
    await number('字号', '32'); await number('控件不透明度 %', '37');
    await region('function').getByRole('button', { name: '恢复字体', exact: true }).click();
    await expect(field('字体')).toHaveValue(''); await expect(opacity()).toHaveValue('37'); await expect(field('字号')).toHaveValue('32');
    await undo(); await expect(field('字体')).toHaveValue(fontName);
    await region('common').getByRole('button', { name: '恢复控件不透明度 %', exact: true }).click();
    await expect(opacity()).toHaveValue('100'); await expect(field('字体')).toHaveValue(fontName); await expect(field('字号')).toHaveValue('32');
    await undo(); await expect(opacity()).toHaveValue('37'); await redo();
    let saved = component(await save(), 'qa_button_a');
    assert.equal(saved.style?.opacity, undefined); assert.equal(saved.style?.fontAssetId, fontId); assert.equal(saved.style?.fontSize, 32);
    assert.equal(saved.style?.background, original.style?.background);
    await number('控件不透明度 %', '41');
    await region('function').getByRole('button', { name: '恢复本组外观', exact: true }).click();
    await expect(opacity()).toHaveValue('41'); await expect(field('字体')).toHaveValue(''); await expect(field('字号')).toHaveValue('28');
    await expect(canvas('qa_button_a')).toHaveCSS('opacity', '0.41');
    await undo(); await expect(field('字体')).toHaveValue(fontName); await expect(opacity()).toHaveValue('41');
    saved = component(await save(), 'qa_button_a');
    assert.equal(saved.style?.opacity, .41); assert.equal(saved.style?.fontAssetId, fontId); assert.equal(saved.style?.background, original.style?.background);
    await select('qa_button_b'); await openGroup('visibility'); await openGroup('appearance');
    const other = component(await save(), 'qa_button_b');
    await number('控件不透明度 %', '57');
    await expect(region('function').getByRole('button', { name: '恢复本组外观', exact: true })).toBeDisabled();
    await region('common').getByRole('button', { name: '恢复控件不透明度 %', exact: true }).click();
    const restoredOther = component(await save(), 'qa_button_b');
    // The field adapter keeps an empty style container after its last field is
    // reset. Compare all authored fields without requiring that container gone.
    assert.equal(restoredOther.style?.opacity, undefined);
    assert.deepEqual({ ...restoredOther, style: restoredOther.style ?? {} }, { ...other, style: other.style ?? {} });
    evidence.resetIsolation = saved.style; await screenshot('02-common-opacity-isolation');
  });

  await check('搜索定位真实区域，部件字段只引导进入部件且不写设计稿', async () => {
    const cases = [
      { id: 'qa_button_a', query: '字体', owner: 'function', group: 'appearance', field: '字体' },
      { id: 'qa_button_a', query: '控件不透明度', owner: 'common', group: 'visibility', field: '控件不透明度 %' },
      { id: 'qa_button_a', query: 'visibleWhen', owner: 'common', group: 'visibility', nested: 'interaction-condition-visibleWhen' },
      { id: 'qa_save', query: '每页行数', owner: 'function', group: 'collection-layout', field: '每页行数' },
      { id: 'qa_panel', query: '子对象排列', owner: 'common', group: 'children', nested: 'layout-children' },
      { id: 'qa_image', query: '图片缩放', owner: 'function', group: 'content', field: '图片缩放' },
      { id: 'qa_staff', query: '名单文字', owner: 'function', group: 'content', field: '名单文字' },
      { id: 'qa_flow', query: 'visibleWhen', owner: 'common', group: 'visibility', nested: 'interaction-condition-visibleWhen' },
      { id: 'qa_flow', query: '水平连线图片', owner: 'function', group: 'flow-layout', nested: 'flow-layout-line-images' },
    ] as const;
    const original = await save();
    for (const item of cases) {
      await select(item.id); await clearSearch();
      const before = await groupState(); await search().fill(item.query);
      const target = region(item.owner).locator(`[data-ui-inspector-group="${item.group}"]`);
      await expect(target).toBeVisible(); await expect(target).toHaveJSProperty('open', true); await expect(target).toHaveAttribute('data-search-match', 'true');
      if ('nested' in item) { await expect(group(item.nested)).toBeVisible(); await expect(group(item.nested)).toHaveJSProperty('open', true); }
      if ('field' in item) await expect(region(item.owner).getByLabel(item.field, { exact: true })).toBeVisible();
      if (item.query === '控件不透明度' || item.query === 'visibleWhen') await expect(group('appearance')).toBeHidden();
      if (item.query === '每页行数' || item.query === '子对象排列') await expect(group('layout')).toBeHidden();
      await clearSearch();
      const after = await groupState();
      for (const [id, open] of Object.entries(before)) assert.equal(after[id], open, 'Search changed remembered disclosure: ' + id);
    }
    await select('qa_save'); await search().fill('对白摘要字号');
    await expect(group('appearance')).toBeVisible(); await expect(view().getByRole('button', { name: '编辑条目部件', exact: true })).toBeVisible();
    await expect(field('对白摘要字号')).toHaveCount(0); await expect(group('layout')).toBeHidden();
    await clearSearch(); await assertUnchanged(original); evidence.search = cases;
  });

  await check('范围和显示条件的未应用草稿跨搜索及折叠保留', async () => {
    await select('qa_slider'); await openGroup('content'); await openGroup('control-range');
    const original = await save();
    await number('控件范围下限', '2');
    await expect(view().getByRole('button', { name: '应用整个控件范围', exact: true })).toBeDisabled();
    await search().fill('opacity'); await expect(opacity()).toBeVisible(); await clearSearch();
    await expect(field('控件范围下限')).toHaveValue('2'); await assertUnchanged(original);
    await number('控件范围下限', '0.2'); await number('控件范围上限', '0.8'); await number('用户调整步长', '0.1');
    await openGroup('content', false); await openGroup('content'); await expect(field('控件范围下限')).toHaveValue('0.2');
    await view().getByRole('button', { name: '应用整个控件范围', exact: true }).click();
    await undo(); await expect(field('控件范围下限')).toHaveValue('0'); await redo();
    const range = component(await save(), 'qa_slider').controlRange; assert.deepEqual(range, { min: .2, max: .8, step: .1 });
    await view().getByRole('button', { name: '恢复绑定源范围', exact: true }).click(); await save();
    await select('qa_event_button'); await openGroup('visibility'); await openGroup('interaction-condition-visibleWhen');
    const beforeCondition = await save();
    await group('interaction-condition-visibleWhen').getByRole('button', { name: '添加显示条件', exact: true }).click();
    await field('比较方式').selectOption('gte');
    await search().fill('字体'); await clearSearch();
    await expect(field('比较方式')).toHaveValue('gte'); await assertUnchanged(beforeCondition);
    await group('interaction-condition-visibleWhen').getByRole('button', { name: '应用显示条件', exact: true }).click();
    await undo(); await expect(group('interaction-condition-visibleWhen').getByRole('button', { name: '添加显示条件', exact: true })).toBeVisible();
    await redo();
    assert.deepEqual(component(await save(), 'qa_event_button').visibleWhen, { kind: 'compare', variableId: 'qa_number', operator: 'gte', value: 45 });
    await group('interaction-condition-visibleWhen').getByRole('button', { name: '清除显示条件', exact: true }).click(); await save();
    evidence.drafts = { range, condition: 'gte 45', restored: true };
  });

  await check('已关联属性独立于内容和显示条件，查询与取消来源设置不写工程', async () => {
    await select('qa_text'); await clearSearch();
    await openGroup('content'); await openGroup('visibility');
    await expect(group('content').locator('[data-ui-inspector-group="property-binding"]')).toHaveCount(0);
    await expect(region('common').locator('[data-ui-inspector-group="property-binding"]')).toHaveCount(0);
    await expect(region('function').locator('[data-ui-inspector-group="property-binding"]')).toHaveCount(1);
    const original = await save();
    await search().fill('联动参数'); await expect(group('property-binding')).toBeVisible();
    await expect(group('property-binding')).toHaveJSProperty('open', true);
    await expect(group('property-binding').locator(':scope > summary')).toContainText('已关联属性');
    const entry = group('property-binding').getByRole('button', { name: '关联其他属性…', exact: true });
    await expect(entry).toBeVisible(); await assertUnchanged(original);
    await entry.click();
    const dialog = page!.getByRole('dialog', { name: '属性控制设置', exact: true });
    await dialog.getByLabel('关联属性', { exact: true }).selectOption('visible');
    await dialog.getByLabel('控制方式', { exact: true }).selectOption('follow');
    await dialog.getByLabel('来源参数', { exact: true }).selectOption('qa_boolean');
    await expect(dialog.getByLabel('来源参数', { exact: true })).toHaveValue('qa_boolean');
    await expect(dialog.getByRole('button', { name: '应用设置', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: '取消', exact: true }).click(); await expect(dialog).toHaveCount(0);
    await clearSearch(); await openGroup('property-binding'); await expect(entry).toBeVisible();
    await expect(group('property-binding').locator('[data-linked-property]')).toHaveCount(0);
    await assertUnchanged(original); assert.deepEqual(await read(), original, 'Searching and cancelling a source dialog must not create blueprints or modify the saved project.');
  });

  await check('部件入口进入独立层级，返回恢复根折叠、滚动、选择与草稿', async () => {
    await select('qa_save'); await setUiCanvasPreview(page!, '存档预览内容', 'filled');
    await openGroup('layout', false); await openGroup('visibility'); await openGroup('interaction-condition-visibleWhen');
    const original = await save();
    await group('interaction-condition-visibleWhen').getByRole('button', { name: '添加显示条件', exact: true }).click();
    await field('比较方式').selectOption('gte');
    await openGroup('collection-layout'); await openGroup('content', false); await openGroup('appearance'); await openGroup('interaction', false);
    await expect(region('common').getByLabel('每页行数', { exact: true })).toHaveCount(0);
    await expect(region('function').locator('[data-ui-inspector-group="collection-layout"]').getByLabel('每页行数', { exact: true })).toBeVisible();
    await expect(field('对白摘要字号')).toHaveCount(0); await expect(partPicker()).toHaveValue('item');
    await view().getByRole('button', { name: '编辑条目部件', exact: true }).scrollIntoViewIfNeeded(); await settle();
    const beforeGroups = await groupState(), before = await measurePanel();
    await view().getByRole('button', { name: '编辑条目部件', exact: true }).click(); await assertPart('item');
    await expect(breadcrumbs()).toContainText('主存档列表'); await expect(breadcrumbs()).toContainText('整个条目');
    await openGroup('part-layout'); await expect(region('common').getByLabel('条目宽度', { exact: true })).toBeVisible();
    await expect(region('function').getByLabel('条目宽度', { exact: true })).toHaveCount(0);
    await returnRoot();
    assert.deepEqual(await groupState(), beforeGroups);
    const after = await measurePanel(); assert.ok(Math.abs(after.scrollTop - before.scrollTop) <= 48, JSON.stringify({ before: before.scrollTop, after: after.scrollTop }));
    await expect(page!.locator('[data-hierarchy-id="qa_save"]')).toHaveAttribute('aria-selected', 'true');
    await expect(field('比较方式')).toHaveValue('gte');
    await group('interaction-condition-visibleWhen').getByRole('button', { name: '取消', exact: true }).click();
    await assertUnchanged(original); evidence.rootReturn = { beforeGroups, before, after };

    // Ordinary part navigation keeps its search. A directed layout entry must
    // clear that filter and reopen the requested section, including a repeat.
    await enterPart('item'); await openGroup('part-layout', false); await search().fill('空槽图片');
    await expect(group('part-layout')).toBeHidden();
    await expect(region('function').getByRole('combobox', { name: '空槽图片', exact: true })).toBeVisible();
    await shell().getByRole('button', { name: '返回整个控件', exact: true }).click(); await assertRoot();
    await openGroup('appearance'); await view().getByRole('button', { name: '编辑条目部件', exact: true }).click(); await assertPart('item');
    await expect(search()).toHaveValue('空槽图片'); await expect(group('part-layout')).toBeHidden();
    for (let repeat = 0; repeat < 2; repeat++) {
      await shell().getByRole('button', { name: '返回整个控件', exact: true }).click(); await assertRoot();
      await openGroup('collection-layout'); await view().getByRole('button', { name: '编辑条目尺寸与留白', exact: true }).click(); await assertPart('item');
      await expect(search()).toHaveValue(''); await expect(group('part-layout')).toHaveJSProperty('open', true);
      await expect(field('条目宽度')).toBeVisible();
      if (!repeat) { await openGroup('part-layout', false); await search().fill('空槽图片'); }
    }
    await returnRoot(); await enterPart('navigationRect'); await openGroup('part-layout', false); await search().fill('分页按钮图片');
    await expect(group('part-layout')).toBeHidden();
    await shell().getByRole('button', { name: '返回整个控件', exact: true }).click(); await assertRoot();
    await openGroup('collection-layout'); await view().getByRole('button', { name: '编辑分页位置与按钮大小', exact: true }).click(); await assertPart('navigationRect');
    await expect(search()).toHaveValue(''); await expect(group('part-layout')).toHaveJSProperty('open', true); await expect(field('分页位置')).toBeVisible();
    await returnRoot(); await assertUnchanged(original);
    evidence.directedPartEntries = { ordinarySearchRetained: true, itemLayoutRepeated: true, navigationLayout: true };
    await screenshot('03-root-return');
  });

  await check('摘要部件编辑只写列表内部数据，撤销与几何保持准确', async () => {
    await select('qa_save'); await doubleClickPart('qa_save', 'caption');
    await expect(breadcrumbs()).toContainText('对白摘要');
    await openGroup('part-layout'); await openGroup('part-appearance');
    const original = await save(), old = component(original, 'qa_save'), rootBounds = await canvas('qa_save').boundingBox();
    await expect(region('function').getByLabel('对白摘要字号', { exact: true })).toHaveValue('23');
    await number('对白摘要字号', '31'); await undo(); await expect(field('对白摘要字号')).toHaveValue('23'); await redo();
    await view().getByRole('button', { name: '恢复对白摘要字号', exact: true }).click();
    await expect(field('对白摘要字号')).toHaveValue('23'); await undo(); await expect(field('对白摘要字号')).toHaveValue('31');
    await expect(region('common').getByLabel('对白摘要横向 %', { exact: true })).toHaveValue('8');
    await expect(region('function').getByLabel('对白摘要横向 %', { exact: true })).toHaveCount(0);
    const caption = canvas('qa_save').locator('[data-collection-part="caption"]').first(), before = await caption.boundingBox();
    await number('对白摘要横向 %', '11'); const after = await caption.boundingBox(); assert.ok(before && after && after.x > before.x);
    assert.deepEqual(await canvas('qa_save').boundingBox(), rootBounds, 'Moving the repeated caption must not move or resize the root list.');
    await undo(); await expect(field('对白摘要横向 %')).toHaveValue('8'); await redo();
    const saved = await save(), current = component(saved, 'qa_save');
    assert.deepEqual({ ...current, list: undefined }, { ...old, list: undefined });
    assert.deepEqual(saved.ui.components.filter(item => item.id !== 'qa_save'), original.ui.components.filter(item => item.id !== 'qa_save'));
    assert.deepEqual(saved.variables, original.variables);
    assert.equal(current.list?.summaryFontSize, 23); assert.equal(current.list?.textStyles?.caption?.fontSize, 31); assert.equal(current.list?.caption?.x, .11);
    await partPicker().selectOption('thumbnail'); await assertPart('thumbnail'); await openGroup('part-layout');
    const thumbnail = canvas('qa_save').locator('[data-collection-part="thumbnail"]').first(), thumbnailBefore = await thumbnail.boundingBox();
    await field('自定义缩略图位置').check(); const thumbnailAfter = await thumbnail.boundingBox(); assert.ok(thumbnailBefore && thumbnailAfter);
    for (const axis of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(thumbnailAfter[axis] - thumbnailBefore[axis]) < 1.5, 'Custom thumbnail changes ' + axis);
    await undo(); assert.equal(component(await save(), 'qa_save').list?.thumbnail, undefined);
    evidence.captionEdit = { before, after, rootBounds, savedList: current.list, thumbnailBefore, thumbnailAfter };
    await partPicker().selectOption('caption'); await assertPart('caption'); await screenshot('04-caption-hierarchy'); await returnRoot();
  });

  await check('部件搜索只显示部件位置或外观，不能重新露出根坐标', async () => {
    await select('qa_save'); await enterPart('caption'); await openGroup('part-layout', false); await openGroup('part-appearance', false);
    const original = await save(), before = await groupState();
    await search().fill('字体'); await expect(group('part-appearance')).toBeVisible(); await expect(field('对白摘要字体')).toBeVisible(); await expect(group('part-layout')).toBeHidden();
    await clearSearch(); assert.deepEqual(await groupState(), before);
    await search().fill('横向'); await expect(group('part-layout')).toBeVisible(); await expect(field('对白摘要横向 %')).toBeVisible(); await expect(group('part-appearance')).toBeHidden();
    await clearSearch(); assert.deepEqual(await groupState(), before);
    await search().fill('控件不透明度'); await expect(opacity()).toHaveCount(0); await expect(field('横向位置 %')).toHaveCount(0);
    await clearSearch(); await assertUnchanged(original); await returnRoot();
  });

  await check('部件画布保护整个控件，输入编辑及返回后的根操作仍可用', async () => {
    // Seed the editor's own object clipboard through its real root operation.
    // A blocked paste is meaningful even when no earlier test copied an object.
    await select('qa_save_peer'); await canvasArea().focus(); await canvasArea().press('Control+c');
    await select('qa_save'); await enterPart('caption'); await openGroup('part-appearance');
    const original = await save(), rootValue = component(original, 'qa_save');
    await expect(page!.locator('.ui-canvas')).toHaveAttribute('data-ui-editing-part', 'caption');
    await expect(page!.locator('.ui-canvas [data-transform-id]')).toHaveCount(0);
    await expect(page!.getByLabel('控件布局工具栏', { exact: true })).toHaveCount(0);
    await expect(page!.getByRole('toolbar', { name: '部件编辑工具', exact: true })).toBeVisible();
    const blockedKeys = ['Delete', 'Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Shift+ArrowRight', 'Control+c', 'Control+x', 'Control+v', 'Control+d'];
    for (const key of blockedKeys) {
      await canvasArea().focus(); await expect(canvasArea()).toBeFocused(); await page!.keyboard.press(key); await settle();
      await assertPart('caption'); await expect(canvas('qa_save')).toHaveCount(1); await assertUnchanged(original);
    }

    const thumbnail = canvas('qa_save').locator('[data-collection-part="thumbnail"]').first();
    await thumbnail.scrollIntoViewIfNeeded(); await settle();
    const thumbnailBox = await thumbnail.boundingBox(), beforeDrag = await canvas('qa_save').getAttribute('style');
    assert.ok(thumbnailBox && thumbnailBox.width > 0 && thumbnailBox.height > 0);
    const dragX = thumbnailBox.x + thumbnailBox.width * .4, dragY = thumbnailBox.y + thumbnailBox.height * .4;
    await page!.mouse.move(dragX, dragY); await page!.mouse.down(); await page!.mouse.move(dragX + 38, dragY + 22, { steps: 8 }); await page!.mouse.up(); await settle();
    await assertPart('caption'); assert.equal(await canvas('qa_save').getAttribute('style'), beforeDrag);
    await assertUnchanged(original);

    // Native number editing remains available inside the part. Delete creates
    // an unfinished draft; Escape cancels that field rather than leaving scope.
    await field('对白摘要字号').focus(); await field('对白摘要字号').press('Control+a'); await field('对白摘要字号').press('Delete');
    await expect(field('对白摘要字号')).toHaveValue(''); await assertPart('caption');
    await field('对白摘要字号').press('Escape'); await expect(field('对白摘要字号')).toHaveValue('31'); await assertPart('caption');
    await field('对白摘要字号').press('ArrowUp'); await field('对白摘要字号').press('Tab');
    await expect(field('对白摘要字号')).toHaveValue('32');
    await undo(); await expect(field('对白摘要字号')).toHaveValue('31'); await assertUnchanged(original);
    await redo(); await expect(field('对白摘要字号')).toHaveValue('32');
    const edited = await save(), expected = structuredClone(original);
    component(expected, 'qa_save').list!.textStyles!.caption!.fontSize = 32;
    assert.deepEqual(edited.ui, expected.ui, 'Native part editing must change only the caption font size.');
    // Saving accepts the UI draft and clears its undo stack. Restore through
    // the same field after the undo/redo behavior has been verified above.
    await number('对白摘要字号', '31'); assert.deepEqual((await save()).ui, original.ui);

    await canvasArea().focus(); await page!.keyboard.press('Escape'); await settle(); await assertRoot();
    assert.equal(await page!.locator('.ui-canvas').getAttribute('data-ui-editing-part'), null);
    await expect(page!.locator('.ui-canvas [data-transform-id="qa_save"]')).toHaveCount(1);
    await expect(page!.getByLabel('控件布局工具栏', { exact: true })).toBeVisible();
    const rootBeforeNudge = await canvas('qa_save').boundingBox();
    await canvasArea().focus(); await page!.keyboard.press('ArrowRight'); await settle();
    await undo(); assert.deepEqual(await canvas('qa_save').boundingBox(), rootBeforeNudge); await assertUnchanged(original); await redo();
    const nudged = await save(), nudgedRoot = component(nudged, 'qa_save');
    assert.ok(Math.abs((nudgedRoot.x - rootValue.x) * original.width - 1) < .0001, 'Returning to the root restores a one-game-pixel nudge.');
    assert.deepEqual({ ...nudgedRoot, x: rootValue.x }, rootValue);
    await canvasArea().focus(); await page!.keyboard.press('ArrowLeft'); await settle(); assert.deepEqual((await save()).ui, original.ui);

    // Part-mode Ctrl+C must not replace the earlier root clipboard. A root
    // paste after returning therefore creates the small peer. Undo/redo happen
    // before saving; the saved copy is then removed through the root Delete key.
    await canvasArea().focus(); await page!.keyboard.press('Control+v'); await settle();
    await expect(page!.locator('.ui-canvas [data-component-id]')).toHaveCount(3);
    await undo(); await expect(page!.locator('.ui-canvas [data-component-id]')).toHaveCount(2); await assertUnchanged(original);
    await redo(); await expect(page!.locator('.ui-canvas [data-component-id]')).toHaveCount(3);
    const pasted = await save(), added = pasted.ui.components.filter(item => !original.ui.components.some(before => before.id === item.id));
    assert.equal(added.length, 1); const copiedPeer = component(original, 'qa_save_peer');
    assert.equal(added[0].kind, copiedPeer.kind); assert.equal(added[0].width, copiedPeer.width); assert.equal(added[0].height, copiedPeer.height);
    assert.ok(Math.abs(added[0].x - copiedPeer.x - .02) < .000001); assert.ok(Math.abs(added[0].y - copiedPeer.y - .02) < .000001);
    assert.deepEqual(added[0].list, copiedPeer.list);
    await page!.locator(`[data-hierarchy-id="${added[0].id}"]`).click(); await canvasArea().focus(); await page!.keyboard.press('Delete'); await settle();
    assert.deepEqual((await save()).ui, original.ui);

    await select('qa_save'); await enterPart('caption'); await page!.getByRole('button', { name: '画布返回整个控件', exact: true }).click(); await settle(); await assertRoot();
    await enterPart('caption'); await page!.locator('[data-hierarchy-id="qa_save"]').click(); await settle(); await assertRoot();
    await enterPart('caption');
    const peer = canvas('qa_save_peer'); await peer.scrollIntoViewIfNeeded(); const peerBox = await peer.boundingBox(); assert.ok(peerBox);
    const peerX = peerBox.x + peerBox.width * .5, peerY = peerBox.y + peerBox.height * .5;
    await page!.mouse.move(peerX, peerY); await page!.mouse.down(); await page!.mouse.move(peerX + 15, peerY + 8, { steps: 5 }); await page!.mouse.up(); await settle();
    await assertRoot(); await expect(page!.locator('[data-hierarchy-id="qa_save_peer"]')).toHaveAttribute('aria-selected', 'true'); await assertUnchanged(original);
    await select('qa_save');
    await enterPart('caption'); await page!.locator('[data-hierarchy-id="qa_save_peer"]').click({ modifiers: ['Control'] }); await settle();
    await expect(page!.locator('[data-hierarchy-id="qa_save"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page!.locator('[data-hierarchy-id="qa_save_peer"]')).toHaveAttribute('aria-selected', 'true');
    await expect(shell()).not.toHaveAttribute('data-ui-inspector-part');
    await expect(page!.locator('.ui-canvas')).not.toHaveAttribute('data-ui-editing-part');
    await expect(page!.locator('.ui-primary-selection-note')).toContainText('共同属性 · 2 项');
    await expect(page!.getByLabel('控件布局工具栏', { exact: true })).toBeVisible();
    await expect(page!.getByRole('group', { name: '等距分布', exact: true })).toBeVisible();
    const emptyCanvas = await page!.locator('.ui-canvas').boundingBox(); assert.ok(emptyCanvas);
    await page!.mouse.click(emptyCanvas.x + 3, emptyCanvas.y + emptyCanvas.height - 3); await settle();
    await expect(page!.locator('[data-hierarchy-id][aria-selected="true"]')).toHaveCount(0);
    assert.equal(await page!.locator('.ui-canvas').getAttribute('data-ui-editing-part'), null);
    await select('qa_save'); await assertUnchanged(original);
    evidence.partCanvasProtection = { blockedKeys, rootDragUnchanged: true, nativeInputAndUndo: true, returnedNudgePixels: 1, clipboardPreserved: true, toolbarAndHierarchyReturn: true, otherObjectSelectWithoutDrag: true, modifierSelection: true, emptyCanvasClearsSelection: true };
    await screenshot('05-part-canvas-protection');
  });

  await check('历史部件按布局和外观分开，滚动条恢复保留原数据', async () => {
    await select('qa_history'); await openGroup('collection-layout');
    await expect(field('每页行数')).toHaveCount(0); await expect(field('姓名列宽度')).toHaveCount(0);
    await doubleClickPart('qa_history', 'historyName'); await openGroup('part-layout'); await openGroup('part-appearance');
    await expect(region('common').getByLabel('姓名列宽度', { exact: true })).toBeVisible();
    await expect(region('function').getByLabel('姓名列宽度', { exact: true })).toHaveCount(0); await expect(field('姓名字号')).toHaveValue('25');
    await openGroup('part-layout', false); await search().fill('姓名字号'); await expect(group('part-layout')).toBeHidden();
    await shell().getByRole('button', { name: '返回整个控件', exact: true }).click(); await assertRoot();
    await openGroup('collection-layout'); await view().getByRole('button', { name: '编辑姓名列宽度', exact: true }).click(); await assertPart('historyName');
    await expect(search()).toHaveValue(''); await expect(group('part-layout')).toHaveJSProperty('open', true); await expect(field('姓名列宽度')).toBeVisible();
    await partPicker().selectOption('historyScrollbar'); await assertPart('historyScrollbar'); await openGroup('part-layout'); await openGroup('part-appearance');
    const before = component(await save(), 'qa_history');
    await expect(region('common').getByLabel('历史滚动条样式', { exact: true })).toHaveValue('default');
    await expect(region('function').getByLabel('历史滚动条样式', { exact: true })).toHaveCount(0);
    await field('历史滚动条样式').selectOption('custom');
    await expect(field('自定义滚动条位置')).toHaveCount(0);
    await expect(region('common').getByLabel('滚动条横向 %', { exact: true })).toBeVisible();
    await expect(region('function').getByRole('combobox', { name: '历史滑块图片', exact: true })).toBeVisible();
    await expect(canvas('qa_history').locator('[data-history-viewport]')).toHaveCSS('scrollbar-width', 'none');
    await field('历史滚动条样式').selectOption('default'); await expect(field('历史滚动条样式')).toHaveValue('default');
    await expect(canvas('qa_history').locator('[data-history-viewport]')).not.toHaveCSS('scrollbar-width', 'none');
    await undo(); await expect(field('历史滚动条样式')).toHaveValue('custom'); await redo();
    assert.deepEqual(component(await save(), 'qa_history'), before);
    await screenshot('05-history-scrollbar-hierarchy'); await returnRoot();
  });

  await check('真实双击自动档和普通档进入对应读写外观，修饰键保留选层', async () => {
    await select('qa_save'); await setUiCanvasPreview(page!, '存档预览内容', 'filled');
    const original = await save(), actions = canvas('qa_save').locator('[data-collection-part="slotAction"]');
    await expect(actions.first()).toHaveAttribute('data-collection-action-mode', 'load'); await expect(actions.nth(1)).toHaveAttribute('data-collection-action-mode', 'save');
    await doubleClickPart('qa_save', 'slotAction'); await openGroup('part-appearance');
    await expect(region('function').getByRole('combobox', { name: '读取按钮底图', exact: true })).toBeVisible();
    await returnRoot(); await doubleClickPart('qa_save', 'slotAction', 1); await openGroup('part-appearance');
    await expect(region('function').getByRole('combobox', { name: '保存按钮底图', exact: true })).toBeVisible();
    await returnRoot(); await doubleClickPart('qa_save', 'caption', 0, ['Shift']);
    assert.equal(await shell().getAttribute('data-ui-inspector-part'), null, 'Shift double-click must retain layer-selection behavior without entering a list part.');
    await expect(shell().getByRole('button', { name: '返回整个控件', exact: true })).toHaveCount(0);
    await select('qa_save'); await assertRoot(); await assertUnchanged(original); evidence.saveActions = { auto: 'load', regular: 'save', modifierKeptRoot: true };
  });

  await check('切换控件、页面和同 ID 的其他工程不沿用部件作用域', async () => {
    await select('qa_save'); await enterPart('caption'); await select('qa_save_peer'); await assertRoot();
    await select('qa_save'); await assertRoot(); await enterPart('caption');
    await select('qa_image'); await assertRoot(); await select('qa_save'); await assertRoot();
    await enterPart('caption'); const before = await save();
    await openProject(secondary); await select('qa_save'); await assertRoot();
    const otherBefore = await save(); await enterPart('caption'); await openGroup('part-appearance');
    await expect(field('对白摘要字号')).toHaveValue('37'); await expect(breadcrumbs()).toContainText('另一个工程的存档列表');
    await openProject(primary); await select('qa_save'); await assertRoot();
    await enterPart('caption'); await openGroup('part-appearance'); await expect(field('对白摘要字号')).toHaveValue('31');
    await expect(breadcrumbs()).not.toContainText('另一个工程');
    assert.deepEqual((await read(secondary)).ui, otherBefore.ui); await assertUnchanged(before); await returnRoot();
    evidence.scopeIsolation = { samePagePeer: true, pageSwitch: true, sameIdOtherProject: true };
  });

  await check('制作人员名单支持真实多行、空白与撤销，保存内容不裁剪', async () => {
    await select('qa_staff'); await openGroup('content');
    await expect(functionTitle()).toHaveText('制作人员名单');
    const before = component(await save(), 'qa_staff').text, next = '  制作人员  \n\n策划：甲\n程序：乙\n\n  谢谢游玩  \n';
    await field('名单文字').fill(next); await field('名单文字').press('Tab');
    await expect(field('名单文字')).toHaveValue(next);
    await undo(); await expect(field('名单文字')).toHaveValue(before ?? ''); await redo();
    assert.equal(component(await save(), 'qa_staff').text, next); evidence.staffText = next;
  });

  await check('名称和普通属性同行，窄栏与复杂字段保留宽度，帮助与恢复不遮挡', async () => {
    await panelWidth(360); await select('qa_button_a'); await clearSearch();
    await openGroup('layout', false); await openGroup('content'); await openGroup('visibility');
    await openGroup('appearance'); await openGroup('appearance-text'); await openGroup('appearance-frame');
    const original = await save(), layouts: unknown[] = [];
    const name = shell().getByLabel('控件显示名称', { exact: true });
    layouts.push({ name: '控件名称', width: 360, geometry: await fieldArrangement(name, true) });
    for (const label of ['文字', '字号', '外观预览状态', '控件不透明度 %']) layouts.push({ name: label, width: 360, geometry: await fieldArrangement(field(label), true) });
    layouts.push({ name: '边框宽度', width: 360, geometry: await fieldArrangement(field('边框宽度'), false) });
    const namedBefore = component(original, 'qa_button_a').name!;
    await name.locator('..').locator('.field-label').click(); await expect(name).toBeFocused();
    await name.fill(namedBefore + ' · 同行编辑'); await name.press('Tab');
    await expect(name).toHaveValue(namedBefore + ' · 同行编辑');
    await undo(); await expect(name).toHaveValue(namedBefore); await redo();
    assert.equal(component(await save(), 'qa_button_a').name, namedBefore + ' · 同行编辑');
    await name.fill(namedBefore); await name.press('Tab'); await save();

    const opacityField = opacity().locator('..').locator('..');
    const summary = opacityField.locator(':scope > .field-help > summary');
    await summary.click(); await expect(opacityField.locator('.field-help')).toHaveJSProperty('open', true);
    await expect(opacityField.locator('.field-help > small')).toBeVisible();
    layouts.push({ name: '不透明度展开说明', width: 360, geometry: await fieldArrangement(opacity(), true) });
    const reset = region('common').getByRole('button', { name: '恢复控件不透明度 %', exact: true });
    await opacity().scrollIntoViewIfNeeded();
    const resetBox = await reset.boundingBox(), inputBox = await opacity().boundingBox(); assert.ok(resetBox && inputBox);
    assert.ok(Math.abs(resetBox.y + resetBox.height / 2 - inputBox.y - inputBox.height / 2) < 7, 'Reset should align with the input, not expanded help.');
    const beforeValue = await opacity().inputValue(); await reset.click(); await expect(opacity()).toHaveValue('100');
    await undo(); await expect(opacity()).toHaveValue(beforeValue); await summary.click();
    await expect(opacityField.locator('.field-help')).toHaveJSProperty('open', false);
    // NumberInput's label drag remains active after switching to inline layout.
    const fontInput = field('字号'), fontBefore = Number(await fontInput.inputValue()), dragLabel = fontInput.locator('..').locator('.field-label');
    await dragLabel.scrollIntoViewIfNeeded(); const drag = await dragLabel.boundingBox(); assert.ok(drag);
    const x = drag.x + drag.width / 2, y = drag.y + drag.height / 2;
    await page!.mouse.move(x, y); await page!.mouse.down(); await page!.mouse.move(x + 20, y, { steps: 5 }); await page!.mouse.up(); await settle();
    assert.ok(Number(await fontInput.inputValue()) > fontBefore, 'Dragging the label must still update the numeric value.');
    await undo(); await expect(fontInput).toHaveValue(String(fontBefore)); assert.deepEqual((await save()).ui, original.ui);
    await name.scrollIntoViewIfNeeded(); await screenshot('09-inline-360-button');
    await panelWidth(220);
    layouts.push({ name: '控件名称', width: 220, geometry: await fieldArrangement(name, true) });
    layouts.push({ name: '控件不透明度 %', width: 220, geometry: await fieldArrangement(opacity(), false) });
    await assertFits(); await name.scrollIntoViewIfNeeded(); await screenshot('09-inline-220-button');
    await panelWidth(360); await select('qa_image'); await openGroup('content');
    const assetField = view().locator('.field').filter({ has: page!.getByLabel('图片素材', { exact: true }) });
    await expect(assetField).not.toHaveClass(/field-simple/);
    layouts.push({ name: '图片素材', width: 360, geometry: await fieldArrangement(field('图片素材'), false) });
    await select('qa_staff'); await openGroup('content');
    layouts.push({ name: '名单文字', width: 360, geometry: await fieldArrangement(field('名单文字'), false) });
    await expect(field('名单文字')).toHaveValue(String(evidence.staffText));
    await screenshot('09-multiline-staff'); await assertUnchanged(original);
    evidence.inlineFields = { layouts, nameEditAndUndo: true, numericLabelDragAndUndo: true, helpAndReset: true };
  });

  await check('开关在四种主题和自定义明暗配色中清晰可辨，点击与空格保存正确状态', async () => {
    await select('qa_button_b'); await clearSearch(); await openGroup('interaction');
    const original = await save(), samples: unknown[] = [];
    const scenarios: { id: string; name: string; colors?: Record<string, string> }[] = [
      { id: 'codexDark', name: '黑白' }, { id: 'codexLight', name: '亮白' },
      { id: 'ue5', name: '石墨' }, { id: 'studio', name: '蓝灰' },
      { id: 'custom-light', name: '自定义', colors: { '重点色': '#fdfdfd', '按钮与悬浮层': '#fafafa', '文字': '#fefefe' } },
      { id: 'custom-dark', name: '自定义', colors: { '重点色': '#121212', '按钮与悬浮层': '#191919', '文字': '#111111' } },
    ];
    for (const scenario of scenarios) {
      await page!.getByRole('button', { name: '作品设置', exact: true }).click();
      await page!.getByRole('button', { name: '编辑器外观', exact: true }).click();
      await page!.getByRole('group', { name: '编辑器配色', exact: true }).getByRole('button', { name: new RegExp('^' + scenario.name) }).click();
      for (const [label, value] of Object.entries(scenario.colors ?? {})) await page!.getByLabel('自定义' + label, { exact: true }).fill(value);
      await page!.getByRole('button', { name: '关闭作品设置', exact: true }).click(); await settle();
      const input = field('允许玩家操作'); await expect(input).toBeChecked();
      // Click the visible label, then use the keyboard. No forced DOM events.
      await input.locator('..').locator('.field-label').click(); await expect(input).not.toBeChecked();
      const off = await switchAppearance('08-switch-' + scenario.id + '-off');
      assert.equal(component(await save(), 'qa_button_b').disabled, true);
      await input.press('Space'); await expect(input).toBeChecked();
      await expect(input).toBeFocused(); await expect(input).toHaveCSS('outline-style', 'solid');
      const focus = await input.evaluate(element => ({ visible: element.matches(':focus-visible'), width: parseFloat(getComputedStyle(element).outlineWidth), devicePixelRatio: window.devicePixelRatio }));
      assert.equal(focus.visible, true);
      // Chromium rounds painted strokes at fractional Windows scaling. Verify
      // a visible physical stroke rather than requiring exactly 2 CSS pixels.
      assert.ok(focus.width * focus.devicePixelRatio >= 1, 'Keyboard focus must remain visible: ' + JSON.stringify(focus));
      const on = await switchAppearance('08-switch-' + scenario.id + '-on');
      assert.deepEqual((await save()).ui, original.ui, 'Switching back must restore the saved state without touching other controls.');
      samples.push({ theme: scenario.id, off, on, focus });
    }
    evidence.switchAppearance = { samples, clickAndKeyboard: true, savedState: true };
  });

  await check('六类控件及部件在明暗主题220、280、360像素栏均可操作', async () => {
    const layouts: unknown[] = [];
    for (const theme of ['黑白', '亮白']) {
      await page!.getByRole('button', { name: '作品设置', exact: true }).click();
      await page!.getByRole('button', { name: '编辑器外观', exact: true }).click();
      await page!.getByRole('group', { name: '编辑器配色', exact: true }).getByRole('button', { name: new RegExp('^' + theme) }).click();
      await page!.getByRole('button', { name: '关闭作品设置', exact: true }).click();
      for (const width of [220, 280, 360]) {
        await panelWidth(width);
        for (const id of ['qa_button_a', 'qa_image', 'qa_slider', 'qa_save', 'qa_history', 'qa_flow']) {
          await select(id); await assertRoot(); await clearSearch(); await openGroup('layout'); await openGroup('visibility');
          if (id === 'qa_flow') await openGroup('flow-style');
          else { await openGroup('appearance'); if (id === 'qa_button_a') await openGroup('appearance-text'); }
          if (id === 'qa_slider') { await openGroup('content'); await openGroup('control-range'); await openGroup('control-slider-size'); }
          if (id === 'qa_save' || id === 'qa_history') await openGroup('collection-layout');
          layouts.push({ theme, requestedWidth: width, id, scope: 'root', order: await assertOrdered(), layout: await assertFits(), contrast: await textContrast() });
          if (id === 'qa_flow') {
            await view().getByRole('button', { name: /^本图基础外观/ }).click();
            await expect(shell()).toHaveAttribute('data-ui-flow-view', 'base');
            const retained = shell().locator('[data-ui-inspector-view="component"]');
            await expect(retained).toBeHidden(); await expect(retained).toHaveJSProperty('inert', true);
            await expect(view().locator('[data-ui-inspector-region="common"]')).toHaveCount(0);
            await openGroup('flow-base-caption-parts'); await openGroup('flow-base-text-effects');
            layouts.push({ theme, requestedWidth: width, id, scope: 'base', layout: await assertFits(), contrast: await textContrast() });
            await screenshot(`06-${theme === '亮白' ? 'light' : 'dark'}-${width}-${id}-base`);
            await shell().getByRole('button', { name: '返回整张图设置', exact: true }).click(); await assertRoot();
          }
          if (id === 'qa_save' || id === 'qa_history') {
            await enterPart(id === 'qa_save' ? 'caption' : 'historyText'); await openGroup('part-layout'); await openGroup('part-appearance');
            layouts.push({ theme, requestedWidth: width, id, scope: await shell().getAttribute('data-ui-inspector-part'), order: await assertOrdered(), layout: await assertFits(), contrast: await textContrast() });
            await screenshot(`06-${theme === '亮白' ? 'light' : 'dark'}-${width}-${id}`); await returnRoot();
          }
        }
      }
    }
    assert.equal(layouts.length, 54); evidence.responsive = layouts;
  });

  await check('保存重开保留部件数据、字体、透明度和多行名单，开始于根层级', async () => {
    await select('qa_save'); await enterPart('caption'); const before = await save();
    await close(); await launch();
    const after = await read(); assert.deepEqual(after.ui, before.ui); assert.deepEqual(after.variables, before.variables);
    await select('qa_save'); await assertRoot(); await enterPart('caption'); await openGroup('part-layout'); await openGroup('part-appearance');
    await expect(field('对白摘要字号')).toHaveValue('31'); await expect(field('对白摘要横向 %')).toHaveValue('11'); await returnRoot();
    await select('qa_button_a'); await openGroup('visibility'); await openGroup('appearance'); await openGroup('appearance-text');
    await expect(opacity()).toHaveValue('41'); await expect(field('字体')).toHaveValue(fontName); await expect(field('字号')).toHaveValue('32');
    await select('qa_image'); await openGroup('content'); await expect(field('图片缩放')).toHaveValue('cover');
    await select('qa_staff'); await openGroup('content'); await expect(field('名单文字')).toHaveValue(String(evidence.staffText));
    await expect(canvas('qa_staff')).toContainText('策划：甲');
    await screenshot('07-reopened-staff'); evidence.finalUiSha256 = sha256(JSON.stringify(after.ui));
  });

  assert.equal(checks.length, 19); assert.deepEqual(errors, [], 'Renderer must not raise runtime errors.'); report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = String(error);
  if (app && page && !page.isClosed()) await screenshot('failure').catch(capture => { report.captureError = String(capture); });
} finally {
  try { await close(); } catch (error) { report.status = 'failed'; report.closeError = String(error); failure ??= error; }
  try {
    const after = sha256(await fs.readFile(sourceFile)); report.sourceSha256After = after;
    if (sourceHash !== undefined) assert.equal(after, sourceHash, 'Author project was changed by isolated acceptance.');
  } catch (error) { report.status = 'failed'; report.sourceProtectionError = String(error); failure ??= error; }
  try {
    if (app || processes.some(record => !record.exited)) throw new Error('Owned fixture process remains alive; retain its directories.');
    report.cleanup = await cleanVerificationDirectories(output, ['project', 'other-project', 'profile']);
    assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []);
  } catch (error) { report.status = 'failed'; report.cleanupError = String(error); failure ??= error; }
  await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(output);
}
if (failure) throw failure;
