import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createProject, projectSchema, uiComponentSchema } from '../src/core/model';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.'), output = path.join(root, 'artifacts/text-effects-inputs', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = createProject('章节文字联动验收');
await fs.copyFile(path.join(root, 'resources/runtime/sdk-fonts/SourceHanSansLite.ttf'), path.join(output, 'test-font.ttf'));
project.assets.push({ id: 'qa_font', name: '验收字体', kind: 'font', path: 'test-font.ttf' });
project.ui.pages = { chapterTitle: { layout: 'custom' } };
project.ui.components = [uiComponentSchema.parse({ id: 'custom_title', kind: 'chapterTitle', page: 'chapterTitle', x: .1, y: .1, width: .2, height: .6, style: { fontSize: 96, outlineWidth: 2, outlineColor: '#ff0000' } })];
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

  await page.locator('.timeline-clip').first().dblclick();
  const save = async () => { await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0); return projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))); };
  let saved = await save();
  const copy = saved.blueprints.find(item => item.name === '标题演出')!; assert.ok(copy);
  const generated = expandPreviewActions(saved, [{ kind: 'blueprint', blueprintId: copy.id }], previewActionContext(saved)).find(action => action.kind === 'visual');
  assert.ok(generated?.kind === 'visual');
  if (generated?.kind === 'visual') {
    const texts = generated.children![1].children!.filter(child => child.content === 'text'); assert.equal(texts.length, 2);
    assert.ok(texts[0].height > .2, '主标题换行后的测量高度');
    assert.ok(texts[1].keyframes[0].y - texts[1].height / 2 > texts[0].keyframes[0].y + texts[0].height / 2, '副标题在主标题下方');
    assert.ok(texts.every(text => text.textEffects?.outlineWidth === 2));
  }
  await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + copy.id);
  await page.getByRole('tab', { name: '时间轴组件', exact: true }).click();
  const parameters = page.locator('.timeline-public-inputs');
  const title = parameters.getByLabel('章节标题', { exact: true }), subtitle = parameters.getByLabel('章节副标题', { exact: true });
  await expect(title).toHaveValue('同名文字'); await expect(subtitle).toHaveValue('同名文字');
  await title.fill('春日新章'); await subtitle.fill('江畔重逢'); await subtitle.press('Tab');
  await parameters.getByLabel('章节标题字号', { exact: true }).fill('72');
  const font = parameters.getByRole('combobox', { name: '章节标题字体', exact: true });
  await font.fill('验收字体'); await page.getByRole('option').filter({ hasText: '验收字体' }).click();
  await parameters.getByLabel('章节标题水平对齐', { exact: true }).selectOption('right');
  await parameters.getByLabel('章节标题垂直对齐', { exact: true }).selectOption('bottom');
  await parameters.getByLabel('章节标题描边宽度', { exact: true }).fill('6');
  await parameters.getByLabel('章节标题描边颜色', { exact: true }).fill('#00ff00');
  await parameters.getByLabel('章节标题描边透明度', { exact: true }).fill('0.5');
  await parameters.getByLabel('章节标题阴影横向偏移', { exact: true }).fill('-8');
  await parameters.getByLabel('章节标题阴影纵向偏移', { exact: true }).fill('6');
  await parameters.getByLabel('章节标题阴影颜色', { exact: true }).fill('#0000ff');
  await parameters.getByLabel('章节标题阴影透明度', { exact: true }).fill('0.8');
  saved = await save();
  const result = expandPreviewActions(saved, [{ kind: 'blueprint', blueprintId: copy.id }], previewActionContext(saved)).find(action => action.kind === 'visual');
  assert.equal(result?.kind, 'visual'); if (result?.kind !== 'visual') throw new Error('Missing visual');
  const children = result.children![1].children!;
  for (const value of ['春日新章', '江畔重逢']) {
    const bound = children.filter(child => child.text === value);
    assert.equal(bound.length, 2);
    for(const object of bound) {
      if(value==='春日新章')assert.deepEqual(object.textEffects,{outlineWidth:6,outlineColor:'#00ff00',outlineOpacity:.5,shadowX:-8,shadowY:6,shadowBlur:0,shadowColor:'#0000ff',shadowOpacity:.8});
      else {assert.equal(object.textEffects!.outlineWidth,2);assert.equal(object.textEffects!.shadowX,0);}
    } assert.ok(bound.some(child => child.content === 'text')); assert.ok(bound.some(child => child.glyphParticles?.source === 'text'));
    assert.ok(bound.every(child => child.textAlign === (value === '春日新章' ? 'right' : 'center') && child.textVerticalAlign === (value === '春日新章' ? 'bottom' : 'center')));
    assert.ok(bound.every(child => child.fontSize === (value === '春日新章' ? 72 : 32)));
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
