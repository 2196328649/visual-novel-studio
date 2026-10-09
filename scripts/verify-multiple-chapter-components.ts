import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createProject, projectSchema, uiComponentSchema } from '../src/core/model';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.'), output = path.join(root, 'artifacts/multiple-chapter-components', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = createProject('章节文字联动验收');
await fs.copyFile(path.join(root, 'resources/runtime/sdk-fonts/SourceHanSansLite.ttf'), path.join(output, 'test-font.ttf'));
project.assets.push({ id: 'qa_font', name: '验收字体', kind: 'font', path: 'test-font.ttf' });
project.ui.pages = { chapterTitle: { layout: 'custom' } };
project.ui.components = Array.from({length:3},(_,i)=>uiComponentSchema.parse({id:'custom_title_'+i,kind:'chapterTitle',page:'chapterTitle',x:.05+i*.3,y:.1,width:.25,height:.7,style:{fontSize:72,outlineWidth:2,outlineColor:'#ff0000'}}));
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
  await expect(page.getByLabel('演出目标',{exact:true}).locator('option')).toContainText(['标题演出']);
  const saved = await save(), copy = saved.blueprints.find(item => item.name === '标题演出')!;
  assert.ok(copy);assert.ok(copy.exposedInputs.length>32);assert.ok(copy.nodes.some(n=>n.pins.length>66));
  await page.getByLabel('演出目标',{exact:true}).selectOption('graph:'+copy.id);
  await page.getByRole('button',{name:'调用参数',exact:true}).click();
  await page.locator('.timeline-public-inputs').getByLabel('章节标题 3描边宽度',{exact:true}).fill('8');
  const updated=await save();
  const result=expandPreviewActions(updated,[{kind:'blueprint',blueprintId:copy.id}],previewActionContext(updated)).find(a=>a.kind==='visual');
  assert.ok(result?.kind==='visual');
  const children=result.children![1].children!;
  assert.deepEqual(children.filter(c=>c.content==='text'&&c.fontSize===72).map(c=>c.textEffects!.outlineWidth),[2,2,8]);
  assert.deepEqual(children.filter(c=>c.glyphParticles&&c.fontSize===72).map(c=>c.textEffects!.outlineWidth),[2,2,8]);
  await page.screenshot({path:path.join(output,'multiple.png')});
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',inputCount:copy.exposedInputs.length,maxNodePins:Math.max(...copy.nodes.map(n=>n.pins.length))},null,2));
} catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); throw error; }
finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined); await app.close(); console.log(output); }
