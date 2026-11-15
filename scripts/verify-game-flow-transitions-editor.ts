import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { projectSchema, type Project } from '../src/core/model';
import { type FlowTransition } from '../src/core/flow-transition-schema';
import { flowNodeIds, flowStepNodeId } from '../src/core/game-flow-graph';
import { type GameFlowStep } from '../src/core/game-flow-schema';
import { storySceneNodeId } from '../src/core/story-groups';
import { gameFlowEditorIds as ids, gameFlowTransitionsEditorFixture, writeGameFlowEditorAssets } from './lib/game-flow-transitions-editor-fixture';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// This is a pending, isolated acceptance suite. Run only after the whole change
// has been implemented and the development editor has been built centrally.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Use the isolated compiled development editor.');
const root = path.resolve('.');
const output = path.resolve('artifacts/editor-refinements-2026-11-10', 'game-flow-editor-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const projectFile = path.join(output, 'project/project.vns.json'), profile = path.join(output, 'profile');
const authorProject = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? '../我的视觉小说1/project.vns.json');
const project = gameFlowTransitionsEditorFixture();
const openingId = flowStepNodeId(ids.opening), spareId = flowStepNodeId(ids.spare);
type Point = { x: number; y: number };
type Rect = Point & { width: number; height: number };
type Mode = '不单独设置' | '直接切换' | '叠化' | '淡黑' | '淡白' | '经过颜色';
type ModuleKind = '页面' | '动画演出' | '视频';
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'prepare', failure: unknown, authorHash: string | undefined;
let insertedId = '', pageStepId = '', videoStepId = '', titlePageId = '';
const checks: { name: string; durationMs: number }[] = [], errors: string[] = [];
const processes: { pid?: number; exited: boolean }[] = [];
const selections: Record<string, unknown>[] = [], reconnections: Record<string, unknown>[] = [];
const evidence: Record<string, unknown> = { selections, reconnections };
const report: Record<string, unknown> = { status: 'running', renderer: 'compiled', checks, errors, processes, evidence, authorProject,
  temporaryPaths: [path.dirname(projectFile), profile], fixture: { openingId, timelineId: ids.timeline, visual: 'savedAction image, duration=3, wait=false', tailDelay: 3 } };
let selectionTraceActive = false;
async function startSelectionTrace() {
  if (process.env.VNS_TRACE_FLOW_SELECTION !== '1') return;
  selectionTraceActive = true;
  await page!.evaluate(() => {
    const events: unknown[] = [], started = performance.now(); let previous = '';
    const describe = (element: Element | null) => element ? { tag: element.tagName, role: element.getAttribute('role'), nodeId: element.closest('.react-flow__node')?.getAttribute('data-id'), label: element.getAttribute('aria-label'), text: element instanceof HTMLInputElement ? element.value : element.textContent?.slice(0, 100) } : null;
    const snapshot = (label: string, event?: Event) => {
      const state = { selected: [...document.querySelectorAll('.react-flow__node.selected')].map(element => element.getAttribute('data-id')), nodes: [...document.querySelectorAll('.react-flow__node')].map(element => element.getAttribute('data-id')), focus: describe(document.activeElement), inspector: document.querySelector('.flow-node-properties h3')?.textContent, viewport: document.querySelector('.react-flow__viewport')?.getAttribute('style') };
      const serialized = JSON.stringify(state); if (label === 'mutation' && serialized === previous) return; previous = serialized;
      if (events.length < 400) events.push({ elapsed: performance.now() - started, label, key: event instanceof KeyboardEvent ? event.key : undefined, target: describe(event?.target instanceof Element ? event.target : null), ...state });
    };
    const listen = (event: Event) => snapshot(event.type, event), types = ['pointerdown', 'pointerup', 'contextmenu', 'click', 'keydown', 'keyup', 'focusin', 'focusout'];
    types.forEach(type => document.addEventListener(type, listen, true));
    const observer = new MutationObserver(() => snapshot('mutation')); observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    (window as typeof window & { __flowSelectionTrace?: { events: unknown[]; snapshot: (label: string) => void; stop: () => void } }).__flowSelectionTrace = { events, snapshot, stop: () => { observer.disconnect(); types.forEach(type => document.removeEventListener(type, listen, true)); } };
    snapshot('start');
  });
}
async function selectionTraceSnapshot(label: string, stop = false) {
  if (!selectionTraceActive || !page || page.isClosed()) return;
  evidence.selectionTrace = await page.evaluate(({ label, stop }) => {
    const trace = (window as typeof window & { __flowSelectionTrace?: { events: unknown[]; snapshot: (label: string) => void; stop: () => void } }).__flowSelectionTrace;
    trace?.snapshot(label); if (stop) trace?.stop(); return trace?.events;
  }, { label, stop });
  if (stop) selectionTraceActive = false;
}
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const fileHash = async () => hash(await fs.readFile(projectFile));
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const node = (id: string) => page!.locator(`.react-flow__node[data-id="${id}"]`);
const edge = (id: string) => page!.locator(`.react-flow__edge[data-id="${id}"]`);
const nextEdge = (source: string) => edge(source + ':next');
const marker = (source: string) => page!.locator(`button[data-flow-transition-edge="${source}:next"]`);
const workspace = () => page!.getByRole('region', { name: '流程图', exact: true });
const inspector = () => page!.locator('aside[data-flow-transition-inspector]');
const field = (name: string) => inspector().getByLabel(name, { exact: true });
const addDialog = () => page!.getByRole('dialog', { name: '添加流程节点', exact: true });
const inactiveTransition = (source: string) => page!.locator(`[data-game-flow-inactive] [data-flow-transition-inactive-source="${source}"]`);
const transition = (value: Project, source: string) => value.gameFlow?.transitions?.[source];
const connection = (value: Project, source: string) => value.gameFlow?.connections?.[source];
const steps = (value: Project) => [...value.gameFlow!.beforeTitle.steps, ...value.gameFlow!.beforeNewGame];
const findStep = (value: Project, id: string) => { const item = steps(value).find(step => flowStepNodeId(step.id) === id); assert.ok(item, 'Missing step ' + id); return item; };
const color: FlowTransition = { mode: 'color', color: '#315b79', outDuration: .5, hold: .25, inDuration: 1.25 };
const protectedSnapshot = (value: Project) => ({ nodes: value.nodes, entryId: value.entryId, storyGroups: value.storyGroups,
  chapters: value.chapters, scenes: value.scenes, variables: value.variables, ui: value.ui, blueprints: value.blueprints,
  timelinePresets: value.timelinePresets, assets: value.assets, characters: value.characters, effects: value.effects, minigames: value.minigames });
let protectedBefore: ReturnType<typeof protectedSnapshot>;
const settle = () => page!.evaluate(async () => {
  await document.fonts.ready;
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
});
async function stableViewport() {
  await page!.evaluate(async () => {
    let previous = '', stable = 0;
    for (let frame = 0; frame < 60 && stable < 8; frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const current = document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? '';
      stable = current === previous ? stable + 1 : 0; previous = current;
    }
  });
}
async function fit() { await button('适应全图').click(); await stableViewport(); }
async function bounds(locator: Locator): Promise<Rect> {
  const rect = await locator.boundingBox(); assert.ok(rect && rect.width && rect.height, 'Expected a visible non-empty rectangle.'); return rect;
}
const center = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile }); processes.push({ pid: app.process().pid, exited: false });
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]; if (window.isMaximized()) window.unmaximize();
    window.setContentSize(1600, 1000); window.webContents.setBackgroundThrottling(false);
  });
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html'));
  report.rendererUrl = page.url(); await page.evaluate('globalThis.__name = value => value');
  await page.locator('[data-workspace-tab="flowchart"]').click(); await settle();
  await expect(workspace()).toHaveAttribute('data-flow-scope', 'game'); await fit();
}
async function close() {
  if (!app) return;
  const owned = app, child = owned.process(), exited = () => child.exitCode !== null || child.signalCode !== null;
  try { await owned.close(); }
  finally {
    await expect.poll(exited, { timeout: 15000 }).toBe(true);
    const item = processes.find(record => record.pid === child.pid); if (item) item.exited = exited();
    if (exited()) { app = undefined; page = undefined; }
  }
}
async function screenshot(name: string) {
  await settle();
  const png = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(png, 'base64'));
}
async function check(name: string, work: () => Promise<void>) {
  phase = name; const started = Date.now(); await work(); checks.push({ name, durationMs: Date.now() - started });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log('通过：' + name);
}
async function save() {
  await button('保存工程').click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); return read();
}
async function unchanged(beforeHash: string) {
  await expect(page!.locator('.dirty-dot')).toHaveCount(0); assert.equal(await fileHash(), beforeHash, 'Viewing or cancelling must not write the isolated project.');
}
async function clickNode(id: string, mouseButton: 'left' | 'right' = 'left') {
  await node(id).locator('.graph-node-title strong').click({ button: mouseButton });
  await expect(node(id)).toHaveClass(/selected/);
}
async function simpleSelection() {
  await expect(page!.locator('.story-connections, .connection-label')).toHaveCount(0);
  await expect(button('断开选中连线')).toHaveCount(0);
  const handles = await page!.locator('.react-flow__edge.selected .react-flow__edgeupdater').evaluateAll(elements => elements.map(element => ({ opacity: getComputedStyle(element).opacity, visibility: getComputedStyle(element).visibility })));
  assert.ok(handles.every(item => item.opacity === '0' || item.visibility === 'hidden'), 'Selection must not draw endpoint circles.');
}
async function startClickTrace(point: Point) {
  await page!.evaluate(point => {
    const traceHost = window as unknown as { __vnsGameFlowClickTrace?: () => unknown };
    traceHost.__vnsGameFlowClickTrace?.();
    const records: Record<string, unknown>[] = [];
    const describe = (target: EventTarget | null) => {
      const element = target instanceof Element ? target : null;
      return { tag: element?.tagName ?? null, className: element?.getAttribute('class') ?? null, connected: element?.isConnected ?? null,
        edgeId: element?.closest('.react-flow__edge')?.getAttribute('data-id') ?? null,
        nodeId: element?.closest('.react-flow__node')?.getAttribute('data-id') ?? null,
        markerId: element?.closest('[data-flow-transition-edge]')?.getAttribute('data-flow-transition-edge') ?? null,
        handleId: element?.getAttribute('data-handleid') ?? null };
    };
    const snapshot = (at: Point) => ({
      viewport: document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? null,
      edgeOrder: Array.from(document.querySelectorAll('.react-flow__edge')).map(element => element.getAttribute('data-id')),
      selectedEdges: Array.from(document.querySelectorAll('.react-flow__edge.selected')).map(element => element.getAttribute('data-id')),
      selectedNodes: Array.from(document.querySelectorAll('.react-flow__node.selected')).map(element => element.getAttribute('data-id')),
      activeElement: describe(document.activeElement), hits: document.elementsFromPoint(at.x, at.y).slice(0, 12).map(describe),
    });
    const initial = snapshot(point), disposers: (() => void)[] = [];
    for (const type of ['pointerdown', 'mousedown', 'gotpointercapture', 'pointerup', 'mouseup', 'lostpointercapture', 'pointercancel', 'click']) {
      for (const capture of [true, false]) {
        const record = (event: Event) => {
          if (!(event instanceof MouseEvent) || records.length >= 80) return;
          const element = event.target instanceof Element ? event.target : null;
          const curve = element?.closest('.react-flow__edge')?.querySelector<SVGPathElement>('.react-flow__edge-path');
          const transform = curve?.getScreenCTM();
          records.push({ type, capture, time: performance.now(), eventPhase: event.eventPhase, x: event.clientX, y: event.clientY,
            button: event.button, buttons: event.buttons, detail: event.detail, defaultPrevented: event.defaultPrevented, cancelBubble: event.cancelBubble,
            pointerId: event instanceof PointerEvent ? event.pointerId : null,
            targetHasCapture: event instanceof PointerEvent ? element?.hasPointerCapture(event.pointerId) ?? false : null,
            target: describe(event.target), relatedTarget: describe(event.relatedTarget), path: curve?.getAttribute('d') ?? null,
            transform: transform ? { a: transform.a, b: transform.b, c: transform.c, d: transform.d, e: transform.e, f: transform.f } : null,
            ...snapshot({ x: event.clientX, y: event.clientY }) });
        };
        window.addEventListener(type, record, capture); disposers.push(() => window.removeEventListener(type, record, capture));
      }
    }
    traceHost.__vnsGameFlowClickTrace = () => {
      for (const dispose of disposers) dispose();
      delete traceHost.__vnsGameFlowClickTrace;
      return { initial, events: records, final: snapshot(point) };
    };
  }, point);
}
async function finishClickTrace() {
  return page!.evaluate(() => (window as unknown as { __vnsGameFlowClickTrace?: () => unknown }).__vnsGameFlowClickTrace?.());
}
async function selectEdge(id: string, mouseButton: 'left' | 'right' = 'left') {
  await expect(edge(id)).toBeVisible(); await stableViewport();
  const sampling = await edge(id).locator('.react-flow__edge-path').evaluate(element => {
    const curve = element as SVGPathElement, ctm = curve.getScreenCTM(); if (!ctm) throw new Error('Missing edge screen transform.');
    const id = curve.closest('.react-flow__edge')!.getAttribute('data-id')!, canvas = curve.closest('.flow-container')!, area = canvas.getBoundingClientRect();
    const length = curve.getTotalLength(), scale = Math.max(Math.hypot(ctm.a, ctm.b), Math.hypot(ctm.c, ctm.d));
    const count = Math.min(1600, Math.max(40, Math.ceil(length * scale / 2)));
    const fractions = [.5, .4, .6, .3, .7, .2, .8, .1, .9, ...Array.from({ length: count - 1 }, (_, index) => (index + 1) / count)];
    const excluded = '.react-flow__node, .react-flow__handle, .react-flow__edgeupdater, .react-flow__edgelabel-renderer';
    const samples = fractions.map(fraction => {
      const local = curve.getPointAtLength(length * fraction), point = new DOMPoint(local.x, local.y).matrixTransform(ctm);
      const inside = point.x > area.left + 3 && point.x < area.right - 3 && point.y > area.top + 3 && point.y < area.bottom - 3;
      const hits = inside ? document.elementsFromPoint(point.x, point.y) : [], hit = hits[0];
      const allowed = !!hit && hit.closest('.flow-container') === canvas && !hit.closest(excluded) && !!hit.closest('.react-flow__edge');
      const candidates = allowed ? [...new Set(hits.filter(item => item.closest('.flow-container') === canvas && !item.closest(excluded))
        .map(item => item.closest('.react-flow__edge')?.getAttribute('data-id')).filter((value): value is string => !!value))] : [];
      return { fraction, x: point.x, y: point.y, nativeEdgeId: hit?.closest('.react-flow__edge')?.getAttribute('data-id') ?? null, candidates, eligible: allowed && candidates.includes(id) };
    });
    const picked = samples.find(sample => sample.eligible);
    return { id, picked, sampled: samples.length, visibleCenterlineOnly: true, geometry: Array.from(canvas.querySelectorAll('.react-flow__edge')).map(group => {
      const path = group.querySelector<SVGPathElement>('.react-flow__edge-path'), matrix = path?.getScreenCTM();
      return { id: group.getAttribute('data-id'), d: path?.getAttribute('d'), transform: matrix ? { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f } : null };
    }) };
  });
  const { geometry, ...summary } = sampling;
  const recorded: Record<string, unknown> = { phase, mouseButton, ...summary }; selections.push(recorded);
  let failed = false, clickTraceActive = false;
  try {
    assert.ok(sampling.picked, 'No clickable visible centerline on ' + id);
    await startClickTrace(sampling.picked); clickTraceActive = true;
    await page!.mouse.click(sampling.picked.x, sampling.picked.y, { button: mouseButton });
    await expect(edge(id), 'A real visible-line click must select the intended edge.').toHaveClass(/selected/);
    await expect(page!.locator('.react-flow__edge.selected')).toHaveCount(1); await expect(inspector()).toBeVisible(); await simpleSelection();
  } catch (error) {
    failed = true;
    recorded.geometry = geometry;
    recorded.selectedAfter = await page!.locator('.react-flow__edge.selected').evaluateAll(elements => elements.map(element => element.getAttribute('data-id')));
    throw error;
  } finally {
    if (clickTraceActive) {
      const clickTrace = await finishClickTrace();
      if (failed) recorded.clickTrace = clickTrace;
    }
  }
}
async function selectNext(source: string) { await selectEdge(source + ':next'); }
async function expectRoute(source: string, target: string) {
  await expect(inspector()).toHaveAttribute('data-flow-transition-source', source);
  await expect(inspector()).toHaveAttribute('data-flow-transition-port', 'next');
  await expect(inspector()).toHaveAttribute('data-flow-transition-target', target);
}
async function modeIs(mode: Mode) { await expect(field('过渡方式').locator('option:checked')).toHaveText(mode); }
async function setMode(mode: Mode) { await field('过渡方式').selectOption({ label: mode }); }
async function number(name: string, value: number) {
  await field(name).fill(String(value)); await field(name).press('Tab');
  await expect.poll(async () => Number(await field(name).inputValue())).toBeCloseTo(value, 8);
}
async function details() {
  const summary = inspector().locator('summary').filter({ hasText: '分段时间与颜色' });
  if (!await summary.locator('..').evaluate(element => (element as HTMLDetailsElement).open)) await summary.click();
}
async function undo() { await page!.getByRole('button', { name: /^撤销/ }).first().click(); await settle(); }
async function redo() { await page!.getByRole('button', { name: /^重做/ }).first().click(); await settle(); }
async function drag(from: Point, to: Point) {
  await page!.mouse.move(from.x, from.y); await page!.mouse.down(); await page!.mouse.move(to.x, to.y, { steps: 20 }); await page!.mouse.up(); await settle();
}
async function connect(source: string, target: string) {
  await fit(); await drag(center(await bounds(node(source).locator('.source[data-handleid="next"]'))), center(await bounds(node(target).locator('.target[data-handleid="in"]'))));
}
async function reconnect(source: string, end: 'source' | 'target', next: string) {
  await fit(); await selectNext(source);
  const from = center(await bounds(nextEdge(source).locator('.react-flow__edgeupdater-' + end)));
  const to = center(await bounds(node(next).locator(`.${end}[data-handleid="${end === 'source' ? 'next' : 'in'}"]`)));
  const hits = await page!.evaluate(({ from, to }) => {
    const describe = (point: Point) => {
      const hit = document.elementFromPoint(point.x, point.y);
      return { className: hit?.getAttribute('class') ?? null, edgeId: hit?.closest('.react-flow__edge')?.getAttribute('data-id') ?? null,
        nodeId: hit?.closest('.react-flow__node')?.getAttribute('data-id') ?? null, handleId: hit?.getAttribute('data-handleid') ?? null,
        updater: !!hit?.classList.contains('react-flow__edgeupdater'),
        endpoint: hit?.classList.contains('react-flow__edgeupdater-source') ? 'source' : hit?.classList.contains('react-flow__edgeupdater-target') ? 'target' : null };
    };
    return { from: describe(from), to: describe(to) };
  }, { from, to });
  reconnections.push({ phase, source, end, next, from, to, hits });
  assert.equal(hits.from.updater, true, 'Reconnect must hit the actual invisible endpoint handle.');
  assert.equal(hits.from.edgeId, source + ':next', 'Shared endpoints must drag the selected edge, not another incident edge.');
  assert.equal(hits.from.endpoint, end, 'Reconnect must begin on the requested end of the selected edge.');
  await drag(from, to);
}
async function blankContext() {
  const point = await page!.locator('.flow-container').evaluate(element => {
    const rect = element.getBoundingClientRect();
    for (const y of [.12, .25, .5, .72, .86]) for (const x of [.1, .25, .5, .72, .88]) {
      const point = { x: Math.round(rect.left + rect.width * x), y: Math.round(rect.top + rect.height * y) };
      if (document.elementFromPoint(point.x, point.y)?.classList.contains('react-flow__pane')) return point;
    }
    return null;
  });
  assert.ok(point, 'Expected an actual empty canvas position for the context menu.');
  await page!.mouse.click(point.x, point.y, { button: 'right' });
  await expect(addDialog()).toBeVisible(); return point;
}
async function openAdd(source: 'toolbar' | 'node' | 'insert', nodeId?: string) {
  if (source === 'toolbar') await button('添加模块').click();
  else {
    assert.ok(nodeId); await clickNode(nodeId, 'right');
    await page!.getByRole('menuitem', { name: source === 'insert' ? '在此出口插入…' : '添加模块…', exact: true }).click();
  }
  await expect(addDialog()).toBeVisible();
}
async function chooseModule(kind: ModuleKind, resource: string) {
  const prefix = kind === '页面' ? 'page' : kind === '动画演出' ? 'blueprint' : 'video';
  await addDialog().locator(`[data-node-picker-item="${prefix}:${resource}"]`).click();
  await expect(addDialog()).toHaveCount(0);
}
async function submitModule(before: Project, expectedKind: GameFlowStep['kind']) {
  await expect(addDialog()).toHaveCount(0);
  await selectionTraceSnapshot('before-save');
  const saved = await save(), added = steps(saved).filter(item => !steps(before).some(old => old.id === item.id));
  await selectionTraceSnapshot('after-save');
  assert.equal(added.length, 1, 'Each add must create exactly one flow step.'); assert.equal(added[0].kind, expectedKind);
  const id = flowStepNodeId(added[0].id); await expect(node(id)).toHaveClass(/selected/); await expect(node(id)).toBeVisible();
  assert.deepEqual(protectedSnapshot(saved), protectedBefore, 'Adding a step must not alter referenced resources or story authoring.');
  return { saved, id, step: added[0] };
}
async function cancelModule(beforeHash: string, escape = false) {
  if (escape) await addDialog().press('Escape'); else await addDialog().getByRole('button', { name: '关闭节点搜索', exact: true }).click();
  await expect(addDialog()).toHaveCount(0); await unchanged(beforeHash);
}
async function topLevel() {
  for (let depth = 0; depth < 8 && await workspace().getAttribute('data-flow-scope') !== 'game'; depth++) await button('返回上一级').click();
  await expect(workspace()).toHaveAttribute('data-flow-scope', 'game'); await fit();
}

try {
  await fs.mkdir(output, { recursive: true }); authorHash = hash(await fs.readFile(authorProject)); report.authorSha256Before = authorHash;
  await writeGameFlowEditorAssets(path.dirname(projectFile)); await saveProject(projectFile, project);
  protectedBefore = protectedSnapshot(await read()); evidence.fixtureSha256Before = await fileHash(); await launch();

  await check('时间轴开场动画到标题的真实连线可编辑，查看与定位不写工程', async () => {
    const before = await fileHash(), stored = await read(), timeline = stored.timelinePresets!.find(item => item.id === ids.timeline)!;
    assert.equal(stored.blueprints.some(item => item.id === ids.timeline), false);
    assert.ok(timeline.nodes.some(item => item.type === 'savedAction' && JSON.parse(String(item.properties.action)).kind === 'visual'));
    assert.equal(timeline.nodes.find(item => item.id === timeline.timeline!.tailNodeId)?.properties.seconds, 3);
    assert.equal(connection(stored, openingId), flowNodeIds.title); assert.equal(stored.gameFlow?.transitions, undefined);
    await selectNext(openingId); await expectRoute(openingId, flowNodeIds.title); await modeIs('不单独设置');
    await expect(inspector().locator('.flow-transition-route')).toContainText('开场动画');
    await expect(inspector().locator('.flow-transition-route')).toContainText('标题'); await expect(marker(openingId)).toHaveCount(0);
    await inspector().locator('.flow-transition-route').getByRole('button').first().click();
    await expect(node(openingId)).toHaveClass(/selected/); await expect(workspace()).toHaveAttribute('data-flow-scope', 'game'); await fit();
    await selectNext(openingId); await inspector().locator('.flow-transition-route').getByRole('button').last().click();
    await expect(node(flowNodeIds.title)).toHaveClass(/selected/); await expect(workspace()).toHaveAttribute('data-flow-scope', 'game'); await fit();
    await selectNext(openingId); await unchanged(before); await screenshot('01-opening-to-title');
  });

  await check('顶层显式直接切换与沿用区分，方式修改和恢复支持单次撤销重做', async () => {
    await setMode('直接切换'); assert.deepEqual(transition(await save(), openingId), { mode: 'none' }); await expect(marker(openingId)).toBeVisible();
    await undo(); await modeIs('不单独设置'); assert.equal((await save()).gameFlow?.transitions, undefined); await expect(marker(openingId)).toHaveCount(0);
    await redo(); await modeIs('直接切换'); assert.deepEqual(transition(await save(), openingId), { mode: 'none' });
    await setMode('不单独设置'); assert.equal((await save()).gameFlow?.transitions, undefined);
    await undo(); await modeIs('直接切换'); assert.deepEqual(transition(await save(), openingId), { mode: 'none' });
    await redo(); await modeIs('不单独设置'); assert.equal((await save()).gameFlow?.transitions, undefined);
  });

  await check('直接叠化黑白和自定义分段分别保存退出独立进程再重开', async () => {
    const values: { mode: Mode; expected: FlowTransition }[] = [
      { mode: '直接切换', expected: { mode: 'none' } }, { mode: '叠化', expected: { mode: 'dissolve', duration: .65 } },
      { mode: '淡黑', expected: { mode: 'color', color: '#000000', outDuration: .25, hold: .125, inDuration: .625 } },
      { mode: '淡白', expected: { mode: 'color', color: '#ffffff', outDuration: .25, hold: .125, inDuration: .625 } },
      { mode: '经过颜色', expected: color },
    ];
    const reopenings: unknown[] = [];
    for (const [index, value] of values.entries()) {
      await selectNext(openingId); await setMode(value.mode);
      if (value.expected.mode === 'dissolve') await number('总时长（秒）', value.expected.duration);
      else if (value.expected.mode === 'color') {
        await details(); await number('淡出（秒）', .25); await number('停留（秒）', .125); await number('淡入（秒）', .625);
        if (value.mode === '经过颜色') {
          await field('过渡颜色').fill(value.expected.color); await field('过渡颜色').press('Tab'); await number('总时长（秒）', 2);
        }
      }
      let saved = await save(); assert.deepEqual(transition(saved, openingId), value.expected);
      const authored = saved.gameFlow, beforeProcess = app!.process().pid; await close(); await launch();
      saved = await read(); assert.deepEqual(saved.gameFlow, authored); assert.deepEqual(protectedSnapshot(saved), protectedBefore);
      await selectNext(openingId); await expectRoute(openingId, flowNodeIds.title); await modeIs(value.mode); await expect(marker(openingId)).toBeVisible();
      if (value.expected.mode === 'none') await expect(field('总时长（秒）')).toHaveCount(0);
      else if (value.expected.mode === 'dissolve') await expect.poll(async () => Number(await field('总时长（秒）').inputValue())).toBe(.65);
      else {
        await details(); const expected = value.expected;
        for (const [label, amount] of [['淡出（秒）', expected.outDuration], ['停留（秒）', expected.hold], ['淡入（秒）', expected.inDuration]] as const) {
          await expect.poll(async () => Number(await field(label).inputValue())).toBeCloseTo(amount, 8);
        }
        await expect(field('过渡颜色')).toHaveValue(expected.color);
      }
      reopenings.push({ mode: value.mode, beforeProcess, afterProcess: app!.process().pid, transition: transition(saved, openingId) });
      await screenshot(`02-reopened-${index}-${value.expected.mode}`);
    }
    evidence.reopenings = reopenings;
    await field('总时长（秒）').fill(''); await field('总时长（秒）').press('Tab');
    await expect.poll(async () => Number(await field('总时长（秒）').inputValue())).toBeCloseTo(2, 8);
    await expect(page!.locator('.dirty-dot')).toHaveCount(0); assert.deepEqual(transition(await read(), openingId), color);
  });

  await check('顶层效果示意播放暂停拖动不改工程，样例与实际游戏区分', async () => {
    const before = await fileHash(), slider = field('效果示意进度'), preview = inspector().locator('[data-flow-transition-preview]');
    await expect(preview).toBeVisible(); await expect(inspector()).toContainText('样例'); await slider.press('Home');
    const min = Number(await slider.getAttribute('min') ?? 0), max = Number(await slider.getAttribute('max') ?? 100);
    await inspector().getByRole('button', { name: '播放效果示意', exact: true }).click();
    await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(min);
    await inspector().getByRole('button', { name: '暂停效果示意', exact: true }).click();
    const paused = await slider.inputValue(); await settle(); await settle(); assert.equal(await slider.inputValue(), paused);
    const track = await bounds(slider); await page!.mouse.click(track.x + track.width * .7, track.y + track.height / 2);
    const progress = (Number(await slider.inputValue()) - min) / (max - min); assert.ok(progress > .55 && progress < .85);
    await expect(preview.locator('.flow-transition-sample.after')).toHaveCSS('opacity', '1');
    const opacity = Number(await preview.locator('.flow-transition-sample-color').evaluate(element => getComputedStyle(element).opacity)); assert.ok(opacity > 0 && opacity < 1);
    await slider.press('End'); await expect(preview.locator('.flow-transition-sample-color')).toHaveCSS('opacity', '0');
    await unchanged(before); evidence.preview = { progress, colorOpacity: opacity }; await screenshot('03-top-level-preview');
  });

  await check('启动入口新游戏入口与开场步骤分别保存自己的过渡', async () => {
    await selectNext(flowNodeIds.launch); await expectRoute(flowNodeIds.launch, openingId); await modeIs('不单独设置'); await setMode('直接切换');
    await selectNext(flowNodeIds.newGame); await expectRoute(flowNodeIds.newGame, flowNodeIds.story); await modeIs('不单独设置');
    await setMode('叠化'); await number('总时长（秒）', .31);
    const saved = await save(); assert.deepEqual(transition(saved, flowNodeIds.launch), { mode: 'none' });
    assert.deepEqual(transition(saved, flowNodeIds.newGame), { mode: 'dissolve', duration: .31 }); assert.deepEqual(transition(saved, openingId), color);
    assert.deepEqual(Object.keys(saved.gameFlow!.transitions!).sort(), [flowNodeIds.launch, flowNodeIds.newGame, openingId].sort());
    await selectNext(openingId); await modeIs('经过颜色'); await expectRoute(openingId, flowNodeIds.title);
  });

  await check('常驻入口与空白右键直接打开分类搜索菜单，三类资源含已有时间轴，取消不写入', async () => {
    const before = await fileHash(); await expect(button('添加模块')).toBeVisible(); await clickNode(openingId); await openAdd('toolbar');
    await expect(addDialog().getByLabel('流程节点插入位置')).toHaveCount(0);
    for (const [kind, resource] of [['页面', ids.page], ['动画演出', ids.timeline], ['视频', ids.video]] as const) {
      const prefix = kind === '页面' ? 'page' : kind === '动画演出' ? 'blueprint' : 'video';
      await expect(addDialog().locator(`[data-node-picker-item="${prefix}:${resource}"]`)).toBeEnabled();
    }
    await screenshot('04-add-module-menu'); await cancelModule(before);
    await selectNext(openingId); await openAdd('toolbar'); await expect(addDialog()).toContainText('再拖动出口连接');
    await addDialog().getByLabel('搜索要添加的节点').fill('不存在的模块名字');
    await expect(addDialog().locator('[data-node-picker-item]')).toHaveCount(0); await cancelModule(before, true);
    await openAdd('node', openingId); await expect(addDialog()).toContainText('再拖动出口连接'); await cancelModule(before);
  });

  await check('明确在出口插入才自动衔接，保留来源过渡并且单次撤销重做', async () => {
    const before = await save(); await fit(); await openAdd('insert', openingId);
    await expect(addDialog()).toContainText('在此出口插入'); await expect(addDialog()).toContainText('原出口');
    await expect(addDialog().getByLabel('流程节点插入位置')).toHaveCount(0); await chooseModule('动画演出', ids.blueprint);
    const added = await submitModule(before, 'blueprint'); insertedId = added.id;
    assert.equal(connection(added.saved, openingId), insertedId); assert.equal(connection(added.saved, insertedId), flowNodeIds.title);
    assert.deepEqual(transition(added.saved, openingId), color); assert.equal(transition(added.saved, insertedId), undefined);
    await expect(marker(openingId)).toBeVisible(); await expect(marker(insertedId)).toHaveCount(0);
    await undo(); assert.deepEqual((await save()).gameFlow, before.gameFlow); await expect(node(insertedId)).toHaveCount(0);
    await redo(); assert.deepEqual((await save()).gameFlow, added.saved.gameFlow); await expect(node(insertedId)).toBeVisible();
    await fit(); await selectNext(openingId); await expectRoute(openingId, insertedId); await screenshot('05-inserted-edge-transition');
  });

  await check('删除插入模块衔接前后并只清其自身过渡，撤销完整恢复', async () => {
    await selectNext(insertedId); await setMode('直接切换'); const before = await save();
    await clickNode(insertedId); await button('删除节点并衔接前后').click(); let saved = await save();
    assert.equal(steps(saved).some(item => flowStepNodeId(item.id) === insertedId), false);
    assert.equal(connection(saved, openingId), flowNodeIds.title); assert.deepEqual(transition(saved, openingId), color);
    assert.equal(transition(saved, insertedId), undefined); await expect(node(insertedId)).toHaveCount(0);
    await undo(); saved = await save(); assert.deepEqual(saved.gameFlow, before.gameFlow); await expect(marker(insertedId)).toBeVisible();
    await redo(); saved = await save(); assert.equal(connection(saved, openingId), flowNodeIds.title); assert.equal(transition(saved, insertedId), undefined);
  });

  await check('选择旧连线后顶部添加仍只放独立节点，手动接入新游戏且参数与过渡独立', async () => {
    const before = await save(); await fit(); await selectNext(openingId);
    const viewport = await page!.locator('.react-flow__viewport').getAttribute('style');
    await openAdd('toolbar'); await chooseModule('页面', ids.page);
    const added = await submitModule(before, 'page'); pageStepId = added.id;
    assert.deepEqual(added.saved.gameFlow!.connections, before.gameFlow!.connections);
    assert.equal(connection(added.saved, pageStepId), undefined); assert.equal(transition(added.saved, pageStepId), undefined);
    assert.equal(await page!.locator('.react-flow__viewport').getAttribute('style'), viewport, 'Normal creation must keep the current view.');
    await clickNode(pageStepId); await page!.getByLabel('流程后续节点', { exact: true }).selectOption(flowNodeIds.story);
    await clickNode(flowNodeIds.newGame); await page!.getByLabel('流程后续节点', { exact: true }).selectOption(pageStepId);
    const joined = await save(); assert.equal(connection(joined, flowNodeIds.newGame), pageStepId); assert.equal(connection(joined, pageStepId), flowNodeIds.story);
    assert.ok(joined.gameFlow!.beforeNewGame.some(step => flowStepNodeId(step.id) === pageStepId));
    assert.deepEqual(transition(joined, flowNodeIds.newGame), { mode: 'dissolve', duration: .31 }); await fit(); await clickNode(pageStepId);
    await page!.getByLabel('节点完成方式', { exact: true }).selectOption('auto'); await page!.getByLabel('节点停留秒数', { exact: true }).fill('0.6');
    await page!.getByLabel('节点停留秒数', { exact: true }).press('Tab'); await page!.getByLabel('节点取消后', { exact: true }).selectOption('title');
    const saved = await save(), pageStep = findStep(saved, pageStepId); assert.ok(pageStep.kind === 'page');
    assert.deepEqual({ completion: pageStep.completion, duration: pageStep.duration, cancel: pageStep.cancel }, { completion: 'auto', duration: .6, cancel: 'title' });
    assert.deepEqual(protectedSnapshot(saved), protectedBefore);
  });

  await check('节点右键明确插入视频保留后续目标且可撤销', async () => {
    const before = await save(); await fit(); await openAdd('insert', pageStepId);
    await expect(addDialog()).toContainText('自动衔接原后续模块'); await chooseModule('视频', ids.video);
    const added = await submitModule(before, 'video'); videoStepId = added.id;
    assert.equal(connection(added.saved, pageStepId), videoStepId); assert.equal(connection(added.saved, videoStepId), flowNodeIds.story);
    assert.ok(added.step.kind === 'video'); assert.equal(added.step.assetId, ids.video);
    assert.equal(transition(added.saved, videoStepId), undefined); assert.deepEqual(transition(added.saved, openingId), color);
    await undo(); assert.deepEqual((await save()).gameFlow, before.gameFlow); await redo(); assert.deepEqual((await save()).gameFlow, added.saved.gameFlow);
    await fit(); await selectNext(pageStepId); await expectRoute(pageStepId, videoStepId); await modeIs('不单独设置'); await setMode('淡黑');
    await number('总时长（秒）', 1); await selectNext(videoStepId); await expectRoute(videoStepId, flowNodeIds.story); await modeIs('不单独设置'); await setMode('直接切换');
    const saved = await save(); assert.deepEqual(transition(saved, videoStepId), { mode: 'none' });
    assert.deepEqual(transition(saved, pageStepId), { mode: 'color', color: '#000000', outDuration: .5, hold: 0, inDuration: .5 });
    assert.deepEqual(transition(saved, openingId), color); await screenshot('06-context-added-video');
  });

  await check('旧节点选中时鼠标与键盘新增均选中新模块并保持视口，空白右键坐标准确且能手动接入标题', async () => {
    const before = await save(), beforeHash = await fileHash(); await fit(); await clickNode(pageStepId); await blankContext();
    await expect(addDialog().getByLabel('流程节点插入位置')).toHaveCount(0); await cancelModule(beforeHash);
    await startSelectionTrace();
    await clickNode(openingId);
    const mouseViewport = await page!.locator('.react-flow__viewport').getAttribute('style');
    await openAdd('toolbar'); await chooseModule('页面', ids.page);
    const mouseAdded = await submitModule(before, 'page');
    await expect(page!.locator('.react-flow__node.selected')).toHaveCount(1);
    await expect(node(openingId)).not.toHaveClass(/selected/);
    assert.deepEqual(mouseAdded.saved.gameFlow!.connections, before.gameFlow!.connections);
    assert.equal(await page!.locator('.react-flow__viewport').getAttribute('style'), mouseViewport, 'Mouse creation with an old selected node must not move the view.');
    await undo(); assert.deepEqual((await save()).gameFlow, before.gameFlow); await expect(node(mouseAdded.id)).toHaveCount(0);
    await clickNode(openingId); const at = await blankContext();
    const keyboardViewport = await page!.locator('.react-flow__viewport').getAttribute('style');
    const expectedPosition = await page!.locator('.react-flow__viewport').evaluate((element, at) => {
      const matrix = new DOMMatrix(getComputedStyle(element).transform), canvas = element.closest('.flow-container')!.getBoundingClientRect();
      return { x: (at.x - canvas.left - matrix.e) / matrix.a, y: (at.y - canvas.top - matrix.f) / matrix.d };
    }, at);
    const search = addDialog().getByLabel('搜索要添加的节点'); await search.fill('page:' + ids.page);
    await expect(addDialog().locator('[data-node-picker-item]')).toHaveCount(1); await search.press('ArrowDown'); await search.press('Enter');
    await selectionTraceSnapshot('after-enter');
    const added = await submitModule(before, 'page'); titlePageId = added.id;
    await expect(page!.locator('.react-flow__node.selected')).toHaveCount(1);
    await expect(node(openingId)).not.toHaveClass(/selected/);
    assert.equal(await page!.locator('.react-flow__viewport').getAttribute('style'), keyboardViewport, 'Keyboard creation with an old selected node must not move the view.');
    await selectionTraceSnapshot('created-selected', true);
    assert.deepEqual(added.saved.gameFlow!.connections, before.gameFlow!.connections);
    const actualPosition = added.saved.gameFlow!.positions![titlePageId];
    assert.ok(Math.abs(actualPosition.x - expectedPosition.x) < 1 && Math.abs(actualPosition.y - expectedPosition.y) < 1);
    assert.deepEqual(transition(added.saved, openingId), color); assert.equal(transition(added.saved, titlePageId), undefined);
    await undo(); assert.deepEqual((await save()).gameFlow, before.gameFlow); await redo(); assert.deepEqual((await save()).gameFlow, added.saved.gameFlow);
    await fit(); await clickNode(titlePageId); await page!.getByLabel('流程后续节点', { exact: true }).selectOption(flowNodeIds.title);
    await clickNode(openingId); await page!.getByLabel('流程后续节点', { exact: true }).selectOption(titlePageId);
    const joined = await save(); assert.equal(connection(joined, openingId), titlePageId); assert.equal(connection(joined, titlePageId), flowNodeIds.title);
    assert.equal(connection(joined, pageStepId), videoStepId); assert.equal(connection(joined, videoStepId), flowNodeIds.story);
  });

  await check('终点有一个或多个前驱时新增均不推导插入位置，取消不改线', async () => {
    const before = await save(), beforeHash = await fileHash(); await fit(); await clickNode(flowNodeIds.title); await openAdd('toolbar');
    await expect(addDialog()).toContainText('再拖动出口连接'); await cancelModule(beforeHash);
    await clickNode(spareId); await page!.getByLabel('流程后续节点', { exact: true }).selectOption(flowNodeIds.title); await save();
    const ambiguousHash = await fileHash(); await clickNode(flowNodeIds.title); await openAdd('toolbar');
    await expect(addDialog().getByLabel('流程节点插入位置')).toHaveCount(0);
    await expect(addDialog().locator(`[data-node-picker-item="page:${ids.page}"]`)).toBeEnabled(); await cancelModule(ambiguousHash);
    await undo(); assert.deepEqual((await save()).gameFlow, before.gameFlow);
  });

  await check('真实拖动目标端保留原来源设置，同目标重接不增加写入', async () => {
    await connect(spareId, titlePageId); await save(); await selectNext(spareId); await setMode('直接切换'); await save();
    const before = await read();
    // Two sources deliberately share this input. Selecting opening's wire must
    // make its endpoint draggable even though spare's wire was created later.
    assert.equal(connection(before, openingId), titlePageId); assert.equal(connection(before, spareId), titlePageId);
    await reconnect(openingId, 'target', spareId); let saved = await save();
    assert.equal(connection(saved, openingId), spareId); assert.deepEqual(transition(saved, openingId), color); assert.deepEqual(transition(saved, spareId), { mode: 'none' });
    await selectNext(openingId); await expectRoute(openingId, spareId); await undo(); saved = await save(); assert.deepEqual(saved.gameFlow, before.gameFlow);
    const beforeHash = await fileHash(); await reconnect(openingId, 'target', titlePageId); await unchanged(beforeHash);
    assert.deepEqual((await read()).gameFlow, before.gameFlow);
    // A no-op reconnect must not consume an undo entry. The next undo reaches
    // the previous authored change: the spare source's explicit direct cut.
    await undo(); saved = await save(); assert.equal(transition(saved, spareId), undefined);
    assert.equal(connection(saved, spareId), titlePageId); assert.equal(connection(saved, openingId), titlePageId); assert.deepEqual(transition(saved, openingId), color);
    await redo(); assert.deepEqual((await save()).gameFlow, before.gameFlow);
  });

  await check('真实拖动来源端采用新出口设置，原出口配置保留并可撤销', async () => {
    const before = await save(); await reconnect(openingId, 'source', spareId); const saved = await save();
    assert.equal(connection(saved, openingId), undefined); assert.equal(connection(saved, spareId), titlePageId);
    assert.deepEqual(transition(saved, openingId), color); assert.deepEqual(transition(saved, spareId), { mode: 'none' });
    await expect(marker(openingId)).toHaveCount(0); await selectNext(spareId); await modeIs('直接切换'); await expectRoute(spareId, titlePageId);
    await clickNode(openingId); await expect(inactiveTransition(openingId)).toBeVisible();
    await undo(); assert.deepEqual((await save()).gameFlow, before.gameFlow); await expect(marker(openingId)).toBeVisible();
  });

  await check('断开后可查看移除并撤销未启用设置，真实重连恢复标记和路由', async () => {
    const before = await save(); await fit(); await selectNext(openingId); await nextEdge(openingId).focus(); await page!.keyboard.press('Delete');
    let saved = await save(); assert.equal(connection(saved, openingId), undefined); assert.deepEqual(transition(saved, openingId), color);
    await expect(marker(openingId)).toHaveCount(0); await clickNode(openingId);
    const inactive = inactiveTransition(openingId);
    await expect(inactive).toBeVisible(); await expect(inactive).toContainText(/未连接|尚未连接/);
    await inactive.getByRole('button', { name: '移除未启用过渡', exact: true }).click(); saved = await save(); assert.equal(transition(saved, openingId), undefined);
    await undo(); assert.deepEqual(transition(await save(), openingId), color); await expect(inactive).toBeVisible();
    await connect(openingId, titlePageId); saved = await save(); assert.deepEqual(saved.gameFlow, before.gameFlow); await expect(marker(openingId)).toBeVisible();
    await undo(); saved = await save(); assert.equal(connection(saved, openingId), undefined); assert.deepEqual(transition(saved, openingId), color);
    await redo(); assert.deepEqual((await save()).gameFlow, before.gameFlow); await screenshot('07-restored-top-level-edge');
  });

  await check('菜单按钮读档动态返回及页面取消路径保持只读，无过渡标记和端点圈', async () => {
    await fit(); const beforeHash = await fileHash(), before = (await read()).gameFlow;
    const buttonEdges = await page!.locator('.react-flow__edge').evaluateAll(elements => elements.map(element => element.getAttribute('data-id')!).filter(id => id.startsWith('flow:title:')));
    assert.equal(buttonEdges.length, 3, 'The fixture must expose the real start/load/settings buttons.');
    for (const id of [...buttonEdges, 'flow:load:restore', 'flow:story:returnTitle', pageStepId + ':cancel']) {
      await selectEdge(id); await expect(field('过渡方式')).toHaveCount(0);
      await expect(page!.locator(`button[data-flow-transition-edge="${id}"]`)).toHaveCount(0);
    }
    await node(flowNodeIds.title).dblclick(); await expect(workspace()).toHaveAttribute('data-flow-scope', 'page:ui:main'); await fit();
    const pageEdges = await page!.locator('.react-flow__edge').evaluateAll(elements => elements.map(element => element.getAttribute('data-id')!));
    assert.equal(pageEdges.length, 3);
    for (const id of pageEdges) { await selectEdge(id); await expect(field('过渡方式')).toHaveCount(0); }
    await unchanged(beforeHash); assert.deepEqual((await read()).gameFlow, before); await screenshot('08-menu-events-remain-readonly'); await topLevel();
  });

  await check('原剧情台词分支过渡和界面资源保持不变，进出层级不改顶层配置', async () => {
    const beforeHash = await fileHash(), before = (await read()).gameFlow;
    await node(flowNodeIds.story).dblclick(); await expect(workspace()).toHaveAttribute('data-flow-scope', 'content'); await fit();
    await node(storySceneNodeId(ids.scene)).dblclick(); await expect(workspace()).toHaveAttribute('data-flow-scope', 'scene:' + ids.scene + ':'); await fit();
    await selectNext(ids.passage); await expectRoute(ids.passage, ids.branch); await modeIs('叠化');
    await expect.poll(async () => Number(await field('总时长（秒）').inputValue())).toBe(.42);
    await selectEdge(ids.branch + ':yes'); await modeIs('经过颜色'); await details(); await expect(field('过渡颜色')).toHaveValue('#436789');
    await selectEdge(ids.branch + ':no'); await modeIs('直接切换'); await expect(button('添加模块')).toHaveCount(0);
    await unchanged(beforeHash); const saved = await read(); assert.deepEqual(protectedSnapshot(saved), protectedBefore); assert.deepEqual(saved.gameFlow, before);
    await screenshot('09-original-story-transitions'); await topLevel();
  });

  await check('最终拓扑独立重开保留，明暗窄窗可找到新增入口和全部过渡参数', async () => {
    const before = await save(); await close(); await launch(); assert.deepEqual((await read()).gameFlow, before.gameFlow);
    assert.deepEqual(protectedSnapshot(await read()), protectedBefore); await selectNext(openingId); await expectRoute(openingId, titlePageId); await modeIs('经过颜色');
    const layouts: unknown[] = [];
    for (const theme of ['黑白', '亮白']) {
      await button('作品设置').click(); await button('编辑器外观').click();
      await page!.getByRole('group', { name: '编辑器配色', exact: true }).getByRole('button', { name: new RegExp('^' + theme) }).click(); await button('关闭作品设置').click();
      for (const width of [1600, 1100]) {
        await app!.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 940), width); await settle(); await details();
        await expect(button('添加模块')).toBeVisible();
        const layout = await inspector().evaluate(element => {
          const root = element as HTMLElement, rect = root.getBoundingClientRect();
          return { width: rect.width, left: rect.left, right: rect.right, scrollWidth: root.scrollWidth, clientWidth: root.clientWidth,
            controls: Array.from(root.querySelectorAll<HTMLElement>('input,select,summary,button')).filter(item => item.getClientRects().length).map(item => {
              const box = item.getBoundingClientRect(); return { label: item.getAttribute('aria-label') ?? item.textContent?.trim(), left: box.left, right: box.right, width: box.width };
            }), documentOverflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert.ok(layout.width > 200); assert.equal(layout.documentOverflow, false); assert.ok(layout.scrollWidth <= layout.clientWidth + 1);
        for (const control of layout.controls) assert.ok(control.width > 0 && control.left >= layout.left - 1 && control.right <= layout.right + 1, JSON.stringify(control));
        await field('总时长（秒）').focus(); await expect(field('总时长（秒）')).toBeFocused(); await field('总时长（秒）').press('Tab');
        const beforeHash = await fileHash(); await openAdd('toolbar'); await expect(addDialog().getByLabel('流程节点插入位置')).toHaveCount(0);
        const dialogRect = await bounds(addDialog()); assert.ok(dialogRect.x >= 0 && dialogRect.width <= width);
        await cancelModule(beforeHash, true); layouts.push({ theme, windowWidth: width, ...layout });
        await screenshot(`10-${theme === '亮白' ? 'light' : 'dark'}-${width}`);
      }
    }
    evidence.layouts = layouts; const saved = await save(); assert.deepEqual(saved.gameFlow, before.gameFlow); assert.deepEqual(protectedSnapshot(saved), protectedBefore);
    await fs.copyFile(projectFile, path.join(output, 'saved-project.json'));
  });

  assert.equal(checks.length, 18); assert.deepEqual(errors, [], 'Renderer must not raise runtime errors.'); report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = String(error);
  await fs.copyFile(projectFile, path.join(output, 'failure-fixture.json')).then(() => { report.failureFixture = 'last saved isolated project; no extra save'; }).catch(copyError => { report.failureFixtureError = String(copyError); });
  if (app && page && !page.isClosed()) {
    report.scopeAtFailure = await workspace().getAttribute('data-flow-scope').catch(() => undefined);
    report.inspectorAtFailure = await inspector().innerText().catch(() => undefined);
    report.dialogAtFailure = await addDialog().innerText({ timeout: 1000 }).catch(() => undefined);
    await screenshot('failure').catch(captureError => { report.captureError = String(captureError); });
  }
} finally {
  await selectionTraceSnapshot('final', true).catch(error => { evidence.selectionTraceError = String(error); });
  try { await close(); } catch (error) { failure ??= error; report.status = 'failed'; report.closeError = String(error); }
  try {
    report.authorSha256After = hash(await fs.readFile(authorProject));
    if (authorHash !== undefined) assert.equal(report.authorSha256After, authorHash, 'The real author project changed during isolated desktop acceptance.');
  } catch (error) { failure ??= error; report.status = 'failed'; report.authorProtectionError = String(error); }
  try {
    if (app || processes.some(item => !item.exited)) throw new Error('An owned fixture process remains alive; retaining temporary directories.');
    const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); report.cleanup = cleanup; assert.deepEqual(cleanup.errors, []);
  } catch (error) { failure ??= error; report.status = 'failed'; report.cleanupError = String(error); }
  await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
}
if (failure) throw failure;
