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

// Execute only after the complete implementation has been built. All input is
// self-contained except the read-only author-project hash; no Vite or game runs.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Use the isolated compiled development editor.');
const root = path.resolve('.');
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/ui-distribution-2026-11-11',
  'distribution-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const relativeOutput = path.relative(root, output);
if (!relativeOutput || relativeOutput === '..' || relativeOutput.startsWith('..' + path.sep) || path.isAbsolute(relativeOutput)) {
  throw new Error('The new acceptance run must be inside this workspace.');
}
const profile = path.join(output, 'profile'), projectFile = path.join(output, 'project/project.vns.json');
const sourceFile = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? '../我的视觉小说1/project.vns.json');
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const project = createProject('界面等距分布验收');
project.id = 'ui_distribution_acceptance'; project.width = 1920; project.height = 1080;
project.resourceSettings = { importMode: 'copy', directory: 'assets', syncFolders: false };
project.ui.pages = { main: { layout: 'custom' } };
const component = (id: string, x: number, y: number, width: number, height: number, patch: Partial<UiComponent> = {}): UiComponent => ({
  id, name: id, text: id, page: 'custom', kind: 'button', x: x / project.width, y: y / project.height,
  width: width / project.width, height: height / project.height,
  style: { background: '#375d69', textColor: '#f5f7f7', fontSize: 24 }, ...patch,
});
// These are the author's exact world rectangles, independently reproduced in a
// tiny fixture. Do not copy or load the author's project into the editor.
project.ui.components = [
  component('cover', 1597.5477715439943, 50.91756720843354, 101.952, 101.952, { page: 'main', name: '封面', text: '封面' }),
  component('settings', 1690, 50, 102, 102, { page: 'main', name: '设置', text: '设置' }),
  component('quit', 1795, 50, 102, 102, { page: 'main', name: '退出', text: '退出' }),
];
const horizontal = (prefix: string) => [
  component(prefix + '_a', 200, 250, 100, 90), component(prefix + '_b', 450, 260, 120, 90), component(prefix + '_c', 1000, 240, 140, 90),
];
const endpoints = horizontal('end');
endpoints[0].x = 120 / project.width; endpoints[0].propertyControls = { x: { mode: 'follow', parameterId: 'endpoint_left' } };
endpoints[2].x = 950 / project.width; endpoints[2].propertyControls = { x: { mode: 'sync', parameterId: 'endpoint_right' } };
const middle = horizontal('bound');
middle[1].x = 350 / project.width; middle[1].name = '参数控制的中项';
middle[1].propertyControls = { x: { mode: 'follow', parameterId: 'middle_x' } };
project.variables = [
  { id: 'endpoint_left', name: '左端横向位置', type: 'number', initial: 200 / project.width, persistent: false },
  { id: 'endpoint_right', name: '右端横向位置', type: 'number', initial: 1000 / project.width, persistent: false },
  { id: 'middle_x', name: '中项横向位置', type: 'number', initial: 450 / project.width, persistent: false },
];
project.ui.customPages = [
  { id: 'positive_x', name: '水平正间距', modal: true, components: horizontal('h') },
  { id: 'positive_y', name: '垂直正间距', modal: true, components: [
    component('v_a', 300, 180, 100, 80), component('v_b', 310, 400, 100, 100), component('v_c', 290, 900, 100, 120),
  ] },
  { id: 'same_axis', name: '完全等宽同轴', modal: true, components: [
    component('same_a', 200, 450, 90, 90), component('same_b', 600, 450, 90, 90), component('same_c', 1000, 450, 90, 90),
  ] },
  { id: 'bound_endpoints', name: '端点关联参数', modal: true, components: endpoints },
  { id: 'bound_middle', name: '中项关联参数', modal: true, components: middle },
  { id: 'automatic', name: '父容器自动排列', modal: true, components: [
    component('auto_parent', 200, 200, 1200, 400, { kind: 'panel', layout: { version: 1, flow: 'horizontal', gap: 30 } }),
    ...['a', 'b', 'c'].map((suffix, index) => component('auto_' + suffix, 0, 0, 180, 120, {
      parentId: 'auto_parent', x: index * .05, y: .15, width: .15, height: .3,
    })),
  ] },
];

type Rect = { x: number; y: number; width: number; height: number };
type State = { id: string; x: number; y: number; width: number; height: number }[];
const fields = ['x', 'y', 'width', 'height'] as const;
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'setup', failure: unknown;
let sourceHash: string | undefined, savedBytes = '';
const checks: { name: string; durationMs: number }[] = [], errors: string[] = [];
const processes: { pid?: number; exited: boolean; forced?: boolean }[] = [];
const evidence: Record<string, unknown> = {};
const report: Record<string, unknown> = { status: 'running', renderer: 'compiled', checks, errors, processes, evidence,
  sourceFile, temporaryPaths: [path.dirname(projectFile), profile] };
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const canvas = () => page!.locator('.ui-canvas');
const area = () => page!.getByLabel('界面设计画布', { exact: true });
const toolbar = () => page!.getByLabel('控件布局工具栏', { exact: true });
const status = () => toolbar().getByRole('status');
const row = (id: string) => page!.locator(`[data-hierarchy-id="${id}"]`).locator('.ui-hierarchy-caption');
const action = (axis: 'x' | 'y') => button(axis === 'x' ? '水平等距' : '垂直等距');
const wrapper = (axis: 'x' | 'y') => toolbar().locator('.ui-distribution-action').filter({ has: action(axis) });
const selected = () => canvas().locator('.ui-component.selected').evaluateAll(elements => elements.map(element => element.getAttribute('data-component-id')!).sort());
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const settle = async () => page!.evaluate(async () => {
  await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
});
const box = async (target: Locator): Promise<Rect> => {
  const rect = await target.boundingBox(); assert.ok(rect && rect.width > 0 && rect.height > 0, 'Expected a rendered rectangle.'); return rect;
};
const near = (actual: number, expected: number, tolerance = .001) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);
};
async function size(width: number, height: number) {
  await app!.evaluate(({ BrowserWindow }, dimensions) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window.isMinimized()) window.restore(); if (window.isMaximized()) window.unmaximize();
    window.setContentSize(dimensions.width, dimensions.height); window.webContents.setBackgroundThrottling(false);
  }, { width, height });
  // Windows fractional display scaling can round a requested DIP size by 1 px.
  await expect.poll(() => page!.evaluate(requested => Math.max(Math.abs(innerWidth - requested.width), Math.abs(innerHeight - requested.height)), { width, height })).toBeLessThanOrEqual(1);
  await settle();
}
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile, devUrl: '' });
  processes.push({ pid: app.process().pid, exited: false }); page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html'));
  report.rendererUrl = page.url(); await page.evaluate('globalThis.__name = value => value');
  await size(1600, 1000); await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '设计', exact: true }).click();
  await openPage('main');
}
async function close() {
  if (!app) return;
  const owned = app, child = owned.process(), exited = () => child.exitCode !== null || child.signalCode !== null;
  const record = processes.find(item => item.pid === child.pid)!;
  let closeError: unknown;
  try { await owned.close(); await expect.poll(exited, { timeout: 15000 }).toBe(true); }
  catch (error) {
    closeError = error;
    if (!exited()) { record.forced = true; child.kill(); }
    await expect.poll(exited, { timeout: 15000 }).toBe(true);
  } finally {
    record.exited = exited(); if (record.exited) { app = undefined; page = undefined; }
  }
  if (closeError) throw closeError;
}
async function screenshot(name: string) {
  await settle();
  const data = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(data, 'base64'));
}
async function check(name: string, work: () => Promise<void>) {
  phase = name; const started = Date.now(); await work(); checks.push({ name, durationMs: Date.now() - started });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log('通过：' + name);
}
async function openPage(id: string) {
  await page!.getByLabel('设计页面', { exact: true }).selectOption(id);
  await expect(toolbar()).toBeVisible(); await expect(page!.locator('[data-ui-marquee]')).toHaveCount(0);
  await page!.getByLabel('画面缩放比例', { exact: true }).selectOption('50'); await settle();
}
async function expectSelection(ids: string[]) {
  await expect.poll(selected).toEqual([...ids].sort());
  await expect(page!.locator('[data-ui-selection-count]')).toHaveAttribute('data-ui-selection-count', String(ids.length));
}
async function select(ids: string[]) {
  for (const [index, id] of ids.entries()) await row(id).click(index ? { modifiers: ['Control'] } : {});
  await expectSelection(ids); await settle();
}
async function state(): Promise<State> {
  return canvas().evaluate((element, viewport) => {
    const surface = element.getBoundingClientRect(), sx = surface.width / viewport.width, sy = surface.height / viewport.height;
    return [...element.querySelectorAll<HTMLElement>('[data-component-id]')].map(control => {
      const rect = control.getBoundingClientRect();
      return { id: control.dataset.componentId!, x: (rect.x - surface.x) / sx, y: (rect.y - surface.y) / sy,
        width: rect.width / sx, height: rect.height / sy };
    });
  }, { width: project.width, height: project.height });
}
async function expectState(expected: State, tolerance = .001) {
  await expect(async () => {
    const actual = await state(); assert.deepEqual(actual.map(item => item.id), expected.map(item => item.id));
    expected.forEach((item, index) => fields.forEach(field => near(actual[index][field], item[field], tolerance)));
  }).toPass({ timeout: 5000 });
}
async function expectOnlyMiddleMoves(before: State, id: string, axis: 'x' | 'y', expectedPosition: number) {
  await expect(async () => {
    const after = await state(); assert.deepEqual(after.map(item => item.id), before.map(item => item.id));
    before.forEach((item, index) => fields.forEach(field => {
      near(after[index][field], item.id === id && field === axis ? expectedPosition : item[field], item.id === id && field === axis ? .08 : .001);
    }));
    assert.ok(Math.abs(after.find(item => item.id === id)![axis] - before.find(item => item.id === id)![axis]) > 1,
      'The middle control must actually move.');
  }).toPass({ timeout: 5000 });
}
async function unchanged() {
  await expect(button('保存界面')).toBeDisabled(); assert.equal(await fs.readFile(projectFile, 'utf8'), savedBytes);
}
async function save() {
  await expect(button('保存界面')).toBeEnabled(); await button('保存界面').click();
  await expect(page!.locator('.ui-save-status')).toHaveAttribute('data-dirty', 'false');
  await expect(button('保存界面')).toBeDisabled(); savedBytes = await fs.readFile(projectFile, 'utf8'); return read();
}
async function stablePointerHelp(axis: 'x' | 'y', reason: RegExp, focus = false) {
  const target = wrapper(axis), before = await box(action(axis));
  await expect(target).toHaveAttribute('title', reason); await expect(action(axis)).toHaveAttribute('title', reason);
  await target.hover(); await settle();
  if (focus) {
    await expect(target).toHaveAttribute('tabindex', '0'); await expect(target).toHaveAttribute('role', 'group');
    await expect(target).toHaveAttribute('aria-label', reason);
    await target.focus(); await expect(target).toBeFocused(); await settle();
  }
  const after = await box(action(axis)); fields.forEach(field => near(after[field], before[field]));
}
async function theme(name: '黑白' | '亮白', id: 'codexDark' | 'codexLight') {
  await button('作品设置').click(); const dialog = page!.getByRole('dialog', { name: '作品设置', exact: true });
  await dialog.getByRole('button', { name: '编辑器外观', exact: true }).click();
  await dialog.getByRole('group', { name: '编辑器配色', exact: true }).getByRole('button', { name: new RegExp('^' + name) }).click();
  await expect(page!.locator('html')).toHaveAttribute('data-editor-theme', id);
  await dialog.getByRole('button', { name: '完成', exact: true }).click(); await settle();
}

try {
  await fs.mkdir(output, { recursive: true });
  sourceHash = sha256(await fs.readFile(sourceFile)); report.sourceSha256Before = sourceHash;
  const rendererIndex = path.join(root, 'dist/index.html');
  report.rendererIndexSha256 = sha256(await fs.readFile(rendererIndex)); await fs.access(path.join(root, 'dist-desktop/main.cjs'));
  await saveProject(projectFile, projectSchema.parse(project)); savedBytes = await fs.readFile(projectFile, 'utf8');
  const original = await read(); evidence.fixtureSha256Before = sha256(savedBytes); await launch();

  await check('真实拖框选择作者三个按钮，负间距可点击且只移动中项；幂等、一次撤销重做与保存重开', async () => {
    await expectSelection([]);
    // Camera-only scrolling keeps the right-hand buttons visible even if the
    // user's window decorations or saved dock widths leave less than 960 px.
    await area().evaluate(element => { element.scrollLeft = element.scrollWidth - element.clientWidth; element.scrollTop = 0; }); await settle();
    const before = await state(), surface = await box(canvas());
    const point = (x: number, y: number) => ({ x: surface.x + x / project.width * surface.width, y: surface.y + y / project.height * surface.height });
    const from = point(1560, 20), to = point(1910, 180), view = await box(area());
    for (const value of [from, to]) assert.ok(value.x > view.x && value.x < view.x + view.width && value.y > view.y && value.y < view.y + view.height,
      'Both real marquee endpoints must be inside the visible canvas viewport.');
    await page!.mouse.move(from.x, from.y); await page!.mouse.down(); await page!.mouse.move(to.x, to.y, { steps: 8 }); await settle();
    await expect(page!.locator('[data-ui-marquee]')).toHaveCount(1); await expectState(before); await screenshot('01-author-marquee');
    await page!.mouse.up(); await expect(page!.locator('[data-ui-marquee]')).toHaveCount(0); await expectSelection(['cover', 'settings', 'quit']);
    await expect(action('x')).toBeEnabled(); await expect(status()).toContainText(/水平等距[\s\S]*重叠 3\.25 px/);
    await expect(status()).toContainText('垂直等距'); await unchanged(); await stablePointerHelp('x', /重叠 3\.25 px/);
    // Independent geometric oracle: midpoint between the fixed outer edges,
    // accounting for the two endpoint widths; do not call the product planner.
    const expectedX = 1696.2498857719972;
    // Legacy root controls paint at integer game pixels; saved coordinates stay precise.
    await action('x').click(); await expectOnlyMiddleMoves(before, 'settings', 'x', Math.floor(expectedX + .5));
    const arranged = await state(); await screenshot('02-author-distributed');
    await action('x').click(); await expect(status()).toHaveText('无需调整');
    await expectState(arranged); assert.equal(await fs.readFile(projectFile, 'utf8'), savedBytes, 'Draft edits must not write before save.');
    await button('撤销').click(); await expectState(before); await unchanged();
    await button('重做').click(); await expectState(arranged); const saved = await save();
    for (const authored of original.ui.components) {
      const actual = saved.ui.components.find(item => item.id === authored.id)!;
      if (authored.id === 'settings') {
        near(actual.x * project.width, expectedX, 1e-9); assert.deepEqual({ ...actual, x: authored.x }, authored);
      } else assert.deepEqual(actual, authored, 'Both endpoint models must remain exact.');
    }
    assert.deepEqual(saved.ui.customPages, original.ui.customPages); assert.deepEqual(saved.variables, original.variables);
    evidence.author = { before, arranged, expectedMiddleX: expectedX, signedGap: -3.2498857719972, savedSha256: sha256(savedBytes) };
    await close(); await launch(); await expectSelection([]); await expectState(arranged); await unchanged();
    await screenshot('03-author-reopened');
  });

  await check('水平正间距保持两端与尺寸，只改中项横向位置', async () => {
    await openPage('positive_x'); await select(['h_a', 'h_b', 'h_c']); const before = await state();
    await expect(action('x')).toBeEnabled(); await expect(status()).toContainText(/水平等距[\s\S]*间距 290 px/);
    await action('x').click(); await expectOnlyMiddleMoves(before, 'h_b', 'x', 590);
    evidence.positiveHorizontal = { before, after: await state(), expectedMiddleX: 590 };
    await button('撤销').click(); await expectState(before); await unchanged();
  });

  await check('垂直正间距保持两端与尺寸，只改中项纵向位置', async () => {
    await openPage('positive_y'); await select(['v_a', 'v_b', 'v_c']); const before = await state();
    await expect(action('y')).toBeEnabled(); await expect(status()).toContainText(/垂直等距[\s\S]*间距 270 px/);
    await action('y').click(); await expectOnlyMiddleMoves(before, 'v_b', 'y', 530);
    evidence.positiveVertical = { before, after: await state(), expectedMiddleY: 530 };
    await button('撤销').click(); await expectState(before); await unchanged();
  });

  await check('完全等宽且纵向同轴的三个按钮允许垂直等距，无需调整不新增编辑', async () => {
    await openPage('same_axis'); await select(['same_a', 'same_b', 'same_c']); const before = await state();
    await expect(action('y')).toBeEnabled(); await expect(status()).toContainText(/垂直等距[\s\S]*重叠 90 px/);
    await action('y').click(); await expect(status()).toHaveText('无需调整'); await expectState(before); await unchanged();
  });

  await check('仅选两项时禁用，常驻说明及可悬停、聚焦的外层解释至少三项，按钮位置稳定', async () => {
    await select(['same_a', 'same_b']); const before = await state();
    await expect(status()).toContainText(/至少\s*3/);
    for (const axis of ['x', 'y'] as const) {
      await expect(action(axis)).toBeDisabled(); await stablePointerHelp(axis, /至少\s*3/, true);
    }
    await expectState(before); await unchanged(); await screenshot('04-two-selected-reason');
  });

  await check('两端横向位置关联参数仍可分布，中项移动且端点原始值、关联和参数初值精确保留', async () => {
    await openPage('bound_endpoints'); await select(['end_a', 'end_b', 'end_c']); const before = await state();
    near(before.find(item => item.id === 'end_a')!.x, 200, .08); near(before.find(item => item.id === 'end_c')!.x, 1000, .08);
    await expect(action('x')).toBeEnabled(); await action('x').click(); await expectOnlyMiddleMoves(before, 'end_b', 'x', 590);
    const saved = await save(), previous = original.ui.customPages.find(item => item.id === 'bound_endpoints')!;
    const actual = saved.ui.customPages.find(item => item.id === 'bound_endpoints')!;
    for (const authored of previous.components) {
      const control = actual.components.find(item => item.id === authored.id)!;
      if (authored.id === 'end_b') { near(control.x * project.width, 590, 1e-9); assert.deepEqual({ ...control, x: authored.x }, authored); }
      else assert.deepEqual(control, authored, 'Parameter-bound endpoints must not receive the displayed position as their authored value.');
    }
    assert.deepEqual(saved.variables, original.variables);
    evidence.boundEndpoints = { before, after: await state(), saved: actual.components, parameters: saved.variables };
  });

  await check('中项横向位置关联参数时禁用并显示来源原因，不修改控件或参数', async () => {
    await openPage('bound_middle'); await select(['bound_a', 'bound_b', 'bound_c']); const before = await state();
    near(before.find(item => item.id === 'bound_b')!.x, 450, .08);
    await expect(action('x')).toBeDisabled(); await expect(status()).toContainText('关联参数');
    await expect(status()).toContainText('参数控制的中项'); await stablePointerHelp('x', /关联参数/, true);
    await expectState(before); await unchanged(); await screenshot('05-parameter-reason');
    const saved = await read(); assert.deepEqual(saved.ui.customPages.find(item => item.id === 'bound_middle'), original.ui.customPages.find(item => item.id === 'bound_middle'));
    assert.deepEqual(saved.variables, original.variables);
  });

  await check('自动排列父容器中的三项继续禁用等距并解释父容器来源', async () => {
    await openPage('automatic'); await select(['auto_a', 'auto_b', 'auto_c']); const before = await state();
    for (const axis of ['x', 'y'] as const) {
      await expect(action(axis)).toBeDisabled(); await stablePointerHelp(axis, /父容器自动排列/, true);
    }
    await expect(status()).toContainText('父容器自动排列'); await expectState(before); await unchanged(); await screenshot('06-automatic-reason');
  });

  await check('明暗主题及1024像素窄窗口中禁用说明与布局按钮无横向溢出', async () => {
    await openPage('bound_middle'); await select(['bound_a', 'bound_b', 'bound_c']);
    const layouts: unknown[] = [];
    for (const [name, id] of [['黑白', 'codexDark'], ['亮白', 'codexLight']] as const) {
      await theme(name, id);
      for (const dimensions of [[1600, 1000], [1024, 768]]) {
        await size(dimensions[0], dimensions[1]); await expect(status()).toContainText('关联参数');
        const result = await toolbar().evaluate(element => {
          const outer = element.getBoundingClientRect(), help = element.querySelector<HTMLElement>('[role="status"]')!, helpBox = help.getBoundingClientRect();
          const range = document.createRange(); range.selectNodeContents(help);
          return { toolbar: { left: outer.left, right: outer.right, width: outer.width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth },
            controls: [...element.querySelectorAll('button,input,select')].map(control => { const rect = control.getBoundingClientRect();
              return { label: control.getAttribute('aria-label'), left: rect.left, right: rect.right, width: rect.width, height: rect.height }; }),
            textFits: [...range.getClientRects()].every(rect => rect.left >= helpBox.left - 1 && rect.right <= helpBox.right + 1),
            viewport: { width: innerWidth, height: innerHeight },
            documentFits: document.documentElement.scrollWidth <= innerWidth + 1 };
        });
        assert.ok(result.toolbar.scrollWidth <= result.toolbar.clientWidth + 1, 'Toolbar must not overflow horizontally.');
        assert.ok(result.documentFits && result.textFits, 'Document and wrapped explanation must fit.');
        assert.deepEqual(result.controls.filter(control => control.width < 28 || control.height < 28 || control.left < result.toolbar.left - 1 || control.right > result.toolbar.right + 1), [],
          'All layout buttons and fields must fit inside the toolbar.');
        await stablePointerHelp('x', /关联参数/, true); await unchanged(); layouts.push({ theme: id, dimensions, ...result });
        if (dimensions[0] === 1024) await screenshot('07-' + id + '-narrow');
      }
      await size(1600, 1000);
    }
    evidence.layouts = layouts;
  });

  assert.equal(checks.length, 9); assert.deepEqual(errors, [], 'Renderer must not raise runtime errors.');
  evidence.fixtureSha256After = sha256(savedBytes); report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = String(error);
  if (app && page && !page.isClosed()) {
    report.selectedAtFailure = await selected().catch(() => undefined); report.geometryAtFailure = await state().catch(() => undefined);
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
