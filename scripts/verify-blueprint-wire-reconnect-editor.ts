import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type CDPSession, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createProject, newNode, projectSchema, type BlueprintGraph, type BlueprintLink, type BlueprintNode, type Project } from '../src/core/model';
import { createUiEventGraph } from '../src/core/ui-logic';
import { storySceneNodeId } from '../src/core/story-groups';
import { gameFlowCanvasEdges } from '../src/renderer/game-flow-view';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas, setBlueprintOption } from './lib/blueprint-canvas';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Author every feature first and build once before running this script. All
// product input below uses real Playwright mouse/keyboard events at visible pins.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Use the isolated compiled source editor.');
assert.deepEqual(process.argv.slice(2), []);
const root = path.resolve('.');
const output = path.resolve('artifacts/blueprint-property-batch-2026-11-12', 'wires-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const projectFile = path.join(output, 'project/project.vns.json'), profile = path.join(output, 'profile');
const pageId = 'wire_page', normalId = 'wire_graph', pageGraphId = 'wire_page_graph';
type Point = { x: number; y: number };
type ReleaseRecord = { phase: string; eventType: string; trusted: boolean; connectionPaths: number; focused: boolean; button?: number; buttons?: number };
type FocusEvidence = { phase: string; nativeFocused: boolean; rendererFocused: boolean };
function fixture() {
  const project = createProject('连接点改接桌面验收'); project.id = 'wire_reconnect_acceptance';
  project.ui.customPages = [{ id: pageId, name: '连线验收页面', modal: true, components: [
    { id: 'wire_button', name: '连线按钮', text: '继续', kind: 'button', page: 'custom', x: .1, y: .1, width: .3, height: .1 },
  ] }];
  const populate = (graph: BlueprintGraph, prefix: string, ui = false) => {
    const node = (type: BlueprintNode['type'], suffix: string, x: number, y: number) => {
      const value = blueprintNodeDefaults(type); value.id = prefix + suffix; value.name = suffix; value.x = x; value.y = y;
      if (type === 'eventClick') value.properties.componentId = 'wire_button';
      if (type === 'literal') { value.properties.value = suffix === 'text' ? '文字' : 1; value.pins[0].dataType = suffix === 'text' ? 'string' : 'number'; }
      return value;
    };
    graph.nodes = [node(ui ? 'eventClick' : 'event', 'event', 0, 0), node('delay', 'delay_a', 330, 0), node('delay', 'delay_b', 660, 0),
      node('literal', 'number', 0, 280), node('round', 'round_a', 330, 260), node('round', 'round_b', 660, 260), node('literal', 'text', 0, 500)];
    graph.links = [];
    const wire = (id: string, from: string, fromPin: string, to: string, toPin: string) => {
      const problem = connectBlueprintPins(graph, prefix + from, fromPin, prefix + to, toPin); assert.equal(problem, undefined); graph.links.at(-1)!.id = prefix + id;
    };
    wire('exec', 'event', 'exec', 'delay_a', 'exec_in');
    wire('data_a', 'number', 'value', 'round_a', 'value'); wire('data_b', 'number', 'value', 'round_b', 'value');
  };
  const graph = createBlueprintGraph('function', '连线普通蓝图'); graph.id = normalId; project.blueprints = [graph]; populate(graph, 'normal_');
  const pageGraph = createUiEventGraph(project, pageId, '连线页面事件图'); pageGraph.id = pageGraphId; populate(pageGraph, 'page_', true);
  const sceneId = project.scenes[0].id;
  const story = (kind: 'start' | 'passage' | 'end', id: string, x: number, y: number, next?: string) => {
    const node = newNode(kind, sceneId); node.id = id; node.name = id; node.x = x; node.y = y;
    if ('next' in node || kind === 'start' || kind === 'passage') Object.assign(node, { next });
    return node;
  };
  project.nodes = [story('start', 'wire_start', 0, 0, 'wire_a'), story('passage', 'wire_a', 320, 0, 'wire_b'),
    story('passage', 'wire_b', 650, 0, 'wire_end'), story('passage', 'wire_c', 650, 260, 'wire_end'),
    story('passage', 'wire_d', 320, 300, 'wire_b'), story('end', 'wire_end', 980, 100)];
  project.entryId = 'wire_start'; synchronizeBlueprintSignatures(project); return projectSchema.parse(project);
}
let initial: Project;
let app: ElectronApplication | undefined, page: Page | undefined, failure: unknown, phase = '准备', traceRunning = false;
let focusSession: CDPSession | undefined;
let editorWindowId: number;
const focusWindows: { id: number; phase: string; destroyed: boolean; error?: string }[] = [];
const checks: { name: string; durationMs: number }[] = [], errors: string[] = [], hits: unknown[] = [], releases: unknown[] = [], processes: { pid?: number; exited: boolean }[] = [];
const report: Record<string, unknown> = { status: 'running', checks, errors, hits, releases, processes, focusWindows, temporaryPaths: [path.dirname(projectFile), profile],
  limits: ['只验证编译后的源码编辑器鼠标交互和保存／撤销，不启动原生游戏。', '失焦先确认fixture获焦，再聚焦同进程临时子窗口并记录原窗口真实window.blur；辅助窗口立即销毁，未切换到用户窗口或操作真实工程。'] };
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const card = (id: string) => page!.locator(`.react-flow__node[data-id="${id}"]`);
const edge = (id: string) => page!.locator(`.react-flow__edge[data-id="${id}"]`);
const pin = (id: string, handle: string) => card(id).locator(`.react-flow__handle[data-handleid="${handle}"]`);
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const graph = (value: Project, id: string) => { const result = value.blueprints.find(graph => graph.id === id); assert.ok(result); return result; };
const links = (value: Project, id: string) => graph(value, id).links;
const sortedLinks = (value: readonly BlueprintLink[]) => [...value].sort((a, b) => a.id.localeCompare(b.id));
const settle = () => page!.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
const writeReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function screenshot(name: string) {
  const data = await app!.evaluate(async ({ BrowserWindow }, id) => (await BrowserWindow.fromId(id)!.webContents.capturePage()).toPNG().toString('base64'), editorWindowId);
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(data, 'base64'));
}
async function check(name: string, work: () => Promise<void>) {
  phase = name; const started = Date.now(); await work(); await settle(); checks.push({ name, durationMs: Date.now() - started });
  await screenshot(String(checks.length).padStart(2, '0')); await writeReport(); console.log('通过：' + name);
}
async function save(ui = false) {
  const saveUi = button('保存界面');
  if (ui) { if (await saveUi.isEnabled()) await saveUi.click(); await expect(page!.locator('.ui-save-status')).toHaveText('已保存', { timeout: 30000 }); await expect(saveUi).toBeDisabled(); }
  else { await button('保存工程').click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); }
  await settle(); return read();
}
async function undo() {
  await page!.getByRole('button', { name: /^撤销/ }).first().click();
  await settle(); return save();
}
// Saving the UI commits its draft and clears draft history. Inspect visible
// edge geometry while the draft is active; save only after history checks.
async function draftLinks(): Promise<BlueprintLink[]> {
  await settle();
  return sortedLinks(await page!.locator('.flow-container').evaluate(canvas => {
    const handles = [...canvas.querySelectorAll<HTMLElement>('.react-flow__handle')].map(handle => {
      const box = handle.getBoundingClientRect(), source = handle.classList.contains('source');
      return { node: handle.getAttribute('data-nodeid'), pin: handle.getAttribute('data-handleid'), source,
        x: source ? box.right : box.left, y: box.top + box.height / 2 };
    });
    return [...canvas.querySelectorAll<SVGPathElement>('.react-flow__edge-path')].map(curve => {
      const id = curve.closest('.react-flow__edge')?.getAttribute('data-id'), matrix = curve.getScreenCTM();
      if (!id || !matrix) throw new Error('Draft edge is missing its ID or measured geometry.');
      const endpoint = (source: boolean) => {
        const local = curve.getPointAtLength(source ? 0 : curve.getTotalLength()), point = new DOMPoint(local.x, local.y).matrixTransform(matrix);
        const nearby = handles.filter(handle => handle.source === source).map(handle => ({ ...handle, distance: Math.hypot(handle.x - point.x, handle.y - point.y) })).sort((a, b) => a.distance - b.distance);
        if (!nearby[0]?.node || !nearby[0].pin || nearby[0].distance > 3 || nearby[1] && nearby[1].distance <= 3) throw new Error(`Draft edge ${id} does not meet one unique visible ${source ? 'source' : 'target'} handle: ${JSON.stringify({ point, nearby: nearby.slice(0, 2) })}`);
        return { node: nearby[0].node, pin: nearby[0].pin };
      };
      const from = endpoint(true), to = endpoint(false);
      return { id, fromNodeId: from.node, fromPinId: from.pin, toNodeId: to.node, toPinId: to.pin };
    });
  }));
}
async function currentLinks(ui: boolean, id: string) { return ui ? draftLinks() : sortedLinks(links(await save(), id)); }
async function graphState(ui: boolean, id: string) {
  if (!ui) return graph(await save(), id);
  return { links: await draftLinks(), nodes: await page!.locator('.flow-container .react-flow__node').evaluateAll(nodes => nodes.map(node => ({
    id: node.getAttribute('data-id'), title: node.querySelector('.graph-node-title')?.textContent,
    pins: [...node.querySelectorAll('.react-flow__handle')].map(pin => pin.getAttribute('data-handleid')).sort(),
    fields: [...node.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')].map(field => ({ label: field.getAttribute('aria-label'), value: field.value, checked: field instanceof HTMLInputElement ? field.checked : undefined })),
  })).sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''))) };
}
async function point(locator: Locator, expectPin = false): Promise<Point> {
  await expect(locator).toHaveCount(1); const box = await locator.boundingBox(); assert.ok(box && box.width && box.height);
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const hit = await page!.evaluate(at => {
    const element = document.elementFromPoint(at.x, at.y);
    return { at, tag: element?.tagName, className: element?.getAttribute('class'), node: element?.closest('.react-flow__node')?.getAttribute('data-id'), handle: element?.getAttribute('data-handleid') };
  }, at);
  hits.push({ phase, ...hit });
  if (expectPin) assert.ok(hit.className?.split(' ').includes('react-flow__handle'), 'Pin center must hit the visible handle, never an invisible edge updater: ' + JSON.stringify(hit));
  return at;
}
async function blank(): Promise<Point> {
  let at: Point | undefined;
  await expect.poll(async () => {
    at = await page!.evaluate(() => {
      const pane = document.querySelector('.flow-container .react-flow__pane'); if (!pane) return;
      const box = pane.getBoundingClientRect();
      const nodes = [...pane.querySelectorAll('.react-flow__node')].map(node => node.getBoundingClientRect());
      for (let y = Math.max(0, box.top) + 35; y < Math.min(innerHeight, box.bottom) - 25; y += 25)
        for (let x = Math.max(0, box.left) + 35; x < Math.min(innerWidth, box.right) - 25; x += 25)
          if (document.elementFromPoint(x, y) === pane && !nodes.some(node => x > node.left - 35 && x < node.right + 35 && y > node.top - 35 && y < node.bottom + 35)
            && !document.elementsFromPoint(x, y).some(element => element.closest('.react-flow__node, .react-flow__edge'))) return { x, y };
    }); return !!at;
  }).toBe(true); return at!;
}
async function clear() { const at = await blank(); await page!.mouse.click(at.x, at.y); await expect(page!.locator('.react-flow__edge.selected')).toHaveCount(0); }
async function focusEvidence(phase: string): Promise<FocusEvidence> {
  return { phase, nativeFocused: await app!.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)!.isFocused(), editorWindowId), rendererFocused: await page!.evaluate(() => document.hasFocus()) };
}
async function focusFixture() {
  await app!.evaluate(({ BrowserWindow }, id) => { const win = BrowserWindow.fromId(id)!; win.focus(); win.focusOnWebView(); }, editorWindowId);
  await expect.poll(async () => { const state = await focusEvidence('focus-precondition'); return state.nativeFocused && state.rendererFocused; }, { message: 'Owned fixture must receive native and renderer focus before testing window blur.' }).toBe(true);
}
async function blurFixture(focusStates: FocusEvidence[]) {
  const id = await app!.evaluate(({ BrowserWindow }, editorId) => {
    const helper = new BrowserWindow({ parent: BrowserWindow.fromId(editorId)!, modal: true, show: false, width: 320, height: 120,
      title: '连线取消验收临时窗口', skipTaskbar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    return helper.id;
  }, editorWindowId);
  const record = { id, phase, destroyed: false } as (typeof focusWindows)[number]; focusWindows.push(record);
  try {
    await app!.evaluate(async ({ BrowserWindow }, id) => {
      const helper = BrowserWindow.fromId(id)!;
      await helper.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html lang="zh-CN"><title>连线取消验收</title><body>临时失焦验收窗口</body></html>'));
      helper.show(); helper.focus(); helper.focusOnWebView();
    }, id);
    await expect.poll(async () => {
      const native = await app!.evaluate(({ BrowserWindow }, ids) => ({ editor: BrowserWindow.fromId(ids.editor)!.isFocused(), helper: BrowserWindow.fromId(ids.helper)!.isFocused() }), { editor: editorWindowId, helper: id });
      const observed = await page!.evaluate(() => {
        const trace = (window as typeof window & { __wireReleaseTrace?: { records: ReleaseRecord[] } }).__wireReleaseTrace;
        return !document.hasFocus() && !!trace?.records.some(record => record.phase === 'cancel-event' && record.eventType === 'blur' && record.trusted);
      });
      return !native.editor && native.helper && observed;
    }, { message: 'Owned helper must take focus and deliver a trusted blur to the original fixture renderer.' }).toBe(true);
    await settle(); focusStates.push(await focusEvidence('after-blur'));
  } catch (error) {
    record.error = String(error); focusStates.push(await focusEvidence('after-blur'));
    const records = await page!.evaluate(() => (window as typeof window & { __wireReleaseTrace?: { records: ReleaseRecord[] } }).__wireReleaseTrace?.records ?? []);
    releases.push({ phase, cancel: 'blur', focusStates, records, preconditionError: record.error });
    throw error;
  }
  finally {
    await app!.evaluate(({ BrowserWindow }, id) => { const helper = BrowserWindow.fromId(id); if (helper && !helper.isDestroyed()) helper.destroy(); }, id);
    record.destroyed = await app!.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id) === null, id);
    await focusFixture();
  }
}
async function beginReleaseEvidence() {
  await page!.evaluate(() => {
    type Trace = { records: unknown[]; stop: () => void };
    const host = window as typeof window & { __wireReleaseTrace?: Trace };
    host.__wireReleaseTrace?.stop();
    const records: unknown[] = [], timers = new Set<ReturnType<typeof setTimeout>>();
    let active = true;
    const record = (phase: string, event: Event) => { if (active) records.push({ phase, eventType: event.type, trusted: event.isTrusted, focused: document.hasFocus(),
      ...('clientX' in event ? { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY, button: (event as MouseEvent).button, buttons: (event as MouseEvent).buttons } : {}),
      connectionPaths: document.querySelectorAll('.react-flow__connection-path').length,
      edgePaths: [...document.querySelectorAll('.react-flow__edge-path')].map(path => path.closest('.react-flow__edge')?.getAttribute('data-id')),
      clickPins: [...document.querySelectorAll('.react-flow__handle.clickconnecting')].map(pin => pin.getAttribute('data-nodeid') + ':' + pin.getAttribute('data-handleid')),
    }); };
    const capture = (event: MouseEvent) => {
      record('capture', event); queueMicrotask(() => record('microtask-from-capture', event));
      const timer = setTimeout(() => { timers.delete(timer); record('task-after-dispatch', event); }, 0); timers.add(timer);
    };
    const bubble = (event: MouseEvent) => record('bubble', event);
    const cancellation = (event: Event) => {
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return;
      if (event.type === 'mousedown' && (event as MouseEvent).button === 0) return;
      record('cancel-event', event);
      const timer = setTimeout(() => { timers.delete(timer); record('task-after-cancel', event); }, 0); timers.add(timer);
    };
    document.addEventListener('mouseup', capture, true); document.addEventListener('mouseup', bubble);
    window.addEventListener('blur', cancellation); document.addEventListener('keydown', cancellation, true); document.addEventListener('contextmenu', cancellation, true); document.addEventListener('mousedown', cancellation, true);
    host.__wireReleaseTrace = { records, stop: () => {
      active = false; for (const timer of timers) clearTimeout(timer); document.removeEventListener('mouseup', capture, true); document.removeEventListener('mouseup', bubble);
      window.removeEventListener('blur', cancellation); document.removeEventListener('keydown', cancellation, true); document.removeEventListener('contextmenu', cancellation, true); document.removeEventListener('mousedown', cancellation, true);
    } };
  });
}
async function endReleaseEvidence(cancel?: string, focusStates?: FocusEvidence[]) {
  const records = await page!.evaluate(() => {
    const host = window as typeof window & { __wireReleaseTrace?: { records: ReleaseRecord[]; stop: () => void } };
    const trace = host.__wireReleaseTrace; trace?.stop(); delete host.__wireReleaseTrace; return trace?.records ?? [];
  });
  releases.push({ phase, cancel, focusStates, records });
  if (cancel) {
    const eventType = cancel === 'escape' ? 'keydown' : cancel === 'blur' ? 'blur' : 'contextmenu';
    assert.ok(records.some(record => record.phase === 'cancel-event' && record.eventType === eventType && record.trusted), `Cancellation precondition: a trusted ${eventType} event must reach the renderer.`);
    const completed = records.filter(record => record.phase === 'task-after-cancel' && record.eventType === eventType && record.trusted);
    assert.ok(completed.length && completed.every(record => record.connectionPaths === 0), 'Cancellation must clear native reconnect preview before the later left-button release.');
    if (cancel === 'blur') {
      assert.ok(focusStates?.filter(state => state.phase !== 'after-blur').every(state => state.nativeFocused && state.rendererFocused), 'Window blur requires native and renderer focus before the drag and immediately before blur.');
      assert.ok(records.some(record => record.phase === 'cancel-event' && record.eventType === 'blur' && record.trusted && !record.focused), 'Window blur must actually remove renderer focus.');
    }
    if (cancel === 'menu') {
      const down = records.findIndex(record => record.phase === 'cancel-event' && record.eventType === 'mousedown' && record.trusted && record.button === 2);
      const up = records.findIndex(record => record.phase === 'capture' && record.eventType === 'mouseup' && record.trusted && record.button === 2);
      assert.ok(down >= 0, 'Observe a trusted right-button press while dragging.');
      assert.equal(records[down].connectionPaths, 0, 'Right-button press must finish cancellation before any release can complete the drag.');
      // Opening the context menu can redirect its right-button release. When
      // delivered here it must still find no active drag; the later trusted
      // left release and unchanged graph are required independently below.
      if (up >= 0) { assert.ok(up > down); assert.equal(records[up].connectionPaths, 0); }
    }
  }
  const left = records.filter(record => record.eventType === 'mouseup' && record.trusted && record.button === 0);
  assert.ok(left.some(record => record.phase === 'capture'), 'Acceptance must observe a trusted left-button release, not only synthetic cancellation or a right-button release.');
  assert.ok(left.some(record => record.phase === 'bubble'), 'Trusted left-button release must reach native document bubble handling.');
  assert.ok(left.some(record => record.phase === 'task-after-dispatch'), 'Record final DOM after left-button release dispatch and its microtasks.');
  assert.ok(left.filter(record => record.phase === 'task-after-dispatch').every(record => record.connectionPaths === 0), 'Native reconnect preview must end after trusted left-button release.');
}
async function drag(from: Locator, to: Locator | Point, cancel?: 'escape' | 'blur' | 'menu') {
  const start = await point(from, true), end = 'x' in to ? to : await point(to);
  const focusStates: FocusEvidence[] = [];
  if (cancel === 'blur') { await focusFixture(); focusStates.push(await focusEvidence('before-drag')); }
  await beginReleaseEvidence();
  await page!.mouse.move(start.x, start.y); await page!.mouse.down(); await page!.mouse.move(end.x, end.y, { steps: 22 });
  if (cancel === 'escape') await page!.keyboard.press('Escape');
  if (cancel === 'blur') {
    focusStates.push(await focusEvidence('before-blur'));
    await blurFixture(focusStates);
  }
  if (cancel === 'menu') { await page!.mouse.click(end.x, end.y, { button: 'right' }); await settle(); }
  await page!.mouse.up(); await settle();
  await endReleaseEvidence(cancel, cancel === 'blur' ? focusStates : undefined);
  if (cancel === 'menu') {
    const story = await page!.locator('.unified-flow-workspace').count() > 0;
    const menu = page!.locator('.story-flow-context-menu'), dismiss = page!.locator('.story-context-dismiss');
    if (story) { await expect(menu).toBeVisible(); await expect(dismiss).toHaveCount(1); }
    const selected = await page!.locator('.react-flow__node.selected, .react-flow__edge.selected').evaluateAll(items => items.map(item => item.getAttribute('data-id')).sort());
    await page!.keyboard.press('Escape');
    await expect(menu).toHaveCount(0); await expect(dismiss).toHaveCount(0);
    if (story) {
      assert.deepEqual(await page!.locator('.react-flow__node.selected, .react-flow__edge.selected').evaluateAll(items => items.map(item => item.getAttribute('data-id')).sort()), selected, 'Escape closes the story menu without clearing canvas selection.');
      releases.push({ phase, menuDismissal: { via: 'Escape', selected, menuClosed: true, backdropClosed: true } });
    }
  }
}
async function selectWire(id: string) {
  await clear();
  const at = await edge(id).locator('.react-flow__edge-path').evaluate(element => {
    const curve = element as SVGPathElement, value = curve.getPointAtLength(curve.getTotalLength() * .65), screen = new DOMPoint(value.x, value.y).matrixTransform(curve.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  });
  await page!.mouse.click(at.x, at.y); await expect(edge(id)).toHaveClass(/selected/); await expect(page!.locator('.react-flow__edge.selected')).toHaveCount(1);
  const layer = await edge(id).evaluate(element => ({ svgZ: getComputedStyle(element.closest('svg')!).zIndex,
    edgeOrder: [...element.closest('.react-flow')!.querySelectorAll('.react-flow__edge')].map(edge => edge.getAttribute('data-id')),
    nodeLayers: [...element.closest('.react-flow')!.querySelectorAll('.react-flow__node')].map(node => ({ id: node.getAttribute('data-id'), z: getComputedStyle(node).zIndex,
      followsEdgeInDocument: !!(element.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING),
    })),
  }));
  hits.push({ phase, selectedWireLayer: { id, ...layer } });
  assert.equal(Number(layer.svgZ), 0, 'Selecting a wire must not elevate it above node pins or controls.');
  assert.ok(layer.nodeLayers.every(node => Number(node.z) > Number(layer.svgZ) || Number(node.z) === Number(layer.svgZ) && node.followsEdgeInDocument), 'Node surfaces remain in front of selected wire hits (unselected nodes share z=0 and paint later).');
  assert.equal(layer.edgeOrder.at(-1), id, 'The unique selected wire is painted last among edges.');
}
async function openGraph(ui = false) {
  await page!.locator(`[data-workspace-tab="${ui ? 'ui' : 'blueprint'}"]`).click();
  if (ui) {
    await page!.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '事件图', exact: true }).click();
    await page!.getByLabel('事件图页面', { exact: true }).selectOption(pageId); await page!.getByLabel('当前页面事件图', { exact: true }).selectOption(pageGraphId);
  } else await page!.getByLabel('蓝图资源', { exact: true }).selectOption('graph:' + normalId);
  await setBlueprintOption(page!, '自动接线', false); await fitBlueprintCanvas(page!); await clear();
}
async function verifyGraph(ui: boolean) {
  const id = ui ? pageGraphId : normalId, prefix = ui ? 'page_' : 'normal_', label = ui ? '页面事件图' : '普通蓝图';
  await openGraph(ui); const persistedBefore = graph(await save(ui), id), initialLinks = sortedLinks(persistedBefore.links);
  const snapshot = () => currentLinks(ui, id);
  const state = () => graphState(ui, id);
  const restore = async () => {
    if (!ui) { assert.deepEqual(sortedLinks(links(await undo(), id)), initialLinks); return; }
    const changed = await snapshot();
    assert.notDeepEqual(changed, initialLinks, 'History acceptance requires an actual draft wire edit.');
    const historyButton = (name: '撤销' | '重做') => page!.getByRole('button', { name: new RegExp('^' + name) }).first();
    await expect(historyButton('撤销')).toBeEnabled(); await historyButton('撤销').click(); assert.deepEqual(await snapshot(), initialLinks);
    await expect(historyButton('重做')).toBeEnabled(); await historyButton('重做').click(); assert.deepEqual(await snapshot(), changed);
    await historyButton('撤销').click(); assert.deepEqual(await snapshot(), initialLinks);
    releases.push({ phase, draftHistory: { atomic: true, before: initialLinks, changed, restored: await snapshot() } });
    assert.deepEqual(graph(await save(true), id), persistedBefore);
  };
  const execPin = () => pin(prefix + 'delay_a', 'exec_in');
  await check(label + '：直接从未选中的已接输入端拖到空白断线，并一次撤销', async () => {
    await drag(execPin(), await blank()); assert.equal((await snapshot()).some(link => link.id === prefix + 'exec'), false);
    await restore();
  });
  await check(label + '：输入端拖到有效新输入，保留线ID并一次撤销', async () => {
    await drag(execPin(), pin(prefix + 'delay_b', 'exec_in'));
    assert.equal((await snapshot()).find(link => link.id === prefix + 'exec')?.toNodeId, prefix + 'delay_b');
    await restore();
  });
  await check(label + '：同端点、非法类型、节点表面和控件释放均不改原线', async () => {
    const before = await state(), history = await page!.getByRole('button', { name: /^撤销/ }).first().getAttribute('title');
    const at = await point(execPin(), true); await page!.mouse.move(at.x, at.y); await page!.mouse.down(); await page!.mouse.move(at.x + 45, at.y + 40, { steps: 12 }); await page!.mouse.move(at.x, at.y, { steps: 12 }); await page!.mouse.up(); await settle();
    assert.deepEqual(await state(), before);
    await drag(pin(prefix + 'round_a', 'value'), pin(prefix + 'text', 'value')); assert.deepEqual(await state(), before);
    await drag(execPin(), await point(card(prefix + 'delay_b').locator('.graph-node-title'))); assert.deepEqual(await state(), before);
    await drag(execPin(), await point(card(prefix + 'delay_b').locator('input').first())); assert.deepEqual(await state(), before);
    assert.equal(await page!.getByRole('button', { name: /^撤销/ }).first().getAttribute('title'), history);
  });
  await check(label + '：Esc、窗口失焦及右键菜单取消后不删除', async () => {
    for (const cancel of ['escape', 'blur', 'menu'] as const) { const before = await state(); await drag(execPin(), await blank(), cancel); assert.deepEqual(await state(), before); await expect(page!.locator('.react-flow__connection-path')).toHaveCount(0); }
  });
  await check(label + '：共享输出改接唯一选中线，保留其他分支并一次撤销', async () => {
    await selectWire(prefix + 'data_a'); await drag(pin(prefix + 'number', 'value'), pin(prefix + 'text', 'value'));
    // Wrong output type is rejected and does not remove either shared branch.
    assert.deepEqual(await snapshot(), initialLinks);
    await selectWire(prefix + 'data_a'); await drag(pin(prefix + 'number', 'value'), pin(prefix + 'round_b', 'result'));
    const reconnected = await snapshot(); assert.equal(reconnected.find(link => link.id === prefix + 'data_a')?.fromNodeId, prefix + 'round_b');
    assert.deepEqual(reconnected.find(link => link.id === prefix + 'data_b'), initialLinks.find(link => link.id === prefix + 'data_b')); await restore();
    await selectWire(prefix + 'data_a'); await drag(pin(prefix + 'number', 'value'), await blank());
    assert.deepEqual((await snapshot()).map(link => link.id).sort(), [prefix + 'exec', prefix + 'data_b'].sort());
    await restore();
  });
  await check(label + '：共享输出未选中仍建分支，Alt单击一次断开全部分支', async () => {
    await clear(); const start = await point(pin(prefix + 'number', 'value'), true);
    await page!.mouse.move(start.x, start.y); await page!.mouse.down(); await page!.mouse.move(start.x + 30, start.y + 40, { steps: 10 });
    await expect(page!.getByRole('status').filter({ hasText: '先选中要改接的连线' })).toBeVisible(); await page!.keyboard.press('Escape'); await page!.mouse.up();
    assert.deepEqual(await snapshot(), initialLinks);
    await pin(prefix + 'number', 'value').click({ modifiers: ['Alt'] }); assert.deepEqual((await snapshot()).map(link => link.id), [prefix + 'exec']);
    await restore();
  });
  await check(label + '：未接输出空白拖出仍显示兼容新节点菜单，取消不改工程', async () => {
    const before = await state(); await clear(); await drag(pin(prefix + 'text', 'value'), await blank());
    await expect(page!.locator('.node-picker')).toBeVisible(); await expect(page!.locator('.node-picker [data-node-picker-item="delay"]')).toHaveCount(0);
    await page!.keyboard.press('Escape'); assert.deepEqual(await state(), before);
  });
  await check(label + '：Ctrl从已接pin新建线，维持单输入并一次撤销', async () => {
    await page!.keyboard.down('Control'); await drag(pin(prefix + 'text', 'value'), pin(prefix + 'round_a', 'value')); await page!.keyboard.up('Control');
    assert.deepEqual(await snapshot(), initialLinks); // Type mismatch preserves the occupied number input.
    await page!.keyboard.down('Control'); await drag(pin(prefix + 'number', 'value'), pin(prefix + 'round_a', 'value')); await page!.keyboard.up('Control');
    const after = await snapshot(); assert.equal(after.filter(link => link.toNodeId === prefix + 'round_a' && link.toPinId === 'value').length, 1);
    assert.equal(after.length, initialLinks.length); await restore();
  });
  await check(label + '：两次单击连接占用输入仍替换数据源，Esc取消点击连线', async () => {
    await clear(); await pin(prefix + 'round_b', 'result').click(); await expect(pin(prefix + 'round_b', 'result')).toHaveClass(/clickconnecting/);
    await pin(prefix + 'round_a', 'value').click(); const after = await snapshot();
    assert.equal(after.find(link => link.toNodeId === prefix + 'round_a' && link.toPinId === 'value')?.fromNodeId, prefix + 'round_b');
    assert.equal(after.filter(link => link.toNodeId === prefix + 'round_a' && link.toPinId === 'value').length, 1); await restore();
    await pin(prefix + 'number', 'value').click(); await expect(pin(prefix + 'number', 'value')).toHaveClass(/clickconnecting/);
    await page!.keyboard.press('Escape'); await expect(page!.locator('.react-flow__handle.clickconnecting')).toHaveCount(0); assert.deepEqual(await snapshot(), initialLinks);
  });
  if (ui) assert.deepEqual(graph(await save(true), id), persistedBefore);
}
async function fitStory() {
  await button('适应全图').click(); await expect.poll(() => page!.evaluate(async () => {
    const viewport = document.querySelector('.unified-flow-body .react-flow__viewport'); if (!viewport) return false;
    const transform = getComputedStyle(viewport).transform; for (let i = 0; i < 6; i++) { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); if (getComputedStyle(viewport).transform !== transform) return false; } return true;
  })).toBe(true);
}
const routes = (value: Project) => value.nodes.map(node => ({ id: node.id, next: 'next' in node ? node.next : undefined }));
async function verifyStory() {
  await page!.locator('[data-workspace-tab="flowchart"]').click(); await fitStory();
  await check('顶层流程：只读恢复存档出口Alt不改线；可编辑启动线断开后一次撤销', async () => {
    const before = await save(); const at = await point(pin('flow:load', 'restore')); await page!.keyboard.down('Alt'); await page!.mouse.click(at.x, at.y); await page!.keyboard.up('Alt');
    assert.deepEqual(gameFlowCanvasEdges(await save()), gameFlowCanvasEdges(before));
    await drag(pin('flow:launch', 'next'), await blank()); assert.equal(gameFlowCanvasEdges(await save()).some(edge => edge.id === 'flow:launch:next'), false);
    assert.deepEqual(gameFlowCanvasEdges(await undo()), gameFlowCanvasEdges(before));
  });
  await fitStory(); await card('flow:story').dblclick(); await expect(page!.getByRole('region', { name: '流程图', exact: true })).toHaveAttribute('data-flow-scope', 'content');
  await fitStory(); await card(storySceneNodeId(initial.scenes[0].id)).dblclick(); await expect(card('wire_a')).toBeVisible(); await fitStory(); await clear();
  const before = routes(await save());
  await check('故事图：已接出口拖到空白断线；保留其他路径并一次撤销', async () => {
    await drag(pin('wire_a', 'next'), await blank()); assert.equal(routes(await save()).find(node => node.id === 'wire_a')?.next, undefined);
    assert.deepEqual(routes(await undo()), before);
  });
  await check('故事图：共享输入唯一选中线改接新输入、其他线不动，一次撤销', async () => {
    await selectWire('wire_a:next'); await drag(pin('wire_b', 'in'), pin('wire_c', 'in'));
    const after = routes(await save()); assert.equal(after.find(node => node.id === 'wire_a')?.next, 'wire_c'); assert.equal(after.find(node => node.id === 'wire_d')?.next, 'wire_b');
    assert.deepEqual(routes(await undo()), before);
  });
  await check('故事图：同端点、非法开始节点、节点表面、Esc及失焦均保留连线', async () => {
    const at = await point(pin('wire_a', 'next'), true); await page!.mouse.move(at.x, at.y); await page!.mouse.down(); await page!.mouse.move(at.x + 45, at.y + 40, { steps: 12 }); await page!.mouse.move(at.x, at.y, { steps: 12 }); await page!.mouse.up(); await settle();
    await drag(pin('wire_a', 'next'), pin('wire_start', 'in')); await drag(pin('wire_a', 'next'), await point(card('wire_c').locator('.graph-node-title')));
    for (const cancel of ['escape', 'blur', 'menu'] as const) await drag(pin('wire_a', 'next'), await blank(), cancel);
    assert.deepEqual(routes(await save()), before);
  });
  await check('故事图：Alt共享输入断开全部可编辑路径，并一次撤销', async () => {
    await clear(); await pin('wire_b', 'in').click({ modifiers: ['Alt'] }); const after = routes(await save());
    assert.equal(after.find(node => node.id === 'wire_a')?.next, undefined); assert.equal(after.find(node => node.id === 'wire_d')?.next, undefined);
    assert.equal(after.find(node => node.id === 'wire_b')?.next, 'wire_end'); assert.deepEqual(routes(await undo()), before);
  });
}

try {
  phase = 'fixture schema'; initial = fixture();
  phase = '准备';
  await fs.mkdir(path.dirname(projectFile), { recursive: true }); await saveProject(projectFile, initial);
  app = await launchDesktopFixture({ root, projectFile, profile }); processes.push({ pid: app.process().pid, exited: false });
  editorWindowId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id);
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  // Playwright forces document.hasFocus() to true by default. Native owned
  // windows must control renderer focus for a real blur cancellation check.
  focusSession = await page.context().newCDPSession(page);
  await focusSession.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  report.focusEmulation = { enabled: false, detached: false };
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; if (win.isMaximized()) win.unmaximize(); win.setContentSize(1700, 1100); win.webContents.setBackgroundThrottling(false); });
  await expect(page.locator('.project-title strong')).toHaveText(initial.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html')); report.rendererUrl = page.url();
  await page.evaluate('globalThis.__name = value => value'); await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false }); traceRunning = true;
  await verifyGraph(false); await verifyGraph(true); await verifyStory(); assert.deepEqual(errors, []); report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = String(error); if (app && page) await screenshot('failure').catch(() => undefined);
} finally {
  if (focusSession) {
    try { await focusSession.detach(); report.focusEmulation = { enabled: false, detached: true }; }
    catch (error) { failure ??= error; report.status = 'failed'; report.focusSessionDetachError = String(error); }
    focusSession = undefined;
  }
  if (app) {
    const owned = app, child = owned.process();
    if (traceRunning && page) await page.context().tracing.stop({ path: path.join(output, 'trace.zip') }).catch(error => { report.traceError = String(error); });
    try {
      try {
        await owned.evaluate(({ BrowserWindow }, ids) => { for (const id of ids) { const helper = BrowserWindow.fromId(id); if (helper && !helper.isDestroyed()) helper.destroy(); } }, focusWindows.map(window => window.id));
        for (const window of focusWindows) window.destroyed = await owned.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id) === null, window.id);
        assert.ok(focusWindows.every(window => window.destroyed), 'Every owned focus helper must be destroyed.');
      } catch (error) { failure ??= error; report.status = 'failed'; report.focusWindowCleanupError = String(error); }
      await owned.close(); await expect.poll(() => child.exitCode !== null || child.signalCode !== null).toBe(true); processes[0].exited = true; app = undefined;
    }
    catch (error) { failure ??= error; report.status = 'failed'; report.closeError = String(error); }
  }
  await fs.mkdir(output, { recursive: true }); await writeReport();
  if (!app && processes.every(process => process.exited)) {
    try { const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); report.cleanup = cleanup; assert.deepEqual(cleanup.errors, []); }
    catch (error) { failure ??= error; report.status = 'failed'; report.cleanupError = String(error); }
  } else { failure ??= new Error('Owned acceptance process has not exited.'); report.status = 'failed'; report.cleanupSkipped = true; }
  await writeReport(); console.log(output);
}
if (failure) throw failure;
