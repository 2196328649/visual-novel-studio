import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { blueprintNodeDefaults, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createProject, projectSchema, type Asset, type BlueprintGraph, type BlueprintNode, type Project } from '../src/core/model';
import { createUiEventGraph } from '../src/core/ui-logic';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas, setBlueprintOption } from './lib/blueprint-canvas';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { spineFixtureAssets, writeUiSpineFixtureAssets } from './lib/ui-spine-fixture';
import { writeUiVideoFixtureAssets } from './lib/ui-video-fixture';

// Run only after all source changes and the coordinator's unified build. This
// script uses real ContentBrowser mouse drags; it never dispatches synthetic drops.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Use the isolated compiled source editor.');
assert.deepEqual(process.argv.slice(2), []);
const root = path.resolve('.');
const output = path.resolve('artifacts/blueprint-property-batch-2026-11-12', 'asset-drop-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const directory = path.join(output, 'project'), projectFile = path.join(directory, 'project.vns.json'), profile = path.join(output, 'profile');
const ids = { graph: 'asset_drop_graph', page: 'asset_drop_page', pageGraph: 'asset_drop_page_graph', background: 'asset_drop_background', property: 'asset_drop_property' };
const kinds = ['image', 'audio', 'video', 'font', 'spine'] as const;
type Kind = typeof kinds[number];
const names: Record<Kind, string> = { image: '图片素材', audio: '音频素材', video: '视频素材', font: '字体素材', spine: 'Spine素材' };
type Point = { x: number; y: number };
function fixture() {
  const project = createProject('素材引用拖入蓝图桌面验收'); project.id = 'blueprint_asset_drop_acceptance';
  project.assets = [
    { id: 'drop_image_a', name: '拖入图片甲', kind: 'image', category: 'scene', path: 'assets/image-a.svg', width: 240, height: 140 },
    { id: 'drop_image_b', name: '拖入图片乙', kind: 'image', category: 'ui', path: 'assets/image-b.svg', width: 240, height: 140 },
    ...(['a', 'b'] as const).map(part => ({ id: 'drop_audio_' + part, name: '拖入音频' + part, kind: 'audio' as const, category: 'sound' as const, path: 'assets/silent-' + part + '.wav' })),
    ...(['a', 'b'] as const).map(part => ({ id: 'drop_video_' + part, name: '拖入视频' + part, kind: 'video' as const, category: 'video' as const, path: 'assets/movie-' + part + '.webm' })),
    ...(['a', 'b'] as const).map(part => ({ id: 'drop_font_' + part, name: '拖入字体' + part, kind: 'font' as const, category: 'font' as const, path: 'assets/fixture-font-' + part + '.ttf' })),
    ...spineFixtureAssets.filter(asset => asset.id !== 'rig_broken').map((asset, index) => ({ ...structuredClone(asset), id: 'drop_spine_' + (index ? 'b' : 'a'), name: '拖入骨骼' + (index ? 'b' : 'a') })),
  ];
  project.ui.customPages = [{ id: ids.page, name: '素材引用页面', modal: true, components: [
    { id: 'asset_drop_image', name: '接收素材图片', kind: 'image', page: 'custom', text: '', assetId: 'drop_image_b', x: .1, y: .1, width: .4, height: .4 },
    { id: 'asset_drop_button', name: '素材接线按钮', kind: 'button', page: 'custom', text: '继续', x: .1, y: .6, width: .3, height: .1 },
  ] }];
  const graph = createBlueprintGraph('function', '素材拖入普通蓝图'); graph.id = ids.graph;
  graph.nodes[0].id = 'asset_drop_event'; graph.nodes[0].x = 0; graph.nodes[0].y = 0;
  const background = blueprintNodeDefaults('showBackground'); Object.assign(background, { id: ids.background, x: 360, y: 0, name: '消费图片的背景节点' });
  graph.nodes.push(background); graph.links = [{ id: 'asset_drop_exec', fromNodeId: 'asset_drop_event', fromPinId: 'exec', toNodeId: ids.background, toPinId: 'exec_in' }]; project.blueprints = [graph];
  const ui = createUiEventGraph(project, ids.page, '素材拖入页面图'); ui.id = ids.pageGraph;
  const event = blueprintNodeDefaults('eventClick'); Object.assign(event, { id: 'asset_drop_click', x: 0, y: 0 }); event.properties.componentId = 'asset_drop_button';
  const property = blueprintNodeDefaults('setUiProperty'); Object.assign(property, { id: ids.property, x: 360, y: 0, name: '消费图片的组件属性' }); property.properties = { componentId: 'asset_drop_image', property: 'image', value: '' };
  ui.nodes = [event, property]; ui.links = [{ id: 'asset_drop_ui_exec', fromNodeId: event.id, fromPinId: 'exec', toNodeId: property.id, toPinId: 'exec_in' }];
  synchronizeBlueprintSignatures(project); return projectSchema.parse(project);
}
let initial: Project, app: ElectronApplication | undefined, page: Page | undefined, failure: unknown, phase = '准备', traceRunning = false, launchNumber = 0;
const checks: { name: string; durationMs: number }[] = [], errors: string[] = [], drags: unknown[] = [], replacements: unknown[] = [], processes: { pid?: number; exited: boolean }[] = [], traces: string[] = [];
const created: Record<string, Record<string, string>> = { [ids.graph]: {}, [ids.pageGraph]: {} };
const report: Record<string, unknown> = { status: 'running', checks, errors, drags, replacements, created, processes, traces, temporaryPaths: [directory, profile],
  limits: ['只验证素材引用节点、真实拖放接线与工程保存，不启动游戏或播放媒体。', '不扩展控件、角色与场景的拖入行为。', '夹具媒体在统一验收运行时生成或复制本仓库现有字体。'] };
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const card = (id: string) => page!.locator(`.react-flow__node[data-id="${id}"]`);
const pin = (id: string, handle: string) => card(id).locator(`.react-flow__handle[data-handleid="${handle}"]`);
const graph = (value: Project, id: string): BlueprintGraph => { const result = value.blueprints.find(graph => graph.id === id); assert.ok(result); return result; };
const asset = (kind: Kind, part = 'a'): Asset => { const result = initial.assets.find(asset => asset.id === 'drop_' + kind + '_' + part); assert.ok(result); return result; };
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const settle = () => page!.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
const writeReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function save(ui = false) {
  if (ui) { if (await button('保存界面').isEnabled()) await button('保存界面').click(); await expect(page!.locator('.ui-save-status')).toHaveText('已保存'); await expect(button('保存界面')).toBeDisabled(); }
  else { await button('保存工程').click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); }
  await settle(); return read();
}
async function history(direction: '撤销' | '重做') { await button(direction).click(); await settle(); return save(); }
async function draftGraphSnapshot() {
  return page!.locator('.flow-container').evaluate(canvas => ({
    nodes: [...canvas.querySelectorAll('.react-flow__node')].map(node => ({
      id: node.getAttribute('data-id'), position: (node as HTMLElement).style.transform,
      title: node.querySelector('.graph-node-title strong')?.textContent,
      assetKind: node.querySelector('[data-asset-kind]')?.getAttribute('data-asset-kind'),
      assetName: node.querySelector('.blueprint-asset-reference-row .ui-asset-thumbnail')?.textContent,
      pins: [...node.querySelectorAll('[data-pin-id]')].map(pin => [pin.getAttribute('data-pin-id'), pin.getAttribute('data-pin-direction'), pin.getAttribute('data-pin-type')]),
    })).sort((a, b) => a.id!.localeCompare(b.id!)),
    edges: [...canvas.querySelectorAll('.react-flow__edge')].map(edge => edge.getAttribute('data-id')).sort(),
  }));
}
async function draftHistory(before: Awaited<ReturnType<typeof draftGraphSnapshot>>, savedBefore: BlueprintGraph) {
  const after = await draftGraphSnapshot();
  // Saving applies the UI draft and starts a fresh draft history. Exercise
  // undo/redo before that boundary, then verify the serialized result below.
  assert.deepEqual(graph(await read(), ids.pageGraph), savedBefore, '页面操作先留在草稿，不提前保存');
  await button('撤销').click(); await settle(); assert.deepEqual(await draftGraphSnapshot(), before);
  assert.deepEqual(graph(await read(), ids.pageGraph), savedBefore);
  await button('重做').click(); await settle(); assert.deepEqual(await draftGraphSnapshot(), after);
}
async function screenshot(name: string) {
  const data = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(data, 'base64'));
}
async function check(name: string, work: () => Promise<void>) {
  phase = name; const started = Date.now(); await work(); checks.push({ name, durationMs: Date.now() - started }); await screenshot(String(checks.length).padStart(2, '0')); await writeReport(); console.log('通过：' + name);
}
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile }); processes.push({ pid: app.process().pid, exited: false }); launchNumber++;
  page = await app.firstWindow(); page.setDefaultTimeout(16000); page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; if (win.isMaximized()) win.unmaximize(); win.setContentSize(1750, 1150); win.webContents.setBackgroundThrottling(false); });
  await expect(page.locator('.project-title strong')).toHaveText(initial.name, { timeout: 45000 }); assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html'));
  await page.evaluate('globalThis.__name = value => value'); await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false }); traceRunning = true;
}
async function close() {
  if (!app) return; const owned = app, child = owned.process();
  let traceFailure: unknown;
  if (traceRunning && page) {
    const trace = 'trace-' + launchNumber + '.zip';
    try { await page.context().tracing.stop({ path: path.join(output, trace) }); traces.push(trace); }
    catch (error) { traceFailure = error; report.traceError = String(error); }
    traceRunning = false;
  }
  try { await owned.close(); } finally {
    await expect.poll(() => child.exitCode !== null || child.signalCode !== null).toBe(true);
    const record = processes.find(record => record.pid === child.pid); if (record) record.exited = true; app = undefined; page = undefined;
  }
  if (traceFailure) throw traceFailure;
}
async function browser() {
  const dock = page!.locator('.content-browser.content-dock'); if (!await dock.isVisible()) await page!.locator('.content-toggle').click(); await expect(dock).toBeVisible();
  await dock.getByLabel('资源显示范围', { exact: true }).selectOption('all'); return dock;
}
async function hideBrowser() { const dock = page!.locator('.content-browser.content-dock'); if (await dock.isVisible()) await dock.getByRole('button', { name: '收起资源管理器（Ctrl+空格）', exact: true }).click(); await settle(); }
async function openGraph(ui = false) {
  await hideBrowser(); await page!.locator(`[data-workspace-tab="${ui ? 'ui' : 'blueprint'}"]`).click();
  if (ui) {
    await page!.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '事件图', exact: true }).click();
    await page!.getByLabel('事件图页面', { exact: true }).selectOption(ids.page); await page!.getByLabel('当前页面事件图', { exact: true }).selectOption(ids.pageGraph);
  } else await page!.getByLabel('蓝图资源', { exact: true }).selectOption('graph:' + ids.graph);
  // The pure data node must never auto-insert an execution wire, even with this option on.
  await setBlueprintOption(page!, '自动接线', true); await fitBlueprintCanvas(page!); await settle();
}
async function blank(): Promise<Point> {
  let result: Point | undefined; await expect.poll(async () => {
    result = await page!.evaluate(() => {
      const pane = document.querySelector('.flow-container .react-flow__pane'); if (!pane) return;
      const box = pane.getBoundingClientRect();
      for (let y = Math.max(0, box.top) + 35; y < Math.min(innerHeight, box.bottom) - 35; y += 32)
        for (let x = Math.max(0, box.left) + 35; x < Math.min(innerWidth, box.right) - 35; x += 32)
          if (document.elementFromPoint(x, y) === pane) return { x, y };
    }); return !!result;
  }).toBe(true); return result!;
}
async function center(locator: Locator): Promise<Point> { const box = await locator.boundingBox(); assert.ok(box && box.width && box.height); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; }
async function dragAsset(kind: Kind, ui: boolean) {
  const targetGraph = ui ? ids.pageGraph : ids.graph, before = graph(await save(ui), targetGraph);
  const draftBefore = ui ? await draftGraphSnapshot() : undefined;
  const dock = await browser(); await dock.getByLabel('搜索资源和蓝图', { exact: true }).fill(asset(kind).name);
  const tile = dock.locator(`[data-content-key="asset:${asset(kind).id}"]`); await expect(tile).toBeVisible(); await tile.click();
  await fitBlueprintCanvas(page!); const start = await center(tile), end = await blank();
  await page!.evaluate(() => {
    const host = window as typeof window & { __assetDropEvents?: unknown[]; __assetDropListener?: (event: DragEvent) => void };
    host.__assetDropEvents = []; host.__assetDropListener = event => host.__assetDropEvents!.push({ type: event.type, trusted: event.isTrusted, types: [...(event.dataTransfer?.types ?? [])], asset: event.dataTransfer?.getData('application/vns-asset'), target: (event.target as Element)?.getAttribute('data-content-key') });
    // React fills the data transfer in its dragstart handler. Observe that
    // result at document bubble, while drop capture preserves data before use.
    document.addEventListener('dragstart', host.__assetDropListener); document.addEventListener('drop', host.__assetDropListener, true);
  });
  await page!.mouse.move(start.x, start.y); await page!.mouse.down(); await page!.mouse.move(start.x + 10, start.y - 14, { steps: 6 }); await page!.mouse.move(end.x, end.y, { steps: 26 }); await page!.mouse.up(); await settle();
  const events = await page!.evaluate(() => {
    const host = window as typeof window & { __assetDropEvents?: { type: string; trusted: boolean; asset?: string }[]; __assetDropListener?: (event: DragEvent) => void };
    if (host.__assetDropListener) { document.removeEventListener('dragstart', host.__assetDropListener); document.removeEventListener('drop', host.__assetDropListener, true); }
    const events = host.__assetDropEvents ?? []; delete host.__assetDropListener; delete host.__assetDropEvents; return events;
  });
  drags.push({ phase, kind, ui, start, end, events }); await writeReport();
  assert.ok(events.some(event => event.type === 'dragstart' && event.trusted && event.asset === asset(kind).id)); assert.ok(events.some(event => event.type === 'drop' && event.trusted));
  await hideBrowser();
  if (draftBefore) await draftHistory(draftBefore, before);
  const after = graph(await save(ui), targetGraph), added = after.nodes.filter(node => !before.nodes.some(old => old.id === node.id)); assert.equal(added.length, 1);
  const node = added[0]; created[targetGraph][kind] = node.id;
  assert.equal(node.type, 'literal'); assert.equal(node.properties.value, asset(kind).id); assert.equal(node.properties.assetKind, kind);
  assert.deepEqual(node.pins.map(({ id, direction, dataType }) => ({ id, direction, dataType })), [{ id: 'value', direction: 'output', dataType: 'asset' }]);
  assert.deepEqual(after.links, before.links); assert.deepEqual(after.nodes.filter(value => value.id !== node.id), before.nodes);
  await fitBlueprintCanvas(page!); await expect(card(node.id)).toContainText(asset(kind).name); await expect(card(node.id)).toContainText(names[kind]);
  await expect(card(node.id).locator('.blueprint-asset-reference-node')).toHaveAttribute('data-asset-kind', kind);
  if (!ui) { assert.deepEqual(graph(await history('撤销'), targetGraph), before); assert.deepEqual(graph(await history('重做'), targetGraph), after); }
  await fitBlueprintCanvas(page!); await expect(card(node.id)).toContainText(asset(kind).name);
}
async function replaceAsset(kind: Kind, ui: boolean) {
  const targetGraph = ui ? ids.pageGraph : ids.graph, nodeId = created[targetGraph][kind], before = graph(await save(ui), targetGraph);
  const draftBefore = ui ? await draftGraphSnapshot() : undefined;
  await fitBlueprintCanvas(page!); await card(nodeId).locator('.graph-node-title').click();
  const panel = page!.getByRole('complementary', { name: '蓝图属性', exact: true }); await panel.locator('.blueprint-property-tabs').getByRole('button', { name: '节点参数', exact: true }).click();
  await expect(panel.getByRole('combobox', { name: '类型', exact: true })).toHaveCount(0);
  const browse = panel.locator('.blueprint-asset-field .ui-asset-thumbnail'); await expect(browse).toHaveCount(1); const label = (await browse.getAttribute('aria-label'))!.replace(/^浏览/, ''); await browse.click();
  const picker = page!.getByRole('dialog', { name: label + '资源浏览器', exact: true }); await expect(picker).toBeVisible();
  await picker.getByLabel('可选素材分类', { exact: true }).selectOption('all');
  const options = await picker.locator('[aria-label^="预览资源 "]').allTextContents();
  for (const other of kinds.filter(value => value !== kind)) await expect(picker.getByRole('button', { name: '预览资源 ' + asset(other).name, exact: true })).toHaveCount(0);
  await picker.getByRole('button', { name: '预览资源 ' + asset(kind, 'b').name, exact: true }).click(); await picker.locator('footer').getByRole('button', { name: '使用所选资源', exact: true }).click();
  await expect(card(nodeId).locator('.blueprint-asset-reference-row .ui-asset-thumbnail')).toHaveText(asset(kind, 'b').name);
  if (draftBefore) await draftHistory(draftBefore, before);
  const after = graph(await save(ui), targetGraph), changed = after.nodes.find(node => node.id === nodeId)!;
  assert.equal(changed.properties.value, asset(kind, 'b').id); assert.equal(changed.properties.assetKind, kind); assert.deepEqual(after.links, before.links);
  await expect(card(nodeId)).toContainText(asset(kind, 'b').name); replacements.push({ phase, kind, ui, options, asset: changed.properties.value });
  if (!ui) { assert.deepEqual(graph(await history('撤销'), targetGraph), before); assert.deepEqual(graph(await history('重做'), targetGraph), after); }
  await expect(card(nodeId)).toContainText(asset(kind, 'b').name);
}
async function connectImage(ui: boolean) {
  const targetGraph = ui ? ids.pageGraph : ids.graph, before = graph(await save(ui), targetGraph); await fitBlueprintCanvas(page!);
  const draftBefore = ui ? await draftGraphSnapshot() : undefined;
  const from = pin(created[targetGraph].image, 'value'), to = pin(ui ? ids.property : ids.background, ui ? 'value' : 'assetId');
  const start = await center(from), end = await center(to);
  assert.equal(await page!.evaluate(point => document.elementFromPoint(point.x, point.y)?.classList.contains('react-flow__handle'), start), true);
  await page!.mouse.move(start.x, start.y); await page!.mouse.down(); await page!.mouse.move(end.x, end.y, { steps: 24 }); await page!.mouse.up(); await settle();
  await expect(page!.locator('.react-flow__edge')).toHaveCount(before.links.length + 1);
  if (draftBefore) await draftHistory(draftBefore, before);
  const after = graph(await save(ui), targetGraph), link = after.links.find(link => link.fromNodeId === created[targetGraph].image && link.toNodeId === (ui ? ids.property : ids.background)); assert.ok(link);
  assert.equal(link.fromPinId, 'value'); assert.equal(link.toPinId, ui ? 'value' : 'assetId'); assert.deepEqual(after.links.filter(value => value.id !== link.id), before.links);
  if (!ui) { assert.deepEqual(graph(await history('撤销'), targetGraph), before); assert.deepEqual(graph(await history('重做'), targetGraph), after); }
}
async function writeResources() {
  await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
  for (const part of ['a', 'b']) await fs.writeFile(path.join(directory, 'assets/image-' + part + '.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140"><rect width="240" height="140" fill="${part === 'a' ? '#498c94' : '#ad754a'}"/></svg>`);
  const wav = Buffer.alloc(44 + 1600); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(1600, 40);
  for (const part of ['a', 'b']) {
    await fs.writeFile(path.join(directory, 'assets/silent-' + part + '.wav'), wav);
    await fs.copyFile(path.join(root, 'resources/templates/aihong/assets/ai_ui_3510f58115c3cc3c.ttf'), path.join(directory, 'assets/fixture-font-' + part + '.ttf'));
  }
  await writeUiSpineFixtureAssets(directory); await writeUiVideoFixtureAssets(directory);
}
try {
  phase = 'fixture schema'; initial = fixture(); phase = '资源准备'; await writeResources(); await saveProject(projectFile, initial); await launch();
  for (const ui of [false, true]) {
    await openGraph(ui); const label = ui ? '页面事件图' : '普通蓝图';
    for (const kind of kinds) await check(label + '：真实拖入' + names[kind] + '只添加纯素材引用，可一步撤销重做', () => dragAsset(kind, ui));
    for (const kind of kinds) await check(label + '：' + names[kind] + '显示实际名称且可同类换源，保留连线与撤销重做', () => replaceAsset(kind, ui));
    await check(label + '：图片素材真实接到' + (ui ? '设置组件属性图片项' : '切换背景素材口') + '，一步撤销重做', () => connectImage(ui));
  }
  await check('保存重开后两图全部素材类型、换源和数据线保持', async () => {
    const before = await read(); await fs.copyFile(projectFile, path.join(output, 'saved-project.json')); await close(); await launch();
    assert.deepEqual(await read(), before);
    for (const ui of [false, true]) { await openGraph(ui); const id = ui ? ids.pageGraph : ids.graph;
      for (const kind of kinds) { await expect(card(created[id][kind])).toContainText(asset(kind, 'b').name); assert.equal(graph(await read(), id).nodes.find(node => node.id === created[id][kind])?.properties.assetKind, kind); }
      assert.deepEqual(graph(await read(), id), graph(before, id));
    }
  });
  assert.deepEqual(errors, []); report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = String(error); if (app && page) await screenshot('failure').catch(() => undefined);
} finally {
  await close().catch(error => { failure ??= error; report.status = 'failed'; report.closeError = String(error); }); await fs.mkdir(output, { recursive: true }); await writeReport();
  if (!app && processes.every(process => process.exited)) {
    try { const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); report.cleanup = cleanup; assert.deepEqual(cleanup.errors, []); }
    catch (error) { failure ??= error; report.status = 'failed'; report.cleanupError = String(error); }
  } else { failure ??= new Error('Owned acceptance process has not exited.'); report.status = 'failed'; report.cleanupSkipped = true; }
  await writeReport(); console.log(output);
}
if (failure) throw failure;
