import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, type Locator } from '@playwright/test';
import { PNG } from 'pngjs';
import { assetFiles, type Project } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { currentScriptText } from '../src/core/script-text';
import { assetSourcePath } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

const root = path.resolve('.');
const argument = (name: string) => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
const original = path.resolve(root, argument('--source') ?? 'resources/templates/aihong/project.vns.json');
const appRoot = path.resolve(root, argument('--app-root') ?? root);
const sdkRoot = path.join(root, 'resources/runtime');
const baseline = process.argv.includes('--baseline');
const linesArgument = argument('--lines');
const requestedLines = linesArgument === undefined ? 0 : Number(linesArgument);
assert.ok(Number.isSafeInteger(requestedLines) && requestedLines >= 0, '--lines must be a non-negative integer.');
const bytes = await fs.readFile(original);
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const originalHash = hash(bytes);
const project: Project = JSON.parse(bytes.toString('utf8'));
const passage = project.nodes.filter(node => node.kind === 'passage').sort((a, b) => b.lines.length - a.lines.length)[0];
assert.ok(passage?.kind === 'passage');
if (requestedLines) {
  const sourceLines = passage.lines.filter(line => !line.silent);
  assert.ok(sourceLines.length, 'the source must contain a dialogue line to scale the fixture.');
  passage.lines = Array.from({ length: requestedLines }, (_, index) => ({ ...structuredClone(sourceLines[index % sourceLines.length]), id: 'profile_line_' + index }));
}
for (const asset of project.assets) {
  asset.externalFiles = Object.fromEntries(assetFiles(asset).map(relative => [relative, assetSourcePath(path.dirname(original), asset, relative)]));
  asset.externalPath = asset.externalFiles[asset.path];
}
project.playerDefaults = { ...project.playerDefaults, masterVolume: 0 };
// Keep the copied fixture in module mode even if the source file has a text draft.
project.scriptText = currentScriptText(projectToText(project), project.scriptText?.sourceName);
const output = path.resolve(argument('--artifact-root') ?? 'artifacts/module-editor-performance', new Date().toISOString().replaceAll(':', '-') + (baseline ? '-baseline' : ''));
const ownedTemporaryPaths = ['project', 'profile'].map(name => path.join(output, name));
const screenshots: { originalPath: string; thumbnailPath?: string; width: number; height: number }[] = [];
const projectFile = path.join(output, 'project/project.vns.json');
await fs.mkdir(path.dirname(projectFile), { recursive: true });
await fs.writeFile(projectFile, JSON.stringify(project));
const app = await launchDesktopFixture({ root: appRoot, sdkRoot, projectFile, profile: path.join(output, 'profile') });
const page = await app.firstWindow();
const errors: string[] = [], checks: string[] = [];
const metrics: Record<string, unknown> = {};
page.on('pageerror', error => errors.push(error.message));
let phase = 'launch';
const summarize = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, medianMs: sorted[Math.floor(sorted.length / 2)] ?? 0, p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] ?? 0, maxMs: sorted.at(-1) ?? 0 };
};
const saveScreenshot = async (name: string) => {
  const originalPath = path.join(output, name);
  const bytes = await page.screenshot({ path: originalPath });
  const image = PNG.sync.read(bytes);
  const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
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
const stopSampling = () => page.evaluate(() => {
  const state = window as any;
  state.restoreModuleScrollIntoView?.();
  if (state.moduleSample) state.moduleSample.active = false;
  state.moduleObserver?.disconnect();
});
const clickAt = async (locator: Locator) => {
  const point = await locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2, hit = document.elementFromPoint(x, y);
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
const targetVisibility = (lineId: string) => page.evaluate(lineId => {
  const viewport = document.querySelector<HTMLElement>('.script-scroll'), target = document.getElementById('line-' + lineId);
  if (!viewport || !target) return false;
  const bounds = viewport.getBoundingClientRect(), rect = target.getBoundingClientRect();
  return rect.bottom > bounds.top && rect.top < bounds.bottom;
}, lineId);
const moduleHeadingVisibility = (nodeId: string) => page.evaluate(nodeId => {
  const viewport = document.querySelector<HTMLElement>('.script-scroll'), heading = document.querySelector<HTMLElement>('#node-' + nodeId + ' .passage-heading-row');
  if (!viewport || !heading) return false;
  const bounds = viewport.getBoundingClientRect(), rect = heading.getBoundingClientRect();
  return rect.bottom > bounds.top && rect.top < bounds.bottom;
}, nodeId);
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 60000 });
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.webContents.setBackgroundThrottling(false); window.setContentSize(1440, 960); window.show(); window.focus(); });
  await openStoryMode(page, 'script');
  const scene = project.scenes.find(scene => scene.id === passage.sceneId)!;
  if (!await page.locator(`#node-${passage.id}`).count()) {
    const sceneEntry = page.locator('.story-directory').getByText(scene.name, { exact: true }).first();
    await bringIntoDirectoryViewport(sceneEntry);
    await clickAt(sceneEntry);
  }
  const showUnnamed = page.locator('.story-directory button[title="显示未命名的对白和演出"]');
  if (await showUnnamed.count() && await showUnnamed.getAttribute('aria-pressed') !== 'true') await clickAt(showUnnamed);
  const visibleLines = passage.lines.filter(line => !line.silent);
  assert.ok(visibleLines.length, 'the source must contain a dialogue line');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(400);
  await bringIntoScriptViewport(page.locator(`#line-${visibleLines[0].id} textarea`));
  const initiallySelected = await page.locator('.script-scroll .story-line.selected').evaluateAll(rows => rows[0]?.id.slice(5));
  const initiallyVisibleIds = await page.locator('.script-scroll').evaluate(viewport => {
    const bounds = viewport.getBoundingClientRect();
    return Array.from(viewport.querySelectorAll<HTMLElement>('.story-line'))
      .filter(row => { const rect = row.getBoundingClientRect(); return rect.bottom > bounds.top && rect.top < bounds.bottom; })
      .map(row => row.id.slice(5));
  });
  const localSelection = visibleLines.find(item => item.id !== initiallySelected && initiallyVisibleIds.includes(item.id));
  const line = localSelection ?? [...visibleLines].reverse().find(item => item.id !== initiallySelected) ?? visibleLines.at(-1)!;
  if (visibleLines.length > 1) assert.ok(localSelection, 'the fixture must expose another dialogue row for local selection');
  const input = page.locator(`#line-${line.id} textarea`);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(400);
  metrics.fixture = { source: original, originalHash, appRoot, sdkRoot, requestedLines: requestedLines || undefined,
    sceneLines: project.nodes.filter(node => node.sceneId === passage.sceneId).reduce((n, node) => n + (node.kind === 'passage' ? node.lines.length : 0), 0),
    assets: project.assets.length, characters: project.characters.length, domNodes: await page.locator('*').count() };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable'); await cdp.send('Profiler.enable');
  await page.evaluate(`(() => {
    const state = window;
    state.moduleSample = { phase: '', events: [], longTasks: [], gaps: [], scrollIntoView: [], active: true, last: performance.now() };
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    const nativeScrollIntoView = descriptor.value;
    Object.defineProperty(Element.prototype, 'scrollIntoView', { ...descriptor, value: function measuredScrollIntoView(...args) {
      const sample = state.moduleSample;
      if (!sample.active || !sample.phase) return Reflect.apply(nativeScrollIntoView, this, args);
      const phase = sample.phase, start = performance.now();
      try { return Reflect.apply(nativeScrollIntoView, this, args); }
      finally { sample.scrollIntoView.push({ phase, start, duration: performance.now() - start, elementId: this.id, tagName: this.tagName, lineElementId: this.closest('.story-line')?.id }); }
    } });
    state.restoreModuleScrollIntoView = () => {
      Object.defineProperty(Element.prototype, 'scrollIntoView', descriptor);
      delete state.restoreModuleScrollIntoView;
    };
    document.addEventListener('input', event => {
      if (!(event.target instanceof Element) || !event.target.closest('.script-workspace')) return;
      const sample = state.moduleSample, phase = sample.phase, start = performance.now();
      requestAnimationFrame(() => sample.events.push({ phase, frame: performance.now() - start }));
    }, true);
    state.moduleObserver = new PerformanceObserver(list => state.moduleSample.longTasks.push(...list.getEntries().map(entry => ({ phase: state.moduleSample.phase, start: entry.startTime, duration: entry.duration }))));
    state.moduleObserver.observe({ type: 'longtask', buffered: false });
    const tick = (now) => {
      const sample = state.moduleSample;
      if (!sample.active) return;
      if (now - sample.last > 50) sample.gaps.push({ phase: sample.phase, start: sample.last, duration: now - sample.last });
      sample.last = now; requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })()`);
  const interactionState = (targetLineId?: string) => page.evaluate(targetLineId => {
    const viewport = document.querySelector('.script-scroll');
    const selected = viewport?.querySelector('.story-line.selected');
    const target = targetLineId ? document.getElementById('line-' + targetLineId) : undefined;
    return { nodeId: viewport?.querySelector('.passage-section.active')?.id.slice(5), lineId: selected?.id.slice(5), scrollTop: viewport?.scrollTop,
      targetLineId, targetSelected: target?.classList.contains('selected'), targetExpanded: target?.classList.contains('text-expanded') };
  }, targetLineId);
  const measure = async (name: string, action: () => Promise<void>, targetLineId?: string) => {
    phase = name;
    const beforeState = await interactionState(targetLineId);
    await cdp.send('Profiler.start');
    const before = (await cdp.send('Performance.getMetrics')).metrics;
    await page.evaluate(name => { (window as any).moduleSample.phase = name; (window as any).moduleSample.last = performance.now(); }, name);
    const start = performance.now();
    await action();
    const wallMs = performance.now() - start;
    await page.waitForTimeout(220);
    const after = (await cdp.send('Performance.getMetrics')).metrics;
    const { profile } = await cdp.send('Profiler.stop');
    await fs.writeFile(path.join(output, name + '.cpuprofile'), JSON.stringify(profile));
    const own = new Map<number, number>();
    profile.samples?.forEach((id, index) => own.set(id, (own.get(id) ?? 0) + (profile.timeDeltas?.[index] ?? 0)));
    const top = profile.nodes.map(node => ({ name: node.callFrame.functionName, url: node.callFrame.url, line: node.callFrame.lineNumber, column: node.callFrame.columnNumber, ms: (own.get(node.id) ?? 0) / 1000 })).sort((a, b) => b.ms - a.ms).slice(0, 30);
    const sample = await page.evaluate(() => { const result = (window as any).moduleSample; result.phase = ''; return result; });
    const afterState = await interactionState(targetLineId);
    const events = sample.events.filter((event: any) => event.phase === name).map((event: any) => event.frame);
    const scrollCalls = sample.scrollIntoView.filter((entry: any) => entry.phase === name);
    const totals = Object.fromEntries(after.filter(metric => /(?:Layout|RecalcStyle|Task|Script)(?:Count|Duration)$/.test(metric.name)).map(metric => [metric.name, metric.value - (before.find(item => item.name === metric.name)?.value ?? 0)]));
    metrics[name] = { wallMs, before: beforeState, after: afterState, selectionChanged: beforeState.nodeId !== afterState.nodeId || beforeState.lineId !== afterState.lineId,
      scrollIntoView: { count: scrollCalls.length, totalMs: scrollCalls.reduce((sum: number, entry: any) => sum + entry.duration, 0), calls: scrollCalls },
      totals, inputFrames: summarize(events), longTasks: sample.longTasks.filter((event: any) => event.phase === name), gaps: sample.gaps.filter((event: any) => event.phase === name), top };
    await fs.writeFile(path.join(output, 'samples.json'), JSON.stringify(sample));
    console.log(JSON.stringify({ phase: name, wallMs, inputFrames: summarize(events), longTasks: (metrics[name] as any).longTasks.map((task: any) => task.duration) }));
  };
  const timedClick = async (locator: Locator) => {
    await locator.evaluate(element => {
      if (element instanceof HTMLTextAreaElement && document.activeElement === element) return;
      element.addEventListener(element instanceof HTMLTextAreaElement ? 'focus' : 'click', event => { const sample = (window as any).moduleSample, phase = sample.phase, start = performance.now(); requestAnimationFrame(() => sample.events.push({ phase, event: event.type, elementId: element.id, lineElementId: element.closest('.story-line')?.id, start, frame: performance.now() - start })); }, { once: true, capture: true });
    });
    await clickAt(locator);
  };
  // Profile before the first textarea click. Expanding the selected row is a
  // separate sample so its cost cannot be mistaken for a selection change.
  await measure('first-selection', () => timedClick(input), line.id);
  if (visibleLines.length > 1) assert.equal((metrics['first-selection'] as { selectionChanged: boolean }).selectionChanged, true, 'the first selection sample must select another row');
  if (!baseline) assert.equal((metrics['first-selection'] as any).scrollIntoView.count, 0, 'a local pointer selection must not call scrollIntoView');
  const selectedAfterFirst = await interactionState(line.id);
  assert.equal(selectedAfterFirst.lineId, line.id);
  assert.equal(selectedAfterFirst.targetSelected, true);
  const arrow = page.locator(`#line-${line.id} .line-expand`);
  await expect(arrow).toHaveAttribute('aria-expanded', 'false');
  await measure('first-expansion', () => timedClick(arrow), line.id);
  assert.equal((metrics['first-expansion'] as { selectionChanged: boolean }).selectionChanged, false, 'first expansion must be independent of changing the selected row');
  if (!baseline) assert.equal((metrics['first-expansion'] as any).scrollIntoView.count, 0, 'expanding an already selected row must not call scrollIntoView');
  await expect(arrow).toHaveAttribute('aria-expanded', 'true');
  await clickAt(arrow);
  await expect(arrow).toHaveAttribute('aria-expanded', 'false');
  await clickAt(input);
  checks.push('首轮选行与已选中行的首次展开分别记录，报告包含前后选中对象、滚动位置及原生自动定位调用；单行工程会明确记录选择未改变。');
  await input.press('Control+Home'); await input.press('Shift+ArrowRight'); await input.press('Shift+ArrowRight');
  await expect(page.getByRole('toolbar', { name: '选中文字效果', exact: true })).toBeVisible();
  await expect(arrow).toHaveAttribute('aria-expanded', 'true');
  const tabFocus: string[] = [];
  for (let index = 0; index < 3; index++) {
    await page.keyboard.press('Tab');
    tabFocus.push(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest('.story-line')?.id ?? 'outside-row'));
  }
  assert.deepEqual(tabFocus, Array(3).fill('line-' + line.id), 'repeated Tab must keep focus within the selected row controls');
  await expect(page.getByRole('toolbar', { name: '选中文字效果', exact: true })).toBeVisible();
  await clickAt(input); await clickAt(arrow);
  await expect(arrow).toHaveAttribute('aria-expanded', 'false');
  checks.push('真实输入后可选中文字；连续 Tab 聚焦本行控件，文字工具条和展开状态保持。');
  const chineseInput = '你好，模块编辑。';
  await measure('typing', async () => {
    await input.press('Control+End'); await input.pressSequentially('abcdefghijkl', { delay: 40 });
    await page.keyboard.insertText(chineseInput);
  });
  const editedText = line.text + 'abcdefghijkl' + chineseInput;
  await expect(input).toHaveValue(editedText);
  await measure('idle', async () => { await page.waitForTimeout(6500); });
  const selectionTargets = [visibleLines[0], visibleLines[Math.floor(visibleLines.length / 2)], visibleLines.at(-1)!, visibleLines[0], visibleLines.at(-1)!];
  for (let index = 0; index < selectionTargets.length; index++) {
    const target = selectionTargets[index], targetInput = page.locator(`#line-${target.id} textarea`);
    await bringIntoScriptViewport(targetInput);
    await measure('selection-' + (index + 1), () => timedClick(targetInput), target.id);
  }
  const selectionPhases = selectionTargets.map((_, index) => metrics['selection-' + (index + 1)] as any);
  const selectionSummary = { phases: selectionPhases, scrollIntoViewCount: selectionPhases.reduce((sum, sample) => sum + sample.scrollIntoView.count, 0), inputFrames: {
    count: selectionPhases.reduce((sum, sample) => sum + sample.inputFrames.count, 0),
    maxPhaseP95Ms: Math.max(0, ...selectionPhases.map(sample => sample.inputFrames.p95Ms)),
  } };
  metrics.selection = selectionSummary;
  metrics.measurementScope = '目标行的测试定位发生在交互计时窗口外；每次选择采样仅点击已定位目标并记录 focus 至下一帧。';
  if (!baseline) assert.equal(selectionSummary.scrollIntoViewCount, 0, 'local row selection must not call app scrollIntoView after the test prepositions each target');
  await bringIntoScriptViewport(arrow);
  await measure('expansion', async () => {
    for (let i = 0; i < 6; i++) await timedClick(arrow);
  });
  await clickAt(arrow);
  const scale = page.locator(`#line-${line.id}`).getByLabel('大小 %', { exact: true });
  await expect(scale).toBeVisible();
  const sizePercentBeforeParameter = Number(await scale.inputValue());
  const fontSizeBeforeParameter = await page.locator('.ui-dialogue-preview .styled-text').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  await measure('parameters', async () => {
    for (const value of ['105', '110', '115', '120', '125', '130']) { await scale.fill(value); await scale.press('Tab'); }
  });
  await expect(scale).toHaveValue('130');
  const fontSizeAfterParameter = await page.locator('.ui-dialogue-preview .styled-text').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  const renderedSizeRatio = fontSizeAfterParameter / fontSizeBeforeParameter;
  assert.ok(Math.abs(renderedSizeRatio - 130 / sizePercentBeforeParameter) < .04,
    `the dialogue preview must reflect the latest text look size; before=${fontSizeBeforeParameter}, after=${fontSizeAfterParameter}, ratio=${renderedSizeRatio}`);
  metrics.parameters = { ...(metrics.parameters as Record<string, unknown>), renderedFontSizeBeforePx: fontSizeBeforeParameter, renderedFontSizeAfterPx: fontSizeAfterParameter, renderedSizeRatio };
  await page.evaluate(() => { const viewport = document.querySelector<HTMLElement>('.script-scroll')!; viewport.scrollTop = viewport.scrollHeight; });
  const activeDirectory = page.locator('.story-directory .tree-node.active').first();
  assert.ok(await activeDirectory.count(), 'the selected passage must be reachable from the story directory');
  await bringIntoDirectoryViewport(activeDirectory);
  await clickAt(activeDirectory);
  await page.evaluate(() => { const viewport = document.querySelector<HTMLElement>('.script-scroll')!; viewport.scrollTop = viewport.scrollHeight; });
  const sameNodeBefore = await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('.script-scroll')!, selected = viewport.querySelector<HTMLElement>('.story-line.selected');
    return { nodeId: viewport.querySelector<HTMLElement>('.passage-section.active')?.id.slice(5), lineId: selected?.id.slice(5), scrollTop: viewport.scrollTop };
  });
  await bringIntoDirectoryViewport(activeDirectory);
  await measure('directory-repeat', () => clickAt(activeDirectory), sameNodeBefore.lineId);
  assert.equal((metrics['directory-repeat'] as any).selectionChanged, false, 'repeating the active directory entry preserves selection');
  if (!baseline) assert.ok((metrics['directory-repeat'] as any).scrollIntoView.count > 0, 'repeating an active directory entry must reveal its offscreen target');
  if (!baseline && sameNodeBefore.lineId) assert.ok(await targetVisibility(sameNodeBefore.lineId), 'repeating directory navigation must bring the selected line into view');
  if (!baseline) {
    const activeNodeId = sameNodeBefore.nodeId!;
    const activeSection = page.locator('#node-' + activeNodeId);
    const foldToggle = activeSection.locator('.module-fold-toggle');
    if (await foldToggle.count()) {
      await bringIntoScriptViewport(foldToggle);
      await clickAt(foldToggle);
      await page.evaluate(() => { const viewport = document.querySelector<HTMLElement>('.script-scroll')!; viewport.scrollTop = viewport.scrollHeight; });
      await bringIntoDirectoryViewport(activeDirectory);
      await measure('directory-repeat-collapsed', () => clickAt(activeDirectory), sameNodeBefore.lineId);
      assert.equal(await foldToggle.getAttribute('aria-expanded'), 'true', 'directory navigation must expand a collapsed passage');
      if (sameNodeBefore.lineId) assert.ok(await targetVisibility(sameNodeBefore.lineId), 'directory navigation to a collapsed passage must reveal its selected line');
      checks.push('滚远后再次点击同一目录项仍能定位；折叠目标的目录导航会展开并显示选中行。');
    } else {
      checks.push('源段落没有可见标题，因此跳过对它本身的折叠导航；另以新增标题模块验证折叠后目录展开与重复定位。');
    }
  }
  const retainedLine = visibleLines[0], retainedInput = page.locator(`#line-${retainedLine.id} textarea`), retainedRow = page.locator(`#line-${retainedLine.id}`);
  await page.evaluate(() => { const viewport = document.querySelector<HTMLElement>('.script-scroll')!; viewport.scrollTop = 0; });
  await bringIntoScriptViewport(retainedInput);
  await clickAt(retainedInput);
  const retainedArrow = retainedRow.locator('.line-expand');
  await bringIntoScriptViewport(retainedArrow);
  if (await retainedArrow.getAttribute('aria-expanded') !== 'true') await clickAt(retainedArrow);
  const retainedScale = retainedRow.getByLabel('大小 %', { exact: true });
  await retainedScale.fill('125'); await retainedScale.press('Tab');
  const heightBeforeScroll = await retainedRow.evaluate(element => element.getBoundingClientRect().height);
  await measure('expanded-row-scroll-return', async () => {
    const far = page.locator(`#line-${visibleLines.at(-1)!.id} textarea`);
    await bringIntoScriptViewport(far);
    await clickAt(far);
    const offscreen = await page.evaluate(id => {
      const viewport = document.querySelector<HTMLElement>('.script-scroll')!, row = document.getElementById('line-' + id)!;
      return { height: row.getBoundingClientRect().height, selected: row.classList.contains('selected'), expanded: row.classList.contains('text-expanded'), scrollTop: viewport.scrollTop };
    }, retainedLine.id);
    assert.ok(!offscreen.selected && offscreen.expanded, 'the distant selection must leave the retained row unselected but expanded');
    await page.evaluate(() => { const viewport = document.querySelector<HTMLElement>('.script-scroll')!; viewport.scrollTop = 0; });
    await bringIntoScriptViewport(retainedInput);
    await clickAt(retainedInput);
    const returned = await page.evaluate(id => {
      const viewport = document.querySelector<HTMLElement>('.script-scroll')!, row = document.getElementById('line-' + id)!, input = row.querySelector<HTMLInputElement | HTMLTextAreaElement>('[aria-label="大小 %"]');
      return { height: row.getBoundingClientRect().height, selected: row.classList.contains('selected'), expanded: row.classList.contains('text-expanded'), scale: input?.value, scrollTop: viewport.scrollTop };
    }, retainedLine.id);
    return void assert.ok(returned.selected && returned.expanded && returned.scale === '125' && Math.abs(returned.height - heightBeforeScroll) <= Math.max(8, heightBeforeScroll * .05), JSON.stringify({ heightBeforeScroll, offscreen, returned }));
  }, retainedLine.id);
  if (!baseline) assert.equal((metrics['expanded-row-scroll-return'] as any).scrollIntoView.count, 0, 'selecting a distant local row and returning to the retained row must not force app scrollIntoView');
  checks.push('首句展开后离开并滚回，选中状态、字号和展开高度保留，没有大幅收缩空白。');
  await saveScreenshot('module-editor.png');
  if (!baseline) {
    phase = 'gutter layout';
    const row = page.locator(`#line-${line.id}`);
    await bringIntoScriptViewport(arrow);
    if (await arrow.getAttribute('aria-expanded') !== 'true') await clickAt(arrow);
    await expect(arrow).toHaveAttribute('aria-expanded', 'true');
    const positionLayout = async () => {
      await row.evaluate(element => {
        const viewport = element.closest<HTMLElement>('.script-scroll')!;
        viewport.scrollTop += element.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 12;
      });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    await positionLayout();
    const layout = async () => {
      const number = (await row.locator('.line-number').boundingBox())!, toggle = (await arrow.boundingBox())!;
      const speaker = (await row.locator('.line-top > select').boundingBox())!, dialogue = (await input.boundingBox())!;
      const actions = (await row.locator('.line-actions').boundingBox())!, strip = (await row.locator('.line-effect-strip').boundingBox())!;
      const panel = (await row.locator('.line-text-effects').boundingBox())!;
      assert.ok(Math.abs(number.x + number.width / 2 - toggle.x - toggle.width / 2) < 1, 'line number and arrow must share the same column');
      assert.ok(number.y + number.height <= toggle.y && toggle.x + toggle.width <= speaker.x, 'the arrow must sit below the number, outside the dialogue columns');
      assert.ok(speaker.x + speaker.width <= dialogue.x && dialogue.x + dialogue.width <= actions.x, 'speaker, dialogue and actions must not overlap');
      assert.ok(strip.y + strip.height <= dialogue.y && panel.y >= dialogue.y + dialogue.height, 'stage actions stay above dialogue and text settings below it');
      return { number, toggle, speaker, dialogue, actions, strip, panel };
    };
    metrics.layout = { normal: await layout() };
    await saveScreenshot('module-editor-layout.png');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1180, 860));
    await positionLayout();
    await expect(arrow).toHaveAttribute('aria-expanded', 'true');
    (metrics.layout as Record<string, unknown>).narrow = await layout();
    await saveScreenshot('module-editor-narrow.png');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 960));
    checks.push('常规和窄窗口中，行号与箭头上下共用最左一列，台词、角色和操作按钮不重叠；舞台演出在上方，台词文字面板在下方。');
    if (!requestedLines) for (const name of ['typing', 'parameters'] as const) {
      const sample = metrics[name] as { inputFrames: ReturnType<typeof summarize> };
      assert.ok(sample.inputFrames.count >= 6, name + ' must deliver live input updates');
      assert.ok(sample.inputFrames.p95Ms < 100, name + ' p95 input-to-frame latency must stay below 100 ms');
    }
    phase = 'new module navigation';
    const scenePassageCount = await page.locator('.script-scroll .passage-section').count();
    const addModuleButton = page.getByRole('button', { name: '段落', exact: true });
    await expect(addModuleButton).toHaveCount(1);
    await clickAt(addModuleButton);
    const addedModuleId = await page.locator('.script-scroll .passage-section.active').evaluate(section => section.id.slice(5));
    assert.ok(!project.nodes.some(node => node.id === addedModuleId), 'the UI must create a distinct module for the navigation check');
    const addedSection = page.locator('#node-' + addedModuleId), addedFold = addedSection.locator('.module-fold-toggle');
    await expect(addedFold).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => moduleHeadingVisibility(addedModuleId), { message: 'the newly added module heading must be positioned in the viewport by the application' }).toBe(true);
    await clickAt(addedFold);
    await expect(addedFold).toHaveAttribute('aria-expanded', 'false');
    const moveAddedHeadingOffscreen = async () => {
      await page.evaluate(() => { const viewport = document.querySelector<HTMLElement>('.script-scroll')!; viewport.scrollTop = 0; });
      if (await moduleHeadingVisibility(addedModuleId)) await page.evaluate(() => { const viewport = document.querySelector<HTMLElement>('.script-scroll')!; viewport.scrollTop = viewport.scrollHeight; });
      assert.equal(await moduleHeadingVisibility(addedModuleId), false, 'the module heading must be outside the script viewport before directory navigation');
    };
    await moveAddedHeadingOffscreen();
    const addedDirectoryEntry = page.locator('.story-directory .tree-node.active');
    assert.ok(await addedDirectoryEntry.count(), 'the new titled module must have an active directory entry');
    await bringIntoDirectoryViewport(addedDirectoryEntry);
    await measure('new-module-collapsed-directory', () => clickAt(addedDirectoryEntry));
    await expect(addedFold).toHaveAttribute('aria-expanded', 'true');
    assert.ok(await moduleHeadingVisibility(addedModuleId), 'directory navigation must reveal the newly expanded module heading');
    assert.ok((metrics['new-module-collapsed-directory'] as any).scrollIntoView.count > 0, 'expanding an offscreen module from its directory must use application positioning');
    await moveAddedHeadingOffscreen();
    await bringIntoDirectoryViewport(addedDirectoryEntry);
    await measure('new-module-directory-repeat', () => clickAt(addedDirectoryEntry));
    assert.ok(await moduleHeadingVisibility(addedModuleId), 'repeating the same module directory entry must reveal its heading');
    assert.ok((metrics['new-module-directory-repeat'] as any).scrollIntoView.count > 0, 'repeating an offscreen module directory entry must use application positioning');
    await clickAt(page.getByRole('button', { name: '撤销', exact: true }).first());
    await expect(page.locator('.script-scroll .passage-section')).toHaveCount(scenePassageCount);
    assert.equal(await page.locator('#node-' + addedModuleId).count(), 0, 'undo must remove the temporary navigation module');
    checks.push('真实新增标题模块后由应用定位；折叠并滚远时目录导航会展开并定位，同一模块再次离屏后重复导航仍会定位；撤销恢复原节点数。');
    phase = 'undo and row actions';
    const undo = () => clickAt(page.getByRole('button', { name: '撤销', exact: true }).first());
    const redo = () => clickAt(page.getByRole('button', { name: '重做', exact: true }).first());
    await input.press('Control+End'); await input.pressSequentially('XYZ', { delay: 40 });
    await expect(input).toHaveValue(editedText + 'XYZ');
    await undo(); await expect(input).toHaveValue(editedText);
    await redo(); await expect(input).toHaveValue(editedText + 'XYZ');
    await undo(); await expect(input).toHaveValue(editedText);
    const rows = page.locator(`#node-${passage.id} .story-line`);
    const order = await rows.evaluateAll(rows => rows.map(row => row.id));
    const rowIndex = order.indexOf('line-' + line.id);
    if (rowIndex > 0) {
      const moveUp = row.getByRole('button', { name: '向上移动', exact: true });
      await bringIntoScriptViewport(moveUp);
      await clickAt(moveUp);
      const moved = await rows.evaluateAll(rows => rows.map(row => row.id));
      assert.equal(moved[rowIndex - 1], 'line-' + line.id);
      await undo(); assert.deepEqual(await rows.evaluateAll(rows => rows.map(row => row.id)), order);
    }
    const copyLine = row.getByRole('button', { name: '复制对白', exact: true });
    await bringIntoScriptViewport(copyLine);
    await clickAt(copyLine);
    await page.waitForFunction(({ nodeId, sourceLineId }) => {
      const selected = document.querySelector(`#node-${nodeId} .story-line.selected`);
      if (!selected || selected.id === 'line-' + sourceLineId) return false;
      const viewport = selected.closest('.script-scroll')!.getBoundingClientRect(), rect = selected.getBoundingClientRect();
      return rect.bottom > viewport.top && rect.top < viewport.bottom;
    }, { nodeId: passage.id, sourceLineId: line.id });
    const copiedPlacement = await page.evaluate(nodeId => {
      const viewport = document.querySelector<HTMLElement>('.script-scroll')!, selected = document.querySelector<HTMLElement>(`#node-${nodeId} .story-line.selected`);
      if (!selected) return undefined;
      const bounds = viewport.getBoundingClientRect(), rect = selected.getBoundingClientRect();
      return { id: selected.id.slice(5), visible: rect.bottom > bounds.top && rect.top < bounds.bottom };
    }, passage.id);
    assert.ok(copiedPlacement?.visible, 'copying a line must position the newly selected copy inside the script viewport before any locator can scroll it');
    await expect(rows).toHaveCount(order.length + 1);
    const copied = page.locator('#line-' + copiedPlacement!.id);
    await expect(copied.locator('textarea')).toHaveValue(editedText);
    const deleteCopy = copied.getByRole('button', { name: '删除对白', exact: true });
    await bringIntoScriptViewport(deleteCopy);
    await clickAt(deleteCopy);
    await expect(rows).toHaveCount(order.length);
    await undo(); await expect(rows).toHaveCount(order.length + 1);
    await undo(); await expect(rows).toHaveCount(order.length);
    await bringIntoScriptViewport(input);
    await clickAt(input);
    await expect(page.locator('.ui-dialogue-preview .styled-text').first()).toHaveText(editedText);
    const bounds = await input.evaluate(element => {
      const outer = element.closest('.script-scroll')!.getBoundingClientRect(), inner = element.getBoundingClientRect();
      return { outerTop: outer.top, outerBottom: outer.bottom, top: inner.top, bottom: inner.bottom };
    });
    assert.ok(bounds.bottom > bounds.outerTop && bounds.top < bounds.outerBottom, 'selected row must remain visible after scrolling and undo');
    checks.push('连续输入可撤销重做；台词移动、复制、删除及撤销不丢失文本，滚动到选中台词和预览同步正常。');
    phase = 'text round trip';
    await openStoryMode(page, 'text');
    const source = page.getByLabel('中文文本剧本', { exact: true });
    await expect(source).toHaveValue(new RegExp('你好，模块编辑。'));
    await openStoryMode(page, 'script');
    await expect(input).toHaveValue(editedText);
    phase = 'persist';
    await clickAt(page.getByRole('button', { name: '保存工程', exact: true }));
    await expect(page.locator('.dirty-dot')).toHaveCount(0);
    const saved: Project = JSON.parse(await fs.readFile(projectFile, 'utf8'));
    const savedNode = saved.nodes.find(node => node.id === passage.id);
    assert.ok(savedNode?.kind === 'passage');
    assert.equal(savedNode.lines.find(item => item.id === line.id)?.text, editedText);
    assert.deepEqual(savedNode.lines.map(line => line.id), passage.lines.map(line => line.id));
    assert.deepEqual(savedNode.lines.map(line => line.actions), passage.lines.map(line => line.actions));
    const reparsed = applyTextScript(saved, saved.scriptText!.content);
    assert.deepEqual(reparsed.issues, []);
    assert.equal(projectToText(reparsed.project), projectToText(saved));
    await stopSampling();
    await page.reload();
    await expect(page.locator('.project-title strong')).toHaveText(project.name);
    await openStoryMode(page, 'script');
    if (!await input.count()) await clickAt(page.locator('.story-directory').getByText(scene.name, { exact: true }).first());
    await bringIntoScriptViewport(input);
    await clickAt(input); await expect(input).toHaveValue(editedText);
    await expect(page.locator('.ui-dialogue-preview .styled-text').first()).toHaveText(editedText);
    checks.push('模块/文本往返、保存重开保留台词编号、顺序、演出和当前文字，文本可重新解析。');
  }
  await stopSampling();
  assert.equal(hash(await fs.readFile(original)), originalHash);
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: baseline ? 'baseline' : 'passed', appRoot, sdkRoot, ownedTemporaryPaths, screenshots, metrics, checks, errors }, null, 2));
} catch (error) {
  await saveScreenshot('failure.png').catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, appRoot, sdkRoot, ownedTemporaryPaths, screenshots, metrics, checks, errors, error: String(error) }, null, 2));
  throw error;
} finally {
  await stopSampling().catch(() => undefined);
  await app.close();
  const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']);
  assert.deepEqual(cleanup.errors, []);
  console.log(output);
}
