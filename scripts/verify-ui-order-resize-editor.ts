import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { assetFiles, effectiveUiComponents, projectSchema, type UiComponent } from '../src/core/model';
import { assetSourcePath } from '../src/desktop/project-store';
import { installedExecutable, launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.');
const output = path.resolve('artifacts/ui-order-resize-editor', new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const source = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? 'E:/Project/Visual Novel Studio/我的视觉小说1/project.vns.json');
const original = await fs.readFile(source), project = projectSchema.parse(JSON.parse(original.toString()));
const sourceSha256 = createHash('sha256').update(original).digest('hex');
project.name += ' · 列表与尺寸验收';
project.assets = project.assets.map(asset => ({ ...asset, externalPath: assetSourcePath(path.dirname(source), asset),
  externalFiles: Object.fromEntries(assetFiles(asset).map(file => [file, assetSourcePath(path.dirname(source), asset, file)])),
}));
const realButton = effectiveUiComponents(project.ui).find(c => c.page === 'main' && c.kind === 'button' && c.action === 'start');
const fixtureId = 'ui_order_resize_check';
const box = (id: string, name: string, extra: Partial<UiComponent> = {}): UiComponent => ({ id, name, kind: 'button', page: 'custom', text: name, x: .08, y: .13, width: .3, height: .22, style: { background: '#845947', textColor: '#ffffff', fontSize: 28 }, ...extra });
const a = 'order_parent_a', b = 'order_parent_b', c = 'order_parent_c', ca = 'order_child_a', cb = 'order_child_b', cc = 'order_child_c';
const fixture = [
  box(a, '父按钮 A', { layer: 10 }),
  box(ca, '子对象 A', { kind: 'text', parentId: a, x: .1, y: .2, width: .4, height: .35, style: { background: '#d9ad6a', textColor: '#222222', fontSize: 20 } }),
  box(b, '父按钮 B', { layer: 20, x: .5, y: .18, width: .3, height: .28, style: { background: '#355970', textColor: '#ffffff' } }),
  box(cb, '子对象 B', { kind: 'text', parentId: b, x: .1, y: .15, width: .4, height: .3 }),
  box(c, '父按钮 C', { layer: 30, x: .28, y: .44, width: .35, height: .26, style: { background: '#41694e', textColor: '#ffffff' } }),
  box(cc, '子对象 C', { kind: 'text', parentId: c, x: .1, y: .2, width: .4, height: .3 }),
];
assert.ok(!project.ui.customPages.some(page => page.id === fixtureId));
project.ui.customPages.unshift({ id: fixtureId, name: '列表与尺寸检查', modal: true, background: '#20262b', components: fixture });
const projectFile = path.join(output, 'project/project.vns.json');
await fs.mkdir(path.dirname(projectFile), { recursive: true });
await fs.writeFile(projectFile, JSON.stringify(projectSchema.parse(project), null, 2));
const server = installedExecutable ? undefined : await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**', '**/work/**'] } } });
await server?.listen();
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch';
const checks: string[] = [], errors: string[] = [];
const launch = async () => {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile'), devUrl: server ? 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port : undefined });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1500, 960));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="ui"]').click();
};
const close = async () => { await app?.close().catch(() => undefined); app = undefined; };
const row = (id: string) => page!.locator(`[data-hierarchy-id="${id}"]`);
const object = (id: string) => page!.locator(`.ui-canvas [data-component-id="${id}"]`);
const bounds = async (id: string) => { const value = await object(id).boundingBox(); assert.ok(value); return value; };
const order = () => page!.locator('.ui-hierarchy-row').evaluateAll(rows => rows.map(row => row.getAttribute('data-hierarchy-id')));
const roots = () => page!.locator('.ui-hierarchy-row:not([data-parent-id])').evaluateAll(rows => rows.map(row => row.getAttribute('data-hierarchy-id')));
const paint = () => page!.locator('.ui-canvas [data-component-id]').evaluateAll(rows => rows.map(row => row.getAttribute('data-component-id')));
const saved = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))).ui.customPages.find(page => page.id === fixtureId)!.components;
const save = async () => { const button = page!.getByRole('button', { name: '保存界面', exact: true }); if (await button.isEnabled()) await button.click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); };
const undo = () => page!.getByRole('button', { name: '撤销', exact: true }).click();
const redo = () => page!.getByRole('button', { name: '重做', exact: true }).click();
const near = (actual: number, expected: number, tolerance = 1.5) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const sameRect = (left: Awaited<ReturnType<typeof bounds>>, right: Awaited<ReturnType<typeof bounds>>) => { for (const key of ['x', 'y', 'width', 'height'] as const) near(left[key], right[key]); };
const beginDrop = async (fromId: string, toId: string, placement: 'before' | 'after' | 'inside') => {
  await row(fromId).scrollIntoViewIfNeeded(); await row(toId).scrollIntoViewIfNeeded();
  const from = (await row(fromId).boundingBox())!, to = (await row(toId).boundingBox())!;
  const x = to.x + to.width * .45, y = placement === 'before' ? to.y + 3 : placement === 'after' ? to.y + to.height - 3 : to.y + to.height / 2;
  await page!.mouse.move(from.x + from.width * .45, from.y + from.height / 2); await page!.mouse.down();
  await page!.mouse.move(from.x + from.width * .45 + 12, from.y + from.height / 2, { steps: 3 });
  await page!.mouse.move(x, y, { steps: 12 }); await page!.mouse.move(x + 1, y);
};
const drop = async (from: string, to: string, placement: 'before' | 'after' | 'inside') => { await beginDrop(from, to, placement); await page!.mouse.up(); };
const resize = async (handle: string, dx: number, dy: number, options: { shift?: boolean; hold?: boolean } = {}) => {
  const target = page!.locator(`.ui-resize-handle[data-resize-handle="${handle}"]`);
  const start = (await target.boundingBox())!; assert.ok(start);
  if (options.shift) await page!.keyboard.down('Shift');
  await page!.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page!.mouse.down();
  await page!.mouse.move(start.x + start.width / 2 + dx, start.y + start.height / 2 + dy, { steps: 12 });
  if (!options.hold) await page!.mouse.up();
  if (options.shift) await page!.keyboard.up('Shift');
};
const openParents = async () => {
  const group = page!.locator('details.ui-child-objects');
  if (!await group.evaluate(element => (element as HTMLDetailsElement).open)) await group.locator(':scope > summary').click();
};
try {
  await launch();
  if (realButton) {
    await row(realButton.id).click(); await expect(page!.locator('.ui-resize-handle')).toHaveCount(8);
    await page!.screenshot({ path: path.join(output, '01-author-handles.png') });
  }
  await page!.getByLabel('设计页面', { exact: true }).selectOption('custom');
  await page!.getByLabel('选择自定义页面', { exact: true }).selectOption(fixtureId);
  await expect.poll(roots).toEqual([c, b, a]);
  const originalPaint = await paint(), originalBounds = await bounds(c);
  phase = 'insert-preview';
  await beginDrop(c, a, 'before');
  await expect(page!.locator(`[data-list-drop-target="${a}"][data-list-drop-position="before"]`)).toBeVisible();
  await expect(page!.locator('.ui-parent-guide.is-dropping')).toHaveCount(0);
  await expect(row(a)).not.toHaveClass(/drop-target/);
  await page!.screenshot({ path: path.join(output, '02-insert-preview.png') });
  await page!.mouse.up(); await expect.poll(roots).toEqual([b, c, a]);
  await expect(row(c)).not.toHaveAttribute('data-parent-id'); assert.deepEqual(await paint(), originalPaint); sameRect(await bounds(c), originalBounds);
  await undo(); await expect.poll(roots).toEqual([c, b, a]);
  await redo(); await expect.poll(roots).toEqual([b, c, a]);
  await page!.getByRole('button', { name: '在列表中上移', exact: true }).click(); await expect.poll(roots).toEqual([c, b, a]);
  await page!.getByRole('button', { name: '在列表中下移', exact: true }).click(); await expect.poll(roots).toEqual([b, c, a]);
  await beginDrop(b, a, 'after');
  const marker = page!.locator(`[data-list-drop-target="${a}"][data-list-drop-position="after"]`);
  await expect(marker).toBeVisible();
  assert.equal(await marker.evaluate(element => element.closest('[data-hierarchy-id]')?.getAttribute('data-hierarchy-id')), ca);
  await page!.mouse.up(); await expect.poll(roots).toEqual([c, a, b]);
  assert.deepEqual(await paint(), originalPaint); await save();
  for (const item of await saved()) assert.equal(item.layer, fixture.find(c => c.id === item.id)!.layer);
  checks.push('行间拖放和上下移动只调整列表；展开子树后的插入线、撤销重做与显示顺序均正确');

  phase = 'parent-and-sibling-drops';
  const beforeChild = await bounds(cc);
  await drop(c, a, 'inside'); await expect(row(c)).toHaveAttribute('data-parent-id', a);
  sameRect(await bounds(c), originalBounds); sameRect(await bounds(cc), beforeChild);
  await drop(c, b, 'after'); await expect(row(c)).not.toHaveAttribute('data-parent-id'); sameRect(await bounds(c), originalBounds);
  await drop(c, cb, 'before'); await expect(row(c)).toHaveAttribute('data-parent-id', b); sameRect(await bounds(cc), beforeChild);
  await beginDrop(b, cc, 'inside'); await expect(page!.locator('.ui-hierarchy-feedback')).toContainText('不能放入自身');
  await page!.mouse.up(); await expect(row(b)).not.toHaveAttribute('data-parent-id');
  await row(c).dragTo(page!.locator('.ui-hierarchy-root')); await expect(row(c)).not.toHaveAttribute('data-parent-id');
  sameRect(await bounds(c), originalBounds); await save();
  checks.push('行中设置父级、跨父级插入和拖回根级保留完整子树位置，循环父子关系被拒绝');

  phase = 'independent-display-depth';
  await row(c).click(); await openParents(); const listBeforeDepth = await order();
  await page!.getByLabel('显示层级', { exact: true }).fill('5'); await page!.keyboard.press('Tab');
  assert.deepEqual(await order(), listBeforeDepth); assert.notDeepEqual(await paint(), originalPaint);
  await page!.getByLabel('显示层级', { exact: true }).fill('30'); await page!.keyboard.press('Tab');
  assert.deepEqual(await order(), listBeforeDepth); assert.deepEqual(await paint(), originalPaint); await save();
  checks.push('显示层级改变画布遮挡，但不会改变组件列表顺序');

  phase = 'resize-preview-and-history';
  await row(a).click(); await expect(page!.locator('.ui-resize-handle')).toHaveCount(8);
  const initialA = await bounds(a), initialChildA = await bounds(ca), savedBeforeResize = await saved();
  await resize('se', 40, 24, { hold: true });
  await expect.poll(async () => (await bounds(a)).width).toBeGreaterThan(initialA.width + 35);
  assert.deepEqual(await saved(), savedBeforeResize, 'Dragging is only a preview until pointer-up');
  await page!.mouse.up(); const enlarged = await bounds(a), enlargedChild = await bounds(ca);
  near(enlarged.width, initialA.width + 40); near(enlarged.height, initialA.height + 24);
  near(enlargedChild.width / initialChildA.width, enlarged.width / initialA.width, .015);
  near(enlargedChild.height / initialChildA.height, enlarged.height / initialA.height, .015);
  await undo(); sameRect(await bounds(a), initialA); sameRect(await bounds(ca), initialChildA);
  await redo(); sameRect(await bounds(a), enlarged); await save();
  await page!.screenshot({ path: path.join(output, '03-resized-parent.png') });
  checks.push('四角拖动实时预览，松开只提交一次；父级尺寸变化同步影响子对象，撤销重做完整恢复');

  phase = 'edge-aspect-and-cancel';
  const beforeEdge = await bounds(a); await resize('e', 24, 18); const afterEdge = await bounds(a);
  near(afterEdge.width, beforeEdge.width + 24); near(afterEdge.height, beforeEdge.height); near(afterEdge.y, beforeEdge.y);
  await resize('nw', -28, -3, { shift: true }); const aspect = await bounds(a);
  near(aspect.width / aspect.height, afterEdge.width / afterEdge.height, .015);
  near(aspect.x + aspect.width, afterEdge.x + afterEdge.width); near(aspect.y + aspect.height, afterEdge.y + afterEdge.height);
  await save(); const beforeCancel = await saved();
  await resize('se', 20, 15, { hold: true }); await page!.keyboard.press('Escape'); await page!.mouse.up();
  sameRect(await bounds(a), aspect); await expect(page!.locator('.dirty-dot')).toHaveCount(0); assert.deepEqual(await saved(), beforeCancel);
  checks.push('四边只改变对应尺寸，Shift 保持比例与对角锚点，Esc 取消不产生修改');

  phase = 'locked-parent-and-local-child';
  await row(a).getByRole('button', { name: '锁定 父按钮 A', exact: true }).click(); await row(ca).click();
  await expect(page!.locator('.ui-resize-handle')).toHaveCount(0);
  await row(a).getByRole('button', { name: '解锁 父按钮 A', exact: true }).click();
  await expect(page!.locator('.ui-resize-handle')).toHaveCount(8);
  const childBefore = await bounds(ca), parentBefore = await bounds(a);
  await resize('e', 15, 0); near((await bounds(ca)).width, childBefore.width + 15); sameRect(await bounds(a), parentBefore);
  await save(); checks.push('父级锁定阻止子对象画布缩放；解锁后子对象按相对坐标独立调整');

  phase = 'reopen';
  const finalOrder = await order(), finalData = await saved(), finalParent = await bounds(a), finalChild = await bounds(ca);
  await close(); await launch();
  await page!.getByLabel('设计页面', { exact: true }).selectOption('custom');
  await page!.getByLabel('选择自定义页面', { exact: true }).selectOption(fixtureId);
  await expect.poll(order).toEqual(finalOrder); sameRect(await bounds(a), finalParent); sameRect(await bounds(ca), finalChild);
  assert.deepEqual(await saved(), finalData); await row(a).click();
  await page!.screenshot({ path: path.join(output, '04-reopened.png') });
  assert.ok((await fs.readFile(source)).equals(original)); assert.deepEqual(errors, []);
  checks.push('保存重开保留列表顺序、显示层级、尺寸与父子关系，作者原工程保持原样');
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', source, sourceSha256, projectFile, checks, errors, installedExecutable }, null, 2));
  console.log(output);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'error.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, errors, error: String(error) }, null, 2));
  console.error(output); throw error;
} finally { await close(); await server?.close(); }
