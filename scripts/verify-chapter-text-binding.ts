import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.'), output = path.join(root, 'artifacts/chapter-text-binding', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = createProject('章节文字联动验收');
await fs.copyFile(path.join(root, 'resources/runtime/sdk-fonts/SourceHanSansLite.ttf'), path.join(output, 'test-font.ttf'));
project.assets.push({ id: 'qa_font', name: '验收字体', kind: 'font', path: 'test-font.ttf' });
const graph = blueprintFromPerformance(project, [{ kind: 'chapter', title: '同名文字', subtitle: '同名文字', duration: 7, effect: 'ink' }], '章节来源');
graph.timelineComponent = true;
project.blueprints.push(graph);
const sourceTimeline = performanceTimeline(project, graph); arrangePerformanceTimeline(project, graph, sourceTimeline.clips, sourceTimeline.tracks);
const projectFile = path.join(output, 'project.vns.json'); await fs.writeFile(projectFile, JSON.stringify(projectSchema.parse(project)));
const app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') }), page = await app.firstWindow();
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="blueprint"]').click();
  await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + graph.id);

  await page.locator('.timeline-clip').first().click();
  await page.getByRole('button', { name: '生成章节组合副本', exact: true }).click();
  const save = async () => { await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0); return projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))); };
  let saved = await save();
  const copy = saved.blueprints.find(item => item.name === '标题演出')!; assert.ok(copy);
  await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + copy.id);
  await page.getByRole('button', { name: '调用参数', exact: true }).click();
  const parameters = page.locator('.timeline-public-inputs');
  const title = parameters.getByLabel('章节标题', { exact: true }), subtitle = parameters.getByLabel('章节副标题', { exact: true });
  await expect(title).toHaveValue('同名文字'); await expect(subtitle).toHaveValue('同名文字');
  await title.fill('春日新章'); await subtitle.fill('江畔重逢'); await subtitle.press('Tab');
  await parameters.getByLabel('章节标题字号', { exact: true }).fill('72');
  const font = parameters.getByRole('combobox', { name: '章节标题字体', exact: true });
  await font.fill('验收字体'); await page.getByRole('option').filter({ hasText: '验收字体' }).click();
  await parameters.getByLabel('章节标题水平对齐', { exact: true }).selectOption('right');
  await parameters.getByLabel('章节标题垂直对齐', { exact: true }).selectOption('bottom');
  saved = await save();
  const result = expandPreviewActions(saved, [{ kind: 'blueprint', blueprintId: copy.id }], previewActionContext(saved)).find(action => action.kind === 'visual');
  assert.equal(result?.kind, 'visual'); if (result?.kind !== 'visual') throw new Error('Missing visual');
  const children = result.children![1].children!;
  for (const value of ['春日新章', '江畔重逢']) {
    const bound = children.filter(child => child.text === value);
    assert.equal(bound.length, 2); assert.ok(bound.some(child => child.content === 'text')); assert.ok(bound.some(child => child.glyphParticles?.source === 'text'));
    assert.ok(bound.every(child => child.textAlign === (value === '春日新章' ? 'right' : 'center') && child.textVerticalAlign === (value === '春日新章' ? 'bottom' : 'center')));
    assert.ok(bound.every(child => child.fontSize === (value === '春日新章' ? 72 : 24)));
    assert.ok(bound.every(child => child.fontAssetId === (value === '春日新章' ? 'qa_font' : undefined)));
  }
  const slider = page.getByRole('slider', { name: '时间轴播放头', exact: true });
  await slider.press('Home'); await expect(slider).toHaveAttribute('aria-valuenow', '0');
  for (let i = 0; i < 3; i++) { await slider.press('Shift+ArrowRight'); await expect(slider).toHaveAttribute('aria-valuenow', String(i + 1)); }
  await expect.poll(() => page.locator('[data-glyph-particle]').count()).toBeGreaterThan(0);
  await expect(page.locator('[data-glyph-error]')).toHaveCount(0);
  await page.screenshot({ path: path.join(output, 'shared-text-input.png') });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks: ['从文字章节生成独立组合和字形粒子', '相同初始文字的标题和副标题仍有独立参数', '修改文字、标题字号与字体后保存，标题和对应粒子同步，副标题样式不变', '生成的文字粒子实际预览可见'] }, null, 2));
} catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); throw error; }
finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined); await app.close(); console.log(output); }
