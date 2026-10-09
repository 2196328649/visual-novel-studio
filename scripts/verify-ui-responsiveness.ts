import { _electron as electron, expect, type ElectronApplication, type Page, type Locator } from '@playwright/test';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { effectiveUiComponents, type Project } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';
import { installedExecutable, launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.'), require = createRequire(import.meta.url);
const output = path.join(root, 'artifacts/ui-responsiveness', new Date().toISOString().replaceAll(':', '-'));
const directory = path.join(output, 'project'), projectFile = path.join(directory, 'project.vns.json');
const template = path.join(root, 'resources/templates/aihong');
const project = JSON.parse(await fs.readFile(path.join(template, 'project.vns.json'), 'utf8')) as Project;
project.name = '完整哀鸿模板界面输入验证';
project.playerDefaults = { ...project.playerDefaults, masterVolume: 0 };
for (const asset of project.assets) {
  const file = path.join(directory, asset.path);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.copyFile(path.join(template, asset.path), file);
}
await saveProject(projectFile, project);
const component = effectiveUiComponents(project.ui).find(component => component.page === 'preferences' && component.kind === 'text' && !component.binding)!;
const server = !installedExecutable && process.argv.includes('--hot') ? await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } }) : undefined;
await server?.listen();
const env = Object.fromEntries(Object.entries({ ...process.env, VNS_PROJECT_PATH: projectFile, VNS_USER_DATA: path.join(output, 'profile') }).filter((entry): entry is [string, string] => entry[1] !== undefined));
if (server) env.VNS_DEV_URL = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
else delete env.VNS_DEV_URL;
delete env.ELECTRON_RUN_AS_NODE;
const metrics: Record<string, unknown> = { assets: project.assets.length, components: project.ui.components.length, renderer: server ? 'hot' : 'compiled' };
const errors: string[] = [];
let app: ElectronApplication | undefined, page: Page | undefined;
try {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile'), devUrl: env.VNS_DEV_URL });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 30000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1520, 980));
  await page.locator('.view-tabs').getByRole('button', { name: '界面', exact: true }).click();
  await page.getByLabel('设计页面', { exact: true }).selectOption({ label: '设置' });
  await page.locator('[data-hierarchy-id="' + component.id + '"]').click();
  const name = page.locator('.inspector input[aria-label="控件显示名称"]');
  const text = page.locator('.inspector').getByLabel('文字', { exact: true });
  await expect(text).toHaveValue(component.text);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(500);
  const cdp = await page.context().newCDPSession(page);
  if (process.argv.includes('--profile')) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
  const measure = async (field: Locator, key: string) => {
    await field.evaluate(element => {
      (window as any).__inputFrames = [];
      element.addEventListener('input', () => {
        const started = performance.now();
        requestAnimationFrame(() => (window as any).__inputFrames.push(performance.now() - started));
      });
    });
    await field.press('End'); await field.pressSequentially('abcdefghijklmnopqrst', { delay: 30 });
    await page!.waitForTimeout(150);
    const frames: number[] = await page!.evaluate(() => (window as any).__inputFrames);
    frames.sort((a, b) => a - b);
    metrics[key] = { count: frames.length, medianMs: frames[Math.floor(frames.length / 2)], p95Ms: frames[Math.floor(frames.length * .95)], maxMs: frames.at(-1) };
    expect(frames.length).toBe(20);
    return frames;
  };
  const nameFrames = await measure(name, 'controlName');
  const textFrames = await measure(text, 'displayText');
  if (process.argv.includes('--profile')) {
    const { profile } = await cdp.send('Profiler.stop');
    await fs.writeFile(path.join(output, 'typing.cpuprofile'), JSON.stringify(profile));
    const sampled = new Map<number, number>();
    for (const [index, id] of (profile.samples ?? []).entries()) sampled.set(id, (sampled.get(id) ?? 0) + (profile.timeDeltas?.[index] ?? 0));
    const hottest = profile.nodes.map(node => ({ function: node.callFrame.functionName, url: node.callFrame.url, line: node.callFrame.lineNumber + 1, ms: (sampled.get(node.id) ?? 0) / 1000 })).sort((a, b) => b.ms - a.ms).slice(0, 25);
    await fs.writeFile(path.join(output, 'hot-functions.json'), JSON.stringify(hottest, null, 2));
  }
  // Real keystrokes update the canvas and remain a single reversible typing edit.
  await expect(text).toHaveValue(component.text + 'abcdefghijklmnopqrst');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(text).toHaveValue(component.text);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(text).toHaveValue(component.text + 'abcdefghijklmnopqrst');
  await text.fill('即时预览验证');
  await expect(page.locator('[data-component-id="' + component.id + '"]')).toContainText('即时预览验证');
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const saved = JSON.parse(await fs.readFile(projectFile, 'utf8')) as Project;
  expect(effectiveUiComponents(saved.ui).find(item => item.id === component.id)?.text).toBe('即时预览验证');
  await page.screenshot({ path: path.join(output, 'ui-typing.png') });
  expect(errors).toEqual([]);
  if (!process.argv.includes('--baseline')) for (const frames of [nameFrames, textFrames]) {
    expect(frames[Math.floor(frames.length * .95)]).toBeLessThan(100);
    expect(frames.at(-1)).toBeLessThan(200);
  }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: process.argv.includes('--baseline') ? 'baseline' : 'passed', metrics, errors, installedExecutable, packaged: !!installedExecutable }, null, 2));
  console.log(JSON.stringify(metrics) + '\n' + output);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', metrics, errors, error: String(error), installedExecutable, packaged: !!installedExecutable }, null, 2));
  console.error(String(error)); console.log(output); process.exitCode = 1;
} finally { await app?.close(); await server?.close(); }
