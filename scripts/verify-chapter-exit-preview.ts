import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { PNG } from 'pngjs';
import { assetFiles } from '../src/core/model';
import { parseProject, assetSourcePath } from '../src/desktop/project-store';
import { applyTextScript } from '../src/core/text-script';
import { linePreviewSnapshot, linePlaybackPlan } from '../src/core/line-preview';
import { performancePlayback } from '../src/core/standalone-performance';
import { performanceTransitionDuration } from '../src/core/performance-preview';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), arg = process.argv.indexOf('--project');
if (arg < 0) throw Error('Provide --project with the project or autosave to verify.');
const file = path.resolve(process.argv[arg + 1]), baseline = process.argv.includes('--baseline');
const bytes = await fs.readFile(file), raw = JSON.parse(bytes.toString());
const project = parseProject(raw.project ?? raw).project;
for (const asset of project.assets) {
  asset.externalFiles = Object.fromEntries(assetFiles(asset).map(relative => [relative, assetSourcePath(path.dirname(file), asset, relative)]));
  asset.externalPath = asset.externalFiles[asset.path];
}
project.playerDefaults = { ...project.playerDefaults, masterVolume: 0 };
const parsed = applyTextScript(project, project.scriptText!.content).project;
const node = parsed.nodes.find(node => node.kind === 'passage' && node.lines[0]?.silent);
if (node?.kind !== 'passage') throw Error('No standalone performance');
const selected = { nodeId: node.id, lineId: node.lines[0].id }, snapshot = linePreviewSnapshot(parsed, selected);
const plan = linePlaybackPlan(snapshot.before, snapshot.actions), end = Math.max(plan.until, plan.dialogueAt) / 1000;
const transition = performanceTransitionDuration(performancePlayback(parsed, snapshot.line!)) / 1000;
const output = path.join(root, 'artifacts/chapter-exit-preview', new Date().toISOString().replaceAll(':', '-') + (baseline ? '-baseline' : ''));
await fs.mkdir(output, { recursive: true });
const projectFile = path.join(output, 'project.vns.json'); await fs.writeFile(projectFile, JSON.stringify(project));
const errors: string[] = [], samples: { time: number; yellowRatio: number; mean: number[]; backgroundOpacity: string | null }[] = [];
let app: ElectronApplication | undefined, page: Page | undefined;
try {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
  page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 960));
  await openStoryMode(page, 'text');
  const hide = page.getByRole('button', { name: /^(隐藏演出|显示演出)$/ });
  if (await hide.getAttribute('aria-pressed') === 'true') await hide.click();
  const suspend = page.locator('.preview-suspend-toggle');
  if (await suspend.getAttribute('aria-pressed') === 'true') await suspend.click();
  const input = page.getByLabel('中文文本剧本', { exact: true });
  await input.evaluate(element => {
    const t = element as HTMLTextAreaElement, at = t.value.indexOf('@独立演出');
    if (at < 0) throw Error('Missing standalone declaration');
    t.focus(); t.setSelectionRange(at + 3, at + 3); t.dispatchEvent(new Event('select', { bubbles: true }));
  });
  const stage = page.locator('.preview-stage-viewport').first();
  const frames: PNG[] = [];
  for (const time of [end - .8, end - .2, end, end + transition * .25, end + transition * .5, end + transition * .75, end + transition]) {
    await page.getByLabel('演出预览进度', { exact: true }).evaluate((element, time) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(element, String(time)); element.dispatchEvent(new Event('input', { bubbles: true }));
    }, time);
    await page.waitForTimeout(150);
    const png = PNG.sync.read(await stage.screenshot({ path: path.join(output, `frame-${time.toFixed(2)}.png`) })); frames.push(png);
    let yellow = 0, pixels = 0; const rgb = [0, 0, 0];
    // The top 60% excludes the following dialogue box and inspects the actual stage.
    for (let y = 3; y < png.height * .6; y++) for (let x = 3; x < png.width - 3; x++) {
      const i = (y * png.width + x) * 4, [r, g, b] = png.data.subarray(i, i + 3);
      if (Math.abs(r - 227) < 8 && Math.abs(g - 223) < 8 && Math.abs(b - 202) < 8) yellow++;
      rgb[0] += r; rgb[1] += g; rgb[2] += b; pixels++;
    }
    samples.push({ time, yellowRatio: yellow / pixels, mean: rgb.map(v => v / pixels), backgroundOpacity: await page.locator('.preview-performance-transition [aria-label="事件演出画面"] .text-stage-shake').first().getAttribute('style', { timeout: 100 }).catch(() => null) });
  }
  const sheet = new PNG({ width: frames[0].width * frames.length, height: frames[0].height });
  frames.forEach((png, i) => PNG.bitblt(png, sheet, 0, 0, png.width, png.height, i * png.width, 0));
  await fs.writeFile(path.join(output, 'contact-sheet.png'), PNG.sync.write(sheet));
  if (!baseline) {
    for (const sample of samples) expect(sample.yellowRatio).toBeLessThan(.05);
    expect(samples.at(-1)!.mean.some(value => value > 15)).toBe(true);
    const next = page.locator('.preview-performance-transition [aria-label="事件演出画面"] .text-stage-shake').first();
    await expect(next).toHaveCSS('opacity', '1');
  }
  await page.getByRole('button', { name: '停止预览', exact: true }).click();
  await page.getByRole('button', { name: '播放预览', exact: true }).click();
  await expect(page.locator('.story-preview-content')).toHaveAttribute('data-preview-phase', 'finished', { timeout: (end + transition + 12) * 1000 });
  await stage.screenshot({ path: path.join(output, 'played-to-end.png') });
  expect(errors).toEqual([]);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: baseline ? 'baseline' : 'passed', sourceHash: createHash('sha256').update(bytes).digest('hex'), end, transition, samples, errors }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', error: String(error), samples, errors }, null, 2));
  process.exitCode = 1; console.error(error);
} finally {
  console.log(output);
  if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); await app.close().catch(() => undefined); }
}
