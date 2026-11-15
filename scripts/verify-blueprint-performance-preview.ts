import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { previewUiLogic } from '../src/core/ui-logic-preview';
import { saveProject } from '../src/desktop/project-store';
import { blueprintPerformanceSizes, createBlueprintExecutionPerformanceFixture } from './lib/blueprint-performance-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openUiPreviewWindow, showUiPreviewTestData } from './lib/ui-preview-window';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Use the isolated development preview, not an installed editor.');
const root = path.resolve('.'), output = path.resolve('artifacts/blueprint-performance-preview', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const report: { status: string; scope: string; runs: unknown[]; errors: string[]; error?: string } = {
  status: 'running', scope: 'Current preview core and actual independent Electron preview window. The authored fixture SHA matches native execution; browser end-to-end samples include automation and two paint opportunities. No release speedup claim.', runs: [], errors: [],
};
const warmups = 5, sampleCount = 25;
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: values.length, medianMs: sorted[Math.floor(sorted.length / 2)] ?? 0, p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] ?? 0, maximumMs: sorted.at(-1) ?? 0 };
};
const frames = (page: Page) => page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
try {
  for (const size of blueprintPerformanceSizes) {
    const f = createBlueprintExecutionPerformanceFixture(size), source = JSON.stringify(f.project), fixtureSha256 = createHash('sha256').update(source).digest('hex');
    const coreSamples: number[] = [];
    for (let index = 0; index < warmups + sampleCount; index++) {
      const started = performance.now();
      const result = previewUiLogic(f.project, f.page.components, f.page.id, {}, [{ kind: 'click', componentId: f.button.id }], { trace: true });
      const elapsed = performance.now() - started;
      assert.equal(result.variables.perf_result, f.expected); assert.equal(result.exhausted, false); assert.equal(result.incomplete, false);
      if (index >= warmups) coreSamples.push(elapsed);
    }
    const runDir = path.join(output, String(size)), projectFile = path.join(runDir, 'project/project.vns.json');
    await fs.mkdir(path.dirname(projectFile), { recursive: true });
    let app: ElectronApplication | undefined, server: ViteDevServer | undefined, exited = true;
    try {
      await saveProject(projectFile, f.project); const savedBytes = await fs.readFile(projectFile, 'utf8');
      server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/work/**', '**/resources/**', '**/release/**'] } } }); await server.listen();
      const address = server.httpServer!.address(); assert.ok(address && typeof address !== 'string');
      app = await launchDesktopFixture({ root, projectFile, profile: path.join(runDir, 'profile'), devUrl: 'http://127.0.0.1:' + address.port }); exited = false;
      const editor = await app.firstWindow(); editor.setDefaultTimeout(30000); editor.on('pageerror', error => report.errors.push('editor/' + size + ': ' + error.message));
      await expect(editor.locator('.project-title strong')).toHaveText(f.project.name, { timeout: 60000 });
      await editor.locator('[data-workspace-tab="ui"]').click(); await editor.getByLabel('设计页面', { exact: true }).selectOption(f.page.id);
      await editor.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click();
      const preview = await openUiPreviewWindow(app, editor); preview.setDefaultTimeout(30000); preview.on('pageerror', error => report.errors.push('preview/' + size + ': ' + error.message));
      await showUiPreviewTestData(preview);
      const value = preview.getByLabel('预演参数 运行结果', { exact: true }), run = preview.getByRole('button', { name: '执行性能图', exact: true });
      const reset = preview.getByRole('button', { name: '恢复测试值', exact: true });
      const sample = async () => {
        await reset.click(); await expect(value).toHaveValue('0'); await frames(preview);
        const started = performance.now(); await run.click(); await expect(value).toHaveValue(String(f.expected)); await frames(preview);
        return performance.now() - started;
      };
      for (let index = 0; index < warmups; index++) await sample();
      await preview.evaluate(`(() => {
        const record = window.__vnsPreviewPerformance = { active: true, frames: [], tasks: [], last: 0 };
        const observer = new PerformanceObserver(list => { if (record.active) record.tasks.push(...list.getEntries().map(entry => entry.duration)); });
        observer.observe({ type: 'longtask', buffered: false });
        const frame = time => { if (!record.active) { observer.disconnect(); return; } if (record.last) record.frames.push(time - record.last); record.last = time; requestAnimationFrame(frame); };
        requestAnimationFrame(frame);
      })()`);
      const cdp = await preview.context().newCDPSession(preview);
      try {
        await cdp.send('Performance.enable'); await cdp.send('Profiler.enable');
        const before = await cdp.send('Performance.getMetrics'), beforeDom = await cdp.send('Memory.getDOMCounters');
        await cdp.send('Profiler.start'); const samples: number[] = [];
        for (let index = 0; index < sampleCount; index++) samples.push(await sample());
        await preview.evaluate('new Promise(resolve => setTimeout(resolve, 0))');
        const observed = await preview.evaluate('(() => { const record = window.__vnsPreviewPerformance; record.active = false; return { frames: record.frames, tasks: record.tasks }; })()') as { frames: number[]; tasks: number[] };
        const { profile } = await cdp.send('Profiler.stop'); await fs.writeFile(path.join(runDir, 'preview.cpuprofile'), JSON.stringify(profile));
        const after = await cdp.send('Performance.getMetrics'), afterDom = await cdp.send('Memory.getDOMCounters');
        report.runs.push({ nodes: size, executedActions: f.expected, fixtureSha256, warmups, core: { ...stats(coreSamples), elapsedMs: coreSamples },
          window: { ...stats(samples), elapsedMs: samples, frameTimes: stats(observed.frames), longTasks: { count: observed.tasks.length, totalMs: observed.tasks.reduce((a, b) => a + b, 0), durationsMs: observed.tasks }, memory: { before, after }, dom: { before: beforeDom, after: afterDom } } });
        await preview.screenshot({ path: path.join(runDir, 'preview.png') });
        assert.equal(await fs.readFile(projectFile, 'utf8'), savedBytes, 'Preview must not write author data.');
        assert.equal(JSON.stringify(f.project), source);
      } finally { await cdp.detach(); }
      await preview.getByRole('button', { name: '关闭预览', exact: true }).click();
    } finally {
      try {
        if (app) { const processHandle = app.process(); await app.close(); exited = processHandle.exitCode !== null || processHandle.signalCode !== null; if (!exited && processHandle.pid) { try { process.kill(processHandle.pid, 0); } catch { exited = true; } } }
      } finally { await server?.close(); }
      if (!exited) throw new Error('Fixture Electron is still alive; retained its isolated files: ' + runDir);
      const cleanup = await cleanVerificationDirectories(runDir, ['project', 'profile']); assert.deepEqual(cleanup.errors, []);
    }
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
  assert.deepEqual(report.errors, []); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); console.error(error); process.exitCode = 1; }
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);