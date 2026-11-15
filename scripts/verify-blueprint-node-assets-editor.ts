import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { blueprintNodeDefaults, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createProject, projectSchema, type Asset, type BlueprintNode, type Project, type VariableValue } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Execute after the unified build. All assets and authoring state belong to this
// fixture; every edit and resource selection below uses the visible editor UI.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Use the isolated compiled source editor.');
const root = path.resolve('.');
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? path.join(root, 'artifacts'), 'blueprint-node-assets-editor', new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const relativeOutput = path.relative(root, output);
assert.ok(relativeOutput && !path.isAbsolute(relativeOutput) && relativeOutput !== '..' && !relativeOutput.startsWith('..' + path.sep), 'Acceptance output must remain inside this checkout.');
const fixtureDirectory = path.join(output, 'fixture'), profile = path.join(output, 'profile'), projectFile = path.join(fixtureDirectory, 'project.vns.json');
const ids = { graph: 'asset_authoring_graph', callee: 'asset_callee_graph', background: 'asset_background_node', call: 'asset_call_node', literal: 'asset_literal_node', any: 'asset_any_node', input: 'scene_image', result: 'scene_result' };
const images: Asset[] = [
  { id: 'asset_scene_a', name: '验收背景甲', kind: 'image', category: 'scene', path: 'background-a.svg', width: 640, height: 360 },
  { id: 'asset_scene_background_with_long_stable_identifier', name: '验收背景乙_长资源名称_傍晚港口与层叠建筑_完整版_用于检查紧凑节点的名称省略与完整提示', kind: 'image', category: 'scene', path: 'background-b.svg', width: 640, height: 360 },
  { id: 'asset_ui_image', name: '验收界面图片_非默认背景分类', kind: 'image', category: 'ui', path: 'ui-image.svg', width: 160, height: 80 },
];
const audio: Asset = { id: 'asset_audio', name: '验收静音音频_不能作为背景', kind: 'audio', category: 'sound', path: 'silent.wav' };
const callPin = 'arg_' + ids.input;
const longText = '任意值中的长文字_零值与空字符串应保持各自类型_不应撑出卡片';

function fixture() {
  const project = createProject('蓝图素材紧凑节点验收'); project.id = 'blueprint_node_assets_acceptance'; project.assets = [...images, audio];
  const node = (type: BlueprintNode['type'], id: string, x: number, y: number, properties: Record<string, VariableValue> = {}) => {
    const result = blueprintNodeDefaults(type); result.id = id; result.x = x; result.y = y; Object.assign(result.properties, properties); return result;
  };
  const callee = createBlueprintGraph('function', '接收场景图片的流程'); callee.id = ids.callee;
  callee.exposedInputs = [{ id: ids.input, name: '场景背景', dataType: 'asset', direction: 'input', required: false, defaultValue: images[0].id }];
  callee.exposedOutputs = [{ id: ids.result, name: '背景结果', dataType: 'asset', direction: 'output', required: false, defaultValue: images[0].id }];
  callee.nodes = [node('event', 'asset_callee_event', 0, 0), node('getInput', 'asset_callee_reader', 0, 190, { inputId: ids.input }),
    node('showBackground', 'asset_callee_background', 340, 0), node('setOutput', 'asset_callee_output', 680, 0, { outputId: ids.result })];
  callee.links = [
    { id: 'asset_callee_exec_a', fromNodeId: 'asset_callee_event', fromPinId: 'exec', toNodeId: 'asset_callee_background', toPinId: 'exec_in' },
    { id: 'asset_callee_exec_b', fromNodeId: 'asset_callee_background', fromPinId: 'exec_out', toNodeId: 'asset_callee_output', toPinId: 'exec_in' },
    { id: 'asset_callee_input_a', fromNodeId: 'asset_callee_reader', fromPinId: 'value', toNodeId: 'asset_callee_background', toPinId: 'assetId' },
    { id: 'asset_callee_input_b', fromNodeId: 'asset_callee_reader', fromPinId: 'value', toNodeId: 'asset_callee_output', toPinId: 'value' },
  ];
  const graph = createBlueprintGraph('function', '素材控件验收'); graph.id = ids.graph;
  const background = node('showBackground', ids.background, 0, 90); background.name = '切换验收背景';
  const call = node('callFunction', ids.call, 350, 90, { graphId: ids.callee, [callPin]: '' }); call.name = '调用素材流程';
  const literal = node('literal', ids.literal, 0, 430); literal.name = '素材固定值';
  const any = node('select', ids.any, 350, 430); any.name = '任意值选择';
  graph.nodes = [node('event', 'asset_graph_event', 0, 0), background, call, literal, any];
  graph.links = [{ id: 'asset_graph_exec_a', fromNodeId: 'asset_graph_event', fromPinId: 'exec', toNodeId: ids.background, toPinId: 'exec_in' },
    { id: 'asset_graph_exec_b', fromNodeId: ids.background, fromPinId: 'exec_out', toNodeId: ids.call, toPinId: 'exec_in' }];
  project.blueprints = [graph, callee]; synchronizeBlueprintSignatures(project); return projectSchema.parse(project);
}
const initial = fixture();
let app: ElectronApplication | undefined, page: Page | undefined, failure: unknown, phase = '准备', traceRunning = false, launchNumber = 0;
const checks: { name: string; durationMs: number }[] = [], pageErrors: string[] = [], processes: { pid?: number; exited: boolean }[] = [], traces: string[] = [];
const report: Record<string, unknown> = { status: 'running', renderer: 'dist', checks, pageErrors, processes, traces,
  temporaryPaths: [fixtureDirectory, profile], geometry: [], filters: [],
  limits: ['检查桌面素材选择、参数编辑、布局与保存，不启动原生游戏；fixture 为自制 SVG 和静音 WAV。', '初始图与素材由测试准备；运行中的项目状态、主题和资源管理器选择均通过可见界面修改。'] };
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const properties = () => page!.getByRole('complementary', { name: '蓝图属性', exact: true });
const card = (id: string) => page!.locator(`.react-flow__node[data-id="${id}"]`);
const nodeCard = (id: string) => card(id).locator('.blueprint-graph-node');
const slot = (id: string, pinId: string) => card(id).locator(`.blueprint-pin-slot[data-pin-id="${pinId}"]`);
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const storedNode = (project: Project, id: string) => project.blueprints.find(graph => graph.id === ids.graph)!.nodes.find(node => node.id === id)!;
const label = (id: string, pinId: string) => { const node = storedNode(initial, id); return node.name + ' · ' + node.pins.find(pin => pin.id === pinId)!.name; };
const browse = (owner: Locator, fieldLabel: string) => owner.getByRole('button', { name: '浏览' + fieldLabel, exact: true });
const settle = () => page!.evaluate('async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); }');
async function writeReport() { await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
async function fingerprints() {
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  const files = ['dist/index.html', 'dist-desktop/main.cjs', 'dist-desktop/preload.cjs', ...[...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => 'dist/' + match[1].slice(2))];
  assert.ok(files.some(file => file.startsWith('dist/assets/') && file.endsWith('.js')), 'The compiled renderer must exist.');
  return Promise.all([...new Set(files)].map(async file => ({ file, sha256: createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex') })));
}
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile }); launchNumber++; processes.push({ pid: app.process().pid, exited: false });
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => pageErrors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; if (window.isMaximized()) window.unmaximize(); window.setContentSize(1600, 1000); window.webContents.setBackgroundThrottling(false); });
  await expect(page.locator('.project-title strong')).toHaveText(initial.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html')); report.rendererUrl = page.url();
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false }); traceRunning = true;
}
async function close() {
  if (!app) return;
  const owned = app, child = owned.process(); let traceFailure: unknown;
  if (traceRunning && page) {
    const name = `trace-${launchNumber}.zip`;
    try { await page.context().tracing.stop({ path: path.join(output, name) }); traces.push(name); } catch (error) { traceFailure = error; }
    traceRunning = false;
  }
  try { await owned.close(); } finally {
    await expect.poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 15000 }).toBe(true);
    const record = processes.find(item => item.pid === child.pid); if (record) record.exited = true; app = undefined; page = undefined;
  }
  if (traceFailure) throw traceFailure;
}
async function screenshot(name: string) {
  await settle(); const image = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(image, 'base64'));
}
async function check(name: string, work: () => Promise<void>) {
  phase = name; const start = Date.now(); await work(); checks.push({ name, durationMs: Date.now() - start }); await writeReport(); console.log('通过：' + name);
}
async function openGraph() {
  await page!.locator('[data-workspace-tab="blueprint"]').click(); await page!.getByLabel('蓝图资源', { exact: true }).selectOption('graph:' + ids.graph);
  if (!await properties().isVisible()) await button('展开蓝图属性').click();
  await fitBlueprintCanvas(page!); await settle();
}
async function select(id: string) {
  await fitBlueprintCanvas(page!); await card(id).locator('.graph-node-title strong').click();
  await properties().getByRole('button', { name: '节点参数', exact: true }).click(); await expect(card(id)).toHaveClass(/selected/);
  await button('定位选中节点').click();
  await expect.poll(() => card(id).evaluate(async element => {
    const pane = element.closest('.flow-container'), viewport = element.closest('.react-flow__viewport'); if (!pane || !viewport) return false;
    const transform = getComputedStyle(viewport).transform;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const bounds = pane.getBoundingClientRect(), box = element.getBoundingClientRect();
    return getComputedStyle(viewport).transform === transform && box.left >= bounds.left - 1 && box.right <= bounds.right + 1 && box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1;
  })).toBe(true); await settle();
}
async function save() { await button('保存工程').click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); await settle(); return read(); }
async function openPicker(trigger: Locator, fieldLabel: string, imageFilter = false) {
  await expect(trigger).toHaveCount(1); await trigger.click();
  const dialog = page!.getByRole('dialog', { name: fieldLabel + '资源浏览器', exact: true }); await expect(dialog).toBeVisible();
  if (imageFilter) {
    await expect(dialog.getByLabel('可选素材分类', { exact: true })).toHaveValue('scene');
    await expect(dialog.getByRole('button', { name: '预览资源 ' + images[0].name, exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '预览资源 ' + images[1].name, exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '预览资源 ' + images[2].name, exact: true })).toHaveCount(0);
    await dialog.getByLabel('可选素材分类', { exact: true }).selectOption('all');
    await expect(dialog.getByRole('button', { name: '预览资源 ' + images[2].name, exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '预览资源 ' + audio.name, exact: true })).toHaveCount(0);
    await dialog.getByLabel('可选素材分类', { exact: true }).selectOption('scene');
    (report.filters as unknown[]).push({ fieldLabel, defaultCategory: 'scene', allImageCategoriesAvailable: true, audioExcluded: true });
  }
  return dialog;
}
async function choose(dialog: Locator, asset: Asset | undefined, empty: string) {
  await dialog.getByRole('button', { name: asset ? '预览资源 ' + asset.name : empty, exact: true }).click();
  await dialog.locator('footer').getByRole('button', { name: asset ? '使用所选资源' : '使用' + empty, exact: true }).click();
  await expect(dialog).toHaveCount(0); await settle();
}
async function pick(owner: Locator, fieldLabel: string, asset?: Asset, empty = '选择素材', imageFilter = false) {
  await choose(await openPicker(browse(owner, fieldLabel), fieldLabel, imageFilter), asset, empty);
}
async function selectResource(asset: Asset) {
  const dock = page!.locator('.content-browser.content-dock');
  if (!await dock.isVisible()) await page!.locator('.content-toggle').click();
  await expect(dock).toBeVisible(); await dock.getByLabel('资源显示范围', { exact: true }).selectOption('all');
  await dock.getByLabel('搜索资源和蓝图', { exact: true }).fill(asset.name);
  const item = dock.locator(`[data-content-key="asset:${asset.id}"]`); await item.click(); await expect(item).toHaveAttribute('aria-pressed', 'true');
  await dock.getByRole('button', { name: '收起资源管理器（Ctrl+空格）', exact: true }).click(); await expect(dock).toHaveCount(0); await settle();
}
async function compactAsset(owner: Locator, fieldLabel: string, companion: boolean) {
  const trigger = browse(owner, fieldLabel); await expect(trigger).toBeVisible();
  assert.equal(await trigger.evaluate(element => (element as HTMLElement).offsetHeight), 24, fieldLabel + ': browse height');
  assert.ok(await trigger.evaluate(element => (element as HTMLElement).offsetWidth >= 32), fieldLabel + ': browse width is usable');
  await expect(owner.locator('.ui-asset-mini')).toHaveCount(0);
  if (companion) {
    const copy = owner.getByRole('button', { name: '使用资源管理器选中素材：' + fieldLabel, exact: true }); await expect(copy).toBeVisible();
    const a = await trigger.boundingBox(), b = await copy.boundingBox(); assert.ok(a); assert.ok(b);
    assert.ok(Math.max(a.y, b.y) < Math.min(a.y + a.height, b.y + b.height), fieldLabel + ': browse and use-selected share a row');
    assert.equal(await copy.evaluate(element => (element as HTMLElement).offsetWidth), 24);
  }
}
async function noOverflow(id: string, description: string) {
  const result = await nodeCard(id).evaluate(element => {
    const box = element.getBoundingClientRect();
    return { width: (element as HTMLElement).offsetWidth, left: box.left, right: box.right,
      controls: [...element.querySelectorAll<HTMLElement>('input,select,button,textarea')].filter(control => control.getClientRects().length > 0).map(control => {
        const rect = control.getBoundingClientRect(); return { label: control.getAttribute('aria-label') ?? control.textContent?.trim(), left: rect.left, right: rect.right, width: rect.width, localWidth: control.offsetWidth };
      }) };
  });
  assert.deepEqual(result.controls.filter(control => control.width <= 0 || control.left < result.left - 2 || control.right > result.right + 2), [], description + ': every form control fits inside the card');
  assert.equal(await page!.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, description + ': document has no horizontal overflow');
  (report.geometry as unknown[]).push({ description, id, ...result }); return result;
}
async function theme(name: '黑白' | '亮白', id: 'codexDark' | 'codexLight') {
  await button('作品设置').click(); const dialog = page!.getByRole('dialog', { name: '作品设置', exact: true });
  await dialog.getByRole('button', { name: '编辑器外观', exact: true }).click();
  await dialog.getByRole('group', { name: '编辑器配色', exact: true }).getByRole('button', { name: new RegExp('^' + name) }).click();
  await expect(page!.locator('html')).toHaveAttribute('data-editor-theme', id); await dialog.getByRole('button', { name: '完成', exact: true }).click(); await settle();
}
function silentWave() {
  const bytes = Buffer.alloc(44 + 1600); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(1600, 40); return bytes;
}
try {
  await fs.mkdir(fixtureDirectory, { recursive: true }); report.fingerprintsBefore = await fingerprints();
  await fs.writeFile(path.join(output, 'temporary-artifacts.json'), JSON.stringify({ run: output, paths: [fixtureDirectory, profile], cleanup: 'Only after the owned Electron process exits.' }, null, 2));
  await Promise.all([
    ...images.map((asset, index) => fs.writeFile(path.join(fixtureDirectory, asset.path), `<svg xmlns="http://www.w3.org/2000/svg" width="${asset.width}" height="${asset.height}"><rect width="100%" height="100%" fill="${['#436d8c', '#aa6754', '#4c8969'][index]}"/><circle cx="70" cy="60" r="30" fill="#f3dea4"/></svg>`)),
    fs.writeFile(path.join(fixtureDirectory, audio.path), silentWave()),
  ]);
  await saveProject(projectFile, initial); await fs.copyFile(projectFile, path.join(output, 'input-project.json')); await launch(); await openGraph();
  await check('背景素材浏览、清空与资源管理器真实取值', async () => {
    await select(ids.background); const owner = slot(ids.background, 'assetId'), fieldLabel = label(ids.background, 'assetId');
    await compactAsset(owner, fieldLabel, true);
    await expect(owner.getByRole('button', { name: '使用资源管理器选中素材：' + fieldLabel, exact: true })).toBeDisabled();
    await pick(owner, fieldLabel, images[0], '选择素材', true);
    assert.equal(storedNode(await save(), ids.background).properties.assetId, images[0].id);
    await expect(browse(owner, fieldLabel)).toContainText(images[0].name);
    await pick(owner, fieldLabel); assert.equal(Object.hasOwn(storedNode(await save(), ids.background).properties, 'assetId'), false);
    await screenshot('01-background-clear');
    const useSelected = owner.getByRole('button', { name: '使用资源管理器选中素材：' + fieldLabel, exact: true });
    await selectResource(audio); await select(ids.background); await expect(useSelected).toBeDisabled();
    await selectResource(images[1]); await select(ids.background); await expect(useSelected).toBeEnabled(); await expect(useSelected).toHaveAttribute('title', '使用 ' + images[1].name);
    await useSelected.click(); assert.equal(storedNode(await save(), ids.background).properties.assetId, images[1].id);
    await expect(browse(owner, fieldLabel)).toContainText(images[1].name); assert.ok((await browse(owner, fieldLabel).getAttribute('title'))?.includes(images[1].name));
    await compactAsset(owner, fieldLabel, true); await noOverflow(ids.background, '资源管理器长名称'); await screenshot('02-browser-selection');
  });
  await check('调用素材参数卡片与详情共享筛选、显式空值和撤销重做', async () => {
    await select(ids.call); const owner = slot(ids.call, callPin), fieldLabel = label(ids.call, callPin);
    await compactAsset(owner, fieldLabel, false); await expect(owner.locator('.asset-browse-only')).toHaveCount(1);
    await pick(owner, fieldLabel, images[1], '无', true);
    let saved = await save(); assert.equal(storedNode(saved, ids.call).properties[callPin], images[1].id);
    assert.equal((await noOverflow(ids.call, '双侧长素材引用')).width, 280);
    await pick(properties(), '场景背景', images[0], '无', true); saved = await save(); assert.equal(storedNode(saved, ids.call).properties[callPin], images[0].id);
    await button('撤销').click(); assert.equal(storedNode(await save(), ids.call).properties[callPin], images[1].id);
    await button('重做').click(); assert.equal(storedNode(await save(), ids.call).properties[callPin], images[0].id);
    await pick(owner, fieldLabel, undefined, '无'); saved = await save(); assert.equal(storedNode(saved, ids.call).properties[callPin], '');
    assert.equal(saved.blueprints.find(graph => graph.id === ids.callee)!.exposedInputs[0].defaultValue, images[0].id);
    await button('撤销').click(); assert.equal(storedNode(await save(), ids.call).properties[callPin], images[0].id);
    await button('重做').click(); assert.equal(storedNode(await save(), ids.call).properties[callPin], '');
    await pick(owner, fieldLabel, images[1], '无'); await save(); await screenshot('03-call-asset');
  });
  await check('固定值切为素材及任意值双列卡片可编辑零值与长文字', async () => {
    await select(ids.literal); const name = storedNode(initial, ids.literal).name, owner = card(ids.literal).locator('.blueprint-node-fields');
    await card(ids.literal).getByLabel(name + ' · 类型', { exact: true }).selectOption('asset');
    await compactAsset(owner, name + ' · 值', true); await pick(owner, name + ' · 值', images[1]);
    let saved = await save(); assert.equal(storedNode(saved, ids.literal).pins[0].dataType, 'asset'); assert.equal(storedNode(saved, ids.literal).properties.value, images[1].id);
    await noOverflow(ids.literal, '素材固定值长名称'); await screenshot('04-literal-asset');
    await select(ids.any); const valueLabel = label(ids.any, 'true_value'), fallbackLabel = label(ids.any, 'false_value');
    await card(ids.any).getByLabel(valueLabel + '的值类型', { exact: true }).selectOption('number');
    await card(ids.any).getByLabel(valueLabel, { exact: true }).fill('0'); await card(ids.any).getByLabel(valueLabel, { exact: true }).press('Tab');
    await card(ids.any).getByLabel(fallbackLabel + '的值类型', { exact: true }).selectOption('string');
    await card(ids.any).getByLabel(fallbackLabel, { exact: true }).fill(longText); await card(ids.any).getByLabel(fallbackLabel, { exact: true }).press('Tab');
    saved = await save(); assert.equal(storedNode(saved, ids.any).properties.true_value, 0); assert.equal(storedNode(saved, ids.any).properties.false_value, longText);
    const measured = await noOverflow(ids.any, '任意值双侧280卡片'); assert.equal(measured.width, 280);
    await expect(slot(ids.any, 'result')).toHaveAttribute('data-pin-type', 'any');
    for (const pin of ['true_value', 'false_value']) {
      await expect(slot(ids.any, pin)).toHaveAttribute('data-pin-type', 'any');
      assert.ok(await slot(ids.any, pin).locator('input').evaluate(element => (element as HTMLElement).offsetWidth >= 24), pin + ': value field remains usable');
    }
    await screenshot('04-any-values');
  });
  await check('窄窗口深浅主题保留素材操作与完整表单边界', async () => {
    for (const [name, id] of [['黑白', 'codexDark'], ['亮白', 'codexLight']] as const) {
      await theme(name, id); await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1180, 850));
      for (const nodeId of [ids.background, ids.call, ids.literal, ids.any]) {
        await select(nodeId); await noOverflow(nodeId, '窄窗口-' + id);
        if (nodeId === ids.background) await compactAsset(slot(nodeId, 'assetId'), label(nodeId, 'assetId'), true);
        else if (nodeId === ids.call) await compactAsset(slot(nodeId, callPin), label(nodeId, callPin), false);
        else if (nodeId === ids.literal) await compactAsset(card(nodeId).locator('.blueprint-node-fields'), storedNode(initial, nodeId).name + ' · 值', true);
        await screenshot('05-' + id + '-' + nodeId);
      }
      await select(ids.call); await pick(slot(ids.call, callPin), label(ids.call, callPin), images[1], '无');
      await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000));
    }
  });
  await check('保存重开保留素材引用、调用空值操作后的最终值及参数类型', async () => {
    const saved = await save(); await fs.copyFile(projectFile, path.join(output, 'authored-project.json'));
    await close(); await launch(); await openGraph(); assert.deepEqual(await read(), saved);
    assert.equal(storedNode(saved, ids.background).properties.assetId, images[1].id); assert.equal(storedNode(saved, ids.call).properties[callPin], images[1].id);
    assert.equal(storedNode(saved, ids.literal).properties.value, images[1].id); assert.equal(storedNode(saved, ids.any).properties.true_value, 0);
    for (const nodeId of [ids.background, ids.call]) {
      await select(nodeId); await expect(browse(slot(nodeId, nodeId === ids.call ? callPin : 'assetId'), label(nodeId, nodeId === ids.call ? callPin : 'assetId'))).toContainText(images[1].name);
    }
    await select(ids.literal); await expect(card(ids.literal).getByLabel(storedNode(initial, ids.literal).name + ' · 类型', { exact: true })).toHaveValue('asset');
    await expect(browse(card(ids.literal), storedNode(initial, ids.literal).name + ' · 值')).toContainText(images[1].name);
    await select(ids.any); await expect(card(ids.any).getByLabel(label(ids.any, 'true_value'), { exact: true })).toHaveValue('0');
    await expect(card(ids.any).getByLabel(label(ids.any, 'false_value'), { exact: true })).toHaveValue(longText);
    await screenshot('06-reopened');
  });
  assert.equal(checks.length, 5); assert.deepEqual(pageErrors, []); report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = String(error);
  if (app && page) await screenshot('failure').catch(error => { report.screenshotError = String(error); });
} finally {
  await close().catch(error => { failure ??= error; report.status = 'failed'; report.closeError = String(error); });
  try { report.fingerprintsAfter = await fingerprints(); assert.deepEqual(report.fingerprintsAfter, report.fingerprintsBefore); }
  catch (error) { failure ??= error; report.status = 'failed'; report.buildIntegrityError = String(error); }
  await fs.mkdir(output, { recursive: true });
  if (!app && processes.every(item => item.exited)) {
    try { const cleanup = await cleanVerificationDirectories(output, ['fixture', 'profile']); report.cleanup = cleanup; assert.deepEqual(cleanup.errors, []); }
    catch (error) { failure ??= error; report.status = 'failed'; report.cleanupError = String(error); }
  } else { failure ??= new Error('An owned acceptance process has not exited.'); report.status = 'failed'; report.cleanupSkipped = 'Owned Electron process has not exited.'; }
  await writeReport(); console.log(output);
}
if (failure) throw failure;
