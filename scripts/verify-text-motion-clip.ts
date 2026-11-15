import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { createVisualObject } from '../src/core/visual-object';
import { blueprintFromPerformance, rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { launchDesktopFixture } from './lib/desktop-fixture';

// A timeline text clip uses the dialogue animator: reveal speed, entrance, loop and exit.
const root = path.resolve('.'), output = path.join(root, 'artifacts/text-motion-clip', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = createProject('文字片段动画验收'), object = createVisualObject('text');
object.text = '片段里的逐字文字'; object.fontSize = 72; object.duration = 4;
const graph = blueprintFromPerformance(project, [object], '文字片段');
graph.timelineComponent = true; project.blueprints.push(graph);
const timeline = performanceTimeline(project, graph); arrangePerformanceTimeline(project, graph, timeline.clips, timeline.tracks);
const file = path.join(output, 'project.vns.json');
await fs.writeFile(file, JSON.stringify(projectSchema.parse(project)));
const app = await launchDesktopFixture({ root, projectFile: file, profile: path.join(output, 'profile') }), page = await app.firstWindow(), errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
const type = async (label: string, value: string) => { const field = page.getByLabel(label, { exact: true }); await field.fill(value); await field.press('Tab'); };
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="blueprint"]').click();
  await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + graph.id);
  await page.locator('.timeline-clip').first().click();
  await page.getByRole('tab', { name: '动画与效果', exact: true }).click();
  await page.locator('summary').filter({ hasText: /^文字动画$/ }).click();
  await expect(page.getByLabel('文字显示方式', { exact: true })).toHaveValue('instant');
  await page.getByLabel('文字显示方式', { exact: true }).selectOption('duration');
  await type('逐字显示时长（秒）', '2');
  await page.getByLabel('入场效果', { exact: true }).selectOption('drop');
  await page.locator('summary').filter({ hasText: /^调整入场动画/ }).click();
  await type('入场纵向位移', '-80');
  await page.getByLabel('入场顺序', { exact: true }).selectOption('reverse');
  await page.getByLabel('持续效果', { exact: true }).selectOption('wave');
  await page.getByLabel('退场效果', { exact: true }).selectOption('zoom');
  await type('退场总时长（秒）', '0.6');
  // Scrub into the clip: the preview draws the same animator, by the clip's clock.
  const ruler = (await page.getByLabel('时间标尺', { exact: true }).boundingBox())!;
  const seek = async (seconds: number) => { const zoom = (await page.locator('.timeline-clip').first().boundingBox())!.width / 4; const left = (await page.locator('.timeline-clip').first().boundingBox())!.x; await page.mouse.click(left + seconds * zoom, ruler.y + ruler.height / 2); };
  const chars = page.locator('[data-visual-text] .styled-char');
  const shown = () => chars.evaluateAll(nodes => nodes.map(node => Number((node as HTMLElement).style.opacity)));
  await seek(.8);
  await expect(chars).toHaveCount(Array.from(object.text).length);
  await page.screenshot({ path: path.join(output, 'clip-revealing.png') });
  // Reverse order: the last characters are already showing, the first have not started.
  const early = await shown();
  assert.equal(early[0], 0, JSON.stringify(early));
  assert.ok(early[early.length - 1] > 0, JSON.stringify(early));
  await seek(2.5);
  await expect.poll(async () => (await shown()).every(value => value === 1)).toBe(true);
  await seek(3.75);
  await expect.poll(async () => (await shown()).some(value => value < 1)).toBe(true);
  await page.screenshot({ path: path.join(output, 'clip-leaving.png') });
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const saved = projectSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
  const action = rawSavedBlueprintAction([...saved.blueprints, ...(saved.timelinePresets ?? [])].find(item => item.id === graph.id)!.nodes.find(node => node.type === 'savedAction')!);
  assert.equal(action?.kind, 'visual');
  if (action?.kind === 'visual') assert.deepEqual(action.textMotion, { speed: 'duration', duration: 2, entrance: 'drop', entranceAnimation: { y: -80, order: 'reverse' }, loop: 'wave', exit: 'zoom', exitTotal: .6 });
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed' }, null, 2));
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined);
  await app.close();
  console.log(output);
}
