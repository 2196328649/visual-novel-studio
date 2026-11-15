import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, type Locator } from '@playwright/test';
import { PNG } from 'pngjs';
import { assetFiles, type Project } from '../src/core/model';
import { projectToText } from '../src/core/text-script';
import { currentScriptText } from '../src/core/script-text';
import { assetSourcePath } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

const root = path.resolve('.');
const argument = (name: string) => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
const original = path.resolve(root, argument('--source') ?? 'resources/templates/aihong/project.vns.json');
const appRoot = path.resolve(root, argument('--app-root') ?? root), sdkRoot = path.join(root, 'resources/runtime');
const baseline = process.argv.includes('--baseline'), diagnose = process.argv.includes('--diagnose');
const linesArgument = argument('--lines'), requestedLines = linesArgument === undefined ? 0 : Number(linesArgument);
assert.ok(Number.isSafeInteger(requestedLines) && requestedLines >= 0, '--lines must be a non-negative integer.');
const bytes = await fs.readFile(original), hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const originalHash = hash(bytes), project: Project = JSON.parse(bytes.toString('utf8'));
const passage = project.nodes.filter(node => node.kind === 'passage').sort((a, b) => b.lines.length - a.lines.length)[0];
assert.ok(passage?.kind === 'passage');
if (requestedLines) {
  const sourceLines = passage.lines.filter(line => !line.silent);
  assert.ok(sourceLines.length, 'the source must contain a dialogue line to scale the fixture.');
  passage.lines = Array.from({ length: requestedLines }, (_, index) => ({ ...structuredClone(sourceLines[index % sourceLines.length]), id: 'profile_line_' + index }));
}
const lines = passage.lines.filter(line => !line.silent);
assert.ok(lines.length > 1, 'the scroll fixture must contain at least two dialogue lines');
for (const asset of project.assets) {
  asset.externalFiles = Object.fromEntries(assetFiles(asset).map(relative => [relative, assetSourcePath(path.dirname(original), asset, relative)]));
  asset.externalPath = asset.externalFiles[asset.path];
}
project.playerDefaults = { ...project.playerDefaults, masterVolume: 0 };
project.scriptText = currentScriptText(projectToText(project), project.scriptText?.sourceName);
const output = path.resolve(root, argument('--artifact-root') ?? 'artifacts/module-scroll-performance', new Date().toISOString().replaceAll(':', '-') + (baseline ? '-baseline' : ''));
const ownedTemporaryPaths = ['project', 'profile'].map(name => path.join(output, name));
const screenshots: { originalPath: string; thumbnailPath?: string; width: number; height: number }[] = [];
const projectFile = path.join(output, 'project/project.vns.json');
await fs.mkdir(path.dirname(projectFile), { recursive: true });
await fs.writeFile(projectFile, JSON.stringify(project));
const app = await launchDesktopFixture({ root: appRoot, sdkRoot, projectFile, profile: path.join(output, 'profile') });
const page = await app.firstWindow(), errors: string[] = [], checks: string[] = [];
const metrics: Record<string, any> = {};
page.on('pageerror', error => errors.push(error.message));
let phase = 'launch';
const summarize = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, medianMs: sorted[Math.floor(sorted.length / 2)] ?? 0, p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] ?? 0, maxMs: sorted.at(-1) ?? 0, over34: values.filter(value => value > 34).length, over50: values.filter(value => value > 50).length };
};
const saveScreenshot = async (name: string) => {
  const originalPath = path.join(output, name), bytes = await page.screenshot({ path: originalPath });
  const image = PNG.sync.read(bytes), scale = Math.min(1, 1280 / Math.max(image.width, image.height));
  let thumbnailPath: string | undefined;
  if (scale < 1) {
    const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale));
    const thumbnail = new PNG({ width, height });
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const sourceX = Math.min(image.width - 1, Math.floor((x + .5) / scale));
      const sourceY = Math.min(image.height - 1, Math.floor((y + .5) / scale));
      const sourceAt = (sourceY * image.width + sourceX) * 4, targetAt = (y * width + x) * 4;
      image.data.copy(thumbnail.data, targetAt, sourceAt, sourceAt + 4);
    }
    thumbnailPath = path.join(output, name.replace(/\.png$/i, '-thumbnail.png'));
    await fs.writeFile(thumbnailPath, PNG.sync.write(thumbnail));
  }
  screenshots.push({ originalPath, thumbnailPath, width: image.width, height: image.height });
};
const clickAt = async (locator: Locator) => {
  const point = await locator.evaluate(element => {
    const rect = element.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2, hit = document.elementFromPoint(x, y);
    return { x, y, visible: rect.width > 0 && rect.height > 0 && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && !!hit && (hit === element || element.contains(hit)) };
  });
  assert.ok(point.visible, 'test mouse clicks require the target to be visible and hit-testable without locator scrolling');
  await page.mouse.click(point.x, point.y);
};
const bringIntoScriptViewport = async (locator: Locator) => {
  await locator.evaluate(element => {
    const viewport = element.closest<HTMLElement>('.script-scroll');
    if (!viewport) throw new Error('Expected a module editor target inside .script-scroll');
    const bounds = viewport.getBoundingClientRect(), rect = element.getBoundingClientRect();
    if (rect.top < bounds.top) viewport.scrollTop += rect.top - bounds.top;
    else if (rect.bottom > bounds.bottom) viewport.scrollTop += rect.bottom - bounds.bottom;
  });
  await page.waitForTimeout(60);
};
const bringIntoDirectoryViewport = async (locator: Locator) => {
  await locator.evaluate(element => {
    const viewport = element.closest<HTMLElement>('.story-directory .sidebar-scroll');
    if (!viewport) throw new Error('Expected a directory target inside .story-directory .sidebar-scroll');
    const bounds = viewport.getBoundingClientRect(), rect = element.getBoundingClientRect();
    if (rect.top < bounds.top) viewport.scrollTop += rect.top - bounds.top;
    else if (rect.bottom > bounds.bottom) viewport.scrollTop += rect.bottom - bounds.bottom;
  });
  await page.waitForTimeout(60);
};
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 60000 });
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.webContents.setBackgroundThrottling(false); window.setContentSize(1440, 960); window.show(); window.focus(); });
  await openStoryMode(page, 'script');
  if (!await page.locator(`#node-${passage.id}`).count()) await page.locator('.story-directory').getByText(project.scenes.find(scene => scene.id === passage.sceneId)!.name, { exact: true }).first().click();
  const showUnnamed = page.locator('.story-directory button[title="显示未命名的对白和演出"]');
  if (await showUnnamed.count() && await showUnnamed.getAttribute('aria-pressed') !== 'true') await clickAt(showUnnamed);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const scroll = page.locator('.script-scroll');
  await scroll.evaluate(element => { element.scrollTop = 0; (document.activeElement as HTMLElement)?.blur(); });
  await page.waitForTimeout(600);
  metrics.fixture = { source: original, originalHash, appRoot, sdkRoot, requestedLines: requestedLines || undefined, lines: lines.length,
    sceneLines: project.nodes.filter(node => node.sceneId === passage.sceneId).reduce((count, node) => count + (node.kind === 'passage' ? node.lines.length : 0), 0),
    assets: project.assets.length, characters: project.characters.length, domNodes: await page.locator('*').count() };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable'); await cdp.send('Profiler.enable');
  // A string avoids tsx's injected __name helper inside browser functions.
  await page.evaluate(`(() => {
    const sample = window.scrollSample = { phase: '', frames: [], inputFrames: [], longTasks: [], scrolls: [], scrollIntoView: [], mutations: {}, last: performance.now(), active: true };
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    const nativeScrollIntoView = descriptor.value;
    Object.defineProperty(Element.prototype, 'scrollIntoView', { ...descriptor, value: function measuredScrollIntoView(...args) {
      if (!sample.active || !sample.phase) return Reflect.apply(nativeScrollIntoView, this, args);
      const phase = sample.phase, start = performance.now();
      try { return Reflect.apply(nativeScrollIntoView, this, args); }
      finally { sample.scrollIntoView.push({ phase, start, duration: performance.now() - start, elementId: this.id, tagName: this.tagName, lineElementId: this.closest('.story-line')?.id }); }
    } });
    window.restoreModuleScrollIntoView = () => {
      Object.defineProperty(Element.prototype, 'scrollIntoView', descriptor);
      delete window.restoreModuleScrollIntoView;
    };
    const tick = now => { if (!sample.active) return; if (sample.phase) sample.frames.push({ phase: sample.phase, start: sample.last, duration: now - sample.last }); sample.last = now; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    window.scrollObserver = new PerformanceObserver(list => sample.longTasks.push(...list.getEntries().map(entry => ({ phase: sample.phase, start: entry.startTime, duration: entry.duration }))));
    window.scrollObserver.observe({ type: 'longtask' });
    document.querySelector('.script-scroll').addEventListener('scroll', () => { if (sample.phase) sample.scrolls.push({ phase: sample.phase, time: performance.now() }); }, { passive: true });
    window.sampleMutations = new MutationObserver(records => {
      if (!sample.phase) return;
      for (const record of records) if (record.target.closest('.text-look-sample')) sample.mutations[sample.phase] = (sample.mutations[sample.phase] || 0) + 1;
    });
    window.sampleMutations.observe(document.querySelector('.script-scroll'), { attributes: true, subtree: true, attributeFilter: ['style'] });
  })()`);
  const position = async (top?: number) => {
    await scroll.evaluate((element, { top, firstLineId }) => {
      const target = document.getElementById('line-' + firstLineId);
      element.scrollTop = top ?? (target ? element.scrollTop + target.getBoundingClientRect().top - element.getBoundingClientRect().top : 0);
      (document.activeElement as HTMLElement)?.blur();
    }, { top, firstLineId: lines[0].id });
    await page.waitForTimeout(250);
    const box = (await scroll.boundingBox())!;
    await page.mouse.move(box.x + box.width - 28, box.y + box.height * .55);
  };
  const wheel = async (steps = 36, delta = 180) => {
    for (const direction of [1, -1]) {
      for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, direction * delta); await page.waitForTimeout(20); }
      await page.waitForTimeout(80);
      if (direction === 1) assert.ok(await scroll.evaluate(element => element.scrollTop) > 1500, 'wheel input must move the module list');
    }
    await page.waitForTimeout(200);
  };
  const interactionState = (targetLineId?: string) => page.evaluate(targetLineId => {
    const viewport = document.querySelector('.script-scroll');
    const selected = viewport?.querySelector('.story-line.selected');
    const target = targetLineId ? document.getElementById('line-' + targetLineId) : undefined;
    return { nodeId: viewport?.querySelector('.passage-section.active')?.id.slice(5), lineId: selected?.id.slice(5), scrollTop: viewport?.scrollTop,
      targetLineId, targetSelected: target?.classList.contains('selected'), targetExpanded: target?.classList.contains('text-expanded') };
  }, targetLineId);
  const measure = async (name: string, action: () => Promise<void>, options: { targetLineId?: string; scrolling?: boolean; settleMs?: number } = {}) => {
    phase = name;
    const beforeState = await interactionState(options.targetLineId);
    await cdp.send('Profiler.start');
    const before = (await cdp.send('Performance.getMetrics')).metrics;
    await page.evaluate(name => { (window as any).scrollSample.phase = name; (window as any).scrollSample.last = performance.now(); }, name);
    const start = performance.now(); await action(); const wallMs = performance.now() - start;
    if (options.settleMs) await page.waitForTimeout(options.settleMs);
    const sample = await page.evaluate(() => { const result = (window as any).scrollSample; result.phase = ''; return result; });
    const after = (await cdp.send('Performance.getMetrics')).metrics;
    const { profile } = await cdp.send('Profiler.stop');
    const afterState = await interactionState(options.targetLineId);
    const own = new Map<number, number>();
    profile.samples?.forEach((id, index) => own.set(id, (own.get(id) ?? 0) + (profile.timeDeltas?.[index] ?? 0)));
    const top = profile.nodes.map(node => ({ name: node.callFrame.functionName, url: node.callFrame.url, line: node.callFrame.lineNumber, column: node.callFrame.columnNumber, ms: (own.get(node.id) ?? 0) / 1000 })).sort((a, b) => b.ms - a.ms).slice(0, 24);
    const totals = Object.fromEntries(after.filter(metric => /(?:Layout|RecalcStyle|Task|Script)(?:Count|Duration)$/.test(metric.name)).map(metric => [metric.name, metric.value - (before.find(item => item.name === metric.name)?.value ?? 0)]));
    const scrollCalls = sample.scrollIntoView.filter((entry: any) => entry.phase === name);
    metrics[name] = { wallMs, scrolling: !!options.scrolling, before: beforeState, after: afterState, selectionChanged: beforeState.nodeId !== afterState.nodeId || beforeState.lineId !== afterState.lineId,
      inputFrames: sample.inputFrames.filter((entry: any) => entry.phase === name),
      scrollIntoView: { count: scrollCalls.length, totalMs: scrollCalls.reduce((sum: number, entry: any) => sum + entry.duration, 0), calls: scrollCalls },
      frames: summarize(sample.frames.filter((entry: any) => entry.phase === name).map((entry: any) => entry.duration)), longTasks: sample.longTasks.filter((entry: any) => entry.phase === name), totals, previewStyleMutations: sample.mutations[name] ?? 0, scrolls: sample.scrolls.filter((entry: any) => entry.phase === name), top };
    await fs.writeFile(path.join(output, name + '.cpuprofile'), JSON.stringify(profile));
    await fs.writeFile(path.join(output, 'samples.json'), JSON.stringify(sample));
    console.log(JSON.stringify({ phase: name, frames: metrics[name].frames, longTasks: metrics[name].longTasks.map((entry: any) => entry.duration), totals, previewStyleMutations: metrics[name].previewStyleMutations }));
  };
  const timedClick = async (locator: Locator) => {
    await locator.evaluate(element => {
      if (element instanceof HTMLTextAreaElement && document.activeElement === element) return;
      element.addEventListener(element instanceof HTMLTextAreaElement ? 'focus' : 'click', event => {
        const sample = (window as any).scrollSample, phase = sample.phase, start = performance.now();
        requestAnimationFrame(() => sample.inputFrames.push({ phase, event: event.type, elementId: element.id, lineElementId: element.closest('.story-line')?.id, start, duration: performance.now() - start }));
      }, { once: true, capture: true });
    });
    await clickAt(locator);
  };
  await position(); await measure('collapsed-cold', () => wheel(), { scrolling: true });
  await position(); await measure('collapsed-warm', () => wheel(), { scrolling: true });
  const initialState = await interactionState();
  // The first row can already be selected on load. Use another line for a real
  // selection change, then expand that same selected row as a separate action.
  const visibleIds = await scroll.evaluate(viewport => {
    const bounds = viewport.getBoundingClientRect();
    return Array.from(viewport.querySelectorAll<HTMLElement>('.story-line'))
      .filter(row => { const rect = row.getBoundingClientRect(); return rect.bottom > bounds.top && rect.top < bounds.bottom; })
      .map(row => row.id.slice(5));
  });
  const localSelection = lines.find(line => line.id !== initialState.lineId && visibleIds.includes(line.id));
  assert.ok(localSelection, 'the fixture must expose another dialogue row for local selection');
  const measuredLine = localSelection;
  const row = page.locator(`#line-${measuredLine.id}`);
  const firstTrace: any[] = [];
  if (process.argv.includes('--trace-first')) {
    cdp.on('Tracing.dataCollected', event => firstTrace.push(...event.value));
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink,cc,gpu,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,disabled-by-default-devtools.timeline.stack,disabled-by-default-devtools.timeline.invalidationTracking', transferMode: 'ReportEvents' });
  }
  await measure('first-selection', () => timedClick(row.locator('textarea')), { targetLineId: measuredLine.id, settleMs: 220 });
  assert.equal(metrics['first-selection'].after.lineId, measuredLine.id);
  if (lines.length > 1) assert.equal(metrics['first-selection'].selectionChanged, true, 'the first selection sample must select another row');
  if (!baseline) assert.equal(metrics['first-selection'].scrollIntoView.count, 0, 'a local pointer selection must not call scrollIntoView');
  await expect(row.locator('.line-expand')).toHaveAttribute('aria-expanded', 'false');
  await measure('first-expansion', () => timedClick(row.locator('.line-expand')), { targetLineId: measuredLine.id, settleMs: 220 });
  assert.equal(metrics['first-expansion'].before.targetSelected, true, 'first expansion must be independent of changing the selected row');
  assert.equal(metrics['first-expansion'].selectionChanged, false);
  if (!baseline) assert.equal(metrics['first-expansion'].scrollIntoView.count, 0, 'expanding an already selected row must not call scrollIntoView');
  await expect(row.locator('.line-expand')).toHaveAttribute('aria-expanded', 'true');
  checks.push('首轮选行与已选中行的首次展开分别记录，报告包含前后选中对象、滚动位置及原生自动定位调用；单行工程会明确记录选择未改变。');
  const activeTreeEntry = page.locator('.story-directory .tree-node.active').first();
  const activeSceneEntry = page.locator('.story-directory .scene-row.active > button').first();
  const directoryEntry = await activeTreeEntry.count() ? activeTreeEntry : activeSceneEntry;
  assert.ok(await directoryEntry.count(), 'the selected passage must be reachable from the story directory');
  await bringIntoDirectoryViewport(directoryEntry);
  await clickAt(directoryEntry);
  await scroll.evaluate(viewport => { viewport.scrollTop = viewport.scrollHeight; });
  const repeatedBefore = await interactionState();
  await measure('directory-repeat', () => clickAt(directoryEntry), { targetLineId: repeatedBefore.lineId, settleMs: 220 });
  assert.equal(metrics['directory-repeat'].selectionChanged, false, 'repeating the active directory entry preserves selection');
  if (!baseline) assert.ok(metrics['directory-repeat'].scrollIntoView.count > 0, 'repeating an active directory entry must reveal its offscreen target');
  const repeatedVisible = await page.evaluate(lineId => {
    const viewport = document.querySelector<HTMLElement>('.script-scroll')!, target = lineId ? document.getElementById('line-' + lineId) : viewport.querySelector<HTMLElement>('.passage-section.active .passage-heading-row'), bounds = viewport.getBoundingClientRect(), rect = target?.getBoundingClientRect();
    return !!rect && rect.bottom > bounds.top && rect.top < bounds.bottom;
  }, repeatedBefore.lineId);
  if (!baseline) assert.ok(repeatedVisible, 'repeated directory navigation must reveal its selected module');
  if (!baseline) {
    const activeNodeId = repeatedBefore.nodeId!;
    const foldToggle = page.locator('#node-' + activeNodeId + ' .module-fold-toggle');
    if (await foldToggle.count()) {
      await bringIntoScriptViewport(foldToggle);
      await clickAt(foldToggle);
      await scroll.evaluate(viewport => { viewport.scrollTop = viewport.scrollHeight; });
      await measure('directory-repeat-collapsed', () => clickAt(directoryEntry), { targetLineId: repeatedBefore.lineId, settleMs: 220 });
      const collapsedReveal = await page.evaluate(({ activeNodeId, lineId }) => {
        const viewport = document.querySelector<HTMLElement>('.script-scroll')!, section = document.getElementById('node-' + activeNodeId)!, body = section.querySelector<HTMLElement>('.module-body')!, target = lineId ? document.getElementById('line-' + lineId) : section.querySelector<HTMLElement>('.passage-heading-row'), bounds = viewport.getBoundingClientRect(), rect = target?.getBoundingClientRect();
        return { expanded: !body.hidden, visible: !!rect && rect.bottom > bounds.top && rect.top < bounds.bottom };
      }, { activeNodeId, lineId: repeatedBefore.lineId });
      assert.ok(collapsedReveal.expanded && collapsedReveal.visible, 'directory navigation must expand a collapsed passage and reveal its selected line or heading');
      checks.push('滚远后重复点击同一目录项仍能定位；目标模块有可见标题时折叠后目录导航会展开并定位。');
    } else checks.push('源段落没有可见标题；新增标题模块的折叠目录导航由 module-editor 验收覆盖。');
  }
  await position(); await measure('expanded-first-scroll', () => wheel(), { scrolling: true });
  if (process.argv.includes('--trace-first')) {
    const done = new Promise<void>(resolve => cdp.once('Tracing.tracingComplete', () => resolve()));
    await cdp.send('Tracing.end'); await done;
    await fs.writeFile(path.join(output, 'first-scroll-trace.json'), JSON.stringify({ traceEvents: firstTrace }));
    metrics.firstSelectionFontDecodes = firstTrace.filter(event => event.name === 'DecodeFont').map(event => event.dur / 1000);
    if (!baseline) assert.deepEqual(metrics.firstSelectionFontDecodes, [], 'dialogue UI fonts must be prepared before the first selection');
    console.log('first scroll longest browser work', firstTrace.filter(event => event.ph === 'X' && event.dur > 50000 && !['RunTask', 'ThreadControllerImpl::RunTask'].includes(event.name)).sort((a, b) => b.dur - a.dur).slice(0, 15).map(event => ({ name: event.name, ms: event.dur / 1000, args: event.args })));
  }
  await position(); await measure('expanded-settled', () => wheel(), { scrolling: true });
  const extraLines = [2, 4, 6, 8, 10].flatMap(index => lines[index] && lines[index].id !== measuredLine.id ? [lines[index]] : []);
  for (const item of lines) {
    if (extraLines.length >= Math.min(5, lines.length - 1)) break;
    if (item.id !== measuredLine.id && !extraLines.some(line => line.id === item.id)) extraLines.push(item);
  }
  for (const item of extraLines) {
    const extraArrow = page.locator(`#line-${item.id} .line-expand`);
    await bringIntoScriptViewport(extraArrow);
    await clickAt(extraArrow);
  }
  await position(); await measure('six-expanded', () => wheel(), { scrolling: true });
  await position();
  const retainedLine = lines[0], retainedRow = page.locator(`#line-${retainedLine.id}`), retainedInput = retainedRow.locator('textarea');
  await bringIntoScriptViewport(retainedInput);
  await clickAt(retainedInput);
  const retainedArrow = retainedRow.locator('.line-expand');
  await bringIntoScriptViewport(retainedArrow);
  if (await retainedArrow.getAttribute('aria-expanded') !== 'true') await clickAt(retainedArrow);
  const retainedScale = retainedRow.getByLabel('大小 %', { exact: true });
  await retainedScale.fill('125'); await retainedScale.press('Tab');
  const retainedHeightBefore = await retainedRow.evaluate(element => element.getBoundingClientRect().height);
  let retention: Record<string, unknown> = {};
  await measure('expanded-row-scroll-return', async () => {
    const farInput = page.locator(`#line-${lines.at(-1)!.id} textarea`);
    await bringIntoScriptViewport(farInput);
    await clickAt(farInput);
    const offscreen = await page.evaluate(id => {
      const viewport = document.querySelector<HTMLElement>('.script-scroll')!, row = document.getElementById('line-' + id)!;
      return { height: row.getBoundingClientRect().height, selected: row.classList.contains('selected'), expanded: row.classList.contains('text-expanded'), scrollTop: viewport.scrollTop };
    }, retainedLine.id);
    assert.ok(!offscreen.selected && offscreen.expanded, 'the distant selection must leave the retained row unselected but expanded');
    await position(0);
    await bringIntoScriptViewport(retainedInput);
    await clickAt(retainedInput);
    retention = await page.evaluate(id => {
      const viewport = document.querySelector<HTMLElement>('.script-scroll')!, row = document.getElementById('line-' + id)!, input = row.querySelector<HTMLInputElement | HTMLTextAreaElement>('[aria-label="大小 %"]');
      return { height: row.getBoundingClientRect().height, selected: row.classList.contains('selected'), expanded: row.classList.contains('text-expanded'), scale: input?.value, scrollTop: viewport.scrollTop };
    }, retainedLine.id);
  }, { targetLineId: retainedLine.id });
  metrics['expanded-row-scroll-return'].retention = { beforeHeight: retainedHeightBefore, ...retention };
  assert.ok(retention.selected && retention.expanded && retention.scale === '125' && Math.abs(Number(retention.height) - retainedHeightBefore) <= Math.max(8, retainedHeightBefore * .05), JSON.stringify({ retainedHeightBefore, retention }));
  if (!baseline) assert.equal(metrics['expanded-row-scroll-return'].scrollIntoView.count, 0, 'local selection and return must not force app scrollIntoView');
  checks.push('首句展开后切选远处对白再滚回，选中状态、字号和展开高度保留，没有大幅收缩空白。');
  const originalRowCount = await page.locator(`#node-${passage.id} .story-line`).count();
  const addLineButton = page.locator(`#node-${passage.id} .add-line`);
  await bringIntoScriptViewport(addLineButton);
  await measure('new-row-position', () => clickAt(addLineButton), { settleMs: 220 });
  const addedRow = await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('.script-scroll')!, row = viewport.querySelector<HTMLElement>('.story-line.selected');
    if (!row) return undefined;
    const bounds = viewport.getBoundingClientRect(), rect = row.getBoundingClientRect();
    return { id: row.id.slice(5), visible: rect.bottom > bounds.top && rect.top < bounds.bottom };
  });
  assert.equal(await page.locator(`#node-${passage.id} .story-line`).count(), originalRowCount + 1);
  assert.ok(addedRow?.visible && metrics['new-row-position'].scrollIntoView.count > 0, 'a newly added row must be scrolled into view by the application');
  await clickAt(page.getByRole('button', { name: '撤销', exact: true }).first());
  assert.equal(await page.locator(`#node-${passage.id} .story-line`).count(), originalRowCount);
  checks.push('添加新对白后由应用定位到新行，并可撤销恢复原行数。');
  await saveScreenshot('expanded-scroll.png');
  if (diagnose) {
    const variants = {
      'scroll-contained': '.text-source-panel .script-scroll { contain: strict; }',
      'workspace-contained': '.text-source-panel .script-workspace { contain: strict; }',
      'list-contained': '.text-source-panel .story-lines { contain: layout style; }',
      'scroll-and-expanded-contained': '.text-source-panel .script-scroll { contain: strict; }.text-source-panel .story-line.text-expanded { content-visibility: auto !important; }',
    };
    for (const [name, content] of Object.entries(variants)) {
      const style = await page.addStyleTag({ content });
      await position(); await measure(name, () => wheel(), { scrolling: true });
      await style.evaluate(element => element.parentNode?.removeChild(element));
    }
  }
  await row.locator('.line-text-effects').getByRole('tab', { name: '播放速度', exact: true }).click();
  await row.getByLabel('显示方式', { exact: true }).selectOption('duration');
  const duration = row.getByLabel('整句时长（秒）', { exact: true });
  await duration.fill('12'); await duration.press('Tab');
  await row.getByRole('tab', { name: '文字动画', exact: true }).click();
  await row.getByLabel('入场效果', { exact: true }).selectOption('drop');
  await row.getByLabel('持续效果', { exact: true }).selectOption('wave');
  const preview = row.locator('.text-look-sample'), replay = preview.getByRole('button', { name: '重播', exact: true });
  const showPreview = async () => {
    await bringIntoScriptViewport(preview);
    const top = await scroll.evaluate(element => element.scrollTop);
    await position(top);
  };
  await showPreview(); await replay.click(); await showPreview();
  await measure('animated-scroll', () => wheel(), { scrolling: true });
  await replay.click(); await position(10000);
  await measure('offscreen-preview', () => page.waitForTimeout(1500));
  await showPreview();
  await measure('returned-preview', () => page.waitForTimeout(1000));
  if (!baseline) {
    assert.equal(metrics['offscreen-preview'].previewStyleMutations, 0, 'hidden sample must stop updating character styles');
    assert.ok(metrics['returned-preview'].previewStyleMutations > 0, 'visible sample must continue its reveal');
    await expect(preview).toHaveAttribute('data-preview-active', 'true');
    const rowTop = await row.evaluate(element => {
      const viewport = element.closest('.script-scroll')!;
      return viewport.scrollTop + element.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 12;
    });
    await position(rowTop);
    const pinAt = await preview.evaluate(element => {
      const viewport = element.closest('.script-scroll')!;
      return element.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop + 24;
    });
    await position(pinAt);
    await expect(preview).toHaveAttribute('data-preview-active', 'true');
    const pinned = await preview.evaluate(element => {
      const ancestors = [];
      for (let current: HTMLElement | null = element as HTMLElement; current; current = current.parentElement) {
        const style = getComputedStyle(current), rect = current.getBoundingClientRect();
        ancestors.push({ name: current.className, top: rect.top, bottom: rect.bottom, height: rect.height, position: style.position, inset: style.top, overflowX: style.overflowX, overflowY: style.overflowY, contain: style.contain, contentVisibility: style.contentVisibility });
        if (current.matches('.script-scroll')) break;
      }
      return { top: element.getBoundingClientRect().top, viewport: element.closest('.script-scroll')!.getBoundingClientRect().top, ancestors };
    });
    metrics.stickyPreview = pinned;
    assert.ok(Math.abs(pinned.top - pinned.viewport) < 16, JSON.stringify(pinned));
    await position(10000);
    await expect(preview).toHaveAttribute('data-preview-active', 'false');
    assert.equal(await preview.locator('.styled-char-loop').first().evaluate(element => getComputedStyle(element).animationPlayState), 'paused');
    await showPreview();
    await expect(preview).toHaveAttribute('data-preview-active', 'true');
    assert.equal(await preview.locator('.styled-char-loop').first().evaluate(element => getComputedStyle(element).animationPlayState), 'running');
    checks.push('滚出视野后小预览停止逐帧修改文字并暂停持续动画，滚回后恢复；固定在设置上方时继续播放，展开面板与设置保留。');
    for (const name of ['collapsed-warm', 'expanded-settled', 'six-expanded']) {
      const totals = metrics[name].totals;
      assert.ok(totals.LayoutDuration * 1000 / Math.max(1, totals.LayoutCount) < 5, name + ' average layout must remain below 5 ms');
    }
    const menuButton = row.locator('.add-line-effect');
    await menuButton.click();
    const menu = row.getByRole('menu', { name: '添加本行演出', exact: true });
    await expect(menu).toBeVisible();
    const menuItem = menu.getByRole('menuitem', { name: '显示文字', exact: true });
    await menuItem.hover();
    assert.ok(await menuItem.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); }), 'stage menu must be reachable through the scrolling viewport');
    await menuButton.click();
    const input = row.locator('.dialogue-input');
    await input.click(); await input.press('Control+Home');
    await input.press('Shift+ArrowRight'); await input.press('Shift+ArrowRight');
    await expect(row.getByRole('toolbar', { name: '选中文字效果', exact: true })).toBeVisible();
    await position(10000); await input.scrollIntoViewIfNeeded();
    await expect(row.getByRole('toolbar', { name: '选中文字效果', exact: true })).toBeVisible();
    checks.push('滚动往返后，上方舞台菜单可命中操作，台词选字工具条与展开状态保留。');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1180, 860));
    await position();
    const bounds = await scroll.evaluate(element => ({ height: element.clientHeight, width: element.clientWidth, content: element.scrollHeight, horizontal: element.scrollWidth }));
    assert.ok(bounds.height > 300 && bounds.content > bounds.height * 10 && bounds.horizontal <= bounds.width + 1, JSON.stringify(bounds));
    await saveScreenshot('narrow-scroll.png');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 960));
    await row.getByRole('tab', { name: '播放速度', exact: true }).click();
    await expect(duration).toHaveValue('12');
    await duration.fill('8'); await duration.press('Tab');
    await page.getByRole('button', { name: '撤销', exact: true }).first().click(); await expect(duration).toHaveValue('12');
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await expect(page.locator('.dirty-dot')).toHaveCount(0);
    const saved: Project = JSON.parse(await fs.readFile(projectFile, 'utf8'));
    const savedPassage = saved.nodes.find(node => node.id === passage.id);
    assert.ok(savedPassage?.kind === 'passage');
    assert.deepEqual(savedPassage.lines.map(line => ({ id: line.id, text: line.text, actions: line.actions })), passage.lines.map(line => ({ id: line.id, text: line.text, actions: line.actions })));
    assert.equal(savedPassage.lines.find(line => line.id === measuredLine.id)?.textPresentation?.duration, 12);
    checks.push('窄窗口滚动区保持正确尺寸；滚动后仍能编辑数值、撤销和保存，台词文字、编号、顺序与舞台动作不变。');
    await duration.fill('0.6'); await duration.press('Tab');
    await replay.click(); await page.waitForTimeout(1500);
    const complete = () => preview.locator('.styled-char').evaluateAll(elements => elements.every(element => (element as HTMLElement).style.opacity === '1'));
    assert.ok(await complete());
    await position(10000); await showPreview();
    assert.ok(await complete(), 'completed previews must not restart when scrolled back into view');
    await preview.evaluate(element => {
      const state = window as any; state.completedSampleMutations = 0;
      state.completedSampleObserver = new MutationObserver(records => { state.completedSampleMutations += records.length; });
      state.completedSampleObserver.observe(element, { subtree: true, attributes: true, attributeFilter: ['style'] });
    });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => { (window as any).completedSampleObserver.disconnect(); return (window as any).completedSampleMutations; }), 0);
    checks.push('播放完成的小预览滚回后保持完整文字，不会反复重播或继续更新文字样式。');
    const sceneEntry = page.locator('.story-directory .scene-row.active > button').first();
    await bringIntoDirectoryViewport(sceneEntry);
    await clickAt(sceneEntry);
    await page.waitForTimeout(220);
    await scroll.evaluate(viewport => { viewport.scrollTop = viewport.scrollHeight; });
    await measure('scene-directory-repeat', () => clickAt(sceneEntry), { settleMs: 220 });
    const sceneDestination = await interactionState();
    const sceneVisible = await page.evaluate(({ nodeId, lineId }) => {
      const viewport = document.querySelector<HTMLElement>('.script-scroll')!, section = document.getElementById('node-' + nodeId);
      const target = (lineId ? document.getElementById('line-' + lineId) : undefined) ?? section?.querySelector('.passage-heading-row') ?? section;
      const bounds = viewport.getBoundingClientRect(), rect = target?.getBoundingClientRect();
      return !!rect && rect.bottom > bounds.top && rect.top < bounds.bottom;
    }, sceneDestination);
    assert.ok(sceneVisible && metrics['scene-directory-repeat'].scrollIntoView.count > 0, 'scene navigation must reveal its first module even when its silent line has no dialogue row');
    await bringIntoScriptViewport(row.locator('textarea'));
    await clickAt(row.locator('textarea'));
    checks.push('重复点击小章节会定位首个模块；仅演出模块没有对白行时仍能定位到模块标题。');
  }
  if (process.argv.includes('--trace')) {
    const chunks: unknown[] = [];
    cdp.on('Tracing.dataCollected', event => chunks.push(...event.value));
    await position();
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' });
    await wheel(20);
    const done = new Promise<void>(resolve => cdp.once('Tracing.tracingComplete', () => resolve()));
    await cdp.send('Tracing.end'); await done;
    await fs.writeFile(path.join(output, 'scroll-trace.json'), JSON.stringify({ traceEvents: chunks }));
  }
  await page.evaluate(() => { (window as any).scrollSample.active = false; (window as any).scrollObserver.disconnect(); (window as any).sampleMutations.disconnect(); });
  for (const [name, result] of Object.entries(metrics)) if (result.scrolling) assert.ok(result.scrolls.length > 20, name + ' must actually scroll the module list');
  assert.equal(hash(await fs.readFile(original)), originalHash);
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: baseline ? 'baseline' : 'passed', appRoot, sdkRoot, ownedTemporaryPaths, screenshots, metrics, checks, errors }, null, 2));
} catch (error) {
  await saveScreenshot('failure.png').catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, appRoot, sdkRoot, ownedTemporaryPaths, screenshots, metrics, checks, errors, error: String(error) }, null, 2));
  throw error;
} finally {
  await page.evaluate(() => {
    const state = window as any;
    state.restoreModuleScrollIntoView?.();
    if (state.scrollSample) state.scrollSample.active = false;
    state.scrollObserver?.disconnect(); state.sampleMutations?.disconnect(); state.completedSampleObserver?.disconnect();
  }).catch(() => undefined);
  await app.close();
  const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']);
  assert.deepEqual(cleanup.errors, []);
  console.log(output);
}
