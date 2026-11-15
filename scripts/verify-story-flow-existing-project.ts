import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assetFiles, projectSchema } from '../src/core/model';
import { storySceneNodeId } from '../src/core/story-groups';
import { assetSourcePath } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

const root = path.resolve('.');
const argument = process.argv.indexOf('--source');
const source = path.resolve(argument >= 0 ? process.argv[argument + 1] : '../我的视觉小说1/project.vns.json');
const output = path.resolve('artifacts/story-flow-existing-project', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json');
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const originalBytes = await fs.readFile(source), originalHash = hash(originalBytes);
const project = projectSchema.parse(JSON.parse(originalBytes.toString('utf8')));
// Read assets at their source; every writable project/profile path belongs to this run.
for (const asset of project.assets) {
  asset.externalFiles = Object.fromEntries(assetFiles(asset).map(relative => [relative, assetSourcePath(path.dirname(source), asset, relative)]));
  asset.externalPath = asset.externalFiles[asset.path];
}
await fs.mkdir(path.dirname(projectFile), { recursive: true });
await fs.writeFile(projectFile, JSON.stringify(project));
const fixtureBytes = await fs.readFile(projectFile);
const checks: string[] = [], errors: string[] = [], frames: { action: string; ms: number }[] = [];
let app: ElectronApplication | undefined, page: Page | undefined, failure: string | undefined;
const node = (id: string) => page!.locator('.react-flow__node[data-id="' + id + '"]');
const workspace = () => page!.getByRole('region', { name: '流程图', exact: true });
async function fit() { await page!.getByRole('button', { name: '适应全图', exact: true }).click(); await page!.waitForTimeout(230); }
async function timedClick(id: string) {
  const title = node(id).locator('.graph-node-title strong');
  await title.evaluate(element => {
    (window as any).storySelectionFrame = undefined;
    element.addEventListener('click', () => { const start = performance.now(); requestAnimationFrame(() => { (window as any).storySelectionFrame = performance.now() - start; }); }, { capture: true, once: true });
  });
  await title.click();
  await expect.poll(() => page!.evaluate(() => (window as any).storySelectionFrame)).not.toBeUndefined();
  frames.push({ action: '选中 ' + id, ms: await page!.evaluate(() => (window as any).storySelectionFrame) });
}
try {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 60000 });
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setContentSize(1440, 960); window.webContents.setBackgroundThrottling(false); });
  await page.locator('[data-workspace-tab="flowchart"]').click(); await expect(workspace()).toHaveAttribute('data-flow-scope', 'game');
  await expect(node('flow:story')).toBeVisible(); await expect(page.locator('.react-flow__node-story')).toHaveCount(0);
  await fit(); await page.screenshot({ path: path.join(output, '01-existing-overview.png') });
  await node('flow:story').dblclick(); await expect(workspace()).toHaveAttribute('data-flow-scope', 'content'); await fit();
  const scene = project.scenes.find(scene => project.nodes.filter(node => node.sceneId === scene.id && node.kind === 'passage').length >= 2) ?? project.scenes[0];
  await node(storySceneNodeId(scene.id)).dblclick(); await expect(workspace()).toHaveAttribute('data-flow-scope', 'scene:' + scene.id + ':'); await fit();
  await expect(page.locator('.react-flow__node-story')).toHaveCount(project.nodes.filter(node => node.sceneId === scene.id).length);
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  checks.push('真实工程隔离副本从启动总览进入原有小章节，全部剧情节点仍可见；查看不制造工程修改。');
  const passages = project.nodes.filter(node => node.kind === 'passage' && node.sceneId === scene.id);
  for (const passage of passages) {
    await timedClick(passage.id);
    await expect(page.locator('.flow-node-properties').getByLabel('名称', { exact: true })).toHaveValue(passage.name);
  }
  const duplicate = passages.find(passage => passages.filter(other => other.name === passage.name).length > 1);
  if (duplicate) {
    await page.getByLabel('搜索流程图', { exact: true }).fill(duplicate.name);
    const candidates = page.getByRole('region', { name: '流程图搜索结果' }).getByRole('button').filter({ has: page.locator('strong', { hasText: duplicate.name }) });
    const sameName = project.nodes.filter(node => node.name === duplicate.name);
    await expect(candidates).toHaveCount(sameName.length);
    await candidates.nth(1).click(); await expect(node(sameName[1].id)).toHaveClass(/selected/);
    checks.push('同名段落分别列为搜索结果，点击第二项能定位第二个真实节点。');
  }
  if (passages.length >= 2 && !project.storyGroups?.length) {
    await fit(); await node(passages[0].id).locator('.graph-node-title strong').click();
    await node(passages[1].id).locator('.graph-node-title strong').click({ modifiers: ['Control'] });
    await page.getByRole('button', { name: '打组', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '打组为剧情组', exact: true });
    await dialog.getByLabel('剧情组名称').fill('剧情整理示例'); await dialog.getByRole('button', { name: '创建剧情组' }).click();
    const group = page.locator('.react-flow__node-storyContainer').filter({ has: page.locator('.graph-node-title strong', { hasText: '剧情整理示例' }) });
    await expect(group).toHaveClass(/selected/); await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(output, '02-existing-group-example.png') });
    await page.getByRole('button', { name: /^撤销/ }).first().click(); await expect(group).toHaveCount(0); await expect(page.locator('.dirty-dot')).toHaveCount(0);
    checks.push('在隔离副本框选原有段落打组并截图，一次撤销恢复原结构和未修改状态。');
  }
  expect(await fs.readFile(projectFile)).toEqual(fixtureBytes); expect(errors).toEqual([]);
} catch (error) { failure = String(error); console.error(error); await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); }
finally {
  if (app) { const pid = app.process().pid; await app.close(); let alive = false; if (pid) try { process.kill(pid, 0); alive = true; } catch { /* Fixture exited. */ }
    await fs.writeFile(path.join(output, 'processes.json'), JSON.stringify({ pid, alive })); if (alive) failure ??= 'Fixture process remained alive'; }
  try { expect(hash(await fs.readFile(source))).toBe(originalHash); const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); expect(cleanup.errors).toEqual([]); } catch (error) { failure ??= String(error); }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: failure ? 'failed' : 'passed', source, originalHash, checks, errors, frames,
    fixture: { nodes: project.nodes.length, scenes: project.scenes.length, assets: project.assets.length, characters: project.characters.length }, failure }, null, 2));
}
console.log((failure ? 'FAIL: ' : 'PASS: ') + path.join(output, 'report.json')); if (failure) process.exitCode = 1;
