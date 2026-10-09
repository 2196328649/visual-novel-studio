import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { projectSchema, effectiveUiTheme } from '../src/core/model';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.'), samples = path.join(root, 'artifacts/voice-collection-pages');
const latest = (await fs.readdir(samples)).sort().at(-1)!;
const output = process.env.VNS_VOICE_EDITOR_OUTPUT ?? path.join(root, 'artifacts/voice-collection-editor', new Date().toISOString().replaceAll(':', '-'));
const fixture = path.join(output, 'project'), projectFile = path.join(fixture, 'project.vns.json');
const source = path.join(samples, latest, 'project');
const original = await fs.readFile(path.join(source,'project.vns.json'), 'utf8');
const project = projectSchema.parse(JSON.parse(original));
// This acceptance uses one UI page; copy its dependencies, not the story/template media library.
const theme=effectiveUiTheme(project.ui),ids=new Set<string>();
const collect=(value:unknown)=>{if(typeof value==='string')ids.add(value);else if(Array.isArray(value))value.forEach(collect);else if(value&&typeof value==='object')Object.values(value).forEach(collect);};
collect([theme.fontAssetId,theme.menuBackgroundId,theme.pages,project.ui.components.filter(c=>c.page==='voiceCollection')]);
await fs.mkdir(fixture,{recursive:true});await fs.writeFile(projectFile,original);
for(const asset of project.assets.filter(asset=>ids.has(asset.id))){const target=path.resolve(fixture,asset.path);if(!target.startsWith(path.resolve(fixture)+path.sep))throw Error('Fixture asset must stay in its directory');await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.resolve(source,asset.path),target);}
const app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile });
const page = await app.firstWindow(), errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByLabel('设计页面', { exact: true }).selectOption({ label: '语音收藏' });
  const component = page.locator('[data-component-id="ai_voicecollection_items"]');
  await expect(component.locator('[data-voice-entry]')).toHaveCount(12);
  await expect(component.getByText('停止试听', { exact: true })).toHaveCount(0);
  await expect(component.locator('[data-voice-pagination] > span')).toHaveCount(2);
  const first = component.locator('[data-voice-entry]').first();
  const caption = first.locator('[data-voice-caption]').locator('..');
  const favorite = first.locator('[data-voice-control^="favorite:"]');
  const itemBox = (await first.boundingBox())!, captionBox = (await caption.boundingBox())!, favoriteBox = (await favorite.boundingBox())!;
  expect(captionBox.x + captionBox.width).toBeLessThanOrEqual(favoriteBox.x + 1);
  expect(Math.abs(favoriteBox.width / itemBox.width - 68 / 701)).toBeLessThan(.002);
  await expect(caption.locator('span')).toHaveCSS('text-overflow', 'ellipsis');
  await expect.poll(() => page.locator('.ui-canvas img').evaluateAll(images => images.every(i => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.locator('[data-hierarchy-id="ai_voicecollection_items"]').click();
  await page.getByText('收藏条目与分页', { exact: true }).click();
  await expect(page.getByLabel('显示筛选和停止按钮', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('收藏文字内容', { exact: true })).toHaveValue('text');
  await expect(page.getByLabel('单行显示并省略长文本', { exact: true })).toBeChecked();
  await page.screenshot({ path: path.join(output, 'editor-original-layout.png') });
  await page.getByLabel('显示筛选和停止按钮', { exact: true }).check();
  await expect(component.getByText('停止试听', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByLabel('显示筛选和停止按钮', { exact: true })).not.toBeChecked();
  await expect(component.getByText('停止试听', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(component.getByText('停止试听', { exact: true })).toBeVisible();
  await page.getByLabel('收藏按钮横向 %', { exact: true }).fill('80');
  await page.getByLabel('收藏按钮横向 %', { exact: true }).press('Tab');
  const movedItem = (await first.boundingBox())!, movedFavorite = (await favorite.boundingBox())!;
  expect(Math.abs((movedFavorite.x - movedItem.x) / movedItem.width - .8)).toBeLessThan(.002);
  expect(await fs.readFile(projectFile, 'utf8')).toBe(original);
  await page.getByRole('button', { name: '保存界面', exact: true }).click();
  await expect.poll(async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))).ui.components.find(c => c.id === 'ai_voicecollection_items')!.list!.showVoiceControls).toBe(true);
  expect(projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))).ui.components.find(c => c.id === 'ai_voicecollection_items')!.list!.voiceFavoriteRect!.x).toBe(.8);
  await page.reload();
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByLabel('设计页面', { exact: true }).selectOption({ label: '语音收藏' });
  await expect(component.getByText('停止试听', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', compiledBuild: true, checks: ['配音条目两列六行，页数仅统计配音', '原始图片均加载，文字和收藏按钮不重叠', '长句省略预览', '普通属性显隐实时生效', 'UI独立撤销重做、保存前磁盘不变、保存重载保留'], errors }, null, 2));
  console.log(output);
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  throw error;
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => undefined);
  await app.close();
}
