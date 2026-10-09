import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { expect } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { blueprintNodeDefaults, createBlueprintGraph } from '../src/core/blueprint';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.'), output = path.join(root, 'artifacts/timeline-component', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = createProject('时间轴组件验收');
for (const [id, name, color] of [['default_image', '默认红图', [220, 40, 40]], ['override_image', '传入蓝图', [40, 70, 220]]] as const) {
  const png = new PNG({ width: 16, height: 16 });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = color[0]; png.data[i + 1] = color[1]; png.data[i + 2] = color[2]; png.data[i + 3] = 255; }
  await fs.writeFile(path.join(output, id + '.png'), PNG.sync.write(png));
  project.assets.push({ id, name, kind: 'image', category: 'scene', path: id + '.png' });
}
const owner = createBlueprintGraph('effect', '含逻辑的演出');
const value = blueprintNodeDefaults('literal'); value.name = '传入素材'; value.pins[0].dataType = 'asset'; value.properties.value = 'override_image'; value.x = 0; value.y = 300;
owner.nodes.push(value); project.blueprints.push(owner);
const projectFile = path.join(output, 'project.vns.json'); await fs.writeFile(projectFile, JSON.stringify(project));
const app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') }), page = await app.firstWindow();
const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
const save = async () => { await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0); return projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))); };
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="blueprint"]').click();
  await page.getByRole('button', { name: '添加时间轴', exact: true }).click();
  let stored = await save();
  let timeline = stored.blueprints.find(graph => graph.timelineComponent)!; assert.ok(timeline);
  const call = stored.blueprints.find(graph => graph.id === owner.id)!.nodes.find(node => node.properties.graphId === timeline.id)!;
  await page.getByRole('button', { name: '框选全部节点', exact: true }).click();
  await page.locator(`.react-flow__node[data-id="${call.id}"] .graph-node-title`).dblclick();
  await expect(page.getByRole('button', { name: '返回蓝图', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '节点蓝图', exact: true })).toHaveCount(0);
  await page.getByLabel('搜索演出素材', { exact: true }).fill('默认红图');
  await page.getByRole('button', { name: '添加素材 默认红图', exact: true }).click();
  await page.getByLabel('搜索演出素材', { exact: true }).fill('');
  await page.locator('.visual-clip-inspector').getByRole('tab', { name: '可替换参数', exact: true }).click();
  const parameter = page.locator('.visual-parameter-row[data-parameter-key="assetId"]');
  await parameter.getByRole('button', { name: '公开到时间轴', exact: true }).click();
  stored = await save(); timeline = stored.blueprints.find(graph => graph.id === timeline.id)!;
  const pin = timeline.exposedInputs.find(pin => pin.dataType === 'asset')!;
  assert.equal(pin.defaultValue, 'default_image');
  const preview = (p: typeof stored) => expandPreviewActions(p, [{ kind: 'blueprint', blueprintId: owner.id }], previewActionContext(p)).find(action => action.kind === 'visual');
  assert.equal(preview(stored)?.assetId, 'default_image');
  await page.screenshot({ path: path.join(output, 'timeline.png') });
  await page.getByRole('button', { name: '返回蓝图', exact: true }).click();
  await page.getByRole('button', { name: '框选全部节点', exact: true }).click();
  const caller = page.locator(`.react-flow__node[data-id="${call.id}"]`);
  const asset = caller.locator('.timeline-default-asset').getByRole('combobox');
  await expect(asset).toHaveValue('默认红图');
  await asset.fill('传入蓝图'); await page.getByRole('option').filter({ hasText: '传入蓝图' }).click();
  stored = await save(); assert.equal(preview(stored)?.assetId, 'override_image');
  assert.equal(stored.blueprints.find(g => g.id === timeline.id)!.exposedInputs[0].defaultValue, 'default_image');
  await caller.locator('.timeline-default-asset').getByRole('button', { name: /使用默认素材/ }).click();
  stored = await save(); assert.equal(preview(stored)?.assetId, 'default_image');
  await expect(asset).toHaveValue('默认红图');
  const from = page.locator(`.react-flow__node[data-id="${value.id}"] .react-flow__handle[data-handleid="${value.pins[0].id}"]`);
  const to = page.locator(`.react-flow__node[data-id="${call.id}"] .react-flow__handle[data-handleid="arg_${pin.id}"]`);
  await from.click(); await to.click();
  stored = await save();
  assert.ok(stored.blueprints.find(graph => graph.id === owner.id)!.links.some(link => link.fromNodeId === value.id && link.toNodeId === call.id));
  assert.equal(preview(stored)?.assetId, 'override_image');
  await page.screenshot({ path: path.join(output, 'blueprint.png') });
  await page.evaluate(file => window.studio!.openRecentProject!(file), projectFile);
  await page.reload();
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await page.locator('[data-workspace-tab="blueprint"]').click();
  await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + owner.id);
  await expect(page.locator(`.react-flow__node[data-id="${call.id}"]`)).toBeVisible();
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks: ['蓝图添加时间轴组件，双击打开并返回', '图片片段直接设为素材参数', '调用节点直接换图片，恢复默认不改组件默认值', '不接线使用默认素材，接入素材线替换', '保存和重载保留组件、参数与接线', '无蓝图／时间轴互切按钮'], errors }, null, 2));
} catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); throw error; }
finally { await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => undefined); await app.close(); console.log(output); }
