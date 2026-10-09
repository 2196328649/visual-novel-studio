import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';
import { assetFiles } from '../src/core/model';
import { assetSourcePath } from '../src/desktop/project-store';
const root = path.resolve('.');
const output = path.resolve('artifacts/chapter-preview-profile', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const author = process.env.VNS_PROFILE_PROJECT ?? 'E:/Project/Visual Novel Studio/我的视觉小说1/project.vns.json';
const latest = await fs.readFile(author + '.autosave', 'utf8').then(JSON.parse).catch(() => undefined);
const seed = latest?.savedAt > (await fs.stat(author)).mtimeMs ? latest.project : JSON.parse(await fs.readFile(author, 'utf8'));
const graphId = process.env.VNS_PROFILE_IMAGE ? seed.blueprints.find((g: any) => g.chapterVariant === 'image').id : 'builtin_chapter_text';
if (!process.env.VNS_PROFILE_IMAGE) seed.scriptText.content = seed.scriptText.content.replace(/^@章节进入演出(?:【[^】]*】)?[:：].*$/m, '@章节进入演出文字版：章节音效=鼠标滑动');
const folder = path.join(output, 'project'); await fs.mkdir(folder);
for (const asset of seed.assets) asset.externalFiles = Object.fromEntries(assetFiles(asset).map(file => [file, assetSourcePath(path.dirname(author), asset, file)]));
const file = path.join(folder, 'project.vns.json'); await fs.writeFile(file, JSON.stringify(seed));
const app = await launchDesktopFixture({ root, projectFile: file, profile: path.join(output, 'profile') });
const page = await app.firstWindow();
const cdp = await page.context().newCDPSession(page);
const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
async function measurePlayback() {
 const button = page.getByRole('button', { name: '播放预览', exact: true });
 await button.evaluate(element => { (window as any).__profilePlaybackButton = element; });
 await page.evaluate(`(() => {
   const element = window.__profilePlaybackButton;
   const sample = { start: 0, firstFrameDelay: 0, frames: [], active: true };
   window.__playbackSample = sample;
   element.addEventListener('click', () => {
     sample.start = performance.now();
     let previous = 0;
     const tick = now => {
       if (!sample.active) return;
       if (previous) sample.frames.push({ at: now - sample.start, interval: now - previous });
       else sample.firstFrameDelay = Math.max(0, now - sample.start);
       previous = now; requestAnimationFrame(tick);
     };
     requestAnimationFrame(tick);
   }, { once: true });
 })()`);
 await button.click();
 await page.waitForTimeout(8500);
 return page.evaluate(() => {
   const sample = (window as any).__playbackSample as { start: number; firstFrameDelay: number; frames: { at: number; interval: number }[]; active: boolean };
   sample.active = false;
   const intervals = sample.frames.map(frame => frame.interval).sort((a, b) => a - b);
   return { start: sample.start, firstFrameDelay: sample.firstFrameDelay, frames: intervals.length, p50: intervals[Math.floor(intervals.length * .5)], p95: intervals[Math.floor(intervals.length * .95)], max: intervals.at(-1), longFrames: sample.frames.filter(frame => frame.interval > 50) };
 });
}
try {
 await expect(page.locator('.project-title strong')).toBeVisible({ timeout: 60000 });
 await openStoryMode(page, 'text');
 await page.evaluate(() => {
   (window as any).__longTasks = [];
   new PerformanceObserver(list => (window as any).__longTasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration })))).observe({ entryTypes: ['longtask'] });
 });
 await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
 const steps: Record<string, number> = {};
 const clicked = performance.now();
 await page.getByLabel('中文文本剧本', { exact: true }).evaluate((element, image) => {
   const input = element as HTMLTextAreaElement, at = input.value.indexOf(image ? '@章节进入演出' : '@章节进入演出文字版');
   input.focus(); input.setSelectionRange(at + 2, at + 2); input.dispatchEvent(new Event('select', { bubbles: true })); input.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
 }, !!process.env.VNS_PROFILE_IMAGE);
 await expect(page.getByLabel('演出目标', { exact: true })).toHaveValue('graph:' + graphId);
 steps.openBlueprint = performance.now() - clicked;
 if (process.env.VNS_PROFILE_TIMELINE) {
   const call = seed.blueprints.find((g: any) => g.id === graphId).nodes.find((n: any) => n.type === 'callFunction');
   await page.locator(`.react-flow__node[data-id="${call.id}"] .graph-node-title`).dblclick();
   await expect(page.getByLabel('时间轴画布', { exact: true })).toBeVisible();
   steps.openTimeline = performance.now() - clicked - steps.openBlueprint;
   if (process.env.VNS_PROFILE_SELECT) await (process.env.VNS_PROFILE_SELECT === 'visual' ? page.locator('.timeline-clip').first() : page.locator('.timeline-clip').last()).click();
   steps.selectClip = performance.now() - clicked - steps.openBlueprint - steps.openTimeline;
 }
 const clickMs = performance.now() - clicked;
 const playback = await measurePlayback();
 expect(playback.frames).toBeGreaterThan(100);
 const profile = await cdp.send('Profiler.stop');
 await fs.writeFile(path.join(output, 'profile.json'), JSON.stringify(profile));
 const counts = new Map<number, number>();
 profile.profile.samples?.forEach((id, i) => counts.set(id, (counts.get(id) ?? 0) + (profile.profile.timeDeltas?.[i] ?? 0)));
 const top = profile.profile.nodes.map(n => ({ name: n.callFrame.functionName, url: n.callFrame.url, line: n.callFrame.lineNumber, ms: (counts.get(n.id) ?? 0) / 1000 })).sort((a, b) => b.ms - a.ms).slice(0, 30);
 const report = { clickMs, steps, frames: playback.frames, frameP50: playback.p50, frameP95: playback.p95, frameMax: playback.max, longFrames: playback.longFrames.length, playback, ranges: await page.locator('input[type=range]').evaluateAll(es => es.map(e => ({ name: e.getAttribute('aria-label'), max: e.getAttribute('max') }))), errors, top };
 const playhead = page.getByRole('slider', { name: '时间轴播放头', exact: true });
 Object.assign(report, { longTasks: await page.evaluate(() => (window as any).__longTasks) });
 if (await playhead.count()) await playhead.press('Home');
 const warmPlayback = await measurePlayback();
 expect(warmPlayback.frames).toBeGreaterThan(100);
 Object.assign(report, { warmPlayback: { ...warmPlayback, longFrameDetails: warmPlayback.longFrames, longFrames: warmPlayback.longFrames.length } });
 if (await playhead.count()) { await playhead.press('Home'); await playhead.press('Shift+ArrowRight'); }
 await page.waitForTimeout(500);
 const glyphErrors = await page.locator('[data-glyph-error]').count();
 const loadedImages = await page.locator('svg[data-visual-instance] image').evaluateAll(async es => await Promise.all(es.filter(e => (e as SVGImageElement).href.baseVal).map(async e => { const src = (e as SVGImageElement).href.baseVal, img = new Image(); img.src = src; await img.decode(); return { src, width: img.naturalWidth }; })));
 const textAreas = await page.locator('[data-visual-text]').evaluateAll(es => es.map(e => ({ text: e.textContent, font: getComputedStyle(e).fontFamily, ready: document.fonts.check('16px ' + getComputedStyle(e).fontFamily) })));
 Object.assign(report, { textAreas });
 Object.assign(report, { glyphErrors, loadedImages });
 await page.screenshot({ path: path.join(output, 'preview.png') });
 expect(errors).toEqual([]); expect(glyphErrors).toBe(0);
 await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => undefined); await app.close(); console.log(output); }
