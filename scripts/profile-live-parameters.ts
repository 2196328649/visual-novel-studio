import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';
import { assetFiles, type Project } from '../src/core/model';
import { assetSourcePath } from '../src/desktop/project-store';
import { enterFixtureProject, launchDesktopFixture, installedExecutable } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), baseline = process.argv.includes('--baseline');
const original = path.resolve(process.argv[2]);
const assetsArgument = process.argv.indexOf('--assets-root');
const assetsRoot = assetsArgument < 0 ? path.dirname(original) : path.resolve(process.argv[assetsArgument + 1]);
const bytes = await fs.readFile(original), originalHash = createHash('sha256').update(bytes).digest('hex');
const project: Project = JSON.parse(bytes.toString('utf8'));
const output = path.resolve('artifacts/live-parameters', new Date().toISOString().replaceAll(':', '-') + (baseline ? '-baseline' : ''));
const file = path.join(output, 'project/project.vns.json');
await fs.mkdir(path.dirname(file), { recursive: true });
for (const asset of project.assets) {
  asset.externalFiles = Object.fromEntries(assetFiles(asset).map(relative => [relative, assetSourcePath(assetsRoot, asset, relative)]));
  asset.externalPath = asset.externalFiles[asset.path];
}
project.playerDefaults = { ...project.playerDefaults, masterVolume: 0 };
await fs.writeFile(file, JSON.stringify(project));
const node = project.nodes.find(node => node.kind === 'passage' && node.lines.some(line => line.actions.some(action => action.kind === 'visual' && action.content === 'image')));
assert.ok(node?.kind === 'passage');
const line = node.lines.find(line => line.actions.some(action => action.kind === 'visual' && action.content === 'image'))!;
const app = await launchDesktopFixture({ root, projectFile: file, profile: path.join(output, 'profile') });
const page = await app.firstWindow(), errors: string[] = [], metrics: Record<string, unknown> = {};
page.on('pageerror', error => errors.push(error.message));
const summarize = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return { count: sorted.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))], maxMs: sorted.at(-1) }; };
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setContentSize(1440, 960); window.show(); window.focus(); });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  for (const mode of ['script', 'text'] as const) {
    await openStoryMode(page, 'script');
    await page.locator(`#line-${line.id} textarea`).click();
    const panel = page.locator('.story-preview-content .passage-performances');
    if (mode === 'text') {
      await openStoryMode(page, 'text');
      const input = page.getByLabel('中文文本剧本', { exact: true });
      await input.evaluate((element, text) => { const field = element as HTMLTextAreaElement; const at = field.value.indexOf(text); if (at < 0) throw Error('Missing image dialogue'); field.focus(); field.setSelectionRange(at + text.length, at + text.length); }, line.text);
      await input.press('ArrowLeft'); await input.press('ArrowRight');
    }
    const imageChip = panel.locator('.line-effect-chip[data-action-kind="visual"]');
    if (await imageChip.getAttribute('aria-expanded') !== 'true') await imageChip.click();
    const x = panel.getByLabel('图片位置 X', { exact: true });
    await expect(x).toBeVisible(); await x.scrollIntoViewIfNeeded();
    const before = Number(await x.inputValue());
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForTimeout(250);
    await x.evaluate(element => {
      const state = window as any;
      state.liveElement = element;
      state.liveMetrics = { frames: [], paints: [], cloneMs: [], longTasks: [] };
      state.liveOriginalClone = window.structuredClone;
      state.structuredClone = function (...args: unknown[]) { const start = performance.now(); try { return state.liveOriginalClone(...args); } finally { state.liveMetrics.cloneMs.push(performance.now() - start); } };
      state.liveInput = () => { const start = performance.now(); requestAnimationFrame(() => { state.liveMetrics.frames.push(performance.now() - start); setTimeout(() => state.liveMetrics.paints.push(performance.now() - start), 0); }); };
      element.addEventListener('input', state.liveInput, true);
      state.liveObserver = new PerformanceObserver(list => state.liveMetrics.longTasks.push(...list.getEntries().map(entry => entry.duration)));
      state.liveObserver.observe({ type: 'longtask', buffered: false });
    });
    await cdp.send('Profiler.start');
    const box = await x.locator('..').boundingBox(); assert.ok(box);
    const start = { x: box.x + 5, y: box.y + box.height / 2 };
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    for (let step = 1; step <= 24; step++) await page.mouse.move(start.x + step * 5, start.y);
    await page.mouse.up();
    await page.waitForTimeout(200);
    const { profile } = await cdp.send('Profiler.stop');
    await fs.writeFile(path.join(output, mode + '.cpuprofile'), JSON.stringify(profile));
    const measured = await page.evaluate(() => {
      const state = window as any;
      state.liveElement.removeEventListener('input', state.liveInput, true); state.liveObserver.disconnect(); state.structuredClone = state.liveOriginalClone;
      return state.liveMetrics as { frames: number[]; paints: number[]; cloneMs: number[]; longTasks: number[] };
    });
    metrics[mode] = { before, expected: before + 24, actual: await x.count() ? Number(await x.inputValue()) : null, frames: summarize(measured.frames), paints: summarize(measured.paints), clone: summarize(measured.cloneMs), longTasks: measured.longTasks };
    if (!baseline) {
      await expect(x).toHaveValue(String(before + 24));
      assert.ok(measured.frames.length >= 12, 'live feedback must update throughout the drag');
      assert.ok(summarize(measured.frames).p95Ms! < 100, 'numeric drag p95 frame latency below 100 ms');
      await page.getByRole('button', { name: '撤销', exact: true }).click();
      await expect(x).toHaveValue(String(before));
      await page.getByRole('button', { name: '重做', exact: true }).click();
      await expect(x).toHaveValue(String(before + 24));
    }
    if (await x.count()) { await x.fill(String(before)); await x.press('Tab'); }
  }
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  await page.reload();
  await enterFixtureProject(page, file);
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  assert.equal(createHash('sha256').update(await fs.readFile(original)).digest('hex'), originalHash);
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: baseline ? 'baseline' : 'passed', source: original, originalHash, installedExecutable, metrics, errors }, null, 2));
  console.log(JSON.stringify(metrics));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', metrics, errors, error: String(error) }, null, 2));
  throw error;
} finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined); await app.close(); console.log(output); }
