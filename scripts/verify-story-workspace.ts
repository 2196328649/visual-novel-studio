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
const output = path.join(root, 'artifacts/story-workspace', new Date().toISOString().replaceAll(':', '-'));
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
const project = createProject('统一剧本工作区验证');
project.assets = [
  { id: 'night', name: '夜宴', kind: 'image', category: 'scene', path: 'assets/night.png', width: 640, height: 360 },
  { id: 'room', name: '屋内', kind: 'image', category: 'scene', path: 'assets/room.png', width: 640, height: 360 },
  { id: 'actor', name: '苏怜烟立绘', kind: 'image', category: 'portrait', path: 'assets/actor.png', width: 90, height: 230 },
  ...(['bgm', 'voice', 'sound'] as const).map(category => ({ id: category, name: { bgm: '花街柳巷', voice: '苏怜烟对白', sound: '推门' }[category], kind: 'audio' as const, category, path: 'assets/clip.wav' })),
];
project.characters = [{ id: 'sly', name: '苏怜烟', color: '#a6d2c0', expressions: [{ id: 'normal', name: '通常', assetId: 'actor' }, { id: 'smile', name: '微笑', assetId: 'actor' }] }];
project.variables = [{ id: 'mood', name: '心情', type: 'number', initial: 0, persistent: false }];
project.playerDefaults = { textSpeed: 20, masterVolume: .5, musicVolume: .4, voiceVolume: .8 };
const passage = project.nodes.find(node => node.kind === 'passage')!;
passage.lines = [
  { id: 'first', speakerId: 'sly', text: '第一句用于编辑角色和演出。', actions: [{ kind: 'background', assetId: 'night', transition: 'dissolve' }, { kind: 'show', characterId: 'sly', expressionId: 'normal', x: .5, y: 1, scale: .4, layer: 10, transition: 'dissolve' }, { kind: 'music', assetId: 'bgm', loop: true, fade: .5 }] },
  { id: 'second', speakerId: 'sly', text: '第二句台词逐字播放，同时播放配音。', voiceId: 'voice', actions: [{ kind: 'background', assetId: 'room', transition: 'dissolve' }, { kind: 'show', characterId: 'sly', expressionId: 'smile', x: .65, y: 1, scale: .8, layer: 10, transition: 'move' }, { kind: 'pause', seconds: .15 }, { kind: 'sound', assetId: 'sound' }, { kind: 'camera', x: 0.05, y: 0, zoom: 1.1, rotation: 0, duration: .3, easing: 'ease', wait: false }] },
  { id: 'last', text: '最后一句没有配音。', actions: [] },
];
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
  const preview = page.locator('.story-preview-content'), first = page.locator('#line-first'), second = page.locator('#line-second');
  await expect(preview).toBeVisible();
  await expect(page.locator('.editor-layout > .inspector')).toHaveCount(0);
  await expect(page.locator('.app-header .view-tabs')).toBeVisible();
  await expect(page.locator('.brand')).toHaveCount(0);
  await expect(page.getByLabel('预览对白', { exact: true })).toHaveCount(0);
  await expect(preview.locator('.text-panel-heading').getByLabel('跟随光标', { exact: true })).toBeChecked();
  const selectBox = await first.locator('.line-top > select').boundingBox(), textBox = await first.locator('textarea').boundingBox(), cuesBox = await first.locator('.line-effect-strip').boundingBox();
  expect(Math.abs(selectBox!.y - textBox!.y)).toBeLessThan(15); expect(cuesBox!.y + cuesBox!.height).toBeLessThanOrEqual(textBox!.y);
  checks.push('模块与文本共用一个工作区；顶部导航替代 Logo，预览标题栏包含跟随光标，无多余台词选择框；说话人与台词同排。');

  await first.getByRole('button', { name: /编辑显示角色/ }).click();
  const effect = first.getByRole('region', { name: '编辑显示角色', exact: true });
  await effect.getByLabel('横向位置 %', { exact: true }).fill('30');
  await effect.getByLabel('纵向位置 %', { exact: true }).fill('80');
  await effect.getByLabel('表情', { exact: true }).selectOption('smile');
  await expect(preview).toHaveAttribute('data-preview-key', `${passage.id}/first`);
  await expect(preview.locator('.text-stage-actor')).toHaveCSS('left', /.+/);
  expect(await preview.locator('.text-stage-actor').evaluate(element => (element as HTMLElement).style.left)).toBe('30%');
  await first.getByRole('button', { name: '收起演出编辑', exact: true }).click();
  await first.getByRole('button', { name: '为第1行添加效果', exact: true }).click();
  await first.getByRole('menuitem', { name: '等待', exact: true }).click();
  await first.getByRole('region', { name: '编辑等待', exact: true }).getByLabel('等待 秒', { exact: true }).fill('0.2');
  await page.locator('.app-header').getByRole('button', { name: '撤销', exact: true }).click();
  await expect(first.getByLabel('等待 秒', { exact: true })).toHaveValue('1');
  await page.locator('.app-header').getByRole('button', { name: '重做', exact: true }).click();
  await expect(first.getByLabel('等待 秒', { exact: true })).toHaveValue('0.2');
  await first.getByRole('button', { name: '收起演出编辑', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'module-editor.png') });
  checks.push('台词上方的演出模块可展开、实时改位置与表情、添加效果，并使用共享撤销和重做。');

  await preview.evaluate(element => { (window as any).__persistentPreview = element; });
  await page.getByRole('button', { name: '文本编辑', exact: true }).click();
  const input = page.getByLabel('中文文本剧本', { exact: true });
  expect(await preview.evaluate(element => (window as any).__persistentPreview === element)).toBe(true);
  expect(await input.inputValue()).toContain('@显示角色：苏怜烟，微笑，0.3，0.4，0.8');
  expect(await input.inputValue()).not.toContain('【sly】');
  await input.evaluate(element => { const t = element as HTMLTextAreaElement, at = t.value.indexOf('苏怜烟：第一句'); t.focus(); t.setSelectionRange(at, at); });
  await input.press('ArrowRight'); await input.press('ArrowLeft');
  const stageToggle = preview.getByRole('button', { name: '编辑舞台', exact: true }), vertical = preview.getByLabel('角色纵向位置 %', { exact: true });
  await stageToggle.click(); await expect(vertical).toHaveValue('80');
  const actorBox = (await preview.locator('[data-character-id="sly"]').boundingBox())!;
  await page.mouse.move(actorBox.x + actorBox.width / 2, actorBox.y + actorBox.height / 2);
  await page.mouse.down(); await page.mouse.move(actorBox.x + actorBox.width / 2, actorBox.y + actorBox.height / 2 + 12, { steps: 4 }); await page.mouse.up();
  expect(Number(await vertical.inputValue())).toBeGreaterThan(80);
  expect(await input.inputValue()).toContain(`@显示角色：苏怜烟，微笑，0.3，0.4，${Number(await vertical.inputValue()) / 100}`);
  await vertical.fill('140');
  const expectCaretOnDialogue = async () => expect(await input.evaluate(element => { const text = element as HTMLTextAreaElement; return text.value.slice(text.selectionStart).startsWith('苏怜烟：第一句'); })).toBe(true);
  await expectCaretOnDialogue();
  expect(await input.inputValue()).toContain('@显示角色：苏怜烟，微笑，0.3，0.4，1.4');
  await page.locator('.app-header').getByRole('button', { name: '撤销', exact: true }).click();
  await expectCaretOnDialogue();
  expect(await input.inputValue()).not.toContain('@显示角色：苏怜烟，微笑，0.3，0.4，1.4');
  await page.locator('.app-header').getByRole('button', { name: '重做', exact: true }).click();
  await expectCaretOnDialogue();
  await expect(vertical).toHaveValue('140');
  expect(await input.inputValue()).toContain('@显示角色：苏怜烟，微笑，0.3，0.4，1.4');
  await stageToggle.click();
  checks.push('模块纵向位置同步到第五个文本参数；在文本模式拖动和输入超过 100% 的位置仍保留显示角色指令，撤销/重做同时还原数值和画面。');
  const beforeCompletion = await input.inputValue();
  await input.fill(beforeCompletion + '\n\n# 段落：补全测试\n\n旁白：这句保留。');
  const at = (await input.inputValue()).indexOf('\n\n旁白：这句保留。') + 1;
  await input.evaluate((element, offset) => { const t = element as HTMLTextAreaElement; t.focus(); t.setSelectionRange(offset, offset); }, at);
  await input.press('ArrowRight'); await input.press('ArrowLeft');
  await page.keyboard.type('@xsjs');
  await expect(page.getByRole('listbox', { name: '文本补全建议' })).toBeVisible();
  await expect(page.getByRole('option', { name: /显示角色/ }).first()).toHaveAttribute('aria-selected', 'true');
  await input.press('Enter');
  await page.keyboard.type('sl');
  await expect(page.getByRole('listbox').getByRole('option', { name: /苏怜烟/ })).toBeVisible();
  await input.press('Tab');
  await page.keyboard.insertText('，w');
  await expect(page.getByRole('listbox').getByRole('option', { name: /微笑/ })).toBeVisible();
  await input.press('Enter');
  await page.keyboard.insertText('，0.5，0.4');
  await expect(page.getByRole('note', { name: '指令参数提示' })).toContainText('缩放倍数');
  await expect(page.locator('.text-signature span.active')).toHaveText('，缩放');
  expect(await input.inputValue()).toContain('@显示角色：苏怜烟，微笑，0.5，0.4\n旁白：这句保留。');
  await page.keyboard.insertText('，1.2');
  await expect(page.locator('.text-signature span.active')).toHaveText('，纵向位置');
  await expect(page.getByRole('note', { name: '指令参数提示' })).toContainText('立绘底部');
  await page.screenshot({ path: path.join(output, 'text-parameter-hint.png') });
  await input.press('Escape'); await expect(page.getByRole('note', { name: '指令参数提示' })).toHaveCount(0);
  await input.press('Control+z'); expect(await input.inputValue()).toContain('旁白：这句保留。');
  await input.press('Control+End'); await page.keyboard.insertText('\n@');
  await input.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' })));
  await page.keyboard.insertText('显');
  await expect(page.getByRole('listbox', { name: '文本补全建议' })).toHaveCount(0);
  expect(await input.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })))).toBe(true);
  await input.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '显' })));
  await expect(page.getByRole('listbox', { name: '文本补全建议' })).toBeVisible();
  await page.screenshot({ path: path.join(output, 'text-completion.png') });
  await input.press('Escape');
  for (const command of ['显示角色']) {
    await input.fill(beforeCompletion + '\n# 段落：位置插入测试\n/');
    await expect(page.getByRole('dialog', { name: '中文指令面板', exact: true }).getByRole('button', { name: '角色', exact: true })).toHaveCount(0);
    await page.getByRole('dialog', { name: '中文指令面板', exact: true }).getByRole('button', { name: command, exact: true }).click();
    const picker = page.getByRole('dialog', { name: '命令参数', exact: true });
    await expect(picker.getByLabel('纵向位置', { exact: true })).toHaveValue('1');
    await picker.getByLabel('缩放', { exact: true }).fill('0.4');
    await picker.getByLabel('纵向位置', { exact: true }).fill('-0.2');
    await page.screenshot({ path: path.join(output, `position-picker-${command}.png`) });
    await picker.getByRole('button', { name: '插入指令', exact: true }).click();
    expect(await input.inputValue()).toContain(`@${command}：苏怜烟，通常，0.5，0.4，-0.2`);
  }
  await input.fill(beforeCompletion);
  await page.getByRole('button', { name: '模块编辑', exact: true }).click();
  checks.push('两种模式保留同一个预览面板；原有演出同步到源码，拼音首字母补全指令/角色/表情，参数提示正确描述缩放；中文组词时不接管 Enter，补全不覆盖下一句。');

  await page.evaluate(() => {
    const NativeAudio = window.Audio;
    (window as any).__previewTracks = [];
    window.Audio = class extends NativeAudio { constructor(src?: string) { super(src); const record = { element: this, starts: 0, ended: 0 }; this.addEventListener('playing', () => record.starts++); this.addEventListener('ended', () => record.ended++); (window as any).__previewTracks.push(record); } };
  });
  await second.locator('textarea').click();
  await preview.getByRole('button', { name: '播放预览', exact: true }).click();
  await expect(preview).toHaveAttribute('data-preview-phase', 'actions');
  await expect.poll(() => page!.evaluate(() => document.getAnimations().filter(a => (a.effect as KeyframeEffect)?.target?.closest('.text-stage')).length)).toBeGreaterThan(0);
  await expect(preview).toHaveAttribute('data-preview-phase', 'dialogue', { timeout: 5000 });
  const fullText = passage.lines[1].text;
  expect(await preview.locator('.ui-dialogue-preview').innerText()).not.toContain(fullText);
  await expect.poll(() => page!.evaluate(() => (window as any).__previewTracks.filter((record: any) => record.starts > 0).length)).toBeGreaterThanOrEqual(3);
  await expect(preview).toHaveAttribute('data-preview-phase', 'finished', { timeout: 8000 });
  await expect(preview.locator('.ui-dialogue-preview')).toContainText(fullText);
  expect(await page.evaluate(() => (window as any).__previewTracks.every((record: any) => record.element.paused))).toBe(true);
  checks.push('播放预览使用真实 Chromium 动画和音频：顺序执行转场与等待、逐字显示台词，BGM/音效/配音实际开始播放，结束后释放声音。');

  await preview.getByRole('button', { name: '播放预览', exact: true }).click();
  await page.locator('#line-last textarea').click();
  await expect(preview).toHaveAttribute('data-preview-key', `${passage.id}/last`);
  await expect(preview).toHaveAttribute('data-preview-phase', 'idle');
  expect(await page.evaluate(() => (window as any).__previewTracks.every((record: any) => record.element.paused))).toBe(true);
  await second.locator('textarea').click();
  await preview.getByRole('button', { name: '播放预览', exact: true }).click();
  await preview.getByRole('button', { name: '停止预览', exact: true }).click();
  await expect(preview).toHaveAttribute('data-preview-phase', 'idle');
  expect(await page.evaluate(() => document.getAnimations().filter(a => (a.effect as KeyframeEffect)?.target?.closest('.text-stage')).length)).toBe(0);
  await preview.getByLabel('跟随光标', { exact: true }).uncheck();
  await page.locator('#line-last textarea').click();
  await expect(preview).toHaveAttribute('data-preview-key', `${passage.id}/second`);
  await preview.getByLabel('跟随光标', { exact: true }).check();
  await expect(preview).toHaveAttribute('data-preview-key', `${passage.id}/last`);
  checks.push('停止预览、切换台词立即取消旧声音和动画；关闭跟随光标固定画面，再开启恢复当前选中台词。');

  await page.getByRole('button', { name: '作品设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '作品设置', exact: true });
  await expect(settings).toBeVisible();
  await settings.getByLabel('作品名称', { exact: true }).fill('统一剧本验证 · 设置');
  await settings.getByRole('button', { name: '试玩设置', exact: true }).click();
  await settings.getByLabel('试玩方式', { exact: true }).selectOption('window');
  await settings.getByLabel('从这里开始', { exact: true }).selectOption(passage.id);
  await settings.getByLabel('心情', { exact: true }).fill('7');
  await page.screenshot({ path: path.join(output, 'project-settings.png') });
  await settings.press('Escape'); await expect(settings).toHaveCount(0);
  await expect(page.getByRole('button', { name: '作品设置', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '作品设置', exact: true }).click();
  await settings.getByRole('button', { name: '试玩设置', exact: true }).click();
  await expect(settings.getByLabel('试玩方式', { exact: true })).toHaveValue('window');
  await expect(settings.getByLabel('心情', { exact: true })).toHaveValue('7');
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const saved = JSON.parse(await fs.readFile(projectFile, 'utf8')) as Project;
  expect(saved.nodes.find(n => n.id === passage.id)?.kind).toBe('passage');
  expect(saved.name).toBe('统一剧本验证 · 设置'); expect(saved.variables[0].initial).toBe(0);
  const savedPassage = saved.nodes.find(n => n.id === passage.id);
  const savedActor = savedPassage?.kind === 'passage' && savedPassage.lines[0].actions.find(action => action.kind === 'show');
  expect(savedActor && savedActor.y).toBe(1.4);
  checks.push('作品设置为具有键盘焦点与 Esc 关闭的独立弹窗，包含试玩方式/起点/测试状态；作品信息可保存，测试值不会改写初始状态。');

  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1100, 760); });
  await expect(preview).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const stageBounds = await preview.locator('.text-stage').boundingBox(); expect(stageBounds!.width).toBeGreaterThan(280);
  await page.screenshot({ path: path.join(output, 'compact-workspace.png') });
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('studio:preview'); ipcMain.handle('studio:preview', (_event, _project, options) => { (globalThis as any).__previewOptions = options; return { ok: false, diagnostics: [], log: 'Settings boundary verified; full runtime intentionally not started.' }; }); });
  await page.getByRole('button', { name: '试玩', exact: true }).click();
  await expect.poll(() => app!.evaluate(() => (globalThis as any).__previewOptions)).toEqual({ entryId: passage.id, variables: { mood: 7 }, mode: 'window' });
  checks.push('1100×760 窗口仍保留编辑与预览空间；工具栏试玩使用设置中的方式、起点与测试值（仅验证 IPC 参数，不启动或打包完整游戏）。');
  await page.reload(); await openStoryMode(page, 'text');
  expect(await input.inputValue()).toContain('@显示角色：苏怜烟，微笑，0.3，0.4，1.4');
  await page.getByRole('button', { name: '模块编辑', exact: true }).click();
  await first.getByRole('button', { name: /编辑显示角色/ }).click();
  await expect(first.getByRole('region', { name: '编辑显示角色', exact: true }).getByLabel('纵向位置 %', { exact: true })).toHaveValue('140');
  checks.push('两种角色指令均提供纵向位置输入和第五项补全提示；负数可插入，保存并重新加载后文本与模块编辑保留纵向位置 140%。');
  expect(errors).toEqual([]);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors }, null, 2));
  console.log(`PASS: ${checks.length} checks. ${output}`);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', checks, errors, error: String(error) }, null, 2));
  console.error(error); console.log(output); process.exitCode = 1;
} finally { await app?.close(); await server.close(); }
