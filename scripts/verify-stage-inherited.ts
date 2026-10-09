import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), output = path.join(root, 'artifacts/stage-inherited', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const templateRoot = path.join(root, 'resources/templates/aihong');
const template = projectSchema.parse(JSON.parse(await fs.readFile(path.join(templateRoot, 'project.vns.json'), 'utf8')));
const project = createProject('舞台曲线终点验收');
const character = { ...template.characters[0], expressions: [template.characters[0].expressions[0]] };
project.characters = [character];
project.assets = template.assets.filter(asset => asset.id === character.expressions[0].assetId);
for (const asset of project.assets) { await fs.mkdir(path.dirname(path.join(output, asset.path)), { recursive: true }); await fs.copyFile(path.join(templateRoot, asset.path), path.join(output, asset.path)); }
const passage = project.nodes.find(node => node.kind === 'passage')!;
passage.lines = [{ id: 'prior', text: '角色位置由独立曲线控制。', actions: [
  { kind: 'show', characterId: character.id, expressionId: character.expressions[0].id, x: .2, y: 1, scale: .6, layer: 10, transition: 'none' },
] }];
const priorLine = structuredClone(passage.lines[0]);
passage.lines.push({ id: 'line', text: '继承角色的位置编辑。', actions: [] });
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
  await expect(x).toHaveValue('20');
  await x.fill('65'); await x.press('Tab');
  await expect(x).toHaveValue('65');
  await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const saved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  const node = saved.nodes.find(node => node.id === passage.id)!;
  assert.equal(node.kind, 'passage'); if (node.kind !== 'passage') throw new Error('Missing passage');
  assert.deepEqual(node.lines[0], priorLine);
  const animation = node.lines[1].actions.find(action => action.kind === 'animate')!;
  assert.equal(animation.wait, false);
  assert.equal(animation.keyframes[0].x, .2);
  assert.deepEqual(animation.curves?.x?.map(frame => frame.at), [0, .5]);
  await expect(page.getByLabel('演出预览进度', { exact: true })).toHaveValue('0.5');
  assert.deepEqual(animation.curves?.x?.map(frame => frame.value), [.2, .65]);
  await page.screenshot({ path: path.join(output, 'stage-curve.png') });
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks: ['继承静态角色按播放位置在当前句创建动画并保留时间', '保存当前句动画且前文逐字段不变'], errors }, null, 2));
} catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); throw error; }
finally { await app.close(); console.log(output); }
