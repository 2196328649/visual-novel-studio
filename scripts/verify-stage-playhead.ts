import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), output = path.join(root, 'artifacts/stage-playhead', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const templateRoot = path.join(root, 'resources/templates/aihong');
const template = projectSchema.parse(JSON.parse(await fs.readFile(path.join(templateRoot, 'project.vns.json'), 'utf8')));
const project = createProject('舞台曲线终点验收');
const character = { ...template.characters[0], expressions: [template.characters[0].expressions[0]] };
project.characters = [character];
project.assets = template.assets.filter(asset => asset.id === character.expressions[0].assetId);
for (const asset of project.assets) { await fs.mkdir(path.dirname(path.join(output, asset.path)), { recursive: true }); await fs.copyFile(path.join(templateRoot, asset.path), path.join(output, asset.path)); }
const passage = project.nodes.find(node => node.kind === 'passage')!;
passage.lines = [{ id: 'line', text: '角色位置由独立曲线控制。', actions: [
  { kind: 'show', characterId: character.id, expressionId: character.expressions[0].id, x: .2, y: 1, scale: .6, layer: 10, transition: 'none' },
  { kind: 'animate', characterId: character.id, wait: true, repeat: false, keyframes: [{ x: .9, y: 1, scale: .6, rotation: 0, opacity: 1, duration: 1, easing: 'linear' }], curves: { x: [{ at: 0, value: .2, easing: 'linear' }, { at: 1, value: .5, easing: 'linear' }] } },
] }];
const projectFile = path.join(output, 'project.vns.json'); await fs.writeFile(projectFile, JSON.stringify(project));
const app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
const page = await app.firstWindow(), errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await openStoryMode(page, 'script');
  await page.locator('#line-line textarea').click();
  await page.getByLabel('演出预览进度', { exact: true }).fill('0.5');
  await page.getByRole('button', { name: '编辑舞台', exact: true }).click();
  const x = page.getByLabel('角色横向位置 %', { exact: true });
  await expect(x).toHaveValue('35');
  await x.fill('65'); await x.press('Tab');
  await expect(x).toHaveValue('65');
  const rotation = page.getByLabel('角色旋转 度', { exact: true });
  const opacity = page.getByLabel('角色不透明度 %', { exact: true });
  await rotation.fill('25'); await rotation.press('Tab');
  await opacity.fill('40'); await opacity.press('Tab');
  await expect(rotation).toHaveValue('25'); await expect(opacity).toHaveValue('40');
  await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const saved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  const node = saved.nodes.find(node => node.id === passage.id)!;
  assert.equal(node.kind, 'passage'); if (node.kind !== 'passage') throw new Error('Missing passage');
  const animation = node.lines[0].actions.find(action => action.kind === 'animate')!;
  assert.equal(animation.keyframes[0].x, .9);
  assert.deepEqual(animation.curves?.x?.map(frame => frame.value), [.2, .65, .5]);
  assert.deepEqual(animation.curves?.x?.map(frame => frame.at), [0, .5, 1]);
  assert.deepEqual(animation.curves?.rotation?.map(frame => [frame.at, frame.value]), [[0, 0], [.5, 25], [1, 0]]);
  assert.deepEqual(animation.curves?.opacity?.map(frame => [frame.at, frame.value]), [[0, 1], [.5, .4], [1, 1]]);
  await expect(page.getByLabel('演出预览进度', { exact: true })).toHaveValue('0.5');
  await page.getByLabel('演出预览进度', { exact: true }).fill('1.5');
  await page.getByRole('button', { name: '编辑舞台', exact: true }).click();
  await expect(x).toHaveValue('50');
  await expect(rotation).toHaveValue('0'); await expect(opacity).toHaveValue('100');
  await x.fill('75'); await x.press('Tab');
  await expect(x).toHaveValue('75');
  await expect(page.getByLabel('演出预览进度', { exact: true })).toHaveValue('1.5');
  await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const extended = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  const extendedNode = extended.nodes.find(node => node.id === passage.id)!;
  assert.equal(extendedNode.kind, 'passage'); if (extendedNode.kind !== 'passage') throw new Error('Missing passage');
  const extendedAnimation = extendedNode.lines[0].actions.find(action => action.kind === 'animate')!;
  assert.deepEqual(extendedAnimation.curves?.x?.map(frame => [frame.at, frame.value]), [[0, .2], [.5, .65], [1, .5], [1.5, .75]]);
  await page.screenshot({ path: path.join(output, 'stage-curve.png') });
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks: ['舞台在0.5秒插入位置、旋转和透明度帧并保留播放位置', '保存保留原有起止帧与基础关键帧，后续原终点姿态不变'], errors }, null, 2));
} catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); throw error; }
finally { await app.close(); console.log(output); }
