import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createProject, nodeSchema, projectSchema } from '../src/core/model';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.');
const output = path.join(root, 'artifacts/preview-route', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const templateRoot = path.join(root, 'resources/templates/aihong');
const template = projectSchema.parse(JSON.parse(await fs.readFile(path.join(templateRoot, 'project.vns.json'), 'utf8')));
const project = createProject('分支路径预览验收');
project.assets = template.assets.filter(asset => ['ai_story_banquet', 'ai_presentation_chapter_one'].includes(asset.id));
assert.equal(project.assets.length, 2);
for (const asset of project.assets) {
  await fs.mkdir(path.dirname(path.join(output, asset.path)), { recursive: true });
  await fs.copyFile(path.join(templateRoot, asset.path), path.join(output, asset.path));
}
const passage = (id: string, background?: string, next?: string) => ({ id, kind: 'passage', next, lines: [{ id: `${id}_line`, text: id, actions: background ? [{ kind: 'background', assetId: background, transition: 'none' }] : [] }] });
project.nodes = [
  { id: 'menu', kind: 'choice', prompt: '选择路径', choices: [{ id: 'left', text: '庭院路线', target: 'left' }, { id: 'right', text: '章节路线', target: 'right' }, { id: 'dead', text: '提前结束', target: 'dead_end' }] },
  passage('left', 'ai_story_banquet', 'merge'), passage('right', 'ai_presentation_chapter_one', 'merge'),
  passage('merge'), passage('disconnected'),
  { id: 'dead_end', kind: 'end', text: '提前结束' },
].map(spec => nodeSchema.parse({ name: spec.id, sceneId: project.scenes[0].id, x: 0, y: 0, ...spec }));
project.entryId = 'menu';
const projectFile = path.join(output, 'project.vns.json');
await fs.writeFile(projectFile, JSON.stringify(project));
const app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
const page = await app.firstWindow(), errors: string[] = [], checks: string[] = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await openStoryMode(page, 'script');
  await page.locator('#node-merge .dialogue-input').focus();
  await expect(page.locator('.text-preview-note').filter({ hasText: '示例路径' })).toContainText('庭院路线');
  await expect(page.locator('.text-stage-background')).toHaveAttribute('alt', `背景：${project.assets.find(asset => asset.id === 'ai_story_banquet')!.name}`);
  checks.push('合流段落继承庭院路线背景，不受排在后面的章节分支污染，并显示示例路径说明');
  await page.screenshot({ path: path.join(output, '01-merge.png') });
  await page.getByText('预览路径与选择历史', { exact: true }).click();
  const routeChoice = page.getByLabel('预览分支 1：menu', { exact: true });
  await routeChoice.selectOption('right');
  await expect(page.locator('.text-preview-note').filter({ hasText: '所选示例路径' })).toContainText('章节路线');
  await expect(page.locator('.text-stage-background')).toHaveAttribute('alt', `背景：${project.assets.find(asset => asset.id === 'ai_presentation_chapter_one')!.name}`);
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  await page.screenshot({ path: path.join(output, '03-selected-route.png') });
  checks.push('保持合流段落不变时可选择另一条预览路径，背景随所选分支切换且工程不变脏');
  await routeChoice.selectOption('dead');
  await expect(page.locator('.text-preview-note').filter({ hasText: '符合所选分支' })).toBeVisible();
  await expect(page.locator('.text-stage-background')).toHaveCount(0);
  await page.getByRole('button', { name: '恢复自动预览路径', exact: true }).click();
  await expect(routeChoice).toHaveValue('left');
  await expect(page.locator('.text-stage-background')).toHaveAttribute('alt', `背景：${project.assets.find(asset => asset.id === 'ai_story_banquet')!.name}`);
  checks.push('不能抵达目标的所选路径显示说明并清除继承状态，可恢复自动路径');
  await page.locator('#node-right .dialogue-input').focus();
  await expect(page.locator('.text-preview-note').filter({ hasText: '示例路径' })).toContainText('章节路线');
  await expect(page.locator('.text-stage-background')).toHaveAttribute('alt', `背景：${project.assets.find(asset => asset.id === 'ai_presentation_chapter_one')!.name}`);
  checks.push('选择另一分支时切换路径与对应背景');
  await page.locator('#node-disconnected .dialogue-input').focus();
  await expect(page.locator('.text-preview-note').filter({ hasText: '未找到' })).toBeVisible();
  await expect(page.locator('.text-stage-background')).toHaveCount(0);
  checks.push('不连通段落清除继承背景并显示路径缺失说明');
  await page.screenshot({ path: path.join(output, '02-disconnected.png') });
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: String(error), checks, errors }, null, 2));
  throw error;
} finally { await app.close(); console.log(output); }
