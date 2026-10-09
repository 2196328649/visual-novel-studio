import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';
import { assetFiles, type Project } from '../src/core/model';
import { assetSourcePath } from '../src/desktop/project-store';
import { compileProject } from '../src/runtime/compiler';
import { enterFixtureProject, launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), manifestFile = path.resolve(process.argv[2]);
const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
const baseline = process.argv.includes('--before');
const project: Project = JSON.parse(await fs.readFile(baseline ? path.join(path.dirname(manifestFile), 'parsed-before.json') : manifest.candidate, 'utf8'));
const output = path.resolve('artifacts/imported-passage-repair', new Date().toISOString().replaceAll(':', '-') + (baseline ? '-before' : '-after'));
const file = path.join(output, 'project/project.vns.json');
await fs.mkdir(path.dirname(file), { recursive: true });
const hash = async (file: string) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const authorHash = await hash(manifest.file);
for (const asset of project.assets) {
  asset.externalFiles = Object.fromEntries(assetFiles(asset).map(relative => [relative, assetSourcePath(path.dirname(manifest.file), asset, relative)]));
  asset.externalPath = asset.externalFiles[asset.path];
}
await fs.writeFile(file, JSON.stringify(project));
const firstText = '所幸可以写信，我打定主意，待我寻到爹娘，一定要写信给他俩，如若可以，希望能给她们寻个更好的去处。';
const secondText = '盐池里解州并不算远，不过几日光景，我们到了盐池的一处客栈。';
const rows = project.nodes.flatMap(node => node.kind === 'passage' ? node.lines.map(line => ({ nodeId: node.id, line })) : []);
const first = rows.find(row => row.line.text === firstText), second = rows.find(row => row.line.text === secondText);
assert.ok(first && second); assert.equal(rows.indexOf(second), rows.indexOf(first) + 1);
if (!baseline) {
  assert.equal(first.nodeId, second.nodeId);
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  const block = compiled.files['game/story.rpy'].split(`label vn_line_${first.nodeId}_${first.line.id}:`)[1].split('\nlabel ')[0];
  assert.ok(block.includes(`jump vn_line_${second.nodeId}_${second.line.id}`), 'The runtime must advance directly to the following dialogue');
}
const errors: string[] = [], checks: string[] = [];
const app = await launchDesktopFixture({ root, projectFile: file, profile: path.join(output, 'profile') });
const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setContentSize(1440, 960); window.show(); window.focus(); });
  if (manifest.chapter) {
    await openStoryMode(page, 'text');
    await expect(page.locator('.story-directory .chapter-label > span')).toHaveText([manifest.chapter.name]);
    const source = await page.getByLabel('中文文本剧本', { exact: true }).inputValue();
    assert.ok(source.includes('# 章节：' + manifest.chapter.name));
    assert.ok(!source.includes('【' + manifest.chapter.id + '】'));
    checks.push('The author’s renamed chapter appears once in the directory with its original identity hidden.');
  }
  await openStoryMode(page, 'script');
  const before = page.locator(`#line-${first.line.id}`), after = page.locator(`#line-${second.line.id}`), input = after.locator('textarea');
  await before.locator('textarea').click(); await input.scrollIntoViewIfNeeded();
  const boundary = await page.evaluate(([firstId, secondId]) => {
    const before = document.getElementById('line-' + firstId)!, after = document.getElementById('line-' + secondId)!;
    const a = before.getBoundingClientRect(), b = after.getBoundingClientRect();
    return { sameModule: before.closest('.passage-section') === after.closest('.passage-section'), adjacentRows: before.nextElementSibling === after, gap: b.top - a.bottom };
  }, [first.line.id, second.line.id]);
  assert.equal(boundary.sameModule, !baseline);
  if (!baseline) { assert.equal(boundary.adjacentRows, true); assert.ok(boundary.gap <= 2); }
  await page.screenshot({ path: path.join(output, 'module-boundary.png') });
  checks.push(baseline ? 'Confirmed the two consecutive lines were split across modules.' : 'The two quoted lines are adjacent rows in one module, without an intervening add-dialogue button.');
  await page.locator('[data-workspace-tab="flowchart"]').click();
  await expect(page.locator('.react-flow__node')).toHaveCount(project.nodes.length);
  if (!baseline) for (const item of manifest.merged) await expect(page.locator(`.react-flow__node[data-id="${item.removedId}"]`)).toHaveCount(0);
  await page.screenshot({ path: path.join(output, 'flowchart.png') });
  checks.push(`Flowchart has ${project.nodes.length} actual nodes.`);
  if (!baseline) {
    await openStoryMode(page, 'script');
    await input.fill(secondText + '【保存验收】');
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(input).toHaveValue(secondText);
    await page.getByRole('button', { name: '重做', exact: true }).click(); await expect(input).toHaveValue(secondText + '【保存验收】');
    await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
    const saved: Project = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(saved.nodes.length, project.nodes.length);
    if (manifest.chapter) assert.deepEqual(saved.chapters.map(chapter => [chapter.id, chapter.name]), [[manifest.chapter.id, manifest.chapter.name]]);
    for (const item of manifest.merged) assert.ok(!saved.scriptText?.content.includes(item.removedId));
    await page.reload(); await enterFixtureProject(page, file);
    await expect(page.locator('.project-title strong')).toHaveText(project.name);
    if (manifest.chapter) await expect(page.locator('.story-directory .chapter-label > span')).toHaveText([manifest.chapter.name]);
    await openStoryMode(page, 'script'); await input.scrollIntoViewIfNeeded();
    await expect(input).toHaveValue(secondText + '【保存验收】');
    assert.equal(await before.evaluate((element, otherId) => element.closest('.passage-section') === document.getElementById(otherId)?.closest('.passage-section'), 'line-' + second.line.id), true);
    checks.push('Editing, undo, redo, save and reopen keep the merged module and its stable dialogue IDs.');
  }
  assert.equal(await hash(manifest.file), authorHash, 'Verification must not alter the author project');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', phase: baseline ? 'before' : 'after', manifestFile, projectFile: file, nodes: project.nodes.length, boundary, chapter: manifest.chapter, checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', error: String(error), errors, checks }, null, 2));
  throw error;
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined);
  await app.close().catch(() => undefined); console.log(output);
}
