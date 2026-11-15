import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { createProject, projectSchema, type Project } from '../src/core/model';
import { blueprintFromPerformance, rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { compositionObject } from '../src/core/composition-timeline';
import { createVisualObject } from '../src/core/visual-object';
import { createAudioClip } from '../src/core/audio-clip';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { projectGraphs } from '../src/core/project-resources';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

const root = path.resolve('.');
const observe = process.argv.includes('--observe');
const output = path.join(root, 'artifacts/timeline-workflow-2026-11-14', (observe ? 'baseline-' : 'editor-') + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const directory = path.join(output, 'project');
const projectFile = path.join(directory, 'project.vns.json');
const project = createProject('时间轴操作审查');
const background = createVisualObject('image', 'review_background'); background.name = '山间背景'; background.duration = 12;
const title = createVisualObject('text'); title.name = '开场标题'; title.text = '第一回 · 山间来客'; title.duration = 5;
const subtitle = createVisualObject('text'); subtitle.name = '副标题'; subtitle.text = '一段新的故事'; subtitle.duration = 4;
const music = createAudioClip('review_music', '背景音乐', 12, 'music');
const video = createVisualObject('video', 'review_video'); video.name = '双色视频'; video.duration = 4; video.sourceDuration = 6; video.imageFit = 'contain';
const group = createVisualObject('group'); group.name = '双行组合'; group.duration = 6;
const childTitle = createVisualObject('text'); childTitle.name = '组合标题'; childTitle.text = '组合里的标题'; childTitle.duration = 5;
const childSubtitle = createVisualObject('text'); childSubtitle.name = '组合副标题'; childSubtitle.text = '组合里的副标题'; childSubtitle.startAt = 1; childSubtitle.duration = 4;
group.children = [childTitle, childSubtitle];
const report: Record<string, unknown> = { mode: observe ? 'existing-build-observation' : 'acceptance', status: 'running', output, errors: [], checks: [] };
let app: ElectronApplication | undefined, page: Page | undefined;
const ownedProcesses: ReturnType<ElectronApplication['process']>[] = [];
let tracing = false, traceIndex = 0, teardownTimedOut = false, phase = 'fixture';
const errors: string[] = [], checks: string[] = [];
const traces: string[] = [];
const waitOwnedProcesses = async () => {
  for (const ownedProcess of ownedProcesses) if (ownedProcess.exitCode === null && ownedProcess.signalCode === null) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await new Promise<void>(resolve => { const finish = () => { if (timer) clearTimeout(timer); ownedProcess.removeListener('exit', finish); resolve(); }; ownedProcess.once('exit', finish); timer = setTimeout(finish, 5000); });
  }
};
let graphId = '', titleId = '', subtitleId = '', audioId = '', videoId = '', groupId = '';
const closeTimeout = async <T>(promise: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => { teardownTimedOut = true; reject(new Error(label + ' timed out.')); }, 10000); })]);
  } finally { if (timer) clearTimeout(timer); }
};
const stopTrace = async () => {
  if (!tracing || !page) return;
  tracing = false;
  const file = `trace-${String(++traceIndex).padStart(2, '0')}.zip`;
  try { await page.context().tracing.stop({ path: path.join(output, file) }); traces.push(file); }
  catch (error) { report.traceError = String(error); process.exitCode = 1; }
};
const closeApp = async () => {
  // Stop tracing may fail; closing the owned app still runs in every case.
  await stopTrace();
  const owned = app; app = undefined;
  if (owned) {
    try { await closeTimeout(owned.close(), 'Fixture shutdown'); }
    catch (error) { report.closeError = String(error); process.exitCode = 1; }
  }
  await waitOwnedProcesses();
};
const launch = async () => {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
  ownedProcesses.push(app.process());
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.unmaximize(); window.setContentSize(1280, 840); });
  await page.evaluate('globalThis.__name = value => value');
  report.viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: devicePixelRatio }));
  await page.evaluate(() => {
    const records: unknown[] = []; (window as unknown as { timelineInputEvidence: unknown[] }).timelineInputEvidence = records;
    const identify = (element: EventTarget | null) => element instanceof Element ? { tag: element.tagName, className: element.getAttribute('class'), label: element.getAttribute('aria-label') } : undefined;
    for (const type of ['keydown', 'focusin', 'dblclick', 'blur', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) window.addEventListener(type, event => {
      if (event instanceof PointerEvent && !event.buttons && event.type === 'pointermove') return;
      const key = event instanceof KeyboardEvent ? { key: event.key, code: event.code, ctrl: event.ctrlKey, composing: event.isComposing } : {};
      const pointer = event instanceof PointerEvent ? { x: event.clientX, y: event.clientY, buttons: event.buttons, pointerId: event.pointerId, captured: event.target instanceof Element && event.target.hasPointerCapture(event.pointerId) } : {};
      records.push({ type, at: performance.now(), ...key, ...pointer, target: identify(event.target), active: identify(document.activeElement) });
      if (records.length > 300) records.shift();
    }, true);
  });
  if (!observe) { await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false }); tracing = true; }
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
};
const openTimeline = async () => {
  await page!.locator('[data-workspace-tab="assets"]').click();
  await page!.getByLabel('资源显示范围', { exact: true }).selectOption('all');
  await page!.getByLabel('搜索资源和蓝图', { exact: true }).fill('开场演出');
  await page!.locator('[data-content-key="timeline:' + graphId + '"]').dblclick();
  await expect(page!.getByLabel('时间轴画布', { exact: true })).toBeVisible();
};
const field = (name: string) => page!.getByLabel(name, { exact: true }).filter({ visible: true });
const clip = (id: string) => page!.locator('.timeline-clip[data-node-id="' + id + '"]');
const inspector = () => page!.locator('.timeline-inspector');
const canvas = () => field('时间轴画布');
const rootZoom = async () => Number(await canvas().getAttribute('data-zoom'));
const playbackControl = () => page!.locator('.performance-preview .line-preview-play');
const undo = async () => { await page!.getByRole('button', { name: '撤销', exact: true }).click(); };
const number = async (label: string, value: number) => { await field(label).fill(String(value)); await field(label).press('Tab'); };
const save = async () => {
  const button = page!.getByRole('button', { name: '保存工程', exact: true }); if (await button.isEnabled()) await button.click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  return projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
};
const visual = (saved: Project, nodeId: string, instanceId: string) => compositionObject(saved, projectGraphs(saved).find(item => item.id === graphId)!, nodeId, instanceId);
type ClipState = { id: string; at: number; duration: number; trackId: string };
const snapshot = () => page!.locator('.timeline-clip[data-node-id]').evaluateAll(elements => elements.map(element => ({
  id: (element as HTMLElement).dataset.nodeId!, at: Number((element as HTMLElement).dataset.start), duration: Number((element as HTMLElement).dataset.duration),
  trackId: (element.closest('.timeline-track') as HTMLElement).dataset.trackId!,
})).sort((a, b) => a.id.localeCompare(b.id)));
const sameState = async (state: ClipState[]) => { await expect.poll(snapshot).toEqual(state); };
const select = async (id: string) => {
  await clip(id).scrollIntoViewIfNeeded();
  await clip(id).click({ position: { x: 24, y: 13 } });
  // Clicking inside the existing selection keeps the group ready for dragging.
  // Establish a single selection explicitly before building a new one.
  const singleSelection = page!.getByRole('button', { name: '只选当前片段', exact: true });
  if (await singleSelection.isVisible()) {
    await singleSelection.click();
    await clip(id).focus();
  }
  await expect(clip(id)).toHaveAttribute('aria-pressed', 'true');
  await expect(page!.locator('.timeline-clip[aria-pressed="true"]')).toHaveCount(1);
};
const multiSelect = async (ids: string[]) => {
  await select(ids[0]);
  for (const id of ids.slice(1)) await clip(id).click({ position: { x: 24, y: 13 }, modifiers: ['Control'] });
  await expect(page!.locator('.timeline-clip[aria-pressed="true"]')).toHaveCount(ids.length);
};
const seek = async (at: number) => {
  await canvas().evaluate(element => { element.scrollLeft = 0; });
  const ruler = field('时间标尺'), box = await ruler.boundingBox(); assert.ok(box);
  await page!.mouse.click(box.x + 130 + at * await rootZoom(), box.y + box.height / 2);
  await expect.poll(async () => Number((await field('当前时间').innerText()).split(' ')[0])).toBeCloseTo(at, 2);
};
const gesture = async (item: Locator, delta: number, options: { edge?: 'left' | 'right'; rowDelta?: number; release?: boolean } = {}) => {
  const handle = options.edge ? item.locator('.timeline-resize-' + options.edge) : item;
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox(); assert.ok(box);
  const x = box.x + (options.edge ? box.width / 2 : Math.min(35, box.width / 2)), y = box.y + box.height / 2;
  await page!.mouse.move(x, y); await page!.mouse.down();
  await page!.mouse.move(x + delta * await rootZoom(), y + (options.rowDelta ?? 0) * 54, { steps: 6 });
  if (options.release !== false) await page!.mouse.up();
};
const shot = async (name: string) => {
  // Windows fractional scaling may return 1281 CSS px for a 1280 request.
  // Preserve the measured viewport and normalize the evidence image separately.
  const captured = await page!.screenshot({ type: 'png', scale: 'css' });
  const image = await app!.evaluate(({ nativeImage }, encoded) => {
    const source = nativeImage.createFromBuffer(Buffer.from(encoded, 'base64')), size = source.getSize();
    const ratio = Math.min(1, 1280 / Math.max(size.width, size.height));
    return source.resize({ width: Math.max(1, Math.floor(size.width * ratio)), height: Math.max(1, Math.floor(size.height * ratio)) }).toJPEG(68).toString('base64');
  }, captured.toString('base64'));
  await fs.writeFile(path.join(output, name + '.jpg'), Buffer.from(image, 'base64'));
};
try {
  await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
  const image = new PNG({ width: 320, height: 180 });
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const i = (y * image.width + x) * 4; image.data.set([30 + Math.round(x / 4), 70 + Math.round(y / 2), 115, 255], i);
  }
  await fs.writeFile(path.join(directory, 'assets/background.png'), PNG.sync.write(image));
  const sampleRate = 22050, samples = sampleRate * 12, audio = Buffer.alloc(44 + samples * 2);
  audio.write('RIFF'); audio.writeUInt32LE(36 + samples * 2, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(sampleRate, 24); audio.writeUInt32LE(sampleRate * 2, 28);
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(samples * 2, 40);
  await fs.writeFile(path.join(directory, 'assets/music.wav'), audio);
  project.assets = [
    { id: 'review_background', name: '山间背景', kind: 'image', path: 'assets/background.png', width: 320, height: 180 },
    { id: 'review_music', name: '背景音乐', kind: 'audio', category: 'bgm', path: 'assets/music.wav' },
  ];
  if (!observe) {
    // The bundled, authorized template font belongs to this fixture; no author project is read.
    await fs.copyFile(path.join(root, 'resources/templates/aihong/assets/ai_ui_37e66a53a43d9a54.otf'), path.join(directory, 'assets/reference.otf'));
    project.assets.push({ id: 'review_font', name: '验收字体 · 项目中带有较长名称的字体资源', kind: 'font', path: 'assets/reference.otf' });
    execFileSync(process.env.VNS_FFMPEG ?? 'ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=12:d=3', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=12:d=3', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-t', '6', '-c:v', 'libvpx', '-pix_fmt', 'yuv420p', '-an', path.join(directory, 'assets/clip.webm')], { windowsHide: true, timeout: 30000 });
    project.assets.push({ id: 'review_video', name: '双色视频', kind: 'video', path: 'assets/clip.webm' });
  }
  const timeline = blueprintFromPerformance(project, observe ? [title, subtitle, background, music] : [title, subtitle, background, music, video, group], '开场演出');
  timeline.timelineComponent = true; timeline.performanceKind = 'standalone'; project.blueprints = [timeline];
  const initial = performanceTimeline(project, timeline);
  const tracks = (observe ? ['标题', '副标题', '背景', '音乐'] : ['标题', '副标题', '背景', '音乐', '视频', '组合']).map((name, i) => ({ id: 'review_track_' + i, name }));
  arrangePerformanceTimeline(project, timeline, initial.clips.map((clip, i) => ({ ...clip, at: i === 1 ? 2 : 0, trackId: tracks[i].id })), tracks);
  await saveProject(projectFile, project);
  const saved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  const graph = projectGraphs(saved).find(item => item.name === timeline.name)!; graphId = graph.id;
  const nodeFor = (id: string) => graph.nodes.find(node => (rawSavedBlueprintAction(node) as { instanceId?: string } | undefined)?.instanceId === id)!.id;
  titleId = nodeFor(title.instanceId); subtitleId = nodeFor(subtitle.instanceId); audioId = nodeFor(music.instanceId);
  if (!observe) { videoId = nodeFor(video.instanceId); groupId = nodeFor(group.instanceId); }
  report.graphId = graphId;
  await fs.copyFile(projectFile, path.join(output, 'initial-project-evidence.vns.json'));
  await launch(); await openTimeline();
  await expect(page!.locator('.timeline-clip')).toHaveCount(observe ? 4 : 6);
  await shot('01-overview');
  report.layout = await page!.locator('.performance-dock-panel').evaluateAll(elements => elements.map(element => ({
    panel: (element as HTMLElement).dataset.dockPanel, rect: element.getBoundingClientRect().toJSON(),
    scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
  })));
  await select(titleId);
  await shot('02-text-basic');
  report.textBasic = await inspector().innerText();
  await inspector().getByRole('tab', { name: /动画/, exact: false }).click();
  await shot('03-text-animation');
  report.textAnimation = await inspector().innerText();
  await select(audioId);
  await shot('04-audio');
  report.audio = await inspector().innerText();
  report.compiledEntry = await page!.evaluate(() => [...document.scripts].map(script => script.src).filter(Boolean));
  if (!observe) {
    phase = 'default layout and navigation';
    await field('恢复默认演出布局').click();
    const dock = page!.locator('.performance-dock'), dockBox = await dock.boundingBox(); assert.ok(dockBox);
    const panels = await page!.locator('.performance-dock-panel').evaluateAll(elements => elements.map(element => ({
      name: (element as HTMLElement).dataset.dockPanel!, slot: (element as HTMLElement).dataset.dockSlot!,
      x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height,
      scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
    })));
    const panel = (name: string) => panels.find(item => item.name === name)!;
    assert.equal(panel('timeline').slot, 'bottom'); assert.ok(Math.abs(panel('timeline').width - dockBox.width) < 3);
    assert.ok(panel('timeline').y >= Math.max(...panels.filter(item => item.name !== 'timeline').map(item => item.y + item.height)) - 2);
    assert.ok(panel('library').x < panel('preview').x && panel('preview').x < panel('inspector').x);
    assert.ok(Math.max(...panels.filter(item => item.name !== 'timeline').map(item => item.y)) - Math.min(...panels.filter(item => item.name !== 'timeline').map(item => item.y)) < 3);
    assert.ok(panels.every(item => item.scrollWidth <= item.clientWidth + 2), 'Dock panels must not overflow horizontally.');
    assert.ok(await page!.locator('.performance-dock-content').evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth + 2)), 'Dock contents must not overflow horizontally.');
    assert.ok(await page!.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    await expect(page!.getByRole('tab', { name: '时间轴组件', exact: true })).toHaveCount(0);
    await expect(page!.getByRole('tab', { name: '片段', exact: true })).toHaveCount(0);
    await expect(page!.locator('.timeline-properties-tabs')).toHaveCount(0);
    await expect(page!.getByRole('button', { name: '时间轴设置', exact: true })).toHaveCount(1);
    report.acceptanceLayout = panels; await shot('05-default-full-row');
    checks.push('1280×840 默认布局：上方素材／预览／属性三栏，下方时间轴与 dock 等宽，无外层片段分类或横向溢出。');

    phase = 'static text appearance and keyframes';
    await select(titleId); await inspector().getByRole('tab', { name: '基础', exact: true }).click();
    await expect(inspector().locator('.visual-text-appearance > summary')).toHaveText('文字');
    const fontRow = await inspector().locator('.visual-text-font-row').evaluate(row => {
      const font = row.querySelector('.ui-asset-thumbnail')!.getBoundingClientRect(), size = row.querySelector('input')!.getBoundingClientRect();
      const panel = row.closest('.timeline-inspector')!.getBoundingClientRect();
      return { font: font.toJSON(), size: size.toJSON(), panel: panel.toJSON() };
    });
    report.textFontLayout = fontRow;
    assert.ok(Math.abs(fontRow.font.y + fontRow.font.height / 2 - fontRow.size.y - fontRow.size.height / 2) < 3);
    assert.ok(fontRow.size.width >= 45 && fontRow.size.bottom <= fontRow.panel.bottom - 2, 'The default unscrolled text inspector must expose both font and size.');
    await field('片段文字内容').fill('第二回 · 山间归途'); await field('片段文字内容').press('Tab');
    await inspector().getByRole('button', { name: '浏览片段字体', exact: true }).click();
    await page!.getByRole('dialog', { name: '片段字体资源浏览器', exact: true }).locator('.asset-picker-card').filter({ hasText: '验收字体' }).dblclick();
    assert.equal(visual(await save(), titleId, title.instanceId).action.fontAssetId, 'review_font');
    const longFont = await inspector().locator('.visual-text-font-row').evaluate(row => {
      const font = row.querySelector('.ui-asset-thumbnail')!.getBoundingClientRect(), size = row.querySelector('input')!.getBoundingClientRect();
      return { fontRight: font.right, sizeLeft: size.left, width: row.clientWidth, scrollWidth: row.scrollWidth };
    });
    assert.ok(longFont.fontRight <= longFont.sizeLeft && longFont.scrollWidth <= longFont.width + 1, 'Long project font names must shrink within the same row without pushing the size field away.');
    report.longFontLayout = longFont;
    await inspector().getByRole('button', { name: '浏览片段字体', exact: true }).click();
    await page!.getByRole('dialog', { name: '片段字体资源浏览器', exact: true }).locator('.asset-picker-card').filter({ hasText: /^默认字体$/ }).dblclick();
    const clearedFont = visual(await save(), titleId, title.instanceId); assert.equal(clearedFont.object.fontAssetId, undefined); assert.equal(clearedFont.action.fontAssetId, undefined);
    await inspector().getByRole('button', { name: '浏览片段字体', exact: true }).click();
    await page!.getByRole('dialog', { name: '片段字体资源浏览器', exact: true }).locator('.asset-picker-card').filter({ hasText: '验收字体' }).dblclick();
    await field('文字斜体').check(); await field('文字水平对齐').selectOption('left'); await field('文字垂直对齐').selectOption('top');
    await number('片段字号', 1); assert.equal(visual(await save(), titleId, title.instanceId).action.fontSize, 1);
    await number('片段字号', 400); assert.equal(visual(await save(), titleId, title.instanceId).action.fontSize, 400);
    for (const invalid of ['', '-']) {
      await field('片段字号').fill(''); if (invalid) await field('片段字号').press(invalid);
      await field('片段字号').press('Tab'); await expect(field('片段字号')).toHaveValue('400');
    }
    assert.equal(visual(await save(), titleId, title.instanceId).action.fontSize, 400);
    await number('片段字号', 72);
    await field('片段颜色').fill('#66ccff');
    const textStyle = inspector().locator('.visual-text-style'); await textStyle.locator(':scope > summary').click();
    for (const [label, value] of [['描边宽度', 3], ['描边不透明度', .6], ['阴影横向偏移', -8], ['阴影纵向偏移', 6], ['阴影柔化', 9], ['阴影不透明度', .8]] as const) await number(label, value);
    await field('描边颜色').fill('#ff0000'); await field('阴影颜色').fill('#0000ff');
    await field('限制文字显示范围').check(); await number('裁切宽度 %', 80); await number('裁切横向位置 %', 5);
    const textSaved = visual(await save(), titleId, title.instanceId).action;
    assert.equal(textSaved.text, '第二回 · 山间归途'); assert.equal(textSaved.fontAssetId, 'review_font'); assert.equal(textSaved.textItalic, true);
    assert.equal(textSaved.textAlign, 'left'); assert.equal(textSaved.textVerticalAlign, 'top'); assert.equal(textSaved.color, '#66ccff');
    assert.deepEqual(textSaved.textEffects, { outlineWidth: 3, outlineOpacity: .6, shadowX: -8, shadowY: 6, shadowBlur: 9, shadowOpacity: .8, outlineColor: '#ff0000', shadowColor: '#0000ff' });
    assert.deepEqual(textSaved.textClip, { x: .05, y: 0, width: .8, height: 1 });
    await seek(1);
    const valueRows = await inspector().locator('.timeline-property-value').evaluateAll(rows => rows.map(row => {
      const input = row.querySelector('input')!.getBoundingClientRect(), buttons = [...row.querySelectorAll('button')].map(button => button.getBoundingClientRect());
      return { label: row.querySelector('input')!.getAttribute('aria-label'), input: input.toJSON(), buttons: buttons.map(box => box.toJSON()) };
    }));
    assert.ok(valueRows.some(row => row.label === '水平位置 %') && valueRows.some(row => row.label === '垂直位置 %') && valueRows.some(row => row.label === '缩放 %'));
    for (const row of valueRows) {
      assert.equal(row.buttons.length, 3); assert.ok(row.input.width >= 28);
      assert.ok(row.buttons.every(button => Math.abs(button.y + button.height / 2 - row.input.y - row.input.height / 2) < 3));
      assert.ok(row.buttons[0].x >= row.input.x + row.input.width - 2);
    }
    await field('关键帧：水平位置 %').click(); await number('水平位置 %', 65);
    assert.equal(visual(await save(), titleId, title.instanceId).object.curves?.x?.find(frame => Math.abs(frame.at - 1) < .001)?.value, .65);
    await inspector().getByRole('tab', { name: '动画', exact: true }).click();
    for (const label of ['片段文字内容', '片段字号', '片段颜色', '文字斜体', '文字水平对齐', '文字垂直对齐', '描边宽度']) await expect(inspector().getByLabel(label, { exact: true })).toHaveCount(0);
    await expect(inspector().getByRole('button', { name: '浏览片段字体', exact: true })).toHaveCount(0);
    await expect(inspector().locator('summary').filter({ hasText: /^文字动画$/ })).toBeVisible();
    await expect(inspector().locator('summary').filter({ hasText: /^独立属性曲线$/ })).toBeVisible();
    await shot('06-text-animation');
    checks.push('文字静态样式全部在基础页，字体选择／清空默认／再选可保存，字号 1／400 可保存，非法草稿恢复；描边阴影／裁切保留，变换数值与三帧按钮同行，动画页保留动态字段且没有静态重复。');

    phase = 'audio single editor and optional parameters';
    await select(audioId);
    await expect(inspector().locator('.timeline-audio-properties')).toHaveCount(1);
    await expect(inspector().locator('.blueprint-properties')).toHaveCount(0);
    await expect(inspector().getByText('灰色属性已关联参数，可在下方“可替换参数”中查看来源。', { exact: true })).toHaveCount(0);
    for (const label of ['音频片段名称', '音频片段时长', '音频截取起点', '音频片段音量', '音频淡入秒数', '音频淡出秒数']) await expect(inspector().getByLabel(label, { exact: true })).toHaveCount(1);
    const audioPlacement = await inspector().evaluate(panel => {
      const rect = (label: string) => panel.querySelector('[aria-label="' + label + '"]')!.getBoundingClientRect().toJSON();
      return { name: rect('音频片段名称'), start: rect('片段开始秒数'), duration: rect('音频片段时长'), track: panel.querySelector('.timeline-clip-placement')!.getBoundingClientRect().toJSON() };
    });
    assert.ok(audioPlacement.name.bottom <= audioPlacement.start.y && audioPlacement.start.bottom <= audioPlacement.track.y);
    assert.ok(Math.abs(audioPlacement.start.y - audioPlacement.duration.y) < 2);
    await expect(inspector().getByRole('button', { name: '浏览片段音频素材', exact: true })).toHaveCount(1);
    const audioParameters = inspector().locator('.timeline-clip-parameters'); await expect(audioParameters).not.toHaveAttribute('open');
    await number('音频片段时长', 8); await number('音频截取起点', 1); await number('音频片段音量', 65); await number('音频淡入秒数', .5); await number('音频淡出秒数', .75);
    await audioParameters.locator(':scope > summary').click();
    await expect(audioParameters).toHaveAttribute('open');
    const volumeParameter = audioParameters.locator('.timeline-parameter').filter({ has: page!.locator('span').filter({ hasText: /^片段音量$/ }) });
    await expect(volumeParameter).toHaveCount(1); await volumeParameter.getByRole('button', { name: '设为参数', exact: true }).click();
    await expect(field('音频片段音量')).toBeDisabled();
    await expect(inspector().getByText('灰色属性已关联参数，可在下方“可替换参数”中查看来源。', { exact: true })).toBeVisible();
    await expect(volumeParameter.getByRole('button', { name: '设为参数', exact: true })).toHaveCount(0);
    await shot('07-audio-parameters');
    await page!.getByRole('button', { name: '时间轴设置', exact: true }).click();
    await expect(page!.getByRole('region', { name: '时间轴设置', exact: true })).toBeVisible();
    const settingsParameters = page!.locator('.timeline-resource-parameters'); await expect(settingsParameters).not.toHaveAttribute('open');
    await settingsParameters.locator(':scope > summary').click();
    const publicParameter = page!.locator('.timeline-public-parameter'); await expect(publicParameter).toHaveCount(1);
    await publicParameter.locator('.timeline-parameter-default input').fill('0.7'); await publicParameter.locator('.timeline-parameter-default input').press('Tab');
    await page!.getByRole('button', { name: '返回片段属性', exact: true }).click();
    await expect(field('音频片段音量')).toHaveValue('70');
    const audioSaved = projectGraphs(await save()).find(item => item.id === graphId)!;
    const audioAction = performanceTimeline(await save(), audioSaved).actionsByNode.get(audioId)!.find(action => action.kind === 'audioClip')!;
    assert.equal(audioAction.kind, 'audioClip'); if (audioAction.kind === 'audioClip') { assert.equal(audioAction.duration, 8); assert.equal(audioAction.offset, 1); assert.equal(audioAction.volume, .7); assert.equal(audioAction.fadeIn, .5); assert.equal(audioAction.fadeOut, .75); }
    await page!.getByRole('button', { name: '时间轴设置', exact: true }).click(); await select(titleId);
    await expect(field('片段文字内容')).toHaveValue('第二回 · 山间归途');
    await expect(page!.getByRole('region', { name: '时间轴设置', exact: true })).toHaveCount(0);
    checks.push('音频只有一套常用属性；可替换参数默认折叠，展开公开音量后基础值禁用，时间轴设置中默认值修改可回到片段生效，切换片段退出设置。');

    phase = 'low zoom keyboard precision';
    await field('时间轴吸附').check();
    for (const zoom of [40, 60]) {
      await field('轨道缩放').selectOption(String(zoom)); await select(titleId);
      const before = Number(await clip(titleId).getAttribute('data-start'));
      for (let index = 1; index <= 3; index++) {
        await page!.keyboard.press('ArrowRight');
        await expect.poll(async () => Number(await clip(titleId).getAttribute('data-start'))).toBeCloseTo(before + index * .1, 6);
      }
      await expect(field('时间轴吸附')).toBeChecked();
    }
    checks.push('40／60 缩放且吸附开启时，连续三次方向键各移动 0.1 秒，合计精确 0.3 秒。');

    phase = 'root bulk shortcuts and relative dragging';
    for (const key of ['Delete', 'Backspace']) {
      const before = await snapshot(); await multiSelect([titleId, subtitleId]); await page!.keyboard.press(key);
      await expect(clip(titleId)).toHaveCount(0); await expect(clip(subtitleId)).toHaveCount(0);
      await expect(page!.locator('.timeline-clip')).toHaveCount(before.length - 2); await undo(); await sameState(before);
    }
    const beforeCopy = await snapshot(); await multiSelect([titleId, subtitleId]); await page!.keyboard.press('Control+d');
    await expect(page!.locator('.timeline-clip')).toHaveCount(beforeCopy.length + 2);
    const copies = (await snapshot()).filter(item => !beforeCopy.some(old => old.id === item.id));
    assert.equal(copies.length, 2); assert.equal(new Set(copies.map(item => item.id)).size, 2);
    await expect(page!.locator('.timeline-clip[aria-pressed="true"]')).toHaveCount(2);
    const sources = beforeCopy.filter(item => [titleId, subtitleId].includes(item.id)).sort((a, b) => a.at - b.at), sortedCopies = [...copies].sort((a, b) => a.at - b.at);
    const copyOffset = sortedCopies[0].at - sources[0].at;
    assert.ok(copyOffset > 0); assert.ok(Math.abs(sortedCopies[1].at - sources[1].at - copyOffset) < .000001);
    assert.deepEqual(sortedCopies.map(item => item.duration), sources.map(item => item.duration));
    await undo(); await sameState(beforeCopy);
    await multiSelect([titleId, subtitleId]); await field('时间轴吸附').uncheck();
    const beforeMove = await snapshot(); await gesture(clip(titleId), 1);
    const afterMove = await snapshot(), moving = beforeMove.filter(item => [titleId, subtitleId].includes(item.id));
    report.rootMove = { before: beforeMove, after: afterMove };
    const trackOrder = await page!.locator('.timeline-track[data-track-id]').evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.trackId!));
    for (const before of moving) {
      const after = afterMove.find(item => item.id === before.id)!;
      assert.ok(Math.abs(after.at - before.at - 1) < .02); assert.equal(after.duration, before.duration);
      assert.equal(trackOrder.indexOf(after.trackId) - trackOrder.indexOf(before.trackId), 0);
    }
    assert.ok(Math.abs((afterMove.find(item => item.id === subtitleId)!.at - afterMove.find(item => item.id === titleId)!.at) - (moving.find(item => item.id === subtitleId)!.at - moving.find(item => item.id === titleId)!.at)) < .000001);
    await undo(); await sameState(beforeMove);
    await multiSelect([titleId, subtitleId]);
    await gesture(clip(titleId), 7, { rowDelta: 1 });
    const movedRows = await snapshot(), rowDeltas = moving.map(before => {
      const after = movedRows.find(item => item.id === before.id)!;
      assert.equal(after.duration, before.duration);
      return { time: after.at - before.at, track: trackOrder.indexOf(after.trackId) - trackOrder.indexOf(before.trackId) };
    });
    report.rootRowMove = { before: beforeMove, after: movedRows, deltas: rowDeltas };
    assert.equal(rowDeltas[0].track, 1); assert.equal(rowDeltas[1].track, 1);
    assert.ok(Math.abs(rowDeltas[0].time - rowDeltas[1].time) < .000001 && rowDeltas[0].time > 0);
    await undo(); await sameState(beforeMove);
    const orderBeforeDrag = await page!.locator('.timeline-track[data-track-id]').evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.trackId!));
    const trackHandle = page!.getByRole('button', { name: '拖动轨道 标题', exact: true });
    const dragTrack = async (cancel: boolean) => {
      await trackHandle.scrollIntoViewIfNeeded();
      const handleBox = await trackHandle.boundingBox(); assert.ok(handleBox);
      await page!.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2); await page!.mouse.down();
      await page!.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2 + 54, { steps: 6 });
      if (cancel) await page!.keyboard.press('Escape');
      await page!.mouse.up();
    };
    await dragTrack(true);
    await expect.poll(() => page!.locator('.timeline-track[data-track-id]').evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.trackId!))).toEqual(orderBeforeDrag);
    await dragTrack(false);
    await expect.poll(() => page!.locator('.timeline-track[data-track-id]').evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.trackId!))).toEqual([orderBeforeDrag[1], orderBeforeDrag[0], ...orderBeforeDrag.slice(2)]);
    await undo();
    await expect.poll(() => page!.locator('.timeline-track[data-track-id]').evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.trackId!))).toEqual(orderBeforeDrag);
    checks.push('Ctrl 多选 Delete／Backspace 全删、Ctrl+D 批量复制均一次撤销恢复；整体拖动保留相对时间、时长及轨道间距；轨道重排可取消，正常重排可一次撤销。');

    phase = 'cancel drag and media trim';
    await select(audioId); const beforeCancel = await snapshot(); await save();
    for (const mode of ['move', 'left', 'right'] as const) for (const cancellation of ['escape', 'blur'] as const) {
      await gesture(clip(audioId), mode === 'right' ? -1 : .5, { edge: mode === 'move' ? undefined : mode, release: false });
      await expect.poll(async () => JSON.stringify(await snapshot()) !== JSON.stringify(beforeCancel)).toBe(true);
      if (cancellation === 'escape') await page!.keyboard.press('Escape');
      else await page!.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page!.mouse.up(); await sameState(beforeCancel);
      await expect(page!.locator('.dirty-dot')).toHaveCount(0);
    }
    const beforeTrim = await save(), originalAudio = performanceTimeline(beforeTrim, projectGraphs(beforeTrim).find(item => item.id === graphId)!).actionsByNode.get(audioId)!.find(action => action.kind === 'audioClip')!;
    await gesture(clip(audioId), .5, { edge: 'left' });
    const committedTrim = await save(), trimmedAudio = performanceTimeline(committedTrim, projectGraphs(committedTrim).find(item => item.id === graphId)!).actionsByNode.get(audioId)!.find(action => action.kind === 'audioClip')!;
    assert.equal(originalAudio.kind, 'audioClip'); assert.equal(trimmedAudio.kind, 'audioClip');
    if (originalAudio.kind === 'audioClip' && trimmedAudio.kind === 'audioClip') { assert.ok(Math.abs(trimmedAudio.offset - originalAudio.offset - .5) < .02); assert.ok(Math.abs(trimmedAudio.duration - originalAudio.duration + .5) < .02); }
    await undo(); await sameState(beforeCancel);
    checks.push('移动和左右 trim 在 Esc／失焦后恢复片段且不写工程；实际入点 trim 更新素材截取位置，一次撤销恢复。');

    phase = 'collision insertion selects actual placement';
    await select(titleId); await seek(1); const beforeInsert = await snapshot();
    await field('搜索演出素材').fill('山间背景');
    await page!.getByRole('button', { name: '添加素材 山间背景', exact: true }).click();
    await field('搜索演出素材').fill('');
    await expect(page!.locator('.timeline-clip')).toHaveCount(beforeInsert.length + 1);
    const inserted = (await snapshot()).find(item => !beforeInsert.some(old => old.id === item.id))!; assert.ok(inserted.at > 1.1);
    await expect(clip(inserted.id)).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => Number((await field('当前时间').innerText()).split(' ')[0])).toBeCloseTo(inserted.at + .01, 2);
    await expect(field('片段开始秒数')).toHaveValue(String(inserted.at));
    const newVisual = rawSavedBlueprintAction(projectGraphs(await save()).find(item => item.id === graphId)!.nodes.find(item => item.id === inserted.id)!);
    assert.equal(newVisual?.kind, 'visual');
    checks.push('素材添加发生同轨冲突后，选中实际避让后的新片段，播放头定位到它的可见区间。');

    phase = 'composition selection copy and single properties';
    await clip(groupId).dblclick({ position: { x: 30, y: 14 } });
    await expect(field('组合剪辑工作区')).toHaveAttribute('data-group-id', group.instanceId);
    const groupClip = (id: string) => page!.locator('.composition-track-clip[data-instance-id="' + id + '"]');
    const groupState = () => page!.locator('.composition-track-clip').evaluateAll(elements => elements.map(element => ({ id: (element as HTMLElement).dataset.instanceId!, at: Number((element as HTMLElement).dataset.start), duration: Number((element as HTMLElement).dataset.duration) })).sort((a, b) => a.id.localeCompare(b.id)));
    await groupClip(childTitle.instanceId).click({ position: { x: 28, y: 14 } });
    await expect(field('片段文字内容')).toHaveValue(childTitle.text);
    await groupClip(childSubtitle.instanceId).click({ position: { x: 28, y: 14 }, modifiers: ['Control'] });
    await expect(field('组合多选操作')).toBeVisible(); await expect(inspector().getByLabel('片段文字内容', { exact: true })).toHaveCount(0);
    const beforeGroupCopy = await groupState(); await page!.keyboard.press('Control+d');
    await expect(page!.locator('.composition-track-clip')).toHaveCount(4);
    await expect(page!.locator('.composition-track-clip[aria-pressed="true"]')).toHaveCount(2);
    const copiedGroup = (await groupState()).filter(item => !beforeGroupCopy.some(old => old.id === item.id));
    assert.deepEqual(copiedGroup.map(item => item.at).sort((a, b) => a - b), beforeGroupCopy.map(item => item.at).sort((a, b) => a - b));
    await undo(); await expect.poll(groupState).toEqual(beforeGroupCopy);
    await groupClip(childTitle.instanceId).click({ position: { x: 28, y: 14 } });
    const beforeGroupGesture = await groupState(), childBox = await groupClip(childTitle.instanceId).boundingBox(); assert.ok(childBox);
    await page!.mouse.move(childBox.x + 35, childBox.y + childBox.height / 2); await page!.mouse.down();
    await page!.mouse.move(childBox.x + 65, childBox.y + childBox.height / 2, { steps: 4 });
    await page!.keyboard.press('Control+d'); await page!.keyboard.press('Delete'); await page!.keyboard.press('ArrowRight'); await page!.keyboard.press('Enter');
    await expect(page!.locator('.composition-track-clip')).toHaveCount(2);
    await page!.keyboard.press('Escape'); await page!.mouse.up(); await expect.poll(groupState).toEqual(beforeGroupGesture);
    await groupClip(childTitle.instanceId).click({ position: { x: 28, y: 14 } });
    await expect(field('组合多选操作')).toHaveCount(0); await expect(field('片段文字内容')).toHaveValue(childTitle.text);
    await expect(field('组合片段名称')).toHaveValue(childTitle.name);
    const groupTiming = await page!.locator('.composition-inspector .timeline-timing-fields').evaluate(row => [...row.querySelectorAll('input')].map(input => input.getBoundingClientRect().toJSON()));
    assert.equal(groupTiming.length, 2); assert.ok(Math.abs(groupTiming[0].y - groupTiming[1].y) < 2);
    await field('片段文字内容').fill('组合单选后的标题'); await field('片段文字内容').press('Tab');
    assert.equal(visual(await save(), groupId, childTitle.instanceId).action.text, '组合单选后的标题');
    await field('组合轨道画布').focus(); await page!.keyboard.press('Space'); await expect(playbackControl()).toHaveClass(/active/);
    await page!.keyboard.press('Space'); await expect(playbackControl()).not.toHaveClass(/active/);
    await shot('08-composition-single-properties');
    await page!.getByRole('button', { name: '返回上层', exact: true }).click(); await expect(field('时间轴画布')).toBeVisible();
    checks.push('组合 Ctrl 多选复制保留两个片段的相对时间，一次撤销恢复；多选只显示整组操作，单选明确显示并编辑当前片段属性，空格可播放／暂停。');

    phase = 'paused video thumbnail and in-point';
    await select(videoId); await field('轨道缩放').selectOption('60');
    const filmstrip = clip(videoId).locator('video.timeline-clip-filmstrip'); await expect(filmstrip).toHaveCount(1);
    const mediaState = () => filmstrip.evaluate(element => {
      const video = element as HTMLVideoElement;
      return { paused: video.paused, time: video.currentTime, duration: video.duration, readyState: video.readyState };
    });
    // The editor serves local media through its own protocol. Read the actual
    // rendered pixels, without weakening cross-origin canvas restrictions.
    const thumbnailPixels = async (evidence?: string) => {
      const bytes = await filmstrip.screenshot({ type: 'png', scale: 'css' }), png = PNG.sync.read(bytes);
      if (evidence) await fs.writeFile(path.join(output, evidence + '.png'), bytes);
      let red = 0, blue = 0, count = 0;
      for (let y = 3; y < png.height - 3; y++) for (let x = 8; x < png.width - 8; x++) {
        const index = (y * png.width + x) * 4, r = png.data[index], b = png.data[index + 2];
        if (r > 100 && r - b > 60) red++;
        if (b > 100 && b - r > 60) blue++;
        count++;
      }
      return { width: png.width, height: png.height, redCoverage: red / count, blueCoverage: blue / count };
    };
    await expect.poll(async () => (await mediaState()).readyState).toBeGreaterThanOrEqual(2);
    const red = await mediaState(); assert.ok(red.paused && red.time < .1 && Math.abs(red.duration - 6) < .2);
    await expect.poll(async () => (await thumbnailPixels()).redCoverage).toBeGreaterThan(.3);
    const redPixels = await thumbnailPixels('video-thumbnail-red');
    await field('轨道缩放').selectOption('240');
    await canvas().evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await expect(filmstrip).toHaveCount(0);
    await canvas().evaluate(element => { element.scrollLeft = 0; });
    await expect(filmstrip).toHaveCount(1);
    await expect.poll(async () => (await mediaState()).readyState).toBeGreaterThanOrEqual(2);
    await field('轨道缩放').selectOption('60');
    await canvas().focus(); await page!.keyboard.press('Space'); await expect(playbackControl()).toHaveClass(/active/);
    await expect.poll(async () => Number((await field('当前时间').innerText()).split(' ')[0])).toBeGreaterThan(.25);
    const playing = await mediaState(); assert.equal(playing.paused, true); assert.ok(Math.abs(playing.time - red.time) < .01);
    await page!.keyboard.press('Space'); await expect(playbackControl()).not.toHaveClass(/active/);
    await number('视频素材入点', 3.5);
    await expect.poll(async () => (await mediaState()).time).toBeCloseTo(3.5, 2);
    await expect.poll(async () => (await thumbnailPixels()).blueCoverage).toBeGreaterThan(.3);
    const blue = await mediaState(), bluePixels = await thumbnailPixels('video-thumbnail-blue'); assert.equal(blue.paused, true);
    await field('停止预览').click();
    await expect.poll(async () => Number((await field('当前时间').innerText()).split(' ')[0])).toBe(0);
    assert.equal((await mediaState()).paused, true); assert.ok(Math.abs((await mediaState()).time - 3.5) < .01);
    assert.equal(visual(await save(), videoId, video.instanceId).action.mediaOffset, 3.5);
    report.videoThumbnail = { initial: red, duringPlayback: playing, afterInPoint: blue, redPixels, bluePixels }; await shot('09-video-static-thumbnail');
    checks.push('根时间轴空格可播放／暂停，视频轨道封面始终暂停，不跟随预览播放；入点 3.5 秒后更新到蓝色帧，停止后保留该封面并保存入点。');

    phase = 'save and reopen';
    const final = await save(); await fs.writeFile(path.join(output, 'saved-project-evidence.vns.json'), JSON.stringify(final, null, 2));
    await closeApp();
    assert.ok(!teardownTimedOut && ownedProcesses.every(owned => owned.exitCode !== null || owned.signalCode !== null), 'The first fixture must exit before reopening.');
    await launch(); await openTimeline();
    await expect(page!.locator('.timeline-clip')).toHaveCount(7);
    await select(titleId); await expect(field('片段文字内容')).toHaveValue('第二回 · 山间归途'); await expect(field('片段字号')).toHaveValue('72');
    await expect(field('文字斜体')).toBeChecked(); await expect(field('文字水平对齐')).toHaveValue('left'); await expect(field('文字垂直对齐')).toHaveValue('top');
    await inspector().locator('.visual-text-style > summary').click(); await expect(field('描边宽度')).toHaveValue('3'); await expect(field('阴影横向偏移')).toHaveValue('-8');
    await select(audioId); await expect(field('音频片段音量')).toHaveValue('70'); await expect(field('音频片段音量')).toBeDisabled();
    await select(videoId); await expect(field('视频素材入点')).toHaveValue('3.5');
    await clip(groupId).dblclick({ position: { x: 30, y: 14 } });
    await page!.locator('.composition-track-clip[data-instance-id="' + childTitle.instanceId + '"]').click({ position: { x: 28, y: 14 } });
    await expect(field('片段文字内容')).toHaveValue('组合单选后的标题');
    assert.deepEqual(projectGraphs(await save()), projectGraphs(final)); assert.deepEqual(errors, []);
    await shot('10-reopened-final');
    checks.push('完全关闭后重开，文字样式、音量公开参数、入点、组合文字和新增片段全部保留，当前源码界面无页面错误。');

    phase = 'mixed reusable timeline inspector';
    await page!.getByRole('button', { name: '返回上层', exact: true }).click();
    await multiSelect([titleId, audioId]);
    await inspector().getByRole('button', { name: '制作组合', exact: true }).click();
    await expect(page!.locator('.timeline-clip')).toHaveCount(6);
    await expect(inspector().locator('.timeline-audio-properties')).toHaveCount(0);
    await expect(inspector().getByRole('button', { name: '编辑内部时间轴', exact: true })).toBeVisible();
    await expect(inspector().getByLabel('片段开始秒数', { exact: true })).toHaveCount(1);
    await shot('11-mixed-timeline-properties');
    await undo();
    await expect(page!.locator('.timeline-clip')).toHaveCount(7);
    assert.deepEqual(projectGraphs(await save()), projectGraphs(final));
    checks.push('文字和音频制作组合后，外层显示子时间轴调用属性和内部编辑入口，不误显示某个内部音频的属性；一次撤销恢复工程。');
    report.status = 'passed';
  } else {
    report.status = 'observed'; report.observationOnly = true;
    // Old-dist baseline records visible state only. It never enters new acceptance or media generation.
  }
  report.projectSha256 = createHash('sha256').update(await fs.readFile(projectFile)).digest('hex');
} catch (error) {
  report.status = 'failed'; report.phase = phase;
  report.failure = error instanceof Error ? error.stack : String(error);
  if (page) report.inputEvidence = await page.evaluate(() => (window as unknown as { timelineInputEvidence: unknown[] }).timelineInputEvidence).catch(() => []);
  if (page) { await shot('failure').catch(() => undefined); await fs.writeFile(path.join(output, 'failure-dom.txt'), await page.locator('body').innerText().catch(() => '')).catch(() => undefined); }
  process.exitCode = 1;
} finally {
  report.errors = errors; report.checks = checks;
  await fs.copyFile(projectFile, path.join(output, 'project-evidence.vns.json')).catch(() => undefined);
  await closeApp();
  report.traces = traces;
  report.processExited = ownedProcesses.every(owned => owned.exitCode !== null || owned.signalCode !== null);
  report.teardownTimedOut = teardownTimedOut;
  if (report.status === 'passed' && (errors.length || report.traceError || report.closeError || !report.processExited || teardownTimedOut)) { report.status = 'failed'; process.exitCode = 1; }
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (report.processExited && !teardownTimedOut) {
    // Keep reusable fixture media with the engineering evidence before removing its live project/profile.
    try {
      await fs.cp(path.join(directory, 'assets'), path.join(output, 'assets'), { recursive: true });
      const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); report.cleanup = cleanup;
      if (cleanup.errors.length) { report.cleanupError = 'Some owned temporary directories remain.'; process.exitCode = 1; }
    } catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  } else { process.exitCode = 1; await fs.writeFile(path.join(output, 'cleanup.json'), JSON.stringify({ retained: [directory, path.join(output, 'profile')], reason: teardownTimedOut ? 'Fixture shutdown timed out.' : 'Owned fixture process did not exit.' }, null, 2)); }
  console.log(JSON.stringify({ output, mode: report.mode, checks, errors, failure: report.failure, processExited: report.processExited }, null, 2));
}
