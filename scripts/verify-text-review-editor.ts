import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Exercise actual React owners and native audio. Only the metadata callback is
// delayed, so asynchronous edits cannot pass merely because a WAV loads quickly.
const root = path.resolve('.');
const output = path.join(root, 'artifacts/text-review-editor', new Date().toISOString().replaceAll(':', '-'));
const directory = path.join(output, 'project'), projectFile = path.join(directory, 'project.vns.json');
await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
const wav = Buffer.alloc(44 + 24000, 128);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28);
wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
await fs.writeFile(path.join(directory, 'assets/typing.wav'), wav);
await fs.writeFile(path.join(directory, 'assets/voice.wav'), wav);
const project = createProject('文字演出代码审查验收');
project.assets = ['typing', 'voice'].map(id => ({ id, name: id === 'voice' ? '配音' : '打字音', kind: 'audio', path: `assets/${id}.wav` }));
project.textPresets = [
  { id: 'parent_look', name: '父角色预设', style: { color: '#112233', italic: true, entrance: 'drop', entranceAnimation: { x: 40, rotation: 90 } } },
  { id: 'child_look', name: '派生角色预设', style: { color: '#00ff66', entrance: 'fade', entranceAnimation: { y: 14 } } },
];
project.characters = [
  { id: 'parent', name: '父角色', color: '#ffffff', expressions: [], textPresentation: { presetId: 'parent_look', color: '#ff0000' } },
  { id: 'child', name: '派生角色', color: '#ffffff', expressions: [], baseCharacterId: 'parent', textPresentation: { presetId: 'child_look' } },
];
const passage = project.nodes.find(node => node.kind === 'passage')!;
passage.lines = [
  { id: 'guard', text: '第一句必须保持原样。', actions: [], textPresentation: { color: '#123456', speed: 'instant' } },
  { id: 'review', text: '这是一段足够长的台词，可以检查连续打字音、预览退场和配音读取。', actions: [], speakerId: 'child', voiceId: 'voice', textPresentation: { speed: 'duration', duration: .8, exit: 'fade', exitTotal: .2, typeSoundId: 'typing', typeSoundEvery: 1 } },
  ...Array.from({ length: 60 }, (_, index) => ({ id: `filler_${index}`, text: `第${index + 3}句用于验证预览滚出屏幕后会暂停。`, actions: [] })),
];
await fs.writeFile(projectFile, JSON.stringify(projectSchema.parse(project)));
let app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
let page = await app.firstWindow();
const checks: string[] = [], errors: string[] = [], evidence: Record<string, unknown> = {};
page.on('pageerror', error => errors.push(error.message));
let phase = 'launch';
const saved = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.webContents.setBackgroundThrottling(false); window.setContentSize(1600, 1050); });
  await openStoryMode(page, 'script');
  const row = page.locator('#line-review'), editor = row.locator('.line-text-effects');
  await row.locator('.line-expand').click();
  await expect(editor.getByLabel('斜体', { exact: true })).toBeChecked();
  await expect(editor.getByLabel('文字颜色', { exact: true })).toHaveValue('#00ff66');
  const sample = editor.locator('.text-look-sample');
  await expect(sample.locator('.styled-text')).toHaveCSS('color', 'rgb(0, 255, 102)');
  await expect(page.locator('.ui-dialogue-preview .styled-text').first()).toHaveCSS('color', 'rgb(0, 255, 102)');
  await editor.getByRole('tab', { name: '文字动画', exact: true }).click();
  const adjustments = editor.locator('.text-animator');
  if (await adjustments.getAttribute('open') === null) await adjustments.locator('summary').click();
  await expect(editor.getByLabel('入场横向位移', { exact: true })).toHaveValue('0');
  await expect(editor.getByLabel('入场纵向位移', { exact: true })).toHaveValue('14');
  await expect(editor.getByLabel('入场旋转角度', { exact: true })).toHaveValue('0');
  checks.push('派生角色预设覆盖父角色颜色，保留继承斜体；新动画没有混入旧位移与旋转，面板和舞台一致');

  await page.evaluate(`(() => {
    const state = window.textReview = { instances: [], plays: [], held: [], holdMetadata: false, peak: 0 };
    const NativeAudio = window.Audio;
    window.Audio = function (...args) {
      const audio = new NativeAudio(...args);
      state.instances.push(audio);
      if (state.holdMetadata && !args.length) {
        let callback = null;
        Object.defineProperty(audio, 'onloadedmetadata', { configurable: true, get: () => callback, set: next => {
          callback = next;
          if (next) state.held.push({ audio, callback: next });
        } });
      }
      return audio;
    };
    window.Audio.prototype = NativeAudio.prototype;
    Object.setPrototypeOf(window.Audio, NativeAudio);
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      state.plays.push(this);
      return play.call(this).then(() => { state.peak = Math.max(state.peak, state.instances.filter(audio => !audio.paused).length); });
    };
  })()`);
  const tab = (name: string) => editor.getByRole('tab', { name, exact: true }).click();
  const duration = editor.getByLabel('整句时长（秒）', { exact: true });
  const stats = () => page.evaluate(() => {
    const state = (window as any).textReview;
    return { instances: state.instances.length, plays: state.plays.length, peak: state.peak, active: state.instances.filter((audio: HTMLAudioElement) => !audio.paused).length, released: state.instances.every((audio: HTMLAudioElement) => audio.paused && !audio.getAttribute('src')) };
  });
  const allHidden = () => sample.locator('.styled-char').evaluateAll(nodes => nodes.length > 0 && nodes.every(node => Number((node as HTMLElement).style.opacity) === 0));
  phase = 'exit final frame';
  await sample.getByRole('button', { name: '重播', exact: true }).click();
  await expect.poll(() => sample.locator('.styled-char').evaluateAll(nodes => nodes.some(node => Number((node as HTMLElement).style.opacity) > .9))).toBe(true);
  await expect.poll(allHidden).toBe(true);
  await page.waitForTimeout(400);
  assert.equal(await allHidden(), true, 'completed exit must not draw the words again');
  const scroll = page.locator('.script-scroll');
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(sample).toHaveAttribute('data-preview-active', 'false');
  await sample.scrollIntoViewIfNeeded();
  await expect(sample).toHaveAttribute('data-preview-active', 'true');
  await page.waitForTimeout(200);
  assert.equal(await allHidden(), true, 'scrolling back must keep the final exit frame');
  await page.screenshot({ path: path.join(output, 'exit-complete.png') });
  checks.push('小样本退场后持续不可见；滚出再滚回不复现，只有重播重新开始');

  phase = 'typing sound lifecycle';
  await tab('播放速度');
  await duration.fill('6'); await duration.press('Tab');
  const before = await stats();
  await sample.getByRole('button', { name: '重播', exact: true }).click();
  await expect.poll(async () => (await stats()).plays - before.plays).toBeGreaterThanOrEqual(3);
  const playing = await stats();
  assert.equal(playing.instances - before.instances, 1, 'one owned audio element per active sample');
  assert.equal(playing.peak, 1, 'typing pulses do not overlap');
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(sample).toHaveAttribute('data-preview-active', 'false');
  await expect.poll(async () => (await stats()).released).toBe(true);
  await sample.scrollIntoViewIfNeeded();
  await expect(sample).toHaveAttribute('data-preview-active', 'true');
  await expect.poll(async () => (await stats()).plays).toBeGreaterThan(playing.plays);
  await row.locator('.line-expand').click();
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await stats()).released).toBe(true);
  evidence.audio = await stats();
  checks.push('连续打字复用单个音频，没有多字叠音；离屏和收起均停止播放并释放媒体地址，滚回正常续播');

  phase = 'metadata preserves later edits';
  await row.locator('.line-expand').click();
  await tab('播放速度');
  await page.evaluate(() => { (window as any).textReview.holdMetadata = true; });
  const beginRead = async (count: number) => {
    await tab('播放速度');
    await editor.getByRole('button', { name: '时长与配音一致', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).textReview.held.length)).toBe(count);
  };
  const release = (index: number, seconds: number) => page.evaluate(({ index, seconds }) => {
    const held = (window as any).textReview.held[index];
    Object.defineProperty(held.audio, 'duration', { configurable: true, value: seconds });
    held.callback.call(held.audio, new Event('loadedmetadata'));
  }, { index, seconds });
  const released = (index: number) => page.evaluate(index => !(window as any).textReview.held[index].audio.getAttribute('src'), index);
  await beginRead(1);
  await tab('文字样式');
  await editor.getByLabel('文字颜色', { exact: true }).fill('#22aa55');
  await editor.getByLabel('粗体', { exact: true }).check();
  await release(0, 2.75);
  await tab('播放速度'); await expect(duration).toHaveValue('2.75');
  await tab('文字样式');
  await expect(editor.getByLabel('文字颜色', { exact: true })).toHaveValue('#22aa55');
  await expect(editor.getByLabel('粗体', { exact: true })).toBeChecked();
  checks.push('延迟读取配音期间继续改颜色与粗体，时长返回后两项新编辑均保留');

  phase = 'superseded and unmounted reads';
  await beginRead(2); await beginRead(3);
  assert.equal(await released(1), true, 'a second request cancels and releases the first');
  await release(1, 7.5);
  await expect(duration).toHaveValue('2.75');
  await release(2, 1.25); await expect(duration).toHaveValue('1.25');
  await beginRead(4);
  await row.locator('.line-expand').click();
  await expect.poll(() => released(3)).toBe(true);
  await release(3, 9);
  await row.locator('.line-expand').click();
  await tab('播放速度'); await expect(duration).toHaveValue('1.25');
  await beginRead(5);
  await row.getByRole('button', { name: '删除对白', exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect.poll(() => released(4)).toBe(true);
  await release(4, 8);
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const final = await saved(), lines = final.nodes.find(node => node.kind === 'passage')!.lines;
  assert.deepEqual(lines[0], passage.lines[0], 'late metadata for a deleted line must not modify the first line');
  assert.equal(lines.some(line => line.id === 'review'), false);
  await fs.writeFile(path.join(output, 'saved-evidence.json'), JSON.stringify({ firstLine: lines[0], deletedLineAbsent: true, audio: await stats() }, null, 2));
  checks.push('重复读取、收起面板、删除台词均取消旧请求；模拟旧回调晚到，也不会恢复删行或误改首行');

  phase = 'reopen';
  await app.close();
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await openStoryMode(page, 'script');
  await expect(page.locator('#line-guard .dialogue-input')).toHaveValue(passage.lines[0].text);
  await expect(page.locator('#line-review')).toHaveCount(0);
  await page.screenshot({ path: path.join(output, 'reopened.png') });
  checks.push('保存重开保留正确台词，首行文字和样式不受已取消请求影响');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, evidence, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, error: String(error), checks, evidence, errors }, null, 2));
  throw error;
} finally {
  await app.close();
  const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']);
  assert.deepEqual(cleanup.errors, []);
  console.log(output);
}
