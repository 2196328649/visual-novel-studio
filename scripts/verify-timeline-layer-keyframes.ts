import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { projectGraphs } from '../src/core/project-resources';
import path from 'node:path';
import { createServer } from 'vite';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { createProject, type Project } from '../src/core/model';
import { blueprintFromPerformance, rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { createVisualObject } from '../src/core/visual-object';
import { projectToText } from '../src/core/text-script';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

const root = path.resolve('.'), output = path.join(root, 'artifacts/timeline-layer-keyframes', new Date().toISOString().replaceAll(':', '-'));
const propertiesOnly = process.argv.includes('--properties-only');
const directory = path.join(output, 'project'), projectFile = path.join(directory, 'project.vns.json');
await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
await fs.mkdir(path.join(output, 'source'), { recursive: true });
const project = createProject('轨道层级、关键帧与资源验收'), checks: string[] = [], errors: string[] = [];
for (const [id, rgb] of [['red', [220, 45, 70]], ['blue', [35, 105, 220]]] as const) {
  const png = new PNG({ width: 120, height: 80 });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([...rgb, 255], i);
  const externalPath = id === 'blue' ? path.join(output, 'source/blue.png') : undefined;
  await fs.writeFile(externalPath ?? path.join(directory, 'assets', id + '.png'), PNG.sync.write(png));
  project.assets.push({ id, name: id === 'red' ? '红图' : '蓝图', kind: 'image', path: 'assets/' + id + '.png', ...(externalPath ? { externalPath } : {}), width: 120, height: 80 });
}
const red = createVisualObject('image', 'red'), blue = createVisualObject('image', 'blue');
red.instanceId = 'red_object'; red.name = '红图前景'; red.duration = blue.duration = 4; red.width = blue.width = .8; red.height = blue.height = .8;
blue.instanceId = 'blue_object'; blue.name = '蓝图背景';
const graph = blueprintFromPerformance(project, [red, blue], '图片时间轴'); graph.performanceKind = 'standalone'; graph.timelineComponent = true;
const text = createVisualObject('text'), group = createVisualObject('group');
text.instanceId = 'title_text'; text.name = '文字子片段'; text.text = '时间轴属性'; text.duration = 4;
group.instanceId = 'title_group'; group.name = '标题组合'; group.duration = 5; group.children = [{ ...text, startAt: .5 }];
const composition = blueprintFromPerformance(project, [group], '组合属性验收'); composition.timelineComponent = true;
project.blueprints = [graph, composition];
const initial = performanceTimeline(project, graph);
const redId = initial.clips[0].nodeId, blueId = initial.clips[1].nodeId;
arrangePerformanceTimeline(project, graph, initial.clips.map((clip, index) => ({ ...clip, at: 0, trackId: index ? 'blue_track' : 'red_track' })), [{ id: 'red_track', name: '前景红图' }, { id: 'blue_track', name: '背景蓝图' }]);
const passage = project.nodes.find(node => node.kind === 'passage')!;
passage.lines = [{ id: 'performance', text: '', silent: true, actions: [{ kind: 'blueprint', blueprintId: graph.id }], playback: { clickSkip: false, transition: { mode: 'color', outDuration: .3, hold: .2, inDuration: .3, color: '#000000' } } }];
project.characters.push({ id: 'actor', name: '测试角色', color: '#dc2d46', expressions: [{ id: 'normal', name: '默认', assetId: 'red' }] });
project.scriptText = { format: 'vns-text-1', content: projectToText(project), standaloneSyntax: 'module-names' };
await saveProject(projectFile, project);
const server = process.argv.includes('--compiled') ? undefined : await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } });
await server?.listen();
let app: ElectronApplication | undefined, phase = 'launch';
let page!: Page;
const layouts: unknown[] = [];
const open = async () => {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile'), devUrl: server ? 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port : undefined });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 30000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 940));
  await page.locator('.view-tabs').getByRole('button', { name: '蓝图', exact: true }).click();
  await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + graph.id);
  await expect(page.locator('.timeline-clip')).toHaveCount(2);
  await page.getByLabel('轨道缩放', { exact: true }).selectOption('100');
};
const save = async () => {
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  return JSON.parse(await fs.readFile(projectFile, 'utf8')) as Project;
};
const pixel = async () => {
  const png = PNG.sync.read(await page.locator('.preview-stage-frame').screenshot());
  return [...png.data.subarray((Math.floor(png.height * .35) * png.width + Math.floor(png.width * .5)) * 4)].slice(0, 3);
};
const color = async (channel: number) => expect.poll(async () => { const p = await pixel(); return p[channel] - p[1 - channel]; }).toBeGreaterThan(100);
const seek = async (seconds: number) => {
  const ruler = page.getByLabel('时间标尺', { exact: true }), bounds = (await ruler.boundingBox())!;
  const zoom = await page.getByLabel('轨道缩放', { exact: true }).inputValue();
  await page.mouse.click(bounds.x + 130 + seconds * Number(zoom), bounds.y + 12);
  await expect(page.locator('.timeline-time')).toHaveText(seconds.toFixed(2) + ' 秒');
};
const inspectPropertyLayout = async (name: string) => {
  const rows = await page.locator('.timeline-property-value').evaluateAll(elements => elements.map(element => ({
    label: element.querySelector('.field-label')!.textContent,
    row: element.getBoundingClientRect().toJSON(),
    text: element.querySelector('.field-label')!.getBoundingClientRect().toJSON(),
    input: element.querySelector('input')!.getBoundingClientRect().toJSON(),
    buttons: [...element.querySelectorAll('button')].map(button => button.getBoundingClientRect().toJSON()),
  })));
  assert.ok(rows.length >= 5);
  for (const row of rows) {
    assert.ok(row.input.width >= 56, `${name} / ${row.label}: 数值框过窄`);
    assert.equal(row.buttons.length, 3);
    for (const button of row.buttons) {
      assert.ok(Math.abs(button.y + button.height / 2 - row.input.y - row.input.height / 2) <= 1, `${name} / ${row.label}: 数值和关键帧未对齐`);
      assert.ok(button.x >= row.input.x + row.input.width - 1 && button.x + button.width <= row.row.x + row.row.width + 1);
    }
    if (row.row.width > 199) {
      assert.ok(Math.abs(row.text.y + row.text.height / 2 - row.input.y - row.input.height / 2) <= 1, `${name} / ${row.label}: 标签未同行`);
      assert.ok(row.row.height <= 38, `${name} / ${row.label}: 行间距过大`);
    }
  }
  const overflow = await page.locator('.timeline-inspector').evaluate(element => element.scrollWidth - element.clientWidth);
  assert.ok(overflow <= 1, `${name}: 属性面板横向溢出 ${overflow}px`);
  layouts.push({ name, rows, overflow });
};
try {
  await open();
  await seek(.5);
  await color(0);
  await expect(page.locator('.timeline-clip-thumbnails')).toHaveCount(2);
  expect(await page.locator('.timeline-clip-thumbnails').evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundImage).every(value => value !== 'none'))).toBe(true);
  checks.push('图片片段显示实际缩略图；前景轨道覆盖背景，截图像素为红色。');

  phase = 'live track reorder';
  const grip = (await page.getByRole('button', { name: '拖动轨道 前景红图', exact: true }).boundingBox())!;
  const lower = (await page.locator('[data-track-id="blue_track"]').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, lower.y + lower.height * .75, { steps: 8 });
  await expect.poll(async () => (await pixel())[2] - (await pixel())[0]).toBeGreaterThan(100);
  const diskBefore = JSON.parse(await fs.readFile(projectFile, 'utf8')) as Project;
  expect(performanceTimeline(diskBefore, projectGraphs(diskBefore).find(item => item.id === graph.id)!).tracks[0].id).toBe('red_track');
  await page.screenshot({ path: path.join(output, 'drag-before-release.png') });
  await page.mouse.up();
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await color(0);
  checks.push('轨道拖动未松手时遮挡已变蓝，原文件未变；松手后一次撤销恢复。');

  phase = 'live clip drag';
  await page.getByLabel('时间轴吸附', { exact: true }).uncheck();
  const redClip = page.locator('.timeline-clip[data-node-id="' + redId + '"]');
  const box = (await redClip.boundingBox())!, zoom = Number(await page.getByLabel('轨道缩放', { exact: true }).inputValue());
  await page.mouse.move(box.x + 30, box.y + 18); await page.mouse.down(); await page.mouse.move(box.x + 30 + zoom, box.y + 18, { steps: 8 });
  await expect(redClip).toHaveAttribute('data-start', '1');
  await expect.poll(async () => (await pixel())[2] - (await pixel())[0]).toBeGreaterThan(100);
  await page.mouse.up(); await page.getByRole('button', { name: '撤销', exact: true }).click(); await color(0);
  checks.push('拖动图片片段到未来时，当前画面立即移除它，撤销恢复。');

  phase = 'keyframes';
  await redClip.click({ position: { x: 30, y: 20 } });
  await seek(1);
  let input = page.getByRole('spinbutton', { name: '水平位置 %', exact: true });
  let diamond = page.getByRole('button', { name: '关键帧：水平位置 %', exact: true });
  await inspectPropertyLayout('1440px 常规窗口');
  const label = page.locator('.timeline-property-value').filter({ has: input }).locator('.field-label');
  const labelBox = (await label.boundingBox())!, originalValue = await input.inputValue();
  await page.mouse.move(labelBox.x + labelBox.width / 2, labelBox.y + labelBox.height / 2);
  await page.mouse.down(); await page.mouse.move(labelBox.x + labelBox.width / 2 + 25, labelBox.y + labelBox.height / 2, { steps: 5 }); await page.mouse.up();
  await expect.poll(async () => Number(await input.inputValue())).toBeGreaterThan(Number(originalValue));
  const draggedValue = await input.inputValue();
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(input).toHaveValue(originalValue);
  await page.getByRole('button', { name: '重做', exact: true }).click(); await expect(input).toHaveValue(draggedValue);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(input).toHaveValue(originalValue);
  checks.push('属性名、数值、三个关键帧按钮同行；属性名拖动与一次撤销/重做正常。');
  await diamond.click(); await expect(diamond).toHaveAttribute('aria-pressed', 'true');
  await input.fill('30'); await input.blur();
  await seek(3); await input.fill('70'); await input.blur();
  await seek(2); await expect(input).toHaveValue('50');
  await page.getByRole('button', { name: '上一帧：水平位置 %', exact: true }).click(); await expect(input).toHaveValue('30');
  await page.getByRole('button', { name: '下一帧：水平位置 %', exact: true }).click(); await expect(input).toHaveValue('70');
  await diamond.click(); await expect(diamond).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(diamond).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('spinbutton', { name: '不透明度 %', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'keyframes-desktop.png') });
  let saved = await save();
  const action = rawSavedBlueprintAction(projectGraphs(saved).find(item => item.id === graph.id)!.nodes.find(node => node.id === redId)!);
  assert.ok(action?.kind === 'visual'); assert.equal(action.curves?.x?.find(frame => frame.at === 1)?.value, .3); assert.equal(action.curves?.x?.find(frame => frame.at === 3)?.value, .7);
  checks.push('属性菱形添加关键帧，修改自动写入当前时刻，插值/上一帧/下一帧/删除/撤销及保存通过。');

  if (!propertiesOnly) {
  phase = 'resource copy';
  await page.locator('[data-workspace-tab="assets"]').click();
  await page.getByLabel('资源显示范围', { exact: true }).selectOption('all'); await page.getByLabel('搜索资源和蓝图', { exact: true }).fill('红图');
  const redAsset = page.locator('[data-content-key="asset:red"]');
  await redAsset.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '在文件资源管理器中查看', exact: true })).toBeEnabled();
  await app!.evaluate(({ shell }) => { shell.showItemInFolder = file => { (globalThis as typeof globalThis & { qaRevealed?: string }).qaRevealed = file; }; });
  await page.getByRole('menuitem', { name: '在文件资源管理器中查看', exact: true }).click();
  await expect.poll(() => app!.evaluate(() => (globalThis as typeof globalThis & { qaRevealed?: string }).qaRevealed)).toBe(path.join(directory, saved.assets.find(asset => asset.id === 'red')!.path));
  await page.getByLabel('搜索资源和蓝图', { exact: true }).fill('');
  await redAsset.click({ button: 'right' });
  await page.getByRole('menuitem', { name: /复制.*Ctrl\+C/ }).click();
  await page.getByLabel('资源列表', { exact: true }).focus(); await page.keyboard.press('Control+v');
  await expect(page.locator('[data-content-key^="asset:"]')).toHaveCount(3);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('[data-content-key^="asset:"]')).toHaveCount(2);
  checks.push('右键素材复制、粘贴和撤销可用，文件资源管理器调用解析为实际素材路径；引用图片渲染正常。');

  phase = 'resource settings';
  await page.getByRole('button', { name: '作品设置', exact: true }).click();
  await page.getByRole('button', { name: '资源管理', exact: true }).click();
  await page.getByLabel('素材导入方式', { exact: true }).selectOption('reference');
  await page.getByLabel('项目资源文件夹', { exact: true }).fill('media/images');
  await page.getByLabel('项目资源文件夹', { exact: true }).blur();
  await page.getByRole('button', { name: '关闭作品设置', exact: true }).click();
  saved = await save(); expect(saved.resourceSettings).toMatchObject({ importMode: 'reference', directory: 'media/images' });
  checks.push('资源导入方式和项目资源文件夹保存为作者设置。');

  phase = 'character folders';
  await page.locator('.view-tabs').getByRole('button', { name: '角色', exact: true }).click();
  const library = page.locator('.character-library');
  await library.getByRole('button', { name: '新建文件夹', exact: true }).click();
  await page.getByLabel('角色文件夹名称', { exact: true }).fill('主要角色');
  await library.getByRole('button', { name: '创建', exact: true }).click();
  await library.getByRole('button', { name: /全部角色/ }).click();
  await page.locator('[data-character-id="actor"]').click();
  const folder = await page.getByLabel('角色所在文件夹', { exact: true }).locator('option').filter({ hasText: '主要角色' }).getAttribute('value');
  await page.getByLabel('角色所在文件夹', { exact: true }).selectOption(folder!);
  await library.getByRole('navigation', { name: '角色文件夹导航', exact: true }).getByRole('button', { name: /主要角色/ }).click();
  await expect(page.locator('[data-character-id="actor"]')).toBeVisible();
  await expect(page.locator('.character-breadcrumb')).toContainText('主要角色');
  await expect(page.locator('.character-inspector-section').first()).toBeVisible();
  await page.screenshot({ path: path.join(output, 'characters-desktop.png') });
  await save(); checks.push('创建文件夹、移动角色、目录导航和属性分组可用。');
  }

  phase = 'reopen';
  await app!.close(); app = undefined; await open(); await seek(2);
  input = page.getByRole('spinbutton', { name: '水平位置 %', exact: true });
  diamond = page.getByRole('button', { name: '关键帧：水平位置 %', exact: true });
  await page.locator('.timeline-clip[data-node-id="' + redId + '"]').click({ position: { x: 25, y: 16 } });
  await expect(page.getByRole('spinbutton', { name: '水平位置 %', exact: true })).toHaveValue('50');
  expect(performanceTimeline(JSON.parse(await fs.readFile(projectFile, 'utf8')), graph).clips.find(clip => clip.nodeId === blueId)?.at).toBe(0);
  checks.push('退出重开后关键帧插值和片段位置保持。');
  for (const [width, height] of [[1100, 800], [1024, 768]]) {
    await app!.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height]);
    await inspectPropertyLayout(width + 'px 窄窗口');
    const workspace = page.getByRole('region', { name: '演出工作区', exact: true });
    expect(await workspace.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.getByRole('spinbutton', { name: '不透明度 %', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'timeline-' + width + '.png') });
  }
  checks.push('1100px 和 1024px 窗口数值/关键帧同行，数值框可编辑，属性面板无横向溢出。');
  phase = 'narrow property controls';
  await page.getByRole('separator', { name: '调整右侧面板宽度', exact: true }).press('ArrowRight');
  await inspectPropertyLayout('1024px 手动缩窄属性面板');
  await page.getByRole('spinbutton', { name: '水平位置 %', exact: true }).fill('55');
  await page.getByRole('spinbutton', { name: '水平位置 %', exact: true }).press('Tab');
  await expect(diamond).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '水平位置 %', exact: true })).toHaveValue('50');
  await page.getByRole('button', { name: '上一帧：水平位置 %', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '水平位置 %', exact: true })).toHaveValue('30');
  await page.getByRole('spinbutton', { name: '不透明度 %', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'timeline-compact-dock.png') });
  await page.getByRole('separator', { name: '调整右侧面板宽度', exact: true }).press('Home');

  phase = 'composition properties';
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 940));
  await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + composition.id);
  await page.locator('.timeline-clip').click();
  await inspectPropertyLayout('组合外层变换');
  await page.getByRole('button', { name: '进入组合', exact: true }).click();
  await page.getByRole('button', { name: '选择片段 文字子片段', exact: true }).click();
  const canvas = page.getByLabel('组合轨道画布', { exact: true });
  const groupSeek = async (seconds: number) => {
    await canvas.evaluate(element => { element.scrollLeft = 0; element.scrollTop = 0; });
    const bounds = (await canvas.boundingBox())!, zoom = Number(await canvas.getAttribute('data-zoom'));
    await page.mouse.click(bounds.x + 200 + seconds * zoom, bounds.y + 12);
    await expect.poll(async () => Number((await page.getByLabel('组合当前时间', { exact: true }).innerText()).split(' / ')[0])).toBeCloseTo(seconds, 1);
  };
  await groupSeek(1);
  await inspectPropertyLayout('组合内部文字片段');
  await diamond.click();
  const rotation = page.getByRole('spinbutton', { name: '旋转 °', exact: true });
  await rotation.fill('15'); await rotation.press('Tab');
  await page.getByRole('button', { name: '关键帧：旋转 °', exact: true }).click();
  await expect(page.getByRole('button', { name: '关键帧：旋转 °', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('spinbutton', { name: '不透明度 %', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'composition-properties.png') });
  await groupSeek(0);
  await expect(diamond).toBeDisabled();
  await expect(input).toBeDisabled();
  await groupSeek(1);
  await expect(diamond).toBeEnabled();
  await expect(input).toBeEnabled();
  saved = await save();
  const savedGroup = [...performanceTimeline(saved, projectGraphs(saved).find(item => item.id === composition.id)!).actionsByNode.values()].flat().find(item => item.kind === 'visual');
  assert.ok(savedGroup?.kind === 'visual');
  const savedText = savedGroup.children!.find(item => item.instanceId === text.instanceId)!;
  assert.equal(savedText.keyframes[0].rotation, 15);
  assert.ok(savedText.curves?.x?.length && savedText.curves.rotation?.length);
  await fs.writeFile(path.join(output, 'composition-saved.json'), JSON.stringify(savedGroup, null, 2));
  checks.push('组合外层和文字子片段共用紧凑属性行；数值、关键帧、片段范围外禁用与保存通过。');
  expect(errors).toEqual([]);
  if (!propertiesOnly) {
  phase = 'bound performance preview';
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 940));
  await page.locator('.view-tabs').getByRole('button', { name: '剧本', exact: true }).click();
  await page.locator('.line-effects').getByRole('button', { name: '编辑演出', exact: true }).first().click();
  await page.getByLabel('轨道缩放', { exact: true }).selectOption('100');
  await seek(4.4);
  await expect(page.locator('.preview-performance-cover')).toBeVisible();
  expect((await pixel()).every(value => value < 5)).toBe(true);
  await page.screenshot({ path: path.join(output, 'outgoing-black-preview.png') });
  await seek(0);
  await page.getByRole('button', { name: '播放预览', exact: true }).click();
  await page.locator('.preview-stage-frame').click();
  await expect(page.locator('.story-preview-content')).toHaveAttribute('data-preview-phase', 'actions');
  await page.getByRole('button', { name: '暂停预览', exact: true }).click();
  checks.push('从剧情打开演出时，黑屏转场及禁止点击跳过的设置正确进入编辑器试播。');
  }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', compiled: !server, propertiesOnly, checks, errors, layouts, projectFile }, null, 2));
  console.log(output);
} catch (error) {
  await page!?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, errors, layouts, error: String(error) }, null, 2));
  console.error(output); throw error;
} finally {
  await app?.close(); await server?.close();
  await fs.copyFile(projectFile, path.join(output, 'saved-project.json')).catch(() => undefined);
  const cleanup = await cleanVerificationDirectories(output, ['project', 'profile', 'source']);
  assert.deepEqual(cleanup.errors, []);
}
