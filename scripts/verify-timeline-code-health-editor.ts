import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, type CDPSession, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { createProject, projectSchema, type Project } from '../src/core/model';
import { blueprintFromPerformance, rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { createVisualObject } from '../src/core/visual-object';
import { compositionObject } from '../src/core/composition-timeline';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { projectGraphs } from '../src/core/project-resources';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Run only after the complete product batch has been built. All content is
// generated below; this script never reads an author's project or profile.
if (process.env.VNS_INSTALLED_EXE || process.env.VNS_TEST_ROOT) throw new Error('请使用源码构建版，并清除 VNS_INSTALLED_EXE / VNS_TEST_ROOT。');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(path.resolve(process.cwd()).toLowerCase(), root.toLowerCase(), '请从 editor 工作区运行。');
const output = path.join(root, 'artifacts/code-health-review-2026-11-14/editor', new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const directory = path.join(output, 'project'), projectFile = path.join(directory, 'project.vns.json');
const project = createProject('时间轴交互边界验收');
const title = createVisualObject('text'); title.name = '精确关键帧'; title.text = '点击保留 0.123 秒'; title.duration = 8;
title.curves = { x: [{ at: .123, value: .5, easing: 'linear' }, { at: 2.417, value: .7, easing: 'ease' }] };
const groupA = createVisualObject('group'); groupA.name = '组合甲'; groupA.duration = 8;
const childA = createVisualObject('text'); childA.name = '甲的文字'; childA.text = '复制后移动副本'; childA.startAt = 1; childA.duration = 4;
const childB = createVisualObject('solid'); childB.name = '甲的色块'; childB.startAt = 2; childB.duration = 3;
const nested = createVisualObject('group'); nested.name = '甲内层'; nested.startAt = 2; nested.duration = 5;
const nestedText = createVisualObject('text'); nestedText.name = '内层文字'; nestedText.text = '导航后不接收旧视频'; nestedText.duration = 4;
nested.children = [nestedText]; groupA.children = [childA, childB, nested];
const groupB = createVisualObject('group'); groupB.name = '组合乙'; groupB.duration = 8;
const otherText = createVisualObject('text'); otherText.name = '乙的文字'; otherText.text = '右键目标应是甲'; otherText.duration = 6;
groupB.children = [otherText];
const report: Record<string, unknown> = { status: 'running', output, checks: [], errors: [], mode: 'built-product-desktop-acceptance' };
const checks: string[] = [], errors: string[] = [], traces: string[] = [];
const menuBounds: unknown[] = []; report.menuBounds = menuBounds;
let app: ElectronApplication | undefined, page: Page | undefined, tracing = false, traceIndex = 0, phase = 'fixture', teardownTimedOut = false;
const ownedProcesses: ReturnType<ElectronApplication['process']>[] = [];
let graphId = '', titleId = '', groupANode = '', groupBNode = '', editorWindowId = 0;
let focusSession: CDPSession | undefined;
const focusSessions: { windowId: number; enabled: false; detached: boolean }[] = [];
const focusStates: { phase: string; step: string; nativeFocused: boolean; rendererFocused: boolean }[] = [];
const focusWindows: { phase: string; id: number; destroyed: boolean; error?: string; blurEvents?: InputRecord[] }[] = [];
report.focus = { sessions: focusSessions, states: focusStates, windows: focusWindows };
type InputRecord = { sequence: number; type: string; trusted: boolean; windowTarget: boolean; focused: boolean; pointerId?: number; x?: number; y?: number; target?: string; key?: string };
type MetadataGate = { enabled: boolean; held: number; delivered: number; release: () => void; restore: () => void };
type Probes = { timelineHealthInputs: InputRecord[]; timelineHealthMetadata?: MetadataGate };

const waitOwned = async () => {
  for (const child of ownedProcesses) if (child.exitCode === null && child.signalCode === null) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await new Promise<void>(resolve => { const finish = () => { if (timer) clearTimeout(timer); child.removeListener('exit', finish); resolve(); }; child.once('exit', finish); timer = setTimeout(finish, 5000); });
  }
};
const closeApp = async () => {
  const owned = app; app = undefined;
  try {
    if (focusSession) {
      const session = focusSession; focusSession = undefined;
      try { await session.detach(); focusSessions.at(-1)!.detached = true; }
      catch (error) { report.focusSessionError = String(error); report.status = 'failed'; process.exitCode = 1; }
    }
    if (tracing && page) {
      tracing = false; const name = `trace-${String(++traceIndex).padStart(2, '0')}.zip`;
      try { await page.context().tracing.stop({ path: path.join(output, name) }); traces.push(name); }
      catch (error) { report.traceError = String(error); process.exitCode = 1; }
    }
  } finally {
    if (owned) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([owned.close(), new Promise<never>((_, reject) => { timer = setTimeout(() => { teardownTimedOut = true; reject(new Error('Fixture shutdown timed out.')); }, 10000); })]); }
      catch (error) { report.closeError = String(error); process.exitCode = 1; }
      finally { if (timer) clearTimeout(timer); }
    }
    await waitOwned();
  }
};
const launch = async () => {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') }); ownedProcesses.push(app.process());
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  const appPath = await app.evaluate(({ app }) => app.getAppPath());
  assert.equal(path.resolve(appPath).toLowerCase(), root.toLowerCase(), '必须运行本工作区源码应用。');
  editorWindowId = await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.unmaximize(); window.setContentSize(1400, 900); return window.id; });
  // Playwright otherwise forces renderer focus even when the native window
  // loses it. Disable that override so this check exercises actual OS focus.
  focusSession = await page.context().newCDPSession(page);
  focusSessions.push({ windowId: editorWindowId, enabled: false, detached: false });
  await focusSession.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await page.evaluate('globalThis.__name = value => value');
  await page.evaluate(() => {
    const records: InputRecord[] = []; let sequence = 0; (window as unknown as Probes).timelineHealthInputs = records;
    for (const type of ['keydown', 'focus', 'blur', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) window.addEventListener(type, event => {
      if (event instanceof PointerEvent && !event.buttons && type === 'pointermove') return;
      records.push({ sequence: ++sequence, type, trusted: event.isTrusted, windowTarget: event.target === window, focused: document.hasFocus(), ...(event instanceof PointerEvent ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY } : {}), ...(event instanceof KeyboardEvent ? { key: event.key } : {}), target: event.target === window ? 'window' : event.target instanceof Element ? event.target.getAttribute('aria-label') ?? event.target.getAttribute('class') ?? event.target.localName : undefined });
      if (records.length > 500) records.shift();
    }, true);
  });
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false }); tracing = true;
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())).toLowerCase(), path.join(root, 'dist/index.html').toLowerCase(), '必须使用本工作区最终统一构建。');
  await focusFixture('launch');
};
const field = (name: string) => page!.getByLabel(name, { exact: true }).filter({ visible: true });
const rootClip = (id: string) => page!.locator('.timeline-clip[data-node-id="' + id + '"]');
const childClip = (id: string) => page!.locator('.composition-track-clip[data-instance-id="' + id + '"]');
const rootState = () => page!.locator('.timeline-clip[data-node-id]').evaluateAll(elements => elements.map(element => ({ id: (element as HTMLElement).dataset.nodeId!, at: Number((element as HTMLElement).dataset.start), duration: Number((element as HTMLElement).dataset.duration) })).sort((a, b) => a.id.localeCompare(b.id)));
const childState = () => page!.locator('.composition-track-clip[data-instance-id]').evaluateAll(elements => elements.map(element => ({ id: (element as HTMLElement).dataset.instanceId!, at: Number((element as HTMLElement).dataset.start), duration: Number((element as HTMLElement).dataset.duration) })).sort((a, b) => a.id.localeCompare(b.id)));
const save = async () => {
  const button = page!.getByRole('button', { name: '保存工程', exact: true }); if (await button.isEnabled()) await button.click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  return projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
};
const undo = () => page!.getByRole('button', { name: '撤销', exact: true }).click();
const settle = () => page!.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const shot = async (name: string) => {
  const captured = await page!.screenshot({ type: 'png', scale: 'css' });
  const jpeg = await app!.evaluate(({ nativeImage }, encoded) => {
    const image = nativeImage.createFromBuffer(Buffer.from(encoded, 'base64')), size = image.getSize(), ratio = Math.min(1, 1280 / Math.max(size.width, size.height));
    return image.resize({ width: Math.max(1, Math.floor(size.width * ratio)), height: Math.max(1, Math.floor(size.height * ratio)) }).toJPEG(68).toString('base64');
  }, captured.toString('base64'));
  await fs.writeFile(path.join(output, name + '.jpg'), Buffer.from(jpeg, 'base64'));
};
const openTimeline = async () => {
  await page!.locator('[data-workspace-tab="assets"]').click();
  await field('资源显示范围').selectOption('all'); await field('搜索资源和蓝图').fill('交互边界演出');
  await page!.locator('[data-content-key="timeline:' + graphId + '"]').dblclick(); await expect(field('时间轴画布')).toBeVisible();
};
const selectRoot = async (id: string) => {
  await rootClip(id).scrollIntoViewIfNeeded(); await rootClip(id).click({ position: { x: 28, y: 15 } });
  const single = page!.getByRole('button', { name: '只选当前片段', exact: true });
  if (await single.isVisible()) { await single.click(); await rootClip(id).focus(); }
  await expect(page!.locator('.timeline-clip[aria-pressed="true"]')).toHaveCount(1);
};
const multiRoot = async (ids: string[]) => { await selectRoot(ids[0]); for (const id of ids.slice(1)) await rootClip(id).click({ position: { x: 28, y: 15 }, modifiers: ['Control'] }); await expect(page!.locator('.timeline-clip[aria-pressed="true"]')).toHaveCount(ids.length); };
const enterA = async () => { await rootClip(groupANode).dblclick({ position: { x: 30, y: 15 } }); await expect(page!.locator('.composition-workspace')).toHaveAttribute('data-group-id', groupA.instanceId); };
const exitComposition = async () => { await page!.getByRole('navigation', { name: '组合编辑路径' }).getByRole('button', { name: '交互边界演出', exact: true }).click(); await expect(field('时间轴画布')).toBeVisible(); };
const focusState = async (step: string) => ({ phase, step, nativeFocused: await app!.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)!.isFocused(), editorWindowId), rendererFocused: await page!.evaluate(() => document.hasFocus()) });
const focusFixture = async (step: string) => {
  await app!.evaluate(({ BrowserWindow }, id) => { const window = BrowserWindow.fromId(id)!; window.show(); window.focus(); window.focusOnWebView(); }, editorWindowId);
  await expect.poll(async () => { const state = await focusState(step); return state.nativeFocused && state.rendererFocused; }, { message: 'Owned editor must have native and renderer focus before dragging.' }).toBe(true);
  focusStates.push(await focusState(step));
};
const beginDrag = async (locator: Locator, deltaX: number) => {
  await focusFixture('before-drag');
  await locator.scrollIntoViewIfNeeded(); const box = await locator.boundingBox(); assert.ok(box);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page!.mouse.move(x, y); await page!.mouse.down(); await page!.mouse.move(x + deltaX, y, { steps: 5 });
  return { x, y };
};
const pointerId = () => page!.evaluate(() => { const record = [...(window as unknown as Probes).timelineHealthInputs].reverse().find(item => item.type === 'pointerdown'); if (record?.pointerId === undefined) throw new Error('No pointer evidence.'); return record.pointerId; });
const cancel = async (kind: 'escape' | 'blur' | 'lostcapture', locator: Locator) => {
  if (kind === 'escape') await page!.keyboard.press('Escape');
  else if (kind === 'blur') {
    const before = await focusState('before-blur'); focusStates.push(before);
    assert.ok(before.nativeFocused && before.rendererFocused, 'The active drag must still have native and renderer focus immediately before blur.');
    const activePointer = await pointerId();
    assert.ok(await locator.evaluate((element, id) => element.hasPointerCapture(id), activePointer), 'A real drag must own capture before native window blur.');
    const previous = await page!.evaluate(() => (window as unknown as Probes).timelineHealthInputs.at(-1)?.sequence ?? 0);
    // A fixture-owned native window takes focus without injecting DOM blur.
    // An element blur from the capture-phase probe is not a window blur.
    const id = await app!.evaluate(({ BrowserWindow }, editorId) => new BrowserWindow({ parent: BrowserWindow.fromId(editorId)!, modal: true, show: false, width: 320, height: 120,
      title: '时间轴失焦验收临时窗口', skipTaskbar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }).id, editorWindowId);
    const record: (typeof focusWindows)[number] = { phase, id, destroyed: false }; focusWindows.push(record);
    try {
      await app!.evaluate(async ({ BrowserWindow }, id) => {
        const helper = BrowserWindow.fromId(id)!;
        await helper.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html lang="zh-CN"><title>时间轴失焦验收</title><body>临时失焦验收窗口</body></html>'));
        helper.show(); helper.focus(); helper.focusOnWebView();
      }, id);
      await expect.poll(async () => {
        const native = await app!.evaluate(({ BrowserWindow }, ids) => ({ editor: BrowserWindow.fromId(ids.editor)!.isFocused(), helper: BrowserWindow.fromId(ids.helper)!.isFocused() }), { editor: editorWindowId, helper: id });
        const observed = await page!.evaluate(previous => !document.hasFocus() && (window as unknown as Probes).timelineHealthInputs.some(event => event.sequence > previous && event.type === 'blur' && event.windowTarget && event.trusted && !event.focused), previous);
        return !native.editor && native.helper && observed;
      }, { message: 'Native helper must take focus and deliver a new trusted window blur to the editor.' }).toBe(true);
      focusStates.push(await focusState('after-blur'));
      record.blurEvents = await page!.evaluate(previous => (window as unknown as Probes).timelineHealthInputs.filter(event => event.sequence > previous && event.type === 'blur' && event.windowTarget), previous);
    } catch (error) { record.error = String(error); throw error; }
    finally {
      await app!.evaluate(({ BrowserWindow }, id) => { const helper = BrowserWindow.fromId(id); if (helper && !helper.isDestroyed()) helper.destroy(); }, id);
      record.destroyed = await app!.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id) === null, id);
      assert.ok(record.destroyed, 'The owned native focus helper must be destroyed.');
      await focusFixture('after-blur-restore');
    }
    await settle();
  } else {
    const id = await pointerId(); await locator.evaluate((element, id) => { if (!element.hasPointerCapture(id)) throw new Error('Expected a real pointer capture.'); element.releasePointerCapture(id); }, id); await settle();
  }
};
const assertGraphsEqual = (actual: Project, expected: Project) => assert.deepEqual(projectGraphs(actual), projectGraphs(expected));
const rootCurveTimes = (saved: Project) => compositionObject(saved, projectGraphs(saved).find(graph => graph.id === graphId)!, titleId, title.instanceId).action.curves!.x!.map(frame => frame.at);
const expectMenuInViewport = async (name: string, lastAction?: string) => {
  const menu = page!.getByRole('menu', { name, exact: true });
  await expect(menu).toBeVisible();
  const read = () => menu.evaluate(element => {
    const bounds = element.getBoundingClientRect(), style = getComputedStyle(element);
    return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, width: innerWidth, height: innerHeight,
      clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, scrollable: ['auto', 'scroll'].includes(style.overflowY) };
  });
  await expect.poll(async () => { const bounds = await read(); return bounds.left >= 7 && bounds.top >= 7 && bounds.right <= bounds.width - 7 && bounds.bottom <= bounds.height - 7 && (bounds.scrollHeight <= bounds.clientHeight + 1 || bounds.scrollable); }, { message: 'The complete timeline menu must fit inside the viewport, with internal scrolling when needed.' }).toBe(true);
  menuBounds.push({ phase, name, ...(await read()) });
  if (lastAction) {
    const item = menu.getByRole('menuitem', { name: lastAction, exact: true });
    await item.scrollIntoViewIfNeeded();
    await expect(item).toBeInViewport({ ratio: 1 });
    assert.ok(await item.evaluate(element => {
      const box = element.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return hit === element || !!hit && element.contains(hit);
    }), 'The menu item must receive a normal pointer click.');
  }
};
const installMetadataGate = async () => {
  await page!.evaluate(() => {
    const original = document.createElement.bind(document);
    const held: (() => void)[] = [];
    const gate: MetadataGate = { enabled: true, held: 0, delivered: 0, release: () => { gate.enabled = false; for (const resume of held.splice(0)) { resume(); gate.delivered++; } }, restore: () => { gate.release(); document.createElement = original as typeof document.createElement; } };
    // Only defer the already-read native event. The product still creates the
    // media element, opens the real file, validates duration and owns cancellation.
    document.createElement = ((name: string, options?: ElementCreationOptions) => {
      const element = original(name, options);
      if (name.toLowerCase() === 'video') element.addEventListener('loadedmetadata', event => {
        const media = element as HTMLVideoElement;
        if (!gate.enabled || media.isConnected || !media.onloadedmetadata) return;
        const callback = media.onloadedmetadata; media.onloadedmetadata = null; gate.held++;
        held.push(() => callback.call(media, event));
      }, { once: true });
      return element;
    }) as typeof document.createElement;
    (window as unknown as Probes).timelineHealthMetadata = gate;
  });
};
const addVideo = async () => { await page!.getByRole('button', { name: '添加片段', exact: true }).click(); await expectMenuInViewport('添加片段菜单', '视频片段'); await page!.getByRole('menu', { name: '添加片段菜单' }).getByRole('menuitem', { name: '视频片段', exact: true }).click(); };

try {
  await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  const buildFiles = ['dist/index.html', 'dist-desktop/main.cjs', 'dist-desktop/preload.cjs', ...[...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => 'dist/' + match[1].slice(2))];
  assert.ok(buildFiles.some(file => file.startsWith('dist/assets/') && file.endsWith('.js')));
  report.build = await Promise.all([...new Set(buildFiles)].map(async file => ({ file, sha256: createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex') })));
  execFileSync(process.env.VNS_FFMPEG ?? 'ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=teal:s=160x90:r=12:d=3', '-c:v', 'libvpx', '-pix_fmt', 'yuv420p', '-an', path.join(directory, 'assets/metadata.webm')], { windowsHide: true, timeout: 30000 });
  project.assets = [{ id: 'health_video', name: '延迟读取验收视频', kind: 'video', path: 'assets/metadata.webm' }];
  const graph = blueprintFromPerformance(project, [title, groupA, groupB], '交互边界演出'); graph.timelineComponent = true; graph.performanceKind = 'standalone'; project.blueprints = [graph];
  const model = performanceTimeline(project, graph), tracks = ['文字', '组合甲轨道', '组合乙轨道'].map((name, index) => ({ id: 'health_track_' + index, name }));
  arrangePerformanceTimeline(project, graph, model.clips.map((clip, index) => ({ ...clip, at: 0, trackId: tracks[index].id })), tracks);
  await saveProject(projectFile, project); const baseline = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))); graphId = graph.id;
  const nodeFor = (id: string) => projectGraphs(baseline).find(item => item.id === graphId)!.nodes.find(node => (rawSavedBlueprintAction(node) as { instanceId?: string } | undefined)?.instanceId === id)!.id;
  titleId = nodeFor(title.instanceId); groupANode = nodeFor(groupA.instanceId); groupBNode = nodeFor(groupB.instanceId);
  await fs.copyFile(projectFile, path.join(output, 'initial-project-evidence.vns.json'));
  await launch(); await openTimeline(); await field('恢复默认演出布局').click();
  report.compiledEntry = await page!.evaluate(() => [...document.scripts].map(script => script.src).filter(Boolean));

  phase = 'precise keyframe click and drag';
  await selectRoot(titleId); await field('轨道缩放').selectOption('100'); await save();
  const marker = page!.locator('.timeline-grid .property-frame-marker').first(); await expect(marker).toHaveAttribute('data-time', '0.123');
  const beforeClick = await fs.readFile(projectFile, 'utf8');
  await marker.click(); await expect(marker).toHaveAttribute('data-time', '0.123'); await expect(field('时间轴播放头')).toHaveAttribute('aria-valuenow', '0.123');
  await expect(page!.locator('.dirty-dot')).toHaveCount(0); assert.equal(await fs.readFile(projectFile, 'utf8'), beforeClick);
  const markerBox = await marker.boundingBox(); assert.ok(markerBox); await page!.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2); await page!.mouse.down(); await page!.mouse.move(markerBox.x + markerBox.width / 2 + 2, markerBox.y + markerBox.height / 2); await page!.mouse.up();
  await expect(marker).toHaveAttribute('data-time', '0.123'); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  await beginDrag(marker, 20); await page!.mouse.up(); await expect(marker).toHaveAttribute('data-time', '0.3');
  const movedKeyframe = await save(); assert.deepEqual(rootCurveTimes(movedKeyframe), [.3, 2.417]);
  await undo(); await expect(marker).toHaveAttribute('data-time', '0.123'); assertGraphsEqual(await save(), baseline);
  checks.push('0.123秒关键帧单击和2px轻移仅精确定位、不改工程；超过阈值才吸附到0.05秒，单次撤销恢复。');
  await shot('01-precise-keyframe');

  phase = 'keyframe cancellation and undo context';
  for (const cancellation of ['escape', 'blur', 'lostcapture'] as const) {
    const point = await beginDrag(marker, 25); await cancel(cancellation, marker); await page!.mouse.move(point.x + 45, point.y); await page!.mouse.up();
    await expect(marker).toHaveAttribute('data-time', '0.123'); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  }
  // Ctrl+Z while the same keyed frame is held must retire its old draft.
  await field('片段名称').fill('可撤销的名字'); await field('片段名称').press('Tab');
  const undoPoint = await beginDrag(marker, 25); await page!.keyboard.press('Control+z'); await page!.mouse.move(undoPoint.x + 50, undoPoint.y); await page!.mouse.up();
  await expect(field('片段名称')).toHaveValue(title.name); await expect(marker).toHaveAttribute('data-time', '0.123'); assertGraphsEqual(await save(), baseline);
  checks.push('关键帧Escape、真实窗口失焦、原生丢失捕获及拖动中撤销均取消草稿；迟到pointerup不写回。');

  phase = 'root context target and bulk selection';
  const initialRoot = await rootState();
  await multiRoot([groupANode, groupBNode]); await rootClip(groupANode).click({ button: 'right', position: { x: 28, y: 15 } });
  await expectMenuInViewport('片段右键菜单', '进入组合');
  await page!.getByRole('menuitem', { name: '进入组合', exact: true }).click(); await expect(page!.locator('.composition-workspace')).toHaveAttribute('data-group-id', groupA.instanceId); await exitComposition();
  await multiRoot([groupANode, titleId]); await rootClip(groupANode).click({ button: 'right', position: { x: 28, y: 15 } });
  await expect(page!.getByRole('menuitem', { name: '进入组合', exact: true })).toBeVisible();
  await expectMenuInViewport('片段右键菜单', '删除片段');
  await expectMenuInViewport('片段右键菜单', '保存为组合资源'); await shot('02a-root-menu-bottom');
  await page!.getByRole('menuitem', { name: '保存为组合资源', exact: true }).click();
  const withResource = await save(), addedGraphs = projectGraphs(withResource).filter(item => !projectGraphs(baseline).some(before => before.id === item.id));
  assert.equal(addedGraphs.length, 1); assert.equal(addedGraphs[0].name, groupA.name); assert.equal(addedGraphs[0].visualComposition, true);
  await undo(); assertGraphsEqual(await save(), baseline);
  await multiRoot([groupANode, groupBNode]); await rootClip(groupANode).click({ button: 'right', position: { x: 28, y: 15 } });
  await expectMenuInViewport('片段右键菜单', '复制片段');
  await page!.getByRole('menuitem', { name: '复制片段', exact: true }).click(); await expect(page!.locator('.timeline-clip')).toHaveCount(5); await expect(page!.locator('.timeline-clip[aria-pressed="true"]')).toHaveCount(2);
  await undo(); await expect.poll(rootState).toEqual(initialRoot); assertGraphsEqual(await save(), baseline);
  await page!.getByRole('button', { name: '添加片段', exact: true }).click();
  await expectMenuInViewport('添加片段菜单');
  await page!.getByRole('menu', { name: '添加片段菜单' }).locator('summary').click();
  await expectMenuInViewport('添加片段菜单');
  await page!.keyboard.press('Escape'); await expect(page!.getByRole('menu', { name: '添加片段菜单' })).toHaveCount(0);
  checks.push('右键非活动组合进入和保存均用右键目标；另一活动项为文字仍显示入口；批量复制保留两项选区并可一次撤销；完整右键菜单及展开的添加菜单位于窗口内，底部保存入口可正常点击。');
  await shot('02-context-target');

  phase = 'shared cancellation root clips and lifetime rows';
  await selectRoot(titleId);
  for (const cancellation of ['escape', 'blur', 'lostcapture'] as const) {
    const point = await beginDrag(rootClip(titleId), 35); await cancel(cancellation, rootClip(titleId)); await page!.mouse.move(point.x + 65, point.y); await page!.mouse.up(); await expect.poll(rootState).toEqual(initialRoot);
  }
  await field('显示实例生命周期').check();
  const lifetime = page!.locator('.lifetime-span[data-instance-id="' + childA.instanceId + '"]');
  for (const cancellation of ['escape', 'blur', 'lostcapture'] as const) {
    const point = await beginDrag(lifetime, 35); await cancel(cancellation, lifetime); await page!.mouse.move(point.x + 65, point.y); await page!.mouse.up();
    assertGraphsEqual(await save(), baseline);
  }
  await field('显示实例生命周期').uncheck(); checks.push('根片段与子对象显示区间共用取消协议，Escape、失焦、丢失捕获均不产生迟到提交。');

  phase = 'composition copy focus and keyboard target';
  await enterA(); const beforeCopy = await childState();
  await childClip(nested.instanceId).click({ button: 'right', position: { x: 28, y: 15 } });
  await expectMenuInViewport('片段右键菜单', '删除片段');
  await expectMenuInViewport('片段右键菜单', '保存为组合资源'); await shot('02b-composition-menu-bottom');
  await page!.getByRole('menuitem', { name: '保存为组合资源', exact: true }).click();
  const nestedResourceProject = await save(), nestedResources = projectGraphs(nestedResourceProject).filter(item => !projectGraphs(baseline).some(before => before.id === item.id));
  assert.equal(nestedResources.length, 1); assert.equal(nestedResources[0].name, nested.name); assert.equal(nestedResources[0].visualComposition, true);
  await undo(); await expect.poll(childState).toEqual(beforeCopy); assertGraphsEqual(await save(), baseline);
  await childClip(childA.instanceId).click({ position: { x: 28, y: 15 } });
  await page!.keyboard.press('Control+d'); await expect(page!.locator('.composition-track-clip')).toHaveCount(4);
  const afterCopy = await childState(), copy = afterCopy.find(item => !beforeCopy.some(original => original.id === item.id)); assert.ok(copy);
  await expect(childClip(copy.id)).toHaveAttribute('aria-pressed', 'true'); await expect(childClip(copy.id)).toBeFocused();
  await page!.keyboard.press('ArrowRight'); await expect(childClip(copy.id)).toHaveAttribute('data-start', '1.1'); await expect(childClip(childA.instanceId)).toHaveAttribute('data-start', '1');
  await undo(); await expect.poll(childState).toEqual(afterCopy); await undo(); await expect.poll(childState).toEqual(beforeCopy);
  await childClip(childA.instanceId).click({ position: { x: 28, y: 15 } }); await childClip(childB.instanceId).click({ position: { x: 28, y: 15 }, modifiers: ['Control'] }); await page!.keyboard.press('Control+d');
  await expect(page!.locator('.composition-track-clip[aria-pressed="true"]')).toHaveCount(2); const bulkCopy = await childState();
  await page!.keyboard.press('ArrowRight'); await expect.poll(childState).toEqual(bulkCopy);
  await page!.keyboard.press('Delete'); await expect.poll(childState).toEqual(beforeCopy); await expect(field('组合轨道画布')).toBeFocused();
  await undo(); await expect.poll(childState).toEqual(bulkCopy); await undo(); await expect.poll(childState).toEqual(beforeCopy); assertGraphsEqual(await save(), baseline);
  checks.push('组合右键菜单完整位于窗口内，底部保存可正常点击并一次撤销；复制后焦点与副本一致，方向键仅移动副本；撤销分别恢复移动和复制；多选箭头不误改旧行，删除后焦点回画布。');
  await shot('03-composition-copy-focus');

  phase = 'composition playhead capture cancellation';
  const grid = page!.locator('.composition-grid'), ruler = page!.locator('.composition-ruler-main');
  for (const cancellation of ['escape', 'blur', 'lostcapture'] as const) {
    await focusFixture('before-scrub');
    await field('组合轨道画布').evaluate(element => { element.scrollLeft = 0; }); const box = await ruler.boundingBox(); assert.ok(box);
    const zoom = Number(await field('组合轨道画布').getAttribute('data-zoom')), x = box.x + 200 + zoom, y = box.y + box.height / 2;
    await page!.mouse.move(x, y); await page!.mouse.down(); await page!.mouse.move(x + zoom / 2, y, { steps: 4 }); const stopped = await field('组合当前时间').innerText();
    await cancel(cancellation, grid); await page!.mouse.move(x + zoom, y); await page!.mouse.up(); await page!.mouse.move(x + zoom * 1.5, y);
    await expect(field('组合当前时间')).toHaveText(stopped);
    await field('组合轨道画布').focus(); await page!.keyboard.press('Space'); await expect(page!.locator('.performance-preview .line-preview-play')).toHaveClass(/active/); await page!.keyboard.press('Space'); await expect(page!.locator('.performance-preview .line-preview-play')).not.toHaveClass(/active/);
  }
  const gridBox = await ruler.boundingBox(); assert.ok(gridBox); await page!.mouse.move(gridBox.x + 240, gridBox.y + gridBox.height / 2); await page!.mouse.down(); const actualPointer = await pointerId(); const unchangedTime = await field('组合当前时间').innerText();
  await grid.dispatchEvent('pointermove', { pointerId: actualPointer + 100, clientX: gridBox.x + 600, clientY: gridBox.y + gridBox.height / 2, buttons: 1 });
  await grid.dispatchEvent('pointerup', { pointerId: actualPointer + 100, clientX: gridBox.x + 600, clientY: gridBox.y + gridBox.height / 2 }); await expect(field('组合当前时间')).toHaveText(unchangedTime);
  await cancel('escape', grid); await page!.mouse.up(); assertGraphsEqual(await save(), baseline);
  checks.push('组合播放头Escape、窗口失焦、丢失捕获后停止跟随，Space恢复可用；其它pointerId不能移动或完成当前手势。');

  phase = 'composition clip cancellation';
  await field('组合时间轴吸附').uncheck(); await childClip(childA.instanceId).click({ position: { x: 28, y: 15 } });
  for (const cancellation of ['escape', 'blur', 'lostcapture'] as const) {
    const point = await beginDrag(childClip(childA.instanceId), 40); await cancel(cancellation, childClip(childA.instanceId)); await page!.mouse.move(point.x + 65, point.y); await page!.mouse.up(); await expect.poll(childState).toEqual(beforeCopy);
  }
  assertGraphsEqual(await save(), baseline); checks.push('组合片段拖动取消共用捕获生命周期，取消后移动和松开不提交。');

  phase = 'late metadata after group navigation';
  await installMetadataGate(); await addVideo(); await expect.poll(() => page!.evaluate(() => (window as unknown as Probes).timelineHealthMetadata!.held)).toBe(1);
  await childClip(nested.instanceId).dblclick({ position: { x: 28, y: 15 } }); await expect(page!.locator('.composition-workspace')).toHaveAttribute('data-group-id', nested.instanceId);
  const nestedBefore = await childState(), navigationTime = await field('组合当前时间').innerText();
  await page!.evaluate(() => (window as unknown as Probes).timelineHealthMetadata!.release()); await settle();
  await expect.poll(childState).toEqual(nestedBefore); await expect(field('组合当前时间')).toHaveText(navigationTime); assertGraphsEqual(await save(), baseline);
  assert.equal(await page!.evaluate(() => (window as unknown as Probes).timelineHealthMetadata!.delivered), 1);
  await page!.evaluate(() => (window as unknown as Probes).timelineHealthMetadata!.restore());
  await page!.getByRole('button', { name: '返回上层', exact: true }).click(); await expect(page!.locator('.composition-workspace')).toHaveAttribute('data-group-id', groupA.instanceId); await expect.poll(childState).toEqual(beforeCopy);
  await installMetadataGate(); await addVideo(); await expect.poll(() => page!.evaluate(() => (window as unknown as Probes).timelineHealthMetadata!.held)).toBe(1);
  const nameBeforeRevision = await field('组合片段名称').inputValue();
  await field('组合片段名称').fill('取消请求的改名'); await field('组合片段名称').press('Tab'); const revisionBefore = await save();
  await page!.evaluate(() => (window as unknown as Probes).timelineHealthMetadata!.release()); await settle(); assertGraphsEqual(await save(), revisionBefore); await expect.poll(childState).toEqual(beforeCopy);
  await page!.evaluate(() => (window as unknown as Probes).timelineHealthMetadata!.restore()); await undo(); await expect(field('组合片段名称')).toHaveValue(nameBeforeRevision); assertGraphsEqual(await save(), baseline);
  checks.push('真实视频metadata延后：切入内层或修改工程版本后，原请求均失效；释放迟到回调不插入旧组、不抢选择或播放头。');
  await shot('04-metadata-scope');

  phase = 'normal video add save reopen undo boundary';
  await page!.getByRole('navigation', { name: '组合编辑路径' }).getByRole('button', { name: groupA.name, exact: true }).click();
  await addVideo(); await expect(page!.locator('.composition-track-clip')).toHaveCount(4);
  const finalChildren = await childState(), addedVideo = finalChildren.find(item => !beforeCopy.some(original => original.id === item.id)); assert.ok(addedVideo);
  const finalProject = await save(); const finalAction = compositionObject(finalProject, projectGraphs(finalProject).find(graph => graph.id === graphId)!, groupANode, addedVideo.id).action;
  assert.equal(finalAction.content, 'video'); assert.equal(finalAction.assetId, 'health_video'); assert.ok(finalAction.sourceDuration && Math.abs(finalAction.sourceDuration - 3) < .1);
  await fs.copyFile(projectFile, path.join(output, 'saved-project-evidence.vns.json'));
  await undo(); await expect.poll(childState).toEqual(beforeCopy); assertGraphsEqual(await save(), baseline);
  await page!.getByRole('button', { name: '重做', exact: true }).click(); await expect.poll(childState).toEqual(finalChildren); assertGraphsEqual(await save(), finalProject);
  await closeApp(); assert.ok(ownedProcesses.every(child => child.exitCode !== null || child.signalCode !== null));
  await launch(); await openTimeline(); await enterA(); await expect.poll(childState).toEqual(finalChildren); assertGraphsEqual(await save(), finalProject);
  assert.deepEqual(rootCurveTimes(finalProject), [.123, 2.417]);
  await shot('05-saved-reopened'); checks.push('未取消的视频正常插入、一次撤销/重做，关闭并重开后片段和精确关键帧完整保留。');
  report.projectSha256 = createHash('sha256').update(await fs.readFile(projectFile)).digest('hex'); report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.phase = phase; report.failure = error instanceof Error ? error.stack : String(error); process.exitCode = 1;
  if (page) {
    report.inputEvidence = await page.evaluate(() => (window as unknown as Probes).timelineHealthInputs).catch(() => []);
    await shot('failure').catch(() => undefined); await fs.writeFile(path.join(output, 'failure-dom.txt'), await page.locator('body').innerText().catch(() => '')).catch(() => undefined);
  }
} finally {
  await fs.mkdir(output, { recursive: true }); await fs.copyFile(projectFile, path.join(output, 'project-evidence.vns.json')).catch(() => undefined);
  await closeApp(); report.checks = checks; report.errors = errors; report.traces = traces;
  report.processExited = ownedProcesses.every(child => child.exitCode !== null || child.signalCode !== null); report.teardownTimedOut = teardownTimedOut;
  if (report.status === 'passed' && (errors.length || report.traceError || report.closeError || report.focusSessionError || !report.processExited || teardownTimedOut)) { report.status = 'failed'; process.exitCode = 1; }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (report.processExited && !teardownTimedOut) {
    try {
      await fs.cp(path.join(directory, 'assets'), path.join(output, 'assets'), { recursive: true });
      const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); report.cleanup = cleanup;
      if (cleanup.errors.length) { report.status = 'failed'; report.cleanupError = 'Some owned temporary directories remain.'; process.exitCode = 1; }
    } catch (error) { report.status = 'failed'; report.cleanupError = String(error); process.exitCode = 1; }
  } else { report.status = 'failed'; process.exitCode = 1; await fs.writeFile(path.join(output, 'cleanup.json'), JSON.stringify({ retained: [directory, path.join(output, 'profile')], reason: 'Owned fixture has not confirmed shutdown.' }, null, 2)); }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, status: report.status, checks, errors, failure: report.failure, processExited: report.processExited }, null, 2));
}
