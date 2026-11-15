import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { blueprintNodeDefaults, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { blueprintUiPropertyDefinition, setBlueprintUiPropertyRows } from '../src/core/blueprint-ui-property-batch';
import { createProject, projectSchema, type Asset, type BlueprintGraph, type BlueprintNode, type Project, type VariableValue } from '../src/core/model';
import { uiProperties, type UiProperty } from '../src/core/ui-properties';
import { createUiEventGraph } from '../src/core/ui-logic';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas, setBlueprintOption } from './lib/blueprint-canvas';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Run only after every implementation and the unified source build have finished.
// Fixture creation happens before launch; all live authoring below uses real UI.
// No installed editor, real project, native game or external service is opened.
if (process.env.VNS_INSTALLED_EXE) throw new Error('请使用隔离的源码编译版验收。');
assert.deepEqual(process.argv.slice(2), [], '此验收脚本不接受额外参数。');
const root = path.resolve('.');
const artifactRoot = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/blueprint-property-batch-2026-11-12');
const artifactRelative = path.relative(root, artifactRoot);
assert.ok(artifactRelative && artifactRelative !== '..' && !artifactRelative.startsWith('..' + path.sep) && !path.isAbsolute(artifactRelative), '验收输出必须在当前 editor 工作区内。');
const output = path.join(artifactRoot, 'editor-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const projectDirectory = path.join(output, 'project'), projectFile = path.join(projectDirectory, 'project.vns.json'), profile = path.join(output, 'profile');
const relative = path.relative(root, output);
assert.ok(relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
const ids = {
  graph: 'batch_editor_graph', edges: 'batch_editor_edges', page: 'batch_editor_page', pageGraph: 'batch_editor_page_graph',
  event: 'batch_event', set: 'batch_set', finish: 'batch_finish', number: 'batch_number', text: 'batch_text', boolean: 'batch_boolean', asset: 'batch_asset',
  source: 'batch_bad_source', follow: 'batch_follow', sync: 'batch_sync', unknown: 'batch_unknown_property', invalid: 'batch_invalid_value', version: 'batch_unknown_version', json: 'batch_bad_json',
  speed: 'batch_speed', options: 'batch_options', aliases: 'batch_aliases', componentInput: 'batch_component_input', dynamic: 'batch_dynamic',
  pageClick: 'batch_page_click', pageSet: 'batch_page_set', pageNumber: 'batch_page_number', pageText: 'batch_page_text',
};
const image: Asset = { id: 'batch_editor_image', name: '批量设置测试图片', kind: 'image', category: 'ui', path: 'batch-image.svg', width: 128, height: 64 };
function makeNode(type: BlueprintNode['type'], id: string, x: number, y: number, properties: Record<string, VariableValue> = {}) {
  const node = blueprintNodeDefaults(type); node.id = id; node.x = x; node.y = y; Object.assign(node.properties, properties); return node;
}
function literal(id: string, x: number, y: number, value: VariableValue, type: 'number' | 'string' | 'boolean' | 'asset' | 'component' = typeof value as 'number' | 'string' | 'boolean') {
  const node = makeNode('literal', id, x, y, { value }); node.pins[0].dataType = type; node.pins[0].defaultValue = value; return node;
}
function batch(id: string, x: number, y: number, componentId: string, writes: { property: UiProperty; value: VariableValue; writeMode?: string }[]) {
  const node = makeNode('setUiProperty', id, x, y, { componentId });
  const rows = writes.map((write, index) => ({ id: index ? `value_row${index}` : 'value', property: write.property, writeMode: write.writeMode ?? 'override' }));
  setBlueprintUiPropertyRows(node, rows); writes.forEach((write, index) => { node.properties[rows[index].id] = write.value; }); return node;
}
function fixture() {
  const project = createProject('蓝图多属性卡片验收'); project.id = 'blueprint_property_batch_editor'; project.assets = [image];
  project.variables.push(
    { id: 'batch_number_parameter', name: '控件测试数值', type: 'number', initial: 6, persistent: false },
    { id: 'batch_choice_parameter', name: '控件测试选项', type: 'string', initial: '甲', persistent: false, setting: { options: ['甲', '乙'] } },
    { id: 'batch_opacity_parameter', name: '受控透明度', type: 'number', initial: .45, persistent: false },
  );
  project.ui.components.push({ id: 'batch_speed_component', name: '文字速度控件', kind: 'preference', page: 'preferences', text: '文字速度', preference: 'textSpeed', x: .1, y: .45, width: .6, height: .1 });
  project.ui.customPages = [{ id: ids.page, name: '批量属性页面', modal: true, components: [
    { id: 'batch_button', name: '批量目标按钮', kind: 'button', page: 'custom', text: '设计按钮文字', x: .2, y: .3, width: .3, height: .12, style: { opacity: .75, textColor: '#fafafa' } },
    { id: 'batch_label', name: '批量目标文字', kind: 'text', page: 'custom', text: '设计文字', x: .1, y: .1, width: .5, height: .12 },
    { id: 'batch_follow_component', name: '单向控件', kind: 'button', page: 'custom', text: '跟随', x: .05, y: .6, width: .2, height: .1, propertyControls: { opacity: { mode: 'follow', parameterId: 'batch_opacity_parameter' } } },
    { id: 'batch_sync_component', name: '双向控件', kind: 'button', page: 'custom', text: '同步', x: .3, y: .6, width: .2, height: .1, propertyControls: { opacity: { mode: 'sync', parameterId: 'batch_opacity_parameter' } } },
    { id: 'batch_options_component', name: '选项控件', kind: 'preferenceChoice', page: 'custom', text: '选项', parameterId: 'batch_choice_parameter', x: .5, y: .6, width: .3, height: .1 },
    { id: 'batch_number_component', name: '数值控件', kind: 'preference', page: 'custom', text: '数值', parameterId: 'batch_number_parameter', x: .1, y: .8, width: .6, height: .1 },
  ] }];
  const graph = createBlueprintGraph('function', '卡片多属性设置'); graph.id = ids.graph;
  const setter = makeNode('setUiProperty', ids.set, 340, 20, { componentId: 'batch_button', property: 'x' });
  delete setter.properties.value; setter.pins.find(pin => pin.id === 'value')!.dataType = 'number'; setter.pins.find(pin => pin.id === 'value')!.defaultValue = -.125;
  graph.nodes = [makeNode('event', ids.event, 0, 20), setter, makeNode('return', ids.finish, 760, 20),
    literal(ids.number, 0, 160, 0), literal(ids.text, 0, 290, '独立文字来源'), literal(ids.boolean, 0, 420, false), literal(ids.asset, 0, 550, image.id, 'asset')];
  graph.links = [
    { id: 'batch_exec_before', fromNodeId: ids.event, fromPinId: 'exec', toNodeId: ids.set, toPinId: 'exec_in' },
    { id: 'batch_exec_after', fromNodeId: ids.set, fromPinId: 'exec_out', toNodeId: ids.finish, toPinId: 'exec_in' },
    { id: 'batch_initial_value', fromNodeId: ids.number, fromPinId: 'value', toNodeId: ids.set, toPinId: 'value' },
  ];
  const edges = createBlueprintGraph('function', '批量属性边界'); edges.id = ids.edges;
  edges.nodes = [
    batch(ids.source, 0, 0, 'batch_button', [{ property: 'opacity', value: .5, writeMode: 'source' }]),
    batch(ids.follow, 360, 0, 'batch_follow_component', [{ property: 'visible', value: false }, { property: 'opacity', value: .2 }]),
    batch(ids.sync, 720, 0, 'batch_sync_component', [{ property: 'text', value: '同时同步' }, { property: 'opacity', value: .6 }]),
    batch(ids.unknown, 0, 310, 'batch_button', [{ property: 'x', value: .3 }]),
    batch(ids.invalid, 360, 310, 'batch_button', [{ property: 'opacity', value: '错误的旧数值' }]),
    makeNode('setUiProperty', ids.version, 720, 310, { componentId: 'batch_button', propertyBatchVersion: 77, propertyWrites: '[{"id":"value","property":"visible","writeMode":"override"}]', value: false }),
    makeNode('setUiProperty', ids.json, 0, 620, { componentId: 'batch_button', propertyBatchVersion: 1, propertyWrites: '[{', value: false }),
    batch(ids.speed, 360, 620, 'batch_speed_component', [{ property: 'numberValue', value: 35 }]),
    batch(ids.options, 720, 620, 'batch_options_component', [{ property: 'optionIndex', value: 0 }]),
    batch(ids.aliases, 0, 930, 'batch_number_component', [{ property: 'numberValue', value: 6 }, { property: 'minimum', value: 0 }]),
    literal(ids.componentInput, 360, 930, 'batch_button', 'component'), batch(ids.dynamic, 720, 930, 'batch_button', [{ property: 'visible', value: false }]),
  ];
  edges.links = [{ id: 'batch_dynamic_target', fromNodeId: ids.componentInput, fromPinId: 'value', toNodeId: ids.dynamic, toPinId: 'componentId' }];
  project.blueprints = [graph, edges];
  const pageGraph = createUiEventGraph(project, ids.page, '页面卡片批量属性'); pageGraph.id = ids.pageGraph;
  pageGraph.nodes = [makeNode('eventClick', ids.pageClick, 0, 0, { componentId: 'batch_button' }),
    makeNode('setUiProperty', ids.pageSet, 340, 0, { componentId: 'batch_button', property: 'text', value: '页面旧文字' }),
    literal(ids.pageNumber, 0, 180, -.4), literal(ids.pageText, 0, 310, '页面接线文字')];
  pageGraph.links = [];
  synchronizeBlueprintSignatures(project);
  edges.nodes.find(node => node.id === ids.unknown)!.properties.propertyWrites = JSON.stringify([{ id: 'value', property: 'removedProperty', writeMode: 'override' }]);
  return projectSchema.parse(project);
}

const initial = fixture();
let app: ElectronApplication | undefined, page: Page | undefined, failure: unknown, phase = '准备', tracing = false, launches = 0;
let pageGraphOpen = false;
const checks: { name: string; durationMs: number }[] = [], pageErrors: string[] = [], traces: string[] = [], processes: { pid?: number; exited: boolean }[] = [];
const evidence: Record<string, unknown[]> = { geometry: [], connections: [], wireEndpoints: [], history: [], filtering: [] };
const report: Record<string, unknown> = { status: 'running', renderer: 'dist', checks, pageErrors, traces, processes, evidence,
  temporaryPaths: [projectDirectory, profile], limits: ['仅验收桌面作者界面；实际整组写入语义由核心及原生专项验证。', '非法旧配置用于验证保留与修复，不把可保存等同于可执行。'] };
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const inspector = () => pageGraphOpen
  ? page!.locator('.ui-event-detail:visible').locator('.blueprint-properties')
  : page!.getByRole('complementary', { name: '蓝图属性', exact: true });
const card = (id: string) => page!.locator(`.react-flow__node[data-id="${id}"]`);
const row = (id: string, property: string) => card(id).locator(`.blueprint-property-entry[data-property-id="${property}"]`);
const handle = (id: string, pin: string) => card(id).locator(`.react-flow__handle[data-handleid="${pin}"]`);
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
function storedGraph(project: Project, id = ids.graph) { const graph = project.blueprints.find(item => item.id === id); assert.ok(graph); return graph; }
function storedNode(project: Project, id: string, graphId = ids.graph) { const node = storedGraph(project, graphId).nodes.find(item => item.id === id); assert.ok(node); return node; }
function rowsOf(node: BlueprintNode) { const rows = blueprintUiPropertyDefinition(node).rows; assert.ok(rows); return rows; }
const valueLabel = (property: UiProperty) => '设置组件属性 · ' + uiProperties[property].name;
function value(id: string, property: UiProperty) { return row(id, property).getByLabel(valueLabel(property), { exact: true }); }
const settle = () => page!.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
async function writeReport() { await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
async function fingerprints() {
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  const files = ['dist/index.html', 'dist-desktop/main.cjs', 'dist-desktop/preload.cjs', ...[...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => 'dist/' + match[1].slice(2))];
  assert.ok(files.some(file => file.startsWith('dist/assets/') && file.endsWith('.js')), '先完成统一编译。');
  return Promise.all([...new Set(files)].map(async file => ({ file, sha256: createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex') })));
}
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile }); launches++; processes.push({ pid: app.process().pid, exited: false });
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => pageErrors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; if (window.isMaximized()) window.unmaximize(); window.setContentSize(1600, 1000); window.webContents.setBackgroundThrottling(false); });
  await expect(page.locator('.project-title strong')).toHaveText(initial.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html')); report.rendererUrl = page.url();
  await page.evaluate('globalThis.__name = value => value');
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false }); tracing = true;
}
async function close() {
  if (!app) return;
  const owned = app, child = owned.process(), exited = () => child.exitCode !== null || child.signalCode !== null;
  let traceFailure: unknown;
  if (tracing && page) {
    const file = `trace-${launches}.zip`;
    try { await page.context().tracing.stop({ path: path.join(output, file) }); traces.push(file); } catch (error) { traceFailure = error; }
    tracing = false;
  }
  try { await owned.close(); } finally {
    await expect.poll(exited, { timeout: 15000 }).toBe(true);
    const record = processes.find(item => item.pid === child.pid); if (record) record.exited = exited();
    if (exited()) { app = undefined; page = undefined; }
  }
  if (traceFailure) throw traceFailure;
}
async function screenshot(name: string) {
  await settle(); const image = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(image, 'base64'));
}
async function check(name: string, work: () => Promise<void>) { phase = name; const start = Date.now(); await work(); checks.push({ name, durationMs: Date.now() - start }); await writeReport(); console.log('通过：' + name); }
async function save() { await button('保存工程').click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); await settle(); return read(); }
async function saveUi() { if (await button('保存界面').isEnabled()) await button('保存界面').click(); await expect(page!.locator('.ui-save-status')).toHaveText('已保存', { timeout: 30000 }); await expect(button('保存界面')).toBeDisabled(); return read(); }
async function openGraph(id = ids.graph) {
  await page!.locator('[data-workspace-tab="blueprint"]').click(); await page!.getByLabel('蓝图资源', { exact: true }).selectOption('graph:' + id);
  pageGraphOpen = false;
  if (!await inspector().isVisible()) await button('展开蓝图属性').click(); await setBlueprintOption(page!, '自动接线', false); await fitBlueprintCanvas(page!); await settle();
}
async function openPageGraph() {
  await page!.locator('[data-workspace-tab="ui"]').click(); await page!.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '事件图', exact: true }).click();
  await page!.getByLabel('事件图页面', { exact: true }).selectOption(ids.page); await page!.getByLabel('当前页面事件图', { exact: true }).selectOption(ids.pageGraph);
  pageGraphOpen = true;
  await setBlueprintOption(page!, '自动接线', false); await fitBlueprintCanvas(page!); await settle();
}
async function select(id: string, focus = true) {
  await fitBlueprintCanvas(page!); await card(id).locator('.graph-node-title strong').click();
  if (pageGraphOpen) {
    await expect(page!.locator('.ui-event-detail:visible')).toHaveAttribute('data-detail-id', `node:${ids.pageGraph}:${id}`);
    await expect(inspector()).toBeVisible();
  } else await inspector().getByRole('button', { name: '节点参数', exact: true }).click();
  await expect(card(id)).toHaveClass(/selected/);
  if (focus) {
    await button('定位选中节点').click();
    await expect.poll(() => card(id).evaluate(async element => {
      const viewport = element.closest('.react-flow__viewport'), pane = element.closest('.react-flow');
      if (!viewport || !pane) return false;
      const transform = getComputedStyle(viewport).transform;
      if (new DOMMatrixReadOnly(transform).a < .64) return false;
      for (let frame = 0; frame < 4; frame++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (!element.isConnected || !viewport.isConnected || getComputedStyle(viewport).transform !== transform) return false;
      }
      const box = element.getBoundingClientRect(), bounds = pane.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.left >= bounds.left - 1 && box.top >= bounds.top - 1 && box.right <= bounds.right + 1 && box.bottom <= bounds.bottom + 1;
    })).toBe(true);
  }
  await settle();
}
async function fill(control: Locator, text: string) { await expect(control).toHaveCount(1); await control.fill(text); await control.press('Tab'); await settle(); }
async function addProperty(id: string, property: UiProperty) { await card(id).getByRole('combobox', { name: '设置组件属性 · 添加属性', exact: true }).selectOption(property); await expect(row(id, property)).toHaveCount(1); await settle(); const pin = await row(id, property).getAttribute('data-property-row-id'); assert.ok(pin); return pin; }
async function chooseProperty(id: string, before: string, after: UiProperty) { await row(id, before).locator('.blueprint-property-select').selectOption(after); await expect(row(id, after)).toHaveCount(1); await settle(); }
async function connect(from: string, fromPin: string, to: string, toPin: string) {
  await fitBlueprintCanvas(page!); const before = await page!.locator('.react-flow__edge').count();
  await page!.evaluate(() => { const samples: { node: string | null; pin: string | null; trusted: boolean }[] = []; (window as unknown as { __batchPointers: unknown }).__batchPointers = samples;
    document.addEventListener('pointerdown', function record(event) { const pin = (event.target as Element).closest('.react-flow__handle'); if (!pin) return; samples.push({ node: pin.closest('.react-flow__node')?.getAttribute('data-id') ?? null, pin: pin.getAttribute('data-handleid'), trusted: event.isTrusted }); if (samples.length === 2) document.removeEventListener('pointerdown', record, true); }, true); });
  await handle(from, fromPin).click(); await handle(to, toPin).click(); await expect(page!.locator('.react-flow__edge')).toHaveCount(before + 1); await settle();
  const samples = await page!.evaluate(() => (window as unknown as { __batchPointers: { node: string; pin: string; trusted: boolean }[] }).__batchPointers);
  assert.deepEqual(samples.map(sample => [sample.node, sample.pin, sample.trusted]), [[from, fromPin, true], [to, toPin, true]]); evidence.connections.push(samples);
}
async function wirePoint(id: string, end: boolean) { return page!.locator(`.react-flow__edge[data-id="${id}"] .react-flow__edge-path`).evaluate((element, end) => { const curve = element as SVGPathElement, matrix = curve.getScreenCTM(); if (!matrix) throw new Error('连线未测量'); const point = curve.getPointAtLength(end ? curve.getTotalLength() : 0), screen = new DOMPoint(point.x, point.y).matrixTransform(matrix); return { x: screen.x, y: screen.y }; }, end); }
async function assertWire(graph: BlueprintGraph, to: string, pin: string) {
  const link = graph.links.find(link => link.toNodeId === to && link.toPinId === pin); assert.ok(link);
  await expect.poll(async () => { const start = await wirePoint(link.id, false), end = await wirePoint(link.id, true), source = await handle(link.fromNodeId, link.fromPinId).boundingBox(), target = await handle(to, pin).boundingBox(); if (!source || !target) return Infinity; return Math.max(Math.hypot(start.x - source.x - source.width, start.y - source.y - source.height / 2), Math.hypot(end.x - target.x, end.y - target.y - target.height / 2)); }).toBeLessThan(2);
  evidence.wireEndpoints.push({ link, start: await wirePoint(link.id, false), end: await wirePoint(link.id, true) });
}
async function undoRedo(before: BlueprintGraph, after: BlueprintGraph, graphId = ids.graph, saveAction = save) {
  await button('撤销').click(); assert.deepEqual(storedGraph(await saveAction(), graphId), before);
  await button('重做').click(); assert.deepEqual(storedGraph(await saveAction(), graphId), after); evidence.history.push({ name: phase, atomic: true });
}
async function geometry(id: string) {
  const result = await card(id).locator('.blueprint-graph-node').evaluate(element => {
    const box = element.getBoundingClientRect(); return { width: (element as HTMLElement).offsetWidth, height: (element as HTMLElement).offsetHeight, box: { left: box.left, right: box.right },
      controls: [...element.querySelectorAll<HTMLElement>('input,select,textarea,button')].filter(control => control.getClientRects().length > 0).map(control => { const rect = control.getBoundingClientRect(); return { label: control.getAttribute('aria-label'), left: rect.left, right: rect.right, width: rect.width }; }),
      rows: [...element.querySelectorAll<HTMLElement>('.blueprint-property-row:not(.collapsed)')].map(row => { const property = row.querySelector('.blueprint-property-select')!.getBoundingClientRect(), value = row.querySelector('.blueprint-pin-value')!.getBoundingClientRect(); return { pin: row.dataset.pinId, property: { top: property.top, bottom: property.bottom }, value: { top: value.top, bottom: value.bottom }, display: getComputedStyle(row).display }; }) };
  });
  assert.equal(result.width, 320); assert.deepEqual(result.controls.filter(control => control.width <= 0 || control.left < result.box.left - 2 || control.right > result.box.right + 2), []);
  for (const row of result.rows) { assert.equal(row.display, 'grid'); assert.ok(Math.max(row.property.top, row.value.top) < Math.min(row.property.bottom, row.value.bottom), '属性名称与值同行：' + row.pin); }
  evidence.geometry.push({ id, ...result });
}

let visiblePin = '', yPin = '', textPin = '', assetPin = '', colorPin = '', savedBeforeReopen: Project;
try {
  await fs.mkdir(projectDirectory, { recursive: true }); report.fingerprintsBefore = await fingerprints();
  await fs.writeFile(path.join(output, 'temporary-artifacts.json'), JSON.stringify({ root: output, paths: [projectDirectory, profile], cleanup: 'Only after this fixture Electron exits.' }, null, 2));
  await fs.writeFile(path.join(projectDirectory, image.path), '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="64"><rect width="128" height="64" rx="8" fill="#548aa8"/><circle cx="32" cy="32" r="18" fill="#fae5aa"/></svg>');
  await saveProject(projectFile, initial); await fs.copyFile(projectFile, path.join(output, 'input-project.json')); await launch(); await openGraph();
  await check('普通蓝图卡片直接选择目标与属性，旧单项保持格式和值', async () => {
    await select(ids.set); await expect(row(ids.set, 'x')).toHaveCount(1); await expect(card(ids.set).getByLabel('设置组件属性 · 界面组件', { exact: true })).toHaveValue('batch_button');
    const choices = await row(ids.set, 'x').locator('.blueprint-property-select option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
    assert.ok(choices.includes('visible') && choices.includes('text')); assert.ok(!choices.includes('spineSpeed') && !choices.includes('numberValue') && !choices.includes('hovered'));
    assert.ok(await row(ids.set, 'x').locator('optgroup[label="常用"]').count()); evidence.filtering.push({ target: 'button', choices });
    const target = card(ids.set).getByLabel('设置组件属性 · 界面组件', { exact: true });
    await target.selectOption('batch_label');
    await expect(row(ids.set, 'x').locator('option[value="enabled"]')).toHaveCount(0); await expect(row(ids.set, 'x').locator('option[value="idleImage"]')).toHaveCount(0);
    evidence.filtering.push({ target: 'text', choices: await row(ids.set, 'x').locator('.blueprint-property-select option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)) });
    await target.selectOption('batch_button');
    const saved = await save(), node = storedNode(saved, ids.set); assert.equal(node.properties.propertyBatchVersion, undefined); assert.equal(node.pins.find(pin => pin.id === 'value')!.defaultValue, -.125);
    assert.deepEqual(storedGraph(saved).links, storedGraph(initial).links);
    await chooseProperty(ids.set, 'x', 'width'); const changed = storedNode(await save(), ids.set);
    assert.equal(changed.properties.propertyBatchVersion, undefined); assert.equal(changed.properties.property, 'width'); assert.equal(changed.properties.value, .3);
    await button('撤销').click(); assert.deepEqual(storedNode(await save(), ids.set), node); await expect(row(ids.set, 'x')).toHaveCount(1);
    await geometry(ids.set); await screenshot('01-legacy-direct-card');
  });
  await check('首次添加保留旧value连接和值，属性可独立取0和否', async () => {
    const before = storedGraph(await save()); visiblePin = await addProperty(ids.set, 'visible'); await value(ids.set, 'visible').selectOption('false');
    const saved = await save(), setter = storedNode(saved, ids.set); assert.equal(setter.properties.propertyBatchVersion, 1); assert.equal(setter.properties.value, -.125);
    assert.equal(setter.properties[visiblePin], false); assert.deepEqual(rowsOf(setter).map(row => row.id), ['value', visiblePin]); assert.ok(/^value_[a-z][a-zA-Z0-9_]{0,47}$/.test(visiblePin));
    assert.deepEqual(storedGraph(saved).links, before.links); await assertWire(storedGraph(saved), ids.set, 'value');
    yPin = await addProperty(ids.set, 'y'); await fill(value(ids.set, 'y'), '0'); assert.equal(storedNode(await save(), ids.set).properties[yPin], 0);
    await screenshot('02-first-batch-and-zero');
  });
  await check('每项独立编辑文字、负数、RGBA颜色与素材', async () => {
    await select(ids.set); textPin = await addProperty(ids.set, 'text'); await expect(value(ids.set, 'text')).toHaveValue('设计按钮文字'); await fill(value(ids.set, 'text'), '卡片直接设置文字');
    await fill(value(ids.set, 'y'), '-0.25'); colorPin = await addProperty(ids.set, 'textColor'); await fill(value(ids.set, 'textColor'), '#12345680');
    assetPin = await addProperty(ids.set, 'idleImage'); const assetLabel = valueLabel('idleImage'); await row(ids.set, 'idleImage').getByRole('button', { name: '浏览' + assetLabel, exact: true }).click();
    const dialog = page!.getByRole('dialog', { name: assetLabel + '资源浏览器', exact: true }); await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '预览资源 ' + image.name, exact: true }).click(); await dialog.locator('footer').getByRole('button', { name: '使用所选资源', exact: true }).click(); await expect(dialog).toHaveCount(0);
    const setter = storedNode(await save(), ids.set); assert.equal(setter.properties[textPin], '卡片直接设置文字'); assert.equal(setter.properties[yPin], -.25); assert.equal(setter.properties[colorPin], '#12345680'); assert.equal(setter.properties[assetPin], image.id);
    assert.equal(setter.properties[visiblePin], false); await geometry(ids.set); await screenshot('03-mixed-typed-values');
  });
  await check('各项分别接不同类型数据线，来源同行且可以定位', async () => {
    await connect(ids.boolean, 'value', ids.set, visiblePin); await connect(ids.text, 'value', ids.set, textPin); await connect(ids.asset, 'value', ids.set, assetPin);
    const saved = await save(); for (const pin of ['value', visiblePin, textPin, assetPin]) await assertWire(storedGraph(saved), ids.set, pin);
    for (const property of ['x', 'visible', 'text', 'idleImage']) await expect(row(ids.set, property).locator('.blueprint-pin-source')).toContainText('来自：');
    await row(ids.set, 'text').locator('.blueprint-pin-source').click(); await expect(card(ids.text)).toHaveClass(/selected/); await select(ids.set);
    await geometry(ids.set); await screenshot('04-independent-linked-sources');
  });
  await check('切换相容属性保留连接点，默认值按当前组件重置', async () => {
    const before = storedGraph(await save()); await chooseProperty(ids.set, 'x', 'width'); const after = storedGraph(await save());
    const setter = after.nodes.find(node => node.id === ids.set)!; assert.equal(rowsOf(setter)[0].id, 'value'); assert.equal(setter.properties.value, .3); assert.deepEqual(after.links, before.links);
    await assertWire(after, ids.set, 'value'); await undoRedo(before, after); await expect(row(ids.set, 'width')).toHaveCount(1);
  });
  await check('切换不相容属性只断开对应数据线，一次撤销完整恢复', async () => {
    const before = storedGraph(await save()); await chooseProperty(ids.set, 'width', 'selected'); const after = storedGraph(await save());
    assert.equal(after.links.length, before.links.length - 1); assert.ok(!after.links.some(link => link.id === 'batch_initial_value'));
    assert.equal(after.nodes.find(node => node.id === ids.set)!.properties.value, false); assert.equal(after.links.filter(link => link.toNodeId === ids.set && [visiblePin, textPin, assetPin].includes(link.toPinId)).length, 3);
    await button('撤销').click(); assert.deepEqual(storedGraph(await save()), before); await expect(row(ids.set, 'width')).toHaveCount(1); await assertWire(before, ids.set, 'value');
    evidence.history.push({ name: phase, atomic: true });
  });
  await check('删除一项同时清除该值和线，一次撤销及重做不影响其他项', async () => {
    await select(ids.set); const before = storedGraph(await save()); await row(ids.set, 'visible').getByRole('button', { name: /删除第\d+项属性：显示/ }).click();
    const after = storedGraph(await save()), setter = after.nodes.find(node => node.id === ids.set)!; assert.equal(setter.properties[visiblePin], undefined); assert.ok(!setter.pins.some(pin => pin.id === visiblePin)); assert.ok(!after.links.some(link => link.toNodeId === ids.set && link.toPinId === visiblePin));
    assert.equal(rowsOf(setter).length, rowsOf(before.nodes.find(node => node.id === ids.set)!).length - 1); await undoRedo(before, after);
    await button('撤销').click(); assert.deepEqual(storedGraph(await save()), before); await assertWire(before, ids.set, visiblePin); await screenshot('07-row-remove-undone');
  });
  await check('收起参数保留全部连接点与属性名，展开没有重复值行', async () => {
    const before = storedGraph(await save()), handles = await card(ids.set).locator('.react-flow__handle').count();
    await card(ids.set).getByRole('button', { name: '收起节点参数', exact: true }).click(); await expect(card(ids.set).locator('input,select')).toHaveCount(0);
    assert.equal(await card(ids.set).locator('.react-flow__handle').count(), handles); await expect(row(ids.set, 'width').locator('.blueprint-property-name')).toContainText('宽度');
    await assertWire(before, ids.set, visiblePin); await screenshot('08-collapsed-property-names');
    await card(ids.set).getByRole('button', { name: '展开节点参数', exact: true }).click();
    for (const item of rowsOf(before.nodes.find(node => node.id === ids.set)!)) { await expect(card(ids.set).locator(`.blueprint-pin-slot[data-pin-id="${item.id}"]`)).toHaveCount(1); await expect(handle(ids.set, item.id)).toHaveCount(1); }
    assert.deepEqual(storedGraph(await save()), before);
  });
  await check('按目标过滤属性、控制值别名去重与真实引擎数值边界', async () => {
    await openGraph(ids.edges); await select(ids.aliases);
    const choices = await card(ids.aliases).getByLabel('设置组件属性 · 添加属性', { exact: true }).locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
    assert.ok(!choices.includes('numberValue') && !choices.includes('normalizedValue') && !choices.includes('optionIndex')); assert.ok(choices.includes('maximum')); evidence.filtering.push({ target: 'number control', choices });
    await select(ids.speed); await fill(value(ids.speed, 'numberValue'), '350'); await value(ids.speed, 'numberValue').press('Tab'); assert.equal(storedNode(await save(), ids.speed, ids.edges).properties.value, 350);
    await select(ids.options); await fill(value(ids.options, 'optionIndex'), '5'); assert.equal(storedNode(await save(), ids.options, ids.edges).properties.value, 5);
    await select(ids.dynamic); await expect(card(ids.dynamic).locator('.blueprint-property-status')).toContainText('运行时');
    assert.ok(await card(ids.dynamic).getByLabel('设置组件属性 · 添加属性', { exact: true }).locator('option[value="spineSpeed"]').count()); await screenshot('09-runtime-target');
  });
  await check('单向任意一项阻止整组的提示明确，双向提示写回参数', async () => {
    await select(ids.follow); await expect(card(ids.follow).locator('.blueprint-property-status')).toContainText('单向跟随参数'); await expect(card(ids.follow).locator('.blueprint-property-status')).toContainText('整组属性都不会修改'); await screenshot('10-follow-batch-status');
    await select(ids.sync); await expect(card(ids.sync).locator('.blueprint-property-status')).toContainText('双向同步'); await expect(inspector().locator('.blueprint-property-status')).toContainText('写回对应参数'); await screenshot('10-sync-batch-status');
  });
  await check('未知属性与坏source方式在原项直接修复，值按类型重置', async () => {
    await select(ids.source); await expect(card(ids.source).locator('.blueprint-property-status')).toContainText('没有可修改的绑定源');
    await card(ids.source).getByLabel(valueLabel('opacity') + ' · 赋值方式', { exact: true }).selectOption('override');
    let saved = await save(); assert.equal(rowsOf(storedNode(saved, ids.source, ids.edges))[0].writeMode, 'override'); await expect(card(ids.source).locator('.blueprint-property-status')).not.toHaveAttribute('data-warning', 'true');
    await select(ids.unknown); const before = storedNode(await save(), ids.unknown, ids.edges); await expect(row(ids.unknown, 'removedProperty')).toHaveCount(1);
    await chooseProperty(ids.unknown, 'removedProperty', 'text'); saved = await save(); const after = storedNode(saved, ids.unknown, ids.edges); assert.equal(rowsOf(after)[0].id, rowsOf(before)[0].id); assert.equal(after.properties.value, '设计按钮文字'); assert.equal(after.pins.find(pin => pin.id === 'value')!.dataType, 'string');
    await screenshot('11-repaired-property');
  });
  await check('非法旧值、未知格式与无法解析列表保留原数据及连接点', async () => {
    await select(ids.invalid); const beforeInvalid = storedNode(await save(), ids.invalid, ids.edges); await expect(card(ids.invalid).locator('.blueprint-property-status')).toContainText('整组属性都不会修改'); assert.equal(beforeInvalid.properties.value, '错误的旧数值');
    await fill(value(ids.invalid, 'opacity'), '.5'); assert.equal(storedNode(await save(), ids.invalid, ids.edges).properties.value, .5);
    for (const id of [ids.version, ids.json]) { await select(id); const before = storedNode(await save(), id, ids.edges); await expect(card(id).locator('.blueprint-property-status')).toContainText('保留');
      await expect(card(id).getByLabel('设置组件属性 · 添加属性', { exact: true })).toHaveCount(0); assert.deepEqual((await card(id).locator('.react-flow__handle').evaluateAll(handles => handles.map(handle => handle.getAttribute('data-handleid')))).sort(), before.pins.map(pin => pin.id).sort());
      await card(id).getByRole('button', { name: '收起节点参数', exact: true }).click(); await card(id).getByRole('button', { name: '展开节点参数', exact: true }).click(); assert.deepEqual(storedNode(await save(), id, ids.edges), before); }
    await screenshot('12-retained-malformed-list');
  });
  await check('页面事件图直接编辑与多项接线先留草稿，删除可撤销', async () => {
    await openPageGraph(); await select(ids.pageSet); const before = await read(); await fill(value(ids.pageSet, 'text'), '页面卡片文字');
    const pageX = await addProperty(ids.pageSet, 'x'), pageVisible = await addProperty(ids.pageSet, 'visible'); await value(ids.pageSet, 'visible').selectOption('false'); await fill(value(ids.pageSet, 'x'), '0');
    await connect(ids.pageClick, 'exec', ids.pageSet, 'exec_in'); await connect(ids.pageNumber, 'value', ids.pageSet, pageX); await connect(ids.pageText, 'value', ids.pageSet, 'value');
    assert.deepEqual(await read(), before); await select(ids.pageSet); await geometry(ids.pageSet); const saved = await saveUi(), expected = storedGraph(saved, ids.pageGraph);
    assert.equal(storedNode(saved, ids.pageSet, ids.pageGraph).properties[pageVisible], false); assert.equal(storedNode(saved, ids.pageSet, ids.pageGraph).properties[pageX], 0); assert.equal(expected.links.length, 3);
    await row(ids.pageSet, 'x').getByRole('button', { name: /删除第\d+项属性/ }).click(); await expect(handle(ids.pageSet, pageX)).toHaveCount(0); await button('撤销').click(); await expect(handle(ids.pageSet, pageX)).toHaveCount(1);
    assert.deepEqual(storedGraph(await saveUi(), ids.pageGraph), expected); await assertWire(expected, ids.pageSet, pageX); await screenshot('13-page-batch');
    assert.deepEqual(storedGraph(saved), storedGraph(before));
  });
  await check('窄窗口两种主题下属性和值保持同行，无横向溢出', async () => {
    for (const [name, theme] of [['黑白', 'codexDark'], ['亮白', 'codexLight']] as const) {
      await button('作品设置').click(); const dialog = page!.getByRole('dialog', { name: '作品设置', exact: true }); await dialog.getByRole('button', { name: '编辑器外观', exact: true }).click();
      await dialog.getByRole('group', { name: '编辑器配色', exact: true }).getByRole('button', { name: new RegExp('^' + name) }).click(); await expect(page!.locator('html')).toHaveAttribute('data-editor-theme', theme); await dialog.getByRole('button', { name: '完成', exact: true }).click();
      await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1180, 850)); await select(ids.pageSet); await geometry(ids.pageSet); await screenshot('14-page-narrow-' + theme);
      await openGraph(); await select(ids.set); await geometry(ids.set); await screenshot('14-normal-narrow-' + theme); await openPageGraph();
    }
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000));
  });
  await check('保存重开同时保留普通图与页面图的行身份、每项值与连线', async () => {
    await saveUi(); await openGraph(); await select(ids.set); await card(ids.set).getByRole('button', { name: '收起节点参数', exact: true }).click(); savedBeforeReopen = await save();
    await fs.copyFile(projectFile, path.join(output, 'saved-project.json')); await close(); await launch(); await openGraph(); assert.deepEqual(await read(), savedBeforeReopen);
    await expect(card(ids.set).getByRole('button', { name: '展开节点参数', exact: true })).toHaveCount(1); await card(ids.set).getByRole('button', { name: '展开节点参数', exact: true }).click();
    const setter = storedNode(savedBeforeReopen, ids.set); assert.deepEqual(await card(ids.set).locator('.blueprint-property-entry').evaluateAll(rows => rows.map(row => row.getAttribute('data-property-row-id'))), rowsOf(setter).map(row => row.id));
    assert.equal(setter.properties[visiblePin], false); assert.equal(setter.properties[yPin], -.25); assert.equal(setter.properties[colorPin], '#12345680'); assert.equal(setter.properties[assetPin], image.id);
    for (const pin of ['value', visiblePin, textPin, assetPin]) await assertWire(storedGraph(savedBeforeReopen), ids.set, pin); await screenshot('15-reopened-normal');
    await openPageGraph(); await expect(button('保存界面')).toBeDisabled(); assert.deepEqual(await read(), savedBeforeReopen); await geometry(ids.pageSet); await screenshot('15-reopened-page');
  });
  assert.equal(checks.length, 15); assert.deepEqual(pageErrors, []); report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = String(error); if (app && page) await screenshot('failure').catch(error => { report.screenshotError = String(error); });
} finally {
  await close().catch(error => { failure ??= error; report.status = 'failed'; report.closeError = String(error); });
  try { report.fingerprintsAfter = await fingerprints(); assert.deepEqual(report.fingerprintsAfter, report.fingerprintsBefore); } catch (error) { failure ??= error; report.status = 'failed'; report.buildIntegrityError = String(error); }
  await fs.mkdir(output, { recursive: true }); await writeReport();
  if (!app && processes.every(item => item.exited)) {
    try { const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); report.cleanup = cleanup; assert.deepEqual(cleanup.errors, []); await Promise.all(cleanup.removed.map(async target => { await assert.rejects(fs.stat(target), { code: 'ENOENT' }); })); }
    catch (error) { failure ??= error; report.status = 'failed'; report.cleanupError = String(error); }
  } else { failure ??= new Error('本轮隔离进程尚未退出。'); report.status = 'failed'; report.cleanupSkipped = 'Owned process still present'; }
  await writeReport(); console.log(output);
}
if (failure) throw failure;
