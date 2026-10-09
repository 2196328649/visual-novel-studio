import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { expect, type Locator } from '@playwright/test';
import { createProject, projectSchema, type VisualObject } from '../src/core/model';
import { chapterCompositionBlueprint } from '../src/core/chapter-composition-blueprint';
import { rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { compositionObject, compositionTimeline } from '../src/core/composition-timeline';
import { projectToText } from '../src/core/text-script';
import { updateVisualNodeObject } from '../src/core/visual-object';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.'), output = path.join(root, 'artifacts/composition-workspace', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = createProject('组合轨道剪辑验收');
for (const [id, name, color] of [['background', '章节背景素材', [34, 64, 82]], ['alternative', '替换背景', [58, 71, 96]]] as const) {
  const png = new PNG({ width: 640, height: 360 });
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const i = (y * png.width + x) * 4;
    png.data[i] = color[0] + Math.round(x / 40); png.data[i + 1] = color[1] + Math.round(y / 20); png.data[i + 2] = color[2]; png.data[i + 3] = 255;
  }
  const file = path.join(output, id + '.png'); await fs.writeFile(file, PNG.sync.write(png));
  project.assets.push({ id, name, kind: 'image', path: id + '.png', width: 640, height: 360 });
}
const { graph } = chapterCompositionBlueprint(project, { title: '第一章', subtitle: '归途', backgroundId: 'background', duration: 7, effect: 'fade' });
project.blueprints.push(graph);
const node = graph.nodes.find(node => rawSavedBlueprintAction(node)?.kind === 'visual')!;
const original = rawSavedBlueprintAction(node) as VisualObject;
const group = original.children!.find(child => child.name === '整体淡入淡出')!, title = group.children!.find(child => child.name === '章节标题')!;
title.color = '#fff6e5'; group.children!.find(child => child.name === '章节副标题')!.color = '#d4e4ed';
updateVisualNodeObject(node, original);
graph.exposedInputs.find(input => input.name === '章节标题字号')!.defaultValue = 84;
const durationInput = graph.links.find(link => link.toNodeId === node.id && link.toPinId === 'object_duration')!;
graph.exposedInputs.find(input => input.id === graph.nodes.find(node => node.id === durationInput.fromNodeId)!.properties.inputId)!.defaultValue = 14;
const model = performanceTimeline(project, graph); arrangePerformanceTimeline(project, graph, model.clips.map(clip => ({ ...clip, at: 1.1 })), model.tracks);
project.scriptText = { format: 'vns-text-1', standaloneSyntax: 'module-names', content: projectToText(project) };
const projectFile = path.join(output, 'project.vns.json'); await fs.writeFile(projectFile, JSON.stringify(project));
const launch = () => launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
let app = await launch(), page = await app.firstWindow(), phase = 'launch';
const checks: string[] = [], errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
const close = async () => { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())); await app.close(); };
const save = async () => {
  const button = page.getByRole('button', { name: '保存工程', exact: true }); if (await button.isEnabled()) await button.click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  return projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
};
const clip = (name = '章节标题') => page.getByRole('button', { name: '组合片段 ' + name, exact: true });
const field = (name: string) => page.getByLabel(name, { exact: true }).filter({ visible: true });
const openRoot = async () => {
  await page.locator(`.timeline-clip[data-node-id="${node.id}"]`).dblclick({ position: { x: 35, y: 12 } });
  await expect(page.getByLabel('组合剪辑工作区', { exact: true })).toHaveAttribute('data-group-id', original.instanceId);
};
const openInside = async () => {
  await page.getByRole('button', { name: '进入组合 整体淡入淡出', exact: true }).click();
  await expect(page.getByLabel('组合剪辑工作区', { exact: true })).toHaveAttribute('data-group-id', group.instanceId);
};
const zoom = async () => Number(await field('组合轨道画布').getAttribute('data-zoom'));
const seek = async (at: number) => {
  const canvas = field('组合轨道画布');
  await canvas.evaluate(element => { element.scrollLeft = 0; element.scrollTop = 0; });
  const box = await canvas.boundingBox(); assert.ok(box);
  await page.mouse.click(box.x + 200 + at * await zoom(), box.y + 12);
  await expect.poll(async () => Number((await field('组合当前时间').innerText()).split(' / ')[0])).toBeCloseTo(at, 1);
};
const drag = async (item: Locator, deltaSeconds: number, edge?: 'start' | 'end', release = true) => {
  const handle = edge ? item.locator('[data-trim="' + edge + '"]') : item;
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox(); assert.ok(box);
  const x = box.x + (edge ? box.width / 2 : Math.min(45, box.width / 2)), y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + deltaSeconds * await zoom(), y, { steps: 5 });
  if (release) await page.mouse.up();
};
const assertTiming = async (start: number, duration: number) => {
  await expect.poll(async () => Number(await clip().getAttribute('data-start'))).toBeCloseTo(start, 2);
  await expect.poll(async () => Number(await clip().getAttribute('data-duration'))).toBeCloseTo(duration, 2);
};
const order = () => page.locator('.composition-track-row').evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.instanceId));
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.unmaximize(); window.setContentSize(1600, 980); });
  await page.locator('[data-workspace-tab="blueprint"]').click();
  await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + graph.id);
  const baseline = await save();
  phase = 'navigation';
  await openRoot(); await expect(page.locator('.composition-track-row')).toHaveCount(2);
  await page.screenshot({ path: path.join(output, 'root-tracks.png') });
  await openInside(); await clip().click({ position: { x: 35, y: 15 } });
  await expect(field('片段文字内容')).toHaveValue('第一章');
  await page.getByRole('button', { name: '返回上层', exact: true }).click();
  await expect(page.getByLabel('组合剪辑工作区', { exact: true })).toHaveAttribute('data-group-id', original.instanceId);
  await page.getByRole('button', { name: '返回上层', exact: true }).click();
  await expect(field('组合轨道画布')).toHaveCount(0);
  assert.deepEqual((await save()).blueprints, baseline.blueprints);
  checks.push('双击组合进入独立轨道，逐层进入与返回保持工程不变。');

  phase = 'text and bound defaults';
  await openRoot(); await openInside(); await clip().click({ position: { x: 35, y: 15 } }); await seek(3);
  await field('片段文字内容').fill('第二章 · 远行');
  await expect(clip()).toContainText('第二章 · 远行');
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(field('片段文字内容')).toHaveValue('第一章');
  await page.getByRole('button', { name: '重做', exact: true }).click(); await expect(field('片段文字内容')).toHaveValue('第二章 · 远行');
  let saved = await save(), savedGraph = saved.blueprints.find(item => item.id === graph.id)!;
  assert.equal(compositionObject(saved, savedGraph, node.id, title.instanceId).action.text, '第二章 · 远行');
  assert.deepEqual(rawSavedBlueprintAction(savedGraph.nodes.find(item => item.id === node.id)!), original);
  checks.push('选中轨道即可修改标题，自动写入共享输入默认值；原始对象、参数连线、撤销重做正确。');

  phase = 'live drag and cancel';
  await field('组合时间轴吸附').uncheck(); await seek(.5);
  await drag(clip(), 1, undefined, false);
  await assertTiming(1, 14);
  await expect(page.locator(`[data-visual-instance="${title.instanceId}"]`)).toHaveCount(0);
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await assertTiming(0, 14);
  await expect(page.locator(`[data-visual-instance="${title.instanceId}"]`)).toHaveCount(1);
  checks.push('拖动过程同步预览但不写工程，Esc 取消后片段时间与画面完全恢复。');

  phase = 'move and both trim edges';
  await seek(3); await drag(clip(), 1); await assertTiming(1, 14);
  await drag(clip(), -4, 'end'); await assertTiming(1, 10);
  await drag(clip(), 1, 'start'); await assertTiming(2, 9);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await assertTiming(1, 10);
  await page.getByRole('button', { name: '重做', exact: true }).click(); await assertTiming(2, 9);
  saved = await save(); savedGraph = saved.blueprints.find(item => item.id === graph.id)!;
  const edited = compositionObject(saved, savedGraph, node.id, title.instanceId);
  assert.equal(edited.object.startAt, 1); assert.equal(edited.object.duration, 7); assert.equal(edited.action.duration, 9);
  assert.deepEqual(savedGraph.links, graph.links);
  checks.push('拖动移动和两端调时长，2 倍整体时间缩放下仍准确；一次拖动对应一次撤销。');

  phase = 'preview position and keyframes';
  await seek(3);
  const handle = page.locator(`[data-visual-handle="${title.instanceId}"]`), box = await handle.boundingBox(); assert.ok(box);
  const previousX = edited.object.keyframes[0].x;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2, { steps: 5 }); await page.mouse.up();
  saved = await save(); savedGraph = saved.blueprints.find(item => item.id === graph.id)!;
  assert.ok(compositionObject(saved, savedGraph, node.id, title.instanceId).object.keyframes[0].x > previousX + .01);
  await field('关键帧：水平位置 %').click();
  const marker = field('横向位置 %时间轴帧 1'); await expect(marker).toBeVisible();
  const frameTime = Number(await marker.getAttribute('data-time'));
  const markerBox = await marker.boundingBox(); assert.ok(markerBox);
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2); await page.mouse.down();
  await page.mouse.move(markerBox.x + markerBox.width / 2 + await zoom(), markerBox.y + markerBox.height / 2, { steps: 4 }); await page.mouse.up();
  await expect.poll(async () => Number(await marker.getAttribute('data-time'))).toBeCloseTo(frameTime + 1, 1);
  await field('显示组合关键帧').uncheck();
  checks.push('可直接拖动预览中的标题位置，并在同一时间轴上添加、移动关键帧。');

  phase = 'duplicate delete and layer order';
  const count = await page.locator('.composition-track-row').count();
  await field('复制组合片段').click(); await expect(page.locator('.composition-track-row')).toHaveCount(count + 1);
  await field('复制组合片段').click(); await expect(page.locator('.composition-track-row')).toHaveCount(count + 2);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(page.locator('.composition-track-row')).toHaveCount(count + 1);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(page.locator('.composition-track-row')).toHaveCount(count);
  await clip().click({ position: { x: 35, y: 15 } }); await field('复制组合片段').click();
  await field('删除组合片段').click(); await expect(page.locator('.composition-track-row')).toHaveCount(count);
  const previousOrder = await order();
  await field('拖动图层 章节背景').dragTo(field('拖动图层 章节标题'));
  assert.notDeepEqual(await order(), previousOrder);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); assert.deepEqual(await order(), previousOrder);
  checks.push('复制生成独立实例，删除与拖动图层顺序可撤销；连续两次复制也能逐次撤销。');

  phase = 'library drop and hidden clip recovery';
  await seek(1);
  await field('搜索演出素材').fill('替换背景');
  await field('添加素材 替换背景').dragTo(field('组合轨道画布'), { targetPosition: { x: 200 + await zoom(), y: 90 } });
  await expect(clip('替换背景')).toBeVisible();
  await field('组合片段开始时间').fill('20'); await field('组合片段开始时间').press('Tab');
  await expect(clip('替换背景')).toHaveClass(/outside/);
  await page.getByRole('button', { name: '移到开头', exact: true }).click();
  await expect(clip('替换背景')).not.toHaveClass(/outside/);
  saved = await save(); savedGraph = saved.blueprints.find(item => item.id === graph.id)!;
  assert.equal(compositionTimeline(saved, savedGraph, node.id, group.instanceId).children.find(child => child.object.name === '替换背景')!.at, 1.1);
  assert.equal(performanceTimeline(saved, savedGraph).clips[0].duration, 14);
  assert.equal(saved.scriptText?.content, baseline.scriptText?.content);
  checks.push('可从素材库直接拖入图片；超出组合结束时间的片段仍可选择并移回，外层时长和剧本文本保持。');

  phase = 'layout';
  await field('组合轨道缩放').press('End');
  await field('组合轨道画布').evaluate(element => { element.scrollLeft = 300; });
  const canvasBox = await field('组合轨道画布').boundingBox(), nameBox = await page.locator('.composition-track-head').first().boundingBox();
  assert.ok(canvasBox && nameBox && Math.abs(canvasBox.x - nameBox.x) < 2, 'track names must stay pinned while scrolling horizontally');
  await page.getByRole('button', { name: '适合窗口', exact: true }).click();
  await clip().click({ position: { x: 35, y: 15 } }); await seek(6);
  await page.screenshot({ path: path.join(output, 'composition-editor.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 760));
  await page.locator('[data-dock-panel="inspector"] > header').dragTo(page.locator('[data-dock-panel="library"] > header'));
  await expect(page.locator('[data-dock-panel="inspector"]')).toHaveAttribute('data-dock-slot', 'left');
  await expect(field('片段文字内容')).toBeInViewport();
  await expect(page.getByRole('button', { name: '返回上层', exact: true })).toBeInViewport();
  await page.screenshot({ path: path.join(output, 'composition-small.png') });
  checks.push('1100×760 窗口和面板换位后，返回入口、片段属性和轨道均可操作。');

  phase = 'save and reopen';
  const final = await save(); await close(); app = await launch(); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="blueprint"]').click(); await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + graph.id);
  await openRoot(); await openInside(); await clip().click({ position: { x: 35, y: 15 } });
  await expect(field('片段文字内容')).toHaveValue('第二章 · 远行'); await assertTiming(2, 9);
  assert.deepEqual((await save()).blueprints, final.blueprints); assert.deepEqual(errors, []);
  checks.push('完全关闭后重开，文字、时间、图层和关键帧保留，无页面异常。');
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, error: String(error), checks, errors }, null, 2));
  throw error;
} finally { await close(); console.log(output); }
