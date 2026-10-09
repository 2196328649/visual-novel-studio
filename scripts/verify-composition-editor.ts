import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { expect, type Locator } from '@playwright/test';
import { createProject, projectSchema, type Project, type VisualObject } from '../src/core/model';
import { createBlueprintGraph } from '../src/core/blueprint';
import { blueprintFromPerformance, rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { chapterComposition } from '../src/core/chapter-composition';
import { compositionObject } from '../src/core/composition-timeline';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.'), output = path.join(root, 'artifacts/composition-editor', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const templateDir = path.join(root, 'resources/templates/aihong');
const template = projectSchema.parse(JSON.parse(await fs.readFile(path.join(templateDir, 'project.vns.json'), 'utf8')));
const project = createProject('通用演出编辑器 · 从空白重建');
project.width = template.width; project.height = template.height;
project.ui.chapterTransition = structuredClone(template.ui.chapterTransition);
project.ui.pages = { ...project.ui.pages, chapterTitle: structuredClone(template.ui.pages!.chapterTitle) };
project.ui.components = [...project.ui.components.filter(c => c.page !== 'chapterTitle'), ...structuredClone(template.ui.components.filter(c => c.page === 'chapterTitle'))];
project.ui.fontAssetId = template.ui.fontAssetId;
const needed = new Set(['ai_presentation_chapter_one', 'ai_presentation_chapter_two', 'ai_presentation_brush', 'ai_presentation_mask', 'ai_presentation_title_one', 'ai_presentation_title_two', template.ui.fontAssetId!, ...template.ui.components.filter(c => c.page === 'chapterTitle').map(c => c.assetId!)]);
project.assets = structuredClone(template.assets.filter(asset => needed.has(asset.id)));
for (const asset of project.assets) { await fs.mkdir(path.dirname(path.join(output, asset.path)), { recursive: true }); await fs.copyFile(path.join(templateDir, asset.path), path.join(output, asset.path)); }
// The expected composition is a reference only. The authoring timeline below starts empty.
const chapter = { title: '第一章', subtitle: '', effect: 'ink' as const, duration: 7, backgroundId: 'ai_presentation_chapter_one', titleImageId: 'ai_presentation_title_one' };
const expected = chapterComposition(project, chapter).actions.at(-1) as VisualObject;
const reference = blueprintFromPerformance(project, [expected], '参照演出'); reference.timelineComponent = true;
const manual = createBlueprintGraph('effect', '手动重建'), reuse = createBlueprintGraph('effect', '复用验收'); manual.timelineComponent = reuse.timelineComponent = true;
const defaults = createBlueprintGraph('effect', '复用默认值'); defaults.timelineComponent = true;
project.blueprints.push(reference, manual, reuse, defaults);
for (const graph of project.blueprints) { const model = performanceTimeline(project, graph); arrangePerformanceTimeline(project, graph, model.clips, model.tracks); }
const projectFile = path.join(output, 'project.vns.json'); await fs.writeFile(projectFile, JSON.stringify(project));
const app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile'), devUrl: process.env.VNS_COMPOSITION_DEV_URL }), page = await app.firstWindow();
let phase = 'launch'; const checks: string[] = [], errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
const field = (label: string) => page.getByLabel(label, { exact: true }).filter({ visible: true });
const inspector = () => page.locator('.visual-clip-inspector');
const save = async () => {
  const button = page.getByRole('button', { name: '保存工程', exact: true }); if (await button.isEnabled()) await button.click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  return projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
};
const number = async (label: string, value: number) => { await field(label).fill(String(value)); await field(label).press('Tab'); };
const tab = async (name: string) => { await inspector().getByRole('tab', { name, exact: true }).click(); };
const seek = async (at: number, inGroup?: boolean) => {
  const inside = inGroup ?? !!await page.locator('.composition-workspace').count();
  const canvas = inside ? field('组合轨道画布') : page.locator('.timeline-scroll');
  await canvas.evaluate(el => { el.scrollLeft = 0; el.scrollTop = 0; });
  const box = await canvas.boundingBox(); assert.ok(box); const zoom = Number(await canvas.getAttribute('data-zoom'));
  await page.mouse.click(box.x + (inside ? 200 : 130) + at * zoom, box.y + 12);
  await expect.poll(async () => Number((await field(inside ? '组合当前时间' : '当前时间').innerText()).split(inside ? ' / ' : ' 秒')[0])).toBeCloseTo(at, 2);
};
const create = async (name: string, label: string, duration = 7) => {
  await seek(0); await page.getByRole('button', { name: '添加片段', exact: true }).click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
  await number('组合片段开始时间', 0); await number('组合片段时长', duration);
  await field('组合片段名称').fill(name); await field('组合片段名称').press('Tab'); await tab('基础');
};
const asset = async (label: string, id: string) => {
  const name = project.assets.find(asset => asset.id === id)!.name;
  await page.getByRole('button', { name: '浏览' + label, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '预览资源 ' + name, exact: true }).dblclick();
};
const selectClip = async (name: string) => { await page.getByRole('button', { name: '选择片段 ' + name, exact: true }).click(); };
const enter = async (name: string) => { await page.getByRole('button', { name: '进入组合 ' + name, exact: true }).click(); };
const back = async () => { await page.getByRole('button', { name: '返回上层', exact: true }).click(); };
const summary = async (label: string) => { const item = inspector().locator('summary').filter({ hasText: label }); if (!await item.evaluate(el => el.parentElement!.hasAttribute('open'))) await item.click(); };
const setColor = async (value: string) => { await field('片段颜色').fill(value); await field('片段颜色').press('Tab'); };
const currentAction = (stored: Project) => { const graph = stored.blueprints.find(g => g.id === manual.id)!; return performanceTimeline(stored, graph).actionsByNode.get(graph.nodes.find(n => rawSavedBlueprintAction(n)?.kind === 'visual')!.id)![0] as VisualObject; };
const canonical = (object: VisualObject): unknown => ({
  content: object.content, width: object.width, height: object.height, duration: object.duration, startAt: object.startAt ?? 0,
  assetId: ['image', 'video'].includes(object.content) ? object.assetId : undefined,
  imageFit: object.content === 'image' ? object.imageFit ?? 'stretch' : undefined, imageAlign: object.content === 'image' ? object.imageAlign ?? 'center' : undefined,
  color: ['solid', 'particles'].includes(object.content) ? object.color : undefined,
  pose: object.keyframes.map(({ x, y, scale, rotation, opacity, duration, easing }) => ({ x, y, scale, rotation, opacity, duration, easing })),
  curves: object.curves, maskAssetId: object.maskAssetId, ripple: object.ripple,
  glyph: object.glyphParticles ? { ...object.glyphParticles, source: object.glyphParticles.source ?? 'image', seed: object.glyphParticles.seed ?? 0 } : undefined,
  children: object.children ? [...object.children].sort((a, b) => a.layer - b.layer).map(canonical) : undefined,
});
const numericEqual = (actual: unknown, wanted: unknown, key = 'root') => {
  if (typeof wanted === 'number') { assert.equal(typeof actual, 'number', key); assert.ok(Math.abs(Number(actual) - wanted) < 1e-6, `${key}: ${actual} != ${wanted}`); }
  else if (wanted && typeof wanted === 'object') { for (const [name, value] of Object.entries(wanted)) numericEqual((actual as Record<string, unknown>)[name], value, key + '/' + name); }
  else assert.equal(actual, wanted, key);
};
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.unmaximize(); window.setContentSize(1600, 980); });
  await page.locator('[data-workspace-tab="blueprint"]').click(); await field('演出目标').selectOption('graph:' + manual.id);
  await expect(page.locator('.timeline-clip')).toHaveCount(0);
  phase = 'blank root';
  await page.getByRole('button', { name: '添加片段', exact: true }).click(); await page.getByRole('menuitem', { name: '组合片段', exact: true }).click();
  await field('片段名称').fill('标题演出组合'); await field('片段名称').press('Tab'); await number('片段显示时长', 7); await field('同步缩放动画').check();
  await page.getByRole('button', { name: '进入组合', exact: true }).click();
  await expect(page.locator('.composition-track-row')).toHaveCount(0);
  phase = 'root layers';
  await create('黑色底层', '色块片段'); await setColor('#000000');
  await create('整体淡入淡出', '组合片段'); await field('同步缩放动画').check(); await enter('整体淡入淡出');
  const referenceChildren = expected.children!.find(c => c.content === 'group')!.children!;
  phase = 'background';
  const background = referenceChildren.find(c => c.name === '章节背景')!;
  await create(background.name, '图片片段'); await asset('片段图片素材', background.assetId!); await field('片段图片适配').selectOption('cover');
  await number('水平位置 %', background.keyframes[0].x * 100); await number('垂直位置 %', background.keyframes[0].y * 100);
  await tab('动画与效果'); await summary('背景波动'); await field('启用背景波动').check(); await number('波动强度', background.ripple!.strength); await number('波动速度', background.ripple!.speed);
  phase = 'mask';
  const overlay = referenceChildren.find(c => c.name === '笔触遮罩层')!;
  await create(overlay.name, '图片片段'); await asset('片段图片素材', overlay.assetId!); await field('片段图片适配').selectOption('cover');
  await tab('动画与效果'); await summary('遮罩与消散'); await asset('透明度遮罩', overlay.maskAssetId!);
  phase = 'decoration';
  const decoration = referenceChildren.find(c => c.name === '章节标题背景')!;
  await create(decoration.name, '图片片段'); await asset('片段图片素材', decoration.assetId!); await field('片段图片适配').selectOption('stretch');
  phase = 'title image';
  const title = referenceChildren.find(c => c.name === '章节标题')!;
  await create(title.name, '图片片段'); await asset('片段图片素材', title.assetId!); await field('片段图片适配').selectOption('contain'); await field('片段图片垂直对齐').selectOption(title.imageAlign!);
  await number('宽度 %', title.width * 100); await number('高度 %', title.height * 100);
  await number('水平位置 %', (title.curves!.x!.at(-1)!.value) * 100); await number('垂直位置 %', title.keyframes[0].y * 100);
  await tab('动画与效果'); await page.getByRole('button', { name: '笔触消散', exact: true }).click();
  phase = 'glyph particles';
  await page.getByRole('button', { name: '从此图片生成粒子', exact: true }).click();
  await field('组合片段名称').fill('标题字形粒子'); await field('组合片段名称').press('Tab'); await tab('基础');
  const particles = referenceChildren.find(c => c.content === 'particles')!; await setColor(particles.color);
  await tab('动画与效果'); await summary('字形发射');
  for (const [key, label] of [['x', '横向位置'], ['y', '纵向位置'], ['width', '宽度'], ['height', '高度']] as const) await number('字形区域' + label + ' %', particles.glyphParticles!.rect[key] * 100);
  phase = 'entire fade';
  await back(); await page.getByRole('button', { name: '选择当前组合', exact: true }).click(); await tab('动画与效果'); await field('快进时跳过此演出').check(); await summary('独立属性曲线');
  await field('不透明度 %独立曲线').check();
  for (let index = 0; index < expected.curves!.opacity!.length; index++) {
    if (index) await page.getByRole('button', { name: '添加不透明度 %帧', exact: true }).click();
    const frame = expected.curves!.opacity![index]; await number(`不透明度 %帧 ${index + 1} 时间 秒`, frame.at); await number(`不透明度 %帧 ${index + 1} 值`, frame.value * 100); await field(`不透明度 %帧 ${index + 1} 缓动`).selectOption(frame.easing);
  }
  const builtByUi = await save(), actual = currentAction(builtByUi); numericEqual(canonical(actual), canonical(expected));
  console.log('Manual reconstruction data passed');
  assert.equal(actual.chapterPresentation, true); await fs.writeFile(path.join(output, 'manual-title.vns.json'), JSON.stringify(builtByUi));
  await fs.writeFile(path.join(output, 'expected.json'), JSON.stringify(expected, null, 2));
  checks.push('空白时间轴经界面搭建哀鸿第一章标题：黑底、背景波动、笔触蒙板、装饰、题字动画、字形粒子与整体渐隐；解析后结构和时钟相同');
  await page.screenshot({ path: path.join(output, '01-manual-title.png') });
  phase = 'desktop visual parity'; await back();
  const guides = await page.addStyleTag({ content: '.visual-transform-handles,[data-visual-handle]{visibility:hidden !important}' });
  const comparisons: unknown[] = [];
  for (const at of [.5, 2, 3, 4.5, 6]) {
    await field('演出目标').selectOption('graph:' + manual.id); await seek(at, false); await page.waitForTimeout(250);
    const aBytes = await page.locator('.text-stage').screenshot(); await fs.writeFile(path.join(output, `manual-${at}.png`), aBytes);
    await field('演出目标').selectOption('graph:' + reference.id); await seek(at, false); await page.waitForTimeout(250);
    const bBytes = await page.locator('.text-stage').screenshot(); await fs.writeFile(path.join(output, `reference-${at}.png`), bBytes);
    const a = PNG.sync.read(aBytes), b = PNG.sync.read(bBytes); assert.equal(a.width, b.width); assert.equal(a.height, b.height);
    let sum = 0, peak = 0; for (let i = 0; i < a.data.length; i++) if (i % 4 !== 3) { const delta = Math.abs(a.data[i] - b.data[i]); sum += delta; peak = Math.max(peak, delta); }
    const mae = sum / (a.width * a.height * 3); comparisons.push({ at, mae, peak }); assert.ok(mae < .15, `desktop parity at ${at}: ${mae}`);
  }
  await guides.evaluate(el => el.parentNode?.removeChild(el)); checks.push('桌面五个采样时刻与参照演出一致');
  phase = 'direct transforms'; await field('演出目标').selectOption('graph:' + manual.id);
  await page.locator('.timeline-clip').dblclick({ position: { x: 35, y: 12 } }); await enter('整体淡入淡出'); await selectClip('章节标题'); await tab('基础'); await seek(2);
  const titleId = actual.children![1].children!.find(c => c.name === '章节标题')!.instanceId;
  const handle = page.locator(`[data-visual-handle="${titleId}"]`); const box = await handle.boundingBox(); assert.ok(box);
  const originalX = Number(await field('水平位置 %').inputValue());
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 15, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => Number(await field('水平位置 %').inputValue())).toBeGreaterThan(originalX + 1);
  await page.keyboard.press('Control+z'); await expect.poll(async () => Number(await field('水平位置 %').inputValue())).toBeCloseTo(originalX, 2);
  const scale = page.locator(`[data-visual-scale="${titleId}"]`).last(), scaleBox = await scale.boundingBox(); assert.ok(scaleBox); assert.ok(scaleBox.width >= 12);
  await page.mouse.move(scaleBox.x + 7, scaleBox.y + 7); await page.mouse.down(); await page.mouse.move(scaleBox.x + 7 + 20, scaleBox.y + 7 + 10, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => Number(await field('缩放 %').inputValue())).toBeGreaterThan(105); await page.keyboard.press('Control+z');
  const rotate = page.locator(`[data-visual-rotate="${titleId}"]`), rotateBox = await rotate.boundingBox(); assert.ok(rotateBox);
  await page.mouse.move(rotateBox.x + 7, rotateBox.y + 7); await page.mouse.down(); await page.mouse.move(rotateBox.x + 42, rotateBox.y + 20, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => Math.abs(Number(await field('旋转 °').inputValue()))).toBeGreaterThan(5); await page.keyboard.press('Control+z');
  const cancelBox = await handle.boundingBox(); assert.ok(cancelBox); await page.mouse.move(cancelBox.x + cancelBox.width / 2, cancelBox.y + cancelBox.height / 2); await page.mouse.down(); await page.mouse.move(cancelBox.x + cancelBox.width / 2 + 30, cancelBox.y + cancelBox.height / 2, { steps: 4 }); await page.keyboard.press('Escape'); await page.mouse.up();
  await expect.poll(async () => Number(await field('水平位置 %').inputValue())).toBeCloseTo(originalX, 2); checks.push('嵌套预览直接移动、缩放、旋转；撤销和 Escape 取消');
  phase = 'hide and solo';
  await page.getByRole('button', { name: '隐藏轨道 章节标题', exact: true }).click(); await expect(handle).toHaveCount(0);
  await page.getByRole('button', { name: '隐藏轨道 章节标题', exact: true }).click(); await expect(handle).toHaveCount(1);
  await page.getByRole('button', { name: '独显轨道 章节标题', exact: true }).click(); await expect(page.locator('[data-visual-instance]')).toHaveCount(3);
  await page.getByRole('button', { name: '恢复全部预览', exact: true }).click(); checks.push('组合图层隐藏和独显可恢复');
  phase = 'nested public parameters'; await tab('可替换参数');
  await inspector().locator('[data-parameter-key="assetId"]').getByRole('button', { name: '公开到上层组合', exact: true }).click();
  await selectClip('标题字形粒子'); await tab('可替换参数');
  await field('关联已有参数 字形图片').selectOption({ label: '对象图片' });
  await selectClip('章节背景'); await tab('可替换参数'); await inspector().locator('[data-parameter-key="assetId"]').getByRole('button', { name: '公开到上层组合', exact: true }).click();
  await page.getByRole('button', { name: '选择当前组合', exact: true }).click(); await tab('可替换参数');
  const parameterRows = inspector().locator('.visual-parameter-row').filter({ has: page.locator('input[aria-label^="组合参数名称"]') });
  await expect(parameterRows).toHaveCount(2);
  await parameterRows.first().locator('input[aria-label^="组合参数名称"]').fill('题字图片'); await parameterRows.first().locator('input[aria-label^="组合参数名称"]').press('Tab');
  await parameterRows.last().locator('input[aria-label^="组合参数名称"]').fill('背景图片'); await parameterRows.last().locator('input[aria-label^="组合参数名称"]').press('Tab');
  for (let i = 0; i < 2; i++) await parameterRows.nth(i).getByRole('button', { name: '公开到上层组合', exact: true }).click();
  await back(); await page.getByRole('button', { name: '选择当前组合', exact: true }).click(); await tab('可替换参数');
  const rootRows = inspector().locator('.visual-parameter-row').filter({ has: page.locator('input[aria-label^="组合参数名称"]') }); await expect(rootRows).toHaveCount(2);
  for (let i = 0; i < 2; i++) await rootRows.nth(i).getByRole('button', { name: '公开到时间轴', exact: true }).click();
  await page.getByRole('button', { name: '保存为组合资源', exact: true }).click();
  let stored = await save(); const resource = stored.blueprints.find(graph => graph.visualComposition)!; assert.ok(resource);
  checks.push('图片与粒子共享同一参数，逐层公开到内组合、根组合、时间轴并保存资源');
  phase = 'resource reuse'; await field('演出目标').selectOption('graph:' + reuse.id);
  const library = page.getByRole('complementary', { name: '演出素材库' }); await library.getByRole('tab', { name: '组合', exact: true }).click();
  await library.getByRole('button', { name: '添加组合资源 标题演出组合', exact: true }).click();
  await tab('可替换参数'); await asset('参数值 题字图片', 'ai_presentation_title_two');
  stored = await save(); const reuseGraph = stored.blueprints.find(graph => graph.id === reuse.id)!, reuseNode = reuseGraph.nodes.find(node => rawSavedBlueprintAction(node)?.kind === 'visual')!;
  const instance = rawSavedBlueprintAction(reuseNode) as VisualObject, resolved = compositionObject(stored, reuseGraph, reuseNode.id, instance.instanceId).action;
  const all = (object: VisualObject): VisualObject[] => [object, ...(object.children ?? []).flatMap(all)];
  assert.equal(all(resolved).find(object => object.name === '章节标题')!.assetId, 'ai_presentation_title_two');
  assert.equal(all(resolved).find(object => object.content === 'particles')!.glyphParticles!.assetId, 'ai_presentation_title_two');
  await field('演出目标').selectOption('graph:' + defaults.id); await library.getByRole('tab', { name: '组合', exact: true }).click(); await library.getByRole('button', { name: '添加组合资源 标题演出组合', exact: true }).click();
  await field('演出目标').selectOption('graph:' + reuse.id); await page.locator(`.timeline-clip[data-node-id="${reuseNode.id}"]`).click({ position: { x: 45, y: 12 } });
  await page.getByRole('button', { name: '编辑组合资源', exact: true }).click(); await expect(field('演出目标')).toHaveValue('graph:' + resource.id);
  await page.locator('.timeline-clip').dblclick({ position: { x: 35, y: 12 } }); await enter('整体淡入淡出'); await selectClip('章节背景'); await tab('动画与效果'); await summary('背景波动'); await number('波动速度', .075);
  await back(); await back(); await page.getByRole('button', { name: '返回上层时间轴', exact: true }).click(); await expect(field('演出目标')).toHaveValue('graph:' + reuse.id);
  stored = await save();
  for (const graphId of [reuse.id, defaults.id]) {
    const resolved = performanceTimeline(stored, stored.blueprints.find(g => g.id === graphId)!).actionsByNode.values().next().value![0] as VisualObject;
    const leaves = all(resolved); assert.equal(leaves.find(c => c.name === '章节背景')!.ripple!.speed, .075);
    assert.equal(leaves.find(c => c.name === '章节标题')!.assetId, graphId === reuse.id ? 'ai_presentation_title_two' : 'ai_presentation_title_one');
  }
  await fs.writeFile(path.join(output, 'resource-instances.vns.json'), JSON.stringify(stored));
  checks.push('资源跨时间轴复用，替换题字及粒子来源；从界面修改资源同步到两个实例，实例参数独立，资源导航可返回');
  phase = 'multi select group'; await page.locator(`.timeline-clip[data-node-id="${reuseNode.id}"]`).click({ position: { x: 45, y: 12 } }); await tab('基础');
  await page.getByRole('button', { name: '轨道', exact: true }).click(); await seek(0, false);
  await library.getByRole('tab', { name: '添加', exact: true }).click(); await library.getByRole('button', { name: '文字', exact: true }).click();
  await field('片段名称').fill('通用文字'); await field('片段名称').press('Tab'); await number('片段开始秒数', 0);
  await tab('动画与效果'); await page.getByRole('button', { name: '滑入', exact: true }).click();
  await page.locator(`.timeline-clip[data-node-id="${reuseNode.id}"]`).click({ modifiers: ['Control'], position: { x: 45, y: 12 } });
  await expect(page.locator('.timeline-clip[data-multiselected="true"]')).toHaveCount(2);
  await page.locator(`.timeline-clip[data-node-id="${reuseNode.id}"]`).click({ button: 'right', position: { x: 45, y: 12 } });
  await page.getByRole('menuitem', { name: '制作组合', exact: true }).click(); await expect(page.locator('.timeline-clip')).toHaveCount(1);
  await page.getByRole('button', { name: '进入组合', exact: true }).click(); await expect(page.locator('.composition-track-row')).toHaveCount(2);
  await field('隐藏不相关内容').check(); await field('隐藏不相关内容').uncheck();
  await selectClip('通用文字'); await page.getByRole('button', { name: '组合片段 通用文字', exact: true }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '复制片段', exact: true })).toBeVisible(); await page.keyboard.press('Escape');
  checks.push('多选右键制作组合，内外添加和右键菜单一致，文字动画和隔离开关可用');
  phase = 'narrow window'; await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 740));
  await page.getByRole('button', { name: '添加片段', exact: true }).click(); const menuBox = await page.getByRole('menu', { name: '添加片段菜单', exact: true }).boundingBox(); assert.ok(menuBox); assert.ok(menuBox.x >= 0 && menuBox.y >= 0 && menuBox.x + menuBox.width <= 1101 && menuBox.y + menuBox.height <= 741);
  await page.screenshot({ path: path.join(output, '02-narrow-menu.png') }); await page.keyboard.press('Escape'); await save(); checks.push('1100×740 窗口菜单在可视区域，面板可滚动');
  assert.deepEqual(errors, []); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, comparisons, source: projectFile, manualTitle: path.join(output, 'manual-title.vns.json') }, null, 2)); console.log(output);
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ phase, error: String(error), errors }, null, 2)); console.error(output, phase); throw error;
} finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined); await app.close(); }
