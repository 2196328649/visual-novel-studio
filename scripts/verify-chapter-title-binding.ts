import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { expect } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.'), output = path.join(root, 'artifacts/chapter-title-binding', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = createProject('章节题图联动验收');
for (const [id, name, color] of [['old', '旧题图', [255, 0, 0, 255]], ['new', '新题图', [0, 255, 0, 255]]] as const) {
  const png = new PNG({ width: 32, height: 32 });
  for (let index = 0; index < 32 * 32; index++) png.data.set(color, index * 4);
  await fs.writeFile(path.join(output, id + '.png'), PNG.sync.write(png));
  project.assets.push({ id, name, kind: 'image', path: id + '.png', width: 32, height: 32 });
}
const graph = blueprintFromPerformance(project, [{ kind: 'chapter', title: '章节测试', subtitle: '', duration: 7, effect: 'ink', titleImageId: 'old', backgroundId: 'old' }], '章节来源');
project.blueprints.push(graph);
const projectFile = path.join(output, 'project.vns.json'); await fs.writeFile(projectFile, JSON.stringify(projectSchema.parse(project)));
const app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') }), page = await app.firstWindow(), errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="blueprint"]').click();
  await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + graph.id);
  await page.getByRole('button', { name: '时间轴', exact: true }).click();
  await page.locator('.timeline-clip').first().click();
  await page.getByRole('button', { name: '生成章节组合副本', exact: true }).click();
  const save = async () => { await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0); return projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))); };
  let saved = await save();
  const copy = saved.blueprints.find(item => item.name === '标题演出')!; assert.ok(copy);
  await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + copy.id);
  await page.getByRole('button', { name: '调用参数', exact: true }).click();
  const image = page.getByRole('combobox', { name: '章节题图', exact: true });
  await expect(image).toHaveValue('旧题图'); await image.fill('新题图');
  await page.getByRole('option').filter({ hasText: '新题图' }).click();
  saved = await save();
  const result = expandPreviewActions(saved, [{ kind: 'blueprint', blueprintId: copy.id }], previewActionContext(saved)).find(action => action.kind === 'visual');
  assert.equal(result?.kind, 'visual'); if (result?.kind !== 'visual') throw new Error('Missing visual');
  const children = result.children![1].children!;
  assert.equal(children.find(item => item.name === '章节标题')!.assetId, 'new');
  assert.equal(children.find(item => item.glyphParticles)!.glyphParticles!.assetId, 'new');
  assert.equal(children.find(item => item.name === '章节背景')!.assetId, 'old');
  const pin = saved.blueprints.find(item => item.id === copy.id)!.exposedInputs.find(pin => pin.name === '章节题图')!;
  assert.equal(pin.defaultValue, 'new');
  await page.screenshot({ path: path.join(output, 'shared-title-input.png') });
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks: ['桌面生成章节组合后只有一个章节题图参数', '修改公开题图并保存后标题和字形来源同步为新图片', '背景仍保留旧图片'], errors }, null, 2));
} catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); throw error; }
finally { await app.close(); console.log(output); }
