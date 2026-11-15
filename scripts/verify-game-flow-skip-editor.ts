import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { flowNodeIds, flowStepNodeId, gameFlowRoute } from '../src/core/game-flow-graph';
import { createProject, projectSchema, type BlueprintGraph, type Project } from '../src/core/model';
import { arrangePerformanceTimeline } from '../src/core/performance-timeline';
import { addProjectGraphs, projectGraphs } from '../src/core/project-resources';
import { createVisualObject } from '../src/core/visual-object';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Pending acceptance. Authoring this file does not launch Electron or validate
// the product. Run it after all implementations and the shared build freeze:
// corepack pnpm exec tsx scripts/verify-game-flow-skip-editor.ts
// Runtime mouse/fast-forward timing belongs to the companion native suite.
if (process.env.VNS_INSTALLED_EXE) throw new Error('流程跳过权限验收只允许隔离的源码构建版。');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonical = (value: string) => path.resolve(value).toLowerCase();
assert.equal(canonical(process.cwd()), canonical(root), '请从 editor 工作区运行桌面验收。');
const permittedRoot = path.join(root, 'artifacts/game-flow-skip-2026-11-14/editor');
const requestedRoot = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? permittedRoot);
assert.equal(canonical(requestedRoot), canonical(permittedRoot), '输出只能使用本轮 game-flow-skip-2026-11-14/editor 目录。');
const output = path.join(permittedRoot, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`);
const projectDir = path.join(output, 'project'), profile = path.join(output, 'profile');
const projectFile = path.join(projectDir, 'project.vns.json');
const screenshots = path.join(output, 'screenshots'), savedEvidence = path.join(output, 'saved-project-evidence');
function inside(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
for (const candidate of [projectDir, profile, projectFile, screenshots, savedEvidence]) {
  assert.ok(inside(output, candidate), '工程、profile 和证据必须位于本次新目录内：' + candidate);
}

/** Check only exact output ancestors; never enumerate artifacts, other runs,
 * historical cleanup exceptions, or the real author's project. */
async function prepareOutput() {
  const workspace = await fs.realpath(root);
  let current = root;
  for (const part of path.relative(root, output).split(path.sep)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (current === output) assert.equal(stat, undefined, '每次验收必须创建全新的时间戳目录。');
    if (stat) assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), '拒绝非目录或链接输出路径：' + current);
    else await fs.mkdir(current);
    assert.ok(inside(workspace, await fs.realpath(current)), '输出路径离开工作区：' + current);
  }
}

const ids = {
  project: 'game_flow_skip_acceptance', chapter: 'game_flow_skip_chapter', scene: 'game_flow_skip_scene',
  start: 'game_flow_skip_start', passage: 'game_flow_skip_passage', line: 'game_flow_skip_line', end: 'game_flow_skip_end',
  graph: 'game_flow_skip_shared_timeline', event: 'game_flow_skip_event', visual: 'game_flow_skip_visual',
  object: 'game_flow_skip_text', tail: 'game_flow_skip_tail', track: 'game_flow_skip_track',
  beforeTitle: 'game_flow_skip_before_title', beforeNewGame: 'game_flow_skip_before_new_game',
} as const;
const names = { beforeTitle: '标题前 · 跳过权限调用', beforeNewGame: '新游戏前 · 跳过权限调用' } as const;
const skipLabel = '允许玩家跳过这一项';
const steps = {
  beforeTitle: { id: ids.beforeTitle, nodeId: flowStepNodeId(ids.beforeTitle), name: names.beforeTitle },
  beforeNewGame: { id: ids.beforeNewGame, nodeId: flowStepNodeId(ids.beforeNewGame), name: names.beforeNewGame },
} as const;
type StepKey = keyof typeof steps;

function createFixture(): Project {
  const project = createProject('流程跳过权限桌面验收');
  project.id = ids.project;
  project.resourceSettings = { importMode: 'copy', directory: 'assets', syncFolders: false };
  project.playerDefaults = { textSpeed: 0, masterVolume: 0 };
  project.chapters = [{ id: ids.chapter, name: '验收章节' }];
  project.scenes = [{ id: ids.scene, chapterId: ids.chapter, name: '验收场景' }];
  project.entryId = ids.start;
  project.nodes = [
    { id: ids.start, kind: 'start', name: '验收故事入口', sceneId: ids.scene, x: 40, y: 120, next: ids.passage },
    { id: ids.passage, kind: 'passage', name: '验收正文', sceneId: ids.scene, x: 300, y: 120, next: ids.end,
      lines: [{ id: ids.line, text: '跳过权限保存在流程调用步骤中。', actions: [] }] },
    { id: ids.end, kind: 'end', name: '返回标题', sceneId: ids.scene, x: 560, y: 120 },
  ];

  // No asset, font, media, or external service is needed for this timeline.
  const text = createVisualObject('text');
  Object.assign(text, { instanceId: ids.object, name: '共享时间轴文字', text: '同一演出按步骤保存跳过权限。', duration: 4, width: .8, height: .3, fontSize: 48 });
  const graph = blueprintFromPerformance(project, [text], '共享文字时间轴');
  graph.id = ids.graph; graph.timelineComponent = true; graph.performanceKind = 'standalone';
  assert.equal(graph.nodes.length, 2, '文字验收蓝图应只有入口和画面片段。');
  const nodeIds = new Map(graph.nodes.map((node, index) => [node.id, index === 0 ? ids.event : ids.visual]));
  for (const node of graph.nodes) node.id = nodeIds.get(node.id)!;
  for (const link of graph.links) { link.fromNodeId = nodeIds.get(link.fromNodeId)!; link.toNodeId = nodeIds.get(link.toNodeId)!; }
  addProjectGraphs(project, graph);
  arrangePerformanceTimeline(project, graph, [{ nodeId: ids.visual, trackId: ids.track, at: 0, duration: text.duration }], [{ id: ids.track, name: '文字画面轨道' }]);
  assert.ok(graph.timeline?.tailNodeId, '验收时间轴应包含等待全部片段结束的尾节点。');
  const generatedTailId = graph.timeline.tailNodeId;
  graph.nodes.find(node => node.id === generatedTailId)!.id = ids.tail;
  graph.timeline.tailNodeId = ids.tail;
  for (const [index, link] of graph.links.entries()) {
    link.id = 'game_flow_skip_wire_' + index;
    if (link.fromNodeId === generatedTailId) link.fromNodeId = ids.tail;
    if (link.toNodeId === generatedTailId) link.toNodeId = ids.tail;
  }
  // Deliberately allow ordinary blueprint playback to skip: the protected
  // flow call must retain its own false without rewriting this shared setting.
  graph.playback = { clickSkip: true, onComplete: 'next', transition: { mode: 'color', outDuration: .15, hold: .05, inDuration: .2, color: '#223344' } };
  project.gameFlow = {
    schemaVersion: 1,
    beforeTitle: { repeat: 'launch', revision: 'skip-qa-1', steps: [{ id: ids.beforeTitle, kind: 'blueprint', name: names.beforeTitle, graphId: ids.graph, allowSkip: false, inputs: {} }] },
    beforeNewGame: [{ id: ids.beforeNewGame, kind: 'blueprint', name: names.beforeNewGame, graphId: ids.graph, allowSkip: true, inputs: {} }],
    connections: {
      [flowNodeIds.launch]: steps.beforeTitle.nodeId, [steps.beforeTitle.nodeId]: flowNodeIds.title,
      [flowNodeIds.newGame]: steps.beforeNewGame.nodeId, [steps.beforeNewGame.nodeId]: flowNodeIds.story,
    },
    positions: {
      [flowNodeIds.launch]: { x: 40, y: 80 }, [steps.beforeTitle.nodeId]: { x: 340, y: 80 }, [flowNodeIds.title]: { x: 640, y: 80 },
      [flowNodeIds.newGame]: { x: 40, y: 350 }, [steps.beforeNewGame.nodeId]: { x: 340, y: 350 }, [flowNodeIds.story]: { x: 640, y: 350 },
      [flowNodeIds.load]: { x: 640, y: 580 },
    },
  };
  return projectSchema.parse(project);
}

interface SavedProject { project: Project; raw: Project; bytes: string }
interface ProcessRecord { launch: number; pid?: number; exited: boolean; exitCode: number | null; signalCode: string | null }
let initial: Project, baseline: Project, baselineGraph: BlueprintGraph;
let app: ElectronApplication | undefined, page: Page | undefined, ownedChild: ChildProcess | undefined;
let prepared = false, traceStarted = false, launchNumber = 0, phase = '准备隔离工程';
const checks: { name: string; durationMs: number }[] = [], errors: string[] = [], traces: string[] = [], temporaryNames: string[] = [];
const processes: ProcessRecord[] = [];
const evidence = {
  saves: [] as { stage: string; beforeTitle: boolean; beforeNewGame: boolean; graphId: string; graphPlayback: BlueprintGraph['playback']; projectSha256: string; graphSha256: string }[],
  screenshots: [] as { file: string; width: number; height: number; originalWidth: number; originalHeight: number; sha256: string }[],
  savedProjects: [] as { file: string; sha256: string }[],
};
const report: Record<string, unknown> = {
  status: 'running', plannedChecks: 6, renderer: 'compiled source editor', projectFile, output,
  checks, errors, traces, processes, evidence, temporaryPaths: [projectDir, profile],
  scope: ['只使用本次新建工程与 profile，不读取真实作者工程或历史 artifacts。', '只验证编辑器的步骤开关、撤销重做和实际保存重开；不启动游戏或调用 AI。', '所有截图最长边不超过 1280 像素，报告、trace 和最终保存文件保留。'],
};
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const writeReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const flow = () => page!.getByRole('region', { name: '流程图', exact: true });
const canvas = () => flow().locator('.react-flow:visible');
const node = (id: string) => canvas().locator(`.react-flow__node[data-id="${id}"]`);
const inspector = () => page!.getByLabel('流程节点属性', { exact: true });
const skip = () => inspector().getByRole('checkbox', { name: skipLabel, exact: true });
const settle = () => page!.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
async function readSaved(): Promise<SavedProject> {
  const bytes = await fs.readFile(projectFile, 'utf8'), raw = JSON.parse(bytes) as Project;
  return { bytes, raw, project: projectSchema.parse(raw) };
}
function sharedGraph(project: Project) {
  const matches = projectGraphs(project).filter(graph => graph.id === ids.graph);
  assert.equal(matches.length, 1, '两个调用必须引用同一个实际时间轴。');
  return matches[0];
}
function assertSavedFlags(saved: SavedProject, beforeTitle: boolean, beforeNewGame: boolean) {
  assert.ok(saved.raw.gameFlow, '实际保存文件必须包含游戏流程。');
  const rawTitle = saved.raw.gameFlow.beforeTitle.steps, rawNewGame = saved.raw.gameFlow.beforeNewGame;
  assert.equal(rawTitle.length, 1); assert.equal(rawNewGame.length, 1);
  for (const [step, id, expected] of [[rawTitle[0], ids.beforeTitle, beforeTitle], [rawNewGame[0], ids.beforeNewGame, beforeNewGame]] as const) {
    assert.equal(step.id, id); assert.equal(step.kind, 'blueprint');
    assert.ok(step.kind === 'blueprint'); assert.equal(step.graphId, ids.graph);
    // Reading through a schema alone could hide an omitted false default.
    assert.ok(Object.hasOwn(step, 'allowSkip'), 'allowSkip 必须明确写入实际工程：' + id);
    assert.equal(step.allowSkip, expected, '实际保存的步骤权限不符：' + id);
  }
  assert.ok(baseline.gameFlow);
  const expectedFlow = structuredClone(baseline.gameFlow);
  expectedFlow.beforeTitle.steps[0].allowSkip = beforeTitle; expectedFlow.beforeNewGame[0].allowSkip = beforeNewGame;
  assert.deepEqual(saved.project.gameFlow, expectedFlow, '切换跳过开关不能改写步骤归属、连线、执行策略、位置或另一调用。');
  assert.deepEqual(sharedGraph(saved.project).playback, baselineGraph.playback, '步骤开关不能改写共享 graph.playback。');
  assert.deepEqual(sharedGraph(saved.project), baselineGraph, '共享时间轴的片段、时长和配置必须保持一致。');
  for (const [phase, id] of [['beforeTitle', ids.beforeTitle], ['beforeNewGame', ids.beforeNewGame]] as const) {
    const route = gameFlowRoute(saved.project, phase); assert.equal(route.complete, true); assert.deepEqual(route.steps.map(step => step.id), [id]);
  }
}
async function fingerprints() {
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  const files = ['dist/index.html', 'dist-desktop/main.cjs', 'dist-desktop/preload.cjs', ...[...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => 'dist/' + match[1].slice(2))];
  assert.ok(files.some(file => file.startsWith('dist/assets/') && file.endsWith('.js')), '先完成统一构建，再运行桌面验收。');
  return Promise.all([...new Set(files)].map(async file => ({ file, sha256: hash(await fs.readFile(path.join(root, file))) })));
}
async function preserveProject(name: string) {
  const destination = path.join(savedEvidence, name + '.vns.json'), bytes = await fs.readFile(projectFile);
  await fs.writeFile(destination, bytes);
  evidence.savedProjects.push({ file: path.relative(output, destination), sha256: hash(bytes) });
}
async function saveFlags(beforeTitle: boolean, beforeNewGame: boolean, stage: string) {
  await button('保存工程').click();
  await expect(button('保存工程')).toBeEnabled({ timeout: 30000 });
  await expect(page!.locator('.dirty-dot')).toHaveCount(0, { timeout: 30000 });
  await settle();
  const saved = await readSaved(); assertSavedFlags(saved, beforeTitle, beforeNewGame);
  const graph = sharedGraph(saved.project);
  evidence.saves.push({ stage, beforeTitle, beforeNewGame, graphId: graph.id, graphPlayback: graph.playback, projectSha256: hash(saved.bytes), graphSha256: hash(JSON.stringify(graph)) });
  await preserveProject(stage);
  return saved;
}
async function check(name: string, work: () => Promise<void>) {
  phase = name; const start = Date.now(); await work(); checks.push({ name, durationMs: Date.now() - start });
  await writeReport(); console.log('通过：' + name);
}
async function screenshot(name: string) {
  await settle();
  const native = await app!.browserWindow(page!);
  const image = await native.evaluate(async window => {
    const capture = await window.webContents.capturePage(), original = capture.getSize();
    if (!original.width || !original.height) throw new Error('截图尺寸为空。');
    const scale = Math.min(1, 1280 / Math.max(original.width, original.height));
    const resized = capture.resize({ width: Math.max(1, Math.round(original.width * scale)), height: Math.max(1, Math.round(original.height * scale)), quality: 'best' });
    return { png: resized.toPNG().toString('base64'), size: resized.getSize(), original };
  });
  assert.ok(Math.max(image.size.width, image.size.height) <= 1280, '保存截图最长边不能超过 1280。');
  const file = path.join(screenshots, name + '.png'), bytes = Buffer.from(image.png, 'base64');
  await fs.writeFile(file, bytes);
  evidence.screenshots.push({ file: path.relative(output, file), width: image.size.width, height: image.size.height, originalWidth: image.original.width, originalHeight: image.original.height, sha256: hash(bytes) });
}
async function launch() {
  app = await launchDesktopFixture({ root, profile, projectFile });
  // Keep the ChildProcess now; ElectronApplication.process() can throw once
  // close() has disposed Playwright's application connection.
  ownedChild = app.process(); launchNumber++;
  processes.push({ launch: launchNumber, pid: ownedChild.pid, exited: false, exitCode: ownedChild.exitCode, signalCode: ownedChild.signalCode });
  page = await app.firstWindow(); page.setDefaultTimeout(18000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(initial.name, { timeout: 45000 });
  assert.equal(canonical(fileURLToPath(page.url())), canonical(path.join(root, 'dist/index.html')), '必须使用统一构建后的 dist 编辑器。');
  report.rendererUrl = page.url();
  // TSX's function-name helper is needed by serialized Playwright callbacks.
  await page.evaluate('globalThis.__name = value => value');
  const native = await app.browserWindow(page);
  await native.evaluate(window => {
    if (window.isMinimized()) window.restore(); if (window.isMaximized()) window.unmaximize();
    window.setContentSize(1280, 900); window.show(); window.focus(); window.webContents.setBackgroundThrottling(false);
  });
  await expect.poll(() => page!.evaluate(() => Math.max(Math.abs(innerWidth - 1280), Math.abs(innerHeight - 900)))).toBeLessThanOrEqual(2);
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false }); traceStarted = true;
}
async function closeOwnedApp() {
  if (!app) return;
  const owned = app, child = ownedChild;
  assert.ok(child, '关闭前必须保留本次 ChildProcess 句柄。');
  const record = processes.find(item => item.launch === launchNumber)!;
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  const failures: unknown[] = [];
  if (traceStarted) {
    const name = 'trace-' + String(launchNumber).padStart(2, '0') + '.zip';
    try { await owned.context().tracing.stop({ path: path.join(output, name) }); traces.push(name); }
    catch (error) { failures.push(error); report.traceError = String(error); }
    traceStarted = false;
  }
  try { await owned.close(); }
  catch (error) { failures.push(error); }
  try { await expect.poll(exited, { timeout: 15000 }).toBe(true); }
  catch (error) { failures.push(error); }
  record.exited = exited(); record.exitCode = child.exitCode; record.signalCode = child.signalCode;
  if (record.exited) { app = undefined; page = undefined; ownedChild = undefined; }
  if (failures.length) throw new AggregateError(failures, '本次编辑器关闭或 trace 保存失败。');
}
async function openFlow() {
  await page!.locator('[data-workspace-tab="flowchart"]').click();
  await expect(flow()).toBeVisible(); await expect(flow()).toHaveAttribute('data-flow-scope', 'game');
  await expect(canvas()).toHaveCount(1);
  const showProperties = button('显示节点属性'); if (await showProperties.isVisible()) await showProperties.click();
}
async function settleCanvas() {
  await expect.poll(() => canvas().evaluate(async element => {
    const viewport = element.querySelector('.react-flow__viewport'); if (!viewport) return false;
    const transform = getComputedStyle(viewport).transform;
    for (let frame = 0; frame < 4; frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (!viewport.isConnected || getComputedStyle(viewport).transform !== transform) return false;
    }
    return true;
  }), { timeout: 18000 }).toBe(true);
}
async function selectBySearch(id: string, name: string) {
  await page!.getByLabel('搜索流程图', { exact: true }).fill(name);
  const exactName = new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
  const result = page!.getByRole('region', { name: '流程图搜索结果', exact: true }).getByRole('button').filter({ has: page!.locator('strong', { hasText: exactName }) });
  await expect(result).toHaveCount(1); await result.click();
  await expect(node(id)).toHaveClass(/selected/); await expect(canvas().locator('.react-flow__node.selected')).toHaveCount(1);
  await expect(inspector()).toHaveCount(1); await settleCanvas();
}
async function expectStep(key: StepKey, checked: boolean) {
  const step = steps[key];
  await expect(node(step.nodeId)).toHaveClass(/selected/);
  await expect(inspector().locator('h3')).toHaveText(step.name);
  await expect(inspector().getByLabel('流程节点说明', { exact: true })).toHaveValue(step.name);
  await expect(inspector().getByLabel('节点蓝图', { exact: true })).toHaveValue(ids.graph);
  await expect(skip()).toHaveCount(1); await expect(skip()).toBeVisible(); await expect(skip()).toBeEnabled();
  await expect(skip()).toBeChecked({ checked });
  const skipExplanation = inspector().getByText('关闭时，点击空白和快进不会缩短演出等待；演出里的按钮、确认和页面操作仍可使用。', { exact: true });
  await expect(skipExplanation).toHaveCount(1); await expect(skipExplanation).toBeVisible();
}
async function selectStep(key: StepKey, checked: boolean, method: 'search' | 'click' = 'search') {
  const step = steps[key];
  if (method === 'search') await selectBySearch(step.nodeId, step.name);
  else {
    await button('适应全图').click(); await settleCanvas();
    await expect(node(step.nodeId)).toBeVisible(); await node(step.nodeId).locator('.graph-node-title strong').click();
    await expect(canvas().locator('.react-flow__node.selected')).toHaveCount(1);
  }
  await expectStep(key, checked);
}

try {
  await prepareOutput(); prepared = true;
  await fs.mkdir(projectDir); temporaryNames.push('project'); await fs.mkdir(profile); temporaryNames.push('profile');
  await fs.mkdir(screenshots); await fs.mkdir(savedEvidence);
  initial = createFixture(); await saveProject(projectFile, initial);
  const initialSave = await readSaved(); baseline = initialSave.project; baselineGraph = sharedGraph(baseline);
  assert.equal(baseline.assets.length, 0); assert.equal(baselineGraph.timelineComponent, true); assert.ok(baselineGraph.timeline);
  assert.equal(baselineGraph.playback?.clickSkip, true); assertSavedFlags(initialSave, false, true);
  await preserveProject('initial-isolated-project');
  report.fixture = { ids, steps, graphPlayback: baselineGraph.playback, graphSha256: hash(JSON.stringify(baselineGraph)), assetCount: 0 };
  report.fingerprintsBefore = await fingerprints(); await writeReport(); await launch();

  await check('同一时间轴的标题前 false 与新游戏前 true 按选中步骤显示', async () => {
    const savedBytes = (await readSaved()).bytes;
    await openFlow(); await selectStep('beforeTitle', false); await screenshot('01-before-title-protected');
    await selectStep('beforeNewGame', true); await screenshot('02-before-new-game-allowed');
    await selectBySearch(flowNodeIds.launch, '游戏启动'); await expect(inspector().getByRole('checkbox', { name: skipLabel, exact: true })).toHaveCount(0);
    await selectStep('beforeTitle', false); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
    assert.equal((await readSaved()).bytes, savedBytes, '只选择流程节点不能修改实际工程。');
    assertSavedFlags(await readSaved(), false, true);
  });

  await check('勾选标题前调用后实际点击来回选择不串状态，保存两项 true', async () => {
    await selectStep('beforeTitle', false); await skip().check(); await expectStep('beforeTitle', true);
    await expect(page!.locator('.dirty-dot')).toHaveCount(1);
    await selectStep('beforeNewGame', true, 'click'); await selectStep('beforeTitle', true, 'click');
    await screenshot('03-before-title-allowed'); await saveFlags(true, true, 'both-calls-allowed');
  });

  await check('取消新游戏前调用只影响本步骤，另一调用与共享播放配置保留', async () => {
    await selectStep('beforeNewGame', true); await skip().uncheck(); await expectStep('beforeNewGame', false);
    await selectStep('beforeTitle', true, 'click'); await selectStep('beforeNewGame', false, 'click');
    await screenshot('04-new-game-only-protected'); await saveFlags(true, false, 'new-game-only-protected');
  });

  await check('取消标题前调用可撤销重做，每次实际保存保留准确权限', async () => {
    await selectStep('beforeTitle', true); await skip().uncheck(); await expectStep('beforeTitle', false);
    await selectStep('beforeNewGame', false, 'click'); await selectStep('beforeTitle', false, 'click');
    await saveFlags(false, false, 'both-calls-protected');
    await expect(button('撤销')).toBeEnabled(); await button('撤销').click(); await expectStep('beforeTitle', true);
    await selectStep('beforeNewGame', false, 'click'); await selectStep('beforeTitle', true, 'click');
    await screenshot('05-title-skip-undo'); await saveFlags(true, false, 'title-skip-undone');
    await expect(button('重做')).toBeEnabled(); await button('重做').click(); await expectStep('beforeTitle', false);
    await selectStep('beforeNewGame', false, 'click'); await selectStep('beforeTitle', false, 'click');
    await screenshot('06-title-skip-redo'); await saveFlags(false, false, 'title-skip-redone');
  });

  await check('真实保存关闭重开保留标题前 false、另一调用 true 与 graph.playback', async () => {
    await selectStep('beforeNewGame', false); await skip().check(); await expectStep('beforeNewGame', true);
    await selectStep('beforeTitle', false, 'click');
    const beforeReopen = await saveFlags(false, true, 'final-before-reopen'); await screenshot('07-final-before-reopen');
    await closeOwnedApp(); await launch(); await openFlow();
    await selectStep('beforeTitle', false); await screenshot('08-reopened-title-protected');
    await selectStep('beforeNewGame', true); await screenshot('09-reopened-new-game-allowed');
    const reopened = await readSaved(); assertSavedFlags(reopened, false, true);
    assert.equal(reopened.bytes, beforeReopen.bytes, '关闭重开不应重写已保存的工程。');
    await expect(page!.locator('.dirty-dot')).toHaveCount(0); await preserveProject('reopened-actual-project');
  });

  await check('重开后的独立切换和撤销重做保留最终 false／true 工程证据', async () => {
    await selectStep('beforeNewGame', true); await skip().uncheck(); await expectStep('beforeNewGame', false);
    await selectStep('beforeTitle', false, 'click'); await button('撤销').click();
    await selectStep('beforeNewGame', true, 'click'); await selectStep('beforeTitle', false, 'click');
    await button('重做').click(); await selectStep('beforeNewGame', false, 'click'); await selectStep('beforeTitle', false, 'click');
    await button('撤销').click(); await selectStep('beforeNewGame', true, 'click');
    await saveFlags(false, true, 'final-editor-project'); await screenshot('10-final-new-game-allowed');
    await selectStep('beforeTitle', false, 'click'); await screenshot('11-final-title-protected');
    assertSavedFlags(await readSaved(), false, true); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
    assert.deepEqual(errors, [], '编辑器不应产生未捕获异常。');
  });

  assert.equal(checks.length, 6); report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.phase = phase; report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1;
  if (page && app) await screenshot('failure').catch(() => undefined);
} finally {
  try { await closeOwnedApp(); }
  catch (error) { report.closeError = String(error); report.status = 'failed'; process.exitCode = 1; }
  if (prepared) {
    if (temporaryNames.includes('project')) {
      try { await preserveProject('last-saved-project'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { report.evidenceError = String(error); report.status = 'failed'; process.exitCode = 1; } }
    }
    try {
      if (app || processes.some(record => !record.exited)) throw new Error('本次编辑器尚未确认退出，保留其隔离工程和 profile。');
      // The shared helper resolves every exact owned target and checks it is
      // inside this fresh output before any recursive removal. Evidence is a
      // sibling of project/profile, so it is retained without traversing them.
      const cleanup = await cleanVerificationDirectories(output, temporaryNames); report.cleanup = cleanup; assert.deepEqual(cleanup.errors, []);
      const remaining = await Promise.all(temporaryNames.map(async name => {
        const candidate = path.resolve(output, name); assert.ok(inside(output, candidate));
        const stat = await fs.lstat(candidate).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; });
        return { path: candidate, absent: !stat };
      }));
      report.cleanupVerification = remaining; assert.ok(remaining.every(item => item.absent), '本次临时工程和 profile 应全部清理。');
    } catch (error) { report.cleanupError = String(error); report.status = 'failed'; process.exitCode = 1; }
    if (report.fingerprintsBefore) {
      try { report.fingerprintsAfter = await fingerprints(); assert.deepEqual(report.fingerprintsAfter, report.fingerprintsBefore, '桌面验收期间统一构建必须保持冻结。'); }
      catch (error) { report.buildChanged = String(error); report.status = 'failed'; process.exitCode = 1; }
    }
    if (errors.length) { report.status = 'failed'; process.exitCode = 1; }
    try {
      await fs.writeFile(path.join(output, 'processes.json'), JSON.stringify({ processes }, null, 2));
      await writeReport(); console.log((report.status === 'passed' ? 'PASS: ' : 'FAIL: ') + path.join(output, 'report.json'));
    } catch (error) { console.error('报告未写入：' + String(error)); process.exitCode = 1; }
  }
  if (report.error) console.error(report.error);
}
