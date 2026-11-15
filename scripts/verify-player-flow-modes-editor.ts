import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { effectiveUiComponents, projectSchema, type Project } from '../src/core/model';
import { playerFlowAllEntries, playerFlowGroups, playerFlowMissingEntries, playerFlowMode } from '../src/core/player-flow-content';
import { storyFlowOwner } from '../src/core/story-flow-authoring';
import { storyMenuEntries, type StoryMenuEntry } from '../src/core/story-menu';
import { projectToText } from '../src/core/text-script';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openDisclosureAncestors } from './lib/ui-disclosures';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { createPlayerFlowModesFixture, playerFlowModesIds } from './lib/player-flow-modes-fixture';

// Run after the unified compiled build. This script uses only its generated project and profile.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Use the isolated compiled source editor.');
const root = path.resolve('.');
const outputRoot = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/player-flow-modes-2026-11-13/desktop');
const output = path.join(outputRoot, `editor-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
const relativeOutput = path.relative(root, output);
assert.ok(relativeOutput && !path.isAbsolute(relativeOutput) && relativeOutput !== '..' && !relativeOutput.startsWith('..' + path.sep),
  'VNS_ARTIFACT_ROOT must keep acceptance output inside this checkout.');

const fixtureDirectory = path.join(output, 'fixture');
const profile = path.join(output, 'profile');
const projectFile = path.join(fixtureDirectory, 'project.vns.json');
const fixture = createPlayerFlowModesFixture();
const initial = fixture.project;
const ids = playerFlowModesIds;
const firstOwner = fixture.first.owner!;
const secondOwner = fixture.second.owner!;
const fifthOwner = fixture.fifth.owner!;
const ownerKey = (entry: StoryMenuEntry) => `${entry.owner!.kind}:${entry.owner!.id}`;
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

function storySnapshot(project: Project) {
  return structuredClone({ scriptText: project.scriptText, entryId: project.entryId, chapters: project.chapters, scenes: project.scenes,
    nodes: project.nodes, styles: project.ui.flowStyles, flowchartPage: project.ui.pages?.flowchart });
}
const untouchedStory = storySnapshot(initial);

let app: ElectronApplication | undefined, page: Page | undefined, failure: unknown, phase = '准备';
let traceRunning = false, launchNumber = 0, savedBytes = '';
const checks: { name: string; durationMs: number }[] = [];
const errors: string[] = [], traces: string[] = [];
const processes: { pid?: number; exited: boolean; forced?: boolean }[] = [];
const evidence: Record<string, unknown> = {};
const report: Record<string, unknown> = { status: 'running', renderer: 'compiled', checks, errors, traces, processes, evidence,
  temporaryPaths: [fixtureDirectory, profile], limits: [
    '所有故事、控件、剧本内容、样式和损坏引用均来自本脚本自建 fixture；不打开或读取真实作品。',
    '检查实际桌面画布、图内编辑、模式切换、保存重开与本地图布局；不启动原生游戏。',
    '每次运行使用独立工程和 Electron profile；截图、报告、Playwright trace 与清理记录保留在本次输出目录。',
  ] };

const button = (name: string) => page!.getByRole('button', { name, exact: true });
const inspector = () => page!.locator('.ui-inspector[data-ui-flow-view]');
const view = () => inspector().locator('.ui-inspector-view:not([hidden])');
const flow = () => view().locator('.ui-player-flow-inspector');
const field = (name: string) => view().getByLabel(name, { exact: true });
const flowGroup = (id: string) => view().locator(`[data-ui-inspector-group="${id}"]`);
const mode = () => field('剧情图内容来源');
const component = (id: string) => page!.locator(`[data-component-id="${id}"]`);
const flowNode = (componentId: string, nodeId: string) => component(componentId).locator(`[data-flow-node="${nodeId}"]`);
const groupCard = (componentId: string, groupId: string) => component(componentId).locator(`[data-flow-group="${groupId}"]`);
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const componentIn = (project: Project, id: string) => (project.ui.activeInstanceId
  ? effectiveUiComponents(project.ui).find(item => item.id === id)
  : project.ui.components.find(item => item.id === id))
  ?? project.ui.instances?.flatMap(instance => instance.components).find(item => item.id === id)!;
const customIn = (project: Project, id: string) => componentIn(project, id).list?.flowContent?.custom!;
const customEntries = (project: Project, id: string) => customIn(project, id).entries;
const namesIn = (project: Project, id: string) => playerFlowAllEntries(project, componentIn(project, id));
const saveButton = () => button('保存界面');
const undoButton = () => button('撤销');
const redoButton = () => button('重做');
const settle = () => page!.evaluate('async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); }');

async function writeReport() { await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
async function currentMode() { await openGroup('flow-mode'); return mode().inputValue(); }
async function selectMode(value: 'script' | 'custom') { await openGroup('flow-mode'); await mode().selectOption(value); }
async function fingerprints() {
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  const files = ['dist/index.html', 'dist-desktop/main.cjs', 'dist-desktop/preload.cjs',
    ...[...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => 'dist/' + match[1].slice(2))];
  assert.ok(files.some(file => file.startsWith('dist/assets/') && file.endsWith('.js')), 'Compiled renderer assets must exist.');
  return Promise.all([...new Set(files)].map(async file => ({ file, sha256: sha256(await fs.readFile(path.join(root, file))) })));
}
async function size(width: number, height: number) {
  await app!.evaluate(({ BrowserWindow }, dimensions) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window.isMinimized()) window.restore();
    if (window.isMaximized()) window.unmaximize();
    window.setContentSize(dimensions.width, dimensions.height);
    window.webContents.setBackgroundThrottling(false);
  }, { width, height });
  await expect.poll(() => page!.evaluate(requested => Math.max(Math.abs(innerWidth - requested.width), Math.abs(innerHeight - requested.height)), { width, height })).toBeLessThanOrEqual(1);
  await settle();
}
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile, devUrl: '' });
  launchNumber++;
  processes.push({ pid: app.process().pid, exited: false });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(initial.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html'));
  report.rendererUrl = page.url();
  await page.evaluate('globalThis.__name = value => value');
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false });
  traceRunning = true;
  await size(1600, 1000);
  await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '设计', exact: true }).click();
  await page.getByLabel('设计页面', { exact: true }).selectOption('flowchart');
  await page.getByLabel('画面缩放比例', { exact: true }).selectOption('50');
  await selectMap(ids.copy);
  await settle();
}
async function close() {
  if (!app) return;
  const owned = app, child = owned.process(), exited = () => child.exitCode !== null || child.signalCode !== null;
  const record = processes.find(item => item.pid === child.pid)!;
  let closeError: unknown;
  if (traceRunning && page) {
    try { await page.context().tracing.stop({ path: path.join(output, `trace-${launchNumber}.zip`) }); traces.push(`trace-${launchNumber}.zip`); }
    catch (error) { closeError = error; }
    traceRunning = false;
  }
  try { await owned.close(); await expect.poll(exited, { timeout: 15000 }).toBe(true); }
  catch (error) {
    closeError ??= error;
    if (!exited()) { record.forced = true; child.kill(); }
    await expect.poll(exited, { timeout: 15000 }).toBe(true);
  } finally {
    record.exited = exited();
    if (record.exited) { app = undefined; page = undefined; }
  }
  if (closeError) throw closeError;
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
async function scope(expected: 'map' | 'node' | 'base' | 'preset' | 'group' | 'edge' | 'sources') {
  await expect(inspector()).toHaveAttribute('data-ui-flow-view', expected);
  await expect(flow()).toHaveAttribute('data-flow-inspector-target', expected);
  await expect(flow()).toBeVisible();
}
async function openGroup(id: string) {
  const summary = flowGroup(id).locator(':scope > summary');
  await openDisclosureAncestors(summary);
  await expect(summary).toBeVisible();
}
async function selectMap(id: string) {
  await page!.locator(`[data-hierarchy-id="${id}"] .ui-hierarchy-caption`).click();
  await scope('map');
}
async function selectInstance(id?: string) {
  await button('页面选项').click();
  const options = page!.getByRole('dialog', { name: '页面选项', exact: true });
  const scheme = options.getByLabel('选择界面实例', { exact: true });
  await openDisclosureAncestors(scheme);
  await scheme.selectOption(id ?? '');
  if (await options.isVisible()) await options.getByRole('button', { name: '关闭页面选项', exact: true }).click();
  await settle();
}
async function returnMap() {
  if (await inspector().getAttribute('data-ui-flow-view') !== 'map') {
    await inspector().locator('.ui-inspector-header').getByRole('button', { name: '返回整张图设置', exact: true }).click();
  }
  await scope('map');
}
async function openSources() {
  const current = await currentMode();
  await flow().getByRole('button', { name: current === 'custom' ? /^管理本图剧情/ : /^管理显示的剧情/ }).click();
  await scope('sources');
}
async function selectNode(componentId: string, nodeId: string) {
  await returnMap();
  await flowNode(componentId, nodeId).click();
  await scope('node');
  await expect(flow()).toHaveAttribute('data-flow-editing-node', nodeId);
}
async function addEntry(entry: StoryMenuEntry) {
  await field('添加到本图的剧情入口').selectOption(ownerKey(entry));
  await button('添加剧情节点').click();
  await expect(view().locator(`[data-flow-custom-node="${entry.id}"]`)).toBeVisible();
}
async function save() {
  if (await saveButton().isEnabled()) {
    await saveButton().click();
    await expect(page!.locator('.ui-save-status')).toHaveAttribute('data-dirty', 'false', { timeout: 30000 });
  } else {
    await expect(page!.locator('.ui-save-status')).toHaveAttribute('data-dirty', 'false');
  }
  await expect(saveButton()).toBeDisabled();
  savedBytes = await fs.readFile(projectFile, 'utf8');
  return read();
}
async function unchanged() {
  await expect(saveButton()).toBeDisabled();
  assert.equal(await fs.readFile(projectFile, 'utf8'), savedBytes);
}
async function assertStoryUnchanged(project?: Project) {
  const snapshot = project ?? await read();
  // Changing the game's active scheme intentionally changes its one script
  // directive. All narrative and local-map actions must otherwise preserve it.
  const scriptText = snapshot.ui.activeInstanceId && initial.scriptText
    ? { ...initial.scriptText, content: projectToText({ ...initial, ui: { ...initial.ui, activeInstanceId: snapshot.ui.activeInstanceId } }) }
    : initial.scriptText;
  assert.deepEqual(storySnapshot(snapshot), { ...untouchedStory, scriptText }, 'Local flow-map editing must preserve the source story, script text, shared presets, and page settings.');
}
async function theme(name: '黑白' | '亮白', id: 'codexDark' | 'codexLight') {
  await button('作品设置').click();
  const dialog = page!.getByRole('dialog', { name: '作品设置', exact: true });
  await dialog.getByRole('button', { name: '编辑器外观', exact: true }).click();
  await dialog.getByRole('group', { name: '编辑器配色', exact: true }).getByRole('button', { name: new RegExp('^' + name) }).click();
  await expect(page!.locator('html')).toHaveAttribute('data-editor-theme', id);
  await dialog.getByRole('button', { name: '关闭作品设置', exact: true }).click();
  await settle();
}
async function fitSnapshot(target: Locator) {
  const result = await target.evaluate(element => {
    const box = element.getBoundingClientRect();
    const controls = [...element.querySelectorAll<HTMLElement>('button,input,select,textarea')].filter(control => control.getClientRects().length).map(control => {
      const rect = control.getBoundingClientRect();
      return { label: control.getAttribute('aria-label') ?? control.textContent?.trim(), left: rect.left - box.left, right: rect.right - box.left, width: rect.width, height: rect.height };
    });
    return { width: element.clientWidth, scrollWidth: element.scrollWidth, hostWidth: box.width, controls,
      documentFits: document.documentElement.scrollWidth <= innerWidth + 1 };
  });
  assert.ok(result.width > 180 && result.scrollWidth <= result.width + 2, JSON.stringify(result));
  assert.ok(result.documentFits, 'The editor must not create horizontal document scrolling.');
  assert.deepEqual(result.controls.filter(control => control.width < 1 || control.height < 1 || control.left < -2 || control.right > result.hostWidth + 2), [], 'Visible flow controls must fit the narrow panel.');
  return result;
}

try {
  await fs.mkdir(output, { recursive: true });
  report.outputDirectory = output;
  report.buildBefore = await fingerprints();
  await fs.mkdir(fixtureDirectory, { recursive: true });
  await saveProject(projectFile, initial);
  savedBytes = await fs.readFile(projectFile, 'utf8');
  report.fixtureSha256Before = sha256(savedBytes);
  await launch();

  await check('旧版缺省来源保留完整剧本、真实目录成员和分支连线', async () => {
    const saved = await read(), legacy = componentIn(saved, ids.copy);
    assert.equal(legacy.list?.flowContent, undefined);
    assert.equal(playerFlowMode(legacy), 'script');
    assert.equal(await currentMode(), 'script');
    const actualNodes = await component(ids.copy).locator('.ui-story-flow-preview [data-flow-node]:not([data-flow-group])').evaluateAll(elements => elements.map(element => element.getAttribute('data-flow-node')).sort());
    assert.deepEqual(actualNodes, fixture.entries.map(entry => entry.id).sort());
    const actualEdges = await component(ids.copy).locator('.ui-story-flow-preview [data-flow-edge]').evaluateAll(elements => elements.map(element => element.getAttribute('data-flow-edge')).sort());
    assert.deepEqual(actualEdges, fixture.expectedLegacyLayout.edges.map(edge => `${edge.from}:${edge.to}`).sort());
    assert.ok(actualEdges.includes(`${fixture.first.id}:${fixture.second.id}`));
    assert.ok(actualEdges.includes(`${fixture.first.id}:${fixture.third.id}`));
    assert.equal(saved.scriptText?.content, fixture.originalScript);
    await unchanged();
    evidence.legacy = { mode: playerFlowMode(legacy), entries: actualNodes, edges: actualEdges, scriptBytes: Buffer.byteLength(fixture.originalScript, 'utf8') };
    await screenshot('01-legacy-script-mode');
  });

  await check('首次切换自定义要求明确选择起点且未确认时不写入工程', async () => {
    await selectMode('custom');
    const chooser = view().getByRole('group', { name: '开始自定义剧情图', exact: true });
    await expect(chooser).toBeVisible();
    await expect(chooser.getByRole('button', { name: /^从当前图开始/ })).toBeEnabled();
    await expect(chooser.getByRole('button', { name: /^新建空图/ })).toBeEnabled();
    assert.equal(await read().then(project => componentIn(project, ids.copy).list?.flowContent), undefined);
    await unchanged();
    await selectMode('script');
    await expect(chooser).toHaveCount(0);
    await unchanged();
  });

  await check('从当前图开始完整复制脚本成员、文字预设和自动布局位置', async () => {
    await selectMode('custom');
    await view().getByRole('group', { name: '开始自定义剧情图', exact: true }).getByRole('button', { name: /^从当前图开始/ }).click();
    await expect(flow().locator('[data-flow-content-mode="custom"]')).toBeVisible();
    const saved = await save(), copied = customIn(saved, ids.copy);
    const expectedEntries = fixture.entries.map(entry => ({ nodeId: entry.id, owner: entry.owner,
      name: entry.parts?.join('｜') || entry.name, ...(entry.styleId ? { styleId: entry.styleId } : {}) }));
    assert.deepEqual(copied.entries, expectedEntries);
    assert.deepEqual(copied.positions, Object.fromEntries(fixture.expectedLegacyLayout.nodes.map(node => [node.id, { x: node.x, y: node.y }])));
    assert.deepEqual(copied.groups ?? [], []);
    assert.equal(componentIn(saved, ids.empty).list?.flowContent, undefined);
    assert.equal(playerFlowMode(componentIn(saved, ids.repair)), 'custom');
    evidence.copyInitialization = { entries: copied.entries.length, positions: Object.keys(copied.positions ?? {}).length, styles: copied.entries.flatMap(entry => entry.styleId ? [entry.styleId] : []) };
  });

  await check('本地图文字、预设与点击动作独立保存且不写回剧本来源', async () => {
    await selectNode(ids.copy, fixture.first.id);
    await field('节点文字第 1 段').fill('只属于复制图');
    await button('添加文字段').click();
    await field('节点文字第 2 段').fill('本地图的副标题');
    await field('当前节点外观预设').selectOption(ids.secondPreset);
    await field('点击节点时').selectOption('inspect');
    const saved = await save(), local = customEntries(saved, ids.copy).find(entry => entry.nodeId === fixture.first.id)!;
    assert.equal(local.name, '只属于复制图｜本地图的副标题');
    assert.equal(local.styleId, ids.secondPreset);
    assert.equal(local.action, 'inspect');
    assert.deepEqual(storyFlowOwner(saved, fixture.first.owner)?.flowchart, storyFlowOwner(initial, fixture.first.owner)?.flowchart);
    await assertStoryUnchanged(saved);
    evidence.localNode = { nodeId: fixture.first.id, name: local.name, styleId: local.styleId, action: local.action };
    await screenshot('02-copy-local-node');
  });

  await check('自定义节点位置可撤销重做并保存到本图坐标', async () => {
    await openGroup('flow-node-position');
    await field('节点横向位置').fill('910');
    await field('节点纵向位置').fill('610');
    await field('节点横向位置').fill('930');
    await undoButton().click();
    await expect(field('节点横向位置')).toHaveValue('910');
    await redoButton().click();
    await expect(field('节点横向位置')).toHaveValue('930');
    await undoButton().click();
    const saved = await save(), position = customIn(saved, ids.copy).positions?.[fixture.first.id];
    assert.deepEqual(position, { x: 910, y: 610 });
    evidence.copyPosition = position;
  });

  await check('脚本与自定义模式切换分别保留布局、文字、动作和当前图位置', async () => {
    await selectMap(ids.copy);
    await selectMode('script');
    await expect(mode()).toHaveValue('script');
    await save();
    let saved = await read(), current = componentIn(saved, ids.copy);
    assert.equal(playerFlowMode(current), 'script');
    assert.equal(customEntries(saved, ids.copy).find(entry => entry.nodeId === fixture.first.id)?.name, '只属于复制图｜本地图的副标题');
    const scriptX = 520, scriptY = 340;
    await selectNode(ids.copy, fixture.first.id);
    await openGroup('flow-node-position');
    await field('节点横向位置').fill(String(scriptX));
    await field('节点纵向位置').fill(String(scriptY));
    await save();
    saved = await read();
    assert.deepEqual(componentIn(saved, ids.copy).list?.flowPositions?.[fixture.first.id], { x: scriptX, y: scriptY });
    await selectMap(ids.copy);
    await selectMode('custom');
    await expect(mode()).toHaveValue('custom');
    await save();
    current = componentIn(await read(), ids.copy);
    assert.equal(playerFlowMode(current), 'custom');
    assert.deepEqual(current.list?.flowPositions?.[fixture.first.id], { x: scriptX, y: scriptY });
    assert.deepEqual(current.list?.flowContent?.custom?.positions?.[fixture.first.id], { x: 910, y: 610 });
    assert.equal(componentIn(await read(), ids.empty).list?.flowContent, undefined);
    assert.equal(playerFlowMode(componentIn(await read(), ids.repair)), 'custom');
    await assertStoryUnchanged();
    evidence.modeSwitch = { scriptPosition: { x: scriptX, y: scriptY }, customPosition: { x: 910, y: 610 }, otherMapsIndependent: true };
  });

  await check('空图初始化明确保持零成员并只改变当前控件', async () => {
    await selectMap(ids.empty);
    await selectMode('custom');
    await view().getByRole('group', { name: '开始自定义剧情图', exact: true }).getByRole('button', { name: /^新建空图/ }).click();
    const saved = await save();
    assert.equal(playerFlowMode(componentIn(saved, ids.empty)), 'custom');
    assert.deepEqual(customIn(saved, ids.empty), { entries: [] });
    assert.equal(playerFlowMode(componentIn(saved, ids.copy)), 'custom');
    assert.equal(customEntries(saved, ids.copy).length, fixture.entries.length);
    evidence.emptyInitialization = { emptyEntries: customEntries(saved, ids.empty).length, copyEntries: customEntries(saved, ids.copy).length };
  });

  await check('空图可通过真实来源选择添加章节和小节入口', async () => {
    await openSources();
    await addEntry(fixture.first);
    await addEntry(fixture.second);
    const saved = await save(), entries = customEntries(saved, ids.empty);
    assert.deepEqual(entries.map(entry => entry.nodeId), [fixture.first.id, fixture.second.id]);
    assert.deepEqual(entries.map(entry => entry.owner), [firstOwner, secondOwner]);
    assert.equal(playerFlowMode(componentIn(saved, ids.copy)), 'custom');
    evidence.emptyAdded = entries.map(entry => ({ nodeId: entry.nodeId, owner: entry.owner }));
    await screenshot('03-empty-added-entries');
  });

  await check('相同剧情在第二张图使用独立文字、预设与仅查看动作', async () => {
    await selectNode(ids.empty, fixture.first.id);
    await field('节点文字第 1 段').fill('另一张图的标题');
    await field('当前节点外观预设').selectOption(ids.firstPreset);
    await field('点击节点时').selectOption('replay');
    const saved = await save();
    const copied = customEntries(saved, ids.copy).find(entry => entry.nodeId === fixture.first.id)!;
    const empty = customEntries(saved, ids.empty).find(entry => entry.nodeId === fixture.first.id)!;
    assert.deepEqual({ name: copied.name, styleId: copied.styleId, action: copied.action }, { name: '只属于复制图｜本地图的副标题', styleId: ids.secondPreset, action: 'inspect' });
    assert.deepEqual({ name: empty.name, styleId: empty.styleId, action: empty.action }, { name: '另一张图的标题', styleId: ids.firstPreset, action: undefined });
    await assertStoryUnchanged(saved);
    evidence.sameStoryDifferentControls = { copy: copied, empty };
  });

  await check('本图顺序调整支持撤销重做并保持每个成员数据', async () => {
    await returnMap();
    await openSources();
    const secondName = namesIn(await read(), ids.empty).find(entry => entry.id === fixture.second.id)!.name;
    await view().locator(`[data-flow-custom-node="${fixture.first.id}"]`).getByRole('button', { name: `下移节点：${namesIn(await read(), ids.empty).find(entry => entry.id === fixture.first.id)!.name}`, exact: true }).click();
    await expect(view().locator('.flow-custom-node').first()).toContainText(secondName);
    await undoButton().click();
    await expect(view().locator('.flow-custom-node').first()).toHaveAttribute('data-flow-custom-node', fixture.first.id);
    await redoButton().click();
    await expect(view().locator('.flow-custom-node').first()).toHaveAttribute('data-flow-custom-node', fixture.second.id);
    const saved = await save();
    assert.deepEqual(customEntries(saved, ids.empty).map(entry => entry.nodeId), [fixture.second.id, fixture.first.id]);
    assert.equal(customEntries(saved, ids.empty).find(entry => entry.nodeId === fixture.first.id)?.name, '另一张图的标题');
    evidence.customOrder = customEntries(saved, ids.empty).map(entry => entry.nodeId);
  });

  await check('移除本图成员后可撤销重做且不删除真实剧情', async () => {
    const current = await read(), secondName = namesIn(current, ids.empty).find(entry => entry.id === fixture.second.id)!.name;
    await view().locator(`[data-flow-custom-node="${fixture.second.id}"]`).getByRole('button', { name: `从本图移除：${secondName}`, exact: true }).click();
    await expect(view().locator(`[data-flow-custom-node="${fixture.second.id}"]`)).toHaveCount(0);
    await undoButton().click();
    await expect(view().locator(`[data-flow-custom-node="${fixture.second.id}"]`)).toBeVisible();
    await redoButton().click();
    await expect(view().locator(`[data-flow-custom-node="${fixture.second.id}"]`)).toHaveCount(0);
    const saved = await save();
    assert.deepEqual(customEntries(saved, ids.empty).map(entry => entry.nodeId), [fixture.first.id]);
    assert.ok(saved.nodes.some(node => node.id === fixture.second.id));
    await assertStoryUnchanged(saved);
    evidence.customRemoval = { remaining: customEntries(saved, ids.empty).map(entry => entry.nodeId), realNodeRetained: true };
  });

  await check('损坏节点修复保留本图文字、预设、动作和图内位置', async () => {
    await selectMap(ids.repair);
    await openSources();
    const card = view().locator(`[data-flow-missing-node="${ids.missingNode}"]`);
    await expect(card).toContainText('保留的孤立剧情');
    await card.getByLabel('修复剧情入口：保留的孤立剧情', { exact: true }).selectOption(ownerKey(fixture.paragraph));
    await card.getByRole('button', { name: '修复入口', exact: true }).click();
    await expect(view().locator(`[data-flow-missing-node="${ids.missingNode}"]`)).toHaveCount(0);
    await undoButton().click();
    await expect(view().locator(`[data-flow-missing-node="${ids.missingNode}"]`)).toBeVisible();
    await redoButton().click();
    const saved = await save(), repaired = customEntries(saved, ids.repair).find(entry => entry.nodeId === fixture.paragraph.id)!;
    assert.equal(repaired.owner?.kind, 'node');
    assert.equal(repaired.owner?.id, fixture.paragraph.owner?.id);
    assert.equal(repaired.name, '保留的孤立剧情');
    assert.equal(repaired.styleId, ids.secondPreset);
    assert.equal(repaired.action, 'inspect');
    assert.deepEqual(customIn(saved, ids.repair).positions?.[fixture.paragraph.id], { x: 840, y: 320 });
    assert.equal(customIn(saved, ids.repair).positions?.[ids.missingNode], undefined);
    evidence.nodeRepair = repaired;
  });

  await check('缺失所属来源的真实节点可修复并沿用原来分配的数据', async () => {
    const card = view().locator(`[data-flow-missing-node="${fixture.fifth.id}"]`);
    await expect(card).toContainText('保留的缺失来源');
    await card.getByLabel('修复剧情入口：保留的缺失来源', { exact: true }).selectOption(ownerKey(fixture.fifth));
    await card.getByRole('button', { name: '修复入口', exact: true }).click();
    await expect(view().locator(`[data-flow-missing-node="${fixture.fifth.id}"]`)).toHaveCount(0);
    const saved = await save(), repaired = customEntries(saved, ids.repair).find(entry => entry.nodeId === fixture.fifth.id)!;
    assert.deepEqual(repaired.owner, fifthOwner);
    assert.equal(repaired.name, '保留的缺失来源');
    assert.equal(repaired.styleId, ids.firstPreset);
    assert.equal(repaired.action, 'replay');
    assert.deepEqual(customIn(saved, ids.repair).positions?.[fixture.fifth.id], { x: 1040, y: 480 });
    assert.deepEqual(playerFlowMissingEntries(saved, componentIn(saved, ids.repair)), []);
    evidence.ownerRepair = repaired;
  });

  await check('分组选中本图成员并支持创建后的撤销重做', async () => {
    await selectMap(ids.copy);
    await openSources();
    const snapshot = await read(), entries = namesIn(snapshot, ids.copy);
    for (const id of [fixture.first.id, fixture.second.id]) {
      const name = entries.find(entry => entry.id === id)!.name;
      await field(`分组选择：${name}`).check();
    }
    await field('新剧情分组名称').fill('主线整理组');
    await button('添加剧情分组').click();
    const groupButton = () => view().getByRole('button', { name: '编辑剧情分组：主线整理组', exact: true });
    await expect(groupButton()).toBeVisible();
    await undoButton().click();
    await expect(groupButton()).toHaveCount(0);
    await redoButton().click();
    await expect(groupButton()).toBeVisible();
    const saved = await save(), created = playerFlowGroups(componentIn(saved, ids.copy))[0];
    assert.deepEqual(created.nodeIds, [fixture.first.id, fixture.second.id]);
    assert.equal(created.name, '主线整理组');
    evidence.groupCreated = created;
  });

  await check('分组重命名和折叠显示仅改变当前自定义图', async () => {
    const group = playerFlowGroups(componentIn(await read(), ids.copy))[0];
    await view().getByRole('button', { name: `编辑剧情分组：${group.name}`, exact: true }).click();
    await scope('group');
    await field('剧情分组名称').fill('第一章节点组');
    await field('在整图中显示为分组').uncheck();
    await expect(groupCard(ids.copy, group.id)).toHaveCount(0);
    await expect(flowNode(ids.copy, fixture.first.id)).toBeVisible();
    await undoButton().click();
    await expect(groupCard(ids.copy, group.id)).toBeVisible();
    await redoButton().click();
    await expect(groupCard(ids.copy, group.id)).toHaveCount(0);
    const saved = await save(), updated = playerFlowGroups(componentIn(saved, ids.copy))[0];
    assert.equal(updated.collapsed, false);
    assert.equal(playerFlowGroups(componentIn(saved, ids.copy))[0].name, '第一章节点组');
    assert.equal(playerFlowMode(componentIn(saved, ids.empty)), 'custom');
    evidence.groupExpanded = updated;
  });

  await check('分组成员可以独立加入或移出且每个成员只属于一个组', async () => {
    const thirdName = namesIn(await read(), ids.copy).find(entry => entry.id === fixture.third.id)!.name;
    await field(`加入此分组：${thirdName}`).check();
    await expect(field(`加入此分组：${thirdName}`)).toBeChecked();
    await undoButton().click();
    await expect(field(`加入此分组：${thirdName}`)).not.toBeChecked();
    await redoButton().click();
    await expect(field(`加入此分组：${thirdName}`)).toBeChecked();
    const secondName = namesIn(await read(), ids.copy).find(entry => entry.id === fixture.second.id)!.name;
    await field(`加入此分组：${secondName}`).uncheck();
    await expect(field(`加入此分组：${secondName}`)).not.toBeChecked();
    const saved = await save(), updated = playerFlowGroups(componentIn(saved, ids.copy))[0];
    assert.deepEqual(updated.nodeIds, [fixture.first.id, fixture.third.id]);
    assert.equal(playerFlowGroups(componentIn(saved, ids.empty)).length, 0);
    evidence.groupMembers = updated.nodeIds;
  });

  await check('分组卡片双击进入并从面包屑返回到同一整图', async () => {
    const group = playerFlowGroups(componentIn(await read(), ids.copy))[0];
    await field('在整图中显示为分组').check();
    await save();
    const card = groupCard(ids.copy, group.id);
    await expect(card).toBeVisible();
    await card.dblclick();
    const breadcrumb = component(ids.copy).locator('[data-flow-breadcrumb]');
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb.getByRole('button', { name: '返回剧情图', exact: true })).toBeVisible();
    await expect(component(ids.copy).locator(`[data-flow-group-member-of="${group.id}"][data-flow-node="${fixture.first.id}"]`)).toBeVisible();
    await expect(groupCard(ids.copy, group.id)).toHaveCount(0);
    await breadcrumb.getByRole('button', { name: '返回剧情图', exact: true }).click();
    await expect(groupCard(ids.copy, group.id)).toBeVisible();
    await card.focus();
    await card.press('Enter');
    await expect(breadcrumb).toBeVisible();
    await breadcrumb.getByRole('button', { name: '返回剧情图', exact: true }).press('Escape');
    await expect(groupCard(ids.copy, group.id)).toBeVisible();
    await assertStoryUnchanged();
    evidence.groupNavigation = { groupId: group.id, members: group.nodeIds };
    await screenshot('04-group-enter-return');
  });

  await check('组内节点坐标与整图分组卡坐标分开保存', async () => {
    const before = await read(), group = playerFlowGroups(componentIn(before, ids.copy))[0];
    const originalRootPosition = customIn(before, ids.copy).positions?.[fixture.first.id];
    await groupCard(ids.copy, group.id).dblclick();
    await flowNode(ids.copy, fixture.first.id).click();
    await scope('node');
    await openGroup('flow-node-position');
    await field('节点横向位置').fill('760');
    await field('节点纵向位置').fill('520');
    let saved = await save();
    assert.deepEqual(customIn(saved, ids.copy).groups?.find(item => item.id === group.id)?.positions?.[fixture.first.id], { x: 760, y: 520 });
    assert.deepEqual(customIn(saved, ids.copy).positions?.[fixture.first.id], originalRootPosition);
    await component(ids.copy).locator('[data-flow-breadcrumb]').getByRole('button', { name: '返回剧情图', exact: true }).click();
    const card = groupCard(ids.copy, group.id), box = await card.boundingBox();
    assert.ok(box);
    await page!.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page!.mouse.down();
    await page!.mouse.move(box.x + box.width / 2 + 48, box.y + box.height / 2 + 28, { steps: 5 });
    await page!.mouse.up();
    saved = await save();
    const groupPosition = customIn(saved, ids.copy).groups?.find(item => item.id === group.id)?.position;
    assert.ok(groupPosition && (groupPosition.x > 0 || groupPosition.y > 0));
    assert.deepEqual(customIn(saved, ids.copy).groups?.find(item => item.id === group.id)?.positions?.[fixture.first.id], { x: 760, y: 520 });
    evidence.groupPositions = { outer: groupPosition, inner: customIn(saved, ids.copy).groups?.find(item => item.id === group.id)?.positions?.[fixture.first.id] };
  });

  await check('目录视图同样显示分组并支持进入和返回', async () => {
    const group = playerFlowGroups(componentIn(await read(), ids.copy))[0];
    await returnMap();
    await openGroup('flow-mode');
    await field('流程图排列').selectOption('grid');
    const card = component(ids.copy).locator(`.ui-flow-directory [data-flow-group="${group.id}"]`);
    await expect(card).toBeVisible();
    await card.dblclick();
    const breadcrumb = component(ids.copy).locator('[data-flow-breadcrumb]');
    await expect(breadcrumb).toBeVisible();
    await expect(component(ids.copy).locator(`[data-flow-group-member-of="${group.id}"][data-flow-node="${fixture.first.id}"]`)).toBeVisible();
    await breadcrumb.getByRole('button', { name: '返回剧情图', exact: true }).click();
    await expect(component(ids.copy).locator(`.ui-flow-directory [data-flow-group="${group.id}"]`)).toBeVisible();
    await card.press('Enter');
    await expect(breadcrumb).toBeVisible();
    await breadcrumb.getByRole('button', { name: '返回剧情图', exact: true }).press('Escape');
    await expect(card).toBeVisible();
    await scope('map');
    await field('流程图排列').selectOption('flow');
    await save();
    evidence.directoryGroup = { id: group.id, members: group.nodeIds };
    await screenshot('05-directory-group-navigation');
  });

  await check('真实剧情连线可查看实际路径与分支来源', async () => {
    const group = playerFlowGroups(componentIn(await read(), ids.copy))[0];
    const edge = component(ids.copy).locator(`[data-flow-edge-from="${group.id}"][data-flow-edge-to="${fixture.second.id}"] [data-flow-edge-hit]`);
    await expect(edge).toHaveCount(1);
    await edge.click();
    await scope('edge');
    await expect(flow().locator(`[data-flow-edge-source="${group.id}:${fixture.second.id}"]`)).toBeVisible();
    await expect(flow().locator('.flow-content-path')).toContainText('去回廊');
    await expect(flow().getByRole('button', { name: '定位路径剧情：真实剧情分支', exact: true })).toBeVisible();
    const saved = await read();
    assert.equal(saved.nodes.find(node => node.id === ids.choice)?.kind, 'choice');
    await assertStoryUnchanged(saved);
    evidence.routeSource = { from: group.id, to: fixture.second.id, explanation: (await flow().locator('.flow-content-path').innerText()).trim() };
    await screenshot('06-real-route-source');
  });

  await check('隐藏未到达节点时同时隐藏它连接的真实剧情线', async () => {
    await selectMap(ids.empty);
    await openGroup('flow-player');
    await field('可进入的剧情').selectOption('reached');
    await field('未到达的节点').selectOption('hide');
    await openSources();
    await addEntry(fixture.second);
    await save();
    await returnMap();
    await button('剧情图预览').click();
    const preview = page!.getByRole('dialog', { name: '剧情图预览', exact: true });
    await preview.getByLabel('预览玩家进度', { exact: true }).selectOption('partial');
    await expect(flowNode(ids.empty, fixture.first.id)).toBeVisible();
    await expect(flowNode(ids.empty, fixture.second.id)).toHaveCount(0);
    const edges = await component(ids.empty).locator('.ui-story-flow-preview [data-flow-edge-from][data-flow-edge-to]').evaluateAll(elements => elements.map(element => ({
      from: element.getAttribute('data-flow-edge-from'), to: element.getAttribute('data-flow-edge-to'),
    })));
    assert.deepEqual(edges, []);
    await preview.getByRole('button', { name: '关闭剧情图预览', exact: true }).click();
    evidence.lockedMap = { visible: [fixture.first.id], hidden: [fixture.second.id], edges };
    await screenshot('07-hidden-unreached-node-and-edge');
  });

  await check('派生方案查看脚本连线来源并把自定义改动保存为本地覆盖', async () => {
    await selectInstance(ids.activeScheme);
    await selectMap(ids.inherited);
    await expect(inspector().locator('.ui-inspector-object span')).toContainText('沿用父级界面方案');
    const scriptEdge = component(ids.inherited).locator(`[data-flow-edge-from="${fixture.first.id}"][data-flow-edge-to="${fixture.third.id}"] [data-flow-edge-hit]`);
    await expect(scriptEdge).toHaveCount(1);
    // Horizontal SVG paths have a zero-height box; click their painted stroke.
    const edgePoint = await scriptEdge.evaluate(element => {
      const path = element as SVGGeometryElement;
      const point = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(path.getScreenCTM()!);
      return { x: point.x, y: point.y, hit: document.elementFromPoint(point.x, point.y) === element };
    });
    assert.equal(edgePoint.hit, true, 'The inherited route stroke must be reachable by the pointer.');
    await page!.mouse.click(edgePoint.x, edgePoint.y);
    await scope('edge');
    await expect(flow().locator(`[data-flow-edge-source="${fixture.first.id}:${fixture.third.id}"]`)).toBeVisible();
    await expect(flow().locator('.flow-content-path')).toContainText('去书库');
    await expect(flow().getByRole('button', { name: '定位路径剧情：真实剧情分支', exact: true })).toBeVisible();
    assert.equal(await fs.readFile(projectFile, 'utf8'), savedBytes, 'Inspecting a script route must not write project data.');
    await returnMap();
    await selectMode('custom');
    await view().getByRole('group', { name: '开始自定义剧情图', exact: true }).getByRole('button', { name: /^从当前图开始/ }).click();
    await selectNode(ids.inherited, fixture.first.id);
    await field('节点文字第 1 段').fill('仅活动派生方案使用');
    const saved = await save();
    const baseMap = saved.ui.components.find(item => item.id === ids.inherited)!;
    const parentMap = saved.ui.instances?.find(instance => instance.id === ids.parentScheme)?.components.find(item => item.id === ids.inherited)!;
    const childMap = saved.ui.instances?.find(instance => instance.id === ids.activeScheme)?.components.find(item => item.id === ids.inherited)!;
    assert.equal(saved.ui.activeInstanceId, ids.activeScheme);
    assert.equal(baseMap.name, '基础方案原始剧情图');
    assert.equal(baseMap.list?.flowContent, undefined);
    assert.equal(parentMap.name, '父方案剧情图');
    assert.equal(parentMap.list?.flowContent, undefined);
    assert.equal(playerFlowMode(childMap), 'custom');
    assert.equal(customIn(saved, ids.inherited).entries.find(entry => entry.nodeId === fixture.first.id)?.name, '仅活动派生方案使用');
    await assertStoryUnchanged(saved);

    await selectInstance();
    const reset = await save();
    assert.equal(reset.ui.activeInstanceId, undefined);
    assert.equal(reset.ui.components.find(item => item.id === ids.inherited)?.list?.flowContent, undefined);
    assert.equal(reset.ui.instances?.find(instance => instance.id === ids.parentScheme)?.components.find(item => item.id === ids.inherited)?.list?.flowContent, undefined);
    assert.equal(reset.ui.instances?.find(instance => instance.id === ids.activeScheme)?.components.find(item => item.id === ids.inherited)?.list?.flowContent?.custom?.entries.find(entry => entry.nodeId === fixture.first.id)?.name, '仅活动派生方案使用');
    evidence.inheritedScheme = { base: baseMap.name, parent: parentMap.name, activeOverride: childMap.list?.flowContent?.mode, editedName: '仅活动派生方案使用', scriptRoute: '去书库' };
  });

  await check('自定义图和玩家预览不会改动剧本、章节、分支或全局页面', async () => {
    const saved = await read();
    await assertStoryUnchanged(saved);
    assert.equal(saved.scriptText?.content, fixture.originalScript);
    assert.equal(saved.nodes.find(node => node.id === ids.choice)?.kind, 'choice');
    assert.equal(componentIn(saved, ids.copy).list?.flowContent?.mode, 'custom');
    assert.equal(componentIn(saved, ids.empty).list?.flowContent?.mode, 'custom');
    assert.equal(componentIn(saved, ids.repair).list?.flowContent?.mode, 'custom');
    evidence.storyIntegrity = { scriptPreserved: true, storyNodesPreserved: saved.nodes.length, globalPagePreserved: true };
  });

  await check('三张图各自保存重开后保留模式、成员、分组、动作和坐标', async () => {
    await save();
    const before = await read();
    await close();
    await launch();
    await unchanged();
    await selectMap(ids.copy);
    let reopened = await read();
    assert.equal(playerFlowMode(componentIn(reopened, ids.copy)), 'custom');
    assert.equal(customIn(reopened, ids.copy).groups?.[0].name, '第一章节点组');
    assert.deepEqual(customIn(reopened, ids.copy).groups?.[0].positions?.[fixture.first.id], { x: 760, y: 520 });
    assert.ok(customIn(reopened, ids.copy).groups?.[0].position);
    assert.equal(componentIn(reopened, ids.empty).list?.lockUnread, true);
    assert.deepEqual(customEntries(reopened, ids.empty).map(entry => entry.nodeId), [fixture.first.id, fixture.second.id]);
    assert.deepEqual(customEntries(reopened, ids.empty).find(entry => entry.nodeId === fixture.first.id)?.name, '另一张图的标题');
    assert.equal(playerFlowMissingEntries(reopened, componentIn(reopened, ids.repair)).length, 0);
    assert.deepEqual(customEntries(reopened, ids.repair).map(entry => entry.nodeId), [fixture.paragraph.id, fixture.fifth.id]);
    await assertStoryUnchanged(reopened);
    evidence.reopened = { copyGroup: customIn(reopened, ids.copy).groups?.[0], emptyEntries: customEntries(reopened, ids.empty), repairedEntries: customEntries(reopened, ids.repair) };
    await screenshot('08-reopened-three-independent-maps');
    assert.deepEqual(storySnapshot(reopened), storySnapshot(before));
  });

  await check('取消从剧本重建保留当前自定义成员和分组', async () => {
    await selectMap(ids.copy);
    await selectMode('custom');
    await button('从剧本重新生成').click();
    const dialog = view().getByRole('alertdialog', { name: '从剧本重新生成', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '保留当前内容', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await unchanged();
    const saved = await read();
    assert.equal(customIn(saved, ids.copy).groups?.[0].name, '第一章节点组');
    assert.equal(customEntries(saved, ids.copy).length, fixture.entries.length);
    evidence.regenerateCancelled = true;
  });

  await check('确认重建只替换当前自定义内容并可撤销重做', async () => {
    const oldGroup = customIn(await read(), ids.copy).groups![0];
    await button('从剧本重新生成').click();
    const dialog = view().getByRole('alertdialog', { name: '从剧本重新生成', exact: true });
    await dialog.getByRole('button', { name: '替换自定义内容', exact: true }).click();
    await expect(groupCard(ids.copy, oldGroup.id)).toHaveCount(0);
    await undoButton().click();
    await expect(groupCard(ids.copy, oldGroup.id)).toBeVisible();
    await redoButton().click();
    await expect(groupCard(ids.copy, oldGroup.id)).toHaveCount(0);
    const appProject = await save();
    const rebuilt = customIn(appProject, ids.copy);
    assert.deepEqual(rebuilt.entries.map(entry => entry.nodeId), fixture.entries.map(entry => entry.id));
    assert.deepEqual(rebuilt.groups ?? [], []);
    assert.equal(rebuilt.entries.find(entry => entry.nodeId === fixture.first.id)?.name, fixture.first.parts?.join('｜') || fixture.first.name);
    assert.equal(rebuilt.entries.find(entry => entry.nodeId === fixture.first.id)?.action, undefined);
    assert.deepEqual(componentIn(appProject, ids.empty).list?.flowContent?.custom?.entries.find(entry => entry.nodeId === fixture.first.id)?.name, '另一张图的标题');
    await assertStoryUnchanged(appProject);
    evidence.regenerated = { entries: rebuilt.entries.length, groups: rebuilt.groups?.length ?? 0, emptyMapRetained: true };
  });

  await check('窄栏深浅主题下模式、成员管理和修复面板均不横向溢出', async () => {
    const layouts: unknown[] = [];
    for (const [name, themeId] of [['黑白', 'codexDark'], ['亮白', 'codexLight']] as const) {
      await theme(name, themeId);
      await size(1024, 768);
      await selectMap(ids.copy);
      await openGroup('flow-mode');
      layouts.push({ theme: themeId, scope: 'mode', ...await fitSnapshot(flow()) });
      await openSources();
      layouts.push({ theme: themeId, scope: 'sources', ...await fitSnapshot(view().locator('.flow-custom-content')) });
      const names = await view().locator('.flow-custom-node > label').evaluateAll(elements => elements.map(element => ({ text: element.textContent, availableWidth: element.getBoundingClientRect().width - element.querySelector('input')!.getBoundingClientRect().width - 7 })));
      assert.ok(names.length && names.every(name => name.availableWidth >= 100), 'Narrow panels must leave enough room for node names: ' + JSON.stringify(names));
      await view().locator('.flow-custom-node').first().scrollIntoViewIfNeeded();
      const actionCenters = await view().locator('.flow-custom-node').first().locator('.flow-custom-node-actions button').evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect(); return box.top + box.height / 2; }));
      assert.ok(Math.max(...actionCenters) - Math.min(...actionCenters) < 2, 'The five compact actions must fit on one row: ' + JSON.stringify(actionCenters));
      await screenshot(`09-${themeId}-narrow-content`);
      await selectMap(ids.repair);
      await openSources();
      layouts.push({ theme: themeId, scope: 'repair', ...await fitSnapshot(view().locator('.ui-player-flow-inspector')) });
      await size(1600, 1000);
    }
    evidence.layouts = layouts;
    await assertStoryUnchanged();
    await unchanged();
  });

  assert.equal(checks.length, 27);
  assert.deepEqual(errors, [], 'Renderer must not raise runtime errors.');
  report.buildAfter = await fingerprints();
  assert.deepEqual(report.buildAfter, report.buildBefore, 'Acceptance must use one unchanged compiled build.');
  report.status = 'passed';
} catch (error) {
  failure = error;
  report.status = 'failed';
  report.phase = phase;
  report.error = String(error);
  if (app && page && !page.isClosed()) {
    report.scopeAtFailure = await inspector().getAttribute('data-ui-flow-view').catch(() => undefined);
    report.inspectorAtFailure = await flow().innerText().catch(() => undefined);
    await screenshot('failure').catch(capture => { report.captureError = String(capture); });
  }
} finally {
  try { await close(); }
  catch (error) { report.status = 'failed'; report.closeError = String(error); failure ??= error; }
  try {
    if (app || processes.some(record => !record.exited)) throw new Error('An owned fixture process remains alive; retain its directories.');
    const cleanup = await cleanVerificationDirectories(output, ['fixture', 'profile']);
    report.cleanup = cleanup;
    assert.deepEqual(cleanup.errors, []);
  } catch (error) {
    report.status = 'failed'; report.cleanupError = String(error); failure ??= error;
  }
  await fs.mkdir(output, { recursive: true });
  await writeReport();
  console.log(output);
}
if (failure) throw failure;
