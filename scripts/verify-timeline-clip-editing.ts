import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { expect } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { createBlueprintGraph } from '../src/core/blueprint';
import { addTimelineComponent } from '../src/core/timeline-component';
import { performanceTimeline } from '../src/core/performance-timeline';
import { timelineOverlap } from '../src/core/timeline-editing';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.'), output = path.join(root, 'artifacts/timeline-clip-editing', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = createProject('演出剪辑界面验收');
for (const [id, name, color] of [['red', '暖色背景', [220, 40, 40]], ['blue', '蓝色叠加画面', [40, 70, 220]]] as const) {
  const png = new PNG({ width: 160, height: 90 });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = color[0]; png.data[i + 1] = color[1]; png.data[i + 2] = color[2]; png.data[i + 3] = 255; }
  await fs.writeFile(path.join(output, id + '.png'), PNG.sync.write(png));
  project.assets.push({ id, name, kind: 'image', category: 'scene', path: id + '.png' });
}
const folderName = '第一章 · 城市傍晚与人物出场素材文件夹';
project.contentBrowser = { folders: [{ id: 'folder', name: folderName }], assignments: { 'asset:blue': 'folder' }, favorites: [] };
const owner = createBlueprintGraph('effect', '演出蓝图'); project.blueprints.push(owner);
const { timeline, node: call } = addTimelineComponent(project, owner.id);
const projectFile = path.join(output, 'project.vns.json'); await fs.writeFile(projectFile, JSON.stringify(project));
const app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') }), page = await app.firstWindow();
const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
const save = async () => { const button = page.getByRole('button', { name: '保存工程', exact: true }); if (await button.isEnabled()) await button.click(); await expect(page.locator('.dirty-dot')).toHaveCount(0); await expect(page.getByRole('contentinfo')).toContainText('工程已保存'); return projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))); };
const seek = async (time: number) => {
  const ruler = await page.getByLabel('时间标尺', { exact: true }).boundingBox(); assert.ok(ruler);
  const first = page.locator('.timeline-clip').first(), box = await first.boundingBox(); assert.ok(box);
  const zoom = (box.width + 2) / Number(await first.getAttribute('data-duration'));
  await page.mouse.click(ruler.x + 130 + time * zoom, ruler.y + 12);
};
const checkColor = async (color: 'red' | 'blue') => {
  await expect(page.locator('[data-visual-instance]')).toHaveCount(2);
  const png = PNG.sync.read(await page.locator('.text-stage').screenshot());
  const i = (Math.floor(png.height * .25) * png.width + Math.floor(png.width * .5)) * 4;
  assert.ok(color === 'red' ? png.data[i] > 180 && png.data[i + 2] < 80 : png.data[i + 2] > 180 && png.data[i] < 80, `Expected ${color}, got ${[...png.data.slice(i, i + 3)]}`);
};
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="blueprint"]').click();
  await page.getByRole('button', { name: '框选全部节点', exact: true }).click();
  await page.locator(`.react-flow__node[data-id="${call.id}"] .graph-node-title`).click();
  await page.getByRole('button', { name: '编辑时间轴', exact: true }).click();
  await expect(page.getByRole('button', { name: '返回蓝图', exact: true })).toBeVisible();
  const library = page.getByRole('complementary', { name: '演出素材库' });
  const addAsset = async (name: string) => {
    await page.getByLabel('搜索演出素材', { exact: true }).fill(name);
    await library.getByRole('button', { name: '添加素材 ' + name, exact: true }).click();
    await page.getByLabel('搜索演出素材', { exact: true }).fill('');
  };
  const folder = library.getByRole('button', { name: '打开文件夹 ' + folderName, exact: true });
  const textSize = await folder.locator('span').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, height: el.clientHeight, scrollHeight: el.scrollHeight }));
  assert.ok(textSize.scroll <= textSize.width + 1 && textSize.scrollHeight <= textSize.height + 1);
  await page.screenshot({ path: path.join(output, '01-library.png') });
  await folder.click(); await expect(library.locator('[aria-current="location"]')).toHaveText(folderName);
  await library.getByRole('button', { name: '全部素材', exact: true }).click();
  await addAsset('暖色背景');
  await expect(page.getByLabel('片段显示时长', { exact: true })).toHaveValue('3');
  await expect(page.locator('.preview-lifetimes')).toHaveCount(0);
  await expect(page.locator('.visual-clip-inspector').getByRole('tab', { name: '基础', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.performance-preview-context, .timeline-playback-settings')).toHaveCount(0);
  await addAsset('暖色背景');
  await expect(page.locator('.timeline-clip')).toHaveCount(2);
  let stored = await save(), graph = stored.blueprints.find(g => g.id === timeline.id)!;
  let model = performanceTimeline(stored, graph);
  assert.deepEqual(model.clips.map(c => c.at), [0, 3]); assert.equal(timelineOverlap(model.clips), undefined);
  // Numeric movement cannot put the second picture on top of the first.
  await page.getByLabel('片段开始秒数', { exact: true }).fill('1'); await page.getByLabel('片段开始秒数', { exact: true }).press('Tab');
  await expect(page.getByLabel('片段开始秒数', { exact: true })).toHaveValue('3');
  const firstId = model.clips[0].nodeId, secondId = model.clips[1].nodeId;
  await page.locator(`[data-node-id="${firstId}"].timeline-clip`).click();
  await page.getByLabel('片段显示时长', { exact: true }).fill('9'); await page.getByLabel('片段显示时长', { exact: true }).press('Tab');
  await expect(page.getByLabel('片段显示时长', { exact: true })).toHaveValue('3');
  const trim = await page.locator(`[data-node-id="${firstId}"].timeline-clip .timeline-resize`).boundingBox(); assert.ok(trim);
  await page.mouse.move(trim.x + trim.width / 2, trim.y + 12); await page.mouse.down(); await page.mouse.move(trim.x + 80, trim.y + 12, { steps: 8 }); await page.mouse.up();
  await expect(page.getByLabel('片段显示时长', { exact: true })).toHaveValue('3');
  // Remove the second clip and add an overlay on another row through drag and drop.
  await page.locator(`[data-node-id="${secondId}"].timeline-clip`).click(); await page.keyboard.press('Delete');
  await expect(page.locator('.timeline-clip')).toHaveCount(1);
  await page.getByRole('button', { name: '轨道', exact: true }).click();
  await folder.click();
  const target = page.locator('.timeline-track[data-track-id]').last();
  await library.getByRole('button', { name: '添加素材 蓝色叠加画面', exact: true }).dragTo(target, { targetPosition: { x: 160, y: 25 } });
  await expect(page.locator('.timeline-clip')).toHaveCount(2);
  await page.getByLabel('片段开始秒数', { exact: true }).fill('0'); await page.getByLabel('片段开始秒数', { exact: true }).press('Tab');
  await seek(.5); await checkColor('red');
  await page.getByRole('button', { name: '上移轨道 轨道 2', exact: true }).click();
  await seek(.5); await checkColor('blue');
  await page.screenshot({ path: path.join(output, '02-clip-editor.png') });
  // A same-track drop finds a gap; Undo restores the compositing layout.
  const blueClip = page.locator('.timeline-clip').filter({ hasText: '蓝色叠加画面' });
  const box = await blueClip.boundingBox(); assert.ok(box);
  const redTrack = page.locator('.timeline-track[data-track-id]').filter({ has: page.locator(`[data-node-id="${firstId}"]`) });
  const redBounds = await redTrack.boundingBox(); assert.ok(redBounds);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, redBounds.y + redBounds.height / 2, { steps: 10 }); await page.mouse.up();
  stored = await save(); graph = stored.blueprints.find(g => g.id === timeline.id)!; model = performanceTimeline(stored, graph); assert.equal(timelineOverlap(model.clips), undefined);
  assert.equal(model.clips.find(c => c.nodeId !== firstId)!.at, 3);
  await page.keyboard.press('Control+z'); await seek(.5); await checkColor('blue');
  await blueClip.click();
  await page.locator('.visual-clip-inspector').getByRole('tab', { name: '可替换参数', exact: true }).click();
  const parameter = page.locator('.visual-parameter-row[data-parameter-key="assetId"]');
  await parameter.getByRole('button', { name: '公开到时间轴', exact: true }).click();
  await page.getByRole('tab', { name: '时间轴组件', exact: true }).click();
  const row = page.locator('.timeline-public-parameter'); await expect(row).toHaveCount(1);
  await row.locator('input').first().fill('可替换图片');
  const boxes = await row.evaluate(el => [...el.children].map(child => child.getBoundingClientRect().toJSON()));
  assert.ok(Math.max(...boxes.map(b => b.y)) < Math.min(...boxes.map(b => b.y + b.height)));
  await page.screenshot({ path: path.join(output, '03-timeline-properties.png') });
  await row.getByRole('button', { name: '移除参数 可替换图片', exact: true }).click(); await expect(row).toHaveCount(0);
  await page.keyboard.press('Control+z'); await expect(row).toHaveCount(1);
  await expect(page.getByRole('tab', { name: '时间轴组件', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: '片段', exact: true })).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByRole('tabpanel', { name: '演出片段参数', exact: true })).toHaveCount(0);
  const beforePreview = await save();
  await page.getByRole('button', { name: '播放预览', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停预览', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '暂停预览', exact: true }).click();
  await seek(.5); await checkColor('blue');
  const afterPreview = await save(); assert.deepEqual(afterPreview, beforePreview);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 768));
  await page.screenshot({ path: path.join(output, '04-narrow.png') });
  const overflow = await page.locator('[data-dock-panel="inspector"] .performance-dock-content').evaluate(el => el.scrollWidth - el.clientWidth); assert.ok(overflow <= 1, 'Inspector horizontal overflow: ' + overflow);
  stored = await save(); graph = stored.blueprints.find(g => g.id === timeline.id)!;
  assert.ok(graph.nodes.filter(n => n.type === 'savedAction').length === 2); assert.equal(graph.nodes.some(n => n.type === 'showBackground'), false);
  await page.evaluate(file => window.studio!.openRecentProject!(file), projectFile);
  await page.reload(); await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await page.locator('[data-workspace-tab="blueprint"]').click(); await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + timeline.id);
  await expect(page.locator('.timeline-clip')).toHaveCount(2); await seek(.5); await checkColor('blue');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks: ['长文件夹完整显示与当前位置导航', '图片直接成为有限时长片段', '同轨添加、数值移动、裁剪与跨轨拖放防重叠', '上轨覆盖下轨且撤销恢复', '普通画面属性与折叠动画参数', '图片素材参数默认展开及清晰的二选一页签', '时间轴每个参数一行及垃圾桶、撤销', '默认素材试播且不写工程，无重复播放与试播设置', '1024窗口无属性横向溢出', '保存重开保留布局与片段'], errors }, null, 2));
} catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); throw error; }
finally { await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => undefined); await app.close(); console.log(output); }
