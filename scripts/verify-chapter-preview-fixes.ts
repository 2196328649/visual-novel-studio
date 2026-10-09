import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { expect } from '@playwright/test';
import { assetSourcePath, parseProject } from '../src/desktop/project-store';
import { assetFiles } from '../src/core/model';
import { applyTextScript } from '../src/core/text-script';
import { createChapterPerformance, chapterBlueprintPair } from '../src/core/chapter-performances';
import { commandPerformanceBlueprints } from '../src/core/builtin-performances';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';
import { writeTestTone } from './lib/test-tone';
const root = path.resolve('.'), output = path.resolve('artifacts/chapter-preview-fixes', new Date().toISOString().replaceAll(':', '-'));
const folder = path.join(output, 'project'); await fs.mkdir(folder, { recursive: true });
const author = 'E:/Project/Visual Novel Studio/我的视觉小说1/project.vns.json';
const bytes = await fs.readFile(author), saved = JSON.parse(bytes.toString());
const auto = await fs.readFile(author + '.autosave', 'utf8').then(JSON.parse).catch(() => undefined);
const project = parseProject(auto?.savedAt > (await fs.stat(author)).mtimeMs ? auto.project : saved).project;
for (const asset of project.assets) asset.externalFiles = Object.fromEntries(assetFiles(asset).map(file => [file, assetSourcePath(path.dirname(author), asset, file)]));
for (const [id, seconds] of [['qa_long', 72], ['qa_short', .25]] as const) {
 await writeTestTone(path.join(folder, id + '.wav'), seconds);
 project.assets.push({ id, name: id, kind: 'audio', category: 'sound', path: id + '.wav' });
}
for (const [id, color] of [['qa_red', [230, 30, 30]], ['qa_blue', [30, 30, 230]]] as const) {
 const png = new PNG({ width: 64, height: 64 }); for (let i = 0; i < png.data.length; i += 4) png.data.set([...color, 255], i);
 await fs.writeFile(path.join(folder, id + '.png'), PNG.sync.write(png)); project.assets.push({ id, name: id, kind: 'image', category: 'scene', path: id + '.png' });
}
// Exercise the freshly authored preset too, not only the project-data upgrade.
project.blueprints = project.blueprints.filter(g => !g.id.startsWith('builtin_chapter_text'));
project.blueprints.push(...chapterBlueprintPair(createChapterPerformance(project, 'text')));
assert.deepEqual(commandPerformanceBlueprints(project).filter(g => g.chapterVariant).map(g => g.name).sort(), ['章节进入演出图片版', '章节进入演出文字版']);
const intro = '@章节进入演出文字版：标题=预览验收，时长=2，章节背景=qa_red，章节音效=qa_long\n@演出转场：方式=纯色，淡出=0.2，停留=0，淡入=0.2\n@独立演出：预览章\n旁白：演出已结束。';
const parsed = applyTextScript(project, intro); assert.deepEqual(parsed.issues, []);
parsed.project.scriptText = { format: 'vns-text-1', content: intro, performanceSyntax: 'explicit', standaloneSyntax: 'module-names' };
// Older authored image presets may mark this optional; exercise the required
// contract explicitly, as a newly generated image preset does.
parsed.project.blueprints.find(g => g.chapterVariant === 'image')!.exposedInputs.find(p => p.name === '章节题图')!.required = true;
const file = path.join(folder, 'project.vns.json'); await fs.writeFile(file, JSON.stringify(parsed.project));
const app = await launchDesktopFixture({ root, projectFile: file, profile: path.join(output, 'profile') });
const page = await app.firstWindow(), errors: string[] = [], checks: string[] = [];
page.on('pageerror', e => errors.push(e.message));
try {
 await expect(page.locator('.project-title strong')).toBeVisible({ timeout: 60000 }); await openStoryMode(page, 'text');
 const input = page.getByLabel('中文文本剧本', { exact: true }), preview = page.locator('.story-preview-content');
 await page.evaluate(() => { const original = HTMLMediaElement.prototype.play; (window as any).__plays = []; (window as any).__playedAudio = []; HTMLMediaElement.prototype.play = function () { (window as any).__plays.push(this.src); (window as any).__playedAudio.push(this); return original.call(this); }; });
 const selectChapter = async (ctrl = false) => {
  await input.press('Control+Home'); await input.press('ArrowRight');
  await expect(preview.locator('.preview-source-position')).toHaveText('第 1 行');
  await input.evaluate((e, ctrl) => { const t = e as HTMLTextAreaElement, at = t.value.indexOf('@章节进入演出文字版'); t.focus(); t.setSelectionRange(at + 3, at + 3); t.dispatchEvent(new Event('select', { bubbles: true })); t.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: ctrl })); }, ctrl);
 };
 await selectChapter();
 await expect(page.getByRole('button', { name: '播放预览', exact: true })).toBeEnabled();
 await page.getByRole('button', { name: '播放预览', exact: true }).click();
 await expect.poll(() => page.evaluate(() => (window as any).__plays.some((s: string) => s.includes('qa_long.wav')))).toBe(true);
 await expect(preview).toHaveAttribute('data-preview-phase', 'finished', { timeout: 7000 });
 const end = Number(await page.getByLabel('演出预览进度', { exact: true }).getAttribute('max'));
 assert.ok(end <= 2.5, String(end));
 assert.equal(await page.evaluate(() => (window as any).__playedAudio.every((a: HTMLAudioElement) => a.paused)), true);
 checks.push('72 秒音效没有拉长 2.4 秒独立演出；预览结束时音效停止');
 for (const sound of ['qa_short', '无']) {
  await input.fill(intro.replace('章节音效=qa_long', '章节音效=' + sound)); await selectChapter();
  await expect(preview).toHaveAttribute('data-preview-phase', 'idle');
  await page.evaluate(() => { (window as any).__plays = []; });
  await page.getByRole('button', { name: '播放预览', exact: true }).click();
  await expect(preview).toHaveAttribute('data-preview-phase', 'finished', { timeout: 7000 });
  const plays = await page.evaluate(() => (window as any).__plays as string[]);
  assert.equal(plays.some(s => s.includes('qa_long.wav')), false);
  assert.equal(plays.some(s => s.includes('qa_short.wav')), sound === 'qa_short');
  if (sound === '无') assert.deepEqual(plays, []);
 }
 checks.push('直接替换音效立即生效；填写“无”不播放默认或之前的音效');
 await selectChapter(true);
 await expect(page.getByLabel('演出目标', { exact: true })).toHaveValue('graph:builtin_chapter_text');
 const expand = page.getByRole('button', { name: '展开蓝图属性', exact: true }); if (await expand.count()) await expand.click();
 await page.getByRole('button', { name: '输入与输出', exact: true }).click();
 const pickerKinds: Record<string, string[]> = {};
 for (const [field, kind] of [['章节音效', '音频'], ['章节背景', '图片'], ['笔触叠图', '图片'], ['笔触遮罩', '图片'], ['章节标题背景', '图片']]) {
  await page.getByRole('button', { name: '浏览' + field + '的默认值', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: field + '的默认值资源浏览器', exact: true });
  await expect(dialog.getByText('选择' + kind, { exact: true })).toBeVisible();
  await dialog.getByLabel('可选素材分类', { exact: true }).selectOption('all');
  const names = await dialog.locator('button[aria-label^="预览资源 "]').evaluateAll(es => es.map(e => e.getAttribute('aria-label')!.replace('预览资源 ', '')));
  assert.ok(names.length > 0);
  assert.ok(names.every(name => parsed.project.assets.some(a => a.name === name && a.kind === (kind === '音频' ? 'audio' : 'image'))));
  pickerKinds[field] = await dialog.getByLabel('可选素材分类').locator('option').allTextContents();
  if (kind === '音频') assert.ok(!pickerKinds[field].some(name => /图片|字体|骨骼|视频|场景背景/.test(name)));
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
 }
 checks.push('章节五个素材窗口只显示相应格式；全部分类也不能选错类型');
 const imageChapter = parsed.project.blueprints.find(g => g.chapterVariant === 'image')!;
 await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + imageChapter.id);
 if (await expand.isVisible()) await expand.click();
 await page.getByRole('button', { name: '输入与输出', exact: true }).click();
 await page.getByRole('button', { name: '浏览章节题图的默认值', exact: true }).click();
 const requiredPicker = page.getByRole('dialog', { name: '章节题图的默认值资源浏览器', exact: true });
 await expect(requiredPicker.getByRole('button', { name: '无', exact: true })).toHaveCount(0);
 await requiredPicker.getByRole('button', { name: '取消', exact: true }).click();
 checks.push('图片版必填题图不提供清空选项');
 await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0, { timeout: 30000 });
 const reopened = parseProject(JSON.parse(await fs.readFile(file, 'utf8'))).project;
 assert.deepEqual(commandPerformanceBlueprints(reopened).filter(g => g.chapterVariant).map(g => g.name).sort(), ['章节进入演出图片版', '章节进入演出文字版']);
 await page.screenshot({ path: path.join(output, 'chapter-parameters.png') });
 assert.deepEqual(errors, []);
 await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', end, assets: parsed.project.assets.length, checks, pickerKinds, errors }, null, 2));
} catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', checks, errors, error: String(error) }, null, 2)); throw error; }
finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => undefined); await app.close(); console.log(output); }
