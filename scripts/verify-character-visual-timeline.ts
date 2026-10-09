import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { expect } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { createBlueprintGraph } from '../src/core/blueprint';
import { blueprintFromPerformance, savedBlueprintAction } from '../src/core/blueprint-authoring';
import { addTimelineComponent } from '../src/core/timeline-component';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { timelineOverlap } from '../src/core/timeline-editing';
import { visibleImageBounds } from '../src/core/portrait';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.');
const output = path.join(root, 'artifacts/character-visual-timeline', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = createProject('角色图片剪辑验收');
for (const [id, name, relative] of [
  ['portrait_normal', '苏怜烟 · 通常', '苏怜烟/21通常.png'],
  ['portrait_smile', '苏怜烟 · 微笑', '苏怜烟/23微笑.png'],
  ['portrait_other', '满穗 · 通常', '满穗/115通常.png'],
] as const) {
  const contents = await fs.readFile(path.join(root, 'resources/templates/aihong/assets/portraits', relative));
  const image = PNG.sync.read(contents);
  await fs.writeFile(path.join(output, id + '.png'), contents);
  project.assets.push({ id, name, kind: 'image', path: id + '.png', width: image.width, height: image.height, visibleBounds: visibleImageBounds(image.data, image.width, image.height) });
}
project.characters = [
  { id: 'hero', name: '苏怜烟', color: '#72c2ad', expressions: [{ id: 'normal', name: '通常', assetId: 'portrait_normal' }, { id: 'smile', name: '微笑', assetId: 'portrait_smile' }], defaultExpressionId: 'normal' },
  { id: 'other', name: '满穗', color: '#e4bd72', expressions: [{ id: 'other_normal', name: '通常', assetId: 'portrait_other' }], defaultExpressionId: 'other_normal' },
];
const owner = createBlueprintGraph('effect', '演出蓝图'); project.blueprints.push(owner);
const { timeline } = addTimelineComponent(project, owner.id);
const legacy = blueprintFromPerformance(project, [{ kind: 'show', characterId: 'hero', expressionId: 'smile', x: .5, y: 1, scale: 1, layer: 10, transition: 'none', duration: 1 }], '旧角色演出');
legacy.timelineComponent = true; project.blueprints.push(legacy);
const legacyModel = performanceTimeline(project, legacy);
arrangePerformanceTimeline(project, legacy, legacyModel.clips, legacyModel.tracks);
const projectFile = path.join(output, 'project.vns.json'); await fs.writeFile(projectFile, JSON.stringify(project));
const app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile'), devUrl: process.env.VNS_CHARACTER_QA_URL });
const page = await app.firstWindow(), errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
const set = async (label: string, value: string) => { const input = page.getByLabel(label, { exact: true }).first(); await input.fill(value); await input.press('Tab'); };
const save = async () => {
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  await expect(page.getByRole('contentinfo')).toContainText('工程已保存');
  return projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
};
const seek = async (time: number) => {
  const ruler = await page.getByLabel('时间标尺', { exact: true }).boundingBox(); assert.ok(ruler);
  await page.mouse.click(ruler.x + 130 + time * 60, ruler.y + 12);
  await expect(page.locator('.timeline-time')).toHaveText(time.toFixed(2) + ' 秒');
};
let phase = 'launch';
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await page.locator('[data-workspace-tab="blueprint"]').click();
  await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + timeline.id);
  const library = page.getByRole('complementary', { name: '演出素材库' });
  await library.getByRole('tab', { name: '角色', exact: true }).click();
  phase = 'add character';
  await library.getByRole('button', { name: '添加角色 苏怜烟', exact: true }).click();
  await expect(page.locator('.timeline-clip')).toHaveCount(1);
  await expect(page.locator('.timeline-clip-thumbnails')).toHaveAttribute('data-thumbnail-asset', 'portrait_normal');
  await expect(page.locator('.timeline-clip-effects')).not.toHaveAttribute('open');
  await expect(page.locator('.timeline-clip-parameters')).not.toHaveAttribute('open');
  await expect(page.getByLabel('片段显示时长', { exact: true })).toHaveValue('3');
  const role = page.locator('.timeline-clip-basics select[aria-label="角色图片角色"]');
  const expression = page.locator('.timeline-clip-basics select[aria-label="角色图片表情"]');
  await expect(role).toHaveValue('hero');
  await expression.selectOption('smile');
  await expect(page.locator('.timeline-clip-thumbnails')).toHaveAttribute('data-thumbnail-asset', 'portrait_smile');
  await role.selectOption('other');
  await expect(page.locator('.timeline-clip-thumbnails')).toHaveAttribute('data-thumbnail-asset', 'portrait_other');
  await role.selectOption('hero'); await expression.selectOption('smile');
  await set('片段名称', '苏怜烟的微笑 · 第一章庭院演出片段');
  await set('片段显示时长', '5'); await set('片段开始秒数', '0.5');
  await set('水平位置 %', '45'); await set('不透明度 %', '80');
  await page.getByLabel('轨道缩放', { exact: true }).selectOption('60');
  await seek(1);
  await expect(page.locator('[data-visual-instance]')).toHaveCount(1);
  await expect(page.locator('[data-visual-instance] image[href]')).toHaveAttribute('href', /portrait_smile\.png/);
  let stored = await save(), graph = stored.blueprints.find(item => item.id === timeline.id)!;
  const firstClip = performanceTimeline(stored, graph).clips[0];
  const first = savedBlueprintAction(graph.nodes.find(item => item.id === firstClip.nodeId)!);
  assert.equal(first?.kind, 'visual'); assert.equal(first?.content, 'image');
  assert.equal(first?.characterId, 'hero'); assert.equal(first?.expressionId, 'smile');
  assert.equal(firstClip.at, .5); assert.equal(firstClip.duration, 5);
  assert.equal(first?.keyframes[0].x, .45); assert.equal(first?.keyframes[0].opacity, .8);
  assert.equal(graph.nodes.some(item => item.type === 'showCharacter'), false);
  await seek(5.6); await expect(page.locator('[data-visual-instance]')).toHaveCount(0);
  await seek(1); await page.screenshot({ path: path.join(output, '01-character-clip.png') });

  phase = 'drag character';
  const emptyTrack = page.locator('.timeline-track[data-track-id="track_performance"]');
  await library.getByRole('button', { name: '添加角色 满穗', exact: true }).dragTo(emptyTrack, { targetPosition: { x: 160, y: 25 } });
  await expect(page.locator('.timeline-clip')).toHaveCount(2);
  await expect(role).toHaveValue('other');
  await expect(page.locator('.timeline-clip-thumbnails[data-thumbnail-asset="portrait_other"]')).toHaveCount(1);
  await page.getByRole('button', { name: '上移轨道 角色 · 苏怜烟 · 通常', exact: true }).click();
  await seek(1);
  await expect(page.locator('[data-visual-instance]')).toHaveCount(2);
  await expect(page.getByLabel('片段开始秒数', { exact: true })).toBeInViewport();
  stored = await save(); graph = stored.blueprints.find(item => item.id === timeline.id)!;
  let model = performanceTimeline(stored, graph);
  assert.equal(timelineOverlap(model.clips), undefined);
  assert.equal(model.tracks[0].id, firstClip.trackId);
  assert.equal(graph.nodes.filter(item => savedBlueprintAction(item)?.kind === 'visual').length, 2);
  const layers = await page.locator('[data-visual-instance]').evaluateAll(elements => elements.map(element => ({ id: element.getAttribute('data-visual-instance'), layer: Number((element as SVGElement).style.zIndex) })));
  assert.ok(layers.find(item => item.id === first?.instanceId)!.layer > layers.find(item => item.id !== first?.instanceId)!.layer);
  await page.screenshot({ path: path.join(output, '02-track-order.png') });

  phase = 'narrow layout';
  await page.locator('.timeline-clip[data-node-id="' + firstClip.nodeId + '"]').click();
  await expect(page.getByLabel('片段开始秒数', { exact: true })).toBeInViewport();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1024, 768));
  await expect.poll(async () => page.locator('[data-dock-panel="inspector"] .performance-dock-content').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  const controls = await page.locator('.timeline-track-name').evaluateAll(elements => elements.map(element => {
    const bounds = element.getBoundingClientRect(), input = element.querySelector('input')!.getBoundingClientRect(), order = element.querySelector('.timeline-track-order')!.getBoundingClientRect();
    return { right: bounds.right, inputRight: input.right, orderLeft: order.left, orderRight: order.right };
  }));
  assert.ok(controls.every(item => item.inputRight <= item.orderLeft && item.orderRight <= item.right));
  await page.screenshot({ path: path.join(output, '03-narrow.png') });

  phase = 'legacy thumbnail';
  await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + legacy.id);
  await expect(page.locator('.timeline-clip-thumbnails')).toHaveAttribute('data-thumbnail-asset', 'portrait_smile');
  await expect(page.locator('.timeline-clip')).toContainText('苏怜烟 · 微笑');
  await page.screenshot({ path: path.join(output, '04-legacy-thumbnail.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  phase = 'reload';
  await page.reload(); await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await page.locator('[data-workspace-tab="blueprint"]').click();
  await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + timeline.id);
  await expect(page.locator('.timeline-clip')).toHaveCount(2);
  await page.locator('.timeline-clip[data-node-id="' + firstClip.nodeId + '"]').click();
  await expect(role).toHaveValue('hero'); await expect(expression).toHaveValue('smile');
  await expect(page.getByLabel('片段显示时长', { exact: true })).toHaveValue('5');
  await expect(page.getByLabel('片段开始秒数', { exact: true })).toHaveValue('0.5');
  await page.getByLabel('轨道缩放', { exact: true }).selectOption('60'); await seek(1);
  await expect(page.locator('[data-visual-instance]')).toHaveCount(2);
  assert.deepEqual(errors, []);
  const browserProject = { ...stored, assets: stored.assets.map(asset => ({ ...asset, path: path.relative(root, path.join(output, asset.path)).replaceAll('\\', '/') })) };
  await fs.writeFile(path.join(output, 'browser-project.vns.json'), JSON.stringify(browserProject));
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', projectFile, checks: ['点击及拖入角色创建普通图片片段', '角色与表情切换同步预览及缩略条', '时长与变换直接编辑且到点隐藏', '上移轨道同步预览层级', '1024窗口属性与轨道标题无横向溢出', '旧角色节点仍显示立绘缩略条', '保存重开保留角色表情及轨道顺序'], errors, layers }, null, 2));
  console.log(output);
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, errors, error: String(error) }, null, 2));
  throw error;
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined);
  await app.close();
}
