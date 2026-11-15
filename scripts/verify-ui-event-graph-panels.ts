import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { uiNativePreferencesFixture } from './lib/ui-native-preferences-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Use only the isolated development editor.');

// UE5-style event graph: details without a wire list, a scrolling add-node list,
// box selection that only highlights nodes, and a folding "我的界面" panel.
const root = path.resolve('.'), output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? path.join(root, 'artifacts'), 'ui-event-graph-panels', new Date().toISOString().replaceAll(':', '-')), shots = path.join(output, 'shots');
await fs.mkdir(shots, { recursive: true });
const project = uiNativePreferencesFixture(), projectFile = path.join(output, 'project/project.vns.json');
await fs.mkdir(path.dirname(projectFile), { recursive: true }); await fs.writeFile(projectFile, JSON.stringify(project));
const app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') }), page = await app.firstWindow(); page.setDefaultTimeout(10000);
const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
const button = (name: string) => page.getByRole('button', { name, exact: true }), checks: string[] = [];
const library = page.locator('.ui-event-library'), nodes = page.locator('.react-flow__node'), viewport = page.locator('.react-flow__viewport');
const toggle = (title: string) => library.locator('.ui-library-toggle').filter({ hasText: title });
const report: Record<string, unknown> = { status: 'running', renderer: 'dist', checks, errors };
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click();
  await page.getByLabel('事件图页面').selectOption('ui:preferences'); await expect(nodes).toHaveCount(4);

  // Wires are selected and disconnected on the canvas; the details panel has no wire list.
  await expect(page.locator('.blueprint-property-tabs > button')).toHaveText(['节点参数', '输入与输出', '变量']);
  checks.push('详细信息只有节点参数、输入与输出、变量，没有连线列表');

  await button('自动排列蓝图').click(); await expect(button('自动排列蓝图')).toBeEnabled();
  await button('框选全部节点').click(); await page.waitForTimeout(400);
  const pane = (await page.locator('.react-flow__pane').boundingBox())!;
  await page.mouse.move(pane.x + 10, pane.y + 10); await page.mouse.down();
  await page.mouse.move(pane.x + pane.width - 20, pane.y + pane.height - 70, { steps: 10 });
  const marquee = await page.locator('.react-flow__selection').evaluate(el => getComputedStyle(el).borderTopColor);
  await page.mouse.up();
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(4);
  const frame = await page.locator('.react-flow__nodesselection-rect').evaluate(el => { const style = getComputedStyle(el); return { pointer: style.pointerEvents, border: style.borderTopWidth, background: style.backgroundColor }; });
  assert.deepEqual(frame, { pointer: 'none', border: '0px', background: 'rgba(0, 0, 0, 0)' }, JSON.stringify(frame));
  assert.ok(!/rgba?\(0, 89, 220/.test(marquee), marquee);
  await page.screenshot({ path: path.join(shots, 'box-selected.png') });
  // Inside the old group frame, empty canvas is canvas again: a click clears the selection.
  const empty = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.react-flow__node')].map(node => node.getBoundingClientRect());
    const left = Math.min(...boxes.map(b => b.left)), right = Math.max(...boxes.map(b => b.right)), top = Math.min(...boxes.map(b => b.top)), bottom = Math.max(...boxes.map(b => b.bottom));
    for (let y = top + 8; y < bottom; y += 12) for (let x = left + 8; x < right; x += 12) if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) return { x, y };
    return undefined;
  });
  if (empty) { await page.mouse.click(empty.x, empty.y); await expect(page.locator('.react-flow__node.selected')).toHaveCount(0); checks.push('框选后只高亮节点，不显示选区框；选区内的空白处点击即取消选择'); }
  else checks.push('框选后只高亮节点，不显示选区框（排列后节点之间没有空白，未检查选区内点击）');

  // The add-node list scrolls under the wheel, like its scrollbar, and the canvas stays put.
  await button('添加节点').click();
  const list = page.locator('.node-picker-results'); await expect(list).toBeVisible();
  const before = { top: await list.evaluate(el => el.scrollTop), canvas: await viewport.evaluate(el => el.style.transform) };
  const box = (await list.boundingBox())!; await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(80); }
  await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeGreaterThan(before.top + 100);
  assert.equal(await viewport.evaluate(el => el.style.transform), before.canvas);
  await expect(page.getByRole('dialog', { name: '添加蓝图节点' }).locator('footer')).toContainText('滚轮滚动');
  await page.screenshot({ path: path.join(shots, 'node-picker.png') }); await page.keyboard.press('Escape');
  checks.push('添加节点窗口的滚轮滚动列表，不移动高亮项，画布不缩放');
  if (await button('保存界面').isEnabled()) await button('保存界面').click();
  await expect(button('保存界面')).toBeDisabled();
  const beforeBrowsing = await fs.readFile(projectFile, 'utf8');

  // "我的界面" groups fold under their category bar and stay folded when the panel opens again.
  await toggle('控件').click(); await expect(toggle('控件')).toHaveAttribute('aria-expanded', 'false'); await expect(library.locator('.ui-event-components')).toBeHidden();
  await page.getByLabel('界面编辑模式').getByRole('button', { name: '设计', exact: true }).click();
  await page.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click();
  await expect(toggle('控件')).toHaveAttribute('aria-expanded', 'false'); await expect(library.locator('.ui-event-components')).toBeHidden();
  await toggle('控件').click(); await expect(library.locator('.ui-event-components')).toBeVisible();
  // A category's own add button unfolds it first, so the new form is visible.
  await toggle('变量').click(); await expect(library.getByLabel('状态列表作用域')).toBeHidden();
  await library.getByRole('button', { name: '新建变量', exact: true }).click();
  await expect(toggle('变量')).toHaveAttribute('aria-expanded', 'true'); await expect(library.getByLabel('变量名称', { exact: true })).toBeFocused();
  await expect(library.getByRole('button', { name: '创建变量', exact: true })).toBeDisabled();
  await library.getByLabel('变量名称', { exact: true }).fill('仅浏览时取消的新变量');
  await library.getByRole('button', { name: '取消', exact: true }).click();
  await expect(library.getByRole('form', { name: '创建状态变量', exact: true })).toHaveCount(0);
  await expect(button('保存界面')).toBeDisabled(); assert.equal(await fs.readFile(projectFile, 'utf8'), beforeBrowsing);
  await library.getByLabel('状态列表作用域', { exact: true }).selectOption('player');
  await library.getByLabel('搜索变量', { exact: true }).fill('字幕');
  await expect(library.locator('[data-state-variable-id]')).toHaveCount(1);
  await expect(library.locator('[data-ui-variable-id="custom"]')).toHaveText('字幕字号');
  await library.getByLabel('搜索变量', { exact: true }).fill('不存在的变量');
  await expect(library.locator('[data-state-variable-id]')).toHaveCount(0);
  await library.getByLabel('搜索变量', { exact: true }).fill('');
  await expect(library.locator('[data-state-variable-id]')).toHaveCount(2);
  await library.getByRole('button', { name: '编辑变量 字幕字号', exact: true }).click();
  await expect(library.locator('.blueprint-state-definition')).toHaveCount(1);
  await expect(button('保存界面')).toBeDisabled(); assert.equal(await fs.readFile(projectFile, 'utf8'), beforeBrowsing);
  assert.ok(await library.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await library.screenshot({ path: path.join(shots, 'my-interface.png') });
  checks.push('我的界面按类别记住折叠状态；加号展开并聚焦新项，取消与作用域搜索均不修改草稿');

  const editorWindow = await app.browserWindow(page);
  await editorWindow.evaluate(window => { if (window.isMaximized()) window.unmaximize(); window.setContentSize(1024, 800); });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect.poll(() => library.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await library.getByRole('button', { name: '新建变量', exact: true }).click();
  await expect(library.getByLabel('变量名称', { exact: true })).toBeFocused();
  await expect(library.getByRole('button', { name: '取消', exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(shots, 'variable-draft-narrow.png') });
  await library.getByRole('button', { name: '取消', exact: true }).click();
  await button('作品设置').click();
  const appearance = page.getByRole('dialog', { name: '作品设置', exact: true });
  await appearance.getByRole('button', { name: '编辑器外观', exact: true }).click();
  await appearance.locator('.editor-theme-card').filter({ has: page.locator('strong', { hasText: '亮白' }) }).click();
  await appearance.getByRole('button', { name: '完成', exact: true }).click();
  await expect(library.getByRole('button', { name: '编辑变量 字幕字号', exact: true })).toBeVisible();
  await expect.poll(() => library.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: path.join(shots, 'variable-members-light.png') });
  await expect(button('保存界面')).toBeDisabled(); assert.equal(await fs.readFile(projectFile, 'utf8'), beforeBrowsing);
  checks.push('1024宽窗口的新项与成员详情可操作、无横向溢出；亮白主题成员类型和选中项有完整截图证据');
  assert.deepEqual(errors, []);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = error instanceof Error ? error.stack : String(error); process.exitCode = 1; await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); }
finally {
  let exited = false;
  try { const child = app.process(); await app.close(); exited = child.exitCode !== null || child.signalCode !== null; report.process = { pid: child.pid, exited }; assert.equal(exited, true); }
  catch (error) { report.status = 'failed'; report.closeError = String(error); process.exitCode = 1; }
  try { if (!exited) throw new Error('Fixture is still running.'); const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); report.cleanup = cleanup; assert.deepEqual(cleanup.errors, []); }
  catch (error) { report.status = 'failed'; report.cleanupError = String(error); process.exitCode = 1; }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
}
