import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { expect } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { applyTextScript } from '../src/core/text-script';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), output = path.join(root, 'artifacts/chapter-entry-presets', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const screenshots = path.join(output, 'screenshots'); await fs.mkdir(screenshots);
const seed = createProject('文字与图片章节统一时间轴验收'), image = new PNG({ width: 512, height: 128 });
for (let y = 18; y < 110; y++) for (let x = 40; x < 472; x++) if (x % 96 < 64) image.data.set([235, 224, 191, 255], (y * 512 + x) * 4);
await fs.writeFile(path.join(output, 'chapter.png'), PNG.sync.write(image));
seed.assets.push({ id: 'title_image', name: '章节题图', kind: 'image', path: 'chapter.png', width: 512, height: 128 });
const parsed = applyTextScript(seed, '# 段落：章节验收\n@章节进入演出文字版\n@独立演出：文字章\n@章节进入演出\n@独立演出：图片章\n旁白：章节结束。');
assert.deepEqual(parsed.issues, []);
const projectFile = path.join(output, 'project.vns.json'); await fs.writeFile(projectFile, JSON.stringify(parsed.project));
let app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') }), page = await app.firstWindow();
const errors: string[] = [], checks: string[] = []; let phase = 'launch'; page.on('pageerror', error => errors.push(error.message));
async function enter(name: string, id: string) {
  await openStoryMode(page, 'text');
  await page.getByLabel('中文文本剧本', { exact: true }).evaluate((element, needle) => {
    const text = element as HTMLTextAreaElement, offset = new RegExp('^' + needle + '(?:【[^】]*】)?(?:[:：]|$)', 'm').exec(text.value)?.index ?? -1;
    if (offset < 0) throw Error('Chapter command missing');
    text.focus(); text.setSelectionRange(offset + 2, offset + 2); text.dispatchEvent(new Event('select', { bubbles: true })); text.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
  }, name);
  await expect(page.getByLabel('演出目标', { exact: true })).toHaveValue('graph:' + id);
  await expect(page.locator('.performance-authoring.graph')).toBeVisible();
}
async function timeline(id: string) {
  const graph = parsed.project.blueprints.find(graph => graph.id === id)!, call = graph.nodes.find(node => node.type === 'callFunction')!;
  await page.locator(`.react-flow__node[data-id="${call.id}"] .graph-node-title`).dblclick({ position: { x: 12, y: 12 } });
  await expect(page.getByLabel('时间轴画布', { exact: true })).toBeVisible();
  await expect(page.locator('.timeline-clip')).not.toHaveCount(0);
  const playhead = page.getByRole('slider', { name: '时间轴播放头', exact: true });
  await playhead.press('Home'); await expect(playhead).toHaveAttribute('aria-valuenow', '0');
  for (let i = 0; i < 3; i++) { await playhead.press('Shift+ArrowRight'); await expect(playhead).toHaveAttribute('aria-valuenow', String(i + 1)); }
  await expect(playhead).toHaveAttribute('aria-valuenow', '3');
  await expect.poll(() => page.locator('[data-glyph-particle]').count()).toBeGreaterThan(0);
  await expect(page.locator('[data-glyph-error]')).toHaveCount(0);
  await playhead.press('Space'); await expect(page.getByRole('button', { name: '暂停预览', exact: true })).toBeVisible();
  await playhead.press('Space'); await expect(page.getByRole('button', { name: '播放预览', exact: true })).toBeVisible();
}
try {
  await expect(page.locator('.project-title strong')).toHaveText(seed.name, { timeout: 45000 });
  for (const [name, id] of [['@章节进入演出文字版', 'builtin_chapter_text'], ['@章节进入演出', 'builtin_chapter_image']]) {
    phase = id; await enter(name, id);
    if (id === 'builtin_chapter_text') {
      const expand = page.getByRole('button', { name: '展开蓝图属性', exact: true }); if (await expand.count()) await expand.click();
      await page.getByRole('button', { name: '输入与输出', exact: true }).click();
      await page.getByLabel('标题的默认值', { exact: true }).fill('第三章 · 可直接修改');
      await page.getByLabel('右侧字的默认值', { exact: true }).fill('故城重逢');
      await page.getByRole('button', { name: '收起蓝图属性', exact: true }).click();
    }
    await timeline(id);
    if (id === 'builtin_chapter_text') await expect(page.locator('.preview-stage-frame')).toContainText('第三章 · 可直接修改');
    await page.screenshot({ path: path.join(screenshots, id + '.png') });
    checks.push(id === 'builtin_chapter_text' ? '文字章节进入普通时间轴；改字后标题与文字粒子可直接预览。' : '裸章节进入演出解析为图片版，并进入同一时间轴编辑模式和题图粒子预览。');
  }
  phase = 'save'; await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0, { timeout: 45000 });
  const saved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  const actions = expandPreviewActions(saved, [{ kind: 'blueprint', blueprintId: 'builtin_chapter_text' }], previewActionContext(saved));
  const composition = actions.find(action => action.kind === 'visual'); assert.ok(composition?.kind === 'visual');
  assert.ok(JSON.stringify(composition).includes('第三章 · 可直接修改')); assert.ok(JSON.stringify(composition).includes('故城重逢'));
  assert.equal(saved.assets.filter(asset => asset.kind === 'image').length, 1);
  phase = 'reopen';
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())); await app.close();
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') }); page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(seed.name, { timeout: 45000 });
  for (const [name, id] of [['@章节进入演出文字版', 'builtin_chapter_text'], ['@章节进入演出', 'builtin_chapter_image']]) {
    await enter(name, id); await timeline(id);
    if (id === 'builtin_chapter_text') {
      await expect(page.locator('.preview-stage-frame')).toContainText('第三章 · 可直接修改');
      await expect(page.locator('.preview-stage-frame')).toContainText('故城重逢');
    }
    await page.screenshot({ path: path.join(screenshots, id + '-reopened.png') });
  }
  checks.push('关闭并重新打开已保存工程后，两种章节保持时间轴和粒子；修改的标题、副标题保留，文字版无需新题图。');
  assert.deepEqual(errors, []); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, errors, error: String(error) }, null, 2)); throw error;
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await app.close(); console.log(output);
}
