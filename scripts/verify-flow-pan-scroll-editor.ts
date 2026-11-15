import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { projectSchema, type Project, type UiComponent } from '../src/core/model';
import { projectToText } from '../src/core/text-script';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { createPlayerFlowModesFixture } from './lib/player-flow-modes-fixture';

// Run after the unified compiled build. This acceptance never builds the editor.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Use the isolated compiled source editor.');
const root = path.resolve('.');
const outputRoot = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/flow-pan-module-performance-2026-11-13/flow');
const relativeOutputRoot = path.relative(root, outputRoot);
assert.ok(relativeOutputRoot === '' || (!path.isAbsolute(relativeOutputRoot) && relativeOutputRoot !== '..' && !relativeOutputRoot.startsWith('..' + path.sep)),
  'VNS_ARTIFACT_ROOT must resolve inside this checkout.');
const runId = `editor-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`;
const output = path.join(outputRoot, runId);
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

type Point = { x: number; y: number };
type Matrix = [number, number, number, number, number, number];
type Affine = { a: number; b: number; c: number; d: number; originX: number; originY: number; width: number; height: number };
type TransformCase = {
  id: string;
  label: string;
  canvasScale: 50 | 100;
  graphZoom: 90 | 100 | 110;
  parentLayout?: NonNullable<UiComponent['layout']>;
  componentLayout?: NonNullable<UiComponent['layout']>;
};

const flowId = 'flow_pan_target';
const historyId = 'flow_pan_history';
const parentId = 'flow_pan_parent';
const transformCases: TransformCase[] = [
  { id: 'ordinary', label: '普通画布', canvasScale: 100, graphZoom: 100 },
  { id: 'parent-rotation', label: '父级旋转 90 度', canvasScale: 50, graphZoom: 110,
    parentLayout: { version: 1, pivotX: .5, pivotY: .5, rotation: 90, scaleX: 1, scaleY: 1 } },
  { id: 'nonuniform-scale', label: '控件非均匀缩放', canvasScale: 100, graphZoom: 90,
    componentLayout: { version: 1, pivotX: .5, pivotY: .5, rotation: 0, scaleX: 1.4, scaleY: .72 } },
  { id: 'mirror-offset-pivot', label: '镜像与非中心轴心', canvasScale: 50, graphZoom: 110,
    componentLayout: { version: 1, pivotX: .2, pivotY: .76, rotation: -8, scaleX: -1.05, scaleY: .82 } },
  { id: 'composed-shear', label: '父级非均匀缩放与子级旋转组合 shear', canvasScale: 100, graphZoom: 100,
    parentLayout: { version: 1, pivotX: .5, pivotY: .5, rotation: 25, scaleX: 1.45, scaleY: .66 },
    componentLayout: { version: 1, pivotX: .3, pivotY: .72, rotation: -17, scaleX: 1.1, scaleY: .85 } },
];

const fixturePaths = transformCases.map(item => ({
  id: item.id,
  fixture: path.join(output, `fixture-${item.id}`),
  profile: path.join(output, `profile-${item.id}`),
}));
const historyFixture = path.join(output, 'fixture-history-scrollbar');
const historyProfile = path.join(output, 'profile-history-scrollbar');
const temporaryPaths = [...fixturePaths.flatMap(item => [item.fixture, item.profile]), historyFixture, historyProfile];

const checks: { name: string; durationMs: number }[] = [];
const errors: string[] = [];
const traces: string[] = [];
const processes: { label: string; pid?: number; exited: boolean }[] = [];
const evidence: Record<string, unknown> = { flowCases: [], historyScrollbar: {} };
const report: Record<string, unknown> = {
  status: 'running', renderer: 'compiled-source', runId, checks, errors, traces, processes, evidence, temporaryPaths,
  outputDirectory: output,
  limits: [
    '剧情、控件、布局与历史文本全部由本脚本新建；不打开或读取真实作品。',
    '中键拖动、滚动条轨道和滑块、键盘及取消均通过 Electron 中的真实 Playwright 鼠标／键盘输入。',
    '仅只读查询 DOM 布局矩阵、滚动数值和命中目标；不注入产品 pointer handler 或伪造 pointer 事件。',
    '报告、截图、trace、fixture 与 profile 均保留；fixture/profile 的精确路径列在 temporaryPaths，由主线程统一清理。',
    '在同一 compiled build 上记录运行前后指纹；本脚本不编译、不启动原生游戏。',
  ],
};

let app: ElectronApplication | undefined;
let page: Page | undefined;
let activeTracePath = '';
let traceRunning = false;
let failure: unknown;
let phase = '准备';
let launchNumber = 0;

const button = (name: string) => page!.getByRole('button', { name, exact: true });
const component = (id: string) => page!.locator(`[data-component-id="${id}"]`);
const flowViewport = (id: string) => component(id).locator('.ui-story-flow-preview');
const scrollbar = (id: string, axis: 'horizontal' | 'vertical') => component(id).locator(`[data-flow-scrollbar="${axis}"]`);
const projectFrom = (fixture: ReturnType<typeof createPlayerFlowModesFixture>) => structuredClone(fixture.project);
const settle = () => page!.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });

async function assertMousePathInWindow(label: string, points: Point[]) {
  const bounds = await page!.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  for (const point of points) {
    assert.ok(point.x >= 0 && point.y >= 0 && point.x < bounds.width && point.y < bounds.height,
      `${label} must remain inside the Electron window: ${JSON.stringify({ point, bounds })}`);
  }
}

function flowProject(item: TransformCase): Project {
  const fixture = createPlayerFlowModesFixture();
  const project = projectFrom(fixture);
  project.name = `剧情图平移与滚动验收 · ${item.id}`;
  project.width = 1920;
  project.height = 1080;
  project.ui.pages = { ...project.ui.pages, flowchart: { layout: 'custom', background: '#17201f' } };
  const positions = [
    { x: 120, y: 90 }, { x: 1260, y: 130 }, { x: 2470, y: 170 },
    { x: 300, y: 1160 }, { x: 1480, y: 1570 }, { x: 2790, y: 1910 },
  ];
  const entries = fixture.entries.map((entry, index) => ({
    nodeId: entry.id,
    owner: entry.owner,
    name: entry.name,
  }));
  const custom = {
    entries,
    positions: Object.fromEntries(entries.map((entry, index) => [entry.nodeId, positions[index % positions.length]])),
  };
  const compact = item.canvasScale === 100;
  const hasParent = !!item.parentLayout;
  const flow: UiComponent = {
    id: flowId,
    name: `平移验收图 · ${item.label}`,
    kind: 'flowchart', page: 'flowchart', text: '',
    x: .5, y: .5, width: hasParent ? (compact ? .55 : .93) : .3, height: hasParent ? (compact ? .6 : .88) : .32,
    ...(hasParent ? { parentId } : {}),
    layout: item.componentLayout ?? { version: 1, pivotX: .5, pivotY: .5, rotation: 0, scaleX: 1, scaleY: 1 },
    list: {
      layout: 'flow', itemWidth: 220, itemHeight: 64, gapX: 60, gapY: 50,
      flowDirection: 'horizontal', flowShowControls: true, flowShowVerticalScrollbar: true,
      flowContent: { mode: 'custom', custom },
    },
    style: { fontSize: 18, textColor: '#edf2ed', background: '#263b3a', borderWidth: 1, borderColor: '#79958b', radius: 4 },
  };
  if (hasParent) {
    const parent: UiComponent = {
      id: parentId, name: `平移验收父级 · ${item.label}`, kind: 'panel', page: 'flowchart', text: '',
      x: .5, y: .5,
      width: item.id === 'parent-rotation' ? .56 : compact ? .42 : .68,
      height: item.id === 'parent-rotation' ? .58 : compact ? .45 : .52,
      layout: item.parentLayout,
      style: { background: '#101818', borderWidth: 0, radius: 0 },
    };
    project.ui.components = [parent, flow];
  } else project.ui.components = [flow];
  project.entryId = fixture.first.id;
  project.scriptText!.content = projectToText(project);
  return projectSchema.parse(JSON.parse(JSON.stringify(project)));
}

function historyProject(): Project {
  const fixture = createPlayerFlowModesFixture();
  const project = projectFrom(fixture);
  project.name = '历史集合滚动条复用验收';
  project.width = 1920;
  project.height = 1080;
  project.ui.pages = { ...project.ui.pages, history: { layout: 'custom' } };
  for (const node of project.nodes) {
    if (node.kind !== 'passage') continue;
    const template = node.lines[0];
    node.lines = Array.from({ length: 9 }, (_, index) => ({
      ...(template ? structuredClone(template) : { id: `${node.id}_line_${index}`, text: '', actions: [] }),
      id: `${node.id}_flow_pan_history_${index}`,
      text: `历史滚动条复用回归，第 ${index + 1} 段。用于形成真实可滚动的对话内容，验证滑块按控件完整变换矩阵移动。`.repeat(2),
      silent: false,
      actions: [],
    }));
  }
  const history: UiComponent = {
    id: historyId, name: '长历史滚动条复用回归', kind: 'historyList', page: 'history', text: '',
    x: .2, y: .42, width: .55, height: .78,
    layout: { version: 1, pivotX: .22, pivotY: .72, rotation: 13, scaleX: 1.12, scaleY: .82 },
    list: { columns: 1, gapY: 12, historyPaddingY: 10,
      historyScrollbar: { rect: { x: .93, y: .04, width: .055, height: .92 }, trackWidth: 6 } },
    style: { fontSize: 18, textColor: '#edf2ed', background: '#263b3a', borderWidth: 1, borderColor: '#79958b', radius: 4 },
  };
  project.ui.components = [history];
  project.scriptText!.content = projectToText(project);
  return projectSchema.parse(JSON.parse(JSON.stringify(project)));
}

function authoredMatrix(component: UiComponent, basis: Point, parent?: Matrix): Matrix {
  const layout: Partial<NonNullable<UiComponent['layout']>> = component.layout ?? {};
  const rotation = (layout.rotation ?? 0) * Math.PI / 180;
  const scaleX = layout.scaleX ?? 1, scaleY = layout.scaleY ?? 1;
  const a = Math.cos(rotation) * scaleX, b = Math.sin(rotation) * scaleX;
  const c = -Math.sin(rotation) * scaleY, d = Math.cos(rotation) * scaleY;
  const width = component.width * basis.x, height = component.height * basis.y;
  const x = (component.x + (layout.anchorX ?? 0)) * basis.x;
  const y = (component.y + (layout.anchorY ?? 0)) * basis.y;
  const local: Matrix = [a, b, c, d,
    x - a * (layout.pivotX ?? 0) * width - c * (layout.pivotY ?? 0) * height,
    y - b * (layout.pivotX ?? 0) * width - d * (layout.pivotY ?? 0) * height];
  if (!parent) return local;
  return [
    parent[0] * local[0] + parent[2] * local[1], parent[1] * local[0] + parent[3] * local[1],
    parent[0] * local[2] + parent[2] * local[3], parent[1] * local[2] + parent[3] * local[3],
    parent[0] * local[4] + parent[2] * local[5] + parent[4], parent[1] * local[4] + parent[3] * local[5] + parent[5],
  ];
}

async function writeReport() {
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
}

async function fingerprints() {
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  const files = ['dist/index.html', 'dist-desktop/main.cjs', 'dist-desktop/preload.cjs',
    ...[...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => 'dist/' + match[1].slice(2))];
  assert.ok(files.some(file => file.startsWith('dist/assets/') && file.endsWith('.js')), 'Compiled renderer assets must exist.');
  return Promise.all([...new Set(files)].map(async file => ({ file, sha256: sha256(await fs.readFile(path.join(root, file))) })));
}

async function startEditor(label: string, projectFile: string, profile: string) {
  app = await launchDesktopFixture({ root, projectFile, profile, devUrl: '' });
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window.isMaximized()) window.unmaximize();
    window.setContentSize(1600, 1000);
  });
  launchNumber++;
  const child = app.process();
  processes.push({ label, pid: child.pid, exited: false });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  const project = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html'));
  (report as { rendererUrl?: string }).rendererUrl = page.url();
  await page.evaluate('globalThis.__name = value => value');
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false });
  traceRunning = true;
  activeTracePath = path.join(output, `trace-${label}-${launchNumber}.zip`);
  await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '设计', exact: true }).click();
  await page.getByLabel('设计页面', { exact: true }).selectOption('flowchart');
  await settle();
}

async function stopEditor() {
  if (!app) return;
  const owned = app;
  const child = owned.process();
  const record = [...processes].reverse().find(item => item.pid === child.pid)!;
  let closeFailure: unknown;
  if (traceRunning && page) {
    try {
      await page.context().tracing.stop({ path: activeTracePath });
      traces.push(path.relative(output, activeTracePath));
    } catch (error) { closeFailure = error; }
    traceRunning = false;
  }
  try {
    await owned.close();
    await expect.poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 15000 }).toBe(true);
  } catch (error) { closeFailure ??= error; }
  record.exited = child.exitCode !== null || child.signalCode !== null;
  if (record.exited) { app = undefined; page = undefined; }
  if (closeFailure) throw closeFailure;
}

async function screenshot(name: string) {
  await settle();
  const data = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(output, `${name}.png`), Buffer.from(data, 'base64'));
}

async function check(name: string, work: () => Promise<void>) {
  phase = name;
  const started = Date.now();
  await work();
  checks.push({ name, durationMs: Date.now() - started });
  await writeReport();
  console.log('通过：' + name);
}

async function selectCanvasScale(scale: 50 | 100) {
  const setting = page!.getByLabel('画面缩放比例', { exact: true });
  await expect(setting).toBeVisible();
  await setting.selectOption(String(scale));
  await settle();
  assert.equal(Number(await setting.inputValue()), scale, 'The authored editor canvas scale must be active.');
}

async function setGraphZoom(componentId: string, target: 90 | 100 | 110) {
  const map = component(componentId);
  const zoomValue = () => map.locator('[data-flow-controls]').evaluate(element => {
    const match = [...element.querySelectorAll('span')].map(span => span.textContent?.trim() ?? '').find(text => /^\d+%$/.test(text));
    return match ? Number(match.slice(0, -1)) : NaN;
  });
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await zoomValue();
    if (current === target) return;
    if (!Number.isFinite(current)) throw new Error(`Flow zoom control is unavailable for ${componentId}.`);
    await map.getByRole('button', { name: current < target ? '放大流程图' : '缩小流程图', exact: true }).click();
  }
  assert.equal(await zoomValue(), target, `Could not set internal graph zoom to ${target}%.`);
}

async function readAffine(target: Locator): Promise<Affine> {
  return target.evaluate(element => {
    let a = 1, b = 0, c = 0, d = 1;
    for (let current: HTMLElement | null = element as HTMLElement; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      const matrix = style.transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(style.transform);
      const zoom = Number.parseFloat(style.zoom || '1') || 1;
      const ma = matrix.a * zoom, mb = matrix.b * zoom, mc = matrix.c * zoom, md = matrix.d * zoom;
      [a, b, c, d] = [ma * a + mc * b, mb * a + md * b, ma * c + mc * d, mb * c + md * d];
    }
    const box = element.getBoundingClientRect();
    const width = (element as HTMLElement).offsetWidth, height = (element as HTMLElement).offsetHeight;
    const minX = Math.min(0, a * width) + Math.min(0, c * height);
    const minY = Math.min(0, b * width) + Math.min(0, d * height);
    return { a, b, c, d, originX: box.left - minX, originY: box.top - minY, width, height };
  });
}

async function assertAuthoredComponentMatrix(project: Project, item: TransformCase, scale: number) {
  const rootComponent = project.ui.components.find(candidate => candidate.id === (item.parentLayout ? parentId : flowId));
  const flowComponent = project.ui.components.find(candidate => candidate.id === flowId)!;
  assert.ok(rootComponent);
  const rootMatrix = authoredMatrix(rootComponent, { x: project.width, y: project.height });
  const expected = item.parentLayout
    ? authoredMatrix(flowComponent, { x: rootComponent.width * project.width, y: rootComponent.height * project.height }, rootMatrix)
    : rootMatrix;
  const rendered = await component(flowId).evaluate(element => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
  });
  const expectedCss: Matrix = [expected[0], expected[1], expected[2], expected[3], expected[4] * scale, expected[5] * scale];
  for (let index = 0; index < expectedCss.length; index++) {
    near(rendered[index], expectedCss[index], .75, `Rendered control matrix entry ${index} must preserve authored parent, pivot, rotation and scale`);
  }
  return { expectedCss, rendered };
}

function screenPoint(affine: Affine, x: number, y: number): Point {
  return { x: affine.originX + affine.a * x + affine.c * y, y: affine.originY + affine.b * x + affine.d * y };
}

function screenVector(affine: Affine, x: number, y: number): Point {
  return { x: affine.a * x + affine.c * y, y: affine.b * x + affine.d * y };
}

async function findBlankCanvasPoint(viewport: Locator): Promise<Point> {
  return viewport.evaluate(element => {
    let a = 1, b = 0, c = 0, d = 1;
    for (let current: HTMLElement | null = element as HTMLElement; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      const matrix = style.transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(style.transform);
      const zoom = Number.parseFloat(style.zoom || '1') || 1;
      const ma = matrix.a * zoom, mb = matrix.b * zoom, mc = matrix.c * zoom, md = matrix.d * zoom;
      [a, b, c, d] = [ma * a + mc * b, mb * a + md * b, ma * c + mc * d, mb * c + md * d];
    }
    const bounds = element.getBoundingClientRect(), width = (element as HTMLElement).offsetWidth, height = (element as HTMLElement).offsetHeight;
    const originX = bounds.left - Math.min(0, a * width) - Math.min(0, c * height);
    const originY = bounds.top - Math.min(0, b * width) - Math.min(0, d * height);
    const fractions = [.82, .64, .44, .24, .12];
    for (const fx of fractions) for (const fy of fractions) {
      const x = width * fx, y = height * fy;
      const clientX = originX + a * x + c * y, clientY = originY + b * x + d * y;
      const hit = document.elementFromPoint(clientX, clientY);
      if (hit?.closest('.ui-story-flow-preview') === element && !hit.closest('[data-flow-node],[data-flow-edge-hit],[data-flow-controls],[data-flow-breadcrumb],[role="scrollbar"]')) return { x: clientX, y: clientY };
    }
    throw new Error('Could not find blank space inside the visible flow canvas for a real middle-button gesture.');
  });
}

async function viewportState(viewport: Locator) {
  return viewport.evaluate(element => ({
    left: element.scrollLeft, top: element.scrollTop,
    clientWidth: element.clientWidth, clientHeight: element.clientHeight,
    scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight,
  }));
}

async function scrollbarState(bar: Locator) {
  return bar.evaluate(element => {
    const thumb = element.querySelector<HTMLElement>('[data-flow-scrollbar-thumb]');
    if (!thumb) throw new Error('Scrollbar thumb is missing.');
    return {
      value: Number(element.getAttribute('aria-valuenow')),
      max: Number(element.getAttribute('aria-valuemax')),
      disabled: element.getAttribute('aria-disabled'),
      width: (element as HTMLElement).offsetWidth, height: (element as HTMLElement).offsetHeight,
      thumbX: thumb.offsetLeft, thumbY: thumb.offsetTop,
      thumbWidth: thumb.offsetWidth, thumbHeight: thumb.offsetHeight,
    };
  });
}

function near(actual: number, expected: number, tolerance: number, message: string) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected.toFixed(2)} ± ${tolerance.toFixed(2)}, received ${actual.toFixed(2)}`);
}

async function resetFlowScroll(componentId: string) {
  for (const axis of ['horizontal', 'vertical'] as const) {
    const bar = scrollbar(componentId, axis);
    await expect(bar).toHaveAttribute('aria-disabled', 'false');
    await bar.focus();
    await page!.keyboard.press('Home');
    await expect(bar).toHaveAttribute('aria-valuenow', '0');
  }
  await expect.poll(async () => {
    const state = await viewportState(flowViewport(componentId));
    return Math.max(Math.abs(state.left), Math.abs(state.top));
  }).toBeLessThan(1);
}

async function panCase(item: TransformCase) {
  const viewport = flowViewport(flowId);
  const before = await viewportState(viewport);
  const horizontal = await scrollbarState(scrollbar(flowId, 'horizontal'));
  const vertical = await scrollbarState(scrollbar(flowId, 'vertical'));
  assert.ok(horizontal.max > 100 && vertical.max > 80,
    `Fixture must overflow on both axes: ${JSON.stringify({ horizontal, vertical })}`);
  const affine = await readAffine(viewport);
  assertRenderedTransform(item, affine);
  const logicalMovement = { x: -Math.min(42, horizontal.max * item.canvasScale / 100 / 4), y: -Math.min(32, vertical.max * item.canvasScale / 100 / 4) };
  const screenMovement = screenVector(affine, logicalMovement.x, logicalMovement.y);
  const start = await findBlankCanvasPoint(viewport);
  await assertMousePathInWindow('Middle pan', [start, { x: start.x + screenMovement.x, y: start.y + screenMovement.y }]);
  await page!.mouse.move(start.x, start.y);
  await page!.mouse.down({ button: 'middle' });
  await page!.mouse.move(start.x + screenMovement.x, start.y + screenMovement.y, { steps: 5 });
  await expect.poll(async () => {
    const state = await viewportState(viewport);
    return Math.min(state.left - before.left, state.top - before.top);
  }, { timeout: 5000 }).toBeGreaterThan(5);
  const after = await viewportState(viewport);
  const expected = { x: -logicalMovement.x, y: -logicalMovement.y };
  near(after.left - before.left, expected.x, 2.5, 'Middle pan must apply the inverse full matrix to horizontal movement');
  near(after.top - before.top, expected.y, 2.5, 'Middle pan must apply the inverse full matrix to vertical movement');
  await page!.mouse.up({ button: 'middle' });
  await expect.poll(async () => (await scrollbarState(scrollbar(flowId, 'horizontal'))).value).toBeGreaterThan(1);
  const bars = { horizontal: await scrollbarState(scrollbar(flowId, 'horizontal')), vertical: await scrollbarState(scrollbar(flowId, 'vertical')) };
  await screenshot(`${item.id}-middle-pan-xy`);
  return { matrix: affine, editorScale: item.canvasScale, graphZoom: item.graphZoom, logicalMovement, screenMovement, before, after, bars };
}

function assertRenderedTransform(item: TransformCase, affine: Affine) {
  const xScale = Math.hypot(affine.a, affine.b), yScale = Math.hypot(affine.c, affine.d);
  const orthogonality = (affine.a * affine.c + affine.b * affine.d) / Math.max(1e-8, xScale * yScale);
  switch (item.id) {
    case 'ordinary':
      near(affine.a, 1, .03, 'Ordinary fixture must render its authored horizontal basis');
      near(affine.d, 1, .03, 'Ordinary fixture must render its authored vertical basis');
      near(affine.b, 0, .03, 'Ordinary fixture must not introduce rotation');
      near(affine.c, 0, .03, 'Ordinary fixture must not introduce shear');
      break;
    case 'parent-rotation':
      assert.ok(Math.abs(affine.b) > .95 && Math.abs(affine.c) > .95,
        `Parent rotation must be present in the measured canvas matrix: ${JSON.stringify(affine)}`);
      break;
    case 'nonuniform-scale':
      near(xScale, 1.4, .04, 'Authored horizontal scale must be visible in the canvas matrix');
      near(yScale, .72, .04, 'Authored vertical scale must be visible in the canvas matrix');
      break;
    case 'mirror-offset-pivot':
      assert.ok(affine.a * affine.d - affine.b * affine.c < 0,
        `Mirrored fixture must retain a negative transform determinant: ${JSON.stringify(affine)}`);
      near(xScale, 1.05, .05, 'Authored mirrored scale must be visible in the canvas matrix');
      near(yScale, .82, .05, 'Authored vertical scale must be visible in the canvas matrix');
      break;
    case 'composed-shear':
      assert.ok(Math.abs(orthogonality) > .12,
        `Parent and child transforms must render a measurable shear: ${JSON.stringify({ affine, orthogonality })}`);
      break;
  }
}

async function cancelPan(componentId: string, screenshotName: string) {
  await resetFlowScroll(componentId);
  const viewport = flowViewport(componentId);
  const affine = await readAffine(viewport);
  const localMove = { x: -24, y: -18 };
  const screenMove = screenVector(affine, localMove.x, localMove.y);
  const start = await findBlankCanvasPoint(viewport);
  await assertMousePathInWindow('Middle pan cancellation', [
    start,
    { x: start.x + screenMove.x, y: start.y + screenMove.y },
    { x: start.x + screenMove.x * 1.8, y: start.y + screenMove.y * 1.8 },
  ]);
  await page!.mouse.move(start.x, start.y);
  await page!.mouse.down({ button: 'middle' });
  await page!.mouse.move(start.x + screenMove.x, start.y + screenMove.y, { steps: 4 });
  const applied = await viewportState(viewport);
  assert.ok(applied.left > 5 && applied.top > 5, 'The real pan must have applied both coordinates before cancellation.');
  await page!.keyboard.press('Escape');
  await page!.mouse.move(start.x + screenMove.x * 1.8, start.y + screenMove.y * 1.8, { steps: 3 });
  const afterEscape = await viewportState(viewport);
  near(afterEscape.left, applied.left, 1, 'Escape must stop further horizontal pan movement while preserving applied scroll');
  near(afterEscape.top, applied.top, 1, 'Escape must stop further vertical pan movement while preserving applied scroll');
  await page!.mouse.up({ button: 'middle' });
  await screenshot(screenshotName);
  return { applied, afterEscape };
}

async function thumbCenter(bar: Locator, axis: 'horizontal' | 'vertical') {
  const affine = await readAffine(bar);
  const state = await scrollbarState(bar);
  const x = axis === 'horizontal' ? state.thumbX + state.thumbWidth / 2 : state.width / 2;
  const y = axis === 'vertical' ? state.thumbY + state.thumbHeight / 2 : state.height / 2;
  const point = screenPoint(affine, x, y);
  const hit = await bar.evaluate((element, point) => {
    const hit = document.elementFromPoint(point.x, point.y), rect = element.getBoundingClientRect();
    return { matches: hit === element || !!hit && element.contains(hit), rect: rect.toJSON(), hit: hit?.outerHTML.slice(0, 700), style: element.getAttribute('style') };
  }, point);
  assert.ok(hit.matches, `The ${axis} thumb must receive real pointer input: ${JSON.stringify({ point, affine, state, hit })}`);
  return { point, affine, state };
}

async function dragThumb(componentId: string, axis: 'horizontal' | 'vertical', scale: number, screenshotName: string) {
  await resetFlowScroll(componentId);
  const bar = scrollbar(componentId, axis);
  const { point, affine, state } = await thumbCenter(bar, axis);
  assert.ok(state.max > 0 && state.disabled === 'false');
  const travel = axis === 'horizontal' ? state.width - state.thumbWidth : state.height - state.thumbHeight;
  assert.ok(travel > 24, `Scrollbar needs enough thumb travel on ${axis}: ${JSON.stringify(state)}`);
  const startOffset = axis === 'horizontal' ? state.thumbX : state.thumbY;
  const targetOffset = travel * .68;
  const localMovement = targetOffset - startOffset;
  const screenMovement = screenVector(affine, axis === 'horizontal' ? localMovement : 0, axis === 'vertical' ? localMovement : 0);
  await assertMousePathInWindow(`${axis} thumb drag`, [point, { x: point.x + screenMovement.x, y: point.y + screenMovement.y }]);
  await page!.mouse.move(point.x, point.y);
  await page!.mouse.down();
  await page!.mouse.move(point.x + screenMovement.x, point.y + screenMovement.y, { steps: 5 });
  const expected = Math.round(state.max * .68);
  await expect.poll(async () => (await scrollbarState(bar)).value, { timeout: 5000 }).toBeGreaterThan(Math.round(state.max * .58));
  const actual = await scrollbarState(bar);
  near(actual.value, expected, Math.max(3, state.max * .035), `${axis} thumb drag must use its transformed local rail axis`);
  await page!.mouse.up();
  const view = await viewportState(flowViewport(componentId));
  const moved = axis === 'horizontal' ? view.left : view.top;
  near(moved, actual.value * scale, 2.5, `${axis} thumb value must match the actual viewport scroll offset`);
  await screenshot(screenshotName);
  return { matrix: affine, initial: state, actual, expected, screenMovement, viewport: view };
}

async function clickTrackToEnd(componentId: string, axis: 'horizontal' | 'vertical', scale: number, screenshotName: string) {
  await resetFlowScroll(componentId);
  const bar = scrollbar(componentId, axis);
  const affine = await readAffine(bar);
  const state = await scrollbarState(bar);
  assert.ok(state.max > 0 && state.disabled === 'false');
  const point = screenPoint(affine, axis === 'horizontal' ? state.width * .97 : state.width / 2,
    axis === 'vertical' ? state.height * .97 : state.height / 2);
  await assertMousePathInWindow(`${axis} track endpoint`, [point]);
  const hitIsBar = await page!.evaluate(({ x, y, selector }) => !!document.elementFromPoint(x, y)?.closest(selector),
    { x: point.x, y: point.y, selector: `[data-component-id="${componentId}"] [data-flow-scrollbar="${axis}"]` });
  assert.equal(hitIsBar, true, `The authored ${axis} rail endpoint must receive real pointer input.`);
  await page!.mouse.click(point.x, point.y);
  // DOM client/scroll sizes are integral CSS pixels, even at 50% canvas scale.
  await expect.poll(async () => Math.abs((await scrollbarState(bar)).value - state.max)).toBeLessThanOrEqual(1.5 / scale);
  const view = await viewportState(flowViewport(componentId));
  near(axis === 'horizontal' ? view.left : view.top, state.max * scale, 2.5, `${axis} rail endpoint must clamp to the scroll boundary`);
  near(axis === 'horizontal' ? view.left : view.top,
    axis === 'horizontal' ? view.scrollWidth - view.clientWidth : view.scrollHeight - view.clientHeight,
    1.5, `${axis} track endpoint must reach the real DOM boundary`);
  await screenshot(screenshotName);
  return { matrix: affine, initial: state, point, actual: await scrollbarState(bar), viewport: view };
}

async function keyboardAndBoundaries(componentId: string, axis: 'horizontal' | 'vertical', scale: number, screenshotName: string) {
  const bar = scrollbar(componentId, axis);
  const state = await scrollbarState(bar);
  assert.ok(state.max > 80 && state.disabled === 'false');
  const forward = axis === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
  await bar.focus();
  await page!.keyboard.press('End');
  await expect.poll(async () => Math.abs((await scrollbarState(bar)).value - state.max)).toBeLessThanOrEqual(1.5 / scale);
  const end = await scrollbarState(bar), endView = await viewportState(flowViewport(componentId));
  near(axis === 'horizontal' ? endView.left : endView.top,
    axis === 'horizontal' ? endView.scrollWidth - endView.clientWidth : endView.scrollHeight - endView.clientHeight,
    1.5, `${axis} End must reach the real DOM boundary`);
  await page!.keyboard.press(forward);
  await expect(bar).toHaveAttribute('aria-valuenow', String(end.value));
  await page!.keyboard.press('PageUp');
  const afterPageUp = await scrollbarState(bar);
  assert.ok(afterPageUp.value < state.max, `${axis} PageUp must move away from the end boundary.`);
  await page!.keyboard.press('Home');
  await expect(bar).toHaveAttribute('aria-valuenow', '0');
  const viewport = await viewportState(flowViewport(componentId));
  const pageStep = Math.max(1, Math.round((axis === 'horizontal' ? viewport.clientWidth : viewport.clientHeight) / scale));
  await page!.keyboard.press('PageDown');
  const afterPageDown = await scrollbarState(bar);
  near(afterPageDown.value, Math.min(state.max, pageStep), Math.max(3, state.max * .025), `${axis} PageDown must advance one page`);
  const backward = axis === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
  await page!.keyboard.press(backward);
  const afterArrow = await scrollbarState(bar);
  near(afterArrow.value, Math.max(0, afterPageDown.value - 40), 2, `${axis} arrow key must advance by 40 source pixels`);
  const afterArrowView = await viewportState(flowViewport(componentId));
  near(axis === 'horizontal' ? afterArrowView.left : afterArrowView.top, afterArrow.value * scale, 2.5, `${axis} keyboard input must update its collection viewport`);
  await page!.keyboard.press('Home');
  await page!.keyboard.press(backward);
  await expect(bar).toHaveAttribute('aria-valuenow', '0');
  await screenshot(screenshotName);
  const boundary = await scrollbarState(bar), boundaryView = await viewportState(flowViewport(componentId));
  near(axis === 'horizontal' ? boundaryView.left : boundaryView.top, 0, 1, `${axis} keyboard Home must reach the viewport boundary`);
  return { initial: state, afterPageUp, afterPageDown, afterArrow, afterArrowView, boundary, boundaryView };
}

async function cancelThumbDrag(componentId: string, axis: 'horizontal' | 'vertical', screenshotName: string) {
  await resetFlowScroll(componentId);
  const bar = scrollbar(componentId, axis);
  const { point, affine, state } = await thumbCenter(bar, axis);
  const travel = axis === 'horizontal' ? state.width - state.thumbWidth : state.height - state.thumbHeight;
  assert.ok(travel > 24 && state.max > 80);
  const move = travel * .34;
  const screenMove = screenVector(affine, axis === 'horizontal' ? move : 0, axis === 'vertical' ? move : 0);
  await assertMousePathInWindow(`${axis} thumb cancellation`, [
    point,
    { x: point.x + screenMove.x, y: point.y + screenMove.y },
    { x: point.x + screenMove.x * 1.8, y: point.y + screenMove.y * 1.8 },
  ]);
  await page!.mouse.move(point.x, point.y);
  await page!.mouse.down();
  await page!.mouse.move(point.x + screenMove.x, point.y + screenMove.y, { steps: 4 });
  const applied = await scrollbarState(bar);
  assert.ok(applied.value > 3, `The ${axis} thumb must have moved before cancellation.`);
  await page!.keyboard.press('Escape');
  await page!.mouse.move(point.x + screenMove.x * 1.8, point.y + screenMove.y * 1.8, { steps: 3 });
  const afterEscape = await scrollbarState(bar);
  assert.equal(afterEscape.value, applied.value, `Escape must stop further ${axis} scrollbar movement and keep the applied value.`);
  await page!.mouse.up();
  await screenshot(screenshotName);
  return { initial: state, applied, afterEscape, matrix: affine };
}

async function runFlowCase(item: TransformCase, fixtureDirectory: string, profile: string) {
  const projectFile = path.join(fixtureDirectory, 'project.vns.json');
  await fs.mkdir(fixtureDirectory, { recursive: true });
  const authoredProject = flowProject(item);
  await saveProject(projectFile, authoredProject);
  await startEditor(item.id, projectFile, profile);
  await selectCanvasScale(item.canvasScale);
  await page!.locator(`[data-hierarchy-id="${flowId}"] .ui-hierarchy-caption`).click();
  await expect(component(flowId)).toHaveClass(/\bselected\b/);
  await expect(component(flowId)).toBeVisible();
  await expect(flowViewport(flowId)).toBeVisible();
  await setGraphZoom(flowId, item.graphZoom);
  const componentMatrix = await assertAuthoredComponentMatrix(authoredProject, item, item.canvasScale / 100);
  for (const axis of ['horizontal', 'vertical'] as const) {
    await expect(scrollbar(flowId, axis)).toHaveAttribute('aria-disabled', 'false');
  }

  const caseEvidence: Record<string, unknown> = {
    id: item.id, label: item.label, canvasScale: item.canvasScale, graphZoom: item.graphZoom,
    authoredParentLayout: item.parentLayout, authoredComponentLayout: item.componentLayout,
    componentMatrix,
    results: {},
  };
  const results = caseEvidence.results as Record<string, unknown>;
  await check(`${item.label}：中键真实拖动同时按完整矩阵平移 X/Y`, async () => {
    results.pan = await panCase(item);
  });
  await check(`${item.label}：Escape 取消中键平移后冻结当前滚动位置`, async () => {
    results.panCancellation = await cancelPan(flowId, `${item.id}-pan-escape-cancel`);
  });
  for (const axis of ['horizontal', 'vertical'] as const) {
    await check(`${item.label}：${axis === 'horizontal' ? '横向' : '纵向'}滑块拖动按完整矩阵换算`, async () => {
      results[`${axis}ThumbDrag`] = await dragThumb(flowId, axis, item.canvasScale / 100, `${item.id}-${axis}-thumb-drag`);
    });
    await check(`${item.label}：${axis === 'horizontal' ? '横向' : '纵向'}轨道点选可到达并夹紧边界`, async () => {
      results[`${axis}TrackEnd`] = await clickTrackToEnd(flowId, axis, item.canvasScale / 100, `${item.id}-${axis}-track-end`);
    });
    await check(`${item.label}：${axis === 'horizontal' ? '横向' : '纵向'}键盘方向、翻页与首尾边界`, async () => {
      results[`${axis}Keyboard`] = await keyboardAndBoundaries(flowId, axis, item.canvasScale / 100, `${item.id}-${axis}-keyboard-boundaries`);
    });
    await check(`${item.label}：${axis === 'horizontal' ? '横向' : '纵向'}滑块 Escape 取消后保留已应用值`, async () => {
      results[`${axis}ThumbCancellation`] = await cancelThumbDrag(flowId, axis, `${item.id}-${axis}-thumb-escape-cancel`);
    });
  }
  (evidence.flowCases as unknown[]).push(caseEvidence);
  await stopEditor();
}

async function runHistoryRegression() {
  const fixtureDirectory = historyFixture, projectFile = path.join(fixtureDirectory, 'project.vns.json');
  await fs.mkdir(fixtureDirectory, { recursive: true });
  await saveProject(projectFile, historyProject());
  await startEditor('history-scrollbar', projectFile, historyProfile);
  await page!.getByLabel('设计页面', { exact: true }).selectOption('history');
  await selectCanvasScale(50);
  await page!.locator(`[data-hierarchy-id="${historyId}"] .ui-hierarchy-caption`).click();
  const history = component(historyId);
  await expect(history).toHaveClass(/\bselected\b/);
  const bar = history.getByRole('scrollbar', { name: '历史对话滚动条', exact: true });
  await expect(history).toBeVisible();
  await expect(bar).toBeVisible();
  await expect.poll(async () => (await scrollbarState(bar)).max).toBeGreaterThan(300);
  const affine = await readAffine(bar);
  const xScale = Math.hypot(affine.a, affine.b), yScale = Math.hypot(affine.c, affine.d);
  near(xScale, 1.12, .05, 'History collection must render its authored horizontal scale');
  near(yScale, .82, .05, 'History collection must render its authored vertical scale');
  assert.ok(Math.abs(affine.b) > .1, 'History collection must render its authored rotation.');
  await check('HistoryPreview 复用 FlowScrollbar：真实滑块拖动经非均匀缩放与轴心矩阵映射', async () => {
    const state = await scrollbarState(bar);
    const { point } = await thumbCenter(bar, 'vertical');
    const travel = state.height - state.thumbHeight;
    assert.ok(travel > 30 && state.max > 300);
    const startOffset = state.thumbY;
    const movement = travel * .62 - startOffset;
    const delta = screenVector(affine, 0, movement);
    await assertMousePathInWindow('History thumb drag', [point, { x: point.x + delta.x, y: point.y + delta.y }]);
    await page!.mouse.move(point.x, point.y);
    await page!.mouse.down();
    await page!.mouse.move(point.x + delta.x, point.y + delta.y, { steps: 5 });
    const actual = await scrollbarState(bar);
    near(actual.value, Math.round(state.max * .62), Math.max(4, state.max * .04), 'History thumb drag must follow its transformed rail axis');
    await page!.mouse.up();
    const scrollTop = await history.locator('[data-history-viewport]').evaluate(element => element.scrollTop);
    near(scrollTop, actual.value * .5, 2.5, 'History thumb value must update the actual history viewport');
    (evidence.historyScrollbar as Record<string, unknown>).drag = { affine, initial: state, actual, delta, scrollTop };
    await screenshot('history-scrollbar-thumb-drag');
  });
  await check('HistoryPreview 复用 FlowScrollbar：Home／End／方向键操作实际历史区域', async () => {
    await bar.focus();
    await page!.keyboard.press('End');
    const end = await scrollbarState(bar);
    assert.equal(end.value, end.max, 'History scrollbar End must reach the bottom boundary.');
    await page!.keyboard.press('ArrowDown');
    assert.equal((await scrollbarState(bar)).value, end.max, 'History scrollbar ArrowDown must remain clamped at the bottom.');
    await page!.keyboard.press('Home');
    assert.equal((await scrollbarState(bar)).value, 0, 'History scrollbar Home must reach the top boundary.');
    await page!.keyboard.press('ArrowUp');
    assert.equal((await scrollbarState(bar)).value, 0, 'History scrollbar ArrowUp must remain clamped at the top.');
    const scrollTop = await history.locator('[data-history-viewport]').evaluate(element => element.scrollTop);
    assert.equal(scrollTop, 0, 'History keyboard input must update the real history viewport.');
    (evidence.historyScrollbar as Record<string, unknown>).keyboard = { end, final: await scrollbarState(bar), scrollTop };
    await screenshot('history-scrollbar-keyboard-boundaries');
  });
  await stopEditor();
}

try {
  await fs.mkdir(output, { recursive: true });
  (report as { buildBefore?: unknown }).buildBefore = await fingerprints();
  for (const item of transformCases) {
    const paths = fixturePaths.find(candidate => candidate.id === item.id)!;
    await runFlowCase(item, paths.fixture, paths.profile);
  }
  await runHistoryRegression();
  assert.deepEqual(errors, [], 'Renderer must not raise runtime errors.');
  const buildAfter = await fingerprints();
  assert.deepEqual(buildAfter, (report as { buildBefore: unknown }).buildBefore, 'All sessions must use one unchanged compiled build.');
  (report as { buildAfter?: unknown }).buildAfter = buildAfter;
  report.status = 'passed';
} catch (error) {
  failure = error;
  report.status = 'failed';
  (report as { phase?: string; error?: string }).phase = phase;
  (report as { error?: string }).error = String(error);
  if (app && page && !page.isClosed()) {
    await screenshot(`failure-${launchNumber}`).catch(capture => { (report as { captureError?: string }).captureError = String(capture); });
  }
} finally {
  try { await stopEditor(); }
  catch (error) {
    report.status = 'failed';
    (report as { closeError?: string }).closeError = String(error);
    failure ??= error;
  }
  (report as { temporaryArtifactsRetained?: boolean }).temporaryArtifactsRetained = true;
  await writeReport();
  console.log(output);
}
if (failure) throw failure;
