import { openContentFilters } from './lib/ui-disclosures';
import { openStoryMode } from './lib/story-workspace';
import { chromium, expect, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSchema, type Project } from '../src/core/model';
import type { StudioBridge } from '../src/core/bridge';
import { compileProject } from '../src/runtime/compiler';

declare global { interface Window { __workbench: { snapshot?: () => { project: Project; dirty: boolean }; saved?: Project } } }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'artifacts/workbench-verification', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const initial = projectSchema.parse(JSON.parse(await fs.readFile(path.join(root, 'resources/templates/aihong/project.vns.json'), 'utf8')));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } });
await server.listen(); const address = server.httpServer!.address(); if (!address || typeof address === 'string') throw new Error('No test server');
const browser = await chromium.launch(process.env.VNS_BROWSER_PATH ? { executablePath: process.env.VNS_BROWSER_PATH, headless: true } : { channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
const errors: string[] = [], checks: string[] = [];
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => dialog.accept());
await page.addInitScript((initial: Project) => {
  Object.defineProperty(window, '__name', { value: new Function('target', 'return target'), configurable: true });
  const harness: Window['__workbench'] = {}; window.__workbench = harness;
  const bridge: StudioBridge = {
    getInitial: async () => ({ project: JSON.parse(localStorage.getItem('workbench-test-project') ?? JSON.stringify(initial)), path: 'verification/project.vns.json', recovered: false }),
    create: async name => ({ project: { ...initial, name }, path: null, recovered: false }), open: async () => null,
    save: async project => { harness.saved = structuredClone(project); localStorage.setItem('workbench-test-project', JSON.stringify(project)); return { project, path: 'verification/project.vns.json', recovered: false }; },
    autosave: async () => ({ savedAt: Date.now() }), importAssets: async () => null, importText: async () => null,
    preview: async () => ({ ok: true, diagnostics: [], log: '' }), exportGame: async () => null,
    checkExport: async project => ({ platform: project.exportSettings?.platform ?? 'windows', ready: true, checks: [], diagnostics: [] }),
    assetUrl: relative => `/resources/templates/aihong/${relative}`, environment: async () => ({ sdkPath: null, appVersion: 'workbench-test' }),
    onRuntimeEvent: () => () => undefined, onCloseRequested: snapshot => { harness.snapshot = snapshot; return () => undefined; },
  }; window.studio = bridge;
}, initial);
const snapshot = () => page.evaluate(() => window.__workbench.snapshot!().project);
const graph = async () => (await snapshot()).blueprints.find(graph => graph.id === 'ai_bp_caution')!;
const edgeLocator = (id: string) => page.locator(`.react-flow__edge[data-id="${id}"]`);
async function settleCanvas() {
  await page.locator('.generic-blueprint-workspace .react-flow__viewport').evaluate(element => new Promise<void>((resolve, reject) => {
    let previous = '', stable = 0, frames = 0;
    const check = () => {
      const transform = getComputedStyle(element).transform;
      stable = transform === previous ? stable + 1 : 0; previous = transform;
      if (stable >= 5) resolve(); else if (++frames > 180) reject(new Error('Canvas animation did not settle')); else requestAnimationFrame(check);
    }; requestAnimationFrame(check);
  }));
}
async function openGraph(id = 'ai_bp_caution') {
  await page.getByRole('button', { name: '蓝图', exact: true }).click();
  const type = page.getByLabel('蓝图类型'); if (await type.count()) await type.selectOption('graph');
  await page.getByLabel('演出目标').selectOption('graph:' + id);
  await page.getByRole('button', { name: '框选全部节点', exact: true }).click();
  await expect(page.locator('.generic-blueprint-workspace .react-flow__node')).not.toHaveCount(0);
}
async function edgePoint(id: string, offset = 0) {
  await settleCanvas();
  return edgeLocator(id).locator('.react-flow__edge-path').evaluate((element, offset) => {
    const path = element as SVGPathElement;
    const matrix = path.getScreenCTM()!;
    let fallback: { x: number; y: number } | undefined;
    // Use an exposed portion of the actual curve rather than a midpoint that
    // may fall inside a node or the curve's tight inner bend after zooming.
    for (const fraction of [.5, .35, .65, .2, .8, .1, .9]) {
      const distance = path.getTotalLength() * fraction;
      const point = path.getPointAtLength(distance).matrixTransform(matrix);
      const ahead = path.getPointAtLength(distance + 1).matrixTransform(matrix);
      const dx = ahead.x - point.x, dy = ahead.y - point.y, length = Math.hypot(dx, dy) || 1;
      const at = { x: point.x - dy / length * offset, y: point.y + dx / length * offset };
      fallback ??= at;
      if (document.elementFromPoint(at.x, at.y)?.closest('.react-flow__edge') === path.closest('.react-flow__edge')) return at;
    }
    return fallback!;
  }, offset);
}
async function clickEdge(id: string, offset = 0) {
  const point = await edgePoint(id, offset);
  await page.mouse.click(point.x, point.y); await expect(edgeLocator(id)).toHaveClass(/selected/);
}
async function moveEndpoint(id: string, target: string, pin: string) {
  await settleCanvas();
  const updater = edgeLocator(id).locator('.react-flow__edgeupdater-target');
  const from = await updater.boundingBox(), to = await page.locator(`.react-flow__node[data-id="${target}"] .react-flow__handle[data-handleid="${pin}"]`).boundingBox();
  if (!from || !to) throw new Error('Missing reconnect target');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 }); await page.mouse.up();
}

try {
  await page.goto(`http://127.0.0.1:${address.port}`); await expect(page.locator('.project-title strong')).toHaveText(initial.name);
  await openGraph(); await expect(page.locator('.blueprint-palette')).not.toBeVisible();
  // The template's compact saved positions can place a short data wire under a
  // node. Arrange before checking the canvas's exposed wire hit area.
  await page.getByRole('button', { name: '自动排列蓝图', exact: true }).click();
  await expect(page.getByRole('button', { name: '自动排列蓝图', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '框选全部节点', exact: true }).click();
  const before = await graph();
  // An offset click exercises the invisible target rather than the drawn 2 px line.
  await clickEdge('ai_bp_caution_l2', 10);
  await expect(page.locator('.connection-details')).toContainText('变量 · 谨慎 → 比较 · 第一个值');
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await graph()).links.length).toBe(before.links.length - 1);
  expect((await graph()).nodes.map(node => node.id)).toEqual(before.nodes.map(node => node.id));
  await page.keyboard.press('Control+z'); await expect.poll(async () => (await graph()).links.length).toBe(before.links.length);
  await page.getByRole('button', { name: '缩小画布', exact: true }).click();
  await page.getByRole('button', { name: '缩小画布', exact: true }).click();
  await clickEdge('ai_bp_caution_l2', 10);
  await page.getByRole('button', { name: '断开此连线', exact: true }).click();
  await expect.poll(async () => (await graph()).links.length).toBe(before.links.length - 1);
  await page.keyboard.press('Control+z');
  checks.push('画布缩小时，距细线 10 px 仍可选中；Delete 和断开按钮只删除连线，Ctrl+Z 完整恢复。');

  await page.getByRole('button', { name: '框选全部节点', exact: true }).click();
  await clickEdge('ai_bp_caution_l1');
  await moveEndpoint('ai_bp_caution_l1', 'ai_bp_caution_slow', 'exec_in');
  await expect.poll(async () => (await graph()).links.find(link => link.id === 'ai_bp_caution_l1')?.toNodeId).toBe('ai_bp_caution_slow');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await graph()).links.find(link => link.id === 'ai_bp_caution_l1')?.toNodeId).toBe('ai_bp_caution_branch');
  await clickEdge('ai_bp_caution_l1');
  await moveEndpoint('ai_bp_caution_l1', 'ai_bp_caution_compare', 'b');
  expect((await graph()).links.find(link => link.id === 'ai_bp_caution_l1')?.toNodeId).toBe('ai_bp_caution_branch');
  checks.push('拖动连线端点可以改接并撤销；执行线误接数据输入时原连线被保留。');

  const blank = await page.locator('.generic-blueprint-workspace .flow-container').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    for (let y = bounds.top + 55; y < bounds.bottom - 80; y += 40) for (let x = bounds.left + 60; x < bounds.right - 80; x += 40) {
      if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) {
        const matrix = new DOMMatrix(getComputedStyle(element.querySelector('.react-flow__viewport')!).transform);
        return { x, y, flowX: (x - bounds.left - matrix.e) / matrix.a, flowY: (y - bounds.top - matrix.f) / matrix.d };
      }
    } throw new Error('No empty canvas point');
  });
  await page.mouse.click(blank.x, blank.y, { button: 'right' });
  await page.getByLabel('搜索要添加的节点').fill('等待'); await page.keyboard.press('Enter');
  await expect.poll(async () => (await graph()).nodes.length).toBe(before.nodes.length + 1);
  const inserted = (await graph()).nodes.at(-1)!; expect(inserted.type).toBe('delay'); expect(Math.abs(inserted.x - blank.flowX)).toBeLessThan(2);
  await page.getByRole('button', { name: '删除选中节点', exact: true }).click();
  await page.getByRole('button', { name: '展开节点库', exact: true }).click(); await expect(page.locator('.blueprint-palette')).toBeVisible();
  await page.getByRole('button', { name: '收起节点库', exact: true }).click();
  checks.push('节点库默认收起；右键搜索与 Enter 添加使用鼠标所在画布位置。');

  await page.keyboard.press('Control+Space'); await expect(page.getByRole('region', { name: '资源管理器' })).toBeVisible();
  const search = page.getByLabel('搜索资源和蓝图');
  await search.fill('方院 · 雨天');
  const homeCard = page.locator('[data-content-key="asset:ai_story_home"]'); await homeCard.click();
  const originalPath = (await snapshot()).assets.find(asset => asset.id === 'ai_story_home')!.path;
  await page.locator('.content-toolbar').getByRole('button', { name: '新建', exact: true }).click();
  await page.locator('.content-create-menu').getByRole('button', { name: '文件夹', exact: true }).click();
  await page.getByLabel('内容名称').fill('验证归档'); await page.locator('.content-dialog').getByRole('button', { name: '确定', exact: true }).click();
  const folder = (await snapshot()).contentBrowser!.folders.find(folder => folder.name === '验证归档')!; expect(folder).toBeTruthy();
  await page.getByLabel('移动所选资源到文件夹').selectOption(folder.id);
  expect((await snapshot()).contentBrowser!.assignments['asset:ai_story_home']).toBe(folder.id);
  await page.getByRole('button', { name: '重命名资源（F2）', exact: true }).click();
  await page.getByLabel('内容名称').fill('方院 · 雨天（归档）'); await page.locator('.content-dialog').getByRole('button', { name: '确定', exact: true }).click();
  expect((await snapshot()).assets.find(asset => asset.id === 'ai_story_home')!.path).toBe(originalPath);
  await page.getByRole('button', { name: '取消收藏', exact: true }).click();
  await page.getByRole('button', { name: '收藏资源', exact: true }).click();
  expect((await snapshot()).contentBrowser!.favorites).toContain('asset:ai_story_home');
  checks.push('资源搜索、预览、文件夹创建、移动、重命名和收藏均生效；移动与重命名保留物理路径及引用。');

  await openContentFilters(page);await page.getByLabel('资源类型').selectOption('image'); await search.fill('');
  await homeCard.click(); await page.locator('[data-content-key="asset:ai_story_boat"]').click({ modifiers: ['Control'] });
  await expect(page.locator('.content-details')).toContainText('已选 2 项');
  await page.getByLabel('移动所选资源到文件夹').selectOption(folder.id);
  expect((await snapshot()).contentBrowser!.assignments['asset:ai_story_boat']).toBe(folder.id);
  await search.fill('方院 · 雨天'); await homeCard.click();
  const canvas = page.locator('.generic-blueprint-workspace .flow-container');
  await homeCard.dragTo(canvas, { targetPosition: { x: 130, y: 90 } });
  await expect.poll(async () => (await graph()).nodes.some(node => node.type === 'showBackground' && node.properties.assetId === 'ai_story_home')).toBe(true);
  await page.getByRole('button', { name: '删除选中节点', exact: true }).click();
  await page.getByRole('button', { name: '所有蓝图', exact: true }).click();
  const macroCard = page.locator('[data-content-key="blueprint:ai_bp_end"]');
  const cardBounds = await macroCard.boundingBox(), captionBounds = await macroCard.locator('strong').boundingBox();
  expect(captionBounds!.width).toBeGreaterThan(30); expect(captionBounds!.y + captionBounds!.height).toBeLessThan(cardBounds!.y + cardBounds!.height);
  await macroCard.dragTo(canvas, { targetPosition: { x: 130, y: 90 } });
  await expect.poll(async () => (await graph()).nodes.some(node => node.type === 'callMacro' && node.properties.graphId === 'ai_bp_end')).toBe(true);
  await page.getByRole('button', { name: '删除选中节点', exact: true }).click();
  await macroCard.dblclick(); await expect(page.getByLabel('演出目标')).toHaveValue('graph:' + 'ai_bp_end');
  checks.push('Ctrl 多选可以批量移动；拖入图片生成背景节点，拖入用户蓝图生成调用节点，双击直接打开蓝图。');

  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  const saved = await snapshot(); projectSchema.parse(saved);
  expect(compileProject(saved).diagnostics.filter(issue => issue.severity === 'error')).toEqual([]);
  await page.reload(); await expect(page.locator('.project-title strong')).toHaveText(initial.name);
  const reopened = await snapshot(); expect(reopened.contentBrowser).toEqual(saved.contentBrowser);
  expect(reopened.assets.find(asset => asset.id === 'ai_story_home')?.name).toBe('方院 · 雨天（归档）');
  await openGraph('ai_bp_banquet'); await expect(page.locator('.blueprint-palette')).not.toBeVisible();
  await page.keyboard.press('Control+Space'); await page.getByRole('button', { name: '所有蓝图', exact: true }).click();
  checks.push('保存重开保留资源文件夹、收藏、重命名和节点库折叠偏好；工程仍可编译。');

  for (const viewport of [{ width: 1024, height: 768 }, { width: 1280, height: 800 }, { width: 1600, height: 1000 }]) {
    await page.setViewportSize(viewport); await page.getByRole('button', { name: '框选全部节点', exact: true }).click();
    await settleCanvas();
    await expect.poll(() => canvas.evaluate(element => {
      const area = element.getBoundingClientRect();
      return [...element.querySelectorAll('.react-flow__node')].some(node => {
        const bounds = node.getBoundingClientRect();
        return bounds.right > area.left && bounds.left < area.right && bounds.bottom > area.top && bounds.top < area.bottom;
      });
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const area = await canvas.boundingBox(), dock = await page.locator('.content-browser').boundingBox();
    expect(area!.width).toBeGreaterThan(300); expect(area!.height).toBeGreaterThan(200); expect(dock!.y + dock!.height).toBeLessThan(viewport.height);
    await page.screenshot({ path: path.join(output, `workbench-${viewport.width}.png`) });
  }
  await page.getByLabel('调整资源管理器高度').focus(); await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Control+Space'); await expect(page.locator('.content-browser')).not.toBeVisible();
  await expect(page.locator('.sidebar')).not.toBeVisible();
  await expect(page.getByRole('button', { name: '展开剧情目录', exact: true })).toHaveCount(0);
  await openStoryMode(page, 'script');
  await expect(page.locator('.story-directory')).toBeVisible();
  await page.getByRole('button', { name: '收起剧情目录', exact: true }).click(); await expect(page.locator('.story-directory')).not.toBeVisible();
  // The story graph uses the same edge interaction and controlled selection.
  await page.locator('[data-workspace-tab="flowchart"]').click();
  const storyBefore = await snapshot(); const firstEdge = await page.getByLabel('选择剧情连线').locator('option').nth(1).getAttribute('value'); expect(firstEdge).toBeTruthy();
  await page.getByLabel('选择剧情连线').selectOption(firstEdge!);
  await page.getByRole('button', { name: '断开选中连线', exact: true }).last().click();
  expect((await snapshot()).nodes.length).toBe(storyBefore.nodes.length);
  await page.keyboard.press('Control+z'); expect((await snapshot()).nodes).toEqual(storyBefore.nodes);
  expect(errors).toEqual([]);
  checks.push('1024 / 1280 / 1600 下资源抽屉与画布均可用；高度、导航可调，剧情图断线与撤销不误删节点。');
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors }, null, 2));
  console.log(`PASS: ${checks.length} workbench checks. Report: ${path.join(output, 'report.json')}`);
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', checks, errors, error: String(error) }, null, 2));
  console.error(error); console.log(`Report: ${path.join(output, 'report.json')}`); process.exitCode = 1;
} finally { await context.close(); await browser.close(); await server.close(); }
