import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { projectSchema, type PassageNode, type Project, type UiComponent } from '../src/core/model';
import { projectToText } from '../src/core/text-script';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openDisclosureAncestors } from './lib/ui-disclosures';
import { createPlayerFlowModesFixture } from './lib/player-flow-modes-fixture';

// Run only after the unified build. This acceptance never builds the editor.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Use the isolated compiled source editor.');
const root = path.resolve('.');
const outputRoot = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/player-flow-fixes-2026-11-13/desktop');
const relativeOutputRoot = path.relative(root, outputRoot);
assert.ok(relativeOutputRoot === '' || (!path.isAbsolute(relativeOutputRoot) && relativeOutputRoot !== '..' && !relativeOutputRoot.startsWith('..' + path.sep)),
  'VNS_ARTIFACT_ROOT must resolve inside this checkout.');
const runId = `run-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`;
const output = path.join(outputRoot, runId);
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

const flowIds = {
  target: 'flow_fix_target',
  unrelated: 'flow_fix_unrelated',
  groupPrefix: 'flow_fix_group_',
  mapPrefix: 'flow_fix_map_',
  parentPrefix: 'flow_fix_parent_',
  source: (index: number) => `flow_fix_source_${index}`,
  decoy: (index: number) => `flow_fix_decoy_${index}`,
};

type TransformCase = {
  id: string;
  label: string;
  owner: 'component' | 'parent';
  rotation: number;
  scaleX: number;
  scaleY: number;
  canvasScale: 50 | 100;
  graphZoom: 90 | 100 | 110;
  delta: { x: number; y: number };
};

const transformCases: TransformCase[] = [
  { id: 'component-scale-2', label: '控件自身缩放 2 倍', owner: 'component', rotation: 0, scaleX: 2, scaleY: 2, canvasScale: 50, graphZoom: 110, delta: { x: 12, y: 10 } },
  { id: 'parent-scale-2', label: '父级缩放 2 倍', owner: 'parent', rotation: 0, scaleX: 2, scaleY: 2, canvasScale: 100, graphZoom: 90, delta: { x: 12, y: 10 } },
  { id: 'component-rotate-90', label: '控件自身旋转 90 度', owner: 'component', rotation: 90, scaleX: 1, scaleY: 1, canvasScale: 50, graphZoom: 100, delta: { x: 12, y: 10 } },
  { id: 'parent-rotate-90', label: '父级旋转 90 度', owner: 'parent', rotation: 90, scaleX: 1, scaleY: 1, canvasScale: 100, graphZoom: 110, delta: { x: 12, y: 10 } },
  { id: 'component-mirror-x', label: '控件自身横向镜像', owner: 'component', rotation: 0, scaleX: -1, scaleY: 1, canvasScale: 50, graphZoom: 90, delta: { x: 12, y: 10 } },
  { id: 'parent-mirror-x', label: '父级横向镜像', owner: 'parent', rotation: 0, scaleX: -1, scaleY: 1, canvasScale: 100, graphZoom: 100, delta: { x: 12, y: 10 } },
];

type Position = { x: number; y: number };
type DragScope = { kind: 'group'; groupId: string } | { kind: 'member'; groupId: string; nodeId: string } | { kind: 'entry'; nodeId: string };

function makeProject(options: { mapId: string; transform?: TransformCase; edgeScenario?: 'ninth-reached' | 'unrelated-only' }): Project {
  const sourceFixture = createPlayerFlowModesFixture();
  const project = structuredClone(sourceFixture.project);
  const template = project.nodes.find((node): node is PassageNode => node.kind === 'passage');
  assert.ok(template, 'The synthetic project needs a passage template.');
  const sceneId = template.sceneId;
  const makePassage = (id: string, name: string, next?: string): PassageNode => ({
    ...structuredClone(template),
    id,
    sceneId,
    name,
    x: 0,
    y: 0,
    lines: template.lines.map((line, index) => ({ ...line, id: `${id}_line_${index}`, text: `${name} 的正文。`, actions: [] })),
    next,
    flowchart: { visible: true, name },
  });
  const sources = Array.from({ length: 9 }, (_, index) => ({ id: flowIds.source(index), name: `路线来源 ${index + 1}` }));
  project.nodes.push(...sources.map(source => makePassage(source.id, source.name, flowIds.target)));
  project.nodes.push(makePassage(flowIds.target, '九条路线的公共终点'));

  const decoyCount = options.edgeScenario === 'unrelated-only' ? 11 : options.edgeScenario ? 9 : 0;
  const decoys = Array.from({ length: decoyCount }, (_, index) => ({ id: flowIds.decoy(index), name: `不相关分组成员 ${index + 1}` }));
  project.nodes.push(...decoys.map(decoy => makePassage(decoy.id, decoy.name)));
  project.nodes.push(makePassage(flowIds.unrelated, '无关入口'));

  const groupId = flowIds.groupPrefix + options.mapId.replace(/^flow_fix_map_/, '');
  const sourceIds = sources.map(source => source.id);
  const groupMemberIds = [...decoys.map(decoy => decoy.id), ...sourceIds];
  const entries = options.edgeScenario === 'ninth-reached'
    ? [...decoys, { id: flowIds.target, name: '九条路线的公共终点' }, ...sources, { id: flowIds.unrelated, name: '无关入口' }]
    : options.edgeScenario === 'unrelated-only'
      ? [...decoys, ...sources, { id: flowIds.target, name: '九条路线的公共终点' }, { id: flowIds.unrelated, name: '无关入口' }]
      : [...sources, { id: flowIds.target, name: '九条路线的公共终点' }, { id: flowIds.unrelated, name: '无关入口' }];
  const custom = {
    entries: entries.map(entry => ({ nodeId: entry.id, owner: { kind: 'node' as const, id: entry.id }, name: entry.name })),
    positions: { [flowIds.target]: { x: 220, y: 180 }, [flowIds.unrelated]: { x: 390, y: 42 } },
    groups: [{
      id: groupId,
      name: options.edgeScenario ? '多成员路线组' : '内部节点组',
      nodeIds: groupMemberIds,
      collapsed: true,
      position: { x: 220, y: 100 },
      positions: Object.fromEntries(groupMemberIds.map((id, index) => [id, { x: 220 + (index % 3) * 140, y: 100 + Math.floor(index / 3) * 90 }])) as Record<string, Position>,
    }],
  };
  const mapId = options.mapId;
  const flowMap: UiComponent = {
    id: mapId,
    name: options.edgeScenario ? '九成员连线路径验收图' : options.transform?.label ?? '流程图变换验收图',
    kind: 'flowchart',
    page: 'flowchart',
    text: '',
    x: options.transform?.owner === 'parent' ? 0 : .35,
    y: options.transform?.owner === 'parent' ? 0 : .325,
    width: options.transform?.owner === 'parent' ? 1 : .3,
    height: options.transform?.owner === 'parent' ? 1 : .35,
    ...(options.transform?.owner === 'parent' ? { parentId: flowIds.parentPrefix + mapId.replace(flowIds.mapPrefix, '') } : {}),
    ...(options.transform?.owner === 'component' ? { layout: { version: 1 as const, pivotX: .5, pivotY: .5, rotation: options.transform.rotation, scaleX: options.transform.scaleX, scaleY: options.transform.scaleY } } : {}),
    list: {
      layout: 'flow', itemWidth: 110, itemHeight: 48, gapX: 22, gapY: 18,
      flowShowControls: true, flowShowVerticalScrollbar: false,
      flowContent: { mode: 'custom', custom },
      ...(options.edgeScenario ? { lockUnread: true, flowLockedNode: 'show', flowLockedLine: 'hide' } : {}),
    },
    style: { fontSize: 20, textColor: '#edf2ed', background: '#263b3a', borderWidth: 1, borderColor: '#79958b', radius: 4 },
  };
  if (options.transform?.owner === 'parent') {
    const parentId = flowIds.parentPrefix + mapId.replace(flowIds.mapPrefix, '');
    const parent: UiComponent = {
      id: parentId,
      name: `${options.transform.label} · 父级面板`,
      kind: 'panel',
      page: 'flowchart',
      text: '',
      x: .35,
      y: .325,
      width: .3,
      height: .35,
      layout: { version: 1, pivotX: .5, pivotY: .5, rotation: options.transform.rotation, scaleX: options.transform.scaleX, scaleY: options.transform.scaleY },
      style: { background: '#101818', borderWidth: 0, radius: 0 },
    };
    project.ui.components = [parent, flowMap];
  } else project.ui.components = [flowMap];

  project.entryId = options.edgeScenario === 'ninth-reached' ? flowIds.source(8)
    : options.edgeScenario === 'unrelated-only' ? flowIds.target
      : flowIds.source(8);
  project.scriptText!.content = projectToText(project);
  return projectSchema.parse(JSON.parse(JSON.stringify(project)));
}

const nodeNames = flowIds;
const mapForCase = (id: string) => flowIds.mapPrefix + id.replaceAll('-', '_');
const fixturePaths = transformCases.map(item => ({ id: item.id, fixture: path.join(output, `fixture-${item.id}`), profile: path.join(output, `profile-${item.id}`) }));
const edgeFixtures = [
  { id: 'partial-ninth-reached', mode: 'ninth-reached' as const, fixture: path.join(output, 'fixture-partial-ninth-reached'), profile: path.join(output, 'profile-partial-ninth-reached') },
  { id: 'partial-unrelated-only', mode: 'unrelated-only' as const, fixture: path.join(output, 'fixture-partial-unrelated-only'), profile: path.join(output, 'profile-partial-unrelated-only') },
];
const temporaryPaths = [...fixturePaths, ...edgeFixtures].flatMap(item => [item.fixture, item.profile]);

let app: ElectronApplication | undefined;
let page: Page | undefined;
let activeProjectFile = '';
let activeTracePath = '';
let traceRunning = false;
let failure: unknown;
let phase = '准备';
let launchNumber = 0;
let savedBytes = '';
const checks: { name: string; durationMs: number }[] = [];
const pageErrors: string[] = [];
const traces: string[] = [];
const processes: { label: string; pid?: number; exited: boolean }[] = [];
const evidence: Record<string, unknown> = { transforms: [], partialEdges: [] };
const report: Record<string, unknown> = {
  status: 'running', renderer: 'compiled-source', runId, checks, pageErrors, traces, processes, evidence, temporaryPaths,
  limits: [
    '仅使用脚本新建的剧情、控件、布局与工程文件，不打开或读取真实作品。',
    '拖动通过 Electron 桌面实际鼠标事件完成；不注入或修改 React 内部状态。',
    '本脚本保留 fixture、profile、报告、截图和 Playwright trace，由主线程统一按报告中的路径清理。',
    '本轮不启动原生游戏；引用身份、Ren\'Py 确认文字和性能专项由其他验收覆盖。',
  ],
};

const button = (name: string) => page!.getByRole('button', { name, exact: true });
const inspector = () => page!.locator('.ui-inspector[data-ui-flow-view]');
const flowGroup = (id: string) => page!.locator(`[data-ui-inspector-group="${id}"]`);
const component = (id: string) => page!.locator(`[data-component-id="${id}"]`);
const groupCard = (componentId: string, groupId: string) => component(componentId).locator(`[data-flow-group="${groupId}"]`);
const flowNode = (componentId: string, nodeId: string) => component(componentId).locator(`[data-flow-node="${nodeId}"]`);
const readProject = async () => projectSchema.parse(JSON.parse(await fs.readFile(activeProjectFile, 'utf8')));
const componentIn = (project: Project, id: string) => project.ui.components.find(item => item.id === id)!;
const customIn = (project: Project, id: string) => componentIn(project, id).list?.flowContent?.custom!;
const settle = () => page!.evaluate('async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); }');

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
  activeProjectFile = projectFile;
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
  page.on('pageerror', error => pageErrors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText((await readProject()).name, { timeout: 45000 });
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
  } catch (error) {
    closeFailure ??= error;
  }
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
}

async function selectMap(mapId: string) {
  const row = page!.locator(`[data-hierarchy-id="${mapId}"] .ui-hierarchy-caption`);
  await openDisclosureAncestors(row);
  await row.click();
  await expect(inspector()).toHaveAttribute('data-ui-flow-view', 'map');
  await expect(component(mapId)).toBeVisible();
  await expect(component(mapId).locator('.ui-story-flow-preview')).toBeVisible();
}

async function setGraphZoom(mapId: string, target: 90 | 100 | 110) {
  const zoomValue = () => component(mapId).locator('[data-flow-controls]').evaluate(element => {
    const match = [...element.querySelectorAll('span')].map(span => span.textContent?.trim() ?? '').find(text => /^\d+%$/.test(text));
    return match ? Number(match.slice(0, -1)) : NaN;
  });
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await zoomValue();
    if (current === target) return;
    if (!Number.isFinite(current)) throw new Error(`Flow zoom control is unavailable for ${mapId}.`);
    await component(mapId).getByRole('button', { name: current < target ? '放大流程图' : '缩小流程图', exact: true }).click();
  }
  assert.equal(await zoomValue(), target, `Could not set internal graph zoom to ${target}%.`);
}

async function save() {
  const saveButton = button('保存界面');
  if (await saveButton.isEnabled()) {
    await saveButton.click();
    await expect(page!.locator('.ui-save-status')).toHaveAttribute('data-dirty', 'false', { timeout: 30000 });
  }
  await expect(saveButton).toBeDisabled();
  savedBytes = await fs.readFile(activeProjectFile, 'utf8');
  return readProject();
}

async function assertNoWrite(expectedBytes: string) {
  await expect(button('保存界面')).toBeDisabled();
  assert.equal(await fs.readFile(activeProjectFile, 'utf8'), expectedBytes, 'A cancelled gesture must not write the project.');
}

async function center(target: Locator) {
  const box = await target.boundingBox();
  assert.ok(box, 'Dragged flow element must have a rendered bounding box.');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function assertScreenDelta(target: Locator, before: Position, delta: Position) {
  await expect.poll(async () => {
    const after = await center(target);
    return Math.hypot(after.x - before.x - delta.x, after.y - before.y - delta.y);
  }, { timeout: 5000 }).toBeLessThan(2.5);
}

async function actualTransform(mapId: string) {
  return component(mapId).evaluate(element => {
    const value = getComputedStyle(element).transform;
    const matrix = new DOMMatrixReadOnly(value === 'none' ? undefined : value);
    return { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f };
  });
}

function localDelta(matrix: { a: number; b: number; c: number; d: number }, screen: Position, scale: number, zoom: number): Position {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  assert.ok(Math.abs(determinant) > 1e-7, 'The rendered control transform must be invertible.');
  const x = screen.x / (scale * zoom), y = screen.y / (scale * zoom);
  return { x: (matrix.d * x - matrix.c * y) / determinant, y: (-matrix.b * x + matrix.a * y) / determinant };
}

function positionIn(project: Project, mapId: string, scope: DragScope): Position | undefined {
  const custom = customIn(project, mapId);
  if (scope.kind === 'group') return custom.groups?.find(group => group.id === scope.groupId)?.position;
  if (scope.kind === 'member') return custom.groups?.find(group => group.id === scope.groupId)?.positions?.[scope.nodeId];
  return custom.positions?.[scope.nodeId];
}

function snapshotOtherPositions(project: Project, mapId: string, scope: DragScope) {
  const custom = structuredClone(customIn(project, mapId));
  if (scope.kind === 'group') {
    const group = custom.groups?.find(item => item.id === scope.groupId);
    if (group) delete group.position;
  } else if (scope.kind === 'member') {
    const group = custom.groups?.find(item => item.id === scope.groupId);
    if (group?.positions) delete group.positions[scope.nodeId];
  } else if (custom.positions) delete custom.positions[scope.nodeId];
  return custom;
}

function assertOnlyPositionChanged(project: Project, mapId: string, scope: DragScope, before: ReturnType<typeof snapshotOtherPositions>) {
  assert.deepEqual(snapshotOtherPositions(project, mapId, scope), before, 'Dragging one target must leave every other saved node and group coordinate unchanged.');
}

async function drag(target: Locator, delta: Position) {
  const start = await center(target);
  await page!.mouse.move(start.x, start.y);
  await page!.mouse.down();
  // Alt+pointerdown cycles the selected UI component in the outer editor.
  // Holding Alt only for movement keeps this gesture on the flow node itself.
  await page!.keyboard.down('Alt');
  await page!.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 5 });
  await page!.mouse.up();
  await page!.keyboard.up('Alt');
  await settle();
  return start;
}

async function cancelGesture(target: Locator, delta: Position, cancelWith: 'Escape' | 'right-button', baseline: string) {
  const start = await center(target);
  await page!.mouse.move(start.x, start.y);
  await page!.mouse.down();
  await page!.keyboard.down('Alt');
  await page!.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 4 });
  if (cancelWith === 'Escape') await page!.keyboard.press('Escape');
  else {
    await page!.mouse.down({ button: 'right' });
    await page!.mouse.up({ button: 'right' });
  }
  await page!.mouse.up();
  await page!.keyboard.up('Alt');
  await settle();
  await expect(inspector()).toHaveAttribute('data-ui-flow-view', 'map');
  await expect(page!.getByRole('menu')).toHaveCount(0);
  await assertNoWrite(baseline);
}

async function runTransformCase(item: TransformCase, fixtureDirectory: string, profile: string) {
  const mapId = mapForCase(item.id), groupId = flowIds.groupPrefix + mapId.replace(flowIds.mapPrefix, '');
  const projectFile = path.join(fixtureDirectory, 'project.vns.json');
  await fs.mkdir(fixtureDirectory, { recursive: true });
  await saveProject(projectFile, makeProject({ mapId, transform: item }));
  await startEditor(`${item.id}-first`, projectFile, profile);
  await selectCanvasScale(item.canvasScale);
  await selectMap(mapId);
  await setGraphZoom(mapId, item.graphZoom);
  const targetNode = flowNode(mapId, flowIds.target);
  const startBytes = await fs.readFile(projectFile, 'utf8');
  const cancellation = item.id === 'component-scale-2' ? 'Escape' : item.id === 'parent-rotate-90' ? 'right-button' : undefined;
  if (cancellation) {
    await check(`${item.label} 下 ${cancellation === 'Escape' ? 'Escape' : '右键'} 取消不选中、不写入`, async () => {
      await cancelGesture(targetNode, item.delta, cancellation, startBytes);
      await screenshot(`${item.id}-cancel-${cancellation === 'Escape' ? 'escape' : 'right'}`);
    });
  }

  const matrix = await actualTransform(mapId);
  const expected = localDelta(matrix, item.delta, item.canvasScale / 100, item.graphZoom / 100);
  const dragEvidence: Record<string, unknown> = { id: item.id, label: item.label, canvasScale: item.canvasScale, graphZoom: item.graphZoom, matrix, screenDelta: item.delta, localDelta: expected, coordinates: {} };

  const scopes: DragScope[] = [
    { kind: 'group', groupId },
    { kind: 'member', groupId, nodeId: flowIds.source(0) },
    { kind: 'entry', nodeId: flowIds.target },
  ];
  for (const scope of scopes) {
    if (scope.kind === 'member') {
      await groupCard(mapId, groupId).dblclick();
      await expect(component(mapId).locator('[data-flow-breadcrumb]')).toBeVisible();
      await expect(flowNode(mapId, scope.nodeId)).toBeVisible();
    } else if (scope.kind === 'entry' && await component(mapId).locator('[data-flow-breadcrumb]').count()) {
      await component(mapId).locator('[data-flow-breadcrumb]').getByRole('button', { name: '返回剧情图', exact: true }).click();
    }
    const target = scope.kind === 'group' ? groupCard(mapId, scope.groupId) : flowNode(mapId, scope.kind === 'member' ? scope.nodeId : scope.nodeId);
    await expect(target).toBeVisible();
    const beforeProject = await readProject();
    const oldPosition = positionIn(beforeProject, mapId, scope);
    assert.ok(oldPosition, `Expected an initial saved position for ${scope.kind}.`);
    const otherPositions = snapshotOtherPositions(beforeProject, mapId, scope);
    const beforeCenter = await center(target);
    const effectiveDelta = localDelta(matrix, item.delta, item.canvasScale / 100, item.graphZoom / 100);
    assert.ok(oldPosition.x + effectiveDelta.x > 0 && oldPosition.y + effectiveDelta.y > 0, 'The initial location must leave room for every matrix displacement.');
    await drag(target, item.delta);
    await assertScreenDelta(target, beforeCenter, item.delta);
    await expect(button('保存界面')).toBeEnabled();

    await check(`${item.label}：${scope.kind} 真实鼠标拖动、坐标范围与撤销重做`, async () => {
      await button('撤销').click();
      await expect.poll(async () => {
        const afterUndo = await center(target);
        return Math.hypot(afterUndo.x - beforeCenter.x, afterUndo.y - beforeCenter.y);
      }, { timeout: 5000 }).toBeLessThan(2.5);
      await button('重做').click();
      await assertScreenDelta(target, beforeCenter, item.delta);
      const saved = await save();
      const newPosition = positionIn(saved, mapId, scope);
      assert.ok(newPosition);
      assert.ok(Math.abs(newPosition.x - oldPosition.x - effectiveDelta.x) < .75, JSON.stringify({ oldPosition, newPosition, expected: effectiveDelta, matrix }));
      assert.ok(Math.abs(newPosition.y - oldPosition.y - effectiveDelta.y) < .75, JSON.stringify({ oldPosition, newPosition, expected: effectiveDelta, matrix }));
      assertOnlyPositionChanged(saved, mapId, scope, otherPositions);
      (dragEvidence.coordinates as Record<string, unknown>)[scope.kind] = { before: oldPosition, after: newPosition };
      await screenshot(`${item.id}-drag-${scope.kind}`);
    });
  }

  const finalProject = await readProject();
  const expectedPositions = structuredClone(customIn(finalProject, mapId));
  assert.ok(expectedPositions.groups?.find(group => group.id === groupId)?.position);
  assert.ok(expectedPositions.groups?.find(group => group.id === groupId)?.positions?.[flowIds.source(0)]);
  assert.ok(expectedPositions.positions?.[flowIds.target]);
  (evidence.transforms as unknown[]).push(dragEvidence);
  await stopEditor();

  await startEditor(`${item.id}-reopened`, projectFile, profile);
  await selectCanvasScale(item.canvasScale);
  await selectMap(mapId);
  await expect(groupCard(mapId, groupId)).toHaveAttribute('data-flow-manual', '');
  await expect(flowNode(mapId, flowIds.target)).toHaveAttribute('data-flow-manual', '');
  await groupCard(mapId, groupId).dblclick();
  await expect(flowNode(mapId, flowIds.source(0))).toHaveAttribute('data-flow-manual', '');
  const reopened = await readProject();
  assert.deepEqual(customIn(reopened, mapId), expectedPositions, 'All three coordinate scopes must survive a save and app restart.');
  assert.deepEqual(await fs.readFile(projectFile, 'utf8'), savedBytes);
  await check(`${item.label}：保存后关闭并重开保留三种拖动坐标`, async () => {
    await screenshot(`${item.id}-reopened`);
  });
  await stopEditor();
}

async function openPlayerPreview(mapId: string) {
  await button('剧情图预览').click();
  const preview = page!.getByRole('dialog', { name: '剧情图预览', exact: true });
  await expect(preview).toBeVisible();
  await preview.getByLabel('预览玩家进度', { exact: true }).selectOption('partial');
  return preview;
}

async function setRouteLockMode(mode: 'hide' | 'dim' | 'show') {
  const summary = flowGroup('flow-player').locator(':scope > summary');
  await openDisclosureAncestors(summary);
  await page!.getByLabel('可进入的剧情', { exact: true }).selectOption(mode === 'show' ? 'all' : 'reached');
  if (mode !== 'show') {
    await page!.getByLabel('未到达的节点', { exact: true }).selectOption('show');
    await page!.getByLabel('未到达的连线', { exact: true }).selectOption(mode);
  }
  await save();
}

async function runPartialEdgeCase(item: typeof edgeFixtures[number], expected: 'unlocked-from-ninth' | 'locked-with-unrelated-members') {
  const mapId = flowIds.mapPrefix + item.id.replaceAll('-', '_');
  const projectFile = path.join(item.fixture, 'project.vns.json');
  await fs.mkdir(item.fixture, { recursive: true });
  await saveProject(projectFile, makeProject({ mapId, edgeScenario: item.mode }));
  await startEditor(`${item.id}-preview`, projectFile, item.profile);
  await selectCanvasScale(50);
  await selectMap(mapId);
  await setRouteLockMode('hide');
  const groupId = flowIds.groupPrefix + mapId.replace(flowIds.mapPrefix, '');
  const edge = component(mapId).locator(`[data-flow-edge-from="${groupId}"][data-flow-edge-to="${flowIds.target}"]`);

  await check(`${item.id}：部分进度下九成员合并连线的解锁判定`, async () => {
    let preview = await openPlayerPreview(mapId);
    const saved = await readProject();
    const map = componentIn(saved, mapId);
    const flatEntries = map.list?.flowContent?.custom?.entries ?? [];
    const allIds = flatEntries.map(entry => entry.nodeId);
    const firstHalf = new Set(allIds.slice(0, Math.ceil(allIds.length / 2)));
    const reachedExpected = item.mode === 'ninth-reached'
      ? [...firstHalf, flowIds.source(8)]
      : [...firstHalf, flowIds.target];
    evidence.partialEdges = evidence.partialEdges as unknown[];
    assert.ok(firstHalf.size >= 9, 'The fixture needs a partial-progress prefix made only from decoys and the common target.');
    if (expected === 'unlocked-from-ninth') {
      assert.equal(firstHalf.has(flowIds.target), true);
      assert.equal(firstHalf.has(flowIds.source(0)), false);
      assert.equal(firstHalf.has(flowIds.source(8)), false);
      assert.ok(reachedExpected.includes(flowIds.source(8)));
      await expect(edge).toHaveCount(1);
      await expect(edge).not.toHaveAttribute('opacity', '0.35');
      const pathData = await edge.getAttribute('data-flow-edge-paths');
      const paths = JSON.parse(pathData ?? '[]') as { nodeIds: string[] }[];
      assert.equal(await edge.getAttribute('data-flow-edge-path-count'), '8');
      assert.ok(paths.length === 8 && paths.every(route => !route.nodeIds.includes(flowIds.source(8))), 'The ninth endpoint must be absent from bounded representative paths.');
      await screenshot('partial-ninth-route-unlocked-hide');
      await preview.getByRole('button', { name: '关闭剧情图预览', exact: true }).click();

      await setRouteLockMode('dim');
      preview = await openPlayerPreview(mapId);
      await expect(edge).toHaveCount(1);
      await expect(edge).not.toHaveAttribute('opacity', '0.35');
      await screenshot('partial-ninth-route-unlocked-dim');
      await preview.getByRole('button', { name: '关闭剧情图预览', exact: true }).click();

      await setRouteLockMode('show');
      preview = await openPlayerPreview(mapId);
      await expect(edge).toHaveCount(1);
      await screenshot('partial-ninth-route-unrestricted');
      await preview.getByRole('button', { name: '关闭剧情图预览', exact: true }).click();
      (evidence.partialEdges as unknown[]).push({ fixture: item.id, mode: 'partial', reached: reachedExpected, representativePathCount: paths.length,
        ninthEndpointOmittedFromPaths: true, results: ['hide: visible', 'dim: full opacity', 'unrestricted: visible'] });
    } else {
      assert.equal(firstHalf.has(flowIds.target), false);
      assert.ok(firstHalf.size >= 9 && [...firstHalf].every(id => id.startsWith('flow_fix_decoy_')));
      assert.equal(reachedExpected.includes(flowIds.target), true);
      const card = groupCard(mapId, groupId);
      await expect(card).toHaveCount(1);
      await expect(card).not.toHaveAttribute('data-flow-state', 'disabled');
      await expect(flowNode(mapId, flowIds.target)).not.toHaveAttribute('data-flow-state', 'disabled');
      await expect(edge).toHaveCount(0);
      await screenshot('partial-unrelated-members-edge-hidden');
      await preview.getByRole('button', { name: '关闭剧情图预览', exact: true }).click();

      await setRouteLockMode('dim');
      preview = await openPlayerPreview(mapId);
      await expect(edge).toHaveCount(1);
      await expect(edge).toHaveAttribute('opacity', '0.35');
      await screenshot('partial-unrelated-members-edge-dim');
      await preview.getByRole('button', { name: '关闭剧情图预览', exact: true }).click();
      (evidence.partialEdges as unknown[]).push({ fixture: item.id, mode: 'partial', reached: reachedExpected,
        groupAndTargetReached: true, relevantMemberRoutesReached: false, results: ['hide: absent', 'dim: opacity 0.35'] });
    }
    await expect(button('保存界面')).toBeDisabled();
    await assertNoWrite(savedBytes);
  });
  await stopEditor();
}

try {
  await fs.mkdir(output, { recursive: true });
  (report as { outputDirectory?: string; buildBefore?: unknown }).outputDirectory = output;
  (report as { buildBefore?: unknown }).buildBefore = await fingerprints();

  for (const item of transformCases) {
    const paths = fixturePaths.find(candidate => candidate.id === item.id)!;
    await runTransformCase(item, paths.fixture, paths.profile);
  }

  await runPartialEdgeCase(edgeFixtures[0], 'unlocked-from-ninth');
  await runPartialEdgeCase(edgeFixtures[1], 'locked-with-unrelated-members');
  assert.deepEqual(pageErrors, [], 'The renderer must not raise runtime errors.');
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
    (report as { scopeAtFailure?: string | null }).scopeAtFailure = await inspector().getAttribute('data-ui-flow-view').catch(() => undefined);
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
