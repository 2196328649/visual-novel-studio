import { chromium, expect, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSchema, type Project } from '../src/core/model';
import { expandEffect } from '../src/core/text-script';
import type { StudioBridge } from '../src/core/bridge';

declare global { interface Window { __effectHarness: { snapshot?: () => { project: Project; dirty: boolean }; saved?: Project } } }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'artifacts', 'effect-management-verification', new Date().toISOString().replaceAll(':', '-'));
const checks: string[] = [];
const errors: string[] = [];
const measurements: Record<string, unknown> = {};
await fs.mkdir(output, { recursive: true });
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/runtime/**', '**/release/**'] } } });
await server.listen();
const address = server.httpServer!.address();
if (!address || typeof address === 'string') throw new Error('No browser test port');
const url = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch(process.env.VNS_BROWSER_PATH ? { executablePath: process.env.VNS_BROWSER_PATH, headless: true } : { channel: 'msedge', headless: true });
const sample = projectSchema.parse(JSON.parse(await fs.readFile(path.join(root, 'resources/example/project.vns.json'), 'utf8')));
sample.effects = [
  { id: 'shared', name: '共享演出', commands: [], actions: [{ kind: 'pause', seconds: 0.25 }, { kind: 'camera', x: 0, y: 0, zoom: 1.1, rotation: 0, duration: 1, easing: 'ease', wait: false }] },
  { id: 'nested', name: '嵌套演出', commands: ['效果：共享演出'] },
  { id: 'unused', name: '未使用演出', commands: [], actions: [{ kind: 'shake', direction: 'horizontal' }] },
];
const passages = sample.nodes.filter(node => node.kind === 'passage');
passages[0].lines[0].actions.push({ kind: 'effect', effectId: 'shared' });
passages[1].lines[0].actions.push({ kind: 'effect', effectId: 'shared' });
let page: Page | undefined;
async function editor(project: Project) {
  const current = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  current.on('pageerror', error => errors.push(error.message));
  current.on('dialog', dialog => dialog.accept());
  await current.addInitScript((initial: Project) => {
    Object.defineProperty(window, '__name', { value: new Function('target', 'return target'), configurable: true });
    window.__effectHarness = {};
    const bridge: StudioBridge = {
      create: async () => ({ project: structuredClone(initial), path: null, recovered: false }),
      getInitial: async () => ({ project: structuredClone(initial), path: 'test/project.vns.json', recovered: false }),
      open: async () => null,
      save: async project => { window.__effectHarness.saved = structuredClone(project); return { project, path: 'test/project.vns.json', recovered: false }; },
      autosave: async () => ({ savedAt: Date.now() }),
      importAssets: async () => null,
      importText: async () => null,
      preview: async () => ({ ok: true, diagnostics: [], log: '' }),
      exportGame: async () => null,
      checkExport: async project => ({ platform: project.exportSettings?.platform ?? 'windows', ready: true, checks: [], diagnostics: [] }),
      assetUrl: assetPath => `/resources/example/${assetPath}`,
      environment: async () => ({ sdkPath: null, appVersion: 'effects-test' }),
      onRuntimeEvent: () => () => undefined,
      onCloseRequested: snapshot => { window.__effectHarness.snapshot = snapshot; return () => { window.__effectHarness.snapshot = undefined; }; },
    };
    window.studio = bridge;
  }, project);
  await current.goto(url);
  await expect(current.locator('.project-title strong')).toHaveText(project.name);
  await current.waitForFunction(() => !!window.__effectHarness.snapshot);
  return current;
}
const snapshot = (current: Page) => current.evaluate(() => window.__effectHarness.snapshot!().project);
const manager = (current: Page) => current.getByRole('dialog', { name: '管理效果', exact: true });
async function open(current: Page) { await current.getByRole('button', { name: '管理效果', exact: true }).click(); await expect(manager(current)).toBeVisible(); }
async function layout(current: Page, width: number, height: number) {
  await current.setViewportSize({ width, height });
  const box = await manager(current).boundingBox();
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height);
  assert.equal(await current.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await expect(manager(current).getByRole('button', { name: '保存修改', exact: true })).toBeInViewport();
  measurements[`${width}x${height}`] = box;
  await current.screenshot({ path: path.join(output, `effects-${width}.png`) });
}

try {
  page = await editor(sample);
  await open(page);
  const dialog = manager(page);
  await expect(dialog.getByLabel('效果名称', { exact: true })).toHaveValue('共享演出');
  await expect(dialog.getByRole('button', { name: '删除效果', exact: true })).toBeDisabled();
  await expect(dialog.locator('.effect-manager-references li')).toHaveCount(3);
  await dialog.getByLabel('效果名称', { exact: true }).fill('未使用演出');
  await expect(dialog.getByRole('alert')).toHaveText('效果名称已存在。');
  await expect(dialog.getByRole('button', { name: '保存修改', exact: true })).toBeDisabled();
  await dialog.getByLabel('效果名称', { exact: true }).fill('共享镜头');
  await dialog.getByLabel('等待 秒', { exact: true }).fill('1.75');
  await dialog.locator('.action-editor').nth(0).getByRole('button', { name: '效果动作下移', exact: true }).click();
  await dialog.getByLabel('添加效果动作', { exact: true }).selectOption('shake');
  await dialog.getByLabel('震动方向', { exact: true }).selectOption('vertical');
  await layout(page, 1280, 720);
  await layout(page, 1920, 1080);
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  let changed = await snapshot(page);
  const shared = changed.effects.find(effect => effect.id === 'shared')!;
  assert.equal(shared.name, '共享镜头');
  assert.deepEqual(shared.actions?.map(action => action.kind), ['camera', 'pause', 'shake']);
  assert.deepEqual(shared.actions?.[1], { kind: 'pause', seconds: 1.75 });
  assert.deepEqual(shared.actions?.[2], { kind: 'shake', direction: 'vertical' });
  assert.deepEqual(changed.effects.find(effect => effect.id === 'nested')!.commands, ['@效果：共享镜头【shared】']);
  for (const nodeId of passages.slice(0, 2).map(node => node.id)) {
    const node = changed.nodes.find(node => node.id === nodeId);
    assert.ok(node?.kind === 'passage' && node.lines[0].actions.some(action => action.kind === 'effect' && action.effectId === 'shared'));
  }
  assert.deepEqual(expandEffect(changed, 'nested'), shared.actions);
  checks.push('中文重命名、动作字段编辑、顺序和新增动作生效；两处剧情调用及另一效果的中文调用保持有效。');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.deepEqual((await snapshot(page)).effects, sample.effects);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  assert.equal((await snapshot(page)).effects.find(effect => effect.id === 'shared')!.name, '共享镜头');
  checks.push('共享效果修改作为单次操作支持撤销和重做。');
  await open(page);
  await dialog.getByLabel('添加效果动作', { exact: true }).selectOption('effect');
  const nestedSelect = dialog.getByLabel('效果实例', { exact: true });
  await expect(nestedSelect.locator('option[value="shared"]')).toHaveCount(0);
  await expect(nestedSelect.locator('option[value="nested"]')).toHaveCount(0);
  await expect(nestedSelect.locator('option[value="unused"]')).toHaveCount(1);
  await dialog.getByRole('button', { name: '关闭效果管理', exact: true }).click();
  assert.equal((await snapshot(page)).effects.find(effect => effect.id === 'shared')!.actions!.length, 3);
  checks.push('效果选择排除自身与会导致间接循环的目标；取消编辑不写入工程。');
  await open(page);
  await dialog.getByLabel('选择效果', { exact: true }).selectOption('unused');
  await expect(dialog.getByRole('button', { name: '删除效果', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '删除效果', exact: true }).click();
  assert.ok(!(await snapshot(page)).effects.some(effect => effect.id === 'unused'));
  await dialog.getByRole('button', { name: '新建效果', exact: true }).click();
  await dialog.getByLabel('效果名称', { exact: true }).fill('等待后继续');
  await dialog.getByLabel('添加效果动作', { exact: true }).selectOption('pause');
  await dialog.getByLabel('等待 秒', { exact: true }).fill('3');
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  changed = await snapshot(page);
  assert.deepEqual(changed.effects.find(effect => effect.name === '等待后继续')!.actions, [{ kind: 'pause', seconds: 3 }]);
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect.poll(() => page!.evaluate(() => !!window.__effectHarness.saved)).toBe(true);
  assert.deepEqual(projectSchema.parse(await page.evaluate(() => window.__effectHarness.saved)), changed);
  checks.push('未被调用的效果可删除；通过管理窗口新建效果并随工程保存。');
  await open(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: '管理效果', exact: true })).toBeFocused();
  checks.push('1280×720 与 1920×1080 下窗口及固定操作栏可见；关闭后焦点返回入口。');
  const invalid = structuredClone(sample);
  invalid.effects.unshift({ id: 'broken', name: '待修复效果', commands: ['未知动作：内容'] });
  await page.close();
  page = await editor(invalid);
  await open(page);
  await expect(manager(page).getByRole('alert')).toContainText('无法识别');
  await manager(page).getByLabel('原始指令', { exact: true }).fill('等待：2');
  await expect(manager(page).getByLabel('等待 秒', { exact: true })).toHaveValue('2');
  await manager(page).getByRole('button', { name: '保存修改', exact: true }).click();
  assert.deepEqual((await snapshot(page)).effects.find(effect => effect.id === 'broken')!.actions, [{ kind: 'pause', seconds: 2 }]);
  checks.push('文本定义的无法识别动作保留原文并可修正，不会被静默丢弃。');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, checks, errors, measurements, note: 'Headless browser UI with an isolated bridge; no RenPy graphical test is launched.' }, null, 2));
  console.log(JSON.stringify({ passed: true, output, checks, measurements }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: false, checks, errors, failure: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); await server.close(); }
