import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { createProject, projectSchema } from '../src/core/model';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { applyTextScript } from '../src/core/text-script';
import { enterFixtureProject, launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), output = path.join(root, 'artifacts/media-commands-editor', new Date().toISOString().replaceAll(':', '-'));
const directory = path.join(output, 'project'), external = path.join(output, 'external'), screenshots = path.join(output, 'screenshots');
for (const target of [directory, external, screenshots]) await fs.mkdir(target, { recursive: true });
const imageFile = path.join(external, '图片，条纹.png'), videoFile = path.join(external, '短视频，条纹.webm');
const png = new PNG({ width: 320, height: 160 });
for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) png.data.set(x < 80 ? [225, 40, 40, 255] : x >= 240 ? [40, 220, 70, 255] : [40, 80, 225, 255], (y * png.width + x) * 4);
await fs.writeFile(imageFile, PNG.sync.write(png));
execFileSync('ffmpeg', ['-v', 'error', '-loop', '1', '-i', imageFile, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=22050', '-t', '2', '-r', '12', '-c:v', 'libvpx', '-pix_fmt', 'yuv420p', '-c:a', 'libvorbis', videoFile], { windowsHide: true });
const project = createProject('媒体指令桌面验收');
project.resourceSettings = { directory: 'media', importMode: 'copy', syncFolders: false };
for (const name of ['标题动画 · 播放', '标题动画 · 暂停', '标题动画 · 继续', '标题动画 · 半速']) {
  const graph = blueprintFromPerformance(project, [], name); graph.kind = 'ui'; project.blueprints.push(graph);
}
for (const name of ['夜宴 · 音乐淡入', '旧忆 · 换景与配乐']) project.blueprints.push(blueprintFromPerformance(project, [{ kind: 'pause', seconds: .1 }], name));
const projectFile = path.join(directory, 'project.vns.json'); await fs.writeFile(projectFile, JSON.stringify(project));
const app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') }), page = await app.firstWindow();
const errors: string[] = [], checks: string[] = []; let phase = 'palette';
page.on('pageerror', error => errors.push(error.message));
const input = page.getByLabel('中文文本剧本', { exact: true }), preview = page.locator('.story-preview-content');
const saved = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
async function openCommand(name: string) {
  await input.focus(); await input.press('Control+End'); await input.press('Enter'); await input.press('/');
  const palette = page.getByRole('dialog', { name: '中文指令面板', exact: true });
  await expect(palette).toBeVisible(); await palette.getByText(name, { exact: true }).click();
  const picker = page.getByRole('dialog', { name: '命令参数', exact: true }); await expect(picker).toBeVisible(); return picker;
}
async function append(text: string) { await input.fill((await input.inputValue()) + '\n' + text + '\n'); await input.press('Control+End'); }
async function importMedia(kind: '图片' | '视频', file: string) {
  const picker = page.getByRole('dialog', { name: '命令参数', exact: true });
  await picker.getByRole('button', { name: '浏览显示' + kind + '素材', exact: true }).click();
  const browser = page.getByRole('dialog', { name: '显示' + kind + '素材资源浏览器', exact: true });
  await app.evaluate((_electron, file) => (globalThis as any).fileChoices.push(file), file);
  await browser.getByRole('button', { name: '选择项目外素材', exact: true }).click();
  await expect(browser).toHaveCount(0); await expect(picker.getByRole('button', { name: '插入指令', exact: true })).toBeEnabled();
}
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 960);
    const state = globalThis as any; state.fileChoices = []; state.fileRequests = [];
    dialog.showOpenDialog = (async (...args: any[]) => {
      state.fileRequests.push(args.at(-1)); const file = state.fileChoices.shift();
      if (file === undefined) throw new Error('Unexpected file picker');
      return { canceled: !file, filePaths: file ? [file] : [] };
    }) as any;
  });
  await openStoryMode(page, 'text'); await input.fill('旁白：媒体开始。\n');
  await input.press('Control+End'); await input.press('/');
  const palette = page.getByRole('dialog', { name: '中文指令面板', exact: true });
  await expect(palette).toBeVisible();
  for (const name of ['背景音乐', '显示图片', '显示视频', '显示文字', '隐藏对象', '蓝图']) await expect(palette.getByText(name, { exact: true })).toHaveCount(1);
  await expect(palette.getByText('BGM', { exact: true })).toHaveCount(0);
  for (const graph of project.blueprints) await expect(palette.getByText(graph.name, { exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(screenshots, 'generic-command-palette.png') });
  await palette.getByText('蓝图', { exact: true }).click();
  const blueprintPicker = page.getByRole('dialog', { name: '命令参数', exact: true });
  const names = await blueprintPicker.getByLabel('通用蓝图', { exact: true }).locator('option').allTextContents();
  assert.ok(names.some(name => name.includes('夜宴 · 音乐淡入'))); assert.ok(!names.some(name => name.includes('标题动画')));
  await blueprintPicker.getByRole('button', { name: '取消', exact: true }).click(); await input.fill('旁白：媒体开始。\n');
  checks.push('插入面板提供通用媒体指令，隐藏标题界面专属演示；故事专用组合仍可通过蓝图选择。');

  phase = 'external image and text';
  let picker = await openCommand('显示图片');
  await expect(picker.getByRole('button', { name: '插入指令', exact: true })).toBeDisabled();
  await expect(picker.getByLabel('等待显示结束', { exact: true })).toBeDisabled();
  await expect(picker.getByLabel('图片显示范围', { exact: true })).toHaveValue('line');
  await importMedia('图片', imageFile);
  await picker.getByLabel('对象ID', { exact: true }).fill('overlay');
  for (const [name, value] of [['图片缩放 X', '40'], ['图片缩放 Y', '50'], ['图片位置 Y', '35']]) { await picker.getByLabel(name, { exact: true }).fill(value); await picker.getByLabel(name, { exact: true }).press('Tab'); }
  await picker.getByLabel('图片显示范围', { exact: true }).selectOption('persistent');
  await page.screenshot({ path: path.join(screenshots, 'image-command.png') });
  await picker.getByRole('button', { name: '插入指令', exact: true }).click();
  await append('旁白：图片在这一句显示。');
  await expect(preview.locator('[data-visual-instance="overlay"] image[href]')).toHaveCount(1);
  picker = await openCommand('显示文字');
  await picker.getByLabel('显示文字内容', { exact: true }).fill('第一章，开始');
  await picker.getByLabel('对象ID', { exact: true }).fill('caption');
  await picker.getByLabel('纵向位置 %', { exact: true }).fill('20'); await picker.getByLabel('纵向位置 %', { exact: true }).press('Tab');
  await picker.getByRole('button', { name: '插入指令', exact: true }).click(); await append('旁白：图片与独立文字一起保留。');
  await expect(preview.locator('[data-visual-instance="overlay"]')).toHaveCount(1);
  await expect(preview.locator('[data-visual-instance="caption"] [data-visual-text]')).toHaveText('第一章，开始');
  checks.push('空素材库中可直接选择项目外图片；对象位置大小生效，文字与图片跨台词保留。');

  phase = 'looping video preview';
  picker = await openCommand('显示视频'); await importMedia('视频', videoFile);
  await picker.getByLabel('对象ID', { exact: true }).fill('clip');
  for (const [name, value] of [['宽度 %', '30'], ['高度 %', '50'], ['纵向位置 %', '50'], ['视频音量 %', '35']]) { await picker.getByLabel(name, { exact: true }).fill(value); await picker.getByLabel(name, { exact: true }).press('Tab'); }
  await picker.getByLabel('循环视频', { exact: true }).check();
  await page.screenshot({ path: path.join(screenshots, 'video-command.png') });
  await picker.getByRole('button', { name: '插入指令', exact: true }).click(); await append('旁白：循环。');
  const video = preview.locator('[data-visual-instance="clip"] video');
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState), { timeout: 15000 }).toBeGreaterThanOrEqual(2);
  await preview.getByRole('button', { name: '播放预览', exact: true }).click();
  await expect.poll(async () => Number(await preview.getByLabel('定位演出时间（秒）', { exact: true }).inputValue()), { timeout: 12000 }).toBeGreaterThan(4.2);
  const playing = await video.evaluate((element: HTMLVideoElement) => ({ paused: element.paused, loop: element.loop, position: element.currentTime, duration: element.duration, width: element.videoWidth, height: element.videoHeight, volume: element.volume }));
  assert.equal(playing.paused, false); assert.equal(playing.loop, true); assert.ok(playing.position < playing.duration); assert.equal(playing.width, 320); assert.equal(playing.height, 160); assert.equal(playing.volume, .35);
  await preview.getByRole('button', { name: '暂停预览', exact: true }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await page.screenshot({ path: path.join(screenshots, 'media-preview.png') });
  checks.push('两秒视频实际解码并连续循环超过四秒，音量和暂停控制生效。');
  const properties = preview.getByRole('region', { name: '演出对象属性', exact: true });
  await expect(properties.getByLabel('对象 ID', { exact: true })).toHaveValue('clip');
  await expect(properties.getByLabel('等待显示结束', { exact: true })).toBeDisabled();
  await properties.getByLabel('对象持续秒数', { exact: true }).fill('1'); await properties.getByLabel('对象持续秒数', { exact: true }).press('Tab');
  await expect(properties.getByLabel('等待显示结束', { exact: true })).toBeEnabled();
  await properties.getByLabel('等待显示结束', { exact: true }).check();
  await properties.getByLabel('对象持续秒数', { exact: true }).fill('0'); await properties.getByLabel('对象持续秒数', { exact: true }).press('Tab');
  await expect(properties.getByLabel('等待显示结束', { exact: true })).toBeDisabled();
  await expect(properties.getByLabel('等待显示结束', { exact: true })).not.toBeChecked();
  checks.push('右侧演出设置可查看对象 ID、修改时长和等待；改回持续显示后自动取消等待。');

  phase = 'hide and one-shot video';
  picker = await openCommand('隐藏对象'); await picker.getByLabel('对象ID', { exact: true }).fill('clip');
  await picker.getByRole('button', { name: '插入指令', exact: true }).click(); await append('旁白：已隐藏视频。');
  await expect(preview.locator('[data-visual-instance="clip"]')).toHaveCount(0);
  await expect(preview.locator('[data-visual-instance="overlay"]')).toHaveCount(1);
  await append('@显示视频："短视频，条纹"，对象ID=once，音量=0\n旁白：一次。');
  const once = preview.locator('[data-visual-instance="once"] video');
  await expect.poll(() => once.evaluate((element: HTMLVideoElement) => element.readyState), { timeout: 15000 }).toBeGreaterThanOrEqual(2);
  await preview.getByRole('button', { name: '播放预览', exact: true }).click();
  await expect(preview).toHaveAttribute('data-preview-phase', 'finished', { timeout: 8000 });
  assert.ok(Number(await preview.getByLabel('定位演出时间（秒）', { exact: true }).inputValue()) >= 2);
  await expect(once).toHaveCSS('visibility', 'hidden');
  assert.equal(await once.evaluate((element: HTMLVideoElement) => element.paused), true);
  checks.push('隐藏视频不影响其他对象；非循环视频播完完整素材后透明并停止，不会意外重播。');

  phase = 'save and reload';
  await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const result = await saved(), parsed = applyTextScript(result, result.scriptText!.content);
  assert.deepEqual(parsed.issues, []);
  const actions = parsed.project.nodes.flatMap(node => node.kind === 'passage' ? node.lines.flatMap(line => line.actions) : []);
  assert.equal(result.assets.length, 2);
  assert.ok(actions.some(action => action.kind === 'visual' && action.content === 'image' && action.persistent));
  assert.ok(actions.some(action => action.kind === 'visual' && action.content === 'video' && action.loop && action.volume === .35));
  assert.ok(actions.some(action => action.kind === 'hideVisual' && action.instanceId === 'clip'));
  await page.reload();
  await enterFixtureProject(page, projectFile);
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await openStoryMode(page, 'text');
  assert.match(await input.inputValue(), /@显示图片/); assert.match(await input.inputValue(), /@隐藏对象：clip/);
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', projectFile, checks, playing, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(screenshots, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, error: String(error), checks, errors }, null, 2)); throw error;
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
  await app.close().catch(() => {}); console.log(output);
}
