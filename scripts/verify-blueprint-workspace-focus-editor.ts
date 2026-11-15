import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createProject, projectSchema, type BlueprintGraph, type Project } from '../src/core/model';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { insertTimelineAction } from '../src/core/performance-timeline';
import { projectGraphs, addProjectGraphs, graphResourceKey } from '../src/core/project-resources';
import { createTimelinePreset, timelineWrapperCall } from '../src/core/timeline-component';
import { createVisualObject } from '../src/core/visual-object';
import { projectToText } from '../src/core/text-script';
import { storyParametersId } from '../src/core/parameter-sets';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Prepared for the coordinator's final acceptance pass. This script neither
// builds the editor nor starts a dev server; it requires the completed build.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Use the isolated compiled development editor.');
const root = path.resolve('.');
const output = path.resolve('artifacts/editor-refinements-2026-11-10/blueprint-workspace', 'editor-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const projectFile = path.join(output, 'project/project.vns.json'), profile = path.join(output, 'profile');
const authorProject = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? '../我的视觉小说1/project.vns.json');
const ids = {
  ordinary: 'qa_workspace_logic', wrapper: 'qa_workspace_wrapper', helper: 'qa_workspace_helper',
  timeline: 'qa_workspace_timeline', alternate: 'qa_workspace_spare_timeline',
  ordinaryCall: 'qa_workspace_logic_timeline_call', wrapperCall: 'qa_workspace_wrapper_call',
  visual: 'qa_workspace_preview_text', variable: 'qa_workspace_parameter', character: 'qa_workspace_character',
  control: 'qa_workspace_ui_text',
} as const;
const previewText = '时间轴预览仍然可用';
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

function createFixture() {
  const project = createProject('蓝图与时间轴工作区专项验收');
  project.id = 'qa_blueprint_workspace_focus'; project.width = 960; project.height = 540;
  project.playerDefaults = { masterVolume: 0 };
  project.characters = [{ id: ids.character, name: '验收角色', color: '#a8cfe5', expressions: [] }];
  project.variables = [{ id: ids.variable, name: '验收参数', type: 'number', initial: 7, persistent: false, parameterSetId: storyParametersId }];
  project.ui.components = [{ id: ids.control, kind: 'text', page: 'main', name: '验收文字控件', text: '自己的属性面板仍可编辑', x: .25, y: .25, width: .5, height: .2 }];

  const ordinary = createBlueprintGraph('function', '普通逻辑蓝图'); ordinary.id = ids.ordinary;
  const wrapper = createBlueprintGraph('effect', '旧工程章节包装蓝图');
  Object.assign(wrapper, { id: ids.wrapper, performanceKind: 'dialogue', chapterVariant: 'text', chapterPresetRevision: 3 });
  const helper = createBlueprintGraph('function', '可复用普通模块'); helper.id = ids.helper;
  const timeline = createTimelinePreset(project, '专项文字时间轴'); timeline.id = ids.timeline;
  const alternate = createTimelinePreset(project, '备用时间轴'); alternate.id = ids.alternate;
  // Keep the legacy wrapper as a real blueprint resource, with the timeline in
  // its own library. An ordinary graph contains extra logic and cannot unwrap.
  addProjectGraphs(project, ordinary, wrapper, helper, timeline, alternate);
  const visual = createVisualObject('text');
  Object.assign(visual, { instanceId: ids.visual, name: '验收文字片段', text: previewText, color: '#f6e0a0', fontSize: 48, duration: 4, width: .8, height: .3 });
  const clipId = insertTimelineAction(project, timeline, visual, 0, 'track_performance');
  const spare = createVisualObject('solid'); spare.name = '备用色块'; spare.color = '#2e465d';
  insertTimelineAction(project, alternate, spare, 0, 'track_performance');
  const link = (graph: BlueprintGraph, from: string, to: string) => {
    const previous = graph.nodes.find(node => node.id === from)!;
    const error = connectBlueprintPins(graph, from, previous.type === 'event' ? 'exec' : 'exec_out', to, 'exec_in');
    assert.equal(error, undefined, 'Fixture execution pins must connect.');
  };
  const call = (graph: BlueprintGraph, id: string, x: number) => {
    const node = blueprintNodeDefaults('callFunction');
    Object.assign(node, { id, name: '已有时间轴调用', x, y: 0, pins: callablePins(timeline) });
    node.properties.graphId = timeline.id; graph.nodes.push(node); return node;
  };
  ordinary.nodes[0].id = 'qa_workspace_logic_event'; ordinary.nodes[0].x = 0; ordinary.nodes[0].y = 0;
  const delay = blueprintNodeDefaults('delay');
  Object.assign(delay, { id: 'qa_workspace_logic_delay', name: '前置等待逻辑', x: 380, y: 0 }); delay.properties.seconds = .25;
  ordinary.nodes.push(delay); const ordinaryCall = call(ordinary, ids.ordinaryCall, 760);
  link(ordinary, ordinary.nodes[0].id, delay.id); link(ordinary, delay.id, ordinaryCall.id);
  wrapper.nodes[0].id = 'qa_workspace_wrapper_event'; wrapper.nodes[0].x = 0; wrapper.nodes[0].y = 0;
  const wrapperCall = call(wrapper, ids.wrapperCall, 430); link(wrapper, wrapper.nodes[0].id, wrapperCall.id);
  helper.nodes[0].id = 'qa_workspace_helper_event'; helper.nodes[0].x = 0; helper.nodes[0].y = 0;
  const passage = project.nodes.find(node => node.kind === 'passage'); assert.ok(passage && passage.kind === 'passage');
  passage.lines = [{ id: 'qa_workspace_line', text: '旧章节入口仍能主动进入时间轴。', speakerId: ids.character, actions: [{ kind: 'blueprint', blueprintId: wrapper.id }] }];
  synchronizeBlueprintSignatures(project);
  assert.equal(timelineWrapperCall(project, ordinary), undefined);
  assert.deepEqual(timelineWrapperCall(project, wrapper), { timelineId: timeline.id, callNodeId: wrapperCall.id });
  project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
  return { project: projectSchema.parse(project), ordinary, wrapper, helper, timeline, alternate, clipId };
}

const fixture = createFixture();
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'prepare', failure: unknown, authorHash: string | undefined;
let navigationHash = '', traceNumber = 0, traceRunning = false, original: Project;
const checks: { name: string; durationMs: number }[] = [], errors: string[] = [], traces: string[] = [];
const processes: { pid?: number; exited: boolean }[] = [];
const evidence: Record<string, unknown> = {};
const report: Record<string, unknown> = {
  status: 'running', renderer: 'compiled', authorProject, checks, errors, traces, processes, evidence,
  temporaryPaths: [path.dirname(projectFile), profile], fixture: { ids, clipId: fixture.clipId, assetFilesRequired: false },
};
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const topTab = (name: 'blueprint' | 'assets' | 'variables' | 'characters' | 'ui') => page!.locator(`[data-workspace-tab="${name}"]`);
const toolbar = () => page!.locator('.performance-context-toolbar');
const graphCanvas = () => page!.locator('.performance-workspace .blueprint-workspace');
const graphNode = (id: string) => graphCanvas().locator(`.react-flow__node[data-id="${id}"]`);
const graphPicker = () => toolbar().getByLabel('蓝图资源', { exact: true });
const timelinePicker = () => toolbar().getByLabel('时间轴预设', { exact: true });
const preview = () => page!.locator('.performance-preview');
const playhead = () => page!.getByRole('slider', { name: '时间轴播放头', exact: true });
const protectedResources = (value: Project) => ({
  nodes: value.nodes, entryId: value.entryId, chapters: value.chapters, scenes: value.scenes,
  blueprints: value.blueprints, timelinePresets: value.timelinePresets, assets: value.assets,
  characters: value.characters, variables: value.variables, parameterSets: value.parameterSets, ui: value.ui,
});
const settle = () => page!.evaluate(async () => {
  await document.fonts.ready;
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
});

async function builtFiles() {
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  const entry = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).main as string;
  assert.ok(entry && !path.isAbsolute(entry));
  const files = ['dist/index.html', entry, ...[...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => 'dist/' + match[1].slice(2))];
  assert.ok(files.some(file => file.startsWith('dist/assets/') && file.endsWith('.js')), 'The final renderer build must exist before acceptance.');
  return Promise.all([...new Set(files)].map(async file => ({ file, sha256: sha256(await fs.readFile(path.join(root, file))) })));
}
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile });
  processes.push({ pid: app.process().pid, exited: false });
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false }); traceRunning = true; traceNumber++;
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]; if (window.isMaximized()) window.unmaximize();
    window.setContentSize(1600, 1000); window.webContents.setBackgroundThrottling(false);
  });
  await expect(page.locator('.project-title strong')).toHaveText(fixture.project.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html'), 'Acceptance must use the compiled renderer.');
  report.rendererUrl = page.url(); await page.evaluate('globalThis.__name = value => value'); await settle();
}
async function close() {
  if (!app) return;
  const owned = app, child = owned.process(), exited = () => child.exitCode !== null || child.signalCode !== null;
  let traceFailure: unknown;
  if (traceRunning && page) {
    const name = `trace-${String(traceNumber).padStart(2, '0')}.zip`;
    try { await page.context().tracing.stop({ path: path.join(output, name) }); traces.push(name); }
    catch (error) { traceFailure = error; report.traceError = String(error); }
    traceRunning = false;
  }
  try { await owned.close(); }
  finally {
    await expect.poll(exited, { timeout: 15000 }).toBe(true);
    const record = processes.find(item => item.pid === child.pid); if (record) record.exited = exited();
    if (exited()) { app = undefined; page = undefined; }
  }
  if (traceFailure) throw traceFailure;
}
async function screenshot(name: string) {
  await settle();
  const encoded = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(encoded, 'base64'));
}
async function check(name: string, work: () => Promise<void>) {
  phase = name; const started = Date.now(); await work();
  checks.push({ name, durationMs: Date.now() - started });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log('通过：' + name);
}
async function noTopInspector() {
  const header = page!.locator('.app-header .view-tabs');
  await expect(header.getByRole('button', { name: '收起属性', exact: true })).toHaveCount(0);
  await expect(header.getByRole('button', { name: '展开属性', exact: true })).toHaveCount(0);
}
async function graphIs(id: string) {
  await expect(page!.getByRole('region', { name: '蓝图工作区', exact: true })).toBeVisible();
  await expect(graphPicker()).toHaveValue('graph:' + id);
  await expect(graphCanvas().locator('.react-flow')).toBeVisible();
  await expect(preview()).toHaveCount(0);
  await expect(page!.locator('.performance-workspace-timeline, .timeline-scroll, .timeline')).toHaveCount(0);
  await expect(timelinePicker()).toHaveCount(0);
  await expect(toolbar().getByRole('button', { name: '新建时间轴预设', exact: true })).toHaveCount(0);
  await noTopInspector();
}
async function graphContents(id: string, expected: Project = original) {
  const graph = projectGraphs(expected).find(item => item.id === id); assert.ok(graph);
  await expect.poll(() => graphCanvas().locator('.react-flow__node').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-id')!).sort())).toEqual(graph.nodes.map(node => node.id).sort());
  await expect.poll(() => graphCanvas().locator('.react-flow__edge').evaluateAll(edges => edges.map(edge => edge.getAttribute('data-id')!).sort())).toEqual(graph.links.map(link => link.id).sort());
}
async function chooseGraph(id: string) {
  await topTab('blueprint').click(); await expect(graphPicker()).toBeVisible();
  await graphPicker().selectOption('graph:' + id); await graphIs(id); await fitBlueprintCanvas(page!);
}
async function timelineIs(id: string = ids.timeline) {
  await expect(page!.getByRole('region', { name: '时间轴工作区', exact: true })).toBeVisible();
  await expect(timelinePicker()).toHaveValue('graph:' + id);
  await expect(preview()).toBeVisible(); await expect(page!.getByLabel('时间轴画布', { exact: true })).toBeVisible();
  await expect(page!.locator('.performance-authoring.graph')).toHaveCount(0);
  await expect(toolbar().getByRole('button', { name: '新建时间轴预设', exact: true })).toBeVisible();
}
async function enterCall(graphId: string, callId: string) {
  await chooseGraph(graphId); await graphNode(callId).locator('.graph-node-title strong').dblclick();
  await timelineIs(); await expect(toolbar().getByRole('button', { name: '返回蓝图', exact: true })).toBeVisible();
}
async function openResource(graph: BlueprintGraph) {
  await topTab('assets').click();
  const browser = page!.getByRole('region', { name: '资源管理器', exact: true }); await expect(browser).toBeVisible();
  await browser.getByLabel('资源显示范围', { exact: true }).selectOption('all');
  await browser.getByLabel('搜索资源和蓝图', { exact: true }).fill(graph.name);
  await browser.locator(`[data-content-key="${graphResourceKey(graph)}"]`).dblclick();
}
async function unchanged() {
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  assert.equal(sha256(await fs.readFile(projectFile)), navigationHash, 'Navigation and preview must not write the isolated project.');
}
async function save() {
  await button('保存工程').click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); return read();
}
async function undo() { await button('撤销').click(); await settle(); }
async function saveUi() {
  await button('保存界面').click(); await expect(page!.locator('.ui-save-status')).toHaveText('已保存');
  await expect(button('保存界面')).toBeDisabled(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); return read();
}

try {
  await fs.mkdir(output, { recursive: true });
  authorHash = sha256(await fs.readFile(authorProject)); report.authorSha256Before = authorHash;
  report.buildBefore = await builtFiles();
  await fs.mkdir(path.dirname(projectFile), { recursive: true }); await saveProject(projectFile, fixture.project);
  original = await read(); navigationHash = sha256(await fs.readFile(projectFile));
  await fs.copyFile(projectFile, path.join(output, 'input-project.json')); await launch();

  await check('顶部蓝图默认进入普通节点图，预览和时间轴预设入口不占用画布', async () => {
    await topTab('blueprint').click(); await graphIs(ids.ordinary); await graphContents(ids.ordinary); await fitBlueprintCanvas(page!);
    const values = await graphPicker().locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
    assert.deepEqual(values.filter(Boolean).sort(), original.blueprints.map(graph => 'graph:' + graph.id).sort());
    const properties = graphCanvas().getByRole('complementary', { name: '蓝图属性', exact: true });
    await expect(properties).toBeVisible(); await graphCanvas().getByRole('button', { name: '收起蓝图属性', exact: true }).click();
    await expect(properties).toHaveCount(0); await graphCanvas().getByRole('button', { name: '展开蓝图属性', exact: true }).click();
    await expect(properties).toBeVisible(); await unchanged(); await screenshot('01-ordinary-blueprint');
  });

  await check('选择旧包装蓝图保留外层节点和执行连线，不自动进入子时间轴', async () => {
    await graphPicker().selectOption('graph:' + ids.wrapper); await graphIs(ids.wrapper); await fitBlueprintCanvas(page!); await graphContents(ids.wrapper);
    await expect(graphNode(ids.wrapperCall)).toBeVisible(); await expect(toolbar().getByRole('button', { name: '返回蓝图', exact: true })).toHaveCount(0);
    await unchanged(); await screenshot('02-wrapper-stays-graph');
  });

  await check('从资源列表双击普通蓝图和包装蓝图均进入节点编辑', async () => {
    for (const graph of [fixture.helper, fixture.wrapper]) {
      await openResource(graph); await graphIs(graph.id); await graphContents(graph.id);
    }
    await unchanged();
  });

  await check('新增节点和可复用模块列表筛除时间轴资源，已有调用仍可选择自己的时间轴', async () => {
    await fitBlueprintCanvas(page!); await graphNode(ids.wrapperCall).locator('.graph-node-title strong').click();
    const properties = graphCanvas().getByRole('complementary', { name: '蓝图属性', exact: true });
    await expect(properties.getByLabel('时间轴预设', { exact: true })).toHaveValue(ids.timeline);
    await expect(properties.getByRole('button', { name: '编辑时间轴', exact: true })).toBeVisible();
    await graphCanvas().getByRole('button', { name: '添加节点', exact: true }).click();
    const picker = page!.getByRole('dialog', { name: '添加蓝图节点', exact: true }); await expect(picker).toBeVisible();
    for (const id of [ids.timeline, ids.alternate]) await expect(picker.locator(`[data-node-picker-item="${id}"]`)).toHaveCount(0);
    await picker.getByLabel('搜索要添加的节点', { exact: true }).fill(fixture.helper.name);
    await expect(picker.locator(`[data-node-picker-item="${ids.helper}"]`)).toBeVisible();
    await picker.getByRole('button', { name: '关闭节点搜索', exact: true }).click();
    await graphCanvas().getByRole('button', { name: '展开节点库', exact: true }).click();
    const library = graphCanvas().locator('.blueprint-module-library'); await library.locator(':scope > summary').click();
    await expect(library.getByRole('button', { name: '添加模块调用：' + fixture.helper.name, exact: true })).toBeVisible();
    for (const id of [ids.timeline, ids.alternate]) await expect(library.locator(`[data-blueprint-module="${id}"]`)).toHaveCount(0);
    await screenshot('03-filtered-module-library'); await graphCanvas().getByRole('button', { name: '收起节点库', exact: true }).click();
    await graphContents(ids.wrapper); await unchanged();
  });

  await check('已有时间轴调用双击后能真实播放文字，返回蓝图保留原节点与连线', async () => {
    await enterCall(ids.ordinary, ids.ordinaryCall);
    await expect(page!.locator(`.timeline-clip[data-node-id="${fixture.clipId}"]`)).toBeVisible();
    await playhead().focus(); await playhead().press('Home'); await playhead().press('ArrowRight');
    await expect(preview().locator(`[data-visual-instance="${ids.visual}"]`)).toContainText(previewText);
    await preview().getByRole('button', { name: '播放预览', exact: true }).click();
    await expect(preview().getByRole('button', { name: '暂停预览', exact: true })).toBeVisible();
    await expect.poll(async () => Number(await playhead().getAttribute('aria-valuenow')), { timeout: 6000 }).toBeGreaterThan(.1);
    await preview().getByRole('button', { name: '暂停预览', exact: true }).click(); await screenshot('04-existing-call-preview');
    await preview().getByRole('button', { name: '停止预览', exact: true }).click();
    await toolbar().getByRole('button', { name: '返回蓝图', exact: true }).click();
    await graphIs(ids.ordinary); await graphContents(ids.ordinary); await unchanged();
  });

  await check('从已有调用的内部时间轴点击顶部蓝图，立即回到所属普通图并移除预览', async () => {
    await enterCall(ids.ordinary, ids.ordinaryCall); await topTab('blueprint').click();
    await graphIs(ids.ordinary); await graphContents(ids.ordinary);
    await expect(toolbar().getByRole('button', { name: '返回蓝图', exact: true })).toHaveCount(0);
    await topTab('blueprint').click(); await graphIs(ids.ordinary); await graphContents(ids.ordinary); await unchanged();
  });

  await check('显式时间轴资源入口保留预览，点击顶部蓝图返回普通图而非停在时间轴', async () => {
    await openResource(fixture.timeline); await timelineIs();
    const values = await timelinePicker().locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
    assert.deepEqual(values.sort(), (original.timelinePresets ?? []).map(graph => 'graph:' + graph.id).sort());
    await expect(toolbar().getByRole('button', { name: '返回蓝图', exact: true })).toHaveCount(0);
    await screenshot('05-explicit-timeline-resource'); await topTab('blueprint').click();
    await graphIs(ids.ordinary); await graphContents(ids.ordinary); await unchanged();
  });

  await check('时间轴的查看组件连线只打开节点图，主动返回时间轴后恢复轨道和预览', async () => {
    await openResource(fixture.timeline); await timelineIs();
    await toolbar().getByRole('button', { name: '查看组件连线', exact: true }).click();
    await expect(page!.getByRole('region', { name: '蓝图工作区', exact: true })).toBeVisible();
    await expect(timelinePicker()).toHaveValue('graph:' + ids.timeline); await expect(preview()).toHaveCount(0);
    await expect(page!.locator('.timeline-scroll')).toHaveCount(0);
    await expect(toolbar().getByRole('button', { name: '新建时间轴预设', exact: true })).toHaveCount(0);
    await graphContents(ids.timeline); await toolbar().getByRole('button', { name: '返回时间轴编辑', exact: true }).click();
    await timelineIs(); await topTab('blueprint').click(); await graphIs(ids.ordinary); await unchanged();
  });

  await check('旧章节演出的显式编辑入口仍能解开包装图，返回保留原包装结构', async () => {
    await topTab('ui').click(); await page!.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '设计', exact: true }).click();
    await button('更多内置页面').click();
    const entries = page!.getByRole('region', { name: '章节演出入口', exact: true });
    await entries.getByRole('button').filter({ hasText: fixture.wrapper.name }).click(); await timelineIs();
    await expect(toolbar().getByRole('button', { name: '返回蓝图', exact: true })).toBeVisible();
    await screenshot('06-legacy-wrapper-explicit-timeline');
    await toolbar().getByRole('button', { name: '返回蓝图', exact: true }).click();
    await graphIs(ids.wrapper); await graphContents(ids.wrapper); await unchanged();
  });

  await check('新建蓝图直接进入节点编辑，保存和一次撤销不会生成或改变时间轴资源', async () => {
    const before = await read(); await toolbar().getByRole('button', { name: '新建蓝图', exact: true }).click();
    await expect.poll(async () => {
      const value = await graphPicker().inputValue();
      return value.startsWith('graph:') && !projectGraphs(before).some(graph => 'graph:' + graph.id === value);
    }).toBe(true);
    const id = (await graphPicker().inputValue()).slice(6); assert.ok(id && !projectGraphs(before).some(graph => graph.id === id));
    await graphIs(id); await expect(page!.locator('.dirty-dot')).toHaveCount(1);
    const saved = await save(); assert.equal(saved.blueprints.length, before.blueprints.length + 1);
    assert.deepEqual(saved.timelinePresets, before.timelinePresets); assert.deepEqual(saved.nodes, before.nodes);
    await graphContents(id, saved); await undo(); const restored = await save();
    assert.deepEqual(restored.blueprints, before.blueprints); assert.deepEqual(restored.timelinePresets, before.timelinePresets);
    await topTab('blueprint').click(); await graphIs(ids.ordinary);
  });

  await check('参数集顶栏不显示旧属性开关，参数自己的属性仍能修改保存和撤销', async () => {
    await topTab('variables').click(); await noTopInspector();
    await page!.locator(`[data-parameter-set-id="${storyParametersId}"]`).click();
    await page!.locator(`[data-parameter-id="${ids.variable}"]`).click();
    const details = page!.getByRole('complementary', { name: '参数设置', exact: true }); await expect(details).toBeVisible();
    const value = details.getByLabel('初始值', { exact: true }); await expect(value).toHaveValue('7');
    await value.fill('13'); await value.press('Tab'); assert.equal((await save()).variables.find(variable => variable.id === ids.variable)!.initial, 13);
    await undo(); assert.deepEqual((await save()).variables, original.variables); await expect(value).toHaveValue('7');
    await noTopInspector(); await screenshot('07-parameter-owned-inspector');
  });

  await check('角色顶栏不显示旧属性开关，分类和角色自己的编辑面板保持可用', async () => {
    await topTab('characters').click(); await noTopInspector();
    await page!.locator(`.character-library [data-character-id="${ids.character}"]`).click();
    const region = page!.getByRole('region', { name: '角色编辑工作区', exact: true });
    const name = region.getByLabel('角色名称', { exact: true }); await expect(name).toHaveValue('验收角色');
    await name.fill('临时修改的角色'); await name.press('Tab'); assert.equal((await save()).characters[0].name, '临时修改的角色');
    await undo(); assert.deepEqual((await save()).characters, original.characters); await expect(name).toHaveValue('验收角色');
    await region.getByRole('tab', { name: '文字演出', exact: true }).click();
    await expect(region.getByRole('region', { name: '角色文字演出', exact: true })).toBeVisible();
    await region.getByRole('tab', { name: '外观与表情', exact: true }).click();
    const summary = region.locator('summary').filter({ hasText: /^基本信息$/ });
    await summary.click(); await expect(name).toBeHidden(); await summary.click(); await expect(name).toBeVisible();
    await noTopInspector(); await screenshot('08-character-owned-inspector');
  });

  await check('界面顶栏不显示旧属性开关，草稿撤销重做及保存后的工程撤销各自保留', async () => {
    await topTab('ui').click(); await noTopInspector();
    await page!.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '设计', exact: true }).click();
    await page!.getByLabel('设计页面', { exact: true }).selectOption('main');
    await page!.locator(`[data-hierarchy-id="${ids.control}"]`).click();
    const inspector = page!.locator('.ui-inspector'), name = inspector.getByLabel('控件显示名称', { exact: true });
    await expect(name).toHaveValue('验收文字控件');
    const scope = inspector.getByRole('tablist', { name: '界面属性范围', exact: true });
    await scope.getByRole('tab', { name: '页面设置', exact: true }).click();
    await expect(scope.getByRole('tab', { name: '页面设置', exact: true })).toHaveAttribute('aria-selected', 'true');
    await scope.getByRole('tab', { name: '组件设置', exact: true }).click(); await expect(name).toHaveValue('验收文字控件');
    const before = await read(); await name.fill('临时修改的控件'); await name.press('Tab');
    await expect(button('保存界面')).toBeEnabled(); await expect(button('撤销')).toBeEnabled();
    assert.deepEqual((await read()).ui, before.ui, 'An unsaved UI draft must not be written to the project.');
    await undo(); await expect(name).toHaveValue('验收文字控件'); await expect(button('保存界面')).toBeDisabled();
    await button('重做').click(); await expect(name).toHaveValue('临时修改的控件');
    assert.equal((await saveUi()).ui.components.find(control => control.id === ids.control)!.name, '临时修改的控件');
    // The existing editor has separate UI-draft and project histories. Saving
    // accepts the draft into project history and clears the draft history. Do
    // not report immediate undo in the UI workspace as a passing capability.
    await expect(button('撤销')).toBeDisabled();
    evidence.uiHistoryLimitation = {
      immediateUndoAfterUiSave: 'unavailable in the UI workspace; existing separate-history behavior, not a passing path',
      firstFailureEvidence: 'editor-2026-11-09T17-36-08.097Z-1657ed6e',
      verifiedDraftPath: 'edit -> undo -> redo -> save UI',
      verifiedSavedPath: 'blueprint workspace -> undo project edit -> save project -> return to UI',
    };
    await topTab('blueprint').click(); await expect(button('撤销')).toBeEnabled(); await undo();
    assert.deepEqual((await save()).ui, before.ui, 'Project undo must restore the whole saved UI edit exactly.');
    await topTab('ui').click(); await page!.getByLabel('设计页面', { exact: true }).selectOption('main');
    await page!.locator(`[data-hierarchy-id="${ids.control}"]`).click(); await expect(name).toHaveValue('验收文字控件');
    await expect(inspector.locator('[data-ui-inspector-group="layout"]')).toBeVisible();
    await noTopInspector(); await screenshot('09-ui-owned-inspector');
  });

  await check('独立重开和窄窗保持正确入口，浏览和撤销后原图调用及其他资源全部保留', async () => {
    const before = await read(); assert.deepEqual(protectedResources(before), protectedResources(original));
    await fs.copyFile(projectFile, path.join(output, 'saved-project.json')); await close(); await launch();
    await topTab('blueprint').click(); await graphIs(ids.ordinary); await graphContents(ids.ordinary);
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 900)); await settle();
    const layout = async () => page!.evaluate(() => {
      const picker = document.querySelector<HTMLElement>('.performance-target'), rect = picker?.getBoundingClientRect();
      return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, picker: rect && { left: rect.left, right: rect.right, width: rect.width } };
    });
    const layouts: unknown[] = [];
    for (const mode of ['graph', 'timeline'] as const) {
      if (mode === 'timeline') { await openResource(fixture.timeline); await timelineIs(); }
      else { await openResource(fixture.wrapper); await graphIs(ids.wrapper); await graphContents(ids.wrapper); }
      const value = await layout(); assert.ok(value.picker && value.picker.width > 40 && value.picker.left >= 0 && value.picker.right <= value.width + 1);
      assert.ok(value.documentWidth <= value.width + 1, 'Workspace must not create document-level horizontal overflow.');
      layouts.push({ mode, ...value }); await screenshot('10-reopened-' + mode + '-1100');
    }
    evidence.layouts = layouts; await topTab('blueprint').click(); await graphIs(ids.ordinary); await graphContents(ids.ordinary);
    await expect(page!.locator('.dirty-dot')).toHaveCount(0); assert.deepEqual(protectedResources(await read()), protectedResources(original));
    evidence.finalProjectSha256 = sha256(await fs.readFile(projectFile));
  });

  assert.equal(checks.length, 14); assert.deepEqual(errors, [], 'The renderer must not raise runtime errors.');
  report.buildAfter = await builtFiles(); assert.deepEqual(report.buildAfter, report.buildBefore, 'Do not rebuild while this acceptance is running.');
  report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  await fs.copyFile(projectFile, path.join(output, 'failure-project.json')).catch(copyError => { report.failureProjectError = String(copyError); });
  if (app && page && !page.isClosed()) {
    evidence.failureWorkspace = await page.locator('.performance-workspace').innerText({ timeout: 1000 }).catch(() => undefined);
    evidence.failureTopButtons = await page.locator('.app-header .view-tabs button').evaluateAll(buttons => buttons.map(button => ({ name: button.getAttribute('aria-label') ?? button.textContent?.trim(), title: button.getAttribute('title') }))).catch(() => undefined);
    await screenshot('failure').catch(captureError => { report.captureError = String(captureError); });
  }
} finally {
  try { await close(); } catch (error) { failure ??= error; report.status = 'failed'; report.closeError = String(error); }
  try {
    report.authorSha256After = sha256(await fs.readFile(authorProject));
    if (authorHash !== undefined) assert.equal(report.authorSha256After, authorHash, 'The real author project changed during isolated acceptance.');
  } catch (error) { failure ??= error; report.status = 'failed'; report.authorProtectionError = String(error); }
  try {
    if (app || processes.some(process => !process.exited)) throw new Error('An owned fixture process remains alive; retain its temporary directories.');
    const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); report.cleanup = cleanup;
    assert.deepEqual(cleanup.errors, [], 'All owned temporary directories must be cleaned or reported explicitly.');
  } catch (error) { failure ??= error; report.status = 'failed'; report.cleanupError = String(error); }
  await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
}
if (failure) throw failure;
