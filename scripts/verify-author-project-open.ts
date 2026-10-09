import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';
import { openStoryMode } from './lib/story-workspace';
const root = path.resolve('.'), file = 'E:/Project/Visual Novel Studio/我的视觉小说1/project.vns.json';
const output = path.resolve('artifacts/author-project-open', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const release = JSON.parse(await fs.readFile('release/verification-0.8.0.json', 'utf8'));
process.env.VNS_INSTALLED_EXE = release.artifacts.find((a: { kind: string }) => a.kind === 'installer').executable;
const { launchDesktopFixture } = await import('./lib/desktop-fixture');
const before = await fs.readFile(file), project = JSON.parse(before.toString('utf8'));
const app = await launchDesktopFixture({ root, projectFile: file, profile: path.join(output, 'profile') });
const page = await app.firstWindow(), errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 60000 });
 await openStoryMode(page, 'text');
 const text = await page.getByLabel('中文文本剧本', { exact: true }).inputValue();
 assert.ok(text.includes('@显示角色'));
 assert.ok(!text.includes('自动显示发言角色'));
 assert.ok(text.includes('第一章 · 酒醒城破'));
 await page.screenshot({ path: path.join(output, 'opened.png') });
 assert.deepEqual(errors, []);
 assert.ok((await fs.readFile(file)).equals(before), 'The read-only opening check must not change the project.');
 await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', file, executable: process.env.VNS_INSTALLED_EXE, projectName: project.name, errors, checks: ['actual packaged editor opens original project path', 'text editor renders converted commands', 'original file unchanged by opening check'] }, null, 2));
} finally {
 await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => undefined);
 await app.close(); console.log(output);
}
