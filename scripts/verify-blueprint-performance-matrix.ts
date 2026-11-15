import assert from 'node:assert/strict';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createBlueprintPerformanceFixture, blueprintPerformanceSizes } from './lib/blueprint-performance-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { saveProject } from '../src/desktop/project-store';
import { projectSchema } from '../src/core/model';

if (process.env.VNS_INSTALLED_EXE) throw new Error('This comparison uses isolated development fixtures, never the installed application.');
const root = path.resolve('.'), output = path.resolve('artifacts/blueprint-performance-matrix', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const report: { status: string; scope: string; runs: unknown[]; errors: string[]; error?: string } = { status: 'running', scope: 'Same current application and deterministic fixture; baseline replaces only the pre-PERF-01 view cache. Measurements are not release-to-release speed claims.', runs: [], errors: [] };
const summarize = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return { samples: values.length, medianMs: sorted[Math.floor(sorted.length / 2)] ?? 0, p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] ?? 0, maximumMs: sorted.at(-1) ?? 0 }; };
const frames = (page: Page) => page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
try {
  for (const size of blueprintPerformanceSizes) {
    const fixture = createBlueprintPerformanceFixture(size);
    for (const mode of (size === 200 ? ['optimized', 'baseline'] : ['baseline', 'optimized'])) {
      const runDir = path.join(output, size + '-' + mode), projectFile = path.join(runDir, 'project/project.vns.json');
      const f = structuredClone(fixture), fixtureHash = createHash('sha256').update(JSON.stringify(f.project)).digest('hex');
      await fs.mkdir(path.dirname(projectFile), { recursive: true });
      let server: ViteDevServer | undefined, app: ElectronApplication | undefined, exited = true;
      try {
        await saveProject(projectFile, f.project);
        server = await createServer({ root, plugins: mode === 'baseline' ? [{ name: 'verification-only-blueprint-baseline', enforce: 'pre', resolveId(source, importer) {
        if (source === './blueprint-view' && importer?.replaceAll('\\', '/').includes('/src/renderer/')) return path.join(root, 'scripts/lib/blueprint-performance-baseline.ts');
      } }] : [], server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/work/**', '**/resources/**', '**/release/**'] } } });
        await server.listen();
        app = await launchDesktopFixture({ root, profile: path.join(runDir, 'profile'), projectFile, devUrl: 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port }); exited = false;
        const page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => report.errors.push(size + '/' + mode + ': ' + error.message));
        await expect(page.locator('.project-title strong')).toHaveText(f.project.name, { timeout: 45000 });
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1832, 1000));
        await page.locator('[data-workspace-tab="blueprint"]').click(); await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + f.graph.id);
        await expect(page.locator('.generic-blueprint-workspace .react-flow__node')).toHaveCount(size);
        const properties = page.locator('.blueprint-properties');
        if (!await properties.isVisible()) await page.getByRole('button', { name: '展开蓝图属性', exact: true }).click();
        await properties.getByRole('button', { name: '节点参数', exact: true }).click();
        await page.getByRole('button', { name: '框选全部节点', exact: true }).focus(); await page.keyboard.press('Escape');
        await page.locator('.blueprint-node-outline').getByRole('button', { name: f.editable.name, exact: true }).click();
        await expect.poll(() => page.evaluate(async () => {
          const element = document.querySelector('.generic-blueprint-workspace .react-flow__viewport'); if (!element) return false;
          const matrix = getComputedStyle(element).transform;
          for (let frame = 0; frame < 8; frame++) { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); if (getComputedStyle(element).transform !== matrix) return false; }
          return true;
        })).toBe(true);
        await page.evaluate('(() => { window.__vnsMatrix = { active: false, frames: [], tasks: [], last: 0 }; new PerformanceObserver(list => { if (window.__vnsMatrix.active) for (const item of list.getEntries()) window.__vnsMatrix.tasks.push(item.duration); }).observe({ type: "longtask" }); const tick = now => { const p = window.__vnsMatrix; if (p.active && p.last) p.frames.push(now - p.last); p.last = now; requestAnimationFrame(tick); }; requestAnimationFrame(tick); })()');
        const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable'); await cdp.send('Profiler.enable');
        const beforeMemory = await cdp.send('Performance.getMetrics'), beforeDom = await cdp.send('Memory.getDOMCounters');
        const phases: Record<string, unknown> = {};
        const measure = async (name: string, actions: (() => Promise<void>)[]) => {
          await frames(page); await page.evaluate('Object.assign(window.__vnsMatrix, { active: true, frames: [], tasks: [], last: 0 })'); await cdp.send('Profiler.start');
          const samples: number[] = [];
          for (const action of actions) { const start = performance.now(); await action(); await frames(page); samples.push(performance.now() - start); }
          await page.evaluate('new Promise(resolve => setTimeout(resolve, 0))');
          const observed = await page.evaluate('(() => { const p = window.__vnsMatrix; p.active = false; return { frames: p.frames, tasks: p.tasks }; })()') as { frames: number[]; tasks: number[] };
          const { profile } = await cdp.send('Profiler.stop'); await fs.writeFile(path.join(runDir, name + '.cpuprofile'), JSON.stringify(profile));
          phases[name] = { endToEnd: summarize(samples), frames: summarize(observed.frames), longTasks: { count: observed.tasks.length, totalMs: observed.tasks.reduce((a, b) => a + b, 0), ...summarize(observed.tasks) } };
        };
        const card = (id: string) => page.locator('.react-flow__node[data-id="' + id + '"]');
        const number = card(f.editable.id).getByLabel(f.editable.name + ' · ' + f.editable.pins.find(pin => pin.id === 'a')!.name, { exact: true });
        await measure('input', ['1', '12', '123', '-2.75', '0', '18.5', '4', '12.75'].map(value => async () => { await number.fill(value); await number.press('Tab'); await expect(number).toHaveValue(value); }));
        await measure('drag', Array.from({ length: 4 }, (_, index) => async () => {
          const box = await card(f.editable.id).locator('.graph-node-title').boundingBox(); assert.ok(box);
          await page.mouse.move(box.x + box.width / 2, box.y + Math.min(10, box.height / 2)); await page.mouse.down();
          await page.mouse.move(box.x + box.width / 2 + (index % 2 ? -24 : 48), box.y + 20, { steps: 8 }); await page.mouse.up();
        }));
        await measure('connection', Array.from({ length: 4 }, () => async () => {
          await card(f.source.id).locator('.react-flow__handle[data-handleid="value"]').click(); await card(f.target.id).locator('.react-flow__handle[data-handleid="a"]').click();
          await expect(card(f.target.id).locator('.blueprint-pin-source')).toBeVisible();
          await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(card(f.target.id).locator('.blueprint-pin-source')).toHaveCount(0);
        }));
        await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
        const saved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))), edited = saved.blueprints.find(graph => graph.id === f.graph.id)!;
        assert.equal(edited.nodes.find(node => node.id === f.editable.id)!.properties.a, 12.75); assert.notEqual(edited.nodes.find(node => node.id === f.editable.id)!.x, f.editable.x);
        assert.deepEqual(edited.links, f.graph.links); assert.deepEqual(saved.blueprints.find(graph => graph.id === f.other.id), f.other);
        const afterMemory = await cdp.send('Performance.getMetrics'), afterDom = await cdp.send('Memory.getDOMCounters');
        await page.screenshot({ path: path.join(runDir, 'editor.png') });
        report.runs.push({ mode, nodes: size, links: f.graph.links.length, fixtureSha256: fixtureHash, phases, memory: { before: beforeMemory, after: afterMemory }, dom: { before: beforeDom, after: afterDom } });
        await cdp.detach();
      } finally {
        if (app) { const child = app.process(); await app.close(); exited = child.exitCode !== null || child.signalCode !== null; if (!exited && child.pid) { try { process.kill(child.pid, 0); } catch { exited = true; } } }
        await server?.close();
        if (exited) { const cleanup = await cleanVerificationDirectories(runDir, ['project', 'profile']); assert.deepEqual(cleanup.errors, []); }
        else throw new Error('Fixture Electron process is still alive; temporary directories retained: ' + runDir);
      }
      await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    }
  }
  assert.deepEqual(report.errors, []); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); console.error(error); process.exitCode = 1; }
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
