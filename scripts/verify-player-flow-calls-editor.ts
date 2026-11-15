import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { projectSchema, type Project } from '../src/core/model';
import { playerFlowAllEntries } from '../src/core/player-flow-content';
import { projectToText } from '../src/core/text-script';
import { validateProject } from '../src/core/validate';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { openDisclosureAncestors } from './lib/ui-disclosures';
import { createPlayerFlowCallsFixture, playerFlowCallsIds, playerFlowCallBodyId, playerFlowCallCardId } from './lib/player-flow-calls-fixture';

// Pending acceptance: execute only after every implementation is integrated and
// the main thread has produced the unified source build. Never use the installed editor.
if (process.env.VNS_INSTALLED_EXE) throw new Error('本专项只接受隔离工程的源码编译版编辑器。');
const root = path.resolve('.');
const acceptanceRoot = path.join(root, 'artifacts', 'player-flow-calls-2026-11-14');
const outputRoot = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? path.join(acceptanceRoot, 'editor'));
const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return !!relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
};
// Restrict overrides lexically before any I/O: historical artifacts, including
// previously refused cleanup paths, are never visited or probed by this script.
assert.ok(outputRoot === acceptanceRoot || inside(acceptanceRoot, outputRoot),
  'VNS_ARTIFACT_ROOT 必须位于本轮新目录 artifacts/player-flow-calls-2026-11-14 内。');
const output = path.join(outputRoot, `editor-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
const fixtureDirectory = path.join(output, 'fixture'), profile = path.join(output, 'profile');
const projectFile = path.join(fixtureDirectory, 'project.vns.json');
const fixture = createPlayerFlowCallsFixture(), initial = fixture.project, ids = playerFlowCallsIds;
const xView = playerFlowCallBodyId(ids.x), yView = playerFlowCallBodyId(ids.y);
const firstCard = playerFlowCallCardId(ids.first), secondCard = playerFlowCallCardId(ids.second), nestedCard = playerFlowCallCardId(ids.nested);
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const componentIn = (project: Project, id: string) => {
  const result = project.ui.components.find(component => component.id === id);
  assert.ok(result, 'Expected a generated fixture control: ' + id);
  return result;
};
const customIn = (project: Project) => componentIn(project, ids.custom).list!.flowContent!.custom!;
const storySnapshot = (project: Project) => structuredClone({ scriptText: project.scriptText, entryId: project.entryId,
  chapters: project.chapters, scenes: project.scenes, nodes: project.nodes, styles: project.ui.flowStyles, page: project.ui.pages?.flowchart });
const originalStory = storySnapshot(initial);
const originalGroup = structuredClone(customIn(initial).groups![0]);
const appearanceSnapshot = (project: Project) => structuredClone({
  script: componentIn(project, ids.script).style, custom: componentIn(project, ids.custom).style, presets: project.ui.flowStyles,
});
const originalAppearance = appearanceSnapshot(initial);

let app: ElectronApplication | undefined, page: Page | undefined, failure: unknown, phase = '准备';
let launchNumber = 0, traceRunning = false, savedBytes = '';
const checks: { name: string; durationMs: number }[] = [], errors: string[] = [], traces: string[] = [];
const processes: { pid?: number; exited: boolean; forced?: boolean }[] = [];
const evidence: Record<string, unknown> = {};
const report: Record<string, unknown> = { status: 'running', renderer: 'compiled', checks, errors, traces, processes, evidence,
  outputDirectory: output, temporaryPaths: [fixtureDirectory, profile], fixtureDiagnostics: fixture.diagnostics,
  limits: [
    '仅使用自建故事、跟随剧本和自定义控件；真实作品及历史 artifacts 均不读取、不修改、不检查。',
    '只验收实际 Electron DOM、真实鼠标/键盘、工程保存重开；不依赖 React 内部状态，不启动原生游戏。',
    '递归选项仅检查有限视图导航；诊断如存在会记录，不把没有诊断作为验收条件。',
    '临时工程和独立 profile 在退出自有进程后清理；报告、截图、trace 和夹具 JSON 证据保留。',
  ] };

const button = (name: string) => page!.getByRole('button', { name, exact: true });
const inspector = () => page!.locator('.ui-inspector[data-ui-flow-view]');
const inspectorView = () => inspector().locator('.ui-inspector-view:not([hidden])');
const flow = () => inspectorView().locator('.ui-player-flow-inspector');
const field = (name: string) => inspectorView().getByLabel(name, { exact: true });
const component = (id: string) => page!.locator(`[data-component-id="${id}"]`);
const surface = (id: string) => component(id).locator('[data-flow-view-id]');
const flowNode = (mapId: string, nodeId: string) => surface(mapId).locator(`[data-flow-node="${nodeId}"]`);
const callCard = (mapId: string, callId: string) => surface(mapId).locator(`[data-flow-call="${callId}"]`);
const breadcrumb = (mapId: string) => surface(mapId).locator('[data-flow-breadcrumb]');
const undo = () => button('撤销'), redo = () => button('重做'), saveButton = () => button('保存界面');
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const settle = () => page!.evaluate('async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); }');

async function writeReport() { await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
async function fingerprints() {
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  const files = ['dist/index.html', 'dist-desktop/main.cjs', 'dist-desktop/preload.cjs',
    ...[...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => 'dist/' + match[1].slice(2))];
  assert.ok(files.some(file => file.startsWith('dist/assets/') && file.endsWith('.js')), 'Expected the unified compiled renderer.');
  return Promise.all([...new Set(files)].map(async file => ({ file, sha256: sha256(await fs.readFile(path.join(root, file))) })));
}
async function screenshot(name: string) {
  await settle();
  const data = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(data, 'base64'));
}
async function check(name: string, work: () => Promise<void>) {
  phase = name;
  const started = Date.now();
  await work();
  checks.push({ name, durationMs: Date.now() - started });
  await writeReport();
  console.log('通过：' + name);
}
async function scope(expected: 'map' | 'node' | 'call' | 'group' | 'edge') {
  await expect(inspector()).toHaveAttribute('data-ui-flow-view', expected);
  await expect(flow()).toHaveAttribute('data-flow-inspector-target', expected);
  await expect(flow()).toBeVisible();
}
async function openGroup(id: string) {
  const summary = inspectorView().locator(`[data-ui-inspector-group="${id}"] > summary`);
  await openDisclosureAncestors(summary);
  await expect(summary).toBeVisible();
}
async function returnMapInspector() {
  if (await inspector().getAttribute('data-ui-flow-view') !== 'map') {
    await inspector().locator('.ui-inspector-header').getByRole('button', { name: '返回整张图设置', exact: true }).click();
  }
  await scope('map');
}
async function currentView(mapId: string, viewId = 'root', kind: 'root' | 'call' | 'group' = 'root') {
  await expect(surface(mapId)).toHaveCount(1);
  await expect(surface(mapId)).toHaveAttribute('data-flow-view-id', viewId);
  await expect(surface(mapId)).toHaveAttribute('data-flow-view-kind', kind);
}
async function back(mapId: string) {
  const candidate = breadcrumb(mapId).getByRole('button', { name: /^(返回上一级剧情图|返回剧情图)$/ });
  await expect(candidate).toHaveCount(1);
  await candidate.click();
  await settle();
}
async function rootView(mapId: string) {
  for (let depth = 0; depth < 8 && await surface(mapId).getAttribute('data-flow-view-id') !== 'root'; depth++) await back(mapId);
  await currentView(mapId);
  await returnMapInspector();
}
async function selectMap(mapId: string, returnRoot = true) {
  await page!.locator(`[data-hierarchy-id="${mapId}"] .ui-hierarchy-caption`).click();
  await scope('map');
  if (returnRoot) await rootView(mapId);
}
async function setLayout(value: 'flow' | 'grid') {
  await returnMapInspector(); await openGroup('flow-mode');
  await field('流程图排列').selectOption(value);
  await settle();
}
async function enterCall(mapId: string, callId: string, targetId: string, keyboard = false) {
  const card = callCard(mapId, callId);
  await expect(card).toHaveAttribute('data-flow-node', playerFlowCallCardId(callId));
  await expect(card).toHaveAttribute('data-flow-call-target', targetId);
  await expect(card).toHaveAttribute('data-flow-call-view', playerFlowCallBodyId(targetId));
  if (keyboard) { await card.focus(); await card.press('Enter'); } else await card.dblclick();
  await currentView(mapId, playerFlowCallBodyId(targetId), 'call');
  await expect(breadcrumb(mapId)).toBeVisible();
  await expect(breadcrumb(mapId).getByRole('button', { name: '返回上一级剧情图', exact: true })).toBeVisible();
}
async function selectNode(mapId: string, nodeId: string) {
  await returnMapInspector();
  await flowNode(mapId, nodeId).click();
  await scope('node');
  await expect(flow()).toHaveAttribute('data-flow-editing-node', nodeId);
}
async function selectCall(mapId: string, callId: string) {
  await returnMapInspector();
  await callCard(mapId, callId).click();
  await scope('call');
  await expect(flow().locator(`[data-flow-call-detail="${callId}"]`)).toBeVisible();
}
async function position(x: number, y: number) {
  await openGroup('flow-node-position');
  await field('节点横向位置').fill(String(x));
  await field('节点纵向位置').fill(String(y));
  await expect(field('节点横向位置')).toHaveValue(String(x));
  await expect(field('节点纵向位置')).toHaveValue(String(y));
}
async function save() {
  if (await saveButton().isEnabled()) await saveButton().click();
  await expect(page!.locator('.ui-save-status')).toHaveAttribute('data-dirty', 'false', { timeout: 30000 });
  await expect(saveButton()).toBeDisabled();
  savedBytes = await fs.readFile(projectFile, 'utf8');
  return read();
}
async function unchanged() {
  await expect(saveButton()).toBeDisabled();
  assert.equal(await fs.readFile(projectFile, 'utf8'), savedBytes, 'Viewing/navigating calls must not save a display or story edit.');
}
async function storyUnchanged(project?: Project) {
  const saved = project ?? await read();
  assert.deepEqual(storySnapshot(saved), originalStory, 'Local graph navigation/layout edits must preserve the real story and source text.');
  assert.equal(saved.scriptText?.content, fixture.originalScript);
  assert.equal(projectToText(saved), fixture.originalScript);
  assert.deepEqual(appearanceSnapshot(saved), originalAppearance, 'Old segmented text and black backdrop settings must remain exact.');
}
async function graphSnapshot(mapId: string, nodeIds: string[], edges?: [string, string][]) {
  const result = await surface(mapId).evaluate(element => ({
    viewId: element.getAttribute('data-flow-view-id'), kind: element.getAttribute('data-flow-view-kind'),
    nodes: [...element.querySelectorAll('[data-flow-node]')].map(node => node.getAttribute('data-flow-node')!).sort(),
    calls: [...element.querySelectorAll('[data-flow-call]')].map(node => ({ id: node.getAttribute('data-flow-call'),
      node: node.getAttribute('data-flow-node'), target: node.getAttribute('data-flow-call-target'), view: node.getAttribute('data-flow-call-view') })),
    edges: [...element.querySelectorAll('[data-flow-edge]')].map(edge => [edge.getAttribute('data-flow-edge-from')!, edge.getAttribute('data-flow-edge-to')!]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  }));
  assert.deepEqual(result.nodes, [...nodeIds].sort(), 'The canvas must contain exactly the selected entries for its current view.');
  if (edges) assert.deepEqual(result.edges, [...edges].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    'The canvas must show the real call/continuation or branch edges, without parallel target leakage.');
  return result;
}
async function inspectEdge(mapId: string, from: string, to: string) {
  const stroke = surface(mapId).locator(`[data-flow-edge-from="${from}"][data-flow-edge-to="${to}"] [data-flow-edge-hit]`);
  await expect(stroke).toHaveCount(1);
  // Horizontal SVGs may have a zero-height box. Branches can also share the
  // midpoint with a later-painted sibling's wide pointer stroke. Reveal the
  // destination, then find a visible point on this exact painted route.
  await flowNode(mapId, to).scrollIntoViewIfNeeded();
  await settle();
  const hitTest = await stroke.evaluate(element => {
    const path = element as SVGGeometryElement;
    const matrix = path.getScreenCTM();
    if (!matrix) return { point: undefined, misses: [], points: element.getAttribute('points') };
    const total = path.getTotalLength();
    const fractions = Array.from({ length: 99 }, (_, index) => (index + 1) / 100)
      .sort((a, b) => Math.abs(a - .5) - Math.abs(b - .5));
    const misses: { fraction: number; x: number; y: number; hit: string | null }[] = [];
    for (const fraction of fractions) {
      const sample = path.getPointAtLength(total * fraction).matrixTransform(matrix);
      const target = document.elementFromPoint(sample.x, sample.y);
      if (target === element) return { point: { x: sample.x, y: sample.y, fraction }, misses, points: element.getAttribute('points') };
      if (misses.length < 8) misses.push({ fraction, x: sample.x, y: sample.y,
        hit: target?.closest('[data-flow-edge]')?.getAttribute('data-flow-edge')
          ?? target?.closest('[data-flow-node]')?.getAttribute('data-flow-node') ?? target?.tagName ?? null });
    }
    return { point: undefined, misses, points: element.getAttribute('points') };
  });
  assert.ok(hitTest.point, 'The rendered route stroke must have a reachable visible point: ' + JSON.stringify({ from, to, ...hitTest }));
  const point = hitTest.point;
  await page!.mouse.move(point.x, point.y);
  assert.equal(await stroke.evaluate((element, at) => document.elementFromPoint(at.x, at.y) === element, point), true,
    'The chosen pointer point must still hit the exact requested route before clicking.');
  const clicks = evidence.edgeClicks as unknown[] | undefined;
  evidence.edgeClicks = [...(clicks ?? []), { from, to, ...hitTest }];
  await page!.mouse.click(point.x, point.y);
  await scope('edge');
  await expect(surface(mapId).locator(`[data-flow-edge-from="${from}"][data-flow-edge-to="${to}"]`)).toHaveAttribute('data-flow-edge-selected', '');
  await expect(flow().locator(`[data-flow-edge-source="${from}:${to}"]`)).toBeVisible();
  return flow().locator('.flow-content-path').allTextContents();
}
async function captionAppearance(target: Locator) {
  await settle();
  return target.evaluate(element => ({
    parts: [...element.querySelectorAll<HTMLElement>('[data-flow-part]')].map(part => {
      const style = getComputedStyle(part);
      return { index: part.getAttribute('data-flow-part'), fontSize: style.fontSize, color: style.color, letterSpacing: style.letterSpacing };
    }),
    shadow: (() => { const node = element.querySelector<HTMLElement>('[data-flow-caption-shadow]');
      if (!node) return null;
      const style = getComputedStyle(node);
      return { color: style.color, opacity: style.opacity, filter: style.filter, stroke: style.webkitTextStrokeWidth, transform: style.transform };
    })(),
  }));
}
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile, devUrl: '' });
  launchNumber++; processes.push({ pid: app.process().pid, exited: false });
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(initial.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html'));
  report.rendererUrl = page.url();
  await page.evaluate('globalThis.__name = value => value');
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false }); traceRunning = true;
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window.isMinimized()) window.restore(); if (window.isMaximized()) window.unmaximize();
    window.setContentSize(1600, 1000); window.webContents.setBackgroundThrottling(false);
  });
  await expect.poll(() => page!.evaluate(() => Math.max(Math.abs(innerWidth - 1600), Math.abs(innerHeight - 1000)))).toBeLessThanOrEqual(1);
  await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '设计', exact: true }).click();
  await page.getByLabel('设计页面', { exact: true }).selectOption('flowchart');
  await page.getByLabel('画面缩放比例', { exact: true }).selectOption('50');
  await selectMap(ids.script); await settle();
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
  } finally { record.exited = exited(); if (record.exited) { app = undefined; page = undefined; } }
  if (closeError) throw closeError;
}

try {
  await fs.mkdir(output, { recursive: true });
  report.buildBefore = await fingerprints();
  await fs.mkdir(fixtureDirectory, { recursive: true });
  await saveProject(projectFile, initial);
  savedBytes = await fs.readFile(projectFile, 'utf8');
  report.fixtureSha256Before = sha256(savedBytes);
  await fs.writeFile(path.join(output, 'fixture-source.json'), JSON.stringify(initial, null, 2));
  await launch();

  await check('旧跟随剧本根图显示 A→调用X→B→调用X→C，正文不会并列泄漏', async () => {
    const saved = await read();
    assert.equal(componentIn(saved, ids.script).list?.flowContent, undefined);
    evidence.scriptRoot = await graphSnapshot(ids.script, fixture.rootIds, fixture.rootEdges);
    await expect(callCard(ids.script, ids.first)).toHaveAttribute('data-flow-manual', '');
    await expect(callCard(ids.script, ids.second)).toHaveAttribute('data-flow-manual', '');
    assert.deepEqual(componentIn(saved, ids.script).list?.flowPositions, componentIn(initial, ids.script).list?.flowPositions);
    evidence.legacyCallAppearance = await captionAppearance(callCard(ids.script, ids.first));
    assert.ok((evidence.legacyCallAppearance as Awaited<ReturnType<typeof captionAppearance>>).shadow);
    await storyUnchanged(saved); await unchanged(); await screenshot('01-script-root-call-continuations');
  });

  await check('自定义根图保留既有结局组，两调用仍有独立后续', async () => {
    await selectMap(ids.custom);
    evidence.customRoot = await graphSnapshot(ids.custom, fixture.customRootIds, fixture.customRootEdges);
    await expect(flowNode(ids.custom, ids.group)).toHaveAttribute('data-flow-group', ids.group);
    assert.deepEqual(customIn(await read()).groups![0], originalGroup);
    await unchanged(); await screenshot('02-custom-root-kept-group');
  });

  await check('单击调用显示该实例详情，查看不写入工程', async () => {
    await selectMap(ids.script);
    await selectCall(ids.script, ids.first);
    await currentView(ids.script);
    await expect(flow().getByRole('button', { name: '进入子剧情', exact: true })).toBeVisible();
    await expect(field('节点文字第 1 段')).toHaveCount(0);
    evidence.firstDetail = await flow().locator(`[data-flow-call-detail="${ids.first}"]`).innerText();
    await unchanged();
  });

  await check('双击进入共享 X，实际选择、嵌套调用和返回节点保留', async () => {
    await enterCall(ids.script, ids.first, ids.x);
    evidence.xBody = await graphSnapshot(ids.script, fixture.xIds, fixture.xEdges);
    await expect(flowNode(ids.script, ids.xReturn)).toBeVisible();
    await expect(flowNode(ids.script, ids.a)).toHaveCount(0);
    await unchanged(); await screenshot('03-shared-x-with-branches');
  });

  await check('X 分支连线可点击并显示真实选择来源', async () => {
    const paths = await inspectEdge(ids.script, ids.xChoice, ids.xLeft);
    assert.ok(paths.join('\n').includes('嵌套调用 Y'));
    await expect(flow().getByRole('button', { name: '定位路径剧情：X 的实际选择', exact: true })).toBeVisible();
    evidence.branchPaths = paths;
    await returnMapInspector(); await unchanged();
  });

  await check('嵌套 Y 双击进入后逐层返回 X 和根图', async () => {
    await enterCall(ids.script, ids.nested, ids.y);
    evidence.yBody = await graphSnapshot(ids.script, fixture.yIds, fixture.yEdges);
    await back(ids.script); await currentView(ids.script, xView, 'call');
    await graphSnapshot(ids.script, fixture.xIds, fixture.xEdges);
    await back(ids.script); await currentView(ids.script);
    await graphSnapshot(ids.script, fixture.rootIds, fixture.rootEdges);
    await unchanged(); await screenshot('04-returned-to-root');
  });

  await check('Enter 进入嵌套调用，Escape 每次只返回一层', async () => {
    await enterCall(ids.script, ids.first, ids.x, true);
    await enterCall(ids.script, ids.nested, ids.y, true);
    await breadcrumb(ids.script).getByRole('button', { name: '返回上一级剧情图', exact: true }).press('Escape');
    await currentView(ids.script, xView, 'call');
    await scope('call');
    await expect(flow().locator(`[data-flow-call-detail="${ids.nested}"]`)).toBeVisible();
    // Escape first leaves a selected card's inspector. The next press then
    // returns one view; this preserves the existing inspector-first shortcut.
    await breadcrumb(ids.script).getByRole('button', { name: '返回上一级剧情图', exact: true }).press('Escape');
    await currentView(ids.script, xView, 'call'); await scope('map');
    await breadcrumb(ids.script).getByRole('button', { name: '返回上一级剧情图', exact: true }).press('Escape');
    await currentView(ids.script); await unchanged();
  });

  await check('第二次调用进入同一 X，回根图仍续接 C 并区分实例详情', async () => {
    await selectCall(ids.script, ids.second);
    evidence.secondDetail = await flow().locator(`[data-flow-call-detail="${ids.second}"]`).innerText();
    assert.notEqual(evidence.secondDetail, evidence.firstDetail, 'Different call sites must retain distinct detail provenance.');
    await flow().getByRole('button', { name: '进入子剧情', exact: true }).click();
    await currentView(ids.script, xView, 'call');
    await graphSnapshot(ids.script, fixture.xIds, fixture.xEdges);
    await back(ids.script); await currentView(ids.script);
    const paths = await inspectEdge(ids.script, secondCard, ids.c);
    assert.ok(paths.join('\n').includes('第二次调用 X'));
    await returnMapInspector(); await unchanged();
  });

  await check('递归调用回到已在路径中的 X，导航层数保持有限', async () => {
    const rounds: unknown[] = [];
    for (let round = 0; round < 3; round++) {
      await enterCall(ids.script, ids.first, ids.x);
      const firstBreadcrumb = await breadcrumb(ids.script).innerText();
      await enterCall(ids.script, ids.nested, ids.y);
      await enterCall(ids.script, ids.recursive, ids.x, true);
      assert.equal(await breadcrumb(ids.script).innerText(), firstBreadcrumb, 'Recursive navigation must return to the existing X trail.');
      await graphSnapshot(ids.script, fixture.xIds, fixture.xEdges);
      await back(ids.script); await currentView(ids.script);
      rounds.push({ round, breadcrumb: firstBreadcrumb, returnedToRootInOneStep: true });
    }
    evidence.recursiveNavigation = rounds; await unchanged();
  });

  await check('跟随剧本根调用坐标独立修改、撤销重做并保存到旧位置表', async () => {
    await selectCall(ids.script, ids.first);
    const beforeStyle = await callCard(ids.script, ids.first).getAttribute('style');
    await position(360, 180);
    await field('节点横向位置').fill('390');
    await undo().click(); await expect(field('节点横向位置')).toHaveValue('360');
    await redo().click(); await expect(field('节点横向位置')).toHaveValue('390');
    await undo().click(); await expect(field('节点横向位置')).toHaveValue('360');
    const saved = await save();
    assert.deepEqual(componentIn(saved, ids.script).list?.flowPositions?.[firstCard], { x: 360, y: 180 });
    assert.deepEqual(componentIn(saved, ids.script).list?.flowPositions?.[secondCard], { x: 860, y: 105 });
    assert.notEqual(await callCard(ids.script, ids.first).getAttribute('style'), beforeStyle);
    await expect(callCard(ids.script, ids.first)).toHaveAttribute('data-flow-manual', '');
    await storyUnchanged(saved);
  });

  await check('跟随剧本 X 正文位置仅保存在共享子视图，可撤销重做', async () => {
    await enterCall(ids.script, ids.first, ids.x);
    await selectNode(ids.script, ids.x); await position(180, 150);
    await field('节点横向位置').fill('200');
    await undo().click(); await expect(field('节点横向位置')).toHaveValue('180');
    await redo().click(); await expect(field('节点横向位置')).toHaveValue('200');
    await undo().click();
    const saved = await save();
    assert.deepEqual(componentIn(saved, ids.script).list?.flowContent?.scriptViews?.[xView]?.[ids.x], { x: 180, y: 150 });
    assert.equal(componentIn(saved, ids.script).list?.flowPositions?.[ids.x], undefined);
    assert.deepEqual(componentIn(saved, ids.script).list?.flowPositions?.[firstCard], { x: 360, y: 180 });
    await expect(flowNode(ids.script, ids.x)).toHaveAttribute('data-flow-manual', '');
    await storyUnchanged(saved);
  });

  await check('X 内 Y 调用坐标属于 X；第二外层实例进入后共用正文布局', async () => {
    await selectCall(ids.script, ids.nested); await position(760, 210);
    let saved = await save();
    assert.deepEqual(componentIn(saved, ids.script).list?.flowContent?.scriptViews?.[xView]?.[nestedCard], { x: 760, y: 210 });
    await back(ids.script); await currentView(ids.script);
    await enterCall(ids.script, ids.second, ids.x);
    await selectNode(ids.script, ids.x); await openGroup('flow-node-position');
    await expect(field('节点横向位置')).toHaveValue('180');
    await expect(field('节点纵向位置')).toHaveValue('150');
    await selectCall(ids.script, ids.nested); await openGroup('flow-node-position');
    await expect(field('节点横向位置')).toHaveValue('760');
    saved = await read(); await storyUnchanged(saved); await unchanged();
  });

  await check('嵌套 Y 坐标另存于 Y 子视图，不覆盖 X 或根调用', async () => {
    await enterCall(ids.script, ids.nested, ids.y); await selectNode(ids.script, ids.y); await position(190, 170);
    const saved = await save();
    assert.deepEqual(componentIn(saved, ids.script).list?.flowContent?.scriptViews?.[yView]?.[ids.y], { x: 190, y: 170 });
    assert.deepEqual(componentIn(saved, ids.script).list?.flowContent?.scriptViews?.[xView]?.[ids.x], { x: 180, y: 150 });
    assert.deepEqual(componentIn(saved, ids.script).list?.flowPositions?.[firstCard], { x: 360, y: 180 });
    await rootView(ids.script); await storyUnchanged(saved);
  });

  await check('自定义根调用坐标修改可撤销重做，另一控件和组保持独立', async () => {
    await selectMap(ids.custom); await selectCall(ids.custom, ids.first); await position(350, 195);
    await field('节点横向位置').fill('370');
    await undo().click(); await expect(field('节点横向位置')).toHaveValue('350');
    await redo().click(); await expect(field('节点横向位置')).toHaveValue('370');
    await undo().click();
    const saved = await save();
    assert.deepEqual(customIn(saved).positions?.[firstCard], { x: 350, y: 195 });
    assert.deepEqual(customIn(saved).positions?.[secondCard], { x: 895, y: 125 });
    assert.deepEqual(customIn(saved).groups![0], originalGroup);
    assert.deepEqual(componentIn(saved, ids.script).list?.flowPositions?.[firstCard], { x: 360, y: 180 });
    await storyUnchanged(saved);
  });

  await check('自定义 X 本地文字和子图位置保存，旧括号及黑底样式保留', async () => {
    await enterCall(ids.custom, ids.first, ids.x); await selectNode(ids.custom, ids.x);
    await field('节点文字第 1 段').fill('本图共享 X');
    await expect(field('节点文字第 2 段')).toHaveValue('旧版文字〖原样〗');
    await position(205, 165);
    const saved = await save();
    assert.equal(customIn(saved).entries.find(entry => entry.nodeId === ids.x)?.name, '本图共享 X｜旧版文字〖原样〗');
    assert.deepEqual(customIn(saved).views?.[xView]?.[ids.x], { x: 205, y: 165 });
    assert.deepEqual(componentIn(saved, ids.script).list?.flowContent?.scriptViews?.[xView]?.[ids.x], { x: 180, y: 150 });
    assert.equal(customIn(saved).positions?.[ids.x], undefined);
    assert.deepEqual(playerFlowAllEntries(saved, componentIn(saved, ids.custom)).map(entry => entry.id).sort(), fixture.entries.map(entry => entry.id).sort());
    assert.ok(customIn(saved).entries.every(entry => !entry.nodeId.startsWith('call:')), 'Synthetic call cards must not become saved real entries.');
    evidence.customXAppearance = await captionAppearance(flowNode(ids.custom, ids.x));
    assert.ok((evidence.customXAppearance as Awaited<ReturnType<typeof captionAppearance>>).shadow);
    await storyUnchanged(saved); await screenshot('05-custom-x-local-text-position');
  });

  await check('自定义 X 内调用位置独立保存，两外层调用共用该局部配置', async () => {
    await selectCall(ids.custom, ids.nested); await position(735, 225);
    let saved = await save();
    assert.deepEqual(customIn(saved).views?.[xView]?.[nestedCard], { x: 735, y: 225 });
    assert.deepEqual(customIn(saved).groups![0], originalGroup);
    assert.deepEqual(componentIn(saved, ids.script).list?.flowContent?.scriptViews?.[xView]?.[nestedCard], { x: 760, y: 210 });
    await back(ids.custom); await currentView(ids.custom);
    await enterCall(ids.custom, ids.second, ids.x, true); await selectNode(ids.custom, ids.x);
    await expect(field('节点文字第 1 段')).toHaveValue('本图共享 X');
    await openGroup('flow-node-position'); await expect(field('节点横向位置')).toHaveValue('205');
    saved = await read(); await storyUnchanged(saved); await unchanged();
  });

  await check('原自定义组仍能进入，组内坐标使用原结构且可保存', async () => {
    await rootView(ids.custom); await flowNode(ids.custom, ids.group).dblclick();
    await currentView(ids.custom, ids.group, 'group');
    await graphSnapshot(ids.custom, [ids.c], []);
    await selectNode(ids.custom, ids.c); await position(175, 155);
    const saved = await save();
    assert.deepEqual(customIn(saved).groups![0], { ...originalGroup, positions: { [ids.c]: { x: 175, y: 155 } } });
    assert.deepEqual(customIn(saved).views?.[xView]?.[ids.x], { x: 205, y: 165 });
    await back(ids.custom); await currentView(ids.custom); await storyUnchanged(saved);
  });

  await check('同控件内容模式往返保留自定义视图、原组和另一图布局', async () => {
    await returnMapInspector(); await openGroup('flow-mode');
    await field('剧情图内容来源').selectOption('script');
    await currentView(ids.custom); await graphSnapshot(ids.custom, fixture.rootIds, fixture.rootEdges);
    await field('剧情图内容来源').selectOption('custom');
    await currentView(ids.custom); await graphSnapshot(ids.custom, fixture.customRootIds, fixture.customRootEdges);
    const saved = await save();
    assert.deepEqual(customIn(saved).views?.[xView]?.[ids.x], { x: 205, y: 165 });
    assert.deepEqual(customIn(saved).views?.[xView]?.[nestedCard], { x: 735, y: 225 });
    assert.deepEqual(customIn(saved).groups![0].positions, { [ids.c]: { x: 175, y: 155 } });
    await storyUnchanged(saved);
  });

  await check('跟随剧本目录与分支切换保留调用投影、嵌套和逐层返回', async () => {
    await selectMap(ids.script); await setLayout('grid');
    await graphSnapshot(ids.script, fixture.rootIds);
    await enterCall(ids.script, ids.first, ids.x); await graphSnapshot(ids.script, fixture.xIds);
    await enterCall(ids.script, ids.nested, ids.y, true); await graphSnapshot(ids.script, fixture.yIds);
    await back(ids.script); await currentView(ids.script, xView, 'call');
    await returnMapInspector();
    await breadcrumb(ids.script).getByRole('button', { name: '返回上一级剧情图', exact: true }).press('Escape');
    await currentView(ids.script); await setLayout('flow');
    await graphSnapshot(ids.script, fixture.rootIds, fixture.rootEdges);
    await save(); await screenshot('06-directory-script-navigation');
  });

  await check('自定义目录中调用和旧组都可鼠标键盘进入与返回', async () => {
    await selectMap(ids.custom); await setLayout('grid');
    await graphSnapshot(ids.custom, fixture.customRootIds);
    await enterCall(ids.custom, ids.second, ids.x, true); await graphSnapshot(ids.custom, fixture.xIds);
    await back(ids.custom); await currentView(ids.custom);
    await flowNode(ids.custom, ids.group).dblclick(); await currentView(ids.custom, ids.group, 'group');
    await graphSnapshot(ids.custom, [ids.c]); await back(ids.custom); await currentView(ids.custom);
    await flowNode(ids.custom, ids.group).focus(); await flowNode(ids.custom, ids.group).press('Enter');
    await currentView(ids.custom, ids.group, 'group');
    await breadcrumb(ids.custom).getByRole('button', { name: /^(返回上一级剧情图|返回剧情图)$/ }).press('Escape');
    await currentView(ids.custom); await setLayout('flow'); await save(); await storyUnchanged();
  });

  await check('保存重开后两图根调用、共享子图、组坐标和旧文字黑底一致', async () => {
    const before = await save();
    await fs.writeFile(path.join(output, 'accepted-project.json'), JSON.stringify(before, null, 2));
    const callLook = await captionAppearance(callCard(ids.custom, ids.first));
    await close(); await launch(); await unchanged();
    const saved = await read();
    assert.deepEqual(saved, before, 'Reopening must not migrate or overwrite saved fixture data.');
    await graphSnapshot(ids.script, fixture.rootIds, fixture.rootEdges);
    await selectCall(ids.script, ids.first); await openGroup('flow-node-position');
    await expect(field('节点横向位置')).toHaveValue('360');
    await enterCall(ids.script, ids.second, ids.x); await selectNode(ids.script, ids.x); await openGroup('flow-node-position');
    await expect(field('节点横向位置')).toHaveValue('180'); await expect(field('节点纵向位置')).toHaveValue('150');
    await enterCall(ids.script, ids.nested, ids.y); await selectNode(ids.script, ids.y); await openGroup('flow-node-position');
    await expect(field('节点横向位置')).toHaveValue('190');
    await selectMap(ids.custom); await graphSnapshot(ids.custom, fixture.customRootIds, fixture.customRootEdges);
    assert.deepEqual(await captionAppearance(callCard(ids.custom, ids.first)), callLook);
    await enterCall(ids.custom, ids.second, ids.x); await selectNode(ids.custom, ids.x); await openGroup('flow-node-position');
    await expect(field('节点横向位置')).toHaveValue('205');
    await expect(field('节点文字第 2 段')).toHaveValue('旧版文字〖原样〗');
    assert.deepEqual(await captionAppearance(flowNode(ids.custom, ids.x)), evidence.customXAppearance);
    await selectCall(ids.custom, ids.nested); await openGroup('flow-node-position'); await expect(field('节点横向位置')).toHaveValue('735');
    await rootView(ids.custom); await flowNode(ids.custom, ids.group).dblclick(); await selectNode(ids.custom, ids.c);
    await openGroup('flow-node-position'); await expect(field('节点横向位置')).toHaveValue('175');
    await rootView(ids.custom); await unchanged(); await storyUnchanged(saved);
    evidence.reopened = { rootScript: componentIn(saved, ids.script).list?.flowPositions,
      scriptViews: componentIn(saved, ids.script).list?.flowContent?.scriptViews,
      customViews: customIn(saved).views, group: customIn(saved).groups![0], appearancePreserved: true };
    await screenshot('07-reopened-call-views');
  });

  await check('最终保存数据只含真实条目，剧本和构建保持一致并记录诊断', async () => {
    const saved = await read();
    await storyUnchanged(saved); await unchanged();
    assert.deepEqual(playerFlowAllEntries(saved, componentIn(saved, ids.script)).map(entry => entry.id).sort(), fixture.entries.map(entry => entry.id).sort());
    assert.deepEqual(customIn(saved).entries.map(entry => entry.nodeId).sort(), fixture.entries.map(entry => entry.id).sort());
    report.diagnosticsAfter = validateProject(saved);
    report.fixtureSha256After = sha256(savedBytes);
    report.buildAfter = await fingerprints();
    assert.deepEqual(report.buildAfter, report.buildBefore, 'All desktop checks must use one unchanged unified build.');
    assert.deepEqual(errors, [], 'Renderer must not raise runtime errors.');
  });

  assert.equal(checks.length, 22);
  report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = String(error);
  if (app && page && !page.isClosed()) {
    report.scopeAtFailure = await inspector().getAttribute('data-ui-flow-view').catch(() => undefined);
    report.inspectorAtFailure = await flow().innerText().catch(() => undefined);
    await screenshot('failure').catch(capture => { report.captureError = String(capture); });
  }
} finally {
  try { await close(); }
  catch (error) { report.status = 'failed'; report.closeError = String(error); failure ??= error; }
  try {
    if (app || processes.some(record => !record.exited)) throw new Error('A generated fixture process remains alive; retain its directories.');
    report.cleanup = await cleanVerificationDirectories(output, ['fixture', 'profile']);
    assert.deepEqual((report.cleanup as Awaited<ReturnType<typeof cleanVerificationDirectories>>).errors, []);
  } catch (error) { report.status = 'failed'; report.cleanupError = String(error); failure ??= error; }
  await fs.mkdir(output, { recursive: true }); await writeReport(); console.log(output);
}
if (failure) throw failure;
