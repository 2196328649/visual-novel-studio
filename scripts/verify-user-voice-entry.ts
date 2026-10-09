import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { expect } from '@playwright/test';
import { assetFiles, type Project } from '../src/core/model';
import { assetSourcePath } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openUiPreviewWindow } from './lib/ui-preview-window';

assert.ok(process.argv[2], 'Pass the original project file; it is read only.');
const root = path.resolve('.'), source = path.resolve(process.argv[2]);
const output = path.join(root, 'artifacts/user-voice-entry', new Date().toISOString().replaceAll(':', '-'));
const preserved = await Promise.all(['', '.autosave', '.previous'].map(async suffix => ({ file: source + suffix, bytes: await fs.readFile(source + suffix) })));
const raw = JSON.parse(preserved[0].bytes.toString('utf8')), project: Project = raw.project ?? raw;
assert.deepEqual(project.ui.disabledPages, ['chapterSelect', 'voiceCollection', 'voiceSettings', 'staff', 'keyboard', 'gameOver']);
assert.equal(project.ui.components.some(component => component.action === 'voiceCollection'), false);
assert.equal(project.nodes.some(node => node.kind === 'passage' && node.lines.some(line => line.voiceId)), false);
for (const asset of project.assets) {
  const files = Object.fromEntries(assetFiles(asset).map(relative => [relative, assetSourcePath(path.dirname(source), asset, relative)]));
  asset.externalFiles = files; asset.externalPath = files[asset.path];
}
const projectFile = path.join(output, 'project.vns.json');
await fs.mkdir(output, { recursive: true }); await fs.writeFile(projectFile, JSON.stringify(raw));
const app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
const page = await app.firstWindow(), errors: string[] = [];
app.on('window', window => window.on('pageerror', error => errors.push(error.message)));
page.on('pageerror', error => errors.push(error.message));
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="ui"]').click();
  const picker = page.getByLabel('设计页面', { exact: true });
  await picker.selectOption('gallery');
  const entry = page.locator('[data-component-id="ai_gallery_voicecollection"]');
  await expect(entry).toBeVisible();
  const caption = entry.locator('.ui-text-content');
  await expect(caption).toHaveText('语音收藏');
  await expect(caption).toHaveCSS('visibility', 'visible');
  await page.screenshot({ path: path.join(output, 'restored-gallery-entry.png') });
  await picker.selectOption('voiceCollection');
  await expect(page.locator('[data-component-id="ai_voicecollection_items"]')).toBeVisible();
  await picker.selectOption('main');
  await page.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '事件图', exact: true }).click();
  await page.getByLabel('事件图页面', { exact: true }).selectOption('ui:main');
  const preview = await openUiPreviewWindow(app, page), frame = preview.getByLabel('参数联动预演画面', { exact: true });
  await frame.getByRole('button', { name: '收藏', exact: true }).click();
  await expect(preview.getByLabel('当前预演页面', { exact: true })).toHaveText('画廊');
  await frame.getByRole('button', { name: '语音收藏', exact: true }).click();
  await expect(preview.getByLabel('当前预演页面', { exact: true })).toHaveText('语音收藏');
  await expect(frame).toContainText('尚未收藏语音');
  await expect(frame.getByRole('button', { name: '返回', exact: true })).toBeVisible();
  await frame.screenshot({ path: path.join(output, 'empty-voice-collection.png') });
  await frame.getByRole('button', { name: '返回', exact: true }).click();
  await expect(preview.getByLabel('当前预演页面', { exact: true })).toHaveText('标题');
  assert.deepEqual(errors, []);
  for (const original of preserved) assert.ok(original.bytes.equals(await fs.readFile(original.file)), original.file + ' changed');
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', source,
    hashes: preserved.map(original => ({ file: original.file, sha256: createHash('sha256').update(original.bytes).digest('hex') })),
    checks: ['旧模板删除签名在加载时恢复语音收藏设计页和画廊入口。', '无配音的用户工程副本实际从标题、画廊进入空语音收藏并返回。', '缺失入口图片回退可读文字；原工程、自动保存和备份字节保持不变。'], errors,
  }, null, 2));
  console.log(output);
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', error: String(error), errors }, null, 2)); console.log(output); throw error;
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await app.close();
}
