import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { createProject, projectSchema, type BlueprintNode, type Project, type UiComponent } from '../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintNodeValuePins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { BLUEPRINT_MEMBER_MIME, type BlueprintMemberReference } from '../src/core/blueprint-member-access';
import { createUiEventGraph, createUiParameterBinding, ensureUiClickEvent } from '../src/core/ui-logic';
import { addUiAnimationTrack, createUiAnimationClip } from '../src/core/ui-animation-clips';
import { storyParametersId } from '../src/core/parameter-sets';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { fitBlueprintCanvas, setBlueprintOption } from './lib/blueprint-canvas';

// Pending desktop acceptance. Run only after all product changes and the unified
// build are complete. This script never opens an author project or old artifacts.
if (process.env.VNS_INSTALLED_EXE) throw new Error('事件图左栏验收只允许隔离的源码构建版。');
const root = path.resolve('.');
const artifactRoot = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/event-graph-left-sidebar-2026-11-12');
const relativeOutput = path.relative(root, artifactRoot);
assert.ok(relativeOutput && relativeOutput !== '..' && !relativeOutput.startsWith('..' + path.sep) && !path.isAbsolute(relativeOutput), '验收输出必须在当前 editor 工作区内。');
const output = path.join(artifactRoot, 'sidebar-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const fixtureDirectory = path.join(output, 'fixture'), profile = path.join(output, 'profile');
const projectFile = path.join(fixtureDirectory, 'project.vns.json'), shots = path.join(output, 'shots');
const ids = { page: 'sidebar_page_a', otherPage: 'sidebar_page_b', graph: 'sidebar_graph_a', otherGraph: 'sidebar_graph_b', sharedGraph: 'sidebar_shared_graph', button: 'sidebar_button', sharedButton: 'sidebar_shared_button', text: 'sidebar_text_0', variable: 'same_state', input: 'page_number', result: 'page_result', animation: 'sidebar_animation' };
const eventLayoutKey = 'vns-ui-logic-dock-v1';
let legacyBindingId = '';

function createFixture() {
  const project = createProject('事件图单左栏桌面验收'); project.id = 'event_graph_sidebar_acceptance';
  project.variables = [
    { id: 'sidebar_visible', name: '作品共享显隐', type: 'boolean', initial: true, persistent: false, parameterSetId: storyParametersId },
    { id: 'sidebar_opacity', name: '作品共享透明度', type: 'number', initial: .7, persistent: false, parameterSetId: storyParametersId },
  ];
  const controls: UiComponent[] = [
    { id: ids.button, name: '已有事件按钮', kind: 'button', page: 'custom', text: '已有事件', x: .05, y: .08, width: .3, height: .1, propertyControls: { visible: { mode: 'sync', parameterId: 'sidebar_visible' } } },
    { id: ids.sharedButton, name: '共用图回调按钮', kind: 'button', page: 'custom', text: '共用回调', x: .4, y: .08, width: .3, height: .1, events: { onClick: ids.sharedGraph } },
    ...Array.from({ length: 36 }, (_, index): UiComponent => ({ id: 'sidebar_text_' + index, name: `长目录文字 ${String(index + 1).padStart(2, '0')}`, kind: 'text', page: 'custom', text: '目录与详情独立滚动', x: .05 + index % 4 * .22, y: .25 + Math.floor(index / 4) * .065, width: .2, height: .05 })),
  ];
  project.ui.customPages = [
    { id: ids.page, name: '左栏验收页面甲', modal: true, components: controls },
    { id: ids.otherPage, name: '左栏验收页面乙', modal: true, components: [{ id: 'sidebar_other_text', name: '乙页独有控件', kind: 'text', page: 'custom', text: '另一个页面', x: .1, y: .1, width: .7, height: .2 }] },
  ];
  project.ui.pageVariables = {
    [ids.page]: [{ id: ids.variable, name: '同名状态', type: 'number', initial: 3, description: '页面甲，本次打开页面的状态。' }],
    [ids.otherPage]: [{ id: ids.variable, name: '同名状态', type: 'number', initial: 22, description: '页面乙，与页面甲有相同的成员 ID。' }],
  };
  project.ui.pageInterfaces = {
    [ids.page]: { version: 1, inputs: [{ id: ids.input, name: '打开时数值', direction: 'input', dataType: 'number', required: false, defaultValue: 0, description: '页面实例输入，与蓝图调用输入分开。' }], outputs: [{ id: ids.result, name: '完成时文字', direction: 'output', dataType: 'string', required: false, defaultValue: '' }] },
    [ids.otherPage]: { version: 1, inputs: [{ id: ids.input, name: '打开时数值', direction: 'input', dataType: 'number', required: false, defaultValue: 22 }], outputs: [] },
  };
  const graph = createUiEventGraph(project, ids.page, '左栏验收页面甲'); graph.id = ids.graph; graph.nodes[0].id = 'sidebar_show';
  graph.localVariables = [{ id: ids.variable, name: '同名状态', type: 'string', initial: '本次调用初始文字', description: '同 ID 的调用变量，与页面变量分开。' }];
  graph.exposedInputs = Array.from({ length: 4 }, (_, index) => ({ id: 'call_input_' + index, name: index ? '调用附加输入 ' + index : '调用数值', direction: 'input' as const, dataType: 'number' as const, required: false, defaultValue: 0 }));
  graph.exposedOutputs = [{ id: 'call_output', name: '调用完成标记', direction: 'output', dataType: 'boolean', required: false, defaultValue: false }];
  graph.description = '蓝图被调用时使用的输入输出与页面打开时使用的输入结果是两套接口。';
  const click = ensureUiClickEvent(project, graph, ids.button, ids.page); click.id = 'sidebar_click'; click.x = 60; click.y = 300;
  const setter = blueprintNodeDefaults('setUiProperty'); Object.assign(setter, { id: 'sidebar_setter', name: '验收透明度节点', x: 430, y: 300 });
  Object.assign(setter.properties, { componentId: ids.text, property: 'opacity', value: .8 }); graph.nodes.push(setter);
  synchronizeBlueprintNodeValuePins(project, graph, setter);
  const second = createUiEventGraph(project, ids.otherPage, '左栏验收页面乙'); second.id = ids.otherGraph; second.nodes[0].id = 'sidebar_other_show';
  second.localVariables = [{ id: ids.variable, name: '同名状态', type: 'string', initial: '乙页调用初始文字' }];
  const shared = createBlueprintGraph('function', '共用按钮回调'); shared.id = ids.sharedGraph; project.blueprints.push(shared);
  const caller = createBlueprintGraph('function', '调用接口影响见证'); caller.id = 'sidebar_caller';
  const call = blueprintNodeDefaults('callFunction'); call.id = 'sidebar_call'; Object.assign(call.properties, { graphId: graph.id, arg_call_input_0: 5 }); caller.nodes.push(call); project.blueprints.push(caller);
  const legacy = createUiParameterBinding(project, ids.button, 'opacity', 'sidebar_opacity', ids.page); legacyBindingId = legacy.id;
  const animation = createUiAnimationClip(project, ids.page); animation.id = ids.animation; animation.name = '左栏淡入动画'; animation.duration = 2;
  addUiAnimationTrack(animation, controls.find(component => component.id === ids.text)!, 'opacity');
  synchronizeBlueprintSignatures(project);
  assert.equal(connectBlueprintPins(graph, click.id, 'exec', setter.id, 'exec_in'), undefined);
  return projectSchema.parse(project);
}

const initial = createFixture();
let app: ElectronApplication | undefined, page: Page | undefined, failure: unknown, phase = '准备', traceRunning = false, launchNumber = 0;
const checks: { name: string; durationMs: number }[] = [], pageErrors: string[] = [], traces: string[] = [];
const processes: { pid?: number; exited: boolean }[] = [], temporaryNames: string[] = [];
const evidence: Record<string, unknown> = { layouts: [], scrolls: [], realDrags: [], details: [], migrations: [] };
const report: Record<string, unknown> = {
  status: 'running', renderer: 'compiled source editor', checks, pageErrors, traces, processes, evidence,
  temporaryPaths: [fixtureDirectory, profile],
  limits: ['只验证隔离的编辑器与工程保存，不启动游戏。', '真实成员拖放使用鼠标；布局迁移只写本轮新建 profile 的公开布局 key。', '600px 抽屉边界通过临时降低隔离窗口最小尺寸检查；正常窄窗按 1024px 验收。'],
};
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const workspace = () => page!.locator('.ui-event-workspace:visible');
const sidebar = () => workspace().locator('.ui-event-sidebar:visible');
const directory = () => sidebar().locator('.ui-event-directory-scroll');
const detailScroll = () => sidebar().locator('.ui-event-detail-scroll');
// React Activity retains previously visited form drafts; only visible details
// represent current authoring entry points and should participate in UI queries.
const detail = () => sidebar().locator('.ui-event-detail:visible');
const library = () => directory().locator('.ui-event-library');
const variables = () => library().getByRole('region', { name: '蓝图变量', exact: true });
const pageParameters = () => library().getByRole('region', { name: '页面输入与结果', exact: true });
const pageDirection = (direction: 'inputs' | 'outputs') => pageParameters().locator(`[data-page-parameter-direction="${direction}"]`);
const search = () => library().getByRole('textbox', { name: '搜索我的界面', exact: true });
const card = (id: string) => page!.locator(`.react-flow__node[data-id="${id}"]`);
const widthSeparator = () => workspace().getByRole('separator', { name: '调整事件图左栏宽度', exact: true });
const heightSeparator = () => workspace().getByRole('separator', { name: '调整目录与详情高度', exact: true });
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const graph = (project: Project, graphId = ids.graph) => { const found = project.blueprints.find(item => item.id === graphId); assert.ok(found, '缺少蓝图：' + graphId); return found; };
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const writeReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const settle = () => page!.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
async function fingerprints() {
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  const files = ['dist/index.html', 'dist-desktop/main.cjs', 'dist-desktop/preload.cjs', ...[...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => 'dist/' + match[1].slice(2))];
  assert.ok(files.some(file => file.startsWith('dist/assets/') && file.endsWith('.js')), '先完成统一构建，再运行桌面验收。');
  return Promise.all([...new Set(files)].map(async file => ({ file, sha256: hash(await fs.readFile(path.join(root, file))) })));
}
async function check(name: string, work: () => Promise<void>) {
  phase = name; const start = Date.now(); await work(); checks.push({ name, durationMs: Date.now() - start }); await writeReport(); console.log('通过：' + name);
}
async function size(width: number, height: number) {
  const window = await app!.browserWindow(page!);
  await window.evaluate((window, value) => { if (window.isMinimized()) window.restore(); if (window.isMaximized()) window.unmaximize(); window.setContentSize(value.width, value.height); window.show(); window.focus(); }, { width, height });
  await expect.poll(() => page!.evaluate(value => Math.max(Math.abs(innerWidth - value.width), Math.abs(innerHeight - value.height)), { width, height })).toBeLessThanOrEqual(2); await settle();
}
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile }); processes.push({ pid: app.process().pid, exited: false }); launchNumber++;
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => pageErrors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
  await expect(page.locator('.project-title strong')).toHaveText(initial.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html')); report.rendererUrl = page.url();
  await page.evaluate('globalThis.__name = value => value'); await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false }); traceRunning = true;
  await size(1600, 1000);
}
async function close() {
  if (!app) return;
  const owned = app, child = owned.process(), exited = () => child.exitCode !== null || child.signalCode !== null;
  let traceError: unknown;
  if (traceRunning && page) {
    const file = 'trace-' + String(launchNumber).padStart(2, '0') + '.zip';
    try { await page.context().tracing.stop({ path: path.join(output, file) }); traces.push(file); } catch (error) { traceError = error; report.traceError = String(error); }
    traceRunning = false;
  }
  try { await owned.close(); } finally {
    await expect.poll(exited, { timeout: 15000 }).toBe(true);
    const record = processes.find(item => item.pid === child.pid); if (record) record.exited = exited();
    if (exited()) { app = undefined; page = undefined; }
  }
  if (traceError) throw traceError;
}
async function screenshot(name: string) {
  await settle(); const image = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(shots, name + '.png'), Buffer.from(image, 'base64'));
}
async function openPage(pageId = ids.page, expand = true) {
  await page!.locator('[data-workspace-tab="ui"]').click();
  await page!.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '事件图', exact: true }).click();
  await page!.getByRole('combobox', { name: '事件图页面', exact: true }).selectOption(pageId);
  await expect(workspace()).toHaveCount(1);
  if (expand && await button('展开事件图左栏').isVisible()) await button('展开事件图左栏').click();
  if (expand && await sidebar().locator('.ui-event-directory-toggle').getAttribute('aria-expanded') === 'false') await sidebar().locator('.ui-event-directory-toggle').click();
  await settle();
}
async function chooseGraph(graphId = ids.graph) {
  await page!.getByRole('combobox', { name: '当前页面事件图', exact: true }).selectOption(graphId); await settle();
}
async function expectDetail(kind: string, key?: string) {
  await expect(detail()).toHaveCount(1); await expect(detail()).toHaveAttribute('data-detail-kind', kind);
  if (key) { await expect(detail()).toHaveAttribute('data-detail-id', key); await expect(sidebar().locator('.ui-event-detail-host')).toHaveAttribute('data-detail-key', key); }
  await expect(directory().locator('.blueprint-member-details:visible, .blueprint-member-draft:visible, .ui-parameter-bindings:visible')).toHaveCount(0);
  (evidence.details as unknown[]).push({ kind, key: await detail().getAttribute('data-detail-id') });
}
async function selectComponent(id = ids.button) {
  await search().fill(''); const row = library().locator(`[data-ui-component-id="${id}"]`); await row.click(); await expectDetail('component', 'component:' + id);
}
async function unfold(owner: Locator) {
  const toggle = owner.locator(':scope > .ui-library-heading .ui-library-toggle');
  if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
}
async function selectVariable(scope: 'page' | 'call' | 'project', id = ids.variable, pageId = ids.page) {
  await search().fill(''); await unfold(variables()); await variables().getByRole('combobox', { name: '状态列表作用域', exact: true }).selectOption(scope);
  if (scope === 'page') await variables().getByRole('combobox', { name: '状态所属页面', exact: true }).selectOption(pageId);
  await variables().locator(`[data-state-variable-id="${id}"]`).getByRole('button', { name: /^编辑变量 / }).click();
  const ownerId = scope === 'page' ? pageId : scope === 'call' ? await page!.getByLabel('当前页面事件图', { exact: true }).inputValue() : initial.id;
  await expectDetail('variable', `variable:${scope}:${ownerId}:${id}`);
}
async function selectPageParameter(direction: 'inputs' | 'outputs', id = direction === 'inputs' ? ids.input : ids.result) {
  await search().fill(''); await unfold(pageParameters());
  await pageDirection(direction).locator(`[data-page-parameter-id="${id}"]`).getByRole('button', { name: /^编辑页面/ }).click();
  const pageId = await page!.getByLabel('事件图页面', { exact: true }).inputValue();
  await expectDetail(direction === 'inputs' ? 'page-input' : 'page-output', `${direction === 'inputs' ? 'page-input' : 'page-output'}:${pageId}:${id}`);
}
async function graphSettings() { await search().fill(''); await library().getByRole('button', { name: '本图设置', exact: true }).click(); await expectDetail('graph'); }
async function saveUi() {
  if (await button('保存界面').isEnabled()) await button('保存界面').click();
  await expect(button('保存界面')).toBeDisabled(); await expect(page!.locator('.ui-save-status')).toHaveText('已保存', { timeout: 30000 });
  await settle(); return read();
}
async function assertBrowsingOnly(bytes: string) {
  await expect(button('保存界面')).toBeDisabled(); assert.equal(await fs.readFile(projectFile, 'utf8'), bytes);
}
async function canvasState() {
  return page!.locator('.react-flow').evaluate(element => {
    const viewport = element.querySelector('.react-flow__viewport'); assertViewport(viewport);
    function assertViewport(value: Element | null): asserts value is Element { if (!value) throw new Error('缺少事件图视口。'); }
    const matrix = new DOMMatrix(getComputedStyle(viewport).transform);
    return { selected: [...element.querySelectorAll('.react-flow__node.selected')].map(node => node.getAttribute('data-id')!).sort(), x: matrix.e, y: matrix.f, zoom: matrix.a };
  });
}
async function assertCanvasSame(before: Awaited<ReturnType<typeof canvasState>>) {
  let current = before;
  try { await expect.poll(async () => { current = await canvasState(); return JSON.stringify(current.selected) === JSON.stringify(before.selected) && Math.abs(current.x - before.x) <= 1 && Math.abs(current.y - before.y) <= 1 && Math.abs(current.zoom - before.zoom) < .005; }).toBe(true); }
  catch (error) { report.canvasMismatch = { before, current }; throw error; }
}
async function assertLayout(description: string) {
  await expect(sidebar()).toHaveCount(1); await expect(workspace().locator('[data-dock-slot="right"], [data-dock-slot="bottom"]')).toHaveCount(0);
  await expect(workspace().locator('.blueprint-property-tabs:visible')).toHaveCount(0);
  await expect(workspace().locator('.ui-event-canvas .ui-parameter-bindings:visible')).toHaveCount(0);
  const layout = await workspace().evaluate(element => {
    const side = element.querySelector('.ui-event-sidebar')!, canvas = element.querySelector('.ui-event-canvas')!;
    const a = side.getBoundingClientRect(), b = canvas.getBoundingClientRect();
    return { sidebar: a.toJSON(), canvas: b.toJSON(), width: element.clientWidth, scrollWidth: element.scrollWidth, sideWidth: side.clientWidth, sideScrollWidth: side.scrollWidth, overlay: element.getAttribute('data-sidebar-overlay') };
  });
  assert.ok(layout.scrollWidth <= layout.width + 1, description + ': 工作区横向溢出'); assert.ok(layout.sideScrollWidth <= layout.sideWidth + 1, description + ': 左栏横向溢出');
  if (layout.overlay !== 'true') { assert.ok(layout.sidebar.right <= layout.canvas.left + 2, description + ': 左栏必须在画布左边'); assert.ok(Math.abs(layout.sidebar.top - layout.canvas.top) <= 2 && Math.abs(layout.sidebar.bottom - layout.canvas.bottom) <= 2, description + ': 画布应使用左栏以外的完整高度'); }
  const content = await detailScroll().evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
  assert.ok(content.scrollWidth <= content.width + 1, description + ': 详情横向溢出');
  (evidence.layouts as unknown[]).push({ description, ...layout, detail: content });
}
async function wheel(owner: Locator, amount: number) {
  const bounds = await owner.boundingBox(); assert.ok(bounds); await page!.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page!.mouse.wheel(0, amount);
}
async function dragDivider(separator: Locator, dx: number, dy: number) {
  const bounds = await separator.boundingBox(); assert.ok(bounds); const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await page!.mouse.move(start.x, start.y); await page!.mouse.down(); await page!.mouse.move(start.x + dx, start.y + dy, { steps: 12 }); await page!.mouse.up(); await settle();
}
async function realMemberDrag(owner: Locator, id: string, modifier: 'Control' | 'Alt') {
  const target = owner.locator(`[data-blueprint-member-id="${id}"] .blueprint-member-select`); await target.scrollIntoViewIfNeeded(); await expect(target).toHaveAttribute('draggable', 'true');
  const bounds = await target.boundingBox(); assert.ok(bounds); const start = { x: bounds.x + Math.min(35, bounds.width / 2), y: bounds.y + bounds.height / 2 };
  const destination = await page!.locator('.flow-container').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    for (const fy of [.7, .35, .85, .2, .5]) for (const fx of [.65, .35, .8, .15, .5]) {
      const x = bounds.left + bounds.width * fx, y = bounds.top + bounds.height * fy;
      if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) return { x, y };
    }
  }); assert.ok(destination, '真实拖放需要未被节点覆盖的画布空白。');
  const hit = await target.evaluate((element, point) => { const hit = document.elementFromPoint(point.x, point.y); return !!hit && (hit === element || element.contains(hit)); }, start);
  assert.equal(hit, true, '鼠标必须从当前可见成员行开始。');
  await target.evaluate(element => {
    (window as unknown as { __sidebarDrag?: unknown }).__sidebarDrag = undefined;
    element.closest('#root')!.addEventListener('dragstart', event => {
      const drag = event as DragEvent, transfer = drag.dataTransfer;
      (window as unknown as { __sidebarDrag?: unknown }).__sidebarDrag = transfer ? { trusted: drag.isTrusted, types: [...transfer.types], raw: transfer.getData('application/vns-blueprint-member') } : undefined;
    }, { once: true });
  });
  const before = await page!.locator('.react-flow__node').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-id')!));
  await page!.keyboard.down(modifier);
  try { await page!.mouse.move(start.x, start.y); await page!.mouse.down(); await page!.mouse.move(start.x - 10, start.y + 2, { steps: 3 }); await page!.mouse.move(destination.x, destination.y, { steps: 16 }); await page!.mouse.up(); }
  finally { await page!.keyboard.up(modifier); }
  const drag = await page!.evaluate(() => (window as unknown as { __sidebarDrag?: { trusted: boolean; types: string[]; raw: string } }).__sidebarDrag);
  assert.ok(drag, '鼠标手势必须产生真实 dragstart。'); assert.equal(drag.trusted, true); assert.ok(drag.types.includes(BLUEPRINT_MEMBER_MIME));
  const reference = JSON.parse(drag.raw) as BlueprintMemberReference; assert.equal(reference.id, id); assert.equal(reference.projectId, initial.id);
  await expect(page!.getByRole('dialog', { name: '蓝图成员操作', exact: true })).toHaveCount(0);
  await expect.poll(async () => (await page!.locator('.react-flow__node').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-id')!))).filter(nodeId => !before.includes(nodeId)).length).toBe(1);
  const addedId = (await page!.locator('.react-flow__node').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-id')!))).find(nodeId => !before.includes(nodeId)); assert.ok(addedId);
  (evidence.realDrags as unknown[]).push({ reference, modifier, trusted: true, start, destination, addedId }); return { reference, addedId };
}
async function theme(name: string, id: string) {
  await button('作品设置').click(); const dialog = page!.getByRole('dialog', { name: '作品设置', exact: true }); await dialog.getByRole('button', { name: '编辑器外观', exact: true }).click();
  await dialog.getByRole('group', { name: '编辑器配色', exact: true }).getByRole('button', { name: new RegExp('^' + name) }).click();
  await expect(page!.locator('html')).toHaveAttribute('data-editor-theme', id); await dialog.getByRole('button', { name: '完成', exact: true }).click(); await settle();
}

await fs.mkdir(artifactRoot, { recursive: true }); await fs.mkdir(output); await fs.mkdir(shots);
try {
  report.fingerprintsBefore = await fingerprints();
  await fs.mkdir(fixtureDirectory); temporaryNames.push('fixture'); await fs.mkdir(profile); temporaryNames.push('profile');
  await saveProject(projectFile, initial); await launch(); await openPage(); await chooseGraph();
  await check('单一左栏使用唯一详情，右栏与底部绑定不再占用画布', async () => {
    await graphSettings(); await assertLayout('1600px 初始布局'); await expect(widthSeparator()).toHaveAttribute('aria-valuenow', '340'); await expect(heightSeparator()).toHaveAttribute('aria-valuenow', '32');
    await expect(detail().getByRole('region', { name: '调用输入', exact: true })).toBeVisible(); await expect(detail().getByRole('region', { name: '调用输出', exact: true })).toBeVisible();
    await expect(pageParameters()).toHaveCount(1); await expect(variables()).toHaveCount(1); await screenshot('01-single-sidebar');
    await saveUi();
  });
  await check('目录选择与画布选择独立，控件事件定位重复操作不创建节点', async () => {
    const bytes = await fs.readFile(projectFile, 'utf8'), beforeCount = graph(await read()).nodes.length;
    await fitBlueprintCanvas(page!); await card('sidebar_setter').locator('.graph-node-title strong').click(); await expectDetail('node', `node:${ids.graph}:sidebar_setter`);
    const selection = await canvasState(); await selectComponent(); await assertCanvasSame(selection);
    await expect(detail().getByRole('button', { name: '点击时', exact: true })).toHaveText('定位 →');
    await detail().getByRole('button', { name: '点击时', exact: true }).click(); await expectDetail('node', `node:${ids.graph}:sidebar_click`); await expect(card('sidebar_click')).toHaveClass(/selected/);
    await selectComponent(); await detail().getByRole('button', { name: '点击时', exact: true }).click(); await expectDetail('node', `node:${ids.graph}:sidebar_click`);
    assert.equal(graph(await read()).nodes.length, beforeCount); await assertBrowsingOnly(bytes); await screenshot('02-locate-existing-event');
  });
  await check('同名同ID的页面、调用及其他页面变量保持实际所有者', async () => {
    const bytes = await fs.readFile(projectFile, 'utf8');
    await selectVariable('page'); await expect(detail().getByRole('spinbutton', { name: '状态初始值 同名状态', exact: true })).toHaveValue('3');
    await selectVariable('call'); await expect(detail().getByRole('textbox', { name: '状态初始值 同名状态', exact: true })).toHaveValue('本次调用初始文字');
    await openPage(ids.otherPage); await chooseGraph(ids.otherGraph); await selectVariable('page', ids.variable, ids.otherPage); await expect(detail().getByRole('spinbutton', { name: '状态初始值 同名状态', exact: true })).toHaveValue('22');
    await openPage(); await chooseGraph(); await selectVariable('page'); await expect(detail().getByRole('spinbutton', { name: '状态初始值 同名状态', exact: true })).toHaveValue('3');
    await assertBrowsingOnly(bytes);
  });
  await check('统一目录搜索保持详情与输入焦点，页面输入结果和调用接口区分', async () => {
    const bytes = await fs.readFile(projectFile, 'utf8'); await selectPageParameter('inputs');
    await expect(detail().getByRole('spinbutton', { name: '打开时数值 · 默认值', exact: true })).toHaveValue('0');
    const key = await detail().getAttribute('data-detail-id'); await search().fill('长目录文字 01'); await expect(search()).toBeFocused(); await expectDetail('page-input', key!);
    await expect(library().locator('[data-ui-component-id]')).toHaveCount(1); await expect(pageDirection('inputs').locator('[data-page-parameter-id]')).toHaveCount(0);
    await search().fill('不存在的目录成员'); await expect(search()).toBeFocused(); await expectDetail('page-input', key!); await search().fill('');
    await selectPageParameter('outputs'); await expect(detail().getByRole('textbox', { name: '完成时文字 · 默认值', exact: true })).toHaveValue('');
    await graphSettings(); await expect(detail().getByRole('region', { name: '调用输入', exact: true })).toBeVisible(); await expect(detail().getByRole('region', { name: '调用输出', exact: true })).toBeVisible();
    await assertBrowsingOnly(bytes); await screenshot('03-call-interface-distinction');
  });
  await check('新建变量移入详情，取消、搜索和整栏折叠保留草稿且不写数据', async () => {
    const bytes = await fs.readFile(projectFile, 'utf8'); await selectVariable('page'); const previous = await detail().getAttribute('data-detail-id');
    await variables().getByRole('button', { name: '新建变量', exact: true }).click(); await expectDetail('variable', `variable:page:${ids.page}:new`);
    const form = detail().getByRole('form', { name: '创建状态变量', exact: true }); const name = form.getByRole('textbox', { name: '变量名称', exact: true });
    await expect(name).toBeFocused(); await expect(form.getByRole('button', { name: '创建变量', exact: true })).toBeDisabled(); await name.fill('尚未创建的变量草稿');
    await search().fill('不存在'); await expect(name).toHaveValue('尚未创建的变量草稿'); await search().fill('');
    await button('收起事件图左栏').click(); await expect(sidebar()).toHaveCount(0); await expect(button('展开事件图左栏')).toBeFocused();
    await button('展开事件图左栏').click(); await expect(name).toHaveValue('尚未创建的变量草稿'); await expectDetail('variable', `variable:page:${ids.page}:new`);
    await form.getByRole('button', { name: '取消', exact: true }).click(); await expectDetail('variable', previous!);
    await expect(sidebar().getByRole('form', { name: '创建状态变量', exact: true })).toHaveCount(0); await assertBrowsingOnly(bytes);
  });
  await check('新建调用变量的未确认草稿跨事件图恢复，不提前创建定义', async () => {
    const bytes = await fs.readFile(projectFile, 'utf8'), draftName = '跨事件图保留的未创建变量'; await selectVariable('call');
    await variables().getByRole('button', { name: '新建变量', exact: true }).click(); await expectDetail('variable', `variable:call:${ids.graph}:new`);
    const form = () => detail().getByRole('form', { name: '创建状态变量', exact: true });
    await form().getByRole('textbox', { name: '变量名称', exact: true }).fill(draftName);
    await form().getByRole('combobox', { name: '变量类型', exact: true }).click();
    await page!.getByRole('listbox', { name: '变量类型选项', exact: true }).getByRole('option', { name: '数值', exact: true }).click();
    await form().getByRole('spinbutton', { name: '变量初始值', exact: true }).fill('41'); await form().getByRole('spinbutton', { name: '变量初始值', exact: true }).press('Tab');
    await expect(form().getByRole('button', { name: '创建变量', exact: true })).toBeEnabled(); await assertBrowsingOnly(bytes);
    await chooseGraph(ids.sharedGraph); await expect(page!.getByLabel('当前页面事件图', { exact: true })).toHaveValue(ids.sharedGraph);
    await expect(sidebar().getByRole('form', { name: '创建状态变量', exact: true })).toHaveCount(0);
    await expect(variables().getByRole('button', { name: '编辑变量 ' + draftName, exact: true })).toHaveCount(0); await assertBrowsingOnly(bytes);
    await chooseGraph(); await search().fill(''); await unfold(variables());
    const scope = variables().getByRole('combobox', { name: '状态列表作用域', exact: true }); if (await scope.inputValue() !== 'call') await scope.selectOption('call');
    // Returning to a graph can show its settings first; reopen its retained form.
    if (!await form().isVisible()) await variables().getByRole('button', { name: '新建变量', exact: true }).click();
    await expectDetail('variable', `variable:call:${ids.graph}:new`);
    await expect(form().getByRole('textbox', { name: '变量名称', exact: true })).toHaveValue(draftName);
    await expect(form().getByRole('combobox', { name: '变量类型', exact: true })).toContainText('数值');
    await expect(form().getByRole('spinbutton', { name: '变量初始值', exact: true })).toHaveValue('41');
    await expect(form().getByRole('button', { name: '创建变量', exact: true })).toBeEnabled();
    await expect(variables().getByRole('button', { name: '编辑变量 ' + draftName, exact: true })).toHaveCount(0); await assertBrowsingOnly(bytes);
    await form().getByRole('button', { name: '取消', exact: true }).click(); await expect(sidebar().getByRole('form', { name: '创建状态变量', exact: true })).toHaveCount(0);
    assert.ok(!graph(await read()).localVariables?.some(variable => variable.name === draftName)); await assertBrowsingOnly(bytes);
  });
  await check('页面输入和结果新建在详情中取消，不遗留空定义', async () => {
    const bytes = await fs.readFile(projectFile, 'utf8'); await selectPageParameter('inputs');
    for (const direction of ['inputs', 'outputs'] as const) {
      await pageDirection(direction).getByRole('button', { name: '新增', exact: true }).click(); await expectDetail(direction === 'inputs' ? 'page-input' : 'page-output');
      const form = detail().getByRole('form', { name: '创建页面参数', exact: true }); await expect(form.getByRole('textbox', { name: '页面参数名称', exact: true })).toBeFocused();
      await form.getByRole('textbox', { name: '页面参数名称', exact: true }).fill('应该取消的参数'); await form.getByRole('textbox', { name: '页面参数名称', exact: true }).press('Escape');
      await expect(sidebar().getByRole('form', { name: '创建页面参数', exact: true })).toHaveCount(0);
    }
    await assertBrowsingOnly(bytes);
  });
  await check('共享参数定义保留受保护入口，属性关联和页面设置只有一份', async () => {
    const bytes = await fs.readFile(projectFile, 'utf8'); await selectVariable('project', 'sidebar_visible');
    await expect(detail()).toContainText('所有使用位置共用'); await expect(detail().getByRole('textbox', { name: /^状态名称 / })).toHaveCount(0);
    await selectComponent(); await detail().getByRole('button', { name: '属性关联', exact: true }).click(); await expectDetail('bindings', 'bindings');
    await expect(detail().getByRole('combobox', { name: '联动组件', exact: true })).toHaveValue(ids.button);
    await detail().getByRole('combobox', { name: '联动属性', exact: true }).selectOption('visible'); await expect(detail().getByRole('combobox', { name: '属性控制方式', exact: true })).toHaveValue('sync');
    await expect(detail().getByRole('combobox', { name: '联动参数', exact: true })).toHaveValue('sidebar_visible');
    await library().getByRole('button', { name: '页面设置', exact: true }).click(); await expectDetail('page-settings', 'page-settings');
    await detail().getByRole('button', { name: '页面使用位置', exact: true }).click(); const dialog = page!.getByRole('dialog', { name: '页面使用位置', exact: true }); await expect(dialog).toBeVisible(); await dialog.getByRole('button', { name: '关闭页面使用位置', exact: true }).click();
    await assertBrowsingOnly(bytes); await screenshot('04-page-settings-entry');
  });
  await check('属性关联切换本图设置后保留本地控件和未应用表单', async () => {
    const bytes = await fs.readFile(projectFile, 'utf8'); await selectComponent(ids.button);
    await detail().getByRole('button', { name: '属性关联', exact: true }).click(); await expectDetail('bindings', 'bindings');
    await detail().getByRole('combobox', { name: '联动组件', exact: true }).selectOption(ids.sharedButton);
    await detail().getByRole('combobox', { name: '联动属性', exact: true }).selectOption('visible');
    await detail().getByRole('combobox', { name: '属性控制方式', exact: true }).selectOption('follow');
    await detail().getByRole('combobox', { name: '联动参数', exact: true }).selectOption('sidebar_visible');
    await expect(detail().getByRole('button', { name: '应用关联', exact: true })).toBeEnabled(); await graphSettings();
    await library().getByRole('button', { name: '属性关联', exact: true }).click(); await expectDetail('bindings', 'bindings');
    await expect(detail().getByRole('combobox', { name: '联动组件', exact: true })).toHaveValue(ids.sharedButton);
    await expect(detail().getByRole('combobox', { name: '联动属性', exact: true })).toHaveValue('visible');
    await expect(detail().getByRole('combobox', { name: '属性控制方式', exact: true })).toHaveValue('follow');
    await expect(detail().getByRole('combobox', { name: '联动参数', exact: true })).toHaveValue('sidebar_visible');
    await expect(detail().getByRole('button', { name: '应用关联', exact: true })).toBeEnabled(); await assertBrowsingOnly(bytes);
    // Discard the uncommitted B form by returning the binding editor to A.
    await detail().getByRole('combobox', { name: '联动组件', exact: true }).selectOption(ids.button);
    await expect(detail().getByRole('combobox', { name: '属性控制方式', exact: true })).toHaveValue('sync'); await assertBrowsingOnly(bytes);
  });
  await check('调用接口的变更影响仍可取消，页面定义与调用实参保持原值', async () => {
    const bytes = await fs.readFile(projectFile, 'utf8'); await graphSettings();
    const input = detail().getByRole('region', { name: '调用输入', exact: true }); await input.getByRole('combobox', { name: '调用数值的数据类型', exact: true }).click();
    const options = page!.getByRole('listbox', { name: '调用数值的数据类型选项', exact: true }); await options.getByRole('option', { name: '开关', exact: true }).click();
    const impact = page!.getByRole('dialog', { name: '确认接口修改', exact: true }); await expect(impact).toBeVisible(); await expect(impact).toContainText('直接调用或绑定'); await impact.getByRole('button', { name: '取消', exact: true }).click();
    await expect(input.getByRole('combobox', { name: '调用数值的数据类型', exact: true })).toContainText('数值');
    assert.equal(graph(await read(), 'sidebar_caller').nodes.find(node => node.id === 'sidebar_call')?.properties.arg_call_input_0, 5); await assertBrowsingOnly(bytes);
  });
  await check('目录与长详情独立滚动，画布不变且详情滚动按对象恢复', async () => {
    const bytes = await fs.readFile(projectFile, 'utf8'); await graphSettings();
    const graphOptions = detail().locator('.blueprint-graph-settings'); await graphOptions.locator(':scope > summary').click();
    await heightSeparator().focus(); await heightSeparator().press('End'); await expect(heightSeparator()).toHaveAttribute('aria-valuenow', '70');
    await expect.poll(() => directory().evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100);
    await expect.poll(() => detailScroll().evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100);
    const beforeCanvas = await canvasState(), initialDetail = await detailScroll().evaluate(element => element.scrollTop);
    await wheel(directory(), 420); await expect.poll(() => directory().evaluate(element => element.scrollTop)).toBeGreaterThan(100);
    assert.equal(await detailScroll().evaluate(element => element.scrollTop), initialDetail); await assertCanvasSame(beforeCanvas);
    const directoryTop = await directory().evaluate(element => element.scrollTop); await wheel(detailScroll(), 460); await expect.poll(() => detailScroll().evaluate(element => element.scrollTop)).toBeGreaterThan(initialDetail + 80);
    assert.equal(await directory().evaluate(element => element.scrollTop), directoryTop); await assertCanvasSame(beforeCanvas);
    const graphScroll = await detailScroll().evaluate(element => element.scrollTop); await selectComponent(); await graphSettings();
    await expect.poll(() => detailScroll().evaluate(element => Math.round(element.scrollTop))).toBe(Math.round(graphScroll));
    (evidence.scrolls as unknown[]).push({ directoryTop, graphScroll, canvas: beforeCanvas }); await screenshot('05-independent-scroll');
    await button('恢复默认事件图布局').click(); await expect(heightSeparator()).toHaveAttribute('aria-valuenow', '32'); await assertBrowsingOnly(bytes);
  });
  await check('两个分隔条可真实拖动，键盘与折叠恢复只改变布局', async () => {
    const bytes = await fs.readFile(projectFile, 'utf8'); await graphSettings(); await dragDivider(widthSeparator(), 76, 0);
    await expect.poll(async () => Number(await widthSeparator().getAttribute('aria-valuenow'))).toBeGreaterThan(390);
    const width = Number(await widthSeparator().getAttribute('aria-valuenow')); await widthSeparator().focus(); await widthSeparator().press('ArrowLeft'); await expect(widthSeparator()).toHaveAttribute('aria-valuenow', String(width - 8));
    await dragDivider(heightSeparator(), 0, 90); await expect.poll(async () => Number(await heightSeparator().getAttribute('aria-valuenow'))).toBeGreaterThan(38);
    const directoryToggle = sidebar().locator('.ui-event-directory-toggle'), key = await detail().getAttribute('data-detail-id');
    await directoryToggle.click(); await expect(directoryToggle).toHaveAttribute('aria-expanded', 'false'); await expect(directory()).toBeHidden(); await expectDetail('graph', key!); await expect(heightSeparator()).toBeHidden();
    await directoryToggle.click(); await expect(directoryToggle).toHaveAttribute('aria-expanded', 'true'); await expect(directory()).toBeVisible();
    const before = (await workspace().locator('.ui-event-canvas').boundingBox())!;
    await button('收起事件图左栏').click(); await expect(sidebar()).toHaveCount(0); await expect.poll(async () => (await workspace().locator('.ui-event-canvas').boundingBox())!.width).toBeGreaterThan(before.width + 200);
    await button('展开事件图左栏').click(); await expectDetail('graph', key!); await expect(widthSeparator()).toHaveAttribute('aria-valuenow', String(width - 8)); await assertLayout('拖动折叠恢复');
    await button('恢复默认事件图布局').click(); await expect(widthSeparator()).toHaveAttribute('aria-valuenow', '340'); await expect(heightSeparator()).toHaveAttribute('aria-valuenow', '32'); await assertBrowsingOnly(bytes);
  });
  await check('1024窄窗的暗亮主题与280px详情均可操作且无横向溢出', async () => {
    await size(1024, 800); await widthSeparator().focus(); await widthSeparator().press('Home'); await expect(widthSeparator()).toHaveAttribute('aria-valuenow', '280');
    for (const [name, id] of [['黑白', 'codexDark'], ['亮白', 'codexLight']] as const) {
      await theme(name, id); await selectVariable('page'); await variables().getByRole('button', { name: '新建变量', exact: true }).click();
      await expectDetail('variable', `variable:page:${ids.page}:new`); await assertLayout('1024px-280px-' + id);
      const form = detail().getByRole('form', { name: '创建状态变量', exact: true }); await expect(form.getByRole('button', { name: '取消', exact: true })).toBeVisible(); await expect(form.getByRole('button', { name: '创建变量', exact: true })).toBeVisible();
      await screenshot('06-narrow-variable-' + id); await form.getByRole('button', { name: '取消', exact: true }).click();
      await selectPageParameter('inputs'); await assertLayout('1024px-page-input-' + id); await screenshot('07-narrow-page-input-' + id);
    }
    await expect.poll(() => page!.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await size(1600, 1000);
  });
  await check('更窄工作区使用临时抽屉，Escape返回画布并保留未提交表单', async () => {
    await selectVariable('page'); await variables().getByRole('button', { name: '新建变量', exact: true }).click();
    const name = detail().getByRole('textbox', { name: '变量名称', exact: true }); await name.fill('抽屉内的未创建变量');
    const window = await app!.browserWindow(page!); await window.evaluate(window => window.setMinimumSize(480, 540));
    try {
      await size(600, 700); await expect(sidebar()).toHaveCount(0); await button('展开事件图左栏').click(); await expect(workspace()).toHaveAttribute('data-sidebar-overlay', 'true');
      await expect(name).toHaveValue('抽屉内的未创建变量'); await assertLayout('600px临时抽屉'); await screenshot('08-sidebar-drawer');
      // The form consumes its own Escape to cancel. Escape from the panel's
      // close control checks the outer drawer without changing that form.
      await button('收起事件图左栏').focus(); await button('收起事件图左栏').press('Escape'); await expect(sidebar()).toHaveCount(0); await expect(button('展开事件图左栏')).toBeFocused();
      await button('展开事件图左栏').click(); await expect(name).toHaveValue('抽屉内的未创建变量');
    } finally { await size(1600, 1000); await window.evaluate(window => window.setMinimumSize(1024, 680)); }
    await detail().getByRole('form', { name: '创建状态变量', exact: true }).getByRole('button', { name: '取消', exact: true }).click(); await button('恢复默认事件图布局').click();
  });
  await check('未保存变量与动画详情在旧事件定位后进入返回仍保留，可撤销重做', async () => {
    const beforeDisk = await fs.readFile(projectFile, 'utf8'); await selectVariable('page');
    const value = detail().getByRole('spinbutton', { name: '状态初始值 同名状态', exact: true }); await value.fill('17'); await value.press('Tab'); await expect(button('保存界面')).toBeEnabled();
    assert.equal(await fs.readFile(projectFile, 'utf8'), beforeDisk);
    await selectComponent(); await detail().getByRole('button', { name: '点击时', exact: true }).click(); await expectDetail('node', `node:${ids.graph}:sidebar_click`); await expect(card('sidebar_click')).toHaveClass(/selected/);
    await expect.poll(() => page!.locator('.react-flow__viewport').evaluate(async viewport => {
      const transform = getComputedStyle(viewport).transform;
      for (let frame = 0; frame < 4; frame++) { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); if (!viewport.isConnected || getComputedStyle(viewport).transform !== transform) return false; }
      return true;
    })).toBe(true); const beforeCanvas = await canvasState();
    const animationRow = library().locator(`[data-ui-animation-id="${ids.animation}"]`).getByRole('button', { name: '左栏淡入动画', exact: true }); await animationRow.click(); await expectDetail('animation', 'animation:' + ids.animation);
    await expect(page!.locator('.ui-animation-editor')).toHaveCount(0); const directoryTop = await directory().evaluate(element => element.scrollTop);
    await detail().getByRole('button', { name: '编辑关键帧', exact: true }).click(); await expect(page!.locator('.ui-animation-editor')).toBeVisible(); await expect(page!.getByRole('textbox', { name: '界面动画名称', exact: true })).toHaveValue('左栏淡入动画');
    await button('返回事件图').click(); await settle(); await expectDetail('animation', 'animation:' + ids.animation); await assertCanvasSame(beforeCanvas); await expect.poll(() => directory().evaluate(element => Math.round(element.scrollTop))).toBe(Math.round(directoryTop));
    await settle(); await expectDetail('animation', 'animation:' + ids.animation);
    await animationRow.dblclick(); await expect(page!.locator('.ui-animation-editor')).toBeVisible(); await button('返回事件图').click(); await settle(); await expectDetail('animation', 'animation:' + ids.animation); await assertCanvasSame(beforeCanvas);
    await selectVariable('page'); await expect(value).toHaveValue('17'); await button('撤销').click(); await expect(value).toHaveValue('3'); await button('重做').click(); await expect(value).toHaveValue('17');
    assert.equal(await fs.readFile(projectFile, 'utf8'), beforeDisk); const saved = await saveUi(); assert.equal(saved.ui.pageVariables?.[ids.page].find(item => item.id === ids.variable)?.initial, 17); await screenshot('09-animation-return-and-draft');
  });
  await check('真实拖放页面与调用变量、输入和结果，节点保留成员范围和类型', async () => {
    await setBlueprintOption(page!, '自动接线', false); const added: { id: string; type: BlueprintNode['type']; property: string; scope?: 'page' | 'call'; dataType: string }[] = [];
    for (const scope of ['page', 'call'] as const) {
      await selectVariable(scope); const drag = await realMemberDrag(variables(), ids.variable, 'Control'); assert.equal(drag.reference.kind, 'variable'); assert.equal('scope' in drag.reference && drag.reference.scope, scope);
      added.push({ id: drag.addedId, type: 'getVariable', property: 'variableId', scope, dataType: scope === 'page' ? 'number' : 'string' });
    }
    await selectPageParameter('inputs'); const inputDrag = await realMemberDrag(pageDirection('inputs'), ids.input, 'Control'); added.push({ id: inputDrag.addedId, type: 'getPageInput', property: 'parameterId', dataType: 'number' });
    await selectPageParameter('outputs'); const resultDrag = await realMemberDrag(pageDirection('outputs'), ids.result, 'Alt'); added.push({ id: resultDrag.addedId, type: 'setPageOutput', property: 'parameterId', dataType: 'string' });
    const saved = await saveUi();
    for (const item of added) {
      const node = graph(saved).nodes.find(node => node.id === item.id); assert.ok(node); assert.equal(node.type, item.type); assert.equal(node.pins.find(pin => pin.id === 'value')?.dataType, item.dataType);
      assert.equal(node.properties[item.property], item.scope ? ids.variable : item.type === 'getPageInput' ? ids.input : ids.result);
      if (item.scope) assert.equal(node.properties.scope, item.scope);
      if (item.scope === 'page' || !item.scope) assert.equal(node.properties.pageId, ids.page);
    }
    assert.equal(saved.ui.pageVariables?.[ids.page][0].initial, 17); assert.equal(graph(saved).localVariables?.[0].initial, '本次调用初始文字'); await screenshot('10-real-member-drags');
  });
  await check('共用图上下文明确，新控件事件仍写回当前页面的自有事件图', async () => {
    const sharedBefore = graph(await read(), ids.sharedGraph); await chooseGraph(ids.sharedGraph); await expect(page!.locator('.ui-event-notice')).toContainText('共用蓝图');
    await selectComponent(ids.sharedButton); await expect(detail().getByRole('button', { name: '悬停时', exact: true })).toHaveText('＋ 添加');
    await detail().getByRole('button', { name: '悬停时', exact: true }).click(); await expect(page!.getByLabel('当前页面事件图', { exact: true })).toHaveValue(ids.graph); await expectDetail('node');
    const saved = await saveUi(); assert.deepEqual(graph(saved, ids.sharedGraph), sharedBefore);
    const event = graph(saved).nodes.find(node => node.type === 'eventButton' && node.properties.componentId === ids.sharedButton && node.properties.trigger === 'hover'); assert.ok(event); assert.equal(graph(saved).uiPageId, ids.page);
    await selectComponent(ids.sharedButton); await expect(detail().getByRole('button', { name: '悬停时', exact: true })).toHaveText('定位 →'); const beforeCount = graph(saved).nodes.length;
    await detail().getByRole('button', { name: '悬停时', exact: true }).click(); await expectDetail('node', `node:${ids.graph}:${event.id}`); assert.equal(graph(await saveUi()).nodes.length, beforeCount);
  });
  await check('旧自动联动仍可定位和显式转换，转换前后可撤销重做', async () => {
    await selectComponent(); await detail().getByRole('button', { name: '属性关联', exact: true }).click(); await expectDetail('bindings', 'bindings');
    await detail().getByRole('combobox', { name: '联动属性', exact: true }).selectOption('opacity');
    const legacy = detail().locator(`[data-binding-graph="${legacyBindingId}"]`); await expect(legacy).toContainText('旧自动联动'); await legacy.getByRole('button', { name: '打开蓝图', exact: true }).click();
    await expect(page!.getByLabel('当前页面事件图', { exact: true })).toHaveValue(legacyBindingId); await expectDetail('graph', 'graph:' + legacyBindingId); await chooseGraph();
    await selectComponent(); await detail().getByRole('button', { name: '属性关联', exact: true }).click(); await detail().getByRole('combobox', { name: '联动属性', exact: true }).selectOption('opacity');
    await detail().getByRole('combobox', { name: '属性控制方式', exact: true }).selectOption('follow'); await detail().getByRole('combobox', { name: '联动参数', exact: true }).selectOption('sidebar_opacity');
    await detail().getByRole('button', { name: '应用关联', exact: true }).click(); await expect(detail().locator(`[data-binding-graph="${legacyBindingId}"]`)).toHaveCount(0);
    await expect(detail().getByRole('combobox', { name: '属性控制方式', exact: true })).toHaveValue('follow');
    await button('撤销').click(); await expect(detail().locator(`[data-binding-graph="${legacyBindingId}"]`)).toHaveCount(1); await button('重做').click(); await expect(detail().locator(`[data-binding-graph="${legacyBindingId}"]`)).toHaveCount(0);
    const saved = await saveUi(); assert.deepEqual(saved.ui.customPages.find(item => item.id === ids.page)?.components.find(item => item.id === ids.button)?.propertyControls?.opacity, { mode: 'follow', parameterId: 'sidebar_opacity' });
    assert.ok(!saved.blueprints.some(item => item.id === legacyBindingId)); await screenshot('11-legacy-binding-converted');
  });
  await check('保存重开保留工程与折叠尺寸，布局浏览不改工程', async () => {
    await graphSettings(); await widthSeparator().focus(); await widthSeparator().press('Home');
    for (let index = 0; index < 14; index++) await widthSeparator().press('ArrowRight');
    await expect(widthSeparator()).toHaveAttribute('aria-valuenow', '392'); await heightSeparator().focus(); await heightSeparator().press('Home');
    for (let index = 0; index < 15; index++) await heightSeparator().press('ArrowDown');
    await expect(heightSeparator()).toHaveAttribute('aria-valuenow', '46'); await sidebar().locator('.ui-event-directory-toggle').click(); await button('收起事件图左栏').click();
    await expect.poll(() => page!.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}'), eventLayoutKey)).toEqual({ sidebarWidth: 392, directoryRatio: 46, sidebarCollapsed: true, directoryCollapsed: true, eventSidebarVersion: 1 });
    const saved = await read(); await fs.copyFile(projectFile, path.join(output, 'saved-project.json')); await close(); await launch(); await openPage(ids.page, false);
    await expect(sidebar()).toHaveCount(0); await button('展开事件图左栏').click(); await expect(sidebar().locator('.ui-event-directory-toggle')).toHaveAttribute('aria-expanded', 'false'); await expect(widthSeparator()).toHaveAttribute('aria-valuenow', '392');
    await sidebar().locator('.ui-event-directory-toggle').click(); await expect(heightSeparator()).toHaveAttribute('aria-valuenow', '46'); await selectVariable('page'); await expect(detail().getByRole('spinbutton', { name: '状态初始值 同名状态', exact: true })).toHaveValue('17');
    await selectVariable('call'); await expect(detail().getByRole('textbox', { name: '状态初始值 同名状态', exact: true })).toHaveValue('本次调用初始文字'); assert.deepEqual(await read(), saved); await screenshot('12-saved-and-reopened');
  });
  await check('旧四槽偏好迁移为403px单栏，设计与时间轴偏好保持原样', async () => {
    const bytes = await fs.readFile(projectFile, 'utf8');
    const old = { left: 20, right: 28, top: 51, panels: { left: 'hierarchy', top: 'settings', bottom: 'canvas', right: 'inspector' } };
    const untouched = {
      'vns-ui-dock-v1': JSON.stringify({ left: 19, right: 27, top: 67, panels: { left: 'hierarchy', top: 'canvas', bottom: 'settings', right: 'inspector' } }),
      'vns-performance-dock-v1': JSON.stringify({ left: 21, right: 25, top: 59, panels: { left: 'library', top: 'preview', bottom: 'timeline', right: 'inspector' } }),
    };
    await page!.evaluate(({ key, old, untouched }) => { for (const [name, value] of Object.entries(untouched)) localStorage.setItem(name, value); localStorage.setItem(key, JSON.stringify(old)); }, { key: eventLayoutKey, old, untouched });
    await page!.reload(); await expect(page!.locator('.project-title strong')).toHaveText(initial.name, { timeout: 45000 }); await page!.evaluate('globalThis.__name = value => value'); await openPage(); await chooseGraph();
    await expect(widthSeparator()).toHaveAttribute('aria-valuenow', '403'); await expect(heightSeparator()).toHaveAttribute('aria-valuenow', '32'); await expect(sidebar().locator('.ui-event-directory-toggle')).toHaveAttribute('aria-expanded', 'true');
    const expected = { sidebarWidth: 403, directoryRatio: 32, sidebarCollapsed: false, directoryCollapsed: false, eventSidebarVersion: 1 };
    await expect.poll(() => page!.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}'), eventLayoutKey)).toEqual(expected);
    const preserved = await page!.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), Object.keys(untouched)); assert.deepEqual(preserved, untouched);
    (evidence.migrations as unknown[]).push({ old, migrated: expected, untouched: preserved }); await graphSettings(); await assertLayout('四槽偏好迁移'); await assertBrowsingOnly(bytes); await screenshot('13-legacy-layout-migrated');
  });
  assert.equal(checks.length, 20); assert.deepEqual(pageErrors, []); report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = error instanceof Error ? error.stack : String(error);
  if (app && page) { await screenshot('failure').catch(error => { report.screenshotError = String(error); }); report.failureWindow = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ bounds: window.getBounds(), content: window.getContentBounds(), minimized: window.isMinimized(), maximized: window.isMaximized(), focused: window.isFocused() }))).catch(() => undefined); }
} finally {
  await close().catch(error => { failure ??= error; report.status = 'failed'; report.closeError = String(error); });
  try { report.fingerprintsAfter = await fingerprints(); assert.deepEqual(report.fingerprintsAfter, report.fingerprintsBefore); }
  catch (error) { failure ??= error; report.status = 'failed'; report.buildIntegrityError = String(error); }
  await writeReport();
  if (!app && processes.every(item => item.exited)) {
    try {
      const cleanup = await cleanVerificationDirectories(output, temporaryNames); report.cleanup = cleanup; assert.deepEqual(cleanup.errors, []);
      await Promise.all(cleanup.removed.map(target => assert.rejects(fs.stat(target), { code: 'ENOENT' })));
    } catch (error) { failure ??= error; report.status = 'failed'; report.cleanupError = String(error); }
  } else { failure ??= new Error('本轮隔离进程仍未退出。'); report.status = 'failed'; report.cleanupSkipped = 'Owned fixture process is still running'; }
  await writeReport(); console.log(output);
}
if (failure) throw failure;
