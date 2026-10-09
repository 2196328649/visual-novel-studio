import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium, expect, type Page } from '@playwright/test';
import { preview as serveBuild } from 'vite';
import { projectSchema } from '../src/core/model';
import { synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createUiVoicePreviewFixture, writeUiVoicePreviewAudio } from './lib/ui-voice-preview-fixture';
import { showUiPreviewTestData } from './lib/ui-preview-window';

const output = path.resolve('artifacts/ui-preview-window-browser', new Date().toISOString().replaceAll(':', '-'));
const { project } = createUiVoicePreviewFixture(); project.name = '浏览器独立 UI 预览验收';
project.ui.components.push({ id: 'window_text', page: 'main', kind: 'text', text: '浏览器同步原文', x: .08, y: .04, width: .6, height: .1, style: { fontSize: 48 } });
synchronizeBlueprintSignatures(project); await writeUiVoicePreviewAudio(output);
const assets: Record<string, string> = {};
for (const asset of project.assets) assets[asset.path] = 'data:audio/wav;base64,' + (await fs.readFile(path.join(output, asset.path))).toString('base64');
const server = await serveBuild({ preview: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
const address = server.httpServer.address(); assert.ok(address && typeof address === 'object');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1480, height: 960 } }), editor = await context.newPage(), errors: string[] = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message))); editor.on('pageerror', error => errors.push(error.message));
await editor.addInitScript(({ project, assets }) => {
 if (location.protocol !== 'http:') return;
 localStorage.setItem('visual-novel-studio-browser-project', JSON.stringify(project));
 localStorage.setItem('visual-novel-studio-browser-assets', JSON.stringify(assets));
}, { project: projectSchema.parse(project), assets });
let preview: Page = editor;
const open = async () => {
 const opened = editor.waitForEvent('popup'); await editor.getByRole('button', { name: '预览窗口', exact: true }).click(); preview = await opened;
 await expect(preview.getByLabel('UI 交互预览', { exact: true })).toBeVisible();
};
try {
 await editor.goto(`http://127.0.0.1:${address.port}`); await expect(editor.locator('.project-title strong')).toHaveText(project.name);
 await editor.locator('[data-workspace-tab="ui"]').click(); await open();
 await expect(editor.locator('.ui-logic-preview')).toHaveCount(0); await expect(preview.getByLabel('参数联动预演画面')).toContainText('浏览器同步原文');
 await editor.getByRole('button', { name: '预览窗口', exact: true }).click(); assert.equal(context.pages().length, 2);
 await preview.reload(); await expect(editor.getByRole('button', { name: '预览窗口', exact: true })).toHaveAttribute('aria-pressed', 'true');
 await editor.locator('[data-hierarchy-id="window_text"]').click(); await editor.getByLabel('文字', { exact: true }).fill('浏览器未保存的修改');
 await expect(preview.getByLabel('参数联动预演画面')).toContainText('浏览器未保存的修改'); await preview.screenshot({ path: path.join(output, 'preview.png') });
 await editor.getByRole('button', { name: '撤销', exact: true }).click(); await expect(preview.getByLabel('参数联动预演画面')).toContainText('浏览器同步原文');
 await preview.getByLabel('参数联动预演画面').getByRole('button', { name: '打开语音收藏', exact: true }).click();
 await showUiPreviewTestData(preview); await preview.getByText('语音测试数据', { exact: true }).click(); await preview.getByRole('button', { name: '收藏全部语音', exact: true }).click();
 await preview.locator('[data-voice-control="play:voice_0"]').click(); await expect.poll(() => preview.getByLabel('语音预演播放器').evaluate((a: HTMLAudioElement) => a.currentSrc.startsWith('data:audio/wav') && !a.paused && a.currentTime > .01)).toBe(true);
 await preview.getByRole('button', { name: '关闭预览', exact: true }).click(); await expect.poll(() => preview.isClosed()).toBe(true);
 await expect(editor.getByRole('button', { name: '预览窗口', exact: true })).toHaveAttribute('aria-pressed', 'false');
 await open(); await expect(preview.getByLabel('当前预演页面')).toHaveText('标题'); await editor.goto('about:blank'); await expect.poll(() => preview.isClosed()).toBe(true);
 assert.deepEqual(errors, []);
 await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', browser: 'Edge', renderer: 'dist', checks: ['独立浏览器弹出窗口与重复聚焦', '弹窗重载后继续同步草稿', '同源素材 URL 同步与真实 WAV 播放', '关闭、重开与父页面离开清理'], errors }, null, 2));
} catch (error) { await preview.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); throw error; }
finally { await browser.close(); await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve())); console.log(output); }
