import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type Page, type Locator } from '@playwright/test';
import { createProject, type Project } from '../src/core/model';
import { applyTextScript } from '../src/core/text-script';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const baseline = process.argv.includes('--baseline');
const root = path.resolve('.');
const output = path.join(root, 'artifacts/text-preview-pause', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const wav = Buffer.alloc(44 + 8000 * 2 * 8);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
await fs.writeFile(path.join(output, 'silence.wav'), wav);
const base = createProject('文本响应与暂停预览验收');
base.assets.push({ id: 'music', name: '静音', path: 'silence.wav', kind: 'audio' });
const source = '# 段落：正文【passage】\n' + Array.from({ length: 1500 }, (_, i) => `@等待：0.01\n${i === 1499 ? '@背景音乐：静音\n' : ''}旁白：第${i + 1}句，窗外灯火明灭，我们继续讲述这个故事。`).join('\n');
const parsed = applyTextScript(base, source);
assert.deepEqual(parsed.issues, []);
const projectFile = path.join(output, 'project.vns.json');
await fs.writeFile(projectFile, JSON.stringify(parsed.project));
let app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
let page = await app.firstWindow();
const errors: string[] = [], checks: string[] = [], metrics: Record<string, unknown> = {};
page.on('pageerror', error => errors.push(error.message));
let phase = 'launch';
const measureTyping = async (page: Page, input: Locator, text: string) => {
  await input.evaluate(element => {
    const state = window as unknown as { inputFrames: number[]; inputSampleListener?: EventListener };
    state.inputFrames = [];
    if (state.inputSampleListener) element.removeEventListener('input', state.inputSampleListener, true);
    state.inputSampleListener = () => {
      const start = performance.now(); requestAnimationFrame(() => state.inputFrames.push(performance.now() - start));
    };
    element.addEventListener('input', state.inputSampleListener, true);
  });
  await input.pressSequentially(text, { delay: 40 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { inputFrames: number[] }).inputFrames.length)).toBe(text.length);
  const frames = await page.evaluate(() => (window as unknown as { inputFrames: number[] }).inputFrames);
  frames.sort((a, b) => a - b);
  return { count: frames.length, medianMs: frames[Math.floor(frames.length / 2)], p95Ms: frames[Math.floor(frames.length * .95)], maxMs: frames.at(-1) };
};
try {
  await expect(page.locator('.project-title strong')).toHaveText(base.name, { timeout: 45000 });
  await openStoryMode(page, 'text');
  let input = page.getByLabel('中文文本剧本', { exact: true });
  await input.press('Control+End');
  await expect(page.locator('.ui-dialogue-preview')).toContainText('第1500句');
  await page.getByRole('button', { name: '隐藏演出', exact: true }).click();
  await expect(input).not.toHaveValue(/@等待/);
  await input.press('Control+End');
  if (!baseline) {
    phase = 'preview layout and native text selection';
    await expect(page.getByText(/画面出现与消失/)).toHaveCount(0);
    const transport = await page.locator('.preview-transport').boundingBox(), music = await page.locator('.text-preview-music').boundingBox();
    assert.ok(transport && music && music.y >= transport.y + transport.height - 1);
    await expect(page.getByLabel('试听音乐：静音', { exact: true })).toBeVisible();
    checks.push('BGM sits below the playback bar; the image lifetime panel is absent.');
    for (const colorful of [false, true]) {
      const toggle = page.getByRole('button', { name: '彩色标注', exact: true });
      if (await toggle.getAttribute('aria-pressed') !== String(colorful)) await toggle.click();
      await input.press('Control+End');
      const selection = await input.evaluate(element => {
        const text = element as HTMLTextAreaElement, style = getComputedStyle(text), rect = text.getBoundingClientRect();
        text.scrollLeft = 0;
        const start = text.value.lastIndexOf('第1500句'), lineStart = text.value.lastIndexOf('\n', start) + 1;
        const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!;
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const x = rect.x + parseFloat(style.paddingLeft) + context.measureText(text.value.slice(lineStart, start)).width;
        return { x, width: context.measureText('第1500句').width, y: rect.y + parseFloat(style.paddingTop) + (text.value.slice(0, lineStart).split('\n').length - 1) * 22 - text.scrollTop + 11 };
      });
      await page.mouse.move(selection.x + .5, selection.y); await page.mouse.down();
      await page.mouse.move(selection.x + selection.width + .5, selection.y, { steps: 8 }); await page.mouse.up();
      expect(await input.evaluate(element => { const text = element as HTMLTextAreaElement; return text.value.slice(text.selectionStart, text.selectionEnd); })).toBe('第1500句');
      const colors = await input.evaluate(element => { const style = getComputedStyle(element, '::selection'); return { text: style.webkitTextFillColor, background: style.backgroundColor }; });
      expect(colors.text).not.toBe('transparent'); expect(colors.text).not.toBe('rgba(0, 0, 0, 0)'); expect(colors.text).not.toBe(colors.background);
      await page.screenshot({ path: path.join(output, colorful ? 'selection-colorful.png' : 'selection-plain.png') });
    }
    checks.push('Mouse drag selects readable native text near line 1500, with and without syntax colors.');
    await input.press('Control+End');
  }
  phase = 'live typing';
  metrics.live = await measureTyping(page, input, 'abcdefghijkl');
  await expect(page.locator('.ui-dialogue-preview')).toContainText('abcdefghijkl');
  if (!baseline) {
    phase = 'audio cleanup';
    await page.evaluate(() => {
      const state = window as unknown as { previewMedia: HTMLMediaElement[] };
      state.previewMedia = [];
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () { state.previewMedia.push(this); return play.call(this); };
    });
    await page.getByRole('button', { name: '播放预览', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { previewMedia: HTMLMediaElement[] }).previewMedia.some(audio => !audio.paused))).toBe(true);
    await page.getByRole('button', { name: '暂停实时预览', exact: true }).click();
    await expect(page.locator('.story-preview-content')).toHaveAttribute('data-preview-phase', 'suspended');
    await expect(page.locator('.text-live-preview')).toHaveCount(0);
    await expect(page.locator('.passage-performances')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as unknown as { previewMedia: HTMLMediaElement[] }).previewMedia.every(audio => audio.paused))).toBe(true);
    checks.push('暂停实时预览卸载画面和演出编辑区域，正在播放的音频全部停止。');
    phase = 'paused typing';
    await input.press('Control+End');
    metrics.paused = await measureTyping(page, input, 'mnopqrstuvwx');
    const pausedText = await input.inputValue();
    await expect(page.locator('.text-live-preview')).toHaveCount(0);
    await input.press('Control+z');
    await expect(input).not.toHaveValue(pausedText);
    await input.press('Control+y');
    await expect(input).toHaveValue(pausedText);
    await input.press('Control+End');
    await page.getByRole('button', { name: '恢复实时预览', exact: true }).click();
    await expect(page.locator('.ui-dialogue-preview')).toContainText('abcdefghijklmnopqrstuvwx');
    checks.push('暂停期间可持续输入、撤销和重做；恢复立即显示当前文本和选中台词。');
    phase = 'save and restore preference';
    await page.getByRole('button', { name: '暂停实时预览', exact: true }).click();
    await page.getByRole('button', { name: '应用到项目', exact: true }).click();
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await expect(page.locator('.dirty-dot')).toHaveCount(0);
    const saved: Project = JSON.parse(await fs.readFile(projectFile, 'utf8'));
    const node = saved.nodes.find(node => node.kind === 'passage')!;
    assert.equal(node.lines.length, 1500);
    assert.ok(node.lines.at(-1)!.text.endsWith('abcdefghijklmnopqrstuvwx'));
    assert.deepEqual(node.lines.at(-1)!.actions.map(action => action.kind), ['pause', 'music']);
    await page.screenshot({ path: path.join(output, 'preview-paused.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy()));
    await app.close();
    app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await expect(page.locator('.project-title strong')).toHaveText(base.name, { timeout: 45000 });
    await openStoryMode(page, 'text');
    await expect(page.getByRole('button', { name: '恢复实时预览', exact: true })).toBeVisible();
    await expect(page.locator('.text-live-preview')).toHaveCount(0);
    input = page.getByLabel('中文文本剧本', { exact: true });
    await input.press('Control+End');
    await page.getByRole('button', { name: '恢复实时预览', exact: true }).click();
    await expect(page.locator('.ui-dialogue-preview')).toContainText('abcdefghijklmnopqrstuvwx');
    await page.screenshot({ path: path.join(output, 'preview-resumed.png') });
    checks.push('保存重开保留暂停偏好、1500句台词和演出动作；恢复后显示保存的最新文本。');
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', baseline, checks, metrics, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', baseline, phase, error: String(error), checks, metrics, errors }, null, 2));
  throw error;
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
  await app.close(); console.log(output);
}
