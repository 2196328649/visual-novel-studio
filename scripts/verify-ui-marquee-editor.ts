import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Run only after the complete implementation has been built. This fixture never
// starts Vite, opens the author's work for editing, or changes installed binaries.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Use the isolated compiled development editor.');
const root = path.resolve('.');
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/editor-refinements-2026-11-10', 'canvas-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const profile = path.join(output, 'profile');
const projectFile = path.join(output, 'project/project.vns.json');
const sourceFile = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? '../我的视觉小说1/project.vns.json');
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const component = (id: string, patch: Partial<UiComponent> = {}): UiComponent => ({
  id, name: id, text: id, kind: 'button', page: 'main', x: .12, y: .18, width: .12, height: .12,
  style: { background: '#375d69', textColor: '#f5f7f7', fontSize: 24 }, ...patch,
});
const custom = (id: string, patch: Partial<UiComponent> = {}) => component(id, { page: 'custom', ...patch });
const project = createProject('界面完整框选验收');
project.id = 'ui_marquee_acceptance'; project.width = 1280; project.height = 720;
project.resourceSettings = { importMode: 'copy', directory: 'assets', syncFolders: false };
project.ui.pages = { main: { layout: 'custom' }, choice: { layout: 'custom' }, flowchart: { layout: 'custom' } };
for (const node of project.nodes) node.flowchart = { visible: true };
project.variables = [
  { id: 'marquee_x', name: '实际横向位置', type: 'number', initial: .52, persistent: false },
  { id: 'marquee_hidden', name: '由参数隐藏', type: 'boolean', initial: false, persistent: false },
  { id: 'marquee_text', name: '输入内容', type: 'string', initial: '输入框样例', persistent: false },
];
project.ui.components = [
  component('a'), component('b', { x: .37, y: .2, width: .14, height: .1 }),
  component('c', { x: .74, y: .6, height: .13 }),
  component('choices', { page: 'choice', kind: 'choiceList', name: '选项列表', x: .2, y: .2, width: .6, height: .4, list: { itemHeight: 90 } }),
  component('choice_peer', { page: 'choice', x: .05, y: .76, width: .16, height: .1 }),
  component('flow', { page: 'flowchart', kind: 'flowchart', x: .1, y: .1, width: .5, height: .65,
    list: { layout: 'flow', flowShowControls: true, flowPositions: Object.fromEntries(project.nodes.map((node, index) => [node.id, { x: 70 + index * 700, y: 60 }])) } }),
];
project.ui.instances = [{ id: 'marquee_scheme', name: '同页替代方案', components: [component('a', { x: .3 })] }];
project.ui.customPages = [
  { id: 'marquee_restrictions', name: '可选范围与裁切', modal: true, components: [
    custom('unlocked', { x: .1, y: .12 }),
    custom('locked_parent', { kind: 'panel', x: .3, y: .12, width: .23, height: .25, editor: { locked: true } }),
    custom('locked_child', { parentId: 'locked_parent', x: .1, y: .1, width: .3, height: .4 }),
    custom('hidden', { x: .55, y: .12, editor: { hidden: true } }),
    custom('hidden_parent', { kind: 'panel', x: .7, y: .12, width: .2, height: .2, editor: { hidden: true } }),
    custom('hidden_child', { parentId: 'hidden_parent', x: .1, y: .1, width: .5, height: .5 }),
    custom('parameter_hidden', { x: .1, y: .62, propertyControls: { visible: { mode: 'follow', parameterId: 'marquee_hidden' } } }),
    custom('clip_parent', { kind: 'panel', x: .48, y: .45, width: .22, height: .28, layout: { version: 1, clip: true } }),
    custom('clip_inside', { parentId: 'clip_parent', x: .1, y: .1, width: .3, height: .25 }),
    custom('clip_partial', { parentId: 'clip_parent', x: .8, y: .5, width: .6, height: .2 }),
    custom('clip_outside', { parentId: 'clip_parent', x: 1.4, y: .1, width: .2, height: .2 }),
    custom('outside_canvas', { x: -.02, y: .1, width: .007, height: .1 }),
  ] },
  { id: 'marquee_affine', name: '旋转镜像父子', modal: true, components: [
    custom('affine_parent', { kind: 'panel', x: .26, y: .18, width: .3, height: .45, layout: { version: 1, rotation: 22, scaleX: 1.1, scaleY: .85, paddingLeft: 10, paddingTop: 10 } }),
    custom('affine_child', { parentId: 'affine_parent', x: .15, y: .2, width: .3, height: .25 }),
    custom('mirrored', { x: .82, y: .62, width: .14, height: .13, layout: { version: 1, rotation: -18, scaleX: -1, scaleY: .85 } }),
  ] },
  { id: 'marquee_snapshot', name: '参数控制的绘制位置', modal: true, components: [
    custom('linked', { x: .06, y: .18, width: .12, height: .1, propertyControls: { x: { mode: 'follow', parameterId: 'marquee_x' } } }),
    custom('snapshot_peer', { x: .76, y: .65 }),
  ] },
  { id: 'marquee_overlap', name: '重叠控件轮选', modal: true, components: [
    custom('under', { x: .3, y: .3, width: .25, height: .2 }),
    custom('over', { x: .3, y: .3, width: .25, height: .2, style: { background: '#834e3f' } }),
  ] },
  { id: 'marquee_frame', name: '框架内起拖与输入控件', modal: true, components: [
    custom('frame', { kind: 'panel', x: .08, y: .08, width: .82, height: .8 }),
    custom('frame_child', { parentId: 'frame', x: .08, y: .1, width: .16, height: .12 }),
    custom('frame_peer', { parentId: 'frame', x: .43, y: .4, width: .18, height: .12 }),
    custom('frame_input', { kind: 'preference', parameterId: 'marquee_text', text: '输入内容', parentId: 'frame', x: .68, y: .68, width: .22, height: .12 }),
  ] },
  { id: 'marquee_background', name: '承托背景与普通相邻控件', modal: true, components: [
    custom('backdrop', { kind: 'panel', x: 0, y: 0, width: 1, height: 1 }),
    custom('small_image', { kind: 'image', x: .06, y: .06, width: .48, height: .48 }),
    custom('front', { x: .2, y: .2, width: .12, height: .1 }),
    custom('neighbor', { x: .7, y: .2, width: .12, height: .1 }),
  ] },
  { id: 'marquee_scroll', name: '滚动画布框选', modal: true, components: [
    custom('scroll_top', { x: .12, y: .06, width: .12, height: .08 }),
    custom('scroll_middle', { x: .12, y: .4, width: .12, height: .08 }),
    custom('scroll_bottom', { x: .12, y: .85, width: .12, height: .08 }),
    custom('scroll_right', { x: .8, y: .4, width: .1, height: .08 }),
  ] },
];

type Point = { x: number; y: number };
type Rect = Point & { width: number; height: number };
type Modifier = 'Shift' | 'Control' | 'Meta' | 'Alt';
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'setup', failure: unknown;
let sourceHash: string | undefined, originalBytes = '', activePointerId = 1;
const errors: string[] = [], checks: { name: string; durationMs: number }[] = [];
const processes: { pid?: number; exited: boolean }[] = [];
const evidence: Record<string, unknown> = {};
const report: Record<string, unknown> = { status: 'running', renderer: 'compiled', checks, errors, processes, evidence, sourceFile, temporaryPaths: [path.dirname(projectFile), profile] };
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const area = () => page!.getByLabel('界面设计画布', { exact: true });
const canvas = () => page!.locator('.ui-canvas');
const object = (id: string) => canvas().locator(`[data-component-id="${id}"]`);
const row = (id: string) => page!.locator(`[data-hierarchy-id="${id}"]`);
const marquee = () => page!.locator('[data-ui-marquee]');
const selected = () => canvas().locator('.ui-component.selected').evaluateAll(elements => elements.map(element => element.getAttribute('data-component-id')!).sort());
const primary = () => page!.locator('.ui-hierarchy-row[tabindex="0"]').getAttribute('data-hierarchy-id');
const settle = async () => page!.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
const box = async (target: Locator): Promise<Rect> => { const value = await target.boundingBox(); assert.ok(value && value.width && value.height, 'Expected a rendered non-empty rectangle.'); return value; };
const viewportBox = () => area().evaluate(element => {
  const surface = element as HTMLElement, rect = surface.getBoundingClientRect(), sx = rect.width / surface.offsetWidth, sy = rect.height / surface.offsetHeight;
  return { x: rect.x + surface.clientLeft * sx, y: rect.y + surface.clientTop * sy, width: surface.clientWidth * sx, height: surface.clientHeight * sy };
});
const expand = (rect: Rect, margin = 10): Rect => ({ x: rect.x - margin, y: rect.y - margin, width: rect.width + margin * 2, height: rect.height + margin * 2 });
const end = (rect: Rect): Point => ({ x: rect.x + rect.width, y: rect.y + rect.height });
const center = (rect: Rect): Point => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile });
  processes.push({ pid: app.process().pid, exited: false }); page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window.isMaximized()) window.unmaximize();
    window.setContentSize(1600, 1000); window.webContents.setBackgroundThrottling(false);
  });
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html'));
  report.rendererUrl = page.url();
  await page.evaluate('globalThis.__name = value => value');
  await page.evaluate(() => {
    document.addEventListener('pointerdown', event => { (window as unknown as { marqueePointerId: number }).marqueePointerId = event.pointerId; }, true);
  });
  await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '设计', exact: true }).click();
  await page.getByLabel('画面缩放比例', { exact: true }).selectOption('50'); await settle();
}
async function close() {
  if (!app) return;
  const owned = app, child = owned.process(), exited = () => child.exitCode !== null || child.signalCode !== null;
  try { await owned.close(); }
  finally {
    await expect.poll(exited, { timeout: 15000 }).toBe(true);
    const record = processes.find(item => item.pid === child.pid); if (record) record.exited = exited();
    if (exited()) { app = undefined; page = undefined; }
  }
}
async function screenshot(name: string) {
  await settle();
  const data = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(data, 'base64'));
}
async function check(name: string, work: () => Promise<void>) {
  phase = name; const started = Date.now(); await work();
  checks.push({ name, durationMs: Date.now() - started });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log('通过：' + name);
}
async function openPage(id: string) {
  await page!.getByLabel('设计页面', { exact: true }).selectOption(id);
  await expect(area()).toBeVisible(); await expect(marquee()).toHaveCount(0);
  await page!.getByLabel('画面缩放比例', { exact: true }).selectOption('50'); await settle();
}
async function gamePoint(x: number, y: number): Promise<Point> {
  const rect = await box(canvas()); return { x: rect.x + x / project.width * rect.width, y: rect.y + y / project.height * rect.height };
}
async function expectSelection(ids: string[], duringDrag = false) {
  await expect.poll(selected).toEqual([...ids].sort());
  if (!duringDrag) await expect(page!.locator('[data-ui-selection-count]')).toHaveAttribute('data-ui-selection-count', String(ids.length));
}
async function begin(from: Point, to: Point, modifiers: Modifier[] = []) {
  for (const modifier of modifiers) await page!.keyboard.down(modifier);
  await page!.mouse.move(from.x, from.y); await page!.mouse.down();
  activePointerId = await page!.evaluate(() => (window as unknown as { marqueePointerId: number }).marqueePointerId);
  await page!.mouse.move(to.x, to.y, { steps: 8 }); await settle();
}
async function finish(modifiers: Modifier[] = []) {
  try { await page!.mouse.up(); }
  finally { for (const modifier of [...modifiers].reverse()) await page!.keyboard.up(modifier); }
  await expect(marquee()).toHaveCount(0); await settle();
}
async function drag(from: Point, to: Point, modifiers: Modifier[] = []) { await begin(from, to, modifiers); await finish(modifiers); }
// mouse.click({clickCount: 2}) emits both clicks. Here the first has already been
// asserted, so send exactly the second native press/release of the same pair.
async function secondClick(point: Point) { await page!.mouse.move(point.x, point.y); await page!.mouse.down({ clickCount: 2 }); await page!.mouse.up({ clickCount: 2 }); }
async function selectPair() { await row('b').locator('.ui-hierarchy-caption').click(); await row('a').locator('.ui-hierarchy-caption').click({ modifiers: ['Control'] }); await expectSelection(['a', 'b']); assert.equal(await primary(), 'a'); }
async function clearSelection() { const point = await gamePoint(1210, 45); await page!.mouse.click(point.x, point.y); await expectSelection([]); }
async function unchanged() {
  await expect(button('保存界面')).toBeDisabled();
  assert.equal(await fs.readFile(projectFile, 'utf8'), originalBytes, 'Selection and viewport gestures must not write the project.');
}
async function designState() {
  return canvas().evaluate(element => {
    const surface = element.getBoundingClientRect(), sx = surface.width / 1280, sy = surface.height / 720;
    return [...element.querySelectorAll<HTMLElement>('[data-component-id]')].map(item => {
      const rect = item.getBoundingClientRect();
      return { id: item.dataset.componentId!, x: (rect.x - surface.x) / sx, y: (rect.y - surface.y) / sy, width: rect.width / sx, height: rect.height / sy };
    });
  });
}
function near(actual: number, expected: number, tolerance = 1.1) { assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`); }
async function expectDesignState(before: Awaited<ReturnType<typeof designState>>) {
  // DOM rectangles are floating-point CSS measurements. Recentring the canvas
  // after its tools change height can move the converted value by ~0.00006 game
  // pixels without changing any control. Keep a 0.001-game-pixel comparison,
  // preserve every ID/order/field, and leave project-byte checks exact.
  await expect(async () => {
    const after = await designState();
    assert.deepEqual(after.map(item => item.id), before.map(item => item.id));
    for (let index = 0; index < before.length; index++) {
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        assert.ok(Math.abs(after[index][key] - before[index][key]) <= .001,
          `${before[index].id}.${key}: ${after[index][key]} differs from ${before[index][key]} by more than 0.001 game pixels`);
      }
    }
  }).toPass({ timeout: 5000 });
}
async function expectDelta(before: Awaited<ReturnType<typeof designState>>, ids: string[], delta: Point) {
  await expect(async () => {
    const after = await designState();
    for (const previous of before) {
      const current = after.find(item => item.id === previous.id)!;
      near(current.x - previous.x, ids.includes(previous.id) ? delta.x : 0); near(current.y - previous.y, ids.includes(previous.id) ? delta.y : 0);
      near(current.width, previous.width, .1); near(current.height, previous.height, .1);
    }
  }).toPass({ timeout: 5000 });
}
async function undoTo(before: Awaited<ReturnType<typeof designState>>) {
  await button('撤销').click(); await expectDesignState(before); await unchanged();
}

try {
  await fs.mkdir(output, { recursive: true });
  sourceHash = sha256(await fs.readFile(sourceFile)); report.sourceSha256Before = sourceHash;
  await saveProject(projectFile, projectSchema.parse(project)); originalBytes = await fs.readFile(projectFile, 'utf8');
  report.fixtureSha256Before = sha256(originalBytes);
  await launch();

  await check('完整包含才选中：四个拖动方向、相交和穿过控件均不误选', async () => {
    const first = await gamePoint(100, 85), last = await gamePoint(700, 270);
    const corners: [Point, Point][] = [[first, last], [last, first], [{ x: first.x, y: last.y }, { x: last.x, y: first.y }], [{ x: last.x, y: first.y }, { x: first.x, y: last.y }]];
    for (const [from, to] of corners) {
      await drag(from, to); await expectSelection(['a', 'b']);
    }
    await begin(first, last); await expect(marquee()).toHaveCount(1); await expectSelection(['a', 'b'], true);
    await expect(canvas().locator('.ui-resize-handle')).toHaveCount(0); await expect(canvas().locator('.alignment-reference')).toHaveCount(0);
    await screenshot('01-complete-containment'); await finish();
    await drag(await gamePoint(100, 85), await gamePoint(260, 250)); await expectSelection([]);
    await drag(await gamePoint(210, 85), await gamePoint(240, 250)); await expectSelection([]);
    await drag(await gamePoint(100, 85), await gamePoint(330, 250)); await expectSelection(['a']);
    await unchanged(); evidence.directions = 4;
  });

  await check('画布外留白可以起拖，空白单击清除，轻微抖动不产生框选', async () => {
    const surface = await box(canvas()), view = await box(area());
    const from = { x: surface.x - 10, y: surface.y - 10 };
    assert.ok(from.x > view.x && from.y > view.y, 'Fixture must have real canvas padding to start from.');
    await drag(from, await gamePoint(700, 270)); await expectSelection(['a', 'b']);
    const blank = await gamePoint(1210, 45);
    await page!.mouse.move(blank.x, blank.y); await page!.mouse.down(); await page!.mouse.move(blank.x + 1, blank.y + 1);
    await expect(marquee()).toHaveCount(0); await finish(); await expectSelection([]);
    await row('a').locator('.ui-hierarchy-caption').click();
    await page!.mouse.click(blank.x, blank.y); await expectSelection([]); await unchanged();
  });

  await check('未选控件首次拖动用于框选，单击后下一次拖动才移动，修饰键单击不重复切换', async () => {
    await row('b').locator('.ui-hierarchy-caption').click();
    const before = await designState(), a = await box(object('a')), origin = { x: a.x + a.width / 2, y: a.y + 3 }, destination = await gamePoint(700, 270);
    await page!.mouse.move(origin.x, origin.y); await page!.mouse.down();
    await expectSelection(['b']); assert.equal(await primary(), 'b');
    await page!.mouse.move(destination.x, destination.y, { steps: 8 }); await expect(marquee()).toHaveCount(1);
    await expectDesignState(before); await expectSelection(['b'], true); assert.equal(await primary(), 'b');
    await finish(); await expectSelection(['b']); await expectDesignState(before); await unchanged();
    await page!.mouse.click(origin.x, origin.y); await expectSelection(['a']); await expectDesignState(before);
    assert.equal(await object('a').evaluate(element => getComputedStyle(element).cursor), 'move');
    assert.equal(await object('b').evaluate(element => getComputedStyle(element).cursor), 'default');
    if (await button('智能吸附').getAttribute('aria-pressed') === 'true') await button('智能吸附').click();
    const surface = await box(canvas()), selectedOrigin = center(await box(object('a')));
    await drag(selectedOrigin, { x: selectedOrigin.x + 32 * surface.width / project.width, y: selectedOrigin.y + 20 * surface.height / project.height });
    await expectDelta(before, ['a'], { x: 32, y: 20 }); await undoTo(before);
    const b = center(await box(object('b')));
    await page!.keyboard.down('Shift'); await page!.mouse.click(b.x, b.y); await page!.keyboard.up('Shift'); await expectSelection(['a', 'b']);
    await page!.keyboard.down('Control'); await page!.mouse.click(b.x, b.y); await page!.keyboard.up('Control'); await expectSelection(['a']);
    await page!.keyboard.down('Control'); await page!.mouse.click(b.x, b.y); await page!.keyboard.up('Control'); await expectSelection(['a', 'b']);
    await unchanged();
  });

  await check('未选大框内部与输入预览可起拖框选，已选父框不遮挡未选子对象', async () => {
    await openPage('marquee_frame'); await clearSelection(); const before = await designState();
    await begin(await gamePoint(120, 80), await gamePoint(1100, 620));
    await expect(marquee()).toHaveCount(1); await expectSelection(['frame_child', 'frame_peer', 'frame_input'], true);
    await expectDesignState(before); await screenshot('08-frame-interior-marquee'); await finish();
    await expectSelection(['frame_child', 'frame_peer', 'frame_input']); await unchanged();
    await row('frame').locator('.ui-hierarchy-caption').click(); await expectSelection(['frame']);
    const child = center(await box(object('frame_child')));
    await begin(child, await gamePoint(1100, 620)); await expect(marquee()).toHaveCount(1);
    await expectSelection(['frame_peer', 'frame_input'], true); await expectDesignState(before); assert.equal(await primary(), 'frame');
    await page!.keyboard.press('Escape'); await finish(); await expectSelection(['frame']); await expectDesignState(before);
    await page!.mouse.click(child.x, child.y); await expectSelection(['frame_child']); await expectDesignState(before);
    // Starting on the unselected parameter-input preview belongs to the canvas,
    // while typing in the actual inspector field keeps its normal text focus.
    const input = center(await box(object('frame_input')));
    await begin(input, await gamePoint(150, 90)); await expect(marquee()).toHaveCount(1); await expectDesignState(before);
    await finish(); await expectSelection(['frame_child', 'frame_peer']); await unchanged();
    await row('frame').locator('.ui-hierarchy-caption').click();
    const name = page!.getByLabel('控件显示名称', { exact: true });
    await name.fill('框架临时名称'); await name.press('Tab'); await expect(marquee()).toHaveCount(0);
    await expect(button('保存界面')).toBeEnabled(); await button('撤销').click(); await unchanged();
    await openPage('main');
  });

  await check('Shift追加、Ctrl切换基于起始选区，多次经过同一控件不会反复翻转', async () => {
    await row('c').locator('.ui-hierarchy-caption').click();
    const from = await gamePoint(100, 85), to = await gamePoint(700, 270);
    await drag(from, to, ['Shift']); await expectSelection(['a', 'b', 'c']);
    await row('a').locator('.ui-hierarchy-caption').click();
    await begin(from, to, ['Control']); await expectSelection(['b'], true);
    const retreat = await gamePoint(90, 75); await page!.mouse.move(retreat.x, retreat.y, { steps: 4 }); await expectSelection(['a'], true);
    await page!.mouse.move(to.x, to.y, { steps: 4 }); await expectSelection(['b'], true);
    await finish(['Control']); await expectSelection(['b']);
    const blank = await gamePoint(1210, 45);
    for (const modifier of ['Shift', 'Control'] as const) {
      await page!.keyboard.down(modifier); await page!.mouse.click(blank.x, blank.y); await page!.keyboard.up(modifier); await expectSelection(['b']);
    }
    await unchanged();
  });

  await check('Esc、失焦、pointercancel和捕获丢失保留原多选及主选对象', async () => {
    const cancellations = ['escape', 'blur', 'pointercancel', 'capture'] as const;
    for (const kind of cancellations) {
      await selectPair(); const from = await gamePoint(910, 390), to = await gamePoint(1150, 570);
      await begin(from, to); await expect(marquee()).toHaveCount(1); await expectSelection(['c'], true);
      await expect(page!.getByLabel('共同属性编辑', { exact: true }).locator('[data-ui-multi-count]')).toHaveAttribute('data-ui-multi-count', '2');
      assert.equal(await primary(), 'a', 'Dragging only previews the new group; the original primary and inspector selection must stay unchanged.');
      if (kind === 'escape') await page!.keyboard.press('Escape');
      else if (kind === 'blur') await page!.evaluate(() => window.dispatchEvent(new Event('blur')));
      else if (kind === 'pointercancel') await area().dispatchEvent('pointercancel', { pointerId: activePointerId, isPrimary: true });
      else {
        await area().evaluate((element, pointerId) => {
          if (!element.hasPointerCapture(pointerId)) throw new Error('Expected actual pointer capture before releasing it.');
          element.releasePointerCapture(pointerId);
        }, activePointerId);
        // Chromium processes pending capture changes before the next pointer event.
        await page!.mouse.move(to.x + 1, to.y + 1);
      }
      await expect(marquee()).toHaveCount(0); await expectSelection(['a', 'b']); assert.equal(await primary(), 'a');
      await page!.mouse.move(to.x + 12, to.y + 12); await finish(); await expectSelection(['a', 'b']); assert.equal(await primary(), 'a');
    }
    await unchanged(); evidence.cancellations = cancellations;
  });

  await check('切换页面、界面方案和事件图会结束框选，不把旧页选区带入新作用域', async () => {
    await selectPair(); await begin(await gamePoint(910, 390), await gamePoint(1150, 570));
    await page!.getByLabel('设计页面', { exact: true }).selectOption('marquee_affine');
    await expect(marquee()).toHaveCount(0); await finish(); await expectSelection([]);
    await openPage('main'); await selectPair(); await begin(await gamePoint(910, 390), await gamePoint(1150, 570));
    await page!.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '事件图', exact: true }).focus();
    await page!.keyboard.press('Enter'); await expect(area()).toHaveCount(0); await page!.mouse.up();
    await page!.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '设计', exact: true }).click();
    await expect(marquee()).toHaveCount(0); await expect.poll(selected).not.toContain('c');
    await clearSelection(); await selectPair();
    // Open the popover by keyboard after capture, so native light-dismiss does
    // not close it on the initial blank-canvas pointerdown.
    await begin(await gamePoint(910, 390), await gamePoint(1150, 570));
    await button('页面选项').focus(); await page!.keyboard.press('Enter');
    const menu = page!.getByRole('dialog', { name: '页面选项', exact: true });
    await expect(menu).toBeVisible();
    const schemeGroup = menu.locator('details').filter({ has: page!.locator(':scope > summary', { hasText: '界面方案' }) });
    if (await schemeGroup.getAttribute('open') === null) { await schemeGroup.locator(':scope > summary').focus(); await page!.keyboard.press('Enter'); }
    await menu.getByLabel('选择界面实例', { exact: true }).selectOption('marquee_scheme');
    await expect(marquee()).toHaveCount(0); await finish();
    if (await menu.isVisible()) await button('关闭页面选项').click();
    await expectSelection([]); await button('撤销').click(); await unchanged();
  });

  await check('锁定与隐藏会继承到子控件；裁切只影响可见性，不缩小完整框选范围', async () => {
    await openPage('marquee_restrictions');
    await expect(object('locked_child')).toHaveClass(/locked/);
    await expect(object('hidden')).toHaveCount(0); await expect(object('hidden_child')).toHaveCount(0); await expect(object('parameter_hidden')).toHaveCount(0);
    await expect(object('clip_outside')).toBeHidden();
    // The left margin fully covers this off-canvas object's logical frame, but
    // an object wholly clipped by the game canvas must remain unselectable.
    await drag(await gamePoint(-35, 25), await gamePoint(1250, 690));
    await expectSelection(['unlocked', 'clip_parent', 'clip_inside', 'clip_partial']);
    const frame = expand(await box(object('clip_parent')), 4);
    await drag({ x: frame.x, y: frame.y }, end(frame)); await expectSelection(['clip_parent', 'clip_inside']);
    await screenshot('02-clipped-frame-containment');
    const complete = expand(await box(object('clip_partial')), 8);
    // Begin outside the parent's clipped portion, where there is empty canvas.
    await drag(end(complete), { x: complete.x, y: complete.y }); await expectSelection(['clip_partial']);
    await unchanged();
  });

  await check('旋转、镜像与父级变换按实际外框选择，父子整组移动只偏移一次且一次撤销', async () => {
    await openPage('marquee_affine');
    const parent = expand(await box(object('affine_parent'))), mirror = expand(await box(object('mirrored')));
    await drag({ x: parent.x, y: parent.y }, end(parent)); await expectSelection(['affine_parent', 'affine_child']);
    await screenshot('03-affine-parent-and-child');
    if (await button('智能吸附').getAttribute('aria-pressed') === 'true') await button('智能吸附').click();
    const before = await designState(), surface = await box(canvas()), origin = center(await box(object('affine_child'))), delta = { x: 42, y: 27 };
    await begin(origin, { x: origin.x + delta.x * surface.width / project.width, y: origin.y + delta.y * surface.height / project.height });
    await expect(marquee()).toHaveCount(0); await finish();
    await expectDelta(before, ['affine_parent', 'affine_child'], delta); await undoTo(before);
    await drag({ x: mirror.x, y: mirror.y }, end(mirror)); await expectSelection(['mirrored']);
    const cut = { x: parent.x + parent.width * .45, y: parent.y };
    await drag(cut, end(parent)); await expect.poll(selected).not.toContain('affine_parent');
    await unchanged();
  });

  await check('参数控制的位置使用画布实际初值，原设计位置不会形成幽灵命中', async () => {
    await openPage('marquee_snapshot');
    const linked = await box(object('linked')), surface = await box(canvas());
    near((linked.x - surface.x) / surface.width, .52, .001);
    await drag(await gamePoint(50, 100), await gamePoint(260, 230)); await expectSelection([]);
    const frame = expand(linked); await drag({ x: frame.x, y: frame.y }, end(frame)); await expectSelection(['linked']);
    await unchanged();
  });

  await check('25%、50%、100%缩放后均完整命中，Ctrl滚轮中断旧框选并保留起始选择', async () => {
    await openPage('main');
    for (const zoom of ['25', '50', '100']) {
      await page!.getByLabel('画面缩放比例', { exact: true }).selectOption(zoom);
      await area().evaluate(element => { element.scrollLeft = 0; element.scrollTop = 0; }); await settle();
      await drag(await gamePoint(100, 85), await gamePoint(330, 250)); await expectSelection(['a']);
    }
    await page!.getByLabel('画面缩放比例', { exact: true }).selectOption('50'); await selectPair();
    await begin(await gamePoint(910, 390), await gamePoint(1150, 570)); await expectSelection(['c'], true);
    const beforeZoom = await box(canvas()); await page!.keyboard.down('Control'); await page!.mouse.wheel(0, -120); await page!.keyboard.up('Control');
    await expect(marquee()).toHaveCount(0); await expectSelection(['a', 'b']); assert.equal(await primary(), 'a');
    await expect.poll(async () => (await box(canvas())).width).toBeGreaterThan(beforeZoom.width);
    await finish(); await page!.getByLabel('画面缩放比例', { exact: true }).selectOption('50'); await unchanged();
  });

  await check('按住拖框滚动时锚点留在内容坐标，边缘自动滚动可选屏外控件', async () => {
    await openPage('marquee_scroll'); await page!.getByLabel('画面缩放比例', { exact: true }).selectOption('150');
    await area().evaluate(element => { element.scrollLeft = 0; element.scrollTop = 0; }); await settle();
    const view = await viewportBox(), to = { x: (await gamePoint(380, 0)).x, y: view.y + view.height - 65 };
    await begin(await gamePoint(30, 15), to); await expect(marquee()).toHaveCount(1);
    const beforeScroll = await area().evaluate(element => element.scrollTop); await page!.mouse.wheel(0, 360);
    await expect.poll(() => area().evaluate(element => element.scrollTop)).toBeGreaterThan(beforeScroll);
    await expect.poll(selected).toContain('scroll_top'); await expect.poll(selected).toContain('scroll_middle');
    await expect.poll(selected).not.toContain('scroll_right'); await screenshot('04-wheel-during-marquee');
    await finish();
    await area().evaluate(element => { element.scrollLeft = 0; element.scrollTop = 0; }); await settle();
    const scroller = await viewportBox(), edge = { x: (await gamePoint(380, 0)).x, y: scroller.y + scroller.height - 6 };
    await begin(await gamePoint(30, 15), edge);
    await expect.poll(selected, { timeout: 10000 }).toEqual(['scroll_bottom', 'scroll_middle', 'scroll_top']);
    await screenshot('05-edge-scroll-offscreen-controls'); await finish(); await expectSelection(['scroll_top', 'scroll_middle', 'scroll_bottom']);
    const finalScroll = await area().evaluate(element => ({ x: element.scrollLeft, y: element.scrollTop })); await settle();
    assert.deepEqual(await area().evaluate(element => ({ x: element.scrollLeft, y: element.scrollTop })), finalScroll, 'Edge scrolling must stop on pointerup.');
    evidence.edgeScroll = finalScroll; await unchanged();
  });

  await check('横向滚动后的框选位置正确，选框不撑大画布滚动范围', async () => {
    await page!.getByLabel('画面缩放比例', { exact: true }).selectOption('100');
    await object('scroll_right').scrollIntoViewIfNeeded(); await settle();
    const initial = await area().evaluate(element => ({ width: element.scrollWidth, height: element.scrollHeight, left: element.scrollLeft, top: element.scrollTop }));
    assert.ok(initial.left > 0, 'Horizontal scroll fixture must actually be scrolled.');
    const frame = expand(await box(object('scroll_right')));
    await begin({ x: frame.x, y: frame.y }, end(frame)); await expectSelection(['scroll_right'], true);
    assert.deepEqual(await area().evaluate(element => ({ width: element.scrollWidth, height: element.scrollHeight })), { width: initial.width, height: initial.height });
    await finish(); await expectSelection(['scroll_right']); await unchanged();
  });

  await check('框选后仍可多选拖动、微调与缩放单个控件，所有编辑一次撤销', async () => {
    await openPage('main');
    await drag(await gamePoint(100, 85), await gamePoint(700, 270)); await expectSelection(['a', 'b']);
    const before = await designState(), surface = await box(canvas()), origin = center(await box(object('a')));
    await begin(origin, { x: origin.x + 40 * surface.width / project.width, y: origin.y + 24 * surface.height / project.height });
    await expect(marquee()).toHaveCount(0); await finish(); await expectDelta(before, ['a', 'b'], { x: 40, y: 24 }); await undoTo(before);
    await area().focus(); await page!.keyboard.press('Shift+ArrowDown'); await expectDelta(before, ['a', 'b'], { x: 0, y: 10 }); await undoTo(before);
    await row('a').locator('.ui-hierarchy-caption').click();
    const resize = center(await box(canvas().locator('[data-resize-handle="se"]'))), resizeBefore = await designState();
    await begin(resize, { x: resize.x + 36 * surface.width / project.width, y: resize.y + 22 * surface.height / project.height });
    await expect(marquee()).toHaveCount(0); await finish();
    await expect(async () => {
      const after = (await designState()).find(item => item.id === 'a')!, original = resizeBefore.find(item => item.id === 'a')!;
      near(after.width - original.width, 36); near(after.height - original.height, 22); near(after.x, original.x); near(after.y, original.y);
    }).toPass(); await undoTo(resizeBefore);
  });

  await check('Alt轮选与中键操作不会触发框选，右键仍可打开控件菜单', async () => {
    await openPage('marquee_overlap'); await clearSelection();
    const point = center(await box(object('over')));
    for (const id of ['over', 'under']) {
      await page!.keyboard.down('Alt'); await page!.mouse.click(point.x, point.y); await page!.keyboard.up('Alt');
      await expectSelection([id]); await expect(marquee()).toHaveCount(0);
    }
    const from = await gamePoint(80, 70), to = await gamePoint(600, 330);
    await page!.mouse.move(from.x, from.y); await page!.mouse.down({ button: 'middle' }); await page!.mouse.move(to.x, to.y, { steps: 5 });
    await expect(marquee()).toHaveCount(0); await page!.mouse.up({ button: 'middle' }); await expectSelection(['under']);
    await drag(from, to, ['Alt']); await expectSelection(['under']);
    await page!.mouse.click(point.x, point.y, { button: 'right' });
    const menu = page!.getByRole('menu', { name: '控件右键菜单', exact: true }); await expect(menu).toBeVisible();
    await expect(marquee()).toHaveCount(0);
    await begin(from, await gamePoint(780, 420)); await expect(menu).toHaveCount(0);
    await expect(marquee()).toHaveCount(1); await expectSelection(['under', 'over'], true);
    await finish(); await expectSelection(['under', 'over']); await unchanged();
  });

  await check('普通同位置单击按层轮选；快速重复按钮点击不丢失，轻微抖动仍属同点', async () => {
    await openPage('marquee_overlap'); await clearSelection(); const before = await designState(), point = center(await box(object('over')));
    const events = await page!.evaluate(() => {
      const seen: number[] = []; (window as unknown as { canvasClickDetails: number[] }).canvasClickDetails = seen;
      document.addEventListener('click', event => { if ((event.target as Element)?.closest?.('[data-component-id]')) seen.push(event.detail); }, { capture: true });
      return seen;
    }); assert.deepEqual(events, []);
    await page!.mouse.click(point.x, point.y, { clickCount: 1 }); await expectSelection(['over']);
    await secondClick(point); await expectSelection(['under']);
    await page!.mouse.click(point.x + 1, point.y + 1, { clickCount: 1 }); await expectSelection(['over']);
    const details = await page!.evaluate(() => (window as unknown as { canvasClickDetails: number[] }).canvasClickDetails);
    assert.deepEqual(details.slice(-3), [1, 2, 1]); evidence.nativeClickDetails = details.slice(-3);
    await screenshot('09-ordinary-overlap-selection'); await expectDesignState(before); await unchanged();
  });

  await check('轮选下层后可直接拖动下层，拖回原点和Esc取消不会轮选或产生修改', async () => {
    await openPage('marquee_overlap'); await clearSelection();
    const point = center(await box(object('over'))), before = await designState(), surface = await box(canvas());
    await page!.mouse.click(point.x, point.y); await expectSelection(['over']);
    await page!.mouse.click(point.x, point.y); await expectSelection(['under']);
    if (await button('智能吸附').getAttribute('aria-pressed') === 'true') await button('智能吸附').click();
    await drag(point, { x: point.x + 36 * surface.width / project.width, y: point.y + 24 * surface.height / project.height });
    await expectSelection(['under']); await expectDelta(before, ['under'], { x: 36, y: 24 }); await undoTo(before);
    await begin(point, { x: point.x + 18, y: point.y + 12 });
    await page!.mouse.move(point.x, point.y, { steps: 4 }); await finish(); await expectSelection(['under']); await expectDesignState(before); await unchanged();
    await clearSelection(); await page!.mouse.click(point.x, point.y); await expectSelection(['over']);
    await page!.mouse.move(point.x, point.y); await page!.mouse.down(); await page!.keyboard.press('Escape'); await page!.mouse.up();
    await expectSelection(['over']); await expectDesignState(before); await unchanged();
    await page!.mouse.click(point.x, point.y); await expectSelection(['over']);
    await page!.mouse.click(point.x, point.y); await expectSelection(['under']);
  });

  await check('控件外承托背景先清选再选背景，普通相邻对象与小图片一次切换', async () => {
    await openPage('marquee_background'); const before = await designState();
    await row('front').locator('.ui-hierarchy-caption').click();
    const background = await gamePoint(1210, 650);
    await page!.mouse.click(background.x, background.y, { clickCount: 1 }); await expectSelection([]);
    await secondClick(background); await expectSelection(['backdrop']);
    await row('front').locator('.ui-hierarchy-caption').click();
    const neighbor = center(await box(object('neighbor'))); await page!.mouse.click(neighbor.x, neighbor.y); await expectSelection(['neighbor']);
    await row('front').locator('.ui-hierarchy-caption').click();
    const image = await gamePoint(105, 55); await page!.mouse.click(image.x, image.y); await expectSelection(['small_image']);
    await screenshot('10-backdrop-and-adjacent-selection'); await expectDesignState(before); await unchanged();
    await openPage('marquee_frame'); await row('frame_child').locator('.ui-hierarchy-caption').click();
    const frame = await gamePoint(120, 80); await page!.mouse.click(frame.x, frame.y); await expectSelection([]);
    await page!.mouse.click(frame.x, frame.y); await expectSelection(['frame']); await unchanged();
  });

  await check('修饰键连续点选不被双击吞掉，外部选择与滚动打断轮选历史', async () => {
    await openPage('marquee_overlap'); await clearSelection(); const point = center(await box(object('over')));
    await page!.keyboard.down('Control'); await page!.mouse.click(point.x, point.y, { clickCount: 1 }); await expectSelection(['over']);
    await secondClick(point); await expectSelection([]); await page!.keyboard.up('Control');
    await page!.keyboard.down('Shift'); await page!.mouse.click(point.x, point.y, { clickCount: 1 }); await expectSelection(['over']);
    await secondClick(point); await expectSelection([]); await page!.keyboard.up('Shift');
    await page!.mouse.click(point.x, point.y); await expectSelection(['over']);
    await row('over').locator('.ui-hierarchy-caption').click();
    await page!.mouse.click(point.x, point.y); await expectSelection(['over']);
    await page!.mouse.click(point.x, point.y); await expectSelection(['under']);
    await page!.getByLabel('画面缩放比例', { exact: true }).selectOption('150');
    await object('over').scrollIntoViewIfNeeded(); await settle();
    const enlarged = center(await box(object('over'))); await page!.mouse.click(enlarged.x, enlarged.y); await expectSelection(['over']);
    const left = await area().evaluate(element => element.scrollLeft);
    await area().evaluate(element => { element.scrollLeft += 12; });
    await expect.poll(() => area().evaluate(element => element.scrollLeft)).not.toBe(left);
    await area().evaluate((element, previous) => { element.scrollLeft = previous; }, left); await settle();
    await page!.mouse.click(enlarged.x, enlarged.y); await expectSelection(['over']);
    await page!.mouse.click(enlarged.x, enlarged.y); await expectSelection(['under']); await unchanged();
  });

  await check('列表部件保持删除保护，空白退出的同次拖动不框选，下次拖动恢复', async () => {
    await openPage('choice'); await row('choices').locator('.ui-hierarchy-caption').click();
    const caption = object('choices').locator('[data-collection-part="caption"]').first(), point = center(await box(caption));
    await page!.mouse.dblclick(point.x, point.y); await expect(canvas()).toHaveAttribute('data-ui-editing-part', 'caption');
    const before = await designState();
    await area().focus(); await page!.keyboard.press('Delete'); await expectDesignState(before);
    await expect(canvas()).toHaveAttribute('data-ui-editing-part', 'caption'); await expect.poll(selected).toEqual(['choices']);
    await begin(await gamePoint(30, 50), await gamePoint(1190, 650)); await expect(marquee()).toHaveCount(0); await finish();
    await expect(canvas()).not.toHaveAttribute('data-ui-editing-part'); await expectSelection([]); await expectDesignState(before);
    await page!.mouse.dblclick(point.x, point.y); await expect(canvas()).toHaveAttribute('data-ui-editing-part', 'caption');
    await area().focus(); await page!.keyboard.press('Escape'); await expect(canvas()).not.toHaveAttribute('data-ui-editing-part');
    await expectSelection(['choices']);
    await drag(await gamePoint(30, 50), await gamePoint(1190, 650)); await expectSelection(['choices', 'choice_peer']);
    await screenshot('06-collection-scope-protection'); await unchanged();
  });

  await check('内置界面区域保留点击转控件，拖动起点不被框选抢占', async () => {
    await openPage('say');
    const native = page!.getByRole('button', { name: '编辑当前对白', exact: true }), origin = center(await box(native)), destination = await gamePoint(1200, 50);
    await begin(origin, destination); await expect(marquee()).toHaveCount(0); await finish(); await unchanged();
    await native.click(); await expect(canvas().locator('[data-component-id]')).toHaveCount(1);
    await expect(button('保存界面')).toBeEnabled(); await button('撤销').click();
    await expect(canvas().locator('[data-component-id]')).toHaveCount(0); await expect(native).toBeVisible(); await unchanged();
  });

  await check('玩家剧情图中键平移、内部缩放和节点拖动保留自己的操作范围', async () => {
    await openPage('flowchart'); await row('flow').locator('.ui-hierarchy-caption').click();
    const preview = object('flow').locator('.ui-story-flow-preview'), before = await designState(), region = await box(preview);
    assert.ok(await preview.evaluate(element => element.scrollWidth > element.clientWidth), 'The flow fixture must actually overflow.');
    const origin = { x: region.x + region.width * .8, y: region.y + region.height * .7 };
    await page!.mouse.move(origin.x, origin.y); await page!.mouse.down({ button: 'middle' }); await page!.mouse.move(origin.x - 80, origin.y - 10, { steps: 5 });
    await expect(marquee()).toHaveCount(0); await page!.mouse.up({ button: 'middle' });
    await expect.poll(() => preview.evaluate(element => element.scrollLeft)).toBeGreaterThan(0); await expectDesignState(before);
    const width = await preview.locator(':scope > div').evaluate(element => element.getBoundingClientRect().width);
    await button('放大流程图').click(); await expect.poll(() => preview.locator(':scope > div').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(width);
    await expect(marquee()).toHaveCount(0); await expectDesignState(before); await unchanged();
    await preview.evaluate(element => { element.scrollLeft = 0; element.scrollTop = 0; }); await settle();
    const node = object('flow').locator('[data-flow-node]').first(); await node.scrollIntoViewIfNeeded();
    const nodeBox = await box(node), from = center(nodeBox);
    await begin(from, { x: from.x + 35, y: from.y + 15 }); await expect(marquee()).toHaveCount(0); await finish();
    await expect(button('保存界面')).toBeEnabled(); await expectDesignState(before);
    await button('撤销').click(); await expect.poll(async () => (await box(node)).x).toBeCloseTo(nodeBox.x, 1); await unchanged();
  });

  await check('未选剧情图滚动条起拖只框选，直接双击未选集合仍进入部件', async () => {
    await openPage('flowchart'); await clearSelection();
    const before = await designState(), preview = object('flow').locator('.ui-story-flow-preview');
    const scroll = await preview.evaluate(element => ({ x: element.scrollLeft, y: element.scrollTop }));
    const rail = object('flow').getByRole('scrollbar').first(), origin = center(await box(rail));
    await begin(origin, { x: origin.x + 60, y: origin.y - 40 });
    await expect(marquee()).toHaveCount(1); await expectDesignState(before);
    assert.deepEqual(await preview.evaluate(element => ({ x: element.scrollLeft, y: element.scrollTop })), scroll);
    await finish(); await expectSelection([]); await unchanged();
    await openPage('choice'); await clearSelection();
    const caption = object('choices').locator('[data-collection-part="caption"]').first(), point = center(await box(caption));
    await page!.mouse.dblclick(point.x, point.y); await expect(canvas()).toHaveAttribute('data-ui-editing-part', 'caption');
    // Internal editing replaces the layout toolbar (and its selection count).
    // Check the same selected object directly, as the existing part-scope case.
    await expect.poll(selected).toEqual(['choices']); await expect(marquee()).toHaveCount(0); await unchanged();
    await area().focus(); await page!.keyboard.press('Escape'); await expect(canvas()).not.toHaveAttribute('data-ui-editing-part');
  });

  await check('框选状态不进入工程文件，关闭重开后无残留框或选区', async () => {
    await openPage('main'); await drag(await gamePoint(100, 85), await gamePoint(700, 270)); await expectSelection(['a', 'b']);
    await unchanged(); await close(); await launch(); await expect(marquee()).toHaveCount(0); await expectSelection([]); await unchanged();
    await screenshot('07-reopened-clean-selection'); evidence.fixtureSha256After = sha256(await fs.readFile(projectFile));
  });

  assert.equal(checks.length, 24); assert.deepEqual(errors, [], 'Renderer must not raise runtime errors.'); report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = String(error);
  if (app && page && !page.isClosed()) {
    report.selectedAtFailure = await selected().catch(() => undefined);
    await screenshot('failure').catch(capture => { report.captureError = String(capture); });
  }
} finally {
  try { await close(); } catch (error) { report.status = 'failed'; report.closeError = String(error); failure ??= error; }
  try {
    const after = sha256(await fs.readFile(sourceFile)); report.sourceSha256After = after;
    if (sourceHash !== undefined) assert.equal(after, sourceHash, 'Author project changed during isolated acceptance.');
  } catch (error) { report.status = 'failed'; report.sourceProtectionError = String(error); failure ??= error; }
  try {
    if (app || processes.some(record => !record.exited)) throw new Error('An owned fixture process remains alive; retain its directories.');
    report.cleanup = await cleanVerificationDirectories(output, ['project', 'profile']);
    assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []);
  } catch (error) { report.status = 'failed'; report.cleanupError = String(error); failure ??= error; }
  await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
}
if (failure) throw failure;
