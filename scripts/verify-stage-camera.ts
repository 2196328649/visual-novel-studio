import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { blueprintFromPerformance, rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), output = path.join(root, 'artifacts/stage-camera', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = createProject('镜头播放时间编辑验收');
const graph = blueprintFromPerformance(project, [{ kind: 'camera', x: .9, y: 0, zoom: 1.6, rotation: 30, duration: 3, easing: 'linear', wait: false }], '共享镜头');
project.blueprints.push(graph);
const passage = project.nodes.find(node => node.kind === 'passage')!;
passage.lines = [
  { id: 'prior', text: '镜头开始移动。', actions: [{ kind: 'blueprint', blueprintId: graph.id }, { kind: 'pause', seconds: .5 }] },
  { id: 'current', text: '继续编辑前文镜头。', actions: [] },
];
const originalLinks = structuredClone(graph.links);
const projectFile = path.join(output, 'project.vns.json'); await fs.writeFile(projectFile, JSON.stringify(projectSchema.parse(project)));
const app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
const page = await app.firstWindow(), errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await openStoryMode(page, 'script');
  await page.locator('#line-current textarea').click();
  const progress = page.getByLabel('演出预览进度', { exact: true });
  await progress.fill('1');
  await page.getByRole('button', { name: '编辑舞台', exact: true }).click();
  await page.locator('summary').filter({ hasText: /^镜头$/ }).click();
  const x = page.getByLabel('镜头横移 %', { exact: true });
  const zoom = page.getByLabel('镜头缩放 %', { exact: true });
  const rotation = page.getByLabel('镜头旋转 度', { exact: true });
  await expect(x).toHaveValue('45');
  await x.fill('40'); await x.press('Tab');
  await zoom.fill('170'); await zoom.press('Tab');
  await rotation.fill('-20'); await rotation.press('Tab');
  await expect(x).toHaveValue('40'); await expect(zoom).toHaveValue('170'); await expect(rotation).toHaveValue('-20');
  await expect(progress).toHaveValue('1');
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const saved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  const savedGraph = saved.blueprints.find(item => item.id === graph.id)!;
  assert.deepEqual(savedGraph.links, originalLinks);
  const action = rawSavedBlueprintAction(savedGraph.nodes.find(item => item.type === 'savedAction')!);
  assert.equal(action?.kind, 'camera'); if (action?.kind !== 'camera') throw new Error('Missing camera');
  assert.equal(action.x, .9); assert.equal(action.zoom, 1.6); assert.equal(action.rotation, 30);
  assert.deepEqual(action.curves?.x?.map(frame => [frame.at, frame.value]), [[0, 0], [1.5, .4], [3, .9]]);
  assert.deepEqual(action.curves?.zoom?.map(frame => [frame.at, frame.value]), [[0, 1], [1.5, 1.7], [3, 1.6]]);
  assert.deepEqual(action.curves?.rotation?.map(frame => [frame.at, frame.value]), [[0, 0], [1.5, -20], [3, 30]]);
  const savedPassage = saved.nodes.find(item => item.id === passage.id)!;
  assert.equal(savedPassage.kind, 'passage'); if (savedPassage.kind !== 'passage') throw new Error('Missing passage');
  assert.deepEqual(savedPassage.lines[1].actions, []);
  await page.screenshot({ path: path.join(output, 'camera-playhead.png') });
  await page.reload();
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await openStoryMode(page, 'script');
  await page.locator('#line-current textarea').click();
  await progress.fill('1');
  await page.getByRole('button', { name: '编辑舞台', exact: true }).click();
  await page.locator('summary').filter({ hasText: /^镜头$/ }).click();
  await expect(x).toHaveValue('40'); await expect(zoom).toHaveValue('170'); await expect(rotation).toHaveValue('-20');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks: ['跨台词镜头在当前1秒写回来源1.5秒', '普通蓝图镜头保存曲线并保留执行连线和原始终点', '播放位置保持且当前台词未新增动作', '重新加载后关键帧姿态一致'], errors }, null, 2));
} catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); throw error; }
finally { await app.close(); console.log(output); }
