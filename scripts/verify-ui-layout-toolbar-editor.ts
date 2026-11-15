import { openUiPageSettings } from './lib/ui-design-controls';
import { resetUiPanelLayout } from './lib/ui-design-controls';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { createProject, projectSchema, uiComponentLimit, type UiComponent } from '../src/core/model';
import { createBlueprintGraph } from '../src/core/blueprint';
import { resolveUiLayout } from '../src/core/ui-layout';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { openUiPageOptions, openUiPageUsage, selectUiDesignScheme, setUiCanvasPreview } from './lib/ui-design-controls';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Use only the isolated development editor.');
const builtRenderer = process.env.VNS_VERIFY_BUILT_RENDERER === '1';
const root = path.resolve('.'), output = path.resolve(process.env.VNS_ARTIFACT_ROOT ? path.join(process.env.VNS_ARTIFACT_ROOT, 'ui-layout-toolbar-editor') : 'artifacts/ui-layout-toolbar', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json');
const sourceFile = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? '../我的视觉小说1/project.vns.json');
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const project = createProject('界面布局工具验收'); project.width = 1280; project.height = 720;
const component = (id: string, patch: Partial<UiComponent> = {}): UiComponent => ({ id, page: 'main', kind: 'button', name: id, text: id, x: .12, y: .16, width: .14, height: .12, style: { background: '#45676c', textColor: '#f1f2e9', fontSize: 30 }, ...patch });
project.ui.pages = { main: { layout: 'custom' } };
project.assets.push({ id: 'layout_skin', name: '透明边缘按钮', kind: 'image', path: 'assets/button.png', width: 240, height: 100 });
project.ui.components = [
  component('a', { name: '继续游戏', text: '继续游戏', skin: { idle: 'layout_skin' } }),
  component('b', { name: '读取存档', text: '读取存档', x: .47, y: .44, width: .2, height: .1, skin: { idle: 'layout_skin' }, style: { fontSize: 28, borderWidth: 3, borderColor: '#dfa968' } }),
  component('c', { name: '设置', text: '设置', x: .78, y: .29, width: .1, height: .14 }),
  component('save_only', { page: 'save', saveMode: 'save' }), component('load_only', { page: 'save', saveMode: 'load' }),
];
const hook = createBlueprintGraph('function', '已有显示事件'); project.blueprints.push(hook);
project.ui.customPages = [
  { id: 'layout_custom', name: '已有说明页面', modal: true, background: '#17262d', onShowBlueprintId: hook.id, components: [component('custom_control', { page: 'custom' })] },
  { id: 'layout_nested', name: '父子控件', modal: true, components: [component('parent', { page: 'custom', kind: 'panel', width: .5, height: .6, layout: { version: 1, rotation: 18, scaleX: 1.1, paddingLeft: 12 } }), component('child', { page: 'custom', parentId: 'parent', x: .2, y: .2, width: .4, height: .2 }), component('peer', { page: 'custom', x: .75, y: .6 })] },
  { id: 'layout_restricted', name: '编辑保护', modal: true, components: [component('unlocked', { page: 'custom' }), component('locked', { page: 'custom', x: .4, editor: { locked: true } }), component('hidden', { page: 'custom', y: .5, editor: { hidden: true } }), component('future', { page: 'custom', x: .65, layout: { version: 7, futureOption: 'preserve' } }), component('flow', { page: 'custom', kind: 'panel', y: .7, width: .5, height: .2, layout: { version: 1, flow: 'horizontal' } }), component('flow_child', { page: 'custom', parentId: 'flow', x: 0, y: 0, width: .3, height: .8 })] },
  { id: 'layout_snap', name: '智能吸附', modal: true, components: [component('snap_move', { page: 'custom', name: '拖动我', text: '拖动我', x: .125, y: .2, width: .125, height: .1 }), component('snap_peer', { page: 'custom', name: '另一控件', text: '另一控件', x: .35, y: .5, width: .1, height: .1 }), component('snap_target', { page: 'custom', name: '固定参照', text: '固定参照', x: .625, y: .62, width: .18, height: .1, editor: { locked: true } })] },
];
project.ui.instances = [{ id: 'limited_scheme', name: '仅剩一个覆盖名额', components: Array.from({ length: uiComponentLimit - 1 }, (_, i) => component('filler_' + i, { page: 'staff' })) }];
const checks: string[] = [], errors: string[] = [];
const processes: { pid?: number; exited: boolean }[] = [];
const interactionSessions: unknown[] = [], dragAttempts: unknown[] = [];
const report: Record<string, unknown> = { status: 'running', renderer: builtRenderer ? 'built' : 'development', checks, errors, processes, interactionSessions, dragAttempts,
  sourceFile, temporaryPaths: [path.dirname(projectFile), path.join(output, 'profile')] };
let sourceHash: string | undefined;
let app: ElectronApplication | undefined, server: ViteDevServer | undefined, phase = 'setup';
let page!: Page;
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const row = (id: string) => page!.locator('[data-hierarchy-id="' + id + '"]');
const object = (id: string) => page!.locator('.ui-canvas [data-component-id="' + id + '"]');
const toolbar = () => page!.getByLabel('控件布局工具栏', { exact: true });
const selection = () => page!.locator('[data-ui-selection-count]');
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const save = async () => {
  if (await button('保存界面').isEnabled()) await button('保存界面').click();
  await expect(page!.locator('.ui-save-status')).toHaveText('已保存');
  await expect(page!.locator('.ui-save-status')).toHaveAttribute('data-dirty', 'false');
  await expect(button('保存界面')).toBeDisabled();
  return read();
};
const near = (a: number, b: number, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const record = (value: string) => { checks.push(value); console.log('PASS ' + checks.length + ': ' + value); };
const openPage = async (id: string) => { await page!.getByLabel('设计页面', { exact: true }).selectOption(id); await expect(toolbar()).toBeVisible(); };
const selectThree = async () => {
  await row('a').click(); await object('b').click({ modifiers: ['Control'] }); await row('c').click({ modifiers: ['Shift'] });
  await expect(selection()).toHaveAttribute('data-ui-selection-count', '3');
  await expect.poll(() => page.evaluate(() => getSelection()?.toString() ?? '')).toBe('');
};
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile'), devUrl: server ? 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port : undefined, sdkRoot: 'E:/Tools/renpy-8.5.3-sdk' });
  page = await app.firstWindow(); page.setDefaultTimeout(18000); page.on('pageerror', error => errors.push(error.message));
  // Occluded Windows fixtures must still paint frames for stable geometry and screenshots.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  if (builtRenderer) assert.equal(fileURLToPath(page.url()), path.join(root, 'dist/index.html'));
  report.rendererUrl = page.url();
  await page.evaluate('globalThis.__name = value => value');
  await page.evaluate(() => {
    const events: unknown[] = [];
    (window as unknown as { layoutInteractions: unknown[] }).layoutInteractions = events;
    const describe = (element: Element | null | undefined) => element ? {
      tag: element.tagName, label: element.getAttribute('aria-label'), role: element.getAttribute('role'),
      className: element.getAttribute('class'), component: element.closest('[data-component-id]')?.getAttribute('data-component-id'),
      transform: element.closest('[data-transform-id]')?.getAttribute('data-transform-id'),
    } : undefined;
    const rectangle = (element: Element | null | undefined) => {
      const rect = element?.getBoundingClientRect();
      return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined;
    };
    const recordEvent = (event: Event, stage = 'capture') => {
      const target = event.target instanceof Element ? event.target : undefined;
      const pointer = event instanceof PointerEvent ? event : undefined;
      const canvas = document.querySelector('.ui-canvas'), scroller = canvas?.closest('.ui-scroll');
      const selected = [...document.querySelectorAll('.ui-canvas .ui-component.selected')];
      events.push({ type: event.type, stage, time: performance.now(), eventTime: event.timeStamp, trusted: event.isTrusted,
        defaultPrevented: event.defaultPrevented, target: describe(target), active: describe(document.activeElement),
        label: target?.getAttribute('aria-label'), tag: target?.tagName,
        key: event instanceof KeyboardEvent ? event.key : undefined,
        value: target instanceof HTMLInputElement ? target.value : undefined,
        pointer: pointer ? { id: pointer.pointerId, type: pointer.pointerType, button: pointer.button, buttons: pointer.buttons,
          x: pointer.clientX, y: pointer.clientY, alt: pointer.altKey, shift: pointer.shiftKey, ctrl: pointer.ctrlKey, meta: pointer.metaKey,
          hit: describe(document.elementFromPoint(pointer.clientX, pointer.clientY)),
          captures: [...document.querySelectorAll('.ui-scroll,.ui-canvas,[data-component-id],[data-transform-id],[data-resize-handle]')]
            .filter(element => element.hasPointerCapture(pointer.pointerId)).map(describe),
        } : undefined,
        selected: selected.map(element => element.getAttribute('data-component-id')),
        selectedRects: selected.map(element => ({ id: element.getAttribute('data-component-id'), rect: rectangle(element) })),
        canvas: rectangle(canvas), scroller: rectangle(scroller), scroll: scroller ? { x: scroller.scrollLeft, y: scroller.scrollTop } : undefined,
        zoom: document.querySelector<HTMLSelectElement>('[aria-label="画面缩放比例"]')?.value,
        guides: [...document.querySelectorAll('[data-snap-axis]')].map(element => ({ axis: element.getAttribute('data-snap-axis'), target: element.getAttribute('data-snap-target'), position: element.getAttribute('data-snap-position') })),
        marquee: !!document.querySelector('[data-ui-marquee]'), focused: document.hasFocus(), visibility: document.visibilityState,
        step: document.querySelector<HTMLInputElement>('.ui-nudge-step input')?.value });
      if (events.length > 400) events.shift();
    };
    // Observe the original native gesture without adding waits, focus, retries,
    // or changing capture. Next-task samples reveal capture set/released by
    // React handlers; raw move samples distinguish cancellation from no input.
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture', 'click', 'input', 'change', 'keydown', 'focusin', 'visibilitychange']) document.addEventListener(type, event => {
      if (event instanceof PointerEvent && event.type === 'pointermove' && !event.buttons && !(event.target instanceof Element && event.target.closest('.ui-canvas'))) return;
      recordEvent(event);
      if (event instanceof PointerEvent) setTimeout(() => recordEvent(event, 'next-task'), 0);
    }, true);
    for (const type of ['blur', 'focus']) window.addEventListener(type, event => recordEvent(event, 'window'));
  });
}
async function close() {
  if (!app) return;
  const child = app.process();
  interactionSessions.push({ pid: child.pid, phase, events: await page.evaluate(() => (window as unknown as { layoutInteractions?: unknown[] }).layoutInteractions).catch(() => undefined) });
  await app.close();
  const state = { pid: child.pid, exited: child.exitCode !== null || child.signalCode !== null }; processes.push(state); assert.ok(state.exited);
  app = undefined;
}
async function beginDrag(id: string, delta: { x: number; y: number }) {
  await object(id).scrollIntoViewIfNeeded();
  const box = (await object(id).boundingBox())!, canvasBox = (await page!.locator('.ui-canvas').boundingBox())!, scale = canvasBox.width / project.width;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }, end = { x: start.x + delta.x * scale, y: start.y + delta.y * scale };
  dragAttempts.push({ pid: app!.process().pid, phase, id, delta, box, canvas: canvasBox, scale, start, end });
  await page!.mouse.move(start.x, start.y); await page!.mouse.down();
  await page!.mouse.move(end.x, end.y, { steps: 8 });
}
const designState = () => page!.locator('.ui-canvas').evaluate(element => {
  const scale = element.getBoundingClientRect().width / 1280;
  return [...element.querySelectorAll<HTMLElement>('[data-component-id]')].map(control => {
    const style = getComputedStyle(control), matrix = new DOMMatrixReadOnly(style.transform);
    return { id: control.dataset.componentId, values: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e / scale, matrix.f / scale, parseFloat(style.width) / scale, parseFloat(style.height) / scale].map(value => Number(value.toFixed(2))) };
  });
});
async function undoTo(before: Awaited<ReturnType<typeof designState>>) { await button('撤销').click(); await expect.poll(designState).toEqual(before); }
async function undoRedoSave(before: Awaited<ReturnType<typeof designState>>, baseline: Awaited<ReturnType<typeof read>>, pageId = 'main') {
  const after = await designState(); assert.notDeepEqual(after, before);
  await undoTo(before); await button('重做').click(); await expect.poll(designState).toEqual(after);
  const saved = await save();
  // Saving deliberately ends the existing discardable UI draft. Reset only this
  // isolated fixture on disk; undo is verified before save, never across it.
  const windowSize = await page.evaluate(() => [innerWidth, innerHeight]);
  await close(); await saveProject(projectFile, baseline); await launch(); await size(windowSize[0], windowSize[1]);
  await page!.locator('[data-workspace-tab="ui"]').click(); await openPage(pageId);
  return saved;
}
async function expectMove(before: Awaited<ReturnType<typeof designState>>, ids: string[], delta: { x: number; y: number }) {
  // Native input dispatch may return before React has painted the new geometry.
  await expect(async () => {
    const after = await designState();
    for (const id of ids) {
      const previous = before.find(item => item.id === id)!.values, next = after.find(item => item.id === id)!.values;
      near(next[4] - previous[4], delta.x, 1.1); near(next[5] - previous[5], delta.y, 1.1);
      near(next[6], previous[6], .1); near(next[7], previous[7], .1);
    }
  }).toPass({ timeout: 5000 });
}
async function size(width: number, height = 900) {
  const window = await app!.browserWindow(page);
  await window.evaluate((window, value) => {
    if (window.isMinimized()) window.restore();
    if (window.isMaximized()) window.unmaximize();
    window.setContentSize(value.width, value.height);
  }, { width, height });
  await window.dispose(); await expect.poll(async () => Math.abs(await page!.evaluate(() => innerWidth) - width)).toBeLessThanOrEqual(2);
}
async function snapshot(name: string) {
  await expect.poll(() => toolbar().evaluate(element => element.scrollWidth <= element.clientWidth + 1 && [...element.querySelectorAll('button, input, select')].every(control => {
    const a = control.getBoundingClientRect(), b = element.getBoundingClientRect(); return a.width >= 28 && a.height >= 28 && a.left >= b.left - 1 && a.right <= b.right + 1;
  }))).toBe(true);
  await expect.poll(() => page!.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page!.locator('.ui-workspace').screenshot({ path: path.join(output, name + '.png') });
}

try {
  sourceHash = sha256(await fs.readFile(sourceFile)); report.sourceSha256Before = sourceHash;
  await fs.mkdir(path.join(output, 'project/assets'), { recursive: true });
  const image = new PNG({ width: 240, height: 100 });
  for (let y = 10; y < 90; y++) for (let x = 10; x < 230; x++) { const offset = (y * 240 + x) * 4; image.data.set([68, 104, 107, 255], offset); }
  await fs.writeFile(path.join(output, 'project/assets/button.png'), PNG.sync.write(image)); await saveProject(projectFile, project);
  const original = await read(), originalBytes = await fs.readFile(projectFile, 'utf8');
  if (!builtRenderer) {
    server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/work/**', '**/resources/**', '**/release/**'] } } });
    await server.listen();
  }
  await launch();
  await page.locator('[data-workspace-tab="ui"]').click(); await page.getByLabel('界面编辑模式').getByRole('button', { name: '设计', exact: true }).click();

  phase = 'compact layout and transparency';
  for (const width of [1920, 1280, 1024]) { await size(width, width === 1024 ? 768 : 900); await snapshot('layout-' + width); }
  await expect(page.locator('.ui-workspace > .workspace-toolbar')).toHaveCount(1);
  await expect(page.locator('.ui-page-toolbar, .ui-custom-page-toolbar, .ui-instance-toolbar')).toHaveCount(0);
  await expect(button('接入游戏')).toHaveCount(0); await expect(toolbar().locator('select')).toHaveCount(0);
  await expect(toolbar().getByRole('spinbutton', { name: '微调步长', exact: true })).toHaveValue('1');
  await expect(button('智能吸附')).toHaveAttribute('aria-pressed', 'true'); await expect(page.locator('.ui-snap-guides')).toHaveCount(0);
  await expect(button('左对齐')).toBeDisabled(); await expect(button('水平等距')).toBeDisabled();
  await expect(object('a')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(object('a')).toHaveCSS('outline-color', 'rgba(0, 0, 0, 0)');
  const border = await object('b').evaluate(element => ({ color: getComputedStyle(element, '::after').borderTopColor, width: parseFloat(getComputedStyle(element, '::after').borderTopWidth) }));
  expect(border.color).toBe('rgb(223, 169, 104)'); expect(border.width).toBeGreaterThan(0);
  await expect(object('c')).toHaveCSS('background-color', 'rgb(69, 103, 108)');
  await setUiCanvasPreview(page, '按钮预览状态', 'pressed'); await expect(object('a')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await setUiCanvasPreview(page, '按钮预览状态', 'idle');
  assert.equal(await fs.readFile(projectFile, 'utf8'), originalBytes); await expect(button('保存界面')).toBeDisabled();
  record('底部只有布局工具，顶部仍为一行；1024/1280/1920 不溢出。图片按钮透明边缘不再垫底色，真实边框与普通按钮底色保留。');

  phase = 'single alignment and no-op history'; await size(1280);
  await object('a').click(); await expect(selection()).toHaveAttribute('data-ui-selection-count', '1');
  await expect(page.getByLabel('对齐参照')).toHaveCount(0); await expect(toolbar()).toHaveAttribute('data-align-target', 'canvas'); await expect(page.locator('.ui-align-reference')).toContainText('整个游戏画面'); await expect(page.locator('.ui-resize-handle')).toHaveCount(8);
  const singleBefore = await designState(); await button('水平居中').click();
  await expect(toolbar().getByRole('status')).toHaveText('水平居中');
  await expect(page.locator('.ui-workspace')).not.toContainText('可撤销');
  await button('水平居中').click(); await expect(toolbar()).toContainText('无需调整');
  let saved = await undoRedoSave(singleBefore, original); near(saved.ui.components.find(c => c.id === 'a')!.x, (1 - .14) / 2);
  record('单选可相对画布居中；重复点击不增加撤销步骤，一次撤销恢复原位置，重做和保存位置正确。');

  phase = 'inspector keyboard undo'; await row('a').click();
  const inspectorBefore = await designState();
  for (const [name, value] of [['横向位置 %', '23.5'], ['纵向位置 %', '31'], ['宽度 %', '22'], ['高度 %', '17']]) {
    const input = page.getByLabel(name, { exact: true }), previous = await input.inputValue();
    await input.fill(value); await expect(input).toBeFocused(); const edited = await designState(); assert.notDeepEqual(edited, inspectorBefore);
    await input.press('Control+z'); await expect(input).toHaveValue(previous); await expect.poll(designState).toEqual(inspectorBefore);
    await input.press('Control+Shift+z'); await expect(input).toHaveValue(value); await expect.poll(designState).toEqual(edited);
    await input.press('Control+z'); await expect.poll(designState).toEqual(inspectorBefore);
  }
  // Object transforms now live under common properties → position/size → more
  // layout, rather than the former single details.ui-layout-fields wrapper.
  const layoutFields = page.locator('[data-ui-inspector-group="layout-transform"]');
  if (await layoutFields.getAttribute('open') === null) await layoutFields.locator(':scope > summary').click();
  for (const [name, value] of [['控件整体旋转', '24'], ['控件整体横向缩放', '1.25'], ['父内容区横向锚点', '0.5']]) {
    const input = page.getByLabel(name, { exact: true }), previous = await input.inputValue();
    await input.fill(value); const edited = await designState(); assert.notDeepEqual(edited, inspectorBefore);
    await input.press('Control+z'); await expect(input).toHaveValue(previous); await expect.poll(designState).toEqual(inspectorBefore);
    await input.press('Control+y'); await expect(input).toHaveValue(value); await expect.poll(designState).toEqual(edited);
    await input.press('Control+z'); await expect.poll(designState).toEqual(inspectorBefore);
  }
  await layoutFields.locator(':scope > summary').click();
  const xField = page.getByLabel('横向位置 %', { exact: true }), yField = page.getByLabel('纵向位置 %', { exact: true });
  await xField.fill('25'); const xEdited = await designState(); await yField.fill('28');
  await yField.press('Control+z'); await expect(xField).toHaveValue('25'); await expect(yField).toHaveValue('16'); await expect.poll(designState).toEqual(xEdited);
  await yField.press('Control+z'); await expect.poll(designState).toEqual(inspectorBefore);
  const labelBox = (await xField.locator('xpath=ancestor::label').locator('.field-label').boundingBox())!;
  await page.mouse.move(labelBox.x + 5, labelBox.y + labelBox.height / 2); await page.mouse.down();
  await page.mouse.move(labelBox.x + 55, labelBox.y + labelBox.height / 2, { steps: 4 }); await page.waitForTimeout(800);
  await page.mouse.move(labelBox.x + 105, labelBox.y + labelBox.height / 2, { steps: 8 }); await page.mouse.up();
  const scrubbed = await designState(); assert.notDeepEqual(scrubbed, inspectorBefore);
  await page.keyboard.press('Control+z'); await expect.poll(designState).toEqual(inspectorBefore);
  await page.keyboard.press('Control+y'); await expect.poll(designState).toEqual(scrubbed);
  await page.keyboard.press('Control+z'); await expect.poll(designState).toEqual(inspectorBefore);
  await xField.fill('26'); await xField.press('Escape'); await expect(xField).toHaveValue('12'); await expect.poll(designState).toEqual(inspectorBefore);
  await xField.fill(''); await xField.press('Escape'); await expect(xField).toHaveValue('12');
  await xField.fill('26'); await xField.fill('12'); await xField.press('Tab'); await expect.poll(designState).toEqual(inspectorBefore);
  await expect(button('撤销')).toBeDisabled();
  await xField.fill('26'); const beforeModeSwitch = await designState();
  await page.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click();
  await page.getByLabel('界面编辑模式').getByRole('button', { name: '设计', exact: true }).click();
  await expect(xField).toHaveValue('26'); await yField.fill('28'); await yField.press('Control+z');
  await expect.poll(designState).toEqual(beforeModeSwitch); await yField.press('Control+z'); await expect.poll(designState).toEqual(inspectorBefore);
  await row('b').click(); const otherX = page.getByLabel('横向位置 %', { exact: true }), otherBefore = await otherX.inputValue();
  await otherX.fill('40'); await otherX.press('Control+z'); await expect(otherX).toHaveValue(otherBefore); await expect.poll(designState).toEqual(inspectorBefore);
  await row('a').click();
  const search = page.getByLabel('搜索控件', { exact: true }); await search.fill('继续'); await search.press('Control+a'); await search.pressSequentially('x'); await search.press('Control+z');
  await expect(search).toHaveValue('继续'); await expect.poll(designState).toEqual(inspectorBefore); await search.fill('');
  await expect(button('保存界面')).toBeDisabled(); assert.deepEqual((await read()).ui.components, original.ui.components);
  record('右侧位置、大小、旋转、缩放、锚点在输入框仍聚焦时可 Ctrl+Z 撤销，Ctrl+Y/Shift+Ctrl+Z 重做；不同字段分步撤回，标签拖动也可撤销，搜索文字保留原生撤销。');

  phase = 'multiselect align distribute undo'; await selectThree();
  await expect(toolbar()).toHaveAttribute('data-align-target', 'last'); await expect(page.locator('.ui-align-reference')).toHaveText('基准：设置（末选）'); await expect(object('c')).toHaveClass(/alignment-reference/); await expect(row('c').locator('.ui-hierarchy-reference')).toHaveText('基准'); await expect(page.locator('.ui-canvas .selected')).toHaveCount(3);
  await expect(page.locator('.ui-resize-handle')).toHaveCount(0); await expect(page.locator('.ui-primary-selection-note')).toHaveText('共同属性 · 3 项');
  const multiBefore = await designState(); await button('水平等距').click(); const distributed = await designState();
  await button('顶对齐').click(); await expect(toolbar().getByRole('status')).toHaveText('顶对齐'); await snapshot('multiselect-aligned'); await toolbar().screenshot({ path: path.join(output, 'layout-toolbar.png') });
  await undoTo(distributed); await undoTo(multiBefore);
  await button('重做').click(); await expect.poll(designState).toEqual(distributed); await button('顶对齐').click();
  saved = await undoRedoSave(distributed, original);
  const sorted = ['a', 'b', 'c'].map(id => saved.ui.components.find(c => c.id === id)!);
  near(sorted[0].x, .12); near(sorted[2].x, .78); near(sorted[1].x - sorted[0].x - sorted[0].width, sorted[2].x - sorted[1].x - sorted[1].width);
  for (const item of sorted) near(item.y, .29);
  assert.deepEqual(sorted[2], original.ui.components.find(c => c.id === 'c'));
  await selectThree();
  await row('c').click({ modifiers: ['Control'] }); await expect(selection()).toHaveAttribute('data-ui-selection-count', '2'); await expect(button('水平等距')).toBeDisabled();
  record('画布和列表均可 Shift/Ctrl 多选；对齐直接以末选控件为基准，基准高亮且保持不动，不再使用下拉框。等距固定两端，各自一次撤销。');

  phase = 'group drag nudge copy delete'; await selectThree(); await button('智能吸附').click();
  const dragBefore = await designState(), box = (await object('a').boundingBox())!, scale = (await page.locator('.ui-canvas').boundingBox())!.width / project.width;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40 * scale, box.y + box.height / 2 + 24 * scale, { steps: 10 }); await page.mouse.up();
  saved = await undoRedoSave(dragBefore, original); for (const id of ['a', 'b', 'c']) { const before = original.ui.components.find(c => c.id === id)!, after = saved.ui.components.find(c => c.id === id)!; near(after.x - before.x, 40 / project.width); near(after.y - before.y, 24 / project.height); }
  await selectThree(); const nudgeBefore = await designState();
  await page.getByLabel('微调步长').fill('7.5'); await button('向右微调').click(); await expectMove(nudgeBefore, ['a', 'b', 'c'], { x: 7.5, y: 0 });
  await undoTo(nudgeBefore);
  for (const invalid of ['', '0', '-4']) {
    await page.getByLabel('微调步长').fill(invalid); await page.getByLabel('微调步长').press('Tab'); await expect(page.getByLabel('微调步长')).toHaveValue('7.5');
    await expect.poll(designState).toEqual(nudgeBefore);
  }
  await expect(selection()).toHaveAttribute('data-ui-selection-count', '3');
  await page.getByLabel('微调步长').fill('10'); await expect(page.getByLabel('微调步长')).toHaveValue('10');
  await button('向右微调').click(); await expectMove(nudgeBefore, ['a', 'b', 'c'], { x: 10, y: 0 });
  await expect(selection()).toHaveAttribute('data-ui-selection-count', '3'); await expect(page.getByLabel('微调步长')).toHaveValue('10');
  await undoTo(nudgeBefore); await page.getByLabel('界面设计画布', { exact: true }).focus(); await page.keyboard.press('Shift+ArrowDown'); await expectMove(nudgeBefore, ['a', 'b', 'c'], { x: 0, y: 10 });
  await undoTo(nudgeBefore); await page.getByLabel('界面设计画布', { exact: true }).focus(); await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
  await expect(page.locator('.ui-hierarchy-row')).toHaveCount(6); await expect(selection()).toHaveAttribute('data-ui-selection-count', '3');
  await page.keyboard.press('Delete'); await expect(page.locator('.ui-hierarchy-row')).toHaveCount(3); await button('撤销').click(); await expect(page.locator('.ui-hierarchy-row')).toHaveCount(6); await button('撤销').click(); saved = await save(); assert.deepEqual(saved.ui.components, original.ui.components);
  await button('智能吸附').click(); await expect(button('保存界面')).toBeDisabled();
  record('微调步长可直接输入整数或小数，空值/非正数回退且不修改工程；多选拖动、微调、键盘、复制/粘贴/删除按整组执行并可撤销。');

  phase = 'smart snap zoom and Alt override'; await openPage('layout_snap'); await size(1920, 1080);
  const guides = () => page!.locator('.ui-snap-guides'), xGuide = () => page!.locator('[data-snap-axis="x"]');
  const snapOriginal = original.ui.customPages.find(p => p.id === 'layout_snap')!.components;
  for (const zoom of ['25', '100']) {
    await page.getByLabel('画面缩放比例', { exact: true }).selectOption(zoom); await row('snap_move').click();
    const zoomScale = Number(zoom) / 100, raw = { x: 400 - 4 / zoomScale, y: 40 }, before = await designState();
    await beginDrag('snap_move', raw); await expect(xGuide()).toHaveAttribute('data-snap-position', '640'); await expect(xGuide()).toHaveAttribute('data-snap-target', 'canvas'); await expect(page.locator('.ui-snap-label')).toContainText('游戏画面 · 水平中心');
    await page.keyboard.down('Alt'); await expect(guides()).toHaveCount(0);
    const unsnapped = (await object('snap_move').boundingBox())!, plane = (await page.locator('.ui-canvas').boundingBox())!;
    near((unsnapped.x - plane.x) / zoomScale, 160 + raw.x, 1);
    await page.keyboard.up('Alt'); await expect(xGuide()).toHaveAttribute('data-snap-position', '640');
    if (zoom === '100') await snapshot('smart-snap-canvas-center');
    await page.mouse.up(); await expect(guides()).toHaveCount(0); saved = await undoRedoSave(before, original, 'layout_snap');
    near(saved.ui.customPages.find(p => p.id === 'layout_snap')!.components.find(c => c.id === 'snap_move')!.x, .4375);
    assert.deepEqual((await read()).ui.customPages.find(p => p.id === 'layout_snap')!.components, snapOriginal);
  }
  await page.getByLabel('画面缩放比例', { exact: true }).selectOption('50'); await row('snap_move').click();
  const edgeBefore = await designState(); await beginDrag('snap_move', { x: 636, y: 20 }); await expect(xGuide()).toHaveAttribute('data-snap-target', 'snap_target'); await expect(xGuide()).toHaveAttribute('data-snap-position', '800'); await snapshot('smart-snap-control-edge');
  await page.mouse.up(); saved = await undoRedoSave(edgeBefore, original, 'layout_snap'); near(saved.ui.customPages.find(p => p.id === 'layout_snap')!.components.find(c => c.id === 'snap_move')!.x, .625);
  assert.deepEqual(saved.ui.customPages.find(p => p.id === 'layout_snap')!.components.find(c => c.id === 'snap_target'), snapOriginal.find(c => c.id === 'snap_target'));
  await page.getByLabel('画面缩放比例', { exact: true }).selectOption('50');
  await row('snap_move').click(); await row('snap_peer').click({ modifiers: ['Control'] }); const groupBefore = await designState(); await beginDrag('snap_move', { x: 266, y: 17 });
  await expect(xGuide()).toHaveAttribute('data-snap-position', '640'); await page.mouse.up(); saved = await undoRedoSave(groupBefore, original, 'layout_snap');
  for (const id of ['snap_move', 'snap_peer']) {
    const before = snapOriginal.find(c => c.id === id)!, after = saved.ui.customPages.find(p => p.id === 'layout_snap')!.components.find(c => c.id === id)!;
    near(after.x - before.x, 272 / project.width); near(after.width, before.width); near(after.height, before.height);
  }
  record('25% 和 100% 缩放均按屏幕距离吸附到画布中心；也可对齐其他控件边缘（含锁定参照）。多选整组吸附，一次撤销；拖动中 Alt 按下/松开即时暂停/恢复。');

  phase = 'snap toggle cancellation and guide lifetime'; await page.getByLabel('画面缩放比例', { exact: true }).selectOption('50'); await row('snap_move').click();
  for (const cancel of ['escape', 'blur', 'pointercancel', 'page']) {
    await beginDrag('snap_move', { x: 392, y: 40 }); await expect(guides()).toHaveCount(1);
    if (cancel === 'escape') await page.keyboard.press('Escape');
    else if (cancel === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else if (cancel === 'pointercancel') {
      const pointerId = await page.evaluate(() => {
        const records = (window as unknown as { layoutInteractions: { type: string; stage: string; pointer?: { id: number } }[] }).layoutInteractions;
        return [...records].reverse().find(record => record.type === 'pointerdown' && record.stage === 'capture')?.pointer?.id;
      });
      assert.equal(typeof pointerId, 'number');
      await page.locator('.ui-canvas [data-component-id="snap_move"]').dispatchEvent('pointercancel', { pointerId, isPrimary: true });
    }
    else await openPage('layout_custom');
    await page.mouse.up(); await expect(guides()).toHaveCount(0); await expect(button('保存界面')).toBeDisabled();
    if (cancel === 'page') { await openPage('layout_snap'); await row('snap_move').click(); }
  }
  await button('智能吸附').click(); await expect(button('智能吸附')).toHaveAttribute('aria-pressed', 'false');
  const offBefore = await designState(); await beginDrag('snap_move', { x: 392, y: 40 }); await expect(guides()).toHaveCount(0); await page.mouse.up(); saved = await undoRedoSave(offBefore, original, 'layout_snap');
  near(saved.ui.customPages.find(p => p.id === 'layout_snap')!.components.find(c => c.id === 'snap_move')!.x, (160 + 392) / project.width);
  await button('智能吸附').click(); await page.getByLabel('画面缩放比例', { exact: true }).selectOption('50'); await row('snap_move').click(); const altBefore = await designState();
  await beginDrag('snap_move', { x: 392, y: 40 }); await page.keyboard.down('Alt'); await page.mouse.up(); await page.keyboard.up('Alt'); saved = await undoRedoSave(altBefore, original, 'layout_snap');
  near(saved.ui.customPages.find(p => p.id === 'layout_snap')!.components.find(c => c.id === 'snap_move')!.x, (160 + 392) / project.width);
  await button('智能吸附').click(); await expect(button('保存界面')).toBeDisabled(); await size(1280);
  record('智能吸附可关闭，或按住 Alt 松手自由放置；Escape、失焦、取消指针和切换页面均取消拖动并清除参考线，不产生修改。吸附开关不写入工程。');

  phase = 'nested geometry and protections'; await openPage('layout_nested');
  await row('parent').click(); await row('child').click({ modifiers: ['Control'] }); const nestedState = await designState(); await button('向右微调').click(); saved = await undoRedoSave(nestedState, original, 'layout_nested');
  const nestedBefore = original.ui.customPages.find(p => p.id === 'layout_nested')!.components, nestedAfter = saved.ui.customPages.find(p => p.id === 'layout_nested')!.components;
  assert.deepEqual(nestedAfter.find(c => c.id === 'child'), nestedBefore.find(c => c.id === 'child'));
  const beforeGeometry = resolveUiLayout(nestedBefore, project), afterGeometry = resolveUiLayout(nestedAfter, project);
  for (const id of ['parent', 'child']) near(afterGeometry.get(id)!.bounds.x - beforeGeometry.get(id)!.bounds.x, 1);
  await row('child').click(); const childBefore = await designState(); await button('水平居中').click(); saved = await undoRedoSave(childBefore, original, 'layout_nested');
  const centered = resolveUiLayout(saved.ui.customPages.find(p => p.id === 'layout_nested')!.components, project).get('child')!.bounds; near(centered.x + centered.width / 2, project.width / 2);
  await openPage('layout_restricted');
  for (const [id, reason] of [['locked', '锁定'], ['hidden', '隐藏'], ['future', '布局版本'], ['flow_child', '自动排列']] as const) {
    await row('unlocked').click(); await row(id).click({ modifiers: ['Control'] }); await expect(button('左对齐')).toBeDisabled(); if (id !== 'flow_child') await expect(button('向右微调')).toBeDisabled(); else await expect(button('向右微调')).toBeEnabled(); await expect(toolbar()).toContainText(reason); await expect(button('保存界面')).toBeDisabled();
  }
  await row('unlocked').click(); await row('locked').click({ modifiers: ['Control'] }); await row('locked').press('Delete'); await expect(row('locked')).toBeVisible(); await expect(row('unlocked')).toBeVisible(); await expect(button('保存界面')).toBeDisabled();
  if (await button('知道了').count()) await button('知道了').click();
  record('旋转父容器中的子控件仍精确居中；父子同选不重复偏移。锁定、隐藏、未知版本与自动排列控件均有明确禁用说明且不被部分修改。');

  phase = 'scheme capacity and scope reset'; await openPage('main'); await selectUiDesignScheme(page, 'limited_scheme'); await save(); await selectThree();
  await expect(button('向右微调')).toBeDisabled(); await expect(toolbar()).toContainText('未修改任何控件'); await page.getByLabel('界面设计画布', { exact: true }).focus(); await page.keyboard.press('ArrowRight'); await expect(button('保存界面')).toBeDisabled();
  saved = await read(); assert.deepEqual(saved.ui.instances, original.ui.instances); assert.deepEqual(saved.ui.components, original.ui.components);
  await selectUiDesignScheme(page, ''); await expect(selection()).toHaveAttribute('data-ui-selection-count', '0'); await save();
  await selectThree(); await openPage('save'); await expect(selection()).toHaveAttribute('data-ui-selection-count', '0'); await row('save_only').click(); await setUiCanvasPreview(page, '存读档预览页面', 'load'); await expect(selection()).toHaveAttribute('data-ui-selection-count', '0'); await expect(row('load_only')).toBeVisible(); await expect(row('save_only')).toHaveCount(0); await expect(button('保存界面')).toBeDisabled();
  record('继承方案覆盖名额不足时整组不动；切换方案、页面或存读档预览会清理旧多选，预览状态不写入工程。');

  phase = 'page options preserve legacy and reopen'; await openPage('layout_custom');
  const menu = await openUiPageOptions(page); await expect(menu.getByLabel('自定义页面名称')).toHaveValue('已有说明页面');
  await menu.getByRole('button', { name: '关闭页面选项', exact: true }).click(); await expect((await openUiPageSettings(page)).getByText('已有页面背景', { exact: true })).toBeVisible(); await openUiPageUsage(page); await expect(page.getByRole('dialog', { name: '页面使用位置', exact: true })).toBeVisible(); await button('关闭页面使用位置').click();
  await expect(button('页面选项')).toBeFocused(); await expect(button('保存界面')).toBeDisabled();
  await openUiPageOptions(page); await button('新建自定义页面').click(); const created = await page.getByLabel('设计页面', { exact: true }).inputValue(); assert.ok(!original.ui.customPages.some(p => p.id === created));
  await openUiPageOptions(page); await page.getByLabel('自定义页面名称', { exact: true }).fill('新说明页'); await button('关闭页面选项').click(); await save();
  await page.reload(); await expect(page.locator('.project-title strong')).toHaveText(project.name); await page.locator('[data-workspace-tab="ui"]').click(); await openPage(created); await expect(page.getByLabel('设计页面').locator('option:checked')).toHaveText('新说明页');
  await expect(button('智能吸附')).toHaveAttribute('aria-pressed', 'false'); await button('智能吸附').click(); await expect(button('保存界面')).toBeDisabled();
  saved = await read(); assert.deepEqual(saved.ui.customPages.filter(p => p.id !== created), original.ui.customPages); assert.deepEqual(saved.ui.components, original.ui.components);
  for (const graph of original.blueprints) assert.deepEqual(saved.blueprints.find(item => item.id === graph.id), graph);
  const addedGraphs = saved.blueprints.filter(graph => !original.blueprints.some(item => item.id === graph.id));
  assert.equal(addedGraphs.length, 1); assert.equal(addedGraphs[0].kind, 'ui'); assert.equal(addedGraphs[0].uiPageId, created);
  await openUiPageOptions(page); await button('删除自定义页面').click();
  const deletion = page.getByRole('dialog', { name: '删除页面及影响', exact: true });
  await expect(deletion).toBeVisible(); await expect(deletion).not.toContainText('撤销');
  // Element screenshots add a scroll/stability action even for an already
  // visible modal. Record and assert its real geometry before native capture,
  // so a stalled automation action cannot hide genuine layout oscillation.
  const deletionFrames = await deletion.evaluate(async element => {
    const samples = [];
    for (let frame = 0; frame < 8; frame++) {
      const rects = [element, ...element.querySelectorAll('footer button')].map(item => {
        const rect = item.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });
      samples.push({ time: performance.now(), rects });
      await new Promise<void>(resolve => setTimeout(resolve, 24));
    }
    return { samples, viewport: { width: innerWidth, height: innerHeight }, animations: element.getAnimations({ subtree: true }).map(animation => ({ playState: animation.playState, currentTime: animation.currentTime })) };
  });
  report.deletionDialogGeometry = deletionFrames;
  assert.equal(deletionFrames.samples[0].rects.length, 3, 'The confirmation and both action buttons must be present.');
  for (const frame of deletionFrames.samples) for (const [index, rect] of frame.rects.entries()) {
    assert.ok(rect.width > 0 && rect.height > 0 && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= deletionFrames.viewport.width + .1 && rect.y + rect.height <= deletionFrames.viewport.height + .1, 'Confirmation content must stay inside the viewport.');
    for (const key of ['x', 'y', 'width', 'height'] as const) near(rect[key], deletionFrames.samples[0].rects[index][key], .05);
  }
  const deletionPng = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(output, 'delete-page-confirmation.png'), Buffer.from(deletionPng, 'base64'));
  await button('取消').click(); await expect(button('保存界面')).toBeDisabled();
  record('页面名称统一在顶部切换；新建、重命名、删除确认与使用位置从页面选项可达。保存重开后旧背景、显示事件、控件和蓝图原样保留。');

  phase = 'toolbar docking and light theme'; await openPage('main'); await selectThree();
  await page.locator('[data-dock-panel="settings"] > header > strong').dragTo(page.locator('[data-dock-panel="hierarchy"] > header > strong'));
  await expect(page.locator('[data-dock-panel="settings"]')).toHaveAttribute('data-dock-slot', 'left'); await size(1024, 768);
  await page.getByRole('separator', { name: '调整左侧面板宽度', exact: true }).focus(); for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
  await snapshot('toolbar-docked-narrow'); await resetUiPanelLayout(page!); await expect(page.locator('[data-dock-panel="settings"]')).toHaveAttribute('data-dock-slot', 'bottom');
  await button('作品设置').click(); const settings = page.getByRole('dialog', { name: '作品设置', exact: true }); await settings.getByRole('button', { name: '编辑器外观', exact: true }).click(); await settings.locator('.editor-theme-card').filter({ has: page.locator('strong', { hasText: '亮白' }) }).click(); await settings.getByRole('button', { name: '完成', exact: true }).click(); await size(1280); await snapshot('layout-light');
  assert.deepEqual(errors, []); record('布局工具可随面板换位，最窄侧栏自动换行；恢复默认布局和浅色主题正常，renderer 无异常。'); report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.phase = phase; report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1;
  report.interactions = await page?.evaluate(() => (window as unknown as { layoutInteractions: unknown[] }).layoutInteractions).catch(() => undefined);
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); console.error(error);
} finally {
  try { await close(); } catch (error) { report.status = 'failed'; report.closeError = String(error); process.exitCode = 1; }
  try { await server?.close(); } catch (error) { report.status = 'failed'; report.serverError = String(error); process.exitCode = 1; }
  try {
    const after = sha256(await fs.readFile(sourceFile)); report.sourceSha256After = after;
    if (sourceHash !== undefined) assert.equal(after, sourceHash, 'Author project changed during isolated acceptance.');
  } catch (error) { report.status = 'failed'; report.sourceProtectionError = String(error); process.exitCode = 1; }
  try { if (app) throw new Error('The owned fixture is still running.'); report.cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []); } catch (error) { report.status = 'failed'; report.cleanupError = String(error); process.exitCode = 1; }
  await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
}
