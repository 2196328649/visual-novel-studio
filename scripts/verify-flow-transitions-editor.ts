import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { createProject, projectSchema, targets, type Project, type StoryNode } from '../src/core/model';
import { type FlowTransition } from '../src/core/flow-transitions';
import { storyGroupNodeId, storySceneNodeId } from '../src/core/story-groups';
import { applyTextScript } from '../src/core/text-script';
import { validateProject } from '../src/core/validate';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Author the complete feature first, then run against the compiled development
// editor. This script never starts Vite or edits the author's project.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Use the isolated compiled development editor.');
const root = path.resolve('.');
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ? path.join(process.env.VNS_ARTIFACT_ROOT, 'flow-transitions-editor') : 'artifacts/flow-transitions-2026-11-09', 'editor-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const profile = path.join(output, 'profile');
const projectFile = path.join(output, 'project/project.vns.json');
const sourceFile = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? '../我的视觉小说1/project.vns.json');
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const mainScene = 'transition_main', portsScene = 'transition_ports';
const project = createProject('剧情连线过渡桌面验收');
project.id = 'flow_transition_editor_acceptance';
project.resourceSettings = { importMode: 'copy', directory: 'assets', syncFolders: false };
project.chapters = [{ id: 'transition_chapter', name: '连线过渡验收' }];
project.scenes = [
  { id: mainScene, chapterId: 'transition_chapter', name: '过渡与分组' },
  { id: portsScene, chapterId: 'transition_chapter', name: '真实出口' },
];
project.variables = [{ id: 'transition_flag', name: '分支参数', type: 'boolean', initial: true, persistent: false }];
const base = (id: string, name: string, x: number, y: number, sceneId = mainScene) => ({ id, name, x, y, sceneId });
const passage = (id: string, name: string, x: number, y: number, next?: string, sceneId = mainScene): StoryNode => ({
  ...base(id, name, x, y, sceneId), kind: 'passage', next,
  lines: [{ id: id + '_line', text: id === 'alpha' ? '原有台词甲，过渡不改变文字演出。' : name + '的台词。', actions: [] }],
});
const dissolve = (duration: number): FlowTransition => ({ mode: 'dissolve', duration });
const color = (hex: string, outDuration = .25, hold = .1, inDuration = .65): FlowTransition => ({ mode: 'color', color: hex, outDuration, hold, inDuration });
project.entryId = 'begin';
project.nodes = [
  { ...base('begin', '故事开始', 0, 200), kind: 'start', next: 'alpha' },
  passage('alpha', '甲段落', 320, 200, 'branch'),
  { ...base('branch', '条件分支', 660, 200), kind: 'condition', condition: { kind: 'compare', variableId: 'transition_flag', operator: 'eq', value: true }, yes: 'beta', no: 'gamma' },
  passage('beta', '乙段落', 1000, 0, 'merge'),
  passage('gamma', '丙段落', 1000, 430, 'merge'),
  { ...passage('spare', '备用出口', 320, 520), transitions: { next: { mode: 'none' } } },
  passage('merge', '分支汇合', 1370, 200, 'ending'),
  { ...base('ending', '返回标题', 1700, 200), kind: 'end' },
  { ...base('pick', '选择测试', 0, 0, portsScene), kind: 'choice', prompt: '选择一条路径', choices: [
    { id: 'pick_left', text: '左路', target: 'spot' }, { id: 'pick_right', text: '右路', target: 'mini' },
  ], transitions: { pick_left: dissolve(.31), pick_right: color('#ffffff') } },
  { ...base('spot', '互动测试', 360, 0, portsScene), kind: 'interaction', prompt: '点击区域', showHints: true,
    hotspots: [{ id: 'spot_door', name: '门', x: .1, y: .1, width: .3, height: .3, target: 'call_test' }],
    timeoutSeconds: 3, timeout: 'mini', cancel: 'port_end',
    transitions: { spot_door: dissolve(.32), timeout: { mode: 'none' }, cancel: color('#456789') } },
  { ...base('mini', '小游戏测试', 360, 440, portsScene), kind: 'minigame', template: 'password', title: '小游戏', prompt: '输入密码',
    password: '1234', caseSensitive: false, attempts: 3, targetClicks: 5, timeLimit: 10,
    success: 'call_test', failure: 'jump_test', cancel: 'port_end',
    transitions: { success: dissolve(.33), failure: color('#000000'), cancel: { mode: 'none' } } },
  { ...base('call_test', '调用测试', 750, 0, portsScene), kind: 'call', target: 'sub_story', next: 'port_end',
    transitions: { target: dissolve(.34), next: color('#ffffff') } },
  { ...base('jump_test', '跳转测试', 750, 440, portsScene), kind: 'jump', target: 'set_test', transitions: { target: dissolve(.35) } },
  { ...base('set_test', '参数赋值测试', 1100, 440, portsScene), kind: 'set', variableId: 'transition_flag', operation: 'set', value: false,
    next: 'title_test', transitions: { next: dissolve(.36) } },
  { ...base('title_test', '标题演出测试', 1450, 440, portsScene), kind: 'chapterTitle', title: '场间标题', subtitle: '', duration: 1,
    next: 'port_end', transitions: { next: dissolve(.37) } },
  { ...passage('sub_story', '被调用内容', 1100, 0, 'sub_return', portsScene), transitions: { next: dissolve(.38) } },
  { ...base('sub_return', '返回调用处', 1450, 0, portsScene), kind: 'return' },
  { ...base('port_end', '出口验收结束', 1800, 300, portsScene), kind: 'end' },
];

type Point = { x: number; y: number };
type Rect = Point & { width: number; height: number };
type Mode = '不单独设置' | '直接切换' | '叠化' | '淡黑' | '淡白' | '经过颜色';
let app: ElectronApplication | undefined, page: Page | undefined, failure: unknown, phase = 'prepare';
let sourceHash: string | undefined;
const errors: string[] = [], checks: { name: string; durationMs: number }[] = [];
const processes: { pid?: number; exited: boolean }[] = [];
const evidence: Record<string, unknown> = {};
const edgeSelections: unknown[] = []; evidence.edgeSelections = edgeSelections;
const report: Record<string, unknown> = { status: 'running', renderer: 'compiled', checks, errors, processes, evidence, sourceFile,
  temporaryPaths: [path.dirname(projectFile), profile] };
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const workspace = () => page!.getByRole('region', { name: '流程图', exact: true });
const node = (id: string) => page!.locator(`.react-flow__node[data-id="${id}"]`);
const edge = (id: string) => page!.locator(`.react-flow__edge[data-id="${id}"]`);
const marker = (id: string) => page!.locator(`button[data-flow-transition-edge="${id}"]`);
const inspector = () => page!.locator('aside[data-flow-transition-inspector]');
const field = (name: string) => inspector().getByLabel(name, { exact: true });
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const find = (value: Project, id: string) => { const found = value.nodes.find(item => item.id === id); assert.ok(found, 'Missing story node ' + id); return found; };
const transition = (value: Project, id: string, port = 'next') => find(value, id).transitions?.[port];
const transitionSnapshot = (value: Project) => Object.fromEntries(value.nodes.filter(item => item.transitions).map(item => [item.id, item.transitions]));
const settle = async () => page!.evaluate(async () => {
  await document.fonts.ready;
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
});
const bounds = async (target: Locator): Promise<Rect> => {
  const value = await target.boundingBox(); assert.ok(value && value.width && value.height, 'Expected a rendered non-empty rectangle.'); return value;
};
const center = (rect: Rect): Point => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile });
  processes.push({ pid: app.process().pid, exited: false }); page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window.isMaximized()) window.unmaximize();
    window.setContentSize(1600, 1000); window.webContents.setBackgroundThrottling(false);
  });
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html'));
  report.rendererUrl = page.url(); await page.evaluate('globalThis.__name = value => value');
  await page.locator('[data-workspace-tab="flowchart"]').click(); await settle();
}
async function close() {
  if (!app) return;
  const owned = app, child = owned.process(), exited = () => child.exitCode !== null || child.signalCode !== null;
  try { await owned.close(); }
  finally {
    await expect.poll(exited, { timeout: 15000 }).toBe(true);
    const record = processes.find(item => item.pid === child.pid); if (record) record.exited = exited();
    if (exited()) { app = undefined; page = undefined; }
  }
}
async function screenshot(name: string) {
  await settle();
  const data = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(data, 'base64'));
}
async function check(name: string, work: () => Promise<void>) {
  phase = name; const started = Date.now(); await work(); checks.push({ name, durationMs: Date.now() - started });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log('通过：' + name);
}
async function save() {
  await button('保存工程').click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  return read();
}
async function settleFlowViewport() {
  // Fit is a real, short camera animation; wait for its successive frame samples
  // to agree instead of clicking coordinates from a moving canvas.
  await page!.evaluate(async () => {
    let last = '', stable = 0;
    for (let frame = 0; frame < 60 && stable < 8; frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const next = document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? '';
      stable = next === last ? stable + 1 : 0; last = next;
    }
  });
}
async function fit() { await button('适应全图').click(); await settleFlowViewport(); }
async function openScene(sceneId: string) {
  await page!.locator('[data-workspace-tab="flowchart"]').click();
  for (let depth = 0; depth < 8 && await workspace().getAttribute('data-flow-scope') !== 'game'; depth++) await button('返回上一级').click();
  await expect(workspace()).toHaveAttribute('data-flow-scope', 'game');
  await fit(); await node('flow:story').dblclick(); await expect(workspace()).toHaveAttribute('data-flow-scope', 'content');
  await fit(); await node(storySceneNodeId(sceneId)).dblclick();
  await expect(workspace()).toHaveAttribute('data-flow-scope', 'scene:' + sceneId + ':'); await fit();
}
async function clickNode(id: string, modifiers?: ('Control' | 'Shift')[]) {
  await node(id).locator('.graph-node-title strong').click({ modifiers });
}
async function startEdgeClickTrace(id: string, planned: Point & { fraction: number }) {
  await page!.evaluate(({ id, planned }) => {
    type TraceState = { records: unknown[]; stop: () => void };
    const host = window as typeof window & { __vnsFlowTransitionClickTrace?: TraceState };
    host.__vnsFlowTransitionClickTrace?.stop();
    const records: unknown[] = [], frames = new Set<number>();
    let active = true, eventCount = 0;
    const findEdge = (edgeId: string) => Array.from(document.querySelectorAll('.react-flow__edge')).find(element => element.getAttribute('data-id') === edgeId);
    const initialCanvas = findEdge(id)?.closest('.flow-container');
    const describe = (element: Element | null) => element ? { tag: element.tagName, class: element.getAttribute('class'),
      edgeId: element.closest('.react-flow__edge')?.getAttribute('data-id') ?? null,
      nodeId: element.closest('.react-flow__node')?.getAttribute('data-id') ?? null,
      markerId: element.closest('[data-flow-transition-edge]')?.getAttribute('data-flow-transition-edge') ?? null,
      excludedControl: !!element.closest('.react-flow__node, .react-flow__handle, .react-flow__edgeupdater, .react-flow__edgelabel-renderer') } : null;
    const layer = (element: Element | null) => {
      if (!element) return null;
      const style = getComputedStyle(element);
      return { ...describe(element), dataId: element.getAttribute('data-id'), isConnected: element.isConnected,
        inlineStyle: element.getAttribute('style'), zIndex: style.zIndex, position: style.position,
        transform: style.transform, pointerEvents: style.pointerEvents, display: style.display, visibility: style.visibility };
    };
    const ancestors = (element: Element | null) => {
      const result: Element[] = [];
      for (let current = element; current && result.length < 12; current = current.parentElement) {
        result.push(current); if (current === initialCanvas) break;
      }
      return result;
    };
    const routeWithin = (container: Element | null, element: Element | null): number[] | null => {
      if (!container || !element) return null;
      const route: number[] = [];
      for (let current: Element | null = element; current; current = current.parentElement) {
        if (current === container) return route;
        if (!current.parentElement) return null;
        route.unshift(Array.from(current.parentElement.children).indexOf(current));
      }
      return null;
    };
    const atRoute = (container: Element | null, route: number[] | null) => {
      let current = container;
      if (!route) return null;
      for (const index of route) current = current?.children.item(index) ?? null;
      return current;
    };
    const captureOriginal = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      const edge = target?.closest('.react-flow__edge') ?? null, node = target?.closest('.react-flow__node') ?? null;
      const chain = ancestors(target);
      return { target, edge, node, edgeId: edge?.getAttribute('data-id') ?? null, nodeId: node?.getAttribute('data-id') ?? null,
        visiblePath: edge?.querySelector('.react-flow__edge-path') ?? null, svg: edge?.closest('svg') ?? null,
        root: target?.closest('.flow-container') ?? initialCanvas ?? null, targetRoute: routeWithin(edge, target), chain,
        capturedTarget: describe(target), capturedAncestors: chain.map(layer),
        capturedPath: event.composedPath().filter((item): item is Element => item instanceof Element).slice(0, 12).map(describe) };
    };
    const originals = new WeakMap<Event, ReturnType<typeof captureOriginal>>();
    const originalIdentity = (event: Event) => {
      const original = originals.get(event); if (!original) return null;
      const currentEdge = original.edgeId ? Array.from(initialCanvas?.querySelectorAll('.react-flow__edge') ?? [])
        .find(element => element.getAttribute('data-id') === original.edgeId) ?? null : null;
      const currentNode = original.nodeId ? Array.from(initialCanvas?.querySelectorAll('.react-flow__node') ?? [])
        .find(element => element.getAttribute('data-id') === original.nodeId) ?? null : null;
      const currentTarget = atRoute(currentEdge, original.targetRoute);
      const currentPath = currentEdge?.querySelector('.react-flow__edge-path') ?? null, currentSvg = currentEdge?.closest('svg') ?? null;
      return { capturedTarget: original.capturedTarget, capturedPath: original.capturedPath,
        target: describe(original.target), targetIsConnected: original.target?.isConnected ?? false,
        initialRootIsConnected: initialCanvas?.isConnected ?? false,
        rootContainsOriginalTarget: !!original.target && !!initialCanvas?.contains(original.target),
        capturedRootContainsOriginalTarget: !!original.target && !!original.root?.contains(original.target),
        originalTargetClosestEdgeId: original.target?.closest('.react-flow__edge')?.getAttribute('data-id') ?? null,
        originalTargetClosestNodeId: original.target?.closest('.react-flow__node')?.getAttribute('data-id') ?? null,
        currentSameId: { edge: layer(currentEdge), node: layer(currentNode), visiblePath: describe(currentPath), target: describe(currentTarget),
          edgeSameElement: !!currentEdge && currentEdge === original.edge, nodeSameElement: !!currentNode && currentNode === original.node,
          visiblePathSameElement: !!currentPath && currentPath === original.visiblePath,
          targetAtSameRouteIsSameElement: !!currentTarget && currentTarget === original.target,
          svgSameElement: !!currentSvg && currentSvg === original.svg },
        originalSvg: layer(original.svg), currentSvg: layer(currentSvg),
        capturedAncestors: original.capturedAncestors, originalAncestorsNow: original.chain.map(layer), currentAncestors: ancestors(currentTarget).map(layer) };
    };
    const state = (point: Point) => {
      const hits = document.elementsFromPoint(point.x, point.y), canvas = findEdge(id)?.closest('.flow-container') ?? initialCanvas;
      const candidates = [...new Set(hits.filter(hit => hit.closest('.flow-container') === canvas)
        .map(hit => hit.closest('.react-flow__edge')?.getAttribute('data-id')).filter((value): value is string => !!value))];
      const geometry = [...new Set([id, ...candidates])].map(edgeId => {
        const group = findEdge(edgeId), curve = group?.querySelector<SVGPathElement>('.react-flow__edge-path');
        const matrix = curve?.getScreenCTM(), rect = curve?.getBoundingClientRect();
        const local = curve?.getPointAtLength(curve.getTotalLength() * planned.fraction);
        const center = local && matrix ? new DOMPoint(local.x, local.y).matrixTransform(matrix) : undefined;
        return { id: edgeId, class: group?.getAttribute('class'), d: curve?.getAttribute('d'),
          transform: matrix ? { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f } : null,
          rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
          plannedFractionCenter: center ? { x: center.x, y: center.y } : null,
          plannedCenterDelta: center && edgeId === id ? { x: center.x - planned.x, y: center.y - planned.y } : null };
      });
      const rect = canvas?.getBoundingClientRect();
      return { at: performance.now(), point, hit: describe(hits[0] ?? null), stack: hits.slice(0, 10).map(describe), candidates, geometry,
        selectedEdges: Array.from(document.querySelectorAll('.react-flow__edge.selected')).map(element => element.getAttribute('data-id')),
        selectedNodes: Array.from(document.querySelectorAll('.react-flow__node.selected')).map(element => element.getAttribute('data-id')),
        activeElement: describe(document.activeElement),
        viewport: canvas?.querySelector('.react-flow__viewport')?.getAttribute('style'),
        canvas: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
        inspector: document.querySelector('[data-flow-transition-inspector]')?.getAttribute('data-flow-transition-source') ?? null };
    };
    const record = (stage: string, event?: Event) => {
      if (!active || records.length >= 48) return;
      const mouse = event as MouseEvent | undefined, pointer = event as PointerEvent | undefined;
      const point = mouse ? { x: mouse.clientX, y: mouse.clientY } : planned;
      records.push({ stage, event: event ? { type: event.type, phase: event.eventPhase, timeStamp: event.timeStamp,
        isTrusted: event.isTrusted, defaultPrevented: event.defaultPrevented, cancelBubble: event.cancelBubble,
        button: mouse!.button, buttons: mouse!.buttons, clientX: mouse!.clientX, clientY: mouse!.clientY,
        screenX: mouse!.screenX, screenY: mouse!.screenY, pointerId: pointer!.pointerId, pointerType: pointer!.pointerType,
        ctrlKey: mouse!.ctrlKey, shiftKey: mouse!.shiftKey, metaKey: mouse!.metaKey, altKey: mouse!.altKey,
        target: describe(event.target instanceof Element ? event.target : null),
        path: event.composedPath().filter((item): item is Element => item instanceof Element).slice(0, 7).map(describe),
        withinCanvas: event.target instanceof Node && !!initialCanvas?.contains(event.target),
        originalIdentity: originalIdentity(event) } : null,
        ...state(point) });
    };
    const capture = (event: Event) => {
      if (++eventCount > 8) return;
      originals.set(event, captureOriginal(event));
      record('window-capture', event);
      queueMicrotask(() => { if (active) record('capture-microtask', event); });
      const frame = requestAnimationFrame(() => { frames.delete(frame); if (active) record('capture-next-frame', event); });
      frames.add(frame);
    };
    const bubble = (event: Event) => {
      if (eventCount > 8) return;
      record('window-bubble', event);
      queueMicrotask(() => { if (active) record('bubble-microtask', event); });
    };
    const types = ['pointerdown', 'click', 'contextmenu'];
    for (const type of types) { window.addEventListener(type, capture, true); window.addEventListener(type, bubble); }
    host.__vnsFlowTransitionClickTrace = { records, stop: () => {
      record('stop'); active = false;
      for (const type of types) { window.removeEventListener(type, capture, true); window.removeEventListener(type, bubble); }
      for (const frame of frames) cancelAnimationFrame(frame);
    } };
    record('armed');
  }, { id, planned });
}
async function finishEdgeClickTrace() {
  return page!.evaluate(async () => {
    const host = window as typeof window & { __vnsFlowTransitionClickTrace?: { records: unknown[]; stop: () => void } };
    const trace = host.__vnsFlowTransitionClickTrace; if (!trace) return [];
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    trace.stop(); delete host.__vnsFlowTransitionClickTrace; return trace.records;
  });
}
async function selectEdge(id: string, useMarker = false, mouseButton: 'left' | 'right' = 'left') {
  if (useMarker) await marker(id).click();
  else {
    await expect(edge(id)).toBeVisible();
    const sampling = await edge(id).locator('.react-flow__edge-path').evaluate(element => {
      const curve = element as SVGPathElement, matrix = curve.getScreenCTM();
      if (!matrix) throw new Error('The edge has no screen transform.');
      const id = curve.closest('[data-id]')!.getAttribute('data-id')!;
      const canvas = curve.closest('.flow-container')!;
      const area = canvas.getBoundingClientRect();
      const length = curve.getTotalLength(), style = getComputedStyle(curve);
      const scale = Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
      const stroke = parseFloat(style.strokeWidth) * (style.vectorEffect === 'non-scaling-stroke' ? 1 : scale);
      const preferred = [.5, .4, .6, .3, .7, .2, .8, .1, .9, .05, .95];
      // Dense samples distinguish a missed gap from a transparent sibling edge
      // covering the entire visible curve. Offsets stay inside the actual paint
      // width, never out in the broad, invisible click padding.
      const count = Math.min(1600, Math.max(40, Math.ceil(length * scale / 2)));
      const fractions = [...preferred, ...Array.from({ length: count - 1 }, (_, index) => (index + 1) / count)];
      const offsets = [0, stroke * .25, -stroke * .25, stroke * .475, -stroke * .475];
      const screenPoint = (at: number) => {
        const local = curve.getPointAtLength(Math.max(0, Math.min(length, at)));
        return new DOMPoint(local.x, local.y).matrixTransform(matrix);
      };
      const describe = (item: Element) => ({ tag: item.tagName, class: item.getAttribute('class'),
        edgeId: item.closest('.react-flow__edge')?.getAttribute('data-id') ?? null,
        nodeId: item.closest('.react-flow__node')?.getAttribute('data-id') ?? null,
        markerId: item.closest('[data-flow-transition-edge]')?.getAttribute('data-flow-transition-edge') ?? null });
      const samples: { fraction: number; normalOffset: number; x: number; y: number; inCanvas: boolean; ownEdge: boolean; eligibleCenter: boolean; candidates: string[];
        updater: boolean; edgeId: string | null; nodeId: string | null; markerId: string | null; hit: ReturnType<typeof describe> | null }[] = [];
      for (const normalOffset of offsets) for (const fraction of fractions) {
        const along = fraction * length, screen = screenPoint(along), previous = screenPoint(along - .5 / scale), next = screenPoint(along + .5 / scale);
        const dx = next.x - previous.x, dy = next.y - previous.y, magnitude = Math.hypot(dx, dy) || 1;
        const x = screen.x - dy / magnitude * normalOffset, y = screen.y + dx / magnitude * normalOffset;
        const inCanvas = x >= area.left + 3 && x <= area.right - 3 && y >= area.top + 3 && y <= area.bottom - 3;
        const hit = inCanvas ? document.elementFromPoint(x, y) : null, description = hit ? describe(hit) : null;
        const updater = !!hit?.closest('.react-flow__edgeupdater');
        const allowed = !!hit && hit.closest('.flow-container') === canvas && !!description?.edgeId
          && !hit.closest('.react-flow__node, .react-flow__handle, .react-flow__edgeupdater, .react-flow__edgelabel-renderer');
        const candidates = allowed ? [...new Set(document.elementsFromPoint(x, y)
          .filter(item => item.closest('.flow-container') === canvas && !item.closest('.react-flow__node, .react-flow__handle, .react-flow__edgeupdater, .react-flow__edgelabel-renderer'))
          .map(item => item.closest('.react-flow__edge')?.getAttribute('data-id')).filter((candidate): candidate is string => !!candidate))] : [];
        samples.push({ fraction, normalOffset, x, y, inCanvas, ownEdge: description?.edgeId === id && !updater,
          eligibleCenter: normalOffset === 0 && allowed && candidates.includes(id), candidates,
          updater, edgeId: description?.edgeId ?? null, nodeId: description?.nodeId ?? null,
          markerId: description?.markerId ?? null, hit: description });
      }
      const centerSamples = samples.filter(sample => sample.normalOffset === 0 && sample.inCanvas && !sample.updater);
      const centerHits = centerSamples.filter(sample => sample.ownEdge), siblingHits = centerSamples.filter(sample => sample.edgeId && sample.edgeId !== id);
      const eligible = centerSamples.filter(sample => sample.eligibleCenter);
      const coarseHit = eligible.find(sample => preferred.includes(sample.fraction));
      // Coordinates are always on the intended visible centerline. A sibling's
      // broad transparent band may be the native event target; the editor must
      // resolve that real click to the nearest painted line. The final selected
      // edge is asserted below rather than invoking the resolver from the test.
      const picked = coarseHit ?? eligible[0];
      const diagnostic = !picked || picked.edgeId !== id || !coarseHit;
      const geometry = diagnostic ? Array.from(canvas.querySelectorAll('.react-flow__edge')).map(group => {
        const path = group.querySelector<SVGPathElement>('.react-flow__edge-path'), hit = group.querySelector<SVGPathElement>('.react-flow__edge-interaction');
        const ctm = path?.getScreenCTM(), box = path?.getBoundingClientRect();
        return { id: group.getAttribute('data-id'), class: group.getAttribute('class'), label: group.getAttribute('aria-label'),
          d: path?.getAttribute('d'), transform: ctm ? { a: ctm.a, b: ctm.b, c: ctm.c, d: ctm.d, e: ctm.e, f: ctm.f } : null,
          rect: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
          strokeWidth: path ? getComputedStyle(path).strokeWidth : null,
          hitWidth: hit ? getComputedStyle(hit).strokeWidth : null,
          hitPointerEvents: hit ? getComputedStyle(hit).pointerEvents : null };
      }) : [];
      const stacks = diagnostic ? centerSamples.filter(sample => !sample.ownEdge).filter((_, index) => index % Math.max(1, Math.floor(centerSamples.length / 12)) === 0).slice(0, 12)
        .map(sample => ({ x: sample.x, y: sample.y, stack: document.elementsFromPoint(sample.x, sample.y).slice(0, 8).map(describe) })) : [];
      return { id, length, scale, strokeWidthOnScreen: stroke,
        area: { x: area.x, y: area.y, width: area.width, height: area.height },
        point: picked ? { x: picked.x, y: picked.y, fraction: picked.fraction, normalOffset: picked.normalOffset,
          nativeEdgeId: picked.edgeId, hitCandidates: picked.candidates } : null,
        coarseCenterHit: !!coarseHit, centerSamples: centerSamples.length, centerOwnHits: centerHits.length,
        centerOtherEdgeHits: siblingHits.length, otherEdges: [...new Set(siblingHits.map(sample => sample.edgeId))],
        visibleOffsetOwnHits: samples.filter(sample => sample.normalOffset !== 0 && sample.ownEdge).length,
        centerCoveredBySibling: !centerHits.length && siblingHits.length > 0,
        diagnostic, samples: diagnostic ? samples : [], geometry, stacks };
    });
    const { samples, geometry, stacks, ...summary } = sampling;
    const selectionEvidence: Record<string, unknown> = { phase, mouseButton, ...summary }; edgeSelections.push(selectionEvidence);
    const diagnosticFile = sampling.diagnostic ? `edge-hit-${edgeSelections.length}-${id.replace(/[^a-z0-9_-]/gi, '_')}.json` : undefined;
    if (diagnosticFile) evidence.lastEdgeHitDiagnostic = diagnosticFile;
    let traceStarted = false;
    try {
      assert.ok(sampling.point, `No visible centerline target on edge ${id}; see ${String(evidence.lastEdgeHitDiagnostic)}.`);
      assert.equal(sampling.point.normalOffset, 0, 'Acceptance clicks must stay on the actual visible centerline.');
      if (sampling.diagnostic) { await startEdgeClickTrace(id, sampling.point); traceStarted = true; }
      await page!.mouse.click(sampling.point.x, sampling.point.y, { button: mouseButton });
      await expect(edge(id), `Clicking ${id}'s visible centerline was natively received by ${sampling.point.nativeEdgeId}; the intended line must still become selected.`).toHaveClass(/selected/);
    } finally {
      selectionEvidence.selectedAfter = await page!.locator('.react-flow__edge.selected').evaluateAll(elements => elements.map(element => element.getAttribute('data-id')));
      if (diagnosticFile) {
        const clickTrace = traceStarted ? await finishEdgeClickTrace() : [];
        // Retain representative geometry samples plus the actual event trace,
        // keeping the larger in-memory pointer scan out of routine reports.
        const centers = samples.filter(sample => sample.normalOffset === 0);
        const sampleStep = Math.max(1, Math.ceil(centers.length / 80));
        const compactSamples = centers.filter((sample, index) => index < 11 || index % sampleStep === 0 || sample.fraction === sampling.point?.fraction);
        await fs.writeFile(path.join(output, diagnosticFile), JSON.stringify({ ...selectionEvidence,
          sampleCount: samples.length, samples: compactSamples, geometry, stacks, clickTrace }, null, 2));
      }
    }
  }
  await expect(edge(id)).toHaveClass(/selected/); await expect(inspector()).toBeVisible();
}
async function expectSource(id: string, port: string, target?: string) {
  await expect(inspector()).toHaveAttribute('data-flow-transition-source', id);
  await expect(inspector()).toHaveAttribute('data-flow-transition-port', port);
  if (target) await expect(inspector()).toHaveAttribute('data-flow-transition-target', target);
}
async function setMode(mode: Mode) { await field('过渡方式').selectOption({ label: mode }); }
async function modeIs(mode: Mode) { await expect(field('过渡方式').locator('option:checked')).toHaveText(mode); }
async function number(name: string, value: number) {
  const input = field(name); await input.fill(String(value)); await input.press('Tab');
  await expect.poll(async () => Number(await input.inputValue())).toBeCloseTo(value, 6);
}
async function details() {
  const summary = inspector().locator('summary').filter({ hasText: '分段时间与颜色' });
  if (!await summary.locator('..').evaluate(element => (element as HTMLDetailsElement).open)) await summary.click();
}
async function undo() { await page!.getByRole('button', { name: /^撤销/ }).first().click(); await settle(); }
async function redo() { await page!.getByRole('button', { name: /^重做/ }).first().click(); await settle(); }
async function simpleSelection() {
  await expect(page!.locator('.story-connections, .connection-label')).toHaveCount(0);
  await expect(button('断开选中连线')).toHaveCount(0);
  assert.equal(await page!.locator('.react-flow__edge.selected .react-flow__edgeupdater').evaluateAll(elements => elements.every(element => getComputedStyle(element).opacity === '0')), true);
}
async function drag(from: Point, to: Point) {
  await page!.mouse.move(from.x, from.y); await page!.mouse.down();
  await page!.mouse.move(to.x, to.y, { steps: 20 }); await page!.mouse.up(); await settle();
}
async function reconnect(id: string, end: 'source' | 'target', nodeId: string, port: string) {
  await fit(); await selectEdge(id);
  const start = center(await bounds(edge(id).locator('.react-flow__edgeupdater-' + end)));
  const finish = center(await bounds(node(nodeId).locator(`.${end}[data-handleid="${port}"]`)));
  const hit = await page!.evaluate(point => document.elementFromPoint(point.x, point.y)?.classList.contains('react-flow__edgeupdater') ?? false, start);
  assert.equal(hit, true, 'Reconnect must start on the actual invisible endpoint hit area.');
  await drag(start, finish);
}
async function connect(source: string, port: string, target: string) {
  await fit();
  await drag(center(await bounds(node(source).locator(`.source[data-handleid="${port}"]`))), center(await bounds(node(target).locator('.target[data-handleid="in"]'))));
}

try {
  await fs.mkdir(output, { recursive: true }); sourceHash = sha256(await fs.readFile(sourceFile)); report.sourceSha256Before = sourceHash;
  await saveProject(projectFile, projectSchema.parse(project));
  evidence.fixtureSha256Before = sha256(await fs.readFile(projectFile));
  await launch();

  await check('系统读档连线只解释真实语义，选线没有端点圈和断开横条', async () => {
    await expect(workspace()).toHaveAttribute('data-flow-scope', 'game'); await fit();
    await selectEdge('flow:load:restore'); await expect(field('过渡方式')).toHaveCount(0);
    await expect(inspector()).toContainText('存档'); await simpleSelection();
    await expect(page!.locator('button[data-flow-transition-edge]')).toHaveCount(0);
    await expect(page!.locator('.dirty-dot')).toHaveCount(0); await screenshot('01-readonly-system-edge');
  });

  await check('普通连线真实鼠标命中打开过渡属性，查看不改旧工程', async () => {
    await openScene(mainScene); await expect(page!.locator('button[data-flow-transition-edge]')).toHaveCount(0);
    const before = sha256(await fs.readFile(projectFile)); await selectEdge('alpha:next');
    await expectSource('alpha', 'next', 'branch'); await modeIs('不单独设置'); await simpleSelection();
    await expect(page!.locator('.dirty-dot')).toHaveCount(0); assert.equal(sha256(await fs.readFile(projectFile)), before);
    await screenshot('02-inherited-edge');
  });

  await check('直接切换与沿用不同，方式修改可单次撤销重做', async () => {
    await setMode('直接切换'); assert.deepEqual(transition(await save(), 'alpha'), { mode: 'none' });
    await expect(marker('alpha:next')).toBeVisible();
    await undo(); await modeIs('不单独设置'); assert.equal(transition(await save(), 'alpha'), undefined);
    await expect(marker('alpha:next')).toHaveCount(0);
    await redo(); await modeIs('直接切换'); assert.deepEqual(transition(await save(), 'alpha'), { mode: 'none' });
  });

  await check('叠化直接输入总时长，清空后失焦保持原有效值', async () => {
    await setMode('叠化'); await number('总时长（秒）', .9);
    const before = await save(); assert.deepEqual(transition(before, 'alpha'), dissolve(.9));
    await field('总时长（秒）').fill(''); await field('总时长（秒）').press('Tab');
    await expect.poll(async () => Number(await field('总时长（秒）').inputValue())).toBe(.9);
    await expect(page!.locator('.dirty-dot')).toHaveCount(0); assert.deepEqual(transition(await save(), 'alpha'), transition(before, 'alpha'));
    await clickNode('gamma'); await selectEdge('alpha:next', true); await modeIs('叠化');
    await expectSource('alpha', 'next', 'branch');
  });

  await check('淡黑淡白和自定义颜色可保存，修改总时长按原比例分配三段', async () => {
    for (const [mode, hex] of [['淡黑', '#000000'], ['淡白', '#ffffff']] as const) {
      await setMode(mode); const saved = transition(await save(), 'alpha');
      assert.ok(saved?.mode === 'color'); assert.equal(saved.color.toLowerCase(), hex);
    }
    await setMode('经过颜色'); await details(); await field('过渡颜色').fill('#345678'); await field('过渡颜色').press('Tab');
    await number('淡出（秒）', .25); await number('停留（秒）', .1); await number('淡入（秒）', .65);
    assert.deepEqual(transition(await save(), 'alpha'), color('#345678'));
    await number('总时长（秒）', 2);
    const saved = transition(await save(), 'alpha'); assert.ok(saved?.mode === 'color');
    assert.equal(saved.color.toLowerCase(), '#345678');
    expect(saved.outDuration).toBeCloseTo(.5, 8); expect(saved.hold).toBeCloseTo(.2, 8); expect(saved.inDuration).toBeCloseTo(1.3, 8);
    await screenshot('03-color-phases');
  });

  await check('效果示意可播放暂停拖动重播，预览动作不进入工程或撤销记录', async () => {
    const before = sha256(await fs.readFile(projectFile));
    const preview = inspector().locator('[data-flow-transition-preview]'); await expect(preview).toBeVisible();
    await expect(inspector()).toContainText('效果示意');
    const slider = field('效果示意进度'); await slider.press('Home');
    const minimum = Number(await slider.getAttribute('min') ?? 0), maximum = Number(await slider.getAttribute('max') ?? 100);
    expect(Number(await slider.inputValue())).toBeCloseTo(minimum, 6);
    const sampleAfter = preview.locator('.flow-transition-sample.after'), sampleColor = preview.locator('.flow-transition-sample-color');
    await expect(sampleAfter).toHaveCSS('opacity', '0'); await expect(sampleColor).toHaveCSS('opacity', '0');
    await inspector().getByRole('button', { name: '播放效果示意', exact: true }).click();
    await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(minimum);
    await inspector().getByRole('button', { name: '暂停效果示意', exact: true }).click();
    const paused = await slider.inputValue(); await settle(); await settle(); assert.equal(await slider.inputValue(), paused);
    const track = await bounds(slider);
    await page!.mouse.click(track.x + track.width * .7, track.y + track.height / 2);
    const progress = (Number(await slider.inputValue()) - minimum) / (maximum - minimum); expect(progress).toBeGreaterThan(.55); expect(progress).toBeLessThan(.85);
    await expect(sampleAfter).toHaveCSS('opacity', '1');
    const colorOpacity = Number(await sampleColor.evaluate(element => getComputedStyle(element).opacity));
    expect(colorOpacity).toBeGreaterThan(0); expect(colorOpacity).toBeLessThan(1);
    evidence.previewPausedProgress = progress; await screenshot('04-scrubbed-effect-example');
    await slider.press('End'); await expect(sampleAfter).toHaveCSS('opacity', '1'); await expect(sampleColor).toHaveCSS('opacity', '0');
    await inspector().getByRole('button', { name: '重播效果示意', exact: true }).click();
    await expect(inspector().getByRole('button', { name: '暂停效果示意', exact: true })).toBeVisible();
    await inspector().getByRole('button', { name: '暂停效果示意', exact: true }).click();
    await expect(page!.locator('.dirty-dot')).toHaveCount(0); assert.equal(sha256(await fs.readFile(projectFile)), before);
  });

  await check('恢复沿用清除标记，单次撤销恢复完整自定义颜色与时长', async () => {
    const before = transition(await read(), 'alpha'); await setMode('不单独设置');
    assert.equal(transition(await save(), 'alpha'), undefined); await expect(marker('alpha:next')).toHaveCount(0);
    await undo(); assert.deepEqual(transition(await save(), 'alpha'), before); await expect(marker('alpha:next')).toBeVisible();
    await redo(); assert.equal(transition(await save(), 'alpha'), undefined);
    await undo(); assert.deepEqual(transition(await save(), 'alpha'), before);
  });

  await check('条件两条分支独立设置，切换连线不会串用另一出口数值', async () => {
    await selectEdge('branch:yes'); await expectSource('branch', 'yes', 'beta'); await setMode('叠化'); await number('总时长（秒）', .35);
    await selectEdge('branch:no'); await expectSource('branch', 'no', 'gamma'); await modeIs('不单独设置'); await setMode('淡白');
    const saved = await save(); assert.deepEqual(transition(saved, 'branch', 'yes'), dissolve(.35));
    const no = transition(saved, 'branch', 'no'); assert.ok(no?.mode === 'color'); assert.equal(no.color.toLowerCase(), '#ffffff');
    await selectEdge('branch:yes', true); await modeIs('叠化'); await expect.poll(async () => Number(await field('总时长（秒）').inputValue())).toBe(.35);
    await selectEdge('alpha:next', true); await modeIs('经过颜色'); await expect.poll(async () => Number(await field('总时长（秒）').inputValue())).toBe(2);
  });

  await check('保存并退出独立进程后重开，连线标记与设置保持', async () => {
    const before = transitionSnapshot(await save()); await close(); await launch(); await openScene(mainScene);
    assert.deepEqual(transitionSnapshot(await read()), before); await selectEdge('alpha:next', true); await modeIs('经过颜色');
    await expectSource('alpha', 'next', 'branch'); await screenshot('05-reopened-transitions');
  });

  await check('目标端真实改接保留源出口过渡，同目标重接不改配置', async () => {
    const before = transition(await read(), 'alpha'); await reconnect('alpha:next', 'target', 'gamma', 'in');
    let saved = await save(); assert.equal(targets(find(saved, 'alpha'))[0].target, 'gamma'); assert.deepEqual(transition(saved, 'alpha'), before);
    await selectEdge('alpha:next', true); await expectSource('alpha', 'next', 'gamma');
    await undo(); saved = await save(); assert.equal(targets(find(saved, 'alpha'))[0].target, 'branch'); assert.deepEqual(transition(saved, 'alpha'), before);
    const snapshot = JSON.stringify(saved.nodes); await reconnect('alpha:next', 'target', 'branch', 'in');
    assert.equal(JSON.stringify((await save()).nodes), snapshot); await simpleSelection();
  });

  await check('源端改接使用新出口自身设置，原出口保留断开配置', async () => {
    const before = transition(await read(), 'alpha'); await reconnect('alpha:next', 'source', 'spare', 'next');
    const saved = await save(); assert.equal(targets(find(saved, 'alpha'))[0].target, undefined);
    assert.equal(targets(find(saved, 'spare'))[0].target, 'branch'); assert.deepEqual(transition(saved, 'alpha'), before);
    assert.deepEqual(transition(saved, 'spare'), { mode: 'none' }); await expect(marker('alpha:next')).toHaveCount(0);
    await selectEdge('spare:next', true); await modeIs('直接切换'); await expectSource('spare', 'next', 'branch');
    await undo(); await save(); await expect(marker('alpha:next')).toBeVisible(); await expect(marker('spare:next')).toHaveCount(0);
  });

  await check('Delete断开不丢过渡，重新连接后恢复标记并可撤销', async () => {
    const before = transition(await read(), 'alpha'); await selectEdge('alpha:next'); await edge('alpha:next').focus(); await page!.keyboard.press('Delete');
    let saved = await save(); assert.equal(targets(find(saved, 'alpha'))[0].target, undefined); assert.deepEqual(transition(saved, 'alpha'), before);
    const inactiveWarning = validateProject(saved).find(issue => issue.code === 'flow-transition-inactive' && issue.nodeId === 'alpha');
    assert.equal(inactiveWarning?.severity, 'warning');
    await expect(marker('alpha:next')).toHaveCount(0); await clickNode('alpha');
    const inactive = page!.locator('[data-flow-transition-inactive] [data-flow-transition-inactive-port="next"]');
    await expect(inactive).toBeVisible(); await expect(inactive).toContainText('未连接');
    await inactive.getByRole('button', { name: '移除未启用过渡', exact: true }).click();
    saved = await save(); assert.equal(transition(saved, 'alpha'), undefined); await expect(inactive).toHaveCount(0);
    await undo(); assert.deepEqual(transition(await save(), 'alpha'), before); await expect(inactive).toBeVisible();
    await connect('alpha', 'next', 'branch');
    saved = await save(); assert.equal(targets(find(saved, 'alpha'))[0].target, 'branch'); assert.deepEqual(transition(saved, 'alpha'), before);
    await selectEdge('alpha:next', true); await modeIs('经过颜色');
    await undo(); await save(); await expect(edge('alpha:next')).toHaveCount(0);
    await redo(); await save(); await expect(marker('alpha:next')).toBeVisible();
  });

  await check('打组进组解组使用同一真实出口，投影线编辑不创建第二份过渡', async () => {
    const before = transitionSnapshot(await read()); await fit(); await clickNode('branch'); await clickNode('beta', ['Control']); await clickNode('gamma', ['Control']);
    for (const id of ['branch', 'beta', 'gamma']) await expect(node(id)).toHaveClass(/selected/);
    await node('branch').locator('.graph-node-title strong').click({ button: 'right' });
    await page!.getByRole('menuitem', { name: /打组为剧情组/ }).click();
    const dialog = page!.getByRole('dialog', { name: '打组为剧情组', exact: true });
    await dialog.getByLabel('剧情组名称').fill('有过渡的分支组'); await dialog.getByRole('button', { name: '创建剧情组', exact: true }).click();
    const grouped = await save(), group = grouped.storyGroups?.find(item => item.name === '有过渡的分支组'); assert.ok(group);
    assert.deepEqual(transitionSnapshot(grouped), before); const groupId = storyGroupNodeId(group.id); await fit();
    await selectEdge('alpha:next', true); await expectSource('alpha', 'next', 'branch');
    const parallelStart = edgeSelections.length, parallelScales: number[] = [];
    for (const zoomStep of [0, 1]) {
      if (zoomStep) {
        // A genuine zoom control changes the camera; the test never sets CSS or
        // the React Flow store to manufacture pointer hits.
        await page!.locator('.react-flow__controls-zoomout').click(); await settleFlowViewport();
      }
      const scale = await edge('beta:next').locator('.react-flow__edge-path').evaluate(element => {
        const matrix = (element as SVGPathElement).getScreenCTM(); if (!matrix) throw new Error('Missing edge screen transform.');
        return Math.hypot(matrix.a, matrix.b);
      });
      parallelScales.push(scale);
      for (const mouseButton of ['left', 'right'] as const) for (const source of ['beta', 'gamma', 'beta', 'gamma']) {
        await selectEdge(source + ':next', false, mouseButton); await expectSource(source, 'next', 'merge');
        await expect(page!.locator('.react-flow__edge.selected')).toHaveCount(1); await simpleSelection();
      }
      await expect(page!.locator('.dirty-dot')).toHaveCount(0); await screenshot(`06-parallel-wires-${zoomStep}`);
    }
    assert.ok(parallelScales[1] < parallelScales[0], 'Both real zoom levels must be exercised.');
    const parallelHits = edgeSelections.slice(parallelStart) as { id: string; point?: { nativeEdgeId: string | null }; selectedAfter?: unknown }[];
    assert.ok(parallelHits.some(hit => hit.id === 'beta:next' && hit.point?.nativeEdgeId !== hit.id), 'The parallel-wire fixture must exercise an actual sibling intercept.');
    evidence.parallelWireSelection = { scales: parallelScales, clicks: parallelHits, centerlineOnly: true };
    assert.deepEqual(transitionSnapshot(await read()), before); await fit();
    await selectEdge('beta:next'); await expectSource('beta', 'next', 'merge'); await setMode('叠化'); await number('总时长（秒）', .44);
    assert.deepEqual(transition(await save(), 'beta'), dissolve(.44));
    await node(groupId).dblclick(); await expect(workspace()).toHaveAttribute('data-flow-scope', 'scene:' + mainScene + ':' + group.id); await fit();
    await selectEdge('beta:next', true); await expectSource('beta', 'next', 'merge'); await modeIs('叠化');
    await selectEdge('branch:yes', true); await expectSource('branch', 'yes', 'beta'); await modeIs('叠化'); await screenshot('06-inside-group');
    const withInnerEdit = transitionSnapshot(await save()); await button('返回上一级').click(); await fit(); await clickNode(groupId);
    await button('解组，保留内容').click(); const ungrouped = await save(); assert.deepEqual(transitionSnapshot(ungrouped), withInnerEdit);
    await expect(node(groupId)).toHaveCount(0); await fit(); await selectEdge('beta:next', true); await expectSource('beta', 'next', 'merge');
  });

  await check('选择和热点复制使用新的稳定出口标识，过渡值独立保留', async () => {
    await openScene(portsScene);
    for (const id of ['pick', 'spot']) {
      const before = await read(), original = find(before, id); await clickNode(id);
      await page!.locator('.flow-node-properties').getByRole('button', { name: '复制', exact: true }).click();
      const saved = await save(), copy = saved.nodes.find(item => !before.nodes.some(old => old.id === item.id)); assert.ok(copy);
      assert.equal(copy.kind, original.kind); assert.deepEqual(find(saved, id), original);
      if (original.kind === 'choice' && copy.kind === 'choice') {
        assert.equal(copy.choices.length, original.choices.length);
        for (const [index, branch] of original.choices.entries()) {
          assert.notEqual(copy.choices[index].id, branch.id); assert.equal(copy.transitions?.[branch.id], undefined);
          assert.deepEqual(copy.transitions?.[copy.choices[index].id], original.transitions?.[branch.id]);
        }
      } else if (original.kind === 'interaction' && copy.kind === 'interaction') {
        for (const [index, hotspot] of original.hotspots.entries()) {
          assert.notEqual(copy.hotspots[index].id, hotspot.id); assert.equal(copy.transitions?.[hotspot.id], undefined);
          assert.deepEqual(copy.transitions?.[copy.hotspots[index].id], original.transitions?.[hotspot.id]);
        }
        assert.deepEqual(copy.transitions?.timeout, original.transitions?.timeout); assert.deepEqual(copy.transitions?.cancel, original.transitions?.cancel);
      } else throw new Error('Unexpected copied node type.');
      await undo(); assert.deepEqual((await save()).nodes, before.nodes); await fit();
    }
  });

  await check('选择热点小游戏调用跳转及演出出口均定位真实端口，动态返回只读', async () => {
    const saved = await read(), covered: string[] = [];
    for (const id of ['pick', 'spot', 'mini', 'call_test', 'jump_test', 'set_test', 'title_test', 'sub_story']) {
      const story = find(saved, id);
      for (const port of targets(story).filter(port => port.target)) {
        await expect(marker(id + ':' + port.port)).toHaveCount(1);
        await selectEdge(id + ':' + port.port); await expectSource(id, port.port, port.target);
        await expect(field('过渡方式')).toBeEnabled(); covered.push(id + ':' + port.port);
      }
    }
    evidence.coveredPorts = covered; assert.equal(covered.length, 14);
    await selectEdge('sub_return:returnCall'); await expect(field('过渡方式')).toHaveCount(0); await expect(inspector()).toContainText('调用');
    await selectEdge('port_end:returnTitle'); await expect(field('过渡方式')).toHaveCount(0); await expect(inspector()).toContainText('标题');
    await simpleSelection(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); await screenshot('07-real-ports-and-readonly-return');
  });

  await check('实际文本编辑并应用后，连线过渡与选择稳定出口完整往返', async () => {
    const before = await save(), transitions = transitionSnapshot(before);
    await openStoryMode(page!, 'text');
    const hide = button('隐藏演出'); if (await hide.getAttribute('aria-pressed') === 'true') await hide.click();
    const input = page!.locator('textarea.text-source-input'); await expect(input).toBeVisible();
    const text = await input.inputValue(); assert.ok(text.includes('@连线过渡：'));
    assert.ok(!text.includes('@选项标记：'), 'Internal branch IDs should remain hidden in the authoring surface.');
    assert.ok(text.includes('原有台词甲，过渡不改变文字演出。'));
    await input.fill(text.replace('原有台词甲，过渡不改变文字演出。', '文本往返后的甲台词，过渡设置完整保留。'));
    await button('应用到项目').click(); const after = await save(); assert.deepEqual(transitionSnapshot(after), transitions);
    const alpha = find(after, 'alpha'); assert.ok(alpha.kind === 'passage'); assert.equal(alpha.lines[0].text, '文本往返后的甲台词，过渡设置完整保留。');
    const pickBefore = find(before, 'pick'), pickAfter = find(after, 'pick'); assert.ok(pickBefore.kind === 'choice' && pickAfter.kind === 'choice');
    assert.deepEqual(pickAfter.choices.map(item => item.id), pickBefore.choices.map(item => item.id));
    const serialized = after.scriptText?.content;
    assert.ok(typeof serialized === 'string', 'The applied script must be saved with its complete source.');
    assert.ok(serialized.includes('@选项标记：pick_left'));
    // Complex @实例 nodes still rely on their existing structural references.
    // Parse the source actually saved by the editor (which includes hidden IDs)
    // after removing every old transition, rather than reparsing cached values.
    const withoutTransitions = structuredClone(after);
    for (const story of withoutTransitions.nodes) delete story.transitions;
    delete withoutTransitions.scriptText;
    const reconstructed = applyTextScript(withoutTransitions, serialized);
    assert.deepEqual(reconstructed.issues.filter(issue => issue.severity === 'error'), []);
    assert.deepEqual(transitionSnapshot(reconstructed.project), transitions);
    evidence.textRoundTrip = { declarations: serialized.split('\n').filter(line => line.startsWith('@连线过渡：')).length,
      rebuiltWithoutPreviousSettings: true, branchIdsHiddenOnSurface: true };
    await openScene(mainScene); await selectEdge('alpha:next', true); await modeIs('经过颜色');
  });

  await check('明暗主题与真实窄窗字段可操作，无横向溢出且示意不影响剧情', async () => {
    const before = transitionSnapshot(await save()), layouts: unknown[] = [];
    for (const theme of ['黑白', '亮白']) {
      await button('作品设置').click(); await button('编辑器外观').click();
      await page!.getByRole('group', { name: '编辑器配色', exact: true }).getByRole('button', { name: new RegExp('^' + theme) }).click();
      await button('关闭作品设置').click();
      for (const width of [1600, 1100]) {
        await app!.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 940), width);
        await settle(); await details();
        const layout = await inspector().evaluate(element => {
          const shell = element as HTMLElement, rect = shell.getBoundingClientRect();
          const controls = Array.from(shell.querySelectorAll<HTMLElement>('input,select,summary,button')).filter(item => item.getClientRects().length).map(item => {
            const box = item.getBoundingClientRect(); return { label: item.getAttribute('aria-label') ?? item.textContent?.trim(), left: box.left, right: box.right, width: box.width };
          });
          return { width: rect.width, left: rect.left, right: rect.right, scrollWidth: shell.scrollWidth, clientWidth: shell.clientWidth, controls };
        });
        assert.ok(layout.width > 200); assert.ok(layout.scrollWidth <= layout.clientWidth + 1, 'Inspector must not require horizontal scrolling.');
        for (const control of layout.controls) { assert.ok(control.width > 0); assert.ok(control.left >= layout.left - 1 && control.right <= layout.right + 1, JSON.stringify(control)); }
        await field('总时长（秒）').focus(); await expect(field('总时长（秒）')).toBeFocused(); await field('总时长（秒）').press('Tab');
        layouts.push({ theme, requestedWindowWidth: width, ...layout }); await screenshot(`08-${theme === '亮白' ? 'light' : 'dark'}-${width}`);
      }
    }
    evidence.layouts = layouts; assert.deepEqual(transitionSnapshot(await save()), before);
    await fs.copyFile(projectFile, path.join(output, 'saved-project.json'));
  });

  assert.equal(checks.length, 17); assert.deepEqual(errors, [], 'Renderer must not raise runtime errors.'); report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = String(error);
  await fs.copyFile(projectFile, path.join(output, 'failure-fixture.json'))
    .then(() => { report.failureFixture = 'failure-fixture.json'; report.failureFixtureSource = 'last saved isolated project; no extra save was triggered'; })
    .catch(copyError => { report.failureFixtureError = String(copyError); });
  if (app && page && !page.isClosed()) {
    report.scopeAtFailure = await workspace().getAttribute('data-flow-scope').catch(() => undefined);
    report.inspectorAtFailure = await inspector().innerText().catch(() => undefined);
    await screenshot('failure').catch(capture => { report.captureError = String(capture); });
  }
} finally {
  try { await close(); } catch (error) { report.status = 'failed'; report.closeError = String(error); failure ??= error; }
  try {
    const after = sha256(await fs.readFile(sourceFile)); report.sourceSha256After = after;
    if (sourceHash !== undefined) assert.equal(after, sourceHash, 'Author project changed during isolated acceptance.');
  } catch (error) { report.status = 'failed'; report.sourceProtectionError = String(error); failure ??= error; }
  try {
    if (app || processes.some(item => !item.exited)) throw new Error('An owned fixture process remains alive; retain its directories.');
    report.cleanup = await cleanVerificationDirectories(output, ['project', 'profile']);
    assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []);
  } catch (error) { report.status = 'failed'; report.cleanupError = String(error); failure ??= error; }
  await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
}
if (failure) throw failure;
