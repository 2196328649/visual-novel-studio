import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, type Page } from '@playwright/test';
import { aiAnimationSelectionFixture } from './lib/ai-animation-selection-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { defaultAiConfig } from '../src/core/ai';
import { sampleUiAnimationTrack } from '../src/core/ui-animation-clips';

const root = path.resolve('.'), output = path.join(root, 'artifacts/ai-animation-selection', new Date().toISOString().replaceAll(':', '-'));
const profile = path.join(output, 'profile'), projectFile = path.join(output, 'project.vns.json'); await fs.mkdir(profile, { recursive: true });
const { project, clips } = aiAnimationSelectionFixture(), first = clips[0], other = clips[1], track = first.tracks[0], key = track.keys[1];
const expected = { animationId: first.id, trackId: track.id, keyId: key.id };
const original = JSON.stringify(project); await fs.writeFile(projectFile, original);
let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
const captures: any[] = [], serverErrors: string[] = [];
const keyPath = ['ui', 'animations', { id: first.id }, 'tracks', { id: track.id }, 'keys', { id: key.id }];
const server = createServer(async (request, response) => {
  try {
    let raw = ''; for await (const part of request) raw += part; const body = JSON.parse(raw), last = body.messages.at(-1).content;
    let result;
    if (!captures.length) {
      const context = JSON.parse(last.slice(last.indexOf('\n{') + 1)); captures.push(context.selectedUiAnimation);
      assert.deepEqual({ animationId: context.selectedUiAnimation.animationId, trackId: context.selectedUiAnimation.trackId, keyId: context.selectedUiAnimation.keyId }, expected);
      assert.equal(context.selectedUiAnimation.key.value, .45); await held;
      result = { read: [{ kind: 'project', path: keyPath }], operations: [] };
    } else {
      assert.match(last, new RegExp(key.id)); assert.match(last, /0\.45/); captures.push({ readResult: last });
      result = { message: '将发送请求时选中的关键帧改为0.8。', operations: [{ kind: 'editProject', path: [...keyPath, 'value'], action: 'set', value: .8 }] };
    }
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }] }));
  } catch (error) { serverErrors.push(String(error)); response.statusCode = 500; response.end(String(error)); }
}); server.listen(0, '127.0.0.1'); await once(server, 'listening');
await fs.writeFile(path.join(profile, 'ai-settings.json'), JSON.stringify({ version: 1, config: { ...defaultAiConfig, baseUrl: 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/v1', model: 'local-mock', rememberKey: false } }));
const app = await launchDesktopFixture({ root, projectFile, profile }), page = await app.firstWindow(); page.setDefaultTimeout(10000);
let assistant: Page | undefined; const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
const button = (name: string) => page.getByRole('button', { name, exact: true });
const context = () => assistant!.evaluate(() => window.studio!.getAiContext!());
const current = async () => (await context())!.project;
const animation = async (id: string) => (await current()).ui.animations!.find(a => a.id === id)!;
const openClip = (id: string) => page.locator('[data-ui-animation-id="' + id + '"] > button').click();
const selectKey = (id: string) => page.locator('[data-animation-key="' + id + '"]').click();
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 }); await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click();
  await openClip(first.id); const opened = app.waitForEvent('window'); await button('AI 助手').click(); assistant = await opened;
  await expect.poll(async () => (await context())!.selectedUiAnimation).toEqual({ animationId: first.id });
  await expect(assistant.getByLabel('当前工程上下文')).toContainText('控件动画：同名动画');
  await page.locator('[data-animation-track="' + track.id + '"] .ui-animation-track-label').click();
  await expect.poll(async () => (await context())!.selectedUiAnimation).toEqual({ animationId: first.id, trackId: track.id });
  await selectKey(key.id); await page.getByLabel('关键帧数值', { exact: true }).fill('.45'); await page.getByLabel('关键帧数值', { exact: true }).press('Tab');
  await expect.poll(async () => (await context())!.selectedUiAnimation).toEqual(expected);
  await expect(assistant.getByLabel('当前工程上下文')).toContainText('关键帧：2 秒');
  await assistant.getByLabel('发给 AI 的内容', { exact: true }).fill('把当前选中的关键帧数值改为0.8，其他内容不变。'); await assistant.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(() => captures.length).toBe(1);
  await button('返回事件图').click(); await expect.poll(async () => (await context())!.selectedUiAnimation).toBeUndefined();
  await openClip(other.id); await selectKey(other.tracks[1].keys[1].id);
  await expect.poll(async () => (await context())!.selectedUiAnimation?.animationId).toBe(other.id); release();
  const proposal = assistant.getByRole('region', { name: 'AI 建议修改' }).last(); await expect(proposal).toContainText('待应用修改 · 1 项');
  await proposal.getByRole('button', { name: '应用选中的 1 项修改', exact: true }).click(); await expect(proposal).toContainText('已应用修改');
  await expect.poll(async () => (await animation(first.id)).tracks[0].keys[1].value).toBe(.8);
  assert.deepEqual(await animation(other.id), other); await expect(page.getByLabel('关键帧数值', { exact: true })).toHaveValue('1');
  await button('返回事件图').click(); await openClip(first.id); await selectKey(key.id); await expect(page.getByLabel('关键帧数值', { exact: true })).toHaveValue('0.8');
  await button('回到起点').focus(); await page.keyboard.press('Control+z'); await expect(page.getByLabel('关键帧数值', { exact: true })).toHaveValue('0.45');
  await page.keyboard.press('Control+y'); await expect(page.getByLabel('关键帧数值', { exact: true })).toHaveValue('0.8');
  await page.getByLabel('动画播放头秒数', { exact: true }).fill('1');
  const preview = page.locator('[data-animation-preview="animated_text"]');
  const left = await preview.evaluate(el => parseFloat((el as HTMLElement).style.left) / el.parentElement!.getBoundingClientRect().width); assert.ok(Math.abs(left - .5) < .01);
  await button('删除关键帧').click(); await expect.poll(async () => (await context())!.selectedUiAnimation).toEqual({ animationId: first.id, trackId: track.id });
  await button('回到起点').focus(); await page.keyboard.press('Control+z'); await selectKey(key.id);
  assert.equal(await fs.readFile(projectFile, 'utf8'), original); await button('保存界面').click(); await expect(button('保存界面')).toBeDisabled();
  const saved = JSON.parse(await fs.readFile(projectFile, 'utf8')); assert.deepEqual(saved.ui.components, project.ui.components); assert.deepEqual(saved.ui.animations[1], other);
  const expectedClip = structuredClone(first); expectedClip.tracks[0].keys[1].value = .8; assert.deepEqual(saved.ui.animations[0], expectedClip);
  assert.equal(sampleUiAnimationTrack(saved.ui.animations[0].tracks[0], 1, .2), .5);
  await assistant.screenshot({ path: path.join(output, 'assistant-current-key.png') }); await page.screenshot({ path: path.join(output, 'applied-key.png') });
  await button('返回事件图').click(); await expect.poll(async () => (await context())!.selectedUiAnimation).toBeUndefined();
  await page.getByLabel('界面编辑模式').getByRole('button', { name: '设计', exact: true }).click(); await expect.poll(async () => (await context())!.selectedUiAnimation).toBeUndefined();
  await page.reload(); await expect(page.locator('.project-title strong')).toHaveText(project.name); await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click(); await openClip(first.id); await selectKey(key.id);
  await expect(page.getByLabel('关键帧数值', { exact: true })).toHaveValue('0.8'); await expect(button('保存界面')).toBeDisabled();
  assert.deepEqual(errors, []); assert.deepEqual(serverErrors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', externalApiCalled: false, compiled: true, captures, checks: ['动画/轨道/关键帧真实选择', '未保存关键帧进入AI上下文', '请求期间切到同名动画仍按原ID读取并修改', '独立历史保留手动草稿', '实际预览中点位置', '删除与离开清理选择', '保存重开和无关动画/控件保留'] }, null, 2));
} catch (error) { await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ serverErrors, captures }, null, 2)); await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); await assistant?.screenshot({ path: path.join(output, 'failure-assistant.png') }).catch(() => undefined); throw error; }
finally { release(); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => undefined); await app.close(); server.closeAllConnections(); server.close(); console.log(output); }
