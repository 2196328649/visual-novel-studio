import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { createProject, projectSchema, type BlueprintGraph, type BlueprintNode, type Project, type VariableValue } from '../src/core/model';
import { blueprintNodeDefaults, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { blueprintUiPropertyRowForPin } from '../src/core/blueprint-ui-property-batch';
import { uiProperties, type UiProperty } from '../src/core/ui-properties';
import { createUiEventGraph } from '../src/core/ui-logic';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas, setBlueprintOption } from './lib/blueprint-canvas';
import { openDisclosureAncestors } from './lib/ui-disclosures';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Run only after all authoring work and the unified build have completed.
// --baseline reads the existing compiled build without asserting the new DOM.
// This fixture never opens the author's project or launches a native game.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Node design acceptance requires the isolated compiled source editor.');
const baseline = process.argv.includes('--baseline');
assert.deepEqual(process.argv.slice(2).filter(argument => argument !== '--baseline'), [], 'Only --baseline is supported.');
const root = path.resolve('.');
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/blueprint-node-design-2026-11-11', (baseline ? 'baseline-' : 'node-design-') + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const projectFile = path.join(output, 'fixture/project.vns.json'), profile = path.join(output, 'profile');
const temporaryPaths = [path.dirname(projectFile), profile];
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const ids = { graph: 'design_graph', callee: 'design_callee', advanced: 'design_advanced', page: 'design_page', pageGraph: 'design_page_graph',
  event: 'design_event', delay: 'design_delay', finish: 'design_return', literal: 'design_literal', round: 'design_round', math: 'design_math',
  compare: 'design_compare', branch: 'design_branch', actor: 'design_actor_node', call: 'design_call', getter: 'design_getter',
  changed: 'design_actor_changed', invalid: 'design_actor_invalid', chapter: 'design_chapter', camera: 'design_camera', required: 'design_camera_required',
  connected: 'design_camera_connected', advancedLiteral: 'design_advanced_literal', pageClick: 'design_page_click', pageInput: 'design_page_input',
  pageProperty: 'design_page_property', pageOutput: 'design_page_output' };
const actorAdvanced = ['instanceId', 'useDefaultFraming', 'x', 'y', 'scale', 'layer'];
function fixture() {
  const project = createProject('蓝图紧凑节点桌面验收'); project.id = 'blueprint_node_design_acceptance'; project.width = 1280; project.height = 720;
  project.assets = [
    { id: 'design_portrait', name: '节点验收立绘', kind: 'image', category: 'portrait', path: 'portrait.svg', width: 180, height: 300 },
    { id: 'design_background', name: '节点验收背景', kind: 'image', category: 'scene', path: 'background.svg', width: 1280, height: 720 },
  ];
  project.characters = [{ id: 'design_actor', name: '节点验收角色', color: '#ffffff', expressions: [{ id: 'design_expression', name: '正面', assetId: 'design_portrait' }] }];
  project.ui.customPages = [{ id: ids.page, name: '紧凑节点页面', modal: true, components: [
    { id: 'design_text', name: '验收提示文字', kind: 'text', page: 'custom', text: '默认文字', x: .1, y: .1, width: .6, height: .15 },
    { id: 'design_button', name: '验收按钮', kind: 'button', page: 'custom', text: '继续', x: .2, y: .4, width: .3, height: .12 },
  ] }];
  project.ui.pageInterfaces = { [ids.page]: { version: 1,
    inputs: [{ id: 'design_page_amount', name: '页面输入数值', direction: 'input', dataType: 'number', required: false, defaultValue: 0 }],
    outputs: [{ id: 'design_page_result', name: '页面返回数值', direction: 'output', dataType: 'number', required: false, defaultValue: 0 }],
  } };
  const node = (type: BlueprintNode['type'], id: string, index: number, properties: Record<string, VariableValue> = {}) => {
    const value = blueprintNodeDefaults(type, index); value.id = id; value.x = (index % 4) * 340; value.y = Math.floor(index / 4) * 390;
    Object.assign(value.properties, properties); return value;
  };
  const graph = createBlueprintGraph('function', '紧凑节点普通蓝图'); graph.id = ids.graph;
  graph.exposedInputs = [{ id: 'design_amount', name: '读取的数值参数', direction: 'input', dataType: 'number', required: false, defaultValue: 0 }];
  const callee = createBlueprintGraph('function', '紧凑节点被调用流程'); callee.id = ids.callee; callee.nodes[0].id = 'design_callee_event';
  callee.exposedInputs = [
    { id: 'design_call_amount', name: '传入数值', direction: 'input', dataType: 'number', required: false, defaultValue: 0 },
    { id: 'design_call_enabled', name: '传入开关', direction: 'input', dataType: 'boolean', required: false, defaultValue: false },
  ];
  callee.exposedOutputs = [{ id: 'design_call_result', name: '返回开关', direction: 'output', dataType: 'boolean', required: false, defaultValue: false }];
  const literal = node('literal', ids.literal, 4, { value: 0 }); literal.pins[0].dataType = 'number'; literal.pins[0].defaultValue = 0;
  graph.nodes = [node('event', ids.event, 0), node('delay', ids.delay, 1), node('branch', ids.branch, 2), node('return', ids.finish, 3),
    literal, node('round', ids.round, 5), node('math', ids.math, 6), node('compare', ids.compare, 7),
    node('showCharacter', ids.actor, 8, { characterId: 'design_actor', expressionId: 'design_expression' }),
    node('callFunction', ids.call, 9, { graphId: ids.callee }), node('getInput', ids.getter, 10, { inputId: 'design_amount' })];
  graph.links = [{ id: 'design_initial_exec', fromNodeId: ids.event, fromPinId: 'exec', toNodeId: ids.delay, toPinId: 'exec_in' },
    { id: 'design_initial_data', fromNodeId: ids.getter, fromPinId: 'value', toNodeId: ids.math, toPinId: 'a' }];
  const advanced = createBlueprintGraph('function', '更多参数边界'); advanced.id = ids.advanced;
  const changed = node('showCharacter', ids.changed, 0, { characterId: 'design_actor', expressionId: 'design_expression', x: 0, useDefaultFraming: false, instanceId: '' });
  changed.pins.find(pin => pin.id === 'useDefaultFraming')!.defaultValue = true;
  changed.pins.find(pin => pin.id === 'instanceId')!.defaultValue = '2';
  const chapter = node('showChapter', ids.chapter, 2, { backgroundId: '', titleImageId: '', soundId: '', effect: '' });
  for (const pin of chapter.pins) if (['backgroundId', 'titleImageId', 'soundId'].includes(pin.id)) pin.defaultValue = 'design_background';
  chapter.pins.find(pin => pin.id === 'effect')!.defaultValue = 'fade';
  const camera = node('camera', ids.camera, 3); camera.pins.push({ id: 'legacy_gain', name: '兼容未知输入', direction: 'input', dataType: 'number', required: false, defaultValue: 0 });
  const required = node('camera', ids.required, 4); required.pins.find(pin => pin.id === 'rotation')!.required = true;
  const advancedLiteral = node('literal', ids.advancedLiteral, 6, { value: 0 }); advancedLiteral.pins[0].dataType = 'number'; advancedLiteral.pins[0].defaultValue = 0;
  advanced.nodes = [changed, node('showCharacter', ids.invalid, 1, { characterId: 'design_actor', expressionId: 'design_expression', layer: '旧值类型错误' }),
    chapter, camera, required, node('camera', ids.connected, 5), advancedLiteral];
  advanced.links = [{ id: 'design_advanced_rotation', fromNodeId: ids.advancedLiteral, fromPinId: 'value', toNodeId: ids.connected, toPinId: 'rotation' }];
  project.blueprints = [graph, callee, advanced];
  const pageGraph = createUiEventGraph(project, ids.page, '紧凑节点页面'); pageGraph.id = ids.pageGraph;
  pageGraph.nodes = [node('eventClick', ids.pageClick, 0, { componentId: 'design_button' }),
    node('setUiProperty', ids.pageProperty, 1, { componentId: 'design_text', property: 'text', value: '草稿文字' }),
    node('setPageOutput', ids.pageOutput, 2, { pageId: ids.page, parameterId: 'design_page_result', value: 0 }),
    node('getPageInput', ids.pageInput, 4, { pageId: ids.page, parameterId: 'design_page_amount' })];
  synchronizeBlueprintSignatures(project); return projectSchema.parse(project);
}
const initial = fixture();
let app: ElectronApplication | undefined, page: Page | undefined, failure: unknown, phase = '准备', traceRunning = false, launchNumber = 0;
let pageGraphOpen = false;
const checks: { name: string; durationMs: number }[] = [], pageErrors: string[] = [], traces: string[] = [], processes: { pid?: number; exited: boolean }[] = [];
const evidence: Record<string, unknown> = { geometry: [], inlineRows: [], layouts: [], connections: [], wireEndpoints: [], parameterViews: [], history: [], baseline: [] };
const report: Record<string, unknown> = { status: 'running', mode: baseline ? 'baseline' : 'acceptance', renderer: 'compiled source editor', checks, pageErrors, traces, processes, evidence, temporaryPaths,
  limits: ['仅验证节点作者界面、真实接线和工程保存，不启动原生游戏。', '基线模式仅记录旧构建几何与截图，不判定新设计契约。', '无效类型 fixture 专用于检查修复与引脚保留。'] };
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const properties = () => pageGraphOpen && !baseline
  ? page!.locator('.ui-event-detail:visible').locator('.blueprint-properties')
  : page!.getByRole('complementary', { name: '蓝图属性', exact: true });
const card = (id: string) => page!.locator(`.react-flow__node[data-id="${id}"]`);
const nodeCard = (id: string) => card(id).locator('.blueprint-graph-node');
const slot = (id: string, pinId: string) => card(id).locator(`.blueprint-pin-slot[data-pin-id="${pinId}"]`);
const handle = (id: string, pinId: string) => card(id).locator(`.react-flow__handle[data-handleid="${pinId}"]`);
const settle = () => page!.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
function graph(value: Project, id = ids.graph) { const found = value.blueprints.find(item => item.id === id); assert.ok(found, 'Expected graph: ' + id); return found; }
function storedNode(value: Project, id: string, graphId = ids.graph) { const found = graph(value, graphId).nodes.find(node => node.id === id); assert.ok(found, 'Expected node: ' + id); return found; }
function withoutPositions(value: BlueprintGraph) { return { ...value, nodes: value.nodes.map(({ x: _x, y: _y, ...node }) => node) }; }
function pinName(id: string, pinId: string, graphId = ids.graph) { return storedNode(initial, id, graphId).pins.find(pin => pin.id === pinId)!.name; }
function valueLabel(id: string, pinId: string, graphId = ids.graph) {
  const node = storedNode(initial, id, graphId), row = blueprintUiPropertyRowForPin(node, pinId);
  const name = row && Object.hasOwn(uiProperties, row.property) ? uiProperties[row.property as UiProperty].name : pinName(id, pinId, graphId);
  return node.name + ' · ' + name;
}
async function fingerprints() {
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  const files = ['dist/index.html', 'dist-desktop/main.cjs', 'dist-desktop/preload.cjs', ...[...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => 'dist/' + match[1].slice(2))];
  assert.ok(files.some(file => file.startsWith('dist/assets/') && file.endsWith('.js')), 'A compiled source build is required before acceptance.');
  return Promise.all([...new Set(files)].map(async file => ({ file, sha256: hash(await fs.readFile(path.join(root, file))) })));
}
async function writeReport() { await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile }); processes.push({ pid: app.process().pid, exited: false }); launchNumber++;
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => pageErrors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; if (window.isMaximized()) window.unmaximize(); window.setContentSize(1600, 1000); window.webContents.setBackgroundThrottling(false); });
  await expect(page.locator('.project-title strong')).toHaveText(initial.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html')); report.rendererUrl = page.url();
  await page.evaluate('globalThis.__name = value => value');
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false }); traceRunning = true;
}
async function close() {
  if (!app) return;
  const owned = app, child = owned.process(), exited = () => child.exitCode !== null || child.signalCode !== null;
  let traceFailure: unknown;
  if (traceRunning && page) {
    const name = 'trace-' + String(launchNumber).padStart(2, '0') + '.zip';
    try { await page.context().tracing.stop({ path: path.join(output, name) }); traces.push(name); }
    catch (error) { traceFailure = error; report.traceError = String(error); }
    traceRunning = false;
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
async function check(name: string, work: () => Promise<void>) {
  phase = name; const start = Date.now(); await work(); checks.push({ name, durationMs: Date.now() - start }); await writeReport(); console.log('通过：' + name);
}
async function save() { await button('保存工程').click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); await settle(); return read(); }
async function saveUi() {
  if (await button('保存界面').isEnabled()) await button('保存界面').click();
  await expect(page!.locator('.ui-save-status')).toHaveText('已保存', { timeout: 30000 }); await expect(button('保存界面')).toBeDisabled(); return read();
}
async function openGraph(id = ids.graph) {
  await page!.locator('[data-workspace-tab="blueprint"]').click();
  pageGraphOpen = false;
  // The baseline may precede the resource-picker rename; use its actual label.
  let picker = page!.getByLabel('蓝图资源', { exact: true });
  if (!await picker.count()) picker = page!.getByLabel('演出目标', { exact: true });
  if (await picker.count()) await picker.selectOption('graph:' + id);
  else await page!.getByLabel('选择通用蓝图', { exact: true }).selectOption(id);
  if (!await properties().isVisible()) await button('展开蓝图属性').click();
  if (!baseline) await setBlueprintOption(page!, '自动接线', false);
  await fitBlueprintCanvas(page!); await settle();
}
async function openPageGraph() {
  await page!.locator('[data-workspace-tab="ui"]').click();
  await page!.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '事件图', exact: true }).click();
  await page!.getByLabel('事件图页面', { exact: true }).selectOption(ids.page);
  await page!.getByLabel('当前页面事件图', { exact: true }).selectOption(ids.pageGraph);
  pageGraphOpen = true;
  if (!baseline) await setBlueprintOption(page!, '自动接线', false);
  await fitBlueprintCanvas(page!); await settle();
}
async function select(id: string, focus = false) {
  await fitBlueprintCanvas(page!); await card(id).locator('.graph-node-title strong').click();
  if (pageGraphOpen && !baseline) {
    await expect(page!.locator('.ui-event-detail:visible')).toHaveAttribute('data-detail-id', `node:${ids.pageGraph}:${id}`);
    await expect(properties()).toBeVisible();
  } else await properties().locator('.blueprint-property-tabs').getByRole('button', { name: '节点参数', exact: true }).click();
  await expect(card(id)).toHaveClass(/selected/);
  if (focus) {
    await button('定位选中节点').click();
    await expect.poll(() => page!.evaluate(async ({ id, baseline }) => {
      const viewport = document.querySelector('.react-flow__viewport'), node = document.querySelector(`.react-flow__node[data-id="${id}"]`), pane = document.querySelector('.flow-container');
      if (!viewport || !node || !pane) return false;
      const transform = getComputedStyle(viewport).transform, matrix = new DOMMatrixReadOnly(transform);
      if (!baseline && matrix.a < .64) return false;
      for (let frame = 0; frame < 4; frame++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (getComputedStyle(viewport).transform !== transform) return false;
      }
      const box = node.getBoundingClientRect(), bounds = pane.getBoundingClientRect();
      return baseline || box.left >= bounds.left - 1 && box.right <= bounds.right + 1 && box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1;
    }, { id, baseline })).toBe(true);
  }
  await settle();
}
async function fill(control: Locator, value: string) { await expect(control).toHaveCount(1); await openDisclosureAncestors(control); await control.fill(value); await control.press('Tab'); await settle(); }
async function theme(name: '黑白' | '亮白', id: 'codexDark' | 'codexLight') {
  await button('作品设置').click(); const dialog = page!.getByRole('dialog', { name: '作品设置', exact: true });
  await dialog.getByRole('button', { name: '编辑器外观', exact: true }).click();
  await dialog.getByRole('group', { name: '编辑器配色', exact: true }).getByRole('button', { name: new RegExp('^' + name) }).click();
  await expect(page!.locator('html')).toHaveAttribute('data-editor-theme', id); await dialog.getByRole('button', { name: '完成', exact: true }).click(); await settle();
}
async function geometry(description: string) {
  const value = await page!.locator('.react-flow__node').evaluateAll(elements => elements.map(element => {
    const node = element.querySelector<HTMLElement>('.blueprint-graph-node')!, title = element.querySelector<HTMLElement>('.graph-node-title')!;
    const box = element.getBoundingClientRect(), style = getComputedStyle(node), heading = getComputedStyle(title);
    return { id: element.getAttribute('data-id'), classes: node.className, width: node.offsetWidth, height: node.offsetHeight, titleHeight: title.offsetHeight,
      screen: { x: box.x, y: box.y, width: box.width, height: box.height }, titleColor: heading.color, titleBackground: heading.backgroundColor,
      borderTop: style.borderTopColor, handles: [...element.querySelectorAll('.react-flow__handle')].map(pin => pin.getAttribute('data-handleid')),
      visibleInputs: [...element.querySelectorAll<HTMLElement>('input,select')].filter(input => input.getClientRects().length).map(input => input.getAttribute('aria-label')) };
  }));
  (evidence.geometry as unknown[]).push({ description, nodes: value }); return value;
}
async function assertLeft(description: string) {
  const inspector = await properties().boundingBox(), canvas = await page!.locator('.flow-container').boundingBox(); assert.ok(inspector); assert.ok(canvas);
  assert.ok(inspector.x + inspector.width <= canvas.x + 2, description + ': detailed configuration is to the left of the canvas.');
  (evidence.layouts as unknown[]).push({ description, inspector, canvas });
}
async function assertNoOverflow(owner: Locator, description: string) {
  const value = await owner.evaluate(element => {
    const box = element.getBoundingClientRect(); const controls = [...element.querySelectorAll<HTMLElement>('input,select,button,textarea')].filter(control => control.getClientRects().length).map(control => {
      const rect = control.getBoundingClientRect(); return { label: control.getAttribute('aria-label') ?? control.textContent?.trim(), left: rect.left, right: rect.right, width: rect.width };
    });
    const scale = box.width / (element as HTMLElement).offsetWidth;
    const pinExtent = Math.max(0, ...[...element.querySelectorAll<HTMLElement>('.react-flow__handle')].map(pin => {
      const rect = pin.getBoundingClientRect(), hit = getComputedStyle(pin, '::after');
      // The shared handle has a transparent 7px hit area. Its overflow counts
      // toward scrollWidth despite painting nothing outside the handle.
      const hitRight = hit.content === 'none' ? 0 : Math.max(0, -(parseFloat(hit.right) || 0));
      return (rect.right - box.right) / scale + hitRight;
    }));
    return { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, left: box.left, right: box.right, pinExtent, controls };
  });
  // Derive the only allowed overflow from the measured connection hit target;
  // every actual form control still has to fit strictly inside the card.
  assert.ok(value.scrollWidth <= value.clientWidth + Math.ceil(value.pinExtent) + 2, description + ': horizontal overflow ' + JSON.stringify(value));
  assert.deepEqual(value.controls.filter(control => control.width > 0 && (control.left < value.left - 2 || control.right > value.right + 2)), [], description);
  assert.equal(await page!.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  (evidence.layouts as unknown[]).push({ description, ...value });
}
async function sameRow(pin: Locator, description: string, source = false) {
  const label = await pin.locator('.blueprint-pin-label').boundingBox();
  const control = await pin.locator(source ? '.blueprint-pin-source' : 'input:not([type="hidden"]), select').first().boundingBox();
  assert.ok(label); assert.ok(control); assert.ok(Math.max(label.y, control.y) < Math.min(label.y + label.height, control.y + control.height), description + ': pin label and value/source share a row.');
  (evidence.inlineRows as unknown[]).push({ description, label, control });
}
async function assertPins(node: BlueprintNode, hidden: readonly string[] = []) {
  const expected = node.pins.filter(pin => !hidden.includes(pin.id));
  assert.deepEqual((await card(node.id).locator('.react-flow__handle').evaluateAll(handles => handles.map(pin => pin.getAttribute('data-handleid')))).sort(), expected.map(pin => pin.id).sort());
  for (const pin of expected) {
    await expect(slot(node.id, pin.id)).toHaveAttribute('data-pin-direction', pin.direction); await expect(slot(node.id, pin.id)).toHaveAttribute('data-pin-type', pin.dataType);
    await expect(handle(node.id, pin.id)).toHaveAttribute('aria-label', `${node.name} · ${pin.name} · ${pin.direction === 'input' ? '输入' : '输出'}`);
    const getter = ['getVariable', 'getInput', 'getPlayerPreference', 'getMinigameValue'].includes(node.type)
      && !node.pins.some(pin => pin.direction === 'input') && node.pins.filter(pin => pin.direction === 'output').length === 1;
    const section = getter ? '.blueprint-getter-row' : pin.dataType === 'exec' ? '.blueprint-execution-pins > .blueprint-execution-row' : `.blueprint-data-pins > .blueprint-pin-column.${pin.direction}`;
    await expect(card(node.id).locator(section).locator(`[data-pin-id="${pin.id}"]`)).toHaveCount(1);
  }
}
async function more(id: string, expanded: boolean) {
  const toggle = card(id).getByRole('button', { name: expanded ? '展开更多参数' : '收起更多参数', exact: true });
  await toggle.click(); await expect(card(id).getByRole('button', { name: expanded ? '收起更多参数' : '展开更多参数', exact: true })).toHaveAttribute('aria-expanded', String(expanded)); await settle();
}
async function collapse(id: string, collapsed: boolean) {
  await card(id).getByRole('button', { name: collapsed ? '收起节点参数' : '展开节点参数', exact: true }).click();
  await expect(card(id).getByRole('button', { name: collapsed ? '展开节点参数' : '收起节点参数', exact: true })).toHaveAttribute('aria-expanded', String(!collapsed)); await settle();
}
async function connect(from: string, fromPin: string, to: string, toPin: string, description: string) {
  await fitBlueprintCanvas(page!); await expect(handle(from, fromPin)).toBeVisible(); await expect(handle(to, toPin)).toBeVisible();
  await page!.evaluate(() => {
    const samples: { nodeId: string | null; pinId: string | null; trusted: boolean; button: number }[] = [];
    (window as unknown as { __nodeDesignPointerEvidence: unknown }).__nodeDesignPointerEvidence = samples;
    document.addEventListener('pointerdown', function record(event) {
      const pin = (event.target as Element).closest('.react-flow__handle'); if (!pin) return;
      samples.push({ nodeId: pin.closest('.react-flow__node')?.getAttribute('data-id') ?? null, pinId: pin.getAttribute('data-handleid'), trusted: event.isTrusted, button: event.button });
      if (samples.length === 2) document.removeEventListener('pointerdown', record, true);
    }, true);
  });
  await handle(from, fromPin).click(); await handle(to, toPin).click(); await settle();
  const samples = await page!.evaluate(() => (window as unknown as { __nodeDesignPointerEvidence: { nodeId: string; pinId: string; trusted: boolean; button: number }[] }).__nodeDesignPointerEvidence);
  assert.equal(samples.length, 2); assert.ok(samples.every(sample => sample.trusted && sample.button === 0));
  assert.deepEqual(samples.map(sample => [sample.nodeId, sample.pinId]), [[from, fromPin], [to, toPin]]);
  (evidence.connections as unknown[]).push({ description, samples });
}
async function wirePoint(id: string, fraction: number) {
  return page!.locator(`.react-flow__edge[data-id="${id}"] .react-flow__edge-path`).evaluate((element, fraction) => {
    const curve = element as SVGPathElement, matrix = curve.getScreenCTM(); if (!matrix) throw new Error('Wire has no screen transform.');
    const point = curve.getPointAtLength(curve.getTotalLength() * fraction), screen = new DOMPoint(point.x, point.y).matrixTransform(matrix); return { x: screen.x, y: screen.y };
  }, fraction);
}
async function assertWire(id: string, from: string, fromPin: string, to: string, toPin: string, description: string) {
  await expect.poll(async () => {
    const start = await wirePoint(id, 0), end = await wirePoint(id, 1), source = await handle(from, fromPin).boundingBox(), target = await handle(to, toPin).boundingBox();
    if (!source || !target) return Infinity;
    return Math.max(Math.hypot(start.x - source.x - source.width, start.y - source.y - source.height / 2), Math.hypot(end.x - target.x, end.y - target.y - target.height / 2));
  }, { message: description + ': resized nodes refresh both wire endpoints.' }).toBeLessThan(2);
  (evidence.wireEndpoints as unknown[]).push({ description, id, start: await wirePoint(id, 0), end: await wirePoint(id, 1), source: await handle(from, fromPin).boundingBox(), target: await handle(to, toPin).boundingBox(), tolerancePx: 2 });
}
async function undoRedo(before: BlueprintGraph, after: BlueprintGraph, description: string, graphId = ids.graph) {
  await button('撤销').click(); assert.deepEqual(graph(await save(), graphId), before, description + ': one undo restores the prior graph.');
  await button('重做').click(); assert.deepEqual(graph(await save(), graphId), after, description + ': one redo restores the edit.');
  (evidence.history as unknown[]).push({ description, atomic: true });
}
async function inspectorField(labels: readonly string[]) {
  for (const label of labels) { const control = properties().getByLabel(label, { exact: true }); if (await control.count()) { await expect(control).toHaveCount(1); return control; } }
  throw new Error('Inspector field missing: ' + labels.join(' / '));
}
async function baselineChecks() {
  const before = await read();
  await check('旧编译构建普通蓝图双主题几何与截图', async () => {
    for (const [name, id] of [['黑白', 'codexDark'], ['亮白', 'codexLight']] as const) {
      await theme(name, id); await openGraph(); await geometry('baseline-normal-' + id); await screenshot('baseline-normal-' + id);
      await select(ids.actor, true); await screenshot('baseline-actor-' + id); await select(ids.math, true); await screenshot('baseline-math-' + id);
    }
  });
  await check('旧编译构建高级边界与页面事件图记录', async () => {
    await openGraph(ids.advanced); await geometry('baseline-advanced'); await screenshot('baseline-advanced');
    await openPageGraph(); await geometry('baseline-page'); await screenshot('baseline-page');
  });
  await check('旧编译构建窄窗口记录且不改工程数据', async () => {
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1180, 850));
    await openGraph(); await select(ids.actor, true); await geometry('baseline-narrow'); await screenshot('baseline-narrow');
    assert.deepEqual(await read(), before); await fs.copyFile(projectFile, path.join(output, 'baseline-project.json'));
  });
}
let savedBeforeReopen: Project | undefined, retainedMore = false;
try {
  await fs.mkdir(path.dirname(projectFile), { recursive: true }); report.fingerprintsBefore = await fingerprints();
  await fs.writeFile(path.join(output, 'temporary-artifacts.json'), JSON.stringify({ owner: 'verify-blueprint-node-design-editor', run: output, paths: temporaryPaths, cleanup: 'Only after the owned Electron process exits.' }, null, 2));
  await Promise.all([
    fs.writeFile(path.join(path.dirname(projectFile), 'portrait.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="300"><rect width="180" height="300" fill="#bb6575"/><circle cx="90" cy="65" r="42" fill="#f1c6b2"/></svg>'),
    fs.writeFile(path.join(path.dirname(projectFile), 'background.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#466776"/></svg>'),
  ]);
  await saveProject(projectFile, initial); await fs.copyFile(projectFile, path.join(output, 'input-project.json')); await launch();
  if (baseline) await baselineChecks();
  else {
    await check('编译源码隔离启动、默认紧凑尺寸与左侧详细配置', async () => {
      await openGraph(); await assertLeft('普通蓝图'); const measured = await geometry('normal-default');
      for (const node of measured) {
        assert.equal(node.titleHeight, 32, String(node.id) + ': compact heading is 32px.'); assert.ok(node.width <= 280, String(node.id) + ': card max width is 280px.');
        if ([ids.event, ids.finish].includes(String(node.id))) assert.equal(node.width, 224);
        else if ([ids.literal, ids.round, ids.math, ids.compare].includes(String(node.id))) assert.equal(node.width, 232);
        else if (node.id !== ids.getter) assert.equal(node.width, 264);
      }
      await expect(nodeCard(ids.event)).toHaveClass(/blueprint-family-event/); await expect(nodeCard(ids.math)).toHaveClass(/blueprint-family-value/);
      await expect(nodeCard(ids.call)).toHaveClass(/blueprint-family-module/); await expect(nodeCard(ids.actor)).toHaveClass(/blueprint-family-action/); await screenshot('01-normal-default');
    });
    await check('执行独立分区、数据独立列及稳定有类型端口', async () => {
      for (const node of graph(initial).nodes) await assertPins(node, node.id === ids.actor ? actorAdvanced : []);
      await expect(card(ids.math).locator('.blueprint-execution-pins')).toHaveCount(0);
      await expect(card(ids.branch).locator('.blueprint-execution-row')).toHaveCount(2);
      await expect(card(ids.actor).getByRole('button', { name: '展开更多参数', exact: true })).toContainText('更多参数 6');
    });
    await check('常用值与来源同行、复杂卡片不重复完整设置', async () => {
      await sameRow(slot(ids.delay, 'seconds'), '等待秒数'); await sameRow(slot(ids.math, 'b'), '计算操作数'); await sameRow(slot(ids.actor, 'wait'), '角色等待开关');
      await sameRow(slot(ids.math, 'a'), '已连接来源', true);
      await expect(card(ids.call).getByLabel(storedNode(initial, ids.call).name + ' · 调用蓝图', { exact: true })).toHaveCount(0);
      await expect(card(ids.actor).locator('.actor-transition-fields')).toHaveCount(0);
      for (const node of graph(initial).nodes) await assertNoOverflow(nodeCard(node.id), '默认卡片-' + node.id);
      await expect(card(ids.math).getByLabel(storedNode(initial, ids.math).name + ' · 运算', { exact: true })).toBeVisible();
      await expect(card(ids.compare).getByLabel(storedNode(initial, ids.compare).name + ' · 比较', { exact: true })).toBeVisible();
    });
    await check('固定值类型与零、false、空文字保留且可撤销', async () => {
      await select(ids.literal); const before = graph(await save());
      const type = properties().getByLabel('固定值类型', { exact: true }); await type.selectOption('boolean');
      await expect(card(ids.literal).getByLabel(storedNode(initial, ids.literal).name + ' · 值', { exact: true })).toHaveValue('false');
      let saved = await save(); assert.equal(storedNode(saved, ids.literal).properties.value, false); assert.equal(storedNode(saved, ids.literal).pins[0].dataType, 'boolean');
      await button('撤销').click(); assert.deepEqual(graph(await save()), before);
      await type.selectOption('string'); await expect(card(ids.literal).getByLabel(storedNode(initial, ids.literal).name + ' · 值', { exact: true })).toHaveValue('');
      saved = await save(); assert.equal(storedNode(saved, ids.literal).properties.value, ''); assert.equal(storedNode(saved, ids.literal).pins[0].dataType, 'string');
      await button('撤销').click(); assert.deepEqual(graph(await save()), before); await expect(properties().getByLabel('固定值', { exact: true })).toHaveValue('0');
    });
    await check('数值卡片编辑同步左侧并形成一次撤销重做', async () => {
      await select(ids.round); const before = graph(await save());
      await fill(card(ids.round).getByLabel(valueLabel(ids.round, 'value'), { exact: true }), '-2.5');
      await expect(properties().getByLabel('数值', { exact: true })).toHaveValue('-2.5'); const after = graph(await save()); await undoRedo(before, after, '数值内联编辑');
      const modeBefore = graph(await read()); await properties().getByLabel(storedNode(initial, ids.round).name + ' · 取整方式', { exact: true }).selectOption('floor');
      await expect(card(ids.round).getByLabel(storedNode(initial, ids.round).name + ' · 取整方式', { exact: true })).toHaveValue('floor'); await undoRedo(modeBefore, graph(await save()), '左侧取整设置');
    });
    await check('复杂参数集中左侧且遗漏时长和等待可编辑', async () => {
      await fitBlueprintCanvas(page!); await card(ids.actor).getByRole('button', { name: '编辑节点参数', exact: true }).focus();
      await card(ids.actor).getByRole('button', { name: '编辑节点参数', exact: true }).press('Enter'); await expect(card(ids.actor)).toHaveClass(/selected/);
      await expect(properties().getByLabel('角色', { exact: true })).toHaveValue('design_actor'); await expect(properties().getByLabel('表情', { exact: true })).toHaveValue('design_expression');
      for (const name of ['第几个', '显示范围', '站位预设', '横向位置', '纵向位置', '角色大小', '前后层级']) await expect(properties().getByLabel(name, { exact: true })).toHaveCount(1);
      const duration = await inspectorField(['节点时长（秒）', '时长', valueLabel(ids.actor, 'duration')]), wait = await inspectorField(['等待完成', valueLabel(ids.actor, 'wait')]);
      await expect(wait).toHaveValue('true'); const before = graph(await save()); await fill(duration, '0');
      await expect(card(ids.actor).getByLabel(valueLabel(ids.actor, 'duration'), { exact: true })).toHaveValue('0'); await undoRedo(before, graph(await save()), '角色时长零值');
      await expect(properties().locator('.actor-transition-fields')).toHaveCount(1); await screenshot('06-actor-left-details');
    });
    await check('读取节点单行显示实际对象并由左侧配置', async () => {
      await select(ids.getter); await expect(nodeCard(ids.getter)).toHaveClass(/blueprint-getter-node/);
      await expect(card(ids.getter).locator('.blueprint-getter-row strong')).toHaveText('读取的数值参数');
      await expect(card(ids.getter).locator('input,select')).toHaveCount(0); await expect(handle(ids.getter, 'value')).toHaveCount(1);
      await expect(properties().getByLabel('输入参数', { exact: true })).toHaveValue('design_amount'); await screenshot('07-getter');
    });
    await check('调用节点接口内联、详细调用选择与真实双击导航', async () => {
      await select(ids.call); await expect(properties().getByLabel('调用蓝图', { exact: true })).toHaveValue(ids.callee);
      await expect(card(ids.call).locator('.graph-node-detail')).toContainText('紧凑节点被调用流程');
      await expect(card(ids.call).getByLabel(valueLabel(ids.call, 'arg_design_call_enabled'), { exact: true })).toHaveValue('false');
      const before = graph(await save()); await fill(card(ids.call).getByLabel(valueLabel(ids.call, 'arg_design_call_amount'), { exact: true }), '7');
      await expect(properties().getByLabel('传入数值', { exact: true })).toHaveValue('7'); await undoRedo(before, graph(await save()), '调用实参数值');
      await fitBlueprintCanvas(page!); await card(ids.call).locator('.graph-node-title strong').dblclick(); await expect(card('design_callee_event')).toBeVisible();
      await openGraph(); await expect(card(ids.call).getByLabel(valueLabel(ids.call, 'arg_design_call_amount'), { exact: true })).toHaveValue('7');
    });
    await check('高级参数按零值、false、空文字、必填与未知端口保守显露', async () => {
      await openGraph(ids.advanced);
      await assertPins(storedNode(initial, ids.changed, ids.advanced), ['y', 'scale', 'layer']);
      await expect(card(ids.changed).getByLabel(valueLabel(ids.changed, 'x', ids.advanced), { exact: true })).toHaveValue('0');
      await expect(card(ids.changed).getByLabel(valueLabel(ids.changed, 'useDefaultFraming', ids.advanced), { exact: true })).toHaveValue('false');
      await expect(handle(ids.changed, 'instanceId')).toBeVisible();
      await assertPins(storedNode(initial, ids.chapter, ids.advanced));
      await assertPins(storedNode(initial, ids.camera, ids.advanced), ['rotation']); await expect(handle(ids.camera, 'legacy_gain')).toBeVisible();
      await assertPins(storedNode(initial, ids.required, ids.advanced)); await assertPins(storedNode(initial, ids.connected, ids.advanced));
      await expect(card(ids.chapter).getByLabel(valueLabel(ids.chapter, 'effect', ids.advanced), { exact: true })).toHaveValue('');
      await geometry('advanced-boundaries'); await screenshot('09-advanced-boundaries');
    });
    await check('无效类型有诊断且默认参数仍保留，修复可以完整撤销', async () => {
      await assertPins(storedNode(initial, ids.invalid, ids.advanced)); await expect(nodeCard(ids.invalid)).toHaveClass(/invalid/);
      await select(ids.invalid); await expect(properties().locator('.blueprint-node-problems')).toContainText('层级需要有效的数值');
      const before = graph(await save(), ids.advanced); await fill(properties().getByLabel('前后层级', { exact: true }), '10');
      await expect(nodeCard(ids.invalid)).not.toHaveClass(/invalid/); await expect(handle(ids.invalid, 'layer')).toHaveCount(0);
      const after = graph(await save(), ids.advanced); await undoRedo(before, after, '无效层级修复', ids.advanced); await button('撤销').click(); await save();
    });
    await check('更多参数按需展开且只改变视图、端口完整及缩回', async () => {
      await openGraph(); const before = graph(await save()); await select(ids.actor, true);
      const compactHeight = await nodeCard(ids.actor).evaluate(element => (element as HTMLElement).offsetHeight);
      await more(ids.actor, true); await assertPins(storedNode(initial, ids.actor));
      assert.ok(await nodeCard(ids.actor).evaluate(element => (element as HTMLElement).offsetHeight) > compactHeight); await screenshot('11-more-parameters');
      await more(ids.actor, false); await assertPins(storedNode(initial, ids.actor), actorAdvanced); assert.deepEqual(graph(await save()), before);
      (evidence.parameterViews as unknown[]).push({ description: '更多参数展开和缩回', dataUnchanged: true, compactHeight });
    });
    await check('左侧高级零值修改自动显露，撤销恢复隐藏默认值', async () => {
      await select(ids.actor); const before = graph(await save()); await fill(properties().getByLabel('横向位置', { exact: true }), '0');
      await expect(handle(ids.actor, 'x')).toBeVisible(); await expect(card(ids.actor).getByLabel(valueLabel(ids.actor, 'x'), { exact: true })).toHaveValue('0');
      const after = graph(await save()); await undoRedo(before, after, '高级坐标零值'); await button('撤销').click(); assert.deepEqual(graph(await save()), before); await expect(handle(ids.actor, 'x')).toHaveCount(0);
    });
    await check('真实执行与数据接线，不兼容连接不替换有效连线', async () => {
      await connect(ids.delay, 'exec_out', ids.branch, 'exec_in', '等待到分支执行'); await connect(ids.branch, 'true', ids.actor, 'exec_in', '分支到显示角色执行');
      await connect(ids.actor, 'exec_out', ids.finish, 'exec_in', '角色完成到返回执行'); await connect(ids.literal, 'value', ids.math, 'b', '数值到计算操作数');
      await connect(ids.compare, 'result', ids.branch, 'condition', '比较到分支条件'); let saved = await save();
      assert.equal(graph(saved).links.length, 7); const before = graph(saved);
      await connect(ids.compare, 'result', ids.math, 'b', '开关到数值拒绝'); saved = await save(); assert.deepEqual(graph(saved), before);
      for (const [from, fromPin, to, toPin] of [[ids.delay, 'exec_out', ids.branch, 'exec_in'], [ids.literal, 'value', ids.math, 'b'], [ids.compare, 'result', ids.branch, 'condition']]) {
        assert.ok(graph(saved).links.some(link => link.fromNodeId === from && link.fromPinId === fromPin && link.toNodeId === to && link.toPinId === toPin));
      }
    });
    await check('来源同行可定位，参数折叠后连线端点刷新且不改数据', async () => {
      await fitBlueprintCanvas(page!); const before = graph(await save()), dataLink = before.links.find(link => link.toNodeId === ids.math && link.toPinId === 'b')!;
      await sameRow(slot(ids.math, 'b'), '数值连线来源', true); await slot(ids.math, 'b').getByRole('button', { name: /^定位第二个数来源：/ }).click(); await expect(card(ids.literal)).toHaveClass(/selected/);
      await fitBlueprintCanvas(page!); await assertWire(dataLink.id, ids.literal, 'value', ids.math, 'b', '默认数据端点');
      const handles = await card(ids.math).locator('.react-flow__handle').count(); await collapse(ids.math, true);
      await expect(card(ids.math).locator('input,select')).toHaveCount(0); assert.equal(await card(ids.math).locator('.react-flow__handle').count(), handles);
      await assertWire(dataLink.id, ids.literal, 'value', ids.math, 'b', '折叠数据端点'); await collapse(ids.math, false);
      await assertWire(dataLink.id, ids.literal, 'value', ids.math, 'b', '恢复数据端点'); assert.deepEqual(graph(await save()), before);
    });
    await check('隐藏高级引脚真实接线后常显，断开隐藏且撤销恢复', async () => {
      await more(ids.actor, true); await connect(ids.literal, 'value', ids.actor, 'x', '更多参数坐标接线'); await more(ids.actor, false);
      await expect(handle(ids.actor, 'x')).toBeVisible(); let saved = await save(); const linked = graph(saved), link = linked.links.find(link => link.toNodeId === ids.actor && link.toPinId === 'x')!; assert.ok(link);
      await fitBlueprintCanvas(page!); await assertWire(link.id, ids.literal, 'value', ids.actor, 'x', '高级连接缩回仍正确');
      await select(ids.actor); await properties().getByRole('button', { name: '断开横向位置的数据线', exact: true }).click(); await expect(handle(ids.actor, 'x')).toHaveCount(0);
      saved = await save(); assert.ok(!graph(saved).links.some(item => item.id === link.id)); await button('撤销').click(); assert.deepEqual(graph(await save()), linked);
      await expect(handle(ids.actor, 'x')).toBeVisible(); await fitBlueprintCanvas(page!); await assertWire(link.id, ids.literal, 'value', ids.actor, 'x', '断开撤销高级端点');
    });
    await check('全部参数收起与展开只改视图，当前可见端口始终保留', async () => {
      const before = graph(await save()), handles = await page!.locator('.react-flow__handle').count();
      await button('收起全部节点参数').click(); await expect(page!.locator('.blueprint-graph-node:not(.parameters-collapsed)')).toHaveCount(0);
      await expect(page!.locator('.react-flow__node input,.react-flow__node select')).toHaveCount(0); assert.equal(await page!.locator('.react-flow__handle').count(), handles);
      await openGraph(ids.callee); await openGraph(); await expect(page!.locator('.blueprint-graph-node:not(.parameters-collapsed)')).toHaveCount(0); await screenshot('16-all-parameters-collapsed');
      await button('展开全部节点参数').click(); await expect(card(ids.round).getByLabel(valueLabel(ids.round, 'value'), { exact: true })).toHaveValue('-2.5');
      assert.equal(await page!.locator('.react-flow__handle').count(), handles); assert.deepEqual(graph(await save()), before);
    });
    await check('暗亮主题与窄窗口维持紧凑卡片、左侧配置及无水平溢出', async () => {
      const before = await save();
      for (const [name, id] of [['黑白', 'codexDark'], ['亮白', 'codexLight']] as const) {
        await theme(name, id); await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000)); await fitBlueprintCanvas(page!);
        await geometry('normal-' + id); await screenshot('17-normal-' + id); await assertLeft('普通蓝图-' + id);
        await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1180, 850)); await select(ids.actor, true);
        await assertNoOverflow(properties(), '窄左属性-' + id); await assertNoOverflow(nodeCard(ids.actor), '窄角色卡片-' + id); await screenshot('17-narrow-actor-' + id);
        await select(ids.math, true); await sameRow(slot(ids.math, 'a'), '窄来源-' + id, true); await assertNoOverflow(nodeCard(ids.math), '窄计算卡片-' + id); await screenshot('17-narrow-math-' + id);
      }
      assert.deepEqual(await save(), before); await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000));
    });
    await check('自动排列使用卡片实测尺寸、不重叠且位置一次撤销重做', async () => {
      await fitBlueprintCanvas(page!); const before = graph(await save()); await button('自动排列蓝图').click(); await expect(button('自动排列蓝图')).toBeEnabled({ timeout: 30000 });
      const after = graph(await save()); assert.notDeepEqual(after.nodes.map(({ id, x, y }) => ({ id, x, y })), before.nodes.map(({ id, x, y }) => ({ id, x, y })));
      assert.deepEqual(withoutPositions(after), withoutPositions(before)); await fitBlueprintCanvas(page!); const measured = await geometry('auto-arranged');
      for (let index = 0; index < measured.length; index++) for (const other of measured.slice(index + 1)) {
        const box = measured[index].screen, next = other.screen;
        assert.ok(box.x + box.width <= next.x + 1 || next.x + next.width <= box.x + 1 || box.y + box.height <= next.y + 1 || next.y + next.height <= box.y + 1, `Arranged nodes overlap: ${measured[index].id}/${other.id}`);
      }
      await screenshot('18-auto-arranged'); await undoRedo(before, after, '自动排列');
    });
    await check('页面事件图共用紧凑设计、真实接线与内联文字保存前留在草稿', async () => {
      await openPageGraph(); await assertLeft('页面事件图'); const before = await read(), pageBefore = graph(before, ids.pageGraph);
      for (const node of pageBefore.nodes) await assertPins(node); await select(ids.pageProperty);
      await expect(card(ids.pageProperty).getByLabel(storedNode(initial, ids.pageProperty, ids.pageGraph).name + ' · 第1项属性', { exact: true })).toHaveValue('text');
      const label = valueLabel(ids.pageProperty, 'value', ids.pageGraph); await fill(card(ids.pageProperty).getByLabel(label, { exact: true }), '页面内联新文字');
      await expect(properties().getByLabel(label, { exact: true })).toHaveValue('页面内联新文字'); assert.deepEqual(graph(await read(), ids.pageGraph), pageBefore);
      await connect(ids.pageClick, 'exec', ids.pageProperty, 'exec_in', '页面点击执行'); await connect(ids.pageProperty, 'exec_out', ids.pageOutput, 'exec_in', '页面属性到返回执行');
      await connect(ids.pageInput, 'value', ids.pageOutput, 'value', '页面输入到结果数据'); assert.deepEqual(await read(), before);
      const saved = await saveUi(), pageAfter = graph(saved, ids.pageGraph); assert.equal(storedNode(saved, ids.pageProperty, ids.pageGraph).properties.value, '页面内联新文字'); assert.equal(pageAfter.links.length, 3);
      await fitBlueprintCanvas(page!); const data = pageAfter.links.find(link => link.toPinId === 'value')!;
      await assertWire(data.id, ids.pageInput, 'value', ids.pageOutput, 'value', '页面数据端点'); await sameRow(slot(ids.pageOutput, 'value'), '页面参数来源', true);
      await select(ids.pageProperty, true); await assertNoOverflow(nodeCard(ids.pageProperty), '页面卡片'); await screenshot('19-page-left-details');
      await geometry('page-design'); await screenshot('19-page-overview'); assert.deepEqual(graph(saved), graph(before));
      for (const [name, id] of [['黑白', 'codexDark'], ['亮白', 'codexLight']] as const) {
        await theme(name, id); await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1180, 850));
        await fitBlueprintCanvas(page!); await assertLeft('窄页面事件图-' + id); await select(ids.pageProperty, true);
        await assertNoOverflow(properties(), '窄页面左属性-' + id); await assertNoOverflow(nodeCard(ids.pageProperty), '窄页面卡片-' + id);
        await screenshot('19-page-narrow-' + id); await geometry('page-narrow-' + id);
      }
      assert.deepEqual(await read(), saved); await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000));
    });
    await check('保存重开保留更多参数和折叠偏好、引脚身份、连线与精确值', async () => {
      await openGraph(); await more(ids.actor, true); retainedMore = true; await collapse(ids.math, true); savedBeforeReopen = await save();
      await fs.copyFile(projectFile, path.join(output, 'saved-project.json')); await close(); await launch(); await openGraph();
      assert.deepEqual(await read(), savedBeforeReopen); await expect(card(ids.actor).getByRole('button', { name: '收起更多参数', exact: true })).toHaveAttribute('aria-expanded', String(retainedMore));
      await assertPins(storedNode(savedBeforeReopen, ids.actor)); await expect(card(ids.math).getByRole('button', { name: '展开节点参数', exact: true })).toHaveAttribute('aria-expanded', 'false');
      await expect(card(ids.math).locator('input,select')).toHaveCount(0); await collapse(ids.math, false); await expect(card(ids.round).getByLabel(valueLabel(ids.round, 'value'), { exact: true })).toHaveValue('-2.5');
      await expect(card(ids.round).getByLabel(storedNode(initial, ids.round).name + ' · 取整方式', { exact: true })).toHaveValue('floor'); await screenshot('20-reopened-normal');
      await openPageGraph(); await expect(card(ids.pageProperty).getByLabel(valueLabel(ids.pageProperty, 'value', ids.pageGraph), { exact: true })).toHaveValue('页面内联新文字');
      await expect(button('保存界面')).toBeDisabled(); assert.deepEqual(await read(), savedBeforeReopen); await screenshot('20-reopened-page');
    });
    assert.equal(checks.length, 20);
  }
  assert.deepEqual(pageErrors, []); report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = String(error);
  if (app && page) await screenshot('failure').catch(error => { report.screenshotError = String(error); });
} finally {
  await close().catch(error => { failure ??= error; report.status = 'failed'; report.closeError = String(error); });
  try { report.fingerprintsAfter = await fingerprints(); assert.deepEqual(report.fingerprintsAfter, report.fingerprintsBefore); }
  catch (error) { failure ??= error; report.status = 'failed'; report.buildIntegrityError = String(error); }
  await fs.mkdir(output, { recursive: true }); await writeReport();
  if (!app && processes.every(item => item.exited)) {
    try {
      const cleanup = await cleanVerificationDirectories(output, ['fixture', 'profile']); report.cleanup = cleanup; assert.deepEqual(cleanup.errors, []);
      await Promise.all(cleanup.removed.map(async target => { await assert.rejects(fs.stat(target), { code: 'ENOENT' }); }));
    } catch (error) { failure ??= error; report.status = 'failed'; report.cleanupError = String(error); }
  } else { failure ??= new Error('An owned node-design acceptance process did not exit.'); report.status = 'failed'; report.cleanupSkipped = 'Owned process still present'; }
  await writeReport(); console.log(output);
}
if (failure) throw failure;
