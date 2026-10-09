import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type Locator } from '@playwright/test';
import { PNG } from 'pngjs';
import { createProject, projectSchema } from '../src/core/model';
import { createBlueprintGraph } from '../src/core/blueprint';
import { addTimelineComponent } from '../src/core/timeline-component';
import { performanceTimeline } from '../src/core/performance-timeline';
import { timelineOverlap } from '../src/core/timeline-editing';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.');
const output = path.join(root, 'artifacts/timeline-media-editing', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = createProject('音视频时间轴剪辑验收');
const rate = 22050, samples = rate * 6, audio = Buffer.alloc(44 + samples * 2);
audio.write('RIFF'); audio.writeUInt32LE(36 + samples * 2, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(rate, 24); audio.writeUInt32LE(rate * 2, 28);
audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) {
  const at = i / rate, level = [0, .18, .85, .42, 0, .65][Math.floor(at)];
  const envelope = .8 + .2 * Math.sin(2 * Math.PI * 3 * at);
  audio.writeInt16LE(Math.round(32767 * level * envelope * Math.sin(2 * Math.PI * 440 * at)), 44 + i * 2);
}
await fs.writeFile(path.join(output, 'music.wav'), audio);
const alternate = Buffer.from(audio);
for (let i = 0; i < samples; i++) {
  const at = i / rate, level = [0, .75, 0, .12, .9, .35][Math.floor(at)];
  alternate.writeInt16LE(Math.round(32767 * level * Math.sin(2 * Math.PI * 330 * at)), 44 + i * 2);
}
await fs.writeFile(path.join(output, 'alternate.wav'), alternate);
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10', '-t', '6', '-c:v', 'libvpx', '-an', path.join(output, 'video.webm')]);
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:size=160x90:rate=10', '-t', '2', '-c:v', 'libvpx', '-an', path.join(output, 'short-video.webm')]);
project.assets.push(
  { id: 'music', name: '示例音乐', kind: 'audio', category: 'bgm', path: 'music.wav' },
  { id: 'alternate', name: '替换音乐', kind: 'audio', category: 'bgm', path: 'alternate.wav' },
  { id: 'video', name: '示例视频', kind: 'video', path: 'video.webm' },
  { id: 'short_video', name: '短视频', kind: 'video', path: 'short-video.webm' },
);
const owner = createBlueprintGraph('effect', '调用方'); project.blueprints.push(owner);
const { timeline, node: call } = addTimelineComponent(project, owner.id);
const projectFile = path.join(output, 'project.vns.json'); await fs.writeFile(projectFile, JSON.stringify(projectSchema.parse(project)));
let app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
let page = await app.firstWindow(); page.setDefaultTimeout(10000);
const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
const button = (name: string) => page.getByRole('button', { name, exact: true });
const videoLabels: Record<string, string> = { '素材入点 秒': '视频素材入点', '音量 %': '视频音量', '淡入 秒': '视频淡入秒数', '淡出 秒': '视频淡出秒数' };
const field = (name: string) => page.getByLabel(videoLabels[name] ?? name, { exact: true });
const addAsset = async (name: string) => {
  await field('搜索演出素材').fill(name);
  await button('添加素材 ' + name).click();
  await field('搜索演出素材').fill('');
};
const open = async () => { await page.locator('[data-workspace-tab="blueprint"]').click(); await field('演出目标').selectOption('graph:' + timeline.id); };
const save = async () => {
  if (await button('保存工程').isEnabled()) await button('保存工程').click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  await expect(page.getByRole('contentinfo')).toContainText('工程已保存');
  return projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
};
const drag = async (target: Locator, dx: number, dy = 0) => {
  const bounds = await target.boundingBox(); assert.ok(bounds);
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 }); await page.mouse.up();
};
const parameter = (name: string) => page.locator('.timeline-parameter').filter({ has: page.locator(':scope > span', { hasText: name }) });
const waveformHeight = async (clip: Locator, from: number, to: number) => clip.locator('.timeline-audio-waveform canvas').evaluate((canvas: HTMLCanvasElement, range) => {
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  const left = Math.floor(range[0] * canvas.width), right = Math.ceil(range[1] * canvas.width);
  let total = 0;
  for (let x = left; x < right; x++) {
    let height = 0;
    for (let y = 0; y < canvas.height; y++) if (data[(y * canvas.width + x) * 4 + 3] > 0) height++;
    total += height;
  }
  return total / Math.max(1, right - left) / Math.min(3, window.devicePixelRatio || 1);
}, [from, to]);
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1800, 1040));
  await open();
  await expect(page.locator('.performance-preview-context, .timeline-playback-settings')).toHaveCount(0);
  await addAsset('示例音乐'); await expect(field('音频片段时长')).toHaveValue('6');
  await field('轨道缩放').selectOption('60'); await field('时间轴吸附').uncheck();
  const music = page.locator('.timeline-audio-clip');
  const musicId = await music.getAttribute('data-node-id'); assert.ok(musicId);
  await expect(music.locator('.timeline-audio-icon')).toBeVisible();
  const waveform = music.locator('.timeline-audio-waveform');
  await expect(waveform).toHaveAttribute('data-waveform-state', 'ready');
  const initialLevels = await Promise.all([[.4, .6], [1.4, 1.6], [2.4, 2.6], [4.4, 4.6]].map(([from, to]) => waveformHeight(music, from / 6, to / 6)));
  assert.ok(initialLevels[0] <= 2 && initialLevels[3] <= 2, 'Silent source sections must be flat');
  assert.ok(initialLevels[1] > initialLevels[0] && initialLevels[2] > initialLevels[1] * 2, 'Actual source levels must produce different waveform heights');
  await page.screenshot({ path: path.join(output, '00-real-waveform.png') });
  await drag(music.locator('.timeline-resize-right'), -120); await expect(field('音频片段时长')).toHaveValue('4');
  await drag(music.locator('.timeline-resize-left'), 60);
  await expect(field('片段开始秒数')).toHaveValue('1'); await expect(field('音频截取起点')).toHaveValue('1'); await expect(field('音频片段时长')).toHaveValue('3');
  await expect(waveform).toHaveAttribute('data-waveform-offset', '1');
  await expect(waveform).toHaveAttribute('data-waveform-duration', '3');
  const trimmedQuiet = await waveformHeight(music, .4 / 3, .6 / 3);
  const trimmedLoud = await waveformHeight(music, 1.4 / 3, 1.6 / 3);
  assert.ok(trimmedQuiet > 2 && trimmedLoud > trimmedQuiet * 2, 'Left trim must shift the displayed source range');
  await drag(music.locator('.timeline-resize-right'), 120); await expect(field('音频片段时长')).toHaveValue('5');
  await drag(music.locator('.timeline-resize-right'), 60); await expect(field('音频片段时长')).toHaveValue('5');
  await drag(music.locator('.timeline-fade-in'), 60); await expect(field('音频淡入秒数')).toHaveValue('1');
  await drag(music.locator('.timeline-fade-out'), -60); await expect(field('音频淡出秒数')).toHaveValue('1');
  await expect(music.locator('.timeline-fade-region')).toHaveCount(2);
  await parameter('音频素材').getByRole('button', { name: '设为素材参数', exact: true }).click();
  await parameter('淡出秒数').getByRole('button', { name: '设为参数', exact: true }).click();
  await drag(music.locator('.timeline-fade-out'), -60);
  await expect(music.locator('.timeline-fade-out')).toHaveAttribute('aria-valuenow', '2');
  let stored = await save(), graph = stored.blueprints.find(item => item.id === timeline.id)!;
  const audioInput = graph.exposedInputs.find(pin => pin.dataType === 'asset')!;
  assert.equal(audioInput.defaultValue, 'music');
  assert.equal(performanceTimeline(stored, graph).actionsByNode.get(musicId)?.find(action => action.kind === 'audioClip')?.fadeOut, 2);
  await page.getByRole('tab', { name: '时间轴组件', exact: true }).click();
  const audioDefault = page.locator('.timeline-public-parameter').filter({ has: page.getByLabel('参数名称 ' + audioInput.name, { exact: true }) }).getByRole('combobox');
  await audioDefault.fill('替换音乐'); await page.getByRole('option').filter({ hasText: '替换音乐' }).click();
  await expect(waveform).toHaveAttribute('data-waveform-state', 'ready');
  await expect.poll(() => waveformHeight(music, 1.4 / 5, 1.6 / 5)).toBeLessThanOrEqual(2);
  assert.ok(await waveformHeight(music, .4 / 5, .6 / 5) > 10, 'An exposed asset default must also replace the waveform');
  stored = await save(); graph = stored.blueprints.find(item => item.id === timeline.id)!;
  assert.equal(performanceTimeline(stored, graph).actionsByNode.get(musicId)?.find(action => action.kind === 'audioClip')?.assetId, 'alternate');
  await button('轨道').click();
  const destinationId = await page.locator('.timeline-track[data-track-id]').last().getAttribute('data-track-id'); assert.ok(destinationId);
  await addAsset('示例视频'); await expect(field('片段显示时长')).toHaveValue('6');
  const video = page.locator('.timeline-video-clip');
  await button('浏览片段视频素材').click();
  await page.getByRole('dialog', { name: '片段视频素材资源浏览器', exact: true }).getByRole('button', { name: '预览资源 短视频', exact: true }).dblclick();
  await expect(field('片段显示时长')).toHaveValue('2');
  await expect(page.locator('.timeline-media-editing')).toContainText('原视频 2.00 秒');
  await button('浏览片段视频素材').click();
  await page.getByRole('dialog', { name: '片段视频素材资源浏览器', exact: true }).getByRole('button', { name: '预览资源 示例视频', exact: true }).dblclick();
  await expect(field('片段显示时长')).toHaveValue('6');
  await expect.poll(() => video.locator('video').evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  const videoId = await video.getAttribute('data-node-id'); assert.ok(videoId);
  const beforeMove = await video.boundingBox(); assert.ok(beforeMove);
  const destination = await page.locator(`[data-track-id="${destinationId}"]`).boundingBox(); assert.ok(destination);
  const ruler = await field('时间标尺').boundingBox(); assert.ok(ruler);
  const at = Number(await video.getAttribute('data-start'));
  await page.mouse.move(beforeMove.x + 30, beforeMove.y + 22); await page.mouse.down();
  await page.mouse.move(beforeMove.x + 30 - at * 60, destination.y + destination.height / 2, { steps: 10 }); await page.mouse.up();
  await expect(field('片段开始秒数')).toHaveValue('0');
  await expect(field('片段所在轨道')).toHaveValue(destinationId);
  await drag(video.locator('.timeline-resize-right'), -120); await expect(field('片段显示时长')).toHaveValue('4');
  await drag(video.locator('.timeline-resize-left'), 60);
  await expect(field('片段开始秒数')).toHaveValue('1'); await expect(field('素材入点 秒')).toHaveValue('1'); await expect(field('片段显示时长')).toHaveValue('3');
  await field('片段显示时长').fill('99'); await field('片段显示时长').press('Tab');
  await expect(field('片段显示时长')).toHaveValue('5');
  await field('素材入点 秒').fill('99'); await field('素材入点 秒').press('Tab');
  await expect(field('素材入点 秒')).toHaveValue('5.95');
  await expect.poll(async()=>Number(await video.getAttribute('data-duration'))).toBeCloseTo(.05,5);
  await field('素材入点 秒').fill('1'); await field('素材入点 秒').press('Tab');
  await field('片段显示时长').fill('3'); await field('片段显示时长').press('Tab');
  await expect(field('片段显示时长')).toHaveValue('3');
  await drag(video.locator('.timeline-fade-in'), 60); await expect(field('淡入 秒')).toHaveValue('1');
  await drag(video.locator('.timeline-fade-out'), -60); await expect(field('淡出 秒')).toHaveValue('1');
  await page.locator('.visual-clip-inspector').getByRole('tab', { name: '可替换参数', exact: true }).click();
  await page.locator('.visual-parameter-row[data-parameter-key="assetId"]').getByRole('button', { name: '公开到时间轴', exact: true }).click();
  await page.locator('.visual-clip-inspector').getByRole('tab', { name: '基础', exact: true }).click();
  await field('音量 %').fill('35'); await field('音量 %').press('Tab');
  await page.mouse.click(ruler.x + 130 + 1.5 * 60, ruler.y + 12);
  const stageVideo = page.locator('.text-stage video');
  await expect.poll(() => stageVideo.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => stageVideo.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(1.5, 1);
  await expect.poll(() => stageVideo.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await expect.poll(() => stageVideo.evaluate((element: HTMLVideoElement) => element.volume)).toBeCloseTo(.175, 3);
  await expect.poll(() => stageVideo.evaluate(element => Number(element.closest('foreignObject')?.parentElement?.getAttribute('opacity')))).toBeCloseTo(.5, 4);
  const mute = page.locator('.timeline-media-editing').getByRole('checkbox', { name: '视频静音', exact: true });
  await mute.check(); await expect.poll(() => stageVideo.evaluate((element: HTMLVideoElement) => element.muted)).toBe(true);
  await mute.uncheck();
  await page.mouse.click(ruler.x + 130 + 2 * 60, ruler.y + 12);
  await expect(page.locator('.timeline-until')).toHaveText('完成 6.00 秒');
  await page.screenshot({ path: path.join(output, '01-media-timeline.png') });
  const pixels = PNG.sync.read(await page.locator('.text-stage video').screenshot()), colors = new Set<string>();
  for (let i = 0; i < pixels.data.length; i += 4) colors.add(pixels.data.subarray(i, i + 3).toString('hex'));
  assert.ok(colors.size > 100, 'Video thumbnail must contain decoded footage');
  stored = await save(); graph = stored.blueprints.find(item => item.id === timeline.id)!;
  const model = performanceTimeline(stored, graph);
  assert.equal(timelineOverlap(model.clips), undefined); assert.equal(model.until, 6);
  const footage = model.actionsByNode.get(videoId)?.find(action => action.kind === 'visual');
  assert.equal(footage?.content, 'video'); assert.equal(footage?.mediaOffset, 1);
  const caller = stored.blueprints.find(item => item.id === owner.id)!.nodes.find(item => item.id === call.id)!;
  const assets = graph.exposedInputs.filter(pin => pin.dataType === 'asset'); assert.equal(assets.length, 2);
  for (const pin of assets) assert.ok(caller.pins.some(item => item.id === 'arg_' + pin.id && item.dataType === 'asset'));
  await button('播放预览').click(); await expect(button('暂停预览')).toBeVisible();
  await expect.poll(() => stageVideo.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await button('暂停预览').click();
  await expect.poll(() => stageVideo.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  const pausedTimes = await stageVideo.evaluate(async (element: HTMLVideoElement) => {
    const before = element.currentTime; await new Promise(resolve => setTimeout(resolve, 350)); return [before, element.currentTime];
  });
  assert.ok(Math.abs(pausedTimes[1] - pausedTimes[0]) < .04, 'Pausing the timeline must also freeze the decoded video frame');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 768));
  const overflow = await page.locator('[data-dock-panel="inspector"] .performance-dock-content').evaluate(element => element.scrollWidth - element.clientWidth);
  assert.ok(overflow <= 1, 'Media inspector must fit a 1024px window');
  await page.screenshot({ path: path.join(output, '02-media-narrow.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy()));
  await app.close();
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'reopened-profile') });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 }); await open();
  await page.locator('.timeline-video-clip').click(); await expect(field('素材入点 秒')).toHaveValue('1');
  await expect(field('淡出 秒')).toHaveValue('1');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', projectFile, checks: ['真实波形区分静音与强弱，裁剪后素材区间同步', '素材参数默认值替换后波形同步更新', '读取真实音视频时长，替换视频重新读取并限制新源长度', '左右裁剪同步素材入点并限制素材尾部', '数值编辑入点和时长同样限制素材尾部', '跨轨拖动保留片段身份', '淡入向右、淡出向左及可见包络', '公开淡出参数后仍可拖动修改默认值', '音视频素材参数与调用端接口同步', '组件默认素材驱动试播，无重复设置', '完成时间由最晚结束片段决定', '视频定位、暂停保持帧及真实淡入、音量、静音', '视频实际解码及宽窄窗口视觉检查', '保存重开保留入点与淡出'], errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); throw error;
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined);
  await app.close(); console.log(output);
}
