import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { expect } from '@playwright/test';
import { createProject } from '../src/core/model';
import type { RuntimeEvent } from '../src/core/bridge';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.'), output = path.join(root, 'artifacts/preview-close-dialog', new Date().toISOString().replaceAll(':', '-'));
const project = createProject('内嵌试玩关闭询问验收');
project.ui.components.push({ id: 'qa_music', kind: 'musicTrackList', page: 'musicRoom', text: '曲目', x: .1, y: .15, width: .8, height: .6, list: { assetIds: [] } });
await fs.mkdir(output, { recursive: true });
const projectFile = path.join(output, 'project.vns.json'); await fs.writeFile(projectFile, JSON.stringify(project));
await fs.writeFile(path.join(output, 'inspect.py'), `import ctypes, json, sys
from ctypes import wintypes
user = ctypes.WinDLL('user32', use_last_error=True)
user.IsWindow.argtypes = [wintypes.HWND]
user.IsWindowVisible.argtypes = [wintypes.HWND]
user.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
hwnd = int(sys.argv[1]); bounds = wintypes.RECT(); user.GetWindowRect(hwnd, ctypes.byref(bounds))
print(json.dumps(dict(exists=bool(user.IsWindow(hwnd)), visible=bool(user.IsWindowVisible(hwnd)), bounds=[bounds.left, bounds.top, bounds.right, bounds.bottom])))
`);
async function native(hwnd: string) {
  assert.match(hwnd, /^\d+$/);
  return new Promise<{ exists: boolean; visible: boolean; bounds: number[] }>((resolve, reject) => {
    const child = spawn(path.join(root, 'resources/runtime/lib/py3-windows-x86_64/python.exe'), [path.join(output, 'inspect.py'), hwnd], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    child.once('error', reject); child.once('close', code => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)));
  });
}
const app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') }), page = await app.firstWindow();
const errors: string[] = [], checks: string[] = []; let phase = 'launch'; page.on('pageerror', error => errors.push(error.message));
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await app.evaluate(({ dialog }) => {
    const state = globalThis as any; state.closePrompts = [];
    dialog.showMessageBox = (async (...args: any[]) => {
      const options = args.at(-1); state.closePrompts.push(options);
      if (options.title !== '保存工程') throw new Error('Unexpected close error: ' + options.message);
      const response = await new Promise(resolve => { state.answerClose = resolve; });
      state.answerClose = undefined; return { response, checkboxChecked: false };
    }) as any;
  });
  await app.evaluate(({ BrowserWindow, powerSaveBlocker }) => { powerSaveBlocker.start('prevent-display-sleep'); const current = BrowserWindow.getAllWindows()[0]; current.restore(); current.focus(); });
  await page.locator('[data-workspace-tab="ui"]').click(); await page.getByLabel('设计页面', { exact: true }).selectOption('musicRoom');
  await page.locator('[data-hierarchy-id="qa_music"]').click(); await page.getByLabel('音乐列表曲目来源', { exact: true }).selectOption('automatic');
  await expect(page.locator('.dirty-dot')).toHaveCount(1);
  // Keep the real editor draft while mounting its own native playtest surface.
  // The close handler must protect dialogs independently of PlayWorkspace state.
  phase = 'native playtest';
  await page.evaluate(async project => {
    const state = window as unknown as { closePreviewEvents: RuntimeEvent[] }; state.closePreviewEvents = [];
    window.studio!.onRuntimeEvent(event => state.closePreviewEvents.push(event));
    await window.studio!.setPreviewViewport!({ x: 380, y: 180, width: 760, height: 430, visible: true });
    const result = await window.studio!.preview(project, { mode: 'embedded' });
    if (!result.ok) throw new Error(result.log);
  }, project);
  await expect.poll(() => page.evaluate(() => (window as unknown as { closePreviewEvents: RuntimeEvent[] }).closePreviewEvents.find(event => event.kind === 'preview' && ['running', 'failed'].includes(event.phase ?? ''))), { timeout: 60000 }).toBeTruthy();
  const event = await page.evaluate(() => (window as unknown as { closePreviewEvents: RuntimeEvent[] }).closePreviewEvents.find(event => event.kind === 'preview' && ['running', 'failed'].includes(event.phase ?? ''))!);
  assert.equal(event.phase, 'running', JSON.stringify(event)); assert.ok(event.windowId);
  await expect.poll(async () => (await native(event.windowId!)).visible).toBe(true);
  const before = await native(event.windowId);
  phase = 'close and cancel'; await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect.poll(() => app.evaluate(() => !!(globalThis as any).answerClose)).toBe(true);
  assert.deepEqual(await app.evaluate(() => (globalThis as any).closePrompts[0].buttons), ['保存', '不保存', '取消']);
  await expect.poll(async () => (await native(event.windowId!)).visible).toBe(false);
  await page.screenshot({ path: path.join(output, 'preview-hidden-during-close.png') });
  const hidden = await native(event.windowId); assert.equal(hidden.exists, true);
  await app.evaluate(() => (globalThis as any).answerClose(2));
  await expect.poll(async () => (await native(event.windowId!)).visible).toBe(true);
  const restored = await native(event.windowId); assert.deepEqual(restored.bounds, before.bounds);
  await expect(page.locator('.dirty-dot')).toHaveCount(1);
  checks.push('真实原生试玩窗口在关闭询问期间隐藏；取消后恢复同一窗口与位置，界面草稿保留。');
  phase = 'close and save'; await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect.poll(() => app.evaluate(() => !!(globalThis as any).answerClose)).toBe(true);
  await expect.poll(async () => (await native(event.windowId!)).visible).toBe(false);
  const closed = app.waitForEvent('close'); await app.evaluate(() => (globalThis as any).answerClose(0)); await closed;
  await expect.poll(async () => (await native(event.windowId!)).exists, { timeout: 15000 }).toBe(false);
  const saved = JSON.parse(await fs.readFile(projectFile, 'utf8'));
  assert.equal(saved.ui.components.find((component: { id: string }) => component.id === 'qa_music').list.assetIds, undefined);
  checks.push('关闭询问中保存成功后才退出编辑器，试玩进程和原生画面一并清理。');
  assert.deepEqual(errors, []); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, before, hidden, restored, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, errors, error: String(error) }, null, 2)); throw error;
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
  await app.close().catch(() => {}); console.log(output);
}
