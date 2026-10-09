import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { assetFiles, type Project } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { assetSourcePath, parseProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.');
const projectArgument = process.argv.indexOf('--project');
const originalFile = path.resolve(projectArgument >= 0 ? process.argv[projectArgument + 1] : 'resources/templates/aihong/project.vns.json');
const baseline = process.argv.includes('--baseline');
const output = path.join(root, 'artifacts/text-responsiveness', new Date().toISOString().replaceAll(':', '-') + (baseline ? '-baseline' : ''));
const projectFile = path.join(output, 'project/project.vns.json');
const originalBytes = await fs.readFile(originalFile);
const originalHash = createHash('sha256').update(originalBytes).digest('hex');
const project = parseProject(JSON.parse(originalBytes.toString('utf8'))).project;
for (const asset of project.assets) {
  const files = Object.fromEntries(assetFiles(asset).map(relative => [relative, assetSourcePath(path.dirname(originalFile), asset, relative)]));
  asset.externalFiles = files;
  asset.externalPath = files[asset.path];
}
project.playerDefaults = { ...project.playerDefaults, masterVolume: 0 };
project.scriptText ??= { format: 'vns-text-1', content: projectToText(project) };
await fs.mkdir(path.dirname(projectFile), { recursive: true });
await fs.writeFile(projectFile, JSON.stringify(project));
const checks: string[] = [], errors: string[] = [];
const metrics: Record<string, unknown> = {
  renderer: 'compiled', sourceCharacters: project.scriptText.content.length,
  dialogueLines: project.nodes.reduce((count, node) => count + (node.kind === 'passage' ? node.lines.length : 0), 0),
  assets: project.assets.length, blueprints: project.blueprints.length,
};
let app: ElectronApplication | undefined, page: Page | undefined;
let phase = 'launch';
const summarize = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))], maxMs: sorted.at(-1) };
};

try {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile'), timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 30000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 960));
  await openStoryMode(page, 'text');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const input = page.getByLabel('中文文本剧本', { exact: true });
  const toggle = page.getByRole('button', { name: /^(隐藏演出|显示演出)$/ });
  const typed = 'abcdefghijklmnopqrstuvwx';
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  for (const hidden of [false, true]) {
    phase = hidden ? 'hidden performances' : 'visible performances';
    if (await toggle.getAttribute('aria-pressed') !== String(hidden)) await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', String(hidden));
    const before = await input.inputValue();
    const position = await input.evaluate(element => {
      const text = element as HTMLTextAreaElement;
      const candidates = [...text.value.matchAll(/^[^\n#@/]{1,40}[:：][^\n]{12,}$/gm)];
      const line = candidates[Math.floor((candidates.length - 1) * .95)];
      if (!line) throw new Error('No dialogue line in fixture');
      const at = line.index! + line[0].length;
      text.focus(); text.setSelectionRange(at, at);
      text.scrollTop = Math.max(0, (text.value.slice(0, at).split('\n').length - 8) * 22);
      text.dispatchEvent(new Event('scroll', { bubbles: true }));
      return at;
    });
    await input.press('ArrowLeft'); await input.press('ArrowRight');
    await page.waitForTimeout(500);
    await input.evaluate(element => {
      const state = window as any;
      state.textInputMetrics = { frames: [], paints: [], cloneMs: [], longTasks: [] };
      state.textOriginalClone = window.structuredClone;
      state.structuredClone = function (...args: unknown[]) {
        const started = performance.now();
        try { return state.textOriginalClone(...args); }
        finally { state.textInputMetrics.cloneMs.push(performance.now() - started); }
      };
      state.textInputListener = () => {
        const started = performance.now();
        requestAnimationFrame(() => {
          state.textInputMetrics.frames.push(performance.now() - started);
          setTimeout(() => state.textInputMetrics.paints.push(performance.now() - started), 0);
        });
      };
      element.addEventListener('input', state.textInputListener, true);
      state.textObserver = new PerformanceObserver(list => state.textInputMetrics.longTasks.push(...list.getEntries().map(entry => entry.duration)));
      state.textObserver.observe({ entryTypes: ['longtask'] });
    });
    await cdp.send('Profiler.start');
    await input.pressSequentially(typed, { delay: 30 });
    await page.waitForTimeout(600);
    const { profile } = await cdp.send('Profiler.stop');
    const mode = hidden ? 'hidden' : 'visible';
    await fs.writeFile(path.join(output, mode + '.cpuprofile'), JSON.stringify(profile));
    const samples = await input.evaluate(element => {
      const state = window as any;
      element.removeEventListener('input', state.textInputListener, true);
      state.textObserver.disconnect(); window.structuredClone = state.textOriginalClone;
      return state.textInputMetrics as { frames: number[]; paints: number[]; cloneMs: number[]; longTasks: number[] };
    });
    metrics[mode] = { inputToFrame: summarize(samples.frames), inputToPaint: summarize(samples.paints), clone: summarize(samples.cloneMs), longTasks: samples.longTasks };
    const weights = new Map<number, number>();
    for (const [index, id] of (profile.samples ?? []).entries()) weights.set(id, (weights.get(id) ?? 0) + (profile.timeDeltas?.[index] ?? 0));
    const hottest = profile.nodes.map(node => ({ function: node.callFrame.functionName, url: node.callFrame.url, line: node.callFrame.lineNumber + 1, ms: (weights.get(node.id) ?? 0) / 1000 })).sort((a, b) => b.ms - a.ms).slice(0, 30);
    await fs.writeFile(path.join(output, mode + '-hot-functions.json'), JSON.stringify(hottest, null, 2));
    expect(samples.frames.length).toBe(typed.length);
    const edited = before.slice(0, position) + typed + before.slice(position);
    await expect(input).toHaveValue(edited);
    await input.press('Control+z'); await expect(input).toHaveValue(before);
    await input.press('Control+Shift+z'); await expect(input).toHaveValue(edited);
    await page.screenshot({ path: path.join(output, mode + '.png') });
    await input.press('Control+z'); await expect(input).toHaveValue(before);
    checks.push(`${mode}: 24 real keystrokes near the bottom of the chapter; input, single-step undo and redo preserve the document.`);
    if (!baseline) {
      expect(summarize(samples.frames).p95Ms).toBeLessThan(100);
      expect(summarize(samples.frames).maxMs).toBeLessThan(200);
      expect(samples.longTasks.length).toBeLessThan(typed.length / 4);
    }
    console.log(JSON.stringify({ mode, metrics: metrics[mode] }));
  }
  phase = 'newlines with hidden performances';
  const beforeNewline = await input.inputValue();
  const insertion = '\n旁白：换行后的即时输入验证。';
  const insertAt = await input.evaluate(element => {
    const text = element as HTMLTextAreaElement;
    const line = [...text.value.matchAll(/^[^\n#@/]{1,40}[:：][^\n]{12,}$/gm)][0];
    if (!line) throw new Error('No dialogue for newline verification');
    const at = line.index! + line[0].length;
    text.focus(); text.setSelectionRange(at, at);
    return at;
  });
  await input.press('ArrowLeft'); await input.press('ArrowRight');
  await input.press('Enter');
  await page.keyboard.insertText(insertion.slice(1));
  await expect(input).toHaveValue(beforeNewline.slice(0, insertAt) + insertion + beforeNewline.slice(insertAt));
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const withNewline = parseProject(JSON.parse(await fs.readFile(projectFile, 'utf8'))).project;
  const originalLines = applyTextScript(project, project.scriptText.content).project.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []);
  const insertedLines = applyTextScript(withNewline, withNewline.scriptText!.content).project.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []);
  expect(insertedLines.some(line => line.text === '换行后的即时输入验证。')).toBe(true);
  for (const line of originalLines) {
    const retained = insertedLines.find(item => item.id === line.id);
    expect(retained?.text).toBe(line.text);
    expect(retained?.actions).toEqual(line.actions);
    expect(retained?.voiceId).toBe(line.voiceId);
  }
  checks.push('Immediate newline and Chinese input in hidden-performance mode retain every original dialogue ID, action, and voice.');
  // Restoring this deliberately inserted line is one local test edit, separate from typing metrics.
  await input.fill(beforeNewline);
  phase = 'save and reopen';
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const saved = parseProject(JSON.parse(await fs.readFile(projectFile, 'utf8'))).project;
  const beforeParse = applyTextScript(project, project.scriptText.content);
  const afterParse = applyTextScript(saved, saved.scriptText!.content);
  const dialogue = (candidate: Project) => candidate.nodes.flatMap(node => node.kind === 'passage' ? node.lines.map(line => ({ id: line.id, text: line.text, actions: line.actions, voiceId: line.voiceId, playback: line.playback })) : []);
  expect(dialogue(afterParse.project)).toEqual(dialogue(beforeParse.project));
  const visible = await input.inputValue();
  await page.reload(); await openStoryMode(page, 'text');
  await expect(input).toHaveValue(visible);
  expect(createHash('sha256').update(await fs.readFile(originalFile)).digest('hex')).toBe(originalHash);
  expect(errors).toEqual([]);
  checks.push('Saving and reopening preserve every dialogue ID, performance, voice, and playback setting; original project SHA-256 is unchanged.');
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: baseline ? 'baseline' : 'passed', phase, metrics, checks, errors }, null, 2));
  console.log(output);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, metrics, checks, errors, error: String(error) }, null, 2));
  console.error(String(error)); console.log(output); process.exitCode = 1;
} finally {
  if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); await app.close().catch(() => undefined); }
}
