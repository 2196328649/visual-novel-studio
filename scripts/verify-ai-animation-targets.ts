import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, type Page } from '@playwright/test';
import { defaultAiConfig } from '../src/core/ai';
import type { AiEditorTarget } from '../src/core/ai-editor-targets';
import type { UiAnimationClip } from '../src/core/model';
import { aiAnimationTargetsFixture } from './lib/ai-animation-targets-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.'), output = path.join(root, 'artifacts/ai-animation-targets', new Date().toISOString().replaceAll(':', '-'));
const profile = path.join(output, 'profile'), projectFile = path.join(output, 'project.vns.json'); await fs.mkdir(profile, { recursive: true });
const { project, base, sameName, scoped, custom } = aiAnimationTargetsFixture(); const original = JSON.stringify(project); await fs.writeFile(projectFile, original);
let nextTarget: AiEditorTarget, edit = false, phase = 'launch'; const captures: any[] = [], serverErrors: string[] = [], checks: string[] = [];
const server = createServer(async (request, response) => {
  try {
    let raw = ''; for await (const chunk of request) raw += chunk; const body = JSON.parse(raw), last = body.messages.at(-1).content;
    const context = JSON.parse(last.slice(last.indexOf('\n{') + 1)), selection = context.selectedUiAnimation; captures.push(selection ?? null);
    const result = edit ? { message: '修改当前关键帧。', operations: [{ kind: 'editProject', path: ['ui', 'animations', { id: selection.animationId }, 'tracks', { id: selection.trackId }, 'keys', { id: selection.keyId }, 'value'], action: 'set', value: .9 }] }
      : { message: '点击定位指定动画。', operations: [], editorTargets: [nextTarget] };
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }] }));
  } catch (error) { serverErrors.push(String(error)); response.statusCode = 500; response.end(String(error)); }
}); server.listen(0, '127.0.0.1'); await once(server, 'listening');
await fs.writeFile(path.join(profile, 'ai-settings.json'), JSON.stringify({ version: 1, config: { ...defaultAiConfig, baseUrl: 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/v1', model: 'animation-target-mock', rememberKey: false } }));
const app = await launchDesktopFixture({ root, projectFile, profile }), page = await app.firstWindow(); page.setDefaultTimeout(10000);
let assistant: Page | undefined; const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
const button = (name: string) => page.getByRole('button', { name, exact: true });
const context = () => assistant!.evaluate(() => window.studio!.getAiContext!());
const current = async () => (await context())!.project;
const clip = async (id: string) => (await current()).ui.animations!.find(a => a.id === id)!;
const target = (a: UiAnimationClip, track?: number, key?: number): AiEditorTarget => ({ kind: 'uiAnimation', animationId: a.id, trackId: track === undefined ? undefined : a.tracks[track].id, keyId: track === undefined || key === undefined ? undefined : a.tracks[track].keys[key].id });
const send = async () => { await assistant!.getByLabel('发给 AI 的内容', { exact: true }).fill(edit ? '把当前关键帧数值改为0.9。' : '打开指定动画并定位选择。'); await assistant!.getByRole('button', { name: '发送', exact: true }).click(); };
const propose = async (value: AiEditorTarget) => { nextTarget = value; edit = false; const count = await assistant!.locator('.ai-editor-commands').count(); await send(); await expect(assistant!.locator('.ai-editor-commands')).toHaveCount(count + 1); return assistant!.locator('.ai-editor-commands').nth(count); };
const choose = async (value: AiEditorTarget) => {
  assert.ok(value.kind === 'uiAnimation'); const command = await propose(value); await command.getByRole('button').click(); await expect(command).toContainText('已定位控件动画');
  await expect.poll(async () => (await context())!.selectedUiAnimation).toEqual({ animationId: value.animationId, ...(value.trackId ? { trackId: value.trackId } : {}), ...(value.keyId ? { keyId: value.keyId } : {}) });
  await expect(page.locator('.ui-animation-track.selected')).toHaveCount(value.trackId ? 1 : 0); await expect(page.locator('.ui-animation-key.selected')).toHaveCount(value.keyId ? 1 : 0);
  if (value.keyId) { await expect(page.locator('.ui-animation-key.selected')).toHaveAttribute('data-animation-key', value.keyId); const key = (await clip(value.animationId)).tracks.find(t => t.id === value.trackId)!.keys.find(k => k.id === value.keyId)!; await expect(page.getByLabel('动画播放头秒数', { exact: true })).toHaveValue(String(key.time)); }
  return command;
};
const history = async (key: string) => { await button('回到起点').focus(); await page.keyboard.press(key); };
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 }); const opened = app.waitForEvent('window'); await button('AI 助手').click(); assistant = await opened;
  phase = 'base and repeat'; const repeated = await choose(target(base, base.tracks.length - 1, 1)); await expect(page.getByLabel('事件图页面')).toHaveValue('ui:main');
  await expect(button('保存界面')).toBeDisabled(); assert.equal((await current()).ui.activeInstanceId, undefined);
  const selectedBox = await page.locator('.ui-animation-key.selected').boundingBox(), scroller = await page.locator('[data-dock-panel="settings"]').boundingBox(); assert.ok(selectedBox && scroller && selectedBox.y >= scroller.y && selectedBox.y < scroller.y + scroller.height);
  await page.locator('[data-animation-key="' + base.tracks.at(-1)!.keys[0].id + '"]').click(); await repeated.getByRole('button').click(); await expect(page.locator('.ui-animation-key.selected')).toHaveAttribute('data-animation-key', base.tracks.at(-1)!.keys[1].id);
  await choose(target(base, 1)); await expect(page.getByLabel('动画播放头秒数', { exact: true })).toHaveValue('0'); await choose(target(sameName));
  assert.equal(await fs.readFile(projectFile, 'utf8'), original); checks.push('跨工作区按ID定位基础方案，末行滚动可见，重复定位及仅轨道/整个动画清空下级选择');
  phase = 'draft across scopes'; await page.getByLabel('界面动画总时长', { exact: true }).fill('3'); await page.getByLabel('界面动画总时长', { exact: true }).press('Tab');
  await choose(target(scoped, 0, 1)); await expect(page.getByLabel('事件图页面')).toHaveValue('ui:preferences'); assert.equal((await current()).ui.activeInstanceId, 'scheme'); assert.equal((await clip(sameName.id)).duration, 3);
  await choose(target(custom, 0, 1)); await expect(page.getByLabel('事件图页面')).toHaveValue('custom_animation_page'); assert.equal((await clip(sameName.id)).duration, 3);
  checks.push('跨界面方案和自定义页面保留手动动画草稿');
  phase = 'edit after navigation'; edit = true; await send(); const proposal = assistant.getByRole('region', { name: 'AI 建议修改' }).last(); await proposal.getByRole('button', { name: /^应用选中的/ }).click(); await expect(proposal).toContainText('已应用修改');
  await expect(page.getByLabel('关键帧数值', { exact: true })).toHaveValue('0.9'); await choose(target(base, 0, 1)); await history('Control+z');
  await expect.poll(async () => (await clip(custom.id)).tracks[0].keys[1].value).toBe(.6); assert.equal((await clip(sameName.id)).duration, 3); await history('Control+y');
  await expect.poll(async () => (await clip(custom.id)).tracks[0].keys[1].value).toBe(.9);
  await button('保存界面').click(); await expect(button('保存界面')).toBeDisabled();
  const saved = JSON.parse(await fs.readFile(projectFile, 'utf8')); assert.equal(saved.ui.activeInstanceId, 'scheme'); assert.deepEqual(saved.ui.animations.find((a: any) => a.id === base.id), base); assert.deepEqual(saved.ui.animations.find((a: any) => a.id === scoped.id), scoped); assert.deepEqual(saved.ui.components, project.ui.components);
  checks.push('定位后真实选择进入下一次AI修改；导航不占用历史，保存保留游戏默认方案');
  phase = 'stale command'; const stale = await propose(target(base, 0, 0)); await page.locator('[data-animation-key="' + base.tracks[0].keys[0].id + '"]').click(); await button('删除关键帧').click(); const beforeStale = await current();
  await stale.getByRole('button').click(); await expect(stale).toContainText('不存在或标识不唯一'); assert.deepEqual(await current(), beforeStale);
  await history('Control+z'); await stale.getByRole('button').click(); await expect(stale).toContainText('已定位控件动画'); await expect(page.locator('.ui-animation-key.selected')).toHaveAttribute('data-animation-key', base.tracks[0].keys[0].id);
  checks.push('过期关键帧定位失败且不改变选择或草稿，撤销删除后可重新定位');
  phase = 'cancel and discard'; await page.getByLabel('界面动画总时长', { exact: true }).fill('4'); await page.getByLabel('界面动画总时长', { exact: true }).press('Tab');
  const leave = await propose({ kind: 'blueprint', graphId: project.blueprints[0].id }); await leave.getByRole('button').click(); const dialog = page.getByRole('dialog', { name: '保存界面修改', exact: true }); await dialog.getByRole('button', { name: '取消', exact: true }).click(); await expect(leave).toContainText('已取消定位'); await expect(page.getByLabel('界面动画总时长', { exact: true })).toHaveValue('4');
  await leave.getByRole('button').click(); await dialog.getByRole('button', { name: '不保存', exact: true }).click(); await expect(leave).toContainText('已定位：'); await expect.poll(async () => (await context())!.selectedUiAnimation).toBeUndefined();
  await choose(target(base, 0, 1)); await expect(page.getByLabel('界面动画总时长', { exact: true })).toHaveValue('2'); await expect(button('保存界面')).toBeDisabled(); assert.deepEqual(JSON.parse(await fs.readFile(projectFile, 'utf8')), saved);
  checks.push('离开动画的保存提示支持取消和放弃，旧定位不会恢复被放弃的草稿');
  await page.screenshot({ path: path.join(output, 'target-key.png') }); await assistant.screenshot({ path: path.join(output, 'assistant-targets.png') });
  assert.deepEqual(errors, []); assert.deepEqual(serverErrors, []); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', compiled: true, externalApiCalled: false, checks, captures, projectFile }, null, 2));
} catch (error) { await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ phase, serverErrors, captures }, null, 2)); await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); await assistant?.screenshot({ path: path.join(output, 'failure-assistant.png') }).catch(() => undefined); throw error; }
finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => undefined); await app.close(); server.closeAllConnections(); server.close(); console.log(output); }
