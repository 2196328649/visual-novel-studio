import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { currentScriptText } from '../src/core/script-text';
import { parseProject, assetSourcePath } from '../src/desktop/project-store';
import { assetFiles } from '../src/core/model';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), output = path.join(root, 'artifacts/story-deletion', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const source = '# 章节：第一章【chapter_one】\n# 小章节：保留场景【scene_one】\n# 段落：开场【passage_one】\n旁白：这段原有剧情必须保留。\n\n# 章节：待删除章节【chapter_two】\n# 小章节：待删除场景【scene_two】\n# 段落：新段落【passage_two】\n旁白：这段用于删除测试。';
let project = applyTextScript(createProject('章节删除验收'), source).project;
project.scriptText = currentScriptText(source);
if (process.argv.includes('--middle')) {
  project = applyTextScript(project, source + '\n\n# 章节：尾章【chapter_three】\n# 小章节：保留尾章【scene_three】\n# 段落：尾声【passage_three】\n旁白：后续剧情也必须保留。').project;
  project.scriptText = currentScriptText(projectToText(project));
}
const argument = process.argv.indexOf('--project');
if (argument >= 0) {
  const file = path.resolve(process.argv[argument + 1]), raw = JSON.parse(await fs.readFile(file, 'utf8'));
  project = parseProject(raw.project ?? raw).project;
  for (const asset of project.assets) {
    asset.externalFiles = Object.fromEntries(assetFiles(asset).map(relative => [relative, assetSourcePath(path.dirname(file), asset, relative)]));
    asset.externalPath = asset.externalFiles[asset.path];
  }
}
const results: unknown[] = [];
for (const mode of ['text-chapter', 'text-scene', 'directory-scene', 'directory-chapter', 'draft-scene', 'new-scene']) {
  const projectFile = path.join(output, mode + '.vns.json'); await fs.writeFile(projectFile, JSON.stringify(project));
  let app: ElectronApplication | undefined, page: Page | undefined; const errors: string[] = [];
  try {
    app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, mode + '-profile') });
    page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.stack ?? e.message)); page.on('dialog', d => d.accept());
    await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 30000 });
    await openStoryMode(page, 'text');
    if (process.argv.includes('--hidden')) await page.getByRole('button', { name: '隐藏演出', exact: true }).click();
    if (argument >= 0) {
      await page.getByRole('button', { name: '添加章节', exact: true }).click();
      await page.getByLabel('名称', { exact: true }).fill('待删除章节');
      await page.getByRole('button', { name: '确定', exact: true }).click();
      await page.locator('.chapter-tree').filter({ has: page.locator('.chapter-label', { hasText: '待删除章节' }) }).locator('.scene-row button').first().click();
    } else await page.locator('.scene-row').filter({ hasText: '待删除场景' }).locator('button').first().click();
    const input = page.getByLabel('中文文本剧本', { exact: true });
    await expect(input).toContainText('');
    await expect.poll(() => input.inputValue()).toContain('待删除章节');
    const chapter = page.locator('.chapter-tree').filter({ has: page.locator('.chapter-label', { hasText: '待删除章节' }) });
    if (mode === 'draft-scene') {
      await input.fill((await input.inputValue()) + '\n# 小章节：草稿里的小章节\n旁白：这句还没有应用到模块。\n');
      await expect(chapter.locator('.scene-row')).toHaveCount(2);
    }
    if (mode === 'new-scene') {
      await page.getByRole('button', { name: '添加小章节', exact: true }).click();
      await expect(chapter.locator('.scene-row')).toHaveCount(2);
    }
    const beforeCounts = { chapters: await page.locator('.chapter-label').count(), scenes: await page.locator('.scene-row').count() };
    if (mode === 'draft-scene' || mode === 'new-scene') await chapter.getByRole('button', { name: '删除小章节', exact: true }).last().click();
    else if (mode === 'directory-chapter') await chapter.getByRole('button', { name: '删除章节', exact: true }).click();
    else if (mode === 'directory-scene') await chapter.getByRole('button', { name: '删除小章节', exact: true }).click();
    else if (mode === 'text-chapter') { await input.focus(); await input.press('Control+a'); await input.press('Backspace'); }
    else { const text = await input.inputValue(); await input.fill(text.slice(0, text.indexOf('# 小章节'))); }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(output, mode + '.png') });
    expect(errors).toEqual([]);
    await expect(input).toBeVisible();
    const afterCounts = { chapters: await page.locator('.chapter-label').count(), scenes: await page.locator('.scene-row').count() };
    await page.getByRole('button', { name: '撤销文本修改', exact: true }).click();
    await expect(page.locator('.chapter-label')).toHaveCount(beforeCounts.chapters);
    await expect(page.locator('.scene-row')).toHaveCount(beforeCounts.scenes);
    await page.getByRole('button', { name: '重做文本修改', exact: true }).click();
    await expect(page.locator('.chapter-label')).toHaveCount(afterCounts.chapters);
    await expect(page.locator('.scene-row')).toHaveCount(afterCounts.scenes);
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await expect(page.locator('.dirty-dot')).toHaveCount(0);
    const saved = JSON.parse(await fs.readFile(projectFile, 'utf8'));
    expect(saved.scriptText.content).toContain('旁白：');
    if (mode === 'directory-chapter' || mode === 'text-chapter') expect(saved.scriptText.content).not.toContain('待删除章节');
    if (mode === 'draft-scene') expect(saved.scriptText.content).not.toContain('草稿里的小章节');
    await page.reload();
    await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 30000 });
    await expect(page.locator('.chapter-label')).toHaveCount(afterCounts.chapters);
    await expect(page.locator('.scene-row')).toHaveCount(afterCounts.scenes);
    await expect(input).toBeVisible();
    expect(errors).toEqual([]);
    results.push({ mode, status: 'passed', beforeCounts, afterCounts, text: (await input.inputValue()).slice(0, 200) });
  } catch (error) { results.push({ mode, status: 'failed', error: String(error), errors }); }
  finally { if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); await app.close().catch(() => undefined); } }
}
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(results, null, 2)); console.log(output); console.log(JSON.stringify(results));
if (results.some((r: any) => r.status === 'failed')) process.exitCode = 1;
