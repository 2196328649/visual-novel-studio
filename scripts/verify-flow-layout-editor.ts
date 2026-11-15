import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { projectSchema } from '../src/core/model';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openDisclosureAncestors } from './lib/ui-disclosures';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// The author lays the map out on the canvas: real drags, undo, reset, and the layout options.
const root = path.resolve('.'), output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/flow-layout-editor',
  'layout-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const relativeOutput = path.relative(root, output);
assert.ok(relativeOutput && !path.isAbsolute(relativeOutput) && relativeOutput !== '..' && !relativeOutput.startsWith('..' + path.sep), 'Acceptance output must remain inside this checkout.');
const fixture = path.join(output, 'project'), file = path.join(fixture, 'project.vns.json');
await fs.mkdir(output, { recursive: true });
await fs.cp(path.join(root, 'resources/templates/aihong'), fixture, { recursive: true });
const project = projectSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
project.name = '流程图布局验收';
await fs.writeFile(file, JSON.stringify(project));
const original = project.ui.components.find(component => component.id === 'ai_flowchart_items')!;
const app = await launchDesktopFixture({ root, projectFile: file, profile: path.join(output, 'profile') }), page = await app.firstWindow(), errors: string[] = [];
const evidence: Record<string, unknown> = {};
const inspector = () => page.locator('.ui-inspector[data-ui-flow-view]');
const view = () => inspector().locator('.ui-inspector-view:not([hidden])');
const field = (name: string) => view().getByLabel(name, { exact: true });
const button = (name: string | RegExp) => view().getByRole('button', { name, exact: typeof name === 'string' });
const group = (id: string) => view().locator(`[data-ui-inspector-group="${id}"]`);
const openGroup = async (id: string) => { await openDisclosureAncestors(group(id).locator(':scope > summary')); };
const map = async () => {
  if (await inspector().getAttribute('data-ui-flow-view') !== 'map') await inspector().getByRole('button', { name: '返回整张图设置', exact: true }).click();
  await expect(inspector()).toHaveAttribute('data-ui-flow-view', 'map');
};
const base = async () => { await map(); await openGroup('flow-style'); await button(/^本图基础外观/).click(); await expect(inspector()).toHaveAttribute('data-ui-flow-view', 'base'); };
const progress = async (mode: string) => {
  await page.getByRole('button', { name: '剧情图预览', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '剧情图预览', exact: true });
  await dialog.getByLabel('预览玩家进度', { exact: true }).selectOption(mode);
  await dialog.getByRole('button', { name: '关闭剧情图预览', exact: true }).click();
};
page.on('pageerror', error => errors.push(error.message));
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1580, 1000));
  await page.locator('.view-tabs').getByRole('button', { name: '界面', exact: true }).click();
  await page.getByLabel('设计页面', { exact: true }).selectOption({ label: '剧情流程图' });
  const flow = page.locator('[data-component-id="ai_flowchart_items"]');
  await page.locator('[data-hierarchy-id="ai_flowchart_items"]').click();
  await openGroup('flow-layout');
  await expect(field('排列方向')).toHaveValue('horizontal');
  await expect(field('连线样式')).toHaveValue('elbow');
  await expect(button('全部恢复自动排列')).toBeDisabled();
  // The map's nodes answer with the map's own sounds, and its caption shadow can be widened.
  await openGroup('interaction');
  await openGroup('interaction-sounds');
  await expect(field('按钮点击音效')).toHaveValue('ai_ui_click_title');
  await expect(field('按钮悬停音效')).toHaveValue('ai_ui_hover_highlight');
  await base();
  await expect(field('基础文字黑底方式')).toHaveValue('soft');
  await expect(field('黑底厚度')).toHaveValue('4');
  // The label shows in its own font and size; the rail, its track and its thumb line up.
  await flow.locator('[data-flow-node]').first().click();
  await expect(inspector()).toHaveAttribute('data-ui-flow-view', 'node');
  const nodeField = field('节点文字第 1 段'), firstTitle = (await nodeField.getAttribute('placeholder'))!;
  await nodeField.fill('记 第一回');
  await button('添加文字段').click();
  await field('节点文字第 2 段').fill('醉梦');
  await button('调整文字第 1 段外观').click();
  await expect(inspector()).toHaveAttribute('data-ui-flow-view', 'base');
  const part = (index: number) => flow.locator('[data-flow-node]').first().locator(`[data-flow-part="${index}"]`);
  await expect(part(0)).toHaveText('记 第一回');
  await expect(part(1)).toHaveText('醉梦');
  await expect(field('第 1 段字号')).toHaveValue('30');
  assert.notEqual(await part(0).evaluate(element => getComputedStyle(element).fontFamily), await part(1).evaluate(element => getComputedStyle(element).fontFamily));
  await field('第 1 段字号').fill('24');
  await field('第 1 段颜色颜色值').fill('#ffcc66');
  await openDisclosureAncestors(view().locator('[data-ui-inspector-group$="-caption-mapping"] > summary'));
  await button('添加分段样式').click();
  await expect(view().getByRole('group', { name: '分段对应变化预览', exact: true })).toBeVisible();
  await expect(view().locator('.flow-caption-slot-row')).toHaveCount(2);
  await button('应用对应变化').click();
  await expect(view().locator('.flow-caption-slot-row')).toHaveCount(3);
  await button('删除第 3 段样式').click();
  await button('应用对应变化').click();
  await expect(view().locator('.flow-caption-slot-row')).toHaveCount(2);
  assert.ok(firstTitle.length > 0);
  const rail = page.getByRole('scrollbar', { name: '流程图横向滚动条', exact: true });
  const railBox = (await rail.boundingBox())!, trackBox = (await rail.locator('img').first().boundingBox())!;
  assert.ok(Math.abs(trackBox.x - railBox.x) < 1 && Math.abs(trackBox.width - railBox.width) < 1, JSON.stringify({ railBox, trackBox }));
  assert.equal(await rail.locator('[data-flow-scrollbar-thumb] .ui-skin-image').evaluate(element => getComputedStyle(element).borderImageSlice), '0 23 0 24 fill');
  const nodes = flow.locator('[data-flow-node]'), manual = flow.locator('[data-flow-node][data-flow-manual]');
  const nodeCount = await nodes.count(), edgeCount = await flow.locator('[data-flow-edge]').count();
  assert.ok(nodeCount > 1, String(nodeCount));
  // The template has a 96px gap and dots every 8px. Short connectors must crop/repeat
  // the source texture, not squeeze all 44 dots into this gap.
  const shortLine = flow.locator('[data-flow-segment] > rect').first();
  await expect(shortLine).toBeVisible();
  await expect(flow.locator('[data-flow-segment] pattern').first()).toHaveAttribute('width', '352');
  const png = PNG.sync.read(await shortLine.screenshot({ path: path.join(output, 'short-line.png') }));
  const columnPeaks = Array.from({ length: png.width }, (_, x) => Math.max(...Array.from({ length: png.height }, (_, y) => {
    const i = (y * png.width + x) * 4;
    return Math.min(png.data[i], png.data[i + 1], png.data[i + 2]);
  })));
  // At fit-to-window zoom, antialiasing lowers a small white dot's peak. Measure
  // its contrast against the actual crop instead of requiring unscaled white.
  const peak = Math.max(...columnPeaks), background = Math.min(...columnPeaks), threshold = background + (peak - background) * .55;
  assert.ok(peak - background > 30, JSON.stringify({ peak, background }));
  let dotRuns = 0, previous = false;
  for (let x = 0; x < png.width; x++) {
    const bright = columnPeaks[x] > threshold;
    if (bright && !previous) dotRuns++;
    previous = bright;
  }
  evidence.shortLine = { dotRuns, width: png.width, height: png.height, peak, background };
  assert.ok(dotRuns >= 9 && dotRuns <= 15, JSON.stringify(evidence.shortLine));
  const first = nodes.first(), id = (await first.getAttribute('data-flow-node'))!;
  const drag = async (dx: number, dy: number) => {
    const box = (await first.boundingBox())!, x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 8 });
    await page.mouse.up();
    return box;
  };

  // Dragging moves that node alone; the map itself stays where it is.
  const frame = (await flow.boundingBox())!, before = await drag(70, 50), after = (await first.boundingBox())!;
  await expect(manual).toHaveCount(1);
  assert.ok(Math.abs(after.x - before.x - 70) < 12 && Math.abs(after.y - before.y - 50) < 12, JSON.stringify({ before, after }));
  assert.deepEqual(await flow.boundingBox(), frame);
  await expect(inspector()).toHaveAttribute('data-ui-flow-view', 'node');
  await openGroup('flow-node-position');
  const placedX = Number(await field('节点横向位置').inputValue());
  await field('节点横向位置').fill(String(placedX + 20));
  await field('节点横向位置').press('Tab');
  await expect.poll(async () => (await first.boundingBox())!.x - after.x).toBeCloseTo(20 * frame.width / (original.width * project.width), 0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(field('节点横向位置')).toHaveValue(String(placedX));
  await expect(manual).toHaveCount(1);
  await map(); await openGroup('flow-layout');
  await expect(button(/全部恢复自动排列（已摆放 1 个）/)).toBeEnabled();
  await page.screenshot({ path: path.join(output, 'dragged.png') });

  // A drag is one undo step, and a click without movement places nothing.
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(manual).toHaveCount(0);
  await first.click();
  await expect(manual).toHaveCount(0);

  // Resetting one node is an explicit action; double-click only selects it.
  await drag(70, 50);
  await expect(manual).toHaveCount(1);
  await first.dblclick();
  await expect(manual).toHaveCount(1);
  await openGroup('flow-node-position');
  await button('当前节点恢复自动排列').click();
  await expect(manual).toHaveCount(0);
  await drag(70, 50);
  await map(); await openGroup('flow-layout'); await button(/全部恢复自动排列/).click();
  await expect(manual).toHaveCount(0);

  // Direction and line style redraw the preview.
  await drag(0, -70);
  await map(); await openGroup('flow-layout');
  const lines = flow.locator('[data-flow-segment]');
  const elbow = await lines.count();
  await field('连线样式').selectOption('curve');
  await expect.poll(() => lines.count()).toBeGreaterThan(elbow);
  assert.ok(await lines.last().evaluate(element => Number(element.getAttribute('data-flow-distance')) > 0));
  await page.screenshot({ path: path.join(output, 'curve.png') });
  await field('连线样式').selectOption('straight');
  await expect(lines).toHaveCount(edgeCount);
  await button(/全部恢复自动排列/).click();
  const across = (await nodes.nth(1).boundingBox())!;
  await field('排列方向').selectOption('vertical');
  await expect.poll(async () => (await nodes.nth(1).boundingBox())!.y).not.toBe(across.y);
  await page.screenshot({ path: path.join(output, 'vertical.png') });
  await expect(page.locator('.dirty-dot')).toHaveCount(1);

  // Locked parts follow the options while the preview shows the disabled state.
  await openGroup('flow-player');
  await progress('partial');
  await field('未到达时显示的文字').fill('？？？');
  await field('未到达的连线').selectOption('dim');
  await expect(flow.locator('[data-flow-edge][opacity]')).not.toHaveCount(0);
  await field('未到达的节点').selectOption('hide');
  await expect.poll(() => nodes.count()).toBeLessThan(nodeCount);
  await page.screenshot({ path: path.join(output, 'locked-hidden.png') });
  await field('未到达的节点').selectOption('show');
  await expect(nodes).toHaveCount(nodeCount);
  await progress('all');
  await drag(70, -20);
  await expect(manual).toHaveCount(1);

  await page.getByRole('button', { name: '保存界面', exact: true }).click();
  await expect(page.locator('.ui-save-status')).toHaveText('已保存', { timeout: 30000 });
  const saved = projectSchema.parse(JSON.parse(await fs.readFile(file, 'utf8'))).ui.components.find(component => component.id === 'ai_flowchart_items')!;
  assert.deepEqual([saved.x, saved.y, saved.width, saved.height], [original.x, original.y, original.width, original.height]);
  assert.equal(saved.list?.flowDirection, 'vertical');
  assert.equal(saved.list?.flowLineStyle, 'straight');
  assert.equal(saved.list?.flowLockedLine, 'dim');
  assert.equal(saved.list?.flowLockedNode, undefined);
  assert.equal(saved.list?.flowLockedCaption, '？？？');
  assert.deepEqual(Object.keys(saved.list?.flowPositions ?? {}), [id]);
  assert.deepEqual(saved.style?.captionParts?.[0], { fontAssetId: 'ai_ui_e1048c68ae7d4eb5', fontSize: 24, color: '#ffcc66' });
  const savedProject = projectSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
  assert.equal(savedProject.chapters[0].flowchart?.name, '记 第一回｜醉梦');
  assert.ok(savedProject.scriptText?.content.includes('显示名称="记 第一回｜醉梦"'));
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', evidence }, null, 2));
} catch (error) {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', error: String(error), evidence }, null, 2));
  throw error;
} finally {
  await page.screenshot({ path: path.join(output, 'final.png') }).catch(() => undefined);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined);
  await app.close();
  const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']);
  assert.deepEqual(cleanup.errors, []);
  console.log(output);
}
