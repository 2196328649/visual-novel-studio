import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const sceneEntry = process.argv.includes('--scene-entry'), sceneBlueprint = process.argv.includes('--scene-blueprint');
const root = path.resolve('.'), output = path.join(root, `artifacts/${sceneEntry ? 'stage-scene-entry' : sceneBlueprint ? 'stage-scene-blueprint' : 'stage-blueprint'}`, new Date().toISOString().replaceAll(':', '-'));
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
passage.lines[0].actions.push({ kind: 'animate', characterId: character.id, wait: false, repeat: false, keyframes: [{ x: .8, y: 1, scale: .6, rotation: 0, opacity: 1, duration: 2, easing: 'linear' }] }, { kind: 'pause', seconds: .5 });
const blueprint = blueprintFromPerformance(project, [passage.lines[0].actions[1]], '共享角色移动');
project.blueprints.push(blueprint);
passage.lines[0].actions[1] = { kind: 'blueprint', blueprintId: blueprint.id };
const baseScene = project.scenes.find(scene => scene.id === passage.sceneId)!;
if (sceneEntry || sceneBlueprint) {
  const show = passage.lines[0].actions[0];
  baseScene.entryActions = [show];
  if (sceneBlueprint) baseScene.blueprintId = blueprint.id;
  else baseScene.entryActions.push(JSON.parse(String(blueprint.nodes.find(node => node.type === 'savedAction')!.properties.action)));
  project.scenes.push({ id: 'inherited_entry', name: '继承入口场景', chapterId: baseScene.chapterId, baseSceneId: baseScene.id });
  passage.sceneId = 'inherited_entry';
  passage.lines[0].actions = [{ kind: 'pause', seconds: .5 }];
}
passage.lines.push({ id: 'line', text: '继承角色的位置编辑。', actions: [] });
const projectFile = path.join(output, 'project.vns.json'); await fs.writeFile(projectFile, JSON.stringify(projectSchema.parse(project)));
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
  await expect(x).toHaveValue('50');
  await x.fill('65'); await x.press('Tab');
  await expect(x).toHaveValue('65');
  await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const saved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  const node = saved.nodes.find(node => node.id === passage.id)!;
  assert.equal(node.kind, 'passage'); if (node.kind !== 'passage') throw new Error('Missing passage');
  assert.deepEqual(node.lines[1].actions, []);
  await expect(page.getByRole('alert')).toContainText('已修改前文动画');
  const savedNode = saved.blueprints.find(graph => graph.id === blueprint.id)!.nodes.find(node => node.type === 'savedAction')!;
  const animation = sceneEntry ? saved.scenes.find(scene => scene.id === baseScene.id)!.entryActions![1] : JSON.parse(String(savedNode.properties.action));
  if (sceneEntry || sceneBlueprint) {
    assert.equal(saved.scenes.find(scene => scene.id === 'inherited_entry')!.entryActions, undefined);
    assert.deepEqual(node.lines[0].actions, [{ kind: 'pause', seconds: .5 }]);
    await expect(page.getByRole('alert')).toContainText(sceneEntry ? '场景入口' : '共享演出');
  }
  assert.equal(animation.wait, false);
  assert.equal(animation.keyframes[0].x, .8);
  assert.deepEqual(animation.curves?.x?.map((frame: { at: number }) => frame.at), [0, 1, 2]);
  await expect(page.getByLabel('演出预览进度', { exact: true })).toHaveValue('0.5');
  assert.deepEqual(animation.curves?.x?.map((frame: { value: number }) => frame.value), [.2, .65, .8]);
  await page.screenshot({ path: path.join(output, 'stage-curve.png') });
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', source: sceneEntry ? 'inherited-scene-entry' : sceneBlueprint ? 'inherited-scene-blueprint' : 'prior-line-blueprint', checks: ['继承动画按累计时间写回原始来源并保留播放位置', '保存属性帧并保留当前句空动作，显示来源提示'], errors }, null, 2));
} catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); throw error; }
finally { await app.close(); console.log(output); }
