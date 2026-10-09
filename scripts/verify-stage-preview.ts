import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject, type Project } from '../src/core/model';
import { projectToText } from '../src/core/text-script';
import { saveProject } from '../src/desktop/project-store';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), require = createRequire(import.meta.url);
const output = path.join(root, 'artifacts/stage-preview', new Date().toISOString().replaceAll(':', '-'));
const directory = path.join(output, 'project'), projectFile = path.join(directory, 'project.vns.json');
await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
for (const [name, width, height, color] of [['night', 640, 360, [32, 53, 78]], ['room', 640, 360, [64, 44, 47]], ['actor', 90, 230, [115, 164, 168]]] as const) {
  const png = new PNG({ width, height });
  for (let at = 0; at < png.data.length; at += 4) { png.data[at] = color[0]; png.data[at + 1] = color[1]; png.data[at + 2] = color[2]; png.data[at + 3] = 255; }
  await fs.writeFile(path.join(directory, `assets/${name}.png`), PNG.sync.write(png));
}
const samples = 8000 * 2, wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
await fs.writeFile(path.join(directory, 'assets/clip.wav'), wav);
const project = createProject('预览内舞台验证');
project.assets = [
  { id: 'night', name: '夜宴', kind: 'image', category: 'scene', path: 'assets/night.png', width: 640, height: 360 },
  { id: 'room', name: '屋内', kind: 'image', category: 'scene', path: 'assets/room.png', width: 640, height: 360 },
  { id: 'actor', name: '苏怜烟立绘', kind: 'image', category: 'portrait', path: 'assets/actor.png', width: 90, height: 230 },
  ...(['bgm', 'voice', 'sound'] as const).map(category => ({ id: category, name: { bgm: '花街柳巷', voice: '苏怜烟对白', sound: '推门' }[category], kind: 'audio' as const, category, path: 'assets/clip.wav' })),
];
project.characters = [{ id: 'sly', name: '苏怜烟', color: '#a6d2c0', expressions: [{ id: 'normal', name: '通常', assetId: 'actor' }, { id: 'smile', name: '微笑', assetId: 'actor' }] }];
project.variables = [{ id: 'mood', name: '心情', type: 'number', initial: 0, persistent: false }];
project.playerDefaults = { textSpeed: 20, masterVolume: .5, musicVolume: .4, voiceVolume: .8 };
project.width = 960; project.height = 540;
const passage = project.nodes.find(node => node.kind === 'passage')!;
passage.lines = [
  { id: 'first', speakerId: 'sly', text: '第一句用于编辑角色和演出。', actions: [{ kind: 'background', assetId: 'night', transition: 'dissolve' }, { kind: 'show', characterId: 'sly', expressionId: 'normal', x: .5, y: 1, scale: .4, layer: 10, transition: 'dissolve' }, { kind: 'music', assetId: 'bgm', loop: true, fade: .5 }] },
  { id: 'second', speakerId: 'sly', text: '第二句台词逐字播放，同时播放配音。', voiceId: 'voice', actions: [{ kind: 'background', assetId: 'room', transition: 'dissolve' }, { kind: 'show', characterId: 'sly', expressionId: 'smile', x: .65, y: 1, scale: .8, layer: 10, transition: 'move' }, { kind: 'pause', seconds: .15 }, { kind: 'sound', assetId: 'sound' }, { kind: 'camera', x: 0.05, y: 0, zoom: 1.1, rotation: 0, duration: .3, easing: 'ease', wait: false }] },
  { id: 'last', text: '最后一句没有配音。\n' + Array.from({ length: 75 }, (_, index) => `段内续行 ${index + 1}`).join('\n'), actions: [] },
];
// Dragging is measured in this completed camera pose; a nonblocking camera
// correctly remains at its initial pose when the dialogue first appears.
passage.lines[0].actions.push({ kind: 'camera', x: .02, y: -.03, zoom: 1.2, rotation: 12, duration: .2, easing: 'ease', wait: true });
passage.lines[1].actions.push({ kind: 'animate', characterId: 'sly', repeat: false, wait: true, keyframes: [{ x: .3, y: .8, scale: .8, rotation: 0, opacity: 1, duration: .2, easing: 'ease' }, { x: .7, y: .9, scale: .9, rotation: 10, opacity: .9, duration: .5, easing: 'ease' }] });
project.nodes.push({ id: 'inspect', kind: 'interaction', name: '检查窗户', sceneId: passage.sceneId, x: 700, y: 90, prompt: '检查窗户', showHints: true, timeoutSeconds: 0, hotspots: [{ id: 'window', name: '窗户', x: .2, y: .2, width: .3, height: .4, target: passage.next }] });
passage.next = 'inspect';
project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
await saveProject(projectFile, project);
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } });
await server.listen();
const env = Object.fromEntries(Object.entries({ ...process.env, VNS_PROJECT_PATH: projectFile, VNS_USER_DATA: path.join(output, 'profile'), VNS_DEV_URL: `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}` }).filter((entry): entry is [string, string] => entry[1] !== undefined));
delete env.ELECTRON_RUN_AS_NODE;
let app: ElectronApplication | undefined, page: Page | undefined;
const checks: string[] = [], errors: string[] = [];
try {
  app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1440, 960); });
  await openStoryMode(page, 'script');
  const preview = page.locator('.story-preview-content'), toggle = preview.getByRole('button', { name: '编辑舞台', exact: true });
  const canvas = preview.locator('.text-stage'), actor = preview.locator('[data-character-id="sly"]');
  const x = preview.getByLabel('角色横向位置 %', { exact: true });
  await page.locator('#line-first textarea').click();
  await expect(page.locator('.view-tabs .tabs > button')).toHaveText(['剧本', '流程图', '蓝图', '界面', '素材', '角色', '参数集']);
  await canvas.evaluate(element => { (window as any).__stageCanvas = element; (window as any).__stageDialogue = element.querySelector('.ui-dialogue-preview'); });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(await canvas.evaluate(element => element === (window as any).__stageCanvas && element.querySelector('.ui-dialogue-preview') === (window as any).__stageDialogue)).toBe(true);
  await expect(x).toHaveValue('50');
  const bounds = (await actor.boundingBox())!, stageBounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 45, bounds.y + bounds.height / 2 - 18, { steps: 6 }); await page.mouse.up();
  const actualX = Number(await x.inputValue()), angle = 12 * Math.PI / 180;
  expect(actualX).toBeCloseTo((.5 + (45 * Math.cos(angle) - 18 * Math.sin(angle)) / 1.2 / stageBounds.width) * 100, 0);
  await page.locator('.app-header').getByRole('button', { name: '撤销', exact: true }).click(); await expect(x).toHaveValue('50');
  await page.locator('.app-header').getByRole('button', { name: '重做', exact: true }).click(); expect(Number(await x.inputValue())).toBe(actualX);
  await actor.focus(); await actor.press('ArrowLeft'); expect(Number(await x.inputValue())).toBeCloseTo(actualX - 1, 1);
  await preview.getByLabel('角色表情', { exact: true }).selectOption('smile');
  await preview.getByLabel('角色图层', { exact: true }).fill('25');
  await preview.getByLabel('角色缩放 %', { exact: true }).fill('85');
  await expect(actor.locator('img')).toHaveAttribute('alt', '苏怜烟：微笑');
  await expect(actor).toHaveCSS('z-index', '25');
  await preview.locator('summary').filter({ hasText: '镜头' }).click();
  await preview.getByLabel('镜头缩放 %', { exact: true }).fill('135');
  await preview.getByLabel('镜头旋转 度', { exact: true }).fill('-10');
  await expect(preview.locator('.text-stage-world')).toHaveAttribute('style', /scale\(1.35\) rotate\(-10deg\)/);
  await preview.getByRole('button', { name: '重置镜头位置', exact: true }).click();
  await expect(preview.getByLabel('镜头缩放 %', { exact: true })).toHaveValue('100');
  await preview.locator('summary').filter({ hasText: '镜头' }).click();
  await page.screenshot({ path: path.join(output, 'module-stage-edit.png') });
  checks.push('舞台导航已移除；直接在同一预览画布拖动角色，旋转与缩放镜头下坐标正确；一次拖动可撤销/重做，方向键、表情、图层、缩放和镜头可修改。');

  await page.getByRole('button', { name: '文本编辑', exact: true }).click();
  const input = page.getByLabel('中文文本剧本', { exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const beforeDraft = await input.inputValue();
  const firstPosition = await x.inputValue();
  await input.fill(beforeDraft.replace('第一句用于编辑角色和演出。', '第一句包含刚刚输入、尚未应用的修改。'));
  const placeCaret = async (needle: string) => {
    await input.evaluate((element, needle) => { const text = element as HTMLTextAreaElement, at = text.value.indexOf(needle); if (at < 0) throw new Error(`Missing ${needle}`); text.focus({ preventScroll: true }); text.setSelectionRange(at, at); text.scrollTop = Math.max(0, (text.value.slice(0, at).split('\n').length - 8) * parseFloat(getComputedStyle(text).lineHeight)); }, needle);
    await input.press('ArrowRight'); await input.press('ArrowLeft');
  };
  await placeCaret('段内续行 50');
  await expect(preview).toHaveAttribute('data-preview-key', `${passage.id}/last`);
  // Filling the document first moves the caret through its terminal node.
  // Select the intended dialogue before re-entering stage editing.
  if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
  const beforePosition = await input.evaluate(element => { const text = element as HTMLTextAreaElement; return { top: text.scrollTop, caret: text.selectionStart }; });
  await x.fill('25');
  await expect(x).toHaveValue('25');
  expect(await input.inputValue()).toContain('第一句包含刚刚输入、尚未应用的修改。');
  expect(await input.evaluate(element => { const text = element as HTMLTextAreaElement; return text.value.slice(text.selectionStart, text.selectionStart + 7); })).toBe('段内续行 50');
  expect(await input.evaluate(element => element.scrollTop)).toBe(beforePosition.top);
  await expect(x).toBeFocused();
  await page.locator('.app-header').getByRole('button', { name: '撤销', exact: true }).click();
  expect(await input.inputValue()).toContain('第一句包含刚刚输入、尚未应用的修改。');
  await page.locator('.app-header').getByRole('button', { name: '重做', exact: true }).click();
  await expect(x).toHaveValue('25');
  await preview.getByLabel('跟随光标', { exact: true }).uncheck();
  await placeCaret('第一句包含刚刚');
  await expect(preview).toHaveAttribute('data-preview-key', `${passage.id}/last`);
  await x.fill('30'); await expect(x).toHaveValue('30');
  await preview.getByLabel('跟随光标', { exact: true }).check();
  await expect(preview).toHaveAttribute('data-preview-key', `${passage.id}/first`);
  await expect(x).toHaveValue(firstPosition);
  await page.screenshot({ path: path.join(output, 'text-stage-edit.png') });
  const valid = await input.inputValue();
  await input.fill(valid + '\n@不存在的指令：测试');
  await expect(toggle).toBeDisabled(); await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await input.fill(valid);
  checks.push('文本模式共用舞台控件；图形编辑保留未应用文字、当前光标、滚动位置和输入焦点，撤销不丢前一笔文本；关闭跟随时只修改固定台词，无效文本会暂停舞台编辑。');

  await page.getByRole('button', { name: '模块编辑', exact: true }).click();
  await page.locator('#line-second textarea').click(); await toggle.click();
  await expect(preview).toHaveAttribute('data-preview-key', `${passage.id}/second`);
  await x.fill('55');
  await preview.locator('summary').filter({ hasText: '角色关键帧' }).click();
  const animation = preview.locator('.preview-stage-details').filter({ has: page.locator('summary').filter({ hasText: '角色关键帧' }) });
  await expect(animation.getByLabel('横向位置 %', { exact: true }).nth(0)).toHaveValue('30');
  await expect(animation.getByLabel('横向位置 %', { exact: true }).nth(1)).toHaveValue('55');
  await animation.getByRole('button', { name: '添加关键帧', exact: true }).click();
  await animation.getByLabel('纵向位置 %', { exact: true }).nth(2).fill('75');
  await expect(preview.getByLabel('角色纵向位置 %', { exact: true })).toHaveValue('75');
  const visibleCanvas = (await canvas.boundingBox())!, previewHeading = (await preview.locator('.preview-panel-heading').boundingBox())!;
  expect(visibleCanvas.y).toBeGreaterThanOrEqual(previewHeading.y + previewHeading.height);
  expect(visibleCanvas.y + visibleCanvas.height).toBeLessThan((await preview.boundingBox())!.y + (await preview.boundingBox())!.height);
  await page.screenshot({ path: path.join(output, 'stage-keyframes.png') });
  await preview.locator('summary').filter({ hasText: '角色关键帧' }).click();
  await page.evaluate(() => { const NativeAudio = window.Audio; (window as any).__previewTracks = []; window.Audio = class extends NativeAudio { constructor(src?: string) { super(src); (window as any).__previewTracks.push(this); } }; });
  await preview.getByRole('button', { name: '播放预览', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(preview).toHaveAttribute('data-preview-phase', 'actions');
  const progress = preview.getByLabel('演出预览进度', { exact: true });
  await expect.poll(async () => Number(await progress.inputValue())).toBeGreaterThan(0);
  await progress.fill('1.25');
  const earlierPose = await actor.getAttribute('style');
  await progress.fill('1.6');
  await expect(actor).not.toHaveAttribute('style', earlierPose!);
  await preview.getByRole('button', { name: '播放预览', exact: true }).click();
  await expect.poll(async () => Number(await progress.inputValue())).toBeGreaterThan(1.6);
  expect(await page.evaluate(() => (window as any).__previewTracks.length)).toBeGreaterThan(0);
  await toggle.click(); await expect(preview).toHaveAttribute('data-preview-phase', 'paused');
  const pausedTime = await progress.inputValue();
  const stoppedPose = await actor.getAttribute('style');
  await page.waitForTimeout(100);
  await expect(actor).toHaveAttribute('style', stoppedPose!);
  await expect(progress).toHaveValue(pausedTime);
  expect(await page.evaluate(() => (window as any).__previewTracks.every((audio: HTMLAudioElement) => audio.paused))).toBe(true);
  await preview.getByRole('button', { name: '停止预览', exact: true }).click();
  await expect(preview).toHaveAttribute('data-preview-phase', 'idle');
  await expect(progress).toHaveValue('0');
  checks.push('编辑动画终点保持中间关键帧不变，可继续添加和调整关键帧；播放时收起编辑控件，重新编辑会暂停旧音频和动画，停止预览后进度归零。');

  const transfer = await page.evaluateHandle(() => { const data = new DataTransfer(); data.setData('application/vns-asset', 'voice'); return data; });
  await canvas.dispatchEvent('drop', { dataTransfer: transfer }); await transfer.dispose();
  await expect(preview.getByLabel('试听配音：苏怜烟对白', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: '浏览舞台背景', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '舞台背景资源浏览器', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭资源浏览器', exact: true }).click();
  await page.locator('#node-inspect .passage-header').click();
  await expect(preview).toHaveAttribute('data-preview-key', 'inspect/');
  if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const hotspot = preview.getByRole('button', { name: '互动区域 窗户', exact: true });
  const area = (await hotspot.boundingBox())!, interactionCanvas = (await preview.locator('.stage-canvas').boundingBox())!;
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2); await page.mouse.down();
  await page.mouse.move(area.x + area.width / 2 + interactionCanvas.width * .1, area.y + area.height / 2, { steps: 6 }); await page.mouse.up();
  expect(await hotspot.evaluate(element => parseFloat((element as HTMLElement).style.left))).toBeCloseTo(30, 0);
  const resize = (await hotspot.locator('[data-resize]').boundingBox())!;
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2); await page.mouse.down(); await page.mouse.move(resize.x + resize.width / 2 + 22, resize.y + resize.height / 2 + 12, { steps: 5 }); await page.mouse.up();
  expect(await hotspot.evaluate(element => parseFloat((element as HTMLElement).style.width))).toBeGreaterThan(30);
  await page.screenshot({ path: path.join(output, 'interaction-stage.png') });
  await page.getByRole('button', { name: '文本编辑', exact: true }).click();
  await expect(preview).toHaveAttribute('data-preview-key', 'inspect/'); await expect(hotspot).toBeVisible();
  checks.push('资源缩略图浏览和画布拖入音频继续可用；点击互动节点在同一预览编辑热点位置与尺寸，文本模式也能定位互动节点。');

  await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const saved = JSON.parse(await fs.readFile(projectFile, 'utf8')) as Project;
  const savedPassage = saved.nodes.find(node => node.id === passage.id)!;
  expect(savedPassage.kind).toBe('passage');
  if (savedPassage.kind === 'passage') {
    expect(savedPassage.lines[0].text).toBe('第一句包含刚刚输入、尚未应用的修改。');
    const animation = savedPassage.lines[1].actions.find(action => action.kind === 'animate');
    expect(animation?.kind === 'animate' && animation.keyframes.length).toBe(3);
    expect(savedPassage.lines[2].text).toContain('段内续行 75');
  }
  await page.reload(); await openStoryMode(page, 'script'); await page.locator('#line-last textarea').click(); await toggle.click();
  await expect(x).toHaveValue('30');
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1100, 760); });
  await expect(canvas).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await preview.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect((await canvas.boundingBox())!.width).toBeGreaterThan(280);
  await page.screenshot({ path: path.join(output, 'compact-stage.png') });
  checks.push('保存重开后位置、关键帧、文本与互动布局均保留；1100×760 下编辑与预览没有横向溢出。');
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1440, 960); });
  const y = preview.getByLabel('角色纵向位置 %', { exact: true });
  await x.fill('50'); await y.fill('100'); await preview.getByLabel('角色缩放 %', { exact: true }).fill('150');
  const visibleActor = (await actor.boundingBox())!, screen = (await canvas.boundingBox())!;
  await page.mouse.move(visibleActor.x + visibleActor.width / 2, Math.min(visibleActor.y + visibleActor.height / 2, screen.y + screen.height - 10)); await page.mouse.down();
  await page.mouse.move(visibleActor.x + visibleActor.width / 2, Math.min(visibleActor.y + visibleActor.height / 2, screen.y + screen.height - 10) + screen.height * .25, { steps: 8 }); await page.mouse.up();
  expect(Number(await y.inputValue())).toBeGreaterThan(115);
  const croppedActor = (await actor.boundingBox())!;
  expect(croppedActor.y).toBeLessThan(screen.y + screen.height);
  expect(croppedActor.y + croppedActor.height).toBeGreaterThan(screen.y + screen.height);
  await page.screenshot({ path: path.join(output, 'offscreen-upper-body.png') });
  await page.locator('.app-header').getByRole('button', { name: '撤销', exact: true }).click(); await expect(y).toHaveValue('100');
  await actor.focus(); await actor.press('ArrowDown'); await expect(y).toHaveValue('101');
  await x.focus(); await x.press('Control+a'); await x.pressSequentially('-25'); await expect(x).toHaveValue('-25');
  await preview.getByLabel('舞台选择角色', { exact: true }).selectOption('sly'); await y.fill('140');
  const edited = page.locator('#line-first');
  await edited.getByRole('button', { name: /编辑显示角色/ }).click();
  await edited.getByRole('region', { name: '编辑显示角色', exact: true }).getByLabel('横向位置 %', { exact: true }).fill('125');
  await expect(x).toHaveValue('125');
  await edited.getByRole('button', { name: '收起演出编辑', exact: true }).click();
  await page.locator('#line-last textarea').click();
  await preview.locator('summary').filter({ hasText: '角色关键帧' }).click();
  const offscreenFrames = preview.locator('.preview-stage-details').filter({ has: page.locator('summary').filter({ hasText: '角色关键帧' }) });
  await offscreenFrames.getByLabel('横向位置 %', { exact: true }).last().fill('-25');
  await offscreenFrames.getByLabel('纵向位置 %', { exact: true }).last().fill('140');
  await expect(x).toHaveValue('-25'); await expect(y).toHaveValue('140');
  await preview.locator('summary').filter({ hasText: '角色关键帧' }).click();
  await preview.locator('summary').filter({ hasText: '镜头' }).click();
  await preview.getByLabel('镜头横移 %', { exact: true }).fill('-150');
  await preview.getByLabel('镜头纵移 %', { exact: true }).fill('125');
  await expect(preview.locator('.text-stage-world')).toHaveAttribute('style', /translate\(-150%, 125%\)/);
  await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
  await page.reload(); await openStoryMode(page, 'script'); await page.locator('#line-last textarea').click(); await toggle.click();
  await expect(x).toHaveValue('-25'); await expect(y).toHaveValue('140');
  await expect(preview.locator('.text-stage-world')).toHaveAttribute('style', /translate\(-150%, 125%\)/);
  checks.push('角色拖拽和方向键可越过画面边缘形成半身裁切；位置可逐字输入负数，演出模块、关键帧和镜头支持超出画面的位置，保存重开保持原值。');
  expect(errors).toEqual([]);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors }, null, 2));
  console.log(`PASS: ${checks.length} stage preview groups. ${output}`);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', checks, errors, error: String(error) }, null, 2));
  console.error(error); console.log(output); process.exitCode = 1;
} finally { await app?.close(); await server.close(); }
