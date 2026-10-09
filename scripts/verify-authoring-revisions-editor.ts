import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { createProject, type Project } from '../src/core/model';
import { assetCategoryNames } from '../src/core/asset-library';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { createVisualObject } from '../src/core/visual-object';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), output = path.join(root, 'artifacts/authoring-revisions-editor', new Date().toISOString().replaceAll(':', '-'));
const directory = path.join(output, 'project'), projectFile = path.join(directory, 'project.vns.json');
await fs.mkdir(directory, { recursive: true });
await fs.mkdir(path.join(output, 'source'), { recursive: true });
const base = createProject('分类导入、章节层级与解锁条件验收');
base.width = 800; base.height = 450;
base.parameterSets = [{ id: 'progress_set', name: '剧情进度', kind: 'story' }];
base.variables = [{ id: 'progress', name: '章节进度', type: 'number', initial: 0, persistent: true, parameterSetId: 'progress_set' }];
for (const [id, rgb] of [['red', [220, 40, 40]], ['portrait_actor', [40, 180, 70]]] as const) {
  const png = new PNG({ width: 80, height: 45 });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([...rgb, 255], i);
  await fs.writeFile(path.join(id === 'red' ? directory : path.join(output, 'source'), id + '.png'), PNG.sync.write(png));
}
base.assets = [{ id: 'red', name: '前景图片', kind: 'image', path: 'red.png', category: 'scene', width: 80, height: 45 }];
base.ui.components = [{ id: 'gallery', kind: 'galleryGrid', page: 'gallery', text: '', x: .1, y: .15, width: .8, height: .7, list: { columns: 2, rows: 1, galleryGroups: [{ id: 'chapter_group', name: '章节CG', assetIds: ['red'] }] } }];
const picture = { ...createVisualObject('image', 'red'), name: '前景图片', duration: 2 };
const graph = blueprintFromPerformance(base, [picture, { kind: 'chapter', title: '章节演出', subtitle: '', duration: 4, effect: 'none', wait: false }], '图片与章节');
graph.timelineComponent = true; graph.performanceKind = 'standalone'; graph.playback = { clickSkip: false };
base.blueprints = [graph];
const model = performanceTimeline(base, graph);
arrangePerformanceTimeline(base, graph, model.clips.map(clip => ({ ...clip, at: 0, trackId: graph.nodes.find(node => node.id === clip.nodeId)?.type === 'showChapter' ? 'chapter_track' : 'image_track' })), [{ id: 'image_track', name: '前景图片' }, { id: 'chapter_track', name: '章节演出' }]);
const source = `@入口：正文【story】
# 段落：正文【story】
@图片与章节
旁白：继续剧情。
@设置：如果 章节进度 < 2，章节进度 = 2
@结局演出
@返回标题界面`;
const parsed = applyTextScript(base, source);
assert.deepEqual(parsed.issues, []);
const project = parsed.project;
project.scriptText = { format: 'vns-text-1', content: source, standaloneSyntax: 'module-names' };
const bound = project.nodes.find(node => node.id === 'story');
assert.ok(bound?.kind === 'passage' && bound.lines[0].silent);
bound.lines[0].playback = { clickSkip: true };
project.scriptText.content = projectToText(project);
await saveProject(projectFile, project);
for (const name of Object.values(assetCategoryNames)) assert.ok((await fs.stat(path.join(directory, 'assets', name))).isDirectory());
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } });
await server.listen();
let app: ElectronApplication | undefined, page!: Page, phase = 'launch';
const checks = ['保存工程自动建立分类目录'], errors: string[] = [];
const stored = async () => JSON.parse(await fs.readFile(projectFile, 'utf8')) as Project;
const save = async () => {
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  return stored();
};
const pixel = async () => {
  const png = PNG.sync.read(await page.locator('.preview-stage-frame').screenshot());
  const i = (Math.floor(png.height * .25) * png.width + Math.floor(png.width * .5)) * 4;
  return [...png.data.slice(i, i + 3)];
};
const seek = async (seconds: number) => {
  const box = (await page.getByLabel('时间标尺', { exact: true }).boundingBox())!;
  await page.mouse.click(box.x + 130 + seconds * 100, box.y + 12);
  await expect(page.locator('.timeline-time')).toHaveText(seconds.toFixed(2) + ' 秒');
};
const openTimeline = async () => {
  await page.locator('.view-tabs').getByRole('button', { name: '蓝图', exact: true }).click();
  await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + graph.id);
  await expect(page.locator('.timeline-clip')).toHaveCount(2);
  await page.getByLabel('轨道缩放', { exact: true }).selectOption('100');
};
const openGallery = async () => {
  await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByLabel('设计页面', { exact: true }).selectOption({ label: '画廊' });
  await page.locator('[data-hierarchy-id="gallery"]').click();
};
try {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile'), devUrl: 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 30000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 940));

  phase = 'categorized physical import';
  await page.locator('.view-tabs').getByRole('button', { name: '素材', exact: true }).click();
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, path.join(output, 'source/portrait_actor.png'));
  await page.getByRole('button', { name: '导入素材', exact: true }).click();
  await expect(page.locator('.content-breadcrumb')).toContainText('立绘');
  await expect(page.locator('[data-content-key^="asset:"]')).toHaveCount(1);
  const imported = (await save()).assets.find(asset => asset.name === 'portrait_actor')!;
  assert.equal(imported.category, 'portrait'); assert.match(imported.path, /^assets\/立绘\//);
  assert.deepEqual(await fs.readFile(path.join(directory, imported.path)), await fs.readFile(path.join(output, 'source/portrait_actor.png')));
  await page.getByRole('navigation', { name: '资源文件夹', exact: true }).getByRole('button', { name: '立绘', exact: true }).click();
  await expect(page.locator('[data-content-key="asset:' + imported.id + '"] img')).toBeVisible();
  await page.screenshot({ path: path.join(output, 'categorized-import.png') });
  checks.push('导入图片自动复制到立绘目录，资源树分类和实际图片一致');

  phase = 'chapter preview and playback defaults';
  await openTimeline(); await seek(.5);
  await expect.poll(async () => (await pixel())[0] - (await pixel())[2]).toBeGreaterThan(100);
  await expect(page.locator('.timeline-clip-thumbnails')).toHaveCount(1);
  await page.getByRole('button', { name: '播放设置', exact: true }).click();
  const skip = page.getByLabel('允许点击跳过独立演出', { exact: true });
  await expect(skip).toBeVisible(); await expect(skip).not.toBeChecked();
  await skip.check();
  assert.equal((await save()).blueprints.find(item => item.id === graph.id)!.playback?.clickSkip, true);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(skip).not.toBeChecked(); await save();
  await page.screenshot({ path: path.join(output, 'timeline-playback.png') });
  await seek(2.5);
  await expect.poll(async () => (await pixel())[0]).toBeLessThan(35);
  await seek(.5);
  const grip = (await page.getByRole('button', { name: '拖动轨道 前景图片', exact: true }).boundingBox())!;
  const lower = (await page.locator('[data-track-id="chapter_track"]').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, lower.y + lower.height * .75, { steps: 8 });
  await expect.poll(async () => (await pixel())[0]).toBeLessThan(35);
  await page.mouse.up();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(async () => (await pixel())[0] - (await pixel())[2]).toBeGreaterThan(100);
  checks.push('编辑器预览的图片/章节遮挡随轨道拖动改变，图片到期消失；播放设置入口、修改和撤销有效');

  phase = 'bound call and default scopes';
  await openStoryMode(page, 'text');
  const input = page.getByRole('textbox', { name: '中文文本剧本', exact: true });
  await input.evaluate(element => {
    const input = element as HTMLTextAreaElement, index = input.value.indexOf('@图片与章节');
    input.focus(); input.setSelectionRange(index, index); input.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await input.dispatchEvent('contextmenu', { clientX: 460, clientY: 160 });
  await page.getByRole('menuitem', { name: '在蓝图中编辑演出…', exact: true }).click();
  await page.getByRole('button', { name: '播放设置', exact: true }).click();
  const scope = page.getByRole('combobox', { name: '设置范围', exact: true });
  await expect(scope).toHaveValue('call'); await expect(skip).toBeChecked();
  await scope.selectOption('default'); await expect(skip).not.toBeChecked();
  await scope.selectOption('call'); await skip.uncheck();
  const changed = await save(), story = changed.nodes.find(node => node.id === 'story');
  assert.ok(story?.kind === 'passage'); assert.equal(story.lines[0].playback?.clickSkip, false);
  assert.equal(changed.blueprints.find(item => item.id === graph.id)!.playback?.clickSkip, false);
  checks.push('从剧情进入播放设置可分别编辑当前调用和演出默认值，并保存调用覆盖');

  phase = 'gallery parameter conditions';
  await openGallery();
  const group = page.locator('.gallery-unlock-fields[aria-label="分组解锁条件"]');
  await group.getByRole('combobox').first().selectOption('parameter');
  await group.getByLabel('条件状态', { exact: true }).selectOption('progress');
  await group.getByLabel('比较方式', { exact: true }).selectOption('gte');
  await group.getByLabel('状态值', { exact: true }).fill('2');
  await group.getByLabel('状态值', { exact: true }).blur();
  const variant = page.locator('[data-gallery-variant="red"]');
  await variant.getByText('分镜解锁条件', { exact: true }).click();
  const variantCondition = variant.locator('.gallery-unlock-fields');
  await variantCondition.getByRole('combobox').first().selectOption('parameter');
  await variantCondition.getByLabel('比较方式', { exact: true }).selectOption('gt');
  await variantCondition.getByLabel('状态值', { exact: true }).fill('2');
  await variantCondition.getByLabel('状态值', { exact: true }).blur();
  await page.getByRole('button', { name: '保存界面', exact: true }).click();
  await expect.poll(async () => (await stored()).ui.components.find(c => c.id === 'gallery')!.list!.galleryGroups![0].unlockWhen).toEqual({ kind: 'compare', variableId: 'progress', operator: 'gte', value: 2 });
  assert.deepEqual((await stored()).ui.components.find(c => c.id === 'gallery')!.list!.galleryGroups![0].variantUnlockWhen?.red, { kind: 'compare', variableId: 'progress', operator: 'gt', value: 2 });
  await page.screenshot({ path: path.join(output, 'gallery-group-condition.png') });
  await page.reload(); await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 30000 });
  await openGallery();
  await expect(group.getByLabel('比较方式', { exact: true })).toHaveValue('gte');
  await expect(group.getByLabel('状态值', { exact: true })).toHaveValue('2');
  checks.push('图鉴分组和分镜从参数集中选择章节进度，可设不同比较条件，保存重开保持');

  phase = 'individual gallery image condition';
  await page.getByLabel('启用图鉴分组', { exact: true }).uncheck();
  await page.getByRole('combobox', { name: '图鉴图片', exact: true }).selectOption('red');
  const imageCondition = page.locator('.gallery-unlock-fields[aria-label="解锁条件"]');
  await imageCondition.getByRole('combobox').first().selectOption('parameter');
  await imageCondition.getByLabel('比较方式', { exact: true }).selectOption('gte');
  await imageCondition.getByLabel('状态值', { exact: true }).fill('2');
  await imageCondition.getByLabel('状态值', { exact: true }).blur();
  await page.getByRole('button', { name: '保存界面', exact: true }).click();
  await expect.poll(async () => (await stored()).ui.components.find(c => c.id === 'gallery')!.list!.galleryUnlockWhen?.red).toEqual({ kind: 'compare', variableId: 'progress', operator: 'gte', value: 2 });
  await page.screenshot({ path: path.join(output, 'gallery-image-condition.png') });
  checks.push('不用图鉴分组时也能直接设置每张图片的解锁条件');

  phase = 'small viewport and reload';
  await page.reload(); await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 30000 });
  await openTimeline();
  await page.getByRole('button', { name: '播放设置', exact: true }).click(); await expect(skip).not.toBeChecked();
  for (const [width, height] of [[1100, 800], [780, 850]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height]);
    const workspace = page.getByRole('region', { name: '演出工作区', exact: true });
    assert.ok(await workspace.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
    await expect(skip).toBeVisible();
    await page.screenshot({ path: path.join(output, `timeline-${width}.png`) });
  }
  expect(errors).toEqual([]);
  checks.push('窄窗口可找到播放开关，无页面横向溢出和前端异常');
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors, userProjectModified: false }, null, 2));
  console.log(output);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, errors, error: String(error) }, null, 2));
  console.error(output); throw error;
} finally {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined);
  await app?.close(); await server.close();
}
