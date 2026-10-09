import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { assetFiles } from '../src/core/model';
import { parseProject, assetSourcePath } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), argument = process.argv.indexOf('--project');
const originalFile = path.resolve(argument < 0 ? 'resources/templates/aihong/project.vns.json' : process.argv[argument + 1]);
const baseline = process.argv.includes('--baseline');
const output = path.join(root, 'artifacts/text-click', new Date().toISOString().replaceAll(':', '-') + (baseline ? '-baseline' : ''));
const bytes = await fs.readFile(originalFile), raw = JSON.parse(bytes.toString());
const project = parseProject(raw.project ?? raw).project;
for (const asset of project.assets) {
  asset.externalFiles = Object.fromEntries(assetFiles(asset).map(file => [file, assetSourcePath(path.dirname(originalFile), asset, file)]));
  asset.externalPath = asset.externalFiles[asset.path];
}
project.playerDefaults = { ...project.playerDefaults, masterVolume: 0 };
const projectFile = path.join(output, 'project/project.vns.json');
await fs.mkdir(path.dirname(projectFile), { recursive: true });
await fs.writeFile(projectFile, JSON.stringify(project));
const metrics: any[] = [], errors: string[] = [];
let app: ElectronApplication | undefined, page: Page | undefined;
try {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile'), timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', e => errors.push(e.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 30000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 960));
  await openStoryMode(page, 'text');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const input = page.getByLabel('中文文本剧本', { exact: true });
  const toggle = page.getByRole('button', { name: /^(隐藏演出|显示演出)$/ });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  const originalText = await input.inputValue();
  for (const hidden of [false, true]) {
    if (await toggle.getAttribute('aria-pressed') !== String(hidden)) await toggle.click();
    for (const suspended of [false, true]) {
      const suspend = page.locator('.preview-suspend-toggle');
      if (await suspend.getAttribute('aria-pressed') !== String(suspended)) await suspend.click();
      const mode = `${hidden ? 'hidden' : 'visible'}-${suspended ? 'paused' : 'live'}`;
      await input.evaluate(element => {
        const state = window as any;
        state.clickMetrics = { frames: [], longTasks: [] };
        state.clickListener = () => {
          const start = performance.now();
          state.clickDone = new Promise<number>(resolve => {
            state.clickFrame = () => {
              if (state.expectedClickText === undefined || document.querySelector('.ui-dialogue-preview')?.textContent?.includes(state.expectedClickText)) {
                // Read the new dialogue on a frame, then yield for its paint.
                setTimeout(() => resolve(performance.now() - start), 0);
              } else if (performance.now() - start > 15000) resolve(15000);
              else requestAnimationFrame(state.clickFrame);
            };
            requestAnimationFrame(state.clickFrame);
          });
          requestAnimationFrame(() => state.clickMetrics.frames.push(performance.now() - start));
        };
        element.addEventListener('pointerdown', state.clickListener, true);
        state.clickObserver = new PerformanceObserver(list => state.clickMetrics.longTasks.push(...list.getEntries().map(e => e.duration)));
        state.clickObserver.observe({ entryTypes: ['longtask'] });
      });
      await cdp.send('Profiler.start');
      const samples = [];
      // Every click selects a different dialogue, including cold jumps and adjacent late lines.
      for (const fraction of [0, .5, .95, .96, .97, .98, .99, .1, .94, .93]) {
        const target = await input.evaluate((element, fraction) => {
          const t = element as HTMLTextAreaElement;
          const lines = [...t.value.matchAll(/^[^\n#@/]{1,40}[:：][^\n]{12,}$/gm)];
          const match = lines[Math.floor((lines.length - 1) * fraction)];
          if (!match) throw Error('No dialogue in fixture');
          const row = t.value.slice(0, match.index).split('\n').length - 1;
          t.scrollTop = Math.max(0, 14 + row * 22 - t.clientHeight / 2); t.scrollLeft = 0;
          t.dispatchEvent(new Event('scroll', { bubbles: true }));
          const rect = t.getBoundingClientRect();
          return { x: rect.left + 100, y: rect.top + 14 + row * 22 - t.scrollTop + 11, text: match[0].replace(/^[^:：]*[:：]/, '').trim(), row };
        }, fraction);
        await page.waitForTimeout(80);
        await page.evaluate(text => { (window as any).expectedClickText = text; }, suspended ? undefined : target.text.slice(0, 16));
        const start = performance.now();
        await page.mouse.click(target.x, target.y);
        const clickToPreviewMs = await page.evaluate(() => (window as any).clickDone as Promise<number>);
        if (!suspended) await expect(page.locator('.ui-dialogue-preview')).toContainText(target.text.slice(0, 16), { timeout: 15000 });
        samples.push({ fraction, row: target.row, clickToPreviewMs, driverRoundTripMs: performance.now() - start });
      }
      await page.waitForTimeout(100);
      const { profile } = await cdp.send('Profiler.stop');
      await fs.writeFile(path.join(output, mode + '.cpuprofile'), JSON.stringify(profile));
      const events = await input.evaluate(element => {
        const state = window as any; element.removeEventListener('pointerdown', state.clickListener, true); state.clickObserver.disconnect(); return state.clickMetrics;
      });
      metrics.push({ mode, samples, events });
      console.log(JSON.stringify(metrics.at(-1)));
      if (!baseline) expect(Math.max(...samples.map(s => s.clickToPreviewMs))).toBeLessThan(250);
    }
  }
  expect(errors).toEqual([]);
  if (await toggle.getAttribute('aria-pressed') === 'true') await toggle.click();
  expect(await input.inputValue()).toBe(originalText);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: baseline ? 'baseline' : 'passed', sourceHash: createHash('sha256').update(bytes).digest('hex'), metrics, errors }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', error: String(error), metrics, errors }, null, 2));
  process.exitCode = 1; console.error(error);
} finally {
  console.log(output);
  if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); await app.close().catch(() => undefined); }
}
